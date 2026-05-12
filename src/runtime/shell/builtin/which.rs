//! 1 arg  => returns absolute path of the arg (not found becomes exit code 1)
//!
//! N args => returns absolute path of each separated by newline, if any path
//! is not found, exit code becomes 1, but continues execution until all args
//! are processed.

use core::ffi::CStr;

use crate::shell::builtin::{Builtin, BuiltinState, IoKind, Kind};
use crate::shell::env_str::EnvStr;
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Which {
    pub state: State,
}

#[derive(Default)]
pub enum State {
    #[default]
    Idle,
    /// Called with no args: queued a single "\n" and waiting for the write.
    OneArg,
    MultiArgs {
        arg_idx: usize,
        had_not_found: bool,
        waiting_write: bool,
    },
    Done,
}

impl Which {
    pub fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let argc = Builtin::of(interp, cmd).args_slice().len();
        if argc == 0 {
            if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
                Self::state_mut(interp, cmd).state = State::OneArg;
                let child = ChildPtr::new(cmd, WriterTag::Builtin);
                return Builtin::of_mut(interp, cmd)
                    .stdout
                    .enqueue(child, b"\n", safeguard);
            }
            let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, b"\n");
            return Builtin::done(interp, cmd, 1);
        }

        if Builtin::of(interp, cmd).stdout.needs_io().is_none() {
            // Synchronous path: resolve every arg, write straight to the
            // captured buffer, then finish.
            let (path_env, cwd) = Self::path_and_cwd(interp, cmd);
            let mut had_not_found = false;
            for i in 0..argc {
                let arg = Self::arg(interp, cmd, i);
                match Self::resolve(&path_env, &cwd, &arg) {
                    Some(resolved) => {
                        let buf = Builtin::fmt_error_arena(
                            interp,
                            cmd,
                            None,
                            format_args!("{}\n", bstr::BStr::new(&resolved)),
                        )
                        .to_vec();
                        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &buf);
                    }
                    None => {
                        had_not_found = true;
                        let buf = Builtin::fmt_error_arena(
                            interp,
                            cmd,
                            Some(Kind::Which),
                            format_args!("{} not found\n", bstr::BStr::new(&arg)),
                        )
                        .to_vec();
                        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &buf);
                    }
                }
            }
            return Builtin::done(interp, cmd, if had_not_found { 1 } else { 0 });
        }

        Self::state_mut(interp, cmd).state = State::MultiArgs {
            arg_idx: 0,
            had_not_found: false,
            waiting_write: false,
        };
        Self::next(interp, cmd)
    }

    pub fn next(interp: &Interpreter, cmd: NodeId) -> Yield {
        let argc = Builtin::of(interp, cmd).args_slice().len();
        let (arg_idx, had_not_found) = match &Self::state_mut(interp, cmd).state {
            State::MultiArgs {
                arg_idx,
                had_not_found,
                ..
            } => (*arg_idx, *had_not_found),
            _ => unreachable!(),
        };
        if arg_idx >= argc {
            return Builtin::done(interp, cmd, if had_not_found { 1 } else { 0 });
        }

        let arg = Self::arg(interp, cmd, arg_idx);
        let (path_env, cwd) = Self::path_and_cwd(interp, cmd);
        let resolved = Self::resolve(&path_env, &cwd, &arg);

        let child = ChildPtr::new(cmd, WriterTag::Builtin);
        match resolved {
            None => {
                if let State::MultiArgs {
                    had_not_found,
                    waiting_write,
                    ..
                } = &mut Self::state_mut(interp, cmd).state
                {
                    *had_not_found = true;
                    *waiting_write = true;
                }
                if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
                    return Builtin::of_mut(interp, cmd).stdout.enqueue_fmt(
                        child,
                        None,
                        format_args!("{} not found\n", bstr::BStr::new(&arg)),
                        safeguard,
                    );
                }
                let buf = Builtin::fmt_error_arena(
                    interp,
                    cmd,
                    None,
                    format_args!("{} not found\n", bstr::BStr::new(&arg)),
                )
                .to_vec();
                let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &buf);
                Self::arg_complete(interp, cmd)
            }
            Some(resolved) => {
                if let State::MultiArgs { waiting_write, .. } =
                    &mut Self::state_mut(interp, cmd).state
                {
                    *waiting_write = true;
                }
                if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
                    return Builtin::of_mut(interp, cmd).stdout.enqueue_fmt(
                        child,
                        None,
                        format_args!("{}\n", bstr::BStr::new(&resolved)),
                        safeguard,
                    );
                }
                let buf = Builtin::fmt_error_arena(
                    interp,
                    cmd,
                    None,
                    format_args!("{}\n", bstr::BStr::new(&resolved)),
                )
                .to_vec();
                let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &buf);
                Self::arg_complete(interp, cmd)
            }
        }
    }

    fn arg_complete(interp: &Interpreter, cmd: NodeId) -> Yield {
        if let State::MultiArgs {
            arg_idx,
            waiting_write,
            ..
        } = &mut Self::state_mut(interp, cmd).state
        {
            *arg_idx += 1;
            *waiting_write = false;
        }
        Self::next(interp, cmd)
    }

    pub fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        if let Some(err) = e {
            return Builtin::done(interp, cmd, err.errno as crate::shell::ExitCode);
        }
        match Self::state_mut(interp, cmd).state {
            State::OneArg => Builtin::done(interp, cmd, 1),
            State::MultiArgs { .. } => Self::arg_complete(interp, cmd),
            _ => Builtin::done(interp, cmd, 0),
        }
    }

    // ── helpers ────────────────────────────────────────────────────────────

    /// Look up `$PATH` from the export env and the cwd from the shell env.
    fn path_and_cwd(interp: &Interpreter, cmd: NodeId) -> (Vec<u8>, Vec<u8>) {
        let shell = Builtin::shell(interp, cmd);
        let path = shell
            .export_env
            .get(EnvStr::init_slice(b"PATH"))
            .map(|s| s.slice().to_vec())
            .unwrap_or_default();
        (path, shell.cwd().to_vec())
    }

    fn arg(interp: &Interpreter, cmd: NodeId, idx: usize) -> Vec<u8> {
        Builtin::of(interp, cmd).arg_bytes(idx).to_vec()
    }

    /// Spec: which.zig — `bun.which(path_buf, PATH, cwd, arg)`.
    fn resolve(path_env: &[u8], cwd: &[u8], arg: &[u8]) -> Option<Vec<u8>> {
        let mut path_buf = bun_paths::path_buffer_pool::get();
        bun_which::which(&mut *path_buf, path_env, cwd, arg).map(|z| z.as_bytes().to_vec())
    }
}

// ported from: src/shell/builtin/which.zig
