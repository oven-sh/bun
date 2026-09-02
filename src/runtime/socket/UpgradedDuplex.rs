//! UpgradedDuplex provides TLS/SSL encryption for Node.js-style duplex streams.
//!
//! This is used when you need to add TLS encryption to streams that are not traditional
//! network sockets. In Node.js, you can have duplex streams that represent arbitrary
//! read/write channels - these could be in-memory streams, custom transport protocols,
//! or any other bidirectional data flow that implements the duplex stream interface.
//!
//! Since these duplex streams don't have native SSL support (they're not actual socket
//! file descriptors),
//!
//! The duplex stream manages the SSL handshake, certificate validation, encryption/decryption,
//! and integrates with Bun's event loop for timeouts and async operations. It maintains
//! JavaScript callbacks for handling connection events and errors.

use core::cell::Cell;
use core::ffi::{CStr, c_uint, c_void};

use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, GlobalRef, JSGlobalObject, JSValue, JsCell, JsResult, host_fn};
use bun_uws::{us_bun_verify_error_t, uws_callback};

use super::ssl_wrapper::SSLWrapper;
use crate::generated_classes::js_TLSSocket;
use crate::timer::{ElTimespec, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

bun_output::declare_scope!(UpgradedDuplex, visible);

pub(crate) struct UpgradedDuplex {
    pub wrapper: JsCell<Option<WrapperType>>,
    /// The owning `JSTLSSocket` wrapper. Its `values:` slots root `origin` and
    /// the four listener thunks; the `JSValue` fields below are read-side
    /// shadows of those slots.
    pub js_wrapper: JSValue,
    pub origin: Cell<JSValue>, // any duplex
    // JSC_BORROW per LIFETIMES.tsv.
    pub global: Option<GlobalRef>,
    pub ssl_error: JsCell<CertError>,
    // JSC_BORROW per LIFETIMES.tsv. `Option` so the struct is zero-initializable
    // (socket_body.rs `DuplexUpgradeContext` two-phase init builds this field as
    // `zeroed()` before overwriting via `from()`).
    pub vm: Option<&'static VirtualMachine>,
    pub handlers: Handlers,
    pub on_data_callback: Cell<JSValue>,
    pub on_end_callback: Cell<JSValue>,
    pub on_writable_callback: Cell<JSValue>,
    pub on_close_callback: Cell<JSValue>,
    pub event_loop_timer: JsCell<EventLoopTimer>,
    pub current_timeout: Cell<u32>,
    /// Transport bytes that arrived before the TLS engine existed.
    ///
    /// `js_upgrade_duplex_to_tls` defers `start_tls` to an event-loop task (so
    /// `on_open` cannot re-enter JS before the caller holds the handle), but the
    /// JS caller attaches its `data` listener as soon as that function returns.
    /// When both ends of a `duplexPair()` are wrapped in-process, the peer's
    /// engine starts first and writes its ClientHello while this side's
    /// `wrapper` is still `None`. Dropping those bytes deadlocks the handshake
    /// forever, so stage them here and replay them from
    /// [`Self::drain_pending`] as soon as the engine is up.
    pub pending_data: JsCell<Vec<u8>>,
    /// Peer EOF that arrived before the TLS engine existed. Same race as
    /// [`Self::pending_data`]: a duplex that writes its last bytes and calls
    /// `end()` in the tick before `StartTLS` runs would otherwise have the EOF
    /// dropped, leaving the readable side waiting on data that will never come.
    /// Replayed by [`Self::drain_pending`] after the staged bytes, preserving
    /// the original data-then-EOF order.
    pub pending_end: Cell<bool>,
    /// The transport delivered EOF (its 'end' event fired). Teardown payloads
    /// (close_notify) are dropped after this; see [`Self::call_write_or_end`].
    pub transport_eof: Cell<bool>,
    /// The handle-backed socket this engine runs over, when there is one: its
    /// `NativeCallbacks::TlsTransport` delivers data/end/drain/close, ciphertext
    /// goes straight into it, flow control reaches it, and teardown hands it
    /// back. (`end()` still goes through the JS stream, which owns that state.)
    pub transport: JsCell<Transport>,
    /// `Some` while output is held behind the transport's queued plaintext
    /// (node's `has_active_write_issued_by_prev_listener_`); see `release_output`.
    pub held_output: JsCell<Option<Vec<u8>>>,
}

/// See [`UpgradedDuplex::transport`].
pub enum Transport {
    None,
    Tcp(bun_ptr::RefPtr<super::TCPSocket>),
    Tls(bun_ptr::RefPtr<super::TLSSocket>),
}

bun_event_loop::impl_timer_owner!(UpgradedDuplex; from_timer_ptr => event_loop_timer);

#[derive(Default)]
pub struct CertError {
    pub(crate) error_no: i32,
    // Owned NUL-terminated copies. `None` represents the default `""`.
    pub(crate) code: Option<Box<CStr>>,
    pub reason: Option<Box<CStr>>,
}
// `Box<CStr>` drops automatically — no explicit Drop needed.

type WrapperType = SSLWrapper<*mut UpgradedDuplex>;

/// Server-side peer-certificate policy for a duplex TLS upgrade, resolved in
/// `js_upgrade_duplex_to_tls` and applied via `SSLWrapper::set_server_verify`.
/// Ignored for client upgrades.
#[derive(Clone, Copy)]
pub(crate) struct ServerVerify {
    /// `requestCert` — whether to send a CertificateRequest at all.
    pub request_cert: bool,
    /// `rejectUnauthorized` — only meaningful when `request_cert` is set.
    pub reject_unauthorized: bool,
}

pub struct Handlers {
    // BACKREF per LIFETIMES.tsv — container holding self as `.upgrade`.
    pub ctx: *mut (),
    pub(crate) on_open: fn(*mut ()),
    pub(crate) on_handshake: fn(*mut (), bool, us_bun_verify_error_t),
    pub(crate) on_data: fn(*mut (), &[u8]),
    pub on_close: fn(*mut ()),
    pub(crate) on_end: fn(*mut ()),
    pub(crate) on_writable: fn(*mut ()),
    pub(crate) on_error: fn(*mut (), JSValue),
    pub(crate) on_timeout: fn(*mut ()),
    /// A new resumable TLS session (serialized SSL_SESSION) - node's
    /// `'session'` event on the wrapping TLSSocket.
    pub(crate) on_session: fn(*mut (), &[u8]),
    /// An NSS key-log line - node's `'keylog'` event.
    pub(crate) on_keylog: fn(*mut (), &[u8]),
}

use crate::jsc_hooks::timer_all_mut as timer_all;

/// Lazily create-and-cache a JS host-function callback in `shadow`, mirrored
/// into the owning `JSTLSSocket` wrapper's visited `values:` slot (the GC
/// root). All four `get_js_handlers` slots follow the identical
/// `NewFunctionWithData(global, null, 0, fn, self)` → `ensureStillAlive` →
/// `setFunctionData(self)` → store pattern.
#[inline]
fn lazy_js_handler(
    shadow: &Cell<JSValue>,
    js_wrapper: JSValue,
    set_slot: fn(JSValue, &JSGlobalObject, JSValue),
    global: &JSGlobalObject,
    func: host_fn::JsHostFn,
    this_ptr: *mut c_void,
) -> JSValue {
    if !shadow.get().is_empty() {
        return shadow.get();
    }
    let callback = host_fn::new_function_with_data(global, None, 0, func, this_ptr);
    callback.ensure_still_alive();
    host_fn::set_function_data(callback, Some(this_ptr));
    set_slot(js_wrapper, global, callback);
    shadow.set(callback);
    callback
}

impl UpgradedDuplex {
    // SAFETY (all handlers): the SSLWrapper handlers ctx is `self as *mut
    // Self`, live for the wrapper's lifetime.

    #[inline]
    fn wrapper_ref(&self) -> Option<&WrapperType> {
        self.wrapper.get().as_ref()
    }

    fn on_open(this: *mut Self) {
        bun_output::scoped_log!(UpgradedDuplex, "onOpen");
        // SAFETY: see handler note above.
        let this = unsafe { &*this };
        (this.handlers.on_open)(this.handlers.ctx);
    }

    fn on_data(this: *mut Self, decoded_data: &[u8]) {
        bun_output::scoped_log!(UpgradedDuplex, "onData ({})", decoded_data.len());
        // SAFETY: see handler note above.
        let this = unsafe { &*this };
        (this.handlers.on_data)(this.handlers.ctx, decoded_data);
    }

    fn on_session(this: *mut Self, session: &[u8]) {
        bun_output::scoped_log!(UpgradedDuplex, "onSession ({})", session.len());
        // SAFETY: see handler note above.
        let this = unsafe { &*this };
        (this.handlers.on_session)(this.handlers.ctx, session);
    }

    fn on_keylog(this: *mut Self, line: &[u8]) {
        bun_output::scoped_log!(UpgradedDuplex, "onKeylog ({})", line.len());
        // SAFETY: see handler note above.
        let this = unsafe { &*this };
        (this.handlers.on_keylog)(this.handlers.ctx, line);
    }

    fn on_handshake(this: *mut Self, handshake_success: bool, ssl_error: us_bun_verify_error_t) {
        bun_output::scoped_log!(UpgradedDuplex, "onHandshake");
        // SAFETY: see handler note above.
        let this = unsafe { &*this };
        this.ssl_error.set(CertError {
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
        (this.handlers.on_handshake)(this.handlers.ctx, handshake_success, ssl_error);
        // Retry writes parked during the handshake, like openssl.c's `ssl_write_wants_read`.
        if handshake_success && !this.is_shutdown() {
            (this.handlers.on_writable)(this.handlers.ctx);
        }
    }

    fn on_close(this: *mut Self) {
        bun_output::scoped_log!(UpgradedDuplex, "onClose");
        // SAFETY: see handler note above.
        let this = unsafe { &*this };

        // Keep the wrapper (and so its visited `duplex*` slots) reachable
        // across `handlers.on_close`, which downgrades the socket's own strong
        // self-reference and re-enters JS.
        let js_wrapper = this.js_wrapper;
        js_wrapper.ensure_still_alive();

        (this.handlers.on_close)(this.handlers.ctx);
        // closes the underlying duplex
        this.call_write_or_end(None, false);

        // Early teardown (struct itself is dropped later by parent).
        this.teardown();
        js_wrapper.ensure_still_alive();
    }

    fn call_write_or_end(&self, data: Option<&[u8]>, msg_more: bool) {
        // No JS duplex to talk to: the zeroed placeholder, or the owning
        // socket's finalizer abandoned it (`abandon_js_side`).
        let duplex = self.origin.get();
        if duplex.is_empty() {
            return;
        }
        // global is set in `from()` whenever origin is set.
        let Some(global) = self.global else { return };

        // Teardown-phase bytes (close_notify / the trailing end()) aimed at a
        // duplex whose write side already ended (TLS-inception teardown) only
        // surface a spurious EPIPE - drop them. Ordinary data writes skip the
        // probe so write-after-end still errors like node.
        let teardown = data.is_none() || self.is_shutdown();
        if teardown {
            match duplex.get(&global, "writableEnded") {
                Ok(Some(ended)) if ended.to_boolean() => return,
                Ok(_) => {}
                // Best-effort probe: consume the exception and fall through.
                Err(err) => drop(global.take_exception(err)),
            }
        }

        let name = if msg_more { "write" } else { "end" };
        let write_or_end = match duplex.get(&global, name) {
            Ok(Some(f)) if f.is_callable() => f,
            _ => return,
        };

        if let Some(data) = data {
            let buffer = match bun_jsc::array_buffer::BinaryType::Buffer.to_js(data, &global) {
                Ok(b) => b,
                Err(err) => {
                    (self.handlers.on_error)(self.handlers.ctx, global.take_error(err));
                    return;
                }
            };
            buffer.ensure_still_alive();

            if let Err(err) = write_or_end.call(&global, duplex, &[buffer]) {
                (self.handlers.on_error)(self.handlers.ctx, global.take_error(err));
            }
        } else {
            if let Err(err) = write_or_end.call(&global, duplex, &[JSValue::NULL]) {
                (self.handlers.on_error)(self.handlers.ctx, global.take_error(err));
            }
        }
    }

    fn internal_write(this: *mut Self, encoded_data: &[u8]) {
        // SAFETY: see handler note above.
        unsafe { &*this }.write_encrypted(encoded_data);
    }

    fn write_encrypted(&self, encoded_data: &[u8]) {
        self.reset_timeout();
        let held = self.held_output.with_mut(|h| match h.as_mut() {
            Some(h) => {
                h.extend_from_slice(encoded_data);
                true
            }
            None => false,
        });
        if !held {
            self.write_to_transport(encoded_data);
        }
    }

    #[uws_callback(export = "UpgradedDuplex__flush")]
    pub(crate) fn flush(&self) {
        if let Some(w) = self.wrapper_ref() {
            let _ = w.flush();
        }
    }

    /// Ciphertext from the transport (a JS `data` chunk, or a handle-backed
    /// socket's native read via `NativeCallbacks::TlsTransport`).
    pub(crate) fn on_transport_data(&self, data: &[u8]) {
        if let Some(w) = self.wrapper_ref() {
            self.reset_timeout();
            w.receive_data(data);
            return;
        }
        // Engine not up yet - `start_tls` is still queued. Stage the bytes;
        // `drain_pending` feeds them in as soon as the engine is up.
        self.pending_data.with_mut(|p| p.extend_from_slice(data));
    }

    /// Replay bytes that arrived before the engine existed. Called by
    /// `DuplexUpgradeContext::run_event` once the `StartTLS` branch has
    /// finished its bookkeeping, so the replay is indistinguishable from an
    /// ordinary post-start delivery.
    pub(super) fn drain_pending(&self) {
        // Nothing to replay, or the engine never came up (the socket died
        // before `StartTLS`). Bail before taking so the bytes are not
        // destroyed by a drain that could not deliver them.
        if self.wrapper_ref().is_none() {
            return;
        }
        if self.pending_data.get().is_empty() {
            self.drain_pending_end();
            return;
        }
        // Taking ownership is load-bearing: a re-entrant `teardown()` clears
        // `pending_data`, and BoringSSL must not have the slice freed under it.
        let staged = self.pending_data.replace(Vec::new());
        self.reset_timeout();
        // Feed in bounded slices rather than one concatenated buffer. Each JS
        // chunk was originally delivered on its own; `receive_data` casts the
        // length to `c_int` with a panicking `expect`, so handing it the sum of
        // every chunk staged in the window would turn a large pre-start burst
        // into a process abort. Re-check the engine each round: BoringSSL can
        // re-enter and tear it down partway through, and `teardown()` neuters
        // in place (frees the SSL, keeps the Option `Some`), so the live
        // signal is the SSL handle, not the Option.
        for chunk in staged.chunks(64 * 1024) {
            match self.wrapper_ref() {
                Some(w) if w.ssl.get().is_some() => w.receive_data(chunk),
                _ => break,
            }
        }
        self.drain_pending_end();
    }

    /// Replay an EOF that landed before the engine came up. Split out so both
    /// `drain_pending` exits report it, and kept after the staged bytes so the
    /// engine sees data-then-EOF in the order the peer sent it.
    fn drain_pending_end(&self) {
        if !self.pending_end.get() {
            return;
        }
        self.pending_end.set(false);
        // A re-entrant teardown during the byte replay above neuters the
        // engine in place (`teardown()` keeps the Option `Some` but frees the
        // SSL); do not synthesize an EOF into a dead socket.
        if self.wrapper_ref().is_none_or(|w| w.ssl.get().is_none()) {
            return;
        }
        (self.handlers.on_end)(self.handlers.ctx);
    }

    pub(crate) fn on_timeout(&self) {
        bun_output::scoped_log!(UpgradedDuplex, "onTimeout");

        let has_been_cleared = self.event_loop_timer.get().state == EventLoopTimerState::CANCELLED
            || self.vm.is_none_or(|vm| {
                vm.script_execution_status() != bun_jsc::ScriptExecutionStatus::Running
            });

        self.event_loop_timer.with_mut(|t| {
            t.state = EventLoopTimerState::FIRED;
            t.heap = Default::default();
        });

        if has_been_cleared {
            return;
        }

        (self.handlers.on_timeout)(self.handlers.ctx);
    }

    pub(crate) fn from(
        global: &JSGlobalObject,
        js_wrapper: JSValue,
        origin: JSValue,
        handlers: Handlers,
    ) -> UpgradedDuplex {
        js_TLSSocket::duplex_origin_set_cached(js_wrapper, global, origin);
        UpgradedDuplex {
            vm: Some(global.bun_vm()),
            js_wrapper,
            origin: Cell::new(origin),
            global: Some(GlobalRef::from(global)),
            wrapper: JsCell::new(None),
            handlers,
            ssl_error: JsCell::new(CertError::default()),
            on_data_callback: Cell::new(JSValue::ZERO),
            on_end_callback: Cell::new(JSValue::ZERO),
            on_writable_callback: Cell::new(JSValue::ZERO),
            on_close_callback: Cell::new(JSValue::ZERO),
            event_loop_timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::UpgradedDuplex,
            )),
            current_timeout: Cell::new(0),
            pending_data: JsCell::new(Vec::new()),
            pending_end: Cell::new(false),
            transport_eof: Cell::new(false),
            transport: JsCell::new(Transport::None),
            held_output: JsCell::new(None),
        }
    }

    /// The transport's queued plaintext is out: send what was held, stop holding.
    #[uws_callback(export = "UpgradedDuplex__release_output")]
    pub(crate) fn release_output(&self) {
        if let Some(held) = self.held_output.replace(None) {
            if !held.is_empty() {
                self.write_to_transport(&held);
            }
        }
    }

    fn write_to_transport(&self, data: &[u8]) {
        // A close_notify after the transport's readable side ended has no
        // reader: node writes nothing there, and a transport forwarding into an
        // auto-ended net.Socket would throw writeAfterFIN. The trailing end()
        // still goes out, so a half-open transport sees our FIN.
        if self.transport_eof.get() && self.is_shutdown() {
            return;
        }
        match self.transport.get() {
            Transport::Tcp(t) => t.write_from_engine(data),
            Transport::Tls(t) => t.write_from_engine(data),
            Transport::None => self.call_write_or_end(Some(data), true),
        }
    }

    #[uws_callback(export = "UpgradedDuplex__pause")]
    pub(crate) fn pause(&self) -> bool {
        match self.transport.get() {
            Transport::Tcp(t) => t.pause_reads(),
            Transport::Tls(t) => t.pause_reads(),
            Transport::None => return false,
        }
        true
    }

    #[uws_callback(export = "UpgradedDuplex__resume")]
    pub(crate) fn resume(&self) -> bool {
        match self.transport.get() {
            Transport::Tcp(t) => t.resume_reads(),
            Transport::Tls(t) => t.resume_reads(),
            Transport::None => return false,
        }
        true
    }

    fn release_transport(&self) {
        match self.transport.replace(Transport::None) {
            Transport::Tcp(t) => t.clear_native_callback(),
            Transport::Tls(t) => t.clear_native_callback(),
            Transport::None => {}
        }
    }

    /// The transport's EOF (its JS `end` event, or natively).
    pub(crate) fn on_transport_end(&self) {
        self.transport_eof.set(true);
        if self.wrapper_ref().is_some() {
            (self.handlers.on_end)(self.handlers.ctx);
        } else {
            // EOF before `start_tls` ran. Hold it so `drain_pending` reports it
            // in order, after any bytes staged in the same window.
            self.pending_end.set(true);
        }
    }

    /// The transport can take more (natively, or a Duplex's `drain`).
    pub(crate) fn on_transport_writable(&self) {
        self.flush();
        (self.handlers.on_writable)(self.handlers.ctx);
    }

    pub(crate) fn get_js_handlers(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let array = JSValue::create_empty_array(global, 4)?;
        array.ensure_still_alive();

        let this_ptr = std::ptr::from_ref(self).cast_mut().cast::<c_void>();
        let js_wrapper = self.js_wrapper;
        array.put_index(
            global,
            0,
            lazy_js_handler(
                &self.on_data_callback,
                js_wrapper,
                js_TLSSocket::duplex_on_data_set_cached,
                global,
                __jsc_host_on_received_data,
                this_ptr,
            ),
        )?;
        array.put_index(
            global,
            1,
            lazy_js_handler(
                &self.on_end_callback,
                js_wrapper,
                js_TLSSocket::duplex_on_end_set_cached,
                global,
                __jsc_host_on_end,
                this_ptr,
            ),
        )?;
        array.put_index(
            global,
            2,
            lazy_js_handler(
                &self.on_writable_callback,
                js_wrapper,
                js_TLSSocket::duplex_on_writable_set_cached,
                global,
                __jsc_host_on_writable,
                this_ptr,
            ),
        )?;
        array.put_index(
            global,
            3,
            lazy_js_handler(
                &self.on_close_callback,
                js_wrapper,
                js_TLSSocket::duplex_on_close_set_cached,
                global,
                __jsc_host_on_close_js,
                this_ptr,
            ),
        )?;

        Ok(array)
    }

    fn wrapper_handlers(&self) -> super::ssl_wrapper::Handlers<*mut UpgradedDuplex> {
        super::ssl_wrapper::Handlers {
            ctx: std::ptr::from_ref(self).cast_mut(),
            on_open: Self::on_open,
            on_handshake: Self::on_handshake,
            on_data: Self::on_data,
            on_close: Self::on_close,
            write: Self::internal_write,
            on_session: Some(Self::on_session),
            on_keylog: Some(Self::on_keylog),
        }
    }

    fn install_and_start(&self, wrapper: WrapperType, verify: ServerVerify) {
        self.wrapper.set(Some(wrapper));
        let w = self.wrapper_ref().unwrap();
        w.set_server_verify(verify.request_cert, verify.reject_unauthorized);
        w.start();
    }

    pub(crate) fn start_tls(
        &self,
        ssl_options: &crate::server::server_config::SSLConfig,
        is_client: bool,
        verify: ServerVerify,
    ) -> Result<(), crate::Error> {
        let wrapper = super::ssl_wrapper::init(ssl_options, is_client, self.wrapper_handlers())?;
        self.install_and_start(wrapper, verify);
        Ok(())
    }

    /// Mirrors `start_tls` but skips the
    /// `SSLConfig.asUSockets() → us_ssl_ctx_from_options()` round-trip so a
    /// memoised `SecureContext` can be reused on the duplex/named-pipe path.
    pub(crate) fn start_tls_with_ctx(
        &self,
        ctx: bun_boringssl_sys::OwnedSslCtx,
        is_client: bool,
        verify: ServerVerify,
    ) -> Result<(), crate::Error> {
        let wrapper = WrapperType::init_with_ctx(ctx, is_client, self.wrapper_handlers())?;
        self.install_and_start(wrapper, verify);
        Ok(())
    }

    #[uws_callback(export = "UpgradedDuplex__encode_and_write")]
    pub(crate) fn encode_and_write(&self, data: &[u8]) -> i32 {
        bun_output::scoped_log!(UpgradedDuplex, "encodeAndWrite (len: {})", data.len());
        if let Some(w) = self.wrapper_ref() {
            let written = w.write_data(data).unwrap_or(0);
            return i32::try_from(written).expect("int cast");
        }
        0
    }

    #[uws_callback(export = "UpgradedDuplex__raw_write")]
    pub(crate) fn raw_write(&self, encoded_data: &[u8]) -> i32 {
        self.write_encrypted(encoded_data);
        i32::try_from(encoded_data.len()).expect("int cast")
    }

    /// The owning socket wrapper is being finalized: the JS duplex may be dead
    /// too and a finalizer dispatches nothing, so the SSL shutdown that
    /// follows writes no close_notify and ends nothing — it only unwinds the
    /// native side.
    #[uws_callback(export = "UpgradedDuplex__abandon_js_side", no_catch)]
    pub(crate) fn abandon_js_side(&self) {
        self.origin.set(JSValue::ZERO);
    }

    #[uws_callback(export = "UpgradedDuplex__close")]
    pub(crate) fn close(&self) {
        if let Some(w) = self.wrapper_ref() {
            let _ = w.shutdown(true);
        }
    }

    #[uws_callback(export = "UpgradedDuplex__shutdown")]
    pub(crate) fn shutdown(&self) {
        if let Some(w) = self.wrapper_ref() {
            let _ = w.shutdown(false);
        }
    }

    #[uws_callback(export = "UpgradedDuplex__shutdown_read")]
    pub(crate) fn shutdown_read(&self) {
        if let Some(w) = self.wrapper_ref() {
            w.shutdown_read();
        }
    }

    /// `None` means `start_tls` has not run yet (teardown never clears the slot), not shut down.
    #[uws_callback(export = "UpgradedDuplex__is_shutdown", no_catch)]
    pub(crate) fn is_shutdown(&self) -> bool {
        self.wrapper_ref().is_some_and(|w| w.is_shutdown())
    }

    /// See [`Self::is_shutdown`] for the not-yet-started case.
    #[uws_callback(export = "UpgradedDuplex__is_closed", no_catch)]
    pub(crate) fn is_closed(&self) -> bool {
        self.wrapper_ref().is_some_and(|w| w.is_closed())
    }

    #[uws_callback(export = "UpgradedDuplex__is_established", no_catch)]
    pub(crate) fn is_established(&self) -> bool {
        !self.is_closed()
    }

    fn ssl(&self) -> Option<*mut bun_boringssl_sys::SSL> {
        self.wrapper_ref()
            .and_then(|w| w.ssl.get())
            .map(|p| p.as_ptr())
    }

    #[uws_callback(export = "UpgradedDuplex__ssl_error", no_catch)]
    pub(crate) fn ssl_error(&self) -> us_bun_verify_error_t {
        let err = self.ssl_error.get();
        us_bun_verify_error_t {
            error_no: err.error_no,
            code: err.code.as_deref().map_or(c"".as_ptr(), |c| c.as_ptr()),
            reason: err.reason.as_deref().map_or(c"".as_ptr(), |c| c.as_ptr()),
            // `struct us_bun_verify_error_t` (libusockets.h) has exactly these
            // three fields: { int error; const char* code; const char* reason }.
        }
    }

    fn reset_timeout(&self) {
        self.set_timeout_in_milliseconds(self.current_timeout.get());
    }

    fn set_timeout_in_milliseconds(&self, ms: c_uint) {
        if self.event_loop_timer.get().state == EventLoopTimerState::ACTIVE {
            timer_all().remove(self.event_loop_timer.as_ptr());
        }
        self.current_timeout.set(ms);

        // if the interval is 0 means that we stop the timer
        if ms == 0 {
            return;
        }

        // reschedule the timer
        // Note: `EventLoopTimer.next` is the lower-tier `ElTimespec` stub;
        // bridge from `bun_core::Timespec` until the lower tier switches.
        let next =
            bun_core::Timespec::ms_from_now(bun_core::TimespecMockMode::ForceRealTime, ms as i64);
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

    #[uws_callback(export = "UpgradedDuplex__set_timeout")]
    pub(crate) fn set_timeout(&self, seconds: c_uint) {
        bun_output::scoped_log!(UpgradedDuplex, "setTimeout({})", seconds);
        self.set_timeout_in_milliseconds(seconds * 1000);
    }

    /// Side-effecting teardown shared by `on_close` (early) and `Drop` (final).
    /// Idempotent: resets to empty state. Also invoked by
    /// `DuplexUpgradeContext`'s connect-error branches so the listener thunks
    /// are neutered while the wrapper is still strongly reachable.
    pub(super) fn teardown(&self) {
        bun_output::scoped_log!(UpgradedDuplex, "deinit");
        // clear the timer
        self.set_timeout(0);

        // Neuter in place rather than `self.wrapper.set(None)`: `teardown()`
        // can run re-entrantly from `on_close` while a
        // `SSLWrapper::handle_traffic` frame is still on the stack with a
        // `&SSLWrapper` into the `Some` payload. Assigning `None` runs `Drop`
        // (fine - `deinit()` nulls `ssl`/`ctx`) but then memmoves a fresh
        // `Option::None` value over the slot, whose payload bytes are stack
        // garbage - the in-flight frame's `self.ssl` then reads junk and
        // `flush_pending_events` UAFs into BoringSSL. `deinit()` alone leaves
        // `ssl == None` / `closed_notified` readable so those guards work; the
        // `Option` is dropped for real when the parent `DuplexUpgradeContext`
        // frees on the next tick. See WindowsNamedPipe's WRAPPER_BUSY for the
        // sibling pattern.
        if let Some(w) = self.wrapper_ref() {
            w.deinit();
        }

        // Neuter the listener thunks so a late `origin` event sees null
        // function data instead of a freed `*mut Self`. GC-root clearing is
        // left to the wrapper's own collection.
        self.origin.set(JSValue::ZERO);
        for cb in [
            &self.on_data_callback,
            &self.on_end_callback,
            &self.on_writable_callback,
            &self.on_close_callback,
        ] {
            let value = cb.get();
            if !value.is_empty() {
                host_fn::set_function_data(value, None);
                cb.set(JSValue::ZERO);
            }
        }
        self.ssl_error.set(CertError::default());
        self.pending_data.set(Vec::new());
        self.pending_end.set(false);
        self.transport_eof.set(false);
        self.release_transport();
    }
}

impl Drop for UpgradedDuplex {
    fn drop(&mut self) {
        self.teardown();
    }
}

// SAFETY (all four host fns): the function data is the `*mut UpgradedDuplex`
// installed by `get_js_handlers`; `teardown` clears it before the storage is
// freed, so a non-null data pointer is live for the call.

#[bun_jsc::host_fn]
fn on_received_data(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_output::scoped_log!(UpgradedDuplex, "onReceivedData");

    let function = frame.callee();
    let [data_arg] = frame.arguments_as_array::<1>();

    if let Some(self_ptr) = host_fn::get_function_data(function) {
        // SAFETY: see host-fn note above.
        let this = unsafe { &*self_ptr.cast::<UpgradedDuplex>() };
        if frame.arguments_count() >= 1 {
            if !this.origin.get().is_empty() {
                if data_arg.is_empty_or_undefined_or_null() {
                    return Ok(JSValue::UNDEFINED);
                }
                if let Some(array_buffer) = data_arg.as_array_buffer(global) {
                    // yay we can read the data
                    let payload = array_buffer.slice();
                    this.on_transport_data(payload);
                } else {
                    // node.js errors in this case with the same error, lets keep it consistent
                    let error_value = global
                        .err(
                            bun_jsc::ErrorCode::STREAM_WRAP,
                            format_args!("Stream has StringDecoder set or is in objectMode"),
                        )
                        .to_js();
                    error_value.ensure_still_alive();
                    (this.handlers.on_error)(this.handlers.ctx, error_value);
                }
            }
        }
    }
    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn]
fn on_end(_global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_output::scoped_log!(UpgradedDuplex, "onEnd");
    let function = frame.callee();

    if let Some(self_ptr) = host_fn::get_function_data(function) {
        // SAFETY: see host-fn note above.
        unsafe { &*self_ptr.cast::<UpgradedDuplex>() }.on_transport_end();
    }
    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn]
fn on_writable(_global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_output::scoped_log!(UpgradedDuplex, "onWritable");

    let function = frame.callee();

    if let Some(self_ptr) = host_fn::get_function_data(function) {
        // SAFETY: see host-fn note above.
        unsafe { &*self_ptr.cast::<UpgradedDuplex>() }.on_transport_writable();
    }

    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn]
fn on_close_js(_global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_output::scoped_log!(UpgradedDuplex, "onCloseJS");

    let function = frame.callee();

    if let Some(self_ptr) = host_fn::get_function_data(function) {
        // SAFETY: see host-fn note above.
        let this = unsafe { &*self_ptr.cast::<UpgradedDuplex>() };
        // flush pending data
        this.close();
    }

    Ok(JSValue::UNDEFINED)
}

// ──────────────────────────────────────────────────────────────────────────
// `bun_uws::UpgradedDuplex` link-time-dispatch shims (cycle break).
//
// `src/uws_sys/lib.rs` declares `UpgradedDuplex` as an opaque handle and binds
// these symbols via `extern "C"` so the low-tier socket dispatch can call into
// the runtime without an upward crate dep. Signatures MUST match the
// `unsafe extern "C"` block there.
//
// All but `ssl` are emitted by `#[uws_callback(export = "...")]` on the
// inherent methods above; `ssl` keeps a hand-written shim because the safe
// method returns `Option<*mut SSL>` while the C ABI flattens to a nullable
// raw pointer.
// ──────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
extern "C" fn UpgradedDuplex__ssl(this: *const c_void) -> *mut bun_boringssl_sys::SSL {
    // SAFETY: `this` is a live `*const UpgradedDuplex` from the uws_sys opaque handle.
    unsafe {
        (*this.cast::<UpgradedDuplex>())
            .ssl()
            .unwrap_or(core::ptr::null_mut())
    }
}
