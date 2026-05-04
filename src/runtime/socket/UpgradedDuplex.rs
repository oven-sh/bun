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

use core::ffi::{c_char, c_uint, CStr};

use bun_jsc::{host_fn, CallFrame, JSGlobalObject, JSValue, JsResult, Strong, VirtualMachine};
use bun_uws::us_bun_verify_error_t;

use super::ssl_wrapper::SSLWrapper;
// TODO(port): confirm crate path for EventLoopTimer (bun.api.Timer.EventLoopTimer)
use bun_runtime::api::timer::EventLoopTimer;

bun_output::declare_scope!(UpgradedDuplex, visible);

pub struct UpgradedDuplex<'a> {
    pub wrapper: Option<WrapperType>,
    pub origin: Strong, // any duplex
    // JSC_BORROW per LIFETIMES.tsv — rust_type verbatim.
    pub global: Option<&'a JSGlobalObject>,
    pub ssl_error: CertError,
    // JSC_BORROW per LIFETIMES.tsv — rust_type verbatim.
    pub vm: &'a VirtualMachine,
    pub handlers: Handlers,
    pub on_data_callback: Strong,
    pub on_end_callback: Strong,
    pub on_writable_callback: Strong,
    pub on_close_callback: Strong,
    pub event_loop_timer: EventLoopTimer,
    pub current_timeout: u32,
}

#[derive(Default)]
pub struct CertError {
    pub error_no: i32,
    // Owned NUL-terminated copies (Zig: `[:0]const u8` allocated via `dupeZ`, freed in deinit).
    // `None` represents the Zig default `""`.
    pub code: Option<Box<CStr>>,
    pub reason: Option<Box<CStr>>,
}
// Zig `CertError.deinit` only freed `code`/`reason`; `Box<CStr>` drops automatically — no explicit Drop needed.

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
}

impl<'a> UpgradedDuplex<'a> {
    fn on_open(&mut self) {
        bun_output::scoped_log!(UpgradedDuplex, "onOpen");
        (self.handlers.on_open)(self.handlers.ctx);
    }

    fn on_data(&mut self, decoded_data: &[u8]) {
        bun_output::scoped_log!(UpgradedDuplex, "onData ({})", decoded_data.len());
        (self.handlers.on_data)(self.handlers.ctx, decoded_data);
    }

    fn on_handshake(&mut self, handshake_success: bool, ssl_error: us_bun_verify_error_t) {
        bun_output::scoped_log!(UpgradedDuplex, "onHandshake");

        self.ssl_error = CertError {
            error_no: ssl_error.error_no,
            code: if ssl_error.code.is_null() || ssl_error.error_no == 0 {
                None
            } else {
                // SAFETY: ssl_error.code is non-null and NUL-terminated (C string from BoringSSL verify error).
                Some(unsafe { CStr::from_ptr(ssl_error.code) }.into())
            },
            reason: if ssl_error.reason.is_null() || ssl_error.error_no == 0 {
                None
            } else {
                // SAFETY: ssl_error.reason is non-null and NUL-terminated.
                Some(unsafe { CStr::from_ptr(ssl_error.reason) }.into())
            },
        };
        (self.handlers.on_handshake)(self.handlers.ctx, handshake_success, ssl_error);
    }

    fn on_close(&mut self) {
        bun_output::scoped_log!(UpgradedDuplex, "onClose");
        // Zig: `defer this.deinit();` — runs after the two calls below.

        (self.handlers.on_close)(self.handlers.ctx);
        // closes the underlying duplex
        self.call_write_or_end(None, false);

        // Early teardown (Zig calls deinit explicitly here; struct itself is dropped later by parent).
        self.teardown();
    }

    fn call_write_or_end(&mut self, data: Option<&[u8]>, msg_more: bool) {
        if self.vm.is_shutting_down() {
            return;
        }
        let Some(duplex) = self.origin.get() else { return };
        // global is set in `from()` whenever origin is set.
        let Some(global) = self.global else { return };

        let write_or_end = if msg_more {
            match duplex.get_function(global, "write") {
                Ok(Some(f)) => f,
                _ => return,
            }
        } else {
            match duplex.get_function(global, "end") {
                Ok(Some(f)) => f,
                _ => return,
            }
        };

        if let Some(data) = data {
            // TODO(port): confirm bun_jsc path for ArrayBuffer::BinaryType::to_js(.Buffer, ...)
            let buffer = match bun_jsc::ArrayBuffer::binary_type_to_js(
                bun_jsc::BinaryType::Buffer,
                data,
                global,
            ) {
                Ok(b) => b,
                Err(err) => {
                    (self.handlers.on_error)(self.handlers.ctx, global.take_exception(err));
                    return;
                }
            };
            buffer.ensure_still_alive();

            if let Err(err) = write_or_end.call(global, duplex, &[buffer]) {
                (self.handlers.on_error)(self.handlers.ctx, global.take_exception(err));
            }
        } else {
            if let Err(err) = write_or_end.call(global, duplex, &[JSValue::NULL]) {
                (self.handlers.on_error)(self.handlers.ctx, global.take_exception(err));
            }
        }
    }

    fn internal_write(&mut self, encoded_data: &[u8]) {
        self.reset_timeout();

        // Possible scenarios:
        // Scenario 1: will not write if vm is shutting down (we cannot do anything about it)
        // Scenario 2: will not write if a exception is thrown (will be handled by onError)
        // Scenario 3: will be queued in memory and will be flushed later
        // Scenario 4: no write/end function exists (will be handled by onError)
        self.call_write_or_end(Some(encoded_data), true);
    }

    pub fn flush(&mut self) {
        if let Some(wrapper) = &mut self.wrapper {
            let _ = wrapper.flush();
        }
    }

    fn on_internal_receive_data(&mut self, data: &[u8]) {
        // PORT NOTE: reshaped for borrowck — Zig borrowed `wrapper` then called
        // `self.resetTimeout()` (which needs &mut self). Reordered: reset first, then borrow.
        if self.wrapper.is_some() {
            self.reset_timeout();
            if let Some(wrapper) = &mut self.wrapper {
                wrapper.receive_data(data);
            }
        }
    }

    pub fn on_timeout(&mut self) {
        bun_output::scoped_log!(UpgradedDuplex, "onTimeout");

        let has_been_cleared = self.event_loop_timer.state == EventLoopTimer::State::CANCELLED
            || self.vm.script_execution_status() != bun_jsc::ScriptExecutionStatus::Running;

        self.event_loop_timer.state = EventLoopTimer::State::FIRED;
        self.event_loop_timer.heap = Default::default();

        if has_been_cleared {
            return;
        }

        (self.handlers.on_timeout)(self.handlers.ctx);
    }

    pub fn from(global: &'a JSGlobalObject, origin: JSValue, handlers: Handlers) -> UpgradedDuplex<'a> {
        UpgradedDuplex {
            vm: global.bun_vm(),
            origin: Strong::create(origin, global),
            global: Some(global),
            wrapper: None,
            handlers,
            ssl_error: CertError::default(),
            on_data_callback: Strong::empty(),
            on_end_callback: Strong::empty(),
            on_writable_callback: Strong::empty(),
            on_close_callback: Strong::empty(),
            event_loop_timer: EventLoopTimer {
                next: bun_core::timespec::EPOCH,
                tag: EventLoopTimer::Tag::UpgradedDuplex,
                ..Default::default()
            },
            current_timeout: 0,
        }
    }

    pub fn get_js_handlers(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let array = JSValue::create_empty_array(global, 4)?;
        array.ensure_still_alive();

        {
            let callback = match self.on_data_callback.get() {
                Some(cb) => cb,
                None => {
                    let data_callback = host_fn::new_function_with_data(
                        global,
                        None,
                        0,
                        on_received_data,
                        self as *mut _ as *mut (),
                    );
                    data_callback.ensure_still_alive();

                    host_fn::set_function_data(data_callback, self as *mut _ as *mut ());

                    self.on_data_callback = Strong::create(data_callback, global);
                    data_callback
                }
            };
            array.put_index(global, 0, callback)?;
        }

        {
            let callback = match self.on_end_callback.get() {
                Some(cb) => cb,
                None => {
                    let end_callback = host_fn::new_function_with_data(
                        global,
                        None,
                        0,
                        on_end,
                        self as *mut _ as *mut (),
                    );
                    end_callback.ensure_still_alive();

                    host_fn::set_function_data(end_callback, self as *mut _ as *mut ());

                    self.on_end_callback = Strong::create(end_callback, global);
                    end_callback
                }
            };
            array.put_index(global, 1, callback)?;
        }

        {
            let callback = match self.on_writable_callback.get() {
                Some(cb) => cb,
                None => {
                    let writable_callback = host_fn::new_function_with_data(
                        global,
                        None,
                        0,
                        on_writable,
                        self as *mut _ as *mut (),
                    );
                    writable_callback.ensure_still_alive();

                    host_fn::set_function_data(writable_callback, self as *mut _ as *mut ());
                    self.on_writable_callback = Strong::create(writable_callback, global);
                    writable_callback
                }
            };
            array.put_index(global, 2, callback)?;
        }

        {
            let callback = match self.on_close_callback.get() {
                Some(cb) => cb,
                None => {
                    let close_callback = host_fn::new_function_with_data(
                        global,
                        None,
                        0,
                        on_close_js,
                        self as *mut _ as *mut (),
                    );
                    close_callback.ensure_still_alive();

                    host_fn::set_function_data(close_callback, self as *mut _ as *mut ());
                    self.on_close_callback = Strong::create(close_callback, global);
                    close_callback
                }
            };
            array.put_index(global, 3, callback)?;
        }

        Ok(array)
    }

    pub fn start_tls(
        &mut self,
        ssl_options: &bun_runtime::api::server_config::SSLConfig,
        is_client: bool,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        self.wrapper = Some(WrapperType::init(
            ssl_options,
            is_client,
            // TODO(port): confirm SSLWrapper handlers struct shape (ctx + 5 fn ptrs).
            super::ssl_wrapper::Handlers {
                ctx: self as *mut UpgradedDuplex,
                on_open: Self::on_open,
                on_handshake: Self::on_handshake,
                on_data: Self::on_data,
                on_close: Self::on_close,
                write: Self::internal_write,
            },
        )?);

        self.wrapper.as_mut().unwrap().start();
        Ok(())
    }

    /// Adopts `ctx` (one ref) — freed on both success (via `wrapper.deinit`) and
    /// error. Mirrors `start_tls` but skips the
    /// `SSLConfig.asUSockets() → us_ssl_ctx_from_options()` round-trip so a
    /// memoised `SecureContext` can be reused on the duplex/named-pipe path.
    pub fn start_tls_with_ctx(
        &mut self,
        ctx: *mut bun_boringssl_sys::SSL_CTX,
        is_client: bool,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        // errdefer SSL_CTX_free(ctx) — free the adopted ref on the error path only.
        let ctx_guard = scopeguard::guard(ctx, |ctx| {
            // SAFETY: ctx is a valid SSL_CTX* with one ref adopted by this fn.
            unsafe { bun_boringssl_sys::SSL_CTX_free(ctx) };
        });
        self.wrapper = Some(WrapperType::init_with_ctx(
            ctx,
            is_client,
            super::ssl_wrapper::Handlers {
                ctx: self as *mut UpgradedDuplex,
                on_open: Self::on_open,
                on_handshake: Self::on_handshake,
                on_data: Self::on_data,
                on_close: Self::on_close,
                write: Self::internal_write,
            },
        )?);
        // Success: disarm the errdefer.
        scopeguard::ScopeGuard::into_inner(ctx_guard);

        self.wrapper.as_mut().unwrap().start();
        Ok(())
    }

    pub fn encode_and_write(&mut self, data: &[u8]) -> i32 {
        bun_output::scoped_log!(UpgradedDuplex, "encodeAndWrite (len: {})", data.len());
        if let Some(wrapper) = &mut self.wrapper {
            return i32::try_from(wrapper.write_data(data).unwrap_or(0)).unwrap();
        }
        0
    }

    pub fn raw_write(&mut self, encoded_data: &[u8]) -> i32 {
        self.internal_write(encoded_data);
        i32::try_from(encoded_data.len()).unwrap()
    }

    pub fn close(&mut self) {
        if let Some(wrapper) = &mut self.wrapper {
            let _ = wrapper.shutdown(true);
        }
    }

    pub fn shutdown(&mut self) {
        if let Some(wrapper) = &mut self.wrapper {
            let _ = wrapper.shutdown(false);
        }
    }

    pub fn shutdown_read(&mut self) {
        if let Some(wrapper) = &mut self.wrapper {
            let _ = wrapper.shutdown_read();
        }
    }

    pub fn is_shutdown(&self) -> bool {
        if let Some(wrapper) = &self.wrapper {
            return wrapper.is_shutdown();
        }
        true
    }

    pub fn is_closed(&self) -> bool {
        if let Some(wrapper) = &self.wrapper {
            return wrapper.is_closed();
        }
        true
    }

    pub fn is_established(&self) -> bool {
        !self.is_closed()
    }

    pub fn ssl(&self) -> Option<*mut bun_boringssl_sys::SSL> {
        if let Some(wrapper) = &self.wrapper {
            return wrapper.ssl;
        }
        None
    }

    pub fn ssl_error(&self) -> us_bun_verify_error_t {
        us_bun_verify_error_t {
            error_no: self.ssl_error.error_no,
            code: self
                .ssl_error
                .code
                .as_deref()
                .map_or(b"\0".as_ptr().cast(), |c| c.as_ptr()),
            reason: self
                .ssl_error
                .reason
                .as_deref()
                .map_or(b"\0".as_ptr().cast(), |c| c.as_ptr()),
            // TODO(port): us_bun_verify_error_t may have more fields; Zig used implicit defaults.
        }
    }

    pub fn reset_timeout(&mut self) {
        self.set_timeout_in_milliseconds(self.current_timeout);
    }

    pub fn set_timeout_in_milliseconds(&mut self, ms: c_uint) {
        if self.event_loop_timer.state == EventLoopTimer::State::ACTIVE {
            self.vm.timer.remove(&mut self.event_loop_timer);
        }
        self.current_timeout = ms;

        // if the interval is 0 means that we stop the timer
        if ms == 0 {
            return;
        }

        // reschedule the timer
        self.event_loop_timer.next =
            bun_core::timespec::ms_from_now(bun_core::timespec::Mock::AllowMockedTime, ms);
        self.vm.timer.insert(&mut self.event_loop_timer);
    }

    pub fn set_timeout(&mut self, seconds: c_uint) {
        bun_output::scoped_log!(UpgradedDuplex, "setTimeout({})", seconds);
        self.set_timeout_in_milliseconds(seconds * 1000);
    }

    /// Side-effecting teardown shared by `on_close` (early) and `Drop` (final).
    /// Idempotent — resets to empty state. Not the public API; callers drop the struct.
    fn teardown(&mut self) {
        bun_output::scoped_log!(UpgradedDuplex, "deinit");
        // clear the timer
        self.set_timeout(0);

        self.wrapper = None; // Drop runs SSLWrapper teardown

        self.origin = Strong::empty();
        if let Some(callback) = self.on_data_callback.get() {
            host_fn::set_function_data(callback, core::ptr::null_mut());
            self.on_data_callback = Strong::empty();
        }
        if let Some(callback) = self.on_end_callback.get() {
            host_fn::set_function_data(callback, core::ptr::null_mut());
            self.on_end_callback = Strong::empty();
        }
        if let Some(callback) = self.on_writable_callback.get() {
            host_fn::set_function_data(callback, core::ptr::null_mut());
            self.on_writable_callback = Strong::empty();
        }
        if let Some(callback) = self.on_close_callback.get() {
            host_fn::set_function_data(callback, core::ptr::null_mut());
            self.on_close_callback = Strong::empty();
        }
        self.ssl_error = CertError::default();
    }
}

impl Drop for UpgradedDuplex<'_> {
    fn drop(&mut self) {
        self.teardown();
    }
}

#[bun_jsc::host_fn]
fn on_received_data(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_output::scoped_log!(UpgradedDuplex, "onReceivedData");

    let function = frame.callee();
    let args = frame.arguments_old(1);

    if let Some(self_ptr) = host_fn::get_function_data(function) {
        // SAFETY: function data was set to *mut UpgradedDuplex in get_js_handlers.
        let this = unsafe { &mut *(self_ptr as *mut UpgradedDuplex) };
        if args.len() >= 1 {
            let data_arg = args.ptr[0];
            if this.origin.has() {
                if data_arg.is_empty_or_undefined_or_null() {
                    return Ok(JSValue::UNDEFINED);
                }
                if let Some(array_buffer) = data_arg.as_array_buffer(global) {
                    // yay we can read the data
                    let payload = array_buffer.slice();
                    this.on_internal_receive_data(payload);
                } else {
                    // node.js errors in this case with the same error, lets keep it consistent
                    // TODO(port): confirm bun_jsc API for `globalObject.ERR(.STREAM_WRAP, fmt, args).toJS()`.
                    let error_value = global
                        .err(
                            bun_jsc::ErrorCode::STREAM_WRAP,
                            "Stream has StringDecoder set or is in objectMode",
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
        let this = unsafe { &mut *(self_ptr as *mut UpgradedDuplex) };

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
        let this = unsafe { &mut *(self_ptr as *mut UpgradedDuplex) };
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
        let this = unsafe { &mut *(self_ptr as *mut UpgradedDuplex) };
        // flush pending data
        if let Some(wrapper) = &mut this.wrapper {
            let _ = wrapper.shutdown(true);
        }
    }

    Ok(JSValue::UNDEFINED)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/socket/UpgradedDuplex.zig (504 lines)
//   confidence: medium
//   todos:      7
//   notes:      JSC_BORROW fields use &'a per LIFETIMES.tsv (struct gains <'a>); deinit→Drop with private teardown() for early call from on_close; SSLWrapper handlers struct shape & several bun_jsc helper paths need confirmation.
// ──────────────────────────────────────────────────────────────────────────
