use core::cell::{Cell, UnsafeCell};
use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bun_core::MutableString;
use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_event_loop::{BoxedTask, TaskTag, Taskable, task_tag};
use bun_http::async_http::Options as HttpOptions;
use bun_http::{
    AsyncHTTP, FetchRedirect, HTTPClientResult, HTTPClientResultCallback, Headers, HeadersExt,
    Method,
};
use bun_io::JsKeepAlive;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_picohttp as picohttp;
use bun_ptr::{AliasableBox, RefPtr};
use bun_s3_signing::acl::ACL;
use bun_s3_signing::credentials::{S3Credentials, SignOptions, SignResult};
use bun_s3_signing::error::{ErrorCodeAndMessage, S3Error, get_sign_error_code_and_message};
use bun_s3_signing::storage_class::StorageClass;
use bun_url::URL;

use crate::webcore::s3::multipart::{MultiPartUpload, UploadPart};
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

// manual Debug because upstream `S3Error` (bun_s3_signing) doesn't derive Debug and
// we may not edit that crate from here. Only the variant tag is needed for `scoped_log!`.
impl core::fmt::Debug for S3UploadResult<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            S3UploadResult::Success => f.write_str("Success"),
            S3UploadResult::Failure(err) => f
                .debug_struct("Failure")
                .field("code", &bstr::BStr::new(err.code))
                .field("message", &bstr::BStr::new(err.message))
                .finish(),
        }
    }
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

// commit result also fails if status 200 but with body containing an Error
pub(crate) enum S3CommitResult<'a> {
    Success,
    /// failure error is not owned and need to be copied if used after this callback
    Failure(S3Error<'a>),
}

// commit result also fails if status 200 but with body containing an Error
pub(crate) enum S3PartResult<'a> {
    Etag(&'a [u8]),
    /// failure error is not owned and need to be copied if used after this callback
    Failure(S3Error<'a>),
}

pub(crate) struct S3HttpSimpleTask {
    async_http_id: Cell<u32>,
    sign_result: SignResult,
    headers_buf: Vec<u8>,
    callback: Callback,
    /// Only the HTTP thread uses it from `schedule` until it posts the task.
    off_thread: UnsafeCell<OffThread>,
    /// The resolved proxy, empty for none. Owned: an env-derived slice can be
    /// freed by a process.env.HTTP_PROXY write while the HTTP thread is in flight.
    proxy_url: Box<[u8]>,
    /// Owned copy of the request body. The HTTP thread reads the body slice
    /// concurrently for the lifetime of the request, so the task owns its own
    /// copy instead of borrowing caller memory.
    body: Box<[u8]>,
    _keep_alive: JsKeepAlive,
    /// The HTTP client's abort flag: set when the request's context stops so a
    /// request still queued or in flight fails promptly and comes back.
    signal_store: bun_http::signals::Store,
    abort_handle: bun_jsc::AbortHandle,
    /// The context of the script that asked (the handle forgets it when the context stops).
    context: bun_jsc::ContextId,
}

struct OffThread {
    /// How the HTTP thread posts the task, and what makes the VM wait for it.
    http_ticket: Option<bun_jsc::Ticket>,
    response_buffer: MutableString,
    result: HTTPClientResult<'static>,
    concurrent_task: ConcurrentTask,
}

const fn assert_send<T: Send>() {}

const _: () = assert_send::<(bun_jsc::Ticket, MutableString, HTTPClientResult<'static>)>();

bun_jsc::impl_abort_handle_owner!(S3HttpSimpleTask, abort_handle, |this, _cause| {
    // SAFETY: trait contract — `this` is live (armed ⇒ its response has not
    // run).
    let this = unsafe { &*this };
    this.signal_store.aborted.store(true, Ordering::Relaxed);
    bun_http::HTTPThread::schedule_shutdown(this.async_http_id.get());
});

impl Taskable for S3HttpSimpleTask {
    const TAG: TaskTag = task_tag::S3HttpSimpleTask;
    /// A response the HTTP thread handed back during teardown: its native
    /// completion is what finishes the caller's operation (and settles a promise
    /// nobody can observe — script is forbidden), so run it.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract.
        let _ = unsafe { S3HttpSimpleTask::on_response(this) };
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
    /// An upload that turned out to fit in one request.
    SingleSend(RefPtr<MultiPartUpload>),
    Start(RefPtr<MultiPartUpload>),
    /// The upload and the part's index in `MultiPartUpload::queue`.
    Part(RefPtr<MultiPartUpload>, u8),
    Commit(RefPtr<MultiPartUpload>),
    Rollback(RefPtr<MultiPartUpload>),
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
            // These start inside the sink's `write` or `end`, and failing the upload can free the sink.
            Callback::SingleSend(_)
            | Callback::Start(_)
            | Callback::Part(..)
            | Callback::Commit(_) => {
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
            | Callback::ListObjects(_)
            | Callback::Rollback(_) => self.fail(error.code, error.message),
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
            Callback::SingleSend(upload) => {
                MultiPartUpload::single_send_upload_response(&upload, S3UploadResult::Failure(err))
            }
            Callback::Start(upload) => MultiPartUpload::start_multi_part_request_result(
                &upload,
                S3DownloadResult::Failure(err),
            ),
            Callback::Part(upload, index) => {
                UploadPart::on_part_response(&upload, index, S3PartResult::Failure(err))
            }
            Callback::Commit(upload) => {
                MultiPartUpload::on_commit_multi_part_request(&upload, S3CommitResult::Failure(err))
            }
            Callback::Rollback(upload) => MultiPartUpload::on_rollback_multi_part_request(
                &upload,
                S3DeleteResult::Failure(err),
            ),
        }
    }

    fn not_found(self, code: &[u8], message: &[u8]) -> bun_jsc::JsResult<()> {
        let err = S3Error { code, message };
        match self {
            Callback::Download(callback) => callback(S3DownloadResult::NotFound(err)),
            Callback::Stat(callback) => callback(S3StatResult::NotFound(err)),
            Callback::Delete(callback) => callback(S3DeleteResult::NotFound(err)),
            Callback::ListObjects(callback) => callback(S3ListObjectsResult::NotFound(err)),
            Callback::Start(upload) => MultiPartUpload::start_multi_part_request_result(
                &upload,
                S3DownloadResult::NotFound(err),
            ),
            Callback::Rollback(upload) => MultiPartUpload::on_rollback_multi_part_request(
                &upload,
                S3DeleteResult::NotFound(err),
            ),
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

impl OffThread {
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
}

impl S3HttpSimpleTask {
    /// this is the task callback from the last task result and is always in the main thread
    ///
    /// # Safety
    /// `this` is the pointer of the task that `OffThread::post` posted, and that left the queue.
    pub(crate) unsafe fn on_response(this: *mut Self) -> bun_jsc::JsResult<()> {
        // SAFETY: the box that `schedule` leaked. Its task is posted once.
        let task = unsafe { AliasableBox::from_non_null(NonNull::new_unchecked(this)) };
        // The next request of a multipart upload, a retry, and the script this calls continue
        // what the requesting script started.
        // (In a stopped context, whatever a retry arms is aborted at once.)
        let _context = VirtualMachine::get().enter_context(task.context);
        task.abort_handle.leave();
        let mut task = task.into_box();

        let callback = task.callback;
        let off_thread = task.off_thread.get_mut();
        if !off_thread.result.is_success() {
            return off_thread.error_with_body(callback, ErrorType::Failure);
        }
        debug_assert!(off_thread.result.metadata.is_some());
        let response = off_thread.result.metadata.as_ref().unwrap();
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
            (Callback::Rollback(upload), 200 | 204) => {
                MultiPartUpload::on_rollback_multi_part_request(&upload, S3DeleteResult::Success)
            }
            (Callback::ListObjects(callback), 200) => {
                let body = off_thread.response_buffer.list.as_slice();
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
            (Callback::SingleSend(upload), 200) => {
                MultiPartUpload::single_send_upload_response(&upload, S3UploadResult::Success)
            }
            (callback @ (Callback::Upload(_) | Callback::SingleSend(_)), _) => {
                off_thread.error_with_body(callback, ErrorType::Failure)
            }
            (Callback::Download(callback), 200 | 204 | 206) => {
                let body = core::mem::take(&mut off_thread.response_buffer);
                callback(S3DownloadResult::Success(S3DownloadSuccess { body }))
            }
            (Callback::Start(upload), 200 | 204 | 206) => {
                let body = core::mem::take(&mut off_thread.response_buffer);
                let result = S3DownloadResult::Success(S3DownloadSuccess { body });
                MultiPartUpload::start_multi_part_request_result(&upload, result)
            }
            (Callback::Commit(upload), status) => {
                // commit multipart upload can fail with status 200
                let parsed = xml_response::parse_error(&off_thread.response_buffer.list);
                let result = match off_thread.response_error(status, parsed.as_ref()) {
                    Some(err) => S3CommitResult::Failure(err),
                    None => S3CommitResult::Success,
                };
                MultiPartUpload::on_commit_multi_part_request(&upload, result)
            }
            (Callback::Part(upload, index), status) => {
                let parsed = xml_response::parse_error(&off_thread.response_buffer.list);
                if let Some(err) = off_thread.response_error(status, parsed.as_ref()) {
                    UploadPart::on_part_response(&upload, index, S3PartResult::Failure(err))
                } else if let Some(etag) = response.header(b"etag") {
                    UploadPart::on_part_response(&upload, index, S3PartResult::Etag(etag))
                } else {
                    off_thread.error_with_body(Callback::Part(upload, index), ErrorType::Failure)
                }
            }
            (
                callback @ (Callback::Stat(_)
                | Callback::Download(_)
                | Callback::Delete(_)
                | Callback::ListObjects(_)
                | Callback::Start(_)
                | Callback::Rollback(_)),
                status,
            ) => match status {
                404 => off_thread.error_with_body(callback, ErrorType::NotFound),
                _ => off_thread.error_with_body(callback, ErrorType::Failure),
            },
        }
    }

    pub(crate) fn schedule(
        context: &bun_jsc::ScriptExecutionContext,
        method: Method,
        sign_result: SignResult,
        headers: Headers,
        proxy_url: Box<[u8]>,
        body: Box<[u8]>,
        callback: Callback,
    ) {
        let vm = VirtualMachine::get();
        let task = AliasableBox::new(S3HttpSimpleTask {
            async_http_id: Cell::new(0),
            sign_result,
            callback,
            headers_buf: headers.buf,
            off_thread: UnsafeCell::new(OffThread {
                http_ticket: Some(vm.ticket()),
                response_buffer: MutableString::default(),
                result: HTTPClientResult::default(),
                concurrent_task: ConcurrentTask::default(),
            }),
            proxy_url,
            body,
            _keep_alive: JsKeepAlive::active(),
            signal_store: Default::default(),
            abort_handle: bun_jsc::AbortHandle::for_owner::<S3HttpSimpleTask>(),
            context: context.id(),
        });
        let async_http = AsyncHTTP::init(
            method,
            URL::parse(&task.sign_result.url),
            headers.entries,
            &task.headers_buf,
            &task.body,
            FetchRedirect::Follow,
            HttpOptions {
                http_proxy: (!task.proxy_url.is_empty()).then(|| URL::parse(&task.proxy_url)),
                verbose: Some(vm.get_verbose_fetch()),
                reject_unauthorized: Some(vm.get_tls_reject_unauthorized()),
                tls_props: crate::socket::http_client_defaults(vm),
                signals: Some(task.signal_store.to()),
                ..Default::default()
            },
        );
        task.async_http_id.set(async_http.async_http_id);
        let result_callback = HTTPClientResultCallback::new_with_release(
            task.off_thread.get(),
            OffThread::http_callback,
            OffThread::release_at_shutdown,
        );
        // Out on the HTTP thread until its final callback: its context aborts it
        // when it stops, and the VM waits for it (the ticket).
        // SAFETY: `task` is leaked below until `on_response`, which disarms the handle, and which
        // the callbacks post once the request is dropped. Until then only they use `off_thread`,
        // whose fields are `Send` (`assert_send`) except for the queue node.
        unsafe {
            (*task.off_thread.get()).concurrent_task.from(task.as_ptr());
            bun_jsc::AbortHandle::arm_owner(task.as_ptr(), context);
            AsyncHTTP::schedule(async_http, result_callback);
        }
        task.into_raw();
    }
}

impl OffThread {
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
    /// `this` is the context that `schedule` passed. The call with `finished` is the last one.
    unsafe fn http_callback(
        this: *mut Self,
        finished: Option<bun_http::FinishedRequest>,
        result: HTTPClientResult<'_>,
    ) {
        let is_done = finished.is_some();
        drop(finished);
        // SAFETY: fn contract.
        unsafe {
            (*this).stage_http_result(result);
            if is_done {
                Self::post(this);
            }
        }
    }

    /// `HTTPClientResultCallback::release_at_shutdown`: the exiting main
    /// thread parked the HTTP thread, which will not call back; hand the
    /// request back as failed so its VM's wait ends and the JS thread frees it.
    ///
    /// # Safety
    /// As [`Self::post`].
    unsafe fn release_at_shutdown(this: *mut ()) {
        let this = this.cast::<Self>();
        // SAFETY: fn contract.
        unsafe {
            (*this).result.fail = Some(bun_http::Error::Aborted);
            Self::post(this);
        }
    }

    /// # Safety
    /// HTTP thread. `this` is the context that `schedule` passed, and it is not used afterwards.
    unsafe fn post(this: *mut Self) {
        // SAFETY: fn contract. The ticket leaves first: the JS thread may free `this` once it is queued.
        unsafe {
            let ticket = (*this).http_ticket.take().expect("posted once");
            ticket.post_intrusive(NonNull::new_unchecked(&raw mut (*this).concurrent_task));
        }
    }
}

// callers in `client.rs` / `multipart.rs` were translated with three different
// names for the request-options struct (`Options`, `S3RequestOptions`, `S3SimpleRequestOptions`)
// and two for the callback enum. Alias them here so the call sites compile without churn.
pub(crate) type Options<'a> = S3SimpleRequestOptions<'a>;
pub(crate) type S3RequestOptions<'a> = S3SimpleRequestOptions<'a>;
pub(crate) type S3Callback = Callback;

pub(crate) struct S3SimpleRequestOptions<'a> {
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

impl<'a> Default for S3SimpleRequestOptions<'a> {
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
            .snapshot()
            .get_http_proxy_for(&URL::parse(url))
            .map(|proxy| Box::from(proxy.href))
            .unwrap_or_default(),
    }
}

/// What puts an S3 request on the HTTP thread asks first: this file's function and
/// `client::download_stream` before anything else, the caller of `client::list_objects` before
/// it allocates. (A `MultiPartUpload` asks its own abort handle: see `process_buffered`.)
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
    options: S3SimpleRequestOptions<'_>,
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

    let headers = {
        let mut headers = result.headers();
        if let Some(range_) = &options.range {
            headers.append_assume_capacity(picohttp::Header::new(b"range", range_));
        } else if let Some(content_type) = options.content_type.filter(|ct| !ct.is_empty()) {
            headers.append_assume_capacity(picohttp::Header::new(b"Content-Type", content_type));
        }
        Headers::from_pico_http_headers(&headers)
    };

    let proxy_url = resolve_proxy(options.proxy_url, &result.url);
    S3HttpSimpleTask::schedule(
        context,
        options.method,
        result,
        headers,
        proxy_url,
        Box::<[u8]>::from(options.body),
        callback,
    );
    Ok(())
}
