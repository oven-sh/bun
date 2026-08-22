//! 1 arg  => returns absolute path of the arg (not found becomes exit code 1)
//!
//! N args => returns absolute path of each separated by newline, if any path
//! is not found, exit code becomes 1, but continues execution until all args
//! are processed.

use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, BuiltinState, IoKind};
use crate::shell::env_str::EnvStr;
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Which {
    exit_code: ExitCode,
}

impl Which {
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let (out, exit_code) = Self::render(interp, cmd);
        if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
            Self::state_mut(interp, cmd).exit_code = exit_code;
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd)
                .stdout
                .enqueue(child, &out, safeguard);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &out);
        Builtin::done(interp, cmd, exit_code)
    }

    fn render(interp: &Interpreter, cmd: NodeId) -> (Vec<u8>, ExitCode) {
        let bltn = Builtin::of(interp, cmd);
        let argc = bltn.args_slice().len();
        if argc == 0 {
            return (b"\n".to_vec(), 1);
        }

        let search = SearchEnv::load(interp, cmd);
        let mut out = Vec::new();
        let mut exit_code = 0;
        for i in 0..argc {
            let arg = bltn.arg_bytes(i);
            match search.resolve(arg) {
                Some(resolved) => out.extend_from_slice(&resolved),
                None => {
                    exit_code = 1;
                    out.extend_from_slice(arg);
                    out.extend_from_slice(b" not found");
                }
            }
            out.push(b'\n');
        }
        (out, exit_code)
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        if let Some(err) = e {
            return Builtin::done(interp, cmd, err.errno as ExitCode);
        }
        let exit_code = Self::state_mut(interp, cmd).exit_code;
        Builtin::done(interp, cmd, exit_code)
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
