//! Streams an already-open file descriptor to a uWS `AnyResponse`, handling
//! backpressure, client aborts, and fd lifetime. Shared by `FileRoute` (static
//! file routes) and `RequestContext` (file-blob bodies returned from `fetch`
//! handlers) so both get the same abort-safe lifecycle and so the SSL/Windows
//! path streams instead of buffering the whole file.
//!
//! The caller writes status + headers first, then hands off body streaming by
//! calling `start()`. Exactly one of `on_complete` / `on_error` fires, exactly
//! once; after it fires the caller must not touch `resp` body methods again.

use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::NonNull;

use bun_aio::Closer;
use bun_io::{BufferedReader, FileType, ReadState};
#[cfg(unix)]
use bun_io::{FilePollFlag, PosixFlags as ReaderFlags};
#[cfg(windows)]
use bun_io::pipe_reader::WindowsFlags as ReaderFlags;
use bun_sys::{self as sys, Fd};
use bun_uws::{AnyResponse, WriteResult};

use crate::server::jsc::{AnyTask, EventLoopHandle, Task, VirtualMachine};

bun_output::declare_scope!(FileResponseStream, hidden);

pub struct FileResponseStream {
    ref_count: Cell<u32>,
    resp: AnyResponse,
    // PORT NOTE: LIFETIMES.tsv classes this `&'static VirtualMachine`. Stored
    // raw so the struct stays `'static` for the uWS callback userdata slot.
    vm: *const VirtualMachine,
    fd: Fd,
    auto_close: bool,
    idle_timeout: u8,

    ctx: *mut c_void,
    on_complete: fn(*mut c_void, AnyResponse),
    on_abort: Option<fn(*mut c_void, AnyResponse)>,
    on_error: fn(*mut c_void, AnyResponse, sys::Error),

    mode: Mode,
    reader: BufferedReader,
    max_size: Option<u64>,
    eof_task: Option<AnyTask::AnyTask>,
    sendfile: Sendfile,

    state: State,
}

#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
#[repr(u8)]
enum Mode {
    Reader,
    Sendfile,
}

struct Sendfile {
    socket_fd: Fd,
    remain: u64,
    offset: u64,
    has_set_on_writable: bool,
}

impl Default for Sendfile {
    fn default() -> Self {
        Self { socket_fd: Fd::INVALID, remain: 0, offset: 0, has_set_on_writable: false }
    }
}

bitflags::bitflags! {
    #[derive(Default, Copy, Clone)]
    #[repr(transparent)]
    struct State: u8 {
        const RESPONSE_DONE = 1 << 0;
        const FINISHED      = 1 << 1;
        const ERRORED       = 1 << 2;
        const RESP_DETACHED = 1 << 3;
    }
}

pub struct StartOptions {
    pub fd: Fd,
    pub auto_close: bool,
    pub resp: AnyResponse,
    pub vm: *const VirtualMachine,
    pub file_type: FileType,
    pub pollable: bool,
    /// Byte offset into the file to begin reading from.
    pub offset: u64,
    /// Maximum bytes to send; `None` reads to EOF. For regular files this
    /// should be `stat.size - offset` (after Range/slice clamping).
    pub length: Option<u64>,
    pub idle_timeout: u8,
    pub ctx: *mut c_void,
    pub on_complete: fn(*mut c_void, AnyResponse),
    /// Fires instead of `on_complete` when the client disconnects mid-stream.
    /// If `None`, abort is reported via `on_complete`.
    pub on_abort: Option<fn(*mut c_void, AnyResponse)>,
    pub on_error: fn(*mut c_void, AnyResponse, sys::Error),
}

impl FileResponseStream {
    pub fn start(opts: StartOptions) {
        let use_sendfile = can_sendfile(opts.resp, opts.file_type, opts.length);

        // Heap-allocate; the raw pointer is handed to uWS callbacks and freed
        // via `Box::from_raw` in `deref()` when the intrusive refcount hits 0.
        let this: *mut FileResponseStream = Box::into_raw(Box::new(FileResponseStream {
            ref_count: Cell::new(1),
            resp: opts.resp,
            vm: opts.vm,
            fd: opts.fd,
            auto_close: opts.auto_close,
            idle_timeout: opts.idle_timeout,
            ctx: opts.ctx,
            on_complete: opts.on_complete,
            on_abort: opts.on_abort,
            on_error: opts.on_error,
            mode: if use_sendfile { Mode::Sendfile } else { Mode::Reader },
            reader: BufferedReader::init::<FileResponseStream>(),
            max_size: None,
            eof_task: None,
            sendfile: Sendfile::default(),
            state: State::default(),
        }));
        // SAFETY: just allocated above; uWS callbacks below alias `this` as raw ptr.
        let this = unsafe { &mut *this };

        this.resp.timeout(this.idle_timeout);
        this.resp.on_aborted(
            |p: *mut FileResponseStream, r| {
                // SAFETY: uWS hands back the userdata pointer set below.
                unsafe { (*p).on_aborted(r) }
            },
            this as *mut FileResponseStream,
        );

        bun_output::scoped_log!(
            FileResponseStream,
            "start mode={} len={:?}",
            <&'static str>::from(this.mode),
            opts.length
        );

        if use_sendfile {
            this.sendfile = Sendfile {
                socket_fd: opts.resp.get_native_handle(),
                offset: opts.offset,
                remain: opts.length.expect("can_sendfile gates None"),
                has_set_on_writable: false,
            };
            this.resp.prepare_for_sendfile();
            let _ = this.on_sendfile();
            return;
        }

        // BufferedReader path
        this.max_size = opts.length;
        this.reader.flags.remove(ReaderFlags::CLOSE_HANDLE); // we own fd via auto_close
        this.reader.flags.set(ReaderFlags::POLLABLE, opts.pollable);
        this.reader
            .flags
            .set(ReaderFlags::NONBLOCKING, opts.file_type != FileType::File);
        #[cfg(unix)]
        if opts.file_type == FileType::Socket {
            this.reader.flags.insert(ReaderFlags::SOCKET);
        }
        let this_parent = this as *mut FileResponseStream as *mut c_void;
        this.reader.set_parent(this_parent);

        // SAFETY: `this` reborrows the live Box::into_raw allocation above.
        let _guard = unsafe { Self::ref_guard(this) };

        let start_result = if opts.offset > 0 {
            this.reader
                .start_file_offset(this.fd, opts.pollable, opts.offset as usize)
        } else {
            this.reader.start(this.fd, opts.pollable)
        };
        if let Err(err) = start_result {
            this.fail_with(err);
            return;
        }

        this.reader.update_ref(true);

        #[cfg(unix)]
        if let Some(poll) = this.reader.handle.get_poll() {
            if this.reader.flags.contains(ReaderFlags::NONBLOCKING) {
                poll.set_flag(FilePollFlag::Nonblocking);
            }
            match opts.file_type {
                FileType::Socket => poll.set_flag(FilePollFlag::Socket),
                FileType::NonblockingPipe | FileType::Pipe => poll.set_flag(FilePollFlag::Fifo),
                FileType::File => {}
            }
        }

        // hold a ref for the in-flight read; released in on_reader_done/on_reader_error
        this.r#ref();
        this.reader.read();
    }

    // ───────────────────────── reader backend ─────────────────────────

    pub fn on_read_chunk(&mut self, chunk_: &[u8], state_: ReadState) -> bool {
        let this: *mut Self = self;
        // SAFETY: `this` is the live intrusive allocation owning `self`.
        let _guard = unsafe { Self::ref_guard(this) };

        if self.state.contains(State::RESPONSE_DONE) {
            return false;
        }

        // PORT NOTE: reshaped for borrowck — Zig captured `*max` mutably across the block.
        let (chunk, state) = 'brk: {
            if let Some(max) = self.max_size.as_mut() {
                let c = &chunk_[..chunk_.len().min(usize::try_from(*max).unwrap_or(usize::MAX))];
                *max = max.saturating_sub(c.len() as u64);
                if state_ != ReadState::Eof && *max == 0 {
                    #[cfg(not(unix))]
                    self.reader.pause();
                    // Zig: `jsc.AnyTask.New(FileResponseStream, onReaderDone).init(this)`
                    // — hand-fill the (ctx, callback) pair (option (b) in
                    // event_loop/AnyTask.rs) since Rust cannot take a fn value as
                    // a const generic.
                    self.eof_task = Some(AnyTask::AnyTask {
                        ctx: NonNull::new(this as *mut c_void),
                        callback: |ctx| {
                            // SAFETY: `ctx` is the `*mut FileResponseStream`
                            // stored just above; the eof_task lives inside `*ctx`
                            // and the ref taken for the in-flight read keeps the
                            // allocation alive until `on_reader_done` releases it.
                            unsafe { (*(ctx as *mut FileResponseStream)).on_reader_done() };
                            Ok(())
                        },
                    });
                    // SAFETY: `vm` is `&'static VirtualMachine` (LIFETIMES.tsv);
                    // its `event_loop()` returns the live JS loop. `eof_task` was
                    // just set and lives inside `*this` which outlives the task
                    // (refcount held until `on_reader_done`).
                    unsafe {
                        (*(*self.vm).event_loop()).enqueue_task(Task::init(
                            self.eof_task.as_mut().unwrap() as *mut AnyTask::AnyTask,
                        ));
                    }
                    break 'brk (c, ReadState::Eof);
                }
                break 'brk (c, state_);
            }
            (chunk_, state_)
        };

        self.resp.timeout(self.idle_timeout);

        if state == ReadState::Eof {
            self.state.insert(State::RESPONSE_DONE);
            self.detach_resp();
            self.resp.end(chunk, self.resp.should_close_connection());
            (self.on_complete)(self.ctx, self.resp);
            return false;
        }

        match self.resp.write(chunk) {
            WriteResult::Backpressure(_) => {
                // release the read ref; on_writable re-takes it. Adopts the ref
                // taken before `reader.read()` — no fresh `r#ref()` here.
                let _guard2 = DerefOnDrop(this);
                self.resp.on_writable(
                    |p: *mut FileResponseStream, off, r| {
                        // SAFETY: uWS hands back the userdata pointer set below.
                        unsafe { (*p).on_writable(off, r) }
                    },
                    self as *mut FileResponseStream,
                );
                #[cfg(not(unix))]
                self.reader.pause();
                false
            }
            WriteResult::WantMore(_) => true,
        }
    }

    pub fn on_reader_done(&mut self) {
        // Adopts the in-flight read ref taken before `reader.read()`.
        let _guard = DerefOnDrop(self);
        self.finish();
    }

    pub fn on_reader_error(&mut self, err: sys::Error) {
        // Adopts the in-flight read ref taken before `reader.read()`.
        let _guard = DerefOnDrop(self);
        self.fail_with(err);
    }

    fn on_writable(&mut self, _: u64, _: AnyResponse) -> bool {
        bun_output::scoped_log!(FileResponseStream, "onWritable");
        // SAFETY: `self` is the live intrusive allocation (uWS userdata ptr).
        let _guard = unsafe { Self::ref_guard(self) };

        if self.mode == Mode::Sendfile {
            return self.on_sendfile();
        }

        if self.reader.is_done() {
            self.finish();
            return true;
        }
        self.resp.timeout(self.idle_timeout);
        self.r#ref();
        self.reader.read();
        true
    }

    // ───────────────────────── sendfile backend ─────────────────────────

    fn on_sendfile(&mut self) -> bool {
        bun_output::scoped_log!(
            FileResponseStream,
            "onSendfile remain={} offset={}",
            self.sendfile.remain,
            self.sendfile.offset
        );
        if self.state.contains(State::RESPONSE_DONE) {
            self.finish();
            return false;
        }

        #[cfg(target_os = "linux")]
        loop {
            let adjusted = self.sendfile.remain.min(i32::MAX as u64);
            let mut off: i64 = i64::try_from(self.sendfile.offset).unwrap();
            // SAFETY: both fds are valid open file descriptors owned by `self`;
            // `off` is a stack local.
            let rc = unsafe {
                sys::linux::sendfile(
                    self.sendfile.socket_fd.native(),
                    self.fd.native(),
                    &mut off,
                    adjusted as usize,
                )
            };
            let errno = sys::get_errno(rc);
            let sent: u64 =
                u64::try_from((off - i64::try_from(self.sendfile.offset).unwrap()).max(0)).unwrap();
            self.sendfile.offset = u64::try_from(off).unwrap();
            self.sendfile.remain = self.sendfile.remain.saturating_sub(sent);

            match errno {
                sys::E::SUCCESS => {
                    if self.sendfile.remain == 0 || sent == 0 {
                        self.end_sendfile();
                        return false;
                    }
                    return self.arm_sendfile_writable();
                }
                sys::E::EINTR => continue,
                sys::E::EAGAIN => return self.arm_sendfile_writable(),
                _ => {
                    self.fail_with(
                        sys::Error::from_code(errno, sys::Tag::sendfile).with_fd(self.fd),
                    );
                    return false;
                }
            }
        }
        #[cfg(target_os = "macos")]
        loop {
            let mut sbytes: libc::off_t =
                i64::try_from(self.sendfile.remain.min(i32::MAX as u64)).unwrap();
            // SAFETY: both fds are valid open file descriptors owned by `self`;
            // `sbytes` is a stack local; hdtr is null per spec.
            let errno = sys::get_errno(unsafe {
                sys::c::sendfile(
                    self.fd.native(),
                    self.sendfile.socket_fd.native(),
                    i64::try_from(self.sendfile.offset).unwrap(),
                    &mut sbytes,
                    core::ptr::null_mut(),
                    0,
                )
            });
            let sent: u64 = u64::try_from(sbytes).unwrap();
            self.sendfile.offset += sent;
            self.sendfile.remain = self.sendfile.remain.saturating_sub(sent);

            match errno {
                sys::E::SUCCESS => {
                    if self.sendfile.remain == 0 || sent == 0 {
                        self.end_sendfile();
                        return false;
                    }
                    return self.arm_sendfile_writable();
                }
                sys::E::EINTR => continue,
                sys::E::EAGAIN => return self.arm_sendfile_writable(),
                sys::E::EPIPE | sys::E::ENOTCONN => {
                    self.end_sendfile();
                    return false;
                }
                _ => {
                    self.fail_with(
                        sys::Error::from_code(errno, sys::Tag::sendfile).with_fd(self.fd),
                    );
                    return false;
                }
            }
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos")))]
        {
            unreachable!() // can_sendfile gates this
        }
    }

    fn arm_sendfile_writable(&mut self) -> bool {
        bun_output::scoped_log!(FileResponseStream, "armSendfileWritable");
        if !self.sendfile.has_set_on_writable {
            self.sendfile.has_set_on_writable = true;
            self.resp.on_writable(
                |p: *mut FileResponseStream, off, r| {
                    // SAFETY: uWS hands back the userdata pointer set below.
                    unsafe { (*p).on_writable(off, r) }
                },
                self as *mut FileResponseStream,
            );
        }
        self.resp.mark_needs_more();
        true
    }

    fn end_sendfile(&mut self) {
        bun_output::scoped_log!(FileResponseStream, "endSendfile");
        if self.state.contains(State::RESPONSE_DONE) {
            return;
        }
        self.state.insert(State::RESPONSE_DONE);
        self.detach_resp();
        self.resp
            .end_send_file(self.sendfile.offset, self.resp.should_close_connection());
        (self.on_complete)(self.ctx, self.resp);
        self.finish();
    }

    // ───────────────────────── lifecycle ─────────────────────────

    fn on_aborted(&mut self, _: AnyResponse) {
        bun_output::scoped_log!(FileResponseStream, "onAborted");
        if !self.state.contains(State::RESPONSE_DONE) {
            self.state.insert(State::RESPONSE_DONE);
            self.detach_resp();
            (self.on_abort.unwrap_or(self.on_complete))(self.ctx, self.resp);
        }
        self.finish();
    }

    fn fail_with(&mut self, err: sys::Error) {
        if !self.state.contains(State::RESPONSE_DONE) {
            self.state.insert(State::RESPONSE_DONE);
            self.state.insert(State::ERRORED);
            self.detach_resp();
            self.resp.force_close();
            (self.on_error)(self.ctx, self.resp, err);
        }
        self.finish();
    }

    /// Clear all uWS callbacks pointing at us. Must run while `resp` is still
    /// live (i.e., before `resp.end()` / `end_send_file()` / `force_close()` give
    /// the socket back to uWS, which may free it on the next loop tick). After
    /// this runs, `finish()` — which can be reached from the deferred `eof_task`
    /// — will not touch `resp` again.
    fn detach_resp(&mut self) {
        if self.state.contains(State::RESP_DETACHED) {
            return;
        }
        self.state.insert(State::RESP_DETACHED);
        self.resp.clear_on_writable();
        self.resp.clear_aborted();
        self.resp.clear_timeout();
    }

    fn finish(&mut self) {
        bun_output::scoped_log!(
            FileResponseStream,
            "finish (already={})",
            self.state.contains(State::FINISHED)
        );
        if self.state.contains(State::FINISHED) {
            return;
        }
        self.state.insert(State::FINISHED);

        if !self.state.contains(State::RESPONSE_DONE) {
            self.state.insert(State::RESPONSE_DONE);
            self.detach_resp();
            self.resp
                .end_without_body(self.resp.should_close_connection());
            (self.on_complete)(self.ctx, self.resp);
        }

        // SAFETY: `self` is the unique &mut handed in by the uWS callback
        // trampoline; provenance traces back to Box::into_raw in `start()`.
        unsafe { Self::deref(self) };
    }

    pub fn event_loop(&self) -> EventLoopHandle {
        // SAFETY: `vm` is `&'static VirtualMachine` (LIFETIMES.tsv); event_loop()
        // returns its live `*mut jsc::EventLoop`.
        EventLoopHandle::init(unsafe { (*self.vm).event_loop() } as *mut ())
    }

    pub fn r#loop(&self) -> *mut bun_aio::Loop {
        #[cfg(windows)]
        {
            // SAFETY: `r#loop()` returns the live uws WindowsLoop; its `uv_loop`
            // is set by C `us_create_loop` and valid for the loop's lifetime.
            return unsafe { (*self.event_loop().r#loop()).uv_loop };
        }
        #[cfg(not(windows))]
        {
            self.event_loop().r#loop()
        }
    }

    // bun.ptr.RefCount(@This(), "ref_count", deinit, .{}) — intrusive single-thread RC.
    pub fn r#ref(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }

    /// RAII pair for `r#ref()` / `deref()`: bumps the intrusive refcount now and
    /// releases it on drop. Replaces the Zig `this.ref(); defer this.deref();`
    /// idiom. The guard holds a raw pointer (not `&mut Self`) so no Rust
    /// reference is live across the potential free in `deref()`.
    ///
    /// # Safety
    /// `this` must satisfy the contract of [`Self::deref`] for the guard's
    /// entire lifetime.
    #[inline]
    unsafe fn ref_guard(this: *mut Self) -> DerefOnDrop {
        // SAFETY: caller contract — `this` is live.
        unsafe { (*this).r#ref() };
        DerefOnDrop(this)
    }
    /// # Safety
    /// `this` must point to a live `FileResponseStream` allocated via
    /// `Box::into_raw` in `start()`. Mirrors Zig `RefCount.deref(*Self)` —
    /// takes a raw mut pointer (not `&self`) so the `Box::from_raw` on the
    /// zero-ref path has write provenance back to the original allocation
    /// instead of being laundered through a `&T -> *const T -> *mut T` cast.
    pub unsafe fn deref(this: *mut Self) {
        // SAFETY: per fn contract — `this` is live and exclusive at zero-ref.
        unsafe {
            let n = (*this).ref_count.get() - 1;
            (*this).ref_count.set(n);
            if n == 0 {
                // Intrusive ref_count just reached zero — no other live
                // references. Dropping the Box runs `impl Drop` (fd close) and
                // field drops.
                drop(Box::from_raw(this));
            }
        }
    }
}

/// RAII owner for one intrusive refcount on a `FileResponseStream`. Dropping
/// calls [`FileResponseStream::deref`], which may free `*self.0` — so callers
/// must not hold a live `&`/`&mut FileResponseStream` across the guard's drop
/// point. Construct via [`FileResponseStream::ref_guard`] (which also bumps the
/// count) or directly when adopting a ref taken elsewhere (e.g. the in-flight
/// read ref taken before `reader.read()`).
#[must_use = "dropping immediately releases the ref"]
struct DerefOnDrop(*mut FileResponseStream);
impl Drop for DerefOnDrop {
    fn drop(&mut self) {
        // SAFETY: constructor contract — `self.0` is a live `Box::into_raw`
        // pointer with at least one outstanding ref owned by this guard.
        unsafe { FileResponseStream::deref(self.0) }
    }
}

// `bun.io.BufferedReader.init(@This())` — vtable parent. Maps the Zig
// `onReadChunk`/`onReaderDone`/`onReaderError`/`loop`/`eventLoop` decls.
impl bun_io::BufferedReaderParent for FileResponseStream {
    const HAS_ON_READ_CHUNK: bool = true;
    // SAFETY (all): see `BufferedReaderParent` aliasing contract — `this` is the
    // `*mut Self` registered via `set_parent`; a `&mut` to the embedded reader
    // may be live on the caller's stack.
    unsafe fn on_read_chunk(this: *mut Self, chunk: &[u8], state: ReadState) -> bool {
        // SAFETY: trait aliasing contract; the body's reader accesses go through
        // the same `&mut self.reader` provenance the caller already holds.
        unsafe { (*this).on_read_chunk(chunk, state) }
    }
    unsafe fn on_reader_done(this: *mut Self) {
        // SAFETY: tail-position — reader is finished with `self`.
        unsafe { (*this).on_reader_done() }
    }
    unsafe fn on_reader_error(this: *mut Self, err: sys::Error) {
        // SAFETY: tail-position — reader is finished with `self`.
        unsafe { (*this).on_reader_error(err) }
    }
    unsafe fn loop_(this: *mut Self) -> *mut bun_uws_sys::Loop {
        // Route through the io vtable (knows EventLoopHandle layout).
        // SAFETY: trait contract — `this` non-null/live.
        unsafe { <Self as bun_io::BufferedReaderParent>::event_loop(this) }
            .loop_()
            .cast()
    }
    unsafe fn event_loop(this: *mut Self) -> bun_io::EventLoopHandle {
        // CYCLEBREAK: bun_io::EventLoopHandle is an opaque `*mut c_void`; pass
        // the raw `*mut jsc::EventLoop` through. The FilePoll vtable (registered
        // by bun_runtime::init) knows how to interpret it.
        // SAFETY: `this` non-null/live per trait contract; `vm` is
        // `&'static VirtualMachine` (LIFETIMES.tsv) and disjoint from `reader`.
        let vm = unsafe { *core::ptr::addr_of!((*this).vm) };
        // SAFETY: `vm` is &'static; event_loop() returns its live JS loop.
        bun_io::EventLoopHandle(unsafe { (*vm).event_loop() } as *mut c_void)
    }
}

impl Drop for FileResponseStream {
    fn drop(&mut self) {
        bun_output::scoped_log!(FileResponseStream, "deinit");
        // `self.reader` (BufferedReader) is torn down by its own `Drop` as a
        // field — closes the poll handle. `bun.destroy(this)` is owned by
        // `Box::from_raw` in `deref`, not here.
        if self.auto_close {
            #[cfg(windows)]
            Closer::close(self.fd, bun_sys::windows::libuv::Loop::get());
            #[cfg(not(windows))]
            Closer::close(self.fd, ());
        }
    }
}

fn can_sendfile(resp: AnyResponse, file_type: FileType, length: Option<u64>) -> bool {
    #[cfg(windows)]
    {
        let _ = (resp, file_type, length);
        return false;
    }
    #[cfg(not(windows))]
    {
        // sendfile() needs a real socket fd; SSL writes go through BIO and H3
        // through lsquic stream frames — neither has one.
        if !matches!(resp, AnyResponse::TCP(_)) {
            return false;
        }
        if file_type != FileType::File {
            return false;
        }
        let Some(len) = length else { return false };
        // Below ~1MB the syscall + dual-readiness overhead doesn't pay off.
        len >= (1 << 20)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/server/FileResponseStream.zig (411 lines)
//   confidence: high
//   notes:      intrusive RC + uWS callback aliasing means &mut self is reentrant
//               via raw ptr; DerefOnDrop holds *mut Self (not &self) so deref's
//               Box::from_raw retains write provenance.
// ──────────────────────────────────────────────────────────────────────────
