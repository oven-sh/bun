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

use bun_aio::{self as aio, Closer};
use bun_core::Environment;
use bun_io::{BufferedReader, FileType, ReadState};
use bun_jsc::{AnyTask, EventLoopHandle, Task, VirtualMachine};
use bun_sys::{self as sys, Fd};
use bun_uws::AnyResponse;

bun_output::declare_scope!(FileResponseStream, hidden);

pub struct FileResponseStream<'a> {
    ref_count: Cell<u32>,
    resp: AnyResponse,
    vm: &'a VirtualMachine,
    fd: Fd,
    auto_close: bool,
    idle_timeout: u8,

    ctx: *mut c_void,
    on_complete: fn(*mut c_void, AnyResponse),
    on_abort: Option<fn(*mut c_void, AnyResponse)>,
    on_error: fn(*mut c_void, AnyResponse, sys::Error),

    mode: Mode,
    // TODO(port): BufferedReader.init(FileResponseStream) wires a comptime parent
    // vtable; in Rust this is a trait impl (`impl BufferedReaderParent for
    // FileResponseStream`) + generic/erased parent pointer set via `set_parent`.
    reader: BufferedReader,
    max_size: Option<u64>,
    eof_task: Option<AnyTask>,
    sendfile: Sendfile,

    state: State,
}

#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
#[repr(u8)]
enum Mode {
    Reader,
    Sendfile,
}

#[derive(Default)]
struct Sendfile {
    socket_fd: Fd, // default = bun_sys::Fd::invalid()
    remain: u64,
    offset: u64,
    has_set_on_writable: bool,
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

pub struct StartOptions<'a> {
    pub fd: Fd,
    pub auto_close: bool, // default = true
    pub resp: AnyResponse,
    pub vm: &'a VirtualMachine,
    pub file_type: FileType,
    pub pollable: bool,
    /// Byte offset into the file to begin reading from.
    pub offset: u64, // default = 0
    /// Maximum bytes to send; `None` reads to EOF. For regular files this
    /// should be `stat.size - offset` (after Range/slice clamping).
    pub length: Option<u64>, // default = None
    pub idle_timeout: u8,
    pub ctx: *mut c_void,
    pub on_complete: fn(*mut c_void, AnyResponse),
    /// Fires instead of `on_complete` when the client disconnects mid-stream.
    /// If `None`, abort is reported via `on_complete`.
    pub on_abort: Option<fn(*mut c_void, AnyResponse)>, // default = None
    pub on_error: fn(*mut c_void, AnyResponse, sys::Error),
}

impl<'a> FileResponseStream<'a> {
    pub fn start(opts: StartOptions<'a>) {
        let use_sendfile = can_sendfile(opts.resp, opts.file_type, opts.length);

        // TODO(port): bun.new — heap-allocate as IntrusiveRc payload; pointer is
        // handed to uWS callbacks below and freed in `deinit` via Box::from_raw.
        let this: *mut FileResponseStream<'a> = Box::into_raw(Box::new(FileResponseStream {
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
        this.resp
            .on_aborted::<FileResponseStream>(Self::on_aborted, this);

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
                remain: opts.length.unwrap(),
                has_set_on_writable: false,
            };
            this.resp.prepare_for_sendfile();
            let _ = this.on_sendfile();
            return;
        }

        // BufferedReader path
        this.max_size = opts.length;
        this.reader.flags.close_handle = false; // we own fd via auto_close
        this.reader.flags.pollable = opts.pollable;
        this.reader.flags.nonblocking = opts.file_type != FileType::File;
        #[cfg(unix)]
        {
            if opts.file_type == FileType::Socket {
                this.reader.flags.socket = true;
            }
        }
        this.reader.set_parent(this);

        this.r#ref();
        let _guard = scopeguard::guard((), |_| this.deref());

        let start_result = if opts.offset > 0 {
            this.reader
                .start_file_offset(this.fd, opts.pollable, opts.offset)
        } else {
            this.reader.start(this.fd, opts.pollable)
        };
        match start_result {
            sys::Result::Err(err) => {
                this.fail_with(err);
                return;
            }
            sys::Result::Ok(()) => {}
        }

        this.reader.update_ref(true);

        #[cfg(unix)]
        {
            if let Some(poll) = this.reader.handle.get_poll() {
                if this.reader.flags.nonblocking {
                    poll.flags.insert(aio::PollFlag::Nonblocking);
                }
                match opts.file_type {
                    FileType::Socket => poll.flags.insert(aio::PollFlag::Socket),
                    FileType::NonblockingPipe | FileType::Pipe => {
                        poll.flags.insert(aio::PollFlag::Fifo)
                    }
                    FileType::File => {}
                }
            }
        }

        // hold a ref for the in-flight read; released in on_reader_done/on_reader_error
        this.r#ref();
        this.reader.read();
    }

    // ───────────────────────── reader backend ─────────────────────────

    pub fn on_read_chunk(&mut self, chunk_: &[u8], state_: ReadState) -> bool {
        self.r#ref();
        let _guard = scopeguard::guard((), |_| self.deref());

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
                    self.eof_task = Some(AnyTask::new::<FileResponseStream, _>(
                        Self::on_reader_done,
                        self,
                    ));
                    self.vm
                        .event_loop()
                        .enqueue_task(Task::init(self.eof_task.as_mut().unwrap()));
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
            bun_uws::WriteResult::Backpressure => {
                // release the read ref; on_writable re-takes it
                let _guard2 = scopeguard::guard((), |_| self.deref());
                self.resp
                    .on_writable::<FileResponseStream>(Self::on_writable, self);
                #[cfg(not(unix))]
                self.reader.pause();
                false
            }
            bun_uws::WriteResult::WantMore => true,
        }
    }

    pub fn on_reader_done(&mut self) {
        let _guard = scopeguard::guard((), |_| self.deref());
        self.finish();
    }

    pub fn on_reader_error(&mut self, err: sys::Error) {
        let _guard = scopeguard::guard((), |_| self.deref());
        self.fail_with(err);
    }

    fn on_writable(&mut self, _: u64, _: AnyResponse) -> bool {
        bun_output::scoped_log!(FileResponseStream, "onWritable");
        self.r#ref();
        let _guard = scopeguard::guard((), |_| self.deref());

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
        {
            loop {
                let adjusted = self.sendfile.remain.min(i32::MAX as u64);
                let mut off: i64 = i64::try_from(self.sendfile.offset).unwrap();
                // TODO(port): move to bun_sys::linux — std.os.linux.sendfile
                let rc = bun_sys::linux::sendfile(
                    self.sendfile.socket_fd.cast(),
                    self.fd.cast(),
                    &mut off,
                    adjusted,
                );
                let errno = sys::get_errno(rc);
                let sent: u64 =
                    u64::try_from((off - i64::try_from(self.sendfile.offset).unwrap()).max(0))
                        .unwrap();
                self.sendfile.offset = u64::try_from(off).unwrap();
                self.sendfile.remain = self.sendfile.remain.saturating_sub(sent);

                match errno {
                    sys::Errno::SUCCESS => {
                        if self.sendfile.remain == 0 || sent == 0 {
                            self.end_sendfile();
                            return false;
                        }
                        return self.arm_sendfile_writable();
                    }
                    sys::Errno::INTR => continue,
                    sys::Errno::AGAIN => return self.arm_sendfile_writable(),
                    _ => {
                        self.fail_with(sys::Error {
                            errno: errno as _,
                            syscall: sys::Syscall::Sendfile,
                            fd: self.fd,
                            ..Default::default()
                        });
                        return false;
                    }
                }
            }
        }
        #[cfg(target_os = "macos")]
        {
            loop {
                let mut sbytes: bun_sys::darwin::off_t = i64::try_from(
                    self.sendfile.remain.min(i32::MAX as u64),
                )
                .unwrap();
                // TODO(port): move to bun_sys::darwin — std.c.sendfile
                let errno = sys::get_errno(bun_sys::darwin::sendfile(
                    self.fd.cast(),
                    self.sendfile.socket_fd.cast(),
                    i64::try_from(self.sendfile.offset).unwrap(),
                    &mut sbytes,
                    core::ptr::null_mut(),
                    0,
                ));
                let sent: u64 = u64::try_from(sbytes).unwrap();
                self.sendfile.offset += sent;
                self.sendfile.remain = self.sendfile.remain.saturating_sub(sent);

                match errno {
                    sys::Errno::SUCCESS => {
                        if self.sendfile.remain == 0 || sent == 0 {
                            self.end_sendfile();
                            return false;
                        }
                        return self.arm_sendfile_writable();
                    }
                    sys::Errno::INTR => continue,
                    sys::Errno::AGAIN => return self.arm_sendfile_writable(),
                    sys::Errno::PIPE | sys::Errno::NOTCONN => {
                        self.end_sendfile();
                        return false;
                    }
                    _ => {
                        self.fail_with(sys::Error {
                            errno: errno as _,
                            syscall: sys::Syscall::Sendfile,
                            fd: self.fd,
                            ..Default::default()
                        });
                        return false;
                    }
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
            self.resp
                .on_writable::<FileResponseStream>(Self::on_writable, self);
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

        self.deref();
    }

    pub fn event_loop(&self) -> EventLoopHandle {
        EventLoopHandle::init(self.vm.event_loop())
    }

    pub fn r#loop(&self) -> *mut aio::Loop {
        #[cfg(windows)]
        {
            return self.event_loop().r#loop().uv_loop;
        }
        #[cfg(not(windows))]
        {
            self.event_loop().r#loop()
        }
    }

    // bun.ptr.RefCount(@This(), "ref_count", deinit, .{}) — intrusive single-thread RC.
    // TODO(port): replace with `impl bun_ptr::IntrusiveRefCounted for FileResponseStream`.
    pub fn r#ref(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }
    pub fn deref(&self) {
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            // SAFETY: `self` was allocated via Box::into_raw in `start()` and the
            // intrusive ref_count just reached zero — no other live references.
            // Dropping the Box runs `impl Drop` (fd close) and field drops.
            unsafe { drop(Box::from_raw(self as *const Self as *mut Self)) };
        }
    }
}

impl Drop for FileResponseStream<'_> {
    fn drop(&mut self) {
        bun_output::scoped_log!(FileResponseStream, "deinit");
        // `self.reader` (BufferedReader) is torn down by its own `Drop` as a
        // field — closes the poll handle. `bun.destroy(this)` is owned by
        // `bun_ptr::IntrusiveRc` (Box::from_raw in `deref`), not here.
        if self.auto_close {
            #[cfg(windows)]
            Closer::close(self.fd, bun_sys::windows::libuv::Loop::get());
            #[cfg(not(windows))]
            Closer::close(self.fd);
        }
    }
}

fn can_sendfile(resp: AnyResponse, file_type: FileType, length: Option<u64>) -> bool {
    #[cfg(windows)]
    {
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
//   confidence: medium
//   todos:      5
//   notes:      intrusive RC + uWS callback aliasing means &mut self is reentrant via raw ptr; scopeguard closures capturing &self across &mut body will need UnsafeCell/raw-ptr reshaping in Phase B
// ──────────────────────────────────────────────────────────────────────────
