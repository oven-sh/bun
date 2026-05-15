use crate::cli::command::Context;
use crate::cli::pm_update_package_json::update_package_json_and_install_catch_error;
use bun_install::package_manager::Subcommand;

pub struct RemoveCommand;

impl RemoveCommand {
    pub fn exec(ctx: Context) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        update_package_json_and_install_catch_error(ctx, Subcommand::Remove)?;
        Ok(())
    }
}

// ported from: src/cli/remove_command.zig
