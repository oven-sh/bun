//! Some additional behaviour beyond basic `cd <dir>`:
//! - `cd` by itself or `cd ~` will always put the user in their home directory.
//! - `cd -` will put the user in the previous directory

use crate::shell::builtin::{Builtin, BuiltinState, IoKind, Kind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::states::cmd::Exec;
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
    pub(crate) fn start(interp: &mut Interpreter<'_>, cmd: NodeId) -> Yield {
        let cmd_node = interp.nodes[cmd.idx()].as_cmd();
        let Exec::Builtin(bltn) = &cmd_node.exec else {
            unreachable!()
        };
        let shell = &mut interp.shells[cmd_node.shell.id()];
        let args = bltn.args_slice();
        if args.len() > 1 {
            return Self::write_stderr_non_blocking(
                interp,
                cmd,
                format_args!("too many arguments\n"),
            );
        }

        if args.is_empty() {
            let home = shell.get_homedir().to_vec();
            if home.is_empty() {
                return Self::write_stderr_non_blocking(
                    interp,
                    cmd,
                    format_args!("HOME not set\n"),
                );
            }
            if let Err(err) = shell.change_cwd(interp.arena, &home) {
                return Self::handle_change_cwd_err(interp, cmd, &err, &home);
            }
            return Builtin::done(interp, cmd, 0);
        }

        let target = match bltn.arg_bytes(0) {
            b"-" => shell.prev_cwd(),
            first_arg => first_arg,
        };
        if let Err(err) = shell.change_cwd(interp.arena, target) {
            let target = target.to_vec();
            return Self::handle_change_cwd_err(interp, cmd, &err, &target);
        }

        Builtin::done(interp, cmd, 0)
    }

    fn handle_change_cwd_err(
        interp: &mut Interpreter<'_>,
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
        interp: &mut Interpreter<'_>,
        cmd: NodeId,
        args: core::fmt::Arguments<'_>,
    ) -> Yield {
        Self::state_mut(interp, cmd).state = State::WaitingIo;
        if let Some(fd) = Builtin::of(interp, cmd).stderr.needs_io() {
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return interp.enqueue_fmt(fd, child, Some(Kind::Cd), args);
        }
        let buf = Builtin::fmt_error(Some(Kind::Cd), args);
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, &buf);
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, 1)
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &mut Interpreter<'_>,
        cmd: NodeId,
        _: usize,
        _err: Option<bun_sys::SystemError>,
    ) -> Yield {
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, 1)
    }
}
