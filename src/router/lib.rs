#![warn(unused_must_use)]

// This is a Next.js-compatible file-system router.
// It uses the filesystem to infer entry points.
// Despite being Next.js-compatible, it's not tied to Next.js.
// It does not handle the framework parts of rendering pages.
// All it does is resolve URL paths to the appropriate entry point and parse URL params/query.
use core::cmp::Ordering;
use core::ptr::NonNull;

use bun_collections::{ArrayHashMap, StringHashMap};
use bun_core::{ZStr, strings};
use bun_paths::SEP;
use bun_ptr::RawSlice;

use bun_http_types::URLPath::URLPath;

// Wyhash with seed 0. NOT Wyhash11 (different algo).
#[inline]
fn wyhash(input: &[u8]) -> u64 {
    bun_wyhash::hash(input)
}

use bun_collections::index_sort;
use bun_core::HashedString;

// ──────────────────────────────────────────────────────────────────────────
// cross-tier decoupling
// ──────────────────────────────────────────────────────────────────────────

// Defined here so T4 router is self-contained; `bun_bundler::options` re-exports
// this (`pub use bun_router::RouteConfig`) so the original path keeps resolving.
#[derive(Debug, Clone, Default)]
pub struct RouteConfig {
    pub dir: Box<[u8]>,

    // TODO: do we need a separate list for data-only extensions?
    // e.g. /foo.json just to get the data for the route, without rendering the html
    // I think it's fine to hardcode as .json for now, but if I personally were writing a framework
    // I would consider using a custom binary format to minimize request size
    // maybe like CBOR
    pub extensions: Box<[Box<[u8]>]>,
}

// `hash_const` is byte-identical to the runtime `bun_wyhash::hash` (seed 0);
// `tests::hash_const_matches_runtime` in `bun_wyhash` guards drift.
const INDEX_ROUTE_HASH: u32 =
    bun_wyhash::hash_const(0, b"$$/index-route$$-!(@*@#&*%-901823098123") as u32;

// Param/List are lifetime-parameterized: `name` borrows the route name
// (owned by `Routes`) and `value` borrows the *request URL buffer*, so the
// correct representation is a borrowed `&'a [u8]`, not a forged `'static`.
//
// `bun_url::route_param::Param<'a>` is now lifetime-generic (TYPE_ONLY
// move-down landed); collapse the local copy to a re-export so the param list
// type matches `PathnameScanner::init`.
pub use bun_url::route_param;
pub use route_param::Param;

const BANNED_DIRS: [&[u8]; 1] = [b"node_modules"];

// TODO(b2-blocked): bun_collections::MultiArrayElement derive — proc-macro not
// yet landed, so MultiArrayList<RouteIndex> can't expose per-field column
// accessors. Hand-rolled SoA struct until the derive exists.
#[derive(Default)]
struct RouteIndexList {
    // The `Box` is load-bearing: `Routes::index` / `Routes::static_` hold
    // `NonNull<Route>` / `*const Route` into the box interiors, and the three
    // columns below hold slices of each route's own strings; unboxing would
    // dangle them on `Vec` realloc.
    #[expect(clippy::vec_box)]
    route: Vec<Box<Route>>,
    name: Vec<RawSlice<u8>>,
    match_name: Vec<RawSlice<u8>>,
    filepath: Vec<RawSlice<u8>>,
}

impl RouteIndexList {
    fn with_capacity(cap: usize) -> Self {
        Self {
            route: Vec::with_capacity(cap),
            name: Vec::with_capacity(cap),
            match_name: Vec::with_capacity(cap),
            filepath: Vec::with_capacity(cap),
        }
    }
    fn push(&mut self, route: Box<Route>) {
        self.name.push(RawSlice::new(route.name()));
        self.match_name.push(RawSlice::new(route.match_name()));
        self.filepath.push(RawSlice::new(route.abs_path()));
        self.route.push(route);
    }
    #[inline]
    pub(crate) fn len(&self) -> usize {
        self.route.len()
    }
    #[inline]
    pub(crate) fn items_route(&self) -> &[Box<Route>] {
        &self.route
    }
    #[inline]
    pub(crate) fn items_name(&self) -> &[RawSlice<u8>] {
        &self.name
    }
    #[inline]
    pub(crate) fn items_match_name(&self) -> &[RawSlice<u8>] {
        &self.match_name
    }
    #[inline]
    pub(crate) fn items_filepath(&self) -> &[RawSlice<u8>] {
        &self.filepath
    }
}

/// The routes of one scan. Nothing changes them afterwards: `reload()` scans into a new `Routes`.
pub struct Routes {
    pub(crate) list: RouteIndexList,
    /// Index into `list`'s columns where dynamic routes begin (sorted after
    /// static). Stored as an offset+len instead of materialized slices to avoid
    /// a self-referential struct; we re-slice on each `match_dynamic` call.
    pub(crate) dynamic_start: Option<usize>,
    pub(crate) dynamic_len: usize,

    /// completely static children of indefinite depth
    /// `"blog/posts"`
    /// `"dashboard"`
    /// `"profiles"`
    /// this is a fast path?
    pub(crate) static_: StringHashMap<*const Route>,

    /// Corresponds to "index.js" on the filesystem.
    /// A raw pointer co-owned with `list` (points into a `Box<Route>` owned by
    /// `list.route`). Stored as `NonNull` (not `&'a Route`) so `Routes` claims
    /// no borrow it doesn't actually take; matches `static_` above.
    pub(crate) index: Option<NonNull<Route>>,

    /// Real path of the routes directory, with a trailing separator.
    dir: Box<[u8]>,
}

impl Routes {
    /// Reads the tree below `dir` from disk, never from a cache. Leaves out a directory it cannot read.
    pub fn scan(
        dir: bun_sys::Dir,
        extensions: &[Box<[u8]>],
        log: &mut bun_ast::Log,
    ) -> bun_sys::Result<Routes> {
        let mut real_path = bun_paths::path_buffer_pool::get();
        let mut root: Vec<u8> = dir.get_fd_path(&mut real_path)?.to_vec();
        drop(real_path);
        let listing = RouteLoader::list(dir, &root)?;

        let mut loader = RouteLoader {
            extensions,
            log,
            public_dir: Vec::new(),
            path: Vec::new(),
            dedupe_dynamic: ArrayHashMap::new(),
            index: None,
            static_list: StringHashMap::new(),
            all_routes: Vec::new(),
        };
        loader.load(
            &listing,
            &WalkedDir {
                real_path: &root,
                parent: None,
            },
        );

        if root.last() != Some(&SEP) {
            root.push(SEP);
        }
        Ok(loader.finish(root.into_boxed_slice()))
    }

    #[inline]
    pub fn dir(&self) -> &[u8] {
        &self.dir
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.list.len()
    }

    /// The name of each route and the absolute path of its file.
    pub fn iter(&self) -> impl Iterator<Item = (&[u8], &[u8])> {
        self.list
            .items_name()
            .iter()
            .zip(self.list.items_filepath())
            .map(|(name, file_path)| (name.slice(), file_path.slice()))
    }

    pub fn match_page_with_allocator<'p>(
        &'p self,
        _: &[u8],
        url_path: &URLPath,
        params: &'p mut route_param::List<'p>,
    ) -> Option<Match<'p>> {
        // Trim trailing slash
        let mut path = url_path.path;
        let mut redirect = false;

        // Normalize trailing slash
        // "/foo/bar/index/" => "/foo/bar/index"
        if !path.is_empty() && path[path.len() - 1] == b'/' {
            path = &path[0..path.len() - 1];
            redirect = true;
        }

        // Normal case: "/foo/bar/index" => "/foo/bar"
        // Pathological: "/foo/bar/index/index/index/index/index/index" => "/foo/bar"
        // Extremely pathological: "/index/index/index/index/index/index/index" => "index"
        while path.ends_with(b"/index") {
            path = &path[0..path.len() - b"/index".len()];
            redirect = true;
        }

        if path == b"index" {
            path = b"";
            redirect = true;
        }

        // one final time, trim trailing slash
        while !path.is_empty() && path[path.len() - 1] == b'/' {
            path = &path[0..path.len() - 1];
            redirect = true;
        }

        if path == b"." {
            path = b"";
            redirect = false;
        }
        let _ = redirect;

        if path.is_empty() {
            if let Some(index_ptr) = self.index {
                // SAFETY: points into a Box<Route> owned by self.list; valid for &self.
                let index = unsafe { index_ptr.as_ref() };
                return Some(Match {
                    params: std::ptr::from_mut(params),
                    name: index.name(),
                    pathname: url_path.pathname,
                    file_path: index.abs_path(),
                    query_string: url_path.query_string,
                });
            }

            return None;
        }

        if let Some(route_ptr) = self.match_(path, params) {
            // SAFETY: pointers from static_/dynamic alias Box<Route> stored in
            // self.list, which outlives self.
            let route = unsafe { &*route_ptr };
            return Some(Match {
                params: std::ptr::from_mut(params),
                name: route.name(),
                pathname: url_path.pathname,
                file_path: route.abs_path(),
                query_string: url_path.query_string,
            });
        }

        None
    }

    fn match_dynamic<'p>(
        &'p self,
        path: &'p [u8],
        params: &mut route_param::List<'p>,
    ) -> Option<*const Route> {
        // its cleaned, so now we search the big list of strings
        let start = self.dynamic_start?;
        let end = start + self.dynamic_len;
        let dynamic = &self.list.items_route()[start..end];
        let dynamic_names = &self.list.items_name()[start..end];
        let dynamic_match_names = &self.list.items_match_name()[start..end];
        for ((case_sensitive_name, name), route) in dynamic_names
            .iter()
            .zip(dynamic_match_names.iter())
            .zip(dynamic.iter())
        {
            if Pattern::match_::<true>(path, &case_sensitive_name[1..], name, params) {
                return Some(&raw const **route);
            }
        }

        None
    }

    fn match_<'p>(
        &'p self,
        pathname_: &'p [u8],
        params: &mut route_param::List<'p>,
    ) -> Option<*const Route> {
        let pathname = strings::trim_left(pathname_, b"/");

        if pathname.is_empty() {
            return self.index.map(|p| p.as_ptr().cast_const());
        }

        self.static_
            .get(pathname)
            .copied()
            .or_else(|| self.match_dynamic(pathname, params))
    }
}

/// A directory the walk is inside of, and the one that led to it.
struct WalkedDir<'a> {
    real_path: &'a [u8],
    parent: Option<&'a WalkedDir<'a>>,
}

impl WalkedDir<'_> {
    fn is_inside(&self, real_path: &[u8]) -> bool {
        let mut dir = Some(self);
        while let Some(walked) = dir {
            if walked.real_path == real_path {
                return true;
            }
            dir = walked.parent;
        }
        false
    }
}

struct RouteLoader<'a> {
    extensions: &'a [Box<[u8]>],
    log: &'a mut bun_ast::Log,

    /// The directory being read, below the routes directory: empty, or `/blog/[slug]`.
    public_dir: Vec<u8>,
    path: Vec<u8>,

    /// Hash of a dynamic route to its index in `all_routes`.
    dedupe_dynamic: ArrayHashMap<u32, usize>,
    // NOTE: raw NonNull (not &'a Route) because it points into self.all_routes
    // (self-referential); `Routes` co-owns it with `list`.
    index: Option<NonNull<Route>>,
    static_list: StringHashMap<*const Route>,
    // `Box` is load-bearing: `index` / `static_list` above hold raw pointers
    // into the box interiors; unboxing would dangle them on `Vec` realloc.
    #[expect(clippy::vec_box)]
    all_routes: Vec<Box<Route>>,
}

impl<'a> RouteLoader<'a> {
    fn append_route(&mut self, route: Route) {
        use bun_collections::hash_map::Entry;

        // /index.js
        if route.full_hash == INDEX_ROUTE_HASH {
            // Of several index files, the first in byte order is the index route.
            if self.index.is_some() {
                return;
            }
            // Derived from a `&mut`, not a `&*` downgrade: `NonNull::from(&T)`
            // yields a frozen tag. Today `index` is only read through (`match_`
            // takes `as_ref()`), so the old spelling was not live UB, but it was
            // one write away from it. The static arm below needs no such change:
            // `&raw const *box` forms no reference at all. Parking the `Box`
            // before deriving is belt-and-braces.
            self.all_routes.push(Box::new(route));
            let parked = self.all_routes.last_mut().expect("just pushed");
            // Box contents have a stable address; never removed from
            // `all_routes` until consumed by `finish`.
            self.index = Some(NonNull::from(&mut **parked));
            return;
        }

        // static route
        if route.param_count == 0 {
            if let Some(existing) = self.static_list.get(route.match_name()) {
                let source = bun_ast::Source::init_empty_file(route.abs_path());
                self.log.add_error_fmt(
                    Some(&source),
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "Route \"{}\" is already defined by {}",
                        bstr::BStr::new(route.name()),
                        // SAFETY: *existing aliases a Box<Route> in self.all_routes
                        bstr::BStr::new(unsafe { &**existing }.abs_path()),
                    ),
                );
                return;
            }

            let new_route = Box::new(route);
            let new_route_ptr: *const Route = &raw const *new_route;

            // Handle static routes with uppercase characters by ensuring exact case still matches
            // Longer-term:
            // - We should have an option for controlling this behavior
            // - We should have an option for allowing case-sensitive matching
            // - But the default should be case-insensitive matching
            // This hack is below the engineering quality bar I'm happy with.
            // It will cause unexpected behavior.
            if new_route.has_uppercase {
                if let Some(existing) = self.static_list.get(&new_route.name()[1..]) {
                    let source = bun_ast::Source::init_empty_file(new_route.abs_path());
                    self.log.add_error_fmt(
                        Some(&source),
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "Route \"{}\" is already defined by {}",
                            bstr::BStr::new(new_route.name()),
                            // SAFETY: *existing aliases a Box<Route> in self.all_routes
                            bstr::BStr::new(unsafe { &**existing }.abs_path()),
                        ),
                    );

                    return;
                }

                self.static_list
                    .put_assume_capacity(&new_route.name()[1..], new_route_ptr);
            }

            self.static_list
                .put_assume_capacity(new_route.match_name(), new_route_ptr);
            self.all_routes.push(new_route);

            return;
        }

        {
            match self.dedupe_dynamic.entry(route.full_hash) {
                Entry::Occupied(e) => {
                    let source = bun_ast::Source::init_empty_file(route.abs_path());
                    self.log.add_error_fmt(
                        Some(&source),
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "Route \"{}\" is already defined by {}",
                            bstr::BStr::new(route.name()),
                            bstr::BStr::new(self.all_routes[*e.get()].abs_path()),
                        ),
                    );
                    return;
                }
                Entry::Vacant(v) => {
                    v.insert(self.all_routes.len());
                }
            }
        }

        {
            let new_route = Box::new(route);
            self.all_routes.push(new_route);
        }
    }

    fn finish(mut self, dir: Box<[u8]>) -> Routes {
        index_sort::sort_slice_unstable_by(&mut self.all_routes, |a, b| {
            sorter::sort_by_name_cmp(a, b)
        });

        let mut route_list = RouteIndexList::with_capacity(self.all_routes.len());

        let mut dynamic_start: Option<usize> = None;
        let mut index_id: Option<usize> = None;

        for (i, route) in self.all_routes.into_iter().enumerate() {
            if (route.kind as u8) > (pattern::Tag::Static as u8) && dynamic_start.is_none() {
                dynamic_start = Some(i);
            }

            if route.full_hash == INDEX_ROUTE_HASH {
                index_id = Some(i);
            }

            route_list.push(route);
        }

        let mut dynamic_len: usize = 0;
        if let Some(dynamic_i) = dynamic_start {
            dynamic_len = route_list.len() - dynamic_i;
            if let Some(index_i) = index_id {
                if index_i > dynamic_i {
                    // Due to the sorting order, the index route can be the last route.
                    // We don't want to attempt to match the index route or different stuff will break.
                    dynamic_len -= 1;
                }
            }
        }

        Routes {
            list: route_list,
            dynamic_start,
            dynamic_len,
            static_: self.static_list,
            // Points into a Box<Route> now owned by `route_list`; co-owned raw
            // pointer.
            index: self.index,
            dir,
        }
    }

    /// Closes `dir`: one directory is open at a time. Byte order: a file system has its own.
    fn list(dir: bun_sys::Dir, real_path: &[u8]) -> bun_sys::Result<DirListing> {
        let mut listing = DirListing::read(&dir, real_path, |name| name.starts_with(b"."))?;
        drop(dir);
        listing.sort();
        Ok(listing)
    }

    /// Loads the routes of a directory and of the directories below it, depth first.
    fn load(&mut self, listing: &DirListing, walked: &WalkedDir<'_>) {
        'outer: for entry in listing.iter() {
            match entry.kind {
                EntryKind::Dir => {
                    for banned_dir in BANNED_DIRS.iter() {
                        if entry.name == *banned_dir {
                            continue 'outer;
                        }
                    }

                    let mut real_path = Vec::new();
                    join_path(&mut real_path, walked.real_path, entry.name);
                    let Ok(child) = bun_sys::Dir::open(&real_path) else {
                        continue;
                    };
                    if entry.is_link {
                        // A link to a directory the walk is inside of would never end.
                        let mut buf = bun_paths::path_buffer_pool::get();
                        let Ok(target) = child.get_fd_path(&mut buf) else {
                            continue;
                        };
                        if walked.is_inside(target) {
                            continue;
                        }
                        real_path.clear();
                        real_path.extend_from_slice(target);
                    }

                    let Ok(child) = Self::list(child, &real_path) else {
                        continue;
                    };

                    let parent_len = self.public_dir.len();
                    self.public_dir.push(b'/');
                    self.public_dir.extend_from_slice(entry.name);
                    self.load(
                        &child,
                        &WalkedDir {
                            real_path: &real_path,
                            parent: Some(walked),
                        },
                    );
                    self.public_dir.truncate(parent_len);
                }

                EntryKind::File => {
                    let extname = bun_paths::extension(entry.name);
                    // exclude "." or ""
                    if extname.len() < 2 {
                        continue;
                    }
                    if !self
                        .extensions
                        .iter()
                        .any(|extension| &extname[1..] == extension.as_ref())
                    {
                        continue;
                    }

                    // Only a link needs the file system to say where it leads.
                    join_path(&mut self.path, walked.real_path, entry.name);
                    if entry.is_link {
                        self.path.push(0);
                        let mut buf = bun_paths::path_buffer_pool::get();
                        let Ok(target) = bun_sys::realpath(
                            ZStr::from_buf(&self.path, self.path.len() - 1),
                            &mut buf,
                        ) else {
                            continue;
                        };
                        self.path.clear();
                        self.path.extend_from_slice(target);
                    }

                    if let Some(route) =
                        Route::parse(entry.name, extname, &self.path, &self.public_dir, self.log)
                    {
                        self.append_route(route);
                    }
                }
            }
        }
    }
}

// Packed `{ offset: u16, len: u16 }` pair stored in a u32.
#[repr(transparent)]
#[derive(Copy, Clone, Default, PartialEq, Eq)]
pub struct TinyPtr(u32);

impl TinyPtr {
    #[inline]
    pub(crate) const fn offset(self) -> u16 {
        self.0 as u16
    }
    #[inline]
    pub(crate) const fn len(self) -> u16 {
        (self.0 >> 16) as u16
    }
    #[inline]
    pub(crate) fn set_offset(&mut self, offset: u16) {
        self.0 = (self.0 & 0xFFFF_0000) | (offset as u32);
    }
    #[inline]
    pub(crate) fn set_len(&mut self, len: u16) {
        self.0 = (self.0 & 0x0000_FFFF) | ((len as u32) << 16);
    }

    #[inline]
    pub(crate) fn str<'s>(self, slice: &'s [u8]) -> &'s [u8] {
        if self.len() > 0 {
            &slice[self.offset() as usize..(self.offset() as usize + self.len() as usize)]
        } else {
            b""
        }
    }
}

pub struct Route {
    /// `name`, then `match_name` when it is not a part of `name`, then `abs_path`.
    strings: Box<[u8]>,
    name_len: u32,
    match_name_start: u32,
    match_name_end: u32,
    abs_path_start: u32,

    pub(crate) full_hash: u32,
    pub(crate) param_count: u16,

    pub(crate) kind: pattern::Tag,

    pub(crate) has_uppercase: bool,
}

impl Route {
    /// Public display name for the route.
    /// "/", "/index" is "/"
    /// "/foo/index.js" becomes "/foo"
    /// case-sensitive, has leading slash
    #[inline]
    pub(crate) fn name(&self) -> &[u8] {
        &self.strings[..self.name_len as usize]
    }

    /// Name used for matching.
    /// - Omits leading slash
    /// - Lowercased
    /// This is [inconsistent with Next.js](https://github.com/vercel/next.js/issues/21498)
    #[inline]
    pub(crate) fn match_name(&self) -> &[u8] {
        &self.strings[self.match_name_start as usize..self.match_name_end as usize]
    }

    /// Every link is resolved, and `/` separates it on every platform.
    #[inline]
    pub(crate) fn abs_path(&self) -> &[u8] {
        &self.strings[self.abs_path_start as usize..]
    }

    /// `public_dir`: the directory of the file below the routes directory, empty or `/blog/[slug]`.
    pub(crate) fn parse(
        base_: &[u8],
        extname: &[u8],
        abs_path: &[u8],
        public_dir: &[u8],
        log: &mut bun_ast::Log,
    ) -> Option<Route> {
        let base = &base_[0..base_.len() - extname.len()];
        debug_assert!(!base.is_empty());

        // this is a path like
        // "/index.js"
        // "/foo/index.ts"
        // "/foo/bar.tsx"
        // the name is this one without the extension and without a last "/index"
        let is_index_file = base == b"index";
        let name_len = if is_index_file {
            public_dir.len()
        } else {
            public_dir.len() + 1 + base.len()
        };
        let is_index = name_len == 0;
        let has_uppercase = !is_index
            && [public_dir, base, extname]
                .iter()
                .any(|part| part.iter().any(u8::is_ascii_uppercase));

        let mut strings: Vec<u8> = Vec::with_capacity(
            name_len.max(1) + if has_uppercase { name_len - 1 } else { 0 } + abs_path.len(),
        );
        strings.extend_from_slice(public_dir);
        if !is_index_file {
            strings.push(b'/');
            strings.extend_from_slice(base);
        }

        let mut validation_result = pattern::ValidationResult::default();
        let match_name = if is_index {
            strings.push(b'/');
            0..1
        } else {
            validation_result = Pattern::validate(&strings[1..], log)?;
            if has_uppercase {
                strings.extend_from_within(1..);
                strings[name_len..].make_ascii_lowercase();
                name_len..strings.len()
            } else {
                1..name_len
            }
        };
        let name_len = name_len.max(1);
        debug_assert!(is_index || strings[match_name.start] != b'/');
        debug_assert!(strings[0] == b'/');

        let abs_path_start = strings.len();
        strings.extend_from_slice(abs_path);
        #[cfg(windows)]
        {
            bun_paths::resolve_path::platform_to_posix_in_place(&mut strings[abs_path_start..]);
            debug_assert!(strings::index_of_char(&strings, b'\\').is_none());
        }

        let full_hash = if is_index {
            INDEX_ROUTE_HASH
        } else {
            wyhash(&strings[..name_len]) as u32
        };
        Some(Route {
            strings: strings.into_boxed_slice(),
            name_len: name_len as u32,
            match_name_start: match_name.start as u32,
            match_name_end: match_name.end as u32,
            abs_path_start: abs_path_start as u32,
            full_hash,
            param_count: validation_result.param_count,
            kind: validation_result.kind,
            has_uppercase,
        })
    }
}

pub(crate) mod sorter {
    use super::*;

    const fn build_sort_table() -> [u8; 256] {
        let mut table = [0u8; 256];
        let mut i = 0usize;
        while i < 256 {
            table[i] = i as u8;
            i += 1;
        }
        // move dynamic routes to the bottom
        table[b'[' as usize] = 252;
        table[b']' as usize] = 253;
        // of each segment
        table[b'/' as usize] = 254;
        table
    }

    static SORT_TABLE: [u8; 256] = build_sort_table();

    pub(crate) fn sort_by_name_string(lhs: &[u8], rhs: &[u8]) -> bool {
        let n = lhs.len().min(rhs.len());
        for (lhs_i, rhs_i) in lhs[0..n].iter().zip(&rhs[0..n]) {
            match SORT_TABLE[*lhs_i as usize].cmp(&SORT_TABLE[*rhs_i as usize]) {
                Ordering::Equal => continue,
                Ordering::Less => return true,
                Ordering::Greater => return false,
            }
        }
        lhs.len().cmp(&rhs.len()) == Ordering::Less
    }

    pub(crate) fn sort_by_name(a: &Route, b: &Route) -> bool {
        let a_name = a.match_name();
        let b_name = b.match_name();

        // route order determines route match order
        // - static routes go first because we match those first
        // - dynamic, catch-all, and optional catch all routes are sorted lexicographically, except "[", "]" appear last so that deepest routes are tested first
        // - catch-all & optional catch-all appear at the end because we want to test those at the end.
        match (a.kind as u8).cmp(&(b.kind as u8)) {
            Ordering::Equal => match a.kind {
                // static + dynamic are sorted alphabetically
                pattern::Tag::Static | pattern::Tag::Dynamic => sort_by_name_string(a_name, b_name),
                // catch all and optional catch all must appear below dynamic
                pattern::Tag::CatchAll | pattern::Tag::OptionalCatchAll => {
                    match a.param_count.cmp(&b.param_count) {
                        Ordering::Equal => sort_by_name_string(a_name, b_name),
                        Ordering::Less => false,
                        Ordering::Greater => true,
                    }
                }
            },
            Ordering::Less => true,
            Ordering::Greater => false,
        }
    }

    /// Adapter for slice::sort_by which expects an Ordering.
    pub(crate) fn sort_by_name_cmp(a: &Route, b: &Route) -> Ordering {
        if sort_by_name(a, b) {
            Ordering::Less
        } else if sort_by_name(b, a) {
            Ordering::Greater
        } else {
            Ordering::Equal
        }
    }
}

pub struct Match<'a> {
    /// raw url path from the request
    pub pathname: &'a [u8],
    /// absolute filesystem path to the entry point; borrows the `Routes`
    pub file_path: &'a [u8],
    /// route name, like `"posts/[id]"`; borrows the `Routes`
    pub name: &'a [u8],

    // NOTE: raw `*mut` (not `&'a mut`).
    // `MatchedRoute` (bun_runtime) stores this self-referentially — a
    // `&'a mut List` here would be invalidated under Stacked Borrows the
    // moment any `&mut MatchedRoute` is taken.
    pub params: *mut route_param::List<'a>,
    pub query_string: &'a [u8],
}

impl<'a> Match<'a> {
    /// Widen all borrowed slices to `'static` for self-referential storage.
    ///
    /// Field-by-field move (no bitwise reinterpret). Used by `MatchedRoute`
    /// (bun_runtime), which moves the backing `pathname_backing` buffer into
    /// the same heap-stable `Box` that holds this `Match` — see the SAFETY
    /// note at that call site for the full invariant.
    ///
    /// # Safety
    /// Caller guarantees every borrowed slice (and `*params`' element slices)
    /// outlives the returned value.
    #[inline]
    #[allow(unsafe_op_in_unsafe_fn)]
    pub unsafe fn detach_lifetime(self) -> Match<'static> {
        // `d` stays `unsafe fn` so a safe-signature wrapper does not hide the
        // lifetime-widen; the outer fn carries `#[allow(unsafe_op_in_unsafe_fn)]`
        // so the direct call sites below need no per-line `unsafe { }`.
        #[inline(always)]
        unsafe fn d(s: &[u8]) -> &'static [u8] {
            // SAFETY: caller contract on `detach_lifetime` — every borrowed
            // slice outlives the returned `Match<'static>`.
            unsafe { &*core::ptr::from_ref::<[u8]>(s) }
        }
        Match {
            pathname: d(self.pathname),
            file_path: d(self.file_path),
            name: d(self.name),
            // Raw pointer; lifetime parameter on the pointee is phantom for the
            // pointer value itself.
            params: self.params.cast::<route_param::List<'static>>(),
            query_string: d(self.query_string),
        }
    }

    pub fn pathname_without_leading_slash(&self) -> &[u8] {
        strings::trim_left(self.pathname, b"/")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Directory listing
// ──────────────────────────────────────────────────────────────────────────

/// What a name in a directory is, or what a link with that name leads to.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EntryKind {
    File,
    Dir,
}

#[derive(Clone, Copy)]
pub struct DirListingEntry<'a> {
    pub name: &'a [u8],
    pub kind: EntryKind,
    pub is_link: bool,
}

#[derive(Clone, Copy)]
struct ListedName {
    start: u32,
    len: u32,
    kind: EntryKind,
    is_link: bool,
}

/// One directory, read from disk. The resolver's listing is a cache: a route scan cannot use it.
pub struct DirListing {
    names: Vec<u8>,
    entries: Vec<ListedName>,
}

impl DirListing {
    /// `dir` is open at `path`. Leaves out what `skip` accepts, a link to nothing, and what is
    /// not a file or a directory. Opens nothing: a FIFO would block.
    pub fn read(
        dir: &bun_sys::Dir,
        path: &[u8],
        mut skip: impl FnMut(&[u8]) -> bool,
    ) -> bun_sys::Result<DirListing> {
        use bun_sys::FileKind;

        let mut listing = DirListing {
            names: Vec::new(),
            entries: Vec::new(),
        };
        let mut entry_path = Vec::new();
        let mut iterator = bun_sys::iterate_dir(dir.fd());
        while let Some(entry) = iterator.next()? {
            let name = entry.name.slice_u8();
            if skip(name) {
                continue;
            }
            let mut is_link = entry.kind == FileKind::SymLink;
            let kind = match entry.kind {
                FileKind::File => EntryKind::File,
                FileKind::Directory => EntryKind::Dir,
                // `Unknown`: the file system does not say what the name is.
                FileKind::SymLink | FileKind::Unknown => {
                    join_path(&mut entry_path, path, name);
                    entry_path.push(0);
                    let entry_path = ZStr::from_buf(&entry_path, entry_path.len() - 1);
                    let mut kind = FileKind::SymLink;
                    if !is_link {
                        let Ok(stat) = bun_sys::lstat(entry_path) else {
                            continue;
                        };
                        kind = bun_sys::kind_from_mode(stat.st_mode as bun_sys::Mode);
                        is_link = kind == FileKind::SymLink;
                    }
                    if is_link {
                        let Ok(stat) = bun_sys::stat(entry_path) else {
                            continue;
                        };
                        kind = bun_sys::kind_from_mode(stat.st_mode as bun_sys::Mode);
                    }
                    match kind {
                        FileKind::File => EntryKind::File,
                        FileKind::Directory => EntryKind::Dir,
                        _ => continue,
                    }
                }
                _ => continue,
            };
            listing.entries.push(ListedName {
                start: listing.names.len() as u32,
                len: name.len() as u32,
                kind,
                is_link,
            });
            listing.names.extend_from_slice(name);
        }
        Ok(listing)
    }

    /// A directory lists its names in an order of its own. This puts them in byte order.
    pub fn sort(&mut self) {
        let names = &self.names;
        index_sort::sort_slice_unstable_by_key(&mut self.entries, |entry| {
            &names[entry.start as usize..][..entry.len as usize]
        });
    }

    pub fn iter(&self) -> impl Iterator<Item = DirListingEntry<'_>> {
        self.entries.iter().map(|entry| DirListingEntry {
            name: &self.names[entry.start as usize..][..entry.len as usize],
            kind: entry.kind,
            is_link: entry.is_link,
        })
    }
}

/// `dir`, a separator and `name`, byte for byte: a normalizing join would rewrite a name.
fn join_path(out: &mut Vec<u8>, dir: &[u8], name: &[u8]) {
    out.clear();
    out.extend_from_slice(dir);
    if dir.last() != Some(&SEP) {
        out.push(SEP);
    }
    out.extend_from_slice(name);
}

// ──────────────────────────────────────────────────────────────────────────
// Pattern
// ──────────────────────────────────────────────────────────────────────────

pub mod pattern {
    use super::*;

    type RoutePathInt = u16;

    #[derive(Clone, Copy)]
    pub struct Pattern {
        pub(crate) value: Value,
        pub(crate) len: RoutePathInt,
    }

    impl Pattern {
        /// Match a filesystem route pattern to a URL path.
        pub(crate) fn match_<'a, const ALLOW_OPTIONAL_CATCH_ALL: bool>(
            // `path` must be lowercased and have no leading slash
            path: &'a [u8],
            // case-sensitive, must not have a leading slash
            name: &'a [u8],
            // case-insensitive, must not have a leading slash
            match_name: &[u8],
            params: &mut route_param::List<'a>,
        ) -> bool {
            let mut offset: RoutePathInt = 0;
            let mut path_ = path;
            while (offset as usize) < name.len() {
                let mut pattern = Pattern::init(match_name, offset).expect("unreachable");
                offset = pattern.len;

                match pattern.value {
                    Value::Static(str_) => {
                        let segment = &path_
                            [0..strings::index_of_char_usize(path_, b'/').unwrap_or(path_.len())];
                        if !str_.eql_bytes(segment) {
                            params.clear(); // shrinkRetainingCapacity(0)
                            return false;
                        }

                        path_ = if segment.len() < path_.len() {
                            &path_[segment.len() + 1..]
                        } else {
                            b""
                        };

                        if path_.is_empty() && pattern.is_end(name) {
                            return true;
                        }
                    }
                    Value::Dynamic(dynamic) => {
                        if let Some(i) = strings::index_of_char_usize(path_, b'/') {
                            params.push(Param {
                                name: dynamic.str(name),
                                value: &path_[0..i],
                            });
                            path_ = &path_[i + 1..];

                            if pattern.is_end(name) {
                                params.clear(); // shrinkRetainingCapacity(0)
                                return false;
                            }

                            continue;
                        } else if pattern.is_end(name) {
                            params.push(Param {
                                name: dynamic.str(name),
                                value: path_,
                            });
                            return true;
                        } else if ALLOW_OPTIONAL_CATCH_ALL {
                            pattern = Pattern::init(match_name, offset).expect("unreachable");

                            if matches!(pattern.value, Value::OptionalCatchAll(_)) {
                                params.push(Param {
                                    name: dynamic.str(name),
                                    value: path_,
                                });
                                path_ = b"";
                                let _ = path_;
                                return true;
                            }

                            params.clear(); // shrinkRetainingCapacity(0)
                            return false;
                        }

                        if !ALLOW_OPTIONAL_CATCH_ALL {
                            return true;
                        }
                    }
                    Value::CatchAll(dynamic) => {
                        if !path_.is_empty() {
                            params.push(Param {
                                name: dynamic.str(name),
                                value: path_,
                            });
                            return true;
                        }

                        return false;
                    }
                    Value::OptionalCatchAll(dynamic) => {
                        if ALLOW_OPTIONAL_CATCH_ALL {
                            if !path_.is_empty() {
                                params.push(Param {
                                    name: dynamic.str(name),
                                    value: path_,
                                });
                            }

                            return true;
                        }

                        return false;
                    }
                }
            }

            false
        }

        /// Validate a Route pattern, returning the number of route parameters.
        /// `None` means invalid. Error messages are logged.
        /// That way, we can provide a list of all invalid routes rather than failing the first time.
        pub(crate) fn validate(input: &[u8], log: &mut bun_ast::Log) -> Option<ValidationResult> {
            if strings::CodepointIterator::needs_utf8_decoding(input) {
                let source = bun_ast::Source::init_empty_file(input);
                log.add_error_fmt(
                    Some(&source),
                    bun_ast::Loc::EMPTY,
                    format_args!("Route name must be plaintext"),
                );
                return None;
            }

            let mut count: u16 = 0;
            let mut offset: RoutePathInt = 0;
            debug_assert!(!input.is_empty());
            let mut kind = Tag::Static;
            let end = (input.len() - 1) as u32;
            while (offset as u32) < end {
                let pattern: Pattern = match Pattern::init_unhashed(input, offset) {
                    Ok(p) => p,
                    Err(err) => {
                        let source = bun_ast::Source::init_empty_file(input);
                        match err {
                            PatternParseError::CatchAllMustBeAtTheEnd => {
                                log.add_error_fmt(
                                    Some(&source),
                                    bun_ast::Loc::EMPTY,
                                    format_args!("Catch-all route must be at the end of the path"),
                                );
                            }
                            PatternParseError::InvalidCatchAllRoute => {
                                log.add_error_fmt(
                                    Some(&source),
                                    bun_ast::Loc::EMPTY,
                                    format_args!(
                                        "Invalid catch-all route, e.g. should be [...param]"
                                    ),
                                );
                            }
                            PatternParseError::InvalidOptionalCatchAllRoute => {
                                log.add_error_fmt(
                                    Some(&source),
                                    bun_ast::Loc::EMPTY,
                                    format_args!(
                                        "Invalid optional catch-all route, e.g. should be [[...param]]"
                                    ),
                                );
                            }
                            PatternParseError::InvalidRoutePattern => {
                                log.add_error_fmt(
                                    Some(&source),
                                    bun_ast::Loc::EMPTY,
                                    format_args!("Invalid dynamic route"),
                                );
                            }
                            PatternParseError::MissingParamName => {
                                log.add_error_fmt(
                                    Some(&source),
                                    bun_ast::Loc::EMPTY,
                                    format_args!("Route is missing a parameter name, e.g. [param]"),
                                );
                            }
                            PatternParseError::PatternMissingClosingBracket => {
                                log.add_error_fmt(
                                    Some(&source),
                                    bun_ast::Loc::EMPTY,
                                    format_args!("Route is missing a closing bracket]"),
                                );
                            }
                        }
                        return None;
                    }
                };
                offset = pattern.len;
                let tag = pattern.value.tag();
                if (tag as u8) > (kind as u8) {
                    kind = tag;
                }
                count += u16::from((tag as u8) > (Tag::Static as u8));
            }

            Some(ValidationResult {
                param_count: count,
                kind,
            })
        }

        pub(crate) fn init(
            input: &[u8],
            offset_: RoutePathInt,
        ) -> Result<Pattern, PatternParseError> {
            Self::init_maybe_hash::<true>(input, offset_)
        }

        pub(crate) fn is_end(self, input: &[u8]) -> bool {
            self.len as usize >= input.len() - 1
        }

        pub(crate) fn init_unhashed(
            input: &[u8],
            offset_: RoutePathInt,
        ) -> Result<Pattern, PatternParseError> {
            Self::init_maybe_hash::<false>(input, offset_)
        }

        #[inline]
        fn init_maybe_hash<const DO_HASH: bool>(
            input: &[u8],
            offset_: RoutePathInt,
        ) -> Result<Pattern, PatternParseError> {
            let init_hashed_string = if DO_HASH {
                HashedString::init
            } else {
                HashedString::init_no_hash
            };

            let mut offset: RoutePathInt = offset_;

            while input.len() > offset as usize && input[offset as usize] == b'/' {
                offset += 1;
            }

            if input.is_empty() || input.len() <= offset as usize {
                return Ok(Pattern {
                    value: Value::Static(HashedString::EMPTY),
                    len: input.len().min(offset as usize) as RoutePathInt,
                });
            }

            let mut i: RoutePathInt = offset;

            let end: RoutePathInt = u16::try_from(input.len() - 1).expect("route path fits in u16");

            if offset == end {
                return Ok(Pattern {
                    len: offset,
                    value: Value::Static(HashedString::EMPTY),
                });
            }

            while i <= end {
                match input[i as usize] {
                    b'/' => {
                        return Ok(Pattern {
                            len: (i + 1).min(end),
                            value: Value::Static(init_hashed_string(
                                &input[offset as usize..i as usize],
                            )),
                        });
                    }
                    b'[' => {
                        if i > offset {
                            return Ok(Pattern {
                                len: i,
                                value: Value::Static(init_hashed_string(
                                    &input[offset as usize..i as usize],
                                )),
                            });
                        }

                        let mut tag = Tag::Dynamic;

                        let mut param = TinyPtr::default();

                        i += 1;

                        param.set_offset(i);

                        if i >= end {
                            return Err(PatternParseError::InvalidRoutePattern);
                        }

                        match input[i as usize] {
                            b'/' | b']' => return Err(PatternParseError::MissingParamName),
                            b'[' => {
                                tag = Tag::OptionalCatchAll;

                                if end < i + 4 {
                                    return Err(PatternParseError::InvalidOptionalCatchAllRoute);
                                }

                                i += 1;

                                if !input[i as usize..].starts_with(b"...") {
                                    return Err(PatternParseError::InvalidOptionalCatchAllRoute);
                                }
                                i += 3;
                                param.set_offset(i);
                            }
                            b'.' => {
                                tag = Tag::CatchAll;
                                i += 1;

                                if end < i + 2 {
                                    return Err(PatternParseError::InvalidCatchAllRoute);
                                }

                                if !input[i as usize..].starts_with(b"..") {
                                    return Err(PatternParseError::InvalidCatchAllRoute);
                                }
                                i += 2;

                                param.set_offset(i);
                            }
                            _ => {}
                        }

                        i += 1;
                        while i <= end && input[i as usize] != b']' {
                            if input[i as usize] == b'/' {
                                return Err(PatternParseError::InvalidRoutePattern);
                            }
                            i += 1;
                        }

                        if i > end {
                            return Err(PatternParseError::PatternMissingClosingBracket);
                        }

                        param.set_len(i - param.offset());

                        i += 1;

                        if matches!(tag, Tag::OptionalCatchAll) {
                            if i > end || input[i as usize] != b']' {
                                return Err(PatternParseError::PatternMissingClosingBracket);
                            }
                            i += 1;
                        }

                        if (tag as u8) > (Tag::Dynamic as u8) && i <= end {
                            return Err(PatternParseError::CatchAllMustBeAtTheEnd);
                        }

                        return Ok(Pattern {
                            len: (i + 1).min(end),
                            value: match tag {
                                Tag::Dynamic => Value::Dynamic(param),
                                Tag::CatchAll => Value::CatchAll(param),
                                Tag::OptionalCatchAll => Value::OptionalCatchAll(param),
                                _ => unreachable!(),
                            },
                        });
                    }
                    _ => {}
                }
                i += 1;
            }
            Ok(Pattern {
                len: i,
                value: Value::Static(HashedString::init(&input[offset as usize..i as usize])),
            })
        }
    }

    #[derive(Clone, Copy, Default)]
    pub struct ValidationResult {
        pub(crate) param_count: u16,
        pub(crate) kind: Tag,
    }

    #[derive(strum::IntoStaticStr, Debug, Clone, Copy)]
    pub enum PatternParseError {
        CatchAllMustBeAtTheEnd,
        InvalidCatchAllRoute,
        InvalidOptionalCatchAllRoute,
        InvalidRoutePattern,
        MissingParamName,
        PatternMissingClosingBracket,
    }
    bun_core::impl_tag_error!(PatternParseError);

    #[repr(u8)]
    #[derive(Clone, Copy, PartialEq, Eq, Default, strum::IntoStaticStr)]
    pub enum Tag {
        #[default]
        Static = 0,
        Dynamic = 1,
        CatchAll = 2,
        OptionalCatchAll = 3,
    }

    #[derive(Clone, Copy, bun_core::EnumTag)]
    #[enum_tag(existing = Tag)]
    pub enum Value {
        Static(HashedString),
        Dynamic(TinyPtr),
        CatchAll(TinyPtr),
        OptionalCatchAll(TinyPtr),
    }
}

pub(crate) use pattern::Pattern;

// ──────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pattern_match() {
        type Entry = Param<'static>;

        let regular_list: &[(&[u8], &[u8], &[Entry])] = &[
            (b"404", b"404", &[]),
            (
                b"[teamSlug]",
                b"value",
                &[Entry {
                    name: b"teamSlug",
                    value: b"value",
                }],
            ),
            (
                b"hi/hello/[teamSlug]",
                b"hi/hello/123",
                &[Entry {
                    name: b"teamSlug",
                    value: b"123",
                }],
            ),
            (
                b"hi/[teamSlug]/hello",
                b"hi/123/hello",
                &[Entry {
                    name: b"teamSlug",
                    value: b"123",
                }],
            ),
            (
                b"[teamSlug]/hi/hello",
                b"123/hi/hello",
                &[Entry {
                    name: b"teamSlug",
                    value: b"123",
                }],
            ),
            (
                b"[teamSlug]/[project]",
                b"team/bacon",
                &[
                    Entry {
                        name: b"teamSlug",
                        value: b"team",
                    },
                    Entry {
                        name: b"project",
                        value: b"bacon",
                    },
                ],
            ),
            (
                b"lemon/[teamSlug]/[project]",
                b"lemon/team/bacon",
                &[
                    Entry {
                        name: b"teamSlug",
                        value: b"team",
                    },
                    Entry {
                        name: b"project",
                        value: b"bacon",
                    },
                ],
            ),
            (
                b"[teamSlug]/[project]/lemon",
                b"team/bacon/lemon",
                &[
                    Entry {
                        name: b"teamSlug",
                        value: b"team",
                    },
                    Entry {
                        name: b"project",
                        value: b"bacon",
                    },
                ],
            ),
            (
                b"[teamSlug]/lemon/[project]",
                b"team/lemon/lemon",
                &[
                    Entry {
                        name: b"teamSlug",
                        value: b"team",
                    },
                    Entry {
                        name: b"project",
                        value: b"lemon",
                    },
                ],
            ),
            (
                b"[teamSlug]/lemon/[...project]",
                b"team/lemon/lemon-bacon-cheese/wow/brocollini",
                &[
                    Entry {
                        name: b"teamSlug",
                        value: b"team",
                    },
                    Entry {
                        name: b"project",
                        value: b"lemon-bacon-cheese/wow/brocollini",
                    },
                ],
            ),
            (
                b"[teamSlug]/lemon/[project]/[[...slug]]",
                b"team/lemon/lemon/slugggg",
                &[
                    Entry {
                        name: b"teamSlug",
                        value: b"team",
                    },
                    Entry {
                        name: b"project",
                        value: b"lemon",
                    },
                    Entry {
                        name: b"slug",
                        value: b"slugggg",
                    },
                ],
            ),
        ];

        let optional_catch_all: &[(&[u8], &[u8], &[Entry])] = &[
            (b"404", b"404", &[]),
            (b"404/[[...slug]]", b"404", &[]),
            (b"404a/[[...slug]]", b"404a", &[]),
            (
                b"[teamSlug]/lemon/[project]/[[...slug]]",
                b"team/lemon/lemon/slugggg",
                &[
                    Entry {
                        name: b"teamSlug",
                        value: b"team",
                    },
                    Entry {
                        name: b"project",
                        value: b"lemon",
                    },
                    Entry {
                        name: b"slug",
                        value: b"slugggg",
                    },
                ],
            ),
        ];

        fn run(list: &[(&[u8], &[u8], &[Entry])]) -> usize {
            let mut parameters = route_param::List::default();
            let mut failures: usize = 0;
            for (pattern, pathname, entries) in list.iter() {
                parameters.clear();

                'fail: {
                    if !Pattern::match_::<true>(pathname, pattern, pattern, &mut parameters) {
                        eprintln!(
                            "Expected pattern \"{}\" to match \"{}\"",
                            bstr::BStr::new(pattern),
                            bstr::BStr::new(pathname)
                        );
                        failures += 1;
                        break 'fail;
                    }

                    if !entries.is_empty() {
                        for (i, p) in parameters.iter().enumerate() {
                            if p.name != entries[i].name {
                                failures += 1;
                                eprintln!(
                                    "{} -- Expected name \"{}\" but received \"{}\" for path {}",
                                    bstr::BStr::new(pattern),
                                    bstr::BStr::new(entries[i].name),
                                    bstr::BStr::new(parameters[i].name),
                                    bstr::BStr::new(pathname)
                                );
                                break 'fail;
                            }
                            if parameters[i].value != entries[i].value {
                                failures += 1;
                                eprintln!(
                                    "{} -- Expected value \"{}\" but received \"{}\" for path {}",
                                    bstr::BStr::new(pattern),
                                    bstr::BStr::new(entries[i].value),
                                    bstr::BStr::new(parameters[i].value),
                                    bstr::BStr::new(pathname)
                                );
                                break 'fail;
                            }
                        }
                    }

                    if parameters.len() != entries.len() {
                        eprintln!(
                            "Expected parameter count for \"{}\" to match \"{}\"",
                            bstr::BStr::new(pattern),
                            bstr::BStr::new(pathname)
                        );
                        failures += 1;
                        break 'fail;
                    }
                }
            }
            failures
        }

        assert!(run(regular_list) == 0);
        assert!(run(optional_catch_all) == 0);
    }

    // The route-loader integration tests ("Github
    // API Route Loader", "Sample Route Loader", "Routes Basic", "Dynamic
    // Routes") are not implemented: they assert through `ctx.matched_route`, which
    // `Router::match_` does not yet populate (the JavaScriptHandler enqueue
    // path is still commented out), and they consume fixture route lists that
    // live in the test-runner harness crate.

    #[test]
    fn pattern() {
        let pattern = b"[dynamic]/static/[dynamic2]/static2/[...catch_all]";

        let dynamic = Pattern::init(pattern, 0).unwrap();
        assert_eq!(<&str>::from(dynamic.value.tag()), "Dynamic");
        let static_ = Pattern::init(pattern, dynamic.len).unwrap();
        assert_eq!(<&str>::from(static_.value.tag()), "Static");
        let dynamic2 = Pattern::init(pattern, static_.len).unwrap();
        assert_eq!(<&str>::from(dynamic2.value.tag()), "Dynamic");
        let static2 = Pattern::init(pattern, dynamic2.len).unwrap();
        assert_eq!(<&str>::from(static2.value.tag()), "Static");
        let catch_all = Pattern::init(pattern, static2.len).unwrap();
        assert_eq!(<&str>::from(catch_all.value.tag()), "CatchAll");

        match dynamic.value {
            pattern::Value::Dynamic(p) => assert_eq!(p.str(pattern), b"dynamic"),
            _ => panic!(),
        }
        match static_.value {
            pattern::Value::Static(s) => assert_eq!(s.str(), b"static"),
            _ => panic!(),
        }
        match dynamic2.value {
            pattern::Value::Dynamic(p) => assert_eq!(p.str(pattern), b"dynamic2"),
            _ => panic!(),
        }
        match static2.value {
            pattern::Value::Static(s) => assert_eq!(s.str(), b"static2"),
            _ => panic!(),
        }
        match catch_all.value {
            pattern::Value::CatchAll(p) => assert_eq!(p.str(pattern), b"catch_all"),
            _ => panic!(),
        }
    }
}
