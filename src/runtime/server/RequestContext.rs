use core::ffi::{c_uint, c_void};
use core::ptr::NonNull;
#[allow(unused_imports)]
use std::sync::Arc;

#[allow(unused_imports)]
use bun_sys::FdExt as _;

use bun_core::String as BunString;
use bun_http_types::Method::Method;
use bun_uws::{self as uws, WebSocketUpgradeContext};

use crate::server::jsc::{self, JSGlobalObject, JSValue, JsResult, VirtualMachine};
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
    pub data: NonNull<c_void>,
    pub deref_fn: fn(*mut c_void),
}

impl AdditionalOnAbortCallback {
    pub fn deref(&self) {
        (self.deref_fn)(self.data.as_ptr());
    }
}

// PORT NOTE (transport selection): Zig `NewRequestContext` is a comptime
// type-function over `(ssl_enabled, debug_mode, ThisServer, http3)` and picks
// `Resp = uws.H3.Response | uws.NewApp(ssl).Response` / `Req = uws.H3.Request |
// uws.Request` at comptime. Stable Rust cannot drive an associated type from a
// const-generic `bool` without specialization, and an early `Transport`
// helper-trait approach forced `where TransportFor<SSL,H3>: Transport` bounds
// onto every generic that named `RequestContext` (which Rust then *cannot*
// discharge for a generic `const SSL: bool` — only the four concrete combos
// have impls). So instead the `resp` field stores `uws::AnyResponse` (a Copy
// enum over the three concrete handles) and dispatches at runtime — same shape
// as `AnyRequestContext` / `AnyServer`. The const params still pick which
// variant `create()` constructs and gate H3-specific code paths.
pub type Req<const SSL_ENABLED: bool, const HTTP3: bool> = c_void;
pub type Resp<const SSL_ENABLED: bool, const HTTP3: bool> = c_void;

// Surface gaps `AnyResponse` doesn't expose yet — hand-dispatched here so the
// state machine can call them without touching `bun_uws_sys`.
pub trait AnyResponseExt {
    fn has_responded(self) -> bool;
    fn override_write_offset(self, offset: u64);
}

/// Extract the raw FFI pointer from an `AnyResponse` for C-ABI shims that
/// take `*mut c_void` (e.g. `FetchHeaders::to_uws_response`, `CookieMap::write`).
#[inline]
fn any_response_as_ptr(r: uws::AnyResponse) -> *mut c_void {
    match r {
        uws::AnyResponse::SSL(p) => p.cast::<c_void>(),
        uws::AnyResponse::TCP(p) => p.cast::<c_void>(),
        uws::AnyResponse::H3(p) => p.cast::<c_void>(),
    }
}

impl AnyResponseExt for uws::AnyResponse {
    #[inline]
    fn has_responded(self) -> bool {
        // S012: variant payloads are ZST opaques (`Response<SSL>` / `H3Response`);
        // route the `*mut → &mut` deref through the const-asserted
        // `bun_opaque::opaque_deref_mut` so dispatch is `unsafe`-free.
        match self {
            uws::AnyResponse::SSL(p) => bun_opaque::opaque_deref_mut(p).has_responded(),
            uws::AnyResponse::TCP(p) => bun_opaque::opaque_deref_mut(p).has_responded(),
            uws::AnyResponse::H3(p) => bun_opaque::opaque_deref_mut(p).has_responded(),
        }
    }
    #[inline]
    fn override_write_offset(self, offset: u64) {
        match self {
            uws::AnyResponse::SSL(p) => {
                bun_opaque::opaque_deref_mut(p).override_write_offset(offset)
            }
            uws::AnyResponse::TCP(p) => {
                bun_opaque::opaque_deref_mut(p).override_write_offset(offset)
            }
            uws::AnyResponse::H3(p) => {
                bun_opaque::opaque_deref_mut(p).override_write_offset(offset)
            }
        }
    }
}

/// Back-reference to a stack-local "should this RequestContext defer its
/// deinit until the JS callback returns" flag. The dispatching frame owns the
/// `Cell<bool>`; `RequestContext` stores a `BackRef` to it (cleared before the
/// frame unwinds), so reads/writes are safe `Cell` ops — no raw `*mut bool`.
pub type DeferDeinitFlag = bun_ptr::BackRef<core::cell::Cell<bool>>;

// `jsc.WebCore.HTTPServerWritable(ssl_enabled, http3)` — comptime type fn.
pub type ResponseStream<const SSL_ENABLED: bool, const HTTP3: bool> =
    crate::webcore::streams::HTTPServerWritable<SSL_ENABLED, HTTP3>;
pub type ResponseStreamJSSink<const SSL_ENABLED: bool, const HTTP3: bool> =
    crate::webcore::streams::HTTPServerWritableJSSink<SSL_ENABLED, HTTP3>;

/// This pre-allocates up to 2,048 RequestContext structs.
/// It costs about 655,632 bytes.
// TODO(port): bun.HiveArray(RequestContext, if (bun.heap_breakdown.enabled) 0 else 2048).Fallback
pub type RequestContextStackAllocator<
    ThisServer,
    const SSL: bool,
    const DBG: bool,
    const H3: bool,
> = bun_collections::hive_array::Fallback<RequestContext<ThisServer, SSL, DBG, H3>, 2048>;

thread_local! {
    // TODO(port): Zig `pub threadlocal var pool: ?*RequestContextStackAllocator = null;` is
    // per-monomorphization. Rust thread_local! cannot be generic; Phase B: move into ThisServer
    // or use a per-instantiation static via macro.
    static POOL: core::cell::Cell<*mut c_void> = const { core::cell::Cell::new(core::ptr::null_mut()) };
}

pub struct RequestContext<
    ThisServer,
    const SSL_ENABLED: bool,
    const DEBUG_MODE: bool,
    const HTTP3: bool,
> {
    /// BACKREF to the embedding `Server` — the server owns this request
    /// context (allocated from its `HiveArray` pool) and outlives it, so the
    /// pointee is live for the holder's entire lifetime. `None` once detached.
    pub server: Option<bun_ptr::BackRef<ThisServer>>,
    pub resp: Option<uws::AnyResponse>,
    /// thread-local default heap allocator
    /// this prevents an extra pthread_getspecific() call which shows up in profiling
    // TODO(port): allocator field deleted — global mimalloc per PORTING.md §Allocators.
    pub req: Option<*mut Req<SSL_ENABLED, HTTP3>>,
    pub request_weakref: request::WeakRef,
    // PORT NOTE: Zig `?*AbortSignal`. `Arc<AbortSignal>` was wrong —
    // `AbortSignal` is an opaque ZST FFI handle; an `Arc` of a ZST never owns
    // the C++ allocation. Store the raw pointer. The request holds TWO counts:
    // the intrusive C++ `RefPtr` (+1 from `AbortSignal::new()`/`ref_()`) and a
    // pending-activity count for GC visibility. Both are released together via
    // `shim::signal_release` in `on_abort`/`finalize_without_deinit`.
    pub signal: Option<NonNull<AbortSignal>>,
    pub method: Method,
    /// Owned `+1` ref on a C++ `CookieMap` (taken in `set_cookies`, released
    /// when the field is dropped/replaced — `CookieMapRef` handles the unref).
    pub cookies: Option<CookieMapRef>,

    pub flags: Flags<DEBUG_MODE>,

    pub upgrade_context: Option<*mut WebSocketUpgradeContext>,

    /// We can only safely free once the request body promise is finalized
    /// and the response is rejected
    // TODO(port): bare JSValue heap field — kept alive via manual protect()/unprotect()
    // (response_protected flag); revisit bun_jsc::Strong in Phase B.
    pub response_jsvalue: JSValue,
    pub ref_count: u8,

    /// Weak: for plain Blob/InternalBlob bodies the Response JSValue is
    /// not protected (hot path), so GC may finalize it while we're parked
    /// on tryEnd() backpressure. onAbort / handleResolveStream /
    /// handleRejectStream only use this for best-effort readable-stream
    /// cleanup and safely observe null instead of UAF. File/.Locked
    /// bodies still protect() response_jsvalue, so the pointer stays
    /// valid for renderMetadata() on those paths.
    pub response_weakref: response::WeakRef,
    pub blob: AnyBlob,

    pub sendfile: SendfileContext,
    pub range: RangeRequest::Raw,

    pub request_body_readable_stream_ref: readable_stream::Strong,
    // TODO(b2-blocked): `WebCore::body::value::HiveRef` — webcore gates the
    // HiveArray pool. Raw ptr to the pooled `Body::Value` slot until that lands.
    pub request_body: Option<NonNull<body::Value>>,
    pub request_body_buf: Vec<u8>,
    pub request_body_content_len: usize,

    pub sink: Option<NonNull<ResponseStreamJSSink<SSL_ENABLED, HTTP3>>>,
    pub byte_stream: Option<NonNull<ByteStream>>,
    /// This keeps the Response body's ReadableStream alive.
    pub response_body_readable_stream_ref: readable_stream::Strong,

    /// Used in errors
    pub pathname: BunString,

    /// Used either for temporary blob data or fallback
    /// When the response body is a temporary value
    pub response_buf_owned: Vec<u8>,

    /// Defer finalization until after the request handler task is completed?
    ///
    /// BORROW_PARAM: points at a `Cell<bool>` on the dispatching frame's
    /// stack. `BackRef` encodes the outlives-holder invariant (the field is
    /// always cleared before that frame returns) so reads/writes are safe
    /// `Cell::get`/`set` instead of raw `*mut bool` deref.
    pub defer_deinit_until_callback_completes: Option<DeferDeinitFlag>,

    pub additional_on_abort: Option<AdditionalOnAbortCallback>,
    // TODO: support builtin compression
}

impl<ThisServer, const SSL_ENABLED: bool, const DEBUG_MODE: bool, const HTTP3: bool>
    RequestContext<ThisServer, SSL_ENABLED, DEBUG_MODE, HTTP3>
where
    ThisServer: ServerLike + 'static,
{
    pub const IS_H3: bool = HTTP3;

    pub fn memory_cost(&self) -> usize {
        // The Sink and ByteStream aren't owned by this.
        core::mem::size_of::<Self>()
            + self.request_body_buf.capacity()
            + self.response_buf_owned.capacity()
            + self.blob.memory_cost()
    }

    #[inline]
    pub fn is_async(&self) -> bool {
        self.defer_deinit_until_callback_completes.is_none()
    }

    pub fn dev_server(&self) -> Option<&crate::bake::DevServer::DevServer> {
        // `server` is a `BackRef` (BACKREF — server outlives `self`); safe
        // `Deref` ties the borrow to `&self.server`, which is `&'self`.
        self.server.as_ref()?.dev_server()
    }
}

// ─── per-request state machine bodies ────────────────────────────────────────
// Everything below until the helper structs at the bottom is the request
// state machine: render(), on_abort(), on_resolve(), do_render_*, sendfile,
// stream handling, error handling.
use bun_collections::{ByteVecExt, VecExt};
use bun_core::Output;
use bun_http_types as HTTP;
use bun_http_types::MimeType::MimeType;
use bun_paths::PathBuffer;
use std::io::Write as _;
// Forward to the real module (now declared in `crate::api`). `take` is reshaped
// from `Option<NonNull<T>>` to an unbounded exclusive borrow so call sites can invoke
// methods directly; the borrow is scoped by the caller's `scopeguard` + deref().
#[allow(non_snake_case)]
mod NativePromiseContext {
    use super::{JSGlobalObject, JSValue};
    use crate::api::native_promise_context as npc;
    pub use npc::NativePromiseContextType;

    #[inline]
    pub fn create<T: NativePromiseContextType>(global: &JSGlobalObject, ctx: *mut T) -> JSValue {
        npc::create(global, ctx)
    }
    #[inline]
    pub fn take<T>(cell: JSValue) -> Option<&'static mut T> {
        // SAFETY: the cell carried a +1 ref on `ctx`; ownership transfers back
        // to the caller, who immediately scopes it with a deref-on-drop guard.
        npc::take::<T>(cell).map(|p| unsafe { &mut *p.as_ptr() })
    }
}
use crate::node::types::PathLikeExt as _;
use crate::server::jsc::CallFrame;
use crate::server::{AnyRequestContext, FileResponseStream, HTTPStatusText, file_response_stream};
use crate::webcore::blob::BlobExt as _;
use crate::webcore::{Blob, ReadableStream, body as Body, s3 as S3};
use bun_jsc::SysErrorJsc as _;
use bun_jsc::event_loop::EventLoop;

/// RAII: releases one intrusive ref on a [`RequestContext`] at scope exit.
///
/// Replaces the Zig `defer ctx.deref()` pattern in promise-callback host
/// functions — `NativePromiseContext::take` hands back a +1 ref, and the
/// callback must drop it on every exit path. Holds the raw pointer (not
/// `&mut`) so the body can keep using its own `&mut Self` view without
/// borrowck conflict; the `&mut` is formed only at drop time.
struct RequestContextRef<ThisServer, const SSL: bool, const DBG: bool, const H3: bool>(
    *mut RequestContext<ThisServer, SSL, DBG, H3>,
)
where
    ThisServer: ServerLike + 'static;

impl<ThisServer, const SSL: bool, const DBG: bool, const H3: bool> Drop
    for RequestContextRef<ThisServer, SSL, DBG, H3>
where
    ThisServer: ServerLike + 'static,
{
    #[inline]
    fn drop(&mut self) {
        // SAFETY: pointer was live when wrapped (caller owns one ref) and
        // `deref()` itself handles the final destroy when count hits zero.
        unsafe { (*self.0).deref() };
    }
}

// `Response` doesn't yet implement `JsClass` (codegen-gated). Route the
// downcast through the codegen stub so the call sites type-check; the stub
// returns `None` until codegen lands.
//
/// # Safety
/// `from_js` returns the C++-owned cell pointer for `value`. The caller must
/// guarantee that:
/// - no other Rust `&mut Response` aliasing this cell is live for the
///   lifetime of the returned reference (the .zig spec returns a raw
///   `?*Response` with no exclusivity claim — the `&mut` here is a port-side
///   upgrade), and
/// - `value` is kept GC-rooted (ensure_still_alive / protect()) for as long
///   as the returned reference is used, so the JSC-owned allocation outlives
///   the borrow.
#[inline]
unsafe fn as_response(value: JSValue) -> Option<&'static mut Response> {
    response::from_js(value).map(|p| unsafe { &mut *p.cast::<Response>() })
}

// ─── sibling-subtree shims ───────────────────────────────────────────────────
// These forward to methods that exist in webcore/ but are currently inside
// impl blocks that fail to compile (codegen gc-slot stubs, opaque AbortSignal,
// duplicate InternalJSEventCallback). Adapt on this side per phase-d rules.
mod shim {
    use super::*;

    #[inline]
    pub fn response_body_stream(r: &mut Response, g: &JSGlobalObject) -> Option<ReadableStream> {
        r.get_body_readable_stream(g)
    }
    #[inline]
    pub fn response_detach_stream(r: &mut Response, g: &JSGlobalObject) {
        r.detach_readable_stream(g)
    }
    #[inline]
    pub fn signal_aborted(s: &NonNull<AbortSignal>) -> bool {
        // `signal` is kept alive by the intrusive C++ refcount (+1 from
        // `AbortSignal::new()` / `ref_()`) plus `pending_activity_ref()` until
        // `signal_release` drops both — satisfies the `BackRef` outlives-holder
        // invariant for the duration of this call.
        bun_ptr::BackRef::from(*s).aborted()
    }
    #[inline]
    pub fn signal_fire(s: &NonNull<AbortSignal>, g: &JSGlobalObject, r: jsc::CommonAbortReason) {
        // See `signal_aborted` — counted ref keeps pointee live.
        bun_ptr::BackRef::from(*s).signal(g, r)
    }
    /// Release BOTH refcounts the request holds on its AbortSignal, mirroring
    /// the Zig `defer { signal.pendingActivityUnref(); signal.unref(); }` pair.
    /// `pending_activity_unref()` drops the GC-visibility count and `unref()`
    /// drops the intrusive C++ `RefPtr` count taken at creation. `s` must not
    /// be dereferenced after this call.
    #[inline]
    pub fn signal_release(s: NonNull<AbortSignal>) {
        // See `signal_aborted`. Order matches Zig: pending-activity first,
        // then the owning intrusive ref (which may free). `BackRef` is dropped
        // before `unref()` returns, so no dangling deref.
        let signal = bun_ptr::BackRef::from(s);
        signal.pending_activity_unref();
        signal.unref();
    }
    #[inline]
    pub fn iec_trigger(
        cb: &bun_jsc::JsCell<request::InternalJSEventCallback>,
        ev: request::EventType,
        g: &JSGlobalObject,
    ) -> bool {
        cb.with_mut(|cb| cb.trigger(ev, g))
    }
    #[inline]
    pub fn iec_deinit(cb: &bun_jsc::JsCell<request::InternalJSEventCallback>) {
        cb.with_mut(|cb| cb.deinit())
    }
    #[inline]
    pub fn iec_has_callback(cb: &bun_jsc::JsCell<request::InternalJSEventCallback>) -> bool {
        cb.get().has_callback()
    }
    /// `Blob::is_s3()` / `Blob::needs_to_read_file()` have duplicate impls
    /// (E0034); inline the body here.
    #[inline]
    pub fn blob_is_s3(b: &Blob) -> bool {
        b.store
            .get()
            .as_ref()
            .is_some_and(|s| matches!(s.data, crate::webcore::blob::store::Data::S3(_)))
    }
    #[inline]
    pub fn blob_needs_to_read_file(b: &Blob) -> bool {
        b.store
            .get()
            .as_ref()
            .is_some_and(|s| matches!(s.data, crate::webcore::blob::store::Data::File(_)))
    }
    #[inline]
    pub fn byte_stream_unpipe(s: NonNull<ByteStream>) {
        // The lone caller has just `take()`n the pointer out of
        // `self.byte_stream`; the allocation is kept alive by
        // `response_body_readable_stream_ref` (BackRef invariant: pointee
        // outlives this temporary). R-2: `unpipe_without_deref` takes `&self`
        // (interior-mutable `JsCell<Pipe>`), so shared deref is sufficient.
        bun_ptr::BackRef::from(s).unpipe_without_deref()
    }
    #[inline]
    pub fn request_ensure_url(r: &Request) -> Result<(), bun_alloc::AllocError> {
        r.ensure_url()
    }
}
// `Api::FallbackMessageContainer`/`JsException`/`Problems`/`Fallback::render_backend`
// live in `bun_options_types::schema::api` + `bun_ast::runtime`; both are
// still being filled in by concurrent ports. The DEBUG_MODE error-page paths
// that use them stay ``-gated below.

use bun_options_types::schema::api as Api;

use bun_js_parser::parser::Runtime::Fallback;

/// PORT NOTE: `Api.JsException` is split across two crates in the Rust port —
/// `bun_jsc::schema_api::JsException` (carries `stack`, used by
/// `VirtualMachine::run_error_handler`) and `bun_options_types::schema::api::
/// JsException` (peechy-encodable, `stack` omitted to break the dep cycle). In
/// Zig these are the *same* struct, so `runErrorHandler` populates the list and
/// `Problems.exceptions` consumes it directly. Bridge the two here so the
/// fallback page actually carries the captured exceptions instead of an empty
/// array (react-response.test.ts asserts `exceptions[0].message`).
fn jsc_exceptions_to_api(list: jsc::ExceptionList) -> Vec<Api::JsException> {
    list.into_iter()
        .map(|ex| Api::JsException {
            name: (!ex.name.is_empty()).then_some(ex.name),
            message: (!ex.message.is_empty()).then_some(ex.message),
            runtime_type: Some(ex.runtime_type),
            // jsc copy widened `code` to u16 (from `u16::from(u8)`); spec is u8.
            code: Some(ex.code as u8),
        })
        .collect()
}

bun_core::declare_scope!(RequestContext, visible);
bun_core::declare_scope!(ReadableStream, visible);

macro_rules! ctx_log { ($($t:tt)*) => { bun_core::scoped_log!(RequestContext, $($t)*) }; }
macro_rules! stream_log { ($($t:tt)*) => { bun_core::scoped_log!(ReadableStream, $($t)*) }; }

/// Per-monomorphization C-ABI shim table for the four promise-reaction host
/// fns. Zig's `toJSHostFn(onResolve)` mints a fresh `extern fn` per comptime
/// instantiation **and `@export`s the same pointer**, so the value passed to
/// `then_with_value` is identical to the `Bun__HTTPRequestContext*__on*`
/// symbol that C++'s `GlobalObject::promiseHandlerID` compares against.
///
/// In Rust the `#[no_mangle]` exports cannot live on a generic fn, so they are
/// emitted as concrete wrappers by `request_ctx_exports!` below. The trait
/// impls — also emitted by that macro — point at those *exported* wrappers
/// (not the inner generic shims), so `Self::ON_RESOLVE` and the C++ side agree
/// on the function-pointer identity and `promiseHandlerID` resolves.
///
/// PORT NOTE (layering): expressed as a trait (not inherent consts) so
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
fn host_on_resolve<ThisServer, const SSL: bool, const DBG: bool, const H3: bool>(
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
        RequestContext::<ThisServer, SSL, DBG, H3>::on_resolve(g, f),
    )
}
fn host_on_reject<ThisServer, const SSL: bool, const DBG: bool, const H3: bool>(
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
        RequestContext::<ThisServer, SSL, DBG, H3>::on_reject(g, f),
    )
}
fn host_on_resolve_stream<ThisServer, const SSL: bool, const DBG: bool, const H3: bool>(
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
        RequestContext::<ThisServer, SSL, DBG, H3>::on_resolve_stream(g, f),
    )
}
fn host_on_reject_stream<ThisServer, const SSL: bool, const DBG: bool, const H3: bool>(
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
        RequestContext::<ThisServer, SSL, DBG, H3>::on_reject_stream(g, f),
    )
}

impl<ThisServer, const SSL: bool, const DBG: bool, const H3: bool> RequestContextHostFns
    for RequestContext<ThisServer, SSL, DBG, H3>
where
    ThisServer: ServerLike + 'static,
{
    // These consts must resolve to the *exported* `#[no_mangle]` symbols
    // (`Bun__HTTPRequestContext*__on*`), not the inner generic
    // `host_on_*::<..>` shims: the function-pointer value is what C++'s
    // `GlobalObject::promiseHandlerID` compares against (ZigGlobalObject.cpp),
    // and the exported wrapper has a different address from the generic it
    // forwards to. The Zig spec gets this for free because `@export` re-labels
    // the existing fn; in Rust we route through a const-fn lookup keyed on the
    // (SSL, DEBUG, H3) tuple so the blanket impl can name concrete exports.
    const ON_RESOLVE: bun_jsc::JSHostFn = exported_host_fns(SSL, DBG, H3).0;
    const ON_REJECT: bun_jsc::JSHostFn = exported_host_fns(SSL, DBG, H3).1;
    const ON_RESOLVE_STREAM: bun_jsc::JSHostFn = exported_host_fns(SSL, DBG, H3).2;
    const ON_REJECT_STREAM: bun_jsc::JSHostFn = exported_host_fns(SSL, DBG, H3).3;
}

impl<ThisServer, const SSL_ENABLED: bool, const DEBUG_MODE: bool, const HTTP3: bool>
    RequestContext<ThisServer, SSL_ENABLED, DEBUG_MODE, HTTP3>
where
    ThisServer: ServerLike + 'static,
{
    const RESP_KIND: uws::ResponseKind = uws::ResponseKind::from(SSL_ENABLED, HTTP3);

    /// Reborrow the owning server. `server` is a BACKREF (LIFETIMES.tsv): set
    /// at construction in `init()` from the `NewServer` that owns the request
    /// pool, never null while the `RequestContext` is live, and the server
    /// outlives every `RequestContext` it allocates. Centralises the
    /// per-call-site backref deref behind the `bun_ptr::BackRef` field.
    ///
    /// Returned lifetime is **decoupled** from `&self` (unbounded `'r`): the
    /// server is not a sub-field of `RequestContext` (it owns the pool the
    /// context lives in), so callers may hold `&ThisServer` across `&mut self`
    /// reborrows of disjoint `RequestContext` fields — exactly the pattern the
    /// raw `*const ThisServer` field was used for.
    #[inline]
    pub fn server<'r>(&self) -> &'r ThisServer {
        // SAFETY: BACKREF — `server` is `Some(non-null)` after `init()` and
        // the pointee `NewServer` outlives this context (it owns the pool).
        // `'r` may exceed `&self` because the server is not borrowed from
        // `*self`; it lives independently and outlives every context.
        let p = self.server.expect("infallible: server bound").as_ptr();
        unsafe { &*p }
    }

    /// Mutably borrow the pooled request-body slot, if attached.
    ///
    /// Returns an unbounded `&'r mut` because the slot is a separate
    /// `HiveArray` allocation, **not** a sub-field of `*self`, so callers may
    /// hold it across disjoint `&self`/`&mut self` reborrows of other
    /// `RequestContext` fields (same pattern as [`server()`]). Replaces the
    /// per-site raw `NonNull::as_mut` deref at each state-machine site.
    ///
    /// # Safety (encapsulated)
    /// While `Some`, `request_body` points to a pooled `HiveRef<Body::Value>`
    /// slot whose lifetime is governed by the intrusive ref this context holds
    /// (released via [`request_body_take_unref`] in `deinit()` /
    /// `on_buffered_body_chunk` last-chunk path). The slot is single-threaded
    /// and never aliased from outside this `RequestContext`, so forming a
    /// unique `&mut` for the duration of the caller's use is sound.
    #[inline]
    fn request_body_mut<'r>(&mut self) -> Option<&'r mut Body::Value> {
        // SAFETY: see fn doc — pooled HiveRef slot live while `Some`,
        // unaliased, single-threaded.
        self.request_body.map(|mut p| unsafe { p.as_mut() })
    }

    /// Exclusive borrow of the heap [`ResponseStreamJSSink`] this context owns.
    ///
    /// Returns an unbounded `&'r mut` because the sink is a separate heap
    /// allocation (`heap::alloc` in [`do_render_stream`]), **not** a sub-field
    /// of `*self`, so callers may hold it across disjoint `&self`/`&mut self`
    /// reborrows (same pattern as [`request_body_mut`]). Replaces the per-site
    /// raw `NonNull` deref.
    ///
    /// # Safety (encapsulated)
    /// While `Some`, `sink` points to the JSSink allocated by
    /// `do_render_stream`; this `RequestContext` is its sole owner until
    /// [`destroy_sink`] consumes it. Single-threaded — no other `&mut` alias.
    #[inline]
    fn sink_mut<'r>(&mut self) -> Option<&'r mut ResponseStreamJSSink<SSL_ENABLED, HTTP3>> {
        // SAFETY: see fn doc — heap JSSink owned by this ctx, sole live
        // mutable view, single-threaded.
        self.sink.map(|p| unsafe { &mut *p.as_ptr() })
    }

    /// Take the pooled request-body slot out of `self` and release the
    /// intrusive ref this context held on it (returns it to the hive when
    /// last). Mirrors the Zig `body.unref()` on `deinit` / final body chunk.
    #[inline]
    fn request_body_take_unref(&mut self) {
        if let Some(mut p) = self.request_body.take() {
            // SAFETY: pointee is the pooled `HiveRef` slot allocated by
            // `init_request_body_value`; live until this `unref()` drops the
            // last count. `Body::Value` reachable from `request_body` is
            // always the `.value` field of a hive slot, satisfying `unref`'s
            // container-of precondition.
            let _ = unsafe { p.as_mut().unref() };
        }
    }

    pub fn set_signal_aborted(&mut self, reason: jsc::CommonAbortReason) {
        if let Some(signal) = &self.signal {
            if let Some(server) = self.server {
                // server is a BACKREF — valid while this RequestContext is alive
                let global = server.global_this();
                shim::signal_fire(signal, global, reason);
            }
        }
    }

    fn drain_microtasks(&self) {
        if self.is_async() {
            return;
        }
        if let Some(server) = self.server {
            // SAFETY: BACKREF. `ServerLike::vm()` returns `&VirtualMachine`
            // but `drain_microtasks` needs `&mut`; cast through the raw
            // pointer (Zig held a `*VirtualMachine`).
            unsafe {
                let vm = std::ptr::from_ref::<VirtualMachine>((*server).vm()).cast_mut();
                (*vm).drain_microtasks();
            }
        }
    }

    pub fn set_abort_handler(&mut self) {
        if self.flags.has_abort_handler() {
            return;
        }
        if let Some(resp) = self.resp {
            self.flags.set_has_abort_handler(true);
            // SAFETY: FFI handle valid while resp is Some
            resp.on_aborted(Self::on_abort, self);
        }
    }

    pub fn set_cookies(&mut self, cookie_map: Option<*mut CookieMap>) {
        // S008: `CookieMap` is an `opaque_ffi!` ZST — safe `*const → &` deref.
        // `new_ref` takes a ref for storage. Assigning replaces (and so
        // drops/unrefs) the old one.
        self.cookies =
            cookie_map.map(|p| CookieMapRef::new_ref(bun_opaque::opaque_deref(p.cast_const())));
    }

    pub fn set_timeout_handler(&mut self) {
        if self.flags.has_timeout_handler() {
            return;
        }
        if let Some(resp) = self.resp {
            self.flags.set_has_timeout_handler(true);
            // SAFETY: FFI handle valid while resp is Some
            resp.on_timeout(Self::on_timeout, self);
        }
    }

    pub fn on_resolve(_global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        ctx_log!("onResolve");

        let arguments = callframe.arguments_old::<2>();
        let Some(ctx) = NativePromiseContext::take::<Self>(arguments.ptr[1]) else {
            // The cell's destructor already released the ref (the Promise
            // was collected before a prior microtask turn reached us).
            return Ok(JSValue::UNDEFINED);
        };
        let _ref = RequestContextRef(std::ptr::from_mut::<Self>(ctx));

        let result = arguments.ptr[0];
        result.ensure_still_alive();

        Self::handle_resolve(ctx, result);
        Ok(JSValue::UNDEFINED)
    }

    fn render_missing_invalid_response(&mut self, value: JSValue) {
        let class_name = value.get_class_info_name().unwrap_or(b"");

        if let Some(server) = self.server {
            // server is a BACKREF — valid while this RequestContext is alive
            let global_this: &JSGlobalObject = server.global_this();

            Output::enable_buffering();
            let writer = Output::error_writer();

            if class_name == b"Response" {
                bun_core::err_generic!(
                    "Expected a native Response object, but received a polyfilled Response object. Bun.serve() only supports native Response objects.",
                );
            } else if !value.is_empty() && !global_this.has_exception() {
                // TODO(port): jsc::ConsoleObject::Formatter has no Default;
                // JSValue::to_fmt lives on a trait not in scope here. Fall back
                // to the generic message until those land.
                let _ = value;
                bun_core::err_generic!("Expected a Response object");
            } else {
                bun_core::err_generic!("Expected a Response object");
            }

            Output::flush();
            if !global_this.has_exception() {
                let _ = writer;
                // TODO(port): write_trace wants `impl bun_io::Write`; Output::error_writer()
                // returns a raw `*mut Writer`. Skip the JS stack trace for now.
            }
            Output::flush();
        }
        self.render_missing();
    }

    fn handle_resolve(ctx: &mut Self, value: JSValue) {
        if ctx.is_aborted_or_ended() || ctx.did_upgrade_web_socket() {
            return;
        }

        if ctx.server.is_none() {
            ctx.render_missing_invalid_response(value);
            return;
        }
        if value.is_empty_or_undefined_or_null() || !value.is_cell() {
            ctx.render_missing_invalid_response(value);
            return;
        }

        // SAFETY: sole `&mut Response` for this cell in scope; `value` is
        // protect()'d immediately below and stored in `response_jsvalue`.
        let Some(response) = (unsafe { as_response(value) }) else {
            ctx.render_missing_invalid_response(value);
            return;
        };
        ctx.response_jsvalue = value;
        debug_assert!(!ctx.flags.response_protected());
        ctx.flags.set_response_protected(true);
        value.protect();

        if ctx.method == Method::HEAD {
            if let Some(resp) = ctx.resp {
                let mut pair = HeaderResponsePair {
                    this: ctx,
                    response,
                };
                resp.run_corked_with_type(Self::do_render_head_response, &raw mut pair);
            }
            return;
        }

        ctx.render(response);
    }

    pub fn should_render_missing(&self) -> bool {
        // If we did not respond yet, we should render missing
        // To allow this all the conditions above should be true:
        // 1 - still has a response (not detached)
        // 2 - not aborted
        // 3 - not marked completed
        // 4 - not marked pending
        // 5 - is the only reference of the context
        // 6 - is not waiting for request body
        // 7 - did not call sendfile
        ctx_log!(
            "RequestContext(0x{:x}).shouldRenderMissing {} {} {} {} {} {} {}",
            std::ptr::from_ref(self) as usize,
            if self.resp.is_some() {
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
            if self.ref_count == 1 {
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
        self.resp.is_some()
            && !self.flags.aborted()
            && !self.flags.has_marked_complete()
            && !self.flags.has_marked_pending()
            && self.ref_count == 1
            && !self.flags.is_waiting_for_request_body()
            && !self.flags.has_sendfile_ctx()
    }

    pub fn is_dead_request(&self) -> bool {
        // check if has pending promise or extra reference (aka not the only reference)
        if self.ref_count > 1 {
            return false;
        }
        // check if the body is Locked (streaming)
        if let Some(body) = self.request_body {
            // Pooled HiveRef slot is live while held (see deinit()) — satisfies
            // the `BackRef` outlives-holder invariant for this read.
            let body = bun_ptr::BackRef::from(body);
            if matches!(&*body, Body::Value::Locked(_)) {
                return false;
            }
        }

        true
    }

    /// destroy RequestContext, should be only called by deref or if defer_deinit_until_callback_completes is ref is set to true
    // TODO(port): named `deinit` (not Drop) because RequestContext is pool-allocated and
    // explicitly returned to a HiveArray; Drop semantics don't apply.
    pub fn deinit(&mut self) {
        ctx_log!("deinit");
        self.detach_response();
        self.end_request_streaming_and_drain();
        // TODO: has_marked_complete is doing something?
        self.flags.set_has_marked_complete(true);

        if let Some(defer_deinit) = self.defer_deinit_until_callback_completes {
            defer_deinit.set(true);
            ctx_log!("deferred deinit <d> ({:p})<r>", self);
            return;
        }

        ctx_log!("deinit<d> ({:p})<r>", self);
        if cfg!(debug_assertions) {
            debug_assert!(self.flags.has_finalized());
        }

        self.request_body_buf = Vec::new();
        self.response_buf_owned = Vec::new();
        self.response_weakref.deref();

        self.request_body_take_unref();

        if let Some(cb) = self.additional_on_abort.take() {
            cb.deref();
        }

        if let Some(server) = self.server.take() {
            // server is a BACKREF; pool put + onRequestComplete
            server
                .release_request_context(std::ptr::from_mut::<Self>(self).cast::<c_void>(), HTTP3);
            // SAFETY: `&mut` through the backref — the server outlives this
            // context and no other borrow of it is live here.
            unsafe { (*server.as_ptr()).on_request_complete() };
        }
    }

    pub fn deref(&mut self) {
        stream_log!("deref {} -> {}", self.ref_count, self.ref_count - 1);
        debug_assert!(self.ref_count > 0);
        let ref_count = self.ref_count;
        self.ref_count -= 1;
        if ref_count == 1 {
            self.finalize_without_deinit();
            self.deinit();
        }
    }

    pub fn ref_(&mut self) {
        stream_log!("ref {} -> {}", self.ref_count, self.ref_count + 1);
        self.ref_count += 1;
    }

    // TODO(port): #[bun_jsc::host_fn] — see note on `on_resolve`.
    pub fn on_reject(_global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        ctx_log!("onReject");

        let arguments = callframe.arguments_old::<2>();
        let Some(ctx) = NativePromiseContext::take::<Self>(arguments.ptr[1]) else {
            // The cell's destructor already released the ref (the Promise
            // was collected before a prior microtask turn reached us).
            return Ok(JSValue::UNDEFINED);
        };
        let _ref = RequestContextRef(std::ptr::from_mut::<Self>(ctx));

        let err = arguments.ptr[0];
        Self::handle_reject(
            ctx,
            if !err.is_empty_or_undefined_or_null() {
                err
            } else {
                JSValue::UNDEFINED
            },
        );
        Ok(JSValue::UNDEFINED)
    }

    fn handle_reject(ctx: &mut Self, value: JSValue) {
        if ctx.is_aborted_or_ended() {
            return;
        }

        let resp = ctx.resp.expect("infallible: resp bound");
        // SAFETY: FFI handle, just checked Some
        let has_responded = resp.has_responded();
        if !has_responded {
            let original_state = ctx.defer_deinit_until_callback_completes;
            let should_deinit_context = core::cell::Cell::new(match original_state {
                // BackRef::get() → &Cell<bool>; second .get() reads the bool.
                Some(defer_deinit) => defer_deinit.get().get(),
                None => false,
            });
            ctx.defer_deinit_until_callback_completes =
                Some(bun_ptr::BackRef::new(&should_deinit_context));
            ctx.run_error_handler(value);
            ctx.defer_deinit_until_callback_completes = original_state;
            // we try to deinit inside runErrorHandler so we just return here and let it deinit
            if should_deinit_context.get() {
                ctx.deinit();
                return;
            }
        }
        // check again in case it get aborted after runErrorHandler
        if ctx.is_aborted_or_ended() {
            return;
        }

        // I don't think this case happens?
        if ctx.did_upgrade_web_socket() {
            return;
        }

        // SAFETY: FFI handle
        if !resp.has_responded()
            && !ctx.flags.has_marked_pending()
            && !ctx.flags.is_error_promise_pending()
        {
            ctx.render_missing();
            return;
        }
    }

    pub fn render_missing(&mut self) {
        if let Some(resp) = self.resp {
            resp.run_corked_with_type(Self::render_missing_corked, self);
        }
    }

    pub fn render_missing_corked(ctx: *mut Self) {
        // SAFETY: ctx is the live RequestContext threaded through cork user-data.
        let ctx = unsafe { &mut *ctx };
        if let Some(resp) = ctx.resp {
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
                ctx.end(WELCOME_PAGE_HTML_GZ, ctx.should_close_connection());
                return;
            }
            const MISSING_CONTENT: &[u8] =
                b"Welcome to Bun! To get started, return a Response object.";
            resp.write_status(b"200 OK");
            resp.write_header(b"content-type", &bun_http_types::MimeType::TEXT.value);
            resp.write_header_int(b"content-length", MISSING_CONTENT.len() as u64);
            ctx.flags.set_has_written_status(true);
            ctx.end(MISSING_CONTENT, ctx.should_close_connection());
        }
    }

    // TODO(b2-blocked): `Api::FallbackMessageContainer` + `Fallback::render_backend`
    // (bun_options_types::schema::api / bun_ast::runtime) — debug-only HTML
    // error page. Production hits `render_production_error` instead.

    pub fn render_default_error(
        &mut self,
        // TODO(port): arena_allocator param dropped; this is a non-AST crate, allocations use global mimalloc.
        // PERF(port): was arena bulk-free — profile in Phase B
        log: &mut bun_ast::Log,
        err: bun_core::Error,
        exceptions: &[Api::JsException],
        fmt: core::fmt::Arguments<'_>, // TODO(port): Zig `comptime fmt: string, args: anytype`
    ) {
        if !self.flags.has_written_status() {
            self.flags.set_has_written_status(true);
            if let Some(resp) = self.resp {
                // SAFETY: FFI handle
                unsafe {
                    resp.write_status(b"500 Internal Server Error");
                    resp.write_header(b"content-type", &bun_http_types::MimeType::HTML.value);
                }
            }
        }

        let mut message: Vec<u8> = Vec::new();
        let _ = write!(&mut message, "{}", Output::pretty_fmt::<false>(fmt));
        let cwd = bun_resolver::fs::FileSystem::get().top_level_dir;
        let fallback_container = Box::new(Api::FallbackMessageContainer {
            message: Some(message.into_boxed_slice()),
            router: None,
            reason: Some(Api::FallbackStep::fetch_event_handler),
            cwd: Some(cwd.to_vec().into_boxed_slice()),
            problems: Some(Api::Problems {
                // Zig: `@truncate(@intFromError(err))`.
                code: err.as_u16(),
                name: err.name().as_bytes().to_vec().into_boxed_slice(),
                exceptions: exceptions.to_vec(),
                build: {
                    // `log.to_api()` returns `bun_ast::api::Log`; the schema
                    // crate has its own `api::Log` (msgs omitted). Map fields.
                    let api_log = log.to_api();
                    Api::Log {
                        warnings: api_log.warnings,
                        errors: api_log.errors,
                    }
                },
            }),
        });

        // TODO(port): `if (comptime fmt.len > 0)` — fmt::Arguments has no const len; always print.
        Output::pretty_errorln(fmt);
        Output::flush();

        // Explicitly use the global allocator and *not* the arena
        let mut bb: Vec<u8> = Vec::new();

        Fallback::render_backend(&fallback_container, &mut bb).expect("unreachable");
        let try_end_ok = match self.resp {
            None => true,
            Some(resp) => unsafe {
                // SAFETY: FFI handle
                resp.try_end(&bb, bb.len(), self.should_close_connection())
            },
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
        self.response_buf_owned = bb;

        if let Some(resp) = self.resp {
            // SAFETY: FFI handle
            resp.on_writable(Self::on_writable_complete_response_buffer, self);
        }
    }

    pub fn render_response_buffer(&mut self) {
        if let Some(resp) = self.resp {
            // SAFETY: FFI handle
            resp.on_writable(Self::on_writable_response_buffer, self);
        }
    }

    fn drain_response_buffer_and_metadata_corked(this: *mut Self) {
        // SAFETY: this is the live RequestContext threaded through cork user-data.
        unsafe { (*this).drain_response_buffer_and_metadata() };
    }

    /// Drain a partial response buffer
    pub fn drain_response_buffer_and_metadata(&mut self) {
        if let Some(resp) = self.resp {
            self.render_metadata();

            // SAFETY: FFI handle
            resp.write(&self.response_buf_owned);
        }
        self.response_buf_owned.clear();
    }

    pub fn end(&mut self, data: &[u8], close_connection: bool) {
        ctx_log!("end");
        if let Some(resp) = self.resp {
            self.detach_response();
            self.end_request_streaming_and_drain();
            // SAFETY: FFI handle
            resp.end(data, close_connection);
            // No early returns above; explicit deref instead of a scopeguard
            // that would alias `&mut self` through a captured raw pointer.
            self.deref();
        }
    }

    pub fn end_stream(&mut self, close_connection: bool) {
        ctx_log!("endStream");
        if let Some(resp) = self.resp {
            self.detach_response();
            self.end_request_streaming_and_drain();
            // This will send a terminating 0\r\n\r\n chunk to the client
            // We only want to do that if they're still expecting a body
            // We cannot call this function if the Content-Length header was previously set
            // SAFETY: FFI handle
            unsafe {
                if resp.state().is_response_pending() {
                    resp.end_stream(close_connection);
                }
            }
            // No early returns above; explicit deref instead of a scopeguard
            // that would alias `&mut self` through a captured raw pointer.
            self.deref();
        }
    }

    pub fn end_without_body(&mut self, close_connection: bool) {
        ctx_log!("endWithoutBody");
        if let Some(resp) = self.resp {
            self.detach_response();
            self.end_request_streaming_and_drain();
            // SAFETY: FFI handle
            resp.end_without_body(close_connection);
            // No early returns above; explicit deref instead of a scopeguard
            // that would alias `&mut self` through a captured raw pointer.
            self.deref();
        }
    }

    pub fn force_close(&mut self) {
        if let Some(resp) = self.resp {
            self.detach_response();
            self.end_request_streaming_and_drain();
            // SAFETY: FFI handle
            resp.force_close();
            // No early returns above; explicit deref instead of a scopeguard
            // that would alias `&mut self` through a captured raw pointer.
            self.deref();
        }
    }

    pub fn on_writable_response_buffer(
        this: *mut Self,
        _write_offset: u64,
        _resp: uws::AnyResponse,
    ) -> bool {
        ctx_log!("onWritableResponseBuffer");
        // SAFETY: uWS guarantees the user-data ptr is the live RequestContext.
        let this = unsafe { &mut *this };
        debug_assert!(this.resp.is_some());
        if this.is_aborted_or_ended() {
            return false;
        }
        this.end(b"", this.should_close_connection());
        false
    }

    // TODO: should we cork?
    pub fn on_writable_complete_response_buffer_and_metadata(
        this: *mut Self,
        write_offset: u64,
        resp: uws::AnyResponse,
    ) -> bool {
        ctx_log!("onWritableCompleteResponseBufferAndMetadata");
        // SAFETY: uWS guarantees the user-data ptr is the live RequestContext.
        let this = unsafe { &mut *this };
        debug_assert!(this.resp.is_some());

        if this.is_aborted_or_ended() {
            return false;
        }

        if !this.flags.has_written_status() {
            this.render_metadata();
        }

        if this.method == Method::HEAD {
            this.end_without_body(this.should_close_connection());
            return false;
        }

        this.send_writable_bytes_for_complete_response_buffer(write_offset, resp)
    }

    pub fn on_writable_complete_response_buffer(
        this: *mut Self,
        write_offset: u64,
        resp: uws::AnyResponse,
    ) -> bool {
        ctx_log!("onWritableCompleteResponseBuffer");
        // SAFETY: uWS guarantees the user-data ptr is the live RequestContext.
        let this = unsafe { &mut *this };
        debug_assert!(this.resp.is_some());
        if this.is_aborted_or_ended() {
            return false;
        }
        this.send_writable_bytes_for_complete_response_buffer(write_offset, resp)
    }

    #[inline]
    fn any_response(r: *mut Resp<SSL_ENABLED, HTTP3>) -> uws::AnyResponse {
        if HTTP3 {
            uws::AnyResponse::H3(r.cast::<bun_uws_sys::h3::Response>())
        } else if SSL_ENABLED {
            uws::AnyResponse::SSL(r.cast::<bun_uws_sys::NewAppResponse<true>>())
        } else {
            uws::AnyResponse::TCP(r.cast::<bun_uws_sys::NewAppResponse<false>>())
        }
    }

    #[inline]
    fn any_request(r: *mut Req<SSL_ENABLED, HTTP3>) -> uws::AnyRequest {
        if HTTP3 {
            uws::AnyRequest::H3(r.cast::<bun_uws_sys::h3::Request>())
        } else {
            uws::AnyRequest::H1(r.cast::<bun_uws_sys::Request>())
        }
    }

    #[inline]
    fn req_method(r: *mut Req<SSL_ENABLED, HTTP3>) -> &'static [u8] {
        // SAFETY: r is a live uWS/lsquic request handle for the duration of
        // the request callback; both surfaces return request-owned slices.
        unsafe {
            if HTTP3 {
                (*r.cast::<bun_uws_sys::h3::Request>()).method()
            } else {
                (*r.cast::<bun_uws_sys::Request>()).method()
            }
        }
    }

    #[inline]
    fn req_url(r: *mut Req<SSL_ENABLED, HTTP3>) -> &'static [u8] {
        // SAFETY: see `req_method`.
        unsafe {
            if HTTP3 {
                (*r.cast::<bun_uws_sys::h3::Request>()).url()
            } else {
                (*r.cast::<bun_uws_sys::Request>()).url()
            }
        }
    }

    // TODO(port): in-place init — `this` is a pre-allocated slot in a HiveArray pool.
    pub fn create(
        this: &mut core::mem::MaybeUninit<Self>,
        server: *const ThisServer,
        req: *mut Req<SSL_ENABLED, HTTP3>,
        resp: uws::AnyResponse,
        should_deinit_context: Option<DeferDeinitFlag>,
        method: Option<Method>,
    ) {
        let resolved_method = method
            .or_else(|| Method::which(Self::req_method(req)))
            .unwrap_or(Method::GET);
        // SAFETY: writing to MaybeUninit slot
        unsafe {
            this.as_mut_ptr().write(Self {
                resp: Some(resp),
                req: Some(req),
                method: resolved_method,
                server: NonNull::new(server.cast_mut()).map(bun_ptr::BackRef::from),
                defer_deinit_until_callback_completes: should_deinit_context,
                range: RangeRequest::raw_from_request(&Self::any_request(req)),
                request_weakref: request::WeakRef::EMPTY,
                signal: None,
                cookies: None,
                flags: Flags::<DEBUG_MODE>::default(),
                upgrade_context: None,
                response_jsvalue: JSValue::ZERO,
                ref_count: 1,
                response_weakref: response::WeakRef::EMPTY,
                blob: AnyBlob::Blob(Blob::default()),
                sendfile: SendfileContext::default(),
                request_body_readable_stream_ref: readable_stream::Strong::default(),
                request_body: None,
                request_body_buf: Vec::new(),
                request_body_content_len: 0,
                sink: None,
                byte_stream: None,
                response_body_readable_stream_ref: readable_stream::Strong::default(),
                pathname: BunString::empty(),
                response_buf_owned: Vec::new(),
                additional_on_abort: None,
            });
        }

        ctx_log!("create<d> ({:p})<r>", this.as_ptr());
    }

    pub fn on_timeout(this: *mut Self, _resp: uws::AnyResponse) {
        // SAFETY: uWS guarantees the user-data ptr is the live RequestContext.
        let this = unsafe { &mut *this };
        debug_assert!(this.resp.is_some());
        debug_assert!(this.server.is_some());

        let any_js_calls = core::cell::Cell::new(false);
        // SAFETY: BACKREF, just asserted Some
        let server = this.server();
        let _ = server.vm();
        let global_this = server.global_this();
        // This is a task in the event loop.
        // If we called into JavaScript, we must drain the microtask queue.
        scopeguard::defer! {
            if any_js_calls.get() {
                VirtualMachine::get().as_mut().drain_microtasks();
            }
        }

        if let Some(request) = this.request_weakref.get() {
            if shim::iec_trigger(
                &request.internal_event_callback,
                request::EventType::Timeout,
                global_this,
            ) {
                any_js_calls.set(true);
            }
        }
    }

    pub fn on_abort(this: *mut Self, resp: uws::AnyResponse) {
        ctx_log!("onAbort");
        // SAFETY: uWS guarantees the user-data ptr is the live RequestContext.
        let this = unsafe { &mut *this };
        debug_assert!(this.resp.is_some());
        // An HTTP/3 stream is destroyed once both sides FIN, so this also
        // fires after a successful end(). HTTP/1 sockets persist for
        // keep-alive, so the equivalent never happens there. Drop the
        // pointer; everything else cleans up via the resolve/reject path.
        if HTTP3 {
            // SAFETY: FFI handle
            if resp.has_responded() {
                this.resp = None;
                this.flags.set_has_abort_handler(false);
                return;
            }
        }
        debug_assert!(!this.flags.aborted());
        debug_assert!(this.server.is_some());
        // mark request as aborted
        this.flags.set_aborted(true);
        if let Some(abort) = this.additional_on_abort.take() {
            (abort.cb)(abort.data.as_ptr());
            abort.deref();
        }

        this.detach_response();
        let any_js_calls = core::cell::Cell::new(false);
        // SAFETY: BACKREF, just asserted Some
        let server = this.server();
        let vm = std::ptr::from_ref::<VirtualMachine>(server.vm()).cast_mut();
        let global_this = server.global_this();
        // Drop one ref on every exit path. Declared before the microtask drain
        // so it runs *after* (LIFO) — matches Zig `defer this.deref()` ordered
        // after `defer drainMicrotasks()`.
        let _ref = RequestContextRef(std::ptr::from_mut::<Self>(this));
        // This is a task in the event loop.
        // If we called into JavaScript, we must drain the microtask queue.
        scopeguard::defer! {
            if any_js_calls.get() {
                // SAFETY: vm is live for the request duration.
                unsafe { (*vm).drain_microtasks() };
            }
        }

        if let Some(request) = this.request_weakref.get() {
            request.request_context = AnyRequestContext::NULL;
            if shim::iec_trigger(
                &request.internal_event_callback,
                request::EventType::Abort,
                global_this,
            ) {
                any_js_calls.set(true);
            }
            // we can already clean this strong refs
            shim::iec_deinit(&request.internal_event_callback);
            this.request_weakref.deref();
        }
        // if signal is not aborted, abort the signal
        if let Some(signal) = this.signal.take() {
            if !shim::signal_aborted(&signal) {
                shim::signal_fire(
                    &signal,
                    global_this,
                    jsc::CommonAbortReason::ConnectionClosed,
                );
                any_js_calls.set(true);
            }
            shim::signal_release(signal);
        }

        // if have sink, call onAborted on sink
        if let Some(wrapper) = this.sink_mut() {
            wrapper.sink.abort();
            return;
        }

        // if we can, free the request now.
        if this.is_dead_request() {
            this.finalize_without_deinit();
        } else {
            if this.end_request_streaming().unwrap_or(true) {
                // TODO: properly propagate exception upwards
                any_js_calls.set(true);
            }

            if let Some(response) = this.response_weakref.get() {
                if let Some(stream) = shim::response_body_stream(response, global_this) {
                    let _keep = jsc::EnsureStillAlive(stream.value);
                    shim::response_detach_stream(response, global_this);
                    stream.abort(global_this);
                    any_js_calls.set(true);
                }
            }
        }
    }

    // This function may be called multiple times
    // so it's important that we can safely do that
    pub fn finalize_without_deinit(&mut self) {
        ctx_log!("finalizeWithoutDeinit<d> ({:p})<r>", self);
        self.blob.detach();
        debug_assert!(self.server.is_some());
        // SAFETY: BACKREF
        let global_this = self.server().global_this();

        #[cfg(debug_assertions)]
        {
            ctx_log!(
                "finalizeWithoutDeinit: has_finalized {}",
                self.flags.has_finalized()
            );
            self.flags.set_has_finalized(true);
        }

        if !self.response_jsvalue.is_empty() {
            ctx_log!("finalizeWithoutDeinit: response_jsvalue != .zero");
            if self.flags.response_protected() {
                self.response_jsvalue.unprotect();
                self.flags.set_response_protected(false);
            }
            self.response_jsvalue = JSValue::ZERO;
        }
        self.response_weakref.deref();

        self.request_body_readable_stream_ref.deinit();

        // Releases the ref taken in `set_cookies` (via `CookieMapRef::drop`).
        drop(self.cookies.take());

        if let Some(request) = self.request_weakref.get() {
            request.request_context = AnyRequestContext::NULL;
            // we can already clean this strong refs
            shim::iec_deinit(&request.internal_event_callback);
            self.request_weakref.deref();
        }

        // if signal is not aborted, abort the signal
        if let Some(signal) = self.signal.take() {
            if self.flags.aborted() && !shim::signal_aborted(&signal) {
                shim::signal_fire(
                    &signal,
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

        self.response_body_readable_stream_ref.deinit();

        if !self.pathname.is_empty() {
            self.pathname.deref();
            self.pathname = BunString::empty();
        }
    }

    fn on_file_stream_complete(ctx: *mut c_void, _resp: uws::AnyResponse) {
        // SAFETY: ctx is a *RequestContext registered with FileResponseStream
        let this: &mut Self = unsafe { bun_ptr::callback_ctx::<Self>(ctx) };
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

    pub fn on_writable_bytes(this: *mut Self, write_offset: u64, resp: uws::AnyResponse) -> bool {
        ctx_log!("onWritableBytes");
        // SAFETY: uWS guarantees the user-data ptr is the live RequestContext.
        let this = unsafe { &mut *this };
        debug_assert!(this.resp.is_some());
        if this.is_aborted_or_ended() {
            return false;
        }

        // Copy to stack memory to prevent aliasing issues in release builds
        // PORT NOTE: AnyBlob is not Copy in Rust; reborrow through a raw ptr
        // so the slice borrow doesn't conflict with `&mut self` below.
        let bytes: &[u8] = unsafe { bun_ptr::detach_lifetime(this.blob.slice()) };

        let _ = this.send_writable_bytes_for_blob(bytes, write_offset, resp);
        true
    }

    pub fn send_writable_bytes_for_blob(
        &mut self,
        bytes_: &[u8],
        write_offset_: u64,
        resp: uws::AnyResponse,
    ) -> bool {
        debug_assert!(self.resp.is_some());
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
            resp.on_writable(Self::on_writable_bytes, self);
            true
        }
    }

    pub fn send_writable_bytes_for_complete_response_buffer(
        &mut self,
        write_offset_: u64,
        resp: uws::AnyResponse,
    ) -> bool {
        let write_offset: usize = write_offset_ as usize;
        debug_assert!(self.resp.is_some());

        // The bytes always come from `self.response_buf_owned`; reading them
        // through `&mut self` here (instead of taking a `&[u8]` parameter that
        // aliases the same Vec) avoids holding a live shared borrow of the
        // buffer across the `clear()` below — which would be UB under
        // Stacked Borrows even though the slice is not read after the clear.
        let close_connection = self.should_close_connection();
        let total_len = self.response_buf_owned.len();
        let bytes = &self.response_buf_owned[total_len.min(write_offset)..];
        // SAFETY: FFI handle
        let done = resp.try_end(bytes, total_len, close_connection);
        if done {
            self.response_buf_owned.clear();
            self.detach_response();
            self.end_request_streaming_and_drain();
            self.deref();
        } else {
            self.flags.set_has_marked_pending(true);
            // SAFETY: FFI handle
            resp.on_writable(Self::on_writable_complete_response_buffer, self);
        }

        true
    }

    pub fn do_sendfile(&mut self, blob: Blob) {
        if self.is_aborted_or_ended() {
            return;
        }
        if self.flags.has_sendfile_ctx() {
            return;
        }

        if self.resp.is_none() || self.server.is_none() {
            return;
        }
        // SAFETY: BACKREF
        let global_this = self.server().global_this();
        let resp = self.resp.expect("infallible: resp bound");

        self.blob = AnyBlob::Blob(blob);
        let crate::webcore::blob::store::Data::File(file) = &self.blob.store().unwrap().data else {
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
                // TODO(port): Zig `withPathLike(file.pathlike)` also sets
                // `.fd` for the Fd arm; `bun_sys::Error` only carries a path
                // slice, so render the fd as bytes for the error path.
                let js_err = match &file.pathlike {
                    crate::webcore::node_types::PathOrFileDescriptor::Path(p) => {
                        err.with_path(p.slice()).to_js(global_this)
                    }
                    crate::webcore::node_types::PathOrFileDescriptor::Fd(_) => {
                        err.to_js(global_this)
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
                // TODO(port): Zig `withPathLike(file.pathlike)` also sets `.fd`
                // for the Fd arm; `bun_sys::Error::with_path` only carries a
                // path slice, so the fd arm gets no path attached.
                let path_bytes: &[u8] = match &file.pathlike {
                    crate::webcore::node_types::PathOrFileDescriptor::Path(p) => p.slice(),
                    crate::webcore::node_types::PathOrFileDescriptor::Fd(_) => b"",
                };
                let mut sys: jsc::SystemError = bun_sys::Error {
                    errno: bun_sys::E::EISDIR as _,
                    syscall: bun_sys::Tag::read,
                    ..Default::default()
                }
                .with_path(path_bytes)
                .to_system_error()
                .into();
                sys.message = BunString::static_("Cannot stream a directory as a response body");
                return self.run_error_handler(sys.to_error_instance(global_this));
            }
            (bun_io::FileType::File, false)
        };

        let original_size = match &self.blob {
            AnyBlob::Blob(b) => b.size.get(),
            _ => unreachable!(),
        };
        let stat_size: BlobSizeType = BlobSizeType::try_from(stat.st_size.max(0)).unwrap();
        if let AnyBlob::Blob(b) = &mut self.blob {
            b.size.set(if is_regular {
                stat_size
            } else {
                original_size.min(stat_size)
            });
        }

        self.flags.set_needs_content_length(true);
        let blob_offset = match &self.blob {
            AnyBlob::Blob(b) => b.offset.get(),
            _ => unreachable!(),
        };
        self.sendfile = SendfileContext {
            remain: blob_offset + original_size,
            offset: blob_offset,
            total: 0,
        };
        if is_regular && auto_close {
            self.flags.set_needs_content_range(
                self.sendfile.remain.saturating_sub(self.sendfile.offset) != stat_size,
            );
        }
        if is_regular {
            self.sendfile.offset = self.sendfile.offset.min(stat_size);
            self.sendfile.remain = self
                .sendfile
                .remain
                .max(self.sendfile.offset)
                .min(stat_size)
                .saturating_sub(self.sendfile.offset);
        }

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
        let user_handles_range = if let Some(r) = self.response_weakref.get() {
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
                    self.sendfile.offset = BlobSizeType::try_from(start).unwrap();
                    self.sendfile.remain = BlobSizeType::try_from(end - start + 1).unwrap();
                    self.sendfile.total = stat_size;
                    self.flags.set_needs_content_range(true);
                }
                RangeRequest::Result::Unsatisfiable => {
                    if auto_close {
                        fd.close();
                    }
                    let mut crbuf = [0u8; RangeRequest::CONTENT_RANGE_BUF];
                    self.do_write_status(416);
                    if let Some(response) = self.response_weakref.get() {
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
                    // SAFETY: FFI handle
                    unsafe {
                        resp.write_header(b"content-range", cr);
                        resp.write_header(b"accept-ranges", b"bytes");
                        let close = resp.should_close_connection();
                        self.detach_response();
                        self.end_request_streaming_and_drain();
                        resp.end(b"", close);
                    }
                    self.deref();
                    return;
                }
            }
        }

        resp.run_corked_with_type(Self::render_metadata_corked, self);

        if (is_regular && self.sendfile.remain == 0) || !self.method.has_body() {
            if auto_close {
                fd.close();
            }
            // SAFETY: FFI handle
            let close = resp.should_close_connection();
            self.detach_response();
            self.end_request_streaming_and_drain();
            // SAFETY: FFI handle
            resp.end(b"", close);
            self.deref();
            return;
        }

        // FileResponseStream registers its own onAborted/onWritable with itself
        // as userData. uWS keeps a single shared userData slot per response, so
        // any later setAbortHandler()/onWritable() from this RequestContext would
        // stomp it and hand FileResponseStream's callbacks a *RequestContext.
        self.flags.set_has_sendfile_ctx(true);
        self.flags.set_has_abort_handler(true);
        self.flags.set_has_marked_pending(true);

        // SAFETY: BACKREF
        let server = self.server();
        FileResponseStream::start(file_response_stream::StartOptions {
            fd,
            auto_close,
            resp,
            vm: bun_ptr::BackRef::new(server.vm()),
            file_type,
            pollable,
            offset: self.sendfile.offset as u64,
            length: if is_regular {
                Some(self.sendfile.remain as u64)
            } else {
                None
            },
            idle_timeout: server.config().idle_timeout,
            ctx: std::ptr::from_mut::<Self>(self).cast::<c_void>(),
            on_complete: Self::on_file_stream_complete,
            on_abort: Some(Self::on_file_stream_abort),
            on_error: Self::on_file_stream_error,
        });
    }

    pub fn do_render_with_body_locked(this: *mut c_void, value: &mut Body::Value) {
        // SAFETY: this is a *RequestContext registered as lock.task
        Self::do_render_with_body(unsafe { bun_ptr::callback_ctx::<Self>(this) }, value, None);
    }

    fn render_with_blob_from_body_value(&mut self) {
        if self.is_aborted_or_ended() {
            return;
        }

        if self.blob.needs_to_read_file() {
            if !self.flags.has_sendfile_ctx() {
                if let AnyBlob::Blob(b) =
                    core::mem::replace(&mut self.blob, AnyBlob::InternalBlob(Default::default()))
                {
                    self.do_sendfile(b);
                }
            }
            return;
        }

        self.do_render_blob();
    }

    fn handle_first_stream_write(this: &mut Self) {
        if !this.flags.has_written_status() {
            this.render_metadata();
        }
    }

    /// C-ABI thunk for `HTTPServerWritable::on_first_write` (`fn(?*anyopaque)`).
    fn handle_first_stream_write_thunk(ctx: Option<*mut c_void>) {
        let Some(ctx) = ctx else { return };
        // SAFETY: ctx is the *mut Self stashed in `sink.ctx` by do_render_stream;
        // the sink only fires this once before any concurrent borrow of `self`.
        Self::handle_first_stream_write(unsafe { bun_ptr::callback_ctx::<Self>(ctx) });
    }

    /// Tear down a heap `ResponseStreamJSSink` allocated by `do_render_stream`.
    /// Mirrors Zig `response_stream.detach(); response_stream.sink.destroy()` —
    /// JSSink<T> is `repr(transparent)` so the inner-ptr free matches the
    /// outer allocation.
    fn destroy_sink(ptr: NonNull<ResponseStreamJSSink<SSL_ENABLED, HTTP3>>) {
        // SAFETY: `ptr` was `heap::alloc`'d in do_render_stream and is being
        // consumed exactly once here. `JSSink<T>` is repr(transparent), so the
        // inner `HTTPServerWritable` shares the allocation Layout.
        ResponseStream::<SSL_ENABLED, HTTP3>::destroy(
            ptr.as_ptr().cast::<ResponseStream<SSL_ENABLED, HTTP3>>(),
        );
    }

    fn do_render_stream(pair: *mut StreamPair<'_, ThisServer, SSL_ENABLED, DEBUG_MODE, HTTP3>) {
        ctx_log!("doRenderStream");
        // SAFETY: pair is a stack local threaded through cork user-data.
        let pair = unsafe { &mut *pair };
        // PORT NOTE: reshaped for borrowck — split the two fields up front so
        // `this` and `stream` are independent borrows of `*pair`.
        let this: &mut Self = &mut *pair.this;
        let stream = &mut pair.stream;
        debug_assert!(this.server.is_some());
        // SAFETY: BACKREF
        let global_this = this.server().global_this();

        if this.is_aborted_or_ended() {
            stream.cancel(global_this);
            this.response_body_readable_stream_ref.deinit();
            return;
        }
        let resp = this.resp.expect("infallible: resp bound");

        stream.value.ensure_still_alive();

        // `HTTPServerWritable::res` stores the type-erased uws response handle;
        // `any_res()` reconstructs the variant from the const generics.
        let raw_res: *mut c_void = match resp {
            uws::AnyResponse::SSL(p) => p.cast::<c_void>(),
            uws::AnyResponse::TCP(p) => p.cast::<c_void>(),
            uws::AnyResponse::H3(p) => p.cast::<c_void>(),
        };

        let response_stream_box = Box::new(ResponseStreamJSSink::<SSL_ENABLED, HTTP3> {
            sink: ResponseStream::<SSL_ENABLED, HTTP3> {
                res: Some(raw_res),
                buffer: Vec::<u8>::default(),
                on_first_write: Some(Self::handle_first_stream_write_thunk),
                ctx: Some(std::ptr::from_mut::<Self>(this).cast::<c_void>()),
                global_this: Some(bun_ptr::BackRef::new(global_this)),
                ..Default::default()
            },
        });
        // PORT NOTE: reshaped for borrowck — own via raw ptr so `this.sink` and the
        // local `response_stream` view can coexist with `&mut *this` calls below.
        let response_stream_ptr = bun_core::heap::into_raw_nn(response_stream_box);
        this.sink = Some(response_stream_ptr);
        // SAFETY: just allocated; sole live mutable view (this.sink only stores the ptr).
        let response_stream = unsafe { &mut *response_stream_ptr.as_ptr() };

        response_stream.sink.signal = crate::webcore::sink::SinkSignal::<
            ResponseStream<SSL_ENABLED, HTTP3>,
        >::init(JSValue::ZERO);

        // explicitly set it to a dead pointer
        // we use this memory address to disable signals being sent
        response_stream.sink.signal.clear();
        debug_assert!(response_stream.sink.signal.is_dead());
        // we need to render metadata before assignToStream because the stream can call res.end
        // and this would auto write an 200 status
        if !this.flags.has_written_status() {
            this.render_metadata();
        }

        // We are already corked!
        // `Option<NonNull<c_void>>` is layout-compatible with `*mut c_void` (niche).
        let signal_ptr_slot = (&raw mut response_stream.sink.signal.ptr).cast::<*mut c_void>();
        let assignment_result: JSValue =
            ResponseStreamJSSink::<SSL_ENABLED, HTTP3>::assign_to_stream(
                global_this,
                stream.value,
                &mut response_stream.sink,
                signal_ptr_slot,
            );

        assignment_result.ensure_still_alive();

        // assert that it was updated
        debug_assert!(!response_stream.sink.signal.is_dead());

        #[cfg(debug_assertions)]
        if resp.has_responded() {
            stream_log!("responded");
        }

        let aborted = this.flags.aborted() || response_stream.sink.aborted;
        this.flags.set_aborted(aborted);

        if let Some(err_value) = assignment_result.to_error() {
            stream_log!("returned an error");
            ResponseStreamJSSink::<SSL_ENABLED, HTTP3>::detach(
                &mut response_stream.sink.signal,
                global_this,
            );
            this.sink = None;
            Self::destroy_sink(response_stream_ptr);
            return Self::handle_reject(this, err_value);
        }

        if resp.has_responded() {
            stream_log!("done");
            ResponseStreamJSSink::<SSL_ENABLED, HTTP3>::detach(
                &mut response_stream.sink.signal,
                global_this,
            );
            this.sink = None;
            Self::destroy_sink(response_stream_ptr);
            stream.done(global_this);
            this.response_body_readable_stream_ref.deinit();
            this.end_stream(this.should_close_connection());
            return;
        }

        // A fully-synchronous ReadableStream can drain through writeBytes
        // and reach endFromJS() inside assignToStream(). If tryEnd() then
        // hits transport backpressure (common on QUIC right after the
        // HEADERS frame), the sink parks a pending_flush promise and
        // registers onWritable, but assignToStream() itself returns
        // undefined. Surface that promise here so the request waits for
        // the drain instead of falling through to the cancel path below.
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
                this.drain_microtasks();

                match promise.status() {
                    jsc::js_promise::Status::Pending => {
                        stream_log!("promise still Pending");
                        if !this.flags.has_written_status() {
                            response_stream.sink.on_first_write = None;
                            response_stream.sink.ctx = None;
                            this.render_metadata();
                        }

                        // TODO: should this timeout?
                        let body_value = this.response_weakref.get().unwrap().get_body_value();
                        *body_value = Body::Value::Locked(Body::PendingValue {
                            readable: readable_stream::Strong::init(*stream, global_this),
                            global: std::ptr::from_ref(global_this),
                            ..Default::default()
                        });
                        this.ref_();
                        let cell = NativePromiseContext::create(global_this, this);
                        effective_result.then_with_value(
                            global_this,
                            cell,
                            Self::ON_RESOLVE_STREAM,
                            Self::ON_REJECT_STREAM,
                        ); // TODO: properly propagate exception upwards
                        // the response_stream should be GC'd
                    }
                    jsc::js_promise::Status::Fulfilled => {
                        stream_log!("promise Fulfilled");
                        let mut readable_ref =
                            core::mem::take(&mut this.response_body_readable_stream_ref);
                        // PORT NOTE: reshaped for borrowck — Zig `defer` runs
                        // after handle_resolve_stream; emulate by running the
                        // body first then the deferred cleanup.
                        Self::handle_resolve_stream(this);
                        stream.done(global_this);
                        readable_ref.deinit();
                    }
                    jsc::js_promise::Status::Rejected => {
                        stream_log!("promise Rejected");
                        let mut readable_ref =
                            core::mem::take(&mut this.response_body_readable_stream_ref);
                        Self::handle_reject_stream(
                            this,
                            global_this,
                            promise.result(global_this.vm()),
                        );
                        stream.cancel(global_this);
                        readable_ref.deinit();
                    }
                }
                return;
            } else {
                // if is not a promise we treat it as Error
                stream_log!("returned an error");
                ResponseStreamJSSink::<SSL_ENABLED, HTTP3>::detach(
                    &mut response_stream.sink.signal,
                    global_this,
                );
                this.sink = None;
                Self::destroy_sink(response_stream_ptr);
                return Self::handle_reject(this, effective_result);
            }
        }

        if this.is_aborted_or_ended() {
            ResponseStreamJSSink::<SSL_ENABLED, HTTP3>::detach(
                &mut response_stream.sink.signal,
                global_this,
            );
            stream.cancel(global_this);
            let mut readable_ref = core::mem::take(&mut this.response_body_readable_stream_ref);

            response_stream.sink.mark_done();
            response_stream.sink.on_first_write = None;

            response_stream.sink.finalize();
            this.sink = None;
            Self::destroy_sink(response_stream_ptr);
            readable_ref.deinit();
            return;
        }
        let mut readable_ref = core::mem::take(&mut this.response_body_readable_stream_ref);

        let is_in_progress = response_stream.sink.has_backpressure
            || !(response_stream.sink.wrote == 0 && response_stream.sink.buffer.len() == 0);

        if !stream.is_locked(global_this) && !is_in_progress {
            // TODO: properly propagate exception upwards
            if let Ok(Some(comparator)) =
                WebCore::ReadableStream::from_js(stream.value, global_this)
            {
                if core::mem::discriminant(&comparator.ptr) == core::mem::discriminant(&stream.ptr)
                {
                    stream_log!("is not locked");
                    response_stream.sink.on_first_write = None;
                    response_stream.sink.ctx = None;
                    ResponseStreamJSSink::<SSL_ENABLED, HTTP3>::detach(
                        &mut response_stream.sink.signal,
                        global_this,
                    );
                    response_stream.sink.mark_done();
                    response_stream.sink.finalize();
                    this.sink = None;
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
        ResponseStreamJSSink::<SSL_ENABLED, HTTP3>::detach(
            &mut response_stream.sink.signal,
            global_this,
        );
        stream.cancel(global_this);
        response_stream.sink.mark_done();
        response_stream.sink.finalize();
        this.sink = None;
        Self::destroy_sink(response_stream_ptr);
        readable_ref.deinit();
        this.render_missing();
    }

    pub fn did_upgrade_web_socket(&self) -> bool {
        self.upgrade_context
            .map(|p| p as usize == usize::MAX)
            .unwrap_or(false)
    }

    fn to_async_without_abort_handler(
        &mut self,
        req: *mut Req<SSL_ENABLED, HTTP3>,
        request_object: &mut Request,
    ) {
        debug_assert!(self.server.is_some());

        // For HTTP/3, prepareJsRequestContextFor() already eagerly
        // populated url+headers (the lazy getRequest() path is H1-only),
        // so the guards below short-circuit and `req` is never read.
        if !HTTP3 {
            // `Req<SSL,H3>` is erased to `c_void`; for !HTTP3 the concrete
            // type is `uws::Request`, so the cast is nominal.
            request_object
                .request_context
                .set_request(req.cast::<uws::Request>());
        }

        if request_object.ensure_url().is_err() {
            request_object.url.set(BunString::empty());
        }

        // we have to clone the request headers here since they will soon belong to a different request
        if !request_object.has_fetch_headers() {
            if !HTTP3 {
                // `HeadersRef::create_from_uws` adopts the freshly-allocated +1 ref.
                request_object.set_fetch_headers(Some(response::HeadersRef::create_from_uws(req)));
            }
        }

        // This object dies after the stack frame is popped
        // so we have to clear it in here too
        request_object.request_context.detach_request();
    }

    pub fn to_async(&mut self, req: *mut Req<SSL_ENABLED, HTTP3>, request_object: &mut Request) {
        ctx_log!("toAsync");
        self.to_async_without_abort_handler(req, request_object);
        if DEBUG_MODE {
            self.pathname = request_object.url.get().clone();
        }
        self.set_abort_handler();
    }

    fn end_request_streaming_and_drain(&mut self) {
        debug_assert!(self.server.is_some());

        if self.end_request_streaming().unwrap_or(true) {
            // TODO: properly propagate exception upwards
            // SAFETY: BACKREF; see drain_microtasks() re: const→mut cast.
            unsafe {
                let vm = std::ptr::from_ref::<VirtualMachine>(self.server().vm()).cast_mut();
                (*vm).drain_microtasks();
            }
        }
    }

    fn end_request_streaming(&mut self) -> JsResult<bool> {
        debug_assert!(self.server.is_some());

        self.request_body_buf = Vec::new();

        // if we cannot, we have to reject pending promises
        // first, we reject the request body promise
        if let Some(body) = self.request_body_mut() {
            // User called .blob(), .json(), text(), or .arrayBuffer() on the Request object
            // but we received nothing or the connection was aborted
            if matches!(body, Body::Value::Locked(_)) {
                // SAFETY: BACKREF
                let global_this = self.server().global_this();
                body.to_error_instance(
                    Body::ValueError::AbortReason(jsc::CommonAbortReason::ConnectionClosed),
                    global_this,
                )?;
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn detach_response(&mut self) {
        self.request_body_buf = Vec::new();

        if let Some(resp) = self.resp.take() {
            // SAFETY: FFI handle
            unsafe {
                if self.flags.is_waiting_for_request_body() {
                    self.flags.set_is_waiting_for_request_body(false);
                    resp.clear_on_data();
                }
                if self.flags.has_abort_handler() {
                    resp.clear_aborted();
                    self.flags.set_has_abort_handler(false);
                }
                if self.flags.has_timeout_handler() {
                    resp.clear_timeout();
                    self.flags.set_has_timeout_handler(false);
                }
            }
        }
    }

    pub fn is_aborted_or_ended(&self) -> bool {
        // resp == null or aborted or server.stop(true)
        self.resp.is_none()
            || self.flags.aborted()
            || self.server.is_none()
            // SAFETY: BACKREF, just checked Some
            || self.server().terminated()
    }

    pub fn do_render_head_response_after_s3_size_resolved(
        pair: *mut HeaderResponseSizePair<'_, ThisServer, SSL_ENABLED, DEBUG_MODE, HTTP3>,
    ) {
        // SAFETY: pair is a stack local threaded through cork user-data.
        let pair = unsafe { &mut *pair };
        let this = &mut *pair.this;
        this.render_metadata();

        if let Some(resp) = this.resp {
            // SAFETY: FFI handle
            resp.write_header_int(b"content-length", pair.size as u64);
        }
        this.end_without_body(this.should_close_connection());
        this.deref();
    }

    /// `S3::client::stat` callback shape: `fn(S3StatResult, *mut c_void) -> JsTerminatedResult<()>`.
    fn on_s3_size_resolved_thunk(
        result: S3::simple_request::S3StatResult<'_>,
        this: *mut c_void,
    ) -> Result<(), jsc::JsTerminated> {
        // SAFETY: this is the *mut Self registered with stat().
        Self::on_s3_size_resolved(result, unsafe { bun_ptr::callback_ctx::<Self>(this) });
        Ok(())
    }

    pub fn on_s3_size_resolved(result: S3::simple_request::S3StatResult<'_>, this: &mut Self) {
        if let Some(resp) = this.resp {
            let size = match result {
                S3::simple_request::S3StatResult::Failure(_)
                | S3::simple_request::S3StatResult::NotFound(_) => 0,
                S3::simple_request::S3StatResult::Success(stat) => stat.size,
            };
            let mut pair = HeaderResponseSizePair { this, size };
            resp.run_corked_with_type(
                Self::do_render_head_response_after_s3_size_resolved,
                &raw mut pair,
            );
        }
        // No early returns above; explicit deref instead of a scopeguard that
        // would alias `&mut Self` through a captured raw pointer.
        this.deref();
    }

    fn do_render_head_response(
        pair: *mut HeaderResponsePair<'_, ThisServer, SSL_ENABLED, DEBUG_MODE, HTTP3>,
    ) {
        // SAFETY: pair is a stack local threaded through cork user-data.
        let pair = unsafe { &mut *pair };
        let this = &mut *pair.this;
        let response = &mut *pair.response;
        if this.resp.is_none() {
            return;
        }
        // we will render the content-length header later manually so we set this to false
        this.flags.set_needs_content_length(false);
        // Always this.renderMetadata() before sending the content-length or transfer-encoding header so status is sent first

        let resp = this.resp.expect("infallible: resp bound");
        this.set_response(response);
        let Some(server) = this.server else {
            // server detached?
            this.render_metadata();
            // SAFETY: FFI handle
            resp.write_header_int(b"content-length", 0);
            this.end_without_body(this.should_close_connection());
            return;
        };
        // SAFETY: BACKREF
        let global_this = server.global_this();
        // `fast_get`/`fast_has` take `&mut self` (FFI shim), so use the `_mut`
        // accessor — `get_fetch_headers()` and `get_init_headers()` alias the
        // same `init.headers` field.
        if let Some(headers) = response.get_init_headers_mut() {
            // first respect the headers
            if !HTTP3 {
                if let Some(transfer_encoding) =
                    headers.fast_get(jsc::HTTPHeaderName::TransferEncoding)
                {
                    // fastGet() borrows the header map's StringImpl; renderMetadata() ->
                    // doWriteHeaders() calls fastRemove(.TransferEncoding) and derefs the
                    // FetchHeaders, freeing that StringImpl before we write it. Clone so
                    // the bytes outlive renderMetadata().
                    let transfer_encoding_str = transfer_encoding.to_slice_clone();
                    this.render_metadata();
                    // SAFETY: FFI handle
                    unsafe {
                        resp.write_header(b"transfer-encoding", transfer_encoding_str.slice())
                    };
                    this.end_without_body(this.should_close_connection());
                    return;
                }
            }
            if let Some(content_length) = headers.fast_get(jsc::HTTPHeaderName::ContentLength) {
                // Parse before renderMetadata(): doWriteHeaders() will fastRemove(.ContentLength)
                // and deref the FetchHeaders, freeing the borrowed StringImpl.
                let content_length_str = content_length.to_slice();
                let len: usize = HTTP::parse_content_length(content_length_str.slice());
                drop(content_length_str);

                this.render_metadata();
                // SAFETY: FFI handle
                resp.write_header_int(b"content-length", len as u64);
                this.end_without_body(this.should_close_connection());
                return;
            }
        }
        // not content-length or transfer-encoding so we need to respect the body
        let body_value = response.get_body_value();
        body_value.to_blob_if_possible();
        match body_value {
            Body::Value::InternalBlob(_) | Body::Value::WTFStringImpl(_) => {
                let mut blob = body_value.use_as_any_blob_allow_non_utf8_string();
                let size = blob.size();
                this.render_metadata();

                // SAFETY: FFI handle
                unsafe {
                    if size == crate::webcore::blob::MAX_SIZE {
                        resp.write_header_int(b"content-length", 0);
                    } else {
                        resp.write_header_int(b"content-length", size as u64);
                    }
                }
                this.end_without_body(this.should_close_connection());
                blob.detach();
            }

            Body::Value::Blob(blob) => {
                if shim::blob_is_s3(blob) {
                    // we need to read the size asynchronously
                    // in this case should always be a redirect so should not hit this path, but in case we change it in the future lets handle it
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
                        std::ptr::from_mut::<Self>(this).cast::<c_void>(),
                        proxy_url,
                        s3.request_payer,
                    ); // TODO: properly propagate exception upwards
                    return;
                }
                this.render_metadata();

                blob.resolve_size();
                // SAFETY: FFI handle
                unsafe {
                    if blob.size.get() == crate::webcore::blob::MAX_SIZE {
                        resp.write_header_int(b"content-length", 0);
                    } else {
                        resp.write_header_int(b"content-length", blob.size.get() as u64);
                    }
                }
                this.end_without_body(this.should_close_connection());
            }
            Body::Value::Locked(_) => {
                this.render_metadata();
                if !HTTP3 {
                    // SAFETY: FFI handle
                    resp.write_header(b"transfer-encoding", b"chunked");
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
    pub fn on_response(
        &mut self,
        this: &ThisServer,
        request_value: JSValue,
        response_value: JSValue,
    ) {
        let ctx = self;
        request_value.ensure_still_alive();
        response_value.ensure_still_alive();
        ctx.drain_microtasks();

        if ctx.is_aborted_or_ended() {
            return;
        }
        // if you return a Response object or a Promise<Response>
        // but you upgraded the connection to a WebSocket
        // just ignore the Response object. It doesn't do anything.
        // it's better to do that than to throw an error
        if ctx.did_upgrade_web_socket() {
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

        // SAFETY: sole `&mut Response` for this cell in scope;
        // `response_value` is rooted via ensure_still_alive() / protect()
        // below for the duration of the borrow.
        if let Some(response) = unsafe { as_response(response_value) } {
            ctx.response_jsvalue = response_value;
            ctx.response_jsvalue.ensure_still_alive();
            ctx.flags.set_response_protected(false);
            if ctx.method == Method::HEAD {
                if let Some(resp) = ctx.resp {
                    let mut pair = HeaderResponsePair {
                        this: ctx,
                        response,
                    };
                    resp.run_corked_with_type(Self::do_render_head_response, &raw mut pair);
                }
                return;
            } else {
                let body_value = response.get_body_value();
                body_value.to_blob_if_possible();

                match body_value {
                    Body::Value::Blob(blob) => {
                        if shim::blob_needs_to_read_file(blob) {
                            response_value.protect();
                            ctx.flags.set_response_protected(true);
                        }
                    }
                    Body::Value::Locked(_) => {
                        response_value.protect();
                        ctx.flags.set_response_protected(true);
                    }
                    _ => {}
                }
                ctx.render(response);
            }
            return;
        }

        let vm = this.vm();

        if let Some(promise) = response_value.as_any_promise() {
            // If we immediately have the value available, we can skip the extra event loop tick
            match promise.unwrap(vm.global().vm(), jsc::PromiseUnwrapMode::MarkHandled) {
                jsc::PromiseResult::Pending => {
                    ctx.ref_();
                    let cell = NativePromiseContext::create(this.global_this(), ctx);
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
                    // SAFETY: sole `&mut Response` for this cell in scope;
                    // `fulfilled_value` is rooted via ensure_still_alive() /
                    // protect() below for the duration of the borrow.
                    let Some(response) = (unsafe { as_response(fulfilled_value) }) else {
                        ctx.render_missing_invalid_response(fulfilled_value);
                        return;
                    };

                    ctx.response_jsvalue = fulfilled_value;
                    ctx.response_jsvalue.ensure_still_alive();
                    ctx.flags.set_response_protected(false);
                    if ctx.method == Method::HEAD {
                        if let Some(resp) = ctx.resp {
                            let mut pair = HeaderResponsePair {
                                this: ctx,
                                response,
                            };
                            resp.run_corked_with_type(Self::do_render_head_response, &raw mut pair);
                        }
                        return;
                    }
                    let body_value = response.get_body_value();
                    body_value.to_blob_if_possible();
                    match body_value {
                        Body::Value::Blob(blob) => {
                            if shim::blob_needs_to_read_file(blob) {
                                fulfilled_value.protect();
                                ctx.flags.set_response_protected(true);
                            }
                        }
                        Body::Value::Locked(_) => {
                            fulfilled_value.protect();
                            ctx.flags.set_response_protected(true);
                        }
                        _ => {}
                    }
                    ctx.render(response);
                    return;
                }
                jsc::PromiseResult::Rejected(err) => {
                    Self::handle_reject(ctx, err);
                    return;
                }
            }
        }
    }

    pub fn handle_resolve_stream(req: &mut Self) {
        stream_log!("handleResolveStream");

        let mut wrote_anything = false;
        if let Some(wrapper) = req.sink_mut() {
            let wrapper_ptr = req.sink.take().expect("infallible: sink_mut returned Some");
            let aborted = req.flags.aborted() || wrapper.sink.aborted;
            req.flags.set_aborted(aborted);
            wrote_anything = wrapper.sink.wrote > 0;

            wrapper.sink.finalize();
            let sink_global = wrapper
                .sink
                .global_this
                .expect("sink.global_this set in do_render_stream");
            ResponseStreamJSSink::<SSL_ENABLED, HTTP3>::detach(
                &mut wrapper.sink.signal,
                &sink_global,
            );
            Self::destroy_sink(wrapper_ptr);
        }

        debug_assert!(req.server.is_some());
        // server is a BACKREF; `global_this()` returns a lifetime decoupled
        // from `&req`, so it can be held across the `&mut req` reborrow below.
        let global_this = req.server().global_this();
        if let Some(resp) = req.response_weakref.get() {
            if let Some(stream) = resp.get_body_readable_stream(global_this) {
                stream.value.ensure_still_alive();
                resp.detach_readable_stream(global_this);

                stream.done(global_this);
            }

            *resp.get_body_value() = Body::Value::Used;
        }

        if req.is_aborted_or_ended() {
            return;
        }

        stream_log!("onResolve({})", wrote_anything);
        if !req.flags.has_written_status() {
            req.render_metadata();
        }
        req.end_stream(req.should_close_connection());
    }

    // TODO(port): #[bun_jsc::host_fn] — see note on `on_resolve`.
    pub fn on_resolve_stream(_global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        stream_log!("onResolveStream");
        let args = callframe.arguments_old::<2>();
        let Some(req) = NativePromiseContext::take::<Self>(args.ptr[args.len - 1]) else {
            return Ok(JSValue::UNDEFINED);
        };
        let _ref = RequestContextRef(std::ptr::from_mut::<Self>(req));
        Self::handle_resolve_stream(req);
        Ok(JSValue::UNDEFINED)
    }

    // TODO(port): #[bun_jsc::host_fn] — see note on `on_resolve`.
    pub fn on_reject_stream(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        stream_log!("onRejectStream");
        let args = callframe.arguments_old::<2>();
        let Some(req) = NativePromiseContext::take::<Self>(args.ptr[args.len - 1]) else {
            return Ok(JSValue::UNDEFINED);
        };
        let err = args.ptr[0];
        let _ref = RequestContextRef(std::ptr::from_mut::<Self>(req));

        Self::handle_reject_stream(req, global_this, err);
        Ok(JSValue::UNDEFINED)
    }

    pub fn handle_reject_stream(req: &mut Self, global_this: &JSGlobalObject, err: JSValue) {
        stream_log!("handleRejectStream");

        if let Some(wrapper) = req.sink_mut() {
            let wrapper_ptr = req.sink.take().expect("infallible: sink_mut returned Some");
            if let Some(prom) = wrapper.sink.pending_flush.take() {
                // The promise value was protected when pending_flush was
                // assigned (flushFromJS / endFromJS). Drop that root before
                // abandoning the pointer, otherwise it leaks for the
                // lifetime of the VM.
                // S008: `JSPromise` is an `opaque_ffi!` ZST — safe deref.
                bun_opaque::opaque_deref_mut(prom).to_js().unprotect();
            }
            wrapper.sink.done = true;
            let aborted = req.flags.aborted() || wrapper.sink.aborted;
            req.flags.set_aborted(aborted);
            wrapper.sink.finalize();
            let sink_global = wrapper
                .sink
                .global_this
                .expect("sink.global_this set in do_render_stream");
            ResponseStreamJSSink::<SSL_ENABLED, HTTP3>::detach(
                &mut wrapper.sink.signal,
                &sink_global,
            );
            Self::destroy_sink(wrapper_ptr);
        }

        if let Some(resp) = req.response_weakref.get() {
            // PORT NOTE: Zig captures `bodyValue` ptr first then derefs after
            // the stream calls; reordered here for borrowck (semantically
            // identical — the Zig check reads through the pointer post-detach).
            if let Some(stream) = resp.get_body_readable_stream(global_this) {
                stream.value.ensure_still_alive();
                resp.detach_readable_stream(global_this);
                stream.done(global_this);
            }

            let body_value = resp.get_body_value();
            if matches!(body_value, Body::Value::Locked(_)) {
                *body_value = Body::Value::Used;
            }
        }

        // aborted so call finalizeForAbort
        if req.is_aborted_or_ended() {
            return;
        }

        stream_log!("onReject()");

        if !req.flags.has_written_status() {
            req.render_metadata();
        }

        // TODO(b2-blocked): DEBUG_MODE dev-server HTML fallback page — gated on
        // `Api::FallbackMessageContainer`/`Fallback::render_backend`.

        if DEBUG_MODE {
            if let Some(server) = req.server {
                if !err.is_empty_or_undefined_or_null() {
                    // SAFETY: BACKREF
                    let server = &*server;
                    let mut exception_list: jsc::ExceptionList = Vec::new();
                    // SAFETY: see drain_microtasks() re: const→mut cast.
                    unsafe {
                        (*std::ptr::from_ref::<VirtualMachine>(server.vm()).cast_mut())
                            .run_error_handler(err, Some(&mut exception_list));
                    }
                    let exception_list = jsc_exceptions_to_api(exception_list);

                    if let Some(_dev_server) = server.dev_server() {
                        // Render the error fallback HTML page like renderDefaultError does
                        if !req.flags.has_written_status() {
                            req.flags.set_has_written_status(true);
                            if let Some(resp) = req.resp {
                                // SAFETY: FFI handle
                                unsafe {
                                    resp.write_status(b"500 Internal Server Error");
                                    resp.write_header(
                                        b"content-type",
                                        &bun_http_types::MimeType::HTML.value,
                                    );
                                }
                            }
                        }

                        // Create error message for the stream rejection
                        let cwd = bun_resolver::fs::FileSystem::get().top_level_dir;
                        let fallback_container = Box::new(Api::FallbackMessageContainer {
                            message: Some(
                                b"Stream error during server-side rendering"
                                    .to_vec()
                                    .into_boxed_slice(),
                            ),
                            router: None,
                            reason: Some(Api::FallbackStep::fetch_event_handler),
                            cwd: Some(cwd.to_vec().into_boxed_slice()),
                            problems: Some(Api::Problems {
                                code: 500,
                                name: b"StreamError".to_vec().into_boxed_slice(),
                                exceptions: exception_list,
                                build: Api::Log::default(),
                            }),
                        });

                        let mut bb: Vec<u8> = Vec::new();

                        Fallback::render_backend(&fallback_container, &mut bb)
                            .expect("unreachable");

                        if let Some(resp) = req.resp {
                            // SAFETY: FFI handle
                            resp.write(&bb);
                        }

                        req.end_stream(req.should_close_connection());
                        return;
                    }
                }
            }
        }
        req.end_stream(req.should_close_connection());
    }

    pub fn do_render_with_body(
        this: &mut Self,
        value: &mut Body::Value,
        owned_readable: Option<WebCore::ReadableStream>,
    ) {
        this.drain_microtasks();

        // If a ReadableStream can trivially be converted to a Blob, do so.
        // If it's a WTFStringImpl and it cannot be used as a UTF-8 string, convert it to a Blob.
        value.to_blob_if_possible();
        // SAFETY: BACKREF
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
            // .InlineBlob,
            Body::Value::WTFStringImpl(_) | Body::Value::InternalBlob(_) | Body::Value::Blob(_) => {
                // toBlobIfPossible checks for WTFString needing a conversion.
                this.blob = value.use_as_any_blob_allow_non_utf8_string();
                this.render_with_blob_from_body_value();
                return;
            }
            Body::Value::Locked(lock) => {
                if this.is_aborted_or_ended() {
                    return;
                }
                let readable_stream: Option<WebCore::ReadableStream> = 'brk: {
                    if let Some(stream) = lock.readable.get(global_this) {
                        // we hold the stream alive until we're done with it
                        // PORT NOTE: Zig `= lock.readable` is a bitwise struct copy (no
                        // dtor); Rust `Strong` is move-only — take() transfers ownership.
                        this.response_body_readable_stream_ref =
                            core::mem::take(&mut lock.readable);
                        break 'brk Some(stream);
                    }
                    if let Some(stream) = owned_readable {
                        // response owns the stream, so we hold a strong reference to it
                        this.response_body_readable_stream_ref =
                            readable_stream::Strong::init(stream, global_this);
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
                            this.response_body_readable_stream_ref.deinit();
                            // Stream is invalid, render empty body
                            this.do_render_blob();
                            return;
                        }
                        // toBlobIfPossible will typically convert .Blob streams, or .File streams into a Blob object, but cannot always.
                        readable_stream::Source::Blob(_)
                        | readable_stream::Source::File(_)
                        // These are the common scenario:
                        | readable_stream::Source::JavaScript
                        | readable_stream::Source::Direct => {
                            if let Some(resp) = this.resp {
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
                            debug_assert!(byte_stream.pipe.get().ctx.is_none());
                            debug_assert!(this.byte_stream.is_none());
                            if this.resp.is_none() {
                                // we don't have a response, so we can discard the stream
                                stream.done(global_this);
                                this.response_body_readable_stream_ref.deinit();
                                return;
                            }
                            let resp = this.resp.expect("infallible: resp bound");
                            // If we've received the complete body by the time this function is called
                            // we can avoid streaming it and just send it all at once.
                            if byte_stream.has_received_last_chunk.get() {
                                let mut byte_list = byte_stream.drain();
                                this.blob = AnyBlob::from_array_list(
                                    byte_list.move_to_list_managed(),
                                );
                                this.response_body_readable_stream_ref.deinit();
                                this.do_render_blob();
                                return;
                            }
                            this.ref_();
                            byte_stream.pipe.set(WebCore::Wrap::<Self>::init(this));
                            // Deinit the old Strong reference before creating a new one
                            // to avoid leaking the Strong.Impl memory
                            this.response_body_readable_stream_ref.deinit();
                            this.response_body_readable_stream_ref =
                                readable_stream::Strong::init(stream, global_this);

                            this.byte_stream = Some(byte_stream_nn);
                            let mut response_buf = byte_stream.drain();
                            this.response_buf_owned = response_buf.move_to_list();

                            // we don't set size here because even if we have a hint
                            // uWebSockets won't let us partially write streaming content
                            this.blob.detach();

                            // if we've received metadata and part of the body, send everything we can and drain
                            if !this.response_buf_owned.is_empty() {
                                resp.run_corked_with_type(
                                    Self::drain_response_buffer_and_metadata_corked,
                                    this,
                                );
                            } else {
                                // if we only have metadata to send, send it now
                                resp.run_corked_with_type(Self::render_metadata_corked, this);
                            }
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
                    Self::do_render_with_body(this, value, None);
                    return;
                }

                // when there's no stream, we need to
                lock.on_receive_value = Some(Self::do_render_with_body_locked);
                lock.task = Some(std::ptr::from_mut::<Self>(this).cast::<c_void>());

                return;
            }
            _ => {}
        }

        this.do_render_blob();
    }

    pub fn on_pipe(this: &mut Self, mut stream: WebCore::streams::Result) {
        // TODO(port): allocator param dropped — global mimalloc per §Allocators
        let stream_needs_deinit = matches!(
            stream,
            WebCore::streams::Result::Owned(_) | WebCore::streams::Result::OwnedAndDone(_)
        );
        let is_done = stream.is_done();
        // PORT NOTE: reshaped for borrowck — the defer reads `stream` through a
        // raw ptr so the body below can keep borrowing it.
        let stream_ptr: *mut WebCore::streams::Result = &raw mut stream;
        // Drop one ref only when the stream signals completion.
        let _ref = is_done.then(|| RequestContextRef(std::ptr::from_mut::<Self>(this)));
        scopeguard::defer! {
            if stream_needs_deinit {
                // SAFETY: stream lives on the caller's stack frame past the guard.
                match unsafe { &mut *stream_ptr } {
                    WebCore::streams::Result::OwnedAndDone(owned)
                    | WebCore::streams::Result::Owned(owned) => {
                        // Vec::deinit → Drop in Rust.
                        *owned = Vec::<u8>::default();
                    }
                    _ => unreachable!(),
                }
            }
        }

        if this.is_aborted_or_ended() {
            return;
        }
        let resp = this.resp.expect("infallible: resp bound");

        let chunk = stream.slice();
        // on failure, it will continue to allocate
        // we can't do buffering ourselves here or it won't work
        // uSockets will append and manage the buffer
        // so any write will buffer if the write fails
        // SAFETY: FFI handle
        if matches!(resp.write(chunk), uws::WriteResult::WantMore(_)) {
            if is_done {
                this.end_stream(this.should_close_connection());
            }
        } else {
            // when it's the last one, we just want to know if it's done
            if is_done {
                this.flags.set_has_marked_pending(true);
                // SAFETY: FFI handle
                resp.on_writable(Self::on_writable_response_buffer, this);
            }
        }
    }

    pub fn do_render_blob(&mut self) {
        // We are not corked
        // The body is small
        // Faster to do the memcpy than to do the two network calls
        // We are not streaming
        // This is an important performance optimization
        if self.flags.has_abort_handler() && self.blob.fast_size() < 16384 - 1024 {
            if let Some(resp) = self.resp {
                resp.run_corked_with_type(Self::do_render_blob_corked, self);
            }
        } else {
            Self::do_render_blob_corked(std::ptr::from_mut::<Self>(self));
        }
    }

    pub fn do_render_blob_corked(this: *mut Self) {
        // SAFETY: this is the live RequestContext threaded through cork user-data.
        let this = unsafe { &mut *this };
        this.render_metadata();
        this.render_bytes();
    }

    /// `render_metadata` adapter for `run_corked_with_type` (takes `fn(*mut U)`).
    fn render_metadata_corked(this: *mut Self) {
        // SAFETY: this is the live RequestContext threaded through cork user-data.
        unsafe { (*this).render_metadata() };
    }

    pub fn do_render(&mut self) {
        ctx_log!("doRender");

        if self.is_aborted_or_ended() {
            return;
        }
        // PORT NOTE: WeakPtr::get borrows `&mut self`, and `do_render_with_body`
        // also needs `&mut self` plus a `&mut BodyValue` from the response. The
        // response lives in a separate allocation (held by the WeakRef) so the
        // borrows are disjoint at runtime; route through a raw ptr to express that.
        let response: *mut Response = self.response_weakref.get().unwrap();
        // SAFETY: BACKREF
        let global_this = self.server().global_this();
        // SAFETY: response_weakref keeps the Response alive for this frame.
        let owned_readable = unsafe { (*response).get_body_readable_stream(global_this) };
        // SAFETY: as above; body_value borrows the Response, disjoint from `self`.
        Self::do_render_with_body(
            self,
            unsafe { (*response).get_body_value() },
            owned_readable,
        );
    }

    pub fn render_production_error(&mut self, status: u16) {
        if let Some(resp) = self.resp {
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
                    if !self.flags.has_written_status() {
                        resp.write_status(b"500 Internal Server Error");
                        resp.write_header(b"content-type", b"text/plain");
                        self.flags.set_has_written_status(true);
                    }

                    self.end(b"Something went wrong!", self.should_close_connection());
                }
            }
        }
    }

    pub fn run_error_handler(&mut self, value: JSValue) {
        self.run_error_handler_with_status_code(value, 500);
    }

    fn ensure_pathname(&self) -> PathnameFormatter<'_, ThisServer, SSL_ENABLED, DEBUG_MODE, HTTP3> {
        PathnameFormatter { ctx: self }
    }

    #[inline]
    pub fn should_close_connection(&self) -> bool {
        if let Some(resp) = self.resp {
            // SAFETY: FFI handle
            return resp.should_close_connection();
        }
        false
    }

    fn finish_running_error_handler(&mut self, value: JSValue, status: u16) {
        let Some(server) = self.server else {
            return self.render_production_error(status);
        };
        // SAFETY: BACKREF
        let server = &*server;
        let global_this = server.global_this();
        // TODO(b2-blocked): DEBUG_MODE branch renders the HTML fallback page via
        // `Api::JsException` + `render_default_error`; gated until bun_schema/
        // bun_js_parser surfaces are in. Falls through to the production path.

        // `ServerLike::vm()` is the process-static VM `BackRef`; `as_mut()` is
        // the single audited `&mut VirtualMachine` accessor.
        let vm = server.vm().as_mut();
        if DEBUG_MODE {
            // PERF(port): was arena bulk-free — profile in Phase B
            let mut exception_list_upstream: jsc::ExceptionList = Vec::new();
            let prev_exception_list = vm.on_unhandled_rejection_exception_list;
            vm.on_unhandled_rejection_exception_list =
                Some(NonNull::from(&mut exception_list_upstream));
            (vm.on_unhandled_rejection)(vm, global_this, value);
            vm.on_unhandled_rejection_exception_list = prev_exception_list;

            let exception_list = jsc_exceptions_to_api(exception_list_upstream);
            let log = vm.log_mut().unwrap();
            // PORT NOTE: format eagerly so `format_args!` doesn't hold an
            // immutable borrow of `self` across the `&mut self` call.
            let msg = format!(
                "<r><red>{:?}<r> - <b>{}<r> failed",
                self.method,
                self.ensure_pathname()
            );
            self.render_default_error(
                log,
                bun_core::err!("ExceptionOcurred"),
                &exception_list,
                format_args!("{}", msg),
            );
            log.reset();
            return;
        }
        if status != 404 {
            (vm.on_unhandled_rejection)(vm, global_this, value);
        }
        self.render_production_error(status);
        vm.log_mut().unwrap().reset();
    }

    pub fn run_error_handler_with_status_code_dont_check_responded(
        &mut self,
        value: JSValue,
        status: u16,
    ) {
        jsc::mark_binding!();
        if let Some(server) = self.server {
            // SAFETY: BACKREF
            let server = &*server;
            if let Some(on_error) = server.config().on_error.as_ref()
                && !self.flags.has_called_error_handler()
            {
                self.flags.set_has_called_error_handler(true);
                let result = on_error
                    .get()
                    .call(
                        server.global_this(),
                        server.js_value().try_get().unwrap_or(JSValue::UNDEFINED),
                        &[value],
                    )
                    .unwrap_or_else(|err| server.global_this().take_exception(err));
                let _keep = jsc::EnsureStillAlive(result);
                if !result.is_empty_or_undefined_or_null() {
                    if let Some(err) = result.to_error() {
                        self.finish_running_error_handler(err, status);
                        return;
                    } else if let Some(promise) = result.as_any_promise() {
                        Self::process_on_error_promise(self, result, promise, value, status);
                        return;
                    // SAFETY: sole `&mut Response` for this cell in scope;
                    // `result` is GC-rooted by `_keep` (EnsureStillAlive)
                    // across the render() call.
                    } else if let Some(response) = unsafe { as_response(result) } {
                        self.render(response);
                        return;
                    }
                }
            }
        }

        self.finish_running_error_handler(value, status);
    }

    fn process_on_error_promise(
        ctx: &mut Self,
        promise_js: JSValue,
        promise: jsc::AnyPromise,
        value: JSValue,
        status: u16,
    ) {
        debug_assert!(ctx.server.is_some());
        // SAFETY: BACKREF
        let server = ctx.server();
        let vm = server.vm();

        match promise.unwrap(vm.global().vm(), jsc::PromiseUnwrapMode::MarkHandled) {
            jsc::PromiseResult::Pending => {
                ctx.flags.set_is_error_promise_pending(true);
                ctx.ref_();
                let cell = NativePromiseContext::create(server.global_this(), ctx);
                promise_js.then_with_value(
                    server.global_this(),
                    cell,
                    Self::ON_RESOLVE,
                    Self::ON_REJECT,
                ); // TODO: properly propagate exception upwards
            }
            jsc::PromiseResult::Fulfilled(fulfilled_value) => {
                // if you return a Response object or a Promise<Response>
                // but you upgraded the connection to a WebSocket
                // just ignore the Response object. It doesn't do anything.
                // it's better to do that than to throw an error
                if ctx.did_upgrade_web_socket() {
                    return;
                }

                // SAFETY: sole `&mut Response` for this cell in scope;
                // `fulfilled_value` is rooted via ensure_still_alive() below
                // for the duration of the borrow.
                let Some(response) = (unsafe { as_response(fulfilled_value) }) else {
                    ctx.finish_running_error_handler(value, status);
                    return;
                };

                ctx.response_jsvalue = fulfilled_value;
                ctx.response_jsvalue.ensure_still_alive();
                ctx.flags.set_response_protected(false);

                let body_value = response.get_body_value();
                body_value.to_blob_if_possible();
                match body_value {
                    Body::Value::Blob(blob) => {
                        if shim::blob_needs_to_read_file(blob) {
                            fulfilled_value.protect();
                            ctx.flags.set_response_protected(true);
                        }
                    }
                    Body::Value::Locked(_) => {
                        fulfilled_value.protect();
                        ctx.flags.set_response_protected(true);
                    }
                    _ => {}
                }
                ctx.render(response);
                return;
            }
            jsc::PromiseResult::Rejected(err) => {
                ctx.finish_running_error_handler(err, status);
                return;
            }
        }
    }

    pub fn run_error_handler_with_status_code(&mut self, value: JSValue, status: u16) {
        jsc::mark_binding!();
        // SAFETY: FFI handle, just checked is_some()
        if self.resp.is_none()
            || unsafe { self.resp.expect("infallible: resp bound").has_responded() }
        {
            return;
        }

        self.run_error_handler_with_status_code_dont_check_responded(value, status);
    }

    pub fn render_metadata(&mut self) {
        // `AnyResponse` is a `Copy` handle; methods take `self` by value.
        let Some(resp) = self.resp else { return };

        // For plain in-memory bodies this runs synchronously from
        // render() before any backpressure gap, so the Response is
        // always live here. File / stream bodies that call this after
        // an async hop keep the Response rooted via response_protected.
        let response: &mut Response = self.response_weakref.get().unwrap();
        let mut status = response.status_code();
        let mut needs_content_range = self.flags.needs_content_range()
            && (self.sendfile.total > 0 || self.sendfile.remain < self.blob.size());

        let size = if needs_content_range {
            self.sendfile.remain
        } else {
            self.blob.size()
        };

        status = if status == 200 && size == 0 && !self.blob.is_detached() {
            204
        } else {
            status
        };

        let (content_type, needs_content_type, content_type_needs_free) =
            get_content_type(response.get_init_headers_mut(), &self.blob);
        // PORT NOTE: Zig `defer if (content_type_needs_free) content_type.deinit()`.
        // `MimeType` owns a `Cow<'static, [u8]>`; Drop handles the owned case.
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
            needs_content_range =
                needs_content_range && (self.sendfile.total > 0 || has_content_range);
            if needs_content_range {
                status = 206;
            }

            self.do_write_status(status);
            self.do_write_headers(&mut headers_);
            // Zig: `defer headers_.deref()`. `HeadersRef` is RAII — its Drop
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

        if let Some(mut cookies) = self.cookies.take() {
            // SAFETY: BACKREF
            let global_this = self.server().global_this();
            let r = cookies.write(
                global_this,
                Self::RESP_KIND,
                any_response_as_ptr(self.resp.expect("infallible: resp bound")),
            );
            // `cookies` drops here, releasing the ref taken in `set_cookies`.
            if r.is_err() {
                return;
            } // TODO: properly propagate exception upwards
        }

        if needs_content_type
            // do not insert the content type if it is the fallback value
            // we may not know the content-type when streaming
            && (!self.blob.is_detached()
                || content_type.value.as_ptr() != bun_http_types::MimeType::OTHER.value.as_ptr())
        {
            resp.write_header(b"content-type", &content_type.value);
        }

        // Advertise the QUIC endpoint on H1/H2 responses so browsers can
        // discover it (RFC 7838). Multiple Alt-Svc fields are valid, so a
        // user-supplied one composes rather than conflicts.
        // TODO(port): `@hasDecl(ThisServer, "h3AltSvc")` — model as optional trait method.
        if !HTTP3 {
            // SAFETY: BACKREF
            if let Some(alt) = self.server().h3_alt_svc() {
                resp.write_header(b"alt-svc", alt);
            }
        }

        // automatically include the filename when:
        // 1. Bun.file("foo")
        // 2. The content-disposition header is not present
        if !has_content_disposition && content_type.category.autoset_filename() {
            if let Some(filename) = self.blob.get_file_name() {
                let basename = bun_paths::basename(filename);
                if !basename.is_empty() {
                    let mut filename_buf = [0u8; 1024];
                    let truncated = &basename[..basename.len().min(1024 - 32)];
                    let header_value = {
                        let mut w = &mut filename_buf[..];
                        if write!(w, "filename=\"{}\"", bstr::BStr::new(truncated)).is_ok() {
                            let written = 1024 - w.len();
                            &filename_buf[..written]
                        } else {
                            &b""[..]
                        }
                    };
                    resp.write_header(b"content-disposition", header_value);
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
            let end = self.sendfile.offset + self.sendfile.remain.saturating_sub(1);
            // `total > 0` ⇒ we resolved an incoming Range header against the
            // stat'd size, so the full size is meaningful. Otherwise this is a
            // `.slice()`-driven range — omit the full size (it can change
            // between requests and may leak PII).
            let header_value = RangeRequest::format_content_range(
                &mut crbuf,
                RangeRequest::Result::Satisfiable {
                    start: self.sendfile.offset,
                    end,
                },
                (self.sendfile.total > 0).then_some(self.sendfile.total),
            );
            resp.write_header(b"content-range", header_value);
            if self.sendfile.total > 0 {
                resp.write_header(b"accept-ranges", b"bytes");
            }
            self.flags.set_needs_content_range(false);
        }
    }

    fn do_write_status(&mut self, status: u16) {
        debug_assert!(!self.flags.has_written_status());
        self.flags.set_has_written_status(true);

        // `AnyResponse` is a `Copy` handle; methods take `self` by value.
        let Some(resp) = self.resp else { return };
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

    fn do_write_headers(&mut self, headers: &mut FetchHeaders) {
        ctx_log!("writeHeaders");
        headers.fast_remove(jsc::HTTPHeaderName::ContentLength);
        headers.fast_remove(jsc::HTTPHeaderName::TransferEncoding);
        if HTTP3 {
            // RFC 9114 §4.2: connection-specific fields are malformed.
            headers.fast_remove(jsc::HTTPHeaderName::Connection);
            headers.fast_remove(jsc::HTTPHeaderName::KeepAlive);
            headers.fast_remove(jsc::HTTPHeaderName::ProxyConnection);
            headers.fast_remove(jsc::HTTPHeaderName::Upgrade);
        }
        if let Some(resp) = self.resp {
            headers.to_uws_response(Self::RESP_KIND, any_response_as_ptr(resp));
        }
    }

    pub fn render_bytes(&mut self) {
        // copy it to stack memory to prevent aliasing issues in release builds
        // PORT NOTE: AnyBlob is not Copy in Rust; reborrow through a raw ptr
        // so the slice borrow doesn't conflict with `&mut self` below.
        let bytes: &[u8] = unsafe { bun_ptr::detach_lifetime(self.blob.slice()) };
        if let Some(resp) = self.resp {
            // SAFETY: FFI handle
            if !resp.try_end(bytes, bytes.len(), self.should_close_connection()) {
                self.flags.set_has_marked_pending(true);
                // SAFETY: FFI handle
                resp.on_writable(Self::on_writable_bytes, self);
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
    fn set_response(&mut self, response: &mut Response) {
        if self
            .response_weakref
            .get()
            .map(|r| std::ptr::from_mut::<Response>(r))
            == Some(std::ptr::from_mut(response))
        {
            return;
        }
        self.response_weakref.deref();
        self.response_weakref = response::WeakRef::init_ref(response);
    }

    pub fn render(&mut self, response: &mut Response) {
        ctx_log!("render");
        self.set_response(response);

        self.do_render();
    }

    pub fn on_buffered_body_chunk(this: *mut Self, chunk: &[u8], last: bool) {
        ctx_log!("onBufferedBodyChunk {} {}", chunk.len(), last);
        // SAFETY: uWS guarantees the user-data ptr is the live RequestContext.
        let this = unsafe { &mut *this };
        debug_assert!(this.resp.is_some());

        this.flags.set_is_waiting_for_request_body(!last);
        if this.is_aborted_or_ended() || this.flags.has_marked_complete() {
            return;
        }
        if !last && chunk.is_empty() {
            // Sometimes, we get back an empty chunk
            // We have to ignore those chunks unless it's the last one
            return;
        }
        // SAFETY: BACKREF
        let server = this.server();
        let vm = server.vm();
        let global_this = server.global_this();

        // After the user does request.body,
        // if they then do .text(), .arrayBuffer(), etc
        // we can no longer hold the strong reference from the body value ref.
        if let Some(readable) = this.request_body_readable_stream_ref.get(global_this) {
            debug_assert!(this.request_body_buf.is_empty());
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
                // TODO: properly propagate exception upwards
                let _ = bytes.on_data(WebCore::streams::Result::Temporary(borrowed));
            } else {
                // Moved out so the Strong (and its underlying GC handle) is
                // released at scope exit via `Drop` on `strong::Optional`.
                let _strong = core::mem::take(&mut this.request_body_readable_stream_ref);
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
                // TODO: properly propagate exception upwards
                let _ = bytes.on_data(WebCore::streams::Result::TemporaryAndDone(borrowed));
            }

            return;
        }

        // This is the start of a task, so it's a good time to drain
        if let Some(body) = this.request_body_mut() {
            // The up-front maxRequestBodySize check in server.zig only
            // sees Content-Length. HTTP/3 (and H1 chunked) bodies may
            // omit it, so cap accumulated bytes here too — otherwise a
            // single CL-less stream can grow request_body_buf without
            // bound.
            if this.request_body_buf.len().saturating_add(chunk.len())
                > server.config().max_request_body_size
            {
                this.request_body_buf = Vec::new();
                // SAFETY: FFI handle
                unsafe { this.resp.expect("infallible: resp bound").clear_on_data() };
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
                if let Some(resp) = this.resp {
                    if !resp.has_responded() {
                        this.flags.set_has_written_status(true);
                        // SAFETY: FFI handle
                        resp.write_status(b"413 Payload Too Large");
                    }
                }
                this.end_without_body(!HTTP3);
                return;
            }

            if last {
                let bytes = &mut this.request_body_buf;

                let mut old = core::mem::replace(body, Body::Value::Null);

                let total = bytes.len() + chunk.len();
                'getter: {
                    // if (total <= jsc.WebCore.InlineBlob.available_bytes) {
                    //     if (total == 0) {
                    //         body.value = .{ .Empty = {} };
                    //         break :getter;
                    //     }
                    //
                    //     body.value = .{ .InlineBlob = jsc.WebCore.InlineBlob.concat(bytes.items, chunk) };
                    //     this.request_body_buf.clearAndFree(this.allocator);
                    // } else {
                    // TODO(port): ensureTotalCapacityPrecise can OOM in Zig; Rust Vec aborts.
                    bytes.reserve_exact(total.saturating_sub(bytes.len()));
                    bytes.extend_from_slice(chunk);
                    debug_assert_eq!(bytes.len(), total);
                    *body = Body::Value::InternalBlob(WebCore::InternalBlob {
                        bytes: core::mem::take(bytes),
                        was_string: false,
                    });
                    // }
                    break 'getter;
                }
                this.request_body_buf = Vec::new();

                if matches!(old, Body::Value::Locked(_)) {
                    let _exit = vm.enter_event_loop_scope();

                    let _ = Body::Value::resolve(&mut old, body, global_this, None); // TODO: properly propagate exception upwards
                }
                return;
            }

            if this.request_body_buf.capacity() == 0 {
                this.request_body_buf.reserve_exact(
                    this.request_body_content_len
                        .min(MAX_REQUEST_BODY_PREALLOCATE_LENGTH),
                );
            }
            this.request_body_buf.extend_from_slice(chunk);
        }
    }

    pub fn on_start_streaming_request_body(&mut self) -> WebCore::DrainResult {
        ctx_log!("onStartStreamingRequestBody");
        if self.is_aborted_or_ended() {
            return WebCore::DrainResult::Aborted;
        }

        // This means we have received part of the body but not the whole thing
        if !self.request_body_buf.is_empty() {
            let emptied = core::mem::take(&mut self.request_body_buf);
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

        WebCore::DrainResult::EstimatedSize(self.request_body_content_len)
    }

    pub fn on_start_buffering(&mut self) {
        if let Some(server) = self.server {
            ctx_log!("onStartBuffering");
            // TODO: check if is someone calling onStartBuffering other than onStartBufferingCallback
            // if is not, this should be removed and only keep protect + setAbortHandler
            // HTTP/3 (RFC 9114): Content-Length is optional; the body is
            // delimited by stream FIN, so the H1 "no CL + no TE ⇒ empty"
            // shortcut would drop it.
            if !HTTP3 && !self.flags.is_transfer_encoding() && self.request_body_content_len == 0 {
                // no content-length or 0 content-length
                // no transfer-encoding
                if let Some(body) = self.request_body_mut() {
                    let mut old = core::mem::replace(body, Body::Value::Null);
                    if let Body::Value::Locked(l) = &mut old {
                        l.on_receive_value = None;
                    }
                    let mut new_body: Body::Value = Body::Value::Null;
                    // SAFETY: BACKREF
                    let global_this = server.global_this();
                    let _ = Body::Value::resolve(&mut old, &mut new_body, global_this, None); // TODO: properly propagate exception upwards
                    *body = new_body;
                }
            }
        }
    }

    pub fn on_request_body_readable_stream_available(
        ptr: *mut c_void,
        global_this: &JSGlobalObject,
        readable: WebCore::ReadableStream,
    ) {
        // SAFETY: ptr is a *RequestContext
        let this = unsafe { bun_ptr::callback_ctx::<Self>(ptr) };
        debug_assert!(!this.request_body_readable_stream_ref.has());
        this.request_body_readable_stream_ref =
            readable_stream::Strong::init(readable, global_this);
    }

    pub fn on_start_buffering_callback(this: *mut c_void) {
        // SAFETY: this is a *RequestContext
        unsafe { bun_ptr::callback_ctx::<Self>(this) }.on_start_buffering();
    }

    pub fn on_start_streaming_request_body_callback(this: *mut c_void) -> WebCore::DrainResult {
        // SAFETY: this is a *RequestContext
        unsafe { bun_ptr::callback_ctx::<Self>(this) }.on_start_streaming_request_body()
    }

    pub fn get_remote_socket_info(&self) -> Option<uws::SocketAddress> {
        let resp = self.resp?;
        // `AnyResponse::get_remote_socket_info` returns the uws_sys
        // borrowed-slice variant; convert to the owned `bun_uws::SocketAddress`.
        // SAFETY: FFI handle
        let info = resp.get_remote_socket_info()?;
        Some(uws::SocketAddress {
            ip: info.ip.to_vec().into_boxed_slice(),
            port: info.port,
            is_ipv6: info.is_ipv6,
        })
    }

    pub fn set_timeout(&mut self, seconds: c_uint) -> bool {
        if let Some(resp) = self.resp {
            // SAFETY: FFI handle
            resp.timeout(seconds.min(255) as u8);
            if seconds > 0 {
                // we only set the timeout callback if we wanna the timeout event to be triggered
                // the connection will be closed so the abort handler will be called after the timeout
                if let Some(req) = self.request_weakref.get() {
                    if shim::iec_has_callback(&req.internal_event_callback) {
                        self.set_timeout_handler();
                    }
                }
            } else {
                // if the timeout is 0, we don't need to trigger the timeout event
                // SAFETY: FFI handle
                resp.clear_timeout();
            }
            return true;
        }
        false
    }
}

const MAX_REQUEST_BODY_PREALLOCATE_LENGTH: usize = 1024 * 256;

/// Trap host fn for the `(false, _, true)` arms of `exported_host_fns`. Those
/// `RequestContext` monomorphs (plain-HTTP/3) are type-reachable via the
/// blanket H3 impls but never serve requests at runtime — HTTP/3 always
/// implies TLS. If a future refactor ever routes a promise reaction through
/// one, fail loudly here instead of silently mismatching `promiseHandlerID`.
bun_jsc::jsc_host_abi! {
    #[cold]
    unsafe fn unreachable_host_fn(_g: *mut JSGlobalObject, _f: *mut CallFrame) -> JSValue {
        unreachable!("RequestContext promise reaction for non-TLS HTTP/3 instantiation");
    }
}

// ─── per-monomorphization C-ABI exports ──────────────────────────────────────
// Zig: `comptime { @export(&jsc.toJSHostFn(onResolve), .{ .name = export_prefix ++ "__onResolve" }); ... }`
// where `export_prefix = "Bun__HTTPRequestContext" ++ (debug ? "Debug" : "") ++ (h3 ? "H3" : ssl ? "TLS" : "")`.
// Rust generics cannot own `#[no_mangle]` symbols, so each of the 6 concrete
// instantiations × 4 callbacks is spelled out via `request_ctx_exports!`. The
// generic body lives on the `impl<ThisServer, ..> RequestContext` block above
// (`on_resolve` / `on_reject` / `on_resolve_stream` / `on_reject_stream`); each
// shim is the `toJSHostFn` result-mapping (`JsResult<JSValue>` → raw `JSValue`,
// `.zero` on error) over the monomorphic associated fn.
macro_rules! request_ctx_exports {
    ($(
        ($srv:ty, $ssl:literal, $dbg:literal, $h3:literal) =>
        $on_resolve:ident, $on_reject:ident, $on_resolve_stream:ident, $on_reject_stream:ident
    );* $(;)?) => {$(
        // Named C-ABI symbols for the C++ side. The bodies forward to the
        // generic `host_on_*` shims monomorphized at this tuple — `#[no_mangle]`
        // pins the link name (Zig: `@export(&jsc.toJSHostFn(onResolve), …)`).
        #[unsafe(no_mangle)]
        #[bun_jsc::host_call]
        pub fn $on_resolve(g: *mut JSGlobalObject, f: *mut CallFrame) -> JSValue {
            host_on_resolve::<$srv, $ssl, $dbg, $h3>(g, f)
        }
        #[unsafe(no_mangle)]
        #[bun_jsc::host_call]
        pub fn $on_reject(g: *mut JSGlobalObject, f: *mut CallFrame) -> JSValue {
            host_on_reject::<$srv, $ssl, $dbg, $h3>(g, f)
        }
        #[unsafe(no_mangle)]
        #[bun_jsc::host_call]
        pub fn $on_resolve_stream(g: *mut JSGlobalObject, f: *mut CallFrame) -> JSValue {
            host_on_resolve_stream::<$srv, $ssl, $dbg, $h3>(g, f)
        }
        #[unsafe(no_mangle)]
        #[bun_jsc::host_call]
        pub fn $on_reject_stream(g: *mut JSGlobalObject, f: *mut CallFrame) -> JSValue {
            host_on_reject_stream::<$srv, $ssl, $dbg, $h3>(g, f)
        }
    )*

    /// Map the `(SSL, DEBUG, H3)` const-generic tuple to the concrete
    /// `#[no_mangle]` promise-reaction exports above. Used by the blanket
    /// `RequestContextHostFns` impl so `Self::ON_*` resolves to the *same*
    /// address C++'s `GlobalObject::promiseHandlerID` compares against.
    ///
    /// Only the six instantiations spelled out in `request_ctx_exports!` are
    /// ever constructed; the remaining `(false, _, true)` arms (plain-HTTP/3
    /// without TLS) are unreachable and fall back to the generic shims so the
    /// const-eval has a value of the right type.
    const fn exported_host_fns(
        ssl: bool,
        debug: bool,
        h3: bool,
    ) -> (
        bun_jsc::JSHostFn,
        bun_jsc::JSHostFn,
        bun_jsc::JSHostFn,
        bun_jsc::JSHostFn,
    ) {
        match (ssl, debug, h3) {
            $(
                ($ssl, $dbg, $h3) => (
                    $on_resolve,
                    $on_reject,
                    $on_resolve_stream,
                    $on_reject_stream,
                ),
            )*
            // `(false, _, true)` — plain-HTTP/3 — is type-instantiated by the
            // blanket H3 impls in server_body.rs but never reaches the promise
            // path at runtime (HTTP/3 requires TLS). We can't const-panic here
            // because rustc evaluates this assoc const for every monomorph; a
            // runtime trap keeps the failure loud without breaking the build.
            _ => (
                unreachable_host_fn,
                unreachable_host_fn,
                unreachable_host_fn,
                unreachable_host_fn,
            ),
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
    (crate::server::HTTPSServer,      true,  false, true)  =>
        Bun__HTTPRequestContextH3__onResolve,
        Bun__HTTPRequestContextH3__onReject,
        Bun__HTTPRequestContextH3__onResolveStream,
        Bun__HTTPRequestContextH3__onRejectStream;
    (crate::server::DebugHTTPSServer, true,  true,  true)  =>
        Bun__HTTPRequestContextDebugH3__onResolve,
        Bun__HTTPRequestContextDebugH3__onReject,
        Bun__HTTPRequestContextDebugH3__onResolveStream,
        Bun__HTTPRequestContextDebugH3__onRejectStream;
}

pub struct StreamPair<'a, ThisServer, const SSL: bool, const DBG: bool, const H3: bool> {
    pub this: &'a mut RequestContext<ThisServer, SSL, DBG, H3>,
    pub stream: WebCore::ReadableStream,
}

pub struct HeaderResponseSizePair<'a, ThisServer, const SSL: bool, const DBG: bool, const H3: bool>
{
    pub this: &'a mut RequestContext<ThisServer, SSL, DBG, H3>,
    pub size: usize,
}

pub struct HeaderResponsePair<'a, ThisServer, const SSL: bool, const DBG: bool, const H3: bool> {
    pub this: &'a mut RequestContext<ThisServer, SSL, DBG, H3>,
    pub response: &'a mut Response,
}

pub struct PathnameFormatter<'a, ThisServer, const SSL: bool, const DBG: bool, const H3: bool> {
    ctx: &'a RequestContext<ThisServer, SSL, DBG, H3>,
}

impl<'a, ThisServer, const SSL: bool, const DBG: bool, const H3: bool> core::fmt::Display
    for PathnameFormatter<'a, ThisServer, SSL, DBG, H3>
where
    ThisServer: ServerLike + 'static,
{
    fn fmt(&self, writer: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let this = self.ctx;

        if !this.pathname.is_empty() {
            return write!(writer, "{}", this.pathname);
        }

        if !this.flags.has_abort_handler() {
            if let Some(req) = this.req {
                // Inlined `req_url` body to avoid carrying the
                // `Transport`/`NativePromiseContextType` bounds onto this
                // formatter impl.
                // SAFETY: req is the live uWS request handle.
                let url: &[u8] = unsafe {
                    if H3 {
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

// `WebCore::Wrap<Self>::init(this)` requires `Self: PipeHandler`.
impl<ThisServer, const SSL_ENABLED: bool, const DEBUG_MODE: bool, const HTTP3: bool>
    WebCore::PipeHandler for RequestContext<ThisServer, SSL_ENABLED, DEBUG_MODE, HTTP3>
where
    ThisServer: ServerLike + 'static,
{
    fn on_pipe(&mut self, stream: WebCore::streams::Result) {
        // Forward to the inherent associated fn (not method-dispatched to avoid
        // recursing into this trait impl).
        RequestContext::on_pipe(self, stream)
    }
}

// Retained only for `renderMetadata` to compute Content-Range / Content-Length
// for file-blob bodies; the actual fd/socket bookkeeping lives in
// `FileResponseStream` now.
#[derive(Default, Clone, Copy)]
pub struct SendfileContext {
    pub remain: BlobSizeType,
    pub offset: BlobSizeType,
    /// When non-zero, the Content-Range total (`/{total}` instead of `/*`).
    pub total: BlobSizeType,
}

// `NewFlags(comptime debug_mode: bool)` — packed struct(u16). All fields are bool
// (with two debug-conditional ones), so `bitflags!` over u16 works. The Zig void/padding
// fields collapse to absent bits in release; here we keep all bits and just gate the
// `is_web_browser_navigation` / `has_finalized` accessors on the const params.
bitflags::bitflags! {
    #[derive(Default, Clone, Copy)]
    pub struct FlagsBits: u16 {
        const HAS_MARKED_COMPLETE         = 1 << 0;
        const HAS_MARKED_PENDING          = 1 << 1;
        const HAS_ABORT_HANDLER           = 1 << 2;
        const HAS_TIMEOUT_HANDLER         = 1 << 3;
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
    }
}

#[repr(transparent)]
#[derive(Default, Clone, Copy)]
pub struct Flags<const DEBUG_MODE: bool>(FlagsBits);

macro_rules! flag_accessor {
    ($get:ident, $set:ident, $bit:ident) => {
        #[inline]
        pub fn $get(&self) -> bool {
            self.0.contains(FlagsBits::$bit)
        }
        #[inline]
        pub fn $set(&mut self, v: bool) {
            self.0.set(FlagsBits::$bit, v)
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
    flag_accessor!(
        has_timeout_handler,
        set_has_timeout_handler,
        HAS_TIMEOUT_HANDLER
    );
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

    #[inline]
    pub fn is_web_browser_navigation(&self) -> bool {
        DEBUG_MODE && self.0.contains(FlagsBits::IS_WEB_BROWSER_NAVIGATION)
    }
    #[inline]
    pub fn set_is_web_browser_navigation(&mut self, v: bool) {
        if DEBUG_MODE {
            self.0.set(FlagsBits::IS_WEB_BROWSER_NAVIGATION, v)
        }
    }

    #[inline]
    pub fn has_finalized(&self) -> bool {
        cfg!(debug_assertions) && self.0.contains(FlagsBits::HAS_FINALIZED)
    }
    #[inline]
    pub fn set_has_finalized(&mut self, v: bool) {
        #[cfg(debug_assertions)]
        self.0.set(FlagsBits::HAS_FINALIZED, v);
        #[cfg(not(debug_assertions))]
        let _ = v;
    }
}

fn get_content_type(headers: Option<&mut FetchHeaders>, blob: &AnyBlob) -> (MimeType, bool, bool) {
    let mut needs_content_type = true;
    let mut content_type_needs_free = false;

    let content_type: MimeType = 'brk: {
        if let Some(headers_) = headers {
            if let Some(content) = headers_.fast_get(jsc::HTTPHeaderName::ContentType) {
                needs_content_type = false;

                let content_slice = content.to_slice();
                // Zig: `if (content_slice.allocator.isNull()) null else allocator` —
                // i.e. dupe only when the latin1/utf16 slice was heap-converted.
                let dupe = matches!(content_slice, bun_core::ZigStringSlice::Owned(_));
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

// ported from: src/runtime/server/RequestContext.zig
