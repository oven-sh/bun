use crate::Error;
use bun_core::{Global, Output};
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
        install(ctx).or_else(Self::handle_error)
    }

    /// Out of line, so that the hot `bun install` dispatch in `exec` stays small in `.text`.
    #[cold]
    #[inline(never)]
    pub(crate) fn handle_error(e: Error) -> Result<(), Error> {
        if matches!(
            e,
            crate::Error::Install(
                bun_install::Error::InstallFailed | bun_install::Error::InvalidPackageJSON
            )
        ) {
            // SAFETY: `Cli::start()` initialised `Cli::LOG_`; no other `&mut` to it is live here.
            let log = unsafe { (*Cli::LOG_.get()).assume_init_mut() };
            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
            Global::exit(1);
        }
        Err(e)
    }
}

// A symbol of its own, which the link's symbol-ordering file puts next to the rest of the startup path.
#[inline(never)]
fn install(ctx: &mut ContextData) -> Result<(), Error> {
    let mut cli = CommandLineArguments::parse(Subcommand::Install)?;

    if cli.analyze {
        return analyze_dependencies_and_install(ctx, &mut cli, b"install", &mut install_with_cli);
    }

    install_with_cli(ctx, &cli)
}

#[inline(never)]
fn install_with_cli(ctx: &mut ContextData, cli: &CommandLineArguments) -> Result<(), Error> {
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
        return update_package_json_and_install_with_manager(manager, &mut *ctx, &original_cwd)
            .map_err(Into::into);
    }

    if manager.options.should_print_command_name() {
        bun_core::prettyln!(
            "<r><b>bun install <r><d>v{}<r>\n",
            Global::package_json_version_with_sha,
        );
        Output::flush();
    }

    // SAFETY: written once, inside `PackageManager::init` (above) on this thread; only read thereafter.
    let root_package_json_path = unsafe { ROOT_PACKAGE_JSON_PATH.read() };
    install_with_manager(manager, &mut *ctx, root_package_json_path, &original_cwd)?;

    if manager.any_failed_to_install {
        Global::exit(1);
    }

    Ok(())
}
