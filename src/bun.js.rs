//! Port of src/bun.js.zig — entry point for `bun run <file>` / standalone executables.
//!
//! The `Run` struct (the per-process VM driver) is defined once in
//! `crate::cli::run_command` so the CLI dispatch path can call it directly
//! without a crate-cycle; this module re-exports it under the Zig namespace
//! `bun.js.Run` and hosts the handful of helpers that other crates reach for
//! (`apply_standalone_runtime_flags`, `fail_with_build_error`, the
//! `Bun__on{Resolve,Reject}EntryPointResult` host fns).

use bun_core::{Global, Output};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_standalone_graph::StandaloneModuleGraph::{Flags as GraphFlags, StandaloneModuleGraph};

// Thin re-exports (mirrors `pub const X = @import(...)` at file top).
pub use crate::api;
pub use crate::webcore;
pub use bun_jsc as jsc_mod; // TODO(port): naming — Zig exposed this as `bun.js.jsc`

/// Canonical `Run` lives in `cli::run_command`; re-export so callers that
/// expect `bun.js.Run` resolve to the single definition.
pub use crate::cli::run_command::Run;

pub fn apply_standalone_runtime_flags(
    b: &mut bun_bundler::Transpiler,
    graph: &StandaloneModuleGraph,
) {
    use bun_options_types::schema::api::DotEnvBehavior;
    let disable_env = graph.flags.contains(GraphFlags::DISABLE_DEFAULT_ENV_FILES);
    b.options.env.disable_default_env_files = disable_env;
    b.options.env.behavior = if disable_env {
        DotEnvBehavior::disable
    } else {
        DotEnvBehavior::LoadAllWithoutInlining
    };

    b.resolver.opts.load_tsconfig_json =
        !graph.flags.contains(GraphFlags::DISABLE_AUTOLOAD_TSCONFIG);
    b.resolver.opts.load_package_json = !graph
        .flags
        .contains(GraphFlags::DISABLE_AUTOLOAD_PACKAGE_JSON);
}

// Bun__on{Resolve,Reject}EntryPointResult are defined in `crate::hw_exports`
// (real bodies via ConsoleObject); re-exported here for namespace fidelity.
pub use crate::hw_exports::{on_reject_entry_point_result, on_resolve_entry_point_result};

#[cold]
#[inline(never)]
fn dump_build_error(vm: &mut VirtualMachine) {
    Output::flush();

    let writer = Output::error_writer_buffered();
    // `defer Output.flush()` — RAII guard flushes buffered stderr on every exit path.
    let _flush = Output::flush_guard();

    // SAFETY: `vm.log` is set in `init`.
    if let Some(mut p) = vm.log {
        let _ = unsafe { p.as_mut() }.print(std::ptr::from_mut(writer));
    }
}

#[cold]
#[inline(never)]
pub fn fail_with_build_error(vm: &mut VirtualMachine) -> ! {
    dump_build_error(vm);
    Global::exit(1);
}
