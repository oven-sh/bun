use crate::shell::builtin::{Builtin, IoKind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;
use crate::shell::ExitCode;

#[derive(Default)]
pub struct Cat {
    pub state: CatState,
    pub arg_idx: usize,
}

#[derive(Default)]
pub enum CatState {
    #[default]
    Idle,
    /// Spec cat.zig `.exec_filepath_args`.
    ReadingFile {
        chunks_queued: usize,
        chunks_done: usize,
        in_done: bool,
        out_done: bool,
    },
    /// Spec cat.zig `.exec_stdin`.
    ReadingStdin {
        chunks_queued: usize,
        chunks_done: usize,
        in_done: bool,
        errno: ExitCode,
    },
    /// Spec cat.zig `.waiting_write_err`.
    WaitingWrite,
    Done,
}

/// Internal: what to do after dropping the &mut state borrow.
enum Step {
    Suspend,
    Done(ExitCode),
    Next,
}

impl Cat {
    pub fn start(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        // Full body (~380 lines): for each arg (or stdin if none), open via
        // bun_sys::openat, register with an IOReader, and pump chunks to the
        // builtin's stdout IOWriter. Gated until IOReader/IOWriter bodies and
        // bun_sys::openat are wired.
        #[cfg(any())]
        {
            include!("cat_body_gated.rs");
        }
        // Until the gated body is wired, fail loudly instead of silently
        // exiting 0 with empty stdout. Spec cat.zig:43-50 exits 1 on bad
        // flags; we mirror the non-zero exit so callers don't believe the
        // file was emitted.
        const MSG: &[u8] = b"cat: not implemented\n";
        if Builtin::of(interp, cmd).stderr.needs_io().is_some() {
            // TODO(b2-blocked): IOWriter::enqueue — async stderr.
            Self::state_mut(interp, cmd).state = CatState::WaitingWrite;
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
        // Spec cat.zig:125-178.
        if let Some(e) = err {
            // Preserve the real errno (cat.zig:141/149/151), don't collapse to 1.
            // TODO(b2-blocked): remove reader / deinit exec state before done().
            return Builtin::done(interp, cmd, e.errno as ExitCode);
        }
        // Reshaped for borrowck — compute the next step while holding &mut
        // into state, then act after the borrow ends.
        let step = match &mut Self::state_mut(interp, cmd).state {
            CatState::ReadingStdin { chunks_queued, chunks_done, in_done, .. } => {
                *chunks_done += 1;
                if *in_done && *chunks_done >= *chunks_queued {
                    Step::Done(0)
                } else {
                    Step::Suspend
                }
            }
            CatState::ReadingFile { chunks_queued, chunks_done, in_done, out_done } => {
                *chunks_done += 1;
                if *chunks_done >= *chunks_queued {
                    *out_done = true;
                }
                if *in_done && *out_done { Step::Next } else { Step::Suspend }
            }
            // waiting_write_err: the queued error message flushed; finish 1.
            CatState::WaitingWrite => Step::Done(1),
            CatState::Idle | CatState::Done => {
                debug_assert!(false, "Cat::on_io_writer_chunk in invalid state");
                Step::Done(1)
            }
        };
        match step {
            Step::Suspend => Yield::suspended(),
            Step::Done(code) => Builtin::done(interp, cmd, code),
            Step::Next => Self::next(interp, cmd),
        }
    }

    /// Spec cat.zig:181-204 (`onIOReaderChunk`). Stub so the IOReader vtable
    /// has a dispatch target once wired.
    pub fn on_io_reader_chunk(
        interp: &mut Interpreter,
        cmd: NodeId,
        chunk: &[u8],
        remove: &mut bool,
    ) -> Yield {
        *remove = false;
        let stdout_needs_io = Builtin::of(interp, cmd).stdout.needs_io().is_some();
        match &mut Self::state_mut(interp, cmd).state {
            CatState::ReadingStdin { chunks_queued, .. }
            | CatState::ReadingFile { chunks_queued, .. } => {
                if stdout_needs_io {
                    // TODO(b2-blocked): IOWriter::enqueue — async stdout.
                    *chunks_queued += 1;
                    return Yield::suspended();
                }
            }
            _ => {
                debug_assert!(false, "Cat::on_io_reader_chunk in invalid state");
                return Yield::done();
            }
        }
        Builtin::write_no_io(interp, cmd, IoKind::Stdout, chunk);
        Yield::done()
    }

    /// Spec cat.zig:206-246 (`onIOReaderDone`). Stub so the IOReader vtable
    /// has a dispatch target once wired.
    pub fn on_io_reader_done(
        interp: &mut Interpreter,
        cmd: NodeId,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        let errno: ExitCode = err.map(|e| e.errno as ExitCode).unwrap_or(0);
        let stdout_needs_io = Builtin::of(interp, cmd).stdout.needs_io().is_some();
        let step = match &mut Self::state_mut(interp, cmd).state {
            CatState::ReadingStdin { chunks_queued, chunks_done, in_done, errno: st_errno } => {
                *st_errno = errno;
                *in_done = true;
                if errno != 0 {
                    if *chunks_done >= *chunks_queued || !stdout_needs_io {
                        Step::Done(errno)
                    } else {
                        // TODO(b2-blocked): IOWriter::cancelChunks.
                        Step::Suspend
                    }
                } else if *chunks_done >= *chunks_queued || !stdout_needs_io {
                    Step::Done(0)
                } else {
                    Step::Suspend
                }
            }
            CatState::ReadingFile { chunks_queued, chunks_done, in_done, out_done } => {
                *in_done = true;
                if errno != 0 {
                    if *out_done || !stdout_needs_io {
                        Step::Done(errno)
                    } else {
                        // TODO(b2-blocked): IOWriter::cancelChunks.
                        Step::Suspend
                    }
                } else if *out_done || *chunks_done >= *chunks_queued || !stdout_needs_io {
                    Step::Next
                } else {
                    Step::Suspend
                }
            }
            CatState::Done | CatState::WaitingWrite | CatState::Idle => Step::Suspend,
        };
        match step {
            Step::Suspend => Yield::suspended(),
            Step::Done(code) => Builtin::done(interp, cmd, code),
            Step::Next => Self::next(interp, cmd),
        }
    }

    /// Advance to the next filepath arg. Spec cat.zig:71-123 (`next`).
    fn next(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        // TODO(b2-blocked): bun_sys::openat + IOReader::init for the next arg.
        // Until wired, treat end-of-args as success so on_io_writer_chunk's
        // ReadingFile arm terminates instead of hanging.
        Self::state_mut(interp, cmd).state = CatState::Done;
        Builtin::done(interp, cmd, 0)
    }

    #[inline]
    fn state_mut(interp: &mut Interpreter, cmd: NodeId) -> &mut Cat {
        match &mut Builtin::of_mut(interp, cmd).impl_ {
            crate::shell::builtin::Impl::Cat(c) => &mut **c,
            _ => unreachable!(),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/cat.zig (382 lines)
//   confidence: low (NodeId scaffolding only; read/write loop gated)
//   blocked_on: IOReader body, IOWriter::enqueue, bun_sys::openat
// ──────────────────────────────────────────────────────────────────────────
