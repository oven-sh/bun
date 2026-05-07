//! Carries stdin/stdout/stderr for a state node.
//!
//! In the NodeId-arena port `IO` is a plain `Clone` value (the Zig version
//! used intrusive refcounts on `IOReader`/`IOWriter`; here those are `Arc`).

use bun_collections::{VecExt, ByteVecExt};
use core::fmt;

use crate::shell::interpreter::{OutputNeedsIOSafeGuard};
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

// Clone: bitwise OK for `captured` — it is a non-owning backref into
// `ShellExecEnv::_buffered_{stdout,stderr}`; the env owns the Vec. `writer`
// is `Arc` so it ref-counts on clone.
#[derive(Clone)]
pub struct OutFd {
    pub writer: std::sync::Arc<IOWriter>,
    /// If set, also append every chunk to this buffer (the JS-side captured
    /// stdout/stderr). Points into `ShellExecEnv::_buffered_{stdout,stderr}`.
    pub captured: Option<*mut Vec<u8>>,
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

    /// Spec: IO.zig `InKind.to_subproc_stdio`.
    pub fn to_subproc_stdio(&self, stdio: &mut crate::shell::util::Stdio) {
        use crate::shell::util::Stdio;
        match self {
            InKind::Fd(reader) => *stdio = Stdio::Fd(reader.fd()),
            InKind::Ignore => *stdio = Stdio::Ignore,
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

    /// Spec: IO.zig `OutKind.to_subproc_stdio`.
    fn to_subproc_stdio(
        &self,
        shellio: &mut Option<std::sync::Arc<IOWriter>>,
    ) -> crate::shell::util::Stdio {
        use crate::api::bun_spawn::stdio::Capture;
        use crate::shell::util::Stdio;
        match self {
            OutKind::Fd(val) => {
                *shellio = Some(val.writer.clone());
                if let Some(cap) = val.captured {
                    Stdio::Capture(Capture { buf: cap })
                } else {
                    // PORT NOTE: Zig branches on `val.writer.fd.get()` (a
                    // `MovableIfWindowsFd`); the Rust `IOWriter` stores a
                    // plain `Fd`, so the moved-to-libuv Windows fallback
                    // (`.inherit`) is unreachable here.
                    Stdio::Fd(val.writer.fd())
                }
            }
            OutKind::Pipe => Stdio::Pipe,
            OutKind::Ignore => Stdio::Ignore,
        }
    }
}

impl IO {
    /// Spec: IO.zig `to_subproc_stdio`. Populates `stdio[0..3]` for
    /// `bun_process::spawn_process` and returns the `IOWriter` handles via
    /// `shellio` so [`crate::shell::subproc::Readable::init`] can wire its
    /// `CapturedWriter` tee.
    pub fn to_subproc_stdio(
        &self,
        stdio: &mut [crate::shell::util::Stdio; 3],
        shellio: &mut crate::shell::subproc::ShellIO,
    ) {
        self.stdin.to_subproc_stdio(&mut stdio[0]);
        stdio[1] = self.stdout.to_subproc_stdio(&mut shellio.stdout);
        stdio[2] = self.stderr.to_subproc_stdio(&mut shellio.stderr);
    }
}

// TODO(blocked_on: IOWriter::enqueue): port enqueue helpers once those land.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/IO.zig (185 lines)
//   confidence: medium
//   blocked_on: subproc::Stdio, IOWriter::enqueue
// ──────────────────────────────────────────────────────────────────────────
