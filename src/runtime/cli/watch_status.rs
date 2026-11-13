//! The status lines of `bun <file> --watch` on stdout, as node's `lib/internal/main/watch_mode.js`
//! prints them: `Restarting <cmd>`, `Completed running <cmd>. Waiting for file changes before
//! restarting...` and `Failed running ...`.

use bun_core::Output;

/// `<cmd>` of the status lines, quoted like `util.inspect`.
pub(crate) struct WatchStatus {
    command: Box<[u8]>,
}

impl WatchStatus {
    /// `command`: see `RunCommand::watch_command`. `bun_core::reload_process` prints `Restarting`.
    pub(crate) fn install(command: &[u8]) -> Self {
        let command = bun_core::node_inspect_quote(command).into_boxed_slice();
        let [c, r] = color("\x1b[32m");
        let mut banner =
            Vec::with_capacity(c.len() + "Restarting ".len() + command.len() + r.len() + 1);
        banner.extend_from_slice(c.as_bytes());
        banner.extend_from_slice(b"Restarting ");
        banner.extend_from_slice(&command);
        banner.extend_from_slice(r.as_bytes());
        banner.push(b'\n');
        bun_core::set_watch_restart_banner(banner.into_boxed_slice());
        Self { command }
    }

    /// The line for a run that ended. Flushed: another thread can restart the process.
    pub(crate) fn print_idle(&self, failed: bool) {
        let (verb, [c, r]) = if failed {
            ("Failed", color("\x1b[31m"))
        } else {
            ("Completed", color("\x1b[34m"))
        };
        Output::print(format_args!(
            "{c}{verb} running {}. Waiting for file changes before restarting...{r}\n",
            bstr::BStr::new(&self.command)
        ));
        Output::flush();
    }
}

/// Start and end escape of a color, or nothing when stdout has no colors.
fn color(start: &'static str) -> [&'static str; 2] {
    if Output::enable_ansi_colors_stdout() {
        [start, "\x1b[39m"]
    } else {
        ["", ""]
    }
}
