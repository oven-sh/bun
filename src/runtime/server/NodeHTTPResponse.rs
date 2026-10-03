use core::cell::Cell;
use core::ffi::{c_uint, c_void};
use core::ptr;

use bitflags::bitflags;
use bstr::BStr;

use bun_collections::VecExt;
use bun_core::scoped_log;
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

/// The uWS response of the socket. JSNodeHTTPServerSocket grants it to one response at a time and takes it back.
mod connection {
    use super::Flags;
    use bun_uws as uws;
    use core::cell::Cell;

    pub(super) struct Connection(Cell<Option<uws::AnyResponse>>);

    const _: () = assert!(size_of::<Connection>() == size_of::<Option<uws::AnyResponse>>());

    impl Connection {
        pub(super) fn new(raw_response: uws::AnyResponse) -> Self {
            Self(Cell::new(Some(raw_response)))
        }

        /// To send bytes or change the state of the response in flight. Only for the current response.
        #[inline]
        pub(super) fn writer(&self, flags: Flags) -> Option<uws::AnyResponse> {
            if flags.contains(Flags::CURRENT) {
                self.0.get()
            } else {
                None
            }
        }

        /// To read the connection's state or control the reads of the request. Also for a queued response.
        #[inline]
        pub(super) fn reader(&self) -> Option<uws::AnyResponse> {
            self.0.get()
        }

        /// A WebSocket adopts the socket. Only the current response can hand it over.
        pub(super) fn take_for_upgrade(&self, flags: Flags) -> Option<uws::AnyResponse> {
            if flags.contains(Flags::CURRENT) {
                self.0.take()
            } else {
                None
            }
        }

        /// The socket closed, or the server socket took the connection back.
        pub(super) fn release(&self) {
            self.0.set(None);
        }
    }
}

/// Intrusively ref-counted m_ctx payload of a `.classes.ts` wrapper.
///
/// `#[JsClass(no_constructor)]` wires the import-side `${T}__fromJS` /
/// `__fromJSDirect` / `__create` externs into a `JsClass` impl plus an
/// inherent `to_js_ptr(*mut Self, &JSGlobalObject)`; `noConstructor: true`
/// in `server.classes.ts` means no `${T}__getConstructor` is exported.
// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy).
#[bun_jsc::JsClass(no_constructor)]
#[derive(bun_ptr::RefCounted)]
pub(crate) struct NodeHTTPResponse {
    ref_count: bun_ptr::RefCount<Self>,

    connection: connection::Connection,

    pub(crate) flags: Cell<Flags>,

    pub poll_ref: JsCell<jsc::Ref>,

    pub(crate) body_read_state: Cell<BodyReadState>,
    pub(crate) body_read_ref: JsCell<jsc::Ref>,
    pub(crate) promise: JsCell<StrongOptional>, // Strong.Optional
    pub(crate) server: AnyServer,

    /// node:http: the raw trailer section that followed THIS request's chunked
    /// body. Moved off the connection's single per-parse buffer the moment the
    /// body finishes (still inside the parser), because a pipelined request's
    /// parse would otherwise overwrite it before this request's JS reads it.
    pub(crate) request_trailers: JsCell<Vec<u8>>,
    /// The JS wrapper whose `ondata` slot was armed for THIS request body. `get_this_value()`
    /// resolves through the socket's current response, which under pipelining is a different
    /// one; delivering through it loses the body. Kept alive by req[kHandle]; cleared on finalize.
    pub(crate) armed_this_value: Cell<JSValue>,
    /// node:http: this request's header section captured at dispatch as
    /// [u32 nameLen][u32 valueLen][name][value]... so req.rawHeaders /
    /// req.headers materialize lazily (takeRawHeaders) instead of paying
    /// 2N JSStrings + a JSArray on every request. One-shot: emptied on first
    /// access.
    pub(crate) raw_request_headers: JsCell<Vec<u8>>,
    pub(crate) bytes_written: Cell<usize>,

    pending_pinned_write: Cell<PendingPinnedWrite>,
    /// Owns the bytes referenced by `pending_pinned_write`: either a
    /// `Utf8WithString` (holds the WTFStringImpl ref) or a `Buffer`
    /// view. The cached `pendingWriteBuffer` slot GC-roots the JS cell; for
    /// buffers the underlying ArrayBuffer is additionally `pin()`ed.
    pending_pinned_write_owner: JsCell<crate::node::StringOrBuffer<'static>>,

    pub(crate) upgrade_context: JsCell<UpgradeCTX>,

    pub(crate) auto_flusher: JsCell<AutoFlusher>,

    /// Set only while a queued pipelined response has output that waits for the connection.
    queued_output: JsCell<Option<Box<QueuedOutput>>>,
}

/// What a response was given while it waited for the connection (pipelining). Each call was
/// converted and checked when it ran, so `grant_connection` only writes.
///
/// The record holds no pointer into the JS heap. A string chunk keeps its own bytes. A header
/// array or a buffer chunk stays a JS value: an element of the array in the wrapper's
/// `pendingWriteBuffer` slot, which the GC visits and which a response that waits for the
/// connection does not use otherwise. The flush reads a buffer chunk like a write to the current
/// response does, so a buffer that JS detached since the call is empty then.
#[derive(Default)]
struct QueuedOutput {
    /// In call order.
    items: Vec<QueuedItem>,
    /// How many JS values the record has. An item names its value by index.
    values: u32,
    /// A head, a `flushHeaders()` or a body chunk is recorded: the status line is decided.
    started: bool,
    ended: bool,
}

enum QueuedItem {
    Continue,
    /// Bytes that the caller rendered, written as they are: a 1xx block.
    Informational(Box<[u8]>),
    Head(QueuedHead),
    /// `flushHeaders()`: the header block ends here, ahead of the raw bytes and the body that follow.
    FlushHeaders,
    Chunk(QueuedChunk),
    /// The last chunk and the framed trailer section of the end() call.
    End(QueuedChunk, Box<[u8]>),
}

enum QueuedChunk {
    /// A string chunk, or no chunk.
    Bytes(crate::node::StringOrBuffer<'static>),
    /// A buffer chunk: the index of its JS value.
    Value(u32),
}

struct QueuedHead {
    /// The status line after "HTTP/1.1 ".
    status: Box<[u8]>,
    /// The index of the JS value of the header array, if the head has one.
    headers: Option<u32>,
    auto_header_bits: u32,
    keep_alive_timeout_secs: u32,
}

// A response that never waits for the connection pays one pointer for the record.
const _: () = assert!(size_of::<JsCell<Option<Box<QueuedOutput>>>>() == size_of::<usize>());

/// Where the record of a queued response stands: a call that throws takes it back there.
#[derive(Clone, Copy)]
struct QueuedMark {
    items: usize,
    values: u32,
    started: bool,
    ended: bool,
}

bitflags! {
    #[repr(transparent)]
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct Flags: u16 {
        const SOCKET_CLOSED                       = 1 << 0;
        const REQUEST_HAS_COMPLETED               = 1 << 1;
        const ENDED                               = 1 << 2;
        const UPGRADED                            = 1 << 3;
        /// The server socket granted the connection to this response. A queued pipelined response waits for it.
        const CURRENT                             = 1 << 4;
        const IS_REQUEST_PENDING                  = 1 << 5;
        /// node:http handed this connection to a raw 'upgrade'/'connect'
        /// tunnel (JSNodeHTTPServerSocket::upgradeToTunnelMode).
        const TUNNELED                            = 1 << 8;
        /// Its dispatch threw while it was queued (pipelining): advanceResponsePipeline decides at its turn.
        const DISPATCH_THREW_WHILE_QUEUED         = 1 << 9;
    }
}

const _: () = assert!(size_of::<Flags>() == 2);

impl Default for Flags {
    fn default() -> Self {
        // is_request_pending defaults to true; all others false.
        Flags::IS_REQUEST_PENDING
    }
}

impl Flags {
    /// Did the user end the request?
    #[inline]
    pub(crate) fn is_requested_completed_or_ended(self) -> bool {
        self.intersects(Flags::REQUEST_HAS_COMPLETED | Flags::ENDED)
    }

    #[inline]
    pub(crate) fn is_done(self) -> bool {
        self.is_requested_completed_or_ended() || self.contains(Flags::SOCKET_CLOSED)
    }
}

pub(crate) struct UpgradeCTX {
    pub(crate) context: *mut uws_sys::WebSocketUpgradeContext,
    // request will be detached when go async
    pub(crate) request: *mut uws_sys::Request,

    // we need to store this, if we wanna to enable async upgrade
    pub(crate) sec_websocket_key: Box<[u8]>,
    pub(crate) sec_websocket_protocol: Box<[u8]>,
    pub(crate) sec_websocket_extensions: Box<[u8]>,
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
    fn reset(&mut self) {
        // Dropping the taken value frees the old `Box<[u8]>` headers; raw
        // pointers are nulled. Nothing from the old value is reused.
        drop(core::mem::take(self));
    }

    fn preserve_web_socket_headers_if_needed(&mut self) {
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
pub(crate) enum BodyReadState {
    #[default]
    None = 0,
    /// uws still owes this request body chunks.
    Pending = 1,
    /// The last chunk arrived. Only this means the body is whole.
    Complete = 2,
    /// The connection closed before the last chunk.
    Aborted = 3,
    /// A WebSocket took the connection before the last chunk.
    Upgraded = 4,
    /// The reader let go of the body before the last chunk.
    Detached = 5,
}

unsafe extern "C" {
    // `socket` is the opaque uSockets handle from `AnyResponse::socket()`; C++
    // only reads its ext slot. Module-private — the sole callers below pass a
    // live handle, so no caller-side precondition remains.
    safe fn Bun__getNodeHTTPResponseThisValue(is_ssl: bool, socket: *mut c_void) -> JSValue;
    safe fn Bun__getNodeHTTPServerSocketThisValue(is_ssl: bool, socket: *mut c_void) -> JSValue;

    // node:http flood prevention (JSNodeHTTPServerSocket.cpp): unsent response bytes and queued responses hold a paused socket.
    safe fn Bun__NodeHTTP__onReadsPaused(ssl: core::ffi::c_int, socket: *mut c_void);
    safe fn Bun__NodeHTTP__onReadsResumable(ssl: core::ffi::c_int, socket: *mut c_void);
    // False when no read of this socket is being parsed.
    safe fn Bun__NodeHTTP__notifyWhenReadParsed(ssl: core::ffi::c_int, socket: *mut c_void)
    -> bool;

    // Moves the connection's captured node:http request-trailer section out. `*out` points into
    // a C++ thread-local valid until the next call on this thread; caller copies immediately.
    // Returns 0 when nothing captured or socket closed.
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
    safe fn NodeHTTPServer__writeHead_http(
        global_object: &JSGlobalObject,
        status_message: *const u8,
        status_message_length: usize,
        headers_object_value: JSValue,
        auto_header_bits: u32,
        keep_alive_timeout_secs: u32,
        response: *mut c_void,
    );

    safe fn NodeHTTPServer__writeHead_https(
        global_object: &JSGlobalObject,
        status_message: *const u8,
        status_message_length: usize,
        headers_object_value: JSValue,
        auto_header_bits: u32,
        keep_alive_timeout_secs: u32,
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
/// node:http response hot path (`write_head` / `write_or_end`). Marking
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

/// Same text as the `ERR_HTTP_CONTENT_LENGTH_MISMATCH` row of `simpleErrorMessages` in ErrorCode.cpp.
#[cold]
#[inline(never)]
fn err_throw_content_length_mismatch(
    global: &JSGlobalObject,
    actual: usize,
    expected: u64,
) -> jsc::JsError {
    global
        .err(
            ErrorCode::ERR_HTTP_CONTENT_LENGTH_MISMATCH,
            format_args!(
                "Response body's content-length of {actual} byte(s) does not match the content-length of {expected} byte(s) set in header"
            ),
        )
        .throw()
}

/// Same text as Node's write_() for a chunk that is not a string and not a buffer.
#[cold]
#[inline(never)]
fn err_throw_chunk_type(global: &JSGlobalObject, chunk: JSValue) -> jsc::JsError {
    global.throw_invalid_argument_type_value(
        b"chunk",
        b"string or an instance of Buffer or Uint8Array",
        chunk,
    )
}

/// An encoding that is not one. Like Node's write_(), the type of the chunk is judged before its
/// encoding: a chunk that is neither a string nor a buffer gets the error of the chunk.
#[cold]
#[inline(never)]
fn err_throw_unknown_encoding(
    global: &JSGlobalObject,
    chunk: JSValue,
    encoding: JSValue,
) -> jsc::JsError {
    use crate::node::{Encoding, StringObjects, StringOrBuffer};
    if !StringOrBuffer::converts_with_encoding(chunk, Encoding::Utf8, StringObjects::Allow) {
        return err_throw_chunk_type(global, chunk);
    }
    let name = if encoding.is_string() {
        encoding.to_bun_string(global)
    } else {
        JSGlobalObject::inspect_for_error_message(global, encoding)
    };
    match name {
        Ok(name) => global
            .err(
                ErrorCode::UNKNOWN_ENCODING,
                format_args!("Unknown encoding: {}", name),
            )
            .throw(),
        Err(err) => err,
    }
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
    let repr = bun_ptr::TaggedPtr::from(packed);
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
pub(crate) mod js {
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
/// buffer (`LoopData::CORK_COPY_MAX` = 16KB) already handles the copy.
const PINNED_WRITE_THRESHOLD: usize = 16 * 1024;

/// What `grant_connection` tells the server socket. `NodeHTTPGrantResult` in
/// `src/js/internal/http.ts` has the same values.
#[repr(i32)]
#[derive(Clone, Copy)]
enum GrantResult {
    /// The connection is gone.
    Gone = 0,
    /// Nothing of what the response recorded waits for the socket.
    Flushed = 1,
    /// The socket has to drain first, like after an `end()` or a `write()` that returns a
    /// negative number. A response that ended has not completed: its drain callback runs when the
    /// last byte is out. One that did not end has bytes in the buffer of the socket: its drain
    /// callback runs when that buffer is empty.
    Buffered = -1,
}

/// What `send` does with the length of a chunk.
#[derive(Clone, Copy)]
enum ChunkCount {
    /// The chunk was checked and counted when the response recorded it.
    Counted,
    /// Check it against this strict Content-Length, if there is one, and count it.
    Count(Option<u64>),
}

/// The arguments of a write()/end() after `prepare_write`. The chunk is in the caller's `StringOrBuffer` slot.
#[derive(Clone, Copy)]
struct WriteArgs {
    /// The chunk as JS gave it.
    input_value: JSValue,
    callback_value: JSValue,
    strict_content_length: Option<u64>,
}

/// The framed trailer section that an end() call got, for the time of the call.
/// One byte for each char: Node writes the section with encoding 'latin1' (lib/_http_outgoing.js).
enum TrailerSection<'a> {
    None,
    Latin1(jsc::JSStringView<'a>),
    Narrowed(Vec<u8>),
}

impl<'a> TrailerSection<'a> {
    fn from_js(global_object: &'a JSGlobalObject, value: JSValue) -> JsResult<Self> {
        if !value.is_string() {
            return Ok(Self::None);
        }
        let view = value.to_js_string_view(global_object)?;
        if view.is_8bit() {
            return Ok(Self::Latin1(view));
        }
        use crate::webcore::encoding::BunStringEncode as _;
        Ok(Self::Narrowed(view.encode(crate::node::Encoding::Latin1)))
    }

    fn bytes(&self) -> &[u8] {
        match self {
            Self::None => &[],
            Self::Latin1(view) => view.latin1(),
            Self::Narrowed(bytes) => bytes,
        }
    }
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

    #[inline]
    pub(crate) fn writer(&self) -> Option<uws::AnyResponse> {
        self.connection.writer(self.flags.get())
    }

    #[inline]
    pub(crate) fn reader(&self) -> Option<uws::AnyResponse> {
        self.connection.reader()
    }

    pub(crate) fn get_this_value(&self) -> JSValue {
        let flags = self.flags.get();
        let Some(raw) = self.reader() else {
            return JSValue::ZERO;
        };
        if flags.contains(Flags::SOCKET_CLOSED) || flags.contains(Flags::UPGRADED) {
            return JSValue::ZERO;
        }
        Bun__getNodeHTTPResponseThisValue(any_response_is_ssl(&raw), raw.socket().cast())
    }

    /// Flags this response when it is not the connection's current response, and says so.
    pub(crate) fn mark_dispatch_threw_if_queued(&self) -> bool {
        let queued = !self.flags.get().contains(Flags::CURRENT);
        if queued {
            self.update_flags(|f| f.insert(Flags::DISPATCH_THREW_WHILE_QUEUED));
        }
        queued
    }

    fn get_server_socket_value(&self) -> JSValue {
        let flags = self.flags.get();
        let Some(raw) = self.reader() else {
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
        let Some(raw) = self.reader() else {
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

    pub(crate) fn pause_socket(&self) {
        scoped_log!(NodeHTTPResponse, "pauseSocket");
        let flags = self.flags.get();
        let Some(raw) = self.reader() else {
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

    /* Pipelined flood prevention pauses READS on the connection, legal after the in-flight
     * response has ended — so this intentionally skips doPause's ENDED/REQUEST_HAS_COMPLETED
     * guards (those exist for request-body flow control). */
    pub(crate) fn pause_socket_reads(
        &self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let flags = self.flags.get();
        let Some(raw) = self.reader() else {
            return Ok(JSValue::UNDEFINED);
        };
        if flags.contains(Flags::SOCKET_CLOSED)
            || flags.contains(Flags::UPGRADED)
            || raw.is_connect_request()
        {
            return Ok(JSValue::UNDEFINED);
        }
        raw.pause();
        Bun__NodeHTTP__onReadsPaused(
            any_response_is_ssl(&raw) as core::ffi::c_int,
            raw.socket().cast(),
        );
        Ok(JSValue::UNDEFINED)
    }

    fn resume_socket(&self) {
        self.resume_socket_if(Flags::empty());
    }

    /// end() does not leave the socket paused. A response that waits for the connection leaves
    /// the reads to the response that has it.
    fn resume_socket_for_end(&self) {
        self.resume_socket_if(Flags::CURRENT);
    }

    /// `required`: the flags that the response needs for the resume.
    #[inline]
    fn resume_socket_if(&self, required: Flags) {
        scoped_log!(NodeHTTPResponse, "resumeSocket");
        let flags = self.flags.get();
        let Some(raw) = self.reader() else {
            return;
        };
        if flags.intersection(Flags::SOCKET_CLOSED | Flags::UPGRADED | required) != required
            || raw.is_connect_request()
        {
            return;
        }
        // Not a bare resume: flood prevention can still hold the reads.
        Bun__NodeHTTP__onReadsResumable(
            any_response_is_ssl(&raw) as core::ffi::c_int,
            raw.socket().cast(),
        );
    }

    /// Empty `sec_websocket_*` slices fall back to the request's headers.
    pub(crate) fn upgrade(
        &self,
        data_value: JSValue,
        sec_websocket_protocol: &[u8],
        sec_websocket_extensions: &[u8],
    ) -> bool {
        let upgrade_ctx = self.upgrade_context.get().context;
        if upgrade_ctx.is_null() || self.writer().is_none() {
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

        // R-2: `JsCell::get()` projects `&UpgradeCTX`; the borrow ends before
        // the `with_mut` below.
        let upgrade_context: &UpgradeCTX = self.upgrade_context.get();

        let sec_websocket_protocol_value: &[u8] = if !sec_websocket_protocol.is_empty() {
            sec_websocket_protocol
        } else if !upgrade_context.request.is_null() {
            // S008: `uws::Request` is an `opaque_ffi!` ZST — safe deref.
            let request = bun_opaque::opaque_deref(upgrade_context.request.cast_const());
            request.header(b"sec-websocket-protocol").unwrap_or(b"")
        } else {
            &upgrade_context.sec_websocket_protocol
        };

        let sec_websocket_extensions_value: &[u8] = if !sec_websocket_extensions.is_empty() {
            sec_websocket_extensions
        } else if !upgrade_context.request.is_null() {
            // S008: `uws::Request` is an `opaque_ffi!` ZST — safe deref.
            let request = bun_opaque::opaque_deref(upgrade_context.request.cast_const());
            request.header(b"sec-websocket-extensions").unwrap_or(b"")
        } else {
            &upgrade_context.sec_websocket_extensions
        };

        let websocket_key: &[u8] = if !upgrade_context.request.is_null() {
            // S008: `uws::Request` is an `opaque_ffi!` ZST — safe deref.
            let request = bun_opaque::opaque_deref(upgrade_context.request.cast_const());
            request.header(b"sec-websocket-key").unwrap_or(b"")
        } else {
            &upgrade_context.sec_websocket_key
        };

        let armed_reader = self.armed_this_value.get();
        let mut ended_unfinished_body = false;
        if let Some(raw_response) = self.connection.take_for_upgrade(self.flags.get()) {
            self.update_flags(|f| f.insert(Flags::UPGRADED));
            ended_unfinished_body = self.leave_pending(BodyReadState::Upgraded);
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

        // The request's header views end with its dispatch: this context must not read them later.
        self.upgrade_context.with_mut(|c| c.reset());

        // Last step: a reader that waits for the body gets its 'end', like Node 25 and older.
        if ended_unfinished_body && !armed_reader.is_empty() {
            let _guard = self.ref_guard();
            self.on_data_or_aborted(b"", true, AbortEvent::None, armed_reader);
        }

        true
    }

    pub(crate) fn maybe_stop_reading_body(&self, this_value: JSValue) {
        self.upgrade_context.with_mut(|c| c.reset()); // we can discard the upgrade context now

        let flags = self.flags.get();
        // An ended response keeps a body that a reader is armed for: it completes at its last chunk.
        let stopped = if flags.contains(Flags::SOCKET_CLOSED) {
            Some(BodyReadState::Aborted)
        } else if flags.contains(Flags::UPGRADED) {
            Some(BodyReadState::Upgraded)
        } else if flags.contains(Flags::ENDED)
            && !js::on_data_get_cached(this_value).is_some_and(|cb| cb.is_cell())
        {
            Some(BodyReadState::Detached)
        } else {
            None
        };
        if let Some(to) = stopped {
            if self.leave_pending(to) {
                self.mark_request_as_done_if_necessary();
            }
        }
    }

    /// The only way out of `Pending` besides the last chunk. Returns whether it left `Pending`.
    fn leave_pending(&self, to: BodyReadState) -> bool {
        if self.body_read_state.get() != BodyReadState::Pending {
            return false;
        }
        let flags = self.flags.get();
        if !flags.contains(Flags::UPGRADED) && !flags.contains(Flags::SOCKET_CLOSED) {
            self.release_body_slot();
        }
        self.body_read_state.set(to);
        if self.body_read_ref.get().has {
            self.body_read_ref.with_mut(|r| r.unref(vm_get()));
        }
        true
    }

    fn mark_socket_closed(&self) {
        self.update_flags(|f| f.insert(Flags::SOCKET_CLOSED));
        self.leave_pending(BodyReadState::Aborted);
    }

    /// uws's per-connection body handler slot is still this request's.
    fn body_still_arriving(&self) -> bool {
        self.body_read_state.get() == BodyReadState::Pending
    }

    /// Null uws's data handler slot if it is still this request's.
    fn release_body_slot(&self) {
        if self.body_still_arriving() {
            scoped_log!(NodeHTTPResponse, "clearOnData");
            if let Some(raw_response) = self.reader() {
                raw_response.clear_on_data();
            }
        }
    }

    fn should_request_be_pending(&self) -> bool {
        let flags = self.flags.get();
        // Once the socket is closed or has been adopted by the WebSocket
        // layer, the HTTP request/response cycle is over — no further uws
        // callbacks will arrive on the connection to balance the
        // IS_REQUEST_PENDING ref, so report not-pending so
        // `mark_request_as_done()` can release it.
        if flags.contains(Flags::SOCKET_CLOSED) || flags.contains(Flags::UPGRADED) {
            return false;
        }

        // The body keeps the request pending only while uws still owes it chunks.
        let body_pending = self.body_still_arriving();

        // A raw 'upgrade'/'connect' tunnel handoff ends the HTTP exchange the
        // same way, except an Upgrade carrying a body keeps parsing as HTTP
        // until the body's fin chunk (the actual tunnel start).
        if flags.contains(Flags::TUNNELED) {
            return body_pending;
        }

        if flags.contains(Flags::ENDED) {
            // Pending until the request body is read and the response body has drained.
            return body_pending || !flags.contains(Flags::REQUEST_HAS_COMPLETED);
        }

        true
    }

    fn mark_request_as_done(&self) {
        scoped_log!(NodeHTTPResponse, "markRequestAsDone()");
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
        // ws may still upgrade an open tunnel: keep a context whose request pointer is detached.
        let tunneled = self.flags.get().contains(Flags::TUNNELED);
        self.upgrade_context.with_mut(|c| {
            if !tunneled || !c.request.is_null() {
                c.reset();
            }
        });

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
            if let Some(raw_response) = self.reader() {
                raw_response.on_timeout(on_timeout_shim, self.as_ctx_ptr());
            }
        }
        // detach and
        self.upgrade_context
            .with_mut(|c| c.preserve_web_socket_headers_if_needed());
    }

    pub(crate) fn get_finished(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(self.flags.get().contains(Flags::REQUEST_HAS_COMPLETED))
    }

    /// Closed, or closing once uws finishes the read it is parsing (HTTP_NODE_CLOSE_AFTER_MESSAGE).
    pub(crate) fn is_socket_closed_or_closing(&self) -> bool {
        let flags = self.flags.get();
        if flags.contains(Flags::SOCKET_CLOSED) {
            return true;
        }
        // The connection outlives the socket of a done request: do not read it.
        if flags.is_done() || flags.contains(Flags::UPGRADED) {
            return false;
        }
        self.reader()
            .is_some_and(|raw| raw.state().is_node_close_after_message())
    }

    pub(crate) fn get_flags(&self, _global: &JSGlobalObject) -> JSValue {
        let mut flags = self.flags.get();
        if self.is_socket_closed_or_closing() {
            flags.insert(Flags::SOCKET_CLOSED);
        }
        JSValue::js_number_from_int32(flags.bits() as i32)
    }

    pub(crate) fn get_aborted(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(self.is_socket_closed_or_closing())
    }

    pub(crate) fn get_has_body(&self, _global: &JSGlobalObject) -> JSValue {
        let mut result: i32 = 0;
        match self.body_read_state.get() {
            BodyReadState::None => {}
            BodyReadState::Pending => result |= 1 << 1,
            BodyReadState::Complete | BodyReadState::Upgraded | BodyReadState::Detached => {
                result |= 1 << 2
            }
            BodyReadState::Aborted => result |= 1 << 3,
        }

        JSValue::js_number_from_int32(result)
    }

    pub(crate) fn get_buffered_amount(&self, _global: &JSGlobalObject) -> JSValue {
        let flags = self.flags.get();
        if flags.contains(Flags::REQUEST_HAS_COMPLETED) || flags.contains(Flags::SOCKET_CLOSED) {
            return JSValue::js_number_from_int32(0);
        }
        // Only the current response has bytes in the socket. For a queued one they are of a response ahead.
        if let Some(raw_response) = self.writer() {
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
            .map_or(0, |v| v.to_u32());
        self.write_head_impl(
            global_object,
            arguments,
            auto_header_bits,
            keep_alive_timeout_secs,
            callframe.this(),
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
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        // Arguments are converted first: ToString on statusMessage can run JS that ends or destroys the response.
        let status_code_value: JSValue = arguments.first().copied().unwrap_or(JSValue::UNDEFINED);
        let status_message_value: JSValue = match arguments.get(1).copied() {
            Some(v) if v != JSValue::NULL => v,
            _ => JSValue::UNDEFINED,
        };
        let headers_object_value: JSValue = match arguments.get(2).copied() {
            Some(v) if v != JSValue::NULL => v,
            _ => JSValue::UNDEFINED,
        };
        // The flat [name, value, ...] array that node:http renders, or none. The native head writer
        // runs no JS for that form, so a caller can hold the bytes of a chunk by reference while
        // the head goes out, and a recorded head can go out at the grant.
        if headers_object_value.is_cell() && !headers_object_value.is_array() {
            return Err(global_object.throw_invalid_argument_type_value(
                b"headers",
                b"array",
                headers_object_value,
            ));
        }

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

        let status_message_view;
        let status_message_slice;
        let status_message_bytes: &[u8] = if !status_message_value.is_undefined() {
            status_message_view = status_message_value.to_js_string_view(global_object)?;
            status_message_slice = status_message_view.to_utf8();
            status_message_slice.slice()
        } else {
            &[]
        };

        if self.is_requested_completed_or_ended() {
            return err_throw(
                global_object,
                ErrorCode::ERR_STREAM_ALREADY_FINISHED,
                "Stream is already ended",
            );
        }

        let flags = self.flags.get();
        let Some(raw_response) = self.writer() else {
            return self.record_head(
                global_object,
                status_code,
                status_message_bytes,
                headers_object_value,
                auto_header_bits,
                keep_alive_timeout_secs,
                this_value,
            );
        };
        if flags.contains(Flags::UPGRADED) || self.is_socket_closed_or_closing() {
            // We haven't emitted the "close" event yet.
            return Ok(JSValue::UNDEFINED);
        }

        let state = raw_response.state();
        handle_ended_if_necessary(state, global_object)?;

        if state.is_http_status_called() {
            return err_throw(
                global_object,
                ErrorCode::ERR_HTTP_HEADERS_SENT,
                "Stream already started",
            );
        }

        validate_status_message(global_object, status_message_bytes)?;

        // The status message coercion above can run JS that destroys the socket.
        if self.is_socket_closed_or_closing() {
            return Ok(JSValue::UNDEFINED);
        }

        with_status_text(status_code, status_message_bytes, |status| {
            write_head_internal(
                &raw_response,
                global_object,
                status,
                headers_object_value,
                auto_header_bits,
                keep_alive_timeout_secs,
            )
        })?;

        Ok(JSValue::UNDEFINED)
    }

    /// Waits for the connection: the server socket has not granted it, and nothing closed or adopted it.
    fn is_queued(&self) -> bool {
        !self
            .flags
            .get()
            .intersects(Flags::CURRENT | Flags::UPGRADED)
            && self.reader().is_some()
            && !self.is_socket_closed_or_closing()
    }

    /// A response that waits for the connection has an end in its record.
    fn recorded_end(&self) -> bool {
        self.queued_output
            .get()
            .as_ref()
            .is_some_and(|queued| queued.ended)
    }

    /// The checks of `write_head_impl` that read the state of the connection, for a response that has none yet.
    fn check_head_not_recorded(&self, global_object: &JSGlobalObject) -> JsResult<()> {
        let Some(queued) = self.queued_output.get() else {
            return Ok(());
        };
        if queued.ended {
            return err_throw(
                global_object,
                ErrorCode::ERR_STREAM_ALREADY_FINISHED,
                "Stream is already ended",
            );
        }
        if queued.started {
            return err_throw(
                global_object,
                ErrorCode::ERR_HTTP_HEADERS_SENT,
                "Stream already started",
            );
        }
        Ok(())
    }

    /// Adds a JS value to the record of a queued response and returns its index.
    fn push_queued_value(
        &self,
        global_object: &JSGlobalObject,
        this_value: JSValue,
        value: JSValue,
    ) -> JsResult<u32> {
        debug_assert!(!this_value.is_empty());
        let values = match js::pending_write_buffer_get_cached(this_value) {
            Some(values) if values.is_array() => values,
            _ => {
                let values = JSValue::create_empty_array(global_object, 0)?;
                js::pending_write_buffer_set_cached(this_value, global_object, values);
                values
            }
        };
        let index = self
            .queued_output
            .get()
            .as_ref()
            .map_or(0, |queued| queued.values);
        values.put_index(global_object, index, value)?;
        self.queued_output
            .with_mut(|slot| slot.get_or_insert_with(Default::default).values = index + 1);
        Ok(index)
    }

    fn queued_mark(&self) -> Option<QueuedMark> {
        self.queued_output.get().as_ref().map(|queued| QueuedMark {
            items: queued.items.len(),
            values: queued.values,
            started: queued.started,
            ended: queued.ended,
        })
    }

    /// Takes the record back to `mark`: what a call recorded before it threw is not sent.
    #[cold]
    fn restore_queued_output(
        &self,
        global_object: &JSGlobalObject,
        this_value: JSValue,
        mark: Option<QueuedMark>,
    ) {
        self.queued_output
            .with_mut(|slot| match (mark, slot.as_mut()) {
                (Some(mark), Some(queued)) => {
                    queued.items.truncate(mark.items);
                    queued.values = mark.values;
                    queued.started = mark.started;
                    queued.ended = mark.ended;
                }
                _ => *slot = None,
            });
        // A value past the mark is not of the record: the next one takes its index.
        if mark.is_none_or(|mark| mark.values == 0) {
            js::pending_write_buffer_set_cached(this_value, global_object, JSValue::ZERO);
        }
    }

    /// `writeHead` without the connection. A queued response records the head; one that lost the connection drops it.
    #[cold]
    #[inline(never)]
    fn record_head(
        &self,
        global_object: &JSGlobalObject,
        status_code: i32,
        status_message: &[u8],
        headers: JSValue,
        auto_header_bits: u32,
        keep_alive_timeout_secs: u32,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        if !self.is_queued() {
            // We haven't emitted the "close" event yet.
            return Ok(JSValue::UNDEFINED);
        }
        self.check_head_not_recorded(global_object)?;
        validate_status_message(global_object, status_message)?;

        let head = QueuedHead {
            status: with_status_text(status_code, status_message, |status| Box::from(status)),
            headers: if headers.is_cell() {
                Some(self.push_queued_value(global_object, this_value, headers)?)
            } else {
                None
            },
            auto_header_bits,
            keep_alive_timeout_secs,
        };
        self.queued_output.with_mut(|slot| {
            let queued = slot.get_or_insert_with(Default::default);
            queued.items.push(QueuedItem::Head(head));
            queued.started = true;
        });
        Ok(JSValue::UNDEFINED)
    }

    /// `handle.writeHeadAndEnd(status, statusMessage, headersArray, chunk,
    /// encoding, strictContentLength)` — the writeHead + end pair under one
    /// native cork and one JS->native crossing on the node:http response path.
    pub(crate) fn write_head_and_end(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        let arg = |index: usize| arguments.get(index).copied().unwrap_or(JSValue::UNDEFINED);
        let (auto_header_bits, keep_alive_timeout_secs) = auto_header_args(arg(6), arg(7));
        self.write_head_and_body::<true, false>(
            global_object,
            &arguments[..arguments.len().min(3)],
            // prepare_write reads (chunk, encoding, _, strictContentLength).
            &[arg(3), arg(4), JSValue::UNDEFINED, arg(5)],
            JSValue::UNDEFINED,
            auto_header_bits,
            keep_alive_timeout_secs,
            callframe.this(),
        )
    }

    /// `writeHeadAndEnd` with the framed trailer section of the response as one more argument.
    pub(crate) fn write_head_and_end_with_trailers(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        let arg = |index: usize| arguments.get(index).copied().unwrap_or(JSValue::UNDEFINED);
        let (auto_header_bits, keep_alive_timeout_secs) = auto_header_args(arg(6), arg(7));
        self.write_head_and_body::<true, true>(
            global_object,
            &arguments[..arguments.len().min(3)],
            // prepare_write reads (chunk, encoding, _, strictContentLength).
            &[arg(3), arg(4), JSValue::UNDEFINED, arg(5)],
            arg(8),
            auto_header_bits,
            keep_alive_timeout_secs,
            callframe.this(),
        )
    }

    /// `handle.writeHeadAndWrite(status, statusMessage, headersArray, chunk,
    /// encoding, callback, strictContentLength)` — `writeHeadAndEnd` for the
    /// first `res.write()`.
    pub(crate) fn write_head_and_write(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        let arg = |index: usize| arguments.get(index).copied().unwrap_or(JSValue::UNDEFINED);
        let (auto_header_bits, keep_alive_timeout_secs) = auto_header_args(arg(7), arg(8));
        self.write_head_and_body::<false, false>(
            global_object,
            &arguments[..arguments.len().min(3)],
            // prepare_write reads (chunk, encoding, callback, strictContentLength).
            &[arg(3), arg(4), arg(5), arg(6)],
            JSValue::UNDEFINED,
            auto_header_bits,
            keep_alive_timeout_secs,
            callframe.this(),
        )
    }

    /// The head and the first body call of a response, under one native cork.
    /// The chunk is converted and the strict Content-Length is compared before
    /// the head is written: a call that throws has written nothing.
    /// `WITH_TRAILERS`: `trailers_value` is the framed trailer section of the response.
    fn write_head_and_body<const IS_END: bool, const WITH_TRAILERS: bool>(
        &self,
        global_object: &JSGlobalObject,
        head_args: &[JSValue],
        body_args: &[JSValue; 4],
        trailers_value: JSValue,
        auto_header_bits: u32,
        keep_alive_timeout_secs: u32,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        // Neither phase runs for a response that has completed, lost its socket or was upgraded.
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

        // The chunk of a buffer is only borrowed from its conversion to the write, so nothing in
        // between may run JS. The toString() of a status message that is not a string does: it is
        // converted first.
        let converted_head;
        let head_args = match head_args.get(1) {
            Some(&status_message)
                if status_message.is_cell() && !status_message.is_string_literal() =>
            {
                converted_head = [
                    head_args[0],
                    status_message.to_js_string(global_object)?.to_js(),
                    head_args.get(2).copied().unwrap_or(JSValue::UNDEFINED),
                ];
                &converted_head[..]
            }
            _ => head_args,
        };
        let trailers = if WITH_TRAILERS {
            TrailerSection::from_js(global_object, trailers_value)?
        } else {
            TrailerSection::None
        };
        let mut string_or_buffer = crate::node::StringOrBuffer::EMPTY;
        let args = Self::prepare_write(global_object, body_args, &mut string_or_buffer)?;
        if let Some(content_length) = args.strict_content_length {
            self.check_content_length::<IS_END>(
                global_object,
                string_or_buffer.slice().len(),
                content_length,
            )?;
        }

        // BACKREF: the end of the response can close the socket, which runs JS
        // that could drop the last reference to this response mid-call.
        let this = bun_ptr::BackRef::from(ptr::NonNull::from(self));
        let _guard = self.ref_guard();

        let raw_response = this.writer();
        let mut result: JsResult<JSValue> = Ok(JSValue::UNDEFINED);
        {
            let mut run = || -> JsResult<JSValue> {
                this.write_head_impl(
                    global_object,
                    head_args,
                    auto_header_bits,
                    keep_alive_timeout_secs,
                    this_value,
                )?;
                if IS_END {
                    this.resume_socket_for_end();
                }
                this.deliver::<IS_END, WITH_TRAILERS>(
                    global_object,
                    &args,
                    &mut string_or_buffer,
                    trailers.bytes(),
                    this_value,
                )
            };
            if let Some(raw_response) = raw_response {
                raw_response.corked(|| {
                    // Capture `this` so a `self`-derived pointer reaches the
                    // FFI closure-data slot.
                    let _escape = this;
                    result = run();
                });
            } else {
                // A queued response records. A call that throws takes back what it recorded.
                let mark = this.queued_mark();
                result = run();
                if result.is_err() {
                    this.restore_queued_output(global_object, this_value, mark);
                }
            }
        }

        result
    }
}

/// The auto-header bits and the keep-alive timeout that the C++ head writer renders (kAutoHeader* in NodeHTTP.cpp).
#[inline(always)]
fn auto_header_args(bits: JSValue, keep_alive_timeout_secs: JSValue) -> (u32, u32) {
    (
        if bits.is_number() {
            bits.to_int32() as u32
        } else {
            0
        },
        if keep_alive_timeout_secs.is_number() {
            keep_alive_timeout_secs.to_u32()
        } else {
            0
        },
    )
}

/// Defense-in-depth against HTTP response splitting. Matches Node.js checkInvalidHeaderChar:
/// rejects any char not in [\t\x20-\x7e\x80-\xff].
#[inline]
fn validate_status_message(global_object: &JSGlobalObject, status_message: &[u8]) -> JsResult<()> {
    for &c in status_message {
        if c != b'\t' && (c < 0x20 || c == 0x7f) {
            return err_throw(
                global_object,
                ErrorCode::ERR_INVALID_CHAR,
                "Invalid character in statusMessage",
            );
        }
    }
    Ok(())
}

/// Calls `f` with the status line after "HTTP/1.1 ": the code and its reason phrase.
#[inline(always)]
fn with_status_text<R>(status_code: i32, status_message: &[u8], f: impl FnOnce(&[u8]) -> R) -> R {
    if status_message.is_empty() {
        if let Some(status_text) =
            HTTPStatusText::get(u16::try_from(status_code).expect("int cast"))
        {
            return f(status_text);
        }
    }

    let message: &[u8] = if !status_message.is_empty() {
        status_message
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
        f(&stack_buf[..n])
    } else {
        // Heap fallback for absurdly long status messages (> 252 bytes).
        let mut heap = Vec::with_capacity(n);
        heap.extend_from_slice(code);
        heap.push(b' ');
        heap.extend_from_slice(message);
        f(&heap)
    }
}

fn write_head_internal(
    response: &uws::AnyResponse,
    global_object: &JSGlobalObject,
    status_message: &[u8],
    headers: JSValue,
    auto_header_bits: u32,
    keep_alive_timeout_secs: u32,
) -> JsResult<()> {
    scoped_log!(
        NodeHTTPResponse,
        "writeHeadInternal({})",
        BStr::new(status_message)
    );
    type WriteHead =
        extern "C" fn(&JSGlobalObject, *const u8, usize, JSValue, u32, u32, *mut c_void);
    let (write_head, response): (WriteHead, *mut c_void) = match response {
        uws::AnyResponse::TCP(tcp) => (NodeHTTPServer__writeHead_http, (*tcp).cast::<c_void>()),
        uws::AnyResponse::SSL(ssl) => (NodeHTTPServer__writeHead_https, (*ssl).cast::<c_void>()),
        uws::AnyResponse::H3(_) | uws::AnyResponse::H2(_) => {
            bun_core::Output::panic(format_args!("node:http responses are always HTTP/1"));
        }
    };
    bun_jsc::from_js_host_call_generic(global_object, || {
        write_head(
            global_object,
            status_message.as_ptr(),
            status_message.len(),
            headers,
            auto_header_bits,
            keep_alive_timeout_secs,
            response,
        )
    })
}

impl NodeHTTPResponse {
    pub(crate) fn write_continue(
        &self,
        global_object: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.is_done() || self.is_socket_closed_or_closing() {
            return Ok(JSValue::UNDEFINED);
        }
        let Some(raw_response) = self.writer() else {
            return self.record_informational(QueuedItem::Continue);
        };
        let state = raw_response.state();
        handle_ended_if_necessary(state, global_object)?;

        raw_response.write_continue();
        Ok(JSValue::UNDEFINED)
    }

    /// A 1xx block without the connection. A queued response records it. One that lost the
    /// connection drops it, and so does one that recorded its end, like a response that ended.
    #[cold]
    #[inline(never)]
    fn record_informational(&self, item: QueuedItem) -> JsResult<JSValue> {
        if self.is_queued() && !self.recorded_end() {
            self.queued_output
                .with_mut(|slot| slot.get_or_insert_with(Default::default).items.push(item));
        }
        Ok(JSValue::UNDEFINED)
    }

    /// `flushHeaders()` without the connection. A queued response records where its header block ends.
    #[cold]
    #[inline(never)]
    fn record_flush_headers(&self) {
        if !self.is_queued() || self.recorded_end() {
            return;
        }
        self.queued_output.with_mut(|slot| {
            let queued = slot.get_or_insert_with(Default::default);
            if !matches!(queued.items.last(), Some(QueuedItem::FlushHeaders)) {
                queued.items.push(QueuedItem::FlushHeaders);
            }
            // uWS gives a response that has no status line "200 OK" when it flushes the head.
            queued.started = true;
        });
    }

    // Writes a caller-built 1xx informational response block to the same
    // AsyncSocket buffer writeStatus/end use, so a pipelined replay stays
    // ordered ahead of the final response bytes (node:http _writeRaw).
    pub(crate) fn write_informational(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
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

        // Response state is read only after the conversion above, which can run JS.
        if self.is_done() || self.is_socket_closed_or_closing() {
            return Ok(JSValue::UNDEFINED);
        }
        let Some(raw_response) = self.writer() else {
            return self.record_informational(QueuedItem::Informational(Box::from(
                string_or_buffer.slice(),
            )));
        };
        handle_ended_if_necessary(raw_response.state(), global_object)?;
        raw_response.write_informational(string_or_buffer.slice());
        Ok(JSValue::UNDEFINED)
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub(crate) enum AbortEvent {
    None = 0,
    Abort = 1,
    Timeout = 2,
    /// The socket read that `notifyWhenReadParsed` was called in is consumed.
    ReadParsed = 3,
}

impl NodeHTTPResponse {
    fn handle_abort_or_timeout<const EVENT: AbortEvent>(&self, js_value: JSValue) {
        if self.flags.get().contains(Flags::REQUEST_HAS_COMPLETED) {
            if EVENT == AbortEvent::Abort {
                // The socket is gone — no further uws callback will arrive to
                // balance the IS_REQUEST_PENDING ref. `on_request_complete()`
                // can set REQUEST_HAS_COMPLETED while `body_read_state` is
                // still `.pending` (a custom `ondata` reader keeps the body
                // pending across `res.end()`, see `write_or_end`), in which case
                // `mark_request_as_done()` never ran there and both that ref
                // and the server's pending-request counter are stranded. The
                // synchronous `set_closed()` from `JSNodeHTTPServerSocket::
                // onClose` has already flipped SOCKET_CLOSED, so
                // `should_request_be_pending()` is now false; let the gate
                // re-evaluate. Release the connection first so the
                // `clear_on_data_callback` reached from `mark_request_as_done`
                // can't touch the dead socket.
                self.connection.release();
                self.mark_request_as_done_if_necessary();
            }
            return;
        }

        if EVENT == AbortEvent::Abort {
            self.mark_socket_closed();
            self.discard_queued_output(js_value);
        }

        let _guard = self.ref_guard();

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
                    bun_event_loop::ContextId::NONE,
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

        // The connection is released before the guard's release because
        // `mark_request_as_done_if_necessary()` + that release can drop the
        // last ref when the JS wrapper has already finalized; nothing between
        // them reads the connection, so releasing first avoids a post-destroy write.
        if EVENT == AbortEvent::Abort {
            if self.flags.get().contains(Flags::ENDED) {
                // An ended response that was still draining is over now: `finished` reads true, as after a drain.
                self.on_request_complete();
            } else {
                self.mark_request_as_done_if_necessary();
            }
            self.connection.release();
        }
    }

    #[uws::uws_callback(export = "Bun__NodeHTTPResponse_onClose")]
    pub(crate) fn on_abort(&self, js_value: JSValue) {
        scoped_log!(NodeHTTPResponse, "onAbort");
        self.handle_abort_or_timeout::<{ AbortEvent::Abort }>(js_value);
    }

    #[uws::uws_callback(export = "Bun__NodeHTTPResponse_onReadParsed", no_catch)]
    pub(crate) fn on_read_parsed(&self) {
        // Same test as notify_when_read_parsed: a TLS close that waits for spilled bytes leaves the socket open.
        let flags = self.flags.get();
        if flags.contains(Flags::SOCKET_CLOSED) || flags.contains(Flags::UPGRADED) {
            return;
        }
        let armed = self.armed_this_value.get();
        let this_value = if armed.is_empty() {
            self.get_this_value()
        } else {
            armed
        };
        self.on_data_or_aborted(&[], false, AbortEvent::ReadParsed, this_value);
    }

    pub(crate) fn notify_when_read_parsed(
        &self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let flags = self.flags.get();
        let Some(raw) = self.reader() else {
            return Ok(JSValue::FALSE);
        };
        if flags.contains(Flags::SOCKET_CLOSED) || flags.contains(Flags::UPGRADED) {
            return Ok(JSValue::FALSE);
        }
        Ok(JSValue::from(Bun__NodeHTTP__notifyWhenReadParsed(
            any_response_is_ssl(&raw) as core::ffi::c_int,
            raw.socket().cast(),
        )))
    }

    #[uws::uws_callback(export = "Bun__NodeHTTPResponse_setClosed", no_catch)]
    pub(crate) fn set_closed(&self) {
        self.mark_socket_closed();
    }

    /// The server socket makes this queued response the connection's current response, and what the
    /// response recorded while it waited goes out. `js_this` is this response's wrapper.
    #[uws::uws_callback(export = "Bun__NodeHTTPResponse_grantConnection", no_catch)]
    pub(crate) fn grant_connection(&self, js_this: JSValue) -> i32 {
        if self.reader().is_none() {
            return GrantResult::Gone as i32;
        }
        self.update_flags(|f| f.insert(Flags::CURRENT));
        match self.queued_output.replace(None) {
            Some(queued) => self.flush_queued_output(*queued, js_this) as i32,
            None => GrantResult::Flushed as i32,
        }
    }

    /// The bytes of a recorded buffer chunk as they are now: a buffer that JS detached since the
    /// call has none. This runs no JS.
    fn read_buffer_chunk(
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> crate::node::StringOrBuffer<'static> {
        use crate::node::StringOrBuffer;
        if value.is_cell()
            && value.js_type().is_array_buffer_like()
            && let Ok(chunk) =
                StringOrBuffer::buffer_from_js(global_object, value, crate::node::Flavor::Sync)
        {
            return chunk;
        }
        StringOrBuffer::EMPTY
    }

    #[cold]
    #[inline(never)]
    fn flush_queued_output(&self, queued: QueuedOutput, js_this: JSValue) -> GrantResult {
        scoped_log!(
            NodeHTTPResponse,
            "flushQueuedOutput({} items)",
            queued.items.len()
        );
        let global_object = self.server.global_this();
        // The JS values of the record leave the slot: the tail of a large write uses it from here on.
        let values =
            js::pending_write_buffer_get_cached(js_this).filter(|values| values.is_array());
        if values.is_some() {
            js::pending_write_buffer_set_cached(js_this, global_object, JSValue::ZERO);
        }
        let Some(raw_response) = self.writer() else {
            return GrantResult::Gone;
        };
        // A write can end in the close of the socket, which runs JS.
        let this = bun_ptr::BackRef::from(ptr::NonNull::from(self));
        let _guard = self.ref_guard();
        // The array is this record's own: a read of one of its elements runs no JS.
        let value_at = |index: u32| -> JSValue {
            values
                .and_then(|values| values.get_direct_index(global_object, index).ok())
                .unwrap_or(JSValue::UNDEFINED)
        };
        // The bytes of a chunk, and the JS value that they are of, if any.
        let resolve = |chunk: QueuedChunk| match chunk {
            QueuedChunk::Bytes(bytes) => (bytes, JSValue::UNDEFINED),
            QueuedChunk::Value(index) => {
                let value = value_at(index);
                (Self::read_buffer_chunk(global_object, value), value)
            }
        };

        raw_response.corked(|| {
            for item in queued.items {
                if matches!(item, QueuedItem::End(..)) {
                    this.resume_socket_for_end();
                }
                // Read again for each item: the close of the socket releases the connection.
                let Some(raw_response) = this.writer() else {
                    return;
                };
                if this.is_socket_closed_or_closing() {
                    return;
                }
                match item {
                    QueuedItem::Continue => raw_response.write_continue(),
                    QueuedItem::Informational(bytes) => raw_response.write_informational(&bytes),
                    QueuedItem::FlushHeaders => raw_response.flush_headers(false),
                    QueuedItem::Head(head) => {
                        // The head writer runs no JS for an array. Only a string that cannot be
                        // resolved for lack of memory makes it throw.
                        if let Err(err) = write_head_internal(
                            &raw_response,
                            global_object,
                            &head.status,
                            head.headers.map_or(JSValue::UNDEFINED, value_at),
                            head.auto_header_bits,
                            head.keep_alive_timeout_secs,
                        ) {
                            let exception = global_object.take_exception(err);
                            let _ = bun_vm_mut(global_object).uncaught_exception(
                                global_object,
                                exception,
                                false,
                            );
                        }
                    }
                    QueuedItem::Chunk(chunk) => {
                        let (mut bytes, value) = resolve(chunk);
                        let _ = this.send_outlined::<false>(
                            global_object,
                            raw_response,
                            raw_response.state(),
                            &mut bytes,
                            &[],
                            value,
                            JSValue::UNDEFINED,
                            js_this,
                            ChunkCount::Counted,
                        );
                    }
                    QueuedItem::End(chunk, trailers) => {
                        let (mut bytes, value) = resolve(chunk);
                        let _ = this.send_outlined::<true>(
                            global_object,
                            raw_response,
                            raw_response.state(),
                            &mut bytes,
                            &trailers,
                            value,
                            JSValue::UNDEFINED,
                            js_this,
                            ChunkCount::Counted,
                        );
                    }
                }
            }
        });
        if let Some(values) = values {
            values.ensure_still_alive();
        }

        let flags = self.flags.get();
        let buffered = if flags.contains(Flags::ENDED) {
            !flags.contains(Flags::REQUEST_HAS_COMPLETED)
        } else {
            self.has_unflushed_write()
        };
        if buffered {
            GrantResult::Buffered
        } else {
            GrantResult::Flushed
        }
    }

    /// The connection is gone for a response that waited for it: what it recorded is never sent.
    /// `js_this` is this response's wrapper, if the caller has it.
    fn discard_queued_output(&self, js_this: JSValue) {
        if self.queued_output.replace(None).is_some() && !js_this.is_empty() {
            js::pending_write_buffer_set_cached(js_this, self.server.global_this(), JSValue::ZERO);
        }
    }

    /// `js_this` is this response's wrapper. `adopted`: a WebSocket has the socket, so nothing of it is touched.
    #[uws::uws_callback(export = "Bun__NodeHTTPResponse_takeBackConnection", no_catch)]
    #[inline]
    pub(crate) fn take_back_connection(&self, js_this: JSValue, adopted: bool) {
        let flags = self.flags.get();
        if flags.intersects(Flags::IS_REQUEST_PENDING | Flags::UPGRADED) {
            return self.take_back_unfinished_connection(js_this, adopted);
        }
        // Finished, the case of each keep-alive request: `mark_request_as_done()` left nothing of it on the connection.
        self.connection.release();
        self.flags.set(flags.difference(Flags::CURRENT));
    }

    #[cold]
    #[inline(never)]
    fn take_back_unfinished_connection(&self, js_this: JSValue, adopted: bool) {
        scoped_log!(NodeHTTPResponse, "takeBackConnection");
        let flags = self.flags.get();
        if flags.contains(Flags::UPGRADED) {
            // It handed the socket to the WebSocket itself.
            return;
        }

        let _guard = self.ref_guard();
        let global_object = self.server.global_this();
        self.discard_queued_output(js_this);
        let pinned = self.pending_pinned_write.get();
        if pinned.is_some() {
            // The bytes that a write() already counted go out before the next response.
            if !adopted && let Some(raw_response) = self.writer() {
                raw_response.spill_body(pinned.remaining());
            }
            self.clear_pending_pinned_write(global_object, js_this);
        }
        if !adopted && let Some(raw_response) = self.reader() {
            raw_response.clear_handlers_of(self.as_ctx_ptr());
        }
        self.connection.release();
        // No close reaches it from here on, so it reads as closed now.
        self.update_flags(|f| {
            f.remove(Flags::CURRENT);
            f.insert(Flags::SOCKET_CLOSED);
        });
        self.leave_pending(BodyReadState::Aborted);
        if flags.contains(Flags::ENDED) {
            self.on_request_complete();
        } else {
            self.mark_request_as_done_if_necessary();
        }
    }

    /// Flag-only: the pending-request release happens deterministically in
    /// the dispatch tail (`on_node_http_request*` in `mod.rs`) or, for an
    /// Upgrade with a body, at the body's fin chunk.
    #[uws::uws_callback(export = "Bun__NodeHTTPResponse_markTunneled", no_catch)]
    pub(crate) fn mark_tunneled(&self) {
        self.update_flags(|f| f.insert(Flags::TUNNELED));
    }

    /// A raw write or a FIN on the socket has to go out behind the zero-copy tail of an earlier `write()`.
    #[uws::uws_callback(export = "Bun__NodeHTTPResponse_spillPendingWrite", no_catch)]
    pub(crate) fn spill_pending_write(&self) {
        self.spill_pending_pinned_write(self.server.global_this());
    }

    fn on_timeout(&self, _resp: uws::AnyResponse) {
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
        let ended = flags.contains(Flags::REQUEST_HAS_COMPLETED) || flags.contains(Flags::ENDED);
        if self.reader().is_none()
            || flags.contains(Flags::SOCKET_CLOSED)
            || flags.contains(Flags::UPGRADED)
            || (ended && !self.body_still_arriving())
        {
            return Ok(JSValue::FALSE);
        }
        self.pause_socket();
        Ok(JSValue::TRUE)
    }

    pub(crate) fn do_resume(
        &self,
        _global_object: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        scoped_log!(NodeHTTPResponse, "doResume");
        // Unconditional: a paused socket defers the peer's FIN until it is resumed.
        self.resume_socket();
        let flags = self.flags.get();
        Ok(JSValue::from(
            self.reader().is_some()
                && !flags.contains(Flags::REQUEST_HAS_COMPLETED)
                && !flags.contains(Flags::SOCKET_CLOSED)
                && !flags.contains(Flags::ENDED)
                && !flags.contains(Flags::UPGRADED),
        ))
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
fn node_http_request_on_resolve(global_object: &JSGlobalObject, callframe: &CallFrame) -> JSValue {
    scoped_log!(NodeHTTPResponse, "onResolve");
    let arguments = callframe.arguments_as_array::<2>();
    // arguments[1] is the JSNodeHTTPResponse cell from the resolve callback.
    // R-2: deref shared — `maybe_stop_reading_body`/`on_request_complete` re-enter.
    let this: &NodeHTTPResponse = arguments[1].as_class_ref::<NodeHTTPResponse>().unwrap();
    // `promise` non-empty is the ownership token for the server-handler ref;
    // `mark_request_as_done` may have already released it on abort.
    let had_promise = this.promise.with_mut(|p| {
        let had = p.has();
        p.deinit();
        had
    });
    this.maybe_stop_reading_body(arguments[1]);

    let flags = this.flags.get();
    if !flags.contains(Flags::REQUEST_HAS_COMPLETED) && !this.is_socket_closed_or_closing() {
        let this_value = this.get_this_value();
        if !this_value.is_empty() {
            js::on_aborted_set_cached(this_value, global_object, JSValue::ZERO);
        }
        // Put any held zero-copy tail on the wire before terminating so the
        // chunked stream stays well-formed.
        this.spill_pending_pinned_write(global_object);
        this.leave_pending(BodyReadState::Detached);
        if let Some(raw_response) = this.writer() {
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
fn node_http_request_on_reject(global_object: &JSGlobalObject, callframe: &CallFrame) -> JSValue {
    let arguments = callframe.arguments_as_array::<2>();
    let err = arguments[0];
    // arguments[1] is the JSNodeHTTPResponse cell from the reject callback.
    // R-2: deref shared — `maybe_stop_reading_body`/`on_request_complete` re-enter.
    let this: &NodeHTTPResponse = arguments[1].as_class_ref::<NodeHTTPResponse>().unwrap();
    // `promise` non-empty is the ownership token for the server-handler ref;
    // `mark_request_as_done` may have already released it on abort.
    let had_promise = this.promise.with_mut(|p| {
        let had = p.has();
        p.deinit();
        had
    });
    this.maybe_stop_reading_body(arguments[1]);

    let flags = this.flags.get();
    if !flags.contains(Flags::REQUEST_HAS_COMPLETED)
        && !flags.contains(Flags::UPGRADED)
        && !this.is_socket_closed_or_closing()
    {
        let this_value = this.get_this_value();
        if !this_value.is_empty() {
            js::on_aborted_set_cached(this_value, global_object, JSValue::ZERO);
        }
        // Put any held zero-copy tail on the wire before the terminating chunk
        // so the client's chunked decoder stays in sync.
        this.spill_pending_pinned_write(global_object);
        this.leave_pending(BodyReadState::Detached);
        if let Some(raw_response) = this.writer() {
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
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.is_done() {
            return Ok(JSValue::UNDEFINED);
        }

        // uws is parsing this socket: it delivers the rest of the read, then closes (on_abort runs then).
        if let Some(raw_response) = self.reader()
            && raw_response.close_after_message_if_parsing()
        {
            return Ok(JSValue::UNDEFINED);
        }

        // Re-arm the poll before marking SOCKET_CLOSED (resume_socket is a no-op
        // once that flag is set) so a paused socket's deferred EOF can fire.
        self.resume_socket();
        // Release the zero-copy pin + owner + GC root while the wrapper is
        // still reachable via the socket (get_this_value() returns ZERO once
        // SOCKET_CLOSED is set).
        self.clear_pending_pinned_write(global_object, JSValue::ZERO);
        self.discard_queued_output(frame.this());
        self.release_body_slot();
        self.mark_socket_closed();
        if let Some(raw_response) = self.writer() {
            let state = raw_response.state();
            if state.is_http_end_called() {
                return Ok(JSValue::UNDEFINED);
            }
        }
        if let Some(raw_response) = self.writer() {
            raw_response.clear_on_writable();
            raw_response.clear_timeout();
            raw_response.end_without_body(true);
        }
        self.on_request_complete();
        Ok(JSValue::UNDEFINED)
    }

    fn get_bytes(&self, global_this: &JSGlobalObject, chunk: &[u8]) -> JSValue {
        if chunk.is_empty() {
            return JSValue::UNDEFINED;
        }
        // No 'error' event carries this failure, so it is reported as an uncaught exception.
        match jsc::ArrayBuffer::create_buffer(global_this, chunk) {
            Ok(b) => b,
            Err(err) => {
                let exc = global_this.take_exception(err);
                let _ = bun_vm_mut(global_this).uncaught_exception(global_this, exc, false);
                JSValue::UNDEFINED
            }
        }
    }

    fn on_data_or_aborted(&self, chunk: &[u8], last: bool, event: AbortEvent, this_value: JSValue) {
        scoped_log!(
            NodeHTTPResponse,
            "onDataOrAborted({}, {})",
            chunk.len(),
            last
        );
        // On the last chunk, keep `self` alive across the JS callback below.
        let _guard = last.then(|| self.ref_guard());
        if last && event == AbortEvent::None && self.body_read_state.get() == BodyReadState::Pending
        {
            self.body_read_state.set(BodyReadState::Complete);
        }

        if let Some(callback) = js::on_data_get_cached(this_value) {
            if callback.is_cell() {
                let vm = vm_get();
                let global_this = vm.global();
                let event_loop = vm.event_loop_ref();

                let bytes = self.get_bytes(global_this, chunk);

                event_loop.run_callback(
                    bun_event_loop::ContextId::NONE,
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

        // The callback can run 'end' -> autoDestroy -> `ondata = undefined`, which drops the ref first.
        if last {
            if self.body_read_ref.get().has {
                self.body_read_ref.with_mut(|r| r.unref(vm_get()));
            }
            self.mark_request_as_done_if_necessary();
        }
    }

    fn on_data(&self, chunk: &[u8], last: bool) {
        scoped_log!(
            NodeHTTPResponse,
            "onData({} bytes, is_last = {})",
            chunk.len(),
            last as u8
        );

        if last {
            self.capture_request_trailers();
        }
        // Deliver through the wrapper that armed ondata for THIS response's
        // request; the socket-current wrapper is a different (already-finished)
        // response while requests are pipelined.
        let this_value = {
            let armed = self.armed_this_value.get();
            if armed.is_empty() {
                self.get_this_value()
            } else {
                armed
            }
        };
        self.on_data_or_aborted(chunk, last, AbortEvent::None, this_value);
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
        if let Some(raw) = self.writer() {
            raw.spill_body(p.remaining());
        }
        self.clear_pending_pinned_write(global_object, JSValue::ZERO);
    }

    /// True while the zero-copy tail or the uWS backpressure buffer still holds bytes.
    fn has_unflushed_write(&self) -> bool {
        self.pending_pinned_write.get().is_some()
            || self
                .reader()
                .is_some_and(|raw| raw.get_buffered_amount() > 0)
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
        let _guard = self.ref_guard();

        let this_value = self.get_this_value();
        let Some(on_writable) = js::on_writable_get_cached(this_value) else {
            return;
        };
        // Slot may hold UNDEFINED (WantMore) or anything the `.onwritable`
        // setter stored; non-cells can't be callable or AsyncContextFrame,
        // so skip instead of surfacing a spurious "not a function" uncaught.
        if !on_writable.is_cell() {
            return;
        }
        let vm = vm_get();
        let global_this = vm.global();
        js::on_writable_set_cached(this_value, global_this, JSValue::ZERO);

        vm.event_loop_ref().run_callback(
            bun_event_loop::ContextId::NONE,
            on_writable,
            global_this,
            JSValue::UNDEFINED,
            &[JSValue::js_number_from_uint64(offset)],
        );
    }

    fn on_drain(&self, offset: u64, response: uws::AnyResponse) -> bool {
        scoped_log!(NodeHTTPResponse, "onDrain({})", offset);

        let flags = self.flags.get();
        if flags.contains(Flags::SOCKET_CLOSED) || flags.contains(Flags::UPGRADED) {
            // return false means we don't have anything to drain
            return false;
        }
        if flags.contains(Flags::REQUEST_HAS_COMPLETED) {
            // A registration this response left behind: disarm it so the socket can flush and close.
            response.clear_on_writable();
            return true;
        }

        if flags.contains(Flags::ENDED) {
            if !response.has_fully_drained() {
                // The flush left a TLS batch tail in userspace; the next writable event reports it.
                return true;
            }
            // Armed by end(): the bytes it left buffered are out, so the response has finished.
            let _guard = self.ref_guard();
            response.clear_on_writable();
            self.on_request_complete();
            self.on_drain_corked(offset);
            return true;
        }

        // Partial pinned progress: return false so onWritable's close gate
        // waits (bufferedAmount does not count the pinned tail). Zero progress
        // after the peer's FIN is handed to the buffered path (spill) so the
        // sibling `flushed == 0 && RECEIVED_FIN` close in HttpContext::
        // onWritable decides; without FIN (SSL WANT_READ, ENOBUFS) retries.
        let pinned_before = self.pending_pinned_write.get().remaining.len();
        if self.drain_pending_pinned_write(response) {
            if self.pending_pinned_write.get().remaining.len() < pinned_before {
                return false;
            }
            if response.state().is_node_received_fin() {
                self.spill_pending_pinned_write(self.server.global_this());
            }
            return true;
        }

        // Drained: disarm so onEnd's `onWritable != nullptr` probe does not see
        // a stale shim (callOnWritable would restore it); writes re-arm.
        response.clear_on_writable();
        response.corked(|| self.on_drain_corked(offset));
        // return true means we may have something to drain
        true
    }

    /// Disarms the drain callback unless an earlier write still owes a 'drain': that write reported backpressure and its writable event still comes.
    fn disarm_on_writable_unless_owed(
        raw_response: uws::AnyResponse,
        js_this: JSValue,
        global_object: &JSGlobalObject,
    ) {
        if js::on_writable_get_cached(js_this).is_some_and(|callback| callback.is_cell()) {
            return;
        }
        raw_response.clear_on_writable();
        js::on_writable_set_cached(js_this, global_object, JSValue::UNDEFINED);
    }

    /// The encoding of the chunk of a write()/end(). Like Writable.prototype.write, a falsy value
    /// means the default, and any other value has to name an encoding.
    #[inline(always)]
    fn chunk_encoding(
        global_object: &JSGlobalObject,
        chunk: JSValue,
        encoding_value: JSValue,
    ) -> JsResult<crate::node::Encoding> {
        if encoding_value.is_falsey() {
            return Ok(crate::node::Encoding::Utf8);
        }
        if encoding_value.is_string()
            && let Some(encoding) = crate::node::Encoding::from_js(encoding_value, global_object)?
        {
            return Ok(encoding);
        }
        Err(err_throw_unknown_encoding(
            global_object,
            chunk,
            encoding_value,
        ))
    }

    /// The checks that write() and end() make of a chunk, with no conversion: no bytes, no JS.
    /// `type_only` leaves the encoding out, for a caller that has to judge the chunk before the
    /// point where Node judges the encoding.
    #[cold]
    pub(crate) fn check_chunk(
        global_object: &JSGlobalObject,
        chunk: JSValue,
        encoding_value: JSValue,
        type_only: bool,
    ) -> JsResult<()> {
        use crate::node::{Encoding, StringObjects, StringOrBuffer};
        if chunk.is_undefined_or_null() {
            return Ok(());
        }
        let encoding = if type_only {
            Encoding::Utf8
        } else {
            Self::chunk_encoding(global_object, chunk, encoding_value)?
        };
        if !StringOrBuffer::converts_with_encoding(chunk, encoding, StringObjects::Allow) {
            return Err(err_throw_chunk_type(global_object, chunk));
        }
        Ok(())
    }

    /// Converts the arguments of a write()/end(): (chunk, encoding, callback, strictContentLength).
    /// The chunk goes into the caller's slot. This reads and writes nothing of the response, so a call
    /// that it rejects has committed nothing.
    #[inline(always)]
    fn prepare_write(
        global_object: &JSGlobalObject,
        arguments: &[JSValue],
        string_or_buffer: &mut crate::node::StringOrBuffer<'static>,
    ) -> JsResult<WriteArgs> {
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
        // writes straight into the caller's slot.
        if !input_value.is_undefined_or_null() {
            let encoding = Self::chunk_encoding(global_object, input_value, encoding_value)?;

            let converted = crate::node::StringOrBuffer::from_js_with_encoding_into(
                string_or_buffer,
                global_object,
                input_value,
                encoding,
            )?;
            // `check_chunk` judges a chunk without this conversion: the two must agree.
            debug_assert_eq!(
                converted,
                crate::node::StringOrBuffer::converts_with_encoding(
                    input_value,
                    encoding,
                    crate::node::StringObjects::Allow,
                )
            );
            if !converted {
                return Err(err_throw_chunk_type(global_object, input_value));
            }
        }

        Ok(WriteArgs {
            input_value,
            callback_value,
            strict_content_length,
        })
    }

    /// The rule of Node's write_() for `res.strictContentLength`: a write must not pass the declared
    /// length and an end must meet it. Returns the body bytes that the response has with this chunk.
    #[inline]
    fn check_content_length<const IS_END: bool>(
        &self,
        global_object: &JSGlobalObject,
        chunk_length: usize,
        content_length: u64,
    ) -> JsResult<usize> {
        let bytes_written = self.bytes_written.get() + chunk_length;
        let mismatch = if IS_END {
            bytes_written as u64 != content_length
        } else {
            bytes_written as u64 > content_length
        };
        if mismatch {
            return Err(err_throw_content_length_mismatch(
                global_object,
                bytes_written,
                content_length,
            ));
        }
        Ok(bytes_written)
    }

    /// Checks the chunk against the strict Content-Length, if any, and counts it.
    #[inline]
    fn count_chunk<const IS_END: bool>(
        &self,
        global_object: &JSGlobalObject,
        chunk_length: usize,
        strict_content_length: Option<u64>,
    ) -> JsResult<()> {
        if let Some(content_length) = strict_content_length {
            let bytes_written =
                self.check_content_length::<IS_END>(global_object, chunk_length, content_length)?;
            self.bytes_written.set(bytes_written);
        } else {
            self.bytes_written
                .set(self.bytes_written.get().saturating_add(chunk_length));
        }
        Ok(())
    }

    /// `WITH_TRAILERS`: `arguments[4]` is the framed trailer section of the response.
    fn write_or_end<const IS_END: bool, const WITH_TRAILERS: bool>(
        &self,
        global_object: &JSGlobalObject,
        arguments: &[JSValue],
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        // Arguments are converted first: the conversion can run JS that ends or destroys the response.
        // The chunk is last: the chunk of a buffer is only borrowed from its conversion to the write.
        let trailers = if WITH_TRAILERS && arguments.len() > 4 {
            TrailerSection::from_js(global_object, arguments[4])?
        } else {
            TrailerSection::None
        };
        let mut string_or_buffer = crate::node::StringOrBuffer::EMPTY;
        let args = Self::prepare_write(global_object, arguments, &mut string_or_buffer)?;
        self.deliver::<IS_END, WITH_TRAILERS>(
            global_object,
            &args,
            &mut string_or_buffer,
            trailers.bytes(),
            this_value,
        )
        // string_or_buffer drops at scope exit.
    }

    /// Gives a converted chunk to the connection. A response that waits for the connection records it.
    #[inline(always)]
    fn deliver<const IS_END: bool, const WITH_TRAILERS: bool>(
        &self,
        global_object: &JSGlobalObject,
        args: &WriteArgs,
        string_or_buffer: &mut crate::node::StringOrBuffer<'static>,
        trailer_section: &[u8],
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        if self.is_requested_completed_or_ended() {
            return err_throw(
                global_object,
                ErrorCode::ERR_STREAM_WRITE_AFTER_END,
                "Stream already ended",
            );
        }

        let Some(raw_response) = self.writer() else {
            return self.record_chunk(
                global_object,
                IS_END,
                args,
                string_or_buffer,
                trailer_section,
                this_value,
            );
        };
        // Like Node's _writeRaw on a destroyed socket: 'close' has not been emitted yet, so the write is dropped.
        if self.is_socket_closed_or_closing() {
            return Ok(if IS_END {
                JSValue::UNDEFINED
            } else {
                JSValue::js_number_from_int32(0)
            });
        }

        let state = raw_response.state();
        if !state.is_response_pending() {
            return err_throw(
                global_object,
                ErrorCode::ERR_STREAM_WRITE_AFTER_END,
                "Stream already ended",
            );
        }

        if WITH_TRAILERS {
            return self.send_outlined::<IS_END>(
                global_object,
                raw_response,
                state,
                string_or_buffer,
                trailer_section,
                args.input_value,
                args.callback_value,
                this_value,
                ChunkCount::Count(args.strict_content_length),
            );
        }
        self.send::<IS_END, false>(
            global_object,
            raw_response,
            state,
            string_or_buffer,
            &[],
            args.input_value,
            args.callback_value,
            this_value,
            ChunkCount::Count(args.strict_content_length),
        )
    }

    /// `send` as a call, for the paths that are not hot: an end with trailers and the flush of a
    /// record share one copy for each kind of call.
    #[inline(never)]
    fn send_outlined<const IS_END: bool>(
        &self,
        global_object: &JSGlobalObject,
        raw_response: uws::AnyResponse,
        state: uws::State,
        string_or_buffer: &mut crate::node::StringOrBuffer<'static>,
        trailer_section: &[u8],
        input_value: JSValue,
        callback_value: JSValue,
        this_value: JSValue,
        count: ChunkCount,
    ) -> JsResult<JSValue> {
        self.send::<IS_END, true>(
            global_object,
            raw_response,
            state,
            string_or_buffer,
            trailer_section,
            input_value,
            callback_value,
            this_value,
            count,
        )
    }

    /// write()/end() without the connection. A queued response records the chunk after the checks of
    /// `deliver`; one that lost the connection drops it.
    #[cold]
    #[inline(never)]
    fn record_chunk(
        &self,
        global_object: &JSGlobalObject,
        is_end: bool,
        args: &WriteArgs,
        string_or_buffer: &mut crate::node::StringOrBuffer<'static>,
        trailer_section: &[u8],
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        if !self.is_queued() {
            return Ok(if is_end {
                JSValue::UNDEFINED
            } else {
                JSValue::js_number_from_int32(0)
            });
        }
        if self.recorded_end() {
            return err_throw(
                global_object,
                ErrorCode::ERR_STREAM_WRITE_AFTER_END,
                "Stream already ended",
            );
        }

        let chunk_length = string_or_buffer.slice().len();
        if is_end {
            self.count_chunk::<true>(global_object, chunk_length, args.strict_content_length)?;
        } else {
            self.count_chunk::<false>(global_object, chunk_length, args.strict_content_length)?;
        }
        let chunk = if matches!(string_or_buffer, crate::node::StringOrBuffer::Buffer(_)) {
            // The bytes of a buffer are only borrowed for this call: the record keeps the JS value.
            QueuedChunk::Value(self.push_queued_value(
                global_object,
                this_value,
                args.input_value,
            )?)
        } else {
            QueuedChunk::Bytes(core::mem::take(string_or_buffer))
        };
        let item = if is_end {
            QueuedItem::End(chunk, Box::from(trailer_section))
        } else {
            QueuedItem::Chunk(chunk)
        };
        self.queued_output.with_mut(|slot| {
            let queued = slot.get_or_insert_with(Default::default);
            queued.items.push(item);
            queued.started = true;
            queued.ended = is_end;
        });
        Ok(JSValue::js_number_from_uint64(chunk_length as u64))
    }

    /// Counts a chunk, if `count` says so, and writes it. Only the count can throw. `input_value` is
    /// the JS value the chunk was converted from, if the caller still has it, and `this_value` the
    /// wrapper, if it has it. `WITH_TRAILERS`: an end can have a framed trailer section.
    #[inline(always)]
    fn send<const IS_END: bool, const WITH_TRAILERS: bool>(
        &self,
        global_object: &JSGlobalObject,
        raw_response: uws::AnyResponse,
        state: uws::State,
        string_or_buffer: &mut crate::node::StringOrBuffer<'static>,
        trailer_section: &[u8],
        input_value: JSValue,
        callback_value: JSValue,
        this_value: JSValue,
        count: ChunkCount,
    ) -> JsResult<JSValue> {
        let bytes = string_or_buffer.slice();
        if let ChunkCount::Count(strict_content_length) = count {
            self.count_chunk::<IS_END>(global_object, bytes.len(), strict_content_length)?;
        }

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
        let js_this = if !this_value.is_empty() {
            this_value
        } else {
            self.get_this_value()
        };

        // An empty write looks flushed to uWS; WantMore would disarm the drain that is still owed.
        if !IS_END && bytes.is_empty() && self.has_unflushed_write() {
            if !callback_value.is_undefined() {
                js::on_writable_set_cached(
                    js_this,
                    global_object,
                    callback_value.with_async_context_if_needed(global_object),
                );
                raw_response.on_writable(on_drain_shim, self.as_ctx_ptr());
            }
            // -0 would not read as negative (backpressure) in JS.
            return Ok(JSValue::js_number_from_int32(-1));
        }

        // A previous zero-copy write's tail must hit the wire before this one;
        // copy it into backpressure so ordering is preserved. No-op when the
        // caller correctly waited for 'drain' (the tail was already consumed).
        self.spill_pending_pinned_write(global_object);

        Ok(if IS_END {
            if !this_value.is_empty() {
                js::on_aborted_set_cached(this_value, global_object, JSValue::ZERO);
            }

            raw_response.clear_aborted();
            raw_response.clear_on_writable();
            raw_response.clear_timeout();
            self.update_flags(|f| f.insert(Flags::ENDED));
            if WITH_TRAILERS && !trailer_section.is_empty() {
                raw_response.end_with_trailers(bytes, trailer_section);
            } else if !state.is_http_write_called() || !bytes.is_empty() {
                raw_response.end(bytes, state.is_http_connection_close());
            } else {
                raw_response.end_stream(state.is_http_connection_close());
            }

            // Still-buffered bytes keep the request in flight until on_drain; `-(len + 1)` says so.
            // Read the connection again: the end can release it.
            if let Some(raw_response) = self.writer() {
                if !self.flags.get().contains(Flags::SOCKET_CLOSED)
                    && !raw_response.is_closed()
                    && !raw_response.has_fully_drained()
                {
                    raw_response.on_writable(on_drain_shim, self.as_ctx_ptr());
                    return Ok(JSValue::js_number(-(bytes.len() as f64) - 1.0));
                }
            }
            self.on_request_complete();

            JSValue::js_number_from_uint64(bytes.len() as u64)
        } else {
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
                    Self::disarm_on_writable_unless_owed(raw_response, js_this, global_object);
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
                            ab.unpin();
                            None
                        }
                        Some(ab) if ab.pinned => Some(input_value),
                        Some(_) | None => Some(JSValue::ZERO),
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
                            .replace(core::mem::take(string_or_buffer)),
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
                    Self::disarm_on_writable_unless_owed(raw_response, js_this, global_object);
                    JSValue::js_number_from_uint64(written as u64)
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
                    JSValue::js_number((-clamped) as f64)
                }
            }
        })
    }

    pub(crate) fn set_on_writable(
        &self,
        this_value: JSValue,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) {
        // Settable until the response has finished, including while end()'s bytes drain.
        let flags = self.flags.get();
        if flags.intersects(Flags::REQUEST_HAS_COMPLETED | Flags::SOCKET_CLOSED)
            || value.is_undefined_or_null()
        {
            js::on_writable_set_cached(this_value, global_object, JSValue::ZERO);
        } else {
            js::on_writable_set_cached(
                this_value,
                global_object,
                value.with_async_context_if_needed(global_object),
            );
            // A corked write reports WantMore and disarms the drain. The uncork can still leave its bytes in the uWS buffer.
            if self.has_unflushed_write() {
                if let Some(raw_response) = self.writer() {
                    raw_response.on_writable(on_drain_shim, self.as_ctx_ptr());
                }
            }
        }
    }

    pub(crate) fn get_on_writable(&self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        // Only the armed drain callback of a live response: end() and a close leave the slot as it was.
        if self.is_done() {
            return JSValue::UNDEFINED;
        }
        js::on_writable_get_cached(this_value)
            .filter(|callback| callback.is_cell())
            .unwrap_or(JSValue::UNDEFINED)
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

    pub(crate) fn get_upgraded(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(self.flags.get().contains(Flags::UPGRADED))
    }

    fn clear_on_data_callback(&self, this_value: JSValue, global_object: &JSGlobalObject) {
        scoped_log!(NodeHTTPResponse, "clearOnDataCallback");
        // Clear on the wrapper that armed ondata (see on_data): the parameter may
        // be the socket-current wrapper, which is a different pipelined response.
        let armed = self.armed_this_value.replace(JSValue::ZERO);
        let this_value = if armed.is_empty() { this_value } else { armed };
        if self.body_read_state.get() != BodyReadState::None {
            if !this_value.is_empty() {
                js::on_data_set_cached(this_value, global_object, JSValue::UNDEFINED);
            }
            let flags = self.flags.get();
            self.leave_pending(if flags.contains(Flags::SOCKET_CLOSED) {
                BodyReadState::Aborted
            } else if flags.contains(Flags::UPGRADED) {
                BodyReadState::Upgraded
            } else {
                BodyReadState::Detached
            });
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
            || flags.contains(Flags::SOCKET_CLOSED)
            || self.body_read_state.get() != BodyReadState::Pending
            || flags.contains(Flags::UPGRADED)
        {
            js::on_data_set_cached(this_value, global_object, JSValue::UNDEFINED);
            self.armed_this_value.set(JSValue::ZERO);
            if self.leave_pending(BodyReadState::Detached) {
                self.mark_request_as_done_if_necessary();
            }
            return;
        }

        js::on_data_set_cached(
            this_value,
            global_object,
            value.with_async_context_if_needed(global_object),
        );
        self.armed_this_value.set(this_value);
        if let Some(raw_response) = self.reader() {
            raw_response.on_data(on_data_shim, self.as_ctx_ptr());
        }

        // `body_read_ref` is still held from create(): every unref also leaves `.pending`.
        debug_assert!(self.body_read_ref.get().has);
    }

    pub(crate) fn write(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        self.write_or_end::<false, false>(global_object, arguments, callframe.this())
    }

    fn on_auto_flush(&self) -> bool {
        let flags = self.flags.get();
        if !flags.contains(Flags::UPGRADED) && !self.is_socket_closed_or_closing() {
            if let Some(raw_response) = self.writer() {
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
        if !flags.contains(Flags::UPGRADED) && !self.is_socket_closed_or_closing() {
            if let Some(raw_response) = self.writer() {
                // Don't flush immediately; queue a microtask to uncork the socket.
                raw_response.flush_headers(false);
                if raw_response.is_corked() {
                    self.register_auto_flush();
                }
            } else {
                self.record_flush_headers();
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
        self.resume_socket_for_end();
        self.write_or_end::<true, false>(global_object, arguments, callframe.this())
    }

    /// `end` with the framed trailer section of the response as one more argument.
    pub(crate) fn end_with_trailers(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        self.resume_socket_for_end();
        self.write_or_end::<true, true>(global_object, arguments, callframe.this())
    }

    /// `handle.takeRawHeaders()` — this request's captured header section
    /// materialized into the rawHeaders flat [name, value, ...] array, or
    /// undefined when there were no headers (or they were already taken).
    /// Consumes the captured bytes.
    pub(crate) fn take_raw_headers(
        &self,
        global_object: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let section = self.raw_request_headers.replace(Vec::new());
        if section.is_empty() {
            return Ok(JSValue::UNDEFINED);
        }
        bun_jsc::call_zero_is_throw(global_object, || {
            Bun__NodeHTTP__buildRawHeadersArray(global_object, section.as_ptr(), section.len())
        })
    }

    /// `handle.takeRequestTrailers()` — this request's captured trailer section
    /// parsed into a flat [name, value, ...] array, or undefined. Consumes it.
    pub(crate) fn take_request_trailers(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let section = self.request_trailers.replace(Vec::new());
        if section.is_empty() {
            return Ok(JSValue::UNDEFINED);
        }
        // Lenient (insecureHTTPParser) servers accept CTL bytes in trailer values on
        // the wire; parse them with the same leniency so they surface on req.trailers.
        let use_insecure_http_parser = callframe.argument(0).to_boolean();
        bun_jsc::call_zero_is_throw(global_object, || {
            Bun__NodeHTTP__parseRequestTrailers(
                global_object,
                section.as_ptr(),
                section.len(),
                use_insecure_http_parser,
            )
        })
    }

    pub(crate) fn get_bytes_written(
        &self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JSValue {
        JSValue::js_number(self.bytes_written.get() as f64)
    }
}

impl NodeHTTPResponse {
    pub(crate) fn set_timeout(&self, seconds: u8) {
        let flags = self.flags.get();
        let Some(raw) = self.writer() else {
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

    pub(crate) fn finalize(&self) {
        // The JS wrapper is being collected; drop the raw backref so a late
        // body delivery cannot read through a dead cell.
        self.armed_this_value.set(JSValue::ZERO);
        // The record holds no cell of the heap: its JS values are in a slot of the wrapper.
        drop(self.queued_output.replace(None));
    }

    #[inline]
    fn ref_(&self) {
        // SAFETY: `self` is live; only the interior-mutable count is touched.
        unsafe { bun_ptr::RefCount::<Self>::ref_(self.as_ctx_ptr()) };
    }

    #[inline]
    pub(crate) fn deref(&self) {
        // SAFETY: `self` is the live heap allocation; every field is
        // `Cell`/`JsCell`, so `Drop` writes only through interior-mutable
        // storage. Callers do not touch `self` after this when it was the last ref.
        unsafe { bun_ptr::RefCount::<Self>::deref(self.as_ctx_ptr()) };
    }

    /// Hold a ref on `self` for the guard's lifetime (across re-entrant JS).
    #[inline]
    fn ref_guard(&self) -> bun_ptr::RefPtr<Self> {
        // SAFETY: `self` is the live heap allocation.
        unsafe { bun_ptr::RefPtr::init_ref(self.as_ctx_ptr()) }
    }
}

impl Drop for NodeHTTPResponse {
    fn drop(&mut self) {
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

        self.poll_ref.with_mut(|r| r.unref(vm_get()));
        self.body_read_ref.with_mut(|r| r.unref(vm_get()));

        self.promise.with_mut(|p| p.deinit());
    }
}

/// # Safety
/// `response` is the pointer written to `node_response_ptr` by
/// `NodeHTTPResponse__createForJS` earlier in the same dispatch and is live;
/// `data`/`length` describe a caller-owned buffer valid for the call.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn NodeHTTPResponse__adoptRawRequestHeaders(
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
pub(crate) unsafe extern "C" fn NodeHTTPResponse__createForJS(
    any_server_tag: u64,
    global_object: &JSGlobalObject,
    has_body: *mut bool,
    request: *mut uws_sys::Request,
    is_ssl: i32,
    response_ptr: *mut c_void,
    upgrade_ctx: *mut uws_sys::WebSocketUpgradeContext,
    is_current: bool,
    node_response_ptr: *mut *mut NodeHTTPResponse,
) -> JSValue {
    // SAFETY: all pointers are provided by C++ NodeHTTPServer and are live for the call.
    let has_body = unsafe { &mut *has_body };
    // S008: `uws::Request` is an `opaque_ffi!` ZST — safe deref.
    let request_ref = bun_opaque::opaque_deref(request.cast_const());

    let vm = bun_vm_mut(global_object);
    let method = HttpMethod::which(request_ref.method()).unwrap_or(HttpMethod::OPTIONS);
    // Like llhttp, the framing decides, not the method. CONNECT has no body: the parser tunnels every byte after its head.
    if method != HttpMethod::CONNECT {
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

        *has_body = req_len > 0 || request_ref.has_transfer_encoding();
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
        ref_count: bun_ptr::RefCount::init_exact_refs(3),
        upgrade_context: JsCell::new(UpgradeCTX {
            context: upgrade_ctx,
            request,
            sec_websocket_key: Box::default(),
            sec_websocket_protocol: Box::default(),
            sec_websocket_extensions: Box::default(),
        }),
        server: any_server_from_packed(any_server_tag),
        connection: connection::Connection::new(raw_response),
        body_read_state: Cell::new(if *has_body {
            BodyReadState::Pending
        } else {
            BodyReadState::None
        }),
        flags: Cell::new(if is_current {
            Flags::default() | Flags::CURRENT
        } else {
            Flags::default()
        }),
        poll_ref: JsCell::new(jsc::Ref::default()),
        body_read_ref: JsCell::new(jsc::Ref::default()),
        promise: JsCell::new(StrongOptional::empty()),
        request_trailers: JsCell::new(Vec::new()),
        armed_this_value: Cell::new(JSValue::ZERO),
        raw_request_headers: JsCell::new(Vec::new()),
        bytes_written: Cell::new(0),
        pending_pinned_write: Cell::new(PendingPinnedWrite::default()),
        pending_pinned_write_owner: JsCell::new(crate::node::StringOrBuffer::EMPTY),
        auto_flusher: JsCell::new(AutoFlusher::default()),
        queued_output: JsCell::new(None),
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
