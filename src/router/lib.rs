#![allow(unused, dead_code, non_snake_case, private_interfaces)] // B-1 gate-and-stub
// This is a Next.js-compatible file-system router.
// It uses the filesystem to infer entry points.
// Despite being Next.js-compatible, it's not tied to Next.js.
// It does not handle the framework parts of rendering pages.
// All it does is resolve URL paths to the appropriate entry point and parse URL params/query.

use core::cmp::Ordering;
use std::cell::RefCell;

use bun_collections::{ArrayHashMap, MultiArrayList, StringHashMap};
use bun_core::Output;
use bun_paths::{self, PathBuffer, SEP, SEP_STR};
use bun_string::strings;
use bun_sys::Fd;
use bun_url::PathnameScanner;

use bun_http_types::URLPath::URLPath;

// ──────────────────────────────────────────────────────────────────────────
// B-1 gate-and-stub: local shims for cross-tier symbols not yet exposed by
// lower-tier crates. Do NOT edit other crates; un-gating happens in B-2.
// ──────────────────────────────────────────────────────────────────────────
#[allow(dead_code, non_snake_case)]
mod b1_stubs {
    // TODO(b1): bun_wyhash::hash missing — local stub
    #[inline]
    pub fn wyhash(input: &[u8]) -> u64 {
        bun_wyhash::Wyhash11::hash(0, input)
    }

    // TODO(b1): bun_logger crate missing from deps
    pub mod logger {
        pub struct Log;
        impl Log {
            pub fn add_error_fmt(
                &mut self,
                _source: Option<&Source>,
                _loc: Loc,
                _args: core::fmt::Arguments<'_>,
            ) -> Result<(), ()> {
                todo!("b1-stub: bun_logger::Log::add_error_fmt")
            }
        }
        pub struct Source;
        impl Source {
            pub fn init_empty_file(_path: &[u8]) -> Source {
                todo!("b1-stub: bun_logger::Source::init_empty_file")
            }
        }
        pub struct Loc;
        impl Loc {
            pub const EMPTY: Loc = Loc;
        }
    }

    // TODO(b1): bun_sys::fs missing (MOVE_DOWN pending)
    pub mod Fs {
        pub struct FileSystem;
        pub struct DirEntry;
        pub struct Entry;
    }
    pub use Fs::FileSystem;

    // TODO(b1): bun_schema::api missing
    pub mod api {
        #[derive(Default, Clone)]
        pub struct LoadedRouteConfig {
            pub asset_prefix: Box<[u8]>,
            pub dir: Box<[u8]>,
            pub extensions: Box<[Box<[u8]>]>,
            pub static_dir: Box<[u8]>,
        }
        pub struct RouteConfig;
        pub struct StringPointer {
            pub offset: u32,
            pub length: u32,
        }
    }

    // TODO(b1): bun_core::Error missing
    pub type CoreError = ();

    // TODO(b1): bun_string::HashedString stub lacks init/eql/EMPTY/Copy; local
    // shim with the surface this crate needs.
    #[derive(Clone, Copy)]
    pub struct HashedString {
        pub hash: u32,
        pub ptr: *const u8,
        pub len: usize,
    }
    // SAFETY: HashedString is a view into 'static-ish DirnameStore buffers (Phase A).
    unsafe impl Send for HashedString {}
    unsafe impl Sync for HashedString {}
    impl HashedString {
        pub const EMPTY: HashedString = HashedString { hash: 0, ptr: b"".as_ptr(), len: 0 };
        #[inline]
        pub fn init(s: &[u8]) -> HashedString {
            HashedString { hash: super::wyhash(s) as u32, ptr: s.as_ptr(), len: s.len() }
        }
        #[inline]
        pub fn init_no_hash(s: &[u8]) -> HashedString {
            HashedString { hash: 0, ptr: s.as_ptr(), len: s.len() }
        }
        #[inline]
        pub fn slice(&self) -> &[u8] {
            // SAFETY: ptr+len always come from a valid &[u8] in init/init_no_hash.
            unsafe { core::slice::from_raw_parts(self.ptr, self.len) }
        }
        #[inline]
        pub fn eql(self, other: &[u8]) -> bool {
            self.slice() == other
        }
        #[inline]
        pub fn eql_hashed(a: HashedString, b: HashedString) -> bool {
            a.hash == b.hash && a.slice() == b.slice()
        }
    }

    // TODO(b1): bun_string::PathString stub lacks init/slice; local shim.
    #[derive(Clone, Copy, Default)]
    pub struct PathString {
        pub ptr: *const u8,
        pub len: usize,
    }
    unsafe impl Send for PathString {}
    unsafe impl Sync for PathString {}
    impl PathString {
        #[inline]
        pub fn init(s: &[u8]) -> PathString {
            PathString { ptr: s.as_ptr(), len: s.len() }
        }
        #[inline]
        pub fn slice(&self) -> &[u8] {
            // SAFETY: ptr+len always come from a valid &[u8] in init.
            unsafe { core::slice::from_raw_parts(self.ptr, self.len) }
        }
        #[inline]
        pub fn is_empty(&self) -> bool {
            self.len == 0
        }
    }

    // TODO(b1): bun_string::strings::CodepointIterator missing
    pub struct CodepointIterator;
    impl CodepointIterator {
        #[inline]
        pub fn needs_utf8_decoding(s: &[u8]) -> bool {
            s.iter().any(|&b| b >= 0x80)
        }
    }

    // TODO(b1): bun_string::strings::{trim, trim_left, trim_right} missing
    pub mod strings_ext {
        #[inline]
        pub fn trim<'a>(s: &'a [u8], chars: &[u8]) -> &'a [u8] {
            trim_left(trim_right(s, chars), chars)
        }
        #[inline]
        pub fn trim_left<'a>(mut s: &'a [u8], chars: &[u8]) -> &'a [u8] {
            while let Some(&b) = s.first() {
                if !chars.contains(&b) {
                    break;
                }
                s = &s[1..];
            }
            s
        }
        #[inline]
        pub fn trim_right<'a>(mut s: &'a [u8], chars: &[u8]) -> &'a [u8] {
            while let Some(&b) = s.last() {
                if !chars.contains(&b) {
                    break;
                }
                s = &s[..s.len() - 1];
            }
            s
        }
    }
}
use b1_stubs::{api, logger, wyhash, CoreError, FileSystem, Fs, HashedString, PathString};

// ──────────────────────────────────────────────────────────────────────────
// CYCLEBREAK Phase B-0 — cross-tier decoupling
// ──────────────────────────────────────────────────────────────────────────

// MOVE_DOWN(b0): RouteConfig (was bun_bundler::options::RouteConfig).
// Ground truth: src/bundler/options.zig `pub const RouteConfig = struct { ... }`.
// Moved here so T4 router is self-contained; bun_bundler re-exports this
// (`pub use bun_router::RouteConfig`) to preserve the old path.
#[derive(Clone, Default)]
pub struct RouteConfig {
    pub dir: Box<[u8]>,
    pub possible_dirs: Box<[Box<[u8]>]>,

    /// Frameworks like Next.js (and others) use a special prefix for bundled/transpiled assets.
    /// This is combined with "origin" when printing import paths.
    pub asset_prefix_path: Box<[u8]>,

    // TODO: do we need a separate list for data-only extensions?
    // e.g. /foo.json just to get the data for the route, without rendering the html
    // I think it's fine to hardcode as .json for now, but if I personally were writing a framework
    // I would consider using a custom binary format to minimize request size
    // maybe like CBOR
    pub extensions: Box<[Box<[u8]>]>,
    pub routes_enabled: bool,

    pub static_dir: Box<[u8]>,
    pub static_dir_enabled: bool,
}

impl RouteConfig {
    pub const DEFAULT_DIR: &'static [u8] = b"pages";
    pub const DEFAULT_STATIC_DIR: &'static [u8] = b"public";
    pub const DEFAULT_EXTENSIONS: &'static [&'static [u8]] =
        &[b"tsx", b"ts", b"mjs", b"jsx", b"js"];

    pub fn to_api(&self) -> api::LoadedRouteConfig {
        api::LoadedRouteConfig {
            asset_prefix: self.asset_prefix_path.clone(),
            dir: if self.routes_enabled { self.dir.clone() } else { Box::default() },
            extensions: self.extensions.clone(),
            static_dir: if self.static_dir_enabled {
                self.static_dir.clone()
            } else {
                Box::default()
            },
        }
    }

    #[inline]
    pub fn zero() -> RouteConfig {
        RouteConfig {
            dir: Box::from(Self::DEFAULT_DIR),
            extensions: Self::DEFAULT_EXTENSIONS
                .iter()
                .map(|s| Box::<[u8]>::from(*s))
                .collect(),
            static_dir: Box::from(Self::DEFAULT_STATIC_DIR),
            routes_enabled: false,
            ..Default::default()
        }
    }

    pub fn from_loaded_routes(loaded: api::LoadedRouteConfig) -> RouteConfig {
        RouteConfig {
            extensions: loaded.extensions,
            routes_enabled: !loaded.dir.is_empty(),
            static_dir_enabled: !loaded.static_dir.is_empty(),
            dir: loaded.dir,
            asset_prefix_path: loaded.asset_prefix,
            static_dir: loaded.static_dir,
            possible_dirs: Box::default(),
        }
    }

    #[cfg(any())] // TODO(b1): bun_schema::api::RouteConfig + bun_string::strings::trim_* missing
    pub fn from_api(router_: &api::RouteConfig) -> Result<RouteConfig, CoreError> {
        let mut router = Self::zero();

        let static_dir: &[u8] =
            strings::trim_right(router_.static_dir.as_deref().unwrap_or(b""), b"/\\");
        let asset_prefix: &[u8] =
            strings::trim_right(router_.asset_prefix.as_deref().unwrap_or(b""), b"/\\");

        match router_.dir.len() {
            0 => {}
            1 => {
                router.dir = Box::from(strings::trim_right(&router_.dir[0], b"/\\"));
                router.routes_enabled = !router.dir.is_empty();
            }
            _ => {
                router.possible_dirs = router_.dir.clone();
                for dir in router_.dir.iter() {
                    let trimmed = strings::trim_right(dir, b"/\\");
                    if !trimmed.is_empty() {
                        router.dir = Box::from(trimmed);
                    }
                }
                router.routes_enabled = !router.dir.is_empty();
            }
        }

        if !static_dir.is_empty() {
            router.static_dir = Box::from(static_dir);
        }

        if !asset_prefix.is_empty() {
            router.asset_prefix_path = Box::from(asset_prefix);
        }

        if !router_.extensions.is_empty() {
            let mut count: usize = 0;
            for _ext in router_.extensions.iter() {
                let ext = strings::trim_left(_ext, b".");
                if ext.is_empty() {
                    continue;
                }
                count += 1;
            }

            let mut extensions: Vec<Box<[u8]>> = Vec::with_capacity(count);
            for _ext in router_.extensions.iter() {
                let ext = strings::trim_left(_ext, b".");
                if ext.is_empty() {
                    continue;
                }
                extensions.push(Box::from(ext));
            }

            router.extensions = extensions.into_boxed_slice();
        }

        Ok(router)
    }
}

// GENUINE(b0): bun_resolver::dir_info::DirInfo — erased via manual vtable (cold path).
// PERF(port): was inline `&DirInfo`; route loading runs once at startup so the
// indirect call is acceptable. bun_resolver provides the static `DirInfoVTable`
// instance (move-in pass adds `bun_resolver::DIR_INFO_VTABLE`).
pub struct DirInfoVTable {
    /// Returns the cached directory listing for this DirInfo, if loaded.
    pub get_entries_const: unsafe fn(*const ()) -> Option<*const Fs::DirEntry>,
}

#[derive(Copy, Clone)]
pub struct DirInfoRef {
    // SAFETY: erased *const bun_resolver::dir_info::DirInfo
    pub owner: *const (),
    pub vtable: &'static DirInfoVTable,
}

impl DirInfoRef {
    #[inline]
    pub fn get_entries_const(&self) -> Option<&Fs::DirEntry> {
        // SAFETY: vtable upholds that the returned pointer (if Some) is valid for
        // the lifetime of the erased DirInfo behind `owner`.
        unsafe { (self.vtable.get_entries_const)(self.owner).map(|p| &*p) }
    }
}

// const index_route_hash = @truncate(bun.hash("$$/index-route$$-!(@*@#&*%-901823098123"))
// TODO(port): make this a true const once bun_wyhash::hash is const fn
fn index_route_hash() -> u32 {
    wyhash(b"$$/index-route$$-!(@*@#&*%-901823098123") as u32
}

// TYPE_ONLY(b0): Param + List moved down into bun_url (T3) so the URL
// PathnameScanner can name them without depending on router (T4). Re-export
// here so existing `bun_router::Param` / `bun_router::route_param::List` users
// keep resolving. The old `route_param::List` inherent-associated-type spelling is
// gone (unstable + can't `impl` a foreign type); call sites use
// `route_param::List` instead.
pub use bun_url::route_param;
pub use bun_url::route_param::Param;

pub struct Router<'a> {
    pub dir: Fd,
    pub routes: Routes<'a>,
    pub loaded_routes: bool,
    // allocator: dropped — global mimalloc
    pub fs: &'a FileSystem,
    pub config: RouteConfig,
}

#[cfg(any())] // TODO(b1): Fd::INVALID, Routes default, RouteLoader, URLPath fields, watcher — gate whole impl
impl<'a> Router<'a> {
    pub fn init(
        fs: &'a FileSystem,
        config: RouteConfig,
    ) -> Result<Router<'a>, CoreError> {
        Ok(Router {
            dir: Fd::INVALID,
            routes: Routes {
                config: config.clone(),
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

    pub fn get_public_paths(&self) -> &[&'static [u8]] {
        self.routes.list.items_public_path()
    }

    pub fn route_index_by_hash(&self, hash: u32) -> Option<usize> {
        if hash == index_route_hash() {
            return self.routes.index_id;
        }

        self.routes
            .list
            .items_hash()
            .iter()
            .position(|&h| h == hash)
    }

    pub fn get_names(&self) -> &[&'static [u8]] {
        self.routes.list.items_name()
    }

    // This loads routes recursively, in depth-first order.
    // it does not currently handle duplicate exact route matches. that's undefined behavior, for now.
    pub fn load_routes<R: ResolverLike>(
        &mut self,
        log: &mut logger::Log,
        root_dir_info: DirInfoRef,
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

    pub fn match_<S: ServerLike, C: RequestContextLike>(
        app: &mut Self,
        server: &mut S,
        ctx: &mut C,
    ) -> Result<(), CoreError> {
        ctx.set_matched_route(None);

        // If there's an extname assume it's an asset and not a page
        match ctx.url().extname.len() {
            0 => {}
            // json is used for updating the route client-side without a page reload
            4 /* "json".len */ => {
                if ctx.url().extname != b"json" {
                    ctx.handle_request()?;
                    return Ok(());
                }
            }
            _ => {
                ctx.handle_request()?;
                return Ok(());
            }
        }

        PARAMS_LIST.with_borrow_mut(|params_list| -> Result<(), CoreError> {
            params_list.shrink_retaining_capacity(0);
            if let Some(route) = app
                .routes
                .match_page(&app.config.dir, ctx.url().clone(), params_list)
            {
                if let Some(redirect) = route.redirect_path {
                    ctx.handle_redirect(redirect)?;
                    return Ok(());
                }

                debug_assert!(!route.path.is_empty());

                // TODO(port): @hasField(std.meta.Child(Server), "watcher") — modeled via ServerLike trait method
                if let Some(watcher) = server.watcher_mut() {
                    if watcher.watchloop_handle().is_none() {
                        let _ = watcher.start();
                    }
                }

                // ctx.matched_route = route;
                // RequestContextType.JavaScriptHandler.enqueue(ctx, server, &params_list) catch {
                //     server.javascript_enabled = false;
                // };
            }
            Ok(())
        })?;

        if !ctx.controlled() && !ctx.has_called_done() {
            ctx.handle_request()?;
        }
        Ok(())
    }
}

pub const BANNED_DIRS: [&[u8]; 1] = [b"node_modules"];

struct RouteIndex {
    route: Box<Route>,
    name: &'static [u8],
    match_name: &'static [u8],
    filepath: &'static [u8],
    public_path: &'static [u8],
    hash: u32,
}

// TODO(b1): inherent assoc types unstable; module-level alias instead.
type RouteIndexList = MultiArrayList<RouteIndex>;

pub struct Routes<'a> {
    pub list: RouteIndexList,
    // TODO(port): self-referential — these slice into self.list columns; revisit in Phase B
    pub dynamic: &'static [Box<Route>],
    pub dynamic_names: &'static [&'static [u8]],
    pub dynamic_match_names: &'static [&'static [u8]],

    /// completely static children of indefinite depth
    /// `"blog/posts"`
    /// `"dashboard"`
    /// `"profiles"`
    /// this is a fast path?
    pub static_: StringHashMap<*const Route>,

    /// Corresponds to "index.js" on the filesystem
    pub index: Option<&'a Route>,
    pub index_id: Option<usize>,

    // allocator: dropped — global mimalloc
    pub config: RouteConfig,

    // This is passed here and propagated through Match
    // We put this here to avoid loading the FrameworkConfig for the client, on the server.
    pub client_framework_enabled: bool,
}

#[cfg(any())] // TODO(b1): MultiArrayList::default() not on stub
impl<'a> Default for Routes<'a> {
    fn default() -> Self {
        Self {
            list: RouteIndexList::default(),
            dynamic: &[],
            dynamic_names: &[],
            dynamic_match_names: &[],
            static_: StringHashMap::new(),
            index: None,
            index_id: Some(0),
            config: RouteConfig::default(),
            client_framework_enabled: false,
        }
    }
}

#[cfg(any())] // TODO(b1): URLPath fields, AbsPath::slice, strings::trim_left, route_param::List::shrink_retaining_capacity
impl<'a> Routes<'a> {
    pub fn match_page_with_allocator<'p>(
        &mut self,
        _: &[u8],
        url_path: URLPath,
        params: &'p mut route_param::List,
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
            if let Some(index) = self.index {
                return Some(Match {
                    params,
                    name: index.name,
                    path: index.abs_path.slice(),
                    pathname: url_path.pathname,
                    basename: index.basename,
                    hash: index_route_hash(),
                    file_path: index.abs_path.slice(),
                    query_string: url_path.query_string,
                    client_framework_enabled: self.client_framework_enabled,
                    redirect_path: None,
                });
            }

            return None;
        }

        struct MatchContextType {
            params: route_param::List,
        }
        // PORT NOTE: reshaped for borrowck — Zig moved params into a local struct then back via defer.
        let mut matcher = MatchContextType {
            params: core::mem::take(params),
        };
        let result = self.match_(path, &mut matcher.params);
        *params = matcher.params;

        if let Some(route) = result {
            return Some(Match {
                params,
                name: route.name,
                path: route.abs_path.slice(),
                pathname: url_path.pathname,
                basename: route.basename,
                hash: route.full_hash,
                file_path: route.abs_path.slice(),
                query_string: url_path.query_string,
                client_framework_enabled: self.client_framework_enabled,
                redirect_path: None,
            });
        }

        None
    }

    pub fn match_page<'p>(
        &mut self,
        _: &[u8],
        url_path: URLPath,
        params: &'p mut route_param::List,
    ) -> Option<Match<'p>> {
        self.match_page_with_allocator(b"", url_path, params)
    }

    fn match_dynamic(&mut self, path: &[u8], params: &mut route_param::List) -> Option<*const Route> {
        // its cleaned, so now we search the big list of strings
        debug_assert_eq!(self.dynamic_names.len(), self.dynamic_match_names.len());
        debug_assert_eq!(self.dynamic_names.len(), self.dynamic.len());
        for ((case_sensitive_name, name), route) in self
            .dynamic_names
            .iter()
            .zip(self.dynamic_match_names.iter())
            .zip(self.dynamic.iter())
        {
            if Pattern::match_::<true>(path, &case_sensitive_name[1..], name, params) {
                return Some(&**route as *const Route);
            }
        }

        None
    }

    fn match_(&mut self, pathname_: &[u8], params: &mut route_param::List) -> Option<&Route> {
        let pathname = strings::trim_left(pathname_, b"/");

        if pathname.is_empty() {
            return self.index;
        }

        let found = self
            .static_
            .get(pathname)
            .copied()
            .or_else(|| self.match_dynamic(pathname, params));
        // SAFETY: pointers in static_/dynamic alias Box<Route> stored in self.list, which outlives self
        found.map(|p| unsafe { &*p })
    }
}

struct RouteLoader<'a> {
    // allocator: dropped — global mimalloc
    fs: &'a FileSystem,
    config: RouteConfig,
    route_dirname_len: u16,

    dedupe_dynamic: ArrayHashMap<u32, &'static [u8]>,
    log: &'a mut logger::Log,
    index: Option<&'a Route>,
    static_list: StringHashMap<*const Route>,
    all_routes: Vec<Box<Route>>,
}

#[cfg(any())] // TODO(b1): logger::Log methods, Fs::Entry, bun_paths::extension/is_sep_any, StringHashMap::get_or_put
impl<'a> RouteLoader<'a> {
    pub fn append_route(&mut self, route: Route) {
        // /index.js
        if route.full_hash == index_route_hash() {
            let new_route = Box::new(route);
            // TODO(port): lifetime — index borrows from self.all_routes; self-referential
            // SAFETY: Box contents have stable address; never removed from all_routes until consumed by load_all
            self.index = Some(unsafe { &*(&*new_route as *const Route) });
            self.all_routes.push(new_route);
            return;
        }

        // static route
        if route.param_count == 0 {
            let entry = self
                .static_list
                .get_or_put(route.match_name.slice())
                .expect("unreachable");

            if entry.found_existing {
                let source = logger::Source::init_empty_file(route.abs_path.slice());
                self.log
                    .add_error_fmt(
                        Some(&source),
                        logger::Loc::EMPTY,
                        format_args!(
                            "Route \"{}\" is already defined by {}",
                            bstr::BStr::new(route.name),
                            // SAFETY: value_ptr points to a *const Route stored in static_list
                            bstr::BStr::new(unsafe { &**entry.value_ptr }.abs_path.slice()),
                        ),
                    )
                    .expect("unreachable");
                return;
            }

            let new_route = Box::new(route);
            let new_route_ptr: *const Route = &*new_route;

            // Handle static routes with uppercase characters by ensuring exact case still matches
            // Longer-term:
            // - We should have an option for controlling this behavior
            // - We should have an option for allowing case-sensitive matching
            // - But the default should be case-insensitive matching
            // This hack is below the engineering quality bar I'm happy with.
            // It will cause unexpected behavior.
            if new_route.has_uppercase {
                let static_entry = self
                    .static_list
                    .get_or_put(&new_route.name[1..])
                    .expect("unreachable");
                if static_entry.found_existing {
                    let source = logger::Source::init_empty_file(new_route.abs_path.slice());
                    self.log
                        .add_error_fmt(
                            Some(&source),
                            logger::Loc::EMPTY,
                            format_args!(
                                "Route \"{}\" is already defined by {}",
                                bstr::BStr::new(new_route.name),
                                // SAFETY: value_ptr points to a *const Route stored in static_list
                                bstr::BStr::new(
                                    unsafe { &**static_entry.value_ptr }.abs_path.slice()
                                ),
                            ),
                        )
                        .expect("unreachable");

                    return;
                }

                *static_entry.value_ptr = new_route_ptr;
            }

            *entry.value_ptr = new_route_ptr;
            self.all_routes.push(new_route);

            return;
        }

        {
            let entry = self
                .dedupe_dynamic
                .get_or_put_value(route.full_hash, route.abs_path.slice())
                .expect("unreachable");
            if entry.found_existing {
                let source = logger::Source::init_empty_file(route.abs_path.slice());
                self.log
                    .add_error_fmt(
                        Some(&source),
                        logger::Loc::EMPTY,
                        format_args!(
                            "Route \"{}\" is already defined by {}",
                            bstr::BStr::new(route.name),
                            bstr::BStr::new(*entry.value_ptr),
                        ),
                    )
                    .expect("unreachable");
                return;
            }
        }

        {
            let new_route = Box::new(route);
            self.all_routes.push(new_route);
        }
    }

    pub fn load_all<R: ResolverLike>(
        config: RouteConfig,
        log: &'a mut logger::Log,
        resolver: &mut R,
        root_dir_info: DirInfoRef,
        base_dir: &[u8],
    ) -> Routes<'a> {
        let mut route_dirname_len: u16 = 0;

        let relative_dir = FileSystem::instance().relative(base_dir, &config.dir);
        if !relative_dir.starts_with(b"..") {
            route_dirname_len = (relative_dir.len()
                + usize::from(config.dir[config.dir.len() - 1] != SEP))
                as u16;
        }

        let mut this = RouteLoader {
            log,
            fs: resolver.fs(),
            config: config.clone(),
            static_list: StringHashMap::new(),
            dedupe_dynamic: ArrayHashMap::new(),
            all_routes: Vec::new(),
            index: None,
            route_dirname_len,
        };
        // dedupe_dynamic dropped at end of scope (was `defer this.dedupe_dynamic.deinit()`)
        this.load(resolver, root_dir_info, base_dir);
        if this.all_routes.is_empty() {
            return Routes {
                static_: this.static_list,
                config,
                ..Routes::default()
            };
        }

        this.all_routes
            .sort_unstable_by(|a, b| Route::Sorter::sort_by_name_cmp(a, b));

        let mut route_list = RouteIndex::List::default();
        route_list
            .set_capacity(this.all_routes.len())
            .expect("unreachable");

        let mut dynamic_start: Option<usize> = None;
        let mut index_id: Option<usize> = None;

        for (i, route) in this.all_routes.into_iter().enumerate() {
            if (route.kind as u8) > (pattern::Tag::Static as u8) && dynamic_start.is_none() {
                dynamic_start = Some(i);
            }

            if route.full_hash == index_route_hash() {
                index_id = Some(i);
            }

            // PERF(port): was appendAssumeCapacity — profile in Phase B
            route_list.push(RouteIndex {
                name: route.name,
                filepath: route.abs_path.slice(),
                match_name: route.match_name.slice(),
                public_path: route.public_path.slice(),
                hash: route.full_hash,
                route,
            });
        }

        // TODO(port): self-referential slices into route_list columns — revisit in Phase B
        let mut dynamic: &'static [Box<Route>] = &[];
        let mut dynamic_names: &'static [&'static [u8]] = &[];
        let mut dynamic_match_names: &'static [&'static [u8]] = &[];

        if let Some(dynamic_i) = dynamic_start {
            // SAFETY: route_list outlives the returned Routes (it is moved into it).
            // These slices alias route_list's column storage; treated as 'static for Phase A.
            unsafe {
                dynamic = core::mem::transmute::<&[Box<Route>], &'static [Box<Route>]>(
                    &route_list.items_route()[dynamic_i..],
                );
                dynamic_names = core::mem::transmute::<&[&[u8]], &'static [&'static [u8]]>(
                    &route_list.items_name()[dynamic_i..],
                );
                dynamic_match_names = core::mem::transmute::<&[&[u8]], &'static [&'static [u8]]>(
                    &route_list.items_match_name()[dynamic_i..],
                );
            }

            if let Some(index_i) = index_id {
                if index_i > dynamic_i {
                    // Due to the sorting order, the index route can be the last route.
                    // We don't want to attempt to match the index route or different stuff will break.
                    dynamic = &dynamic[0..dynamic.len() - 1];
                    dynamic_names = &dynamic_names[0..dynamic_names.len() - 1];
                    dynamic_match_names =
                        &dynamic_match_names[0..dynamic_match_names.len() - 1];
                }
            }
        }

        Routes {
            list: route_list,
            dynamic,
            dynamic_names,
            dynamic_match_names,
            static_: this.static_list,
            index: this.index,
            config,
            index_id,
            client_framework_enabled: false,
        }
    }

    pub fn load<R: ResolverLike>(
        &mut self,
        resolver: &mut R,
        root_dir_info: DirInfoRef,
        base_dir: &[u8],
    ) {
        let fs = self.fs;

        if let Some(entries) = root_dir_info.get_entries_const() {
            let mut iter = entries.data.iterator();
            'outer: while let Some(entry_ptr) = iter.next() {
                let entry = *entry_ptr.value_ptr;
                if entry.base()[0] == b'.' {
                    continue 'outer;
                }

                match entry.kind(&fs.fs, false) {
                    Fs::EntryKind::Dir => {
                        for banned_dir in BANNED_DIRS.iter() {
                            if entry.base() == *banned_dir {
                                continue 'outer;
                            }
                        }

                        let abs_parts = [entry.dir, entry.base()];
                        if let Some(_dir_info) =
                            resolver.read_dir_info_ignore_error(fs.abs(&abs_parts))
                        {
                            let dir_info: DirInfoRef = _dir_info;

                            self.load(resolver, dir_info, base_dir);
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
                                // length is extended by one
                                // entry.dir is a string with a trailing slash
                                if cfg!(debug_assertions) {
                                    debug_assert!(bun_paths::is_sep_any(
                                        entry.dir[base_dir.len() - 1]
                                    ));
                                }

                                // SAFETY: entry.dir is at least base_dir.len()-1 bytes; verified above in debug
                                let public_dir =
                                    &entry.dir[base_dir.len() - 1..entry.dir.len()];

                                if let Some(route) = Route::parse(
                                    entry.base(),
                                    extname,
                                    entry,
                                    self.log,
                                    public_dir,
                                    self.route_dirname_len,
                                ) {
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
}

// Zig: `packed struct(u32) { offset: u16, len: u16 }` — bitcast-compatible u32.
#[repr(transparent)]
#[derive(Copy, Clone, Default, PartialEq, Eq)]
pub struct TinyPtr(u32);

impl TinyPtr {
    #[inline]
    pub const fn new(offset: u16, len: u16) -> Self {
        Self((offset as u32) | ((len as u32) << 16))
    }
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

    #[inline]
    pub fn to_string_pointer(self) -> api::StringPointer {
        api::StringPointer {
            offset: self.offset() as u32,
            length: self.len() as u32,
        }
    }

    #[inline]
    pub fn eql(a: TinyPtr, b: TinyPtr) -> bool {
        a == b
    }

    pub fn from(parent: &[u8], in_: &[u8]) -> TinyPtr {
        if in_.is_empty() || parent.is_empty() {
            return TinyPtr::default();
        }

        let right = in_.as_ptr() as usize + in_.len();
        let end = parent.as_ptr() as usize + parent.len();
        if cfg!(debug_assertions) {
            debug_assert!(end < right);
        }

        let length = end.max(right) - right;
        let offset = (in_.as_ptr() as usize).max(parent.as_ptr() as usize)
            - parent.as_ptr() as usize;
        TinyPtr::new(offset as u16, length as u16)
    }
}

// On windows we need to normalize this path to have forward slashes.
// To avoid modifying memory we do not own, allocate another buffer
#[cfg(windows)]
#[derive(Clone)]
pub struct AbsPath {
    pub path: Box<[u8]>,
}

#[cfg(windows)]
impl AbsPath {
    pub fn slice(&self) -> &[u8] {
        &self.path
    }
    pub fn is_empty(&self) -> bool {
        self.path.is_empty()
    }
}

#[cfg(not(windows))]
pub type AbsPath = PathString;

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
    pub match_name: PathString,

    pub basename: &'static [u8],
    pub full_hash: u32,
    pub param_count: u16,

    pub abs_path: AbsPath,

    /// URL-safe path for the route's transpiled script relative to project's top level directory
    /// - It might not share a prefix with the absolute path due to symlinks.
    /// - It has a leading slash
    pub public_path: PathString,

    pub kind: pattern::Tag,

    pub has_uppercase: bool,
}

// TODO(b1): inherent assoc types unstable; module-level alias instead.
pub type RoutePtr = TinyPtr;

impl Route {
    pub const INDEX_ROUTE_NAME: &'static [u8] = b"/";

    #[cfg(any())] // TODO(b1): Fs::Entry fields, FileSystem::dirname_store, bun_sys::open_file_absolute_z, bun_str::ZStr
    pub fn parse(
        base_: &[u8],
        extname: &[u8],
        entry: &mut Fs::Entry,
        log: &mut logger::Log,
        public_dir_: &[u8],
        routes_dirname_len: u16,
    ) -> Option<Route> {
        let mut abs_path_str: &[u8] = if entry.abs_path.is_empty() {
            b""
        } else {
            entry.abs_path.slice()
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
            let mut public_path: &[u8] = 'brk: {
                if base.is_empty() {
                    break 'brk public_dir;
                }
                let mut buf: &mut [u8] = &mut route_file_buf[..];

                if !public_dir.is_empty() {
                    route_file_buf[0] = b'/';
                    buf = &mut buf[1..];
                    buf[..public_dir.len()].copy_from_slice(public_dir);
                }
                buf[public_dir.len()] = b'/';
                buf = &mut buf[public_dir.len() + 1..];
                buf[..base.len()].copy_from_slice(base);
                buf = &mut buf[base.len()..];
                buf[..extname.len()].copy_from_slice(extname);
                buf = &mut buf[extname.len()..];

                let written_len =
                    buf.as_ptr() as usize - route_file_buf.as_ptr() as usize;

                #[cfg(windows)]
                {
                    bun_paths::platform_to_posix_in_place(&mut route_file_buf[0..written_len]);
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

            let mut match_name: &[u8] = name;

            let mut validation_result = pattern::ValidationResult::default();
            let is_index = name.is_empty();

            let mut has_uppercase = false;
            if !name.is_empty() {
                validation_result = match Pattern::validate(&name[1..], log) {
                    Some(v) => v,
                    None => return None,
                };

                let mut name_i: usize = 0;
                while !has_uppercase && name_i < public_path.len() {
                    has_uppercase =
                        public_path[name_i] >= b'A' && public_path[name_i] <= b'Z';
                    name_i += 1;
                }

                let name_offset =
                    name.as_ptr() as usize - public_path.as_ptr() as usize;

                if has_uppercase {
                    public_path = FileSystem::dirname_store()
                        .append(public_path)
                        .expect("unreachable");
                    name = &public_path[name_offset..][0..name.len()];
                    match_name = FileSystem::dirname_store()
                        .append_lower_case(&name[1..])
                        .expect("unreachable");
                } else {
                    public_path = FileSystem::dirname_store()
                        .append(public_path)
                        .expect("unreachable");
                    name = &public_path[name_offset..][0..name.len()];
                    match_name = &name[1..];
                }

                debug_assert!(match_name[0] != b'/');
                debug_assert!(name[0] == b'/');
            } else {
                name = Route::INDEX_ROUTE_NAME;
                match_name = Route::INDEX_ROUTE_NAME;

                public_path = FileSystem::dirname_store()
                    .append(public_path)
                    .expect("unreachable");
            }

            if abs_path_str.is_empty() {
                // TODO(port): replace std.fs.File with bun_sys::File / bun_sys::open
                let mut file: Option<bun_sys::File> = None;
                let mut needs_close = true;
                // defer if (needs_close) file.close();
                let _guard = scopeguard::guard((), |_| {
                    if needs_close {
                        if let Some(f) = file.take() {
                            f.close();
                        }
                    }
                });

                if let Some(valid) = entry.cache.fd.unwrap_valid() {
                    file = Some(valid.std_file());
                    needs_close = false;
                } else {
                    let parts = [entry.dir, entry.base()];
                    abs_path_str = FileSystem::instance().abs_buf(&parts, route_file_buf);
                    route_file_buf[abs_path_str.len()] = 0;
                    // SAFETY: NUL-terminated above
                    let buf = unsafe {
                        bun_str::ZStr::from_raw(route_file_buf.as_ptr(), abs_path_str.len())
                    };
                    match bun_sys::open_file_absolute_z(buf, bun_sys::OpenMode::ReadOnly) {
                        Ok(f) => {
                            file = Some(f);
                        }
                        Err(err) => {
                            needs_close = false;
                            log.add_error_fmt(
                                None,
                                logger::Loc::EMPTY,
                                format_args!(
                                    "{} opening route: {}",
                                    err.name(),
                                    bstr::BStr::new(abs_path_str)
                                ),
                            )
                            .expect("unreachable");
                            return None;
                        }
                    }
                    FileSystem::set_max_fd(file.as_ref().unwrap().handle());
                }

                let _abs = match bun_sys::get_fd_path(
                    Fd::from_std_file(file.as_ref().unwrap()),
                    route_file_buf,
                ) {
                    Ok(p) => p,
                    Err(err) => {
                        log.add_error_fmt(
                            None,
                            logger::Loc::EMPTY,
                            format_args!(
                                "{} resolving route: {}",
                                err.name(),
                                bstr::BStr::new(abs_path_str)
                            ),
                        )
                        .expect("unreachable");
                        return None;
                    }
                };

                abs_path_str = FileSystem::dirname_store()
                    .append(_abs)
                    .expect("unreachable");
                entry.abs_path = PathString::init(abs_path_str);
            }

            #[cfg(windows)]
            let abs_path = AbsPath {
                path: Box::<[u8]>::from(bun_paths::platform_to_posix_buf(
                    abs_path_str,
                    &mut bufs.normalized_abs_path_buf,
                )),
            };
            #[cfg(not(windows))]
            let abs_path = PathString::init(abs_path_str);

            #[cfg(all(debug_assertions, windows))]
            {
                debug_assert!(!strings::index_of_char(name, b'\\').is_some());
                debug_assert!(!strings::index_of_char(public_path, b'\\').is_some());
                debug_assert!(!strings::index_of_char(match_name, b'\\').is_some());
                debug_assert!(!strings::index_of_char(abs_path.slice(), b'\\').is_some());
                debug_assert!(!strings::index_of_char(entry.base(), b'\\').is_some());
            }

            // TODO(port): lifetime — name/match_name/public_path/abs_path_str borrow DirnameStore (static singleton)
            // SAFETY: DirnameStore is process-lifetime; treat as 'static for Phase A
            let name: &'static [u8] = unsafe { core::mem::transmute(name) };
            let match_name: &'static [u8] = unsafe { core::mem::transmute(match_name) };
            let public_path: &'static [u8] = unsafe { core::mem::transmute(public_path) };
            let basename: &'static [u8] = unsafe { core::mem::transmute(entry.base()) };

            Some(Route {
                name,
                basename,
                public_path: PathString::init(public_path),
                match_name: PathString::init(match_name),
                full_hash: if is_index {
                    index_route_hash()
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

pub mod Sorter {
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
        let a_name = a.match_name.slice();
        let b_name = b.match_name.slice();

        // route order determines route match order
        // - static routes go first because we match those first
        // - dynamic, catch-all, and optional catch all routes are sorted lexicographically, except "[", "]" appear last so that deepest routes are tested first
        // - catch-all & optional catch-all appear at the end because we want to test those at the end.
        match (a.kind as u8).cmp(&(b.kind as u8)) {
            Ordering::Equal => match a.kind {
                // static + dynamic are sorted alphabetically
                pattern::Tag::Static | pattern::Tag::Dynamic => {
                    // PERF(port): was @call(bun.callmod_inline, ...) — profile in Phase B
                    sort_by_name_string(a_name, b_name)
                }
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

// TODO(port): `impl Route { pub use Sorter }` is not valid Rust; Phase B should make
// `Sorter` an inherent module on `Route` via a wrapper type or move callers to `crate::Sorter`.
// B-1: callers use `crate::Sorter` directly.

struct RouteBufs {
    route_file_buf: PathBuffer,
    #[cfg(windows)]
    normalized_abs_path_buf: bun_sys::windows::PathBuffer,
}

thread_local! {
    static ROUTE_BUFS: RefCell<RouteBufs> = const {
        RefCell::new(RouteBufs {
            route_file_buf: PathBuffer::ZEROED,
            #[cfg(windows)]
            normalized_abs_path_buf: bun_sys::windows::PathBuffer::ZEROED,
        })
    };
}

thread_local! {
    static PARAMS_LIST: RefCell<route_param::List> = RefCell::new(route_param::List::default());
}

pub struct Match<'a> {
    /// normalized url path from the request
    pub path: &'a [u8],
    /// raw url path from the request
    pub pathname: &'a [u8],
    /// absolute filesystem path to the entry point
    pub file_path: &'a [u8],
    /// route name, like `"posts/[id]"`
    pub name: &'a [u8],

    pub client_framework_enabled: bool,

    /// basename of the route in the file system, including file extension
    pub basename: &'a [u8],

    pub hash: u32,
    pub params: &'a mut route_param::List,
    pub redirect_path: Option<&'a [u8]>,
    pub query_string: &'a [u8],
}

impl<'a> Match<'a> {
    #[inline]
    pub fn has_params(&self) -> bool {
        self.params.len() > 0
    }

    pub fn params_iterator(&self) -> PathnameScanner<'_> {
        PathnameScanner::init(self.pathname, self.name, self.params)
    }

    #[cfg(any())] // TODO(b1): bun_paths::extension missing
    pub fn name_with_basename<'s>(file_path: &'s [u8], dir: &[u8]) -> &'s [u8] {
        let mut name = file_path;
        if let Some(i) = strings::index_of(name, dir) {
            name = &name[i + dir.len()..];
        }

        &name[0..name.len() - bun_paths::extension(name).len()]
    }

    pub fn pathname_without_leading_slash(&self) -> &[u8] {
        b1_stubs::strings_ext::trim_left(self.pathname, b"/")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Traits introduced to replace Zig's `comptime T: type` duck-typing
// (Resolver, Server, RequestContext). Phase B should colocate these with
// the canonical types in bun_resolver / bun_runtime.
// ──────────────────────────────────────────────────────────────────────────

pub trait ResolverLike {
    fn fs(&self) -> &FileSystem;
    fn read_dir_info_ignore_error(&mut self, path: &[u8]) -> Option<DirInfoRef>;
}

pub trait WatcherLike {
    fn watchloop_handle(&self) -> Option<Fd>;
    fn start(&mut self) -> Result<(), CoreError>;
}

pub trait ServerLike {
    type Watcher: WatcherLike;
    /// Returns Some if the server has a watcher (replaces `@hasField`).
    fn watcher_mut(&mut self) -> Option<&mut Self::Watcher>;
}

pub trait RequestContextLike {
    fn url(&self) -> &URLPath;
    fn controlled(&self) -> bool;
    fn has_called_done(&self) -> bool;
    fn set_matched_route(&mut self, m: Option<Match<'_>>);
    fn handle_request(&mut self) -> Result<(), CoreError>;
    fn handle_redirect(&mut self, redirect: &[u8]) -> Result<(), CoreError>;
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
        pub fn match_<const ALLOW_OPTIONAL_CATCH_ALL: bool>(
            // `path` must be lowercased and have no leading slash
            path: &[u8],
            // case-sensitive, must not have a leading slash
            name: &[u8],
            // case-insensitive, must not have a leading slash
            match_name: &[u8],
            params: &mut route_param::List,
        ) -> bool {
            let mut offset: RoutePathInt = 0;
            let mut path_ = path;
            while (offset as usize) < name.len() {
                let mut pattern = Pattern::init(match_name, offset).expect("unreachable");
                offset = pattern.len;

                match pattern.value {
                    Value::Static(str_) => {
                        let segment = &path_[0..path_
                            .iter()
                            .position(|&b| b == b'/')
                            .unwrap_or(path_.len())];
                        if !str_.eql(segment) {
                            params.truncate(0); // TODO(b1): was shrink_retaining_capacity (MultiArrayList API)
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
                            // TODO(port): lifetime — borrows from `name` and `path_`
                            // SAFETY: name borrows route name (DirnameStore-backed), value borrows
                            // request path; both outlive the route_param::List owner. Phase B must thread
                            // the actual lifetime through Param instead of transmuting to 'static.
                            params.push(unsafe {
                                Param {
                                    name: core::mem::transmute(dynamic.str(name)),
                                    value: core::mem::transmute(&path_[0..i]),
                                }
                            });
                            path_ = &path_[i + 1..];

                            if pattern.is_end(name) {
                                params.truncate(0); // TODO(b1): was shrink_retaining_capacity (MultiArrayList API)
                                return false;
                            }

                            continue;
                        } else if pattern.is_end(name) {
                            // SAFETY: borrows route name / request path; outlive route_param::List owner
                            // (see lifetime TODO above).
                            params.push(unsafe {
                                Param {
                                    name: core::mem::transmute(dynamic.str(name)),
                                    value: core::mem::transmute(path_),
                                }
                            });
                            return true;
                        } else if ALLOW_OPTIONAL_CATCH_ALL {
                            pattern =
                                Pattern::init(match_name, offset).expect("unreachable");

                            if matches!(pattern.value, Value::OptionalCatchAll(_)) {
                                // SAFETY: borrows route name / request path; outlive route_param::List owner
                                // (see lifetime TODO above).
                                params.push(unsafe {
                                    Param {
                                        name: core::mem::transmute(dynamic.str(name)),
                                        value: core::mem::transmute(path_),
                                    }
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
                            // SAFETY: borrows route name / request path; outlive route_param::List owner
                            // (see lifetime TODO above).
                            params.push(unsafe {
                                Param {
                                    name: core::mem::transmute(dynamic.str(name)),
                                    value: core::mem::transmute(path_),
                                }
                            });
                            return true;
                        }

                        return false;
                    }
                    Value::OptionalCatchAll(dynamic) => {
                        if ALLOW_OPTIONAL_CATCH_ALL {
                            if !path_.is_empty() {
                                // SAFETY: borrows route name / request path; outlive route_param::List owner
                                // (see lifetime TODO above).
                                params.push(unsafe {
                                    Param {
                                        name: core::mem::transmute(dynamic.str(name)),
                                        value: core::mem::transmute(path_),
                                    }
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
        pub fn validate(input: &[u8], log: &mut logger::Log) -> Option<ValidationResult> {
            if b1_stubs::CodepointIterator::needs_utf8_decoding(input) {
                let source = logger::Source::init_empty_file(input);
                log.add_error_fmt(
                    Some(&source),
                    logger::Loc::EMPTY,
                    format_args!("Route name must be plaintext"),
                )
                .expect("unreachable");
                return None;
            }

            let mut count: u16 = 0;
            let mut offset: RoutePathInt = 0;
            debug_assert!(!input.is_empty());
            let mut kind: u8 = Tag::Static as u8;
            let end = (input.len() - 1) as u32;
            while (offset as u32) < end {
                let pattern: Pattern = match Pattern::init_unhashed(input, offset) {
                    Ok(p) => p,
                    Err(err) => {
                        let source = logger::Source::init_empty_file(input);
                        match err {
                            PatternParseError::CatchAllMustBeAtTheEnd => {
                                log.add_error_fmt(
                                    Some(&source),
                                    logger::Loc::EMPTY,
                                    format_args!(
                                        "Catch-all route must be at the end of the path"
                                    ),
                                )
                                .expect("unreachable");
                            }
                            PatternParseError::InvalidCatchAllRoute => {
                                log.add_error_fmt(
                                    Some(&source),
                                    logger::Loc::EMPTY,
                                    format_args!(
                                        "Invalid catch-all route, e.g. should be [...param]"
                                    ),
                                )
                                .expect("unreachable");
                            }
                            PatternParseError::InvalidOptionalCatchAllRoute => {
                                log.add_error_fmt(
                                    Some(&source),
                                    logger::Loc::EMPTY,
                                    format_args!(
                                        "Invalid optional catch-all route, e.g. should be [[...param]]"
                                    ),
                                )
                                .expect("unreachable");
                            }
                            PatternParseError::InvalidRoutePattern => {
                                log.add_error_fmt(
                                    Some(&source),
                                    logger::Loc::EMPTY,
                                    format_args!("Invalid dynamic route"),
                                )
                                .expect("unreachable");
                            }
                            PatternParseError::MissingParamName => {
                                log.add_error_fmt(
                                    Some(&source),
                                    logger::Loc::EMPTY,
                                    format_args!(
                                        "Route is missing a parameter name, e.g. [param]"
                                    ),
                                )
                                .expect("unreachable");
                            }
                            PatternParseError::PatternMissingClosingBracket => {
                                log.add_error_fmt(
                                    Some(&source),
                                    logger::Loc::EMPTY,
                                    format_args!("Route is missing a closing bracket]"),
                                )
                                .expect("unreachable");
                            }
                        }
                        return None;
                    }
                };
                offset = pattern.len;
                kind = kind.max(pattern.value.tag() as u8);
                count += u16::from((pattern.value.tag() as u8) > (Tag::Static as u8));
            }

            Some(ValidationResult {
                param_count: count,
                // SAFETY: kind only ever assigned from Tag discriminants
                kind: unsafe { core::mem::transmute::<u8, Tag>(kind) },
            })
        }

        pub fn eql(a: Pattern, b: Pattern) -> bool {
            a.len == b.len && Value::eql(&a.value, &b.value)
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

            let mut tag = Tag::Static;
            let end: RoutePathInt =
                u16::try_from(input.len() - 1).expect("route path fits in u16");

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

                        tag = Tag::Dynamic;

                        let mut param = TinyPtr::default();

                        i += 1;

                        param.set_offset(i);

                        if i >= end {
                            return Err(PatternParseError::InvalidRoutePattern);
                        }

                        match input[i as usize] {
                            b'/' | b']' => {
                                return Err(PatternParseError::MissingParamName)
                            }
                            b'[' => {
                                tag = Tag::OptionalCatchAll;

                                if end < i + 4 {
                                    return Err(
                                        PatternParseError::InvalidOptionalCatchAllRoute,
                                    );
                                }

                                i += 1;

                                if !input[i as usize..].starts_with(b"...") {
                                    return Err(
                                        PatternParseError::InvalidOptionalCatchAllRoute,
                                    );
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
                            if input[i as usize] != b']' {
                                return Err(
                                    PatternParseError::PatternMissingClosingBracket,
                                );
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
                value: Value::Static(HashedString::init(
                    &input[offset as usize..i as usize],
                )),
            })
        }
    }

    #[derive(Clone, Copy, Default)]
    pub struct ValidationResult {
        pub param_count: u16,
        pub kind: Tag,
    }

    // TODO(b1): thiserror not in deps; manual Display/Error impl.
    #[derive(strum::IntoStaticStr, Debug, Clone, Copy)]
    pub enum PatternParseError {
        CatchAllMustBeAtTheEnd,
        InvalidCatchAllRoute,
        InvalidOptionalCatchAllRoute,
        InvalidRoutePattern,
        MissingParamName,
        PatternMissingClosingBracket,
    }
    impl core::fmt::Display for PatternParseError {
        fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
            f.write_str(<&'static str>::from(*self))
        }
    }
    impl std::error::Error for PatternParseError {}

    #[repr(u8)]
    #[derive(Clone, Copy, PartialEq, Eq, Default, strum::IntoStaticStr)]
    pub enum Tag {
        #[default]
        Static = 0,
        Dynamic = 1,
        CatchAll = 2,
        OptionalCatchAll = 3,
    }

    #[derive(Clone, Copy)]
    pub enum Value {
        Static(HashedString),
        Dynamic(TinyPtr),
        CatchAll(TinyPtr),
        OptionalCatchAll(TinyPtr),
    }

    impl Value {
        pub fn tag(&self) -> Tag {
            match self {
                Value::Static(_) => Tag::Static,
                Value::Dynamic(_) => Tag::Dynamic,
                Value::CatchAll(_) => Tag::CatchAll,
                Value::OptionalCatchAll(_) => Tag::OptionalCatchAll,
            }
        }

        pub fn eql(a: &Value, b: &Value) -> bool {
            a.tag() == b.tag()
                && match (a, b) {
                    (Value::Static(a), Value::Static(b)) => HashedString::eql_hashed(*a, *b),
                    (Value::Dynamic(a), Value::Dynamic(b)) => TinyPtr::eql(*a, *b),
                    (Value::CatchAll(a), Value::CatchAll(b)) => TinyPtr::eql(*a, *b),
                    (Value::OptionalCatchAll(a), Value::OptionalCatchAll(b)) => {
                        TinyPtr::eql(*a, *b)
                    }
                    _ => false,
                }
        }
    }
}

pub use pattern::Pattern;

// ──────────────────────────────────────────────────────────────────────────
// Tests + test helpers
// ──────────────────────────────────────────────────────────────────────────

#[cfg(any())] // TODO(b1): tests depend on gated impls
#[cfg(test)]
mod tests {
    use super::*;

    struct MockRequestContextType {
        controlled: bool,
        url: URLPath,
        match_file_path_buf: [u8; 1024],

        handle_request_called: bool,
        redirect_called: bool,
        matched_route: Option<Match<'static>>,
        has_called_done: bool,
    }

    impl Default for MockRequestContextType {
        fn default() -> Self {
            Self {
                controlled: false,
                url: URLPath::default(),
                match_file_path_buf: [0; 1024],
                handle_request_called: false,
                redirect_called: false,
                matched_route: None,
                has_called_done: false,
            }
        }
    }

    impl MockRequestContextType {
        fn handle_request(&mut self) -> Result<(), bun_core::Error> {
            self.handle_request_called = true;
            Ok(())
        }

        fn handle_redirect(&mut self, _: &[u8]) -> Result<(), bun_core::Error> {
            self.redirect_called = true;
            Ok(())
        }
    }

    struct JavaScriptHandler;
    impl JavaScriptHandler {
        fn enqueue(
            _: &mut MockRequestContextType,
            _: &mut MockServer,
            _: &mut route_param::List,
        ) -> Result<(), bun_core::Error> {
            Ok(())
        }
    }

    pub struct MockServer {
        watchloop_handle: Option<Fd>,
        watcher: MockWatcher,
    }

    impl Default for MockServer {
        fn default() -> Self {
            Self {
                watchloop_handle: None,
                watcher: MockWatcher::default(),
            }
        }
    }

    #[derive(Default)]
    pub struct MockWatcher {
        watchloop_handle: Option<Fd>,
    }
    impl MockWatcher {
        pub fn start(&mut self) -> Result<(), bun_core::Error> {
            Ok(())
        }
    }

    fn make_test(cwd_path: &[u8], data: &[(&str, &str)]) -> Result<(), bun_core::Error> {
        // TODO(port): Zig used comptime field iteration over an anonymous struct.
        // Ported as runtime slice of (path, content) pairs.
        // TODO(port): replace std::fs usage with bun_sys — banned per PORTING.md
        Output::init_test();
        debug_assert!(
            cwd_path.len() > 1 && cwd_path != b"/" && !cwd_path.ends_with(b"bun")
        );
        let _ = (cwd_path, data);
        // TODO(port): bun_sys directory creation + file writing
        unimplemented!("make_test: filesystem setup pending bun_sys port");
    }

    pub struct Test;

    impl Test {
        pub fn make_routes(
            test_name: &'static str,
            data: &[(&str, &str)],
        ) -> Result<Routes<'static>, bun_core::Error> {
            // TODO(port): heavy comptime + Resolver/Options wiring; stubbed for Phase A.
            let _ = (test_name, data);
            unimplemented!("Test::make_routes pending bun_resolver/bun_bundler port");
        }

        pub fn make(
            test_name: &'static str,
            data: &[(&str, &str)],
        ) -> Result<Router<'static>, bun_core::Error> {
            // TODO(port): heavy comptime + Resolver/Options wiring; stubbed for Phase A.
            let _ = (test_name, data);
            unimplemented!("Test::make pending bun_resolver/bun_bundler port");
        }
    }

    #[test]
    fn pattern_match() {
        Output::init_test();
        type Entry = Param;

        // TODO(port): Zig used anonymous-struct field iteration; ported as explicit array.
        let regular_list: &[(&[u8], &[u8], &[Entry])] = &[
            (b"404", b"404", &[]),
            (
                b"[teamSlug]",
                b"value",
                &[Entry { name: b"teamSlug", value: b"value" }],
            ),
            (
                b"hi/hello/[teamSlug]",
                b"hi/hello/123",
                &[Entry { name: b"teamSlug", value: b"123" }],
            ),
            (
                b"hi/[teamSlug]/hello",
                b"hi/123/hello",
                &[Entry { name: b"teamSlug", value: b"123" }],
            ),
            (
                b"[teamSlug]/hi/hello",
                b"123/hi/hello",
                &[Entry { name: b"teamSlug", value: b"123" }],
            ),
            (
                b"[teamSlug]/[project]",
                b"team/bacon",
                &[
                    Entry { name: b"teamSlug", value: b"team" },
                    Entry { name: b"project", value: b"bacon" },
                ],
            ),
            (
                b"lemon/[teamSlug]/[project]",
                b"lemon/team/bacon",
                &[
                    Entry { name: b"teamSlug", value: b"team" },
                    Entry { name: b"project", value: b"bacon" },
                ],
            ),
            (
                b"[teamSlug]/[project]/lemon",
                b"team/bacon/lemon",
                &[
                    Entry { name: b"teamSlug", value: b"team" },
                    Entry { name: b"project", value: b"bacon" },
                ],
            ),
            (
                b"[teamSlug]/lemon/[project]",
                b"team/lemon/lemon",
                &[
                    Entry { name: b"teamSlug", value: b"team" },
                    Entry { name: b"project", value: b"lemon" },
                ],
            ),
            (
                b"[teamSlug]/lemon/[...project]",
                b"team/lemon/lemon-bacon-cheese/wow/brocollini",
                &[
                    Entry { name: b"teamSlug", value: b"team" },
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
                    Entry { name: b"teamSlug", value: b"team" },
                    Entry { name: b"project", value: b"lemon" },
                    Entry { name: b"slug", value: b"slugggg" },
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
                    Entry { name: b"teamSlug", value: b"team" },
                    Entry { name: b"project", value: b"lemon" },
                    Entry { name: b"slug", value: b"slugggg" },
                ],
            ),
        ];

        fn run(list: &[(&[u8], &[u8], &[Entry])]) -> usize {
            let mut parameters = route_param::List::default();
            let mut failures: usize = 0;
            for (pattern, pathname, entries) in list.iter() {
                parameters.shrink_retaining_capacity(0);

                'fail: {
                    if !Pattern::match_::<true>(pathname, pattern, pattern, &mut parameters) {
                        Output::pretty_errorln(format_args!(
                            "Expected pattern <b>\"{}\"<r> to match <b>\"{}\"<r>",
                            bstr::BStr::new(pattern),
                            bstr::BStr::new(pathname)
                        ));
                        failures += 1;
                        break 'fail;
                    }

                    if !entries.is_empty() {
                        for (i, entry_name) in parameters.items_name().iter().enumerate() {
                            if *entry_name != entries[i].name {
                                failures += 1;
                                Output::pretty_errorln(format_args!(
                                    "{} -- Expected name <b>\"{}\"<r> but received <b>\"{}\"<r> for path {}",
                                    bstr::BStr::new(pattern),
                                    bstr::BStr::new(entries[i].name),
                                    bstr::BStr::new(parameters.get(i).name),
                                    bstr::BStr::new(pathname)
                                ));
                                break 'fail;
                            }
                            if parameters.get(i).value != entries[i].value {
                                failures += 1;
                                Output::pretty_errorln(format_args!(
                                    "{} -- Expected value <b>\"{}\"<r> but received <b>\"{}\"<r> for path {}",
                                    bstr::BStr::new(pattern),
                                    bstr::BStr::new(entries[i].value),
                                    bstr::BStr::new(parameters.get(i).value),
                                    bstr::BStr::new(pathname)
                                ));
                                break 'fail;
                            }
                        }
                    }

                    if parameters.len() != entries.len() {
                        Output::pretty_errorln(format_args!(
                            "Expected parameter count for <b>\"{}\"<r> to match <b>\"{}\"<r>",
                            bstr::BStr::new(pattern),
                            bstr::BStr::new(pathname)
                        ));
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

    #[test]
    #[ignore = "TODO(port): depends on Test::make filesystem fixture harness"]
    fn github_api_route_loader() {
        // TODO(port): port body once Test::make is implemented; see router.zig:1571-1678
    }

    #[test]
    #[ignore = "TODO(port): depends on Test::make filesystem fixture harness"]
    fn sample_route_loader() {
        // TODO(port): port body once Test::make is implemented; see router.zig:1680-1782
    }

    #[test]
    #[ignore = "TODO(port): depends on Test::make filesystem fixture harness"]
    fn routes_basic() {
        // TODO(port): port body once Test::make is implemented; see router.zig:1784-1832
    }

    #[test]
    #[ignore = "TODO(port): depends on Test::make filesystem fixture harness"]
    fn dynamic_routes() {
        // TODO(port): port body once Test::make is implemented; see router.zig:1834-1868
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/router/router.zig (1918 lines)
//   confidence: medium
//   todos:      24
//   notes:      Routes/RouteLoader self-reference Box<Route> in MultiArrayList (raw ptrs/'static transmute placeholder); Param/Route string fields treated as &'static (DirnameStore-backed) — Pattern::match_ transmutes name/path borrows into Param, Phase B must thread real lifetime; test harness (make_test/Test::make + 4 fixture-driven tests) stubbed pending bun_sys/bun_resolver; Route::Sorter nested-module shim is invalid Rust syntax — Phase B must hoist callers; TinyPtr is repr(transparent) u32 with shift accessors (Zig packed struct(u32))
// ──────────────────────────────────────────────────────────────────────────
