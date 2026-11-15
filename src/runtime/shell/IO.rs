//! Carries stdin/stdout/stderr for a state node.
//!
//! `IO` is a plain `Copy` value of ids into `Interpreter::{io_readers, io_writers}`.

use bun_collections::VecExt;

use crate::api::bun_spawn::stdio::Stdio;
use crate::shell::interpreter::{BufioId, Interpreter};
use crate::shell::io_reader::IOReaderId;
use crate::shell::io_writer::IOWriterId;
use crate::shell::shell_body::subproc::ShellIO;

#[derive(Clone, Copy)]
pub(crate) struct IO {
    pub(crate) stdin: IOReaderId,
    pub(crate) stdout: OutKind,
    pub(crate) stderr: OutKind,
}

impl IO {
    /// Sum of stdin/stdout/stderr.
    pub(crate) fn memory_cost(&self, interp: &Interpreter<'_>) -> usize {
        let mut size = core::mem::size_of::<IO>();
        size += interp.io_readers[self.stdin].memory_cost();
        size += self.stdout.memory_cost(interp);
        size += self.stderr.memory_cost(interp);
        size
    }

    /// Maps the state-node IO triple onto
    /// `subproc::Stdio` for [`ShellSubprocess::spawn_async`], and stashes the
    /// `IOWriterId`s on `shellio` so [`PipeReader`]'s captured-writer
    /// path can tee subprocess output back into the JS-side buffers.
    pub(crate) fn to_subproc_stdio(
        self,
        interp: &Interpreter<'_>,
        stdio: &mut [Stdio; 3],
        shellio: &mut ShellIO,
    ) {
        stdio[0] = Stdio::Fd(interp.io_readers[self.stdin].fd());
        stdio[1] = self.stdout.to_subproc_stdio(interp, &mut shellio.stdout);
        stdio[2] = self.stderr.to_subproc_stdio(interp, &mut shellio.stderr);
    }
}

/// Write to a file descriptor (via `IOWriter`), tee into a captured buffer,
/// or pipe to a subprocess.
#[derive(Clone, Copy)]
pub(crate) enum OutKind {
    Fd(OutFd),
    Pipe,
}

#[derive(Clone, Copy)]
pub(crate) struct OutFd {
    pub(crate) writer: IOWriterId,
    /// If set, also append every chunk to this buffer (the JS-side captured
    /// stdout/stderr).
    pub(crate) captured: Option<BufioId>,
}

impl OutFd {
    fn memory_cost(self, interp: &Interpreter<'_>) -> usize {
        let mut cost = interp.io_writers[self.writer].memory_cost();
        if let Some(captured) = self.captured {
            cost += interp.shells.captured(captured).memory_cost();
        }
        cost
    }
}

impl OutKind {
    fn memory_cost(self, interp: &Interpreter<'_>) -> usize {
        match self {
            OutKind::Fd(fd) => fd.memory_cost(interp),
            OutKind::Pipe => 0,
        }
    }

    /// Stores the `IOWriterId` on
    /// `shellio` so the subprocess's `PipeReader::captured_writer` can drain
    /// captured bytes into it after the spawn returns.
    fn to_subproc_stdio(self, interp: &Interpreter<'_>, shellio: &mut Option<IOWriterId>) -> Stdio {
        match self {
            OutKind::Fd(val) => {
                *shellio = Some(val.writer);
                if val.captured.is_some() {
                    Stdio::Capture
                } else {
                    // `IOWriter::fd()` (IOWriter.rs) returns `Fd::INVALID`
                    // once the fd has been handed off to libuv, so the
                    // sentinel compare here checks for that hand-off state.
                    let fd = interp.io_writers[val.writer].fd();
                    if fd != bun_sys::Fd::INVALID {
                        Stdio::Fd(fd)
                    } else {
                        // Windows: fd was moved to libuv → inherit (libuv
                        // already manages it). On POSIX `IOWriter::fd()` is
                        // always the live fd, so this branch is unreachable.
                        Stdio::Inherit
                    }
                }
            }
            OutKind::Pipe => Stdio::Pipe,
        }
    }
}
