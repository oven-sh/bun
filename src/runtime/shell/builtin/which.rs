//! 1 arg  => returns absolute path of the arg (not found becomes exit code 1)
//!
//! N args => returns absolute path of each separated by newline, if any path
//! is not found, exit code becomes 1, but continues execution until all args
//! are processed.

use bstr::BStr;

use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, IoKind, Sink, State};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;

pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
    if Builtin::of(interp, cmd).args().is_empty() {
        return Builtin::finish(interp, cmd, IoKind::Stdout, b"\n", 1);
    }
    print(interp, cmd, 0, false)
}

/// One write per argument, from `first` on.
pub(crate) fn print(interp: &Interpreter, cmd: NodeId, first: usize, mut missing: bool) -> Yield {
    let shell = Builtin::shell(interp, cmd);
    let (path_env, cwd) = (shell.export_env.get(b"PATH"), shell.cwd());
    let mut path_buf = bun_paths::path_buffer_pool::get();
    for (i, arg) in Builtin::of(interp, cmd)
        .args()
        .iter()
        .enumerate()
        .skip(first)
    {
        let found = bun_which::which(&mut path_buf, path_env.unwrap_or_default(), cwd, arg);
        missing |= found.is_none();
        let (prefix, name, suffix) = match found {
            Some(path) => ("", BStr::new(path.as_bytes()), ""),
            None => ("which: ", BStr::new(arg.get()), " not found"),
        };
        match Builtin::sink(interp, cmd, IoKind::Stdout) {
            Sink::Fd(fd) => {
                let next = i + 1;
                Builtin::of_mut(interp, cmd).state = State::Which { next, missing };
                return fd.enqueue(format!("{name}{suffix}\n").as_bytes());
            }
            // Only captured output has the prefix.
            Sink::Memory(memory) => {
                let _ = memory.write(format!("{prefix}{name}{suffix}\n").as_bytes());
            }
        }
    }
    Builtin::done(interp, cmd, ExitCode::from(missing))
}
