use core::cell::Cell;
use std::io::Write as _;

use bun_collections::{ByteVecExt, VecExt};
use bun_core::MutableString;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{GlobalRef, JSValue, JsResult};
use bun_ptr::{AliasableBox, RefPtr};

// Re-exports (thin aliases)
pub(crate) use crate::webcore::s3::download_stream::S3HttpDownloadStreamingTask;
pub(crate) use bun_s3_signing::MultiPartUploadOptions;
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
use crate::webcore::s3::multipart::{NetworkSink, NetworkSinkWrapperRef, Owed, Target};
use crate::webcore::sink::{JSSink, ReadableSinkController};
use crate::webcore::streams::{SourceHandle, StreamResult, Writable};
use bun_io::JsKeepAlive;
use bun_jsc::bindgen::{JsLocal, JsScope};

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
    let target = Target {
        credentials,
        path: path.into(),
        proxy: None,
        content_type: content_type.map(Box::from),
        content_disposition: content_disposition.map(Box::from),
        content_encoding: content_encoding.map(Box::from),
        acl: None,
        storage_class,
        request_payer,
    };
    let sink = NetworkSinkWrapperRef(NetworkSink::new(cx, target, options, Owed::Nothing));
    Ok(JSSink::<NetworkSink>::create_object(
        cx.global(),
        sink,
        None,
    ))
}

pub(crate) fn on_resolve_upload_stream(
    _: &mut JsScope<'_>,
    _: JsLocal<'_>,
    context: Option<RefPtr<NetworkSink>>,
) {
    if let Some(sink) = context {
        sink.on_pump_done();
    }
}

pub(crate) fn on_reject_upload_stream(
    _: &mut JsScope<'_>,
    err: JsLocal<'_>,
    context: Option<RefPtr<NetworkSink>>,
) {
    if let Some(sink) = context {
        NetworkSink::on_pump_rejected(&sink, err.to_js());
    }
}

/// consumes the readable stream and upload to s3
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
    if let ReadableStreamPtr::Invalid = readable_stream.ptr {
        return Ok(bun_jsc::JSPromise::rejected_promise(
            cx.global(),
            cx.global()
                .create_error_instance(format_args!("ReadableStream is invalid")),
        )
        .to_js());
    }
    if let Some(stream) = readable_stream.ptr.bytes()
        && let Some(err) = stream.take_pending_error()
    {
        let js_err = err.to_js(cx.global());
        return Ok(bun_jsc::JSPromise::rejected_promise(cx.global(), js_err).to_js());
    }

    let target = Target {
        credentials,
        path: path.into(),
        proxy: proxy.map(Box::from),
        content_type: content_type.map(Box::from),
        content_disposition: content_disposition.map(Box::from),
        content_encoding: content_encoding.map(Box::from),
        acl,
        storage_class,
        request_payer,
    };
    let promise = bun_jsc::JSPromiseStrong::init(cx.global());
    let end_promise_value = promise.value();
    let owed = Owed::Result {
        promise,
        callback,
        stream: ReadableStreamStrong::init(readable_stream, cx.global()),
        stream_error: Default::default(),
    };
    let sink = NetworkSink::new(cx, target, options, owed);

    // Native ByteStream fast-path: wire the source/sink handles directly so
    // bytes flow via `ByteStream::on_data` → `SinkHandle::write` without the JS
    // `readStreamIntoSink` pump.
    if let Some(byte_stream) = readable_stream.ptr.bytes() {
        if byte_stream.sink.get().is_none() {
            sink.source.set(SourceHandle::ByteStream(byte_stream));
            let sink_handle = crate::webcore::SinkHandle::S3Upload(bun_ptr::BackRef::new(&sink));
            byte_stream.sink.set(sink_handle);
            byte_stream.sink_paused.set(false);
            readable_stream.lock_native(cx.global());
            byte_stream.signal_consumer_attached();

            if let Some(err) = byte_stream.take_pending_error() {
                byte_stream.detach_sink(Some(&err));
                NetworkSink::on_pump_rejected(&sink, err.to_js(cx.global()));
                return Ok(end_promise_value);
            }

            let buffered = StreamResult::Owned(byte_stream.take_buffer());
            let had_last = byte_stream.has_received_last_chunk.get();
            if !buffered.slice().is_empty()
                && let Writable::Backpressure(_) = sink.write(&buffered)
            {
                byte_stream.sink_paused.set(true);
            }
            if had_last || sink.is_ended() {
                sink.on_pump_done();
                sink.finish_input();
            } else if !byte_stream.sink_paused.get() {
                // Wake the producer after the older bytes are in the sink.
                byte_stream.signal_drained();
            }
            return Ok(end_promise_value);
        }
        // sink already attached: fall through to the JS pump.
    }

    // The controller cell is installed into `sink.source` by `assign_to_stream`.
    let pump = ReadableSinkController::assign_to_stream(
        cx.global(),
        readable_stream.value,
        sink.as_non_null(),
    );
    if let Some(err) = pump.to_error() {
        NetworkSink::on_pump_rejected(&sink, err);
        return Ok(end_promise_value);
    }
    let Some(promise) = pump.as_any_promise() else {
        if pump.is_termination_exception() {
            NetworkSink::on_pump_terminated(&sink);
        } else {
            // A direct stream closed inside `pull()`.
            sink.finish_input();
            sink.on_pump_done();
        }
        return Ok(end_promise_value);
    };
    match promise.status() {
        // The ref rides a cell the reaction owns: a pump that never settles releases it when the promise is collected.
        bun_jsc::js_promise::Status::Pending => pump.then_with_value(
            cx.global(),
            crate::api::native_promise_context::create(cx.global(), sink, JSValue::ZERO),
            Bun__S3UploadStream__onResolveStream,
            Bun__S3UploadStream__onRejectStream,
        ),
        bun_jsc::js_promise::Status::Fulfilled => sink.on_pump_done(),
        bun_jsc::js_promise::Status::Rejected => {
            promise.set_handled(cx.global().vm());
            NetworkSink::on_pump_rejected(&sink, promise.result(cx.global().vm()));
        }
    }
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
            is_out_of_memory: false,
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
                chunk.list.as_slice(),
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
            chunk.list.as_slice(),
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

    let reader = RefPtr::new(crate::webcore::byte_stream::Source {
        global_this: Cell::new(Some(bun_ptr::BackRef::new(cx.global()))),
        ..Default::default()
    });
    let reader = crate::webcore::byte_stream::Source::wrap(reader, cx);
    let readable_value = ReadableStream::from_native(cx.global(), reader.to_js())?;

    let wrapper = AliasableBox::new(S3DownloadStreamWrapper {
        stream: Default::default(),
        path: Box::<[u8]>::from(path),
        global: global_static,
        task: Cell::new(core::ptr::null_mut()),
    });
    // SAFETY: `reader` is the live source made above.
    unsafe { wrapper.stream.hold(reader.as_ptr().cast()) };

    reader
        .producer
        .set(crate::webcore::streams::SourceHandle::S3DownloadBody(
            // Cleared before `wrapper` is freed (`ProducerHold::take`).
            bun_ptr::BackRef::from(wrapper.as_non_null()),
        ));

    download_stream(this, cx.context(), offset, size, request_payer, wrapper);
    Ok(readable_value)
}
