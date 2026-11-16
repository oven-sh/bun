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

use bun_boringssl_sys as boringssl;
use bun_core::{ZStr, timespec};
use bun_io::{IoEvent, OwnedPipe, Owner, PollTag, StreamingWriter, WriteHandler, WriteStatus};
use bun_jsc::JsCell;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_ptr::RefPtr;
use bun_sys::windows::libuv as uv;
use bun_sys::{self, Fd, ReturnCodeExt as _};
use bun_uws::us_bun_verify_error_t;

use crate::socket::ssl_wrapper::{self, SSLWrapper};
use crate::socket::{SSLConfig, WindowsNamedPipeContext};
use crate::timer::{EventLoopTimerTag, OwnedTimer};

bun_output::declare_scope!(WindowsNamedPipe, visible);

pub(crate) type CertError = crate::socket::upgraded_duplex::CertError;

use crate::jsc_hooks::timer_all;

pub(crate) struct WindowsNamedPipe {
    pub(crate) wrapper: OnceCell<SSLWrapper>,
    pub(crate) root: Cell<*mut WindowsNamedPipe>,
    /// Until [`start`](Self::start) hands it to `writer`.
    pipe: JsCell<Option<OwnedPipe>>,
    /// The per-thread VM singleton outlives this struct (it is torn down only
    /// at thread exit, after every named pipe is closed), so `&'static` is the
    /// honest model here rather than a threaded lifetime.
    pub(crate) vm: &'static VirtualMachine,
    writer: StreamingWriter,
    /// Held while a write is in flight.
    inflight_write_ref: Cell<Option<RefPtr<WindowsNamedPipeContext>>>,

    pub(crate) ssl_error: JsCell<CertError>,
    pub(crate) handlers: Handlers,
    /// Held while `pipe` connects.
    connect_ref: Cell<Option<RefPtr<WindowsNamedPipeContext>>>,

    pub(crate) event_loop_timer: OwnedTimer<{ EventLoopTimerTag::WindowsNamedPipe }>,
    pub(crate) current_timeout: Cell<u32>,
    pub(crate) flags: Cell<Flags>,
}

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

pub(crate) struct Handlers {
    pub ctx: *mut c_void,
    pub(crate) on_open: fn(*mut c_void),
    pub(crate) on_handshake: fn(*mut c_void, bool, us_bun_verify_error_t),
    pub(crate) on_data: fn(*mut c_void, &[u8]),
    pub on_close: fn(*mut c_void),
    pub(crate) on_end: fn(*mut c_void),
    pub(crate) on_writable: fn(*mut c_void),
    pub(crate) on_error: fn(*mut c_void, bun_sys::Error),
    pub(crate) on_timeout: fn(*mut c_void),
    /// A new resumable TLS session (serialized SSL_SESSION) - node's
    /// `'session'` event on the wrapping TLSSocket.
    pub(crate) on_session: fn(*mut c_void, &[u8]),
    /// An NSS key-log line - node's `'keylog'` event.
    pub(crate) on_keylog: fn(*mut c_void, &[u8]),
    pub(crate) server_identity: fn(*mut c_void, &boringssl::SSL) -> bun_boringssl::ServerIdentity,
    pub(crate) alpn_select: ssl_wrapper::AlpnSelectFn<*mut c_void>,
}

impl WindowsNamedPipe {
    #[inline]
    fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut flags = self.flags.get();
        f(&mut flags);
        self.flags.set(flags);
    }

    fn install_wrapper(&self, wrapper: SSLWrapper) {
        debug_assert!(self.wrapper.get().is_none(), "TLS was set up twice");
        wrapper.enable_session_and_keylog();
        self.wrapper.get_or_init(|| wrapper);
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

    /// Holds a ref on the owning context until the returned guard drops.
    ///
    /// The context frees itself from a task it queues when [`on_close`] releases
    /// the connection's ref. A handler can close the socket and then spin the
    /// event loop before it returns (`expect().resolves` blocks on a promise
    /// that way), which runs that task. A callback that uses `self` after it
    /// dispatched to a handler holds this guard, so the free waits until the
    /// callback is done. `inflight_write_ref` does the same around an in-flight write,
    /// and `connect`/`open` around the connect.
    ///
    /// Only for paths that cannot run after `on_close` released the
    /// connection's ref (reads and the wrapper's callbacks stop in
    /// `release_resources`): `schedule_deinit` can have run by then.
    ///
    /// [`on_close`]: Self::on_close
    fn keep_alive(&self) -> RefPtr<WindowsNamedPipeContext> {
        // SAFETY: the context that `self` is a field of.
        unsafe { RefPtr::init_ref(self.handlers.ctx.cast()) }
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

        match self.wrapper.get() {
            Some(w) => w.receive_data(&mut &*self, data.as_slice()),
            None => (self.handlers.on_data)(self.handlers.ctx, data.as_slice()),
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
            (self.handlers.on_end)(self.handlers.ctx);
            self.writer.close(self);
            return;
        }
        self.on_error(bun_sys::Error::from_code(err, bun_sys::Tag::read));
        self.writer.close(self);
    }

    fn on_open(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onOpen");
        (self.handlers.on_open)(self.handlers.ctx);
    }
}

impl ssl_wrapper::Handler for &WindowsNamedPipe {
    fn on_open(&mut self) {
        WindowsNamedPipe::on_open(self)
    }

    fn on_data(&mut self, decoded_data: &[u8]) {
        bun_output::scoped_log!(WindowsNamedPipe, "onData ({})", decoded_data.len());
        (self.handlers.on_data)(self.handlers.ctx, decoded_data);
    }

    fn on_session(&mut self, session: &[u8]) {
        bun_output::scoped_log!(WindowsNamedPipe, "onSession ({})", session.len());
        (self.handlers.on_session)(self.handlers.ctx, session);
    }

    fn on_keylog(&mut self, line: &[u8]) {
        bun_output::scoped_log!(WindowsNamedPipe, "onKeylog ({})", line.len());
        (self.handlers.on_keylog)(self.handlers.ctx, line);
    }

    fn server_identity(&mut self, ssl: &boringssl::SSL) -> bun_boringssl::ServerIdentity {
        (self.handlers.server_identity)(self.handlers.ctx, ssl)
    }

    fn alpn_select<'a>(
        &mut self,
        ssl: &boringssl::SSL,
        offered: &'a [u8],
    ) -> bun_boringssl::AlpnSelection<'a> {
        (self.handlers.alpn_select)(self.handlers.ctx, ssl, offered)
    }

    fn on_close(&mut self) {
        WindowsNamedPipe::on_close(self)
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
        (self.handlers.on_handshake)(self.handlers.ctx, handshake_success, ssl_error);
        // Retry writes parked during the handshake; a TLS 1.2 client's completion sends nothing.
        if handshake_success && !self.is_shutdown() {
            (self.handlers.on_writable)(self.handlers.ctx);
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
                    bun_core::handle_oom(self.writer.enqueue(bytes));
                } else {
                    // write will enqueue the data if it cannot be sent
                    let _ = self.writer.write(self, bytes);
                }
            }
        }

        if !msg_more {
            if let Some(w) = self.wrapper.get() {
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
        if let Some(w) = self.wrapper.get() {
            let _ = w.flush(&mut &*self);
        }
        if !self.flags.get().disconnected() {
            let _ = self.writer.flush(self);
        }
    }

    pub(crate) fn on_timeout(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onTimeout");

        if self.vm.script_execution_status() != bun_jsc::ScriptExecutionStatus::Running {
            return;
        }

        (self.handlers.on_timeout)(self.handlers.ctx);
    }

    pub(crate) fn new(handlers: Handlers, vm: &'static VirtualMachine) -> WindowsNamedPipe {
        WindowsNamedPipe {
            vm,
            pipe: JsCell::new(None),
            wrapper: OnceCell::new(),
            root: Cell::new(core::ptr::null_mut()),
            handlers,
            // defaults:
            writer: StreamingWriter::default(),
            inflight_write_ref: Cell::new(None),
            ssl_error: JsCell::new(CertError::default()),
            connect_ref: Cell::new(None),
            event_loop_timer: OwnedTimer::init_paused(),
            current_timeout: Cell::new(0),
            flags: Cell::new(Flags::DISCONNECTED), // disconnected: bool = true is the only non-false default
        }
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
                if let Some(w) = self.wrapper.get() {
                    w.start(&mut &*self);
                }
            } else {
                // trigger onOpen
                self.on_open();
            }
        }
        self.flush();
    }

    pub(crate) fn get_accepted_by<D>(
        &self,
        server: &uv::Handle<uv::ListeningPipe, D>,
        ssl_ctx: Option<&boringssl::OwnedSslCtx>,
    ) -> bun_sys::Result<()> {
        let _keep_alive = self.keep_alive();
        self.update_flags(|f| f.set(Flags::DISCONNECTED, true));

        if let Some(tls) = ssl_ctx {
            self.update_flags(|f| f.set(Flags::IS_SSL, true));
            match SSLWrapper::init_with_ctx(tls, false) {
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
                if let Some(w) = self.wrapper.get() {
                    w.start(&mut &*self);
                }
            } else {
                // trigger onOpen
                self.on_open();
            }
        }
        bun_sys::Result::Ok(())
    }

    pub(crate) fn open(
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

        let _keep_alive = self.keep_alive();
        self.on_connect(uv::ReturnCode::ZERO);
        bun_sys::Result::Ok(())
    }

    pub(crate) fn connect(
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
        // SAFETY: `self` is in the heap allocation of its context, and drops the pipe.
        unsafe { pipe.set_owner(self.io_owner()) };
        self.pipe.set(Some(pipe));
        self.connect_ref.set(Some(self.keep_alive()));
        Ok(())
    }

    /// Set up the in-process SSL wrapper for `connect`/`open`. Prefers a prebuilt
    /// `SSL_CTX` so a memoised `tls.createSecureContext`
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
            match SSLWrapper::init_with_ctx(&ctx, true) {
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
        // SAFETY: `self` is in the heap allocation of its context.
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
        if let Some(w) = self.wrapper.get() {
            return i32::try_from(w.write_data(&mut &*self, data).unwrap_or(0)).expect("int cast");
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
        if let Some(w) = self.wrapper.get() {
            let _ = w.shutdown(&mut &*self, false);
        }
        self.writer.end(self);
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__shutdown")]
    pub(crate) fn shutdown(&self) {
        if let Some(w) = self.wrapper.get() {
            let _ = w.shutdown(&mut &*self, false);
        } else {
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
        if let Some(wrapper) = self.wrapper.get() {
            wrapper.shutdown_read();
        } else {
            self.read_stop();
        }
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__is_shutdown", no_catch)]
    pub(crate) fn is_shutdown(&self) -> bool {
        if let Some(wrapper) = self.wrapper.get() {
            return wrapper.is_shutdown();
        }

        self.flags.get().disconnected() || self.writer.is_done()
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__is_closed", no_catch)]
    pub(crate) fn is_closed(&self) -> bool {
        if let Some(wrapper) = self.wrapper.get() {
            return wrapper.is_closed();
        }
        self.flags.get().disconnected()
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__is_established", no_catch)]
    pub(crate) fn is_established(&self) -> bool {
        !self.is_closed()
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
        timer_all().update(self.event_loop_timer.timer_ref(), &next);
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__set_timeout")]
    pub(crate) fn set_timeout(&self, seconds: c_uint) {
        bun_output::scoped_log!(WindowsNamedPipe, "setTimeout({})", seconds);
        self.set_timeout_in_milliseconds(seconds * 1000);
    }

    /// Free internal resources, it can be called multiple times.
    // Idempotent helper invoked from on_close and `WindowsNamedPipeContext::deinit`.
    // Owned fields (writer, wrapper, ssl_error) free themselves via their own Drop impls; only
    // the side effects (timer cancel, read_stop, take()) remain explicit here.
    pub(super) fn release_resources(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "deinit");
        // clear the timer
        self.set_timeout(0);
        // After a TLS close_notify the pipe is still open.
        self.read_stop();
        self.writer.close_without_reporting(self);
        self.writer.discard_queued();
        if let Some(wrapper) = self.wrapper.get() {
            wrapper.stop();
        }
        self.ssl_error.set(CertError::default());
    }
}

// The other `WindowsNamedPipe__*` symbols are emitted by `#[uws_callback(export = …)]` above.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn WindowsNamedPipe__set_inline_reject(this: &WindowsNamedPipe) {
    if let Some(wrapper) = this.wrapper.get() {
        wrapper.set_inline_reject();
    }
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn WindowsNamedPipe__latest_session(
    this: &WindowsNamedPipe,
) -> Option<bun_boringssl_sys::OwnedSslSession> {
    this.wrapper.get()?.latest_session()
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn WindowsNamedPipe__ssl(this: &WindowsNamedPipe) -> Option<&boringssl::SSL> {
    this.wrapper.get()?.ssl()
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
        (self.handlers.on_error)(self.handlers.ctx, err);
        self.close();
    }

    fn on_close(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onClose");
        self.cancel_connect();
        if !self.flags.get().is_closed() {
            self.update_flags(|f| f.set(Flags::IS_CLOSED, true)); // only call onClose once
            (self.handlers.on_close)(self.handlers.ctx);
            self.release_resources();
        }
    }

    fn on_writable(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onWritable");
        // flush pending data
        self.flush();
        // call onWritable (will flush on demand)
        (self.handlers.on_writable)(self.handlers.ctx);
    }

    fn set_has_inflight_write(&self, value: bool) {
        self.inflight_write_ref
            .set(value.then(|| self.keep_alive()));
    }
}
