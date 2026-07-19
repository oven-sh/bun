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
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy).
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
    /// node:http: the raw trailer section that followed THIS request's chunked
    /// body. Moved off the connection's single per-parse buffer the moment the
    /// body finishes (still inside the parser), because a pipelined request's
    /// parse would otherwise overwrite it before this request's JS reads it.
    pub request_trailers: JsCell<Vec<u8>>,
    /// node:http: this request's header section captured at dispatch as
    /// [u32 nameLen][u32 valueLen][name][value]... so req.rawHeaders /
    /// req.headers materialize lazily (takeRawHeaders) instead of paying
    /// 2N JSStrings + a JSArray on every request. One-shot: emptied on first
    /// access.
    pub raw_request_headers: JsCell<Vec<u8>>,
    pub bytes_written: Cell<usize>,

    pending_pinned_write: Cell<PendingPinnedWrite>,
    /// Owns the bytes referenced by `pending_pinned_write`: either a
    /// `SliceWithUnderlyingString` (holds the WTFStringImpl ref) or a `Buffer`
    /// view. The cached `pendingWriteBuffer` slot GC-roots the JS cell; for
    /// buffers the underlying ArrayBuffer is additionally `pin()`ed.
    pending_pinned_write_owner: JsCell<crate::node::StringOrBuffer>,

    pub upgrade_context: JsCell<UpgradeCTX>,

    pub auto_flusher: JsCell<AutoFlusher>,
}

// Intrusive refcount methods (`ref_` / `deref`) are hand-rolled below over the
// `ref_count` field; `deinit` is the destructor invoked when count hits zero.

bitflags! {
    #[repr(transparent)]
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct Flags: u16 {
        const SOCKET_CLOSED                       = 1 << 0;
        const REQUEST_HAS_COMPLETED               = 1 << 1;
        const ENDED                               = 1 << 2;
        const UPGRADED                            = 1 << 3;
        const HAS_CUSTOM_ON_DATA                  = 1 << 4;
        const IS_REQUEST_PENDING                  = 1 << 5;
        const IS_DATA_BUFFERED_DURING_PAUSE       = 1 << 6;
        /// Did we receive the last chunk of data during pause?
        const IS_DATA_BUFFERED_DURING_PAUSE_LAST  = 1 << 7;
        /// node:http handed this connection to a raw 'upgrade'/'connect'
        /// tunnel (JSNodeHTTPServerSocket::upgradeToTunnelMode).
        const TUNNELED                            = 1 << 8;
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
    pub fn is_requested_completed_or_ended(self) -> bool {
        self.intersects(Flags::REQUEST_HAS_COMPLETED | Flags::ENDED)
    }

    #[inline]
    pub fn is_done(self) -> bool {
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
    // Mid-lifetime reset, not a destructor.
    pub(crate) fn reset(&mut self) {
        // Dropping the taken value frees the old `Box<[u8]>` headers; raw
        // pointers are nulled. Nothing from the old value is reused.
        drop(core::mem::take(self));
    }

    pub(crate) fn preserve_web_socket_headers_if_needed(&mut self) {
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
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum BodyReadState {
    #[default]
    None = 0,
    Pending = 1,
    Done = 2,
}

unsafe extern "C" {
    // `socket` is the opaque uSockets handle from `AnyResponse::socket()`; C++
    // only reads its ext slot. Module-private — the sole callers below pass a
    // live handle, so no caller-side precondition remains.
    safe fn Bun__getNodeHTTPResponseThisValue(is_ssl: bool, socket: *mut c_void) -> JSValue;
    safe fn Bun__getNodeHTTPServerSocketThisValue(is_ssl: bool, socket: *mut c_void) -> JSValue;

    // Moves the connection's captured node:http request-trailer section out.
    // `*out` points into a C++ thread-local that stays valid until the next
    // call on this thread; the caller copies it immediately. Returns 0 when
    // there is nothing captured or the socket is closed.
    safe fn Bun__NodeHTTP__takeRequestTrailerBytes(
        is_ssl: bool,
        socket: *mut c_void,
        out: *mut *const u8,
    ) -> usize;
    // Parses a raw trailer section into a flat [name, value, ...] JSArray, or
    // jsUndefined() when it contains no fields.
    safe fn Bun__NodeHTTP__parseRequestTrailers(
        global_object: &JSGlobalObject,
        data: *const u8,
        length: usize,
        use_insecure_http_parser: bool,
    ) -> JSValue;
    // Scope-free exception read: satisfies the exception-check verifier
    // after a callee ThrowScope destructor simulated a throw for this
    // (scope-less native) caller. A single traps check in release builds.
    safe fn Bun__NodeHTTP__acknowledgeThrowScope(global_object: &JSGlobalObject);
    // Builds req.rawHeaders' flat [name, value, ...] JSArray from the header
    // bytes captured at dispatch ([u32 nameLen][u32 valueLen][name][value]...).
    safe fn Bun__NodeHTTP__buildRawHeadersArray(
        global_object: &JSGlobalObject,
        data: *const u8,
        length: usize,
    ) -> JSValue;

    // `&JSGlobalObject` encodes non-null/aligned; `status_message` is the
    // ptr/len of a Rust `&[u8]` and `response` is a live `uws::Response<SSL>*`
    // from the matched `AnyResponse` arm. Module-private with one call site.
    // Returns false when the C++ header writer left a JS exception pending
    // (checked inside its own ThrowScope).
    safe fn NodeHTTPServer__writeHead_http(
        global_object: &JSGlobalObject,
        status_message: *const u8,
        status_message_length: usize,
        headers_object_value: JSValue,
        auto_header_bits: u32,
        keep_alive_timeout_secs: u32,
        response: *mut c_void,
    ) -> bool;

    safe fn NodeHTTPServer__writeHead_https(
        global_object: &JSGlobalObject,
        status_message: *const u8,
        status_message_length: usize,
        headers_object_value: JSValue,
        auto_header_bits: u32,
        keep_alive_timeout_secs: u32,
        response: *mut c_void,
    ) -> bool;
}

/// `VirtualMachine::get()` returns `*mut`; deref once for callers that need `&mut`.
#[inline(always)]
fn vm_get<'a>() -> &'a mut VirtualMachine {
    // SAFETY: JS-thread only; the global VM pointer is non-null once the runtime is up.
    VirtualMachine::get().as_mut()
}

/// `&mut` to this thread's VM for `Ref::ref/unref` etc. Takes `_global` for
/// call-site symmetry but reads the thread-local directly:
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
/// The packed repr is bits 0..49 = ptr,
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
/// `WriteBarrier<Unknown>` slots.
pub mod js {
    bun_jsc::codegen_cached_accessors!("NodeHTTPResponse"; onData, onAborted, onWritable, pendingWriteBuffer);
}

/// A large `res.write()` whose unwritten tail is held by reference instead of
/// being copied into the uWS backpressure std::string. The bytes are kept
/// valid by `pending_pinned_write_owner` (WTFStringImpl ref / borrowed
/// ArrayBuffer / owned encoded slice); the JS cell is GC-rooted via the
/// `pendingWriteBuffer` cached slot; for ArrayBuffer-backed inputs the
/// backing store is additionally `pin()`ed so `transfer()` copies instead of
/// detaching.
#[derive(Clone, Copy)]
struct PendingPinnedWrite {
    /// The body bytes not yet accepted by the kernel / cork buffer. Borrows
    /// `pending_pinned_write_owner`'s storage; advanced in place on drain.
    remaining: *const [u8],
    /// The ArrayBuffer/View to `unpin()` on release. ZERO for string inputs
    /// (strings are kept alive by the native WTFStringImpl ref in the owner).
    pinned_value: JSValue,
}

impl Default for PendingPinnedWrite {
    fn default() -> Self {
        Self {
            remaining: ptr::slice_from_raw_parts(ptr::null(), 0),
            pinned_value: JSValue::ZERO,
        }
    }
}

impl PendingPinnedWrite {
    #[inline]
    fn is_some(&self) -> bool {
        self.remaining.len() > 0
    }

    #[inline]
    fn remaining(&self) -> &[u8] {
        // SAFETY: `remaining` borrows `pending_pinned_write_owner`'s storage,
        // which is held for the lifetime of the pending write.
        unsafe { &*self.remaining }
    }
}

/// Writes larger than this take the pinned zero-copy path; below it the cork
/// buffer (`LoopData::CORK_BUFFER_SIZE` = 16KB) already handles the copy.
const PINNED_WRITE_THRESHOLD: usize = 16 * 1024;

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

    pub(crate) fn get_this_value(&self) -> JSValue {
        let flags = self.flags.get();
        let Some(raw) = self.raw_response.get() else {
            return JSValue::ZERO;
        };
        if flags.contains(Flags::SOCKET_CLOSED) || flags.contains(Flags::UPGRADED) {
            return JSValue::ZERO;
        }
        Bun__getNodeHTTPResponseThisValue(any_response_is_ssl(&raw), raw.socket().cast())
    }

    pub(crate) fn get_server_socket_value(&self) -> JSValue {
        let flags = self.flags.get();
        let Some(raw) = self.raw_response.get() else {
            return JSValue::ZERO;
        };
        if flags.contains(Flags::SOCKET_CLOSED) || flags.contains(Flags::UPGRADED) {
            return JSValue::ZERO;
        }
        Bun__getNodeHTTPServerSocketThisValue(any_response_is_ssl(&raw), raw.socket().cast())
    }

    /// Called at this request's body fin, still inside the parser: move the
    /// connection's captured trailer section onto this request before the next
    /// pipelined message's parse can overwrite it. A no-op unless a chunked
    /// body's trailer section was captured for this exact message.
    fn capture_request_trailers(&self) {
        let flags = self.flags.get();
        if flags.contains(Flags::SOCKET_CLOSED) || flags.contains(Flags::UPGRADED) {
            return;
        }
        let Some(raw) = self.raw_response.get() else {
            return;
        };
        let mut ptr: *const u8 = std::ptr::null();
        let length = Bun__NodeHTTP__takeRequestTrailerBytes(
            any_response_is_ssl(&raw),
            raw.socket().cast(),
            &raw mut ptr,
        );
        if length == 0 {
            return;
        }
        // SAFETY: C++ handed back a (ptr, length) into a thread-local it keeps
        // alive until the next call on this thread; copy it out immediately.
        let bytes = unsafe { std::slice::from_raw_parts(ptr, length) };
        self.request_trailers.with_mut(|v| v.append_slice(bytes));
    }

    #[allow(dead_code)]
    pub(crate) fn pause_socket(&self) {
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

    pub(crate) fn resume_socket(&self) {
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

    pub(crate) fn upgrade(
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
        // `&mut self`-taking accessor can be called from this `&self` body.
        // The pointee is the long-lived server, not `*self`.
        let mut server = self.server;
        let Some(ws_handler) = server.web_socket_handler() else {
            return false;
        };
        // Lifetime-extend the handler past the method calls below.
        // SAFETY: JS-thread only; the server (and its websocket config) outlives this call.
        let ws_handler: &mut crate::server::WebSocketServerHandler =
            unsafe { &mut *std::ptr::from_mut(ws_handler) };
        let socket_value = self.get_server_socket_value();
        if socket_value.is_empty() {
            return false;
        }
        self.resume_socket();

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

        // The sec-websocket-* headers were already copied into
        // raw_response.upgrade(); the underlying HttpParser::fallback buffer is
        // freed when uWS adopts the socket above, so set_on_aborted_handler
        // (which would call preserve_web_socket_headers_if_needed) must not run
        // post-upgrade — it would read freed header views.
        self.upgrade_context.with_mut(|c| c.reset());

        true
    }

    pub(crate) fn maybe_stop_reading_body(&self, vm: &mut VirtualMachine, this_value: JSValue) {
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

    pub(crate) fn should_request_be_pending(&self) -> bool {
        let flags = self.flags.get();
        // Once the socket is closed or has been adopted by the WebSocket
        // layer, the HTTP request/response cycle is over — no further uws
        // callbacks will arrive on `raw_response` to balance the
        // IS_REQUEST_PENDING ref, so report not-pending so
        // `mark_request_as_done()` can release it.
        if flags.contains(Flags::SOCKET_CLOSED) || flags.contains(Flags::UPGRADED) {
            return false;
        }

        // A raw 'upgrade'/'connect' tunnel handoff ends the HTTP exchange the
        // same way, except an Upgrade carrying a body keeps parsing as HTTP
        // until the body's fin chunk (the actual tunnel start).
        if flags.contains(Flags::TUNNELED) {
            return self.body_read_state.get() == BodyReadState::Pending;
        }

        if flags.contains(Flags::ENDED) {
            return self.body_read_state.get() == BodyReadState::Pending;
        }

        true
    }

    pub(crate) fn dump_request_body(
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

        // The async path (`on_node_http_request_with_upgrade_ctx`) stashes the
        // handler's pending promise here and registers `then2` reactions that
        // are responsible for releasing the server-handler ref (one of the
        // initial 3). When the request is torn down via abort/socket-close
        // those reactions may never fire (the JS-side resolve chain is broken
        // once the socket is gone), which would strand that ref forever and
        // leak the whole `NodeHTTPResponse` allocation. Treat a still-held
        // promise as the ownership token for that ref: drop the strong root
        // and release the ref here. `on_resolve`/`on_reject` observe the
        // empty slot and skip their own deref, so a late settlement is a
        // no-op rather than a double release.
        let had_async_promise = self.promise.with_mut(|p| {
            let had = p.has();
            p.deinit();
            had
        });

        let vm = vm_get();
        self.clear_on_data_callback(self.get_this_value(), vm.global());
        self.clear_pending_pinned_write(vm.global(), JSValue::ZERO);
        self.upgrade_context.with_mut(|c| c.reset());

        self.buffered_request_body_data_during_pause
            .with_mut(|b| b.clear_and_free());
        let mut server = self.server;
        self.poll_ref.with_mut(|r| r.unref(vm));
        self.unregister_auto_flush();

        server.on_request_complete();

        if had_async_promise {
            self.deref();
        }
        self.deref();
    }

    pub(crate) fn mark_request_as_done_if_necessary(&self) {
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

    pub(crate) fn set_on_aborted_handler(&self) {
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

    pub(crate) fn get_ended(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(self.flags.get().contains(Flags::ENDED))
    }

    pub(crate) fn get_finished(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(self.flags.get().contains(Flags::REQUEST_HAS_COMPLETED))
    }

    pub(crate) fn get_flags(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number_from_int32(self.flags.get().bits() as i32)
    }

    pub(crate) fn get_aborted(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(self.flags.get().contains(Flags::SOCKET_CLOSED))
    }

    pub(crate) fn get_has_body(&self, _global: &JSGlobalObject) -> JSValue {
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

    pub(crate) fn get_buffered_amount(&self, _global: &JSGlobalObject) -> JSValue {
        let flags = self.flags.get();
        if flags.contains(Flags::REQUEST_HAS_COMPLETED) || flags.contains(Flags::SOCKET_CLOSED) {
            return JSValue::js_number_from_int32(0);
        }
        if let Some(raw_response) = self.raw_response.get() {
            let amount = raw_response
                .get_buffered_amount()
                .saturating_add(self.pending_pinned_write.get().remaining.len() as u64);
            return JSValue::js_number_from_uint64(amount);
        }
        JSValue::js_number_from_int32(0)
    }

    pub(crate) fn js_ref(&self, global_object: &JSGlobalObject, _frame: &CallFrame) -> JSValue {
        if !self.is_done() {
            self.poll_ref
                .with_mut(|r| r.r#ref(bun_vm_mut(global_object)));
        }
        JSValue::UNDEFINED
    }

    pub(crate) fn js_unref(&self, global_object: &JSGlobalObject, _frame: &CallFrame) -> JSValue {
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
    pub(crate) fn write_head(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // Perf: `arguments_undef::<3>()` returns `Arguments<3>` — a 32-byte
        // `[JSValue; 3]` + `len` aggregate — *by value*, which `cargo asm` shows
        // lowered to a per-`writeHead` `vmovups` stack copy on the node:http hot
        // path. The borrowed `arguments()` slice (ptr+len, 16 bytes) carries the
        // same information; missing / `null` slots are padded to `undefined`
        // inline below exactly as the `Arguments<3>` form did.
        let arguments = callframe.arguments();
        let auto_header_bits = arguments
            .get(3)
            .copied()
            .filter(|v| v.is_number())
            .map_or(0, |v| v.to_int32() as u32);
        let keep_alive_timeout_secs = arguments
            .get(4)
            .copied()
            .filter(|v| v.is_number())
            .map_or(0, |v| v.to_int32() as u32);
        self.write_head_impl(
            global_object,
            arguments,
            auto_header_bits,
            keep_alive_timeout_secs,
        )
    }

    /// Shared body of `writeHead` (also the write-head phase of
    /// `writeHeadAndEnd`): args are (statusCode, statusMessage, headersArray),
    /// plus the auto-header bits + keep-alive timeout the C++ side renders
    /// natively (kAutoHeader* in NodeHTTP.cpp).
    fn write_head_impl(
        &self,
        global_object: &JSGlobalObject,
        arguments: &[JSValue],
        auto_header_bits: u32,
        keep_alive_timeout_secs: u32,
    ) -> JsResult<JSValue> {
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

        let status_code_value: JSValue = arguments.first().copied().unwrap_or(JSValue::UNDEFINED);
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
        // without the inner ref bump.
        let status_message_str;
        let status_message_slice;
        let status_message_bytes: &[u8] = if !status_message_value.is_undefined() {
            status_message_str =
                bun_core::OwnedString::new(status_message_value.to_bun_string(global_object)?);
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

        let wrote_head_ok;
        'do_it: {
            if status_message_bytes.is_empty() {
                if let Some(status_message) =
                    HTTPStatusText::get(u16::try_from(status_code).expect("int cast"))
                {
                    wrote_head_ok = write_head_internal(
                        &raw_response,
                        global_object,
                        status_message,
                        headers_object_value,
                        auto_header_bits,
                        keep_alive_timeout_secs,
                    );
                    break 'do_it;
                }
            }

            let message: &[u8] = if !status_message_bytes.is_empty() {
                status_message_bytes
            } else {
                b"HM"
            };

            // 256-byte stack buffer + plain memcpy. The previous Vec + write! +
            // BStr-Display path showed up at 0.54% incl in perf (core::fmt vtable
            // + BStr UTF-8 chunk-validation). status_code is 100..=999 → always 3 digits.
            let mut itoa_buf = bun_core::fmt::ItoaBuf::new();
            let code = bun_core::fmt::itoa(&mut itoa_buf, status_code);
            let n = code.len() + 1 + message.len();

            let mut stack_buf = [0u8; 256];
            if n <= stack_buf.len() {
                stack_buf[..code.len()].copy_from_slice(code);
                stack_buf[code.len()] = b' ';
                stack_buf[code.len() + 1..n].copy_from_slice(message);
                wrote_head_ok = write_head_internal(
                    &raw_response,
                    global_object,
                    &stack_buf[..n],
                    headers_object_value,
                    auto_header_bits,
                    keep_alive_timeout_secs,
                );
            } else {
                // Heap fallback for absurdly long status messages (> 252 bytes).
                let mut heap = Vec::with_capacity(n);
                heap.extend_from_slice(code);
                heap.push(b' ');
                heap.extend_from_slice(message);
                wrote_head_ok = write_head_internal(
                    &raw_response,
                    global_object,
                    &heap,
                    headers_object_value,
                    auto_header_bits,
                    keep_alive_timeout_secs,
                );
            }
        }

        // The writeHead ThrowScope's destructor simulates a throw so its
        // caller must check; acknowledge it scope-free (we are that caller
        // when running inside writeHeadAndEnd), then propagate the result
        // that traveled through the return value - otherwise the end phase
        // would run with an exception pending.
        Bun__NodeHTTP__acknowledgeThrowScope(global_object);
        if !wrote_head_ok {
            return Err(jsc::JsError::Thrown);
        }

        Ok(JSValue::UNDEFINED)
    }

    /// `handle.writeHeadAndEnd(status, statusMessage, headersArray, chunk,
    /// encoding, strictContentLength)` — the writeHead + end pair under one
    /// native cork and one JS->native crossing, replacing
    /// `handle.cork(() => { handle.writeHead(...); handle.end(...) })` (three
    /// crossings and a per-request closure) on the node:http response path.
    pub(crate) fn write_head_and_end(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();

        // Same gate as cork(): the old flow threw ERR_STREAM_ALREADY_FINISHED
        // from cork() before either phase ran.
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

        let head_len = arguments.len().min(3);
        let auto_header_bits = arguments
            .get(6)
            .copied()
            .filter(|v| v.is_number())
            .map_or(0, |v| v.to_int32() as u32);
        let keep_alive_timeout_secs = arguments
            .get(7)
            .copied()
            .filter(|v| v.is_number())
            .map_or(0, |v| v.to_int32() as u32);
        // write_or_end::<true> reads (chunk, encoding, _, strictContentLength).
        let end_args = [
            arguments.get(3).copied().unwrap_or(JSValue::UNDEFINED),
            arguments.get(4).copied().unwrap_or(JSValue::UNDEFINED),
            JSValue::UNDEFINED,
            arguments.get(5).copied().unwrap_or(JSValue::UNDEFINED),
        ];
        let this_value = callframe.this();

        // BACKREF: same keep-alive pattern as cork() — either phase can reach
        // JS (string coercions, drain callbacks), which could drop the last
        // reference to this response mid-call.
        let this = bun_ptr::BackRef::from(ptr::NonNull::from(self));
        this.ref_();

        let raw_response = this.raw_response.get();
        let mut result: JsResult<JSValue> = Ok(JSValue::UNDEFINED);
        {
            let run = || -> JsResult<JSValue> {
                this.write_head_impl(
                    global_object,
                    &arguments[..head_len],
                    auto_header_bits,
                    keep_alive_timeout_secs,
                )?;
                this.resume_socket();
                this.write_or_end::<true>(global_object, &end_args, this_value)
            };
            if let Some(raw_response) = raw_response {
                raw_response.corked(|| {
                    // Capture `this` so a `self`-derived pointer reaches the
                    // FFI closure-data slot (see cork()'s R-2 note).
                    let _escape = this;
                    result = run();
                });
            } else {
                result = run();
            }
        }

        // Explicit `.get()` so the inherent refcount `NodeHTTPResponse::deref`
        // is selected, matching cork() (see its note).
        this.get().deref();
        result
    }
}

fn write_head_internal(
    response: &uws::AnyResponse,
    global_object: &JSGlobalObject,
    status_message: &[u8],
    headers: JSValue,
    auto_header_bits: u32,
    keep_alive_timeout_secs: u32,
) -> bool {
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
            auto_header_bits,
            keep_alive_timeout_secs,
            (*tcp).cast::<c_void>(),
        ),
        uws::AnyResponse::SSL(ssl) => NodeHTTPServer__writeHead_https(
            global_object,
            status_message.as_ptr(),
            status_message.len(),
            headers,
            auto_header_bits,
            keep_alive_timeout_secs,
            (*ssl).cast::<c_void>(),
        ),
        uws::AnyResponse::H3(_) => {
            bun_core::Output::panic(format_args!("node:http does not support HTTP/3 responses"));
        }
    }
}

impl NodeHTTPResponse {
    pub(crate) fn write_continue(
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

    // Writes a caller-built 1xx informational response block to the same
    // AsyncSocket buffer writeStatus/end use, so a pipelined replay stays
    // ordered ahead of the final response bytes (node:http _writeRaw).
    pub(crate) fn write_informational(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.is_done() {
            return Ok(JSValue::UNDEFINED);
        }
        {
            let Some(raw_response) = self.raw_response.get() else {
                return Ok(JSValue::UNDEFINED);
            };
            handle_ended_if_necessary(raw_response.state(), global_object)?;
        }

        let arguments = callframe.arguments();
        let input_value = arguments.first().copied().unwrap_or(JSValue::UNDEFINED);
        if input_value.is_undefined_or_null() {
            return Ok(JSValue::UNDEFINED);
        }
        let encoding_value = arguments.get(1).copied().unwrap_or(JSValue::UNDEFINED);
        let encoding = if encoding_value.is_string() {
            crate::node::Encoding::from_js(encoding_value, global_object)?
                .unwrap_or(crate::node::Encoding::Utf8)
        } else {
            crate::node::Encoding::Utf8
        };

        let mut string_or_buffer = crate::node::StringOrBuffer::EMPTY;
        if !crate::node::StringOrBuffer::from_js_with_encoding_into(
            &mut string_or_buffer,
            global_object,
            input_value,
            encoding,
        )? {
            return Err(global_object.throw_invalid_argument_type_value(
                b"data",
                b"string or buffer",
                input_value,
            ));
        }

        // Re-read after the JS-capable coercion above (R-2: re-entry may clear it).
        let Some(raw_response) = self.raw_response.get() else {
            return Ok(JSValue::UNDEFINED);
        };
        raw_response.write_informational(string_or_buffer.slice());
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
        // The deferred null is moved to explicit tail positions.

        if self.flags.get().contains(Flags::REQUEST_HAS_COMPLETED) {
            if EVENT == AbortEvent::Abort {
                // The socket is gone — no further uws callback will arrive to
                // balance the IS_REQUEST_PENDING ref. `on_request_complete()`
                // can set REQUEST_HAS_COMPLETED while `body_read_state` is
                // still `.pending` (e.g. the request body's last chunk was
                // buffered during pause before `res.end()` — the
                // `Expect: 100-continue` path), in which case
                // `mark_request_as_done()` never ran there and both that ref
                // and the server's pending-request counter are stranded. The
                // synchronous `set_closed()` from `JSNodeHTTPServerSocket::
                // onClose` has already flipped SOCKET_CLOSED, so
                // `should_request_be_pending()` is now false; let the gate
                // re-evaluate. Clear `raw_response` first so the
                // `clear_on_data_callback` reached from `mark_request_as_done`
                // can't touch the dead socket.
                self.raw_response.set(None);
                self.mark_request_as_done_if_necessary();
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
            if on_aborted.is_cell() {
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
        }

        if EVENT == AbortEvent::Abort {
            // Release the pin + owner + GC root atomically before any user JS
            // (on_data_or_aborted runs the ondata callback). Clearing the slot
            // alone would un-root `pinned_value` while it is still read later.
            self.clear_pending_pinned_write(vm_get().global(), js_this);
            self.on_data_or_aborted(b"", true, AbortEvent::Abort, js_this);
        }

        // `raw_response` is cleared before `deref()` because
        // `mark_request_as_done_if_necessary()` + `deref()` can drop the last
        // ref when the JS wrapper has already finalized; nothing between them
        // reads `raw_response`, so clearing first avoids a post-destroy write.
        if EVENT == AbortEvent::Abort {
            self.mark_request_as_done_if_necessary();
            self.raw_response.set(None);
        }
        self.deref();
    }

    #[uws::uws_callback(export = "Bun__NodeHTTPResponse_onClose")]
    pub(crate) fn on_abort(&self, js_value: JSValue) {
        scoped_log!(NodeHTTPResponse, "onAbort");
        self.handle_abort_or_timeout::<{ AbortEvent::Abort }>(js_value);
    }

    #[uws::uws_callback(export = "Bun__NodeHTTPResponse_setClosed", no_catch)]
    pub(crate) fn set_closed(&self) {
        self.update_flags(|f| f.insert(Flags::SOCKET_CLOSED));
    }

    /// Flag-only: the pending-request release happens deterministically in
    /// the dispatch tail (`on_node_http_request*` in `mod.rs`) or, for an
    /// Upgrade with a body, at the body's fin chunk.
    #[uws::uws_callback(export = "Bun__NodeHTTPResponse_markTunneled", no_catch)]
    pub(crate) fn mark_tunneled(&self) {
        self.update_flags(|f| f.insert(Flags::TUNNELED));
    }

    pub(crate) fn on_timeout(&self, _resp: uws::AnyResponse) {
        scoped_log!(NodeHTTPResponse, "onTimeout");
        self.handle_abort_or_timeout::<{ AbortEvent::Timeout }>(JSValue::ZERO);
    }

    pub(crate) fn do_pause(
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

    pub(crate) fn drain_request_body(
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
            // `Vec` Drops, so the prior `create_buffer(slice_mut)` + `= Vec::new()`
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

    pub(crate) fn do_resume(&self, global_object: &JSGlobalObject, _frame: &CallFrame) -> JSValue {
        scoped_log!(NodeHTTPResponse, "doResume");
        // Re-arm the poll first, unconditionally: a paused socket that received
        // the peer's FIN has that EOF deferred (loop.c) until it is resumed, so
        // req._dump() after res.end() (which sets ENDED before calling us) must
        // still let the deferred onEnd fire and release the fd.
        self.resume_socket();
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
        result
    }

    pub(crate) fn on_request_complete(&self) {
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
pub(crate) fn node_http_request_on_resolve(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JSValue {
    scoped_log!(NodeHTTPResponse, "onResolve");
    let arguments = callframe.arguments_old::<2>();
    // arguments[1] is the JSNodeHTTPResponse cell from the resolve callback.
    // R-2: deref shared — `maybe_stop_reading_body`/`on_request_complete` re-enter.
    let this: &NodeHTTPResponse = arguments.ptr[1].as_class_ref::<NodeHTTPResponse>().unwrap();
    // `promise` non-empty is the ownership token for the server-handler ref;
    // `mark_request_as_done` may have already released it on abort.
    let had_promise = this.promise.with_mut(|p| {
        let had = p.has();
        p.deinit();
        had
    });
    // defer this.deref(); — moved to tail.
    this.maybe_stop_reading_body(bun_vm_mut(global_object), arguments.ptr[1]);

    let flags = this.flags.get();
    if !flags.contains(Flags::REQUEST_HAS_COMPLETED) && !flags.contains(Flags::SOCKET_CLOSED) {
        let this_value = this.get_this_value();
        if !this_value.is_empty() {
            js::on_aborted_set_cached(this_value, global_object, JSValue::ZERO);
        }
        scoped_log!(NodeHTTPResponse, "clearOnData");
        // Put any held zero-copy tail on the wire before terminating so the
        // chunked stream stays well-formed.
        this.spill_pending_pinned_write(global_object);
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

    if had_promise {
        this.deref();
    }
    JSValue::UNDEFINED
}

#[bun_jsc::host_fn(export = "Bun__NodeHTTPRequest__onReject")]
pub(crate) fn node_http_request_on_reject(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JSValue {
    let arguments = callframe.arguments_old::<2>();
    let err = arguments.ptr[0];
    // arguments[1] is the JSNodeHTTPResponse cell from the reject callback.
    // R-2: deref shared — `maybe_stop_reading_body`/`on_request_complete` re-enter.
    let this: &NodeHTTPResponse = arguments.ptr[1].as_class_ref::<NodeHTTPResponse>().unwrap();
    // `promise` non-empty is the ownership token for the server-handler ref;
    // `mark_request_as_done` may have already released it on abort.
    let had_promise = this.promise.with_mut(|p| {
        let had = p.has();
        p.deinit();
        had
    });
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
        // Put any held zero-copy tail on the wire before the terminating chunk
        // so the client's chunked decoder stays in sync.
        this.spill_pending_pinned_write(global_object);
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
    if had_promise {
        this.deref();
    }
    JSValue::UNDEFINED
}

impl NodeHTTPResponse {
    pub(crate) fn abort(
        &self,
        global_object: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.is_done() {
            return Ok(JSValue::UNDEFINED);
        }

        // Re-arm the poll before marking SOCKET_CLOSED (resume_socket is a no-op
        // once that flag is set) so a paused socket's deferred EOF can fire.
        self.resume_socket();
        // Release the zero-copy pin + owner + GC root while the wrapper is
        // still reachable via the socket (get_this_value() returns ZERO once
        // SOCKET_CLOSED is set).
        self.clear_pending_pinned_write(global_object, JSValue::ZERO);
        self.update_flags(|f| f.insert(Flags::SOCKET_CLOSED));
        if let Some(raw_response) = self.raw_response.get() {
            let state = raw_response.state();
            if state.is_http_end_called() {
                return Ok(JSValue::UNDEFINED);
            }
        }
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
            self.capture_request_trailers();
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
            if callback.is_cell() {
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

    pub(crate) fn on_data(&self, chunk: &[u8], last: bool) {
        scoped_log!(
            NodeHTTPResponse,
            "onData({} bytes, is_last = {})",
            chunk.len(),
            last as u8
        );

        if last {
            self.capture_request_trailers();
        }
        self.on_data_or_aborted(chunk, last, AbortEvent::None, self.get_this_value());
    }

    /// Release the pin + GC root + byte owner taken by a zero-copy write.
    /// `js_this` is the wrapper to clear the cached slot on; pass the value
    /// handed in by C++ on terminal paths where `get_this_value()` is already
    /// ZERO, or ZERO to have it looked up. The unpin reads `pinned_value`
    /// before the cached-slot clear, so the cell is still GC-rooted when
    /// `dynamicDowncast` touches it.
    fn clear_pending_pinned_write(&self, global_object: &JSGlobalObject, js_this: JSValue) {
        let p = self
            .pending_pinned_write
            .replace(PendingPinnedWrite::default());
        if p.is_some() {
            if p.pinned_value != JSValue::ZERO {
                p.pinned_value.unpin_array_buffer();
            }
            drop(
                self.pending_pinned_write_owner
                    .replace(crate::node::StringOrBuffer::EMPTY),
            );
            let this_value = if js_this.is_empty() {
                self.get_this_value()
            } else {
                js_this
            };
            if !this_value.is_empty() {
                js::pending_write_buffer_set_cached(this_value, global_object, JSValue::ZERO);
            }
        }
    }

    /// Copy a pending zero-copy write's tail into the uWS backpressure buffer
    /// so a subsequent write()/end() stays ordered behind it, then release.
    fn spill_pending_pinned_write(&self, global_object: &JSGlobalObject) {
        let p = self.pending_pinned_write.get();
        if !p.is_some() {
            return;
        }
        if let Some(raw) = self.raw_response.get() {
            raw.spill_body(p.remaining());
        }
        self.clear_pending_pinned_write(global_object, JSValue::ZERO);
    }

    /// Continue a zero-copy write from the stored offset. Returns `true` if
    /// bytes are still outstanding (the caller should wait for another
    /// onWritable before notifying JS).
    fn drain_pending_pinned_write(&self, response: uws::AnyResponse) -> bool {
        let p = self.pending_pinned_write.get();
        if !p.is_some() {
            return false;
        }
        let remaining = p.remaining();
        let consumed = response.try_write_body(remaining, false);
        if consumed < remaining.len() {
            self.pending_pinned_write.set(PendingPinnedWrite {
                remaining: ptr::from_ref(&remaining[consumed..]),
                ..p
            });
            return true;
        }
        self.clear_pending_pinned_write(self.server.global_this(), JSValue::ZERO);
        false
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
        // Slot may hold UNDEFINED (WantMore) or anything the `.onwritable`
        // setter stored; non-cells can't be callable or AsyncContextFrame,
        // so skip instead of surfacing a spurious "not a function" uncaught.
        if !on_writable.is_cell() {
            self.deref();
            return;
        }
        let vm = vm_get();
        let global_this = vm.global();
        js::on_writable_set_cached(this_value, global_this, JSValue::ZERO);

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

        // Finish any zero-copy write before telling JS we're drained.
        if self.drain_pending_pinned_write(response) {
            return true;
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

        // Re-read raw_response at each use site (R-2: methods that
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

        // Construct in place — returning
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
        let js_this = if !this_value.is_empty() {
            this_value
        } else {
            self.get_this_value()
        };

        // A previous zero-copy write's tail must hit the wire before this one;
        // copy it into backpressure so ordering is preserved. No-op when the
        // caller correctly waited for 'drain' (the tail was already consumed).
        self.spill_pending_pinned_write(global_object);

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
            let raw_response = self.raw_response.get().unwrap();

            // Zero-copy path: for writes large enough to spill past the kernel
            // send buffer, hold the user's bytes by reference (pinned
            // ArrayBuffer or WTFStringImpl-backed slice) instead of copying
            // the unwritten tail into the uWS backpressure std::string.
            let bytes_len = bytes.len();
            if bytes_len > PINNED_WRITE_THRESHOLD && bytes_len <= c_uint::MAX as usize {
                let is_buffer = matches!(string_or_buffer, crate::node::StringOrBuffer::Buffer(_));

                scoped_log!(NodeHTTPResponse, "tryWriteBody({} bytes)", bytes_len);
                let consumed = raw_response.try_write_body(bytes, true);
                if consumed >= bytes_len {
                    raw_response.clear_on_writable();
                    js::on_writable_set_cached(js_this, global_object, JSValue::UNDEFINED);
                    return Ok(JSValue::js_number_from_uint64(bytes_len as u64));
                }
                scoped_log!(
                    NodeHTTPResponse,
                    "tryWriteBody partial: {} / {}",
                    consumed,
                    bytes_len
                );
                // For buffers, pin so `transfer()` copies instead of detaching.
                // Resizable (non-shared) buffers are spilled: `resize()` mprotect()s
                // trimmed pages PROT_NONE and `pin()` doesn't prevent it.
                let pinned_value = if is_buffer && input_value.is_cell() {
                    match input_value.as_pinned_arraybuffer(global_object) {
                        Some(ab) if ab.resizable && !ab.shared => {
                            input_value.unpin_array_buffer();
                            None
                        }
                        Some(_) => Some(input_value),
                        None => Some(JSValue::ZERO),
                    }
                } else {
                    Some(JSValue::ZERO)
                };
                if let Some(pinned_value) = pinned_value {
                    let remaining = ptr::slice_from_raw_parts(
                        // SAFETY: consumed < bytes_len, so the add is in-bounds.
                        unsafe { bytes.as_ptr().add(consumed) },
                        bytes_len - consumed,
                    );
                    // `string_or_buffer` owns the bytes (WTFStringImpl ref /
                    // borrowed ArrayBuffer / encoded Vec); move it so it
                    // outlives the write.
                    drop(
                        self.pending_pinned_write_owner
                            .replace(core::mem::take(&mut string_or_buffer)),
                    );
                    self.pending_pinned_write.set(PendingPinnedWrite {
                        remaining,
                        pinned_value,
                    });
                    if input_value.is_cell() {
                        js::pending_write_buffer_set_cached(js_this, global_object, input_value);
                    }
                } else {
                    raw_response.spill_body(&bytes[consumed..]);
                }
                js::on_writable_set_cached(
                    js_this,
                    global_object,
                    if callback_value.is_undefined() {
                        JSValue::UNDEFINED
                    } else {
                        callback_value.with_async_context_if_needed(global_object)
                    },
                );
                raw_response.on_writable(on_drain_shim, self.as_ctx_ptr());
                let clamped = i64::try_from(bytes_len.min(i64::MAX as usize)).expect("int cast");
                return Ok(JSValue::js_number((-clamped) as f64));
            }

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

                    // The cast cannot fail: bounded by min().
                    let clamped = i64::try_from(written.min(i64::MAX as usize)).expect("int cast");
                    Ok(JSValue::js_number((-clamped) as f64))
                }
            }
        }
    }

    pub(crate) fn set_on_writable(
        &self,
        this_value: JSValue,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) {
        if self.is_done() || value.is_undefined_or_null() {
            js::on_writable_set_cached(this_value, global_object, JSValue::ZERO);
        } else {
            js::on_writable_set_cached(
                this_value,
                global_object,
                value.with_async_context_if_needed(global_object),
            );
        }
    }

    pub(crate) fn get_on_writable(&self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        js::on_writable_get_cached(this_value).unwrap_or(JSValue::UNDEFINED)
    }

    pub(crate) fn get_on_abort(&self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        let flags = self.flags.get();
        if flags.contains(Flags::SOCKET_CLOSED) || flags.contains(Flags::UPGRADED) {
            return JSValue::UNDEFINED;
        }
        js::on_aborted_get_cached(this_value).unwrap_or(JSValue::UNDEFINED)
    }

    pub(crate) fn set_on_abort(
        &self,
        this_value: JSValue,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) {
        let flags = self.flags.get();
        if flags.contains(Flags::SOCKET_CLOSED) || flags.contains(Flags::UPGRADED) {
            return;
        }

        if self.is_requested_completed_or_ended() || value.is_undefined_or_null() {
            js::on_aborted_set_cached(this_value, global_object, JSValue::ZERO);
        } else {
            js::on_aborted_set_cached(
                this_value,
                global_object,
                value.with_async_context_if_needed(global_object),
            );
        }
    }

    pub(crate) fn get_on_data(&self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        js::on_data_get_cached(this_value).unwrap_or(JSValue::UNDEFINED)
    }

    pub(crate) fn get_has_custom_on_data(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(self.flags.get().contains(Flags::HAS_CUSTOM_ON_DATA))
    }

    pub(crate) fn get_upgraded(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(self.flags.get().contains(Flags::UPGRADED))
    }

    pub(crate) fn set_has_custom_on_data(&self, _global: &JSGlobalObject, value: JSValue) {
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

    pub(crate) fn set_on_data(
        &self,
        this_value: JSValue,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) {
        // Only `.pending` accepts a callback. `.done` means either uSockets delivered last=true or JS
        // previously cleared `ondata` (which already called clearOnData()); either way, there is no
        // more body to read, so don't re-register with uSockets or churn refs.
        let flags = self.flags.get();
        if value.is_undefined_or_null()
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

    pub(crate) fn write(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        self.write_or_end::<false>(global_object, arguments, JSValue::ZERO)
    }

    pub(crate) fn on_auto_flush(&self) -> bool {
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

    pub(crate) fn flush_headers(
        &self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
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

    pub(crate) fn end(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        // We dont wanna a paused socket when we call end, so is important to resume the socket
        self.resume_socket();
        self.write_or_end::<true>(global_object, arguments, callframe.this())
    }

    /// `handle.takeRawHeaders()` — this request's captured header section
    /// materialized into the rawHeaders flat [name, value, ...] array, or
    /// undefined when there were no headers (or they were already taken).
    /// Consumes the captured bytes.
    pub(crate) fn take_raw_headers(
        &self,
        global_object: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JSValue {
        let section = self.raw_request_headers.replace(Vec::new());
        if section.is_empty() {
            return JSValue::UNDEFINED;
        }
        Bun__NodeHTTP__buildRawHeadersArray(global_object, section.as_ptr(), section.len())
    }

    /// `handle.takeRequestTrailers()` — this request's captured trailer section
    /// parsed into a flat [name, value, ...] array, or undefined. Consumes it.
    pub(crate) fn take_request_trailers(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JSValue {
        let section = self.request_trailers.replace(Vec::new());
        if section.is_empty() {
            return JSValue::UNDEFINED;
        }
        // Lenient (insecureHTTPParser) servers accept CTL bytes in trailer values on
        // the wire; parse them with the same leniency so they surface on req.trailers.
        let use_insecure_http_parser = callframe.argument(0).to_boolean();
        Bun__NodeHTTP__parseRequestTrailers(
            global_object,
            section.as_ptr(),
            section.len(),
            use_insecure_http_parser,
        )
    }

    pub(crate) fn get_bytes_written(
        &self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JSValue {
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
    pub(crate) fn set_timeout(&self, seconds: u8) {
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

    pub(crate) fn cork(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // Perf: borrow the `arguments()` slice (ptr+len) instead of
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
        // cork prologue.
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
                // closure-data slot (see the R-2 note above).
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

    pub(crate) fn finalize(self: Box<Self>) {
        bun_ptr::finalize_js_box_noop(self);
    }

    /// Called by intrusive RefCount when count reaches zero.
    fn deinit(&self) {
        debug_assert!(!self.body_read_ref.get().has);
        debug_assert!(!self.poll_ref.get().has);
        debug_assert!(!self.pending_pinned_write.get().is_some());
        let flags = self.flags.get();
        debug_assert!(!flags.contains(Flags::IS_REQUEST_PENDING));
        debug_assert!(
            flags.contains(Flags::SOCKET_CLOSED)
                || flags.contains(Flags::REQUEST_HAS_COMPLETED)
                // A tunneled response can be finalized while its socket lives.
                || flags.contains(Flags::TUNNELED)
        );

        self.buffered_request_body_data_during_pause
            .with_mut(|b| b.clear_and_free());
        self.poll_ref.with_mut(|r| r.unref(vm_get()));
        self.body_read_ref.with_mut(|r| r.unref(vm_get()));

        self.promise.with_mut(|p| p.deinit());
        // SAFETY: self was allocated via `heap::into_raw` in `createForJS`;
        // refcount is zero so no other references remain — `self` is the unique
        // owner at count==0, so the `*const → *mut` cast is sound.
        unsafe { drop(bun_core::heap::take(self.as_ctx_ptr())) };
    }

    // Intrusive refcount helpers.
    #[inline]
    pub(crate) fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }

    #[inline]
    pub(crate) fn deref(&self) {
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

/// # Safety
/// `response` is the pointer written to `node_response_ptr` by
/// `NodeHTTPResponse__createForJS` earlier in the same dispatch and is live;
/// `data`/`length` describe a caller-owned buffer valid for the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn NodeHTTPResponse__adoptRawRequestHeaders(
    response: *mut NodeHTTPResponse,
    data: *const u8,
    length: usize,
) {
    // SAFETY: see the function-level contract above.
    let response = unsafe { &*response };
    // SAFETY: `data`/`length` describe a caller-owned buffer valid for the
    // call (function-level contract above).
    let bytes = unsafe { core::slice::from_raw_parts(data, length) };
    response
        .raw_request_headers
        .with_mut(|v| v.append_slice(bytes));
}

/// # Safety
/// `has_body`, `request`, `response_ptr`, `upgrade_ctx`, and `node_response_ptr`
/// are provided by C++ NodeHTTPServer and must be valid for the duration of the
/// call; `has_body` and `node_response_ptr` must be writable.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn NodeHTTPResponse__createForJS(
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
        request_trailers: JsCell::new(Vec::new()),
        raw_request_headers: JsCell::new(Vec::new()),
        bytes_written: Cell::new(0),
        pending_pinned_write: Cell::new(PendingPinnedWrite::default()),
        pending_pinned_write_owner: JsCell::new(crate::node::StringOrBuffer::EMPTY),
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
    pub(crate) fn ffi_set_timeout(&self, seconds: JSValue, global_this: &JSGlobalObject) -> bool {
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

        // ECMAScript ToUint32 — same bit pattern as
        // ToInt32 reinterpreted as unsigned (negative inputs wrap, e.g. -1 → u32::MAX).
        let secs = (seconds.to_int32() as c_uint).min(255) as u8;
        raw.timeout(secs);
        true
    }
}
