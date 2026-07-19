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
//! We also make `IOWriter` reference counted (via `Arc` in the Rust port),
//! this simplifies management of the file descriptor.

use bun_collections::VecExt;
use core::cell::UnsafeCell;
#[cfg(not(windows))]
use core::ffi::c_void;

#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
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
    pub tag: WriterTag,
    /// Only meaningful when `tag == Subproc` — `*mut subproc::CapturedWriter`.
    /// `core::ptr::null_mut()` otherwise. Stored untyped to keep this header
    /// free of a `subproc` dependency.
    pub raw: *mut core::ffi::c_void,
}

impl ChildPtr {
    pub(crate) const NULL: ChildPtr = ChildPtr {
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
    pub(crate) fn is_null(&self) -> bool {
        self.node == NodeId::NONE && self.raw.is_null()
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WriterTag {
    /// Builtin running inside a Cmd — dispatch via `Builtin::on_io_writer_chunk`.
    Builtin,
    Cmd,
    Pipeline,
    Subshell,
    CondExpr,
    If,
    /// `subproc::PipeReader::CapturedWriter` — heap-allocated, addressed via
    /// `ChildPtr::raw` rather than `node`.
    Subproc,
}

// ──────────────────────────────────────────────────────────────────────────
// Flags / Writer queue entry
// ──────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Default)]
pub struct Flags {
    pub pollable: bool,
    pub nonblock: bool,
    pub is_socket: bool,
    pub broken_pipe: bool,
}

/// One queued chunk: which child enqueued it, how many bytes (in `buf`), how
/// many of those have been written so far, and an optional `Vec<u8>` to tee
/// into.
struct Writer {
    ptr: ChildPtr,
    len: usize,
    written: usize,
    bytelist: Option<*mut Vec<u8>>,
}

impl Writer {
    #[cfg(not(windows))]
    #[inline]
    fn wrote_everything(&self) -> bool {
        self.written >= self.len
    }
    #[inline]
    fn is_dead(&self) -> bool {
        self.ptr.is_null()
    }
    #[inline]
    fn set_dead(&mut self) {
        self.ptr = ChildPtr::NULL;
    }
    /// Tee `chunk` into the optional capture buffer.
    ///
    /// `bytelist` (when set) points into a live `ShellExecEnv` `Bufio`
    /// (`OutFd::captured` — see its doc); the env outlives every queued
    /// `Writer`. Localises the per-callsite raw deref in
    /// `do_file_write` / `on_write_pollable`.
    #[inline]
    fn tee(&self, chunk: &[u8]) {
        if let Some(bl) = self.bytelist {
            // SAFETY: see doc comment.
            let _ = unsafe { (*bl).append_slice(chunk) };
        }
    }
}

// PERF: an inline small-vec may be worth it — profile if hot; smallvec crate.
type Writers = Vec<Writer>;

/// ~128kb. We shrink `buf` when we reach the last writer, but if that never
/// happens we shrink when it exceeds this threshold.
const SHRINK_THRESHOLD: usize = 1024 * 128;

// ──────────────────────────────────────────────────────────────────────────
// IOWriter
// ──────────────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
pub(crate) type WriterImpl = bun_io::pipe_writer::PosixBufferedWriter<IOWriter>;
#[cfg(windows)]
pub(crate) type WriterImpl = bun_io::pipe_writer::WindowsBufferedWriter<IOWriter>;

/// The `FilePoll.Owner` payload type for `SHELL_BUFFERED_WRITER`.
#[allow(dead_code)]
pub(crate) type Poll = WriterImpl;

/// Poll-dispatch entry for `SHELL_BUFFERED_WRITER`. Holds an extra Arc strong
/// ref across `on_poll` so child `onIOWriterChunk` callbacks (via `bump()`)
/// can drop the last external ref without freeing `self` while PipeWriter is
/// still on the stack.
#[cfg(not(windows))]
pub fn on_poll(writer: &mut Poll, size_hint: isize, hup: bool) {
    use bun_io::pipe_writer::PosixPipeWriter;
    let parent = writer.parent.expect("IOWriter writer.parent unset");
    // `parent` is the backref stashed via `set_parent` in `IOWriter::init`;
    // `writer` is a field of `*parent`, so the pointee is live. Re-enter via
    // `&self` (UnsafeCell aliasing model). `ParentRef::Deref → &IOWriter`.
    let _keepalive = parent.keepalive();
    writer.on_poll(size_hint, hup);
}

impl IOWriter {
    /// Explicitly a no-op. Kept only because `task_tag::ShellIOWriter`
    /// exists in the task-tag dispatch table. No code path enqueues this tag.
    pub fn run_from_main_thread(_this: *mut IOWriter) {
        // intentionally empty. No unsafe operations; the pointer is never
        // dereferenced.
    }

    /// Tears down the underlying `WriterImpl` and drops the last strong ref.
    ///
    /// # Safety
    /// `this` must be the `Arc::as_ptr` of a live `Arc<IOWriter>` whose strong
    /// count is held by the async-deinit task; this call drops that ref.
    // Forwards `this` to `Arc::decrement_strong_count` without dereferencing it
    // here; not_unsafe_ptr_arg_deref is a false positive on opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn deinit_on_main_thread(this: *mut IOWriter) {
        // SAFETY: caller contract above.
        unsafe { std::sync::Arc::decrement_strong_count(this) };
    }
}

/// Mutable state. Wrapped in `UnsafeCell` so `Arc<IOWriter>`-shared callers can
/// mutate via `&self` (single-threaded shell).
struct State {
    writer: WriterImpl,
    fd: Fd,
    writers: Writers,
    buf: Vec<u8>,
    /// quick hack to get windows working; ideally this should be removed.
    #[cfg(windows)]
    winbuf: Vec<u8>,
    writer_idx: usize,
    total_bytes_written: usize,
    /// Set (and never cleared) by `fail_pending_writers`. A writer with a
    /// stored error is dead: `enqueue`/`enqueue_fmt_bltn` must reject new
    /// chunks with this error instead of queueing them (see
    /// `handle_dead_writer`). The syscall error is kept (not the derived
    /// `SystemError`) so each rejected chunk gets its own freshly-derived
    /// `SystemError`.
    err: Option<sys::Error>,
    evtloop: EventLoopHandle,
    is_writing: bool,
    started: bool,
    flags: Flags,
    /// Weak self-ref so `keepalive()` can bump the strong count from `&self`
    /// without unsafe Arc-pointer reconstruction. Set via `Arc::new_cyclic` in
    /// `init()` (the sole constructor).
    self_weak: std::sync::Weak<IOWriter>,
    /// Backref to the owning interpreter for async-poll callbacks (which must
    /// drive `Yield::run`). Set by the first `enqueue`/`set_interp`; `None`
    /// until then.
    interp: Option<bun_ptr::ParentRef<Interpreter>>,
}

pub struct IOWriter {
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
    pub fn is_socket(&self) -> bool {
        self.state().flags.is_socket
    }

    pub fn init(fd: Fd, flags: Flags, evtloop: EventLoopHandle) -> std::sync::Arc<IOWriter> {
        let mut writer = WriterImpl::default();
        // Tell the PipeWriter impl to *not* close the file descriptor.
        #[cfg(not(windows))]
        {
            writer.close_fd = false;
        }
        #[cfg(windows)]
        {
            writer.owns_fd = false;
        }
        let this = std::sync::Arc::new_cyclic(|w| IOWriter {
            state: UnsafeCell::new(State {
                writer,
                fd,
                writers: Writers::new(),
                buf: Vec::new(),
                #[cfg(windows)]
                winbuf: Vec::new(),
                writer_idx: 0,
                total_bytes_written: 0,
                err: None,
                evtloop,
                is_writing: false,
                started: false,
                flags,
                self_weak: std::sync::Weak::clone(w),
                interp: None,
            }),
        });
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

    /// Stash the interpreter backref so async poll callbacks can drive
    /// `Yield::run`. Idempotent.
    ///
    /// # Safety
    /// `interp` must be null or point to the live owning `Interpreter` (which
    /// owns the IO struct holding this `Arc`) and outlive it; single-threaded.
    // Forwards `interp` to `ParentRef::from_nullable_mut` without dereferencing
    // it here; not_unsafe_ptr_arg_deref is a false positive on opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    #[inline]
    pub fn set_interp(&self, interp: *mut Interpreter) {
        // SAFETY: caller contract above.
        self.state().interp = unsafe { bun_ptr::ParentRef::from_nullable_mut(interp) };
    }

    #[inline]
    pub fn fd(&self) -> Fd {
        self.state().fd
    }

    #[inline]
    pub fn evtloop(&self) -> EventLoopHandle {
        self.state().evtloop
    }

    pub fn memory_cost(&self) -> usize {
        let s = self.state();
        let mut cost = core::mem::size_of::<IOWriter>();
        cost += s.buf.capacity();
        #[cfg(windows)]
        {
            cost += s.winbuf.capacity();
        }
        cost += s.writers.capacity() * core::mem::size_of::<Writer>();
        cost += s.writer.memory_cost();
        cost
    }

    /// `bun_io::EventLoopHandle` is an opaque `*mut c_void` that the io-layer
    /// `FilePollVTable` round-trips back to the runtime. We pass the address of
    /// the stored `bun_event_loop::EventLoopHandle` so the (runtime-registered)
    /// vtable can recover it.
    #[cfg(not(windows))]
    #[inline]
    fn io_evtloop(&self) -> bun_io::EventLoopHandle {
        // SAFETY: `bun_io::EventLoopHandle` stores `*mut c_void` purely for
        // type-erasure; vtable consumers treat the pointee as read-only
        self.state().evtloop.as_event_loop_ctx()
    }

    // ── start ────────────────────────────────────────────────────────────

    fn __start(&self) -> sys::Result<()> {
        let s = self.state();
        crate::shell_log!("IOWriter(fd={}) __start()", s.fd);
        if let Err(e) = s.writer.start(s.fd, s.flags.pollable) {
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
                    if matches!(s.writer.handle, bun_io::pipes::PollOrFd::Poll(_)) {
                        s.writer
                            .handle
                            .close_impl(None, None::<fn(*mut c_void)>, false);
                    }
                    s.writer.handle = bun_io::pipes::PollOrFd::Closed;
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
                        if matches!(s.writer.handle, bun_io::pipes::PollOrFd::Poll(_)) {
                            s.writer
                                .handle
                                .close_impl(None, None::<fn(*mut c_void)>, false);
                        }
                        s.writer.handle = bun_io::pipes::PollOrFd::Closed;
                        return self.__start();
                    }
                }
            }
            #[cfg(windows)]
            {
                // This might happen if the file descriptor points to NUL.
                // On Windows GetFileType(NUL) returns FILE_TYPE_CHAR, so
                // `this.writer.start()` will try to open it as a tty with
                // uv_tty_init, but this returns EBADF. As a workaround,
                // we'll try opening the file descriptor as a file.
                if e.get_errno() == E::EBADF {
                    s.flags.pollable = false;
                    s.flags.nonblock = false;
                    s.flags.is_socket = false;
                    return s.writer.start_with_file(s.fd);
                }
            }
            return Err(e);
        }
        #[cfg(windows)]
        {
            // When `Source::open` produced a uv pipe/tty, libuv has TAKEN
            // OWNERSHIP of the underlying HANDLE
            // (`uv_pipe_open`/`uv_tty_init`) and `uv_close` (issued by
            // `s.writer.close()` in Drop) will close it.
            // `BaseWindowsPipeWriter::start` does not invalidate the stored
            // fd (TODO at PipeWriter.rs:1277), so disarm the Drop close here
            // instead. The `Source::File`/`SyncFile` case (incl. the
            // EBADF→`start_with_file` fallback above, which `return`s early)
            // keeps `s.fd` valid: with `owns_fd=false` PipeWriter does NOT
            // close it there, so Drop must.
            if matches!(
                s.writer.source,
                Some(bun_io::Source::Pipe(_) | bun_io::Source::Tty(_))
            ) {
                s.fd = Fd::INVALID;
            }
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
        #[cfg(not(windows))]
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
            crate::shell_log!("IOWriter(fd={}) write() is_writing={}", s.fd, s.is_writing);
            if s.is_writing {
                return WriteOutcome::Suspended;
            }
            s.is_writing = true;
            if let Err(e) = s.writer.start_with_current_pipe() {
                return WriteOutcome::Failed(e);
            }
            return WriteOutcome::Suspended;
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
    pub fn cancel_chunks(&self, ptr: ChildPtr) {
        let s = self.state();
        if s.writers.is_empty() {
            return;
        }
        let idx = s.writer_idx;
        if idx >= s.writers.len() {
            return;
        }
        for w in &mut s.writers[idx..] {
            if w.ptr == ptr {
                w.set_dead();
            }
        }
    }

    /// Skips over dead children and increments `total_bytes_written` by the
    /// amount they would have written so the buf is skipped as well.
    fn skip_dead(&self) {
        let s = self.state();
        while s.writer_idx < s.writers.len() {
            let w = &s.writers[s.writer_idx];
            if w.is_dead() {
                s.total_bytes_written += w.len - w.written;
                s.writer_idx += 1;
                continue;
            }
            return;
        }
    }

    fn wrote_everything(&self) -> bool {
        let s = self.state();
        s.total_bytes_written >= s.buf.len()
    }

    /// Only does things on windows.
    #[inline]
    fn set_writing(&self, writing: bool) {
        #[cfg(windows)]
        {
            self.state().is_writing = writing;
        }
        let _ = writing;
    }

    // ── buffer slicing ──────────────────────────────────────────────────

    /// Returns the buffer of data that needs to be written for the *current*
    /// writer.
    fn get_buffer(&self) -> &[u8] {
        let result = self.get_buffer_impl();
        #[cfg(windows)]
        {
            let s = self.state();
            s.winbuf.clear();
            s.winbuf.extend_from_slice(result);
            // `state()` ties `s` to `&self`, so the slice borrow already has
            // the `'self` lifetime the signature wants — no raw-parts needed.
            return s.winbuf.as_slice();
        }
        #[cfg(not(windows))]
        result
    }

    fn get_buffer_impl(&self) -> &[u8] {
        // NOTE: reshaped for borrowck — re-derive `state()` after
        // `skip_dead()` instead of holding one `&mut State` across it.
        {
            let s = self.state();
            if s.writer_idx >= s.writers.len() {
                return &[];
            }
            if s.writers[s.writer_idx].is_dead() {
                let _ = s;
                self.skip_dead();
            }
        }
        let s = self.state();
        if s.writer_idx >= s.writers.len() {
            return &[];
        }
        let remaining = {
            let writer = &s.writers[s.writer_idx];
            debug_assert!(writer.len != writer.written);
            writer.len - writer.written
        };
        // `state()` already ties `s` to `&self`, so a plain slice borrow has
        // the right lifetime. `buf` is not reallocated until after the
        // caller's write syscall completes.
        let start = s.total_bytes_written;
        &s.buf[start..start + remaining]
    }

    // ── bump (chunk completed) ──────────────────────────────────────────

    /// Advance past `current_writer`, shrinking `buf` if appropriate, and
    /// return the `Yield` for the child's `on_io_writer_chunk` callback.
    fn bump(&self, current_idx: usize) -> Yield {
        // NOTE: reshaped for borrowck — `skip_dead()` re-derives `state()`,
        // so we must drop `s` before calling it and re-derive after, otherwise
        // two `&mut State` are live simultaneously (UB under Stacked Borrows).
        let (is_dead, written, child_ptr) = {
            let s = self.state();
            let w = &s.writers[current_idx];
            (w.is_dead(), w.written, w.ptr)
        };

        if is_dead {
            self.skip_dead();
        } else {
            let s = self.state();
            debug_assert!(s.writers[current_idx].written == s.writers[current_idx].len);
            s.writer_idx += 1;
        }

        let s = self.state();
        if s.writer_idx >= s.writers.len() {
            s.buf.clear();
            s.writer_idx = 0;
            s.writers.clear();
            s.total_bytes_written = 0;
        } else if s.total_bytes_written >= SHRINK_THRESHOLD {
            s.buf.drain_front(s.total_bytes_written);
            s.total_bytes_written = 0;
            // Drop the *prefix* of the writers queue: Vec::drain(..idx).
            s.writers.drain(..s.writer_idx);
            s.writer_idx = 0;
            if cfg!(debug_assertions) && !s.writers.is_empty() {
                debug_assert!(s.buf.len() >= s.writers[0].len);
            }
        }

        if !is_dead {
            return Yield::OnIoWriterChunk {
                child: child_ptr,
                written,
                err: None,
            };
        }
        Yield::done()
    }

    // ── file write (non-pollable sync path) ─────────────────────────────

    /// POSIX-only. `child` is the writer being enqueued (see `on_sync_error`).
    #[cfg(not(windows))]
    fn do_file_write(&self, child: ChildPtr) -> Yield {
        {
            let s = self.state();
            debug_assert!(!s.flags.pollable);
            debug_assert!(s.writer_idx < s.writers.len());
        }

        scopeguard::defer! { self.set_writing(false); }
        self.skip_dead();

        let idx = self.state().writer_idx;
        debug_assert!(!self.state().writers[idx].is_dead());

        let buf = self.get_buffer();
        debug_assert!(!buf.is_empty());

        let result = drain_buffered_data(self, buf, u32::MAX as usize);
        // NOTE: re-derive `state()` after `drain_buffered_data` instead of
        // holding a stale `&mut`.
        let amt = match result {
            bun_io::WriteResult::Done(amt) | bun_io::WriteResult::Wrote(amt) => amt,
            bun_io::WriteResult::Pending(_) => {
                unreachable!(
                    "drainBufferedData returning .pending in IOWriter.doFileWrite should not happen"
                );
            }
            // The caller is inside the enqueuing child's trampoline, so the
            // error completion is returned, not `Yield::run` from here.
            bun_io::WriteResult::Err(e) => return self.on_sync_error(child, &e),
        };
        let s = self.state();
        let lo = s.total_bytes_written;
        s.writers[idx].tee(&s.buf[lo..lo + amt]);
        s.total_bytes_written += amt;
        s.writers[idx].written += amt;
        if !s.writers[idx].wrote_everything() {
            // The only case where we get partial writes is when an error is
            // encountered, which returns above.
            unreachable!(
                "IOWriter.doFileWrite: child.wroteEverything() is false. This is unexpected behavior and indicates a bug in Bun. Please file a GitHub issue."
            );
        }
        self.bump(idx)
    }

    // ── poll callback ───────────────────────────────────────────────────

    /// The `BufferedWriter.onWrite` hook. Runs on the event loop when the fd
    /// is writable.
    fn on_write_pollable(&self, amount: usize, status: bun_io::WriteStatus) {
        // NOTE: `set_writing` re-derives `state()` on Windows, which would
        // invalidate `s` under Stacked Borrows; do it before binding `s`
        // (matches the ordering in `on_error`).
        self.set_writing(false);
        let s = self.state();
        #[cfg(not(windows))]
        debug_assert!(s.flags.pollable);

        if s.writer_idx >= s.writers.len() {
            return;
        }
        let idx = s.writer_idx;
        if s.writers[idx].is_dead() {
            self.run_yield(self.bump(idx));
        } else {
            let lo = s.total_bytes_written;
            s.writers[idx].tee(&s.buf[lo..lo + amount]);
            s.total_bytes_written += amount;
            s.writers[idx].written += amount;
            if status == bun_io::WriteStatus::EndOfFile {
                // NOTE: inline `is_last_idx` instead of calling
                // `self.is_last_idx(idx)` — that re-derives `state()` while `s`
                // is still live, which is two simultaneous `&mut State` (UB).
                let last = idx == s.writers.len().saturating_sub(1);
                let not_fully_written = if last {
                    true
                } else {
                    s.writers[idx].written < s.writers[idx].len
                };
                if !not_fully_written {
                    return;
                }
                // Other end of the socket/pipe closed and we got EPIPE
                // (e.g. `ls | echo`). Quick hack: have all writers see an
                // error.
                s.flags.broken_pipe = true;
                self.broken_pipe_for_writers();
                return;
            }
            if s.writers[idx].written >= s.writers[idx].len {
                self.run_yield(self.bump(idx));
            }
        }

        let wrote_everything = self.wrote_everything();
        let s = self.state();
        if !wrote_everything && s.writer_idx < s.writers.len() {
            #[cfg(windows)]
            {
                // NOTE: inline `set_writing(true)` instead of calling the
                // helper — the helper re-derives `state()` while `s` is live,
                // which is two simultaneous `&mut State` (UB under Stacked
                // Borrows). Same discipline as the top of this fn.
                s.is_writing = true;
                s.writer.write();
            }
            #[cfg(not(windows))]
            {
                debug_assert!(matches!(s.writer.handle, bun_io::pipes::PollOrFd::Poll(_)));
                s.writer.register_poll();
            }
        }
    }

    fn broken_pipe_for_writers(&self) {
        let s = self.state();
        debug_assert!(s.flags.broken_pipe);
        // NOTE: reshaped for borrowck — collect targets first so we don't
        // hold `&mut s.writers` across `cancel_chunks`/`run_yield`.
        let mut targets: Vec<ChildPtr> = Vec::new();
        for w in &s.writers[s.writer_idx..] {
            if w.is_dead() {
                continue;
            }
            if !targets.contains(&w.ptr) {
                targets.push(w.ptr);
            }
        }
        for ptr in targets {
            let err = sys::Error::from_code(E::EPIPE, sys::Tag::write).to_system_error();
            self.run_yield(Yield::OnIoWriterChunk {
                child: ptr,
                written: 0,
                err: Some(err),
            });
            self.cancel_chunks(ptr);
        }
        let s = self.state();
        s.total_bytes_written = 0;
        s.writers.clear();
        s.buf.clear();
        s.writer_idx = 0;
    }

    /// Shared failure bookkeeping: mark broken pipes, reset the queue, and
    /// return the still-pending children that have to be told their chunk
    /// failed. The queue is reset *before* any of them runs so that a child
    /// re-enqueueing from its callback is not wiped afterwards.
    fn fail_pending_writers(&self, err: &sys::Error) -> Vec<ChildPtr> {
        self.set_writing(false);
        let s = self.state();
        if err.get_errno() == E::EPIPE {
            s.flags.broken_pipe = true;
        }
        // Mark the writer dead before any completion below runs: a child that
        // enqueues from its callback (the next statement, the RHS of `&&`, ...)
        // must be rejected by `handle_dead_writer`, not queued onto a writer
        // whose handle the error path is tearing down.
        s.err = Some(err.clone());
        // Writers before writer_idx have already had their callback fired and
        // may have been freed; only notify the still-pending ones, dedup'd.
        let mut pending: Vec<ChildPtr> = Vec::new();
        for w in &s.writers[s.writer_idx..] {
            if !w.is_dead() && !pending.contains(&w.ptr) {
                pending.push(w.ptr);
            }
        }
        s.total_bytes_written = 0;
        s.writer_idx = 0;
        s.buf.clear();
        s.writers.clear();
        pending
    }

    /// Write failure reported by the `bun_io` writer callbacks. Each pending
    /// child's error completion is driven through its own `Yield::run`; on
    /// POSIX these callbacks only fire from the event loop, with no trampoline
    /// on the stack. On Windows uv can also deliver a synchronous submission
    /// failure from under `write()` (`start_with_current_pipe` returns `Ok`
    /// unconditionally), a re-entry `write()` cannot turn into a
    /// `WriteOutcome::Failed`.
    fn on_error(&self, err: &sys::Error) {
        let _keepalive = self.keepalive();
        for ptr in self.fail_pending_writers(err) {
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

    /// Synchronous write failure while `child`'s `enqueue` call (and therefore
    /// its trampoline) is still on the stack. `child`'s error completion is
    /// *returned* so that trampoline delivers it after `enqueue` unwinds;
    /// calling `on_error` here instead would re-enter `Yield::run` once per
    /// failing command and fire `child`'s callback from inside its own
    /// `enqueue`. Usually `child`'s chunk is the only pending one (a
    /// synchronous failure is the first write attempt of a batch); if a poll
    /// re-registration fails while other children are still queued, those are
    /// dispatched the way the async path dispatches them.
    fn on_sync_error(&self, child: ChildPtr, err: &sys::Error) -> Yield {
        let _keepalive = self.keepalive();
        let mut completion = None;
        for ptr in self.fail_pending_writers(err) {
            // `SystemError` owns `bun_core::String`s by value (no shared
            // refcount yet), so re-derive a fresh one per callee.
            let y = Yield::OnIoWriterChunk {
                child: ptr,
                written: 0,
                err: Some(err.to_shell_system_error()),
            };
            if completion.is_none() && ptr == child {
                completion = Some(y);
            } else {
                self.run_yield(y);
            }
        }
        // The writer `enqueue` just pushed for `child` is live and at or past
        // `writer_idx`, so it is always in the pending list.
        debug_assert!(completion.is_some());
        completion.unwrap_or_else(Yield::done)
    }

    fn on_close(&self) {
        self.set_writing(false);
    }

    /// Drive a `Yield` from inside an async poll callback. Requires `interp`
    /// to have been set; if not, the chunk-complete is dropped (debug-asserts).
    fn run_yield(&self, y: Yield) {
        let Some(interp) = self.state().interp else {
            debug_assert!(
                matches!(y, Yield::Done),
                "IOWriter async callback fired without interp backref"
            );
            return;
        };
        // SAFETY: interp outlives every IOWriter (it owns the IO struct that
        // holds the Arc). Single-threaded; R-2: `Interpreter::run` takes
        // `&self` now — `ParentRef: Deref<Target=Interpreter>` yields the
        // shared borrow without `assume_mut()`.
        y.run(&interp);
    }

    // ── enqueue ─────────────────────────────────────────────────────────

    /// A writer that already reported a fatal error must not accept new
    /// chunks: `PosixBufferedWriter::_on_error` closes the handle after
    /// `on_error` returns, so a chunk queued from inside the completion
    /// callbacks (or any later one) would wait on a poll that is being torn
    /// down, and a later `write()` would run with `handle == Closed` (the
    /// pollable path asserts `handle == Poll`). Broken pipes are the EPIPE
    /// flavor of the same thing. Report the error to the child instead of
    /// queueing the chunk.
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

    #[cfg(not(windows))]
    fn enqueue_file(&self, child: ChildPtr) -> Yield {
        let s = self.state();
        if s.is_writing {
            return Yield::suspended();
        }
        // The pollable path sets `started` in write(); the non-pollable file
        // path bypasses write() entirely, so set it here.
        s.started = true;
        self.set_writing(true);
        self.do_file_write(child)
    }

    /// You MUST have already added the data to `self.buf`!
    /// `child` is the writer that was just pushed (see `on_sync_error`).
    fn enqueue_internal(&self, child: ChildPtr) -> Yield {
        debug_assert!(!self.state().flags.broken_pipe);
        debug_assert!(self.state().err.is_none());
        #[cfg(not(windows))]
        if !self.state().flags.pollable {
            return self.enqueue_file(child);
        }
        match self.write() {
            WriteOutcome::Suspended => Yield::suspended(),
            #[cfg(not(windows))]
            WriteOutcome::IsActuallyFile => self.enqueue_file(child),
            WriteOutcome::Failed(e) => self.on_sync_error(child, &e),
        }
    }

    /// Count queued bytes against the sandbox output limit (no-op without a
    /// sandbox policy). Exceeding the limit settles the promise with a
    /// rejection; the chunk itself still completes, and the next
    /// `Builtin::on_io_writer_chunk` dispatch delivers the cancellation.
    fn sandbox_count_output(&self, n: usize) {
        // End the `state()` borrow before entering the interpreter: the
        // limit-exceeded path calls into JS (promise rejection), which must
        // not overlap a live `&mut State`.
        let interp: Option<*const Interpreter> = self
            .state()
            .interp
            .as_ref()
            .map(|p| core::ptr::from_ref(p.get()));
        if let Some(interp) = interp {
            // SAFETY: `set_interp` contract — the pointer is the live owning
            // Interpreter; the shell is single-threaded.
            let _ = unsafe { &*interp }.sandbox_count_output(n);
        }
    }

    /// Queue `buf` for writing; when the chunk completes (or errors),
    /// `child`'s `on_io_writer_chunk` fires.
    pub fn enqueue(&self, child: ChildPtr, bytelist: Option<*mut Vec<u8>>, buf: &[u8]) -> Yield {
        if let Some(y) = self.handle_dead_writer(child) {
            return y;
        }
        if buf.is_empty() {
            return Yield::OnIoWriterChunk {
                child,
                written: 0,
                err: None,
            };
        }
        self.sandbox_count_output(buf.len());
        let s = self.state();
        s.buf.extend_from_slice(buf);
        s.writers.push(Writer {
            ptr: child,
            len: buf.len(),
            written: 0,
            bytelist,
        });
        self.enqueue_internal(child)
    }

    /// Prefix `"{kind}: "` then format.
    pub fn enqueue_fmt_bltn(
        &self,
        child: ChildPtr,
        bytelist: Option<*mut Vec<u8>>,
        kind: Option<crate::shell::builtin::Kind>,
        args: core::fmt::Arguments<'_>,
    ) -> Yield {
        use std::io::Write as _;
        let s = self.state();
        let start = s.buf.len();
        if let Some(k) = kind {
            let _ = write!(&mut s.buf, "{}: ", k.as_str());
        }
        let _ = s.buf.write_fmt(args);
        // `buf` is written *before* the dead-writer checks (the bytes are dead
        // on the error path but no `Writer` references them, and an errored
        // writer never drains again).
        // NOTE: inline `handle_dead_writer` instead of calling the helper —
        // the helper re-derives `state()` while `s` is still live, which is two
        // simultaneous `&mut State` (UB under Stacked Borrows).
        if s.flags.broken_pipe {
            let err = sys::Error::from_code(E::EPIPE, sys::Tag::write).to_system_error();
            return Yield::OnIoWriterChunk {
                child,
                written: 0,
                err: Some(err),
            };
        }
        if let Some(err) = &s.err {
            return Yield::OnIoWriterChunk {
                child,
                written: 0,
                err: Some(err.to_shell_system_error()),
            };
        }
        let end = s.buf.len();
        self.sandbox_count_output(end - start);
        let s = self.state();
        s.writers.push(Writer {
            ptr: child,
            len: end - start,
            written: 0,
            bytelist,
        });
        self.enqueue_internal(child)
    }

    /// Format `args` into the write buffer and enqueue the resulting chunk
    /// for `child` (no builtin-name prefix).
    pub fn enqueue_fmt(
        &self,
        child: ChildPtr,
        bytelist: Option<*mut Vec<u8>>,
        args: core::fmt::Arguments<'_>,
    ) -> Yield {
        self.enqueue_fmt_bltn(child, bytelist, None, args)
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
    uv_loop    = |this| (*(*this).evtloop().loop_()).uv_loop,
    // INVARIANT: `this` is `Arc::as_ptr` stashed via `writer.set_parent` in
    // `IOWriter::init` (sole constructor); passing a non-Arc ptr is UB.
    ref_       = |this| std::sync::Arc::increment_strong_count(this as *const Self),
    deref      = |this| std::sync::Arc::decrement_strong_count(this as *const Self),
}

// ──────────────────────────────────────────────────────────────────────────
// drainBufferedData / tryWrite (POSIX file path)
// ──────────────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
fn try_write_with_write_fn(
    fd: Fd,
    buf: &[u8],
    write_fn: fn(Fd, &[u8]) -> sys::Maybe<usize>,
) -> bun_io::WriteResult {
    let mut offset: usize = 0;
    while offset < buf.len() {
        match write_fn(fd, &buf[offset..]) {
            Err(err) => {
                if err.is_retry() {
                    return bun_io::WriteResult::Pending(offset);
                }
                // Return EPIPE as an error so it propagates properly.
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

/// TODO: This function and `try_write_with_write_fn` are copy-pastes from
/// PipeWriter; it would be nice to not have to do that.
#[cfg(not(windows))]
fn drain_buffered_data(
    parent: &IOWriter,
    buf: &[u8],
    max_write_size: usize,
) -> bun_io::WriteResult {
    let trimmed = if max_write_size < buf.len() && max_write_size > 0 {
        &buf[..max_write_size]
    } else {
        buf
    };
    let mut drained: usize = 0;
    while drained < trimmed.len() {
        match try_write_with_write_fn(parent.state().fd, buf, sys::write) {
            bun_io::WriteResult::Pending(pending) => {
                drained += pending;
                return bun_io::WriteResult::Pending(drained);
            }
            bun_io::WriteResult::Wrote(amt) => {
                drained += amt;
            }
            bun_io::WriteResult::Err(err) => {
                // Reported as an error even after a partial write: the caller
                // (`do_file_write`) fails the whole chunk either way, and it
                // must not dispatch the failure from under the trampoline.
                return bun_io::WriteResult::Err(err);
            }
            bun_io::WriteResult::Done(amt) => {
                drained += amt;
                return bun_io::WriteResult::Done(drained);
            }
        }
    }
    bun_io::WriteResult::Wrote(drained)
}

// ──────────────────────────────────────────────────────────────────────────
// Drop
// ──────────────────────────────────────────────────────────────────────────

impl Drop for IOWriter {
    fn drop(&mut self) {
        // With `Arc` the last ref drops *after* the callback returns, so the
        // synchronous path is safe (PipeWriter cannot touch us after free).
        // TODO: if a PipeWriter callback is on the stack when the last
        // Arc drops (possible via re-entrant child deinit), we need the async
        // hop. Revisit once `bun_event_loop::EventLoopTask` is wired to the
        // shell's `EventLoopHandle` shim.
        let s = self.state.get_mut();
        crate::shell_log!("IOWriter(fd={}) deinit", s.fd);
        #[cfg(not(windows))]
        {
            if matches!(s.writer.handle, bun_io::pipes::PollOrFd::Poll(_)) {
                s.writer
                    .handle
                    .close_impl(None, None::<fn(*mut c_void)>, false);
            }
        }
        #[cfg(windows)]
        {
            s.writer.close();
        }
        if s.fd != Fd::INVALID {
            let _ = sys::close(s.fd);
        }
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
    use crate::shell::states::{cmd, cond_expr, pipeline, subshell};
    match child.tag {
        WriterTag::Builtin => Builtin::on_io_writer_chunk(interp, child.node, written, err),
        WriterTag::Cmd => cmd::Cmd::on_io_writer_chunk(interp, child.node, written, err),
        WriterTag::Pipeline => {
            pipeline::Pipeline::on_io_writer_chunk(interp, child.node, written, err)
        }
        WriterTag::Subshell => {
            subshell::Subshell::on_io_writer_chunk(interp, child.node, written, err)
        }
        WriterTag::CondExpr => {
            cond_expr::CondExpr::on_io_writer_chunk(interp, child.node, written, err)
        }
        // `Interpreter.If` never enqueues to an IOWriter.
        WriterTag::If => {
            crate::shell::interpreter::unreachable_state("IOWriter.onIOWriterChunk", "If")
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
