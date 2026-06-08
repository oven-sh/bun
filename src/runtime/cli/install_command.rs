use bun_core::{Error, Global, Output, err};
use bun_install::package_manager_real::{
    CommandLineArguments, PackageManager, ROOT_PACKAGE_JSON_PATH, Subcommand, install_with_manager,
    update_package_json_and_install_with_manager,
};

use crate::Cli;
use crate::cli::pm_update_package_json::analyze_dependencies_and_install;
use crate::command::ContextData;

pub(crate) struct InstallCommand;

impl InstallCommand {
    pub(crate) fn exec(ctx: &mut ContextData) -> Result<(), Error> {
        match install(ctx) {
            Ok(()) => Ok(()),
            Err(e) => Self::handle_error(e),
        }
    }

    /// Cold, out-of-line error path so the hot `bun install` dispatch in `exec`
    /// stays small and contiguous in `.text` (the "no changes" fast path never
    /// touches this code, and demand-paging it in pollutes the startup window).
    #[cold]
    #[inline(never)]
    fn handle_error(e: Error) -> Result<(), Error> {
        if e == err!("InstallFailed") || e == err!("InvalidPackageJSON") {
            // SAFETY: `Cli::LOG_` is initialised once during single-threaded
            // startup in `Cli::start()` before any command (including this
            // one) is dispatched; no other `&mut` to it is live here.
            let log = unsafe { (*Cli::LOG_.get()).assume_init_mut() };
            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
            Global::exit(1);
        }
        Err(e)
    }
}

// Kept out-of-line (not inlined into the `exec` dispatcher) so it survives as a
// distinct symbol the release link's symbol-ordering file can cluster next to the
// rest of the `bun install` startup path (PackageManager::init, lockfile diff,
// resolver/transpiler setup) — otherwise these live on unrelated 4 KB pages of
// the ~84 MB binary and get faulted in one page at a time.
#[inline(never)]
fn install(ctx: &mut ContextData) -> Result<(), Error> {
    let mut cli = CommandLineArguments::parse(Subcommand::Install)?;

    if cli.analyze {
        return analyze_dependencies_and_install(ctx, &mut cli, b"install", &mut install_with_cli);
    }

    install_with_cli(ctx, cli)
}

#[inline(never)]
fn install_with_cli(ctx: &mut ContextData, cli: CommandLineArguments) -> Result<(), Error> {
    let subcommand: Subcommand = if cli.positionals.len() > 1 {
        Subcommand::Add
    } else {
        Subcommand::Install
    };

    // TODO(dylan-conway): print `bun install <version>` or `bun add <version>` before logs from `init`.
    // and cleanup install/add subcommand usage
    let (manager, original_cwd) = PackageManager::init(&mut *ctx, cli, Subcommand::Install)?;

    // switch to `bun add <package>`
    if subcommand == Subcommand::Add {
        manager.subcommand = Subcommand::Add;
        if manager.options.should_print_command_name() {
            bun_core::prettyln!(
                "<r><b>bun add <r><d>v{}<r>\n",
                Global::package_json_version_with_sha,
            );
            Output::flush();
        }
        return update_package_json_and_install_with_manager(manager, &mut *ctx, &original_cwd);
    }

    if manager.options.should_print_command_name() {
        bun_core::prettyln!(
            "<r><b>bun install <r><d>v{}<r>\n",
            Global::package_json_version_with_sha,
        );
        Output::flush();
    }

    // SAFETY: `ROOT_PACKAGE_JSON_PATH` is written exactly once inside
    // `PackageManager::init` (above) on this thread; only read thereafter.
    let root_package_json_path = unsafe { ROOT_PACKAGE_JSON_PATH.read() };
    install_with_manager(manager, &mut *ctx, root_package_json_path, &original_cwd)?;

    if manager.any_failed_to_install {
        Global::exit(1);
    }

    Ok(())
}
