use crate::cli::why_command::WhyCommand;
use crate::command;
use bun_install::PackageManager;

pub(crate) struct PmWhyCommand;

impl PmWhyCommand {
    pub(crate) fn exec(
        _ctx: &command::Context,
        pm: &mut PackageManager,
        positionals: &[&[u8]],
    ) -> Result<(), crate::Error> {
        // Note: `bun pm` dispatch threads the context here as `&Command::Context`,
        // but `WhyCommand::exec_from_pm` needs `&mut Command::Context` to reach
        // `ctx.log`. Reacquire the process-global handle (same pointee,
        // single-threaded CLI startup) rather than unsafely reborrowing `_ctx`.
        let ctx = command::get();
        WhyCommand::exec_from_pm(ctx, pm, positionals)?;
        Ok(())
    }
}
