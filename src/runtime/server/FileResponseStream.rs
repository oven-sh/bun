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
use bun_jsc::JsCell;
use bun_sys::{self as sys, Fd};
use bun_uws::{AnyResponse, WriteResult};

use crate::server::jsc::{EventLoopHandle, Task, VirtualMachine};

bun_output::declare_scope!(FileResponseStream, hidden);

#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct FileResponseStream {
    ref_count: Cell<u32>,
    resp: Cell<AnyResponse>,
    // LIFETIMES.tsv: `&'static VirtualMachine`. `BackRef` keeps the struct
    // `'static` for the uWS callback userdata slot while giving safe `Deref`.
    vm: Cell<bun_ptr::BackRef<VirtualMachine>>,
    /// Typed enum mirror of `vm.event_loop()` for the io-layer FilePoll vtable
    /// (`bun_io::EventLoopHandle` wraps `*const EventLoopHandle`).
    event_loop_handle: Cell<EventLoopHandle>,
    fd: Cell<Fd>,
    auto_close: Cell<bool>,
    idle_timeout: Cell<u8>,

    ctx: Cell<*mut c_void>,
    on_complete: Cell<fn(*mut c_void, AnyResponse)>,
    on_abort: Cell<Option<fn(*mut c_void, AnyResponse)>>,
    on_error: Cell<fn(*mut c_void, AnyResponse, sys::Error)>,

    mode: Cell<Mode>,
    reader: JsCell<BufferedReader>,
    max_size: Cell<Option<u64>>,
    sendfile: JsCell<Sendfile>,

    state: Cell<State>,
}

#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
#[repr(u8)]
pub enum Mode {
    Reader,
    Sendfile,
}

struct Sendfile {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    socket_fd: Fd,
    remain: u64,
    offset: u64,
    #[cfg(any(target_os = "linux", target_os = "android"))]
    has_set_on_writable: bool,
}

#[allow(
    clippy::derivable_impls,
    reason = "only derivable where the linux/android-gated fields are absent; `Fd` has no \
              `Default` impl, so `#[derive(Default)]` would not compile on linux/android"
)]
impl Default for Sendfile {
    fn default() -> Self {
        Self {
            #[cfg(any(target_os = "linux", target_os = "android"))]
            socket_fd: Fd::INVALID,
            remain: 0,
            offset: 0,
            #[cfg(any(target_os = "linux", target_os = "android"))]
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
        const READ_REF_HELD = 1 << 4;
    }
}

pub(crate) struct StartOptions {
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
    pub(crate) fn start(opts: &StartOptions) {
        let use_sendfile = can_sendfile(opts.resp, opts.file_type, opts.length);

        // Heap-allocate; the raw pointer is handed to uWS callbacks and freed
        // via `heap::take` in `deref()` when the intrusive refcount hits 0.
        let this: *mut FileResponseStream =
            bun_core::heap::into_raw(Box::new(FileResponseStream {
                ref_count: Cell::new(1),
                resp: Cell::new(opts.resp),
                vm: Cell::new(opts.vm),
                event_loop_handle: Cell::new(EventLoopHandle::init(
                    opts.vm.event_loop().cast::<()>(),
                )),
                fd: Cell::new(opts.fd),
                auto_close: Cell::new(opts.auto_close),
                idle_timeout: Cell::new(opts.idle_timeout),
                ctx: Cell::new(opts.ctx),
                on_complete: Cell::new(opts.on_complete),
                on_abort: Cell::new(opts.on_abort),
                on_error: Cell::new(opts.on_error),
                mode: Cell::new(if use_sendfile {
                    Mode::Sendfile
                } else {
                    Mode::Reader
                }),
                reader: JsCell::new(BufferedReader::init::<FileResponseStream>()),
                max_size: Cell::new(None),
                sendfile: JsCell::new(Sendfile::default()),
                state: Cell::new(State::default()),
            }));
        // SAFETY: `this` is the live allocation above; the guard's ref defers
        // any free until after `this_ref` is dead at the end of this frame.
        let _guard = unsafe { bun_ptr::ScopedRef::<Self>::new(this) };
        // SAFETY: `this` is live for at least as long as `_guard`.
        let this_ref = unsafe { &*this };

        let resp = this_ref.resp.get();
        resp.timeout(opts.idle_timeout);
        resp.on_aborted(
            |p: *mut FileResponseStream, r| {
                // SAFETY: uWS hands back the userdata pointer set below; the
                // guard keeps `*p` alive across the handler.
                unsafe {
                    let _guard = bun_ptr::ScopedRef::<Self>::new(p);
                    (*p).on_aborted(r);
                }
            },
            this,
        );

        bun_output::scoped_log!(
            FileResponseStream,
            "start mode={} len={:?}",
            <&'static str>::from(this_ref.mode.get()),
            opts.length
        );

        if use_sendfile {
            this_ref.sendfile.set(Sendfile {
                #[cfg(any(target_os = "linux", target_os = "android"))]
                socket_fd: opts.resp.get_native_handle(),
                offset: opts.offset,
                remain: opts.length.expect("can_sendfile gates None"),
                #[cfg(any(target_os = "linux", target_os = "android"))]
                has_set_on_writable: false,
            });
            resp.prepare_for_sendfile();
            let _ = this_ref.on_sendfile();
            return;
        }

        // BufferedReader path
        this_ref.max_size.set(opts.length);
        this_ref.reader.with_mut(|reader| {
            reader.flags.remove(ReaderFlags::CLOSE_HANDLE); // we own fd via auto_close
            reader.flags.set(ReaderFlags::POLLABLE, opts.pollable);
            reader
                .flags
                .set(ReaderFlags::NONBLOCKING, opts.file_type != FileType::File);
            #[cfg(unix)]
            if opts.file_type == FileType::Socket {
                reader.flags.insert(ReaderFlags::SOCKET);
            }
            reader.set_parent(this.cast::<c_void>());
        });

        // SAFETY: `start()`/`start_file_offset()` re-enter this object through
        // the parent pointer (`loop_`/`event_loop`), so no cell borrow spans them.
        let reader = this_ref.reader_mut();
        let start_result = if opts.offset > 0 {
            reader.start_file_offset(opts.fd, opts.pollable, opts.offset as usize)
        } else {
            reader.start(opts.fd, opts.pollable)
        };
        if let Err(err) = start_result {
            this_ref.fail_with(err);
            return;
        }

        // SAFETY: as above — `update_ref` re-enters `event_loop` through the parent pointer.
        this_ref.reader_mut().update_ref(true);

        #[cfg(unix)]
        if let Some(poll) = this_ref.reader.get().handle.get_poll() {
            if this_ref
                .reader
                .get()
                .flags
                .contains(ReaderFlags::NONBLOCKING)
            {
                poll.set_flag(FilePollFlag::Nonblocking);
            }
            match opts.file_type {
                FileType::Socket => poll.set_flag(FilePollFlag::Socket),
                FileType::NonblockingPipe | FileType::Pipe => poll.set_flag(FilePollFlag::Fifo),
                FileType::File => {}
            }
        }

        // hold a ref for the in-flight read; released in on_reader_done/on_reader_error
        this_ref.hold_read_ref();
        // SAFETY: `reader` is live for the stream's lifetime; `read` is the
        // raw re-entrancy-safe entry (its dispatch runs user JS).
        unsafe { BufferedReader::read(this_ref.reader.as_ptr()) };
    }

    #[inline]
    fn as_ptr(&self) -> *mut Self {
        std::ptr::from_ref(self).cast_mut()
    }

    #[inline]
    fn insert_state(&self, flags: State) {
        self.state.set(self.state.get() | flags);
    }

    // ───────────────────────── reader backend ─────────────────────────

    #[allow(
        clippy::mut_from_ref,
        reason = "reader is a separate cell payload; see doc"
    )]
    fn reader_mut(&self) -> &mut BufferedReader {
        // SAFETY: `reader` is live for the stream's lifetime; the io crate's
        // re-entrancy contract (see doc) covers the nested call.
        unsafe { &mut *self.reader.as_ptr() }
    }

    fn on_read_chunk(&self, chunk_: &[u8], state_: ReadState) -> bool {
        if self.state.get().contains(State::RESPONSE_DONE) {
            return false;
        }

        let (chunk, state) = 'brk: {
            if let Some(max) = self.max_size.get() {
                let c = &chunk_[..chunk_.len().min(usize::try_from(max).unwrap_or(usize::MAX))];
                let remaining = max.saturating_sub(c.len() as u64);
                self.max_size.set(Some(remaining));
                if state_ != ReadState::Eof && remaining == 0 {
                    #[cfg(not(unix))]
                    // SAFETY: reader entry point; `pause()` does not call back
                    // into this object.
                    self.reader_mut().pause();
                    // Ref for the queued task; adopted in the
                    // `FileResponseStreamEof` dispatch/shutdown arms.
                    self.ref_();
                    // SAFETY: `vm.event_loop()` returns the live JS loop.
                    unsafe {
                        (*self.vm.get().event_loop()).enqueue_task(Task::init(self.as_ptr()));
                    }
                    break 'brk (c, ReadState::Eof);
                }
                break 'brk (c, state_);
            }
            (chunk_, state_)
        };

        let resp = self.resp.get();
        resp.timeout(self.idle_timeout.get());

        if state == ReadState::Eof {
            self.insert_state(State::RESPONSE_DONE);
            self.detach_resp();
            resp.end(chunk, resp.should_close_connection());
            (self.on_complete.get())(self.ctx.get(), resp);
            return false;
        }

        match resp.write(chunk) {
            WriteResult::Backpressure(_) => {
                // release the read ref; on_writable re-takes it. Adopts the ref
                // taken before `reader.read()` — no fresh `ref_()` here.
                let _guard2 = self.take_read_ref();
                resp.on_writable(
                    |p: *mut FileResponseStream, off, r| {
                        // SAFETY: uWS hands back the userdata pointer set below;
                        // the guard keeps `*p` alive across the handler.
                        unsafe {
                            let _guard = bun_ptr::ScopedRef::<Self>::new(p);
                            (*p).on_writable(off, r)
                        }
                    },
                    self.as_ptr(),
                );
                #[cfg(not(unix))]
                // SAFETY: reader entry point; `pause()` does not call back into
                // this object.
                self.reader_mut().pause();
                false
            }
            WriteResult::WantMore(_) => true,
        }
    }

    pub(crate) fn on_reader_done(&self) {
        // Adopts the in-flight read ref taken before `reader.read()`.
        let _guard = self.take_read_ref();
        self.finish();
    }

    fn on_reader_error(&self, err: sys::Error) {
        // Adopts the in-flight read ref taken before `reader.read()`.
        let _guard = self.take_read_ref();
        self.fail_with(err);
    }

    fn hold_read_ref(&self) {
        if self.state.get().contains(State::READ_REF_HELD) {
            return;
        }
        self.insert_state(State::READ_REF_HELD);
        self.ref_();
    }

    fn take_read_ref(&self) -> Option<bun_ptr::ScopedRef<Self>> {
        if !self.state.get().contains(State::READ_REF_HELD) {
            return None;
        }
        self.state
            .set(self.state.get().difference(State::READ_REF_HELD));
        // SAFETY: `self` is the live intrusive allocation; `READ_REF_HELD`
        // witnesses exactly one outstanding ref taken in `hold_read_ref`.
        Some(unsafe { bun_ptr::ScopedRef::<Self>::adopt(self.as_ptr()) })
    }

    fn on_writable(&self, _: u64, _: AnyResponse) -> bool {
        bun_output::scoped_log!(FileResponseStream, "onWritable");

        if self.mode.get() == Mode::Sendfile {
            return self.on_sendfile();
        }

        if self.reader.get().is_done() {
            self.finish();
            return true;
        }
        self.resp.get().timeout(self.idle_timeout.get());
        self.hold_read_ref();
        // SAFETY: `read()` dispatches `on_read_chunk`/`on_reader_done` back
        // into this object through the parent pointer, so no cell borrow
        // spans it.
        unsafe { BufferedReader::read(self.reader.as_ptr()) };
        true
    }

    // ───────────────────────── sendfile backend ─────────────────────────

    fn on_sendfile(&self) -> bool {
        bun_output::scoped_log!(
            FileResponseStream,
            "onSendfile remain={} offset={}",
            self.sendfile.get().remain,
            self.sendfile.get().offset
        );
        if self.state.get().contains(State::RESPONSE_DONE) {
            self.finish();
            return false;
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        loop {
            let (errno, sent, remain) = self.sendfile.with_mut(|sf| {
                let adjusted = sf.remain.min(i32::MAX as u64);
                let mut off: i64 = i64::try_from(sf.offset).expect("int cast");
                // SAFETY: both fds are valid open file descriptors owned by `self`;
                // `off` is a stack local.
                let rc = unsafe {
                    sys::linux::sendfile(
                        sf.socket_fd.native(),
                        self.fd.get().native(),
                        &raw mut off,
                        adjusted as usize,
                    )
                };
                let errno = sys::get_errno(rc);
                let sent: u64 =
                    u64::try_from((off - i64::try_from(sf.offset).expect("int cast")).max(0))
                        .unwrap();
                sf.offset = u64::try_from(off).expect("int cast");
                sf.remain = sf.remain.saturating_sub(sent);
                (errno, sent, sf.remain)
            });

            match errno {
                sys::E::SUCCESS => {
                    if remain == 0 || sent == 0 {
                        self.end_sendfile();
                        return false;
                    }
                    return self.arm_sendfile_writable();
                }
                sys::E::EINTR => continue,
                sys::E::EAGAIN => return self.arm_sendfile_writable(),
                _ => {
                    self.fail_with(
                        sys::Error::from_code(errno, sys::Tag::sendfile).with_fd(self.fd.get()),
                    );
                    return false;
                }
            }
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            unreachable!() // can_sendfile gates this
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn arm_sendfile_writable(&self) -> bool {
        bun_output::scoped_log!(FileResponseStream, "armSendfileWritable");
        if !self.sendfile.get().has_set_on_writable {
            self.sendfile.with_mut(|sf| sf.has_set_on_writable = true);
            self.resp.get().on_writable(
                |p: *mut FileResponseStream, off, r| {
                    // SAFETY: uWS hands back the userdata pointer set below; the
                    // guard keeps `*p` alive across the handler.
                    unsafe {
                        let _guard = bun_ptr::ScopedRef::<Self>::new(p);
                        (*p).on_writable(off, r)
                    }
                },
                self.as_ptr(),
            );
        }
        self.resp.get().mark_needs_more();
        true
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn end_sendfile(&self) {
        bun_output::scoped_log!(FileResponseStream, "endSendfile");
        if self.state.get().contains(State::RESPONSE_DONE) {
            return;
        }
        self.insert_state(State::RESPONSE_DONE);
        self.detach_resp();
        let resp = self.resp.get();
        resp.end_send_file(self.sendfile.get().offset, resp.should_close_connection());
        (self.on_complete.get())(self.ctx.get(), resp);
        // `end_send_file` bypasses every shouldCloseConnection() gate: it does
        // not go through internalEnd, and the onWritable gate is skipped
        // because this frame returns `false` to it. Run the gate here — after
        // `on_complete`, which must see a live socket — so Connection: close
        // and the graceful-stop close-when-idle mark actually close.
        //
        // `resp` is still valid here: usockets never frees a socket
        // synchronously — us_socket_close only links it onto the loop's
        // closed list, freed by us_internal_free_closed_sockets at the end of
        // the loop iteration — so the allocation outlives this frame no
        // matter what `on_complete` did (the same invariant that makes
        // passing `resp` to `on_complete` after the end sound). It is still
        // *this* HTTP socket: an upgrade (us_socket_adopt) is only reachable
        // from a live in-flight request, and this one just completed. And if
        // anything in the frame closed it, the shim's leading
        // us_socket_is_closed check returns before touching the destructed
        // ext. Only `finish()` runs after this, and it never touches `resp`.
        resp.close_if_done_and_marked();
        self.finish();
    }

    // ───────────────────────── lifecycle ─────────────────────────

    fn on_aborted(&self, _: AnyResponse) {
        bun_output::scoped_log!(FileResponseStream, "onAborted");
        if !self.state.get().contains(State::RESPONSE_DONE) {
            self.insert_state(State::RESPONSE_DONE);
            self.detach_resp();
            (self
                .on_abort
                .get()
                .unwrap_or_else(|| self.on_complete.get()))(
                self.ctx.get(), self.resp.get()
            );
        }
        self.finish();
    }

    fn fail_with(&self, err: sys::Error) {
        if !self.state.get().contains(State::RESPONSE_DONE) {
            self.insert_state(State::RESPONSE_DONE | State::ERRORED);
            self.detach_resp();
            let resp = self.resp.get();
            resp.force_close();
            (self.on_error.get())(self.ctx.get(), resp, err);
        }
        self.finish();
    }

    /// Clear all uWS callbacks pointing at us. Must run while `resp` is still
    /// live (i.e., before `resp.end()` / `end_send_file()` / `force_close()` give
    /// the socket back to uWS, which may free it on the next loop tick). After
    /// this runs, `finish()` — which can be reached from the deferred `eof_task`
    /// — will not touch `resp` again.
    fn detach_resp(&self) {
        if self.state.get().contains(State::RESP_DETACHED) {
            return;
        }
        self.insert_state(State::RESP_DETACHED);
        let resp = self.resp.get();
        resp.clear_on_writable();
        resp.clear_aborted();
        resp.clear_timeout();
    }

    fn finish(&self) {
        bun_output::scoped_log!(
            FileResponseStream,
            "finish (already={})",
            self.state.get().contains(State::FINISHED)
        );
        if self.state.get().contains(State::FINISHED) {
            return;
        }
        self.insert_state(State::FINISHED);

        if !self.state.get().contains(State::RESPONSE_DONE) {
            self.insert_state(State::RESPONSE_DONE);
            self.detach_resp();
            let resp = self.resp.get();
            resp.end_without_body(resp.should_close_connection());
            (self.on_complete.get())(self.ctx.get(), resp);
            // This end runs uncorked (reader callbacks), so no cork or parser
            // gate will run the close check; do it here, after `on_complete`
            // like `end_sendfile`, so the callbacks see a live socket.
            resp.close_if_done_and_marked();
        }

        // Release the owner ref from `heap::into_raw` in `start()`. Every entry
        // point that can reach here holds its own ref, so the free lands on
        // that guard's drop, not here.
        // SAFETY: `self` is live and owns the ref; nothing touches `self` after.
        unsafe { Self::deref(self.as_ptr()) };
    }

    fn event_loop(&self) -> EventLoopHandle {
        EventLoopHandle::init(self.vm.get().event_loop().cast::<()>())
    }

    fn r#loop(&self) -> *mut bun_io::Loop {
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

// BufferedReader vtable parent.
// `loop_` delegates to the inherent `r#loop()` which already does the
// cfg(windows) `.uv_loop` projection. The read/done/error arms take a ref for
// the duration of the handler since it can end in `finish()`.
bun_io::impl_buffered_reader_parent! {
    FileResponseStream for FileResponseStream;
    has_on_read_chunk = true;
    on_read_chunk   = |this, chunk, state| {
        let _guard = bun_ptr::ScopedRef::<Self>::new(this);
        (*this).on_read_chunk(chunk, state)
    };
    on_reader_done  = |this| {
        let _guard = bun_ptr::ScopedRef::<Self>::new(this);
        (*this).on_reader_done()
    };
    on_reader_error = |this, err| {
        let _guard = bun_ptr::ScopedRef::<Self>::new(this);
        (*this).on_reader_error(err)
    };
    loop_           = |this| (*this).r#loop();
    event_loop      = |this| (*this).event_loop_handle.get().as_event_loop_ctx();
}

impl Drop for FileResponseStream {
    fn drop(&mut self) {
        bun_output::scoped_log!(FileResponseStream, "deinit");
        // `self.reader` (BufferedReader) is torn down by its own `Drop` as a
        // field — closes the poll handle. `bun.destroy(this)` is owned by
        // `heap::take` in `deref`, not here.
        if self.auto_close.get() {
            #[cfg(windows)]
            Closer::close(self.fd.get(), bun_sys::windows::libuv::Loop::get());
            #[cfg(not(windows))]
            Closer::close(self.fd.get(), ());
        }
    }
}

fn can_sendfile(resp: AnyResponse, file_type: FileType, length: Option<u64>) -> bool {
    // Matches the cfg on `on_sendfile`. macOS is excluded: XNU's sendfile can
    // sleep uninterruptibly under mbuf pressure, leaving the process unkillable;
    // the BufferedReader path stays non-blocking.
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        let _ = (resp, file_type, length);
        return false;
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
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

impl bun_event_loop::Taskable for FileResponseStream {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::FileResponseStreamEof;
    /// `on_read_chunk` took a ref for the queued EOF hop; drop it.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract; adopts the ref the enqueue took.
        drop(unsafe { bun_ptr::ScopedRef::<FileResponseStream>::adopt(this) });
    }
}
