//! The transport of a socket over a descriptor that is not a `us_socket_t`: `new net.Socket({ fd, writable: true })`
//! over a pipe, a terminal, or a socket that is only written to, and on POSIX `new net.Socket({ fd, readable: true })`
//! and `Bun.connect({ fd })` over a pipe or a FIFO.
//!
//! uSockets reads with `recv`, which a pipe refuses, so a `BufferedReader` reads it and `write(2)` writes it. A
//! readable descriptor is node's `uv_pipe_open` adoption: it is made non-blocking (stdio too, and the flag is never
//! put back) and, unless it is stdio, closed with the socket.

use core::cell::Cell;
use core::sync::atomic::{AtomicUsize, Ordering};

#[cfg(unix)]
use bun_io::{BufferedReader, PosixFlags, ReadState};
use bun_jsc::JsResult;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_ptr::ThisPtr;
use bun_sys::{self as sys, Fd, FdExt as _};
use bun_uws::{SocketTCP, Transport};

use super::TCPSocket;
use crate::dispatch::fold;

/// Pipes that `open` made and has not freed yet; `fdPipeInternals.liveCount()` in tests.
pub(crate) static LIVE_COUNT: AtomicUsize = AtomicUsize::new(0);

/// Writes with `write(2)` at once, in the descriptor's own blocking mode, so what a program wrote before `process.exit()` is out. It keeps no bytes: its socket queues what a full pipe refused.
pub(crate) struct FdPipe {
    handle: bun_uws::TransportHandle,
    fd: Fd,
    /// Not opened `O_RDONLY`: `shutdown` closes it, since a pipe's peer sees EOF no other way.
    writable: bool,
    /// `None` once closed or detached. `connect_finish` took the connection's ref on it, and `on_close` releases that ref.
    socket: Cell<Option<ThisPtr<TCPSocket>>>,
    is_shutdown: Cell<bool>,
    rejected_send_error: Cell<i32>,
    /// The task that closes and frees `self` is in the queue.
    is_queued: Cell<bool>,
    /// In no uSockets group, so the context that opened it closes it through this when it stops.
    abort_handle: bun_jsc::AbortHandle,
    /// Waits for the descriptor to take bytes again.
    #[cfg(unix)]
    poll: Cell<Option<*mut bun_io::posix_event_loop::FilePoll>>,
    /// `poll` watches this duplicate when a reader has `fd`: epoll registers a descriptor once.
    #[cfg(unix)]
    poll_fd: Cell<Fd>,
    /// `Some` for a descriptor that is read from.
    #[cfg(unix)]
    reader: Option<bun_jsc::JsCell<BufferedReader>>,
    /// The reader reached EOF, failed, or was released: it reports nothing more.
    #[cfg(unix)]
    reader_done: Cell<bool>,
    /// `pause_stream` since the last `resume_stream`: a running read loop stops delivering.
    #[cfg(unix)]
    paused: Cell<bool>,
    /// Inside a `&mut` of `reader` that arms its poll (`open`'s `start`, `resume_stream`'s `watch`):
    /// a registration error is parked in `arm_error` and handled once the borrow ends.
    #[cfg(unix)]
    arming: Cell<bool>,
    #[cfg(unix)]
    arm_error: Cell<Option<sys::Error>>,
    /// The errno of a failed read, reported through `on_close`.
    #[cfg(unix)]
    read_error: Cell<i32>,
    /// Reader dispatches on the stack: the free waits for the last one to return.
    #[cfg(unix)]
    keep_alive: Cell<u32>,
    /// The free task ran under a reader dispatch; the last `deref` frees instead.
    #[cfg(unix)]
    free_pending: Cell<bool>,
}

bun_jsc::impl_abort_handle_owner!(FdPipe, abort_handle, |this, _cause| {
    // SAFETY: trait contract: `this` is live (armed, so `Drop` has not run).
    unsafe { &*this }.close()
});

impl FdPipe {
    /// Makes `fd` the transport of `socket` and reports it open.
    ///
    /// A `readable` descriptor is the program's own, stdio included: the pipe closes it unless it is stdio.
    /// `Err`: nothing was started, no handler ran, and `fd` is still the caller's. `Ok` holds what
    /// `TCPSocket::on_open` left pending.
    pub(crate) fn open(
        socket: ThisPtr<TCPSocket>,
        fd: Fd,
        readable: bool,
        pause_on_connect: bool,
        context: &bun_jsc::ScriptExecutionContext,
    ) -> Result<JsResult<()>, sys::SystemErrno> {
        #[cfg(not(unix))]
        let _ = (readable, pause_on_connect);
        #[cfg(unix)]
        let writable = if readable {
            let status = sys::get_fcntl_flags(fd).map_err(sys::SystemErrno::from)? as i32;
            // Like `uv_pipe_open`, stdio included: a blocking FIFO could block the reader's `read(2)`
            // for good, and the flag stays set afterwards, as in node.
            if (status & libc::O_NONBLOCK) == 0 {
                sys::update_nonblocking(fd, true).map_err(sys::SystemErrno::from)?;
            }
            (status & libc::O_ACCMODE) != libc::O_RDONLY
        } else {
            true
        };
        #[cfg(not(unix))]
        let writable = true;
        let this = bun_core::heap::into_raw(Box::new(Self {
            handle: Default::default(),
            fd,
            writable,
            socket: Cell::new(Some(socket)),
            is_shutdown: Cell::new(false),
            rejected_send_error: Cell::new(0),
            is_queued: Cell::new(false),
            abort_handle: bun_jsc::AbortHandle::for_owner::<Self>(),
            #[cfg(unix)]
            poll: Cell::new(None),
            #[cfg(unix)]
            poll_fd: Cell::new(Fd::INVALID),
            #[cfg(unix)]
            reader: readable.then(|| bun_jsc::JsCell::new(BufferedReader::init::<Self>())),
            #[cfg(unix)]
            reader_done: Cell::new(!readable),
            #[cfg(unix)]
            paused: Cell::new(false),
            #[cfg(unix)]
            arming: Cell::new(false),
            #[cfg(unix)]
            arm_error: Cell::new(None),
            #[cfg(unix)]
            read_error: Cell::new(0),
            #[cfg(unix)]
            keep_alive: Cell::new(0),
            #[cfg(unix)]
            free_pending: Cell::new(false),
        }));
        LIVE_COUNT.fetch_add(1, Ordering::Relaxed);
        // SAFETY: fully initialised and heap-pinned; dropping the handle disarms it.
        unsafe { bun_jsc::AbortHandle::arm_owner(this, context) };
        // SAFETY: just allocated, and freed only by the task that `close` queues or by the error path below.
        let pipe = unsafe { &*this };
        pipe.handle.set(this);
        #[cfg(unix)]
        if let Some(reader) = &pipe.reader {
            reader.with_mut(|r| {
                r.set_parent(this.cast::<core::ffi::c_void>());
                // `close` closes the descriptor itself, before the socket hears of the close.
                r.flags.remove(PosixFlags::CLOSE_HANDLE);
                // Without it the reader is a `FileType::Pipe`, whose `read(2)` on macOS is unguarded.
                r.flags.insert(PosixFlags::NONBLOCKING);
                // Armed by `resume_stream`; a registration now would only be undone in `on_open`.
                if pause_on_connect {
                    r.flags.insert(PosixFlags::IS_PAUSED);
                }
                // The socket's own `poll_ref` decides whether the loop stays alive.
                r.update_ref(false);
            });
            pipe.arming.set(true);
            // A registration that fails is reported through `on_reader_error`, not the return value.
            let started = reader.with_mut(|r| r.start(fd, true));
            pipe.arming.set(false);
            let failed = match started {
                Err(err) => Some(err),
                Ok(()) => pipe.arm_error.take(),
            };
            if let Some(err) = failed {
                // SAFETY: nothing else points at `this`: no handle was handed out and the reader registered no poll.
                drop(unsafe { bun_core::heap::take(this) });
                return Err(err.into());
            }
        }
        let handle = SocketTCP::from_transport(&raw const pipe.handle);
        socket.socket.set(handle);
        Ok(TCPSocket::on_open(socket, handle))
    }

    #[inline]
    fn socket_handle(&self) -> SocketTCP {
        SocketTCP::from_transport(&raw const self.handle)
    }

    /// Returns true if `on_poll` will report that the descriptor takes bytes again.
    #[cfg(unix)]
    fn wait_until_writable(&self) -> bool {
        use bun_io::posix_event_loop::{FilePoll, Flags, Owner, PollTag};
        // kqueue doesn't reliably report a FIFO's readiness on macOS, and the write could wait forever.
        if !cfg!(target_os = "linux") {
            return false;
        }
        let ctx = bun_io::js_vm_ctx();
        let poll = match self.poll.get() {
            Some(poll) => poll,
            None => {
                let owner = Owner::new(PollTag::FdPipe, core::ptr::from_ref(self).cast_mut().cast());
                let mut fd = self.fd;
                #[cfg(unix)]
                if self.reader.is_some() {
                    let Ok(dup) = sys::dup(self.fd) else {
                        return false;
                    };
                    self.poll_fd.set(dup);
                    fd = dup;
                }
                FilePoll::init(ctx, fd, Default::default(), owner)
            }
        };
        self.poll.set(Some(poll));
        // SAFETY: `poll` is this pipe's live hive slot, no other borrow of it is live, and the loop is this thread's.
        if unsafe { (*poll).register(&*ctx.loop_(), Flags::Writable, true) }.is_err() {
            return false;
        }
        // The socket's queued bytes are a pending write: like libuv's `uv_write_t`, they hold the
        // loop open however the socket is ref'd. The write-only pipe never did, and keeps that.
        #[cfg(unix)]
        if self.reader.is_some() {
            // SAFETY: as above.
            unsafe { (*poll).enable_keeping_process_alive(ctx) };
        }
        true
    }

    #[cfg(windows)]
    fn wait_until_writable(&self) -> bool {
        false
    }

    #[cfg(unix)]
    pub(crate) fn on_poll(&self) {
        #[cfg(unix)]
        if let Some(poll) = self.poll.get()
            && self.reader.is_some()
        {
            // A further EAGAIN registers and holds again.
            // SAFETY: this pipe's live hive slot, which the dispatcher passed on as a raw pointer.
            unsafe { (*poll).disable_keeping_process_alive(bun_io::js_vm_ctx()) };
        }
        if let Some(socket) = self.socket.get() {
            fold(TCPSocket::on_writable(socket, self.socket_handle()));
        }
    }

    #[cfg(unix)]
    fn release_poll(&self) {
        if let Some(poll) = self.poll.take() {
            // SAFETY: this pipe's live hive slot, given back here.
            unsafe { (*poll).deinit() };
        }
        #[cfg(unix)]
        {
            let dup = self.poll_fd.replace(Fd::INVALID);
            if dup != Fd::INVALID {
                dup.close();
            }
        }
    }

    /// Stops the reader and releases its poll, without a callback. The descriptor stays open. Idempotent.
    #[cfg(unix)]
    fn release_reader(&self) {
        self.reader_done.set(true);
        if let Some(reader) = &self.reader {
            reader.with_mut(|r| {
                // Ends a read loop this may be running under (a `destroy()` from a 'data' handler) before it reads again.
                r.flags.insert(PosixFlags::CLOSED_WITHOUT_REPORTING);
                r.handle.close_without_closing_fd();
                r.deinit();
            });
        }
    }

    /// Stops both sides and closes the descriptor. Once per pipe: `close` and `detach` take `socket` first.
    fn tear_down(&self) {
        #[cfg(unix)]
        self.release_reader();
        #[cfg(unix)]
        self.release_poll();
        // Other streams share stdin, stdout and stderr, so they stay open.
        if !self.fd.is_stdio() {
            // The program may have closed the descriptor itself.
            let _ = self.fd.close_allowing_bad_file_descriptor(None);
        }
    }

    // ── reader callbacks ────────────────────────────────────────────────────

    #[cfg(unix)]
    fn reader_active(&self) -> bool {
        self.socket.get().is_some() && !self.reader_done.get()
    }

    /// `&Self` from the parent back-pointer the reader carries. Shared only: a `&mut` to the embedded reader may be live on the caller's stack.
    #[cfg(unix)]
    #[inline]
    fn from_parent_ptr<'a>(this: *mut Self) -> &'a Self {
        // SAFETY: `this` is the pointer `set_parent` got, live until the free task, which no reader dispatch outlives (`keep_alive`).
        unsafe { &*this }
    }

    #[cfg(unix)]
    fn on_read_chunk(&self, chunk: &[u8], _has_more: ReadState) -> bool {
        let Some(socket) = self.socket.get() else {
            return false;
        };
        fold(TCPSocket::on_data(socket, self.socket_handle(), chunk));
        // EOF arrives through `on_reader_done` right after this. A `pause()` from the handler only
        // disarmed the poll; the loop that is delivering stops here.
        self.socket.get().is_some() && !self.paused.get()
    }

    #[cfg(unix)]
    fn on_reader_done(&self) {
        if self.reader_done.get() {
            return;
        }
        let Some(socket) = self.socket.get() else {
            return;
        };
        self.release_reader();
        fold(TCPSocket::on_end(socket, self.socket_handle()));
        // Like a TCP FIN after our own: nothing is left to wait for.
        if self.is_shutdown.get() {
            self.close();
        }
    }

    #[cfg(unix)]
    fn on_reader_error(&self, err: sys::Error) {
        if self.arming.get() {
            self.arm_error.set(Some(err));
            return;
        }
        if self.reader_done.get() || self.socket.get().is_none() {
            return;
        }
        self.read_error.set(i32::from(err.errno));
        // `on_close` carries the errno, like a failed `recv` on a `us_socket_t`.
        self.close();
    }

    // ── lifetime ────────────────────────────────────────────────────────────

    fn enqueue(&self) {
        if !self.is_queued.replace(true) {
            VirtualMachine::get()
                .event_loop()
                .enqueue_task(bun_jsc::Task::init(core::ptr::from_ref(self).cast_mut()));
        }
    }

    /// SAFETY: `this` is the queued pointer. The call frees it, or the reader dispatch it runs under does when it returns.
    pub(crate) unsafe fn run_event(this: *mut Self) {
        // SAFETY: fn contract.
        let pipe = unsafe { &*this };
        pipe.close();
        #[cfg(unix)]
        if pipe.keep_alive.get() > 0 {
            pipe.free_pending.set(true);
            return;
        }
        // SAFETY: fn contract; a closed pipe's socket holds no handle to it.
        drop(unsafe { bun_core::heap::take(this) });
    }
}

impl Transport for FdPipe {
    fn is_closed(&self) -> bool {
        self.socket.get().is_none()
    }

    fn is_shutdown(&self) -> bool {
        self.is_shutdown.get()
    }

    fn write(&self, data: &[u8]) -> (i32, i32) {
        let mut written = 0;
        let mut send_error = 0;
        while written < data.len() {
            match sys::write(self.fd, &data[written..]) {
                Ok(n) => written += n,
                Err(err) if err.is_retry() && self.wait_until_writable() => break,
                Err(err) => {
                    send_error =
                        -super::socket_body::uv_status(sys::SystemErrno::from_raw(err.errno));
                    break;
                }
            }
        }
        (i32::try_from(written).expect("int cast"), send_error)
    }

    fn raw_write(&self, data: &[u8]) -> i32 {
        self.write(data).0
    }

    /// A pipe has no half-close to send: the peer sees EOF only when the descriptor closes. For a
    /// descriptor that is read from, the socket calls this once its queued bytes are out, so a
    /// writable end closes now (from the event loop, like `reject_send`) and a read-only end waits
    /// for EOF. A write-only pipe stays open, as it always did: its socket closes it.
    fn shutdown(&self) {
        self.is_shutdown.set(true);
        #[cfg(unix)]
        if self.reader.is_some() && (self.writable || self.reader_done.get()) {
            self.enqueue();
        }
    }

    fn shutdown_read(&self) {
        #[cfg(unix)]
        if let Some(reader) = &self.reader
            && self.reader_active()
        {
            self.paused.set(true);
            reader.with_mut(|r| r.pause());
        }
    }

    /// Touches nothing of `self` after `on_close`, whose handler can turn the event loop and so free `self`.
    fn close(&self) {
        let Some(socket) = self.socket.take() else {
            return;
        };
        self.tear_down();
        self.enqueue();
        #[cfg(unix)]
        let code = match self.rejected_send_error.get() {
            0 => self.read_error.get(),
            send_error => send_error,
        };
        #[cfg(not(unix))]
        let code = self.rejected_send_error.get();
        fold(TCPSocket::on_close(
            socket,
            self.socket_handle(),
            code,
            None,
        ));
    }

    fn pause_stream(&self) -> bool {
        #[cfg(unix)]
        if let Some(reader) = &self.reader
            && self.reader_active()
        {
            self.paused.set(true);
            reader.with_mut(|r| r.pause());
        }
        true
    }

    fn resume_stream(&self) -> bool {
        #[cfg(unix)]
        if let Some(reader) = &self.reader
            && self.reader_active()
        {
            self.paused.set(false);
            reader.with_mut(|r| r.unpause());
            // Arms the poll; bytes already waiting are delivered on the next tick, like a uSockets resume.
            // A registration that fails (the program closed the descriptor) is handled after the
            // borrow: `on_reader_error` would `close` and release the reader under it.
            self.arming.set(true);
            reader.with_mut(|r| r.watch());
            self.arming.set(false);
            if let Some(err) = self.arm_error.take() {
                self.on_reader_error(err);
            }
        }
        true
    }

    fn fd(&self) -> Fd {
        self.fd
    }

    fn reject_send(&self, error: i32) {
        self.rejected_send_error.set(error);
        self.is_shutdown.set(true);
        self.enqueue();
    }

    fn rejected_send_error(&self) -> i32 {
        self.rejected_send_error.get()
    }

    /// The owner releases the connection's ref itself.
    fn detach(&self) -> bool {
        if self.socket.take().is_none() {
            return false;
        }
        self.tear_down();
        self.enqueue();
        true
    }
}

impl Drop for FdPipe {
    fn drop(&mut self) {
        LIVE_COUNT.fetch_sub(1, Ordering::Relaxed);
        #[cfg(unix)]
        self.release_reader();
        #[cfg(unix)]
        self.release_poll();
    }
}

impl bun_event_loop::Taskable for FdPipe {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::FdPipe;
    /// What the task does runs no script by then.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract.
        unsafe { Self::run_event(this) }
    }
    /// A socket's own hop. Its handlers carry their context.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

// Every method takes `*mut Self` and only forms `&Self`: the reader is a field of `self`, and the
// caller holds a live `&mut` to it while these run.
bun_io::buffered_reader_parent_link!(FdPipe for FdPipe);
#[cfg(unix)]
impl bun_io::BufferedReaderParent for FdPipe {
    const KIND: bun_io::BufferedReaderParentLinkKind = bun_io::BufferedReaderParentLinkKind::FdPipe;
    const HAS_ON_READ_CHUNK: bool = true;

    unsafe fn on_read_chunk(this: *mut Self, chunk: bun_io::Chunk<'_>, has_more: ReadState) -> bool {
        bun_removable_features::removable_body!(Sockets, Abort, {
            Self::from_parent_ptr(this).on_read_chunk(&chunk, has_more)
        })
    }
    unsafe fn on_reader_done(this: *mut Self) {
        bun_removable_features::removable_body!(Sockets, Abort, {
            Self::from_parent_ptr(this).on_reader_done();
        })
    }
    unsafe fn on_reader_error(this: *mut Self, err: sys::Error) {
        bun_removable_features::removable_body!(Sockets, Abort, {
            Self::from_parent_ptr(this).on_reader_error(err);
        })
    }
    unsafe fn loop_(_: *mut Self) -> *mut bun_io::pipe_reader::Loop {
        bun_io::js_vm_ctx().loop_()
    }
    unsafe fn event_loop(_: *mut Self) -> bun_io::EventLoopHandle {
        bun_io::js_vm_ctx()
    }
    /// The read loop's hold on `self`: reads the counter through the raw pointer so no `&Self` overlaps the caller's `&mut reader`.
    unsafe fn ref_(this: *mut Self) {
        // SAFETY: `this` is live (trait contract); a field projection, no borrow of the reader.
        let keep_alive = unsafe { &*(&raw const (*this).keep_alive) };
        keep_alive.set(keep_alive.get() + 1);
    }
    unsafe fn deref(this: *mut Self) {
        // SAFETY: as in `ref_`.
        let keep_alive = unsafe { &*(&raw const (*this).keep_alive) };
        let held = keep_alive.get() - 1;
        keep_alive.set(held);
        // SAFETY: as in `ref_`.
        if held == 0 && unsafe { (*this).free_pending.get() } {
            // SAFETY: the free task ran already; the loop that held this ref touches `*this` no more.
            drop(unsafe { bun_core::heap::take(this) });
        }
    }
}

/// The link table names every variant on every platform. A Windows `FdPipe` never has a reader.
#[cfg(windows)]
impl bun_io::BufferedReaderParent for FdPipe {
    const KIND: bun_io::BufferedReaderParentLinkKind = bun_io::BufferedReaderParentLinkKind::FdPipe;
    const HAS_ON_READ_CHUNK: bool = true;

    unsafe fn on_read_chunk(_: *mut Self, _: bun_io::Chunk<'_>, _: bun_io::ReadState) -> bool {
        unreachable!("an FdPipe reads only on POSIX")
    }
    unsafe fn on_reader_done(_: *mut Self) {
        unreachable!("an FdPipe reads only on POSIX")
    }
    unsafe fn on_reader_error(_: *mut Self, _: sys::Error) {
        unreachable!("an FdPipe reads only on POSIX")
    }
    unsafe fn loop_(_: *mut Self) -> *mut bun_io::pipe_reader::Loop {
        unreachable!("an FdPipe reads only on POSIX")
    }
    unsafe fn event_loop(_: *mut Self) -> bun_io::EventLoopHandle {
        unreachable!("an FdPipe reads only on POSIX")
    }
}
