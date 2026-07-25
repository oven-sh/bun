#![warn(unused_must_use)]

pub mod error;
pub use error::{Error, Result};

// This is a Next.js-compatible file-system router.
// It uses the filesystem to infer entry points.
// Despite being Next.js-compatible, it's not tied to Next.js.
// It does not handle the framework parts of rendering pages.
// All it does is resolve URL paths to the appropriate entry point and parse URL params/query.
use core::cmp::Ordering;
use core::ptr::NonNull;
use std::cell::RefCell;

use bun_collections::{ArrayHashMap, StringHashMap};
use bun_core::strings;
use bun_paths::{self, PathBuffer, SEP, SEP_STR};

use bun_http_types::URLPath::URLPath;

// ──────────────────────────────────────────────────────────────────────────
// Cross-crate name aliases. These are pure re-exports of real lower-tier types
// (no shadow structs); kept as a private module so the aliased paths
// (`bun_ast::Log`, `Fs::Entry`) read naturally.
// ──────────────────────────────────────────────────────────────────────────
// Wyhash with seed 0. NOT Wyhash11 (different algo).
#[inline]
fn wyhash(input: &[u8]) -> u64 {
    bun_wyhash::hash(input)
}

// `bun.fs` namespace — `bun_router` depends on `bun_resolver` directly, so
// name the real `FileSystem` / `Entry` / `DirEntry` / `DirnameStore` types.
use bun_resolver::DirInfo;
use bun_resolver::DirInfoRef;
use bun_resolver::fs as Fs;
use bun_resolver::fs::FileSystem;

type CoreError = crate::Error;

use bun_core::HashedString;
use bun_ptr::Interned;

// ──────────────────────────────────────────────────────────────────────────
// cross-tier decoupling
// ──────────────────────────────────────────────────────────────────────────

// Defined here so T4 router is self-contained; `bun_bundler::options` re-exports
// this (`pub use bun_router::RouteConfig`) so the original path keeps resolving.
#[derive(Debug, Clone, Default)]
pub struct RouteConfig {
    pub dir: Box<[u8]>,

    /// Frameworks like Next.js (and others) use a special prefix for bundled/transpiled assets.
    /// This is combined with "origin" when printing import paths.
    pub asset_prefix_path: Box<[u8]>,

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
// (DirnameStore-backed) and `value` borrows the *request URL buffer*, so the
// correct representation is a borrowed `&'a [u8]`, not a forged `'static`.
//
// `bun_url::route_param::Param<'a>` is now lifetime-generic (TYPE_ONLY
// move-down landed); collapse the local copy to a re-export so the param list
// type matches `PathnameScanner::init`.
pub use bun_url::route_param;
pub use route_param::Param;

pub struct Router<'a> {
    pub routes: Routes,
    pub loaded_routes: bool,
    // allocator dropped — global mimalloc
    pub fs: &'a FileSystem,
    pub config: RouteConfig,
}

impl<'a> Router<'a> {
    pub fn init(fs: &'a FileSystem, config: RouteConfig) -> Result<Router<'a>, CoreError> {
        Ok(Router {
            routes: Routes {
                static_: StringHashMap::new(),
                ..Routes::default()
            },
            loaded_routes: false,
            fs,
            config,
        })
    }

    pub fn get_entry_points(&self) -> &[&'static [u8]] {
        self.routes.list.items_filepath()
    }

    pub fn get_names(&self) -> &[&'static [u8]] {
        self.routes.list.items_name()
    }

    // This loads routes recursively, in depth-first order.
    // it does not currently handle duplicate exact route matches. that's undefined behavior, for now.
    pub fn load_routes<R: ResolverLike>(
        &mut self,
        log: &mut bun_ast::Log,
        root_dir_info: &DirInfo,
        resolver: &mut R,
        base_dir: &[u8],
    ) -> Result<(), CoreError> {
        if self.loaded_routes {
            return Ok(());
        }
        self.routes =
            RouteLoader::load_all(self.config.clone(), log, resolver, root_dir_info, base_dir);
        self.loaded_routes = true;
        Ok(())
    }
}

pub const BANNED_DIRS: [&[u8]; 1] = [b"node_modules"];

struct RouteIndex {
    route: Box<Route>,
    name: &'static [u8],
    match_name: &'static [u8],
    filepath: &'static [u8],
}

// TODO(b2-blocked): bun_collections::MultiArrayElement derive — proc-macro not
// yet landed, so MultiArrayList<RouteIndex> can't expose per-field column
// accessors. Hand-rolled SoA struct until the derive exists.
#[derive(Default)]
pub struct RouteIndexList {
    // The `Box` is load-bearing: `Routes::index` / `Routes::static_` hold
    // `NonNull<Route>` / `*const Route` into the box interiors; unboxing
    // would dangle them on `Vec` realloc.
    #[expect(clippy::vec_box)]
    route: Vec<Box<Route>>,
    name: Vec<&'static [u8]>,
    match_name: Vec<&'static [u8]>,
    filepath: Vec<&'static [u8]>,
}

impl RouteIndexList {
    pub fn set_capacity(&mut self, cap: usize) -> Result<(), CoreError> {
        self.route.reserve_exact(cap);
        self.name.reserve_exact(cap);
        self.match_name.reserve_exact(cap);
        self.filepath.reserve_exact(cap);
        Ok(())
    }
    pub(crate) fn push(&mut self, item: RouteIndex) {
        self.route.push(item.route);
        self.name.push(item.name);
        self.match_name.push(item.match_name);
        self.filepath.push(item.filepath);
    }
    #[inline]
    pub fn len(&self) -> usize {
        self.route.len()
    }
    #[inline]
    pub fn items_route(&self) -> &[Box<Route>] {
        &self.route
    }
    #[inline]
    pub fn items_name(&self) -> &[&'static [u8]] {
        &self.name
    }
    #[inline]
    pub fn items_match_name(&self) -> &[&'static [u8]] {
        &self.match_name
    }
    #[inline]
    pub fn items_filepath(&self) -> &[&'static [u8]] {
        &self.filepath
    }
}

pub struct Routes {
    pub list: RouteIndexList,
    /// Index into `list`'s columns where dynamic routes begin (sorted after
    /// static). Stored as an offset+len instead of materialized slices to avoid
    /// a self-referential struct; we re-slice on each `match_dynamic` call.
    pub dynamic_start: Option<usize>,
    pub dynamic_len: usize,

    /// completely static children of indefinite depth
    /// `"blog/posts"`
    /// `"dashboard"`
    /// `"profiles"`
    /// this is a fast path?
    pub static_: StringHashMap<*const Route>,

    /// Corresponds to "index.js" on the filesystem.
    /// A raw pointer co-owned with `list` (points into a `Box<Route>` owned by
    /// `list.route`). Stored as `NonNull` (not `&'a Route`) so `Routes` claims
    /// no borrow it doesn't actually take; matches `static_` above.
    pub index: Option<NonNull<Route>>,
}

impl Default for Routes {
    fn default() -> Self {
        Self {
            list: RouteIndexList::default(),
            dynamic_start: None,
            dynamic_len: 0,
            static_: StringHashMap::new(),
            index: None,
        }
    }
}

impl Routes {
    pub fn match_page_with_allocator<'p>(
        &mut self,
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
                    name: index.name,
                    pathname: url_path.pathname,
                    file_path: index.abs_path.as_bytes(),
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
                name: route.name,
                pathname: url_path.pathname,
                file_path: route.abs_path.as_bytes(),
                query_string: url_path.query_string,
            });
        }

        None
    }

    fn match_dynamic<'p>(
        &self,
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
        &self,
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

struct RouteLoader<'a> {
    // allocator dropped — global mimalloc
    fs: &'static FileSystem,
    config: RouteConfig,
    route_dirname_len: u16,

    dedupe_dynamic: ArrayHashMap<u32, &'static [u8]>,
    log: &'a mut bun_ast::Log,
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
    pub(crate) fn append_route(&mut self, route: Route) {
        use bun_collections::hash_map::Entry;

        // /index.js
        if route.full_hash == INDEX_ROUTE_HASH {
            // Derived from a `&mut`, not a `&*` downgrade: `NonNull::from(&T)`
            // yields a frozen tag. Today `index` is only read through (`match_`
            // takes `as_ref()`), so the old spelling was not live UB, but it was
            // one write away from it. The static arm below needs no such change:
            // `&raw const *box` forms no reference at all. Parking the `Box`
            // before deriving is belt-and-braces.
            self.all_routes.push(Box::new(route));
            let parked = self.all_routes.last_mut().expect("just pushed");
            // Box contents have a stable address; never removed from
            // `all_routes` until consumed by `load_all`.
            self.index = Some(NonNull::from(&mut **parked));
            return;
        }

        // static route
        if route.param_count == 0 {
            if let Some(existing) = self.static_list.get(route.match_name.as_bytes()) {
                let source = bun_ast::Source::init_empty_file(route.abs_path.as_bytes());
                self.log.add_error_fmt(
                    Some(&source),
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "Route \"{}\" is already defined by {}",
                        bstr::BStr::new(route.name),
                        // SAFETY: *existing aliases a Box<Route> in self.all_routes
                        bstr::BStr::new(unsafe { &**existing }.abs_path.as_bytes()),
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
                if let Some(existing) = self.static_list.get(&new_route.name[1..]) {
                    let source = bun_ast::Source::init_empty_file(new_route.abs_path.as_bytes());
                    self.log.add_error_fmt(
                        Some(&source),
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "Route \"{}\" is already defined by {}",
                            bstr::BStr::new(new_route.name),
                            // SAFETY: *existing aliases a Box<Route> in self.all_routes
                            bstr::BStr::new(unsafe { &**existing }.abs_path.as_bytes()),
                        ),
                    );

                    return;
                }

                self.static_list
                    .put_assume_capacity(&new_route.name[1..], new_route_ptr);
            }

            self.static_list
                .put_assume_capacity(new_route.match_name.as_bytes(), new_route_ptr);
            self.all_routes.push(new_route);

            return;
        }

        {
            match self.dedupe_dynamic.entry(route.full_hash) {
                Entry::Occupied(e) => {
                    let source = bun_ast::Source::init_empty_file(route.abs_path.as_bytes());
                    self.log.add_error_fmt(
                        Some(&source),
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "Route \"{}\" is already defined by {}",
                            bstr::BStr::new(route.name),
                            bstr::BStr::new(*e.get()),
                        ),
                    );
                    return;
                }
                Entry::Vacant(v) => {
                    v.insert(route.abs_path.as_bytes());
                }
            }
        }

        {
            let new_route = Box::new(route);
            self.all_routes.push(new_route);
        }
    }

    pub(crate) fn load_all<R: ResolverLike>(
        config: RouteConfig,
        log: &'a mut bun_ast::Log,
        resolver: &mut R,
        root_dir_info: &DirInfo,
        base_dir: &[u8],
    ) -> Routes {
        let mut route_dirname_len: u16 = 0;

        // Call bun_paths directly to avoid the higher-tier bun_resolver dep.
        let relative_dir = bun_paths::resolve_path::relative(base_dir, &config.dir);
        if !relative_dir.starts_with(b"..") {
            route_dirname_len =
                (relative_dir.len() + usize::from(config.dir[config.dir.len() - 1] != SEP)) as u16;
        }

        let mut this = RouteLoader {
            log,
            fs: resolver.fs(),
            config,
            static_list: StringHashMap::new(),
            dedupe_dynamic: ArrayHashMap::new(),
            all_routes: Vec::new(),
            index: None,
            route_dirname_len,
        };
        this.load(resolver, root_dir_info, base_dir);
        if this.all_routes.is_empty() {
            return Routes {
                static_: this.static_list,
                ..Routes::default()
            };
        }

        this.all_routes
            .sort_unstable_by(|a, b| sorter::sort_by_name_cmp(a, b));

        let mut route_list = RouteIndexList::default();
        route_list
            .set_capacity(this.all_routes.len())
            .expect("unreachable");

        let mut dynamic_start: Option<usize> = None;
        let mut index_id: Option<usize> = None;

        for (i, route) in this.all_routes.into_iter().enumerate() {
            if (route.kind as u8) > (pattern::Tag::Static as u8) && dynamic_start.is_none() {
                dynamic_start = Some(i);
            }

            if route.full_hash == INDEX_ROUTE_HASH {
                index_id = Some(i);
            }

            let (filepath, match_name) = (route.abs_path.as_bytes(), route.match_name.as_bytes());
            route_list.push(RouteIndex {
                name: route.name,
                filepath,
                match_name,
                route,
            });
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
            static_: this.static_list,
            // Points into a Box<Route> now owned by `route_list`; co-owned raw
            // pointer.
            index: this.index,
        }
    }

    pub(crate) fn load<R: ResolverLike>(
        &mut self,
        resolver: &mut R,
        root_dir_info: &DirInfo,
        base_dir: &[u8],
    ) {
        let fs = self.fs;

        // Snapshot the cached `DirEntry`'s entry pointers under `entries_mutex`:
        // another thread (e.g. the bundler's resolver) rewrites this map in place
        // under that lock, so iterating it live would walk freed buckets.
        let entry_ptrs: Vec<*mut Fs::Entry> = {
            let _entries_lock = fs.fs.entries_mutex.lock_guard();
            match root_dir_info.get_entries_const() {
                Some(entries) => entries.data.values().copied().collect(),
                None => return,
            }
        };
        // NOTE: the guard is dropped before this loop on purpose — the
        // `read_dir_info_ignore_error` recursion below re-acquires `entries_mutex`.
        'outer: for entry_ptr in entry_ptrs {
            // NOTE: the snapshot yields raw `*mut Entry`. Reborrow locally for
            // each access so `&` reads and the `kind()` call do not
            // overlap; the lazy-stat rewrite inside `kind()` is serialized on
            // the per-entry `Entry.mutex`.
            // SAFETY: EntryStore-owned, valid for process lifetime.
            if unsafe { &*entry_ptr }.base()[0] == b'.' {
                continue 'outer;
            }

            // Thread the resolver's fs `Implementation` through —
            // `Entry.kind` derefs it to lazily stat when `need_stat` is
            // true, so null would be a latent crash / silent route-drop
            // once the stub forwards it.
            // SAFETY: no other live borrow of `*entry_ptr` here;
            // `resolver.fs_impl()` points at the process-global RealFS.
            let kind = unsafe { (&*entry_ptr).kind(resolver.fs_impl(), false) };
            // SAFETY: shared read-only borrow for the match arms; the only
            // subsequent mutation is via `Route::parse` which takes the raw
            // pointer and reborrows internally.
            let entry: &Fs::Entry = unsafe { &*entry_ptr };
            match kind {
                Fs::EntryKind::Dir => {
                    for banned_dir in BANNED_DIRS.iter() {
                        if entry.base() == *banned_dir {
                            continue 'outer;
                        }
                    }

                    let abs_parts = [entry.dir(), entry.base()];
                    if let Some(dir_info) = resolver.read_dir_info_ignore_error(fs.abs(&abs_parts))
                    {
                        self.load(resolver, &dir_info, base_dir);
                    }
                }

                Fs::EntryKind::File => {
                    let extname = bun_paths::extension(entry.base());
                    // exclude "." or ""
                    if extname.len() < 2 {
                        continue;
                    }

                    for _extname in self.config.extensions.iter() {
                        if &extname[1..] == _extname.as_ref() {
                            // `entry.dir()` is `base_dir` or a subdirectory of it, cached
                            // with or without a trailing slash depending on which resolver
                            // spelled it first (`base_dir` always has one). Both spellings
                            // trim to the same `public_dir`.
                            let entry_dir = entry.dir();
                            debug_assert!(entry_dir.len() + 1 >= base_dir.len());
                            if entry_dir.len() >= base_dir.len() {
                                debug_assert!(bun_paths::resolve_path::is_sep_any(
                                    entry_dir[base_dir.len() - 1]
                                ));
                            }

                            // SAFETY: entry.dir is at least base_dir.len()-1 bytes; verified above in debug
                            let public_dir = &entry_dir[base_dir.len() - 1..entry_dir.len()];

                            // SAFETY: `entry_ptr` is EntryStore-owned (process
                            // lifetime) with no other live `&mut` borrow here.
                            let route = unsafe {
                                Route::parse(
                                    entry.base(),
                                    extname,
                                    entry_ptr,
                                    self.log,
                                    public_dir,
                                    self.route_dirname_len,
                                )
                            };
                            if let Some(route) = route {
                                self.append_route(route);
                            }
                            break;
                        }
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
    pub const fn offset(self) -> u16 {
        self.0 as u16
    }
    #[inline]
    pub const fn len(self) -> u16 {
        (self.0 >> 16) as u16
    }
    #[inline]
    pub fn set_offset(&mut self, offset: u16) {
        self.0 = (self.0 & 0xFFFF_0000) | (offset as u32);
    }
    #[inline]
    pub fn set_len(&mut self, len: u16) {
        self.0 = (self.0 & 0x0000_FFFF) | ((len as u32) << 16);
    }

    #[inline]
    pub fn str<'s>(self, slice: &'s [u8]) -> &'s [u8] {
        if self.len() > 0 {
            &slice[self.offset() as usize..(self.offset() as usize + self.len() as usize)]
        } else {
            b""
        }
    }
}

// On Windows we need to normalize this path to have forward slashes.
// The normalized path is interned into `DirnameStore` (process-lifetime arena), so
// `abs_path` is uniformly an `Interned` over `'static` bytes on every
// platform — keeping `RouteIndexList.filepath: &'static [u8]` sound and
// avoiding the borrow-then-move at `RouteLoader::load_all`.
pub type AbsPath = Interned;

pub struct Route {
    /// Public display name for the route.
    /// "/", "/index" is "/"
    /// "/foo/index.js" becomes "/foo"
    /// case-sensitive, has leading slash
    pub name: &'static [u8],

    /// Name used for matching.
    /// - Omits leading slash
    /// - Lowercased
    /// This is [inconsistent with Next.js](https://github.com/vercel/next.js/issues/21498)
    pub match_name: Interned,

    pub full_hash: u32,
    pub param_count: u16,

    pub abs_path: AbsPath,

    pub kind: pattern::Tag,

    pub has_uppercase: bool,
}

// TODO(b1): inherent assoc types unstable; module-level alias instead.

impl Route {
    pub const INDEX_ROUTE_NAME: &'static [u8] = b"/";

    /// # Safety
    /// `entry` must point to a live `Fs::Entry` (EntryStore-owned) with no
    /// other active `&mut` borrow for the duration of the call. `base_` and
    /// `extname` may borrow `(*entry).base_`; see the NOTE below.
    pub unsafe fn parse(
        base_: &[u8],
        extname: &[u8],
        entry: *mut Fs::Entry,
        log: &mut bun_ast::Log,
        public_dir_: &[u8],
        routes_dirname_len: u16,
    ) -> Option<Route> {
        // NOTE: `entry` is a raw `*mut Entry`
        // because `base_`/`extname` may borrow `(*entry).base_` (tiny inline
        // string) and a `&mut Entry` parameter would alias them.
        // Reads go through `unsafe { &*entry }`; the single mutation
        // (`set_abs_path`) goes through `unsafe { &mut *entry }` after
        // `base_`/`extname` are no longer used.
        // SAFETY: caller passes an EntryStore-owned pointer valid for the
        // process lifetime; no other live `&mut` to it during this call.
        let entry_abs_path = unsafe { &*entry }.abs_path().as_bytes();
        let mut abs_path_str: &[u8] = if entry_abs_path.is_empty() {
            b""
        } else {
            entry_abs_path
        };

        let base = &base_[0..base_.len() - extname.len()];

        let public_dir = strings::trim(public_dir_, SEP_STR.as_bytes());

        // this is a path like
        // "/pages/index.js"
        // "/pages/foo/index.ts"
        // "/pages/foo/bar.tsx"
        // the name we actually store will often be this one
        ROUTE_BUFS.with_borrow_mut(|bufs| {
            let route_file_buf = &mut bufs.route_file_buf;
            let public_path: &[u8] = 'brk: {
                if base.is_empty() {
                    break 'brk public_dir;
                }
                let mut buf: &mut [u8] = &mut route_file_buf[..];

                if !public_dir.is_empty() {
                    // NOTE: reshaped for borrowck — `buf` already aliases
                    // route_file_buf[..]; write through it instead of re-borrowing.
                    buf[0] = b'/';
                    buf = &mut buf[1..];
                    buf[..public_dir.len()].copy_from_slice(public_dir);
                }
                buf[public_dir.len()] = b'/';
                buf = &mut buf[public_dir.len() + 1..];
                buf[..base.len()].copy_from_slice(base);
                buf = &mut buf[base.len()..];
                buf[..extname.len()].copy_from_slice(extname);
                buf = &mut buf[extname.len()..];

                let written_len = buf.as_ptr() as usize - route_file_buf.as_ptr() as usize;

                #[cfg(windows)]
                {
                    bun_paths::resolve_path::platform_to_posix_in_place(
                        &mut route_file_buf[0..written_len],
                    );
                }

                // SAFETY: written_len computed from sub-slice pointer arithmetic above
                break 'brk unsafe {
                    core::slice::from_raw_parts(route_file_buf.as_ptr(), written_len)
                };
            };

            let mut name = &public_path[0..public_path.len() - extname.len()];

            while name.len() > 1 && name[name.len() - 1] == b'/' {
                name = &name[0..name.len() - 1];
            }

            name = &name[routes_dirname_len as usize..];

            if name.ends_with(b"/index") {
                name = &name[0..name.len() - 6];
            }

            name = strings::trim_right(name, b"/");

            let mut validation_result = pattern::ValidationResult::default();
            let is_index = name.is_empty();

            let mut has_uppercase = false;
            // NOTE: reshaped for borrowck — both arms intern via DirnameStore
            // (process-lifetime arena → `&'static`), so the post-if bindings are
            // 'static and the route_file_buf borrow is dropped before the
            // abs-path block below needs it mutably.
            let (name, match_name): (&'static [u8], &'static [u8]) = if !name.is_empty() {
                validation_result = match Pattern::validate(&name[1..], log) {
                    Some(v) => v,
                    None => return None,
                };

                let mut name_i: usize = 0;
                while !has_uppercase && name_i < public_path.len() {
                    has_uppercase = public_path[name_i] >= b'A' && public_path[name_i] <= b'Z';
                    name_i += 1;
                }

                let name_offset = name.as_ptr() as usize - public_path.as_ptr() as usize;
                let name_len = name.len();

                // NOTE: DirnameStore::append returns `&'static [u8]` (process-
                // lifetime arena), so rebinding here drops the borrow on
                // `route_file_buf` and avoids needing lifetime transmutes
                // below.
                let dirname_store = FileSystem::instance().dirname_store();
                let public_path: &'static [u8] =
                    dirname_store.append(public_path).expect("unreachable");
                let name: &'static [u8] = &public_path[name_offset..][0..name_len];
                let match_name: &'static [u8] = if has_uppercase {
                    dirname_store
                        .append_lower_case(&name[1..])
                        .expect("unreachable")
                } else {
                    &name[1..]
                };

                debug_assert!(match_name[0] != b'/');
                debug_assert!(name[0] == b'/');
                (name, match_name)
            } else {
                (Route::INDEX_ROUTE_NAME, Route::INDEX_ROUTE_NAME)
            };

            if abs_path_str.is_empty() {
                // The reads of `cache().fd` and the `set_abs_path` write below
                // rewrite the cached `Entry`; serialize them on the per-entry
                // mutex (the same lock every other `Entry` rewrite path takes).
                // SAFETY: see fn-level NOTE — read-only reborrow.
                let _entry_guard = unsafe { &*entry }.mutex.lock_guard();
                // NOTE: reshaped for borrowck — `defer if (needs_close) file.close()`
                // becomes a scopeguard owning the Option<File>; `needs_close` is a
                // Cell so the drop closure can read it while the body still mutates.
                // The guard is inverted: when the fd belongs to the cache
                // (`needs_close == false`), `into_raw()` so we do not close
                // someone else's fd.
                let needs_close = core::cell::Cell::new(true);
                let mut file = scopeguard::guard(None::<bun_sys::File>, |f| {
                    if !needs_close.get() {
                        if let Some(f) = f {
                            let _ = f.into_raw();
                        }
                    }
                });

                // SAFETY: see fn-level NOTE — read-only reborrow.
                if let Some(valid) = unsafe { &*entry }.cache().fd.unwrap_valid() {
                    *file = Some(bun_sys::File::from_fd(valid));
                    needs_close.set(false);
                } else {
                    // SAFETY: see fn-level NOTE — read-only reborrow.
                    let entry_r = unsafe { &*entry };
                    let parts = [entry_r.dir(), entry_r.base()];
                    let abs_len = FileSystem::instance().abs_buf(&parts, route_file_buf).len();
                    // Rebind so the later getFdPath error
                    // message prints the computed path instead of `b""`.
                    // SAFETY: lifetime-laundered raw view into route_file_buf
                    // (same pattern as `public_path` above) so the buffer can
                    // be reborrowed mutably for the NUL write / open below.
                    abs_path_str =
                        unsafe { core::slice::from_raw_parts(route_file_buf.as_ptr(), abs_len) };
                    route_file_buf[abs_len] = 0;
                    // SAFETY: NUL-terminated above; `abs_len` bytes valid in route_file_buf.
                    let buf = bun_core::ZStr::from_buf(&route_file_buf[..], abs_len);
                    match bun_sys::open_file_absolute_z(buf, bun_sys::OpenFlags::READ_ONLY) {
                        Ok(f) => {
                            *file = Some(f);
                        }
                        Err(err) => {
                            needs_close.set(false);
                            log.add_error_fmt(
                                None,
                                bun_ast::Loc::EMPTY,
                                format_args!(
                                    "{} opening route: {}",
                                    bstr::BStr::new(err.name()),
                                    bstr::BStr::new(&route_file_buf[..abs_len])
                                ),
                            );
                            return None;
                        }
                    }
                    FileSystem::set_max_fd(file.as_ref().unwrap().handle().native());
                }

                let fd = file.as_ref().unwrap().handle();
                let _abs = match bun_sys::get_fd_path(fd, route_file_buf) {
                    Ok(p) => &p[..],
                    Err(err) => {
                        log.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "{} resolving route: {}",
                                bstr::BStr::new(err.name()),
                                bstr::BStr::new(abs_path_str)
                            ),
                        );
                        return None;
                    }
                };

                abs_path_str = FileSystem::instance()
                    .dirname_store()
                    .append(_abs)
                    .expect("unreachable");

                // SAFETY: sole mutation; `base_`/`extname` (which may borrow
                // `(*entry).base_.remainder_buf`) are not used after this.
                unsafe { &mut *entry }.set_abs_path(Interned::from_static(abs_path_str));
            }

            #[cfg(windows)]
            let abs_path: AbsPath = {
                // Intern into DirnameStore so the slice is genuinely `'static`
                // and the `Interned` widen is sound on Windows.
                let normalized = bun_paths::resolve_path::platform_to_posix_buf(
                    abs_path_str,
                    &mut bufs.normalized_abs_path_buf,
                );
                let interned: &'static [u8] = FileSystem::instance()
                    .dirname_store()
                    .append(normalized)
                    .expect("unreachable");
                Interned::from_static(interned)
            };
            #[cfg(not(windows))]
            let abs_path = Interned::from_static(abs_path_str);

            #[cfg(all(debug_assertions, windows))]
            {
                debug_assert!(!strings::index_of_char(name, b'\\').is_some());
                debug_assert!(!strings::index_of_char(match_name, b'\\').is_some());
                debug_assert!(!strings::index_of_char(abs_path.as_bytes(), b'\\').is_some());
                // SAFETY: read-only reborrow; the `&mut` write above is dead.
                debug_assert!(!strings::index_of_char(unsafe { &*entry }.base(), b'\\').is_some());
            }

            Some(Route {
                name,
                match_name: Interned::from_static(match_name),
                full_hash: if is_index {
                    INDEX_ROUTE_HASH
                } else {
                    wyhash(name) as u32
                },
                param_count: validation_result.param_count,
                kind: validation_result.kind,
                abs_path,
                has_uppercase,
            })
        })
    }
}

pub mod sorter {
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

    pub fn sort_by_name_string(lhs: &[u8], rhs: &[u8]) -> bool {
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

    pub fn sort_by_name(a: &Route, b: &Route) -> bool {
        let a_name = a.match_name.as_bytes();
        let b_name = b.match_name.as_bytes();

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
    pub fn sort_by_name_cmp(a: &Route, b: &Route) -> Ordering {
        if sort_by_name(a, b) {
            Ordering::Less
        } else if sort_by_name(b, a) {
            Ordering::Greater
        } else {
            Ordering::Equal
        }
    }
}

struct RouteBufs {
    route_file_buf: PathBuffer,
    #[cfg(windows)]
    normalized_abs_path_buf: bun_sys::windows::PathBuffer,
}

thread_local! {
    // bun.ThreadlocalBuffers: heap-backed so only a Box pointer lives in TLS
    // (keeps PT_TLS MemSiz small — see test/js/bun/binary/tls-segment-size).
    static ROUTE_BUFS: RefCell<Box<RouteBufs>> = RefCell::new(Box::new(RouteBufs {
        route_file_buf: PathBuffer::ZEROED,
        #[cfg(windows)]
        normalized_abs_path_buf: bun_sys::windows::PathBuffer::ZEROED,
    }));
}

pub struct Match<'a> {
    /// raw url path from the request
    pub pathname: &'a [u8],
    /// absolute filesystem path to the entry point
    pub file_path: &'a [u8],
    /// route name, like `"posts/[id]"`
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
// Traits abstracting over the router's collaborators
// (Resolver, Server, RequestContext).
// TODO(refactor): colocate these with the canonical types in
// bun_resolver / bun_runtime.
// ──────────────────────────────────────────────────────────────────────────

pub trait ResolverLike {
    // `bun_resolver::fs::FileSystem` is a process-global singleton, so `'static`
    // here is faithful and avoids threading the resolver borrow into RouteLoader<'a>.
    fn fs(&self) -> &'static FileSystem;
    /// The resolver's `Implementation` field, passed to
    /// `Entry.kind` for lazy stat.
    fn fs_impl(&self) -> *mut Fs::Implementation;
    /// Returns an arena handle (not a borrow) so the resolver's `&mut self`
    /// borrow ends before the recursive `load()` re-borrows it.
    fn read_dir_info_ignore_error(&mut self, path: &[u8]) -> Option<DirInfoRef>;
}

// ──────────────────────────────────────────────────────────────────────────
// Pattern
// ──────────────────────────────────────────────────────────────────────────

pub mod pattern {
    use super::*;

    pub type RoutePathInt = u16;

    #[derive(Clone, Copy)]
    pub struct Pattern {
        pub value: Value,
        pub len: RoutePathInt,
    }

    impl Pattern {
        /// Match a filesystem route pattern to a URL path.
        pub fn match_<'a, const ALLOW_OPTIONAL_CATCH_ALL: bool>(
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
                        let segment =
                            &path_[0..path_.iter().position(|&b| b == b'/').unwrap_or(path_.len())];
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
                        if let Some(i) = path_.iter().position(|&b| b == b'/') {
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
                            }

                            return true;
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
        pub fn validate(input: &[u8], log: &mut bun_ast::Log) -> Option<ValidationResult> {
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

        pub fn init(input: &[u8], offset_: RoutePathInt) -> Result<Pattern, PatternParseError> {
            Self::init_maybe_hash::<true>(input, offset_)
        }

        pub fn is_end(self, input: &[u8]) -> bool {
            self.len as usize >= input.len() - 1
        }

        pub fn init_unhashed(
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
        pub param_count: u16,
        pub kind: Tag,
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

pub use pattern::Pattern;

// ──────────────────────────────────────────────────────────────────────────
// Tests + test helpers
// ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test(cwd_path: &[u8], data: &[(&str, &str)]) -> crate::Result<()> {
        Output::init_test();
        debug_assert!(cwd_path.len() > 1 && cwd_path != b"/" && !cwd_path.ends_with(b"bun"));
        let bun_tests_dir = bun_sys::Dir::cwd()
            .make_open_path(b"bun-test-scratch", bun_sys::OpenDirOptions::default())?;
        let _ = bun_tests_dir.delete_tree(cwd_path);

        let cwd = bun_tests_dir.make_open_path(cwd_path, bun_sys::OpenDirOptions::default())?;
        bun_sys::fchdir(cwd.fd())?;

        for (name, value) in data {
            let name_b = name.as_bytes();
            // NOTE: paths without a '/' have no parent dir to create;
            // rposition on '/' finds the parent (test fixture paths are
            // always forward-slash).
            if let Some(slash) = name_b.iter().rposition(|&c| c == b'/') {
                if slash > 0 {
                    cwd.make_path(&name_b[..slash])?;
                }
            }
            let file = bun_sys::File::create(cwd.fd(), name_b, true)?;
            file.write_all(value.as_bytes())?;
            let _ = file.close();
        }
        Ok(())
    }

    /// Newtype so the orphan rule lets us `impl ResolverLike` for a
    /// foreign-crate type.
    struct TestResolver<'a>(bun_resolver::Resolver<'a>);

    impl<'a> ResolverLike for TestResolver<'a> {
        fn fs(&self) -> &'static FileSystem {
            // SAFETY: process-static singleton (see `FileSystem::instance`).
            unsafe { &*self.0.fs() }
        }
        fn fs_impl(&self) -> *mut Fs::Implementation {
            // SAFETY: `&fs.fs` — the `Implementation` field of the singleton.
            unsafe { core::ptr::from_mut(&mut (*self.0.fs()).fs) }
        }
        fn read_dir_info_ignore_error(&mut self, path: &[u8]) -> Option<DirInfoRef> {
            self.0.read_dir_info_ignore_error(path)
        }
    }

    pub struct Test;

    impl Test {
        pub fn make_routes(
            test_name: &'static str,
            data: &[(&str, &str)],
        ) -> crate::Result<Routes> {
            Output::init_test();
            make_test(test_name.as_bytes(), data)?;
            bun_ast::initialize_store();
            // const fs = try FileSystem.init(null);
            let _ = bun_resolver::fs::FileSystem::init(None)?;
            let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir;

            // var pages_parts = [_]string{ top_level_dir, "pages" };
            // const pages_dir = try Fs.FileSystem.instance.absAlloc(default_allocator, &pages_parts);
            let pages_parts: [&[u8]; 2] = [top_level_dir, b"pages"];
            let pages_dir = bun_resolver::fs::FileSystem::instance()
                .abs_alloc(&pages_parts)
                .map_err(|_| crate::Error::Alloc(bun_alloc::AllocError))?;

            // const router = try Router.init(&FileSystem.instance, default_allocator, RouteConfig{...});
            // SAFETY: process-static singleton just initialized above.
            let fs_opaque: &'static FileSystem = unsafe { &*fs };
            let router = Router::init(
                fs_opaque,
                RouteConfig {
                    dir: pages_dir.to_vec().into_boxed_slice(),
                    extensions: vec![b"js".as_slice().into()].into_boxed_slice(),
                    ..RouteConfig::default()
                },
            )?;

            let mut log = bun_ast::Log::init();
            // NOTE: `errdefer logger.print(Output.errorWriter())` — Rust has
            // no errdefer; the test harness panics on error anyway, but the guard
            // still flushes diagnostics on early-return for parity.
            let _err_dump = scopeguard::guard(core::ptr::from_mut(&mut log), |log| {
                // SAFETY: pointer to a stack local that outlives this guard.
                let _ = unsafe { &*log }.print(bun_core::output::error_writer());
            });

            // const opts = Options.BundleOptions{ .target = .browser, ... };
            // NOTE: the resolver-side `BundleOptions` subset omits
            // `loaders`/`define`/`log`/`routes`/`entry_points`/`out_extensions`/
            // `transform_options` — none are read by `Resolver::init1` or the
            // dir-info walk, so `Default` + `target` is the faithful projection.
            let opts = bun_resolver::options::BundleOptions {
                target: bun_ast::Target::Browser,
                external: bun_resolver::options::ExternalModules::default(),
                ..Default::default()
            };

            // var resolver = Resolver.init1(default_allocator, &logger, &FileSystem.instance, opts);
            let mut resolver = TestResolver(bun_resolver::Resolver::init1(
                core::ptr::NonNull::from(&mut log),
                fs,
                opts,
            ));

            // const root_dir = (try resolver.readDirInfo(pages_dir)).?;
            let root_dir = resolver
                .0
                .read_dir_info(pages_dir)?
                .ok_or_else(|| crate::Error::Sys(bun_errno::SystemErrno::ENOENT))?;

            // return RouteLoader.loadAll(..., opts.routes, &logger, Resolver, &resolver, root_dir);
            // SAFETY: `_err_dump` only re-derives `&*log` on drop (after this borrow ends).
            let routes = RouteLoader::load_all(
                router.config.clone(),
                unsafe { &mut *core::ptr::from_mut(&mut log) },
                &mut resolver,
                &root_dir,
                top_level_dir,
            );
            scopeguard::ScopeGuard::into_inner(_err_dump);
            Ok(routes)
        }

        pub fn make(
            test_name: &'static str,
            data: &[(&str, &str)],
        ) -> crate::Result<Router<'static>> {
            make_test(test_name.as_bytes(), data)?;
            bun_ast::initialize_store();
            // const fs = try FileSystem.initWithForce(null, true);
            let _ = bun_resolver::fs::FileSystem::init_with_force::<true>(None)?;
            let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir;

            let pages_parts: [&[u8]; 2] = [top_level_dir, b"pages"];
            let pages_dir = bun_resolver::fs::FileSystem::instance()
                .abs_alloc(&pages_parts)
                .map_err(|_| crate::Error::Alloc(bun_alloc::AllocError))?;

            // var router = try Router.init(&FileSystem.instance, default_allocator, RouteConfig{...});
            // SAFETY: process-static singleton just initialized above.
            let fs_opaque: &'static FileSystem = unsafe { &*fs };
            let mut router = Router::init(
                fs_opaque,
                RouteConfig {
                    dir: pages_dir.to_vec().into_boxed_slice(),
                    extensions: vec![b"js".as_slice().into()].into_boxed_slice(),
                    ..RouteConfig::default()
                },
            )?;

            let mut log = bun_ast::Log::init();
            let _err_dump = scopeguard::guard(core::ptr::from_mut(&mut log), |log| {
                // SAFETY: pointer to a stack local that outlives this guard.
                let _ = unsafe { &*log }.print(bun_core::output::error_writer());
            });

            let opts = bun_resolver::options::BundleOptions {
                target: bun_ast::Target::Browser,
                external: bun_resolver::options::ExternalModules::default(),
                ..Default::default()
            };

            let mut resolver = TestResolver(bun_resolver::Resolver::init1(
                core::ptr::NonNull::from(&mut log),
                fs,
                opts,
            ));

            // const root_dir = (try resolver.readDirInfo(pages_dir)).?;
            let root_dir = resolver
                .0
                .read_dir_info(pages_dir)?
                .ok_or_else(|| crate::Error::Sys(bun_errno::SystemErrno::ENOENT))?;

            // try router.loadRoutes(&logger, root_dir, Resolver, &resolver, top_level_dir);
            // SAFETY: `_err_dump` only re-derives `&*log` on drop (after this borrow ends).
            router.load_routes(
                unsafe { &mut *core::ptr::from_mut(&mut log) },
                &root_dir,
                &mut resolver,
                top_level_dir,
            )?;
            let entry_points = router.get_entry_points();

            assert_eq!(data.len(), entry_points.len());
            scopeguard::ScopeGuard::into_inner(_err_dump);
            Ok(router)
        }
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
