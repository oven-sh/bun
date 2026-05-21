use crate::shell::builtin::{Builtin, BuiltinState, IoKind};
use crate::shell::env_str::EnvStr;
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Printenv {
    state: State,
    buf: Vec<u8>,
}

#[derive(Default)]
enum State {
    #[default]
    Idle,
    WaitingIo,
    WaitingErr,
    Done,
}

impl Printenv {
    pub fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let argc = Builtin::of(interp, cmd).args_slice().len();

        // Parse flags — printenv supports -0 / --null (NUL terminator)
        let mut null_terminate = false;
        let mut args_start = 0usize;
        for i in 0..argc {
            let arg = Builtin::of(interp, cmd).arg_bytes(i);
            if arg == b"-0" || arg == b"--null" {
                null_terminate = true;
                args_start = i + 1;
            } else if arg == b"--" {
                args_start = i + 1;
                break;
            } else if arg.starts_with(b"-") && arg.len() > 1 {
                let msg = b"printenv: invalid option\n";
                if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
                    Self::state_mut(interp, cmd).state = State::WaitingErr;
                    let child = ChildPtr::new(cmd, WriterTag::Builtin);
                    return Builtin::of_mut(interp, cmd)
                        .stderr
                        .enqueue(child, msg, safeguard);
                }
                let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, msg);
                return Builtin::done(interp, cmd, 1);
            } else {
                args_start = i;
                break;
            }
        }

        let terminator: u8 = if null_terminate { 0 } else { b'\n' };
        let shell = Builtin::shell(interp, cmd);

        let mut buf = Vec::new();
        let mut exit_code: u8 = 0;

        if args_start >= argc {
            // No arguments: print all exported environment variables.
            // POSIX printenv shows the export environment.
            for (key, value) in shell.export_env.iter() {
                buf.extend_from_slice(key.slice());
                buf.push(b'=');
                buf.extend_from_slice(value.slice());
                buf.push(terminator);
            }
        } else {
            // Print specific variable values.
            for i in args_start..argc {
                let name = Builtin::of(interp, cmd).arg_bytes(i);
                let key = EnvStr::init_slice(name);
                // Check shell_env first (locals), then export_env.
                let value = shell.shell_env.get(key).or_else(|| {
                    let key2 = EnvStr::init_slice(name);
                    shell.export_env.get(key2)
                });
                if let Some(val) = value {
                    buf.extend_from_slice(val.slice());
                    buf.push(terminator);
                    val.deref();
                } else {
                    exit_code = 1;
                }
            }
        }

        if buf.is_empty() {
            Self::state_mut(interp, cmd).state = State::Done;
            return Builtin::done(interp, cmd, exit_code);
        }

        // Stash exit_code so on_io_writer_chunk can recover it.
        Builtin::of_mut(interp, cmd).exit_code = Some(exit_code);

        Self::state_mut(interp, cmd).buf = buf;
        if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
            Self::state_mut(interp, cmd).state = State::WaitingIo;
            let buf_clone = Self::state_mut(interp, cmd).buf.clone();
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd)
                .stdout
                .enqueue(child, &buf_clone, safeguard);
        }
        let out = Self::state_mut(interp, cmd).buf.clone();
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &out);
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, exit_code)
    }

    pub fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        if err.is_some() {
            return Builtin::done(interp, cmd, 1);
        }
        match &Self::state_mut(interp, cmd).state {
            State::WaitingErr => Builtin::done(interp, cmd, 1),
            _ => {
                Self::state_mut(interp, cmd).state = State::Done;
                let exit_code = Builtin::of(interp, cmd).exit_code.unwrap_or(0);
                Builtin::done(interp, cmd, exit_code)
            }
        }
    }
}
