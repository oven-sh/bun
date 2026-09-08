//! Some additional behaviour beyond basic `cd <dir>`:
//! - `cd` by itself or `cd ~` will always put the user in their home directory.
//! - `cd -` will put the user in the previous directory

use crate::shell::builtin::{Builtin, BuiltinState, IoKind, Kind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{ChildPtr, WriterTag};
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
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let argc = Builtin::of(interp, cmd).args_slice().len();
        if argc > 1 {
            return Self::write_stderr_non_blocking(
                interp,
                cmd,
                format_args!("too many arguments\n"),
            );
        }

        let shell = Builtin::shell(interp, cmd);
        if argc == 0 {
            let home = shell.borrow().get_homedir().slice().to_vec();
            if home.is_empty() {
                return Self::write_stderr_non_blocking(
                    interp,
                    cmd,
                    format_args!("HOME not set\n"),
                );
            }
            let res = shell.borrow_mut().change_cwd(&home);
            if let Err(err) = res {
                return Self::handle_change_cwd_err(interp, cmd, &err, &home);
            }
            return Builtin::done(interp, cmd, 0);
        }

        let first_arg = Builtin::of(interp, cmd).arg_bytes(0).to_vec();
        if first_arg == b"-" {
            let prev = shell.borrow().prev_cwd().to_vec();
            let res = shell.borrow_mut().change_prev_cwd();
            if let Err(err) = res {
                return Self::handle_change_cwd_err(interp, cmd, &err, &prev);
            }
        } else {
            let target = first_arg;
            let res = shell.borrow_mut().change_cwd(&target);
            if let Err(err) = res {
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
                format_args!("not a directory: {}\n", bstr::BStr::new(new_cwd)),
            ),
            E::ENAMETOOLONG => {
                Self::write_stderr_non_blocking(interp, cmd, format_args!("file name too long\n"))
            }
            _ => {
                let errmsg = err.msg().unwrap_or_else(|| err.name());
                Self::write_stderr_non_blocking(
                    interp,
                    cmd,
                    format_args!(
                        "{}: {}\n",
                        bstr::BStr::new(errmsg),
                        bstr::BStr::new(new_cwd),
                    ),
                )
            }
        }
    }

    fn write_stderr_non_blocking(
        interp: &Interpreter,
        cmd: NodeId,
        args: core::fmt::Arguments<'_>,
    ) -> Yield {
        Self::state_mut(interp, cmd).state = State::WaitingIo;
        let stderr_needs_io = Builtin::of(interp, cmd).stderr.needs_io();
        if let Some(safeguard) = stderr_needs_io {
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::write_out_fmt(
                interp,
                cmd,
                IoKind::Stderr,
                child,
                Some(Kind::Cd),
                args,
                safeguard,
            );
        }
        let buf = Builtin::fmt_error_arena(Some(Kind::Cd), args);
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
