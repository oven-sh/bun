//! `Bun.FileSystemRouter` / `MatchedRoute` — Next.js-style file router.

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

use core::cell::UnsafeCell;

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
use bun_resolver::Resolver;
use bun_router::{self as Router, Match as RouterMatch, RouteConfig};
use bun_url::{route_param, CombinedScanner, QueryStringMap, URL};

use crate::webcore::{Request, Response};
use crate::api::bun_object;
use bun_bundler as Transpiler;

// PORT NOTE: `FrameworkFileSystemRouter` is declared in this file's
// `filesystem_router.classes.ts`, so codegen looks for the backing struct here
// (`crate::api::filesystem_router::FrameworkFileSystemRouter`). In Zig the
// implementation lives in `bake/FrameworkRouter.zig` as `JSFrameworkRouter` and
// is wired via `generated_classes_list.zig`. Re-export the real type so the
// codegen-generated thunks resolve without a stub.
pub use crate::bake::framework_router::JSFrameworkRouter as FrameworkFileSystemRouter;

pub const DEFAULT_EXTENSIONS: &[&[u8]] = &[
    b"tsx", b"jsx", b"ts", b"mjs", b"cjs", b"js",
];

// ── local shims ───────────────────────────────────────────────────────────
// `bun_str::ZigString` lacks `with_encoding`/`to_js` (those live on the
// `repr(C)`-identical `bun_jsc::zig_string::ZigString`). Route through the jsc
// struct for `to_js`; for `with_encoding` use `from_bytes` (auto-detects UTF-8).
#[inline]
fn zs_to_js(bytes: &[u8], global: &JSGlobalObject) -> JSValue {
    jsc::zig_string::ZigString::from_bytes(bytes).to_js(global)
}

// ── ResolverLike bridge ───────────────────────────────────────────────────
// `bun_router::ResolverLike` is the duck-typed seam for `Router::load_routes`;
// `bun_resolver::Resolver` is the concrete impl. The orphan-rule-compliant
// impl lives here in `bun_runtime` (the runtime sees both). `DirInfoRef`
// erases `*const bun_resolver::DirInfo` so the router stays generic.

static RESOLVER_DIR_INFO_VTABLE: Router::DirInfoVTable = Router::DirInfoVTable {
    get_entries_const: |owner| {
        // SAFETY: `owner` is an erased `*const bun_resolver::DirInfo` produced by
        // `dir_info_ref` below; the resolver's BSSMap singleton outlives the walk.
        let di = unsafe { &*owner.cast::<bun_resolver::DirInfo>() };
        di.get_entries_const().map(|e| std::ptr::from_ref::<Fs::DirEntry>(e))
    },
};

#[inline]
fn dir_info_ref(di: *const bun_resolver::DirInfo) -> Router::DirInfoRef {
    Router::DirInfoRef { owner: di.cast::<()>(), vtable: &RESOLVER_DIR_INFO_VTABLE }
}

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
    fn read_dir_info_ignore_error(&mut self, path: &[u8]) -> Option<Router::DirInfoRef> {
        self.0.read_dir_info_ignore_error(path).map(dir_info_ref)
    }
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
    // PORT NOTE: dropped `std.mem.Allocator param` field — it was always `arena.arena()`.
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
            return Err(global_this.throw_invalid_arguments(format_args!("Expected object")));
        }

        let argument = argument_.ptr[0];
        if argument.is_empty_or_undefined_or_null() || !argument.is_object() {
            return Err(global_this.throw_invalid_arguments(format_args!("Expected object")));
        }
        // SAFETY: `bun_vm()` returns the live VM raw pointer for this global.
        let vm_ptr = global_this.bun_vm_ptr();
        let vm = unsafe { &mut *vm_ptr };

        let mut root_dir_path: ZigStringSlice =
            // SAFETY: `vm.transpiler.fs` is the process-global FileSystem singleton.
            ZigStringSlice::from_utf8_never_free(unsafe { (*vm.transpiler.fs).top_level_dir });
        // `defer root_dir_path.deinit()` → Drop on ZigStringSlice
        let mut origin_str: ZigStringSlice = ZigStringSlice::default();
        let mut asset_prefix_slice: ZigStringSlice = ZigStringSlice::default();

        let mut out_buf = [0u8; MAX_PATH_BYTES * 2];
        if let Some(style_val) = argument.get(global_this, "style")? {
            if !(style_val.get_zig_string(global_this)?).eql_comptime("nextjs") {
                return Err(global_this.throw_invalid_arguments(format_args!(
                    "Only 'nextjs' style is currently implemented"
                )));
            }
        } else {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "Expected 'style' option (ex: \"style\": \"nextjs\")"
            )));
        }

        if let Some(dir) = argument.get(global_this, "dir")? {
            if !dir.is_string() {
                return Err(
                    global_this.throw_invalid_arguments(format_args!("Expected dir to be a string"))
                );
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
            return Err(
                global_this.throw_invalid_arguments(format_args!("Expected dir to be a string"))
            );
        }
        // PERF(port): was arena bulk-free — extensions/asset_prefix/log all allocated from this.
        let mut arena = Box::new(ArenaAllocator::new());
        let mut extensions: Vec<&[u8]> = Vec::new();
        if let Some(file_extensions) = argument.get(global_this, "fileExtensions")? {
            if !file_extensions.js_type().is_array() {
                return Err(global_this.throw_invalid_arguments(format_args!(
                    "Expected fileExtensions to be an Array"
                )));
            }

            let mut iter = file_extensions.array_iterator(global_this)?;
            extensions.reserve_exact(iter.len as usize);
            while let Some(val) = iter.next()? {
                if !val.is_string() {
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "Expected fileExtensions to be an Array of strings"
                    )));
                }
                if val.get_length(global_this)? == 0 {
                    continue;
                }
                // PERF(port): was appendAssumeCapacity
                // TODO(port): `toUTF8Bytes(allocator)[1..]` — slices off leading '.'; arena owns the bytes.
                let bytes = val.to_slice(global_this)?.into_vec();
                // SAFETY: arena is boxed and moved into the returned `FileSystemRouter`, so the
                // backing allocation outlives this slice. Cast through raw ptr to detach the
                // borrow from `arena` so it can be moved below.
                let leaked: &'static [u8] =
                    unsafe { bun_ptr::detach_lifetime(arena.alloc_slice_copy(&bytes)) };
                extensions.push(&leaked[1..]);
            }
        }

        if let Some(asset_prefix) = argument.get_truthy(global_this, "assetPrefix")? {
            if !asset_prefix.is_string() {
                return Err(global_this.throw_invalid_arguments(format_args!(
                    "Expected assetPrefix to be a string"
                )));
            }

            // TODO(port): `clone_if_borrowed` not on `ZigStringSlice` — copy into arena.
            let s = asset_prefix.to_slice(global_this)?;
            // SAFETY: arena is boxed and moved into the returned `FileSystemRouter`; allocation
            // outlives this slice. Detach borrow via raw ptr so `arena` can be moved below.
            let leaked: &'static [u8] =
                unsafe { bun_ptr::detach_lifetime(arena.alloc_slice_copy(s.slice())) };
            asset_prefix_slice = ZigStringSlice::from_utf8_never_free(leaked);
        }
        let mut log = Log::Log::new();
        // `defer vm.transpiler.resolver.log = orig_log` — RAII guard restores on
        // every exit path. Derived from `vm_ptr` (raw) via `addr_of_mut!` so the
        // stored slot pointer stays valid under Stacked Borrows across the
        // `&mut vm.transpiler.resolver` reborrows below.
        // SAFETY: `vm_ptr` is the live VM for this global; resolver outlives this
        // scope. Guard is declared after `log` so it drops (and restores) first.
        let _restore_log = unsafe {
            Resolver::scoped_log(
                core::ptr::addr_of_mut!((*vm_ptr).transpiler.resolver),
                &raw mut log,
            )
        };

        // `cloneWithTrailingSlash` → `strings.cloneNormalizingSeparators`: collapse duplicate
        // separators and append the PLATFORM-NATIVE separator (`\` on Windows).
        let path_to_use: Vec<u8> =
            strings::paths::clone_normalizing_separators(root_dir_path.slice());

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
            // PORT NOTE: `vm.transpiler.fs` — the resolver's `FileSystem` singleton.
            Fs::FileSystem::instance(),
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

        {
            let config_dir = router.config.dir.clone();
            if router
                .load_routes(
                    &mut log,
                    dir_info_ref(root_dir_info),
                    &mut RouterResolver(&mut vm.transpiler.resolver),
                    &config_dir,
                )
                .is_err()
            {
                let err_value = log.to_js(global_this, "loading routes");
                return Err(global_this.throw_value(err_value?));
            }
        }

        if let Some(origin) = argument.get(global_this, "origin")? {
            if !origin.is_string() {
                return Err(global_this.throw_invalid_arguments(format_args!(
                    "Expected origin to be a string"
                )));
            }
            origin_str = origin.to_slice(global_this)?;
        }

        if log.errors + log.warnings > 0 {
            let err_value = log.to_js(global_this, "loading routes");
            return Err(global_this.throw_value(err_value?));
        }

        // SAFETY: `root_dir_info` is a live `*mut DirInfo` returned by `read_dir_info`.
        let base_dir_str = unsafe {
            if !(&(*root_dir_info).abs_real_path).is_empty() {
                (*root_dir_info).abs_real_path
            } else {
                (*root_dir_info).abs_path
            }
        };

        // PORT NOTE: `vm.refCountedString` is an interning cache — on a cache HIT it
        // returns the existing `*mut RefString` WITHOUT bumping the refcount. The Zig
        // spec gets away with this because `getScriptSrc`/`getOrigin` call `.slice()`
        // (which leaks +1 each access) so the impl never reaches 0. The Rust port uses
        // `.leak()` (no ref) there, which exposed the latent imbalance: N routers
        // sharing one interned RefString → N finalizers deref a single +1 → UAF on the
        // second deref. Claim an explicit +1 here so each `FileSystemRouter` owns its
        // hold; `finalize` releases it. (Mirrors Zig's `fs_router.base_dir.?.ref()`.)
        let claim = |p: *mut RefString| -> *mut RefString {
            // SAFETY: `ref_counted_string` returns a live interned `*mut RefString`.
            unsafe { (*p).ref_() };
            p
        };
        let mut fs_router = Box::new(FileSystemRouter {
            origin: if !origin_str.slice().is_empty() {
                Some(claim(vm.ref_counted_string::<true>(origin_str.slice(), None)))
            } else {
                None
            },
            base_dir: Some(claim(vm.ref_counted_string::<true>(base_dir_str, None))),
            asset_prefix: if !asset_prefix_slice.slice().is_empty() {
                Some(claim(vm.ref_counted_string::<true>(asset_prefix_slice.slice(), None)))
            } else {
                None
            },
            router,
            arena,
        });

        // PORT NOTE: `base_dir.?.ref()` — Zig borrowed the RefString bytes into
        // `router.config.dir` and bumped the refcount. RouteConfig::dir is now an owned
        // `Box<[u8]>`, so copy the bytes; the `claim` above already took our +1.
        // SAFETY: `base_dir` was just set to Some above.
        fs_router.router.config.dir =
            Box::from(unsafe { (*fs_router.base_dir.unwrap()).leak() });

        Ok(fs_router)
    }

    pub fn bust_dir_cache_recursive(&mut self, global_this: &JSGlobalObject, input_path: &[u8]) {
        // SAFETY: `bun_vm()` returns the live VM raw pointer for this global. Re-derive the
        // `&mut` per use site so the recursive call (which does the same) doesn't pop our
        // SB tag mid-loop.
        let vm_ptr = global_this.bun_vm_ptr();
        #[allow(unused_mut)]
        let mut path = input_path;
        #[cfg(windows)]
        let normalized: Vec<u8>;
        #[cfg(windows)]
        {
            // PORT NOTE: Zig used a `ThreadlocalBuffers` slot. `with_borrow_mut` can't
            // hand back a slice that outlives the closure, so copy out (cold reload path).
            normalized = WIN32_NORMALIZE_BUF.with_borrow_mut(|buf| {
                // SAFETY: `vm_ptr` is live; `transpiler.fs` is the FileSystem singleton.
                unsafe { &*(*vm_ptr).transpiler.fs }
                    .normalize_buf(&mut buf[..], input_path)
                    .to_vec()
            });
            path = normalized.as_slice();
        }

        let root_dir_info =
            match unsafe { &mut *vm_ptr }.transpiler.resolver.read_dir_info(path) {
                Ok(v) => v,
                Err(_) => return,
            };

        if let Some(dir) = root_dir_info {
            // SAFETY: `dir` points into the resolver's BSSMap singleton; valid until
            // `bust_dir_cache(path)` for THIS path runs (after the loop).
            let dir_ref = unsafe { &*dir };
            if let Some(entries) = dir_ref.get_entries_const() {
                'outer: for &entry_ptr in entries.data.values() {
                    // SAFETY: `entry_ptr` is a `*mut Entry` into the process-static
                    // EntryStore; no other live `&mut` to it in this scope.
                    let base = unsafe { &*entry_ptr }.base();
                    if base.first() == Some(&b'.') {
                        continue 'outer;
                    }
                    // SAFETY: `transpiler.fs` is the FileSystem singleton; `&mut .fs`
                    // (the `Implementation` field) is the lazy-stat receiver.
                    let kind = {
                        let fs_impl = unsafe { &mut (*(*vm_ptr).transpiler.fs).fs };
                        unsafe { &mut *entry_ptr }.kind(fs_impl, false)
                    };
                    if kind == Fs::EntryKind::Dir {
                        for banned_dir in Router::BANNED_DIRS.iter() {
                            if unsafe { &*entry_ptr }.base() == *banned_dir {
                                continue 'outer;
                            }
                        }
                        let entry = unsafe { &*entry_ptr };
                        let abs_parts: [&[u8]; 2] = [entry.dir, entry.base()];
                        // SAFETY: see above. `abs()` writes into a thread-local buffer;
                        // copy out before recursing (recursion overwrites it).
                        let full_path =
                            unsafe { &*(*vm_ptr).transpiler.fs }.abs(&abs_parts).to_vec();
                        let _ = unsafe { &mut *vm_ptr }
                            .transpiler
                            .resolver
                            .bust_dir_cache(strings::paths::without_trailing_slash_windows_path(
                                &full_path,
                            ));
                        self.bust_dir_cache_recursive(global_this, &full_path);
                    }
                }
            }
        }

        let _ = unsafe { &mut *vm_ptr }.transpiler.resolver.bust_dir_cache(path);
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
        let vm_ptr = global_this.bun_vm_ptr();

        let mut log = Log::Log::new();
        // SAFETY: `vm_ptr` is the live VM for this global; resolver outlives this
        // scope. Guard declared after `log` so it drops (and restores) first.
        let _restore_log = unsafe {
            Resolver::scoped_log(
                core::ptr::addr_of_mut!((*vm_ptr).transpiler.resolver),
                &raw mut log,
            )
        };

        this.bust_dir_cache(global_this);
        // PORT NOTE: `bust_dir_cache` re-derives `&mut *vm_ptr` internally; rebind here so
        // our `vm` borrow is fresh under Stacked Borrows.
        let vm = unsafe { &mut *vm_ptr };

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

        let mut router = Router::Router::init(
            Fs::FileSystem::instance(),
            RouteConfig {
                dir: this.router.config.dir.clone(),
                extensions: this.router.config.extensions.clone(),
                asset_prefix_path: this.router.config.asset_prefix_path.clone(),
                ..Default::default()
            },
        )
        .expect("unreachable");
        {
            let config_dir = router.config.dir.clone();
            if router
                .load_routes(
                    &mut log,
                    dir_info_ref(root_dir_info),
                    &mut RouterResolver(&mut vm.transpiler.resolver),
                    &config_dir,
                )
                .is_err()
            {
                let err_value = log.to_js(global_this, "loading routes");
                return Err(global_this.throw_value(err_value?));
            }
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
            return Err(global_this.throw_invalid_arguments(format_args!(
                "Expected string, Request or Response"
            )));
        }

        let argument = argument_.ptr[0];
        if argument.is_empty_or_undefined_or_null() || !argument.is_cell() {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "Expected string, Request or Response"
            )));
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

            return Err(global_this.throw_invalid_arguments(format_args!(
                "Expected string, Request or Response"
            )));
        };

        if path.slice().is_empty() || (path.slice().len() == 1 && path.slice()[0] == b'/') {
            path = ZigStringSlice::from_utf8_never_free(b"/");
        }

        if strings::has_prefix(path.slice(), b"http://")
            || strings::has_prefix(path.slice(), b"https://")
            || strings::has_prefix(path.slice(), b"file://")
        {
            let prev_path = path;
            path = match ZigStringSlice::init_dupe(URL::parse(prev_path.slice()).pathname) {
                Ok(p) => p,
                Err(_) => return Err(global_this.throw_out_of_memory()),
            };
        }

        // SAFETY (self-ref construction prelude): `route` below borrows these bytes via
        // `URLPath`, and `path` is then MOVED into the same `MatchedRoute` Box that stores
        // `route`. Borrowck can't see that the allocation travels with the borrow, so we
        // detach the slice from `path`'s ownership here. The bytes stay valid: `path` is
        // never dropped on any path between here and `MatchedRoute::init` taking ownership
        // (early returns above this point already dropped/replaced `path`).
        let path_bytes: &[u8] = unsafe {
            core::slice::from_raw_parts(path.slice().as_ptr(), path.slice().len())
        };
        let url_path = match URLPath::parse(path_bytes) {
            Ok(v) => v,
            Err(err) => {
                return Err(global_this.throw(format_args!(
                    "{} parsing path: {}",
                    err.name(),
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

        // PORT NOTE: Zig leaked `path` here (TODO comment in spec) and pointer-freed it
        // in `MatchedRoute.deinit` via `mi_free(pathname.ptr)`. We instead MOVE `path`
        // into `MatchedRoute` so the bytes that `route.pathname`/`query_string`/param
        // values borrow are owned by the same heap-stable Box and freed on finalize.
        let result = MatchedRoute::init(
            route,
            path,
            this.origin,
            this.asset_prefix,
            this.base_dir.unwrap(),
        )
        .expect("unreachable");

        // PORT NOTE: `result` is a self-referential `Box<MatchedRoute>` (`route` points
        // at `route_holder` inside this very allocation). The trait `JsClass::to_js(self)`
        // would deref-move the value OUT of the Box and re-box it at a new address,
        // leaving the self-ref pointers dangling (ASAN use-after-poison). Hand the
        // existing allocation straight to the C++ wrapper instead — matches Zig's
        // `result.toJS(globalThis)` which forwards the `*MatchedRoute` as-is.
        // Ownership transfers to the GC wrapper (freed via
        // `MatchedRouteClass__finalize`); the leak lives once in `to_js_boxed`.
        Ok(MatchedRoute::to_js_boxed(result, global_this))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_origin(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        if let Some(origin) = this.origin {
            // SAFETY: `origin` is a live `*mut RefString` (set in constructor, freed in finalize).
            return Ok(zs_to_js(unsafe { (*origin).leak() }, global_this));
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
        Ok(JSValue::from_entries(
            global_this,
            name_strings_slice,
            paths_strings,
            true,
        ))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_style(_this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        bun_str::String::static_("nextjs").to_js(global_this)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_asset_prefix(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        if let Some(asset_prefix) = this.asset_prefix {
            // SAFETY: `asset_prefix` is a live `*mut RefString`.
            return Ok(zs_to_js(unsafe { (*asset_prefix).leak() }, global_this));
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
        // SAFETY: codegen guarantees `this` was heap-allocated in constructor.
        drop(unsafe { bun_core::heap::take(this) });
    }
}

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct MatchedRoute {
    /// Self-referential: always points at `self.route_holder`. See `init`.
    // PORT NOTE: `Match<'a>` borrows (a) the resolver's process-lifetime DirnameStore for
    // `name`/`file_path`/`basename`/`path` and (b) `self.pathname_backing` for
    // `pathname`/`query_string`/param values. Both are stable for `Self`'s lifetime, so
    // the stored `'static` is the standard self-referential erasure — see `init`.
    pub route: *const RouterMatch<'static>,
    // PORT NOTE: `route_holder`/`params_list_holder` are wrapped in `UnsafeCell` because
    // `route` (above) and `route_holder.params` hold raw self-referential pointers into
    // them. Without `UnsafeCell`, taking `&mut MatchedRoute` (as `get_params`/`get_query`
    // do) would assert unique access to these fields under Stacked Borrows and invalidate
    // the stored pointers — UB on next deref.
    pub route_holder: UnsafeCell<RouterMatch<'static>>,
    pub query_string_map: Option<QueryStringMap>,
    pub param_map: Option<QueryStringMap>,
    pub params_list_holder: UnsafeCell<route_param::List<'static>>,
    /// Owns the bytes that `route_holder.pathname`/`query_string` and the param values in
    /// `params_list_holder` borrow. Replaces the Zig leak-then-`mi_free(pathname.ptr)`
    /// pattern with proper ownership; freed by Drop on finalize.
    pub pathname_backing: ZigStringSlice,
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
        // SAFETY: `self.route` always points at `self.route_holder` (UnsafeCell, set in
        // `init`); the Box is never moved after construction (heap-stable), and no `&mut`
        // to `route_holder`'s contents is live concurrently with this read.
        unsafe { &*self.route }
    }

    #[inline]
    fn params(&self) -> &route_param::List<'static> {
        // SAFETY: `route().params` always points at `self.params_list_holder` (UnsafeCell,
        // set in `init`); heap-stable Box, no concurrent `&mut` to its contents.
        unsafe { &*self.route().params }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_name(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(zs_to_js(this.route().name, global_this))
    }

    pub fn init(
        match_: RouterMatch<'_>,
        pathname_backing: ZigStringSlice,
        origin: Option<*mut RefString>,
        asset_prefix: Option<*mut RefString>,
        base_dir: *mut RefString,
    ) -> Result<Box<MatchedRoute>, bun_alloc::AllocError> {
        // SAFETY: `match_.params` points at the caller's stack `route_param::List`, which is
        // live for this call. Clone its contents into our own holder before re-pointing.
        let params_list = unsafe { (*match_.params).clone() };

        // SAFETY (self-referential lifetime erasure): `RouterMatch<'_>` borrows two
        // backing stores —
        //   (a) `name`/`file_path`/`basename`/`path` slice the resolver's DirnameStore
        //       (process-lifetime arena, see `bun_router::PathString::slice`), so are
        //       genuinely `'static`;
        //   (b) `pathname`/`query_string` and the param `value`s slice `pathname_backing`,
        //       which we move into the same heap-stable Box below. The Box is never moved
        //       after construction (JsClass m_ctx payload), so those bytes are valid for
        //       `Self`'s lifetime.
        // `params` is a raw `*mut`; re-pointed at `params_list_holder` below before any
        // read through it. This is the standard Rust self-referential pattern (no
        // `Pin`/ouroboros because JsClass codegen owns the Box<Self>); it does NOT extend
        // a borrow past its allocation — ownership was transferred, not leaked.
        let match_static: RouterMatch<'static> =
            unsafe { core::mem::transmute::<RouterMatch<'_>, RouterMatch<'static>>(match_) };
        let params_list: route_param::List<'static> = unsafe {
            core::mem::transmute::<route_param::List<'_>, route_param::List<'static>>(params_list)
        };

        let mut route = Box::new(MatchedRoute {
            route_holder: UnsafeCell::new(match_static),
            route: core::ptr::null(),
            asset_prefix,
            origin,
            base_dir: Some(base_dir),
            query_string_map: None,
            param_map: None,
            params_list_holder: UnsafeCell::new(params_list),
            pathname_backing,
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
        // Self-referential wiring: `route` → `route_holder`; `route_holder.params` →
        // `params_list_holder`. Both targets are `UnsafeCell` so the raw pointers stay
        // valid under Stacked Borrows across later `&mut MatchedRoute` accesses.
        route.route = route.route_holder.get();
        // SAFETY: sole access to `route_holder` contents at this point.
        unsafe { (*route.route_holder.get()).params = route.params_list_holder.get() };

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
            // PORT NOTE: Zig did `if mi_is_in_heap_region(pathname.ptr) { mi_free(pathname.ptr) }`
            // to free the leaked `path` from `match`. We own that allocation as
            // `pathname_backing`; dropping it (and `params_list_holder`) here releases the
            // borrowed bytes BEFORE `route_holder`'s slices would dangle on Box drop.
            this_ref.pathname_backing = ZigStringSlice::EMPTY;
            *this_ref.params_list_holder.get_mut() = route_param::List::default();
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

        // SAFETY: `this` was heap-allocated by codegen at construction.
        drop(unsafe { bun_core::heap::take(this) });
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
                // Stack scratch — 256 × 16-byte fat ptr × 2 ≈ 8 KiB, well within Bun's
                // JS-thread stack budget. The Zig original parked these in
                // `threadlocal var` purely as a zero-init convenience; porting that as a
                // `RefCell<[&'static [u8]; 256]>` TLS slot is unsound: `iter.next()`
                // writes QueryStringMap-lifetime slices into it, and once the map drops
                // the TLS slot is left holding dangling `&'static [u8]` — invalid-value
                // UB the next time `with_borrow_mut` produces a `&mut` over it. A stack
                // array lets inference tie the element lifetime to `iter` and dies with
                // this frame.
                let mut values_buf: [&[u8]; 256] = [b""; 256];
                let mut refs_buf: [ZigString; 256] = [ZigString::EMPTY; 256];

                let mut iter = self.query.iter();
                while let Some(entry) = iter.next(&mut values_buf) {
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
        // path bytes; `bun_object::get_public_path` takes `core::fmt::Write`.
        writer: &mut impl core::fmt::Write,
        file_path: &[u8],
        client_framework_enabled: bool,
    ) {
        let mut entry_point_tempbuf = PathBuffer::uninit();
        // We don't store the framework config including the client parts in the server
        // instead, we just store a boolean saying whether we should generate this whenever the script is requested
        // this is kind of bad. we should consider instead a way to inline the contents of the script.
        if client_framework_enabled {
            // `bun_paths::fs::PathName<'_>` is the lifetime-generic mirror of
            // `bun_logger::fs::PathName`; `generate_entry_point_path` only copies
            // `dir`/`base`/`ext` into `entry_point_tempbuf`, so a borrowed view suffices.
            let path_name = bun_paths::fs::PathName::init(file_path);
            bun_object::get_public_path(
                Transpiler::entry_points::ClientEntryPoint::generate_entry_point_path(
                    &mut entry_point_tempbuf,
                    &path_name,
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
        // PORT NOTE: Zig used `std.io.fixedBufferStream` over a PathBuffer. The accessible
        // `bun_object::get_public_path_with_asset_prefix` takes `core::fmt::Write`, so write
        // into a `String` (path components are UTF-8 in practice).
        let mut writer = String::with_capacity(MAX_PATH_BYTES);
        let origin_url = if let Some(origin) = this.origin {
            // SAFETY: `origin` is a live `*mut RefString`.
            URL::parse(unsafe { (*origin).leak() })
        } else {
            URL::default()
        };
        bun_object::get_public_path_with_asset_prefix(
            this.route().file_path,
            if let Some(base_dir) = this.base_dir {
                // SAFETY: `base_dir` is a live `*mut RefString`.
                unsafe { (*base_dir).leak() }
            } else {
                // SAFETY: VM singleton is alive on the JS thread for the duration of this getter.
                unsafe { (*VirtualMachine::get().as_mut().transpiler.fs).top_level_dir }
            },
            &origin_url,
            if let Some(prefix) = this.asset_prefix {
                // SAFETY: `prefix` is a live `*mut RefString`.
                unsafe { (*prefix).leak() }
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
        if this.params().is_empty() {
            return Ok(JSValue::create_empty_object(global_this, 0));
        }

        if this.param_map.is_none() {
            // PORT NOTE: reshaped for borrowck — capture borrowed scalars before mutating `this`.
            let route = this.route();
            let scanner = CombinedScanner::init(
                b"",
                route.pathname_without_leading_slash(),
                route.name,
                this.params(),
            );
            this.param_map = QueryStringMap::init_with_scanner(scanner)?;
        }

        Self::create_query_object(global_this, this.param_map.as_mut().unwrap())
    }

    // PORT NOTE: see `get_params` — `host_fn(getter)` shim omitted (needs `&mut Self`).
    pub fn get_query(this: &mut Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let route = this.route();
        if route.query_string.is_empty() && this.params().is_empty() {
            return Ok(JSValue::create_empty_object(global_this, 0));
        } else if route.query_string.is_empty() {
            return Self::get_params(this, global_this);
        }

        if this.query_string_map.is_none() {
            let route = this.route();
            if !this.params().is_empty() {
                let scanner = CombinedScanner::init(
                    route.query_string,
                    route.pathname_without_leading_slash(),
                    route.name,
                    this.params(),
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

// PORT NOTE: `bun.ThreadlocalBuffers(struct { buf: if (isWindows) [MAX_PATH_BYTES*2]u8 else void })`
#[cfg(windows)]
thread_local! {
    static WIN32_NORMALIZE_BUF: core::cell::RefCell<[u8; MAX_PATH_BYTES * 2]> =
        const { core::cell::RefCell::new([0u8; MAX_PATH_BYTES * 2]) };
}

// ported from: src/runtime/api/filesystem_router.zig
