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

use bun_io::Closer;
#[cfg(windows)]
use bun_io::pipe_reader::WindowsFlags as ReaderFlags;
use bun_io::{BufferedReader, FileType, ReadState};
#[cfg(unix)]
use bun_io::{FilePollFlag, PosixFlags as ReaderFlags};
use bun_sys::{self as sys, Fd};
use bun_uws::{AnyResponse, WriteResult};

use crate::server::jsc::{AnyTask, EventLoopHandle, Task, VirtualMachine};

bun_output::declare_scope!(FileResponseStream, hidden);

#[derive(bun_ptr::CellRefCounted)]
pub struct FileResponseStream {
    ref_count: Cell<u32>,
    resp: AnyResponse,
    // LIFETIMES.tsv: `&'static VirtualMachine`. `BackRef` keeps the struct
    // `'static` for the uWS callback userdata slot while giving safe `Deref`.
    vm: bun_ptr::BackRef<VirtualMachine>,
    /// Typed enum mirror of `vm.event_loop()` for the io-layer FilePoll vtable
    /// (`bun_io::EventLoopHandle` wraps `*const EventLoopHandle`).
    event_loop_handle: EventLoopHandle,
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
        Self {
            socket_fd: Fd::INVALID,
            remain: 0,
            offset: 0,
            has_set_on_writable: false,
        }
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
    pub vm: bun_ptr::BackRef<VirtualMachine>,
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
        // via `heap::take` in `deref()` when the intrusive refcount hits 0.
        let this: *mut FileResponseStream =
            bun_core::heap::into_raw(Box::new(FileResponseStream {
                ref_count: Cell::new(1),
                resp: opts.resp,
                vm: opts.vm,
                event_loop_handle: EventLoopHandle::init(opts.vm.event_loop().cast::<()>()),
                fd: opts.fd,
                auto_close: opts.auto_close,
                idle_timeout: opts.idle_timeout,
                ctx: opts.ctx,
                on_complete: opts.on_complete,
                on_abort: opts.on_abort,
                on_error: opts.on_error,
                mode: if use_sendfile {
                    Mode::Sendfile
                } else {
                    Mode::Reader
                },
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
            std::ptr::from_mut::<FileResponseStream>(this),
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
        let this_parent = std::ptr::from_mut::<FileResponseStream>(this).cast::<c_void>();
        this.reader.set_parent(this_parent);

        // SAFETY: `this` reborrows the live heap::alloc allocation above.
        let _guard = unsafe { bun_ptr::ScopedRef::<Self>::new(this) };

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
        this.ref_();
        this.reader.read();
    }

    // ───────────────────────── reader backend ─────────────────────────

    pub fn on_read_chunk(&mut self, chunk_: &[u8], state_: ReadState) -> bool {
        let this: *mut Self = self;
        // SAFETY: `this` is the live intrusive allocation owning `self`.
        let _guard = unsafe { bun_ptr::ScopedRef::new(this) };

        if self.state.contains(State::RESPONSE_DONE) {
            return false;
        }

        // PORT NOTE: reshaped for borrowck — Zig captured `*max` mutably across the block.
        let (chunk, state) = 'brk: {
            if let Some(max) = self.max_size.as_mut() {
                let c = &chunk_[..chunk_
                    .len()
                    .min(usize::try_from(*max).unwrap_or(usize::MAX))];
                *max = max.saturating_sub(c.len() as u64);
                if state_ != ReadState::Eof && *max == 0 {
                    #[cfg(not(unix))]
                    self.reader.pause();
                    self.eof_task = Some(AnyTask::AnyTask::from_typed(this, |p| {
                        // SAFETY: `p` is the `*mut FileResponseStream` stored just
                        // above; the eof_task lives inside `*p` and the ref taken
                        // for the in-flight read keeps the allocation alive until
                        // `on_reader_done` releases it.
                        unsafe { (*p).on_reader_done() };
                        Ok(())
                    }));
                    // SAFETY: `vm.event_loop()` returns the live JS loop;
                    // `eof_task` was just set and lives inside `*this` which
                    // outlives the task (refcount held until `on_reader_done`).
                    unsafe {
                        (*self.vm.event_loop()).enqueue_task(Task::init(std::ptr::from_mut::<
                            AnyTask::AnyTask,
                        >(
                            self.eof_task.as_mut().unwrap(),
                        )));
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
                // taken before `reader.read()` — no fresh `ref_()` here.
                // SAFETY: `this` is the live intrusive allocation owning `self`.
                let _guard2 = unsafe { bun_ptr::ScopedRef::<Self>::adopt(this) };
                self.resp.on_writable(
                    |p: *mut FileResponseStream, off, r| {
                        // SAFETY: uWS hands back the userdata pointer set below.
                        unsafe { (*p).on_writable(off, r) }
                    },
                    std::ptr::from_mut::<FileResponseStream>(self),
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
        // SAFETY: `self` is the live intrusive allocation; `adopt` consumes the prior +1.
        let _guard = unsafe { bun_ptr::ScopedRef::<Self>::adopt(self) };
        self.finish();
    }

    pub fn on_reader_error(&mut self, err: sys::Error) {
        // Adopts the in-flight read ref taken before `reader.read()`.
        // SAFETY: `self` is the live intrusive allocation; `adopt` consumes the prior +1.
        let _guard = unsafe { bun_ptr::ScopedRef::<Self>::adopt(self) };
        self.fail_with(err);
    }

    fn on_writable(&mut self, _: u64, _: AnyResponse) -> bool {
        bun_output::scoped_log!(FileResponseStream, "onWritable");
        // SAFETY: `self` is the live intrusive allocation (uWS userdata ptr).
        let _guard = unsafe { bun_ptr::ScopedRef::<Self>::new(self) };

        if self.mode == Mode::Sendfile {
            return self.on_sendfile();
        }

        if self.reader.is_done() {
            self.finish();
            return true;
        }
        self.resp.timeout(self.idle_timeout);
        self.ref_();
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

        #[cfg(any(target_os = "linux", target_os = "android"))]
        loop {
            let adjusted = self.sendfile.remain.min(i32::MAX as u64);
            let mut off: i64 = i64::try_from(self.sendfile.offset).expect("int cast");
            // SAFETY: both fds are valid open file descriptors owned by `self`;
            // `off` is a stack local.
            let rc = unsafe {
                sys::linux::sendfile(
                    self.sendfile.socket_fd.native(),
                    self.fd.native(),
                    &raw mut off,
                    adjusted as usize,
                )
            };
            let errno = sys::get_errno(rc);
            let sent: u64 = u64::try_from(
                (off - i64::try_from(self.sendfile.offset).expect("int cast")).max(0),
            )
            .unwrap();
            self.sendfile.offset = u64::try_from(off).expect("int cast");
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
                i64::try_from(self.sendfile.remain.min(i32::MAX as u64)).expect("int cast");
            // SAFETY: both fds are valid open file descriptors owned by `self`;
            // `sbytes` is a stack local; hdtr is null per spec.
            let errno = sys::get_errno(unsafe {
                sys::c::sendfile(
                    self.fd.native(),
                    self.sendfile.socket_fd.native(),
                    i64::try_from(self.sendfile.offset).expect("int cast"),
                    &mut sbytes,
                    core::ptr::null_mut(),
                    0,
                )
            });
            let sent: u64 = u64::try_from(sbytes).expect("int cast");
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
        #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "macos")))]
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
                std::ptr::from_mut::<FileResponseStream>(self),
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
        // trampoline; provenance traces back to heap::alloc in `start()`.
        unsafe { Self::deref(self) };
    }

    pub fn event_loop(&self) -> EventLoopHandle {
        EventLoopHandle::init(self.vm.event_loop().cast::<()>())
    }

    pub fn r#loop(&self) -> *mut bun_io::Loop {
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
    // `ref_()`/`deref()` are provided by `#[derive(CellRefCounted)]`; the former
    // hand-rolled `ref_guard`/`DerefOnDrop` pair is now `bun_ptr::ScopedRef<Self>`.
}

// `bun.io.BufferedReader.init(@This())` — vtable parent. Maps the Zig
// `onReadChunk`/`onReaderDone`/`onReaderError`/`loop`/`eventLoop` decls.
// `loop_` delegates to the inherent `r#loop()` which already does the
// cfg(windows) `.uv_loop` projection (Zig spec: FileResponseStream.zig `loop()`).
bun_io::impl_buffered_reader_parent! {
    FileResponseStream for FileResponseStream;
    has_on_read_chunk = true;
    on_read_chunk   = |this, chunk, state| (*this).on_read_chunk(chunk, state);
    on_reader_done  = |this| (*this).on_reader_done();
    on_reader_error = |this, err| (*this).on_reader_error(err);
    loop_           = |this| (*this).r#loop();
    event_loop      = |this| (*this).event_loop_handle.as_event_loop_ctx();
}

impl Drop for FileResponseStream {
    fn drop(&mut self) {
        bun_output::scoped_log!(FileResponseStream, "deinit");
        // `self.reader` (BufferedReader) is torn down by its own `Drop` as a
        // field — closes the poll handle. `bun.destroy(this)` is owned by
        // `heap::take` in `deref`, not here.
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

// ported from: src/runtime/server/FileResponseStream.zig
