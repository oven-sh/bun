//! Some additional behaviour beyond basic `cd <dir>`:
//! - `cd` by itself or `cd ~` will always put the user in their home directory.
//! - `cd -` will put the user in the previous directory

use core::ffi::CStr;

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
    pub fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let args = Builtin::of(interp, cmd).args_slice();
        if args.len() > 1 {
            return Self::write_stderr_non_blocking(
                interp,
                cmd,
                format_args!("too many arguments\n"),
            );
        }

        if args.len() == 1 {
            let first_arg = Builtin::of(interp, cmd).arg_bytes(0);
            match first_arg.first() {
                Some(b'-') => {
                    let prev = Builtin::shell(interp, cmd).prev_cwd().to_vec();
                    if let Err(err) = interp.as_cmd_mut(cmd).base.shell_mut().change_prev_cwd() {
                        return Self::handle_change_cwd_err(interp, cmd, err, &prev);
                    }
                }
                Some(b'~') => {
                    let homedir = Builtin::shell(interp, cmd).get_homedir();
                    let target = homedir.slice().to_vec();
                    homedir.deref();
                    if let Err(err) = interp.as_cmd_mut(cmd).base.shell_mut().change_cwd(&target) {
                        return Self::handle_change_cwd_err(interp, cmd, err, &target);
                    }
                }
                _ => {
                    let target = first_arg.to_vec();
                    if let Err(err) = interp.as_cmd_mut(cmd).base.shell_mut().change_cwd(&target) {
                        return Self::handle_change_cwd_err(interp, cmd, err, &target);
                    }
                }
            }
        }

        Builtin::done(interp, cmd, 0)
    }

    fn handle_change_cwd_err(
        interp: &Interpreter,
        cmd: NodeId,
        err: bun_sys::Error,
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
        if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd).stderr.enqueue_fmt(
                child,
                Some(Kind::Cd),
                args,
                safeguard,
            );
        }
        let buf = Builtin::fmt_error_arena(interp, cmd, Some(Kind::Cd), args).to_vec();
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, &buf);
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, 1)
    }

    pub fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        _err: Option<bun_sys::SystemError>,
    ) -> Yield {
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, 1)
    }
}

// ported from: src/shell/builtin/cd.zig
