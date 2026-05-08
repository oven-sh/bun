use crate::cli::why_command::WhyCommand;
use crate::command;
use bun_install::PackageManager;

pub struct PmWhyCommand;

impl PmWhyCommand {
    // TODO(port): narrow error set
    pub fn exec(
        _ctx: &command::Context,
        pm: &mut PackageManager,
        positionals: &[&[u8]],
    ) -> Result<(), bun_core::Error> {
        // PORT NOTE: Zig `Command.Context` is `*ContextData` (a freely-aliased
        // raw pointer). `bun pm` dispatch threads it here as `&Command::Context`,
        // but `WhyCommand::exec_from_pm` needs `&mut Command::Context` to reach
        // `ctx.log`. Reacquire the process-global handle (same pointee,
        // single-threaded CLI startup) rather than unsafely reborrowing `_ctx`.
        let ctx = command::get();
        WhyCommand::exec_from_pm(ctx, pm, positionals)?;
        Ok(())
    }
}

// ported from: src/cli/pm_why_command.zig
