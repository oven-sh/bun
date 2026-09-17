//! Prints the absolute path of each arg on stdout, one per line.
//!
//! An arg that is not found gets a `which: <arg> not found` line on stderr and
//! makes the exit code 1. The remaining args are still processed.

use crate::shell::builtin::{Builtin, BuiltinIO, BuiltinState, IoKind, Kind};
use crate::shell::env_str::EnvStr;
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Which {
    pub(crate) state: State,
}

#[derive(Default, Clone, Copy)]
pub enum State {
    #[default]
    Idle,
    /// Called with no args: queued a single "\n" and waiting for the write.
    OneArg,
    /// Queued one line of a call with args and waiting for the write.
    MultiArgs {
        /// The stream the line went to.
        stream: IoKind,
        /// The next arg to resolve.
        arg_idx: usize,
        had_not_found: bool,
    },
}

impl Which {
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
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

        Self::next(interp, cmd, 0, false)
    }

    /// Resolves args from `arg_idx` on until a line has to wait for an
    /// IOWriter, or none are left. stdout and stderr can each be an fd or a
    /// captured buffer, so each line checks its own stream.
    fn next(
        interp: &Interpreter,
        cmd: NodeId,
        mut arg_idx: usize,
        mut had_not_found: bool,
    ) -> Yield {
        let argc = Builtin::of(interp, cmd).args_slice().len();
        let search = SearchEnv::load(interp, cmd);

        while arg_idx < argc {
            let arg = Self::arg(interp, cmd, arg_idx);
            arg_idx += 1;
            let (stream, line) = match search.resolve(&arg) {
                Some(resolved) => (
                    IoKind::Stdout,
                    Builtin::fmt_error_arena(
                        interp,
                        cmd,
                        None,
                        format_args!("{}\n", bstr::BStr::new(&resolved)),
                    )
                    .to_vec(),
                ),
                None => {
                    had_not_found = true;
                    (
                        IoKind::Stderr,
                        Builtin::fmt_error_arena(
                            interp,
                            cmd,
                            Some(Kind::Which),
                            format_args!("{} not found\n", bstr::BStr::new(&arg)),
                        )
                        .to_vec(),
                    )
                }
            };

            let Some(safeguard) = Self::out(interp, cmd, stream).needs_io() else {
                let _ = Builtin::write_no_io(interp, cmd, stream, &line);
                continue;
            };
            Self::state_mut(interp, cmd).state = State::MultiArgs {
                stream,
                arg_idx,
                had_not_found,
            };
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Self::out(interp, cmd, stream).enqueue(child, &line, safeguard);
        }
        Builtin::done(interp, cmd, if had_not_found { 1 } else { 0 })
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        let state = Self::state_mut(interp, cmd).state;
        if let Some(err) = e {
            // A not-found line that cannot be written does not stop the
            // listing. The exit code is already 1.
            let is_not_found_line = matches!(
                state,
                State::MultiArgs {
                    stream: IoKind::Stderr,
                    ..
                }
            );
            if !is_not_found_line {
                return Builtin::done(interp, cmd, err.errno as crate::shell::ExitCode);
            }
        }
        match state {
            State::OneArg => Builtin::done(interp, cmd, 1),
            State::MultiArgs {
                arg_idx,
                had_not_found,
                ..
            } => Self::next(interp, cmd, arg_idx, had_not_found),
            State::Idle => Builtin::done(interp, cmd, 0),
        }
    }

    // ── helpers ────────────────────────────────────────────────────────────

    fn arg(interp: &Interpreter, cmd: NodeId, idx: usize) -> Vec<u8> {
        Builtin::of(interp, cmd).arg_bytes(idx).to_vec()
    }

    fn out(interp: &Interpreter, cmd: NodeId, stream: IoKind) -> &mut BuiltinIO {
        let bltn = Builtin::of_mut(interp, cmd);
        match stream {
            IoKind::Stdout => &mut bltn.stdout,
            IoKind::Stderr => &mut bltn.stderr,
        }
    }
}

struct SearchEnv {
    path_env: Vec<u8>,
    cwd: Vec<u8>,
}

impl SearchEnv {
    fn load(interp: &Interpreter, cmd: NodeId) -> Self {
        let shell = Builtin::shell(interp, cmd);
        // `EnvMap::get` refs the returned string; balance it.
        let path_env = shell
            .export_env
            .get(EnvStr::init_slice(b"PATH"))
            .map(|s| {
                let v = s.slice().to_vec();
                s.deref();
                v
            })
            .unwrap_or_default();
        Self {
            path_env,
            cwd: shell.cwd().to_vec(),
        }
    }

    fn resolve(&self, arg: &[u8]) -> Option<Vec<u8>> {
        let mut path_buf = bun_paths::path_buffer_pool::get();
        bun_which::which(&mut *path_buf, &self.path_env, &self.cwd, arg)
            .map(|z| z.as_bytes().to_vec())
    }
}
