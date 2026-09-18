use crate::cli::open;

pub(crate) struct DiscordCommand;

impl DiscordCommand {
    const DISCORD_URL: &'static [u8] = b"https://bun.com/discord";

    // Infallible body; `Result` only matches the CLI command dispatch signature.
    pub(crate) fn exec() -> Result<(), crate::Error> {
        open::open_url(Self::DISCORD_URL);
        Ok(())
    }
}
