//! `Bun.FileSystemRouter` / `MatchedRoute` — Next.js-style file router.

pub const DEFAULT_EXTENSIONS: &[&[u8]] = &[
    b"tsx", b"jsx", b"ts", b"mjs", b"cjs", b"js",
];

// PORT NOTE: re-export the JsClass-backed structs so `BunObject.rs`'s
// `get_constructor::<crate::api::filesystem_router::FileSystemRouter>` resolves
// to a `JsClass` impl.
pub use _jsc_gated::{FileSystemRouter, MatchedRoute};

pub mod kind_enum {
    pub const EXACT: &[u8] = b"exact";
    pub const CATCH_ALL: &[u8] = b"catch-all";
    pub const OPTIONAL_CATCH_ALL: &[u8] = b"optional-catch-all";
    pub const DYNAMIC: &[u8] = b"dynamic";

    pub fn classify(name: &[u8]) -> &'static [u8] {
        if bun_str::strings::contains(name, b"[[...") {
            OPTIONAL_CATCH_ALL
        } else if bun_str::strings::contains(name, b"[...") {
            CATCH_ALL
        } else if bun_str::strings::contains(name, b"[") {
            DYNAMIC
        } else {
            EXACT
        }
    }
}

// TODO(b2-blocked): bun_jsc + #[bun_jsc::host_fn]/JsClass proc-macros

mod _jsc_gated {
use core::cell::RefCell;

use bun_alloc::Arena as ArenaAllocator;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSObject, JSValue, JsResult};
use bun_jsc::{LogJsc, StringJsc, JsClass as _, ObjectInitializer};
use bun_jsc::ref_string::RefString;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::zig_string::ZigString;
use bun_str::ZigStringSlice;
use bun_logger as Log;
use bun_paths::{self as path, PathBuffer, MAX_PATH_BYTES};
use bun_str::strings;

use bun_http_types::URLPath;
use bun_resolver::fs as Fs;
use bun_router::{self as Router, Match as RouterMatch, RouteConfig};
use bun_url::{CombinedScanner, QueryStringMap, URL};
use bun_url::route_param::List as ParamList;

use crate::webcore::{Request, Response};
use crate::api::bun_object;
use bun_bundler as Transpiler;

// ── local shims for upstream API gaps (phase-d) ──────────────────────────
trait ZigStringSliceExt {
    fn length(&self) -> usize;
    fn clone_if_borrowed(self) -> Result<ZigStringSlice, bun_core::AllocError>;
    fn clone_with_trailing_slash(&self) -> Result<ZigStringSlice, bun_core::AllocError>;
}
impl ZigStringSliceExt for ZigStringSlice {
    #[inline]
    fn length(&self) -> usize { self.slice().len() }
    fn clone_if_borrowed(self) -> Result<ZigStringSlice, bun_core::AllocError> {
        match self {
            ZigStringSlice::Owned(v) => Ok(ZigStringSlice::Owned(v)),
            other => ZigStringSlice::init_dupe(other.slice()),
        }
    }
    fn clone_with_trailing_slash(&self) -> Result<ZigStringSlice, bun_core::AllocError> {
        let s = self.slice();
        let mut v = Vec::with_capacity(s.len() + 1);
        v.extend_from_slice(s);
        if s.last() != Some(&b'/') {
            v.push(b'/');
        }
        Ok(ZigStringSlice::Owned(v))
    }
}

#[inline]
unsafe fn ref_string_slice<'a>(ptr: *mut RefString) -> &'a [u8] {
    // SAFETY: caller guarantees `ptr` is a live RefString for `'a`.
    unsafe { (*ptr).leak() }
}

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
    pub origin: Option<*mut RefString>,
    pub base_dir: Option<*mut RefString>,
    // PORT NOTE: Router<'a> only borrows the global FileSystem singleton — `'static` is faithful.
    pub router: Router::Router<'static>,
    // PERF(port): was arena bulk-free — Router borrows slices from this arena across calls;
    // kept as boxed arena per LIFETIMES.tsv (OWNED). Phase B: confirm bumpalo vs ArenaAllocator.
    pub arena: Box<ArenaAllocator>,
    // PORT NOTE: dropped `allocator: std.mem.Allocator` field — it was always `arena.allocator()`.
    pub asset_prefix: Option<*mut RefString>,
}

impl FileSystemRouter {
    // PORT NOTE: `pub const js = jsc.Codegen.JSFileSystemRouter; toJS/fromJS/fromJSDirect`
    // are wired by `#[bun_jsc::JsClass]` codegen — deleted per PORTING.md.

    // PORT NOTE: no `#[bun_jsc::host_fn]` here — the `Free` shim it emits calls
    // a bare `constructor(...)` which cannot resolve inside an `impl`. The
    // `#[bun_jsc::JsClass]` macro already emits the `<Self>::constructor` shim.
    pub fn constructor(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<Box<FileSystemRouter>> {
        let argument_ = callframe.arguments_old::<1>();
        if argument_.len == 0 {
            return Err(global_this.throw_invalid_arguments("Expected object"));
        }

        let argument = argument_.ptr[0];
        if argument.is_empty_or_undefined_or_null() || !argument.is_object() {
            return Err(global_this.throw_invalid_arguments("Expected object"));
        }
        // SAFETY: `bun_vm()` returns the live VM raw pointer; valid for the call.
        let vm = unsafe { &mut *global_this.bun_vm() };

        let mut root_dir_path: ZigStringSlice = ZigStringSlice::from_utf8_never_free(
            // SAFETY: `transpiler.fs` is the process-global FileSystem singleton.
            unsafe { (*vm.transpiler.fs).top_level_dir },
        );
        // `defer root_dir_path.deinit()` → Drop on ZigStringSlice
        let mut origin_str: ZigStringSlice = ZigStringSlice::default();
        let mut asset_prefix_slice: ZigStringSlice = ZigStringSlice::default();

        let mut out_buf = [0u8; MAX_PATH_BYTES * 2];
        if let Some(style_val) = argument.get(global_this, "style")? {
            if !(style_val.get_zig_string(global_this)?).eql_comptime(b"nextjs") {
                return Err(global_this.throw_invalid_arguments(
                    "Only 'nextjs' style is currently implemented",
                ));
            }
        } else {
            return Err(global_this.throw_invalid_arguments(
                "Expected 'style' option (ex: \"style\": \"nextjs\")",
            ));
        }

        if let Some(dir) = argument.get(global_this, "dir")? {
            if !dir.is_string() {
                return Err(global_this.throw_invalid_arguments("Expected dir to be a string"));
            }
            let root_dir_path_ = dir.to_slice(global_this)?;
            if !(root_dir_path_.length() == 0 || root_dir_path_.slice() == b".") {
                // resolve relative path if needed
                let path_ = root_dir_path_.slice();
                if path::Platform::AUTO.is_absolute(path_) {
                    root_dir_path = root_dir_path_;
                } else {
                    let parts: [&[u8]; 1] = [path_];
                    root_dir_path = ZigStringSlice::from_utf8_never_free(
                        path::resolve_path::join_abs_string_buf::<path::platform::Auto>(
                            Fs::FileSystem::instance().top_level_dir,
                            &mut out_buf,
                            &parts,
                        ),
                    );
                }
            }
        } else {
            // dir is not optional
            return Err(global_this.throw_invalid_arguments("Expected dir to be a string"));
        }
        // PERF(port): was arena bulk-free — extensions/asset_prefix/log all allocated from this.
        let arena = Box::new(ArenaAllocator::new());
        let mut extensions: Vec<&[u8]> = Vec::new();
        if let Some(file_extensions) = argument.get(global_this, "fileExtensions")? {
            if !file_extensions.js_type().is_array() {
                return Err(global_this
                    .throw_invalid_arguments("Expected fileExtensions to be an Array"));
            }

            let mut iter = file_extensions.array_iterator(global_this)?;
            extensions.reserve_exact(iter.len as usize);
            while let Some(val) = iter.next()? {
                if !val.is_string() {
                    return Err(global_this.throw_invalid_arguments(
                        "Expected fileExtensions to be an Array of strings",
                    ));
                }
                if val.get_length(global_this)? == 0 {
                    continue;
                }
                // PERF(port): was appendAssumeCapacity
                // TODO(port): `toUTF8Bytes(allocator)[1..]` — slices off leading '.'; arena owns the bytes.
                let _ = val;
                extensions.push(todo!("blocked_on: bun_jsc::JSValue::to_utf8_bytes"));
            }
        }

        if let Some(asset_prefix) = argument.get_truthy(global_this, "assetPrefix")? {
            if !asset_prefix.is_string() {
                return Err(global_this
                    .throw_invalid_arguments("Expected assetPrefix to be a string"));
            }

            asset_prefix_slice = asset_prefix
                .to_slice(global_this)?
                .clone_if_borrowed()?;
        }
        let orig_log = vm.transpiler.resolver.log;
        let mut log = Log::Log::new();
        vm.transpiler.resolver.log = &mut log as *mut _;
        // TODO(port): errdefer-style restore — scopeguard would borrow `vm` for the whole scope.
        // Phase B: wrap in scopeguard or restore manually on every early-return path below.
        let _restore_log = scopeguard::guard((), move |_| {
            // SAFETY: VM singleton is alive for the JS thread; `orig_log` was the
            // resolver's previous log pointer.
            unsafe { (*VirtualMachine::get()).transpiler.resolver.log = orig_log; }
        });

        let path_to_use_slice = root_dir_path
            .clone_with_trailing_slash()
            .expect("unreachable");
        let path_to_use = path_to_use_slice.slice();

        let root_dir_info = match vm.transpiler.resolver.read_dir_info(path_to_use) {
            Ok(Some(info)) => info,
            Ok(None) => {
                return Err(global_this.throw(format_args!(
                    "Unable to find directory: {}",
                    bstr::BStr::new(root_dir_path.slice())
                )));
            }
            Err(_) => {
                // Build the JS error before arena teardown: `log` is backed by the arena allocator.
                // Declaration order (arena before log) guarantees `log` drops first on return.
                let err_value = log.to_js(global_this, "reading root directory");
                return Err(global_this.throw_value(err_value?));
            }
        };

        let _ = (path_to_use, &extensions, &asset_prefix_slice);
        // TODO(port): `Router::Router::init` takes `&'a b1_stubs::FileSystem` and
        // `load_routes` takes `&mut b1_stubs::logger::Log` + `R: ResolverLike` —
        // neither is satisfiable from this crate yet (private stub module + no
        // `ResolverLike` impl for `bun_resolver::Resolver`).
        let mut router: Router::Router<'static> = todo!(
            "blocked_on: bun_router::Router::init / bun_router::ResolverLike for bun_resolver::Resolver"
        );

        if let Some(origin) = argument.get(global_this, "origin")? {
            if !origin.is_string() {
                return Err(global_this.throw_invalid_arguments("Expected origin to be a string"));
            }
            origin_str = origin.to_slice(global_this)?;
        }

        if log.errors + log.warnings > 0 {
            // Build the JS error before arena teardown: `log` is backed by the arena allocator.
            // Declaration order (arena before log) guarantees `log` drops first on return.
            let err_value = log.to_js(global_this, "loading routes");
            return Err(global_this.throw_value(err_value?));
        }

        // SAFETY: `root_dir_info` is a live `*mut DirInfo` from the resolver cache.
        let root_dir = unsafe { &*root_dir_info };
        let base_dir_str: &[u8] = if !root_dir.abs_real_path.is_empty() {
            root_dir.abs_real_path
        } else {
            root_dir.abs_path
        };

        let mut fs_router = Box::new(FileSystemRouter {
            origin: if origin_str.length() > 0 {
                Some(vm.ref_counted_string::<true>(origin_str.slice(), None) as *mut RefString)
            } else {
                None
            },
            base_dir: Some(vm.ref_counted_string::<true>(base_dir_str, None) as *mut RefString),
            asset_prefix: if asset_prefix_slice.length() > 0 {
                Some(vm.ref_counted_string::<true>(asset_prefix_slice.slice(), None)
                    as *mut RefString)
            } else {
                None
            },
            router,
            arena,
        });

        // PORT NOTE: `base_dir.?.ref()` — Zig borrowed the RefString bytes into
        // `router.config.dir` and bumped the refcount. RouteConfig::dir is now an owned
        // `Box<[u8]>`, so copy the bytes; no extra Arc leak needed.
        // SAFETY: `base_dir` was just set to a live RefString pointer above.
        fs_router.router.config.dir =
            Box::from(unsafe { ref_string_slice(fs_router.base_dir.unwrap()) });

        // TODO: Memory leak? We haven't freed `asset_prefix_slice`, but we can't do so because the
        // underlying string is borrowed in `fs_router.router.config.asset_prefix_path`.
        // `FileSystemRouter.deinit` frees `fs_router.asset_prefix`, but that's a clone of
        // `asset_prefix_slice`. The original is not freed.
        Ok(fs_router)
    }

    pub fn bust_dir_cache_recursive(&mut self, global_this: &JSGlobalObject, input_path: &[u8]) {
        // SAFETY: `bun_vm()` returns the live VM raw pointer; valid for the call.
        let vm = unsafe { &mut *global_this.bun_vm() };
        let path = input_path;
        #[cfg(windows)]
        let path = {
            // TODO(port): borrows thread-local buf for the duration of recursion; Zig used a
            // `ThreadlocalBuffers` pool that hands out a fresh slot per `.get()`.
            let _ = path;
            todo!("blocked_on: bun_resolver::fs::FileSystem::normalize_buf")
        };

        let root_dir_info = match vm.transpiler.resolver.read_dir_info(path) {
            Ok(v) => v,
            Err(_) => return,
        };

        if let Some(dir) = root_dir_info {
            let _ = dir;
            // TODO(port): `DirInfo::get_entries_const` + `EntryMap` iteration —
            // upstream `bun_resolver::dir_info::DirInfo` does not yet expose a
            // stable iterator surface here; the directory walk recurses through
            // `Entry::kind`/`Entry::dir` which take `&mut Implementation`.
            todo!("blocked_on: bun_resolver::dir_info::DirInfo::get_entries_const iteration");
        }

        let _ = vm.transpiler.resolver.bust_dir_cache(path);
    }

    pub fn bust_dir_cache(&mut self, global_this: &JSGlobalObject) {
        let dir = strings::paths::without_trailing_slash_windows_path(&self.router.config.dir);
        // PORT NOTE: reshaped for borrowck — `dir` borrows `self.router.config.dir`; the
        // recursive walk re-derives the path from the resolver per-iteration so a one-time
        // copy is sufficient.
        let dir = dir.to_vec();
        self.bust_dir_cache_recursive(global_this, &dir);
    }

    #[bun_jsc::host_fn(method)]
    pub fn reload(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let this_value = callframe.this();

        let arena = Box::new(ArenaAllocator::new());
        // SAFETY: `bun_vm()` returns the live VM raw pointer; valid for the call.
        let vm = unsafe { &mut *global_this.bun_vm() };

        let orig_log = vm.transpiler.resolver.log;
        let mut log = Log::Log::new();
        vm.transpiler.resolver.log = &mut log as *mut _;
        // TODO(port): errdefer — see note in constructor.
        let _restore_log = scopeguard::guard((), move |_| {
            // SAFETY: see constructor.
            unsafe { (*VirtualMachine::get()).transpiler.resolver.log = orig_log; }
        });

        this.bust_dir_cache(global_this);

        let root_dir_info = match vm.transpiler.resolver.read_dir_info(&this.router.config.dir) {
            Ok(Some(info)) => info,
            Ok(None) => {
                return Err(global_this.throw(format_args!(
                    "Unable to find directory: {}",
                    bstr::BStr::new(&*this.router.config.dir)
                )));
            }
            Err(_) => {
                // Build the JS error before arena teardown: `log` is backed by the arena allocator.
                // Declaration order (arena before log) guarantees `log` drops first on return.
                let err_value = log.to_js(global_this, "reading root directory");
                return Err(global_this.throw_value(err_value?));
            }
        };

        let _ = root_dir_info;
        // TODO(port): see `constructor` — Router::init / load_routes blocked on
        // `b1_stubs` types and missing `ResolverLike` impl.
        let router: Router::Router<'static> = todo!(
            "blocked_on: bun_router::Router::init / bun_router::ResolverLike for bun_resolver::Resolver"
        );

        // `this.router.deinit(); this.arena.deinit(); destroy(this.arena)` — drop old values.
        // PORT NOTE: order matters — old router borrows slices from old arena, so it must drop
        // first (matches Zig teardown order).
        this.router = router;
        this.arena = arena;
        // TODO(port): codegen'd cached-property setter `js.routesSetCached`.
        let _ = this_value;
        todo!("blocked_on: bun_jsc::codegen_cached_accessors!(FileSystemRouter; routes)");
    }

    #[bun_jsc::host_fn(method)]
    pub fn r#match(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let argument_ = callframe.arguments_old::<2>();
        if argument_.len == 0 {
            return Err(global_this.throw_invalid_arguments("Expected string, Request or Response"));
        }

        let argument = argument_.ptr[0];
        if argument.is_empty_or_undefined_or_null() || !argument.is_cell() {
            return Err(global_this.throw_invalid_arguments("Expected string, Request or Response"));
        }

        let mut path: ZigStringSlice = 'brk: {
            if argument.is_string() {
                break 'brk argument.to_slice(global_this)?.clone_if_borrowed()?;
            }

            if argument.is_cell() {
                // TODO(b2-blocked): `Request`/`Response` do not yet impl
                // `bun_jsc::JsClass`, so the typed `JSValue::as_::<T>()` downcast
                // is unavailable.
                let _: (Option<*mut Request>, Option<*mut Response>) = (None, None);
                todo!("blocked_on: bun_jsc::JsClass for webcore::Request / webcore::Response");
            }

            return Err(global_this.throw_invalid_arguments("Expected string, Request or Response"));
        };

        if path.length() == 0 || (path.length() == 1 && path.slice()[0] == b'/') {
            path = ZigStringSlice::from_utf8_never_free(b"/");
        }

        if strings::has_prefix(path.slice(), b"http://")
            || strings::has_prefix(path.slice(), b"https://")
            || strings::has_prefix(path.slice(), b"file://")
        {
            let prev_path = path;
            path = ZigStringSlice::init_dupe(URL::parse(prev_path.slice()).pathname)?;
        }

        let url_path = match URLPath::parse(path.slice()) {
            Ok(v) => v,
            Err(err) => {
                return Err(global_this.throw(format_args!(
                    "{} parsing path: {}",
                    err.name(),
                    bstr::BStr::new(path.slice())
                )));
            }
        };
        let mut params = ParamList::default();
        // `defer params.deinit(allocator)` → Drop
        let Some(route) = this.router.routes.match_page_with_allocator(
            b"",
            &url_path,
            &mut params,
        ) else {
            return Ok(JSValue::NULL);
        };

        let result = MatchedRoute::init(
            route,
            this.origin,
            this.asset_prefix,
            this.base_dir.unwrap(),
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
        if let Some(origin) = this.origin {
            // SAFETY: `origin` is a live RefString for the lifetime of `this`.
            return Ok(ZigString::init(unsafe { ref_string_slice(origin) })
                .with_encoding()
                .to_js(global_this));
        }

        Ok(JSValue::NULL)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_routes(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let paths = this.router.get_entry_points();
        let names = this.router.get_names();
        let mut name_strings: Vec<ZigString> = vec![ZigString::EMPTY; names.len() * 2];
        // `defer free(name_strings)` → Drop
        let (name_strings_slice, paths_strings) = name_strings.split_at_mut(names.len());
        for (i, name) in names.iter().enumerate() {
            name_strings_slice[i] = ZigString::init(name).with_encoding();
            paths_strings[i] = ZigString::init(paths[i]).with_encoding();
        }
        let _ = (global_this, name_strings_slice, paths_strings);
        todo!("blocked_on: bun_jsc::JSValue::from_entries")
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_style(_this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        bun_str::String::static_("nextjs").to_js(global_this)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_asset_prefix(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        if let Some(asset_prefix) = this.asset_prefix {
            // SAFETY: `asset_prefix` is a live RefString for the lifetime of `this`.
            return Ok(ZigString::init(unsafe { ref_string_slice(asset_prefix) })
                .with_encoding()
                .to_js(global_this));
        }

        Ok(JSValue::NULL)
    }

    pub fn finalize(this: *mut FileSystemRouter) {
        // SAFETY: called by JSC finalizer on the mutator thread; `this` is the m_ctx payload.
        let this_ref = unsafe { &mut *this };
        // PORT NOTE: RefString deref()s; Router/arena drop in Box::from_raw.
        for p in [this_ref.asset_prefix.take(), this_ref.origin.take(), this_ref.base_dir.take()]
            .into_iter()
            .flatten()
        {
            // SAFETY: each was produced by `ref_counted_string` and is live until deref.
            unsafe { (*p).deref() };
        }
        // TODO(port): Zig did NOT `destroy(this.arena)` here (only `deinit`) — possible Zig bug.
        // Dropping the Box frees both contents and the allocation.
        // SAFETY: codegen guarantees `this` was Box::into_raw'd in constructor.
        drop(unsafe { Box::from_raw(this) });
    }
}

#[bun_jsc::JsClass(no_construct)]
pub struct MatchedRoute {
    /// Self-referential: always points at `self.route_holder`. See `init`.
    // PORT NOTE: `Match<'a>` borrows arena/request bytes that outlive this object via
    // intentional leaks (see `r#match`); `'static` matches the Zig raw-slice semantics.
    pub route: *const RouterMatch<'static>,
    pub route_holder: RouterMatch<'static>,
    pub query_string_map: Option<QueryStringMap>,
    pub param_map: Option<QueryStringMap>,
    pub params_list_holder: ParamList<'static>,
    pub origin: Option<*mut RefString>,
    pub asset_prefix: Option<*mut RefString>,
    pub needs_deinit: bool,
    pub base_dir: Option<*mut RefString>,
}

impl MatchedRoute {
    // PORT NOTE: `pub const js = jsc.Codegen.JSMatchedRoute; toJS/fromJS/fromJSDirect`
    // wired by `#[bun_jsc::JsClass]` — deleted.

    #[inline]
    fn route(&self) -> &RouterMatch<'static> {
        // SAFETY: `self.route` always points at `self.route_holder` (set in `init`); the Box
        // is never moved after construction (heap-stable).
        unsafe { &*self.route }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_name(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(ZigString::init(this.route().name).with_encoding().to_js(global_this))
    }

    pub fn init(
        match_: RouterMatch<'_>,
        origin: Option<*mut RefString>,
        asset_prefix: Option<*mut RefString>,
        base_dir: *mut RefString,
    ) -> Result<Box<MatchedRoute>, bun_alloc::AllocError> {
        // PORT NOTE: Zig clones the params list and rewires `route_holder.params`
        // to point at `params_list_holder`. `Match<'a>` is invariant over `'a`
        // and stores `&'a mut Vec<Param<'a>>`, which makes the self-referential
        // wiring unrepresentable without `unsafe` lifetime erasure.
        let _ = (match_, origin, asset_prefix, base_dir);
        todo!("blocked_on: bun_router::Match self-referential params (invariant lifetime)")
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

            this_ref.params_list_holder = ParamList::default();
        }

        for p in [this_ref.origin.take(), this_ref.asset_prefix.take(), this_ref.base_dir.take()]
            .into_iter()
            .flatten()
        {
            // SAFETY: each was produced by `ref_counted_string` and is live until deref.
            unsafe { (*p).deref() };
        }

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
        impl<'a> ObjectInitializer for QueryObjectCreator<'a> {
            fn create(&mut self, obj: &mut JSObject, global: &JSGlobalObject) -> JsResult<()> {
                QUERY_STRING_VALUES_BUF.with_borrow_mut(|values_buf| {
                    QUERY_STRING_VALUE_REFS_BUF.with_borrow_mut(|refs_buf| {
                        let mut iter = self.query.iter();
                        while let Some(entry) = iter.next(values_buf) {
                            let entry_name = entry.name;
                            let str = ZigString::init(entry_name).with_encoding();

                            debug_assert!(!entry.values.is_empty());
                            if entry.values.len() > 1 {
                                let values = &mut refs_buf[0..entry.values.len()];
                                for (i, value) in entry.values.iter().enumerate() {
                                    values[i] = ZigString::init(value).with_encoding();
                                }
                                let _ = (&mut *obj, global, &str, &mut *values);
                            } else {
                                refs_buf[0] = ZigString::init(entry.values[0]).with_encoding();
                                let _ = (&mut *obj, global, &str, &mut refs_buf[0..1]);
                            }
                            // `JSObject::put_record` is typed against
                            // `bun_string::ZigString`, but the encoding-aware
                            // constructor lives on `bun_jsc::zig_string::ZigString`.
                            todo!("blocked_on: bun_jsc::JSObject::put_record ZigString unification");
                        }
                        Ok(())
                    })
                })
            }
        }

        let count = map.get_name_count();
        let mut creator = QueryObjectCreator { query: map };

        // TODO(port): `JSObject.createWithInitializer` takes (Type, *creator, ctx, count) in Zig.
        let value = JSObject::create_with_initializer(
            &mut creator,
            ctx,
            count,
        );

        Ok(value)
    }

    pub fn get_script_src_string(
        origin: &URL,
        // PORT NOTE: Zig used `comptime Writer: type, writer: Writer` over a fixedBufferStream of
        // path bytes; the accessible `get_public_path_with_asset_prefix` takes `core::fmt::Write`.
        writer: &mut impl core::fmt::Write,
        file_path: &[u8],
        client_framework_enabled: bool,
    ) {
        // PORT NOTE: `jsc.API.Bun.getPublicPath` is gated behind a private `_jsc_gated` mod in
        // BunObject.rs; it is a thin wrapper over `get_public_path_with_asset_prefix` with
        // `dir = VM.top_level_dir`, `asset_prefix = ""`, `.loose`. Inline that body here.
        // SAFETY: `VirtualMachine::get()` returns a thread-local singleton pointer; this fn is
        // only called on the JS thread where the VM is alive.
        let top_level_dir = unsafe { (*(*VirtualMachine::get()).transpiler.fs).top_level_dir };
        let mut entry_point_tempbuf = PathBuffer::uninit();
        // We don't store the framework config including the client parts in the server
        // instead, we just store a boolean saying whether we should generate this whenever the script is requested
        // this is kind of bad. we should consider instead a way to inline the contents of the script.
        if client_framework_enabled {
            bun_object::get_public_path_with_asset_prefix(
                Transpiler::entry_points::ClientEntryPoint::generate_entry_point_path(
                    &mut entry_point_tempbuf,
                    &Fs::PathName::init(file_path),
                ),
                top_level_dir,
                origin,
                b"",
                writer,
                path::Platform::Loose,
            );
        } else {
            bun_object::get_public_path_with_asset_prefix(
                file_path,
                top_level_dir,
                origin,
                b"",
                writer,
                path::Platform::Loose,
            );
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_script_src(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        // PORT NOTE: Zig used `std.io.fixedBufferStream` over a PathBuffer. The accessible
        // `bun_object::get_public_path_with_asset_prefix` takes `core::fmt::Write`, so write
        // into a `String` (path components are UTF-8 in practice; the underlying impl already
        // routes through `String::from_utf8_lossy` for non-UTF-8 bytes).
        let mut writer = String::with_capacity(MAX_PATH_BYTES);
        let origin_url = if let Some(origin) = this.origin {
            // SAFETY: `origin` is a live RefString for the lifetime of `this`.
            URL::parse(unsafe { ref_string_slice(origin) })
        } else {
            URL::default()
        };
        bun_object::get_public_path_with_asset_prefix(
            this.route().file_path,
            if let Some(base_dir) = this.base_dir {
                // SAFETY: `base_dir` is a live RefString for the lifetime of `this`.
                unsafe { ref_string_slice(base_dir) }
            } else {
                // SAFETY: VM singleton is alive on the JS thread for the duration of this getter.
                unsafe { (*(*VirtualMachine::get()).transpiler.fs).top_level_dir }
            },
            &origin_url,
            if let Some(prefix) = this.asset_prefix {
                // SAFETY: `prefix` is a live RefString for the lifetime of `this`.
                unsafe { ref_string_slice(prefix) }
            } else {
                b""
            },
            &mut writer,
            path::Platform::Posix,
        );
        Ok(ZigString::init(writer.as_bytes())
            .with_encoding()
            .to_js(global_this))
    }

    // PORT NOTE: `host_fn(getter)` shim passes `&Self`, but this getter mutates
    // `param_map`; until the macro grows a `getter_mut` variant the shim is
    // omitted (codegen owns the actual link name).
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
            this.param_map = QueryStringMap::init_with_scanner(scanner)?;
        }

        Self::create_query_object(global_this, this.param_map.as_mut().unwrap())
    }

    // PORT NOTE: see `get_params` — `host_fn(getter)` omitted for `&mut Self`.
    pub fn get_query(this: &mut Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let route = this.route();
        if route.query_string.is_empty() && route.params.len() == 0 {
            return Ok(JSValue::create_empty_object(global_this, 0));
        } else if route.query_string.is_empty() {
            return Self::get_params(this, global_this);
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
                this.query_string_map = QueryStringMap::init_with_scanner(scanner)?;
            } else {
                this.query_string_map = QueryStringMap::init(route.query_string)?;
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

} // mod _jsc_gated

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/filesystem_router.zig (709 lines)
//   confidence: medium
//   todos:      15
//   notes:      Arena ownership + self-ref `route` ptr + scopeguard log-restore need Phase B borrowck work; RefString mapped to Arc per LIFETIMES.tsv but Zig uses intrusive ref/deref.
// ──────────────────────────────────────────────────────────────────────────
