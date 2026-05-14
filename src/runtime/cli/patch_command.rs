//! parse dependency of positional arg string (may include name@version for example)
//! get the precise version from the lockfile (there may be multiple)
//! copy the contents into a temp folder

use crate::cli::pm_update_package_json::update_package_json_and_install_catch_error;
use crate::command;

pub struct PatchCommand;

impl PatchCommand {
    pub fn exec(ctx: command::Context) -> Result<(), bun_core::Error> {
        // TODO(port): verify enum path for `.patch` (PackageManager subcommand variant)
        update_package_json_and_install_catch_error(ctx, bun_install::Subcommand::Patch)?;
        Ok(())
    }
}

// ported from: src/cli/patch_command.zig
