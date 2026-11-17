//! What touch, mkdir, ls, cp and rm share: pool tasks that each come back with something to print.

use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::collections::VecDeque;

use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, IoKind, Sink, State};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub(crate) struct Batch {
    /// Reports still to come. A task adds the ones it causes before it reports.
    pub(crate) running: AtomicUsize,
    /// Tells the tasks of `rm` that one of them has failed.
    pub(crate) stop: AtomicBool,
    failed: bool,
    /// An entry per write in flight, on either stream. `Some` goes to stdout after a completion.
    writes: VecDeque<Option<Vec<u8>>>,
    #[cfg(windows)]
    pub(crate) ebusy: Option<Box<super::cp::Ebusy>>,
}

impl Batch {
    /// Stays in place until every task has reported.
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId, tasks: usize) -> &Batch {
        Builtin::of_mut(interp, cmd).state = State::Batch(Batch {
            running: AtomicUsize::new(tasks),
            ..Default::default()
        });
        Self::of(interp, cmd)
    }

    pub(crate) fn of(interp: &Interpreter, cmd: NodeId) -> &mut Batch {
        match &mut Builtin::of_mut(interp, cmd).state {
            State::Batch(batch) => batch,
            _ => unreachable!(),
        }
    }

    pub(crate) fn report(
        interp: &Interpreter,
        cmd: NodeId,
        err: Option<Vec<u8>>,
        out: Vec<u8>,
    ) -> Yield {
        let batch = Self::of(interp, cmd);
        batch.running.fetch_sub(1, Ordering::SeqCst);
        batch.failed |= err.is_some();
        Self::print(interp, cmd, err, out)
    }

    fn print(interp: &Interpreter, cmd: NodeId, err: Option<Vec<u8>>, out: Vec<u8>) -> Yield {
        if let Some(err) = err {
            match Builtin::sink(interp, cmd, IoKind::Stderr) {
                Sink::Fd(fd) => {
                    Self::of(interp, cmd).writes.push_back(Some(out));
                    return fd.enqueue(&err);
                }
                Sink::Memory(memory) => drop(memory.write(&err)),
            }
        }
        match Builtin::sink(interp, cmd, IoKind::Stdout) {
            Sink::Fd(fd) => {
                let writes = &mut Self::of(interp, cmd).writes;
                // An empty write completes at once, which releases what the oldest entry holds back.
                if !out.is_empty() || !writes.is_empty() {
                    writes.push_back(None);
                    return fd.enqueue(&out);
                }
            }
            Sink::Memory(memory) => drop(memory.write(&out)),
        }
        Self::settle(interp, cmd)
    }

    /// Whether the write failed makes no difference.
    pub(crate) fn on_write(interp: &Interpreter, cmd: NodeId) -> Yield {
        match Self::of(interp, cmd).writes.pop_front().flatten() {
            Some(out) => Self::print(interp, cmd, None, out),
            None => Self::settle(interp, cmd),
        }
    }

    pub(crate) fn settle(interp: &Interpreter, cmd: NodeId) -> Yield {
        let batch = Self::of(interp, cmd);
        if batch.running.load(Ordering::SeqCst) > 0 || !batch.writes.is_empty() {
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
