use core::ffi::{c_char, CStr};
use core::mem::offset_of;

use bun_str::strings;
use crate::shell::{ExitCode, Yield};
// TODO(port): Builtin / Builtin::Impl are nested types under Interpreter in Zig; adjust path in Phase B
use crate::interpreter::{Builtin, BuiltinImpl};

bun_output::declare_scope!(echo, hidden);

pub struct Echo {
    /// Should be allocated with the arena from Builtin
    // PERF(port): Zig used the Builtin arena allocator here; using global Vec<u8> for now — profile in Phase B
    pub output: Vec<u8>,

    pub state: State,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum State {
    Idle,
    Waiting,
    WaitingWriteErr,
    Done,
}

impl Default for State {
    fn default() -> Self {
        State::Idle
    }
}

impl Echo {
    pub fn start(&mut self) -> Yield {
        let mut args = self.bltn().args_slice();

        // Parse flags: echo accepts -n, -e, -E in any combination.
        // Flag parsing stops at the first arg that doesn't start with '-'
        // or contains an invalid flag character.
        let mut no_newline = false;
        let mut escape_sequences = false;
        let mut flags_done = false;
        let mut args_start: usize = 0;

        for arg in args.iter() {
            if flags_done {
                break;
            }
            // SAFETY: args_slice() yields NUL-terminated C strings
            let flag = unsafe { CStr::from_ptr(*arg as *const c_char) }.to_bytes();
            if flag.len() < 2 || flag[0] != b'-' {
                flags_done = true;
                break;
            }
            // Validate all characters are valid echo flags
            let mut valid = true;
            for &c in &flag[1..] {
                match c {
                    b'n' | b'e' | b'E' => {}
                    _ => {
                        valid = false;
                        break;
                    }
                }
            }
            if !valid {
                flags_done = true;
                break;
            }
            // Apply flags (last -e/-E wins)
            for &c in &flag[1..] {
                match c {
                    b'n' => no_newline = true,
                    b'e' => escape_sequences = true,
                    b'E' => escape_sequences = false,
                    _ => unreachable!(),
                }
            }
            args_start += 1;
        }

        args = &args[args_start..];
        let args_len = args.len();
        let mut has_leading_newline: bool = false;
        let mut stop_output = false;

        // TODO: Should flush buffer after it gets to a certain size
        for (i, arg) in args.iter().enumerate() {
            if stop_output {
                break;
            }
            // SAFETY: args_slice() yields NUL-terminated C strings
            let thearg = unsafe { CStr::from_ptr(*arg as *const c_char) }.to_bytes();
            let is_last = i == args_len - 1;

            if escape_sequences {
                stop_output = append_with_escapes(&mut self.output, thearg);
            } else {
                if is_last {
                    if !thearg.is_empty() && thearg[thearg.len() - 1] == b'\n' {
                        has_leading_newline = true;
                    }
                    self.output
                        .extend_from_slice(strings::trim_subsequent_leading_chars(thearg, b'\n'));
                } else {
                    self.output.extend_from_slice(thearg);
                }
            }

            if !stop_output && !is_last {
                self.output.push(b' ');
            }
        }

        if !stop_output && !has_leading_newline && !no_newline {
            self.output.push(b'\n');
        }

        if let Some(safeguard) = self.bltn().stdout.needs_io() {
            self.state = State::Waiting;
            // TODO(port): borrowck — bltn()/enqueue() take &mut self while &self.output is borrowed; reshape API in Phase B
            return self.bltn().stdout.enqueue(self, &self.output, safeguard);
        }
        // TODO(port): borrowck — bltn() overlaps &self.output; reshape API in Phase B
        // TODO(port): `BuiltinFd::Stdout` is a placeholder for the Rust stdout selector once Builtin is ported
        let _ = self.bltn().write_no_io(BuiltinFd::Stdout, &self.output);
        self.state = State::Done;
        self.bltn().done(0)
    }

    pub fn on_io_writer_chunk(&mut self, _: usize, e: Option<bun_jsc::SystemError>) -> Yield {
        if cfg!(debug_assertions) {
            debug_assert!(self.state == State::Waiting || self.state == State::WaitingWriteErr);
        }

        if let Some(err) = e {
            let errno = err.get_errno();
            err.deref();
            return self.bltn().done(errno);
        }

        self.state = State::Done;
        // PORT NOTE: faithful port — Zig sets state=.done then checks ==.waiting_write_err (always false)
        let exit_code: ExitCode = if self.state == State::WaitingWriteErr { 1 } else { 0 };
        self.bltn().done(exit_code)
    }

    #[inline]
    pub fn bltn(&mut self) -> &mut Builtin {
        // SAFETY: self points to the `echo` field of a Builtin::Impl, which is the `impl` field of a Builtin
        unsafe {
            let impl_ptr = (self as *mut Echo as *mut u8)
                .sub(offset_of!(BuiltinImpl, echo))
                .cast::<BuiltinImpl>();
            &mut *(impl_ptr as *mut u8)
                .sub(offset_of!(Builtin, r#impl))
                .cast::<Builtin>()
        }
    }
}

impl Drop for Echo {
    fn drop(&mut self) {
        bun_output::scoped_log!(echo, "({}) deinit", "echo");
        // self.output is dropped automatically
    }
}

/// Appends `input` to `output`, interpreting backslash escape sequences.
/// Returns true if a \c escape was encountered (meaning stop all output).
fn append_with_escapes(output: &mut Vec<u8>, input: &[u8]) -> bool {
    let mut i: usize = 0;
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
                    i += 2; // skip \0
                    let mut val: u8 = 0;
                    let mut digits: usize = 0;
                    while digits < 3 && i < input.len() && input[i] >= b'0' && input[i] <= b'7' {
                        val = val.wrapping_mul(8).wrapping_add(input[i] - b'0');
                        i += 1;
                        digits += 1;
                    }
                    output.push(val);
                }
                b'x' => {
                    // \xHH: hex value (up to 2 hex digits)
                    i += 2; // skip \x
                    let mut val: u8 = 0;
                    let mut digits: usize = 0;
                    while digits < 2 && i < input.len() {
                        if let Some(hv) = hex_digit_value(input[i]) {
                            val = val.wrapping_mul(16).wrapping_add(hv);
                            i += 1;
                            digits += 1;
                        } else {
                            break;
                        }
                    }
                    if digits > 0 {
                        output.push(val);
                    } else {
                        // No valid hex digits: output \x literally
                        output.extend_from_slice(b"\\x");
                    }
                }
                _ => {
                    // Unknown escape: output backslash and the character as-is
                    output.push(b'\\');
                    output.push(input[i + 1]);
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

fn hex_digit_value(c: u8) -> Option<u8> {
    if c >= b'0' && c <= b'9' {
        return Some(c - b'0');
    }
    if c >= b'a' && c <= b'f' {
        return Some(c - b'a' + 10);
    }
    if c >= b'A' && c <= b'F' {
        return Some(c - b'A' + 10);
    }
    None
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/echo.zig (239 lines)
//   confidence: medium
//   todos:      3
//   notes:      bltn() @fieldParentPtr chain + Builtin stdout/enqueue API need Phase-B borrowck reshaping; output Vec was arena-backed in Zig
// ──────────────────────────────────────────────────────────────────────────
