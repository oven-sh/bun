use crate::open;

pub struct DiscordCommand;

impl DiscordCommand {
    const DISCORD_URL: &'static str = "https://bun.com/discord";

    // TODO(port): narrow error set — body has no fallible calls; `!void` only matches CLI command signature
    pub fn exec() -> Result<(), bun_core::Error> {
        open::open_url(Self::DISCORD_URL);
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/discord_command.zig (10 lines)
//   confidence: high
//   todos:      1
//   notes:      allocator param dropped; open_url signature (&str vs &[u8]) to be confirmed in Phase B
// ──────────────────────────────────────────────────────────────────────────
