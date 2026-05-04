use core::ffi::c_void;
use std::io::Write as _;
use std::rc::Rc;

use bun_collections::ByteList;
use bun_core::MutableString;
use bun_jsc::{JSGlobalObject, JSValue, JsResult, VirtualMachine};
use bun_str as strings;

// Re-exports (thin aliases matching the Zig file's top-level `pub const X = @import(...)`)
pub use bun_s3_signing::acl::ACL;
pub use super::download_stream::S3HttpDownloadStreamingTask;
pub use super::multipart_options::MultiPartUploadOptions;
pub use super::multipart::MultiPartUpload;
pub use bun_s3_signing::storage_class::StorageClass;

pub use bun_s3_signing::error as Error;
pub use Error::throw_sign_error;
pub use Error::get_js_sign_error;

pub use bun_s3_signing::credentials::S3Credentials;
pub use bun_s3_signing::credentials::S3CredentialsWithOptions;

pub use super::simple_request::S3HttpSimpleTask;
pub use super::simple_request::S3UploadResult;
pub use super::simple_request::S3StatResult;
pub use super::simple_request::S3DownloadResult;
pub use super::simple_request::S3DeleteResult;
pub use super::simple_request::S3ListObjectsResult;
pub use super::list_objects::S3ListObjectsOptions;
pub use super::list_objects::get_list_objects_options_from_js;

use super::simple_request as s3_simple_request;
use crate::webcore::resumable_sink::ResumableS3UploadSink;
use crate::webcore::ResumableSinkBackpressure;
use crate::webcore::{ByteStream, NetworkSink, ReadableStream};

bun_output::declare_scope!(S3UploadStream, visible);

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
            range: range.as_deref(),
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
            S3Credentials::encode_uri_component(continuation_token, &mut buff, true).expect("unreachable");
        search_params.append_fmt(format_args!(
            "continuation-token={}",
            bstr::BStr::new(encoded)
        ));
    }

    if let Some(delimiter) = &list_options.delimiter {
        let mut buff = vec![0u8; delimiter.len() * 3];
        let encoded = S3Credentials::encode_uri_component(delimiter, &mut buff, true).expect("unreachable");

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
        let encoded = S3Credentials::encode_uri_component(prefix, &mut buff, true).expect("unreachable");
        search_params.append_fmt(format_args!("&prefix={}", bstr::BStr::new(encoded)));
    }

    if let Some(start_after) = &list_options.start_after {
        let mut buff = vec![0u8; start_after.len() * 3];
        let encoded =
            S3Credentials::encode_uri_component(start_after, &mut buff, true).expect("unreachable");
        search_params.append_fmt(format_args!("&start-after={}", bstr::BStr::new(encoded)));
    }

    let result = match this.sign_request(
        bun_s3_signing::SignOptions {
            path: b"",
            method: bun_http::Method::GET,
            search_params: Some(search_params.slice()),
            ..Default::default()
        },
        true,
        None,
    ) {
        Ok(r) => r,
        Err(sign_err) => {
            drop(search_params);

            let error_code_and_message = Error::get_sign_error_code_and_message(sign_err);
            callback(
                S3ListObjectsResult::Failure {
                    code: error_code_and_message.code,
                    message: error_code_and_message.message,
                },
                callback_context,
            )?;

            return Ok(());
        }
    };

    drop(search_params);

    let headers = bun_http::Headers::from_pico_http_headers(result.headers());

    let task = Box::into_raw(Box::new(S3HttpSimpleTask {
        // TODO(port): `http: undefined` — initialized below; using MaybeUninit semantics in Phase B
        // SAFETY: http is fully overwritten by AsyncHTTP::init below before any read
        http: unsafe { core::mem::zeroed() },
        range: None,
        sign_result: result,
        callback_context,
        callback: s3_simple_request::Callback::ListObjects(callback),
        headers,
        vm: VirtualMachine::get(),
        ..Default::default()
    }));
    // SAFETY: just allocated, non-null
    let task = unsafe { &mut *task };

    task.poll_ref.ref_(task.vm);

    let url = bun_url::URL::parse(&result.url);
    let proxy = proxy_url.unwrap_or(b"");
    task.proxy_url = if !proxy.is_empty() {
        Box::<[u8]>::from(proxy)
    } else {
        Box::<[u8]>::default()
    };

    task.http = bun_http::AsyncHTTP::init(
        bun_http::Method::GET,
        url,
        task.headers.entries.clone(),
        task.headers.buf.as_slice(),
        &mut task.response_buffer,
        b"",
        bun_http::HTTPClientResult::callback_new::<S3HttpSimpleTask>(
            S3HttpSimpleTask::http_callback,
        )
        .init(task),
        bun_http::Redirect::Follow,
        bun_http::Options {
            http_proxy: if !task.proxy_url.is_empty() {
                Some(bun_url::URL::parse(&task.proxy_url))
            } else {
                None
            },
            verbose: task.vm.get_verbose_fetch(),
            reject_unauthorized: task.vm.get_tls_reject_unauthorized(),
            ..Default::default()
        },
    );

    // queue http request
    bun_http::HTTPThread::init(&Default::default());
    let mut batch = bun_threading::ThreadPool::Batch::default();
    task.http.schedule(&mut batch);
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
        if sink.end_promise.has_value() || sink.flush_promise.has_value() {
            let event_loop = sink.global_this.bun_vm().event_loop();
            event_loop.enter();
            // PORT NOTE: reshaped for borrowck — Zig used `defer event_loop.exit()`
            let _exit_guard = scopeguard::guard((), |_| event_loop.exit());
            match result {
                S3UploadResult::Success => {
                    if sink.flush_promise.has_value() {
                        sink.flush_promise.resolve(sink.global_this, JSValue::js_number(0))?;
                    }
                    if sink.end_promise.has_value() {
                        sink.end_promise.resolve(sink.global_this, JSValue::js_number(0))?;
                    }
                }
                S3UploadResult::Failure(err) => {
                    let js_err = err.to_js(sink.global_this, sink.path());
                    if sink.flush_promise.has_value() {
                        sink.flush_promise.reject(sink.global_this, js_err)?;
                    }
                    if sink.end_promise.has_value() {
                        sink.end_promise.reject(sink.global_this, js_err)?;
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

    let proxy_url = proxy.unwrap_or(b"");
    this.ref_(); // ref the credentials
    let task = Box::into_raw(Box::new(MultiPartUpload {
        // TODO(port): ref_count = .initExactRefs(2) — +1 for the stream; intrusive RC init
        ref_count: bun_ptr::RefCount::init_exact_refs(2),
        credentials: this,
        path: Box::<[u8]>::from(path),
        proxy: if !proxy_url.is_empty() {
            Box::<[u8]>::from(proxy_url)
        } else {
            Box::<[u8]>::default()
        },
        content_type: content_type.map(Box::<[u8]>::from),
        content_disposition: content_disposition.map(Box::<[u8]>::from),
        content_encoding: content_encoding.map(Box::<[u8]>::from),
        storage_class,
        request_payer,

        // SAFETY: fn(S3UploadResult, &mut NetworkSink) cast to fn(S3UploadResult, *mut c_void)
        // TODO(port): @ptrCast on fn pointer — verify ABI compat in Phase B
        callback: unsafe {
            core::mem::transmute::<
                fn(S3UploadResult, &mut NetworkSink) -> JsTerminatedResult<()>,
                fn(S3UploadResult, *mut c_void) -> JsTerminatedResult<()>,
            >(wrapper_callback)
        },
        callback_context: core::ptr::null_mut(), // set below
        global_this,
        options,
        vm: VirtualMachine::get(),
        ..Default::default()
    }));
    // SAFETY: just allocated, non-null
    let task = unsafe { &mut *task };

    task.poll_ref.ref_(task.vm);

    let response_stream = NetworkSink::new(NetworkSink {
        task,
        global_this,
        high_water_mark: options.part_size as u32, // @truncate
        ..Default::default()
    })
    .to_sink();

    task.callback_context = response_stream as *mut _ as *mut c_void;
    // SAFETY: fn pointer cast for onWritable callback
    // TODO(port): @ptrCast on fn pointer — verify ABI compat in Phase B
    task.on_writable = Some(unsafe { core::mem::transmute(NetworkSink::on_writable as fn(_, _, _)) });
    let signal = &mut response_stream.sink.signal;

    *signal = NetworkSink::JSSink::SinkSignal::init(JSValue::ZERO);

    // explicitly set it to a dead pointer
    // we use this memory address to disable signals being sent
    signal.clear();
    debug_assert!(signal.is_dead());
    response_stream.sink.to_js(global_this)
}

pub struct S3UploadStreamWrapper {
    // intrusive ref_count — bun.ptr.RefCount(@This(), "ref_count", deinit, .{}) → bun_ptr::IntrusiveRc<Self>
    pub ref_count: core::cell::Cell<u32>,

    pub sink: Option<Rc<ResumableS3UploadSink>>,
    pub task: Rc<MultiPartUpload>,
    pub end_promise: bun_jsc::JSPromise::Strong,
    pub callback: Option<fn(S3UploadResult, *mut c_void)>,
    pub callback_context: *mut c_void,
    /// this is owned by the task not by the wrapper
    pub path: *const [u8],
    pub global: &'static JSGlobalObject, // JSC_BORROW
}

/// Intrusive ref-counted handle. `ref()`/`deref()` from the Zig `bun.ptr.RefCount` mixin
/// are provided by cloning/dropping this handle; `Drop for S3UploadStreamWrapper` runs the
/// finalizer body when the last ref is released.
pub type S3UploadStreamWrapperRef = bun_ptr::IntrusiveRc<S3UploadStreamWrapper>;

impl S3UploadStreamWrapper {
    pub type ResumableSink = ResumableS3UploadSink;

    fn detach_sink(&mut self) {
        bun_output::scoped_log!(S3UploadStream, "detachSink {}", self.sink.is_some());
        if let Some(sink) = self.sink.take() {
            // Rc::drop performs the deref()
            drop(sink);
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
        if let Some(sink) = &self_.sink {
            sink.drain();
        }
    }

    pub fn write_request_data(&mut self, data: &[u8]) -> ResumableSinkBackpressure {
        bun_output::scoped_log!(S3UploadStream, "writeRequestData {}", data.len());
        self.task.write_bytes(data, false)
    }

    pub fn write_end_request(&mut self, err: Option<JSValue>) {
        bun_output::scoped_log!(S3UploadStream, "writeEndRequest {}", err.is_some());
        self.detach_sink();
        // PORT NOTE: reshaped for borrowck — Zig used `defer this.deref()`
        let _deref_guard = scopeguard::guard(self as *mut Self, |s| {
            // SAFETY: s points to self which is alive for the duration of the guard; dropping the
            // IntrusiveRc decrements ref_count and may free self only after all borrows above are released
            drop(unsafe { bun_ptr::IntrusiveRc::<Self>::from_raw(s) })
        });
        if let Some(js_err) = err {
            if self.end_promise.has_value() && !js_err.is_empty_or_undefined_or_null() {
                // if we have a explicit error, reject the promise
                // if not when calling .fail will create a S3Error instance
                // this match the previous behavior
                let _ = self.end_promise.reject(self.global, js_err); // TODO: properly propagate exception upwards
                self.end_promise = bun_jsc::JSPromise::Strong::empty();
            }
            if !self.task.ended {
                let _ = self.task.fail(Error::S3Error {
                    code: b"UnknownError",
                    message: b"ReadableStream ended with an error",
                }); // TODO: properly propagate exception upwards
            }
        } else {
            let _ = self.task.write_bytes(b"", true);
        }
    }

    pub fn resolve(result: S3UploadResult, self_: &mut Self) -> JsTerminatedResult<()> {
        bun_output::scoped_log!(S3UploadStream, "resolve {:?}", result);
        // PORT NOTE: reshaped for borrowck — Zig used `defer self.deref()`
        let _deref_guard = scopeguard::guard(self_ as *mut Self, |s| {
            // SAFETY: s points to self_ which is alive for the duration of the guard; dropping the
            // IntrusiveRc decrements ref_count and may free self only after all borrows above are released
            drop(unsafe { bun_ptr::IntrusiveRc::<Self>::from_raw(s) })
        });
        match &result {
            S3UploadResult::Success => {
                if self_.end_promise.has_value() {
                    self_.end_promise.resolve(self_.global, JSValue::js_number(0))?;
                    self_.end_promise = bun_jsc::JSPromise::Strong::empty();
                }
            }
            S3UploadResult::Failure(err) => {
                if let Some(sink) = self_.sink.take() {
                    // sink in progress, cancel it (will call writeEndRequest for cleanup and will reject the endPromise)
                    // SAFETY: path borrowed from task which outlives self
                    sink.cancel(err.to_js(self_.global, unsafe { &*self_.path }));
                    drop(sink); // deref()
                } else if self_.end_promise.has_value() {
                    // SAFETY: path borrowed from task which outlives self
                    let path = unsafe { &*self_.path };
                    self_
                        .end_promise
                        .reject(self_.global, err.to_js(self_.global, path))?;
                    self_.end_promise = bun_jsc::JSPromise::Strong::empty();
                }
            }
        }

        if let Some(callback) = self_.callback {
            callback(result, self_.callback_context);
        }
        Ok(())
    }

}

impl Drop for S3UploadStreamWrapper {
    /// Zig: `fn deinit(this: *@This())` — RefCount finalizer body. Allocation is freed by
    /// `bun_ptr::IntrusiveRc` when the last ref is dropped; this `Drop` only handles side effects.
    fn drop(&mut self) {
        bun_output::scoped_log!(S3UploadStream, "deinit {}", self.sink.is_some());
        self.detach_sink();
        // task.deref() — Rc<MultiPartUpload> field Drop handles this
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
    this.ref_(); // ref the credentials
    let proxy_url = proxy.unwrap_or(b"");
    if readable_stream.is_disturbed(global_this) {
        return Ok(bun_jsc::JSPromise::rejected_promise(
            global_this,
            strings::String::static_("ReadableStream is already disturbed").to_error_instance(global_this),
        )
        .to_js());
    }

    match &readable_stream.ptr {
        ReadableStream::Ptr::Invalid => {
            return Ok(bun_jsc::JSPromise::rejected_promise(
                global_this,
                strings::String::static_("ReadableStream is invalid").to_error_instance(global_this),
            )
            .to_js());
        }
        // TODO(port): Zig used `inline .File, .Bytes => |stream|` — manual unroll
        ReadableStream::Ptr::File(stream) | ReadableStream::Ptr::Bytes(stream) => {
            // TODO(port): `inline` capture means File/Bytes payload types differ; this match arm
            // assumes both expose `.pending` with the same shape — verify in Phase B.
            if matches!(stream.pending.result, crate::webcore::streams::StreamResult::Err(_)) {
                // we got an error, fail early
                let err = stream.pending.result.take_err();
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
        _ => {}
    }

    let task_box = Box::new(MultiPartUpload {
        // +1 for the stream ctx (only deinit after task and context ended)
        ref_count: bun_ptr::RefCount::init_exact_refs(2),
        credentials: this,
        path: Box::<[u8]>::from(path),
        proxy: if !proxy_url.is_empty() {
            Box::<[u8]>::from(proxy_url)
        } else {
            Box::<[u8]>::default()
        },
        content_type: content_type.map(Box::<[u8]>::from),
        content_disposition: content_disposition.map(Box::<[u8]>::from),
        content_encoding: content_encoding.map(Box::<[u8]>::from),
        // SAFETY: fn(S3UploadResult, &mut S3UploadStreamWrapper) cast to fn(S3UploadResult, *mut c_void)
        // TODO(port): @ptrCast on fn pointer — verify ABI compat in Phase B
        callback: unsafe {
            core::mem::transmute::<
                fn(S3UploadResult, &mut S3UploadStreamWrapper) -> JsTerminatedResult<()>,
                fn(S3UploadResult, *mut c_void) -> JsTerminatedResult<()>,
            >(S3UploadStreamWrapper::resolve)
        },
        callback_context: core::ptr::null_mut(), // set below
        global_this,
        state: MultiPartUpload::State::WaitStreamCheck,
        options,
        acl,
        storage_class,
        request_payer,
        vm: VirtualMachine::get(),
        ..Default::default()
    });
    let task_ptr = Box::into_raw(task_box);
    // SAFETY: just allocated, non-null
    let task = unsafe { &mut *task_ptr };

    task.poll_ref.ref_(task.vm);

    // TODO(port): LIFETIMES.tsv says `task: Rc<MultiPartUpload>` but MultiPartUpload uses intrusive
    // RefCount; constructing Rc from a Box-allocated intrusive-RC value is wrong. Phase B should
    // unify on bun_ptr::IntrusiveRc<MultiPartUpload>. Using raw ptr wrapped as Rc placeholder.
    let ctx = Box::into_raw(Box::new(S3UploadStreamWrapper {
        // +1 for the stream sink (only deinit after both sink and task ended)
        ref_count: core::cell::Cell::new(2),
        sink: None,
        callback,
        callback_context,
        path: &*task.path as *const [u8],
        // SAFETY: task has ref_count=2; ctx holds one ref. See TODO above re: Rc vs IntrusiveRc.
        task: unsafe { Rc::from_raw(task_ptr) },
        end_promise: bun_jsc::JSPromise::Strong::init(global_this),
        global: global_this,
    }));
    // SAFETY: just allocated
    let ctx_ref = unsafe { &mut *ctx };
    // +1 because the ctx refs the sink
    ctx_ref.sink = Some(ResumableS3UploadSink::init_exact_refs(
        global_this,
        readable_stream,
        ctx_ref,
        2,
    ));
    task.callback_context = ctx as *mut c_void;
    // SAFETY: fn pointer cast for onWritable callback
    // TODO(port): @ptrCast on fn pointer
    task.on_writable = Some(unsafe {
        core::mem::transmute(S3UploadStreamWrapper::on_writable as fn(_, _, _))
    });
    task.continue_stream();
    Ok(ctx_ref.end_promise.value())
}

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

    let mut result = match this.sign_request(
        bun_s3_signing::SignOptions {
            path,
            method: bun_http::Method::GET,
            request_payer,
            ..Default::default()
        },
        false,
        None,
    ) {
        Ok(r) => r,
        Err(sign_err) => {
            drop(range);
            let error_code_and_message = Error::get_sign_error_code_and_message(sign_err);
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
                bun_picohttp::Header {
                    name: b"range",
                    value: range_,
                },
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
    let task = S3HttpDownloadStreamingTask::new(S3HttpDownloadStreamingTask {
        // TODO(port): `http: undefined` — initialized below
        // SAFETY: http is fully overwritten by AsyncHTTP::init below before any read
        http: unsafe { core::mem::zeroed() },
        sign_result: result,
        proxy_url: owned_proxy,
        callback_context,
        callback,
        range: range.map(Vec::into_boxed_slice),
        headers,
        vm: VirtualMachine::get(),
        ..Default::default()
    });
    task.poll_ref.ref_(task.vm);

    let url = bun_url::URL::parse(&task.sign_result.url);

    task.signals = task.signal_store.to();

    task.http = bun_http::AsyncHTTP::init(
        bun_http::Method::GET,
        url,
        task.headers.entries.clone(),
        task.headers.buf.as_slice(),
        &mut task.response_buffer,
        b"",
        bun_http::HTTPClientResult::callback_new::<S3HttpDownloadStreamingTask>(
            S3HttpDownloadStreamingTask::http_callback,
        )
        .init(task),
        bun_http::Redirect::Follow,
        bun_http::Options {
            http_proxy: if !task.proxy_url.is_empty() {
                Some(bun_url::URL::parse(&task.proxy_url))
            } else {
                None
            },
            verbose: task.vm.get_verbose_fetch(),
            signals: Some(task.signals),
            reject_unauthorized: task.vm.get_tls_reject_unauthorized(),
            ..Default::default()
        },
    );
    // enable streaming
    task.http.enable_response_body_streaming();
    // queue http request
    bun_http::HTTPThread::init(&Default::default());
    let mut batch = bun_threading::ThreadPool::Batch::default();
    task.http.schedule(&mut batch);
    bun_http::http_thread().schedule(batch);
}

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
    let reader = ByteStream::Source::new(ByteStream::Source {
        // TODO(port): `context: undefined` — set up below
        // SAFETY: context is fully initialized by .setup() below before any read
        context: unsafe { core::mem::zeroed() },
        global_this,
        ..Default::default()
    });

    reader.context.setup();
    let readable_value = reader.to_readable_stream(global_this)?;

    pub struct S3DownloadStreamWrapper {
        pub readable_stream_ref: ReadableStream::Strong,
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
                if let ReadableStream::Ptr::Bytes(bytes) = &readable.ptr {
                    if let Some(err) = request_err {
                        bytes.on_data(crate::webcore::streams::StreamResult::Err(
                            crate::webcore::streams::StreamError::JSValue(
                                err.to_js(self_.global, &self_.path),
                            ),
                        ))?;
                        return Ok(());
                    }
                    if has_more {
                        bytes.on_data(crate::webcore::streams::StreamResult::Temporary(
                            ByteList::from_borrowed_slice_dangerous(chunk.list.as_slice()),
                        ))?;
                        return Ok(());
                    }

                    bytes.on_data(crate::webcore::streams::StreamResult::TemporaryAndDone(
                        ByteList::from_borrowed_slice_dangerous(chunk.list.as_slice()),
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
                if let ReadableStream::Ptr::Bytes(bytes) = &readable.ptr {
                    let source = bytes.parent();
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

    let wrapper = S3DownloadStreamWrapper::new(S3DownloadStreamWrapper {
        readable_stream_ref: ReadableStream::Strong::init(
            ReadableStream {
                ptr: ReadableStream::Ptr::Bytes(&mut reader.context),
                value: readable_value,
            },
            global_this,
        ),
        path: Box::<[u8]>::from(path),
        global: global_this,
    });

    reader.cancel_handler = Some(S3DownloadStreamWrapper::on_stream_cancelled);
    reader.cancel_ctx = Some(wrapper as *mut c_void);

    download_stream(
        this,
        path,
        offset,
        size,
        proxy_url,
        request_payer,
        S3DownloadStreamWrapper::opaque_callback,
        wrapper as *mut c_void,
    );
    Ok(readable_value)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/s3/client.zig (745 lines)
//   confidence: medium
//   todos:      12
//   notes:      fn-ptr @ptrCast → transmute needs ABI review; MultiPartUpload Rc vs IntrusiveRc mismatch (LIFETIMES.tsv says Rc but type uses bun.ptr.RefCount); JsTerminated error type assumed; `http: undefined` fields zeroed pending MaybeUninit reshape
// ──────────────────────────────────────────────────────────────────────────
