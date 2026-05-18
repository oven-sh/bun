use crate::cli::command;
use crate::cli::pm_update_package_json::update_package_json_and_install_catch_error;
use bun_install::package_manager::Subcommand;

pub struct PatchCommitCommand;

impl PatchCommitCommand {
    pub fn exec(ctx: command::Context) -> Result<(), bun_core::Error> {
        update_package_json_and_install_catch_error(ctx, Subcommand::PatchCommit)?;
        Ok(())
    }
}

// ported from: src/cli/patch_commit_command.zig
