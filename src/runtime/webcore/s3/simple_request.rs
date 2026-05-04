use core::ffi::c_void;

use bun_aio::KeepAlive;
use bun_http::{AsyncHTTP, HTTPClientResult, HTTPThread, Headers, Method};
use bun_jsc::{ConcurrentTask, JsTerminated, VirtualMachine};
use bun_picohttp as picohttp;
use bun_s3_signing::acl::ACL;
use bun_s3_signing::credentials::{S3Credentials, SignResult};
use bun_s3_signing::error::{get_sign_error_code_and_message, S3Error};
use bun_s3_signing::storage_class::StorageClass;
use bun_str::strings;
use bun_str::MutableString;
use bun_threading::ThreadPool;
use bun_url::URL;

use super::list_objects;

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

pub enum S3DeleteResult<'a> {
    Success,
    NotFound(S3Error<'a>),
    /// failure error is not owned and need to be copied if used after this callback
    Failure(S3Error<'a>),
}

pub enum S3ListObjectsResult<'a> {
    Success(list_objects::S3ListObjectsV2Result),
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
    pub http: AsyncHTTP,
    pub vm: &'static VirtualMachine,
    pub sign_result: SignResult,
    pub headers: Headers,
    pub callback_context: *mut c_void,
    pub callback: Callback,
    pub response_buffer: MutableString,
    pub result: HTTPClientResult,
    pub concurrent_task: ConcurrentTask,
    pub range: Option<Box<[u8]>>,
    /// Owned dupe of the proxy URL. The env-derived proxy slice can be freed
    /// by a concurrent process.env.HTTP_PROXY write while the HTTP thread is
    /// in flight, so we must own our copy for the task's lifetime.
    pub proxy_url: Box<[u8]>,
    pub poll_ref: KeepAlive,
}

// TODO(port): bun.JSTerminated is `error{Terminated}` — confirm bun_jsc::JsTerminated is the right newtype
type JsTerminatedResult<T> = Result<T, JsTerminated>;

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
    pub fn fail(&self, code: &[u8], message: &[u8], context: *mut c_void) -> JsTerminatedResult<()> {
        let err = S3Error { code, message };
        match self {
            Callback::Upload(callback) => callback(S3UploadResult::Failure(err), context)?,
            Callback::Download(callback) => callback(S3DownloadResult::Failure(err), context)?,
            Callback::Stat(callback) => callback(S3StatResult::Failure(err), context)?,
            Callback::Delete(callback) => callback(S3DeleteResult::Failure(err), context)?,
            Callback::ListObjects(callback) => callback(S3ListObjectsResult::Failure(err), context)?,
            Callback::Commit(callback) => callback(S3CommitResult::Failure(err), context)?,
            Callback::Part(callback) => callback(S3PartResult::Failure(err), context)?,
        }
        Ok(())
    }

    pub fn not_found(&self, code: &[u8], message: &[u8], context: *mut c_void) -> JsTerminatedResult<()> {
        let err = S3Error { code, message };
        match self {
            Callback::Download(callback) => callback(S3DownloadResult::NotFound(err), context)?,
            Callback::Stat(callback) => callback(S3StatResult::NotFound(err), context)?,
            Callback::Delete(callback) => callback(S3DeleteResult::NotFound(err), context)?,
            Callback::ListObjects(callback) => callback(S3ListObjectsResult::NotFound(err), context)?,
            _ => self.fail(code, message, context)?,
        }
        Ok(())
    }
}

#[derive(core::marker::ConstParamTy, PartialEq, Eq, Clone, Copy)]
enum ErrorType {
    NotFound,
    Failure,
}

impl S3HttpSimpleTask {
    // bun.TrivialNew(@This()) — heap-allocate; pointer crosses thread boundary via http callback
    pub fn new(init: Self) -> *mut Self {
        Box::into_raw(Box::new(init))
    }

    fn error_with_body<const ERROR_TYPE: ErrorType>(&self) -> JsTerminatedResult<()> {
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
                    if let Some(end) = strings::index_of(bytes, b"</Code>") {
                        code = &bytes[start + b"<Code>".len()..end];
                        has_error_code = true;
                    }
                }
                if let Some(start) = strings::index_of(bytes, b"<Message>") {
                    if let Some(end) = strings::index_of(bytes, b"</Message>") {
                        message = &bytes[start + b"<Message>".len()..end];
                    }
                }
            }
        }

        if ERROR_TYPE == ErrorType::NotFound {
            if !has_error_code {
                code = b"NoSuchKey";
                message = b"The specified key does not exist.";
            }
            self.callback.not_found(code, message, self.callback_context)?;
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
                        if let Some(end) = strings::index_of(bytes, b"</Code>") {
                            code = &bytes[start + b"<Code>".len()..end];
                        }
                    }
                    if let Some(start) = strings::index_of(bytes, b"<Message>") {
                        if let Some(end) = strings::index_of(bytes, b"</Message>") {
                            message = &bytes[start + b"<Message>".len()..end];
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
        // SAFETY: `this` was produced by `S3HttpSimpleTask::new` (Box::into_raw) and ownership is
        // reclaimed here exactly once via the ConcurrentTask `.manual_deinit` contract. Dropping
        // `this` at scope exit replaces Zig's `defer this.deinit()`.
        let mut this = unsafe { Box::from_raw(this) };

        if !this.result.is_success() {
            this.error_with_body::<{ ErrorType::Failure }>()?;
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
                                .and_then(|s| strings::parse_int::<usize>(s, 10).ok())
                                .unwrap_or(0),
                            // TODO(port): confirm bun_str::strings::parse_int signature (std.fmt.parseInt equiv)
                        }),
                        this.callback_context,
                    )?;
                }
                404 => this.error_with_body::<{ ErrorType::NotFound }>()?,
                _ => this.error_with_body::<{ ErrorType::Failure }>()?,
            },
            Callback::Delete(callback) => match response.status_code {
                200 | 204 => callback(S3DeleteResult::Success, this.callback_context)?,
                404 => this.error_with_body::<{ ErrorType::NotFound }>()?,
                _ => this.error_with_body::<{ ErrorType::Failure }>()?,
            },
            Callback::ListObjects(callback) => match response.status_code {
                200 => {
                    if let Some(body) = &this.result.body {
                        match list_objects::parse_s3_list_objects_result(body.slice()) {
                            Ok(success) => {
                                callback(S3ListObjectsResult::Success(success), this.callback_context)?;
                            }
                            Err(_) => {
                                this.error_with_body::<{ ErrorType::Failure }>()?;
                                return Ok(());
                            }
                        }
                    } else {
                        this.error_with_body::<{ ErrorType::Failure }>()?;
                    }
                }
                404 => this.error_with_body::<{ ErrorType::NotFound }>()?,
                _ => this.error_with_body::<{ ErrorType::Failure }>()?,
            },
            Callback::Upload(callback) => match response.status_code {
                200 => callback(S3UploadResult::Success, this.callback_context)?,
                _ => this.error_with_body::<{ ErrorType::Failure }>()?,
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
                404 => this.error_with_body::<{ ErrorType::NotFound }>()?,
                _ => {
                    // error
                    this.error_with_body::<{ ErrorType::Failure }>()?;
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
                        this.error_with_body::<{ ErrorType::Failure }>()?;
                    }
                }
            }
        }
        Ok(())
    }

    /// this is the callback from the http.zig AsyncHTTP is always called from the HTTPThread
    pub fn http_callback(this: &mut Self, async_http: &mut AsyncHTTP, result: HTTPClientResult) {
        let is_done = !result.has_more;
        this.result = result;
        // TODO(port): Zig does `this.http = async_http.*` (copies the whole AsyncHTTP). Verify
        // AsyncHTTP is Clone or this should be a move/swap in the Rust port.
        this.http = async_http.clone();
        this.response_buffer = async_http.response_buffer.clone();
        if is_done {
            this.vm
                .event_loop()
                .enqueue_task_concurrent(this.concurrent_task.from(this, ConcurrentTask::AutoDeinit::ManualDeinit));
            // TODO(port): ConcurrentTask::from signature / AutoDeinit enum path
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
        self.poll_ref.unref(self.vm);
        self.http.clear_data();
    }
}

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

pub fn execute_simple_s3_request(
    this: &S3Credentials,
    options: S3SimpleRequestOptions<'_>,
    callback: Callback,
    callback_context: *mut c_void,
) -> JsTerminatedResult<()> {
    let mut result = match this.sign_request(
        // TODO(port): SignOptions struct path / field names in bun_s3_signing
        bun_s3_signing::credentials::SignOptions {
            path: options.path,
            method: options.method,
            search_params: options.search_params,
            content_disposition: options.content_disposition,
            content_encoding: options.content_encoding,
            acl: options.acl,
            storage_class: options.storage_class,
            request_payer: options.request_payer,
        },
        false,
        None,
    ) {
        Ok(r) => r,
        Err(sign_err) => {
            // options.range drops here automatically (Zig: bun.default_allocator.free(range_))
            drop(options.range);
            let error_code_and_message = get_sign_error_code_and_message(sign_err);
            callback.fail(error_code_and_message.code, error_code_and_message.message, callback_context)?;
            return Ok(());
        }
    };

    let headers = 'brk: {
        // TODO(port): uninit picohttp::Header array — need Default/zeroed for Header
        let mut header_buffer: [picohttp::Header; SignResult::MAX_HEADERS + 1] =
            // SAFETY: picohttp::Header is POD; zero-initialized is valid (Zig used `= undefined`).
            unsafe { core::mem::zeroed() };
        if let Some(range_) = &options.range {
            let _headers = result.mix_with_header(&mut header_buffer, picohttp::Header { name: b"range", value: range_ });
            break 'brk Headers::from_pico_http_headers(_headers);
        } else {
            if let Some(content_type) = options.content_type {
                if !content_type.is_empty() {
                    let _headers = result.mix_with_header(
                        &mut header_buffer,
                        picohttp::Header { name: b"Content-Type", value: content_type },
                    );
                    break 'brk Headers::from_pico_http_headers(_headers);
                }
            }
            break 'brk Headers::from_pico_http_headers(result.headers());
        }
    };

    let task = S3HttpSimpleTask::new(S3HttpSimpleTask {
        // SAFETY: `http` is overwritten below before any read; Zig used `= undefined`.
        http: unsafe { core::mem::zeroed() },
        // TODO(port): AsyncHTTP likely cannot be zeroed — use MaybeUninit or a two-phase init helper
        sign_result: result,
        callback_context,
        callback,
        range: options.range,
        headers,
        vm: VirtualMachine::get(),
        response_buffer: MutableString::default(),
        result: HTTPClientResult::default(),
        concurrent_task: ConcurrentTask::default(),
        proxy_url: Box::default(),
        poll_ref: KeepAlive::init(),
    });
    // SAFETY: `task` is a freshly Box::into_raw'd pointer; exclusive access here.
    let task = unsafe { &mut *task };
    task.poll_ref.ref_(task.vm);

    let url = URL::parse(&task.sign_result.url);
    let proxy = options.proxy_url.unwrap_or(b"");
    task.proxy_url = if !proxy.is_empty() { Box::<[u8]>::from(proxy) } else { Box::default() };
    task.http = AsyncHTTP::init(
        options.method,
        url,
        &task.headers.entries,
        task.headers.buf.as_slice(),
        &mut task.response_buffer,
        options.body,
        // TODO(port): HTTPClientResult::Callback::New(*T, fn).init(task) generic wrapper shape
        bun_http::http_client_result::Callback::new::<S3HttpSimpleTask>(task, S3HttpSimpleTask::http_callback),
        bun_http::Redirect::Follow,
        bun_http::Options {
            http_proxy: if !task.proxy_url.is_empty() { Some(URL::parse(&task.proxy_url)) } else { None },
            verbose: task.vm.get_verbose_fetch(),
            reject_unauthorized: task.vm.get_tls_reject_unauthorized(),
            ..Default::default()
        },
    );
    // queue http request
    HTTPThread::init(&Default::default());
    let mut batch = ThreadPool::Batch::default();
    task.http.schedule(&mut batch);
    bun_http::http_thread().schedule(batch);
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/s3/simple_request.zig (464 lines)
//   confidence: medium
//   todos:      11
//   notes:      AsyncHTTP undefined-init + struct copy in http_callback need real init/clone API; result enums carry <'a> for borrowed callback payloads (BORROW_PARAM class — Phase B revisit)
// ──────────────────────────────────────────────────────────────────────────
