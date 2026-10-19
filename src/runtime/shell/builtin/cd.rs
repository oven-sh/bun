//! Some additional behaviour beyond basic `cd <dir>`:
//! - `cd` by itself or `cd ~` will always put the user in their home directory.
//! - `cd -` will put the user in the previous directory

use crate::shell::builtin::{Builtin, BuiltinState, IoKind, Kind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub(crate) struct Cd {
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
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let args = Builtin::of(interp, cmd).args_slice();
        if args.len() > 1 {
            return Self::write_stderr_non_blocking(interp, cmd, &[b"too many arguments\n"]);
        }

        if args.is_empty() {
            let home_str = Builtin::shell(interp, cmd).get_homedir();
            let home = home_str.slice().to_vec();
            home_str.deref();
            if home.is_empty() {
                return Self::write_stderr_non_blocking(interp, cmd, &[b"HOME not set\n"]);
            }
            if let Err(err) = interp.as_cmd_mut(cmd).base.shell_mut().change_cwd(&home) {
                return Self::handle_change_cwd_err(interp, cmd, &err, &home);
            }
            return Builtin::done(interp, cmd, 0);
        }

        let first_arg = Builtin::of(interp, cmd).arg_bytes(0);
        if first_arg == b"-" {
            let prev = Builtin::shell(interp, cmd).prev_cwd().to_vec();
            if let Err(err) = interp.as_cmd_mut(cmd).base.shell_mut().change_prev_cwd() {
                return Self::handle_change_cwd_err(interp, cmd, &err, &prev);
            }
        } else {
            let target = first_arg.to_vec();
            if let Err(err) = interp.as_cmd_mut(cmd).base.shell_mut().change_cwd(&target) {
                return Self::handle_change_cwd_err(interp, cmd, &err, &target);
            }
        }

        Builtin::done(interp, cmd, 0)
    }

    fn handle_change_cwd_err(
        interp: &Interpreter,
        cmd: NodeId,
        err: &bun_sys::Error,
        new_cwd: &[u8],
    ) -> Yield {
        use bun_sys::E;
        let errno = err.get_errno();
        match errno {
            E::ENOTDIR | E::ENOENT => Self::write_stderr_non_blocking(
                interp,
                cmd,
                &[b"not a directory: ", new_cwd, b"\n"],
            ),
            E::ENAMETOOLONG => {
                Self::write_stderr_non_blocking(interp, cmd, &[b"file name too long\n"])
            }
            _ => {
                let errmsg = err.msg().unwrap_or_else(|| err.name());
                Self::write_stderr_non_blocking(interp, cmd, &[errmsg, b": ", new_cwd, b"\n"])
            }
        }
    }

    fn write_stderr_non_blocking(interp: &Interpreter, cmd: NodeId, parts: &[&[u8]]) -> Yield {
        Self::state_mut(interp, cmd).state = State::WaitingIo;
        if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd).stderr.enqueue_parts(
                child,
                Some(Kind::Cd),
                parts,
                safeguard,
            );
        }
        let buf = Builtin::error_line(Kind::Cd, parts);
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, &buf);
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, 1)
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        _err: Option<bun_sys::SystemError>,
    ) -> Yield {
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, 1)
    }
}
