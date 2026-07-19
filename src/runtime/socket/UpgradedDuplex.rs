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

use core::ffi::{CStr, c_uint, c_void};
use core::ptr::NonNull;

use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, GlobalRef, JSGlobalObject, JSValue, JsResult, host_fn};
use bun_uws::{us_bun_verify_error_t, uws_callback};

use super::ssl_wrapper::SSLWrapper;
use crate::generated_classes::js_TLSSocket;
use crate::timer::{ElTimespec, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

bun_output::declare_scope!(UpgradedDuplex, visible);

pub(crate) struct UpgradedDuplex {
    pub wrapper: Option<WrapperType>,
    /// The owning `JSTLSSocket` wrapper. Its `values:` slots root `origin` and
    /// the four listener thunks; the `JSValue` fields below are read-side
    /// shadows of those slots.
    pub js_wrapper: JSValue,
    pub origin: JSValue, // any duplex
    // JSC_BORROW per LIFETIMES.tsv.
    pub global: Option<GlobalRef>,
    pub ssl_error: CertError,
    // JSC_BORROW per LIFETIMES.tsv. `Option` so the struct is zero-initializable
    // (socket_body.rs `DuplexUpgradeContext` two-phase init builds this field as
    // `zeroed()` before overwriting via `from()`).
    pub vm: Option<&'static VirtualMachine>,
    pub handlers: Handlers,
    pub on_data_callback: JSValue,
    pub on_end_callback: JSValue,
    pub on_writable_callback: JSValue,
    pub on_close_callback: JSValue,
    pub event_loop_timer: EventLoopTimer,
    pub current_timeout: u32,
}

bun_event_loop::impl_timer_owner!(UpgradedDuplex; from_timer_ptr => event_loop_timer);

#[derive(Default)]
pub struct CertError {
    pub error_no: i32,
    // Owned NUL-terminated copies. `None` represents the default `""`.
    pub code: Option<Box<CStr>>,
    pub reason: Option<Box<CStr>>,
}
// `Box<CStr>` drops automatically — no explicit Drop needed.

type WrapperType = SSLWrapper<*mut UpgradedDuplex>;

pub struct Handlers {
    // BACKREF per LIFETIMES.tsv — container holding self as `.upgrade`.
    pub ctx: *mut (),
    pub on_open: fn(*mut ()),
    pub on_handshake: fn(*mut (), bool, us_bun_verify_error_t),
    pub on_data: fn(*mut (), &[u8]),
    pub on_close: fn(*mut ()),
    pub on_end: fn(*mut ()),
    pub on_writable: fn(*mut ()),
    pub on_error: fn(*mut (), JSValue),
    pub on_timeout: fn(*mut ()),
    /// A new resumable TLS session (serialized SSL_SESSION) - node's
    /// `'session'` event on the wrapping TLSSocket.
    pub on_session: fn(*mut (), &[u8]),
    /// An NSS key-log line - node's `'keylog'` event.
    pub on_keylog: fn(*mut (), &[u8]),
}

use crate::jsc_hooks::timer_all_mut as timer_all;

/// Lazily create-and-cache a JS host-function callback in `shadow`, mirrored
/// into the owning `JSTLSSocket` wrapper's visited `values:` slot (the GC
/// root). All four `get_js_handlers` slots follow the identical
/// `NewFunctionWithData(global, null, 0, fn, self)` → `ensureStillAlive` →
/// `setFunctionData(self)` → store pattern.
#[inline]
fn lazy_js_handler(
    shadow: &mut JSValue,
    js_wrapper: JSValue,
    set_slot: fn(JSValue, &JSGlobalObject, JSValue),
    global: &JSGlobalObject,
    func: host_fn::JsHostFn,
    this_ptr: *mut c_void,
) -> JSValue {
    if !shadow.is_empty() {
        return *shadow;
    }
    let callback = host_fn::new_function_with_data(global, None, 0, func, this_ptr);
    callback.ensure_still_alive();
    host_fn::set_function_data(callback, Some(this_ptr));
    set_slot(js_wrapper, global, callback);
    *shadow = callback;
    callback
}

impl UpgradedDuplex {
    fn on_open(this: *mut Self) {
        bun_output::scoped_log!(UpgradedDuplex, "onOpen");
        // SAFETY: SSLWrapper handlers ctx is `self as *mut Self`; live for the wrapper's lifetime.
        let this = unsafe { &mut *this };
        (this.handlers.on_open)(this.handlers.ctx);
    }

    fn on_data(this: *mut Self, decoded_data: &[u8]) {
        bun_output::scoped_log!(UpgradedDuplex, "onData ({})", decoded_data.len());
        // SAFETY: SSLWrapper handlers ctx is `self as *mut Self`; live for the wrapper's lifetime.
        let this = unsafe { &mut *this };
        (this.handlers.on_data)(this.handlers.ctx, decoded_data);
    }

    fn on_session(this: *mut Self, session: &[u8]) {
        bun_output::scoped_log!(UpgradedDuplex, "onSession ({})", session.len());
        // SAFETY: SSLWrapper handlers ctx is `self as *mut Self`; live for the wrapper's lifetime.
        let this = unsafe { &mut *this };
        (this.handlers.on_session)(this.handlers.ctx, session);
    }

    fn on_keylog(this: *mut Self, line: &[u8]) {
        bun_output::scoped_log!(UpgradedDuplex, "onKeylog ({})", line.len());
        // SAFETY: SSLWrapper handlers ctx is `self as *mut Self`; live for the wrapper's lifetime.
        let this = unsafe { &mut *this };
        (this.handlers.on_keylog)(this.handlers.ctx, line);
    }

    fn on_handshake(this: *mut Self, handshake_success: bool, ssl_error: us_bun_verify_error_t) {
        bun_output::scoped_log!(UpgradedDuplex, "onHandshake");
        // SAFETY: SSLWrapper handlers ctx is `self as *mut Self`; live for the wrapper's lifetime.
        let this = unsafe { &mut *this };

        this.ssl_error = CertError {
            error_no: ssl_error.error_no,
            code: ssl_error
                .code()
                .filter(|_| ssl_error.error_no != 0)
                .map(Into::into),
            reason: ssl_error
                .reason()
                .filter(|_| ssl_error.error_no != 0)
                .map(Into::into),
        };
        (this.handlers.on_handshake)(this.handlers.ctx, handshake_success, ssl_error);
    }

    fn on_close(this: *mut Self) {
        bun_output::scoped_log!(UpgradedDuplex, "onClose");
        // SAFETY: SSLWrapper handlers ctx is `self as *mut Self`; live for the wrapper's lifetime.
        let this = unsafe { &mut *this };

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

    fn call_write_or_end(&mut self, data: Option<&[u8]>, msg_more: bool) {
        // `vm` is always set via `from()`; `None` only in the zeroed placeholder
        // state, which never reaches here.
        let Some(vm) = self.vm else { return };
        if vm.is_shutting_down() {
            return;
        }
        let duplex = self.origin;
        if duplex.is_empty() {
            return;
        }
        // global is set in `from()` whenever origin is set.
        let Some(global) = self.global else { return };

        let name = if msg_more { "write" } else { "end" };
        let write_or_end = match duplex.get(&global, name) {
            Ok(Some(f)) if f.is_callable() => f,
            _ => return,
        };

        if let Some(data) = data {
            let buffer = match bun_jsc::array_buffer::BinaryType::Buffer.to_js(data, &global) {
                Ok(b) => b,
                Err(err) => {
                    (self.handlers.on_error)(self.handlers.ctx, global.take_exception(err));
                    return;
                }
            };
            buffer.ensure_still_alive();

            if let Err(err) = write_or_end.call(&global, duplex, &[buffer]) {
                (self.handlers.on_error)(self.handlers.ctx, global.take_exception(err));
            }
        } else {
            if let Err(err) = write_or_end.call(&global, duplex, &[JSValue::NULL]) {
                (self.handlers.on_error)(self.handlers.ctx, global.take_exception(err));
            }
        }
    }

    fn internal_write(this: *mut Self, encoded_data: &[u8]) {
        // SAFETY: SSLWrapper handlers ctx is `self as *mut Self`; live for the wrapper's lifetime.
        let this = unsafe { &mut *this };
        this.reset_timeout();

        // Possible scenarios:
        // Scenario 1: will not write if vm is shutting down (we cannot do anything about it)
        // Scenario 2: will not write if a exception is thrown (will be handled by onError)
        // Scenario 3: will be queued in memory and will be flushed later
        // Scenario 4: no write/end function exists (will be handled by onError)
        this.call_write_or_end(Some(encoded_data), true);
    }

    #[uws_callback(export = "UpgradedDuplex__flush")]
    pub(crate) fn flush(&mut self) {
        if let Some(wrapper) = &mut self.wrapper {
            let _ = wrapper.flush();
        }
    }

    fn on_internal_receive_data(&mut self, data: &[u8]) {
        // Note: reset the timeout first, then borrow `wrapper` (borrowck).
        if self.wrapper.is_some() {
            self.reset_timeout();
            if let Some(wrapper) = &mut self.wrapper {
                wrapper.receive_data(data);
            }
        }
    }

    pub(crate) fn on_timeout(&mut self) {
        bun_output::scoped_log!(UpgradedDuplex, "onTimeout");

        let has_been_cleared = self.event_loop_timer.state == EventLoopTimerState::CANCELLED
            || self.vm.is_none_or(|vm| {
                vm.script_execution_status() != bun_jsc::ScriptExecutionStatus::Running
            });

        self.event_loop_timer.state = EventLoopTimerState::FIRED;
        self.event_loop_timer.heap = Default::default();

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
            origin,
            global: Some(GlobalRef::from(global)),
            wrapper: None,
            handlers,
            ssl_error: CertError::default(),
            on_data_callback: JSValue::ZERO,
            on_end_callback: JSValue::ZERO,
            on_writable_callback: JSValue::ZERO,
            on_close_callback: JSValue::ZERO,
            event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::UpgradedDuplex),
            current_timeout: 0,
        }
    }

    pub(crate) fn get_js_handlers(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let array = JSValue::create_empty_array(global, 4)?;
        array.ensure_still_alive();

        let this_ptr = std::ptr::from_mut(self).cast::<c_void>();
        let js_wrapper = self.js_wrapper;
        array.put_index(
            global,
            0,
            lazy_js_handler(
                &mut self.on_data_callback,
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
                &mut self.on_end_callback,
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
                &mut self.on_writable_callback,
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
                &mut self.on_close_callback,
                js_wrapper,
                js_TLSSocket::duplex_on_close_set_cached,
                global,
                __jsc_host_on_close_js,
                this_ptr,
            ),
        )?;

        Ok(array)
    }

    pub(crate) fn start_tls(
        &mut self,
        ssl_options: &crate::server::server_config::SSLConfig,
        is_client: bool,
    ) -> Result<(), crate::Error> {
        self.wrapper = Some(super::ssl_wrapper::init(
            ssl_options,
            is_client,
            super::ssl_wrapper::Handlers {
                ctx: std::ptr::from_mut::<UpgradedDuplex>(self),
                on_open: Self::on_open,
                on_handshake: Self::on_handshake,
                on_data: Self::on_data,
                on_close: Self::on_close,
                write: Self::internal_write,
                on_session: Some(Self::on_session),
                on_keylog: Some(Self::on_keylog),
            },
        )?);

        self.wrapper.as_mut().unwrap().start();
        Ok(())
    }

    /// Adopts `ctx` (one ref) — freed on both success (via `wrapper.deinit`) and
    /// error. Mirrors `start_tls` but skips the
    /// `SSLConfig.asUSockets() → us_ssl_ctx_from_options()` round-trip so a
    /// memoised `SecureContext` can be reused on the duplex/named-pipe path.
    pub(crate) fn start_tls_with_ctx(
        &mut self,
        ctx: *mut bun_boringssl_sys::SSL_CTX,
        is_client: bool,
    ) -> Result<(), crate::Error> {
        // errdefer SSL_CTX_free(ctx) — free the adopted ref on the error path only.
        let ctx_guard = scopeguard::guard(ctx, |ctx| {
            // SAFETY: ctx is a valid SSL_CTX* with one ref adopted by this fn.
            unsafe { bun_boringssl_sys::SSL_CTX_free(ctx) };
        });
        let ctx_nn =
            NonNull::new(ctx).expect("caller passes a non-null SSL_CTX* with one adopted ref");
        self.wrapper = Some(WrapperType::init_with_ctx(
            ctx_nn,
            is_client,
            super::ssl_wrapper::Handlers {
                ctx: std::ptr::from_mut::<UpgradedDuplex>(self),
                on_open: Self::on_open,
                on_handshake: Self::on_handshake,
                on_data: Self::on_data,
                on_close: Self::on_close,
                write: Self::internal_write,
                on_session: Some(Self::on_session),
                on_keylog: Some(Self::on_keylog),
            },
        )?);
        // Success: disarm the errdefer.
        scopeguard::ScopeGuard::into_inner(ctx_guard);

        self.wrapper.as_mut().unwrap().start();
        Ok(())
    }

    #[uws_callback(export = "UpgradedDuplex__encode_and_write")]
    pub(crate) fn encode_and_write(&mut self, data: &[u8]) -> i32 {
        bun_output::scoped_log!(UpgradedDuplex, "encodeAndWrite (len: {})", data.len());
        if let Some(wrapper) = &mut self.wrapper {
            return i32::try_from(wrapper.write_data(data).unwrap_or(0)).expect("int cast");
        }
        0
    }

    #[uws_callback(export = "UpgradedDuplex__raw_write")]
    pub(crate) fn raw_write(&mut self, encoded_data: &[u8]) -> i32 {
        Self::internal_write(std::ptr::from_mut::<Self>(self), encoded_data);
        i32::try_from(encoded_data.len()).expect("int cast")
    }

    #[uws_callback(export = "UpgradedDuplex__close")]
    pub(crate) fn close(&mut self) {
        if let Some(wrapper) = &mut self.wrapper {
            let _ = wrapper.shutdown(true);
        }
    }

    #[uws_callback(export = "UpgradedDuplex__shutdown")]
    pub(crate) fn shutdown(&mut self) {
        if let Some(wrapper) = &mut self.wrapper {
            let _ = wrapper.shutdown(false);
        }
    }

    #[uws_callback(export = "UpgradedDuplex__shutdown_read")]
    pub(crate) fn shutdown_read(&mut self) {
        if let Some(wrapper) = &mut self.wrapper {
            let _ = wrapper.shutdown_read();
        }
    }

    #[uws_callback(export = "UpgradedDuplex__is_shutdown", no_catch)]
    pub(crate) fn is_shutdown(&self) -> bool {
        if let Some(wrapper) = &self.wrapper {
            return wrapper.is_shutdown();
        }
        true
    }

    #[uws_callback(export = "UpgradedDuplex__is_closed", no_catch)]
    pub(crate) fn is_closed(&self) -> bool {
        if let Some(wrapper) = &self.wrapper {
            return wrapper.is_closed();
        }
        true
    }

    #[uws_callback(export = "UpgradedDuplex__is_established", no_catch)]
    pub(crate) fn is_established(&self) -> bool {
        !self.is_closed()
    }

    pub(crate) fn ssl(&self) -> Option<*mut bun_boringssl_sys::SSL> {
        if let Some(wrapper) = &self.wrapper {
            return wrapper.ssl.map(|p| p.as_ptr());
        }
        None
    }

    #[uws_callback(export = "UpgradedDuplex__ssl_error", no_catch)]
    pub(crate) fn ssl_error(&self) -> us_bun_verify_error_t {
        us_bun_verify_error_t {
            error_no: self.ssl_error.error_no,
            code: self
                .ssl_error
                .code
                .as_deref()
                .map_or(c"".as_ptr(), |c| c.as_ptr()),
            reason: self
                .ssl_error
                .reason
                .as_deref()
                .map_or(c"".as_ptr(), |c| c.as_ptr()),
            // `struct us_bun_verify_error_t` (libusockets.h) has exactly these
            // three fields: { int error; const char* code; const char* reason }.
        }
    }

    pub(crate) fn reset_timeout(&mut self) {
        self.set_timeout_in_milliseconds(self.current_timeout);
    }

    pub(crate) fn set_timeout_in_milliseconds(&mut self, ms: c_uint) {
        if self.event_loop_timer.state == EventLoopTimerState::ACTIVE {
            timer_all().remove(&raw mut self.event_loop_timer);
        }
        self.current_timeout = ms;

        // if the interval is 0 means that we stop the timer
        if ms == 0 {
            return;
        }

        // reschedule the timer
        // Note: `EventLoopTimer.next` is the lower-tier `ElTimespec` stub;
        // bridge from `bun_core::Timespec` until the lower tier switches.
        let next =
            bun_core::Timespec::ms_from_now(bun_core::TimespecMockMode::AllowMockedTime, ms as i64);
        self.event_loop_timer.next = ElTimespec {
            sec: next.sec,
            nsec: next.nsec,
        };
        timer_all().insert(&raw mut self.event_loop_timer);
    }

    #[uws_callback(export = "UpgradedDuplex__set_timeout")]
    pub(crate) fn set_timeout(&mut self, seconds: c_uint) {
        bun_output::scoped_log!(UpgradedDuplex, "setTimeout({})", seconds);
        self.set_timeout_in_milliseconds(seconds * 1000);
    }

    /// Side-effecting teardown shared by `on_close` (early) and `Drop` (final).
    /// Idempotent — resets to empty state. Not the public API; callers drop the struct.
    fn teardown(&mut self) {
        bun_output::scoped_log!(UpgradedDuplex, "deinit");
        // clear the timer
        self.set_timeout(0);

        // Neuter in place rather than `self.wrapper = None`: `teardown()` can
        // run re-entrantly from `on_close` while a `SSLWrapper::handle_traffic`
        // frame is still on the stack with a `*mut Self` into the `Some`
        // payload. Assigning `None` to the `Option` runs `Drop` (fine -
        // `deinit()` nulls `ssl`/`ctx`) but then memmoves a fresh
        // `Option::None` value over the slot, whose payload bytes are stack
        // garbage - the in-flight frame's `Self::r(this).ssl` then reads junk
        // and `flush_pending_events` UAFs into BoringSSL. `deinit()` alone
        // leaves `ssl = None` / `closed_notified = true` readable so those
        // guards work; the `Option` is dropped for real when the parent
        // `DuplexUpgradeContext` frees on the next tick. See WindowsNamedPipe's
        // WRAPPER_BUSY for the sibling pattern.
        if let Some(wrapper) = self.wrapper.as_mut() {
            wrapper.deinit();
        }

        // Neuter the listener thunks so a late `origin` event sees null
        // function data instead of a freed `*mut Self`. GC-root clearing is
        // left to the wrapper's own collection.
        self.origin = JSValue::ZERO;
        for cb in [
            &mut self.on_data_callback,
            &mut self.on_end_callback,
            &mut self.on_writable_callback,
            &mut self.on_close_callback,
        ] {
            if !cb.is_empty() {
                host_fn::set_function_data(*cb, None);
                *cb = JSValue::ZERO;
            }
        }
        self.ssl_error = CertError::default();
    }
}

impl Drop for UpgradedDuplex {
    fn drop(&mut self) {
        self.teardown();
    }
}

#[bun_jsc::host_fn]
fn on_received_data(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_output::scoped_log!(UpgradedDuplex, "onReceivedData");

    let function = frame.callee();
    let args = frame.arguments_old::<1>();

    if let Some(self_ptr) = host_fn::get_function_data(function) {
        // SAFETY: function data was set to *mut UpgradedDuplex in get_js_handlers.
        let this = unsafe { bun_ptr::callback_ctx::<UpgradedDuplex>(self_ptr) };
        if args.len >= 1 {
            let data_arg = args.ptr[0];
            if !this.origin.is_empty() {
                if data_arg.is_empty_or_undefined_or_null() {
                    return Ok(JSValue::UNDEFINED);
                }
                if let Some(array_buffer) = data_arg.as_array_buffer(global) {
                    // yay we can read the data
                    let payload = array_buffer.slice();
                    this.on_internal_receive_data(payload);
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
        // SAFETY: function data was set to *mut UpgradedDuplex in get_js_handlers.
        let this = unsafe { bun_ptr::callback_ctx::<UpgradedDuplex>(self_ptr) };

        if this.wrapper.is_some() {
            (this.handlers.on_end)(this.handlers.ctx);
        }
    }
    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn]
fn on_writable(_global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_output::scoped_log!(UpgradedDuplex, "onWritable");

    let function = frame.callee();

    if let Some(self_ptr) = host_fn::get_function_data(function) {
        // SAFETY: function data was set to *mut UpgradedDuplex in get_js_handlers.
        let this = unsafe { bun_ptr::callback_ctx::<UpgradedDuplex>(self_ptr) };
        // flush pending data
        if let Some(wrapper) = &mut this.wrapper {
            let _ = wrapper.flush();
        }
        // call onWritable (will flush on demand)
        (this.handlers.on_writable)(this.handlers.ctx);
    }

    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn]
fn on_close_js(_global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_output::scoped_log!(UpgradedDuplex, "onCloseJS");

    let function = frame.callee();

    if let Some(self_ptr) = host_fn::get_function_data(function) {
        // SAFETY: function data was set to *mut UpgradedDuplex in get_js_handlers.
        let this = unsafe { bun_ptr::callback_ctx::<UpgradedDuplex>(self_ptr) };
        // flush pending data
        if let Some(wrapper) = &mut this.wrapper {
            let _ = wrapper.shutdown(true);
        }
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
pub(crate) extern "C" fn UpgradedDuplex__ssl(this: *const c_void) -> *mut bun_boringssl_sys::SSL {
    // SAFETY: `this` is a live `*const UpgradedDuplex` from the uws_sys opaque handle.
    unsafe {
        (*this.cast::<UpgradedDuplex>())
            .ssl()
            .unwrap_or(core::ptr::null_mut())
    }
}
