//! `Bun.FileSystemRouter` / `MatchedRoute` — Next.js-style file router.

pub mod kind_enum {
    pub(crate) const EXACT: &[u8] = b"exact";
    pub(crate) const CATCH_ALL: &[u8] = b"catch-all";
    pub(crate) const OPTIONAL_CATCH_ALL: &[u8] = b"optional-catch-all";
    pub(crate) const DYNAMIC: &[u8] = b"dynamic";

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
use core::ops::Range;

use bun_alloc::Arena as ArenaAllocator;
use bun_ast as Log;
use bun_core::{ZigString, ZigStringSlice};
use bun_jsc::js_object::ObjectInitializer;
use bun_jsc::ref_string::RefString;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSObject, JSValue, JsCell, JsResult, LogJsc, StringJsc,
};
use bun_paths::{self as path, MAX_PATH_BYTES};
use bun_ptr::BackRef;

use bun_http_types::URLPath;
use bun_resolver::Resolver;
use bun_resolver::fs as Fs;
use bun_router::{self as Router, Match as RouterMatch, RouteConfig};
use bun_url::{CombinedScanner, QueryStringMap, URL, route_param};

use crate::api::bun_object;
use crate::webcore::{Request, Response};

// Note: `FrameworkFileSystemRouter` is declared in this file's
// `filesystem_router.classes.ts`, so codegen looks for the backing struct here
// (`crate::api::filesystem_router::FrameworkFileSystemRouter`). The
// implementation is `bake::framework_router::JSFrameworkRouter`; re-export the
// real type so the codegen-generated thunks resolve without a stub.
pub use crate::bake::framework_router::JSFrameworkRouter as FrameworkFileSystemRouter;

pub(crate) const DEFAULT_EXTENSIONS: &[&[u8]] = &[b"tsx", b"jsx", b"ts", b"mjs", b"cjs", b"js"];

// ── local shims ───────────────────────────────────────────────────────────
// `to_js` lives on the `bun_jsc::ZigStringJsc` extension trait; `from_bytes`
// auto-detects UTF-8.
use bun_jsc::ZigStringJsc as _;
#[inline]
fn zs_to_js(bytes: &[u8], global: &JSGlobalObject) -> JSValue {
    jsc::zig_string::ZigString::from_bytes(bytes).to_js(global)
}

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

// `js.routesSetCached` codegen accessor — emitted by the `.classes.ts`
// generator as `FileSystemRouterPrototype__routesSetCachedValue`. The
// `codegen_cached_accessors!` proc-macro wires the extern.
bun_jsc::codegen_cached_accessors!("FileSystemRouter"; routes);

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `JsCell` for the two fields that `reload`/`match`
// mutate. The codegen shim may still emit `this: &mut FileSystemRouter` —
// `&mut T` reborrows to `&T` so the impls compile against either.
#[bun_jsc::JsClass]
pub struct FileSystemRouter {
    // BACKREF — interned `RefString`s live in the VM cache and outlive this
    // router (we hold +1 via `claim` in `constructor`, released in `finalize`).
    pub origin: Option<BackRef<RefString>>,
    pub base_dir: Option<BackRef<RefString>>,
    // Note: Router<'a> only borrows the global FileSystem singleton — `'static` is faithful.
    pub router: JsCell<Router::Router<'static>>,
    // Router borrows slices from this arena across calls;
    // kept as boxed arena per LIFETIMES.tsv (OWNED). `bun_alloc::Arena` (mimalloc heap) is
    // the runtime-wide arena type, so allocations here are individually freeable too.
    pub arena: JsCell<Box<ArenaAllocator>>,
    pub asset_prefix: Option<BackRef<RefString>>,
}

impl FileSystemRouter {
    // Note: `pub const js = jsc.Codegen.JSFileSystemRouter; toJS/fromJS/fromJSDirect`
    // are wired by `#[bun_jsc::JsClass]` codegen — deleted per PORTING.md.

    // Note: no `#[bun_jsc::host_fn]` here — the `Free` shim it emits calls
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
        let vm = global_this.bun_vm().as_mut();

        let mut root_dir_path: ZigStringSlice =
            ZigStringSlice::from_utf8_never_free(vm.top_level_dir());
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
                return Err(global_this
                    .throw_invalid_arguments(format_args!("Expected dir to be a string")));
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
        // extensions/asset_prefix/log are all allocated from this arena.
        let arena = Box::new(ArenaAllocator::new());
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
                return Err(global_this
                    .throw_invalid_arguments(format_args!("Expected assetPrefix to be a string")));
            }

            // Copy into the arena so the slice always owns stable bytes (ZigStringSlice
            // has no clone-if-borrowed helper; the copy only happens at construction).
            let s = asset_prefix.to_slice(global_this)?;
            // SAFETY: arena is boxed and moved into the returned `FileSystemRouter`; allocation
            // outlives this slice. Detach borrow via raw ptr so `arena` can be moved below.
            let leaked: &'static [u8] =
                unsafe { bun_ptr::detach_lifetime(arena.alloc_slice_copy(s.slice())) };
            asset_prefix_slice = ZigStringSlice::from_utf8_never_free(leaked);
        }
        let mut log = Log::Log::new();
        // `defer vm.transpiler.resolver.log = orig_log` — RAII guard restores on
        // every exit path. Derived from the thread-local raw `*mut VirtualMachine`
        // (via `get_mut_ptr`) so the stored slot pointer keeps valid provenance
        // under Stacked Borrows across the `&mut vm.transpiler.resolver`
        // reborrows below (deriving from `vm: &mut _` would be invalidated by
        // those reborrows before the guard's `Drop` runs).
        // SAFETY: `vm` is the live VM for this global; resolver outlives this
        // scope. Guard is declared after `log` so it drops (and restores) first.
        let _restore_log = unsafe {
            let vm_ptr = VirtualMachine::get_mut_ptr();
            Resolver::scoped_log(
                core::ptr::addr_of_mut!((*vm_ptr).transpiler.resolver),
                core::ptr::NonNull::from(&mut log),
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
            // Note: `vm.transpiler.fs` — the resolver's `FileSystem` singleton.
            Fs::FileSystem::instance(),
            RouteConfig {
                dir: Box::from(&path_to_use[..]),
                extensions: if !extensions.is_empty() {
                    extensions.iter().map(|s| Box::<[u8]>::from(*s)).collect()
                } else {
                    DEFAULT_EXTENSIONS
                        .iter()
                        .map(|s| Box::<[u8]>::from(*s))
                        .collect()
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
                    &root_dir_info,
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
                return Err(global_this
                    .throw_invalid_arguments(format_args!("Expected origin to be a string")));
            }
            origin_str = origin.to_slice(global_this)?;
        }

        if log.errors + log.warnings > 0 {
            let err_value = log.to_js(global_this, "loading routes");
            return Err(global_this.throw_value(err_value?));
        }

        let base_dir_str = if !root_dir_info.abs_real_path.is_empty() {
            root_dir_info.abs_real_path
        } else {
            root_dir_info.abs_path
        };

        // Note: `vm.refCountedString` is an interning cache — on a cache HIT it
        // returns the existing `*mut RefString` WITHOUT bumping the refcount.
        // `getScriptSrc`/`getOrigin` use `.leak()` (no ref), so without an
        // explicit hold N routers sharing one interned RefString → N finalizers
        // deref a single +1 → UAF on the second deref. Claim an explicit +1 here
        // so each `FileSystemRouter` owns its hold; `finalize` releases it.
        let claim = |p: *mut RefString| -> BackRef<RefString> {
            // `ref_counted_string` returns a live interned `*mut RefString`; wrap as
            // `BackRef` (owner-outlives-holder: VM intern cache + our +1).
            let r = BackRef::from(core::ptr::NonNull::new(p).expect("ref_counted_string"));
            r.ref_();
            r
        };
        let fs_router = Box::new(FileSystemRouter {
            origin: if !origin_str.slice().is_empty() {
                Some(claim(
                    vm.ref_counted_string::<true>(origin_str.slice(), None),
                ))
            } else {
                None
            },
            base_dir: Some(claim(vm.ref_counted_string::<true>(base_dir_str, None))),
            asset_prefix: if !asset_prefix_slice.slice().is_empty() {
                Some(claim(vm.ref_counted_string::<true>(
                    asset_prefix_slice.slice(),
                    None,
                )))
            } else {
                None
            },
            router: JsCell::new(router),
            arena: JsCell::new(arena),
        });

        // RouteConfig::dir is an owned `Box<[u8]>`, so copy the bytes; the
        // `claim` above already took our +1.
        // `base_dir` was just set to Some above.
        let base_dir = fs_router.base_dir.unwrap();
        fs_router
            .router
            .with_mut(|r| r.config.dir = Box::from(base_dir.leak()));

        Ok(fs_router)
    }

    pub fn bust_dir_cache_recursive(&self, global_this: &JSGlobalObject, input_path: &[u8]) {
        // SAFETY: `bun_vm()` returns the live VM raw pointer for this global. Re-derive the
        // `&mut` per use site so the recursive call (which does the same) doesn't pop our
        // SB tag mid-loop.
        let vm = global_this.bun_vm();
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
                        self.bust_dir_cache_recursive(global_this, &full_path);
                    }
                }
            }
        }

        let _ = vm.as_mut().transpiler.resolver.bust_dir_cache(path);
    }

    pub fn bust_dir_cache(&self, global_this: &JSGlobalObject) {
        let dir =
            strings::paths::without_trailing_slash_windows_path(&self.router.get().config.dir);
        // Note: reshaped for borrowck — `dir` borrows `self.router.config.dir`; the
        // recursive walk re-derives the path from the resolver per-iteration so a one-time
        // copy is sufficient.
        let dir = dir.to_vec();
        self.bust_dir_cache_recursive(global_this, &dir);
    }

    #[bun_jsc::host_fn(method)]
    pub fn reload(
        this: &Self,
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
                core::ptr::NonNull::from(&mut log),
            )
        };

        this.bust_dir_cache(global_this);
        // Note: `bust_dir_cache` re-derives the VM borrow internally; rebind here so
        // our `vm` borrow is fresh under Stacked Borrows.
        let vm = global_this.bun_vm().as_mut();

        // R-2: snapshot the config fields up front so the `JsCell::get()` borrow is
        // released before `JsCell::set()` below installs the new router.
        let (cfg_dir, cfg_extensions, cfg_asset_prefix_path) = {
            let cfg = &this.router.get().config;
            (
                cfg.dir.clone(),
                cfg.extensions.clone(),
                cfg.asset_prefix_path.clone(),
            )
        };

        let root_dir_info = match vm.transpiler.resolver.read_dir_info(&cfg_dir) {
            Ok(Some(info)) => info,
            Ok(None) => {
                return Err(global_this.throw(format_args!(
                    "Unable to find directory: {}",
                    bstr::BStr::new(&*cfg_dir)
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
                dir: cfg_dir,
                extensions: cfg_extensions,
                asset_prefix_path: cfg_asset_prefix_path,
                ..Default::default()
            },
        )
        .expect("unreachable");
        {
            let config_dir = router.config.dir.clone();
            if router
                .load_routes(
                    &mut log,
                    &root_dir_info,
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
        // Note: order matters — old router borrows slices from old arena, so it must drop
        // first.
        this.router.set(router);
        this.arena.set(arena);
        // `js.routesSetCached` — wired via `codegen_cached_accessors!` above.
        routes_set_cached(this_value, global_this, JSValue::ZERO);
        Ok(this_value)
    }

    #[bun_jsc::host_fn(method)]
    pub fn r#match(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let argument_ = callframe.arguments_old::<2>();
        if argument_.len == 0 {
            return Err(global_this
                .throw_invalid_arguments(format_args!("Expected string, Request or Response")));
        }

        let argument = argument_.ptr[0];
        if argument.is_empty_or_undefined_or_null() || !argument.is_cell() {
            return Err(global_this
                .throw_invalid_arguments(format_args!("Expected string, Request or Response")));
        }

        let mut path: ZigStringSlice = 'brk: {
            if argument.is_string() {
                // Force ownership via into_vec: ZigStringSlice has no clone-if-borrowed
                // helper, and `path` must outlive the JS string rope it came from.
                break 'brk ZigStringSlice::init_owned(argument.to_slice(global_this)?.into_vec());
            }

            if argument.is_cell() {
                // `as_class_ref` is the safe shared-borrow downcast (centralised
                // deref proof in `JSValue`); the JS wrapper roots the payload
                // while `argument` is on the stack.
                if let Some(req) = argument.as_class_ref::<Request>() {
                    req.ensure_url().expect("unreachable");
                    break 'brk req.url.get().to_utf8();
                }

                if let Some(resp) = argument.as_class_ref::<Response>() {
                    break 'brk resp.get_utf8_url();
                }
            }

            return Err(global_this
                .throw_invalid_arguments(format_args!("Expected string, Request or Response")));
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

        // URLPath::parse strips byte 0 and the route table is keyed without the
        // leading slash, so "Xtop" would match "/top". The URL branch above and
        // the empty-input normalisation both yield '/'-prefixed paths already.
        if path.slice().first() != Some(&b'/') {
            return Ok(JSValue::NULL);
        }

        // `path` is already an owned allocation; if `parse()` has to percent-decode, it
        // allocates a second buffer and `URLPath` owns that instead — recovered below via
        // `into_owned_buffer`.
        let url_path = match URLPath::parse(path.slice()) {
            Ok(v) => v,
            Err(err) => {
                return Err(global_this.throw(format_args!(
                    "{} parsing path: {}",
                    bun_url::Error::from(err).name(),
                    bstr::BStr::new(path.slice())
                )));
            }
        };
        let mut params = route_param::List::default();
        // `defer params.deinit(allocator)` → Drop
        // SAFETY: R-2 — short-lived `&mut Router` for the route lookup;
        // `match_page_with_allocator` is pure (no JS re-entry), and the returned
        // `Match<'p>` borrows `params`/`url_path`, not `*router`, so the
        // exclusive borrow ends at the `;`.
        let Some(route) = unsafe { this.router.get_mut() }
            .routes
            .match_page_with_allocator(b"", &url_path, &mut params)
        else {
            return Ok(JSValue::NULL);
        };

        // `MatchedRoute::init` records `route`'s request-path slices as offset ranges, so
        // after it returns nothing borrows `url_path`/`params` and the backing buffer can
        // be moved into the result.
        let pathname_len = route.pathname.len();
        let mut result =
            MatchedRoute::init(&route, this.origin, this.asset_prefix, this.base_dir.unwrap());
        result.pathname = match url_path.into_owned_buffer() {
            Some(decoded) => decoded.into_boxed_slice(),
            None => path.into_vec().into_boxed_slice(),
        };
        debug_assert_eq!(result.pathname.len(), pathname_len);

        // Ownership transfers to the GC wrapper (freed via
        // `MatchedRouteClass__finalize`); the leak lives once in `to_js_boxed`.
        Ok(MatchedRoute::to_js_boxed(result, global_this))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_origin(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        if let Some(ref origin) = this.origin {
            return Ok(zs_to_js(origin.leak(), global_this));
        }

        Ok(JSValue::NULL)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_routes(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let router = this.router.get();
        let paths = router.get_entry_points();
        let names = router.get_names();
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
        bun_core::String::static_("nextjs").to_js(global_this)
    }

    // Codegen's `host_fn_finalize` calls this via `|b| FileSystemRouter::finalize(b)`
    // and requires `fn finalize(self: Box<Self>)`; clippy::boxed_local is a
    // false positive on that contract.
    #[allow(clippy::boxed_local)]
    pub fn finalize(mut self: Box<Self>) {
        // Note: `BackRef` Derefs to `&RefString`; use `.get()` to avoid
        // resolving to `<BackRef as Deref>::deref`.
        if let Some(p) = self.asset_prefix.take() {
            p.get().deref();
        }
        if let Some(p) = self.origin.take() {
            p.get().deref();
        }
        if let Some(p) = self.base_dir.take() {
            p.get().deref();
        }
    }
}

/// Dynamic-route parameter stored as an offset range into
/// [`MatchedRoute::pathname`], so `MatchedRoute` owns its request bytes outright
/// rather than borrowing them.
struct MatchedParam {
    /// Slices the route template (resolver-interned, process lifetime).
    name: &'static [u8],
    /// Range into `MatchedRoute::pathname`.
    value: Range<u32>,
}

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct MatchedRoute {
    /// Owns the full request pathname (possibly percent-decoded). `query_string`
    /// and each `params[_].value` are offset ranges into this buffer.
    pathname: Box<[u8]>,
    query_string: Range<u32>,
    /// Route name, like `"posts/[id]"` — resolver-interned, process lifetime.
    name: &'static [u8],
    /// Absolute filesystem path — resolver-interned, process lifetime.
    file_path: &'static [u8],
    params: Vec<MatchedParam>,

    // R-2: lazily populated by `get_query`/`get_params` (now `&self`).
    pub query_string_map: JsCell<Option<QueryStringMap>>,
    pub param_map: JsCell<Option<QueryStringMap>>,
    // BACKREF — interned `RefString`s; we hold +1 (bumped in `init`, released in
    // `finalize`). The interned allocation outlives every `MatchedRoute`.
    pub origin: Option<BackRef<RefString>>,
    pub asset_prefix: Option<BackRef<RefString>>,
    pub base_dir: Option<BackRef<RefString>>,
}

impl MatchedRoute {
    // Note: `pub const js = jsc.Codegen.JSMatchedRoute; toJS/fromJS/fromJSDirect`
    // wired by `#[bun_jsc::JsClass]` — deleted.

    #[inline]
    fn query_string(&self) -> &[u8] {
        &self.pathname[self.query_string.start as usize..self.query_string.end as usize]
    }

    #[inline]
    fn pathname_without_leading_slash(&self) -> &[u8] {
        strings::trim_left(&self.pathname, b"/")
    }

    /// Materialize `params` as slices borrowing `self.pathname` for the
    /// `CombinedScanner` API.
    fn params_list(&self) -> route_param::List<'_> {
        self.params
            .iter()
            .map(|p| route_param::Param {
                name: p.name,
                value: &self.pathname[p.value.start as usize..p.value.end as usize],
            })
            .collect()
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_name(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(zs_to_js(this.name, global_this))
    }

    /// Build a `MatchedRoute` from a router `Match`. `match_.query_string` and every
    /// `match_.params[_].value` are sub-slices of `match_.pathname`; they are recorded
    /// here as offset ranges so this struct can own the pathname buffer outright. The
    /// caller moves that buffer in as `pathname` once `match_`'s borrow of it has been
    /// released (see the call site).
    pub fn init(
        match_: &RouterMatch<'_>,
        origin: Option<BackRef<RefString>>,
        asset_prefix: Option<BackRef<RefString>>,
        base_dir: BackRef<RefString>,
    ) -> Box<MatchedRoute> {
        fn range_in(outer: &[u8], inner: &[u8]) -> Range<u32> {
            match bun_core::range_of_slice_in_buffer(inner, outer) {
                Some([off, len]) => off..off + len,
                None => {
                    debug_assert!(inner.is_empty());
                    0..0
                }
            }
        }

        let query_string = range_in(match_.pathname, match_.query_string);
        let params: Vec<MatchedParam> = match_
            .params
            .iter()
            .map(|p| MatchedParam {
                name: p.name,
                value: range_in(match_.pathname, p.value),
            })
            .collect();

        // Note: `base_dir.ref()` / `o.ref()` / `prefix.ref()` — bump refcounts.
        // Each is a live interned `RefString` (caller-provided BackRef).
        base_dir.ref_();
        if let Some(o) = origin {
            o.ref_();
        }
        if let Some(p) = asset_prefix {
            p.ref_();
        }

        Box::new(MatchedRoute {
            pathname: Box::default(),
            query_string,
            name: match_.name,
            file_path: match_.file_path,
            params,
            asset_prefix,
            origin,
            base_dir: Some(base_dir),
            query_string_map: JsCell::new(None),
            param_map: JsCell::new(None),
        })
    }

    #[allow(clippy::boxed_local)]
    pub fn finalize(self: Box<Self>) {
        if let Some(p) = &self.origin {
            p.get().deref();
        }
        if let Some(p) = &self.asset_prefix {
            p.get().deref();
        }
        if let Some(p) = &self.base_dir {
            p.get().deref();
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_file_path(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(zs_to_js(this.file_path, global_this))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_pathname(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(zs_to_js(&this.pathname, global_this))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_kind(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(zs_to_js(kind_enum::classify(this.name), global_this))
    }

    pub fn create_query_object(
        ctx: &JSGlobalObject,
        map: &mut QueryStringMap,
    ) -> JsResult<JSValue> {
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

    #[bun_jsc::host_fn(getter)]
    pub fn get_script_src(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        // `bun_object::get_public_path_with_asset_prefix` takes `core::fmt::Write`, so write
        // into a `String` (path components are UTF-8 in practice).
        let mut writer = String::with_capacity(MAX_PATH_BYTES);
        let origin_url = if let Some(ref origin) = this.origin {
            URL::parse(origin.leak())
        } else {
            URL::default()
        };
        bun_object::get_public_path_with_asset_prefix(
            this.file_path,
            if let Some(ref base_dir) = this.base_dir {
                base_dir.leak()
            } else {
                Fs::FileSystem::get().top_level_dir
            },
            &origin_url,
            if let Some(ref prefix) = this.asset_prefix {
                prefix.leak()
            } else {
                b""
            },
            &mut writer,
            path::Platform::Posix,
        );
        Ok(zs_to_js(writer.as_bytes(), global_this))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_params(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        if this.params.is_empty() {
            return Ok(JSValue::create_empty_object(global_this, 0));
        }

        if this.param_map.get().is_none() {
            let params = this.params_list();
            let scanner = CombinedScanner::init(
                b"",
                this.pathname_without_leading_slash(),
                this.name,
                &params,
            );
            this.param_map
                .set(QueryStringMap::init_with_scanner(scanner)?);
        }

        // R-2: `create_query_object` writes only into a fresh plain JSObject (no
        // user setters), so this `with_mut` borrow cannot be re-entered.
        this.param_map
            .with_mut(|m| Self::create_query_object(global_this, m.as_mut().unwrap()))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_query(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        if this.query_string().is_empty() && this.params.is_empty() {
            return Ok(JSValue::create_empty_object(global_this, 0));
        } else if this.query_string().is_empty() {
            return Self::get_params(this, global_this);
        }

        if this.query_string_map.get().is_none() {
            if !this.params.is_empty() {
                let params = this.params_list();
                let scanner = CombinedScanner::init(
                    this.query_string(),
                    this.pathname_without_leading_slash(),
                    this.name,
                    &params,
                );
                this.query_string_map
                    .set(QueryStringMap::init_with_scanner(scanner)?);
            } else {
                this.query_string_map
                    .set(QueryStringMap::init(this.query_string())?);
            }
        }

        // If it's still null, the query string has no names.
        // R-2: see `get_params` re `with_mut` re-entry.
        this.query_string_map.with_mut(|m| match m {
            Some(map) => Self::create_query_object(global_this, map),
            None => Ok(JSValue::create_empty_object(global_this, 0)),
        })
    }
}

// Note: `bun.ThreadlocalBuffers(struct { buf: if (isWindows) [MAX_PATH_BYTES*2]u8 else void })`
// Heap-backed so only a Box pointer lives in TLS — a `const { [0u8; MAX_PATH_BYTES*2] }`
// initializer here would put ~192 KB of zeros directly into the PE `.tls` section
// (PE/COFF has no TLS-BSS). See test/js/bun/binary/tls-segment-size.
#[cfg(windows)]
thread_local! {
    static WIN32_NORMALIZE_BUF: core::cell::RefCell<Box<[u8; MAX_PATH_BYTES * 2]>> =
        core::cell::RefCell::new(bun_core::boxed_zeroed());
}
