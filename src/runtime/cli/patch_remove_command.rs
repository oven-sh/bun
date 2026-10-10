use crate::cli::pm_update_package_json::update_package_json_and_install_catch_error;
use crate::command;

pub(crate) struct PatchRemoveCommand;

impl PatchRemoveCommand {
    pub(crate) fn exec(ctx: command::Context) -> Result<(), crate::Error> {
        update_package_json_and_install_catch_error(ctx, bun_install::Subcommand::PatchRemove)?;
        Ok(())
    }
}
