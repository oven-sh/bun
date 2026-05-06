//! Port of `src/jsc/ModuleLoader.zig`.
//!
//! B-2 un-gate: real `ModuleLoader` struct, `FetchFlags`, and the
//! `HardcodedModule` re-export compile against the `lib.rs` stub surface.
//! `transpile_source_code` / `fetch_builtin_module` / `resolve_embedded_file`
//! and the `Bun__*` extern entry points are preserved verbatim from the
//! Phase-A draft inside `#[cfg(any())]` blocks below — every body reaches into
//! `bun_runtime::node::fs` / `bun_transpiler` internals / gated bundler types
//! (forward-dep cycle on `bun_jsc`).

use core::ffi::c_void;

use bun_alloc::Arena as ArenaAllocator;
use bun_logger as logger;

use crate::virtual_machine::VirtualMachine;
use crate::{
    self as jsc, ErrorableResolvedSource, JSGlobalObject, JSInternalPromise, JSValue,
    ResolvedSource,
};

// Re-exports (thin re-exports from the original Zig file).
pub use bun_resolve_builtins::HardcodedModule;
pub use bun_resolver::node_fallbacks;
// TODO(b2): `AsyncModule` / `RuntimeTranspilerStore` are gated siblings.
crate::stub_ty!(AsyncModule, RuntimeTranspilerStore);

bun_core::declare_scope!(ModuleLoader, hidden);

#[derive(Default)]
pub struct ModuleLoader {
    pub transpile_source_code_arena: Option<Box<ArenaAllocator>>,
    pub eval_source: Option<Box<logger::Source>>,
}

pub static mut IS_ALLOWED_TO_USE_INTERNAL_TESTING_APIS: bool = false;
// TODO(port): Zig used a plain mutable global; Phase B may want AtomicBool.

#[inline]
pub fn set_is_allowed_to_use_internal_testing_apis(v: bool) {
    // SAFETY: only written during init on the JS thread.
    unsafe { IS_ALLOWED_TO_USE_INTERNAL_TESTING_APIS = v };
}

impl ModuleLoader {
    /// This must be called after calling transpileSourceCode
    ///
    /// PORT NOTE: takes only `&mut VirtualMachine` (not `&mut self,
    /// &mut VirtualMachine`) — `ModuleLoader` is a value field of
    /// `VirtualMachine`, so passing both would alias (PORTING.md §Forbidden).
    /// Access `module_loader` through `jsc_vm` instead.
    pub fn reset_arena(jsc_vm: &mut VirtualMachine) {
        if let Some(arena) = jsc_vm.module_loader.transpile_source_code_arena.as_mut() {
            // TODO(port): Zig `arena.reset(.free_all)` / `.retain_with_limit(8M)`.
            // bumpalo::Bump (= bun_alloc::Arena) only has `.reset()` (free all);
            // there is no retain-with-limit variant. PERF(port): profile in Phase B.
            let _ = jsc_vm.smol;
            arena.reset();
        }
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
    pub input_specifier: bun_string::String,
    pub log: *mut logger::Log,
    pub virtual_source: Option<&'a logger::Source>,
    pub global_object: *mut JSGlobalObject,
    pub flags: FetchFlags,
    /// `(path, loader, module_type, source_code_printer)` — opaque, owned by
    /// the high tier. Null when called from the low-tier `Bun__*` shims (the
    /// hook recomputes them from `specifier`).
    pub extra: *mut c_void,
}

/// Result of `LoaderHooks::fetch_builtin_module` — tri-state to mirror
/// ModuleLoader.zig:861-876, where an ERROR during builtin lookup must be
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
    pub transpile_source_code:
        unsafe fn(jsc_vm: *mut VirtualMachine, args: &TranspileArgs<'_>, ret: *mut ErrorableResolvedSource) -> bool,
    /// `ModuleLoader.fetchBuiltinModule(jsc_vm, specifier)` — writes `*out`
    /// (as `ErrorableResolvedSource`) and returns a tri-state. On
    /// `Found`/`Errored`, `*out` is populated; on `NotFound` it is untouched.
    pub fetch_builtin_module: unsafe fn(
        jsc_vm: *mut VirtualMachine,
        global: *mut JSGlobalObject,
        specifier: &bun_string::String,
        referrer: &bun_string::String,
        out: *mut ErrorableResolvedSource,
    ) -> FetchBuiltinResult,
    /// `Bun__transpileFile` body — needs `options.getLoaderAndVirtualSource`,
    /// `node_module_module`, `webcore.Blob`, the concurrent-transpiler queue.
    /// Returns the in-flight promise when `allow_promise && async`, else null
    /// (result is in `*ret`).
    pub transpile_file: unsafe fn(
        jsc_vm: *mut VirtualMachine,
        global: *mut JSGlobalObject,
        specifier: *const bun_string::String,
        referrer: *const bun_string::String,
        type_attribute: *const bun_string::String,
        ret: *mut ErrorableResolvedSource,
        allow_promise: bool,
        is_commonjs_require: bool,
        force_loader: u8,
    ) -> *mut c_void,
}

static LOADER_HOOKS: core::sync::atomic::AtomicPtr<LoaderHooks> =
    core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());

/// Called by `bun_runtime` at startup. `hooks` must be `'static`.
pub fn set_loader_hooks(hooks: &'static LoaderHooks) {
    LOADER_HOOKS.store(
        hooks as *const LoaderHooks as *mut LoaderHooks,
        core::sync::atomic::Ordering::Release,
    );
}

#[inline]
fn loader_hooks() -> Option<&'static LoaderHooks> {
    let p = LOADER_HOOKS.load(core::sync::atomic::Ordering::Acquire);
    // SAFETY: `p` was stored from a `&'static LoaderHooks` (or is null).
    unsafe { p.as_ref() }
}

/// `ModuleLoader.transpileSourceCode(...)` — thin shim over the §Dispatch
/// hook. PERF(port): was inline switch — direct call in Zig; the indirection
/// is one fn-ptr per import, dwarfed by the parser/printer work it does.
pub fn transpile_source_code(
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
pub fn fetch_builtin_module(
    jsc_vm: &mut VirtualMachine,
    global: *mut JSGlobalObject,
    specifier: &bun_string::String,
    referrer: &bun_string::String,
    out: &mut ErrorableResolvedSource,
) -> FetchBuiltinResult {
    let Some(hooks) = loader_hooks() else {
        return FetchBuiltinResult::NotFound;
    };
    // SAFETY: hook contract — `jsc_vm` is the live per-thread VM; `out` is a
    // valid out-param.
    unsafe { (hooks.fetch_builtin_module)(jsc_vm, global, specifier, referrer, out) }
}

// ──────────────────────────────────────────────────────────────────────────
// extern "C" entry points — these are the symbols C++ calls. Bodies dispatch
// through `LoaderHooks`; the high tier owns the real logic.
// ──────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub extern "C" fn Bun__transpileFile(
    jsc_vm: *mut VirtualMachine,
    global_object: *mut JSGlobalObject,
    specifier_ptr: *mut bun_string::String,
    referrer: *mut bun_string::String,
    type_attribute: *const bun_string::String,
    ret: *mut ErrorableResolvedSource,
    allow_promise: bool,
    is_commonjs_require: bool,
    force_loader_type: u8, // bun.schema.api.Loader — passed as raw u8 across the cycle
) -> *mut c_void {
    jsc::mark_binding(core::panic::Location::caller());
    let Some(hooks) = loader_hooks() else {
        // SAFETY: C++ passed a valid out-param.
        unsafe {
            *ret = ErrorableResolvedSource::err(
                bun_core::err!("ModuleNotFound"),
                JSValue::UNDEFINED,
            )
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
pub extern "C" fn Bun__fetchBuiltinModule(
    jsc_vm: *mut VirtualMachine,
    global_object: *mut JSGlobalObject,
    specifier: *const bun_string::String,
    referrer: *const bun_string::String,
    ret: *mut ErrorableResolvedSource,
) -> bool {
    jsc::mark_binding(core::panic::Location::caller());
    // SAFETY: C++ passed valid pointers; `jsc_vm` is the live per-thread VM.
    let (jsc_vm, specifier, referrer, ret) =
        unsafe { (&mut *jsc_vm, &*specifier, &*referrer, &mut *ret) };
    // PORT NOTE: spec ModuleLoader.zig:861-876 — when `fetchBuiltinModule`
    // ERRORS, it calls `VirtualMachine.processFetchLog(..., ret, err)` and
    // returns **true** (so C++ surfaces the error instead of falling through to
    // filesystem resolution). The hook writes `ret` directly on Found/Errored.
    match fetch_builtin_module(jsc_vm, global_object, specifier, referrer, ret) {
        FetchBuiltinResult::NotFound => false,
        FetchBuiltinResult::Found | FetchBuiltinResult::Errored => true,
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `bun_runtime` / `bun_transpiler` / gated-bundler-dependent items —
// preserved verbatim from the Phase-A draft. Un-gate piecewise once the
// cycle breaks.
// ──────────────────────────────────────────────────────────────────────────
#[cfg(any())]
mod _gated_impl {
    use super::*;
    use bun_bundler::analyze_transpiled_module;
    use bun_bundler::options::{self, ModuleType};
    use bun_bundler::Transpiler;
    use bun_js_parser::{self as js_ast, js_printer, Runtime};
    use bun_options_types::schema::api;
    use bun_paths::{self, PathBuffer};
    use bun_resolver::fs as Fs;
    use bun_resolver::package_json::{MacroMap as MacroRemap, PackageJSON};
    use bun_string::{self as bun_str, strings, String, ZigString};
    use bun_sys::{self, Fd as FD};
    use bun_transpiler::{EntryPoints::MacroEntryPoint, ParseResult, PluginRunner};
    use bun_watcher::Watcher;

    use crate::node_module_module;
    use crate::runtime_transpiler_store::{dump_source, dump_source_string, set_break_point_on_first_line};

    pub fn resolve_embedded_file<'a>(
        vm: &mut VirtualMachine,
        path_buf: &'a mut PathBuffer,
        input_path: &[u8],
        extname: &[u8],
    ) -> Option<&'a [u8]> {
        // body preserved in git @ 5410a51d85^:src/jsc/ModuleLoader.rs
        todo!()
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__getDefaultLoader(global: &JSGlobalObject, str: &String) -> api::Loader {
        todo!()
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__transpileVirtualModule(
        global: *mut JSGlobalObject,
        specifier: *const bun_string::String,
        referrer: *const bun_string::String,
        source_code: *mut bun_string::ZigString,
        loader: api::Loader,
        ret: *mut ErrorableResolvedSource,
    ) -> bool {
        todo!()
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__runVirtualModule(
        global: *mut JSGlobalObject,
        specifier: *const bun_string::String,
    ) -> JSValue {
        todo!()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/ModuleLoader.zig (~1780 lines)
//   confidence: low
//   todos:      8
//   notes:      Keystone-C un-gate. ModuleLoader struct + FetchFlags +
//               reset_arena + HardcodedModule re-export real.
//               transpile_source_code / fetch_builtin_module /
//               Bun__transpileFile / Bun__fetchBuiltinModule un-gated as
//               §Dispatch shims over `LoaderHooks` (bun_runtime installs the
//               body). Bun__transpileVirtualModule / Bun__runVirtualModule
//               still gated. Full Phase-A draft @ 5410a51d85^.
// ──────────────────────────────────────────────────────────────────────────
