use crate::cli::why_command::WhyCommand;
use crate::command;
use bun_install::PackageManager;

pub(crate) struct PmWhyCommand;

impl PmWhyCommand {
    // TODO(port): narrow error set
    pub(crate) fn exec(
        _ctx: &command::Context,
        pm: &mut PackageManager,
        positionals: &[&[u8]],
    ) -> Result<(), bun_core::Error> {
        let ctx = command::get();
        WhyCommand::exec_from_pm(ctx, pm, positionals)?;
        Ok(())
    }
}

// ported from: src/cli/pm_why_command.zig
