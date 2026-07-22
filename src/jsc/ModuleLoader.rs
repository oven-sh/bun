//! The `ModuleLoader` struct, `FetchFlags`, and the `HardcodedModule`
//! re-export compile against the `lib.rs` stub surface.
//! `transpile_source_code` / `fetch_builtin_module` / `resolve_embedded_file`
//! and the `Bun__*` extern entry points reach into `bun_runtime::node::fs` /
//! `bun_transpiler` internals / gated bundler types (forward-dep cycle on
//! `bun_jsc`).

use core::ffi::c_void;
use core::ptr::NonNull;

use bun_alloc::Arena as ArenaAllocator;
use bun_options_types::LoaderExt as _;

use crate::virtual_machine::VirtualMachine;
use crate::{
    self as jsc, ErrorCode, ErrorableResolvedSource, ErrorableString, JSGlobalObject,
    JSInternalPromise, JSValue, ResolvedSource,
};

// Re-exports.
pub use crate::runtime_transpiler_store::RuntimeTranspilerStore;
pub use bun_resolve_builtins::HardcodedModule;
pub use bun_resolver::node_fallbacks;

bun_core::declare_scope!(ModuleLoader, hidden);

#[derive(Default)]
pub struct ModuleLoader {
    pub transpile_source_code_arena: Option<Box<ArenaAllocator>>,
    pub eval_source: Option<Box<bun_ast::Source>>,
}

pub static IS_ALLOWED_TO_USE_INTERNAL_TESTING_APIS: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

#[inline]
pub(crate) fn set_is_allowed_to_use_internal_testing_apis(v: bool) {
    IS_ALLOWED_TO_USE_INTERNAL_TESTING_APIS.store(v, core::sync::atomic::Ordering::Relaxed);
}

impl ModuleLoader {
    /// This must be called after calling transpileSourceCode
    ///
    /// Takes only `&mut VirtualMachine` (not `&mut self,
    /// &mut VirtualMachine`) — `ModuleLoader` is a value field of
    /// `VirtualMachine`, so passing both would alias (PORTING.md §Forbidden).
    /// Access `module_loader` through `jsc_vm` instead.
    pub fn reset_arena(jsc_vm: &mut VirtualMachine) {
        // PERF: this unconditionally calls `reset()`. Per
        // `MimallocArena::reset_retain_with_limit`'s doc comment, the
        // "mimalloc's segment cache keeps pages warm anyway" theory behind
        // unconditional `reset()` proved wrong (purged pages get re-committed
        // and re-zeroed each cycle), which is why the cap-gated retain exists
        // and the other call sites use `reset_retain_with_limit(8 MiB)`.
        // Switching to the retain-with-limit form (when not in smol mode) is
        // a perf-sensitive change that
        // needs benchmarking (transpile arena RSS vs cycle cost), so it is
        // tracked as a dedicated work order rather than changed inline.
        if let Some(arena) = jsc_vm.module_loader.transpile_source_code_arena.as_mut() {
            arena.reset();
        }
    }
}

/// RAII guard that calls
/// [`ModuleLoader::reset_arena`] on the held VM when dropped. Holds a
/// [`BackRef`] (not `&mut`) so the body of the guarded scope may also reach
/// into the VM via raw pointers without aliasing the guard; the VM-outlives-
/// guard contract is the BackRef type invariant.
///
/// [`BackRef`]: bun_ptr::BackRef
#[must_use = "dropping immediately resets the arena before transpilation"]
pub struct ArenaResetGuard(bun_ptr::BackRef<VirtualMachine>);

impl ArenaResetGuard {
    /// `vm` must be the live per-thread VM (the [`bun_ptr::BackRef`]
    /// invariant). Drop routes through [`VirtualMachine::as_mut`], which
    /// derives provenance from the thread-local slot, so neither construction
    /// nor teardown performs a raw deref here.
    #[inline]
    pub fn new(vm: *mut VirtualMachine) -> Self {
        Self(bun_ptr::BackRef::from(
            core::ptr::NonNull::new(vm).expect("vm non-null"),
        ))
    }
}

impl Drop for ArenaResetGuard {
    #[inline]
    fn drop(&mut self) {
        // BackRef invariant: VM outlives guard. `as_mut()` re-derives the
        // `&mut` from the thread-local slot (debug-asserts `self.0` is that VM).
        ModuleLoader::reset_arena(self.0.get().as_mut());
    }
}

/// Dumps the module source to a file in /tmp/bun-debug-src/{filepath}
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum FetchFlags {
    Transpile,
    PrintSource,
    PrintSourceAndClone,
}

impl FetchFlags {
    pub const fn disable_transpiling(self) -> bool {
        !matches!(self, FetchFlags::Transpile)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// §Dispatch — `bun_runtime` loader vtable.
//
// `transpile_source_code` / `fetch_builtin_module` / `Bun__transpileFile`
// reach into `bun_runtime::node::fs` (read-file), `bun_transpiler::ParseResult`,
// `bun_bundler::analyze_transpiled_module`, the source-code printer pool, and
// `webcore::Blob` — every one a forward-dep on `bun_jsc`. Per PORTING.md
// §Dispatch (cold-path: called per-import, not per-tick), the low tier owns
// the extern-"C" symbol and a manual vtable; `bun_runtime` installs the body.
// ──────────────────────────────────────────────────────────────────────────

/// `transpile_source_code` parameters that name only low-tier types. The
/// remaining params (`path: Fs.Path`, `loader: options.Loader`,
/// `module_type: options.ModuleType`, `printer: *BufferPrinter`) are passed
/// through the `extra: *mut c_void` slot — the high-tier hook owns the cast.
pub struct TranspileArgs<'a> {
    pub specifier: &'a [u8],
    pub referrer: &'a [u8],
    pub input_specifier: bun_core::String,
    pub log: *mut bun_ast::Log,
    pub virtual_source: Option<&'a bun_ast::Source>,
    pub global_object: *mut JSGlobalObject,
    pub flags: FetchFlags,
    /// `*mut TranspileExtra` — opaque, owned by the high tier. Null when
    /// called from the low-tier `Bun__*` shims (the hook recomputes them from
    /// `specifier`).
    pub extra: *mut c_void,
}

/// Concrete shape behind [`TranspileArgs::extra`]. Declared here (not in
/// `bun_runtime`) so both tiers agree on layout; every field type is already a
/// `bun_jsc` dep (`bun_resolver`, `bun_bundler::options`, `bun_js_printer`).
///
/// Bundled into one struct (rather than positional params)
/// because the §Dispatch fn-ptr signature must be
/// stable across the crate boundary.
#[repr(C)]
pub struct TranspileExtra {
    pub path: bun_resolver::fs::Path<'static>,
    pub loader: bun_ast::Loader,
    pub module_type: bun_bundler::options::ModuleType,
    /// `*js_printer.BufferPrinter` — the per-VM shared printer. Never null
    /// when `extra` itself is non-null.
    pub source_code_printer: *mut bun_js_printer::BufferPrinter,
    /// `?*?*jsc.JSInternalPromise` — out-param for the async-module path.
    /// Null forbids async resolution.
    pub promise_ptr: *mut *mut JSInternalPromise,
}

/// Result of `LoaderHooks::fetch_builtin_module` — tri-state because
/// an ERROR during builtin lookup must be
/// surfaced to C++ (return `true` with `ret` populated as `.err`) rather than
/// falling through to filesystem resolution.
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum FetchBuiltinResult {
    /// Not a builtin/standalone-graph module — caller falls through.
    NotFound,
    /// Builtin found; `*out` is populated with `.ok(resolved)`.
    Found,
    /// Lookup errored; `*out` is populated with `.err(...)` (via
    /// `VirtualMachine::process_fetch_log`). Caller must return `true`.
    Errored,
}

pub struct LoaderHooks {
    /// `ModuleLoader.transpileSourceCode(...)` — full body. Returns `false`
    /// on error (error is written into `*ret` as `.err(...)`).
    pub transpile_source_code: unsafe fn(
        jsc_vm: *mut VirtualMachine,
        args: &TranspileArgs<'_>,
        ret: *mut ErrorableResolvedSource,
    ) -> bool,
    /// `ModuleLoader.fetchBuiltinModule(jsc_vm, specifier)` — writes `*out`
    /// (as `ErrorableResolvedSource`) and returns a tri-state. On
    /// `Found`/`Errored`, `*out` is populated; on `NotFound` it is untouched.
    pub fetch_builtin_module: unsafe fn(
        jsc_vm: *mut VirtualMachine,
        global: *mut JSGlobalObject,
        specifier: &bun_core::String,
        referrer: &bun_core::String,
        out: *mut ErrorableResolvedSource,
    ) -> FetchBuiltinResult,
    /// `ModuleLoader.getHardcodedModule(jsc_vm, specifier, hardcoded)` —
    /// per-variant body of the builtin-module fast path. `false` ⇒ `None`
    /// (recognised but not currently servable); `true` ⇒ `*out` populated.
    pub get_hardcoded_module: unsafe fn(
        jsc_vm: *mut VirtualMachine,
        specifier: &bun_core::String,
        hardcoded: bun_resolve_builtins::Module,
        out: *mut ResolvedSource,
    ) -> bool,
    /// `ModuleLoader.resolveEmbeddedFile(vm, &path_buf, input_path, "node")`
    /// — extracts an embedded `.node` addon
    /// from the standalone-module graph to a real on-disk temp file and writes
    /// the resulting path back into `*in_out_str`. Returns `true` on success.
    /// Body lives in `bun_runtime` (reaches into `node::fs` +
    /// `StandaloneModuleGraph`).
    pub resolve_embedded_node_file:
        unsafe fn(vm: *mut VirtualMachine, in_out_str: *mut bun_core::String) -> bool,
    /// `VirtualMachine.resolveMaybeNeedsTrailingSlash(res, global, specifier,
    /// source, query_string?, is_esm, is_a_file_path, is_user_require_resolve)`
    /// — the resolution path behind
    /// `Bun__resolveSync` / `Zig__GlobalObject__resolve` / `import.meta.resolve`.
    /// Body reaches into `transpiler.resolver.resolveAndAutoInstall`, the
    /// `PluginRunner`, `ObjectURLRegistry`, and `ServerEntryPoint` (all
    /// `bun_runtime` types), so the low tier owns the symbol and dispatches.
    ///
    /// Writes `*res` (always — `.ok` or `.err`); writes `*query_string` (if
    /// non-null) to a fresh owned `bun.String`. Returns `false` iff a JS
    /// exception is pending on `global`.
    pub resolve: unsafe fn(
        res: *mut ErrorableString,
        global: *mut JSGlobalObject,
        specifier: bun_core::String,
        source: bun_core::String,
        query_string: *mut bun_core::String,
        is_esm: bool,
        is_a_file_path: bool,
        is_user_require_resolve: bool,
    ) -> bool,
    /// `Bun__transpileVirtualModule` body —
    /// transpiles plugin-provided source through the per-thread `BufferPrinter`
    /// (a `bun_runtime` thread-local). Writes `*ret` (always — `.ok` or `.err`)
    /// and always returns `true`
    /// (the C++ caller already proved `plugin_runner != null`).
    pub transpile_virtual_module: unsafe fn(
        global: *mut JSGlobalObject,
        specifier: *const bun_core::String,
        referrer: *const bun_core::String,
        source_code: *mut bun_core::ZigString,
        loader: bun_options_types::schema::api::Loader,
        ret: *mut ErrorableResolvedSource,
    ) -> bool,
    /// `Bun__transpileFile` body — needs `options.getLoaderAndVirtualSource`,
    /// `node_module_module`, `webcore.Blob`, the concurrent-transpiler queue.
    /// Returns the in-flight promise when `allow_promise && async`, else null
    /// (result is in `*ret`).
    pub transpile_file: unsafe fn(
        jsc_vm: *mut VirtualMachine,
        global: *mut JSGlobalObject,
        specifier: *const bun_core::String,
        referrer: *const bun_core::String,
        type_attribute: *const bun_core::String,
        ret: *mut ErrorableResolvedSource,
        allow_promise: bool,
        is_commonjs_require: bool,
        force_loader: u8,
    ) -> *mut c_void,
}

unsafe extern "Rust" {
    /// The single `&'static` instance, defined `#[no_mangle]` in
    /// `bun_runtime::jsc_hooks`. Link-time resolved — no `AtomicPtr`, no
    /// init-order hazard. `LoaderHooks` is a `#[repr(Rust)]` POD of fn-ptrs
    /// with a single immutable definition; reading it has no precondition
    /// beyond the link succeeding → `safe static`.
    safe static __BUN_LOADER_HOOKS: LoaderHooks;
}

#[inline]
fn loader_hooks() -> Option<&'static LoaderHooks> {
    // Link-time-resolved `&'static` Rust-ABI static. Always `Some`.
    Some(&__BUN_LOADER_HOOKS)
}

/// `ModuleLoader.transpileSourceCode(...)` — thin shim over the §Dispatch
/// hook. PERF: the indirection
/// is one fn-ptr per import, dwarfed by the parser/printer work it does.
pub(crate) fn transpile_source_code(
    jsc_vm: &mut VirtualMachine,
    args: &TranspileArgs<'_>,
    ret: &mut ErrorableResolvedSource,
) -> bool {
    let Some(hooks) = loader_hooks() else {
        // No high tier (unit tests) — fail closed.
        return false;
    };
    // SAFETY: hook contract — `jsc_vm` is the live per-thread VM.
    unsafe { (hooks.transpile_source_code)(jsc_vm, args, ret) }
}

/// `ModuleLoader.fetchBuiltinModule(jsc_vm, specifier)`.
pub(crate) fn fetch_builtin_module(
    jsc_vm: &mut VirtualMachine,
    global: NonNull<JSGlobalObject>,
    specifier: &bun_core::String,
    referrer: &bun_core::String,
    out: &mut ErrorableResolvedSource,
) -> FetchBuiltinResult {
    let Some(hooks) = loader_hooks() else {
        return FetchBuiltinResult::NotFound;
    };
    // SAFETY: hook contract — `jsc_vm` is the live per-thread VM; `out` is a
    // valid out-param; `global` is the live JS-thread global passed through
    // opaquely to the §Dispatch hook.
    unsafe { (hooks.fetch_builtin_module)(jsc_vm, global.as_ptr(), specifier, referrer, out) }
}

/// `VirtualMachine.processFetchLog(global, specifier, referrer, log, &errorable,
/// err)` — synthesizes a JS error from the parser/resolve `log` and writes it
/// into `errorable` so the C++ side (`Bun__onFulfillAsyncModule`,
/// ModuleLoader.cpp:473) rejects the import promise with a real Error instead
/// of `undefined`.
///
/// No `LoaderHooks` indirection is needed here — `BuildMessage` /
/// `ResolveMessage` live in this crate — so this forwards to the real impl in
/// [`crate::virtual_machine::process_fetch_log`].
pub fn process_fetch_log(
    global: &JSGlobalObject,
    specifier: bun_core::String,
    referrer: bun_core::String,
    log: &mut bun_ast::Log,
    errorable: &mut ErrorableResolvedSource,
    err: crate::CrateError,
) {
    crate::virtual_machine::process_fetch_log(global, specifier, referrer, log, errorable, err)
}

// ──────────────────────────────────────────────────────────────────────────
// extern "C" entry points — these are the symbols C++ calls. Bodies dispatch
// through `LoaderHooks`; the high tier owns the real logic.
// ──────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__transpileFile(
    jsc_vm: *mut VirtualMachine,
    global_object: *mut JSGlobalObject,
    specifier_ptr: *mut bun_core::String,
    referrer: *mut bun_core::String,
    type_attribute: *const bun_core::String,
    ret: *mut ErrorableResolvedSource,
    allow_promise: bool,
    is_commonjs_require: bool,
    force_loader_type: u8, // bun.schema.api.Loader — passed as raw u8 across the cycle
) -> *mut c_void {
    jsc::mark_binding();
    let Some(hooks) = loader_hooks() else {
        // SAFETY: C++ passed a valid out-param.
        unsafe {
            *ret = ErrorableResolvedSource::err(
                ErrorCode(ErrorCode::JS_ERROR_OBJECT),
                JSValue::UNDEFINED,
            )
        };
        return core::ptr::null_mut();
    };
    // SAFETY: hook contract — all pointers are valid for the call (C++ ABI).
    unsafe {
        (hooks.transpile_file)(
            jsc_vm,
            global_object,
            specifier_ptr,
            referrer,
            type_attribute,
            ret,
            allow_promise,
            is_commonjs_require,
            force_loader_type,
        )
    }
}

#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__fetchBuiltinModule(
    jsc_vm: *mut VirtualMachine,
    global_object: *mut JSGlobalObject,
    specifier: *const bun_core::String,
    referrer: *const bun_core::String,
    ret: *mut ErrorableResolvedSource,
) -> bool {
    jsc::mark_binding();
    // SAFETY: C++ passed valid pointers; `jsc_vm` is the live per-thread VM and
    // `global_object` is the live JS-thread global. JSC never passes null.
    let (jsc_vm, global_object, specifier, referrer, ret) = unsafe {
        (
            &mut *jsc_vm,
            NonNull::new_unchecked(global_object),
            &*specifier,
            &*referrer,
            &mut *ret,
        )
    };
    // When `fetchBuiltinModule`
    // ERRORS, it calls `VirtualMachine.processFetchLog(..., ret, err)` and
    // returns **true** (so C++ surfaces the error instead of falling through to
    // filesystem resolution). The hook writes `ret` directly on Found/Errored.
    match fetch_builtin_module(jsc_vm, global_object, specifier, referrer, ret) {
        FetchBuiltinResult::NotFound => false,
        FetchBuiltinResult::Found | FetchBuiltinResult::Errored => true,
    }
}

/// Linear scan over the `BUN_ALIASES` const tables (PERF: could replace with
/// a `comptime_string_map!`).
#[inline]
fn bun_aliases_get(name: &[u8]) -> Option<bun_resolve_builtins::Alias> {
    // Keep the raw-table scan in agreement with `Alias::get`'s flag gate so
    // `require.resolve.paths` / `Module._resolveLookupPaths` (which reach
    // here via `ModuleLoader__isBuiltin`) don't report a gated-off specifier
    // as a builtin that `require` would then fail to load.
    if bun_resolve_builtins::stream_iter_alias_gated(name) {
        return None;
    }
    for table in bun_resolve_builtins::HardcodedModule::BUN_ALIASES {
        for (k, v) in *table {
            if *k == name {
                return Some(*v);
            }
        }
    }
    None
}

/// C++ entry point: if `specifier` names a builtin module, writes its resolved source into `ret` and returns `true`.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__resolveAndFetchBuiltinModule(
    jsc_vm: *mut VirtualMachine,
    specifier: *mut bun_core::String,
    ret: *mut ErrorableResolvedSource,
) -> bool {
    jsc::mark_binding();
    // SAFETY: C++ passed valid pointers; `jsc_vm` is the live per-thread VM.
    let specifier = unsafe { &*specifier };
    let spec_utf8 = specifier.to_utf8();
    let Some(alias) = bun_aliases_get(spec_utf8.slice()) else {
        return false;
    };
    let Some(&hardcoded) = bun_resolve_builtins::Module::MAP.get(alias.path.as_bytes()) else {
        debug_assert!(false);
        return false;
    };
    let Some(hooks) = loader_hooks() else {
        return false;
    };
    let mut resolved = ResolvedSource::default();
    // SAFETY: hook contract — `jsc_vm` is the live per-thread VM; `&mut
    // resolved` is a valid out-param.
    if !unsafe { (hooks.get_hardcoded_module)(jsc_vm, specifier, hardcoded, &raw mut resolved) } {
        return false;
    }
    // SAFETY: C++ passed a valid out-param.
    unsafe { *ret = ErrorableResolvedSource::ok(resolved) };
    true
}

/// Support embedded .node files.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__resolveEmbeddedNodeFile(
    vm: *mut VirtualMachine,
    in_out_str: *mut bun_core::String,
) -> bool {
    jsc::mark_binding();
    if VirtualMachine::get().standalone_module_graph.is_none() {
        return false;
    }
    // `ModuleLoader.resolveEmbeddedFile` reaches into `bun_runtime::node::fs` +
    // `StandaloneModuleGraph` — forward-dep on `bun_jsc`. Per §Dispatch the low
    // tier owns the extern symbol and dispatches through `LoaderHooks`; the
    // high tier extracts the embedded addon to a temp file and writes the
    // on-disk path back into `*in_out_str`.
    let Some(hooks) = loader_hooks() else {
        unreachable!()
    };
    // SAFETY: hook contract — `vm` is the live per-thread VM; `in_out_str` is a
    // valid in/out `bun.String*` (C++ ABI, BunProcess.cpp:463).
    unsafe { (hooks.resolve_embedded_node_file)(vm, in_out_str) }
}

/// C++ entry point: whether `data[..len]` names a builtin module.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ModuleLoader__isBuiltin(data: *const u8, len: usize) -> bool {
    // SAFETY: C++ guarantees `data[..len]` is a valid UTF-8 specifier slice.
    let str = unsafe { bun_core::ffi::slice(data, len) };
    bun_aliases_get(str).is_some()
}

// The pure byte-string
// `extractNamespace` / `couldBePlugin` helpers live in
// `bun_bundler::transpiler::PluginRunner` — `bun_bundler` is already a
// `bun_jsc` dep, so `Bun__runVirtualModule` calls them directly rather than
// duplicating them here.
use bun_bundler::transpiler::PluginRunner;

// `ModuleLoader.resolveEmbeddedFile`
// lives in `bun_runtime::jsc_hooks::resolve_embedded_file_to_buf`
// per PORTING.md §Forbidden ("dep-cycle: MOVE the code to the right crate") —
// the body reaches into `bun_standalone_graph` + `bun_sys::Tmpfile` +
// `node::fs`, none of which are `bun_jsc` deps. Three callers live in
// `bun_runtime`:
//   - `Bun__resolveEmbeddedNodeFile` above (extname `"node"`, goes through
//     `LoaderHooks::resolve_embedded_node_file` to bridge the crate gap).
//   - The `.sqlite` arm of `transpileSourceCode`.
//   - `ffi_body::FFI::open` (extname `"so"`/`"dylib"`/`"dll"`; same-crate
//     call to `resolve_embedded_file_to_buf`, no hook needed).

/// C++ entry point: picks the loader for a specifier from its file extension and the VM's loader map.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__getDefaultLoader(
    global: &JSGlobalObject,
    str: &bun_core::String,
) -> bun_options_types::schema::api::Loader {
    use bun_options_types::schema::api;
    // SAFETY: C++ passed the live JS-thread global; `bun_vm()` is the
    // per-thread VM pointer (never null on this path).
    let jsc_vm = global.bun_vm();
    let filename = str.to_utf8();
    let loader = jsc_vm
        .transpiler
        .options
        .loader(bun_resolver::fs::PathName::init(filename.slice()).ext)
        .to_api();
    if loader == api::Loader::file {
        return api::Loader::js;
    }
    loader
}

/// C++ entry point: transpiles a plugin-provided virtual module's source, writing the result into `ret`.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__transpileVirtualModule(
    global: *mut JSGlobalObject,
    specifier: *const bun_core::String,
    referrer: *const bun_core::String,
    source_code: *mut bun_core::ZigString,
    loader: bun_options_types::schema::api::Loader,
    ret: *mut ErrorableResolvedSource,
) -> bool {
    jsc::mark_binding();
    // Body drives `transpileSourceCode` through the per-thread `BufferPrinter`
    // (a `bun_runtime` thread-local), so per §Dispatch the low tier owns the
    // extern symbol and dispatches; `bun_runtime` installs the body. Same
    // shape as `Bun__transpileFile` above.
    let Some(hooks) = loader_hooks() else {
        // SAFETY: C++ passed a valid out-param.
        unsafe {
            *ret = ErrorableResolvedSource::err(
                ErrorCode(ErrorCode::JS_ERROR_OBJECT),
                JSValue::UNDEFINED,
            );
        }
        return true;
    };
    // SAFETY: hook contract — all pointers are valid for the call (C++ ABI).
    unsafe {
        (hooks.transpile_virtual_module)(global, specifier, referrer, source_code, loader, ret)
    }
}

/// C++ entry point: runs the plugin for a virtual-module specifier, returning its exports (or zero when no plugin runner is set).
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__runVirtualModule(
    global: &JSGlobalObject,
    specifier_ptr: *const bun_core::String,
) -> JSValue {
    jsc::mark_binding();
    if global.bun_vm().plugin_runner.is_none() {
        return JSValue::ZERO;
    }

    // SAFETY: C++ passed a valid `bun.String*`.
    let specifier_slice = unsafe { &*specifier_ptr }.to_utf8();
    let specifier = specifier_slice.slice();

    if !PluginRunner::could_be_plugin(specifier) {
        return JSValue::ZERO;
    }

    let namespace = PluginRunner::extract_namespace(specifier);
    let after_namespace = if namespace.is_empty() {
        specifier
    } else {
        &specifier[(namespace.len() + 1).min(specifier.len())..]
    };

    match global.run_on_load_plugins(
        bun_core::String::init(bun_core::ZigString::init(namespace)),
        bun_core::String::init(bun_core::ZigString::init(after_namespace)),
        crate::BunPluginTarget::Bun,
    ) {
        Ok(Some(v)) => {
            // An `onLoad` filter matched, so the plugin (not the transpiler's
            // own file read) produces this module. Register the on-disk path
            // with the watcher here or editing the file never reloads.
            global
                .bun_vm()
                .add_plugin_loaded_file_to_watcher_if_needed(specifier);
            v
        }
        Ok(None) | Err(_) => JSValue::ZERO,
    }
}
