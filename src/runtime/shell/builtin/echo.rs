use core::ffi::CStr;

use crate::shell::builtin::{Builtin, BuiltinState, IoKind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Echo {
    /// The fully-rendered output (joined argv + optional trailing newline).
    /// Kept on the state so the async IOWriter path can borrow it across
    /// yields.
    pub output: Vec<u8>,
    state: State,
}

#[derive(Default)]
enum State {
    #[default]
    Idle,
    WaitingIo,
    Done,
}

impl Echo {
    pub fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let output = {
            let bltn = Builtin::of(interp, cmd);
            let argc = bltn.args_slice().len();

            // Parse flags: echo accepts -n, -e, -E in any combination.
            // Flag parsing stops at the first arg that doesn't start with '-'
            // or contains an invalid flag character.
            let mut no_newline = false;
            let mut escape_sequences = false;
            let mut args_start = 0usize;
            for i in 0..argc {
                let flag = bltn.arg_bytes(i);
                if flag.len() < 2 || flag[0] != b'-' {
                    break;
                }
                if !flag[1..].iter().all(|c| matches!(c, b'n' | b'e' | b'E')) {
                    break;
                }
                for c in &flag[1..] {
                    match c {
                        b'n' => no_newline = true,
                        b'e' => escape_sequences = true,
                        b'E' => escape_sequences = false,
                        _ => unreachable!(),
                    }
                }
                args_start += 1;
            }

            let args_len = argc - args_start;
            let mut out = Vec::new();
            let mut has_leading_newline = false;
            let mut stop_output = false;

            for i in 0..args_len {
                if stop_output {
                    break;
                }
                let thearg = bltn.arg_bytes(args_start + i);
                let is_last = i == args_len - 1;

                if escape_sequences {
                    stop_output = append_with_escapes(&mut out, thearg);
                } else if is_last {
                    if thearg.last() == Some(&b'\n') {
                        has_leading_newline = true;
                    }
                    // Collapse repeated trailing '\n' to a single one
                    // (matches bun.strings.trimSubsequentLeadingChars).
                    let mut end = thearg.len();
                    while end > 1 && thearg[end - 1] == b'\n' && thearg[end - 2] == b'\n' {
                        end -= 1;
                    }
                    out.extend_from_slice(&thearg[..end]);
                } else {
                    out.extend_from_slice(thearg);
                }

                if !stop_output && !is_last {
                    out.push(b' ');
                }
            }

            if !stop_output && !has_leading_newline && !no_newline {
                out.push(b'\n');
            }
            out
        };
        Self::state_mut(interp, cmd).output = output;

        if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
            Self::state_mut(interp, cmd).state = State::WaitingIo;
            let buf = Self::state_mut(interp, cmd).output.clone();
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd)
                .stdout
                .enqueue(child, &buf, safeguard);
        }
        let buf = Self::state_mut(interp, cmd).output.clone();
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &buf);
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, 0)
    }

    pub fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(
            interp,
            cmd,
            err.map(|e| e.errno as crate::shell::ExitCode).unwrap_or(0),
        )
    }
}

/// Appends `input` to `output`, interpreting backslash escape sequences.
/// Returns true if a `\c` escape was encountered (meaning stop all output).
fn append_with_escapes(output: &mut Vec<u8>, input: &[u8]) -> bool {
    let mut i = 0usize;
    while i < input.len() {
        if input[i] == b'\\' && i + 1 < input.len() {
            match input[i + 1] {
                b'\\' => {
                    output.push(b'\\');
                    i += 2;
                }
                b'a' => {
                    output.push(0x07);
                    i += 2;
                }
                b'b' => {
                    output.push(0x08);
                    i += 2;
                }
                b'c' => {
                    // \c: produce no further output
                    return true;
                }
                b'e' | b'E' => {
                    output.push(0x1b);
                    i += 2;
                }
                b'f' => {
                    output.push(0x0c);
                    i += 2;
                }
                b'n' => {
                    output.push(b'\n');
                    i += 2;
                }
                b'r' => {
                    output.push(b'\r');
                    i += 2;
                }
                b't' => {
                    output.push(b'\t');
                    i += 2;
                }
                b'v' => {
                    output.push(0x0b);
                    i += 2;
                }
                b'0' => {
                    // \0nnn: octal value (up to 3 octal digits)
                    i += 2;
                    let mut val: u8 = 0;
                    let mut digits = 0;
                    while digits < 3 && i < input.len() && (b'0'..=b'7').contains(&input[i]) {
                        val = val.wrapping_mul(8).wrapping_add(input[i] - b'0');
                        i += 1;
                        digits += 1;
                    }
                    output.push(val);
                }
                b'x' => {
                    // \xHH: hex value (up to 2 hex digits)
                    i += 2;
                    let (val, n) = bun_core::fmt::parse_hex_prefix(&input[i..], 2);
                    i += n;
                    if n > 0 {
                        output.push(val as u8);
                    } else {
                        output.extend_from_slice(b"\\x");
                    }
                }
                other => {
                    output.push(b'\\');
                    output.push(other);
                    i += 2;
                }
            }
        } else {
            output.push(input[i]);
            i += 1;
        }
    }
    false
}
