#![allow(unused, dead_code, non_snake_case, private_interfaces)]
#![warn(unused_must_use)]
// This is a Next.js-compatible file-system router.
// It uses the filesystem to infer entry points.
// Despite being Next.js-compatible, it's not tied to Next.js.
// It does not handle the framework parts of rendering pages.
// All it does is resolve URL paths to the appropriate entry point and parse URL params/query.
#![warn(unreachable_pub)]
use core::cmp::Ordering;
use core::ptr::NonNull;
use std::cell::RefCell;

use bun_collections::{ArrayHashMap, MultiArrayList, StringHashMap};
use bun_core::Output;
use bun_core::strings;
use bun_paths::{self, PathBuffer, SEP, SEP_STR};
use bun_sys::Fd;
use bun_url::PathnameScanner;

use bun_http_types::URLPath::URLPath;

// ──────────────────────────────────────────────────────────────────────────
// Cross-crate name aliases. These are pure re-exports of real lower-tier types
// (no shadow structs); kept as a private module so Zig-shaped paths
// (`bun_ast::Log`, `Fs::Entry`, `api::LoadedRouteConfig`) read naturally.
// ──────────────────────────────────────────────────────────────────────────
// `bun.hash(bytes)` — std.hash.Wyhash seed 0. NOT Wyhash11 (different algo).
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

// peechy schema types: `StringPointer` lives in `bun_core::schema::api` (T0);
// the route-config pair lives in `bun_options_types::schema::api`.
mod api {
    pub(crate) use bun_core::schema::api::StringPointer;
    pub(crate) use bun_options_types::schema::api::{LoadedRouteConfig, RouteConfig};
}

type CoreError = bun_core::Error;

use bun_core::{HashedString, PathString};

/// Every `PathString` stored on a [`Route`] wraps bytes interned in
/// `FileSystem::dirname_store()` (process-lifetime arena — `append` returns
/// `&'static [u8]`). `PathString::slice()` conservatively ties the borrow to
/// `&self`; this re-widens it to the true `'static` lifetime so the slice can
/// outlive the (Copy) `PathString` carrier and be stored in the SoA columns of
/// [`RouteIndexList`] / `dedupe_dynamic`.
///
/// # Safety
/// `ps` MUST have been constructed via `PathString::init(s)` where `s` was
/// returned by `DirnameStore::append`/`append_lower_case` (or is a `'static`
/// literal). All `Route` path fields satisfy this by construction in
/// [`Route::parse`].
#[inline]
unsafe fn arena_slice(ps: PathString) -> &'static [u8] {
    let s = ps.slice();
    // SAFETY: caller contract — backing storage is the process-lifetime
    // DirnameStore singleton; the `&'_ self` lifetime on `slice()` is an
    // artificially-short reborrow.
    unsafe { core::slice::from_raw_parts(s.as_ptr(), s.len()) }
}

// `load_routes` takes the real `bun_ast::Log`. Kept as a re-export so
// out-of-crate callers don't need a direct `bun_logger` import for the type.
use bun_ast::Log as RouteLoaderLog;

// ──────────────────────────────────────────────────────────────────────────
// cross-tier decoupling
// ──────────────────────────────────────────────────────────────────────────

// Ground truth: src/bundler/options.zig `pub const RouteConfig = struct { ... }`.
// Defined here so T4 router is self-contained; `bun_bundler::options` re-exports
// this (`pub use bun_router::RouteConfig`) so the original path keeps resolving.
#[derive(Debug, Clone, Default)]
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
            dir: if self.routes_enabled {
                self.dir.clone()
            } else {
                Box::default()
            },
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

    pub fn from_api(router_: &api::RouteConfig) -> Result<RouteConfig, CoreError> {
        use bun_core::strings::{trim_left, trim_right};

        let mut router = Self::zero();

        let static_dir: &[u8] = trim_right(router_.static_dir.as_deref().unwrap_or(b""), b"/\\");
        let asset_prefix: &[u8] =
            trim_right(router_.asset_prefix.as_deref().unwrap_or(b""), b"/\\");

        match router_.dir.len() {
            0 => {}
            1 => {
                router.dir = Box::from(trim_right(&router_.dir[0], b"/\\"));
                router.routes_enabled = !router.dir.is_empty();
            }
            _ => {
                router.possible_dirs = router_.dir.clone();
                for dir in router_.dir.iter() {
                    let trimmed = trim_right(dir, b"/\\");
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
                let ext = trim_left(_ext, b".");
                if ext.is_empty() {
                    continue;
                }
                count += 1;
            }

            let mut extensions: Vec<Box<[u8]>> = Vec::with_capacity(count);
            for _ext in router_.extensions.iter() {
                let ext = trim_left(_ext, b".");
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

// const index_route_hash = @truncate(bun.hash("$$/index-route$$-!(@*@#&*%-901823098123"))
// TODO(port): make this a true const once bun_wyhash::hash is const fn
fn index_route_hash() -> u32 {
    wyhash(b"$$/index-route$$-!(@*@#&*%-901823098123") as u32
}

// Param/List are lifetime-parameterized: `name` borrows the route name
// (DirnameStore-backed) and `value` borrows the *request URL buffer*. The Zig
// version stores raw slices with no ownership; the correct Rust port is a
// borrowed `&'a [u8]`, not a forged `'static`.
//
// `bun_url::route_param::Param<'a>` is now lifetime-generic (TYPE_ONLY
// move-down landed); collapse the local copy to a re-export so the param list
// type matches `PathnameScanner::init`.
pub use bun_url::route_param;
pub use route_param::Param;

pub struct Router<'a> {
    pub dir: Fd,
    pub routes: Routes,
    pub loaded_routes: bool,
    // allocator dropped — global mimalloc
    pub fs: &'a FileSystem,
    pub config: RouteConfig,
}

impl<'a> Router<'a> {
    pub fn init(fs: &'a FileSystem, config: RouteConfig) -> Result<Router<'a>, CoreError> {
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

        // PERF(port): Zig reused a threadlocal `params_list` to avoid realloc.
        // A borrowed `List<'a>` cannot soundly live in a `'static` thread_local,
        // so we allocate per-request; revisit with an arena/SmallVec if hot.
        {
            let mut params_list = route_param::List::default();
            if let Some(route) = app
                .routes
                .match_page(&app.config.dir, ctx.url(), &mut params_list)
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
        }

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

// TODO(b2-blocked): bun_collections::MultiArrayElement derive — proc-macro not
// yet landed, so MultiArrayList<RouteIndex> can't expose per-field column
// accessors. Hand-rolled SoA struct (semantically identical to Zig's
// MultiArrayList(RouteIndex)) until the derive exists.
#[derive(Default)]
pub struct RouteIndexList {
    route: Vec<Box<Route>>,
    name: Vec<&'static [u8]>,
    match_name: Vec<&'static [u8]>,
    filepath: Vec<&'static [u8]>,
    public_path: Vec<&'static [u8]>,
    hash: Vec<u32>,
}

impl RouteIndexList {
    pub fn set_capacity(&mut self, cap: usize) -> Result<(), CoreError> {
        self.route.reserve_exact(cap);
        self.name.reserve_exact(cap);
        self.match_name.reserve_exact(cap);
        self.filepath.reserve_exact(cap);
        self.public_path.reserve_exact(cap);
        self.hash.reserve_exact(cap);
        Ok(())
    }
    pub fn push(&mut self, item: RouteIndex) {
        self.route.push(item.route);
        self.name.push(item.name);
        self.match_name.push(item.match_name);
        self.filepath.push(item.filepath);
        self.public_path.push(item.public_path);
        self.hash.push(item.hash);
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
    #[inline]
    pub fn items_public_path(&self) -> &[&'static [u8]] {
        &self.public_path
    }
    #[inline]
    pub fn items_hash(&self) -> &[u32] {
        &self.hash
    }
}

pub struct Routes {
    pub list: RouteIndexList,
    /// Index into `list`'s columns where dynamic routes begin (sorted after
    /// static). Stored as an offset+len instead of materialized slices to avoid
    /// a self-referential struct — Zig sliced `route_list.items(.route)[i..]`
    /// directly; in Rust we re-slice on each `match_dynamic` call.
    pub dynamic_start: Option<usize>,
    pub dynamic_len: usize,

    /// completely static children of indefinite depth
    /// `"blog/posts"`
    /// `"dashboard"`
    /// `"profiles"`
    /// this is a fast path?
    pub static_: StringHashMap<*const Route>,

    /// Corresponds to "index.js" on the filesystem.
    /// Spec (router.zig:386-396) stores `index: ?*Route` — a raw pointer
    /// co-owned with `list` (points into a `Box<Route>` owned by
    /// `list.route`). Stored as `NonNull` (not `&'a Route`) so `Routes` claims
    /// no borrow it doesn't actually take; matches `static_` above.
    pub index: Option<NonNull<Route>>,
    pub index_id: Option<usize>,

    // allocator dropped — global mimalloc
    pub config: RouteConfig,

    // This is passed here and propagated through Match
    // We put this here to avoid loading the FrameworkConfig for the client, on the server.
    pub client_framework_enabled: bool,
}

impl Default for Routes {
    fn default() -> Self {
        Self {
            list: RouteIndexList::default(),
            dynamic_start: None,
            dynamic_len: 0,
            static_: StringHashMap::new(),
            index: None,
            index_id: Some(0),
            config: RouteConfig::default(),
            client_framework_enabled: false,
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

        // PORT NOTE: Zig moved params into a local MatchContextType then back via
        // defer; in Rust a plain reborrow suffices.
        if let Some(route_ptr) = self.match_(path, params) {
            // SAFETY: pointers from static_/dynamic alias Box<Route> stored in
            // self.list, which outlives self.
            let route = unsafe { &*route_ptr };
            return Some(Match {
                params: std::ptr::from_mut(params),
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
        url_path: &URLPath,
        params: &'p mut route_param::List<'p>,
    ) -> Option<Match<'p>> {
        self.match_page_with_allocator(b"", url_path, params)
    }

    fn match_dynamic<'p>(
        &self,
        path: &'p [u8],
        params: &mut route_param::List<'p>,
    ) -> Option<*const Route> {
        // its cleaned, so now we search the big list of strings
        let Some(start) = self.dynamic_start else {
            return None;
        };
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
    // PORT NOTE: raw NonNull (not &'a Route) because it points into self.all_routes
    // (self-referential); `Routes` co-owns it with `list`.
    index: Option<NonNull<Route>>,
    static_list: StringHashMap<*const Route>,
    all_routes: Vec<Box<Route>>,
}

impl<'a> RouteLoader<'a> {
    pub(crate) fn append_route(&mut self, route: Route) {
        use bun_collections::hash_map::Entry;

        // /index.js
        if route.full_hash == index_route_hash() {
            let new_route = Box::new(route);
            // SAFETY: Box contents have stable address; never removed from all_routes until consumed by load_all
            self.index = Some(NonNull::from(&*new_route));
            self.all_routes.push(new_route);
            return;
        }

        // static route
        if route.param_count == 0 {
            // PORT NOTE: Zig getOrPut → std Entry API (StringHashMap = std HashMap).
            if let Some(existing) = self.static_list.get(route.match_name.slice()) {
                let source = bun_ast::Source::init_empty_file(route.abs_path.slice());
                self.log.add_error_fmt(
                    Some(&source),
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "Route \"{}\" is already defined by {}",
                        bstr::BStr::new(route.name),
                        // SAFETY: *existing aliases a Box<Route> in self.all_routes
                        bstr::BStr::new(unsafe { &**existing }.abs_path.slice()),
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
                    let source = bun_ast::Source::init_empty_file(new_route.abs_path.slice());
                    self.log.add_error_fmt(
                        Some(&source),
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "Route \"{}\" is already defined by {}",
                            bstr::BStr::new(new_route.name),
                            // SAFETY: *existing aliases a Box<Route> in self.all_routes
                            bstr::BStr::new(unsafe { &**existing }.abs_path.slice()),
                        ),
                    );

                    return;
                }

                self.static_list
                    .put_assume_capacity(&new_route.name[1..], new_route_ptr);
            }

            self.static_list
                .put_assume_capacity(new_route.match_name.slice(), new_route_ptr);
            self.all_routes.push(new_route);

            return;
        }

        {
            match self.dedupe_dynamic.entry(route.full_hash) {
                Entry::Occupied(e) => {
                    let source = bun_ast::Source::init_empty_file(route.abs_path.slice());
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
                    // SAFETY: `Route::parse` interned `abs_path` via DirnameStore.
                    v.insert(unsafe { arena_slice(route.abs_path) });
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

        // Zig: `FileSystem.instance().relative(base_dir, config.dir)` — thin wrapper
        // around `path_handler.relative` (resolver/fs.zig:439). Call bun_paths directly
        // to avoid the higher-tier bun_resolver dep.
        let relative_dir = bun_paths::resolve_path::relative(base_dir, &config.dir);
        if !relative_dir.starts_with(b"..") {
            route_dirname_len =
                (relative_dir.len() + usize::from(config.dir[config.dir.len() - 1] != SEP)) as u16;
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
            .sort_unstable_by(|a, b| Sorter::sort_by_name_cmp(a, b));

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

            if route.full_hash == index_route_hash() {
                index_id = Some(i);
            }

            // PERF(port): was appendAssumeCapacity — profile in Phase B
            // SAFETY: `Route::parse` interned every PathString field via
            // `DirnameStore::append{,_lower_case}` (process-lifetime arena).
            let (filepath, match_name, public_path) = unsafe {
                (
                    arena_slice(route.abs_path),
                    arena_slice(route.match_name),
                    arena_slice(route.public_path),
                )
            };
            route_list.push(RouteIndex {
                name: route.name,
                filepath,
                match_name,
                public_path,
                hash: route.full_hash,
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
            // pointer (router.zig:386-396 stores `?*Route`).
            index: this.index,
            config,
            index_id,
            client_framework_enabled: false,
        }
    }

    pub(crate) fn load<R: ResolverLike>(
        &mut self,
        resolver: &mut R,
        root_dir_info: &DirInfo,
        base_dir: &[u8],
    ) {
        let fs = self.fs;

        if let Some(entries) = root_dir_info.get_entries_const() {
            let mut iter = entries.iter();
            'outer: while let Some(entry_ptr) = iter.next() {
                // PORT NOTE: `iter()` yields raw `*mut Entry` (matching Zig's
                // `*Entry` map value type, fs.zig:117). Reborrow locally for
                // each access so `&` reads and the `&mut` `kind()` call do not
                // overlap. Single iterator active for this scan; serialized via
                // `RealFS.entries_mutex`.
                // SAFETY: EntryStore-owned, valid for process lifetime.
                if unsafe { &*entry_ptr }.base()[0] == b'.' {
                    continue 'outer;
                }

                // Zig: `entry.kind(&fs.fs, false)` (router.zig:416). Thread the
                // resolver's fs `Implementation` through — `Entry.kind` derefs
                // it to lazily stat when `need_stat` is true, so null would be
                // a latent crash / silent route-drop once the stub forwards it.
                // Zig `Entry.Kind` is exactly `{dir, file}` (resolver/fs.zig:378).
                // SAFETY: no other live borrow of `*entry_ptr` here.
                let kind = unsafe { &mut *entry_ptr }.kind(resolver.fs_impl(), false);
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
                        if let Some(dir_info) =
                            resolver.read_dir_info_ignore_error(&fs.abs(&abs_parts))
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
                                // length is extended by one
                                // entry.dir is a string with a trailing slash
                                let entry_dir = entry.dir();
                                if cfg!(debug_assertions) {
                                    debug_assert!(bun_paths::resolve_path::is_sep_any(
                                        entry_dir[base_dir.len() - 1]
                                    ));
                                }

                                // SAFETY: entry.dir is at least base_dir.len()-1 bytes; verified above in debug
                                let public_dir = &entry_dir[base_dir.len() - 1..entry_dir.len()];

                                if let Some(route) = Route::parse(
                                    entry.base(),
                                    extname,
                                    entry_ptr,
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
        let offset =
            (in_.as_ptr() as usize).max(parent.as_ptr() as usize) - parent.as_ptr() as usize;
        TinyPtr::new(offset as u16, length as u16)
    }
}

// On Windows we need to normalize this path to have forward slashes.
// Zig heap-allocates a separate buffer (`allocator.dupe`) so it doesn't mutate
// memory it doesn't own (router.zig:537-547). The Rust port interns the
// normalized path into `DirnameStore` (process-lifetime arena) instead, so
// `abs_path` is uniformly a `PathString` over `'static` bytes on every
// platform — keeping `RouteIndexList.filepath: &'static [u8]` sound and
// avoiding the borrow-then-move at `RouteLoader::load_all`.
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

    pub fn parse(
        base_: &[u8],
        extname: &[u8],
        entry: *mut Fs::Entry,
        log: &mut bun_ast::Log,
        public_dir_: &[u8],
        routes_dirname_len: u16,
    ) -> Option<Route> {
        // PORT NOTE: `entry` is a raw `*mut Entry` (matching Zig's `*Entry`)
        // because `base_`/`extname` may borrow `(*entry).base_` (tiny inline
        // string, fs.zig:333) and a `&mut Entry` parameter would alias them.
        // Reads go through `unsafe { &*entry }`; the single mutation
        // (`set_abs_path`) goes through `unsafe { &mut *entry }` after
        // `base_`/`extname` are no longer used.
        // PORT NOTE: reshaped for borrowck — bind the `PathString` so the
        // `.slice()` borrow lives across the closure below.
        // SAFETY: caller passes an EntryStore-owned pointer valid for the
        // process lifetime; no other live `&mut` to it during this call.
        let entry_abs_path_ps = unsafe { &*entry }.abs_path();
        let entry_abs_path = entry_abs_path_ps.slice();
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
            let mut public_path: &[u8] = 'brk: {
                if base.is_empty() {
                    break 'brk public_dir;
                }
                let mut buf: &mut [u8] = &mut route_file_buf[..];

                if !public_dir.is_empty() {
                    // PORT NOTE: reshaped for borrowck — `buf` already aliases
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
            // PORT NOTE: reshaped for borrowck — both arms intern via DirnameStore
            // (process-lifetime arena → `&'static`), so the post-if bindings are
            // 'static and the route_file_buf borrow is dropped before the
            // abs-path block below needs it mutably.
            let (public_path, name, match_name): (&'static [u8], &'static [u8], &'static [u8]) =
                if !name.is_empty() {
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

                    // PORT NOTE: DirnameStore::append returns `&'static [u8]` (process-
                    // lifetime arena), so rebinding here drops the borrow on
                    // `route_file_buf` and removes the need for the Phase-A
                    // lifetime transmutes that were below.
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
                    (public_path, name, match_name)
                } else {
                    let dirname_store = FileSystem::instance().dirname_store();
                    let public_path: &'static [u8] =
                        dirname_store.append(public_path).expect("unreachable");
                    (
                        public_path,
                        Route::INDEX_ROUTE_NAME,
                        Route::INDEX_ROUTE_NAME,
                    )
                };

            if abs_path_str.is_empty() {
                // PORT NOTE: reshaped for borrowck — `defer if (needs_close) file.close()`
                // becomes a scopeguard owning the Option<File>; `needs_close` is a
                // Cell so the drop closure can read it while the body still mutates.
                let needs_close = core::cell::Cell::new(true);
                let mut file = scopeguard::guard(None::<bun_sys::File>, |f| {
                    if needs_close.get() {
                        if let Some(f) = f {
                            let _ = f.close();
                        }
                    }
                });

                // SAFETY: see fn-level PORT NOTE — read-only reborrow.
                if let Some(valid) = unsafe { &*entry }.cache().fd.unwrap_valid() {
                    *file = Some(bun_sys::File::from_fd(valid));
                    needs_close.set(false);
                } else {
                    // SAFETY: see fn-level PORT NOTE — read-only reborrow.
                    let entry_r = unsafe { &*entry };
                    let parts = [entry_r.dir(), entry_r.base()];
                    let abs_len = FileSystem::instance().abs_buf(&parts, route_file_buf).len();
                    // Zig: `abs_path_str = FileSystem.instance.absBuf(...)`
                    // (router.zig:743). Rebind so the later getFdPath error
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

                // Zig: `entry.abs_path = PathString.init(abs_path_str)`.
                // SAFETY: sole mutation; `base_`/`extname` (which may borrow
                // `(*entry).base_.remainder_buf`) are not used after this.
                unsafe { &mut *entry }.set_abs_path(bun_core::PathString::init(abs_path_str));
            }

            #[cfg(windows)]
            let abs_path: AbsPath = {
                // Zig: `allocator.dupe(u8, platformToPosixBuf(...))` — process-
                // lifetime heap dup. Intern into DirnameStore so the slice is
                // genuinely `'static` and `arena_slice()` is sound on Windows.
                let normalized = bun_paths::resolve_path::platform_to_posix_buf(
                    abs_path_str,
                    &mut bufs.normalized_abs_path_buf,
                );
                let interned: &'static [u8] = FileSystem::instance()
                    .dirname_store()
                    .append(normalized)
                    .expect("unreachable");
                PathString::init(interned)
            };
            #[cfg(not(windows))]
            let abs_path = PathString::init(abs_path_str);

            #[cfg(all(debug_assertions, windows))]
            {
                debug_assert!(!strings::index_of_char(name, b'\\').is_some());
                debug_assert!(!strings::index_of_char(public_path, b'\\').is_some());
                debug_assert!(!strings::index_of_char(match_name, b'\\').is_some());
                debug_assert!(!strings::index_of_char(abs_path.slice(), b'\\').is_some());
                // SAFETY: read-only reborrow; the `&mut` write above is dead.
                debug_assert!(!strings::index_of_char(unsafe { &*entry }.base(), b'\\').is_some());
            }

            // PORT NOTE: name/match_name/public_path are already `&'static` via
            // DirnameStore::append above. `entry.base()` borrows the entry (it
            // may be inline-stored for ≤31-byte names, fs.zig:333); intern it
            // explicitly to get `&'static` without a lifetime transmute.
            // SAFETY: read-only reborrow; the `&mut` write above is dead.
            let basename: &'static [u8] = FileSystem::instance()
                .dirname_store()
                .append(unsafe { &*entry }.base())
                .expect("unreachable");

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
    // bun.ThreadlocalBuffers: heap-backed so only a Box pointer lives in TLS
    // (keeps PT_TLS MemSiz small — see test/js/bun/binary/tls-segment-size).
    static ROUTE_BUFS: RefCell<Box<RouteBufs>> = RefCell::new(Box::new(RouteBufs {
        route_file_buf: PathBuffer::ZEROED,
        #[cfg(windows)]
        normalized_abs_path_buf: bun_sys::windows::PathBuffer::ZEROED,
    }));
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
    // PORT NOTE: raw `*mut` (not `&'a mut`) to match Zig's `*Param.List`.
    // `MatchedRoute` (bun_runtime) stores this self-referentially — a
    // `&'a mut List` here would be invalidated under Stacked Borrows the
    // moment any `&mut MatchedRoute` is taken. Callers that need a borrow
    // go through `params()`/`params_mut()`.
    pub params: *mut route_param::List<'a>,
    pub redirect_path: Option<&'a [u8]>,
    pub query_string: &'a [u8],
}

impl<'a> Match<'a> {
    /// SAFETY: caller guarantees `self.params` is live and not mutably aliased.
    #[inline]
    pub unsafe fn params(&self) -> &route_param::List<'a> {
        unsafe { &*self.params }
    }

    /// SAFETY: caller guarantees `self.params` is live and uniquely accessed.
    #[inline]
    pub unsafe fn params_mut(&mut self) -> &mut route_param::List<'a> {
        unsafe { &mut *self.params }
    }

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
        // so the direct call sites below need no per-line `unsafe { }`. The
        // `.map` closure body is not an unsafe context, so that one site spells
        // `unsafe { d(s) }` explicitly.
        #[inline(always)]
        unsafe fn d(s: &[u8]) -> &'static [u8] {
            // SAFETY: caller contract on `detach_lifetime` — every borrowed
            // slice outlives the returned `Match<'static>`.
            unsafe { &*core::ptr::from_ref::<[u8]>(s) }
        }
        Match {
            path: d(self.path),
            pathname: d(self.pathname),
            file_path: d(self.file_path),
            name: d(self.name),
            client_framework_enabled: self.client_framework_enabled,
            basename: d(self.basename),
            hash: self.hash,
            // Raw pointer; lifetime parameter on the pointee is phantom for the
            // pointer value itself.
            params: self.params.cast::<route_param::List<'static>>(),
            redirect_path: self.redirect_path.map(|s| unsafe { d(s) }),
            query_string: d(self.query_string),
        }
    }

    #[inline]
    pub fn has_params(&self) -> bool {
        // SAFETY: producers (`Routes::match_page*`) always set `params` to a
        // live caller-provided list that outlives the `Match`.
        unsafe { (*self.params).len() > 0 }
    }

    pub fn params_iterator(&self) -> PathnameScanner<'_> {
        // SAFETY: see `has_params`.
        PathnameScanner::init(self.pathname, self.name, unsafe { &*self.params })
    }

    pub fn name_with_basename<'s>(file_path: &'s [u8], dir: &[u8]) -> &'s [u8] {
        let mut name = file_path;
        if let Some(i) = strings::index_of(name, dir) {
            name = &name[i + dir.len()..];
        }

        &name[0..name.len() - bun_paths::extension(name).len()]
    }

    pub fn pathname_without_leading_slash(&self) -> &[u8] {
        strings::trim_left(self.pathname, b"/")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Traits introduced to replace Zig's `comptime T: type` duck-typing
// (Resolver, Server, RequestContext). Phase B should colocate these with
// the canonical types in bun_resolver / bun_runtime.
// ──────────────────────────────────────────────────────────────────────────

pub trait ResolverLike {
    // `bun_resolver::fs::FileSystem` is a singleton in Zig, so `'static` here
    // is faithful and avoids threading the resolver borrow into RouteLoader<'a>.
    fn fs(&self) -> &'static FileSystem;
    /// Zig: `&fs.fs` — the resolver's `Implementation` field, passed to
    /// `Entry.kind` for lazy stat.
    fn fs_impl(&self) -> *mut Fs::Implementation;
    /// Returns an arena handle (not a borrow) so the resolver's `&mut self`
    /// borrow ends before the recursive `load()` re-borrows it.
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
                            params.push(Param {
                                name: dynamic.str(name),
                                value: &path_[0..i],
                            });
                            path_ = &path_[i + 1..];

                            if pattern.is_end(name) {
                                params.truncate(0); // TODO(b1): was shrink_retaining_capacity (MultiArrayList API)
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

                        tag = Tag::Dynamic;

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

    impl Value {
        pub fn eql(a: &Value, b: &Value) -> bool {
            a.tag() == b.tag()
                && match (a, b) {
                    (Value::Static(a), Value::Static(b)) => a.eql(b),
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
            _: &mut route_param::List<'_>,
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
        // PORT NOTE: Zig used comptime field iteration over an anonymous struct.
        // Ported as runtime slice of (path, content) pairs.
        Output::init_test();
        debug_assert!(cwd_path.len() > 1 && cwd_path != b"/" && !cwd_path.ends_with(b"bun"));
        // const bun_tests_dir = try std.fs.cwd().makeOpenPath("bun-test-scratch", .{});
        let bun_tests_dir = bun_sys::Dir::cwd()
            .make_open_path(b"bun-test-scratch", bun_sys::OpenDirOptions::default())?;
        // bun_tests_dir.deleteTree(cwd_path) catch {};
        let _ = bun_tests_dir.delete_tree(cwd_path);

        // const cwd = try bun_tests_dir.makeOpenPath(cwd_path, .{});
        let cwd = bun_tests_dir.make_open_path(cwd_path, bun_sys::OpenDirOptions::default())?;
        // try cwd.setAsCwd();
        bun_sys::fchdir(cwd.fd())?;

        // inline for (fields) |field| { ... }
        for (name, value) in data {
            let name_b = name.as_bytes();
            // if (std.fs.path.dirname(field.name)) |dir| { try cwd.makePath(dir); }
            // PORT NOTE: `std.fs.path.dirname` returns null for paths without a
            // separator; replicate with rposition on '/' (test fixture paths
            // are always forward-slash).
            if let Some(slash) = name_b.iter().rposition(|&c| c == b'/') {
                if slash > 0 {
                    cwd.make_path(&name_b[..slash])?;
                }
            }
            // var file = try cwd.createFile(field.name, .{ .truncate = true });
            let file = bun_sys::File::create(cwd.fd(), name_b, true)?;
            // try file.writeAll(value);
            file.write_all(value.as_bytes())?;
            // file.close();
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
        ) -> Result<Routes, bun_core::Error> {
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
                .map_err(|_| bun_core::err!("OutOfMemory"))?;

            // const router = try Router.init(&FileSystem.instance, default_allocator, RouteConfig{...});
            // SAFETY: process-static singleton just initialized above.
            let fs_opaque: &'static FileSystem = unsafe { &*fs };
            let router = Router::init(
                fs_opaque,
                RouteConfig {
                    dir: pages_dir.to_vec().into_boxed_slice(),
                    routes_enabled: true,
                    extensions: vec![b"js".as_slice().into()].into_boxed_slice(),
                    ..RouteConfig::default()
                },
            )?;

            let mut log = bun_ast::Log::init();
            // PORT NOTE: `errdefer logger.print(Output.errorWriter())` — Rust has
            // no errdefer; the test harness panics on error anyway, but the guard
            // still flushes diagnostics on early-return for parity.
            let _err_dump = scopeguard::guard(core::ptr::from_mut(&mut log), |log| {
                // SAFETY: pointer to a stack local that outlives this guard.
                let _ = unsafe { &*log }.print(bun_core::output::error_writer());
            });

            // const opts = Options.BundleOptions{ .target = .browser, ... };
            // PORT NOTE: the resolver-side `BundleOptions` subset omits
            // `loaders`/`define`/`log`/`routes`/`entry_points`/`out_extensions`/
            // `transform_options` — none are read by `Resolver::init1` or the
            // dir-info walk, so `Default` + `target` is the faithful projection.
            let opts = bun_resolver::options::BundleOptions {
                target: bun_ast::Target::Browser,
                external: bun_resolver::options::ExternalModules::default(),
                ..Default::default()
            };

            // var resolver = Resolver.init1(default_allocator, &logger, &FileSystem.instance, opts);
            let mut resolver = TestResolver(bun_resolver::Resolver::init1(&mut log, fs, opts));

            // const root_dir = (try resolver.readDirInfo(pages_dir)).?;
            let root_dir = resolver
                .0
                .read_dir_info(pages_dir)?
                .ok_or_else(|| bun_core::err!("FileNotFound"))?;

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
        ) -> Result<Router<'static>, bun_core::Error> {
            make_test(test_name.as_bytes(), data)?;
            bun_ast::initialize_store();
            // const fs = try FileSystem.initWithForce(null, true);
            let _ = bun_resolver::fs::FileSystem::init_with_force::<true>(None)?;
            let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir;

            let pages_parts: [&[u8]; 2] = [top_level_dir, b"pages"];
            let pages_dir = bun_resolver::fs::FileSystem::instance()
                .abs_alloc(&pages_parts)
                .map_err(|_| bun_core::err!("OutOfMemory"))?;

            // var router = try Router.init(&FileSystem.instance, default_allocator, RouteConfig{...});
            // SAFETY: process-static singleton just initialized above.
            let fs_opaque: &'static FileSystem = unsafe { &*fs };
            let mut router = Router::init(
                fs_opaque,
                RouteConfig {
                    dir: pages_dir.to_vec().into_boxed_slice(),
                    routes_enabled: true,
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

            let mut resolver = TestResolver(bun_resolver::Resolver::init1(&mut log, fs, opts));

            // const root_dir = (try resolver.readDirInfo(pages_dir)).?;
            let root_dir = resolver
                .0
                .read_dir_info(pages_dir)?
                .ok_or_else(|| bun_core::err!("FileNotFound"))?;

            // try router.loadRoutes(&logger, root_dir, Resolver, &resolver, top_level_dir);
            // SAFETY: `_err_dump` only re-derives `&*log` on drop (after this borrow ends).
            router.load_routes(
                unsafe { &mut *core::ptr::from_mut(&mut log) },
                &root_dir,
                &mut resolver,
                top_level_dir,
            )?;
            let entry_points = router.get_entry_points();

            // try expectEqual(std.meta.fieldNames(@TypeOf(data)).len, entry_points.len);
            assert_eq!(data.len(), entry_points.len());
            scopeguard::ScopeGuard::into_inner(_err_dump);
            Ok(router)
        }
    }

    #[test]
    fn pattern_match() {
        type Entry = Param<'static>;

        // TODO(port): Zig used anonymous-struct field iteration; ported as explicit array.
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
                parameters.truncate(0);

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

// ported from: src/router/router.zig
