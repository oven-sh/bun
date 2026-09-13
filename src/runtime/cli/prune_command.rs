use bun_core::{Global, Output};
use bun_install::package_manager_real::{CommandLineArguments, PackageManager, Subcommand};

use crate::Command;

pub(crate) struct PruneCommand;

impl PruneCommand {
    pub(crate) fn exec(ctx: Command::Context) -> crate::Result<()> {
        let cli = CommandLineArguments::parse(Subcommand::Prune)?;

        // positionals[0] is "prune" itself
        if cli.positionals.len() > 1 {
            Output::err_generic(
                "bun prune does not take arguments, it always prunes the whole node_modules",
                (),
            );
            bun_core::note!("run 'bun prune --help' for more information");
            Global::exit(1);
        }

        let silent = cli.log_level.is_silent();
        let (manager, original_cwd) = match PackageManager::init(&mut *ctx, cli, Subcommand::Prune)
        {
            Ok(v) => v,
            Err(bun_install::Error::MissingPackageJSON) => {
                if !silent {
                    Output::err_generic("missing package.json, nothing to prune", ());
                }
                Global::exit(1);
            }
            Err(err) => return Err(err.into()),
        };

        if manager.options.should_print_command_name() {
            bun_core::prettyln!(
                "<r><b>bun prune <r><d>v{}<r>\n\n",
                Global::package_json_version_with_sha,
            );
            Output::flush();
        }

        bun_install::prune::prune(manager, &original_cwd).map_err(crate::Error::from)
    }
}
