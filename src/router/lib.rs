#![warn(unused_must_use)]

// This is a Next.js-compatible file-system router.
// It uses the filesystem to infer entry points.
// Despite being Next.js-compatible, it's not tied to Next.js.
// It does not handle the framework parts of rendering pages.
// All it does is resolve URL paths to the appropriate entry point and parse URL params/query.
use core::cmp::Ordering;
use core::ptr::NonNull;

use bun_collections::StringHashMap;
use bun_core::{ZStr, strings};
use bun_paths::{MAX_PATH_BYTES, SEP, path_buffer_pool};
use bun_ptr::RawSlice;
use bun_sys::{E, FileKind};

use bun_http_types::URLPath::URLPath;

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

/// Bounds a route's name: a link adds to it and not to the path the walk opens, so no path length ends a chain of links.
const MAX_PUBLIC_PATH_LEN: usize = if MAX_PATH_BYTES < pattern::RoutePathInt::MAX as usize {
    MAX_PATH_BYTES
} else {
    pattern::RoutePathInt::MAX as usize
};

// TODO(b2-blocked): bun_collections::MultiArrayElement derive — proc-macro not
// yet landed, so MultiArrayList<RouteIndex> can't expose per-field column
// accessors. Hand-rolled SoA struct until the derive exists.
struct RouteIndexList {
    // The `Box` is load-bearing: `Routes::index` / `Routes::static_` hold
    // `NonNull<Route>` / `*const Route` into the box interiors; unboxing
    // would dangle them on `Vec` realloc.
    #[expect(clippy::vec_box)]
    route: Vec<Box<Route>>,
    /// Bytes of the route's own strings, as the next two columns are.
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

    /// The directory that every `Route::abs_path` outside a link is below, spelled like one, with a `/` at the end.
    dir: Box<[u8]>,
    /// Real path of the routes directory.
    real_dir: Box<[u8]>,
    /// For each directory the scan read: its path below the routes directory, then its real path if that is not `real_dir` and that path. A NUL ends each.
    scanned: Vec<u8>,
}

impl Routes {
    /// Reads `dir` and the tree below it from disk, never from a cache. `None`: there is no directory at `dir`.
    pub fn scan(
        dir: &[u8],
        extensions: &[Box<[u8]>],
        preserve_symlinks: bool,
        log: &mut bun_ast::Log,
    ) -> bun_sys::Result<Option<Routes>> {
        let root = match bun_sys::Dir::open(dir) {
            Ok(root) => root,
            Err(err) if is_absent(&err) => return Ok(None),
            Err(err) => return Err(err.with_path(dir)),
        };
        let real_dir: Box<[u8]> = {
            let mut buf = path_buffer_pool::get();
            Box::from(&*at_path(root.get_fd_path(&mut buf), dir)?)
        };
        let listing = match DirListing::read(root, dir) {
            Ok(listing) => listing,
            // Removed after it was opened.
            Err(err) if is_absent(&err) => return Ok(None),
            Err(err) => return Err(err),
        };

        // The resolver names a module below a link by the link only when it preserves links.
        let (path, real_path) = if preserve_symlinks && *real_dir != *dir {
            (dir.to_vec(), Some(real_dir.to_vec()))
        } else {
            (real_dir.to_vec(), None)
        };
        let mut routes_dir = path.clone();
        bun_paths::resolve_path::platform_to_posix_in_place(&mut routes_dir[..]);
        if routes_dir.last() != Some(&b'/') {
            routes_dir.push(b'/');
        }

        let mut loader = RouteLoader::new(extensions, preserve_symlinks, real_dir, log);
        loader.load(WalkedDir {
            listing,
            next: 0,
            path,
            real_path,
            public_dir_len: 0,
        })?;
        Ok(Some(loader.finish(routes_dir.into_boxed_slice())))
    }

    /// Every name of every directory the scan read: below `dir`, which is the routes directory as the caller names it, below its real path, and the directory's own real path.
    pub fn for_each_dir_name(&self, dir: &[u8], each: &mut dyn FnMut(&[u8])) {
        let roots = [dir, &*self.real_dir];
        let roots = &roots[..if *self.real_dir == *dir { 1 } else { 2 }];
        let mut name: Vec<u8> = Vec::new();
        let mut rest: &[u8] = &self.scanned;
        while !rest.is_empty() {
            let (below, after) = split_at_nul(rest);
            let (real_path, after) = split_at_nul(after);
            rest = after;
            for root in roots {
                name.clear();
                name.extend_from_slice(root);
                // The root of a file system ends with the separator that `below` starts with.
                let is_doubled = !below.is_empty() && root.ends_with(&[SEP]);
                name.extend_from_slice(&below[usize::from(is_doubled)..]);
                each(&name);
            }
            if !real_path.is_empty() {
                each(real_path);
            }
        }
    }

    #[inline]
    pub fn dir(&self) -> &[u8] {
        &self.dir
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
        url_path: &URLPath,
        params: &mut route_param::List<'p>,
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
            // A failed match can leave params behind.
            params.clear();
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

/// A directory the walk is inside of.
struct WalkedDir {
    listing: DirListing,
    /// The entry of `listing` that the walk loads next.
    next: usize,
    /// The path that the routes of this directory are named under.
    path: Vec<u8>,
    /// The real path, when `path` keeps the name of a link.
    real_path: Option<Vec<u8>>,
    /// How long `RouteLoader::public_dir` is for the entries of this directory.
    public_dir_len: usize,
}

impl WalkedDir {
    fn real_path(&self) -> &[u8] {
        self.real_path.as_deref().unwrap_or(&self.path)
    }
}

/// Whether `err` says that there is nothing at the path.
fn is_absent(err: &bun_sys::Error) -> bool {
    matches!(
        err.get_errno(),
        E::ENOENT | E::ENOTDIR | E::ELOOP | E::ENAMETOOLONG
    )
}

/// What an NFS server says for a directory that was removed. Windows has no such error.
#[cfg(not(windows))]
const STALE: E = E::ESTALE;
#[cfg(windows)]
const STALE: E = E::ENOENT;

/// `None` for an error that says a name is gone or may not be read, which the walk leaves out. Any other error ends the scan.
fn unless_skippable<T>(result: bun_sys::Result<T>) -> bun_sys::Result<Option<T>> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(err)
            if is_absent(&err)
                || matches!(err.get_errno(), STALE | E::EACCES | E::EPERM | E::EBUSY) =>
        {
            Ok(None)
        }
        Err(err) => Err(err),
    }
}

/// `result`, with an error that names `path`.
fn at_path<T>(result: bun_sys::Result<T>, path: &[u8]) -> bun_sys::Result<T> {
    result.map_err(|err| err.with_path(path))
}

/// `bytes` up to its first NUL, and what comes after that NUL.
fn split_at_nul(bytes: &[u8]) -> (&[u8], &[u8]) {
    let nul = strings::index_of_char_usize(bytes, 0).unwrap_or(bytes.len());
    (&bytes[..nul], bytes.get(nul + 1..).unwrap_or_default())
}

/// Where the link at `path` leads.
fn link_target<'b>(path: &ZStr, buf: &'b mut bun_paths::PathBuffer) -> bun_sys::Result<&'b [u8]> {
    // One `readlink`, of the descriptor. `realpath` does one for each directory of `path`.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let link = bun_sys::File::open(path, bun_sys::O::PATH | bun_sys::O::CLOEXEC, 0)?;
        bun_sys::get_fd_path(link.handle(), buf).map(|target| &*target)
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        bun_sys::realpath(path, buf)
    }
}

struct RouteLoader<'a> {
    extensions: &'a [Box<[u8]>],
    preserve_symlinks: bool,
    real_dir: Box<[u8]>,
    log: &'a mut bun_ast::Log,

    /// The directory being read, below the routes directory: empty, or `/blog/[slug]`.
    public_dir: Vec<u8>,
    /// The path of the route file being read.
    path: Vec<u8>,
    /// What becomes `Routes::scanned`.
    scanned: Vec<u8>,

    /// Match name of a dynamic route to its place in `all_routes`.
    dedupe_dynamic: StringHashMap<usize>,
    /// The place of the index route in `all_routes`.
    index: Option<usize>,
    static_list: StringHashMap<*const Route>,
    // `Box` is load-bearing: `static_list` above holds raw pointers
    // into the box interiors; unboxing would dangle them on `Vec` realloc.
    #[expect(clippy::vec_box)]
    all_routes: Vec<Box<Route>>,
}

impl<'a> RouteLoader<'a> {
    fn new(
        extensions: &'a [Box<[u8]>],
        preserve_symlinks: bool,
        real_dir: Box<[u8]>,
        log: &'a mut bun_ast::Log,
    ) -> Self {
        RouteLoader {
            extensions,
            preserve_symlinks,
            real_dir,
            log,
            public_dir: Vec::new(),
            path: Vec::new(),
            // The routes directory: no path below itself, and no other real path.
            scanned: vec![0, 0],
            dedupe_dynamic: StringHashMap::new(),
            index: None,
            static_list: StringHashMap::new(),
            all_routes: Vec::new(),
        }
    }

    /// Records that the directory at `public_dir`, whose real path is `real_path`, was read.
    fn record(&mut self, real_path: &[u8]) {
        let start = self.scanned.len();
        self.scanned.extend_from_slice(&self.public_dir);
        bun_paths::resolve_path::posix_to_platform_in_place(&mut self.scanned[start..]);
        let is_below_real_dir =
            real_path.strip_prefix(&*self.real_dir) == Some(&self.scanned[start..]);
        self.scanned.push(0);
        if !is_below_real_dir {
            self.scanned.extend_from_slice(real_path);
        }
        self.scanned.push(0);
    }

    fn append_route(&mut self, route: Route) {
        // /index.js
        if route.is_index() {
            // Of several index files, the first of the walk is the index route.
            if self.index.is_none() {
                self.index = Some(self.all_routes.len());
                self.all_routes.push(Box::new(route));
            }
            return;
        }

        // static route
        if route.param_count == 0 {
            if let Some(existing) = self.static_list.get(route.match_name()) {
                // SAFETY: *existing aliases a Box<Route> in self.all_routes
                Self::add_duplicate_error(self.log, &route, unsafe { &**existing });
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
                self.static_list
                    .put_assume_capacity(&new_route.name()[1..], new_route_ptr);
            }

            self.static_list
                .put_assume_capacity(new_route.match_name(), new_route_ptr);
            self.all_routes.push(new_route);

            return;
        }

        if let Some(&existing) = self.dedupe_dynamic.get(route.match_name()) {
            Self::add_duplicate_error(self.log, &route, &self.all_routes[existing]);
            return;
        }
        self.dedupe_dynamic
            .put_assume_capacity(route.match_name(), self.all_routes.len());
        self.all_routes.push(Box::new(route));
    }

    fn add_duplicate_error(log: &mut bun_ast::Log, route: &Route, existing: &Route) {
        let source = bun_ast::Source::init_empty_file(route.abs_path());
        log.add_error_fmt(
            Some(&source),
            bun_ast::Loc::EMPTY,
            format_args!(
                "Route \"{}\" is already defined by {}",
                bstr::BStr::new(route.name()),
                bstr::BStr::new(existing.abs_path()),
            ),
        );
    }

    fn finish(mut self, dir: Box<[u8]>) -> Routes {
        // The sort moves the boxes, and not what is in them.
        let index = self
            .index
            .map(|at| NonNull::from(&mut *self.all_routes[at]));
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

            if route.is_index() {
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
            index,
            dir,
            real_dir: self.real_dir,
            scanned: self.scanned,
        }
    }

    /// Loads the routes of `root` and of the directories below it, depth first.
    fn load(&mut self, root: WalkedDir) -> bun_sys::Result<()> {
        // Not the call stack: the tree on disk decides how deep this goes.
        let mut walked = vec![root];
        while let Some(top) = walked.len().checked_sub(1) {
            let next = walked[top].next;
            walked[top].next += 1;
            let Some(entry) = walked[top].listing.get(next) else {
                walked.pop();
                if let Some(parent) = walked.last() {
                    self.public_dir.truncate(parent.public_dir_len);
                }
                continue;
            };

            let public_path_len = self.public_dir.len() + 1 + entry.name.len();
            match entry.kind {
                EntryKind::Dir => {
                    if BANNED_DIRS.contains(&entry.name) || public_path_len >= MAX_PUBLIC_PATH_LEN {
                        continue;
                    }

                    let mut path = Vec::new();
                    join_path(&mut path, &walked[top].path, entry.name);
                    let Some(child) = unless_skippable(at_path(bun_sys::Dir::open(&path), &path))?
                    else {
                        continue;
                    };
                    let mut real_path = walked[top].real_path.as_ref().map(|parent| {
                        let mut real_path = Vec::new();
                        join_path(&mut real_path, parent, entry.name);
                        real_path
                    });
                    self.public_dir.push(b'/');
                    self.public_dir.extend_from_slice(entry.name);
                    let listing = 'read: {
                        if entry.is_link {
                            let mut buf = path_buffer_pool::get();
                            let Some(target) =
                                unless_skippable(at_path(child.get_fd_path(&mut buf), &path))?
                            else {
                                break 'read None;
                            };
                            // The resolver can have a record of the link under the real path of the directory it is in.
                            self.record(real_path.as_deref().unwrap_or(&path));
                            // A link to a directory the walk is inside of would never end.
                            if walked.iter().any(|dir| dir.real_path() == &*target) {
                                break 'read None;
                            }
                            if self.preserve_symlinks {
                                real_path = Some(target.to_vec());
                            } else {
                                path.clear();
                                path.extend_from_slice(target);
                            }
                        }
                        unless_skippable(DirListing::read(child, &path))?
                    };
                    let Some(listing) = listing else {
                        self.public_dir.truncate(walked[top].public_dir_len);
                        continue;
                    };
                    self.record(real_path.as_deref().unwrap_or(&path));
                    walked.push(WalkedDir {
                        listing,
                        next: 0,
                        path,
                        real_path,
                        public_dir_len: self.public_dir.len(),
                    });
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

                    join_path(&mut self.path, &walked[top].path, entry.name);
                    if self.path.len() >= MAX_PATH_BYTES {
                        self.log.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "ENAMETOOLONG opening route: {}",
                                bstr::BStr::new(&self.path)
                            ),
                        );
                        continue;
                    }
                    if public_path_len >= MAX_PUBLIC_PATH_LEN {
                        continue;
                    }
                    // Only a link needs the file system to say where it leads.
                    if entry.is_link {
                        self.path.push(0);
                        let link = ZStr::from_buf(&self.path, self.path.len() - 1);
                        let mut buf = path_buffer_pool::get();
                        let Some(target) = unless_skippable(at_path(
                            link_target(link, &mut buf),
                            link.as_bytes(),
                        ))?
                        else {
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

                EntryKind::Other => {}
            }
        }
        Ok(())
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

    /// Whether this is the route of an index file in the routes directory, which is `/`.
    #[inline]
    fn is_index(&self) -> bool {
        self.name_len == 1
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

        // `/foo/index.ts` has the name `/foo`, and `/foo/bar.tsx` has the name `/foo/bar`.
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
        bun_paths::resolve_path::platform_to_posix_in_place(&mut strings[abs_path_start..]);

        Some(Route {
            strings: strings.into_boxed_slice(),
            name_len: name_len as u32,
            match_name_start: match_name.start as u32,
            match_name_end: match_name.end as u32,
            abs_path_start: abs_path_start as u32,
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
    pub query_string: &'a [u8],
}

// ──────────────────────────────────────────────────────────────────────────
// Directory listing
// ──────────────────────────────────────────────────────────────────────────

/// What a name in a directory is, or what a link with that name leads to.
#[derive(Clone, Copy, PartialEq, Eq)]
enum EntryKind {
    File,
    Dir,
    /// Not a route and not walked: a link to nothing, a FIFO, a name that may not be read.
    Other,
}

#[derive(Clone, Copy)]
struct DirListingEntry<'a> {
    name: &'a [u8],
    kind: EntryKind,
    is_link: bool,
}

#[derive(Clone, Copy)]
struct ListedName {
    start: usize,
    len: u32,
    kind: EntryKind,
    is_link: bool,
}

/// The names in one directory, read from disk, one for each name without ASCII case, in the order of those.
struct DirListing {
    names: Vec<u8>,
    entries: Vec<ListedName>,
}

impl DirListing {
    /// Closes `dir`, so that the walk has one directory open at a time. An error names `path` or the entry.
    fn read(dir: bun_sys::Dir, path: &[u8]) -> bun_sys::Result<DirListing> {
        let mut names: Vec<u8> = Vec::new();
        let mut entries: Vec<ListedName> = Vec::new();
        let mut iterator = bun_sys::iterate_dir(dir.fd());
        while let Some(entry) = at_path(iterator.next(), path)? {
            let name = entry.name.slice_u8();
            if name.first() == Some(&b'.') {
                continue;
            }
            let (kind, is_link) = match entry.kind {
                FileKind::File => (EntryKind::File, false),
                FileKind::Directory => (EntryKind::Dir, false),
                // `Unknown`: the file system does not say what the name is.
                FileKind::SymLink | FileKind::Unknown => {
                    unless_skippable(Self::follow(&dir, &entry))
                        .map_err(|err| {
                            let mut entry_path = Vec::new();
                            join_path(&mut entry_path, path, name);
                            err.with_path(&entry_path)
                        })?
                        .unwrap_or((EntryKind::Other, false))
                }
                // A FIFO, socket or device.
                _ => (EntryKind::Other, false),
            };
            entries.push(ListedName {
                start: names.len(),
                len: name.len() as u32,
                kind,
                is_link,
            });
            names.extend_from_slice(name);
        }
        drop(dir);

        Self::sort(&names, &mut entries);
        Ok(DirListing { names, entries })
    }

    /// Keeps, of the names that are one name without ASCII case, the one read last: the module resolver's listing has that one.
    fn sort(names: &[u8], entries: &mut Vec<ListedName>) {
        let name = |entry: &ListedName| &names[entry.start..][..entry.len as usize];
        let folded = |entry: &ListedName| name(entry).iter().map(u8::to_ascii_lowercase);
        index_sort::sort_slice_unstable_by(entries, |a, b| {
            folded(a).cmp(folded(b)).then(b.start.cmp(&a.start))
        });
        entries.dedup_by(|later, kept| name(later).eq_ignore_ascii_case(name(kept)));
    }

    /// What a link or a name of no known kind is, and whether it is a link.
    fn follow(
        dir: &bun_sys::Dir,
        entry: &bun_sys::dir_iterator::IteratorResult,
    ) -> bun_sys::Result<(EntryKind, bool)> {
        let mut is_link = entry.kind == FileKind::SymLink;
        // On Windows a link says what it stands for.
        if is_link && let Some(is_dir) = entry.link_is_directory() {
            let kind = if is_dir {
                EntryKind::Dir
            } else {
                EntryKind::File
            };
            return Ok((kind, true));
        }

        // Asked with a stat and not an open: the open of a FIFO does not return.
        let mut buf = path_buffer_pool::get();
        let name = bun_paths::resolve_path::z(entry.name.slice_u8(), &mut buf);
        let mut kind = FileKind::SymLink;
        if !is_link {
            kind =
                bun_sys::kind_from_mode(bun_sys::lstatat(dir.fd(), name)?.st_mode as bun_sys::Mode);
            is_link = kind == FileKind::SymLink;
        }
        if is_link {
            kind =
                bun_sys::kind_from_mode(bun_sys::fstatat(dir.fd(), name)?.st_mode as bun_sys::Mode);
        }
        Ok(match kind {
            FileKind::File => (EntryKind::File, is_link),
            FileKind::Directory => (EntryKind::Dir, is_link),
            _ => (EntryKind::Other, is_link),
        })
    }

    fn get(&self, index: usize) -> Option<DirListingEntry<'_>> {
        let entry = self.entries.get(index)?;
        Some(DirListingEntry {
            name: &self.names[entry.start..][..entry.len as usize],
            kind: entry.kind,
            is_link: entry.is_link,
        })
    }
}

/// `dir`, a separator and `name`, byte for byte: a normalizing join would rewrite a name.
fn join_path(out: &mut Vec<u8>, dir: &[u8], name: &[u8]) {
    out.clear();
    out.reserve(dir.len() + 1 + name.len());
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

    pub(crate) type RoutePathInt = u16;

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

    // `cargo test -p bun_router` links no highway kernel, so the two these tests reach are scalar stubs (Miri calls neither).

    /// Returns `haystack_len` when `needle` does not occur, like the kernel.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn highway_index_of_char(
        haystack: *const u8,
        haystack_len: usize,
        needle: u8,
    ) -> usize {
        // SAFETY: test stub; callers pass a valid (ptr, len) pair.
        let haystack = unsafe { core::slice::from_raw_parts(haystack, haystack_len) };
        haystack
            .iter()
            .position(|&b| b == needle)
            .unwrap_or(haystack_len)
    }

    /// `n` when `c` does not occur, like the kernel.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn highway_last_index_of_char(h: *const u8, n: usize, c: u8) -> usize {
        // SAFETY: test stub; callers pass a valid (ptr, len) pair.
        let h = unsafe { core::slice::from_raw_parts(h, n) };
        h.iter().rposition(|&b| b == c).unwrap_or(n)
    }

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

    /// The table a scan makes of `files` (directory below the routes directory, name) in the walk's order, and its errors.
    fn table(files: &[(&[u8], &[u8])], extensions: &[&[u8]]) -> (Routes, Vec<Vec<u8>>) {
        let extensions: Vec<Box<[u8]>> = extensions.iter().map(|e| Box::from(*e)).collect();
        let mut log = bun_ast::Log::new();
        let real_dir = Box::from(b"/pages".as_slice());
        let mut loader = RouteLoader::new(&extensions, false, real_dir, &mut log);
        for (public_dir, base) in files {
            let extname = bun_paths::extension(base);
            let abs_path = [b"/pages", *public_dir, b"/", *base].concat();
            if let Some(route) = Route::parse(base, extname, &abs_path, public_dir, loader.log) {
                loader.append_route(route);
            }
        }
        let routes = loader.finish(Box::from(b"/pages/".as_slice()));
        let errors = log.msgs.iter().map(|msg| msg.data.text.to_vec()).collect();
        (routes, errors)
    }

    /// The name and file of the route that `path` matches, and the parameters.
    fn match_of<'p>(
        routes: &'p Routes,
        path: &'p [u8],
    ) -> Option<(&'p [u8], &'p [u8], Vec<(&'p [u8], &'p [u8])>)> {
        let url_path = bun_http_types::URLPath::parse(path).unwrap();
        let mut params = route_param::List::default();
        let matched = routes.match_page_with_allocator(&url_path, &mut params)?;
        let params = params
            .iter()
            .map(|param| (param.name, param.value))
            .collect();
        Some((matched.name, matched.file_path, params))
    }

    #[test]
    fn route_table() {
        let (routes, errors) = table(
            &[
                (b"", b"About.tsx"),
                (b"", b"[ID].tsx"),
                (b"", b"[id].tsx"),
                (b"", b"a.ts"),
                (b"", b"a.tsx"),
                (b"", b"about.tsx"),
                (b"", b"b.tsx"),
                (b"/docs", b"[...rest].tsx"),
                (b"", b"e.tsx"),
                (b"", b"index.ts"),
                (b"", b"index.tsx"),
                (b"/opt", b"[[...all]].tsx"),
                (b"/posts", b"[slug].tsx"),
                (b"/posts", b"index.tsx"),
                (b"/posts", b"new.tsx"),
            ],
            &[b"tsx", b"ts"],
        );

        // The second file of a route name is an error, also when the names differ in case.
        assert_eq!(
            errors,
            [
                b"Route \"/[id]\" is already defined by /pages/[ID].tsx".to_vec(),
                b"Route \"/a\" is already defined by /pages/a.ts".to_vec(),
                b"Route \"/about\" is already defined by /pages/About.tsx".to_vec(),
            ]
        );
        let mut listed: Vec<(&[u8], &[u8])> = routes.iter().collect();
        listed.sort_unstable();
        assert_eq!(
            listed,
            [
                (b"/".as_slice(), b"/pages/index.ts".as_slice()),
                (b"/About", b"/pages/About.tsx"),
                (b"/[ID]", b"/pages/[ID].tsx"),
                (b"/a", b"/pages/a.ts"),
                (b"/b", b"/pages/b.tsx"),
                (b"/docs/[...rest]", b"/pages/docs/[...rest].tsx"),
                (b"/e", b"/pages/e.tsx"),
                (b"/opt/[[...all]]", b"/pages/opt/[[...all]].tsx"),
                (b"/posts", b"/pages/posts/index.tsx"),
                (b"/posts/[slug]", b"/pages/posts/[slug].tsx"),
                (b"/posts/new", b"/pages/posts/new.tsx"),
            ]
        );

        let name_of = |path: &'static [u8]| match_of(&routes, path).map(|(name, _, _)| name);
        assert_eq!(name_of(b"/"), Some(b"/".as_slice()));
        assert_eq!(name_of(b"/a"), Some(b"/a".as_slice()));
        assert_eq!(name_of(b"/About"), Some(b"/About".as_slice()));
        assert_eq!(name_of(b"/about"), Some(b"/About".as_slice()));
        assert_eq!(name_of(b"/posts"), Some(b"/posts".as_slice()));
        assert_eq!(name_of(b"/posts/new"), Some(b"/posts/new".as_slice()));
        assert_eq!(name_of(b"/none/of/them"), None);
        assert_eq!(
            match_of(&routes, b"/posts/hello?x=1"),
            Some((
                b"/posts/[slug]".as_slice(),
                b"/pages/posts/[slug].tsx".as_slice(),
                vec![(b"slug".as_slice(), b"hello".as_slice())]
            ))
        );
        assert_eq!(
            match_of(&routes, b"/42"),
            Some((
                b"/[ID]".as_slice(),
                b"/pages/[ID].tsx".as_slice(),
                vec![(b"ID".as_slice(), b"42".as_slice())]
            ))
        );
        assert_eq!(
            match_of(&routes, b"/docs/a/b"),
            Some((
                b"/docs/[...rest]".as_slice(),
                b"/pages/docs/[...rest].tsx".as_slice(),
                vec![(b"rest".as_slice(), b"a/b".as_slice())]
            ))
        );
        assert_eq!(
            match_of(&routes, b"/opt/x/y"),
            Some((
                b"/opt/[[...all]]".as_slice(),
                b"/pages/opt/[[...all]].tsx".as_slice(),
                vec![(b"all".as_slice(), b"x/y".as_slice())]
            ))
        );
    }

    #[test]
    fn listing_has_one_entry_for_a_name_without_case() {
        // As a directory returns them. A file system can return one name twice.
        let read: [&[u8]; 6] = [b"b.tsx", b"A.tsx", b"sub", b"a.tsx", b"B.TSX", b"a.tsx"];
        let mut names: Vec<u8> = Vec::new();
        let mut entries: Vec<ListedName> = Vec::new();
        for name in read {
            entries.push(ListedName {
                start: names.len(),
                len: name.len() as u32,
                kind: EntryKind::File,
                is_link: false,
            });
            names.extend_from_slice(name);
        }
        DirListing::sort(&names, &mut entries);
        let listing = DirListing { names, entries };
        let kept: Vec<(&[u8], usize)> = listing
            .entries
            .iter()
            .enumerate()
            .map(|(i, entry)| (listing.get(i).unwrap().name, entry.start))
            .collect();
        assert_eq!(
            kept,
            [(b"a.tsx".as_slice(), 23), (b"B.TSX", 18), (b"sub", 10)]
        );
    }

    #[test]
    fn errors_that_leave_a_name_out() {
        let error = |errno| bun_sys::Error::from_code(errno, bun_sys::Tag::open);
        for errno in [
            E::ENOENT,
            E::ENOTDIR,
            E::ELOOP,
            E::ENAMETOOLONG,
            STALE,
            E::EACCES,
            E::EPERM,
            E::EBUSY,
        ] {
            assert!(matches!(
                unless_skippable::<()>(Err(error(errno))),
                Ok(None)
            ));
        }
        for errno in [E::EMFILE, E::ENFILE, E::ENOMEM, E::EIO, E::ENODEV, E::EBADF] {
            let result = unless_skippable::<()>(at_path(Err(error(errno)), b"/pages/sub"));
            let err = result.unwrap_err();
            assert_eq!(
                (err.get_errno(), &*err.path),
                (errno, b"/pages/sub".as_slice())
            );
        }
        assert!(matches!(unless_skippable(Ok(1)), Ok(Some(1))));
    }

    #[test]
    fn names_of_the_directories_of_a_scan() {
        let names = |real_dir: &[u8], dir: &[u8], read: &[(&[u8], &[u8])]| {
            let mut log = bun_ast::Log::new();
            let mut loader = RouteLoader::new(&[], false, Box::from(real_dir), &mut log);
            for (public_dir, real_path) in read {
                loader.public_dir = public_dir.to_vec();
                loader.record(real_path);
            }
            let routes = loader.finish(Box::default());
            let mut names: Vec<Vec<u8>> = Vec::new();
            routes.for_each_dir_name(dir, &mut |name| names.push(name.to_vec()));
            names
        };
        let sep = |path: &[u8]| -> Vec<u8> {
            path.iter()
                .map(|byte| if *byte == b'/' { SEP } else { *byte })
                .collect()
        };
        let all =
            |paths: &[&[u8]]| -> Vec<Vec<u8>> { paths.iter().map(|path| sep(path)).collect() };

        // No link: one name for each directory.
        assert_eq!(
            names(
                &sep(b"/app/pages"),
                &sep(b"/app/pages"),
                &[
                    (b"/blog", &sep(b"/app/pages/blog")),
                    (b"/blog/[slug]", &sep(b"/app/pages/blog/[slug]"))
                ],
            ),
            all(&[b"/app/pages", b"/app/pages/blog", b"/app/pages/blog/[slug]"])
        );
        // `dir` through a link, and a link below it: each name that leads to the directory.
        assert_eq!(
            names(
                &sep(b"/real/pages"),
                &sep(b"/link/pages"),
                &[
                    (b"/ln", &sep(b"/elsewhere")),
                    (b"/ln/deep", &sep(b"/elsewhere/deep"))
                ],
            ),
            all(&[
                b"/link/pages",
                b"/real/pages",
                b"/link/pages/ln",
                b"/real/pages/ln",
                b"/elsewhere",
                b"/link/pages/ln/deep",
                b"/real/pages/ln/deep",
                b"/elsewhere/deep",
            ])
        );
        // The root of a file system ends with a separator.
        let root = sep(b"/");
        assert_eq!(
            names(&root, &root, &[(b"/sub", &sep(b"/sub"))]),
            all(&[b"/", b"/sub", b"/sub"])
        );
    }

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
