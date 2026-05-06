use crate::cli::command::Context;
use bun_install::package_manager::Subcommand;
use bun_install::package_manager_real::update_package_json_and_install::update_package_json_and_install_catch_error;

pub struct RemoveCommand;

impl RemoveCommand {
    pub fn exec(ctx: Context) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        update_package_json_and_install_catch_error(ctx, Subcommand::Remove)?;
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/remove_command.zig (11 lines)
//   confidence: high
//   todos:      1
//   notes:      thin wrapper; Subcommand enum variant name (.remove) assumed from bun_install
// ──────────────────────────────────────────────────────────────────────────
