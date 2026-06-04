use core::ffi::c_void;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use bun_boringssl as boringssl;
use bun_core::{Error as BunError, err};
use bun_core::{MutableString, OwnedString, String as BunString, ZigStringSlice};
use bun_event_loop::{
    AnyTask::AnyTask,
    ConcurrentTask::{AutoDeinit, ConcurrentTask},
    Task, Taskable,
};
use bun_http as http;
use bun_http::Method;
use bun_http::{
    AsyncHTTP, CertificateInfo, FetchRedirect, HTTPClientResult, HTTPResponseMetadata, Headers,
    Signals, ThreadSafeStreamBuffer,
};
use bun_io::KeepAlive;
use bun_jsc::debugger::AsyncTaskTracker;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, GlobalRef, JSGlobalObject, JSValue, JsResult, StringJsc, StrongOptional,
};
use bun_sys::FdExt;
use bun_threading::{Guarded, GuardedLock, Mutex};
use bun_url::URL as ZigURL;

use crate::api::bun_x509 as X509;
use crate::webcore::blob::{Any as AnyBlob, Blob, SizeType as BlobSizeType, Store as BlobStore};
use crate::webcore::body::{self, Body, Value as BodyValue, ValueError as BodyValueError};
use crate::webcore::readable_stream::{ReadableStream, Strong as ReadableStreamStrong};
use crate::webcore::response::HeadersRef;
use crate::webcore::resumable_sink::ResumableFetchSink;
use crate::webcore::streams::{StreamError, StreamResult};
use crate::webcore::{
    AbortSignal, DrainResult, FetchHeaders, InternalBlob, Response, ResumableSinkBackpressure,
};

use bun_jsc::JsTerminatedResult;
// PORT NOTE: `bun_event_loop::JsResult` (cycle-broken erased error) — used by
// ConcurrentTask/AnyTask callbacks at the tier-3 layer.
type ElJsResult<T> = bun_event_loop::JsResult<T>;

use boringssl::c::{X509_free, d2i_X509};

// ConcurrentTask::from() needs `Taskable`; tag is declared in bun_event_loop
// but the impl lives next to the type (cycle-break).
impl Taskable for FetchTasklet {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::FetchTasklet;
}

bun_output::declare_scope!(FetchTasklet, visible);

pub(crate) type ResumableSink = ResumableFetchSink;

/// State only the JS thread touches. Never read or written from
/// `FetchTasklet::callback` / `release_at_shutdown` (HTTP thread) — including
/// at shutdown, which only touches `shared`, the atomics, and the refcount.
struct JsState {
    global_this: GlobalRef,
    // PORT NOTE: ResumableSink is intrusively refcounted (`ref_count: Cell<u32>` +
    // heap::alloc); `Arc` can't be mutably borrowed for `cancel/drain`, so model
    // as a raw pointer like Zig's `?*ResumableSink`.
    sink: Option<*mut ResumableSink>,
    /// Blob bytes are borrowed (lifetime-erased) by `AsyncHTTP` until the final
    /// callback; only detached in `clear_data`.
    request_body: HTTPRequestBody,
    /// response weak ref we need this to track the response JS lifetime
    response: jsc::Weak<FetchTasklet>,
    /// native response ref if we still need it when JS is discarted
    // PORT NOTE: Response is intrusively refcounted; raw ptr matches Zig `?*Response`.
    native_response: Option<*mut Response>,
    /// stream strong ref if any is available
    readable_stream_ref: ReadableStreamStrong,
    promise: jsc::JSPromiseStrong,
    poll_ref: KeepAlive,
    /// Must be stored because AbortSignal stores reason weakly. May be set by
    /// JS that runs *while the tasklet mutex is held* (sink `write_end_request`
    /// re-entry, read back at the abort check) — must stay outside the guarded set.
    abort_reason: StrongOptional,
    // custom checkServerIdentity
    check_server_identity: StrongOptional,
    // PORT NOTE: WebCore::AbortSignal is C++-refcounted (intrusive). Model as
    // raw ptr like Zig's `?*AbortSignal`; ref/unref via `bun_jsc::AbortSignal`
    // methods (see clear_abort_signal / queue).
    signal: Option<*mut AbortSignal>,
    tracker: AsyncTaskTracker,
    // Independent, overlapping flags — NOT a state machine: stream-start can
    // coexist with waiting-body (server may respond before the upload reaches
    // body stage). Do not replace with an enum.
    is_waiting_body: bool,
    is_waiting_abort: bool,
    is_waiting_request_stream_start: bool,
}

/// HTTP→JS handoff state, only reachable through `FetchTasklet::shared.lock()`
/// (HTTP thread writes in `callback`; JS thread drains in `on_progress_update`
/// / `on_start_streaming_http_response_body_callback`).
struct HttpHandoff {
    /// Latest progress snapshot (`detach_lifetime`d). `body` is `None`d before
    /// storage — the bytes live in `FetchTasklet::response_buffer` and are staged
    /// into `scheduled_response_buffer`; the alias is asserted on the *incoming*
    /// result in `callback` instead.
    result: HTTPClientResult<'static>,
    /// Response headers; set at most once, consumed by `to_response`.
    metadata: Option<HTTPResponseMetadata>,
    /// Body bytes staged for JS delivery: HTTP thread appends in `callback`,
    /// JS drains and resets.
    scheduled_response_buffer: MutableString,
    /// For Http Client requests
    /// when Content-Length is provided this represents the whole size of the request
    /// If chunked encoded this will represent the total received size (ignoring the chunk headers)
    /// If is not chunked encoded and Content-Length is not provided this will be unknown
    body_size: http::BodySize,
}

/// One in-flight `fetch()`, shared between the JS thread (promise/body
/// delivery) and the HTTP thread (socket I/O) for the request's lifetime.
///
/// # Refs
///
/// `ref_count` starts at 2 — one baseline ref per thread:
///
/// | ref | acquired (thread) | released (thread) |
/// |---|---|---|
/// | JS baseline | `get` — `init_exact_refs(2)` (JS) | `on_progress_update` final-tick cleanup or shutdown early-out (`release_js_ref`, JS); `callback`'s shutdown branch and `release_at_shutdown` (raw `deref_from_thread`, HTTP, JS thread parked); `release_queued_tasks_for_shutdown` in dispatch.rs (`release_js_ref`, JS) |
/// | HTTP baseline | `get` — `init_exact_refs(2)` (JS, on the HTTP thread's behalf) | final `callback` or `release_at_shutdown` (`release_http_ref`, HTTP) |
/// | sink | `start_request_stream` (JS) | every `write_end_request` exit (`release_sink_ref`, JS); at exit, whichever path reaches the tasklet first claims it via `take_streaming_refs_for_exit`: `release_at_shutdown`, `callback`'s shutdown branch (both HTTP, `deref_from_thread`), dispatch.rs's `__bun_release_task_at_shutdown` FetchTasklet arm, or `on_progress_update`'s shutdown early-out (both JS, `deref`) |
/// | drain task | `on_write_request_data_drain` (HTTP) | `resume_request_data_stream` (`release_drain_task_ref`, JS); at exit, per `queued_drain_tasks` for nodes dropped unrun — same take paths as the sink row |
///
/// # Lock invariants
///
/// User JS may run while the `shared` lock is held: `on_progress_update`
/// drains the JSC microtask queue, runs `checkServerIdentity`, and can
/// re-enter the sink's `cancel`/`pull` — all under the lock. JS reachable
/// from there must never take the `shared` lock — it is non-recursive, so a
/// relock is a deadlock. This is why `ignore_data` is an atomic: the
/// GC-finalizer chain `on_response_finalize` →
/// `ignore_remaining_response_body` must stay lock-free. Likewise a
/// Locked-body `Response` must not be first-touched (`res.body`) from JS
/// running under the lock — `res.body` →
/// `on_start_streaming_http_response_body_callback` relocks.
///
/// # Lock order
///
/// `shared` lock → `ThreadSafeStreamBuffer`'s internal mutex; never the
/// reverse.
///
/// # Final drop
///
/// The last release must route through `deref`/`deref_from_thread` so JSC
/// handles die on the JS thread: `deinit` runs JS-side (bounced via
/// `deinit_callback` if the last ref drops on the HTTP thread), and
/// `dealloc_for_shutdown` only parks the box when the VM is exiting.
#[derive(bun_ptr::ThreadSafeRefCounted)]
#[ref_count(destroy = FetchTasklet::deinit)]
pub struct FetchTasklet {
    javascript_vm: &'static VirtualMachine,
    /// `buf` leased `'static` to `AsyncHTTP` in `get()`.
    request_headers: Headers,
    /// This is url + proxy memory buffer and is owned by FetchTasklet
    /// We always clone url and proxy (if informed)
    url_proxy_buffer: Box<[u8]>,
    /// Custom hostname; leased `'static` to `AsyncHTTP` in `get()`.
    hostname: Option<Box<[u8]>>,
    reject_unauthorized: bool,
    upgraded_connection: bool,

    /// JS-thread-only state.
    js: JsState,

    /// HTTP↔JS shared state, owned by the lock. NOTE: user JS can run while
    /// the lock is held — see the struct doc.
    shared: Guarded<HttpHandoff>,

    // Self-referential: borrows from `js.request_body` / `request_headers` owned
    // by sibling fields, so the lifetime is erased to `'static`.
    /// Stable heap Box. JS posts http-thread messages and atomic-signal
    /// stores lock-free; the HTTP thread copies progress fields back via
    /// `sync_progress_from` only under the `shared` lock.
    http: Option<Box<AsyncHTTP<'static>>>,
    /// Leased to `AsyncHTTP` by raw pointer (`get()`); the HTTP thread's socket
    /// path appends lock-free between callbacks; `callback` drains it under the
    /// `shared` lock; capacity freed on the JS thread in `clear_data`.
    response_buffer: MutableString,
    // PORT NOTE: ThreadSafeStreamBuffer is intrusively refcounted (`ref_count: AtomicU32`,
    // starts at 2) and shared with the HTTP thread via raw ptr; `Arc` can't be mutably
    // borrowed for `acquire/release`. Model as a raw pointer like Zig's
    // `?*http.ThreadSafeStreamBuffer`.
    /// Has its own internal mutex; see "Lock order" in the struct doc.
    request_body_streaming_buffer: Option<core::ptr::NonNull<ThreadSafeStreamBuffer>>,
    /// Inline node reused for the coalesced progress task; one-in-flight is
    /// guaranteed by the `has_schedule_callback` CAS.
    concurrent_task: ConcurrentTask,
    has_schedule_callback: AtomicBool,
    /// JS abandoned the body (GC finalizer / stream cancel). Relaxed: a stale
    /// `false` on the HTTP side costs one extra buffered chunk, freed next callback.
    ignore_data: AtomicBool,
    /// Mirror of `result.is_http2`, stored by `callback` under the lock, read
    /// lock-free by `skip_chunked_framing` on the request-write path.
    is_http2: AtomicBool,
    /// True while the request-body sink's ref on this tasklet (taken in
    /// `start_request_stream`) is outstanding, i.e. until `release_sink_ref`
    /// drops it. Written on the JS thread; read by `release_at_shutdown` on
    /// the HTTP thread while the JS thread is parked in `shutdown_for_exit`
    /// (race-free, same argument as `has_schedule_callback` there).
    sink_ref_held: AtomicBool,
    /// Number of `resume_request_data_stream` tasks currently parked in the
    /// JS concurrent queue, each owning one drain-task ref. Incremented with
    /// the ref on the HTTP thread (`on_write_request_data_drain`),
    /// decremented with its release on the JS thread
    /// (`release_drain_task_ref`). Read by `release_at_shutdown` on the HTTP
    /// thread with the JS thread parked: those queue nodes are
    /// `ManagedTask`-tagged, which `release_queued_tasks_for_shutdown`
    /// cannot release (the ctx type is erased), so their refs are balanced
    /// there instead.
    queued_drain_tasks: AtomicU32,
    signal_store: http::signals::Store,
    signals: Signals,

    /// Starts at 2: 1 for the JS thread, 1 for the HTTP thread (ref table in
    /// the struct doc).
    ref_count: bun_ptr::ThreadSafeRefCount<FetchTasklet>,
}

impl HttpHandoff {
    fn size_hint(&self) -> BlobSizeType {
        match self.body_size {
            http::BodySize::ContentLength(n) => n as BlobSizeType,
            http::BodySize::TotalReceived(n) => n as BlobSizeType,
            http::BodySize::Unknown => 0,
        }
    }

    /// HTTP-thread merge of a progress result: sticky one-shot `can_stream`,
    /// preserve pending `certificate_info`, accept `metadata` exactly once,
    /// copy `body_size`.
    fn merge_result(&mut self, result: HTTPClientResult<'static>) {
        let prev_metadata = self.result.metadata.take();
        let prev_cert_info = self.result.certificate_info.take();
        let prev_can_stream = self.result.can_stream;
        self.result = result;
        // can_stream is a one-shot signal to start the request body stream; don't let a
        // later coalesced result clobber it before the JS thread sees it.
        self.result.can_stream = self.result.can_stream || prev_can_stream;

        // Preserve pending certificate info if it was preovided in the previous update.
        if self.result.certificate_info.is_none() {
            if let Some(cert_info) = prev_cert_info {
                self.result.certificate_info = Some(cert_info);
            }
        }

        // metadata should be provided only once
        if let Some(metadata) = self.result.metadata.take().or(prev_metadata) {
            bun_output::scoped_log!(FetchTasklet, "added callback metadata");
            if self.metadata.is_none() {
                self.metadata = Some(metadata);
            }

            self.result.metadata = None;
        }

        self.body_size = self.result.body_size;
    }

    /// HTTP-thread side of the body handoff: copy the socket-accumulated bytes
    /// into the JS-delivery buffer and reset the HTTP buffer for reuse.
    fn stage_response_bytes(&mut self, response_buffer: &mut MutableString) {
        bun_core::handle_oom(
            self.scheduled_response_buffer
                .write(response_buffer.list.as_slice()),
        );
        // reset for reuse
        response_buffer.reset();
    }
}

impl JsState {
    // ───── raw-ptr field accessors (centralised unsafe) ───────────────────
    //
    // `signal` / `sink` / `native_response` are intrusive-refcounted heap
    // objects that this tasklet holds one strong ref on while the field is
    // `Some`. They are never reborrowed through any other path on the JS
    // thread, so a single `&` / `&mut` derived here is the sole live borrow.

    /// `Some(&AbortSignal)` while we hold a strong ref on the C++-owned
    /// `WebCore::AbortSignal*` (taken in `queue`, released in
    /// `clear_abort_signal`).
    #[inline]
    fn abort_signal(&self) -> Option<&AbortSignal> {
        // S008: `AbortSignal` is an `opaque_ffi!` ZST handle — safe `*const → &`.
        self.signal.map(|p| bun_opaque::opaque_deref(p))
    }

    /// True iff an attached AbortSignal has fired.
    #[inline]
    fn signal_aborted(&self) -> bool {
        self.abort_signal().is_some_and(|s| s.aborted())
    }

    /// Mutable access to the request-body sink while `self.sink` is `Some`
    /// (one strong ref held from `init_exact_refs` until `clear_sink`).
    #[inline]
    fn sink_mut(&mut self) -> Option<&mut ResumableSink> {
        // SAFETY: see block comment above. JS-thread-only.
        self.sink.map(|p| unsafe { &mut *p })
    }

    fn get_current_response(&self) -> Option<*mut Response> {
        // we need a body to resolve the promise when buffering
        if let Some(response) = self.native_response {
            return Some(response);
        }

        // if we did not have a direct reference we check if the Weak ref is still alive
        if let Some(response_js) = self.response.get() {
            if let Some(response) = response_js.as_::<Response>() {
                return Some(response);
            }
        }

        None
    }

    /// `&mut`-yielding form of [`get_current_response`].
    ///
    /// INVARIANT: when `Some`, the pointer is either `native_response` (one
    /// strong native ref held by the tasklet until `unref` in cleanup) or the
    /// `JSValue::as_::<Response>()` deref of a live JS handle pinned by
    /// `self.response`. The `Response` is a separate JSC-cell allocation
    /// disjoint from `FetchTasklet`, so the returned `&mut` does not overlap
    /// any `&mut self` the caller may take afterwards (hence the unbounded
    /// `'a`). JS-thread-only; no concurrent `&mut` exists.
    #[inline]
    fn current_response_mut<'a>(&self) -> Option<&'a mut Response> {
        // SAFETY: see INVARIANT above.
        self.get_current_response().map(|r| unsafe { &mut *r })
    }

    fn get_abort_error(&mut self, task: *mut FetchTasklet) -> Option<BodyValueError> {
        if self.abort_reason.has() {
            let out = core::mem::replace(&mut self.abort_reason, StrongOptional::empty());
            self.clear_abort_signal(task);
            return Some(BodyValueError::JSValue(out));
        }

        if let Some(signal) = self.abort_signal() {
            if let Some(reason) = signal.reason_if_aborted(&self.global_this) {
                // PORT NOTE: `AbortReason::to_body_value_error` lives in bun_jsc but
                // would forward-depend on bun_runtime; reconstruct the trivial
                // mapping at the call site (per AbortSignal.rs note).
                let out = match reason {
                    jsc::abort_signal::AbortReason::Common(r) => BodyValueError::AbortReason(r),
                    jsc::abort_signal::AbortReason::Js(v) => {
                        BodyValueError::JSValue(StrongOptional::create(v, &self.global_this))
                    }
                };
                self.clear_abort_signal(task);
                return Some(out);
            }
        }

        None
    }

    /// `task` is the owning tasklet; the C++ side uses it as an identity key only.
    fn clear_abort_signal(&mut self, task: *mut FetchTasklet) {
        let Some(signal) = self.signal.take() else {
            return;
        };
        // `signal` is a live C++-owned WebCore::AbortSignal*; we hold one ref
        // (taken in `fetch.zig` before populating FetchOptions). Order matches Zig
        // `clearAbortSignal`: cleanNativeBindings first, then defer{unref+pendingUnref}.
        // S008: `AbortSignal` is an `opaque_ffi!` ZST — safe `*const → &`.
        let signal = bun_opaque::opaque_deref(signal);
        signal.clean_native_bindings(task.cast::<c_void>());
        signal.pending_activity_unref();
        signal.unref();
    }

    /// Clear the cancel_handler on the ByteStream.Source to prevent use-after-free.
    /// Must be called before releasing readable_stream_ref, while the Strong ref
    /// still keeps the ReadableStream (and thus the ByteStream.Source) alive.
    fn clear_stream_cancel_handler(&mut self) {
        if let Some(readable) = self.readable_stream_ref.get(&self.global_this) {
            if let Some(bytes) = readable.ptr.bytes() {
                // R-2: project to the parent `NewSource` via `&self`; the two
                // fields are `Cell`-wrapped for exactly this caller.
                let source = bytes.parent_const();
                source.cancel_handler.set(None);
                source.cancel_ctx.set(None);
            }
        }
    }
}

/// Disjoint borrows of `FetchTasklet`, split off before taking `shared.lock()`,
/// so lock-held helpers keep access to JS-side state. Compiles to nothing.
struct Parts<'t> {
    js: &'t mut JsState,
    http: &'t mut Option<Box<AsyncHTTP<'static>>>,
    signal_store: &'t http::signals::Store,
    has_schedule_callback: &'t AtomicBool,
    reject_unauthorized: bool,
    vm: &'static VirtualMachine,
    /// For refcount ops, `PendingValue.task`, the sink ctx, and
    /// `Weak::create_ptr` — same raw-ptr-alongside-borrows convention as the
    /// existing `from_ctx` / `from_raw_mut` sites: derived before the field
    /// borrows, never used to form `&`/`&mut FetchTasklet` while they are live.
    task: *mut FetchTasklet,
}

// Boxing `AnyBlob` is not viable: the `AnyBlob` arm is constructed/matched in
// `fetch.rs` (e.g. `HTTPRequestBodyExt::any_blob`) and would require changes
// across files. The enum is also short-lived per-request, so the size cost is bounded.
#[allow(clippy::large_enum_variant)]
pub enum HTTPRequestBody {
    AnyBlob(AnyBlob),
    Sendfile(http::SendFile),
    ReadableStream(ReadableStreamStrong),
}

impl Default for HTTPRequestBody {
    fn default() -> Self {
        // PORT NOTE: Zig `= .{ .AnyBlob = .{} }`; `Blob` has no `const EMPTY`
        // (non-Copy fields), so use the runtime `Default` instead of a const.
        HTTPRequestBody::AnyBlob(AnyBlob::Blob(Blob::default()))
    }
}

impl HTTPRequestBody {
    pub fn store(&self) -> Option<&BlobStore> {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.store(),
            _ => None,
        }
    }

    pub fn slice(&self) -> &[u8] {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.slice(),
            _ => b"",
        }
    }

    pub fn detach(&mut self) {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.detach(),
            HTTPRequestBody::ReadableStream(stream) => {
                stream.deinit();
            }
            HTTPRequestBody::Sendfile(sendfile) => {
                if sendfile.offset.max(sendfile.remain) > 0 {
                    sendfile.fd.close();
                }
                sendfile.offset = 0;
                sendfile.remain = 0;
            }
        }
    }

    pub fn from_js(global_this: &JSGlobalObject, value: JSValue) -> JsResult<HTTPRequestBody> {
        let mut body_value = BodyValue::from_js(global_this, value)?;
        if matches!(body_value, BodyValue::Used)
            || (matches!(&body_value, BodyValue::Locked(l) if !l.action.is_none() || l.is_disturbed2(global_this)))
        {
            return Err(global_this
                .err(
                    jsc::ErrorCode::BODY_ALREADY_USED,
                    format_args!("body already used"),
                )
                .throw());
        }
        if let BodyValue::Locked(locked) = &mut body_value {
            if locked.readable.has() {
                // PORT NOTE: `BodyValue` now has `Drop` (H3), so we cannot move
                // `l.readable` out by value (E0509). `mem::take` leaves a default
                // readable; `Value::drop` on the residual `Locked` then runs
                // `readable.deinit()` on that default — a no-op.
                return Ok(HTTPRequestBody::ReadableStream(core::mem::take(
                    &mut locked.readable,
                )));
            }
        }
        if matches!(&body_value, BodyValue::Locked(_)) {
            let readable = body_value.to_readable_stream(global_this)?;
            if !readable.is_empty_or_undefined_or_null() {
                if let BodyValue::Locked(l) = &mut body_value {
                    if l.readable.has() {
                        // See PORT NOTE above re: E0509 and `Value::drop`.
                        return Ok(HTTPRequestBody::ReadableStream(core::mem::take(
                            &mut l.readable,
                        )));
                    }
                }
            }
        }
        Ok(HTTPRequestBody::AnyBlob(body_value.use_as_any_blob()))
    }

    pub fn needs_to_read_file(&self) -> bool {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.needs_to_read_file(),
            _ => false,
        }
    }

    pub fn is_s3(&self) -> bool {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.is_s3(),
            _ => false,
        }
    }

    pub fn has_content_type_from_user(&self) -> bool {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.has_content_type_from_user(),
            _ => false,
        }
    }

    pub fn get_any_blob(&mut self) -> Option<&mut AnyBlob> {
        match self {
            HTTPRequestBody::AnyBlob(blob) => Some(blob),
            _ => None,
        }
    }

    pub fn has_body(&mut self) -> bool {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.size() > 0,
            HTTPRequestBody::ReadableStream(stream) => stream.has(),
            HTTPRequestBody::Sendfile(_) => true,
        }
    }
}

impl FetchTasklet {
    /// Recover `&mut Self` from a type-erased `*mut c_void` callback context.
    ///
    /// INVARIANT: every callback that stores a `FetchTasklet*` as `ctx` (the
    /// readable-stream available/start-streaming hooks and the ByteStream
    /// cancel handler) holds one strong ref on the tasklet for the lifetime
    /// of the registration, and fires only on the JS thread — so the returned
    /// `&mut` is the sole live borrow.
    #[inline]
    fn from_ctx<'a>(ctx: *mut c_void) -> &'a mut Self {
        // SAFETY: see INVARIANT above.
        unsafe { bun_ptr::callback_ctx::<FetchTasklet>(ctx) }
    }

    /// Recover `&mut Self` from a `*mut FetchTasklet` callback arg.
    ///
    /// INVARIANT: every `*mut FetchTasklet` threaded through the HTTP-thread
    /// callback (`callback`), the drain hook (`on_write_request_data_drain` /
    /// `resume_request_data_stream`), and the JS-thread enqueue
    /// (`queue` → `node`) was produced by `heap::into_raw(Box<FetchTasklet>)`
    /// in `get()` and is kept alive by the intrusive `ref_count` until
    /// `deinit`. Access on either thread is serialised: HTTP-thread writes
    /// happen under the `shared` lock and JS-thread access is single-threaded.
    #[inline]
    fn from_raw_mut<'a>(this: *mut FetchTasklet) -> &'a mut Self {
        // SAFETY: see INVARIANT above.
        unsafe { &mut *this }
    }
    /// Shared variant of [`from_raw_mut`] for paths that only read atomics
    /// (`ref_count`, `is_shutting_down`) before deciding whether to upgrade.
    #[inline]
    fn from_raw_ref<'a>(this: *mut FetchTasklet) -> &'a Self {
        // SAFETY: see [`from_raw_mut`] INVARIANT.
        unsafe { &*this }
    }

    /// Split disjoint borrows off `self` so `shared.lock()` (which borrows
    /// `&self.shared`) can coexist with mutable JS-side state access.
    fn split(&mut self) -> (Parts<'_>, &Guarded<HttpHandoff>) {
        let task: *mut FetchTasklet = self; // derive BEFORE the field borrows
        let vm = self.javascript_vm;
        let reject_unauthorized = self.reject_unauthorized;
        let Self {
            js,
            http,
            signal_store,
            has_schedule_callback,
            shared,
            ..
        } = self;
        (
            Parts {
                js,
                http,
                signal_store,
                has_schedule_callback,
                reject_unauthorized,
                vm,
                task,
            },
            shared,
        )
    }

    /// Enqueue a concurrent task on the JS-thread event loop.
    ///
    /// Centralises the `(*vm.event_loop()).enqueue_task_concurrent(..)` raw
    /// deref. `event_loop()` returns a self-ptr into the VirtualMachine that
    /// is valid for the VM's lifetime; `enqueue_task_concurrent` takes `&self`
    /// and is thread-safe (lock-free MPSC push). `task` is a live
    /// `ConcurrentTaskItem` that the queue takes ownership of via its
    /// intrusive `next` link.
    #[inline]
    fn enqueue_concurrent(vm: &VirtualMachine, task: core::ptr::NonNull<ConcurrentTask>) {
        vm.event_loop_shared().enqueue_task_concurrent(task);
    }

    /// Wrap a borrowed body chunk in a `StreamResult::Temporary*` for
    /// synchronous delivery to `ByteStream::on_data`.
    ///
    /// INVARIANT (module): `chunk` borrows `scheduled_response_buffer` (or
    /// another tasklet-owned buffer) which strictly outlives the synchronous
    /// `on_data` call per the `StreamResult::Temporary*` contract — `on_data`
    /// copies/consumes before returning and never retains the slice.
    #[inline]
    fn temporary_chunk(chunk: &[u8], done: bool) -> StreamResult {
        // See INVARIANT above. `RawSlice` is non-owning; backing buffer
        // outlives the synchronous `on_data` call.
        let v = bun_ptr::RawSlice::new(chunk);
        if done {
            StreamResult::TemporaryAndDone(v)
        } else {
            StreamResult::Temporary(v)
        }
    }

    /// Mutable access to the request-body streaming buffer while `Some` (this
    /// side holds one of the two initial intrusive refs from
    /// `ThreadSafeStreamBuffer::new`; released in `clear_sink`). Detached
    /// lifetime so the borrow does not conflict with disjoint `&mut self`
    /// access at call sites — the buffer lives in a separate heap allocation
    /// shared with the HTTP thread (mutex-guarded internally).
    #[inline]
    fn stream_buffer_mut<'r>(&self) -> Option<&'r mut ThreadSafeStreamBuffer> {
        // SAFETY: see doc comment — counted ref keeps pointee live; mutex
        // inside `ThreadSafeStreamBuffer` serialises cross-thread `buffer`
        // access, and `callback` is main-thread-only.
        self.request_body_streaming_buffer
            .map(|p| unsafe { &mut *p.as_ptr() })
    }

    pub(crate) fn ref_(&self) {
        Self::ref_ptr(core::ptr::from_ref(self).cast_mut());
    }

    /// Raw-pointer form of [`Self::ref_`] for code where no `&self` is available.
    #[inline]
    fn ref_ptr(this: *mut Self) {
        // SAFETY: caller holds an existing ref, so `this` is live; `ref_` only
        // touches the interior-mutable atomic counter.
        unsafe { bun_ptr::ThreadSafeRefCount::<Self>::ref_(this) };
    }

    /// # Safety
    /// Caller holds a ref; `this` must be a live heap allocation from `get()`.
    // Forwards `this` to ThreadSafeRefCount without dereferencing; signature must stay
    // `*mut` because the call may drop the last ref and free the allocation, so a `&mut`
    // here would be UB.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn deref(this: *mut FetchTasklet) {
        // SAFETY: caller contract.
        unsafe { bun_ptr::ThreadSafeRefCount::<Self>::deref(this) };
    }

    /// # Safety
    /// Caller holds a ref; `this` must be a live heap allocation from `get()`.
    // Forwards `this` to ThreadSafeRefCount/dealloc without dereferencing; signature must
    // stay `*mut` because the call may drop the last ref and free the allocation.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn deref_from_thread(this: *mut FetchTasklet) {
        // SAFETY: caller contract.
        if !unsafe { bun_ptr::ThreadSafeRefCount::<Self>::release(this) } {
            return;
        }
        let self_ = Self::from_raw_ref(this);
        if self_.javascript_vm.is_shutting_down() {
            // SAFETY: last ref; exclusive access. `deinit()` would run
            // `clear_data()` + `Drop` for the JSC `Strong`/`Weak` fields, which
            // reach into the VM's HandleSet from this (HTTP) thread — not
            // thread-safe. Reclaim only the Rust-side boxes; the HandleSet is
            // freed wholesale by `destructOnExit`.
            unsafe { FetchTasklet::dealloc_for_shutdown(this) };
            return;
        }
        // this is really unlikely to happen, but can happen
        // lets make sure that we always call deinit from main thread
        // `from_callback` heap-allocates a fresh `ConcurrentTaskItem`; the queue
        // takes ownership of it.
        Self::enqueue_concurrent(
            self_.javascript_vm,
            ConcurrentTask::from_callback(this, FetchTasklet::deinit_callback),
        );
    }

    /// JS-side baseline ref (held since `get`). Released by `on_progress_update`'s
    /// cleanup on the final tick, its shutdown early-out, or
    /// `release_queued_tasks_for_shutdown` (dispatch.rs). JS thread only.
    #[inline]
    pub(crate) fn release_js_ref(this: *mut FetchTasklet) {
        Self::deref(this);
    }

    /// HTTP-side baseline ref (held since `get`). Released by the final
    /// `callback` or `release_at_shutdown`. Must not be called with the
    /// `shared` lock held: this may free the allocation the mutex lives in.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    #[inline]
    pub(crate) fn release_http_ref(this: *mut FetchTasklet) {
        // SAFETY: sound only because the caller still holds the ref being
        // released, so `this` is live for the read. (Callers without that
        // guarantee must not use this wrapper — the assert itself would be a
        // UAF in debug builds.)
        debug_assert!(unsafe { !(*this).shared.raw_mutex().is_held_by_current_thread() });
        Self::deref_from_thread(this);
    }

    /// Sink ref taken in `start_request_stream`; released once per
    /// `write_end_request` exit. JS thread both sides (plus
    /// `release_at_shutdown`'s balancing drop when the JS thread is parked —
    /// that path derefs raw and relies on this clearing `sink_ref_held`
    /// before the count can drop).
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    #[inline]
    pub(crate) fn release_sink_ref(this: *mut FetchTasklet) {
        // SAFETY: the caller holds the sink ref being released, so `this` is
        // live for the store; clear the marker before the deref below can
        // free the allocation.
        unsafe { (*this).sink_ref_held.store(false, Ordering::Release) };
        Self::deref(this);
    }

    /// Drain-task ref taken on the HTTP thread in `on_write_request_data_drain`;
    /// released on the JS thread in `resume_request_data_stream` (or balanced
    /// at exit via `take_streaming_refs_for_exit` when the queued node is
    /// dropped unrun).
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    #[inline]
    pub(crate) fn release_drain_task_ref(this: *mut FetchTasklet) {
        // SAFETY: the caller holds the drain-task ref being released, so
        // `this` is live for the store; decrement before the deref below can
        // free the allocation.
        unsafe { (*this).queued_drain_tasks.fetch_sub(1, Ordering::Release) };
        Self::deref(this);
    }

    /// Atomically take the streaming-upload ref markers (`sink_ref_held`,
    /// `queued_drain_tasks`) and return how many refs the caller must now
    /// release. Their JS-thread release sites can never run once the VM is
    /// exiting, and a final `callback` in the exit window removes the entry
    /// from `in_flight`, so four exit paths can each be the one that reaches
    /// a given tasklet: `release_at_shutdown`, `callback`'s shutdown branch,
    /// `__bun_release_task_at_shutdown`'s FetchTasklet arm (dispatch.rs, for
    /// a progress node that out-survived its tasklet's `in_flight` entry),
    /// and `on_progress_update`'s shutdown early-out (for a node dispatched
    /// after `is_shutting_down` flipped — defensive, the loop does not tick
    /// then today). The `swap` take makes them idempotent against one
    /// another — whichever runs first claims the refs, the rest see zero.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn take_streaming_refs_for_exit(this: *mut FetchTasklet) -> u32 {
        // SAFETY: the caller holds a ref, so `this` is live for the swaps.
        let sink = unsafe { (*this).sink_ref_held.swap(false, Ordering::AcqRel) };
        // SAFETY: as above.
        let drains = unsafe { (*this).queued_drain_tasks.swap(0, Ordering::AcqRel) };
        u32::from(sink) + drains
    }

    // PORT NOTE: ConcurrentTask::from_callback takes `fn(*mut T) -> bun_event_loop::JsResult<()>`
    // (cycle-broken erased error); Zig coerced `error{}!void` automatically.
    fn deinit_callback(this: *mut FetchTasklet) -> ElJsResult<()> {
        // SAFETY: enqueued with last ref; exclusive access on main thread
        unsafe { FetchTasklet::deinit(this) };
        Ok(())
    }

    // PORT NOTE: Zig `pub fn init(_: std.mem.Allocator) anyerror!FetchTasklet { return FetchTasklet{}; }`
    // was dead code — `FetchTasklet{}` would not compile if analyzed (promise/mutex/tracker lack
    // defaults). All callers use `get()` directly. Dropped in the port.

    fn clear_sink(&mut self) {
        if let Some(sink) = self.js.sink.take() {
            // SAFETY: sink came from init_exact_refs; FetchTasklet holds one ref.
            // Detach the JS side first so that, if the sink's JS wrapper still
            // holds the other ref (i.e. `deref_` below won't drop the count to 0
            // and so won't run `Drop`/`detachJS`), the wrapper stops being rooted
            // by `js_this` and the cached `ondrain` closure (+ stream graph) can
            // be collected. `detach_js` runs no JS callbacks, so it is safe even
            // though this runs during `deinit`.
            unsafe {
                (*sink).detach_js();
                ResumableFetchSink::deref_(sink);
            }
        }
        if let Some(buffer) = self.request_body_streaming_buffer.take() {
            // SAFETY: intrusive-refcounted heap allocation from `ThreadSafeStreamBuffer::new`;
            // this side holds one of the two initial refs. Mutex guards cross-thread access
            // to `buffer`, and `callback` is only touched on the main thread (here).
            unsafe { (*buffer.as_ptr()).clear_drain_callback() };
            ThreadSafeStreamBuffer::deref(buffer);
        }
    }

    fn clear_data(&mut self) {
        bun_output::scoped_log!(FetchTasklet, "clearData ");
        if !self.url_proxy_buffer.is_empty() {
            self.url_proxy_buffer = Box::default();
        }

        if let Some(_hostname) = self.hostname.take() {
            // dropped by Box
        }

        // JS thread with no HTTP-side writer left: `get_mut` (re-borrowed per
        // statement) proves exclusive access without taking the lock.
        if let Some(certificate) = self.shared.get_mut().result.certificate_info.take() {
            drop(certificate);
        }

        // PORT NOTE: Zig `entries.deinit()` + `buf.deinit()`; Rust drop on
        // assignment runs the same cleanup. MultiArrayList has no `clear()`.
        self.request_headers = Headers::default();

        if let Some(http_) = self.http.as_mut() {
            http_.clear_data();
        }

        if let Some(metadata) = self.shared.get_mut().metadata.take() {
            drop(metadata);
        }

        self.response_buffer = MutableString::default();
        self.js.response.clear();
        if let Some(response) = self.js.native_response.take() {
            // SAFETY: `response` is the +1 ref held in `native_response`.
            Response::unref(response);
        }

        self.js.clear_stream_cancel_handler();
        self.js.readable_stream_ref.deinit();

        self.shared.get_mut().scheduled_response_buffer = MutableString::default();
        // Always detach request_body regardless of type.
        // When request_body is a ReadableStream, startRequestStream() creates
        // an independent Strong reference in ResumableSink, so FetchTasklet's
        // reference becomes redundant and must be released to avoid leaks.
        self.js.request_body.detach();

        self.js.abort_reason.deinit();
        self.js.check_server_identity.deinit();
        let task = core::ptr::from_mut(&mut *self);
        self.js.clear_abort_signal(task);
        // Clear the sink only after the requested ended otherwise we would potentialy lose the last chunk
        self.clear_sink();
    }

    // XXX: in Zig 'fn (*FetchTasklet) error{}!void' coerces to 'fn (*FetchTasklet) bun.JSError!void' but 'fn (*FetchTasklet) void' does not
    /// SAFETY: `this` must be the last reference (ref_count == 0) and have been allocated via heap::alloc.
    unsafe fn deinit(this: *mut FetchTasklet) {
        bun_output::scoped_log!(FetchTasklet, "deinit");

        // SAFETY: caller contract — `this` is live with ref_count == 0.
        unsafe { (*this).ref_count.assert_no_refs() };

        // SAFETY: this was allocated via heap::alloc in `get()`; ref_count == 0 so exclusive
        let mut boxed = unsafe { bun_core::heap::take(this) };
        boxed.clear_data();
        // self.http: Option<Box<AsyncHTTP>> dropped here automatically
        drop(boxed);
    }

    /// Last-ref reclaim from the HTTP thread once the VM has begun shutdown.
    ///
    /// Neither `clear_data()` nor dropping the box is safe here:
    ///   * the JSC `Strong`/`Weak` fields touch the VM's HandleSet/WeakSet on
    ///     `Drop` (JS-thread-only), and
    ///   * the leaked `response: jsc::Weak` keeps a finalize callback
    ///     (`on_response_finalize`) registered against `this`, so freeing the
    ///     box before `destructOnExit` sweeps the Response is a UAF.
    ///
    /// Park the intact box on the JS thread via
    /// `bun_http::defer_shutdown_reclaim`; the drain runs from
    /// `global_exit()` after the HTTP thread has parked but before
    /// `destructOnExit`, so `deinit()` there can release every handle on the
    /// right thread and the Weak is cleared before its referent is finalized.
    ///
    /// SAFETY: `this` must be the last reference (ref_count == 0) and have
    /// been allocated via heap::alloc.
    unsafe fn dealloc_for_shutdown(this: *mut FetchTasklet) {
        bun_output::scoped_log!(FetchTasklet, "deallocForShutdown");
        // SAFETY: caller contract — `this` is live with ref_count == 0.
        unsafe { (*this).ref_count.assert_no_refs() };
        http::defer_shutdown_reclaim(this.cast(), FetchTasklet::deinit_erased);
    }

    unsafe fn deinit_erased(this: *mut c_void) {
        // SAFETY: parked by `dealloc_for_shutdown` with ref_count == 0; runs
        // on the JS thread after the HTTP daemon has parked.
        unsafe { FetchTasklet::deinit(this.cast()) };
    }

    /// `HTTPClientResultCallback::release_at_shutdown` for `FetchTasklet`.
    /// Called from `dealloc_in_flight_for_exit` on the HTTP thread for each
    /// request still in `in_flight` when `process.exit()` interrupts it.
    /// `get()` created two refs (`init_exact_refs(2)`); the final `callback`'s
    /// HTTP-side release and `on_progress_update`'s JS-side release will never
    /// run, so this must balance both — but only when no `on_progress_update`
    /// is already parked in the parent's concurrent queue.
    ///
    /// The `has_schedule_callback` flag distinguishes the two states:
    ///   * `false` — nothing queued. Drop both refs here; `dealloc_for_shutdown`
    ///     parks the box for `shutdown_for_exit`'s drain.
    ///   * `true` — a non-final `on_progress_update` is queued (this entry is
    ///     still in `in_flight`, so the *final* `callback` hasn't run). That
    ///     queued node owns the JS-side ref. The JS thread releases it from
    ///     `release_queued_tasks_for_shutdown` *after* the HTTP daemon parks;
    ///     dropping it here too would leave the queued node pointing at a
    ///     freed `FetchTasklet`. Drop only the HTTP-side ref.
    ///
    /// `has_schedule_callback` is written exclusively by the HTTP-thread
    /// `callback` and the JS-thread `on_progress_update`; the JS thread is
    /// parked in `wait_timeout_while` here, so the load is race-free.
    ///
    /// A streaming upload may hold further refs whose JS-thread release
    /// sites will never run either: the sink ref (`sink_ref_held`; dropped
    /// by `write_end_request` → `release_sink_ref`) and one ref per
    /// `resume_request_data_stream` node parked in the JS concurrent queue
    /// (`queued_drain_tasks`; those nodes are `ManagedTask`-tagged, which
    /// `release_queued_tasks_for_shutdown` cannot release). Both are
    /// balanced here under the same JS-thread-parked argument.
    ///
    /// SAFETY: `this` is the live `*mut FetchTasklet` registered as
    /// `result_callback.ctx` in `get()`; HTTP-thread-only at this point.
    unsafe fn release_at_shutdown(this: *mut ()) {
        let this = this.cast::<FetchTasklet>();
        // Free the body-bytes buffer the same way the `is_shutting_down`
        // branch in `callback` does (no JS-thread drain will reclaim it).
        // SAFETY: caller contract — `this` is live and HTTP-thread-exclusive.
        let queued_progress_update =
            unsafe { (*this).has_schedule_callback.load(Ordering::Acquire) };
        // SAFETY: caller contract — `this` is live and HTTP-thread-exclusive;
        // the JS thread is parked (see fn doc), so `get_mut`'s exclusivity
        // claim holds without taking the lock.
        unsafe { (*this).shared.get_mut().scheduled_response_buffer = MutableString::default() };
        // A streaming upload's refs are normally dropped on the JS thread —
        // the sink ref by `write_end_request`, each queued drain-task ref by
        // `resume_request_data_stream` — but the JS thread is parked and its
        // queue nodes will be dropped unrun (`ManagedTask`-tagged, which
        // `release_queued_tasks_for_shutdown` cannot release). Balance them
        // here too; otherwise the count never reaches zero and the tasklet ⇄
        // `Box<AsyncHTTP>` chain (plus the sink and stream buffer it pins)
        // is unreachable from any root and LSan reports it all as leaked at
        // exit. The take is race-free: the JS-side writers are serialized
        // against the `global_exit` that parked the JS thread, and the
        // HTTP-side writer (`on_write_request_data_drain`) runs on this
        // thread. Dropped first so `this` stays live for every read below.
        for _ in 0..FetchTasklet::take_streaming_refs_for_exit(this) {
            // SAFETY: caller contract — `this` is live and HTTP-thread-exclusive.
            FetchTasklet::deref_from_thread(this);
        }
        // SAFETY: caller contract — `this` is live and HTTP-thread-exclusive.
        FetchTasklet::release_http_ref(this);
        if !queued_progress_update {
            // JS-side ref, released here on the HTTP thread: the JS thread is
            // parked, so `deref_from_thread` is the only safe teardown route.
            // SAFETY: caller contract — `this` is live and HTTP-thread-exclusive.
            FetchTasklet::deref_from_thread(this);
        }
    }

    fn start_request_stream(t: &mut Parts) {
        t.js.is_waiting_request_stream_start = false;
        debug_assert!(matches!(
            t.js.request_body,
            HTTPRequestBody::ReadableStream(_)
        ));
        let HTTPRequestBody::ReadableStream(ref stream_ref) = t.js.request_body else {
            return;
        };
        if let Some(stream) = stream_ref.get(&t.js.global_this) {
            if t.js.signal_aborted() {
                stream.abort(&t.js.global_this);
                return;
            }

            let global_this = t.js.global_this;
            Self::ref_ptr(t.task); // sink ref — released by `release_sink_ref` in `write_end_request`
            // SAFETY: `t.task` is the live heap tasklet (`Parts` is only built
            // from one); raw field projection so no `&FetchTasklet` is formed
            // while the `Parts` split borrows are live.
            unsafe { (*t.task).sink_ref_held.store(true, Ordering::Release) };
            // +1 because the task refs the sink
            let sink = ResumableSink::init_exact_refs(&global_this, stream, t.task, 2);
            t.js.sink = Some(sink);
        }
    }

    fn on_body_received(t: &mut Parts, shared: &mut HttpHandoff) -> JsTerminatedResult<()> {
        let success = shared.result.is_success();
        let global_this = t.js.global_this;
        // reset the buffer if we are streaming or if we are not waiting for bufferig anymore
        let buffer_reset = core::cell::Cell::new(true);
        bun_output::scoped_log!(
            FetchTasklet,
            "onBodyReceived success={} has_more={}",
            success,
            shared.result.has_more
        );
        // PORT NOTE: Zig `defer { if (buffer_reset) ...reset() }` runs on `try` failure paths too.
        // Capture a raw ptr so the defer can reset on every exit (incl. `?`) without holding a
        // long-lived &mut borrow of `shared`.
        let scheduled_buf: *mut MutableString = &raw mut shared.scheduled_response_buffer;
        scopeguard::defer! {
            if buffer_reset.get() {
                // SAFETY: `shared` outlives this defer (the caller holds the lock guard for
                // the whole call) and no other borrow of scheduled_response_buffer is live
                // at scope exit / `?` unwind.
                unsafe { (*scheduled_buf).reset() };
            }
        }

        if !success {
            // Zig: `var need_deinit = true; defer if (need_deinit) err.deinit();` — `ValueError`
            // has no `Drop` (it's reset-in-place, see Body.rs), so the Strong installed by
            // `to_js` would leak on the sink-cancel / no-response / `?` exits. Hold it in a
            // scopeguard and defuse via `into_inner` when ownership is transferred to
            // `to_error_instance` (the `need_deinit = false` arm).
            let mut err = scopeguard::guard(Self::on_reject(t, shared), |mut e| e.reset());
            let mut js_err = JSValue::ZERO;
            // if we are streaming update with error
            if let Some(readable) = t.js.readable_stream_ref.get(&global_this) {
                if let Some(bytes) = readable.ptr.bytes() {
                    js_err = err.to_js(&global_this);
                    js_err.ensure_still_alive();
                    bytes.on_data(StreamResult::Err(StreamError::JSValue(js_err)))?;
                }
            }
            if let Some(sink) = t.js.sink_mut() {
                if js_err.is_empty() {
                    js_err = err.to_js(&global_this);
                    js_err.ensure_still_alive();
                }
                sink.cancel(js_err);
                return Ok(());
            }
            // if we are buffering resolve the promise
            if let Some(response) = t.js.current_response_mut() {
                // body value now owns the error (Zig: `need_deinit = false`)
                let err = scopeguard::ScopeGuard::into_inner(err);
                let body = response.get_body_value();
                // PORT NOTE: Body.rs aliases its `JsTerminated<T>` to `JsResult<T>` for
                // now; narrow back to the real `JsTerminated` here (Zig: `try body.toErrorInstance`).
                body.to_error_instance(err, &global_this)
                    .map_err(|_| bun_jsc::JsTerminated::JSTerminated)?;
            }
            return Ok(());
        }

        if let Some(readable) = t.js.readable_stream_ref.get(&global_this) {
            bun_output::scoped_log!(FetchTasklet, "onBodyReceived readable_stream_ref");
            if let Some(bytes) = readable.ptr.bytes() {
                bytes.size_hint.set(shared.size_hint());
                // body can be marked as used but we still need to pipe the data
                if shared.result.has_more {
                    let chunk = shared.scheduled_response_buffer.list.as_slice();
                    bytes.on_data(Self::temporary_chunk(chunk, false))?;
                } else {
                    t.js.clear_stream_cancel_handler();
                    let prev = core::mem::take(&mut t.js.readable_stream_ref);
                    buffer_reset.set(false);

                    let chunk = shared.scheduled_response_buffer.list.as_slice();
                    bytes.on_data(Self::temporary_chunk(chunk, true))?;
                    drop(prev);
                }
                return Ok(());
            }
        }

        if let Some(response) = t.js.current_response_mut() {
            bun_output::scoped_log!(FetchTasklet, "onBodyReceived Current Response");
            let size_hint = shared.size_hint();
            response.set_size_hint(size_hint);
            if let Some(readable) = response.get_body_readable_stream(&global_this) {
                bun_output::scoped_log!(
                    FetchTasklet,
                    "onBodyReceived CurrentResponse BodyReadableStream"
                );
                if let Some(bytes) = readable.ptr.bytes() {
                    let chunk = shared.scheduled_response_buffer.list.as_slice();

                    if shared.result.has_more {
                        bytes.on_data(Self::temporary_chunk(chunk, false))?;
                    } else {
                        readable.value.ensure_still_alive();
                        response.detach_readable_stream(&global_this);
                        bytes.on_data(Self::temporary_chunk(chunk, true))?;
                    }

                    return Ok(());
                }
            }

            // we will reach here when not streaming, this is also the only case we dont wanna to reset the buffer
            buffer_reset.set(false);
            if !shared.result.has_more {
                let scheduled_response_buffer =
                    core::mem::take(&mut shared.scheduled_response_buffer.list);
                // PORT NOTE: `body` (&mut response.body.value) and `get_fetch_headers()`
                // (&response.init.headers) are disjoint fields, but borrowck can't see
                // through the accessor methods. Hold `body` as a raw ptr (Zig pattern).
                let body: *mut BodyValue = response.get_body_value();
                // done resolve body
                let old = core::mem::replace(
                    // SAFETY: just obtained from live `response`; uniquely accessed here.
                    unsafe { &mut *body },
                    BodyValue::InternalBlob(InternalBlob {
                        bytes: scheduled_response_buffer,
                        was_string: false,
                    }),
                );
                bun_output::scoped_log!(
                    FetchTasklet,
                    "onBodyReceived body_value length={}",
                    // SAFETY: see above.
                    match unsafe { &*body } {
                        BodyValue::InternalBlob(b) => b.bytes.len(),
                        _ => 0,
                    }
                );

                shared.scheduled_response_buffer = MutableString::default();

                if matches!(old, BodyValue::Locked(_)) {
                    bun_output::scoped_log!(FetchTasklet, "onBodyReceived old.resolve");
                    let mut old = old;
                    // BodyValue::resolve takes `Option<NonNull<FetchHeaders>>` (opaque C++ handle
                    // mutated via FFI); the inherent `get_fetch_headers` returns `Option<&_>`, so
                    // erase the borrow into a raw NonNull. Disjoint from `body` (response.init vs
                    // response.body) and outlives this block.
                    let headers = response.get_fetch_headers().map(core::ptr::NonNull::from);
                    // PORT NOTE: Body.rs aliases its `JsTerminated<T>` to `JsResult<T>` for
                    // now; narrow back to the real `JsTerminated` here.
                    // SAFETY: `body` points into `response.body`, disjoint from `headers`
                    // (response.init); both live for this block.
                    BodyValue::resolve(&mut old, unsafe { &mut *body }, &t.js.global_this, headers)
                        .map_err(|_| bun_jsc::JsTerminated::JSTerminated)?;
                }
            }
        }
        Ok(())
    }

    pub(crate) fn on_progress_update(&mut self) -> JsTerminatedResult<()> {
        jsc::mark_binding!();
        bun_output::scoped_log!(FetchTasklet, "onProgressUpdate");
        let (mut t, shared_cell) = self.split();
        let mut shared = shared_cell.lock();
        t.has_schedule_callback.store(false, Ordering::Relaxed);
        let is_done = !shared.result.has_more;

        let vm = t.vm;
        // vm is shutting down we cannot touch JS
        if vm.is_shutting_down() {
            // The certificate will never be checked; release the parked
            // HTTP-thread socket instead of leaving it occupying an active
            // request slot until the idle timeout.
            if shared.result.certificate_info.take().is_some() {
                if let Some(http_) = t.http.as_mut() {
                    http::http_thread().schedule_shutdown(http_);
                }
            }
            drop(shared);
            if is_done {
                // A queued final progress node that still gets dispatched
                // after `is_shutting_down` flips would be the only exit path
                // left for this tasklet (the final `callback` already removed
                // it from `in_flight` and released the HTTP ref, and a
                // dequeued node never reaches
                // `release_queued_tasks_for_shutdown`). The JS loop does not
                // tick in that window today, so this is defensive symmetry
                // with the other exit paths — the take is an idempotent
                // no-op when another path already claimed the refs.
                for _ in 0..FetchTasklet::take_streaming_refs_for_exit(t.task) {
                    // SAFETY: `t.task` is the live heap tasklet; the taken
                    // markers prove the refs are still held.
                    FetchTasklet::deref(t.task);
                }
                // SAFETY: `t.task` is the live heap tasklet; we hold a ref.
                FetchTasklet::release_js_ref(t.task);
            }
            return Ok(());
        }

        let global_this = t.js.global_this;
        // PORT NOTE: reshaped for borrowck — Zig defer block split into explicit cleanup at each
        // return. The guard is taken BY VALUE so every call site unconditionally unlocks.
        let cleanup = |shared: GuardedLock<'_, HttpHandoff, Mutex>, t: &mut Parts| {
            drop(shared); // unlock FIRST, as before
            // if we are not done we wait until the next call
            if is_done {
                // The HTTP response has been fully received. If the request body
                // is still being uploaded through a ResumableSink (e.g. the
                // underlying source's `pull` awaits a timer, so a chunk arrives
                // after the sink has gone paused on backpressure), the HTTP layer
                // will never drain/resume it again — `ondrain` never fires, so the
                // JS `drainReaderIntoSink` continuation (which captures the
                // reader/stream graph) and the FetchTasklet's `startRequestStream`
                // ref would leak forever. Cancel the sink so the JS side releases
                // the reader and `write_end_request` drops that ref. `cancel` is a
                // no-op if the sink already finished.
                if let Some(sink) = t.js.sink_mut() {
                    sink.cancel(JSValue::UNDEFINED);
                }
                let mut poll_ref = core::mem::take(&mut t.js.poll_ref);
                poll_ref.unref(bun_io::js_vm_ctx());
                // SAFETY: `t.task` is the live heap tasklet; we hold a ref.
                FetchTasklet::release_js_ref(t.task);
            }
        };

        if t.js.is_waiting_request_stream_start && shared.result.can_stream {
            // start streaming
            Self::start_request_stream(&mut t);
            // Intentionally diverges from Zig: makes wpt-h2 number-chunk test deterministic.
            // `assignStreamIntoResumableSink` kicks off `await reader.read()`; an invalid
            // chunk type (e.g. a JS number) throws inside `sink.write` and lands in
            // `writeEndRequest` → `abort_reason` on the next microtask. Drain now so the
            // abort is observable below before we commit to resolving the Response.
            //
            // Only drain when this same progress tick would otherwise *resolve* the
            // promise (i.e. response metadata is already present). On the common
            // can_stream-only first progress (`metadata == None`) we early-return
            // right below anyway.
            //
            // Drain ONLY the JSC microtask queue, NOT Bun's `EventLoop::drain_microtasks`:
            // `on_progress_update` is itself running inside `tick_queue_with_count`,
            // which already holds `&mut EventLoop`. Re-entering via
            // `(*vm.event_loop()).drain_microtasks()` was an aliased `&mut EventLoop`
            // (UB) and additionally ran `release_weak_refs` + `deferred_tasks.run()`,
            // which is observable in `fetch-leak-test-fixture-5.js`'s post-batch
            // `heapStats().Promise` count for the streaming-body cases when a fast
            // loopback coalesces `can_stream` and `metadata` into one callback —
            // pushed the count over its 35-object threshold (#53208/#53214 flaky).
            // The JSC-only drain is `&self`, runs just promise reactions (sufficient
            // for the queued `endSink(err)` to land in `write_end_request` →
            // `abort_reason`), and leaves the Bun event loop untouched.
            if shared.metadata.is_some() && !t.js.is_waiting_body {
                vm.jsc_vm().drain_microtasks();
            }
        }
        // if we already respond the metadata and still need to process the body
        if t.js.is_waiting_body {
            // `scheduled_response_buffer` has two readers that both drain-and-reset:
            // this path (onBodyReceived) and `onStartStreamingHTTPResponseBodyCallback`,
            // which runs once when JS first touches `res.body` and hands any already-
            // buffered bytes to the new ByteStream synchronously.
            //
            // That creates a stale-task race:
            //   1. HTTP thread `callback()` writes N bytes to the buffer and enqueues
            //      this onProgressUpdate task (under mutex).
            //   2. Main thread: JS touches `res.body` -> `onStartStreaming` drains those
            //      N bytes and resets the buffer (under mutex).
            //   3. This task runs and finds the buffer empty.
            //
            // The task cannot be un-enqueued in step 2, and at schedule time (step 1)
            // the buffer was non-empty, so the only place the staleness is observable
            // is here when the task runs.
            //
            // Without this guard, `onBodyReceived` would call `ByteStream.onData` with
            // a zero-length non-terminal chunk. That resolves the reader's pending
            // pull with `len=0`; `native-readable.ts` `handleNumberResult(0)` does not
            // `push()`, so node:stream `state.reading` (set before the previous `_read()`
            // early-returned on `kPendingRead`) is never cleared, `_read()` is never
            // called again, and `pipeline(Readable.fromWeb(res.body), ...)` stalls
            // forever — eventually spinning at 100% CPU once `poll_ref` unrefs.
            if shared.scheduled_response_buffer.list.is_empty()
                && shared.result.has_more
                && shared.result.is_success()
            {
                cleanup(shared, &mut t);
                return Ok(());
            }
            let r = Self::on_body_received(&mut t, &mut *shared);
            cleanup(shared, &mut t);
            return r;
        }
        // Run the user-supplied `checkServerIdentity` callback as soon as the
        // certificate arrives. The HTTP thread parks the connection after the
        // TLS handshake (`is_waiting_for_cert_check`) and does not transmit
        // the request until this check passes, so this block must run BEFORE
        // the metadata-less early return below — the parked connection's
        // first progress update carries only the certificate (no metadata, no
        // failure) and would otherwise be dropped, leaving the socket parked
        // until the idle timeout.
        if let Some(certificate_info) = shared.result.certificate_info.take() {
            // we receive some error
            if t.reject_unauthorized
                && !Self::check_server_identity(&mut t, &mut *shared, &certificate_info)
            {
                bun_output::scoped_log!(FetchTasklet, "onProgressUpdate: aborted due certError");
                drop(certificate_info);
                // `check_server_identity` already set abort_reason / aborted /
                // result.fail and scheduled the shutdown of the parked
                // socket; all that is left is rejecting the promise.
                let promise_value = t.js.promise.value_or_empty();
                if promise_value.is_empty_or_undefined_or_null() {
                    bun_output::scoped_log!(
                        FetchTasklet,
                        "onProgressUpdate: promise_value is null"
                    );
                    t.js.promise = jsc::JSPromiseStrong::empty();
                    cleanup(shared, &mut t);
                    return Ok(());
                }
                // we need to abort the request
                let promise = promise_value.as_any_promise().unwrap();
                let tracker = t.js.tracker;
                let mut result = Self::on_reject(&mut t, &mut *shared);

                promise_value.ensure_still_alive();
                let r = promise.reject_with_async_stack(&global_this, result.to_js(&global_this));
                result.reset();

                tracker.did_dispatch(&global_this);
                t.js.promise = jsc::JSPromiseStrong::empty();
                cleanup(shared, &mut t);
                return r;
            }
            drop(certificate_info);
            // checkServerIdentity passed: un-park the HTTP-thread connection
            // so the request is finally written to the now-verified peer. If
            // the connection already closed/failed the resume is a no-op
            // (keyed through the abort tracker).
            if let Some(http_) = t.http.as_mut() {
                http::http_thread().schedule_cert_check_resume(http_);
            }
            // Fall through. The common case (certificate-only update) returns
            // at the metadata-less early return below; the #27275 coalesced
            // case — the connection failed after the handshake but before
            // response headers arrived, so the certificate_info from the
            // first progress update was merged into the later failure result
            // — falls through to the reject logic with `result.fail` set.
        }

        if shared.metadata.is_none() && shared.result.is_success() {
            cleanup(shared, &mut t);
            return Ok(());
        }

        // if we abort because of cert error
        // we wait the Http Client because we already have the response
        // we just need to deinit
        if t.js.is_waiting_abort {
            cleanup(shared, &mut t);
            return Ok(());
        }
        let promise_value = t.js.promise.value_or_empty();

        if promise_value.is_empty_or_undefined_or_null() {
            bun_output::scoped_log!(FetchTasklet, "onProgressUpdate: promise_value is null");
            t.js.promise = jsc::JSPromiseStrong::empty();
            cleanup(shared, &mut t);
            return Ok(());
        }

        // Intentionally diverges from Zig (paired with the microtask drain after
        // startRequestStream above): the request-body sink may have set `abort_reason`
        // via writeEndRequest while the HTTP result is still a success — server HEADERS
        // raced ahead of the scheduled shutdown. Reject with that reason instead of
        // resolving a 200 Response. Makes wpt-h2 number-chunk test deterministic.
        if shared.result.is_success() && t.js.abort_reason.has() {
            let promise = promise_value.as_any_promise().unwrap();
            let tracker = t.js.tracker;
            // get_abort_error consumes abort_reason and clears the signal handler.
            let mut err = t.js.get_abort_error(t.task).unwrap();
            promise_value.ensure_still_alive();
            let r = promise.reject_with_async_stack(&global_this, err.to_js(&global_this));
            err.reset();
            tracker.did_dispatch(&global_this);
            t.js.promise = jsc::JSPromiseStrong::empty();
            cleanup(shared, &mut t);
            return r;
        }

        let tracker = t.js.tracker;
        tracker.will_dispatch(&global_this);
        // defer block:
        let dispatch_cleanup = |js: &mut JsState| {
            bun_output::scoped_log!(FetchTasklet, "onProgressUpdate: promise_value is not null");
            tracker.did_dispatch(&global_this);
            js.promise = jsc::JSPromiseStrong::empty();
        };

        let success = shared.result.is_success();
        let result = if success {
            StrongOptional::create(Self::on_resolve(&mut t, &mut *shared), &global_this)
        } else {
            // in this case we wanna a jsc.Strong.Optional so we just convert it
            let mut value = Self::on_reject(&mut t, &mut *shared);
            let err_js = value.to_js(&global_this);
            if let Some(sink) = t.js.sink_mut() {
                sink.cancel(err_js);
            }
            // `to_js` leaves `value` in the `JSValue(Strong)` state (Body.rs:547). Move
            // that Strong out (Zig: `break :brk value.JSValue`) instead of allocating a
            // second one — `ValueError` has no `Drop`, so the inner Strong would leak.
            let BodyValueError::JSValue(strong) = value else {
                unreachable!("ValueError::to_js leaves self in JSValue state");
            };
            strong
        };

        promise_value.ensure_still_alive();

        struct Holder {
            held: StrongOptional,
            promise: jsc::JSPromiseStrong,
            global_object: GlobalRef,
            task: AnyTask,
        }

        impl Holder {
            fn resolve(self_: *mut Holder) -> JsTerminatedResult<()> {
                // SAFETY: allocated via heap::alloc below; consumed once
                let mut self_ = unsafe { bun_core::heap::take(self_) };
                // resolve the promise
                let prom = self_.promise.value_or_empty().as_any_promise().unwrap();
                let res = self_.held.swap();
                res.ensure_still_alive();
                let r = prom.resolve(&self_.global_object, res);
                self_.held.deinit();
                self_.promise = jsc::JSPromiseStrong::empty();
                drop(self_);
                r
            }

            fn reject(self_: *mut Holder) -> JsTerminatedResult<()> {
                // SAFETY: allocated via heap::alloc below; consumed once
                let mut self_ = unsafe { bun_core::heap::take(self_) };
                // reject the promise
                let prom = self_.promise.value_or_empty().as_any_promise().unwrap();
                let res = self_.held.swap();
                res.ensure_still_alive();
                let r = prom.reject_with_async_stack(&self_.global_object, res);
                self_.held.deinit();
                self_.promise = jsc::JSPromiseStrong::empty();
                drop(self_);
                r
            }
        }

        // Map `JsTerminated` to the low-tier `Terminated` tag so the dispatcher unwinds correctly.
        fn resolve_erased(p: *mut Holder) -> ElJsResult<()> {
            Holder::resolve(p).map_err(|_| bun_event_loop::ErasedJsError::Terminated)
        }
        fn reject_erased(p: *mut Holder) -> ElJsResult<()> {
            Holder::reject(p).map_err(|_| bun_event_loop::ErasedJsError::Terminated)
        }

        let holder = bun_core::heap::into_raw(Box::new(Holder {
            held: result,
            // we need the promise to be alive until the task is done
            promise: t.js.promise.take(),
            global_object: global_this,
            task: AnyTask::default(),
        }));
        // SAFETY: holder is valid until consumed by resolve/reject
        unsafe {
            (*holder).task = AnyTask::from_typed(
                holder,
                if success {
                    resolve_erased
                } else {
                    reject_erased
                },
            );
            (*vm.event_loop()).enqueue_task(Task::init(&raw mut (*holder).task));
        }

        dispatch_cleanup(&mut *t.js);
        cleanup(shared, &mut t);
        Ok(())
    }

    fn check_server_identity(
        t: &mut Parts,
        shared: &mut HttpHandoff,
        certificate_info: &CertificateInfo,
    ) -> bool {
        if let Some(check_server_identity) = t.js.check_server_identity.get() {
            check_server_identity.ensure_still_alive();
            if !certificate_info.cert.is_empty() {
                let cert = &certificate_info.cert;
                let mut cert_ptr = cert.as_ptr();
                // SAFETY: cert is a valid DER buffer; d2i_X509 reads up to cert.len() bytes
                let x509 = unsafe {
                    d2i_X509(
                        core::ptr::null_mut(),
                        &raw mut cert_ptr,
                        core::ffi::c_long::try_from(cert.len()).expect("int cast"),
                    )
                };
                if !x509.is_null() {
                    let global_object = t.js.global_this;
                    // SAFETY: `x` is the non-null `X509*` returned by `d2i_X509` above; this
                    // guard is its sole owner and frees it exactly once on scope exit.
                    let _x509_guard = scopeguard::guard(x509, |x| unsafe { X509_free(x) });
                    // SAFETY: x509 is non-null, freshly parsed; freed by guard above.
                    let js_cert = match X509::to_js(unsafe { &mut *x509 }, &global_object) {
                        Ok(v) => v,
                        Err(e) => {
                            match e {
                                jsc::JsError::Thrown => {}
                                jsc::JsError::OutOfMemory => {
                                    let _ = global_object.throw_out_of_memory();
                                }
                                jsc::JsError::Terminated => {}
                            }
                            let check_result = global_object.try_take_exception().unwrap();
                            // mark to wait until deinit
                            t.js.is_waiting_abort = shared.result.has_more;
                            t.js.abort_reason.set(&global_object, check_result);
                            t.signal_store.aborted.store(true, Ordering::Relaxed);
                            t.js.tracker.did_cancel(&t.js.global_this);
                            // we need to abort the request
                            if let Some(http_) = t.http.as_mut() {
                                http::http_thread().schedule_shutdown(http_);
                            }
                            shared.result.fail = Some(err!("ERR_TLS_CERT_ALTNAME_INVALID"));
                            return false;
                        }
                    };
                    let hostname =
                        OwnedString::new(BunString::clone_utf8(&certificate_info.hostname));
                    let js_hostname: JSValue = match hostname.to_js(&global_object) {
                        Ok(v) => v,
                        Err(e) => {
                            match e {
                                jsc::JsError::Thrown => {}
                                jsc::JsError::OutOfMemory => {
                                    let _ = global_object.throw_out_of_memory();
                                }
                                jsc::JsError::Terminated => {}
                            }
                            let hostname_err_result = global_object.try_take_exception().unwrap();
                            t.js.is_waiting_abort = shared.result.has_more;
                            t.js.abort_reason.set(&global_object, hostname_err_result);
                            t.signal_store.aborted.store(true, Ordering::Relaxed);
                            t.js.tracker.did_cancel(&t.js.global_this);
                            if let Some(http_) = t.http.as_mut() {
                                http::http_thread().schedule_shutdown(http_);
                            }
                            shared.result.fail = Some(err!("ERR_TLS_CERT_ALTNAME_INVALID"));
                            return false;
                        }
                    };
                    js_hostname.ensure_still_alive();
                    js_cert.ensure_still_alive();
                    let check_result = match check_server_identity.call(
                        &global_object,
                        JSValue::UNDEFINED,
                        &[js_hostname, js_cert],
                    ) {
                        Ok(v) => v,
                        Err(e) => global_object.take_exception(e),
                    };

                    // > Returns <Error> object [...] on failure
                    if check_result.is_any_error() {
                        // mark to wait until deinit
                        t.js.is_waiting_abort = shared.result.has_more;
                        t.js.abort_reason.set(&global_object, check_result);
                        t.signal_store.aborted.store(true, Ordering::Relaxed);
                        t.js.tracker.did_cancel(&t.js.global_this);

                        // we need to abort the request
                        if let Some(http_) = t.http.as_mut() {
                            http::http_thread().schedule_shutdown(http_);
                        }
                        shared.result.fail = Some(err!("ERR_TLS_CERT_ALTNAME_INVALID"));
                        return false;
                    }

                    // > On success, returns <undefined>
                    // We treat any non-error value as a success.
                    return true;
                }
            }
        }
        // Empty or unparseable certificate bytes: every false return must have
        // scheduled the parked socket's shutdown, like the paths above.
        if let Some(http_) = t.http.as_mut() {
            http::http_thread().schedule_shutdown(http_);
        }
        shared.result.fail = Some(err!("ERR_TLS_CERT_ALTNAME_INVALID"));
        false
    }

    fn on_reject(t: &mut Parts, shared: &mut HttpHandoff) -> BodyValueError {
        debug_assert!(shared.result.fail.is_some());
        bun_output::scoped_log!(FetchTasklet, "onReject");

        if let Some(err) = t.js.get_abort_error(t.task) {
            return err;
        }

        if let Some(reason) = shared.result.abort_reason() {
            return BodyValueError::AbortReason(reason);
        }

        let fail = shared.result.fail.unwrap();

        // Fetch-spec "network error" cases that callers feature-detect via
        // `instanceof TypeError`. Keep this list narrow; the catch-all
        // SystemError below is still a plain Error for backwards compat.
        if fail == err!("RequestBodyNotReusable") {
            return BodyValueError::TypeError(BunString::static_(
                "Request body is a ReadableStream and cannot be replayed for this redirect",
            ));
        }

        // some times we don't have metadata so we also check http.url
        let path = if let Some(metadata) = &shared.metadata {
            BunString::clone_utf8(metadata.url.slice())
        } else if let Some(http_) = t.http.as_ref() {
            BunString::clone_utf8(http_.url.href)
        } else {
            BunString::EMPTY
        };

        let code = if fail == err!("ConnectionClosed") {
            BunString::static_("ECONNRESET")
        } else {
            BunString::static_(fail.name())
        };

        let message = match fail {
            e if e == err!("ConnectionClosed") => BunString::static_(
                "The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()",
            ),
            e if e == err!("FailedToOpenSocket") => {
                BunString::static_("Was there a typo in the url or port?")
            }
            e if e == err!("TooManyRedirects") => BunString::static_(
                "The response redirected too many times. For more information, pass `verbose: true` in the second argument to fetch()",
            ),
            e if e == err!("ConnectionRefused") => {
                BunString::static_("Unable to connect. Is the computer able to access the url?")
            }
            e if e == err!("RedirectURLInvalid") => {
                BunString::static_("Redirect URL in Location header is invalid.")
            }

            e if e == err!("UNABLE_TO_GET_ISSUER_CERT") => {
                BunString::static_("unable to get issuer certificate")
            }
            e if e == err!("UNABLE_TO_GET_CRL") => {
                BunString::static_("unable to get certificate CRL")
            }
            e if e == err!("UNABLE_TO_DECRYPT_CERT_SIGNATURE") => {
                BunString::static_("unable to decrypt certificate's signature")
            }
            e if e == err!("UNABLE_TO_DECRYPT_CRL_SIGNATURE") => {
                BunString::static_("unable to decrypt CRL's signature")
            }
            e if e == err!("UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY") => {
                BunString::static_("unable to decode issuer public key")
            }
            e if e == err!("CERT_SIGNATURE_FAILURE") => {
                BunString::static_("certificate signature failure")
            }
            e if e == err!("CRL_SIGNATURE_FAILURE") => BunString::static_("CRL signature failure"),
            e if e == err!("CERT_NOT_YET_VALID") => {
                BunString::static_("certificate is not yet valid")
            }
            e if e == err!("CRL_NOT_YET_VALID") => BunString::static_("CRL is not yet valid"),
            e if e == err!("CERT_HAS_EXPIRED") => BunString::static_("certificate has expired"),
            e if e == err!("CRL_HAS_EXPIRED") => BunString::static_("CRL has expired"),
            e if e == err!("ERROR_IN_CERT_NOT_BEFORE_FIELD") => {
                BunString::static_("format error in certificate's notBefore field")
            }
            e if e == err!("ERROR_IN_CERT_NOT_AFTER_FIELD") => {
                BunString::static_("format error in certificate's notAfter field")
            }
            e if e == err!("ERROR_IN_CRL_LAST_UPDATE_FIELD") => {
                BunString::static_("format error in CRL's lastUpdate field")
            }
            e if e == err!("ERROR_IN_CRL_NEXT_UPDATE_FIELD") => {
                BunString::static_("format error in CRL's nextUpdate field")
            }
            e if e == err!("OUT_OF_MEM") => BunString::static_("out of memory"),
            e if e == err!("DEPTH_ZERO_SELF_SIGNED_CERT") => {
                BunString::static_("self signed certificate")
            }
            e if e == err!("SELF_SIGNED_CERT_IN_CHAIN") => {
                BunString::static_("self signed certificate in certificate chain")
            }
            e if e == err!("UNABLE_TO_GET_ISSUER_CERT_LOCALLY") => {
                BunString::static_("unable to get local issuer certificate")
            }
            e if e == err!("UNABLE_TO_VERIFY_LEAF_SIGNATURE") => {
                BunString::static_("unable to verify the first certificate")
            }
            e if e == err!("CERT_CHAIN_TOO_LONG") => {
                BunString::static_("certificate chain too long")
            }
            e if e == err!("CERT_REVOKED") => BunString::static_("certificate revoked"),
            e if e == err!("INVALID_CA") => BunString::static_("invalid CA certificate"),
            e if e == err!("INVALID_NON_CA") => {
                BunString::static_("invalid non-CA certificate (has CA markings)")
            }
            e if e == err!("PATH_LENGTH_EXCEEDED") => {
                BunString::static_("path length constraint exceeded")
            }
            e if e == err!("PROXY_PATH_LENGTH_EXCEEDED") => {
                BunString::static_("proxy path length constraint exceeded")
            }
            e if e == err!("PROXY_CERTIFICATES_NOT_ALLOWED") => BunString::static_(
                "proxy certificates not allowed, please set the appropriate flag",
            ),
            e if e == err!("INVALID_PURPOSE") => {
                BunString::static_("unsupported certificate purpose")
            }
            e if e == err!("CERT_UNTRUSTED") => BunString::static_("certificate not trusted"),
            e if e == err!("CERT_REJECTED") => BunString::static_("certificate rejected"),
            e if e == err!("APPLICATION_VERIFICATION") => {
                BunString::static_("application verification failure")
            }
            e if e == err!("SUBJECT_ISSUER_MISMATCH") => {
                BunString::static_("subject issuer mismatch")
            }
            e if e == err!("AKID_SKID_MISMATCH") => {
                BunString::static_("authority and subject key identifier mismatch")
            }
            e if e == err!("AKID_ISSUER_SERIAL_MISMATCH") => {
                BunString::static_("authority and issuer serial number mismatch")
            }
            e if e == err!("KEYUSAGE_NO_CERTSIGN") => {
                BunString::static_("key usage does not include certificate signing")
            }
            e if e == err!("UNABLE_TO_GET_CRL_ISSUER") => {
                BunString::static_("unable to get CRL issuer certificate")
            }
            e if e == err!("UNHANDLED_CRITICAL_EXTENSION") => {
                BunString::static_("unhandled critical extension")
            }
            e if e == err!("KEYUSAGE_NO_CRL_SIGN") => {
                BunString::static_("key usage does not include CRL signing")
            }
            e if e == err!("KEYUSAGE_NO_DIGITAL_SIGNATURE") => {
                BunString::static_("key usage does not include digital signature")
            }
            e if e == err!("UNHANDLED_CRITICAL_CRL_EXTENSION") => {
                BunString::static_("unhandled critical CRL extension")
            }
            e if e == err!("INVALID_EXTENSION") => {
                BunString::static_("invalid or inconsistent certificate extension")
            }
            e if e == err!("INVALID_POLICY_EXTENSION") => {
                BunString::static_("invalid or inconsistent certificate policy extension")
            }
            e if e == err!("NO_EXPLICIT_POLICY") => BunString::static_("no explicit policy"),
            e if e == err!("DIFFERENT_CRL_SCOPE") => BunString::static_("Different CRL scope"),
            e if e == err!("UNSUPPORTED_EXTENSION_FEATURE") => {
                BunString::static_("Unsupported extension feature")
            }
            e if e == err!("UNNESTED_RESOURCE") => {
                BunString::static_("RFC 3779 resource not subset of parent's resources")
            }
            e if e == err!("PERMITTED_VIOLATION") => {
                BunString::static_("permitted subtree violation")
            }
            e if e == err!("EXCLUDED_VIOLATION") => {
                BunString::static_("excluded subtree violation")
            }
            e if e == err!("SUBTREE_MINMAX") => {
                BunString::static_("name constraints minimum and maximum not supported")
            }
            e if e == err!("UNSUPPORTED_CONSTRAINT_TYPE") => {
                BunString::static_("unsupported name constraint type")
            }
            e if e == err!("UNSUPPORTED_CONSTRAINT_SYNTAX") => {
                BunString::static_("unsupported or invalid name constraint syntax")
            }
            e if e == err!("UNSUPPORTED_NAME_SYNTAX") => {
                BunString::static_("unsupported or invalid name syntax")
            }
            e if e == err!("CRL_PATH_VALIDATION_ERROR") => {
                BunString::static_("CRL path validation error")
            }
            e if e == err!("SUITE_B_INVALID_VERSION") => {
                BunString::static_("Suite B: certificate version invalid")
            }
            e if e == err!("SUITE_B_INVALID_ALGORITHM") => {
                BunString::static_("Suite B: invalid public key algorithm")
            }
            e if e == err!("SUITE_B_INVALID_CURVE") => {
                BunString::static_("Suite B: invalid ECC curve")
            }
            e if e == err!("SUITE_B_INVALID_SIGNATURE_ALGORITHM") => {
                BunString::static_("Suite B: invalid signature algorithm")
            }
            e if e == err!("SUITE_B_LOS_NOT_ALLOWED") => {
                BunString::static_("Suite B: curve not allowed for this LOS")
            }
            e if e == err!("SUITE_B_CANNOT_SIGN_P_384_WITH_P_256") => {
                BunString::static_("Suite B: cannot sign P-384 with P-256")
            }
            e if e == err!("HOSTNAME_MISMATCH") => BunString::static_("Hostname mismatch"),
            e if e == err!("EMAIL_MISMATCH") => BunString::static_("Email address mismatch"),
            e if e == err!("IP_ADDRESS_MISMATCH") => BunString::static_("IP address mismatch"),
            e if e == err!("INVALID_CALL") => {
                BunString::static_("Invalid certificate verification context")
            }
            e if e == err!("STORE_LOOKUP") => BunString::static_("Issuer certificate lookup error"),
            e if e == err!("NAME_CONSTRAINTS_WITHOUT_SANS") => {
                BunString::static_("Issuer has name constraints but leaf has no SANs")
            }
            e if e == err!("UNKNOWN_CERTIFICATE_VERIFICATION_ERROR") => {
                BunString::static_("unknown certificate verification error")
            }

            e => BunString::create_format(format_args!(
                "{} fetching \"{}\". For more information, pass `verbose: true` in the second argument to fetch()",
                e.name(),
                path,
            )),
        };

        // PORT NOTE: `jsc::SystemError` has no `Default` impl upstream — spell out
        // every field with its Zig default (SystemError.zig:1).
        let fetch_error = jsc::SystemError {
            errno: 0,
            code,
            message,
            path,
            syscall: BunString::EMPTY,
            hostname: BunString::EMPTY,
            fd: core::ffi::c_int::MIN,
            dest: BunString::EMPTY,
        };

        BodyValueError::SystemError(fetch_error)
    }

    pub(crate) fn on_readable_stream_available(
        ctx: *mut c_void,
        global_this: &JSGlobalObject,
        readable: ReadableStream,
    ) {
        let this = Self::from_ctx(ctx);
        this.js.readable_stream_ref = ReadableStreamStrong::init(readable, global_this);
    }

    pub(crate) fn on_start_streaming_http_response_body_callback(ctx: *mut c_void) -> DrainResult {
        let this = Self::from_ctx(ctx);
        if this.signal_store.aborted.load(Ordering::Relaxed) {
            return DrainResult::Aborted;
        }

        if let Some(http_) = this.http.as_mut() {
            http_.enable_response_body_streaming();

            // If the server sent the headers and the response body in two separate socket writes
            // and if the server doesn't close the connection by itself
            // and doesn't send any follow-up data
            // then we must make sure the HTTP thread flushes.
            http::http_thread().schedule_response_body_drain(http_.async_http_id);
        }

        let mut shared = this.shared.lock();
        let size_hint = shared.size_hint();

        // This means we have received part of the body but not the whole thing
        if !shared.scheduled_response_buffer.list.is_empty() {
            let scheduled_response_buffer = core::mem::take(&mut shared.scheduled_response_buffer);
            drop(shared);

            return DrainResult::Owned {
                list: scheduled_response_buffer.list,
                size_hint: size_hint as usize,
            };
        }

        drop(shared);
        DrainResult::EstimatedSize(size_hint as usize)
    }

    fn on_stream_cancelled_callback(ctx: Option<*mut c_void>) {
        let this = Self::from_ctx(ctx.expect("ctx"));
        if this.ignore_data.load(Ordering::Relaxed) {
            return;
        }
        this.ignore_remaining_response_body();
    }

    fn to_body_value(t: &mut Parts, shared: &mut HttpHandoff) -> BodyValue {
        if let Some(err) = t.js.get_abort_error(t.task) {
            return BodyValue::Error(err);
        }
        if t.js.is_waiting_body {
            let mut pending = body::PendingValue::new(&t.js.global_this);
            pending.size_hint = shared.size_hint();
            pending.task = Some(t.task.cast::<c_void>());
            pending.on_start_streaming =
                Some(FetchTasklet::on_start_streaming_http_response_body_callback);
            pending.on_readable_stream_available = Some(FetchTasklet::on_readable_stream_available);
            pending.on_stream_cancelled = Some(FetchTasklet::on_stream_cancelled_callback);
            return BodyValue::Locked(pending);
        }

        let scheduled_response_buffer = core::mem::take(&mut shared.scheduled_response_buffer);
        let response = BodyValue::InternalBlob(InternalBlob {
            bytes: scheduled_response_buffer.list,
            was_string: false,
        });
        shared.scheduled_response_buffer = MutableString::default();

        response
    }

    fn to_response(t: &mut Parts, shared: &mut HttpHandoff) -> Response {
        bun_output::scoped_log!(FetchTasklet, "toResponse");
        debug_assert!(shared.metadata.is_some());
        // at this point we always should have metadata
        let metadata = shared.metadata.as_ref().unwrap();
        let http_response = &metadata.response;
        t.js.is_waiting_body = shared.result.has_more;
        // PORT NOTE: reshaped for borrowck — capture metadata fields before to_body_value() reborrows `shared`
        let headers = FetchHeaders::create_from_pico_headers(http_response.headers.list);
        let status_code = http_response.status_code as u16;
        // status_text and url must NOT be atomized: the Response can be
        // destroyed from the HTTP thread via deref_from_thread() -> deinit()
        // when the VM is shutting down (see is_shutting_down() branch), and
        // atom strings live in a per-thread table — deref'ing them off-thread
        // trips the `wasRemoved` RELEASE_ASSERT in AtomStringImpl::remove().
        // Plain WTFStringImpl refcounts are atomic, so clone_utf8 is safe.
        // Fast path: when the wire reason phrase matches the canonical text for
        // this status code, store a StaticZigString (deref is a no-op, so still
        // safe to drop off-thread) and skip the WTF allocation entirely.
        let status_text = match crate::server::http_status_text::get(status_code)
            .map(|t| &t[4..])
            .filter(|canon| *canon == http_response.status)
        {
            Some(canon) => BunString::static_(canon),
            None => BunString::clone_utf8(http_response.status),
        };
        let url = BunString::clone_utf8(metadata.url.slice());
        let redirected = shared.result.redirected;
        Response::init(
            crate::webcore::response::Init {
                // SAFETY: create_from_pico_headers returns a fresh refcount=1 FetchHeaders*.
                headers: Some(unsafe { HeadersRef::adopt(headers) }),
                status_code,
                status_text: status_text.into(),
                ..Default::default()
            },
            Body::new(Self::to_body_value(t, shared)),
            url,
            redirected,
        )
    }

    fn ignore_remaining_response_body(&mut self) {
        bun_output::scoped_log!(FetchTasklet, "ignoreRemainingResponseBody");
        // The response is being abandoned. If the request body is still uploading
        // through a ResumableSink, detach its JS wrapper so the cached
        // `ondrain` closure (and the reader/stream graph it captures) becomes
        // collectible instead of leaking. `detach_js` runs no JS callbacks, so it
        // is safe even on the GC-finalizer caller (`on_response_finalize`); the
        // sink's own teardown (`Drop`/`finalize`) handles the rest once its refs
        // drain.
        if let Some(sink) = self.js.sink_mut() {
            sink.detach_js();
        }
        // enabling streaming will make the http thread to drain into the main thread (aka stop buffering)
        // without a stream ref, response body or response instance alive it will just ignore the result
        if let Some(http_) = self.http.as_mut() {
            http_.enable_response_body_streaming();
        }
        // we should not keep the process alive if we are ignoring the body
        let _ = self.javascript_vm;
        self.js.poll_ref.unref(bun_io::js_vm_ctx());
        // clean any remaining references
        self.js.clear_stream_cancel_handler();
        self.js.readable_stream_ref.deinit();
        self.js.response.clear();

        if let Some(response) = self.js.native_response.take() {
            // SAFETY: `response` is the +1 ref held in `native_response`.
            Response::unref(response);
        }

        self.ignore_data.store(true, Ordering::Relaxed);
    }

    fn on_resolve(t: &mut Parts, shared: &mut HttpHandoff) -> JSValue {
        bun_output::scoped_log!(FetchTasklet, "onResolve");
        let response = bun_core::heap::into_raw(Box::new(Self::to_response(t, shared)));
        // SAFETY: response is a freshly allocated Response; makeMaybePooled takes ownership semantics on the JS side
        let global_this = t.js.global_this;
        // SAFETY: `response` is freshly allocated above; ownership transfers to JSC.
        let response_js = Response::make_maybe_pooled(&global_this, response);
        response_js.ensure_still_alive();
        // SAFETY: `t.task` is the live heap tasklet (`Parts` is only built
        // from one), and the resulting `Weak` is stored in `t.js.response` —
        // a field of that same tasklet — so it is cleared or dropped (which
        // destroys the C++ WeakRef) before the tasklet is freed. The finalize
        // callback can therefore never observe a dangling ctx.
        t.js.response = unsafe {
            jsc::Weak::<FetchTasklet>::create_ptr(
                response_js,
                &global_this,
                jsc::WeakRefType::FetchResponse,
                core::ptr::NonNull::new(t.task).expect("live tasklet"),
            )
        };
        // Response is intrusively refcounted; bump for native_response.
        // SAFETY: `response` is the live heap allocation owned by JSC after
        // `make_maybe_pooled`; `ref_` bumps the intrusive refcount.
        t.js.native_response = Some(Response::ref_(response));
        response_js
    }

    pub(crate) fn get(
        global_this: &JSGlobalObject,
        fetch_options: FetchOptions,
        promise: jsc::JSPromiseStrong,
    ) -> Result<*mut FetchTasklet, BunError> {
        // TODO(port): narrow error set
        // SAFETY: bun_vm() returns the FFI `*mut VirtualMachine`; the VM outlives
        // this tasklet (process-lifetime singleton on the JS thread).
        let jsc_vm: &'static VirtualMachine = global_this.bun_vm();
        let mut fetch_tasklet = Box::new(FetchTasklet {
            javascript_vm: jsc_vm,
            request_headers: fetch_options.headers,
            url_proxy_buffer: fetch_options.url_proxy_buffer,
            hostname: fetch_options.hostname,
            reject_unauthorized: fetch_options.reject_unauthorized,
            upgraded_connection: fetch_options.upgraded_connection,
            js: JsState {
                global_this: GlobalRef::from(global_this),
                sink: None,
                request_body: fetch_options.body,
                response: jsc::Weak::default(),
                native_response: None,
                readable_stream_ref: ReadableStreamStrong::default(),
                promise,
                poll_ref: KeepAlive::default(),
                abort_reason: StrongOptional::empty(),
                check_server_identity: fetch_options.check_server_identity,
                signal: fetch_options.signal,
                // SAFETY: jsc_vm derived from FFI ptr above; AsyncTaskTracker::init only
                // bumps a counter on the VM.
                tracker: AsyncTaskTracker::init(global_this.bun_vm().as_mut()),
                is_waiting_body: false,
                is_waiting_abort: false,
                is_waiting_request_stream_start: false,
            },
            shared: Guarded::init(HttpHandoff {
                result: HTTPClientResult::default(),
                metadata: None,
                scheduled_response_buffer: MutableString::default(),
                body_size: http::BodySize::Unknown,
            }),
            // PORT NOTE: Zig used `bun.new(AsyncHTTP, undefined)` then `init()` below.
            // Rust `AsyncHTTP` has no `Default`/zero-init; defer the Box until
            // `AsyncHTTP::init` produces the value.
            http: None,
            response_buffer: MutableString::default(),
            request_body_streaming_buffer: None,
            concurrent_task: ConcurrentTask::default(),
            has_schedule_callback: AtomicBool::new(false),
            ignore_data: AtomicBool::new(false),
            is_http2: AtomicBool::new(false),
            sink_ref_held: AtomicBool::new(false),
            queued_drain_tasks: AtomicU32::new(0),
            signal_store: http::signals::Store::default(),
            signals: Signals::default(),
            // Starts at 2: 1 for the JS thread, 1 for the HTTP thread.
            // Relies on `get()` staying infallible after this `Box::new`
            // (its `Result` return is vestigial).
            ref_count: bun_ptr::ThreadSafeRefCount::init_exact_refs(2),
        });

        fetch_tasklet.signals = fetch_tasklet.signal_store.to();

        fetch_tasklet.js.tracker.did_schedule(global_this);

        // PORT NOTE: Zig followed with `if (request_body.store()) |store| store.ref()`.
        // That +1 balanced fetch.zig's local `body` (bitwise-copied into `http_body`)
        // calling `body.detach()` after `queue()` returned. In Rust, `body` is *moved*
        // through `FetchOptions` into `request_body` (no shallow alias, no post-queue
        // detach), so the StoreRef already carries the caller's +1 — bumping it again
        // here leaked one ref per Blob-backed body (issue: fetch-leak fixture #5 RSS
        // growth). `clear_data() → request_body.detach()` releases it.
        //
        // NB: fixture-5's stream/iterator Promise-count overshoot is a pre-existing
        // Zig spec bug (paused ResumableFetchSink ref-cycle when the server never
        // reads the body), not a port divergence — tracked upstream.

        let mut url = fetch_options.url;
        let mut proxy: Option<ZigURL> = None;
        let env = global_this.bun_vm().as_mut().transpiler.env_mut();
        if let Some(proxy_opt) = &fetch_options.proxy {
            if !proxy_opt.is_empty() {
                //if is empty just ignore proxy
                // Check NO_PROXY even for explicitly-provided proxies
                if !env.is_no_proxy(Some(url.hostname), Some(url.host)) {
                    proxy = Some(proxy_opt.clone());
                }
            }
            // else: proxy: "" means explicitly no proxy (direct connection)
        } else {
            // no proxy provided, use default proxy resolution
            if let Some(env_proxy) = env.get_http_proxy_for(&url) {
                // env_proxy.href may be a slice into a RefCountedEnvValue's bytes which can
                // be freed by a subsequent `process.env.HTTP_PROXY = "..."` assignment while
                // this fetch is in flight on the HTTP thread. Clone it into url_proxy_buffer
                // alongside the request URL — the same pattern fetch.zig uses for the explicit
                // `fetch(url, { proxy: "..." })` option.
                if !env_proxy.href.is_empty() {
                    let old_url_len = url.href.len();
                    let mut new_buffer = Vec::with_capacity(
                        fetch_tasklet.url_proxy_buffer.len() + env_proxy.href.len(),
                    );
                    new_buffer.extend_from_slice(&fetch_tasklet.url_proxy_buffer);
                    new_buffer.extend_from_slice(env_proxy.href.as_ref());
                    let new_buffer = new_buffer.into_boxed_slice();
                    fetch_tasklet.url_proxy_buffer = new_buffer;
                    // SAFETY: url_proxy_buffer is heap-owned by the boxed FetchTasklet and
                    // outlives `url`/`proxy` (consumed by AsyncHTTP::init below before the
                    // tasklet is dropped). Erase the borrow to a raw slice so borrowck
                    // doesn't tie `url`'s lifetime to the `fetch_tasklet` stack binding,
                    // which is moved into `heap::alloc` below.
                    let buf_ptr: *const [u8] = &raw const *fetch_tasklet.url_proxy_buffer;
                    // SAFETY: `buf_ptr` was just taken from the heap-owned `url_proxy_buffer`
                    // assigned above; see lifetime argument in the preceding block comment.
                    let buf = unsafe { &*buf_ptr };
                    url = ZigURL::parse(&buf[0..old_url_len]);
                    proxy = Some(ZigURL::parse(&buf[old_url_len..]));
                    // TODO(port): self-referential borrow into url_proxy_buffer; needs raw ptr or owned URL.
                } else {
                    proxy = Some(env_proxy);
                }
            }
        }

        if fetch_tasklet.js.check_server_identity.has() && fetch_tasklet.reject_unauthorized {
            fetch_tasklet
                .signal_store
                .cert_errors
                .store(true, Ordering::Relaxed);
        } else {
            fetch_tasklet.signals.cert_errors = None;
        }

        let fetch_tasklet_ptr = bun_core::heap::into_raw(fetch_tasklet);
        // SAFETY: just allocated; exclusive access until returned
        let fetch_tasklet = unsafe { &mut *fetch_tasklet_ptr };

        // This task gets queued on the HTTP thread.
        // PORT NOTE: `AsyncHTTP::init` takes several `&'static [u8]` borrows
        // (headers_buf, request_body, hostname) that in Zig were plain slices
        // into FetchTasklet-owned storage. The tasklet is now heap-pinned via
        // `heap::alloc`, so erase the borrow lifetimes through raw pointers.
        // SAFETY: `fetch_tasklet_ptr` is a stable heap allocation that outlives
        // the AsyncHTTP (dropped together in `deinit`); the slices below borrow
        // its `request_headers.buf`, `request_body`, `hostname`, and
        // `response_buffer` fields which are not reallocated for the lifetime
        // of the request.
        // SAFETY (`Interned::assume` — Population B, holder-backed):
        // `fetch_tasklet_ptr` is a `heap::alloc`'d `FetchTasklet` whose
        // `request_headers.buf` / `request_body` / `hostname` fields are not
        // reallocated for the request's lifetime, and the tasklet is freed in
        // `deinit` only after the owned `AsyncHTTP` is dropped. NOT
        // process-lifetime — these should become `RawSlice<u8>` once
        // `AsyncHTTP::init` accepts holder-lifetime slices; `assume` names the
        // owner so the widen is grep-able until then.
        let headers_buf: &'static [u8] =
            unsafe { bun_ptr::Interned::assume(fetch_tasklet.request_headers.buf.as_slice()) }
                .as_bytes();
        // SAFETY: see `Interned::assume` note above — same heap-pinned `FetchTasklet` owner.
        let request_body_slice: &'static [u8] =
            unsafe { bun_ptr::Interned::assume(fetch_tasklet.js.request_body.slice()) }.as_bytes();
        let hostname: Option<&'static [u8]> = fetch_tasklet
            .hostname
            .as_deref()
            // SAFETY: see block note above — same `FetchTasklet` owner.
            .map(|s| unsafe { bun_ptr::Interned::assume(s) }.as_bytes());
        let response_buffer: *mut MutableString = &raw mut fetch_tasklet.response_buffer;
        // PORT NOTE: Zig passed `fetch_options.headers.entries` by value (shallow
        // struct copy → shared backing storage). `MultiArrayList` in Rust owns its
        // allocation, so clone; AsyncHTTP::init clones again for the client.
        let header_entries = bun_core::handle_oom(fetch_tasklet.request_headers.entries.clone());
        // PORT NOTE: `url` is moved into `AsyncHTTP::init`; capture the one
        // post-move query (`is_http()`, debug-assert only) up front.
        let url_is_http = url.is_http();

        fetch_tasklet.http = Some(Box::new(AsyncHTTP::init(
            fetch_options.method,
            url,
            header_entries,
            headers_buf,
            response_buffer,
            request_body_slice,
            // handles response events (on headers, on body, etc.)
            http::HTTPClientResultCallback::new_with_release::<FetchTasklet>(
                fetch_tasklet_ptr,
                // SAFETY: `new_with_release` guarantees the pointer/lifetime
                // contract `callback` documents.
                FetchTasklet::callback,
                FetchTasklet::release_at_shutdown,
            ),
            fetch_options.redirect_type,
            http::async_http::Options {
                http_proxy: proxy,
                proxy_headers: fetch_options.proxy_headers,
                hostname,
                signals: Some(fetch_tasklet.signals),
                unix_socket_path: Some(fetch_options.unix_socket_path),
                disable_timeout: Some(fetch_options.disable_timeout),
                disable_keepalive: Some(fetch_options.disable_keepalive),
                disable_decompression: Some(fetch_options.disable_decompression),
                max_redirects: fetch_options.max_redirects,
                reject_unauthorized: Some(fetch_options.reject_unauthorized),
                verbose: Some(fetch_options.verbose),
                tls_props: fetch_options.ssl_config,
            },
        )));
        // enable streaming the write side
        let is_stream = matches!(
            fetch_tasklet.js.request_body,
            HTTPRequestBody::ReadableStream(_)
        );
        let http_client = fetch_tasklet.http.as_mut().unwrap();
        http_client.client.flags.is_streaming_request_body = is_stream;
        http_client.client.flags.force_http2 = fetch_options.force_http2;
        http_client.client.flags.force_http3 = fetch_options.force_http3;
        http_client.client.flags.force_http1 = fetch_options.force_http1;
        http_client.client.flags.is_node_http_client = fetch_options.is_node_http_client;
        fetch_tasklet.js.is_waiting_request_stream_start = is_stream;
        if is_stream {
            // Intrusive `ref_count` starts at 2 (one for the main thread, one for the HTTP
            // thread) so handing the same raw pointer to both sides matches Zig's ownership.
            let buffer = ThreadSafeStreamBuffer::new(ThreadSafeStreamBuffer::default());
            // SAFETY: fresh heap allocation from `ThreadSafeStreamBuffer::new` (heap::alloc);
            // exclusively owned here until shared below.
            unsafe {
                (*buffer).set_drain_callback::<FetchTasklet>(
                    FetchTasklet::on_write_request_data_drain,
                    fetch_tasklet_ptr,
                );
            }
            let buffer_nn = core::ptr::NonNull::new(buffer);
            fetch_tasklet.request_body_streaming_buffer = buffer_nn;
            fetch_tasklet.http.as_mut().unwrap().request_body =
                http::HTTPRequestBody::Stream(http::http_request_body::Stream {
                    buffer: buffer_nn,
                    ended: false,
                });
        }
        // TODO is this necessary? the http client already sets the redirect type,
        // so manually setting it here seems redundant
        if fetch_options.redirect_type != FetchRedirect::Follow {
            fetch_tasklet
                .http
                .as_mut()
                .unwrap()
                .client
                .remaining_redirect_count = 0;
        }

        // we want to return after headers are received
        fetch_tasklet
            .signal_store
            .header_progress
            .store(true, Ordering::Relaxed);

        if let HTTPRequestBody::Sendfile(sendfile) = &fetch_tasklet.js.request_body {
            debug_assert!(url_is_http);
            debug_assert!(fetch_options.proxy.is_none());
            fetch_tasklet.http.as_mut().unwrap().request_body =
                http::HTTPRequestBody::Sendfile(*sendfile);
        }

        if let Some(signal) = fetch_tasklet.js.signal {
            // `signal` is a live C++-owned WebCore::AbortSignal* (already ref'd by
            // the caller before populating `fetch_options.signal`).
            // Zig: `signal.pendingActivityRef(); fetch_tasklet.signal = signal.listen(...)`.
            // `add_listener` returns `self`, so the field already holds the right ptr.
            // S008: `AbortSignal` is an `opaque_ffi!` ZST — safe `*const → &`.
            let signal = bun_opaque::opaque_deref(signal);
            signal.pending_activity_ref();
            signal.add_listener(fetch_tasklet_ptr.cast::<c_void>(), Self::__abort_listener_c);
        }
        Ok(fetch_tasklet_ptr)
    }

    #[bun_uws::uws_callback]
    pub(crate) fn abort_listener(&mut self, reason: JSValue) {
        bun_output::scoped_log!(FetchTasklet, "abortListener");
        let this = self;
        reason.ensure_still_alive();
        this.js.abort_reason.set(&this.js.global_this, reason);
        this.abort_task();
        if let Some(sink) = this.js.sink_mut() {
            sink.cancel(reason);
            return;
        }
        // Abort fired before the HTTP thread asked for the body, so the
        // ReadableStream was never wired into a sink. Cancel it directly so
        // the underlying source's cancel(reason) callback still observes the
        // signal's reason (https://fetch.spec.whatwg.org/#abort-fetch step 5).
        if this.js.is_waiting_request_stream_start {
            if let HTTPRequestBody::ReadableStream(stream_ref) = &this.js.request_body {
                this.js.is_waiting_request_stream_start = false;
                if let Some(stream) = stream_ref.get(&this.js.global_this) {
                    stream.cancel_with_reason(&this.js.global_this, reason);
                }
            }
        }
    }

    /// This is ALWAYS called from the http thread and we cannot touch the buffer here because is locked
    pub(crate) fn on_write_request_data_drain(this: *mut FetchTasklet) {
        let this_ref = Self::from_raw_ref(this);
        if this_ref.javascript_vm.is_shutting_down() {
            return;
        }
        // drain-task ref — released by `release_drain_task_ref` in
        // `resume_request_data_stream`, or balanced by `release_at_shutdown`
        // (via `queued_drain_tasks`) when exit drops the node unrun.
        this_ref.ref_();
        this_ref.queued_drain_tasks.fetch_add(1, Ordering::Release);
        // `from_callback` heap-allocates a fresh `ConcurrentTaskItem`; the queue
        // takes ownership of it.
        Self::enqueue_concurrent(
            this_ref.javascript_vm,
            ConcurrentTask::from_callback(this, FetchTasklet::resume_request_data_stream),
        );
    }

    /// This is ALWAYS called from the main thread
    // PORT NOTE: in Zig 'fn (*FetchTasklet) error{}!void' coerces to 'fn (*FetchTasklet) bun.JSError!void';
    // ConcurrentTask::from_callback expects `fn(*mut T) -> bun_event_loop::JsResult<()>`.
    pub(crate) fn resume_request_data_stream(this: *mut FetchTasklet) -> ElJsResult<()> {
        let this_ref = Self::from_raw_mut(this);
        bun_output::scoped_log!(FetchTasklet, "resumeRequestDataStream");
        let result = (|| {
            if this_ref.js.signal_aborted() {
                // already aborted; nothing to drain
                return;
            }
            if let Some(sink) = this_ref.js.sink_mut() {
                sink.drain();
            }
        })();
        // balances the ref taken in `on_write_request_data_drain`
        // SAFETY: `this` is the live heap tasklet; we hold a ref.
        FetchTasklet::release_drain_task_ref(this);
        let () = result;
        Ok(())
    }

    /// Whether the request body should skip chunked transfer encoding framing.
    /// True for upgraded connections (e.g. WebSocket) or when the user explicitly
    /// set Content-Length without setting Transfer-Encoding.
    fn skip_chunked_framing(&self) -> bool {
        self.upgraded_connection
            || self.is_http2.load(Ordering::Relaxed)
            || (self.request_headers.get(b"content-length").is_some()
                && self.request_headers.get(b"transfer-encoding").is_none())
    }

    pub(crate) fn write_request_data(&mut self, data: &[u8]) -> ResumableSinkBackpressure {
        bun_output::scoped_log!(FetchTasklet, "writeRequestData {}", data.len());
        if self.js.signal_aborted() {
            return ResumableSinkBackpressure::Done;
        }
        // PORT NOTE: reshaped for borrowck — read sink HWM (Copy) before
        // borrowing the stream buffer so `self` is unborrowed during the
        // mutex critical section below.
        let high_water_mark: usize = match self.js.sink_mut() {
            Some(sink) => sink.high_water_mark() as usize,
            None => 16384,
        };
        let Some(thread_safe_stream_buffer) = self.stream_buffer_mut() else {
            return ResumableSinkBackpressure::Done;
        };
        // Mutex guards `buffer` against the HTTP thread; released when
        // `stream_buffer` drops. Borrow is detached from `self` (see accessor).
        let mut stream_buffer = thread_safe_stream_buffer.lock();

        // dont have backpressure so we will schedule the data to be written
        // if we have backpressure the onWritable will drain the buffer
        let needs_schedule = stream_buffer.is_empty();
        if self.skip_chunked_framing() {
            let _ = stream_buffer.write(data); // OOM/capacity: Zig aborts; port keeps fire-and-forget
        } else {
            //16 is the max size of a hex number size that represents 64 bits + 2 for the \r\n
            let mut formated_size_buffer = [0u8; 18];
            use std::io::Write;
            let formated_size = {
                let mut cursor = &mut formated_size_buffer[..];
                write!(cursor, "{:x}\r\n", data.len()).expect("unreachable");
                let written = 18 - cursor.len();
                &formated_size_buffer[..written]
            };
            let _ = stream_buffer.ensure_unused_capacity(formated_size.len() + data.len() + 2); // OOM/capacity: Zig aborts; port keeps fire-and-forget
            // PERF(port): was assume_capacity
            stream_buffer.write_assume_capacity(formated_size);
            stream_buffer.write_assume_capacity(data);
            stream_buffer.write_assume_capacity(b"\r\n");
        }

        let result = if stream_buffer.size() >= high_water_mark {
            ResumableSinkBackpressure::Backpressure
        } else {
            ResumableSinkBackpressure::WantMore
        };

        if needs_schedule {
            // wakeup the http thread to write the data
            http::http_thread().schedule_request_write(
                self.http.as_mut().unwrap(),
                http::http_thread::WriteMessageType::Data,
            );
        }

        // pause the stream if we hit the high water mark
        result
    }

    pub(crate) fn write_end_request(&mut self, err: Option<JSValue>) {
        bun_output::scoped_log!(FetchTasklet, "writeEndRequest hasError? {}", err.is_some());
        let this_ptr = std::ptr::from_mut(self);
        if let Some(js_error) = err {
            if self.signal_store.aborted.load(Ordering::Relaxed) || self.js.abort_reason.has() {
                // SAFETY: `this_ptr` derived from live `&mut self`; we hold a ref.
                FetchTasklet::release_sink_ref(this_ptr);
                return;
            }
            if !js_error.is_undefined_or_null() {
                self.js.abort_reason.set(&self.js.global_this, js_error);
            }
            self.abort_task();
        } else {
            if !self.skip_chunked_framing() {
                // Using chunked transfer encoding, send the terminating chunk
                let Some(thread_safe_stream_buffer) = self.stream_buffer_mut() else {
                    // SAFETY: `this_ptr` derived from live `&mut self`; we hold a ref.
                    FetchTasklet::release_sink_ref(this_ptr);
                    return;
                };
                // Mutex guards `buffer` against the HTTP thread; released when
                // the lock guard drops.
                let _ = thread_safe_stream_buffer
                    .lock()
                    .write(http::END_OF_CHUNKED_HTTP1_1_ENCODING_RESPONSE_BODY); // OOM/capacity: Zig aborts; port keeps fire-and-forget
            }
            if let Some(http_) = self.http.as_mut() {
                http::http_thread()
                    .schedule_request_write(http_, http::http_thread::WriteMessageType::End);
            }
        }
        // SAFETY: `this_ptr` derived from live `&mut self`; we hold a ref.
        FetchTasklet::release_sink_ref(this_ptr);
    }

    pub(crate) fn abort_task(&mut self) {
        self.signal_store.aborted.store(true, Ordering::Relaxed);
        self.js.tracker.did_cancel(&self.js.global_this);

        if let Some(http_) = self.http.as_mut() {
            http::http_thread().schedule_shutdown(http_);
        }
    }

    pub(crate) fn queue(
        global: &JSGlobalObject,
        fetch_options: FetchOptions,
        promise: jsc::JSPromiseStrong,
    ) -> Result<*mut FetchTasklet, BunError> {
        // TODO(port): narrow error set
        http::http_thread::init(&http::http_thread::InitOpts::default());
        let node = Self::get(global, fetch_options, promise)?;

        let node_ref = Self::from_raw_mut(node);
        let mut batch = bun_threading::thread_pool::Batch::default();
        node_ref.http.as_mut().unwrap().schedule(&mut batch);
        node_ref.js.poll_ref.ref_(bun_io::js_vm_ctx());

        http::HTTPThread::schedule(batch);

        Ok(node)
    }

    /// Called from HTTP thread. Handles HTTP events received from socket.
    ///
    /// # Safety
    /// `task` must be a live heap-allocated `FetchTasklet` with the
    /// HTTP-thread ref still held; `async_http` must point to the HTTP
    /// thread's live `AsyncHTTP` for the duration of the call.
    // Signature is fixed by `HTTPClientResultCallback`; `task` may be freed by the
    // trailing `deref_from_thread`, so it cannot become `&mut`.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn callback(
        task: *mut FetchTasklet,
        async_http: *mut AsyncHTTP<'static>,
        result: HTTPClientResult,
    ) {
        // at this point only this thread is accessing result to is no race condition
        let is_done = !result.has_more;
        let task_ref = Self::from_raw_mut(task);

        let mut shared = task_ref.shared.lock();
        // drop the guard before the release — its Drop must not touch freed memory
        // Zig: `task.http.?.* = async_http.*; task.http.?.response_buffer = async_http.response_buffer;`
        // — bitwise struct copy of HTTP-thread state back into the JS-side instance.
        // `AsyncHTTP` is not `Copy` in Rust (`HTTPClient: Drop`, owned Vecs), so use the
        // explicit field-subset sync; see `AsyncHTTP::sync_progress_from` for the field list.
        // SAFETY: `async_http` is the HTTP-thread copy passed by `on_async_http_callback`;
        // it is alive for the duration of this call and not mutated concurrently (HTTP
        // thread is blocked in the callback).
        task_ref
            .http
            .as_mut()
            .unwrap()
            .sync_progress_from(unsafe { &*async_http });

        bun_output::scoped_log!(
            FetchTasklet,
            "callback success={} ignore_data={} has_more={} bytes={}",
            result.is_success(),
            task_ref.ignore_data.load(Ordering::Relaxed),
            result.has_more,
            result.body.as_ref().map(|b| b.list.len()).unwrap_or(0)
        );

        // Zig: `task.response_buffer = result.body.?.*` — verify the aliasing invariant
        // that makes that bitwise copy a no-op (see PORT NOTE below at the original site).
        debug_assert!(
            result
                .body
                .as_deref()
                .is_none_or(|b| core::ptr::eq(b, &raw const task_ref.response_buffer)),
            "HTTPClientResult.body must alias FetchTasklet.response_buffer",
        );

        // The stored copy's `body` is never read (the bytes already live in
        // `response_buffer`, alias asserted above on the incoming result).
        let mut result = result;
        result.body = None;
        // SAFETY: lifetime erasure — `HTTPClientResult<'a>`'s only borrow is
        // `body`, which is `None` here, so the `'_` → `'static` widening
        // stores no live borrow.
        shared.merge_result(unsafe { result.detach_lifetime() });
        task_ref
            .is_http2
            .store(shared.result.is_http2, Ordering::Relaxed);

        let success = shared.result.is_success();
        // PORT NOTE: Zig `task.response_buffer = result.body.?.*` is a bitwise self-copy of
        // the Vec header — `result.body` always aliases `task_ref.response_buffer` (the
        // `*mut MutableString` passed to `AsyncHTTP::init` at FetchTasklet::create flows
        // through `HTTPClient.state.body_out_str` and back out in the result). Asserted
        // above before the lifetime-erasing assignment; the bytes are already in place, so
        // no copy is needed and the `reset()` calls below operate on the right allocation.

        if task_ref.ignore_data.load(Ordering::Relaxed) {
            task_ref.response_buffer.reset();

            if shared.scheduled_response_buffer.list.capacity() > 0 {
                shared.scheduled_response_buffer = MutableString::default();
            }
            if success && shared.result.has_more {
                // we are ignoring the body so we should not receive more data, so will only signal when result.has_more = true
                drop(shared);
                if is_done {
                    // SAFETY: `task` is the live heap tasklet; HTTP-thread ref held.
                    FetchTasklet::release_http_ref(task);
                }
                return;
            }
        } else {
            if success {
                shared.stage_response_bytes(&mut task_ref.response_buffer);
            } else {
                task_ref.response_buffer.reset();
            }
        }

        if let Err(has_schedule_callback) = task_ref.has_schedule_callback.compare_exchange(
            false,
            true,
            Ordering::Acquire,
            Ordering::Relaxed,
        ) {
            if has_schedule_callback {
                drop(shared);
                if is_done {
                    // SAFETY: `task` is the live heap tasklet; HTTP-thread ref held.
                    FetchTasklet::release_http_ref(task);
                }
                return;
            }
        }
        // will deinit when done with the http client (when is_done = true)
        if task_ref.javascript_vm.is_shutting_down() {
            // VM teardown: the JS-thread side will never drain this buffer (its
            // on_progress_update bails the same way), so free the body bytes now.
            shared.scheduled_response_buffer = MutableString::default();
            // The certificate will never be checked; release the parked
            // socket instead of leaving it occupying an active request slot
            // until the idle timeout.
            if shared.result.certificate_info.take().is_some() {
                if let Some(http_) = task_ref.http.as_mut() {
                    http::http_thread().schedule_shutdown(http_);
                }
            }
            // We won the `has_schedule_callback` CAS above but are not
            // enqueueing the on_progress_update task; undo the flag so a later
            // (final) callback can re-enter this branch instead of taking the
            // already-scheduled early return.
            task_ref
                .has_schedule_callback
                .store(false, Ordering::Release);
            drop(shared);
            if is_done {
                // A final callback in this window removes the entry from
                // `in_flight` (`on_async_http_callback_raw`), so
                // `release_at_shutdown` will never run for it — take and
                // balance a still-attached sink's ref and any queued
                // drain-task refs here too, or the tasklet ⇄ `Box<AsyncHTTP>`
                // ⇄ sink chain leaks at exit. The invariant is weaker than
                // `release_at_shutdown`'s: the JS thread is not parked yet
                // (it is running `global_exit` cleanup between
                // `is_shutting_down = true` and `shutdown_for_exit`), but it
                // never ticks the event loop again, so the JS-side release
                // sites (`release_sink_ref`, `release_drain_task_ref`) cannot
                // race the take.
                for _ in 0..FetchTasklet::take_streaming_refs_for_exit(task) {
                    // SAFETY: `task` is the live heap tasklet; refs still held.
                    FetchTasklet::deref_from_thread(task);
                }
                // No on_progress_update will ever run for this final result, so
                // release the JS-side ref it would have dropped (raw
                // `deref_from_thread` — we are on the HTTP thread, the JS
                // thread never runs fetch JS again), then the HTTP-side ref.
                // The 1→0 transition runs `dealloc_for_shutdown` (Rust boxes
                // only — JSC handles are leaked to destructOnExit).
                // SAFETY: `task` is the live heap tasklet; both refs held.
                FetchTasklet::deref_from_thread(task);
                // SAFETY: second ref still held until this 1→0 transition.
                FetchTasklet::release_http_ref(task);
            }
            return;
        }
        let ct = core::ptr::NonNull::from(
            task_ref
                .concurrent_task
                .from(task, AutoDeinit::ManualDeinit),
        );
        // `ct` is the inline `concurrent_task` field of the heap tasklet; the
        // queue takes ownership of its `next` link.
        Self::enqueue_concurrent(task_ref.javascript_vm, ct);

        drop(shared);
        // we are done with the http client so we can deref our side
        // this is a atomic operation and will enqueue a task to deinit on the main thread
        if is_done {
            // SAFETY: `task` is the live heap tasklet; HTTP-thread ref held.
            FetchTasklet::release_http_ref(task);
        }
    }
}

impl FetchTasklet {
    #[bun_uws::uws_callback(export = "Bun__FetchResponse_finalize", no_catch)]
    pub(crate) fn on_response_finalize(&mut self) {
        bun_output::scoped_log!(FetchTasklet, "onResponseFinalize");
        let this = self;
        if let Some(response) = this.js.native_response {
            // SAFETY: native_response is intrusively-ref'd by FetchTasklet; alive until unref.
            let body = unsafe { (*response).get_body_value() };
            // Three scenarios:
            //
            // 1. We are streaming, in which case we should not ignore the body.
            // 2. We were buffering, in which case
            //    2a. if we have no promise, we should ignore the body.
            //    2b. if we have a promise, we should keep loading the body.
            // 3. We never started buffering, in which case we should ignore the body.
            //
            // Note: We cannot call .get() on the ReadableStreamRef. This is called inside a finalizer.
            if !matches!(body, BodyValue::Locked(_)) || this.js.readable_stream_ref.has() {
                // Scenario 1 or 3.
                return;
            }

            if let BodyValue::Locked(locked) = body {
                if let Some(promise) = locked.promise {
                    if promise.is_empty_or_undefined_or_null() {
                        // Scenario 2b.
                        this.ignore_remaining_response_body();
                    }
                } else {
                    // Scenario 3.
                    this.ignore_remaining_response_body();
                }
            }
        }
    }
}

pub struct FetchOptions {
    pub method: Method,
    pub headers: Headers,
    pub body: HTTPRequestBody,
    pub disable_timeout: bool,
    pub disable_keepalive: bool,
    pub disable_decompression: bool,
    pub max_redirects: Option<u8>,
    pub reject_unauthorized: bool,
    pub url: ZigURL<'static>,
    pub verbose: http::HTTPVerboseLevel,
    pub redirect_type: FetchRedirect,
    pub proxy: Option<ZigURL<'static>>,
    pub proxy_headers: Option<Headers>,
    pub url_proxy_buffer: Box<[u8]>,
    pub signal: Option<*mut AbortSignal>,
    pub global_this: Option<GlobalRef>,
    // Custom Hostname
    pub hostname: Option<Box<[u8]>>,
    pub check_server_identity: StrongOptional,
    pub unix_socket_path: ZigStringSlice,
    pub ssl_config: Option<http::ssl_config::SharedPtr>,
    pub upgraded_connection: bool,
    pub force_http2: bool,
    pub force_http3: bool,
    pub force_http1: bool,
    pub is_node_http_client: bool,
}

impl Default for FetchOptions {
    fn default() -> Self {
        // PORT NOTE: Zig FetchOptions had per-field defaults for the optional half of the struct;
        // the required fields (method/headers/body/url/bools/unix_socket_path/globalThis) had none.
        // We supply zero-values for those so callers can use `..Default::default()` struct-update
        // syntax while still overriding the required fields explicitly.
        Self {
            method: Method::GET,
            headers: Headers::default(),
            body: HTTPRequestBody::default(),
            disable_timeout: false,
            disable_keepalive: false,
            disable_decompression: false,
            max_redirects: None,
            reject_unauthorized: true,
            url: ZigURL::default(),
            verbose: http::HTTPVerboseLevel::None,
            redirect_type: FetchRedirect::Follow,
            proxy: None,
            proxy_headers: None,
            url_proxy_buffer: Box::default(),
            signal: None,
            global_this: None,
            hostname: None,
            check_server_identity: StrongOptional::empty(),
            unix_socket_path: ZigStringSlice::EMPTY,
            ssl_config: None,
            upgraded_connection: false,
            force_http2: false,
            force_http3: false,
            force_http1: false,
            is_node_http_client: false,
        }
    }
}

// ported from: src/runtime/webcore/fetch/FetchTasklet.zig
