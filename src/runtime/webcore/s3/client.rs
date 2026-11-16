use core::cell::{Cell, OnceCell};
use std::io::Write as _;
use std::sync::Arc;

use bun_collections::{ByteVecExt, VecExt};
use bun_http::HeadersExt as _;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{GlobalRef, JSValue, JsCell, JsResult};
use bun_ptr::{CellExt as _, OptionCellExt as _, RefCount, RefPtr};

// Re-exports (thin aliases)
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
use crate::webcore::byte_stream::ProducerHold;
use crate::webcore::readable_stream::Source as ReadableStreamPtr;
use crate::webcore::readable_stream::Strong as ReadableStreamStrong;
use crate::webcore::s3::download_stream::{S3HttpDownloadStreamingTask, fail_stream};
use crate::webcore::s3::multipart::{State as MultiPartUploadState, UploadCallback};
use crate::webcore::sink::ReadableSinkController;
use crate::webcore::streams::{NetworkSink, SourceHandle};
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

    let headers = bun_http::Headers::from_pico_http_headers(&result.headers());
    let proxy_url = s3_simple_request::resolve_proxy(None, &result.url);

    S3HttpSimpleTask::schedule(
        context,
        bun_http::Method::GET,
        result,
        headers,
        proxy_url,
        Box::default(),
        s3_simple_request::Callback::ListObjects(callback),
    );
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
    credentials: Arc<S3Credentials>,
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
    // JSC_BORROW: `global_this` outlives the task (it owns the VM/heap that owns the JS
    // objects which keep the task alive); stored via `GlobalRef` in the heap-allocated
    // MultiPartUpload.
    let global_static = GlobalRef::from(cx.global());
    let task = RefPtr::new(MultiPartUpload {
        self_ref: Cell::new(None),
        queue: OnceCell::new(),
        available: Cell::new(IntegerBitSet::init_full()),
        current_part_number: Cell::new(1),
        ref_count: RefCount::init(),
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

    let sink = NetworkSink::new(task.clone(), cx.global());
    task.callback
        .set(Some(UploadCallback::Writer(sink.clone())));
    Ok(NetworkSink::to_js(sink, cx.global()))
}

// (Aligned for `NativePromiseContext`, which packs its tag into the pointer's low bits.)
#[derive(bun_ptr::RefCounted)]
#[repr(align(16))]
pub(crate) struct S3UploadStreamWrapper {
    pub(crate) ref_count: RefCount,

    sink: Cell<Option<RefPtr<NetworkSink>>>,
    task: RefPtr<MultiPartUpload>,
    end_promise: Cell<Option<bun_jsc::JSPromiseStrong>>,
    callback: Cell<Option<Box<dyn FnOnce(S3UploadResult<'_>)>>>,
    /// Roots the source ReadableStream, and the JS pump reachable only through it, until this wrapper drops.
    readable_stream_ref: Cell<ReadableStreamStrong>,
    global: GlobalRef, // JSC_BORROW
}

impl S3UploadStreamWrapper {
    fn detach_sink(&self) {
        bun_output::scoped_log!(S3UploadStream, "detachSink {}", self.sink.is_some());
        if let Some(sink) = self.sink.take() {
            sink.detach();
        }
    }

    /// `Some` from `upload_stream` until `detach_sink`.
    pub(crate) fn sink(&self) -> Option<RefPtr<NetworkSink>> {
        self.sink.with_taken(|sink| sink.clone())
    }

    /// Stream pump rejected. Rejects the caller's end_promise and fails the upload.
    pub(crate) fn handle_reject_stream(&self, err: JSValue) {
        bun_output::scoped_log!(S3UploadStream, "handleRejectStream");
        self.detach_sink();
        if !err.is_empty_or_undefined_or_null()
            && let Some(mut end_promise) = self.end_promise.take()
        {
            // if we have a explicit error, reject the promise
            // if not when calling .fail will create a S3Error instance
            // this match the previous behavior
            let _ = end_promise.reject(&self.global, Ok(err));
        }
        // idempotent (`state != Finished`); `task.ended` was set by the pump's close path
        let _ = self.task.fail(Error::S3Error {
            code: b"UnknownError",
            message: b"ReadableStream ended with an error",
        });
    }

    pub(crate) fn resolve(&self, result: S3UploadResult) -> JsResult<()> {
        bun_output::scoped_log!(S3UploadStream, "resolve");
        let global = self.global;
        let sink = self.sink();
        // The native teardown (source close, completion callback)
        // runs on every path; the promise slots are settled until one settle leaves an
        // exception pending, which is what this returns (nothing settles over it).
        let mut settled: JsResult<()> = Ok(());
        match &result {
            S3UploadResult::Success => {
                let uploaded = JSValue::js_number(self.task.uploaded_bytes.get() as f64);
                if let Some(sink) = sink {
                    sink.pending.run();
                    if let Some(mut flush_promise) = sink.flush_promise.take() {
                        settled = flush_promise.resolve(&global, JSValue::js_number(0.0));
                    }
                    if settled.is_ok()
                        && let Some(mut end_promise) = sink.end_promise.take()
                    {
                        settled = end_promise.resolve(&global, uploaded);
                    }
                }
                if let Some(mut end_promise) = self.end_promise.take()
                    && settled.is_ok()
                {
                    settled = end_promise.resolve(&global, uploaded);
                }
            }
            S3UploadResult::Failure(err) => {
                // If the native ByteStream source errored, prefer the original
                // JS error it stashed on the sink (preserves `.code` /
                // `.name`) over the generic `UnknownError` passed to `fail()`.
                let stashed = sink.as_ref().and_then(|s| s.upstream_error.get());
                let js_err =
                    stashed.unwrap_or_else(|| s3_error_to_js(err, &global, Some(&self.task.path)));
                js_err.ensure_still_alive();
                if let Some(sink) = sink {
                    // Sink pump still in-flight: fire source.close() so the JSSink
                    // controller's onClose cancels the upstream ReadableStream. The
                    // pump promise settles after, triggering the `.then` shim which
                    // calls `detach_sink` and releases `ctx`.
                    sink.upstream_error.clear();
                    sink.ended.set(true);
                    sink.done.set(true);
                    sink.pending.run_done();
                    if let Some(mut flush_promise) = sink.flush_promise.take() {
                        settled = flush_promise.reject(&global, Ok(js_err));
                    }
                    if settled.is_ok()
                        && let Some(mut end_promise) = sink.end_promise.take()
                    {
                        settled = end_promise.reject(&global, Ok(js_err));
                    }
                    let source = sink.source.get();
                    source.close(None);
                    if matches!(source, SourceHandle::ByteStream(_)) {
                        // While `readable_stream_ref` keeps the source alive.
                        self.detach_sink();
                    }
                }
                // The stream is not read again. Unrooted, its pump (which may never settle: the
                // script running it may be a disposed `Bun.ModuleGraph`'s) can be collected.
                self.readable_stream_ref.take();
                if let Some(mut end_promise) = self.end_promise.take()
                    && settled.is_ok()
                {
                    settled = end_promise.reject(&global, Ok(js_err));
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
        this.detach_sink();
    }
}

pub(crate) fn on_reject_upload_stream(
    _: &mut JsScope<'_>,
    err: JsLocal<'_>,
    context: Option<RefPtr<S3UploadStreamWrapper>>,
) {
    if let Some(this) = context {
        this.handle_reject_stream(err.to_js());
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
    credentials: Arc<S3Credentials>,
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
        ReadableStreamPtr::Bytes(_) => {
            let stream = readable_stream.ptr.bytes().expect("matched Bytes");
            if let Some(err) = stream.take_pending_error() {
                // we got an error, fail early
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
        ref_count: RefCount::init(),
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

    let sink = NetworkSink::new(task.clone(), cx.global());
    let end_promise = bun_jsc::JSPromiseStrong::init(cx.global());
    // Captured before `assign_to_stream`, which can resolve and clear `ctx.end_promise`.
    let end_promise_value = end_promise.value();
    let ctx = RefPtr::new(S3UploadStreamWrapper {
        ref_count: RefCount::init(),
        sink: Cell::new(Some(sink.clone())),
        callback: Cell::new(callback),
        task,
        end_promise: Cell::new(Some(end_promise)),
        readable_stream_ref: Cell::new(ReadableStreamStrong::init(readable_stream, cx.global())),
        global: global_static,
    });
    ctx.task
        .callback
        .set(Some(UploadCallback::Stream(ctx.clone())));
    end_promise_value.ensure_still_alive();

    // Transition WaitStreamCheck → NotStarted before the pump can deliver the
    // first chunk: `readStreamIntoSink`'s `readMany()` drains a pre-enqueued
    // default-controller stream synchronously inside `assign_to_stream`.
    MultiPartUpload::continue_stream(&ctx.task);

    // Native ByteStream fast-path: wire the source/sink handles directly so
    // bytes flow via `ByteStream::on_data` → `SinkHandle::write` without the JS
    // `readStreamIntoSink` pump.
    if let Some(byte_stream) = readable_stream.ptr.bytes() {
        if byte_stream.sink.is_none() {
            sink.source.set(SourceHandle::ByteStream(byte_stream));
            byte_stream
                .sink
                .set(Some(crate::webcore::SinkHandle::S3Upload(sink.clone())));
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
                match sink.write(&chunk) {
                    crate::webcore::streams::Writable::Backpressure(_) => {
                        byte_stream.sink_paused.set(true);
                    }
                    crate::webcore::streams::Writable::Done
                    | crate::webcore::streams::Writable::Err(_) => {
                        byte_stream.detach_sink(None);
                        sink.source.set(SourceHandle::None);
                        if !sink.ended.get() {
                            let _ = sink.end(None);
                        }
                        ctx.detach_sink();
                        return Ok(end_promise_value);
                    }
                    _ => {}
                }
            }
            if had_last || sink.ended.get() {
                byte_stream.detach_sink(None);
                sink.source.set(SourceHandle::None);
                if !sink.ended.get() {
                    let _ = sink.end(None);
                }
                ctx.detach_sink();
                return Ok(end_promise_value);
            }
            if !byte_stream.sink_paused.get() {
                // Wake the producer after the older bytes are in the sink.
                byte_stream.signal_drained();
            }
            return Ok(end_promise_value);
        }
        // sink already attached: fall through to the JS pump.
    }

    // The controller cell is installed into `sink.source` by `assign_to_stream`.
    let assignment_result: JSValue =
        ReadableSinkController::assign_to_stream(cx.global(), readable_stream.value, &sink);
    assignment_result.ensure_still_alive();

    if let Some(err_value) = assignment_result.to_error() {
        ctx.handle_reject_stream(err_value);
        return Ok(end_promise_value);
    }

    if !assignment_result.is_empty_or_undefined_or_null() {
        if let Some(promise) = assignment_result.as_promise() {
            match promise.status() {
                bun_jsc::js_promise::Status::Pending => {
                    // `ctx` rides a cell the reaction owns: a pump that never
                    // settles releases it when the promise is collected.
                    assignment_result.then_with_value(
                        cx.global(),
                        crate::api::native_promise_context::create(cx.global(), ctx, JSValue::ZERO),
                        Bun__S3UploadStream__onResolveStream,
                        Bun__S3UploadStream__onRejectStream,
                    );
                }
                bun_jsc::js_promise::Status::Fulfilled => {
                    ctx.detach_sink();
                }
                bun_jsc::js_promise::Status::Rejected => {
                    promise.set_handled();
                    let result = promise.result(cx.global().vm());
                    ctx.handle_reject_stream(result);
                }
            }
            return Ok(end_promise_value);
        }
    }

    // The stream drained synchronously inside `assign_to_stream` (no promise returned).
    let _ = sink.end(None);
    ctx.detach_sink();
    Ok(end_promise_value)
}

/// download a file from s3 chunk by chunk aka streaming (used on readableStream)
#[inline(never)]
fn download_stream(
    this: &S3Credentials,
    cx: &bun_jsc::JsThread<'_>,
    path: &[u8],
    offset: usize,
    size: Option<usize>,
    request_payer: bool,
    stream: ProducerHold,
) {
    bun_removable_features::removable_definition!(S3Client, download_stream);
    if s3_simple_request::nothing_new_leaves(cx.context()) {
        let err = s3_simple_request::NOTHING_NEW_LEAVES;
        return fail_stream(&stream, cx.global(), path, &err);
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
            let err = Error::S3Error {
                code: error_code_and_message.code,
                message: error_code_and_message.message,
            };
            return fail_stream(&stream, cx.global(), path, &err);
        }
    };

    let headers = {
        let mut headers = result.headers();
        if let Some(range_) = &range {
            headers.append_assume_capacity(bun_picohttp::Header::new(b"range", range_));
        }
        bun_http::Headers::from_pico_http_headers(&headers)
    };
    let owned_proxy = s3_simple_request::resolve_proxy(None, &result.url);
    S3HttpDownloadStreamingTask::schedule(cx, result, headers, owned_proxy, path, stream);
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

    let stream = ProducerHold::default();
    // SAFETY: `reader` is the live source made above.
    unsafe { stream.hold(&raw mut reader.context) };

    download_stream(this, cx, path, offset, size, request_payer, stream);
    Ok(readable_value)
}
