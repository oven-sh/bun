use core::cell::Cell;
use core::sync::atomic::{AtomicPtr, Ordering};
use std::sync::Arc;

use bun_core::MutableString;
use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_event_loop::{ReusableConcurrentTask, Task, TaskHop, TaskTag, task_tag};
use bun_http::async_http::Options as HttpOptions;
use bun_http::{
    AsyncHTTP, FetchRedirect, HTTPClientResult, HTTPClientResultCallback, HTTPClientResultHandler,
    Headers, HeadersExt, InFlight, Method, OwnedRequest, Signals,
};
use bun_io::KeepAlive;
use bun_jsc::InFlightTicket;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_picohttp as picohttp;
use bun_ptr::{RefPtr, ThisPtr};
use bun_s3_signing::acl::ACL;
use bun_s3_signing::credentials::{S3Credentials, SignOptions, SignResult};
use bun_s3_signing::error::{S3Error, get_sign_error_code_and_message};
use bun_s3_signing::storage_class::StorageClass;
use bun_threading::{Guarded, thread_pool};
use bun_url::URL;

use crate::webcore::s3::{list_objects, xml_response};

// The result/options structs below carry borrowed slices that are valid only for the
// duration of the callback invocation (not owned; they must be copied if used
// after the callback). They take an explicit `<'a>` because they are ephemeral stack-only
// callback payloads (never heap-stored) — the borrow lifetime accurately models ownership.

#[derive(Default)]
pub struct S3StatSuccess<'a> {
    pub(crate) size: usize,
    /// etag is not owned and need to be copied if used after this callback
    pub(crate) etag: &'a [u8],
    /// format: Mon, 06 Jan 2025 22:40:57 GMT, lastModified is not owned and need to be copied if used after this callback
    pub(crate) last_modified: &'a [u8],
    /// format: text/plain, contentType is not owned and need to be copied if used after this callback
    pub(crate) content_type: &'a [u8],
}

pub enum S3StatResult<'a> {
    Success(S3StatSuccess<'a>),
    NotFound(S3Error<'a>),
    /// failure error is not owned and need to be copied if used after this callback
    Failure(S3Error<'a>),
}

pub struct S3DownloadSuccess {
    /// body is owned and dont need to be copied, but dont forget to free it
    pub(crate) body: MutableString,
}

pub enum S3DownloadResult<'a> {
    Success(S3DownloadSuccess),
    NotFound(S3Error<'a>),
    /// failure error is not owned and need to be copied if used after this callback
    Failure(S3Error<'a>),
}

pub enum S3UploadResult<'a> {
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

pub enum S3DeleteResult<'a> {
    Success,
    NotFound(S3Error<'a>),
    /// failure error is not owned and need to be copied if used after this callback
    Failure(S3Error<'a>),
}

pub enum S3ListObjectsResult<'a> {
    Success(Box<list_objects::S3ListObjectsV2Result>),
    NotFound(S3Error<'a>),
    /// failure error is not owned and need to be copied if used after this callback
    Failure(S3Error<'a>),
}

// commit result also fails if status 200 but with body containing an Error
pub enum S3CommitResult<'a> {
    Success,
    /// failure error is not owned and need to be copied if used after this callback
    Failure(S3Error<'a>),
}

// commit result also fails if status 200 but with body containing an Error
pub enum S3PartResult<'a> {
    Etag(&'a [u8]),
    /// failure error is not owned and need to be copied if used after this callback
    Failure(S3Error<'a>),
}

/// What a request out on the HTTP thread borrows (URL, header buffer, body,
/// proxy): kept, untouched, until the HTTP thread hands the request back.
pub(crate) struct RequestStorage {
    pub(crate) sign_result: SignResult,
    pub(crate) headers: Headers,
    /// Owned copy of the request body: the HTTP thread reads it for the
    /// lifetime of the request.
    pub(crate) body: Box<[u8]>,
    /// Owned copy of the proxy URL: a concurrent `process.env.HTTP_PROXY`
    /// write can free the env-derived slice while the request is in flight.
    pub(crate) proxy_url: Box<[u8]>,
}

impl RequestStorage {
    /// The request for `sign_result.url` with these headers and body,
    /// delivering its results to `handler` on the HTTP thread.
    pub(crate) fn request<H: HTTPClientResultHandler>(
        self,
        method: Method,
        handler: Arc<H>,
        signals: Signals,
    ) -> OwnedRequest<Self> {
        let vm = VirtualMachine::get();
        let verbose = vm.get_verbose_fetch();
        let reject_unauthorized = vm.get_tls_reject_unauthorized();
        OwnedRequest::new(self, |storage| {
            AsyncHTTP::init(
                method,
                URL::parse(&storage.sign_result.url),
                storage.headers.entries.clone().expect("OOM"),
                storage.headers.buf.as_slice(),
                &storage.body,
                HTTPClientResultCallback::from_handler(handler),
                FetchRedirect::Follow,
                HttpOptions {
                    http_proxy: (!storage.proxy_url.is_empty())
                        .then(|| URL::parse(&storage.proxy_url)),
                    verbose: Some(verbose),
                    reject_unauthorized: Some(reject_unauthorized),
                    signals: Some(signals),
                    ..Default::default()
                },
            )
        })
    }

    pub(crate) fn owned_proxy(proxy_url: Option<&[u8]>) -> Box<[u8]> {
        match proxy_url {
            Some(proxy) if !proxy.is_empty() => Box::<[u8]>::from(proxy),
            _ => Box::default(),
        }
    }
}

/// What the HTTP thread produced, for the JS thread to consume.
#[derive(Default)]
struct Response {
    buffer: MutableString,
    result: HTTPClientResult<'static>,
}

/// The part of a simple request shared with the HTTP thread: `bun_http` holds
/// it (as the request's result handler) until the terminal result; the task
/// for its whole life.
pub(crate) struct Shared {
    response: Guarded<Response>,
    /// The HTTP client's abort flag: set by the VM's stop phase so a request
    /// still queued or in flight fails promptly and comes back.
    signal_store: bun_http::signals::Store,
    /// The task's address for the JS-thread hop; set once, before the request
    /// is scheduled. The task keeps itself alive for the hop (`http_ref`).
    task: AtomicPtr<S3HttpSimpleTask>,
    /// The hop's queue node (posted once).
    node: ReusableConcurrentTask,
    /// How the HTTP thread posts to the JS thread, and what makes the VM wait
    /// for it; handed back right after the hop is posted.
    ticket: InFlightTicket,
}

impl Shared {
    fn stage(&self, mut result: HTTPClientResult<'_>) {
        let mut response = self.response.lock();
        let previous_metadata = response.result.metadata.take();
        result.body_into(&mut response.buffer.list);
        response.result = result.into_owned();
        if response.result.metadata.is_none() {
            response.result.metadata = previous_metadata;
        }
    }

    /// HTTP thread, nothing more to deliver: post the response hop and give
    /// the ticket back.
    fn hand_back(&self) {
        let task = Task::new(
            task_tag::S3HttpSimpleTask,
            self.task.load(Ordering::Acquire).cast::<()>(),
        );
        let node = self
            .node
            .arm(task)
            .unwrap_or_else(|| ConcurrentTask::create(task));
        self.ticket.post(node);
        self.ticket.hand_back();
    }
}

impl HTTPClientResultHandler for Shared {
    /// HTTP thread: fold `result` into the response; the terminal one posts it
    /// to the JS thread.
    fn on_result(&self, result: HTTPClientResult<'_>) {
        let is_done = !result.has_more;
        self.stage(result);
        if is_done {
            self.hand_back();
        }
    }

    /// The exiting main thread parked the HTTP thread, which will not call
    /// back; hand the request back as failed so its VM's wait ends and the JS
    /// thread releases it.
    fn release_at_shutdown(&self) {
        {
            let mut response = self.response.lock();
            response.result.fail = Some(bun_http::Error::Aborted);
            response.result.has_more = false;
        }
        self.hand_back();
    }
}

/// One S3 request (stat / download / upload / delete / list / a multipart
/// step). Lives on the JS thread; the HTTP thread only sees [`Shared`].
#[derive(bun_ptr::CellRefCounted)]
pub struct S3HttpSimpleTask {
    ref_count: Cell<u32>,
    /// The ref the response hop (and the teardown registry) reach this task
    /// through; released by `on_response`.
    http_ref: Cell<Option<RefPtr<S3HttpSimpleTask>>>,
    shared: Arc<Shared>,
    /// The request out on (or back from) the HTTP thread; taken back on drop.
    request: InFlight<RequestStorage>,
    /// `Some` until the response (or failure) is delivered.
    callback: Cell<Option<Callback>>,
    poll_ref: KeepAlive,
}

/// `task_tag::S3HttpSimpleTask`: the HTTP thread handed the request back.
pub struct ResponseHop;
impl TaskHop for ResponseHop {
    type Target = S3HttpSimpleTask;
    const TAG: TaskTag = task_tag::S3HttpSimpleTask;
    fn run(this: ThisPtr<S3HttpSimpleTask>) -> bun_jsc::JsResult<()> {
        S3HttpSimpleTask::on_response(this)
    }
    /// The VM is tearing down: the native completion is what releases the
    /// caller's state (and settles a promise nobody can observe — script is
    /// forbidden), so run it.
    fn release_unrun(this: ThisPtr<S3HttpSimpleTask>) {
        let _ = S3HttpSimpleTask::on_response(this);
    }
}

/// Receives an [`S3StatResult`] once, on the JS thread.
pub type StatCallback = Box<dyn FnOnce(S3StatResult<'_>) -> bun_jsc::JsResult<()>>;
/// Receives an [`S3DownloadResult`] once, on the JS thread.
pub type DownloadCallback = Box<dyn FnOnce(S3DownloadResult<'_>) -> bun_jsc::JsResult<()>>;
/// Receives an [`S3UploadResult`] once, on the JS thread.
pub type UploadCallback = Box<dyn FnOnce(S3UploadResult<'_>) -> bun_jsc::JsResult<()>>;
/// Receives an [`S3DeleteResult`] once, on the JS thread.
pub type DeleteCallback = Box<dyn FnOnce(S3DeleteResult<'_>) -> bun_jsc::JsResult<()>>;
/// Receives an [`S3ListObjectsResult`] once, on the JS thread.
pub type ListObjectsCallback = Box<dyn FnOnce(S3ListObjectsResult<'_>) -> bun_jsc::JsResult<()>>;
/// Receives an [`S3CommitResult`] once, on the JS thread.
pub type CommitCallback = Box<dyn FnOnce(S3CommitResult<'_>) -> bun_jsc::JsResult<()>>;
/// Receives an [`S3PartResult`] once, on the JS thread.
pub type PartCallback = Box<dyn FnOnce(S3PartResult<'_>) -> bun_jsc::JsResult<()>>;

/// What a simple request delivers its outcome to: one completion, called
/// once. Whatever it captures (a promise, a store ref, an upload ref) is the
/// receiver's.
pub enum Callback {
    Stat(StatCallback),
    Download(DownloadCallback),
    Upload(UploadCallback),
    Delete(DeleteCallback),
    ListObjects(ListObjectsCallback),
    Commit(CommitCallback),
    Part(PartCallback),
}

impl Callback {
    fn fail(self, code: &[u8], message: &[u8]) -> bun_jsc::JsResult<()> {
        let err = S3Error { code, message };
        match self {
            Callback::Upload(callback) => callback(S3UploadResult::Failure(err))?,
            Callback::Download(callback) => callback(S3DownloadResult::Failure(err))?,
            Callback::Stat(callback) => callback(S3StatResult::Failure(err))?,
            Callback::Delete(callback) => callback(S3DeleteResult::Failure(err))?,
            Callback::ListObjects(callback) => callback(S3ListObjectsResult::Failure(err))?,
            Callback::Commit(callback) => callback(S3CommitResult::Failure(err))?,
            Callback::Part(callback) => callback(S3PartResult::Failure(err))?,
        }
        Ok(())
    }

    fn not_found(self, code: &[u8], message: &[u8]) -> bun_jsc::JsResult<()> {
        let err = S3Error { code, message };
        match self {
            Callback::Download(callback) => callback(S3DownloadResult::NotFound(err))?,
            Callback::Stat(callback) => callback(S3StatResult::NotFound(err))?,
            Callback::Delete(callback) => callback(S3DeleteResult::NotFound(err))?,
            Callback::ListObjects(callback) => callback(S3ListObjectsResult::NotFound(err))?,
            other => other.fail(code, message)?,
        }
        Ok(())
    }
}

// `error_type` is a runtime parameter — the
// branch is on an error path, no perf concern.
#[derive(PartialEq, Eq, Clone, Copy)]
enum ErrorType {
    NotFound,
    Failure,
}

impl Response {
    fn error_with_body(&self, callback: Callback, error_type: ErrorType) -> bun_jsc::JsResult<()> {
        let mut code: &[u8] = b"UnknownError";
        let mut message: &[u8] = b"an unexpected error has occurred";
        let mut has_error_code = false;
        let parsed;
        if let Some(err) = self.result.fail {
            code = err.name().as_bytes();
            has_error_code = true;
        } else {
            let bytes = self.buffer.list.as_slice();
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
            callback.not_found(code, message)?;
        } else {
            callback.fail(code, message)?;
        }
        Ok(())
    }

    /// A commit can answer 200 and still carry an `<Error>` document, in
    /// which case `callback` is failed here; otherwise it comes back.
    fn fail_if_contains_error(
        &self,
        status: u32,
        callback: Callback,
    ) -> bun_jsc::JsResult<Option<Callback>> {
        let mut code: &[u8] = b"UnknownError";
        let mut message: &[u8] = b"an unexpected error has occurred";
        let parsed;
        if let Some(err) = self.result.fail {
            code = err.name().as_bytes();
        } else {
            let bytes = self.buffer.list.as_slice();
            if !bytes.is_empty() {
                message = bytes;
            }
            parsed = xml_response::parse_error(bytes);
            if let Some(error) = &parsed {
                code = error.code.as_deref().unwrap_or(code);
                message = error.message.as_deref().unwrap_or(message);
            }
            if (parsed.is_none() && status == 200) || status == 206 {
                return Ok(Some(callback));
            }
        }
        callback.fail(code, message)?;
        Ok(None)
    }

    /// Hand the outcome to `callback`. JS thread.
    fn deliver(mut self, callback: Callback) -> bun_jsc::JsResult<()> {
        if !self.result.is_success() {
            self.error_with_body(callback, ErrorType::Failure)?;
            return Ok(());
        }
        debug_assert!(self.result.metadata.is_some());
        // Moved out so the `Download` arm can take `buffer` while reading headers.
        let metadata = self.result.metadata.take().unwrap();
        let response = &metadata.response;
        match callback {
            Callback::Stat(callback) => match response.status_code {
                200 => {
                    callback(S3StatResult::Success(S3StatSuccess {
                        etag: response.headers.get(b"etag").unwrap_or(b""),
                        last_modified: response.headers.get(b"last-modified").unwrap_or(b""),
                        content_type: response.headers.get(b"content-type").unwrap_or(b""),
                        size: response
                            .headers
                            .get(b"content-length")
                            .map(bun_http_types::parse_content_length)
                            .unwrap_or(0),
                    }))?;
                }
                404 => self.error_with_body(Callback::Stat(callback), ErrorType::NotFound)?,
                _ => self.error_with_body(Callback::Stat(callback), ErrorType::Failure)?,
            },
            Callback::Delete(callback) => match response.status_code {
                200 | 204 => callback(S3DeleteResult::Success)?,
                404 => self.error_with_body(Callback::Delete(callback), ErrorType::NotFound)?,
                _ => self.error_with_body(Callback::Delete(callback), ErrorType::Failure)?,
            },
            Callback::ListObjects(callback) => match response.status_code {
                200 => {
                    let body = self.buffer.list.as_slice();
                    let result = match list_objects::parse_s3_list_objects_result(body) {
                        Some(listing) => S3ListObjectsResult::Success(Box::new(listing)),
                        // Half a listing is worse than none: S3 emits keys
                        // with control characters as (ill-formed) XML
                        // unless asked to URL-encode them.
                        None => S3ListObjectsResult::Failure(S3Error {
                            code: b"InvalidResponse",
                            message: b"ListObjectsV2 response is not a well-formed <ListBucketResult> document (if keys can contain control characters, pass encodingType: \"url\")",
                        }),
                    };
                    callback(result)?;
                }
                404 => {
                    self.error_with_body(Callback::ListObjects(callback), ErrorType::NotFound)?
                }
                _ => self.error_with_body(Callback::ListObjects(callback), ErrorType::Failure)?,
            },
            Callback::Upload(callback) => match response.status_code {
                200 => callback(S3UploadResult::Success)?,
                _ => self.error_with_body(Callback::Upload(callback), ErrorType::Failure)?,
            },
            Callback::Download(callback) => match response.status_code {
                200 | 204 | 206 => {
                    let body = core::mem::take(&mut self.buffer);
                    callback(S3DownloadResult::Success(S3DownloadSuccess { body }))?;
                }
                404 => self.error_with_body(Callback::Download(callback), ErrorType::NotFound)?,
                _ => self.error_with_body(Callback::Download(callback), ErrorType::Failure)?,
            },
            commit @ Callback::Commit(_) => {
                // commit multipart upload can fail with status 200
                if let Some(Callback::Commit(callback)) =
                    self.fail_if_contains_error(response.status_code, commit)?
                {
                    callback(S3CommitResult::Success)?;
                }
            }
            part @ Callback::Part(_) => {
                if let Some(part) = self.fail_if_contains_error(response.status_code, part)? {
                    if let Some(etag) = response.headers.get(b"etag") {
                        let Callback::Part(callback) = part else {
                            unreachable!()
                        };
                        callback(S3PartResult::Etag(etag))?;
                    } else {
                        self.error_with_body(part, ErrorType::Failure)?;
                    }
                }
            }
        }
        Ok(())
    }
}

impl S3HttpSimpleTask {
    /// The response hop (JS thread): the HTTP thread is done with the request.
    /// Delivers the outcome, then releases the task.
    fn on_response(this: ThisPtr<Self>) -> bun_jsc::JsResult<()> {
        crate::jsc_hooks::ActiveHandle::S3Request(this.into()).unregister();
        let http_ref = this
            .http_ref
            .take()
            .expect("S3 request is handed back once");
        let callback = this.callback.take().expect("S3 request completes once");
        let response = core::mem::take(&mut *this.shared.response.lock());
        let delivered = response.deliver(callback);
        drop(http_ref);
        delivered
    }

    /// VM teardown's stop phase (JS thread): abort the transport so the HTTP
    /// thread fails the request promptly and hands it back.
    pub(crate) fn stop_for_vm_teardown(&self) {
        self.shared
            .signal_store
            .aborted
            .store(true, Ordering::Relaxed);
        bun_http::http_thread().schedule_shutdown_by_id(self.request.async_http_id());
    }

    /// Put the request on the HTTP thread; `callback` gets the outcome on this
    /// (the JS) thread.
    pub(crate) fn start(method: Method, storage: RequestStorage, callback: Callback) {
        let shared = Arc::new(Shared {
            response: Guarded::default(),
            signal_store: Default::default(),
            task: AtomicPtr::new(core::ptr::null_mut()),
            node: ReusableConcurrentTask::default(),
            ticket: VirtualMachine::get().ticket().in_flight(),
        });
        let request = storage.request(method, Arc::clone(&shared), shared.signal_store.to());
        bun_http::http_thread::init(&Default::default());
        let mut batch = thread_pool::Batch::default();
        let request = request.start(&mut batch);
        let mut poll_ref = KeepAlive::init();
        poll_ref.ref_(bun_io::js_vm_ctx());
        let task = RefPtr::new(S3HttpSimpleTask {
            ref_count: Cell::new(1),
            http_ref: Cell::new(None),
            shared,
            request,
            callback: Cell::new(Some(callback)),
            poll_ref,
        });
        let this = task.this_ptr();
        this.shared.task.store(this.as_ptr(), Ordering::Release);
        // Out on the HTTP thread until the response hop: the VM aborts it at
        // teardown (registry) and waits for it (the ticket).
        crate::jsc_hooks::ActiveHandle::S3Request(this.into()).register();
        this.http_ref.set(Some(task));
        bun_http::HTTPThread::schedule(batch);
    }
}

impl Drop for S3HttpSimpleTask {
    fn drop(&mut self) {
        self.poll_ref.unref(bun_io::js_vm_ctx());
        // `request` drops next: the HTTP thread handed it back before the
        // response hop was posted, so this frees it.
    }
}

// callers in `client.rs` / `multipart.rs` were translated with three different
// names for the request-options struct (`Options`, `S3RequestOptions`, `S3SimpleRequestOptions`)
// and two for the callback enum. Alias them here so the call sites compile without churn.
pub(crate) type Options<'a> = S3SimpleRequestOptions<'a>;
pub(crate) type S3RequestOptions<'a> = S3SimpleRequestOptions<'a>;
pub(crate) type S3Callback = Callback;

pub struct S3SimpleRequestOptions<'a> {
    // signing options
    pub path: &'a [u8],
    pub method: Method,
    pub(crate) search_params: Option<&'a [u8]>,
    pub(crate) content_type: Option<&'a [u8]>,
    pub(crate) content_disposition: Option<&'a [u8]>,
    pub(crate) content_encoding: Option<&'a [u8]>,

    // http request options
    pub(crate) body: &'a [u8],
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

pub(crate) fn execute_simple_s3_request(
    this: &S3Credentials,
    options: S3SimpleRequestOptions<'_>,
    callback: Callback,
) -> bun_jsc::JsResult<()> {
    // A multipart/retry continuation can reach here from teardown's queue
    // release; nothing new leaves a VM that is stopping.
    if !VirtualMachine::get().script_allowed() {
        drop(options.range);
        callback.fail(
            b"ERR_S3_VM_SHUTDOWN",
            b"The JavaScript VM that owns this request is shutting down",
        )?;
        return Ok(());
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
            let error_code_and_message = get_sign_error_code_and_message(sign_err.into());
            callback.fail(error_code_and_message.code, error_code_and_message.message)?;
            return Ok(());
        }
    };

    let headers = 'brk: {
        let mut header_buffer = [picohttp::Header::ZERO; SignResult::MAX_HEADERS + 1];
        if let Some(range_) = &options.range {
            let _headers =
                result.mix_with_header(&mut header_buffer, picohttp::Header::new(b"range", range_));
            break 'brk Headers::from_pico_http_headers(_headers);
        } else {
            if let Some(content_type) = options.content_type {
                if !content_type.is_empty() {
                    let _headers = result.mix_with_header(
                        &mut header_buffer,
                        picohttp::Header::new(b"Content-Type", content_type),
                    );
                    break 'brk Headers::from_pico_http_headers(_headers);
                }
            }
            break 'brk Headers::from_pico_http_headers(result.headers());
        }
    };

    S3HttpSimpleTask::start(
        options.method,
        RequestStorage {
            sign_result: result,
            headers,
            body: Box::<[u8]>::from(options.body),
            proxy_url: RequestStorage::owned_proxy(options.proxy_url),
        },
        callback,
    );
    Ok(())
}
