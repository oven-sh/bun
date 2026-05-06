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
    pub fn reset_arena(&mut self, jsc_vm: &mut VirtualMachine) {
        debug_assert!(core::ptr::eq(&jsc_vm.module_loader, self));
        if let Some(arena) = self.transpile_source_code_arena.as_mut() {
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

    pub fn transpile_source_code<const FLAGS: FetchFlags>(
        jsc_vm: &mut VirtualMachine,
        specifier: &[u8],
        referrer: &[u8],
        // … 16 more params; full body @ 5410a51d85^
    ) -> Result<ResolvedSource, bun_core::Error> {
        todo!()
    }

    pub fn fetch_builtin_module(
        jsc_vm: &mut VirtualMachine,
        global_object: &JSGlobalObject,
        specifier: &bun_string::String,
        referrer: &bun_string::String,
        ret: &mut ErrorableResolvedSource,
    ) -> Result<Option<ResolvedSource>, bun_core::Error> {
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
    pub extern "C" fn Bun__fetchBuiltinModule(
        global: *mut JSGlobalObject,
        specifier: *const bun_string::String,
        referrer: *const bun_string::String,
        ret: *mut ErrorableResolvedSource,
    ) -> bool {
        todo!()
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__transpileFile(
        global: *mut JSGlobalObject,
        specifier: *const bun_string::String,
        referrer: *const bun_string::String,
        type_attribute: *const bun_string::String,
        ret: *mut ErrorableResolvedSource,
        allow_promise: bool,
        is_for_import: bool,
    ) -> *mut JSInternalPromise {
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
//   notes:      B-2 un-gate. ModuleLoader struct + FetchFlags + reset_arena +
//               HardcodedModule re-export real. transpile_source_code /
//               fetch_builtin_module / Bun__* externs gated (bun_runtime
//               cycle, gated bundler internals). Full Phase-A draft preserved
//               in git @ 5410a51d85^.
// ──────────────────────────────────────────────────────────────────────────
