//! Web APIs implemented in Rust live here

use core::ptr::NonNull;

// NOTE(port): the Zig `comptime { _ = @import("./webcore/prompt.zig"); _ = @import("./webcore/TextEncoder.zig"); }`
// force-reference block is dropped — Rust links what's `pub`. (See PORTING.md §Don't translate.)

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

// ─── flat re-exports (mirror Zig `pub const X = @import(...)`) ───────────────
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

#[path = "webcore/ObjectURLRegistry.rs"]
pub mod object_url_registry;
pub use object_url_registry::ObjectURLRegistry;

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

    /// `jsc.Codegen.JS*` — forward the real `js_class_module!`-emitted modules
    /// so any webcore call site that still spells the path
    /// `crate::webcore::jsc::codegen::JS…` resolves to working C++ shims
    /// instead of a no-op stub.
    pub mod codegen {
        pub use crate::jsc::codegen::*;
        pub use bun_jsc::generated::{JSBlob, JSRequest, JSResponse};
        // `JSFileSink` / `JSFileReader` are NOT `.classes.ts`-generated —
        // FileSink uses the JSSink codegen (`FileSink__createObject` /
        // `FileSink__fromJS` in JSSink.cpp) and FileReader uses
        // `source_context_codegen!`; neither flows through `js_class_module!`.
    }
}

// `bun_s3` is not a workspace crate (only `bun_s3_signing`). Webcore drafts
// reference `bun_s3::{S3Credentials, ACL, ...}` for the S3-backed Blob store.
// Forward the real `bun_s3_signing` types so `s3_stub::X` and
// `bun_s3_signing::X` are the *same* type (avoids
// `s3_stub::ACL`-vs-`bun_s3_signing::ACL` mismatches across modules).
// Remaining names without a real definition stay as opaque unit structs.
// TODO(b2-blocked): bun_s3 — replace with real crate once it exists.
pub mod s3_stub {
    macro_rules! opaque { ($($n:ident),* $(,)?) => {$(
        #[derive(Debug, Default)] pub struct $n;
    )*};}
    opaque!(
        S3DeleteResult,
        S3ListObjectsResult,
        S3SimpleRequestResult,
        S3DownloadStreamWrapper,
        S3HttpSimpleTask,
    );
    // Real types now exist upstream — forward them.
    pub use bun_s3_signing::{ACL, S3Credentials, S3CredentialsWithOptions, StorageClass};
    // Real type now exists in webcore/s3/list_objects.rs — forward it so
    // `s3_stub::S3ListObjectsOptions` and `s3::list_objects::S3ListObjectsOptions`
    // are the same type (Store.rs imports via this path).
    pub use crate::webcore::__s3_list_objects::S3ListObjectsOptions;
    pub use crate::webcore::s3::MultiPartUploadOptions;
}

// `crate::node::types` is now un-gated; forward the real enums so
// `webcore::node_types::X` and `crate::node::types::X` are the *same* type.
// The previous local stub definitions caused `expected node_types::PathLike,
// found node::types::PathLike` mismatches across modules.
pub mod node_types {
    pub use crate::node::types::{PathLike, PathOrBlob, PathOrFileDescriptor};
}

pub use crate::jsc::AbortSignal;

// ─── AutoFlusher (webcore tier) ──────────────────────────────────────────────
// `bun.jsc.WebCore.AutoFlusher` — port of `src/event_loop/AutoFlusher.zig`.
//
// The lower-tier `bun_event_loop::auto_flusher` takes a `&mut DeferredTaskQueue`
// directly to avoid an event_loop→jsc upward dependency. This tier restores the
// original Zig signature (`vm: *jsc.VirtualMachine`) and reaches the queue via
// `vm.event_loop().deferred_tasks`, so call sites in `FileSink` /
// `HTTPServerWritable` keep their Zig shape.
pub use bun_event_loop::auto_flusher;
use bun_event_loop::deferred_task_queue::DeferredRepeatingTask;

#[derive(Debug, Default)]
pub struct AutoFlusher {
    /// `Cell` so register/unregister can be called from `&self` callbacks
    /// (R-2 §provenance — see `FileSink::on_write`).
    pub registered: core::cell::Cell<bool>,
}

/// Zig duck-types on `this.auto_flusher` + `Type.onAutoFlush`; modeled as a
/// trait. Implemented below for `FileSink` and `HTTPServerWritable<_, _>`.
pub trait HasAutoFlusher: Sized {
    fn auto_flusher(&self) -> &AutoFlusher;
    /// `Type.onAutoFlush` — `DeferredRepeatingTask` ABI after `@ptrCast`
    /// erasure: `fn(*anyopaque) bool`.
    fn on_auto_flush(this: *mut Self) -> bool;
}

impl AutoFlusher {
    #[inline]
    fn erased_ctx<T>(this: &T) -> Option<NonNull<core::ffi::c_void>> {
        // Ctx is opaque ptr identity only; `cast_mut()` does not assert write
        // provenance (no `&mut T` formed) — the trampoline recovers `*mut T`
        // and the impl decides how to borrow.
        NonNull::new(core::ptr::from_ref::<T>(this).cast_mut().cast::<core::ffi::c_void>())
    }

    #[inline]
    fn erased_cb<T: HasAutoFlusher>() -> DeferredRepeatingTask {
        // Zig `@ptrCast(&Type.onAutoFlush)` — modeled as a monomorphic
        // `extern "C"` trampoline (no fn-ptr transmute across ABIs).
        unsafe extern "C" fn trampoline<T: HasAutoFlusher>(ctx: *mut core::ffi::c_void) -> bool {
            // SAFETY: `ctx` is exactly the `*mut T` registered via
            // `erased_ctx` below; `DeferredTaskQueue::run` feeds it back
            // unchanged.
            <T as HasAutoFlusher>::on_auto_flush(ctx.cast::<T>())
        }
        trampoline::<T>
    }

    #[inline]
    pub fn register_deferred_microtask_with_type<T: HasAutoFlusher>(
        this: &T,
        vm: &jsc::VirtualMachine,
    ) {
        if this.auto_flusher().registered.get() {
            return;
        }
        Self::register_deferred_microtask_with_type_unchecked(this, vm);
    }

    #[inline]
    pub fn unregister_deferred_microtask_with_type<T: HasAutoFlusher>(
        this: &T,
        vm: &jsc::VirtualMachine,
    ) {
        if !this.auto_flusher().registered.get() {
            return;
        }
        Self::unregister_deferred_microtask_with_type_unchecked(this, vm);
    }

    #[inline]
    pub fn unregister_deferred_microtask_with_type_unchecked<T: HasAutoFlusher>(
        this: &T,
        vm: &jsc::VirtualMachine,
    ) {
        debug_assert!(this.auto_flusher().registered.get());
        // PORT NOTE: Zig `bun.assert(expr)` evaluates `expr` unconditionally;
        // only the *check* is debug-gated. Do not wrap the side-effecting call
        // in `debug_assert!`.
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
// takes the canonical `*mut FileSink` directly (no `&mut self` — see its doc
// comment / the `borrow = ptr` note on `impl_streaming_writer_parent!`).

impl HasAutoFlusher for file_sink::FileSink {
    #[inline]
    fn auto_flusher(&self) -> &AutoFlusher {
        // R-2: `auto_flusher` is `JsCell`; `JsCell::get` yields `&T`.
        self.auto_flusher.get()
    }
    fn on_auto_flush(this: *mut Self) -> bool {
        // SAFETY: `this` was registered as the canonical `*mut FileSink` cast to
        // `*mut c_void` (`AutoFlusher::erased_ctx`); `DeferredTaskQueue::run` is
        // single-threaded (drained on the JS thread after microtasks), so no
        // aliasing across the call. `FileSink::on_auto_flush` takes the raw ptr
        // directly (no `&mut self`).
        unsafe { file_sink::FileSink::on_auto_flush(this) }
    }
}

// Gated alongside the `HTTPServerWritable` method bodies (see
// `webcore/streams.rs` ` impl<...> HTTPServerWritable` block) —
// the inherent `on_auto_flush` lives there. Un-gate together.

impl<const SSL: bool, const HTTP3: bool> HasAutoFlusher
    for streams::HTTPServerWritable<SSL, HTTP3>
{
    #[inline]
    fn auto_flusher(&self) -> &AutoFlusher {
        &self.auto_flusher
    }
    fn on_auto_flush(this: *mut Self) -> bool {
        // SAFETY: see FileSink impl above.
        unsafe { (*this).on_auto_flush() }
    }
}

#[path = "webcore/headers_ref.rs"]
pub mod headers_ref;

// ─── un-gated core types (cycle-5: Body/Blob/Response/Request real) ──────────
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

// TODO: make this JSGlobalObject local for better security
// Zig: `bun.ObjectPool(bun.ByteList, null, true, 8)` — `null` init goes on
// `ObjectPoolType` (already impl'd for `Vec<u8>` in bun_collections), `true`
// is THREADSAFE, `8` is MAX_COUNT. `object_pool!` wires the per-monomorphization
// thread-local storage; the bare `ObjectPool<Vec<u8>, true, 8>` alias used to
// default to `UnwiredStorage` and panic on first `get_if_exists()`/`full()`
// from `streams::HTTPSServerWritable::send`.
bun_collections::object_pool!(pub ByteListPool: Vec<u8>, threadsafe, 8);

// ─── compiling submodules ────────────────────────────────────────────────────
// Zig: `pub const FetchHeaders = @import("../jsc/FetchHeaders.zig").FetchHeaders;` (opaque {}).
// Re-export the crate-local jsc shim's opaque type until `bun_jsc::fetch_headers`
// is green; the shim's `#[repr(transparent)] struct FetchHeaders(usize)` matches the
// opaque-handle ABI used by the `WebCore__FetchHeaders__*` extern fns.
// TODO(b2-blocked): bun_jsc::fetch_headers — swap to `pub use bun_jsc::fetch_headers::FetchHeaders;`.
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
pub use form_data::{AsyncFormData, FormData};

#[path = "webcore/ScriptExecutionContext.rs"]
pub mod script_execution_context;

#[doc(hidden)]
#[path = "webcore/s3/multipart_options.rs"]
pub mod multipart_options_impl;
// PORT NOTE: inner `#[path]` inside an inline `mod s3 { }` resolves relative to
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
    pub use super::multipart_options_impl as multipart_options;
    pub use super::multipart_options_impl::MultiPartUploadOptions;
    // Forward the credential / enum stubs so `crate::webcore::s3::{ACL, ...}`
    // resolves for S3Client.rs (its `crate::s3` path is being migrated here).
    // TODO(b2-blocked): replace with real bun_s3 types once that crate exists.
    pub use super::s3_stub::{
        ACL, S3Credentials, S3CredentialsWithOptions, S3DeleteResult, S3DownloadStreamWrapper,
        S3HttpSimpleTask, S3ListObjectsOptions, S3ListObjectsResult, S3SimpleRequestResult,
        StorageClass,
    };

    // PORT NOTE: `client` is the umbrella re-export hub (matches Zig's `s3/client.zig`
    // which `pub const X = @import(...)`-s every sibling). It pulls in `simple_request`
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

// NOTE(port): the Zig `comptime { WebSocketClient.exportAll(); ... }` block forces export of
// `extern "C"` symbols from `src/http/websocket_http_client.zig`. In Rust, those become
// `#[unsafe(no_mangle)] pub extern "C" fn` in `bun_http::websocket_http_client` and need no
// force-reference here. Dropped per PORTING.md §Don't translate.

pub enum PathOrFileDescriptor {
    // PORT NOTE: `jsc.ZigString.Slice` → `bun_core::zig_string::Slice` (= `ZigStringSlice`).
    Path(bun_core::zig_string::Slice),
    Fd(bun_sys::Fd),
}

// NOTE(port): Zig `deinit` only called `this.path.deinit()` for the `.path` arm. In Rust the
// variant payload's `Drop` runs automatically, so no explicit `impl Drop` is needed.

#[derive(Default)]
pub struct Pipe {
    pub ctx: Option<NonNull<()>>,
    pub on_pipe: Option<Function>,
}

impl Pipe {
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.ctx.is_none() && self.on_pipe.is_none()
    }
}

pub type Function = fn(ctx: NonNull<()>, stream: streams::Result);

// TODO(port): Zig `Wrap(comptime Type, comptime function)` takes a *comptime fn pointer* as a
// generic argument, which stable Rust cannot express. Reshaped: callers implement `PipeHandler`
// for their type instead of passing a free fn. Phase B should audit call sites
// (`Wrap(Foo, Foo.onPipe).init(self)` → `Wrap::<Foo>::init(self)`).
pub trait PipeHandler {
    fn on_pipe(&mut self, stream: streams::Result);
}

pub struct Wrap<T: PipeHandler>(core::marker::PhantomData<T>);

impl<T: PipeHandler> Wrap<T> {
    pub fn pipe(self_: NonNull<()>, stream: streams::Result) {
        // SAFETY: `self_` was produced from `NonNull::from(&mut T)` in `init` below; caller
        // guarantees the pointee outlives the Pipe and is exclusively borrowed here.
        let this = unsafe { self_.cast::<T>().as_mut() };
        this.on_pipe(stream);
    }

    pub fn init(self_: &mut T) -> Pipe {
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

// ported from: src/runtime/webcore.zig
