//! Entry point for `bun run <file>` / standalone executables.
//!
//! Hosts `apply_standalone_runtime_flags` and `fail_with_build_error`; the
//! `Run` VM driver itself lives in `crate::cli::run_command`.

use bun_core::{Global, Output};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_standalone_graph::StandaloneModuleGraph::{Flags as GraphFlags, StandaloneModuleGraph};

pub(crate) fn apply_standalone_runtime_flags(
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

    // `--compile-autoload-tsconfig` and `--compile-autoload-package-json` select the resolver's
    // directory cache, so the VM gave them to the resolver when it created it.
    debug_assert!(b.resolver.load_mode() == bun_resolver::StandaloneModuleGraph::load_mode(graph));
}

#[cold]
#[inline(never)]
fn dump_build_error(vm: &mut VirtualMachine) {
    Output::flush();

    let writer = Output::error_writer_buffered();
    // `defer Output.flush()` — RAII guard flushes buffered stderr on every exit path.
    let _flush = Output::flush_guard();

    if let Some(mut p) = vm.log {
        // SAFETY: `vm.log` is set during `VirtualMachine::init` to the VM-owned log and
        // remains valid for the lifetime of `vm`; the `&mut VirtualMachine` borrow above
        // guarantees exclusive access to it here.
        let _ = unsafe { p.as_mut() }.print(std::ptr::from_mut(writer));
    }
}

#[cold]
#[inline(never)]
pub(crate) fn fail_with_build_error(vm: &mut VirtualMachine) -> ! {
    dump_build_error(vm);
    Global::exit(1);
}
