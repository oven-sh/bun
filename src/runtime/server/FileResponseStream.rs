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
use bun_io::pipe_reader::ReaderFlags;
use bun_io::{BufferedReader, FileType, IoEvent, Owner, PollTag, ReadResult, ReadState};
use bun_jsc::JsCell;
use bun_ptr::RefPtr;
use bun_sys::{self as sys, Fd, File, MaybeOwnedFile};
use bun_uws::{AnyResponse, WriteResult};

use crate::server::jsc::VirtualMachine;
use crate::server::{DirectoryRoute, FileRoute, PendingRequest};

bun_output::declare_scope!(FileResponseStream, hidden);

#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct FileResponseStream {
    ref_count: Cell<u32>,
    resp: Cell<AnyResponse>,
    event_loop: bun_io::EventLoopCtx,
    reader: BufferedReader,
    /// After `reader`, whose poll goes first.
    fd: StreamFd,
    idle_timeout: Cell<u8>,

    /// Taken by whichever of complete / abort / error fires first.
    owner: Cell<Option<StreamOwner>>,

    mode: Cell<Mode>,
    sendfile: JsCell<Sendfile>,

    state: Cell<State>,
    /// For the uWS callbacks and the reader, until `finish()`.
    self_ref: JsCell<Option<RefPtr<Self>>>,
    /// A uv read in flight outlives `finish()`.
    #[cfg(windows)]
    read_ref: JsCell<Option<RefPtr<Self>>>,
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
        const ERRORED       = 1 << 1;
        const RESP_DETACHED = 1 << 2;
    }
}

/// The descriptor that a response is read from. Closed off this thread.
pub(crate) struct StreamFd(MaybeOwnedFile);

impl StreamFd {
    pub(crate) fn borrowed(fd: Fd) -> Self {
        Self(MaybeOwnedFile::Borrowed(fd))
    }

    pub(crate) fn get(&self) -> Fd {
        self.0.fd()
    }
}

impl From<File> for StreamFd {
    fn from(file: File) -> Self {
        Self(file.into())
    }
}

impl Drop for StreamFd {
    fn drop(&mut self) {
        if let MaybeOwnedFile::Owned(file) = core::mem::take(&mut self.0) {
            #[cfg(windows)]
            Closer::close(file, bun_sys::windows::libuv::Loop::get());
            #[cfg(not(windows))]
            Closer::close(file, ());
        }
    }
}

pub(crate) struct StartOptions {
    pub fd: StreamFd,
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
    pub owner: StreamOwner,
}

/// Who hears about the end of the stream. Exactly one of complete / abort /
/// error is delivered, exactly once.
pub(crate) enum StreamOwner {
    /// A reload can remove the route from the route table meanwhile.
    FileRoute(PendingRequest<RefPtr<FileRoute>>),
    DirectoryRoute(PendingRequest<RefPtr<DirectoryRoute>>),
    Ctx {
        ctx: *mut c_void,
        on_complete: fn(*mut c_void, AnyResponse),
        /// Fires instead of `on_complete` when the client disconnects
        /// mid-stream. If `None`, abort is reported via `on_complete`.
        on_abort: Option<fn(*mut c_void, AnyResponse)>,
        on_error: fn(*mut c_void, AnyResponse, sys::Error),
    },
}

enum StreamEnd {
    Complete,
    Abort,
    Error(sys::Error),
}

impl StreamOwner {
    fn deliver(self, resp: AnyResponse, end: StreamEnd) {
        match self {
            StreamOwner::FileRoute(route) => drop(route),
            StreamOwner::DirectoryRoute(route) => drop(route),
            StreamOwner::Ctx {
                ctx,
                on_complete,
                on_abort,
                on_error,
            } => match end {
                StreamEnd::Complete => on_complete(ctx, resp),
                StreamEnd::Abort => on_abort.unwrap_or(on_complete)(ctx, resp),
                StreamEnd::Error(err) => on_error(ctx, resp, err),
            },
        }
    }
}

impl FileResponseStream {
    pub(crate) fn start(opts: StartOptions) {
        let use_sendfile = can_sendfile(opts.resp, opts.file_type, opts.length);

        let owned = RefPtr::new(FileResponseStream {
            ref_count: Cell::new(1),
            resp: Cell::new(opts.resp),
            event_loop: opts.vm.loop_ctx(),
            fd: opts.fd,
            idle_timeout: Cell::new(opts.idle_timeout),
            owner: Cell::new(Some(opts.owner)),
            mode: Cell::new(if use_sendfile {
                Mode::Sendfile
            } else {
                Mode::Reader
            }),
            reader: BufferedReader::init(),
            sendfile: JsCell::new(Sendfile::default()),
            state: Cell::new(State::default()),
            self_ref: JsCell::new(None),
            #[cfg(windows)]
            read_ref: JsCell::new(None),
        });
        owned.self_ref.set(Some(owned.clone()));
        let this = owned.as_ptr();
        let this_ref: &Self = &owned;

        let resp = this_ref.resp.get();
        resp.timeout(opts.idle_timeout);
        resp.on_aborted(
            |p: *mut FileResponseStream, r| {
                // SAFETY: uWS hands back the userdata pointer set below; the
                // guard keeps `*p` alive across the handler.
                unsafe {
                    let _guard = RefPtr::init_ref(p);
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
        let reader = &this_ref.reader;
        reader.update_flags(|f| {
            f.set(ReaderFlags::POLLABLE, opts.pollable);
            f.set(ReaderFlags::NONBLOCKING, opts.file_type != FileType::File);
            #[cfg(unix)]
            f.set(ReaderFlags::SOCKET, opts.file_type == FileType::Socket);
        });
        // The reader reports the end of the body as EOF, so `on_read_chunk` ends the response there like at a real EOF.
        reader.set_limit(opts.length.map(|len| len as usize));
        let owner = Owner::new(PollTag::FileResponseStream, this.cast());
        // SAFETY: `owner` points to the heap allocation that holds this reader.
        unsafe { reader.set_owner(owner) };

        let event_loop = this_ref.event_loop;
        let fd = MaybeOwnedFile::Borrowed(this_ref.fd.get());
        let start_result = if opts.offset > 0 {
            reader.start_file_offset(event_loop, fd, opts.pollable, opts.offset as usize)
        } else {
            reader.start(event_loop, fd, opts.pollable)
        };
        match start_result {
            Ok(result) => this_ref.on_read_result(result),
            Err(err) => return this_ref.fail_with(err),
        }

        reader.update_ref(true);

        #[cfg(windows)]
        this_ref.hold_read_ref();
        this_ref.read(None);
    }

    fn arm_on_writable(&self) {
        // Not a pointer made from `self`: the callback's guard may free through it.
        let Some(this) = self.self_ref.get() else {
            return;
        };
        self.resp.get().on_writable(
            |p: *mut FileResponseStream, off, r| {
                // SAFETY: uWS hands back the userdata pointer set below; the
                // guard keeps `*p` alive across the handler.
                unsafe {
                    let _guard = RefPtr::init_ref(p);
                    (*p).on_writable(off, r)
                }
            },
            this.as_ptr(),
        );
    }

    #[inline]
    fn insert_state(&self, flags: State) {
        self.state.set(self.state.get() | flags);
    }

    fn deliver(&self, resp: AnyResponse, end: StreamEnd) {
        if let Some(owner) = self.owner.take() {
            owner.deliver(resp, end);
        }
    }

    // ───────────────────────── reader backend ─────────────────────────

    pub(crate) fn read(&self, event: Option<IoEvent>) {
        let result = self
            .reader
            .read_chunks(self.event_loop, event, |chunk, state| {
                self.on_read_chunk(&chunk, state)
            });
        self.on_read_result(result);
    }

    fn on_read_chunk(&self, chunk: &[u8], state: ReadState) -> bool {
        if self.state.get().contains(State::RESPONSE_DONE) {
            return false;
        }

        let resp = self.resp.get();
        resp.timeout(self.idle_timeout.get());

        if state == ReadState::Eof {
            self.insert_state(State::RESPONSE_DONE);
            self.detach_resp();
            resp.end(chunk, resp.should_close_connection());
            self.deliver(resp, StreamEnd::Complete);
            return false;
        }

        match resp.write(chunk) {
            WriteResult::Backpressure(_) => {
                // `on_writable` takes it again.
                #[cfg(windows)]
                let _read_ref = self.read_ref.take();
                self.arm_on_writable();
                self.reader.pause();
                false
            }
            WriteResult::WantMore(_) => true,
        }
    }

    fn on_read_result(&self, result: ReadResult) {
        match result {
            ReadResult::Pending => return,
            ReadResult::Done => self.finish(),
            ReadResult::Err(err) => self.fail_with(err),
        }
        #[cfg(windows)]
        self.read_ref.set(None);
    }

    #[cfg(windows)]
    fn hold_read_ref(&self) {
        if self.read_ref.get().is_none() {
            self.read_ref.set(self.self_ref.get().clone());
        }
    }

    fn on_writable(&self, _: u64, _: AnyResponse) -> bool {
        bun_output::scoped_log!(FileResponseStream, "onWritable");

        if self.mode.get() == Mode::Sendfile {
            return self.on_sendfile();
        }

        if self.reader.is_done() {
            self.finish();
            return true;
        }
        self.resp.get().timeout(self.idle_timeout.get());
        #[cfg(windows)]
        self.hold_read_ref();
        // A paused POSIX reader ignores `read()`.
        self.on_read_result(self.reader.unpause());
        self.read(None);
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
        {
            // sendfile() bypasses the userspace socket buffer, so an unsent
            // header tail parked there must flush first or file bytes overtake
            // it on the wire. The writable path re-enters here once it has.
            let buffered = self.resp.get().get_buffered_amount();
            if buffered > 0 {
                bun_output::scoped_log!(
                    FileResponseStream,
                    "deferring sendfile behind {} buffered bytes",
                    buffered
                );
                return self.arm_sendfile_writable();
            }
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        loop {
            let (errno, sent, remain) = self.sendfile.with_mut(|sf| {
                let adjusted = sf.remain.min(i32::MAX as u64);
                let mut off: i64 = i64::try_from(sf.offset).expect("int cast");
                let rc = sys::linux::sendfile(
                    sf.socket_fd.native(),
                    self.fd.get().native(),
                    Some(&mut off),
                    adjusted as usize,
                );
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
            self.arm_on_writable();
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
        self.deliver(resp, StreamEnd::Complete);
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
            // An `abort` listener may close the fd, and epoll cannot remove a closed fd.
            #[cfg(unix)]
            self.reader.release_handle();
            self.deliver(self.resp.get(), StreamEnd::Abort);
        }
        self.finish();
    }

    fn fail_with(&self, err: sys::Error) {
        if !self.state.get().contains(State::RESPONSE_DONE) {
            self.insert_state(State::RESPONSE_DONE | State::ERRORED);
            self.detach_resp();
            let resp = self.resp.get();
            resp.force_close();
            self.deliver(resp, StreamEnd::Error(err));
        }
        self.finish();
    }

    /// Clears the uWS callbacks pointing at us; runs before `resp.end()` / `end_send_file()` / `force_close()` hand the socket back to uWS, after which nothing here touches `resp`.
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
            self.self_ref.get().is_none()
        );
        // Never the last ref: every entry point that can reach here holds its own.
        let Some(_self_ref) = self.self_ref.take() else {
            return;
        };

        if !self.state.get().contains(State::RESPONSE_DONE) {
            self.insert_state(State::RESPONSE_DONE);
            self.detach_resp();
            let resp = self.resp.get();
            // `end` writes a chunked body's final chunk, or `Content-Length: 0` if no
            // length was declared, and runs the uWS close check.
            resp.end(b"", resp.should_close_connection());
            self.deliver(resp, StreamEnd::Complete);
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
