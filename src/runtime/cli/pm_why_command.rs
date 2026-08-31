use crate::cli::why_command::WhyCommand;
use bun_install::PackageManager;

pub(crate) struct PmWhyCommand;

impl PmWhyCommand {
    pub(crate) fn exec(pm: &mut PackageManager, positionals: &[&[u8]]) -> Result<(), crate::Error> {
        WhyCommand::exec_from_pm(pm, positionals)?;
        Ok(())
    }
}
