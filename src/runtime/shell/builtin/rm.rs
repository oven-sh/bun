//! Port of src/shell/builtin/rm.zig

use crate::shell::builtin::{Builtin, IoKind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;
use crate::shell::ExitCode;

#[derive(Default)]
pub struct Rm {
    pub state: RmState,
}

#[derive(Default)]
pub enum RmState {
    #[default]
    Idle,
    ParseOpts,
    /// Spec rm.zig `.exec` with `state == .waiting`.
    Removing {
        idx: usize,
        total_tasks: usize,
        tasks_done: usize,
        output_count: usize,
        output_done: usize,
        err: bool,
    },
    WaitingIo,
    Err(ExitCode),
    Done,
}

impl Rm {
    pub fn start(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        // Full body (~1700 lines): parse -r/-f/-d/-v, for each arg spawn a
        // ShellRmTask on the WorkPool that walks the directory tree and
        // unlinks/rmdirs, streaming progress to stderr. Gated until
        // bun_sys::{unlinkat, rmdirat, DirIterator}, ShellTask/WorkPool, and
        // IOWriter::enqueue are wired.
        #[cfg(any())]
        {
            include!("rm_body_gated.rs");
        }
        // Until the gated body is wired, fail loudly instead of silently
        // exiting 0 (which would let callers believe removal succeeded).
        // Spec rm.zig:130-139 prints usage and exits 1 on no-args; we mirror
        // the exit code and emit a not-implemented note so behaviour is
        // observable.
        const MSG: &[u8] = b"rm: not implemented\n";
        if Builtin::of(interp, cmd).stderr.needs_io().is_some() {
            // TODO(b2-blocked): IOWriter::enqueue — async stderr.
            Self::state_mut(interp, cmd).state = RmState::WaitingIo;
            return Yield::suspended();
        }
        Builtin::write_no_io(interp, cmd, IoKind::Stderr, MSG);
        Builtin::done(interp, cmd, 1)
    }

    pub fn on_io_writer_chunk(
        interp: &mut Interpreter,
        cmd: NodeId,
        _: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        // Spec rm.zig:298-323. Reshaped for borrowck — compute the outcome
        // while holding the &mut into state, drop it, then call done().
        let outcome: Option<ExitCode> = match &mut Self::state_mut(interp, cmd).state {
            RmState::Removing {
                total_tasks,
                tasks_done,
                output_count,
                output_done,
                err: had_err,
                ..
            } => {
                // .exec with state == .waiting: bump output_done and only
                // finish once every task and every queued write completed.
                *output_done += 1;
                if *tasks_done >= *total_tasks && *output_done >= *output_count {
                    Some(if *had_err { 1 } else { 0 })
                } else {
                    None
                }
            }
            // parse_opts.wait_write_err / waiting_write_err fall-through.
            state => {
                if let Some(e) = &err {
                    let code = e.errno as ExitCode;
                    *state = RmState::Err(code);
                    Some(code)
                } else {
                    Some(1)
                }
            }
        };
        match outcome {
            Some(code) => Builtin::done(interp, cmd, code),
            None => Yield::suspended(),
        }
    }

    #[inline]
    fn state_mut(interp: &mut Interpreter, cmd: NodeId) -> &mut Rm {
        match &mut Builtin::of_mut(interp, cmd).impl_ {
            crate::shell::builtin::Impl::Rm(r) => &mut **r,
            _ => unreachable!(),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/rm.zig (1704 lines)
//   confidence: low (NodeId scaffolding only; body gated)
//   blocked_on: bun_sys::{unlinkat, rmdirat, DirIterator}, ShellTask/WorkPool,
//               IOWriter::enqueue
// ──────────────────────────────────────────────────────────────────────────
