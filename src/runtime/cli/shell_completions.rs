use bun_core::Output;
use bun_paths;
use bun_str::strings;

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Default)]
pub enum Shell {
    #[default]
    Unknown,
    Bash,
    Zsh,
    Fish,
    Pwsh,
}

impl Shell {
    // TODO(port): @embedFile uses build-system module aliases ("completions-bash" etc.);
    // Phase B must wire the real relative paths or a build.rs OUT_DIR include.
    const BASH_COMPLETIONS: &'static [u8] = include_bytes!("completions-bash");
    const ZSH_COMPLETIONS: &'static [u8] = include_bytes!("completions-zsh");
    const FISH_COMPLETIONS: &'static [u8] = include_bytes!("completions-fish");

    pub fn completions(self) -> &'static [u8] {
        match self {
            Shell::Bash => Self::BASH_COMPLETIONS,
            Shell::Zsh => Self::ZSH_COMPLETIONS,
            Shell::Fish => Self::FISH_COMPLETIONS,
            _ => b"",
        }
    }

    // Zig: `fn fromEnv(comptime Type: type, SHELL: Type) Shell` — paired (comptime T, arg: T)
    // collapses to a single byte-slice param; callers pass `[]const u8`.
    pub fn from_env(shell: &[u8]) -> Shell {
        let basename = bun_paths::basename(shell);
        if basename == b"bash" {
            Shell::Bash
        } else if basename == b"zsh" {
            Shell::Zsh
        } else if basename == b"fish" {
            Shell::Fish
        } else if basename == b"pwsh" || basename == b"powershell" {
            Shell::Pwsh
        } else {
            Shell::Unknown
        }
    }
}

// File-level `@This()` struct.
// TODO(port): lifetime — fields are borrowed views (no deinit in Zig); Phase A forbids
// struct lifetime params, so using &'static. Phase B may need `<'a>`.
#[derive(Default)]
pub struct ShellCompletions {
    pub commands: &'static [&'static [u8]],
    pub descriptions: &'static [&'static [u8]],
    pub flags: &'static [&'static [u8]],
    pub shell: Shell,
}

impl ShellCompletions {
    pub fn print(&self) {
        let _flush = scopeguard::guard((), |_| Output::flush());
        let writer = Output::writer();

        if self.commands.is_empty() {
            return;
        }
        let delimiter: &[u8] = if self.shell == Shell::Fish { b" " } else { b"\n" };

        if writer.write_all(self.commands[0]).is_err() {
            return;
        }

        if !self.descriptions.is_empty() {
            if writer.write_all(b"\t").is_err() {
                return;
            }
            if writer.write_all(self.descriptions[0]).is_err() {
                return;
            }
        }

        if self.commands.len() > 1 {
            for (i, cmd) in self.commands[1..].iter().enumerate() {
                if writer.write_all(delimiter).is_err() {
                    return;
                }

                if writer.write_all(cmd).is_err() {
                    return;
                }
                if !self.descriptions.is_empty() {
                    if writer.write_all(b"\t").is_err() {
                        return;
                    }
                    if writer.write_all(self.descriptions[i]).is_err() {
                        return;
                    }
                }
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/shell_completions.zig (75 lines)
//   confidence: medium
//   todos:      2
//   notes:      @embedFile paths need build wiring; slice-of-slice fields may need <'a> in Phase B
// ──────────────────────────────────────────────────────────────────────────
