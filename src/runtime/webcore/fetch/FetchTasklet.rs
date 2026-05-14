use bun_collections::{ByteVecExt, VecExt};
use core::ffi::c_void;
use core::sync::atomic::{AtomicBool, Ordering};

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
use bun_threading::Mutex;
use bun_url::URL as ZigURL;

use crate::api::bun_x509 as X509;
use crate::webcore::blob::{Any as AnyBlob, Blob, SizeType as BlobSizeType, Store as BlobStore};
use crate::webcore::body::{self, Body, Value as BodyValue, ValueError as BodyValueError};
use crate::webcore::readable_stream::{self, ReadableStream, Strong as ReadableStreamStrong};
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

pub type ResumableSink = ResumableFetchSink;

#[derive(bun_ptr::ThreadSafeRefCounted)]
#[ref_count(destroy = FetchTasklet::deinit)]
pub struct FetchTasklet {
    // PORT NOTE: ResumableSink is intrusively refcounted (`ref_count: Cell<u32>` +
    // heap::alloc); was `Option<Arc<_>>` in Phase A — `Arc` can't be mutably
    // borrowed for `cancel/drain`, so model as raw like Zig's `?*ResumableSink`.
    pub sink: Option<*mut ResumableSink>,
    // Self-referential: borrows from `request_body` / `request_headers` owned
    // by sibling fields, so the lifetime is erased to `'static`.
    pub http: Option<Box<AsyncHTTP<'static>>>,
    pub result: HTTPClientResult<'static>,
    pub metadata: Option<HTTPResponseMetadata>,
    pub javascript_vm: &'static VirtualMachine,
    pub global_this: GlobalRef,
    pub request_body: HTTPRequestBody,
    // PORT NOTE: ThreadSafeStreamBuffer is intrusively refcounted (`ref_count: AtomicU32`,
    // starts at 2) and shared with the HTTP thread via raw ptr; was `Option<Arc<_>>` in
    // Phase A — `Arc` can't be mutably borrowed for `acquire/release`. Model as raw like
    // Zig's `?*http.ThreadSafeStreamBuffer`.
    pub request_body_streaming_buffer: Option<core::ptr::NonNull<ThreadSafeStreamBuffer>>,

    /// buffer being used by AsyncHTTP
    pub response_buffer: MutableString,
    /// buffer used to stream response to JS
    pub scheduled_response_buffer: MutableString,
    /// response weak ref we need this to track the response JS lifetime
    pub response: jsc::Weak<FetchTasklet>,
    /// native response ref if we still need it when JS is discarted
    // PORT NOTE: Response is intrusively refcounted; raw ptr matches Zig `?*Response`.
    pub native_response: Option<*mut Response>,
    pub ignore_data: bool,
    /// stream strong ref if any is available
    pub readable_stream_ref: ReadableStreamStrong,
    pub request_headers: Headers,
    pub promise: jsc::JSPromiseStrong,
    pub concurrent_task: ConcurrentTask,
    pub poll_ref: KeepAlive,
    /// For Http Client requests
    /// when Content-Length is provided this represents the whole size of the request
    /// If chunked encoded this will represent the total received size (ignoring the chunk headers)
    /// If is not chunked encoded and Content-Length is not provided this will be unknown
    pub body_size: http::BodySize,

    /// This is url + proxy memory buffer and is owned by FetchTasklet
    /// We always clone url and proxy (if informed)
    pub url_proxy_buffer: Box<[u8]>,

    // PORT NOTE: WebCore::AbortSignal is C++-refcounted (intrusive). Model as
    // raw ptr like Zig's `?*AbortSignal`; ref/unref via `bun_jsc::AbortSignal`
    // methods (see clear_abort_signal / queue).
    pub signal: Option<*mut AbortSignal>,
    pub signals: Signals,
    pub signal_store: http::signals::Store,
    pub has_schedule_callback: AtomicBool,

    // must be stored because AbortSignal stores reason weakly
    pub abort_reason: StrongOptional,

    // custom checkServerIdentity
    pub check_server_identity: StrongOptional,
    pub reject_unauthorized: bool,
    pub upgraded_connection: bool,
    // Custom Hostname
    pub hostname: Option<Box<[u8]>>,
    pub is_waiting_body: bool,
    pub is_waiting_abort: bool,
    pub is_waiting_request_stream_start: bool,
    pub mutex: Mutex,

    pub tracker: AsyncTaskTracker,

    pub ref_count: bun_ptr::ThreadSafeRefCount<FetchTasklet>,
}

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

    /// Enqueue a concurrent task on the JS-thread event loop.
    ///
    /// Centralises the `(*vm.event_loop()).enqueue_task_concurrent(..)` raw
    /// deref. `event_loop()` returns a self-ptr into the VirtualMachine that
    /// is valid for the VM's lifetime; `enqueue_task_concurrent` takes `&self`
    /// and is thread-safe (lock-free MPSC push).
    #[inline]
    fn enqueue_concurrent(vm: &VirtualMachine, task: *mut ConcurrentTask) {
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

    pub fn ref_(&self) {
        // SAFETY: `self` is live; `ref_` only touches the interior-mutable
        // atomic counter.
        unsafe { bun_ptr::ThreadSafeRefCount::<Self>::ref_(core::ptr::from_ref(self).cast_mut()) };
    }

    pub fn deref(this: *mut FetchTasklet) {
        // SAFETY: caller holds a ref; `this` is a live heap allocation from `get()`.
        unsafe { bun_ptr::ThreadSafeRefCount::<Self>::deref(this) };
    }

    pub fn deref_from_thread(this: *mut FetchTasklet) {
        // SAFETY: caller holds a ref; `this` is a live heap allocation from `get()`.
        if !unsafe { bun_ptr::ThreadSafeRefCount::<Self>::release(this) } {
            return;
        }
        let self_ = Self::from_raw_ref(this);
        if self_.javascript_vm.is_shutting_down() {
            // SAFETY: last ref; exclusive access
            unsafe { FetchTasklet::deinit(this) };
            return;
        }
        // this is really unlikely to happen, but can happen
        // lets make sure that we always call deinit from main thread
        Self::enqueue_concurrent(
            self_.javascript_vm,
            ConcurrentTask::from_callback(this, FetchTasklet::deinit_callback),
        );
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
        if let Some(sink) = self.sink.take() {
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
            unsafe {
                (*buffer.as_ptr()).clear_drain_callback();
                ThreadSafeStreamBuffer::deref(buffer.as_ptr());
            }
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

        if let Some(certificate) = self.result.certificate_info.take() {
            drop(certificate); // TODO(port): CertificateInfo::deinit(allocator) -> Drop
        }

        // PORT NOTE: Zig `entries.deinit()` + `buf.deinit()`; Rust drop on
        // assignment runs the same cleanup. MultiArrayList has no `clear()`.
        self.request_headers = Headers::default();

        if let Some(http_) = self.http.as_mut() {
            http_.clear_data();
        }

        if let Some(metadata) = self.metadata.take() {
            drop(metadata); // TODO(port): HTTPResponseMetadata::deinit(allocator) -> Drop
        }

        self.response_buffer = MutableString::default();
        self.response.clear();
        if let Some(response) = self.native_response.take() {
            Response::unref(response);
        }

        self.clear_stream_cancel_handler();
        self.readable_stream_ref.deinit();

        self.scheduled_response_buffer = MutableString::default();
        // Always detach request_body regardless of type.
        // When request_body is a ReadableStream, startRequestStream() creates
        // an independent Strong reference in ResumableSink, so FetchTasklet's
        // reference becomes redundant and must be released to avoid leaks.
        self.request_body.detach();

        self.abort_reason.deinit();
        self.check_server_identity.deinit();
        self.clear_abort_signal();
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

    pub fn start_request_stream(&mut self) {
        self.is_waiting_request_stream_start = false;
        debug_assert!(matches!(
            self.request_body,
            HTTPRequestBody::ReadableStream(_)
        ));
        let HTTPRequestBody::ReadableStream(ref stream_ref) = self.request_body else {
            return;
        };
        if let Some(stream) = stream_ref.get(&self.global_this) {
            if self.signal_aborted() {
                stream.abort(&self.global_this);
                return;
            }

            let global_this = self.global_this;
            self.ref_(); // lets only unref when sink is done
            // +1 because the task refs the sink
            let sink =
                ResumableSink::init_exact_refs(&global_this, stream, std::ptr::from_mut(self), 2);
            self.sink = Some(sink);
        }
    }

    pub fn on_body_received(&mut self) -> JsTerminatedResult<()> {
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
        // PORT NOTE: Zig `defer { if (buffer_reset) ...reset() }` runs on `try` failure paths too.
        // Capture a raw ptr so the defer can reset on every exit (incl. `?`) without holding a
        // long-lived &mut borrow of self.
        let scheduled_buf: *mut MutableString = &raw mut self.scheduled_response_buffer;
        scopeguard::defer! {
            if buffer_reset.get() {
                // SAFETY: `self` outlives this defer (it's a local in this fn) and no other
                // borrow of scheduled_response_buffer is live at scope exit / `?` unwind.
                unsafe { (*scheduled_buf).reset() };
            }
        }

        if !success {
            // Zig: `var need_deinit = true; defer if (need_deinit) err.deinit();` — `ValueError`
            // has no `Drop` (it's reset-in-place, see Body.rs), so the Strong installed by
            // `to_js` would leak on the sink-cancel / no-response / `?` exits. Hold it in a
            // scopeguard and defuse via `into_inner` when ownership is transferred to
            // `to_error_instance` (the `need_deinit = false` arm).
            let mut err = scopeguard::guard(self.on_reject(), |mut e| e.reset());
            let mut js_err = JSValue::ZERO;
            // if we are streaming update with error
            if let Some(readable) = self.readable_stream_ref.get(&global_this) {
                if let Some(bytes) = readable.ptr.bytes() {
                    js_err = err.to_js(&global_this);
                    js_err.ensure_still_alive();
                    bytes.on_data(StreamResult::Err(StreamError::JSValue(js_err)))?;
                }
            }
            if let Some(sink) = self.sink_mut() {
                if js_err.is_empty() {
                    js_err = err.to_js(&global_this);
                    js_err.ensure_still_alive();
                }
                sink.cancel(js_err);
                return Ok(());
            }
            // if we are buffering resolve the promise
            if let Some(response) = self.current_response_mut() {
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

        if let Some(readable) = self.readable_stream_ref.get(&global_this) {
            bun_output::scoped_log!(FetchTasklet, "onBodyReceived readable_stream_ref");
            if let Some(bytes) = readable.ptr.bytes() {
                bytes.size_hint.set(self.get_size_hint());
                // body can be marked as used but we still need to pipe the data
                if self.result.has_more {
                    let chunk = self.scheduled_response_buffer.list.as_slice();
                    bytes.on_data(Self::temporary_chunk(chunk, false))?;
                } else {
                    self.clear_stream_cancel_handler();
                    let prev = core::mem::take(&mut self.readable_stream_ref);
                    buffer_reset.set(false);

                    let chunk = self.scheduled_response_buffer.list.as_slice();
                    bytes.on_data(Self::temporary_chunk(chunk, true))?;
                    drop(prev);
                }
                return Ok(());
            }
        }

        if let Some(response) = self.current_response_mut() {
            bun_output::scoped_log!(FetchTasklet, "onBodyReceived Current Response");
            let size_hint = self.get_size_hint();
            response.set_size_hint(size_hint);
            if let Some(readable) = response.get_body_readable_stream(&global_this) {
                bun_output::scoped_log!(
                    FetchTasklet,
                    "onBodyReceived CurrentResponse BodyReadableStream"
                );
                if let Some(bytes) = readable.ptr.bytes() {
                    let chunk = self.scheduled_response_buffer.list.as_slice();

                    if self.result.has_more {
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
            if !self.result.has_more {
                let scheduled_response_buffer =
                    core::mem::take(&mut self.scheduled_response_buffer.list);
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

                self.scheduled_response_buffer = MutableString::default();

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
                    BodyValue::resolve(&mut old, unsafe { &mut *body }, &self.global_this, headers)
                        .map_err(|_| bun_jsc::JsTerminated::JSTerminated)?;
                }
            }
        }
        Ok(())
    }

    pub fn on_progress_update(&mut self) -> JsTerminatedResult<()> {
        jsc::mark_binding!();
        bun_output::scoped_log!(FetchTasklet, "onProgressUpdate");
        self.mutex.lock();
        self.has_schedule_callback.store(false, Ordering::Relaxed);
        let is_done = !self.result.has_more;

        let vm = self.javascript_vm;
        // vm is shutting down we cannot touch JS
        if vm.is_shutting_down() {
            self.mutex.unlock();
            if is_done {
                FetchTasklet::deref(std::ptr::from_mut(self));
            }
            return Ok(());
        }

        let global_this = self.global_this;
        // PORT NOTE: reshaped for borrowck — Zig defer block split into explicit cleanup at each return
        let cleanup = |this: &mut FetchTasklet| {
            this.mutex.unlock();
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
                if let Some(sink) = this.sink_mut() {
                    sink.cancel(JSValue::UNDEFINED);
                }
                let mut poll_ref = core::mem::take(&mut this.poll_ref);
                let _ = vm;
                poll_ref.unref(bun_io::js_vm_ctx());
                FetchTasklet::deref(std::ptr::from_mut(this));
            }
        };

        if self.is_waiting_request_stream_start && self.result.can_stream {
            // start streaming
            self.start_request_stream();
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

        if let Some(certificate_info) = self.result.certificate_info.take() {
            // we receive some error
            if self.reject_unauthorized && !self.check_server_identity(&certificate_info) {
                bun_output::scoped_log!(FetchTasklet, "onProgressUpdate: aborted due certError");
                drop(certificate_info);
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
            // checkServerIdentity passed. Fall through to resolve/reject below.
            //
            // We can reach this point with `metadata == null` when the
            // connection failed after the TLS handshake but before response
            // headers arrived (e.g. an mTLS server closing the socket because
            // the client didn't present a certificate) — the certificate_info
            // from the first progress update is coalesced into the later
            // failure result. The `metadata == null && isSuccess()` case is
            // already handled by the early return above, so the fall-through
            // here always has either metadata to resolve with or a failure to
            // reject with.
        }

        // Intentionally diverges from Zig (paired with the microtask drain after
        // startRequestStream above): the request-body sink may have set `abort_reason`
        // via writeEndRequest while the HTTP result is still a success — server HEADERS
        // raced ahead of the scheduled shutdown. Reject with that reason instead of
        // resolving a 200 Response. Makes wpt-h2 number-chunk test deterministic.
        if self.result.is_success() && self.abort_reason.has() {
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
        // defer block:
        let dispatch_cleanup = |this: &mut FetchTasklet| {
            bun_output::scoped_log!(FetchTasklet, "onProgressUpdate: promise_value is not null");
            tracker.did_dispatch(&global_this);
            this.promise = jsc::JSPromiseStrong::empty();
        };

        let success = self.result.is_success();
        let result = if success {
            StrongOptional::create(self.on_resolve(), &global_this)
        } else {
            // in this case we wanna a jsc.Strong.Optional so we just convert it
            let mut value = self.on_reject();
            let err_js = value.to_js(&global_this);
            if let Some(sink) = self.sink_mut() {
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
            promise: self.promise.take(),
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

        dispatch_cleanup(self);
        cleanup(self);
        Ok(())
    }

    pub fn check_server_identity(&mut self, certificate_info: &CertificateInfo) -> bool {
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
                            self.is_waiting_abort = self.result.has_more;
                            self.abort_reason.set(&global_object, check_result);
                            self.signal_store.aborted.store(true, Ordering::Relaxed);
                            self.tracker.did_cancel(&self.global_this);
                            // we need to abort the request
                            if let Some(http_) = self.http.as_mut() {
                                http::http_thread().schedule_shutdown(http_);
                            }
                            self.result.fail = Some(err!("ERR_TLS_CERT_ALTNAME_INVALID"));
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
                            self.is_waiting_abort = self.result.has_more;
                            self.abort_reason.set(&global_object, hostname_err_result);
                            self.signal_store.aborted.store(true, Ordering::Relaxed);
                            self.tracker.did_cancel(&self.global_this);
                            if let Some(http_) = self.http.as_mut() {
                                http::http_thread().schedule_shutdown(http_);
                            }
                            self.result.fail = Some(err!("ERR_TLS_CERT_ALTNAME_INVALID"));
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
                        self.signal_store.aborted.store(true, Ordering::Relaxed);
                        self.tracker.did_cancel(&self.global_this);

                        // we need to abort the request
                        if let Some(http_) = self.http.as_mut() {
                            http::http_thread().schedule_shutdown(http_);
                        }
                        self.result.fail = Some(err!("ERR_TLS_CERT_ALTNAME_INVALID"));
                        return false;
                    }

                    // > On success, returns <undefined>
                    // We treat any non-error value as a success.
                    return true;
                }
            }
        }
        self.result.fail = Some(err!("ERR_TLS_CERT_ALTNAME_INVALID"));
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
                // PORT NOTE: `AbortReason::to_body_value_error` lives in bun_jsc but
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
        // `signal` is a live C++-owned WebCore::AbortSignal*; we hold one ref
        // (taken in `fetch.zig` before populating FetchOptions). Order matches Zig
        // `clearAbortSignal`: cleanNativeBindings first, then defer{unref+pendingUnref}.
        // S008: `AbortSignal` is an `opaque_ffi!` ZST — safe `*const → &`.
        let signal = bun_opaque::opaque_deref(signal);
        signal.clean_native_bindings(std::ptr::from_mut(self).cast::<c_void>());
        signal.pending_activity_unref();
        signal.unref();
    }

    pub fn on_reject(&mut self) -> BodyValueError {
        debug_assert!(self.result.fail.is_some());
        bun_output::scoped_log!(FetchTasklet, "onReject");

        if let Some(err) = self.get_abort_error() {
            return err;
        }

        if let Some(reason) = self.result.abort_reason() {
            return BodyValueError::AbortReason(reason);
        }

        let fail = self.result.fail.unwrap();

        // Fetch-spec "network error" cases that callers feature-detect via
        // `instanceof TypeError`. Keep this list narrow; the catch-all
        // SystemError below is still a plain Error for backwards compat.
        if fail == err!("RequestBodyNotReusable") {
            return BodyValueError::TypeError(BunString::static_(
                "Request body is a ReadableStream and cannot be replayed for this redirect",
            ));
        }

        // some times we don't have metadata so we also check http.url
        let path = if let Some(metadata) = &self.metadata {
            BunString::clone_utf8(metadata.url.slice())
        } else if let Some(http_) = &self.http {
            BunString::clone_utf8(http_.url.href.as_ref())
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

    pub fn on_readable_stream_available(
        ctx: *mut c_void,
        global_this: &JSGlobalObject,
        readable: ReadableStream,
    ) {
        let this = Self::from_ctx(ctx);
        this.readable_stream_ref = ReadableStreamStrong::init(readable, global_this);
    }

    pub fn on_start_streaming_http_response_body_callback(ctx: *mut c_void) -> DrainResult {
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

        this.mutex.lock();
        // PORT NOTE: Zig `defer this.mutex.unlock()` — reshaped to explicit unlock at each return
        // (no `?` paths between lock and unlock, so a guard is unnecessary).
        let size_hint = this.get_size_hint();

        // This means we have received part of the body but not the whole thing
        if !this.scheduled_response_buffer.list.is_empty() {
            let scheduled_response_buffer = core::mem::take(&mut this.scheduled_response_buffer);
            this.mutex.unlock();

            return DrainResult::Owned {
                list: scheduled_response_buffer.list,
                size_hint: size_hint as usize,
            };
        }

        this.mutex.unlock();
        DrainResult::EstimatedSize(size_hint as usize)
    }

    fn get_size_hint(&self) -> BlobSizeType {
        match self.body_size {
            http::BodySize::ContentLength(n) => n as BlobSizeType,
            http::BodySize::TotalReceived(n) => n as BlobSizeType,
            http::BodySize::Unknown => 0,
        }
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

    fn on_stream_cancelled_callback(ctx: Option<*mut c_void>) {
        let this = Self::from_ctx(ctx.expect("ctx"));
        if this.ignore_data {
            return;
        }
        this.ignore_remaining_response_body();
    }

    fn to_body_value(&mut self) -> BodyValue {
        if let Some(err) = self.get_abort_error() {
            return BodyValue::Error(err);
        }
        if self.is_waiting_body {
            let mut pending = body::PendingValue::new(&self.global_this);
            pending.size_hint = self.get_size_hint();
            pending.task = Some(std::ptr::from_mut(self).cast::<c_void>());
            pending.on_start_streaming =
                Some(FetchTasklet::on_start_streaming_http_response_body_callback);
            pending.on_readable_stream_available = Some(FetchTasklet::on_readable_stream_available);
            pending.on_stream_cancelled = Some(FetchTasklet::on_stream_cancelled_callback);
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

    fn to_response(&mut self) -> Response {
        bun_output::scoped_log!(FetchTasklet, "toResponse");
        debug_assert!(self.metadata.is_some());
        // at this point we always should have metadata
        let metadata = self.metadata.as_ref().unwrap();
        let http_response = &metadata.response;
        self.is_waiting_body = self.result.has_more;
        // PORT NOTE: reshaped for borrowck — capture metadata fields before to_body_value() takes &mut self
        let headers = FetchHeaders::create_from_pico_headers(http_response.headers.list);
        let status_code = http_response.status_code as u16;
        // status_text and url must NOT be atomized: the Response can be
        // destroyed from the HTTP thread via deref_from_thread() -> deinit()
        // when the VM is shutting down (see is_shutting_down() branch), and
        // atom strings live in a per-thread table — deref'ing them off-thread
        // trips the `wasRemoved` RELEASE_ASSERT in AtomStringImpl::remove().
        // Plain WTFStringImpl refcounts are atomic, so clone_utf8 is safe.
        let status_text = BunString::clone_utf8(&http_response.status);
        let url = BunString::clone_utf8(metadata.url.slice());
        let redirected = self.result.redirected;
        Response::init(
            crate::webcore::response::Init {
                // SAFETY: create_from_pico_headers returns a fresh refcount=1 FetchHeaders*.
                headers: Some(unsafe { HeadersRef::adopt(headers) }),
                status_code,
                status_text: status_text.into(),
                ..Default::default()
            },
            Body::new(self.to_body_value()),
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
        if let Some(sink) = self.sink_mut() {
            sink.detach_js();
        }
        // enabling streaming will make the http thread to drain into the main thread (aka stop buffering)
        // without a stream ref, response body or response instance alive it will just ignore the result
        if let Some(http_) = self.http.as_mut() {
            http_.enable_response_body_streaming();
        }
        // we should not keep the process alive if we are ignoring the body
        let _ = self.javascript_vm;
        self.poll_ref.unref(bun_io::js_vm_ctx());
        // clean any remaining references
        self.clear_stream_cancel_handler();
        self.readable_stream_ref.deinit();
        self.response.clear();

        if let Some(response) = self.native_response.take() {
            Response::unref(response);
        }

        self.ignore_data = true;
    }

    pub fn on_resolve(&mut self) -> JSValue {
        bun_output::scoped_log!(FetchTasklet, "onResolve");
        let response = bun_core::heap::into_raw(Box::new(self.to_response()));
        // SAFETY: response is a freshly allocated Response; makeMaybePooled takes ownership semantics on the JS side
        let global_this = self.global_this;
        let response_js = Response::make_maybe_pooled(&global_this, response);
        response_js.ensure_still_alive();
        self.response = jsc::Weak::<FetchTasklet>::create(
            response_js,
            &global_this,
            jsc::WeakRefType::FetchResponse,
            self,
        );
        // Response is intrusively refcounted; bump for native_response.
        self.native_response = Some(Response::ref_(response));
        response_js
    }

    pub fn get(
        global_this: &JSGlobalObject,
        fetch_options: FetchOptions,
        promise: jsc::JSPromiseStrong,
    ) -> Result<*mut FetchTasklet, BunError> {
        // TODO(port): narrow error set
        // SAFETY: bun_vm() returns the FFI `*mut VirtualMachine`; the VM outlives
        // this tasklet (process-lifetime singleton on the JS thread).
        let jsc_vm: &'static VirtualMachine = global_this.bun_vm();
        let mut fetch_tasklet = Box::new(FetchTasklet {
            sink: None,
            // PORT NOTE: Zig used `bun.new(AsyncHTTP, undefined)` then `init()` below.
            // Rust `AsyncHTTP` has no `Default`/zero-init; defer the Box until
            // `AsyncHTTP::init` produces the value.
            http: None,
            result: HTTPClientResult::default(),
            metadata: None,
            javascript_vm: jsc_vm,
            global_this: GlobalRef::from(global_this),
            request_body: fetch_options.body, // TODO(port): move semantics; FetchOptions consumed
            request_body_streaming_buffer: None,
            response_buffer: MutableString::default(),
            scheduled_response_buffer: MutableString::default(),
            response: jsc::Weak::default(),
            native_response: None,
            ignore_data: false,
            readable_stream_ref: ReadableStreamStrong::default(),
            request_headers: fetch_options.headers,
            promise,
            concurrent_task: ConcurrentTask::default(),
            poll_ref: KeepAlive::default(),
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
            hostname: fetch_options.hostname,
            is_waiting_body: false,
            is_waiting_abort: false,
            is_waiting_request_stream_start: false,
            mutex: Mutex::new(),
            // SAFETY: jsc_vm derived from FFI ptr above; AsyncTaskTracker::init only
            // bumps a counter on the VM.
            tracker: AsyncTaskTracker::init(global_this.bun_vm().as_mut()),
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
        });

        fetch_tasklet.signals = fetch_tasklet.signal_store.to();

        fetch_tasklet.tracker.did_schedule(global_this);

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
                    url = ZigURL::parse(unsafe { &(&*buf_ptr)[0..old_url_len] });
                    proxy = Some(ZigURL::parse(unsafe { &(&*buf_ptr)[old_url_len..] }));
                    // TODO(port): self-referential borrow into url_proxy_buffer; Phase B needs raw ptr or owned URL
                } else {
                    proxy = Some(env_proxy);
                }
            }
        }

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
        let request_body_slice: &'static [u8] =
            unsafe { bun_ptr::Interned::assume(fetch_tasklet.request_body.slice()) }.as_bytes();
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
            http::HTTPClientResultCallback::new::<FetchTasklet>(
                fetch_tasklet_ptr,
                FetchTasklet::callback,
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
                reject_unauthorized: Some(fetch_options.reject_unauthorized),
                verbose: Some(fetch_options.verbose),
                tls_props: fetch_options.ssl_config,
            },
        )));
        // enable streaming the write side
        let is_stream = matches!(
            fetch_tasklet.request_body,
            HTTPRequestBody::ReadableStream(_)
        );
        let http_client = fetch_tasklet.http.as_mut().unwrap();
        http_client.client.flags.is_streaming_request_body = is_stream;
        http_client.client.flags.force_http2 = fetch_options.force_http2;
        http_client.client.flags.force_http3 = fetch_options.force_http3;
        http_client.client.flags.force_http1 = fetch_options.force_http1;
        fetch_tasklet.is_waiting_request_stream_start = is_stream;
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

        if let HTTPRequestBody::Sendfile(sendfile) = &fetch_tasklet.request_body {
            debug_assert!(url_is_http);
            debug_assert!(fetch_options.proxy.is_none());
            fetch_tasklet.http.as_mut().unwrap().request_body =
                http::HTTPRequestBody::Sendfile(*sendfile);
        }

        if let Some(signal) = fetch_tasklet.signal {
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
    pub fn abort_listener(&mut self, reason: JSValue) {
        bun_output::scoped_log!(FetchTasklet, "abortListener");
        let this = self;
        reason.ensure_still_alive();
        this.abort_reason.set(&this.global_this, reason);
        this.abort_task();
        if let Some(sink) = this.sink_mut() {
            sink.cancel(reason);
            return;
        }
        // Abort fired before the HTTP thread asked for the body, so the
        // ReadableStream was never wired into a sink. Cancel it directly so
        // the underlying source's cancel(reason) callback still observes the
        // signal's reason (https://fetch.spec.whatwg.org/#abort-fetch step 5).
        if this.is_waiting_request_stream_start {
            if let HTTPRequestBody::ReadableStream(stream_ref) = &this.request_body {
                this.is_waiting_request_stream_start = false;
                if let Some(stream) = stream_ref.get(&this.global_this) {
                    stream.cancel_with_reason(&this.global_this, reason);
                }
            }
        }
    }

    /// This is ALWAYS called from the http thread and we cannot touch the buffer here because is locked
    pub fn on_write_request_data_drain(this: *mut FetchTasklet) {
        let this_ref = Self::from_raw_ref(this);
        if this_ref.javascript_vm.is_shutting_down() {
            return;
        }
        // ref until the main thread callback is called
        this_ref.ref_();
        Self::enqueue_concurrent(
            this_ref.javascript_vm,
            ConcurrentTask::from_callback(this, FetchTasklet::resume_request_data_stream),
        );
    }

    /// This is ALWAYS called from the main thread
    // PORT NOTE: in Zig 'fn (*FetchTasklet) error{}!void' coerces to 'fn (*FetchTasklet) bun.JSError!void';
    // ConcurrentTask::from_callback expects `fn(*mut T) -> bun_event_loop::JsResult<()>`.
    pub fn resume_request_data_stream(this: *mut FetchTasklet) -> ElJsResult<()> {
        let this_ref = Self::from_raw_mut(this);
        bun_output::scoped_log!(FetchTasklet, "resumeRequestDataStream");
        let result = (|| {
            if this_ref.signal_aborted() {
                // already aborted; nothing to drain
                return;
            }
            if let Some(sink) = this_ref.sink_mut() {
                sink.drain();
            }
        })();
        // deref when done because we ref inside onWriteRequestDataDrain
        FetchTasklet::deref(this);
        let () = result;
        Ok(())
    }

    /// Whether the request body should skip chunked transfer encoding framing.
    /// True for upgraded connections (e.g. WebSocket) or when the user explicitly
    /// set Content-Length without setting Transfer-Encoding.
    fn skip_chunked_framing(&self) -> bool {
        self.upgraded_connection
            || self.result.is_http2
            || (self.request_headers.get(b"content-length").is_some()
                && self.request_headers.get(b"transfer-encoding").is_none())
    }

    pub fn write_request_data(&mut self, data: &[u8]) -> ResumableSinkBackpressure {
        bun_output::scoped_log!(FetchTasklet, "writeRequestData {}", data.len());
        if self.signal_aborted() {
            return ResumableSinkBackpressure::Done;
        }
        // PORT NOTE: reshaped for borrowck — read sink HWM (Copy) before
        // borrowing the stream buffer so `self` is unborrowed during the
        // mutex critical section below.
        let high_water_mark: usize = match self.sink_mut() {
            Some(sink) => sink.high_water_mark() as usize,
            None => 16384,
        };
        let Some(thread_safe_stream_buffer) = self.stream_buffer_mut() else {
            return ResumableSinkBackpressure::Done;
        };
        // Mutex guards `buffer` against the HTTP thread; released when
        // `stream_buffer` drops. Borrow is detached from `self` (see accessor).
        let mut stream_buffer = thread_safe_stream_buffer.lock();

        let mut needs_schedule = false;

        // dont have backpressure so we will schedule the data to be written
        // if we have backpressure the onWritable will drain the buffer
        needs_schedule = stream_buffer.is_empty();
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

    pub fn write_end_request(&mut self, err: Option<JSValue>) {
        bun_output::scoped_log!(FetchTasklet, "writeEndRequest hasError? {}", err.is_some());
        let this_ptr = std::ptr::from_mut(self);
        if let Some(js_error) = err {
            if self.signal_store.aborted.load(Ordering::Relaxed) || self.abort_reason.has() {
                FetchTasklet::deref(this_ptr);
                return;
            }
            if !js_error.is_undefined_or_null() {
                self.abort_reason.set(&self.global_this, js_error);
            }
            self.abort_task();
        } else {
            if !self.skip_chunked_framing() {
                // Using chunked transfer encoding, send the terminating chunk
                let Some(thread_safe_stream_buffer) = self.stream_buffer_mut() else {
                    FetchTasklet::deref(this_ptr);
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
        FetchTasklet::deref(this_ptr);
    }

    pub fn abort_task(&mut self) {
        self.signal_store.aborted.store(true, Ordering::Relaxed);
        self.tracker.did_cancel(&self.global_this);

        if let Some(http_) = self.http.as_mut() {
            http::http_thread().schedule_shutdown(http_);
        }
    }

    pub fn queue(
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
        node_ref.poll_ref.ref_(bun_io::js_vm_ctx());

        // increment ref so we can keep it alive until the http client is done
        node_ref.ref_();
        http::HTTPThread::schedule(batch);

        Ok(node)
    }

    /// Called from HTTP thread. Handles HTTP events received from socket.
    pub fn callback(
        task: *mut FetchTasklet,
        async_http: *mut AsyncHTTP<'static>,
        result: HTTPClientResult,
    ) {
        // at this point only this thread is accessing result to is no race condition
        let is_done = !result.has_more;
        let task_ref = Self::from_raw_mut(task);

        task_ref.mutex.lock();
        // we need to unlock before task.deref();
        // PORT NOTE: reshaped for borrowck — explicit unlock + deref at end instead of nested defers
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
            task_ref.ignore_data,
            result.has_more,
            result.body.as_ref().map(|b| b.list.len()).unwrap_or(0)
        );

        // Zig: `task.response_buffer = result.body.?.*` — verify the aliasing invariant
        // that makes that bitwise copy a no-op (see PORT NOTE below at the original site).
        debug_assert!(
            result.body.as_deref().map_or(true, |b| core::ptr::eq(
                b,
                &raw const task_ref.response_buffer
            )),
            "HTTPClientResult.body must alias FetchTasklet.response_buffer",
        );

        let prev_metadata = task_ref.result.metadata.take();
        let prev_cert_info = task_ref.result.certificate_info.take();
        let prev_can_stream = task_ref.result.can_stream;
        // SAFETY: lifetime erasure — `HTTPClientResult<'a>` borrows the
        // `*mut MutableString` we passed into `AsyncHTTP::init` (which lives
        // in `self.response_buffer` for the FetchTasklet's lifetime). Zig had
        // no lifetime here; widen `'_` → `'static` to store it.
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
        // PORT NOTE: Zig `task.response_buffer = result.body.?.*` is a bitwise self-copy of
        // the Vec header — `result.body` always aliases `task_ref.response_buffer` (the
        // `*mut MutableString` passed to `AsyncHTTP::init` at FetchTasklet::create flows
        // through `HTTPClient.state.body_out_str` and back out in the result). Asserted
        // above before the lifetime-erasing assignment; the bytes are already in place, so
        // no copy is needed and the `reset()` calls below operate on the right allocation.

        if task_ref.ignore_data {
            task_ref.response_buffer.reset();

            if task_ref.scheduled_response_buffer.list.capacity() > 0 {
                task_ref.scheduled_response_buffer = MutableString::default();
            }
            if success && task_ref.result.has_more {
                // we are ignoring the body so we should not receive more data, so will only signal when result.has_more = true
                task_ref.mutex.unlock();
                if is_done {
                    FetchTasklet::deref_from_thread(task);
                }
                return;
            }
        } else {
            if success {
                bun_core::handle_oom(
                    task_ref
                        .scheduled_response_buffer
                        .write(task_ref.response_buffer.list.as_slice()),
                );
            }
            // reset for reuse
            task_ref.response_buffer.reset();
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
                    FetchTasklet::deref_from_thread(task);
                }
                return;
            }
        }
        // will deinit when done with the http client (when is_done = true)
        if task_ref.javascript_vm.is_shutting_down() {
            task_ref.mutex.unlock();
            if is_done {
                FetchTasklet::deref_from_thread(task);
            }
            return;
        }
        let ct = task_ref
            .concurrent_task
            .from(task, AutoDeinit::ManualDeinit);
        Self::enqueue_concurrent(task_ref.javascript_vm, ct);

        task_ref.mutex.unlock();
        // we are done with the http client so we can deref our side
        // this is a atomic operation and will enqueue a task to deinit on the main thread
        if is_done {
            FetchTasklet::deref_from_thread(task);
        }
    }
}

impl FetchTasklet {
    #[bun_uws::uws_callback(export = "Bun__FetchResponse_finalize", no_catch)]
    pub fn on_response_finalize(&mut self) {
        bun_output::scoped_log!(FetchTasklet, "onResponseFinalize");
        let this = self;
        if let Some(response) = this.native_response {
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
            if !matches!(body, BodyValue::Locked(_)) || this.readable_stream_ref.has() {
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
        }
    }
}

// ported from: src/runtime/webcore/fetch/FetchTasklet.zig
