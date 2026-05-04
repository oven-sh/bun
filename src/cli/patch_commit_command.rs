use bun_cli::command;
use bun_install::package_manager::update_package_json_and_install_catch_error;
// TODO(port): confirm the exact enum type/path for the subcommand tag (`.@"patch-commit"` in Zig).
use bun_install::package_manager::Subcommand;

pub struct PatchCommitCommand;

impl PatchCommitCommand {
    pub fn exec(ctx: command::Context) -> Result<(), bun_core::Error> {
        update_package_json_and_install_catch_error(ctx, Subcommand::PatchCommit)?;
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/patch_commit_command.zig (11 lines)
//   confidence: medium
//   todos:      1
//   notes:      enum literal `.@"patch-commit"` mapped to Subcommand::PatchCommit — verify enum name/path in Phase B
// ──────────────────────────────────────────────────────────────────────────
