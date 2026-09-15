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
#[cfg(windows)]
use core::ptr::NonNull;

use bun_boringssl_sys as boringssl;
#[cfg(windows)]
use bun_collections::ByteVecExt;
use bun_core::timespec;
#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
use bun_io::{StreamingWriter, WriteStatus};
use bun_jsc::JsCell;
use bun_jsc::virtual_machine::VirtualMachine;
#[cfg(windows)]
use bun_libuv_sys::{UvHandle as _, UvStream as _};
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
use bun_sys::{self, Fd};
use bun_uws::us_bun_verify_error_t;

use crate::socket::SSLConfig;
use crate::socket::ssl_wrapper::{self, SSLWrapper};
#[cfg(windows)]
use crate::timer::EventLoopTimerTag;
use crate::timer::{ElTimespec, EventLoopTimer, EventLoopTimerState};

bun_output::declare_scope!(WindowsNamedPipe, visible);

pub type CertError = crate::socket::upgraded_duplex::CertError;

type WrapperType = SSLWrapper<*mut WindowsNamedPipe>;

use crate::jsc_hooks::timer_all_mut as timer_all;

pub struct WindowsNamedPipe {
    pub(crate) wrapper: JsCell<Option<WrapperType>>,
    pub(crate) deferred_writer_close: Cell<bool>,
    pub(crate) root: Cell<*mut WindowsNamedPipe>,
    /// Non-owning alias of the heap `uv::Pipe`. The owning
    /// `Box<uv::Pipe>` is leaked in [`from`] and adopted by
    /// `self.writer.source` (`Source::Pipe`) inside [`start`]; this field only
    /// ever observes/null-checks the handle, never frees it. Cleared by
    /// [`Self::on_close`] before the writer's async close frees the Box.
    #[cfg(windows)]
    pub(crate) pipe: Cell<Option<NonNull<uv::Pipe>>>, // any duplex
    #[cfg(not(windows))]
    pub pipe: (),
    /// The per-thread VM singleton outlives this struct (it is torn down only
    /// at thread exit, after every named pipe is closed), so `&'static` is the
    /// honest model here rather than a threaded lifetime.
    pub(crate) vm: &'static VirtualMachine,
    /// Typed enum mirror of `vm.event_loop()` for the io-layer FilePoll vtable
    /// (`bun_io::EventLoopHandle` wraps `*const EventLoopHandle`).
    pub event_loop_handle: bun_jsc::EventLoopHandle,

    pub(crate) writer: JsCell<StreamingWriter<WindowsNamedPipe>>,

    pub(crate) incoming: JsCell<Vec<u8>>, // Maybe we should use IPCBuffer here as well
    pub(crate) ssl_error: JsCell<CertError>,
    pub(crate) handlers: Handlers,
    #[cfg(windows)]
    pub(crate) connect_req: JsCell<uv::uv_connect_t>,
    #[cfg(not(windows))]
    pub connect_req: (),

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
        const IS_CLIENT    = 1 << 2;
        const IS_SSL       = 1 << 3;
        /// Rust-only bookkeeping: set once `start_with_pipe` adopts the
        /// `Box<uv::Pipe>` leaked in [`from`]. Lets `Drop` reclaim the orphan
        /// allocation on early-error paths (before adoption) without risking a
        /// double-free once the writer owns it.
        const PIPE_ADOPTED = 1 << 4;
        const WRAPPER_BUSY = 1 << 5;
        const WRITER_BUSY  = 1 << 6;
        // _: u2 padding
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

    #[cfg(windows)]
    #[inline]
    fn uv_pipe(&self) -> Option<*mut uv::Pipe> {
        self.pipe.get().map(NonNull::as_ptr)
    }

    /// Reclaim the leaked `Box<uv::Pipe>` on an early-error path **before**
    /// [`start`] hands it to `self.writer.source` via `start_with_pipe`.
    ///
    /// [`from`] `Box::leak`s the allocation and records only a non-owning
    /// `NonNull` in `self.pipe`; until adoption the writer's `Drop`
    /// (`close_without_reporting`) is a no-op (`source == None`), so any
    /// `connect`/`open`/`get_accepted_by` early return would leak the box and —
    /// if `uv_pipe_init` had already run — leave the handle in the libuv
    /// `handle_queue` with no `uv_close` ever scheduled (loop never drains).
    /// `close_and_destroy` covers both states via its `loop_.is_null()` branch.
    ///
    /// MUST NOT be called once `start_with_pipe` has adopted the allocation
    /// (would double-free against `writer.source`'s `Box`).
    #[cfg(windows)]
    fn discard_unadopted_pipe(&self) {
        debug_assert!(
            self.writer.get().source.is_none(),
            "pipe already adopted by writer.source; discard would double-free"
        );
        if let Some(pipe) = self.pipe.take() {
            // SAFETY: `pipe` is the `NonNull` recorded from `Box::leak` in
            // `from()` and not yet re-materialised (asserted above);
            // `close_and_destroy` reclaims via `Box::from_raw` either
            // immediately (never-init'd, `loop_ == null`) or in the `uv_close`
            // callback (init'd). Ownership transfers here exactly once.
            unsafe { uv::Pipe::close_and_destroy(pipe.as_ptr()) };
        }
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

    #[cfg(windows)]
    fn on_read(&self, nread: usize) {
        bun_output::scoped_log!(WindowsNamedPipe, "onRead ({})", nread);
        let _keep_alive = self.keep_alive();
        // SAFETY: `nread` bytes written by libuv into on_read_alloc's slice.
        self.incoming
            .with_mut(|incoming| unsafe { incoming.uv_commit(nread) });

        self.reset_timeout();

        let mut data = self.incoming.replace(Vec::new());

        if self
            .with_wrapper(|w| w.receive_data(data.as_slice()))
            .is_none()
        {
            (self.handlers.on_data)(self.handlers.ctx, data.as_slice());
        }
        data.clear();
        self.incoming.set(data);
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
            WriteStatus::Pending => {}
            WriteStatus::Drained => {
                // unref after sending all data
                #[cfg(windows)]
                self.writer.with_mut(|w| {
                    if let Some(source) = w.source.as_mut() {
                        // `Source` is an enum;
                        // `unref()` matches the active variant (always `Pipe` here
                        // via `start_with_pipe`).
                        source.unref();
                    }
                });
            }
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

    #[cfg(windows)]
    fn on_read_error(&self, err: bun_sys::E) {
        bun_output::scoped_log!(WindowsNamedPipe, "onReadError");
        let _keep_alive = self.keep_alive();
        // `E::EOF` only exists in the Windows errno table (libuv UV_EOF mapping);
        // this type is Windows-only at runtime so the comparison is gated.
        #[cfg(windows)]
        if err == bun_sys::E::EOF {
            // we received FIN but we dont allow half-closed connections right now
            (self.handlers.on_end)(self.handlers.ctx);
            self.close_writer();
            return;
        }
        self.on_error(bun_sys::Error::from_code(err, bun_sys::Tag::read));
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

    #[cfg(windows)]
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
        #[cfg(windows)]
        self.pipe.set(None);
        if !self.flags.get().is_closed() {
            self.update_flags(|f| f.set(Flags::IS_CLOSED, true)); // only call onClose once
            (self.handlers.on_close)(self.handlers.ctx);
            self.release_resources();
        }
    }

    fn call_write_or_end(&self, data: Option<&[u8]>, msg_more: bool) {
        if let Some(bytes) = data {
            if !bytes.is_empty() {
                // ref because we have pending data
                #[cfg(windows)]
                self.writer.with_mut(|w| {
                    if let Some(source) = w.source.as_mut() {
                        // See `on_write` for the active-variant note.
                        source.ref_();
                    }
                });
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

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__resume_stream")]
    pub fn resume_stream(&self) -> bool {
        #[cfg(windows)]
        {
            let Some(stream) = self.writer.with_mut(|w| w.get_stream()) else {
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
        #[cfg(not(windows))]
        {
            false
        }
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__pause_stream")]
    pub fn pause_stream(&self) -> bool {
        #[cfg(windows)]
        {
            let Some(pipe) = self.uv_pipe() else {
                return false;
            };
            // SAFETY: live libuv handle alias; see `pipe`.
            unsafe { (*pipe).read_stop() };
            true
        }
        #[cfg(not(windows))]
        {
            false
        }
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

    #[cfg(windows)]
    pub(crate) fn from(
        pipe: Box<uv::Pipe>,
        handlers: Handlers,
        vm: &'static VirtualMachine,
    ) -> WindowsNamedPipe {
        // The whole fn is `#[cfg(windows)]`-gated so POSIX builds never see
        // `uv::Pipe`.
        WindowsNamedPipe {
            vm,
            event_loop_handle: bun_jsc::EventLoopHandle::init(vm.event_loop().cast::<()>()),
            // Leak the `Box` and keep only a non-owning `NonNull` alias.
            // Ownership of the allocation is later transferred to
            // `self.writer.source` via `start_with_pipe` in `start()`, which
            // re-materialises the `Box` and is responsible for freeing it.
            pipe: Cell::new(Some(NonNull::from(Box::leak(pipe)))),
            wrapper: JsCell::new(None),
            deferred_writer_close: Cell::new(false),
            root: Cell::new(core::ptr::null_mut()),
            handlers,
            // defaults:
            writer: JsCell::new(StreamingWriter::default()),
            incoming: JsCell::new(Vec::new()),
            ssl_error: JsCell::new(CertError::default()),
            connect_req: JsCell::new(bun_core::ffi::zeroed::<uv::uv_connect_t>()),
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

    /// `extern "C"` trampoline matching `uv_connect_cb` (`Pipe::connect`'s
    /// `on_connect` parameter). Recovers `*mut Self` from `req->data` (set in
    /// `connect()`) and forwards to the safe `&self` body. Only ever invoked
    /// by libuv (coerces to the `uv_connect_cb` fn-pointer type at the
    /// `Pipe::connect` call site).
    #[cfg(windows)]
    extern "C" fn uv_on_connect(req: *mut uv::uv_connect_t, status: uv::ReturnCode) {
        // SAFETY: `req` is `self.connect_req`, whose `data` was set to
        // `self as *mut Self` in `connect`; the owning struct is kept alive by
        // the `r#ref()` taken there until this callback runs.
        let this = unsafe { (*req).data.cast::<Self>() };
        // SAFETY: as above.
        unsafe { &*this }.on_connect(status);
    }

    #[cfg(windows)]
    fn on_connect(&self, status: uv::ReturnCode) {
        if let Some(pipe) = self.uv_pipe() {
            // SAFETY: live libuv handle alias; see `pipe`.
            unsafe { (*pipe).unref() };
        }

        if let Some(err) = status.to_error(bun_sys::Tag::connect) {
            // The writer never adopted the pipe (`start_with_pipe` only runs on
            // the success branch below), so `on_error → close → writer.end()`
            // has no source to close: it neither frees the pipe nor reports
            // `on_close`. Do both here. `discard_unadopted_pipe` schedules the
            // `uv_close` that frees the `Box`, like the synchronous early-error
            // paths in `connect`/`open`/`get_accepted_by`, and `on_close` is
            // what makes the owner (`handlers.on_close`) release its ref.
            self.discard_unadopted_pipe();
            self.on_error(err);
            self.on_close();
            self.deref();
            return;
        }

        self.update_flags(|f| f.set(Flags::DISCONNECTED, false));
        if self.start(true) {
            if self.is_tls() {
                // trigger onOpen and start the handshake
                let _ = self.with_wrapper(|w| w.start());
            } else {
                // trigger onOpen
                self.on_open();
            }
        }
        self.flush();
        self.deref();
    }

    #[cfg(windows)]
    pub(crate) fn get_accepted_by(
        &self,
        server: &mut uv::Pipe,
        ssl_ctx: Option<&boringssl::OwnedSslCtx>,
    ) -> bun_sys::Result<()> {
        #[cfg(windows)]
        debug_assert!(self.pipe.get().is_some());
        let _keep_alive = self.keep_alive();
        self.update_flags(|f| f.set(Flags::DISCONNECTED, true));

        if let Some(tls) = ssl_ctx {
            self.update_flags(|f| f.set(Flags::IS_SSL, true));
            match WrapperType::init_with_ctx(tls.clone(), false, self.wrapper_handlers()) {
                Ok(w) => self.wrapper.set(Some(w)),
                Err(_) => {
                    self.discard_unadopted_pipe();
                    return bun_sys::Result::Err(bun_sys::Error {
                        errno: bun_sys::E::EPIPE as _,
                        syscall: bun_sys::Tag::connect,
                        ..Default::default()
                    });
                }
            }
        }
        #[cfg(windows)]
        {
            let uv_loop = self.vm.uv_loop();
            let pipe = self.uv_pipe().unwrap();
            // SAFETY: live libuv handle alias; see `pipe`.
            if let Err(e) = unsafe { (*pipe).init(uv_loop, false) }.to_result(bun_sys::Tag::pipe) {
                self.discard_unadopted_pipe();
                return Err(e);
            }
            // Until the writer adopts it (start_with_pipe), a thread teardown closes
            // this pipe through us; afterwards the writer re-records itself as owner.
            uv::open_handles::set_owner(
                pipe.cast(),
                self.root_ptr().cast(),
                Some(Self::stop_for_vm_teardown),
            );

            // SAFETY: as above.
            if let Err(e) = server
                .accept(unsafe { &mut *pipe })
                .to_result(bun_sys::Tag::accept)
            {
                self.discard_unadopted_pipe();
                return Err(e);
            }
        }

        self.update_flags(|f| f.set(Flags::DISCONNECTED, false));
        if self.start(false) {
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

    #[cfg(windows)]
    pub(crate) fn open(
        &self,
        fd: Fd,
        ssl_options: Option<SSLConfig>,
        owned_ctx: Option<boringssl::OwnedSslCtx>,
    ) -> bun_sys::Result<()> {
        debug_assert!(self.pipe.get().is_some());
        self.update_flags(|f| f.set(Flags::DISCONNECTED, true));

        if let Some(result) = self.init_tls_wrapper(ssl_options, owned_ctx) {
            if result.is_err() {
                self.discard_unadopted_pipe();
                return result;
            }
        }
        let uv_loop = self.vm.uv_loop();
        let pipe = self.uv_pipe().unwrap();
        // SAFETY: live libuv handle alias; see `pipe`.
        if let Err(e) = unsafe { (*pipe).init(uv_loop, false) }.to_result(bun_sys::Tag::pipe) {
            self.discard_unadopted_pipe();
            return Err(e);
        }
        // Until the writer adopts it (start_with_pipe), a thread teardown closes
        // this pipe through us; afterwards the writer re-records itself as owner.
        uv::open_handles::set_owner(
            pipe.cast(),
            self.root_ptr().cast(),
            Some(Self::stop_for_vm_teardown),
        );

        // SAFETY: as above.
        if let Err(e) = unsafe { (*pipe).open_for_reading(fd.uv()) }.to_result(bun_sys::Tag::open) {
            self.discard_unadopted_pipe();
            return Err(e);
        }

        self.r#ref();
        self.on_connect(uv::ReturnCode::ZERO);
        bun_sys::Result::Ok(())
    }

    #[cfg(windows)]
    pub(crate) fn connect(
        &self,
        path: &[u8],
        ssl_options: Option<SSLConfig>,
        owned_ctx: Option<boringssl::OwnedSslCtx>,
    ) -> bun_sys::Result<()> {
        debug_assert!(self.pipe.get().is_some());
        self.update_flags(|f| f.set(Flags::DISCONNECTED, true));
        let pipe = self.uv_pipe().unwrap();
        // ref because we are connecting
        // SAFETY: live libuv handle alias; see `pipe`.
        unsafe { (*pipe).ref_() };

        if let Some(result) = self.init_tls_wrapper(ssl_options, owned_ctx) {
            if result.is_err() {
                self.discard_unadopted_pipe();
                return result;
            }
        }
        let uv_loop = self.vm.uv_loop();
        // SAFETY: as above.
        if let Err(e) = unsafe { (*pipe).init(uv_loop, false) }.to_result(bun_sys::Tag::pipe) {
            self.discard_unadopted_pipe();
            return Err(e);
        }
        // Until the writer adopts it (start_with_pipe), a thread teardown closes
        // this pipe through us; afterwards the writer re-records itself as owner.
        uv::open_handles::set_owner(
            pipe.cast(),
            self.root_ptr().cast(),
            Some(Self::stop_for_vm_teardown),
        );

        let ctx: *mut Self = self.root_ptr();
        let req: *mut uv::uv_connect_t = self.connect_req.as_ptr();
        // SAFETY: `req` is our own cell storage; libuv stashes `req`/`ctx` until
        // the connect callback fires (this struct outlives that).
        unsafe { (*req).data = ctx.cast::<c_void>() };
        // SAFETY: `pipe` is live (see above) and `req`/`pipe` are disjoint.
        if let Some(err) =
            unsafe { (*pipe).connect(&mut *req, path, ctx.cast::<c_void>(), Self::uv_on_connect) }
                .to_error(bun_sys::Tag::connect2)
        {
            self.discard_unadopted_pipe();
            return Err(err);
        }
        self.r#ref();
        Ok(())
    }

    #[cfg(not(windows))]
    pub(crate) fn open(
        &self,
        _fd: Fd,
        _ssl_options: Option<SSLConfig>,
        _owned_ctx: Option<boringssl::OwnedSslCtx>,
    ) -> bun_sys::Result<()> {
        // Unreachable on POSIX — `WindowsNamedPipeContext` is aliased to `()` there;
        // this stub exists only so the module type-checks across platforms.
        unreachable!("WindowsNamedPipe::open is windows-only")
    }

    #[cfg(not(windows))]
    pub(crate) fn connect(
        &self,
        _path: &[u8],
        _ssl_options: Option<SSLConfig>,
        _owned_ctx: Option<boringssl::OwnedSslCtx>,
    ) -> bun_sys::Result<()> {
        // Unreachable on POSIX — see `open` above.
        unreachable!("WindowsNamedPipe::connect is windows-only")
    }

    /// Set up the in-process SSL wrapper for `connect`/`open`. Prefers a prebuilt
    /// `SSL_CTX` (moved into `wrapper`) so a memoised `tls.createSecureContext`
    /// reaches this path with its CA bundle intact; on this branch `[buntls]`
    /// returns `{secureContext}` and no longer spreads `{ca,cert,key}`, so the
    /// `SSLConfig` fallback alone would build a CTX with an empty trust store
    /// and fail `DEPTH_ZERO_SELF_SIGNED_CERT`.
    /// Returns null when neither input requested TLS.
    #[cfg(windows)]
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

    pub(crate) fn start(&self, is_client: bool) -> bool {
        self.update_flags(|f| f.set(Flags::IS_CLIENT, is_client));
        #[cfg(windows)]
        {
            let Some(pipe_nn) = self.pipe.get() else {
                return false;
            };
            // SAFETY: live libuv handle alias; see `pipe`.
            unsafe { (*pipe_nn.as_ptr()).unref() };
            let this: *mut Self = self.root_ptr();
            self.update_flags(|f| f.insert(Flags::PIPE_ADOPTED));
            let start_pipe_result = self.writer.with_mut(|w| {
                w.set_parent(this);
                // SAFETY: `start_with_pipe`'s contract is "Box-allocated pointer;
                // ownership transfers to `self.source`". `pipe_nn` is the
                // `NonNull` recorded from the `Box<uv::Pipe>` leaked in `from()`
                // and not yet adopted (asserted by `start_with_pipe`'s
                // `debug_assert!(source.is_none())`).
                unsafe { w.start_with_pipe(pipe_nn.as_ptr()) }
            });
            if let bun_sys::Result::Err(err) = start_pipe_result {
                self.on_error(err);
                return false;
            }
            let Some(stream) = self.writer.with_mut(|w| w.get_stream()) else {
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
        #[cfg(not(windows))]
        {
            let _ = is_client;
            false
        }
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

    /// `uv::open_handles` closes a not-yet-adopted pipe through here at teardown.
    #[cfg(windows)]
    unsafe fn stop_for_vm_teardown(this: *mut core::ffi::c_void) {
        // SAFETY: recorded right after `pipe.init` by this live object; replaced by
        // the writer at adoption or dropped with the pipe (discard_unadopted_pipe).
        let this = unsafe { &*this.cast::<Self>() };
        if this.flags.get().contains(Flags::PIPE_ADOPTED) {
            this.close();
        } else {
            this.discard_unadopted_pipe();
        }
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__close")]
    pub fn close(&self) {
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
            #[cfg(windows)]
            if let Some(stream) = self.writer.with_mut(|w| w.get_stream()) {
                // SAFETY: `stream` is the live pipe stream; `uv_read_stop`
                // always succeeds and is a no-op if not reading.
                unsafe { (*stream).read_stop() };
            }
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
        // `EventLoopTimer.next` is the lower-tier `ElTimespec` stub;
        // bridge from `bun_core::Timespec` until the lower tier switches.
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
    // Private idempotent helper invoked from on_close and Drop.
    // Owned fields (writer, wrapper, ssl_error) free themselves via their own Drop impls; only
    // the side effects (timer cancel, read_stop, take()) remain explicit here.
    fn release_resources(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "deinit");
        // clear the timer
        self.set_timeout(0);
        // "The source is already
        // closed by the time on_close reaches here (that close is what fired the
        // callback)" is true ONLY for the writer-initiated close path
        // (`WindowsStreamingWriterParent::on_close`). It is FALSE when we arrive
        // via `ssl_on_close` (TLS close_notify): the underlying `uv_pipe_t` is
        // still open and in libuv's handle_queue, so without an explicit close
        // here the HANDLE survives ≥ one extra event-loop tick (until the
        // embedding context's refcount hits 0 and `WindowsStreamingWriter::Drop`
        // finally runs). Inline `close_without_reporting()` (private on the
        // writer) so the source pipe is `uv_close`d NOW; the `get_fd() != INVALID`
        // guard makes this a no-op on the writer-initiated path where the source
        // was already taken, and `closed_without_reporting = true` keeps
        // `on_close_source()` from re-entering `Parent::on_close` (we're already
        // inside it). `current_payload` may still back an in-flight `uv_write`
        // (cancelled async by `uv_close`) so it is left to the writer's own Drop.
        #[cfg(windows)]
        {
            if let Some(stream) = self.writer.with_mut(|w| w.get_stream()) {
                // SAFETY: `stream` is the live pipe stream; `uv_read_stop`
                // always succeeds and is a no-op if not reading.
                unsafe { (*stream).read_stop() };
            }
            self.writer.with_mut(|w| w.close_without_reporting());
            self.writer.with_mut(|w| w.outgoing = Default::default());
        }
        if !self.flags.get().contains(Flags::WRAPPER_BUSY) {
            self.wrapper.set(None);
        }
        self.ssl_error.set(CertError::default());
    }
}

impl Drop for WindowsNamedPipe {
    fn drop(&mut self) {
        self.release_resources();
        // Reclaim the `Box<uv::Pipe>` leaked in `from()` if it was never
        // adopted by `self.writer.source` (early-error returns from
        // `connect`/`open`/`get_accepted_by` before `start()` runs). Once
        // `PIPE_ADOPTED` is set the writer is the sole owner and frees via
        // its libuv close callback — touching it here would double-free.
        // `close_and_destroy` handles both un-adopted states: if `pipe.init()`
        // never ran (`loop_` still null) it just `Box::from_raw`-drops the
        // allocation; if init() DID run before the later open/accept/connect
        // failure it `uv_close`s first so the handle is unlinked from libuv's
        // `handle_queue` before the heap block is freed.
        #[cfg(windows)]
        if !self.flags.get().contains(Flags::PIPE_ADOPTED) {
            if let Some(pipe) = self.pipe.take() {
                // SAFETY: `pipe` is the `NonNull` from `Box::leak` in `from()`,
                // never adopted (gated on `!PIPE_ADOPTED`); `close_and_destroy`
                // is the unique reclaim and accepts both never-init'd and
                // init'd-but-unowned handles.
                unsafe { uv::Pipe::close_and_destroy(pipe.as_ptr()) };
            }
        }
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

// Windows-only at runtime; the POSIX impl exists purely so the
// `StreamingWriter<Self>` field type-checks (poll_tag::NULL keeps the
// dispatch table from being silently wrong if a poll is ever created).
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
    uv_loop    = |this| (*this).vm.uv_loop(),
    ref_       = |this| (&*this).r#ref(),
    deref      = |this| (&*this).deref(),
}

/// The three `stream.readStart` callbacks (alloc/error/read) baked into a
/// trait so the
/// `extern "C"` libuv trampoline is monomorphised over `WindowsNamedPipe`.
#[cfg(windows)]
impl uv::StreamReader for WindowsNamedPipe {
    #[inline]
    fn on_read_alloc(this: &mut Self, suggested_size: usize) -> &mut [u8] {
        let this: &Self = this;
        // SAFETY: the returned region is the buffer's spare capacity handed to
        // libuv for the pending read; nothing else touches `incoming` until
        // `on_read` commits the byte count.
        let incoming = unsafe { &mut *this.incoming.as_ptr() };
        // SAFETY: libuv writes into this region before `on_read` commits it.
        let spare = unsafe { incoming.uv_alloc_spare_u8(suggested_size) };
        &mut spare[..suggested_size]
    }
    #[inline]
    fn on_read_error(this: &mut Self, err: core::ffi::c_int) {
        // The trampoline only reaches this arm when `nreads < 0`, and for any
        // negative code `translate_uv_error_to_e` already
        // yields a concrete `E` (falling back to `UNKNOWN` for unmapped
        // codes). Pass it straight through; do NOT remap UNKNOWN→CANCELED.
        let e = bun_sys::windows::translate_uv_error_to_e(err);
        let this: &Self = this;
        this.on_read_error(e);
    }
    #[inline]
    unsafe fn on_read(this: *mut Self, data: &[u8]) {
        // `data` points into `(*this).incoming` (it was returned from
        // `on_read_alloc`). Capture the only thing the body needs (length)
        // and drop the slice before touching `*this`.
        let nread = data.len();
        let _ = data;
        // SAFETY: `this` is the live context stashed in `handle.data` by
        // `read_start_ctx`; `data` is no longer live.
        unsafe { &*this }.on_read(nread);
    }
}
