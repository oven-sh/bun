//! Carries stdin/stdout/stderr for a state node.
//!
//! `IO` is a plain `Clone` value; `IOReader`/`IOWriter` are `Arc`-refcounted.
//! A command turns the `IO` it inherits into a [`CmdIO`] and applies its
//! redirect to that.

use std::sync::Arc;

use bun_collections::VecExt;
use bun_jsc::{JSValue, JsResult, PinnedArrayBuffer};
use bun_sys::Fd;

use crate::api::bun_spawn::stdio::{Capture, Dup2, Stdio};
use crate::shell::builtin::{IoKind, Kind};
use crate::shell::interpreter::{Interpreter, OutputNeedsIOSafeGuard, ShellExecEnv, shell_dup};
use crate::shell::io_reader::IOReader;
use crate::shell::io_writer::{self, IOWriter};
use crate::shell::shell_body::subproc::{ShellIO, StdioKind};
use crate::shell::yield_::Yield;
use crate::webcore;

#[derive(Clone, Default)]
pub(crate) struct IO {
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
}

#[derive(Clone, Default)]
pub(crate) enum InKind {
    Fd(std::sync::Arc<IOReader>),
    #[default]
    Ignore,
}

/// Write to a file descriptor (via `IOWriter`), tee into a captured buffer,
/// pipe to a subprocess, or drop.
#[derive(Clone, Default)]
pub(crate) enum OutKind {
    Fd(OutFd),
    Pipe,
    #[default]
    Ignore,
}

// Clone: bitwise OK for `captured` — it is a non-owning backref into
// `ShellExecEnv::_buffered_{stdout,stderr}`; the env owns the Vec. `writer`
// is `Arc` so it ref-counts on clone.
#[derive(Clone)]
pub(crate) struct OutFd {
    pub(crate) writer: std::sync::Arc<IOWriter>,
    /// If set, also append every chunk to this buffer (the JS-side captured
    /// stdout/stderr). Points into `ShellExecEnv::_buffered_{stdout,stderr}`.
    pub(crate) captured: Option<*mut Vec<u8>>,
}

impl InKind {
    fn memory_cost(&self) -> usize {
        match self {
            InKind::Fd(r) => r.memory_cost(),
            InKind::Ignore => 0,
        }
    }
}

impl OutFd {
    fn memory_cost(&self) -> usize {
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
}

// ──────────────────────────────────────────────────────────────────────────
// CmdIO
// ──────────────────────────────────────────────────────────────────────────

/// stdin, stdout and stderr of one command. `Cmd::init` builds it from the
/// `IO` that the command inherits. `Cmd::apply_redirect` then points the
/// redirected streams at their target. A builtin, a child process and the
/// shell's own messages about the command all use these streams.
pub(crate) struct CmdIO {
    pub(crate) stdin: CmdIn,
    pub(crate) stdout: CmdOut,
    pub(crate) stderr: CmdOut,
}

/// Where a command reads stdin from.
pub(crate) enum CmdIn {
    /// The inherited stream, or a file that a builtin reads through an `IOReader`.
    Fd(Arc<IOReader>),
    /// `< file` for a command that is not a builtin. The child reads the fd.
    File(bun_sys::File),
    /// `< ${buffer}` for a builtin.
    ArrayBuf(Box<PinnedArrayBuffer>),
    /// `< ${blob}` or `< ${response}` for a builtin.
    Blob(Box<webcore::Blob>),
    /// `< ${object}` for a command that is not a builtin: the index of the
    /// object in `Interpreter::jsobjs`. The spawn reads it.
    Js(u32),
    Ignore,
}

/// Where a command writes stdout or stderr to.
pub(crate) enum CmdOut {
    /// The inherited stream, or a file that a builtin writes through an `IOWriter`.
    Fd(OutFd),
    /// The captured buffer of the shell env: `_buffered_stdout` or `_buffered_stderr`.
    Buf(IoKind),
    /// `> file` for a command that is not a builtin. The fd stays blocking, as a child needs it.
    File(bun_sys::File),
    /// An fd that this stream does not own: the `File` of the other stream
    /// (`&> file`), or the fd of a `Bun.file(fd)`.
    BorrowedFd(Fd),
    /// `> ${buffer}` for a builtin.
    ArrayBuf(Box<ArrayBufSink>),
    /// `> ${buffer}` for a command that is not a builtin: the index of the
    /// buffer in `Interpreter::jsobjs`. The spawn pins it.
    JsBuf(u32),
    Ignore,
}

pub(crate) struct ArrayBufSink {
    pub(crate) buf: PinnedArrayBuffer,
    /// Offset of the next write.
    pub(crate) i: u32,
}

/// A JS object that a redirect can name: `> ${object}` or `< ${object}`.
pub(crate) enum JsObject {
    ArrayBuffer(JSValue),
    Blob(&'static webcore::Blob),
    Response(&'static webcore::Response),
}

impl JsObject {
    pub(crate) fn from_value(value: JSValue) -> Option<JsObject> {
        if value.js_type().is_array_buffer_like() {
            return Some(JsObject::ArrayBuffer(value));
        }
        if let Some(blob) = value.as_class_ref::<webcore::Blob>() {
            return Some(JsObject::Blob(blob));
        }
        value
            .as_class_ref::<webcore::Response>()
            .map(JsObject::Response)
    }
}

// `Cmd` is the largest state node. Its streams must not make it larger.
const _: () = assert!(size_of::<CmdOut>() == size_of::<OutKind>());
const _: () = assert!(size_of::<CmdIn>() == 2 * size_of::<InKind>());

impl From<IO> for CmdIO {
    fn from(io: IO) -> CmdIO {
        CmdIO {
            stdin: match io.stdin {
                InKind::Fd(reader) => CmdIn::Fd(reader),
                InKind::Ignore => CmdIn::Ignore,
            },
            stdout: CmdOut::inherited(io.stdout, IoKind::Stdout),
            stderr: CmdOut::inherited(io.stderr, IoKind::Stderr),
        }
    }
}

impl CmdIO {
    /// Maps the streams onto the stdio of a child process. `shellio` keeps the
    /// `IOWriter` of a captured stream, so that `PipeReader` can also write
    /// what it reads to it. `redirect_stdout`/`redirect_stderr` get the pin of
    /// a `> ${buffer}` target.
    #[inline]
    pub(crate) fn to_subproc_stdio(
        &self,
        interp: &Interpreter,
        stdio: &mut [Stdio; 3],
        shellio: &mut ShellIO,
        redirect_stdout: &mut Option<PinnedArrayBuffer>,
        redirect_stderr: &mut Option<PinnedArrayBuffer>,
    ) -> JsResult<()> {
        stdio[0] = self.stdin.to_subproc_stdio(interp)?;
        stdio[1] = self.stdout.to_subproc_stdio(
            interp,
            StdioKind::Stdout,
            &mut shellio.stdout,
            redirect_stdout,
        )?;
        stdio[2] = if self.stderr.is_same_stream(&self.stdout) {
            // `2>&1` or `1>&2`: the child gets the one stream on stdout.
            Stdio::Dup2(Dup2 {
                out: StdioKind::Stderr,
                to: StdioKind::Stdout,
            })
        } else {
            self.stderr.to_subproc_stdio(
                interp,
                StdioKind::Stderr,
                &mut shellio.stderr,
                redirect_stderr,
            )?
        };
        Ok(())
    }

    /// `PinnedArrayBuffer::drop`'s unpin would write to a `JSC::ArrayBuffer`
    /// impl the heap sweep already deleted; see
    /// `ShellSubprocess::defuse_array_buffer_unpins`. VM-shutdown finalizer
    /// only.
    #[cfg(not(windows))]
    pub(crate) fn defuse_array_buf_pins(&mut self) {
        if let CmdIn::ArrayBuf(buf) = &mut self.stdin {
            buf.defuse();
        }
        for out in [&mut self.stdout, &mut self.stderr] {
            if let CmdOut::ArrayBuf(sink) = out {
                sink.buf.defuse();
            }
        }
    }
}

impl CmdIn {
    #[inline]
    pub(crate) fn needs_io(&self) -> bool {
        matches!(self, CmdIn::Fd(_))
    }

    fn to_subproc_stdio(&self, interp: &Interpreter) -> JsResult<Stdio> {
        Ok(match self {
            CmdIn::Fd(reader) => Stdio::Fd(reader.fd()),
            CmdIn::File(file) => Stdio::Fd(file.handle()),
            CmdIn::Js(idx) => {
                let mut stdio = Stdio::Ignore;
                // `Cmd::apply_redirect` stored the index after this lookup worked.
                let Some((global, value)) = interp.js_object(*idx) else {
                    return Ok(stdio);
                };
                match JsObject::from_value(value) {
                    Some(JsObject::ArrayBuffer(value)) => {
                        // The child gets the bytes that the buffer holds now.
                        // An empty buffer is EOF, as in `Stdio::extract_blob`.
                        if let Some(buf) = value.as_array_buffer(global)
                            && !buf.byte_slice().is_empty()
                        {
                            stdio = Stdio::Blob(webcore::blob::Any::from_owned_slice(
                                buf.byte_slice().to_vec(),
                            ));
                        }
                    }
                    Some(JsObject::Blob(blob)) => {
                        stdio.extract_blob(global, webcore::blob::Any::Blob(blob.dupe()), 0)?;
                    }
                    Some(JsObject::Response(response)) => {
                        let body = response.get_body_value();
                        body.to_blob_if_possible();
                        stdio.extract_blob(global, body.use_as_any_blob(), 0)?;
                    }
                    None => {}
                }
                stdio
            }
            CmdIn::ArrayBuf(_) | CmdIn::Blob(_) => {
                unreachable!("the stdin of a builtin is not given to a child process")
            }
            CmdIn::Ignore => Stdio::Ignore,
        })
    }
}

impl CmdOut {
    /// `target` is the shell-env buffer that a captured stream appends to.
    fn inherited(out: OutKind, target: IoKind) -> CmdOut {
        match out {
            OutKind::Fd(fd) => CmdOut::Fd(fd),
            OutKind::Pipe => CmdOut::Buf(target),
            OutKind::Ignore => CmdOut::Ignore,
        }
    }

    /// The same stream again: for `2>&1` and `1>&2`, and for the second stream
    /// of `&> file`. A `Buf` keeps its target, so stderr after `2>&1` appends
    /// to the stdout buffer.
    pub(crate) fn dup(&self) -> CmdOut {
        match self {
            CmdOut::Fd(fd) => CmdOut::Fd(fd.clone()),
            CmdOut::Buf(target) => CmdOut::Buf(*target),
            CmdOut::File(file) => CmdOut::BorrowedFd(file.handle()),
            CmdOut::BorrowedFd(fd) => CmdOut::BorrowedFd(*fd),
            CmdOut::JsBuf(idx) => CmdOut::JsBuf(*idx),
            CmdOut::Ignore => CmdOut::Ignore,
            CmdOut::ArrayBuf(_) => unreachable!("each stream pins the buffer for itself"),
        }
    }

    /// True when both are one stream: `>&` made one a copy of the other.
    fn is_same_stream(&self, other: &CmdOut) -> bool {
        match (self, other) {
            (CmdOut::Fd(a), CmdOut::Fd(b)) => Arc::ptr_eq(&a.writer, &b.writer),
            (CmdOut::Buf(a), CmdOut::Buf(b)) => a == b,
            _ => false,
        }
    }

    #[inline]
    pub(crate) fn needs_io(&self) -> Option<OutputNeedsIOSafeGuard> {
        match self {
            CmdOut::Fd(_) => Some(OutputNeedsIOSafeGuard::OutputNeedsIo),
            _ => None,
        }
    }

    /// The buffer that gets the output of a child when the pipe it wrote to
    /// closes: the JS-side capture of an `Fd`, or the shell env's buffer.
    pub(crate) fn capture_buf(&self, shell: &mut ShellExecEnv) -> Option<*mut Vec<u8>> {
        match self {
            CmdOut::Fd(fd) => fd.captured,
            CmdOut::Buf(target) => Some(env_buf(shell, *target)),
            _ => None,
        }
    }

    /// Writes `buf` without an `IOWriter`: to the captured buffer, to the
    /// `> ${buffer}` target, or nowhere.
    ///
    /// Returns `Err(ENOSPC)` when an ArrayBuffer target is already full.
    /// **WARNING**: caller must have checked `needs_io() == None` first.
    ///
    /// # Safety
    /// `shell` must point to the live `ShellExecEnv` of the command that owns
    /// this stream (`cmd.base.shell`); only dereferenced for [`CmdOut::Buf`].
    pub(crate) unsafe fn write_no_io_to(
        &mut self,
        shell: *mut ShellExecEnv,
        buf: &[u8],
    ) -> bun_sys::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        match self {
            CmdOut::Fd(_) => {
                panic!("write_no_io called on fd output; caller must check needs_io()")
            }
            CmdOut::Buf(target) => {
                // Writes go straight through to `buffered_{stdout,stderr}`.
                // SAFETY: caller contract — shell env outlives the Cmd node
                // (single-threaded); the buffer is a live `ShellExecEnv` Bufio.
                unsafe { (*env_buf(&mut *shell, *target)).append_slice(buf) };
                Ok(buf.len())
            }
            CmdOut::ArrayBuf(sink) => {
                // `len = buf.len` stays usize so `i + len > byte_len` is
                // computed at usize width and cannot overflow; only the
                // stored cursor is u32.
                let idx = sink.i as usize;
                let total = sink.buf.byte_len;
                if idx >= total {
                    return Err(bun_sys::Error::from_code(
                        bun_sys::E::ENOSPC,
                        bun_sys::Tag::write,
                    ));
                }
                let write_len = (total - idx).min(buf.len());
                let dst = &mut sink.buf.slice_mut()[idx..idx + write_len];
                dst.copy_from_slice(&buf[..write_len]);
                sink.i = sink.i.saturating_add(write_len as u32);
                Ok(write_len)
            }
            CmdOut::Ignore => Ok(buf.len()),
            CmdOut::File(_) | CmdOut::BorrowedFd(_) | CmdOut::JsBuf(_) => {
                unreachable!("a stream for a child process; see `make_writable`")
            }
        }
    }

    /// Queue `buf` on this stream's IOWriter and arrange for `child`'s
    /// `on_io_writer_chunk` to fire when the chunk completes. Delegates to
    /// `fd.writer.enqueue` passing `fd.captured` as the tee bytelist.
    ///
    /// `_safeguard` proves the caller checked `needs_io()`.
    pub(crate) fn enqueue(
        &self,
        child: io_writer::ChildPtr,
        buf: &[u8],
        _safeguard: OutputNeedsIOSafeGuard,
    ) -> Yield {
        match self {
            CmdOut::Fd(fd) => fd.writer.enqueue(child, fd.captured, buf),
            _ => unreachable!("enqueue() on non-fd output; caller must check needs_io()"),
        }
    }

    /// Format with the optional `"{kind}: "` prefix and enqueue on the
    /// underlying IOWriter.
    pub(crate) fn enqueue_fmt(
        &self,
        child: io_writer::ChildPtr,
        kind: Option<Kind>,
        args: core::fmt::Arguments<'_>,
        _safeguard: OutputNeedsIOSafeGuard,
    ) -> Yield {
        match self {
            CmdOut::Fd(fd) => fd.writer.enqueue_fmt_bltn(child, fd.captured, kind, args),
            _ => unreachable!("enqueue_fmt() on non-fd output; caller must check needs_io()"),
        }
    }

    /// Makes a stream that `Cmd::apply_redirect` set up for a child process
    /// into one that the shell itself can write to: the command did not start,
    /// and the shell reports that on it. A target that cannot be written to
    /// becomes `Ignore`.
    pub(crate) fn make_writable(&mut self, interp: &Interpreter) {
        let fd = match core::mem::replace(self, CmdOut::Ignore) {
            // The `IOWriter` takes over the fd.
            CmdOut::File(file) => Ok(file.into_raw()),
            // The owner keeps its fd. The `IOWriter` closes a copy.
            CmdOut::BorrowedFd(fd) => shell_dup(fd),
            CmdOut::JsBuf(idx) => {
                if let Some(buf) = interp
                    .js_object(idx)
                    .and_then(|(global, value)| PinnedArrayBuffer::root(global, value))
                {
                    *self = CmdOut::ArrayBuf(Box::new(ArrayBufSink { buf, i: 0 }));
                }
                return;
            }
            writable @ (CmdOut::Fd(_) | CmdOut::Buf(_) | CmdOut::ArrayBuf(_) | CmdOut::Ignore) => {
                *self = writable;
                return;
            }
        };
        let Ok(fd) = fd else { return };
        let writer = IOWriter::init(
            fd,
            io_writer::Flags {
                pollable: cfg!(windows),
                ..Default::default()
            },
            interp.event_loop,
        );
        writer.set_interp(interp.as_ctx_ptr());
        *self = CmdOut::Fd(OutFd {
            writer,
            captured: None,
        });
    }

    /// The stdio that a child process gets for this stream.
    #[inline]
    fn to_subproc_stdio(
        &self,
        interp: &Interpreter,
        kind: StdioKind,
        shellio: &mut Option<Arc<IOWriter>>,
        redirect_buf: &mut Option<PinnedArrayBuffer>,
    ) -> JsResult<Stdio> {
        Ok(match self {
            CmdOut::Fd(val) => {
                // `PipeReader::captured_writer` drains what it captures into it.
                *shellio = Some(Arc::clone(&val.writer));
                if let Some(cap) = val.captured {
                    #[cfg(not(any(target_os = "linux", target_os = "android")))]
                    let _ = cap;
                    Stdio::Capture(Capture {
                        #[cfg(any(target_os = "linux", target_os = "android"))]
                        buf: cap,
                    })
                } else {
                    // `IOWriter::fd()` (IOWriter.rs) returns `Fd::INVALID`
                    // once the fd has been handed off to libuv, so the
                    // sentinel compare here checks for that hand-off state.
                    let fd = val.writer.fd();
                    if fd != Fd::INVALID {
                        Stdio::Fd(fd)
                    } else {
                        // Windows: fd was moved to libuv → inherit (libuv
                        // already manages it). On POSIX `IOWriter::fd()` is
                        // always the live fd, so this branch is unreachable.
                        Stdio::Inherit
                    }
                }
            }
            CmdOut::Buf(_) => Stdio::Pipe,
            CmdOut::File(file) => Stdio::Fd(file.handle()),
            // `> ${Bun.stdout}` is the stdout that the child has already, as in `Stdio::extract_blob`.
            CmdOut::BorrowedFd(fd) if *fd == kind.to_fd() => Stdio::Inherit,
            CmdOut::BorrowedFd(fd) => Stdio::Fd(*fd),
            CmdOut::JsBuf(idx) => {
                // `Cmd::apply_redirect` stored the index after this lookup worked.
                let Some((global, value)) = interp.js_object(*idx) else {
                    return Ok(Stdio::Ignore);
                };
                let Some(buf) = PinnedArrayBuffer::root(global, value) else {
                    return Err(global.throw_out_of_memory());
                };
                *redirect_buf = Some(buf);
                Stdio::Pipe
            }
            CmdOut::ArrayBuf(_) => {
                unreachable!("the buffer of a builtin is not given to a child process")
            }
            CmdOut::Ignore => Stdio::Ignore,
        })
    }
}

/// The captured stdout or stderr of `shell`.
fn env_buf(shell: &mut ShellExecEnv, target: IoKind) -> *mut Vec<u8> {
    match target {
        IoKind::Stdout => shell.buffered_stdout(),
        IoKind::Stderr => shell.buffered_stderr(),
    }
}
