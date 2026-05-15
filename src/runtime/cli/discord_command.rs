use crate::cli::open;

pub struct DiscordCommand;

impl DiscordCommand {
    const DISCORD_URL: &'static [u8] = b"https://bun.com/discord";

    // TODO(port): narrow error set — body has no fallible calls; `!void` only matches CLI command signature
    pub fn exec() -> Result<(), bun_core::Error> {
        open::open_url(Self::DISCORD_URL);
        Ok(())
    }
}

// ported from: src/cli/discord_command.zig
