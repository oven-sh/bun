//! Port of `src/jsc/ModuleLoader.zig`.
//!
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
    self as jsc, ErrorableResolvedSource, ErrorableString, JSGlobalObject, JSInternalPromise,
    JSValue, JsError, JsResult, ResolvedSource,
};

// Re-exports (thin re-exports from the original Zig file).
pub use crate::runtime_transpiler_store::RuntimeTranspilerStore;
pub use bun_resolve_builtins::HardcodedModule;
pub use bun_resolver::node_fallbacks;

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
    pub fn reset_arena(jsc_vm: &mut VirtualMachine) {
        if let Some(arena) = jsc_vm.module_loader.transpile_source_code_arena.as_mut() {
            arena.reset();
        }
    }
}

#[must_use = "dropping immediately resets the arena before transpilation"]
pub struct ArenaResetGuard(bun_ptr::BackRef<VirtualMachine>);

impl ArenaResetGuard {
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

#[repr(C)]
pub struct TranspileExtra {
    pub path: bun_resolver::fs::Path<'static>,
    pub loader: bun_ast::Loader,
    pub module_type: bun_bundler::options::ModuleType,
    /// `*js_printer.BufferPrinter` — the per-VM shared printer. Never null
    /// when `extra` itself is non-null.
    pub source_code_printer: *mut bun_js_printer::BufferPrinter,
    /// `?*?*jsc.JSInternalPromise` — out-param for the async-module path
    /// (ModuleLoader.zig:95). Null forbids async resolution.
    pub promise_ptr: *mut *mut JSInternalPromise,
}

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
    pub resolve_embedded_node_file:
        unsafe fn(vm: *mut VirtualMachine, in_out_str: *mut bun_core::String) -> bool,
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
    pub transpile_virtual_module: unsafe fn(
        global: *mut JSGlobalObject,
        specifier: *const bun_core::String,
        referrer: *const bun_core::String,
        source_code: *mut bun_core::ZigString,
        loader: bun_options_types::schema::api::Loader,
        ret: *mut ErrorableResolvedSource,
    ) -> bool,
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
    safe static __BUN_LOADER_HOOKS: LoaderHooks;
}

#[inline]
fn loader_hooks() -> Option<&'static LoaderHooks> {
    // Link-time-resolved `&'static` Rust-ABI static. Always `Some`.
    Some(&__BUN_LOADER_HOOKS)
}

/// `ModuleLoader.transpileSourceCode(...)` — thin shim over the §Dispatch
/// hook. PERF(port): was inline switch — direct call in Zig; the indirection
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

pub fn resolve_maybe_needs_trailing_slash(
    res: &mut ErrorableString,
    global: &mut JSGlobalObject,
    specifier: bun_core::String,
    source: bun_core::String,
    query_string: Option<&mut bun_core::String>,
    is_esm: bool,
    is_a_file_path: bool,
    is_user_require_resolve: bool,
) -> JsResult<()> {
    let Some(hooks) = loader_hooks() else {
        // No high tier (unit tests) — fail closed with ModuleNotFound so
        // callers surface a real ResolveMessage rather than `undefined`.
        *res = ErrorableString::err(bun_core::err!("ModuleNotFound"), JSValue::UNDEFINED);
        return Ok(());
    };
    let qs = query_string
        .map(std::ptr::from_mut::<bun_core::String>)
        .unwrap_or(core::ptr::null_mut());
    // SAFETY: hook contract — `global` is the live JS-thread global (Zig
    // `*JSGlobalObject`, mutable: hook may throw on it); `res`/`qs` are valid
    // out-params for the call (single-threaded, no aliasing).
    let ok = unsafe {
        (hooks.resolve)(
            res,
            global,
            specifier,
            source,
            qs,
            is_esm,
            is_a_file_path,
            is_user_require_resolve,
        )
    };
    if ok { Ok(()) } else { Err(JsError::Thrown) }
}

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
            *ret =
                ErrorableResolvedSource::err(bun_core::err!("ModuleNotFound"), JSValue::UNDEFINED)
        };
        return core::ptr::null_mut();
    };
    // SAFETY: hook contract — all pointers are valid for the call (C++ ABI).
    // PERF(port): was inline switch.
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
    match fetch_builtin_module(jsc_vm, global_object, specifier, referrer, ret) {
        FetchBuiltinResult::NotFound => false,
        FetchBuiltinResult::Found | FetchBuiltinResult::Errored => true,
    }
}

/// `HardcodedModule.Alias.bun_aliases.get(str)` — linear scan over the
/// `BUN_ALIASES` const tables (PERF(port): could replace with phf).
#[inline]
fn bun_aliases_get(name: &[u8]) -> Option<bun_resolve_builtins::Alias> {
    for table in bun_resolve_builtins::HardcodedModule::BUN_ALIASES {
        for (k, v) in *table {
            if *k == name {
                return Some(*v);
            }
        }
    }
    None
}

/// Spec ModuleLoader.zig:828-848.
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

/// Spec ModuleLoader.zig:1332-1342. Support embedded .node files.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__resolveEmbeddedNodeFile(
    vm: *mut VirtualMachine,
    in_out_str: *mut bun_core::String,
) -> bool {
    jsc::mark_binding();
    if VirtualMachine::get().standalone_module_graph.is_none() {
        return false;
    }
    let Some(hooks) = loader_hooks() else {
        unreachable!()
    };
    // SAFETY: hook contract — `vm` is the live per-thread VM; `in_out_str` is a
    // valid in/out `bun.String*` (C++ ABI, BunProcess.cpp:463).
    // PERF(port): was inline switch.
    unsafe { (hooks.resolve_embedded_node_file)(vm, in_out_str) }
}

/// Spec ModuleLoader.zig:1344-1347.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ModuleLoader__isBuiltin(data: *const u8, len: usize) -> bool {
    // SAFETY: C++ guarantees `data[..len]` is a valid UTF-8 specifier slice.
    let str = unsafe { bun_core::ffi::slice(data, len) };
    bun_aliases_get(str).is_some()
}

use bun_bundler::transpiler::PluginRunner;

/// Spec ModuleLoader.zig:73-83.
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

/// Spec ModuleLoader.zig:1234-1304.
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
    let Some(hooks) = loader_hooks() else {
        // SAFETY: C++ passed a valid out-param.
        unsafe {
            *ret =
                ErrorableResolvedSource::err(bun_core::err!("ModuleNotFound"), JSValue::UNDEFINED);
        }
        return true;
    };
    // SAFETY: hook contract — all pointers are valid for the call (C++ ABI).
    // PERF(port): was inline switch.
    unsafe {
        (hooks.transpile_virtual_module)(global, specifier, referrer, source_code, loader, ret)
    }
}

/// Spec ModuleLoader.zig:1122-1143.
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
        // `catch return .zero` / `orelse return .zero`
        Ok(Some(v)) => v,
        Ok(None) | Err(_) => JSValue::ZERO,
    }
}

// ported from: src/jsc/ModuleLoader.zig
