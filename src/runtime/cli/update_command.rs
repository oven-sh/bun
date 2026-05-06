use bun_install::package_manager_real::command_line_arguments::CommandLineArguments;
use bun_install::package_manager_real::{update_package_json_and_install_catch_error, Subcommand};

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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/update_command.zig (18 lines)
//   confidence: high
//   todos:      0
//   notes:      `.update` enum literal mapped to `package_manager_real::Subcommand::Update`.
// ──────────────────────────────────────────────────────────────────────────
