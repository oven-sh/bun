use crate::command::Context as CommandContext;
use crate::why_command::WhyCommand;
use bun_install::PackageManager;

pub struct PmWhyCommand;

impl PmWhyCommand {
    // TODO(port): narrow error set
    pub fn exec(
        ctx: CommandContext,
        pm: &mut PackageManager,
        positionals: &[&[u8]],
    ) -> Result<(), bun_core::Error> {
        WhyCommand::exec_from_pm(ctx, pm, positionals)?;
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/pm_why_command.zig (12 lines)
//   confidence: high
//   todos:      1
//   notes:      thin delegating wrapper; Command.Context mapped to crate::command::Context
// ──────────────────────────────────────────────────────────────────────────
