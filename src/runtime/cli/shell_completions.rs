use bun_core::Output;

// here so existing `crate::cli::shell_completions::Shell` paths keep working.
pub use bun_install::ShellCompletions::Shell;

// PORT NOTE: Zig used `@embedFile("completions-bash")` etc. via build-system
// module aliases. The actual files live at `<repo>/completions/bun.{bash,zsh,fish}`.
// The embedded script bodies must stay above the install tier (asset dependency),
// so `completions()` is an extension trait on the re-exported enum rather than an
// inherent method.
const BASH_COMPLETIONS: &[u8] = include_bytes!("../../../completions/bun.bash");
const ZSH_COMPLETIONS: &[u8] = include_bytes!("../../../completions/bun.zsh");
const FISH_COMPLETIONS: &[u8] = include_bytes!("../../../completions/bun.fish");

pub trait ShellCompletionsExt {
    fn completions(self) -> &'static [u8];
}

impl ShellCompletionsExt for Shell {
    fn completions(self) -> &'static [u8] {
        match self {
            Shell::Bash => BASH_COMPLETIONS,
            Shell::Zsh => ZSH_COMPLETIONS,
            Shell::Fish => FISH_COMPLETIONS,
            _ => b"",
        }
    }
}

// File-level `@This()` struct.
// PORT NOTE: Zig fields are `[]const []const u8` (borrowed views into either a
// stack array or arena-allocated storage). `Cow` lets `RunCommand::completions`
// hand back arena-backed `'static` borrows while `bun_getcompletes` supplies an
// owned `Vec` for the `a` (add-completions) branch — no leaking.
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
        let _flush = Output::flush_guard();
        // SAFETY: Output::writer() returns a process-lifetime *mut io::Writer
        // (thread-local Source storage); the deref lives for this fn body only.
        let writer = unsafe { &mut *Output::writer() };

        if self.commands.is_empty() {
            return;
        }
        let delimiter: &[u8] = if self.shell == Shell::Fish {
            b" "
        } else {
            b"\n"
        };

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

// ported from: src/cli/shell_completions.zig
