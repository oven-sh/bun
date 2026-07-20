use crate::cli::command::Context;
use crate::cli::pm_update_package_json::update_package_json_and_install_catch_error;
use bun_install::package_manager::Subcommand;

pub(crate) struct RemoveCommand;

impl RemoveCommand {
    pub(crate) fn exec(ctx: Context) -> Result<(), crate::Error> {
        update_package_json_and_install_catch_error(ctx, Subcommand::Remove)?;
        Ok(())
    }
}
