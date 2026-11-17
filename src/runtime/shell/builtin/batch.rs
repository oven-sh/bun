//! What touch, mkdir, ls, cp and rm share: pool tasks that each come back with something to print.

use core::sync::atomic::Ordering;
use std::collections::VecDeque;

use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, IoKind, Sink, State};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub(crate) struct Batch {
    failed: bool,
    /// An entry per write in flight. Any completion takes the oldest, and prints it if it is `Some`.
    writes: VecDeque<Option<Vec<u8>>>,
    #[cfg(windows)]
    pub(crate) ebusy: Option<Box<super::cp::Ebusy>>,
}

impl Batch {
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId, tasks: usize) {
        let me = Builtin::of_mut(interp, cmd);
        *me.running.get_mut() = tasks;
        me.state = State::Batch(Batch::default());
    }

    pub(crate) fn of(interp: &Interpreter, cmd: NodeId) -> Option<&mut Batch> {
        match &mut Builtin::of_mut(interp, cmd).state {
            State::Batch(batch) => Some(batch),
            _ => None,
        }
    }

    pub(crate) fn report(
        interp: &Interpreter,
        cmd: NodeId,
        err: Option<Vec<u8>>,
        out: Vec<u8>,
    ) -> Yield {
        let me = Builtin::of_mut(interp, cmd);
        if let State::Batch(batch) = &mut me.state {
            me.running.fetch_sub(1, Ordering::SeqCst);
            batch.failed |= err.is_some();
        }
        Self::print(interp, cmd, err, out)
    }

    fn print(interp: &Interpreter, cmd: NodeId, err: Option<Vec<u8>>, out: Vec<u8>) -> Yield {
        if let Some(err) = err {
            match Builtin::sink(interp, cmd, IoKind::Stderr) {
                Sink::Fd(fd) => {
                    let Some(batch) = Self::of(interp, cmd) else {
                        return Yield::suspended();
                    };
                    batch.writes.push_back(Some(out));
                    return fd.enqueue(&err);
                }
                Sink::Memory(memory) => drop(memory.write(&err)),
            }
        }
        match Builtin::sink(interp, cmd, IoKind::Stdout) {
            Sink::Fd(fd) => {
                // An empty write completes at once, which releases what the oldest entry holds back.
                if let Some(batch) = Self::of(interp, cmd)
                    && (!out.is_empty() || !batch.writes.is_empty())
                {
                    batch.writes.push_back(None);
                    return fd.enqueue(&out);
                }
            }
            Sink::Memory(memory) => drop(memory.write(&out)),
        }
        Self::settle(interp, cmd)
    }

    /// Whether the write failed makes no difference.
    pub(crate) fn on_write(interp: &Interpreter, cmd: NodeId) -> Yield {
        match Self::of(interp, cmd).and_then(|batch| batch.writes.pop_front().flatten()) {
            Some(out) => Self::print(interp, cmd, None, out),
            None => Self::settle(interp, cmd),
        }
    }

    pub(crate) fn settle(interp: &Interpreter, cmd: NodeId) -> Yield {
        let me = Builtin::of_mut(interp, cmd);
        let State::Batch(batch) = &mut me.state else {
            return Yield::suspended();
        };
        if me.running.load(Ordering::SeqCst) > 0 || !batch.writes.is_empty() {
            return Yield::suspended();
        }
        // These errors do not change the exit code.
        #[cfg(windows)]
        if let Some((err, out)) = batch.ebusy.as_mut().and_then(|it| it.next_failure()) {
            return Self::print(interp, cmd, err, out);
        }
        Builtin::done(interp, cmd, ExitCode::from(batch.failed))
    }
}
