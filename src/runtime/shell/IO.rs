//! Carries stdin/stdout/stderr for a state node.
//!
//! In the NodeId-arena port `IO` is a plain `Clone` value (the Zig version
//! used intrusive refcounts on `IOReader`/`IOWriter`; here those are `Arc`).

use bun_collections::{VecExt, ByteVecExt};
use core::fmt;

use crate::shell::interpreter::{ByteList, OutputNeedsIOSafeGuard};
use crate::shell::io_reader::IOReader;
use crate::shell::io_writer::IOWriter;

#[derive(Clone, Default)]
pub struct IO {
    pub stdin: InKind,
    pub stdout: OutKind,
    pub stderr: OutKind,
}

impl fmt::Display for IO {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "stdin: {}\nstdout: {}\nstderr: {}", self.stdin, self.stdout, self.stderr)
    }
}

impl IO {
    /// Zig `copy` = `ref()` + struct copy. With `Arc` fields, `Clone`
    /// increments refcounts and copies the struct in one step.
    #[inline]
    pub fn copy(&self) -> IO { self.clone() }

    /// Spec: IO.zig `memoryCost` — sum of stdin/stdout/stderr.
    pub fn memory_cost(&self) -> usize {
        let mut size = core::mem::size_of::<IO>();
        size += self.stdin.memory_cost();
        size += self.stdout.memory_cost();
        size += self.stderr.memory_cost();
        size
    }
}

#[derive(Clone, Default)]
pub enum InKind {
    Fd(std::sync::Arc<IOReader>),
    #[default]
    Ignore,
}

impl fmt::Display for InKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            InKind::Fd(_) => write!(f, "fd"),
            InKind::Ignore => write!(f, "ignore"),
        }
    }
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
    pub writer: std::sync::Arc<IOWriter>,
    /// If set, also append every chunk to this buffer (the JS-side captured
    /// stdout/stderr). Points into `ShellExecEnv::_buffered_{stdout,stderr}`.
    pub captured: Option<*mut ByteList>,
}

impl fmt::Display for OutKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            OutKind::Fd(_) => write!(f, "fd"),
            OutKind::Pipe => write!(f, "pipe"),
            OutKind::Ignore => write!(f, "ignore"),
        }
    }
}

impl InKind {
    /// Spec: IO.zig `InKind.memoryCost`.
    pub fn memory_cost(&self) -> usize {
        match self {
            InKind::Fd(r) => r.memory_cost(),
            InKind::Ignore => 0,
        }
    }
}

impl OutFd {
    /// Spec: IO.zig `OutKind.Fd.memoryCost`.
    pub fn memory_cost(&self) -> usize {
        let mut cost = self.writer.memory_cost();
        if let Some(captured) = self.captured {
            // SAFETY: `captured` points into a live `ShellExecEnv` buffer;
            // the env outlives the IO that borrows it.
            cost += unsafe { (*captured).memory_cost() };
        }
        cost
    }
}

impl OutKind {
    /// Spec: IO.zig `OutKind.memoryCost`.
    pub fn memory_cost(&self) -> usize {
        match self {
            OutKind::Fd(fd) => fd.memory_cost(),
            _ => 0,
        }
    }

    /// If this output requires async IO (i.e. it's an `Fd`), return the
    /// safeguard token; otherwise `None` and the caller can write
    /// synchronously to the captured buffer / drop.
    pub fn needs_io(&self) -> Option<OutputNeedsIOSafeGuard> {
        match self {
            OutKind::Fd(_) => Some(OutputNeedsIOSafeGuard::OutputNeedsIo),
            _ => None,
        }
    }
}

// The full body (to_subproc_stdio, memory_cost, enqueue, etc.) is deferred —
// depends on subproc::Stdio and IOWriter::enqueue. See PORT STATUS below.
// TODO(blocked_on: subproc::Stdio, IOWriter::enqueue): port to_subproc_stdio /
// memory_cost / enqueue once those land.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/IO.zig (185 lines)
//   confidence: medium
//   blocked_on: subproc::Stdio, IOWriter::enqueue
// ──────────────────────────────────────────────────────────────────────────
