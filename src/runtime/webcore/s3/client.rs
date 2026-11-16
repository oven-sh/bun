use core::cell::{Cell, OnceCell};
use core::ptr::NonNull;
use std::io::Write as _;

use bun_collections::{ByteVecExt, VecExt};
use bun_core::MutableString;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{GlobalRef, JSValue, JsCell, JsResult};
use bun_ptr::{AliasableBox, RefPtr};

// Re-exports (thin aliases)
pub(crate) use crate::webcore::s3::download_stream::S3HttpDownloadStreamingTask;
pub(crate) use crate::webcore::s3::multipart::MultiPartUpload;
pub(crate) use crate::webcore::s3::multipart_options::MultiPartUploadOptions;
pub(crate) use bun_s3_signing::acl::ACL;
pub(crate) use bun_s3_signing::storage_class::StorageClass;

pub(crate) use bun_s3_signing::error as Error;
// `throw_sign_error` / `get_js_sign_error` live in `error_jsc.rs` (jsc-side
// of the s3_signing error tables). The pure error module is `bun_s3_signing::error`;
// the jsc helpers are mounted here as a child module of this umbrella
// re-export hub.
#[path = "error_jsc.rs"]
pub(crate) mod error_jsc;
pub(crate) use error_jsc::S3ErrorJsc;
pub(crate) use error_jsc::get_js_sign_error;
pub(crate) use error_jsc::s3_error_to_js;
pub(crate) use error_jsc::throw_sign_error;

pub(crate) use bun_s3_signing::credentials::S3Credentials;
pub(crate) use bun_s3_signing::credentials::S3CredentialsWithOptions;
use bun_s3_signing::credentials::encode_uri_component;

pub(crate) use crate::webcore::s3::list_objects::S3ListObjectsOptions;
pub(crate) use crate::webcore::s3::list_objects::get_list_objects_options_from_js;
pub(crate) use crate::webcore::s3::simple_request::S3DeleteResult;
pub(crate) use crate::webcore::s3::simple_request::S3HttpSimpleTask;
pub(crate) use crate::webcore::s3::simple_request::S3ListObjectsResult;
pub(crate) use crate::webcore::s3::simple_request::S3StatResult;
pub(crate) use crate::webcore::s3::simple_request::S3UploadResult;

use crate::webcore::s3::simple_request as s3_simple_request;

use crate::generated_bindgen::s3_upload_stream::{
    Bun__S3UploadStream__onRejectStream, Bun__S3UploadStream__onResolveStream,
};
use crate::webcore::ByteStream;
use crate::webcore::ReadableStream;
use crate::webcore::readable_stream::Source as ReadableStreamPtr;
use crate::webcore::readable_stream::Strong as ReadableStreamStrong;
use crate::webcore::s3::multipart::{State as MultiPartUploadState, UploadCallback};
use crate::webcore::sink::ReadableSinkController;
use crate::webcore::streams::NetworkSink;
use bun_collections::IntegerBitSet;
use bun_io::JsKeepAlive;
use bun_io::StreamBuffer;
use bun_jsc::bindgen::{JsLocal, JsScope};

bun_core::declare_scope!(S3UploadStream, visible);

#[inline(never)]
pub(crate) fn stat(
    this: &S3Credentials,
    context: &bun_jsc::ScriptExecutionContext,
    path: &[u8],
    callback: s3_simple_request::OnStat,
    request_payer: bool,
) -> JsResult<()> {
    bun_removable_features::removable_definition!(S3Client, stat);
    s3_simple_request::execute_simple_s3_request(
        this,
        context,
        s3_simple_request::Options {
            path,
            method: bun_http::Method::HEAD,
            body: b"",
            request_payer,
            ..Default::default()
        },
        s3_simple_request::Callback::Stat(callback),
    )
}

#[inline(never)]
pub(crate) fn download(
    this: &S3Credentials,
    context: &bun_jsc::ScriptExecutionContext,
    path: &[u8],
    callback: s3_simple_request::OnDownload,
    request_payer: bool,
) -> JsResult<()> {
    bun_removable_features::removable_definition!(S3Client, download);
    s3_simple_request::execute_simple_s3_request(
        this,
        context,
        s3_simple_request::Options {
            path,
            method: bun_http::Method::GET,
            body: b"",
            request_payer,
            ..Default::default()
        },
        s3_simple_request::Callback::Download(callback),
    )
}

#[inline(never)]
pub(crate) fn download_slice(
    this: &S3Credentials,
    context: &bun_jsc::ScriptExecutionContext,
    path: &[u8],
    offset: usize,
    size: Option<usize>,
    callback: s3_simple_request::OnDownload,
    request_payer: bool,
) -> JsResult<()> {
    bun_removable_features::removable_definition!(S3Client, download_slice);
    let range: Option<Vec<u8>> = 'brk: {
        if let Some(size_) = size {
            let mut end = offset + size_;
            if size_ > 0 {
                end -= 1;
            }
            let mut v = Vec::new();
            write!(&mut v, "bytes={}-{}", offset, end).expect("infallible: in-memory write");
            break 'brk Some(v);
        }
        if offset == 0 {
            break 'brk None;
        }
        let mut v = Vec::new();
        write!(&mut v, "bytes={}-", offset).expect("infallible: in-memory write");
        Some(v)
    };

    s3_simple_request::execute_simple_s3_request(
        this,
        context,
        s3_simple_request::Options {
            path,
            method: bun_http::Method::GET,
            body: b"",
            range: range.map(Vec::into_boxed_slice),
            request_payer,
            ..Default::default()
        },
        s3_simple_request::Callback::Download(callback),
    )
}

#[inline(never)]
pub(crate) fn delete(
    this: &S3Credentials,
    context: &bun_jsc::ScriptExecutionContext,
    path: &[u8],
    callback: s3_simple_request::OnDelete,
    request_payer: bool,
) -> JsResult<()> {
    bun_removable_features::removable_definition!(S3Client, delete);
    s3_simple_request::execute_simple_s3_request(
        this,
        context,
        s3_simple_request::Options {
            path,
            method: bun_http::Method::DELETE,
            body: b"",
            request_payer,
            ..Default::default()
        },
        s3_simple_request::Callback::Delete(callback),
    )
}

#[inline(never)]
pub(crate) fn list_objects(
    this: &S3Credentials,
    context: &bun_jsc::ScriptExecutionContext,
    list_options: &S3ListObjectsOptions,
    callback: s3_simple_request::OnListObjects,
) -> JsResult<()> {
    bun_removable_features::removable_definition!(S3Client, list_objects);
    let mut search_params: Vec<u8> = Vec::<u8>::default();

    let _ = search_params.append_slice(b"?"); // OOM/capacity: fire-and-forget

    if let Some(continuation_token) = list_options.continuation_token.as_ref().map(|s| s.slice()) {
        let mut buff = vec![0u8; continuation_token.len() * 3];
        let encoded =
            encode_uri_component::<true>(continuation_token, &mut buff).expect("unreachable");
        // OOM/capacity: fire-and-forget
        let _ = search_params.append_fmt(format_args!(
            "continuation-token={}",
            bstr::BStr::new(encoded)
        ));
    }

    if let Some(delimiter) = list_options.delimiter.as_ref().map(|s| s.slice()) {
        let mut buff = vec![0u8; delimiter.len() * 3];
        let encoded = encode_uri_component::<true>(delimiter, &mut buff).expect("unreachable");

        if list_options.continuation_token.is_some() {
            let _ =
                search_params.append_fmt(format_args!("&delimiter={}", bstr::BStr::new(encoded))); // OOM/capacity: fire-and-forget
        } else {
            let _ =
                search_params.append_fmt(format_args!("delimiter={}", bstr::BStr::new(encoded))); // OOM/capacity: fire-and-forget
        }
    }

    if list_options.encoding_type.is_some() {
        if list_options.continuation_token.is_some() || list_options.delimiter.is_some() {
            let _ = search_params.append_slice(b"&encoding-type=url"); // OOM/capacity: fire-and-forget
        } else {
            let _ = search_params.append_slice(b"encoding-type=url"); // OOM/capacity: fire-and-forget
        }
    }

    if let Some(fetch_owner) = list_options.fetch_owner {
        if list_options.continuation_token.is_some()
            || list_options.delimiter.is_some()
            || list_options.encoding_type.is_some()
        {
            let _ = search_params.append_fmt(format_args!("&fetch-owner={}", fetch_owner)); // OOM/capacity: fire-and-forget
        } else {
            let _ = search_params.append_fmt(format_args!("fetch-owner={}", fetch_owner)); // OOM/capacity: fire-and-forget
        }
    }

    if list_options.continuation_token.is_some()
        || list_options.delimiter.is_some()
        || list_options.encoding_type.is_some()
        || list_options.fetch_owner.is_some()
    {
        let _ = search_params.append_slice(b"&list-type=2"); // OOM/capacity: fire-and-forget
    } else {
        let _ = search_params.append_slice(b"list-type=2"); // OOM/capacity: fire-and-forget
    }

    if let Some(max_keys) = list_options.max_keys {
        let _ = search_params.append_fmt(format_args!("&max-keys={}", max_keys)); // OOM/capacity: fire-and-forget
    }

    if let Some(prefix) = list_options.prefix.as_ref().map(|s| s.slice()) {
        let mut buff = vec![0u8; prefix.len() * 3];
        let encoded = encode_uri_component::<true>(prefix, &mut buff).expect("unreachable");
        let _ = search_params.append_fmt(format_args!("&prefix={}", bstr::BStr::new(encoded))); // OOM/capacity: fire-and-forget
    }

    if let Some(start_after) = list_options.start_after.as_ref().map(|s| s.slice()) {
        let mut buff = vec![0u8; start_after.len() * 3];
        let encoded = encode_uri_component::<true>(start_after, &mut buff).expect("unreachable");
        let _ = search_params.append_fmt(format_args!("&start-after={}", bstr::BStr::new(encoded))); // OOM/capacity: fire-and-forget
    }

    let result = match this.sign_request::<true>(
        &bun_s3_signing::SignOptions {
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
            return callback(S3ListObjectsResult::Failure(Error::S3Error {
                code: error_code_and_message.code,
                message: error_code_and_message.message,
            }));
        }
    };

    drop(search_params);

    let headers = result.headers(None, None);
    let proxy_url = s3_simple_request::resolve_proxy(None, &result.url);

    let task_ptr = bun_core::heap::into_raw(Box::new(S3HttpSimpleTask {
        async_http_id: 0,
        sign_result: result,
        callback: Some(s3_simple_request::Callback::ListObjects(callback)),
        headers,
        http_ticket: None,
        response_buffer: MutableString::default(),
        result: bun_http::HTTPClientResult::default(),
        concurrent_task: Default::default(),
        proxy_url,
        body: Box::default(),
        _keep_alive: JsKeepAlive::active(),
        signal_store: Default::default(),
        abort_handle: bun_jsc::AbortHandle::for_owner::<S3HttpSimpleTask>(),
        context: Default::default(),
    }));
    // SAFETY: just allocated, non-null, and `task` is not used once `task_ptr` is dereferenced.
    // `'static`: `url`, `headers_buf` and `http_proxy` borrow heap buffers that `*task` owns and
    // never writes again. They are stored in an `AsyncHTTP<'static>` that the HTTP
    // thread reads, and remain valid until `task` is dropped in `on_response`.
    let task: &'static mut S3HttpSimpleTask = unsafe { &mut *task_ptr };

    let url = bun_url::URL::parse(&task.sign_result.url);
    let headers_buf: &'static [u8] = task.headers.buf.as_slice();
    let http_proxy = if !task.proxy_url.is_empty() {
        Some(bun_url::URL::parse(&task.proxy_url))
    } else {
        None
    };
    // JS thread (request setup): read options from the current VM.
    let vm = VirtualMachine::get();

    let http = bun_http::AsyncHTTP::init(
        bun_http::Method::GET,
        url,
        task.headers.entries.clone().expect("OOM"),
        headers_buf,
        b"",
        bun_http::HTTPClientResultCallback::new_with_release::<S3HttpSimpleTask>(
            task_ptr,
            // SAFETY: `task_ptr` is the heap-allocated task registered above; the
            // HTTP thread invokes this with that exact pointer.
            S3HttpSimpleTask::http_callback,
            S3HttpSimpleTask::release_at_shutdown,
        ),
        bun_http::FetchRedirect::Follow,
        bun_http::async_http::Options {
            http_proxy,
            verbose: Some(vm.get_verbose_fetch()),
            reject_unauthorized: Some(vm.get_tls_reject_unauthorized()),
            tls_props: crate::socket::http_client_defaults(vm),
            signals: Some(task.signal_store.to()),
            ..Default::default()
        },
    );
    task.async_http_id = http.async_http_id;

    // queue http request
    bun_http::http_thread::init(&Default::default());
    // Out on the HTTP thread until its final callback: its context aborts it
    // when it stops, and the VM waits for it (the ticket).
    task.http_ticket = Some(VirtualMachine::get().ticket());
    task.context = context.id();
    // SAFETY: the task is heap-allocated and drops its handle with itself.
    unsafe { bun_jsc::AbortHandle::arm_owner(task_ptr, context) };
    bun_http::HTTPThread::schedule([http]);
    Ok(())
}

#[inline(never)]
pub(crate) fn upload(
    this: &S3Credentials,
    context: &bun_jsc::ScriptExecutionContext,
    path: &[u8],
    content: &[u8],
    content_type: Option<&[u8]>,
    content_disposition: Option<&[u8]>,
    content_encoding: Option<&[u8]>,
    acl: Option<ACL>,
    storage_class: Option<StorageClass>,
    request_payer: bool,
    callback: s3_simple_request::OnUpload,
) -> JsResult<()> {
    bun_removable_features::removable_definition!(S3Client, upload);
    s3_simple_request::execute_simple_s3_request(
        this,
        context,
        s3_simple_request::Options {
            path,
            method: bun_http::Method::PUT,
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
    )
}

/// returns a writable stream that writes to the s3 path
///
/// `credentials` is moved into the `MultiPartUpload`.
#[inline(never)]
pub(crate) fn writable_stream(
    credentials: bun_ptr::RefPtr<S3Credentials>,
    path: &[u8],
    cx: &bun_jsc::JsThread<'_>,
    options: MultiPartUploadOptions,
    content_type: Option<&[u8]>,
    content_disposition: Option<&[u8]>,
    content_encoding: Option<&[u8]>,
    storage_class: Option<StorageClass>,
    request_payer: bool,
) -> JsResult<JSValue> {
    bun_removable_features::removable_definition!(S3Client, writable_stream);
    // `credentials` ref adopted by value — moved into the MultiPartUpload below.
    // JSC_BORROW: `global_this` outlives the task (it owns the VM/heap that owns the JS
    // objects which keep the task alive); stored via `GlobalRef` in the heap-allocated
    // MultiPartUpload.
    let global_static = GlobalRef::from(cx.global());
    let task = RefPtr::new(MultiPartUpload {
        self_ref: Cell::new(None),
        queue: OnceCell::new(),
        available: Cell::new(IntegerBitSet::init_full()),
        current_part_number: Cell::new(1),
        ref_count: Cell::new(1),
        ended: Cell::new(false),
        options: Cell::new(options),
        acl: None,
        storage_class,
        request_payer,
        credentials,
        poll_ref: JsKeepAlive::active(),
        abort_handle: bun_jsc::AbortHandle::for_owner::<MultiPartUpload>(),
        context: cx.context().id(),
        // SAFETY (JSC_BORROW): VirtualMachine::get() returns the live per-thread VM; it
        // outlives every MultiPartUpload (the VM owns the heap that owns the JS objects
        // keeping this task alive). Dereference to `&'static` for storage.
        vm: VirtualMachine::get(),
        global_this: global_static,
        buffered: JsCell::new(StreamBuffer::default()),
        uploaded_bytes: Cell::new(0),
        path: Box::<[u8]>::from(path),
        proxy: None,
        content_type: content_type.map(Box::<[u8]>::from),
        content_disposition: content_disposition.map(Box::<[u8]>::from),
        content_encoding: content_encoding.map(Box::<[u8]>::from),
        upload_id: JsCell::new(Box::default()),
        multipart_etags: JsCell::new(Vec::new()),
        multipart_upload_list: JsCell::new(Vec::new()),
        state: Cell::new(MultiPartUploadState::NotStarted),
        callback: JsCell::new(None), // assigned below
    });
    task.self_ref.set(Some(task.clone()));

    // SAFETY: heap-allocated and refcounted; it leaves its context when it finishes or drops.
    unsafe { bun_jsc::AbortHandle::arm_owner(task.as_ptr(), cx.context()) };

    let task_ptr = task.this_ptr();
    let sink = RefPtr::new(NetworkSink {
        task: Some(task),
        global_this: Some(bun_ptr::BackRef::new(cx.global())),
        ..Default::default()
    });
    task_ptr
        .callback
        .set(Some(UploadCallback::Writer(sink.clone())));
    Ok(NetworkSink::to_js(sink, cx.global()))
}

// (Aligned for `NativePromiseContext`, which packs its tag into the pointer's low bits.)
#[derive(bun_ptr::CellRefCounted)]
#[repr(align(16))]
pub(crate) struct S3UploadStreamWrapper {
    pub(crate) ref_count: core::cell::Cell<u32>,

    pub sink: Option<AliasableBox<NetworkSink>>,
    pub task: RefPtr<MultiPartUpload>,
    pub(crate) end_promise: bun_jsc::JSPromiseStrong,
    pub callback: Option<Box<dyn FnOnce(S3UploadResult<'_>)>>,
    /// Roots the source ReadableStream, and the JS pump reachable only through it, until this wrapper drops.
    pub readable_stream_ref: ReadableStreamStrong,
    pub global: GlobalRef, // JSC_BORROW
}

impl S3UploadStreamWrapper {
    fn detach_sink(&mut self) {
        bun_output::scoped_log!(S3UploadStream, "detachSink {}", self.sink.is_some());
        if let Some(sink) = self.sink.take() {
            // SAFETY: live until `sink` drops.
            unsafe { (*sink.as_ptr()).source.detach(&self.global) };
        }
    }

    /// Exclusive borrow of the sink while `self.sink` is `Some` (owned
    /// allocation from `upload_stream` until `detach_sink`). Single-threaded.
    #[inline]
    fn sink_mut(&mut self) -> Option<&mut NetworkSink> {
        // SAFETY: sink is a live Box allocation owned by this wrapper.
        self.sink.as_ref().map(|p| unsafe { &mut *p.as_ptr() })
    }

    /// Stream pump rejected. Rejects the caller's end_promise and fails the upload, under the pump's ref.
    pub(crate) fn handle_reject_stream(&mut self, err: JSValue) {
        bun_output::scoped_log!(S3UploadStream, "handleRejectStream");
        self.detach_sink();
        if self.end_promise.has_value() && !err.is_empty_or_undefined_or_null() {
            // if we have a explicit error, reject the promise
            // if not when calling .fail will create a S3Error instance
            // this match the previous behavior
            let _ = self.end_promise.reject(&self.global, Ok(err));
            self.end_promise = bun_jsc::JSPromiseStrong::empty();
        }
        // idempotent (`state != Finished`); `task.ended` was set by the pump's close path
        let _ = self.task.fail(Error::S3Error {
            code: b"UnknownError",
            message: b"ReadableStream ended with an error",
        });
    }

    pub(crate) fn resolve(this: &RefPtr<Self>, result: S3UploadResult) -> JsResult<()> {
        bun_output::scoped_log!(S3UploadStream, "resolve");
        let this = this.as_ptr();
        // SAFETY: the caller's ref outlives both borrows.
        unsafe {
            let native_pump_ref = (*this)
                .sink_mut()
                .and_then(|sink| sink.native_pump_ref.take());
            (*this).settle(result, native_pump_ref.is_some())
        }
    }

    fn settle(&mut self, result: S3UploadResult, ends_native_pump: bool) -> JsResult<()> {
        let global = self.global;
        // The native teardown (source close, pump-ref release, completion callback)
        // runs on every path; the promise slots are settled until one settle leaves an
        // exception pending, which is what this returns (nothing settles over it).
        let mut settled: JsResult<()> = Ok(());
        match &result {
            S3UploadResult::Success => {
                let uploaded = JSValue::js_number(self.task.uploaded_bytes.get() as f64);
                if let Some(sink) = self.sink_mut() {
                    sink.pending.run();
                    if settled.is_ok() && sink.flush_promise.has_value() {
                        settled = sink.flush_promise.resolve(&global, JSValue::js_number(0.0));
                    }
                    if settled.is_ok() && sink.end_promise.has_value() {
                        settled = sink.end_promise.resolve(&global, uploaded);
                    }
                }
                if self.end_promise.has_value() {
                    if settled.is_ok() {
                        settled = self.end_promise.resolve(&global, uploaded);
                    }
                    self.end_promise = bun_jsc::JSPromiseStrong::empty();
                }
            }
            S3UploadResult::Failure(err) => {
                // If the native ByteStream source errored, prefer the original
                // JS error it stashed on the sink (preserves `.code` /
                // `.name`) over the generic `UnknownError` passed to `fail()`.
                let stashed = self.sink_mut().and_then(|s| s.upstream_error.try_swap());
                let js_err =
                    stashed.unwrap_or_else(|| s3_error_to_js(err, &global, Some(&self.task.path)));
                js_err.ensure_still_alive();
                if let Some(sink) = self.sink_mut() {
                    // Sink pump still in-flight: fire source.close() so the JSSink
                    // controller's onClose cancels the upstream ReadableStream. The
                    // pump promise settles after, triggering the `.then` shim which
                    // calls `detach_sink` and releases the pump ref.
                    sink.ended = true;
                    sink.done = true;
                    sink.pending.result = crate::webcore::streams::Writable::Done;
                    sink.pending.run();
                    if settled.is_ok() && sink.flush_promise.has_value() {
                        settled = sink.flush_promise.reject(&global, Ok(js_err));
                    }
                    if settled.is_ok() && sink.end_promise.has_value() {
                        settled = sink.end_promise.reject(&global, Ok(js_err));
                    }
                    sink.source.close(None);
                }
                // The stream is not read again. Unrooted, its pump (which may never settle: the
                // script running it may be a disposed `Bun.ModuleGraph`'s) can be collected.
                self.readable_stream_ref = ReadableStreamStrong::default();
                if ends_native_pump {
                    self.detach_sink();
                }
                if self.end_promise.has_value() {
                    if settled.is_ok() {
                        settled = self.end_promise.reject(&global, Ok(js_err));
                    }
                    self.end_promise = bun_jsc::JSPromiseStrong::empty();
                }
            }
        }

        if let Some(callback) = self.callback.take() {
            callback(result);
        }
        settled
    }
}

pub(crate) fn on_resolve_upload_stream(
    _: &mut JsScope<'_>,
    _: JsLocal<'_>,
    context: Option<RefPtr<S3UploadStreamWrapper>>,
) {
    // `sink.end()` already wrote EOF to the task.
    if let Some(this) = context {
        // SAFETY: a reaction runs with no borrow of the wrapper below it.
        unsafe { (*this.as_ptr()).detach_sink() };
    }
}

pub(crate) fn on_reject_upload_stream(
    _: &mut JsScope<'_>,
    err: JsLocal<'_>,
    context: Option<RefPtr<S3UploadStreamWrapper>>,
) {
    if let Some(this) = context {
        // SAFETY: a reaction runs with no borrow of the wrapper below it.
        unsafe { (*this.as_ptr()).handle_reject_stream(err.to_js()) };
    }
}

impl Drop for S3UploadStreamWrapper {
    fn drop(&mut self) {
        bun_output::scoped_log!(S3UploadStream, "deinit {}", self.sink.is_some());
        self.detach_sink();
    }
}

/// consumes the readable stream and upload to s3
///
/// `credentials` is moved into the `MultiPartUpload`.
#[inline(never)]
pub(crate) fn upload_stream(
    credentials: bun_ptr::RefPtr<S3Credentials>,
    path: &[u8],
    readable_stream: ReadableStream,
    cx: &bun_jsc::JsThread<'_>,
    options: MultiPartUploadOptions,
    acl: Option<ACL>,
    storage_class: Option<StorageClass>,
    content_type: Option<&[u8]>,
    content_disposition: Option<&[u8]>,
    content_encoding: Option<&[u8]>,
    proxy: Option<&[u8]>,
    request_payer: bool,
    callback: Option<Box<dyn FnOnce(S3UploadResult<'_>)>>,
) -> JsResult<JSValue> {
    bun_removable_features::removable_definition!(S3Client, upload_stream);
    if readable_stream.is_disturbed(cx.global()) {
        return Ok(bun_jsc::JSPromise::rejected_promise(
            cx.global(),
            cx.global()
                .create_error_instance(format_args!("ReadableStream is already disturbed")),
        )
        .to_js());
    }

    match readable_stream.ptr {
        ReadableStreamPtr::Invalid => {
            return Ok(bun_jsc::JSPromise::rejected_promise(
                cx.global(),
                cx.global()
                    .create_error_instance(format_args!("ReadableStream is invalid")),
            )
            .to_js());
        }
        // The File/Bytes payload types
        // differ (`*FileReader` vs `*ByteStream`), so the arms are
        // unrolled here.
        ReadableStreamPtr::Bytes(_) => {
            // BACKREF: see `Source::bytes()` — payload live while the
            // ReadableStream JS wrapper is rooted. R-2: `pending` is `JsCell`.
            let stream = readable_stream.ptr.bytes().expect("matched Bytes");
            if matches!(
                stream.pending.get().result,
                crate::webcore::streams::StreamResult::Err(_)
            ) {
                // we got an error, fail early
                let err = match stream.pending.with_mut(|p| {
                    core::mem::replace(&mut p.result, crate::webcore::streams::StreamResult::Done)
                }) {
                    crate::webcore::streams::StreamResult::Err(err) => err,
                    _ => unreachable!(),
                };
                stream.pending.set(crate::webcore::streams::Pending {
                    result: crate::webcore::streams::StreamResult::Done,
                    ..Default::default()
                });
                let js_err = err.to_js(cx.global());
                js_err.ensure_still_alive();
                return Ok(bun_jsc::JSPromise::rejected_promise(cx.global(), js_err).to_js());
            }
        }
        ReadableStreamPtr::File(_) => {
            // BACKREF: see `Source::file()` — payload live while the
            // ReadableStream JS wrapper is rooted. R-2: `pending` is `JsCell`.
            let stream = readable_stream.ptr.file().expect("matched File");
            if matches!(
                stream.pending.get().result,
                crate::webcore::streams::StreamResult::Err(_)
            ) {
                // we got an error, fail early
                let err = match stream.pending.with_mut(|p| {
                    core::mem::replace(&mut p.result, crate::webcore::streams::StreamResult::Done)
                }) {
                    crate::webcore::streams::StreamResult::Err(err) => err,
                    _ => unreachable!(),
                };
                stream.pending.set(crate::webcore::streams::Pending {
                    result: crate::webcore::streams::StreamResult::Done,
                    ..Default::default()
                });
                let js_err = err.to_js(cx.global());
                js_err.ensure_still_alive();
                return Ok(bun_jsc::JSPromise::rejected_promise(cx.global(), js_err).to_js());
            }
        }
        _ => {}
    }

    // SAFETY (JSC_BORROW): see `writable_stream` for rationale.
    let global_static = GlobalRef::from(cx.global());
    let task = RefPtr::new(MultiPartUpload {
        self_ref: Cell::new(None),
        queue: OnceCell::new(),
        available: Cell::new(IntegerBitSet::init_full()),
        current_part_number: Cell::new(1),
        ref_count: Cell::new(1),
        ended: Cell::new(false),
        options: Cell::new(options),
        acl,
        storage_class,
        request_payer,
        credentials,
        poll_ref: JsKeepAlive::active(),
        abort_handle: bun_jsc::AbortHandle::for_owner::<MultiPartUpload>(),
        context: cx.context().id(),
        // SAFETY (JSC_BORROW): VirtualMachine::get() returns the live per-thread VM; it
        // outlives every MultiPartUpload. Dereference to `&'static` for storage.
        vm: VirtualMachine::get(),
        global_this: global_static,
        buffered: JsCell::new(StreamBuffer::default()),
        uploaded_bytes: Cell::new(0),
        path: Box::<[u8]>::from(path),
        proxy: proxy.map(Box::<[u8]>::from),
        content_type: content_type.map(Box::<[u8]>::from),
        content_disposition: content_disposition.map(Box::<[u8]>::from),
        content_encoding: content_encoding.map(Box::<[u8]>::from),
        upload_id: JsCell::new(Box::default()),
        multipart_etags: JsCell::new(Vec::new()),
        multipart_upload_list: JsCell::new(Vec::new()),
        state: Cell::new(MultiPartUploadState::WaitStreamCheck),
        callback: JsCell::new(None), // assigned below
    });
    task.self_ref.set(Some(task.clone()));

    // SAFETY: heap-allocated and refcounted; it leaves its context when it finishes or drops.
    unsafe { bun_jsc::AbortHandle::arm_owner(task.as_ptr(), cx.context()) };

    let pump_ref = RefPtr::new(S3UploadStreamWrapper {
        ref_count: Cell::new(1),
        sink: None,
        callback,
        task,
        end_promise: bun_jsc::JSPromiseStrong::init(cx.global()),
        readable_stream_ref: ReadableStreamStrong::default(),
        global: global_static,
    });
    pump_ref
        .task
        .callback
        .set(Some(UploadCallback::Stream(pump_ref.clone())));
    // SAFETY: freshly heap-allocated; exclusive access here.
    let ctx = unsafe { &mut *pump_ref.as_ptr() };

    // Ownership stays with `ctx.sink` (freed in `detach_sink`); the JS
    // controller created by `assign_to_stream` detaches via
    // `controller.end()/close()` before GC so its `Drop` never calls
    // `controller_finalize` on this allocation.
    let sink = AliasableBox::new(NetworkSink {
        task: Some(ctx.task.clone()),
        global_this: Some(bun_ptr::BackRef::new(cx.global())),
        ..Default::default()
    });
    // SAFETY: live until `detach_sink`.
    let sink = unsafe { &mut *ctx.sink.insert(sink).as_ptr() };
    let sink_handle = crate::webcore::SinkHandle::S3Upload(bun_ptr::BackRef::new_mut(sink));

    // Captured before `assign_to_stream`: a synchronously-draining stream may
    // resolve + clear `ctx.end_promise` before control returns here.
    let end_promise_value = ctx.end_promise.value();
    end_promise_value.ensure_still_alive();

    // Transition WaitStreamCheck → NotStarted before the pump can deliver the
    // first chunk: `readStreamIntoSink`'s `readMany()` drains a pre-enqueued
    // default-controller stream synchronously inside `assign_to_stream`.
    MultiPartUpload::continue_stream(&ctx.task);

    ctx.readable_stream_ref = ReadableStreamStrong::init(readable_stream, cx.global());

    // Native ByteStream fast-path: wire the source/sink handles directly so
    // bytes flow via `ByteStream::on_data` → `SinkHandle::write` without the JS
    // `readStreamIntoSink` pump.
    if let Some(byte_stream) = readable_stream.ptr.bytes() {
        if byte_stream.sink.get().is_none() {
            sink.source = crate::webcore::streams::SourceHandle::ByteStream(byte_stream);
            byte_stream.sink.set(sink_handle);
            byte_stream.sink_paused.set(false);
            readable_stream.lock_native(cx.global());
            byte_stream.signal_consumer_attached();

            if let Some(err) = byte_stream.take_pending_error() {
                byte_stream.detach_sink(Some(&err));
                let err_js = err.to_js(cx.global());
                err_js.ensure_still_alive();
                ctx.handle_reject_stream(err_js);
                return Ok(end_promise_value);
            }

            let buffered = byte_stream.take_buffer();
            let had_last = byte_stream.has_received_last_chunk.get();
            if !buffered.is_empty() {
                let chunk = if had_last {
                    crate::webcore::streams::StreamResult::OwnedAndDone(buffered)
                } else {
                    crate::webcore::streams::StreamResult::Owned(buffered)
                };
                match sink_handle.write(&chunk) {
                    crate::webcore::streams::Writable::Backpressure(_) => {
                        byte_stream.sink_paused.set(true);
                    }
                    crate::webcore::streams::Writable::Done
                    | crate::webcore::streams::Writable::Err(_) => {
                        byte_stream.detach_sink(None);
                        sink.source.clear();
                        if !sink.ended {
                            let _ = sink.end(None);
                        }
                        ctx.detach_sink();
                        return Ok(end_promise_value);
                    }
                    _ => {}
                }
            }
            if had_last || sink.ended {
                byte_stream.detach_sink(None);
                sink.source.clear();
                if !sink.ended {
                    let _ = sink.end(None);
                }
                ctx.detach_sink();
                return Ok(end_promise_value);
            }
            sink.native_pump_ref = Some(pump_ref);
            if !byte_stream.sink_paused.get() {
                // Wake the producer after the older bytes are in the sink.
                byte_stream.signal_drained();
            }
            return Ok(end_promise_value);
        }
        // sink already attached: fall through to the JS pump.
    }

    // The controller cell is installed into `sink.source` by `assign_to_stream`.
    let assignment_result: JSValue = ReadableSinkController::assign_to_stream(
        cx.global(),
        readable_stream.value,
        NonNull::from(sink),
    );
    assignment_result.ensure_still_alive();

    if let Some(err_value) = assignment_result.to_error() {
        ctx.handle_reject_stream(err_value);
        return Ok(end_promise_value);
    }

    if !assignment_result.is_empty_or_undefined_or_null() {
        if let Some(promise) = assignment_result.as_any_promise() {
            match promise.status() {
                bun_jsc::js_promise::Status::Pending => {
                    // The pump's ref rides a cell the reaction owns: a pump that never
                    // settles releases it when the promise is collected.
                    assignment_result.then_with_value(
                        cx.global(),
                        crate::api::native_promise_context::create(
                            cx.global(),
                            pump_ref,
                            JSValue::ZERO,
                        ),
                        Bun__S3UploadStream__onResolveStream,
                        Bun__S3UploadStream__onRejectStream,
                    );
                }
                bun_jsc::js_promise::Status::Fulfilled => {
                    ctx.detach_sink();
                }
                bun_jsc::js_promise::Status::Rejected => {
                    promise.set_handled(cx.global().vm());
                    let result = promise.result(cx.global().vm());
                    ctx.handle_reject_stream(result);
                }
            }
            return Ok(end_promise_value);
        }
    }

    // The stream drained synchronously inside `assign_to_stream` (no promise
    // returned). `detach_sink` destroys the sink, so re-borrow from
    // `ctx.sink` rather than the `sink` reference taken before assign_to_stream.
    if let Some(sink) = ctx.sink_mut() {
        if !sink.ended {
            let _ = sink.end(None);
        }
    }
    ctx.detach_sink();
    Ok(end_promise_value)
}

/// download a file from s3 chunk by chunk aka streaming (used on readableStream)
#[inline(never)]
fn download_stream(
    this: &S3Credentials,
    context: &bun_jsc::ScriptExecutionContext,
    offset: usize,
    size: Option<usize>,
    request_payer: bool,
    wrapper: AliasableBox<S3DownloadStreamWrapper>,
) {
    bun_removable_features::removable_definition!(S3Client, download_stream);
    if s3_simple_request::nothing_new_leaves(context) {
        return wrapper.on_error(&s3_simple_request::NOTHING_NEW_LEAVES);
    }
    let range: Option<Vec<u8>> = 'brk: {
        if let Some(size_) = size {
            let mut end = offset + size_;
            if size_ > 0 {
                end -= 1;
            }
            let mut v = Vec::new();
            write!(&mut v, "bytes={}-{}", offset, end).expect("infallible: in-memory write");
            break 'brk Some(v);
        }
        if offset == 0 {
            break 'brk None;
        }
        let mut v = Vec::new();
        write!(&mut v, "bytes={}-", offset).expect("infallible: in-memory write");
        Some(v)
    };

    let result = match this.sign_request::<false>(
        &bun_s3_signing::SignOptions {
            path: &wrapper.path,
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
            return wrapper.on_error(&Error::S3Error {
                code: error_code_and_message.code,
                message: error_code_and_message.message,
            });
        }
    };

    let headers = result.headers(range.as_deref(), None);
    let owned_proxy = s3_simple_request::resolve_proxy(None, &result.url);
    let task_ptr = bun_core::heap::into_raw(S3HttpDownloadStreamingTask::new(
        S3HttpDownloadStreamingTask {
            sign_result: result,
            proxy_url: owned_proxy,
            wrapper,
            headers,
            http_ticket: None,
            has_schedule_callback: core::sync::atomic::AtomicBool::new(false),
            signal_store: Default::default(),
            poll_ref: JsKeepAlive::active(),
            mutex: Default::default(),
            request_error: None,
            reported_response_buffer: MutableString::default(),
            // `State::default()` sets
            // `has_more = true` (bit 48). Passing 0 here would start the task with
            // `has_more == false`, tripping the `assert(state.has_more)` in
            // `process_http_callback` on the very first HTTP-thread callback.
            state: core::sync::atomic::AtomicU64::new(
                crate::webcore::s3::download_stream::State::default().0,
            ),
            concurrent_task: Default::default(),
            async_http_id: 0,
            abort_handle: bun_jsc::AbortHandle::for_owner::<S3HttpDownloadStreamingTask>(),
        },
    ));
    // SAFETY: just allocated, non-null, and `task` is not used once `task_ptr` is dereferenced.
    // `'static`: `url`, `headers_buf` and `http_proxy` borrow heap buffers that `*task` owns and
    // never writes again, for the HTTP thread. They remain valid until `task` is dropped in
    // `S3HttpDownloadStreamingTask::on_response`. See `execute_simple_s3_request`.
    let task: &'static mut S3HttpDownloadStreamingTask = unsafe { &mut *task_ptr };
    let url = bun_url::URL::parse(&task.sign_result.url);
    let headers_buf: &'static [u8] = task.headers.buf.as_slice();
    let http_proxy = if !task.proxy_url.is_empty() {
        Some(bun_url::URL::parse(&task.proxy_url))
    } else {
        None
    };

    let vm = VirtualMachine::get();
    let verbose = vm.get_verbose_fetch();
    let reject_unauthorized = vm.get_tls_reject_unauthorized();

    let http = bun_http::AsyncHTTP::init(
        bun_http::Method::GET,
        url,
        task.headers.entries.clone().expect("OOM"),
        headers_buf,
        b"",
        bun_http::HTTPClientResultCallback::new_with_release::<S3HttpDownloadStreamingTask>(
            task_ptr,
            // SAFETY: `task_ptr` is the heap-allocated task registered above; the
            // HTTP thread invokes this with that exact pointer.
            S3HttpDownloadStreamingTask::http_callback,
            S3HttpDownloadStreamingTask::release_at_shutdown,
        ),
        bun_http::FetchRedirect::Follow,
        bun_http::async_http::Options {
            http_proxy,
            verbose: Some(verbose),
            signals: Some(task.signal_store.to_with_backpressure()),
            reject_unauthorized: Some(reject_unauthorized),
            tls_props: crate::socket::http_client_defaults(vm),
            ..Default::default()
        },
    );
    task.async_http_id = http.async_http_id;
    task.wrapper.task.set(task_ptr);
    // enable streaming
    http.enable_response_body_streaming();
    // queue http request
    bun_http::http_thread::init(&Default::default());
    // Out on the HTTP thread until its final callback: its context aborts it
    // when it stops, and the VM waits for it (the ticket).
    task.http_ticket = Some(VirtualMachine::get().ticket());
    // SAFETY: the task is heap-allocated and drops its handle with itself.
    unsafe { bun_jsc::AbortHandle::arm_owner(task_ptr, context) };
    bun_http::HTTPThread::schedule([http]);
}

pub struct S3DownloadStreamWrapper {
    stream: crate::webcore::byte_stream::ProducerHold,
    pub path: Box<[u8]>,
    pub global: GlobalRef, // JSC_BORROW
    /// Owns `self`, so it is live. Null until `download_stream` sets it and once the stream is cancelled.
    pub task: Cell<*mut S3HttpDownloadStreamingTask>,
}

impl S3DownloadStreamWrapper {
    pub(crate) fn on_error(&self, err: &Error::S3Error) {
        let Some(bytes) = self.stream.take() else {
            return;
        };
        bytes.on_data(crate::webcore::streams::StreamResult::Err(
            crate::webcore::streams::StreamError::JSValue(bun_jsc::strong::Optional::create(
                s3_error_to_js(err, &self.global, Some(&self.path)),
                &self.global,
            )),
        ));
    }

    pub(crate) fn on_chunk(&self, chunk: &MutableString, has_more: bool) {
        if has_more {
            let Some(bytes) = self.stream.bytes() else {
                return;
            };
            bytes.on_data(crate::webcore::streams::StreamResult::Temporary(
                // chunk.list is borrowed for the duration of on_data.
                bun_ptr::RawSlice::new(chunk.list.as_slice()),
            ));
            // `on_data` can cancel us, which releases the hold.
            if self.stream.is_held() {
                self.after_chunk_delivered(&bytes);
            }
            return;
        }
        let Some(bytes) = self.stream.take() else {
            return;
        };
        bytes.on_data(crate::webcore::streams::StreamResult::TemporaryAndDone(
            // chunk.list is borrowed for the duration of on_data.
            bun_ptr::RawSlice::new(chunk.list.as_slice()),
        ));
    }

    /// The other half of this rule is in `S3HttpDownloadStreamingTask::process_http_callback`
    /// (HTTP thread).
    fn after_chunk_delivered(&self, bytes: &ByteStream) {
        use crate::webcore::byte_stream::AfterDelivery;
        let task = self.task.get();
        if task.is_null() {
            return;
        }
        match self.stream.after_delivery(bytes) {
            // SAFETY: see `task`.
            AfterDelivery::Resume => unsafe { (*task).resume_receive() },
            // SAFETY: see `task`.
            AfterDelivery::Pause => unsafe { (*task).signal_store.pause_receive() },
            AfterDelivery::Park => {
                // SAFETY: see `task`.
                unsafe { (*task).signal_store.pause_receive() };
                if self.stream.park() {
                    // SAFETY: see `task`.
                    unsafe { (*task).poll_ref.unref(bun_io::js_vm_ctx()) };
                }
            }
        }
    }

    fn unpark(&self) {
        let task = self.task.get();
        if self.stream.unpark() && !task.is_null() {
            // SAFETY: see `task`; reached from a consumer, so the task is still live.
            unsafe { (*task).poll_ref.ref_(bun_io::js_vm_ctx()) };
        }
    }

    pub(crate) fn on_stream_drained(&self) {
        self.unpark();
        let task = self.task.get();
        if !task.is_null() {
            // SAFETY: see `task`.
            unsafe { (*task).resume_receive() };
        }
    }

    pub(crate) fn on_consumer_attached(&self) {
        self.unpark();
    }

    /// The stream's wrapper was collected: nothing can read the rest. Inside a GC sweep;
    /// touches no JS cell.
    pub(crate) fn on_stream_collected(&self) {
        self.on_stream_cancelled();
    }

    pub(crate) fn on_stream_cancelled(&self) {
        // The download may still be in progress, but `on_chunk` will see no stream and skip
        // delivery. When the download finishes (has_more == false) the task frees this wrapper.
        self.stream.release();
        // Abort the in-flight HTTP request so the HTTP thread delivers a final
        // callback with `has_more == false`, which frees the task and this wrapper.
        // Without this, a server that never sends the terminal chunk would leak both.
        let task = self.task.replace(core::ptr::null_mut());
        if !task.is_null() {
            // SAFETY: see `task`.
            unsafe {
                (*task)
                    .signal_store
                    .aborted
                    .store(true, core::sync::atomic::Ordering::Relaxed);
                (*task).poll_ref.unref(bun_io::js_vm_ctx());
                // Wake the HTTP thread so it observes the abort even when the
                // socket is idle; otherwise the final `has_more == false`
                // callback never fires and both the task and wrapper leak.
                bun_http::HTTPThread::schedule_shutdown((*task).async_http_id);
            }
        }
    }
}

/// returns a readable stream that reads from the s3 path
#[inline(never)]
pub(crate) fn readable_stream(
    this: &S3Credentials,
    path: &[u8],
    offset: usize,
    size: Option<usize>,
    request_payer: bool,
    cx: &bun_jsc::JsThread<'_>,
) -> JsResult<JSValue> {
    bun_removable_features::removable_definition!(S3Client, readable_stream);
    // SAFETY (JSC_BORROW): `global_this` outlives the wrapper (it owns the JS heap that
    // owns the readable stream which keeps the wrapper reachable via the producer handle);
    // store as `'static` for the heap-allocated wrapper.
    let global_static = GlobalRef::from(cx.global());

    // Ownership of the heap-allocated NewSource transfers to the JS wrapper via
    // `to_readable_stream()`/`to_js()`; the wrapper's finalize() reclaims it.
    let reader =
        crate::webcore::byte_stream::Source::new_mut(crate::webcore::readable_stream::NewSource {
            context: ByteStream::default(),
            global_this: Cell::new(Some(bun_ptr::BackRef::new(cx.global()))),
            ..Default::default()
        });

    reader.context.setup();
    let readable_value = reader.to_readable_stream(cx)?;

    let wrapper = AliasableBox::new(S3DownloadStreamWrapper {
        stream: Default::default(),
        path: Box::<[u8]>::from(path),
        global: global_static,
        task: Cell::new(core::ptr::null_mut()),
    });
    // SAFETY: `reader` is the live source made above.
    unsafe { wrapper.stream.hold(&raw mut reader.context) };

    reader
        .producer
        .set(crate::webcore::streams::SourceHandle::S3DownloadBody(
            // Cleared before `wrapper` is freed (`ProducerHold::take`).
            bun_ptr::BackRef::from(wrapper.as_non_null()),
        ));

    download_stream(this, cx.context(), offset, size, request_payer, wrapper);
    Ok(readable_value)
}
