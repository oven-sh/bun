use crate::cli::command;
use crate::cli::pm_update_package_json::update_package_json_and_install_catch_error;
use bun_install::package_manager::{CommandLineArguments, Subcommand};

pub(crate) struct PatchCommitCommand;

impl PatchCommitCommand {
    pub(crate) fn exec(ctx: command::Context) -> Result<(), crate::Error> {
        let cli = CommandLineArguments::parse(Subcommand::PatchCommit)?;
        update_package_json_and_install_catch_error(ctx, Subcommand::PatchCommit, cli)
    }
}
