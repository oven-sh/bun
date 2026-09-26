//! Abstraction to allow multiple writers that can write to a file descriptor.
//!
//! This exists because kqueue/epoll does not work when registering multiple
//! poll events on the same file descriptor.
//!
//! One way to get around this limitation is to just call `.dup()` on the file
//! descriptor, which we do for the top-level stdin/stdout/stderr. But calling
//! `.dup()` for every concurrent writer is expensive.
//!
//! So `IOWriter` is essentially a writer queue to a file descriptor.
//!
//! `IOWriter` is reference counted (`Arc`), which simplifies management of the
//! file descriptor.

use bun_collections::VecExt;
use core::cell::UnsafeCell;
#[cfg(not(windows))]
use core::ffi::c_void;
use std::collections::VecDeque;

use bun_sys::{self as sys, E, Fd};

use crate::shell::interpreter::{EventLoopHandle, Interpreter, NodeId};
use crate::shell::yield_::Yield;

// ──────────────────────────────────────────────────────────────────────────
// ChildPtr
// ──────────────────────────────────────────────────────────────────────────

/// In the NodeId-arena port, a "writer child" is `(NodeId, WriterTag)` — the
/// id of the owning state node plus a tag saying which `on_io_writer_chunk`
/// impl to dispatch to.
///
/// The one tag that does **not** live in the NodeId arena is
/// `WriterTag::Subproc` (the `subproc::CapturedWriter` embedded inside a
/// heap-allocated `PipeReader`); for that variant the dispatch target is
/// carried in `raw` instead of `node`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ChildPtr {
    pub node: NodeId,
    pub(crate) tag: WriterTag,
    /// Only meaningful when `tag == Subproc` — `*mut subproc::CapturedWriter`.
    /// `core::ptr::null_mut()` otherwise. Stored untyped to keep this header
    /// free of a `subproc` dependency.
    pub(crate) raw: *mut core::ffi::c_void,
}

impl ChildPtr {
    const NULL: ChildPtr = ChildPtr {
        node: NodeId::NONE,
        tag: WriterTag::Cmd,
        raw: core::ptr::null_mut(),
    };

    #[inline]
    pub(crate) const fn new(node: NodeId, tag: WriterTag) -> ChildPtr {
        ChildPtr {
            node,
            tag,
            raw: core::ptr::null_mut(),
        }
    }

    /// Construct a `ChildPtr` targeting a `subproc::CapturedWriter` (lives
    /// outside the NodeId arena).
    #[inline]
    pub(crate) fn subproc_capture(cw: *mut core::ffi::c_void) -> ChildPtr {
        ChildPtr {
            node: NodeId::NONE,
            tag: WriterTag::Subproc,
            raw: cw,
        }
    }

    #[inline]
    fn is_null(&self) -> bool {
        self.node == NodeId::NONE && self.raw.is_null()
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum WriterTag {
    /// Builtin running inside a Cmd — dispatch via `Builtin::on_io_writer_chunk`.
    Builtin,
    Cmd,
    CondExpr,
    Pipeline,
    /// `subproc::PipeReader::CapturedWriter` — heap-allocated, addressed via
    /// `ChildPtr::raw` rather than `node`.
    Subproc,
}

// ──────────────────────────────────────────────────────────────────────────
// Flags / Writer queue entry
// ──────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub(crate) struct Flags {
    /// Whether what the fd is has been asked; the first chunk asks
    /// (`IOWriter::classify`). `pollable` means nothing before that.
    classified: bool,
    /// A write may wait for whoever is at the other end (a pipe, a socket, a
    /// terminal), so it goes through the event loop. A write to anything else
    /// is made in place: a disk file, and on POSIX a device such as
    /// `/dev/null` too.
    pub(crate) pollable: bool,
    #[cfg(not(windows))]
    pub(crate) nonblock: bool,
    #[cfg(not(windows))]
    pub(crate) is_socket: bool,
    /// Where a pipe came from, for the source that writes to it.
    #[cfg(windows)]
    pub(crate) origin: bun_io::windows::PipeOrigin,
    /// What `classify` found the fd to be, for the source that writes to it.
    #[cfg(windows)]
    kind: Option<sys::FileKind>,
    pub(crate) broken_pipe: bool,
}

impl Flags {
    /// An fd nobody has asked anything about: a duplicate of the process's
    /// stdout or stderr, a redirect target on Windows.
    pub(crate) fn unclassified() -> Flags {
        Flags {
            classified: false,
            pollable: false,
            #[cfg(not(windows))]
            nonblock: false,
            #[cfg(not(windows))]
            is_socket: false,
            #[cfg(windows)]
            origin: bun_io::windows::PipeOrigin::Foreign,
            #[cfg(windows)]
            kind: None,
            broken_pipe: false,
        }
    }

    /// A redirect target, which opening it has classified.
    #[cfg(not(windows))]
    pub(crate) fn classified(pollable: bool, nonblock: bool, is_socket: bool) -> Flags {
        Flags {
            classified: true,
            pollable,
            nonblock,
            is_socket,
            broken_pipe: false,
        }
    }

    /// The write end of a pipe between two commands whose writing command may
    /// turn out to be a child process, which inherits it: a socketpair end on
    /// POSIX, a synchronous pipe end on Windows.
    pub(crate) fn pipe() -> Flags {
        Flags {
            classified: true,
            pollable: true,
            #[cfg(not(windows))]
            nonblock: false,
            #[cfg(not(windows))]
            is_socket: true,
            #[cfg(windows)]
            origin: bun_io::windows::PipeOrigin::CreatedSynchronous,
            #[cfg(windows)]
            kind: None,
            broken_pipe: false,
        }
    }

    /// The write end of a pipe between two commands that only a builtin
    /// writes to: an overlapped end, which runs on the loop's port.
    #[cfg(windows)]
    pub(crate) fn overlapped_pipe() -> Flags {
        Flags {
            classified: true,
            pollable: true,
            origin: bun_io::windows::PipeOrigin::Created,
            kind: None,
            broken_pipe: false,
        }
    }
}

/// One queued chunk: which child enqueued it, its bytes, how many of those
/// have been written so far, and an optional `Vec<u8>` to tee into.
struct Writer {
    ptr: ChildPtr,
    data: Vec<u8>,
    written: usize,
    bytelist: Option<*mut Vec<u8>>,
}

impl Writer {
    #[inline]
    fn remaining(&self) -> &[u8] {
        &self.data[self.written..]
    }
    #[inline]
    fn wrote_everything(&self) -> bool {
        self.written >= self.data.len()
    }
    #[inline]
    fn is_dead(&self) -> bool {
        self.ptr.is_null()
    }
    #[inline]
    fn set_dead(&mut self) {
        self.ptr = ChildPtr::NULL;
    }
    /// The next `amount` bytes were written: tee them into the optional
    /// capture buffer and count them.
    ///
    /// `bytelist` (when set) points into a live `ShellExecEnv` `Bufio`
    /// (`OutFd::captured` — see its doc); the env outlives every live queued
    /// `Writer` (`IOWriter::orphan` kills the ones it does not).
    #[inline]
    fn advance(&mut self, amount: usize) {
        if let Some(bl) = self.bytelist {
            // SAFETY: see doc comment.
            let _ = unsafe { (*bl).append_slice(&self.data[self.written..self.written + amount]) };
        }
        self.written += amount;
    }
}

/// The front is the chunk being written. A chunk leaves the queue when it is
/// done, so its bytes never move while the kernel may be reading them.
type Writers = VecDeque<Writer>;

// ──────────────────────────────────────────────────────────────────────────
// IOWriter
// ──────────────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
pub(crate) type WriterImpl = bun_io::pipe_writer::PosixBufferedWriter<IOWriter>;
#[cfg(windows)]
pub(crate) type WriterImpl = bun_io::pipe_writer::WindowsBufferedWriter<IOWriter>;

/// The `FilePoll.Owner` payload type for `SHELL_BUFFERED_WRITER`.
#[cfg(not(windows))]
pub(crate) type Poll = WriterImpl;

/// Poll-dispatch entry for `SHELL_BUFFERED_WRITER`. Holds an extra Arc strong
/// ref across `on_poll` so child `onIOWriterChunk` callbacks (via `bump()`)
/// can drop the last external ref without freeing `self` while PipeWriter is
/// still on the stack.
#[cfg(not(windows))]
pub(crate) fn on_poll(writer: &mut Poll, size_hint: isize, hup: bool) {
    use bun_io::pipe_writer::PosixPipeWriter;
    let parent = writer.parent.expect("IOWriter writer.parent unset");
    // `parent` is the backref stashed via `set_parent` in `IOWriter::init`;
    // `writer` is a field of `*parent`, so the pointee is live. Re-enter via
    // `&self` (UnsafeCell aliasing model). `ParentRef::Deref → &IOWriter`.
    let _keepalive = parent.keepalive();
    writer.on_poll(size_hint, hup);
}

/// Mutable state. Wrapped in `UnsafeCell` so `Arc<IOWriter>`-shared callers can
/// mutate via `&self` (single-threaded shell).
struct State {
    writer: WriterImpl,
    fd: Fd,
    writers: Writers,
    /// The chunks that were queued when the writer failed and whose failure
    /// has yet to be delivered, oldest first; null for one that was cancelled
    /// meanwhile. Every chunk gets its own completion: a builtin that queues
    /// several counts them.
    failed: VecDeque<ChildPtr>,
    /// A Windows write has the front chunk's bytes: set when `get_buffer`
    /// hands them out, cleared when that write reports back (`on_write_pollable`,
    /// `fail_pending_writers`). The front chunk stays in the queue meanwhile,
    /// dead or not.
    #[cfg(windows)]
    in_flight: bool,
    /// Set (and never cleared) by `fail_pending_writers`. A writer with a
    /// stored error is dead: `enqueue`/`enqueue_fmt_bltn` must reject new
    /// chunks with this error instead of queueing them (see
    /// `handle_dead_writer`). The syscall error is kept (not the derived
    /// `SystemError`) so each rejected chunk gets its own freshly-derived
    /// `SystemError`.
    err: Option<sys::Error>,
    evtloop: EventLoopHandle,
    started: bool,
    flags: Flags,
    /// Weak self-ref so `keepalive()` can bump the strong count from `&self`
    /// without unsafe Arc-pointer reconstruction. Set via `Arc::new_cyclic` in
    /// `init()` (the sole constructor).
    self_weak: std::sync::Weak<IOWriter>,
    /// The interpreter whose nodes the queued chunks call back into, for
    /// completions that arrive from the event loop. It lists this writer until
    /// `Drop` and, when it goes first, clears this through `orphan`: `Some`
    /// means alive.
    interp: Option<bun_ptr::ParentRef<Interpreter>>,
}

pub(crate) struct IOWriter {
    state: UnsafeCell<State>,
}

// SAFETY: shell is single-threaded; `Arc` is used purely for refcounting.
// No cross-thread access.
unsafe impl Send for IOWriter {}
// SAFETY: see `Send` — single-threaded, `Arc` is used only for refcounting; no
// concurrent `&IOWriter` access occurs.
unsafe impl Sync for IOWriter {}

impl IOWriter {
    /// SAFETY: single-threaded; no overlapping `&mut State` may be live across
    /// a re-entrant `enqueue` from a child callback (the `Yield` trampoline
    /// runs child callbacks after the borrow is dropped).
    #[inline]
    #[allow(clippy::mut_from_ref)]
    fn state(&self) -> &mut State {
        // SAFETY: single-threaded; callers uphold the no-overlapping-`&mut State`
        // invariant documented on this fn (re-derive across re-entrant calls).
        unsafe { &mut *self.state.get() }
    }

    /// Bump our own Arc strong count. Held across re-entrant `run_yield` calls
    /// whose child callback may drop the last external ref and free us
    /// mid-method; the stack-held strong ref prevents that.
    #[inline]
    fn keepalive(&self) -> std::sync::Arc<IOWriter> {
        self.state()
            .self_weak
            .upgrade()
            .expect("IOWriter::keepalive after last Arc dropped")
    }

    /// Read-only accessor for the `is_socket` flag (used by
    /// `ShellSubprocess::spawn` to decide `no_sigpipe`).
    #[inline]
    #[cfg(not(windows))]
    pub(crate) fn is_socket(&self) -> bool {
        self.state().flags.is_socket
    }

    /// A writer on `fd` (closed with it) whose completions drive `interp`.
    pub(crate) fn init(fd: Fd, flags: Flags, interp: &Interpreter) -> std::sync::Arc<IOWriter> {
        let mut writer = WriterImpl::default();
        // Tell the PipeWriter impl to *not* close the file descriptor.
        writer.close_fd = false;
        let this = std::sync::Arc::new_cyclic(|w| IOWriter {
            state: UnsafeCell::new(State {
                writer,
                fd,
                writers: Writers::new(),
                failed: VecDeque::new(),
                #[cfg(windows)]
                in_flight: false,
                err: None,
                evtloop: interp.event_loop,
                started: false,
                flags,
                self_weak: std::sync::Weak::clone(w),
                interp: Some(bun_ptr::ParentRef::new(interp)),
            }),
        });
        interp.register_io_writer(std::sync::Arc::as_ptr(&this));
        // Set the parent backref after Arc allocation so the address is stable.
        // SAFETY: `Arc::as_ptr` yields `*const IOWriter`; cast to `*mut` only
        // because the `BufferedWriterParent` callback ABI is `*mut Self`. The
        // pointer is never used to materialize `&mut IOWriter` — every callback
        // (`on_write`/`on_error`/`get_buffer`/…) re-enters via `&*this` and
        // mutates solely through `UnsafeCell<State>` (`state()`), which carries
        // its own write provenance. No const→mut UB.
        let parent: *mut IOWriter = std::sync::Arc::as_ptr(&this).cast_mut();
        this.state().writer.set_parent(parent);
        crate::shell_log!("IOWriter(0x{:x}, fd={}) init", parent as usize, fd);
        this
    }

    /// The interpreter is going away while this writer stays (a Windows write
    /// in flight holds a ref on it): nothing queued may call back or tee into
    /// the interpreter's buffers any more.
    pub(crate) fn orphan(&self) {
        let s = self.state();
        s.interp = None;
        for w in &mut s.writers {
            w.set_dead();
        }
        s.failed.clear();
    }

    #[inline]
    pub(crate) fn fd(&self) -> Fd {
        self.state().fd
    }

    pub(crate) fn memory_cost(&self) -> usize {
        let s = self.state();
        let mut cost = core::mem::size_of::<IOWriter>();
        cost += s.writers.capacity() * core::mem::size_of::<Writer>();
        cost += s.writers.iter().map(|w| w.data.capacity()).sum::<usize>();
        cost += s.writer.memory_cost();
        cost
    }

    #[inline]
    fn io_evtloop(&self) -> bun_io::EventLoopHandle {
        self.state().evtloop.as_event_loop_ctx()
    }

    // ── start ────────────────────────────────────────────────────────────

    fn __start(&self) -> sys::Result<()> {
        let s = self.state();
        crate::shell_log!("IOWriter(fd={}) __start()", s.fd);
        #[cfg(windows)]
        let started = match s.flags.kind {
            Some(kind) => s.writer.start_with_kind(s.fd, s.flags.origin, kind),
            None => s.writer.start_with_origin(s.fd, s.flags.origin),
        };
        #[cfg(not(windows))]
        let started = s.writer.start(s.fd, s.flags.pollable);
        if let Err(e) = started {
            #[cfg(not(windows))]
            {
                // We get this if we pass in a file descriptor that is not
                // pollable, for example a special character device like
                // /dev/null. If so, restart with polling disabled.
                //
                // It's also possible on Linux for EINVAL to be returned
                // when registering multiple writable/readable polls for the
                // same file descriptor. The shell code here makes sure to
                // _not_ run into that case, but it is possible.
                if e.get_errno() == E::EINVAL {
                    crate::shell_log!("IOWriter(fd={}) got EINVAL", s.fd);
                    s.flags.pollable = false;
                    s.flags.nonblock = false;
                    s.flags.is_socket = false;
                    return self.__start();
                }
                #[cfg(any(target_os = "linux", target_os = "android"))]
                {
                    // On linux regular files are not pollable and return EPERM,
                    // so restart if that's the case with polling disabled.
                    if e.get_errno() == E::EPERM {
                        s.flags.pollable = false;
                        s.flags.nonblock = false;
                        s.flags.is_socket = false;
                        return self.__start();
                    }
                }
            }
            return Err(e);
        }
        #[cfg(not(windows))]
        {
            use bun_io::FilePollFlag;
            // NOTE: re-derive `state()` — the EINVAL/EPERM fallback paths
            // above re-enter `__start()` and mutate `writer.handle`, which
            // invalidates `s` under Stacked Borrows.
            let s = self.state();
            if let Some(poll) = s.writer.get_poll() {
                if s.flags.nonblock {
                    poll.set_flag(FilePollFlag::Nonblocking);
                }
                // On macOS `sendto` with MSG_DONTWAIT can still block, so
                // only mark as socket there if the fd is already O_NONBLOCK.
                let sendto_msg_nowait_blocks = cfg!(target_os = "macos");
                if s.flags.is_socket && (!sendto_msg_nowait_blocks || s.flags.nonblock) {
                    poll.set_flag(FilePollFlag::Socket);
                } else if s.flags.pollable {
                    poll.set_flag(FilePollFlag::Fifo);
                }
            }
        }
        Ok(())
    }

    /// Idempotent write call.
    ///
    /// Failures are *returned* (`WriteOutcome::Failed`), never dispatched from
    /// here: the caller sits inside the enqueuing child's trampoline, so the
    /// error completion has to bounce off it (`on_sync_error`) instead of
    /// re-entering `Yield::run` (see `DbgDepthGuard`).
    fn write(&self) -> WriteOutcome {
        let s = self.state();
        debug_assert!(s.flags.pollable);

        if !s.started {
            crate::shell_log!("IOWriter(fd={}) starting", s.fd);
            // Set before the fallible `__start` so a later enqueue does not
            // retry it.
            s.started = true;
            if let Err(e) = self.__start() {
                return WriteOutcome::Failed(e);
            }
            #[cfg(not(windows))]
            {
                // NOTE: `__start()` re-derives `state()` (and may mutate
                // `writer.handle` on the EINVAL/EPERM fallback paths), which
                // invalidates the `s` borrow under Stacked Borrows. Re-derive.
                let s = self.state();
                // if `handle == .fd` it means it's a file which does not
                // support polling for writeability and we should just write to it
                if matches!(s.writer.handle, bun_io::pipes::PollOrFd::Fd(_)) {
                    debug_assert!(!s.flags.pollable);
                    return WriteOutcome::IsActuallyFile;
                }
                return WriteOutcome::Suspended;
            }
            #[cfg(windows)]
            return WriteOutcome::Suspended;
        }

        #[cfg(windows)]
        {
            // Does nothing while a write is in flight; its completion
            // continues with whatever was queued meanwhile.
            return match s.writer.write() {
                Ok(()) => WriteOutcome::Suspended,
                Err(e) => WriteOutcome::Failed(e),
            };
        }

        #[cfg(not(windows))]
        {
            debug_assert!(matches!(s.writer.handle, bun_io::pipes::PollOrFd::Poll(_)));
            if let Some(poll) = s.writer.get_poll() {
                // `is_watching()` = `is_registered() && !needs_rearm`.
                // NOT `is_registered()`: after a one-shot fire that drains
                // everything (no `register_poll()`), `PollWritable` stays set
                // but `NeedsRearm` is set → `is_registered()` would return
                // Suspended without re-arming and stall the queue forever.
                if poll.is_watching() {
                    return WriteOutcome::Suspended;
                }
            }
            if let Err(e) = s.writer.start(s.fd, s.flags.pollable) {
                return WriteOutcome::Failed(e);
            }
            WriteOutcome::Suspended
        }
    }

    // ── queue management ────────────────────────────────────────────────

    /// Cancel the chunks enqueued by the given child by marking them as dead.
    pub(crate) fn cancel_chunks(&self, ptr: ChildPtr) {
        let s = self.state();
        for w in &mut s.writers {
            if w.ptr == ptr {
                w.set_dead();
            }
        }
        for failed in &mut s.failed {
            if *failed == ptr {
                *failed = ChildPtr::NULL;
            }
        }
    }

    /// Whether a chunk `ptr` enqueued has yet to call back.
    #[cfg(debug_assertions)]
    pub(crate) fn has_live_chunks(&self, ptr: ChildPtr) -> bool {
        let s = self.state();
        s.writers.iter().any(|w| w.ptr == ptr) || s.failed.contains(&ptr)
    }

    /// Drops the dead chunks at the front; their bytes are never written.
    fn skip_dead(s: &mut State) {
        while s.writers.front().is_some_and(Writer::is_dead) {
            s.writers.pop_front();
        }
    }

    // ── buffer slicing ──────────────────────────────────────────────────

    /// Returns the buffer of data that needs to be written for the *current*
    /// writer.
    fn get_buffer(&self) -> &[u8] {
        let s = self.state();
        // The Windows writer also asks when a write completes, before
        // `on_write`: the front chunk is then still the one that write was for.
        #[cfg(windows)]
        let skip = !s.in_flight;
        #[cfg(not(windows))]
        let skip = true;
        if skip {
            Self::skip_dead(s);
        }
        let Some(front) = s.writers.front() else {
            return &[];
        };
        debug_assert!(!front.wrote_everything());
        #[cfg(windows)]
        {
            s.in_flight = true;
        }
        front.remaining()
    }

    // ── bump (chunk completed) ──────────────────────────────────────────

    /// Take the front chunk, which is fully written or dead, off the queue
    /// (freeing its bytes) and return the `Yield` for its child's
    /// `on_io_writer_chunk` callback.
    fn bump(&self) -> Yield {
        let s = self.state();
        let done = s.writers.pop_front().expect("bump on an empty queue");
        Self::skip_dead(s);
        if done.is_dead() {
            return Yield::done();
        }
        debug_assert!(done.wrote_everything());
        Yield::OnIoWriterChunk {
            child: done.ptr,
            written: done.written,
            err: None,
        }
    }

    // ── file write (non-pollable sync path) ─────────────────────────────

    fn do_file_write(&self) -> Yield {
        let s = self.state();
        debug_assert!(!s.flags.pollable);
        Self::skip_dead(s);
        let fd = s.fd;
        let front = s.writers.front_mut().expect("enqueue pushed a chunk");

        let amt = match write_to_file(fd, front.remaining()) {
            bun_io::WriteResult::Done(amt) | bun_io::WriteResult::Wrote(amt) => amt,
            bun_io::WriteResult::Pending(amt) => {
                // EAGAIN from a target that was classified non-pollable (a
                // FIFO or chardev opened by path with O_NONBLOCK). Record the
                // partial write and restart this writer on the pollable path.
                front.advance(amt);
                s.flags.pollable = true;
                #[cfg(not(windows))]
                {
                    s.flags.nonblock = true;
                }
                s.started = false;
                return match self.write() {
                    WriteOutcome::Suspended => Yield::suspended(),
                    #[cfg(not(windows))]
                    WriteOutcome::IsActuallyFile => {
                        self.on_sync_error(&sys::Error::from_code(E::EAGAIN, sys::Tag::write))
                    }
                    WriteOutcome::Failed(e) => self.on_sync_error(&e),
                };
            }
            // The caller is inside the enqueuing child's trampoline, so the
            // error completion is returned, not `Yield::run` from here.
            bun_io::WriteResult::Err(e) => return self.on_sync_error(&e),
        };
        front.advance(amt);
        if !front.wrote_everything() {
            // The only case where we get partial writes is when an error is
            // encountered, which returns above.
            unreachable!(
                "IOWriter.doFileWrite: child.wroteEverything() is false. This is unexpected behavior and indicates a bug in Bun. Please file a GitHub issue."
            );
        }
        self.bump()
    }

    // ── poll callback ───────────────────────────────────────────────────

    /// The `BufferedWriter.onWrite` hook: `amount` more bytes of the front
    /// chunk were written. Runs on the event loop.
    fn on_write_pollable(&self, amount: usize, status: bun_io::WriteStatus) {
        let s = self.state();
        debug_assert!(s.flags.pollable);
        #[cfg(windows)]
        {
            s.in_flight = false;
        }

        let queued = s.writers.len();
        let Some(front) = s.writers.front_mut() else {
            return;
        };
        if front.is_dead() {
            self.run_yield(self.bump());
        } else {
            front.advance(amount);
            let wrote_everything = front.wrote_everything();
            if status == bun_io::WriteStatus::EndOfFile {
                if queued > 1 && wrote_everything {
                    return;
                }
                // Other end of the socket/pipe closed and we got EPIPE
                // (e.g. `ls | echo`). Quick hack: have all writers see an
                // error.
                self.broken_pipe_for_writers();
                return;
            }
            if wrote_everything {
                self.run_yield(self.bump());
            }
        }

        // `bump` left a live chunk at the front, or none at all.
        let s = self.state();
        if !s.writers.is_empty() {
            #[cfg(windows)]
            if let Err(e) = s.writer.write() {
                self.on_error(&e);
            }
            #[cfg(not(windows))]
            {
                debug_assert!(matches!(s.writer.handle, bun_io::pipes::PollOrFd::Poll(_)));
                s.writer.register_poll();
            }
        }
    }

    /// The reader of this pipe went away: every queued chunk fails with `EPIPE`.
    fn broken_pipe_for_writers(&self) {
        let err = sys::Error::from_code(E::EPIPE, sys::Tag::write);
        self.fail_pending_writers(&err);
        while let Some(ptr) = self.next_failed() {
            self.run_yield(Yield::OnIoWriterChunk {
                child: ptr,
                written: 0,
                err: Some(err.to_system_error()),
            });
        }
    }

    /// Shared failure bookkeeping: mark broken pipes and move the queue to
    /// `failed`, from where `next_failed` hands out the chunks that have to be
    /// told. The queue is empty *before* any of them runs so that a child
    /// re-enqueueing from its callback is rejected, not queued. No write is in
    /// flight: this runs from a write's completion, or for one that could not
    /// be submitted.
    fn fail_pending_writers(&self, err: &sys::Error) {
        let s = self.state();
        if err.get_errno() == E::EPIPE {
            s.flags.broken_pipe = true;
        }
        // Mark the writer dead before any completion below runs: a child that
        // enqueues from its callback (the next statement, the RHS of `&&`, ...)
        // must be rejected by `handle_dead_writer`, not queued onto a writer
        // whose handle the error path is tearing down.
        s.err = Some(err.clone());
        s.failed.extend(s.writers.drain(..).map(|w| w.ptr));
        #[cfg(windows)]
        {
            s.in_flight = false;
        }
    }

    /// The oldest failed chunk that is still live. Taken one at a time: the
    /// callback of one may cancel those behind it (`cancel_chunks`).
    fn next_failed(&self) -> Option<ChildPtr> {
        let s = self.state();
        while let Some(ptr) = s.failed.pop_front() {
            if !ptr.is_null() {
                return Some(ptr);
            }
        }
        None
    }

    /// Write failure reported by the `bun_io` writer callbacks, which only
    /// fire from the event loop, with no trampoline on the stack: each pending
    /// chunk's error completion is driven through its own `Yield::run`.
    fn on_error(&self, err: &sys::Error) {
        let _keepalive = self.keepalive();
        self.fail_pending_writers(err);
        while let Some(ptr) = self.next_failed() {
            // `SystemError` owns `bun_core::String`s by value (no shared
            // refcount yet), so re-derive a fresh one per callee instead of
            // cloning the stored error.
            let ee = err.to_shell_system_error();
            self.run_yield(Yield::OnIoWriterChunk {
                child: ptr,
                written: 0,
                err: Some(ee),
            });
        }
    }

    /// Synchronous write failure while a child's `enqueue` call (and therefore
    /// its trampoline) is still on the stack. The completion of the chunk it
    /// just pushed, the last in the queue, is *returned* so that trampoline
    /// delivers it after `enqueue` unwinds; calling `on_error` here instead
    /// would re-enter `Yield::run` once per failing command and fire the
    /// callback from inside its own `enqueue`. Usually that chunk is the only
    /// one (a synchronous failure is the first write attempt of a batch); if a
    /// poll re-registration fails while others are still queued, those are
    /// dispatched the way the async path dispatches them, oldest first.
    fn on_sync_error(&self, err: &sys::Error) -> Yield {
        let _keepalive = self.keepalive();
        self.fail_pending_writers(err);
        loop {
            let Some(ptr) = self.next_failed() else {
                return Yield::done();
            };
            // `SystemError` owns `bun_core::String`s by value (no shared
            // refcount yet), so re-derive a fresh one per callee.
            let y = Yield::OnIoWriterChunk {
                child: ptr,
                written: 0,
                err: Some(err.to_shell_system_error()),
            };
            if !self.state().failed.iter().any(|later| !later.is_null()) {
                return y;
            }
            self.run_yield(y);
        }
    }

    fn on_close(&self) {}

    /// Drive a `Yield` from a completion that arrived from the event loop.
    fn run_yield(&self, y: Yield) {
        if matches!(y, Yield::Done | Yield::Suspended) {
            return;
        }
        // `orphan` killed every chunk before it cleared `interp`, and a dead
        // chunk completes with `Yield::Done`.
        let Some(interp) = self.state().interp else {
            debug_assert!(false, "a live chunk completed on an orphaned IOWriter");
            return;
        };
        y.run(&interp);
    }

    // ── enqueue ─────────────────────────────────────────────────────────

    /// A writer that reported a fatal error (or a broken pipe) rejects new
    /// chunks with that error.
    fn handle_dead_writer(&self, ptr: ChildPtr) -> Option<Yield> {
        let s = self.state();
        if s.flags.broken_pipe {
            let err = sys::Error::from_code(E::EPIPE, sys::Tag::write).to_system_error();
            return Some(Yield::OnIoWriterChunk {
                child: ptr,
                written: 0,
                err: Some(err),
            });
        }
        if let Some(err) = &s.err {
            return Some(Yield::OnIoWriterChunk {
                child: ptr,
                written: 0,
                // `SystemError` owns its `bun_core::String`s by value, so
                // derive a fresh one per rejected chunk (see `on_error`).
                err: Some(err.to_shell_system_error()),
            });
        }
        None
    }

    fn enqueue_file(&self) -> Yield {
        // The pollable path sets `started` in write(); the non-pollable file
        // path bypasses write() entirely, so set it here.
        self.state().started = true;
        self.do_file_write()
    }

    /// Ask what the fd is. A query that fails leaves it to the source, whose
    /// open fails the same way and is the write's error.
    fn classify(s: &mut State) {
        s.flags.classified = true;
        #[cfg(windows)]
        {
            s.flags.kind = sys::File::borrow(&s.fd).kind().ok();
            s.flags.pollable = s.flags.kind != Some(sys::FileKind::File);
        }
        #[cfg(not(windows))]
        {
            s.flags.pollable = crate::shell::interpreter::is_pollable(s.fd);
        }
    }

    /// For the chunk that was just pushed.
    fn enqueue_internal(&self) -> Yield {
        debug_assert!(!self.state().flags.broken_pipe);
        debug_assert!(self.state().err.is_none());
        if !self.state().flags.classified {
            Self::classify(self.state());
        }
        if !self.state().flags.pollable {
            return self.enqueue_file();
        }
        match self.write() {
            WriteOutcome::Suspended => Yield::suspended(),
            #[cfg(not(windows))]
            WriteOutcome::IsActuallyFile => self.enqueue_file(),
            WriteOutcome::Failed(e) => self.on_sync_error(&e),
        }
    }

    /// The completion of a chunk of `len` bytes that is not queued: the
    /// writer's stored error, or nothing to write.
    fn complete_unqueued(&self, child: ChildPtr, len: usize) -> Option<Yield> {
        if let Some(y) = self.handle_dead_writer(child) {
            return Some(y);
        }
        (len == 0).then_some(Yield::OnIoWriterChunk {
            child,
            written: 0,
            err: None,
        })
    }

    fn push(&self, child: ChildPtr, bytelist: Option<*mut Vec<u8>>, data: Vec<u8>) -> Yield {
        self.state().writers.push_back(Writer {
            ptr: child,
            data,
            written: 0,
            bytelist,
        });
        self.enqueue_internal()
    }

    /// Queue a copy of `buf` for writing; when the chunk completes (or
    /// errors), `child`'s `on_io_writer_chunk` fires.
    pub(crate) fn enqueue(
        &self,
        child: ChildPtr,
        bytelist: Option<*mut Vec<u8>>,
        buf: &[u8],
    ) -> Yield {
        if let Some(y) = self.complete_unqueued(child, buf.len()) {
            return y;
        }
        self.push(child, bytelist, buf.to_vec())
    }

    /// [`enqueue`](Self::enqueue) for bytes the caller is done with: they are
    /// written from where they are.
    pub(crate) fn enqueue_owned(
        &self,
        child: ChildPtr,
        bytelist: Option<*mut Vec<u8>>,
        mut buf: Vec<u8>,
    ) -> Yield {
        if let Some(y) = self.complete_unqueued(child, buf.len()) {
            return y;
        }
        // A reader hands over its whole buffer for what may be a short line.
        buf.shrink_to_fit();
        self.push(child, bytelist, buf)
    }

    /// Prefix `"{kind}: "` then format.
    pub(crate) fn enqueue_fmt_bltn(
        &self,
        child: ChildPtr,
        bytelist: Option<*mut Vec<u8>>,
        kind: Option<crate::shell::builtin::Kind>,
        args: core::fmt::Arguments<'_>,
    ) -> Yield {
        use std::io::Write as _;
        if let Some(y) = self.handle_dead_writer(child) {
            return y;
        }
        let mut buf = Vec::new();
        if let Some(k) = kind {
            let _ = write!(&mut buf, "{}: ", k.as_str());
        }
        let _ = buf.write_fmt(args);
        self.enqueue_owned(child, bytelist, buf)
    }
}

enum WriteOutcome {
    Suspended,
    /// The write/poll-registration failed synchronously; the caller turns this
    /// into the enqueuing child's error completion (`on_sync_error`).
    Failed(sys::Error),
    #[cfg(not(windows))]
    IsActuallyFile,
}

// ──────────────────────────────────────────────────────────────────────────
// BufferedWriter parent vtable — wires bun_io callbacks to inherent methods
// ──────────────────────────────────────────────────────────────────────────

bun_io::impl_buffered_writer_parent! {
    IOWriter;
    poll_tag   = bun_io::posix_event_loop::poll_tag::SHELL_BUFFERED_WRITER,
    // UnsafeCell aliasing model — child callbacks may re-enter `enqueue(&self)`.
    borrow     = shared,
    on_write   = on_write_pollable,
    on_error   = on_error,
    on_close   = on_close,
    get_buffer = |this| (*this).get_buffer(),
    event_loop = |this| (*this).io_evtloop(),
    // INVARIANT: `this` is `Arc::as_ptr` stashed via `writer.set_parent` in
    // `IOWriter::init` (sole constructor); passing a non-Arc ptr is UB.
    ref_       = |this| std::sync::Arc::increment_strong_count(this.cast_const()),
    deref      = |this| std::sync::Arc::decrement_strong_count(this.cast_const()),
}

// ──────────────────────────────────────────────────────────────────────────
// File path
// ──────────────────────────────────────────────────────────────────────────

/// Writes all of `buf` unless the fd stops taking bytes. A failure is an
/// error even after a partial write: `do_file_write` fails the whole chunk
/// either way.
fn write_to_file(fd: Fd, buf: &[u8]) -> bun_io::WriteResult {
    let mut offset: usize = 0;
    while offset < buf.len() {
        match sys::write(fd, &buf[offset..]) {
            Err(err) => {
                if err.is_retry() {
                    return bun_io::WriteResult::Pending(offset);
                }
                return bun_io::WriteResult::Err(err);
            }
            Ok(wrote) => {
                offset += wrote;
                if wrote == 0 {
                    return bun_io::WriteResult::Done(offset);
                }
            }
        }
    }
    bun_io::WriteResult::Wrote(offset)
}

// ──────────────────────────────────────────────────────────────────────────
// Drop
// ──────────────────────────────────────────────────────────────────────────

impl Drop for IOWriter {
    fn drop(&mut self) {
        let this: *const IOWriter = self;
        let s = self.state.get_mut();
        crate::shell_log!("IOWriter(fd={}) deinit", s.fd);
        if let Some(interp) = s.interp {
            interp.forget_io_writer(this);
        }
        #[cfg(not(windows))]
        {
            if matches!(s.writer.handle, bun_io::pipes::PollOrFd::Poll(_)) {
                s.writer
                    .handle
                    .close_impl(None, None::<fn(*mut c_void)>, false);
            }
        }
        // The source goes before the fd it was opened on.
        #[cfg(windows)]
        s.writer.close_without_reporting();
        // Closed here, not on another thread: a redirect target is closed by
        // the time the command that wrote it settles, so whatever runs next
        // can open, move or delete the file.
        let _ = sys::close(s.fd);
        s.writer
            .disable_keeping_process_alive(s.evtloop.as_event_loop_ctx());
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Hoisted dispatch for `onIOWriterChunk`
// ──────────────────────────────────────────────────────────────────────────

/// Hoisted dispatch for the `onIOWriterChunk` callback (PORTING.md §Dispatch
/// hot-path). Called by `Yield::OnIoWriterChunk` and by the writer's poll
/// callback.
pub(crate) fn on_io_writer_chunk(
    interp: &Interpreter,
    child: ChildPtr,
    written: usize,
    err: Option<sys::SystemError>,
) -> Yield {
    use crate::shell::builtin::Builtin;
    use crate::shell::states::{cmd, cond_expr, pipeline};
    match child.tag {
        WriterTag::Builtin => Builtin::on_io_writer_chunk(interp, child.node, written, err),
        WriterTag::Cmd => cmd::Cmd::on_io_writer_chunk(interp, child.node, written, err),
        WriterTag::CondExpr => {
            cond_expr::CondExpr::on_io_writer_chunk(interp, child.node, written, err)
        }
        WriterTag::Pipeline => {
            pipeline::Pipeline::on_io_writer_chunk(interp, child.node, written, err)
        }
        // The target is the subprocess PipeReader's `CapturedWriter`; it
        // lives outside the NodeId arena (heap-allocated PipeReader), so it
        // is carried in `child.raw` instead of `child.node`.
        WriterTag::Subproc => {
            let _ = interp;
            debug_assert!(!child.raw.is_null());
            // SAFETY: `raw` was set from `&mut CapturedWriter` in
            // `CapturedWriter::do_write`; the PipeReader (and the embedded
            // CapturedWriter) is kept alive by the `Readable::Pipe` Arc on
            // the owning ShellSubprocess until `on_close_io` runs, which only
            // happens after the writer has finished draining. Single-threaded.
            let cw = unsafe { &mut *child.raw.cast::<crate::shell::subproc::CapturedWriter>() };
            cw.on_iowriter_chunk(written, err)
        }
    }
}
