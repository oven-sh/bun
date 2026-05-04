use bun_cli::command;
use bun_install::package_manager::{self, PackageManager, Subcommand};

pub struct AddCommand;

impl AddCommand {
    pub fn exec(ctx: command::Context) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        package_manager::update_package_json_and_install_catch_error(ctx, Subcommand::Add)?;
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/add_command.zig (11 lines)
//   confidence: high
//   todos:      1
//   notes:      `.add` enum literal mapped to Subcommand::Add — verify variant name in bun_install.
// ──────────────────────────────────────────────────────────────────────────
