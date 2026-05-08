use crate::cli::command;
use crate::cli::pm_update_package_json::update_package_json_and_install_catch_error;
use bun_install::package_manager::{PackageManager, Subcommand};

pub struct AddCommand;

impl AddCommand {
    pub fn exec(ctx: command::Context) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        update_package_json_and_install_catch_error(ctx, Subcommand::Add)?;
        Ok(())
    }
}

// ported from: src/cli/add_command.zig
