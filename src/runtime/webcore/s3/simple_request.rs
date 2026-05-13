use core::ffi::c_void;

use bun_core::MutableString;
use bun_core::strings;
use bun_event_loop::ConcurrentTask::{AutoDeinit, ConcurrentTask};
use bun_event_loop::{TaskTag, Taskable, task_tag};
use bun_http::async_http::Options as HttpOptions;
use bun_http::{
    AsyncHTTP, FetchRedirect, HTTPClientResult, HTTPClientResultCallback, HTTPThread, Headers,
    HeadersExt, Method,
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

use crate::webcore::s3::list_objects;

// PORT NOTE: result/options structs below carry borrowed slices that are valid only for the
// duration of the callback invocation (Zig comments say "not owned and need to be copied if used
// after this callback"). They get an explicit `<'a>` even though PORTING.md's []const u8 row says
// "never put a lifetime param on a struct in Phase A" — these are ephemeral stack-only callback
// payloads (never heap-stored), which falls under LIFETIMES.tsv class BORROW_PARAM (struct gets
// `<'a>`). Phase B may swap to raw `*const [u8]` if borrowck reshaping proves cleaner.
// TODO(port): revisit <'a> vs raw-ptr for callback payload structs in Phase B

#[derive(Default)]
pub struct S3StatSuccess<'a> {
    pub size: usize,
    /// etag is not owned and need to be copied if used after this callback
    pub etag: &'a [u8],
    /// format: Mon, 06 Jan 2025 22:40:57 GMT, lastModified is not owned and need to be copied if used after this callback
    pub last_modified: &'a [u8],
    /// format: text/plain, contentType is not owned and need to be copied if used after this callback
    pub content_type: &'a [u8],
}

pub enum S3StatResult<'a> {
    Success(S3StatSuccess<'a>),
    NotFound(S3Error<'a>),
    /// failure error is not owned and need to be copied if used after this callback
    Failure(S3Error<'a>),
}

pub struct S3DownloadSuccess<'a> {
    /// etag is not owned and need to be copied if used after this callback
    pub etag: &'a [u8],
    /// body is owned and dont need to be copied, but dont forget to free it
    pub body: MutableString,
}

pub enum S3DownloadResult<'a> {
    Success(S3DownloadSuccess<'a>),
    NotFound(S3Error<'a>),
    /// failure error is not owned and need to be copied if used after this callback
    Failure(S3Error<'a>),
}

pub enum S3UploadResult<'a> {
    Success,
    /// failure error is not owned and need to be copied if used after this callback
    Failure(S3Error<'a>),
}

// PORT NOTE: manual Debug because upstream `S3Error` (bun_s3_signing) doesn't derive Debug and
// we may not edit that crate from here. Only the variant tag is needed for `scoped_log!`.
impl core::fmt::Debug for S3UploadResult<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            S3UploadResult::Success => f.write_str("Success"),
            S3UploadResult::Failure(err) => f
                .debug_struct("Failure")
                .field("code", &String::from_utf8_lossy(err.code))
                .field("message", &String::from_utf8_lossy(err.message))
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
    Success(list_objects::S3ListObjectsV2Result<'a>),
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

pub struct S3HttpSimpleTask {
    // PORT NOTE: `http` is `MaybeUninit` because (a) Zig initialises it as `= undefined` and
    // overwrites it later — `AsyncHTTP` contains `&'static [u8]` and `fn(...)` fields, so a
    // zeroed/default value would be instant UB; and (b) Zig's `deinit` only calls
    // `http.clearData()`, never a full destructor, and `httpCallback` does a no-drop bitwise
    // overwrite. Wrapping in `MaybeUninit` lets us match those semantics exactly: write-without-
    // drop on assignment, and `clear_data()`-only in `Drop`. Invariant: `http` is initialised by
    // `execute_simple_s3_request` before the task pointer escapes, so every later access (in
    // `http_callback` / `Drop`) may `assume_init`.
    pub http: core::mem::MaybeUninit<AsyncHTTP<'static>>,
    /// JSC_BORROW: per-thread VM singleton, outlives every task. `None` only in
    /// the inert `Default` placeholder (overwritten before the task escapes).
    pub vm: Option<bun_ptr::BackRef<VirtualMachine>>,
    pub sign_result: SignResult,
    pub headers: Headers,
    pub callback_context: *mut c_void,
    pub callback: Callback,
    pub response_buffer: MutableString,
    // PORT NOTE: `'static` here because `result.body` (when set) points at our own
    // `response_buffer` — self-referential, so the borrow lives as long as the task.
    pub result: HTTPClientResult<'static>,
    pub concurrent_task: ConcurrentTask,
    pub range: Option<Box<[u8]>>,
    /// Owned dupe of the proxy URL. The env-derived proxy slice can be freed
    /// by a concurrent process.env.HTTP_PROXY write while the HTTP thread is
    /// in flight, so we must own our copy for the task's lifetime.
    pub proxy_url: Box<[u8]>,
    pub poll_ref: KeepAlive,
}

impl Taskable for S3HttpSimpleTask {
    const TAG: TaskTag = task_tag::S3HttpSimpleTask;
}

// PORT NOTE: Zig only defaults `response_buffer`/`result`/`concurrent_task`; Rust's
// `..Default::default()` requires the whole struct to be Default, so the remaining fields get
// inert placeholders that callers always overwrite (see client.rs / execute_simple_s3_request).
impl Default for S3HttpSimpleTask {
    fn default() -> Self {
        fn unset_callback(_: S3UploadResult<'_>, _: *mut c_void) -> JsTerminatedResult<()> {
            unreachable!("S3HttpSimpleTask.callback used before being set")
        }
        Self {
            http: core::mem::MaybeUninit::uninit(),
            vm: None,
            sign_result: SignResult::default(),
            headers: Headers::default(),
            callback_context: core::ptr::null_mut(),
            callback: Callback::Upload(unset_callback),
            response_buffer: MutableString::default(),
            result: HTTPClientResult::default(),
            concurrent_task: ConcurrentTask::default(),
            range: None,
            proxy_url: Box::default(),
            poll_ref: KeepAlive::default(),
        }
    }
}

// Re-export the canonical alias so sibling modules that imported it from here keep compiling.
pub use bun_jsc::JsTerminatedResult;

pub enum Callback {
    Stat(fn(S3StatResult<'_>, *mut c_void) -> JsTerminatedResult<()>),
    Download(fn(S3DownloadResult<'_>, *mut c_void) -> JsTerminatedResult<()>),
    Upload(fn(S3UploadResult<'_>, *mut c_void) -> JsTerminatedResult<()>),
    Delete(fn(S3DeleteResult<'_>, *mut c_void) -> JsTerminatedResult<()>),
    ListObjects(fn(S3ListObjectsResult<'_>, *mut c_void) -> JsTerminatedResult<()>),
    Commit(fn(S3CommitResult<'_>, *mut c_void) -> JsTerminatedResult<()>),
    Part(fn(S3PartResult<'_>, *mut c_void) -> JsTerminatedResult<()>),
}

impl Callback {
    pub fn fail(
        &self,
        code: &[u8],
        message: &[u8],
        context: *mut c_void,
    ) -> JsTerminatedResult<()> {
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

    pub fn not_found(
        &self,
        code: &[u8],
        message: &[u8],
        context: *mut c_void,
    ) -> JsTerminatedResult<()> {
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

// PORT NOTE: Zig used `comptime error_type` and an enum const-generic. Stable Rust forbids
// enum const params (`adt_const_params` is unstable), so this is a runtime parameter — the
// branch is on an error path, no perf concern.
#[derive(PartialEq, Eq, Clone, Copy)]
enum ErrorType {
    NotFound,
    Failure,
}

impl S3HttpSimpleTask {
    // bun.TrivialNew(@This()) — heap-allocate; pointer crosses thread boundary via http callback
    pub fn new(init: Self) -> *mut Self {
        bun_core::heap::into_raw(Box::new(init))
    }

    fn error_with_body(&self, error_type: ErrorType) -> JsTerminatedResult<()> {
        let mut code: &[u8] = b"UnknownError";
        let mut message: &[u8] = b"an unexpected error has occurred";
        let mut has_error_code = false;
        if let Some(err) = self.result.fail {
            // TODO(port): result.fail is anyerror (bun_core::Error) — .name() returns &'static str
            code = err.name().as_bytes();
            has_error_code = true;
        } else if let Some(body) = &self.result.body {
            let bytes = body.list.as_slice();
            if !bytes.is_empty() {
                message = bytes;
                if let Some(start) = strings::index_of(bytes, b"<Code>") {
                    let value_start = start + b"<Code>".len();
                    if let Some(end) = strings::index_of(bytes, b"</Code>") {
                        if end >= value_start {
                            code = &bytes[value_start..end];
                            has_error_code = true;
                        }
                    }
                }
                if let Some(start) = strings::index_of(bytes, b"<Message>") {
                    let value_start = start + b"<Message>".len();
                    if let Some(end) = strings::index_of(bytes, b"</Message>") {
                        if end >= value_start {
                            message = &bytes[value_start..end];
                        }
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

    fn fail_if_contains_error(&mut self, status: u32) -> JsTerminatedResult<bool> {
        let mut code: &[u8] = b"UnknownError";
        let mut message: &[u8] = b"an unexpected error has occurred";

        if let Some(err) = self.result.fail {
            code = err.name().as_bytes();
        } else if let Some(body) = &self.result.body {
            let bytes = body.list.as_slice();
            let mut has_error = false;
            if !bytes.is_empty() {
                message = bytes;
                if strings::index_of(bytes, b"<Error>").is_some() {
                    has_error = true;
                    if let Some(start) = strings::index_of(bytes, b"<Code>") {
                        let value_start = start + b"<Code>".len();
                        if let Some(end) = strings::index_of(bytes, b"</Code>") {
                            if end >= value_start {
                                code = &bytes[value_start..end];
                            }
                        }
                    }
                    if let Some(start) = strings::index_of(bytes, b"<Message>") {
                        let value_start = start + b"<Message>".len();
                        if let Some(end) = strings::index_of(bytes, b"</Message>") {
                            if end >= value_start {
                                message = &bytes[value_start..end];
                            }
                        }
                    }
                }
            }
            // PORT NOTE: Zig precedence: `!has_error and status == 200 or status == 206`
            // is `(!has_error && status == 200) || status == 206` — preserved verbatim.
            if (!has_error && status == 200) || status == 206 {
                return Ok(false);
            }
        } else if status == 200 || status == 206 {
            return Ok(false);
        }
        self.callback.fail(code, message, self.callback_context)?;
        Ok(true)
    }

    /// this is the task callback from the last task result and is always in the main thread
    pub fn on_response(this: *mut Self) -> JsTerminatedResult<()> {
        // SAFETY: `this` was produced by `S3HttpSimpleTask::new` (heap::alloc) and ownership is
        // reclaimed here exactly once via the ConcurrentTask `.manual_deinit` contract. Dropping
        // `this` at scope exit replaces Zig's `defer this.deinit()`.
        let mut this = unsafe { bun_core::heap::take(this) };

        if !this.result.is_success() {
            this.error_with_body(ErrorType::Failure)?;
            return Ok(());
        }
        debug_assert!(this.result.metadata.is_some());
        // PORT NOTE: reshaped for borrowck — borrow response once, dispatch on a copy of `callback`.
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
                _ => this.error_with_body(ErrorType::Failure)?,
            },
            Callback::Delete(callback) => match response.status_code {
                200 | 204 => callback(S3DeleteResult::Success, this.callback_context)?,
                404 => this.error_with_body(ErrorType::NotFound)?,
                _ => this.error_with_body(ErrorType::Failure)?,
            },
            Callback::ListObjects(callback) => match response.status_code {
                200 => {
                    if let Some(body) = &this.result.body {
                        // PORT NOTE: parse_s3_list_objects_result is now infallible (alloc-only
                        // failure modes abort in Rust), so the Zig `catch` arm is unreachable.
                        let success =
                            list_objects::parse_s3_list_objects_result(body.list.as_slice());
                        callback(S3ListObjectsResult::Success(success), this.callback_context)?;
                    } else {
                        this.error_with_body(ErrorType::Failure)?;
                    }
                }
                404 => this.error_with_body(ErrorType::NotFound)?,
                _ => this.error_with_body(ErrorType::Failure)?,
            },
            Callback::Upload(callback) => match response.status_code {
                200 => callback(S3UploadResult::Success, this.callback_context)?,
                _ => this.error_with_body(ErrorType::Failure)?,
            },
            Callback::Download(callback) => match response.status_code {
                200 | 204 | 206 => {
                    let body = core::mem::take(&mut this.response_buffer);
                    // PORT NOTE: re-borrow response after &mut access to response_buffer
                    let response = &this.result.metadata.as_ref().unwrap().response;
                    callback(
                        S3DownloadResult::Success(S3DownloadSuccess {
                            etag: response.headers.get(b"etag").unwrap_or(b""),
                            body,
                        }),
                        this.callback_context,
                    )?;
                }
                404 => this.error_with_body(ErrorType::NotFound)?,
                _ => {
                    // error
                    this.error_with_body(ErrorType::Failure)?;
                }
            },
            Callback::Commit(callback) => {
                // commit multipart upload can fail with status 200
                let status = response.status_code;
                if !this.fail_if_contains_error(status)? {
                    callback(S3CommitResult::Success, this.callback_context)?;
                }
            }
            Callback::Part(callback) => {
                let status = response.status_code;
                if !this.fail_if_contains_error(status)? {
                    let response = &this.result.metadata.as_ref().unwrap().response;
                    if let Some(etag) = response.headers.get(b"etag") {
                        callback(S3PartResult::Etag(etag), this.callback_context)?;
                    } else {
                        this.error_with_body(ErrorType::Failure)?;
                    }
                }
            }
        }
        Ok(())
    }

    /// this is the callback from the http.zig AsyncHTTP is always called from the HTTPThread
    pub fn http_callback(
        this: *mut Self,
        async_http: *mut AsyncHTTP<'static>,
        result: HTTPClientResult<'_>,
    ) {
        // SAFETY: `this` was produced by `S3HttpSimpleTask::new` and is exclusively owned by the
        // HTTP thread until enqueued back to the JS thread below.
        let this = unsafe { &mut *this };
        let is_done = !result.has_more;
        // SAFETY: `result.body` (the only borrowed field) points at `this.response_buffer`, which
        // lives for the task's lifetime — extending to `'static` here is sound for self-reference.
        this.result = unsafe { result.detach_lifetime() };
        // PORT NOTE: Zig does `this.http = async_http.*` (bitwise struct overwrite, no destructor
        // on either side). `AsyncHTTP` transitively owns Drop types (`HTTPClient`, header
        // `EntryList`s), so a plain Rust `=` here would (a) drop the old `this.http`, freeing heap
        // buffers that `*async_http` (a bitwise clone created by the HTTP thread) still aliases,
        // and (b) leave the http-thread side to drop them again → double-free. We instead write
        // through `MaybeUninit` to suppress the LHS drop and match Zig's overwrite semantics
        // exactly. Ownership of the inner heap data conceptually transfers here; the http-thread
        // side must free only its outer allocation (TrivialDeinit), mirroring AsyncHTTP.zig.
        // SAFETY: `async_http` is a valid live pointer for the duration of this callback;
        // `this.http` was previously initialised in `execute_simple_s3_request`.
        unsafe { core::ptr::write(this.http.as_mut_ptr(), core::ptr::read(async_http)) };
        // PORT NOTE: Zig's `this.response_buffer = async_http.response_buffer.*` is a no-op
        // bitwise self-copy (`async_http.response_buffer == &this.response_buffer`). In Rust the
        // equivalent `=` would drop the live Vec before re-installing a stale bitwise duplicate
        // (UAF + double-free), so we simply omit it — `this.response_buffer` already holds the
        // body.
        if is_done {
            // PORT NOTE: compute the raw self-pointer before borrowing `this.concurrent_task`
            // to avoid a stacked-borrows / aliasing diagnostic on `*this`.
            let this_ptr = std::ptr::from_mut::<Self>(this);
            let task = std::ptr::from_mut::<ConcurrentTask>(
                this.concurrent_task
                    .from(this_ptr, AutoDeinit::ManualDeinit),
            );
            // `vm` is the live per-thread VM BackRef captured at task creation; event_loop
            // is set during VM init and outlives this task. `enqueue_task_concurrent` is `&self`.
            this.vm
                .expect("vm set at task creation")
                .event_loop_shared()
                .enqueue_task_concurrent(task);
        }
    }
}

impl Drop for S3HttpSimpleTask {
    fn drop(&mut self) {
        // Side effects beyond freeing owned fields (which Rust drops automatically):
        // - poll_ref.unref(vm)
        // - http.clearData()
        // Owned-field frees from the Zig deinit (response_buffer, headers, sign_result, range,
        // proxy_url, result.certificate_info, result.metadata) are handled by their own Drop impls.
        // TODO(port): verify HTTPClientResult's Drop frees certificate_info/metadata.
        // PORT NOTE: KeepAlive::unref takes an aio EventLoopCtx; the JS-loop ctx is fetched via
        // the global hook (registered by crate::init) — same pattern as
        // `event_loop_handle_to_ctx` in process.rs.
        self.poll_ref.unref(bun_io::posix_event_loop::get_vm_ctx(
            bun_io::AllocatorType::Js,
        ));
        // SAFETY: `http` is always initialised before the task pointer escapes (see
        // `execute_simple_s3_request`); `Drop` only runs via `on_response` after that point.
        // Zig's `deinit` calls only `http.clearData()` and never runs a full AsyncHTTP destructor,
        // so we intentionally do NOT `assume_init_drop` here.
        unsafe { self.http.assume_init_mut() }.clear_data();
    }
}

// PORT NOTE: callers in `client.rs` / `multipart.rs` were translated with three different
// names for the request-options struct (`Options`, `S3RequestOptions`, `S3SimpleRequestOptions`)
// and two for the callback enum. Alias them here so the call sites compile without churn.
pub type Options<'a> = S3SimpleRequestOptions<'a>;
pub type S3RequestOptions<'a> = S3SimpleRequestOptions<'a>;
pub type S3Callback = Callback;

pub struct S3SimpleRequestOptions<'a> {
    // signing options
    pub path: &'a [u8],
    pub method: Method,
    pub search_params: Option<&'a [u8]>,
    pub content_type: Option<&'a [u8]>,
    pub content_disposition: Option<&'a [u8]>,
    pub content_encoding: Option<&'a [u8]>,

    // http request options
    pub body: &'a [u8],
    pub proxy_url: Option<&'a [u8]>,
    /// Owned; ownership transfers to the spawned task (or is dropped on sign error).
    pub range: Option<Box<[u8]>>,
    pub acl: Option<ACL>,
    pub storage_class: Option<StorageClass>,
    pub request_payer: bool,
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

pub fn execute_simple_s3_request(
    this: &S3Credentials,
    options: S3SimpleRequestOptions<'_>,
    callback: Callback,
    callback_context: *mut c_void,
) -> JsTerminatedResult<()> {
    let mut result = match this.sign_request::<false>(
        SignOptions {
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
            // options.range drops here automatically (Zig: bun.default_allocator.free(range_))
            drop(options.range);
            let error_code_and_message = get_sign_error_code_and_message(sign_err.into());
            callback.fail(
                error_code_and_message.code,
                error_code_and_message.message,
                callback_context,
            )?;
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

    let task_ptr = S3HttpSimpleTask::new(S3HttpSimpleTask {
        // Zig used `= undefined`; written below via `MaybeUninit::write` before any read.
        http: core::mem::MaybeUninit::uninit(),
        sign_result: result,
        callback_context,
        callback,
        range: options.range,
        headers,
        vm: Some(bun_ptr::BackRef::new(VirtualMachine::get())),
        response_buffer: MutableString::default(),
        result: HTTPClientResult::default(),
        concurrent_task: ConcurrentTask::default(),
        proxy_url: Box::default(),
        poll_ref: KeepAlive::init(),
    });
    // SAFETY: `task_ptr` is a freshly heap-allocated pointer; exclusive access here.
    let task = unsafe { &mut *task_ptr };
    task.poll_ref.ref_(bun_io::posix_event_loop::get_vm_ctx(
        bun_io::AllocatorType::Js,
    ));

    let proxy = options.proxy_url.unwrap_or(b"");
    task.proxy_url = if !proxy.is_empty() {
        Box::<[u8]>::from(proxy)
    } else {
        Box::default()
    };
    // SAFETY (lifetime extension): `url`, `headers_buf`, and `proxy_url` borrow from
    // heap-allocated fields of `*task` (sign_result.url / headers.buf / proxy_url) which the task
    // outlives. AsyncHTTP::init wants `'static` borrows because the HTTP thread reads them
    // concurrently; they remain valid until `task` is dropped in `on_response`. The Zig source
    // passed raw slices with the same ownership contract.
    let url = URL::parse(unsafe { bun_ptr::detach_lifetime_ref(&*task.sign_result.url) });
    let headers_buf: &'static [u8] =
        unsafe { bun_ptr::detach_lifetime(task.headers.buf.as_slice()) };
    // SAFETY (lifetime extension): unlike the borrows above, `body` is NOT stored in the task —
    // it is caller-owned (e.g. multipart upload part data / multipart_upload_list). The Zig source
    // (.zig:431) passes the caller's slice directly with the same implicit contract: every call
    // site keeps `body` alive until the request completes. This is the PORTING.md-forbidden
    // lifetime-extension pattern, retained verbatim to match Zig semantics.
    // TODO(port): take body as `*const [u8]` in AsyncHTTP::init (or store an owned copy on the
    // task) to drop the `'static` pretence.
    let body: &'static [u8] = unsafe { bun_ptr::detach_lifetime(options.body) };
    let http_proxy = if !task.proxy_url.is_empty() {
        Some(URL::parse(unsafe {
            bun_ptr::detach_lifetime_ref(&*task.proxy_url)
        }))
    } else {
        None
    };
    let vm = VirtualMachine::get();
    let verbose = vm.as_mut().get_verbose_fetch();
    let reject_unauthorized = vm.get_tls_reject_unauthorized();
    task.http.write(AsyncHTTP::init(
        options.method,
        url,
        task.headers.entries.clone().expect("OOM"),
        headers_buf,
        &raw mut task.response_buffer,
        body,
        HTTPClientResultCallback::new::<S3HttpSimpleTask>(
            task_ptr,
            S3HttpSimpleTask::http_callback,
        ),
        FetchRedirect::Follow,
        HttpOptions {
            http_proxy,
            verbose: Some(verbose),
            reject_unauthorized: Some(reject_unauthorized),
            ..Default::default()
        },
    ));
    // queue http request
    bun_http::http_thread::init(&Default::default());
    let mut batch = thread_pool::Batch::default();
    // SAFETY: `http` was initialised by `task.http.write(...)` immediately above.
    unsafe { task.http.assume_init_mut() }.schedule(&mut batch);
    bun_http::HTTPThread::schedule(batch);
    Ok(())
}

// ported from: src/runtime/webcore/s3/simple_request.zig
