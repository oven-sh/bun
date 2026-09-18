//! parse dependency of positional arg string (may include name@version for example)
//! get the precise version from the lockfile (there may be multiple)
//! copy the contents into a temp folder

use crate::cli::pm_update_package_json::update_package_json_and_install_catch_error;
use crate::command;

pub(crate) struct PatchCommand;

impl PatchCommand {
    pub(crate) fn exec(ctx: command::Context) -> Result<(), crate::Error> {
        update_package_json_and_install_catch_error(ctx, bun_install::Subcommand::Patch)?;
        Ok(())
    }
}
