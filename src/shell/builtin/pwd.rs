use core::mem::offset_of;

use bun_jsc::SystemError;
use bun_shell::interpreter::Interpreter;
use bun_shell::Yield;

use super::Builtin;
// TODO(port): confirm exact path/name for Builtin::Impl and the stdout/stderr output-kind enum
use super::builtin::Impl as BuiltinImpl;
use super::builtin::OutputKind;

#[derive(Clone, Copy, PartialEq, Eq)]
enum WaitingIoKind {
    Stdout,
    Stderr,
}

enum State {
    Idle,
    WaitingIo { kind: WaitingIoKind },
    Err,
    Done,
}

impl Default for State {
    fn default() -> Self {
        State::Idle
    }
}

#[derive(Default)]
pub struct Pwd {
    state: State,
}

impl Pwd {
    pub fn start(&mut self) -> Yield {
        let args = self.bltn().args_slice();
        if !args.is_empty() {
            let msg: &[u8] = b"pwd: too many arguments\n";
            if let Some(safeguard) = self.bltn().stderr.needs_io() {
                self.state = State::WaitingIo { kind: WaitingIoKind::Stderr };
                return self.bltn().stderr.enqueue(self, msg, safeguard);
            }

            let _ = self.bltn().write_no_io(OutputKind::Stderr, msg);
            return self.bltn().done(1);
        }

        let cwd_str = self.bltn().parent_cmd().base.shell.cwd();
        if let Some(safeguard) = self.bltn().stdout.needs_io() {
            self.state = State::WaitingIo { kind: WaitingIoKind::Stdout };
            return self.bltn().stdout.enqueue_fmt_bltn(
                self,
                None,
                format_args!("{}\n", bstr::BStr::new(cwd_str)),
                safeguard,
            );
        }
        let buf = self
            .bltn()
            .fmt_error_arena(None, format_args!("{}\n", bstr::BStr::new(cwd_str)));

        let _ = self.bltn().write_no_io(OutputKind::Stdout, buf);

        self.state = State::Done;
        self.bltn().done(0)
    }

    pub fn next(&mut self) -> Yield {
        while !matches!(self.state, State::Err | State::Done) {
            match self.state {
                State::WaitingIo { .. } => return Yield::Suspended,
                State::Idle => panic!(
                    "Unexpected \"idle\" state in Pwd. This indicates a bug in Bun. Please file a GitHub issue."
                ),
                State::Done | State::Err => unreachable!(),
            }
        }

        match self.state {
            State::Done => self.bltn().done(0),
            State::Err => self.bltn().done(1),
            _ => unreachable!(),
        }
    }

    pub fn on_io_writer_chunk(&mut self, _: usize, e: Option<SystemError>) -> Yield {
        debug_assert!(matches!(self.state, State::WaitingIo { .. }));

        if let Some(_err) = e {
            // PORT NOTE: Zig had `defer e.?.deref()`; SystemError's Drop handles the deref.
            self.state = State::Err;
            return self.next();
        }

        self.state = match self.state {
            State::WaitingIo { kind: WaitingIoKind::Stdout } => State::Done,
            State::WaitingIo { kind: WaitingIoKind::Stderr } => State::Err,
            // SAFETY: debug_assert above guarantees WaitingIo
            _ => unreachable!(),
        };

        self.next()
    }

    // PORT NOTE: Zig `deinit` was a no-op (`_ = this;`); no Drop impl needed.

    #[inline]
    pub fn bltn(&mut self) -> &mut Builtin {
        // SAFETY: self is the `pwd` field of a Builtin::Impl, which is the `impl` field of a Builtin.
        unsafe {
            let impl_ptr = (self as *mut Self as *mut u8)
                .sub(offset_of!(BuiltinImpl, pwd))
                .cast::<BuiltinImpl>();
            &mut *(impl_ptr as *mut u8)
                .sub(offset_of!(Builtin, impl_))
                .cast::<Builtin>()
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/pwd.zig (94 lines)
//   confidence: medium
//   todos:      1
//   notes:      Builtin/Impl/OutputKind import paths are guesses; @fieldParentPtr chain ported via offset_of!
// ──────────────────────────────────────────────────────────────────────────
