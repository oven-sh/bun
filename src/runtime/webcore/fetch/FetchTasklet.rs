use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, Ordering};

use bun_boringssl as boringssl;
use bun_cares_sys::c_ares_draft as c_ares;
use bun_core::{MutableString, String as BunString};
use bun_event_loop::{
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
use bun_jsc::bun_string_jsc;
use bun_jsc::debugger::AsyncTaskTracker;
use bun_jsc::{self as jsc, GlobalRef, JSGlobalObject, JSValue, JsCell, JsResult, StrongOptional};
use bun_ptr::RefPtr;
use bun_sys::FdExt;
use bun_threading::Mutex;
use bun_url::URL as ZigURL;

use crate::api::bun_x509 as X509;
use crate::webcore::blob::{Any as AnyBlob, Blob, SizeType as BlobSizeType, Store as BlobStore};
use crate::webcore::body::{self, Body, Value as BodyValue, ValueError as BodyValueError};
use crate::webcore::fetch::fetch_request_body_sink::{FetchRequestBodySink, RequestBodyChunk};
use crate::webcore::readable_stream::{ReadableStream, Strong as ReadableStreamStrong};
use crate::webcore::response::HeadersRef;
use crate::webcore::sink::JSSink;
use crate::webcore::streams::{SourceHandle, StreamError, StreamResult, Writable};
use crate::webcore::{AbortSignal, DrainResult, FetchHeaders, InternalBlob, Response, SinkHandle};
use bun_jsc::AbortSignalRef;

// `bun_event_loop::JsResult` (cycle-broken erased error) — used by
// ConcurrentTask callbacks at the tier-3 layer.
type ElJsResult<T> = bun_event_loop::JsResult<T>;

use http::signals::BODY_HIGH_WATER_MARK;

use boringssl::c::{X509_free, d2i_X509};

// ConcurrentTask::from() needs `Taskable`; tag is declared in bun_event_loop
// but the impl lives next to the type (cycle-break).
/// The "last ref dropped on the HTTP thread → deinit on the JS thread" hop:
/// same pointer, its own tag, so teardown can tell it from a progress update.
#[repr(transparent)]
pub struct FetchTaskletDeinitHop(FetchTasklet);
impl Taskable for FetchTaskletDeinitHop {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::FetchTaskletDeinit;
    /// The last ref dropped on the HTTP thread while we were tearing down:
    /// deinit here, on the JS thread with the heap alive, as the hop intended.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract.
        unsafe { Self::run(this) }
    }
}
impl FetchTaskletDeinitHop {
    /// # Safety
    /// `this` is the tasklet the hop was created from, ref_count == 0, JS thread.
    pub(crate) unsafe fn run(this: *mut Self) {
        // SAFETY: fn contract — sole owner.
        drop(unsafe { bun_core::heap::take(this.cast::<FetchTasklet>()) });
    }
}

impl Taskable for FetchTasklet {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::FetchTasklet;
    /// A progress hop the HTTP thread posted: it carries the +1 that
    /// `on_progress_update` would have dropped. The HTTP thread's own +1 is
    /// released only after its last touch of the tasklet, so a 1→0 here means
    /// it is done with it, and this runs on the JS thread with the heap alive.
    unsafe fn release_unrun(this: *mut Self) {
        FetchTasklet::deref(this);
    }
}

bun_output::declare_scope!(FetchTasklet, visible);

/// Upper bound on the Content-Length-driven `reserve_exact` in `callback()`.
const SCHEDULED_PRERESERVE_MAX: usize = 256 * 1024 * 1024;

use http::signals::BodyReceiveMode;

#[derive(bun_ptr::ThreadSafeRefCounted)]
pub struct FetchTasklet {
    // Heap-allocated `FetchRequestBodySink` (a `JSSink`). FetchTasklet owns the
    // allocation from `start_request_stream` until `clear_sink`; the JS
    // controller holds only a detachable back-pointer into it.
    pub sink: Option<core::ptr::NonNull<FetchRequestBodySink>>,
    // Self-referential: borrows from `request_body` / `request_headers` owned
    // by sibling fields, so the lifetime is erased to `'static`.
    pub(crate) http: Option<Box<AsyncHTTP<'static>>>,
    pub(crate) result: HTTPClientResult<'static>,
    pub(crate) metadata: Option<HTTPResponseMetadata>,
    /// Held while the request is out on the HTTP thread (`queue` until its
    /// final callback / `release_at_shutdown`): how that thread posts progress
    /// and deinit tasks, and what makes the VM wait for it. JS-thread code uses
    /// the VM through `global_this` instead and never touches this.
    pub(crate) http_ticket: Option<jsc::Ticket>,
    pub global_this: GlobalRef,
    pub(crate) request_body: HTTPRequestBody,
    /// This side's ref; the HTTP thread holds the other of the two initial refs.
    pub(crate) request_body_streaming_buffer: Option<RefPtr<ThreadSafeStreamBuffer>>,

    /// buffer used to stream response to JS
    pub(crate) scheduled_response_buffer: MutableString,
    /// response weak ref we need this to track the response JS lifetime
    pub(crate) response: jsc::Weak<FetchTasklet>,
    /// native response ref if we still need it when JS is discarted
    pub(crate) native_response: JsCell<Option<RefPtr<Response>>>,
    /// The response body stream while this tasklet is its producer.
    pub(crate) response_stream: crate::webcore::byte_stream::ProducerHold,
    pub(crate) request_headers: Headers,
    pub(crate) promise: jsc::JSPromiseStrong,
    pub(crate) concurrent_task: ConcurrentTask,
    /// `JsCell`: the ByteStream's drain signal reaches `on_stream_drained` through a shared ref.
    pub poll_ref: JsCell<KeepAlive>,
    /// For Http Client requests
    /// when Content-Length is provided this represents the whole size of the request
    /// If chunked encoded this will represent the total received size (ignoring the chunk headers)
    /// If is not chunked encoded and Content-Length is not provided this will be unknown
    pub(crate) body_size: http::BodySize,

    /// This is url + proxy memory buffer and is owned by FetchTasklet
    /// We always clone url and proxy (if informed)
    pub(crate) url_proxy_buffer: Box<[u8]>,

    pub(crate) signal: Option<AbortSignalRef>,
    pub(crate) signals: Signals,
    pub(crate) signal_store: http::signals::Store,
    pub(crate) has_schedule_callback: AtomicBool,

    // must be stored because AbortSignal stores reason weakly
    pub(crate) abort_reason: StrongOptional,

    // custom checkServerIdentity
    pub(crate) check_server_identity: StrongOptional,
    pub(crate) reject_unauthorized: bool,
    pub(crate) upgraded_connection: bool,
    pub(crate) unix_socket_path: Box<[u8]>,
    pub(crate) is_waiting_body: bool,
    pub(crate) is_waiting_abort: bool,
    pub(crate) is_waiting_request_stream_start: bool,
    pub(crate) mutex: Mutex,

    pub(crate) tracker: AsyncTaskTracker,

    pub(crate) ref_count: bun_ptr::ThreadSafeRefCount<FetchTasklet>,
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
        // `Blob` has no `const EMPTY`
        // (non-Copy fields), so use the runtime `Default` instead of a const.
        HTTPRequestBody::AnyBlob(AnyBlob::Blob(Blob::default()))
    }
}

impl HTTPRequestBody {
    pub(crate) fn store(&self) -> Option<&BlobStore> {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.store(),
            _ => None,
        }
    }

    pub(crate) fn slice(&self) -> &[u8] {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.slice(),
            _ => b"",
        }
    }

    pub(crate) fn detach(&mut self) {
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
        body_value.throw_if_html_bundle(global_this)?;
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
                // `BodyValue` now has `Drop` (H3), so we cannot move
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
                        // See note above re: E0509 and `Value::drop`.
                        return Ok(HTTPRequestBody::ReadableStream(core::mem::take(
                            &mut l.readable,
                        )));
                    }
                }
            }
        }
        Ok(HTTPRequestBody::AnyBlob(body_value.use_as_any_blob()))
    }

    pub(crate) fn needs_to_read_file(&self) -> bool {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.needs_to_read_file(),
            _ => false,
        }
    }

    pub(crate) fn is_s3(&self) -> bool {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.is_s3(),
            _ => false,
        }
    }

    pub(crate) fn has_content_type_from_user(&self) -> bool {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.has_content_type_from_user(),
            _ => false,
        }
    }

    pub(crate) fn get_any_blob(&mut self) -> Option<&mut AnyBlob> {
        match self {
            HTTPRequestBody::AnyBlob(blob) => Some(blob),
            _ => None,
        }
    }

    pub(crate) fn has_body(&mut self) -> bool {
        match self {
            HTTPRequestBody::AnyBlob(blob) => blob.size() > 0,
            HTTPRequestBody::ReadableStream(stream) => stream.has(),
            HTTPRequestBody::Sendfile(_) => true,
        }
    }
}

impl Drop for FetchTasklet {
    fn drop(&mut self) {
        bun_output::scoped_log!(FetchTasklet, "deinit");
        self.ref_count.assert_no_refs();
        // JS thread: no longer something the VM must abort at teardown.
        crate::jsc_hooks::ActiveHandle::Fetch(NonNull::from(&mut *self)).unregister();
        self.clear_data();
    }
}

impl FetchTasklet {
    const HOLDS_TICKET: &str = "fetch on the HTTP thread holds a ticket";

    // ───── raw-ptr field accessors (centralised unsafe) ───────────────────
    //
    // `signal` / `sink` / `native_response` are intrusive-refcounted heap
    // objects that this tasklet holds one strong ref on while the field is
    // `Some`. They are never reborrowed through any other path on the JS
    // thread, so a single `&` / `&mut` derived here is the sole live borrow.

    /// Recover `&mut Self` from a type-erased `*mut c_void` callback context.
    ///
    /// INVARIANT: every callback that stores a `FetchTasklet*` as `ctx` (the
    /// readable-stream available/start-streaming hooks and the ByteStream
    /// cancel handler) holds one strong ref on the tasklet for the lifetime
    /// of the registration, and fires only on the JS thread — so the returned
    /// `&mut` is the sole live borrow.
    #[inline]
    fn from_ctx<'a>(ctx: NonNull<c_void>) -> &'a mut Self {
        // SAFETY: see INVARIANT above.
        unsafe { bun_ptr::callback_ctx::<FetchTasklet>(ctx.as_ptr()) }
    }

    /// Recover `&mut Self` from a `*mut FetchTasklet` callback arg.
    ///
    /// INVARIANT: every `*mut FetchTasklet` threaded through the HTTP-thread
    /// callback (`callback`), the drain hook (`on_write_request_data_drain` /
    /// `resume_request_data_stream`), and the JS-thread enqueue
    /// (`queue` → `node`) was produced by `heap::into_raw(Box<FetchTasklet>)`
    /// in `get()` and is kept alive by the intrusive `ref_count` until
    /// `deinit`. Access on either thread is serialised: HTTP-thread writes
    /// happen under `mutex.lock()` and JS-thread access is single-threaded.
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

    /// `Some(&AbortSignal)` while we hold a strong ref on the C++-owned
    /// `WebCore::AbortSignal*` (taken in `queue`, released in
    /// `clear_abort_signal`).
    #[inline]
    fn abort_signal(&self) -> Option<&AbortSignal> {
        self.signal.as_deref()
    }

    /// True iff an attached AbortSignal has fired.
    #[inline]
    pub(crate) fn signal_aborted(&self) -> bool {
        self.abort_signal().is_some_and(|s| s.aborted())
    }

    /// Mutable access to the request-body sink while `self.sink` is `Some`
    /// (owned allocation from `start_request_stream` until `clear_sink`).
    #[inline]
    pub(crate) fn sink_mut(&mut self) -> Option<&mut FetchRequestBodySink> {
        // SAFETY: see block comment above. JS-thread-only.
        self.sink.map(|p| unsafe { &mut *p.as_ptr() })
    }

    /// Mutable access to the request-body streaming buffer while `Some` (this
    /// side holds one of the two initial intrusive refs from
    /// `ThreadSafeStreamBuffer::new`; released in `clear_sink`). Detached
    /// lifetime so the borrow does not conflict with disjoint `&mut self`
    /// access at call sites — the buffer lives in a separate heap allocation
    /// shared with the HTTP thread (mutex-guarded internally).
    #[inline]
    pub(crate) fn stream_buffer_mut<'r>(&self) -> Option<&'r mut ThreadSafeStreamBuffer> {
        // SAFETY: see doc comment: the counted ref keeps the pointee live, and the
        // mutex inside `ThreadSafeStreamBuffer` serialises every cross-thread
        // access (`buffer` and the drain callback alike).
        self.request_body_streaming_buffer
            .as_ref()
            .map(|p| unsafe { &mut *p.as_ptr() })
    }

    fn ref_(&self) {
        // SAFETY: `self` is live; `ref_` only touches the interior-mutable
        // atomic counter.
        unsafe { bun_ptr::ThreadSafeRefCount::<Self>::ref_(core::ptr::from_ref(self).cast_mut()) };
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
    fn deref_from_thread(this: *mut FetchTasklet, ticket: &jsc::Ticket) {
        // SAFETY: caller contract.
        if !unsafe { bun_ptr::ThreadSafeRefCount::<Self>::release(this) } {
            return;
        }
        // Last ref dropped on the HTTP thread: deinit must run on the JS thread
        // (it drops JSC Strong/Weak handles), so hop there — as a task with its
        // own tag, so a VM that is tearing down releases it from its queue.
        ticket.post(ConcurrentTask::create(bun_event_loop::Task::init(
            this.cast::<FetchTaskletDeinitHop>(),
        )));
    }

    /// HTTP thread, final callback: the fetch is back. Move the ticket out
    /// (nothing here touches the tasklet after the ref drop) and drop this
    /// thread's ref through it.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    fn hand_back(this: *mut FetchTasklet) {
        // SAFETY: caller contract; the field is HTTP-thread-only.
        let ticket = unsafe { (*this).http_ticket.take() }.expect(Self::HOLDS_TICKET);
        Self::deref_from_thread(this, &ticket);
    }

    fn clear_sink(&mut self) {
        if let Some(sink_ptr) = self.sink.take() {
            // SAFETY: FetchTasklet owns the heap allocation from
            // `start_request_stream`; the JS controller's back-pointer is
            // cleared via `detach` below before drop; sole owner.
            let mut sink = unsafe { bun_core::heap::take(sink_ptr.as_ptr()) };
            // Prevent the sink's `finalize()` / `Drop` from double-releasing the
            // FetchTasklet ref — `write_end_request` is the canonical release.
            sink.task = None;
            // `detach` may fire the controller's onClose; every terminal path
            // here has already cleared it, so this just nulls m_sinkPtr.
            JSSink::<FetchRequestBodySink>::detach(&mut sink.source, &self.global_this);
        }
        if let Some(buffer) = self.request_body_streaming_buffer.take() {
            // The HTTP thread may still be using its ref; `clear_drain_callback`
            // synchronises with it through the buffer's mutex.
            // SAFETY: kept live by `buffer`.
            unsafe { (*buffer.as_ptr()).clear_drain_callback() };
        }
    }

    fn clear_data(&mut self) {
        bun_output::scoped_log!(FetchTasklet, "clearData ");
        // `http.client` borrows `url_proxy_buffer` / `unix_socket_path` / `request_headers`.
        self.http = None;
        if !self.url_proxy_buffer.is_empty() {
            self.url_proxy_buffer = Box::default();
        }

        self.unix_socket_path = Box::default();

        if let Some(certificate) = self.result.certificate_info.take() {
            drop(certificate);
        }

        // Drop on assignment runs the cleanup. MultiArrayList has no `clear()`.
        self.request_headers = Headers::default();

        if let Some(metadata) = self.metadata.take() {
            drop(metadata);
        }

        self.response.clear();
        self.native_response.set(None);

        self.clear_stream_handlers();

        self.scheduled_response_buffer = MutableString::default();
        // Always detach request_body regardless of type.
        // When request_body is a ReadableStream, startRequestStream() hands
        // the stream off to `assign_to_stream`, so FetchTasklet's reference
        // becomes redundant and must be released to avoid leaks.
        self.request_body.detach();

        self.abort_reason.deinit();
        self.check_server_identity.deinit();
        self.clear_abort_signal();
        // Clear the sink only after the requested ended otherwise we would potentialy lose the last chunk
        self.clear_sink();
    }

    /// VM teardown's stop phase (JS thread): abort the transport. The HTTP
    /// thread then fails the request promptly — started or still queued — and
    /// hands the tasklet back through its final callback, which teardown
    /// waits for before the handle closes.
    ///
    /// # Safety
    /// `this` is live (registered ⇒ not yet deinit'd); JS thread.
    pub(crate) unsafe fn stop_for_vm_teardown(this: *mut FetchTasklet) {
        // SAFETY: fn contract.
        unsafe { (*this).abort_task() };
    }

    /// `HTTPClientResultCallback::release_at_shutdown` for `FetchTasklet`.
    /// Called from `dealloc_in_flight_for_exit` on the HTTP thread for each
    /// request still in `in_flight` when `process.exit()` interrupts it.
    /// `queue()` left two refs (initial +1 and `node_ref.ref_()`); the final
    /// `callback`'s deref and `on_progress_update`'s JS-side deref will never
    /// run, so this must balance both — but only when no `on_progress_update`
    /// is already parked in the parent's concurrent queue.
    ///
    /// The `has_schedule_callback` flag distinguishes the two states:
    ///   * `false` — nothing queued. Drop both refs here; the last one hops
    ///     `deinit` to the JS thread, which teardown runs from its queue release.
    ///   * `true` — a non-final `on_progress_update` is queued (this entry is
    ///     still in `in_flight`, so the *final* `callback` hasn't run). That
    ///     queued node owns the JS-side ref and its VM releases it from its
    ///     queue; dropping it here too would leave the queued node pointing at
    ///     a freed `FetchTasklet`. Drop only the HTTP-side ref.
    ///
    /// Only reachable for a request whose VM has *not* torn down (a worker
    /// still running when the main thread exits): a VM's teardown waits for its
    /// fetches' tickets — i.e. for their final callback — before the exiting
    /// main thread parks the HTTP thread. `has_schedule_callback` is written by
    /// the HTTP-thread `callback` and the JS-thread `on_progress_update` under
    /// its own compare-exchange discipline, which this load relies on.
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
        // SAFETY: caller contract — `this` is live and HTTP-thread-exclusive.
        let ticket = unsafe {
            (*this).scheduled_response_buffer = MutableString::default();
            (*this).http_ticket.take()
        }
        .expect(Self::HOLDS_TICKET);
        FetchTasklet::deref_from_thread(this, &ticket);
        if !queued_progress_update {
            FetchTasklet::deref_from_thread(this, &ticket);
        }
        // The HTTP thread is done with this fetch.
        drop(ticket);
    }

    fn get_current_response(&self) -> Option<*mut Response> {
        // we need a body to resolve the promise when buffering
        if let Some(response) = self.native_response.get().as_ref() {
            return Some(response.as_ptr());
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

    fn start_request_stream(&mut self) -> JsResult<()> {
        self.is_waiting_request_stream_start = false;
        debug_assert!(matches!(
            self.request_body,
            HTTPRequestBody::ReadableStream(_)
        ));
        let HTTPRequestBody::ReadableStream(ref stream_ref) = self.request_body else {
            return Ok(());
        };
        let Some(stream) = stream_ref.get() else {
            return Ok(());
        };
        if self.signal_aborted() {
            return stream.abort(&self.global_this);
        }

        let global_this = self.global_this;
        // +1 on the tasklet; balanced exactly once by `write_end_request` on the
        // assign_to_stream-result side (on_resolve/on_reject or the synchronous
        // Fulfilled/Rejected/undefined branches below), or by the sink's
        // `finalize` as a fallback if that path never runs.
        self.ref_();

        if stream.is_locked(&global_this) || stream.is_disturbed(&global_this) {
            let err = jsc::SystemError {
                code: BunString::static_(<&'static str>::from(
                    jsc::ErrorCode::ERR_STREAM_CANNOT_PIPE,
                )),
                message: BunString::static_("Stream already used, please create a new one"),
                ..Default::default()
            };
            let err_instance = err.to_error_instance(&global_this);
            err_instance.ensure_still_alive();
            self.write_end_request(Some(err_instance));
            return Ok(());
        }

        let self_ptr = std::ptr::from_mut::<FetchTasklet>(self);
        // `self_ptr` is the live heap tasklet; the +1 above keeps it alive
        // until `write_end_request`/`finalize` clears `task`.
        let sink: &mut FetchRequestBodySink = Box::leak(Box::new(FetchRequestBodySink {
            task: Some(bun_ptr::BackRef::new_mut(self)),
            high_water_mark: 16384,
            ..Default::default()
        }));
        let sink_handle = SinkHandle::FetchRequestBody(bun_ptr::BackRef::new_mut(sink));
        self.sink = Some(core::ptr::NonNull::from(&mut *sink));

        // Native ByteStream/FileReader fast-path: wire the SinkHandle
        // directly, skipping the JS pump.
        match stream.wire_native_sink(&global_this, sink_handle, JSValue::UNDEFINED, |src| {
            sink.source = src;
        }) {
            crate::webcore::readable_stream::NativeWireResult::Wired => return Ok(()),
            crate::webcore::readable_stream::NativeWireResult::EndedInline(err) => {
                // The source finished inside the wire attempt, so leave the
                // sink in the state `end_from_stream` leaves it: ended, with
                // the source and task detached. `write_end_request` below is
                // the single balancing release of the `+1` taken above; a
                // sink left `ended == false` here would make the terminal
                // `cancel_request_body_sink` treat it as a live native sink
                // and release that ref a second time, freeing the tasklet
                // while it is still in use.
                sink.ended = true;
                sink.source.clear();
                sink.task = None;
                let err_js = err.map(|err| {
                    let err_js = err.to_js(&global_this);
                    err_js.ensure_still_alive();
                    err_js
                });
                self.write_end_request(err_js);
                return Ok(());
            }
            crate::webcore::readable_stream::NativeWireResult::NotNative => {}
        }

        let assignment_result = JSSink::<FetchRequestBodySink>::assign_to_stream(
            &global_this,
            stream.value,
            core::ptr::NonNull::from(&mut *sink),
        );
        assignment_result.ensure_still_alive();

        if let Some(err) = assignment_result.to_error() {
            self.write_end_request(Some(err));
            self.clear_sink();
            return Ok(());
        }

        if !assignment_result.is_empty_or_undefined_or_null() {
            if let Some(promise) = assignment_result.as_any_promise() {
                match promise.status() {
                    bun_jsc::js_promise::Status::Pending => {
                        assignment_result.then(
                            &global_this,
                            self_ptr,
                            on_resolve_request_stream_shim,
                            on_reject_request_stream_shim,
                        );
                    }
                    bun_jsc::js_promise::Status::Fulfilled => {
                        sink.task = None;
                        self.write_end_request(None);
                    }
                    bun_jsc::js_promise::Status::Rejected => {
                        promise.set_handled(global_this.vm());
                        let result = promise.result(global_this.vm());
                        sink.task = None;
                        self.write_end_request(Some(result));
                    }
                }
                return Ok(());
            }
        }

        // undefined/null: the stream drained synchronously inside
        // assignToStream. `end()` no longer calls `write_end_request`, so this
        // path always balances the `+1` itself.
        sink.task = None;
        self.write_end_request(None);
        Ok(())
    }

    fn on_body_received(&mut self) -> JsResult<()> {
        let success = self.result.is_success();
        let global_this = self.global_this;
        // reset the buffer if we are streaming or if we are not waiting for bufferig anymore
        let buffer_reset = core::cell::Cell::new(true);
        bun_output::scoped_log!(
            FetchTasklet,
            "onBodyReceived success={} has_more={}",
            success,
            self.result.has_more
        );
        // The reset must run on `?` failure paths too.
        // Capture a raw ptr so the defer can reset on every exit (incl. `?`) without holding a
        // long-lived &mut borrow of self.
        let scheduled_buf: *mut MutableString = &raw mut self.scheduled_response_buffer;
        scopeguard::defer! {
            if buffer_reset.get() {
                // SAFETY: `self` outlives this defer (it's a local in this fn) and no other
                // borrow of scheduled_response_buffer is live at scope exit / `?` unwind.
                let list = unsafe { &mut (*scheduled_buf).list };
                if list.capacity() > http::DECODED_BODY_RETAIN_CAP {
                    *list = Vec::new();
                } else {
                    list.clear();
                }
            }
        }

        if !success {
            // `ValueError`
            // has no `Drop` (it's reset-in-place, see Body.rs), so the Strong installed by
            // `to_js` would leak on the sink-cancel / no-response / `?` exits. Hold it in a
            // scopeguard and defuse via `into_inner` when ownership is transferred to
            // `to_error_instance`.
            let mut err = scopeguard::guard(self.on_reject(), |mut e| e.reset());
            let mut js_err = JSValue::ZERO;
            // if we are streaming update with error
            if let Some(bytes) = self.response_stream.take() {
                js_err = err.to_js(&global_this);
                js_err.ensure_still_alive();
                bytes.on_data(StreamResult::Err(StreamError::JSValue(
                    bun_jsc::strong::Optional::create(js_err, &global_this),
                )));
            }
            // A failure result is terminal (`to_result` forces `has_more =
            // false` once `fail` is set), so everything pending must settle
            // here: a still-streaming request-body sink does not exempt the
            // response body. Returning right after `sink.cancel()` used to
            // leave a buffered `arrayBuffer()`/`text()` promise pending
            // forever when a fetch with an in-flight streaming request body
            // was aborted mid-response.
            if self.sink_mut().is_some() && js_err.is_empty() {
                js_err = err.to_js(&global_this);
                js_err.ensure_still_alive();
            }
            // if we are buffering resolve the promise
            if let Some(response) = self.current_response_mut() {
                // body value now owns the error
                let err = scopeguard::ScopeGuard::into_inner(err);
                let body = response.get_body_value();
                body.to_error_instance(err, &global_this)?;
            }
            // Cancel the request-body sink last: closing the sink signal fires
            // the controller's onClose synchronously, which can re-enter the
            // tasklet.
            if !js_err.is_empty() {
                self.cancel_request_body_sink(js_err);
            }
            return Ok(());
        }

        // body can be marked as used but we still need to pipe the data
        if !self.result.has_more {
            // Unhook before the final delivery so it cannot signal a producer that is done;
            // release after it so the bytes land in memory we still pin.
            if let Some(bytes) = self.response_stream.take() {
                bun_output::scoped_log!(FetchTasklet, "onBodyReceived response_stream done");
                bytes.size_hint.set(self.get_size_hint());
                buffer_reset.set(false);
                let chunk = self.scheduled_response_buffer.list.as_slice();
                bytes.on_data(Self::temporary_chunk(chunk, true));
                return Ok(());
            }
        } else if let Some(bytes) = self.response_stream.bytes() {
            bun_output::scoped_log!(FetchTasklet, "onBodyReceived response_stream");
            bytes.size_hint.set(self.get_size_hint());
            let chunk = self.scheduled_response_buffer.list.as_slice();
            bytes.on_data(Self::temporary_chunk(chunk, false));
            if self.response_stream.is_held() {
                self.after_body_chunk_delivered(&bytes);
            }
            return Ok(());
        }

        if let Some(response) = self.current_response_mut() {
            bun_output::scoped_log!(FetchTasklet, "onBodyReceived Current Response");
            let size_hint = self.get_size_hint();
            response.set_size_hint(size_hint);
            if let Some(readable) = response.get_body_readable_stream() {
                bun_output::scoped_log!(
                    FetchTasklet,
                    "onBodyReceived CurrentResponse BodyReadableStream"
                );
                if let Some(bytes) = readable.ptr.bytes() {
                    let chunk = self.scheduled_response_buffer.list.as_slice();

                    if self.result.has_more {
                        bytes.on_data(Self::temporary_chunk(chunk, false));
                    } else {
                        readable.value.ensure_still_alive();
                        response.detach_readable_stream(&global_this);
                        bytes.on_data(Self::temporary_chunk(chunk, true));
                    }

                    return Ok(());
                }
            }

            // raw ptr: `body` and `get_fetch_headers()` are disjoint fields but borrowck can't see through the accessors.
            let body: *mut BodyValue = response.get_body_value();
            // `BodyAbortListener::on_abort` may have set `Error` while this
            // callback was queued; checked before `buffer_reset.set(false)` so
            // the defer still drops the bytes.
            // SAFETY: just obtained from live `response`.
            if !matches!(unsafe { &*body }, BodyValue::Locked(_)) {
                return Ok(());
            }
            // we will reach here when not streaming, this is also the only case we dont wanna to reset the buffer
            buffer_reset.set(false);
            if !self.result.has_more {
                let scheduled_response_buffer =
                    core::mem::take(&mut self.scheduled_response_buffer.list);
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

                self.scheduled_response_buffer = MutableString::default();

                if matches!(old, BodyValue::Locked(_)) {
                    bun_output::scoped_log!(FetchTasklet, "onBodyReceived old.resolve");
                    let mut old = old;
                    // BodyValue::resolve takes `Option<NonNull<FetchHeaders>>` (opaque C++ handle
                    // mutated via FFI); the inherent `get_fetch_headers` returns `Option<&_>`, so
                    // erase the borrow into a raw NonNull. Disjoint from `body` (response.init vs
                    // response.body) and outlives this block.
                    let headers = response.get_fetch_headers().map(core::ptr::NonNull::from);
                    // SAFETY: `body` points into `response.body`, disjoint from `headers`
                    // (response.init); both live for this block.
                    let body = unsafe { &mut *body };
                    BodyValue::resolve(&mut old, body, &self.global_this, headers)?;
                }
            }
        }
        Ok(())
    }

    pub(crate) fn on_progress_update(&mut self) -> JsResult<()> {
        jsc::mark_binding!();
        bun_output::scoped_log!(FetchTasklet, "onProgressUpdate");
        self.mutex.lock();
        self.has_schedule_callback.store(false, Ordering::Relaxed);
        let is_done = !self.result.has_more;

        let vm = self.global_this.bun_vm();
        // teardown forbade script: we cannot touch JS
        if !vm.script_allowed() {
            // The certificate will never be checked; release the parked
            // HTTP-thread socket instead of leaving it occupying an active
            // request slot until the idle timeout.
            if self.result.certificate_info.take().is_some() {
                if let Some(http_) = self.http.as_mut() {
                    http::http_thread().schedule_shutdown(http_);
                }
            }
            self.mutex.unlock();
            if is_done {
                // SAFETY: `self` is the live heap tasklet; we hold a ref.
                FetchTasklet::deref(std::ptr::from_mut(self));
            }
            return Ok(());
        }

        let global_this = self.global_this;
        // explicit cleanup at each return (a closure keeps borrowck happy)
        let cleanup = |this: &mut FetchTasklet| {
            this.mutex.unlock();
            // if we are not done we wait until the next call
            if is_done {
                // The HTTP response has been fully received. If the request body
                // is still being uploaded, the HTTP layer will never drain/resume
                // it again — cancel the sink so the JS side releases the reader;
                // the pump-promise settlement drops the `startRequestStream` ref.
                this.cancel_request_body_sink(JSValue::UNDEFINED);
                this.poll_ref
                    .with_mut(|poll_ref| poll_ref.unref(bun_io::js_vm_ctx()));
                // SAFETY: `this` is the live heap tasklet; we hold a ref.
                FetchTasklet::deref(std::ptr::from_mut(this));
            }
        };

        if self.is_waiting_request_stream_start && self.result.can_stream {
            // start streaming
            if let Err(err) = self.start_request_stream() {
                // The VM is being stopped: leave like the `!script_allowed()` gate above does.
                self.mutex.unlock();
                if is_done {
                    // SAFETY: `self` is the live heap tasklet; we hold a ref.
                    FetchTasklet::deref(std::ptr::from_mut(self));
                }
                return Err(err);
            }
            // Makes wpt-h2 number-chunk test deterministic.
            // `assign_to_stream` kicks off `await reader.read()`; an invalid
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
            if self.metadata.is_some() && !self.is_waiting_body {
                vm.jsc_vm().drain_microtasks();
            }
        }
        // if we already respond the metadata and still need to process the body
        if self.is_waiting_body {
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
            if self.scheduled_response_buffer.list.is_empty()
                && self.result.has_more
                && self.result.is_success()
            {
                cleanup(self);
                return Ok(());
            }
            let r = self.on_body_received();
            cleanup(self);
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
        if let Some(certificate_info) = self.result.certificate_info.take() {
            // we receive some error
            if self.reject_unauthorized && !self.check_server_identity(&certificate_info) {
                bun_output::scoped_log!(FetchTasklet, "onProgressUpdate: aborted due certError");
                drop(certificate_info);
                // `check_server_identity` already set abort_reason / aborted /
                // result.fail and scheduled the shutdown of the parked
                // socket; all that is left is rejecting the promise.
                let promise_value = self.promise.value_or_empty();
                if promise_value.is_empty_or_undefined_or_null() {
                    bun_output::scoped_log!(
                        FetchTasklet,
                        "onProgressUpdate: promise_value is null"
                    );
                    self.promise = jsc::JSPromiseStrong::empty();
                    cleanup(self);
                    return Ok(());
                }
                // we need to abort the request
                let promise = promise_value.as_any_promise().unwrap();
                let tracker = self.tracker;
                let mut result = self.on_reject();

                promise_value.ensure_still_alive();
                let r = promise.reject_with_async_stack(&global_this, result.to_js(&global_this));
                result.reset();

                tracker.did_dispatch(&global_this);
                self.promise = jsc::JSPromiseStrong::empty();
                cleanup(self);
                return r;
            }
            drop(certificate_info);
            // checkServerIdentity passed: un-park the HTTP-thread connection
            // so the request is finally written to the now-verified peer. If
            // the connection already closed/failed the resume is a no-op
            // (keyed through the abort tracker).
            if let Some(http_) = self.http.as_mut() {
                http::http_thread().schedule_cert_check_resume(http_);
            }
            // Fall through. The common case (certificate-only update) returns
            // at the metadata-less early return below; the #27275 coalesced
            // case — the connection failed after the handshake but before
            // response headers arrived, so the certificate_info from the
            // first progress update was merged into the later failure result
            // — falls through to the reject logic with `result.fail` set.
        }

        if self.metadata.is_none() && self.result.is_success() {
            cleanup(self);
            return Ok(());
        }

        // if we abort because of cert error
        // we wait the Http Client because we already have the response
        // we just need to deinit
        if self.is_waiting_abort {
            cleanup(self);
            return Ok(());
        }
        let promise_value = self.promise.value_or_empty();

        if promise_value.is_empty_or_undefined_or_null() {
            bun_output::scoped_log!(FetchTasklet, "onProgressUpdate: promise_value is null");
            self.promise = jsc::JSPromiseStrong::empty();
            cleanup(self);
            return Ok(());
        }

        // WHATWG fetch: once the response head is available the promise
        // resolves; post-head failures (body decompression etc.) surface on
        // the body reader regardless of whether head+body arrived in one read.
        let success = self.result.is_success() || self.metadata.is_some();

        // Paired with the microtask drain after
        // startRequestStream above: the request-body sink may have set `abort_reason`
        // via writeEndRequest while the HTTP result is still a success — server HEADERS
        // raced ahead of the scheduled shutdown. Reject with that reason instead of
        // resolving a 200 Response. Makes wpt-h2 number-chunk test deterministic.
        if success && self.abort_reason.has() {
            let promise = promise_value.as_any_promise().unwrap();
            let tracker = self.tracker;
            // get_abort_error consumes abort_reason and clears the signal handler.
            let mut err = self.get_abort_error().unwrap();
            promise_value.ensure_still_alive();
            let r = promise.reject_with_async_stack(&global_this, err.to_js(&global_this));
            err.reset();
            tracker.did_dispatch(&global_this);
            self.promise = jsc::JSPromiseStrong::empty();
            cleanup(self);
            return r;
        }

        let tracker = self.tracker;
        tracker.will_dispatch(&global_this);
        let dispatch_cleanup = |_this: &mut FetchTasklet| {
            bun_output::scoped_log!(FetchTasklet, "onProgressUpdate: promise_value is not null");
            tracker.did_dispatch(&global_this);
        };

        let result = if success {
            let resolved = self.on_resolve();
            // Cancel the request-body sink last (as on_body_received does):
            // closing the sink signal runs the user's cancel callback
            // synchronously, so the body error must already be stored.
            if self.result.fail.is_some() && self.sink_mut().is_some() {
                let mut err = self.on_reject();
                let err_js = err.to_js(&global_this);
                err_js.ensure_still_alive();
                self.cancel_request_body_sink(err_js);
                err.reset();
            }
            StrongOptional::create(resolved, &global_this)
        } else {
            // in this case we wanna a jsc.Strong.Optional so we just convert it
            let mut value = self.on_reject();
            let err_js = value.to_js(&global_this);
            self.cancel_request_body_sink(err_js);
            // `to_js` leaves `value` in the `JSValue(Strong)` state (Body.rs:547). Move
            // that Strong out instead of allocating a
            // second one — `ValueError` has no `Drop`, so the inner Strong would leak.
            let BodyValueError::JSValue(strong) = value else {
                unreachable!("ValueError::to_js leaves self in JSValue state");
            };
            strong
        };

        promise_value.ensure_still_alive();

        let holder = Box::new(FetchTaskletPromiseSettle {
            held: result,
            // we need the promise to be alive until the task is done
            promise: self.promise.take(),
            global_object: global_this,
            success,
        });
        // SAFETY: `vm.event_loop()` is the live JS-thread loop.
        unsafe {
            (*vm.event_loop()).enqueue_task(Task::from_boxed(holder));
        }

        dispatch_cleanup(self);
        cleanup(self);
        Ok(())
    }

    fn check_server_identity(&mut self, certificate_info: &CertificateInfo) -> bool {
        if let Some(check_server_identity) = self.check_server_identity.get() {
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
                    let global_object = self.global_this;
                    // SAFETY: `x` is the non-null `X509*` returned by `d2i_X509` above; this
                    // guard is its sole owner and frees it exactly once on scope exit.
                    let _x509_guard = scopeguard::guard(x509, |x| unsafe { X509_free(x) });
                    // SAFETY: x509 is non-null, freshly parsed; freed by guard above.
                    let js_cert = match X509::to_js(unsafe { &mut *x509 }, &global_object) {
                        Ok(v) => v,
                        Err(e) => {
                            let check_result = global_object.take_exception(e);
                            // mark to wait until deinit
                            self.is_waiting_abort = self.result.has_more;
                            self.abort_reason.set(&global_object, check_result);
                            self.abort_task();
                            self.result.fail = Some(http::Error::ERR_TLS_CERT_ALTNAME_INVALID);
                            return false;
                        }
                    };
                    let js_hostname: JSValue = match bun_string_jsc::create_utf8_for_js(
                        &global_object,
                        &certificate_info.hostname,
                    ) {
                        Ok(v) => v,
                        Err(e) => {
                            let hostname_err_result = global_object.take_exception(e);
                            self.is_waiting_abort = self.result.has_more;
                            self.abort_reason.set(&global_object, hostname_err_result);
                            self.abort_task();
                            self.result.fail = Some(http::Error::ERR_TLS_CERT_ALTNAME_INVALID);
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
                        self.is_waiting_abort = self.result.has_more;
                        self.abort_reason.set(&global_object, check_result);
                        self.abort_task();
                        self.result.fail = Some(http::Error::ERR_TLS_CERT_ALTNAME_INVALID);
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
        if let Some(http_) = self.http.as_mut() {
            http::http_thread().schedule_shutdown(http_);
        }
        self.result.fail = Some(http::Error::ERR_TLS_CERT_ALTNAME_INVALID);
        false
    }

    fn get_abort_error(&mut self) -> Option<BodyValueError> {
        if self.abort_reason.has() {
            let out = core::mem::replace(&mut self.abort_reason, StrongOptional::empty());
            self.clear_abort_signal();
            return Some(BodyValueError::JSValue(out));
        }

        if let Some(signal) = self.abort_signal() {
            if let Some(reason) = signal.reason_if_aborted(&self.global_this) {
                // `AbortReason::to_body_value_error` lives in bun_jsc but
                // would forward-depend on bun_runtime; reconstruct the trivial
                // mapping at the call site (per AbortSignal.rs note).
                let out = match reason {
                    jsc::abort_signal::AbortReason::Common(r) => BodyValueError::AbortReason(r),
                    jsc::abort_signal::AbortReason::Js(v) => {
                        BodyValueError::JSValue(StrongOptional::create(v, &self.global_this))
                    }
                };
                self.clear_abort_signal();
                return Some(out);
            }
        }

        None
    }

    fn clear_abort_signal(&mut self) {
        let Some(signal) = self.signal.take() else {
            return;
        };
        // Order matters: cleanNativeBindings first, then pending_activity_unref
        // and (dropping `signal`) unref.
        signal.clean_native_bindings(std::ptr::from_mut(self).cast::<c_void>());
        signal.pending_activity_unref();
    }

    fn on_reject(&mut self) -> BodyValueError {
        debug_assert!(self.result.fail.is_some());
        bun_output::scoped_log!(FetchTasklet, "onReject");

        if let Some(err) = self.get_abort_error() {
            return err;
        }

        if let Some(reason) = self.result.abort_reason() {
            return BodyValueError::AbortReason(reason);
        }

        let fail = self.result.fail.unwrap();

        if fail == http::Error::RequestBodyNotReusable {
            return BodyValueError::TypeError(BunString::static_(
                "Request body is a ReadableStream and cannot be replayed for this redirect",
            ));
        }

        // some times we don't have metadata so we also check http.url
        let path = if let Some(metadata) = &self.metadata {
            BunString::clone_utf8(metadata.url.slice())
        } else if let Some(http_) = &self.http {
            BunString::clone_utf8(http_.url.href)
        } else {
            BunString::EMPTY
        };

        // The hostname never resolved: report the resolver error (`ENOTFOUND`,
        // ...) with `syscall`/`hostname`, the same shape `node:dns` produces,
        // rather than a generic connect-failure message. `dns_error` is the
        // raw getaddrinfo(3) code and is nonzero on this path, so `init_eai`
        // is always `Some`.
        if fail == http::Error::DNSResolveFailed {
            if let Some(dns_err) = c_ares::Error::init_eai(self.result.dns_error) {
                // `dns_hostname` is the owned copy of the exact name the
                // connect resolved (proxy or post-redirect target), captured
                // on the HTTP thread; never reconstruct it from `self.http`,
                // whose post-redirect URL slices are freed by then.
                let hostname: &[u8] = self.result.dns_hostname.as_deref().unwrap_or(b"");
                let mut err = crate::dns_jsc::cares_jsc::system_error_with_syscall_and_hostname(
                    dns_err,
                    b"getaddrinfo",
                    hostname,
                );
                err.path = path;
                return BodyValueError::SystemTypeError(err);
            }
        }

        let code = if fail == http::Error::ConnectionClosed {
            BunString::static_("ECONNRESET")
        } else {
            BunString::static_(fail.name())
        };

        let message = match fail {
            http::Error::ConnectionClosed => BunString::static_(
                "The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()",
            ),
            http::Error::FailedToOpenSocket => {
                BunString::static_("Was there a typo in the url or port?")
            }
            http::Error::TooManyRedirects => BunString::static_(
                "The response redirected too many times. For more information, pass `verbose: true` in the second argument to fetch()",
            ),
            http::Error::ConnectionRefused => {
                BunString::static_("Unable to connect. Is the computer able to access the url?")
            }
            http::Error::RedirectURLInvalid => {
                BunString::static_("Redirect URL in Location header is invalid.")
            }

            http::Error::Cert(http::CertError::UNABLE_TO_GET_ISSUER_CERT) => {
                BunString::static_("unable to get issuer certificate")
            }
            http::Error::Cert(http::CertError::UNABLE_TO_GET_CRL) => {
                BunString::static_("unable to get certificate CRL")
            }
            http::Error::Cert(http::CertError::UNABLE_TO_DECRYPT_CERT_SIGNATURE) => {
                BunString::static_("unable to decrypt certificate's signature")
            }
            http::Error::Cert(http::CertError::UNABLE_TO_DECRYPT_CRL_SIGNATURE) => {
                BunString::static_("unable to decrypt CRL's signature")
            }
            http::Error::Cert(http::CertError::UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY) => {
                BunString::static_("unable to decode issuer public key")
            }
            http::Error::Cert(http::CertError::CERT_SIGNATURE_FAILURE) => {
                BunString::static_("certificate signature failure")
            }
            http::Error::Cert(http::CertError::CRL_SIGNATURE_FAILURE) => {
                BunString::static_("CRL signature failure")
            }
            http::Error::Cert(http::CertError::CERT_NOT_YET_VALID) => {
                BunString::static_("certificate is not yet valid")
            }
            http::Error::Cert(http::CertError::CRL_NOT_YET_VALID) => {
                BunString::static_("CRL is not yet valid")
            }
            http::Error::Cert(http::CertError::CERT_HAS_EXPIRED) => {
                BunString::static_("certificate has expired")
            }
            http::Error::Cert(http::CertError::CRL_HAS_EXPIRED) => {
                BunString::static_("CRL has expired")
            }
            http::Error::Cert(http::CertError::ERROR_IN_CERT_NOT_BEFORE_FIELD) => {
                BunString::static_("format error in certificate's notBefore field")
            }
            http::Error::Cert(http::CertError::ERROR_IN_CERT_NOT_AFTER_FIELD) => {
                BunString::static_("format error in certificate's notAfter field")
            }
            http::Error::Cert(http::CertError::ERROR_IN_CRL_LAST_UPDATE_FIELD) => {
                BunString::static_("format error in CRL's lastUpdate field")
            }
            http::Error::Cert(http::CertError::ERROR_IN_CRL_NEXT_UPDATE_FIELD) => {
                BunString::static_("format error in CRL's nextUpdate field")
            }
            http::Error::Cert(http::CertError::OUT_OF_MEM) => BunString::static_("out of memory"),
            http::Error::Cert(http::CertError::DEPTH_ZERO_SELF_SIGNED_CERT) => {
                BunString::static_("self signed certificate")
            }
            http::Error::Cert(http::CertError::SELF_SIGNED_CERT_IN_CHAIN) => {
                BunString::static_("self signed certificate in certificate chain")
            }
            http::Error::Cert(http::CertError::UNABLE_TO_GET_ISSUER_CERT_LOCALLY) => {
                BunString::static_("unable to get local issuer certificate")
            }
            http::Error::Cert(http::CertError::UNABLE_TO_VERIFY_LEAF_SIGNATURE) => {
                BunString::static_("unable to verify the first certificate")
            }
            http::Error::Cert(http::CertError::CERT_CHAIN_TOO_LONG) => {
                BunString::static_("certificate chain too long")
            }
            http::Error::Cert(http::CertError::CERT_REVOKED) => {
                BunString::static_("certificate revoked")
            }
            http::Error::Cert(http::CertError::INVALID_CA) => {
                BunString::static_("invalid CA certificate")
            }
            http::Error::Cert(http::CertError::INVALID_NON_CA) => {
                BunString::static_("invalid non-CA certificate (has CA markings)")
            }
            http::Error::Cert(http::CertError::PATH_LENGTH_EXCEEDED) => {
                BunString::static_("path length constraint exceeded")
            }
            http::Error::Cert(http::CertError::PROXY_PATH_LENGTH_EXCEEDED) => {
                BunString::static_("proxy path length constraint exceeded")
            }
            http::Error::Cert(http::CertError::PROXY_CERTIFICATES_NOT_ALLOWED) => {
                BunString::static_(
                    "proxy certificates not allowed, please set the appropriate flag",
                )
            }
            http::Error::Cert(http::CertError::INVALID_PURPOSE) => {
                BunString::static_("unsupported certificate purpose")
            }
            http::Error::Cert(http::CertError::CERT_UNTRUSTED) => {
                BunString::static_("certificate not trusted")
            }
            http::Error::Cert(http::CertError::CERT_REJECTED) => {
                BunString::static_("certificate rejected")
            }
            http::Error::Cert(http::CertError::APPLICATION_VERIFICATION) => {
                BunString::static_("application verification failure")
            }
            http::Error::Cert(http::CertError::SUBJECT_ISSUER_MISMATCH) => {
                BunString::static_("subject issuer mismatch")
            }
            http::Error::Cert(http::CertError::AKID_SKID_MISMATCH) => {
                BunString::static_("authority and subject key identifier mismatch")
            }
            http::Error::Cert(http::CertError::AKID_ISSUER_SERIAL_MISMATCH) => {
                BunString::static_("authority and issuer serial number mismatch")
            }
            http::Error::Cert(http::CertError::KEYUSAGE_NO_CERTSIGN) => {
                BunString::static_("key usage does not include certificate signing")
            }
            http::Error::Cert(http::CertError::UNABLE_TO_GET_CRL_ISSUER) => {
                BunString::static_("unable to get CRL issuer certificate")
            }
            http::Error::Cert(http::CertError::UNHANDLED_CRITICAL_EXTENSION) => {
                BunString::static_("unhandled critical extension")
            }
            http::Error::Cert(http::CertError::KEYUSAGE_NO_CRL_SIGN) => {
                BunString::static_("key usage does not include CRL signing")
            }
            http::Error::Cert(http::CertError::KEYUSAGE_NO_DIGITAL_SIGNATURE) => {
                BunString::static_("key usage does not include digital signature")
            }
            http::Error::Cert(http::CertError::UNHANDLED_CRITICAL_CRL_EXTENSION) => {
                BunString::static_("unhandled critical CRL extension")
            }
            http::Error::Cert(http::CertError::INVALID_EXTENSION) => {
                BunString::static_("invalid or inconsistent certificate extension")
            }
            http::Error::Cert(http::CertError::INVALID_POLICY_EXTENSION) => {
                BunString::static_("invalid or inconsistent certificate policy extension")
            }
            http::Error::Cert(http::CertError::NO_EXPLICIT_POLICY) => {
                BunString::static_("no explicit policy")
            }
            http::Error::Cert(http::CertError::DIFFERENT_CRL_SCOPE) => {
                BunString::static_("Different CRL scope")
            }
            http::Error::Cert(http::CertError::UNSUPPORTED_EXTENSION_FEATURE) => {
                BunString::static_("Unsupported extension feature")
            }
            http::Error::Cert(http::CertError::UNNESTED_RESOURCE) => {
                BunString::static_("RFC 3779 resource not subset of parent's resources")
            }
            http::Error::Cert(http::CertError::PERMITTED_VIOLATION) => {
                BunString::static_("permitted subtree violation")
            }
            http::Error::Cert(http::CertError::EXCLUDED_VIOLATION) => {
                BunString::static_("excluded subtree violation")
            }
            http::Error::Cert(http::CertError::SUBTREE_MINMAX) => {
                BunString::static_("name constraints minimum and maximum not supported")
            }
            http::Error::Cert(http::CertError::UNSUPPORTED_CONSTRAINT_TYPE) => {
                BunString::static_("unsupported name constraint type")
            }
            http::Error::Cert(http::CertError::UNSUPPORTED_CONSTRAINT_SYNTAX) => {
                BunString::static_("unsupported or invalid name constraint syntax")
            }
            http::Error::Cert(http::CertError::UNSUPPORTED_NAME_SYNTAX) => {
                BunString::static_("unsupported or invalid name syntax")
            }
            http::Error::Cert(http::CertError::CRL_PATH_VALIDATION_ERROR) => {
                BunString::static_("CRL path validation error")
            }
            http::Error::Cert(http::CertError::SUITE_B_INVALID_VERSION) => {
                BunString::static_("Suite B: certificate version invalid")
            }
            http::Error::Cert(http::CertError::SUITE_B_INVALID_ALGORITHM) => {
                BunString::static_("Suite B: invalid public key algorithm")
            }
            http::Error::Cert(http::CertError::SUITE_B_INVALID_CURVE) => {
                BunString::static_("Suite B: invalid ECC curve")
            }
            http::Error::Cert(http::CertError::SUITE_B_INVALID_SIGNATURE_ALGORITHM) => {
                BunString::static_("Suite B: invalid signature algorithm")
            }
            http::Error::Cert(http::CertError::SUITE_B_LOS_NOT_ALLOWED) => {
                BunString::static_("Suite B: curve not allowed for this LOS")
            }
            http::Error::Cert(http::CertError::SUITE_B_CANNOT_SIGN_P_384_WITH_P_256) => {
                BunString::static_("Suite B: cannot sign P-384 with P-256")
            }
            http::Error::Cert(http::CertError::HOSTNAME_MISMATCH) => {
                BunString::static_("Hostname mismatch")
            }
            http::Error::Cert(http::CertError::EMAIL_MISMATCH) => {
                BunString::static_("Email address mismatch")
            }
            http::Error::Cert(http::CertError::IP_ADDRESS_MISMATCH) => {
                BunString::static_("IP address mismatch")
            }
            http::Error::Cert(http::CertError::INVALID_CALL) => {
                BunString::static_("Invalid certificate verification context")
            }
            http::Error::Cert(http::CertError::STORE_LOOKUP) => {
                BunString::static_("Issuer certificate lookup error")
            }
            http::Error::Cert(http::CertError::NAME_CONSTRAINTS_WITHOUT_SANS) => {
                BunString::static_("Issuer has name constraints but leaf has no SANs")
            }
            http::Error::Cert(http::CertError::UNKNOWN_CERTIFICATE_VERIFICATION_ERROR) => {
                BunString::static_("unknown certificate verification error")
            }

            e => BunString::create_format(format_args!(
                "{} fetching \"{}\". For more information, pass `verbose: true` in the second argument to fetch()",
                e.name(),
                path,
            )),
        };

        let fetch_error = jsc::SystemError {
            code,
            message,
            path,
            ..Default::default()
        };

        BodyValueError::SystemTypeError(fetch_error)
    }

    fn on_readable_stream_available(
        ctx: NonNull<c_void>,
        _global_this: &JSGlobalObject,
        readable: ReadableStream,
    ) {
        let this = Self::from_ctx(ctx);
        if let crate::webcore::readable_stream::Source::Bytes(bytes) = readable.ptr {
            // SAFETY: the caller holds the stream, which owns the live ByteStream. JS thread.
            unsafe { this.response_stream.hold(bytes) };
        } else {
            this.response_stream.release();
        }
    }

    fn on_start_streaming_http_response_body_callback(ctx: NonNull<c_void>) -> DrainResult {
        let this = Self::from_ctx(ctx);
        if this.signal_store.aborted.load(Ordering::Relaxed) {
            return DrainResult::Aborted;
        }

        // A body consumer is attaching; keep the process alive until the
        // body finishes (undone in `on_progress_update` when `is_done`), or
        // until the stream parks unread (`park_body_stream`).
        this.poll_ref
            .with_mut(|poll_ref| poll_ref.ref_(bun_io::js_vm_ctx()));

        this.mutex.lock();
        let size_hint = this.get_size_hint() as usize;
        let drained = core::mem::take(&mut this.scheduled_response_buffer.list);
        this.mutex.unlock();

        // After the take, not before: a chunk the HTTP thread appends (and pauses for) in
        // between would otherwise reach the stream with its task finding the buffer empty, and
        // nothing left to undo that pause. Unconditional: also flushes body bytes the client
        // holds that arrived with no follow-up read (`drain_response_body`).
        this.signal_store.unpause_receive();
        this.schedule_receive_resume();

        if drained.is_empty() {
            DrainResult::EstimatedSize(size_hint)
        } else {
            DrainResult::Owned {
                list: drained,
                size_hint,
            }
        }
    }

    fn get_size_hint(&self) -> BlobSizeType {
        match self.body_size {
            http::BodySize::ContentLength(n) => n as BlobSizeType,
            http::BodySize::TotalReceived(n) => n as BlobSizeType,
            http::BodySize::Unknown => 0,
        }
    }

    /// Unhook from the response ByteStream (the stream can outlive us in JS). Touches no JS cell.
    fn clear_stream_handlers(&self) {
        self.response_stream.release();
    }

    /// reader.cancel() / body.cancel(): the server has to see the close (Node, Deno and browsers
    /// abort too). `&self` because a failed sink write reaches here from inside `on_body_received`.
    pub(crate) fn on_stream_cancelled(&self) {
        self.abort_task();
        self.abandon_response_body();
    }

    /// `SourceHandle::consumer_collected`: the parked stream's wrapper was swept, so nothing
    /// can read the rest of the body. Inside a GC sweep, like `on_response_finalize`.
    pub(crate) fn on_body_stream_collected(&self) {
        bun_output::scoped_log!(FetchTasklet, "onBodyStreamCollected");
        self.abandon_response_body();
    }

    pub(crate) fn on_stream_drained(&self) {
        self.unpark_body_stream();
        self.resume_receive();
    }

    fn resume_receive(&self) {
        if self.signal_store.unpause_receive() {
            self.schedule_receive_resume();
        }
    }

    /// A native sink was wired to the stream: something waits for bytes again.
    pub(crate) fn on_consumer_attached(&self) {
        self.unpark_body_stream();
    }

    /// The other half of this rule is in `callback` (HTTP thread).
    fn after_body_chunk_delivered(&self, bytes: &crate::webcore::ByteStream) {
        use crate::webcore::byte_stream::{AfterDelivery, ProducerHold};
        bun_output::scoped_log!(
            FetchTasklet,
            "afterBodyChunkDelivered buffered={}",
            bytes.buffered_len()
        );
        match ProducerHold::after_delivery(bytes) {
            AfterDelivery::Resume => self.resume_receive(),
            AfterDelivery::Pause => self.signal_store.pause_receive(),
            AfterDelivery::Park => {
                self.signal_store.pause_receive();
                self.park_body_stream();
            }
        }
    }

    fn park_body_stream(&self) {
        if self.response_stream.park() {
            bun_output::scoped_log!(FetchTasklet, "parkBodyStream");
            self.poll_ref
                .with_mut(|poll_ref| poll_ref.unref(bun_io::js_vm_ctx()));
        }
    }

    fn unpark_body_stream(&self) {
        if self.response_stream.unpark() {
            bun_output::scoped_log!(FetchTasklet, "unparkBodyStream");
            self.poll_ref
                .with_mut(|poll_ref| poll_ref.ref_(bun_io::js_vm_ctx()));
        }
    }

    fn on_start_buffering_callback(ctx: NonNull<c_void>) {
        let this = Self::from_ctx(ctx);
        this.poll_ref
            .with_mut(|poll_ref| poll_ref.ref_(bun_io::js_vm_ctx()));
        if this.signal_store.receive_all() {
            this.schedule_receive_resume();
        }
    }

    fn schedule_receive_resume(&self) {
        if let Some(http_) = self.http.as_ref() {
            http::http_thread().schedule_receive_resume(http_.async_http_id);
        }
    }

    fn to_body_value(&mut self) -> BodyValue {
        if let Some(err) = self.get_abort_error() {
            return BodyValue::Error(err);
        }
        if self.result.fail.is_some() {
            // Head received but body failed in the same callback; surface on
            // the body so this matches the split-read `on_body_received` path.
            return BodyValue::Error(self.on_reject());
        }
        if self.is_waiting_body {
            let mut pending = body::PendingValue::new(&self.global_this);
            pending.size_hint = self.get_size_hint();
            pending.task = Some(NonNull::from(&mut *self).cast::<c_void>());
            pending.on_start_streaming =
                Some(FetchTasklet::on_start_streaming_http_response_body_callback);
            pending.on_readable_stream_available = Some(FetchTasklet::on_readable_stream_available);
            pending.on_start_buffering = Some(FetchTasklet::on_start_buffering_callback);
            pending.producer = SourceHandle::FetchResponseBody(bun_ptr::BackRef::new_mut(self));
            return BodyValue::Locked(pending);
        }

        let scheduled_response_buffer = core::mem::take(&mut self.scheduled_response_buffer);
        let response = BodyValue::InternalBlob(InternalBlob {
            bytes: scheduled_response_buffer.list,
            was_string: false,
        });
        self.scheduled_response_buffer = MutableString::default();

        response
    }

    /// <https://fetch.spec.whatwg.org/#main-fetch>: HEAD responses and null body
    /// statuses have no body. Not 101: the HTTP client only accepts it for a
    /// requested upgrade, and the upgraded connection is then the body.
    fn response_body_is_null(&self, status_code: u16) -> bool {
        (crate::server::http_status_text::is_null_body(status_code) && status_code != 101)
            || self
                .http
                .as_deref()
                .is_some_and(|http_| http_.method() == Method::HEAD)
    }

    /// Content the server frames anyway (a 205 with content) is dropped and the connection
    /// closed. `is_waiting_body` stays false: nothing may reach this body.
    fn null_body_value(&mut self) -> BodyValue {
        self.scheduled_response_buffer = MutableString::default();
        if self.result.has_more {
            self.abandon_response_body();
        }
        BodyValue::Null
    }

    fn to_response(&mut self) -> Response {
        bun_output::scoped_log!(FetchTasklet, "toResponse");
        debug_assert!(self.metadata.is_some());
        // at this point we always should have metadata
        let metadata = self.metadata.as_ref().unwrap();
        let http_response = &metadata.response;
        // reshaped for borrowck — capture metadata fields before to_body_value() takes &mut self
        let headers = FetchHeaders::create_from_pico_headers(http_response.headers.list);
        let status_code = http_response.status_code as u16;
        // Fast path: when the wire reason phrase matches the canonical text for
        // this status code, store a StaticEncodedSlice and skip the WTF allocation.
        let status_text = match crate::server::http_status_text::get(status_code)
            .map(|t| &t[4..])
            .filter(|canon| *canon == http_response.status)
        {
            Some(canon) => BunString::static_(canon),
            None => BunString::clone_utf8(http_response.status),
        };
        let url = BunString::clone_utf8(metadata.url.slice());
        let redirected = self.result.redirected;
        let body = if self.response_body_is_null(status_code) {
            self.null_body_value()
        } else {
            self.is_waiting_body = self.result.has_more;
            self.to_body_value()
        };
        Response::init(
            crate::webcore::response::Init {
                // SAFETY: create_from_pico_headers returns a fresh refcount=1 FetchHeaders*.
                headers: Some(unsafe { HeadersRef::adopt(headers) }),
                status_code,
                status_text,
                ..Default::default()
            },
            Body::new(body),
            url,
            redirected,
        )
    }

    /// Nothing will read the rest of the body: abort the transport, let go of the loop and of the
    /// response; `callback` drops whatever still arrives. Safe inside a GC sweep
    /// (`on_response_finalize`, `on_body_stream_collected`): no JS cell is touched; the
    /// request-body sink is left for `clear_sink()` in `deinit()`.
    fn abandon_response_body(&self) {
        bun_output::scoped_log!(FetchTasklet, "abandonResponseBody");
        self.signal_store.abandon();
        self.abort_transport();
        self.poll_ref
            .with_mut(|poll_ref| poll_ref.unref(bun_io::js_vm_ctx()));
        self.clear_stream_handlers();
        self.response.clear();
        self.native_response.set(None);
    }

    fn on_resolve(&mut self) -> JSValue {
        bun_output::scoped_log!(FetchTasklet, "onResolve");
        let response = bun_core::heap::into_raw(Box::new(self.to_response()));
        // The fetch() promise is about to resolve; from here the paused
        // transport should not by itself keep the event loop alive. The body
        // consumer hooks (`on_start_streaming_http_response_body_callback`,
        // `on_start_buffering_callback`) re-ref if the caller reads the body.
        if self.is_waiting_body {
            self.poll_ref
                .with_mut(|poll_ref| poll_ref.unref(bun_io::js_vm_ctx()));
        }
        // SAFETY: response is a freshly allocated Response; makeMaybePooled takes ownership semantics on the JS side
        let global_this = self.global_this;
        // SAFETY: `response` is freshly allocated above; ownership transfers to JSC.
        let response_js = Response::make_maybe_pooled(&global_this, response);
        response_js.ensure_still_alive();
        self.response = jsc::Weak::<FetchTasklet>::create(
            response_js,
            &global_this,
            jsc::WeakRefType::FetchResponse,
            self,
        );
        // SAFETY: `response` is the live heap allocation owned by JSC after
        // `make_maybe_pooled`.
        self.native_response
            .set(Some(unsafe { RefPtr::init_ref(response) }));
        // Response-owned listener so abort still errors the body after this tasklet detaches its own.
        if let Some(signal) = self.abort_signal() {
            // SAFETY: `response` is the live heap allocation owned by JSC.
            unsafe { Response::attach_abort_signal(response, &global_this, signal) };
        }
        response_js
    }

    fn get(
        global_this: &JSGlobalObject,
        fetch_options: FetchOptions,
        promise: jsc::JSPromiseStrong,
    ) -> crate::Result<*mut FetchTasklet> {
        let mut fetch_tasklet = Box::new(FetchTasklet {
            sink: None,
            // `AsyncHTTP` has no `Default`/zero-init; defer the Box until
            // `AsyncHTTP::init` produces the value.
            http: None,
            result: HTTPClientResult::default(),
            metadata: None,
            http_ticket: None,
            global_this: GlobalRef::from(global_this),
            request_body: fetch_options.body,
            request_body_streaming_buffer: None,
            scheduled_response_buffer: MutableString::default(),
            response: jsc::Weak::default(),
            native_response: JsCell::new(None),
            response_stream: Default::default(),
            request_headers: fetch_options.headers,
            promise,
            concurrent_task: ConcurrentTask::default(),
            poll_ref: JsCell::new(KeepAlive::default()),
            body_size: http::BodySize::Unknown,
            url_proxy_buffer: fetch_options.url_proxy_buffer,
            signal: fetch_options.signal,
            signals: Signals::default(),
            signal_store: http::signals::Store::default(),
            has_schedule_callback: AtomicBool::new(false),
            abort_reason: StrongOptional::empty(),
            check_server_identity: fetch_options.check_server_identity,
            reject_unauthorized: fetch_options.reject_unauthorized,
            upgraded_connection: fetch_options.upgraded_connection,
            unix_socket_path: fetch_options.unix_socket_path,
            is_waiting_body: false,
            is_waiting_abort: false,
            is_waiting_request_stream_start: false,
            mutex: Mutex::new(),
            // SAFETY: jsc_vm derived from FFI ptr above; AsyncTaskTracker::init only
            // bumps a counter on the VM.
            tracker: AsyncTaskTracker::init(global_this.bun_vm().as_mut()),
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
        });

        fetch_tasklet.signals = fetch_tasklet.signal_store.to_with_backpressure();

        fetch_tasklet.tracker.did_schedule(global_this);

        // `body` is *moved* through `FetchOptions` into `request_body` (no
        // shallow alias, no post-queue detach), so the RefPtr<Store> already carries
        // the caller's +1 — bumping it again here leaked one ref per
        // Blob-backed body (issue: fetch-leak fixture #5 RSS growth).
        // `clear_data() → request_body.detach()` releases it.

        let url = fetch_options.url;
        let env = global_this.bun_vm().as_mut().transpiler.env_mut();
        // Capture the proxy env so the HTTP thread can re-resolve per redirect
        // hop (`HTTPClient::reevaluate_proxy_for_redirect`). `ProxySettings`
        // owns copies of the env values, so a later `process.env.HTTP_PROXY =
        // ...` on the JS thread cannot invalidate them mid-request.
        let proxy_settings: Option<Box<http::ProxySettings>> =
            if let Some(proxy_opt) = &fetch_options.proxy {
                if !proxy_opt.is_empty() {
                    http::ProxySettings::from_explicit(proxy_opt.href, env)
                } else {
                    // proxy: "" means explicitly no proxy (direct connection)
                    None
                }
            } else {
                http::ProxySettings::from_env(env)
            };
        // Hop-0 proxy borrows the boxed `ProxySettings` heap storage, which is
        // moved into `AsyncHTTP::init` below and lives on `client` for the
        // lifetime of the request.
        let proxy: Option<ZigURL> = proxy_settings.as_deref().and_then(|s| {
            let href: *const [u8] = s.resolve(&url)?;
            // SAFETY: see block comment above.
            Some(ZigURL::parse(unsafe { &*href }))
        });

        if fetch_tasklet.check_server_identity.has() && fetch_tasklet.reject_unauthorized {
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
        // `AsyncHTTP::init` takes several `&'static [u8]` borrows
        // (headers_buf, request_body, unix_socket_path) that point into
        // FetchTasklet-owned storage. The tasklet is heap-pinned via
        // `heap::alloc`, so erase the borrow lifetimes through raw pointers.
        // SAFETY: `fetch_tasklet_ptr` is a stable heap allocation that outlives
        // the AsyncHTTP (dropped together in `deinit`); the slices below borrow
        // its `request_headers.buf`, `request_body`, and `unix_socket_path`
        // fields which are not reallocated for the lifetime of the request.
        // SAFETY (`Interned::assume` — Population B, holder-backed):
        // `fetch_tasklet_ptr` is a `heap::alloc`'d `FetchTasklet` whose
        // `request_headers.buf` / `request_body` /
        // `unix_socket_path` fields are not reallocated for the request's
        // lifetime, and the tasklet is freed in `deinit` only after the owned
        // `AsyncHTTP` is dropped. NOT process-lifetime — these should become
        // `RawSlice<u8>` once `AsyncHTTP::init` accepts holder-lifetime slices;
        // `assume` names the owner so the widen is grep-able until then.
        let headers_buf: &'static [u8] =
            unsafe { bun_ptr::Interned::assume(fetch_tasklet.request_headers.buf.as_slice()) }
                .as_bytes();
        // SAFETY: see `Interned::assume` note above — same heap-pinned `FetchTasklet` owner.
        let request_body_slice: &'static [u8] =
            unsafe { bun_ptr::Interned::assume(fetch_tasklet.request_body.slice()) }.as_bytes();
        // SAFETY: see block note above — same `FetchTasklet` owner.
        let unix_socket_path: &'static [u8] =
            unsafe { bun_ptr::Interned::assume(&fetch_tasklet.unix_socket_path) }.as_bytes();
        // `MultiArrayList` owns its
        // allocation, so clone; AsyncHTTP::init clones again for the client.
        let header_entries = bun_core::handle_oom(fetch_tasklet.request_headers.entries.clone());
        // `url` is moved into `AsyncHTTP::init`; capture the one
        // post-move query (`is_http()`, debug-assert only) up front.
        let url_is_http = url.is_http();

        fetch_tasklet.http = Some(Box::new(AsyncHTTP::init(
            fetch_options.method,
            url,
            header_entries,
            headers_buf,
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
                proxy_settings,
                proxy_headers: fetch_options.proxy_headers,
                signals: Some(fetch_tasklet.signals),
                unix_socket_path: Some(unix_socket_path),
                disable_timeout: Some(fetch_options.disable_timeout),
                idle_timeout_seconds: fetch_options.idle_timeout_seconds,
                disable_keepalive: Some(fetch_options.disable_keepalive),
                disable_decompression: Some(fetch_options.disable_decompression),
                max_redirects: fetch_options.max_redirects,
                reject_unauthorized: Some(fetch_options.reject_unauthorized),
                verbose: Some(fetch_options.verbose),
                tls_props: fetch_options.ssl_config,
                compress: fetch_options.compress,
            },
        )));
        // enable streaming the write side
        let is_stream = matches!(
            fetch_tasklet.request_body,
            HTTPRequestBody::ReadableStream(_)
        );
        let http_client = fetch_tasklet.http.as_mut().unwrap();
        http_client.client.flags.is_streaming_request_body = is_stream;
        http_client.client.flags.forced_protocol = fetch_options.forced_protocol;
        http_client.client.flags.is_node_http_client = fetch_options.is_node_http_client;
        fetch_tasklet.is_waiting_request_stream_start = is_stream;
        if is_stream {
            // Intrusive `ref_count` starts at 2 (one for the main thread, one for the HTTP
            // thread), so the same raw pointer can be handed to both sides.
            let buffer = ThreadSafeStreamBuffer::new(ThreadSafeStreamBuffer::default());
            // SAFETY: fresh heap allocation from `ThreadSafeStreamBuffer::new` (heap::alloc);
            // exclusively owned here until shared below.
            unsafe {
                (*buffer).set_drain_callback::<FetchTasklet>(
                    FetchTasklet::on_write_request_data_drain,
                    fetch_tasklet_ptr,
                );
            }
            // SAFETY: adopts one of the two initial refs.
            fetch_tasklet.request_body_streaming_buffer = Some(unsafe { RefPtr::from_raw(buffer) });
            fetch_tasklet.http.as_mut().unwrap().request_body =
                http::HTTPRequestBody::Stream(http::http_request_body::Stream {
                    buffer: core::ptr::NonNull::new(buffer),
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

        if let HTTPRequestBody::Sendfile(sendfile) = &fetch_tasklet.request_body {
            debug_assert!(url_is_http);
            debug_assert!(fetch_options.proxy.is_none());
            fetch_tasklet.http.as_mut().unwrap().request_body =
                http::HTTPRequestBody::Sendfile(*sendfile);
        }

        if let Some(signal) = &fetch_tasklet.signal {
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
        this.abort_reason.set(&this.global_this, reason);
        this.abort_task();
        if this.sink_mut().is_some() {
            this.cancel_request_body_sink(reason);
            return;
        }
        // Abort fired before the HTTP thread asked for the body, so the
        // ReadableStream was never wired into a sink. Cancel it directly so
        // the underlying source's cancel(reason) callback still observes the
        // signal's reason (https://fetch.spec.whatwg.org/#abort-fetch step 5).
        if this.is_waiting_request_stream_start {
            if let HTTPRequestBody::ReadableStream(stream_ref) = &this.request_body {
                this.is_waiting_request_stream_start = false;
                if let Some(stream) = stream_ref.get() {
                    crate::dispatch::fold(stream.cancel_with_reason(&this.global_this, reason));
                }
            }
        }
    }

    /// This is ALWAYS called from the http thread and we cannot touch the buffer here because is locked
    fn on_write_request_data_drain(this: *mut FetchTasklet) {
        let this_ref = Self::from_raw_ref(this);
        // ref until the main thread callback is called
        this_ref.ref_();
        // `from_callback` heap-allocates a fresh `ConcurrentTaskItem`.
        let task = ConcurrentTask::from_callback(this, FetchTasklet::resume_request_data_stream);
        this_ref
            .http_ticket
            .as_ref()
            .expect(Self::HOLDS_TICKET)
            .post(task);
    }

    /// This is ALWAYS called from the main thread
    // ConcurrentTask::from_callback expects `fn(*mut T) -> bun_event_loop::JsResult<()>`.
    fn resume_request_data_stream(this: *mut FetchTasklet) -> ElJsResult<()> {
        let this_ref = Self::from_raw_mut(this);
        bun_output::scoped_log!(FetchTasklet, "resumeRequestDataStream");
        if !this_ref.signal_aborted() {
            let global_this = this_ref.global_this;
            if let Some(sink) = this_ref.sink_mut() {
                sink.on_drain(&global_this);
            }
        }
        // deref when done because we ref inside onWriteRequestDataDrain
        // SAFETY: `this` is the live heap tasklet; we hold a ref.
        FetchTasklet::deref(this);
        Ok(())
    }

    /// Whether the request body should skip chunked transfer encoding framing.
    /// True for upgraded connections (e.g. WebSocket) or when the user explicitly
    /// set Content-Length without setting Transfer-Encoding.
    pub(crate) fn skip_chunked_framing(&self) -> bool {
        self.upgraded_connection
            || self.result.is_http2
            || (self.request_headers.get(b"content-length").is_some()
                && self.request_headers.get(b"transfer-encoding").is_none())
    }

    /// Called from `FetchRequestBodySink::write_*`; `high_water_mark` is the
    /// sink's configured HWM so the backpressure threshold tracks
    /// `start({ highWaterMark })`.
    pub(crate) fn write_request_data(
        &mut self,
        data: RequestBodyChunk<'_>,
        high_water_mark: usize,
    ) -> Writable {
        if self.signal_aborted() {
            return Writable::Done;
        }
        // An empty chunk is a no-op on every framing path. It must not reach
        // the chunked framer below, which would serialize it as "0\r\n\r\n",
        // the chunked-body TERMINATOR (RFC 9112 section 7.1), ending the
        // message mid-upload. It must also never report Backpressure: nothing
        // gets buffered, so the HTTP thread's report_drain (what resumes a
        // paused sink) can never fire, and the upload stalls forever.
        let utf8_len = data.utf8_len();
        bun_output::scoped_log!(FetchTasklet, "writeRequestData {}", utf8_len);
        if utf8_len == 0 {
            return Writable::Owned(0);
        }
        let len = utf8_len as BlobSizeType;
        let Some(thread_safe_stream_buffer) = self.stream_buffer_mut() else {
            return Writable::Done;
        };
        // Mutex guards `buffer` against the HTTP thread; released when
        // `stream_buffer` drops. Borrow is detached from `self` (see accessor).
        let mut stream_buffer = thread_safe_stream_buffer.lock();

        // dont have backpressure so we will schedule the data to be written
        // if we have backpressure the onWritable will drain the buffer
        let needs_schedule = stream_buffer.is_empty();
        if self.skip_chunked_framing() {
            data.append_utf8_into(&mut stream_buffer.list);
        } else {
            //16 is the max size of a hex number size that represents 64 bits + 2 for the \r\n
            let mut formated_size_buffer = [0u8; 18];
            use std::io::Write;
            let formated_size = {
                let mut cursor = &mut formated_size_buffer[..];
                write!(cursor, "{:x}\r\n", utf8_len).expect("unreachable");
                let written = 18 - cursor.len();
                &formated_size_buffer[..written]
            };
            let _ = stream_buffer.ensure_unused_capacity(formated_size.len() + utf8_len + 2); // OOM/capacity: fire-and-forget
            stream_buffer.write_assume_capacity(formated_size);
            data.append_utf8_into(&mut stream_buffer.list);
            stream_buffer.write_assume_capacity(b"\r\n");
        }

        let result = if stream_buffer.size() >= high_water_mark {
            Writable::Backpressure(len)
        } else {
            Writable::Owned(len)
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
            if self.signal_store.aborted.load(Ordering::Relaxed) || self.abort_reason.has() {
                // SAFETY: `this_ptr` derived from live `&mut self`; we hold a ref.
                FetchTasklet::deref(this_ptr);
                return;
            }
            if !js_error.is_undefined_or_null() {
                self.abort_reason.set(&self.global_this, js_error);
            }
            self.abort_task();
        } else {
            if self.signal_store.aborted.load(Ordering::Relaxed) {
                // SAFETY: `this_ptr` derived from live `&mut self`; we hold a ref.
                FetchTasklet::deref(this_ptr);
                return;
            }
            if !self.skip_chunked_framing() {
                // Using chunked transfer encoding, send the terminating chunk
                let Some(thread_safe_stream_buffer) = self.stream_buffer_mut() else {
                    // SAFETY: `this_ptr` derived from live `&mut self`; we hold a ref.
                    FetchTasklet::deref(this_ptr);
                    return;
                };
                // Mutex guards `buffer` against the HTTP thread; released when
                // the lock guard drops.
                let _ = thread_safe_stream_buffer
                    .lock()
                    .write(http::END_OF_CHUNKED_HTTP1_1_ENCODING_RESPONSE_BODY); // OOM/capacity: fire-and-forget
            }
            if let Some(http_) = self.http.as_mut() {
                http::http_thread()
                    .schedule_request_write(http_, http::http_thread::WriteMessageType::End);
            }
        }
        // SAFETY: `this_ptr` derived from live `&mut self`; we hold a ref.
        FetchTasklet::deref(this_ptr);
    }

    fn abort_task(&self) {
        if self.abort_transport() {
            self.tracker.did_cancel(&self.global_this);
        }
    }

    /// Idempotent: an AbortSignal, VM teardown and `abandon_response_body` can all reach here for
    /// the same fetch. Only the first enqueues a shutdown. No JS.
    fn abort_transport(&self) -> bool {
        if self.signal_store.aborted.swap(true, Ordering::Relaxed) {
            return false;
        }
        if let Some(http_) = self.http.as_deref() {
            http::http_thread().schedule_shutdown(http_);
        }
        true
    }

    /// Cancel an in-flight request-body sink: stores the abort reason, aborts
    /// the HTTP task, marks the sink ended/done, and fires the controller's
    /// onClose (which cancels the upstream ReadableStream reader). On the JS
    /// pump path the single balancing `write_end_request` is left to the
    /// `assign_to_stream` pump-promise settlement (on_resolve/on_reject); on
    /// the native ByteStream path there is no pump promise, so balance it
    /// here. No-op when no sink or already ended.
    pub(crate) fn cancel_request_body_sink(&mut self, reason: JSValue) {
        let Some(sink) = self.sink_mut() else {
            return;
        };
        if sink.ended {
            return;
        }
        sink.ended = true;
        sink.done = true;
        let is_native = matches!(
            sink.source,
            SourceHandle::ByteStream(_) | SourceHandle::FileReader(_)
        );
        if !reason.is_empty_or_undefined_or_null() && !self.abort_reason.has() {
            let global_this = self.global_this;
            self.abort_reason.set(&global_this, reason);
        }
        self.abort_task();
        if let Some(sink) = self.sink_mut() {
            sink.pending.result = Writable::Done;
            sink.pending.run();
            sink.source.close(None);
            if is_native {
                sink.task = None;
            }
        }
        if is_native {
            // No pump promise exists to balance the `+1` from
            // `start_request_stream`; `aborted` is set above so
            // `write_end_request(Some(_))` is just the balancing deref.
            self.write_end_request(Some(reason));
        }
    }

    pub(crate) fn queue(
        global: &JSGlobalObject,
        fetch_options: FetchOptions,
        promise: jsc::JSPromiseStrong,
    ) -> crate::Result<*mut FetchTasklet> {
        http::http_thread::init(&http::http_thread::InitOpts::default());
        let node = Self::get(global, fetch_options, promise)?;

        let node_ref = Self::from_raw_mut(node);
        let mut batch = bun_threading::thread_pool::Batch::default();
        node_ref.http.as_mut().unwrap().schedule(&mut batch);
        node_ref
            .poll_ref
            .with_mut(|poll_ref| poll_ref.ref_(bun_io::js_vm_ctx()));

        // increment ref so we can keep it alive until the http client is done
        node_ref.ref_();
        // Out on the HTTP thread from here until its final callback: the VM
        // aborts it at teardown (registry) and waits for it (the ticket).
        node_ref.http_ticket = Some(global.bun_vm().ticket());
        crate::jsc_hooks::ActiveHandle::Fetch(NonNull::new(node).expect("tasklet")).register();
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
    fn callback(
        task: *mut FetchTasklet,
        async_http: *mut AsyncHTTP<'static>,
        mut result: HTTPClientResult,
    ) {
        // at this point only this thread is accessing result to is no race condition
        let is_done = !result.has_more;
        let task_ref = Self::from_raw_mut(task);

        task_ref.mutex.lock();
        // we need to unlock before task.deref();
        // explicit unlock + deref at end instead of nested defers.
        // Sync HTTP-thread state back into the JS-side instance via an
        // explicit field-subset copy (`AsyncHTTP` is not `Copy`:
        // `HTTPClient: Drop`, owned Vecs); see `AsyncHTTP::sync_progress_from`
        // for the field list.
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
            "callback success={} receive_mode={:?} has_more={} bytes={}",
            result.is_success(),
            task_ref.signal_store.body_receive_mode(),
            result.has_more,
            result.body.len()
        );

        let prev_metadata = task_ref.result.metadata.take();
        let prev_cert_info = task_ref.result.certificate_info.take();
        let prev_can_stream = task_ref.result.can_stream;
        // `result.body` borrows the HTTP thread's scratch buffer on non-terminal
        // callbacks; the terminal callback carries the bytes in `body_owned`
        // instead. Capture both before `detach_lifetime` clears them in the
        // stored copy.
        let body: &[u8] = result.body;
        let body_owned: Vec<u8> = core::mem::take(&mut result.body_owned);
        // SAFETY: lifetime erasure for non-body fields; `body` is stored as
        // `&'static []` so no borrow escapes.
        task_ref.result = unsafe { result.detach_lifetime() };
        // can_stream is a one-shot signal to start the request body stream; don't let a
        // later coalesced result clobber it before the JS thread sees it.
        task_ref.result.can_stream = task_ref.result.can_stream || prev_can_stream;

        // Preserve pending certificate info if it was preovided in the previous update.
        if task_ref.result.certificate_info.is_none() {
            if let Some(cert_info) = prev_cert_info {
                task_ref.result.certificate_info = Some(cert_info);
            }
        }

        // metadata should be provided only once
        if let Some(metadata) = task_ref.result.metadata.take().or(prev_metadata) {
            bun_output::scoped_log!(FetchTasklet, "added callback metadata");
            if task_ref.metadata.is_none() {
                task_ref.metadata = Some(metadata);
            }

            task_ref.result.metadata = None;
        }

        task_ref.body_size = task_ref.result.body_size;

        let success = task_ref.result.is_success();

        if task_ref.signal_store.body_receive_mode() == BodyReceiveMode::Abandoned {
            if task_ref.scheduled_response_buffer.list.capacity() > 0 {
                task_ref.scheduled_response_buffer = MutableString::default();
            }
            if success && task_ref.result.has_more {
                task_ref.mutex.unlock();
                return;
            }
        } else if success {
            let scheduled = &mut task_ref.scheduled_response_buffer;
            if body.is_empty() && !body_owned.is_empty() && scheduled.list.is_empty() {
                scheduled.list = body_owned;
            } else {
                // Grow to Content-Length once so the per-packet append below
                // doesn't leave the ~2x doubling over-capacity that the
                // ArrayBuffer would adopt. Only for a consumer that wants the whole body.
                if task_ref.signal_store.body_receive_mode() == BodyReceiveMode::BufferAll {
                    if let http::BodySize::ContentLength(n) = task_ref.body_size {
                        if n > scheduled.list.capacity() {
                            let additional = n
                                .min(SCHEDULED_PRERESERVE_MAX)
                                .saturating_sub(scheduled.list.len());
                            let _ = scheduled.list.try_reserve_exact(additional);
                        }
                    }
                }
                let chunk = if body.is_empty() {
                    body_owned.as_slice()
                } else {
                    body
                };
                if !chunk.is_empty() {
                    bun_core::handle_oom(scheduled.write(chunk));
                }
            }
            if task_ref.result.has_more
                && task_ref.scheduled_response_buffer.list.len() >= BODY_HIGH_WATER_MARK
            {
                task_ref.signal_store.pause_receive();
            }
        }

        if let Err(has_schedule_callback) = task_ref.has_schedule_callback.compare_exchange(
            false,
            true,
            Ordering::Acquire,
            Ordering::Relaxed,
        ) {
            if has_schedule_callback {
                task_ref.mutex.unlock();
                if is_done {
                    FetchTasklet::hand_back(task);
                }
                return;
            }
        }
        // will deinit when done with the http client (when is_done = true)
        let ct = core::ptr::NonNull::from(
            task_ref
                .concurrent_task
                .from(task, AutoDeinit::ManualDeinit),
        );
        // `ct` is the inline `concurrent_task` field of the heap tasklet; the
        // queue takes ownership of its `next` link. This thread's ref keeps the
        // tasklet (and the ticket in it) alive across the post.
        task_ref
            .http_ticket
            .as_ref()
            .expect(Self::HOLDS_TICKET)
            .post(ct);

        task_ref.mutex.unlock();
        // we are done with the http client so we can deref our side
        // this is a atomic operation and will enqueue a task to deinit on the main thread
        if is_done {
            FetchTasklet::hand_back(task);
        }
    }
}

fn on_resolve_request_stream(
    _global_this: &JSGlobalObject,
    callframe: &bun_jsc::CallFrame,
) -> JsResult<JSValue> {
    let args = callframe.arguments();
    let this: *mut FetchTasklet = args[args.len() - 1].as_promise_ptr::<FetchTasklet>();
    // SAFETY: `as_promise_ptr` recovers the `*mut FetchTasklet` stashed by
    // `start_request_stream`; the `ref_()` there keeps it alive, balanced by
    // `write_end_request` below. Clear `sink.task` first so the sink's
    // `finalize()` fallback does not release a second time.
    unsafe {
        if let Some(sink) = (*this).sink_mut() {
            sink.task = None;
        }
        (*this).write_end_request(None);
    }
    Ok(JSValue::UNDEFINED)
}

fn on_reject_request_stream(
    _global_this: &JSGlobalObject,
    callframe: &bun_jsc::CallFrame,
) -> JsResult<JSValue> {
    let args = callframe.arguments();
    let this: *mut FetchTasklet = args[args.len() - 1].as_promise_ptr::<FetchTasklet>();
    let err = args[0];
    // SAFETY: `as_promise_ptr` recovers the `*mut FetchTasklet` stashed by
    // `start_request_stream`; the `ref_()` there keeps it alive, balanced by
    // `write_end_request` below. Clear `sink.task` first so the sink's
    // `finalize()` fallback does not release a second time.
    unsafe {
        if let Some(sink) = (*this).sink_mut() {
            sink.task = None;
        }
        (*this).write_end_request(Some(err));
    }
    Ok(JSValue::UNDEFINED)
}

// Exported as function symbols so `Zig::GlobalObject::promiseHandlerID`'s
// address comparison matches; see `Bun__FileSink__onResolveStream` for why a
// `static` fn-ptr export would fail.
bun_jsc::jsc_host_abi! {
    #[unsafe(export_name = "Bun__FetchTasklet__onResolveRequestStream")]
    unsafe fn on_resolve_request_stream_shim(
        g: *mut JSGlobalObject,
        cf: *mut bun_jsc::CallFrame,
    ) -> JSValue {
        match on_resolve_request_stream(bun_opaque::opaque_deref(g), bun_opaque::opaque_deref(cf)) {
            Ok(v) => v,
            Err(_) => JSValue::ZERO,
        }
    }
}
bun_jsc::jsc_host_abi! {
    #[unsafe(export_name = "Bun__FetchTasklet__onRejectRequestStream")]
    unsafe fn on_reject_request_stream_shim(
        g: *mut JSGlobalObject,
        cf: *mut bun_jsc::CallFrame,
    ) -> JSValue {
        match on_reject_request_stream(bun_opaque::opaque_deref(g), bun_opaque::opaque_deref(cf)) {
            Ok(v) => v,
            Err(_) => JSValue::ZERO,
        }
    }
}

impl FetchTasklet {
    #[bun_uws::uws_callback(export = "Bun__FetchResponse_finalize", no_catch)]
    pub(crate) fn on_response_finalize(&mut self) {
        bun_output::scoped_log!(FetchTasklet, "onResponseFinalize");
        let Some(response) = self.native_response.get().as_deref() else {
            return;
        };
        let BodyValue::Locked(locked) = response.get_body_value() else {
            // The body arrived or failed; nothing is underway.
            return;
        };
        // What can outlive the Response and still take the body: its stream (whose own collection
        // is `on_body_stream_collected`), or a whole-body consumer (`.text()` and friends hold a
        // promise, `Bun.write` an `on_receive_value`).
        let outlived = self.response_stream.is_held()
            || locked.on_receive_value.is_some()
            || locked
                .promise
                .is_some_and(|promise| !promise.is_empty_or_undefined_or_null());
        if !outlived {
            self.abandon_response_body();
        }
    }
}

pub struct FetchOptions {
    pub method: Method,
    pub(crate) headers: Headers,
    pub(crate) body: HTTPRequestBody,
    pub(crate) disable_timeout: bool,
    /// Per-request idle-timeout override, from `fetch(url, { timeout: <ms> })`.
    pub(crate) idle_timeout_seconds: Option<core::ffi::c_uint>,
    pub(crate) disable_keepalive: bool,
    pub(crate) disable_decompression: bool,
    pub(crate) max_redirects: Option<u8>,
    pub(crate) reject_unauthorized: bool,
    pub(crate) url: ZigURL<'static>,
    pub(crate) verbose: http::HTTPVerboseLevel,
    pub(crate) redirect_type: FetchRedirect,
    pub(crate) proxy: Option<ZigURL<'static>>,
    pub(crate) proxy_headers: Option<Headers>,
    pub(crate) url_proxy_buffer: Box<[u8]>,
    pub(crate) signal: Option<AbortSignalRef>,
    pub(crate) check_server_identity: StrongOptional,
    pub(crate) unix_socket_path: Box<[u8]>,
    pub(crate) ssl_config: Option<http::ssl_config::SharedPtr>,
    pub(crate) upgraded_connection: bool,
    pub(crate) forced_protocol: Option<http::Protocol>,
    pub(crate) is_node_http_client: bool,
    pub(crate) compress: Option<http::compress_body::CompressOption>,
}

pub(crate) struct FetchTaskletPromiseSettle {
    held: StrongOptional,
    promise: jsc::JSPromiseStrong,
    global_object: GlobalRef,
    success: bool,
}

impl FetchTaskletPromiseSettle {
    #[allow(clippy::boxed_local, reason = "reclaim point for the boxed task")]
    pub(crate) fn run(mut self: Box<Self>) -> JsResult<()> {
        let prom = self.promise.value_or_empty().as_any_promise().unwrap();
        let res = self.held.swap();
        res.ensure_still_alive();
        let r = if self.success {
            prom.resolve(&self.global_object, res)
        } else {
            prom.reject_with_async_stack(&self.global_object, res)
        };
        self.held.deinit();
        self.promise = jsc::JSPromiseStrong::empty();
        r
    }
}

impl bun_event_loop::Taskable for FetchTaskletPromiseSettle {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::FetchTaskletPromiseSettle;
    /// Drop the held value and promise handle without settling.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract — the box the completion queued.
        drop(unsafe { bun_core::heap::take(this) });
    }
}
