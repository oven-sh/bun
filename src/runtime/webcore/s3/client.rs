use core::ffi::c_void;
use core::ptr::NonNull;
use std::io::Write as _;

use bun_collections::ByteList;
use bun_string::MutableString;
#[allow(unused_imports)]
use bun_jsc::{JSGlobalObject, JSValue, JsResult, StringJsc};
use bun_jsc::virtual_machine::VirtualMachine;

use bun_str as strings;

// Re-exports (thin aliases matching the Zig file's top-level `pub const X = @import(...)`)
pub use bun_s3_signing::acl::ACL;
pub use crate::webcore::s3::download_stream::S3HttpDownloadStreamingTask;
pub use crate::webcore::s3::multipart_options::MultiPartUploadOptions;
pub use crate::webcore::s3::multipart::{self, MultiPartUpload};
pub use bun_s3_signing::storage_class::StorageClass;

pub use bun_s3_signing::error as Error;
// PORT NOTE: `throwSignError` / `getJSSignError` live in `error_jsc.zig` (jsc-side
// of the s3_signing error tables). The pure error module is `bun_s3_signing::error`;
// the jsc helpers are mounted here as a child module so the umbrella re-export hub
// matches the Zig `s3/client.zig` shape.
#[path = "error_jsc.rs"]
pub mod error_jsc;
pub use error_jsc::throw_sign_error;
pub use error_jsc::get_js_sign_error;
pub use error_jsc::s3_error_to_js;

pub use bun_s3_signing::credentials::S3Credentials;
pub use bun_s3_signing::credentials::S3CredentialsWithOptions;
use bun_s3_signing::credentials::encode_uri_component;

pub use crate::webcore::s3::simple_request::S3HttpSimpleTask;
pub use crate::webcore::s3::simple_request::S3UploadResult;
pub use crate::webcore::s3::simple_request::S3StatResult;
pub use crate::webcore::s3::simple_request::S3DownloadResult;
pub use crate::webcore::s3::simple_request::S3DeleteResult;
pub use crate::webcore::s3::simple_request::S3ListObjectsResult;
pub use crate::webcore::s3::list_objects::S3ListObjectsOptions;
pub use crate::webcore::s3::list_objects::get_list_objects_options_from_js;

use crate::webcore::s3::simple_request as s3_simple_request;

#[allow(unused_imports)]
use crate::webcore::resumable_sink::{ResumableS3UploadSink, ResumableSinkContext};
use crate::webcore::ResumableSinkBackpressure;

#[allow(unused_imports)]
use crate::webcore::ByteStream;
use crate::webcore::streams::NetworkSink;
use crate::webcore::ReadableStream;
use crate::webcore::readable_stream::Strong as ReadableStreamStrong;
use crate::webcore::readable_stream::Source as ReadableStreamPtr;

bun_core::declare_scope!(S3UploadStream, visible);

// TODO(port): `bun.JSTerminated!T` is not in the type map; assuming a thin alias in bun_jsc.
type JsTerminatedResult<T> = Result<T, bun_jsc::JsTerminated>;

pub fn stat(
    this: &mut S3Credentials,
    path: &[u8],
    callback: fn(S3StatResult, *mut c_void) -> JsTerminatedResult<()>,
    callback_context: *mut c_void,
    proxy_url: Option<&[u8]>,
    request_payer: bool,
) -> JsTerminatedResult<()> {
    s3_simple_request::execute_simple_s3_request(
        this,
        s3_simple_request::Options {
            path,
            method: bun_http::Method::HEAD,
            proxy_url,
            body: b"",
            request_payer,
            ..Default::default()
        },
        s3_simple_request::Callback::Stat(callback),
        callback_context,
    )
}

pub fn download(
    this: &mut S3Credentials,
    path: &[u8],
    callback: fn(S3DownloadResult, *mut c_void) -> JsTerminatedResult<()>,
    callback_context: *mut c_void,
    proxy_url: Option<&[u8]>,
    request_payer: bool,
) -> JsTerminatedResult<()> {
    s3_simple_request::execute_simple_s3_request(
        this,
        s3_simple_request::Options {
            path,
            method: bun_http::Method::GET,
            proxy_url,
            body: b"",
            request_payer,
            ..Default::default()
        },
        s3_simple_request::Callback::Download(callback),
        callback_context,
    )
}

pub fn download_slice(
    this: &mut S3Credentials,
    path: &[u8],
    offset: usize,
    size: Option<usize>,
    callback: fn(S3DownloadResult, *mut c_void) -> JsTerminatedResult<()>,
    callback_context: *mut c_void,
    proxy_url: Option<&[u8]>,
    request_payer: bool,
) -> JsTerminatedResult<()> {
    let range: Option<Vec<u8>> = 'brk: {
        if let Some(size_) = size {
            let mut end = offset + size_;
            if size_ > 0 {
                end -= 1;
            }
            let mut v = Vec::new();
            write!(&mut v, "bytes={}-{}", offset, end).unwrap();
            break 'brk Some(v);
        }
        if offset == 0 {
            break 'brk None;
        }
        let mut v = Vec::new();
        write!(&mut v, "bytes={}-", offset).unwrap();
        Some(v)
    };

    s3_simple_request::execute_simple_s3_request(
        this,
        s3_simple_request::Options {
            path,
            method: bun_http::Method::GET,
            proxy_url,
            body: b"",
            range: range.map(Vec::into_boxed_slice),
            request_payer,
            ..Default::default()
        },
        s3_simple_request::Callback::Download(callback),
        callback_context,
    )
}

pub fn delete(
    this: &mut S3Credentials,
    path: &[u8],
    callback: fn(S3DeleteResult, *mut c_void) -> JsTerminatedResult<()>,
    callback_context: *mut c_void,
    proxy_url: Option<&[u8]>,
    request_payer: bool,
) -> JsTerminatedResult<()> {
    s3_simple_request::execute_simple_s3_request(
        this,
        s3_simple_request::Options {
            path,
            method: bun_http::Method::DELETE,
            proxy_url,
            body: b"",
            request_payer,
            ..Default::default()
        },
        s3_simple_request::Callback::Delete(callback),
        callback_context,
    )
}

pub fn list_objects(
    this: &mut S3Credentials,
    list_options: S3ListObjectsOptions,
    callback: fn(S3ListObjectsResult, *mut c_void) -> JsTerminatedResult<()>,
    callback_context: *mut c_void,
    proxy_url: Option<&[u8]>,
) -> JsTerminatedResult<()> {
    let mut search_params: ByteList = ByteList::default();

    search_params.append_slice(b"?");

    if let Some(continuation_token) = &list_options.continuation_token {
        let mut buff = vec![0u8; continuation_token.len() * 3];
        let encoded =
            encode_uri_component::<true>(continuation_token, &mut buff).expect("unreachable");
        search_params.append_fmt(format_args!(
            "continuation-token={}",
            bstr::BStr::new(encoded)
        ));
    }

    if let Some(delimiter) = &list_options.delimiter {
        let mut buff = vec![0u8; delimiter.len() * 3];
        let encoded = encode_uri_component::<true>(delimiter, &mut buff).expect("unreachable");

        if list_options.continuation_token.is_some() {
            search_params.append_fmt(format_args!("&delimiter={}", bstr::BStr::new(encoded)));
        } else {
            search_params.append_fmt(format_args!("delimiter={}", bstr::BStr::new(encoded)));
        }
    }

    if list_options.encoding_type.is_some() {
        if list_options.continuation_token.is_some() || list_options.delimiter.is_some() {
            search_params.append_slice(b"&encoding-type=url");
        } else {
            search_params.append_slice(b"encoding-type=url");
        }
    }

    if let Some(fetch_owner) = list_options.fetch_owner {
        if list_options.continuation_token.is_some()
            || list_options.delimiter.is_some()
            || list_options.encoding_type.is_some()
        {
            search_params.append_fmt(format_args!("&fetch-owner={}", fetch_owner));
        } else {
            search_params.append_fmt(format_args!("fetch-owner={}", fetch_owner));
        }
    }

    if list_options.continuation_token.is_some()
        || list_options.delimiter.is_some()
        || list_options.encoding_type.is_some()
        || list_options.fetch_owner.is_some()
    {
        search_params.append_slice(b"&list-type=2");
    } else {
        search_params.append_slice(b"list-type=2");
    }

    if let Some(max_keys) = list_options.max_keys {
        search_params.append_fmt(format_args!("&max-keys={}", max_keys));
    }

    if let Some(prefix) = &list_options.prefix {
        let mut buff = vec![0u8; prefix.len() * 3];
        let encoded = encode_uri_component::<true>(prefix, &mut buff).expect("unreachable");
        search_params.append_fmt(format_args!("&prefix={}", bstr::BStr::new(encoded)));
    }

    if let Some(start_after) = &list_options.start_after {
        let mut buff = vec![0u8; start_after.len() * 3];
        let encoded =
            encode_uri_component::<true>(start_after, &mut buff).expect("unreachable");
        search_params.append_fmt(format_args!("&start-after={}", bstr::BStr::new(encoded)));
    }

    let result = match this.sign_request::<true>(
        bun_s3_signing::SignOptions {
            path: b"",
            method: bun_http::Method::GET,
            search_params: Some(search_params.slice()),
            content_hash: None,
            content_md5: None,
            content_disposition: None,
            content_type: None,
            content_encoding: None,
            acl: None,
            storage_class: None,
            request_payer: false,
        },
        None,
    ) {
        Ok(r) => r,
        Err(sign_err) => {
            drop(search_params);

            let error_code_and_message = Error::get_sign_error_code_and_message(sign_err.into());
            callback(
                S3ListObjectsResult::Failure(Error::S3Error {
                    code: error_code_and_message.code,
                    message: error_code_and_message.message,
                }),
                callback_context,
            )?;

            return Ok(());
        }
    };

    drop(search_params);

    let headers = bun_http::Headers::from_pico_http_headers(result.headers());

    let task_ptr = Box::into_raw(Box::new(S3HttpSimpleTask {
        // Zig used `= undefined`; written below via `MaybeUninit::write` before any read.
        http: core::mem::MaybeUninit::uninit(),
        range: None,
        sign_result: result,
        callback_context,
        callback: s3_simple_request::Callback::ListObjects(callback),
        headers,
        vm: VirtualMachine::get(),
        response_buffer: MutableString::default(),
        result: bun_http::HTTPClientResult::default(),
        concurrent_task: Default::default(),
        proxy_url: Box::default(),
        poll_ref: bun_aio::KeepAlive::init(),
    }));
    // SAFETY: just allocated, non-null
    let task = unsafe { &mut *task_ptr };

    task.poll_ref.ref_(bun_aio::posix_event_loop::get_vm_ctx(bun_aio::AllocatorType::Js));

    let proxy = proxy_url.unwrap_or(b"");
    task.proxy_url = if !proxy.is_empty() {
        Box::<[u8]>::from(proxy)
    } else {
        Box::<[u8]>::default()
    };

    // SAFETY (lifetime extension): `url`, `headers_buf`, and `proxy_url` borrow from
    // heap-allocated fields of `*task` which the task outlives. AsyncHTTP::init wants
    // `'static` borrows because the HTTP thread reads them concurrently; they remain valid
    // until `task` is dropped in `on_response`.
    let url = bun_url::URL::parse(unsafe { &*(&*task.sign_result.url as *const [u8]) });
    let headers_buf: &'static [u8] = unsafe { &*(task.headers.buf.as_slice() as *const [u8]) };
    let http_proxy = if !task.proxy_url.is_empty() {
        Some(bun_url::URL::parse(unsafe { &*(&*task.proxy_url as *const [u8]) }))
    } else {
        None
    };
    // SAFETY: `task.vm` is the live per-thread VM pointer from `VirtualMachine::get()`.
    let vm = unsafe { &mut *task.vm };

    task.http.write(bun_http::AsyncHTTP::init(
        bun_http::Method::GET,
        url,
        task.headers.entries.clone().expect("OOM"),
        headers_buf,
        &mut task.response_buffer as *mut MutableString,
        b"",
        bun_http::HTTPClientResultCallback::new::<S3HttpSimpleTask>(
            task_ptr,
            S3HttpSimpleTask::http_callback,
        ),
        bun_http::FetchRedirect::Follow,
        bun_http::async_http::Options {
            http_proxy,
            verbose: Some(vm.get_verbose_fetch()),
            reject_unauthorized: Some(vm.get_tls_reject_unauthorized()),
            ..Default::default()
        },
    ));

    // queue http request
    bun_http::http_thread::init(&Default::default());
    let mut batch = bun_threading::thread_pool::Batch::default();
    // SAFETY: `http` was initialised by `task.http.write(...)` immediately above.
    unsafe { task.http.assume_init_mut() }.schedule(&mut batch);
    bun_http::http_thread().schedule(batch);
    Ok(())
}

pub fn upload(
    this: &mut S3Credentials,
    path: &[u8],
    content: &[u8],
    content_type: Option<&[u8]>,
    content_disposition: Option<&[u8]>,
    content_encoding: Option<&[u8]>,
    acl: Option<ACL>,
    proxy_url: Option<&[u8]>,
    storage_class: Option<StorageClass>,
    request_payer: bool,
    callback: fn(S3UploadResult, *mut c_void) -> JsTerminatedResult<()>,
    callback_context: *mut c_void,
) -> JsTerminatedResult<()> {
    s3_simple_request::execute_simple_s3_request(
        this,
        s3_simple_request::Options {
            path,
            method: bun_http::Method::PUT,
            proxy_url,
            body: content,
            content_type,
            content_disposition,
            content_encoding,
            acl,
            storage_class,
            request_payer,
            ..Default::default()
        },
        s3_simple_request::Callback::Upload(callback),
        callback_context,
    )
}

// TODO(b2-blocked): NetworkSink — `streams::NetworkSink` and its `JSSink::SinkSignal`
// are gated alongside `HTTPServerWritable` in `webcore/streams.rs`. Un-gate together.

/// returns a writable stream that writes to the s3 path
pub fn writable_stream(
    this: &mut S3Credentials,
    path: &[u8],
    global_this: &JSGlobalObject,
    options: MultiPartUploadOptions,
    content_type: Option<&[u8]>,
    content_disposition: Option<&[u8]>,
    content_encoding: Option<&[u8]>,
    proxy: Option<&[u8]>,
    storage_class: Option<StorageClass>,
    request_payer: bool,
) -> JsResult<JSValue> {
    // Local callback wrapper (Zig: `const Wrapper = struct { pub fn callback(...) }`)
    fn wrapper_callback(result: S3UploadResult, sink: &mut NetworkSink) -> JsTerminatedResult<()> {
        // SAFETY: global_this set at construction; non-null while sink is live.
        let global = unsafe { &*sink.global_this };
        if sink.end_promise.has_value() || sink.flush_promise.has_value() {
            // SAFETY: `bun_vm()` returns the live per-thread VM pointer.
            let event_loop = unsafe { (*global.bun_vm()).event_loop() };
            // SAFETY: event_loop is initialised for the lifetime of the VM.
            unsafe { (*event_loop).enter() };
            // PORT NOTE: reshaped for borrowck — Zig used `defer event_loop.exit()`
            let _exit_guard = scopeguard::guard((), move |_| unsafe { (*event_loop).exit() });
            match result {
                S3UploadResult::Success => {
                    if sink.flush_promise.has_value() {
                        sink.flush_promise.resolve(global, JSValue::js_number(0.0))?;
                    }
                    if sink.end_promise.has_value() {
                        sink.end_promise.resolve(global, JSValue::js_number(0.0))?;
                    }
                }
                S3UploadResult::Failure(err) => {
                    let js_err = s3_error_to_js(&err, global, sink.path());
                    if sink.flush_promise.has_value() {
                        sink.flush_promise.reject(global, Ok(js_err))?;
                    }
                    if sink.end_promise.has_value() {
                        sink.end_promise.reject(global, Ok(js_err))?;
                    }
                    if !sink.done {
                        sink.abort();
                    }
                }
            }
        }
        sink.finalize();
        Ok(())
    }

    let _ = (
        this,
        path,
        global_this,
        options,
        content_type,
        content_disposition,
        content_encoding,
        proxy,
        storage_class,
        request_payer,
        wrapper_callback as fn(_, _) -> _,
    );
    // TODO(port): MultiPartUpload struct-literal init requires `Arc<S3Credentials>` (we have
    // `&mut S3Credentials`) and has no Default; the JSSink/SinkSignal codegen wrapper is also
    // gated. Port the body once both are wired.
    todo!("blocked_on: bun_s3::MultiPartUpload literal init (Arc<S3Credentials> from &mut) + sink::SinkSignal codegen")
}

// TODO(b2-blocked): ResumableS3UploadSink — `webcore::resumable_sink` is gated on
// `bun_jsc::codegen::JSResumableS3UploadSink`. The wrapper + `upload_stream` /
// `readable_stream` below are the only consumers; un-gate as a unit.

mod _upload_stream_gated {
use super::*;

pub struct S3UploadStreamWrapper {
    // intrusive ref_count — bun.ptr.RefCount(@This(), "ref_count", deinit, .{}) → bun_ptr::IntrusiveRc<Self>
    pub ref_count: core::cell::Cell<u32>,

    pub sink: Option<*mut ResumableS3UploadSink<'static>>,
    pub task: *mut MultiPartUpload,
    pub end_promise: bun_jsc::JSPromiseStrong,
    pub callback: Option<fn(S3UploadResult, *mut c_void)>,
    pub callback_context: *mut c_void,
    /// this is owned by the task not by the wrapper
    pub path: *const [u8],
    pub global: &'static JSGlobalObject, // JSC_BORROW
}

/// Intrusive ref-counted handle. `ref()`/`deref()` from the Zig `bun.ptr.RefCount` mixin
/// are provided by cloning/dropping this handle; `Drop for S3UploadStreamWrapper` runs the
/// finalizer body when the last ref is released.
pub type S3UploadStreamWrapperRef = *mut S3UploadStreamWrapper;

// Zig: `pub const ResumableSink = @import("../ResumableSink.zig").ResumableS3UploadSink;`
// Inherent associated types are unstable; expose as a module-level alias instead.
pub type ResumableSink = ResumableS3UploadSink<'static>;

impl S3UploadStreamWrapper {
    /// Intrusive `ref()` — bumps the ref_count.
    pub fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }

    /// Intrusive `deref()` — decrements ref_count; runs finalizer + frees on zero.
    /// SAFETY: `this` must be a live Box-allocated `Self` (created via Box::into_raw).
    pub unsafe fn deref_(this: *mut Self) {
        // SAFETY: caller contract above.
        let rc = unsafe { (*this).ref_count.get() } - 1;
        unsafe { (*this).ref_count.set(rc) };
        if rc == 0 {
            // SAFETY: ref_count hit zero; reconstitute the Box to run Drop and free.
            drop(unsafe { Box::from_raw(this) });
        }
    }

    fn detach_sink(&mut self) {
        bun_output::scoped_log!(S3UploadStream, "detachSink {}", self.sink.is_some());
        if let Some(sink) = self.sink.take() {
            // SAFETY: sink is a live Box-allocated ResumableSink; deref_ releases our ref.
            unsafe { (*sink).deref_() };
        }
    }

    pub fn on_writable(task: &mut MultiPartUpload, self_: &mut Self, _: u64) {
        bun_output::scoped_log!(
            S3UploadStream,
            "onWritable {} {}",
            self_.sink.is_some(),
            task.ended
        );
        // end was called we dont need to drain anymore
        if task.ended {
            return;
        }
        // we have more space in the queue, drain it
        if let Some(sink) = self_.sink {
            // SAFETY: sink is live while held in `self_.sink`.
            unsafe { (*sink).drain() };
        }
    }

    pub fn write_request_data(&mut self, data: &[u8]) -> ResumableSinkBackpressure {
        bun_output::scoped_log!(S3UploadStream, "writeRequestData {}", data.len());
        // SAFETY: `task` is live (intrusive-ref'd) for the lifetime of this wrapper.
        unsafe { (*self.task).write_bytes(data, false) }.expect("OOM")
    }

    pub fn write_end_request(&mut self, err: Option<JSValue>) {
        bun_output::scoped_log!(S3UploadStream, "writeEndRequest {}", err.is_some());
        self.detach_sink();
        // PORT NOTE: reshaped for borrowck — Zig used `defer this.deref()`
        let _deref_guard = scopeguard::guard(self as *mut Self, |s| {
            // SAFETY: s points to self which is alive for the duration of the guard; deref_
            // decrements ref_count and may free self only after all borrows above are released
            unsafe { Self::deref_(s) }
        });
        if let Some(js_err) = err {
            if self.end_promise.has_value() && !js_err.is_empty_or_undefined_or_null() {
                // if we have a explicit error, reject the promise
                // if not when calling .fail will create a S3Error instance
                // this match the previous behavior
                let _ = self.end_promise.reject(self.global, Ok(js_err)); // TODO: properly propagate exception upwards
                self.end_promise = bun_jsc::JSPromiseStrong::empty();
            }
            // SAFETY: `task` is live (intrusive-ref'd) for the lifetime of this wrapper.
            if !unsafe { (*self.task).ended } {
                let _ = unsafe { &mut *self.task }.fail(Error::S3Error {
                    code: b"UnknownError",
                    message: b"ReadableStream ended with an error",
                }); // TODO: properly propagate exception upwards
            }
        } else {
            // SAFETY: `task` is live (intrusive-ref'd) for the lifetime of this wrapper.
            let _ = unsafe { &mut *self.task }.write_bytes(b"", true);
        }
    }

    pub fn resolve(result: S3UploadResult, self_: &mut Self) -> JsTerminatedResult<()> {
        bun_output::scoped_log!(S3UploadStream, "resolve");
        // PORT NOTE: reshaped for borrowck — Zig used `defer self.deref()`
        let _deref_guard = scopeguard::guard(self_ as *mut Self, |s| {
            // SAFETY: s points to self_ which is alive for the duration of the guard; deref_
            // decrements ref_count and may free self only after all borrows above are released
            unsafe { Self::deref_(s) }
        });
        match &result {
            S3UploadResult::Success => {
                if self_.end_promise.has_value() {
                    self_.end_promise.resolve(self_.global, JSValue::js_number(0.0))?;
                    self_.end_promise = bun_jsc::JSPromiseStrong::empty();
                }
            }
            S3UploadResult::Failure(err) => {
                if let Some(sink) = self_.sink.take() {
                    // sink in progress, cancel it (will call writeEndRequest for cleanup and will reject the endPromise)
                    // SAFETY: path borrowed from task which outlives self
                    let js_err = s3_error_to_js(err, self_.global, Some(unsafe { &*self_.path }));
                    // SAFETY: sink is a live Box-allocated ResumableSink.
                    unsafe { (*sink).cancel(js_err) };
                    // SAFETY: deref_ releases our ref.
                    unsafe { (*sink).deref_() };
                } else if self_.end_promise.has_value() {
                    // SAFETY: path borrowed from task which outlives self
                    let path = unsafe { &*self_.path };
                    let js_err = s3_error_to_js(err, self_.global, Some(path));
                    self_.end_promise.reject(self_.global, Ok(js_err))?;
                    self_.end_promise = bun_jsc::JSPromiseStrong::empty();
                }
            }
        }

        if let Some(callback) = self_.callback {
            callback(result, self_.callback_context);
        }
        Ok(())
    }

}

impl ResumableSinkContext for S3UploadStreamWrapper {
    #[inline]
    fn write_request_data(&mut self, bytes: &[u8]) -> ResumableSinkBackpressure {
        S3UploadStreamWrapper::write_request_data(self, bytes)
    }
    #[inline]
    fn write_end_request(&mut self, err: Option<JSValue>) {
        S3UploadStreamWrapper::write_end_request(self, err)
    }
}

impl Drop for S3UploadStreamWrapper {
    /// Zig: `fn deinit(this: *@This())` — RefCount finalizer body. Allocation is freed by
    /// `deref_()` when the last ref is dropped; this `Drop` only handles side effects.
    fn drop(&mut self) {
        bun_output::scoped_log!(S3UploadStream, "deinit {}", self.sink.is_some());
        self.detach_sink();
        // task.deref() — release our ref on the MultiPartUpload.
        MultiPartUpload::deref_(self.task);
        // endPromise.deinit() — Strong field Drop handles this
    }
}

/// consumes the readable stream and upload to s3
pub fn upload_stream(
    this: &mut S3Credentials,
    path: &[u8],
    readable_stream: ReadableStream,
    global_this: &JSGlobalObject,
    options: MultiPartUploadOptions,
    acl: Option<ACL>,
    storage_class: Option<StorageClass>,
    content_type: Option<&[u8]>,
    content_disposition: Option<&[u8]>,
    content_encoding: Option<&[u8]>,
    proxy: Option<&[u8]>,
    request_payer: bool,
    callback: Option<fn(S3UploadResult, *mut c_void)>,
    callback_context: *mut c_void,
) -> JsResult<JSValue> {
    let proxy_url = proxy.unwrap_or(b"");
    if readable_stream.is_disturbed(global_this) {
        return Ok(bun_jsc::JSPromise::rejected_promise(
            global_this,
            strings::String::static_("ReadableStream is already disturbed").to_error_instance(global_this),
        )
        .to_js());
    }

    match &readable_stream.ptr {
        ReadableStreamPtr::Invalid => {
            return Ok(bun_jsc::JSPromise::rejected_promise(
                global_this,
                strings::String::static_("ReadableStream is invalid").to_error_instance(global_this),
            )
            .to_js());
        }
        // TODO(port): Zig used `inline .File, .Bytes => |stream|` — File/Bytes payload types
        // differ (`*FileReader` vs `*ByteStream`), so the inline-captured `stream` has different
        // types per arm. Manual unroll once both have a `.pending` accessor.
        ReadableStreamPtr::Bytes(stream) => {
            // SAFETY: stream is a live `*mut ByteStream` from a JS-owned readable stream.
            let stream = unsafe { &mut **stream };
            if matches!(stream.pending.result, crate::webcore::streams::StreamResult::Err(_)) {
                // we got an error, fail early
                let err = match core::mem::replace(
                    &mut stream.pending.result,
                    crate::webcore::streams::StreamResult::Done,
                ) {
                    crate::webcore::streams::StreamResult::Err(err) => err,
                    _ => unreachable!(),
                };
                stream.pending = crate::webcore::streams::Pending {
                    result: crate::webcore::streams::StreamResult::Done,
                    ..Default::default()
                };
                let (js_err, was_strong) = err.to_js_weak(global_this);
                if was_strong == crate::webcore::streams::WasStrong::Strong {
                    js_err.unprotect();
                }
                js_err.ensure_still_alive();
                return Ok(bun_jsc::JSPromise::rejected_promise(global_this, js_err).to_js());
            }
        }
        ReadableStreamPtr::File(_stream) => {
            // TODO(port): FileReader.pending early-err check — same as Bytes arm above once
            // `FileReader` exposes a compatible `.pending` field.
        }
        _ => {}
    }

    let _ = (
        this,
        path,
        options,
        acl,
        storage_class,
        content_type,
        content_disposition,
        content_encoding,
        proxy_url,
        request_payer,
        callback,
        callback_context,
    );
    // TODO(port): MultiPartUpload struct-literal init requires `Arc<S3Credentials>` (we have
    // `&mut S3Credentials`) and has no Default. Port body once `MultiPartUpload::new`-style
    // constructor exists.
    todo!("blocked_on: bun_s3::MultiPartUpload literal init (Arc<S3Credentials> from &mut)")
}

} // mod _upload_stream_gated

pub use _upload_stream_gated::{S3UploadStreamWrapper, S3UploadStreamWrapperRef, upload_stream};

/// download a file from s3 chunk by chunk aka streaming (used on readableStream)
pub fn download_stream(
    this: &mut S3Credentials,
    path: &[u8],
    offset: usize,
    size: Option<usize>,
    proxy_url: Option<&[u8]>,
    request_payer: bool,
    callback: fn(chunk: MutableString, has_more: bool, err: Option<Error::S3Error>, ctx: *mut c_void),
    callback_context: *mut c_void,
) {
    let range: Option<Vec<u8>> = 'brk: {
        if let Some(size_) = size {
            let mut end = offset + size_;
            if size_ > 0 {
                end -= 1;
            }
            let mut v = Vec::new();
            write!(&mut v, "bytes={}-{}", offset, end).unwrap();
            break 'brk Some(v);
        }
        if offset == 0 {
            break 'brk None;
        }
        let mut v = Vec::new();
        write!(&mut v, "bytes={}-", offset).unwrap();
        Some(v)
    };

    let mut result = match this.sign_request::<false>(
        bun_s3_signing::SignOptions {
            path,
            method: bun_http::Method::GET,
            request_payer,
            content_hash: None,
            content_md5: None,
            search_params: None,
            content_disposition: None,
            content_type: None,
            content_encoding: None,
            acl: None,
            storage_class: None,
        },
        None,
    ) {
        Ok(r) => r,
        Err(sign_err) => {
            drop(range);
            let error_code_and_message = Error::get_sign_error_code_and_message(sign_err.into());
            callback(
                MutableString::default(),
                false,
                Some(Error::S3Error {
                    code: error_code_and_message.code,
                    message: error_code_and_message.message,
                }),
                callback_context,
            );
            return;
        }
    };

    let mut header_buffer: [bun_picohttp::Header;
        bun_s3_signing::credentials::SignResult::MAX_HEADERS + 1] =
        // SAFETY: all-zero is a valid picohttp::Header (POD)
        unsafe { core::mem::zeroed() };
    let headers = 'brk: {
        if let Some(range_) = &range {
            let _headers = result.mix_with_header(
                &mut header_buffer,
                bun_picohttp::Header::new(b"range", range_),
            );
            break 'brk bun_http::Headers::from_pico_http_headers(_headers);
        } else {
            break 'brk bun_http::Headers::from_pico_http_headers(result.headers());
        }
    };
    let proxy = proxy_url.unwrap_or(b"");
    let owned_proxy: Box<[u8]> = if !proxy.is_empty() {
        Box::<[u8]>::from(proxy)
    } else {
        Box::<[u8]>::default()
    };
    let task_ptr = Box::into_raw(S3HttpDownloadStreamingTask::new(S3HttpDownloadStreamingTask {
        // TODO(port): `http: undefined` — initialized below
        // SAFETY: http is fully overwritten by AsyncHTTP::init below before any read
        http: unsafe { core::mem::zeroed() },
        sign_result: result,
        proxy_url: owned_proxy,
        // SAFETY: callers always pass a non-null context (Box-allocated wrapper).
        callback_context: unsafe { NonNull::new_unchecked(callback_context as *mut ()) },
        // SAFETY: fn(..., *mut c_void) → fn(..., *mut ()) — same calling convention.
        callback: unsafe {
            core::mem::transmute::<
                fn(MutableString, bool, Option<Error::S3Error>, *mut c_void),
                fn(MutableString, bool, Option<Error::S3Error>, *mut ()),
            >(callback)
        },
        range: range.map(Vec::into_boxed_slice),
        headers,
        // SAFETY: `VirtualMachine::get()` returns the live per-thread VM singleton.
        vm: unsafe { &*VirtualMachine::get() },
        has_schedule_callback: core::sync::atomic::AtomicBool::new(false),
        signal_store: Default::default(),
        signals: Default::default(),
        poll_ref: bun_aio::KeepAlive::init(),
        response_buffer: MutableString::default(),
        mutex: Default::default(),
        reported_response_buffer: MutableString::default(),
        state: core::sync::atomic::AtomicU64::new(0),
        concurrent_task: Default::default(),
    }));
    // SAFETY: just allocated via Box::into_raw, non-null; lifetime owned by HTTP callback
    // (freed via Box::from_raw in S3HttpDownloadStreamingTask::http_callback).
    let task = unsafe { &mut *task_ptr };
    task.poll_ref.ref_(bun_aio::posix_event_loop::get_vm_ctx(bun_aio::AllocatorType::Js));

    // SAFETY (lifetime extension): `url` / `headers_buf` / `proxy_url` borrow from heap-allocated
    // fields of `*task` which the task outlives. See `execute_simple_s3_request`.
    let url = bun_url::URL::parse(unsafe { &*(&*task.sign_result.url as *const [u8]) });
    let headers_buf: &'static [u8] = unsafe { &*(task.headers.buf.as_slice() as *const [u8]) };
    let http_proxy = if !task.proxy_url.is_empty() {
        Some(bun_url::URL::parse(unsafe { &*(&*task.proxy_url as *const [u8]) }))
    } else {
        None
    };

    task.signals = task.signal_store.to();

    // SAFETY: `VirtualMachine::get()` returns the live per-thread VM singleton; the
    // `&mut` borrow is scoped to the two getter calls below.
    let vm_mut = unsafe { &mut *VirtualMachine::get() };
    let verbose = vm_mut.get_verbose_fetch();
    let reject_unauthorized = vm_mut.get_tls_reject_unauthorized();

    task.http = bun_http::AsyncHTTP::init(
        bun_http::Method::GET,
        url,
        task.headers.entries.clone().expect("OOM"),
        headers_buf,
        &mut task.response_buffer as *mut MutableString,
        b"",
        bun_http::HTTPClientResultCallback::new::<S3HttpDownloadStreamingTask>(
            task_ptr,
            // SAFETY: fn(*mut Self, &mut AsyncHTTP, ...) → fn(*mut Self, *mut AsyncHTTP, ...)
            // — same calling convention; the receiver never observes a null pointer.
            unsafe {
                core::mem::transmute::<
                    fn(*mut S3HttpDownloadStreamingTask, &mut bun_http::AsyncHTTP, bun_http::HTTPClientResult<'_>),
                    fn(*mut S3HttpDownloadStreamingTask, *mut bun_http::AsyncHTTP, bun_http::HTTPClientResult<'_>),
                >(S3HttpDownloadStreamingTask::http_callback)
            },
        ),
        bun_http::FetchRedirect::Follow,
        bun_http::async_http::Options {
            http_proxy,
            verbose: Some(task.vm.get_verbose_fetch()),
            signals: Some(task.signals),
            reject_unauthorized: Some(task.vm.get_tls_reject_unauthorized()),
            ..Default::default()
        },
    );
    // enable streaming
    task.http.enable_response_body_streaming();
    // queue http request
    bun_http::http_thread::init(&Default::default());
    let mut batch = bun_threading::thread_pool::Batch::default();
    task.http.schedule(&mut batch);
    bun_http::http_thread().schedule(batch);
}

// TODO(b2-blocked): ByteStream — `ByteStream::Source` and `ByteStream::on_data`/`parent`
// are stubbed in `webcore.rs`. Un-gate once `webcore::byte_stream` body lands.

/// returns a readable stream that reads from the s3 path
pub fn readable_stream(
    this: &mut S3Credentials,
    path: &[u8],
    offset: usize,
    size: Option<usize>,
    proxy_url: Option<&[u8]>,
    request_payer: bool,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    pub struct S3DownloadStreamWrapper {
        pub readable_stream_ref: ReadableStreamStrong,
        pub path: Box<[u8]>,
        pub global: &'static JSGlobalObject, // JSC_BORROW
    }

    impl S3DownloadStreamWrapper {
        pub fn new(init: Self) -> *mut Self {
            Box::into_raw(Box::new(init))
        }

        pub fn callback(
            chunk: MutableString,
            has_more: bool,
            request_err: Option<Error::S3Error>,
            self_: &mut Self,
        ) -> JsTerminatedResult<()> {
            // PORT NOTE: reshaped for borrowck — Zig used `defer if (!has_more) self.deinit()`
            let _guard = scopeguard::guard(self_ as *mut Self, move |s| {
                if !has_more {
                    // SAFETY: s is a live Box-allocated pointer (Box::into_raw in S3DownloadStreamWrapper::new);
                    // reconstituting and dropping the Box runs Drop::drop and frees the allocation
                    drop(unsafe { Box::from_raw(s) });
                }
            });

            if let Some(readable) = self_.readable_stream_ref.get(self_.global) {
                if let ReadableStreamPtr::Bytes(bytes) = readable.ptr {
                    // SAFETY: `bytes` is a live `*mut ByteStream` owned by the readable stream.
                    let bytes = unsafe { &mut *bytes };
                    if let Some(err) = request_err {
                        bytes.on_data(crate::webcore::streams::StreamResult::Err(
                            crate::webcore::streams::StreamError::JSValue(
                                s3_error_to_js(&err, self_.global, Some(&self_.path)),
                            ),
                        ))?;
                        return Ok(());
                    }
                    if has_more {
                        bytes.on_data(crate::webcore::streams::StreamResult::Temporary(
                            // SAFETY: chunk.list is borrowed for the duration of on_data.
                            unsafe { ByteList::from_borrowed_slice_dangerous(chunk.list.as_slice()) },
                        ))?;
                        return Ok(());
                    }

                    bytes.on_data(crate::webcore::streams::StreamResult::TemporaryAndDone(
                        // SAFETY: chunk.list is borrowed for the duration of on_data.
                        unsafe { ByteList::from_borrowed_slice_dangerous(chunk.list.as_slice()) },
                    ))?;
                    return Ok(());
                }
            }
            Ok(())
        }

        /// Clear the cancel_handler on the ByteStream.Source to prevent use-after-free.
        /// Must be called before releasing readable_stream_ref.
        fn clear_stream_cancel_handler(&mut self) {
            if let Some(readable) = self.readable_stream_ref.get(self.global) {
                if let ReadableStreamPtr::Bytes(bytes) = readable.ptr {
                    // SAFETY: `bytes` is a live `*mut ByteStream` owned by the readable stream.
                    let source = unsafe { (*bytes).parent() };
                    source.cancel_handler = None;
                    source.cancel_ctx = None;
                }
            }
        }

        fn on_stream_cancelled(ctx: Option<*mut c_void>) {
            // SAFETY: ctx points to a S3DownloadStreamWrapper allocated in readable_stream
            let self_: &mut Self = unsafe { &mut *(ctx.unwrap() as *mut Self) };
            // Release the Strong ref so the ReadableStream can be GC'd.
            // The download may still be in progress, but the callback will
            // see readable_stream_ref.get() return null and skip data delivery.
            // When the download finishes (has_more == false), deinit() will
            // clean up the remaining resources.
            self_.readable_stream_ref.deinit();
        }

        pub fn opaque_callback(
            chunk: MutableString,
            has_more: bool,
            err: Option<Error::S3Error>,
            opaque_self: *mut c_void,
        ) {
            // SAFETY: opaque_self points to a S3DownloadStreamWrapper allocated in readable_stream
            let self_: &mut Self = unsafe { &mut *(opaque_self as *mut Self) };
            let _ = Self::callback(chunk, has_more, err, self_); // TODO: properly propagate exception upwards
        }
    }

    impl Drop for S3DownloadStreamWrapper {
        /// Zig: `fn deinit(self: *@This())`. readable_stream_ref / path are freed by their own field Drop.
        fn drop(&mut self) {
            self.clear_stream_cancel_handler();
        }
    }

    let _ = (
        this,
        path,
        offset,
        size,
        proxy_url,
        request_payer,
        global_this,
        S3DownloadStreamWrapper::opaque_callback as fn(_, _, _, _),
        S3DownloadStreamWrapper::on_stream_cancelled as fn(_),
        S3DownloadStreamWrapper::new as fn(_) -> _,
    );
    // TODO(port): `ByteStream::Source` (NewSource<ByteStream>) literal init + `setup()` /
    // `to_readable_stream()` need a heap-allocated NewSource via the codegen wrapper. Un-gate
    // once `webcore::byte_stream::Source::new` semantics are settled.
    todo!("blocked_on: webcore::byte_stream::Source::new (NewSource<ByteStream> heap init)")
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/s3/client.zig (745 lines)
//   confidence: medium
//   todos:      12
//   notes:      fn-ptr @ptrCast → transmute needs ABI review; MultiPartUpload Rc vs IntrusiveRc mismatch (LIFETIMES.tsv says Rc but type uses bun.ptr.RefCount); JsTerminated error type assumed; `http: undefined` fields zeroed pending MaybeUninit reshape
// ──────────────────────────────────────────────────────────────────────────
