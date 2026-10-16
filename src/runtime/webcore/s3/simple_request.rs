use core::ffi::c_void;
use core::sync::atomic::Ordering;
use core::time::Duration;

use bun_core::{MutableString, Timespec, TimespecMockMode};
use bun_event_loop::ConcurrentTask::{AutoDeinit, ConcurrentTask};
use bun_event_loop::{TaskTag, Taskable, task_tag};
use bun_http::async_http::Options as HttpOptions;
use bun_http::{
    AsyncHTTP, FetchRedirect, HTTPClientResult, HTTPClientResultCallback, Headers, HeadersExt,
    Method,
};
use bun_io::KeepAlive;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_picohttp as picohttp;
use bun_s3_signing::acl::ACL;
use bun_s3_signing::credentials::{S3Credentials, SignOptions, SignResult};
use bun_s3_signing::error::{S3Error, get_sign_error_code_and_message};
use bun_s3_signing::storage_class::StorageClass;
use bun_threading::thread_pool;
use bun_url::URL;

use crate::timer::{EventLoopTimer, EventLoopTimerTag};
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
    // `http` is `MaybeUninit` because (a) it is initialised late —
    // `AsyncHTTP` contains `&'static [u8]` and `fn(...)` fields, so a
    // zeroed/default value would be instant UB; and (b) `Drop` only calls
    // `http.clear_data()`, never a full destructor, and `http_callback` does a no-drop bitwise
    // overwrite. Wrapping in `MaybeUninit` makes both possible: write-without-
    // drop on assignment, and `clear_data()`-only in `Drop`. Invariant: `http` is initialised by
    // `send` before the task pointer escapes, so every later access (in
    // `http_callback` / `Drop`) may `assume_init`.
    pub(crate) http: core::mem::MaybeUninit<AsyncHTTP<'static>>,
    /// Held while the request is out on the HTTP thread: how it delivers the
    /// response, and what makes the VM wait for it.
    pub(crate) http_ticket: Option<bun_jsc::Ticket>,
    pub(crate) sign_result: SignResult,
    pub(crate) headers: Headers,
    pub(crate) callback_context: *mut c_void,
    pub callback: Callback,
    pub(crate) response_buffer: MutableString,
    pub(crate) result: HTTPClientResult<'static>,
    pub(crate) concurrent_task: ConcurrentTask,
    /// The resolved proxy, empty for none. Owned: an env-derived slice can be
    /// freed by a process.env.HTTP_PROXY write while the HTTP thread is in flight.
    pub(crate) proxy_url: Box<[u8]>,
    /// Owned copy of the request body. The HTTP thread reads the body slice
    /// concurrently for the lifetime of the request, so the task owns its own
    /// copy instead of borrowing caller memory.
    pub(crate) body: Box<[u8]>,
    pub poll_ref: KeepAlive,
    /// The HTTP client's abort flag: set when the request's context stops so a
    /// request still queued or in flight fails promptly and comes back.
    pub(crate) signal_store: bun_http::signals::Store,
    pub(crate) abort_handle: bun_jsc::AbortHandle,
    /// The context of the script that asked (the handle forgets it when the context stops).
    pub(crate) context: bun_jsc::ContextId,
    pub(crate) resend: Resend,
}

/// Whether a request that fails is sent again. Not an option with a default: every sender
/// says which.
pub(crate) enum Resend {
    Never,
    /// While it fails in a way another attempt can get past (`S3HttpSimpleTask::is_transient`),
    /// each time after a wait.
    Transient(Budget),
}

pub(crate) struct Budget {
    /// How many more times the request is sent.
    left: u8,
    /// How many times it was sent again: the wait before the next attempt grows with it.
    sent_again: u8,
    /// A request that got no answer may have been carried out. When a second one would not
    /// leave the store as one does (CreateMultipartUpload), it is sent again only if no byte
    /// of it was written.
    once_at_most: bool,
    again: Again,
}

/// How the sender of a request issues it once more, through `send_again`. `false`: it is not
/// sent again, and the sender's callback is told the failure in hand.
pub(crate) type Again = fn(
    callback_context: *mut c_void,
    context: &bun_jsc::ScriptExecutionContext,
    attempt: Attempt<'_>,
) -> bun_jsc::JsResult<bool>;

/// What a request that is sent again takes from the attempt that failed.
pub(crate) struct Attempt<'a> {
    /// Moved from that attempt, not copied again.
    body: Box<[u8]>,
    /// The Content-Type that attempt was sent with.
    pub(crate) content_type: Option<&'a [u8]>,
    /// What is left of the budget.
    resend: Resend,
}

impl Resend {
    /// `retry` more attempts.
    pub(crate) fn transient(retry: u8, again: Again) -> Self {
        Resend::Transient(Budget {
            left: retry,
            sent_again: 0,
            once_at_most: false,
            again,
        })
    }

    /// `transient`, for a request that must not be carried out twice.
    pub(crate) fn transient_once_at_most(retry: u8, again: Again) -> Self {
        Resend::Transient(Budget {
            left: retry,
            sent_again: 0,
            once_at_most: true,
            again,
        })
    }
}

// One request is one block of the allocator's 3584-byte size class: a field that takes it
// past that is paid for by every S3 request.
const _: () = assert!(core::mem::size_of::<S3HttpSimpleTask>() <= 3584);

bun_jsc::impl_abort_handle_owner!(S3HttpSimpleTask, abort_handle, |this, _cause| {
    // SAFETY: trait contract — `this` is live (armed ⇒ its response has not
    // run); `http` is initialised before the task is armed.
    unsafe {
        (*this).signal_store.aborted.store(true, Ordering::Relaxed);
        bun_http::http_thread().schedule_shutdown((*this).http.assume_init_ref());
    }
});

impl Taskable for S3HttpSimpleTask {
    const TAG: TaskTag = task_tag::S3HttpSimpleTask;
    /// A response the HTTP thread handed back during teardown: its native
    /// completion is what frees the caller's context (and settles a promise
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

#[derive(Clone, Copy)]
pub(crate) enum Callback {
    Stat(fn(S3StatResult<'_>, *mut c_void) -> bun_jsc::JsResult<()>),
    Download(fn(S3DownloadResult<'_>, *mut c_void) -> bun_jsc::JsResult<()>),
    Upload(fn(S3UploadResult<'_>, *mut c_void) -> bun_jsc::JsResult<()>),
    Delete(fn(S3DeleteResult<'_>, *mut c_void) -> bun_jsc::JsResult<()>),
    ListObjects(fn(S3ListObjectsResult<'_>, *mut c_void) -> bun_jsc::JsResult<()>),
    Commit(fn(S3CommitResult<'_>, *mut c_void) -> bun_jsc::JsResult<()>),
    Part(fn(S3PartResult<'_>, *mut c_void) -> bun_jsc::JsResult<()>),
}

impl Callback {
    fn fail(&self, code: &[u8], message: &[u8], context: *mut c_void) -> bun_jsc::JsResult<()> {
        let err = S3Error { code, message };
        match self {
            Callback::Upload(callback) => callback(S3UploadResult::Failure(err), context)?,
            Callback::Download(callback) => callback(S3DownloadResult::Failure(err), context)?,
            Callback::Stat(callback) => callback(S3StatResult::Failure(err), context)?,
            Callback::Delete(callback) => callback(S3DeleteResult::Failure(err), context)?,
            Callback::ListObjects(callback) => {
                callback(S3ListObjectsResult::Failure(err), context)?
            }
            Callback::Commit(callback) => callback(S3CommitResult::Failure(err), context)?,
            Callback::Part(callback) => callback(S3PartResult::Failure(err), context)?,
        }
        Ok(())
    }

    fn not_found(
        &self,
        code: &[u8],
        message: &[u8],
        context: *mut c_void,
    ) -> bun_jsc::JsResult<()> {
        let err = S3Error { code, message };
        match self {
            Callback::Download(callback) => callback(S3DownloadResult::NotFound(err), context)?,
            Callback::Stat(callback) => callback(S3StatResult::NotFound(err), context)?,
            Callback::Delete(callback) => callback(S3DeleteResult::NotFound(err), context)?,
            Callback::ListObjects(callback) => {
                callback(S3ListObjectsResult::NotFound(err), context)?
            }
            _ => self.fail(code, message, context)?,
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

impl S3HttpSimpleTask {
    const HOLDS_TICKET: &str = "S3 request on the HTTP thread holds a ticket";

    // bun.TrivialNew(@This()) — heap-allocate; pointer crosses thread boundary via http callback
    pub(crate) fn new(init: Self) -> *mut Self {
        bun_core::heap::into_raw(Box::new(init))
    }

    fn error_with_body(&self, error_type: ErrorType) -> bun_jsc::JsResult<()> {
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
            self.callback
                .not_found(code, message, self.callback_context)?;
        } else {
            self.callback.fail(code, message, self.callback_context)?;
        }
        Ok(())
    }

    /// A part or a commit can answer 200 and still carry an `<Error>` document.
    fn contains_error(&self, status: u32) -> bool {
        let parsed = xml_response::parse_error(self.response_buffer.list.as_slice());
        !((parsed.is_none() && status == 200) || status == 206)
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
        let context = vm.enter_context(unsafe { (*this).context });
        // SAFETY: fn contract — `this` is live.
        unsafe { (*this).abort_handle.leave() };
        // SAFETY: `this` was produced by `S3HttpSimpleTask::new` (heap::alloc) and ownership is
        // reclaimed here exactly once via the ConcurrentTask `AutoDeinit::ManualDeinit` contract;
        // `this` is dropped at scope exit.
        let mut this = unsafe { bun_core::heap::take(this) };

        if !this.result.is_success() {
            return this.fail_or_send_again(context.context());
        }
        debug_assert!(this.result.metadata.is_some());
        // reshaped for borrowck — borrow response once, dispatch on a copy of `callback`.
        let response = &this.result.metadata.as_ref().unwrap().response;
        match this.callback {
            Callback::Stat(callback) => match response.status_code {
                200 => {
                    callback(
                        S3StatResult::Success(S3StatSuccess {
                            etag: response.headers.get(b"etag").unwrap_or(b""),
                            last_modified: response.headers.get(b"last-modified").unwrap_or(b""),
                            content_type: response.headers.get(b"content-type").unwrap_or(b""),
                            size: response
                                .headers
                                .get(b"content-length")
                                .map(bun_http_types::parse_content_length)
                                .unwrap_or(0),
                        }),
                        this.callback_context,
                    )?;
                }
                404 => this.error_with_body(ErrorType::NotFound)?,
                _ => return this.fail_or_send_again(context.context()),
            },
            Callback::Delete(callback) => match response.status_code {
                200 | 204 => callback(S3DeleteResult::Success, this.callback_context)?,
                404 => this.error_with_body(ErrorType::NotFound)?,
                _ => return this.fail_or_send_again(context.context()),
            },
            Callback::ListObjects(callback) => match response.status_code {
                200 => {
                    let body = this.response_buffer.list.as_slice();
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
                    callback(result, this.callback_context)?;
                }
                404 => this.error_with_body(ErrorType::NotFound)?,
                _ => return this.fail_or_send_again(context.context()),
            },
            Callback::Upload(callback) => match response.status_code {
                200 => callback(S3UploadResult::Success, this.callback_context)?,
                _ => return this.fail_or_send_again(context.context()),
            },
            Callback::Download(callback) => match response.status_code {
                200 | 204 | 206 => {
                    let body = core::mem::take(&mut this.response_buffer);
                    callback(
                        S3DownloadResult::Success(S3DownloadSuccess { body }),
                        this.callback_context,
                    )?;
                }
                404 => this.error_with_body(ErrorType::NotFound)?,
                _ => return this.fail_or_send_again(context.context()),
            },
            Callback::Commit(callback) => {
                // commit multipart upload can fail with status 200
                if this.contains_error(response.status_code) {
                    return this.fail_or_send_again(context.context());
                }
                callback(S3CommitResult::Success, this.callback_context)?;
            }
            Callback::Part(callback) => {
                if this.contains_error(response.status_code) {
                    return this.fail_or_send_again(context.context());
                }
                let Some(etag) = response.headers.get(b"etag") else {
                    return this.fail_or_send_again(context.context());
                };
                callback(S3PartResult::Etag(etag), this.callback_context)?;
            }
        }
        Ok(())
    }

    /// Whether another attempt can get past this failure.
    fn is_transient(&self, budget: &Budget) -> bool {
        use bun_http::Error;
        if let Some(err) = self.result.fail {
            return match err {
                // No byte of the request was written.
                Error::ConnectionRefused
                | Error::DNSResolveFailed
                | Error::DNSResolutionFailed
                | Error::FailedToOpenSocket
                | Error::ProxyConnectFailed => true,
                Error::ConnectionClosed | Error::WriteFailed | Error::Timeout => {
                    !budget.once_at_most
                }
                _ => false,
            };
        }
        let Some(metadata) = &self.result.metadata else {
            return false;
        };
        match metadata.response.status_code {
            // A failure under a 200: an `<Error>` document, or a part with no ETag.
            200 => true,
            408 | 429 | 500..=599 => true,
            // `RequestTimeout`: the store stopped waiting for the request's bytes.
            400 => xml_response::parse_error(self.response_buffer.list.as_slice())
                .is_some_and(|error| error.code.as_deref() == Some(b"RequestTimeout".as_slice())),
            _ => false,
        }
    }

    /// Whether this request, which failed, goes out once more.
    fn is_sent_again(&self, context: &bun_jsc::ScriptExecutionContext) -> bool {
        let Resend::Transient(budget) = &self.resend else {
            return false;
        };
        budget.left > 0
            && self.is_transient(budget)
            // What stopped the request's context raised this, even if a response got here first.
            && !self.signal_store.aborted.load(Ordering::Relaxed)
            && !nothing_new_leaves(context)
    }

    /// How long this request waits before it goes out again: the backoff `bun install` uses,
    /// or what the response asks for when that is longer. `None`: it goes out at once.
    fn wait_before_next_attempt(&self) -> Option<Duration> {
        let base_ms = bun_http::retry::base_ms(
            VirtualMachine::get()
                .env_loader()
                .get(b"BUN_CONFIG_HTTP_RETRY_BACKOFF"),
        );
        if base_ms == 0 {
            return None;
        }
        let sent_again = match &self.resend {
            Resend::Transient(budget) => budget.sent_again,
            Resend::Never => 0,
        };
        let backoff = bun_http::retry::backoff(base_ms, u16::from(sent_again) + 1);
        Some(bun_http::retry::retry_after(&self.result).map_or(backoff, |asked| asked.max(backoff)))
    }

    /// Where a failure that is not an answer ends: the callback is told, or the request goes
    /// out again. Out of line: a response that is not a failure runs none of this.
    #[cold]
    #[inline(never)]
    fn fail_or_send_again(
        mut self: Box<Self>,
        context: &bun_jsc::ScriptExecutionContext,
    ) -> bun_jsc::JsResult<()> {
        if !self.is_sent_again(context) {
            return self.error_with_body(ErrorType::Failure);
        }
        match self.wait_before_next_attempt() {
            Some(wait) => {
                Wait::start(self, wait, context);
                Ok(())
            }
            None => self.send_again(context),
        }
    }

    /// The sender issues this request once more, with the body of this attempt. A sender that
    /// does not want it any more is told of the failure in hand.
    fn send_again(&mut self, context: &bun_jsc::ScriptExecutionContext) -> bun_jsc::JsResult<()> {
        let Resend::Transient(mut budget) = core::mem::replace(&mut self.resend, Resend::Never)
        else {
            return self.error_with_body(ErrorType::Failure);
        };
        let again = budget.again;
        budget.left = budget.left.saturating_sub(1);
        budget.sent_again = budget.sent_again.saturating_add(1);
        let attempt = Attempt {
            body: core::mem::take(&mut self.body),
            content_type: self.headers.get(b"content-type"),
            resend: Resend::Transient(budget),
        };
        if again(self.callback_context, context, attempt)? {
            return Ok(());
        }
        self.error_with_body(ErrorType::Failure)
    }

    fn stage_http_result(
        &mut self,
        async_http: *mut AsyncHTTP<'static>,
        mut result: HTTPClientResult<'_>,
    ) {
        let previous_metadata = self.result.metadata.take();
        result.body_into(&mut self.response_buffer.list);
        // SAFETY: `result.body` (the only borrowed field) points at `self.response_buffer`,
        // which lives for the task's lifetime — extending to `'static` here is sound for
        // self-reference.
        self.result = unsafe { result.detach_lifetime() };
        if self.result.metadata.is_none() {
            self.result.metadata = previous_metadata;
        }
        // `AsyncHTTP` transitively owns Drop types (`HTTPClient`, header
        // `EntryList`s), so a plain `=` here would (a) drop the old `self.http`, freeing heap
        // buffers that `*async_http` (a bitwise clone created by the HTTP thread) still
        // aliases, and (b) leave the http-thread side to drop them again → double-free. We
        // instead write through `MaybeUninit` to suppress the LHS drop, doing a bitwise struct
        // overwrite with no destructor on either side. Ownership of the inner heap data
        // conceptually transfers here; the http-thread side must free only its outer
        // allocation (TrivialDeinit).
        // SAFETY: `async_http` is a valid live pointer for the duration of this callback;
        // `self.http` was previously initialised in `send`.
        unsafe { core::ptr::write(self.http.as_mut_ptr(), core::ptr::read(async_http)) };
    }

    /// this is the AsyncHTTP callback and is always called from the HTTPThread
    ///
    /// # Safety
    /// `this` must be a live heap pointer produced by `S3HttpSimpleTask::new` and exclusively
    /// owned by the HTTP thread for the duration of this call. `async_http` must be a valid
    /// pointer to an initialised `AsyncHTTP` for the duration of this call.
    //
    // `HTTPClientResultCallback` entrypoint: invoked by the HTTP thread with the raw task and
    // request pointers it captured at schedule time, both non-null by construction.
    pub(crate) fn http_callback(
        this: *mut Self,
        async_http: *mut AsyncHTTP<'static>,
        result: HTTPClientResult<'_>,
    ) {
        let is_done = !result.has_more;
        // SAFETY: `this` was produced by `S3HttpSimpleTask::new` and is exclusively owned
        // by the HTTP thread until the handoff below; this borrow is scoped to the call.
        unsafe { (*this).stage_http_result(async_http, result) };
        if is_done {
            // SAFETY: same exclusivity as above; the queue takes ownership of the inline
            // `concurrent_task` field's `next` link. The ticket is moved out first: the
            // JS thread may free `this` the moment it is queued.
            unsafe {
                let ticket = (*this).http_ticket.take().expect(Self::HOLDS_TICKET);
                let queued = core::ptr::NonNull::from(
                    (*this).concurrent_task.from(this, AutoDeinit::ManualDeinit),
                );
                ticket.post(queued);
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
            let queued = core::ptr::NonNull::from(
                (*this).concurrent_task.from(this, AutoDeinit::ManualDeinit),
            );
            ticket.post(queued);
        }
    }

    fn release_portable(&mut self) {
        // SAFETY: `http` is always initialised before the task pointer escapes (see `send`).
        let http = unsafe { self.http.assume_init_mut() };
        http.clear_data();
        http.request_headers = Default::default();
        http.client.header_entries = Default::default();
    }
}

impl Drop for S3HttpSimpleTask {
    fn drop(&mut self) {
        // Side effects beyond freeing owned fields (which Rust drops automatically):
        // - poll_ref.unref(vm)
        // - http.clearData()
        // Owned-field frees (response_buffer, headers, sign_result, range,
        // proxy_url, result.certificate_info, result.metadata) are handled by their own Drop impls.
        // KeepAlive::unref takes an aio EventLoopCtx; the JS-loop ctx is fetched via
        // the global hook (registered by crate::init) — same pattern as
        // `event_loop_handle_to_ctx` in process.rs.
        self.poll_ref.unref(bun_io::posix_event_loop::get_vm_ctx(
            bun_io::AllocatorType::Js,
        ));
        // Only `http.clear_data()` runs — never a full AsyncHTTP destructor —
        // so we intentionally do NOT `assume_init_drop`.
        self.release_portable();
    }
}

/// A request that failed and waits to be sent again. Only a request that waits allocates one.
pub(crate) struct Wait {
    pub(crate) timer: EventLoopTimer,
    /// The context of the request ends the wait when it stops.
    abort_handle: bun_jsc::AbortHandle,
    /// The attempt that failed. It keeps the event loop alive, its body goes out again, and
    /// its failure is the callback's if the wait ends first.
    task: Box<S3HttpSimpleTask>,
}

bun_jsc::impl_abort_handle_owner!(Wait, abort_handle, |this, _cause| {
    // SAFETY: trait contract — `this` is live (armed ⇒ its timer has not fired).
    unsafe { Wait::stop(this) }
});

impl Wait {
    fn start(
        task: Box<S3HttpSimpleTask>,
        wait: Duration,
        context: &bun_jsc::ScriptExecutionContext,
    ) {
        let this = bun_core::heap::into_raw(Box::new(Wait {
            timer: EventLoopTimer::init_paused(EventLoopTimerTag::S3RequestRetry),
            abort_handle: bun_jsc::AbortHandle::for_owner::<Wait>(),
            task,
        }));
        let due = Timespec::ms_from_now(
            TimespecMockMode::ForceRealTime,
            i64::try_from(wait.as_millis()).unwrap_or(i64::MAX),
        );
        // SAFETY: `this` is heap-allocated: it lives until its timer fires or its context stops.
        unsafe {
            crate::jsc_hooks::timer_all_mut().update(&raw mut (*this).timer, &due);
            bun_jsc::AbortHandle::arm_owner(this, context);
        }
    }

    /// The wait is over: the request goes out again, unless its context stopped meanwhile.
    ///
    /// `this` is the live `Wait` whose timer fired; it is reclaimed here.
    pub(crate) fn fire(this: *mut Self) -> bun_jsc::JsResult<()> {
        // SAFETY: fn contract.
        unsafe { (*this).abort_handle.leave() };
        // SAFETY: fn contract — allocated in `start`, reclaimed exactly once. The timer was
        // popped before it fired, so nothing takes it out of the heap here.
        let Wait { mut task, .. } = *unsafe { bun_core::heap::take(this) };
        let vm = VirtualMachine::get();
        let context = vm.enter_context(task.context);
        if task.is_sent_again(context.context()) {
            task.send_again(context.context())
        } else {
            task.error_with_body(ErrorType::Failure)
        }
    }

    /// Its context stopped: the request is not sent again, and its callback is told the failure.
    ///
    /// # Safety
    /// `this` is the live `Wait` whose timer is armed; it is reclaimed here.
    unsafe fn stop(this: *mut Self) {
        // SAFETY: fn contract — armed, so the timer is in the heap.
        unsafe { crate::jsc_hooks::timer_all_mut().remove(&raw mut (*this).timer) };
        // SAFETY: fn contract — allocated in `start`, reclaimed exactly once.
        let Wait { task, .. } = *unsafe { bun_core::heap::take(this) };
        let vm = VirtualMachine::get();
        let _context = vm.enter_context(task.context);
        let _ = task.error_with_body(ErrorType::Failure);
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

/// Sends a request. If it cannot be sent, `callback` is told why before this returns.
pub(crate) fn execute_simple_s3_request(
    this: &S3Credentials,
    context: &bun_jsc::ScriptExecutionContext,
    options: S3SimpleRequestOptions<'_>,
    resend: Resend,
    callback: Callback,
    callback_context: *mut c_void,
) -> bun_jsc::JsResult<()> {
    match send(
        this,
        context,
        options,
        None,
        resend,
        callback,
        callback_context,
    ) {
        Ok(()) => Ok(()),
        Err(err) => callback.fail(err.code, err.message, callback_context),
    }
}

/// Sends a request once more after an attempt of it failed: with that attempt's body, so
/// `options.body` is not read. `Err`: it is not sent, and `callback` is not told.
pub(crate) fn send_again(
    this: &S3Credentials,
    context: &bun_jsc::ScriptExecutionContext,
    options: S3SimpleRequestOptions<'_>,
    attempt: Attempt<'_>,
    callback: Callback,
    callback_context: *mut c_void,
) -> Result<(), S3Error<'static>> {
    send(
        this,
        context,
        options,
        Some(attempt.body),
        attempt.resend,
        callback,
        callback_context,
    )
}

/// Puts a request on the HTTP thread. `body`: `None` copies `options.body`. `Err`: the
/// request is not sent, and `callback` is not told.
pub(crate) fn send(
    this: &S3Credentials,
    context: &bun_jsc::ScriptExecutionContext,
    options: S3SimpleRequestOptions<'_>,
    body: Option<Box<[u8]>>,
    resend: Resend,
    callback: Callback,
    callback_context: *mut c_void,
) -> Result<(), S3Error<'static>> {
    // A multipart/retry continuation can reach here from teardown's queue
    // release; nothing new leaves a VM that is stopping. Nor for a context
    // that has stopped (a disposed `Bun.ModuleGraph`'s leftover script): the
    // completion is released as for a failure, which is reported to nobody.
    if nothing_new_leaves(context) {
        return Err(NOTHING_NEW_LEAVES);
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
            let error_code_and_message = get_sign_error_code_and_message(sign_err.into());
            return Err(S3Error {
                code: error_code_and_message.code,
                message: error_code_and_message.message,
            });
        }
    };

    let headers = 'brk: {
        let mut header_buffer = [picohttp::Header::ZERO; SignResult::MAX_HEADERS + 1];
        if let Some(range_) = options.range {
            let _headers = result
                .mix_with_header(&mut header_buffer, picohttp::Header::new(b"range", &range_));
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

    let mut poll_ref = KeepAlive::init();
    poll_ref.ref_(bun_io::posix_event_loop::get_vm_ctx(
        bun_io::AllocatorType::Js,
    ));
    let proxy_url = resolve_proxy(options.proxy_url, &result.url);
    let task_ptr = S3HttpSimpleTask::new(S3HttpSimpleTask {
        // written below via `MaybeUninit::write` before any read.
        http: core::mem::MaybeUninit::uninit(),
        sign_result: result,
        callback_context,
        callback,
        headers,
        http_ticket: None,
        response_buffer: MutableString::default(),
        result: HTTPClientResult::default(),
        concurrent_task: ConcurrentTask::default(),
        proxy_url,
        body: body.unwrap_or_else(|| Box::<[u8]>::from(options.body)),
        poll_ref,
        signal_store: Default::default(),
        abort_handle: bun_jsc::AbortHandle::for_owner::<S3HttpSimpleTask>(),
        context: Default::default(),
        resend,
    });
    // SAFETY: `task_ptr` is a freshly heap-allocated pointer; shared reads only until
    // the scoped exclusive `http` writes below.
    let task = unsafe { &*task_ptr };
    // SAFETY: lifetime extension — `url`, `headers_buf`, and `proxy_url` borrow from
    // heap-allocated fields of `*task` (sign_result.url / headers.buf / proxy_url) which the task
    // outlives. AsyncHTTP::init wants `'static` borrows because the HTTP thread reads them
    // concurrently; they remain valid until `task` is dropped in `on_response`.
    let url = URL::parse(unsafe { bun_ptr::detach_lifetime_ref(&*task.sign_result.url) });
    // SAFETY: same lifetime-extension invariant as `url` above — `task.headers.buf` is heap-owned
    // by `*task` and outlives the AsyncHTTP request.
    let headers_buf: &'static [u8] =
        unsafe { bun_ptr::detach_lifetime(task.headers.buf.as_slice()) };
    // SAFETY: same lifetime-extension invariant as `url` above — `task.body` is a heap-owned
    // `Box<[u8]>` field of `*task` (an owned copy of the caller's slice) and outlives the
    // AsyncHTTP request; it is freed only when `task` is dropped in `on_response`.
    let body: &'static [u8] = unsafe { bun_ptr::detach_lifetime(&*task.body) };
    let http_proxy = if !task.proxy_url.is_empty() {
        // SAFETY: same lifetime-extension invariant as `url` above — `task.proxy_url` is a
        // heap-owned `Box<[u8]>` field of `*task` and outlives the AsyncHTTP request.
        Some(URL::parse(unsafe {
            bun_ptr::detach_lifetime_ref(&*task.proxy_url)
        }))
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
            // SAFETY: `task_ptr` was just heap-allocated above and `async_http` is supplied by
            // the HTTP thread as a live pointer for the duration of the callback.
            S3HttpSimpleTask::http_callback,
            S3HttpSimpleTask::release_at_shutdown,
        ),
        FetchRedirect::Follow,
        HttpOptions {
            http_proxy,
            verbose: Some(verbose),
            reject_unauthorized: Some(reject_unauthorized),
            tls_props: crate::socket::http_client_defaults(vm),
            // SAFETY: `task_ptr` outlives the request; the store is only read
            // through these pointers by the HTTP client.
            signals: Some(unsafe { (*task_ptr).signal_store.to() }),
            ..Default::default()
        },
    );
    // SAFETY: `task_ptr` is still the sole pointer (the HTTP thread only sees it after
    // `schedule` below); scoped exclusive write of the `http` field.
    unsafe { (*task_ptr).http.write(async_http) };
    // queue http request
    bun_http::http_thread::init(&Default::default());
    let mut batch = thread_pool::Batch::default();
    // SAFETY: `http` was initialised immediately above; scoped exclusive access.
    unsafe { (*task_ptr).http.assume_init_mut() }.schedule(&mut batch);
    // Out on the HTTP thread until its final callback: its context aborts it
    // when it stops, and the VM waits for it (the ticket).
    // SAFETY: as above; the task is heap-allocated and drops its handle with itself.
    unsafe {
        let vm = VirtualMachine::get();
        (*task_ptr).http_ticket = Some(vm.ticket());
        (*task_ptr).context = context.id();
        bun_jsc::AbortHandle::arm_owner(task_ptr, context);
    }
    bun_http::HTTPThread::schedule(batch);
    Ok(())
}
