//! The `ModuleLoader` struct, `FetchFlags`, and the builtin-module lookup
//! helpers. `transpile_source_code` / `fetch_builtin_module` and the
//! `Bun__transpile*` / `Bun__resolve*` C++ entry points live in
//! `bun_runtime::jsc_hooks` (they reach into `node::fs`, the transpiler, and
//! the standalone graph); this crate calls the first two through link-time
//! `extern "Rust"` decls.

use bun_alloc::Arena as ArenaAllocator;
use bun_bundler::transpiler::PluginRunner;
use bun_options_types::LoaderExt as _;

use crate::virtual_machine::VirtualMachine;
use crate::{
    self as jsc, ErrorableResolvedSource, JSGlobalObject, JSInternalPromise, JSValue,
    ResolvedSource,
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
    /// User's `-e` bytes under `--interactive` (see `Eval::interactive_script`).
    pub interactive_eval_script: Option<Box<[u8]>>,
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
    pub(crate) fn reset_arena(jsc_vm: &mut VirtualMachine) {
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
}

impl FetchFlags {
    pub const fn disable_transpiling(self) -> bool {
        !matches!(self, FetchFlags::Transpile)
    }
}

pub struct TranspileArgs<'a> {
    pub specifier: &'a [u8],
    pub referrer: &'a [u8],
    pub input_specifier: &'a bun_core::String,
    pub log: *mut bun_ast::Log,
    pub virtual_source: Option<&'a bun_ast::Source>,
    pub global_object: &'a JSGlobalObject,
    pub flags: FetchFlags,
    /// Raw so the `.wasm` re-entry can mutate `loader` and recurse.
    pub extra: *mut TranspileExtra,
}

pub struct TranspileExtra {
    pub path: bun_resolver::fs::Path<'static>,
    pub loader: bun_ast::Loader,
    pub module_type: bun_bundler::options::ModuleType,
    /// `*js_printer.BufferPrinter` — the per-VM shared printer. Never null.
    pub source_code_printer: *mut bun_js_printer::BufferPrinter,
    /// `?*?*jsc.JSInternalPromise` — out-param for the async-module path.
    /// Null forbids async resolution.
    pub promise_ptr: *mut *mut JSInternalPromise,
}

unsafe extern "Rust" {
    /// Defined in `bun_runtime::jsc_hooks`.
    pub(crate) fn __bun_transpile_source_code(
        jsc_vm: *mut VirtualMachine,
        args: &TranspileArgs<'_>,
    ) -> Result<ResolvedSource, crate::CrateError>;
    /// Defined in `bun_runtime::jsc_hooks`. `None` when the specifier is not a
    /// builtin / standalone-graph module.
    pub(crate) safe fn __bun_fetch_builtin_module(
        jsc_vm: &VirtualMachine,
        global: &JSGlobalObject,
        specifier: &bun_core::String,
    ) -> Option<ResolvedSource>;
}

#[unsafe(no_mangle)]
extern "C" fn Bun__fetchBuiltinModule(
    jsc_vm: &VirtualMachine,
    global_object: &JSGlobalObject,
    specifier: &bun_core::String,
    ret: &mut ErrorableResolvedSource,
) -> bool {
    jsc::mark_binding();
    match __bun_fetch_builtin_module(jsc_vm, global_object, specifier) {
        Some(resolved) => {
            *ret = ErrorableResolvedSource::ok(resolved);
            true
        }
        None => false,
    }
}

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

/// Node's `--expose-internals`.
pub fn exposed_internal_tag(spec: &[u8]) -> Option<(Vec<u8>, crate::ResolvedSourceTag)> {
    let rest = spec.strip_prefix(b"internal/")?;
    if !bun_resolve_builtins::expose_internals_enabled() {
        return None;
    }
    let mut name = Vec::with_capacity(b"internal:".len() + rest.len());
    name.extend_from_slice(b"internal:");
    name.extend_from_slice(rest);
    let tag = crate::ResolvedSourceTag::try_from_name(&name)?;
    Some((name, tag))
}

/// C++ entry point: whether `data[..len]` names a builtin module.
#[unsafe(no_mangle)]
unsafe extern "C" fn ModuleLoader__isBuiltin(data: *const u8, len: usize) -> bool {
    // SAFETY: C++ guarantees `data[..len]` is a valid UTF-8 specifier slice.
    let str = unsafe { bun_core::ffi::slice(data, len) };
    bun_aliases_get(str).is_some() || exposed_internal_tag(str).is_some()
}

/// Module loader resolve hook: index into the codegen'd `Bun::builtinModuleKeys` of the canonical key a builtin alias
/// (`"path"`, `"node:path"`, `"bun:sqlite"`) resolves to, or -1.
#[unsafe(no_mangle)]
unsafe extern "C" fn ModuleLoader__builtinAliasIndex(data: *const u8, len: usize) -> i32 {
    // SAFETY: C++ guarantees `data[..len]` is a live 8-bit specifier slice.
    let str = unsafe { bun_core::ffi::slice(data, len) };
    HardcodedModule::Alias::get(str, bun_ast::Target::Bun, Default::default())
        .and_then(|alias| crate::builtin_module_key_index::get(alias.path.as_bytes()))
        .map_or(-1, i32::from)
}

/// C++ entry point: picks the loader for a specifier from its file extension and the VM's loader map.
#[unsafe(no_mangle)]
extern "C" fn Bun__getDefaultLoader(
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
unsafe extern "C" fn Bun__runVirtualModule(
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
        &bun_core::String::from_bytes(namespace),
        &bun_core::String::from_bytes(after_namespace),
        crate::BunPluginTarget::Bun,
    ) {
        Ok(Some(v)) => v,
        Ok(None) | Err(_) => JSValue::ZERO,
    }
}
