use core::sync::atomic::Ordering;

use bun_core::MutableString;
use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_event_loop::{BoxedTask, TaskTag, Taskable, task_tag};
use bun_http::async_http::Options as HttpOptions;
use bun_http::{
    AsyncHTTP, FetchRedirect, HTTPClientResult, HTTPClientResultCallback, Headers, Method,
};
use bun_io::JsKeepAlive;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_ptr::RefPtr;
use bun_s3_signing::acl::ACL;
use bun_s3_signing::credentials::{S3Credentials, SignOptions, SignResult};
use bun_s3_signing::error::{ErrorCodeAndMessage, S3Error, get_sign_error_code_and_message};
use bun_s3_signing::storage_class::StorageClass;
use bun_s3_signing::upload::{NO_UPLOAD_ID, Request};
use bun_url::URL;

use crate::webcore::s3::multipart::NetworkSink;
use crate::webcore::s3::{list_objects, xml_response};

// The result/options structs below carry borrowed slices that are valid only for the
// duration of the callback invocation (not owned; they must be copied if used
// after the callback). They take an explicit `<'a>` because they are ephemeral stack-only
// callback payloads (never heap-stored) — the borrow lifetime accurately models ownership.

#[derive(Default)]
pub(crate) struct S3StatSuccess<'a> {
    pub(crate) size: usize,
    /// etag is not owned and need to be copied if used after this callback
    pub(crate) etag: &'a [u8],
    /// format: Mon, 06 Jan 2025 22:40:57 GMT, lastModified is not owned and need to be copied if used after this callback
    pub(crate) last_modified: &'a [u8],
    /// format: text/plain, contentType is not owned and need to be copied if used after this callback
    pub(crate) content_type: &'a [u8],
}

pub(crate) enum S3StatResult<'a> {
    Success(S3StatSuccess<'a>),
    NotFound(S3Error<'a>),
    /// failure error is not owned and need to be copied if used after this callback
    Failure(S3Error<'a>),
}

pub(crate) struct S3DownloadSuccess {
    /// body is owned and dont need to be copied, but dont forget to free it
    pub(crate) body: MutableString,
}

pub(crate) enum S3DownloadResult<'a> {
    Success(S3DownloadSuccess),
    NotFound(S3Error<'a>),
    /// failure error is not owned and need to be copied if used after this callback
    Failure(S3Error<'a>),
}

pub(crate) enum S3UploadResult<'a> {
    Success,
    /// failure error is not owned and need to be copied if used after this callback
    Failure(S3Error<'a>),
}

pub(crate) enum S3DeleteResult<'a> {
    Success,
    NotFound(S3Error<'a>),
    /// failure error is not owned and need to be copied if used after this callback
    Failure(S3Error<'a>),
}

pub(crate) enum S3ListObjectsResult<'a> {
    Success(Box<list_objects::S3ListObjectsV2Result>),
    NotFound(S3Error<'a>),
    /// failure error is not owned and need to be copied if used after this callback
    Failure(S3Error<'a>),
}

pub(crate) struct S3HttpSimpleTask {
    pub(crate) async_http_id: u32,
    /// Held while the request is out on the HTTP thread: how it delivers the
    /// response, and what makes the VM wait for it.
    pub(crate) http_ticket: Option<bun_jsc::Ticket>,
    pub(crate) sign_result: SignResult,
    pub(crate) headers: Headers,
    /// Taken by `on_response`.
    pub callback: Option<Callback>,
    pub(crate) response_buffer: MutableString,
    pub(crate) result: HTTPClientResult<'static>,
    pub(crate) concurrent_task: ConcurrentTask,
    /// The resolved proxy, empty for none. Owned: an env-derived slice can be
    /// freed by a process.env.HTTP_PROXY write while the HTTP thread is in flight.
    pub(crate) proxy_url: Box<[u8]>,
    /// A copy for the HTTP thread to read. Empty for `Callback::Sink`, which has its own.
    pub(crate) body: Box<[u8]>,
    pub(crate) _keep_alive: JsKeepAlive,
    /// The HTTP client's abort flag: set when the request's context stops so a
    /// request still queued or in flight fails promptly and comes back.
    pub(crate) signal_store: bun_http::signals::Store,
    pub(crate) abort_handle: bun_jsc::AbortHandle,
    /// The context of the script that asked (the handle forgets it when the context stops).
    pub(crate) context: bun_jsc::ContextId,
}

bun_jsc::impl_abort_handle_owner!(S3HttpSimpleTask, abort_handle, |this, _cause| {
    // SAFETY: trait contract — `this` is live (armed ⇒ its response has not
    // run).
    unsafe {
        (*this).signal_store.aborted.store(true, Ordering::Relaxed);
        bun_http::HTTPThread::schedule_shutdown((*this).async_http_id);
    }
});

impl Taskable for S3HttpSimpleTask {
    const TAG: TaskTag = task_tag::S3HttpSimpleTask;
    /// A response the HTTP thread handed back during teardown: its native
    /// completion is what finishes the caller's operation (and settles a promise
    /// nobody can observe — script is forbidden), so run it.
    unsafe fn release_unrun(this: *mut Self) {
        let _ = S3HttpSimpleTask::on_response(this);
    }
    /// `on_response` enters the request's context itself, stopped or not: a multipart upload still
    /// sends its rollback for a graph that was disposed.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

pub(crate) type OnStat = Box<dyn FnOnce(S3StatResult<'_>) -> bun_jsc::JsResult<()>>;
pub(crate) type OnDownload = Box<dyn FnOnce(S3DownloadResult<'_>) -> bun_jsc::JsResult<()>>;
pub(crate) type OnUpload = Box<dyn FnOnce(S3UploadResult<'_>) -> bun_jsc::JsResult<()>>;
pub(crate) type OnDelete = Box<dyn FnOnce(S3DeleteResult<'_>) -> bun_jsc::JsResult<()>>;
pub(crate) type OnListObjects = Box<dyn FnOnce(S3ListObjectsResult<'_>) -> bun_jsc::JsResult<()>>;

pub(crate) enum Callback {
    Stat(OnStat),
    Download(OnDownload),
    Upload(OnUpload),
    Delete(OnDelete),
    ListObjects(OnListObjects),
    /// `Request` has the body.
    Sink(RefPtr<NetworkSink>, Request),
}

/// An upload's request that was not sent, on its way to fail from the event loop.
pub(crate) struct RefusedRequest {
    callback: Callback,
    error: S3Error<'static>,
    context: bun_jsc::ContextId,
}

impl BoxedTask for RefusedRequest {
    const TAG: TaskTag = task_tag::S3RefusedRequest;
    /// As `S3HttpSimpleTask`.
    fn release_unrun(self: Box<Self>) {
        let _ = self.run();
    }
    /// As `S3HttpSimpleTask`.
    fn context(&self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl RefusedRequest {
    pub(crate) fn run(self) -> bun_jsc::JsResult<()> {
        let _context = VirtualMachine::get().enter_context(self.context);
        self.callback.fail(self.error.code, self.error.message)
    }
}

impl Callback {
    /// Fails a request that was never sent.
    fn refuse(
        self,
        context: &bun_jsc::ScriptExecutionContext,
        error: S3Error<'static>,
    ) -> bun_jsc::JsResult<()> {
        match self {
            // Nobody waits for it, and a retry would be refused too.
            Callback::Sink(_, Request::Abort(_)) => Ok(()),
            // These start inside the sink's `write` or `end`, and failing the upload can free the sink.
            Callback::Sink(..) => {
                let refused = RefusedRequest {
                    callback: self,
                    error,
                    context: context.id(),
                };
                let task = ConcurrentTask::create_boxed(Box::new(refused));
                // Not `enqueue_task`: it wakes no loop, and fails the request on arrival in teardown.
                VirtualMachine::get().ticket().post(task);
                Ok(())
            }
            Callback::Stat(_)
            | Callback::Download(_)
            | Callback::Upload(_)
            | Callback::Delete(_)
            | Callback::ListObjects(_) => self.fail(error.code, error.message),
        }
    }

    fn fail(self, code: &[u8], message: &[u8]) -> bun_jsc::JsResult<()> {
        let err = S3Error { code, message };
        match self {
            Callback::Upload(callback) => callback(S3UploadResult::Failure(err)),
            Callback::Download(callback) => callback(S3DownloadResult::Failure(err)),
            Callback::Stat(callback) => callback(S3StatResult::Failure(err)),
            Callback::Delete(callback) => callback(S3DeleteResult::Failure(err)),
            Callback::ListObjects(callback) => callback(S3ListObjectsResult::Failure(err)),
            Callback::Sink(sink, request) => NetworkSink::on_reply(&sink, request, Err(err)),
        }
    }

    fn not_found(self, code: &[u8], message: &[u8]) -> bun_jsc::JsResult<()> {
        let err = S3Error { code, message };
        match self {
            Callback::Download(callback) => callback(S3DownloadResult::NotFound(err)),
            Callback::Stat(callback) => callback(S3StatResult::NotFound(err)),
            Callback::Delete(callback) => callback(S3DeleteResult::NotFound(err)),
            Callback::ListObjects(callback) => callback(S3ListObjectsResult::NotFound(err)),
            _ => self.fail(code, message),
        }
    }
}

// `error_type` is a runtime parameter — the
// branch is on an error path, no perf concern.
#[derive(PartialEq, Eq, Clone, Copy)]
enum ErrorType {
    NotFound,
    Failure,
}

impl S3HttpSimpleTask {
    const HOLDS_TICKET: &str = "S3 request on the HTTP thread holds a ticket";

    // bun.TrivialNew(@This()) — heap-allocate; pointer crosses thread boundary via http callback
    pub(crate) fn new(init: Self) -> *mut Self {
        bun_core::heap::into_raw(Box::new(init))
    }

    fn error_with_body(&self, callback: Callback, error_type: ErrorType) -> bun_jsc::JsResult<()> {
        let mut code: &[u8] = b"UnknownError";
        let mut message: &[u8] = b"an unexpected error has occurred";
        let mut has_error_code = false;
        let parsed;
        if let Some(err) = self.result.fail {
            code = err.name().as_bytes();
            has_error_code = true;
        } else {
            let bytes = self.response_buffer.list.as_slice();
            if !bytes.is_empty() {
                message = bytes;
                parsed = xml_response::parse_error(bytes);
                if let Some(error) = &parsed {
                    if let Some(body_code) = error.code.as_deref() {
                        code = body_code;
                        has_error_code = true;
                    }
                    if let Some(body_message) = error.message.as_deref() {
                        message = body_message;
                    }
                }
            }
        }

        if error_type == ErrorType::NotFound {
            if !has_error_code {
                code = b"NoSuchKey";
                message = b"The specified key does not exist.";
            }
            callback.not_found(code, message)
        } else {
            callback.fail(code, message)
        }
    }

    /// A commit can answer 200 and still carry an `<Error>` document.
    fn response_error<'a>(
        &'a self,
        status: u32,
        parsed: Option<&'a xml_response::ErrorBody>,
    ) -> Option<S3Error<'a>> {
        if (parsed.is_none() && status == 200) || status == 206 {
            return None;
        }
        let mut code: &[u8] = b"UnknownError";
        let mut message: &[u8] = b"an unexpected error has occurred";
        let bytes = self.response_buffer.list.as_slice();
        if !bytes.is_empty() {
            message = bytes;
        }
        if let Some(error) = parsed {
            code = error.code.as_deref().unwrap_or(code);
            message = error.message.as_deref().unwrap_or(message);
        }
        Some(S3Error { code, message })
    }

    /// this is the task callback from the last task result and is always in the main thread
    ///
    /// # Safety
    /// `this` must be a live heap pointer produced by `S3HttpSimpleTask::new` whose ownership
    /// is being transferred to this call (it is reclaimed and dropped here exactly once).
    //
    // ConcurrentTask dispatch entrypoint (see `runtime::dispatch`): `this` is the raw task
    // pointer the queue hands back, non-null by the `ConcurrentTask::from` contract.
    pub(crate) fn on_response(this: *mut Self) -> bun_jsc::JsResult<()> {
        // The next request of a multipart upload, a retry, and the script this calls continue
        // what the requesting script started.
        // (In a stopped context, whatever a retry arms is aborted at once.)
        let vm = VirtualMachine::get();
        // SAFETY: fn contract — `this` is live.
        let _context = vm.enter_context(unsafe { (*this).context });
        // SAFETY: fn contract — `this` is live.
        unsafe { (*this).abort_handle.leave() };
        // SAFETY: `this` was produced by `S3HttpSimpleTask::new` (heap::alloc), and its task is
        // posted once.
        let mut this = unsafe { bun_core::heap::take(this) };

        let callback = this.callback.take().expect("a request is answered once");
        if !this.result.is_success() {
            return this.error_with_body(callback, ErrorType::Failure);
        }
        debug_assert!(this.result.metadata.is_some());
        let response = this.result.metadata.as_ref().unwrap();
        match (callback, response.status_code()) {
            (Callback::Stat(callback), 200) => callback(S3StatResult::Success(S3StatSuccess {
                etag: response.header(b"etag").unwrap_or(b""),
                last_modified: response.header(b"last-modified").unwrap_or(b""),
                content_type: response.header(b"content-type").unwrap_or(b""),
                size: response
                    .header(b"content-length")
                    .map(bun_http_types::parse_content_length)
                    .unwrap_or(0),
            })),
            (Callback::Delete(callback), 200 | 204) => callback(S3DeleteResult::Success),
            (Callback::ListObjects(callback), 200) => {
                let body = this.response_buffer.list.as_slice();
                let result = match list_objects::parse_s3_list_objects_result(body) {
                    Some(listing) => S3ListObjectsResult::Success(Box::new(listing)),
                    // Half a listing is worse than none: S3 emits keys with control characters as is.
                    None => S3ListObjectsResult::Failure(S3Error {
                        code: b"InvalidResponse",
                        message: b"ListObjectsV2 response is not a well-formed <ListBucketResult> document (if keys can contain control characters, pass encodingType: \"url\")",
                    }),
                };
                callback(result)
            }
            (Callback::Upload(callback), 200) => callback(S3UploadResult::Success),
            (Callback::Download(callback), 200 | 204 | 206) => {
                let body = core::mem::take(&mut this.response_buffer);
                callback(S3DownloadResult::Success(S3DownloadSuccess { body }))
            }
            // 404: the store no longer has the upload, which is what an abort is for.
            (Callback::Sink(sink, request @ Request::Put(_)), 200)
            | (Callback::Sink(sink, request @ Request::Abort(_)), 200 | 204 | 404) => {
                NetworkSink::on_reply(&sink, request, Ok(b""))
            }
            (Callback::Sink(sink, Request::Create), 200 | 204 | 206) => {
                let id = xml_response::parse_upload_id(&this.response_buffer.list);
                NetworkSink::on_reply(&sink, Request::Create, Ok(&id.unwrap_or_default()))
            }
            (Callback::Sink(sink, Request::Create), 404)
                if xml_response::parse_error(&this.response_buffer.list)
                    .is_none_or(|error| error.code.is_none()) =>
            {
                NetworkSink::on_reply(&sink, Request::Create, Err(NO_UPLOAD_ID))
            }
            (Callback::Sink(sink, request @ (Request::Part(..) | Request::Commit(..))), status) => {
                let parsed = xml_response::parse_error(&this.response_buffer.list);
                let etag = match request {
                    Request::Part(..) => response.header(b"etag"),
                    _ => Some(&b""[..]),
                };
                match (this.response_error(status, parsed.as_ref()), etag) {
                    (Some(err), _) => NetworkSink::on_reply(&sink, request, Err(err)),
                    (None, Some(etag)) => NetworkSink::on_reply(&sink, request, Ok(etag)),
                    (None, None) => {
                        this.error_with_body(Callback::Sink(sink, request), ErrorType::Failure)
                    }
                }
            }
            (callback @ (Callback::Upload(_) | Callback::Sink(..)), _) => {
                this.error_with_body(callback, ErrorType::Failure)
            }
            (
                callback @ (Callback::Stat(_)
                | Callback::Download(_)
                | Callback::Delete(_)
                | Callback::ListObjects(_)),
                status,
            ) => match status {
                404 => this.error_with_body(callback, ErrorType::NotFound),
                _ => this.error_with_body(callback, ErrorType::Failure),
            },
        }
    }

    fn stage_http_result(&mut self, mut result: HTTPClientResult<'_>) {
        let previous_metadata = self.result.metadata.take();
        result.body_into(&mut self.response_buffer.list);
        self.result = result.without_borrowed_body();
        if self.result.metadata.is_none() {
            self.result.metadata = previous_metadata;
        }
    }

    /// this is the AsyncHTTP callback and is always called from the HTTPThread
    ///
    /// # Safety
    /// `this` must be a live heap pointer produced by `S3HttpSimpleTask::new` and exclusively
    /// owned by the HTTP thread for the duration of this call.
    pub(crate) fn http_callback(
        this: *mut Self,
        finished: Option<bun_http::FinishedRequest>,
        result: HTTPClientResult<'_>,
    ) {
        drop(finished);
        let is_done = !result.has_more;
        // SAFETY: `this` was produced by `S3HttpSimpleTask::new` and is exclusively owned
        // by the HTTP thread until the handoff below; this borrow is scoped to the call.
        unsafe { (*this).stage_http_result(result) };
        if is_done {
            // SAFETY: same exclusivity as above; the queue takes ownership of the inline
            // `concurrent_task` field's `next` link. The ticket is moved out first: the
            // JS thread may free `this` the moment it is queued.
            unsafe {
                let ticket = (*this).http_ticket.take().expect(Self::HOLDS_TICKET);
                let queued = core::ptr::NonNull::from((*this).concurrent_task.from(this));
                ticket.post_intrusive(queued);
            }
        }
    }

    /// `HTTPClientResultCallback::release_at_shutdown`: the exiting main
    /// thread parked the HTTP thread, which will not call back; hand the
    /// request back as failed so its VM's wait ends and the JS thread frees it.
    ///
    /// # Safety
    /// `this` is the live task registered with the callback; HTTP thread parked.
    pub(crate) unsafe fn release_at_shutdown(this: *mut ()) {
        let this = this.cast::<Self>();
        // SAFETY: fn contract — nothing else touches the task now.
        unsafe {
            (*this).result.fail = Some(bun_http::Error::Aborted);
            (*this).result.has_more = false;
            let ticket = (*this).http_ticket.take().expect(Self::HOLDS_TICKET);
            let queued = core::ptr::NonNull::from((*this).concurrent_task.from(this));
            ticket.post_intrusive(queued);
        }
    }
}

pub(crate) struct Options<'a> {
    // signing options
    pub path: &'a [u8],
    pub method: Method,
    pub(crate) search_params: Option<&'a [u8]>,
    pub(crate) content_type: Option<&'a [u8]>,
    pub(crate) content_disposition: Option<&'a [u8]>,
    pub(crate) content_encoding: Option<&'a [u8]>,

    // http request options
    pub(crate) body: &'a [u8],
    /// See [`resolve_proxy`].
    pub(crate) proxy_url: Option<&'a [u8]>,
    /// Owned; ownership transfers to the spawned task (or is dropped on sign error).
    pub(crate) range: Option<Box<[u8]>>,
    pub(crate) acl: Option<ACL>,
    pub(crate) storage_class: Option<StorageClass>,
    pub(crate) request_payer: bool,
}

impl<'a> Default for Options<'a> {
    fn default() -> Self {
        Self {
            path: b"",
            method: Method::GET,
            search_params: None,
            content_type: None,
            content_disposition: None,
            content_encoding: None,
            body: b"",
            proxy_url: None,
            range: None,
            acl: None,
            storage_class: None,
            request_payer: false,
        }
    }
}

/// The proxy for a request to `url`, owned for the task's lifetime. For
/// `proxy_url`, `None` reads the environment like `fetch()` does (the variable
/// for `url`'s scheme, unless `NO_PROXY` exempts the host), `Some("")` connects
/// directly, and `Some(href)` is that proxy. JS thread only.
pub(crate) fn resolve_proxy(proxy_url: Option<&[u8]>, url: &[u8]) -> Box<[u8]> {
    match proxy_url {
        Some(href) => Box::from(href),
        None => VirtualMachine::get()
            .env_loader()
            .get_http_proxy_for(&URL::parse(url))
            .map(|proxy| Box::from(proxy.href))
            .unwrap_or_default(),
    }
}

/// What puts an S3 request on the HTTP thread asks first: this file's function and
/// `client::download_stream` before anything else, the caller of `client::list_objects` before
/// it allocates. (A `NetworkSink` asks its own abort handle first: see `send_ready`.)
pub(crate) fn nothing_new_leaves(context: &bun_jsc::ScriptExecutionContext) -> bool {
    !VirtualMachine::get().script_allowed() || context.is_stopped()
}

/// What the completion of such a request is told.
pub(crate) const NOTHING_NEW_LEAVES: S3Error<'static> = S3Error {
    code: b"ERR_S3_VM_SHUTDOWN",
    message: b"The JavaScript VM that owns this request is shutting down",
};

#[inline(never)]
pub(crate) fn execute_simple_s3_request(
    this: &S3Credentials,
    context: &bun_jsc::ScriptExecutionContext,
    options: Options<'_>,
    callback: Callback,
) -> bun_jsc::JsResult<()> {
    bun_removable_features::removable_definition!(S3Client, execute_simple_s3_request);
    // A multipart/retry continuation can reach here from teardown's queue
    // release; nothing new leaves a VM that is stopping. Nor for a context
    // that has stopped (a disposed `Bun.ModuleGraph`'s leftover script): the
    // completion is released as for a failure, which is reported to nobody.
    if nothing_new_leaves(context) {
        drop(options.range);
        return callback.refuse(context, NOTHING_NEW_LEAVES);
    }
    let result = match this.sign_request::<false>(
        &SignOptions {
            path: options.path,
            method: options.method,
            search_params: options.search_params,
            content_disposition: options.content_disposition,
            content_encoding: options.content_encoding,
            acl: options.acl,
            storage_class: options.storage_class,
            request_payer: options.request_payer,
            content_hash: None,
            content_md5: None,
            content_type: None,
        },
        None,
    ) {
        Ok(r) => r,
        Err(sign_err) => {
            // options.range drops here automatically
            drop(options.range);
            let ErrorCodeAndMessage { code, message } =
                get_sign_error_code_and_message(sign_err.into());
            return callback.refuse(context, S3Error { code, message });
        }
    };

    let headers = result.headers(options.range.as_deref(), options.content_type);

    let proxy_url = resolve_proxy(options.proxy_url, &result.url);
    let task_ptr = S3HttpSimpleTask::new(S3HttpSimpleTask {
        async_http_id: 0,
        sign_result: result,
        callback: Some(callback),
        headers,
        http_ticket: None,
        response_buffer: MutableString::default(),
        result: HTTPClientResult::default(),
        concurrent_task: ConcurrentTask::default(),
        proxy_url,
        body: Box::<[u8]>::from(options.body),
        _keep_alive: JsKeepAlive::active(),
        signal_store: Default::default(),
        abort_handle: bun_jsc::AbortHandle::for_owner::<S3HttpSimpleTask>(),
        context: Default::default(),
    });
    // SAFETY: `task_ptr` is a freshly heap-allocated pointer, and `task` is not used once
    // `task_ptr` is dereferenced. `'static`: `url`, `headers_buf`, `body` and
    // `http_proxy` borrow heap buffers that `*task` owns and never writes again. They are stored in
    // an `AsyncHTTP<'static>` that the HTTP thread reads, and remain valid until
    // `on_response` runs.
    let task: &'static mut S3HttpSimpleTask = unsafe { &mut *task_ptr };
    let url = URL::parse(&task.sign_result.url);
    let headers_buf: &'static [u8] = task.headers.buf.as_slice();
    let body: &'static [u8] = match &task.callback {
        Some(Callback::Sink(_, request)) => request.body(),
        _ => &task.body,
    };
    let http_proxy = if !task.proxy_url.is_empty() {
        Some(URL::parse(&task.proxy_url))
    } else {
        None
    };
    let vm = VirtualMachine::get();
    let verbose = vm.get_verbose_fetch();
    let reject_unauthorized = vm.get_tls_reject_unauthorized();
    let async_http = AsyncHTTP::init(
        options.method,
        url,
        task.headers.entries.clone().expect("OOM"),
        headers_buf,
        body,
        HTTPClientResultCallback::new_with_release::<S3HttpSimpleTask>(
            task_ptr,
            S3HttpSimpleTask::http_callback,
            S3HttpSimpleTask::release_at_shutdown,
        ),
        FetchRedirect::Follow,
        HttpOptions {
            http_proxy,
            verbose: Some(verbose),
            reject_unauthorized: Some(reject_unauthorized),
            tls_props: crate::socket::http_client_defaults(vm),
            signals: Some(task.signal_store.to()),
            ..Default::default()
        },
    );
    task.async_http_id = async_http.async_http_id;
    // queue http request
    bun_http::http_thread::init(&Default::default());
    // Out on the HTTP thread until its final callback: its context aborts it
    // when it stops, and the VM waits for it (the ticket).
    task.http_ticket = Some(VirtualMachine::get().ticket());
    task.context = context.id();
    // SAFETY: the task is heap-allocated and drops its handle with itself.
    unsafe { bun_jsc::AbortHandle::arm_owner(task_ptr, context) };
    bun_http::HTTPThread::schedule([async_http]);
    Ok(())
}
