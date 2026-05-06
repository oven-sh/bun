use core::cell::Cell;
use core::ffi::{c_int, c_uint, c_void};
use core::ptr;

use bitflags::bitflags;

use bun_collections::BabyList;
use bun_uws as uws;
use bun_uws_sys as uws_sys;

use crate::server::jsc::{self, JSGlobalObject, JSValue, JsResult, StrongOptional, VirtualMachine};
use crate::server::{AnyServer, HTTPStatusText, ServerWebSocket};
use crate::webcore::AutoFlusher;

/// Intrusive ref-counted; `ref_count` is managed by `bun_ptr::RefPtr<Self>`
/// (FFI rule — `*mut NodeHTTPResponse` is the m_ctx payload of a
/// `.classes.ts` wrapper). `deinit` (gated below) runs when count hits zero.
// TODO(b2-blocked): #[bun_jsc::JsClass] + impl bun_ptr::RefCounted.
pub struct NodeHTTPResponse {
    pub ref_count: Cell<u32>,

    pub raw_response: Option<uws::AnyResponse>,

    pub flags: Flags,

    pub poll_ref: jsc::Ref,

    pub body_read_state: BodyReadState,
    pub body_read_ref: jsc::Ref,
    pub promise: StrongOptional, // Strong.Optional
    pub server: AnyServer,

    /// When you call pause() on the node:http IncomingMessage
    /// We might've already read from the socket.
    /// So we need to buffer that data.
    /// This should be pretty uncommon though.
    pub buffered_request_body_data_during_pause: BabyList<u8>,
    pub bytes_written: usize,

    pub upgrade_context: UpgradeCTX,

    pub auto_flusher: AutoFlusher,
}


mod _orig_imports {
use bun_http::Method as HttpMethod;
use bun_jsc::{
    self as jsc, ArrayBuffer, CallFrame, JSGlobalObject, JSValue, JsResult, Strong, VirtualMachine,
};
use bun_output::{declare_scope, scoped_log};
use bun_str::ZigString;
use bun_uws as uws;
use bun_uws_sys as uws_sys;

use crate::server::{AnyServer, HTTPStatusText, ServerWebSocket};
use crate::webcore::AutoFlusher;
}

// Intrusive refcount methods (`ref` / `deref`) are provided by `bun_ptr::IntrusiveRc`
// over the `ref_count` field; `deinit` is the drop callback.
// TODO(port): wire `bun_ptr::IntrusiveRc<NodeHTTPResponse>` with `deinit` as destructor.

bitflags! {
    #[repr(transparent)]
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct Flags: u8 {
        const SOCKET_CLOSED                       = 1 << 0;
        const REQUEST_HAS_COMPLETED               = 1 << 1;
        const ENDED                               = 1 << 2;
        const UPGRADED                            = 1 << 3;
        const HAS_CUSTOM_ON_DATA                  = 1 << 4;
        const IS_REQUEST_PENDING                  = 1 << 5;
        const IS_DATA_BUFFERED_DURING_PAUSE       = 1 << 6;
        /// Did we receive the last chunk of data during pause?
        const IS_DATA_BUFFERED_DURING_PAUSE_LAST  = 1 << 7;
    }
}

impl Default for Flags {
    fn default() -> Self {
        // is_request_pending defaults to true; all others false.
        Flags::IS_REQUEST_PENDING
    }
}

impl Flags {
    /// Did the user end the request?
    #[inline]
    pub fn is_requested_completed_or_ended(&self) -> bool {
        self.intersects(Flags::REQUEST_HAS_COMPLETED | Flags::ENDED)
    }

    #[inline]
    pub fn is_done(&self) -> bool {
        self.is_requested_completed_or_ended() || self.contains(Flags::SOCKET_CLOSED)
    }
}

pub struct UpgradeCTX {
    pub context: *mut uws_sys::WebSocketUpgradeContext,
    // request will be detached when go async
    pub request: *mut uws_sys::Request,

    // we need to store this, if we wanna to enable async upgrade
    pub sec_websocket_key: Box<[u8]>,
    pub sec_websocket_protocol: Box<[u8]>,
    pub sec_websocket_extensions: Box<[u8]>,
}

impl Default for UpgradeCTX {
    fn default() -> Self {
        Self {
            context: ptr::null_mut(),
            request: ptr::null_mut(),
            sec_websocket_key: Box::default(),
            sec_websocket_protocol: Box::default(),
            sec_websocket_extensions: Box::default(),
        }
    }
}

impl UpgradeCTX {
    // this can be called multiple times
    // PORT NOTE: Zig `deinit` renamed `reset` — mid-lifetime reset, not a destructor (PORTING.md: never expose `pub fn deinit(&mut self)`).
    pub fn reset(&mut self) {
        // Dropping the old Box<[u8]> values frees them; raw pointers are nulled.
        *self = UpgradeCTX::default();
    }

     // TODO(b2-blocked): bun_uws_sys::Request::header (cycle-5-B).
    pub fn preserve_web_socket_headers_if_needed(&mut self) {
        if !self.request.is_null() {
            // SAFETY: `request` is a live uws Request handed to us by the C callback;
            // we null it immediately after reading headers so it cannot be used past
            // its native lifetime.
            let request = unsafe { &*self.request };
            self.request = ptr::null_mut();

            let sec_websocket_key = request.header(b"sec-websocket-key").unwrap_or(b"");
            let sec_websocket_protocol = request.header(b"sec-websocket-protocol").unwrap_or(b"");
            let sec_websocket_extensions =
                request.header(b"sec-websocket-extensions").unwrap_or(b"");

            if !sec_websocket_key.is_empty() {
                self.sec_websocket_key = Box::<[u8]>::from(sec_websocket_key);
            }
            if !sec_websocket_protocol.is_empty() {
                self.sec_websocket_protocol = Box::<[u8]>::from(sec_websocket_protocol);
            }
            if !sec_websocket_extensions.is_empty() {
                self.sec_websocket_extensions = Box::<[u8]>::from(sec_websocket_extensions);
            }
        }
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum BodyReadState {
    None = 0,
    Pending = 1,
    Done = 2,
}

impl Default for BodyReadState {
    fn default() -> Self {
        BodyReadState::None
    }
}

// TODO(port): move to runtime_sys
unsafe extern "C" {
    fn Bun__getNodeHTTPResponseThisValue(is_ssl: bool, socket: *mut c_void) -> JSValue;
    fn Bun__getNodeHTTPServerSocketThisValue(is_ssl: bool, socket: *mut c_void) -> JSValue;

    fn NodeHTTPServer__writeHead_http(
        global_object: *const JSGlobalObject,
        status_message: *const u8,
        status_message_length: usize,
        headers_object_value: JSValue,
        response: *mut c_void,
    );

    fn NodeHTTPServer__writeHead_https(
        global_object: *const JSGlobalObject,
        status_message: *const u8,
        status_message_length: usize,
        headers_object_value: JSValue,
        response: *mut c_void,
    );
}

// ─── JS host_fn bodies + uws response writes (gated) ─────────────────────────
// Everything below is `#[bun_jsc::host_fn]` getters/methods plus
// on_data/on_abort/write_head/end which call bun_uws AnyResponse write/end/
// on_aborted/on_writable (cycle-5-B) and bun_jsc JSValue/CallFrame methods.
// TODO(b2-blocked): bun_jsc + bun_uws response surface.

mod _gated {
use super::*;
use bstr::BStr;
use bun_core::scoped_log;
use bun_http::Method as HttpMethod;
use bun_str::{ZigString, ZigStringSlice};
use crate::server::jsc::{CallFrame, ErrorCode};
use crate::webcore::HasAutoFlusher;

bun_core::declare_scope!(NodeHTTPResponse, visible);

// ─── Local shims (upstream methods gated/missing) ────────────────────────────

/// `VirtualMachine::get()` returns `*mut`; deref once for callers that need `&mut`.
#[inline]
fn vm_get<'a>() -> &'a mut VirtualMachine {
    // SAFETY: JS-thread only; the global VM pointer is non-null once the runtime is up.
    unsafe { &mut *VirtualMachine::get() }
}

/// `JSGlobalObject::bun_vm()` (lib.rs variant) returns `*mut`; deref for `Ref::ref/unref`.
#[inline]
fn bun_vm_mut(global: &JSGlobalObject) -> &mut VirtualMachine {
    // SAFETY: JS-thread only; bun_vm() returns the live VM for this global.
    unsafe { &mut *global.bun_vm() }
}

/// Local extension for `JSValue::with_async_context_if_needed` (upstream gated).
trait JSValueAsyncCtxExt {
    fn with_async_context_if_needed(self, global: &JSGlobalObject) -> JSValue;
}
impl JSValueAsyncCtxExt for JSValue {
    #[inline]
    fn with_async_context_if_needed(self, _global: &JSGlobalObject) -> JSValue {
        // TODO(port): blocked_on: bun_jsc::JSValue::with_async_context_if_needed
        let _ = _global;
        self
    }
}

/// Local shim for `globalObject.ERR(.CODE, msg, .{}).throw()` (Zig codegen helpers).
struct NodeHttpErrBuilder<'a> {
    global: &'a JSGlobalObject,
    code: ErrorCode,
    msg: &'static str,
}
impl<'a> NodeHttpErrBuilder<'a> {
    #[inline]
    fn throw<T>(self) -> JsResult<T> {
        Err(self.global.err(self.code, format_args!("{}", self.msg)).throw())
    }
}
trait NodeHttpGlobalErrExt {
    fn err_http_headers_sent(&self, msg: &'static str) -> NodeHttpErrBuilder<'_>;
    fn err_stream_already_finished(&self, msg: &'static str) -> NodeHttpErrBuilder<'_>;
    fn err_stream_write_after_end(&self, msg: &'static str) -> NodeHttpErrBuilder<'_>;
    fn err_http_content_length_mismatch(&self, msg: &'static str) -> NodeHttpErrBuilder<'_>;
    fn err_invalid_char(&self, msg: &'static str) -> NodeHttpErrBuilder<'_>;
}
impl NodeHttpGlobalErrExt for JSGlobalObject {
    #[inline]
    fn err_http_headers_sent(&self, msg: &'static str) -> NodeHttpErrBuilder<'_> {
        NodeHttpErrBuilder { global: self, code: ErrorCode::ERR_HTTP_HEADERS_SENT, msg }
    }
    #[inline]
    fn err_stream_already_finished(&self, msg: &'static str) -> NodeHttpErrBuilder<'_> {
        NodeHttpErrBuilder { global: self, code: ErrorCode::ERR_STREAM_ALREADY_FINISHED, msg }
    }
    #[inline]
    fn err_stream_write_after_end(&self, msg: &'static str) -> NodeHttpErrBuilder<'_> {
        NodeHttpErrBuilder { global: self, code: ErrorCode::ERR_STREAM_WRITE_AFTER_END, msg }
    }
    #[inline]
    fn err_http_content_length_mismatch(&self, msg: &'static str) -> NodeHttpErrBuilder<'_> {
        NodeHttpErrBuilder { global: self, code: ErrorCode::ERR_HTTP_CONTENT_LENGTH_MISMATCH, msg }
    }
    #[inline]
    fn err_invalid_char(&self, msg: &'static str) -> NodeHttpErrBuilder<'_> {
        NodeHttpErrBuilder { global: self, code: ErrorCode::ERR_INVALID_CHAR, msg }
    }
}

/// AnyResponse `is_ssl()` shim (upstream lacks this accessor).
#[inline]
fn any_response_is_ssl(r: &uws::AnyResponse) -> bool {
    matches!(r, uws::AnyResponse::SSL(_))
}

// uSockets callback adapters: AnyResponse::on_data/on_timeout/on_writable expect
// `Fn(*mut U, ...)` (capture-less); adapt to `&mut self` method bodies.
fn on_timeout_shim(this: *mut NodeHTTPResponse, resp: uws::AnyResponse) {
    // SAFETY: registered with `self as *mut _`; live while callback is armed.
    unsafe { (*this).on_timeout(resp) }
}
fn on_data_shim(this: *mut NodeHTTPResponse, chunk: &[u8], last: bool) {
    // SAFETY: see on_timeout_shim.
    unsafe { (*this).on_data(chunk, last) }
}
fn on_buffer_paused_shim(this: *mut NodeHTTPResponse, chunk: &[u8], last: bool) {
    // SAFETY: see on_timeout_shim.
    unsafe { (*this).on_buffer_request_body_while_paused(chunk, last) }
}
fn on_drain_shim(this: *mut NodeHTTPResponse, off: u64, resp: uws::AnyResponse) -> bool {
    // SAFETY: see on_timeout_shim.
    unsafe { (*this).on_drain(off, resp) }
}

impl HasAutoFlusher for NodeHTTPResponse {
    #[inline]
    fn auto_flusher(&mut self) -> &mut AutoFlusher {
        &mut self.auto_flusher
    }
    fn on_auto_flush(this: *mut Self) -> bool {
        // SAFETY: registered as `&mut Self` cast to `*mut c_void`; drained on JS thread.
        unsafe { (*this).on_auto_flush() }
    }
}

// JsClass impl: hand-roll the codegen externs (`.classes.ts` emits
// `NodeHTTPResponse__{fromJS,fromJSDirect,create,getConstructor}`).
unsafe extern "C" {
    fn NodeHTTPResponse__fromJS(value: JSValue) -> Option<core::ptr::NonNull<NodeHTTPResponse>>;
    fn NodeHTTPResponse__fromJSDirect(value: JSValue) -> Option<core::ptr::NonNull<NodeHTTPResponse>>;
    fn NodeHTTPResponse__create(ptr: *mut NodeHTTPResponse, global: *mut JSGlobalObject) -> JSValue;
    fn NodeHTTPResponse__getConstructor(global: *mut JSGlobalObject) -> JSValue;
}
impl jsc::JsClass for NodeHTTPResponse {
    fn from_js(value: JSValue) -> Option<*mut Self> {
        // SAFETY: codegen extern; `value` is a valid JSValue.
        unsafe { NodeHTTPResponse__fromJS(value) }.map(|p| p.as_ptr())
    }
    fn from_js_direct(value: JSValue) -> Option<*mut Self> {
        // SAFETY: codegen extern.
        unsafe { NodeHTTPResponse__fromJSDirect(value) }.map(|p| p.as_ptr())
    }
    fn to_js(self, _global: &JSGlobalObject) -> JSValue {
        // Never called by-value; callers go through `to_js_ptr` below.
        unreachable!("NodeHTTPResponse::to_js by-value")
    }
    fn get_constructor(global: &JSGlobalObject) -> JSValue {
        // SAFETY: codegen extern.
        unsafe { NodeHTTPResponse__getConstructor(global as *const _ as *mut _) }
    }
}
impl NodeHTTPResponse {
    #[inline]
    fn to_js_ptr(this: *mut Self, global: &JSGlobalObject) -> JSValue {
        // SAFETY: `this` is a heap-allocated `Box::into_raw` from `create`.
        unsafe { NodeHTTPResponse__create(this, global as *const _ as *mut _) }
    }
}

/// Unpack the `AnyServer` tagged-pointer u64 handed across FFI from C++.
/// Zig used `bun.ptr.TaggedPointerUnion`; the Rust port stores `(tag, ptr)`
/// separately. C++ still passes the packed form, so unpack here.
#[inline]
fn any_server_from_packed(_packed: u64) -> AnyServer {
    todo!("blocked_on: bun_ptr::TaggedPointerUnion unpack for AnyServer")
}

// Codegen: JSNodeHTTPResponse wrapper (toJS/fromJS/fromJSDirect + cached property accessors).
// TODO(port): generated by .classes.ts codegen — `js::*` accessors below are emitted there.
#[allow(non_snake_case)]
pub mod js {
    pub use super::generated::JSNodeHTTPResponse::*;
}

impl NodeHTTPResponse {
    pub fn get_this_value(&self) -> JSValue {
        if self.flags.contains(Flags::SOCKET_CLOSED)
            || self.flags.contains(Flags::UPGRADED)
            || self.raw_response.is_none()
        {
            return JSValue::ZERO;
        }
        let raw = self.raw_response.as_ref().unwrap();
        // SAFETY: raw_response is Some (checked above) and socket() returns a live uSockets handle.
        unsafe { Bun__getNodeHTTPResponseThisValue(any_response_is_ssl(raw), raw.socket().cast()) }
    }

    pub fn get_server_socket_value(&self) -> JSValue {
        if self.flags.contains(Flags::SOCKET_CLOSED)
            || self.flags.contains(Flags::UPGRADED)
            || self.raw_response.is_none()
        {
            return JSValue::ZERO;
        }
        let raw = self.raw_response.as_ref().unwrap();
        // SAFETY: see get_this_value.
        unsafe { Bun__getNodeHTTPServerSocketThisValue(any_response_is_ssl(raw), raw.socket().cast()) }
    }

    pub fn pause_socket(&mut self) {
        scoped_log!(NodeHTTPResponse, "pauseSocket");
        if self.flags.contains(Flags::SOCKET_CLOSED)
            || self.flags.contains(Flags::UPGRADED)
            || self.raw_response.is_none()
            || self.raw_response.as_ref().unwrap().is_connect_request()
        {
            return;
        }
        self.raw_response.as_ref().unwrap().pause();
    }

    pub fn resume_socket(&mut self) {
        scoped_log!(NodeHTTPResponse, "resumeSocket");
        if self.flags.contains(Flags::SOCKET_CLOSED)
            || self.flags.contains(Flags::UPGRADED)
            || self.raw_response.is_none()
            || self.raw_response.as_ref().unwrap().is_connect_request()
        {
            return;
        }
        self.raw_response.as_ref().unwrap().resume_();
    }

    pub fn upgrade(
        &mut self,
        data_value: JSValue,
        sec_websocket_protocol: ZigString,
        sec_websocket_extensions: ZigString,
    ) -> bool {
        let upgrade_ctx = self.upgrade_context.context;
        if upgrade_ctx.is_null() {
            return false;
        }
        let Some(ws_handler) = self.server.web_socket_handler() else {
            return false;
        };
        // PORT NOTE: reshaped for borrowck — extend handler lifetime past &mut self method calls.
        // SAFETY: JS-thread only; the server (and its websocket config) outlives this call.
        let ws_handler: &mut crate::server::WebSocketServerHandler =
            unsafe { &mut *(ws_handler as *mut _) };
        let socket_value = self.get_server_socket_value();
        if socket_value.is_empty() {
            return false;
        }
        self.resume_socket();

        // PORT NOTE: Zig `defer { setOnAbortedHandler(); upgrade_context.deinit(); }` inlined at the
        // tail of this fn (no early returns past this point), so no scopeguard needed.

        data_value.ensure_still_alive();

        let ws = ServerWebSocket::init(ws_handler, data_value, None);

        let mut sec_websocket_protocol_str: Option<ZigStringSlice> = None;
        let mut sec_websocket_extensions_str: Option<ZigStringSlice> = None;

        let sec_websocket_protocol_value: &[u8] = 'brk: {
            if sec_websocket_protocol.len == 0 {
                if !self.upgrade_context.request.is_null() {
                    // SAFETY: request pointer is live until preserve_web_socket_headers_if_needed nulls it.
                    let request = unsafe { &*self.upgrade_context.request };
                    break 'brk request.header(b"sec-websocket-protocol").unwrap_or(b"");
                } else {
                    break 'brk &self.upgrade_context.sec_websocket_protocol;
                }
            }
            sec_websocket_protocol_str = Some(sec_websocket_protocol.to_slice());
            break 'brk sec_websocket_protocol_str.as_ref().unwrap().slice();
        };

        let sec_websocket_extensions_value: &[u8] = 'brk: {
            if sec_websocket_extensions.len == 0 {
                if !self.upgrade_context.request.is_null() {
                    // SAFETY: see above.
                    let request = unsafe { &*self.upgrade_context.request };
                    break 'brk request.header(b"sec-websocket-extensions").unwrap_or(b"");
                } else {
                    break 'brk &self.upgrade_context.sec_websocket_extensions;
                }
            }
            sec_websocket_extensions_str = Some(sec_websocket_extensions.to_slice());
            break 'brk sec_websocket_extensions_str.as_ref().unwrap().slice();
        };

        let websocket_key: &[u8] = if !self.upgrade_context.request.is_null() {
            // SAFETY: see above.
            let request = unsafe { &*self.upgrade_context.request };
            request.header(b"sec-websocket-key").unwrap_or(b"")
        } else {
            &self.upgrade_context.sec_websocket_key
        };

        if let Some(raw_response) = self.raw_response.take() {
            self.flags.insert(Flags::UPGRADED);
            // Unref the poll_ref since the socket is now upgraded to WebSocket
            // and will have its own lifecycle management
            // SAFETY: server.global_this() is non-null while the server is alive.
            let vm = unsafe { &mut *(*self.server.global_this()).bun_vm() };
            self.poll_ref.unref(vm);
            // SAFETY: upgrade_ctx checked non-null above.
            let ctx = unsafe { &mut *upgrade_ctx };
            let _ = raw_response.upgrade::<ServerWebSocket>(
                ws,
                websocket_key,
                sec_websocket_protocol_value,
                sec_websocket_extensions_value,
                Some(ctx),
            );
        }

        // Drop the temporary slices before mutating upgrade_context.
        drop(sec_websocket_protocol_str);
        drop(sec_websocket_extensions_str);

        // Deferred: equivalent of Zig `defer` block above.
        self.set_on_aborted_handler();
        self.upgrade_context.reset();

        true
    }

    pub fn maybe_stop_reading_body(&mut self, vm: &mut VirtualMachine, this_value: JSValue) {
        self.upgrade_context.reset(); // we can discard the upgrade context now

        if (self.flags.contains(Flags::UPGRADED)
            || self.flags.contains(Flags::SOCKET_CLOSED)
            || self.flags.contains(Flags::ENDED))
            && (self.body_read_ref.has || self.body_read_state == BodyReadState::Pending)
            && (!self.flags.contains(Flags::HAS_CUSTOM_ON_DATA)
                || js::on_data_get_cached(this_value).is_none())
        {
            let had_ref = self.body_read_ref.has;
            if !self.flags.contains(Flags::UPGRADED) && !self.flags.contains(Flags::SOCKET_CLOSED) {
                scoped_log!(NodeHTTPResponse, "clearOnData");
                if let Some(raw_response) = &self.raw_response {
                    raw_response.clear_on_data();
                }
            }

            self.body_read_ref.unref(vm);
            self.body_read_state = BodyReadState::Done;

            if had_ref {
                self.mark_request_as_done_if_necessary();
            }
        }
    }

    pub fn should_request_be_pending(&self) -> bool {
        if self.flags.contains(Flags::SOCKET_CLOSED) {
            return false;
        }

        if self.flags.contains(Flags::ENDED) {
            return self.body_read_state == BodyReadState::Pending;
        }

        true
    }

    #[bun_jsc::host_fn(method)]
    pub fn dump_request_body(
        &mut self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let this_value = callframe.this();
        if self.buffered_request_body_data_during_pause.cap > 0 {
            self.buffered_request_body_data_during_pause.clear_and_free();
        }
        if !self.flags.contains(Flags::REQUEST_HAS_COMPLETED) {
            self.clear_on_data_callback(this_value, global_object);
        }

        Ok(JSValue::UNDEFINED)
    }

    fn mark_request_as_done(&mut self) {
        scoped_log!(NodeHTTPResponse, "markRequestAsDone()");
        // defer this.deref(); — moved to end of fn body.
        self.flags.remove(Flags::IS_REQUEST_PENDING);

        let vm = vm_get();
        self.clear_on_data_callback(self.get_this_value(), vm.global());
        self.upgrade_context.reset();

        self.buffered_request_body_data_during_pause.clear_and_free();
        let mut server = self.server;
        self.poll_ref.unref(vm_get());
        self.unregister_auto_flush();

        server.on_request_complete();

        self.deref();
    }

    fn mark_request_as_done_if_necessary(&mut self) {
        if self.flags.contains(Flags::IS_REQUEST_PENDING) && !self.should_request_be_pending() {
            self.mark_request_as_done();
        }
    }

    fn is_done(&self) -> bool {
        self.flags.is_done()
    }

    fn is_requested_completed_or_ended(&self) -> bool {
        self.flags.is_requested_completed_or_ended()
    }

    pub fn set_on_aborted_handler(&mut self) {
        if self.flags.contains(Flags::SOCKET_CLOSED) {
            return;
        }
        // Don't overwrite WebSocket user data
        if !self.flags.contains(Flags::UPGRADED) {
            if let Some(raw_response) = &self.raw_response {
                raw_response.on_timeout(on_timeout_shim, self as *mut Self);
            }
        }
        // detach and
        self.upgrade_context.preserve_web_socket_headers_if_needed();
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_ended(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(self.flags.contains(Flags::ENDED))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_finished(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(self.flags.contains(Flags::REQUEST_HAS_COMPLETED))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_flags(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number_from_int32(self.flags.bits() as i32)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_aborted(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(self.flags.contains(Flags::SOCKET_CLOSED))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_has_body(&self, _global: &JSGlobalObject) -> JSValue {
        let mut result: i32 = 0;
        match self.body_read_state {
            BodyReadState::None => {}
            BodyReadState::Pending => result |= 1 << 1,
            BodyReadState::Done => result |= 1 << 2,
        }
        if self.buffered_request_body_data_during_pause.len > 0 {
            result |= 1 << 3;
        }
        if self.flags.contains(Flags::IS_DATA_BUFFERED_DURING_PAUSE_LAST) {
            result |= 1 << 2;
        }

        JSValue::js_number_from_int32(result)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_buffered_amount(&self, _global: &JSGlobalObject) -> JSValue {
        if self.flags.contains(Flags::REQUEST_HAS_COMPLETED)
            || self.flags.contains(Flags::SOCKET_CLOSED)
        {
            return JSValue::js_number_from_int32(0);
        }
        if let Some(raw_response) = &self.raw_response {
            return JSValue::js_number_from_uint64(raw_response.get_buffered_amount());
        }
        JSValue::js_number_from_int32(0)
    }

    #[bun_jsc::host_fn(method)]
    pub fn js_ref(
        &mut self,
        global_object: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if !self.is_done() {
            self.poll_ref.r#ref(bun_vm_mut(global_object));
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn js_unref(
        &mut self,
        global_object: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if !self.is_done() {
            self.poll_ref.unref(bun_vm_mut(global_object));
        }
        Ok(JSValue::UNDEFINED)
    }
}

fn handle_ended_if_necessary(state: uws::State, global_object: &JSGlobalObject) -> JsResult<()> {
    if !state.is_response_pending() {
        return global_object
            .err_http_headers_sent("Stream is already ended")
            .throw();
    }
    Ok(())
}

impl NodeHTTPResponse {
    #[bun_jsc::host_fn(method)]
    pub fn write_head(
        &mut self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments_undef::<3>();

        if self.is_requested_completed_or_ended() {
            return global_object
                .err_stream_already_finished("Stream is already ended")
                .throw();
        }

        if self.flags.contains(Flags::SOCKET_CLOSED)
            || self.flags.contains(Flags::UPGRADED)
            || self.raw_response.is_none()
        {
            // We haven't emitted the "close" event yet.
            return Ok(JSValue::UNDEFINED);
        }

        let state = self.raw_response.as_ref().unwrap().state();
        handle_ended_if_necessary(state, global_object)?;

        let status_code_value: JSValue = if arguments.len > 0 {
            arguments.ptr[0]
        } else {
            JSValue::UNDEFINED
        };
        let status_message_value: JSValue = if arguments.len > 1 && arguments.ptr[1] != JSValue::NULL {
            arguments.ptr[1]
        } else {
            JSValue::UNDEFINED
        };
        let headers_object_value: JSValue = if arguments.len > 2 && arguments.ptr[2] != JSValue::NULL {
            arguments.ptr[2]
        } else {
            JSValue::UNDEFINED
        };

        let status_code: i32 = 'brk: {
            if !status_code_value.is_undefined() {
                // TODO(port): blocked_on: bun_jsc::JSGlobalObject::validate_integer_range (gated upstream)
                let _ = jsc::IntegerRange {
                    min: 100,
                    max: 999,
                    field_name: b"statusCode",
                    ..Default::default()
                };
                break 'brk status_code_value.coerce_to_int64(global_object)?.clamp(100, 999) as i32;
            }
            break 'brk 200;
        };

        // PERF(port): was stack-fallback (256 bytes) — profile in Phase B.
        let status_message_slice = if !status_message_value.is_undefined() {
            status_message_value.to_slice(global_object)?
        } else {
            ZigStringSlice::EMPTY
        };
        // status_message_slice drops at scope exit.

        if global_object.has_exception() {
            return Err(jsc::JsError::Thrown);
        }

        if state.is_http_status_called() {
            return global_object
                .err_http_headers_sent("Stream already started")
                .throw();
        }

        // Validate status message does not contain invalid characters (defense-in-depth
        // against HTTP response splitting). Matches Node.js checkInvalidHeaderChar:
        // rejects any char not in [\t\x20-\x7e\x80-\xff].
        if status_message_slice.slice().len() > 0 {
            for &c in status_message_slice.slice() {
                if c != b'\t' && (c < 0x20 || c == 0x7f) {
                    return global_object
                        .err_invalid_char("Invalid character in statusMessage")
                        .throw();
                }
            }
        }

        'do_it: {
            if status_message_slice.slice().is_empty() {
                if let Some(status_message) =
                    HTTPStatusText::get(u32::try_from(status_code).unwrap())
                {
                    write_head_internal(
                        self.raw_response.as_ref().unwrap(),
                        global_object,
                        status_message,
                        headers_object_value,
                    );
                    break 'do_it;
                }
            }

            let message: &[u8] = if status_message_slice.slice().len() > 0 {
                status_message_slice.slice()
            } else {
                b"HM"
            };
            let mut status_message: Vec<u8> = Vec::new();
            {
                use std::io::Write;
                let _ = write!(&mut status_message, "{} {}", status_code, BStr::new(message));
            }
            write_head_internal(
                self.raw_response.as_ref().unwrap(),
                global_object,
                &status_message,
                headers_object_value,
            );
            break 'do_it;
        }

        Ok(JSValue::UNDEFINED)
    }
}

fn write_head_internal(
    response: &uws::AnyResponse,
    global_object: &JSGlobalObject,
    status_message: &[u8],
    headers: JSValue,
) {
    scoped_log!(
        NodeHTTPResponse,
        "writeHeadInternal({})",
        BStr::new(status_message)
    );
    match response {
        uws::AnyResponse::TCP(tcp) => unsafe {
            // SAFETY: tcp is a live uws Response pointer; status_message is valid for the call.
            NodeHTTPServer__writeHead_http(
                global_object,
                status_message.as_ptr(),
                status_message.len(),
                headers,
                (*tcp) as *mut c_void,
            );
        },
        uws::AnyResponse::SSL(ssl) => unsafe {
            // SAFETY: see above.
            NodeHTTPServer__writeHead_https(
                global_object,
                status_message.as_ptr(),
                status_message.len(),
                headers,
                (*ssl) as *mut c_void,
            );
        },
        uws::AnyResponse::H3(_) => {
            bun_core::Output::panic(format_args!("node:http does not support HTTP/3 responses"));
        }
    }
}

impl NodeHTTPResponse {
    #[bun_jsc::host_fn(method)]
    pub fn write_continue(
        &mut self,
        global_object: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.is_done() {
            return Ok(JSValue::UNDEFINED);
        }
        let Some(raw_response) = &self.raw_response else {
            return Ok(JSValue::UNDEFINED);
        };
        let state = raw_response.state();
        handle_ended_if_necessary(state, global_object)?;

        raw_response.write_continue();
        Ok(JSValue::UNDEFINED)
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum AbortEvent {
    None = 0,
    Abort = 1,
    Timeout = 2,
}

impl NodeHTTPResponse {
    fn handle_abort_or_timeout<const EVENT: AbortEvent>(&mut self, js_value: JSValue) {
        // defer { if event == abort, raw_response = None }
        // PORT NOTE: reshaped for borrowck — deferred null moved to explicit tail positions.

        if self.flags.contains(Flags::REQUEST_HAS_COMPLETED) {
            if EVENT == AbortEvent::Abort {
                self.raw_response = None;
            }
            return;
        }

        if EVENT == AbortEvent::Abort {
            self.flags.insert(Flags::SOCKET_CLOSED);
        }

        self.ref_();
        // defer this.deref();
        // defer if (event == .abort) this.markRequestAsDoneIfNecessary();

        let js_this: JSValue = if js_value.is_empty() {
            self.get_this_value()
        } else {
            js_value
        };
        if let Some(on_aborted) = js::on_aborted_get_cached(js_this) {
            let vm = vm_get();
            let global_this = vm.global();
            // SAFETY: event_loop() returns the live VM event-loop pointer.
            let event_loop = unsafe { &mut *vm.event_loop() };

            event_loop.run_callback(
                on_aborted,
                global_this,
                js_this,
                &[JSValue::js_number_from_int32(EVENT as u8 as i32)],
            );

            if EVENT == AbortEvent::Abort {
                js::on_aborted_set_cached(js_this, global_this, JSValue::ZERO);
            }
        }

        if EVENT == AbortEvent::Abort {
            self.on_data_or_aborted(b"", true, AbortEvent::Abort, js_this);
        }

        // Deferred tail:
        if EVENT == AbortEvent::Abort {
            self.mark_request_as_done_if_necessary();
        }
        self.deref();
        if EVENT == AbortEvent::Abort {
            self.raw_response = None;
        }
    }

    pub fn on_abort(&mut self, js_value: JSValue) {
        scoped_log!(NodeHTTPResponse, "onAbort");
        self.handle_abort_or_timeout::<{ AbortEvent::Abort }>(js_value);
    }

    pub fn on_timeout(&mut self, _resp: uws::AnyResponse) {
        scoped_log!(NodeHTTPResponse, "onTimeout");
        self.handle_abort_or_timeout::<{ AbortEvent::Timeout }>(JSValue::ZERO);
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_pause(
        &mut self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        scoped_log!(NodeHTTPResponse, "doPause");
        if self.flags.contains(Flags::REQUEST_HAS_COMPLETED)
            || self.flags.contains(Flags::SOCKET_CLOSED)
            || self.flags.contains(Flags::ENDED)
            || self.flags.contains(Flags::UPGRADED)
            || self.raw_response.is_none()
        {
            return Ok(JSValue::FALSE);
        }
        self.flags.insert(Flags::IS_DATA_BUFFERED_DURING_PAUSE);
        self.raw_response
            .as_ref()
            .unwrap()
            .on_data(on_buffer_paused_shim, self as *mut Self);

        // TODO: figure out why windows is not emitting EOF with UV_DISCONNECT
        #[cfg(not(windows))]
        {
            self.pause_socket();
        }
        Ok(JSValue::TRUE)
    }

    #[bun_jsc::host_fn(method)]
    pub fn drain_request_body(
        &mut self,
        global_object: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(self
            .drain_buffered_request_body_from_pause(global_object)
            .unwrap_or(JSValue::UNDEFINED))
    }

    fn drain_buffered_request_body_from_pause(
        &mut self,
        global_object: &JSGlobalObject,
    ) -> Option<JSValue> {
        scoped_log!(
            NodeHTTPResponse,
            "drainBufferedRequestBodyFromPause {}",
            self.buffered_request_body_data_during_pause.len
        );
        if self.buffered_request_body_data_during_pause.len > 0 {
            let result = JSValue::create_buffer(
                global_object,
                self.buffered_request_body_data_during_pause.slice_mut(),
            );
            self.buffered_request_body_data_during_pause = BabyList::default();
            return Some(result);
        }
        None
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_resume(&mut self, global_object: &JSGlobalObject, _frame: &CallFrame) -> JSValue {
        scoped_log!(NodeHTTPResponse, "doResume");
        if self.flags.contains(Flags::REQUEST_HAS_COMPLETED)
            || self.flags.contains(Flags::SOCKET_CLOSED)
            || self.flags.contains(Flags::ENDED)
            || self.flags.contains(Flags::UPGRADED)
            || self.raw_response.is_none()
        {
            return JSValue::FALSE;
        }
        self.set_on_aborted_handler();
        self.raw_response
            .as_ref()
            .unwrap()
            .on_data(on_data_shim, self as *mut Self);
        self.flags.remove(Flags::IS_DATA_BUFFERED_DURING_PAUSE);
        let mut result: JSValue = JSValue::TRUE;

        if let Some(buffered_data) = self.drain_buffered_request_body_from_pause(global_object) {
            result = buffered_data;
        }

        self.resume_socket();
        result
    }

    pub fn on_request_complete(&mut self) {
        if self.flags.contains(Flags::REQUEST_HAS_COMPLETED) {
            return;
        }
        scoped_log!(NodeHTTPResponse, "onRequestComplete");
        self.flags.insert(Flags::REQUEST_HAS_COMPLETED);
        self.poll_ref.unref(vm_get());

        self.mark_request_as_done_if_necessary();
    }
}

#[bun_jsc::host_fn]
#[unsafe(no_mangle)]
pub fn Bun__NodeHTTPRequest__onResolve(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JSValue {
    scoped_log!(NodeHTTPResponse, "onResolve");
    let arguments = callframe.arguments_old::<2>();
    // SAFETY: arguments[1] is the JSNodeHTTPResponse cell from the resolve callback.
    let this: &mut NodeHTTPResponse =
        unsafe { &mut *arguments.ptr[1].as_::<NodeHTTPResponse>().unwrap() };
    this.promise.deinit();
    // defer this.deref(); — moved to tail.
    this.maybe_stop_reading_body(bun_vm_mut(global_object), arguments.ptr[1]);

    if !this.flags.contains(Flags::REQUEST_HAS_COMPLETED)
        && !this.flags.contains(Flags::SOCKET_CLOSED)
    {
        let this_value = this.get_this_value();
        if !this_value.is_empty() {
            js::on_aborted_set_cached(this_value, global_object, JSValue::ZERO);
        }
        scoped_log!(NodeHTTPResponse, "clearOnData");
        if let Some(raw_response) = &this.raw_response {
            raw_response.clear_on_data();
            raw_response.clear_on_writable();
            raw_response.clear_timeout();
            if raw_response.state().is_response_pending() {
                raw_response.end_without_body(raw_response.state().is_http_connection_close());
            }
        }
        this.on_request_complete();
    }

    this.deref();
    JSValue::UNDEFINED
}

#[bun_jsc::host_fn]
#[unsafe(no_mangle)]
pub fn Bun__NodeHTTPRequest__onReject(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JSValue {
    let arguments = callframe.arguments_old::<2>();
    let err = arguments.ptr[0];
    // SAFETY: arguments[1] is the JSNodeHTTPResponse cell from the reject callback.
    let this: &mut NodeHTTPResponse =
        unsafe { &mut *arguments.ptr[1].as_::<NodeHTTPResponse>().unwrap() };
    this.promise.deinit();
    this.maybe_stop_reading_body(bun_vm_mut(global_object), arguments.ptr[1]);

    // defer this.deref(); — moved to tail.

    if !this.flags.contains(Flags::REQUEST_HAS_COMPLETED)
        && !this.flags.contains(Flags::SOCKET_CLOSED)
        && !this.flags.contains(Flags::UPGRADED)
    {
        let this_value = this.get_this_value();
        if !this_value.is_empty() {
            js::on_aborted_set_cached(this_value, global_object, JSValue::ZERO);
        }
        scoped_log!(NodeHTTPResponse, "clearOnData");
        if let Some(raw_response) = &this.raw_response {
            raw_response.clear_on_data();
            raw_response.clear_on_writable();
            raw_response.clear_timeout();
            if !raw_response.state().is_http_status_called() {
                raw_response.write_status(b"500 Internal Server Error");
            }
            raw_response.end_stream(raw_response.state().is_http_connection_close());
        }

        this.on_request_complete();
    }

    let _ = bun_vm_mut(global_object).uncaught_exception(global_object, err, true);
    this.deref();
    JSValue::UNDEFINED
}

impl NodeHTTPResponse {
    #[bun_jsc::host_fn(method)]
    pub fn abort(&mut self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        if self.is_done() {
            return Ok(JSValue::UNDEFINED);
        }

        self.flags.insert(Flags::SOCKET_CLOSED);
        if let Some(raw_response) = &self.raw_response {
            let state = raw_response.state();
            if state.is_http_end_called() {
                return Ok(JSValue::UNDEFINED);
            }
            // PORT NOTE: reshaped for borrowck — resume_socket borrows &mut self while
            // raw_response is borrowed; in Zig this was fine. We re-read raw_response after.
        }
        self.resume_socket();
        scoped_log!(NodeHTTPResponse, "clearOnData");
        if let Some(raw_response) = &self.raw_response {
            raw_response.clear_on_data();
            raw_response.clear_on_writable();
            raw_response.clear_timeout();
            raw_response.end_without_body(true);
        }
        self.on_request_complete();
        Ok(JSValue::UNDEFINED)
    }

    fn on_buffer_request_body_while_paused(&mut self, chunk: &[u8], last: bool) {
        scoped_log!(
            NodeHTTPResponse,
            "onBufferRequestBodyWhilePaused({}, {})",
            chunk.len(),
            last
        );
        let _ = self
            .buffered_request_body_data_during_pause
            .append_slice(chunk);
        if last {
            self.flags.insert(Flags::IS_DATA_BUFFERED_DURING_PAUSE_LAST);
            if self.body_read_ref.has {
                self.body_read_ref.unref(vm_get());
                self.mark_request_as_done_if_necessary();
            }
        }
    }

    fn get_bytes(&mut self, global_this: &JSGlobalObject, chunk: &[u8]) -> JSValue {
        // TODO: we should have a error event for this but is better than ignoring it
        // right now the socket instead of emitting an error event it will reportUncaughtException
        // this makes the behavior aligned with current implementation, but not ideal
        let bytes: JSValue = 'brk: {
            if !chunk.is_empty() && self.buffered_request_body_data_during_pause.len > 0 {
                let paused_len = self.buffered_request_body_data_during_pause.len as usize;
                // PORT NOTE: `JSValue::create_buffer_from_length` is gated upstream;
                // build the contiguous buffer locally then `ArrayBuffer::create_buffer`.
                let mut combined: Vec<u8> = Vec::with_capacity(paused_len + chunk.len());
                combined.extend_from_slice(self.buffered_request_body_data_during_pause.slice());
                combined.extend_from_slice(chunk);
                self.buffered_request_body_data_during_pause.clear_and_free();
                break 'brk match jsc::ArrayBuffer::create_buffer(global_this, &combined) {
                    Ok(b) => b,
                    Err(err) => {
                        let exc = global_this.take_exception(err);
                        let _ = bun_vm_mut(global_this).uncaught_exception(global_this, exc, false);
                        return JSValue::UNDEFINED;
                    }
                };
            }

            if let Some(buffered_data) = self.drain_buffered_request_body_from_pause(global_this) {
                break 'brk buffered_data;
            }

            if !chunk.is_empty() {
                break 'brk match jsc::ArrayBuffer::create_buffer(global_this, chunk) {
                    Ok(b) => b,
                    Err(err) => {
                        let exc = global_this.take_exception(err);
                        let _ = bun_vm_mut(global_this).uncaught_exception(global_this, exc, false);
                        return JSValue::UNDEFINED;
                    }
                };
            }
            break 'brk JSValue::UNDEFINED;
        };
        bytes
    }

    fn on_data_or_aborted(
        &mut self,
        chunk: &[u8],
        last: bool,
        event: AbortEvent,
        this_value: JSValue,
    ) {
        scoped_log!(NodeHTTPResponse, "onDataOrAborted({}, {})", chunk.len(), last);
        if last {
            self.ref_();
            self.body_read_state = BodyReadState::Done;
        }

        // defer { if last { ... } } — moved to tail.

        if let Some(callback) = js::on_data_get_cached(this_value) {
            if !callback.is_undefined() {
                let vm = vm_get();
                let global_this = vm.global();
                // SAFETY: event_loop() returns the live VM event-loop pointer.
                let event_loop = unsafe { &mut *vm.event_loop() };

                let bytes = self.get_bytes(global_this, chunk);

                event_loop.run_callback(
                    callback,
                    global_this,
                    JSValue::UNDEFINED,
                    &[
                        bytes,
                        JSValue::from(last),
                        JSValue::js_number_from_int32(event as u8 as i32),
                    ],
                );
            }
        }

        // Deferred tail:
        if last {
            if self.body_read_ref.has {
                self.body_read_ref.unref(vm_get());
                self.mark_request_as_done_if_necessary();
            }
            self.deref();
        }
    }

    pub const BUN_DEBUG_REFCOUNT_NAME: &'static str = "NodeHTTPServerResponse";

    pub fn on_data(&mut self, chunk: &[u8], last: bool) {
        scoped_log!(
            NodeHTTPResponse,
            "onData({} bytes, is_last = {})",
            chunk.len(),
            last as u8
        );

        self.on_data_or_aborted(chunk, last, AbortEvent::None, self.get_this_value());
    }

    fn on_drain_corked(&mut self, offset: u64) {
        scoped_log!(NodeHTTPResponse, "onDrainCorked({})", offset);
        self.ref_();
        // defer this.deref(); — moved to tail.

        let this_value = self.get_this_value();
        let Some(on_writable) = js::on_writable_get_cached(this_value) else {
            self.deref();
            return;
        };
        let vm = vm_get();
        let global_this = vm.global();
        js::on_writable_set_cached(this_value, global_this, JSValue::UNDEFINED); // TODO(@heimskr): is this necessary?

        // SAFETY: event_loop() returns the live VM event-loop pointer.
        unsafe { &mut *vm.event_loop() }.run_callback(
            on_writable,
            global_this,
            JSValue::UNDEFINED,
            &[JSValue::js_number_from_uint64(offset)],
        );

        self.deref();
    }

    fn on_drain(&mut self, offset: u64, response: uws::AnyResponse) -> bool {
        scoped_log!(NodeHTTPResponse, "onDrain({})", offset);

        if self.flags.contains(Flags::SOCKET_CLOSED)
            || self.flags.contains(Flags::REQUEST_HAS_COMPLETED)
            || self.flags.contains(Flags::UPGRADED)
        {
            // return false means we don't have anything to drain
            return false;
        }

        response.corked(|| self.on_drain_corked(offset));
        // return true means we may have something to drain
        true
    }

    fn write_or_end<const IS_END: bool>(
        &mut self,
        global_object: &JSGlobalObject,
        arguments: &[JSValue],
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        if self.is_requested_completed_or_ended() {
            return global_object
                .err_stream_write_after_end("Stream already ended")
                .throw();
        }

        // Loosely mimicking this code:
        //      function _writeRaw(data, encoding, callback, size) {
        //        const conn = this[kSocket];
        //        if (conn?.destroyed) {
        //          // The socket was destroyed. If we're still trying to write to it,
        //          // then we haven't gotten the 'close' event yet.
        //          return false;
        //        }
        if self.flags.contains(Flags::SOCKET_CLOSED) || self.raw_response.is_none() {
            return Ok(if IS_END {
                JSValue::UNDEFINED
            } else {
                JSValue::js_number_from_int32(0)
            });
        }

        // PORT NOTE: reshaped for borrowck — re-read raw_response at each use site
        // instead of holding a borrow across &mut self method calls.
        let state = self.raw_response.as_ref().unwrap().state();
        if !state.is_response_pending() {
            return global_object
                .err_stream_write_after_end("Stream already ended")
                .throw();
        }

        let input_value: JSValue = if arguments.len() > 0 {
            arguments[0]
        } else {
            JSValue::UNDEFINED
        };
        let mut encoding_value: JSValue = if arguments.len() > 1 {
            arguments[1]
        } else {
            JSValue::UNDEFINED
        };
        let callback_value: JSValue = 'brk: {
            if !encoding_value.is_undefined_or_null() && encoding_value.is_callable() {
                encoding_value = JSValue::UNDEFINED;
                break 'brk arguments[1];
            }

            if arguments.len() > 2 && !arguments[2].is_undefined() {
                if !arguments[2].is_callable() {
                    return Err(global_object.throw_invalid_argument_type_value(
                        "callback",
                        "function",
                        arguments[2],
                    ));
                }
                break 'brk arguments[2];
            }

            break 'brk JSValue::UNDEFINED;
        };

        let strict_content_length: Option<u64> = 'brk: {
            if arguments.len() > 3 && arguments[3].is_number() {
                break 'brk Some(arguments[3].to_int64().max(0) as u64);
            }
            break 'brk None;
        };

        let string_or_buffer: crate::node::StringOrBuffer = 'brk: {
            if input_value.is_undefined_or_null() {
                break 'brk crate::node::StringOrBuffer::EMPTY;
            }

            let mut encoding = crate::node::Encoding::Utf8;
            if !encoding_value.is_undefined_or_null() {
                if !encoding_value.is_string() {
                    return Err(global_object.throw_invalid_argument_type_value(
                        "encoding",
                        "string",
                        encoding_value,
                    ));
                }

                encoding = match crate::node::Encoding::from_js(encoding_value, global_object)? {
                    Some(e) => e,
                    None => {
                        return Err(global_object.throw_invalid_arguments("Invalid encoding"));
                    }
                };
            }

            let result = crate::node::StringOrBuffer::from_js_with_encoding(
                global_object,
                input_value,
                encoding,
            )?;
            match result {
                Some(r) => break 'brk r,
                None => {
                    return Err(global_object.throw_invalid_argument_type_value(
                        "input",
                        "string or buffer",
                        input_value,
                    ));
                }
            }
        };
        // string_or_buffer drops at scope exit.

        if global_object.has_exception() {
            return Err(jsc::JsError::Thrown);
        }

        let bytes = string_or_buffer.slice();

        if IS_END {
            scoped_log!(
                NodeHTTPResponse,
                "end('{}', {})",
                BStr::new(&bytes[..bytes.len().min(128)]),
                bytes.len()
            );
        } else {
            scoped_log!(
                NodeHTTPResponse,
                "write('{}', {})",
                BStr::new(&bytes[..bytes.len().min(128)]),
                bytes.len()
            );
        }
        if let Some(content_length) = strict_content_length {
            let bytes_written = self.bytes_written + bytes.len();

            if IS_END {
                if bytes_written as u64 != content_length {
                    return global_object
                        .err_http_content_length_mismatch("Content-Length mismatch")
                        .throw();
                }
            } else if bytes_written as u64 > content_length {
                return global_object
                    .err_http_content_length_mismatch("Content-Length mismatch")
                    .throw();
            }
            self.bytes_written = bytes_written;
        } else {
            self.bytes_written = self.bytes_written.saturating_add(bytes.len());
        }
        if IS_END {
            // Discard the body read ref if it's pending and no onData callback is set at this point.
            // This is the equivalent of req._dump().
            if self.body_read_ref.has
                && self.body_read_state == BodyReadState::Pending
                && (!self.flags.contains(Flags::HAS_CUSTOM_ON_DATA)
                    || js::on_data_get_cached(this_value).is_none())
            {
                self.body_read_ref.unref(vm_get());
                self.body_read_state = BodyReadState::None;
            }

            if !this_value.is_empty() {
                js::on_aborted_set_cached(this_value, global_object, JSValue::ZERO);
            }

            let raw_response = self.raw_response.as_ref().unwrap();
            raw_response.clear_aborted();
            raw_response.clear_on_writable();
            raw_response.clear_timeout();
            self.flags.insert(Flags::ENDED);
            let raw_response = self.raw_response.as_ref().unwrap();
            if !state.is_http_write_called() || !bytes.is_empty() {
                raw_response.end(bytes, state.is_http_connection_close());
            } else {
                raw_response.end_stream(state.is_http_connection_close());
            }
            self.on_request_complete();

            Ok(JSValue::js_number_from_uint64(bytes.len() as u64))
        } else {
            let js_this = if !this_value.is_empty() {
                this_value
            } else {
                self.get_this_value()
            };
            let raw_response = self.raw_response.as_ref().unwrap();
            match raw_response.write(bytes) {
                uws::WriteResult::WantMore(written) => {
                    raw_response.clear_on_writable();
                    js::on_writable_set_cached(js_this, global_object, JSValue::UNDEFINED);
                    Ok(JSValue::js_number_from_uint64(written))
                }
                uws::WriteResult::Backpressure(written) => {
                    if !callback_value.is_undefined() {
                        js::on_writable_set_cached(
                            js_this,
                            global_object,
                            callback_value.with_async_context_if_needed(global_object),
                        );
                        raw_response.on_writable(on_drain_shim, self as *mut Self);
                    }

                    // PERF(port): @intCast — bounded by min().
                    let clamped = i64::try_from(written.min(i64::MAX as u64)).unwrap();
                    Ok(JSValue::js_number((-clamped) as f64))
                }
            }
        }
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_on_writable(
        &mut self,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<bool> {
        let this_value = self.get_this_value();
        if self.is_done() || value.is_undefined() {
            js::on_writable_set_cached(this_value, global_object, JSValue::UNDEFINED);
        } else {
            js::on_writable_set_cached(
                this_value,
                global_object,
                value.with_async_context_if_needed(global_object),
            );
        }
        Ok(true)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_on_writable(&self, _global: &JSGlobalObject) -> JSValue {
        js::on_writable_get_cached(self.get_this_value()).unwrap_or(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_on_abort(&self, _global: &JSGlobalObject) -> JSValue {
        if self.flags.contains(Flags::SOCKET_CLOSED) || self.flags.contains(Flags::UPGRADED) {
            return JSValue::UNDEFINED;
        }
        js::on_aborted_get_cached(self.get_this_value()).unwrap_or(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_on_abort(
        &mut self,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<bool> {
        let this_value = self.get_this_value();
        if self.flags.contains(Flags::SOCKET_CLOSED) || self.flags.contains(Flags::UPGRADED) {
            return Ok(true);
        }

        if self.is_requested_completed_or_ended() || value.is_undefined() {
            js::on_aborted_set_cached(this_value, global_object, JSValue::ZERO);
        } else {
            js::on_aborted_set_cached(
                this_value,
                global_object,
                value.with_async_context_if_needed(global_object),
            );
        }
        Ok(true)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_on_data(&self, _global: &JSGlobalObject) -> JSValue {
        js::on_data_get_cached(self.get_this_value()).unwrap_or(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_has_custom_on_data(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(self.flags.contains(Flags::HAS_CUSTOM_ON_DATA))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_upgraded(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(self.flags.contains(Flags::UPGRADED))
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_has_custom_on_data(&mut self, _global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
        self.flags
            .set(Flags::HAS_CUSTOM_ON_DATA, value.to_boolean());
        Ok(true)
    }

    fn clear_on_data_callback(&mut self, this_value: JSValue, global_object: &JSGlobalObject) {
        scoped_log!(NodeHTTPResponse, "clearOnDataCallback");
        if self.body_read_state != BodyReadState::None {
            if !this_value.is_empty() {
                js::on_data_set_cached(this_value, global_object, JSValue::UNDEFINED);
            }
            if !self.flags.contains(Flags::SOCKET_CLOSED) && !self.flags.contains(Flags::UPGRADED) {
                scoped_log!(NodeHTTPResponse, "clearOnData");
                if let Some(raw_response) = &self.raw_response {
                    raw_response.clear_on_data();
                }
            }
            if self.body_read_state != BodyReadState::Done {
                self.body_read_state = BodyReadState::Done;
            }
        }
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_on_data(
        &mut self,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<bool> {
        let this_value = self.get_this_value();
        // Only `.pending` accepts a callback. `.done` means either uSockets delivered last=true or JS
        // previously cleared `ondata` (which already called clearOnData()); either way, there is no
        // more body to read, so don't re-register with uSockets or churn refs.
        if value.is_undefined()
            || self.flags.contains(Flags::ENDED)
            || self.flags.contains(Flags::SOCKET_CLOSED)
            || self.body_read_state != BodyReadState::Pending
            || self.flags.contains(Flags::IS_DATA_BUFFERED_DURING_PAUSE_LAST)
            || self.flags.contains(Flags::UPGRADED)
        {
            js::on_data_set_cached(this_value, global_object, JSValue::UNDEFINED);
            // defer { if body_read_ref.has { unref } } — moved to tail of this branch.
            match self.body_read_state {
                BodyReadState::Pending | BodyReadState::Done => {
                    if !self.flags.contains(Flags::REQUEST_HAS_COMPLETED)
                        && !self.flags.contains(Flags::SOCKET_CLOSED)
                        && !self.flags.contains(Flags::UPGRADED)
                    {
                        scoped_log!(NodeHTTPResponse, "clearOnData");
                        if let Some(raw_response) = &self.raw_response {
                            raw_response.clear_on_data();
                        }
                    }
                    self.body_read_state = BodyReadState::Done;
                }
                BodyReadState::None => {}
            }
            if self.body_read_ref.has {
                self.body_read_ref.unref(bun_vm_mut(global_object));
            }
            return Ok(true);
        }

        js::on_data_set_cached(
            this_value,
            global_object,
            value.with_async_context_if_needed(global_object),
        );
        self.flags.insert(Flags::HAS_CUSTOM_ON_DATA);
        if let Some(raw_response) = &self.raw_response {
            raw_response.on_data(on_data_shim, self as *mut Self);
        }
        self.flags.remove(Flags::IS_DATA_BUFFERED_DURING_PAUSE);

        // Every site that unrefs `body_read_ref` also transitions `body_read_state` out of `.pending`
        // or sets `is_data_buffered_during_pause_last`, both of which are rejected by the guard above.
        // So reaching here, `body_read_ref` is still held from create(). Do not re-acquire it or
        // `this.ref()` — there would be no balancing release (PR #18564 removed the paired derefs).
        debug_assert!(self.body_read_ref.has);
        Ok(true)
    }

    #[bun_jsc::host_fn(method)]
    pub fn write(
        &mut self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        self.write_or_end::<false>(global_object, arguments, JSValue::ZERO)
    }

    pub fn on_auto_flush(&mut self) -> bool {
        // defer this.deref(); — moved to tail.
        if !self.flags.contains(Flags::SOCKET_CLOSED)
            && !self.flags.contains(Flags::UPGRADED)
            && self.raw_response.is_some()
        {
            self.raw_response.as_ref().unwrap().uncork();
        }
        self.auto_flusher.registered = false;
        self.deref();
        false
    }

    fn register_auto_flush(&mut self) {
        if self.auto_flusher.registered {
            return;
        }
        self.ref_();
        AutoFlusher::register_deferred_microtask_with_type_unchecked::<NodeHTTPResponse>(
            self,
            vm_get(),
        );
    }

    fn unregister_auto_flush(&mut self) {
        if !self.auto_flusher.registered {
            return;
        }
        AutoFlusher::unregister_deferred_microtask_with_type_unchecked::<NodeHTTPResponse>(
            self,
            vm_get(),
        );
        self.deref();
    }

    #[bun_jsc::host_fn(method)]
    pub fn flush_headers(
        &mut self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if !self.flags.contains(Flags::SOCKET_CLOSED)
            && !self.flags.contains(Flags::UPGRADED)
            && self.raw_response.is_some()
        {
            let raw_response = self.raw_response.as_ref().unwrap();
            // Don't flush immediately; queue a microtask to uncork the socket.
            raw_response.flush_headers(false);
            if raw_response.is_corked() {
                self.register_auto_flush();
            }
        }

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn end(
        &mut self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        // We dont wanna a paused socket when we call end, so is important to resume the socket
        self.resume_socket();
        self.write_or_end::<true>(global_object, arguments, callframe.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_bytes_written(&mut self, _global: &JSGlobalObject, _frame: &CallFrame) -> JSValue {
        JSValue::js_number(self.bytes_written as f64)
    }
}

fn handle_corked(
    global_object: &JSGlobalObject,
    function: JSValue,
    result: &mut JSValue,
    is_exception: &mut bool,
) {
    *result = match function.call(global_object, JSValue::UNDEFINED, &[]) {
        Ok(v) => v,
        Err(err) => {
            *result = global_object.take_exception(err);
            *is_exception = true;
            return;
        }
    };
}

impl NodeHTTPResponse {
    pub fn set_timeout(&mut self, seconds: u8) {
        if self.flags.contains(Flags::REQUEST_HAS_COMPLETED)
            || self.flags.contains(Flags::SOCKET_CLOSED)
            || self.flags.contains(Flags::UPGRADED)
            || self.raw_response.is_none()
        {
            return;
        }

        self.raw_response.as_ref().unwrap().timeout(seconds);
    }

    #[bun_jsc::host_fn(method)]
    pub fn cork(
        &mut self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<1>();
        if arguments.len == 0 {
            return Err(global_object
                .err(ErrorCode::ERR_MISSING_ARGS, format_args!("cork requires at least 1 argument"))
                .throw());
        }

        if !arguments.ptr[0].is_callable() {
            return Err(global_object.throw_invalid_argument_type_value(
                "cork",
                "function",
                arguments.ptr[0],
            ));
        }

        if self.flags.contains(Flags::REQUEST_HAS_COMPLETED)
            || self.flags.contains(Flags::SOCKET_CLOSED)
            || self.flags.contains(Flags::UPGRADED)
        {
            return global_object
                .err_stream_already_finished("Stream is already ended")
                .throw();
        }

        let mut result: JSValue = JSValue::ZERO;
        let mut is_exception: bool = false;
        self.ref_();
        // defer this.deref(); — moved to tail.

        if let Some(raw_response) = &self.raw_response {
            raw_response.corked(|| {
                handle_corked(global_object, arguments.ptr[0], &mut result, &mut is_exception)
            });
        } else {
            handle_corked(global_object, arguments.ptr[0], &mut result, &mut is_exception);
        }

        let ret: JsResult<JSValue> = if is_exception {
            if !result.is_empty() {
                Err(global_object.throw_value(result))
            } else {
                Err(global_object.throw("unknown error"))
            }
        } else if result.is_empty() {
            Ok(JSValue::UNDEFINED)
        } else {
            Ok(result)
        };

        self.deref();
        ret
    }

    pub fn finalize(this: *mut Self) {
        // SAFETY: called by JSC finalizer on the mutator thread; `this` is the m_ctx payload.
        unsafe { (*this).deref() };
    }

    /// Called by intrusive RefCount when count reaches zero.
    fn deinit(&mut self) {
        debug_assert!(!self.body_read_ref.has);
        debug_assert!(!self.poll_ref.has);
        debug_assert!(!self.flags.contains(Flags::IS_REQUEST_PENDING));
        debug_assert!(
            self.flags.contains(Flags::SOCKET_CLOSED)
                || self.flags.contains(Flags::REQUEST_HAS_COMPLETED)
        );

        self.buffered_request_body_data_during_pause.clear_and_free();
        self.poll_ref.unref(vm_get());
        self.body_read_ref.unref(vm_get());

        self.promise.deinit();
        // SAFETY: self was allocated via Box::into_raw in `create`; refcount is zero so no
        // other references remain.
        unsafe { drop(Box::from_raw(self as *mut Self)) };
    }

    // Intrusive refcount helpers.
    // TODO(port): replace with `bun_ptr::IntrusiveRc` trait impl.
    #[inline]
    pub fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }

    #[inline]
    pub fn deref(&mut self) {
        // PORT NOTE: takes `&mut self` (Zig's `*@This()`) so the zero-count `deinit`
        // path writes through a pointer with mutable provenance instead of laundering
        // `&self as *const _ as *mut _` (UB). Every call site already holds `&mut`.
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            self.deinit();
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn NodeHTTPResponse__createForJS(
    any_server_tag: u64,
    global_object: *mut JSGlobalObject,
    has_body: *mut bool,
    request: *mut uws_sys::Request,
    is_ssl: i32,
    response_ptr: *mut c_void,
    upgrade_ctx: *mut uws_sys::WebSocketUpgradeContext,
    node_response_ptr: *mut *mut NodeHTTPResponse,
) -> JSValue {
    // SAFETY: all pointers are provided by C++ NodeHTTPServer and are live for the call.
    let global_object = unsafe { &*global_object };
    let has_body = unsafe { &mut *has_body };
    let request_ref = unsafe { &*request };

    let vm = bun_vm_mut(global_object);
    let method = HttpMethod::which(request_ref.method()).unwrap_or(HttpMethod::OPTIONS);
    // GET in node.js can have a body
    if method.has_request_body() || method == HttpMethod::GET {
        let req_len: usize = 'brk: {
            if let Some(content_length) = request_ref.header(b"content-length") {
                scoped_log!(
                    NodeHTTPResponse,
                    "content-length: {}",
                    BStr::new(content_length)
                );
                // TODO(port): std.fmt.parseInt — assumes ASCII bytes; Phase B may want a bun_str helper.
                break 'brk core::str::from_utf8(content_length)
                    .ok()
                    .and_then(|s| s.parse::<usize>().ok())
                    .unwrap_or(0);
            }
            break 'brk 0;
        };

        *has_body = req_len > 0 || request_ref.header(b"transfer-encoding").is_some();
    }

    let raw_response = if is_ssl != 0 {
        uws::AnyResponse::SSL(response_ptr.cast())
    } else {
        uws::AnyResponse::TCP(response_ptr.cast())
    };

    let response = Box::into_raw(Box::new(NodeHTTPResponse {
        // 1 - the HTTP response
        // 1 - the JS object
        // 1 - the Server handler.
        ref_count: Cell::new(3),
        upgrade_context: UpgradeCTX {
            context: upgrade_ctx,
            request,
            sec_websocket_key: Box::default(),
            sec_websocket_protocol: Box::default(),
            sec_websocket_extensions: Box::default(),
        },
        server: any_server_from_packed(any_server_tag),
        raw_response: Some(raw_response),
        body_read_state: if *has_body {
            BodyReadState::Pending
        } else {
            BodyReadState::None
        },
        flags: Flags::default(),
        poll_ref: jsc::Ref::default(),
        body_read_ref: jsc::Ref::default(),
        promise: StrongOptional::empty(),
        buffered_request_body_data_during_pause: BabyList::default(),
        bytes_written: 0,
        auto_flusher: AutoFlusher::default(),
    }));

    // SAFETY: `response` was just allocated and leaked; we hold the only reference.
    let response_ref = unsafe { &mut *response };
    if *has_body {
        response_ref.body_read_ref.r#ref(vm);
    }
    response_ref.poll_ref.r#ref(vm);
    let js_this = NodeHTTPResponse::to_js_ptr(response, global_object);
    // SAFETY: out-param provided by caller.
    unsafe { *node_response_ptr = response };
    js_this
}

#[unsafe(no_mangle)]
pub extern "C" fn NodeHTTPResponse__setTimeout(
    this: *mut NodeHTTPResponse,
    seconds: JSValue,
    global_this: *mut JSGlobalObject,
) -> bool {
    // SAFETY: pointers provided by C++; live for the call.
    let this = unsafe { &mut *this };
    let global_this = unsafe { &*global_this };

    if !seconds.is_number() {
        let _: jsc::JsError =
            global_this.throw_invalid_argument_type_value("timeout", "number", seconds);
        return false;
    }

    if this.flags.contains(Flags::REQUEST_HAS_COMPLETED)
        || this.flags.contains(Flags::SOCKET_CLOSED)
        || this.flags.contains(Flags::UPGRADED)
        || this.raw_response.is_none()
    {
        return false;
    }

    // PERF(port): @intCast — bounded by min(255).
    let secs = (seconds.to_int32().max(0) as c_uint).min(255) as u8;
    this.raw_response.as_ref().unwrap().timeout(secs);
    true
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__NodeHTTPResponse_onClose(
    response: *mut NodeHTTPResponse,
    js_value: JSValue,
) {
    // SAFETY: response is a live NodeHTTPResponse* from C++.
    unsafe { (*response).on_abort(js_value) };
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__NodeHTTPResponse_setClosed(response: *mut NodeHTTPResponse) {
    // SAFETY: response is a live NodeHTTPResponse* from C++.
    unsafe { (*response).flags.insert(Flags::SOCKET_CLOSED) };
}

// Codegen module for JSNodeHTTPResponse cached-property accessors.
// Mirrors `jsc.Codegen.JSNodeHTTPResponse.on{Data,Aborted,Writable}{Get,Set}Cached`
// (build/*/codegen/ZigGeneratedClasses.zig) — thin wrappers over the C++
// `NodeHTTPResponsePrototype__on*{Get,Set}CachedValue` shims emitted by
// src/codegen/generate-classes.ts for each `cache: true` property in
// NodeHTTPResponse.classes.ts.
mod generated {
    #[allow(non_snake_case)]
    pub mod JSNodeHTTPResponse {
        // Emits `on_data_{get,set}_cached`, `on_aborted_{get,set}_cached`,
        // `on_writable_{get,set}_cached`. Getter maps `JSValue::ZERO` → `None`;
        // setter forwards through the JSC `WriteBarrier<Unknown>` slot.
        ::bun_jsc::codegen_cached_accessors!("NodeHTTPResponse"; onData, onAborted, onWritable);
    }
}
} // mod _gated

pub use _gated::AbortEvent;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/server/NodeHTTPResponse.zig (1255 lines)
//   confidence: medium
//   todos:      0
//   notes:      .classes.ts payload w/ intrusive refcount; many `defer self.deref()` reshaped to tail calls — verify ordering vs early returns; `js::*` cached accessors via codegen_cached_accessors!; ERR_* throw helpers assumed on JSGlobalObject; UpgradeCTX::deinit renamed reset (mid-lifetime).
// ──────────────────────────────────────────────────────────────────────────
