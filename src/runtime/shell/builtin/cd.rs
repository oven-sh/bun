//! Some additional behaviour beyond basic `cd <dir>`:
//! - `cd` with no args → `$HOME`
//! - `cd -` → previous cwd

use core::ffi::CStr;

use crate::shell::builtin::{Builtin, IoKind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Cd {
    state: State,
}

#[derive(Default)]
enum State {
    #[default]
    Idle,
    WaitingIo,
    Done,
}

impl Cd {
    pub fn start(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        let args = Builtin::of(interp, cmd).args_slice();
        if args.len() > 1 {
            return Self::fail(interp, cmd, b"cd: too many arguments\n");
        }

        let target: Vec<u8> = if args.is_empty() {
            // TODO(b2-blocked): ShellExecEnv::get_home_dir() — read $HOME from
            // export_env. Gated until EnvMap lookup is wired.
            b"/".to_vec()
        } else {
            // SAFETY: argv entries are NUL-terminated.
            let arg = unsafe { CStr::from_ptr(args[0]) }.to_bytes();
            if arg == b"-" {
                Builtin::shell(interp, cmd).prev_cwd().to_vec()
            } else {
                arg.to_vec()
            }
        };

        // TODO(b2-blocked): ShellExecEnv::change_cwd(target) — resolve relative
        // to current cwd, openat(O_DIRECTORY), swap cwd_fd. Body gated until
        // ShellExecEnv lookup is wired.
        let _ = target;
        Builtin::done(interp, cmd, 0)
    }

    fn fail(interp: &mut Interpreter, cmd: NodeId, msg: &[u8]) -> Yield {
        if Builtin::of(interp, cmd).stderr.needs_io().is_some() {
            // TODO(b2-blocked): IOWriter::enqueue
            Self::state_mut(interp, cmd).state = State::WaitingIo;
            return Yield::suspended();
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, msg);
        Builtin::done(interp, cmd, 1)
    }

    pub fn on_io_writer_chunk(
        interp: &mut Interpreter,
        cmd: NodeId,
        _: usize,
        _err: Option<bun_sys::SystemError>,
    ) -> Yield {
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, 1)
    }

    #[inline]
    fn state_mut(interp: &mut Interpreter, cmd: NodeId) -> &mut Cd {
        match &mut Builtin::of_mut(interp, cmd).impl_ {
            crate::shell::builtin::Impl::Cd(c) => c,
            _ => unreachable!(),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/cd.zig (165 lines)
//   confidence: medium
//   blocked_on: ShellExecEnv::change_cwd, IOWriter::enqueue
// ──────────────────────────────────────────────────────────────────────────
