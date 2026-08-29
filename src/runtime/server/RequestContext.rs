use core::cell::Cell;
use core::ffi::{c_uint, c_void};
use core::ptr::NonNull;

use bun_sys::FdExt as _;

use bun_core::String as BunString;
use bun_http_types::Method::Method;
use bun_jsc::JsCell;
use bun_ptr::{BackRef, RefPtr, ThisPtr};
use bun_uws::{self as uws, WebSocketUpgradeContext};

use crate::server::jsc::{self, JSGlobalObject, JSValue, JsResult};
use crate::server::{RangeRequest, ServerLike};
use crate::webcore::{
    self as WebCore, AbortSignal, AnyBlob, ByteStream, CookieMap, CookieMapRef, FetchHeaders,
    Request, Response, blob::SizeType as BlobSizeType, body, readable_stream, request, response,
};

/// Q: Why is this needed?
/// A: The dev server needs to attach its own callback when the request is
///    aborted.
///
/// Q: Why can't the dev server just call `.setAbortHandler(...)` then?
/// A: It can't, because that is *already* called by the RequestContext, setting
///    the callback and the user data context pointer.
///
///    If it did, it would *overwrite* the user data context pointer (this
///    is what it did before), causing segfaults.
pub struct AdditionalOnAbortCallback {
    pub cb: fn(*mut c_void),
    pub(crate) data: NonNull<c_void>,
    pub(crate) deref_fn: fn(*mut c_void),
}

impl AdditionalOnAbortCallback {
    pub fn deref(&self) {
        (self.deref_fn)(self.data.as_ptr());
    }
}

// NOTE (transport selection): the response/request handle types vary with
// `(ssl_enabled, http3)`. Stable Rust cannot drive an associated type from a
// const-generic `bool` without specialization, and an early `Transport`
// helper-trait approach forced `where TransportFor<SSL,MUX>: Transport` bounds
// onto every generic that named `RequestContext` (which Rust then *cannot*
// discharge for a generic `const SSL: bool` — only the four concrete combos
// have impls). So instead the `resp` field stores `uws::AnyResponse` (a Copy
// enum over the three concrete handles) and dispatches at runtime — same shape
// as `AnyRequestContext` / `AnyServer`. The const params still pick which
// variant `create()` constructs and gate MUX-specific code paths; `req` is the
// matching `uws::AnyRequest`.

/// Back-reference to a stack-local "should this RequestContext defer its
/// deinit until the JS callback returns" flag. The dispatching frame owns the
/// `Cell<bool>`; `RequestContext` stores a `BackRef` to it (cleared before the
/// frame unwinds), so reads/writes are safe `Cell` ops — no raw `*mut bool`.
pub type DeferDeinitFlag = bun_ptr::BackRef<core::cell::Cell<bool>>;

pub(crate) type ResponseStream<const SSL_ENABLED: bool> =
    crate::webcore::streams::HTTPServerWritable<SSL_ENABLED>;
type ResponseStreamJSSink<const SSL_ENABLED: bool> =
    crate::webcore::streams::HTTPServerWritableJSSink<SSL_ENABLED>;
type OwnedResponseStream<const SSL_ENABLED: bool> =
    crate::webcore::streams::OwnedHTTPServerWritable<SSL_ENABLED>;

/// This pre-allocates up to 2,048 RequestContext structs (several hundred KB
/// per pool).
// Capacity 0 when heap-breakdown is enabled routes every allocation through
// the fallback heap path so the per-type malloc zones can attribute them.
pub(crate) const REQUEST_CONTEXT_POOL_CAPACITY: usize = if bun_alloc::heap_breakdown::ENABLED {
    0
} else {
    2048
};

pub type RequestContextStackAllocator<
    ThisServer,
    const SSL: bool,
    const DBG: bool,
    const MUX: bool,
> = bun_collections::hive_array::Fallback<
    RequestContext<ThisServer, SSL, DBG, MUX>,
    REQUEST_CONTEXT_POOL_CAPACITY,
>;

#[derive(Clone, Copy)]
pub(crate) enum UpgradeState {
    /// Plain HTTP request.
    None,
    /// WebSocket handshake waiting for `server.upgrade()`. uWS owns the
    /// context (one per `.ws()` route) and it outlives the request.
    Pending(NonNull<WebSocketUpgradeContext>),
    /// `server.upgrade()` handed the socket over to a `ServerWebSocket`.
    Upgraded,
}

/// Pool-allocated (the server's `RequestContextStackAllocator`) and
/// intrusively refcounted; the last ref returns the slot (`destroy`). Every
/// ref is a `RefPtr` held in a named slot: [`in_flight`](Self::in_flight) for
/// the open response, the `NativePromiseContext` cell
/// ([`promise_cell`](Self::promise_cell)) for a parked handler promise, [`body_value_ref`](Self::body_value_ref),
/// [`byte_stream_ref`](Self::byte_stream_ref), [`s3_stat_ref`](Self::s3_stat_ref),
/// `SavedRequest`'s (through `AnyRequestContext::ref_`), and the guard each
/// callback entry holds for its frame.
///
/// `align(16)`: `NativePromiseContext`'s deferred-deref task packs a 4-bit
/// type tag into the low bits of a pointer to this.
#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = Self::destroy)]
#[repr(align(16))]
pub struct RequestContext<
    ThisServer: ServerLike + 'static,
    const SSL_ENABLED: bool,
    const DEBUG_MODE: bool,
    const MUX: bool,
> {
    /// BACKREF to the embedding `Server` — the server owns this request
    /// context (allocated from its `HiveArray` pool) and outlives it, so the
    /// pointee is live for the holder's entire lifetime. `None` once detached.
    pub(crate) server: Cell<Option<BackRef<ThisServer, bun_ptr::Mut>>>,
    pub(crate) resp: Cell<Option<uws::AnyResponse>>,
    /// The uWS request, while the dispatching frame that owns it is on the stack.
    pub(crate) req: Cell<Option<uws::AnyRequest>>,
    pub(crate) request_weakref: JsCell<request::WeakRef>,
    // NOTE: `Arc<AbortSignal>` was wrong —
    // `AbortSignal` is an opaque ZST FFI handle; an `Arc` of a ZST never owns
    // the C++ allocation. Store the raw pointer. The request holds TWO counts:
    // the intrusive C++ `RefPtr` (+1 from `AbortSignal::new()`/`ref_()`) and a
    // pending-activity count for GC visibility. Both are released together via
    // `shim::signal_release` in `on_abort`/`finalize_without_deinit`.
    pub(crate) signal: Cell<Option<NonNull<AbortSignal>>>,
    pub method: Method,
    /// Owned `+1` ref on a C++ `CookieMap` (taken in `set_cookies`, released
    /// when the field is dropped/replaced — `CookieMapRef` handles the unref).
    pub(crate) cookies: JsCell<Option<CookieMapRef>>,

    pub(crate) flags: Flags<DEBUG_MODE>,

    pub(crate) upgrade_context: Cell<UpgradeState>,

    /// We can only safely free once the request body promise is finalized
    /// and the response is rejected
    // Deliberately a bare JSValue with manual protect()/unprotect() gated by
    // the `response_protected` flag: plain Blob/InternalBlob
    // bodies intentionally leave the value unprotected on the hot path and
    // fall back to `response_weakref` (see its doc below), so a `Strong`
    // here would root the Response unconditionally and change GC behavior.
    pub(crate) response_jsvalue: Cell<JSValue>,
    /// This slot's own root pointer, recorded at creation so `&self` methods
    /// can hand a `ThisPtr<Self>` to the callbacks they register.
    root: Cell<Option<BackRef<Self, bun_ptr::Root>>>,
    pub(crate) ref_count: Cell<u32>,
    pub(crate) pin_count: Cell<u8>,
    /// The ref the open response holds on this context: taken at creation,
    /// released when the response is ended, aborted or handed off
    /// (`release_in_flight`).
    in_flight: Cell<Option<RefPtr<Self>>>,
    /// The ref a `Body::ReceiveValue::Server` registration holds while this
    /// context waits for a pending response body; released by
    /// `render_pending_body_value`.
    body_value_ref: Cell<Option<RefPtr<Self>>>,
    /// The ref the natively piped response body (`byte_stream`) holds; released
    /// by `end_chunk`, or by `on_abort` when the pipe can no longer finish.
    byte_stream_ref: Cell<Option<RefPtr<Self>>>,
    /// The ref an in-flight `S3::client::stat` (HEAD on an S3 body) holds;
    /// released by `on_s3_size_resolved`.
    s3_stat_ref: Cell<Option<RefPtr<Self>>>,

    /// Weak: for plain Blob/InternalBlob bodies the Response JSValue is
    /// not protected (hot path), so GC may finalize it while we're parked
    /// on tryEnd() backpressure. onAbort / handleResolveStream /
    /// handleRejectStream only use this for best-effort readable-stream
    /// cleanup and safely observe null instead of UAF. File/.Locked
    /// bodies still protect() response_jsvalue, so the pointer stays
    /// valid for renderMetadata() on those paths.
    pub(crate) response_weakref: JsCell<response::WeakRef>,
    pub(crate) blob: JsCell<AnyBlob>,

    pub(crate) sendfile: Cell<SendfileContext>,
    pub(crate) range: RangeRequest::Raw,

    pub(crate) request_body_readable_stream_ref: JsCell<readable_stream::Strong>,
    /// Owning `+1` handle into the per-VM `Body::Value` hive pool. Shared with
    /// `Request.body` (each holds its own `+1`). `Drop` releases the count.
    pub(crate) request_body: JsCell<Option<body::BodyHiveHandle>>,
    pub(crate) request_body_buf: JsCell<Vec<u8>>,
    pub(crate) request_body_content_len: Cell<usize>,
    /// Total bytes forwarded to the request-body `ReadableStream`. The
    /// up-front `maxRequestBodySize` check only sees Content-Length, so
    /// chunked / H3 bodies consumed as a stream are capped against this.
    pub(crate) request_body_streamed_len: Cell<usize>,

    /// The streaming-response sink, from `do_render_stream` until a settle
    /// path, `discard_stream_after_abort` or `teardown` destroys it. The JS
    /// controller holds its address until `JSSink::detach`.
    pub sink: JsCell<Option<OwnedResponseStream<SSL_ENABLED>>>,
    /// The `ByteStream` a native response body is piped from; kept alive by
    /// `response_body_readable_stream_ref`.
    pub(crate) byte_stream: Cell<Option<BackRef<ByteStream>>>,
    /// This keeps the Response body's ReadableStream alive.
    pub(crate) response_body_readable_stream_ref: JsCell<readable_stream::Strong>,

    /// Used in errors
    pub(crate) pathname: JsCell<bun_core::String>,

    /// Used either for temporary blob data or fallback
    /// When the response body is a temporary value
    pub(crate) response_buf_owned: JsCell<Vec<u8>>,

    /// Defer finalization until after the request handler task is completed?
    ///
    /// BORROW_PARAM: points at a `Cell<bool>` on the dispatching frame's
    /// stack. `BackRef` encodes the outlives-holder invariant (the field is
    /// always cleared before that frame returns) so reads/writes are safe
    /// `Cell::get`/`set` instead of raw `*mut bool` deref.
    pub(crate) defer_deinit_until_callback_completes: Cell<Option<DeferDeinitFlag>>,

    pub(crate) additional_on_abort: JsCell<Option<AdditionalOnAbortCallback>>,

    /// The `NativePromiseContext` cell that owns a ref on this context for a
    /// parked promise reaction, or `ZERO`. Not visited by GC: the promise
    /// reaction keeps the cell alive, and the cell's destructor clears this
    /// field before the value can dangle. `on_abort` reclaims the ref through
    /// it so an aborted request is torn down without waiting for GC.
    promise_cell: Cell<JSValue>,
    // TODO: support builtin compression
}

/// Keeps a [`RequestContext`] alive across a callback frame without counting
/// as a holder in `should_render_missing` / `is_dead_request` (which ask
/// whether anything *other than the current frame* still needs the context).
struct Pin<ThisServer, const SSL: bool, const DBG: bool, const MUX: bool>(
    RefPtr<RequestContext<ThisServer, SSL, DBG, MUX>>,
)
where
    ThisServer: ServerLike + 'static;

impl<ThisServer, const SSL: bool, const DBG: bool, const MUX: bool> Pin<ThisServer, SSL, DBG, MUX>
where
    ThisServer: ServerLike + 'static,
{
    #[inline]
    fn new(this: ThisPtr<RequestContext<ThisServer, SSL, DBG, MUX>>) -> Self {
        this.pin_count.set(this.pin_count.get() + 1);
        Self(RefPtr::from_this(this))
    }
}

impl<ThisServer, const SSL: bool, const DBG: bool, const MUX: bool> Drop
    for Pin<ThisServer, SSL, DBG, MUX>
where
    ThisServer: ServerLike + 'static,
{
    #[inline]
    fn drop(&mut self) {
        self.0.pin_count.set(self.0.pin_count.get() - 1);
    }
}

impl<ThisServer, const SSL_ENABLED: bool, const DEBUG_MODE: bool, const MUX: bool>
    RequestContext<ThisServer, SSL_ENABLED, DEBUG_MODE, MUX>
where
    ThisServer: ServerLike + 'static,
{
    pub(crate) const IS_MUX: bool = MUX;

    /// This context as the `ThisPtr` its callbacks are registered with.
    #[inline]
    pub(crate) fn this(&self) -> ThisPtr<Self> {
        self.root
            .get()
            .expect("RequestContext root not recorded")
            .this_ptr()
    }

    #[inline]
    fn pin(this: ThisPtr<Self>) -> Pin<ThisServer, SSL_ENABLED, DEBUG_MODE, MUX> {
        Pin::new(this)
    }

    /// Release the open response's ref (see [`in_flight`](Self::in_flight)).
    /// The caller's frame holds its own ref, so this never frees `self`.
    #[inline]
    pub(crate) fn release_in_flight(&self) {
        drop(self.in_flight.take());
    }

    pub(crate) fn memory_cost(&self) -> usize {
        // The sink's buffer and the ByteStream aren't counted here.
        core::mem::size_of::<Self>()
            + self.request_body_buf.get().capacity()
            + self.response_buf_owned.get().capacity()
            + self.blob.get().memory_cost()
    }

    #[inline]
    pub(crate) fn is_async(&self) -> bool {
        self.defer_deinit_until_callback_completes.get().is_none()
    }

    /// The server's `DevServer`, which it keeps for as long as it has requests.
    pub(crate) fn dev_server(&self) -> Option<BackRef<crate::bake::DevServer::DevServer>> {
        let server = self.server.get()?;
        server.dev_server().map(BackRef::new)
    }
}

// ─── per-request state machine bodies ────────────────────────────────────────
// Everything below until the helper structs at the bottom is the request
// state machine: render(), on_abort(), on_resolve(), do_render_*, sendfile,
// stream handling, error handling.
use crate::node::types::PathLikeExt as _;
use crate::server::jsc::CallFrame;
use crate::server::{AnyRequestContext, FileResponseStream, HTTPStatusText, file_response_stream};
use crate::webcore::blob::BlobExt as _;
use crate::webcore::{Blob, ReadableStream, body as Body, s3 as S3};
use bun_collections::VecExt;
use bun_core::Output;
use bun_core::strings;
use bun_http_types as HTTP;
use bun_http_types::MimeType::MimeType;
use bun_jsc::SysErrorJsc as _;
use bun_jsc::native_promise_context;
use bun_paths::PathBuffer;
use std::io::Write as _;

/// The `Response` payload of the JS wrapper `value`, or `None` if it is not a
/// `Response`. The pointer is the wrapper allocation's root (what
/// `set_response`'s `WeakPtr` needs); it is valid while `value` is GC-rooted
/// (ensure_still_alive / protect()), which callers arrange for as long as
/// they use it.
#[inline]
fn as_response(value: JSValue) -> Option<ThisPtr<Response>> {
    value.as_class_this_ptr::<Response>()
}

// ─── sibling-subtree shims ───────────────────────────────────────────────────
// These forward to methods that exist in webcore/ but are currently inside
// impl blocks that fail to compile (codegen gc-slot stubs, opaque AbortSignal).
// Adapt on this side per phase-d rules.
mod shim {
    use super::*;

    #[inline]
    pub(super) fn response_body_stream(r: &Response) -> Option<ReadableStream> {
        r.get_body_readable_stream()
    }
    #[inline]
    pub(super) fn response_detach_stream(r: &Response, g: &JSGlobalObject) {
        r.detach_readable_stream(g)
    }
    #[inline]
    pub(super) fn signal_aborted(s: NonNull<AbortSignal>) -> bool {
        // `signal` is kept alive by the intrusive C++ refcount (+1 from
        // `AbortSignal::new()` / `ref_()`) plus `pending_activity_ref()` until
        // `signal_release` drops both — satisfies the `BackRef` outlives-holder
        // invariant for the duration of this call.
        bun_ptr::BackRef::from(s).aborted()
    }
    #[inline]
    pub(super) fn signal_fire(
        s: NonNull<AbortSignal>,
        g: &JSGlobalObject,
        r: jsc::CommonAbortReason,
    ) {
        // See `signal_aborted` — counted ref keeps pointee live.
        bun_ptr::BackRef::from(s).signal(g, r)
    }
    /// Release BOTH refcounts the request holds on its AbortSignal.
    /// `pending_activity_unref()` drops the GC-visibility count and `unref()`
    /// drops the intrusive C++ `RefPtr` count taken at creation. `s` must not
    /// be dereferenced after this call.
    #[inline]
    pub(super) fn signal_release(s: NonNull<AbortSignal>) {
        // See `signal_aborted`. Order: pending-activity first,
        // then the owning intrusive ref (which may free). `BackRef` is dropped
        // before `unref()` returns, so no dangling deref.
        let signal = bun_ptr::BackRef::from(s);
        signal.pending_activity_unref();
        signal.unref();
    }
    /// `Blob::is_s3()` / `Blob::needs_to_read_file()` have duplicate impls
    /// (E0034); inline the body here.
    #[inline]
    pub(super) fn blob_is_s3(b: &Blob) -> bool {
        b.store
            .get()
            .as_ref()
            .is_some_and(|s| matches!(s.data, crate::webcore::blob::store::Data::S3(_)))
    }
    #[inline]
    pub(super) fn blob_needs_to_read_file(b: &Blob) -> bool {
        b.store
            .get()
            .as_ref()
            .is_some_and(|s| matches!(s.data, crate::webcore::blob::store::Data::File(_)))
    }
    /// The response is done with its natively piped body. A body still mid-stream is
    /// cancelled: it stayed locked to this response, so nothing else can read it.
    #[inline]
    pub(super) fn byte_stream_unpipe(s: BackRef<ByteStream>) {
        // The caller has just `take()`n `self.byte_stream` and still holds
        // `response_body_readable_stream_ref`, which keeps the pointee alive.
        s.detach_finished_sink()
    }
}
use crate::server::DevErrorPage;

bun_core::declare_scope!(RequestContext, visible);
bun_core::declare_scope!(ReadableStream, visible);

macro_rules! ctx_log { ($($t:tt)*) => { bun_core::scoped_log!(RequestContext, $($t)*) }; }
macro_rules! stream_log { ($($t:tt)*) => { bun_core::scoped_log!(ReadableStream, $($t)*) }; }

/// Per-monomorphization C-ABI shim table for the four promise-reaction host
/// fns. The value passed to `then_with_value` must be identical to the
/// `Bun__HTTPRequestContext*__on*` symbol that C++'s
/// `GlobalObject::promiseHandlerID` compares against.
///
/// The `#[no_mangle]` exports cannot live on a generic fn, so they are
/// emitted as concrete wrappers by `request_ctx_exports!` below (through
/// `bun_jsc::jsc_promise_handler!`). This impl points at those *exported*
/// wrappers, so `Self::ON_RESOLVE` and the C++ side agree on the
/// function-pointer identity and `promiseHandlerID` resolves.
///
/// NOTE (layering): expressed as a trait (not inherent consts) so
/// downstream `where`-clauses that already name it keep type-checking.
pub trait RequestContextHostFns {
    const ON_RESOLVE: bun_jsc::JSHostFn;
    const ON_REJECT: bun_jsc::JSHostFn;
    const ON_RESOLVE_STREAM: bun_jsc::JSHostFn;
    const ON_REJECT_STREAM: bun_jsc::JSHostFn;
}

impl<ThisServer, const SSL: bool, const DBG: bool, const MUX: bool> RequestContextHostFns
    for RequestContext<ThisServer, SSL, DBG, MUX>
where
    ThisServer: ServerLike + 'static,
{
    // These consts must resolve to the *exported* `#[no_mangle]` symbols
    // (`Bun__HTTPRequestContext*__on*`), not the generic `on_*::<..>` bodies:
    // the function-pointer value is what C++'s
    // `GlobalObject::promiseHandlerID` compares against (ZigGlobalObject.cpp),
    // and the exported wrapper has a different address from the generic it
    // forwards to. We route through a const-fn lookup keyed on the
    // (SSL, DEBUG, MUX) tuple so the blanket impl can name concrete exports.
    const ON_RESOLVE: bun_jsc::JSHostFn = exported_host_fns(SSL, DBG, MUX).0;
    const ON_REJECT: bun_jsc::JSHostFn = exported_host_fns(SSL, DBG, MUX).1;
    const ON_RESOLVE_STREAM: bun_jsc::JSHostFn = exported_host_fns(SSL, DBG, MUX).2;
    const ON_REJECT_STREAM: bun_jsc::JSHostFn = exported_host_fns(SSL, DBG, MUX).3;
}

impl<ThisServer, const SSL_ENABLED: bool, const DEBUG_MODE: bool, const MUX: bool>
    RequestContext<ThisServer, SSL_ENABLED, DEBUG_MODE, MUX>
where
    ThisServer: ServerLike + 'static,
{
    /// The owning server. `server` is a BACKREF (LIFETIMES.tsv): set at
    /// construction from the `NewServer` that owns the request pool, never
    /// null while the `RequestContext` is live, and the server outlives every
    /// `RequestContext` it allocates. Returned by value (it is `Copy`) so
    /// callers may keep using it past calls that end or recycle this context.
    #[inline]
    pub(crate) fn server(&self) -> BackRef<ThisServer, bun_ptr::Mut> {
        self.server.get().expect("infallible: server bound")
    }

    /// The pooled request-body slot, if attached. Shared with `Request.body`;
    /// keep `with_mut` borrows short and off any path that reaches the slot
    /// again (`end_request_streaming`).
    #[inline]
    fn request_body_slot(&self) -> Option<&JsCell<Body::Value>> {
        self.request_body.get().as_deref()
    }

    /// The streaming-response sink (see [`sink`](Self::sink)).
    #[inline]
    fn sink(&self) -> Option<&JsCell<ResponseStream<SSL_ENABLED>>> {
        self.sink.get().as_deref()
    }

    /// The tracked `Response`, unless GC already finalized it.
    #[inline]
    fn response(&self) -> Option<&Response> {
        self.response_weakref.get().get_ref()
    }

    #[inline]
    fn request(&self) -> Option<&Request> {
        self.request_weakref.get().get_ref()
    }

    /// Take the pooled request-body slot out of `self`; the handle's `Drop`
    /// releases the `+1`.
    #[inline]
    fn request_body_take_unref(&self) {
        drop(self.request_body.replace(None));
    }

    /// The dispatching frame arms the request body it will feed through
    /// `on_buffered_body_chunk`.
    pub(crate) fn set_pending_request_body(&self, pending: Body::PendingValue) {
        self.request_body_slot()
            .expect("request_body attached at creation")
            .set(Body::Value::Locked(pending));
    }

    pub(crate) fn set_signal_aborted(&self, reason: jsc::CommonAbortReason) {
        if let Some(signal) = self.signal.get() {
            if let Some(server) = self.server.get() {
                // server is a BACKREF — valid while this RequestContext is alive
                let global = server.global_this();
                shim::signal_fire(signal, global, reason);
            }
        }
    }

    /// The microtask checkpoint after a synchronously dispatched handler. `Err`: the VM has stopped; the
    /// caller leaves the request where it is and the stop closes the server's connections.
    fn drain_microtasks(&self) -> Result<(), bun_jsc::Stopped> {
        let Some(server) = self.server.get() else {
            return Ok(());
        };
        if self.is_async() {
            return Ok(());
        }
        server.vm().as_mut().event_loop_mut().drain_microtasks()
    }

    /// Runs `on_abort` itself (may free `self`) if a nested event loop run already closed the socket.
    pub(crate) fn set_abort_handler(&self) {
        if self.flags.has_abort_handler() {
            return;
        }
        let Some(resp) = self.resp.get() else {
            return;
        };
        self.flags.set_has_abort_handler(true);
        if resp.is_closed() {
            // `req` is still set only while the dispatch is on the stack: snapshot as `to_async` would have.
            if let (Some(req), Some(request)) = (self.req.get(), self.request()) {
                self.to_async_without_abort_handler(req, request);
            }
            Self::on_abort(self.this(), resp);
            return;
        }
        resp.on_aborted_this(Self::on_abort, self.this());
    }

    pub(crate) fn set_cookies(&self, cookie_map: Option<*mut CookieMap>) {
        // S008: `CookieMap` is an `opaque_ffi!` ZST — safe `*const → &` deref.
        // `new_ref` takes a ref for storage. Replacing drops (and so unrefs)
        // the old one.
        drop(self.cookies.replace(
            cookie_map.map(|p| CookieMapRef::new_ref(bun_opaque::opaque_deref(p.cast_const()))),
        ));
    }

    pub(crate) fn on_resolve(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        ctx_log!("onResolve");

        let arguments = callframe.arguments_as_array::<2>();
        let Some(claim) = native_promise_context::take::<Self>(arguments[1]) else {
            // A termination path (abort, end, upgrade) reclaimed the cell's
            // ref; the context may already be gone.
            Self::discard_response_body(global, arguments[0]);
            return Ok(JSValue::UNDEFINED);
        };
        let ctx = claim.this_ptr();
        let _claim = claim;
        ctx.promise_cell.set(JSValue::ZERO);

        let result = arguments[0];
        result.ensure_still_alive();

        ctx.handle_resolve(global, result);
        Ok(JSValue::UNDEFINED)
    }

    /// Cancel the body stream of a Response the server will not transmit.
    fn cancel_unread_body(response: &Response, global_this: &JSGlobalObject) {
        if let Some(stream) = response.get_body_readable_stream() {
            let _keep = jsc::EnsureStillAlive(stream.value);
            response.detach_readable_stream(global_this);
            // Not `cancel()`: it skips a stream with no reader, which an unattached body is.
            crate::dispatch::fold(stream.cancel_with_reason(global_this, JSValue::UNDEFINED));
        }
        *response.get_body_value() = Body::Value::Used;
    }

    /// [`Self::cancel_unread_body`] for a rooted handler result: a `Response` or a settled promise of one.
    fn discard_response_body(global_this: &JSGlobalObject, value: JSValue) {
        let value = match value.as_any_promise() {
            Some(promise) => {
                match promise.unwrap(global_this.vm(), jsc::PromiseUnwrapMode::MarkHandled) {
                    jsc::PromiseResult::Fulfilled(fulfilled) => fulfilled,
                    jsc::PromiseResult::Pending | jsc::PromiseResult::Rejected(_) => return,
                }
            }
            None => value,
        };
        if let Some(response) = response::from_js_ref(value) {
            Self::cancel_unread_body(response.get(), global_this);
        }
        value.ensure_still_alive();
    }

    /// [`Self::discard_response_body`] for a request this context can no longer respond to.
    fn discard_handler_result(&self, global_this: &JSGlobalObject, result: JSValue) {
        let Some(promise) = result.as_any_promise() else {
            Self::discard_response_body(global_this, result);
            return;
        };
        match promise.unwrap(global_this.vm(), jsc::PromiseUnwrapMode::MarkHandled) {
            // Only while `resp` is held: the `on_abort` that follows then reclaims the cell.
            jsc::PromiseResult::Pending if self.resp.get().is_some() => {
                let cell = self.create_promise_cell(global_this);
                result.then_with_value(global_this, cell, Self::ON_RESOLVE, Self::ON_REJECT);
            }
            jsc::PromiseResult::Pending | jsc::PromiseResult::Rejected(_) => {}
            jsc::PromiseResult::Fulfilled(fulfilled) => {
                Self::discard_response_body(global_this, fulfilled);
            }
        }
    }

    fn render_missing_invalid_response(&self, value: JSValue) {
        let class_name = value.get_class_info_name().unwrap_or(b"");

        if let Some(server) = self.server.get() {
            // server is a BACKREF — valid while this RequestContext is alive
            let global_this: &JSGlobalObject = server.global_this();

            Output::enable_buffering();
            let writer = Output::error_writer();

            if class_name == b"Response" {
                bun_core::err_generic!(
                    "Expected a native Response object, but received a polyfilled Response object. Bun.serve() only supports native Response objects.",
                );
            } else if !value.is_empty() && !global_this.has_exception() {
                let mut formatter = jsc::ConsoleObject::Formatter::new(global_this);
                formatter.quote_strings = true;
                bun_core::err_generic!(
                    "Expected a Response object, but received '{}'",
                    jsc::console_object::formatter::ZigFormatter::new(&mut formatter, value),
                );
                // `formatter` drops here.
            } else {
                bun_core::err_generic!("Expected a Response object");
            }

            Output::flush();
            if !global_this.has_exception() {
                jsc::ConsoleObject::write_trace(writer, global_this);
            }
            Output::flush();
        }
        // The formatter and `write_trace` above re-enter JS (getters, proxy
        // traps, Error.prepareStackTrace), which can synchronously abort or
        // end this request (e.g. AbortController.abort() inside a getter).
        // The ref the caller's frame holds (`on_resolve`'s claim) keeps the
        // allocation alive across the re-entry; re-check the request state so
        // we never render onto a response that was ended underneath us.
        if self.is_aborted_or_ended() {
            return;
        }
        self.render_missing();
    }

    fn handle_resolve(&self, global_this: &JSGlobalObject, value: JSValue) {
        if self.is_aborted_or_ended() || self.did_upgrade_web_socket() {
            Self::discard_response_body(global_this, value);
            return;
        }

        if value.is_empty_or_undefined_or_null() || !value.is_cell() {
            self.render_missing_invalid_response(value);
            return;
        }

        let Some(response) = as_response(value) else {
            self.render_missing_invalid_response(value);
            return;
        };
        // `value` is rooted by the caller's frame and protect()'d below.
        if self.reject_unsendable_response(response.status_code()) {
            return;
        }
        // An async error() Response may replace a still-protected streaming
        // Response; release the original before overwriting.
        if self.flags.response_protected() {
            self.response_jsvalue.get().unprotect();
            self.flags.set_response_protected(false);
        }
        self.response_jsvalue.set(value);
        self.flags.set_response_protected(true);
        value.protect();

        if self.method == Method::HEAD {
            if let Some(resp) = self.resp.get() {
                resp.corked(|| self.do_render_head_response(response));
            }
            return;
        }

        self.render(response);
    }

    #[inline]
    fn unpinned_ref_count(&self) -> u32 {
        self.ref_count.get() - u32::from(self.pin_count.get())
    }

    pub(crate) fn should_render_missing(&self) -> bool {
        // If we did not respond yet, we should render missing
        // To allow this all the conditions above should be true:
        // 1 - still has a response (not detached, socket still open)
        // 2 - not aborted
        // 3 - not marked completed
        // 4 - not marked pending
        // 5 - is the only reference of the context
        // 6 - is not waiting for request body
        // 7 - did not call sendfile
        ctx_log!(
            "RequestContext(0x{:x}).shouldRenderMissing {} {} {} {} {} {} {}",
            std::ptr::from_ref(self) as usize,
            if self.resp.get().is_some() {
                "has response"
            } else {
                "no response"
            },
            if self.flags.aborted() {
                "aborted"
            } else {
                "not aborted"
            },
            if self.flags.has_marked_complete() {
                "marked complete"
            } else {
                "not marked complete"
            },
            if self.flags.has_marked_pending() {
                "marked pending"
            } else {
                "not marked pending"
            },
            if self.unpinned_ref_count() == 1 {
                "only reference"
            } else {
                "not only reference"
            },
            if self.flags.is_waiting_for_request_body() {
                "waiting for request body"
            } else {
                "not waiting for request body"
            },
            if self.flags.has_sendfile_ctx() {
                "has sendfile context"
            } else {
                "no sendfile context"
            },
        );
        self.resp.get().is_some_and(|resp| !resp.is_closed())
            && !self.flags.aborted()
            && !self.flags.has_marked_complete()
            && !self.flags.has_marked_pending()
            && self.unpinned_ref_count() == 1
            && !self.flags.is_waiting_for_request_body()
            && !self.flags.has_sendfile_ctx()
    }

    pub(crate) fn is_dead_request(&self) -> bool {
        // check if has pending promise or extra reference (aka not the only reference)
        if self.unpinned_ref_count() > 1 {
            return false;
        }
        // check if the body is Locked (streaming)
        if let Some(body) = self.request_body_slot() {
            if matches!(body.get(), Body::Value::Locked(_)) {
                return false;
            }
        }

        true
    }

    /// Everything the last ref's release does short of returning the slot,
    /// which is the caller's to do with the server this returns. `None`: the
    /// dispatching frame is still on the stack (`defer_deinit_until_callback_completes`)
    /// and finishes the job through [`deinit`](Self::deinit) once its callback
    /// returns, or the slot was already returned.
    fn teardown(&self) -> Option<BackRef<ThisServer, bun_ptr::Mut>> {
        ctx_log!("deinit");
        self.detach_response();
        self.end_request_streaming_and_drain();
        // TODO: has_marked_complete is doing something?
        self.flags.set_has_marked_complete(true);

        if let Some(defer_deinit) = self.defer_deinit_until_callback_completes.get() {
            defer_deinit.set(true);
            ctx_log!("deferred deinit <d> ({:p})<r>", self);
            return None;
        }

        ctx_log!("deinit<d> ({:p})<r>", self);
        debug_assert!(self.flags.has_finalized());

        // A response body stream suspended inside its `pull()` never settles the promise
        // whose reactions consume the sink (`handleResolveStream` / `handleRejectStream`),
        // so a client abort in that state reaches deinit with the sink still owned here.
        // This is the owner's last exit: release it exactly like the settle paths do.
        if let Some(sink) = self.sink.replace(None) {
            let sink_global = sink.with_mut(|sink| {
                sink.finalize();
                sink.global_this
            });
            if let Some(sink_global) = sink_global {
                sink.with_mut(|sink| {
                    ResponseStreamJSSink::<SSL_ENABLED>::detach(&mut sink.source, &sink_global)
                });
            }
            ResponseStream::destroy(sink);
        }

        self.request_body_buf.set(Vec::new());
        self.response_buf_owned.set(Vec::new());
        self.response_weakref.set(response::WeakRef::EMPTY);

        self.request_body_take_unref();

        if let Some(cb) = self.additional_on_abort.replace(None) {
            cb.deref();
        }

        self.server.take()
    }

    fn release(this: NonNull<Self>, server: BackRef<ThisServer, bun_ptr::Mut>) {
        server.release_request_context(this.as_ptr().cast::<c_void>(), MUX);
        ThisServer::on_request_complete(server);
    }

    /// The dispatching frame's deferred teardown (its
    /// `defer_deinit_until_callback_completes` flag came back set): the last
    /// ref was released during the callback, so finish releasing the context.
    pub(crate) fn deinit(this: ThisPtr<Self>) {
        debug_assert_eq!(this.ref_count.get(), 0);
        if let Some(server) = this.get().teardown() {
            Self::release(this.into(), server);
        }
    }

    /// `CellRefCounted` destructor: the last ref was released.
    ///
    /// # Safety
    /// Called only by the generated `CellRefCounted::destroy` with the
    /// allocation root of a context whose refcount just reached zero.
    unsafe fn destroy(this: *mut Self) {
        // SAFETY: forwarded from the fn contract.
        unsafe {
            bun_ptr::destroy_with(
                this,
                |ctx| {
                    ctx.finalize_without_deinit();
                    ctx.teardown()
                },
                |ctx, server| {
                    if let Some(server) = server {
                        Self::release(ctx, server);
                    }
                },
            );
        }
    }

    /// A new `NativePromiseContext` cell owning a ref on this context,
    /// remembered in `promise_cell`. The settle reactions (`take()` + a field
    /// clear), `on_abort` (`reclaim_promise_cell`), or the cell's destructor
    /// release it.
    fn create_promise_cell(&self, global: &JSGlobalObject) -> JSValue {
        debug_assert!(self.promise_cell.get().is_empty());
        let cell =
            native_promise_context::create(global, RefPtr::from_this(self.this()), JSValue::ZERO);
        self.promise_cell.set(cell);
        cell
    }

    /// Called from the cell's destructor (GC sweep) when its ref was never
    /// taken: the release is deferred (or skipped at VM teardown), but the field
    /// must stop pointing at the dying cell now. A plain field write, safe
    /// during sweep.
    pub(crate) fn promise_cell_collected(&self) {
        self.promise_cell.set(JSValue::ZERO);
    }

    /// Once the response is detached or ended, the promise this context
    /// subscribed to can no longer do anything for the request. Reclaim the
    /// cell's ref so the context is torn down now instead of when GC
    /// collects the promise; the settle reactions then see a null `take()`
    /// and no-op. A no-op when no cell is outstanding (the common case on
    /// paths reached from a settle reaction, which already cleared the field).
    pub(crate) fn reclaim_promise_cell(&self) {
        let cell = self.promise_cell.replace(JSValue::ZERO);
        if !cell.is_empty()
            && let Some(claim) = native_promise_context::take::<Self>(cell)
        {
            drop(claim);
        }
    }

    pub(crate) fn on_reject(_global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        ctx_log!("onReject");

        let arguments = callframe.arguments_as_array::<2>();
        let Some(claim) = native_promise_context::take::<Self>(arguments[1]) else {
            // A termination path (abort, end, upgrade) reclaimed the cell's
            // ref; the context may already be gone.
            return Ok(JSValue::UNDEFINED);
        };
        let ctx = claim.this_ptr();
        let _claim = claim;
        ctx.promise_cell.set(JSValue::ZERO);

        let err = arguments[0];
        // Pass the rejection reason through verbatim (including `null` and
        // `undefined`) so `error()` sees the same value the already-settled
        // path delivers. Only an empty JSValue is normalized.
        ctx.handle_reject(if err.is_empty() {
            JSValue::UNDEFINED
        } else {
            err
        });
        Ok(JSValue::UNDEFINED)
    }

    fn handle_reject(&self, value: JSValue) {
        if self.is_aborted_or_ended() {
            return;
        }

        let resp = self.resp.get().expect("infallible: resp bound");
        let has_responded = resp.has_responded();

        // The status line is already committed (a direct stream's pull() threw
        // synchronously after the headers were written): report and close.
        if !has_responded && self.flags.has_written_status() {
            if !value.is_empty_or_undefined_or_null()
                && let Some(server) = self.server.get()
            {
                server.vm().as_mut().run_error_handler(value, None);
            }
            self.close_incomplete_stream();
            return;
        }

        if !has_responded {
            let original_state = self.defer_deinit_until_callback_completes.get();
            let should_deinit_context = core::cell::Cell::new(match original_state {
                // BackRef::get() → &Cell<bool>; second .get() reads the bool.
                Some(defer_deinit) => defer_deinit.get().get(),
                None => false,
            });
            self.defer_deinit_until_callback_completes
                .set(Some(bun_ptr::BackRef::new(&should_deinit_context)));
            self.run_error_handler(value);
            self.defer_deinit_until_callback_completes
                .set(original_state);
            // we try to deinit inside runErrorHandler so we just return here and let it deinit
            if should_deinit_context.get() {
                Self::deinit(self.this());
                return;
            }
        }
        // check again in case it get aborted after runErrorHandler
        if self.is_aborted_or_ended() {
            return;
        }

        // I don't think this case happens?
        if self.did_upgrade_web_socket() {
            return;
        }

        if !resp.has_responded()
            && !self.flags.has_marked_pending()
            && !self.flags.is_error_promise_pending()
        {
            self.render_missing();
            return;
        }
    }

    pub(crate) fn render_missing(&self) {
        if let Some(resp) = self.resp.get() {
            resp.corked(|| self.render_missing_corked());
        }
    }

    fn render_missing_corked(&self) {
        let ctx = self;
        if let Some(resp) = ctx.resp.get() {
            if !DEBUG_MODE {
                if !ctx.flags.has_written_status() {
                    resp.write_status(b"204 No Content");
                }
                ctx.flags.set_has_written_status(true);
                ctx.end(b"", ctx.should_close_connection());
                return;
            }
            // avoid writing the status again and mismatching the content-length
            if ctx.flags.has_written_status() {
                ctx.end(b"", ctx.should_close_connection());
                return;
            }

            if ctx.flags.is_web_browser_navigation() {
                resp.write_status(b"200 OK");
                ctx.flags.set_has_written_status(true);

                resp.write_header(b"content-type", &bun_http_types::MimeType::HTML.value);
                resp.write_header(b"content-encoding", b"gzip");
                resp.write_header_int(b"content-length", WELCOME_PAGE_HTML_GZ.len() as u64);
                if ctx.method == Method::HEAD {
                    ctx.end_without_body(ctx.should_close_connection());
                } else {
                    ctx.end(WELCOME_PAGE_HTML_GZ, ctx.should_close_connection());
                }
                return;
            }
            const MISSING_CONTENT: &[u8] =
                b"Welcome to Bun! To get started, return a Response object.";
            resp.write_status(b"200 OK");
            resp.write_header(b"content-type", &bun_http_types::MimeType::TEXT.value);
            resp.write_header_int(b"content-length", MISSING_CONTENT.len() as u64);
            ctx.flags.set_has_written_status(true);
            if ctx.method == Method::HEAD {
                ctx.end_without_body(ctx.should_close_connection());
            } else {
                ctx.end(MISSING_CONTENT, ctx.should_close_connection());
            }
        }
    }

    pub(crate) fn render_default_error(
        &self,
        log: &bun_ast::Log,
        exceptions: &[jsc::exception_list::JsException],
        message: &[u8],
    ) {
        if !self.flags.has_written_status() {
            self.flags.set_has_written_status(true);
            if let Some(resp) = self.resp.get() {
                resp.write_status(b"500 Internal Server Error");
                resp.write_header(b"content-type", &bun_http_types::MimeType::HTML.value);
            }
        }

        Output::flush();

        if self.method == Method::HEAD {
            self.end_without_body(self.should_close_connection());
            return;
        }

        let bb = DevErrorPage {
            message,
            cwd: bun_resolver::fs::FileSystem::get().top_level_dir,
            exceptions,
            log: Some(log),
        }
        .render();
        let try_end_ok = match self.resp.get() {
            None => true,
            Some(resp) => resp.try_end(&bb, bb.len(), self.should_close_connection()),
        };
        if try_end_ok {
            drop(bb);
            self.detach_response();
            self.end_request_streaming_and_drain();
            self.finalize_without_deinit();
            self.release_in_flight();
            return;
        }

        self.flags.set_has_marked_pending(true);
        self.response_buf_owned.set(bb);

        if let Some(resp) = self.resp.get() {
            resp.on_writable_this(Self::on_writable_complete_response_buffer, self.this());
        }
    }

    /// Drain a partial response buffer
    pub(crate) fn drain_response_buffer_and_metadata(&self) {
        if let Some(resp) = self.resp.get() {
            self.render_metadata();

            let mut buffer = self.response_buf_owned.replace(Vec::new());
            resp.write(&buffer);
            buffer.clear();
            self.response_buf_owned.set(buffer);
        } else {
            self.response_buf_owned.with_mut(|b| b.clear());
        }
    }

    pub(crate) fn end(&self, data: &[u8], close_connection: bool) {
        ctx_log!("end");
        if let Some(resp) = self.resp.get() {
            self.detach_response();
            self.reclaim_promise_cell();
            resp.end(data, close_connection);
            // end_request_streaming_and_drain() must run after the last
            // `resp` access: its drain_microtasks() can re-enter lsquic (H3)
            // and free the stream out from under the local `resp` copy.
            self.end_request_streaming_and_drain();
            self.release_in_flight();
        }
    }

    pub(crate) fn end_stream(&self, close_connection: bool) {
        ctx_log!("endStream");
        if let Some(resp) = self.resp.get() {
            self.detach_response();
            self.reclaim_promise_cell();
            // This will send a terminating 0\r\n\r\n chunk to the client
            // We only want to do that if they're still expecting a body
            // We cannot call this function if the Content-Length header was previously set
            if resp.state().is_response_pending() {
                resp.end_stream(close_connection);
            }
            // end_request_streaming_and_drain() must run after the last
            // `resp` access: its drain_microtasks() can re-enter lsquic (H3)
            // and free the stream out from under the local `resp` copy.
            self.end_request_streaming_and_drain();
            self.release_in_flight();
        }
    }

    /// HTTP/1 only: `end_stream()` for a response the JS sink already fully
    /// ended (`HTTPServerWritable::ended_response`). HTTP/1's uWS `markDone()`
    /// drops its `onAborted` on end, so nothing nulls `self.resp` if the peer
    /// closes afterwards: by the time the parked stream-resolution microtask
    /// runs, uSockets may already have freed the socket
    /// (`us_internal_free_closed_sockets`) or recycled it onto the next
    /// keep-alive request. Release the handle without dereferencing it. The
    /// `clear_on_data()`/`clear_aborted()`/`clear_timeout()` calls
    /// `detach_response()` would make are already covered by `markDone()`,
    /// which is also why a later `server.stop(true)` cannot reach `on_abort`:
    /// callers come here even once the server is terminated.
    ///
    /// HTTP/2 and HTTP/3 must never reach this. `Http{2,3}Response::markDone()`
    /// deliberately leave `onAborted` armed so the stream teardown can notify
    /// the holder, which also proves `resp` is still alive here (`on_abort`
    /// nulls it first). They therefore need `end_stream()`'s
    /// `detach_response()` to disarm that callback before the context is
    /// released, or the later stream teardown invokes it on a freed pool slot.
    pub(crate) fn end_already_responded_stream(&self) {
        ctx_log!("endAlreadyRespondedStream");
        debug_assert!(!MUX);
        // `resp` may be freed (see above); the sink resumed it at `ended_response = true`.
        self.flags.set_request_body_paused(false);
        if self.resp.take().is_some() {
            self.flags.set_is_waiting_for_request_body(false);
            self.flags.set_has_abort_handler(false);
            self.request_body_buf.set(Vec::new());
            self.reclaim_promise_cell();
            self.end_request_streaming_and_drain();
            self.release_in_flight();
        }
    }

    pub(crate) fn end_without_body(&self, close_connection: bool) {
        ctx_log!("endWithoutBody");
        if let Some(resp) = self.resp.get() {
            self.detach_response();
            // uWS markDone() clears onAborted on end, so on_abort can never
            // run for this request; this is the last chance to reclaim an
            // outstanding cell (e.g. a 413 while the handler promise parks).
            self.reclaim_promise_cell();
            resp.end_without_body(close_connection);
            // This end can run uncorked (e.g. render_production_error from a
            // rejection microtask), where no cork or parser gate runs the
            // close check for Connection: close or a graceful-stop mark. The
            // shim no-ops when the socket is corked (the cork wrapper's own
            // gate runs later) or already closed.
            resp.close_if_done_and_marked();
            // end_request_streaming_and_drain() must run after the last
            // `resp` access: its drain_microtasks() can re-enter lsquic (H3)
            // and free the stream out from under the local `resp` copy.
            self.end_request_streaming_and_drain();
            self.release_in_flight();
        }
    }

    pub(crate) fn force_close(&self) {
        if let Some(resp) = self.resp.get() {
            self.detach_response();
            self.reclaim_promise_cell();
            resp.force_close();
            // end_request_streaming_and_drain() must run after the last
            // `resp` access: its drain_microtasks() can re-enter lsquic (H3)
            // and free the stream out from under the local `resp` copy.
            self.end_request_streaming_and_drain();
            self.release_in_flight();
        }
    }

    /// Closes a response whose body failed after the status line was committed.
    /// Never the terminating chunk: it would make a truncated body look complete.
    pub(crate) fn close_incomplete_stream(&self) {
        if let Some(resp) = self.resp.get() {
            if resp.state().is_response_pending() {
                self.force_close();
                return;
            }
        }
        self.end_stream(self.should_close_connection());
    }

    fn on_writable_complete_response_buffer(
        this: ThisPtr<Self>,
        write_offset: u64,
        resp: uws::AnyResponse,
    ) -> bool {
        ctx_log!("onWritableCompleteResponseBuffer");
        let _pin = Self::pin(this);
        debug_assert!(this.resp.get().is_some());
        if this.is_aborted_or_ended() {
            return false;
        }
        this.send_writable_bytes_for_complete_response_buffer(write_offset, resp)
    }

    /// Construct a context in `slot` (claimed from `server`'s pool for this
    /// transport) and return it; its first ref is [`in_flight`](Self::in_flight).
    pub(crate) fn create(
        slot: bun_collections::hive_array::HiveSlot<'_, Self, REQUEST_CONTEXT_POOL_CAPACITY>,
        server: BackRef<ThisServer, bun_ptr::Mut>,
        req: uws::AnyRequest,
        resp: uws::AnyResponse,
        should_deinit_context: Option<DeferDeinitFlag>,
        method: Option<Method>,
    ) -> ThisPtr<Self> {
        debug_assert_eq!(matches!(req, uws::AnyRequest::H3(_)), MUX);
        let resolved_method = method
            .or_else(|| Method::which(req.method()))
            .unwrap_or(Method::GET);
        let in_flight = slot.write_ref(Self {
            root: Cell::new(None),
            resp: Cell::new(Some(resp)),
            req: Cell::new(Some(req)),
            method: resolved_method,
            server: Cell::new(Some(server)),
            defer_deinit_until_callback_completes: Cell::new(should_deinit_context),
            range: RangeRequest::raw_from_request(&req),
            request_weakref: JsCell::new(request::WeakRef::EMPTY),
            signal: Cell::new(None),
            cookies: JsCell::new(None),
            flags: Flags::<DEBUG_MODE>::default(),
            upgrade_context: Cell::new(UpgradeState::None),
            response_jsvalue: Cell::new(JSValue::ZERO),
            ref_count: Cell::new(1),
            pin_count: Cell::new(0),
            in_flight: Cell::new(None),
            body_value_ref: Cell::new(None),
            byte_stream_ref: Cell::new(None),
            s3_stat_ref: Cell::new(None),
            response_weakref: JsCell::new(response::WeakRef::EMPTY),
            blob: JsCell::new(AnyBlob::Blob(Blob::default())),
            sendfile: Cell::new(SendfileContext::default()),
            request_body_readable_stream_ref: JsCell::new(readable_stream::Strong::default()),
            request_body: JsCell::new(None),
            request_body_buf: JsCell::new(Vec::new()),
            request_body_content_len: Cell::new(0),
            request_body_streamed_len: Cell::new(0),
            sink: JsCell::new(None),
            byte_stream: Cell::new(None),
            response_body_readable_stream_ref: JsCell::new(readable_stream::Strong::default()),
            pathname: JsCell::new(BunString::EMPTY),
            response_buf_owned: JsCell::new(Vec::new()),
            additional_on_abort: JsCell::new(None),
            promise_cell: Cell::new(JSValue::ZERO),
        });
        let this = in_flight.this_ptr();
        this.root.set(Some(BackRef::from(this)));
        this.in_flight.set(Some(in_flight));

        ctx_log!("create<d> ({:p})<r>", this.as_ptr());
        this
    }

    pub(crate) fn on_abort(this: ThisPtr<Self>, resp: uws::AnyResponse) {
        ctx_log!("onAbort");
        let _pin = Self::pin(this);
        debug_assert!(this.resp.get().is_some());
        // An HTTP/2 or HTTP/3 stream is destroyed once both sides finish,
        // so this also fires after a successful end(). HTTP/1 sockets persist
        // for keep-alive, so the equivalent never happens there. Drop the
        // pointer; everything else cleans up via the resolve/reject path.
        if MUX {
            if resp.has_responded() {
                this.resp.set(None);
                this.flags.set_has_abort_handler(false);
                return;
            }
        }
        debug_assert!(!this.flags.aborted());
        debug_assert!(this.server.get().is_some());
        // mark request as aborted
        this.flags.set_aborted(true);
        let abort = this.additional_on_abort.replace(None);
        if let Some(abort) = abort {
            (abort.cb)(abort.data.as_ptr());
            abort.deref();
        }

        this.detach_response();
        let any_js_calls = core::cell::Cell::new(false);
        let server = this.server();
        let vm = server.vm();
        let global_this = server.global_this();
        // Entered for the abort listeners below, and (dropped last) for the
        // drains below and in the release of `_in_flight`.
        let _entered = vm.enter_event_loop_scope_without_checkpoint();
        // The response is gone: its ref is this frame's to release.
        let _in_flight = this.in_flight.take();
        // This is a task in the event loop.
        // If we called into JavaScript, we must drain the microtask queue.
        scopeguard::defer! {
            if any_js_calls.get() {
                vm.as_mut().drain_microtasks();
            }
        }

        if let Some(request) = this.request() {
            request.request_context.set(AnyRequestContext::NULL);
        }
        this.request_weakref.set(request::WeakRef::EMPTY);
        // if signal is not aborted, abort the signal
        if let Some(signal) = this.signal.take() {
            if !shim::signal_aborted(signal) {
                shim::signal_fire(
                    signal,
                    global_this,
                    jsc::CommonAbortReason::ConnectionClosed,
                );
                any_js_calls.set(true);
            }
            shim::signal_release(signal);
        }

        // if have sink, call onAborted on sink
        if let Some(mut source) = this.sink().map(|sink| sink.with_mut(|sink| sink.abort())) {
            // The close runs the stream's JS onClose through its signal, and
            // the teardown that can re-enter frees the sink: no borrow of it
            // is live here.
            any_js_calls.set(true);
            source.close(None);
            // End request streaming here, not in deinit: a `Used` body
            // (textStream) can only be rejected through
            // request_body_readable_stream_ref, and finalize_without_deinit
            // drops that ref without erroring it. any_js_calls is already set.
            let _ = this.end_request_streaming();
            this.reclaim_promise_cell();
            return;
        }

        // A natively piped body has nobody left to take it. Release the ref
        // `do_render_with_body` took for the pipe: `end_chunk`, which releases it otherwise,
        // cannot run once the response is gone.
        if let Some(stream) = this.byte_stream.take() {
            shim::byte_stream_unpipe(stream);
            drop(this.byte_stream_ref.take());
        }

        // if we can, free the request now.
        if this.is_dead_request() {
            this.finalize_without_deinit();
        } else {
            if this.end_request_streaming().unwrap_or(true) {
                // TODO: properly propagate exception upwards
                any_js_calls.set(true);
            }

            if let Some(response) = this.response() {
                if let Some(stream) = shim::response_body_stream(response) {
                    let _keep = jsc::EnsureStillAlive(stream.value);
                    shim::response_detach_stream(response, global_this);
                    crate::dispatch::fold(stream.abort(global_this));
                    any_js_calls.set(true);
                }
            }
        }

        // Reclaim only after the block above: the cell's ref must still
        // count in `is_dead_request`, so a parked request-body read goes
        // through `end_request_streaming` and rejects instead of being
        // silently dropped by `finalize_without_deinit`.
        this.reclaim_promise_cell();
    }

    // This function may be called multiple times
    // so it's important that we can safely do that
    pub(crate) fn finalize_without_deinit(&self) {
        ctx_log!("finalizeWithoutDeinit<d> ({:p})<r>", self);
        self.blob.with_mut(|b| b.detach());
        debug_assert!(self.server.get().is_some());
        let global_this = self.server().global_this();

        #[cfg(debug_assertions)]
        {
            ctx_log!(
                "finalizeWithoutDeinit: has_finalized {}",
                self.flags.has_finalized()
            );
            self.flags.set_has_finalized(true);
        }

        let response_jsvalue = self.response_jsvalue.get();
        if !response_jsvalue.is_empty() {
            ctx_log!("finalizeWithoutDeinit: response_jsvalue != .zero");
            if self.flags.response_protected() {
                response_jsvalue.unprotect();
                self.flags.set_response_protected(false);
            }
            self.response_jsvalue.set(JSValue::ZERO);
        }
        self.response_weakref.set(response::WeakRef::EMPTY);

        self.detach_request_body_producer();
        self.request_body_readable_stream_ref
            .with_mut(|s| s.deinit());

        // Releases the ref taken in `set_cookies` (via `CookieMapRef::drop`).
        drop(self.cookies.replace(None));

        if let Some(request) = self.request() {
            request.request_context.set(AnyRequestContext::NULL);
        }
        self.request_weakref.set(request::WeakRef::EMPTY);

        // if signal is not aborted, abort the signal
        if let Some(signal) = self.signal.take() {
            if self.flags.aborted() && !shim::signal_aborted(signal) {
                shim::signal_fire(
                    signal,
                    global_this,
                    jsc::CommonAbortReason::ConnectionClosed,
                );
            }
            shim::signal_release(signal);
        }

        // Case 1:
        // User called .blob(), .json(), text(), or .arrayBuffer() on the Request object
        // but we received nothing or the connection was aborted
        // the promise is pending
        // Case 2:
        // User ignored the body and the connection was aborted or ended
        // Case 3:
        // Stream was not consumed and the connection was aborted or ended
        let _ = self.end_request_streaming(); // TODO: properly propagate exception upwards

        if let Some(stream) = self.byte_stream.take() {
            ctx_log!("finalizeWithoutDeinit: stream != null");
            shim::byte_stream_unpipe(stream);
        }

        self.response_body_readable_stream_ref
            .with_mut(|s| s.deinit());

        self.pathname.set(BunString::EMPTY);
    }

    /// `FileResponseStream` finished, or failed with `err` after force-closing
    /// the socket, which needs the same cleanup.
    pub(crate) fn on_file_stream_complete(
        this: ThisPtr<Self>,
        _resp: uws::AnyResponse,
        err: Option<bun_sys::Error>,
    ) {
        if let Some(err) = err {
            ctx_log!("file stream error: {:?}", err);
        }
        let _pin = Self::pin(this);
        this.detach_response();
        this.end_request_streaming_and_drain();
        this.release_in_flight();
    }

    /// Forward uWS's drain notification to the streaming response sink so it
    /// can resend any `try_end` tail and signal the JS writer to resume.
    ///
    /// Registered once in `do_render_stream` (before assign_to_stream) for the
    /// lifetime of the streaming response, so the sink itself never touches
    /// uWS callback registration — it only tracks `has_backpressure`. uWS only
    /// invokes the handler once its own send buffer has fully drained, so an
    /// always-armed registration costs nothing on the no-backpressure path.
    fn on_writable_response_stream(
        this: ThisPtr<Self>,
        write_offset: u64,
        _resp: uws::AnyResponse,
    ) -> bool {
        ctx_log!("onWritableResponseStream({})", write_offset);
        let _pin = Self::pin(this);
        if let Some(sink) = this.sink() {
            return sink.with_mut(|sink| sink.on_writable(write_offset, _resp));
        }
        true
    }

    fn on_writable_bytes(this: ThisPtr<Self>, write_offset: u64, resp: uws::AnyResponse) -> bool {
        ctx_log!("onWritableBytes");
        let _pin = Self::pin(this);
        debug_assert!(this.resp.get().is_some());
        if this.is_aborted_or_ended() {
            return false;
        }

        let this = this.get();
        let bytes = this.blob.get().slice();
        let _ = this.send_writable_bytes_for_blob(bytes, write_offset, resp);
        true
    }

    pub(crate) fn send_writable_bytes_for_blob(
        &self,
        bytes_: &[u8],
        write_offset_: u64,
        resp: uws::AnyResponse,
    ) -> bool {
        debug_assert!(self.resp.get().is_some());
        let write_offset: usize = write_offset_ as usize;

        let bytes = &bytes_[bytes_.len().min(write_offset)..];
        if resp.try_end(bytes, bytes_.len(), self.should_close_connection()) {
            self.detach_response();
            self.end_request_streaming_and_drain();
            self.release_in_flight();
            true
        } else {
            self.flags.set_has_marked_pending(true);
            resp.on_writable_this(Self::on_writable_bytes, self.this());
            true
        }
    }

    pub(crate) fn send_writable_bytes_for_complete_response_buffer(
        &self,
        write_offset_: u64,
        resp: uws::AnyResponse,
    ) -> bool {
        let write_offset: usize = write_offset_ as usize;
        debug_assert!(self.resp.get().is_some());

        let close_connection = self.should_close_connection();
        let buffer = self.response_buf_owned.replace(Vec::new());
        let total_len = buffer.len();
        let bytes = &buffer[total_len.min(write_offset)..];
        let done = resp.try_end(bytes, total_len, close_connection);
        if done {
            drop(buffer);
            self.detach_response();
            self.end_request_streaming_and_drain();
            self.release_in_flight();
        } else {
            self.response_buf_owned.set(buffer);
            self.flags.set_has_marked_pending(true);
            resp.on_writable_this(Self::on_writable_complete_response_buffer, self.this());
        }

        true
    }

    pub(crate) fn do_sendfile(&self, blob: Blob) {
        if self.is_aborted_or_ended() {
            return;
        }
        if self.flags.has_sendfile_ctx() {
            return;
        }

        let global_this = self.server().global_this();
        let resp = self.resp.get().expect("infallible: resp bound");

        self.blob.set(AnyBlob::Blob(blob));
        let blob_ref = self.blob.get();
        let crate::webcore::blob::store::Data::File(file) = &blob_ref.store().unwrap().data else {
            unreachable!("do_sendfile called with non-file blob");
        };
        let mut file_buf = PathBuffer::uninit();
        let auto_close = !matches!(
            file.pathlike,
            crate::webcore::node_types::PathOrFileDescriptor::Fd(_)
        );
        let fd: bun_sys::Fd = if !auto_close {
            file.pathlike.fd()
        } else {
            match bun_sys::open(
                file.pathlike.path().slice_z(&mut file_buf),
                bun_sys::O::RDONLY | bun_sys::O::NONBLOCK | bun_sys::O::CLOEXEC,
                0,
            ) {
                bun_sys::Result::Ok(fd_) => fd_,
                bun_sys::Result::Err(err) => {
                    let js_err = err
                        .with_path(file.pathlike.path().slice())
                        .to_js(global_this);
                    return self.run_error_handler(js_err);
                }
            }
        };

        let stat: bun_sys::Stat = match bun_sys::fstat(fd) {
            bun_sys::Result::Ok(s) => s,
            bun_sys::Result::Err(err) => {
                if auto_close {
                    fd.close();
                }
                // Attach the path for the Path arm and the fd for the Fd arm.
                let js_err = match &file.pathlike {
                    crate::webcore::node_types::PathOrFileDescriptor::Path(p) => {
                        err.with_path(p.slice()).to_js(global_this)
                    }
                    crate::webcore::node_types::PathOrFileDescriptor::Fd(pathlike_fd) => {
                        err.with_fd(*pathlike_fd).to_js(global_this)
                    }
                };
                return self.run_error_handler(js_err);
            }
        };

        let mode = stat.st_mode as bun_sys::Mode;
        let is_regular = bun_sys::S::ISREG(mode);
        let (file_type, pollable): (bun_io::FileType, bool) = 'brk: {
            if bun_sys::S::ISFIFO(mode) || bun_sys::S::ISCHR(mode) {
                break 'brk (bun_io::FileType::Pipe, true);
            }
            if bun_sys::S::ISSOCK(mode) {
                break 'brk (bun_io::FileType::Socket, true);
            }
            if bun_sys::S::ISDIR(mode) {
                if auto_close {
                    fd.close();
                }
                // Attach the path for the Path arm and the fd for the Fd arm.
                let base_err = bun_sys::Error {
                    errno: bun_sys::E::EISDIR as _,
                    syscall: bun_sys::Tag::read,
                    ..Default::default()
                };
                let err = match &file.pathlike {
                    crate::webcore::node_types::PathOrFileDescriptor::Path(p) => {
                        base_err.with_path(p.slice())
                    }
                    crate::webcore::node_types::PathOrFileDescriptor::Fd(pathlike_fd) => {
                        base_err.with_fd(*pathlike_fd)
                    }
                };
                let mut sys: jsc::SystemError = err.to_system_error().into();
                sys.message = BunString::static_("Cannot stream a directory as a response body");
                return self.run_error_handler(sys.to_error_instance(global_this));
            }
            (bun_io::FileType::File, false)
        };

        let (original_size, blob_offset) = match blob_ref {
            AnyBlob::Blob(b) => (b.size.get(), b.offset.get()),
            _ => unreachable!(),
        };
        let stat_size: BlobSizeType = BlobSizeType::try_from(stat.st_size.max(0)).unwrap();
        if let AnyBlob::Blob(b) = blob_ref {
            b.size.set(if is_regular {
                stat_size
            } else {
                original_size.min(stat_size)
            });
        }

        self.flags.set_needs_content_length(is_regular);
        let mut sendfile = SendfileContext {
            remain: blob_offset + original_size,
            offset: blob_offset,
            total: 0,
        };
        if is_regular && auto_close {
            self.flags.set_needs_content_range(
                sendfile.remain.saturating_sub(sendfile.offset) != stat_size,
            );
        }
        if is_regular {
            sendfile.offset = sendfile.offset.min(stat_size);
            sendfile.remain = sendfile
                .remain
                .max(sendfile.offset)
                .min(stat_size)
                .saturating_sub(sendfile.offset);
        }
        self.sendfile.set(sendfile);

        // Honor an incoming Range: header for whole-file responses. We
        // don't compose Range with a user-supplied .slice() because the
        // Content-Range arithmetic gets ambiguous; the slice path keeps
        // its existing slice-as-range behavior. `offset == 0` alone is
        // insufficient — `Bun.file(p).slice(0, n)` has offset 0 — so we
        // also check the size: an unsliced blob has either the unset-size
        // sentinel or, if JS already read `.size`, the stat'd size; a
        // `.slice(0, n)` blob has `n < stat_size`. Skip if the user
        // already set Content-Range or a non-200 status — they're
        // managing partial responses themselves.
        let user_handles_range = if let Some(r) = self.response() {
            r.status_code() != 200
                || r.get_init_headers_mut()
                    .map(|h| h.fast_has(jsc::HTTPHeaderName::ContentRange))
                    .unwrap_or(false)
        } else {
            false
        };
        let is_whole_file = blob_offset == 0
            && (original_size == crate::webcore::blob::MAX_SIZE || original_size == stat_size);
        // RFC 9110 §14.2: Range is only defined for GET (HEAD mirrors GET's headers).
        let method_allows_range = self.method == Method::GET || self.method == Method::HEAD;
        if is_regular
            && method_allows_range
            && !user_handles_range
            && is_whole_file
            && self.range != RangeRequest::Raw::None
        {
            match self.range.resolve(stat_size) {
                RangeRequest::Result::None => {}
                RangeRequest::Result::Satisfiable { start, end } => {
                    let mut sendfile = self.sendfile.get();
                    sendfile.offset = BlobSizeType::try_from(start).unwrap();
                    sendfile.remain = BlobSizeType::try_from(end - start + 1).unwrap();
                    sendfile.total = stat_size;
                    self.sendfile.set(sendfile);
                    self.flags.set_needs_content_range(true);
                }
                RangeRequest::Result::Unsatisfiable => {
                    if auto_close {
                        fd.close();
                    }
                    let mut crbuf = [0u8; RangeRequest::CONTENT_RANGE_BUF];
                    self.do_write_status(416);
                    if let Some(response) = self.response() {
                        if let Some(mut headers_) = response.swap_init_headers() {
                            self.do_write_headers(&mut headers_);
                            // `HeadersRef` releases the +1 ref in Drop; do NOT
                            // call `.deref()` explicitly (would double-free).
                            drop(headers_);
                        }
                    }
                    let cr = RangeRequest::format_content_range(
                        &mut crbuf,
                        RangeRequest::Result::Unsatisfiable,
                        Some(stat_size),
                    );
                    resp.write_header(b"content-range", cr);
                    resp.write_header(b"accept-ranges", b"bytes");
                    let close = resp.should_close_connection();
                    self.detach_response();
                    resp.end(b"", close);
                    self.end_request_streaming_and_drain();
                    self.release_in_flight();
                    return;
                }
            }
        }

        resp.corked(|| self.render_metadata());

        let sendfile = self.sendfile.get();
        if (is_regular && sendfile.remain == 0) || !self.method.has_body() {
            if auto_close {
                fd.close();
            }
            let close = resp.should_close_connection();
            self.detach_response();
            resp.end(b"", close);
            self.end_request_streaming_and_drain();
            self.release_in_flight();
            return;
        }

        // FileResponseStream registers its own onAborted/onWritable with itself
        // as userData; any later setAbortHandler()/onWritable() from this
        // RequestContext would replace them and FileResponseStream would never
        // hear about the abort/drain it is driving.
        self.flags.set_has_sendfile_ctx(true);
        self.flags.set_has_abort_handler(true);
        self.flags.set_has_marked_pending(true);

        if self.flags.is_waiting_for_request_body() {
            self.flags.set_is_waiting_for_request_body(false);
            resp.clear_on_data();
        }

        let server = self.server();
        FileResponseStream::start(file_response_stream::StartOptions {
            fd,
            auto_close,
            resp,
            vm: bun_ptr::BackRef::new(server.vm()),
            file_type,
            pollable,
            offset: sendfile.offset as u64,
            length: if is_regular {
                Some(sendfile.remain as u64)
            } else {
                None
            },
            idle_timeout: server.config().idle_timeout,
            owner: file_response_stream::StreamOwner::RequestContext(AnyRequestContext::init(
                self.this(),
            )),
        });
    }

    /// `Body::ReceiveValue::Server`: the pending response body resolved.
    /// Releases the ref the registration in `do_render_with_body` took.
    pub(crate) fn render_pending_body_value(this: ThisPtr<Self>, value: &mut Body::Value) {
        let _registration = this.body_value_ref.take();
        this.do_render_with_body(value, None);
    }

    fn render_with_blob_from_body_value(&self) {
        if self.is_aborted_or_ended() {
            return;
        }

        if self.blob.get().needs_to_read_file() {
            if !self.flags.has_sendfile_ctx() {
                if let AnyBlob::Blob(b) =
                    self.blob.replace(AnyBlob::InternalBlob(Default::default()))
                {
                    self.do_sendfile(b);
                }
            }
            return;
        }

        self.do_render_blob();
    }

    /// The response sink's first write (`HTTPServerWritable::first_write_ctx`).
    pub(crate) fn handle_first_stream_write(&self) {
        if !self.flags.has_written_status() {
            self.render_metadata();
        }
    }

    /// Detach the JS controller from the sink and free it. `finish` runs on
    /// the sink in between (the settle paths finalize it there).
    fn destroy_sink(
        &self,
        global_this: &JSGlobalObject,
        finish: impl FnOnce(&mut ResponseStream<SSL_ENABLED>),
    ) {
        if let Some(sink) = self.sink.replace(None) {
            sink.with_mut(|sink| {
                ResponseStreamJSSink::<SSL_ENABLED>::detach(&mut sink.source, global_this);
                finish(sink);
            });
            ResponseStream::destroy(sink);
        }
    }

    /// `on_abort` ran from inside the user code `do_render_stream` invoked
    /// (`server.stop(true)` in `pull()`): it aborted the sink, detached `resp`
    /// and took over the in-flight ref, leaving only the sink and stream to drop.
    /// Keyed on `resp` being gone, not on `is_aborted_or_ended()`: a stop that
    /// found the response already complete never reaches `on_abort`, and that
    /// request still owns its ref, which the regular arms release.
    fn discard_stream_after_abort(
        &self,
        stream: &WebCore::ReadableStream,
        global_this: &JSGlobalObject,
    ) {
        stream_log!("aborted while attaching the stream");
        let mut readable_ref = self
            .response_body_readable_stream_ref
            .replace(readable_stream::Strong::default());
        if let Some(sink) = self.sink.replace(None) {
            sink.with_mut(|sink| {
                ResponseStreamJSSink::<SSL_ENABLED>::detach(&mut sink.source, global_this)
            });
            crate::dispatch::fold(stream.cancel(global_this));
            sink.with_mut(|sink| {
                sink.mark_done();
                sink.first_write_ctx = None;
                sink.finalize();
            });
            ResponseStream::destroy(sink);
        }
        readable_ref.deinit();
    }

    /// Runs corked.
    fn do_render_stream(&self, mut stream: WebCore::ReadableStream) {
        ctx_log!("doRenderStream");
        let this = self;
        let stream = &mut stream;
        debug_assert!(this.server.get().is_some());
        let global_this = this.server().global_this();

        // Armed here, not in `to_async()`: `stop(true)` inside `pull()` must reach `on_abort`; see `end_already_responded_stream`.
        this.set_abort_handler();
        if this.is_aborted_or_ended() {
            // No reader yet: `cancel()` would skip the stream.
            crate::dispatch::fold(stream.cancel_with_reason(global_this, JSValue::UNDEFINED));
            this.response_body_readable_stream_ref
                .with_mut(|s| s.deinit());
            return;
        }
        let resp = this.resp.get().expect("infallible: resp bound");

        stream.value.ensure_still_alive();

        this.sink
            .set(Some(Box::new(JsCell::new(ResponseStream::<SSL_ENABLED> {
                res: Some(resp),
                buffer: Vec::<u8>::default(),
                first_write_ctx: Some(AnyRequestContext::init(this.this())),
                global_this: Some(BackRef::new(global_this)),
                ..Default::default()
            }))));
        // Re-fetched after every call that runs user code: `on_abort` may run
        // in there, but it leaves the sink to `discard_stream_after_abort`.
        let sink = || this.sink().expect("sink set above");

        // we need to render metadata before assignToStream because the stream can call res.end
        // and this would auto write an 200 status
        if !this.flags.has_written_status() {
            this.render_metadata();
        }

        resp.on_writable_this(Self::on_writable_response_stream, this.this());

        // We are already corked!
        let assignment_result: JSValue = ResponseStreamJSSink::<SSL_ENABLED>::assign_to_stream(
            global_this,
            stream.value,
            NonNull::new(sink().as_ptr()).expect("JsCell::as_ptr is non-null"),
        );

        assignment_result.ensure_still_alive();

        // assignToStream stored the controller in `sink.source`; a sync-finished stream's
        // `__controllerDetached` may already have cleared it again (handled below).

        let aborted = this.flags.aborted() || sink().get().is_aborted();
        this.flags.set_aborted(aborted);

        if this.resp.get().is_none() {
            this.discard_stream_after_abort(stream, global_this);
            return;
        }

        #[cfg(debug_assertions)]
        if resp.has_responded() {
            stream_log!("responded");
        }

        if let Some(err_value) = assignment_result.to_error() {
            stream_log!("returned an error");
            this.destroy_sink(global_this, |_| {});
            return this.handle_reject(err_value);
        }

        if resp.has_responded() {
            stream_log!("done");
            this.destroy_sink(global_this, |_| {});
            stream.done();
            this.response_body_readable_stream_ref
                .with_mut(|s| s.deinit());
            this.end_stream(this.should_close_connection());
            return;
        }

        // A fully-synchronous ReadableStream can drain through writeBytes
        // and reach endFromJS() inside assignToStream(). If tryEnd() then
        // hits transport backpressure (common on QUIC right after the
        // HEADERS frame), the sink parks a pending_flush promise, but
        // assignToStream() itself returns undefined. Surface that promise
        // here so the request waits for the drain (the on_writable armed
        // above resolves it) instead of falling through to the cancel path.
        let mut effective_result = assignment_result;
        if effective_result.is_empty_or_undefined_or_null() {
            if let Some(flush) = sink().get().pending_flush {
                // S008: `JSPromise` is an `opaque_ffi!` ZST — safe `*const → &` deref.
                effective_result = jsc::JSPromise::opaque_ref(flush).to_js();
            }
        }

        if !effective_result.is_empty_or_undefined_or_null() {
            effective_result.ensure_still_alive();
            // it returns a Promise when it goes through ReadableStreamDefaultReader
            if let Some(promise) = effective_result.as_any_promise() {
                stream_log!("returned a promise");
                if this.drain_microtasks().is_err() {
                    return;
                }
                // The drain ran user code too (same as right after assign_to_stream).
                if this.resp.get().is_none() {
                    this.discard_stream_after_abort(stream, global_this);
                    return;
                }

                // `MarkHandled` matters for the Rejected arm: the promise
                // settled before any reaction was attached, so without the
                // flag the VM would report it as an unhandled rejection even
                // though handle_reject_stream consumes it here.
                match promise.unwrap(global_this.vm(), jsc::PromiseUnwrapMode::MarkHandled) {
                    jsc::PromiseResult::Pending => {
                        stream_log!("promise still Pending");
                        // The sink now owns a raw `resp` pointer and the pump
                        // promise holds a ref on this context. Marking pending
                        // keeps `handle_reject` from ending the response out
                        // from under the sink while the stream is in flight.
                        this.flags.set_has_marked_pending(true);
                        if !this.flags.has_written_status() {
                            sink().with_mut(|s| s.first_write_ctx = None);
                            this.render_metadata();
                        }

                        // TODO: should this timeout?
                        let body_value = this.response().unwrap().get_body_value();
                        *body_value = Body::Value::Locked(Body::PendingValue {
                            readable: readable_stream::Strong::init(*stream, global_this),
                            global: std::ptr::from_ref(global_this),
                            ..Default::default()
                        });
                        let cell = this.create_promise_cell(global_this);
                        effective_result.then_with_value(
                            global_this,
                            cell,
                            Self::ON_RESOLVE_STREAM,
                            Self::ON_REJECT_STREAM,
                        ); // TODO: properly propagate exception upwards
                        // the response_stream should be GC'd
                    }
                    jsc::PromiseResult::Fulfilled(_) => {
                        stream_log!("promise Fulfilled");
                        let mut readable_ref = this
                            .response_body_readable_stream_ref
                            .replace(readable_stream::Strong::default());
                        // NOTE: cleanup runs after handle_resolve_stream:
                        // body first, then the deferred cleanup.
                        this.handle_resolve_stream();
                        stream.done();
                        readable_ref.deinit();
                    }
                    jsc::PromiseResult::Rejected(err) => {
                        stream_log!("promise Rejected");
                        // Consuming the rejection here is what keeps it out of
                        // the unhandledRejection reporter, so surface it here.
                        // DEBUG_MODE already reports it in handle_reject_stream.
                        if !DEBUG_MODE
                            && let Some(server) = this.server.get()
                            && !err.is_empty_or_undefined_or_null()
                        {
                            server.vm().as_mut().run_error_handler(err, None);
                        }
                        let mut readable_ref = this
                            .response_body_readable_stream_ref
                            .replace(readable_stream::Strong::default());
                        this.handle_reject_stream(global_this, err);
                        crate::dispatch::fold(stream.cancel(global_this));
                        readable_ref.deinit();
                    }
                }
                return;
            } else {
                // if is not a promise we treat it as Error
                stream_log!("returned an error");
                this.destroy_sink(global_this, |_| {});
                return this.handle_reject(effective_result);
            }
        }

        let mut readable_ref = this
            .response_body_readable_stream_ref
            .replace(readable_stream::Strong::default());

        let is_in_progress = {
            let s = sink().get();
            s.has_backpressure || !(s.wrote == 0 && s.buffer.len() == 0)
        };

        if !stream.is_locked(global_this) && !is_in_progress {
            if let Some(comparator) = WebCore::ReadableStream::from_js_direct(stream.value) {
                if core::mem::discriminant(&comparator.ptr) == core::mem::discriminant(&stream.ptr)
                {
                    stream_log!("is not locked");
                    sink().with_mut(|s| s.first_write_ctx = None);
                    this.destroy_sink(global_this, |s| {
                        s.mark_done();
                        s.finalize();
                    });
                    readable_ref.deinit();
                    this.render_missing();
                    return;
                }
            }
        }

        stream_log!("is in progress, but did not return a Promise. Finalizing request context");
        sink().with_mut(|s| s.first_write_ctx = None);
        if let Some(owned) = this.sink.replace(None) {
            owned.with_mut(|s| {
                ResponseStreamJSSink::<SSL_ENABLED>::detach(&mut s.source, global_this)
            });
            crate::dispatch::fold(stream.cancel(global_this));
            owned.with_mut(|s| {
                s.mark_done();
                s.finalize();
            });
            ResponseStream::destroy(owned);
        }
        readable_ref.deinit();
        this.render_missing();
    }

    pub(crate) fn did_upgrade_web_socket(&self) -> bool {
        matches!(self.upgrade_context.get(), UpgradeState::Upgraded)
    }

    fn to_async_without_abort_handler(&self, req: uws::AnyRequest, request_object: &Request) {
        debug_assert!(self.server.get().is_some());

        // For HTTP/3, prepareJsRequestContextFor() already eagerly
        // populated url+headers (the lazy getRequest() path is H1-only),
        // so the guards below short-circuit and `req` is never read.
        if let uws::AnyRequest::H1(req) = req {
            request_object.request_context.get().set_request(req);
        }

        if request_object.ensure_url().is_err() {
            request_object.url.set(BunString::EMPTY);
        }

        // we have to clone the request headers here since they will soon belong to a different request
        if !request_object.has_fetch_headers() {
            if let uws::AnyRequest::H1(req) = req {
                // `HeadersRef::create_from_uws` adopts the freshly-allocated +1 ref.
                request_object.set_fetch_headers(Some(response::HeadersRef::create_from_uws(
                    req.cast::<c_void>(),
                )));
            }
        }

        // This object dies after the stack frame is popped
        // so we have to clear it in here too
        request_object.request_context.get().detach_request();
    }

    pub(crate) fn to_async(&self, req: uws::AnyRequest, request_object: &Request) {
        ctx_log!("toAsync");
        self.to_async_without_abort_handler(req, request_object);
        if DEBUG_MODE {
            self.pathname.set(request_object.url.get().clone());
        }
        self.set_abort_handler();
    }

    fn end_request_streaming_and_drain(&self) {
        debug_assert!(self.server.get().is_some());

        if self.end_request_streaming().unwrap_or(true) {
            // TODO: properly propagate exception upwards
            self.server().vm().as_mut().drain_microtasks();
        }
    }

    fn end_request_streaming(&self) -> JsResult<bool> {
        debug_assert!(self.server.get().is_some());

        self.request_body_buf.set(Vec::new());

        // if we cannot, we have to reject pending promises
        // first, we reject the request body promise
        if let Some(body) = self.request_body_slot()
            && matches!(body.get(), Body::Value::Locked(_))
        {
            // User called .blob(), .json(), text(), or .arrayBuffer() on the Request object
            // but we received nothing or the connection was aborted
            let global_this = self.server().global_this();
            body.with_mut(|body| {
                body.to_error_instance(
                    Body::ValueError::AbortReason(jsc::CommonAbortReason::ConnectionClosed),
                    global_this,
                )
            })?;
            return Ok(true);
        }

        // `req.textStream()` transitions the body to `Value::Used`, so the
        // Locked check above falls through. Error the ByteStream via our own
        // strong ref instead so a pending read rejects rather than hanging.
        if self.request_body_readable_stream_ref.with_mut(|s| s.has()) {
            let global_this = self.server().global_this();
            let strong = self
                .request_body_readable_stream_ref
                .replace(readable_stream::Strong::default());
            if let Some(readable) = strong.get() {
                readable.value.ensure_still_alive();
                if let Some(bytes) = readable.ptr.bytes() {
                    let mut err =
                        Body::ValueError::AbortReason(jsc::CommonAbortReason::ConnectionClosed);
                    bytes.on_data(WebCore::streams::Result::Err(
                        err.to_stream_error(global_this),
                    ));
                    err.reset();
                    return Ok(true);
                }
            }
        }

        Ok(false)
    }

    fn detach_response(&self) {
        self.request_body_buf.set(Vec::new());

        if let Some(resp) = self.resp.take() {
            if self.flags.request_body_paused() {
                self.flags.set_request_body_paused(false);
                resp.resume();
            }
            if self.flags.is_waiting_for_request_body() {
                self.flags.set_is_waiting_for_request_body(false);
                resp.clear_on_data();
            }
            if self.flags.has_abort_handler() {
                resp.clear_aborted();
                self.flags.set_has_abort_handler(false);
            }
        }
    }

    pub(crate) fn is_aborted_or_ended(&self) -> bool {
        // resp == null or aborted or server.stop(true)
        self.resp.get().is_none()
            || self.flags.aborted()
            || self.server.get().is_none()
            || self.server().terminated()
    }

    /// Runs corked.
    fn do_render_head_response_after_s3_size_resolved(&self, size: usize) {
        let this = self;
        this.render_metadata();

        if let Some(resp) = this.resp.get() {
            resp.write_header_int(b"content-length", size as u64);
        }
        this.end_without_body(this.should_close_connection());
        // `end_without_body` released the in-flight ref; the caller
        // (`on_s3_size_resolved`) releases the ref taken for the S3 stat.
    }

    /// `S3::client::stat` for a HEAD response with an S3 body completed.
    /// Releases [`s3_stat_ref`](Self::s3_stat_ref).
    pub(crate) fn on_s3_size_resolved(
        this: ThisPtr<Self>,
        result: S3::simple_request::S3StatResult<'_>,
    ) {
        let _stat_ref = this.s3_stat_ref.take();
        if let Some(resp) = this.resp.get() {
            let size = match result {
                S3::simple_request::S3StatResult::Failure(_)
                | S3::simple_request::S3StatResult::NotFound(_) => 0,
                S3::simple_request::S3StatResult::Success(stat) => stat.size,
            };
            resp.corked(|| this.do_render_head_response_after_s3_size_resolved(size));
        }
    }

    /// Runs corked. `response` is the payload of the JS wrapper the calling
    /// frame keeps GC-rooted.
    fn do_render_head_response(&self, response: ThisPtr<Response>) {
        let this = self;
        if this.resp.get().is_none() {
            return;
        }
        // we will render the content-length header later manually so we set this to false
        this.flags.set_needs_content_length(false);
        // Always this.renderMetadata() before sending the content-length or transfer-encoding header so status is sent first

        let resp = this.resp.get().expect("infallible: resp bound");
        this.set_response(response);
        let response = response.get();

        // `render` drops the body for a null-body status on GET, so HEAD must
        // not derive framing from that body (or the user headers) either
        // (RFC 9110 §9.3.2): render the exact metadata+framing GET would.
        if HTTPStatusText::is_null_body(response.status_code()) {
            this.do_render_null_body_status_corked();
            return;
        }

        let Some(server) = this.server.get() else {
            // server detached?
            this.render_metadata();
            resp.write_header_int(b"content-length", 0);
            this.end_without_body(this.should_close_connection());
            return;
        };
        let global_this = server.global_this();

        // GET strips the handler's Content-Length / Transfer-Encoding and frames
        // from the body, so HEAD must too (RFC 9110 §9.3.2). Only a bodiless
        // Response leaves those headers as what GET would have sent (#15355).
        let body_decides_framing = {
            let body_value = response.get_body_value();
            body_value.to_blob_if_possible();
            !matches!(
                body_value,
                Body::Value::Used | Body::Value::Null | Body::Value::Empty | Body::Value::Error(_)
            )
        };
        // `fast_get`/`fast_has` take `&mut self` (FFI shim), so use the `_mut`
        // accessor — `get_fetch_headers()` and `get_init_headers()` alias the
        // same `init.headers` field.
        if !body_decides_framing {
            if let Some(headers) = response.get_init_headers_mut() {
                // first respect the headers
                if !MUX {
                    if let Some(transfer_encoding) =
                        headers.fast_get(jsc::HTTPHeaderName::TransferEncoding)
                    {
                        // fastGet() borrows the header map's StringImpl; renderMetadata() ->
                        // doWriteHeaders() calls fastRemove(.TransferEncoding) and derefs the
                        // FetchHeaders, freeing that StringImpl before we write it. Clone so
                        // the bytes outlive renderMetadata().
                        let transfer_encoding_str = transfer_encoding.to_utf8().into_owned();
                        this.render_metadata();
                        resp.write_header(b"transfer-encoding", transfer_encoding_str.slice());
                        this.end_without_body(this.should_close_connection());
                        return;
                    }
                }
                if let Some(content_length) = headers.fast_get(jsc::HTTPHeaderName::ContentLength) {
                    // Parse before renderMetadata(): doWriteHeaders() will fastRemove(.ContentLength)
                    // and deref the FetchHeaders, freeing the borrowed StringImpl.
                    let content_length_str = content_length.to_utf8();
                    let len: usize = HTTP::parse_content_length(content_length_str.slice());
                    drop(content_length_str);

                    this.render_metadata();
                    resp.write_header_int(b"content-length", len as u64);
                    this.end_without_body(this.should_close_connection());
                    return;
                }
            }
        }
        // the body decides the framing (or there is neither a body nor a
        // handler-supplied Content-Length / Transfer-Encoding header)
        let body_value = response.get_body_value();
        match body_value {
            Body::Value::InternalBlob(_) | Body::Value::WTFStringImpl(_) => {
                let mut blob = body_value.use_as_any_blob_allow_non_utf8_string();
                let size = blob.size();
                this.render_metadata();

                if size == crate::webcore::blob::MAX_SIZE {
                    resp.write_header_int(b"content-length", 0);
                } else {
                    resp.write_header_int(b"content-length", size as u64);
                }
                this.end_without_body(this.should_close_connection());
                blob.detach();
            }

            Body::Value::Blob(blob) => {
                if shim::blob_is_s3(blob) {
                    // we need to read the size asynchronously
                    // in this case should always be a redirect so should not hit this path, but in case we change it in the future lets handle it
                    // Ref for the S3 stat; released by `on_s3_size_resolved`.
                    let prev = this
                        .s3_stat_ref
                        .replace(Some(RefPtr::from_this(this.this())));
                    debug_assert!(prev.is_none());

                    let crate::webcore::blob::store::Data::S3(s3) =
                        &blob.store.get().as_ref().unwrap().data
                    else {
                        unreachable!()
                    };
                    let credentials = s3.get_credentials();
                    let path = s3.path();
                    // `Transpiler::env_mut` is the safe accessor for the
                    // process-singleton dotenv loader (set during init).
                    let proxy_url = global_this
                        .bun_vm()
                        .as_mut()
                        .transpiler
                        .env_mut()
                        .get_http_proxy(true, None, None)
                        .map(|proxy| proxy.href);

                    let _ = S3::client::stat_for_request_context(
                        credentials,
                        path,
                        AnyRequestContext::init(this.this()),
                        proxy_url,
                        s3.request_payer,
                    ); // TODO: properly propagate exception upwards
                    return;
                }
                // Size the blob *before* `render_metadata()`: it re-fetches the
                // Response from `response_weakref`, so no borrow of the Response
                // (here, `blob`) may still be live across it. Nothing is written
                // to the socket in between, so the wire output is unchanged.
                blob.resolve_size();
                let blob_size = blob.size.get();
                this.render_metadata();

                if blob_size == crate::webcore::blob::MAX_SIZE {
                    resp.write_header_int(b"content-length", 0);
                } else {
                    resp.write_header_int(b"content-length", blob_size as u64);
                }
                this.end_without_body(this.should_close_connection());
            }
            Body::Value::Locked(_) => {
                this.render_metadata();
                if !MUX {
                    resp.write_header(b"transfer-encoding", b"chunked");
                }
                // HEAD never transmits the body.
                Self::cancel_unread_body(&response, global_this);
                this.end_without_body(this.should_close_connection());
            }
            Body::Value::Used | Body::Value::Null | Body::Value::Empty | Body::Value::Error(_) => {
                this.render_metadata();
                resp.write_header_int(b"content-length", 0);
                this.end_without_body(this.should_close_connection());
            }
        }
    }

    /// Drops the callback's result as for any aborted request; `set_abort_handler` delivers the missed close.
    #[cold]
    fn on_connection_closed_during_dispatch(&self, this: &ThisServer, result: JSValue) {
        ctx_log!("connection closed during dispatch");
        self.discard_handler_result(this.global_this(), result);
        self.set_abort_handler();
    }

    // Each HTTP request or TCP socket connection is effectively a "task".
    //
    // However, unlike the regular task queue, we don't drain the microtask
    // queue at the end.
    //
    // Instead, we drain it multiple times, at the points that would
    // otherwise "halt" the Response from being rendered.
    //
    // - If you return a Promise, we drain the microtask queue once
    // - If you return a streaming Response, we drain the microtask queue (possibly the 2nd time this task!)
    //
    // Like a task, the handler and these drains run with the event loop entered
    // (the dispatchers hold `enter_event_loop_scope_without_checkpoint`), so a
    // callback the handler dispatches synchronously through `enter()`/`exit()`
    // (`server.upgrade()` -> `open()`, `ws.close()` -> `close()`) does not
    // drain in the middle of the handler.
    pub(crate) fn on_response(
        &self,
        this: &ThisServer,
        request_value: JSValue,
        response_value: JSValue,
    ) {
        let ctx = self;
        request_value.ensure_still_alive();
        response_value.ensure_still_alive();
        if ctx.drain_microtasks().is_err() {
            return;
        }
        if ctx.is_aborted_or_ended() {
            ctx.discard_handler_result(this.global_this(), response_value);
            return;
        }
        if ctx.resp.get().is_some_and(|resp| resp.is_closed()) {
            ctx.on_connection_closed_during_dispatch(this, response_value);
            return;
        }
        // if you return a Response object or a Promise<Response>
        // but you upgraded the connection to a WebSocket
        // just ignore the Response object. It doesn't do anything.
        // it's better to do that than to throw an error
        if ctx.did_upgrade_web_socket() {
            ctx.discard_handler_result(this.global_this(), response_value);
            return;
        }

        if response_value.is_empty_or_undefined_or_null() {
            ctx.render_missing_invalid_response(response_value);
            return;
        }

        if let Some(err_value) = response_value.to_error() {
            ctx.run_error_handler(err_value);
            return;
        }

        // `response_value` is rooted via ensure_still_alive() / protect() below
        // for as long as `response` is used.
        if let Some(response) = as_response(response_value) {
            if ctx.reject_unsendable_response(response.status_code()) {
                return;
            }
            ctx.response_jsvalue.set(response_value);
            response_value.ensure_still_alive();
            ctx.flags.set_response_protected(false);
            if ctx.method == Method::HEAD {
                if let Some(resp) = ctx.resp.get() {
                    resp.corked(|| ctx.do_render_head_response(response));
                }
                return;
            } else {
                ctx.protect_for_body_and_render(response_value, response);
            }
            return;
        }

        let vm = this.vm();

        if let Some(promise) = response_value.as_any_promise() {
            // If we immediately have the value available, we can skip the extra event loop tick
            match promise.unwrap(vm.global().vm(), jsc::PromiseUnwrapMode::MarkHandled) {
                jsc::PromiseResult::Pending => {
                    let cell = ctx.create_promise_cell(this.global_this());
                    response_value.then_with_value(
                        this.global_this(),
                        cell,
                        Self::ON_RESOLVE,
                        Self::ON_REJECT,
                    ); // TODO: properly propagate exception upwards
                    return;
                }
                jsc::PromiseResult::Fulfilled(fulfilled_value) => {
                    // if you return a Response object or a Promise<Response>
                    // but you upgraded the connection to a WebSocket
                    // just ignore the Response object. It doesn't do anything.
                    // it's better to do that than to throw an error
                    if ctx.did_upgrade_web_socket() {
                        return;
                    }

                    if fulfilled_value.is_empty_or_undefined_or_null() {
                        ctx.render_missing_invalid_response(fulfilled_value);
                        return;
                    }
                    // `fulfilled_value` is rooted via ensure_still_alive() /
                    // protect() below for as long as `response` is used.
                    let Some(response) = as_response(fulfilled_value) else {
                        ctx.render_missing_invalid_response(fulfilled_value);
                        return;
                    };

                    if ctx.reject_unsendable_response(response.status_code()) {
                        return;
                    }

                    ctx.response_jsvalue.set(fulfilled_value);
                    fulfilled_value.ensure_still_alive();
                    ctx.flags.set_response_protected(false);
                    if ctx.method == Method::HEAD {
                        if let Some(resp) = ctx.resp.get() {
                            resp.corked(|| ctx.do_render_head_response(response));
                        }
                        return;
                    }
                    ctx.protect_for_body_and_render(fulfilled_value, response);
                    return;
                }
                jsc::PromiseResult::Rejected(err) => {
                    ctx.handle_reject(err);
                    return;
                }
            }
        }

        // A truthy non-Response, non-Error, non-Promise value (object, string,
        // number, ...). The async twin (`handle_resolve`) reports this via
        // `render_missing_invalid_response`; do the same on the sync path.
        ctx.render_missing_invalid_response(response_value);
    }

    pub(crate) fn handle_resolve_stream(&self) {
        stream_log!("handleResolveStream");

        // endFromJS() can hit transport backpressure (common on QUIC right
        // after the HEADERS frame) and park a pending_flush promise while
        // onWritable drains the remaining bytes. Tearing the sink down now
        // would discard those bytes and truncate the response, so wait for
        // the flush to settle and re-enter. On abort, flushPromise() has
        // already settled pending_flush, so this never waits on a dead
        // socket.
        if let Some(sink) = self.sink().map(JsCell::get) {
            if !self.flags.aborted() && !sink.is_aborted() {
                // Only defer when there is still a live response to drain the
                // flush through: on_writable (which resolves the flush via
                // flush_promise) is armed on `resp`. With no response the flush
                // can never settle, so taking a ref and attaching here would
                // leak the ref and hang the request; fall through to teardown.
                if let Some(flush) = sink.pending_flush
                    && self.resp.get().is_some()
                {
                    stream_log!("handleResolveStream: waiting for pending flush");
                    debug_assert!(self.server.get().is_some());
                    let global_this = self.server().global_this();
                    let cell = self.create_promise_cell(global_this);
                    // S008: `JSPromise` is an `opaque_ffi!` ZST — safe `*const → &` deref.
                    jsc::JSPromise::opaque_ref(flush).to_js().then_with_value(
                        global_this,
                        cell,
                        Self::ON_RESOLVE_STREAM,
                        Self::ON_REJECT_STREAM,
                    );
                    return;
                }
            }
        }

        let mut wrote_anything = false;
        let mut ended_response = false;
        if let Some(sink) = self.sink.replace(None) {
            let aborted = self.flags.aborted() || sink.get().is_aborted();
            self.flags.set_aborted(aborted);
            wrote_anything = sink.get().wrote > 0;
            ended_response = sink.get().ended_response;
            if ended_response {
                // `resp` may be freed; the sink already resumed it. Clear these
                // before `detach()` below re-enters JS so any drain callback /
                // `on_start_buffering` reached from there early-returns.
                self.flags.set_request_body_paused(false);
                self.detach_request_body_producer();
            }

            let sink_global = sink.with_mut(|sink| {
                sink.finalize();
                sink.global_this
                    .expect("sink.global_this set in do_render_stream")
            });
            sink.with_mut(|sink| {
                ResponseStreamJSSink::<SSL_ENABLED>::detach(&mut sink.source, &sink_global)
            });
            ResponseStream::destroy(sink);
        }

        debug_assert!(self.server.get().is_some());
        // server is a BACKREF; `global_this()` returns a lifetime decoupled
        // from `&self`.
        let global_this = self.server().global_this();
        if let Some(resp) = self.response() {
            if let Some(stream) = resp.get_body_readable_stream() {
                stream.value.ensure_still_alive();
                resp.detach_readable_stream(global_this);

                stream.done();
            }

            *resp.get_body_value() = Body::Value::Used;
        }

        if self.is_aborted_or_ended() {
            // Still ours to release after a stop; see `end_already_responded_stream`.
            if !MUX && ended_response {
                self.end_already_responded_stream();
            }
            return;
        }

        stream_log!("onResolve({})", wrote_anything);
        // HTTP/1 only: the sink already fully ended the response, so `resp`
        // can no longer be dereferenced (see `end_already_responded_stream`).
        // This resolution can run arbitrarily later than the end: e.g. a
        // direct stream whose `pull()` calls `controller.end()` and then
        // awaits a promise the user only settles after the client has
        // disconnected. H2/H3 keep the end_stream() path: their `resp` is still
        // alive here and its still-armed onAborted must be disarmed.
        if !MUX && ended_response {
            self.end_already_responded_stream();
            return;
        }
        if !self.flags.has_written_status() {
            self.render_metadata();
        }
        self.end_stream(self.should_close_connection());
    }

    pub(crate) fn on_resolve_stream(
        _global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        stream_log!("onResolveStream");
        let args = callframe.arguments();
        let Some(claim) = native_promise_context::take::<Self>(args[args.len() - 1]) else {
            return Ok(JSValue::UNDEFINED);
        };
        let req = claim.this_ptr();
        let _claim = claim;
        req.promise_cell.set(JSValue::ZERO);
        req.handle_resolve_stream();
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn on_reject_stream(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        stream_log!("onRejectStream");
        let args = callframe.arguments();
        let Some(claim) = native_promise_context::take::<Self>(args[args.len() - 1]) else {
            return Ok(JSValue::UNDEFINED);
        };
        let err = args[0];
        let req = claim.this_ptr();
        let _claim = claim;
        req.promise_cell.set(JSValue::ZERO);

        req.handle_reject_stream(global_this, err);
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn handle_reject_stream(&self, global_this: &JSGlobalObject, err: JSValue) {
        stream_log!("handleRejectStream");

        let mut ended_response = false;
        if let Some(sink) = self.sink.replace(None) {
            ended_response = sink.get().ended_response;
            if ended_response {
                // `resp` may be freed; the sink already resumed it. Clear before JS below.
                self.flags.set_request_body_paused(false);
                self.detach_request_body_producer();
            }
            let sink_global = sink.with_mut(|sink| {
                if let Some(prom) = sink.pending_flush.take() {
                    // The promise value was protected when pending_flush was
                    // assigned (flushFromJS / endFromJS). Drop that root before
                    // abandoning the pointer, otherwise it leaks for the
                    // lifetime of the VM.
                    // S008: `JSPromise` is an `opaque_ffi!` ZST — safe deref.
                    bun_opaque::opaque_deref_mut(prom).to_js().unprotect();
                }
                sink.set_done();
                let aborted = self.flags.aborted() || sink.is_aborted();
                self.flags.set_aborted(aborted);
                sink.finalize();
                sink.global_this
                    .expect("sink.global_this set in do_render_stream")
            });
            sink.with_mut(|sink| {
                ResponseStreamJSSink::<SSL_ENABLED>::detach(&mut sink.source, &sink_global)
            });
            ResponseStream::destroy(sink);
        }

        if let Some(resp) = self.response() {
            // NOTE: the body value is read after the stream calls (the check
            // observes the post-detach state).
            if let Some(stream) = resp.get_body_readable_stream() {
                stream.value.ensure_still_alive();
                resp.detach_readable_stream(global_this);
                stream.done();
            }

            let body_value = resp.get_body_value();
            if matches!(body_value, Body::Value::Locked(_)) {
                *body_value = Body::Value::Used;
            }
        }

        // aborted so call finalizeForAbort
        if self.is_aborted_or_ended() {
            // Still ours to release after a stop; see `end_already_responded_stream`.
            if !MUX && ended_response {
                self.end_already_responded_stream();
            }
            return;
        }

        stream_log!("onReject()");

        // `resp` must not be dereferenced once the sink has already ended the
        // response (see `end_already_responded_stream`).
        if !ended_response && !self.flags.has_written_status() {
            self.render_metadata();
        }

        // Production mode keeps this asynchronous JS path quiet.
        if DEBUG_MODE && self.report_committed_body_error(err, !ended_response) {
            return;
        }
        // HTTP/1 only: the sink already fully ended the response, so `resp`
        // can no longer be dereferenced (see `end_already_responded_stream`).
        // H2/H3 keep the end_stream() path: their `resp` is still alive here
        // and its still-armed onAborted must be disarmed.
        if !MUX && ended_response {
            self.end_already_responded_stream();
            return;
        }
        self.close_incomplete_stream();
    }

    /// Reports a body failure that arrived after the status line was
    /// committed. Under a bake dev server the error page ends the response:
    /// returns `true`, and `resp` must not be touched again.
    fn report_committed_body_error(&self, err: JSValue, resp_writable: bool) -> bool {
        if err.is_empty_or_undefined_or_null() {
            return false;
        }
        let server = self.server();
        if !DEBUG_MODE || !resp_writable || server.dev_server().is_none() {
            server.vm().as_mut().run_error_handler(err, None);
            return false;
        }

        let mut exception_list: jsc::ExceptionList = Vec::new();
        server
            .vm()
            .as_mut()
            .run_error_handler(err, Some(&mut exception_list));

        let bb = DevErrorPage {
            message: b"Stream error during server-side rendering",
            cwd: bun_resolver::fs::FileSystem::get().top_level_dir,
            exceptions: &exception_list,
            log: None,
        }
        .render();

        if let Some(resp) = self.resp.get() {
            // SAFETY: FFI handle
            resp.write(&bb);
        }

        self.end_stream(self.should_close_connection());
        true
    }

    /// `value` is the body of the `Response` being rendered.
    pub(crate) fn do_render_with_body(
        &self,
        value: &mut Body::Value,
        owned_readable: Option<WebCore::ReadableStream>,
    ) {
        let this = self;
        if this.drain_microtasks().is_err() {
            return;
        }

        // If a ReadableStream can trivially be converted to a Blob, do so.
        // If it's a WTFStringImpl and it cannot be used as a UTF-8 string, convert it to a Blob.
        value.to_blob_if_possible();
        let global_this = this.server().global_this();
        match value {
            Body::Value::Error(err_ref) => {
                let js_err = err_ref.to_js(global_this);
                let _ = value.use_();
                if this.is_aborted_or_ended() {
                    return;
                }
                this.run_error_handler(js_err);
                return;
            }
            // The handler returned a Response whose body was already used,
            // usually the same Response object returned for a second request.
            // A disturbed body is an error, not a silent empty 200.
            Body::Value::Used => {
                if this.is_aborted_or_ended() {
                    return;
                }
                let js_err = global_this
                    .err(
                        jsc::ErrorCode::BODY_ALREADY_USED,
                        format_args!(
                            "Response body already used. A Response body can only be sent once; create a new Response for each request."
                        ),
                    )
                    .to_js();
                this.run_error_handler(js_err);
                return;
            }
            Body::Value::WTFStringImpl(_) | Body::Value::InternalBlob(_) | Body::Value::Blob(_) => {
                // toBlobIfPossible checks for WTFString needing a conversion.
                this.blob.set(value.use_as_any_blob_allow_non_utf8_string());
                this.render_with_blob_from_body_value();
                return;
            }
            Body::Value::Locked(lock) => {
                if this.is_aborted_or_ended() {
                    return;
                }
                let readable_stream: Option<WebCore::ReadableStream> = 'brk: {
                    if let Some(stream) = lock.readable.get() {
                        // we hold the stream alive until we're done with it
                        // NOTE: `Strong` is move-only — take() transfers ownership.
                        this.response_body_readable_stream_ref
                            .set(core::mem::take(&mut lock.readable));
                        break 'brk Some(stream);
                    }
                    if let Some(stream) = owned_readable {
                        // response owns the stream, so we hold a strong reference to it
                        this.response_body_readable_stream_ref
                            .set(readable_stream::Strong::init(stream, global_this));
                        break 'brk Some(stream);
                    }
                    None
                };
                if let Some(stream) = readable_stream {
                    *value = Body::Value::Used;

                    if stream.is_locked(global_this) {
                        stream_log!("was locked but it shouldn't be");
                        let err = jsc::SystemError {
                            code: BunString::static_(<&'static str>::from(
                                jsc::ErrorCode::ERR_STREAM_CANNOT_PIPE,
                            )),
                            message: BunString::static_(
                                "Stream already used, please create a new one",
                            ),
                            ..Default::default()
                        };
                        stream.value.unprotect();
                        let js_err = err.to_error_instance(global_this);
                        this.run_error_handler(js_err);
                        return;
                    }

                    match stream.ptr {
                        readable_stream::Source::Invalid => {
                            this.response_body_readable_stream_ref
                                .with_mut(|s| s.deinit());
                            // Stream is invalid, render empty body
                            this.do_render_blob();
                            return;
                        }
                        // toBlobIfPossible will typically convert .Blob streams, or .File streams into a Blob object, but cannot always.
                        readable_stream::Source::Blob(_)
                        | readable_stream::Source::File(_)
                        // These are the common scenario:
                        | readable_stream::Source::JavaScript => {
                            if let Some(resp) = this.resp.get() {
                                resp.corked(|| this.do_render_stream(stream));
                            }
                            return;
                        }

                        readable_stream::Source::Bytes(_) => {
                            // BACKREF: `Source::Bytes` stores a live non-null
                            // `*mut ByteStream` (the JS wrapper's `m_ctx` heap
                            // payload, kept alive by `stream`). R-2: all touched
                            // ByteStream methods/fields are `&self`/interior-mutable.
                            let byte_stream =
                                stream.ptr.bytes().expect("Source::Bytes payload is non-null");
                            debug_assert!(byte_stream.sink.get().is_none());
                            debug_assert!(this.byte_stream.get().is_none());
                            if this.resp.get().is_none() {
                                // we don't have a response, so we can discard the stream
                                stream.done();
                                this.response_body_readable_stream_ref
                                    .with_mut(|s| s.deinit());
                                return;
                            }
                            let resp = this.resp.get().expect("infallible: resp bound");
                            // If we've received the complete body by the time this function is called
                            // we can avoid streaming it and just send it all at once.
                            if byte_stream.has_received_last_chunk.get() {
                                let mut byte_list = byte_stream.drain();
                                this.blob.set(AnyBlob::from_array_list(
                                    byte_list.move_to_list_managed(),
                                ));
                                this.response_body_readable_stream_ref
                                    .with_mut(|s| s.deinit());
                                this.do_render_blob();
                                return;
                            }
                            // The pipe's ref; released by `end_chunk`, or by
                            // `on_abort` when the pipe can no longer finish.
                            let prev = this
                                .byte_stream_ref
                                .replace(Some(RefPtr::from_this(this.this())));
                            debug_assert!(prev.is_none());
                            // Same as do_render_stream's Pending branch: the
                            // body is in flight, so `handle_reject` must not
                            // fall through to render_missing() and end it.
                            this.flags.set_has_marked_pending(true);
                            byte_stream.sink.set(WebCore::SinkHandle::ServerResponse(
                                AnyRequestContext::init(this.this()),
                            ));
                            stream.lock_native(global_this);
                            byte_stream.signal_consumer_attached();
                            // Deinit the old Strong reference before creating a new one
                            // to avoid leaking the Strong.Impl memory
                            this.response_body_readable_stream_ref
                                .with_mut(|s| s.deinit());
                            this.response_body_readable_stream_ref
                                .set(readable_stream::Strong::init(stream, global_this));

                            this.byte_stream.set(Some(byte_stream));
                            let mut response_buf = byte_stream.take_buffer();
                            let buffer = response_buf.move_to_list();
                            let has_body_bytes = !buffer.is_empty();
                            this.response_buf_owned.set(buffer);

                            // we don't set size here because even if we have a hint
                            // uWebSockets won't let us partially write streaming content
                            this.blob.with_mut(|b| b.detach());

                            // if we've received metadata and part of the body, send everything we can and drain
                            if has_body_bytes {
                                resp.corked(|| this.drain_response_buffer_and_metadata());
                            } else if matches!(
                                byte_stream.parent_const().producer.get(),
                                WebCore::streams::SourceHandle::HTMLRewriter(_)
                            ) {
                                // Defer status/headers to the first chunk/end
                                // so a pre-first-byte handler failure can
                                // still reach `error()`.
                            } else {
                                // if we only have metadata to send, send it now
                                resp.corked(|| this.render_metadata());
                            }
                            // Wake the producer after the older bytes are queued.
                            byte_stream.signal_drained();
                            return;
                        }
                    }
                }

                if lock.on_receive_value.is_some() || lock.task.is_some() {
                    // someone else is waiting for the stream or waiting for `onStartStreaming`
                    let Ok(readable) = value.to_readable_stream(global_this) else {
                        return;
                    }; // TODO: properly propagate exception upwards
                    readable.ensure_still_alive();
                    this.do_render_with_body(value, None);
                    return;
                }

                // No stream and no other consumer: wait for `Value::resolve`.
                // The registration holds a ref on `this`, released by
                // `render_pending_body_value`.
                let prev = this
                    .body_value_ref
                    .replace(Some(RefPtr::from_this(this.this())));
                debug_assert!(prev.is_none());
                this.flags.set_has_marked_pending(true);
                lock.on_receive_value = Some(Body::ReceiveValue::Server(AnyRequestContext::init(
                    this.this(),
                )));

                return;
            }
            _ => {}
        }

        this.do_render_blob();
    }

    /// `ByteStream`'s sink (`SinkHandle::ServerResponse`) delivering a chunk of
    /// the natively piped response body.
    pub(crate) fn write_chunk(
        this: ThisPtr<Self>,
        stream: &WebCore::streams::Result,
    ) -> WebCore::streams::Writable {
        if this.is_aborted_or_ended() {
            return WebCore::streams::Writable::Done;
        }
        let resp = this.resp.get().expect("infallible: resp bound");

        // A rewriter-produced `Source::Bytes` body defers metadata until the
        // first chunk so a pre-first-byte failure can still reach the
        // server's `error()` hook. Flush it now, corked.
        if !this.flags.has_written_status() {
            resp.corked(|| this.render_metadata());
        }

        let chunk = stream.slice();
        // on failure, it will continue to allocate
        // we can't do buffering ourselves here or it won't work
        // uSockets will append and manage the buffer
        // so any write will buffer if the write fails
        match resp.write(chunk) {
            uws::WriteResult::WantMore(n) => WebCore::streams::Writable::Owned(n as BlobSizeType),
            uws::WriteResult::Backpressure(n) => {
                this.flags.set_has_marked_pending(true);
                resp.on_writable_this(Self::on_writable_byte_stream, this);
                WebCore::streams::Writable::Backpressure(n as BlobSizeType)
            }
        }
    }

    /// `ByteStream`'s sink (`SinkHandle::ServerResponse`) reporting the end of
    /// the natively piped response body. Releases [`byte_stream_ref`](Self::byte_stream_ref).
    pub(crate) fn end_chunk(this: ThisPtr<Self>, err: Option<&WebCore::streams::StreamError>) {
        // The stream has already dropped this sink; the pipe's ref is this frame's.
        let _pipe_ref = this.byte_stream_ref.take();
        this.byte_stream.set(None);

        if this.is_aborted_or_ended() {
            return;
        }
        if let Some(err) = err {
            // No status committed yet: the upstream producer (e.g. a
            // suspended `HTMLRewriter` transform whose async handler
            // rejected) failed before any bytes were emitted. Drop the
            // stream and hand the error to the server's `error()` hook so it
            // can supply the response.
            if !this.flags.has_written_status() {
                let global_this = this.server().global_this();
                let js_err = err.to_js(global_this);
                this.response_body_readable_stream_ref
                    .with_mut(|s| s.deinit());
                this.run_error_handler(js_err);
                return;
            }
            // Committed status: report in both modes, then close.
            let global_this = this.server().global_this();
            if this.report_committed_body_error(err.to_js(global_this), true) {
                return;
            }
            this.close_incomplete_stream();
            return;
        } else if !this.flags.has_written_status() {
            // Upstream ended cleanly before any chunk: flush the deferred
            // status/headers so the client sees them before the terminator.
            if let Some(resp) = this.resp.get() {
                resp.corked(|| this.render_metadata());
            }
        }
        this.end_stream(this.should_close_connection());
    }

    pub(crate) fn on_writable_byte_stream(
        this: ThisPtr<Self>,
        _write_offset: u64,
        _resp: uws::AnyResponse,
    ) -> bool {
        ctx_log!("onWritableByteStream");
        debug_assert!(this.resp.get().is_some());
        if this.is_aborted_or_ended() {
            return false;
        }
        // `resume()` re-enters `write_chunk`.
        if let Some(bs) = this.byte_stream.get() {
            bs.resume();
        }
        true
    }

    pub(crate) fn do_render_blob(&self) {
        // We are not corked
        // The body is small
        // Faster to do the memcpy than to do the two network calls
        // We are not streaming
        // This is an important performance optimization
        if self.flags.has_abort_handler() && self.blob.get().fast_size() < 16384 - 1024 {
            if let Some(resp) = self.resp.get() {
                resp.corked(|| self.do_render_blob_corked());
            }
        } else {
            self.do_render_blob_corked();
        }
    }

    fn do_render_blob_corked(&self) {
        self.render_metadata();
        self.render_bytes();
    }

    pub(crate) fn do_render_null_body_status(&self) {
        if self.flags.has_abort_handler() {
            if let Some(resp) = self.resp.get() {
                resp.corked(|| self.do_render_null_body_status_corked());
            }
        } else {
            self.do_render_null_body_status_corked();
        }
    }

    /// Render a response whose status forbids a body (RFC 9112 §6.3). `try_end`
    /// would put `Content-Length: 0` on a 304 (uWS only suppresses it for
    /// 1xx/204); RFC 9110 §8.6 only allows the 200's length, so forward the
    /// handler's value or emit none.
    fn do_render_null_body_status_corked(&self) {
        let this = self;

        let (status, app_content_length) = {
            let response: &Response = this.response().unwrap();
            let status = response.status_code();
            // Parsed before render_metadata() fast_remove()s it and derefs the headers.
            let app_cl = (status == 304)
                .then(|| {
                    let s = response
                        .get_init_headers_mut()?
                        .fast_get(jsc::HTTPHeaderName::ContentLength)?
                        .to_utf8();
                    bun_core::parse_int::<u64>(s.slice(), 10).ok()
                })
                .flatten();
            (status, app_cl)
        };

        this.render_metadata();

        // A null-body status never transmits the body.
        if let Some(server) = this.server.get()
            && let Some(response) = this.response()
            && matches!(response.get_body_value(), Body::Value::Locked(_))
        {
            Self::cancel_unread_body(response, server.global_this());
        }

        if status == 304 {
            if let Some(resp) = this.resp.get() {
                if let Some(len) = app_content_length {
                    resp.write_header_int(b"content-length", len);
                }
                // end_without_body skips writeMark(); keep Date as try_end did.
                resp.write_mark();
                this.end_without_body(this.should_close_connection());
                return;
            }
        }
        // render_bytes releases the in-flight ref on every path (resp gone included).
        this.render_bytes();
    }

    pub(crate) fn do_render(&self) {
        ctx_log!("doRender");

        if self.is_aborted_or_ended() {
            return;
        }
        let (value, owned_readable) = {
            let response: &Response = self.response().unwrap();
            let owned_readable = response.get_body_readable_stream();
            (response.get_body_value(), owned_readable)
        };
        self.do_render_with_body(value, owned_readable);
    }

    pub(crate) fn render_production_error(&self, status: u16) {
        if let Some(resp) = self.resp.get() {
            // `AnyResponse` is a `Copy` handle; methods take `self` by value.
            match status {
                404 => {
                    if !self.flags.has_written_status() {
                        resp.write_status(b"404 Not Found");
                        self.flags.set_has_written_status(true);
                    }
                    self.end_without_body(self.should_close_connection());
                }
                _ => {
                    const BODY: &[u8] = b"Something went wrong!";
                    if !self.flags.has_written_status() {
                        resp.write_status(b"500 Internal Server Error");
                        resp.write_header(b"content-type", b"text/plain");
                        self.flags.set_has_written_status(true);
                    }
                    if self.method == Method::HEAD {
                        resp.write_header_int(b"content-length", BODY.len() as u64);
                        self.end_without_body(self.should_close_connection());
                    } else {
                        self.end(BODY, self.should_close_connection());
                    }
                }
            }
        }
    }

    pub(crate) fn run_error_handler(&self, value: JSValue) {
        self.run_error_handler_with_status_code(value, 500);
    }

    /// `false` when the Response can be written. A status outside `100..=999`
    /// has no HTTP status line, so the Response can never reach the client:
    /// report it like a thrown error rather than writing an unparseable one.
    ///
    /// Takes the status, not the Response: `run_error_handler` below runs user
    /// JS, which may write through the cell pointer the caller holds.
    fn reject_unsendable_response(&self, status: u16) -> bool {
        if HTTPStatusText::is_sendable(status) {
            return false;
        }
        let Some(server) = self.server.get() else {
            self.render_production_error(500);
            return true;
        };
        let global_this = (*server).global_this();
        let err = global_this.create_error_instance(format_args!(
            "Cannot send a Response with status {status}. HTTP status codes must be between 100 and 999 (Response.error() returns status 0).",
        ));
        self.run_error_handler(err);
        true
    }

    fn ensure_pathname(&self) -> PathnameFormatter<'_, ThisServer, SSL_ENABLED, DEBUG_MODE, MUX> {
        PathnameFormatter { ctx: self }
    }

    #[inline]
    pub(crate) fn should_close_connection(&self) -> bool {
        if let Some(resp) = self.resp.get() {
            return resp.should_close_connection();
        }
        false
    }

    fn finish_running_error_handler(&self, value: JSValue, status: u16) {
        let Some(server) = self.server.get() else {
            return self.render_production_error(status);
        };
        let server = &*server;
        let global_this = server.global_this();
        // `ServerLike::vm()` is the process-static VM `BackRef`; `as_mut()` is
        // the single audited `&mut VirtualMachine` accessor.
        let vm = server.vm().as_mut();
        if DEBUG_MODE {
            let mut exception_list: jsc::ExceptionList = Vec::new();
            let prev_exception_list = vm.on_unhandled_rejection_exception_list;
            vm.on_unhandled_rejection_exception_list = Some(NonNull::from(&mut exception_list));
            (vm.on_unhandled_rejection)(vm, global_this, value);
            vm.on_unhandled_rejection_exception_list = prev_exception_list;

            let log = vm.log_mut().unwrap();
            bun_core::pretty_errorln!(
                "<r><red>{:?}<r> - <b>{}<r> failed",
                self.method,
                self.ensure_pathname()
            );
            let msg = format!("{:?} - {} failed", self.method, self.ensure_pathname());
            self.render_default_error(log, &exception_list, msg.as_bytes());
            log.reset();
            return;
        }
        if status != 404 {
            (vm.on_unhandled_rejection)(vm, global_this, value);
        }
        self.render_production_error(status);
        vm.log_mut().unwrap().reset();
    }

    pub(crate) fn run_error_handler_with_status_code_dont_check_responded(
        &self,
        value: JSValue,
        status: u16,
    ) {
        jsc::mark_binding!();
        if let Some(server) = self.server.get() {
            let server = &*server;
            let on_error = server.config().on_error;
            if !on_error.is_empty() && !self.flags.has_called_error_handler() {
                self.flags.set_has_called_error_handler(true);
                let result = on_error
                    .call(
                        server.global_this(),
                        server.js_value().try_get().unwrap_or(JSValue::UNDEFINED),
                        &[value],
                    )
                    .unwrap_or_else(|err| server.global_this().take_exception(err));
                let _keep = jsc::EnsureStillAlive(result);
                // error() may have ended the request or called server.upgrade(req),
                // either of which already released this context's ref.
                if self.is_aborted_or_ended() || self.did_upgrade_web_socket() {
                    self.discard_handler_result(server.global_this(), result);
                    return;
                }
                if self.resp.get().is_some_and(|resp| resp.is_closed()) {
                    self.on_connection_closed_during_dispatch(server, result);
                    return;
                }
                if !result.is_empty_or_undefined_or_null() {
                    if let Some(err) = result.to_error() {
                        self.finish_running_error_handler(err, status);
                        return;
                    } else if let Some(promise) = result.as_any_promise() {
                        self.process_on_error_promise(result, promise, value, status);
                        return;
                    // `result` is GC-rooted by `_keep` (EnsureStillAlive)
                    // across the render() call.
                    } else if let Some(response) = as_response(result) {
                        // An unsendable Response from the error handler itself
                        // falls through to the default error page below.
                        if HTTPStatusText::is_sendable(response.status_code()) {
                            // A file or streaming body defers `render_metadata`
                            // past this frame, where `_keep` is the only root,
                            // so root the Response the way the async error
                            // path does or the deferred flush can read a
                            // collected weakref.
                            if self.flags.response_protected() {
                                self.response_jsvalue.get().unprotect();
                            }
                            self.response_jsvalue.set(result);
                            self.flags.set_response_protected(false);
                            self.protect_for_body_and_render(result, response);
                            return;
                        }
                    }
                }
            }
        }

        self.finish_running_error_handler(value, status);
    }

    fn process_on_error_promise(
        &self,
        promise_js: JSValue,
        promise: jsc::AnyPromise,
        value: JSValue,
        status: u16,
    ) {
        let ctx = self;
        debug_assert!(ctx.server.get().is_some());
        let server = ctx.server();
        let vm = server.vm();

        match promise.unwrap(vm.global().vm(), jsc::PromiseUnwrapMode::MarkHandled) {
            jsc::PromiseResult::Pending => {
                ctx.flags.set_is_error_promise_pending(true);
                let cell = ctx.create_promise_cell(server.global_this());
                promise_js.then_with_value(
                    server.global_this(),
                    cell,
                    Self::ON_RESOLVE,
                    Self::ON_REJECT,
                ); // TODO: properly propagate exception upwards
            }
            jsc::PromiseResult::Fulfilled(fulfilled_value) => {
                // `fulfilled_value` is rooted via ensure_still_alive() below for
                // as long as `response` is used.
                let Some(response) = as_response(fulfilled_value) else {
                    ctx.finish_running_error_handler(value, status);
                    return;
                };

                if !HTTPStatusText::is_sendable(response.status_code()) {
                    ctx.finish_running_error_handler(value, status);
                    return;
                }

                // Same as handle_resolve: release a still-protected original.
                if ctx.flags.response_protected() {
                    ctx.response_jsvalue.get().unprotect();
                }
                ctx.response_jsvalue.set(fulfilled_value);
                fulfilled_value.ensure_still_alive();
                ctx.flags.set_response_protected(false);

                ctx.protect_for_body_and_render(fulfilled_value, response);
                return;
            }
            jsc::PromiseResult::Rejected(err) => {
                ctx.finish_running_error_handler(err, status);
                return;
            }
        }
    }

    pub(crate) fn run_error_handler_with_status_code(&self, value: JSValue, status: u16) {
        jsc::mark_binding!();
        let Some(resp) = self.resp.get() else { return };
        if resp.has_responded() {
            return;
        }
        // The VM has stopped (the handler "threw" its termination): no error handler, no error page;
        // the stop closes the server's connections.
        if let Some(server) = self.server.get()
            && !server.vm().script_allowed()
        {
            return;
        }

        self.run_error_handler_with_status_code_dont_check_responded(value, status);
    }

    pub(crate) fn render_metadata(&self) {
        // `AnyResponse` is a `Copy` handle; methods take `self` by value.
        let Some(resp) = self.resp.get() else { return };

        // For plain in-memory bodies this runs synchronously from
        // render() before any backpressure gap, so the Response is
        // always live here. File / stream bodies that call this after
        // an async hop keep the Response rooted via response_protected.
        let response: &Response = self.response().unwrap();
        let sendfile = self.sendfile.get();
        let mut status = response.status_code();
        let blob = self.blob.get();
        let mut needs_content_range = self.flags.needs_content_range()
            && (sendfile.total > 0 || sendfile.remain < blob.size());

        let size = if needs_content_range {
            sendfile.remain
        } else {
            blob.size()
        };

        let (content_type, needs_content_type, content_type_needs_free) =
            get_content_type(response.get_init_headers_mut(), blob);
        // NOTE: `MimeType` owns a `Cow<'static, [u8]>`; Drop handles the owned case.
        // Hold the value past all reads below, then let it drop at scope end.
        let _ct_guard = scopeguard::guard(content_type_needs_free, |_needs| {
            // Drop of `content_type` (moved into closure capture below would
            // change borrow lifetimes); rely on natural end-of-scope drop.
        });
        let mut has_content_disposition = false;
        let mut has_content_range = false;
        if let Some(mut headers_) = response.swap_init_headers() {
            has_content_disposition = headers_.fast_has(jsc::HTTPHeaderName::ContentDisposition);
            has_content_range = headers_.fast_has(jsc::HTTPHeaderName::ContentRange);
            // For .slice()-driven ranges, only promote to 206 if the user
            // also set Content-Range (preserves the old contract). For an
            // incoming Range: header (sendfile.total > 0) we always 206.
            needs_content_range = needs_content_range && (sendfile.total > 0 || has_content_range);
            if needs_content_range {
                status = 206;
            }

            self.do_write_status(status);
            self.do_write_headers(&mut headers_);
            // `HeadersRef` is RAII — its Drop
            // already calls `WebCore__FetchHeaders__deref`, so an explicit
            // `.deref()` here would resolve (via DerefMut) to the inherent
            // `FetchHeaders::deref` and double-free the C++ object.
            drop(headers_);
        } else if needs_content_range {
            status = 206;
            self.do_write_status(status);
        } else {
            self.do_write_status(status);
        }

        if let Some(mut cookies) = self.cookies.replace(None) {
            let global_this = self.server().global_this();
            let resp = self.resp.get().expect("infallible: resp bound");
            let r = cookies.write(global_this, uws::ResponseKind::of(resp), resp.as_ptr());
            // `cookies` drops here, releasing the ref taken in `set_cookies`.
            if r.is_err() {
                return;
            } // TODO: properly propagate exception upwards
        }
        let blob = self.blob.get();

        if needs_content_type
            // do not insert the content type if it is the fallback value
            // we may not know the content-type when streaming
            && (!blob.is_detached()
                || content_type.value.as_ptr() != bun_http_types::MimeType::OTHER.value.as_ptr())
            && !strings::contains_any(&content_type.value, b"\r\n\0")
        {
            resp.write_header(b"content-type", &content_type.value);
        }

        // Advertise the QUIC endpoint on H1/H2 responses so browsers can
        // discover it (RFC 7838). Multiple Alt-Svc fields are valid, so a
        // user-supplied one composes rather than conflicts.
        if !matches!(resp, uws::AnyResponse::H3(_)) {
            if let Some(alt) = self.server().h3_alt_svc() {
                resp.write_header(b"alt-svc", alt);
            }
        }

        // automatically include the filename when:
        // 1. Bun.file("foo")
        // 2. The content-disposition header is not present
        if !has_content_disposition && content_type.category.autoset_filename() {
            if let Some(filename) = blob.get_file_name() {
                let basename = bun_paths::basename(&filename);
                if !basename.is_empty() {
                    let mut filename_buf = [0u8; 1024];
                    let truncated = &basename[..basename.len().min(1024 - 32)];
                    if !strings::contains_any(truncated, b"\r\n\0\"") {
                        let header_value = {
                            let mut w = &mut filename_buf[..];
                            if write!(w, "filename=\"{}\"", bstr::BStr::new(truncated)).is_ok() {
                                let written = 1024 - w.len();
                                &filename_buf[..written]
                            } else {
                                &b""[..]
                            }
                        };
                        if !header_value.is_empty() {
                            resp.write_header(b"content-disposition", header_value);
                        }
                    }
                }
            }
        }

        if self.flags.needs_content_length() {
            resp.write_header_int(b"content-length", size as u64);
            resp.mark_wrote_content_length_header();
            self.flags.set_needs_content_length(false);
        }

        if needs_content_range && !has_content_range {
            let mut crbuf = [0u8; RangeRequest::CONTENT_RANGE_BUF];
            let end = sendfile.offset + sendfile.remain.saturating_sub(1);
            // `total > 0` ⇒ we resolved an incoming Range header against the
            // stat'd size, so the full size is meaningful. Otherwise this is a
            // `.slice()`-driven range — omit the full size (it can change
            // between requests and may leak PII).
            let header_value = RangeRequest::format_content_range(
                &mut crbuf,
                RangeRequest::Result::Satisfiable {
                    start: sendfile.offset,
                    end,
                },
                (sendfile.total > 0).then_some(sendfile.total),
            );
            resp.write_header(b"content-range", header_value);
            if sendfile.total > 0 {
                resp.write_header(b"accept-ranges", b"bytes");
            }
            self.flags.set_needs_content_range(false);
        }
    }

    fn do_write_status(&self, status: u16) {
        debug_assert!(!self.flags.has_written_status());
        self.flags.set_has_written_status(true);

        // `AnyResponse` is a `Copy` handle; methods take `self` by value.
        let Some(resp) = self.resp.get() else { return };
        if let Some(text) = HTTPStatusText::get(status) {
            resp.write_status(text);
        } else {
            let mut buf = [0u8; 48];
            let mut w = &mut buf[..];
            let _ = write!(w, "{} HM", status);
            let written = 48 - w.len();
            resp.write_status(&buf[..written]);
        }
    }

    fn do_write_headers(&self, headers: &mut FetchHeaders) {
        ctx_log!("writeHeaders");
        headers.fast_remove(jsc::HTTPHeaderName::ContentLength);
        headers.fast_remove(jsc::HTTPHeaderName::TransferEncoding);
        if let Some(resp) = self.resp.get() {
            headers.to_uws_response(uws::ResponseKind::of(resp), resp.as_ptr());
        }
    }

    pub(crate) fn render_bytes(&self) {
        let bytes = self.blob.get().slice();
        if let Some(resp) = self.resp.get() {
            if !resp.try_end(bytes, bytes.len(), self.should_close_connection()) {
                self.flags.set_has_marked_pending(true);
                resp.on_writable_this(Self::on_writable_bytes, self.this());
                return;
            }
        }
        self.detach_response();
        self.end_request_streaming_and_drain();
        self.release_in_flight();
    }

    /// Replace the tracked Response. Drops the previous weak ref (if any)
    /// before taking a new one so the old Response's allocation can be
    /// freed once its own strong refs go to zero. `response` is the payload of
    /// a JS wrapper the caller keeps GC-rooted (see [`as_response`]).
    fn set_response(&self, response: ThisPtr<Response>) {
        self.response_weakref.with_mut(|weak| {
            if weak.get_ref().is_some() && weak.is(response) {
                return;
            }
            *weak = response::WeakRef::from_this(response);
        });
    }

    /// `response`: as for [`Self::set_response`].
    pub(crate) fn render(&self, response: ThisPtr<Response>) {
        ctx_log!("render");

        // A HEAD response never carries content (RFC 9110 §9.3.2). The normal
        // handler path branches to `do_render_head_response` before reaching
        // here, but the `error()` handler paths call `render()` directly.
        if self.method == Method::HEAD {
            if let Some(resp) = self.resp.get() {
                resp.corked(|| self.do_render_head_response(response));
            }
            return;
        }

        self.set_response(response);

        if HTTPStatusText::is_null_body(response.status_code()) {
            self.do_render_null_body_status();
            return;
        }

        self.do_render();
    }

    /// [`Self::render`] for the Response a handler just returned, whose JS
    /// wrapper `response_value` is already stored in `response_jsvalue`. A
    /// file or streaming body is still being sent after this frame returns,
    /// so for those the wrapper is protected first; in-memory bodies leave it
    /// unprotected (see `response_jsvalue`).
    fn protect_for_body_and_render(&self, response_value: JSValue, response: ThisPtr<Response>) {
        // The only borrow of the body; it ends before `render` reborrows it.
        let body_value = response.get().get_body_value();
        body_value.to_blob_if_possible();
        let sent_after_return = match body_value {
            Body::Value::Blob(blob) => shim::blob_needs_to_read_file(blob),
            Body::Value::Locked(_) => true,
            _ => false,
        };
        if sent_after_return {
            response_value.protect();
            self.flags.set_response_protected(true);
        }
        self.render(response);
    }

    /// uWS `on_data`: a chunk of the request body arrived.
    pub(crate) fn on_buffered_body_chunk(this: ThisPtr<Self>, chunk: &[u8], last: bool) {
        ctx_log!("onBufferedBodyChunk {} {}", chunk.len(), last);
        let _pin = Self::pin(this);
        debug_assert!(this.resp.get().is_some());

        this.flags.set_is_waiting_for_request_body(!last);
        if this.is_aborted_or_ended() || this.flags.has_marked_complete() {
            return;
        }
        if !last && chunk.is_empty() {
            // Sometimes, we get back an empty chunk
            // We have to ignore those chunks unless it's the last one
            return;
        }
        let server = this.server();
        let vm = server.vm();
        let global_this = server.global_this();

        // After the user does request.body,
        // if they then do .text(), .arrayBuffer(), etc
        // we can no longer hold the strong reference from the body value ref.
        let readable = this.request_body_readable_stream_ref.get().get();
        if let Some(readable) = readable {
            debug_assert!(this.request_body_buf.get().is_empty());

            // Cap streamed bytes against maxRequestBodySize too — the up-front
            // check only sees Content-Length (see the buffering branch below).
            let streamed_len = this
                .request_body_streamed_len
                .get()
                .saturating_add(chunk.len());
            this.request_body_streamed_len.set(streamed_len);
            if streamed_len > server.config().max_request_body_size {
                this.resp
                    .get()
                    .expect("infallible: resp bound")
                    .clear_on_data();
                this.flags.set_is_waiting_for_request_body(false);
                this.resume_request_body_socket();

                let _exit = vm.enter_event_loop_scope();

                // Release the strong stream ref like the `last` arm does, then
                // error the stream so a pending or future read rejects instead
                // of hanging forever.
                let _strong = this
                    .request_body_readable_stream_ref
                    .replace(readable_stream::Strong::default());

                readable.value.ensure_still_alive();
                if let Some(bytes) = readable.ptr.bytes() {
                    let source = bytes.parent_const();
                    source.producer.set(WebCore::streams::SourceHandle::None);
                    let mut err = Body::ValueError::Message(BunString::static_(
                        "Request body exceeded maxRequestBodySize",
                    ));
                    bytes.on_data(WebCore::streams::Result::Err(
                        err.to_stream_error(global_this),
                    ));
                    err.reset();
                }

                // Route through the normal end path so this.resp is detached
                // and the in-flight ref released (see the buffering branch below).
                if let Some(resp) = this.resp.get() {
                    if !resp.has_responded() {
                        this.flags.set_has_written_status(true);
                        resp.write_status(b"413 Payload Too Large");
                    }
                }
                this.end_without_body(!MUX);
                return;
            }

            let _exit = vm.enter_event_loop_scope();

            // `RawSlice` is non-owning; ownership of `chunk` stays with the
            // caller for the duration of the synchronous `on_data` call.
            let borrowed = bun_ptr::RawSlice::new(chunk);
            if !last {
                // BACKREF: `Source::Bytes` payload is the live non-null `m_ctx`
                // heap `ByteStream` kept alive by `readable` for this call.
                let Some(bytes) = readable.ptr.bytes() else {
                    return;
                };
                bytes.on_data(WebCore::streams::Result::Temporary(borrowed));

                // What `on_data` buffered; `on_stream_drained` resumes once it empties.
                let buffered = bytes.buffer.get().len().saturating_sub(bytes.offset.get());
                if bytes.buffer_action.get().is_some()
                    || (bytes.sink.get().is_some() && !bytes.sink_paused.get())
                {
                    // buffer-action / draining sink: no `on_pull`; keep reading.
                    this.resume_request_body_socket();
                } else if buffered >= REQUEST_BODY_HIGH_WATER_MARK {
                    this.pause_request_body_socket();
                }
            } else {
                this.resume_request_body_socket();
                // Moved out so the Strong (and its underlying GC handle) is
                // released at scope exit via `Drop` on `strong::Optional`.
                let _strong = this
                    .request_body_readable_stream_ref
                    .replace(readable_stream::Strong::default());
                this.request_body_take_unref();

                readable.value.ensure_still_alive();
                // BACKREF: `Source::Bytes` payload is the live non-null `m_ctx`
                // heap `ByteStream` kept alive by `readable` for this call.
                let Some(bytes) = readable.ptr.bytes() else {
                    return;
                };
                let source = bytes.parent_const();
                source.producer.set(WebCore::streams::SourceHandle::None);
                bytes.on_data(WebCore::streams::Result::TemporaryAndDone(borrowed));
            }

            return;
        }

        // This is the start of a task, so it's a good time to drain
        if let Some(body) = this.request_body_slot() {
            // The up-front maxRequestBodySize check in the server only
            // sees Content-Length. HTTP/3 (and H1 chunked) bodies may
            // omit it, so cap accumulated bytes here too — otherwise a
            // single CL-less stream can grow request_body_buf without
            // bound.
            if this
                .request_body_buf
                .get()
                .len()
                .saturating_add(chunk.len())
                > server.config().max_request_body_size
            {
                this.request_body_buf.set(Vec::new());
                this.resp
                    .get()
                    .expect("infallible: resp bound")
                    .clear_on_data();
                this.flags.set_is_waiting_for_request_body(false);

                let _exit = vm.enter_event_loop_scope();
                // Reject the pending body first so endRequestStreaming()
                // below (via this.endWithoutBody) doesn't substitute a
                // generic ConnectionClosed. toErrorInstance handles
                // .Locked itself (rejects the promise, deinits the
                // readable, calls onReceiveValue).
                let _ = body.with_mut(|body| {
                    body.to_error_instance(
                        Body::ValueError::Message(BunString::static_(
                            "Request body exceeded maxRequestBodySize",
                        )),
                        global_this,
                    )
                });

                // Route through the normal end path so this.resp is
                // detached and the in-flight ref released. Writing directly on
                // the raw uWS response left this.resp pointing at a
                // completed (and soon freed) response — uWS markDone()
                // clears onAborted so no abort ever fires to release the
                // ref, and a later handleResolve()/handleReject() from an
                // async handler would dereference the stale pointer.
                if let Some(resp) = this.resp.get() {
                    if !resp.has_responded() {
                        this.flags.set_has_written_status(true);
                        resp.write_status(b"413 Payload Too Large");
                    }
                }
                this.end_without_body(!MUX);
                return;
            }

            if last {
                let mut bytes = this.request_body_buf.replace(Vec::new());
                let total = bytes.len() + chunk.len();
                // Vec aborts on OOM (repo-wide abort-on-OOM policy).
                bytes.reserve_exact(total.saturating_sub(bytes.len()));
                bytes.extend_from_slice(chunk);
                debug_assert_eq!(bytes.len(), total);

                body.with_mut(|body| {
                    let mut old = core::mem::replace(
                        body,
                        Body::Value::InternalBlob(WebCore::InternalBlob {
                            bytes,
                            was_string: false,
                        }),
                    );
                    if matches!(old, Body::Value::Locked(_)) {
                        let _exit = vm.enter_event_loop_scope();

                        let _ = Body::Value::resolve(&mut old, body, global_this, None); // TODO: properly propagate exception upwards
                    }
                });
                return;
            }

            this.request_body_buf.with_mut(|buf| {
                if buf.capacity() == 0 {
                    // A multiplexed peer controls content-length on up to
                    // MAX_CONCURRENT_STREAMS requests at once; don't let the
                    // first byte of each reserve more than its initial window.
                    let cap = if MUX {
                        MUX_REQUEST_BODY_PREALLOCATE_LENGTH
                    } else {
                        MAX_REQUEST_BODY_PREALLOCATE_LENGTH
                    };
                    buf.reserve_exact(this.request_body_content_len.get().min(cap));
                }
                buf.extend_from_slice(chunk);
            });

            // Pre-stream backpressure; resumed by `on_stream_drained` / `on_start_buffering`.
            if !this.flags.request_body_buffer_all()
                && this.request_body_buf.get().len() >= REQUEST_BODY_HIGH_WATER_MARK
            {
                this.pause_request_body_socket();
            }
        }
    }

    fn pause_request_body_socket(&self) {
        if self.flags.request_body_paused() {
            return;
        }
        let Some(resp) = self.resp.get() else {
            return;
        };
        ctx_log!("pauseRequestBodySocket");
        self.flags.set_request_body_paused(true);
        resp.pause();
    }

    fn resume_request_body_socket(&self) {
        if !self.flags.request_body_paused() {
            return;
        }
        ctx_log!("resumeRequestBodySocket");
        self.flags.set_request_body_paused(false);
        if let Some(resp) = self.live_resp() {
            resp.resume();
        }
    }

    /// `resp` for everything outside the end/abort paths (`server.requestIP()`,
    /// `server.timeout()`, request-body resume): `None` once a streaming sink
    /// has set `ended_response`, after which `resp` may point at a freed
    /// `us_socket_t` (see `end_already_responded_stream`; the sink resumed it).
    #[inline]
    fn live_resp(&self) -> Option<uws::AnyResponse> {
        if self.sink().is_some_and(|sink| sink.get().ended_response) {
            return None;
        }
        self.resp.get()
    }

    /// Detach the body ByteStream's producer back-pointer (the stream can outlive this ctx in JS).
    fn detach_request_body_producer(&self) {
        let Some(readable) = self.request_body_readable_stream_ref.get().get() else {
            return;
        };
        if let Some(bytes) = readable.ptr.bytes() {
            let source = bytes.parent_const();
            source.producer.set(WebCore::streams::SourceHandle::None);
        }
    }

    /// `SourceHandle::ServerRequestBody`: the request-body stream's buffer emptied.
    pub(crate) fn on_request_body_stream_drained(&self) {
        let this = self;
        if !this.flags.request_body_paused() {
            return;
        }
        this.flags.set_request_body_paused(false);
        if this.resp.get().is_none()
            || this.flags.aborted()
            || this.server.get().is_none_or(|s| s.terminated())
        {
            return;
        }
        if let Some(resp) = this.live_resp() {
            resp.resume();
        }
    }

    pub(crate) fn on_start_streaming_request_body(&self) -> WebCore::DrainResult {
        ctx_log!("onStartStreamingRequestBody");
        if self.is_aborted_or_ended() {
            return WebCore::DrainResult::Aborted;
        }

        if let Some(resp) = self.live_resp() {
            resp.grow_request_window();
        }
        // This means we have received part of the body but not the whole thing
        let emptied = self.request_body_buf.replace(Vec::new());
        if !emptied.is_empty() {
            // Count the drained pre-stream bytes against maxRequestBodySize so
            // the streaming-path limit check sees the full body length, not
            // just the chunks that arrive after the stream becomes active.
            self.request_body_streamed_len.set(
                self.request_body_streamed_len
                    .get()
                    .saturating_add(emptied.len()),
            );
            let cap = emptied.capacity();
            return WebCore::DrainResult::Owned {
                list: emptied,
                size_hint: if cap < MAX_REQUEST_BODY_PREALLOCATE_LENGTH {
                    cap
                } else {
                    0
                },
            };
        }
        self.request_body_buf.set(emptied);

        WebCore::DrainResult::EstimatedSize(self.request_body_content_len.get())
    }

    pub(crate) fn on_start_buffering(&self) {
        if let Some(server) = self.server.get() {
            ctx_log!("onStartBuffering");
            // `.text()`/`.json()` want the whole body; disable pre-stream backpressure.
            self.flags.set_request_body_buffer_all(true);
            self.resume_request_body_socket();
            if let Some(resp) = self.live_resp() {
                resp.grow_request_window();
            }
            // TODO: check if is someone calling onStartBuffering other than onStartBufferingCallback
            // if is not, this should be removed and only keep protect + setAbortHandler
            // HTTP/3 (RFC 9114): Content-Length is optional; the body is
            // delimited by stream FIN, so the H1 "no CL + no TE ⇒ empty"
            // shortcut would drop it.
            if !MUX
                && !self.flags.is_transfer_encoding()
                && self.request_body_content_len.get() == 0
            {
                // no content-length or 0 content-length
                // no transfer-encoding
                if let Some(body) = self.request_body_slot() {
                    let mut old = body.replace(Body::Value::Null);
                    if let Body::Value::Locked(l) = &mut old {
                        l.on_receive_value = None;
                    }
                    let mut new_body: Body::Value = Body::Value::Null;
                    let global_this = server.global_this();
                    let _ = Body::Value::resolve(&mut old, &mut new_body, global_this, None); // TODO: properly propagate exception upwards
                    body.set(new_body);
                }
            }
        }
    }

    /// `Body::PendingValue` producer hooks. `task` is the context the server
    /// installed as the pending request body's producer; the context errors a
    /// still-pending body (`end_request_streaming`), which drops these hooks,
    /// before it is released.
    fn from_body_task(task: NonNull<c_void>) -> BackRef<Self> {
        BackRef::from(task.cast::<Self>())
    }

    pub(crate) fn on_request_body_readable_stream_available(
        task: NonNull<c_void>,
        global_this: &JSGlobalObject,
        readable: WebCore::ReadableStream,
    ) {
        let this = Self::from_body_task(task);
        debug_assert!(!this.request_body_readable_stream_ref.with_mut(|s| s.has()));
        this.request_body_readable_stream_ref
            .set(readable_stream::Strong::init(readable, global_this));
    }

    pub(crate) fn on_start_buffering_callback(task: NonNull<c_void>) {
        Self::from_body_task(task).on_start_buffering();
    }

    pub(crate) fn on_start_streaming_request_body_callback(
        task: NonNull<c_void>,
    ) -> WebCore::DrainResult {
        Self::from_body_task(task).on_start_streaming_request_body()
    }

    pub(crate) fn get_remote_socket_info(&self) -> Option<uws::SocketAddress> {
        let resp = self.live_resp()?;
        // `AnyResponse::get_remote_socket_info` returns the uws_sys
        // variant; convert to the owned `bun_uws::SocketAddress`.
        let info = resp.get_remote_socket_info()?;
        Some(uws::SocketAddress {
            ip: info.ip().to_vec().into_boxed_slice(),
            port: info.port,
            is_ipv6: info.is_ipv6,
        })
    }

    pub(crate) fn set_timeout(&self, seconds: c_uint) -> bool {
        if let Some(resp) = self.live_resp() {
            resp.timeout(seconds.min(255) as u8);
            if seconds == 0 {
                resp.clear_timeout();
            }
            return true;
        }
        false
    }
}

const MAX_REQUEST_BODY_PREALLOCATE_LENGTH: usize = 1024 * 256;
const MUX_REQUEST_BODY_PREALLOCATE_LENGTH: usize = 64 * 1024;

/// Pause socket reads at this many unconsumed request-body bytes (two 512 KB uWS recv buffers).
const REQUEST_BODY_HIGH_WATER_MARK: usize = 1024 * 1024;

// ─── per-monomorphization C-ABI exports ──────────────────────────────────────
// The exported symbol name is "Bun__HTTPRequestContext" + (debug ? "Debug" : "")
// + (mux ? "Mux" : "") + (ssl ? "TLS" : "") + "__on*".
// Rust generics cannot own `#[no_mangle]` symbols, so each of the 8 concrete
// instantiations × 4 callbacks is spelled out via `request_ctx_exports!`. The
// generic body lives on the `impl<ThisServer, ..> RequestContext` block above
// (`on_resolve` / `on_reject` / `on_resolve_stream` / `on_reject_stream`); each
// shim (`bun_jsc::jsc_promise_handler!`) is the result-mapping
// (`JsResult<JSValue>` → raw `JSValue`, `.zero` on error) over the
// monomorphic associated fn.
macro_rules! request_ctx_exports {
    ($(
        ($srv:ty, $ssl:literal, $dbg:literal, $mux:literal) =>
        $on_resolve:ident, $on_reject:ident, $on_resolve_stream:ident, $on_reject_stream:ident
    );* $(;)?) => {$(
        bun_jsc::jsc_promise_handler!(
            pub fn $on_resolve => RequestContext::<$srv, $ssl, $dbg, $mux>::on_resolve
        );
        bun_jsc::jsc_promise_handler!(
            pub fn $on_reject => RequestContext::<$srv, $ssl, $dbg, $mux>::on_reject
        );
        bun_jsc::jsc_promise_handler!(
            pub fn $on_resolve_stream => RequestContext::<$srv, $ssl, $dbg, $mux>::on_resolve_stream
        );
        bun_jsc::jsc_promise_handler!(
            pub fn $on_reject_stream => RequestContext::<$srv, $ssl, $dbg, $mux>::on_reject_stream
        );
    )*

    /// Map the `(SSL, DEBUG, MUX)` const-generic tuple to the concrete
    /// `#[no_mangle]` promise-reaction exports above. Used by the blanket
    /// `RequestContextHostFns` impl so `Self::ON_*` resolves to the *same*
    /// address C++'s `GlobalObject::promiseHandlerID` compares against.
    const fn exported_host_fns(
        ssl: bool,
        debug: bool,
        mux: bool,
    ) -> (
        bun_jsc::JSHostFn,
        bun_jsc::JSHostFn,
        bun_jsc::JSHostFn,
        bun_jsc::JSHostFn,
    ) {
        match (ssl, debug, mux) {
            $(
                ($ssl, $dbg, $mux) => (
                    $on_resolve,
                    $on_reject,
                    $on_resolve_stream,
                    $on_reject_stream,
                ),
            )*
        }
    }
    };
}
request_ctx_exports! {
    (crate::server::HTTPServer,       false, false, false) =>
        Bun__HTTPRequestContext__onResolve,
        Bun__HTTPRequestContext__onReject,
        Bun__HTTPRequestContext__onResolveStream,
        Bun__HTTPRequestContext__onRejectStream;
    (crate::server::HTTPSServer,      true,  false, false) =>
        Bun__HTTPRequestContextTLS__onResolve,
        Bun__HTTPRequestContextTLS__onReject,
        Bun__HTTPRequestContextTLS__onResolveStream,
        Bun__HTTPRequestContextTLS__onRejectStream;
    (crate::server::DebugHTTPServer,  false, true,  false) =>
        Bun__HTTPRequestContextDebug__onResolve,
        Bun__HTTPRequestContextDebug__onReject,
        Bun__HTTPRequestContextDebug__onResolveStream,
        Bun__HTTPRequestContextDebug__onRejectStream;
    (crate::server::DebugHTTPSServer, true,  true,  false) =>
        Bun__HTTPRequestContextDebugTLS__onResolve,
        Bun__HTTPRequestContextDebugTLS__onReject,
        Bun__HTTPRequestContextDebugTLS__onResolveStream,
        Bun__HTTPRequestContextDebugTLS__onRejectStream;
    (crate::server::HTTPServer,       false, false, true)  =>
        Bun__HTTPRequestContextMux__onResolve,
        Bun__HTTPRequestContextMux__onReject,
        Bun__HTTPRequestContextMux__onResolveStream,
        Bun__HTTPRequestContextMux__onRejectStream;
    (crate::server::HTTPSServer,      true,  false, true)  =>
        Bun__HTTPRequestContextMuxTLS__onResolve,
        Bun__HTTPRequestContextMuxTLS__onReject,
        Bun__HTTPRequestContextMuxTLS__onResolveStream,
        Bun__HTTPRequestContextMuxTLS__onRejectStream;
    (crate::server::DebugHTTPServer,  false, true,  true)  =>
        Bun__HTTPRequestContextDebugMux__onResolve,
        Bun__HTTPRequestContextDebugMux__onReject,
        Bun__HTTPRequestContextDebugMux__onResolveStream,
        Bun__HTTPRequestContextDebugMux__onRejectStream;
    (crate::server::DebugHTTPSServer, true,  true,  true)  =>
        Bun__HTTPRequestContextDebugMuxTLS__onResolve,
        Bun__HTTPRequestContextDebugMuxTLS__onReject,
        Bun__HTTPRequestContextDebugMuxTLS__onResolveStream,
        Bun__HTTPRequestContextDebugMuxTLS__onRejectStream;
}

struct PathnameFormatter<
    'a,
    ThisServer: ServerLike + 'static,
    const SSL: bool,
    const DBG: bool,
    const MUX: bool,
> {
    ctx: &'a RequestContext<ThisServer, SSL, DBG, MUX>,
}

impl<'a, ThisServer, const SSL: bool, const DBG: bool, const MUX: bool> core::fmt::Display
    for PathnameFormatter<'a, ThisServer, SSL, DBG, MUX>
where
    ThisServer: ServerLike + 'static,
{
    fn fmt(&self, writer: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let this = self.ctx;

        let pathname = this.pathname.get();
        if !pathname.is_empty() {
            return write!(writer, "{}", pathname);
        }

        if !this.flags.has_abort_handler() {
            if let Some(req) = this.req.get() {
                return write!(writer, "{}", bstr::BStr::new(req.url()));
            }
        }

        writer.write_str("/")
    }
}

// Retained only for `renderMetadata` to compute Content-Range / Content-Length
// for file-blob bodies; the actual fd/socket bookkeeping lives in
// `FileResponseStream` now.
#[derive(Default, Clone, Copy)]
pub struct SendfileContext {
    pub(crate) remain: BlobSizeType,
    pub offset: BlobSizeType,
    /// When non-zero, the Content-Range total (`/{total}` instead of `/*`).
    pub(crate) total: BlobSizeType,
}

// All flags are bool (with two debug-conditional ones). We keep all bits in
// every build and just gate the `is_web_browser_navigation` / `has_finalized`
// accessors on the const params.
bitflags::bitflags! {
    #[derive(Default, Clone, Copy)]
    struct FlagsBits: u32 {
        const HAS_MARKED_COMPLETE         = 1 << 0;
        const HAS_MARKED_PENDING          = 1 << 1;
        const HAS_ABORT_HANDLER           = 1 << 2;
        const HAS_SENDFILE_CTX            = 1 << 4;
        const HAS_CALLED_ERROR_HANDLER    = 1 << 5;
        const NEEDS_CONTENT_LENGTH        = 1 << 6;
        const NEEDS_CONTENT_RANGE         = 1 << 7;
        /// Used to avoid looking at the uws.Request struct after it's been freed
        const IS_TRANSFER_ENCODING        = 1 << 8;
        /// Used to identify if request can be safely deinitialized
        const IS_WAITING_FOR_REQUEST_BODY = 1 << 9;
        /// Used in renderMissing in debug mode to show the user an HTML page
        /// Used to avoid looking at the uws.Request struct after it's been freed
        const IS_WEB_BROWSER_NAVIGATION   = 1 << 10;
        const HAS_WRITTEN_STATUS          = 1 << 11;
        const RESPONSE_PROTECTED          = 1 << 12;
        const ABORTED                     = 1 << 13;
        const HAS_FINALIZED               = 1 << 14;
        const IS_ERROR_PROMISE_PENDING    = 1 << 15;
        /// Socket reads are paused because the request-body buffer is over its high-water mark.
        const REQUEST_BODY_PAUSED         = 1 << 16;
        /// `on_start_buffering` fired (`.text()` etc.); skip pre-stream backpressure.
        const REQUEST_BODY_BUFFER_ALL     = 1 << 17;
    }
}

#[repr(transparent)]
#[derive(Default)]
pub struct Flags<const DEBUG_MODE: bool>(Cell<FlagsBits>);

macro_rules! flag_accessor {
    ($get:ident, $set:ident, $bit:ident) => {
        #[inline]
        pub fn $get(&self) -> bool {
            self.0.get().contains(FlagsBits::$bit)
        }
        #[inline]
        pub fn $set(&self, v: bool) {
            let mut bits = self.0.get();
            bits.set(FlagsBits::$bit, v);
            self.0.set(bits);
        }
    };
}

impl<const DEBUG_MODE: bool> Flags<DEBUG_MODE> {
    flag_accessor!(
        has_marked_complete,
        set_has_marked_complete,
        HAS_MARKED_COMPLETE
    );
    flag_accessor!(
        has_marked_pending,
        set_has_marked_pending,
        HAS_MARKED_PENDING
    );
    flag_accessor!(has_abort_handler, set_has_abort_handler, HAS_ABORT_HANDLER);
    flag_accessor!(has_sendfile_ctx, set_has_sendfile_ctx, HAS_SENDFILE_CTX);
    flag_accessor!(
        has_called_error_handler,
        set_has_called_error_handler,
        HAS_CALLED_ERROR_HANDLER
    );
    flag_accessor!(
        needs_content_length,
        set_needs_content_length,
        NEEDS_CONTENT_LENGTH
    );
    flag_accessor!(
        needs_content_range,
        set_needs_content_range,
        NEEDS_CONTENT_RANGE
    );
    flag_accessor!(
        is_transfer_encoding,
        set_is_transfer_encoding,
        IS_TRANSFER_ENCODING
    );
    flag_accessor!(
        is_waiting_for_request_body,
        set_is_waiting_for_request_body,
        IS_WAITING_FOR_REQUEST_BODY
    );
    flag_accessor!(
        has_written_status,
        set_has_written_status,
        HAS_WRITTEN_STATUS
    );
    flag_accessor!(
        response_protected,
        set_response_protected,
        RESPONSE_PROTECTED
    );
    flag_accessor!(aborted, set_aborted, ABORTED);
    flag_accessor!(
        is_error_promise_pending,
        set_is_error_promise_pending,
        IS_ERROR_PROMISE_PENDING
    );
    flag_accessor!(
        request_body_paused,
        set_request_body_paused,
        REQUEST_BODY_PAUSED
    );
    flag_accessor!(
        request_body_buffer_all,
        set_request_body_buffer_all,
        REQUEST_BODY_BUFFER_ALL
    );

    #[inline]
    pub(crate) fn is_web_browser_navigation(&self) -> bool {
        DEBUG_MODE && self.0.get().contains(FlagsBits::IS_WEB_BROWSER_NAVIGATION)
    }
    #[inline]
    pub(crate) fn set_is_web_browser_navigation(&self, v: bool) {
        if DEBUG_MODE {
            let mut bits = self.0.get();
            bits.set(FlagsBits::IS_WEB_BROWSER_NAVIGATION, v);
            self.0.set(bits);
        }
    }

    #[inline]
    pub(crate) fn has_finalized(&self) -> bool {
        cfg!(debug_assertions) && self.0.get().contains(FlagsBits::HAS_FINALIZED)
    }
    #[cfg(debug_assertions)]
    #[inline]
    pub(crate) fn set_has_finalized(&self, v: bool) {
        let mut bits = self.0.get();
        bits.set(FlagsBits::HAS_FINALIZED, v);
        self.0.set(bits);
    }
}

fn get_content_type(headers: Option<&mut FetchHeaders>, blob: &AnyBlob) -> (MimeType, bool, bool) {
    let mut needs_content_type = true;
    let mut content_type_needs_free = false;

    let content_type: MimeType = 'brk: {
        if let Some(headers_) = headers {
            if let Some(content) = headers_.fast_get(jsc::HTTPHeaderName::ContentType) {
                needs_content_type = false;

                let content_slice = content.to_utf8();
                // Dupe only when the latin1/utf16 slice was heap-converted.
                let dupe = content_slice.is_owned();
                let mt = MimeType::init(
                    content_slice.slice(),
                    dupe,
                    Some(&mut content_type_needs_free),
                );
                drop(content_slice);
                break 'brk mt;
            }
        }

        if !blob.content_type().is_empty() {
            bun_http_types::MimeType::by_name(blob.content_type())
        } else if let Some(content) = bun_http_types::MimeType::sniff(blob.slice()) {
            content
        } else if blob.was_string() {
            bun_http_types::MimeType::TEXT
            // TODO: should we get the mime type off of the Blob.Store if it exists?
            // A little wary of doing this right now due to causing some breaking change
        } else {
            bun_http_types::MimeType::OTHER
        }
    };

    (content_type, needs_content_type, content_type_needs_free)
}

// `ServerLike` lives in `crate::server` (mod.rs) and is impl'd for the four
// `NewServer` monomorphizations.

static WELCOME_PAGE_HTML_GZ: &[u8] = include_bytes!("../api/welcome-page.html.gz");
