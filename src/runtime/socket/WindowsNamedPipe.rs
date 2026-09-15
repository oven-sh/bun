//! A socket-like interface over a Windows named pipe, so that a pipe path can
//! be connected to and listened on like a Unix domain socket path. The owner
//! supplies the same set of handlers a socket has (open, data, handshake,
//! timeout, error, close…); TLS goes through `SSLWrapper`, timeouts through
//! the VM's timer heap, and writes through a `StreamingWriter`.
//!
//! A named pipe cannot be polled for readiness the way a socket can, so it is
//! not a uSockets socket: reads and writes are overlapped operations on a
//! `bun_io::windows::Pipe`, which completes them through the same loop.

use core::cell::Cell;
use core::ffi::{c_uint, c_void};

use bun_boringssl_sys as boringssl;
use bun_core::timespec;
use bun_io::windows::{ConnectRequest, Pipe, ReadEvent};
use bun_io::{Source, StreamingWriter, WriteStatus};
use bun_jsc::JsCell;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_sys::{self, Fd};
use bun_uws::us_bun_verify_error_t;

use crate::socket::SSLConfig;
use crate::socket::ssl_wrapper::{self, SSLWrapper};
use crate::timer::{ElTimespec, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

bun_output::declare_scope!(WindowsNamedPipe, visible);

pub type CertError = crate::socket::upgraded_duplex::CertError;

type WrapperType = SSLWrapper<*mut WindowsNamedPipe>;

use crate::jsc_hooks::timer_all_mut as timer_all;

pub struct WindowsNamedPipe {
    pub(crate) wrapper: JsCell<Option<WrapperType>>,
    pub(crate) deferred_writer_close: Cell<bool>,
    pub(crate) root: Cell<*mut WindowsNamedPipe>,
    /// The connect in flight. Dropping it abandons the attempt: `on_connect`
    /// does not run.
    pub(crate) connect_req: JsCell<Option<ConnectRequest>>,
    /// The per-thread VM singleton outlives this struct (it is torn down only
    /// at thread exit, after every named pipe is closed), so `&'static` is the
    /// honest model here rather than a threaded lifetime.
    pub(crate) vm: &'static VirtualMachine,
    /// Typed enum mirror of `vm.event_loop()` for the io-layer FilePoll vtable
    /// (`bun_io::EventLoopHandle` wraps `*const EventLoopHandle`).
    pub event_loop_handle: bun_jsc::EventLoopHandle,

    /// Owns the open pipe (`writer.source`); reads go through it too.
    pub(crate) writer: JsCell<StreamingWriter<WindowsNamedPipe>>,

    pub(crate) ssl_error: JsCell<CertError>,
    pub(crate) handlers: Handlers,

    pub(crate) event_loop_timer: JsCell<EventLoopTimer>,
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
        const IS_SSL       = 1 << 3;
        const WRAPPER_BUSY = 1 << 4;
        const WRITER_BUSY  = 1 << 5;
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

pub struct Handlers {
    pub ctx: *mut c_void,
    pub(crate) ref_ctx: fn(*mut c_void),
    pub(crate) deref_ctx: fn(*mut c_void),
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
}

impl WindowsNamedPipe {
    #[inline]
    fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut flags = self.flags.get();
        f(&mut flags);
        self.flags.set(flags);
    }

    #[inline]
    fn wrapper_ref(&self) -> Option<&WrapperType> {
        self.wrapper.get().as_ref()
    }

    fn with_wrapper<R>(&self, f: impl FnOnce(&WrapperType) -> R) -> Option<R> {
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

    /// Holds a ref on the owning context until the returned guard drops.
    ///
    /// The context frees itself from a task it queues when [`on_close`] releases
    /// the connection's ref. A handler can close the socket and then spin the
    /// event loop before it returns (`expect().resolves` blocks on a promise
    /// that way), which runs that task. A callback that uses `self` after it
    /// dispatched to a handler holds this guard, so the free waits until the
    /// callback is done. The writer does the same around an in-flight write,
    /// and `connect`/`open` around the connect.
    ///
    /// Only for paths that cannot run after `on_close` released the
    /// connection's ref (reads stop and the wrapper goes away in
    /// `release_resources`): a ref taken at zero would queue the free twice.
    ///
    /// [`on_close`]: Self::on_close
    fn keep_alive(&self) -> impl Drop + '_ {
        self.r#ref();
        scopeguard::guard(self, |this| this.deref())
    }

    fn on_writable(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onWritable");
        // flush pending data
        self.flush();
        // call onWritable (will flush on demand)
        (self.handlers.on_writable)(self.handlers.ctx);
    }

    /// # Safety
    /// `this` is the live pipe that called `read_start`.
    unsafe fn on_read_event(this: *mut Self, event: ReadEvent<'_>) {
        // SAFETY: fn contract.
        let this = unsafe { &*this };
        match event {
            ReadEvent::Data(data) => this.on_read(data),
            ReadEvent::Eof => this.on_read_end(),
            ReadEvent::Err(err) => this.on_read_error(err),
        }
    }

    fn on_read(&self, data: &[u8]) {
        bun_output::scoped_log!(WindowsNamedPipe, "onRead ({})", data.len());
        let _keep_alive = self.keep_alive();

        self.reset_timeout();

        if self.with_wrapper(|w| w.receive_data(data)).is_none() {
            (self.handlers.on_data)(self.handlers.ctx, data);
        }
    }

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
            WriteStatus::Pending | WriteStatus::Drained => {}
            WriteStatus::EndOfFile => {
                // we send FIN so we close after this
                self.close_writer();
            }
        }
    }

    #[inline]
    fn root_ptr(&self) -> *mut WindowsNamedPipe {
        let p = self.root.get();
        debug_assert!(!p.is_null(), "WindowsNamedPipe root not recorded");
        p
    }

    fn close_writer(&self) {
        self.with_writer(|w| w.close());
    }

    fn with_writer<R>(&self, op: impl FnOnce(&mut StreamingWriter<Self>) -> R) -> R {
        let was_busy = self.flags.get().contains(Flags::WRITER_BUSY);
        self.update_flags(|f| f.insert(Flags::WRITER_BUSY));
        let r = self.writer.with_mut(op);
        if !was_busy {
            self.update_flags(|f| f.remove(Flags::WRITER_BUSY));
            if self.deferred_writer_close.replace(false) {
                self.on_close();
            }
        }
        r
    }

    fn on_read_end(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onReadEnd");
        let _keep_alive = self.keep_alive();
        // we received FIN but we dont allow half-closed connections right now
        (self.handlers.on_end)(self.handlers.ctx);
        self.close_writer();
    }

    fn on_read_error(&self, err: bun_sys::Error) {
        bun_output::scoped_log!(WindowsNamedPipe, "onReadError");
        let _keep_alive = self.keep_alive();
        self.on_error(err);
        self.close_writer();
    }

    fn on_error(&self, err: bun_sys::Error) {
        bun_output::scoped_log!(WindowsNamedPipe, "onError");
        let _keep_alive = self.keep_alive();
        (self.handlers.on_error)(self.handlers.ctx, err);
        self.close();
    }

    fn on_open(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onOpen");
        (self.handlers.on_open)(self.handlers.ctx);
    }

    fn on_data(&self, decoded_data: &[u8]) {
        bun_output::scoped_log!(WindowsNamedPipe, "onData ({})", decoded_data.len());
        (self.handlers.on_data)(self.handlers.ctx, decoded_data);
    }

    fn on_session(&self, session: &[u8]) {
        bun_output::scoped_log!(WindowsNamedPipe, "onSession ({})", session.len());
        (self.handlers.on_session)(self.handlers.ctx, session);
    }

    fn on_keylog(&self, line: &[u8]) {
        bun_output::scoped_log!(WindowsNamedPipe, "onKeylog ({})", line.len());
        (self.handlers.on_keylog)(self.handlers.ctx, line);
    }

    // ── SSLWrapper trampolines ───────────────────────────────────────────────
    // `ssl_wrapper::Handlers<*mut Self>` carries `fn(*mut Self, ..)` slots.
    // SAFETY (all): `this` is the `ctx` set in `wrapper_handlers`; the engine
    // only fires handlers while `self` (its owner) is alive.
    fn ssl_on_open(this: *mut Self) {
        // SAFETY: see block note above.
        unsafe { &*this }.on_open()
    }
    fn ssl_on_handshake(this: *mut Self, ok: bool, e: us_bun_verify_error_t) {
        // SAFETY: see block note above.
        unsafe { &*this }.on_handshake(ok, e)
    }
    fn ssl_on_data(this: *mut Self, d: &[u8]) {
        // SAFETY: see block note above.
        unsafe { &*this }.on_data(d)
    }
    fn ssl_on_session(this: *mut Self, d: &[u8]) {
        // SAFETY: see block note above.
        unsafe { &*this }.on_session(d)
    }
    fn ssl_on_keylog(this: *mut Self, d: &[u8]) {
        // SAFETY: see block note above.
        unsafe { &*this }.on_keylog(d)
    }
    fn ssl_on_close(this: *mut Self) {
        // SAFETY: see block note above.
        unsafe { &*this }.on_close()
    }
    fn ssl_write(this: *mut Self, d: &[u8]) {
        // SAFETY: see block note above.
        unsafe { &*this }.internal_write(d)
    }

    fn wrapper_handlers(&self) -> ssl_wrapper::Handlers<*mut WindowsNamedPipe> {
        ssl_wrapper::Handlers {
            ctx: self.root_ptr(),
            on_open: Self::ssl_on_open,
            on_handshake: Self::ssl_on_handshake,
            on_data: Self::ssl_on_data,
            on_close: Self::ssl_on_close,
            write: Self::ssl_write,
            on_session: Some(Self::ssl_on_session),
            on_keylog: Some(Self::ssl_on_keylog),
        }
    }

    fn on_handshake(&self, handshake_success: bool, ssl_error: us_bun_verify_error_t) {
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

    fn on_close(&self) {
        if self.flags.get().contains(Flags::WRITER_BUSY) {
            self.deferred_writer_close.set(true);
            return;
        }
        bun_output::scoped_log!(WindowsNamedPipe, "onClose");
        if !self.flags.get().is_closed() {
            self.update_flags(|f| f.set(Flags::IS_CLOSED, true)); // only call onClose once
            (self.handlers.on_close)(self.handlers.ctx);
            self.release_resources();
        }
    }

    fn call_write_or_end(&self, data: Option<&[u8]>, msg_more: bool) {
        if let Some(bytes) = data {
            if !bytes.is_empty() {
                if self.flags.get().disconnected() {
                    // enqueue to be sent after connecting
                    self.writer
                        .with_mut(|w| bun_core::handle_oom(w.outgoing.write(bytes)));
                } else {
                    // write will enqueue the data if it cannot be sent
                    let _ = self.writer.with_mut(|w| w.write(bytes));
                }
            }
        }

        if !msg_more {
            let _ = self.with_wrapper(|w| {
                let _ = w.shutdown(false);
            });
            self.with_writer(|w| w.end());
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

    /// The open pipe; `None` before the connect completes and once closed.
    fn with_pipe<R>(&self, f: impl FnOnce(&mut Pipe) -> R) -> Option<R> {
        self.writer.with_mut(|w| match w.source.as_mut() {
            Some(Source::Pipe(pipe)) => Some(f(pipe)),
            _ => None,
        })
    }

    fn read_start(&self) -> Option<bun_sys::Result<()>> {
        let this: *mut Self = self.root_ptr();
        self.with_pipe(|pipe| pipe.read_start(this, Self::on_read_event))
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__resume_stream")]
    pub fn resume_stream(&self) -> bool {
        matches!(self.read_start(), Some(Ok(())))
    }

    /// A read the kernel already has is left to finish; what it produces is
    /// delivered after `resume_stream`.
    #[bun_uws::uws_callback(export = "WindowsNamedPipe__pause_stream")]
    pub fn pause_stream(&self) -> bool {
        self.with_pipe(Pipe::read_stop).is_some()
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__flush")]
    pub fn flush(&self) {
        let _ = self.with_wrapper(|w| {
            let _ = w.flush();
        });
        if !self.flags.get().disconnected() {
            let _ = self.writer.with_mut(|w| w.flush());
        }
    }

    pub(crate) fn on_timeout(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onTimeout");

        let has_been_cleared = self.event_loop_timer.get().state == EventLoopTimerState::CANCELLED
            || self.vm.script_execution_status() != bun_jsc::ScriptExecutionStatus::Running;

        self.event_loop_timer.with_mut(|t| {
            t.state = EventLoopTimerState::FIRED;
            t.heap = Default::default();
        });

        if has_been_cleared {
            return;
        }

        (self.handlers.on_timeout)(self.handlers.ctx);
    }

    pub(crate) fn init(handlers: Handlers, vm: &'static VirtualMachine) -> WindowsNamedPipe {
        WindowsNamedPipe {
            vm,
            event_loop_handle: bun_jsc::EventLoopHandle::init(vm.event_loop().cast::<()>()),
            connect_req: JsCell::new(None),
            wrapper: JsCell::new(None),
            deferred_writer_close: Cell::new(false),
            root: Cell::new(core::ptr::null_mut()),
            handlers,
            // defaults:
            writer: JsCell::new(StreamingWriter::default()),
            ssl_error: JsCell::new(CertError::default()),
            event_loop_timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::WindowsNamedPipe,
            )),
            current_timeout: Cell::new(0),
            flags: Cell::new(Flags::DISCONNECTED), // disconnected: bool = true is the only non-false default
        }
    }

    pub(crate) fn r#ref(&self) {
        (self.handlers.ref_ctx)(self.handlers.ctx);
    }

    pub fn deref(&self) {
        (self.handlers.deref_ctx)(self.handlers.ctx);
    }

    /// # Safety
    /// `this` is the live pipe that called `Pipe::connect`, kept alive by the
    /// ref `connect` took.
    unsafe fn on_connect(this: *mut Self, result: bun_sys::Result<Pipe>) {
        // SAFETY: fn contract.
        let this = unsafe { &*this };
        this.connect_req.set(None);
        match result {
            Ok(pipe) => this.on_connected(pipe),
            Err(err) => this.on_connect_error(err),
        }
        this.deref();
    }

    /// No pipe was opened, so there is nothing to close: the owner hears the
    /// error and then the close, where it (`handlers.on_close`) releases its
    /// ref.
    fn on_connect_error(&self, err: bun_sys::Error) {
        let _keep_alive = self.keep_alive();
        (self.handlers.on_error)(self.handlers.ctx, err);
        self.on_close();
    }

    fn on_connected(&self, pipe: Pipe) {
        self.update_flags(|f| f.set(Flags::DISCONNECTED, false));
        if self.start(pipe) {
            if self.is_tls() {
                // trigger onOpen and start the handshake
                let _ = self.with_wrapper(|w| w.start());
            } else {
                // trigger onOpen
                self.on_open();
            }
        }
        self.flush();
    }

    /// Take over a client the listening pipe accepted. On `Err` the pipe is
    /// closed and no handler has run.
    pub(crate) fn accepted(
        &self,
        pipe: Pipe,
        ssl_ctx: Option<boringssl::OwnedSslCtx>,
    ) -> bun_sys::Result<()> {
        let _keep_alive = self.keep_alive();

        if let Some(tls) = ssl_ctx {
            self.update_flags(|f| f.set(Flags::IS_SSL, true));
            match WrapperType::init_with_ctx(tls, false, self.wrapper_handlers()) {
                Ok(w) => self.wrapper.set(Some(w)),
                Err(_) => {
                    return bun_sys::Result::Err(bun_sys::Error {
                        errno: bun_sys::E::EPIPE as _,
                        syscall: bun_sys::Tag::connect,
                        ..Default::default()
                    });
                }
            }
        }

        self.update_flags(|f| f.set(Flags::DISCONNECTED, false));
        if self.start(pipe) {
            if self.is_tls() {
                // trigger onOpen and start the handshake
                let _ = self.with_wrapper(|w| w.start());
            } else {
                // trigger onOpen
                self.on_open();
            }
        }
        bun_sys::Result::Ok(())
    }

    /// Adopt an open pipe end. `created_here` says whose it is: the overlapped
    /// end `Bun.spawn` made for a child's stdio and nothing has opened since, or
    /// one somebody else opened. `fd` is closed with the socket; on `Err` it is
    /// still the caller's.
    pub(crate) fn open(
        &self,
        fd: Fd,
        created_here: bool,
        ssl_options: Option<SSLConfig>,
        owned_ctx: Option<boringssl::OwnedSslCtx>,
    ) -> bun_sys::Result<()> {
        if let Some(result) = self.init_tls_wrapper(ssl_options, owned_ctx) {
            result?;
        }
        let loop_ = self.vm.uws_loop();
        let pipe = if created_here {
            Pipe::open_owned(loop_, fd, true)?
        } else {
            Pipe::open_foreign(loop_, fd, true)?
        };

        let _keep_alive = self.keep_alive();
        self.on_connected(pipe);
        bun_sys::Result::Ok(())
    }

    /// The outcome, failures included, is reported from the loop.
    pub(crate) fn connect(
        &self,
        path: &[u8],
        ssl_options: Option<SSLConfig>,
        owned_ctx: Option<boringssl::OwnedSslCtx>,
    ) -> bun_sys::Result<()> {
        // A trailing NUL is a terminator; any other would truncate the name.
        let path = path.strip_suffix(&[0]).unwrap_or(path);
        if bun_core::strings::contains_char(path, 0) {
            return Err(bun_sys::Error::from_code(
                bun_sys::E::EINVAL,
                bun_sys::Tag::connect,
            ));
        }
        if let Some(result) = self.init_tls_wrapper(ssl_options, owned_ctx) {
            result?;
        }
        // The loop is kept alive until `on_connect`.
        let request = Pipe::connect(self.vm.uws_loop(), path, self.root_ptr(), Self::on_connect)?;
        self.connect_req.set(Some(request));
        // Released by `on_connect`.
        self.r#ref();
        Ok(())
    }

    /// Set up the in-process SSL wrapper for `connect`/`open`. Prefers a prebuilt
    /// `SSL_CTX` (moved into `wrapper`) so a memoised `tls.createSecureContext`
    /// reaches this path with its CA bundle intact; `[buntls]` returns
    /// `{secureContext}` and does not spread `{ca,cert,key}`, so the
    /// `SSLConfig` fallback alone would build a CTX with an empty trust store
    /// and fail `DEPTH_ZERO_SELF_SIGNED_CERT`.
    /// Returns `None` when neither input requested TLS.
    fn init_tls_wrapper(
        &self,
        ssl_options: Option<SSLConfig>,
        owned_ctx: Option<boringssl::OwnedSslCtx>,
    ) -> Option<bun_sys::Result<()>> {
        if let Some(ctx) = owned_ctx {
            self.update_flags(|f| f.set(Flags::IS_SSL, true));
            match WrapperType::init_with_ctx(ctx, true, self.wrapper_handlers()) {
                Ok(w) => self.wrapper.set(Some(w)),
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
            match ssl_wrapper::init(&tls, true, self.wrapper_handlers()) {
                Ok(w) => self.wrapper.set(Some(w)),
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

    fn start(&self, pipe: Pipe) -> bool {
        // Reading does not hold the loop; the JS socket's `poll_ref` does.
        pipe.unref();
        let this: *mut Self = self.root_ptr();
        self.writer.with_mut(|w| {
            w.set_parent(this);
            w.start_with_source(Source::Pipe(pipe));
        });
        if let Some(bun_sys::Result::Err(err)) = self.read_start() {
            self.on_error(err);
            return false;
        }
        true
    }

    pub(crate) fn is_tls(&self) -> bool {
        self.flags.get().is_ssl()
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__encode_and_write")]
    pub fn encode_and_write(&self, data: &[u8]) -> i32 {
        bun_output::scoped_log!(WindowsNamedPipe, "encodeAndWrite (len: {})", data.len());
        if let Some(r) = self.with_wrapper(|w| w.write_data(data)) {
            return i32::try_from(r.unwrap_or(0)).expect("int cast");
        }
        self.internal_write(data);
        i32::try_from(data.len()).expect("int cast")
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__raw_write")]
    pub fn raw_write(&self, encoded_data: &[u8]) -> i32 {
        self.internal_write(encoded_data);
        i32::try_from(encoded_data.len()).expect("int cast")
    }

    /// A connect still in flight is abandoned and fails the way a cancelled
    /// one does; its callback will not run.
    #[bun_uws::uws_callback(export = "WindowsNamedPipe__close")]
    pub fn close(&self) {
        if self.connect_req.replace(None).is_some() {
            self.on_connect_error(bun_sys::Error::from_code(
                bun_sys::E::ECANCELED,
                bun_sys::Tag::connect,
            ));
            self.deref();
            return;
        }
        let _ = self.with_wrapper(|w| {
            let _ = w.shutdown(false);
        });
        self.with_writer(|w| w.end());
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__shutdown")]
    pub fn shutdown(&self) {
        let handled = self.with_wrapper(|w| {
            let _ = w.shutdown(false);
        });
        if handled.is_none() {
            // Plain (non-TLS) named pipe: half-close the write side so the peer
            // observes EOF. Without this, Socket.prototype.end() over a Windows
            // named pipe (endNT → shutdown()) never signals the peer, and an
            // allowHalfOpen peer waiting on 'end' hangs. `writer.end()` is
            // idempotent and mirrors `close`'s unconditional writer teardown.
            self.with_writer(|w| w.end());
        }
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__shutdown_read")]
    pub fn shutdown_read(&self) {
        if let Some(wrapper) = self.wrapper_ref() {
            wrapper.shutdown_read();
        } else {
            let _ = self.with_pipe(Pipe::read_stop);
        }
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__is_shutdown", no_catch)]
    pub fn is_shutdown(&self) -> bool {
        if let Some(wrapper) = self.wrapper_ref() {
            return wrapper.is_shutdown();
        }

        self.flags.get().disconnected() || self.writer.get().is_done
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__is_closed", no_catch)]
    pub fn is_closed(&self) -> bool {
        if let Some(wrapper) = self.wrapper_ref() {
            return wrapper.is_closed();
        }
        self.flags.get().disconnected()
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__is_established", no_catch)]
    pub fn is_established(&self) -> bool {
        !self.is_closed()
    }

    pub(crate) fn ssl(&self) -> Option<*mut boringssl::SSL> {
        self.wrapper_ref()
            .and_then(|w| w.ssl.get())
            .map(|p| p.as_ptr())
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__ssl_error", no_catch)]
    pub fn ssl_error(&self) -> us_bun_verify_error_t {
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
        if self.event_loop_timer.get().state == EventLoopTimerState::ACTIVE {
            timer_all().remove(self.event_loop_timer.as_ptr());
        }
        self.current_timeout.set(ms);

        // if the interval is 0 means that we stop the timer
        if ms == 0 {
            return;
        }

        // reschedule the timer
        // `EventLoopTimer.next` is the lower-tier `ElTimespec`;
        // bridge from `bun_core::Timespec`.
        let next = timespec::ms_from_now(bun_core::TimespecMockMode::ForceRealTime, ms as i64);
        self.event_loop_timer.with_mut(|t| {
            t.next = ElTimespec {
                sec: next.sec,
                nsec: next.nsec,
            };
        });
        timer_all().insert(
            core::ptr::addr_of!(self.event_loop_timer)
                .cast::<bun_event_loop::EventLoopTimer::EventLoopTimer>()
                .cast_mut(),
        );
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__set_timeout")]
    pub fn set_timeout(&self, seconds: c_uint) {
        bun_output::scoped_log!(WindowsNamedPipe, "setTimeout({})", seconds);
        self.set_timeout_in_milliseconds(seconds * 1000);
    }

    /// Free internal resources, it can be called multiple times.
    fn release_resources(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "deinit");
        // clear the timer
        self.set_timeout(0);
        // A TLS close_notify gets here (`ssl_on_close`) with the pipe still
        // open. `close`, not `close_without_reporting`: a write still in
        // flight has to report back for the writer to release the ref it took
        // for it. The `on_close` this reports is a no-op by now (`IS_CLOSED`).
        self.writer.with_mut(|w| {
            w.close();
            w.outgoing = Default::default();
        });
        if !self.flags.get().contains(Flags::WRAPPER_BUSY) {
            self.wrapper.set(None);
        }
        self.ssl_error.set(CertError::default());
    }
}

impl Drop for WindowsNamedPipe {
    fn drop(&mut self) {
        // Everything else was released by `on_close`, or never existed: the
        // owner's last ref goes away either there or before a pipe was opened.
        self.set_timeout(0);
    }
}

// Hand-written `ssl` shim for the `bun_uws` cycle-break extern — the safe
// method returns `Option<*mut SSL>` while the C ABI flattens to a nullable
// raw pointer. All other `WindowsNamedPipe__*` symbols are emitted by
// `#[uws_callback(export = …)]` on the inherent methods above.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn WindowsNamedPipe__ssl(this: *const c_void) -> *mut boringssl::SSL {
    // SAFETY: `this` is a live `*const WindowsNamedPipe` from the bun_uws opaque handle.
    unsafe {
        (*this.cast::<WindowsNamedPipe>())
            .ssl()
            .unwrap_or(core::ptr::null_mut())
    }
}

// This module is Windows-only; `poll_tag` and `event_loop` feed the macro's
// POSIX impl alone.
bun_io::impl_streaming_writer_parent! {
    WindowsNamedPipe;
    poll_tag   = bun_io::posix_event_loop::poll_tag::NULL,
    borrow     = shared,
    on_write   = on_write,
    on_error   = on_error,
    on_ready   = on_writable,
    on_close   = on_close,
    event_loop = |this| (*this).event_loop_handle.as_event_loop_ctx(),
    uws_loop   = |this| (*this).vm.uws_loop(),
    ref_       = |this| (&*this).r#ref(),
    deref      = |this| (&*this).deref(),
}
