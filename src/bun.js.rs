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

    b.resolver.opts.load_tsconfig_json =
        !graph.flags.contains(GraphFlags::DISABLE_AUTOLOAD_TSCONFIG);
    b.resolver.opts.load_package_json = !graph
        .flags
        .contains(GraphFlags::DISABLE_AUTOLOAD_PACKAGE_JSON);

    // A compiled executable is a deployment artifact: boot as production (so
    // `Bun.serve` defaults to `development: false` and `.env.production` is
    // the dotenv suffix) unless the process env asks for development or test.
    // `configure_defines` runs after this and still honours an explicit
    // `NODE_ENV` / `BUN_ENV`.
    let env = b.env_mut();
    bun_core::handle_oom(env.load_process());
    let node_env = env.get_node_env().unwrap_or(b"");
    if node_env != b"development" && node_env != b"test" {
        b.options.set_production(true);
        b.resolver.opts.set_production(true);
    }
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
