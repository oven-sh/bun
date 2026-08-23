//! Web APIs implemented in Rust live here

use core::ptr::NonNull;

// ─── submodules under ./webcore/ ─────────────────────────────────────────────
// `#[path]` is relative to the dir containing this file (`src/runtime/`).

#[path = "webcore/ArrayBufferSink.rs"]
pub mod array_buffer_sink;
#[path = "webcore/BakeResponse.rs"]
pub mod bake_response;
#[path = "webcore/ByteBlobLoader.rs"]
pub mod byte_blob_loader;
#[path = "webcore/ByteStream.rs"]
pub mod byte_stream;
#[path = "webcore/CompressionStreamCoder.rs"]
pub mod compression_stream_coder;
#[path = "webcore/CookieMap.rs"]
pub mod cookie_map;
#[path = "webcore/Crypto.rs"]
pub mod crypto;
#[path = "webcore/S3Client.rs"]
pub mod s3_client;
#[path = "webcore/S3File.rs"]
pub mod s3_file;
#[path = "webcore/S3Stat.rs"]
pub mod s3_stat;
#[path = "webcore/TextEncoder.rs"]
pub mod text_encoder;
#[path = "webcore/TextEncoderStreamEncoder.rs"]
pub mod text_encoder_stream_encoder;

// ─── flat re-exports ─────────────────────────────────────────────────────────
pub use cookie_map::{CookieMap, CookieMapRef};
pub use s3_client::S3Client;
pub use s3_stat::S3Stat;

#[path = "webcore/ObjectURLRegistry.rs"]
pub mod object_url_registry;
pub(crate) use object_url_registry::ObjectURLRegistry;

// ─── webcore-local jsc re-export ─────────────────────────────────────────────
// `bun_jsc` is now a dep of `bun_runtime`; forward to it. The per-class
// submodules (`JSBlob`, `JSResponse`, …) live in `bun_jsc::generated`
// (`js_class_module!`); the previous local stub macro (`js_class_mod`) that
// returned `JSValue::default()` from `to_js_unchecked` has been removed —
// every webcore caller now imports the real bindings directly
// (`bun_jsc::generated::JS{Blob,Request,Response,…}`).
pub mod jsc {
    pub use crate::jsc::*;
    pub use bun_jsc::virtual_machine::VirtualMachine;
}

// Forward the real enums so `webcore::node_types::X` and
// `crate::node::types::X` are the same type.
pub mod node_types {
    pub use crate::node::types::{PathLike, PathOrBlob, PathOrFileDescriptor};
}

pub use crate::jsc::AbortSignal;

// ─── AutoFlusher (webcore tier) ──────────────────────────────────────────────
// Takes a `&VirtualMachine` and reaches the queue via
// `vm.event_loop().deferred_tasks`.
use bun_event_loop::deferred_task_queue::DeferredRepeatingTask;

#[derive(Debug, Default)]
pub struct AutoFlusher {
    /// `Cell` so register/unregister can be called from `&self` callbacks
    /// (R-2 §provenance — see `FileSink::on_write`).
    pub(crate) registered: core::cell::Cell<bool>,
}

/// Implemented below for `FileSink` and `HTTPServerWritable<_, _>`, and by
/// `ValkeyClient`.
pub trait HasAutoFlusher: Sized {
    fn auto_flusher(&self) -> &AutoFlusher;
    /// The pointer registered with the deferred-task queue and handed back to
    /// [`on_auto_flush`](Self::on_auto_flush): the implementor's root
    /// (allocation-provenance) pointer if `on_auto_flush` may release the
    /// allocation, else `self`'s address (what the queue always used) will do.
    fn auto_flush_ctx(&self) -> *mut Self;
    /// `Type.onAutoFlush` — `DeferredRepeatingTask` ABI after `@ptrCast`
    /// erasure: `fn(*anyopaque) bool`.
    ///
    /// # Safety
    /// `this` must be the same pointer that was registered via
    /// [`AutoFlusher::erased_ctx`] (i.e. a valid, live `*mut Self`), and the
    /// call must occur on the JS thread with no aliasing `&mut Self`.
    unsafe fn on_auto_flush(this: *mut Self) -> bool;
}

impl AutoFlusher {
    #[inline]
    fn erased_ctx<T: HasAutoFlusher>(this: &T) -> Option<NonNull<core::ffi::c_void>> {
        // The trampoline recovers `*mut T` from this and the impl decides how
        // to borrow (see `HasAutoFlusher::auto_flush_ctx`).
        NonNull::new(this.auto_flush_ctx().cast::<core::ffi::c_void>())
    }

    #[inline]
    fn erased_cb<T: HasAutoFlusher>() -> DeferredRepeatingTask {
        // A monomorphic `extern "C"` trampoline (no fn-ptr transmute across ABIs).
        unsafe extern "C" fn trampoline<T: HasAutoFlusher>(ctx: *mut core::ffi::c_void) -> bool {
            // SAFETY: `ctx` is exactly the `*mut T` registered via
            // `erased_ctx` below; `DeferredTaskQueue::run` feeds it back
            // unchanged.
            unsafe { <T as HasAutoFlusher>::on_auto_flush(ctx.cast::<T>()) }
        }
        trampoline::<T>
    }

    #[inline]
    pub(crate) fn register_deferred_microtask_with_type<T: HasAutoFlusher>(
        this: &T,
        vm: &jsc::VirtualMachine,
    ) {
        if this.auto_flusher().registered.get() {
            return;
        }
        Self::register_deferred_microtask_with_type_unchecked(this, vm);
    }

    #[inline]
    pub(crate) fn unregister_deferred_microtask_with_type<T: HasAutoFlusher>(
        this: &T,
        vm: &jsc::VirtualMachine,
    ) {
        if !this.auto_flusher().registered.get() {
            return;
        }
        Self::unregister_deferred_microtask_with_type_unchecked(this, vm);
    }

    #[inline]
    pub(crate) fn unregister_deferred_microtask_with_type_unchecked<T: HasAutoFlusher>(
        this: &T,
        vm: &jsc::VirtualMachine,
    ) {
        debug_assert!(this.auto_flusher().registered.get());
        // Do not wrap the side-effecting call in `debug_assert!`;
        // only the *check* is debug-gated.
        let removed = vm
            .event_loop_ref()
            .deferred_tasks
            .unregister_task(Self::erased_ctx(this));
        debug_assert!(removed);
        this.auto_flusher().registered.set(false);
    }

    #[inline]
    pub(crate) fn register_deferred_microtask_with_type_unchecked<T: HasAutoFlusher>(
        this: &T,
        vm: &jsc::VirtualMachine,
    ) {
        debug_assert!(!this.auto_flusher().registered.get());
        this.auto_flusher().registered.set(true);
        let found_existing = vm
            .event_loop_ref()
            .deferred_tasks
            .post_task(Self::erased_ctx(this), Self::erased_cb::<T>());
        debug_assert!(!found_existing);
    }
}

// ─── HasAutoFlusher impls ────────────────────────────────────────────────────
// `HTTPServerWritable` exposes an inherent `pub fn on_auto_flush(&mut self) ->
// bool`; the trait impl is just a thunk. `FileSink::on_auto_flush` instead
// takes a `ThisPtr<FileSink>` (no `&mut self` — see its doc comment / the
// `borrow = this` note on `impl_streaming_writer_parent!`).

impl HasAutoFlusher for file_sink::FileSink {
    #[inline]
    fn auto_flusher(&self) -> &AutoFlusher {
        // R-2: `auto_flusher` is `JsCell`; `JsCell::get` yields `&T`.
        self.auto_flusher.get()
    }
    #[inline]
    fn auto_flush_ctx(&self) -> *mut Self {
        self.this_ptr().as_ptr()
    }
    /// # Safety
    /// See [`HasAutoFlusher::on_auto_flush`].
    unsafe fn on_auto_flush(this: *mut Self) -> bool {
        // SAFETY: `this` is the sink's root pointer (`auto_flush_ctx`),
        // registered while live and unregistered before the sink is dropped;
        // `DeferredTaskQueue::run` is single-threaded (drained on the JS
        // thread after microtasks), so no aliasing across the call.
        file_sink::FileSink::on_auto_flush(unsafe { bun_ptr::ThisPtr::new(this) })
    }
}

impl<const SSL: bool> HasAutoFlusher for streams::HTTPServerWritable<SSL> {
    #[inline]
    fn auto_flusher(&self) -> &AutoFlusher {
        &self.auto_flusher
    }
    #[inline]
    fn auto_flush_ctx(&self) -> *mut Self {
        // Registered from the `&mut self` its RequestContext drives it through;
        // `on_auto_flush` never frees the sink (its RequestContext does).
        core::ptr::from_ref(self).cast_mut()
    }
    /// # Safety
    /// See [`HasAutoFlusher::on_auto_flush`].
    unsafe fn on_auto_flush(this: *mut Self) -> bool {
        // SAFETY: `this` is the live sink registered via `auto_flush_ctx` and
        // unregistered before it is destroyed; `DeferredTaskQueue::run` is
        // single-threaded, so no other borrow of it is live across the call.
        unsafe { (*this).on_auto_flush() }
    }
}

#[path = "webcore/headers_ref.rs"]
pub(crate) mod headers_ref;

#[path = "webcore/Blob.rs"]
pub mod blob;
pub use blob::Any as AnyBlob;
pub use blob::Internal as InternalBlob;
pub use blob::{Blob, BlobExt, SizeType as BlobSizeType};

#[path = "webcore/Body.rs"]
pub mod body;
pub use body::{Body, Value as BodyValue};

#[path = "webcore/Response.rs"]
pub mod response;
pub use response::Response;

#[path = "webcore/Request.rs"]
pub mod request;
pub use request::Request;

#[path = "webcore/ReadableStream.rs"]
pub mod readable_stream;
pub use readable_stream::ReadableStream;

#[path = "webcore/FileReader.rs"]
pub mod file_reader;
pub use file_reader::FileReader;

#[path = "webcore/Sink.rs"]
pub mod sink;

#[path = "webcore/FileSink.rs"]
pub mod file_sink;
pub use file_sink::FileSink;

// ByteStream/ByteBlobLoader: real bodies now live in webcore/ByteStream.rs and
// webcore/ByteBlobLoader.rs (declared above). Re-export the struct types here.
pub use byte_blob_loader::ByteBlobLoader;
pub use byte_stream::ByteStream;

// TODO: make this pool per-JSGlobalObject so recycled buffers are not shared
// across realms (the pool is process-global).
// `object_pool!` wires the per-monomorphization
// thread-local storage; the bare `ObjectPool<Vec<u8>, true, 8>` alias used to
// default to `UnwiredStorage` and panic on first `get_if_exists()`/`full()`
// from `streams::HTTPSServerWritable::send`.
bun_collections::object_pool!(pub ByteListPool: Vec<u8>, threadsafe, 8);

// ─── compiling submodules ────────────────────────────────────────────────────
// Re-export the crate-local jsc shim's opaque type until `bun_jsc::fetch_headers`
// is green; the shim's `#[repr(transparent)] struct FetchHeaders(usize)` matches the
// opaque-handle ABI used by the `WebCore__FetchHeaders__*` extern fns.
pub use crate::jsc::FetchHeaders;

#[path = "webcore/EncodingLabel.rs"]
pub mod encoding_label;
pub use encoding_label::EncodingLabel;

#[path = "webcore/encoding.rs"]
pub mod encoding;

#[path = "webcore/wasm_streaming.rs"]
pub mod wasm_streaming;

#[path = "webcore/TextDecoder.rs"]
pub mod text_decoder;
pub use text_decoder::TextDecoder;

#[path = "webcore/fetch.rs"]
pub mod fetch;

#[path = "webcore/prompt.rs"]
pub mod prompt;

#[path = "webcore/FormData.rs"]
pub mod form_data;

#[path = "webcore/ScriptExecutionContext.rs"]
pub mod script_execution_context;

#[doc(hidden)]
pub mod multipart_options_impl {
    pub use bun_s3_signing::MultiPartUploadOptions;
}
// Note: inner `#[path]` inside an inline `mod s3 { }` resolves relative to
// `<this-file's-dir>/s3/`, which would point at `src/runtime/s3/...` (does not
// exist). Declare the file mods at this level (where `#[path]` is relative to
// `src/runtime/`) and re-export them under `s3`.
#[doc(hidden)]
#[path = "webcore/s3/client.rs"]
pub mod __s3_client;
#[doc(hidden)]
#[path = "webcore/s3/credentials_jsc.rs"]
pub mod __s3_credentials_jsc;
#[doc(hidden)]
#[path = "webcore/s3/download_stream.rs"]
pub mod __s3_download_stream;
#[doc(hidden)]
#[path = "webcore/s3/list_objects.rs"]
pub mod __s3_list_objects;
#[doc(hidden)]
#[path = "webcore/s3/multipart.rs"]
pub mod __s3_multipart;
#[doc(hidden)]
#[path = "webcore/s3/simple_request.rs"]
pub mod __s3_simple_request;
#[doc(hidden)]
#[path = "webcore/s3/xml_response.rs"]
pub mod __s3_xml_response;
pub mod s3 {
    pub use super::multipart_options_impl as multipart_options;
    pub use super::multipart_options_impl::MultiPartUploadOptions;

    // Note: `client` is the umbrella re-export hub. It pulls in `simple_request`
    // / `download_stream` / `list_objects` / `multipart` transitively.
    pub use super::__s3_client as client;
    pub use super::__s3_credentials_jsc as credentials_jsc;
    pub use super::__s3_download_stream as download_stream;
    pub use super::__s3_list_objects as list_objects;
    pub use super::__s3_multipart as multipart;
    pub use super::__s3_simple_request as simple_request;
    pub(crate) use super::__s3_xml_response as xml_response;
    pub use multipart::MultiPartUpload;
}

#[path = "webcore/streams.rs"]
pub mod streams;

pub enum PathOrFileDescriptor {
    Path(bun_core::Utf8Bytes<'static>),
    Fd(bun_sys::Fd),
}

// ─── SinkHandle ──────────────────────────────────────────────────────────────
// Held by ByteStream; dispatches write()/end() to the native sink.

#[derive(Copy, Clone, Default)]
pub enum SinkHandle {
    #[default]
    None,
    ServerResponse(crate::server::AnyRequestContext),
    FetchRequestBody(bun_ptr::BackRef<fetch::FetchRequestBodySink, bun_ptr::Mut>),
    S3Upload(bun_ptr::BackRef<streams::NetworkSink, bun_ptr::Mut>),
    FileSink(bun_ptr::BackRef<file_sink::FileSink>),
    HTMLRewriter(bun_ptr::BackRef<crate::api::html_rewriter::RewriterPipe>),
    HttpResponse(bun_ptr::BackRef<streams::HTTPResponseSink, bun_ptr::Mut>),
    HttpsResponse(bun_ptr::BackRef<streams::HTTPSResponseSink, bun_ptr::Mut>),
    ArrayBuffer(bun_ptr::BackRef<sink::ArrayBufferSink, bun_ptr::Mut>),
}

impl SinkHandle {
    #[inline]
    pub fn is_none(&self) -> bool {
        matches!(self, SinkHandle::None)
    }

    #[inline]
    pub fn is_some(&self) -> bool {
        !self.is_none()
    }

    /// SAFETY: every non-None variant's pointee is kept alive by the hook-in site for as long
    /// as this handle is installed.
    pub fn write(&self, data: &streams::Result) -> streams::Writable {
        match *self {
            SinkHandle::None => streams::Writable::Done,
            SinkHandle::ServerResponse(any) => any.write_chunk(data),
            // SAFETY: live backref; ByteStream clears sink before free.
            SinkHandle::FetchRequestBody(mut p) => unsafe { p.get_mut() }.write(data),
            // SAFETY: live backref; ByteStream clears sink before free.
            SinkHandle::S3Upload(mut p) => unsafe { p.get_mut() }.write(data),
            SinkHandle::FileSink(p) => p.write(data),
            SinkHandle::HTMLRewriter(p) => p.write(data),
            // SAFETY: live backref; transform detaches before the JSSink is finalized.
            SinkHandle::HttpResponse(mut p) => unsafe { p.get_mut() }.write(data),
            // SAFETY: live backref; transform detaches before the JSSink is finalized.
            SinkHandle::HttpsResponse(mut p) => unsafe { p.get_mut() }.write(data),
            // SAFETY: live backref; transform detaches before the JSSink is finalized.
            SinkHandle::ArrayBuffer(mut p) => unsafe { p.get_mut() }.write(data),
        }
    }

    /// Signal end-of-stream (or terminal error) to the attached sink.
    ///
    /// SAFETY: same pointee-liveness invariant as [`Self::write`].
    pub fn end(&self, err: Option<streams::StreamError>) {
        match *self {
            SinkHandle::None => {}
            SinkHandle::ServerResponse(any) => any.end_chunk(err.as_ref()),
            // SAFETY: live backref; ByteStream clears sink before free.
            SinkHandle::FetchRequestBody(mut p) => unsafe { p.get_mut() }.end_from_stream(err),
            // Raw-ptr dispatch: may re-borrow and free the sink (see its doc).
            SinkHandle::S3Upload(p) => streams::NetworkSink::end_from_stream(p.as_ptr(), err),
            SinkHandle::FileSink(p) => p.end_from_stream(err),
            SinkHandle::HTMLRewriter(p) => p.end_from_stream(err),
            SinkHandle::HttpResponse(_) => {}
            SinkHandle::HttpsResponse(_) => {}
            SinkHandle::ArrayBuffer(_) => {}
        }
    }
}

pub enum DrainResult {
    Owned { list: Vec<u8>, size_hint: usize },
    EstimatedSize(usize),
    Aborted,
}

#[derive(Copy, Clone, Eq, PartialEq, core::marker::ConstParamTy)]
pub enum Lifetime {
    Clone,
    Transfer,
    Share,
    /// When reading from a fifo like STDIN/STDERR
    Temporary,
}
