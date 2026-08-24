use bun_core::{Global, Output};
use bun_install::package_manager_real::{
    CommandLineArguments, PackageManager, Subcommand, install_with_manager, root_package_json_path,
};

use crate::Command;
use crate::cli::install_command::InstallCommand;

pub(crate) struct DedupeCommand;

impl DedupeCommand {
    pub(crate) fn exec(ctx: Command::Context) -> crate::Result<()> {
        let cli = CommandLineArguments::parse(Subcommand::Dedupe)?;

        // positionals[0] is "dedupe" itself
        if cli.positionals.len() > 1 {
            Output::err_generic(
                "bun dedupe does not take arguments, it always deduplicates the whole lockfile",
                (),
            );
            bun_core::note!("run 'bun dedupe --help' for more information");
            Global::exit(1);
        }

        let (manager, original_cwd) = match PackageManager::init(&mut *ctx, cli, Subcommand::Dedupe)
        {
            Ok(v) => v,
            Err(bun_install::Error::MissingPackageJSON) => {
                Output::err_generic("missing package.json, nothing to dedupe", ());
                Global::exit(1);
            }
            Err(err) => return Err(err.into()),
        };

        if manager.options.should_print_command_name() {
            bun_core::prettyln!(
                "<r><b>bun dedupe <r><d>v{}<r>\n",
                Global::package_json_version_with_sha,
            );
            Output::flush();
        }

        let root_package_json_path = root_package_json_path();
        if let Err(e) =
            install_with_manager(manager, &mut *ctx, root_package_json_path, &original_cwd)
        {
            return InstallCommand::handle_error(ctx, crate::Error::from(e));
        }

        if manager.any_failed_to_install {
            Global::exit(1);
        }

        Ok(())
    }
}
