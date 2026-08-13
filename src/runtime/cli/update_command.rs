use bun_install::package_manager_real::Subcommand;
use bun_install::package_manager_real::command_line_arguments::CommandLineArguments;

use crate::cli::pm_update_package_json::update_package_json_and_install_catch_error;
use crate::cli::update_interactive_command::UpdateInteractiveCommand;
use crate::command::Context;

pub(crate) struct UpdateCommand;

impl UpdateCommand {
    pub(crate) fn exec(ctx: Context) -> Result<(), crate::Error> {
        let cli = CommandLineArguments::parse(Subcommand::Update)?;

        if cli.interactive {
            UpdateInteractiveCommand::exec(ctx)?;
        } else {
            update_package_json_and_install_catch_error(ctx, Subcommand::Update)?;
        }
        Ok(())
    }
}
