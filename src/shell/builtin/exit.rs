use core::ffi::CStr;
use core::num::IntErrorKind;

use bun_jsc::SystemError;

use crate::interpreter::{Builtin, BuiltinImpl, OutKind};
use crate::{ExitCode, Yield};

#[derive(Default)]
pub struct Exit {
    pub state: State,
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Default)]
pub enum State {
    #[default]
    Idle,
    WaitingIo,
    Err,
    Done,
}

impl Exit {
    pub fn start(&mut self) -> Yield {
        let args = self.bltn().args_slice();
        match args.len() {
            0 => self.bltn().done(0),
            1 => {
                // SAFETY: args[0] is a NUL-terminated C string from argv.
                let first_arg = unsafe { CStr::from_ptr(args[0]) }.to_bytes();
                // PORT NOTE: Zig's std.fmt.parseInt operates on bytes; Rust's from_str_radix
                // needs &str. Non-ASCII bytes are InvalidCharacter in Zig anyway.
                let first_arg_str = match core::str::from_utf8(first_arg) {
                    Ok(s) => s,
                    Err(_) => return self.fail(b"exit: numeric argument required\n"),
                };
                let exit_code: ExitCode = match u8::from_str_radix(first_arg_str, 10) {
                    Ok(v) => v,
                    Err(err) => match err.kind() {
                        IntErrorKind::PosOverflow | IntErrorKind::NegOverflow => {
                            match usize::from_str_radix(first_arg_str, 10) {
                                Ok(v) => u8::try_from(v % 256).unwrap(),
                                Err(_) => {
                                    return self.fail(b"exit: numeric argument required\n");
                                }
                            }
                        }
                        _ => return self.fail(b"exit: numeric argument required\n"),
                    },
                };
                self.bltn().done(exit_code)
            }
            _ => self.fail(b"exit: too many arguments\n"),
        }
    }

    fn fail(&mut self, msg: &[u8]) -> Yield {
        if let Some(safeguard) = self.bltn().stderr.needs_io() {
            self.state = State::WaitingIo;
            // TODO(port): borrowck — `self` aliases `self.bltn()`; Phase B may need raw-ptr reshape.
            return self.bltn().stderr.enqueue(self, msg, safeguard);
        }
        let _ = self.bltn().write_no_io(OutKind::Stderr, msg);
        self.bltn().done(1)
    }

    pub fn next(&mut self) -> Yield {
        match self.state {
            State::Idle => crate::unreachable_state("Exit.next", "idle"),
            State::WaitingIo => Yield::Suspended,
            State::Err => self.bltn().done(1),
            State::Done => self.bltn().done(1),
        }
    }

    pub fn on_io_writer_chunk(&mut self, _: usize, maybe_e: Option<SystemError>) -> Yield {
        debug_assert!(self.state == State::WaitingIo);
        if let Some(_e) = maybe_e {
            // `e.deref()` handled by Drop on SystemError.
            self.state = State::Err;
            return self.next();
        }
        self.state = State::Done;
        self.next()
    }

    // Zig `deinit` was a no-op; no Drop impl needed.

    #[inline]
    pub fn bltn(&mut self) -> &mut Builtin {
        // SAFETY: `self` is the `exit` field of a `BuiltinImpl`, which is the `impl_` field
        // of a `Builtin`. Mirrors Zig's nested @fieldParentPtr.
        unsafe {
            let impl_ptr = (self as *mut Self as *mut u8)
                .sub(core::mem::offset_of!(BuiltinImpl, exit))
                .cast::<BuiltinImpl>();
            &mut *(impl_ptr as *mut u8)
                .sub(core::mem::offset_of!(Builtin, impl_))
                .cast::<Builtin>()
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/exit.zig (90 lines)
//   confidence: medium
//   todos:      1
//   notes:      bltn() uses @fieldParentPtr; enqueue(self, ...) will need borrowck reshape; Builtin/BuiltinImpl/OutKind paths are guesses pending interpreter.rs.
// ──────────────────────────────────────────────────────────────────────────
