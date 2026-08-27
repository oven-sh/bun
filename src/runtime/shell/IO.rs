//! Carries stdin/stdout/stderr for a state node.
//!
//! `IO` is a plain `Clone` value; `IOReader`/`IOWriter` are `Rc`-refcounted.

use bun_collections::VecExt;
use bun_ptr::RefPtr;

use crate::api::bun_spawn::stdio::Stdio;
use crate::shell::interpreter::{CapturedBuf, OutputNeedsIOSafeGuard};
use crate::shell::io_reader::IOReader;
use crate::shell::io_writer::IOWriter;
use crate::shell::shell_body::subproc::ShellIO;

#[derive(Clone, Default)]
pub struct IO {
    pub(crate) stdin: InKind,
    pub(crate) stdout: OutKind,
    pub(crate) stderr: OutKind,
}

impl IO {
    /// Sum of stdin/stdout/stderr.
    pub(crate) fn memory_cost(&self) -> usize {
        let mut size = core::mem::size_of::<IO>();
        size += self.stdin.memory_cost();
        size += self.stdout.memory_cost();
        size += self.stderr.memory_cost();
        size
    }

    /// Maps the state-node IO triple onto
    /// `subproc::Stdio` for [`ShellSubprocess::spawn_async`], and stashes the
    /// owning `IOWriter` `Rc`s on `shellio` so [`PipeReader`]'s captured-writer
    /// path can tee subprocess output back into the JS-side buffers.
    pub(crate) fn to_subproc_stdio(&self, stdio: &mut [Stdio; 3], shellio: &mut ShellIO) {
        stdio[0] = self.stdin.to_subproc_stdio();
        stdio[1] = self.stdout.to_subproc_stdio(&mut shellio.stdout);
        stdio[2] = self.stderr.to_subproc_stdio(&mut shellio.stderr);
    }
}

#[derive(Clone, Default)]
pub enum InKind {
    Fd(RefPtr<IOReader>),
    #[default]
    Ignore,
}

/// Write to a file descriptor (via `IOWriter`), tee into a captured buffer,
/// pipe to a subprocess, or drop.
#[derive(Clone, Default)]
pub enum OutKind {
    Fd(OutFd),
    Pipe,
    #[default]
    Ignore,
}

#[derive(Clone)]
pub struct OutFd {
    pub(crate) writer: RefPtr<IOWriter>,
    /// If set, also append every chunk to this buffer (the JS-side captured
    /// stdout/stderr, shared with `ShellExecEnv::buffered_{stdout,stderr}`).
    pub(crate) captured: Option<CapturedBuf>,
}

impl InKind {
    fn memory_cost(&self) -> usize {
        match self {
            InKind::Fd(r) => r.memory_cost(),
            InKind::Ignore => 0,
        }
    }

    fn to_subproc_stdio(&self) -> Stdio {
        match self {
            InKind::Fd(r) => Stdio::Fd(r.fd()),
            InKind::Ignore => Stdio::Ignore,
        }
    }
}

impl OutFd {
    fn memory_cost(&self) -> usize {
        let mut cost = self.writer.memory_cost();
        if let Some(captured) = &self.captured {
            cost += captured.borrow().memory_cost();
        }
        cost
    }
}

impl OutKind {
    fn memory_cost(&self) -> usize {
        match self {
            OutKind::Fd(fd) => fd.memory_cost(),
            _ => 0,
        }
    }

    /// If this output requires async IO (i.e. it's an `Fd`), return the
    /// safeguard token; otherwise `None` and the caller can write
    /// synchronously to the captured buffer / drop.
    pub(crate) fn needs_io(&self) -> Option<OutputNeedsIOSafeGuard> {
        match self {
            OutKind::Fd(_) => Some(OutputNeedsIOSafeGuard::OutputNeedsIo),
            _ => None,
        }
    }

    /// Retains the `IOWriter` on
    /// `shellio` so the subprocess's `PipeReader::captured_writer` can drain
    /// captured bytes into it after the spawn returns.
    fn to_subproc_stdio(&self, shellio: &mut Option<RefPtr<IOWriter>>) -> Stdio {
        match self {
            OutKind::Fd(val) => {
                *shellio = Some(val.writer.clone());
                if val.captured.is_some() {
                    Stdio::Capture
                } else {
                    // `IOWriter::fd()` (IOWriter.rs) returns `Fd::INVALID`
                    // once the fd has been handed off to libuv, so the
                    // sentinel compare here checks for that hand-off state.
                    let fd = val.writer.fd();
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
            OutKind::Ignore => Stdio::Ignore,
        }
    }
}
