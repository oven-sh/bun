use bun_install::package_manager::{
    update_package_json_and_install_catch_error, CommandLineArguments, Subcommand,
};

use crate::command::Context;
use crate::update_interactive_command::UpdateInteractiveCommand;

pub struct UpdateCommand;

impl UpdateCommand {
    pub fn exec(ctx: Context) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let cli = CommandLineArguments::parse(Subcommand::Update)?;
        // PORT NOTE: dropped `ctx.allocator` arg — global mimalloc per §Allocators.

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
//   todos:      1
//   notes:      `.update` enum literal mapped to Subcommand::Update; verify path in bun_install.
// ──────────────────────────────────────────────────────────────────────────
