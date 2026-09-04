use core::cell::Cell;
use core::ffi::{c_uint, c_void};
use core::ptr::NonNull;

use bun_sys::FdExt as _;

use bun_core::String as BunString;
use bun_http_types::Method::Method;
use bun_jsc::JsCell;
use bun_uws::{self as uws, WebSocketUpgradeContext};

use bun_ptr::ThisPtr;

use crate::server::jsc::{self, JSGlobalObject, JSValue, JsResult};
use crate::server::{RangeRequest, ServerLike, StaticRoute, html_bundle};
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
pub type Req<const SSL_ENABLED: bool, const MUX: bool> = c_void;

/// Back-reference to a stack-local "should this RequestContext defer its
/// deinit until the JS callback returns" flag. The dispatching frame owns the
/// `Cell<bool>`; `RequestContext` stores a `BackRef` to it (cleared before the
/// frame unwinds), so reads/writes are safe `Cell` ops — no raw `*mut bool`.
pub type DeferDeinitFlag = bun_ptr::BackRef<core::cell::Cell<bool>>;

pub(crate) type ResponseStream<const SSL_ENABLED: bool> =
    crate::webcore::streams::HTTPServerWritable<SSL_ENABLED>;
type ResponseStreamJSSink<const SSL_ENABLED: bool> =
    crate::webcore::streams::HTTPServerWritableJSSink<SSL_ENABLED>;

/// This pre-allocates up to 2,048 RequestContext structs.
/// It costs about 655,632 bytes.
// Capacity 0 when heap-breakdown is enabled routes every allocation through
// the fallback heap path so the per-type malloc zones can attribute them.
const REQUEST_CONTEXT_POOL_CAPACITY: usize = if bun_alloc::heap_breakdown::ENABLED {
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

/// `align(16)`: `NativePromiseContext`'s deferred-deref task packs a 4-bit
/// type tag into the low bits of a pointer to this.
#[repr(align(16))]
pub struct RequestContext<
    ThisServer,
    const SSL_ENABLED: bool,
    const DEBUG_MODE: bool,
    const MUX: bool,
> {
    /// BACKREF to the embedding `Server` — the server owns this request
    /// context (allocated from its `HiveArray` pool) and outlives it, so the
    /// pointee is live for the holder's entire lifetime. `None` once detached.
    pub(crate) server: Cell<Option<bun_ptr::BackRef<ThisServer, bun_ptr::Mut>>>,
    pub(crate) resp: Cell<Option<uws::AnyResponse>>,
    pub(crate) req: Cell<Option<*mut Req<SSL_ENABLED, MUX>>>,
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
    root: Cell<*mut Self>,
    pub(crate) ref_count: Cell<u8>,
    pub(crate) pin_count: Cell<u8>,

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

    pub sink: Cell<Option<NonNull<ResponseStreamJSSink<SSL_ENABLED>>>>,
    pub(crate) byte_stream: Cell<Option<NonNull<ByteStream>>>,
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
        // The Sink and ByteStream aren't owned by this.
        core::mem::size_of::<Self>()
            + self.request_body_buf.get().capacity()
            + self.response_buf_owned.get().capacity()
            + self.blob.get().memory_cost()
    }

    #[inline]
    pub(crate) fn is_async(&self) -> bool {
        self.defer_deinit_until_callback_completes.get().is_none()
    }

    pub(crate) fn dev_server(&self) -> Option<&crate::bake::DevServer::DevServer> {
        let server = self.server.get()?;
        // SAFETY: BACKREF — the server outlives every context it allocates.
        unsafe { &*server.as_ptr() }.dev_server()
    }
}

// ─── per-request state machine bodies ────────────────────────────────────────
// Everything below until the helper structs at the bottom is the request
// state machine: render(), on_abort(), on_resolve(), do_render_*, sendfile,
// stream handling, error handling.
use bun_collections::VecExt;
use bun_core::Output;
use bun_core::strings;
use bun_http_types as HTTP;
use bun_http_types::MimeType::MimeType;
use bun_paths::PathBuffer;
use std::io::Write as _;
#[allow(non_snake_case)]
mod NativePromiseContext {
    use super::{JSGlobalObject, JSValue};
    use crate::api::native_promise_context as npc;
    use core::ptr::NonNull;
    pub(super) use npc::NativePromiseContextType;

    #[inline]
    pub(super) fn create<T: NativePromiseContextType>(
        global: &JSGlobalObject,
        ctx: *mut T,
    ) -> JSValue {
        npc::create(global, ctx, JSValue::ZERO)
    }
    #[inline]
    pub(super) fn take<T>(cell: JSValue) -> Option<NonNull<T>> {
        npc::take::<T>(cell)
    }
}
use crate::node::types::PathLikeExt as _;
use crate::server::jsc::CallFrame;
use crate::server::{AnyRequestContext, FileResponseStream, HTTPStatusText, file_response_stream};
use crate::webcore::blob::BlobExt as _;
use crate::webcore::{Blob, ReadableStream, body as Body, s3 as S3};
use bun_jsc::SysErrorJsc as _;

/// RAII: releases one intrusive ref on a [`RequestContext`] at scope exit.
///
/// Every callback entry that can reach a `deref()` (uWS handlers, promise
/// reactions, task callbacks) constructs one of these from its raw entry
/// pointer as the first statement: the guard's ref keeps the pooled context
/// alive for the whole frame even if the body drops the base ref, and the
/// actual pool release happens here at drop.
struct RequestContextRef<ThisServer, const SSL: bool, const DBG: bool, const MUX: bool>
where
    ThisServer: ServerLike + 'static,
{
    ctx: *mut RequestContext<ThisServer, SSL, DBG, MUX>,
    is_pin: bool,
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
        unsafe {
            (*this).ref_();
            (*this).pin_count.set((*this).pin_count.get() + 1);
        }
        Self {
            ctx: this,
            is_pin: true,
        }
    }

    #[inline]
    fn adopt(this: *mut RequestContext<ThisServer, SSL, DBG, MUX>) -> Self {
        Self {
            ctx: this,
            is_pin: false,
        }
    }

    #[inline]
    fn ctx(&self) -> &RequestContext<ThisServer, SSL, DBG, MUX> {
        // SAFETY: this guard owns a ref, so `*self.ctx` is live for `&self`.
        unsafe { &*self.ctx }
    }
}

impl<ThisServer, const SSL: bool, const DBG: bool, const MUX: bool> Drop
    for RequestContextRef<ThisServer, SSL, DBG, MUX>
where
    ThisServer: ServerLike + 'static,
{
    #[inline]
    fn drop(&mut self) {
        // SAFETY: pointer was live when wrapped (this guard owns one ref) and
        // `deref()` itself handles the pool release when count hits zero.
        unsafe {
            if self.is_pin {
                (*self.ctx).pin_count.set((*self.ctx).pin_count.get() - 1);
            }
            (*self.ctx).deref()
        };
    }
}

// `Response` doesn't yet implement `JsClass` (codegen-gated). Route the
// downcast through the codegen stub so the call sites type-check; the stub
// returns `None` until codegen lands.
//
/// The C++-owned cell pointer for `value`, or `None` if it is not a `Response`.
///
/// Returns a raw pointer rather than `&mut Response` so it keeps the wrapper
/// allocation's provenance: `RequestContext::set_response` stores it in a
/// `WeakPtr<Response>`, which outlives any reborrow and is read again after
/// the Response has been written through other pointers.
///
/// Callers must keep `value` GC-rooted (ensure_still_alive / protect()) for as
/// long as they use the pointer, so the JSC-owned allocation outlives it, and
/// must not form two overlapping `&mut Response` from it.
#[inline]
fn as_response(value: JSValue) -> Option<*mut Response> {
    response::from_js(value).map(|p| p.cast::<Response>())
}

/// A bare `HTMLBundle` means `new Response(htmlBundle)`.
fn wrap_html_bundle(global_this: &JSGlobalObject, value: JSValue) -> JSValue {
    let Some(html_bundle) = value.as_class_this_ptr::<crate::server::HTMLBundle>() else {
        return value;
    };
    let response = bun_core::heap::into_raw(Box::new(Response::init(
        response::Init {
            status_code: 200,
            status_text: BunString::create_atom(b"OK"),
            ..Default::default()
        },
        WebCore::Body::new(Body::Value::HTMLBundle(bun_ptr::RefPtr::from_this(
            html_bundle,
        ))),
        BunString::EMPTY,
        false,
    )));
    // SAFETY: a fresh heap `Response`; the wrapper takes ownership.
    Response::make_maybe_pooled(global_this, response)
}

/// Release the body's hold on a stream the sink is done with, and mark a
/// `Locked` body used. Non-generic and out of line: the eight `RequestContext`
/// monomorphizations share one copy.
#[inline(never)]
fn release_body_stream(response: &mut Response, global_this: &JSGlobalObject) {
    if let Some(stream) = response.get_body_readable_stream() {
        stream.value.ensure_still_alive();
        response.detach_readable_stream(global_this);
        stream.done();
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

/// Per-monomorphization C-ABI shim table for the four promise-reaction host
/// fns. The value passed to `then_with_value` must be identical to the
/// `Bun__HTTPRequestContext*__on*` symbol that C++'s
/// `GlobalObject::promiseHandlerID` compares against.
///
/// The `#[no_mangle]` exports cannot live on a generic fn, so they are
/// emitted as concrete wrappers by `request_ctx_exports!` below. The trait
/// impls — also emitted by that macro — point at those *exported* wrappers
/// (not the inner generic shims), so `Self::ON_RESOLVE` and the C++ side agree
/// on the function-pointer identity and `promiseHandlerID` resolves.
///
/// NOTE (layering): expressed as a trait (not inherent consts) so
/// downstream `where`-clauses that already name it keep type-checking.
pub trait RequestContextHostFns {
    const ON_RESOLVE: bun_jsc::JSHostFn;
    const ON_REJECT: bun_jsc::JSHostFn;
    const ON_RESOLVE_STREAM: bun_jsc::JSHostFn;
    const ON_REJECT_STREAM: bun_jsc::JSHostFn;
}

// Plain safe Rust helpers — only ever called Rust→Rust by the `#[no_mangle]`
// ABI wrappers in `request_ctx_exports!`, so they need no `extern` ABI and
// have no caller preconditions (bodies use safe `opaque_deref`). The wrappers
// carry `#[bun_jsc::host_call]` for the C++-visible symbol.
fn host_on_resolve<ThisServer, const SSL: bool, const DBG: bool, const MUX: bool>(
    g: *mut JSGlobalObject,
    f: *mut CallFrame,
) -> JSValue
where
    ThisServer: ServerLike + 'static,
{
    // S008: `JSGlobalObject`/`CallFrame` are `opaque_ffi!` ZST handles —
    // safe `*mut → &` via `opaque_deref` (JSC guarantees non-null/live).
    let (g, f) = (bun_opaque::opaque_deref(g), bun_opaque::opaque_deref(f));
    bun_jsc::to_js_host_fn_result(
        g,
        RequestContext::<ThisServer, SSL, DBG, MUX>::on_resolve(g, f),
    )
}
fn host_on_reject<ThisServer, const SSL: bool, const DBG: bool, const MUX: bool>(
    g: *mut JSGlobalObject,
    f: *mut CallFrame,
) -> JSValue
where
    ThisServer: ServerLike + 'static,
{
    // S008: `JSGlobalObject`/`CallFrame` are `opaque_ffi!` ZST handles —
    // safe `*mut → &` via `opaque_deref` (JSC guarantees non-null/live).
    let (g, f) = (bun_opaque::opaque_deref(g), bun_opaque::opaque_deref(f));
    bun_jsc::to_js_host_fn_result(
        g,
        RequestContext::<ThisServer, SSL, DBG, MUX>::on_reject(g, f),
    )
}
fn host_on_resolve_stream<ThisServer, const SSL: bool, const DBG: bool, const MUX: bool>(
    g: *mut JSGlobalObject,
    f: *mut CallFrame,
) -> JSValue
where
    ThisServer: ServerLike + 'static,
{
    // S008: `JSGlobalObject`/`CallFrame` are `opaque_ffi!` ZST handles —
    // safe `*mut → &` via `opaque_deref` (JSC guarantees non-null/live).
    let (g, f) = (bun_opaque::opaque_deref(g), bun_opaque::opaque_deref(f));
    bun_jsc::to_js_host_fn_result(
        g,
        RequestContext::<ThisServer, SSL, DBG, MUX>::on_resolve_stream(g, f),
    )
}
fn host_on_reject_stream<ThisServer, const SSL: bool, const DBG: bool, const MUX: bool>(
    g: *mut JSGlobalObject,
    f: *mut CallFrame,
) -> JSValue
where
    ThisServer: ServerLike + 'static,
{
    // S008: `JSGlobalObject`/`CallFrame` are `opaque_ffi!` ZST handles —
    // safe `*mut → &` via `opaque_deref` (JSC guarantees non-null/live).
    let (g, f) = (bun_opaque::opaque_deref(g), bun_opaque::opaque_deref(f));
    bun_jsc::to_js_host_fn_result(
        g,
        RequestContext::<ThisServer, SSL, DBG, MUX>::on_reject_stream(g, f),
    )
}

impl<ThisServer, const SSL: bool, const DBG: bool, const MUX: bool> RequestContextHostFns
    for RequestContext<ThisServer, SSL, DBG, MUX>
where
    ThisServer: ServerLike + 'static,
{
    // These consts must resolve to the *exported* `#[no_mangle]` symbols
    // (`Bun__HTTPRequestContext*__on*`), not the inner generic
    // `host_on_*::<..>` shims: the function-pointer value is what C++'s
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
    /// Reborrow the owning server. `server` is a BACKREF (LIFETIMES.tsv): set
    /// at construction in `init()` from the `NewServer` that owns the request
    /// pool, never null while the `RequestContext` is live, and the server
    /// outlives every `RequestContext` it allocates. Centralises the
    /// per-call-site backref deref behind the `bun_ptr::BackRef` field.
    ///
    /// Returned lifetime is **decoupled** from `&self` (unbounded `'r`): the
    /// server is not a sub-field of `RequestContext` (it owns the pool the
    /// context lives in), so callers may hold `&ThisServer` past calls that
    /// end or recycle this context.
    #[inline]
    pub(crate) fn server<'r>(&self) -> &'r ThisServer {
        // SAFETY: BACKREF — `server` is `Some(non-null)` after `init()` and
        // the pointee `NewServer` outlives this context (it owns the pool).
        // `'r` may exceed `&self` because the server is not borrowed from
        // `*self`; it lives independently and outlives every context.
        unsafe {
            &*self
                .server
                .get()
                .expect("infallible: server bound")
                .as_ptr()
        }
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

    /// Exclusive borrow of the heap [`ResponseStreamJSSink`] this context owns.
    ///
    /// Returns an unbounded `&'r mut` because the sink is a separate heap
    /// allocation (`heap::alloc` in [`do_render_stream`]), **not** a sub-field
    /// of `*self` (same pattern as [`request_body_mut`]).
    ///
    /// # Safety (encapsulated)
    /// While `Some`, `sink` points to the JSSink allocated by
    /// `do_render_stream`; this `RequestContext` is its sole owner until
    /// [`destroy_sink`] consumes it. Single-threaded — no other `&mut` alias.
    #[inline]
    #[allow(
        clippy::mut_from_ref,
        reason = "the sink is a separate heap allocation owned by this ctx, not a field of *self"
    )]
    fn sink_mut(&self) -> Option<&mut ResponseStreamJSSink<SSL_ENABLED>> {
        // SAFETY: see fn doc — heap JSSink owned by this ctx, sole live
        // mutable view, single-threaded.
        self.sink.get().map(|p| unsafe { &mut *p.as_ptr() })
    }

    ///
    #[inline]
    fn response_mut<'r>(&self) -> Option<&'r mut Response> {
        let ptr = self
            .response_weakref
            .with_mut(|w| w.get().map(std::ptr::from_mut::<Response>));
        // SAFETY: weak handle just reported the allocation live; the pointee
        // is disjoint from `*self`.
        ptr.map(|p| unsafe { &mut *p })
    }

    #[inline]
    fn request_mut<'r>(&self) -> Option<&'r mut Request> {
        let ptr = self
            .request_weakref
            .with_mut(|w| w.get().map(std::ptr::from_mut::<Request>));
        // SAFETY: weak handle just reported the allocation live; the pointee
        // is disjoint from `*self`.
        ptr.map(|p| unsafe { &mut *p })
    }

    /// Take the pooled request-body slot out of `self`; the handle's `Drop`
    /// releases the `+1`.
    #[inline]
    fn request_body_take_unref(&self) {
        drop(self.request_body.replace(None));
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
            if let (Some(req), Some(request)) = (self.req.get(), self.request_mut()) {
                self.to_async_without_abort_handler(req, request);
            }
            Self::on_abort(self.as_ctx_ptr(), resp);
            return;
        }
        // SAFETY: FFI handle valid while resp is Some
        resp.on_aborted(|this, resp| Self::on_abort(this, resp), self.as_ctx_ptr());
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
        let Some(ctx) = NativePromiseContext::take::<Self>(arguments[1]) else {
            // A termination path (abort, end, upgrade) reclaimed the cell's
            // claim; the context may already be gone.
            Self::discard_response_body(global, arguments[0]);
            return Ok(JSValue::UNDEFINED);
        };
        let ctx = RequestContextRef::adopt(ctx.as_ptr());
        ctx.ctx().promise_cell.set(JSValue::ZERO);

        let result = arguments[0];
        result.ensure_still_alive();

        ctx.ctx().handle_resolve(global, result);
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
        // The `RequestContextRef` guard taken in `on_resolve` keeps the
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

        let value = wrap_html_bundle(global_this, value);
        let Some(response) = as_response(value) else {
            self.render_missing_invalid_response(value);
            return;
        };
        // SAFETY: `response` is the live cell pointer; `value` is rooted by the
        // caller's frame and protect()'d below.
        if self.reject_unsendable_response(unsafe { (*response).status_code() }) {
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
                let mut pair = HeaderResponsePair {
                    this: self,
                    response,
                };
                resp.run_corked_with_type(Self::do_render_head_response, &raw mut pair);
            }
            return;
        }

        // SAFETY: `response` is the live, protect()'d cell pointer.
        unsafe { self.render(response) };
    }

    #[inline]
    fn unpinned_ref_count(&self) -> u8 {
        self.ref_count.get() - self.pin_count.get()
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
        if let Some(body) = self.request_body.get() {
            if matches!(&**body, Body::Value::Locked(_)) {
                return false;
            }
        }

        true
    }

    /// destroy RequestContext, should be only called by deref or if defer_deinit_until_callback_completes is ref is set to true
    pub(crate) fn deinit(&self) {
        ctx_log!("deinit");
        self.detach_response();
        self.end_request_streaming_and_drain();
        // TODO: has_marked_complete is doing something?
        self.flags.set_has_marked_complete(true);

        if let Some(defer_deinit) = self.defer_deinit_until_callback_completes.get() {
            defer_deinit.set(true);
            ctx_log!("deferred deinit <d> ({:p})<r>", self);
            return;
        }

        ctx_log!("deinit<d> ({:p})<r>", self);
        debug_assert!(self.flags.has_finalized());

        // A response body stream suspended inside its `pull()` never settles the promise
        // whose reactions consume the sink (`handleResolveStream` / `handleRejectStream`),
        // so a client abort in that state reaches deinit with the sink still owned here.
        // This is the owner's last exit: release it exactly like the settle paths do.
        if let Some(wrapper_ptr) = self.sink.take() {
            // SAFETY: deinit runs once, after `detach_response()` removed the uWS callbacks;
            // the context is the sink's sole owner (see the `sink` field's doc comment).
            let wrapper = unsafe { &mut *wrapper_ptr.as_ptr() };
            wrapper.sink.finalize();
            if let Some(sink_global) = wrapper.sink.global_this {
                ResponseStreamJSSink::<SSL_ENABLED>::detach(&mut wrapper.sink.source, &sink_global);
            }
            Self::destroy_sink(wrapper_ptr);
        }

        self.request_body_buf.set(Vec::new());
        self.response_buf_owned.set(Vec::new());
        self.response_weakref.set(response::WeakRef::EMPTY);

        self.request_body_take_unref();

        if let Some(cb) = self.additional_on_abort.replace(None) {
            cb.deref();
        }

        if let Some(server) = self.server.take() {
            server.release_request_context(self.as_ctx_ptr().cast::<c_void>(), MUX);
            // SAFETY: `&mut` through the backref — the server outlives this
            // context and no other borrow of it is live here.
            unsafe { (*server.as_ptr()).on_request_complete() };
        }
    }

    pub fn deref(&self) {
        let ref_count = self.ref_count.get();
        stream_log!("deref {} -> {}", ref_count, ref_count - 1);
        debug_assert!(ref_count > 0);
        self.ref_count.set(ref_count - 1);
        if ref_count == 1 {
            self.finalize_without_deinit();
            self.deinit();
        }
    }

    pub fn ref_(&self) {
        let ref_count = self.ref_count.get();
        stream_log!("ref {} -> {}", ref_count, ref_count + 1);
        self.ref_count.set(ref_count + 1);
    }

    /// Takes one ref as the cell's claim on this context and remembers the
    /// cell in `promise_cell`. The settle reactions (`take()` + a field
    /// clear), `on_abort`, or the cell's destructor release the claim.
    fn create_promise_cell(&self, global: &JSGlobalObject) -> JSValue {
        debug_assert!(self.promise_cell.get().is_empty());
        self.ref_();
        let cell = NativePromiseContext::create(global, self.as_ctx_ptr());
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
        if !cell.is_empty() && NativePromiseContext::take::<Self>(cell).is_some() {
            self.deref();
        }
    }

    pub(crate) fn on_reject(_global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        ctx_log!("onReject");

        let arguments = callframe.arguments_as_array::<2>();
        let Some(ctx) = NativePromiseContext::take::<Self>(arguments[1]) else {
            // A termination path (abort, end, upgrade) reclaimed the cell's
            // claim; the context may already be gone.
            return Ok(JSValue::UNDEFINED);
        };
        let ctx = RequestContextRef::adopt(ctx.as_ptr());
        ctx.ctx().promise_cell.set(JSValue::ZERO);

        let err = arguments[0];
        // Pass the rejection reason through verbatim (including `null` and
        // `undefined`) so `error()` sees the same value the already-settled
        // path delivers. Only an empty JSValue is normalized.
        ctx.ctx().handle_reject(if err.is_empty() {
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
        // SAFETY: FFI handle, just checked Some
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
                self.deinit();
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

    pub(crate) fn render_missing(&self) {
        if let Some(resp) = self.resp.get() {
            resp.run_corked_with_type(|ctx| Self::render_missing_corked(ctx), self.as_ctx_ptr());
        }
    }

    fn render_missing_corked(ctx: *mut Self) {
        // SAFETY: `ctx` is the live `RequestContext` threaded through the
        // synchronous cork call; only a shared view is formed.
        let ctx = unsafe { &*ctx };
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
            self.deref();
            return;
        }

        self.flags.set_has_marked_pending(true);
        self.response_buf_owned.set(bb);

        if let Some(resp) = self.resp.get() {
            // SAFETY: FFI handle
            resp.on_writable(
                |this, off, resp| Self::on_writable_complete_response_buffer(this, off, resp),
                self.as_ctx_ptr(),
            );
        }
    }

    fn drain_response_buffer_and_metadata_corked(this: *mut Self) {
        // SAFETY: this is the live RequestContext threaded through cork user-data.
        unsafe { (*this).drain_response_buffer_and_metadata() };
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
            self.detach_response();
            self.reclaim_promise_cell();
            // SAFETY: FFI handle
            resp.end(data, close_connection);
            // end_request_streaming_and_drain() must run after the last
            // `resp` access: its drain_microtasks() can re-enter lsquic (H3)
            // and free the stream out from under the local `resp` copy.
            self.end_request_streaming_and_drain();
            self.deref();
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
            self.deref();
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
            self.deref();
        }
    }

    pub(crate) fn end_without_body(&self, close_connection: bool) {
        ctx_log!("endWithoutBody");
        if let Some(resp) = self.resp.get() {
            self.detach_response();
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
            self.deref();
        }
    }

    pub(crate) fn force_close(&self) {
        if let Some(resp) = self.resp.get() {
            self.detach_response();
            self.reclaim_promise_cell();
            // SAFETY: FFI handle
            resp.force_close();
            // end_request_streaming_and_drain() must run after the last
            // `resp` access: its drain_microtasks() can re-enter lsquic (H3)
            // and free the stream out from under the local `resp` copy.
            self.end_request_streaming_and_drain();
            self.deref();
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
        server: *mut ThisServer,
        req: *mut Req<SSL_ENABLED, MUX>,
        resp: uws::AnyResponse,
        should_deinit_context: Option<DeferDeinitFlag>,
        method: Option<Method>,
    ) {
        let resolved_method = method
            .or_else(|| Method::which(Self::req_method(req)))
            .unwrap_or(Method::GET);
        let slot: *mut Self = this.as_mut_ptr();
        // SAFETY: writing to MaybeUninit slot
        unsafe {
            slot.write(Self {
                root: Cell::new(slot),
                resp: Cell::new(Some(resp)),
                req: Cell::new(Some(req)),
                method: resolved_method,
                server: Cell::new(
                    NonNull::new(server).map(|p| bun_ptr::BackRef::from_raw_mut(p.as_ptr())),
                ),
                defer_deinit_until_callback_completes: Cell::new(should_deinit_context),
                range: RangeRequest::raw_from_request(&Self::any_request(req)),
                request_weakref: JsCell::new(request::WeakRef::EMPTY),
                signal: Cell::new(None),
                cookies: JsCell::new(None),
                flags: Flags::<DEBUG_MODE>::default(),
                upgrade_context: Cell::new(UpgradeState::None),
                response_jsvalue: Cell::new(JSValue::ZERO),
                ref_count: Cell::new(1),
                pin_count: Cell::new(0),
                response_weakref: JsCell::new(response::WeakRef::EMPTY),
                blob: JsCell::new(AnyBlob::Blob(Blob::default())),
                sendfile: Cell::new(SendfileContext::default()),
                request_body_readable_stream_ref: JsCell::new(readable_stream::Strong::default()),
                request_body: JsCell::new(None),
                request_body_buf: JsCell::new(Vec::new()),
                request_body_content_len: Cell::new(0),
                request_body_streamed_len: Cell::new(0),
                sink: Cell::new(None),
                byte_stream: Cell::new(None),
                response_body_readable_stream_ref: JsCell::new(readable_stream::Strong::default()),
                pathname: JsCell::new(BunString::EMPTY),
                response_buf_owned: JsCell::new(Vec::new()),
                additional_on_abort: JsCell::new(None),
                promise_cell: Cell::new(JSValue::ZERO),
            });
        }

        ctx_log!("create<d> ({:p})<r>", this.as_ptr());
    }

    fn on_abort(this: *mut Self, resp: uws::AnyResponse) {
        ctx_log!("onAbort");
        let pinned = RequestContextRef::pin(this);
        let this = pinned.ctx();
        debug_assert!(this.resp.get().is_some());
        // An HTTP/2 or HTTP/3 stream is destroyed once both sides finish,
        // so this also fires after a successful end(). HTTP/1 sockets persist
        // for keep-alive, so the equivalent never happens there. Drop the
        // pointer; everything else cleans up via the resolve/reject path.
        if MUX {
            // SAFETY: FFI handle
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
        // drains below and in the release of `_ref`.
        let _entered = vm.enter_event_loop_scope_without_checkpoint();
        let _ref = RequestContextRef::adopt(this.as_ctx_ptr());
        // This is a task in the event loop.
        // If we called into JavaScript, we must drain the microtask queue.
        scopeguard::defer! {
            if any_js_calls.get() {
                vm.as_mut().drain_microtasks();
            }
        }

        if let Some(request) = this.request_mut() {
            request.request_context = AnyRequestContext::NULL;
            this.request_weakref.set(request::WeakRef::EMPTY);
        }
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
        if let Some(sink_ptr) = this.sink.get() {
            // The sink abort runs the stream's JS onClose through its signal.
            any_js_calls.set(true);
            // SAFETY: `sink_ptr` is the live JSSink allocated by do_render_stream
            // (repr(transparent) over the sink). `abort` takes the raw pointer
            // because the teardown it can re-enter frees the sink.
            unsafe {
                ResponseStream::<SSL_ENABLED>::abort(
                    sink_ptr.as_ptr().cast::<ResponseStream<SSL_ENABLED>>(),
                );
            }
            // End request streaming here, not in deinit: a `Used` body
            // (textStream) can only be rejected through
            // request_body_readable_stream_ref, and finalize_without_deinit
            // drops that ref without erroring it. any_js_calls is already set.
            let _ = this.end_request_streaming();
            this.reclaim_promise_cell();
            return;
        }

        // A natively piped body has nobody left to take it. The deref balances the ref
        // `do_render_with_body` took for the pipe: `end_chunk`, which releases it otherwise,
        // cannot run once the response is gone.
        if let Some(stream) = this.byte_stream.take() {
            shim::byte_stream_unpipe(stream);
            this.deref();
        }

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

        // A stream pump that settles after this point finds no context
        // (`reclaim_promise_cell`), so its `handle_*_stream` cleanup never
        // runs: release the body's hold on the stream here.
        if let Some(resp) = self.response_mut() {
            release_body_stream(resp, global_this);
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

        if let Some(request) = self.request_mut() {
            request.request_context = AnyRequestContext::NULL;
            self.request_weakref.set(request::WeakRef::EMPTY);
        }

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

    fn on_file_stream_complete(ctx: *mut c_void, _resp: uws::AnyResponse) {
        let pinned = RequestContextRef::pin(ctx.cast::<Self>());
        let this = pinned.ctx();
        this.detach_response();
        this.end_request_streaming_and_drain();
        this.deref();
    }

    fn on_file_stream_abort(ctx: *mut c_void, resp: uws::AnyResponse) {
        // Route through the real onAbort so flags.aborted, request.signal,
        // and additional_on_abort fire exactly as they did pre-consolidation.
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
        if let Some(wrapper) = this.sink_mut() {
            return wrapper.sink.on_writable(write_offset, _resp);
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

        // SAFETY: `this.blob`'s backing bytes are owned by the (pinned)
        // context and outlive `send_writable_bytes_for_blob`; the cell borrow
        // ends here.
        let bytes: &[u8] = unsafe { bun_ptr::detach_lifetime(this.blob.get().slice()) };

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
            self.detach_response();
            self.end_request_streaming_and_drain();
            self.deref();
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
            self.detach_response();
            self.end_request_streaming_and_drain();
            self.deref();
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
                    self.detach_response();
                    resp.end(b"", close);
                    self.end_request_streaming_and_drain();
                    self.deref();
                    return;
                }
            }
        }

        resp.run_corked_with_type(Self::render_metadata_corked, self.as_ctx_ptr());

        let sendfile = self.sendfile.get();
        if (is_regular && sendfile.remain == 0) || !self.method.has_body() {
            if auto_close {
                fd.close();
            }
            // SAFETY: FFI handle
            let close = resp.should_close_connection();
            self.detach_response();
            // SAFETY: FFI handle
            resp.end(b"", close);
            self.end_request_streaming_and_drain();
            self.deref();
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
            owner: file_response_stream::StreamOwner::Ctx {
                ctx: self.as_ctx_ptr().cast::<c_void>(),
                on_complete: Self::on_file_stream_complete,
                on_abort: Some(Self::on_file_stream_abort),
                on_error: Self::on_file_stream_error,
            },
        });
    }

    fn do_render_with_body_locked(this: NonNull<c_void>, value: &mut Body::Value) {
        // Consumes the +1 taken at the `on_receive_value` registration site.
        let pinned = RequestContextRef::adopt(this.cast::<Self>().as_ptr());
        pinned
            .ctx()
            .do_render_with_body(std::ptr::from_mut(value), None);
    }

    fn render_html_bundle(&self, route: &bun_ptr::RefPtr<html_bundle::Route>) {
        if !self.flags.response_protected() {
            self.response_jsvalue.get().protect();
            self.flags.set_response_protected(true);
        }
        let any_ctx = AnyRequestContext::init(self.as_ctx_ptr());
        if self.server().config().is_development() {
            if let Some(dev) = any_ctx.dev_server_mut() {
                let resp = self.resp.get().expect("infallible: not aborted or ended");
                // `on_html_bundle_built` consumes this +1.
                self.ref_();
                self.flags.set_has_marked_pending(true);
                // SAFETY: the server boxes the dev server and outlives this
                // context; no other `&mut` to it is live here.
                bun_core::handle_oom(unsafe { &mut *dev }.respond_for_html_bundle_body(
                    route.this_ptr(),
                    any_ctx,
                    resp,
                ));
                return;
            }
        }
        match html_bundle::Route::built_html_or_schedule(route.this_ptr()) {
            Some(built) => self.render_built_html_bundle(built.map_err(|()| &*route.bundle.path)),
            None => {
                // `on_html_route_built` consumes this +1.
                self.ref_();
                self.flags.set_has_marked_pending(true);
                html_bundle::Route::add_build_waiter(
                    route.this_ptr(),
                    Self::on_html_route_built,
                    NonNull::new(self.as_ctx_ptr().cast::<c_void>()).unwrap(),
                );
            }
        }
    }

    /// `html_bundle::BuildWaiter` callback.
    fn on_html_route_built(ctx: NonNull<c_void>, route: &html_bundle::Route) {
        let pinned = RequestContextRef::adopt(ctx.cast::<Self>().as_ptr());
        let built = route.built_html().expect("the route left State::Building");
        pinned
            .ctx()
            .render_built_html_bundle(built.map_err(|()| &*route.bundle.path));
    }

    /// The dev server's callback. Consumes the +1 `render_html_bundle` took.
    pub(crate) fn on_html_bundle_built(this: *mut Self, html: ThisPtr<StaticRoute>) {
        let pinned = RequestContextRef::adopt(this);
        pinned.ctx().render_built_html_bundle(Ok(html));
    }

    /// `Err` carries the path of the bundle that failed to build.
    fn render_built_html_bundle(&self, built: Result<ThisPtr<StaticRoute>, &[u8]>) {
        if self.is_aborted_or_ended() {
            return;
        }
        let global_this = self.server().global_this();
        let html = match built {
            Ok(html) => html,
            Err(path) => {
                let err = global_this.create_error_instance(format_args!(
                    "Failed to bundle {}",
                    bun_core::fmt::quote(path)
                ));
                self.run_error_handler(err);
                return;
            }
        };

        let response: &mut Response = self.response_mut().expect("the Response is protected");
        let mut headers =
            bun_http_jsc::headers_jsc::from_fetch_headers(response.get_init_headers(), None);
        {
            use bun_http_types::ETag::HeaderEntryColumns;
            let entries = html.headers.entries.slice();
            for (name, value) in entries.items_name().iter().zip(entries.items_value()) {
                let name = html.headers.as_str(*name);
                if headers.get(name).is_none() {
                    headers.append(name, html.headers.as_str(*value));
                }
            }
        }
        match bun_http_jsc::headers_jsc::to_fetch_headers(&headers, global_this) {
            // SAFETY: `to_fetch_headers` returns a fresh +1 `FetchHeaders*`.
            Ok(fetch_headers) => response
                .set_init_headers(Some(unsafe { response::HeadersRef::adopt(fetch_headers) })),
            Err(err) => {
                self.run_error_handler(global_this.take_exception(err));
                return;
            }
        }

        self.blob.set(html.dupe_blob());
        if self.method == Method::HEAD {
            let resp = self.resp.get().expect("infallible: not aborted or ended");
            resp.run_corked_with_type(Self::render_html_bundle_head_corked, self.as_ctx_ptr());
            return;
        }
        self.render_with_blob_from_body_value();
    }

    fn render_html_bundle_head_corked(this: *mut Self) {
        // SAFETY: `this` is live for the synchronous cork call; only a shared
        // view is formed.
        let this = unsafe { &*this };
        let size = this.blob.get().size();
        this.flags.set_needs_content_length(false);
        this.render_metadata();
        if let Some(resp) = this.resp.get() {
            resp.write_header_int(b"content-length", size as u64);
        }
        this.end_without_body(this.should_close_connection());
    }

    /// `end_without_body` without the write: another owner answers `resp`.
    pub(crate) fn take_response(&self) -> Option<uws::AnyResponse> {
        let resp = self.resp.get()?;
        self.detach_response();
        self.reclaim_promise_cell();
        self.end_request_streaming_and_drain();
        self.deref();
        Some(resp)
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

    /// Tear down a heap `ResponseStreamJSSink` allocated by `do_render_stream`.
    /// JSSink<T> is `repr(transparent)` so the inner-ptr free matches the
    /// outer allocation.
    fn destroy_sink(ptr: NonNull<ResponseStreamJSSink<SSL_ENABLED>>) {
        // `ptr` was `heap::alloc`'d in do_render_stream and is being consumed
        // exactly once here. `JSSink<T>` is repr(transparent), so the inner
        // `HTTPServerWritable` shares the allocation Layout.
        ResponseStream::<SSL_ENABLED>::destroy(ptr.as_ptr().cast::<ResponseStream<SSL_ENABLED>>());
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
        let mut readable_ref = self
            .response_body_readable_stream_ref
            .replace(readable_stream::Strong::default());
        if let Some(wrapper_ptr) = self.sink.take() {
            // SAFETY: this context is the sink's sole owner until `destroy_sink`
            // below (see the `sink` field); `on_abort` leaves it allocated.
            let wrapper = unsafe { &mut *wrapper_ptr.as_ptr() };
            ResponseStreamJSSink::<SSL_ENABLED>::detach(&mut wrapper.sink.source, global_this);
            crate::dispatch::fold(stream.cancel(global_this));
            wrapper.sink.mark_done();
            wrapper.sink.on_first_write = None;
            wrapper.sink.finalize();
            Self::destroy_sink(wrapper_ptr);
        }
        readable_ref.deinit();
    }

    fn do_render_stream(pair: *mut StreamPair<'_, ThisServer, SSL_ENABLED, DEBUG_MODE, MUX>) {
        ctx_log!("doRenderStream");
        // SAFETY: pair is a stack local threaded through cork user-data.
        let pair = unsafe { &mut *pair };
        let this: &Self = pair.this;
        let stream = &mut pair.stream;
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

        let response_stream_box = Box::new(ResponseStreamJSSink::<SSL_ENABLED> {
            sink: ResponseStream::<SSL_ENABLED> {
                res: Some(resp),
                buffer: Vec::<u8>::default(),
                on_first_write: Some(Self::handle_first_stream_write_thunk),
                ctx: Some(this.as_ctx_ptr().cast::<c_void>()),
                global_this: Some(bun_ptr::BackRef::new(global_this)),
                ..Default::default()
            },
        });
        let response_stream_ptr = bun_core::heap::into_raw_nn(response_stream_box);
        this.sink.set(Some(response_stream_ptr));
        // SAFETY: just allocated; sole live mutable view (this.sink only stores the ptr).
        let response_stream = unsafe { &mut *response_stream_ptr.as_ptr() };

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
        let assignment_result: JSValue = ResponseStreamJSSink::<SSL_ENABLED>::assign_to_stream(
            global_this,
            stream.value,
            NonNull::from(&mut response_stream.sink),
        );

        assignment_result.ensure_still_alive();

        // assignToStream stored the controller in `sink.source`; a sync-finished stream's
        // `__controllerDetached` may already have cleared it again (handled below).

        let aborted = this.flags.aborted() || response_stream.sink.is_aborted();
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
            ResponseStreamJSSink::<SSL_ENABLED>::detach(
                &mut response_stream.sink.source,
                global_this,
            );
            this.sink.set(None);
            Self::destroy_sink(response_stream_ptr);
            return this.handle_reject(err_value);
        }

        if resp.has_responded() {
            stream_log!("done");
            ResponseStreamJSSink::<SSL_ENABLED>::detach(
                &mut response_stream.sink.source,
                global_this,
            );
            this.sink.set(None);
            Self::destroy_sink(response_stream_ptr);
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
            if let Some(flush) = response_stream.sink.pending_flush {
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
                            response_stream.sink.on_first_write = None;
                            response_stream.sink.ctx = None;
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
                ResponseStreamJSSink::<SSL_ENABLED>::detach(
                    &mut response_stream.sink.source,
                    global_this,
                );
                this.sink.set(None);
                Self::destroy_sink(response_stream_ptr);
                return this.handle_reject(effective_result);
            }
        }

        let mut readable_ref = this
            .response_body_readable_stream_ref
            .replace(readable_stream::Strong::default());

        let is_in_progress = response_stream.sink.has_backpressure
            || !(response_stream.sink.wrote == 0 && response_stream.sink.buffer.len() == 0);

        if !stream.is_locked(global_this) && !is_in_progress {
            if let Some(comparator) = WebCore::ReadableStream::from_js_direct(stream.value) {
                if core::mem::discriminant(&comparator.ptr) == core::mem::discriminant(&stream.ptr)
                {
                    stream_log!("is not locked");
                    response_stream.sink.on_first_write = None;
                    response_stream.sink.ctx = None;
                    ResponseStreamJSSink::<SSL_ENABLED>::detach(
                        &mut response_stream.sink.source,
                        global_this,
                    );
                    response_stream.sink.mark_done();
                    response_stream.sink.finalize();
                    this.sink.set(None);
                    Self::destroy_sink(response_stream_ptr);
                    readable_ref.deinit();
                    this.render_missing();
                    return;
                }
            }
        }

        stream_log!("is in progress, but did not return a Promise. Finalizing request context");
        response_stream.sink.on_first_write = None;
        response_stream.sink.ctx = None;
        ResponseStreamJSSink::<SSL_ENABLED>::detach(&mut response_stream.sink.source, global_this);
        crate::dispatch::fold(stream.cancel(global_this));
        response_stream.sink.mark_done();
        response_stream.sink.finalize();
        this.sink.set(None);
        Self::destroy_sink(response_stream_ptr);
        readable_ref.deinit();
        this.render_missing();
    }

    pub(crate) fn did_upgrade_web_socket(&self) -> bool {
        matches!(self.upgrade_context.get(), UpgradeState::Upgraded)
    }

    fn to_async_without_abort_handler(
        &self,
        req: *mut Req<SSL_ENABLED, MUX>,
        request_object: &mut Request,
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
        request_object.request_context.detach_request();
    }

    pub(crate) fn to_async(&self, req: *mut Req<SSL_ENABLED, MUX>, request_object: &mut Request) {
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
        if let Some(body) = self.request_body_mut() {
            // User called .blob(), .json(), text(), or .arrayBuffer() on the Request object
            // but we received nothing or the connection was aborted
            if matches!(body, Body::Value::Locked(_)) {
                let global_this = self.server().global_this();
                body.to_error_instance(
                    Body::ValueError::AbortReason(jsc::CommonAbortReason::ConnectionClosed),
                    global_this,
                )?;
                return Ok(true);
            }
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

    fn do_render_head_response_after_s3_size_resolved(
        pair: *mut HeaderResponseSizePair<'_, ThisServer, SSL_ENABLED, DEBUG_MODE, MUX>,
    ) {
        // SAFETY: `pair` is the live stack-local threaded through the
        // synchronous cork call.
        let pair = unsafe { &*pair };
        let this = pair.this;
        this.render_metadata();

        if let Some(resp) = this.resp.get() {
            // SAFETY: FFI handle
            resp.write_header_int(b"content-length", pair.size as u64);
        }
        this.end_without_body(this.should_close_connection());
        // `end_without_body` released the base ref; the caller
        // (`on_s3_size_resolved`) releases the ref taken for the S3 stat.
    }

    /// `S3::client::stat` callback shape: `fn(S3StatResult, *mut c_void) -> JsResult<()>`.
    fn on_s3_size_resolved_thunk(
        result: S3::simple_request::S3StatResult<'_>,
        this: *mut c_void,
    ) -> JsResult<()> {
        let stat_ref = RequestContextRef::adopt(this.cast::<Self>());
        stat_ref.ctx().on_s3_size_resolved(result);
        Ok(())
    }

    pub(crate) fn on_s3_size_resolved(&self, result: S3::simple_request::S3StatResult<'_>) {
        if let Some(resp) = self.resp.get() {
            let size = match result {
                S3::simple_request::S3StatResult::Failure(_)
                | S3::simple_request::S3StatResult::NotFound(_) => 0,
                S3::simple_request::S3StatResult::Success(stat) => stat.size,
            };
            let mut pair = HeaderResponseSizePair { this: self, size };
            resp.run_corked_with_type(
                |p| Self::do_render_head_response_after_s3_size_resolved(p),
                &raw mut pair,
            );
        }
    }

    fn do_render_head_response(
        pair: *mut HeaderResponsePair<'_, ThisServer, SSL_ENABLED, DEBUG_MODE, MUX>,
    ) {
        // SAFETY: pair is a stack local threaded through the synchronous cork call.
        let pair = unsafe { &*pair };
        let this = pair.this;
        let response_ptr = pair.response;
        if this.resp.get().is_none() {
            return;
        }
        // we will render the content-length header later manually so we set this to false
        this.flags.set_needs_content_length(false);
        // Always this.renderMetadata() before sending the content-length or transfer-encoding header so status is sent first

        let resp = this.resp.get().expect("infallible: resp bound");
        // SAFETY: `response_ptr` is the live, GC-rooted cell pointer the
        // constructing frame put in the pair; it carries the cell's provenance.
        unsafe { this.set_response(response_ptr) };
        // SAFETY: sole `&mut Response` for this cell in this frame.
        let response = unsafe { &mut *response_ptr };

        // `render` drops the body for a null-body status on GET, so HEAD must
        // not derive framing from that body (or the user headers) either
        // (RFC 9110 §9.3.2): render the exact metadata+framing GET would.
        if HTTPStatusText::is_null_body(response.status_code()) {
            Self::do_render_null_body_status_corked(this.as_ctx_ptr());
            return;
        }

        let Some(server) = this.server.get() else {
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
                    // Ref for the S3 stat; adopted and released by
                    // `on_s3_size_resolved_thunk`.
                    this.ref_();

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

                    let _ = S3::client::stat(
                        credentials,
                        path,
                        Self::on_s3_size_resolved_thunk,
                        this.as_ctx_ptr().cast::<c_void>(),
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
                    // SAFETY: FFI handle
                    resp.write_header(b"transfer-encoding", b"chunked");
                }
                // HEAD never transmits the body.
                if let Some(response) = this.response_mut() {
                    Self::cancel_unread_body(response, global_this);
                }
                this.end_without_body(this.should_close_connection());
            }
            Body::Value::HTMLBundle(bundle) => {
                let route = this.server().html_bundle_route(bundle.this_ptr());
                *body_value = Body::Value::Used;
                this.render_html_bundle(&route);
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
        let response_value = wrap_html_bundle(this.global_this(), response_value);
        if let Some(response) = as_response(response_value) {
            // SAFETY: `response` is the live, rooted cell pointer.
            if ctx.reject_unsendable_response(unsafe { (*response).status_code() }) {
                return;
            }
            ctx.response_jsvalue.set(response_value);
            response_value.ensure_still_alive();
            ctx.flags.set_response_protected(false);
            if ctx.method == Method::HEAD {
                if let Some(resp) = ctx.resp.get() {
                    let mut pair = HeaderResponsePair {
                        this: ctx,
                        response,
                    };
                    resp.run_corked_with_type(Self::do_render_head_response, &raw mut pair);
                }
                return;
            } else {
                // SAFETY: `response` is the live, rooted cell pointer.
                unsafe { ctx.protect_for_body_and_render(response_value, response) };
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
                    let fulfilled_value = wrap_html_bundle(this.global_this(), fulfilled_value);
                    let Some(response) = as_response(fulfilled_value) else {
                        ctx.render_missing_invalid_response(fulfilled_value);
                        return;
                    };

                    // SAFETY: `response` is the live, rooted cell pointer.
                    if ctx.reject_unsendable_response(unsafe { (*response).status_code() }) {
                        return;
                    }

                    ctx.response_jsvalue.set(fulfilled_value);
                    fulfilled_value.ensure_still_alive();
                    ctx.flags.set_response_protected(false);
                    if ctx.method == Method::HEAD {
                        if let Some(resp) = ctx.resp.get() {
                            let mut pair = HeaderResponsePair {
                                this: ctx,
                                response,
                            };
                            resp.run_corked_with_type(Self::do_render_head_response, &raw mut pair);
                        }
                        return;
                    }
                    // SAFETY: `response` is the live, rooted cell pointer.
                    unsafe { ctx.protect_for_body_and_render(fulfilled_value, response) };
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
        if let Some(wrapper) = self.sink_mut() {
            if !self.flags.aborted() && !wrapper.sink.is_aborted() {
                // Only defer when there is still a live response to drain the
                // flush through: on_writable (which resolves the flush via
                // flush_promise) is armed on `resp`. With no response the flush
                // can never settle, so taking a ref and attaching here would
                // leak the ref and hang the request; fall through to teardown.
                if let Some(flush) = wrapper.sink.pending_flush
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
        if let Some(wrapper) = self.sink_mut() {
            let wrapper_ptr = self
                .sink
                .take()
                .expect("infallible: sink_mut returned Some");
            let aborted = self.flags.aborted() || wrapper.sink.is_aborted();
            self.flags.set_aborted(aborted);
            wrote_anything = wrapper.sink.wrote > 0;
            ended_response = wrapper.sink.ended_response;
            if ended_response {
                // `resp` may be freed; the sink already resumed it. Clear these
                // before `detach()` below re-enters JS so any drain callback /
                // `on_start_buffering` reached from there early-returns.
                self.flags.set_request_body_paused(false);
                self.detach_request_body_producer();
            }

            wrapper.sink.finalize();
            let sink_global = wrapper
                .sink
                .global_this
                .expect("sink.global_this set in do_render_stream");
            ResponseStreamJSSink::<SSL_ENABLED>::detach(&mut wrapper.sink.source, &sink_global);
            Self::destroy_sink(wrapper_ptr);
        }

        debug_assert!(self.server.get().is_some());
        // server is a BACKREF; `global_this()` returns a lifetime decoupled
        // from `&self`.
        let global_this = self.server().global_this();
        if let Some(resp) = self.response_mut() {
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
        let Some(req) = NativePromiseContext::take::<Self>(args[args.len() - 1]) else {
            return Ok(JSValue::UNDEFINED);
        };
        let req = RequestContextRef::adopt(req.as_ptr());
        req.ctx().promise_cell.set(JSValue::ZERO);
        req.ctx().handle_resolve_stream();
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn on_reject_stream(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        stream_log!("onRejectStream");
        let args = callframe.arguments();
        let Some(req) = NativePromiseContext::take::<Self>(args[args.len() - 1]) else {
            return Ok(JSValue::UNDEFINED);
        };
        let err = args[0];
        let req = RequestContextRef::adopt(req.as_ptr());
        req.ctx().promise_cell.set(JSValue::ZERO);

        req.ctx().handle_reject_stream(global_this, err);
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn handle_reject_stream(&self, global_this: &JSGlobalObject, err: JSValue) {
        stream_log!("handleRejectStream");

        let mut ended_response = false;
        if let Some(wrapper) = self.sink_mut() {
            let wrapper_ptr = self
                .sink
                .take()
                .expect("infallible: sink_mut returned Some");
            ended_response = wrapper.sink.ended_response;
            if ended_response {
                // `resp` may be freed; the sink already resumed it. Clear before JS below.
                self.flags.set_request_body_paused(false);
                self.detach_request_body_producer();
            }
            if let Some(prom) = wrapper.sink.pending_flush.take() {
                // The promise value was protected when pending_flush was
                // assigned (flushFromJS / endFromJS). Drop that root before
                // abandoning the pointer, otherwise it leaks for the
                // lifetime of the VM.
                // S008: `JSPromise` is an `opaque_ffi!` ZST — safe deref.
                bun_opaque::opaque_deref_mut(prom).to_js().unprotect();
            }
            wrapper.sink.set_done();
            let aborted = self.flags.aborted() || wrapper.sink.is_aborted();
            self.flags.set_aborted(aborted);
            wrapper.sink.finalize();
            let sink_global = wrapper
                .sink
                .global_this
                .expect("sink.global_this set in do_render_stream");
            ResponseStreamJSSink::<SSL_ENABLED>::detach(&mut wrapper.sink.source, &sink_global);
            Self::destroy_sink(wrapper_ptr);
        }

        if let Some(resp) = self.response_mut() {
            release_body_stream(resp, global_this);
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
            Body::Value::HTMLBundle(bundle) => {
                if this.is_aborted_or_ended() {
                    return;
                }
                let route = this.server().html_bundle_route(bundle.this_ptr());
                *value = Body::Value::Used;
                this.render_html_bundle(&route);
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
                                let mut pair = StreamPair { stream, this };
                                resp.run_corked_with_type(Self::do_render_stream, &raw mut pair);
                            }
                            return;
                        }

                        readable_stream::Source::Bytes(byte_stream_ptr) => {
                            // BACKREF: `Source::Bytes` stores a live non-null
                            // `*mut ByteStream` (the JS wrapper's `m_ctx` heap
                            // payload, kept alive by `stream`). R-2: all touched
                            // ByteStream methods/fields are `&self`/interior-mutable.
                            let byte_stream_nn = NonNull::new(byte_stream_ptr)
                                .expect("Source::Bytes payload is non-null");
                            let byte_stream = bun_ptr::BackRef::from(byte_stream_nn);
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
                            this.ref_();
                            // Same as do_render_stream's Pending branch: the
                            // body is in flight, so `handle_reject` must not
                            // fall through to render_missing() and end it.
                            this.flags.set_has_marked_pending(true);
                            byte_stream.sink.set(WebCore::SinkHandle::ServerResponse(
                                AnyRequestContext::init(this.as_ctx_ptr()),
                            ));
                            stream.lock_native(global_this);
                            byte_stream.signal_consumer_attached();
                            // Deinit the old Strong reference before creating a new one
                            // to avoid leaking the Strong.Impl memory
                            this.response_body_readable_stream_ref
                                .with_mut(|s| s.deinit());
                            this.response_body_readable_stream_ref
                                .set(readable_stream::Strong::init(stream, global_this));

                            this.byte_stream.set(Some(byte_stream_nn));
                            let mut response_buf = byte_stream.take_buffer();
                            let buffer = response_buf.move_to_list();
                            let has_body_bytes = !buffer.is_empty();
                            this.response_buf_owned.set(buffer);

                            // we don't set size here because even if we have a hint
                            // uWebSockets won't let us partially write streaming content
                            this.blob.with_mut(|b| b.detach());

                            // if we've received metadata and part of the body, send everything we can and drain
                            if has_body_bytes {
                                resp.run_corked_with_type(
                                    Self::drain_response_buffer_and_metadata_corked,
                                    this.as_ctx_ptr(),
                                );
                            } else if matches!(
                                byte_stream.parent_const().producer.get(),
                                WebCore::streams::SourceHandle::HTMLRewriter(_)
                            ) {
                                // Defer status/headers to the first chunk/end
                                // so a pre-first-byte handler failure can
                                // still reach `error()`.
                            } else {
                                // if we only have metadata to send, send it now
                                resp.run_corked_with_type(
                                    Self::render_metadata_corked,
                                    this.as_ctx_ptr(),
                                );
                            }
                            // Wake the producer after the older bytes are queued.
                            byte_stream.signal_drained();
                            return;
                        }
                    }
                }

                if lock.on_receive_value.is_some() || lock.task.is_some() {
                    // someone else is waiting for the stream or waiting for `onStartStreaming`
                    let readable = match value.to_readable_stream(global_this) {
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

    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn write_chunk(
        this: *mut Self,
        stream: &WebCore::streams::Result,
    ) -> WebCore::streams::Writable {
        // SAFETY: caller passes the live `*mut RequestContext` stored as the sink ctx.
        let this = unsafe { &*this };
        if this.is_aborted_or_ended() {
            return WebCore::streams::Writable::Done;
        }
        let resp = this.resp.get().expect("infallible: resp bound");

        // A rewriter-produced `Source::Bytes` body defers metadata until the
        // first chunk so a pre-first-byte failure can still reach the
        // server's `error()` hook. Flush it now, corked.
        if !this.flags.has_written_status() {
            resp.run_corked_with_type(Self::render_metadata_corked, this.as_ctx_ptr());
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

    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn end_chunk(this: *mut Self, err: Option<&WebCore::streams::StreamError>) {
        let _ref = RequestContextRef::adopt(this);
        // SAFETY: caller passes the live `*mut RequestContext` stored as the
        // sink ctx; `_ref` keeps it alive for this call.
        let this = unsafe { &*this };
        // The stream has already dropped this sink; `_ref` is the pipe's ref.
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
                resp.run_corked_with_type(Self::render_metadata_corked, this.as_ctx_ptr());
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

    pub(crate) fn do_render_blob(&self) {
        // We are not corked
        // The body is small
        // Faster to do the memcpy than to do the two network calls
        // We are not streaming
        // This is an important performance optimization
        if self.flags.has_abort_handler() && self.blob.get().fast_size() < 16384 - 1024 {
            if let Some(resp) = self.resp.get() {
                resp.run_corked_with_type(
                    |ctx| Self::do_render_blob_corked(ctx),
                    self.as_ctx_ptr(),
                );
            }
        } else {
            Self::do_render_blob_corked(self.as_ctx_ptr());
        }
    }

    fn do_render_blob_corked(this: *mut Self) {
        // SAFETY: `this` is live for the synchronous cork call; only a shared
        // view is formed.
        let this = unsafe { &*this };
        this.render_metadata();
        this.render_bytes();
    }

    pub(crate) fn do_render_null_body_status(&self) {
        if self.flags.has_abort_handler() {
            if let Some(resp) = self.resp.get() {
                resp.run_corked_with_type(
                    Self::do_render_null_body_status_corked,
                    self.as_ctx_ptr(),
                );
            }
        } else {
            Self::do_render_null_body_status_corked(self.as_ctx_ptr());
        }
    }

    /// Render a response whose status forbids a body (RFC 9112 §6.3). `try_end`
    /// would put `Content-Length: 0` on a 304 (uWS only suppresses it for
    /// 1xx/204); RFC 9110 §8.6 only allows the 200's length, so forward the
    /// handler's value or emit none.
    ///
    /// # Safety
    /// `this` must point to a live `RequestContext` threaded through cork user-data.
    fn do_render_null_body_status_corked(this: *mut Self) {
        // SAFETY: `this` is live for the synchronous cork call; only a shared
        // view is formed.
        let this = unsafe { &*this };

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
        if let Some(server) = this.server.get()
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
        // render_bytes releases the base ref on every path (resp gone included).
        this.render_bytes();
    }

    /// `render_metadata` adapter for `run_corked_with_type` (takes `fn(*mut U)`).
    fn render_metadata_corked(this: *mut Self) {
        // SAFETY: this is the live RequestContext threaded through cork user-data.
        unsafe { (*this).render_metadata() };
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
            // SAFETY: FFI handle
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
                        // SAFETY: `response` is the live, rooted cell pointer.
                        if HTTPStatusText::is_sendable(unsafe { (*response).status_code() }) {
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
                            // SAFETY: as above.
                            unsafe { self.protect_for_body_and_render(result, response) };
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

                // SAFETY: `response` is the live, rooted cell pointer.
                if !HTTPStatusText::is_sendable(unsafe { (*response).status_code() }) {
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

                // SAFETY: `response` is the live, rooted cell pointer.
                unsafe { ctx.protect_for_body_and_render(fulfilled_value, response) };
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
        // SAFETY: `self.blob`'s backing bytes are owned by the context and
        // outlive the `try_end`/`on_writable` calls below; the cell read ends
        // here, before the (self-releasing) tail.
        let bytes: &[u8] = unsafe { bun_ptr::detach_lifetime(self.blob.get().slice()) };
        if let Some(resp) = self.resp.get() {
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
        }
        self.detach_response();
        self.end_request_streaming_and_drain();
        self.deref();
    }

    /// Replace the tracked Response. Drops the previous weak ref (if any)
    /// before taking a new one so the old Response's allocation can be
    /// freed once its own strong refs go to zero.
    ///
    /// # Safety
    /// `response` must be the live JS wrapper's cell pointer (as returned by
    /// [`as_response`]), carrying the allocation's provenance — `WeakPtr` keeps
    /// it past any reborrow.
    unsafe fn set_response(&self, response: *mut Response) {
        if self
            .response_weakref
            .with_mut(|weak| weak.get().map(std::ptr::from_mut::<Response>))
            == Some(response)
        {
            return;
        }
        // SAFETY: caller contract — `response` is live and root-provenanced.
        self.response_weakref
            .set(unsafe { response::WeakRef::init_ref(response) });
    }

    /// # Safety
    /// Same contract as [`Self::set_response`].
    pub(crate) unsafe fn render(&self, response: *mut Response) {
        ctx_log!("render");

        // A HEAD response never carries content (RFC 9110 §9.3.2). The normal
        // handler path branches to `do_render_head_response` before reaching
        // here, but the `error()` handler paths call `render()` directly.
        if self.method == Method::HEAD {
            if let Some(resp) = self.resp.get() {
                let mut pair = HeaderResponsePair {
                    this: self,
                    response,
                };
                resp.run_corked_with_type(Self::do_render_head_response, &raw mut pair);
            }
            return;
        }

        // SAFETY: caller contract.
        unsafe { self.set_response(response) };

        // SAFETY: caller contract — `response` is live.
        if HTTPStatusText::is_null_body(unsafe { (*response).status_code() }) {
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
    ///
    /// # Safety
    /// Same contract as [`Self::render`].
    unsafe fn protect_for_body_and_render(&self, response_value: JSValue, response: *mut Response) {
        // SAFETY: caller contract: `response` is live. This is the only borrow
        // of its body, and it ends before `render` reborrows the cell.
        let body_value = unsafe { (*response).get_body_value() };
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
        // SAFETY: caller contract.
        unsafe { self.render(response) };
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
                // and the base ref released (see the buffering branch below).
                // SAFETY: FFI handle
                if let Some(resp) = this.resp.get() {
                    if !resp.has_responded() {
                        this.flags.set_has_written_status(true);
                        // SAFETY: FFI handle
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
                let readable_stream::Source::Bytes(bytes_ptr) = readable.ptr else {
                    return;
                };
                // BACKREF: `Source::Bytes` payload is the live non-null `m_ctx`
                // heap `ByteStream` kept alive by `readable` for this call.
                let bytes = bun_ptr::BackRef::from(
                    NonNull::new(bytes_ptr).expect("Source::Bytes payload is non-null"),
                );
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
                let readable_stream::Source::Bytes(bytes_ptr) = readable.ptr else {
                    return;
                };
                // BACKREF: `Source::Bytes` payload is the live non-null `m_ctx`
                // heap `ByteStream` kept alive by `readable` for this call.
                let bytes = bun_ptr::BackRef::from(
                    NonNull::new(bytes_ptr).expect("Source::Bytes payload is non-null"),
                );
                let source = bytes.parent_const();
                source.producer.set(WebCore::streams::SourceHandle::None);
                bytes.on_data(WebCore::streams::Result::TemporaryAndDone(borrowed));
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

                // Route through the normal end path so this.resp is
                // detached and the base ref released. Writing directly on
                // the raw uWS response left this.resp pointing at a
                // completed (and soon freed) response — uWS markDone()
                // clears onAborted so no abort ever fires to release the
                // ref, and a later handleResolve()/handleReject() from an
                // async handler would dereference the stale pointer.
                // SAFETY: FFI handle
                if let Some(resp) = this.resp.get() {
                    if !resp.has_responded() {
                        this.flags.set_has_written_status(true);
                        // SAFETY: FFI handle
                        resp.write_status(b"413 Payload Too Large");
                    }
                }
                this.end_without_body(!MUX);
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

                    let _ = Body::Value::resolve(&mut old, body, global_this, None); // TODO: properly propagate exception upwards
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
            if unsafe { (*sink.as_ptr()).sink.ended_response } {
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

    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn on_request_body_stream_drained(this: *mut Self) {
        // SAFETY: `this` is the registered live `*mut RequestContext`.
        let this = unsafe { &*this };
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
                if let Some(body) = self.request_body_mut() {
                    let mut old = core::mem::replace(body, Body::Value::Null);
                    if let Body::Value::Locked(l) = &mut old {
                        l.on_receive_value = None;
                    }
                    let mut new_body: Body::Value = Body::Value::Null;
                    let global_this = server.global_this();
                    let _ = Body::Value::resolve(&mut old, &mut new_body, global_this, None); // TODO: properly propagate exception upwards
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

// ─── per-monomorphization C-ABI exports ──────────────────────────────────────
// The exported symbol name is "Bun__HTTPRequestContext" + (debug ? "Debug" : "")
// + (mux ? "Mux" : "") + (ssl ? "TLS" : "") + "__on*".
// Rust generics cannot own `#[no_mangle]` symbols, so each of the 8 concrete
// instantiations × 4 callbacks is spelled out via `request_ctx_exports!`. The
// generic body lives on the `impl<ThisServer, ..> RequestContext` block above
// (`on_resolve` / `on_reject` / `on_resolve_stream` / `on_reject_stream`); each
// shim is the result-mapping (`JsResult<JSValue>` → raw `JSValue`,
// `.zero` on error) over the monomorphic associated fn.
macro_rules! request_ctx_exports {
    ($(
        ($srv:ty, $ssl:literal, $dbg:literal, $mux:literal) =>
        $on_resolve:ident, $on_reject:ident, $on_resolve_stream:ident, $on_reject_stream:ident
    );* $(;)?) => {$(
        // Named C-ABI symbols for the C++ side. The bodies forward to the
        // generic `host_on_*` shims monomorphized at this tuple — `#[no_mangle]`
        // pins the link name.
        #[unsafe(no_mangle)]
        #[bun_jsc::host_call]
        pub fn $on_resolve(g: *mut JSGlobalObject, f: *mut CallFrame) -> JSValue {
            host_on_resolve::<$srv, $ssl, $dbg, $mux>(g, f)
        }
        #[unsafe(no_mangle)]
        #[bun_jsc::host_call]
        pub fn $on_reject(g: *mut JSGlobalObject, f: *mut CallFrame) -> JSValue {
            host_on_reject::<$srv, $ssl, $dbg, $mux>(g, f)
        }
        #[unsafe(no_mangle)]
        #[bun_jsc::host_call]
        pub fn $on_resolve_stream(g: *mut JSGlobalObject, f: *mut CallFrame) -> JSValue {
            host_on_resolve_stream::<$srv, $ssl, $dbg, $mux>(g, f)
        }
        #[unsafe(no_mangle)]
        #[bun_jsc::host_call]
        pub fn $on_reject_stream(g: *mut JSGlobalObject, f: *mut CallFrame) -> JSValue {
            host_on_reject_stream::<$srv, $ssl, $dbg, $mux>(g, f)
        }
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

struct StreamPair<'a, ThisServer, const SSL: bool, const DBG: bool, const MUX: bool> {
    pub this: &'a RequestContext<ThisServer, SSL, DBG, MUX>,
    pub stream: WebCore::ReadableStream,
}

struct HeaderResponseSizePair<'a, ThisServer, const SSL: bool, const DBG: bool, const MUX: bool> {
    pub this: &'a RequestContext<ThisServer, SSL, DBG, MUX>,
    pub(crate) size: usize,
}

struct HeaderResponsePair<'a, ThisServer, const SSL: bool, const DBG: bool, const MUX: bool> {
    pub this: &'a RequestContext<ThisServer, SSL, DBG, MUX>,
    /// The JS wrapper's cell pointer, not a `&mut Response`: the receiving
    /// frame hands it to `set_response`, which stores it in a `WeakPtr` that
    /// outlives any reborrow. The cell is GC-rooted by the constructing frame.
    pub(crate) response: *mut Response,
}

struct PathnameFormatter<'a, ThisServer, const SSL: bool, const DBG: bool, const MUX: bool> {
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
