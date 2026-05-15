use core::ffi::c_void;
use core::ptr::NonNull;
use std::io::Write as _;

use bun_collections::{ByteVecExt, VecExt};
use bun_core::MutableString;
use bun_http::HeadersExt as _;
use bun_jsc::virtual_machine::VirtualMachine;
#[allow(unused_imports)]
use bun_jsc::{GlobalRef, JSGlobalObject, JSValue, JsResult, StringJsc};

use bun_core::strings;

// Re-exports (thin aliases matching the Zig file's top-level `pub const X = @import(...)`)
pub use crate::webcore::s3::download_stream::S3HttpDownloadStreamingTask;
pub use crate::webcore::s3::multipart::{self, MultiPartUpload};
pub use crate::webcore::s3::multipart_options::MultiPartUploadOptions;
pub use bun_s3_signing::acl::ACL;
pub use bun_s3_signing::storage_class::StorageClass;

pub use bun_s3_signing::error as Error;
// PORT NOTE: `throwSignError` / `getJSSignError` live in `error_jsc.zig` (jsc-side
// of the s3_signing error tables). The pure error module is `bun_s3_signing::error`;
// the jsc helpers are mounted here as a child module so the umbrella re-export hub
// matches the Zig `s3/client.zig` shape.
#[path = "error_jsc.rs"]
pub mod error_jsc;
pub use error_jsc::S3ErrorJsc;
pub use error_jsc::get_js_sign_error;
pub use error_jsc::s3_error_to_js;
pub use error_jsc::throw_sign_error;

pub use bun_s3_signing::credentials::S3Credentials;
pub use bun_s3_signing::credentials::S3CredentialsWithOptions;
use bun_s3_signing::credentials::encode_uri_component;

pub use crate::webcore::s3::list_objects::S3ListObjectsOptions;
pub use crate::webcore::s3::list_objects::get_list_objects_options_from_js;
pub use crate::webcore::s3::simple_request::S3DeleteResult;
pub use crate::webcore::s3::simple_request::S3DownloadResult;
pub use crate::webcore::s3::simple_request::S3HttpSimpleTask;
pub use crate::webcore::s3::simple_request::S3ListObjectsResult;
pub use crate::webcore::s3::simple_request::S3StatResult;
pub use crate::webcore::s3::simple_request::S3UploadResult;

use crate::webcore::s3::simple_request as s3_simple_request;

use crate::webcore::ResumableSinkBackpressure;
#[allow(unused_imports)]
use crate::webcore::resumable_sink::{ResumableS3UploadSink, ResumableSinkContext};

use crate::webcore::BlobSizeType;
#[allow(unused_imports)]
use crate::webcore::ByteStream;
use crate::webcore::ReadableStream;
use crate::webcore::readable_stream::Source as ReadableStreamPtr;
use crate::webcore::readable_stream::Strong as ReadableStreamStrong;
use crate::webcore::s3::multipart::State as MultiPartUploadState;
use crate::webcore::sink::SinkSignal;
use crate::webcore::streams::NetworkSink;
use bun_collections::IntegerBitSet;
use bun_io::KeepAlive;
use bun_io::StreamBuffer;

bun_core::declare_scope!(S3UploadStream, visible);

// TODO(port): `bun.JSTerminated!T` is not in the type map; assuming a thin alias in bun_jsc.
type JsTerminatedResult<T> = Result<T, bun_jsc::JsTerminated>;

pub fn stat(
    this: &S3Credentials,
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
    this: &S3Credentials,
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
    this: &S3Credentials,
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

pub fn delete(
    this: &S3Credentials,
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
    this: &S3Credentials,
    // PORT NOTE: Zig took `S3ListObjectsOptions` by-value (implicit struct
    // copy at the call site). The Rust struct owns `Utf8Slice`s and is not
    // `Clone`, but this fn only reads fields synchronously to build the
    // search-params string — borrow instead so the caller (Store::S3::
    // list_objects) can retain ownership in its async Wrapper for `Drop`.
    list_options: &S3ListObjectsOptions,
    callback: fn(S3ListObjectsResult, *mut c_void) -> JsTerminatedResult<()>,
    callback_context: *mut c_void,
    proxy_url: Option<&[u8]>,
) -> JsTerminatedResult<()> {
    let mut search_params: Vec<u8> = Vec::<u8>::default();

    let _ = search_params.append_slice(b"?"); // OOM/capacity: Zig aborts; port keeps fire-and-forget

    if let Some(continuation_token) = list_options.continuation_token.as_deref() {
        let mut buff = vec![0u8; continuation_token.len() * 3];
        let encoded =
            encode_uri_component::<true>(continuation_token, &mut buff).expect("unreachable");
        // OOM/capacity: Zig aborts; port keeps fire-and-forget
        let _ = search_params.append_fmt(format_args!(
            "continuation-token={}",
            bstr::BStr::new(encoded)
        ));
    }

    if let Some(delimiter) = list_options.delimiter.as_deref() {
        let mut buff = vec![0u8; delimiter.len() * 3];
        let encoded = encode_uri_component::<true>(delimiter, &mut buff).expect("unreachable");

        if list_options.continuation_token.is_some() {
            let _ =
                search_params.append_fmt(format_args!("&delimiter={}", bstr::BStr::new(encoded))); // OOM/capacity: Zig aborts; port keeps fire-and-forget
        } else {
            let _ =
                search_params.append_fmt(format_args!("delimiter={}", bstr::BStr::new(encoded))); // OOM/capacity: Zig aborts; port keeps fire-and-forget
        }
    }

    if list_options.encoding_type.is_some() {
        if list_options.continuation_token.is_some() || list_options.delimiter.is_some() {
            let _ = search_params.append_slice(b"&encoding-type=url"); // OOM/capacity: Zig aborts; port keeps fire-and-forget
        } else {
            let _ = search_params.append_slice(b"encoding-type=url"); // OOM/capacity: Zig aborts; port keeps fire-and-forget
        }
    }

    if let Some(fetch_owner) = list_options.fetch_owner {
        if list_options.continuation_token.is_some()
            || list_options.delimiter.is_some()
            || list_options.encoding_type.is_some()
        {
            let _ = search_params.append_fmt(format_args!("&fetch-owner={}", fetch_owner)); // OOM/capacity: Zig aborts; port keeps fire-and-forget
        } else {
            let _ = search_params.append_fmt(format_args!("fetch-owner={}", fetch_owner)); // OOM/capacity: Zig aborts; port keeps fire-and-forget
        }
    }

    if list_options.continuation_token.is_some()
        || list_options.delimiter.is_some()
        || list_options.encoding_type.is_some()
        || list_options.fetch_owner.is_some()
    {
        let _ = search_params.append_slice(b"&list-type=2"); // OOM/capacity: Zig aborts; port keeps fire-and-forget
    } else {
        let _ = search_params.append_slice(b"list-type=2"); // OOM/capacity: Zig aborts; port keeps fire-and-forget
    }

    if let Some(max_keys) = list_options.max_keys {
        let _ = search_params.append_fmt(format_args!("&max-keys={}", max_keys)); // OOM/capacity: Zig aborts; port keeps fire-and-forget
    }

    if let Some(prefix) = list_options.prefix.as_deref() {
        let mut buff = vec![0u8; prefix.len() * 3];
        let encoded = encode_uri_component::<true>(prefix, &mut buff).expect("unreachable");
        let _ = search_params.append_fmt(format_args!("&prefix={}", bstr::BStr::new(encoded))); // OOM/capacity: Zig aborts; port keeps fire-and-forget
    }

    if let Some(start_after) = list_options.start_after.as_deref() {
        let mut buff = vec![0u8; start_after.len() * 3];
        let encoded = encode_uri_component::<true>(start_after, &mut buff).expect("unreachable");
        let _ = search_params.append_fmt(format_args!("&start-after={}", bstr::BStr::new(encoded))); // OOM/capacity: Zig aborts; port keeps fire-and-forget
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

    let task_ptr = bun_core::heap::into_raw(Box::new(S3HttpSimpleTask {
        // Zig used `= undefined`; written below via `MaybeUninit::write` before any read.
        http: core::mem::MaybeUninit::uninit(),
        range: None,
        sign_result: result,
        callback_context,
        callback: s3_simple_request::Callback::ListObjects(callback),
        headers,
        vm: Some(bun_ptr::BackRef::new(VirtualMachine::get())),
        response_buffer: MutableString::default(),
        result: bun_http::HTTPClientResult::default(),
        concurrent_task: Default::default(),
        proxy_url: Box::default(),
        poll_ref: bun_io::KeepAlive::init(),
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

    // SAFETY (lifetime extension): `url`, `headers_buf`, and `proxy_url` borrow from
    // heap-allocated fields of `*task` which the task outlives. AsyncHTTP::init wants
    // `'static` borrows because the HTTP thread reads them concurrently; they remain valid
    // until `task` is dropped in `on_response`.
    let url = bun_url::URL::parse(unsafe { bun_ptr::detach_lifetime_ref(&*task.sign_result.url) });
    let headers_buf: &'static [u8] =
        unsafe { bun_ptr::detach_lifetime(task.headers.buf.as_slice()) };
    let http_proxy = if !task.proxy_url.is_empty() {
        Some(bun_url::URL::parse(unsafe {
            bun_ptr::detach_lifetime_ref(&*task.proxy_url)
        }))
    } else {
        None
    };
    // SAFETY: `task.vm` is the live per-thread VM BackRef from
    // `VirtualMachine::get()`; `get_mut` exclusivity holds — single-threaded
    // dispatch on the JS thread, no other `&`/`&mut VirtualMachine` is live for
    // this call's duration.
    let mut vm_ref = task.vm.expect("vm set at task creation");
    let vm = unsafe { vm_ref.get_mut() };

    task.http.write(bun_http::AsyncHTTP::init(
        bun_http::Method::GET,
        url,
        task.headers.entries.clone().expect("OOM"),
        headers_buf,
        &raw mut task.response_buffer,
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
    bun_http::HTTPThread::schedule(batch);
    Ok(())
}

pub fn upload(
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
///
/// Takes ownership of one `credentials` ref (adopted directly into the
/// `MultiPartUpload`; not bumped). Callers pass `creds.dupe()`.
pub fn writable_stream(
    credentials: bun_ptr::IntrusiveRc<S3Credentials>,
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
            // RAII: `enter()` now, `exit()` on drop (Zig: `defer event_loop.exit()`).
            let _exit_guard = unsafe { bun_jsc::event_loop::EventLoop::enter_scope(event_loop) };
            match result {
                S3UploadResult::Success => {
                    if sink.flush_promise.has_value() {
                        sink.flush_promise
                            .resolve(global, JSValue::js_number(0.0))?;
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

    // Thunks adapting typed callbacks to the erased `*mut c_void` signatures stored on
    // MultiPartUpload (Zig used `@ptrCast` on the fn ptrs directly).
    fn wrapper_callback_thunk(result: S3UploadResult, ctx: *mut c_void) -> JsTerminatedResult<()> {
        // SAFETY: ctx was set to `response_stream: *mut NetworkSink` below.
        wrapper_callback(result, unsafe { bun_ptr::callback_ctx::<NetworkSink>(ctx) })
    }
    fn on_writable_thunk(task: *mut MultiPartUpload, ctx: *mut c_void, flushed: u64) {
        // SAFETY: task is the live MultiPartUpload; ctx is the NetworkSink set as callback_context.
        let _ = NetworkSink::on_writable(
            unsafe { &mut *task },
            unsafe { bun_ptr::callback_ctx::<NetworkSink>(ctx) },
            flushed,
        );
    }

    let proxy_url = proxy.unwrap_or(b"");
    // `credentials` ref adopted by value — moved into the MultiPartUpload below.
    // JSC_BORROW: `global_this` outlives the task (it owns the VM/heap that owns the JS
    // objects which keep the task alive); stored via `GlobalRef` in the heap-allocated
    // MultiPartUpload, matching the Zig pointer field.
    let global_static = GlobalRef::from(global_this);
    let part_size = options.part_size;
    let task_ptr: *mut MultiPartUpload = bun_core::heap::into_raw(Box::new(MultiPartUpload {
        queue: None,
        available: IntegerBitSet::init_full(),
        current_part_number: 1,
        ref_count: core::cell::Cell::new(2), // +1 for the stream
        ended: false,
        options,
        acl: None,
        storage_class,
        request_payer,
        credentials,
        poll_ref: KeepAlive::init(),
        // SAFETY (JSC_BORROW): VirtualMachine::get() returns the live per-thread VM; it
        // outlives every MultiPartUpload (the VM owns the heap that owns the JS objects
        // keeping this task alive). Dereference to `&'static` for storage, matching the
        // Zig pointer field.
        vm: VirtualMachine::get(),
        global_this: global_static,
        buffered: StreamBuffer::default(),
        path: Box::<[u8]>::from(path),
        proxy: if !proxy_url.is_empty() {
            Box::<[u8]>::from(proxy_url)
        } else {
            Box::default()
        },
        content_type: content_type.map(Box::<[u8]>::from),
        content_disposition: content_disposition.map(Box::<[u8]>::from),
        content_encoding: content_encoding.map(Box::<[u8]>::from),
        upload_id: Box::default(),
        uploadid_buffer: MutableString::default(),
        multipart_etags: Vec::new(),
        multipart_upload_list: Vec::new(),
        state: MultiPartUploadState::NotStarted,
        callback: wrapper_callback_thunk,
        on_writable: None, // assigned below after response_stream exists
        callback_context: core::ptr::null_mut(), // assigned below
    }));
    // SAFETY: freshly heap-allocated; exclusive access here.
    let task = unsafe { &mut *task_ptr };

    task.poll_ref.ref_(bun_io::js_vm_ctx());

    // `NetworkSink.new(.{...}).toSink()` — heap-allocate; `JSSink<NetworkSink>` is layout-
    // compatible (`{ sink: NetworkSink }`) so the cast in `to_sink()` is just a pointer reinterpret.
    let response_stream: *mut NetworkSink =
        bun_core::heap::into_raw(NetworkSink::new(NetworkSink {
            task: NonNull::new(task_ptr).map(bun_ptr::BackRef::from),
            global_this: Some(bun_ptr::BackRef::new(global_this)),
            high_water_mark: part_size as BlobSizeType,
            ..Default::default()
        }));

    task.callback_context = response_stream.cast::<c_void>();
    task.on_writable = Some(on_writable_thunk);

    // SAFETY: freshly heap-allocated; exclusive access here. Ownership transfers to the JS
    // wrapper via `to_js()` (the C++ side stores it as m_ctx and calls `finalize` on collect).
    let sink = unsafe { &mut *response_stream };
    sink.signal = SinkSignal::<NetworkSink>::init(JSValue::ZERO);

    // explicitly set it to a dead pointer
    // we use this memory address to disable signals being sent
    sink.signal.clear();
    bun_core::assert_with_location(sink.signal.is_dead(), core::panic::Location::caller());
    Ok(sink.to_js(global_this))
}

pub struct S3UploadStreamWrapper {
    // intrusive ref_count — bun.ptr.RefCount(@This(), "ref_count", deinit, .{}) → bun_ptr::IntrusiveRc<Self>
    pub ref_count: core::cell::Cell<u32>,

    pub sink: Option<*mut ResumableS3UploadSink>,
    pub task: *mut MultiPartUpload,
    pub end_promise: bun_jsc::JSPromiseStrong,
    pub callback: Option<fn(S3UploadResult, *mut c_void)>,
    pub callback_context: *mut c_void,
    /// this is owned by the task not by the wrapper
    pub path: bun_ptr::RawSlice<u8>,
    pub global: GlobalRef, // JSC_BORROW
}

/// Intrusive ref-counted handle. `ref()`/`deref()` from the Zig `bun.ptr.RefCount` mixin
/// are provided by cloning/dropping this handle; `Drop for S3UploadStreamWrapper` runs the
/// finalizer body when the last ref is released.
pub type S3UploadStreamWrapperRef = *mut S3UploadStreamWrapper;

// Zig: `pub const ResumableSink = @import("../ResumableSink.zig").ResumableS3UploadSink;`
// Inherent associated types are unstable; expose as a module-level alias instead.
pub type ResumableSink = ResumableS3UploadSink;

impl S3UploadStreamWrapper {
    /// Intrusive `ref()` — bumps the ref_count.
    pub fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }

    /// Intrusive `deref()` — decrements ref_count; runs finalizer + frees on zero.
    /// SAFETY: `this` must be a live Box-allocated `Self` (created via heap::alloc).
    pub unsafe fn deref_(this: *mut Self) {
        // SAFETY: caller contract above.
        let rc = unsafe { (*this).ref_count.get() } - 1;
        unsafe { (*this).ref_count.set(rc) };
        if rc == 0 {
            // SAFETY: ref_count hit zero; reconstitute the Box to run Drop and free.
            drop(unsafe { bun_core::heap::take(this) });
        }
    }

    fn detach_sink(&mut self) {
        bun_output::scoped_log!(S3UploadStream, "detachSink {}", self.sink.is_some());
        if let Some(sink) = self.sink.take() {
            // SAFETY: sink is a live Box-allocated ResumableSink; deref_ releases our ref.
            unsafe { ResumableS3UploadSink::deref_(sink) };
        }
    }

    /// Exclusive borrow of the `MultiPartUpload` this wrapper holds a counted
    /// ref on (released in `Drop`). Detached lifetime so the borrow does not
    /// conflict with disjoint `&mut self` field access at call sites — `task`
    /// is a separate heap allocation, not inside `*self`.
    ///
    /// SAFETY (encapsulated): `task` is set once at construction from
    /// `MultiPartUpload::create` and intrusive-ref'd for this wrapper's entire
    /// lifetime; single-threaded JS — no overlapping `&mut` from elsewhere.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    fn task_mut<'r>(&self) -> &'r mut MultiPartUpload {
        // SAFETY: see doc comment — counted ref keeps pointee live; sole writer.
        unsafe { &mut *self.task }
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
        self.task_mut().write_bytes(data, false).expect("OOM")
    }

    pub fn write_end_request(&mut self, err: Option<JSValue>) {
        bun_output::scoped_log!(S3UploadStream, "writeEndRequest {}", err.is_some());
        self.detach_sink();
        // PORT NOTE: reshaped for borrowck — Zig used `defer this.deref()`
        let _deref_guard = scopeguard::guard(std::ptr::from_mut::<Self>(self), |s| {
            // SAFETY: s points to self which is alive for the duration of the guard; deref_
            // decrements ref_count and may free self only after all borrows above are released
            unsafe { Self::deref_(s) }
        });
        if let Some(js_err) = err {
            if self.end_promise.has_value() && !js_err.is_empty_or_undefined_or_null() {
                // if we have a explicit error, reject the promise
                // if not when calling .fail will create a S3Error instance
                // this match the previous behavior
                let _ = self.end_promise.reject(&self.global, Ok(js_err)); // TODO: properly propagate exception upwards
                self.end_promise = bun_jsc::JSPromiseStrong::empty();
            }
            if !self.task_mut().ended {
                let _ = self.task_mut().fail(Error::S3Error {
                    code: b"UnknownError",
                    message: b"ReadableStream ended with an error",
                }); // TODO: properly propagate exception upwards
            }
        } else {
            // Zig spec: `_ = bun.handleOom(this.task.writeBytes("", true))` — abort on OOM.
            let _ = self.task_mut().write_bytes(b"", true).expect("OOM");
        }
    }

    pub fn resolve(result: S3UploadResult, self_: &mut Self) -> JsTerminatedResult<()> {
        bun_output::scoped_log!(S3UploadStream, "resolve");
        // PORT NOTE: reshaped for borrowck — Zig used `defer self.deref()`
        let _deref_guard = scopeguard::guard(std::ptr::from_mut::<Self>(self_), |s| {
            // SAFETY: s points to self_ which is alive for the duration of the guard; deref_
            // decrements ref_count and may free self only after all borrows above are released
            unsafe { Self::deref_(s) }
        });
        match &result {
            S3UploadResult::Success => {
                if self_.end_promise.has_value() {
                    self_
                        .end_promise
                        .resolve(&self_.global, JSValue::js_number(0.0))?;
                    self_.end_promise = bun_jsc::JSPromiseStrong::empty();
                }
            }
            S3UploadResult::Failure(err) => {
                if let Some(sink) = self_.sink.take() {
                    // sink in progress, cancel it (will call writeEndRequest for cleanup and will reject the endPromise)
                    let js_err = s3_error_to_js(err, &self_.global, Some(self_.path.slice()));
                    // SAFETY: sink is a live Box-allocated ResumableSink.
                    unsafe { (*sink).cancel(js_err) };
                    // SAFETY: deref_ releases our ref (associated fn — raw-ptr receiver).
                    unsafe { ResumableS3UploadSink::deref_(sink) };
                } else if self_.end_promise.has_value() {
                    let js_err = s3_error_to_js(err, &self_.global, Some(self_.path.slice()));
                    self_.end_promise.reject(&self_.global, Ok(js_err))?;
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
///
/// Takes ownership of one `credentials` ref (adopted directly into the
/// `MultiPartUpload`; not bumped). Callers pass `creds.dupe()`. On every
/// early-return path the ref is explicitly released.
pub fn upload_stream(
    credentials: bun_ptr::IntrusiveRc<S3Credentials>,
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
        credentials.deref();
        return Ok(bun_jsc::JSPromise::rejected_promise(
            global_this,
            strings::String::static_("ReadableStream is already disturbed")
                .to_error_instance(global_this),
        )
        .to_js());
    }

    match readable_stream.ptr {
        ReadableStreamPtr::Invalid => {
            credentials.deref();
            return Ok(bun_jsc::JSPromise::rejected_promise(
                global_this,
                strings::String::static_("ReadableStream is invalid")
                    .to_error_instance(global_this),
            )
            .to_js());
        }
        // TODO(port): Zig used `inline .File, .Bytes => |stream|` — File/Bytes payload types
        // differ (`*FileReader` vs `*ByteStream`), so the inline-captured `stream` has different
        // types per arm. Manual unroll once both have a `.pending` accessor.
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
                let (js_err, was_strong) = err.to_js_weak(global_this);
                if was_strong == crate::webcore::streams::WasStrong::Strong {
                    js_err.unprotect();
                }
                js_err.ensure_still_alive();
                credentials.deref();
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
                let (js_err, was_strong) = err.to_js_weak(global_this);
                if was_strong == crate::webcore::streams::WasStrong::Strong {
                    js_err.unprotect();
                }
                js_err.ensure_still_alive();
                credentials.deref();
                return Ok(bun_jsc::JSPromise::rejected_promise(global_this, js_err).to_js());
            }
        }
        _ => {}
    }

    // Thunks adapting typed callbacks to the erased `*mut c_void` signatures stored on
    // MultiPartUpload (Zig used `@ptrCast` on the fn ptrs directly).
    fn resolve_thunk(result: S3UploadResult, ctx: *mut c_void) -> JsTerminatedResult<()> {
        // SAFETY: ctx was set to `*mut S3UploadStreamWrapper` below.
        S3UploadStreamWrapper::resolve(result, unsafe {
            bun_ptr::callback_ctx::<S3UploadStreamWrapper>(ctx)
        })
    }
    fn on_writable_thunk(task: *mut MultiPartUpload, ctx: *mut c_void, flushed: u64) {
        // SAFETY: task is the live MultiPartUpload; ctx is the wrapper set as callback_context.
        S3UploadStreamWrapper::on_writable(
            unsafe { &mut *task },
            unsafe { bun_ptr::callback_ctx::<S3UploadStreamWrapper>(ctx) },
            flushed,
        );
    }

    // PORT NOTE: Zig calls `this.ref()` *before* the is_disturbed/Invalid/pending-err early
    // returns above (client.zig:465), leaking a credential ref on every early-return path.
    // Here `credentials` is owned-by-value and explicitly `.deref()`ed on each early
    // return — strictly an improvement.
    //
    // `credentials` ref adopted by value — moved into the MultiPartUpload below.
    // SAFETY (JSC_BORROW): see `writable_stream` for rationale.
    let global_static = GlobalRef::from(global_this);
    let task_ptr: *mut MultiPartUpload = bun_core::heap::into_raw(Box::new(MultiPartUpload {
        queue: None,
        available: IntegerBitSet::init_full(),
        current_part_number: 1,
        ref_count: core::cell::Cell::new(2), // +1 for the stream ctx (only deinit after task and context ended)
        ended: false,
        options,
        acl,
        storage_class,
        request_payer,
        credentials,
        poll_ref: KeepAlive::init(),
        // SAFETY (JSC_BORROW): VirtualMachine::get() returns the live per-thread VM; it
        // outlives every MultiPartUpload. Dereference to `&'static` for storage, matching
        // the Zig pointer field.
        vm: VirtualMachine::get(),
        global_this: global_static,
        buffered: StreamBuffer::default(),
        path: Box::<[u8]>::from(path),
        proxy: if !proxy_url.is_empty() {
            Box::<[u8]>::from(proxy_url)
        } else {
            Box::default()
        },
        content_type: content_type.map(Box::<[u8]>::from),
        content_disposition: content_disposition.map(Box::<[u8]>::from),
        content_encoding: content_encoding.map(Box::<[u8]>::from),
        upload_id: Box::default(),
        uploadid_buffer: MutableString::default(),
        multipart_etags: Vec::new(),
        multipart_upload_list: Vec::new(),
        state: MultiPartUploadState::WaitStreamCheck,
        callback: resolve_thunk,
        on_writable: None,                       // assigned below after ctx exists
        callback_context: core::ptr::null_mut(), // assigned below
    }));
    // SAFETY: freshly heap-allocated; exclusive access here.
    let task = unsafe { &mut *task_ptr };

    task.poll_ref.ref_(bun_io::js_vm_ctx());

    let ctx_ptr: *mut S3UploadStreamWrapper =
        bun_core::heap::into_raw(Box::new(S3UploadStreamWrapper {
            ref_count: core::cell::Cell::new(2), // +1 for the stream sink (only deinit after both sink and task ended)
            sink: None,
            callback,
            callback_context,
            path: bun_ptr::RawSlice::new(&task.path),
            task: task_ptr,
            end_promise: bun_jsc::JSPromiseStrong::init(global_this),
            global: global_static,
        }));
    // SAFETY: freshly heap-allocated; exclusive access here.
    let ctx = unsafe { &mut *ctx_ptr };
    // +1 because the ctx refs the sink
    ctx.sink = Some(ResumableSink::init_exact_refs(
        &global_static,
        readable_stream,
        ctx_ptr,
        2,
    ));
    task.callback_context = ctx_ptr.cast::<c_void>();
    task.on_writable = Some(on_writable_thunk);
    task.continue_stream();
    Ok(ctx.end_promise.value())
}

/// download a file from s3 chunk by chunk aka streaming (used on readableStream)
pub fn download_stream(
    this: &S3Credentials,
    path: &[u8],
    offset: usize,
    size: Option<usize>,
    proxy_url: Option<&[u8]>,
    request_payer: bool,
    callback: fn(
        chunk: MutableString,
        has_more: bool,
        err: Option<Error::S3Error>,
        ctx: *mut c_void,
    ),
    callback_context: *mut c_void,
) {
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
            range: range.map(Vec::into_boxed_slice),
            headers,
            // `VirtualMachine::get()` returns the live per-thread VM singleton.
            vm: Some(bun_ptr::BackRef::new(VirtualMachine::get())),
            has_schedule_callback: core::sync::atomic::AtomicBool::new(false),
            signal_store: Default::default(),
            signals: Default::default(),
            poll_ref: bun_io::KeepAlive::init(),
            response_buffer: MutableString::default(),
            mutex: Default::default(),
            reported_response_buffer: MutableString::default(),
            // Zig: `state: State.AtomicType = .init(@bitCast(State{}))` — `State{}` defaults
            // `has_more = true` (bit 48). Passing 0 here would start the task with
            // `has_more == false`, tripping the `assert(state.has_more)` in
            // `process_http_callback` on the very first HTTP-thread callback.
            state: core::sync::atomic::AtomicU64::new(
                crate::webcore::s3::download_stream::State::default().0,
            ),
            concurrent_task: Default::default(),
        },
    ));
    // SAFETY: just allocated via heap::alloc, non-null; lifetime owned by HTTP callback
    // (freed via heap::take in S3HttpDownloadStreamingTask::http_callback).
    let task = unsafe { &mut *task_ptr };
    task.poll_ref.ref_(bun_io::js_vm_ctx());

    // SAFETY (lifetime extension): `url` / `headers_buf` / `proxy_url` borrow from heap-allocated
    // fields of `*task` which the task outlives. See `execute_simple_s3_request`.
    let url = bun_url::URL::parse(unsafe { bun_ptr::detach_lifetime_ref(&*task.sign_result.url) });
    let headers_buf: &'static [u8] =
        unsafe { bun_ptr::detach_lifetime(task.headers.buf.as_slice()) };
    let http_proxy = if !task.proxy_url.is_empty() {
        Some(bun_url::URL::parse(unsafe {
            bun_ptr::detach_lifetime_ref(&*task.proxy_url)
        }))
    } else {
        None
    };

    task.signals = task.signal_store.to();

    // SAFETY: `VirtualMachine::get()` returns the live per-thread VM singleton; the
    // `&mut` borrow is scoped to the two getter calls below.
    let vm_mut = VirtualMachine::get().as_mut();
    let verbose = vm_mut.get_verbose_fetch();
    let reject_unauthorized = vm_mut.get_tls_reject_unauthorized();

    task.http.write(bun_http::AsyncHTTP::init(
        bun_http::Method::GET,
        url,
        task.headers.entries.clone().expect("OOM"),
        headers_buf,
        &raw mut task.response_buffer,
        b"",
        bun_http::HTTPClientResultCallback::new::<S3HttpDownloadStreamingTask>(
            task_ptr,
            S3HttpDownloadStreamingTask::http_callback,
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
    // enable streaming
    http.enable_response_body_streaming();
    // queue http request
    bun_http::http_thread::init(&Default::default());
    let mut batch = bun_threading::thread_pool::Batch::default();
    http.schedule(&mut batch);
    bun_http::HTTPThread::schedule(batch);
}

/// returns a readable stream that reads from the s3 path
pub fn readable_stream(
    this: &S3Credentials,
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
        pub global: GlobalRef, // JSC_BORROW
    }

    impl S3DownloadStreamWrapper {
        pub fn new(init: Self) -> *mut Self {
            bun_core::heap::into_raw(Box::new(init))
        }

        pub fn callback(
            chunk: MutableString,
            has_more: bool,
            request_err: Option<Error::S3Error>,
            self_: &mut Self,
        ) -> JsTerminatedResult<()> {
            // PORT NOTE: reshaped for borrowck — Zig used `defer if (!has_more) self.deinit()`
            let _guard = scopeguard::guard(std::ptr::from_mut::<Self>(self_), move |s| {
                if !has_more {
                    // SAFETY: s is a live Box-allocated pointer (heap::alloc in S3DownloadStreamWrapper::new);
                    // reconstituting and dropping the Box runs Drop::drop and frees the allocation
                    drop(unsafe { bun_core::heap::take(s) });
                }
            });

            if let Some(readable) = self_.readable_stream_ref.get(&self_.global) {
                // BACKREF: see `Source::bytes()` — payload live while the
                // readable stream is rooted. R-2: `&` — `on_data` re-enters JS.
                if let Some(bytes) = readable.ptr.bytes() {
                    if let Some(err) = request_err {
                        bytes.on_data(crate::webcore::streams::StreamResult::Err(
                            crate::webcore::streams::StreamError::JSValue(s3_error_to_js(
                                &err,
                                &self_.global,
                                Some(&self_.path),
                            )),
                        ))?;
                        return Ok(());
                    }
                    if has_more {
                        bytes.on_data(crate::webcore::streams::StreamResult::Temporary(
                            // chunk.list is borrowed for the duration of on_data.
                            bun_ptr::RawSlice::new(chunk.list.as_slice()),
                        ))?;
                        return Ok(());
                    }

                    bytes.on_data(crate::webcore::streams::StreamResult::TemporaryAndDone(
                        // chunk.list is borrowed for the duration of on_data.
                        bun_ptr::RawSlice::new(chunk.list.as_slice()),
                    ))?;
                    return Ok(());
                }
            }
            Ok(())
        }

        /// Clear the cancel_handler on the ByteStream.Source to prevent use-after-free.
        /// Must be called before releasing readable_stream_ref.
        fn clear_stream_cancel_handler(&mut self) {
            if let Some(readable) = self.readable_stream_ref.get(&self.global) {
                // BACKREF: see `Source::bytes()` — payload live while the
                // readable stream is rooted. R-2: shared deref + `Cell::set`.
                if let Some(bytes) = readable.ptr.bytes() {
                    let source = bytes.parent_const();
                    source.cancel_handler.set(None);
                    source.cancel_ctx.set(None);
                }
            }
        }

        fn on_stream_cancelled(ctx: Option<*mut c_void>) {
            // SAFETY: ctx points to a S3DownloadStreamWrapper allocated in readable_stream
            let self_: &mut Self = unsafe { &mut *ctx.unwrap().cast::<Self>() };
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
            let self_: &mut Self = unsafe { bun_ptr::callback_ctx::<Self>(opaque_self) };
            let _ = Self::callback(chunk, has_more, err, self_); // TODO: properly propagate exception upwards
        }
    }

    impl Drop for S3DownloadStreamWrapper {
        /// Zig: `fn deinit(self: *@This())`. readable_stream_ref / path are freed by their own field Drop.
        fn drop(&mut self) {
            self.clear_stream_cancel_handler();
        }
    }

    // SAFETY (JSC_BORROW): `global_this` outlives the wrapper (it owns the JS heap that
    // owns the readable stream which keeps the wrapper reachable via cancel_ctx); store as
    // `'static` for the heap-allocated wrapper, matching the Zig pointer field.
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
        readable_stream_ref: ReadableStreamStrong::init(
            ReadableStream {
                ptr: ReadableStreamPtr::Bytes(&raw mut reader_mut.context),
                value: readable_value,
            },
            global_this,
        ),
        path: Box::<[u8]>::from(path),
        global: global_static,
    });

    reader_mut
        .cancel_handler
        .set(Some(S3DownloadStreamWrapper::on_stream_cancelled));
    reader_mut.cancel_ctx.set(Some(wrapper.cast::<c_void>()));

    download_stream(
        this,
        path,
        offset,
        size,
        proxy_url,
        request_payer,
        S3DownloadStreamWrapper::opaque_callback,
        wrapper.cast::<c_void>(),
    );
    Ok(readable_value)
}

// ported from: src/runtime/webcore/s3/client.zig
