use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::NonNull;
use std::io::Write as _;

use bun_collections::{ByteVecExt, VecExt};
use bun_core::MutableString;
use bun_http::HeadersExt as _;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{GlobalRef, JSGlobalObject, JSValue, JsCell, JsResult};
use bun_ptr::RefPtr;

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

pub(crate) use crate::webcore::s3::list_objects::S3ListObjectsOptions;
pub(crate) use crate::webcore::s3::list_objects::get_list_objects_options_from_js;
pub(crate) use crate::webcore::s3::simple_request::S3DeleteResult;
pub(crate) use crate::webcore::s3::simple_request::S3DownloadResult;
pub(crate) use crate::webcore::s3::simple_request::S3HttpSimpleTask;
pub(crate) use crate::webcore::s3::simple_request::S3ListObjectsResult;
pub(crate) use crate::webcore::s3::simple_request::S3StatResult;
pub use crate::webcore::s3::simple_request::S3UploadResult;

use crate::webcore::s3::simple_request as s3_simple_request;

use crate::webcore::ByteStream;
use crate::webcore::ReadableStream;
use crate::webcore::readable_stream::Source as ReadableStreamPtr;
use crate::webcore::readable_stream::Strong as ReadableStreamStrong;
use crate::webcore::s3::multipart::State as MultiPartUploadState;
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
    callback: fn(S3StatResult, *mut c_void) -> JsResult<()>,
    callback_context: *mut c_void,
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
        callback_context,
    )
}

pub(crate) fn download(
    this: &S3Credentials,
    path: &[u8],
    callback: fn(S3DownloadResult, *mut c_void) -> JsResult<()>,
    callback_context: *mut c_void,
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
        callback_context,
    )
}

pub(crate) fn download_slice(
    this: &S3Credentials,
    path: &[u8],
    offset: usize,
    size: Option<usize>,
    callback: fn(S3DownloadResult, *mut c_void) -> JsResult<()>,
    callback_context: *mut c_void,
    proxy_url: Option<&[u8]>,
    request_payer: bool,
) -> JsResult<()> {
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

pub(crate) fn delete(
    this: &S3Credentials,
    path: &[u8],
    callback: fn(S3DeleteResult, *mut c_void) -> JsResult<()>,
    callback_context: *mut c_void,
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
        callback_context,
    )
}

pub(crate) fn list_objects(
    this: &S3Credentials,
    list_options: &S3ListObjectsOptions,
    callback: fn(S3ListObjectsResult, *mut c_void) -> JsResult<()>,
    callback_context: *mut c_void,
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

    let task_ptr = bun_core::heap::into_raw(Box::new(S3HttpSimpleTask {
        // Written below via `MaybeUninit::write` before any read.
        http: core::mem::MaybeUninit::uninit(),
        sign_result: result,
        callback_context,
        callback: s3_simple_request::Callback::ListObjects(callback),
        headers,
        http_ticket: None,
        response_buffer: MutableString::default(),
        result: bun_http::HTTPClientResult::default(),
        concurrent_task: Default::default(),
        proxy_url: Box::default(),
        body: Box::default(),
        poll_ref: bun_io::KeepAlive::init(),
        signal_store: Default::default(),
    }));
    // SAFETY: just allocated, non-null
    let task = unsafe { &mut *task_ptr };

    task.poll_ref.ref_(bun_io::js_vm_ctx());

    let proxy = proxy_url.unwrap_or(b"");
    task.proxy_url = if !proxy.is_empty() {
        Box::<[u8]>::from(proxy)
    } else {
        Box::<[u8]>::default()
    };

    // SAFETY: lifetime extension — `url`, `headers_buf`, and `proxy_url` borrow from
    // heap-allocated fields of `*task` which the task outlives. AsyncHTTP::init wants
    // `'static` borrows because the HTTP thread reads them concurrently; they remain valid
    // until `task` is dropped in `on_response`.
    let url = bun_url::URL::parse(unsafe { bun_ptr::detach_lifetime_ref(&*task.sign_result.url) });
    // SAFETY: same lifetime-extension invariant as `url` above — `task.headers.buf` is
    // heap-owned by `*task` and outlives the AsyncHTTP request.
    let headers_buf: &'static [u8] =
        unsafe { bun_ptr::detach_lifetime(task.headers.buf.as_slice()) };
    let http_proxy = if !task.proxy_url.is_empty() {
        // SAFETY: same lifetime-extension invariant as `url` above — `task.proxy_url` is
        // heap-owned by `*task` and outlives the AsyncHTTP request.
        Some(bun_url::URL::parse(unsafe {
            bun_ptr::detach_lifetime_ref(&*task.proxy_url)
        }))
    } else {
        None
    };
    // JS thread (request setup): read options from the current VM.
    let vm = VirtualMachine::get();

    task.http.write(bun_http::AsyncHTTP::init(
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
            signals: Some(task.signal_store.to()),
            ..Default::default()
        },
    ));

    // queue http request
    bun_http::http_thread::init(&Default::default());
    let mut batch = bun_threading::thread_pool::Batch::default();
    // SAFETY: `http` was initialised by `task.http.write(...)` immediately above.
    unsafe { task.http.assume_init_mut() }.schedule(&mut batch);
    // Out on the HTTP thread until its final callback: the VM aborts it at
    // teardown (registry) and waits for it (the ticket).
    task.http_ticket = Some(VirtualMachine::get().ticket());
    crate::jsc_hooks::ActiveHandle::S3Request(core::ptr::NonNull::new(task_ptr).expect("task"))
        .register();
    bun_http::HTTPThread::schedule(batch);
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
    callback: fn(S3UploadResult, *mut c_void) -> JsResult<()>,
    callback_context: *mut c_void,
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
        callback_context,
    )
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
    // Local callback wrapper. `uploaded` is read off the upload (see `MultiPartUpload::callback`).
    fn wrapper_callback(
        result: S3UploadResult,
        uploaded: u64,
        sink: &mut NetworkSink,
    ) -> JsResult<()> {
        // `global_this` is a `BackRef` set at construction; copy it so the
        // re-borrow does not hold `&sink` across the `&mut sink` calls below.
        let global = sink
            .global_this
            .expect("NetworkSink.global_this set at construction");
        let global = global.get();
        if sink.end_promise.has_value() || sink.flush_promise.has_value() {
            // SAFETY: `bun_vm()` returns the live per-thread VM pointer.
            let event_loop = global.bun_vm().as_mut().event_loop();
            // SAFETY: event_loop is initialised for the lifetime of the VM.
            // RAII: `enter()` now, `exit()` on drop.
            let _exit_guard = unsafe { bun_jsc::event_loop::EventLoop::enter_scope(event_loop) };
            match result {
                S3UploadResult::Success => {
                    if sink.flush_promise.has_value() {
                        sink.flush_promise
                            .resolve(global, JSValue::js_number(0.0))?;
                    }
                    if sink.end_promise.has_value() {
                        sink.end_promise
                            .resolve(global, JSValue::js_number(uploaded as f64))?;
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

    // Thunks adapting typed callbacks to the erased `*mut c_void` signatures stored on
    // MultiPartUpload.
    fn wrapper_callback_thunk(
        task: &MultiPartUpload,
        result: S3UploadResult,
        ctx: *mut c_void,
    ) -> JsResult<()> {
        let sink = ctx.cast::<NetworkSink>();
        // SAFETY: ctx was set to `response_stream: *mut NetworkSink` below; the box is live
        // while the upload holds it.
        let r = wrapper_callback(result, task.uploaded_bytes.get(), unsafe { &mut *sink });
        // SAFETY: the upload's hold on the box ends here; `sink` is not used afterwards.
        unsafe { NetworkSink::release_writer_holder(sink) };
        r
    }
    fn on_writable_thunk(task: &MultiPartUpload, ctx: *mut c_void, flushed: u64) {
        NetworkSink::on_writable(task, ctx.cast::<NetworkSink>(), flushed);
    }

    let proxy_url = proxy.unwrap_or(b"");
    // `credentials` ref adopted by value — moved into the MultiPartUpload below.
    // JSC_BORROW: `global_this` outlives the task (it owns the VM/heap that owns the JS
    // objects which keep the task alive); stored via `GlobalRef` in the heap-allocated
    // MultiPartUpload.
    let global_static = GlobalRef::from(global_this);
    let task_ptr: *mut MultiPartUpload = bun_core::heap::into_raw(Box::new(MultiPartUpload {
        root: Cell::new(None),
        queue: JsCell::new(None),
        available: Cell::new(IntegerBitSet::init_full()),
        current_part_number: Cell::new(1),
        ref_count: Cell::new(2), // +1 for the stream
        ended: Cell::new(false),
        options: Cell::new(options),
        acl: None,
        storage_class,
        request_payer,
        credentials,
        poll_ref: JsCell::new(KeepAlive::init()),
        // SAFETY (JSC_BORROW): VirtualMachine::get() returns the live per-thread VM; it
        // outlives every MultiPartUpload (the VM owns the heap that owns the JS objects
        // keeping this task alive). Dereference to `&'static` for storage.
        vm: VirtualMachine::get(),
        global_this: global_static,
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
        state: Cell::new(MultiPartUploadState::NotStarted),
        callback: wrapper_callback_thunk,
        on_writable: Some(on_writable_thunk),
        callback_context: Cell::new(core::ptr::null_mut()), // assigned below
    }));
    // SAFETY: `task_ptr` is the fresh, non-null allocation root.
    unsafe { (*task_ptr).root.set(core::ptr::NonNull::new(task_ptr)) };
    // SAFETY: freshly heap-allocated and refcounted; only shared access from here on.
    let task = unsafe { &*task_ptr };

    task.poll_ref
        .with_mut(|poll_ref| poll_ref.ref_(bun_io::js_vm_ctx()));

    // Heap-allocate; `JSSink<NetworkSink>` is layout-
    // compatible (`{ sink: NetworkSink }`) so the cast in `to_sink()` is just a pointer reinterpret.
    let response_stream: *mut NetworkSink =
        bun_core::heap::into_raw(NetworkSink::new(NetworkSink {
            // SAFETY: adopts one of `task_ptr`'s two initial refs (released in `detach_writable`).
            task: Some(unsafe { RefPtr::from_raw(task_ptr) }),
            global_this: Some(bun_ptr::BackRef::new(global_this)),
            writer_holders: Cell::new(2),
            ..Default::default()
        }));

    task.callback_context.set(response_stream.cast::<c_void>());

    // SAFETY: freshly heap-allocated; exclusive access here. Ownership transfers to the JS
    // wrapper via `to_js()` (the C++ side stores it as m_ctx and calls `finalize` on collect).
    let sink = unsafe { &*response_stream };
    // `source` defaults to `SourceHandle::None`; no stream is attached on the
    // `writer()` path, so ready/close/start are no-ops.
    debug_assert!(sink.source.is_dead());
    Ok(NetworkSink::to_js(
        core::ptr::NonNull::new(response_stream).expect("heap allocation"),
        global_this,
    ))
}

#[derive(bun_ptr::CellRefCounted)]
pub struct S3UploadStreamWrapper {
    pub(crate) ref_count: core::cell::Cell<u32>,

    pub sink: Option<NonNull<NetworkSink>>,
    pub task: RefPtr<MultiPartUpload>,
    pub(crate) end_promise: bun_jsc::JSPromiseStrong,
    pub callback: Option<fn(S3UploadResult, *mut c_void)>,
    pub(crate) callback_context: *mut c_void,
    /// this is owned by the task not by the wrapper
    pub path: bun_ptr::RawSlice<u8>,
    /// Roots the source ReadableStream, and the JS pump reachable only through it, until this wrapper drops.
    pub readable_stream_ref: ReadableStreamStrong,
    pub global: GlobalRef, // JSC_BORROW
}

impl S3UploadStreamWrapper {
    fn detach_sink(&mut self) {
        bun_output::scoped_log!(S3UploadStream, "detachSink {}", self.sink.is_some());
        if let Some(sink_ptr) = self.sink.take() {
            // SAFETY: allocated via `Box::leak` in `upload_stream`; consumed once here.
            let mut sink = unsafe { bun_core::heap::take(sink_ptr.as_ptr()) };
            JSSink::<NetworkSink>::detach(&mut sink.source, &self.global);
            // releases NetworkSink's counted ref on the MultiPartUpload
            sink.finalize();
        }
    }

    /// Exclusive borrow of the sink while `self.sink` is `Some` (owned
    /// allocation from `upload_stream` until `detach_sink`). Single-threaded.
    #[inline]
    fn sink_mut(&mut self) -> Option<&mut NetworkSink> {
        // SAFETY: sink is a live Box allocation owned by this wrapper.
        self.sink.map(|p| unsafe { &mut *p.as_ptr() })
    }

    pub(crate) fn on_writable(task: &MultiPartUpload, self_: &mut Self, flushed: u64) {
        bun_output::scoped_log!(
            S3UploadStream,
            "onWritable {} {}",
            self_.sink.is_some(),
            task.ended.get()
        );
        // end was called we dont need to drain anymore
        if task.ended.get() {
            return;
        }
        if let Some(sink) = self_.sink_mut() {
            // Fires `source.ready()` so the upstream pump resumes.
            NetworkSink::on_writable(task, sink, flushed);
        }
    }

    /// Stream pump resolved (sink.end() already wrote EOF to the task).
    /// Balances the +1 ref taken for the pump promise in `upload_stream`.
    pub(crate) fn handle_resolve_stream(&mut self) {
        bun_output::scoped_log!(S3UploadStream, "handleResolveStream");
        self.detach_sink();
        // SAFETY: `self` is a live Box allocation; this adopts the pump ref.
        drop(unsafe { RefPtr::from_raw(std::ptr::from_mut::<Self>(self)) });
    }

    /// Stream pump rejected. Rejects the caller's end_promise, fails the upload,
    /// and balances the +1 ref taken for the pump promise in `upload_stream`.
    pub(crate) fn handle_reject_stream(&mut self, err: JSValue) {
        bun_output::scoped_log!(S3UploadStream, "handleRejectStream");
        self.detach_sink();
        // SAFETY: adopts the pump ref; released at scope exit, after the borrows below.
        let _pump_ref = unsafe { RefPtr::from_raw(std::ptr::from_mut::<Self>(self)) };
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

    fn resolve(result: S3UploadResult, self_: &mut Self) -> JsResult<()> {
        bun_output::scoped_log!(S3UploadStream, "resolve");
        // SAFETY: adopts the upload's ref; released at scope exit, after the borrows below.
        let _upload_ref = unsafe { RefPtr::from_raw(std::ptr::from_mut::<Self>(self_)) };
        let global = self_.global;
        // The native teardown (source close, pump-ref release, completion callback)
        // runs on every path; the promise slots are settled until one settle leaves an
        // exception pending, which is what this returns (nothing settles over it).
        let mut settled: JsResult<()> = Ok(());
        match &result {
            S3UploadResult::Success => {
                let uploaded = JSValue::js_number(self_.task.uploaded_bytes.get() as f64);
                if let Some(sink) = self_.sink_mut() {
                    sink.pending.run();
                    if settled.is_ok() && sink.flush_promise.has_value() {
                        settled = sink.flush_promise.resolve(&global, JSValue::js_number(0.0));
                    }
                    if settled.is_ok() && sink.end_promise.has_value() {
                        settled = sink.end_promise.resolve(&global, uploaded);
                    }
                }
                if self_.end_promise.has_value() {
                    if settled.is_ok() {
                        settled = self_.end_promise.resolve(&global, uploaded);
                    }
                    self_.end_promise = bun_jsc::JSPromiseStrong::empty();
                }
            }
            S3UploadResult::Failure(err) => {
                // If the native ByteStream source errored, prefer the original
                // JS error it stashed on the sink (preserves `.code` /
                // `.name`) over the generic `UnknownError` passed to `fail()`.
                let stashed = self_.sink_mut().and_then(|s| s.upstream_error.try_swap());
                let js_err = stashed
                    .unwrap_or_else(|| s3_error_to_js(err, &global, Some(self_.path.slice())));
                js_err.ensure_still_alive();
                let mut is_native = false;
                if let Some(sink) = self_.sink_mut() {
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
                        sink.source,
                        crate::webcore::streams::SourceHandle::ByteStream(_)
                            | crate::webcore::streams::SourceHandle::FileReader(_)
                    );
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
                if is_native {
                    self_.detach_sink();
                    // SAFETY: `self_` is the live Box allocation; this balances the
                    // pump +1 from `upload_stream` (rc 2→1). The scopeguard above
                    // releases the remaining ref at scope exit.
                    unsafe { Self::deref(std::ptr::from_mut::<Self>(self_)) };
                }
                if self_.end_promise.has_value() {
                    if settled.is_ok() {
                        settled = self_.end_promise.reject(&global, Ok(js_err));
                    }
                    self_.end_promise = bun_jsc::JSPromiseStrong::empty();
                }
            }
        }

        if let Some(callback) = self_.callback {
            callback(result, self_.callback_context);
        }
        settled
    }
}

fn s3_upload_stream_on_resolve(
    _global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let args = callframe.arguments();
    let this: *mut S3UploadStreamWrapper =
        args[args.len() - 1].as_promise_ptr::<S3UploadStreamWrapper>();
    // SAFETY: `as_promise_ptr` recovers the ctx stashed by `upload_stream`; kept
    // alive by the ref taken there, which `handle_resolve_stream` balances.
    unsafe { (*this).handle_resolve_stream() };
    Ok(JSValue::UNDEFINED)
}

fn s3_upload_stream_on_reject(
    _global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let args = callframe.arguments();
    let this: *mut S3UploadStreamWrapper =
        args[args.len() - 1].as_promise_ptr::<S3UploadStreamWrapper>();
    let err = args[0];
    // SAFETY: `as_promise_ptr` recovers the ctx stashed by `upload_stream`; kept
    // alive by the ref taken there, which `handle_reject_stream` balances.
    unsafe { (*this).handle_reject_stream(err) };
    Ok(JSValue::UNDEFINED)
}

bun_jsc::jsc_host_abi! {
    #[unsafe(export_name = "Bun__S3UploadStream__onResolveStream")]
    unsafe fn s3_upload_stream_on_resolve_shim(
        g: *mut JSGlobalObject,
        cf: *mut CallFrame,
    ) -> JSValue {
        match s3_upload_stream_on_resolve(bun_opaque::opaque_deref(g), bun_opaque::opaque_deref(cf)) {
            Ok(v) => v,
            Err(_) => JSValue::ZERO,
        }
    }
}
bun_jsc::jsc_host_abi! {
    #[unsafe(export_name = "Bun__S3UploadStream__onRejectStream")]
    unsafe fn s3_upload_stream_on_reject_shim(
        g: *mut JSGlobalObject,
        cf: *mut CallFrame,
    ) -> JSValue {
        match s3_upload_stream_on_reject(bun_opaque::opaque_deref(g), bun_opaque::opaque_deref(cf)) {
            Ok(v) => v,
            Err(_) => JSValue::ZERO,
        }
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
    callback: Option<fn(S3UploadResult, *mut c_void)>,
    callback_context: *mut c_void,
) -> JsResult<JSValue> {
    let proxy_url = proxy.unwrap_or(b"");
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

    // Thunks adapting typed callbacks to the erased `*mut c_void` signatures stored on
    // MultiPartUpload.
    fn resolve_thunk(
        _: &MultiPartUpload,
        result: S3UploadResult,
        ctx: *mut c_void,
    ) -> JsResult<()> {
        // SAFETY: ctx was set to `*mut S3UploadStreamWrapper` below.
        S3UploadStreamWrapper::resolve(result, unsafe {
            bun_ptr::callback_ctx::<S3UploadStreamWrapper>(ctx)
        })
    }
    fn on_writable_thunk(task: &MultiPartUpload, ctx: *mut c_void, flushed: u64) {
        // SAFETY: task is the live MultiPartUpload; ctx is the wrapper set as callback_context.
        S3UploadStreamWrapper::on_writable(
            task,
            unsafe { bun_ptr::callback_ctx::<S3UploadStreamWrapper>(ctx) },
            flushed,
        );
    }

    // SAFETY (JSC_BORROW): see `writable_stream` for rationale.
    let global_static = GlobalRef::from(global_this);
    let task_ptr: *mut MultiPartUpload = bun_core::heap::into_raw(Box::new(MultiPartUpload {
        root: Cell::new(None),
        queue: JsCell::new(None),
        available: Cell::new(IntegerBitSet::init_full()),
        current_part_number: Cell::new(1),
        ref_count: Cell::new(2), // +1 for the stream ctx (only deinit after task and context ended)
        ended: Cell::new(false),
        options: Cell::new(options),
        acl,
        storage_class,
        request_payer,
        credentials,
        poll_ref: JsCell::new(KeepAlive::init()),
        // SAFETY (JSC_BORROW): VirtualMachine::get() returns the live per-thread VM; it
        // outlives every MultiPartUpload. Dereference to `&'static` for storage.
        vm: VirtualMachine::get(),
        global_this: global_static,
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
        state: Cell::new(MultiPartUploadState::WaitStreamCheck),
        callback: resolve_thunk,
        on_writable: Some(on_writable_thunk),
        callback_context: Cell::new(core::ptr::null_mut()), // assigned below
    }));
    // SAFETY: `task_ptr` is the fresh, non-null allocation root.
    unsafe { (*task_ptr).root.set(core::ptr::NonNull::new(task_ptr)) };
    // SAFETY: freshly heap-allocated and refcounted; only shared access from here on.
    let task = unsafe { &*task_ptr };

    task.poll_ref
        .with_mut(|poll_ref| poll_ref.ref_(bun_io::js_vm_ctx()));

    let ctx_ptr: *mut S3UploadStreamWrapper =
        bun_core::heap::into_raw(Box::new(S3UploadStreamWrapper {
            ref_count: Cell::new(2), // +1 for the stream pump (released by the .then shim / handle_*_stream)
            sink: None,
            callback,
            callback_context,
            path: bun_ptr::RawSlice::new(&task.path),
            // SAFETY: adopts one of `task_ptr`'s two initial refs.
            task: unsafe { RefPtr::from_raw(task_ptr) },
            end_promise: bun_jsc::JSPromiseStrong::init(global_this),
            readable_stream_ref: ReadableStreamStrong::default(),
            global: global_static,
        }));
    // SAFETY: freshly heap-allocated; exclusive access here.
    let ctx = unsafe { &mut *ctx_ptr };
    task.callback_context.set(ctx_ptr.cast::<c_void>());

    // Heap-allocate; `JSSink<NetworkSink>` is layout-
    // compatible (`{ sink: NetworkSink }`) so the cast in `to_sink()` is just a pointer reinterpret.
    // Ownership stays with `ctx.sink` (freed in `detach_sink`); the JS
    // controller created by `assign_to_stream` detaches (`m_sinkPtr = null`)
    // via `controller.end()/close()` before GC so its destructor never calls
    // `finalize` on this allocation.
    let sink: &mut NetworkSink = Box::leak(NetworkSink::new(NetworkSink {
        // SAFETY: `task_ptr` is live; the sink's ref is released in `detach_writable`.
        task: Some(unsafe { RefPtr::init_ref(task_ptr) }),
        global_this: Some(bun_ptr::BackRef::new(global_this)),
        ..Default::default()
    }));
    let sink_handle = crate::webcore::SinkHandle::S3Upload(bun_ptr::BackRef::new_mut(sink));
    ctx.sink = Some(NonNull::from(&mut *sink));

    // Captured before `assign_to_stream`: a synchronously-draining stream may
    // resolve + clear `ctx.end_promise` before control returns here.
    let end_promise_value = ctx.end_promise.value();
    end_promise_value.ensure_still_alive();

    // Transition WaitStreamCheck → NotStarted before the pump can deliver the
    // first chunk: `readStreamIntoSink`'s `readMany()` drains a pre-enqueued
    // default-controller stream synchronously inside `assign_to_stream`.
    task.continue_stream();

    ctx.readable_stream_ref = ReadableStreamStrong::init(readable_stream, global_this);

    // Native ByteStream fast-path: wire the source/sink handles directly so
    // bytes flow via `ByteStream::on_data` → `SinkHandle::write` without the JS
    // `readStreamIntoSink` pump.
    if let Some(byte_stream) = readable_stream.ptr.bytes() {
        if byte_stream.sink.get().is_none() {
            sink.source = crate::webcore::streams::SourceHandle::ByteStream(byte_stream);
            byte_stream.sink.set(sink_handle);
            byte_stream.sink_paused.set(false);
            readable_stream.lock_native(global_this);
            byte_stream.signal_consumer_attached();

            if let Some(err) = byte_stream.take_pending_error() {
                let err_js = err.to_js(global_this);
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
                        byte_stream.sink.set(crate::webcore::SinkHandle::None);
                        sink.source.clear();
                        if !sink.ended {
                            let _ = sink.end(None);
                        }
                        ctx.handle_resolve_stream();
                        return Ok(end_promise_value);
                    }
                    _ => {}
                }
            }
            if had_last {
                byte_stream.sink.set(crate::webcore::SinkHandle::None);
                sink.source.clear();
                if !sink.ended {
                    let _ = sink.end(None);
                }
                ctx.handle_resolve_stream();
            } else if !byte_stream.sink_paused.get() {
                // Wake the producer after the older bytes are in the sink.
                byte_stream.signal_drained();
            }
            // `!had_last`: the stream-pump +1 (rc=2) is released by
            // `NetworkSink::end_from_stream` after the terminal write/fail so the
            // sink outlives the synchronous `resolve()` re-entry.
            return Ok(end_promise_value);
        }
        // sink already attached: fall through to the JS pump.
    }

    // The controller cell is installed into `sink.source` by `assign_to_stream`.
    let assignment_result: JSValue = NetworkSinkJSSink::assign_to_stream(
        global_this,
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
                    assignment_result.then(
                        global_this,
                        ctx_ptr,
                        s3_upload_stream_on_resolve_shim,
                        s3_upload_stream_on_reject_shim,
                    );
                }
                bun_jsc::js_promise::Status::Fulfilled => {
                    ctx.handle_resolve_stream();
                }
                bun_jsc::js_promise::Status::Rejected => {
                    promise.set_handled(global_this.vm());
                    let result = promise.result(global_this.vm());
                    ctx.handle_reject_stream(result);
                }
            }
            return Ok(end_promise_value);
        }
    }

    // The stream drained synchronously inside `assign_to_stream` (no promise
    // returned). `handle_resolve_stream` destroys the sink, so re-borrow from
    // `ctx.sink` rather than the `sink` reference taken before assign_to_stream.
    if let Some(sink) = ctx.sink_mut() {
        if !sink.ended {
            let _ = sink.end(None);
        }
    }
    ctx.handle_resolve_stream();
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
    callback: fn(
        chunk: &MutableString,
        has_more: bool,
        err: Option<Error::S3Error>,
        ctx: *mut c_void,
    ),
    callback_context: *mut c_void,
) -> *mut S3HttpDownloadStreamingTask {
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
            callback(
                &MutableString::default(),
                false,
                Some(Error::S3Error {
                    code: error_code_and_message.code,
                    message: error_code_and_message.message,
                }),
                callback_context,
            );
            return core::ptr::null_mut();
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
    let proxy = proxy_url.unwrap_or(b"");
    let owned_proxy: Box<[u8]> = if !proxy.is_empty() {
        Box::<[u8]>::from(proxy)
    } else {
        Box::<[u8]>::default()
    };
    let task_ptr = bun_core::heap::into_raw(S3HttpDownloadStreamingTask::new(
        S3HttpDownloadStreamingTask {
            // `http: undefined` — fully overwritten by `task.http.write(AsyncHTTP::init(...))` below.
            http: core::mem::MaybeUninit::uninit(),
            sign_result: result,
            proxy_url: owned_proxy,
            callback_context: NonNull::new(callback_context.cast::<()>())
                .expect("callers always pass a non-null Box-allocated context"),
            callback,
            headers,
            http_ticket: None,
            has_schedule_callback: core::sync::atomic::AtomicBool::new(false),
            signal_store: Default::default(),
            signals: Default::default(),
            poll_ref: bun_io::KeepAlive::init(),
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
        },
    ));
    // SAFETY: just allocated via heap::alloc, non-null; lifetime owned by HTTP callback
    // (freed via heap::take in S3HttpDownloadStreamingTask::http_callback).
    let task = unsafe { &mut *task_ptr };
    task.poll_ref.ref_(bun_io::js_vm_ctx());

    // SAFETY: lifetime extension — `url` / `headers_buf` / `proxy_url` borrow from heap-allocated
    // fields of `*task` which the task outlives. See `execute_simple_s3_request`.
    let url = bun_url::URL::parse(unsafe { bun_ptr::detach_lifetime_ref(&*task.sign_result.url) });
    // SAFETY: same lifetime-extension invariant as `url` above — `task.headers.buf` is
    // heap-owned by `*task` and outlives the AsyncHTTP request.
    let headers_buf: &'static [u8] =
        unsafe { bun_ptr::detach_lifetime(task.headers.buf.as_slice()) };
    let http_proxy = if !task.proxy_url.is_empty() {
        // SAFETY: same lifetime-extension invariant as `url` above — `task.proxy_url` is
        // heap-owned by `*task` and outlives the AsyncHTTP request.
        Some(bun_url::URL::parse(unsafe {
            bun_ptr::detach_lifetime_ref(&*task.proxy_url)
        }))
    } else {
        None
    };

    task.signals = task.signal_store.to_with_backpressure();

    let vm = VirtualMachine::get();
    let verbose = vm.get_verbose_fetch();
    let reject_unauthorized = vm.get_tls_reject_unauthorized();

    task.http.write(bun_http::AsyncHTTP::init(
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
            signals: Some(task.signals),
            reject_unauthorized: Some(reject_unauthorized),
            ..Default::default()
        },
    ));
    // SAFETY: `http` was initialised by `task.http.write(...)` immediately above.
    let http = unsafe { task.http.assume_init_mut() };
    task.async_http_id = http.async_http_id;
    // enable streaming
    http.enable_response_body_streaming();
    // queue http request
    bun_http::http_thread::init(&Default::default());
    let mut batch = bun_threading::thread_pool::Batch::default();
    http.schedule(&mut batch);
    // Out on the HTTP thread until its final callback: the VM aborts it at
    // teardown (registry) and waits for it (the ticket).
    task.http_ticket = Some(VirtualMachine::get().ticket());
    crate::jsc_hooks::ActiveHandle::S3Download(core::ptr::NonNull::new(task_ptr).expect("task"))
        .register();
    bun_http::HTTPThread::schedule(batch);
    task_ptr
}

pub struct S3DownloadStreamWrapper {
    stream: crate::webcore::byte_stream::ProducerHold,
    pub path: Box<[u8]>,
    pub global: GlobalRef, // JSC_BORROW
    /// Non-owning. The task frees itself on the main thread once `has_more == false`,
    /// which first drops this wrapper (clearing the stream's producer handle), so this
    /// pointer is never observed dangling from `on_stream_cancelled`.
    pub task: Cell<*mut S3HttpDownloadStreamingTask>,
}

impl S3DownloadStreamWrapper {
    fn new(init: Self) -> *mut Self {
        bun_core::heap::into_raw(Box::new(init))
    }

    /// `this` is the heap pointer from `new` (write and dealloc provenance): the terminal
    /// callback frees the wrapper through it, so no reference derived from it may outlive
    /// this call.
    fn callback(
        chunk: &MutableString,
        has_more: bool,
        request_err: Option<Error::S3Error>,
        this: *mut Self,
    ) {
        let _guard = scopeguard::guard(this, move |s| {
            if !has_more {
                // SAFETY: `s` is the live allocation from `new`; the HTTP thread does not call
                // back after the terminal chunk, so this is the only owner left.
                drop(unsafe { bun_core::heap::take(s) });
            }
        });
        // SAFETY: live until the guard runs, which is after the last use of this borrow.
        let self_ = unsafe { &*this };

        if let Some(err) = request_err {
            let Some(bytes) = self_.stream.take() else {
                return;
            };
            bytes.on_data(crate::webcore::streams::StreamResult::Err(
                crate::webcore::streams::StreamError::JSValue(bun_jsc::strong::Optional::create(
                    s3_error_to_js(&err, &self_.global, Some(&self_.path)),
                    &self_.global,
                )),
            ));
            return;
        }
        if has_more {
            let Some(bytes) = self_.stream.bytes() else {
                return;
            };
            bytes.on_data(crate::webcore::streams::StreamResult::Temporary(
                // chunk.list is borrowed for the duration of on_data.
                bun_ptr::RawSlice::new(chunk.list.as_slice()),
            ));
            // `on_data` can cancel us, which releases the hold.
            if self_.stream.is_held() {
                self_.after_chunk_delivered(&bytes);
            }
            return;
        }
        let Some(bytes) = self_.stream.take() else {
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
        use crate::webcore::byte_stream::{AfterDelivery, ProducerHold};
        let task = self.task.get();
        if task.is_null() {
            return;
        }
        match ProducerHold::after_delivery(bytes) {
            // SAFETY: see `task`.
            AfterDelivery::Resume => unsafe { (*task).resume_receive() },
            // SAFETY: see `task`.
            AfterDelivery::Pause => unsafe { (*task).signal_store.pause_receive() },
            AfterDelivery::Park => {
                // SAFETY: see `task`.
                unsafe { (*task).signal_store.pause_receive() };
                if self.stream.park() {
                    // SAFETY: see `task`; `park` touched the stream's source, not the task.
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

    /// The parked stream's wrapper was collected: nothing can read the rest. Inside a GC sweep;
    /// touches no JS cell.
    pub(crate) fn on_stream_collected(&self) {
        self.on_stream_cancelled();
    }

    pub(crate) fn on_stream_cancelled(&self) {
        // The download may still be in progress, but the callback will see no stream and skip
        // delivery. When the download finishes (has_more == false) the task frees this wrapper.
        self.stream.release();
        // Abort the in-flight HTTP request so the HTTP thread delivers a final
        // callback with `has_more == false`, which frees the task and this wrapper.
        // Without this, a server that never sends the terminal chunk would leak both.
        let task = self.task.replace(core::ptr::null_mut());
        if !task.is_null() {
            // SAFETY: task is live until its own `on_response` frees it on this thread,
            // which has not happened yet (it would have dropped this wrapper first).
            unsafe {
                (*task)
                    .signal_store
                    .aborted
                    .store(true, core::sync::atomic::Ordering::Relaxed);
                (*task).poll_ref.unref(bun_io::js_vm_ctx());
                // Wake the HTTP thread so it observes the abort even when the
                // socket is idle; otherwise the final `has_more == false`
                // callback never fires and both the task and wrapper leak.
                bun_http::http_thread().schedule_shutdown_by_id((*task).async_http_id);
            }
        }
    }

    fn opaque_callback(
        chunk: &MutableString,
        has_more: bool,
        err: Option<Error::S3Error>,
        opaque_self: *mut c_void,
    ) {
        // `opaque_self` is the wrapper allocated in `readable_stream`; handed on as the raw
        // pointer so that the terminal callback can free it.
        Self::callback(chunk, has_more, err, opaque_self.cast::<Self>());
    }
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
    // SAFETY (JSC_BORROW): `global_this` outlives the wrapper (it owns the JS heap that
    // owns the readable stream which keeps the wrapper reachable via the producer handle);
    // store as `'static` for the heap-allocated wrapper.
    let global_static = GlobalRef::from(global_this);

    // Ownership of the heap-allocated NewSource transfers to the JS wrapper (m_ctx) via
    // `to_readable_stream()`/`to_js()`; the wrapper's finalize() reclaims it.
    let reader: *mut crate::webcore::byte_stream::Source =
        crate::webcore::byte_stream::Source::new(crate::webcore::readable_stream::NewSource {
            context: ByteStream::default(),
            global_this: Some(bun_ptr::BackRef::new(global_this)),
            ..Default::default()
        });
    // SAFETY: freshly heap-allocated via TrivialNew; exclusive access until handed to JS below.
    let reader_mut = unsafe { &mut *reader };

    reader_mut.context.setup();
    let readable_value = reader_mut.to_readable_stream(global_this)?;

    let wrapper = S3DownloadStreamWrapper::new(S3DownloadStreamWrapper {
        stream: Default::default(),
        path: Box::<[u8]>::from(path),
        global: global_static,
        task: Cell::new(core::ptr::null_mut()),
    });
    // SAFETY: `reader` is the live source made above; `wrapper` the live heap allocation.
    unsafe { (*wrapper).stream.hold(&raw mut reader_mut.context) };

    reader_mut
        .producer
        .set(crate::webcore::streams::SourceHandle::S3DownloadBody(
            // SAFETY: `wrapper` is the live heap allocation; cleared from the producer slot before
            // it is freed (`ProducerHold::take`).
            unsafe { bun_ptr::BackRef::from_raw(wrapper) },
        ));

    let task = download_stream(
        this,
        path,
        offset,
        size,
        proxy_url,
        request_payer,
        S3DownloadStreamWrapper::opaque_callback,
        wrapper.cast::<c_void>(),
    );
    if !task.is_null() {
        // SAFETY: on the success path `download_stream` only schedules work onto the HTTP
        // thread; the wrapper is freed via `opaque_callback` on this (main) thread, which
        // cannot run until we return to the event loop, so `wrapper` is still live here.
        unsafe { (*wrapper).task.set(task) };
    }
    Ok(readable_value)
}
