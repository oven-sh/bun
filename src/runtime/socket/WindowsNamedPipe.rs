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

use core::cell::Cell;
use core::ffi::{c_uint, c_void};
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_boringssl_sys as boringssl;
use bun_core::{ZStr, timespec};
use bun_event_loop::Task;
use bun_io::{IoEvent, OwnedPipe, Owner, PollTag, StreamingWriter, WriteHandler, WriteStatus};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{GlobalRef, JsCell, SysErrorJsc};
use bun_ptr::{CellExt as _, RefPtr, ThisPtr};
use bun_removable_features::removable_body_behind_value;
use bun_sys::windows::libuv as uv;
use bun_sys::{self, Fd, ReturnCodeExt as _, SystemErrno};
use bun_uws::{self as uws, us_bun_verify_error_t};

use crate::socket::ssl_wrapper::{self, SSLWrapper};
use crate::socket::{NewSocket, SSLConfig, TCPSocket, TLSSocket};
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

bun_output::declare_scope!(WindowsNamedPipe, visible);

pub(crate) type CertError = crate::socket::upgraded_duplex::CertError;

use crate::jsc_hooks::timer_all;

/// Read by `bun:internal-for-testing` leak tests: `heapStats()` only sees the JS wrappers.
pub(crate) static LIVE_COUNT: AtomicUsize = AtomicUsize::new(0);

#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = schedule_deinit)]
pub(crate) struct WindowsNamedPipe {
    ref_count: Cell<u32>,
    /// Held until the pipe closes, or fails to open.
    pub(super) self_ref: Cell<Option<RefPtr<Self>>>,
    /// `on_close` and `fail_connect` hand it to the socket's last event.
    socket: Cell<Option<OwnedSocket>>,
    global_this: GlobalRef,
    /// The socket is in no uSockets group, so the context that opened it closes it through this.
    abort_handle: bun_jsc::AbortHandle,

    pub(crate) wrapper: JsCell<Option<SSLWrapper>>,
    root: Cell<*mut WindowsNamedPipe>,
    /// Until [`start`](Self::start) hands it to `writer`.
    pipe: JsCell<Option<OwnedPipe>>,
    /// The per-thread VM singleton outlives this struct (it is torn down only
    /// at thread exit, after every named pipe is closed), so `&'static` is the
    /// honest model here rather than a threaded lifetime.
    pub(crate) vm: &'static VirtualMachine,
    writer: StreamingWriter,
    /// Held while a write is in flight.
    inflight_write_ref: Cell<Option<RefPtr<Self>>>,

    pub(crate) ssl_error: JsCell<CertError>,
    /// Held while `pipe` connects.
    connect_ref: Cell<Option<RefPtr<Self>>>,

    pub(crate) event_loop_timer: EventLoopTimer,
    pub(crate) current_timeout: Cell<u32>,
    pub(crate) flags: Cell<Flags>,
}

bun_event_loop::impl_timer_owner!(WindowsNamedPipe; from_timer_ptr => event_loop_timer);

bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Clone, Copy, Default)]
    pub struct Flags: u8 {
        const DISCONNECTED = 1 << 0;
        const IS_CLOSED    = 1 << 1;
        const IS_CLIENT    = 1 << 2;
        const IS_SSL       = 1 << 3;
        /// `writer` has taken the pipe.
        const PIPE_ADOPTED = 1 << 4;
        const WRAPPER_BUSY = 1 << 5;
        /// The socket has had its `on_open`.
        const IS_OPEN      = 1 << 6;
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
    #[inline]
    pub(crate) fn is_ssl(self) -> bool {
        self.contains(Self::IS_SSL)
    }
}

bun_jsc::impl_abort_handle_owner!(WindowsNamedPipe, abort_handle, |this, _cause| {
    // SAFETY: trait contract — `this` is live, and only a queued task frees it.
    unsafe { &*this }.close_or_cancel_connect()
});

/// From a task, because the frame that released the last ref may still use the pipe.
fn schedule_deinit(this: *mut WindowsNamedPipe) {
    // SAFETY: called from `deref()` at count zero; `this` is live until the task fires.
    unsafe { (*this).vm }.enqueue_task(Task::init(this));
}

impl bun_event_loop::Taskable for WindowsNamedPipe {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::WindowsNamedPipeDeinit;
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract: the box that `schedule_deinit` queued.
        unsafe { bun_core::heap::destroy(this) }
    }
    /// A socket's own hop; its handlers carry their context.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

/// The ref a pipe holds on the socket it carries.
pub(crate) enum OwnedSocket {
    Tls(RefPtr<TLSSocket>),
    Tcp(RefPtr<TCPSocket>),
}

/// `Copy` view of [`OwnedSocket`]: a handler can close the pipe, which empties that field.
#[derive(Copy, Clone)]
enum SocketType {
    Tls(ThisPtr<TLSSocket>),
    Tcp(ThisPtr<TCPSocket>),
    None,
}

/// Runs `$body` with the socket of `$pipe`, if it has one, as `$s`: a `ThisPtr<NewSocket<SSL>>`.
macro_rules! match_socket {
    ($pipe:expr, |$s:ident| $body:expr) => {
        // This is the named-pipe sockets' trampoline: what a handler left pending is folded here.
        removable_body_behind_value!(Sockets, {
            match $pipe.socket_type() {
                SocketType::Tls($s) => crate::dispatch::fold($body),
                SocketType::Tcp($s) => crate::dispatch::fold($body),
                SocketType::None => {}
            }
        })
    };
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
        self.wrapper.get().as_ref()
    }

    fn install_wrapper(&self, wrapper: SSLWrapper) {
        wrapper.enable_session_and_keylog();
        self.wrapper.set(Some(wrapper));
    }

    fn with_wrapper<R>(&self, f: impl FnOnce(&SSLWrapper) -> R) -> Option<R> {
        let w = self.wrapper_ref()?;
        let was_busy = self.flags.get().contains(Flags::WRAPPER_BUSY);
        self.update_flags(|flags| flags.insert(Flags::WRAPPER_BUSY));
        let result = f(w);
        if !was_busy {
            self.update_flags(|flags| flags.remove(Flags::WRAPPER_BUSY));
            if self.flags.get().is_closed() {
                self.wrapper.set(None);
            }
        }
        Some(result)
    }

    fn socket_type(&self) -> SocketType {
        let socket = self.socket.take();
        let socket_type = match &socket {
            Some(OwnedSocket::Tls(s)) => SocketType::Tls(s.this_ptr()),
            Some(OwnedSocket::Tcp(s)) => SocketType::Tcp(s.this_ptr()),
            None => SocketType::None,
        };
        self.socket.put_back(socket);
        socket_type
    }

    fn socket_handler<const SSL: bool>(&self) -> uws::NewSocketHandler<SSL> {
        uws::NewSocketHandler {
            socket: uws::InternalSocket::Pipe(self.root_ptr().cast()),
        }
    }

    fn io_owner(&self) -> Owner {
        Owner::new(PollTag::WindowsNamedPipe, self.root_ptr().cast())
    }

    /// The pipe is kept, for `on_connect` to hear of it.
    fn cancel_connect(&self) {
        if let Some(pipe) = self.pipe.get() {
            pipe.close();
        }
    }

    /// `false` if `writer` has no pipe.
    fn read_stop(&self) -> bool {
        self.writer.with_pipe(|pipe| pipe.read_stop()).is_some()
    }

    /// Holds a ref until the returned guard drops.
    ///
    /// The pipe frees itself from a task it queues when [`on_close`] releases
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
        // SAFETY: the allocation that holds `self`.
        unsafe { RefPtr::init_ref(self.root_ptr()) }
    }

    pub(crate) fn on_io(&self, event: IoEvent) {
        match event {
            IoEvent::StreamRead(nread) => match nread.errno() {
                Some(err) => self.on_read_error(err),
                None => self.on_read(nread),
            },
            IoEvent::Connect(status) => {
                let _connect_ref = self.connect_ref.take();
                self.on_connect(status);
            }
            IoEvent::VmTeardown if self.pipe.get().is_some() => self.cancel_connect(),
            event => {
                let _keep_alive = self.keep_alive();
                self.writer.on_io(self, event);
            }
        }
    }

    fn on_read(&self, nread: uv::ReturnCodeI64) {
        bun_output::scoped_log!(WindowsNamedPipe, "onRead ({})", nread.int());
        let _keep_alive = self.keep_alive();

        self.reset_timeout();

        let Some(mut data) = self.writer.with_pipe(|pipe| pipe.input().take()) else {
            return;
        };

        if self
            .with_wrapper(|w| w.receive_data(&mut &*self, data.as_slice()))
            .is_none()
        {
            self.on_data(data.as_slice());
        }
        data.clear();
        self.writer.with_pipe(|pipe| pipe.input().set(data));
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
            match_socket!(self, |s| NewSocket::on_end(s, self.socket_handler()));
            self.writer.close(self);
            return;
        }
        self.on_error(bun_sys::Error::from_code(err, bun_sys::Tag::read));
        self.writer.close(self);
    }

    fn on_open(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onOpen");
        self.update_flags(|f| f.insert(Flags::IS_OPEN));
        match_socket!(self, |s| NewSocket::on_open(s, self.socket_handler()));
    }

    fn on_data(&self, data: &[u8]) {
        bun_output::scoped_log!(WindowsNamedPipe, "onData ({})", data.len());
        match_socket!(self, |s| NewSocket::on_data(s, self.socket_handler(), data));
    }

    /// `connectError` is the socket's last event: a later `on_close` finds no socket.
    fn fail_connect(&self, errno: i32) {
        // Taken before `connectError` runs JS, which may connect the same socket again through a new pipe.
        crate::dispatch::fold(removable_body_behind_value!(Sockets, {
            match self.socket.take() {
                Some(OwnedSocket::Tls(s)) => NewSocket::handle_connect_error(s, errno, 0),
                Some(OwnedSocket::Tcp(s)) => NewSocket::handle_connect_error(s, errno, 0),
                None => Ok(()),
            }
        }));
    }

    fn close_socket(&self) {
        crate::dispatch::fold(removable_body_behind_value!(Sockets, {
            match self.socket.take() {
                Some(OwnedSocket::Tls(s)) => NewSocket::on_close(s, self.socket_handler(), 0, None),
                Some(OwnedSocket::Tcp(s)) => NewSocket::on_close(s, self.socket_handler(), 0, None),
                None => Ok(()),
            }
        }));
    }

    fn fail_open(&self) {
        let _self_ref = self.self_ref.take();
        self.fail_connect(SystemErrno::ENOENT as i32);
    }
}

impl ssl_wrapper::Handler for &WindowsNamedPipe {
    fn on_open(&mut self) {
        WindowsNamedPipe::on_open(self)
    }

    fn on_data(&mut self, decoded_data: &[u8]) {
        WindowsNamedPipe::on_data(self, decoded_data)
    }

    fn on_session(&mut self, session: &[u8]) {
        bun_output::scoped_log!(WindowsNamedPipe, "onSession ({})", session.len());
        if let SocketType::Tls(s) = self.socket_type() {
            removable_body_behind_value!(Sockets, {
                crate::dispatch::fold(TLSSocket::on_session(s, session))
            });
        }
    }

    fn on_keylog(&mut self, line: &[u8]) {
        bun_output::scoped_log!(WindowsNamedPipe, "onKeylog ({})", line.len());
        if let SocketType::Tls(s) = self.socket_type() {
            removable_body_behind_value!(Sockets, {
                crate::dispatch::fold(TLSSocket::on_keylog(s, line))
            });
        }
    }

    fn server_identity(&mut self, ssl: &mut boringssl::SSL) -> bun_boringssl::ServerIdentity {
        match self.socket_type() {
            SocketType::Tls(s) => removable_body_behind_value!(Sockets, { s.server_identity(ssl) }),
            _ => bun_boringssl::ServerIdentity::Unchecked,
        }
    }

    fn on_close(&mut self) {
        WriteHandler::on_close(*self)
    }

    fn write(&mut self, encoded_data: &[u8]) {
        self.internal_write(encoded_data)
    }

    fn on_handshake(&mut self, handshake_success: bool, ssl_error: us_bun_verify_error_t) {
        bun_output::scoped_log!(WindowsNamedPipe, "onHandshake");
        let _keep_alive = self.keep_alive();

        self.ssl_error.set(CertError {
            error_no: ssl_error.error_no,
            code: ssl_error
                .code()
                .filter(|_| ssl_error.error_no != 0)
                .map(Into::into),
            reason: ssl_error
                .reason()
                .filter(|_| ssl_error.error_no != 0)
                .map(Into::into),
        });
        match_socket!(self, |s| NewSocket::on_handshake(
            s,
            self.socket_handler(),
            handshake_success as i32,
            ssl_error
        ));
        // Retry writes parked during the handshake; a TLS 1.2 client's completion sends nothing.
        if handshake_success && !self.is_shutdown() {
            match_socket!(self, |s| NewSocket::on_writable(s, self.socket_handler()));
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
            let _ = self.with_wrapper(|w| {
                let _ = w.shutdown(&mut &*self, false);
            });
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

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__resume_stream")]
    pub(crate) fn resume_stream(&self) -> bool {
        self.writer.with_pipe(OwnedPipe::read_start) == Some(uv::ReturnCode::ZERO)
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__pause_stream")]
    pub(crate) fn pause_stream(&self) -> bool {
        self.read_stop() || matches!(self.pipe.get(), Some(pipe) if !pipe.is_closing())
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__flush")]
    pub(crate) fn flush(&self) {
        let _ = self.with_wrapper(|w| w.flush(&mut &*self));
        if !self.flags.get().disconnected() {
            let _ = self.writer.flush(self);
        }
    }

    pub(crate) fn on_timeout(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onTimeout");

        let has_been_cleared = self.event_loop_timer.state.get() == EventLoopTimerState::CANCELLED
            || self.vm.script_execution_status() != bun_jsc::ScriptExecutionStatus::Running;

        self.event_loop_timer.state.set(EventLoopTimerState::FIRED);

        if has_been_cleared {
            return;
        }

        match_socket!(self, |s| NewSocket::on_timeout(s, self.socket_handler()));
    }

    pub(crate) fn create(cx: &bun_jsc::JsThread<'_>, socket: OwnedSocket) -> RefPtr<Self> {
        let global_this = GlobalRef::from(cx.global());
        let this = RefPtr::new(WindowsNamedPipe {
            ref_count: Cell::new(1),
            self_ref: Cell::new(None),
            socket: Cell::new(Some(socket)),
            global_this,
            abort_handle: bun_jsc::AbortHandle::for_owner::<Self>(),
            vm: global_this.bun_vm(),
            pipe: JsCell::new(None),
            wrapper: JsCell::new(None),
            root: Cell::new(core::ptr::null_mut()),
            // defaults:
            writer: StreamingWriter::default(),
            inflight_write_ref: Cell::new(None),
            ssl_error: JsCell::new(CertError::default()),
            connect_ref: Cell::new(None),
            event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::WindowsNamedPipe),
            current_timeout: Cell::new(0),
            flags: Cell::new(Flags::DISCONNECTED), // disconnected: bool = true is the only non-false default
        });
        this.root.set(this.as_ptr());
        this.self_ref.set(Some(this.clone()));
        LIVE_COUNT.fetch_add(1, Ordering::Relaxed);
        // SAFETY: heap-pinned; disarmed when freed.
        unsafe { bun_jsc::AbortHandle::arm_owner(this.as_ptr(), cx.context()) };
        this
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
        if self.start(true) {
            if self.is_tls() {
                // trigger onOpen and start the handshake
                let _ = self.with_wrapper(|w| w.start(&mut &*self));
            } else {
                // trigger onOpen
                self.on_open();
            }
        }
        self.flush();
    }

    /// The caller holds the ref that `create` returned.
    pub(crate) fn get_accepted_by<D>(
        &self,
        server: &uv::Handle<uv::ListeningPipe, D>,
        ssl_ctx: Option<&boringssl::OwnedSslCtx>,
    ) -> bun_sys::Result<()> {
        self.update_flags(|f| f.set(Flags::DISCONNECTED, true));

        if let Some(tls) = ssl_ctx {
            self.update_flags(|f| f.set(Flags::IS_SSL, true));
            match SSLWrapper::init_with_ctx(tls.clone(), false) {
                Ok(w) => self.install_wrapper(w),
                Err(_) => {
                    return bun_sys::Result::Err(bun_sys::Error {
                        errno: bun_sys::E::EPIPE as _,
                        syscall: bun_sys::Tag::connect,
                        ..Default::default()
                    });
                }
            }
        }
        self.pipe.set(Some(OwnedPipe::accept(server)?));

        self.update_flags(|f| f.set(Flags::DISCONNECTED, false));
        if self.start(false) {
            if self.is_tls() {
                // trigger onOpen and start the handshake
                let _ = self.with_wrapper(|w| w.start(&mut &*self));
            } else {
                // trigger onOpen
                self.on_open();
            }
        }
        bun_sys::Result::Ok(())
    }

    pub(crate) fn open(
        cx: &bun_jsc::JsThread<'_>,
        fd: Fd,
        ssl_config: Option<SSLConfig>,
        owned_ctx: Option<boringssl::OwnedSslCtx>,
        socket: OwnedSocket,
    ) {
        let this = Self::create(cx, socket);
        // On `Ok`, `socket` has had its `on_open`, which hands it the pipe, or its connect error.
        if this.open_pipe(fd, ssl_config, owned_ctx).is_err() {
            this.fail_open();
        }
    }

    pub(crate) fn connect(
        cx: &bun_jsc::JsThread<'_>,
        path: &[u8],
        ssl_config: Option<SSLConfig>,
        owned_ctx: Option<boringssl::OwnedSslCtx>,
        socket: OwnedSocket,
    ) -> bun_sys::Result<uws::InternalSocket> {
        let this = Self::create(cx, socket);

        if path[path.len() - 1] == 0 {
            // is already null terminated
            let slice_z = ZStr::from_slice_with_nul(path);
            this.connect_pipe(slice_z, ssl_config, owned_ctx)
        } else {
            let mut path_buf = bun_paths::path_buffer_pool::get();
            // we need to null terminate the path
            let len = path.len().min(path_buf.len() - 1);

            path_buf[..len].copy_from_slice(&path[..len]);
            let slice_z = ZStr::nul_terminate(&mut path_buf, len);
            this.connect_pipe(slice_z, ssl_config, owned_ctx)
        }
        .inspect_err(|_| this.fail_open())?;

        let socket = uws::InternalSocket::Pipe(this.as_ptr().cast());
        this.this_ptr().connect_ref.set(Some(this));
        Ok(socket)
    }

    fn open_pipe(
        &self,
        fd: Fd,
        ssl_options: Option<SSLConfig>,
        owned_ctx: Option<boringssl::OwnedSslCtx>,
    ) -> bun_sys::Result<()> {
        self.update_flags(|f| f.set(Flags::DISCONNECTED, true));

        if let Some(result) = self.init_tls_wrapper(ssl_options, owned_ctx) {
            result?;
        }
        let pipe = OwnedPipe::open(self.vm.uv_loop(), false, fd)?;
        self.pipe.set(Some(pipe));

        self.on_connect(uv::ReturnCode::ZERO);
        bun_sys::Result::Ok(())
    }

    fn connect_pipe(
        &self,
        path: &ZStr,
        ssl_options: Option<SSLConfig>,
        owned_ctx: Option<boringssl::OwnedSslCtx>,
    ) -> bun_sys::Result<()> {
        self.update_flags(|f| f.set(Flags::DISCONNECTED, true));

        if let Some(result) = self.init_tls_wrapper(ssl_options, owned_ctx) {
            result?;
        }
        let pipe = OwnedPipe::connect(self.vm.uv_loop(), path)?;
        // SAFETY: the allocation that holds `self`, which drops the pipe.
        unsafe { pipe.set_owner(self.io_owner()) };
        self.pipe.set(Some(pipe));
        Ok(())
    }

    /// Set up the in-process SSL wrapper for `connect`/`open`. Prefers a prebuilt
    /// `SSL_CTX` (moved into `wrapper`) so a memoised `tls.createSecureContext`
    /// reaches this path with its CA bundle intact; on this branch `[buntls]`
    /// returns `{secureContext}` and no longer spreads `{ca,cert,key}`, so the
    /// `SSLConfig` fallback alone would build a CTX with an empty trust store
    /// and fail `DEPTH_ZERO_SELF_SIGNED_CERT`.
    /// Returns null when neither input requested TLS.
    fn init_tls_wrapper(
        &self,
        ssl_options: Option<SSLConfig>,
        owned_ctx: Option<boringssl::OwnedSslCtx>,
    ) -> Option<bun_sys::Result<()>> {
        if let Some(ctx) = owned_ctx {
            self.update_flags(|f| f.set(Flags::IS_SSL, true));
            match SSLWrapper::init_with_ctx(ctx, true) {
                Ok(w) => self.install_wrapper(w),
                Err(_) => {
                    return Some(bun_sys::Result::Err(bun_sys::Error {
                        errno: bun_sys::E::EPIPE as _,
                        syscall: bun_sys::Tag::connect,
                        ..Default::default()
                    }));
                }
            }
            return Some(bun_sys::Result::Ok(()));
        }
        if let Some(tls) = ssl_options {
            self.update_flags(|f| f.set(Flags::IS_SSL, true));
            match ssl_wrapper::init(&tls, true) {
                Ok(w) => self.install_wrapper(w),
                Err(_) => {
                    return Some(bun_sys::Result::Err(bun_sys::Error {
                        errno: bun_sys::E::EPIPE as _,
                        syscall: bun_sys::Tag::connect,
                        ..Default::default()
                    }));
                }
            }
            return Some(bun_sys::Result::Ok(()));
        }
        None
    }

    pub(crate) fn start(&self, is_client: bool) -> bool {
        self.update_flags(|f| f.set(Flags::IS_CLIENT, is_client));
        let Some(pipe) = self.pipe.take() else {
            return false;
        };
        pipe.unref();
        self.update_flags(|f| f.insert(Flags::PIPE_ADOPTED));
        // SAFETY: the allocation that holds `self`.
        unsafe { self.writer.set_owner(self.io_owner()) };
        self.writer.start_with_pipe(self, pipe);
        let Some(rc) = self.writer.with_pipe(OwnedPipe::read_start) else {
            self.on_error(bun_sys::Error::from_code(
                bun_sys::E::PIPE,
                bun_sys::Tag::read,
            ));
            return false;
        };

        if let Some(err) = rc.to_error(bun_sys::Tag::listen) {
            self.on_error(err);
            return false;
        }
        true
    }

    pub(crate) fn is_tls(&self) -> bool {
        self.flags.get().is_ssl()
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__encode_and_write")]
    pub(crate) fn encode_and_write(&self, data: &[u8]) -> i32 {
        bun_output::scoped_log!(WindowsNamedPipe, "encodeAndWrite (len: {})", data.len());
        if let Some(r) = self.with_wrapper(|w| w.write_data(&mut &*self, data)) {
            return i32::try_from(r.unwrap_or(0)).expect("int cast");
        }
        self.internal_write(data);
        i32::try_from(data.len()).expect("int cast")
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__raw_write")]
    pub(crate) fn raw_write(&self, encoded_data: &[u8]) -> i32 {
        self.internal_write(encoded_data);
        i32::try_from(encoded_data.len()).expect("int cast")
    }

    /// `close`, for a pipe that may still be connecting. That one is not the writer's yet, so
    /// `close` has nothing to end and the connection would open later all the same: closing the
    /// pipe cancels the connect (libuv completes it with `UV_ECANCELED`), and `on_connect` reports
    /// the error and the close.
    pub(crate) fn close_or_cancel_connect(&self) {
        if !self.flags.get().contains(Flags::PIPE_ADOPTED) {
            return self.cancel_connect();
        }
        self.close();
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__close")]
    pub(crate) fn close(&self) {
        let _ = self.with_wrapper(|w| {
            let _ = w.shutdown(&mut &*self, false);
        });
        self.writer.end(self);
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__shutdown")]
    pub(crate) fn shutdown(&self) {
        let handled = self.with_wrapper(|w| {
            let _ = w.shutdown(&mut &*self, false);
        });
        if handled.is_none() {
            // Plain (non-TLS) named pipe: half-close the write side so the peer
            // observes EOF. Without this, Socket.prototype.end() over a Windows
            // named pipe (endNT → shutdown()) never signals the peer, and an
            // allowHalfOpen peer waiting on 'end' hangs. `writer.end()` is
            // idempotent and mirrors `close`'s unconditional writer teardown.
            self.writer.end(self);
        }
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__shutdown_read")]
    pub(crate) fn shutdown_read(&self) {
        if let Some(wrapper) = self.wrapper_ref() {
            wrapper.shutdown_read();
        } else {
            self.read_stop();
        }
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__is_shutdown", no_catch)]
    pub(crate) fn is_shutdown(&self) -> bool {
        if let Some(wrapper) = self.wrapper_ref() {
            return wrapper.is_shutdown();
        }

        self.flags.get().disconnected() || self.writer.is_done()
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__is_closed", no_catch)]
    pub(crate) fn is_closed(&self) -> bool {
        if let Some(wrapper) = self.wrapper_ref() {
            return wrapper.is_closed();
        }
        self.flags.get().disconnected()
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__is_established", no_catch)]
    pub(crate) fn is_established(&self) -> bool {
        !self.is_closed()
    }

    pub(crate) fn ssl(&self) -> Option<*mut boringssl::SSL> {
        self.wrapper_ref()
            .and_then(|w| w.ssl.get())
            .map(|p| p.as_ptr())
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__ssl_error", no_catch)]
    pub(crate) fn ssl_error(&self) -> us_bun_verify_error_t {
        let err = self.ssl_error.get();
        us_bun_verify_error_t {
            error_no: err.error_no,
            // CertError.code/.reason are owned `Box<CStr>`s; fall back to "" when absent.
            code: err.code.as_deref().map_or(c"".as_ptr(), |c| c.as_ptr()),
            reason: err.reason.as_deref().map_or(c"".as_ptr(), |c| c.as_ptr()),
        }
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

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__set_timeout")]
    pub(crate) fn set_timeout(&self, seconds: c_uint) {
        bun_output::scoped_log!(WindowsNamedPipe, "setTimeout({})", seconds);
        self.set_timeout_in_milliseconds(seconds * 1000);
    }

    /// Free internal resources, it can be called multiple times.
    // Private idempotent helper invoked from on_close and Drop.
    // Owned fields (writer, wrapper, ssl_error) free themselves via their own Drop impls; only
    // the side effects (timer cancel, read_stop, take()) remain explicit here.
    fn release_resources(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "deinit");
        // clear the timer
        self.set_timeout(0);
        // After a TLS close_notify the pipe is still open.
        self.read_stop();
        self.writer.close_without_reporting(self);
        self.writer.discard_queued();
        if !self.flags.get().contains(Flags::WRAPPER_BUSY) {
            self.wrapper.set(None);
        }
        self.ssl_error.set(CertError::default());
    }
}

impl Drop for WindowsNamedPipe {
    fn drop(&mut self) {
        LIVE_COUNT.fetch_sub(1, Ordering::Relaxed);
        self.socket.set(None);
        self.release_resources();
    }
}

// Hand-written `ssl` shim for the `bun_uws` cycle-break extern — the safe
// method returns `Option<*mut SSL>` while the C ABI flattens to a nullable
// raw pointer. All other `WindowsNamedPipe__*` symbols are emitted by
// `#[uws_callback(export = …)]` on the inherent methods above.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn WindowsNamedPipe__set_inline_reject(this: *const c_void) {
    // SAFETY: `this` is a live `*const WindowsNamedPipe` from the bun_uws opaque handle.
    if let Some(wrapper) = unsafe { (*this.cast::<WindowsNamedPipe>()).wrapper_ref() } {
        wrapper.set_inline_reject();
    }
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn WindowsNamedPipe__latest_session(
    this: *const c_void,
) -> *mut bun_boringssl_sys::SSL_SESSION {
    // SAFETY: `this` is a live `*const WindowsNamedPipe` from the bun_uws opaque handle.
    unsafe { (*this.cast::<WindowsNamedPipe>()).wrapper_ref() }
        .map_or(core::ptr::null_mut(), |wrapper| wrapper.latest_session())
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn WindowsNamedPipe__ssl(this: *const c_void) -> *mut boringssl::SSL {
    // SAFETY: `this` is a live `*const WindowsNamedPipe` from the bun_uws opaque handle.
    unsafe {
        (*this.cast::<WindowsNamedPipe>())
            .ssl()
            .unwrap_or(core::ptr::null_mut())
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
            // unref after sending all data
            WriteStatus::Drained => self.writer.update_ref(false),
            // we send FIN so we close after this
            WriteStatus::EndOfFile => self.writer.close(self),
        }
    }

    fn on_error(&self, err: bun_sys::Error) {
        bun_output::scoped_log!(WindowsNamedPipe, "onError");
        let _keep_alive = self.keep_alive();
        if self.flags.get().contains(Flags::IS_OPEN) {
            match_socket!(self, |s| s.handle_error(err.to_js(&self.global_this)));
        } else {
            self.fail_connect(err.errno as i32);
        }
        self.close();
    }

    fn on_close(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onClose");
        self.cancel_connect();
        if !self.flags.get().is_closed() {
            self.update_flags(|f| f.set(Flags::IS_CLOSED, true)); // only call onClose once
            let _self_ref = self.self_ref.take();
            self.close_socket();
            self.release_resources();
        }
    }

    fn on_writable(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onWritable");
        // flush pending data
        self.flush();
        // call onWritable (will flush on demand)
        match_socket!(self, |s| NewSocket::on_writable(s, self.socket_handler()));
    }

    fn set_has_inflight_write(&self, value: bool) {
        self.inflight_write_ref
            .set(value.then(|| self.keep_alive()));
    }
}
