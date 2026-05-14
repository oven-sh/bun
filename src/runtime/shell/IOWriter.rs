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

#![allow(dead_code)]

use bun_collections::{ByteVecExt, VecExt};
use core::cell::UnsafeCell;
use core::ffi::c_void;

#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
#[cfg(not(windows))]
use bun_io::pipe_writer::PosixPipeWriter as _;
use bun_sys::{self as sys, E, Fd};

use crate::shell::interpreter::{EventLoopHandle, Interpreter, NodeId};
use crate::shell::yield_::Yield;

// ──────────────────────────────────────────────────────────────────────────
// ChildPtr (NodeId-arena port of Zig TaggedPointerUnion)
// ──────────────────────────────────────────────────────────────────────────

/// In the NodeId-arena port, a "writer child" is `(NodeId, WriterTag)` — the
/// id of the owning state node plus a tag saying which `on_io_writer_chunk`
/// impl to dispatch to. Replaces Zig's `TaggedPtrUnion<(Builtin, Cmd,
/// Pipeline, …, PipeReader.CapturedWriter)>`.
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
    pub const NULL: ChildPtr = ChildPtr {
        node: NodeId::NONE,
        tag: WriterTag::Cmd,
        raw: core::ptr::null_mut(),
    };

    #[inline]
    pub const fn new(node: NodeId, tag: WriterTag) -> ChildPtr {
        ChildPtr {
            node,
            tag,
            raw: core::ptr::null_mut(),
        }
    }

    /// Construct a `ChildPtr` targeting a `subproc::CapturedWriter` (lives
    /// outside the NodeId arena, recovered via `container_of` in the Zig).
    #[inline]
    pub fn subproc_capture(cw: *mut core::ffi::c_void) -> ChildPtr {
        ChildPtr {
            node: NodeId::NONE,
            tag: WriterTag::Subproc,
            raw: cw,
        }
    }

    #[inline]
    pub fn is_null(&self) -> bool {
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
/// into. Spec: IOWriter.zig `Writer`.
struct Writer {
    ptr: ChildPtr,
    len: usize,
    written: usize,
    bytelist: Option<*mut Vec<u8>>,
}

impl Writer {
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

/// Spec: IOWriter.zig `Writers = SmolList(Writer, 2)`.
// PERF(port): was inline-2 small-vec — profile in Phase B; smallvec crate.
type Writers = Vec<Writer>;

/// ~128kb. We shrink `buf` when we reach the last writer, but if that never
/// happens we shrink when it exceeds this threshold.
const SHRINK_THRESHOLD: usize = 1024 * 128;

// ──────────────────────────────────────────────────────────────────────────
// IOWriter
// ──────────────────────────────────────────────────────────────────────────

/// Spec: IOWriter.zig `WriterImpl = bun.io.BufferedWriter(IOWriter, …)`.
#[cfg(not(windows))]
pub type WriterImpl = bun_io::pipe_writer::PosixBufferedWriter<IOWriter>;
#[cfg(windows)]
pub type WriterImpl = bun_io::pipe_writer::WindowsBufferedWriter<IOWriter>;

/// Spec: IOWriter.zig `Poll = WriterImpl` — the `FilePoll.Owner` payload type
/// (`@field(Owner.Tag, @typeName(ShellBufferedWriter))` arm in
/// `posix_event_loop.zig`).
pub type Poll = WriterImpl;

/// Poll-dispatch entry for `SHELL_BUFFERED_WRITER`. Holds an extra Arc strong
/// ref across `on_poll` so child `onIOWriterChunk` callbacks (via `bump()`)
/// can drop the last external ref without freeing `self` while PipeWriter is
/// still on the stack. Spec uses an async-deinit hop for the same guarantee.
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
    /// Spec: IOWriter.zig `runFromMainThread` — explicitly a no-op
    /// (`// this is unused`). Kept only because `task_tag::ShellIOWriter`
    /// exists in the Zig task-tag enum and the Rust dispatch table mirrors it.
    /// No code path enqueues this tag.
    pub fn run_from_main_thread(_this: *mut IOWriter) {
        // intentionally empty — see spec. No unsafe operations; the pointer
        // is never dereferenced.
    }

    /// Spec: IOWriter.zig `__deinit` (the body `AsyncDeinitWriter` posts back
    /// to main). Tears down the underlying `WriterImpl` and drops the last
    /// strong ref.
    pub fn deinit_on_main_thread(this: *mut IOWriter) {
        // SAFETY: `this` is the `Arc::as_ptr` whose strong count was held by
        // the async-deinit task.
        unsafe { std::sync::Arc::decrement_strong_count(this) };
    }
}

/// Mutable state. Wrapped in `UnsafeCell` so `Arc<IOWriter>`-shared callers can
/// mutate via `&self` (single-threaded shell; matches Zig `*IOWriter` model).
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
    err: Option<sys::SystemError>,
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
    /// until then. Spec: implicit in Zig (children held `*Interpreter` via
    /// `@fieldParentPtr`).
    interp: Option<bun_ptr::ParentRef<Interpreter>>,
}

pub struct IOWriter {
    state: UnsafeCell<State>,
}

// SAFETY: shell is single-threaded; `Arc` is used purely for refcounting (Zig
// used `bun.ptr.RefCount`). No cross-thread access.
unsafe impl Send for IOWriter {}
unsafe impl Sync for IOWriter {}

impl IOWriter {
    /// SAFETY: single-threaded; no overlapping `&mut State` may be live across
    /// a re-entrant `enqueue` from a child callback (Zig had the same hazard
    /// and guards via the `Yield` trampoline).
    #[inline]
    fn state(&self) -> &mut State {
        unsafe { &mut *self.state.get() }
    }

    /// Bump our own Arc strong count. Held across re-entrant `run_yield` calls
    /// whose child callback may drop the last external ref and free us
    /// mid-method. Spec gets the same guarantee from `asyncDeinit`'s next-tick
    /// hop; here we keep a strong ref on the stack instead.
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
                self_weak: w.clone(),
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
    #[inline]
    pub fn set_interp(&self, interp: *mut Interpreter) {
        // SAFETY: `interp` is the live owning Interpreter (it owns the IO
        // struct that holds this Arc); single-threaded.
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
    #[inline]
    fn io_evtloop(&self) -> bun_io::EventLoopHandle {
        // SAFETY: `bun_io::EventLoopHandle` stores `*mut c_void` purely for
        // type-erasure; vtable consumers treat the pointee as read-only
        self.state().evtloop.as_event_loop_ctx()
    }

    // ── start ────────────────────────────────────────────────────────────

    /// Spec: IOWriter.zig `__start`.
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
            // Spec: PipeWriter.zig:919-924 — when `Source::open` produced a uv
            // pipe/tty, libuv has TAKEN OWNERSHIP of the underlying HANDLE
            // (`uv_pipe_open`/`uv_tty_init`) and `uv_close` (issued by
            // `s.writer.close()` in Drop) will close it. Zig records this via
            // `rawfd.take()` on the `*MovableIfWindowsFd` it passes to
            // `writer.start`, nulling `this.fd` so `deinitOnMainThread`'s
            // `if (this.fd.isValid()) this.fd.close()` is a no-op. The Rust
            // port stores a plain `Fd` and `BaseWindowsPipeWriter::start`
            // drops the `take()` (TODO at PipeWriter.rs:1277), so disarm the
            // Drop close here instead. The `Source::File`/`SyncFile` case
            // (incl. the EBADF→`start_with_file` fallback above, which
            // `return`s early) keeps `s.fd` valid: with `owns_fd=false`
            // PipeWriter does NOT close it there, so Drop must.
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
            // PORT NOTE: re-derive `state()` — the EINVAL/EPERM fallback paths
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

    /// Idempotent write call. Spec: IOWriter.zig `write`.
    fn write(&self) -> WriteOutcome {
        let s = self.state();
        #[cfg(not(windows))]
        debug_assert!(s.flags.pollable);

        if !s.started {
            crate::shell_log!("IOWriter(fd={}) starting", s.fd);
            // Set before on_error: the callback chain may deref to 0 and
            // asyncDeinit's never-started fast-path would synchronously
            // destroy us mid-on_error.
            s.started = true;
            if let Err(e) = self.__start() {
                self.on_error(e);
                return WriteOutcome::Failed;
            }
            #[cfg(not(windows))]
            {
                // PORT NOTE: `__start()` re-derives `state()` (and may mutate
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
            #[allow(unreachable_code)]
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
                self.on_error(e);
                return WriteOutcome::Failed;
            }
            return WriteOutcome::Suspended;
        }

        #[cfg(not(windows))]
        {
            debug_assert!(matches!(s.writer.handle, bun_io::pipes::PollOrFd::Poll(_)));
            if let Some(poll) = s.writer.get_poll() {
                // Spec: `poll.isWatching()` — `is_registered() && !needs_rearm`.
                // NOT `is_registered()`: after a one-shot fire that drains
                // everything (no `register_poll()`), `PollWritable` stays set
                // but `NeedsRearm` is set → `is_registered()` would return
                // Suspended without re-arming and stall the queue forever.
                if poll.is_watching() {
                    return WriteOutcome::Suspended;
                }
            }
            if let Err(e) = s.writer.start(s.fd, s.flags.pollable) {
                self.on_error(e);
                return WriteOutcome::Failed;
            }
            WriteOutcome::Suspended
        }
    }

    // ── queue management ────────────────────────────────────────────────

    /// Cancel the chunks enqueued by the given child by marking them as dead.
    /// Spec: IOWriter.zig `cancelChunks`.
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
    /// Spec: IOWriter.zig `skipDead`.
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

    fn is_last_idx(&self, idx: usize) -> bool {
        idx == self.state().writers.len().saturating_sub(1)
    }

    /// Only does things on windows. Spec: IOWriter.zig `setWriting`.
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
    /// writer. Spec: IOWriter.zig `getBuffer`.
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
        #[allow(unreachable_code)]
        result
    }

    fn get_buffer_impl(&self) -> &[u8] {
        // PORT NOTE: reshaped for borrowck — re-derive `state()` after
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
    /// Spec: IOWriter.zig `bump`.
    fn bump(&self, current_idx: usize) -> Yield {
        // PORT NOTE: reshaped for borrowck — `skip_dead()` re-derives `state()`,
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
            // Spec: `this.writers.truncate(this.writer_idx)` — drops the
            // *prefix* (Zig SmolList.truncate shifts down). Vec::drain(..idx).
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

    /// Spec: IOWriter.zig `doFileWrite`. POSIX-only.
    #[cfg(not(windows))]
    fn do_file_write(&self) -> Yield {
        // `drain_buffered_data`/`on_error` below re-enter the interpreter and
        // may drop the last external Arc; hold one across the whole body so the
        // trailing `set_writing(false)` defer runs on a live `self`.
        let _keepalive = self.keepalive();
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
        // PORT NOTE: re-derive `state()` after `drain_buffered_data` (which may
        // have called `on_error`) instead of holding a stale `&mut`.
        let amt = match result {
            bun_io::WriteResult::Done(amt) => amt,
            bun_io::WriteResult::Wrote(amt) => {
                // .wrote can be returned if an error was encountered but we
                // wrote some data before it happened. on_error was already
                // called inside drain_buffered_data.
                if self.state().err.is_some() {
                    return Yield::done();
                }
                amt
            }
            bun_io::WriteResult::Pending(_) => {
                unreachable!(
                    "drainBufferedData returning .pending in IOWriter.doFileWrite should not happen"
                );
            }
            bun_io::WriteResult::Err(e) => {
                self.on_error(e);
                return Yield::done();
            }
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

    /// Spec: IOWriter.zig `onWritePollable` (the `BufferedWriter.onWrite`
    /// hook). Runs on the event loop when the fd is writable.
    fn on_write_pollable(&self, amount: usize, status: bun_io::WriteStatus) {
        // PORT NOTE: `set_writing` re-derives `state()` on Windows, which would
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
                // PORT NOTE: inline `is_last_idx` instead of calling
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
                // Other end of the socket/pipe closed and we got EPIPE.
                // (See the long comment in IOWriter.zig for the `ls | echo`
                // example.) Quick hack: have all writers see an error.
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
                // PORT NOTE: inline `set_writing(true)` instead of calling the
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

    /// Spec: IOWriter.zig `brokenPipeForWriters`.
    fn broken_pipe_for_writers(&self) {
        let s = self.state();
        debug_assert!(s.flags.broken_pipe);
        // PORT NOTE: reshaped for borrowck — collect targets first so we don't
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

    /// Spec: IOWriter.zig `onError`.
    fn on_error(&self, err: sys::Error) {
        let _keepalive = self.keepalive();
        self.set_writing(false);
        let s = self.state();
        if err.get_errno() == E::EPIPE {
            s.flags.broken_pipe = true;
        }
        s.err = Some(err.to_shell_system_error());
        // Writers before writer_idx have already had their callback fired and
        // may have been freed; only notify the still-pending ones, dedup'd.
        let mut seen: Vec<ChildPtr> = Vec::with_capacity(64);
        let start = s.writer_idx;
        // PORT NOTE: reshaped for borrowck — copy out the child ptrs first.
        let pending: Vec<ChildPtr> = s.writers[start..]
            .iter()
            .filter(|w| !w.is_dead())
            .map(|w| w.ptr)
            .collect();
        for ptr in pending {
            if seen.contains(&ptr) {
                continue;
            }
            seen.push(ptr);
            // Spec: `if (this.err) |*e| e.ref();` — `SystemError` in the Rust
            // port owns `bun_core::String`s by value (no shared refcount yet),
            // so re-derive a fresh one per callee instead of cloning the stored
            // error.
            let ee = err.to_shell_system_error();
            self.run_yield(Yield::OnIoWriterChunk {
                child: ptr,
                written: 0,
                err: Some(ee),
            });
        }
        let s = self.state();
        s.total_bytes_written = 0;
        s.writer_idx = 0;
        s.buf.clear();
        s.writers.clear();
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

    /// Spec: IOWriter.zig `handleBrokenPipe`.
    fn handle_broken_pipe(&self, ptr: ChildPtr) -> Option<Yield> {
        if self.state().flags.broken_pipe {
            let err = sys::Error::from_code(E::EPIPE, sys::Tag::write).to_system_error();
            return Some(Yield::OnIoWriterChunk {
                child: ptr,
                written: 0,
                err: Some(err),
            });
        }
        None
    }

    /// Spec: IOWriter.zig `enqueueFile`.
    #[cfg(not(windows))]
    fn enqueue_file(&self) -> Yield {
        let s = self.state();
        if s.is_writing {
            return Yield::suspended();
        }
        // The pollable path sets `started` in write(); the non-pollable file
        // path bypasses write() entirely, so set it here.
        s.started = true;
        self.set_writing(true);
        self.do_file_write()
    }

    /// You MUST have already added the data to `self.buf`!
    /// Spec: IOWriter.zig `enqueueInternal`.
    fn enqueue_internal(&self) -> Yield {
        debug_assert!(!self.state().flags.broken_pipe);
        #[cfg(not(windows))]
        if !self.state().flags.pollable {
            return self.enqueue_file();
        }
        match self.write() {
            WriteOutcome::Suspended => Yield::suspended(),
            #[cfg(not(windows))]
            WriteOutcome::IsActuallyFile => self.enqueue_file(),
            // FIXME (matches Zig)
            WriteOutcome::Failed => Yield::failed(),
            #[cfg(windows)]
            WriteOutcome::IsActuallyFile => unreachable!(),
        }
    }

    /// Queue `buf` for writing; when the chunk completes (or errors),
    /// `child`'s `on_io_writer_chunk` fires. Spec: IOWriter.zig `enqueue`.
    pub fn enqueue(&self, child: ChildPtr, bytelist: Option<*mut Vec<u8>>, buf: &[u8]) -> Yield {
        if let Some(y) = self.handle_broken_pipe(child) {
            return y;
        }
        if buf.is_empty() {
            return Yield::OnIoWriterChunk {
                child,
                written: 0,
                err: None,
            };
        }
        let s = self.state();
        s.buf.extend_from_slice(buf);
        s.writers.push(Writer {
            ptr: child,
            len: buf.len(),
            written: 0,
            bytelist,
        });
        self.enqueue_internal()
    }

    /// Spec: IOWriter.zig `enqueueFmtBltn` — prefix `"{kind}: "` then format.
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
        // Spec: Zig writes into `buf` *before* checking broken_pipe in
        // `enqueueFmt`; mirror that ordering (the bytes are dead but the
        // buffer will be cleared on the error path anyway).
        // PORT NOTE: inline `handle_broken_pipe` instead of calling the helper —
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
        let end = s.buf.len();
        s.writers.push(Writer {
            ptr: child,
            len: end - start,
            written: 0,
            bytelist,
        });
        self.enqueue_internal()
    }

    /// Spec: IOWriter.zig `enqueueFmt`.
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
    Failed,
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
    // Hold a keepalive across Windows on_write re-entry: `on_write_pollable` →
    // `run_yield` → `bump` may fire `on_io_writer_chunk`, which can drop the
    // last external `Arc<IOWriter>` (and the inline `uv_write_t`) mid-callback.
    win_on_write_guard = |this| (&*this).keepalive(),
}

// ──────────────────────────────────────────────────────────────────────────
// drainBufferedData / tryWrite (POSIX file path)
// ──────────────────────────────────────────────────────────────────────────

/// Spec: IOWriter.zig `tryWriteWithWriteFn`.
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

/// Spec: IOWriter.zig `drainBufferedData`.
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
                if drained > 0 {
                    parent.on_error(err);
                    return bun_io::WriteResult::Wrote(drained);
                }
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
// Drop (replaces Zig RefCount.deref → asyncDeinit → deinitOnMainThread)
// ──────────────────────────────────────────────────────────────────────────

impl Drop for IOWriter {
    fn drop(&mut self) {
        // Spec: IOWriter.zig `deinitOnMainThread`. The Zig version hopped to
        // the next tick when `started` to avoid PipeWriter touching us after
        // free; with `Arc` the last ref drops *after* the callback returns, so
        // the synchronous path is safe.
        // TODO(port): if a PipeWriter callback is on the stack when the last
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
pub fn on_io_writer_chunk(
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
        // `Interpreter.If` is not in the spec's `ChildPtrRaw` union (IOWriter.zig
        // :765-793) — it never enqueues to an IOWriter.
        WriterTag::If => {
            crate::shell::interpreter::unreachable_state("IOWriter.onIOWriterChunk", "If")
        }
        // Spec dispatches to `subproc.PipeReader.CapturedWriter`; that lives
        // outside the NodeId arena (heap-allocated PipeReader), so the target
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

// ported from: src/shell/IOWriter.zig
