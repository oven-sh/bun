#[allow(unused_imports)]
use bun_install::package_manager::Subcommand;

use crate::cli::update_interactive_command::UpdateInteractiveCommand;
use crate::command::Context;

pub struct UpdateCommand;

impl UpdateCommand {
    pub fn exec(ctx: Context) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        // PORT NOTE: dropped `ctx.allocator` arg — global mimalloc per §Allocators.
        //
        // `CommandLineArguments` and `update_package_json_and_install_catch_error`
        // live in `bun_install::package_manager_real` which is currently gated
        // `bun_install::package_manager` module only re-exports
        // `PackageManager` + `Subcommand`. Until that crate ungates, the body
        // below mirrors update_command.zig:2-10 against todo!() stand-ins.
        let interactive: bool =
            todo!("blocked_on: bun_install::package_manager::CommandLineArguments");

        #[allow(unreachable_code)]
        if interactive {
            UpdateInteractiveCommand::exec(ctx)?;
        } else {
            let _ = Subcommand::Update;
            todo!("blocked_on: bun_install::package_manager::update_package_json_and_install_catch_error");
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
