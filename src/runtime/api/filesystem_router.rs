use core::cell::RefCell;
use std::sync::Arc;

use bun_alloc::ArenaAllocator;
use bun_core::Environment;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSObject, JSValue, JsResult, ZigString};
use bun_logger as Log;
use bun_paths::{self as path, PathBuffer, MAX_PATH_BYTES};
use bun_str::strings;

use bun_http_types::URLPath;
use bun_resolver::fs as Fs;
use bun_resolver::Resolver;
use bun_router::{self as Router, Match as RouterMatch};
use bun_url::{CombinedScanner, QueryStringMap, URL};

// TODO(port): `jsc.WebCore.{Request,Response}` live in `src/runtime/webcore/`; confirm crate path.
use crate::webcore::{Request, Response};
// TODO(port): `jsc.API.Bun.getPublicPath{,WithAssetPrefix}` live in `src/runtime/api/BunObject.zig`.
use crate::api::bun_object;
// TODO(port): `Transpiler.ClientEntryPoint` — `bun.transpiler` maps to `bun_bundler` per crate map.
use bun_bundler as Transpiler;

const DEFAULT_EXTENSIONS: &[&[u8]] = &[
    b"tsx",
    b"jsx",
    b"ts",
    b"mjs",
    b"cjs",
    b"js",
];

#[bun_jsc::JsClass]
pub struct FileSystemRouter {
    pub origin: Option<Arc<jsc::RefString>>,
    pub base_dir: Option<Arc<jsc::RefString>>,
    pub router: Router::Router,
    // PERF(port): was arena bulk-free — Router borrows slices from this arena across calls;
    // kept as boxed arena per LIFETIMES.tsv (OWNED). Phase B: confirm bumpalo vs ArenaAllocator.
    pub arena: Box<ArenaAllocator>,
    // PORT NOTE: dropped `allocator: std.mem.Allocator` field — it was always `arena.allocator()`.
    pub asset_prefix: Option<Arc<jsc::RefString>>,
}

impl FileSystemRouter {
    // PORT NOTE: `pub const js = jsc.Codegen.JSFileSystemRouter; toJS/fromJS/fromJSDirect`
    // are wired by `#[bun_jsc::JsClass]` codegen — deleted per PORTING.md.

    #[bun_jsc::host_fn]
    pub fn constructor(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<Box<FileSystemRouter>> {
        let argument_ = callframe.arguments_old(1);
        if argument_.len() == 0 {
            return global_this.throw_invalid_arguments("Expected object", ());
        }

        let argument = argument_.ptr()[0];
        if argument.is_empty_or_undefined_or_null() || !argument.is_object() {
            return global_this.throw_invalid_arguments("Expected object", ());
        }
        let vm = global_this.bun_vm();

        let mut root_dir_path: ZigString::Slice =
            ZigString::Slice::from_utf8_never_free(vm.transpiler.fs.top_level_dir);
        // `defer root_dir_path.deinit()` → Drop on ZigString::Slice
        let mut origin_str: ZigString::Slice = ZigString::Slice::default();
        let mut asset_prefix_slice: ZigString::Slice = ZigString::Slice::default();

        let mut out_buf = [0u8; MAX_PATH_BYTES * 2];
        if let Some(style_val) = argument.get(global_this, "style")? {
            if !(style_val.get_zig_string(global_this)?).eql_comptime("nextjs") {
                return global_this.throw_invalid_arguments(
                    "Only 'nextjs' style is currently implemented",
                    (),
                );
            }
        } else {
            return global_this.throw_invalid_arguments(
                "Expected 'style' option (ex: \"style\": \"nextjs\")",
                (),
            );
        }

        if let Some(dir) = argument.get(global_this, "dir")? {
            if !dir.is_string() {
                return global_this.throw_invalid_arguments("Expected dir to be a string", ());
            }
            let root_dir_path_ = dir.to_slice(global_this)?;
            if !(root_dir_path_.len() == 0 || root_dir_path_.slice() == b".") {
                // resolve relative path if needed
                let path_ = root_dir_path_.slice();
                if path::Platform::Auto.is_absolute(path_) {
                    root_dir_path = root_dir_path_;
                } else {
                    let parts: [&[u8]; 1] = [path_];
                    root_dir_path = ZigString::Slice::from_utf8_never_free(
                        path::join_abs_string_buf(
                            Fs::FileSystem::instance().top_level_dir,
                            &mut out_buf,
                            &parts,
                            path::Platform::Auto,
                        ),
                    );
                }
            }
        } else {
            // dir is not optional
            return global_this.throw_invalid_arguments("Expected dir to be a string", ());
        }
        // PERF(port): was arena bulk-free — extensions/asset_prefix/log all allocated from this.
        let mut arena = Box::new(ArenaAllocator::new());
        let allocator = arena.allocator();
        let mut extensions: Vec<&[u8]> = Vec::new();
        if let Some(file_extensions) = argument.get(global_this, "fileExtensions")? {
            if !file_extensions.js_type().is_array() {
                return global_this
                    .throw_invalid_arguments("Expected fileExtensions to be an Array", ());
            }

            let mut iter = file_extensions.array_iterator(global_this)?;
            extensions.reserve_exact(iter.len());
            while let Some(val) = iter.next()? {
                if !val.is_string() {
                    return global_this.throw_invalid_arguments(
                        "Expected fileExtensions to be an Array of strings",
                        (),
                    );
                }
                if val.get_length(global_this)? == 0 {
                    continue;
                }
                // PERF(port): was appendAssumeCapacity
                // TODO(port): `toUTF8Bytes(allocator)[1..]` — slices off leading '.'; arena owns the bytes.
                extensions.push(&val.to_utf8_bytes(global_this, &allocator)?[1..]);
            }
        }

        if let Some(asset_prefix) = argument.get_truthy(global_this, "assetPrefix")? {
            if !asset_prefix.is_string() {
                return global_this
                    .throw_invalid_arguments("Expected assetPrefix to be a string", ());
            }

            asset_prefix_slice = asset_prefix
                .to_slice(global_this)?
                .clone_if_borrowed(&allocator)?;
        }
        let orig_log = vm.transpiler.resolver.log;
        let mut log = Log::Log::new(&allocator);
        vm.transpiler.resolver.log = &mut log;
        // TODO(port): errdefer-style restore — scopeguard would borrow `vm` for the whole scope.
        // Phase B: wrap in scopeguard or restore manually on every early-return path below.
        let _restore_log = scopeguard::guard((), |_| {
            vm.transpiler.resolver.log = orig_log;
        });

        let path_to_use = root_dir_path
            .clone_with_trailing_slash(&allocator)
            .expect("unreachable")
            .slice();

        let root_dir_info = match vm.transpiler.resolver.read_dir_info(path_to_use) {
            Ok(Some(info)) => info,
            Ok(None) => {
                return global_this.throw(format_args!(
                    "Unable to find directory: {}",
                    bstr::BStr::new(root_dir_path.slice())
                ));
            }
            Err(_) => {
                // Build the JS error before arena teardown: `log` is backed by the arena allocator.
                // Declaration order (arena before log) guarantees `log` drops first on return.
                let err_value = log.to_js(global_this, "reading root directory");
                return global_this.throw_value(err_value?);
            }
        };

        let mut router = Router::Router::init(
            vm.transpiler.fs,
            &allocator,
            Router::Config {
                dir: path_to_use,
                extensions: if !extensions.is_empty() {
                    extensions.as_slice()
                } else {
                    DEFAULT_EXTENSIONS
                },
                asset_prefix_path: asset_prefix_slice.slice(),
                ..Default::default()
            },
        )
        .expect("unreachable");

        if let Err(_) = router.load_routes(
            &mut log,
            root_dir_info,
            // TODO(port): `Resolver` passed as comptime type param + `&vm.transpiler.resolver` value.
            &mut vm.transpiler.resolver,
            router.config.dir,
        ) {
            // Build the JS error before arena teardown: `log` is backed by the arena allocator.
            // Declaration order (arena before log) guarantees `log` drops first on return.
            let err_value = log.to_js(global_this, "loading routes");
            return global_this.throw_value(err_value?);
        }

        if let Some(origin) = argument.get(global_this, "origin")? {
            if !origin.is_string() {
                return global_this.throw_invalid_arguments("Expected origin to be a string", ());
            }
            origin_str = origin.to_slice(global_this)?;
        }

        if log.errors + log.warnings > 0 {
            // Build the JS error before arena teardown: `log` is backed by the arena allocator.
            // Declaration order (arena before log) guarantees `log` drops first on return.
            let err_value = log.to_js(global_this, "loading routes");
            return global_this.throw_value(err_value?);
        }

        let base_dir_str = if !root_dir_info.abs_real_path.is_empty() {
            root_dir_info.abs_real_path
        } else {
            root_dir_info.abs_path
        };

        let mut fs_router = Box::new(FileSystemRouter {
            origin: if origin_str.len() > 0 {
                Some(vm.ref_counted_string(origin_str.slice(), None, true))
            } else {
                None
            },
            base_dir: Some(vm.ref_counted_string(base_dir_str, None, true)),
            asset_prefix: if asset_prefix_slice.len() > 0 {
                Some(vm.ref_counted_string(asset_prefix_slice.slice(), None, true))
            } else {
                None
            },
            router,
            arena,
        });

        fs_router.router.config.dir = fs_router.base_dir.as_ref().unwrap().slice();
        // PORT NOTE: `base_dir.?.ref()` — with Arc<RefString> the extra ref is a clone we
        // intentionally leak to match Zig's +1 (router.config.dir borrows it past Arc drop).
        // TODO(port): lifetime — Phase B should make router.config.dir own its bytes instead.
        core::mem::forget(fs_router.base_dir.as_ref().unwrap().clone());

        // TODO: Memory leak? We haven't freed `asset_prefix_slice`, but we can't do so because the
        // underlying string is borrowed in `fs_router.router.config.asset_prefix_path`.
        // `FileSystemRouter.deinit` frees `fs_router.asset_prefix`, but that's a clone of
        // `asset_prefix_slice`. The original is not freed.
        Ok(fs_router)
    }

    pub fn bust_dir_cache_recursive(&mut self, global_this: &JSGlobalObject, input_path: &[u8]) {
        let vm = global_this.bun_vm();
        let mut path = input_path;
        #[cfg(windows)]
        {
            // TODO(port): borrows thread-local buf for the duration of recursion; Zig used a
            // `ThreadlocalBuffers` pool that hands out a fresh slot per `.get()`.
            WIN32_NORMALIZE_BUF.with_borrow_mut(|buf| {
                path = vm.transpiler.resolver.fs.normalize_buf(buf, path);
            });
        }

        let root_dir_info = match vm.transpiler.resolver.read_dir_info(path) {
            Ok(v) => v,
            Err(_) => return,
        };

        if let Some(dir) = root_dir_info {
            if let Some(entries) = dir.get_entries_const() {
                let mut iter = entries.data.iter();
                'outer: while let Some(entry_ptr) = iter.next() {
                    let entry = *entry_ptr.value_ptr();
                    if entry.base()[0] == b'.' {
                        continue 'outer;
                    }
                    if entry.kind(&vm.transpiler.fs.fs, false) == Fs::EntryKind::Dir {
                        // PORT NOTE: `inline for (Router.banned_dirs)` — banned_dirs is a const
                        // slice; plain `for` over const array is equivalent.
                        for banned_dir in Router::BANNED_DIRS {
                            if entry.base() == banned_dir {
                                continue 'outer;
                            }
                        }

                        let abs_parts_con: [&[u8]; 2] = [entry.dir(), entry.base()];
                        let full_path = vm.transpiler.fs.abs(&abs_parts_con);

                        let _ = vm
                            .transpiler
                            .resolver
                            .bust_dir_cache(strings::without_trailing_slash_windows_path(full_path));
                        self.bust_dir_cache_recursive(global_this, full_path);
                    }
                }
            }
        }

        let _ = vm.transpiler.resolver.bust_dir_cache(path);
    }

    pub fn bust_dir_cache(&mut self, global_this: &JSGlobalObject) {
        let dir = strings::without_trailing_slash_windows_path(self.router.config.dir);
        self.bust_dir_cache_recursive(global_this, dir);
    }

    #[bun_jsc::host_fn(method)]
    pub fn reload(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let this_value = callframe.this();

        let mut arena = Box::new(ArenaAllocator::new());
        let allocator = arena.allocator();
        let vm = global_this.bun_vm();

        let orig_log = vm.transpiler.resolver.log;
        let mut log = Log::Log::new(&allocator);
        vm.transpiler.resolver.log = &mut log;
        // TODO(port): errdefer — see note in constructor.
        let _restore_log = scopeguard::guard((), |_| {
            vm.transpiler.resolver.log = orig_log;
        });

        this.bust_dir_cache(global_this);

        let root_dir_info = match vm.transpiler.resolver.read_dir_info(this.router.config.dir) {
            Ok(Some(info)) => info,
            Ok(None) => {
                return global_this.throw(format_args!(
                    "Unable to find directory: {}",
                    bstr::BStr::new(this.router.config.dir)
                ));
            }
            Err(_) => {
                // Build the JS error before arena teardown: `log` is backed by the arena allocator.
                // Declaration order (arena before log) guarantees `log` drops first on return.
                let err_value = log.to_js(global_this, "reading root directory");
                return global_this.throw_value(err_value?);
            }
        };

        let mut router = Router::Router::init(
            vm.transpiler.fs,
            &allocator,
            Router::Config {
                dir: allocator.dupe(this.router.config.dir),
                extensions: allocator.dupe_slice(this.router.config.extensions),
                asset_prefix_path: this.router.config.asset_prefix_path,
                ..Default::default()
            },
        )
        .expect("unreachable");
        if let Err(_) = router.load_routes(
            &mut log,
            root_dir_info,
            &mut vm.transpiler.resolver,
            router.config.dir,
        ) {
            // Build the JS error before arena teardown: `log` is backed by the arena allocator.
            // Declaration order (arena before log) guarantees `log` drops first on return.
            let err_value = log.to_js(global_this, "loading routes");
            return global_this.throw_value(err_value?);
        }

        // `this.router.deinit(); this.arena.deinit(); destroy(this.arena)` — drop old values.
        // PORT NOTE: order matters — old router borrows slices from old arena, so it must drop
        // first (matches Zig teardown order).
        this.router = router;
        this.arena = arena;
        // TODO(port): codegen'd cached-property setter `js.routesSetCached`.
        Self::routes_set_cached(this_value, global_this, JSValue::ZERO);
        Ok(this_value)
    }

    #[bun_jsc::host_fn(method)]
    pub fn r#match(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let argument_ = callframe.arguments_old(2);
        if argument_.len() == 0 {
            return global_this.throw_invalid_arguments("Expected string, Request or Response", ());
        }

        let argument = argument_.ptr()[0];
        if argument.is_empty_or_undefined_or_null() || !argument.is_cell() {
            return global_this.throw_invalid_arguments("Expected string, Request or Response", ());
        }

        let mut path: ZigString::Slice = 'brk: {
            if argument.is_string() {
                break 'brk argument.to_slice(global_this)?.clone_if_borrowed()?;
            }

            if argument.is_cell() {
                if let Some(req) = argument.as_::<Request>() {
                    req.ensure_url().expect("unreachable");
                    break 'brk req.url.to_utf8();
                }

                if let Some(resp) = argument.as_::<Response>() {
                    break 'brk resp.get_utf8_url();
                }
            }

            return global_this.throw_invalid_arguments("Expected string, Request or Response", ());
        };

        if path.len() == 0 || (path.len() == 1 && path.ptr()[0] == b'/') {
            path = ZigString::Slice::from_utf8_never_free(b"/");
        }

        if strings::has_prefix(path.slice(), b"http://")
            || strings::has_prefix(path.slice(), b"https://")
            || strings::has_prefix(path.slice(), b"file://")
        {
            let prev_path = path;
            path = ZigString::Slice::init_dupe(URL::parse(prev_path.slice()).pathname)?;
        }

        let url_path = match URLPath::parse(path.slice()) {
            Ok(v) => v,
            Err(err) => {
                return global_this.throw(format_args!(
                    "{} parsing path: {}",
                    err.name(),
                    bstr::BStr::new(path.slice())
                ));
            }
        };
        let mut params = Router::ParamList::default();
        // `defer params.deinit(allocator)` → Drop
        let Some(route) = this.router.routes.match_page_with_allocator(
            b"",
            url_path,
            &mut params,
        ) else {
            return Ok(JSValue::NULL);
        };

        let result = MatchedRoute::init(
            route,
            this.origin.clone(),
            this.asset_prefix.clone(),
            this.base_dir.as_ref().unwrap().clone(),
        )
        .expect("unreachable");

        // TODO: Memory leak? We haven't freed `path`, but we can't do so because the underlying
        // string is borrowed in `result.route_holder.pathname` and `result.route_holder.query_string`
        // (see `Routes.matchPageWithAllocator`, which does not clone these fields but rather
        // directly reuses parts of the `URLPath`, which itself borrows from `path`).
        // `MatchedRoute.deinit` doesn't free any fields of `route_holder`, so the string is not
        // freed.
        // TODO(port): lifetime — `path` must outlive `result`; intentionally leaked here as in Zig.
        core::mem::forget(path);
        Ok(result.to_js(global_this))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_origin(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        if let Some(origin) = &this.origin {
            return Ok(ZigString::init(origin.slice()).with_encoding().to_js(global_this));
        }

        Ok(JSValue::NULL)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_routes(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let paths = this.router.get_entry_points();
        let names = this.router.get_names();
        let mut name_strings: Vec<ZigString> = vec![ZigString::default(); names.len() * 2];
        // `defer free(name_strings)` → Drop
        let (name_strings_slice, paths_strings) = name_strings.split_at_mut(names.len());
        for (i, name) in names.iter().enumerate() {
            name_strings_slice[i] = ZigString::init(name).with_encoding();
            paths_strings[i] = ZigString::init(paths[i]).with_encoding();
        }
        Ok(JSValue::from_entries(
            global_this,
            name_strings_slice.as_ptr(),
            paths_strings.as_ptr(),
            names.len(),
            true,
        ))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_style(_this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(bun_str::String::static_("nextjs").to_js(global_this))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_asset_prefix(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        if let Some(asset_prefix) = &this.asset_prefix {
            return Ok(ZigString::init(asset_prefix.slice())
                .with_encoding()
                .to_js(global_this));
        }

        Ok(JSValue::NULL)
    }

    pub fn finalize(this: *mut FileSystemRouter) {
        // SAFETY: called by JSC finalizer on the mutator thread; `this` is the m_ctx payload.
        let this = unsafe { &mut *this };
        // PORT NOTE: Arc<RefString> drops handle the deref()s; Router/arena drop in Box::from_raw.
        this.asset_prefix = None;
        this.origin = None;
        this.base_dir = None;
        // TODO(port): Zig did NOT `destroy(this.arena)` here (only `deinit`) — possible Zig bug.
        // Dropping the Box frees both contents and the allocation.
        // SAFETY: codegen guarantees `this` was Box::into_raw'd in constructor.
        drop(unsafe { Box::from_raw(this) });
    }
}

#[bun_jsc::JsClass]
pub struct MatchedRoute {
    /// Self-referential: always points at `self.route_holder`. See `init`.
    pub route: *const RouterMatch,
    pub route_holder: RouterMatch,
    pub query_string_map: Option<QueryStringMap>,
    pub param_map: Option<QueryStringMap>,
    pub params_list_holder: Router::ParamList,
    pub origin: Option<Arc<jsc::RefString>>,
    pub asset_prefix: Option<Arc<jsc::RefString>>,
    pub needs_deinit: bool,
    pub base_dir: Option<Arc<jsc::RefString>>,
}

impl MatchedRoute {
    // PORT NOTE: `pub const js = jsc.Codegen.JSMatchedRoute; toJS/fromJS/fromJSDirect`
    // wired by `#[bun_jsc::JsClass]` — deleted.

    #[inline]
    fn route(&self) -> &RouterMatch {
        // SAFETY: `self.route` always points at `self.route_holder` (set in `init`); the Box
        // is never moved after construction (heap-stable).
        unsafe { &*self.route }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_name(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(ZigString::init(this.route().name).with_encoding().to_js(global_this))
    }

    pub fn init(
        match_: RouterMatch,
        origin: Option<Arc<jsc::RefString>>,
        asset_prefix: Option<Arc<jsc::RefString>>,
        base_dir: Arc<jsc::RefString>,
    ) -> Result<Box<MatchedRoute>, bun_alloc::AllocError> {
        let params_list = match_.params.clone()?;

        let mut route = Box::new(MatchedRoute {
            route_holder: match_,
            route: core::ptr::null(),
            asset_prefix,
            origin,
            base_dir: Some(base_dir),
            query_string_map: None,
            param_map: None,
            params_list_holder: Router::ParamList::default(),
            needs_deinit: true,
        });
        // PORT NOTE: `base_dir.ref()` / `o.ref()` / `prefix.ref()` — Arc::clone at call site
        // already bumped the refcount; no extra ref needed here.
        route.params_list_holder = params_list;
        route.route = &route.route_holder as *const RouterMatch;
        route.route_holder.params = &route.params_list_holder as *const Router::ParamList;

        Ok(route)
    }

    // PORT NOTE: `deinit` is called only from `finalize`; not exposed as `Drop` because
    // `MatchedRoute` is a JsClass m_ctx payload (finalize owns teardown per PORTING.md).
    fn deinit(this: *mut MatchedRoute) {
        // SAFETY: called from finalize on mutator thread.
        let this_ref = unsafe { &mut *this };
        this_ref.query_string_map = None;
        this_ref.param_map = None;
        if this_ref.needs_deinit {
            let pathname = this_ref.route().pathname;
            if !pathname.is_empty()
                // SAFETY: pathname.as_ptr() is a valid (possibly non-mimalloc) pointer;
                // mi_is_in_heap_region only reads heap metadata and accepts any pointer.
                && unsafe { bun_alloc::mimalloc::mi_is_in_heap_region(pathname.as_ptr().cast()) }
            {
                // SAFETY: pointer was allocated by mimalloc (checked above).
                unsafe { bun_alloc::mimalloc::mi_free(pathname.as_ptr() as *mut core::ffi::c_void) };
            }

            this_ref.params_list_holder = Router::ParamList::default();
        }

        this_ref.origin = None;
        this_ref.asset_prefix = None;
        this_ref.base_dir = None;

        // SAFETY: `this` was Box::into_raw'd by codegen at construction.
        drop(unsafe { Box::from_raw(this) });
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_file_path(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(ZigString::init(this.route().file_path)
            .with_encoding()
            .to_js(global_this))
    }

    pub fn finalize(this: *mut MatchedRoute) {
        Self::deinit(this);
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_pathname(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(ZigString::init(this.route().pathname)
            .with_encoding()
            .to_js(global_this))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_route(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(ZigString::init(this.route().name)
            .with_encoding()
            .to_js(global_this))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_kind(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(kind_enum::init(this.route().name).to_js(global_this))
    }

    pub fn create_query_object(ctx: &JSGlobalObject, map: &mut QueryStringMap) -> JsResult<JSValue> {
        struct QueryObjectCreator<'a> {
            query: &'a mut QueryStringMap,
        }
        impl<'a> QueryObjectCreator<'a> {
            fn create(&mut self, obj: &mut JSObject, global: &JSGlobalObject) -> JsResult<()> {
                QUERY_STRING_VALUES_BUF.with_borrow_mut(|values_buf| {
                    QUERY_STRING_VALUE_REFS_BUF.with_borrow_mut(|refs_buf| {
                        let mut iter = self.query.iter();
                        while let Some(entry) = iter.next(values_buf) {
                            let entry_name = entry.name;
                            let mut str = ZigString::init(entry_name).with_encoding();

                            debug_assert!(!entry.values.is_empty());
                            if entry.values.len() > 1 {
                                let values = &mut refs_buf[0..entry.values.len()];
                                for (i, value) in entry.values.iter().enumerate() {
                                    values[i] = ZigString::init(value).with_encoding();
                                }
                                obj.put_record(global, &mut str, values)?;
                            } else {
                                refs_buf[0] = ZigString::init(entry.values[0]).with_encoding();
                                obj.put_record(global, &mut str, &mut refs_buf[0..1])?;
                            }
                        }
                        Ok(())
                    })
                })
            }
        }

        let mut creator = QueryObjectCreator { query: map };

        // TODO(port): `JSObject.createWithInitializer` takes (Type, *creator, ctx, count) in Zig.
        let value = JSObject::create_with_initializer(
            &mut creator,
            ctx,
            map.get_name_count(),
            QueryObjectCreator::create,
        )?;

        Ok(value)
    }

    pub fn get_script_src_string(
        origin: &[u8],
        // PORT NOTE: Zig used `comptime Writer: type, writer: Writer` over a fixedBufferStream of
        // path bytes — these are bytes, not UTF-8 text, so use the byte-writer trait.
        writer: &mut impl bun_io::Write,
        file_path: &[u8],
        client_framework_enabled: bool,
    ) {
        let mut entry_point_tempbuf = PathBuffer::uninit();
        // We don't store the framework config including the client parts in the server
        // instead, we just store a boolean saying whether we should generate this whenever the script is requested
        // this is kind of bad. we should consider instead a way to inline the contents of the script.
        if client_framework_enabled {
            bun_object::get_public_path(
                Transpiler::ClientEntryPoint::generate_entry_point_path(
                    &mut entry_point_tempbuf,
                    Fs::PathName::init(file_path),
                ),
                origin,
                writer,
            );
        } else {
            bun_object::get_public_path(file_path, origin, writer);
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_script_src(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let mut buf = PathBuffer::uninit();
        // TODO(port): `std.io.fixedBufferStream` — using a byte cursor writer over `buf`.
        let mut writer = bun_io::FixedBufferWriter::new(buf.as_mut_slice());
        bun_object::get_public_path_with_asset_prefix(
            this.route().file_path,
            if let Some(base_dir) = &this.base_dir {
                base_dir.slice()
            } else {
                jsc::VirtualMachine::get().transpiler.fs.top_level_dir
            },
            if let Some(origin) = &this.origin {
                URL::parse(origin.slice())
            } else {
                URL::default()
            },
            if let Some(prefix) = &this.asset_prefix {
                prefix.slice()
            } else {
                b""
            },
            &mut writer,
            path::Platform::Posix,
        );
        Ok(ZigString::init(&buf.as_slice()[0..writer.pos()])
            .with_encoding()
            .to_js(global_this))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_params(this: &mut Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        if this.route().params.len() == 0 {
            return Ok(JSValue::create_empty_object(global_this, 0));
        }

        if this.param_map.is_none() {
            // PORT NOTE: reshaped for borrowck — capture borrowed scalars before mutating `this`.
            let route = this.route();
            let scanner = CombinedScanner::init(
                b"",
                route.pathname_without_leading_slash(),
                route.name,
                route.params,
            );
            this.param_map = Some(QueryStringMap::init_with_scanner(scanner)?);
        }

        Self::create_query_object(global_this, this.param_map.as_mut().unwrap())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_query(this: &mut Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let route = this.route();
        if route.query_string.is_empty() && route.params.len() == 0 {
            return Ok(JSValue::create_empty_object(global_this, 0));
        } else if route.query_string.is_empty() {
            return this.get_params(global_this);
        }

        if this.query_string_map.is_none() {
            let route = this.route();
            if route.params.len() > 0 {
                let scanner = CombinedScanner::init(
                    route.query_string,
                    route.pathname_without_leading_slash(),
                    route.name,
                    route.params,
                );
                this.query_string_map = Some(QueryStringMap::init_with_scanner(scanner)?);
            } else {
                this.query_string_map = Some(QueryStringMap::init(route.query_string)?);
            }
        }

        // If it's still null, the query string has no names.
        if let Some(map) = &mut this.query_string_map {
            return Self::create_query_object(global_this, map);
        }

        Ok(JSValue::create_empty_object(global_this, 0))
    }
}

mod kind_enum {
    use super::*;

    pub const EXACT: &[u8] = b"exact";
    pub const CATCH_ALL: &[u8] = b"catch-all";
    pub const OPTIONAL_CATCH_ALL: &[u8] = b"optional-catch-all";
    pub const DYNAMIC: &[u8] = b"dynamic";

    // this is kinda stupid it should maybe just store it
    pub fn init(name: &[u8]) -> ZigString {
        if strings::contains(name, b"[[...") {
            ZigString::init(OPTIONAL_CATCH_ALL)
        } else if strings::contains(name, b"[...") {
            ZigString::init(CATCH_ALL)
        } else if strings::contains(name, b"[") {
            ZigString::init(DYNAMIC)
        } else {
            ZigString::init(EXACT)
        }
    }
}

// PORT NOTE: `bun.ThreadlocalBuffers(struct { buf: if (isWindows) [MAX_PATH_BYTES*2]u8 else void })`
#[cfg(windows)]
thread_local! {
    static WIN32_NORMALIZE_BUF: RefCell<[u8; MAX_PATH_BYTES * 2]> =
        const { RefCell::new([0u8; MAX_PATH_BYTES * 2]) };
}

// `threadlocal var query_string_values_buf: [256]string` / `[256]ZigString`
thread_local! {
    static QUERY_STRING_VALUES_BUF: RefCell<[&'static [u8]; 256]> =
        const { RefCell::new([b"" as &[u8]; 256]) };
    static QUERY_STRING_VALUE_REFS_BUF: RefCell<[ZigString; 256]> =
        // TODO(port): needs `ZigString: Copy` + const ZEROED for the const initializer.
        const { RefCell::new([ZigString::EMPTY; 256]) };
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/filesystem_router.zig (709 lines)
//   confidence: medium
//   todos:      15
//   notes:      Arena ownership + self-ref `route` ptr + scopeguard log-restore need Phase B borrowck work; RefString mapped to Arc per LIFETIMES.tsv but Zig uses intrusive ref/deref.
// ──────────────────────────────────────────────────────────────────────────
