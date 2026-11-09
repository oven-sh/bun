//! Entry point for `bun run <file>` / standalone executables.
//!
//! Hosts `apply_standalone_runtime_flags`, `fail_with_build_error` and
//! `exit_if_logged`; the `Run` VM driver itself lives in `crate::cli::run_command`.

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

    b.resolver.opts.load_tsconfig_json =
        !graph.flags.contains(GraphFlags::DISABLE_AUTOLOAD_TSCONFIG);
    b.resolver.opts.load_package_json = !graph
        .flags
        .contains(GraphFlags::DISABLE_AUTOLOAD_PACKAGE_JSON);
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

/// For a command whose `configure_defines` failed: when the log says why, prints it and exits 1.
#[cold]
#[inline(never)]
pub(crate) fn exit_if_logged(log: &bun_ast::Log) {
    if log.has_errors() {
        let _ = log.print(std::ptr::from_mut(Output::error_writer()));
        Global::exit(1);
    }
}
