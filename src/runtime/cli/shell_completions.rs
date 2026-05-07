use bun_core::Output;
use bun_paths;

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
    // PORT NOTE: Zig used `@embedFile("completions-bash")` etc. via build-system
    // module aliases. The actual files live at `<repo>/completions/bun.{bash,zsh,fish}`.
    const BASH_COMPLETIONS: &'static [u8] = include_bytes!("../../../completions/bun.bash");
    const ZSH_COMPLETIONS: &'static [u8] = include_bytes!("../../../completions/bun.zsh");
    const FISH_COMPLETIONS: &'static [u8] = include_bytes!("../../../completions/bun.fish");

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
// PORT NOTE: Zig fields are `[]const []const u8` (borrowed views into either a
// stack array or arena-allocated storage). `Cow` lets `RunCommand::completions`
// hand back arena-backed `'static` borrows while `bun_getcompletes` supplies an
// owned `Vec` for the `a` (add-completions) branch — no `Box::leak`.
pub struct ShellCompletions {
    pub commands: std::borrow::Cow<'static, [&'static [u8]]>,
    pub descriptions: std::borrow::Cow<'static, [&'static [u8]]>,
    pub flags: std::borrow::Cow<'static, [&'static [u8]]>,
    pub shell: Shell,
}

impl Default for ShellCompletions {
    fn default() -> Self {
        Self {
            commands: std::borrow::Cow::Borrowed(&[]),
            descriptions: std::borrow::Cow::Borrowed(&[]),
            flags: std::borrow::Cow::Borrowed(&[]),
            shell: Shell::default(),
        }
    }
}

impl ShellCompletions {
    pub fn print(&self) {
        let _flush = scopeguard::guard((), |_| Output::flush());
        // SAFETY: Output::writer() returns a process-lifetime *mut io::Writer
        // (thread-local Source storage); the deref lives for this fn body only.
        let writer = unsafe { &mut *Output::writer() };

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
