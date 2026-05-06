//! `Bun.FileSystemRouter` / `MatchedRoute` — Next.js-style file router.

pub const DEFAULT_EXTENSIONS: &[&[u8]] = &[
    b"tsx", b"jsx", b"ts", b"mjs", b"cjs", b"js",
];

// Re-export the gated types so `BunObject.rs` can name them via
// `crate::api::filesystem_router::FileSystemRouter` (JsClass impl is on the
// `_jsc_gated` struct).
pub use _jsc_gated::FileSystemRouter;
pub use _jsc_gated::MatchedRoute;

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
use core::ffi::c_void;

use bun_alloc::Arena as ArenaAllocator;
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSObject, JSValue, JsClass, JsResult, LogJsc,
    StringJsc,
};
use bun_jsc::js_object::ObjectInitializer;
use bun_jsc::ref_string::RefString;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_str::{ZigString, ZigStringSlice};
use bun_logger as Log;
use bun_paths::{self as path, PathBuffer, MAX_PATH_BYTES};
use bun_str::strings;

use bun_http_types::URLPath;
use bun_resolver::fs as Fs;
use bun_router::{self as Router, Match as RouterMatch, RouteConfig};
use bun_url::{route_param, CombinedScanner, QueryStringMap, URL};

use crate::webcore::{Request, Response};
use crate::api::bun_object;
use bun_bundler as Transpiler;

const DEFAULT_EXTENSIONS: &[&[u8]] = &[
    b"tsx",
    b"jsx",
    b"ts",
    b"mjs",
    b"cjs",
    b"js",
];

// ── local shims ───────────────────────────────────────────────────────────
// `bun_str::ZigString` lacks `with_encoding`/`to_js` (those live on the
// `repr(C)`-identical `bun_jsc::zig_string::ZigString`). Route through the jsc
// struct for `to_js`; for `with_encoding` use `from_bytes` (auto-detects UTF-8).
#[inline]
fn zs_to_js(bytes: &[u8], global: &JSGlobalObject) -> JSValue {
    jsc::zig_string::ZigString::from_bytes(bytes).to_js(global)
}

#[inline]
unsafe fn ref_string_slice<'a>(r: *mut RefString) -> &'a [u8] {
    // SAFETY: caller guarantees `r` is live; `leak()` returns the borrowed bytes
    // without bumping refcount (matching Zig `RefString.leak`).
    unsafe { (*r).leak() }
}

// `js.routesSetCached` codegen accessor — emitted by the `.classes.ts`
// generator as `FileSystemRouterPrototype__routesSetCachedValue`. The
// `codegen_cached_accessors!` proc-macro wires the extern.
bun_jsc::codegen_cached_accessors!("FileSystemRouter"; routes);

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
        // SAFETY: `bun_vm()` returns the live VM raw pointer for this global.
        let vm = unsafe { &mut *global_this.bun_vm() };

        let mut root_dir_path: ZigStringSlice =
            // SAFETY: `vm.transpiler.fs` is the process-global FileSystem singleton.
            ZigStringSlice::from_utf8_never_free(unsafe { (*vm.transpiler.fs).top_level_dir });
        // `defer root_dir_path.deinit()` → Drop on ZigStringSlice
        let mut origin_str: ZigStringSlice = ZigStringSlice::default();
        let mut asset_prefix_slice: ZigStringSlice = ZigStringSlice::default();

        let mut out_buf = [0u8; MAX_PATH_BYTES * 2];
        if let Some(style_val) = argument.get(global_this, "style")? {
            if !(style_val.get_zig_string(global_this)?).eql_comptime("nextjs") {
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
            if !(root_dir_path_.slice().is_empty() || root_dir_path_.slice() == b".") {
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
        let mut arena = Box::new(ArenaAllocator::new());
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
                let bytes = val.to_slice(global_this)?.into_vec();
                let leaked: &'static [u8] = arena.alloc_slice_copy(&bytes);
                extensions.push(&leaked[1..]);
            }
        }

        if let Some(asset_prefix) = argument.get_truthy(global_this, "assetPrefix")? {
            if !asset_prefix.is_string() {
                return Err(global_this
                    .throw_invalid_arguments("Expected assetPrefix to be a string"));
            }

            // TODO(port): `clone_if_borrowed` not on `ZigStringSlice` — copy into arena.
            let s = asset_prefix.to_slice(global_this)?;
            let leaked: &'static [u8] = arena.alloc_slice_copy(s.slice());
            asset_prefix_slice = ZigStringSlice::from_utf8_never_free(leaked);
        }
        let mut log = Log::Log::new();
        // TODO(port): errdefer-style swap of `vm.transpiler.resolver.log` — `log` field is
        // `*mut logger::Log`; storing a stack-local `&mut log` across early returns is UB
        // without scopeguard. Deferred until ResolverLike/DirInfoRef integration lands.
        let _orig_log: *mut Log::Log = vm.transpiler.resolver.log;
        let _ = &_orig_log;

        // `clone_with_trailing_slash` — append '/' if missing.
        let path_to_use: Vec<u8> = {
            let s = root_dir_path.slice();
            if s.ends_with(b"/") {
                s.to_vec()
            } else {
                let mut v = Vec::with_capacity(s.len() + 1);
                v.extend_from_slice(s);
                v.push(b'/');
                v
            }
        };

        let root_dir_info = match vm.transpiler.resolver.read_dir_info(&path_to_use) {
            Ok(Some(info)) => info,
            Ok(None) => {
                return Err(global_this.throw(format_args!(
                    "Unable to find directory: {}",
                    bstr::BStr::new(root_dir_path.slice())
                )));
            }
            Err(_) => {
                let err_value = log.to_js(global_this, "reading root directory");
                return Err(global_this.throw_value(err_value?));
            }
        };

        let mut router = Router::Router::init(
            // PORT NOTE: `vm.transpiler.fs` is the concrete `bun_resolver::fs::FileSystem`;
            // `bun_router` takes the opaque `bun_sys::fs::FileSystem` handle (same singleton,
            // erased via the cyclebreak vtable).
            bun_sys::fs::FileSystem::instance(),
            RouteConfig {
                dir: Box::from(&path_to_use[..]),
                extensions: if !extensions.is_empty() {
                    extensions.iter().map(|s| Box::<[u8]>::from(*s)).collect()
                } else {
                    DEFAULT_EXTENSIONS.iter().map(|s| Box::<[u8]>::from(*s)).collect()
                },
                asset_prefix_path: Box::from(asset_prefix_slice.slice()),
                ..Default::default()
            },
        )
        .expect("unreachable");

        // TODO(port): `Router::load_routes` takes `bun_router::b1_stubs::logger::Log` (stub) +
        // `DirInfoRef` (vtable-erased) + `R: ResolverLike`, none of which `bun_logger::Log` /
        // `*mut DirInfo` / `Resolver<'a>` currently satisfy. Blocked on upstream wiring.
        let _ = (&mut log, root_dir_info);
        let _config_dir = router.config.dir.clone();
        if false {
            todo!("blocked_on: bun_router::ResolverLike for bun_resolver::Resolver + DirInfoRef vtable");
        }

        if let Some(origin) = argument.get(global_this, "origin")? {
            if !origin.is_string() {
                return Err(global_this.throw_invalid_arguments("Expected origin to be a string"));
            }
            origin_str = origin.to_slice(global_this)?;
        }

        if log.errors + log.warnings > 0 {
            let err_value = log.to_js(global_this, "loading routes");
            return Err(global_this.throw_value(err_value?));
        }

        // SAFETY: `root_dir_info` is a live `*mut DirInfo` returned by `read_dir_info`.
        let base_dir_str = unsafe {
            if !(*root_dir_info).abs_real_path.is_empty() {
                (*root_dir_info).abs_real_path
            } else {
                (*root_dir_info).abs_path
            }
        };

        let mut fs_router = Box::new(FileSystemRouter {
            origin: if !origin_str.slice().is_empty() {
                Some(vm.ref_counted_string::<true>(origin_str.slice(), None) as *mut RefString)
            } else {
                None
            },
            base_dir: Some(vm.ref_counted_string::<true>(base_dir_str, None) as *mut RefString),
            asset_prefix: if !asset_prefix_slice.slice().is_empty() {
                Some(
                    vm.ref_counted_string::<true>(asset_prefix_slice.slice(), None)
                        as *mut RefString,
                )
            } else {
                None
            },
            router,
            arena,
        });

        // PORT NOTE: `base_dir.?.ref()` — Zig borrowed the RefString bytes into
        // `router.config.dir` and bumped the refcount. RouteConfig::dir is now an owned
        // `Box<[u8]>`, so copy the bytes; no extra ref needed.
        // SAFETY: `base_dir` was just set to Some above.
        fs_router.router.config.dir =
            Box::from(unsafe { ref_string_slice(fs_router.base_dir.unwrap()) });

        Ok(fs_router)
    }

    pub fn bust_dir_cache_recursive(&mut self, global_this: &JSGlobalObject, input_path: &[u8]) {
        // SAFETY: `bun_vm()` returns the live VM raw pointer for this global.
        let vm = unsafe { &mut *global_this.bun_vm() };
        let path = input_path;
        #[cfg(windows)]
        let _ = path; // TODO(port): win32 normalize_buf via thread-local

        let root_dir_info = match vm.transpiler.resolver.read_dir_info(path) {
            Ok(v) => v,
            Err(_) => return,
        };

        if let Some(_dir) = root_dir_info {
            // TODO(port): `DirInfo::get_entries_const()` + `EntryMap` iteration —
            // upstream `bun_resolver::DirInfo` does not expose a stable iterator
            // surface yet; the recursive walk is deferred.
            todo!("blocked_on: bun_resolver::DirInfo::get_entries_const iteration");
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
        // SAFETY: `bun_vm()` returns the live VM raw pointer for this global.
        let vm = unsafe { &mut *global_this.bun_vm() };

        let mut log = Log::Log::new();
        // TODO(port): errdefer-style swap of `vm.transpiler.resolver.log`; see constructor note.
        let _orig_log: *mut Log::Log = vm.transpiler.resolver.log;
        let _ = &_orig_log;

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
                let err_value = log.to_js(global_this, "reading root directory");
                return Err(global_this.throw_value(err_value?));
            }
        };

        let router = Router::Router::init(
            // PORT NOTE: see constructor — `bun_router` takes the opaque `bun_sys::fs` handle.
            bun_sys::fs::FileSystem::instance(),
            RouteConfig {
                dir: this.router.config.dir.clone(),
                extensions: this.router.config.extensions.clone(),
                asset_prefix_path: this.router.config.asset_prefix_path.clone(),
                ..Default::default()
            },
        )
        .expect("unreachable");
        // TODO(port): `Router::load_routes` — see constructor note.
        let _ = (&mut log, root_dir_info);
        if false {
            todo!("blocked_on: bun_router::ResolverLike for bun_resolver::Resolver + DirInfoRef vtable");
        }

        // `this.router.deinit(); this.arena.deinit(); destroy(this.arena)` — drop old values.
        // PORT NOTE: order matters — old router borrows slices from old arena, so it must drop
        // first (matches Zig teardown order).
        this.router = router;
        this.arena = arena;
        // `js.routesSetCached` — wired via `codegen_cached_accessors!` above.
        routes_set_cached(this_value, global_this, JSValue::ZERO);
        Ok(this_value)
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
                // TODO(port): `clone_if_borrowed` not on `ZigStringSlice`; force-own via into_vec.
                break 'brk ZigStringSlice::init_owned(
                    argument.to_slice(global_this)?.into_vec(),
                );
            }

            if argument.is_cell() {
                if let Some(req) = argument.as_::<Request>() {
                    // SAFETY: `as_` returns a live `*mut Request` for `argument`'s lifetime.
                    unsafe { (*req).ensure_url().expect("unreachable") };
                    break 'brk unsafe { (*req).url.to_utf8() };
                }

                if let Some(resp) = argument.as_::<Response>() {
                    // SAFETY: `as_` returns a live `*mut Response` for `argument`'s lifetime.
                    break 'brk unsafe { (*resp).get_utf8_url() };
                }
            }

            return Err(global_this.throw_invalid_arguments("Expected string, Request or Response"));
        };

        if path.slice().is_empty() || (path.slice().len() == 1 && path.slice()[0] == b'/') {
            path = ZigStringSlice::from_utf8_never_free(b"/");
        }

        if strings::has_prefix(path.slice(), b"http://")
            || strings::has_prefix(path.slice(), b"https://")
            || strings::has_prefix(path.slice(), b"file://")
        {
            let prev_path = path;
            path = ZigStringSlice::init_dupe(URL::parse(prev_path.slice()).pathname)
                .expect("oom");
        }

        let url_path = match URLPath::parse(path.slice()) {
            Ok(v) => v,
            Err(err) => {
                return Err(global_this.throw(format_args!(
                    "{:?} parsing path: {}",
                    err,
                    bstr::BStr::new(path.slice())
                )));
            }
        };
        let mut params = route_param::List::default();
        // `defer params.deinit(allocator)` → Drop
        let Some(route) = this.router.routes.match_page_with_allocator(
            b"",
            &url_path,
            &mut params,
        ) else {
            return Ok(JSValue::NULL);
        };

        // SAFETY: `Match<'p>` borrows `params` and `path` bytes. `MatchedRoute::init` clones
        // `params` into `params_list_holder` and re-points `route_holder.params` at the heap
        // copy; `path` is `mem::forget`ed below (intentional leak per Zig spec). Forging
        // `'static` matches the Zig raw-slice semantics (no borrow escapes the stack `params`).
        let route: RouterMatch<'static> =
            unsafe { core::mem::transmute::<RouterMatch<'_>, RouterMatch<'static>>(route) };

        let result = MatchedRoute::init(
            route,
            this.origin,
            this.asset_prefix,
            this.base_dir.unwrap(),
        )
        .expect("unreachable");

        // TODO: Memory leak? See PORT NOTE in Zig spec — `path` intentionally leaked here.
        core::mem::forget(path);
        Ok(result.to_js(global_this))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_origin(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        if let Some(origin) = this.origin {
            // SAFETY: `origin` is a live `*mut RefString` (set in constructor, freed in finalize).
            return Ok(zs_to_js(unsafe { ref_string_slice(origin) }, global_this));
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
            name_strings_slice[i] = ZigString::from_bytes(name);
            paths_strings[i] = ZigString::from_bytes(paths[i]);
        }
        // TODO(port): `JSValue::from_entries` not yet exposed in `bun_jsc::JSValue`.
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
            // SAFETY: `asset_prefix` is a live `*mut RefString`.
            return Ok(zs_to_js(unsafe { ref_string_slice(asset_prefix) }, global_this));
        }

        Ok(JSValue::NULL)
    }

    pub fn finalize(this: *mut FileSystemRouter) {
        // SAFETY: called by JSC finalizer on the mutator thread; `this` is the m_ctx payload.
        let this_ref = unsafe { &mut *this };
        // PORT NOTE: RefString deref()s — Zig `?.deref()` on each.
        if let Some(p) = this_ref.asset_prefix.take() {
            // SAFETY: `p` is live until this deref.
            unsafe { (*p).deref() };
        }
        if let Some(p) = this_ref.origin.take() {
            unsafe { (*p).deref() };
        }
        if let Some(p) = this_ref.base_dir.take() {
            unsafe { (*p).deref() };
        }
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
    pub params_list_holder: route_param::List<'static>,
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
        Ok(zs_to_js(this.route().name, global_this))
    }

    pub fn init(
        match_: RouterMatch<'static>,
        origin: Option<*mut RefString>,
        asset_prefix: Option<*mut RefString>,
        base_dir: *mut RefString,
    ) -> Result<Box<MatchedRoute>, bun_alloc::AllocError> {
        let params_list = match_.params.clone();

        let mut route = Box::new(MatchedRoute {
            route_holder: match_,
            route: core::ptr::null(),
            asset_prefix,
            origin,
            base_dir: Some(base_dir),
            query_string_map: None,
            param_map: None,
            params_list_holder: route_param::List::default(),
            needs_deinit: true,
        });
        // PORT NOTE: `base_dir.ref()` / `o.ref()` / `prefix.ref()` — bump refcounts.
        // SAFETY: each pointer is a live `*mut RefString` (caller-provided).
        unsafe { (*base_dir).ref_() };
        if let Some(o) = origin {
            unsafe { (*o).ref_() };
        }
        if let Some(p) = asset_prefix {
            unsafe { (*p).ref_() };
        }
        route.params_list_holder = params_list;
        route.route = &route.route_holder as *const RouterMatch<'static>;
        // SAFETY: `params_list_holder` lives at a stable heap address inside the Box for the
        // lifetime of `MatchedRoute`; forging `&'static mut` matches the Zig raw-slice semantics.
        route.route_holder.params =
            unsafe { &mut *(&mut route.params_list_holder as *mut route_param::List<'static>) };

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
                unsafe { bun_alloc::mimalloc::mi_free(pathname.as_ptr() as *mut c_void) };
            }

            this_ref.params_list_holder = route_param::List::default();
        }

        if let Some(p) = this_ref.origin.take() {
            unsafe { (*p).deref() };
        }
        if let Some(p) = this_ref.asset_prefix.take() {
            unsafe { (*p).deref() };
        }
        if let Some(p) = this_ref.base_dir.take() {
            unsafe { (*p).deref() };
        }

        // SAFETY: `this` was Box::into_raw'd by codegen at construction.
        drop(unsafe { Box::from_raw(this) });
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_file_path(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(zs_to_js(this.route().file_path, global_this))
    }

    pub fn finalize(this: *mut MatchedRoute) {
        Self::deinit(this);
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_pathname(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(zs_to_js(this.route().pathname, global_this))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_route(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(zs_to_js(this.route().name, global_this))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_kind(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(zs_to_js(kind_enum::classify(this.route().name), global_this))
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
                            let mut str = ZigString::from_bytes(entry_name);

                            debug_assert!(!entry.values.is_empty());
                            if entry.values.len() > 1 {
                                let values = &mut refs_buf[0..entry.values.len()];
                                for (i, value) in entry.values.iter().enumerate() {
                                    values[i] = ZigString::from_bytes(value);
                                }
                                obj.put_record(global, &mut str, values)?;
                            } else {
                                refs_buf[0] = ZigString::from_bytes(entry.values[0]);
                                obj.put_record(global, &mut str, &mut refs_buf[0..1])?;
                            }
                        }
                        Ok(())
                    })
                })
            }
        }

        let count = map.get_name_count();
        let mut creator = QueryObjectCreator { query: map };

        let value = JSObject::create_with_initializer(&mut creator, ctx, count);

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
            // SAFETY: `generate_entry_point_path` only copies `dir`/`base`/`ext` bytes into
            // `entry_point_tempbuf`; the forged `'static` PathName never escapes this call.
            let path_name = bun_logger::fs::PathName::init(unsafe {
                core::mem::transmute::<&[u8], &'static [u8]>(file_path)
            });
            bun_object::get_public_path_with_asset_prefix(
                Transpiler::entry_points::ClientEntryPoint::generate_entry_point_path(
                    &mut entry_point_tempbuf,
                    &path_name,
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
        // into a `String` (path components are UTF-8 in practice).
        let mut writer = String::with_capacity(MAX_PATH_BYTES);
        let origin_url = if let Some(origin) = this.origin {
            // SAFETY: `origin` is a live `*mut RefString`.
            URL::parse(unsafe { ref_string_slice(origin) })
        } else {
            URL::default()
        };
        bun_object::get_public_path_with_asset_prefix(
            this.route().file_path,
            if let Some(base_dir) = this.base_dir {
                // SAFETY: `base_dir` is a live `*mut RefString`.
                unsafe { ref_string_slice(base_dir) }
            } else {
                // SAFETY: VM singleton is alive on the JS thread for the duration of this getter.
                unsafe { (*(*VirtualMachine::get()).transpiler.fs).top_level_dir }
            },
            &origin_url,
            if let Some(prefix) = this.asset_prefix {
                // SAFETY: `prefix` is a live `*mut RefString`.
                unsafe { ref_string_slice(prefix) }
            } else {
                b""
            },
            &mut writer,
            path::Platform::Posix,
        );
        Ok(zs_to_js(writer.as_bytes(), global_this))
    }

    // PORT NOTE: `host_fn(getter)` macro emits a shim that passes `&Self`, but this needs
    // `&mut Self` to lazily build `param_map`. The real shim is owned by the `.classes.ts`
    // codegen (which gets the m_ctx as `*mut`), so the placeholder shim is omitted here.
    pub fn get_params(this: &mut Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        if this.route().params.is_empty() {
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

    // PORT NOTE: see `get_params` — `host_fn(getter)` shim omitted (needs `&mut Self`).
    pub fn get_query(this: &mut Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let route = this.route();
        if route.query_string.is_empty() && route.params.is_empty() {
            return Ok(JSValue::create_empty_object(global_this, 0));
        } else if route.query_string.is_empty() {
            return Self::get_params(this, global_this);
        }

        if this.query_string_map.is_none() {
            let route = this.route();
            if !route.params.is_empty() {
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
    pub use crate::api::filesystem_router::kind_enum::classify;
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
        const { RefCell::new([ZigString::EMPTY; 256]) };
}

} // mod _jsc_gated

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/filesystem_router.zig (709 lines)
//   confidence: medium
//   todos:      15
//   notes:      Arena ownership + self-ref `route` ptr need Phase B borrowck work; load_routes blocked on ResolverLike/DirInfoRef wiring; RefString held as *mut.
// ──────────────────────────────────────────────────────────────────────────
