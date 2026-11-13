//! The transport of `new net.Socket({ fd, readable: true })` and `Bun.connect({ fd })` over a pipe or a FIFO.
//!
//! A pipe can't be a `us_socket_t` (uSockets reads it with `recv`), so a `BufferedReader` reads it
//! and `write(2)` writes it, the way `FdPipe` does for a descriptor that is only written to. The
//! descriptor is node's `uv_pipe_open` adoption: it is made non-blocking (stdio too, and the flag
//! is never put back) and, unless it is stdio, closed with the socket.

use core::cell::Cell;
use core::ffi::c_void;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_io::posix_event_loop::{FilePoll, Owner, PollTag};
use bun_io::{BufferedReader, BufferedReaderParent, Chunk, PosixFlags, ReadState};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JsCell, JsResult};
use bun_ptr::ThisPtr;
use bun_sys::{self as sys, Fd, FdExt as _};
use bun_uws::{SocketTCP, Transport};

use super::TCPSocket;
use crate::dispatch::fold;

/// Pipes that `open` made and has not freed yet; `posixPipeInternals.liveCount()` in tests.
pub(crate) static LIVE_COUNT: AtomicUsize = AtomicUsize::new(0);

pub(crate) struct PosixPipe {
    handle: bun_uws::TransportHandle,
    fd: Fd,
    /// Not opened `O_RDONLY`: `shutdown` closes it, since a pipe's peer sees EOF no other way.
    writable: bool,
    /// `None` once closed or detached. `connect_finish` took the connection's ref on it, and `on_close` releases that ref.
    socket: Cell<Option<ThisPtr<TCPSocket>>>,
    reader: JsCell<BufferedReader>,
    /// The reader reached EOF, failed, or was released: it reports nothing more.
    reader_done: Cell<bool>,
    /// `pause_stream` since the last `resume_stream`: a running read loop stops delivering.
    paused: Cell<bool>,
    is_shutdown: Cell<bool>,
    /// Inside a `&mut` of `reader` that arms its poll (`open`'s `start`, `resume_stream`'s `watch`):
    /// a registration error is parked in `arm_error` and handled once the borrow ends.
    arming: Cell<bool>,
    arm_error: Cell<Option<sys::Error>>,
    /// The errno of a failed read, reported through `on_close`.
    read_error: Cell<i32>,
    rejected_send_error: Cell<i32>,
    /// The task that closes and frees `self` is in the queue.
    is_queued: Cell<bool>,
    /// Reader dispatches on the stack: the free waits for the last one to return.
    keep_alive: Cell<u32>,
    /// The free task ran under a reader dispatch; the last `deref` frees instead.
    free_pending: Cell<bool>,
    /// In no uSockets group, so the context that opened it closes it through this when it stops.
    abort_handle: bun_jsc::AbortHandle,
    /// Waits for the pipe to take bytes again. On its own duplicate of `fd`: epoll registers a descriptor once, and the reader has `fd`.
    write_poll: Cell<Option<*mut FilePoll>>,
    write_poll_fd: Cell<Fd>,
}

bun_jsc::impl_abort_handle_owner!(PosixPipe, abort_handle, |this, _cause| {
    // SAFETY: trait contract: `this` is live (armed, so `Drop` has not run).
    unsafe { &*this }.close()
});

impl PosixPipe {
    /// Makes `fd` the transport of `socket` and reports it open.
    ///
    /// `fd` is the program's own descriptor, stdio included: the pipe closes it unless it is stdio.
    /// `Err`: nothing was started, no handler ran, and `fd` is still the caller's. `Ok` holds what
    /// `TCPSocket::on_open` left pending.
    pub(crate) fn open(
        socket: ThisPtr<TCPSocket>,
        fd: Fd,
        pause_on_connect: bool,
        context: &bun_jsc::ScriptExecutionContext,
    ) -> Result<JsResult<()>, sys::SystemErrno> {
        let status = sys::get_fcntl_flags(fd).map_err(sys::SystemErrno::from)? as i32;
        let writable = (status & libc::O_ACCMODE) != libc::O_RDONLY;
        // Like `uv_pipe_open`, stdio included: a blocking FIFO could block the reader's `read(2)`
        // for good, and the flag stays set afterwards, as in node.
        if (status & libc::O_NONBLOCK) == 0 {
            sys::update_nonblocking(fd, true).map_err(sys::SystemErrno::from)?;
        }
        let this = bun_core::heap::into_raw(Box::new(Self {
            handle: Default::default(),
            fd,
            writable,
            socket: Cell::new(Some(socket)),
            reader: JsCell::new(BufferedReader::init::<Self>()),
            reader_done: Cell::new(false),
            paused: Cell::new(false),
            is_shutdown: Cell::new(false),
            arming: Cell::new(false),
            arm_error: Cell::new(None),
            read_error: Cell::new(0),
            rejected_send_error: Cell::new(0),
            is_queued: Cell::new(false),
            keep_alive: Cell::new(0),
            free_pending: Cell::new(false),
            abort_handle: bun_jsc::AbortHandle::for_owner::<Self>(),
            write_poll: Cell::new(None),
            write_poll_fd: Cell::new(Fd::INVALID),
        }));
        LIVE_COUNT.fetch_add(1, Ordering::Relaxed);
        // SAFETY: fully initialised and heap-pinned; dropping the handle disarms it.
        unsafe { bun_jsc::AbortHandle::arm_owner(this, context) };
        // SAFETY: just allocated, and freed only by the task that `close` queues or by the error path below.
        let pipe = unsafe { &*this };
        pipe.handle.set(this);
        pipe.reader.with_mut(|r| {
            r.set_parent(this.cast::<c_void>());
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
        let started = pipe.reader.with_mut(|r| r.start(fd, true));
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
        let handle = SocketTCP::from_transport(&raw const pipe.handle);
        socket.socket.set(handle);
        Ok(TCPSocket::on_open(socket, handle))
    }

    #[inline]
    fn socket_handle(&self) -> SocketTCP {
        SocketTCP::from_transport(&raw const self.handle)
    }

    /// `&Self` from the parent back-pointer the reader carries. Shared only: a `&mut` to the embedded reader may be live on the caller's stack.
    #[inline]
    fn from_parent_ptr<'a>(this: *mut Self) -> &'a Self {
        // SAFETY: `this` is the pointer `set_parent` got, live until the free task, which no reader dispatch outlives (`keep_alive`).
        unsafe { &*this }
    }

    fn reader_active(&self) -> bool {
        self.socket.get().is_some() && !self.reader_done.get()
    }

    /// Stops the reader and releases its poll, without a callback. The descriptor stays open. Idempotent.
    fn release_reader(&self) {
        self.reader_done.set(true);
        self.reader.with_mut(|r| {
            // Ends a read loop this may be running under (a `destroy()` from a 'data' handler) before it reads again.
            r.flags.insert(PosixFlags::CLOSED_WITHOUT_REPORTING);
            r.handle.close_without_closing_fd();
            r.deinit();
        });
    }

    fn release_write_poll(&self) {
        if let Some(poll) = self.write_poll.take() {
            // SAFETY: this pipe's live hive slot, given back here.
            unsafe { (*poll).deinit() };
        }
        let dup = self.write_poll_fd.replace(Fd::INVALID);
        if dup != Fd::INVALID {
            dup.close();
        }
    }

    /// Stops both sides and closes the descriptor. Once per pipe: `close` and `detach` take `socket` first.
    fn tear_down(&self) {
        self.release_reader();
        self.release_write_poll();
        // Other streams share stdin, stdout and stderr, so they stay open.
        if !self.fd.is_stdio() {
            // The program may have closed the descriptor itself.
            let _ = self.fd.close_allowing_bad_file_descriptor(None);
        }
    }

    // ── reader callbacks ────────────────────────────────────────────────────

    fn on_read_chunk(&self, chunk: &[u8], _has_more: ReadState) -> bool {
        let Some(socket) = self.socket.get() else {
            return false;
        };
        fold(TCPSocket::on_data(socket, self.socket_handle(), chunk));
        // EOF arrives through `on_reader_done` right after this. A `pause()` from the handler only
        // disarmed the poll; the loop that is delivering stops here.
        self.socket.get().is_some() && !self.paused.get()
    }

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

    // ── write side ──────────────────────────────────────────────────────────

    /// Returns true if `on_poll` will report that the descriptor takes bytes again.
    fn wait_until_writable(&self) -> bool {
        use bun_io::posix_event_loop::Flags;
        // kqueue doesn't reliably report a FIFO's readiness on macOS, and the write could wait forever.
        if !cfg!(target_os = "linux") {
            return false;
        }
        let ctx = bun_io::js_vm_ctx();
        let poll = match self.write_poll.get() {
            Some(poll) => poll,
            None => {
                let Ok(dup) = sys::dup(self.fd) else {
                    return false;
                };
                self.write_poll_fd.set(dup);
                let owner = Owner::new(
                    PollTag::PosixPipe,
                    core::ptr::from_ref(self).cast_mut().cast(),
                );
                FilePoll::init(ctx, dup, Default::default(), owner)
            }
        };
        self.write_poll.set(Some(poll));
        // SAFETY: `poll` is this pipe's live hive slot, no other borrow of it is live, and the loop is this thread's.
        if unsafe { (*poll).register(&*ctx.loop_(), Flags::Writable, true) }.is_err() {
            return false;
        }
        // The socket's queued bytes are a pending write: like libuv's `uv_write_t`, they hold the
        // loop open however the socket is ref'd. `release_write_poll` drops it with the poll.
        // SAFETY: as above.
        unsafe { (*poll).enable_keeping_process_alive(ctx) };
        true
    }

    pub(crate) fn on_poll(&self) {
        if let Some(poll) = self.write_poll.get() {
            // A further EAGAIN registers and holds again.
            // SAFETY: this pipe's live hive slot, which the dispatcher passed on as a raw pointer.
            unsafe { (*poll).disable_keeping_process_alive(bun_io::js_vm_ctx()) };
        }
        if let Some(socket) = self.socket.get() {
            fold(TCPSocket::on_writable(socket, self.socket_handle()));
        }
    }

    // ── lifetime ────────────────────────────────────────────────────────────

    fn enqueue(&self) {
        if !self.is_queued.replace(true) {
            VirtualMachine::get()
                .event_loop_mut()
                .enqueue_task(bun_jsc::Task::init(core::ptr::from_ref(self).cast_mut()));
        }
    }

    /// SAFETY: `this` is the queued pointer. The call frees it, or the reader dispatch it runs under does when it returns.
    pub(crate) unsafe fn run_event(this: *mut Self) {
        // SAFETY: fn contract.
        let pipe = unsafe { &*this };
        pipe.close();
        if pipe.keep_alive.get() > 0 {
            pipe.free_pending.set(true);
            return;
        }
        // SAFETY: fn contract; a closed pipe's socket holds no handle to it.
        drop(unsafe { bun_core::heap::take(this) });
    }
}

impl Transport for PosixPipe {
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

    /// A pipe has no half-close to send: the peer sees EOF only when the descriptor closes. The
    /// socket calls this once its queued bytes are out, so a writable end closes now (from the
    /// event loop, like `reject_send`); a read-only end has nothing to end and waits for EOF.
    fn shutdown(&self) {
        self.is_shutdown.set(true);
        if self.writable || self.reader_done.get() {
            self.enqueue();
        }
    }

    fn shutdown_read(&self) {
        if self.reader_active() {
            self.paused.set(true);
            self.reader.with_mut(|r| r.pause());
        }
    }

    /// Touches nothing of `self` after `on_close`, whose handler can turn the event loop and so free `self`.
    fn close(&self) {
        let Some(socket) = self.socket.take() else {
            return;
        };
        self.tear_down();
        self.enqueue();
        let code = match self.rejected_send_error.get() {
            0 => self.read_error.get(),
            send_error => send_error,
        };
        fold(TCPSocket::on_close(
            socket,
            self.socket_handle(),
            code,
            None,
        ));
    }

    fn pause_stream(&self) -> bool {
        if self.reader_active() {
            self.paused.set(true);
            self.reader.with_mut(|r| r.pause());
        }
        true
    }

    fn resume_stream(&self) -> bool {
        if self.reader_active() {
            self.paused.set(false);
            self.reader.with_mut(|r| r.unpause());
            // Arms the poll; bytes already waiting are delivered on the next tick, like a uSockets resume.
            // A registration that fails (the program closed the descriptor) is handled after the
            // borrow: `on_reader_error` would `close` and release the reader under it.
            self.arming.set(true);
            self.reader.with_mut(|r| r.watch());
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

impl Drop for PosixPipe {
    fn drop(&mut self) {
        LIVE_COUNT.fetch_sub(1, Ordering::Relaxed);
        self.release_reader();
        self.release_write_poll();
    }
}

impl bun_event_loop::Taskable for PosixPipe {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::PosixPipe;
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
bun_io::buffered_reader_parent_link!(PosixPipe for PosixPipe);
impl BufferedReaderParent for PosixPipe {
    const KIND: bun_io::BufferedReaderParentLinkKind =
        bun_io::BufferedReaderParentLinkKind::PosixPipe;
    const HAS_ON_READ_CHUNK: bool = true;

    unsafe fn on_read_chunk(this: *mut Self, chunk: Chunk<'_>, has_more: ReadState) -> bool {
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
