//! `Bun.FileSystemRouter` / `MatchedRoute` — Next.js-style file router.

pub(crate) mod kind_enum {
    const EXACT: &[u8] = b"exact";
    const CATCH_ALL: &[u8] = b"catch-all";
    const OPTIONAL_CATCH_ALL: &[u8] = b"optional-catch-all";
    const DYNAMIC: &[u8] = b"dynamic";

    pub(crate) fn classify(name: &[u8]) -> &'static [u8] {
        if bun_core::strings::contains(name, b"[[...") {
            OPTIONAL_CATCH_ALL
        } else if bun_core::strings::contains(name, b"[...") {
            CATCH_ALL
        } else if bun_core::strings::contains(name, b"[") {
            DYNAMIC
        } else {
            EXACT
        }
    }
}

use bun_paths::strings;

use bun_ast as Log;
use bun_core::{EncodedSlice, String as BunString, Utf8Bytes};
use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsPayload as _, JsScope, JsWrapper};
use bun_jsc::js_object::ObjectInitializer;
use bun_jsc::ref_string::RefString;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSObject, JSValue, JsCell, JsError, JsResult, LogJsc};
use bun_paths::{self as path, MAX_PATH_BYTES};
use bun_ptr::BackRef;

use bun_http_types::URLPath;
use bun_resolver::Resolver;
use bun_resolver::fs as Fs;
use bun_router::{self as Router, Match as RouterMatch, RouteConfig};
use bun_url::{CombinedScanner, QueryStringMap, URL, route_param};

use crate::api::bun_object;
use crate::generated_bindgen::filesystem_router::{
    FileSystemRouterClass, FileSystemRouterInternalFields as _, FileSystemRouterOptions,
    MatchedRouteClass, Routable,
};

// Note: `FrameworkFileSystemRouter` is declared in this file's
// `filesystem_router.classes.ts`, so codegen looks for the backing struct here
// (`crate::api::filesystem_router::FrameworkFileSystemRouter`). The
// implementation is `bake::router::JSFrameworkRouter`; re-export the
// real type so the codegen-generated thunks resolve without a stub.
pub(crate) use crate::bake::router::JSFrameworkRouter as FrameworkFileSystemRouter;

const DEFAULT_EXTENSIONS: &[&[u8]] = &[b"tsx", b"jsx", b"ts", b"mjs", b"cjs", b"js"];

// ── ResolverLike bridge ───────────────────────────────────────────────────
// `bun_router::ResolverLike` is the duck-typed seam for `Router::load_routes`;
// `bun_resolver::Resolver` is the concrete impl. The orphan-rule-compliant
// impl lives here in `bun_runtime` (the runtime sees both).

/// Newtype so the orphan rule lets us `impl ResolverLike` for the foreign
/// `bun_resolver::Resolver`.
struct RouterResolver<'a, 'r>(&'r mut Resolver<'a>);

impl<'a, 'r> Router::ResolverLike for RouterResolver<'a, 'r> {
    #[inline]
    fn fs(&self) -> &'static Fs::FileSystem {
        Fs::FileSystem::instance()
    }
    #[inline]
    fn fs_impl(&self) -> *mut Fs::Implementation {
        // SAFETY: `&fs.fs` — the `Implementation` field of the singleton.
        unsafe { &raw mut (*self.0.fs()).fs }
    }
    #[inline]
    fn read_dir_info_ignore_error(&mut self, path: &[u8]) -> Option<bun_resolver::DirInfoRef> {
        self.0.read_dir_info_ignore_error(path)
    }
}

pub(crate) struct FileSystemRouter {
    // BACKREF — interned `RefString`s live in the VM cache and outlive this
    // router (we hold +1 via `claim` in `constructor`, released in `drop`).
    origin: Option<BackRef<RefString>>,
    base_dir: BackRef<RefString>,
    router: Router::Router,
    asset_prefix: Option<BackRef<RefString>>,
}

enum LoadError {
    NotFound,
    ReadingRootDirectory,
    LoadingRoutes,
}

impl LoadError {
    fn throw(self, global: &JSGlobalObject, log: &Log::Log, dir: &[u8]) -> JsError {
        let doing = match self {
            LoadError::NotFound => {
                return global.throw(format_args!(
                    "Unable to find directory: {}",
                    bstr::BStr::new(dir)
                ));
            }
            LoadError::ReadingRootDirectory => format_args!("reading root directory"),
            LoadError::LoadingRoutes => format_args!("loading routes"),
        };
        match log.to_js(global, doing) {
            Ok(error) => global.throw_value(error),
            Err(error) => error,
        }
    }
}

/// SAFETY: the resolver logs to `log` until what this returns is dropped, which is before `log` moves or drops.
unsafe fn log_resolver_to(log: &mut Log::Log) -> impl Drop + use<> {
    // Derived from the thread-local raw `*mut VirtualMachine` (via `get_mut_ptr`) so the stored
    // slot pointer keeps valid provenance under Stacked Borrows across the callers'
    // `&mut vm.transpiler.resolver` reborrows.
    // SAFETY: the VM and its resolver outlive the caller's scope.
    unsafe {
        let vm_ptr = VirtualMachine::get_mut_ptr();
        Resolver::scoped_log(
            core::ptr::addr_of_mut!((*vm_ptr).transpiler.resolver),
            core::ptr::NonNull::from(log),
        )
    }
}

fn load_router(
    config: RouteConfig,
    log: &mut Log::Log,
) -> Result<(Router::Router, bun_resolver::DirInfoRef), LoadError> {
    let resolver = &mut VirtualMachine::get().as_mut().transpiler.resolver;
    let root_dir_info = match resolver.read_dir_info(&config.dir) {
        Ok(Some(info)) => info,
        Ok(None) => return Err(LoadError::NotFound),
        Err(_) => return Err(LoadError::ReadingRootDirectory),
    };

    let mut router = Router::Router::init(config).expect("unreachable");
    let config_dir = router.config.dir.clone();
    router
        .load_routes(
            log,
            &root_dir_info,
            &mut RouterResolver(resolver),
            &config_dir,
        )
        .map_err(|_| LoadError::LoadingRoutes)?;
    Ok((router, root_dir_info))
}

impl FileSystemRouter {
    fn bust_dir_cache_recursive(input_path: &[u8]) {
        // Re-derived per use site: the recursive call does the same, which pops this tag mid-loop.
        let vm = VirtualMachine::get();
        #[cfg(not(windows))]
        let path = input_path;
        #[cfg(windows)]
        let path;
        #[cfg(windows)]
        let normalized: Vec<u8>;
        #[cfg(windows)]
        {
            // Note: `with_borrow_mut` can't hand back a slice that outlives
            // the closure, so copy out (cold reload path).
            normalized = WIN32_NORMALIZE_BUF
                .with_borrow_mut(|buf| vm.fs().normalize_buf(&mut buf[..], input_path).to_vec());
            path = normalized.as_slice();
        }

        let root_dir_info = match vm.as_mut().transpiler.resolver.read_dir_info(path) {
            Ok(v) => v,
            Err(_) => return,
        };

        if let Some(dir_ref) = root_dir_info {
            // Snapshot the cached `DirEntry`'s entry pointers under `entries_mutex`
            // (other threads rewrite the map in place under that lock), then drop
            // the guard: `bust_dir_cache` / the recursion below re-acquire it.
            let entry_ptrs: Vec<*mut Fs::Entry> = {
                let _entries_lock = Fs::FileSystem::instance().fs.entries_mutex.lock_guard();
                match dir_ref.get_entries_const() {
                    Some(entries) => entries.data.values().copied().collect(),
                    None => Vec::new(),
                }
            };
            {
                'outer: for entry_ptr in entry_ptrs {
                    // BACKREF: `entry_ptr` is a `*mut Entry` into the process-static
                    // EntryStore; the store outlives this loop. Wrap once so the
                    // shared-only reads below are safe `Deref`s.
                    let entry = BackRef::from(
                        core::ptr::NonNull::new(entry_ptr).expect("EntryStore entry"),
                    );
                    if entry.base().first() == Some(&b'.') {
                        continue 'outer;
                    }
                    // `Transpiler::fs_mut()` is the audited safe `&mut FileSystem`
                    // accessor for the process-lifetime singleton; `&mut .fs` (the
                    // `Implementation` field) is the lazy-stat receiver. `kind`
                    // needs `&mut Entry` to update the cached stat; no shared
                    // borrow of `*entry_ptr` is live across this block.
                    let kind = {
                        let fs_impl = &mut vm.transpiler.fs_mut().fs;
                        // SAFETY: `entry_ptr` is a live `*mut Entry` in the process-static
                        // EntryStore (checked non-null above); the lazy-stat rewrite is
                        // serialized on `Entry.mutex`; fs_impl is the process-global RealFS.
                        unsafe { (&*entry_ptr).kind(fs_impl, false) }
                    };
                    if kind == Fs::EntryKind::Dir {
                        for banned_dir in Router::BANNED_DIRS.iter() {
                            if entry.base() == *banned_dir {
                                continue 'outer;
                            }
                        }
                        let abs_parts: [&[u8]; 2] = [entry.dir, entry.base()];
                        // `abs()` writes into a thread-local buffer; copy out
                        // before recursing (recursion overwrites it).
                        let full_path = vm.fs().abs(&abs_parts).to_vec();
                        let _ = vm.as_mut().transpiler.resolver.bust_dir_cache(
                            strings::paths::without_trailing_slash_windows_path(&full_path),
                        );
                        Self::bust_dir_cache_recursive(&full_path);
                    }
                }
            }
        }

        let _ = vm.as_mut().transpiler.resolver.bust_dir_cache(path);
    }

    fn bust_dir_cache(&self) {
        Self::bust_dir_cache_recursive(strings::paths::without_trailing_slash_windows_path(
            &self.router.config.dir,
        ));
    }
}

impl FileSystemRouterClass for FileSystemRouter {
    type Error<'a> = bindgen::Error<'a>;

    fn constructor<'a>(
        cx: &mut JsScope<'a>,
        options: &FileSystemRouterOptions<'a>,
    ) -> bindgen::Result<'a, Self> {
        let global = cx.global();
        match options.style {
            Some(b"nextjs") => {}
            Some(_) => {
                return Err(global
                    .throw_invalid_arguments(format_args!(
                        "Only 'nextjs' style is currently implemented"
                    ))
                    .into());
            }
            None => {
                return Err(global
                    .throw_invalid_arguments(format_args!(
                        "Expected 'style' option (ex: \"style\": \"nextjs\")"
                    ))
                    .into());
            }
        }
        let vm = global.bun_vm().as_mut();

        let mut out_buf = [0u8; MAX_PATH_BYTES * 2];
        let mut root_dir_path = vm.top_level_dir();
        if !(options.dir.is_empty() || options.dir == b".") {
            // An absolute path is joined too: a route's name is cut from the resolver's normalized spelling.
            let Some(joined) =
                path::resolve_path::join_abs_string_buf_checked::<path::platform::Auto>(
                    Fs::FileSystem::instance().top_level_dir,
                    &mut out_buf,
                    &[options.dir],
                )
            else {
                return Err(LoadError::NotFound
                    .throw(global, &Log::Log::new(), options.dir)
                    .into());
            };
            root_dir_path = joined;
        }

        let mut extensions: Vec<Box<[u8]>> = (options.file_extensions.iter().flatten())
            .filter(|extension| !extension.is_empty())
            .map(|extension| Box::from(&extension[1..]))
            .collect();
        if extensions.is_empty() {
            extensions = DEFAULT_EXTENSIONS.iter().map(|s| Box::from(*s)).collect();
        }
        let asset_prefix = options.asset_prefix.unwrap_or_default();

        let mut log = Log::Log::new();
        // SAFETY: declared after `log`, so it is dropped first.
        let _restore_log = unsafe { log_resolver_to(&mut log) };

        let config = RouteConfig {
            // Ends with the native separator (`\` on Windows).
            dir: strings::paths::clone_normalizing_separators(root_dir_path).into_boxed_slice(),
            extensions: extensions.into(),
            asset_prefix_path: Box::from(asset_prefix),
            ..Default::default()
        };
        let (mut router, root_dir_info) = match load_router(config, &mut log) {
            Ok(loaded) if log.errors + log.warnings == 0 => loaded,
            Ok(_) => return Err(LoadError::LoadingRoutes.throw(global, &log, b"").into()),
            Err(error) => return Err(error.throw(global, &log, root_dir_path).into()),
        };

        let base_dir_str = if !root_dir_info.abs_real_path.is_empty() {
            root_dir_info.abs_real_path
        } else {
            root_dir_info.abs_path
        };

        // The interning cache adds no ref on a hit, so each router takes its own. `drop` releases it.
        let mut claim = |bytes: &[u8]| -> BackRef<RefString> {
            let p = vm.ref_counted_string::<true>(bytes, None);
            let r = BackRef::from(core::ptr::NonNull::new(p).expect("ref_counted_string"));
            r.ref_();
            r
        };
        let base_dir = claim(base_dir_str);
        router.config.dir = Box::from(base_dir.leak());
        Ok(FileSystemRouter {
            origin: options
                .origin
                .filter(|origin| !origin.is_empty())
                .map(&mut claim),
            base_dir,
            asset_prefix: Some(asset_prefix)
                .filter(|prefix| !prefix.is_empty())
                .map(&mut claim),
            router,
        })
    }

    fn asset_prefix(&self) -> Option<impl AsRef<[u8]>> {
        self.asset_prefix.as_ref().map(|prefix| prefix.leak())
    }

    fn r#match<'a>(
        &mut self,
        heap: &JsHeap<'a>,
        input: Routable<'a>,
    ) -> bindgen::Result<'a, Option<JsWrapper<'a, MatchedRoute>>> {
        // `path` is moved into the `MatchedRoute`, so every arm must own its bytes.
        let mut path: Utf8Bytes<'static> = match input {
            Routable::Path(path) => path.into_utf8(),
            Routable::Request(req) => {
                req.ensure_url().expect("unreachable");
                req.url.get().clone().into_utf8()
            }
            Routable::Response(resp) => resp.url().clone().into_utf8(),
        };

        if path.slice().is_empty() || (path.slice().len() == 1 && path.slice()[0] == b'/') {
            path = Utf8Bytes::Borrowed(b"/");
        }

        if strings::has_prefix(path.slice(), b"http://")
            || strings::has_prefix(path.slice(), b"https://")
            || strings::has_prefix(path.slice(), b"file://")
        {
            path = Utf8Bytes::Owned(URL::parse(path.slice()).pathname.to_vec());
        }

        // URLPath::parse strips byte 0 and the route table is keyed without the
        // leading slash, so "Xtop" would match "/top". The URL branch above and
        // the empty-input normalisation both yield '/'-prefixed paths already.
        if path.slice().first() != Some(&b'/') {
            return Ok(None);
        }

        // SAFETY: self-ref construction prelude — `route` below borrows these bytes via
        // `URLPath`, and `path` is then MOVED into the same `MatchedRoute` that stores
        // `route`. Borrowck can't see that the allocation travels with the borrow, so we
        // detach the slice from `path`'s ownership here. The bytes stay valid: `path` is
        // never dropped on any path between here and `MatchedRoute::init` taking ownership
        // (early returns above this point already dropped/replaced `path`), except when
        // `URLPath::parse` percent-decoded — in that case nothing borrows `path_bytes`
        // anymore and `path` is swapped for the decode buffer below.
        let path_bytes: &[u8] = unsafe { bun_ptr::detach_lifetime(path.slice()) };
        let mut url_path = match URLPath::parse(path_bytes) {
            Ok(v) => v,
            Err(err) => {
                return Err(heap.error(format_args!(
                    "{} parsing path: {}",
                    bun_url::Error::from(err).name(),
                    bstr::BStr::new(path.slice())
                )));
            }
        };
        let mut params = route_param::List::default();
        let Some(route) =
            (self.router.routes).match_page_with_allocator(b"", &url_path, &mut params)
        else {
            return Ok(None);
        };

        // If `URLPath::parse` had to percent-decode, `route.pathname`/`query_string` and
        // the param values borrow the decode buffer — not `path` — and that buffer would
        // be freed when `url_path` drops at the end of this call. Take ownership of it and
        // make it the backing allocation instead. (`Box<[u8]>` -> `Vec<u8>` ->
        // `Utf8Bytes::Owned` reuses the same heap allocation, so the borrowed slices
        // stay valid; nothing in `route` points into the original encoded `path` once a
        // decode happened.)
        if let Some(decoded) = url_path.take_decoded_storage() {
            path = Utf8Bytes::Owned(decoded.into_vec());
        }

        let matched =
            MatchedRoute::init(route, path, self.origin, self.asset_prefix, self.base_dir);
        Ok(Some(matched.into_js(heap)))
    }

    fn origin(&self) -> Option<impl AsRef<[u8]>> {
        self.origin.as_ref().map(|origin| origin.leak())
    }

    fn reload<'a>(
        this: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
    ) -> bindgen::Result<'a, JsWrapper<'a, Self>> {
        let mut log = Log::Log::new();
        // SAFETY: declared after `log`, so it is dropped first.
        let _restore_log = unsafe { log_resolver_to(&mut log) };

        let loaded = this.with_mut(&mut cx.payloads, |this| {
            this.bust_dir_cache();
            let config = &this.router.config;
            let config = RouteConfig {
                dir: config.dir.clone(),
                extensions: config.extensions.clone(),
                asset_prefix_path: config.asset_prefix_path.clone(),
                ..Default::default()
            };
            let dir = config.dir.clone();
            let (router, _) = load_router(config, &mut log).map_err(|error| (error, dir))?;
            this.router = router;
            Ok(())
        });
        if let Err((error, dir)) = loaded {
            return Err(error.throw(cx.global(), &log, &dir).into());
        }
        this.forget_cached_routes(&cx.heap);
        Ok(this)
    }

    fn routes<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, JsLocal<'a>> {
        let paths = self.router.get_entry_points();
        let names = self.router.get_names();
        let mut name_strings: Vec<EncodedSlice> = vec![EncodedSlice::EMPTY; names.len() * 2];
        let (name_strings_slice, paths_strings) = name_strings.split_at_mut(names.len());
        for (i, name) in names.iter().enumerate() {
            name_strings_slice[i] = EncodedSlice::from_bytes(name);
            paths_strings[i] = EncodedSlice::from_bytes(paths[i]);
        }
        // SAFETY: makes an object of strings.
        let global = unsafe { heap.global() };
        let routes = JSValue::from_entries(global, name_strings_slice, paths_strings, true)?;
        Ok(JsLocal::new(heap, routes))
    }

    fn style(&self) -> BunString {
        BunString::static_("nextjs")
    }
}

impl Drop for FileSystemRouter {
    fn drop(&mut self) {
        // Note: `BackRef` Derefs to `&RefString`; use `.get()` to avoid
        // resolving to `<BackRef as Deref>::deref`.
        if let Some(p) = self.asset_prefix.take() {
            p.get().deref();
        }
        if let Some(p) = self.origin.take() {
            p.get().deref();
        }
        self.base_dir.get().deref();
    }
}

pub(crate) struct MatchedRoute {
    // Note: `Match<'a>` borrows (a) the resolver's process-lifetime DirnameStore for
    // `name`/`file_path`/`basename`/`path` and (b) `self.pathname_backing` for
    // `pathname`/`query_string`/param values. Both are stable for `Self`'s lifetime, so
    // the stored `'static` is the standard self-referential erasure — see `init`.
    /// `params` is `self.params_list`.
    route: RouterMatch<'static>,
    // Lazily populated by `query`/`params`, which take `&self`.
    query_string_map: JsCell<Option<QueryStringMap>>,
    param_map: JsCell<Option<QueryStringMap>>,
    /// Owned, and on the heap because `self` moves into its wrapper. Freed by `drop`.
    params_list: *mut route_param::List<'static>,
    /// What `route.pathname`, `route.query_string` and the values in `params_list` borrow.
    #[expect(dead_code, reason = "held for what borrows it")]
    pathname_backing: Utf8Bytes<'static>,
    // BACKREF — interned `RefString`s; we hold +1 (bumped in `init`, released in
    // `drop`). The interned allocation outlives every `MatchedRoute`.
    origin: Option<BackRef<RefString>>,
    asset_prefix: Option<BackRef<RefString>>,
    base_dir: BackRef<RefString>,
}

impl MatchedRoute {
    #[inline]
    fn params_list(&self) -> &route_param::List<'static> {
        // SAFETY: owned by `self` and written by nothing after `init`.
        unsafe { &*self.params_list }
    }

    fn init(
        match_: RouterMatch<'_>,
        pathname_backing: Utf8Bytes<'static>,
        origin: Option<BackRef<RefString>>,
        asset_prefix: Option<BackRef<RefString>>,
        base_dir: BackRef<RefString>,
    ) -> MatchedRoute {
        // SAFETY: `match_.params` is the caller's live list.
        let params_list = unsafe { (*match_.params).clone() };

        // SAFETY: what both borrow is the DirnameStore or `pathname_backing`, which is stored with them.
        let mut route: RouterMatch<'static> = unsafe { match_.detach_lifetime() };
        let params_list: route_param::List<'static> = {
            let mut v = core::mem::ManuallyDrop::new(params_list);
            let (ptr, len, cap) = (v.as_mut_ptr(), v.len(), v.capacity());
            // SAFETY: the same allocation, with the lifetime of its elements erased as above.
            unsafe { Vec::from_raw_parts(ptr.cast::<route_param::Param<'static>>(), len, cap) }
        };
        let params_list = bun_core::heap::into_raw(Box::new(params_list));
        route.params = params_list;

        base_dir.ref_();
        if let Some(o) = origin {
            o.ref_();
        }
        if let Some(p) = asset_prefix {
            p.ref_();
        }
        MatchedRoute {
            route,
            query_string_map: JsCell::new(None),
            param_map: JsCell::new(None),
            params_list,
            pathname_backing,
            origin,
            asset_prefix,
            base_dir,
        }
    }

    fn create_query_object(ctx: &JSGlobalObject, map: &mut QueryStringMap) -> JsResult<JSValue> {
        struct QueryObjectCreator<'a> {
            query: &'a mut QueryStringMap,
        }
        impl<'a> ObjectInitializer for QueryObjectCreator<'a> {
            fn create(&mut self, obj: &mut JSObject, global: &JSGlobalObject) -> JsResult<()> {
                // Stack scratch — 256 × 16-byte fat ptr × 2 ≈ 8 KiB, well within Bun's
                // JS-thread stack budget. A `RefCell<[&'static [u8]; 256]>` TLS slot
                // would be unsound: `iter.next()` writes QueryStringMap-lifetime
                // slices into it, and once the map drops the TLS slot is left
                // holding dangling `&'static [u8]` — invalid-value UB the next time
                // `with_borrow_mut` produces a `&mut` over it. A stack array lets
                // inference tie the element lifetime to `iter` and dies with this
                // frame.
                let mut values_buf: [&[u8]; 256] = [b""; 256];
                let mut refs_buf: [EncodedSlice; 256] = [EncodedSlice::EMPTY; 256];

                let mut iter = self.query.iter();
                while let Some(entry) = iter.next(&mut values_buf) {
                    let entry_name = entry.name;
                    let mut str = EncodedSlice::from_bytes(entry_name);

                    debug_assert!(!entry.values.is_empty());
                    if entry.values.len() > 1 {
                        let values = &mut refs_buf[0..entry.values.len()];
                        for (i, value) in entry.values.iter().enumerate() {
                            values[i] = EncodedSlice::from_bytes(value);
                        }
                        obj.put_record(global, &mut str, values)?;
                    } else {
                        refs_buf[0] = EncodedSlice::from_bytes(entry.values[0]);
                        obj.put_record(global, &mut str, &mut refs_buf[0..1])?;
                    }
                }
                Ok(())
            }
        }

        let count = map.get_name_count();
        let mut creator = QueryObjectCreator { query: map };

        JSObject::create_with_initializer(&mut creator, ctx, count)
    }
}

impl Drop for MatchedRoute {
    fn drop(&mut self) {
        // SAFETY: made by `heap::into_raw` in `init`, and `route.params` is not read again.
        unsafe { bun_core::heap::destroy(self.params_list) };
        if let Some(p) = self.origin.take() {
            p.get().deref();
        }
        if let Some(p) = self.asset_prefix.take() {
            p.get().deref();
        }
        self.base_dir.get().deref();
    }
}

impl MatchedRouteClass for MatchedRoute {
    type Error<'a> = JsError;

    fn file_path(&self) -> impl AsRef<[u8]> {
        self.route.file_path
    }

    fn kind(&self) -> impl AsRef<[u8]> {
        kind_enum::classify(self.route.name)
    }

    fn name(&self) -> impl AsRef<[u8]> {
        self.route.name
    }

    fn params<'a>(&self, heap: &JsHeap<'a>) -> JsResult<JsLocal<'a>> {
        // SAFETY: makes an object of strings.
        let global = unsafe { heap.global() };
        if self.params_list().is_empty() {
            return Ok(JsLocal::new(heap, JSValue::create_empty_object(global, 0)));
        }

        if self.param_map.get().is_none() {
            let scanner = CombinedScanner::init(
                b"",
                self.route.pathname_without_leading_slash(),
                self.route.name,
                self.params_list(),
            );
            self.param_map
                .set(QueryStringMap::init_with_scanner(scanner)?);
        }

        let params = self
            .param_map
            .with_mut(|m| Self::create_query_object(global, m.as_mut().unwrap()))?;
        Ok(JsLocal::new(heap, params))
    }

    fn pathname(&self) -> impl AsRef<[u8]> {
        self.route.pathname
    }

    fn query<'a>(&self, heap: &JsHeap<'a>) -> JsResult<JsLocal<'a>> {
        // SAFETY: makes an object of strings.
        let global = unsafe { heap.global() };
        let route = &self.route;
        if route.query_string.is_empty() && self.params_list().is_empty() {
            return Ok(JsLocal::new(heap, JSValue::create_empty_object(global, 0)));
        } else if route.query_string.is_empty() {
            return self.params(heap);
        }

        if self.query_string_map.get().is_none() {
            if !self.params_list().is_empty() {
                let scanner = CombinedScanner::init(
                    route.query_string,
                    route.pathname_without_leading_slash(),
                    route.name,
                    self.params_list(),
                );
                self.query_string_map
                    .set(QueryStringMap::init_with_scanner(scanner)?);
            } else {
                self.query_string_map
                    .set(QueryStringMap::init(route.query_string)?);
            }
        }

        let query = self.query_string_map.with_mut(|m| match m {
            Some(map) => Self::create_query_object(global, map),
            None => Ok(JSValue::create_empty_object(global, 0)),
        })?;
        Ok(JsLocal::new(heap, query))
    }

    fn script_src(&self) -> impl AsRef<[u8]> {
        self.src()
    }

    fn src(&self) -> impl AsRef<[u8]> {
        let mut src: Vec<u8> = Vec::new();
        let origin_url = if let Some(ref origin) = self.origin {
            URL::parse(origin.leak())
        } else {
            URL::default()
        };
        bun_object::get_public_path_with_asset_prefix(
            self.route.file_path,
            self.base_dir.leak(),
            &origin_url,
            if let Some(ref prefix) = self.asset_prefix {
                prefix.leak()
            } else {
                b""
            },
            &mut src,
            path::Platform::Posix,
        );
        src
    }
}

#[cfg(windows)]
thread_local! {
    static WIN32_NORMALIZE_BUF: core::cell::RefCell<Box<[u8; MAX_PATH_BYTES * 2]>> =
        core::cell::RefCell::new(bun_core::boxed_zeroed());
}
