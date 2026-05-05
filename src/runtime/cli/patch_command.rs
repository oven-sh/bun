//! parse dependency of positional arg string (may include name@version for example)
//! get the precise version from the lockfile (there may be multiple)
//! copy the contents into a temp folder

use crate::command;
use bun_install::package_manager::update_package_json_and_install_catch_error;

pub struct PatchCommand;

impl PatchCommand {
    pub fn exec(ctx: command::Context) -> Result<(), bun_core::Error> {
        // TODO(port): verify enum path for `.patch` (PackageManager subcommand variant)
        update_package_json_and_install_catch_error(ctx, bun_install::Subcommand::Patch)?;
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/patch_command.zig (17 lines)
//   confidence: high
//   todos:      1
//   notes:      `.patch` enum literal — exact Rust enum path needs Phase B confirmation
// ──────────────────────────────────────────────────────────────────────────
