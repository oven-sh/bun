//! Wrapper that provides a socket-like API for Windows Named Pipes.
//!
//! This allows us to use the same networking interface and event handling
//! patterns across platforms, treating Named Pipes as if they were regular
//! sockets. The wrapper translates between µWebSockets' socket-based API
//! and Windows Named Pipe operations, enabling seamless cross-platform
//! IPC without requiring separate code paths for Windows vs Unix domain sockets.
//!
//! Integration with µWebSockets/uSockets:
//! - Uses the same event loop and timer mechanisms as other socket types
//! - Implements compatible handlers (onOpen, onData, onClose, etc.) that match uSockets callbacks
//! - Supports SSL/TLS wrapping through the same BoringSSL integration used by TCP sockets
//! - Provides streaming writer interface that mirrors uSockets' write operations
//! - Maintains the same connection lifecycle and state management as network sockets
//! - Enables transparent use of Named Pipes in contexts expecting standard socket APIs
//!
//! Uses libuv for the underlying Named Pipe operations while maintaining compatibility
//! with µWebSockets, bridging the gap between libuv's pipe handling and uSockets'
//! unified socket interface.

use core::cell::{Cell, OnceCell};
use core::ffi::{c_uint, c_void};
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_boringssl_sys as boringssl;
use bun_collections::ByteVecExt;
use bun_core::{ZStr, timespec};
use bun_io::{IoEvent, Owner, PollTag, StreamingWriter, WriteHandler, WriteStatus};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{GlobalRef, JsCell, SysErrorJsc};
use bun_libuv_sys::{UvHandle as _, UvStream as _};
use bun_ptr::{AliasableBox, RefPtr};
use bun_sys::windows::libuv as uv;
use bun_sys::{self, Fd, ReturnCodeExt as _, SystemErrno};
use bun_uws::ssl_wrapper::{self, SSLWrapper};
use bun_uws::{self as uws, Transport, us_bun_verify_error_t};

use crate::socket::{NewSocket, TCPSocket, TLSSocket};
use crate::timer::{EventLoopTimer, EventLoopTimerTag};

bun_output::declare_scope!(WindowsNamedPipe, visible);

use crate::jsc_hooks::timer_all;

/// Live pipes, read by `bun:internal-for-testing` leak tests: `heapStats()` only sees the JS wrappers.
pub(crate) static LIVE_COUNT: AtomicUsize = AtomicUsize::new(0);

#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy_box = Self::queue_free)]
pub(crate) struct WindowsNamedPipe {
    ref_count: Cell<u32>,
    /// Held until the pipe closes, or fails to open.
    pub(super) self_ref: Cell<Option<RefPtr<Self>>>,
    handle: uws::TransportHandle,
    /// `on_close` and `fail_connect` hand it to the socket's last event.
    socket: JsCell<Option<OwnedSocket>>,
    global_this: GlobalRef,
    is_open: Cell<bool>,
    /// In no uSockets group, so the context that opened it closes it through this when it stops.
    abort_handle: bun_jsc::AbortHandle,
    /// Set before the pipe opens and freed with `self`: a `handle_traffic` frame can be on the stack when the pipe closes.
    wrapper: OnceCell<SSLWrapper>,
    pub(crate) root: Cell<*mut WindowsNamedPipe>,
    /// Until [`start`](Self::start) hands it to `writer`.
    pipe: JsCell<Option<uv::Owned<uv::Pipe>>>,
    /// The per-thread VM singleton outlives this struct (it is torn down only
    /// at thread exit, after every named pipe is closed), so `&'static` is the
    /// honest model here rather than a threaded lifetime.
    pub(crate) vm: &'static VirtualMachine,
    writer: StreamingWriter,
    /// Held while a write is in flight.
    inflight_write_ref: Cell<Option<RefPtr<Self>>>,

    pub(crate) incoming: JsCell<Vec<u8>>, // Maybe we should use IPCBuffer here as well
    pub(crate) connect_req: JsCell<uv::uv_connect_t>,
    /// Held while libuv has `connect_req`.
    connect_ref: Cell<Option<RefPtr<Self>>>,

    pub(crate) event_loop_timer: EventLoopTimer,
    pub(crate) current_timeout: Cell<u32>,
    pub(crate) flags: Cell<Flags>,
}

bun_event_loop::impl_timer_owner!(WindowsNamedPipe; from_timer_ptr => event_loop_timer);

// `close` re-enters `on_close`, which may queue the free of `this`.
bun_jsc::impl_abort_handle_owner!(WindowsNamedPipe, abort_handle, |this, _cause| {
    // SAFETY: trait contract: `this` is live.
    unsafe { &*this }.close_or_cancel_connect()
});

/// What a new pipe is opened over.
enum Target<'a> {
    /// A libuv descriptor.
    Fd(Fd),
    /// The name of the pipe to connect to.
    Path(&'a [u8]),
}

/// A ref on the socket this pipe is the transport of.
#[derive(Clone)]
pub(crate) enum OwnedSocket {
    Tls(RefPtr<TLSSocket>),
    Tcp(RefPtr<TCPSocket>),
}

impl OwnedSocket {
    pub(crate) fn of<const SSL: bool>(socket: RefPtr<NewSocket<SSL>>) -> Self {
        let socket = socket.into_raw();
        // SAFETY: the same ref. `NewSocket<true>` is `TLSSocket` and `NewSocket<false>` is `TCPSocket`.
        unsafe {
            if SSL {
                Self::Tls(RefPtr::from_raw(socket.cast()))
            } else {
                Self::Tcp(RefPtr::from_raw(socket.cast()))
            }
        }
    }
}

/// Runs `$body`, written over `NewSocket<$ssl>`, for the socket in `$socket`, and folds what its handlers left pending.
macro_rules! match_socket {
    ($socket:expr, |$s:ident: NewSocket<$ssl:ident>| $body:expr) => {
        match $socket {
            Some(OwnedSocket::Tls($s)) => {
                const $ssl: bool = true;
                let _ = $ssl;
                crate::dispatch::fold($body)
            }
            Some(OwnedSocket::Tcp($s)) => {
                const $ssl: bool = false;
                let _ = $ssl;
                crate::dispatch::fold($body)
            }
            None => {}
        }
    };
}

bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Clone, Copy, Default)]
    pub struct Flags: u16 {
        const DISCONNECTED = 1 << 0;
        const IS_CLOSED    = 1 << 1;
        /// `writer` has taken the pipe.
        const PIPE_ADOPTED = 1 << 4;
        /// `shutdown()` ran on a plain pipe. The write side ends once queued data drains, and reads continue.
        const SHUTDOWN_REQUESTED = 1 << 7;
        /// libuv has the `uv_shutdown` request.
        const SHUTDOWN_SENT = 1 << 8;
    }
}

impl Flags {
    #[inline]
    pub(crate) fn disconnected(self) -> bool {
        self.contains(Self::DISCONNECTED)
    }
    #[inline]
    pub(crate) fn is_closed(self) -> bool {
        self.contains(Self::IS_CLOSED)
    }
}

impl WindowsNamedPipe {
    #[inline]
    fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut flags = self.flags.get();
        f(&mut flags);
        self.flags.set(flags);
    }

    #[inline]
    fn wrapper_ref(&self) -> Option<&SSLWrapper> {
        self.wrapper.get()
    }

    /// Runs `f` on the pipe, which is dropped if that fails.
    fn try_pipe(
        &self,
        tag: bun_sys::Tag,
        f: impl FnOnce(&mut uv::Pipe) -> uv::ReturnCode,
    ) -> bun_sys::Result<()> {
        let rc = (self.pipe).with_mut(|pipe| f(pipe.as_mut().expect("not started")));
        rc.to_result(tag).inspect_err(|_| self.pipe.set(None))
    }

    fn init_pipe(&self) -> bun_sys::Result<()> {
        let uv_loop = self.vm.uv_loop();
        self.try_pipe(bun_sys::Tag::pipe, |pipe| pipe.init(uv_loop, false))?;
        // Until the writer records itself as the owner.
        (self.pipe.get().as_ref().expect("not started"))
            .set_owner(self.root_ptr().cast(), Self::stop_for_vm_teardown);
        Ok(())
    }

    /// Holds a ref on `self` until the returned guard drops.
    ///
    /// `self` frees itself from a task it queues when [`on_close`] releases
    /// the connection's ref. A handler can close the socket and then spin the
    /// event loop before it returns (`expect().resolves` blocks on a promise
    /// that way), which runs that task. A callback that uses `self` after it
    /// dispatched to a handler holds this guard, so the free waits until the
    /// callback is done. `inflight_write_ref` does the same around an in-flight write,
    /// and `connect_ref` around the connect.
    ///
    /// Only for paths that cannot run after `on_close` released the
    /// connection's ref (reads stop and the wrapper goes away in
    /// `release_resources`): a ref taken at zero would queue the free twice.
    ///
    /// [`on_close`]: Self::on_close
    fn keep_alive(&self) -> RefPtr<Self> {
        // SAFETY: `root_ptr` is the live heap allocation.
        unsafe { RefPtr::init_ref(self.root_ptr()) }
    }

    fn queue_free(this: AliasableBox<Self>) {
        let event_loop = this.vm.event_loop();
        event_loop.enqueue_task(bun_jsc::Task::new::<Self>(this));
    }

    /// `self` as the handle its socket holds.
    fn handle<const SSL: bool>(&self) -> uws::NewSocketHandler<SSL> {
        uws::NewSocketHandler::from_transport(&raw const self.handle)
    }

    pub(crate) fn on_writer_io(&self, event: IoEvent) {
        let _keep_alive = self.keep_alive();
        self.writer.on_io(self, event);
    }

    fn dispatch_writable(&self) {
        match_socket!(self.socket.get().clone(), |s: NewSocket<SSL>| {
            s.on_writable(self.handle::<SSL>())
        });
    }

    fn on_read(&self, nread: usize) {
        bun_output::scoped_log!(WindowsNamedPipe, "onRead ({})", nread);
        let _keep_alive = self.keep_alive();
        // SAFETY: `nread` bytes written by libuv into on_read_alloc's slice.
        self.incoming
            .with_mut(|incoming| unsafe { incoming.uv_commit(nread) });

        self.reset_timeout();

        let mut data = self.incoming.replace(Vec::new());

        match self.wrapper_ref() {
            Some(w) => w.receive_data(&mut &*self, data.as_slice()),
            None => self.on_data(data.as_slice()),
        }
        data.clear();
        self.incoming.set(data);
    }

    #[inline]
    fn root_ptr(&self) -> *mut WindowsNamedPipe {
        let p = self.root.get();
        debug_assert!(!p.is_null(), "WindowsNamedPipe root not recorded");
        p
    }

    fn on_read_error(&self, err: bun_sys::E) {
        bun_output::scoped_log!(WindowsNamedPipe, "onReadError");
        let _keep_alive = self.keep_alive();
        if err == bun_sys::E::EOF {
            // we received FIN but we dont allow half-closed connections right now
            match_socket!(self.socket.get().clone(), |s: NewSocket<SSL>| {
                s.on_end(self.handle::<SSL>())
            });
            self.writer.close(self);
            return;
        }
        self.on_error(bun_sys::Error::from_code(err, bun_sys::Tag::read));
        self.writer.close(self);
    }

    /// `connectError` is the last event of a socket whose connect failed, so this pipe forgets the socket: neither `on_close`, which still fires on the asynchronous failure path, nor `Drop` touches it again.
    fn fail_connect(&self, errno: SystemErrno) {
        // Cleared before `connectError` runs JS, which may connect the same socket again through a new pipe.
        match_socket!(self.socket.take(), |s: NewSocket<SSL>| {
            NewSocket::handle_connect_error(s, errno, 0)
        });
    }

    fn on_open(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onOpen");
        self.is_open.set(true);
        match_socket!(self.socket.get().clone(), |s: NewSocket<SSL>| {
            s.on_open(self.handle::<SSL>())
        });
    }

    fn on_data(&self, decoded_data: &[u8]) {
        bun_output::scoped_log!(WindowsNamedPipe, "onData ({})", decoded_data.len());
        match_socket!(self.socket.get().clone(), |s: NewSocket<SSL>| {
            s.on_data(self.handle::<SSL>(), decoded_data)
        });
    }
}

impl ssl_wrapper::Handler for &WindowsNamedPipe {
    fn on_open(&mut self) {
        WindowsNamedPipe::on_open(self)
    }

    fn on_data(&mut self, decoded_data: &[u8]) {
        WindowsNamedPipe::on_data(self, decoded_data)
    }

    fn on_close(&mut self) {
        WriteHandler::on_close(*self)
    }

    fn write(&mut self, encoded_data: &[u8]) -> usize {
        self.internal_write(encoded_data);
        encoded_data.len()
    }

    fn on_handshake(&mut self, handshake_success: bool, ssl_error: us_bun_verify_error_t) {
        bun_output::scoped_log!(WindowsNamedPipe, "onHandshake");
        let _keep_alive = self.keep_alive();

        match_socket!(self.socket.get().clone(), |s: NewSocket<SSL>| {
            s.on_handshake(self.handle::<SSL>(), handshake_success as i32, ssl_error)
        });
        // Retry writes parked during the handshake; a TLS 1.2 client's completion sends nothing.
        if handshake_success && !self.is_shutdown() {
            self.dispatch_writable();
        }
    }
}

impl WindowsNamedPipe {
    fn call_write_or_end(&self, data: Option<&[u8]>, msg_more: bool) {
        if let Some(bytes) = data {
            if !bytes.is_empty() {
                // ref because we have pending data
                self.writer.update_ref(true);
                if self.flags.get().disconnected() {
                    // enqueue to be sent after connecting
                    self.writer.enqueue(bytes);
                } else {
                    // write will enqueue the data if it cannot be sent
                    let _ = self.writer.write(self, bytes);
                }
            }
        }

        if !msg_more {
            if let Some(w) = self.wrapper_ref() {
                let _ = w.shutdown(&mut &*self, false);
            }
            self.writer.end(self);
        }
    }

    fn internal_write(&self, encoded_data: &[u8]) {
        self.reset_timeout();

        // Possible scenarios:
        // Scenario 1: will not write if is not connected yet but will enqueue the data
        // Scenario 2: will not write if a exception is thrown (will be handled by onError)
        // Scenario 3: will be queued in memory and will be flushed later
        // Scenario 4: no write/end function exists (will be handled by onError)
        self.call_write_or_end(Some(encoded_data), true);
    }

    pub(crate) fn on_timeout(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onTimeout");

        if self.vm.script_execution_status() != bun_jsc::ScriptExecutionStatus::Running {
            return;
        }

        match_socket!(self.socket.get().clone(), |s: NewSocket<SSL>| {
            s.on_timeout(self.handle::<SSL>())
        });
    }

    /// The transport of `socket`.
    pub(crate) fn create(cx: &bun_jsc::JsThread<'_>, socket: OwnedSocket) -> RefPtr<Self> {
        let global_this = GlobalRef::from(cx.global());
        let this = bun_core::heap::into_raw(Box::new(WindowsNamedPipe {
            ref_count: Cell::new(1),
            self_ref: Cell::new(None),
            handle: Default::default(),
            socket: JsCell::new(Some(socket)),
            vm: global_this.bun_vm(),
            global_this,
            is_open: Cell::new(false),
            abort_handle: bun_jsc::AbortHandle::for_owner::<WindowsNamedPipe>(),
            pipe: JsCell::new(Some(uv::Owned::zeroed())),
            wrapper: OnceCell::new(),
            root: Cell::new(core::ptr::null_mut()),
            writer: StreamingWriter::default(),
            inflight_write_ref: Cell::new(None),
            incoming: JsCell::new(Vec::new()),
            connect_req: JsCell::new(bun_core::ffi::zeroed::<uv::uv_connect_t>()),
            connect_ref: Cell::new(None),
            event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::WindowsNamedPipe),
            current_timeout: Cell::new(0),
            flags: Cell::new(Flags::DISCONNECTED),
        }));
        // SAFETY: just allocated, and nothing else has the pointer yet.
        unsafe {
            (*this).root.set(this);
            (*this).handle.set(this);
        }
        LIVE_COUNT.fetch_add(1, Ordering::Relaxed);
        // SAFETY: initialised above with a count of 1, and heap-pinned. Dropping the handle disarms it.
        let this = unsafe {
            bun_jsc::AbortHandle::arm_owner(this, cx.context());
            RefPtr::from_raw(this)
        };
        this.self_ref.set(Some(this.clone()));
        this
    }

    /// Makes a new pipe over `target` the transport of `socket`. On `Err` the socket is detached again and has had no event.
    fn attach(
        cx: &bun_jsc::JsThread<'_>,
        target: Target<'_>,
        ssl_ctx: Option<boringssl::OwnedSslCtx>,
        socket: OwnedSocket,
    ) -> Result<(), SystemErrno> {
        let pipe = Self::create(cx, socket);
        match_socket!(pipe.socket.get(), |s: NewSocket<SSL>| {
            s.socket.set(pipe.handle::<SSL>());
            Ok(())
        });
        let started = match target {
            Target::Fd(fd) => pipe.open(fd, ssl_ctx),
            Target::Path(path) => pipe.connect_path(path, ssl_ctx),
        };
        if started.is_ok() {
            return Ok(());
        }
        match_socket!(pipe.socket.take(), |s: NewSocket<SSL>| {
            s.socket.set(uws::NewSocketHandler::<SSL>::DETACHED);
            Ok(())
        });
        pipe.self_ref.set(None);
        Err(SystemErrno::ENOENT)
    }

    /// Makes a pipe over the libuv descriptor `fd` the transport of `socket`.
    pub(crate) fn from_fd(
        cx: &bun_jsc::JsThread<'_>,
        fd: Fd,
        ssl_ctx: Option<boringssl::OwnedSslCtx>,
        socket: OwnedSocket,
    ) -> Result<(), SystemErrno> {
        Self::attach(cx, Target::Fd(fd), ssl_ctx, socket)
    }

    /// Makes a pipe that connects to `path` the transport of `socket`.
    pub(crate) fn from_path(
        cx: &bun_jsc::JsThread<'_>,
        path: &[u8],
        ssl_ctx: Option<boringssl::OwnedSslCtx>,
        socket: OwnedSocket,
    ) -> Result<(), SystemErrno> {
        Self::attach(cx, Target::Path(path), ssl_ctx, socket)
    }

    fn connect_path(
        &self,
        path: &[u8],
        ssl_ctx: Option<boringssl::OwnedSslCtx>,
    ) -> bun_sys::Result<()> {
        if path[path.len() - 1] == 0 {
            return self.connect(ZStr::from_slice_with_nul(path), ssl_ctx);
        }
        self.connect(&bun_paths::Path::from(path), ssl_ctx)
    }

    /// `extern "C"` trampoline matching `uv_connect_cb` (`Pipe::connect`'s
    /// `on_connect` parameter). Recovers `*mut Self` from `req->data` (set in
    /// `connect()`) and forwards to the safe `&self` body. Only ever invoked
    /// by libuv (coerces to the `uv_connect_cb` fn-pointer type at the
    /// `Pipe::connect` call site).
    extern "C" fn uv_on_connect(req: *mut uv::uv_connect_t, status: uv::ReturnCode) {
        // SAFETY: `req` is `self.connect_req`, whose `data` was set to
        // `self as *mut Self` in `connect`, and `connect_ref` keeps it alive.
        let this = unsafe { &*(*req).data.cast::<Self>() };
        let _connect_ref = this.connect_ref.take();
        this.on_connect(status);
    }

    fn on_connect(&self, status: uv::ReturnCode) {
        if let Some(err) = status.to_error(bun_sys::Tag::connect) {
            self.pipe.set(None);
            // The writer has no source to close, so it does not report `on_close`.
            self.on_error(err);
            self.on_close();
            return;
        }

        self.update_flags(|f| f.set(Flags::DISCONNECTED, false));
        if self.start() {
            match self.wrapper_ref() {
                // trigger onOpen and start the handshake
                Some(w) => w.start(&mut &*self),
                None => self.on_open(),
            }
        }
        self.flush();
        // With nothing queued, no `on_write(Drained)` follows to send a shutdown requested before the connect.
        self.send_shutdown_if_drained();
    }

    pub(crate) fn get_accepted_by(
        &self,
        server: &mut uv::Pipe,
        ssl_ctx: Option<&boringssl::OwnedSslCtx>,
    ) -> bun_sys::Result<()> {
        debug_assert!(self.pipe.get().is_some());
        self.update_flags(|f| f.set(Flags::DISCONNECTED, true));

        self.init_tls_wrapper(ssl_ctx.cloned(), false);
        self.init_pipe()?;
        self.try_pipe(bun_sys::Tag::accept, |pipe| server.accept(pipe))?;

        self.update_flags(|f| f.set(Flags::DISCONNECTED, false));
        if self.start() {
            match self.wrapper_ref() {
                // trigger onOpen and start the handshake
                Some(w) => w.start(&mut &*self),
                None => self.on_open(),
            }
        }
        bun_sys::Result::Ok(())
    }

    fn open(&self, fd: Fd, ssl_ctx: Option<boringssl::OwnedSslCtx>) -> bun_sys::Result<()> {
        debug_assert!(self.pipe.get().is_some());
        self.update_flags(|f| f.set(Flags::DISCONNECTED, true));

        self.init_tls_wrapper(ssl_ctx, true);
        self.init_pipe()?;
        self.try_pipe(bun_sys::Tag::open, |pipe| pipe.open(fd.uv()))?;

        self.on_connect(uv::ReturnCode::ZERO);
        bun_sys::Result::Ok(())
    }

    fn connect(&self, path: &[u8], ssl_ctx: Option<boringssl::OwnedSslCtx>) -> bun_sys::Result<()> {
        debug_assert!(self.pipe.get().is_some());
        self.update_flags(|f| f.set(Flags::DISCONNECTED, true));

        self.init_tls_wrapper(ssl_ctx, true);
        self.init_pipe()?;

        let ctx: *mut Self = self.root_ptr();
        self.connect_req.with_mut(|req| {
            req.data = ctx.cast::<c_void>();
            self.try_pipe(bun_sys::Tag::connect2, |pipe| {
                pipe.connect(req, path, ctx.cast::<c_void>(), Self::uv_on_connect)
            })
        })?;
        self.connect_ref.set(Some(self.keep_alive()));
        Ok(())
    }

    /// Makes the TLS engine if `ssl_ctx` asks for one.
    fn init_tls_wrapper(&self, ssl_ctx: Option<boringssl::OwnedSslCtx>, is_client: bool) {
        let Some(ctx) = ssl_ctx else { return };
        self.wrapper
            .get_or_init(|| SSLWrapper::init_with_ctx(ctx, is_client));
    }

    fn start(&self) -> bool {
        let Some(mut pipe) = self.pipe.take() else {
            return false;
        };
        pipe.unref();
        let this: *mut Self = self.root_ptr();
        self.update_flags(|f| f.insert(Flags::PIPE_ADOPTED));
        let owner = Owner::new(PollTag::WindowsNamedPipe, this.cast());
        // SAFETY: `owner` points to `self`, which is heap-allocated.
        unsafe { self.writer.set_owner(owner) };
        self.writer.start_with_pipe(self, pipe);
        let Some(stream) = self.writer.get_stream() else {
            self.on_error(bun_sys::Error::from_code(
                bun_sys::E::PIPE,
                bun_sys::Tag::read,
            ));
            return false;
        };

        // SAFETY: `stream` is the live `*mut uv_stream_t` for our pipe
        // (returned by `writer.get_stream()`); the `StreamReader` impl
        // below routes the trampolines back to `self`.
        let read_start_result =
            unsafe { (*stream).read_start_ctx::<Self>(this) }.to_result(bun_sys::Tag::listen);
        if let bun_sys::Result::Err(err) = read_start_result {
            self.on_error(err);
            return false;
        }
        true
    }

    /// `uv::open_handles` closes a not-yet-adopted pipe through here at teardown.
    unsafe fn stop_for_vm_teardown(this: *mut core::ffi::c_void) {
        // SAFETY: recorded right after `pipe.init` by this live object; replaced by
        // the writer at adoption or dropped with the pipe.
        unsafe { &*this.cast::<Self>() }.close_or_cancel_connect();
    }

    /// `close`, for a pipe that may still be connecting. That one is not the writer's yet, so
    /// `close` has nothing to end and the connection would open later all the same: discarding the
    /// pipe cancels the connect (libuv completes it with `UV_ECANCELED`), and `on_connect` reports
    /// the error and the close.
    pub(crate) fn close_or_cancel_connect(&self) {
        if !self.flags.get().contains(Flags::PIPE_ADOPTED) {
            self.pipe.set(None);
            return;
        }
        self.close();
    }

    /// Half-closes with `uv_shutdown` once libuv has every queued byte. `writer.end()` would close the read side too and drop the peer's reply.
    fn send_shutdown_if_drained(&self) {
        let flags = self.flags.get();
        if !flags.contains(Flags::SHUTDOWN_REQUESTED)
            || flags.contains(Flags::SHUTDOWN_SENT)
            || flags.is_closed()
            || flags.disconnected()
            || self.writer.has_pending_data()
        {
            return;
        }
        let Some(stream) = self.writer.get_stream() else {
            self.writer.end(self);
            return;
        };
        self.update_flags(|f| f.insert(Flags::SHUTDOWN_SENT));
        let req = bun_core::heap::alloc(bun_core::ffi::zeroed::<uv::uv_shutdown_t>());
        // SAFETY: `stream` is the live pipe stream owned by `self.writer`. libuv
        // owns `req` until it calls `uv_on_shutdown`, with `UV_ECANCELED` if the handle
        // closes first.
        let rc = unsafe { uv::uv_shutdown(req, stream, Some(Self::uv_on_shutdown)) };
        if rc.is_err() {
            // SAFETY: libuv didn't take `req`, so the callback never runs.
            unsafe { bun_core::heap::destroy(req) };
            // Close the whole handle so the peer still sees EOF.
            self.writer.end(self);
        }
    }

    /// Only frees the request. A canceled shutdown can run after its `WindowsNamedPipe` is gone.
    extern "C" fn uv_on_shutdown(req: *mut uv::uv_shutdown_t, _status: core::ffi::c_int) {
        // SAFETY: `req` comes from `heap::alloc` in `send_shutdown_if_drained`, and libuv calls this once.
        unsafe { bun_core::heap::destroy(req) };
    }

    pub(crate) fn reset_timeout(&self) {
        self.set_timeout_in_milliseconds(self.current_timeout.get());
    }

    pub(crate) fn set_timeout_in_milliseconds(&self, ms: c_uint) {
        self.event_loop_timer.disarm();
        self.current_timeout.set(ms);

        // if the interval is 0 means that we stop the timer
        if ms == 0 {
            return;
        }

        // reschedule the timer
        let next = timespec::ms_from_now(bun_core::TimespecMockMode::ForceRealTime, ms as i64);
        self.event_loop_timer.next.set(next);
        timer_all().insert(&raw const self.event_loop_timer);
    }

    /// Free internal resources, it can be called multiple times.
    // Private idempotent helper invoked from on_close and Drop.
    // Owned fields (writer, wrapper) free themselves via their own Drop impls; only
    // the side effects (timer cancel, read_stop, take()) remain explicit here.
    fn release_resources(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "deinit");
        // clear the timer
        self.set_timeout(0);
        // After a TLS close_notify the pipe is still open.
        if let Some(stream) = self.writer.get_stream() {
            // SAFETY: `stream` is the live pipe stream; `uv_read_stop`
            // always succeeds and is a no-op if not reading.
            unsafe { (*stream).read_stop() };
        }
        self.writer.close_without_reporting(self);
        self.writer.discard_queued();
        if let Some(w) = self.wrapper_ref() {
            w.deinit();
        }
    }
}

impl Transport for WindowsNamedPipe {
    fn is_closed(&self) -> bool {
        if let Some(wrapper) = self.wrapper_ref() {
            return wrapper.is_closed();
        }
        self.flags.get().disconnected()
    }

    fn is_shutdown(&self) -> bool {
        if let Some(wrapper) = self.wrapper_ref() {
            return wrapper.is_shutdown();
        }

        let flags = self.flags.get();
        flags.disconnected() || flags.contains(Flags::SHUTDOWN_REQUESTED) || self.writer.is_done()
    }

    fn write(&self, data: &[u8]) -> (i32, i32) {
        bun_output::scoped_log!(WindowsNamedPipe, "write (len: {})", data.len());
        if let Some(w) = self.wrapper_ref() {
            let written = w.write_data(&mut &*self, data).unwrap_or(0);
            return (i32::try_from(written).expect("int cast"), 0);
        }
        self.internal_write(data);
        (i32::try_from(data.len()).expect("int cast"), 0)
    }

    fn raw_write(&self, encoded_data: &[u8]) -> i32 {
        self.internal_write(encoded_data);
        i32::try_from(encoded_data.len()).expect("int cast")
    }

    /// A failed write reports its error, and TLS dispatches reads, before it returns.
    fn write_runs_js(&self) -> bool {
        true
    }

    fn shutdown(&self) {
        if let Some(w) = self.wrapper_ref() {
            let _ = w.shutdown(&mut &*self, false);
            return;
        }
        let flags = self.flags.get();
        if flags.contains(Flags::SHUTDOWN_REQUESTED) || flags.is_closed() {
            return;
        }
        self.update_flags(|f| f.insert(Flags::SHUTDOWN_REQUESTED));
        self.send_shutdown_if_drained();
    }

    fn close(&self) {
        if let Some(w) = self.wrapper_ref() {
            let _ = w.shutdown(&mut &*self, false);
        }
        self.writer.end(self);
    }

    fn pause_stream(&self) -> bool {
        let Some(stream) = self.writer.get_stream() else {
            return self.pipe.get().is_some();
        };
        // SAFETY: `stream` is the live pipe stream.
        unsafe { (*stream).read_stop() };
        true
    }

    fn resume_stream(&self) -> bool {
        let Some(stream) = self.writer.get_stream() else {
            return false;
        };
        let this: *mut Self = self.root_ptr();
        // SAFETY: `stream` is the live `*mut uv_stream_t` for our pipe
        // (returned by `writer.get_stream()`); the `StreamReader` impl
        // below routes the trampolines back to `self`.
        let read_start_result =
            unsafe { (*stream).read_start_ctx::<Self>(this) }.to_result(bun_sys::Tag::listen);
        read_start_result.is_ok()
    }

    fn shutdown_read(&self) {
        if let Some(wrapper) = self.wrapper_ref() {
            wrapper.shutdown_read();
        } else {
            if let Some(stream) = self.writer.get_stream() {
                // SAFETY: `stream` is the live pipe stream; `uv_read_stop`
                // always succeeds and is a no-op if not reading.
                unsafe { (*stream).read_stop() };
            }
        }
    }

    fn flush(&self) {
        if let Some(w) = self.wrapper_ref() {
            w.flush(&mut &*self);
        }
        if !self.flags.get().disconnected() {
            let _ = self.writer.flush(self);
        }
    }

    fn set_timeout(&self, seconds: c_uint) {
        bun_output::scoped_log!(WindowsNamedPipe, "setTimeout({})", seconds);
        self.set_timeout_in_milliseconds(seconds.saturating_mul(1000));
    }

    fn ssl(&self) -> Option<*mut boringssl::SSL> {
        Some(self.wrapper_ref()?.ssl()?.as_ptr())
    }
}

impl Drop for WindowsNamedPipe {
    fn drop(&mut self) {
        LIVE_COUNT.fetch_sub(1, Ordering::Relaxed);
        self.release_resources();
    }
}

impl bun_event_loop::Taskable for WindowsNamedPipe {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::WindowsNamedPipe;
    type Payload = AliasableBox<Self>;
    fn release_unrun(_: Self::Payload) {}
    /// A socket's own hop. Its handlers carry their context.
    fn context(_: &Self::Payload) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl WriteHandler for WindowsNamedPipe {
    fn on_write(&self, amount: usize, status: WriteStatus) {
        bun_output::scoped_log!(
            WindowsNamedPipe,
            "onWrite {} {}",
            amount,
            match status {
                WriteStatus::Pending => "pending",
                WriteStatus::Drained => "drained",
                WriteStatus::EndOfFile => "end_of_file",
            }
        );

        match status {
            WriteStatus::Pending => {}
            WriteStatus::Drained => {
                // unref after sending all data
                self.writer.update_ref(false);
                self.send_shutdown_if_drained();
            }
            WriteStatus::EndOfFile => {
                // we send FIN so we close after this
                self.writer.close(self);
            }
        }
    }

    fn on_error(&self, err: bun_sys::Error) {
        bun_output::scoped_log!(WindowsNamedPipe, "onError");
        let _keep_alive = self.keep_alive();
        if self.is_open.get() {
            match_socket!(self.socket.get().clone(), |s: NewSocket<SSL>| {
                s.handle_error(err.to_js(&self.global_this))
            });
        } else {
            self.fail_connect(SystemErrno::from_raw(err.errno));
        }
        self.close();
    }

    fn on_close(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onClose");
        self.pipe.set(None);
        if !self.flags.get().is_closed() {
            self.update_flags(|f| f.set(Flags::IS_CLOSED, true)); // only call onClose once
            match_socket!(self.socket.take(), |s: NewSocket<SSL>| {
                NewSocket::on_close(s, self.handle::<SSL>(), 0, None)
            });
            self.release_resources();
            self.self_ref.set(None);
        }
    }

    fn on_writable(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onWritable");
        // flush pending data
        self.flush();
        // call onWritable (will flush on demand)
        self.dispatch_writable();
    }

    fn set_has_inflight_write(&self, value: bool) {
        self.inflight_write_ref
            .set(value.then(|| self.keep_alive()));
    }
}

/// The three `stream.readStart` callbacks (alloc/error/read) baked into a
/// trait so the
/// `extern "C"` libuv trampoline is monomorphised over `WindowsNamedPipe`.
// SAFETY: nothing touches `incoming` between `on_read_alloc` and the report of the read.
unsafe impl uv::StreamReader for WindowsNamedPipe {
    #[inline]
    fn on_read_alloc(this: &Self, suggested_size: usize) -> *mut [u8] {
        this.incoming
            .with_mut(|incoming| incoming.uv_alloc_spare(suggested_size))
    }
    #[inline]
    fn on_read_error(this: &Self, err: core::ffi::c_int) {
        // The trampoline only reaches this arm when `nreads < 0`, and for any
        // negative code `translate_uv_error_to_e` already
        // yields a concrete `E` (falling back to `UNKNOWN` for unmapped
        // codes). Pass it straight through; do NOT remap UNKNOWN→CANCELED.
        let e = bun_sys::windows::translate_uv_error_to_e(err);
        this.on_read_error(e);
    }
    #[inline]
    unsafe fn on_read(this: &Self, nread: usize) {
        this.on_read(nread);
    }
}
