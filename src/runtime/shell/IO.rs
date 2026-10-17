//! Carries stdin/stdout/stderr for a state node.
//!
//! `IO` is a plain `Clone` value; `IOReader`/`IOWriter` are `Arc`-refcounted.
//! A command applies its redirect to a [`CmdIO`] made from the `IO` it inherits.

use std::sync::Arc;

use bun_collections::VecExt;
use bun_jsc::{JSValue, JsResult, PinnedArrayBuffer};
use bun_sys::Fd;

use crate::api::bun_spawn::stdio::{Capture, Dup2, Stdio};
use crate::shell::builtin::{IoKind, Kind};
use crate::shell::interpreter::{Interpreter, OutputNeedsIOSafeGuard, ShellExecEnv, is_pollable};
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

/// The streams of one command. `Cmd::apply_redirect` points them at the target of its redirect.
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
    /// `< ${object}` for a child process: the index of the object in `Interpreter::jsobjs`.
    Js(u32),
    Ignore,
}

/// Where a command writes stdout or stderr to.
pub(crate) enum CmdOut {
    /// The inherited stream, or a file that a builtin writes through an `IOWriter`.
    Fd(OutFd),
    /// The captured buffer of the shell env: `_buffered_stdout` or `_buffered_stderr`.
    Buf(IoKind),
    /// `> file` or `> ${Bun.file(fd)}` for a child process: an fd that stays blocking.
    File(bun_sys::File),
    /// The fd of the `File` that the other stream owns: `&> file`.
    BorrowedFd(Fd),
    /// `> ${buffer}` for a builtin.
    ArrayBuf(Box<ArrayBufSink>),
    /// `> ${buffer}` for a child process: the index of the buffer in `Interpreter::jsobjs`.
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
    /// Maps the streams onto the stdio of a child process.
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
        stdio[1] = self
            .stdout
            .to_subproc_stdio(interp, &mut shellio.stdout, redirect_stdout)?;
        stdio[2] = if !self.stderr.is_same_stream(&self.stdout) {
            self.stderr
                .to_subproc_stdio(interp, &mut shellio.stderr, redirect_stderr)?
        } else {
            // `2>&1` or `1>&2`: the child gets the one stream on stdout.
            match &stdio[1] {
                // Windows: `Dup2` is a pipe that only a captured stdout reads.
                Stdio::Fd(fd) if cfg!(windows) => Stdio::Fd(*fd),
                _ => Stdio::Dup2(Dup2 {
                    out: StdioKind::Stderr,
                    to: StdioKind::Stdout,
                }),
            }
        };
        Ok(())
    }

    /// VM-shutdown finalizer only; see `ShellSubprocess::defuse_array_buffer_unpins`.
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
                        // A copy of the bytes now. Empty is EOF, as in `Stdio::extract_blob`.
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

    /// The same stream again: for `2>&1`, `1>&2` and the other stream of `&> file`.
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

    /// Where the output that a child wrote to a pipe is captured.
    pub(crate) fn capture_buf(&self, shell: &mut ShellExecEnv) -> Option<*mut Vec<u8>> {
        match self {
            CmdOut::Fd(fd) => fd.captured,
            CmdOut::Buf(target) => Some(env_buf(shell, *target)),
            _ => None,
        }
    }

    /// `needs_io()` must be `None`. Safety: `shell` is the live env of the owning `Cmd`.
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
                // SAFETY: caller contract: `shell` is live, and so is its buffer.
                unsafe { (*env_buf(&mut *shell, *target)).append_slice(buf) };
                Ok(buf.len())
            }
            CmdOut::ArrayBuf(sink) => {
                // usize arithmetic: only the stored cursor is u32.
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

    /// Queues `buf` on the IOWriter; `child` gets `on_io_writer_chunk` when it completes.
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

    /// Formats with the optional `"{kind}: "` prefix and enqueues on the IOWriter.
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

    /// A stream that writes to `fd` and closes it. The blocking mode of the fd is not changed.
    pub(crate) fn writer(interp: &Interpreter, fd: Fd) -> CmdOut {
        let writer = IOWriter::init(
            fd,
            io_writer::Flags {
                pollable: is_pollable(fd),
                ..Default::default()
            },
            interp.event_loop,
        );
        writer.set_interp(interp.as_ctx_ptr());
        CmdOut::Fd(OutFd {
            writer,
            captured: None,
        })
    }

    /// Makes a stderr set up for a child writable by the shell. `Err`: a JS error is thrown.
    pub(crate) fn make_writable(&mut self, interp: &Interpreter) -> JsResult<()> {
        match self {
            CmdOut::Fd(_) | CmdOut::Buf(_) | CmdOut::ArrayBuf(_) | CmdOut::Ignore => {}
            CmdOut::JsBuf(idx) => {
                // `Cmd::apply_redirect` stored the index after this lookup worked.
                let Some((global, value)) = interp.js_object(*idx) else {
                    *self = CmdOut::Ignore;
                    return Ok(());
                };
                let Some(buf) = PinnedArrayBuffer::root(global, value) else {
                    return Err(global.throw_out_of_memory());
                };
                *self = CmdOut::ArrayBuf(Box::new(ArrayBufSink { buf, i: 0 }));
            }
            CmdOut::File(_) => {
                // The writer takes over the fd.
                if let CmdOut::File(file) = core::mem::replace(self, CmdOut::Ignore) {
                    *self = CmdOut::writer(interp, file.into_raw());
                }
            }
            CmdOut::BorrowedFd(_) => {
                unreachable!("stderr owns the fd of its target; see `Redirected::set_out`")
            }
        }
        Ok(())
    }

    /// The stdio that a child process gets for this stream.
    #[inline]
    fn to_subproc_stdio(
        &self,
        interp: &Interpreter,
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
                        // Windows: libuv owns the fd now. Name the process stream if it is one.
                        match interp.process_stream(&val.writer) {
                            Some(fd) => Stdio::Fd(fd),
                            None => Stdio::Inherit,
                        }
                    }
                }
            }
            CmdOut::Buf(_) => Stdio::Pipe,
            CmdOut::File(file) => Stdio::Fd(file.handle()),
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
