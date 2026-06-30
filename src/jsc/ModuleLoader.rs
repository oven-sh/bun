//! The `ModuleLoader` struct, `FetchFlags`, and the `HardcodedModule`
//! re-export compile against the `lib.rs` stub surface.
//! `transpile_source_code` / `fetch_builtin_module` / `resolve_embedded_file`
//! reach into `bun_runtime::node::fs` / `bun_bundler::transpiler` internals / gated
//! bundler types (forward-dep cycle on `bun_jsc`), so their bodies — and the
//! `Bun__*` extern "C" entry points that call them — live in
//! `bun_runtime::jsc_hooks`; this crate reaches the two it needs through
//! `virtual_machine::RuntimeHooks`.

use core::ffi::c_void;

use bun_alloc::Arena as ArenaAllocator;
use bun_options_types::LoaderExt as _;

use crate::virtual_machine::VirtualMachine;
use crate::{ErrorableResolvedSource, JSGlobalObject, JSPromise, JSValue};

// Re-exports.
pub use crate::runtime_transpiler_store::RuntimeTranspilerStore;
pub use bun_resolve_builtins::HardcodedModule;
pub use bun_resolver::node_fallbacks;

// LAYERING: re-export from the crate-level mount (`crate::async_module`)
// instead of `#[path]`-mounting `AsyncModule.rs` a second time. A duplicate
// mount compiles two distinct `Queue` types — `VirtualMachine.modules` is
// typed against `crate::async_module::Queue`, so a second copy here would be
// a different (incompatible) type and double-emits the
// `Bun__onFulfillAsyncModule` extern.
pub use crate::async_module;
pub use crate::async_module::{AsyncModule, Queue as AsyncModuleQueue};

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
// §Dispatch — runtime-transpiler argument types.
//
// `transpile_source_code` / `fetch_builtin_module` reach into
// `bun_runtime::node::fs` (read-file), `bun_bundler::transpiler::ParseResult`, the
// source-code printer pool, `bun_standalone_graph`, and `webcore::Blob` —
// every one a forward-dep on `bun_jsc`. Per PORTING.md §Dispatch (cold-path:
// called per-import, not per-tick), the two bodies live in `bun_runtime` and
// are reached through `virtual_machine::RuntimeHooks`
// (`transpile_source_code` / `fetch_builtin_module`); the `Bun__*` extern "C"
// entry points live next to their bodies in `bun_runtime::jsc_hooks`. Only the
// argument/result types they share with this crate are declared here.
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
    /// `?*?*jsc.JSPromise` — out-param for the async-module path.
    /// Null forbids async resolution.
    pub promise_ptr: *mut *mut JSPromise,
}

/// Result of `RuntimeHooks::fetch_builtin_module` — tri-state because
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

/// `VirtualMachine.processFetchLog(global, specifier, referrer, log, &errorable,
/// err)` — synthesizes a JS error from the parser/resolve `log` and writes it
/// into `errorable` so the C++ side (`Bun__onFulfillAsyncModule`,
/// ModuleLoader.cpp:473) rejects the import promise with a real Error instead
/// of `undefined`.
///
/// No §Dispatch indirection is needed here — `BuildMessage` /
/// `ResolveMessage` live in this crate — so this forwards to the real impl in
/// [`crate::virtual_machine::process_fetch_log`].
pub fn process_fetch_log(
    global: &JSGlobalObject,
    specifier: bun_core::String,
    referrer: bun_core::String,
    log: &mut bun_ast::Log,
    errorable: &mut ErrorableResolvedSource,
    err: bun_core::Error,
) {
    crate::virtual_machine::process_fetch_log(global, specifier, referrer, log, errorable, err)
}

// ──────────────────────────────────────────────────────────────────────────
// extern "C" entry points — the symbols C++ calls whose bodies live in this
// crate. `Bun__transpileFile` / `Bun__transpileVirtualModule` /
// `Bun__fetchBuiltinModule` / `Bun__resolveAndFetchBuiltinModule` /
// `Bun__resolveEmbeddedNodeFile` live next to their bodies in
// `bun_runtime::jsc_hooks`.
// ──────────────────────────────────────────────────────────────────────────

/// Linear scan over the `BUN_ALIASES` const tables (PERF: could replace with
/// a `comptime_string_map!`).
#[inline]
pub fn bun_aliases_get(name: &[u8]) -> Option<bun_resolve_builtins::Alias> {
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

/// C++ entry point: whether `data[..len]` names a builtin module.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ModuleLoader__isBuiltin(data: *const u8, len: usize) -> bool {
    // SAFETY: C++ guarantees `data[..len]` is a valid UTF-8 specifier slice.
    let str = unsafe { bun_opaque::ffi::slice(data, len) };
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
//   - `Bun__resolveEmbeddedNodeFile` (extname `"node"`; the extern "C" symbol
//     lives next to the body in `bun_runtime::jsc_hooks`).
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

/// C++ entry point: runs the plugin for a virtual-module specifier, returning its exports (or zero when no plugin runner is set).
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__runVirtualModule(
    global: &JSGlobalObject,
    specifier_ptr: *const bun_core::String,
) -> JSValue {
    bun_core::mark_binding!();
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
        Ok(Some(v)) => v,
        Ok(None) | Err(_) => JSValue::ZERO,
    }
}
