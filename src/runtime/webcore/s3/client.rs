use core::cell::Cell;
use std::io::Write as _;

use bun_collections::{ByteVecExt, VecExt};
use bun_core::MutableString;
use bun_http::HeadersExt as _;
use bun_jsc::{GlobalRef, JSGlobalObject, JSValue, JsCell, JsResult};
use bun_ptr::{RefPtr, ThisPtr};

// Re-exports (thin aliases)
pub(crate) use crate::webcore::s3::download_stream::S3HttpDownloadStreamingTask;
pub use crate::webcore::s3::multipart::MultiPartUpload;
pub use crate::webcore::s3::multipart_options::MultiPartUploadOptions;
pub use bun_s3_signing::acl::ACL;
pub use bun_s3_signing::storage_class::StorageClass;

pub use bun_s3_signing::error as Error;
// `throw_sign_error` / `get_js_sign_error` live in `error_jsc.rs` (jsc-side
// of the s3_signing error tables). The pure error module is `bun_s3_signing::error`;
// the jsc helpers are mounted here as a child module of this umbrella
// re-export hub.
#[path = "error_jsc.rs"]
pub mod error_jsc;
pub(crate) use error_jsc::S3ErrorJsc;
pub(crate) use error_jsc::get_js_sign_error;
pub(crate) use error_jsc::s3_error_to_js;
pub(crate) use error_jsc::throw_sign_error;

pub use bun_s3_signing::credentials::S3Credentials;
pub use bun_s3_signing::credentials::S3CredentialsWithOptions;
use bun_s3_signing::credentials::encode_uri_component;

pub(crate) use crate::webcore::s3::download_stream::S3DownloadStreamWrapper;
pub(crate) use crate::webcore::s3::list_objects::S3ListObjectsOptions;
pub(crate) use crate::webcore::s3::list_objects::get_list_objects_options_from_js;
pub(crate) use crate::webcore::s3::simple_request::S3DeleteResult;
pub(crate) use crate::webcore::s3::simple_request::S3DownloadResult;
pub(crate) use crate::webcore::s3::simple_request::S3HttpSimpleTask;
pub(crate) use crate::webcore::s3::simple_request::S3ListObjectsResult;
pub(crate) use crate::webcore::s3::simple_request::S3StatResult;
pub use crate::webcore::s3::simple_request::S3UploadResult;

use crate::webcore::s3::simple_request as s3_simple_request;
use crate::webcore::s3::simple_request::RequestStorage;

use crate::webcore::ByteStream;
use crate::webcore::ReadableStream;
use crate::webcore::readable_stream::Source as ReadableStreamPtr;
use crate::webcore::readable_stream::Strong as ReadableStreamStrong;
use crate::webcore::s3::multipart::State as MultiPartUploadState;
use crate::webcore::s3::multipart::UploadObserver;
use crate::webcore::sink::JSSink;
use crate::webcore::streams::{NetworkSink, NetworkSinkJSSink};
use bun_collections::IntegerBitSet;
use bun_io::KeepAlive;
use bun_io::StreamBuffer;
use bun_jsc::CallFrame;

bun_core::declare_scope!(S3UploadStream, visible);

pub(crate) fn stat(
    this: &S3Credentials,
    path: &[u8],
    callback: s3_simple_request::StatCallback,
    proxy_url: Option<&[u8]>,
    request_payer: bool,
) -> JsResult<()> {
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
    )
}

pub(crate) fn download(
    this: &S3Credentials,
    path: &[u8],
    callback: s3_simple_request::DownloadCallback,
    proxy_url: Option<&[u8]>,
    request_payer: bool,
) -> JsResult<()> {
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
    )
}

/// The `Range:` header value for `size` bytes from `offset`, if not the whole object.
fn range_header(offset: usize, size: Option<usize>) -> Option<Vec<u8>> {
    if let Some(size_) = size {
        let mut end = offset + size_;
        if size_ > 0 {
            end -= 1;
        }
        let mut v = Vec::new();
        write!(&mut v, "bytes={}-{}", offset, end).expect("infallible: in-memory write");
        return Some(v);
    }
    if offset == 0 {
        return None;
    }
    let mut v = Vec::new();
    write!(&mut v, "bytes={}-", offset).expect("infallible: in-memory write");
    Some(v)
}

pub(crate) fn download_slice(
    this: &S3Credentials,
    path: &[u8],
    offset: usize,
    size: Option<usize>,
    callback: s3_simple_request::DownloadCallback,
    proxy_url: Option<&[u8]>,
    request_payer: bool,
) -> JsResult<()> {
    s3_simple_request::execute_simple_s3_request(
        this,
        s3_simple_request::Options {
            path,
            method: bun_http::Method::GET,
            proxy_url,
            body: b"",
            range: range_header(offset, size).map(Vec::into_boxed_slice),
            request_payer,
            ..Default::default()
        },
        s3_simple_request::Callback::Download(callback),
    )
}

pub(crate) fn delete(
    this: &S3Credentials,
    path: &[u8],
    callback: s3_simple_request::DeleteCallback,
    proxy_url: Option<&[u8]>,
    request_payer: bool,
) -> JsResult<()> {
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
    )
}

pub(crate) fn list_objects(
    this: &S3Credentials,
    // Only read here, synchronously, to build the search-params string.
    list_options: &S3ListObjectsOptions,
    callback: s3_simple_request::ListObjectsCallback,
    proxy_url: Option<&[u8]>,
) -> JsResult<()> {
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
            callback(S3ListObjectsResult::Failure(Error::S3Error {
                code: error_code_and_message.code,
                message: error_code_and_message.message,
            }))?;

            return Ok(());
        }
    };

    drop(search_params);

    let headers = bun_http::Headers::from_pico_http_headers(result.headers());

    S3HttpSimpleTask::start(
        bun_http::Method::GET,
        RequestStorage {
            sign_result: result,
            headers,
            body: Box::default(),
            proxy_url: RequestStorage::owned_proxy(proxy_url),
        },
        s3_simple_request::Callback::ListObjects(callback),
    );
    Ok(())
}

pub(crate) fn upload(
    this: &S3Credentials,
    path: &[u8],
    content: &[u8],
    content_type: Option<&[u8]>,
    content_disposition: Option<&[u8]>,
    content_encoding: Option<&[u8]>,
    acl: Option<ACL>,
    proxy_url: Option<&[u8]>,
    storage_class: Option<StorageClass>,
    request_payer: bool,
    callback: s3_simple_request::UploadCallback,
) -> JsResult<()> {
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
    )
}

/// A new upload, holding its own lifecycle ref (see [`MultiPartUpload`]).
/// Takes ownership of one `credentials` ref.
fn new_upload(
    credentials: bun_ptr::RefPtr<S3Credentials>,
    path: &[u8],
    global_this: &JSGlobalObject,
    options: MultiPartUploadOptions,
    acl: Option<ACL>,
    storage_class: Option<StorageClass>,
    content_type: Option<&[u8]>,
    content_disposition: Option<&[u8]>,
    content_encoding: Option<&[u8]>,
    proxy: Option<&[u8]>,
    request_payer: bool,
    state: MultiPartUploadState,
) -> RefPtr<MultiPartUpload> {
    let proxy_url = proxy.unwrap_or(b"");
    let upload = RefPtr::new_cyclic(|root| MultiPartUpload {
        root,
        lifecycle: Cell::new(None),
        observer: JsCell::new(None),
        queue: JsCell::new(None),
        available: Cell::new(IntegerBitSet::init_full()),
        current_part_number: Cell::new(1),
        ref_count: Cell::new(1),
        ended: Cell::new(false),
        options: Cell::new(options),
        acl,
        storage_class,
        request_payer,
        credentials,
        poll_ref: JsCell::new(KeepAlive::init()),
        // JSC_BORROW: `global_this` outlives the upload (it owns the VM/heap
        // that owns the JS objects which keep the upload alive).
        global_this: GlobalRef::from(global_this),
        buffered: JsCell::new(StreamBuffer::default()),
        uploaded_bytes: Cell::new(0),
        path: Box::<[u8]>::from(path),
        proxy: if !proxy_url.is_empty() {
            Box::<[u8]>::from(proxy_url)
        } else {
            Box::default()
        },
        content_type: content_type.map(Box::<[u8]>::from),
        content_disposition: content_disposition.map(Box::<[u8]>::from),
        content_encoding: content_encoding.map(Box::<[u8]>::from),
        upload_id: JsCell::new(Box::default()),
        multipart_etags: JsCell::new(Vec::new()),
        multipart_upload_list: JsCell::new(Vec::new()),
        state: Cell::new(state),
    });
    upload.lifecycle.set(Some(upload.clone()));
    upload
        .poll_ref
        .with_mut(|poll_ref| poll_ref.ref_(bun_io::js_vm_ctx()));
    upload
}

/// `s3file.writer()`'s upload settled: settle the sink's pending promises and
/// detach it.
pub(crate) fn writer_settled(
    sink: ThisPtr<NetworkSink>,
    upload: &MultiPartUpload,
    result: S3UploadResult,
) -> JsResult<()> {
    let global = sink
        .global_this
        .expect("NetworkSink.global_this set at construction");
    let global = global.get();
    if sink.end_promise.get().has_value() || sink.flush_promise.get().has_value() {
        let _exit_guard = global.bun_vm().enter_event_loop_scope();
        match result {
            S3UploadResult::Success => {
                if sink.flush_promise.get().has_value() {
                    sink.flush_promise
                        .with_mut(|p| p.resolve(global, JSValue::js_number(0.0)))?;
                }
                if sink.end_promise.get().has_value() {
                    let uploaded = JSValue::js_number(upload.uploaded_bytes.get() as f64);
                    sink.end_promise.with_mut(|p| p.resolve(global, uploaded))?;
                }
            }
            S3UploadResult::Failure(err) => {
                let js_err = s3_error_to_js(&err, global, Some(&upload.path));
                if sink.flush_promise.get().has_value() {
                    sink.flush_promise
                        .with_mut(|p| p.reject(global, Ok(js_err)))?;
                }
                if sink.end_promise.get().has_value() {
                    sink.end_promise
                        .with_mut(|p| p.reject(global, Ok(js_err)))?;
                }
                if !sink.done.get() {
                    sink.abort();
                }
            }
        }
    }
    sink.detach_writable();
    Ok(())
}

/// returns a writable stream that writes to the s3 path
///
/// `credentials` is moved into the `MultiPartUpload`.
pub(crate) fn writable_stream(
    credentials: bun_ptr::RefPtr<S3Credentials>,
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
    let part_size = options.part_size;
    let upload = new_upload(
        credentials,
        path,
        global_this,
        options,
        None,
        storage_class,
        content_type,
        content_disposition,
        content_encoding,
        proxy,
        request_payer,
        MultiPartUploadState::NotStarted,
    );
    let observer = upload.this_ptr();
    // The sink holds the upload's construction ref (released in `detach_writable`).
    let sink = NetworkSink::new(upload, global_this);
    observer
        .observer
        .set(Some(UploadObserver::Writer(sink.clone())));
    // `source` stays `SourceHandle::None`; no stream is attached on the
    // `writer()` path, so ready/close/start are no-ops.
    debug_assert!(sink.source.get().is_dead());
    Ok(NetworkSink::to_js(sink, global_this))
}

/// The JS side of `Bun.write(s3file, readableStream)` (and fetch PUT with a
/// stream body): pumps the stream into a [`NetworkSink`] and settles
/// `end_promise` with the upload's outcome. Reference-counted: the upload
/// (its observer) and the stream pump (`pump_ref`) each hold one.
#[derive(bun_ptr::CellRefCounted)]
pub struct S3UploadStreamWrapper {
    ref_count: Cell<u32>,
    /// The ref the stream pump holds: released by the `assign_to_stream`
    /// reaction (`handle_{resolve,reject}_stream`), or on the native ByteStream
    /// path by `NetworkSink::end_from_stream` / `resolve`.
    pump_ref: Cell<Option<RefPtr<S3UploadStreamWrapper>>>,
    /// Our ref on the sink, from `upload_stream` until `detach_sink`. The JS
    /// controller created by `assign_to_stream` only borrows it (it detaches in
    /// `controller.end()/close()`, or `controller_finalize` at heap teardown).
    sink: JsCell<Option<RefPtr<NetworkSink>>>,
    /// Released on drop.
    task: RefPtr<MultiPartUpload>,
    pub(crate) end_promise: JsCell<bun_jsc::JSPromiseStrong>,
    /// Told the upload's outcome once it settles.
    on_done: Cell<Option<Box<dyn FnOnce(S3UploadResult<'_>)>>>,
    /// Pins the source ReadableStream when the native ByteStream fast-path is
    /// taken (no JS reader to lock it). Empty on the `assign_to_stream` path.
    readable_stream_ref: JsCell<ReadableStreamStrong>,
    global: GlobalRef, // JSC_BORROW
}

impl S3UploadStreamWrapper {
    /// Release the stream pump's ref (see `pump_ref`).
    pub(crate) fn release_pump_ref(this: ThisPtr<Self>) {
        if let Some(pump_ref) = this.pump_ref.take() {
            drop(pump_ref);
        }
    }

    fn sink(&self) -> Option<ThisPtr<NetworkSink>> {
        self.sink.get().as_ref().map(RefPtr::this_ptr)
    }

    fn detach_sink(&self) {
        bun_output::scoped_log!(S3UploadStream, "detachSink {}", self.sink.get().is_some());
        if let Some(sink) = self.sink.replace(None) {
            let mut source = sink
                .source
                .replace(crate::webcore::streams::SourceHandle::None);
            JSSink::<NetworkSink>::detach(&mut source, &self.global);
            // releases NetworkSink's counted ref on the MultiPartUpload
            sink.detach_writable();
            drop(sink);
        }
    }

    pub(crate) fn on_writable(&self, task: &MultiPartUpload, flushed: u64) {
        bun_output::scoped_log!(
            S3UploadStream,
            "onWritable {} {}",
            self.sink.get().is_some(),
            task.ended.get()
        );
        // end was called we dont need to drain anymore
        if task.ended.get() {
            return;
        }
        if let Some(sink) = self.sink() {
            // Fires `source.ready()` so the upstream pump resumes.
            sink.on_writable(flushed);
        }
    }

    /// Stream pump resolved (sink.end() already wrote EOF to the task).
    /// Balances the pump ref taken in `upload_stream`.
    pub(crate) fn handle_resolve_stream(this: ThisPtr<Self>) {
        bun_output::scoped_log!(S3UploadStream, "handleResolveStream");
        this.detach_sink();
        Self::release_pump_ref(this);
    }

    /// Stream pump rejected. Rejects the caller's end_promise, fails the upload,
    /// and balances the pump ref taken in `upload_stream`.
    pub(crate) fn handle_reject_stream(this: ThisPtr<Self>, err: JSValue) {
        bun_output::scoped_log!(S3UploadStream, "handleRejectStream");
        this.detach_sink();
        if this.end_promise.get().has_value() && !err.is_empty_or_undefined_or_null() {
            // if we have a explicit error, reject the promise
            // if not when calling .fail will create a S3Error instance
            // this match the previous behavior
            let mut end_promise = this.end_promise.replace(bun_jsc::JSPromiseStrong::empty());
            let _ = end_promise.reject(&this.global, Ok(err));
        }
        // idempotent (`state != Finished`); `task.ended` was set by the pump's close path
        let _ = this.task.fail(Error::S3Error {
            code: b"UnknownError",
            message: b"ReadableStream ended with an error",
        });
        Self::release_pump_ref(this);
    }

    /// The upload settled; `this` is kept alive by the upload's observer ref,
    /// which the caller releases right after.
    pub(crate) fn resolve(this: ThisPtr<Self>, result: S3UploadResult) -> JsResult<()> {
        bun_output::scoped_log!(S3UploadStream, "resolve");
        let global = this.global;
        // The native teardown (source close, pump-ref release, completion callback)
        // runs on every path; the promise slots are settled until one settle leaves an
        // exception pending, which is what this returns (nothing settles over it).
        let mut settled: JsResult<()> = Ok(());
        match &result {
            S3UploadResult::Success => {
                let uploaded = JSValue::js_number(this.task.uploaded_bytes.get() as f64);
                if let Some(sink) = this.sink() {
                    sink.run_pending();
                    if settled.is_ok() && sink.flush_promise.get().has_value() {
                        settled = sink
                            .flush_promise
                            .with_mut(|p| p.resolve(&global, JSValue::js_number(0.0)));
                    }
                    if settled.is_ok() && sink.end_promise.get().has_value() {
                        settled = sink.end_promise.with_mut(|p| p.resolve(&global, uploaded));
                    }
                }
                if this.end_promise.get().has_value() {
                    let mut end_promise =
                        this.end_promise.replace(bun_jsc::JSPromiseStrong::empty());
                    if settled.is_ok() {
                        settled = end_promise.resolve(&global, uploaded);
                    }
                }
            }
            S3UploadResult::Failure(err) => {
                // If the native ByteStream source errored, prefer the original
                // JS error it stashed on the sink (preserves `.code` /
                // `.name`) over the generic `UnknownError` passed to `fail()`.
                let stashed = this
                    .sink()
                    .and_then(|s| s.upstream_error.with_mut(|e| e.try_swap()));
                let js_err =
                    stashed.unwrap_or_else(|| s3_error_to_js(err, &global, Some(&this.task.path)));
                js_err.ensure_still_alive();
                let mut is_native = false;
                if let Some(sink) = this.sink() {
                    // Sink pump still in-flight: fire source.close() so the JSSink
                    // controller's onClose cancels the upstream ReadableStream. The
                    // pump promise settles after, triggering the `.then` shim which
                    // calls `detach_sink` and releases the pump ref.
                    //
                    // Captured before `source.close()`: on the native fast-path
                    // there is no pump promise, so the pump +1 must be released
                    // inline below (mirrors `FetchTasklet::cancel_request_body_sink`).
                    // `end_from_stream` cleared `source` when it drove this call,
                    // so this is only true when the S3 side failed first.
                    is_native = matches!(
                        sink.source.get(),
                        crate::webcore::streams::SourceHandle::ByteStream(_)
                            | crate::webcore::streams::SourceHandle::FileReader(_)
                    );
                    sink.ended.set(true);
                    sink.done.set(true);
                    sink.pending
                        .with_mut(|p| p.result = crate::webcore::streams::Writable::Done);
                    sink.run_pending();
                    if settled.is_ok() && sink.flush_promise.get().has_value() {
                        settled = sink
                            .flush_promise
                            .with_mut(|p| p.reject(&global, Ok(js_err)));
                    }
                    if settled.is_ok() && sink.end_promise.get().has_value() {
                        settled = sink.end_promise.with_mut(|p| p.reject(&global, Ok(js_err)));
                    }
                    sink.close_source(None);
                }
                if is_native {
                    this.detach_sink();
                    Self::release_pump_ref(this);
                }
                if this.end_promise.get().has_value() {
                    let mut end_promise =
                        this.end_promise.replace(bun_jsc::JSPromiseStrong::empty());
                    if settled.is_ok() {
                        settled = end_promise.reject(&global, Ok(js_err));
                    }
                }
            }
        }

        if let Some(on_done) = this.on_done.take() {
            on_done(result);
        }
        settled
    }
}

// C++ `promiseHandlerID` compares the handler passed to `JSValue::then` against
// these symbols by address, so they must stay function exports.
// HOST_EXPORT(Bun__S3UploadStream__onResolveStream, jsc)
pub fn s3_upload_stream_on_resolve(
    this: ThisPtr<crate::webcore::s3::client::S3UploadStreamWrapper>,
    _global_this: &JSGlobalObject,
    _callframe: &CallFrame,
) -> JsResult<JSValue> {
    S3UploadStreamWrapper::handle_resolve_stream(this);
    Ok(JSValue::UNDEFINED)
}

// HOST_EXPORT(Bun__S3UploadStream__onRejectStream, jsc)
pub fn s3_upload_stream_on_reject(
    this: ThisPtr<crate::webcore::s3::client::S3UploadStreamWrapper>,
    _global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let args = callframe.arguments();
    let err = args[0];
    S3UploadStreamWrapper::handle_reject_stream(this, err);
    Ok(JSValue::UNDEFINED)
}

impl Drop for S3UploadStreamWrapper {
    fn drop(&mut self) {
        bun_output::scoped_log!(S3UploadStream, "deinit {}", self.sink.get().is_some());
        self.detach_sink();
        // `task` is released as the field drops.
    }
}

/// consumes the readable stream and upload to s3
///
/// `credentials` is moved into the `MultiPartUpload`.
pub(crate) fn upload_stream(
    credentials: bun_ptr::RefPtr<S3Credentials>,
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
    on_done: Option<Box<dyn FnOnce(S3UploadResult<'_>)>>,
) -> JsResult<JSValue> {
    if readable_stream.is_disturbed(global_this) {
        return Ok(bun_jsc::JSPromise::rejected_promise(
            global_this,
            global_this.create_error_instance(format_args!("ReadableStream is already disturbed")),
        )
        .to_js());
    }

    match readable_stream.ptr {
        ReadableStreamPtr::Invalid => {
            return Ok(bun_jsc::JSPromise::rejected_promise(
                global_this,
                global_this.create_error_instance(format_args!("ReadableStream is invalid")),
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
                let js_err = err.to_js(global_this);
                js_err.ensure_still_alive();
                return Ok(bun_jsc::JSPromise::rejected_promise(global_this, js_err).to_js());
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
                let js_err = err.to_js(global_this);
                js_err.ensure_still_alive();
                return Ok(bun_jsc::JSPromise::rejected_promise(global_this, js_err).to_js());
            }
        }
        _ => {}
    }

    let part_size = options.part_size;
    let upload = new_upload(
        credentials,
        path,
        global_this,
        options,
        acl,
        storage_class,
        content_type,
        content_disposition,
        content_encoding,
        proxy,
        request_payer,
        MultiPartUploadState::WaitStreamCheck,
    );
    let task = upload.this_ptr();

    // The sink's ref on the upload (released in `detach_writable`); `upload`
    // itself becomes the wrapper's (`S3UploadStreamWrapper::task`).
    let sink = NetworkSink::new(upload.clone(), global_this);
    let sink_ptr = sink.this_ptr();
    let sink_handle = crate::webcore::SinkHandle::S3Upload(sink_ptr.into());

    let wrapper = RefPtr::new(S3UploadStreamWrapper {
        ref_count: Cell::new(1),
        pump_ref: Cell::new(None),
        sink: JsCell::new(Some(sink)),
        on_done: Cell::new(on_done),
        task: upload,
        end_promise: JsCell::new(bun_jsc::JSPromiseStrong::init(global_this)),
        readable_stream_ref: JsCell::new(ReadableStreamStrong::default()),
        global: GlobalRef::from(global_this),
    });
    let ctx = wrapper.this_ptr();
    // +1 for the stream pump (released by the `.then` reaction / handle_*_stream);
    // `wrapper` itself is the upload's, released once it settles.
    ctx.pump_ref.set(Some(wrapper.clone()));
    task.observer.set(Some(UploadObserver::Stream(wrapper)));

    // Captured before `assign_to_stream`: a synchronously-draining stream may
    // resolve + clear `ctx.end_promise` before control returns here.
    let end_promise_value = ctx.end_promise.get().value();
    end_promise_value.ensure_still_alive();

    // Transition WaitStreamCheck → NotStarted before the pump can deliver the
    // first chunk: `readStreamIntoSink`'s `readMany()` drains a pre-enqueued
    // default-controller stream synchronously inside `assign_to_stream`.
    task.continue_stream();

    // Native ByteStream fast-path: wire the source/sink handles directly so
    // bytes flow via `ByteStream::on_data` → `SinkHandle::write` without the JS
    // `readStreamIntoSink` pump.
    if let Some(byte_stream) = readable_stream.ptr.bytes() {
        if byte_stream.sink.get().is_none() {
            // A write below can fail the upload synchronously, which settles
            // the wrapper and releases the sink; keep both for this block.
            let _ctx_alive = RefPtr::from_this(ctx);
            let _sink_alive = RefPtr::from_this(sink_ptr);
            sink_ptr
                .source
                .set(crate::webcore::streams::SourceHandle::ByteStream(
                    byte_stream,
                ));
            byte_stream.sink.set(sink_handle);
            byte_stream.sink_paused.set(false);
            ctx.readable_stream_ref
                .set(ReadableStreamStrong::init(readable_stream, global_this));
            readable_stream.lock_native(global_this);
            byte_stream.signal_consumer_attached();

            if let Some(err) = byte_stream.take_pending_error() {
                let err_js = err.to_js(global_this);
                err_js.ensure_still_alive();
                S3UploadStreamWrapper::handle_reject_stream(ctx, err_js);
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
                match sink_ptr.write(&chunk) {
                    crate::webcore::streams::Writable::Backpressure(_) => {
                        byte_stream.sink_paused.set(true);
                    }
                    crate::webcore::streams::Writable::Done
                    | crate::webcore::streams::Writable::Err(_) => {
                        byte_stream.sink.set(crate::webcore::SinkHandle::None);
                        sink_ptr
                            .source
                            .set(crate::webcore::streams::SourceHandle::None);
                        if !sink_ptr.ended.get() {
                            let _ = sink_ptr.end(None);
                        }
                        S3UploadStreamWrapper::handle_resolve_stream(ctx);
                        return Ok(end_promise_value);
                    }
                    _ => {}
                }
            }
            if had_last {
                byte_stream.sink.set(crate::webcore::SinkHandle::None);
                sink_ptr
                    .source
                    .set(crate::webcore::streams::SourceHandle::None);
                if !sink_ptr.ended.get() {
                    let _ = sink_ptr.end(None);
                }
                S3UploadStreamWrapper::handle_resolve_stream(ctx);
            } else if !byte_stream.sink_paused.get() {
                // Wake the producer after the older bytes are in the sink.
                byte_stream.signal_drained();
            }
            // `!had_last`: the pump ref is released by
            // `NetworkSink::end_from_stream` after the terminal write/fail so the
            // sink outlives the synchronous `resolve()` re-entry.
            return Ok(end_promise_value);
        }
        // sink already attached: fall through to the JS pump.
    }

    // The controller cell is installed into `sink.source` by `assign_to_stream`.
    let assignment_result: JSValue =
        NetworkSinkJSSink::assign_to_stream(global_this, readable_stream.value, sink_ptr.into());
    assignment_result.ensure_still_alive();

    if let Some(err_value) = assignment_result.to_error() {
        S3UploadStreamWrapper::handle_reject_stream(ctx, err_value);
        return Ok(end_promise_value);
    }

    if !assignment_result.is_empty_or_undefined_or_null() {
        if let Some(promise) = assignment_result.as_any_promise() {
            match promise.status() {
                bun_jsc::js_promise::Status::Pending => {
                    // The pump ref rides on the reaction pair: exactly one of
                    // them runs, once.
                    assignment_result.then(
                        global_this,
                        ctx.as_ptr(),
                        crate::generated_host_exports::Bun__S3UploadStream__onResolveStream,
                        crate::generated_host_exports::Bun__S3UploadStream__onRejectStream,
                    );
                }
                bun_jsc::js_promise::Status::Fulfilled => {
                    S3UploadStreamWrapper::handle_resolve_stream(ctx);
                }
                bun_jsc::js_promise::Status::Rejected => {
                    promise.set_handled(global_this.vm());
                    let result = promise.result(global_this.vm());
                    S3UploadStreamWrapper::handle_reject_stream(ctx, result);
                }
            }
            return Ok(end_promise_value);
        }
    }

    // The stream drained synchronously inside `assign_to_stream` (no promise
    // returned). `handle_resolve_stream` destroys the sink, so re-read it from
    // `ctx` rather than use the handle taken before assign_to_stream.
    if let Some(sink) = ctx.sink() {
        if !sink.ended.get() {
            let _ = sink.end(None);
        }
    }
    S3UploadStreamWrapper::handle_resolve_stream(ctx);
    Ok(end_promise_value)
}

/// download a file from s3 chunk by chunk aka streaming (used on readableStream)
fn download_stream(
    this: &S3Credentials,
    path: &[u8],
    offset: usize,
    size: Option<usize>,
    proxy_url: Option<&[u8]>,
    request_payer: bool,
    sink: bun_ptr::OwnedThis<S3DownloadStreamWrapper>,
) {
    let range = range_header(offset, size);

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
            sink.on_chunk(
                &MutableString::default(),
                false,
                Some(Error::S3Error {
                    code: error_code_and_message.code,
                    message: error_code_and_message.message,
                }),
            );
            return;
        }
    };

    let mut header_buffer =
        [bun_picohttp::Header::ZERO; bun_s3_signing::credentials::SignResult::MAX_HEADERS + 1];
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
    S3HttpDownloadStreamingTask::start(
        RequestStorage {
            sign_result: result,
            headers,
            body: Box::default(),
            proxy_url: RequestStorage::owned_proxy(proxy_url),
        },
        sink,
    );
}

/// returns a readable stream that reads from the s3 path
pub(crate) fn readable_stream(
    this: &S3Credentials,
    path: &[u8],
    offset: usize,
    size: Option<usize>,
    proxy_url: Option<&[u8]>,
    request_payer: bool,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    // Ownership of the heap-allocated NewSource transfers to the JS wrapper (m_ctx) via
    // `to_readable_stream()`; the wrapper's finalize() reclaims it.
    let reader =
        crate::webcore::byte_stream::Source::new_mut(crate::webcore::readable_stream::NewSource {
            context: ByteStream::default(),
            global_this: Some(bun_ptr::BackRef::new(global_this)),
            ..Default::default()
        });

    reader.context.setup();
    let readable_value = reader.to_readable_stream(global_this)?;

    let sink = S3DownloadStreamWrapper::new(reader, path, GlobalRef::from(global_this));
    // The task drops the wrapper once the download is over, and the wrapper
    // lets go of the source (clearing this handle) first (holder obligation).
    reader
        .producer
        .set(crate::webcore::streams::SourceHandle::S3DownloadBody(
            bun_ptr::BackRef::new(&*sink),
        ));

    download_stream(this, path, offset, size, proxy_url, request_payer, sink);
    Ok(readable_value)
}
