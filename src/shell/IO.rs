//! This struct carries around information for a state node's stdin/stdout/stderr.

use core::fmt;
use std::sync::Arc;

use bun_collections::ByteList;

use crate::interpret::{OutputNeedsIOSafeGuard, STDERR_NO, STDOUT_NO};
use crate::interpreter::builtin::Kind as BuiltinKind;
use crate::interpreter::{IOReader, IOWriter};
use crate::subproc::{ShellIO, Stdio};

#[derive(Clone)]
pub struct IO {
    pub stdin: InKind,
    pub stdout: OutKind,
    pub stderr: OutKind,
}

impl fmt::Display for IO {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "stdin: {}\nstdout: {}\nstderr: {}",
            self.stdin, self.stdout, self.stderr
        )
    }
}

impl IO {
    pub fn memory_cost(&self) -> usize {
        let mut size: usize = core::mem::size_of::<IO>();
        size += self.stdin.memory_cost();
        size += self.stdout.memory_cost();
        size += self.stderr.memory_cost();
        size
    }

    // PORT NOTE: Zig `deinit` only deref'd the Arc-backed fields; Rust `Drop` on
    // `Arc` handles this automatically, so no explicit `Drop` impl is needed.

    pub fn copy(&self) -> IO {
        // PORT NOTE: Zig `copy` = `ref()` + struct copy. With `Arc` fields,
        // `Clone` increments the refcounts and copies the struct in one step.
        self.clone()
    }

    pub fn ref_(&self) -> IO {
        // PORT NOTE: reshaped — Zig returned `*IO` after bumping child refcounts
        // in place; in Rust the only way to "bump + return a usable handle" with
        // `Arc` fields is to clone. Callers that used `_ = this.ref()` purely for
        // the side effect should call `.copy()` (or `.clone()`) and keep the
        // result alive instead.
        self.clone()
    }

    pub fn deref(self) {
        // PORT NOTE: consuming `self` drops the `Arc` fields, matching Zig's
        // manual `deref()` on each child.
        drop(self);
    }

    pub fn to_subproc_stdio(&self, stdio: &mut [Stdio; 3], shellio: &mut ShellIO) {
        self.stdin.to_subproc_stdio(&mut stdio[0]);
        stdio[STDOUT_NO] = self.stdout.to_subproc_stdio(&mut shellio.stdout);
        stdio[STDERR_NO] = self.stderr.to_subproc_stdio(&mut shellio.stderr);
    }
}

#[derive(Clone)]
pub enum InKind {
    Fd(Arc<IOReader>),
    Ignore,
}

impl fmt::Display for InKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            InKind::Fd(fd) => write!(f, "fd: {}", fd.fd),
            InKind::Ignore => write!(f, "ignore"),
        }
    }
}

impl InKind {
    pub fn ref_(&self) -> InKind {
        // PORT NOTE: with `Arc`, bumping the refcount == cloning the variant.
        self.clone()
    }

    pub fn deref(self) {
        // PORT NOTE: dropping `self` decrements the `Arc` if `Fd`.
        drop(self);
    }

    pub fn close(self) {
        // Zig `close` was identical to `deref`.
        drop(self);
    }

    pub fn to_subproc_stdio(&self, stdio: &mut Stdio) {
        match self {
            InKind::Fd(fd) => {
                *stdio = Stdio::Fd(fd.fd);
            }
            InKind::Ignore => {
                *stdio = Stdio::Ignore;
            }
        }
    }

    pub fn memory_cost(&self) -> usize {
        match self {
            InKind::Fd(fd) => fd.memory_cost(),
            InKind::Ignore => 0,
        }
    }
}

/// Write/Read to/from file descriptor.
/// If `captured` is non-null, it will write to std{out,err} and also buffer it.
/// The pointer points to the `buffered_stdout`/`buffered_stdin` fields
/// in the Interpreter struct.
#[derive(Clone)]
pub struct OutKindFd {
    pub writer: Arc<IOWriter>,
    // BACKREF: points at `&this.root_shell._buffered_stdout.owned` on the parent
    // Interpreter; the Interpreter outlives every IO node.
    pub captured: Option<*mut ByteList>,
}

impl OutKindFd {
    pub fn memory_cost(&self) -> usize {
        let mut cost: usize = self.writer.memory_cost();
        if let Some(captured) = self.captured {
            // SAFETY: `captured` is a backref into the owning Interpreter's
            // `_buffered_{stdout,stderr}` field, which outlives this IO node.
            cost += unsafe { (*captured).memory_cost() };
        }
        cost
    }
}

#[derive(Clone)]
pub enum OutKind {
    /// Write/Read to/from file descriptor.
    Fd(OutKindFd),
    /// Buffers the output (handled in Cmd.BufferedIoClosed.close()).
    ///
    /// This is set when the shell is called with `.quiet()`.
    Pipe,
    /// Discards output.
    Ignore,
}

impl OutKind {
    pub fn memory_cost(&self) -> usize {
        match self {
            OutKind::Fd(fd) => fd.memory_cost(),
            OutKind::Pipe => 0,
            OutKind::Ignore => 0,
        }
    }
}

// fn dupeForSubshell(this: *ShellExecEnv,
impl fmt::Display for OutKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            OutKind::Fd(fd) => write!(f, "fd: {}", fd.writer.fd),
            OutKind::Pipe => write!(f, "pipe"),
            OutKind::Ignore => write!(f, "ignore"),
        }
    }
}

impl OutKind {
    pub fn ref_(&self) -> Self {
        // PORT NOTE: with `Arc`, bumping the refcount == cloning the variant.
        self.clone()
    }

    pub fn deref(self) {
        self.close();
    }

    pub fn enqueue_fmt_bltn<P>(
        &mut self,
        ptr: P,
        // PERF(port): was `comptime kind: ?Builtin.Kind` — profile in Phase B.
        kind: Option<BuiltinKind>,
        // PORT NOTE: Zig took `comptime fmt_: []const u8` + `args: anytype`;
        // collapsed into `core::fmt::Arguments` per the porting guide.
        args: fmt::Arguments<'_>,
        _: OutputNeedsIOSafeGuard,
    ) {
        match self {
            OutKind::Fd(fd) => {
                fd.writer.enqueue_fmt_bltn(ptr, fd.captured, kind, args);
            }
            // Zig accessed `this.fd.*` unconditionally (illegal-behavior on
            // non-.fd); preserve that contract with an unreachable.
            _ => unreachable!("enqueue_fmt_bltn called on non-Fd OutKind"),
        }
    }

    fn close(self) {
        match self {
            OutKind::Fd(fd) => {
                drop(fd); // decrements `Arc<IOWriter>`
            }
            _ => {}
        }
    }

    fn to_subproc_stdio(&self, shellio: &mut Option<Arc<IOWriter>>) -> Stdio {
        match self {
            OutKind::Fd(val) => 'brk: {
                *shellio = Some(Arc::clone(&val.writer)); // Zig: val.writer.dupeRef()
                break 'brk if let Some(cap) = val.captured {
                    Stdio::Capture { buf: cap }
                } else if let Some(fd) = val.writer.fd.get() {
                    // We have a valid fd that hasn't been moved to libuv
                    Stdio::Fd(fd)
                } else {
                    // On Windows, the fd might have been moved to libuv.
                    // In this case, the subprocess should inherit the stdio
                    // since libuv is already managing it.
                    Stdio::Inherit
                };
            }
            OutKind::Pipe => Stdio::Pipe,
            OutKind::Ignore => Stdio::Ignore,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/IO.zig (208 lines)
//   confidence: medium
//   todos:      0
//   notes:      ref/deref/close reshaped around Arc<> Clone/Drop; verify IOReader/IOWriter end up as Arc (vs IntrusiveRc) in Phase B
// ──────────────────────────────────────────────────────────────────────────
