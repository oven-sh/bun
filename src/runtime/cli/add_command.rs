use crate::cli::command;
use crate::cli::pm_update_package_json::update_package_json_and_install_catch_error;
use bun_install::package_manager::Subcommand;

pub(crate) struct AddCommand;

impl AddCommand {
    pub(crate) fn exec(ctx: command::Context) -> Result<(), crate::Error> {
        update_package_json_and_install_catch_error(ctx, Subcommand::Add)?;
        Ok(())
    }
}
