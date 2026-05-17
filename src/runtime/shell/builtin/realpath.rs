use crate::shell::builtin::{Builtin, BuiltinState, IoKind, Kind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Realpath {
    state: State,
    buf: Vec<u8>,
}

#[derive(Default)]
enum State {
    #[default]
    Idle,
    Err,
    Done,
}

impl Realpath {
    pub fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let argc = Builtin::of(interp, cmd).args_slice().len();
        if argc == 0 {
            return Self::fail(interp, cmd, Kind::Realpath.usage_string());
        }

        let stdout_needs_io = Builtin::of(interp, cmd).stdout.needs_io();
        let mut out = Vec::new();
        let mut exit_code: u8 = 0;

        for i in 0..argc {
            let path_bytes = Builtin::of(interp, cmd).arg_bytes(i);

            // Build an absolute path by joining the shell's CWD with the
            // argument when the argument is relative. `bun_sys::realpath`
            // resolves against the *process* CWD which may differ from the
            // shell's `cd`-tracked CWD.
            let mut path_buf = bun_paths::path_buffer_pool::get();
            let abs_path = if bun_paths::Platform::Auto.is_absolute(path_bytes) {
                path_bytes
            } else {
                let cwd = Builtin::shell(interp, cmd).cwd();
                let len = cwd.len();
                path_buf[..len].copy_from_slice(cwd);
                // Ensure separator between CWD and the relative path.
                let sep_len = if len > 0 && path_buf[len - 1] != b'/' && path_buf[len - 1] != b'\\' {
                    path_buf[len] = b'/';
                    1
                } else {
                    0
                };
                let rel_len = path_bytes.len();
                path_buf[len + sep_len..len + sep_len + rel_len].copy_from_slice(path_bytes);
                &path_buf[..len + sep_len + rel_len]
            };

            // Build a NUL-terminated version for the syscall.
            let mut resolve_buf = bun_paths::path_buffer_pool::get();
            let mut zpath_buf = bun_paths::path_buffer_pool::get();
            let zpath_len = abs_path.len();
            zpath_buf[..zpath_len].copy_from_slice(abs_path);
            zpath_buf[zpath_len] = 0;
            let zpath = unsafe { bun_core::ZStr::from_ptr(zpath_buf.0.as_ptr().cast()) };

            match bun_sys::realpath(zpath, &mut resolve_buf) {
                Ok(resolved) => {
                    out.extend_from_slice(resolved);
                    out.push(b'\n');
                }
                Err(_) => {
                    // Write error for this specific path, continue processing
                    // remaining arguments (matching GNU coreutils behavior).
                    let mut err_msg = Vec::new();
                    err_msg.extend_from_slice(b"realpath: ");
                    err_msg.extend_from_slice(path_bytes);
                    err_msg.extend_from_slice(b": No such file or directory\n");
                    let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, &err_msg);
                    exit_code = 1;
                }
            }
        }

        if out.is_empty() {
            Self::state_mut(interp, cmd).state = State::Done;
            return Builtin::done(interp, cmd, exit_code);
        }

        Self::state_mut(interp, cmd).state = State::Done;
        if let Some(safeguard) = stdout_needs_io {
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            Self::state_mut(interp, cmd).buf = out;
            let buf_ref = Self::state_mut(interp, cmd).buf.clone();
            return Builtin::of_mut(interp, cmd)
                .stdout
                .enqueue(child, &buf_ref, safeguard);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &out);
        Builtin::done(interp, cmd, exit_code)
    }

    fn fail(interp: &Interpreter, cmd: NodeId, msg: &[u8]) -> Yield {
        Self::state_mut(interp, cmd).state = State::Err;
        Builtin::write_failing_error(interp, cmd, msg, 1)
    }

    pub fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        if err.is_some() {
            Self::state_mut(interp, cmd).state = State::Err;
            return Builtin::done(interp, cmd, 1);
        }
        let exit = match Self::state_mut(interp, cmd).state {
            State::Done => 0,
            State::Err => 1,
            State::Idle => unreachable!("Realpath.onIOWriterChunk: idle"),
        };
        Builtin::done(interp, cmd, exit)
    }
}
