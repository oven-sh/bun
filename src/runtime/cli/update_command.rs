use bun_install::package_manager_real::Subcommand;
use bun_install::package_manager_real::command_line_arguments::CommandLineArguments;

use crate::cli::pm_update_package_json::update_package_json_and_install_catch_error;
use crate::cli::update_interactive_command::UpdateInteractiveCommand;
use crate::command::Context;

pub struct UpdateCommand;

impl UpdateCommand {
    pub fn exec(ctx: Context) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        // PORT NOTE: dropped `ctx.allocator` arg — global mimalloc per §Allocators.
        let cli = CommandLineArguments::parse(Subcommand::Update)?;

        if cli.interactive {
            UpdateInteractiveCommand::exec(ctx)?;
        } else {
            update_package_json_and_install_catch_error(ctx, Subcommand::Update)?;
        }
        Ok(())
    }
}

// ported from: src/cli/update_command.zig
