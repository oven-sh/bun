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
#[path = "webcore/CookieMap.rs"]
pub mod cookie_map;
#[path = "webcore/Crypto.rs"]
pub mod crypto;
#[path = "webcore/ResumableSink.rs"]
pub mod resumable_sink;
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
pub use bun_jsc::js_error_code::DOMExceptionCode;
pub use bun_jsc::web_worker;
pub use s3_stat::S3Stat;
// `ResumableSink` is the `m_ctx` payload of a JS wrapper; it stores its
// `JSGlobalObject` as a raw pointer (the FFI boundary cannot carry a Rust
// lifetime), so the type aliases are lifetime-free and re-exported directly.
pub use cookie_map::{CookieMap, CookieMapRef};
pub use resumable_sink::{ResumableFetchSink, ResumableS3UploadSink, ResumableSinkBackpressure};
pub use s3_client::S3Client;
pub use streams::{
    H3ResponseSink, HTTPResponseSink, HTTPSResponseSink, HTTPServerWritable, NetworkSink,
};

pub use bun_jsc::object_url_registry;
pub use bun_jsc::object_url_registry::ObjectURLRegistry;

// `node:buffer` `resolveObjectURL`: lives here (not in
// `bun_jsc::object_url_registry`) because wrapping the resolved `Blob` goes
// through `BlobExt::to_js`, which routes S3-backed blobs to `JSS3File`.
#[bun_jsc::host_fn(export = "jsFunctionResolveObjectURL")]
pub(crate) fn js_function_resolve_object_url(
    global_object: &bun_jsc::JSGlobalObject,
    callframe: &bun_jsc::CallFrame,
) -> bun_jsc::JsResult<bun_jsc::JSValue> {
    use bun_jsc::JSValue;
    use bun_jsc::object_url_registry::SPECIFIER_LEN;

    let arguments = callframe.arguments_old::<1>();

    // Errors are ignored.
    // Not thrown.
    // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/blob.js#L441
    if arguments.len < 1 {
        return Ok(JSValue::UNDEFINED);
    }
    // `to_bun_string` returns a +1 ref; wrap in `OwnedString` so every exit
    // path (exception, non-blob prefix, success) releases it.
    let str = bun_core::OwnedString::new(arguments.ptr[0].to_bun_string(global_object)?);

    if global_object.has_exception() {
        return Ok(JSValue::ZERO);
    }

    if !str.has_prefix_comptime(b"blob:") || str.length() < SPECIFIER_LEN {
        return Ok(JSValue::UNDEFINED);
    }

    let slice = str.to_utf8_without_ref();
    let sliced = slice.slice();

    let registry = ObjectURLRegistry::singleton();
    let blob = registry
        .resolve_and_dupe(&sliced[b"blob:".len()..])
        .map(|resolved| {
            let ptr = Blob::new(resolved);
            // SAFETY: `Blob::new` returns a freshly-boxed heap pointer.
            unsafe { BlobExt::to_js(&*ptr, global_object) }
        });
    Ok(blob.unwrap_or(JSValue::UNDEFINED))
}

// Forward the canonical enums so `webcore::node_types::X` names the
// `bun_jsc::node_path` types directly.
pub mod node_types {
    pub use crate::node::types::PathOrBlob;
    pub use bun_jsc::node_path::{PathLike, PathOrFileDescriptor};
}

pub use bun_jsc::AbortSignal;

// ─── AutoFlusher (webcore tier) ──────────────────────────────────────────────
// The lower-tier `bun_event_loop::auto_flusher` takes a `&mut DeferredTaskQueue`
// directly to avoid an event_loop→jsc upward dependency. This tier takes a
// `&VirtualMachine` and reaches the queue via `vm.event_loop().deferred_tasks`.
pub use bun_event_loop::auto_flusher;
use bun_event_loop::deferred_task_queue::DeferredRepeatingTask;

#[derive(Debug, Default)]
pub struct AutoFlusher {
    /// `Cell` so register/unregister can be called from `&self` callbacks
    /// (R-2 §provenance — see `FileSink::on_write`).
    pub registered: core::cell::Cell<bool>,
}

/// Implemented below for `FileSink` and `HTTPServerWritable<_, _>`.
pub trait HasAutoFlusher: Sized {
    fn auto_flusher(&self) -> &AutoFlusher;
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
    fn erased_ctx<T>(this: &T) -> Option<NonNull<core::ffi::c_void>> {
        // Ctx is opaque ptr identity only; `cast_mut()` does not assert write
        // provenance (no `&mut T` formed) — the trampoline recovers `*mut T`
        // and the impl decides how to borrow.
        NonNull::new(
            core::ptr::from_ref::<T>(this)
                .cast_mut()
                .cast::<core::ffi::c_void>(),
        )
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
    pub fn register_deferred_microtask_with_type<T: HasAutoFlusher>(
        this: &T,
        vm: &bun_jsc::virtual_machine::VirtualMachine,
    ) {
        if this.auto_flusher().registered.get() {
            return;
        }
        Self::register_deferred_microtask_with_type_unchecked(this, vm);
    }

    #[inline]
    pub fn unregister_deferred_microtask_with_type<T: HasAutoFlusher>(
        this: &T,
        vm: &bun_jsc::virtual_machine::VirtualMachine,
    ) {
        if !this.auto_flusher().registered.get() {
            return;
        }
        Self::unregister_deferred_microtask_with_type_unchecked(this, vm);
    }

    #[inline]
    pub fn unregister_deferred_microtask_with_type_unchecked<T: HasAutoFlusher>(
        this: &T,
        vm: &bun_jsc::virtual_machine::VirtualMachine,
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
    pub fn register_deferred_microtask_with_type_unchecked<T: HasAutoFlusher>(
        this: &T,
        vm: &bun_jsc::virtual_machine::VirtualMachine,
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
// takes the canonical `*mut FileSink` directly (no `&mut self` — see its doc
// comment / the `borrow = ptr` note on `impl_streaming_writer_parent!`).

impl HasAutoFlusher for file_sink::FileSink {
    #[inline]
    fn auto_flusher(&self) -> &AutoFlusher {
        // R-2: `auto_flusher` is `JsCell`; `JsCell::get` yields `&T`.
        self.auto_flusher.get()
    }
    /// # Safety
    /// See [`HasAutoFlusher::on_auto_flush`].
    unsafe fn on_auto_flush(this: *mut Self) -> bool {
        // SAFETY: `this` was registered as the canonical `*mut FileSink` cast to
        // `*mut c_void` (`AutoFlusher::erased_ctx`); `DeferredTaskQueue::run` is
        // single-threaded (drained on the JS thread after microtasks), so no
        // aliasing across the call. `FileSink::on_auto_flush` takes the raw ptr
        // directly (no `&mut self`).
        unsafe { file_sink::FileSink::on_auto_flush(this) }
    }
}

impl<const SSL: bool, const HTTP3: bool> HasAutoFlusher
    for streams::HTTPServerWritable<SSL, HTTP3>
{
    #[inline]
    fn auto_flusher(&self) -> &AutoFlusher {
        &self.auto_flusher
    }
    /// # Safety
    /// See [`HasAutoFlusher::on_auto_flush`].
    unsafe fn on_auto_flush(this: *mut Self) -> bool {
        // SAFETY: see FileSink impl above.
        unsafe { (*this).on_auto_flush() }
    }
}

#[path = "webcore/headers_ref.rs"]
pub mod headers_ref;

#[path = "webcore/Blob.rs"]
pub mod blob;
pub use blob::Any as AnyBlob;
pub use blob::Internal as InternalBlob;
pub use blob::store::StoreExt as BlobStoreExt;
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
pub use readable_stream::{
    NewSource as ReadableStreamNewSource, ReadableStream, ReadableStreamStrong,
    Source as ReadableStreamSource, SourceContext as ReadableStreamSourceContext,
    Tag as ReadableStreamTag,
};

#[path = "webcore/FileReader.rs"]
pub mod file_reader;
pub use file_reader::FileReader;

#[path = "webcore/Sink.rs"]
pub mod sink;
pub use sink::Sink;

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
pub use bun_jsc::FetchHeaders;

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
pub use form_data::FormData;

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
pub mod s3 {
    pub use bun_s3_signing::MultiPartUploadOptions;
    // Forward the credential / enum stubs so `crate::webcore::s3::{ACL, ...}`
    // resolves for S3Client.rs (its `crate::s3` path is being migrated here).
    pub use super::__s3_list_objects::S3ListObjectsOptions;
    pub use bun_s3_signing::{ACL, S3Credentials, S3CredentialsWithOptions, StorageClass};

    // Note: `client` is the umbrella re-export hub. It pulls in `simple_request`
    // / `download_stream` / `list_objects` / `multipart` transitively.
    pub use super::__s3_client as client;
    pub use super::__s3_credentials_jsc as credentials_jsc;
    pub use super::__s3_download_stream as download_stream;
    pub use super::__s3_list_objects as list_objects;
    pub use super::__s3_multipart as multipart;
    pub use super::__s3_simple_request as simple_request;
    pub use multipart::MultiPartUpload;
}

#[path = "webcore/streams.rs"]
pub mod streams;

pub enum PathOrFileDescriptor {
    Path(bun_core::zig_string::Slice),
    Fd(bun_sys::Fd),
}

#[derive(Default)]
pub struct Pipe {
    pub ctx: Option<NonNull<()>>,
    pub on_pipe: Option<Function>,
}

impl Pipe {
    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.ctx.is_none() && self.on_pipe.is_none()
    }
}

pub type Function = fn(ctx: NonNull<()>, stream: streams::Result);

// Callers implement `PipeHandler` for their type instead of passing a free fn
// (`Wrap::<Foo>::init(self)`).
pub(crate) trait PipeHandler {
    fn on_pipe(&mut self, stream: streams::Result);
}

pub(crate) struct Wrap<T: PipeHandler>(core::marker::PhantomData<T>);

impl<T: PipeHandler> Wrap<T> {
    pub(crate) fn pipe(self_: NonNull<()>, stream: streams::Result) {
        // SAFETY: `self_` was produced from `NonNull::from(&mut T)` in `init` below; caller
        // guarantees the pointee outlives the Pipe and is exclusively borrowed here.
        let this = unsafe { self_.cast::<T>().as_mut() };
        this.on_pipe(stream);
    }

    pub(crate) fn init(self_: &mut T) -> Pipe {
        Pipe {
            ctx: Some(NonNull::from(self_).cast::<()>()),
            on_pipe: Some(Self::pipe),
        }
    }
}

pub enum DrainResult {
    Owned { list: Vec<u8>, size_hint: usize },
    EstimatedSize(usize),
    Empty,
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
