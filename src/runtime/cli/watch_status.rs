//! The status lines of `bun <file> --watch`, as node's watch mode prints them
//! (`lib/internal/main/watch_mode.js`): `Restarting <cmd>` on every restart, and
//! `Completed running <cmd>. Waiting for file changes before restarting...` (or
//! `Failed running ...`) when the run's event loop drains. They go to stdout.
//! `--hot`, `bun test --watch` and `bun build --watch` print none of them.

use bun_core::Output;

/// `<cmd>` of the status lines: the script as typed and its arguments, joined by spaces and quoted
/// like `util.inspect`, which is what node prints.
pub(crate) struct WatchStatus {
    command: Box<[u8]>,
}

impl WatchStatus {
    /// Builds the command text and hands the `Restarting` line to `bun_core::reload_process`,
    /// which prints it on every restart. `script` is the positional as typed.
    pub(crate) fn install(script: &[u8], args: &[Box<[u8]>]) -> Self {
        let mut joined = script.to_vec();
        for arg in args {
            joined.push(b' ');
            joined.extend_from_slice(arg);
        }
        let command = inspect_quote(&joined).into_boxed_slice();
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

    /// The line for a run that ended: `Failed` (red) when the run set a non-zero exit code or had an
    /// uncaught error, else `Completed` (blue). Flushes, so the line is not lost in this thread's
    /// buffer when another thread restarts the process.
    pub(crate) fn print_idle(&self, failed: bool) {
        let (verb, [c, r]) = if failed {
            ("Failed", color("\x1b[31m"))
        } else {
            ("Completed", color("\x1b[34m"))
        };
        Output::print(format_args!(
            "{c}{verb} running {}{r}. Waiting for file changes before restarting...\n",
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

/// Quotes `s` as `util.inspect` quotes a string (`strEscape` in node's `lib/internal/util/inspect.js`):
/// single quotes unless the text has them, then double quotes, then backticks. Escapes the control
/// characters U+0000 to U+001F and U+007F to U+009F. Bytes that are not UTF-8 pass through.
fn inspect_quote(s: &[u8]) -> Vec<u8> {
    let has_single = bun_core::strings::contains_char(s, b'\'');
    let has_double = bun_core::strings::contains_char(s, b'"');
    let has_backtick =
        bun_core::strings::contains_char(s, b'`') || bun_core::strings::contains(s, b"${");
    let quote = if !has_single {
        b'\''
    } else if !has_double {
        b'"'
    } else if !has_backtick {
        b'`'
    } else {
        b'\''
    };
    let mut out = Vec::with_capacity(s.len() + 2);
    out.push(quote);
    let mut i = 0;
    while i < s.len() {
        let b = s[i];
        i += 1;
        match b {
            b'\\' => out.extend_from_slice(b"\\\\"),
            0x08 => out.extend_from_slice(b"\\b"),
            b'\t' => out.extend_from_slice(b"\\t"),
            b'\n' => out.extend_from_slice(b"\\n"),
            0x0c => out.extend_from_slice(b"\\f"),
            b'\r' => out.extend_from_slice(b"\\r"),
            b if b == quote => {
                out.push(b'\\');
                out.push(b);
            }
            // U+0080 to U+009F are the two bytes C2 80 to C2 9F.
            0xc2 if matches!(s.get(i), Some(0x80..=0x9f)) => {
                push_hex_escape(&mut out, s[i]);
                i += 1;
            }
            0x00..=0x1f | 0x7f => push_hex_escape(&mut out, b),
            b => out.push(b),
        }
    }
    out.push(quote);
    out
}

fn push_hex_escape(out: &mut Vec<u8>, code: u8) {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    out.extend_from_slice(b"\\x");
    out.push(HEX[(code >> 4) as usize]);
    out.push(HEX[(code & 0xf) as usize]);
}
