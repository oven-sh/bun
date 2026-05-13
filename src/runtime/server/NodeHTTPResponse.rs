use core::cell::Cell;
use core::ffi::{c_uint, c_void};
use core::ptr;

use bitflags::bitflags;
use bstr::BStr;

use bun_collections::VecExt;
use bun_core::scoped_log;
use bun_core::{ZigString, ZigStringSlice};
use bun_http::Method as HttpMethod;
use bun_jsc::JsCell;
use bun_ptr::AsCtxPtr;
use bun_uws as uws;
use bun_uws_sys as uws_sys;

use crate::server::jsc::{
    self, CallFrame, ErrorCode, JSGlobalObject, JSValue, JsResult, StrongOptional, VirtualMachine,
};
use crate::server::{AnyServer, AnyServerTag, HTTPStatusText, ServerWebSocket};
use crate::webcore::AutoFlusher;

bun_core::declare_scope!(NodeHTTPResponse, visible);

/// Intrusive ref-counted; `ref_count` is managed by `ref_` / `deref` below
/// (FFI rule — `*mut NodeHTTPResponse` is the m_ctx payload of a
/// `.classes.ts` wrapper). `deinit` runs when count hits zero.
///
/// `#[JsClass(no_constructor)]` wires the import-side `${T}__fromJS` /
/// `__fromJSDirect` / `__create` externs into a `JsClass` impl plus an
/// inherent `to_js_ptr(*mut Self, &JSGlobalObject)`; `noConstructor: true`
/// in `server.classes.ts` means no `${T}__getConstructor` is exported.
// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). The codegen
// shim still emits `this: &mut NodeHTTPResponse` until Phase 1 lands —
// `&mut T` auto-derefs to `&T` so the impls below compile against either.
#[bun_jsc::JsClass(no_constructor)]
pub struct NodeHTTPResponse {
    pub ref_count: Cell<u32>,

    pub raw_response: Cell<Option<uws::AnyResponse>>,

    pub flags: Cell<Flags>,

    pub poll_ref: JsCell<jsc::Ref>,

    pub body_read_state: Cell<BodyReadState>,
    pub body_read_ref: JsCell<jsc::Ref>,
    pub promise: JsCell<StrongOptional>, // Strong.Optional
    pub server: AnyServer,

    /// When you call pause() on the node:http IncomingMessage
    /// We might've already read from the socket.
    /// So we need to buffer that data.
    /// This should be pretty uncommon though.
    pub buffered_request_body_data_during_pause: JsCell<Vec<u8>>,
    pub bytes_written: Cell<usize>,

    pub upgrade_context: JsCell<UpgradeCTX>,

    pub auto_flusher: JsCell<AutoFlusher>,
}

// Intrusive refcount methods (`ref_` / `deref`) are hand-rolled below over the
// `ref_count` field; `deinit` is the destructor invoked when count hits zero.

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
        // Dropping the taken value frees the old `Box<[u8]>` headers; raw
        // pointers are nulled. Nothing from the old value is reused.
        drop(core::mem::take(self));
    }

    pub fn preserve_web_socket_headers_if_needed(&mut self) {
        if !self.request.is_null() {
            // S008: `uws::Request` is an `opaque_ffi!` ZST — safe deref. We
            // null `self.request` immediately after reading headers so it
            // cannot be used past its native lifetime.
            let request = bun_opaque::opaque_deref(self.request.cast_const());
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

unsafe extern "C" {
    // `socket` is the opaque uSockets handle from `AnyResponse::socket()`; C++
    // only reads its ext slot. Module-private — the sole callers below pass a
    // live handle, so no caller-side precondition remains.
    safe fn Bun__getNodeHTTPResponseThisValue(is_ssl: bool, socket: *mut c_void) -> JSValue;
    safe fn Bun__getNodeHTTPServerSocketThisValue(is_ssl: bool, socket: *mut c_void) -> JSValue;

    // `&JSGlobalObject` encodes non-null/aligned; `status_message` is the
    // ptr/len of a Rust `&[u8]` and `response` is a live `uws::Response<SSL>*`
    // from the matched `AnyResponse` arm. Module-private with one call site.
    safe fn NodeHTTPServer__writeHead_http(
        global_object: &JSGlobalObject,
        status_message: *const u8,
        status_message_length: usize,
        headers_object_value: JSValue,
        response: *mut c_void,
    );

    safe fn NodeHTTPServer__writeHead_https(
        global_object: &JSGlobalObject,
        status_message: *const u8,
        status_message_length: usize,
        headers_object_value: JSValue,
        response: *mut c_void,
    );
}

/// `VirtualMachine::get()` returns `*mut`; deref once for callers that need `&mut`.
#[inline(always)]
fn vm_get<'a>() -> &'a mut VirtualMachine {
    // SAFETY: JS-thread only; the global VM pointer is non-null once the runtime is up.
    VirtualMachine::get().as_mut()
}

/// `&mut` to this thread's VM for `Ref::ref/unref` etc. Takes `_global` for
/// call-site symmetry with the .zig spec but reads the thread-local directly:
/// `VirtualMachine::as_mut()` ignores its receiver and re-reads the TLS slot,
/// so routing through `global.bun_vm()` was pure overhead on the per-request
/// path (`NodeHTTPResponse__createForJS` disasm showed the `bunVM` FFI result
/// dropped on the floor).
#[inline(always)]
fn bun_vm_mut(_global: &JSGlobalObject) -> &mut VirtualMachine {
    VirtualMachine::get_mut()
}

/// `globalObject.ERR(.CODE, msg, .{}).throw()` — the actual error-construction
/// body, kept non-generic and out of line.
///
/// Every caller is an error branch that is essentially never taken on the
/// node:http response hot path (`write_head` / `write_or_end` / `cork`). Marking
/// this `#[cold]` + `#[inline(never)]` keeps the `ErrorBuilder::throw` codegen —
/// message formatting (`core::fmt`), error-code table lookup, JS error object
/// allocation — physically separated from those hot functions so it neither
/// bloats them nor pollutes their icache footprint. Being non-generic also means
/// it's emitted once instead of once per `T`.
#[cold]
#[inline(never)]
fn err_throw_cold(global: &JSGlobalObject, code: ErrorCode, msg: &'static str) -> jsc::JsError {
    global.err(code, format_args!("{}", msg)).throw()
}

/// Thin generic wrapper so call sites can `return err_throw(...)` from any
/// `JsResult<T>`-returning fn; all the weight lives in [`err_throw_cold`].
#[inline]
fn err_throw<T>(global: &JSGlobalObject, code: ErrorCode, msg: &'static str) -> JsResult<T> {
    Err(err_throw_cold(global, code, msg))
}

/// AnyResponse `is_ssl()` shim (upstream lacks this accessor).
#[inline]
fn any_response_is_ssl(r: &uws::AnyResponse) -> bool {
    matches!(r, uws::AnyResponse::SSL(_))
}

// uSockets callback adapters: AnyResponse::on_data/on_timeout/on_writable expect
// `Fn(*mut U, ...)` (capture-less); adapt to `&self` method bodies.
fn on_timeout_shim(this: *mut NodeHTTPResponse, resp: uws::AnyResponse) {
    // SAFETY: registered with `self`'s address; live while callback is armed.
    // R-2: deref as shared (`&*const`) — bodies take `&self`.
    unsafe { (*this.cast_const()).on_timeout(resp) }
}
fn on_data_shim(this: *mut NodeHTTPResponse, chunk: &[u8], last: bool) {
    // SAFETY: see on_timeout_shim.
    unsafe { (*this.cast_const()).on_data(chunk, last) }
}
fn on_buffer_paused_shim(this: *mut NodeHTTPResponse, chunk: &[u8], last: bool) {
    // SAFETY: see on_timeout_shim.
    unsafe { (*this.cast_const()).on_buffer_request_body_while_paused(chunk, last) }
}
fn on_drain_shim(this: *mut NodeHTTPResponse, off: u64, resp: uws::AnyResponse) -> bool {
    // SAFETY: see on_timeout_shim.
    unsafe { (*this.cast_const()).on_drain(off, resp) }
}

// R-2: `HasAutoFlusher` (which requires `fn auto_flusher(&mut self)`) is no
// longer implemented here — the deferred-task registration is inlined in
// `register_auto_flush` / `unregister_auto_flush` below so the whole path is
// `&self`. The `DeferredRepeatingTask` trampoline that the trait would have
// generated is local. Body discharges its own preconditions; a safe
// `extern "C" fn` coerces to the `DeferredRepeatingTask` pointer at `post_task`.
extern "C" fn on_auto_flush_trampoline(ctx: *mut c_void) -> bool {
    // SAFETY: `ctx` is the `*const NodeHTTPResponse` registered by
    // `register_auto_flush`; `DeferredTaskQueue::run` feeds it back unchanged
    // on the JS thread. `on_auto_flush` takes `&self`.
    unsafe { (*(ctx.cast_const().cast::<NodeHTTPResponse>())).on_auto_flush() }
}

/// Unpack the `AnyServer` tagged-pointer u64 handed across FFI from C++.
///
/// Zig: `AnyServer{ .ptr = AnyServer.Ptr.from(@ptrFromInt(any_server_tag)) }`
/// where `Ptr = bun.TaggedPointerUnion(.{HTTPServer, HTTPSServer,
/// DebugHTTPServer, DebugHTTPSServer})`. The packed repr is bits 0..49 = ptr,
/// bits 49..64 = tag, with tag = `1024 - index` (see `bun_ptr::tagged_pointer`).
/// The Rust `AnyServer` stores `(tag, ptr)` unpacked, so map the wire tag back
/// to `AnyServerTag` here.
#[inline]
fn any_server_from_packed(packed: u64) -> AnyServer {
    let repr = bun_ptr::TaggedPointer::from(packed);
    let tag = match repr.data() {
        1024 => AnyServerTag::HTTPServer,
        1023 => AnyServerTag::HTTPSServer,
        1022 => AnyServerTag::DebugHTTPServer,
        1021 => AnyServerTag::DebugHTTPSServer,
        _ => unreachable!("Invalid pointer tag"),
    };
    AnyServer {
        tag,
        ptr: repr.get::<()>(),
    }
}

/// `jsc.Codegen.JSNodeHTTPResponse` cached-property accessors.
/// `codegen_cached_accessors!` emits `on_{data,aborted,writable}_{get,set}_cached`
/// thin wrappers over the C++ `NodeHTTPResponsePrototype__on*{Get,Set}CachedValue`
/// `WriteBarrier<Unknown>` slots, named to match the Zig spelling so the
/// `.zig` ↔ `.rs` diff lines up.
pub mod js {
    bun_jsc::codegen_cached_accessors!("NodeHTTPResponse"; onData, onAborted, onWritable);
}

impl NodeHTTPResponse {
    // ─── R-2 interior-mutability helpers ─────────────────────────────────────

    /// Read-modify-write the packed `Cell<Flags>` through `&self`.
    #[inline]
    fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut v = self.flags.get();
        f(&mut v);
        self.flags.set(v);
    }

    // ─────────────────────────────────────────────────────────────────────────

    pub fn get_this_value(&self) -> JSValue {
        let flags = self.flags.get();
        let Some(raw) = self.raw_response.get() else {
            return JSValue::ZERO;
        };
        if flags.contains(Flags::SOCKET_CLOSED) || flags.contains(Flags::UPGRADED) {
            return JSValue::ZERO;
        }
        Bun__getNodeHTTPResponseThisValue(any_response_is_ssl(&raw), raw.socket().cast())
    }

    pub fn get_server_socket_value(&self) -> JSValue {
        let flags = self.flags.get();
        let Some(raw) = self.raw_response.get() else {
            return JSValue::ZERO;
        };
        if flags.contains(Flags::SOCKET_CLOSED) || flags.contains(Flags::UPGRADED) {
            return JSValue::ZERO;
        }
        Bun__getNodeHTTPServerSocketThisValue(any_response_is_ssl(&raw), raw.socket().cast())
    }

    pub fn pause_socket(&self) {
        scoped_log!(NodeHTTPResponse, "pauseSocket");
        let flags = self.flags.get();
        let Some(raw) = self.raw_response.get() else {
            return;
        };
        if flags.contains(Flags::SOCKET_CLOSED)
            || flags.contains(Flags::UPGRADED)
            || raw.is_connect_request()
        {
            return;
        }
        raw.pause();
    }

    pub fn resume_socket(&self) {
        scoped_log!(NodeHTTPResponse, "resumeSocket");
        let flags = self.flags.get();
        let Some(raw) = self.raw_response.get() else {
            return;
        };
        if flags.contains(Flags::SOCKET_CLOSED)
            || flags.contains(Flags::UPGRADED)
            || raw.is_connect_request()
        {
            return;
        }
        raw.resume_();
    }

    pub fn upgrade(
        &self,
        data_value: JSValue,
        sec_websocket_protocol: ZigString,
        sec_websocket_extensions: ZigString,
    ) -> bool {
        let upgrade_ctx = self.upgrade_context.get().context;
        if upgrade_ctx.is_null() {
            return false;
        }
        // `AnyServer` is a `Copy` type-erased pointer; copy it so the
        // `&mut self`-taking accessor can be called from this `&self` body
        // (R-2 Phase 2). The pointee is the long-lived server, not `*self`.
        let mut server = self.server;
        let Some(ws_handler) = server.web_socket_handler() else {
            return false;
        };
        // PORT NOTE: reshaped for borrowck — extend handler lifetime past method calls.
        // SAFETY: JS-thread only; the server (and its websocket config) outlives this call.
        let ws_handler: &mut crate::server::WebSocketServerHandler =
            unsafe { &mut *std::ptr::from_mut(ws_handler) };
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

        // R-2: `JsCell::get()` projects `&UpgradeCTX`; the borrow lives until
        // the explicit `drop`s below (no `with_mut` on this cell overlaps).
        let upgrade_context: &UpgradeCTX = self.upgrade_context.get();

        let sec_websocket_protocol_value: &[u8] = 'brk: {
            if sec_websocket_protocol.len == 0 {
                if !upgrade_context.request.is_null() {
                    // S008: `uws::Request` is an `opaque_ffi!` ZST — safe deref.
                    let request = bun_opaque::opaque_deref(upgrade_context.request.cast_const());
                    break 'brk request.header(b"sec-websocket-protocol").unwrap_or(b"");
                } else {
                    break 'brk &upgrade_context.sec_websocket_protocol;
                }
            }
            sec_websocket_protocol_str = Some(sec_websocket_protocol.to_slice());
            break 'brk sec_websocket_protocol_str.as_ref().unwrap().slice();
        };

        let sec_websocket_extensions_value: &[u8] = 'brk: {
            if sec_websocket_extensions.len == 0 {
                if !upgrade_context.request.is_null() {
                    // S008: `uws::Request` is an `opaque_ffi!` ZST — safe deref.
                    let request = bun_opaque::opaque_deref(upgrade_context.request.cast_const());
                    break 'brk request.header(b"sec-websocket-extensions").unwrap_or(b"");
                } else {
                    break 'brk &upgrade_context.sec_websocket_extensions;
                }
            }
            sec_websocket_extensions_str = Some(sec_websocket_extensions.to_slice());
            break 'brk sec_websocket_extensions_str.as_ref().unwrap().slice();
        };

        let websocket_key: &[u8] = if !upgrade_context.request.is_null() {
            // S008: `uws::Request` is an `opaque_ffi!` ZST — safe deref.
            let request = bun_opaque::opaque_deref(upgrade_context.request.cast_const());
            request.header(b"sec-websocket-key").unwrap_or(b"")
        } else {
            &upgrade_context.sec_websocket_key
        };

        if let Some(raw_response) = self.raw_response.take() {
            self.update_flags(|f| f.insert(Flags::UPGRADED));
            // Unref the poll_ref since the socket is now upgraded to WebSocket
            // and will have its own lifecycle management
            let vm = self.server.global_this().bun_vm().as_mut();
            self.poll_ref.with_mut(|r| r.unref(vm));
            // S008: `WebSocketUpgradeContext` is an `opaque_ffi!` ZST — safe deref
            // (`upgrade_ctx` checked non-null above).
            let ctx = bun_opaque::opaque_deref_mut(upgrade_ctx);
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
        self.upgrade_context.with_mut(|c| c.reset());

        true
    }

    pub fn maybe_stop_reading_body(&self, vm: &mut VirtualMachine, this_value: JSValue) {
        self.upgrade_context.with_mut(|c| c.reset()); // we can discard the upgrade context now

        let flags = self.flags.get();
        if (flags.contains(Flags::UPGRADED)
            || flags.contains(Flags::SOCKET_CLOSED)
            || flags.contains(Flags::ENDED))
            && (self.body_read_ref.get().has
                || self.body_read_state.get() == BodyReadState::Pending)
            && (!flags.contains(Flags::HAS_CUSTOM_ON_DATA)
                || js::on_data_get_cached(this_value).is_none())
        {
            let had_ref = self.body_read_ref.get().has;
            if !flags.contains(Flags::UPGRADED) && !flags.contains(Flags::SOCKET_CLOSED) {
                scoped_log!(NodeHTTPResponse, "clearOnData");
                if let Some(raw_response) = self.raw_response.get() {
                    raw_response.clear_on_data();
                }
            }

            self.body_read_ref.with_mut(|r| r.unref(vm));
            self.body_read_state.set(BodyReadState::Done);

            if had_ref {
                self.mark_request_as_done_if_necessary();
            }
        }
    }

    pub fn should_request_be_pending(&self) -> bool {
        let flags = self.flags.get();
        if flags.contains(Flags::SOCKET_CLOSED) {
            return false;
        }

        if flags.contains(Flags::ENDED) {
            return self.body_read_state.get() == BodyReadState::Pending;
        }

        true
    }

    pub fn dump_request_body(
        &self,
        global_object: &JSGlobalObject,
        _callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        if self
            .buffered_request_body_data_during_pause
            .get()
            .capacity()
            > 0
        {
            self.buffered_request_body_data_during_pause
                .with_mut(|b| b.clear_and_free());
        }
        if !self.flags.get().contains(Flags::REQUEST_HAS_COMPLETED) {
            self.clear_on_data_callback(this_value, global_object);
        }

        Ok(JSValue::UNDEFINED)
    }

    fn mark_request_as_done(&self) {
        scoped_log!(NodeHTTPResponse, "markRequestAsDone()");
        // defer this.deref(); — moved to end of fn body.
        self.update_flags(|f| f.remove(Flags::IS_REQUEST_PENDING));

        let vm = vm_get();
        self.clear_on_data_callback(self.get_this_value(), vm.global());
        self.upgrade_context.with_mut(|c| c.reset());

        self.buffered_request_body_data_during_pause
            .with_mut(|b| b.clear_and_free());
        let mut server = self.server;
        self.poll_ref.with_mut(|r| r.unref(vm));
        self.unregister_auto_flush();

        server.on_request_complete();

        self.deref();
    }

    fn mark_request_as_done_if_necessary(&self) {
        if self.flags.get().contains(Flags::IS_REQUEST_PENDING) && !self.should_request_be_pending()
        {
            self.mark_request_as_done();
        }
    }

    fn is_done(&self) -> bool {
        self.flags.get().is_done()
    }

    fn is_requested_completed_or_ended(&self) -> bool {
        self.flags.get().is_requested_completed_or_ended()
    }

    pub fn set_on_aborted_handler(&self) {
        let flags = self.flags.get();
        if flags.contains(Flags::SOCKET_CLOSED) {
            return;
        }
        // Don't overwrite WebSocket user data
        if !flags.contains(Flags::UPGRADED) {
            if let Some(raw_response) = self.raw_response.get() {
                raw_response.on_timeout(on_timeout_shim, self.as_ctx_ptr());
            }
        }
        // detach and
        self.upgrade_context
            .with_mut(|c| c.preserve_web_socket_headers_if_needed());
    }

    pub fn get_ended(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(self.flags.get().contains(Flags::ENDED))
    }

    pub fn get_finished(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(self.flags.get().contains(Flags::REQUEST_HAS_COMPLETED))
    }

    pub fn get_flags(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number_from_int32(self.flags.get().bits() as i32)
    }

    pub fn get_aborted(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(self.flags.get().contains(Flags::SOCKET_CLOSED))
    }

    pub fn get_has_body(&self, _global: &JSGlobalObject) -> JSValue {
        let mut result: i32 = 0;
        match self.body_read_state.get() {
            BodyReadState::None => {}
            BodyReadState::Pending => result |= 1 << 1,
            BodyReadState::Done => result |= 1 << 2,
        }
        if self.buffered_request_body_data_during_pause.get().len() > 0 {
            result |= 1 << 3;
        }
        if self
            .flags
            .get()
            .contains(Flags::IS_DATA_BUFFERED_DURING_PAUSE_LAST)
        {
            result |= 1 << 2;
        }

        JSValue::js_number_from_int32(result)
    }

    pub fn get_buffered_amount(&self, _global: &JSGlobalObject) -> JSValue {
        let flags = self.flags.get();
        if flags.contains(Flags::REQUEST_HAS_COMPLETED) || flags.contains(Flags::SOCKET_CLOSED) {
            return JSValue::js_number_from_int32(0);
        }
        if let Some(raw_response) = self.raw_response.get() {
            return JSValue::js_number_from_uint64(raw_response.get_buffered_amount());
        }
        JSValue::js_number_from_int32(0)
    }

    pub fn js_ref(&self, global_object: &JSGlobalObject, _frame: &CallFrame) -> JSValue {
        if !self.is_done() {
            self.poll_ref
                .with_mut(|r| r.r#ref(bun_vm_mut(global_object)));
        }
        JSValue::UNDEFINED
    }

    pub fn js_unref(&self, global_object: &JSGlobalObject, _frame: &CallFrame) -> JSValue {
        if !self.is_done() {
            self.poll_ref
                .with_mut(|r| r.unref(bun_vm_mut(global_object)));
        }
        JSValue::UNDEFINED
    }
}

fn handle_ended_if_necessary(state: uws::State, global_object: &JSGlobalObject) -> JsResult<()> {
    if !state.is_response_pending() {
        return err_throw(
            global_object,
            ErrorCode::ERR_HTTP_HEADERS_SENT,
            "Stream is already ended",
        );
    }
    Ok(())
}

impl NodeHTTPResponse {
    pub fn write_head(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // PORT NOTE: `arguments_undef::<3>()` returns `Arguments<3>` — a 32-byte
        // `[JSValue; 3]` + `len` aggregate — *by value*, which `cargo asm` shows
        // lowered to a per-`writeHead` `vmovups` stack copy on the node:http hot
        // path. The borrowed `arguments()` slice (ptr+len, 16 bytes) carries the
        // same information; missing / `null` slots are padded to `undefined`
        // inline below exactly as the `Arguments<3>` form did.
        let arguments = callframe.arguments();

        if self.is_requested_completed_or_ended() {
            return err_throw(
                global_object,
                ErrorCode::ERR_STREAM_ALREADY_FINISHED,
                "Stream is already ended",
            );
        }

        let flags = self.flags.get();
        let Some(raw_response) = self.raw_response.get() else {
            // We haven't emitted the "close" event yet.
            return Ok(JSValue::UNDEFINED);
        };
        if flags.contains(Flags::SOCKET_CLOSED) || flags.contains(Flags::UPGRADED) {
            // We haven't emitted the "close" event yet.
            return Ok(JSValue::UNDEFINED);
        }

        let state = raw_response.state();
        handle_ended_if_necessary(state, global_object)?;

        let status_code_value: JSValue =
            arguments.first().copied().unwrap_or(JSValue::UNDEFINED);
        let status_message_value: JSValue = match arguments.get(1).copied() {
            Some(v) if v != JSValue::NULL => v,
            _ => JSValue::UNDEFINED,
        };
        let headers_object_value: JSValue = match arguments.get(2).copied() {
            Some(v) if v != JSValue::NULL => v,
            _ => JSValue::UNDEFINED,
        };

        let status_code: i32 = if !status_code_value.is_undefined() {
            global_object.validate_integer_range::<i32>(
                status_code_value,
                200,
                jsc::IntegerRange {
                    min: 100,
                    max: 999,
                    field_name: b"statusCode",
                    ..Default::default()
                },
            )?
        } else {
            200
        };

        // Hot path: src/js/node/_http_server.ts always sets `response.statusMessage`,
        // so we always land here with a short JS string. `to_slice()` would do
        // 2×ref + 2×deref FFI (OwnedString + ZigStringSlice::WTF); instead hold
        // the +1 from `to_bun_string` in an `OwnedString` and borrow the bytes
        // without the inner ref bump (Zig: `defer str.deref()` + `toUTF8`).
        let status_message_str;
        let status_message_slice;
        let status_message_bytes: &[u8] = if !status_message_value.is_undefined() {
            status_message_str = bun_core::OwnedString::new(
                status_message_value.to_bun_string(global_object)?,
            );
            status_message_slice = status_message_str.to_utf8_without_ref();
            status_message_slice.slice()
        } else {
            &[]
        };

        if global_object.has_exception() {
            return Err(jsc::JsError::Thrown);
        }

        if state.is_http_status_called() {
            return err_throw(
                global_object,
                ErrorCode::ERR_HTTP_HEADERS_SENT,
                "Stream already started",
            );
        }

        // Validate status message does not contain invalid characters (defense-in-depth
        // against HTTP response splitting). Matches Node.js checkInvalidHeaderChar:
        // rejects any char not in [\t\x20-\x7e\x80-\xff].
        for &c in status_message_bytes {
            if c != b'\t' && (c < 0x20 || c == 0x7f) {
                return err_throw(
                    global_object,
                    ErrorCode::ERR_INVALID_CHAR,
                    "Invalid character in statusMessage",
                );
            }
        }

        'do_it: {
            if status_message_bytes.is_empty() {
                if let Some(status_message) =
                    HTTPStatusText::get(u16::try_from(status_code).expect("int cast"))
                {
                    write_head_internal(
                        &raw_response,
                        global_object,
                        status_message,
                        headers_object_value,
                    );
                    break 'do_it;
                }
            }

            let message: &[u8] = if !status_message_bytes.is_empty() {
                status_message_bytes
            } else {
                b"HM"
            };

            // Zig spec (NodeHTTPResponse.zig:455/491): 256-byte stackFallback +
            // `{d} {s}` (plain memcpy). The previous Vec + write! + BStr-Display
            // path showed up at 0.54% incl in perf (core::fmt vtable + BStr UTF-8
            // chunk-validation). status_code is 100..=999 → always 3 digits.
            let mut itoa_buf = bun_core::fmt::ItoaBuf::new();
            let code = bun_core::fmt::itoa(&mut itoa_buf, status_code);
            let n = code.len() + 1 + message.len();

            let mut stack_buf = [0u8; 256];
            if n <= stack_buf.len() {
                stack_buf[..code.len()].copy_from_slice(code);
                stack_buf[code.len()] = b' ';
                stack_buf[code.len() + 1..n].copy_from_slice(message);
                write_head_internal(
                    &raw_response,
                    global_object,
                    &stack_buf[..n],
                    headers_object_value,
                );
            } else {
                // Heap fallback for absurdly long status messages (> 252 bytes).
                let mut heap = Vec::with_capacity(n);
                heap.extend_from_slice(code);
                heap.push(b' ');
                heap.extend_from_slice(message);
                write_head_internal(
                    &raw_response,
                    global_object,
                    &heap,
                    headers_object_value,
                );
            }
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
        uws::AnyResponse::TCP(tcp) => NodeHTTPServer__writeHead_http(
            global_object,
            status_message.as_ptr(),
            status_message.len(),
            headers,
            (*tcp).cast::<c_void>(),
        ),
        uws::AnyResponse::SSL(ssl) => NodeHTTPServer__writeHead_https(
            global_object,
            status_message.as_ptr(),
            status_message.len(),
            headers,
            (*ssl).cast::<c_void>(),
        ),
        uws::AnyResponse::H3(_) => {
            bun_core::Output::panic(format_args!("node:http does not support HTTP/3 responses"));
        }
    }
}

impl NodeHTTPResponse {
    pub fn write_continue(
        &self,
        global_object: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.is_done() {
            return Ok(JSValue::UNDEFINED);
        }
        let Some(raw_response) = self.raw_response.get() else {
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
    fn handle_abort_or_timeout<const EVENT: AbortEvent>(&self, js_value: JSValue) {
        // defer { if event == abort, raw_response = None }
        // PORT NOTE: reshaped for borrowck — deferred null moved to explicit tail positions.

        if self.flags.get().contains(Flags::REQUEST_HAS_COMPLETED) {
            if EVENT == AbortEvent::Abort {
                self.raw_response.set(None);
            }
            return;
        }

        if EVENT == AbortEvent::Abort {
            self.update_flags(|f| f.insert(Flags::SOCKET_CLOSED));
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
            let event_loop = vm.event_loop_ref();

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

        // Deferred tail (Zig defer order is preserved up to one reorder: the
        // outer `defer raw_response = None` is hoisted above `deref()` because
        // `mark_request_as_done_if_necessary()` + `deref()` can drop the last
        // ref when the JS wrapper has already finalized; nothing between them
        // reads `raw_response`, so the swap is observably equivalent and
        // avoids a post-destroy write).
        if EVENT == AbortEvent::Abort {
            self.mark_request_as_done_if_necessary();
            self.raw_response.set(None);
        }
        self.deref();
    }

    #[uws::uws_callback(export = "Bun__NodeHTTPResponse_onClose")]
    pub fn on_abort(&self, js_value: JSValue) {
        scoped_log!(NodeHTTPResponse, "onAbort");
        self.handle_abort_or_timeout::<{ AbortEvent::Abort }>(js_value);
    }

    #[uws::uws_callback(export = "Bun__NodeHTTPResponse_setClosed", no_catch)]
    pub fn set_closed(&self) {
        self.update_flags(|f| f.insert(Flags::SOCKET_CLOSED));
    }

    pub fn on_timeout(&self, _resp: uws::AnyResponse) {
        scoped_log!(NodeHTTPResponse, "onTimeout");
        self.handle_abort_or_timeout::<{ AbortEvent::Timeout }>(JSValue::ZERO);
    }

    pub fn do_pause(
        &self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
        _this_value: JSValue,
    ) -> JsResult<JSValue> {
        scoped_log!(NodeHTTPResponse, "doPause");
        let flags = self.flags.get();
        let Some(raw) = self.raw_response.get() else {
            return Ok(JSValue::FALSE);
        };
        if flags.contains(Flags::REQUEST_HAS_COMPLETED)
            || flags.contains(Flags::SOCKET_CLOSED)
            || flags.contains(Flags::ENDED)
            || flags.contains(Flags::UPGRADED)
        {
            return Ok(JSValue::FALSE);
        }
        self.update_flags(|f| f.insert(Flags::IS_DATA_BUFFERED_DURING_PAUSE));
        raw.on_data(on_buffer_paused_shim, self.as_ctx_ptr());

        // TODO: figure out why windows is not emitting EOF with UV_DISCONNECT
        #[cfg(not(windows))]
        {
            self.pause_socket();
        }
        Ok(JSValue::TRUE)
    }

    pub fn drain_request_body(
        &self,
        global_object: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(self
            .drain_buffered_request_body_from_pause(global_object)
            .unwrap_or(JSValue::UNDEFINED))
    }

    fn drain_buffered_request_body_from_pause(
        &self,
        global_object: &JSGlobalObject,
    ) -> Option<JSValue> {
        scoped_log!(
            NodeHTTPResponse,
            "drainBufferedRequestBodyFromPause {}",
            self.buffered_request_body_data_during_pause.get().len()
        );
        if self.buffered_request_body_data_during_pause.get().len() > 0 {
            // Zig spec: `createBuffer` then `.{}` — `bun.ByteList` has no Drop, so the
            // assignment just forgets the storage and ownership transfers to JSC. A Rust
            // `Vec` *does* Drop, so the prior `create_buffer(slice_mut)` + `= Vec::new()`
            // freed the backing allocation while JSC still pointed at it (mimalloc
            // free-list pointer overwrote the first 8 bytes — test-http-pause.js saw
            // `'�\x01xУ\x02\x00\x00Body from Client'`). Move the Vec out and hand the
            // boxed slice to JSC so the deallocator owns the only free.
            let bytes = self
                .buffered_request_body_data_during_pause
                .replace(Vec::new());
            return Some(JSValue::create_buffer_from_box(
                global_object,
                bytes.into_boxed_slice(),
            ));
        }
        None
    }

    pub fn do_resume(&self, global_object: &JSGlobalObject, _frame: &CallFrame) -> JSValue {
        scoped_log!(NodeHTTPResponse, "doResume");
        let flags = self.flags.get();
        let Some(raw) = self.raw_response.get() else {
            return JSValue::FALSE;
        };
        if flags.contains(Flags::REQUEST_HAS_COMPLETED)
            || flags.contains(Flags::SOCKET_CLOSED)
            || flags.contains(Flags::ENDED)
            || flags.contains(Flags::UPGRADED)
        {
            return JSValue::FALSE;
        }
        self.set_on_aborted_handler();
        raw.on_data(on_data_shim, self.as_ctx_ptr());
        self.update_flags(|f| f.remove(Flags::IS_DATA_BUFFERED_DURING_PAUSE));
        let mut result: JSValue = JSValue::TRUE;

        if let Some(buffered_data) = self.drain_buffered_request_body_from_pause(global_object) {
            result = buffered_data;
        }

        self.resume_socket();
        result
    }

    pub fn on_request_complete(&self) {
        if self.flags.get().contains(Flags::REQUEST_HAS_COMPLETED) {
            return;
        }
        scoped_log!(NodeHTTPResponse, "onRequestComplete");
        self.update_flags(|f| f.insert(Flags::REQUEST_HAS_COMPLETED));
        self.poll_ref.with_mut(|r| r.unref(vm_get()));

        self.mark_request_as_done_if_necessary();
    }
}

#[bun_jsc::host_fn(export = "Bun__NodeHTTPRequest__onResolve")]
pub fn node_http_request_on_resolve(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JSValue {
    scoped_log!(NodeHTTPResponse, "onResolve");
    let arguments = callframe.arguments_old::<2>();
    // arguments[1] is the JSNodeHTTPResponse cell from the resolve callback.
    // R-2: deref shared — `maybe_stop_reading_body`/`on_request_complete` re-enter.
    let this: &NodeHTTPResponse = arguments.ptr[1].as_class_ref::<NodeHTTPResponse>().unwrap();
    this.promise.with_mut(|p| p.deinit());
    // defer this.deref(); — moved to tail.
    this.maybe_stop_reading_body(bun_vm_mut(global_object), arguments.ptr[1]);

    let flags = this.flags.get();
    if !flags.contains(Flags::REQUEST_HAS_COMPLETED) && !flags.contains(Flags::SOCKET_CLOSED) {
        let this_value = this.get_this_value();
        if !this_value.is_empty() {
            js::on_aborted_set_cached(this_value, global_object, JSValue::ZERO);
        }
        scoped_log!(NodeHTTPResponse, "clearOnData");
        if let Some(raw_response) = this.raw_response.get() {
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

#[bun_jsc::host_fn(export = "Bun__NodeHTTPRequest__onReject")]
pub fn node_http_request_on_reject(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JSValue {
    let arguments = callframe.arguments_old::<2>();
    let err = arguments.ptr[0];
    // arguments[1] is the JSNodeHTTPResponse cell from the reject callback.
    // R-2: deref shared — `maybe_stop_reading_body`/`on_request_complete` re-enter.
    let this: &NodeHTTPResponse = arguments.ptr[1].as_class_ref::<NodeHTTPResponse>().unwrap();
    this.promise.with_mut(|p| p.deinit());
    this.maybe_stop_reading_body(bun_vm_mut(global_object), arguments.ptr[1]);

    // defer this.deref(); — moved to tail.

    let flags = this.flags.get();
    if !flags.contains(Flags::REQUEST_HAS_COMPLETED)
        && !flags.contains(Flags::SOCKET_CLOSED)
        && !flags.contains(Flags::UPGRADED)
    {
        let this_value = this.get_this_value();
        if !this_value.is_empty() {
            js::on_aborted_set_cached(this_value, global_object, JSValue::ZERO);
        }
        scoped_log!(NodeHTTPResponse, "clearOnData");
        if let Some(raw_response) = this.raw_response.get() {
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
    pub fn abort(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        if self.is_done() {
            return Ok(JSValue::UNDEFINED);
        }

        self.update_flags(|f| f.insert(Flags::SOCKET_CLOSED));
        if let Some(raw_response) = self.raw_response.get() {
            let state = raw_response.state();
            if state.is_http_end_called() {
                return Ok(JSValue::UNDEFINED);
            }
        }
        self.resume_socket();
        scoped_log!(NodeHTTPResponse, "clearOnData");
        if let Some(raw_response) = self.raw_response.get() {
            raw_response.clear_on_data();
            raw_response.clear_on_writable();
            raw_response.clear_timeout();
            raw_response.end_without_body(true);
        }
        self.on_request_complete();
        Ok(JSValue::UNDEFINED)
    }

    fn on_buffer_request_body_while_paused(&self, chunk: &[u8], last: bool) {
        scoped_log!(
            NodeHTTPResponse,
            "onBufferRequestBodyWhilePaused({}, {})",
            chunk.len(),
            last
        );

        self.buffered_request_body_data_during_pause
            .with_mut(|b| b.append_slice(chunk));
        if last {
            self.update_flags(|f| f.insert(Flags::IS_DATA_BUFFERED_DURING_PAUSE_LAST));
            if self.body_read_ref.get().has {
                self.body_read_ref.with_mut(|r| r.unref(vm_get()));
                self.mark_request_as_done_if_necessary();
            }
        }
    }

    fn get_bytes(&self, global_this: &JSGlobalObject, chunk: &[u8]) -> JSValue {
        // TODO: we should have a error event for this but is better than ignoring it
        // right now the socket instead of emitting an error event it will reportUncaughtException
        // this makes the behavior aligned with current implementation, but not ideal
        let bytes: JSValue = 'brk: {
            if !chunk.is_empty() && self.buffered_request_body_data_during_pause.get().len() > 0 {
                let paused = self
                    .buffered_request_body_data_during_pause
                    .replace(Vec::new());
                let paused_len = paused.len();
                let mut combined: Vec<u8> = Vec::with_capacity(paused_len + chunk.len());
                combined.extend_from_slice(&paused);
                combined.extend_from_slice(chunk);
                drop(paused);
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

    fn on_data_or_aborted(&self, chunk: &[u8], last: bool, event: AbortEvent, this_value: JSValue) {
        scoped_log!(
            NodeHTTPResponse,
            "onDataOrAborted({}, {})",
            chunk.len(),
            last
        );
        if last {
            self.ref_();
            self.body_read_state.set(BodyReadState::Done);
        }

        // defer { if last { ... } } — moved to tail.

        if let Some(callback) = js::on_data_get_cached(this_value) {
            if !callback.is_undefined() {
                let vm = vm_get();
                let global_this = vm.global();
                let event_loop = vm.event_loop_ref();

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
            if self.body_read_ref.get().has {
                self.body_read_ref.with_mut(|r| r.unref(vm_get()));
                self.mark_request_as_done_if_necessary();
            }
            self.deref();
        }
    }

    pub const BUN_DEBUG_REFCOUNT_NAME: &'static str = "NodeHTTPServerResponse";

    pub fn on_data(&self, chunk: &[u8], last: bool) {
        scoped_log!(
            NodeHTTPResponse,
            "onData({} bytes, is_last = {})",
            chunk.len(),
            last as u8
        );

        self.on_data_or_aborted(chunk, last, AbortEvent::None, self.get_this_value());
    }

    fn on_drain_corked(&self, offset: u64) {
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

        vm.event_loop_ref().run_callback(
            on_writable,
            global_this,
            JSValue::UNDEFINED,
            &[JSValue::js_number_from_uint64(offset)],
        );

        self.deref();
    }

    fn on_drain(&self, offset: u64, response: uws::AnyResponse) -> bool {
        scoped_log!(NodeHTTPResponse, "onDrain({})", offset);

        let flags = self.flags.get();
        if flags.contains(Flags::SOCKET_CLOSED)
            || flags.contains(Flags::REQUEST_HAS_COMPLETED)
            || flags.contains(Flags::UPGRADED)
        {
            // return false means we don't have anything to drain
            return false;
        }

        response.corked(|| self.on_drain_corked(offset));
        // return true means we may have something to drain
        true
    }

    fn write_or_end<const IS_END: bool>(
        &self,
        global_object: &JSGlobalObject,
        arguments: &[JSValue],
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        if self.is_requested_completed_or_ended() {
            return err_throw(
                global_object,
                ErrorCode::ERR_STREAM_WRITE_AFTER_END,
                "Stream already ended",
            );
        }

        // Loosely mimicking this code:
        //      function _writeRaw(data, encoding, callback, size) {
        //        const conn = this[kSocket];
        //        if (conn?.destroyed) {
        //          // The socket was destroyed. If we're still trying to write to it,
        //          // then we haven't gotten the 'close' event yet.
        //          return false;
        //        }
        if self.flags.get().contains(Flags::SOCKET_CLOSED) || self.raw_response.get().is_none() {
            return Ok(if IS_END {
                JSValue::UNDEFINED
            } else {
                JSValue::js_number_from_int32(0)
            });
        }

        // PORT NOTE: re-read raw_response at each use site (R-2: methods that
        // re-enter may clear it).
        let state = self.raw_response.get().unwrap().state();
        if !state.is_response_pending() {
            return err_throw(
                global_object,
                ErrorCode::ERR_STREAM_WRITE_AFTER_END,
                "Stream already ended",
            );
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
                        b"callback",
                        b"function",
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

        // Construct in place (Zig result-location semantics) — returning
        // `JsResult<Option<StringOrBuffer>>` by value here lowered to ~128B of
        // `vmovups` stack copies per `res.end()`; the `_into` out-param form
        // writes straight into this slot.
        let mut string_or_buffer = crate::node::StringOrBuffer::EMPTY;
        if !input_value.is_undefined_or_null() {
            let mut encoding = crate::node::Encoding::Utf8;
            if !encoding_value.is_undefined_or_null() {
                if !encoding_value.is_string() {
                    return Err(global_object.throw_invalid_argument_type_value(
                        b"encoding",
                        b"string",
                        encoding_value,
                    ));
                }

                encoding = match crate::node::Encoding::from_js(encoding_value, global_object)? {
                    Some(e) => e,
                    None => {
                        return Err(
                            global_object.throw_invalid_arguments(format_args!("Invalid encoding"))
                        );
                    }
                };
            }

            if !crate::node::StringOrBuffer::from_js_with_encoding_into(
                &mut string_or_buffer,
                global_object,
                input_value,
                encoding,
            )? {
                return Err(global_object.throw_invalid_argument_type_value(
                    b"input",
                    b"string or buffer",
                    input_value,
                ));
            }
        }
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
            let bytes_written = self.bytes_written.get() + bytes.len();

            if IS_END {
                if bytes_written as u64 != content_length {
                    return err_throw(
                        global_object,
                        ErrorCode::ERR_HTTP_CONTENT_LENGTH_MISMATCH,
                        "Content-Length mismatch",
                    );
                }
            } else if bytes_written as u64 > content_length {
                return err_throw(
                    global_object,
                    ErrorCode::ERR_HTTP_CONTENT_LENGTH_MISMATCH,
                    "Content-Length mismatch",
                );
            }
            self.bytes_written.set(bytes_written);
        } else {
            self.bytes_written
                .set(self.bytes_written.get().saturating_add(bytes.len()));
        }
        if IS_END {
            // Discard the body read ref if it's pending and no onData callback is set at this point.
            // This is the equivalent of req._dump().
            if self.body_read_ref.get().has
                && self.body_read_state.get() == BodyReadState::Pending
                && (!self.flags.get().contains(Flags::HAS_CUSTOM_ON_DATA)
                    || js::on_data_get_cached(this_value).is_none())
            {
                self.body_read_ref.with_mut(|r| r.unref(vm_get()));
                self.body_read_state.set(BodyReadState::None);
            }

            if !this_value.is_empty() {
                js::on_aborted_set_cached(this_value, global_object, JSValue::ZERO);
            }

            let raw_response = self.raw_response.get().unwrap();
            raw_response.clear_aborted();
            raw_response.clear_on_writable();
            raw_response.clear_timeout();
            self.update_flags(|f| f.insert(Flags::ENDED));
            let raw_response = self.raw_response.get().unwrap();
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
            let raw_response = self.raw_response.get().unwrap();
            match raw_response.write(bytes) {
                uws::WriteResult::WantMore(written) => {
                    raw_response.clear_on_writable();
                    js::on_writable_set_cached(js_this, global_object, JSValue::UNDEFINED);
                    Ok(JSValue::js_number_from_uint64(written as u64))
                }
                uws::WriteResult::Backpressure(written) => {
                    if !callback_value.is_undefined() {
                        js::on_writable_set_cached(
                            js_this,
                            global_object,
                            callback_value.with_async_context_if_needed(global_object),
                        );
                        raw_response.on_writable(on_drain_shim, self.as_ctx_ptr());
                    }

                    // PERF(port): @intCast — bounded by min().
                    let clamped = i64::try_from(written.min(i64::MAX as usize)).expect("int cast");
                    Ok(JSValue::js_number((-clamped) as f64))
                }
            }
        }
    }

    pub fn set_on_writable(
        &self,
        this_value: JSValue,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) {
        if self.is_done() || value.is_undefined() {
            js::on_writable_set_cached(this_value, global_object, JSValue::UNDEFINED);
        } else {
            js::on_writable_set_cached(
                this_value,
                global_object,
                value.with_async_context_if_needed(global_object),
            );
        }
    }

    pub fn get_on_writable(&self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        js::on_writable_get_cached(this_value).unwrap_or(JSValue::UNDEFINED)
    }

    pub fn get_on_abort(&self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        let flags = self.flags.get();
        if flags.contains(Flags::SOCKET_CLOSED) || flags.contains(Flags::UPGRADED) {
            return JSValue::UNDEFINED;
        }
        js::on_aborted_get_cached(this_value).unwrap_or(JSValue::UNDEFINED)
    }

    pub fn set_on_abort(
        &self,
        this_value: JSValue,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) {
        let flags = self.flags.get();
        if flags.contains(Flags::SOCKET_CLOSED) || flags.contains(Flags::UPGRADED) {
            return;
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
    }

    pub fn get_on_data(&self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        js::on_data_get_cached(this_value).unwrap_or(JSValue::UNDEFINED)
    }

    pub fn get_has_custom_on_data(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(self.flags.get().contains(Flags::HAS_CUSTOM_ON_DATA))
    }

    pub fn get_upgraded(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(self.flags.get().contains(Flags::UPGRADED))
    }

    pub fn set_has_custom_on_data(&self, _global: &JSGlobalObject, value: JSValue) {
        self.update_flags(|f| f.set(Flags::HAS_CUSTOM_ON_DATA, value.to_boolean()));
    }

    fn clear_on_data_callback(&self, this_value: JSValue, global_object: &JSGlobalObject) {
        scoped_log!(NodeHTTPResponse, "clearOnDataCallback");
        if self.body_read_state.get() != BodyReadState::None {
            if !this_value.is_empty() {
                js::on_data_set_cached(this_value, global_object, JSValue::UNDEFINED);
            }
            let flags = self.flags.get();
            if !flags.contains(Flags::SOCKET_CLOSED) && !flags.contains(Flags::UPGRADED) {
                scoped_log!(NodeHTTPResponse, "clearOnData");
                if let Some(raw_response) = self.raw_response.get() {
                    raw_response.clear_on_data();
                }
            }
            if self.body_read_state.get() != BodyReadState::Done {
                self.body_read_state.set(BodyReadState::Done);
            }
        }
    }

    pub fn set_on_data(&self, this_value: JSValue, global_object: &JSGlobalObject, value: JSValue) {
        // Only `.pending` accepts a callback. `.done` means either uSockets delivered last=true or JS
        // previously cleared `ondata` (which already called clearOnData()); either way, there is no
        // more body to read, so don't re-register with uSockets or churn refs.
        let flags = self.flags.get();
        if value.is_undefined()
            || flags.contains(Flags::ENDED)
            || flags.contains(Flags::SOCKET_CLOSED)
            || self.body_read_state.get() != BodyReadState::Pending
            || flags.contains(Flags::IS_DATA_BUFFERED_DURING_PAUSE_LAST)
            || flags.contains(Flags::UPGRADED)
        {
            js::on_data_set_cached(this_value, global_object, JSValue::UNDEFINED);
            // defer { if body_read_ref.has { unref } } — moved to tail of this branch.
            match self.body_read_state.get() {
                BodyReadState::Pending | BodyReadState::Done => {
                    if !flags.contains(Flags::REQUEST_HAS_COMPLETED)
                        && !flags.contains(Flags::SOCKET_CLOSED)
                        && !flags.contains(Flags::UPGRADED)
                    {
                        scoped_log!(NodeHTTPResponse, "clearOnData");
                        if let Some(raw_response) = self.raw_response.get() {
                            raw_response.clear_on_data();
                        }
                    }
                    self.body_read_state.set(BodyReadState::Done);
                }
                BodyReadState::None => {}
            }
            if self.body_read_ref.get().has {
                self.body_read_ref
                    .with_mut(|r| r.unref(bun_vm_mut(global_object)));
            }
            return;
        }

        js::on_data_set_cached(
            this_value,
            global_object,
            value.with_async_context_if_needed(global_object),
        );
        self.update_flags(|f| f.insert(Flags::HAS_CUSTOM_ON_DATA));
        if let Some(raw_response) = self.raw_response.get() {
            raw_response.on_data(on_data_shim, self.as_ctx_ptr());
        }
        self.update_flags(|f| f.remove(Flags::IS_DATA_BUFFERED_DURING_PAUSE));

        // Every site that unrefs `body_read_ref` also transitions `body_read_state` out of `.pending`
        // or sets `is_data_buffered_during_pause_last`, both of which are rejected by the guard above.
        // So reaching here, `body_read_ref` is still held from create(). Do not re-acquire it or
        // `this.ref()` — there would be no balancing release (PR #18564 removed the paired derefs).
        debug_assert!(self.body_read_ref.get().has);
    }

    pub fn write(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        self.write_or_end::<false>(global_object, arguments, JSValue::ZERO)
    }

    pub fn on_auto_flush(&self) -> bool {
        // defer this.deref(); — moved to tail.
        let flags = self.flags.get();
        if !flags.contains(Flags::SOCKET_CLOSED) && !flags.contains(Flags::UPGRADED) {
            if let Some(raw_response) = self.raw_response.get() {
                raw_response.uncork();
            }
        }
        self.auto_flusher.get().registered.set(false);
        self.deref();
        false
    }

    // R-2: inlined `AutoFlusher::register_deferred_microtask_with_type_unchecked`
    // — that helper now takes `&T`, but this type has its own
    // `on_auto_flush_trampoline` (extra `self.ref_()`) so the inline body
    // stays.
    fn register_auto_flush(&self) {
        if self.auto_flusher.get().registered.get() {
            return;
        }
        self.ref_();
        debug_assert!(!self.auto_flusher.get().registered.get());
        self.auto_flusher.get().registered.set(true);
        let ctx = ptr::NonNull::new(self.as_ctx_ptr().cast::<c_void>());
        let found_existing = vm_get()
            .event_loop_ref()
            .deferred_tasks
            .post_task(ctx, on_auto_flush_trampoline);
        debug_assert!(!found_existing);
    }

    fn unregister_auto_flush(&self) {
        if !self.auto_flusher.get().registered.get() {
            return;
        }
        debug_assert!(self.auto_flusher.get().registered.get());
        let ctx = ptr::NonNull::new(self.as_ctx_ptr().cast::<c_void>());
        let removed = vm_get()
            .event_loop_ref()
            .deferred_tasks
            .unregister_task(ctx);
        debug_assert!(removed);
        self.auto_flusher.get().registered.set(false);
        self.deref();
    }

    pub fn flush_headers(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        let flags = self.flags.get();
        if !flags.contains(Flags::SOCKET_CLOSED) && !flags.contains(Flags::UPGRADED) {
            if let Some(raw_response) = self.raw_response.get() {
                // Don't flush immediately; queue a microtask to uncork the socket.
                raw_response.flush_headers(false);
                if raw_response.is_corked() {
                    self.register_auto_flush();
                }
            }
        }

        Ok(JSValue::UNDEFINED)
    }

    pub fn end(&self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        // We dont wanna a paused socket when we call end, so is important to resume the socket
        self.resume_socket();
        self.write_or_end::<true>(global_object, arguments, callframe.this())
    }

    pub fn get_bytes_written(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JSValue {
        JSValue::js_number(self.bytes_written.get() as f64)
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
    pub fn set_timeout(&self, seconds: u8) {
        let flags = self.flags.get();
        let Some(raw) = self.raw_response.get() else {
            return;
        };
        if flags.contains(Flags::REQUEST_HAS_COMPLETED)
            || flags.contains(Flags::SOCKET_CLOSED)
            || flags.contains(Flags::UPGRADED)
        {
            return;
        }

        raw.timeout(seconds);
    }

    pub fn cork(&self, global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        // PORT NOTE: borrow the `arguments()` slice (ptr+len) instead of
        // materialising `Arguments<1>` by value — `cork` runs on every
        // `res.end()`, so the small-aggregate copy + bounds branch are pure
        // per-request overhead with no upstream equivalent.
        let Some(&corked_fn) = callframe.arguments().first() else {
            return Err(global_object.throw_not_enough_arguments("cork", 1, 0));
        };

        if !corked_fn.is_callable() {
            return Err(global_object.throw_invalid_argument_type_value(
                b"cork",
                b"function",
                corked_fn,
            ));
        }

        let flags = self.flags.get();
        if flags.contains(Flags::REQUEST_HAS_COMPLETED)
            || flags.contains(Flags::SOCKET_CLOSED)
            || flags.contains(Flags::UPGRADED)
        {
            return err_throw(
                global_object,
                ErrorCode::ERR_STREAM_ALREADY_FINISHED,
                "Stream is already ended",
            );
        }

        let mut result: JSValue = JSValue::ZERO;
        let mut is_exception: bool = false;

        // R-2: this method takes `&self`, so the `noalias` miscompile
        // (b818e70e1c57) is structurally impossible — `&T` is `readonly`, not
        // `noalias`, so re-entrant writes through other `&self` views are
        // sound. No `black_box` launder is needed; it was a hard optimization
        // barrier on the node:http hot path (`cork` runs on every `res.end()`)
        // that forced `self` to memory and blocked inlining/regalloc of the
        // cork prologue, with no equivalent in upstream Zig.
        let this = bun_ptr::BackRef::from(ptr::NonNull::from(self));
        // BACKREF: `this` is the live `m_ctx` heap payload; `ref_()` keeps it
        // alive across re-entry.
        this.ref_();
        // defer this.deref(); — moved to tail.

        // Snapshot before re-entry; `raw_response` is `Copy`.
        let raw_response = this.raw_response.get();
        if let Some(raw_response) = raw_response {
            raw_response.corked(|| {
                // Capture `this` so a `self`-derived pointer reaches the FFI
                // closure-data slot (see PORT NOTE above).
                let _escape = this;
                handle_corked(global_object, corked_fn, &mut result, &mut is_exception)
            });
        } else {
            handle_corked(global_object, corked_fn, &mut result, &mut is_exception);
        }

        let ret: JsResult<JSValue> = if is_exception {
            if !result.is_empty() {
                Err(global_object.throw_value(result))
            } else {
                Err(global_object.throw(format_args!("unknown error")))
            }
        } else if result.is_empty() {
            Ok(JSValue::UNDEFINED)
        } else {
            Ok(result)
        };

        // BACKREF: `this` held alive by the `ref_()` above; this is the
        // balancing release. Explicit `.get()` so the inherent refcount
        // `NodeHTTPResponse::deref(&self)` is selected, not `<BackRef as Deref>::deref`.
        this.get().deref();
        ret
    }

    pub fn finalize(self: Box<Self>) {
        bun_ptr::finalize_js_box_noop(self);
    }

    /// Called by intrusive RefCount when count reaches zero.
    fn deinit(&self) {
        debug_assert!(!self.body_read_ref.get().has);
        debug_assert!(!self.poll_ref.get().has);
        let flags = self.flags.get();
        debug_assert!(!flags.contains(Flags::IS_REQUEST_PENDING));
        debug_assert!(
            flags.contains(Flags::SOCKET_CLOSED) || flags.contains(Flags::REQUEST_HAS_COMPLETED)
        );

        self.buffered_request_body_data_during_pause
            .with_mut(|b| b.clear_and_free());
        self.poll_ref.with_mut(|r| r.unref(vm_get()));
        self.body_read_ref.with_mut(|r| r.unref(vm_get()));

        self.promise.with_mut(|p| p.deinit());
        // SAFETY: self was allocated via `heap::into_raw` in `createForJS`;
        // refcount is zero so no other references remain. R-2 interim: the
        // codegen shim still hands us `&mut T` (auto-deref'd to `&self`), so
        // the `*const → *mut` cast retains the original Box provenance. Once
        // Phase 1 lands the shim will pass the raw m_ctx as `&T` directly and
        // this remains the unique owner at count==0.
        unsafe { drop(bun_core::heap::take(self.as_ctx_ptr())) };
    }

    // Intrusive refcount helpers (mirrors Zig `bun.ptr.RefCount(@This(), ...)` mixin).
    #[inline]
    pub fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }

    #[inline]
    pub fn deref(&self) {
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            self.deinit();
        }
    }
}

// `AnyRefCounted` bridge so `bun_ptr::finalize_js_box*` / `RefPtr` accept this
// type. Hand-written (not `#[derive(CellRefCounted)]`) because the existing
// `&self`-receiver `deref()` above is called from ~10 sites that route through
// `as_ctx_ptr()`-derived provenance; converting them to `unsafe deref(*mut)`
// is a separate sweep.
impl bun_ptr::AnyRefCounted for NodeHTTPResponse {
    type DestructorCtx = ();
    #[inline]
    unsafe fn rc_ref(this: *mut Self) {
        // SAFETY: caller contract — `this` is live; touches only the
        // interior-mutable `Cell<u32>` field.
        unsafe { (*this).ref_() }
    }
    #[inline]
    unsafe fn rc_deref_with_context(this: *mut Self, (): ()) {
        // SAFETY: caller contract — `this` is live; `deref()` touches only
        // `Cell`/`JsCell` fields and on zero frees via `heap::take`.
        unsafe { (*this).deref() }
    }
    #[inline]
    unsafe fn rc_has_one_ref(this: *const Self) -> bool {
        // SAFETY: caller contract — `this` is live.
        unsafe { (*this).ref_count.get() == 1 }
    }
    #[inline]
    unsafe fn rc_assert_no_refs(this: *const Self) {
        // SAFETY: caller contract — `this` is live.
        debug_assert_eq!(unsafe { (*this).ref_count.get() }, 0);
    }
    #[cfg(debug_assertions)]
    #[inline]
    unsafe fn rc_debug_data(_this: *mut Self) -> *mut dyn bun_ptr::ref_count::DebugDataOps {
        bun_ptr::ref_count::noop_debug_data()
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn NodeHTTPResponse__createForJS(
    any_server_tag: u64,
    global_object: &JSGlobalObject,
    has_body: *mut bool,
    request: *mut uws_sys::Request,
    is_ssl: i32,
    response_ptr: *mut c_void,
    upgrade_ctx: *mut uws_sys::WebSocketUpgradeContext,
    node_response_ptr: *mut *mut NodeHTTPResponse,
) -> JSValue {
    // SAFETY: all pointers are provided by C++ NodeHTTPServer and are live for the call.
    let has_body = unsafe { &mut *has_body };
    // S008: `uws::Request` is an `opaque_ffi!` ZST — safe deref.
    let request_ref = bun_opaque::opaque_deref(request.cast_const());

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
                break 'brk bun_http_types::parse_content_length(content_length);
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

    let response = bun_core::heap::into_raw(Box::new(NodeHTTPResponse {
        // 1 - the HTTP response
        // 1 - the JS object
        // 1 - the Server handler.
        ref_count: Cell::new(3),
        upgrade_context: JsCell::new(UpgradeCTX {
            context: upgrade_ctx,
            request,
            sec_websocket_key: Box::default(),
            sec_websocket_protocol: Box::default(),
            sec_websocket_extensions: Box::default(),
        }),
        server: any_server_from_packed(any_server_tag),
        raw_response: Cell::new(Some(raw_response)),
        body_read_state: Cell::new(if *has_body {
            BodyReadState::Pending
        } else {
            BodyReadState::None
        }),
        flags: Cell::new(Flags::default()),
        poll_ref: JsCell::new(jsc::Ref::default()),
        body_read_ref: JsCell::new(jsc::Ref::default()),
        promise: JsCell::new(StrongOptional::empty()),
        buffered_request_body_data_during_pause: JsCell::new(Vec::new()),
        bytes_written: Cell::new(0),
        auto_flusher: JsCell::new(AutoFlusher::default()),
    }));

    // SAFETY: `response` was just allocated and leaked; we hold the only reference.
    let response_ref = unsafe { &*response };
    if *has_body {
        response_ref.body_read_ref.with_mut(|r| r.r#ref(vm));
    }
    response_ref.poll_ref.with_mut(|r| r.r#ref(vm));
    // SAFETY: `response` is a fresh `heap::alloc` heap payload; ownership of
    // the +1 wrapper ref transfers to the GC (`NodeHTTPResponseClass__finalize`
    // calls `finalize` → `deref`). `to_js_ptr` is the `#[JsClass]`-generated
    // no-rebox wrapper around `NodeHTTPResponse__create`.
    let js_this = unsafe { NodeHTTPResponse::to_js_ptr(response, global_object) };
    // SAFETY: out-param provided by caller.
    unsafe { *node_response_ptr = response };
    js_this
}

impl NodeHTTPResponse {
    #[uws::uws_callback(export = "NodeHTTPResponse__setTimeout")]
    pub fn ffi_set_timeout(&self, seconds: JSValue, global_this: &JSGlobalObject) -> bool {
        if !seconds.is_number() {
            let _: jsc::JsError =
                global_this.throw_invalid_argument_type_value(b"timeout", b"number", seconds);
            return false;
        }

        let flags = self.flags.get();
        let Some(raw) = self.raw_response.get() else {
            return false;
        };
        if flags.contains(Flags::REQUEST_HAS_COMPLETED)
            || flags.contains(Flags::SOCKET_CLOSED)
            || flags.contains(Flags::UPGRADED)
        {
            return false;
        }

        // Zig `seconds.to(c_uint)` is ECMAScript ToUint32 — same bit pattern as
        // ToInt32 reinterpreted as unsigned (negative inputs wrap, e.g. -1 → u32::MAX).
        let secs = (seconds.to_int32() as c_uint).min(255) as u8;
        raw.timeout(secs);
        true
    }
}

// ported from: src/runtime/server/NodeHTTPResponse.zig
