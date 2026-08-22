use crate::shell::builtin::{Builtin, BuiltinState, IoKind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Pwd {
    /// Which stream the in-flight write was enqueued on; decides the exit code
    /// once it lands.
    waiting_on: Option<WaitKind>,
}

#[derive(Clone, Copy)]
enum WaitKind {
    Stdout,
    Stderr,
}

impl Pwd {
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        if !Builtin::of(interp, cmd).args_slice().is_empty() {
            let msg: &[u8] = b"pwd: too many arguments\n";
            if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
                Self::state_mut(interp, cmd).waiting_on = Some(WaitKind::Stderr);
                let child = ChildPtr::new(cmd, WriterTag::Builtin);
                return Builtin::of_mut(interp, cmd)
                    .stderr
                    .enqueue(child, msg, safeguard);
            }
            let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, msg);
            return Builtin::done(interp, cmd, 1);
        }

        let cwd: Vec<u8> = {
            let mut v = Builtin::shell(interp, cmd).cwd().to_vec();
            v.push(b'\n');
            v
        };
        if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
            Self::state_mut(interp, cmd).waiting_on = Some(WaitKind::Stdout);
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd)
                .stdout
                .enqueue(child, &cwd, safeguard);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &cwd);
        Builtin::done(interp, cmd, 0)
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        if err.is_some() {
            return Builtin::done(interp, cmd, 1);
        }
        let exit_code = match Self::state_mut(interp, cmd).waiting_on {
            Some(WaitKind::Stderr) => 1,
            Some(WaitKind::Stdout) | None => 0,
        };
        Builtin::done(interp, cmd, exit_code)
    }
}
