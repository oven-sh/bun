use core::cell::Cell;
use core::ffi::{c_uint, c_void};
use core::ptr::NonNull;

use bun_core::String as BunString;
use bun_http_types::Method::Method;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{JsCell, JsClass as _, WrapperGuard};
use bun_ptr::{AliasableBox, AnyRefCounted, RefPtr};
use bun_uws::{self as uws, WebSocketUpgradeContext};

use crate::server::jsc::{self, JSGlobalObject, JSValue, JsResult};
use crate::server::{PendingRequest, RangeRequest, ServerLike};
use crate::webcore::{
    self as WebCore, AnyBlob, ByteStream, CookieMap, CookieMapRef, FetchHeaders, Request, Response,
    blob::SizeType as BlobSizeType, body, readable_stream, request, response,
};

// NOTE (transport selection): the response/request handle types vary with
// `(ssl_enabled, http3)`. Stable Rust cannot drive an associated type from a
// const-generic `bool` without specialization, and an early `Transport`
// helper-trait approach forced `where TransportFor<SSL,MUX>: Transport` bounds
// onto every generic that named `RequestContext` (which Rust then *cannot*
// discharge for a generic `const SSL: bool` — only the concrete combos have
// impls). So instead the `resp` field stores `uws::AnyResponse` (a Copy enum
// over the concrete handles) and dispatches at runtime — same shape as
// `AnyRequestContext` / `AnyServer`.
//
// `MUX` = the request arrived on a stream-multiplexed transport (HTTP/2 or
// HTTP/3): headers come pre-decoded as a list (`uws::H3::Request` serves
// both), the body ends at END_STREAM/FIN rather than by Content-Length or
// chunking, a response never owns the connection (no `Connection: close`,
// no `Transfer-Encoding`, no upgrade), and the response handle stays valid
// after `end()` until its `onAborted` fires to say the stream is gone.
pub(crate) type Req<const SSL_ENABLED: bool, const MUX: bool> = c_void;

pub(crate) type ResponseStream<const SSL_ENABLED: bool> =
    crate::webcore::streams::HTTPServerWritable<SSL_ENABLED>;

/// This pre-allocates up to 2,048 RequestContext structs.
/// It costs about 655,632 bytes.
// Capacity 0 when heap-breakdown is enabled routes every allocation through
// the fallback heap path.
const REQUEST_CONTEXT_POOL_CAPACITY: usize = if bun_alloc::heap_breakdown::ENABLED {
    0
} else {
    2048
};

pub(crate) type RequestContextStackAllocator<
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
    /// Plain HTTP request, or a handshake that was answered with an HTTP response.
    None,
    /// WebSocket handshake waiting for `server.upgrade()`. uWS owns the
    /// context (one per `.ws()` route) and it outlives the request.
    Pending(NonNull<WebSocketUpgradeContext>),
    /// `server.upgrade()` handed the socket over to a `ServerWebSocket`.
    Upgraded,
}

/// The root on the Response being rendered. A plain Blob body is read in the frame that returned it, so it is left unrooted (see `response_weakref`); a file or streaming body is read after that frame, so [`set_rooted`](Self::set_rooted) roots it.
#[derive(Default)]
pub(crate) struct ResponseRoot(JsCell<bun_jsc::strong::Optional>);

impl ResponseRoot {
    pub(crate) fn set_rooted(&self, value: JSValue, global: &JSGlobalObject) {
        self.0.set(bun_jsc::strong::Optional::create(value, global));
    }

    pub(crate) fn clear(&self) {
        self.0.set(bun_jsc::strong::Optional::empty());
    }
}

/// The response until it ends, aborts or upgrades, with the base ref: what keeps the context alive for uWS.
pub(crate) struct AttachedResponse<T: AnyRefCounted>(JsCell<Option<(uws::AnyResponse, RefPtr<T>)>>);

impl<T: AnyRefCounted> AttachedResponse<T> {
    pub(crate) fn get(&self) -> Option<uws::AnyResponse> {
        self.0.get().as_ref().map(|(resp, _)| *resp)
    }

    #[must_use = "dropping it releases the base ref"]
    pub(crate) fn take(&self) -> Option<(uws::AnyResponse, RefPtr<T>)> {
        self.0.take()
    }
}

/// `align(16)`: `NativePromiseContext`'s deferred-deref task packs a 4-bit
/// type tag into the low bits of a pointer to this.
#[repr(align(16))]
pub(crate) struct RequestContext<
    ThisServer,
    const SSL_ENABLED: bool,
    const DEBUG_MODE: bool,
    const MUX: bool,
> where
    ThisServer: ServerLike + 'static,
{
    /// BACKREF to the `Server`, which outlives its requests. `None` once detached.
    server: JsCell<Option<PendingRequest<bun_ptr::BackRef<ThisServer>>>>,
    pub(crate) resp: AttachedResponse<Self>,
    pub(crate) req: Cell<Option<*mut Req<SSL_ENABLED, MUX>>>,
    pub(crate) request_weakref: JsCell<request::WeakRef>,
    pub(crate) signal: JsCell<Option<jsc::PendingAbortSignal>>,
    pub method: Method,
    /// Owned `+1` ref on a C++ `CookieMap` (taken in `set_cookies`, released
    /// when the field is dropped/replaced — `CookieMapRef` handles the unref).
    pub(crate) cookies: JsCell<Option<CookieMapRef>>,

    pub(crate) flags: Flags<DEBUG_MODE>,

    pub(crate) upgrade_context: Cell<UpgradeState>,

    /// We can only safely free once the request body promise is finalized
    /// and the response is rejected
    pub(crate) response_root: ResponseRoot,
    root: Cell<*mut Self>,
    pub(crate) ref_count: Cell<u8>,
    pub(crate) pin_count: Cell<u8>,
    /// The [`Dispatch`]es on the stack.
    dispatch_count: Cell<u8>,

    /// Weak: for plain Blob/InternalBlob bodies the Response JSValue is
    /// not protected (hot path), so GC may finalize it while we're parked
    /// on tryEnd() backpressure. onAbort / handleResolveStream /
    /// handleRejectStream only use this for best-effort readable-stream
    /// cleanup and safely observe null instead of UAF. File/.Locked
    /// bodies still root it through `response_root`, so the pointer stays
    /// valid for renderMetadata() on those paths.
    pub(crate) response_weakref: JsCell<response::WeakRef>,
    pub(crate) blob: JsCell<AnyBlob>,

    pub(crate) sendfile: Cell<SendfileContext>,
    pub(crate) range: RangeRequest::Raw,
    /// The request's `If-Range`, for `do_sendfile`. `None` when `range` is.
    pub(crate) if_range: Option<Box<[u8]>>,

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

    sink: JsCell<Option<AliasableBox<ResponseStream<SSL_ENABLED>>>>,
    pub(crate) byte_stream: Cell<Option<NonNull<ByteStream>>>,
    /// This keeps the Response body's ReadableStream alive.
    pub(crate) response_body_readable_stream_ref: JsCell<readable_stream::Strong>,

    /// Used in errors
    pub(crate) pathname: JsCell<bun_core::String>,

    /// Used either for temporary blob data or fallback
    /// When the response body is a temporary value
    pub(crate) response_buf_owned: JsCell<Vec<u8>>,

    /// The dev server's record of this request. The response has room for one abort handler only.
    pub(crate) deferred_request: Cell<Option<crate::bake::dev_server::deferred_request::Handle>>,

    /// The `NativePromiseContext` cell whose claim (one ref on this context)
    /// is still outstanding, or `ZERO`. Not visited by GC: the promise
    /// reaction keeps the cell alive, and the cell's destructor clears this
    /// field before the value can dangle. `on_abort` reclaims the ref through
    /// it so an aborted request is torn down without waiting for GC.
    promise_cell: Cell<JSValue>,
    // TODO: support builtin compression
}

impl<ThisServer, const SSL_ENABLED: bool, const DEBUG_MODE: bool, const MUX: bool>
    RequestContext<ThisServer, SSL_ENABLED, DEBUG_MODE, MUX>
where
    ThisServer: ServerLike + 'static,
{
    pub(crate) const IS_MUX: bool = MUX;

    #[inline]
    pub(crate) fn as_ctx_ptr(&self) -> *mut Self {
        let p = self.root.get();
        debug_assert!(!p.is_null(), "RequestContext root not recorded");
        p
    }

    pub(crate) fn memory_cost(&self) -> usize {
        // Not the sink, nor the ByteStream.
        core::mem::size_of::<Self>()
            + self.request_body_buf.get().capacity()
            + self.response_buf_owned.get().capacity()
            + self.if_range.as_deref().map_or(0, <[u8]>::len)
            + self.blob.get().memory_cost()
    }

    #[inline]
    pub(crate) fn is_async(&self) -> bool {
        self.dispatch_count.get() == 0
    }

    /// The context of the script that made the server, for what answering the request starts.
    pub(crate) fn script_context<'r>(&self) -> &'r bun_jsc::ScriptExecutionContext {
        self.server().context()
    }
}

// ─── per-request state machine bodies ────────────────────────────────────────
// Everything below until the helper structs at the bottom is the request
// state machine: render(), on_abort(), on_resolve(), do_render_*, sendfile,
// stream handling, error handling.
use crate::api::native_promise_context;
use crate::node::types::PathLikeExt as _;
use crate::server::{AnyRequestContext, FileResponseStream, HTTPStatusText, file_response_stream};
use crate::webcore::blob::BlobExt as _;
use crate::webcore::sink::ReadableSinkController;
use crate::webcore::{Blob, ReadableStream, body as Body};
use bun_core::Output;
use bun_core::strings;
use bun_http_types as HTTP;
use bun_http_types::MimeType::MimeType;
use bun_jsc::SysErrorJsc as _;
use std::io::Write as _;

/// A ref on a [`RequestContext`] for the frame of a callback.
///
/// Every uWS handler that can reach a `deref()` constructs one of these from its raw entry
/// pointer as the first statement: the guard's ref keeps the pooled context
/// alive for the whole frame even if the body drops the base ref, and the
/// actual pool release happens here at drop.
struct RequestContextRef<ThisServer, const SSL: bool, const DBG: bool, const MUX: bool>
where
    ThisServer: ServerLike + 'static,
{
    ctx: RefPtr<RequestContext<ThisServer, SSL, DBG, MUX>>,
}

impl<ThisServer, const SSL: bool, const DBG: bool, const MUX: bool>
    RequestContextRef<ThisServer, SSL, DBG, MUX>
where
    ThisServer: ServerLike + 'static,
{
    #[inline]
    fn pin(this: *mut RequestContext<ThisServer, SSL, DBG, MUX>) -> Self {
        // SAFETY: `this` is a live context registered as the callback's
        // user-data; the base ref cannot be released before this returns.
        let ctx = unsafe { RefPtr::init_ref(this) };
        ctx.pin_count.set(ctx.pin_count.get() + 1);
        Self { ctx }
    }

    #[inline]
    fn ctx(&self) -> &RequestContext<ThisServer, SSL, DBG, MUX> {
        &self.ctx
    }
}

impl<ThisServer, const SSL: bool, const DBG: bool, const MUX: bool> Drop
    for RequestContextRef<ThisServer, SSL, DBG, MUX>
where
    ThisServer: ServerLike + 'static,
{
    #[inline]
    fn drop(&mut self) {
        self.ctx.pin_count.set(self.ctx.pin_count.get() - 1);
    }
}

/// A handler's frame. A context that completes under it keeps its pool slot until this drops.
pub(crate) struct Dispatch<ThisServer, const SSL: bool, const DBG: bool, const MUX: bool>(
    bun_ptr::BackRef<RequestContext<ThisServer, SSL, DBG, MUX>>,
)
where
    ThisServer: ServerLike + 'static;

impl<ThisServer, const SSL: bool, const DBG: bool, const MUX: bool>
    Dispatch<ThisServer, SSL, DBG, MUX>
where
    ThisServer: ServerLike + 'static,
{
    pub(crate) fn new(ctx: &RequestContext<ThisServer, SSL, DBG, MUX>) -> Self {
        ctx.dispatch_count.update(|count| count + 1);
        Self(bun_ptr::BackRef::new(ctx))
    }
}

impl<ThisServer, const SSL: bool, const DBG: bool, const MUX: bool> core::ops::Deref
    for Dispatch<ThisServer, SSL, DBG, MUX>
where
    ThisServer: ServerLike + 'static,
{
    type Target = RequestContext<ThisServer, SSL, DBG, MUX>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<ThisServer, const SSL: bool, const DBG: bool, const MUX: bool> Drop
    for Dispatch<ThisServer, SSL, DBG, MUX>
where
    ThisServer: ServerLike + 'static,
{
    fn drop(&mut self) {
        self.dispatch_count.update(|count| count - 1);
        if self.flags.has_marked_complete() {
            self.deinit();
        }
    }
}

impl<ThisServer, const SSL: bool, const DBG: bool, const MUX: bool> AnyRefCounted
    for RequestContext<ThisServer, SSL, DBG, MUX>
where
    ThisServer: ServerLike + 'static,
{
    unsafe fn rc_ref(this: *mut Self) {
        // SAFETY: caller contract.
        unsafe { (*this).ref_() }
    }
    unsafe fn rc_deref(this: *mut Self) {
        // SAFETY: caller contract.
        unsafe { (*this).deref() }
    }
    unsafe fn rc_has_one_ref(this: *const Self) -> bool {
        // SAFETY: caller contract.
        unsafe { (*this).ref_count.get() == 1 }
    }
}

/// Reports an error that no `error()` handled. The server keeps running, so a
/// Worker prints it like the main thread does. Its own handler ends the Worker.
fn report_unhandled_error(vm: &jsc::VirtualMachine, global: &JSGlobalObject, value: JSValue) {
    if vm.worker.get().is_some() {
        jsc::VirtualMachine::default_on_unhandled_rejection(vm, global, value);
    } else {
        (vm.on_unhandled_rejection.get())(vm, global, value);
    }
}

/// Not to be held across script or a JS allocation unless the wrapper is rooted.
fn live_response<'r>(weak: &JsCell<response::WeakRef>) -> Option<&'r mut Response> {
    // SAFETY: the weak handle just reported the value live.
    weak.with_mut(|w| w.get())
        .map(|mut p| unsafe { p.as_mut() })
}

/// Release the body's hold on a stream the sink is done with, and mark a
/// `Locked` body used. Non-generic and out of line: the eight `RequestContext`
/// monomorphizations share one copy.
#[inline(never)]
fn release_body_stream(weak: &JsCell<response::WeakRef>, global_this: &JSGlobalObject) {
    let Some(mut response) = live_response(weak) else {
        return;
    };
    if let Body::Value::Locked(locked) = response.get_body_value()
        && locked.has_consumer()
    {
        return;
    }
    if let Some(stream) = response.get_body_readable_stream() {
        stream.value.ensure_still_alive();
        response.detach_readable_stream(global_this);
        stream.done();
        // Settling a pending read allocates, which can collect the Response.
        let Some(live) = live_response(weak) else {
            return;
        };
        response = live;
    }
    // Read after the stream calls: the check observes the post-detach state.
    let body_value = response.get_body_value();
    if matches!(body_value, Body::Value::Locked(_)) {
        *body_value = Body::Value::Used;
    }
}

// ─── sibling-subtree shims ───────────────────────────────────────────────────
// These forward to methods that exist in webcore/ but are currently inside
// impl blocks that fail to compile (codegen gc-slot stubs, opaque AbortSignal).
// Adapt on this side per phase-d rules.
mod shim {
    use super::*;

    #[inline]
    pub(super) fn response_body_stream(r: &mut Response) -> Option<ReadableStream> {
        r.get_body_readable_stream()
    }
    #[inline]
    pub(super) fn response_detach_stream(r: &mut Response, g: &JSGlobalObject) {
        r.detach_readable_stream(g)
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
    pub(super) fn byte_stream_unpipe(s: NonNull<ByteStream>) {
        // The caller has just `take()`n `self.byte_stream` and still holds
        // `response_body_readable_stream_ref`, which keeps the pointee alive.
        bun_ptr::BackRef::from(s).detach_finished_sink()
    }
}
use crate::server::DevErrorPage;

bun_core::declare_scope!(RequestContext, visible);
bun_core::declare_scope!(ReadableStream, visible);

macro_rules! ctx_log { ($($t:tt)*) => { bun_core::scoped_log!(RequestContext, $($t)*) }; }
macro_rules! stream_log { ($($t:tt)*) => { bun_core::scoped_log!(ReadableStream, $($t)*) }; }

/// One instantiation's `Bun__HTTPRequestContext*__on*`, which C++'s `promiseHandlerID` knows by address.
///
/// NOTE (layering): expressed as a trait (not inherent consts) so
/// downstream `where`-clauses that already name it keep type-checking.
pub(crate) trait RequestContextHostFns {
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
    /// The lifetime is decoupled from `&self`: the server outlives calls that recycle this context.
    #[inline]
    pub(crate) fn server<'r>(&self) -> &'r ThisServer {
        // SAFETY: BACKREF — `server` is `Some(non-null)` after `init()` and
        // the pointee `NewServer` outlives this context.
        // `'r` may exceed `&self` because the server is not borrowed from
        // `*self`; it lives independently and outlives every context.
        unsafe {
            &*self
                .try_server()
                .expect("infallible: server bound")
                .as_const_ptr()
        }
    }

    pub(crate) fn try_server(&self) -> Option<bun_ptr::BackRef<ThisServer>> {
        self.server.get().as_deref().copied()
    }

    /// Mutably borrow the pooled request-body slot, if attached.
    ///
    /// Returns an unbounded `&'r mut` because the slot is a separate
    /// `HiveArray` allocation, **not** a sub-field of `*self`, so callers may
    /// hold it across disjoint reborrows of other `RequestContext` fields
    /// (same pattern as [`server()`]).
    #[inline]
    #[allow(
        clippy::mut_from_ref,
        reason = "the body slot is a separate pooled allocation, not a field of *self (R-2)"
    )]
    fn request_body_mut(&self) -> Option<&mut Body::Value> {
        // SAFETY: R-2 invariant — the slot is shared with `Request.body` but
        // never `&mut`-borrowed concurrently (single-threaded event loop).
        self.request_body
            .get()
            .as_ref()
            .map(|h| unsafe { &mut (*h.as_ptr()).value })
    }

    /// Exclusive borrow of the heap [`ResponseStream`] this context owns.
    ///
    /// Returns an unbounded `&'r mut` because the sink is a separate heap
    /// allocation (boxed in [`do_render_stream`]), **not** a sub-field
    /// of `*self` (same pattern as [`request_body_mut`]).
    ///
    /// # Safety (encapsulated)
    /// While `Some`, `sink` points to the sink allocated by
    /// `do_render_stream`; this `RequestContext` is its sole owner until
    /// it drops it. Single-threaded — no other `&mut` alias.
    #[inline]
    #[allow(
        clippy::mut_from_ref,
        reason = "the sink is a separate heap allocation owned by this ctx, not a field of *self"
    )]
    fn sink_mut(&self) -> Option<&mut ResponseStream<SSL_ENABLED>> {
        // SAFETY: see fn doc — heap sink owned by this ctx, sole live
        // mutable view, single-threaded.
        (self.sink.get().as_ref()).map(|p| unsafe { &mut *p.as_ptr() })
    }

    ///
    #[inline]
    fn response_mut<'r>(&self) -> Option<&'r mut Response> {
        live_response(&self.response_weakref)
    }

    #[inline]
    fn request<'r>(&self) -> Option<&'r Request> {
        let request = self.request_weakref.with_mut(|w| w.get());
        // SAFETY: the weak handle just reported the value live, and no caller
        // holds it across script unless the wrapper is rooted.
        request.map(|p| unsafe { p.as_ref() })
    }

    /// Take the pooled request-body slot out of `self`; the handle's `Drop`
    /// releases the `+1`.
    #[inline]
    fn request_body_take_unref(&self) {
        drop(self.request_body.replace(None));
    }

    pub(crate) fn set_signal_aborted(&self, reason: jsc::CommonAbortReason) {
        if let Some(signal) = self.signal.get() {
            if let Some(server) = self.try_server() {
                // server is a BACKREF — valid while this RequestContext is alive
                let global = server.global_this();
                signal.signal(global, reason);
            }
        }
    }

    /// The microtask checkpoint after a synchronously dispatched handler. `Err`: the VM has stopped; the
    /// caller leaves the request where it is and the stop closes the server's connections.
    fn drain_microtasks(&self) -> Result<(), bun_jsc::Stopped> {
        let Some(server) = self.try_server() else {
            return Ok(());
        };
        if self.is_async() {
            return Ok(());
        }
        server.vm().event_loop().drain_microtasks()
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
            Self::on_abort(self.as_ctx_ptr(), resp);
            return;
        }
        // SAFETY: FFI handle valid while resp is Some
        resp.on_aborted(|this, resp| Self::on_close(this, resp), self.as_ctx_ptr());
    }

    pub(crate) fn set_cookies(&self, cookie_map: Option<*mut CookieMap>) {
        // S008: `CookieMap` is an `opaque_ffi!` ZST — safe `*const → &` deref.
        // `new_ref` takes a ref for storage. Replacing drops (and so unrefs)
        // the old one.
        drop(self.cookies.replace(
            cookie_map.map(|p| CookieMapRef::new_ref(bun_opaque::opaque_deref(p.cast_const()))),
        ));
    }

    pub(crate) fn on_resolve(
        cx: &mut JsScope<'_>,
        result: JsLocal<'_>,
        context: Option<RefPtr<Self>>,
    ) {
        ctx_log!("onResolve");

        let global = cx.global();
        let result = result.to_js();
        let Some(ctx) = context else {
            // A termination path (abort, end, upgrade) reclaimed the cell's
            // claim; the context may already be gone.
            Self::discard_response_body(global, result);
            return;
        };
        ctx.promise_cell.set(JSValue::ZERO);

        result.ensure_still_alive();

        ctx.handle_resolve(global, result);
    }

    /// Cancel the body stream of a Response the server will not transmit, unless a consumer reads it.
    fn cancel_unread_body(response: &Response, global_this: &JSGlobalObject) {
        if let Body::Value::Locked(locked) = response.get_body_value()
            && locked.has_consumer()
        {
            return;
        }
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
        if let Some(response) = Response::from_js(&value) {
            Self::cancel_unread_body(&response, global_this);
        }
    }

    /// [`Self::discard_response_body`] for a request this context can no longer respond to.
    fn discard_handler_result(&self, global_this: &JSGlobalObject, result: JSValue) {
        let Some(promise) = result.as_any_promise() else {
            if self.did_upgrade_web_socket()
                && let Some(err) = result.to_error()
            {
                Self::report_error_after_upgrade(
                    global_this,
                    self.server_js_for_error_handler(),
                    err,
                );
                return;
            }
            Self::discard_response_body(global_this, result);
            return;
        };
        let resp_held = self.resp.get().is_some();
        match promise.status() {
            // Only while `resp` is held: the `on_abort` that follows then reclaims the cell.
            jsc::PromiseStatus::Pending if resp_held => {
                let cell = self.create_promise_cell(global_this);
                result.then_with_value(global_this, cell, Self::ON_RESOLVE, Self::ON_REJECT);
            }
            // A subscribed promise that rejects later is dropped. Drop this one the same way.
            jsc::PromiseStatus::Rejected if resp_held => promise.set_handled(global_this.vm()),
            // Nothing subscribes, so a rejection stays unhandled and reaches `unhandledRejection`.
            jsc::PromiseStatus::Pending | jsc::PromiseStatus::Rejected => {}
            jsc::PromiseStatus::Fulfilled => {
                Self::discard_response_body(global_this, promise.result(global_this.vm()));
            }
        }
    }

    fn render_missing_invalid_response(&self, value: JSValue) {
        let class_name = value.get_class_info_name().unwrap_or(b"");
        // Inspecting `value` can run user code (`[inspect.custom]`, `toString`), which can throw.
        let mut inspect_error: Option<JSValue> = None;

        if let Some(server) = self.try_server() {
            // server is a BACKREF — valid while this RequestContext is alive
            let global_this: &JSGlobalObject = server.global_this();

            Output::enable_buffering();
            let mut writer = Output::error_writer();

            if class_name == b"Response" {
                bun_core::err_generic!(
                    "Expected a native Response object, but received a polyfilled Response object. Bun.serve() only supports native Response objects.",
                );
            } else if !value.is_empty() && !global_this.has_exception() {
                let mut formatter = jsc::ConsoleObject::Formatter::new(global_this);
                formatter.quote_strings = true;
                let mut received: Vec<u8> = Vec::new();
                match formatter.format_value::<false>(value, &mut received) {
                    Ok(()) => bun_core::err_generic!(
                        "Expected a Response object, but received '{}'",
                        bstr::BStr::new(&received),
                    ),
                    Err(err) => {
                        bun_core::err_generic!("Expected a Response object");
                        inspect_error = Some(global_this.take_error(err));
                    }
                }
                // `formatter` drops here.
            } else {
                bun_core::err_generic!("Expected a Response object");
            }

            Output::flush();
            if !global_this.has_exception() {
                jsc::ConsoleObject::write_trace(&mut writer, global_this);
            }
            Output::flush();
        }
        // The formatter and `write_trace` above re-enter JS (getters, proxy
        // traps, Error.prepareStackTrace), which can synchronously abort or
        // end this request (e.g. AbortController.abort() inside a getter).
        // The ref that `on_resolve` was given keeps the
        // allocation alive across the re-entry; re-check the request state so
        // we never render onto a response that was ended underneath us.
        if self.is_aborted_or_ended() {
            return;
        }
        if let Some(error) = inspect_error {
            // Report it as if the handler threw it.
            self.run_error_handler(error);
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

        let Some(response) = Response::from_js(&value) else {
            self.render_missing_invalid_response(value);
            return;
        };
        if self.reject_unsendable_response(response.status_code()) {
            return;
        }
        self.response_root.set_rooted(value, global_this);

        if self.method == Method::HEAD {
            if let Some(resp) = self.resp.get() {
                let pair = HeaderResponsePair {
                    this: self,
                    response,
                };
                resp.run_corked_with_type(Self::do_render_head_response, &pair);
            }
            return;
        }

        self.render(response);
    }

    #[inline]
    fn unpinned_ref_count(&self) -> u8 {
        self.ref_count.get() - self.pin_count.get()
    }

    fn should_render_missing(&self) -> bool {
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
        if let Some(body) = self.request_body.get() {
            if matches!(&**body, Body::Value::Locked(_)) {
                return false;
            }
        }

        true
    }

    fn deinit(&self) {
        ctx_log!("deinit");
        debug_assert!(self.resp.get().is_none());
        debug_assert_eq!(self.ref_count.get(), 0);
        self.end_request_streaming_and_drain();
        self.flags.set_has_marked_complete(true);

        if !self.is_async() {
            ctx_log!("deferred deinit <d> ({:p})<r>", self);
            return;
        }

        ctx_log!("deinit<d> ({:p})<r>", self);
        debug_assert!(self.flags.has_finalized());

        // A client abort while the body stream is in flight reclaims the claim of the promise
        // whose reactions consume the sink (`handleResolveStream` / `handleRejectStream`),
        // so a client abort in that state reaches deinit with the sink still owned here.
        // This is the owner's last exit: release it exactly like the settle paths do.
        if let Some(owned_sink) = self.sink.take() {
            // SAFETY: deinit runs once, after `detach_response()` removed the uWS callbacks;
            // the context is the sink's sole owner (see the `sink` field's doc comment).
            let sink = unsafe { &mut *owned_sink.as_ptr() };
            sink.finalize();
            sink.source.detach(&sink.global_this);
        }

        // Taken out to drop last: it can free the dev server, which `deferred_request` points into.
        if let Some(server) = self.server.take() {
            server.release_request_context(self.as_ctx_ptr().cast::<c_void>(), MUX);
        }
    }

    pub(crate) fn deref(&self) {
        let ref_count = self.ref_count.get();
        stream_log!("deref {} -> {}", ref_count, ref_count - 1);
        debug_assert!(ref_count > 0);
        self.ref_count.set(ref_count - 1);
        if ref_count == 1 {
            self.finalize_without_deinit();
            self.deinit();
        }
    }

    pub(crate) fn ref_(&self) {
        let ref_count = self.ref_count.get();
        stream_log!("ref {} -> {}", ref_count, ref_count + 1);
        self.ref_count.set(ref_count + 1);
    }

    pub(super) fn ref_guard(&self) -> RefPtr<Self> {
        // SAFETY: `self` is the live pool slot.
        unsafe { RefPtr::init_ref(self.as_ctx_ptr()) }
    }

    /// Takes one ref as the cell's claim on this context and remembers the
    /// cell in `promise_cell`. The settle reactions (`take()` + a field
    /// clear), `on_abort`, or the cell's destructor release the claim.
    fn create_promise_cell(&self, global: &JSGlobalObject) -> JSValue {
        debug_assert!(self.promise_cell.get().is_empty());
        let claim = self.ref_guard();
        // `server.upgrade()` reclaims the cell while the handler is still running. If the handler
        // rejects after that, `on_reject` reports the error through this.
        let held = match self.upgrade_context.get() {
            UpgradeState::Pending(_) => self.server_js_for_error_handler(),
            UpgradeState::None | UpgradeState::Upgraded => JSValue::ZERO,
        };
        let cell = native_promise_context::create(global, claim, held);
        self.promise_cell.set(cell);
        cell
    }

    /// Called from the cell's destructor (GC sweep) when the claim was never
    /// taken: the deref is deferred (or skipped at VM teardown), but the field
    /// must stop pointing at the dying cell now. A plain field write, safe
    /// during sweep.
    pub(crate) fn promise_cell_collected(&self) {
        self.promise_cell.set(JSValue::ZERO);
    }

    /// Once the response is detached or ended, the promise this context
    /// subscribed to can no longer do anything for the request. Reclaim the
    /// cell's claim so the context is torn down now instead of when GC
    /// collects the promise; the settle reactions then see a null `take()`
    /// and no-op. A no-op when no claim is outstanding (the common case on
    /// paths reached from a settle reaction, which already cleared the field).
    pub(crate) fn reclaim_promise_cell(&self) {
        let cell = self.promise_cell.replace(JSValue::ZERO);
        if cell.is_empty() {
            return;
        }
        // SAFETY: from `create_promise_cell`; the field is cleared when the cell is collected.
        let claim = unsafe { native_promise_context::take::<Self>(cell) };
        if claim.is_some() && !self.did_upgrade_web_socket() {
            native_promise_context::take_held(cell);
        }
    }

    /// The server's JS wrapper, or `undefined` if `error()` already ran for this request.
    fn server_js_for_error_handler(&self) -> JSValue {
        if self.flags.has_called_error_handler() {
            return JSValue::UNDEFINED;
        }
        self.server()
            .js_value()
            .try_get()
            .unwrap_or(JSValue::UNDEFINED)
    }

    /// Reports an error a handler threw after `server.upgrade()`, like any other handler error:
    /// calls `server_js`'s `error()`, or falls back to the unhandled rejection path. `error()`'s
    /// return value is discarded because there's no response left to send it on.
    fn report_error_after_upgrade(global: &JSGlobalObject, server_js: JSValue, value: JSValue) {
        if !global.bun_vm().script_allowed() {
            return;
        }
        let mut unhandled = value;
        if server_js.is_cell()
            && let Some(on_error) = crate::server::server_js_cached!(
                SSL_ENABLED,
                DEBUG_MODE,
                on_error_get_cached(server_js)
            )
        {
            let result = on_error
                .call(global, server_js, &[value])
                .unwrap_or_else(|err| global.take_exception(err));
            let Some(err) = result.to_error() else {
                Self::discard_response_body(global, result);
                return;
            };
            unhandled = err;
        }
        let vm = global.bun_vm();
        report_unhandled_error(vm, global, unhandled);
    }

    pub(crate) fn on_reject(
        cx: &mut JsScope<'_>,
        reason: JsLocal<'_>,
        (context, cell): (Option<RefPtr<Self>>, JsLocal<'_>),
    ) {
        ctx_log!("onReject");

        // Pass the rejection reason through verbatim (including `null` and
        // `undefined`) so `error()` sees the same value the already-settled
        // path delivers. Only an empty JSValue is normalized.
        let err = if reason.to_js().is_empty() {
            JSValue::UNDEFINED
        } else {
            reason.to_js()
        };
        let Some(ctx) = context else {
            // A termination path (abort, end, upgrade) reclaimed the cell's
            // claim; the context may already be gone. Only an upgrade leaves
            // the server wrapper in the cell to report the error through.
            let server_js = native_promise_context::take_held(cell.to_js());
            if !server_js.is_empty() {
                Self::report_error_after_upgrade(cx.global(), server_js, err);
            }
            return;
        };
        ctx.promise_cell.set(JSValue::ZERO);

        ctx.handle_reject(err);
    }

    fn handle_reject(&self, value: JSValue) {
        if self.is_aborted_or_ended() {
            return;
        }

        let resp = self.resp.get().expect("infallible: resp bound");
        // SAFETY: FFI handle, just checked Some
        let has_responded = resp.has_responded();

        // The status line is already committed (a direct stream's pull() threw
        // synchronously after the headers were written): report and close.
        if !has_responded && self.flags.has_written_status() {
            if !value.is_empty_or_undefined_or_null()
                && let Some(server) = self.try_server()
            {
                server.vm().run_error_handler(value, None);
            }
            self.close_incomplete_stream();
            return;
        }

        if !has_responded {
            let _dispatch = Dispatch::new(self);
            self.run_error_handler(value);
            if self.flags.has_marked_complete() {
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

        // SAFETY: FFI handle
        if !resp.has_responded()
            && !self.flags.has_marked_pending()
            && !self.flags.is_error_promise_pending()
        {
            self.render_missing();
            return;
        }
    }

    fn render_missing(&self) {
        if let Some(resp) = self.resp.get() {
            resp.run_corked_with_type(Self::render_missing_corked, self);
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
        Output::flush();

        // Reporting the error runs script, which can abort the request.
        let Some(resp) = self.resp.get() else { return };
        if !self.flags.has_written_status() {
            self.flags.set_has_written_status(true);
            resp.write_status(b"500 Internal Server Error");
            resp.write_header(b"content-type", &bun_http_types::MimeType::HTML.value);
        }

        if self.method == Method::HEAD {
            self.end_without_body(self.should_close_connection());
            return;
        }

        let bb = DevErrorPage {
            message,
            cwd: bun_resolver::fs::FileSystem::get().top_level_dir(),
            exceptions,
            log: Some(log),
        }
        .render();
        if resp.try_end(&bb, bb.len(), self.should_close_connection()) {
            drop(bb);
            let _base_ref = self.detach_response();
            self.end_request_streaming_and_drain();
            self.finalize_without_deinit();
            return;
        }

        self.flags.set_has_marked_pending(true);
        self.response_buf_owned.set(bb);
        resp.on_writable(
            |this, off, resp| Self::on_writable_complete_response_buffer(this, off, resp),
            self.as_ctx_ptr(),
        );
    }

    /// Drain a partial response buffer
    pub(crate) fn drain_response_buffer_and_metadata(&self) {
        if let Some(resp) = self.resp.get() {
            self.render_metadata();

            let mut buffer = self.response_buf_owned.replace(Vec::new());
            // SAFETY: FFI handle
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
            let _base_ref = self.detach_response();
            self.reclaim_promise_cell();
            // SAFETY: FFI handle
            resp.end(data, close_connection);
            // end_request_streaming_and_drain() must run after the last
            // `resp` access: its drain_microtasks() can re-enter lsquic (H3)
            // and free the stream out from under the local `resp` copy.
            self.end_request_streaming_and_drain();
        }
    }

    pub(crate) fn end_stream(&self, close_connection: bool) {
        ctx_log!("endStream");
        if let Some(resp) = self.resp.get() {
            let _base_ref = self.detach_response();
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
        }
    }

    /// `end_stream()` for a response the sink already ended
    /// (`HTTPServerWritable::ended_response`), where `resp` must no longer be
    /// dereferenced. `markDone()` already did what `detach_response()` would.
    ///
    /// HTTP/1 arrives from the stream's resolve/reject reaction, by then
    /// uSockets may have freed or recycled the socket. HTTP/2 and HTTP/3
    /// arrive from `on_abort`, which is the last call on a freed stream.
    ///
    /// An H2/H3 reaction must use `end_stream()` instead: its `resp` is still
    /// alive, and `detach_response()` has to disarm the still-armed
    /// `onAborted` before the context goes, or it fires on a freed pool slot.
    pub(crate) fn end_already_responded_stream(&self) {
        ctx_log!("endAlreadyRespondedStream");
        // `resp` may be freed (see above); the sink resumed it at `ended_response = true`.
        self.flags.set_request_body_paused(false);
        if let Some((_, _base_ref)) = self.resp.take() {
            self.flags.set_is_waiting_for_request_body(false);
            self.flags.set_has_abort_handler(false);
            self.request_body_buf.set(Vec::new());
            self.reclaim_promise_cell();
            self.end_request_streaming_and_drain();
        }
    }

    pub(crate) fn end_without_body(&self, close_connection: bool) {
        ctx_log!("endWithoutBody");
        if let Some(resp) = self.resp.get() {
            let _base_ref = self.detach_response();
            // uWS markDone() clears onAborted on end, so on_abort can never
            // run for this request; this is the last chance to reclaim an
            // outstanding claim (e.g. a 413 while the handler promise parks).
            self.reclaim_promise_cell();
            // SAFETY: FFI handle
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
        }
    }

    /// Answers 500 with no body, for a request that was saved to run later and now never will.
    /// A request that got an answer while it waited (a 413) has detached its response, so
    /// nothing more is written to it.
    pub(crate) fn end_with_internal_server_error(&self) {
        if let Some(resp) = self.resp.get() {
            self.flags.set_has_written_status(true);
            resp.write_status(b"500 Internal Server Error");
            resp.write_header_int(b"Content-Length", 0);
        }
        self.end_without_body(true);
    }

    /// Answers 413 to a request whose body outgrew `maxRequestBodySize`, after that body has failed.
    fn end_with_payload_too_large(&self) {
        let Some(resp) = self.resp.get() else { return };
        // A dev server bundle that this request waits for must not answer it later.
        if let Some(deferred) = self.deferred_request.take() {
            deferred.on_abort();
        }
        // Failing the body runs JS, which can answer with a file. The file stream
        // owns the response from then on, and it hears the close as an abort.
        if self.flags.has_sendfile_ctx() {
            resp.force_close();
            return;
        }
        if !resp.has_responded() {
            self.flags.set_has_written_status(true);
            resp.write_status(b"413 Payload Too Large");
        }
        // The normal end path detaches `self.resp` and releases the base ref. uWS
        // markDone() clears onAborted, so no abort would ever do either.
        self.end_without_body(!MUX);
        self.unpipe();
    }

    /// For a natively piped body that has nobody left to take it.
    fn unpipe(&self) {
        if let Some(stream) = self.byte_stream.take() {
            shim::byte_stream_unpipe(stream);
        }
    }

    pub(crate) fn force_close(&self) {
        if let Some(resp) = self.resp.get() {
            let _base_ref = self.detach_response();
            self.reclaim_promise_cell();
            // SAFETY: FFI handle
            resp.force_close();
            // end_request_streaming_and_drain() must run after the last
            // `resp` access: its drain_microtasks() can re-enter lsquic (H3)
            // and free the stream out from under the local `resp` copy.
            self.end_request_streaming_and_drain();
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
        this: *mut Self,
        write_offset: u64,
        resp: uws::AnyResponse,
    ) -> bool {
        ctx_log!("onWritableCompleteResponseBuffer");
        let pinned = RequestContextRef::pin(this);
        let this = pinned.ctx();
        debug_assert!(this.resp.get().is_some());
        if this.is_aborted_or_ended() {
            return false;
        }
        this.send_writable_bytes_for_complete_response_buffer(write_offset, resp)
    }

    #[inline]
    fn any_request(r: *mut Req<SSL_ENABLED, MUX>) -> uws::AnyRequest {
        if MUX {
            uws::AnyRequest::H3(r.cast::<bun_uws_sys::h3::Request>())
        } else {
            uws::AnyRequest::H1(r.cast::<bun_uws_sys::Request>())
        }
    }

    #[inline]
    fn req_method(r: *mut Req<SSL_ENABLED, MUX>) -> &'static [u8] {
        // SAFETY: r is a live uWS/lsquic request handle for the duration of
        // the request callback; both surfaces return request-owned slices.
        unsafe {
            if MUX {
                (*r.cast::<bun_uws_sys::h3::Request>()).method()
            } else {
                (*r.cast::<bun_uws_sys::Request>()).method()
            }
        }
    }

    pub(crate) fn create(
        this: &mut core::mem::MaybeUninit<Self>,
        server: &ThisServer,
        req: *mut Req<SSL_ENABLED, MUX>,
        resp: uws::AnyResponse,
        method: Option<Method>,
    ) {
        let resolved_method = method
            .or_else(|| Method::which(Self::req_method(req)))
            .unwrap_or(Method::GET);
        let any_req = Self::any_request(req);
        let range = RangeRequest::raw_from_request(&any_req);
        let if_range = RangeRequest::if_range_from_request(&any_req, range);
        let slot: *mut Self = this.as_mut_ptr();
        // SAFETY: writing to MaybeUninit slot. `resp` adopts its first ref, which does not read the slot.
        unsafe {
            slot.write(Self {
                root: Cell::new(slot),
                resp: AttachedResponse(JsCell::new(Some((resp, RefPtr::from_raw(slot))))),
                req: Cell::new(Some(req)),
                method: resolved_method,
                server: JsCell::new(Some(PendingRequest::new(bun_ptr::BackRef::new(server)))),
                range,
                if_range,
                request_weakref: JsCell::new(request::WeakRef::EMPTY),
                signal: JsCell::new(None),
                cookies: JsCell::new(None),
                flags: Flags::<DEBUG_MODE>::default(),
                upgrade_context: Cell::new(UpgradeState::None),
                response_root: ResponseRoot::default(),
                ref_count: Cell::new(1),
                pin_count: Cell::new(0),
                dispatch_count: Cell::new(0),
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
                deferred_request: Cell::new(None),
                promise_cell: Cell::new(JSValue::ZERO),
            });
        }

        ctx_log!("create<d> ({:p})<r>", this.as_ptr());
    }

    fn on_close(this: *mut Self, resp: uws::AnyResponse) {
        let pinned = RequestContextRef::pin(this);
        let ctx = pinned.ctx();
        // The parser gives the body of a tunnel no last chunk: the close ends it.
        if !MUX && ctx.flags.is_waiting_for_request_body() && resp.is_connect_request() {
            Self::on_buffered_body_chunk(this, b"", true);
            // Answered or released: nothing is left to abort.
            if ctx.resp.get().is_none() || resp.has_responded() {
                return;
            }
        }
        Self::on_abort(this, resp);
    }

    fn on_abort(this: *mut Self, resp: uws::AnyResponse) {
        ctx_log!("onAbort");
        let pinned = RequestContextRef::pin(this);
        let this = pinned.ctx();
        debug_assert!(this.resp.get().is_some());
        debug_assert!(this.server.get().is_some());
        let server = this.server();
        let vm = server.vm();
        // Both arms below can reject a parked request-body read and drain.
        // The held count keeps that drain from checkpointing mid-frame.
        let _entered = vm.enter_event_loop_scope_without_checkpoint();
        // An H2/H3 stream is destroyed once both sides finish, so this also
        // fires after a successful end(); HTTP/1 keep-alive sockets never do.
        // Only the sink ends a response without `detach_response()`, and its
        // reaction does nothing once `resp` is gone, so end the request here.
        if MUX {
            // SAFETY: FFI handle
            if resp.has_responded() {
                // The sink can outlive this call; `resp` dies with the stream.
                if let Some(sink) = this.sink_mut() {
                    sink.res = None;
                }
                this.end_already_responded_stream();
                return;
            }
        }
        debug_assert!(!this.flags.aborted());
        // mark request as aborted
        this.flags.set_aborted(true);
        if let Some(deferred) = this.deferred_request.take() {
            deferred.on_abort();
        }

        let _base_ref = this.detach_response();
        let any_js_calls = core::cell::Cell::new(false);
        let global_this = server.global_this();
        // This is a task in the event loop.
        // If we called into JavaScript, we must drain the microtask queue.
        scopeguard::defer! {
            if any_js_calls.get() {
                vm.drain_microtasks();
            }
        }

        if let Some(request) = this.request() {
            request.request_context.set(AnyRequestContext::NULL);
            this.request_weakref.set(request::WeakRef::EMPTY);
        }
        // if signal is not aborted, abort the signal
        if let Some(signal) = this.signal.take()
            && !signal.aborted()
        {
            signal.signal(global_this, jsc::CommonAbortReason::ConnectionClosed);
            any_js_calls.set(true);
        }

        // if have sink, call onAborted on sink
        if let Some(sink) = this.sink.get() {
            // The sink abort runs the stream's JS onClose through its signal.
            any_js_calls.set(true);
            // SAFETY: `sink` is the live sink allocated by do_render_stream.
            // `abort` takes the raw pointer because the teardown it can
            // re-enter frees the sink.
            unsafe { ResponseStream::<SSL_ENABLED>::abort(sink.as_ptr()) };
            // Reject a parked request-body read while this abort still drains microtasks.
            let _ = this.end_request_streaming();
            this.reclaim_promise_cell();
            return;
        }

        this.unpipe();

        // if we can, free the request now.
        if this.is_dead_request() {
            this.finalize_without_deinit();
        } else {
            if this.end_request_streaming().unwrap_or(true) {
                // TODO: properly propagate exception upwards
                any_js_calls.set(true);
            }

            if let Some(response) = this.response_mut() {
                if let Some(stream) = shim::response_body_stream(response) {
                    let _keep = jsc::EnsureStillAlive(stream.value);
                    shim::response_detach_stream(response, global_this);
                    crate::dispatch::fold(stream.abort(global_this));
                    any_js_calls.set(true);
                }
            }
        }

        // Reclaim only after the block above: the claim's ref must still
        // count in `is_dead_request`, so a parked request-body read goes
        // through `end_request_streaming` here and its rejection is drained.
        this.reclaim_promise_cell();
    }

    // This function may be called multiple times
    // so it's important that we can safely do that
    pub(crate) fn finalize_without_deinit(&self) {
        ctx_log!("finalizeWithoutDeinit<d> ({:p})<r>", self);
        // First: the stream holds no ref, so nothing below may reach `end_chunk` through it.
        self.unpipe();
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

        // A stream pump that settles after this point finds no context
        // (`reclaim_promise_cell`), so its `handle_*_stream` cleanup never
        // runs: release the body's hold on the stream here.
        release_body_stream(&self.response_weakref, global_this);

        self.response_root.clear();
        self.response_weakref.set(response::WeakRef::EMPTY);

        // The stream ref itself is errored and released by `end_request_streaming()` below.
        self.detach_request_body_producer();

        // Releases the ref taken in `set_cookies` (via `CookieMapRef::drop`).
        drop(self.cookies.replace(None));

        if let Some(request) = self.request() {
            request.request_context.set(AnyRequestContext::NULL);
            self.request_weakref.set(request::WeakRef::EMPTY);
        }

        // if signal is not aborted, abort the signal
        if let Some(signal) = self.signal.take()
            && self.flags.aborted()
            && !signal.aborted()
        {
            signal.signal(global_this, jsc::CommonAbortReason::ConnectionClosed);
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

        self.response_body_readable_stream_ref
            .set(readable_stream::Strong::Empty);

        self.pathname.set(BunString::EMPTY);
    }

    fn on_file_stream_complete(ctx: *mut c_void, _resp: uws::AnyResponse) {
        let pinned = RequestContextRef::pin(ctx.cast::<Self>());
        let this = pinned.ctx();
        let _base_ref = this.detach_response();
        this.end_request_streaming_and_drain();
    }

    fn on_file_stream_abort(ctx: *mut c_void, resp: uws::AnyResponse) {
        Self::on_abort(ctx.cast::<Self>(), resp);
    }

    fn on_file_stream_error(ctx: *mut c_void, resp: uws::AnyResponse, _err: bun_sys::Error) {
        // FileResponseStream already force-closed the socket; just clean up.
        Self::on_file_stream_complete(ctx, resp);
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
        this: *mut Self,
        write_offset: u64,
        _resp: uws::AnyResponse,
    ) -> bool {
        ctx_log!("onWritableResponseStream({})", write_offset);
        let pinned = RequestContextRef::pin(this);
        let this = pinned.ctx();
        if let Some(sink) = this.sink_mut() {
            return sink.on_writable(write_offset, _resp);
        }
        true
    }

    fn on_writable_bytes(this: *mut Self, write_offset: u64, resp: uws::AnyResponse) -> bool {
        ctx_log!("onWritableBytes");
        let pinned = RequestContextRef::pin(this);
        let this = pinned.ctx();
        debug_assert!(this.resp.get().is_some());
        if this.is_aborted_or_ended() {
            return false;
        }

        let bytes: &[u8] = this.blob.get().slice();

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
        // SAFETY: FFI handle
        if resp.try_end(bytes, bytes_.len(), self.should_close_connection()) {
            let _base_ref = self.detach_response();
            self.end_request_streaming_and_drain();
            true
        } else {
            self.flags.set_has_marked_pending(true);
            // SAFETY: FFI handle
            resp.on_writable(
                |this, off, resp| Self::on_writable_bytes(this, off, resp),
                self.as_ctx_ptr(),
            );
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
        // SAFETY: FFI handle
        let done = resp.try_end(bytes, total_len, close_connection);
        if done {
            drop(buffer);
            let _base_ref = self.detach_response();
            self.end_request_streaming_and_drain();
        } else {
            self.response_buf_owned.set(buffer);
            self.flags.set_has_marked_pending(true);
            // SAFETY: FFI handle
            resp.on_writable(
                |this, off, resp| Self::on_writable_complete_response_buffer(this, off, resp),
                self.as_ctx_ptr(),
            );
        }

        true
    }

    /// Bun adds no validators here, so only the handler's `ETag` / `Last-Modified` can match.
    fn if_range_matches_response(&self) -> bool {
        let Some(if_range) = self.if_range.as_deref() else {
            return true;
        };
        let Some(headers) = self.response_mut().and_then(|r| r.get_init_headers_mut()) else {
            return false;
        };
        let etag = headers
            .fast_get(jsc::HTTPHeaderName::ETag)
            .map(|v| v.to_utf8().into_owned());
        let last_modified_ms = headers
            .fast_get(jsc::HTTPHeaderName::LastModified)
            .and_then(|v| crate::jsc_hooks::parse_http_date(v.to_utf8().slice()));
        RangeRequest::if_range_matches(if_range, etag.as_deref(), last_modified_ms)
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
        let mut file_buf = bun_paths::path_buffer_pool::get();
        let opened = match &file.pathlike {
            crate::webcore::node_types::PathOrFileDescriptor::Fd(_) => None,
            crate::webcore::node_types::PathOrFileDescriptor::Path(path) => {
                match bun_sys::File::open(
                    path.slice_z(&mut file_buf),
                    bun_sys::O::RDONLY | bun_sys::O::NONBLOCK | bun_sys::O::CLOEXEC,
                    0,
                ) {
                    bun_sys::Result::Ok(opened) => Some(opened),
                    bun_sys::Result::Err(err) => {
                        let js_err = err.with_path(path.slice()).to_js(global_this);
                        return self.run_error_handler(js_err);
                    }
                }
            }
        };
        let fd = opened
            .as_ref()
            .map_or_else(|| file.pathlike.fd(), bun_sys::File::fd);

        let stat: bun_sys::Stat = match bun_sys::fstat(fd) {
            bun_sys::Result::Ok(s) => s,
            bun_sys::Result::Err(err) => {
                drop(opened);
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
                drop(opened);
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
        if is_regular && opened.is_some() {
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
        let user_handles_range = if let Some(r) = self.response_mut() {
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
            && self.if_range_matches_response()
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
                    drop(opened);
                    let mut crbuf = [0u8; RangeRequest::CONTENT_RANGE_BUF];
                    self.do_write_status(416);
                    if let Some(response) = self.response_mut() {
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
                    let _base_ref = self.detach_response();
                    resp.end(b"", close);
                    self.end_request_streaming_and_drain();
                    return;
                }
            }
        }

        resp.run_corked_with_type(Self::render_metadata, self);

        let sendfile = self.sendfile.get();
        if (is_regular && sendfile.remain == 0) || !self.method.has_body() {
            drop(opened);
            // SAFETY: FFI handle
            let close = resp.should_close_connection();
            let _base_ref = self.detach_response();
            // SAFETY: FFI handle
            resp.end(b"", close);
            self.end_request_streaming_and_drain();
            return;
        }

        // A closed HTTP/1 socket takes no handler, so `FileResponseStream` would not hear of the close.
        if !MUX && resp.is_closed() {
            if is_regular {
                let _base_ref = self.detach_response();
                self.end_request_streaming_and_drain();
            }
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
            fd: opened.map_or(file_response_stream::StreamFd::Borrowed(fd), Into::into),
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
            owner: file_response_stream::StreamOwner::Ctx {
                ctx: self.as_ctx_ptr().cast::<c_void>(),
                on_complete: Self::on_file_stream_complete,
                on_abort: Some(Self::on_file_stream_abort),
                on_error: Self::on_file_stream_error,
            },
        });
    }

    fn do_render_with_body_locked(this: NonNull<c_void>, value: &mut Body::Value) {
        // SAFETY: the +1 taken at the `on_receive_value` registration site.
        let this = unsafe { RefPtr::from_raw(this.cast::<Self>().as_ptr()) };
        this.do_render_with_body(std::ptr::from_mut(value), None);
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

    fn handle_first_stream_write(&self) {
        if !self.flags.has_written_status() {
            self.render_metadata();
        }
    }

    /// C-ABI thunk for `HTTPServerWritable::on_first_write` (`fn(?*anyopaque)`).
    fn handle_first_stream_write_thunk(ctx: Option<*mut c_void>) {
        let Some(ctx) = ctx else { return };
        // SAFETY: ctx is the `*mut Self` stashed in `sink.ctx` by
        // do_render_stream; the sink (and so this context) is live for the
        // synchronous write that fires this.
        Self::handle_first_stream_write(unsafe { &*ctx.cast::<Self>() });
    }

    /// `on_abort` ran from inside the user code `do_render_stream` invoked
    /// (`server.stop(true)` in `pull()`): it aborted the sink, detached `resp`
    /// and took over the base ref, leaving only the sink and stream to drop.
    /// Keyed on `resp` being gone, not on `is_aborted_or_ended()`: a stop that
    /// found the response already complete never reaches `on_abort`, and that
    /// request still owns its ref, which the regular arms release.
    fn discard_stream_after_abort(
        &self,
        stream: &WebCore::ReadableStream,
        global_this: &JSGlobalObject,
    ) {
        stream_log!("aborted while attaching the stream");
        let _readable_ref = self.response_body_readable_stream_ref.take();
        if let Some(owned_sink) = self.sink.take() {
            // SAFETY: `on_abort` has returned, so nothing else borrows the sink.
            let sink = unsafe { &mut *owned_sink.as_ptr() };
            sink.source.detach(global_this);
            crate::dispatch::fold(stream.cancel(global_this));
            sink.mark_done();
            sink.on_first_write = None;
            sink.finalize();
        }
    }

    fn do_render_stream(pair: &StreamPair<'_, ThisServer, SSL_ENABLED, DEBUG_MODE, MUX>) {
        ctx_log!("doRenderStream");
        let this: &Self = pair.this;
        let stream = &pair.stream;
        debug_assert!(this.server.get().is_some());
        let global_this = this.server().global_this();

        // Armed here, not in `to_async()`: `stop(true)` inside `pull()` must reach `on_abort`; see `end_already_responded_stream`.
        this.set_abort_handler();
        if this.is_aborted_or_ended() {
            // No reader yet: `cancel()` would skip the stream.
            crate::dispatch::fold(stream.cancel_with_reason(global_this, JSValue::UNDEFINED));
            this.response_body_readable_stream_ref
                .set(readable_stream::Strong::Empty);
            return;
        }
        let resp = this.resp.get().expect("infallible: resp bound");

        stream.value.ensure_still_alive();

        let sink = AliasableBox::new(ResponseStream::<SSL_ENABLED>::new(
            resp,
            Self::handle_first_stream_write_thunk,
            this.as_ctx_ptr().cast::<c_void>(),
            global_this,
        ));
        // SAFETY: just allocated, and `this.sink` only frees it.
        let response_stream = unsafe { &mut *sink.as_ptr() };
        this.sink.set(Some(sink));

        // we need to render metadata before assignToStream because the stream can call res.end
        // and this would auto write an 200 status
        if !this.flags.has_written_status() {
            this.render_metadata();
        }

        resp.on_writable(
            |this, off, resp| Self::on_writable_response_stream(this, off, resp),
            this.as_ctx_ptr(),
        );

        // We are already corked!
        let assignment_result: JSValue = ReadableSinkController::assign_to_stream(
            global_this,
            stream.value,
            NonNull::from(&mut *response_stream),
        );

        assignment_result.ensure_still_alive();

        // assignToStream stored the controller in `sink.source`; a sync-finished stream's
        // controller may already have cleared it again as it detached (handled below).

        let aborted = this.flags.aborted() || response_stream.is_aborted();
        this.flags.set_aborted(aborted);

        if this.resp.get().is_none() {
            this.discard_stream_after_abort(stream, global_this);
            return;
        }

        // Checked before the thrown-error arm below: a sync `pull()` that ends
        // the response and then throws has already put a complete body on the
        // wire, so the throw must not end the response again. `handle_reject()`
        // does nothing once the response has responded, which leaves the
        // request looking unanswered: the handler tail
        // (`should_render_missing()` in `respond`) then ends it a second time,
        // writing a second chunked last-chunk.
        if resp.has_responded() {
            stream_log!("done");
            response_stream.source.detach(global_this);
            this.sink.set(None);
            stream.done();
            this.response_body_readable_stream_ref
                .set(readable_stream::Strong::Empty);
            this.end_stream(this.should_close_connection());
            return;
        }

        if let Some(err_value) = assignment_result.to_error() {
            stream_log!("returned an error");
            response_stream.source.detach(global_this);
            this.sink.set(None);
            return this.handle_reject(err_value);
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
            if let Some(flush) = response_stream.pending_flush() {
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
                            response_stream.on_first_write = None;
                            response_stream.ctx = None;
                            this.render_metadata();
                        }

                        // TODO: should this timeout?
                        let body_value = this.response_mut().unwrap().get_body_value();
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
                        let _readable_ref = this.response_body_readable_stream_ref.take();
                        this.handle_resolve_stream();
                        stream.done();
                    }
                    jsc::PromiseResult::Rejected(err) => {
                        stream_log!("promise Rejected");
                        // Consuming the rejection here is what keeps it out of
                        // the unhandledRejection reporter, so surface it here.
                        // DEBUG_MODE already reports it in handle_reject_stream.
                        if !DEBUG_MODE
                            && let Some(server) = this.try_server()
                            && !err.is_empty_or_undefined_or_null()
                        {
                            server.vm().run_error_handler(err, None);
                        }
                        let _readable_ref = this.response_body_readable_stream_ref.take();
                        this.handle_reject_stream(global_this, err);
                        crate::dispatch::fold(stream.cancel(global_this));
                    }
                }
                return;
            } else {
                // if is not a promise we treat it as Error
                stream_log!("returned an error");
                response_stream.source.detach(global_this);
                this.sink.set(None);
                return this.handle_reject(effective_result);
            }
        }

        let readable_ref = this.response_body_readable_stream_ref.take();

        let is_in_progress = response_stream.has_backpressure
            || !(response_stream.wrote == 0 && response_stream.buffer.len() == 0);

        if !stream.is_locked(global_this) && !is_in_progress {
            if let Some(comparator) = WebCore::ReadableStream::from_js_direct(stream.value) {
                if core::mem::discriminant(&comparator.ptr) == core::mem::discriminant(&stream.ptr)
                {
                    stream_log!("is not locked");
                    response_stream.on_first_write = None;
                    response_stream.ctx = None;
                    response_stream.source.detach(global_this);
                    response_stream.mark_done();
                    response_stream.finalize();
                    this.sink.set(None);
                    drop(readable_ref);
                    this.render_missing();
                    return;
                }
            }
        }

        stream_log!("is in progress, but did not return a Promise. Finalizing request context");
        response_stream.on_first_write = None;
        response_stream.ctx = None;
        response_stream.source.detach(global_this);
        crate::dispatch::fold(stream.cancel(global_this));
        response_stream.mark_done();
        response_stream.finalize();
        this.sink.set(None);
        drop(readable_ref);
        this.render_missing();
    }

    pub(crate) fn did_upgrade_web_socket(&self) -> bool {
        matches!(self.upgrade_context.get(), UpgradeState::Upgraded)
    }

    /// An HTTP response has started on this connection, so `server.upgrade()` must now fail.
    fn forbid_upgrade(&self) {
        if let UpgradeState::Pending(_) = self.upgrade_context.get() {
            self.upgrade_context.set(UpgradeState::None);
        }
    }

    fn to_async_without_abort_handler(
        &self,
        req: *mut Req<SSL_ENABLED, MUX>,
        request_object: &Request,
    ) {
        debug_assert!(self.server.get().is_some());

        // For HTTP/3, prepareJsRequestContextFor() already eagerly
        // populated url+headers (the lazy getRequest() path is H1-only),
        // so the guards below short-circuit and `req` is never read.
        if !MUX {
            // `Req<SSL,H3>` is erased to `c_void`; for !MUX the concrete
            // type is `uws::Request`, so the cast is nominal.
            request_object
                .request_context
                .get()
                .set_request(req.cast::<uws::Request>());
        }

        if request_object.ensure_url().is_err() {
            request_object.url.set(BunString::EMPTY);
        }

        // we have to clone the request headers here since they will soon belong to a different request
        if !request_object.has_fetch_headers() {
            if !MUX {
                // `HeadersRef::create_from_uws` adopts the freshly-allocated +1 ref.
                request_object.set_fetch_headers(Some(response::HeadersRef::create_from_uws(req)));
            }
        }

        // This object dies after the stack frame is popped
        // so we have to clear it in here too
        request_object.request_context.get().detach_request();
    }

    pub(crate) fn to_async(&self, req: *mut Req<SSL_ENABLED, MUX>, request_object: &Request) {
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
            self.server().vm().drain_microtasks();
        }
    }

    fn end_request_streaming(&self) -> JsResult<bool> {
        debug_assert!(self.server.get().is_some());

        self.request_body_buf.set(Vec::new());

        let mut any_js_calls = false;

        // Reject a pending .text()/.json()/.blob()/... whose body never fully arrived.
        if let Some(body) = self.request_body_mut() {
            if matches!(body, Body::Value::Locked(_)) {
                let global_this = self.server().global_this();
                body.to_error_instance(
                    Body::ValueError::AbortReason(jsc::CommonAbortReason::ConnectionClosed),
                    global_this,
                )?;
                any_js_calls = true;
            }
        }

        // Nothing feeds our ByteStream from here on; after `req.clone()`/`textStream()` only this ref reaches it.
        let strong = self
            .request_body_readable_stream_ref
            .replace(readable_stream::Strong::default());
        if let Some(readable) = strong.get() {
            readable.value.ensure_still_alive();
            if let Some(bytes) = readable.ptr.bytes() {
                bytes
                    .parent_const()
                    .producer
                    .set(WebCore::streams::SourceHandle::None);
                // False unless `to_error_instance` above reached this same stream through the body.
                if !bytes.has_received_last_chunk.get() {
                    let global_this = self.server().global_this();
                    let mut err =
                        Body::ValueError::AbortReason(jsc::CommonAbortReason::ConnectionClosed);
                    bytes.on_data(WebCore::streams::Result::Err(
                        err.to_stream_error(global_this),
                    ));
                    any_js_calls = true;
                }
            }
        }

        Ok(any_js_calls)
    }

    #[must_use = "dropping it releases the base ref"]
    pub(crate) fn detach_response(&self) -> Option<RefPtr<Self>> {
        let (resp, base_ref) = self.resp.take()?;
        self.request_body_buf.set(Vec::new());
        // The sink writes through its own handle to the response.
        if let Some(sink) = self.sink_mut() {
            sink.revoke_response();
        }
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
        Some(base_ref)
    }

    pub(crate) fn is_aborted_or_ended(&self) -> bool {
        // resp == null or aborted or server.stop(true)
        self.resp.get().is_none()
            || self.flags.aborted()
            || self.server.get().is_none()
            || self.server().terminated()
    }

    fn do_render_head_response(
        pair: &HeaderResponsePair<'_, ThisServer, SSL_ENABLED, DEBUG_MODE, MUX>,
    ) {
        let this = pair.this;
        let response = &pair.response;
        if this.resp.get().is_none() {
            return;
        }
        // we will render the content-length header later manually so we set this to false
        this.flags.set_needs_content_length(false);
        // Always this.renderMetadata() before sending the content-length or transfer-encoding header so status is sent first

        let resp = this.resp.get().expect("infallible: resp bound");
        this.set_response(response);

        // `render` drops the body for a null-body status on GET, so HEAD must
        // not derive framing from that body (or the user headers) either
        // (RFC 9110 §9.3.2): render the exact metadata+framing GET would.
        if HTTPStatusText::is_null_body(response.status_code()) {
            this.do_render_null_body_status_corked();
            return;
        }

        let Some(server) = this.try_server() else {
            // server detached?
            this.render_metadata();
            // SAFETY: FFI handle
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
                    // SAFETY: FFI handle
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
                let blob = body_value.use_as_any_blob_allow_non_utf8_string();
                let size = blob.size();
                this.render_metadata();

                if size == crate::webcore::blob::MAX_SIZE {
                    resp.write_header_int(b"content-length", 0);
                } else {
                    resp.write_header_int(b"content-length", size as u64);
                }
                this.end_without_body(this.should_close_connection());
            }

            Body::Value::Blob(blob) => {
                // Size the blob *before* `render_metadata()`: it re-fetches the
                // Response from `response_weakref`, so no borrow of the Response
                // (here, `blob`) may still be live across it. Nothing is written
                // to the socket in between, so the wire output is unchanged.
                let blob_size = if shim::blob_is_s3(blob) {
                    // Match the body GET sends (`render_bytes`). `resolve_size()` would set the blob's size to 0.
                    blob.shared_view().len() as BlobSizeType
                } else {
                    blob.resolve_size();
                    blob.size.get()
                };
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
                    // SAFETY: FFI handle
                    resp.write_header(b"transfer-encoding", b"chunked");
                }
                // HEAD never transmits the body.
                if let Some(response) = this.response_mut() {
                    Self::cancel_unread_body(response, global_this);
                }
                this.end_without_body(this.should_close_connection());
            }
            Body::Value::Used | Body::Value::Null | Body::Value::Empty | Body::Value::Error(_) => {
                this.render_metadata();
                // SAFETY: FFI handle
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

    /// Ends `dispatch` with what the handler returned. `Some`: the request goes on asynchronously.
    pub(crate) fn respond(
        dispatch: Dispatch<ThisServer, SSL_ENABLED, DEBUG_MODE, MUX>,
        server: &ThisServer,
        request_value: JSValue,
        response_value: JSValue,
    ) -> Option<bun_ptr::BackRef<Self>> {
        dispatch.on_response(server, request_value, response_value);
        if dispatch.flags.has_marked_complete() {
            return None;
        }
        let ctx = dispatch.0;
        drop(dispatch);
        if ctx.should_render_missing() {
            ctx.render_missing();
            return None;
        }
        Some(ctx)
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
    fn on_response(&self, this: &ThisServer, request_value: JSValue, response_value: JSValue) {
        let ctx = self;
        request_value.ensure_still_alive();
        // For a promise, this also roots what it settled with.
        let _keep = jsc::EnsureStillAlive(response_value);
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

        if let Some(response) = Response::from_js(&response_value) {
            if ctx.reject_unsendable_response(response.status_code()) {
                return;
            }
            ctx.response_root.clear();
            if ctx.method == Method::HEAD {
                if let Some(resp) = ctx.resp.get() {
                    let pair = HeaderResponsePair {
                        this: ctx,
                        response,
                    };
                    resp.run_corked_with_type(Self::do_render_head_response, &pair);
                }
                return;
            } else {
                ctx.protect_for_body_and_render(response);
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
                    let Some(response) = Response::from_js(&fulfilled_value) else {
                        ctx.render_missing_invalid_response(fulfilled_value);
                        return;
                    };

                    if ctx.reject_unsendable_response(response.status_code()) {
                        return;
                    }

                    ctx.response_root.clear();
                    if ctx.method == Method::HEAD {
                        if let Some(resp) = ctx.resp.get() {
                            let pair = HeaderResponsePair {
                                this: ctx,
                                response,
                            };
                            resp.run_corked_with_type(Self::do_render_head_response, &pair);
                        }
                        return;
                    }
                    ctx.protect_for_body_and_render(response);
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
        if let Some(sink) = self.sink_mut() {
            if !self.flags.aborted() && !sink.is_aborted() {
                // Only defer when there is still a live response to drain the
                // flush through: on_writable (which resolves the flush via
                // flush_promise) is armed on `resp`. With no response the flush
                // can never settle, so taking a ref and attaching here would
                // leak the ref and hang the request; fall through to teardown.
                if let Some(flush) = sink.pending_flush()
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
        if let Some(owned_sink) = self.sink.take() {
            // SAFETY: the pump has settled, so nothing else borrows the sink.
            let sink = unsafe { &mut *owned_sink.as_ptr() };
            let aborted = self.flags.aborted() || sink.is_aborted();
            self.flags.set_aborted(aborted);
            wrote_anything = sink.wrote > 0;
            ended_response = sink.ended_response;
            if ended_response {
                // `resp` may be freed; the sink already resumed it. Clear these
                // before `detach()` below re-enters JS so any drain callback /
                // `on_start_buffering` reached from there early-returns.
                self.flags.set_request_body_paused(false);
                self.detach_request_body_producer();
            }

            sink.finalize();
            sink.source.detach(&sink.global_this);
        }

        debug_assert!(self.server.get().is_some());
        // server is a BACKREF; `global_this()` returns a lifetime decoupled
        // from `&self`.
        let global_this = self.server().global_this();
        release_body_stream(&self.response_weakref, global_this);
        if let Some(resp) = self.response_mut() {
            // Unlike the reject path: used whatever it held, not only when `Locked`.
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
        // H2/H3 keep the end_stream() path: their `resp` is still
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
        _: &mut JsScope<'_>,
        _: JsLocal<'_>,
        context: Option<RefPtr<Self>>,
    ) {
        stream_log!("onResolveStream");
        let Some(req) = context else {
            return;
        };
        req.promise_cell.set(JSValue::ZERO);
        req.handle_resolve_stream();
    }

    pub(crate) fn on_reject_stream(
        cx: &mut JsScope<'_>,
        err: JsLocal<'_>,
        context: Option<RefPtr<Self>>,
    ) {
        stream_log!("onRejectStream");
        let Some(req) = context else {
            return;
        };
        req.promise_cell.set(JSValue::ZERO);

        req.handle_reject_stream(cx.global(), err.to_js());
    }

    pub(crate) fn handle_reject_stream(&self, global_this: &JSGlobalObject, err: JSValue) {
        stream_log!("handleRejectStream");

        let mut ended_response = false;
        if let Some(owned_sink) = self.sink.take() {
            // SAFETY: the pump has settled, so nothing else borrows the sink.
            let sink = unsafe { &mut *owned_sink.as_ptr() };
            ended_response = sink.ended_response;
            if ended_response {
                // `resp` may be freed; the sink already resumed it. Clear before JS below.
                self.flags.set_request_body_paused(false);
                self.detach_request_body_producer();
            }
            // The body failed: a parked flush()/end() promise is abandoned, not resolved by the teardown below.
            let _ = sink.take_pending_flush();
            sink.set_done();
            let aborted = self.flags.aborted() || sink.is_aborted();
            self.flags.set_aborted(aborted);
            sink.finalize();
            sink.source.detach(&sink.global_this);
        }

        release_body_stream(&self.response_weakref, global_this);

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
            server.vm().run_error_handler(err, None);
            return false;
        }

        let mut exception_list: jsc::ExceptionList = Vec::new();
        server
            .vm()
            .run_error_handler(err, Some(&mut exception_list));

        let bb = DevErrorPage {
            message: b"Stream error during server-side rendering",
            cwd: bun_resolver::fs::FileSystem::get().top_level_dir(),
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

    #[cold]
    fn refuse_used_body(&self) {
        let js_err = self
            .server()
            .global_this()
            .err(
                jsc::ErrorCode::BODY_ALREADY_USED,
                format_args!(
                    "Response body already used. A Response body can only be sent once; create a new Response for each request."
                ),
            )
            .to_js();
        self.run_error_handler(js_err);
    }

    pub(crate) fn do_render_with_body(
        &self,
        value: *mut Body::Value,
        owned_readable: Option<WebCore::ReadableStream>,
    ) {
        // SAFETY: `value` is the live body slot of the response being rendered.
        let value = unsafe { &mut *value };
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
                this.refuse_used_body();
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
                        let js_err = err.to_error_instance(global_this);
                        this.run_error_handler(js_err);
                        return;
                    }

                    match stream.ptr {
                        readable_stream::Source::Invalid => {
                            this.response_body_readable_stream_ref
                                .set(readable_stream::Strong::Empty);
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
                                let pair = StreamPair { stream, this };
                                resp.run_corked_with_type(Self::do_render_stream, &pair);
                            }
                            return;
                        }

                        readable_stream::Source::Bytes(byte_stream_ptr) => {
                            // BACKREF: `stream` keeps its `ByteStream` alive.
                            let byte_stream_nn = NonNull::new(byte_stream_ptr)
                                .expect("Source::Bytes payload is non-null");
                            let byte_stream = bun_ptr::BackRef::from(byte_stream_nn);
                            debug_assert!(byte_stream.sink.get().is_none());
                            debug_assert!(this.byte_stream.get().is_none());
                            if this.resp.get().is_none() {
                                // we don't have a response, so we can discard the stream
                                stream.done();
                                this.response_body_readable_stream_ref
                                    .set(readable_stream::Strong::Empty);
                                return;
                            }
                            let resp = this.resp.get().expect("infallible: resp bound");
                            // If we've received the complete body by the time this function is called
                            // we can avoid streaming it and just send it all at once.
                            // (A stored error goes through the attach path below instead.)
                            if byte_stream.has_received_last_chunk.get()
                                && !byte_stream.has_pending_error()
                            {
                                this.blob
                                    .set(AnyBlob::from_array_list(byte_stream.drain()));
                                this.response_body_readable_stream_ref
                                    .set(readable_stream::Strong::Empty);
                                this.do_render_blob();
                                return;
                            }
                            // Same as do_render_stream's Pending branch: the
                            // body is in flight, so `handle_reject` must not
                            // fall through to render_missing() and end it.
                            this.flags.set_has_marked_pending(true);
                            byte_stream.sink.set(WebCore::SinkHandle::ServerResponse(
                                AnyRequestContext::init(this.as_ctx_ptr()),
                            ));
                            stream.lock_native(global_this);
                            byte_stream.signal_consumer_attached();
                            this.response_body_readable_stream_ref
                                .set(readable_stream::Strong::init(stream, global_this));

                            this.byte_stream.set(Some(byte_stream_nn));
                            let buffer = byte_stream.take_buffer();
                            let has_body_bytes = !buffer.is_empty();
                            this.response_buf_owned.set(buffer);

                            // we don't set size here because even if we have a hint
                            // uWebSockets won't let us partially write streaming content
                            this.blob.with_mut(|b| b.detach());

                            // if we've received metadata and part of the body, send everything we can and drain
                            if has_body_bytes {
                                resp.run_corked_with_type(
                                    Self::drain_response_buffer_and_metadata,
                                    this,
                                );
                            } else if byte_stream.has_pending_error()
                                || matches!(
                                    byte_stream.parent_const().producer.get(),
                                    WebCore::streams::SourceHandle::HTMLRewriter(_)
                                )
                            {
                                // Defer status/headers to the first chunk/end
                                // so a pre-first-byte handler failure can
                                // still reach `error()`.
                            } else {
                                // if we only have metadata to send, send it now
                                resp.run_corked_with_type(Self::render_metadata, this);
                            }
                            // Runs `end_chunk`, which may free `this`.
                            if byte_stream.end_sink_with_pending_error() {
                                return;
                            }
                            // Wake the producer after the older bytes are queued.
                            byte_stream.signal_drained();
                            return;
                        }
                    }
                }

                if lock.has_consumer() {
                    this.refuse_used_body();
                    return;
                }

                if lock.task.is_some() {
                    // The producer waits for `onStartStreaming`.
                    let context = this.script_context();
                    let readable = match value.to_readable_stream(&global_this.js_thread(context)) {
                        Ok(readable) => readable,
                        Err(err) => {
                            this.run_error_handler(global_this.take_exception(err));
                            return;
                        }
                    };
                    readable.ensure_still_alive();
                    this.do_render_with_body(std::ptr::from_mut(value), None);
                    return;
                }

                // No stream and no other consumer: wait for `Value::resolve`.
                // The registered callback owns a +1 on `this`, released by
                // `do_render_with_body_locked`.
                this.ref_();
                this.flags.set_has_marked_pending(true);
                lock.on_receive_value =
                    Some(|ctx, value| Self::do_render_with_body_locked(ctx, value));
                lock.task = Some(NonNull::new(this.as_ctx_ptr().cast::<c_void>()).unwrap());

                return;
            }
            _ => {}
        }

        this.do_render_blob();
    }

    pub(crate) fn write_chunk(
        &self,
        stream: &WebCore::streams::Result<'_>,
    ) -> WebCore::streams::Writable {
        let this = self;
        if this.is_aborted_or_ended() {
            return WebCore::streams::Writable::Done;
        }
        let resp = this.resp.get().expect("infallible: resp bound");

        // A rewriter-produced `Source::Bytes` body defers metadata until the
        // first chunk so a pre-first-byte failure can still reach the
        // server's `error()` hook. Flush it now, corked.
        if !this.flags.has_written_status() {
            resp.run_corked_with_type(Self::render_metadata, this);
        }

        let chunk = stream.slice();
        // on failure, it will continue to allocate
        // we can't do buffering ourselves here or it won't work
        // uSockets will append and manage the buffer
        // so any write will buffer if the write fails
        // SAFETY: FFI handle
        match resp.write(chunk) {
            uws::WriteResult::WantMore(n) => WebCore::streams::Writable::Owned(n as BlobSizeType),
            uws::WriteResult::Backpressure(n) => {
                this.flags.set_has_marked_pending(true);
                // SAFETY: FFI handle
                resp.on_writable(
                    |this, off, resp| Self::on_writable_byte_stream(this, off, resp),
                    this.as_ctx_ptr(),
                );
                WebCore::streams::Writable::Backpressure(n as BlobSizeType)
            }
        }
    }

    pub(crate) fn end_chunk(this: *mut Self, err: Option<&WebCore::streams::StreamError>) {
        // SAFETY: the sink ctx, which `unpipe` detaches before the context is released.
        let guard = unsafe { RefPtr::init_ref(this) };
        let this: &Self = &guard;
        // The stream has already dropped this sink.
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
                    .set(readable_stream::Strong::Empty);
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
                resp.run_corked_with_type(Self::render_metadata, this);
            }
        }
        this.end_stream(this.should_close_connection());
    }

    pub(crate) fn on_writable_byte_stream(
        this: *mut Self,
        _write_offset: u64,
        _resp: uws::AnyResponse,
    ) -> bool {
        ctx_log!("onWritableByteStream");
        // SAFETY: `this` is live for the callback; only a shared view is
        // formed, so the `resume()` re-entry into `write_chunk` is fine.
        let this = unsafe { &*this };
        debug_assert!(this.resp.get().is_some());
        if this.is_aborted_or_ended() {
            return false;
        }
        if let Some(bs) = this.byte_stream.get() {
            bun_ptr::BackRef::from(bs).resume();
        }
        true
    }

    /// False: 416 has been sent.
    fn honor_embedded_file_range(&self) -> bool {
        let AnyBlob::Blob(blob) = self.blob.get() else {
            return true;
        };
        let Some(store) = blob.store() else {
            return true;
        };
        let crate::webcore::blob::store::Data::Bytes(bytes) = &store.data else {
            return true;
        };
        let total = bytes.len();
        if !bun_standalone_graph::Graph::get_ref().is_some_and(|graph| {
            graph.compiled_program.is_some() && graph.contains_file(&bytes.stored_name)
        }) || blob.offset.get() != 0
            || blob.size.get() != total
            || self.method != Method::GET
        {
            return true;
        }
        let user_handles_range = self.response_mut().is_some_and(|response| {
            response.status_code() != 200
                || response
                    .get_init_headers_mut()
                    .is_some_and(|headers| headers.fast_has(jsc::HTTPHeaderName::ContentRange))
        });
        if user_handles_range || !self.if_range_matches_response() {
            return true;
        }
        match self.range.resolve(total) {
            RangeRequest::Result::None => true,
            RangeRequest::Result::Satisfiable { start, end } => {
                let (offset, remain) = (start as BlobSizeType, (end - start + 1) as BlobSizeType);
                blob.offset.set(offset);
                blob.size.set(remain);
                self.sendfile.set(SendfileContext {
                    remain,
                    offset,
                    total,
                });
                self.flags.set_needs_content_range(true);
                true
            }
            RangeRequest::Result::Unsatisfiable => {
                let Some(resp) = self.resp.get() else {
                    return true;
                };
                self.do_write_status(416);
                if let Some(mut headers) = self
                    .response_mut()
                    .and_then(|response| response.swap_init_headers())
                {
                    self.do_write_headers(&mut headers);
                }
                let mut buffer = [0u8; RangeRequest::CONTENT_RANGE_BUF];
                resp.write_header(
                    b"content-range",
                    RangeRequest::format_content_range(
                        &mut buffer,
                        RangeRequest::Result::Unsatisfiable,
                        Some(total),
                    ),
                );
                resp.write_header(b"accept-ranges", b"bytes");
                let close = resp.should_close_connection();
                let _base_ref = self.detach_response();
                resp.end(b"", close);
                self.end_request_streaming_and_drain();
                false
            }
        }
    }

    pub(crate) fn do_render_blob(&self) {
        if self.range != RangeRequest::Raw::None && !self.honor_embedded_file_range() {
            return;
        }
        // We are not corked
        // The body is small
        // Faster to do the memcpy than to do the two network calls
        // We are not streaming
        // This is an important performance optimization
        if self.flags.has_abort_handler() && self.blob.get().fast_size() < 16384 - 1024 {
            if let Some(resp) = self.resp.get() {
                resp.run_corked_with_type(Self::do_render_blob_corked, self);
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
                resp.run_corked_with_type(Self::do_render_null_body_status_corked, self);
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
            let response: &mut Response = this.response_mut().unwrap();
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
        if let Some(server) = this.try_server()
            && let Some(response) = this.response_mut()
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
        this.render_bytes();
    }

    pub(crate) fn do_render(&self) {
        ctx_log!("doRender");

        if self.is_aborted_or_ended() {
            return;
        }
        let (value, owned_readable) = {
            let response: &mut Response = self.response_mut().unwrap();
            let owned_readable = response.get_body_readable_stream();
            (
                std::ptr::from_mut(response.get_body_value()),
                owned_readable,
            )
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
        let Some(server) = self.try_server() else {
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
            // SAFETY: FFI handle
            return resp.should_close_connection();
        }
        false
    }

    fn finish_running_error_handler(&self, value: JSValue, status: u16) {
        self.forbid_upgrade();
        let Some(server) = self.try_server() else {
            return self.render_production_error(status);
        };
        let server = &*server;
        let global_this = server.global_this();
        let vm = server.vm();
        if DEBUG_MODE {
            let mut exception_list: jsc::ExceptionList = Vec::new();
            let prev_exception_list = vm.on_unhandled_rejection_exception_list.get();
            vm.on_unhandled_rejection_exception_list
                .set(Some(NonNull::from(&mut exception_list)));
            report_unhandled_error(vm, global_this, value);
            vm.on_unhandled_rejection_exception_list
                .set(prev_exception_list);

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
            report_unhandled_error(vm, global_this, value);
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
        if let Some(server) = self.try_server() {
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
                    } else if let Some(response) = Response::from_js(&result) {
                        // An unsendable Response from the error handler itself
                        // falls through to the default error page below.
                        if HTTPStatusText::is_sendable(response.status_code()) {
                            // A file or streaming body defers `render_metadata`
                            // past this frame, where `_keep` is the only root,
                            // so root the Response the way the async error
                            // path does or the deferred flush can read a
                            // collected weakref.
                            self.response_root.clear();
                            self.protect_for_body_and_render(response);
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
                let Some(response) = Response::from_js(&fulfilled_value) else {
                    ctx.finish_running_error_handler(value, status);
                    return;
                };

                if !HTTPStatusText::is_sendable(response.status_code()) {
                    ctx.finish_running_error_handler(value, status);
                    return;
                }

                ctx.response_root.clear();
                ctx.protect_for_body_and_render(response);
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
        if let Some(server) = self.try_server()
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
        // an async hop keep the Response rooted via `response_root`.
        let response: &mut Response = self.response_mut().unwrap();
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

        let (content_type, needs_content_type) =
            get_content_type(response.get_init_headers_mut(), blob);
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
            let server = self.server();
            let global_this = server.global_this();
            let resp = self.resp.get().expect("infallible: resp bound");
            // The status line is already written, so report the error and send the response
            // without that Set-Cookie header.
            if let Err(err) = cookies.write(global_this, uws::ResponseKind::of(resp), resp.as_ptr())
            {
                server
                    .vm()
                    .run_error_handler(global_this.take_exception(err), None);
            }
            // `cookies` drops here, releasing the ref taken in `set_cookies`.
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
        let Some(resp) = self.resp.get() else { return };
        let bytes: &[u8] = self.blob.get().slice();
        // SAFETY: FFI handle
        if !resp.try_end(bytes, bytes.len(), self.should_close_connection()) {
            self.flags.set_has_marked_pending(true);
            // SAFETY: FFI handle
            resp.on_writable(
                |this, off, resp| Self::on_writable_bytes(this, off, resp),
                self.as_ctx_ptr(),
            );
            return;
        }
        let _base_ref = self.detach_response();
        self.end_request_streaming_and_drain();
    }

    /// Replace the tracked Response. Drops the previous weak ref (if any)
    /// before taking a new one so the old Response's allocation can be
    /// freed once its own strong refs go to zero.
    fn set_response(&self, response: &WrapperGuard<'_, Response>) {
        let response = response.as_ptr();
        if self.response_weakref.with_mut(|weak| weak.get()) == NonNull::new(response) {
            return;
        }
        // SAFETY: every caller got the guard from `from_js`, so this is the pointer of the ref that the wrapper holds.
        self.response_weakref
            .set(unsafe { response::WeakRef::init_ref(response) });
    }

    fn render(&self, response: WrapperGuard<'_, Response>) {
        ctx_log!("render");
        self.forbid_upgrade();

        // A HEAD response never carries content (RFC 9110 §9.3.2). The normal
        // handler path branches to `do_render_head_response` before reaching
        // here, but the `error()` handler paths call `render()` directly.
        if self.method == Method::HEAD {
            if let Some(resp) = self.resp.get() {
                let pair = HeaderResponsePair {
                    this: self,
                    response,
                };
                resp.run_corked_with_type(Self::do_render_head_response, &pair);
            }
            return;
        }

        self.set_response(&response);

        if HTTPStatusText::is_null_body(response.status_code()) {
            self.do_render_null_body_status();
            return;
        }

        self.do_render();
    }

    /// [`Self::render`] for the Response a handler just returned. A file or
    /// streaming body is still being sent after this frame returns, so for
    /// those `response_root` roots the wrapper first; in-memory bodies leave
    /// it unrooted.
    fn protect_for_body_and_render(&self, response: WrapperGuard<'_, Response>) {
        let body_value = response.get_body_value();
        body_value.to_blob_if_possible();
        let sent_after_return = match body_value {
            Body::Value::Blob(blob) => shim::blob_needs_to_read_file(blob),
            Body::Value::Locked(_) => true,
            _ => false,
        };
        if sent_after_return {
            self.response_root
                .set_rooted(response.to_js(), self.server().global_this());
        }
        self.render(response);
    }

    pub(crate) fn on_buffered_body_chunk(this: *mut Self, chunk: &[u8], last: bool) {
        ctx_log!("onBufferedBodyChunk {} {}", chunk.len(), last);
        let pinned = RequestContextRef::pin(this);
        let this = pinned.ctx();
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

                // Body first (a tee branch after `req.clone()`), before endRequestStreaming()'s ConnectionClosed.
                if let Some(body) = this.request_body_mut() {
                    if matches!(body, Body::Value::Locked(_)) {
                        let _ = body.to_error_instance(
                            Body::ValueError::Message(BunString::static_(
                                "Request body exceeded maxRequestBodySize",
                            )),
                            global_this,
                        );
                    }
                }

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
                    // False unless `to_error_instance` above reached this same stream through the body.
                    if !bytes.has_received_last_chunk.get() {
                        let mut err = Body::ValueError::Message(BunString::static_(
                            "Request body exceeded maxRequestBodySize",
                        ));
                        bytes.on_data(WebCore::streams::Result::Err(
                            err.to_stream_error(global_this),
                        ));
                        err.reset();
                    }
                }

                this.end_with_payload_too_large();
                return;
            }

            let _exit = vm.enter_event_loop_scope();

            if !last {
                let readable_stream::Source::Bytes(bytes_ptr) = readable.ptr else {
                    return;
                };
                // BACKREF: `readable` keeps its `ByteStream` alive for this call.
                let bytes = bun_ptr::BackRef::from(
                    NonNull::new(bytes_ptr).expect("Source::Bytes payload is non-null"),
                );
                bytes.on_data(WebCore::streams::Result::Temporary(chunk));

                // What `on_data` buffered; `on_stream_drained` resumes once it empties.
                let buffered = bytes.buffered_len();
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
                let readable_stream::Source::Bytes(bytes_ptr) = readable.ptr else {
                    return;
                };
                // BACKREF: `readable` keeps its `ByteStream` alive for this call.
                let bytes = bun_ptr::BackRef::from(
                    NonNull::new(bytes_ptr).expect("Source::Bytes payload is non-null"),
                );
                let source = bytes.parent_const();
                source.producer.set(WebCore::streams::SourceHandle::None);
                bytes.on_data(WebCore::streams::Result::TemporaryAndDone(chunk));
            }

            return;
        }

        // This is the start of a task, so it's a good time to drain
        // The pooled body slot is a separate allocation decoupled from `*this`.
        if let Some(body) = this.request_body_mut() {
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
                let _ = body.to_error_instance(
                    Body::ValueError::Message(BunString::static_(
                        "Request body exceeded maxRequestBodySize",
                    )),
                    global_this,
                );

                this.end_with_payload_too_large();
                return;
            }

            if last {
                let mut bytes = this.request_body_buf.replace(Vec::new());

                let mut old = core::mem::replace(body, Body::Value::Null);

                let total = bytes.len() + chunk.len();
                // Vec aborts on OOM (repo-wide abort-on-OOM policy).
                bytes.reserve_exact(total.saturating_sub(bytes.len()));
                bytes.extend_from_slice(chunk);
                debug_assert_eq!(bytes.len(), total);
                *body = Body::Value::InternalBlob(WebCore::InternalBlob {
                    bytes,
                    was_string: false,
                });

                if matches!(old, Body::Value::Locked(_)) {
                    let _exit = vm.enter_event_loop_scope();

                    let context = this.script_context();
                    let _ =
                        Body::Value::resolve(&mut old, body, &global_this.js_thread(context), None); // TODO: properly propagate exception upwards
                }
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
        if let Some(sink) = self.sink.get() {
            // SAFETY: `sink` is owned by this context and freed in `handle_resolve_stream`/`deinit`.
            if unsafe { (*sink.as_ptr()).ended_response } {
                return None;
            }
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

    pub(crate) fn on_request_body_stream_drained(&self) {
        let this = self;
        if !this.flags.request_body_paused() {
            return;
        }
        this.flags.set_request_body_paused(false);
        if this.resp.get().is_none()
            || this.flags.aborted()
            || this.try_server().is_none_or(|s| s.terminated())
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
        if let Some(server) = self.try_server() {
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
                if let Some(body) = self.request_body_mut() {
                    let mut old = core::mem::replace(body, Body::Value::Null);
                    if let Body::Value::Locked(l) = &mut old {
                        l.on_receive_value = None;
                    }
                    let mut new_body: Body::Value = Body::Value::Null;
                    let global_this = server.global_this();
                    let _ = Body::Value::resolve(
                        &mut old,
                        &mut new_body,
                        &global_this.js_thread(server.context()),
                        None,
                    ); // TODO: properly propagate exception upwards
                    *body = new_body;
                }
            }
        }
    }

    pub(crate) fn on_request_body_readable_stream_available(
        ptr: NonNull<c_void>,
        global_this: &JSGlobalObject,
        readable: WebCore::ReadableStream,
    ) {
        // SAFETY: `ptr` is the registered live body-callback context.
        let this = unsafe { ptr.cast::<Self>().as_ref() };
        debug_assert!(!this.request_body_readable_stream_ref.with_mut(|s| s.has()));
        this.request_body_readable_stream_ref
            .set(readable_stream::Strong::init(readable, global_this));
    }

    pub(crate) fn on_start_buffering_callback(this: NonNull<c_void>) {
        // SAFETY: `this` is the registered live body-callback context.
        unsafe { this.cast::<Self>().as_ref() }.on_start_buffering();
    }

    pub(crate) fn on_start_streaming_request_body_callback(
        this: NonNull<c_void>,
    ) -> WebCore::DrainResult {
        // SAFETY: `this` is the registered live body-callback context.
        unsafe { this.cast::<Self>().as_ref() }.on_start_streaming_request_body()
    }

    pub(crate) fn get_remote_socket_info(&self) -> Option<uws::SocketAddress> {
        let resp = self.live_resp()?;
        // `AnyResponse::get_remote_socket_info` returns the uws_sys
        // variant; convert to the owned `bun_uws::SocketAddress`.
        // SAFETY: FFI handle
        let info = resp.get_remote_socket_info()?;
        Some(uws::SocketAddress {
            ip: info.ip().to_vec().into_boxed_slice(),
            port: info.port,
            is_ipv6: info.is_ipv6,
        })
    }

    pub(crate) fn set_timeout(&self, seconds: c_uint) -> bool {
        if let Some(resp) = self.live_resp() {
            // SAFETY: FFI handle
            resp.timeout(seconds.min(255) as u8);
            if seconds == 0 {
                // SAFETY: FFI handle
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

/// `RequestContext.bind.ts` has one set of reactions for each instantiation.
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
    use crate::generated_bindgen::request_context::*;
    match (ssl, debug, mux) {
        (false, false, false) => (
            Bun__HTTPRequestContext__onResolve,
            Bun__HTTPRequestContext__onReject,
            Bun__HTTPRequestContext__onResolveStream,
            Bun__HTTPRequestContext__onRejectStream,
        ),
        (true, false, false) => (
            Bun__HTTPRequestContextTLS__onResolve,
            Bun__HTTPRequestContextTLS__onReject,
            Bun__HTTPRequestContextTLS__onResolveStream,
            Bun__HTTPRequestContextTLS__onRejectStream,
        ),
        (false, true, false) => (
            Bun__HTTPRequestContextDebug__onResolve,
            Bun__HTTPRequestContextDebug__onReject,
            Bun__HTTPRequestContextDebug__onResolveStream,
            Bun__HTTPRequestContextDebug__onRejectStream,
        ),
        (true, true, false) => (
            Bun__HTTPRequestContextDebugTLS__onResolve,
            Bun__HTTPRequestContextDebugTLS__onReject,
            Bun__HTTPRequestContextDebugTLS__onResolveStream,
            Bun__HTTPRequestContextDebugTLS__onRejectStream,
        ),
        (false, false, true) => (
            Bun__HTTPRequestContextMux__onResolve,
            Bun__HTTPRequestContextMux__onReject,
            Bun__HTTPRequestContextMux__onResolveStream,
            Bun__HTTPRequestContextMux__onRejectStream,
        ),
        (true, false, true) => (
            Bun__HTTPRequestContextMuxTLS__onResolve,
            Bun__HTTPRequestContextMuxTLS__onReject,
            Bun__HTTPRequestContextMuxTLS__onResolveStream,
            Bun__HTTPRequestContextMuxTLS__onRejectStream,
        ),
        (false, true, true) => (
            Bun__HTTPRequestContextDebugMux__onResolve,
            Bun__HTTPRequestContextDebugMux__onReject,
            Bun__HTTPRequestContextDebugMux__onResolveStream,
            Bun__HTTPRequestContextDebugMux__onRejectStream,
        ),
        (true, true, true) => (
            Bun__HTTPRequestContextDebugMuxTLS__onResolve,
            Bun__HTTPRequestContextDebugMuxTLS__onReject,
            Bun__HTTPRequestContextDebugMuxTLS__onResolveStream,
            Bun__HTTPRequestContextDebugMuxTLS__onRejectStream,
        ),
    }
}

struct StreamPair<'a, ThisServer, const SSL: bool, const DBG: bool, const MUX: bool>
where
    ThisServer: ServerLike + 'static,
{
    pub this: &'a RequestContext<ThisServer, SSL, DBG, MUX>,
    pub stream: WebCore::ReadableStream,
}

struct HeaderResponsePair<'a, ThisServer, const SSL: bool, const DBG: bool, const MUX: bool>
where
    ThisServer: ServerLike + 'static,
{
    pub this: &'a RequestContext<ThisServer, SSL, DBG, MUX>,
    pub(crate) response: WrapperGuard<'a, Response>,
}

struct PathnameFormatter<'a, ThisServer, const SSL: bool, const DBG: bool, const MUX: bool>
where
    ThisServer: ServerLike + 'static,
{
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
                // Inlined `req_url` body to avoid carrying the
                // `Transport`/`NativePromiseContextType` bounds onto this
                // formatter impl.
                // SAFETY: req is the live uWS request handle.
                let url: &[u8] = unsafe {
                    if MUX {
                        (*req.cast::<bun_uws_sys::h3::Request>()).url()
                    } else {
                        (*req.cast::<bun_uws_sys::Request>()).url()
                    }
                };
                return write!(writer, "{}", bstr::BStr::new(url));
            }
        }

        writer.write_str("/")
    }
}

// Retained only for `renderMetadata` to compute Content-Range / Content-Length
// for file-blob bodies; the actual fd/socket bookkeeping lives in
// `FileResponseStream` now.
#[derive(Default, Clone, Copy)]
pub(crate) struct SendfileContext {
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
pub(crate) struct Flags<const DEBUG_MODE: bool>(Cell<FlagsBits>);

macro_rules! flag_accessor {
    ($get:ident, $set:ident, $bit:ident) => {
        #[inline]
        pub(crate) fn $get(&self) -> bool {
            self.0.get().contains(FlagsBits::$bit)
        }
        #[inline]
        pub(crate) fn $set(&self, v: bool) {
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

fn get_content_type(headers: Option<&mut FetchHeaders>, blob: &AnyBlob) -> (MimeType, bool) {
    let mut needs_content_type = true;

    let content_type: MimeType = 'brk: {
        if let Some(headers_) = headers {
            if let Some(content) = headers_.fast_get(jsc::HTTPHeaderName::ContentType) {
                needs_content_type = false;

                break 'brk MimeType::init(content.to_utf8().slice());
            }
        }

        if !blob.content_type().is_empty() {
            MimeType::init(blob.content_type())
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

    (content_type, needs_content_type)
}

// `ServerLike` lives in `crate::server` (mod.rs) and is impl'd for the four
// `NewServer` monomorphizations.

static WELCOME_PAGE_HTML_GZ: &[u8] = include_bytes!("../api/welcome-page.html.gz");
