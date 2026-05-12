use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::NonNull;

use crate::webcore::jsc::SysErrorJsc as _;
use crate::webcore::jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult};
// `bun_jsc` not yet a dep; alias to local shim so `bun_jsc::Strong` etc. resolve.
use crate::webcore::jsc as bun_jsc;
use bun_collections::{ByteVecExt, VecExt};
use bun_sys as syscall;

use crate::webcore::streams;
#[allow(unused_imports)]
use crate::webcore::{self, Blob, ByteBlobLoader, ByteStream, FileReader};

#[derive(Copy, Clone)]
pub struct ReadableStream {
    pub value: JSValue,
    pub ptr: Source,
}

// ─── ReadableStream::Strong ──────────────────────────────────────────────────

pub struct Strong {
    held: bun_jsc::strong::Optional, // jsc.Strong.Optional = .empty
}

/// Re-export under the qualified name callers expect (Zig: `webcore.ReadableStream.Strong`).
pub type ReadableStreamStrong = Strong;

impl Default for Strong {
    fn default() -> Self {
        Self {
            held: bun_jsc::strong::Optional::empty(),
        }
    }
}

impl Strong {
    pub fn has(&mut self) -> bool {
        self.held.has()
    }

    /// Debug-only raw handle pointer for corruption probes (#53265).
    #[doc(hidden)]
    #[inline]
    pub fn held_handle_ptr(&self) -> *const () {
        self.held.handle_ptr()
    }

    pub fn is_disturbed(&self, global: &JSGlobalObject) -> bool {
        if let Some(stream) = self.get(global) {
            return stream.is_disturbed(global);
        }
        false
    }

    pub fn init(this: ReadableStream, global: &JSGlobalObject) -> Strong {
        Strong {
            held: bun_jsc::strong::Optional::create(this.value, global),
        }
    }

    pub fn deinit(&mut self) {
        self.held.deinit();
    }

    pub fn get(&self, global: &JSGlobalObject) -> Option<ReadableStream> {
        if let Some(value) = self.held.get() {
            // TODO: properly propagate exception upwards
            return ReadableStream::from_js(value, global).ok().flatten();
        }
        None
    }

    // deinit: body only calls held.deinit() → handled by Drop on bun_jsc::Strong.
    // Commented-out Zig:
    //   if (this.held.get()) |val| { ReadableStream__detach(val, this.held.globalThis.?); }

    pub fn tee(&mut self, global: &JSGlobalObject) -> JsResult<Option<ReadableStream>> {
        if let Some(stream) = self.get(global) {
            let Some((first, second)) = stream.tee(global)? else {
                return Ok(None);
            };
            self.held.set(global, first.value);
            return Ok(Some(second));
        }
        Ok(None)
    }
}

// ─── extern fns ──────────────────────────────────────────────────────────────
// TODO(port): move to runtime_sys / bun_jsc_sys

unsafe extern "C" {
    /// C++ writes the two teed-stream JSValues into the out-params; reference
    /// params encode the non-null/aligned precondition so callers need no
    /// `unsafe` block.
    safe fn ReadableStream__tee(
        stream: JSValue,
        global_this: &JSGlobalObject,
        out1: &mut JSValue,
        out2: &mut JSValue,
    ) -> bool;
    /// `possible_readable_stream` is read+overwritten in place; `ptr` is a
    /// stack out-param. Reference params discharge the only preconditions.
    safe fn ReadableStreamTag__tagged(
        global_object: &JSGlobalObject,
        possible_readable_stream: &mut JSValue,
        ptr: &mut *mut c_void,
    ) -> Tag;
    safe fn ReadableStream__isDisturbed(
        possible_readable_stream: JSValue,
        global_object: &JSGlobalObject,
    ) -> bool;
    safe fn ReadableStream__isLocked(
        possible_readable_stream: JSValue,
        global_object: &JSGlobalObject,
    ) -> bool;
    safe fn ReadableStream__empty(global: &JSGlobalObject) -> JSValue;
    safe fn ReadableStream__used(global: &JSGlobalObject) -> JSValue;
    safe fn ReadableStream__cancel(stream: JSValue, global: &JSGlobalObject);
    safe fn ReadableStream__cancelWithReason(
        stream: JSValue,
        global: &JSGlobalObject,
        reason: JSValue,
    );
    safe fn ReadableStream__abort(stream: JSValue, global: &JSGlobalObject);
    safe fn ReadableStream__detach(stream: JSValue, global: &JSGlobalObject);
    safe fn ZigGlobalObject__createNativeReadableStream(
        global: &JSGlobalObject,
        native_ptr: JSValue,
    ) -> JSValue;
}

// ─── ReadableStream methods ──────────────────────────────────────────────────
impl ReadableStream {
    pub fn tee(
        &self,
        global_this: &JSGlobalObject,
    ) -> JsResult<Option<(ReadableStream, ReadableStream)>> {
        let mut out1 = JSValue::ZERO;
        let mut out2 = JSValue::ZERO;
        let ok = bun_jsc::from_js_host_call_generic(global_this, || {
            ReadableStream__tee(self.value, global_this, &mut out1, &mut out2)
        })?;
        if !ok {
            return Ok(None);
        }
        let Some(out_stream2) = ReadableStream::from_js(out2, global_this)? else {
            return Ok(None);
        };
        let Some(out_stream1) = ReadableStream::from_js(out1, global_this)? else {
            return Ok(None);
        };
        Ok(Some((out_stream1, out_stream2)))
    }

    pub fn to_js(&self) -> JSValue {
        self.value
    }

    pub fn reload_tag(&mut self, global_this: &JSGlobalObject) -> JsResult<()> {
        if let Some(stream) = ReadableStream::from_js(self.value, global_this)? {
            *self = stream;
        } else {
            *self = ReadableStream {
                ptr: Source::Invalid,
                value: JSValue::ZERO,
            };
        }
        Ok(())
    }

    pub fn to_any_blob(&mut self, global_this: &JSGlobalObject) -> Option<webcore::blob::Any> {
        if self.is_disturbed(global_this) {
            return None;
        }

        // TODO: properly propagate exception upwards
        let _ = self.reload_tag(global_this);

        match self.ptr {
            Source::Blob(blobby) => {
                // SAFETY: ptr came from ReadableStreamTag__tagged; valid while stream alive.
                let blobby = unsafe { &mut *blobby };
                if let Some(blob) = blobby.to_any_blob(global_this) {
                    self.done(global_this);
                    return Some(blob);
                }
            }
            Source::File(_) => {
                // BACKREF: see `Source::file()` — payload valid while stream alive.
                // R-2: `lazy`/`started` are `JsCell`/`Cell`; shared borrow suffices.
                let blobby = self.ptr.file().expect("matched File");
                if let webcore::file_reader::Lazy::Blob(store) = blobby.lazy.get() {
                    // `store.clone()` carries the +1 that Zig's explicit `blob.store.?.ref()`
                    // provided after the raw-pointer copy in `initWithStore`.
                    let blob = Blob::init_with_store(store.clone(), global_this);
                    // it should be lazy, file shouldn't have opened yet.
                    debug_assert!(!blobby.started.get());
                    self.done(global_this);
                    return Some(webcore::blob::Any::Blob(blob));
                }
            }
            Source::Bytes(_) => {
                // BACKREF: see `Source::bytes()` — payload valid while stream alive.
                let bytes = self.ptr.bytes().expect("matched Bytes");
                // If we've received the complete body by the time this function is called
                // we can avoid streaming it and convert it to a Blob
                if let Some(blob) = bytes.to_any_blob() {
                    self.done(global_this);
                    return Some(blob);
                }
                return None;
            }
            _ => {}
        }

        None
    }

    pub fn done(&self, global_this: &JSGlobalObject) {
        // done is called when we are done consuming the stream
        // cancel actually mark the stream source as done
        // this will resolve any pending promises to done: true
        match self.ptr {
            // SAFETY: ptrs came from ReadableStreamTag__tagged; valid while stream alive.
            Source::Blob(source) => unsafe { (*(*source).parent()).cancel() },
            Source::File(source) => unsafe { (*(*source).parent()).cancel() },
            Source::Bytes(source) => unsafe { (*(*source).parent()).cancel() },
            _ => {}
        }
        self.detach_if_possible(global_this);
    }

    pub fn cancel(&self, global_this: &JSGlobalObject) {
        // cancel the stream
        // SAFETY: FFI call; value is a valid ReadableStream JSValue.
        ReadableStream__cancel(self.value, global_this);
        // mark the stream source as done
        self.done(global_this);
    }

    /// Cancel the stream and forward `reason` verbatim to the underlying source's
    /// cancel algorithm (the spec's ReadableStreamCancel). Unlike `cancel()`,
    /// this does not synthesize a DOMException — fetch() uses it to surface
    /// `AbortSignal.reason` to the request body's cancel callback.
    pub fn cancel_with_reason(&self, global_this: &JSGlobalObject, reason: JSValue) {
        // SAFETY: FFI call; value is a valid ReadableStream JSValue.
        ReadableStream__cancelWithReason(self.value, global_this, reason);
        self.done(global_this);
    }

    pub fn abort(&self, global_this: &JSGlobalObject) {
        // for now we are just calling cancel should be fine
        self.cancel(global_this);
    }

    pub fn force_detach(&self, global_object: &JSGlobalObject) {
        // SAFETY: FFI call; value is a valid ReadableStream JSValue.
        ReadableStream__detach(self.value, global_object);
    }

    /// Decrement Source ref count and detach the underlying stream if ref count is zero
    /// be careful, this can invalidate the stream do not call this multiple times
    /// this is meant to be called only once when we are done consuming the stream or from the ReadableStream.Strong.deinit
    pub fn detach_if_possible(&self, _global: &JSGlobalObject) {
        // (intentionally empty in Zig)
    }

    pub fn is_disturbed(&self, global_object: &JSGlobalObject) -> bool {
        is_disturbed_value(self.value, global_object)
    }

    pub fn is_locked(&self, global_object: &JSGlobalObject) -> bool {
        // SAFETY: FFI call; value is a valid ReadableStream JSValue.
        ReadableStream__isLocked(self.value, global_object)
    }

    pub fn from_js(
        value: JSValue,
        global_this: &JSGlobalObject,
    ) -> JsResult<Option<ReadableStream>> {
        value.ensure_still_alive();
        let mut out = value;
        let mut ptr: *mut c_void = core::ptr::null_mut();

        let tag = bun_jsc::from_js_host_call_generic(global_this, || {
            ReadableStreamTag__tagged(global_this, &mut out, &mut ptr)
        })?;

        Ok(match tag {
            Tag::JavaScript => Some(ReadableStream {
                value: out,
                ptr: Source::JavaScript,
            }),
            Tag::Blob => Some(ReadableStream {
                value: out,
                // SAFETY: tag == Blob ⇒ ptr is a non-null *ByteBlobLoader from C++.
                ptr: Source::Blob(ptr.cast::<ByteBlobLoader>()),
            }),
            Tag::File => Some(ReadableStream {
                value: out,
                // SAFETY: tag == File ⇒ ptr is a non-null *FileReader from C++.
                ptr: Source::File(ptr.cast::<FileReader>()),
            }),
            Tag::Bytes => Some(ReadableStream {
                value: out,
                // SAFETY: tag == Bytes ⇒ ptr is a non-null *ByteStream from C++.
                ptr: Source::Bytes(ptr.cast::<ByteStream>()),
            }),
            // .HTTPRequest / .HTTPSRequest commented out in Zig
            _ => None,
        })
    }

    pub fn from_native(global_this: &JSGlobalObject, native: JSValue) -> JsResult<JSValue> {
        bun_jsc::from_js_host_call(global_this, || {
            ZigGlobalObject__createNativeReadableStream(global_this, native)
        })
    }

    pub fn from_owned_slice(
        global_this: &JSGlobalObject,
        // Zig: `bytes: []u8` — owned slice; accept Vec<u8> / Box<[u8]> alike.
        bytes: impl Into<Vec<u8>>,
        recommended_chunk_size: webcore::blob::SizeType,
    ) -> JsResult<JSValue> {
        let blob = Blob::init(bytes.into(), global_this);
        // defer blob.deinit() → handled by Drop
        Self::from_blob_copy_ref(global_this, &blob, recommended_chunk_size)
    }

    pub fn from_blob_copy_ref(
        global_this: &JSGlobalObject,
        blob: &Blob,
        recommended_chunk_size: webcore::blob::SizeType,
    ) -> JsResult<JSValue> {
        let Some(store) = blob.store.get() else {
            return ReadableStream::empty(global_this);
        };
        match &store.data {
            webcore::blob::store::Data::Bytes(_) => {
                // PORT NOTE: Zig left `context: undefined` then called `setup()` to initialize
                // in place. Rust constructs with `Default` (no UB) and `setup()` overwrites
                // the entire struct via `*self = ByteBlobLoader { ... }`.
                let reader = NewSource::<ByteBlobLoader>::new_mut(NewSource {
                    global_this: Some(bun_ptr::BackRef::new(global_this)),
                    context: ByteBlobLoader::default(),
                    ..Default::default()
                });
                reader.context.setup(blob, recommended_chunk_size);
                reader.to_readable_stream(global_this)
            }
            webcore::blob::store::Data::File(_) => {
                let reader = NewSource::<FileReader>::new_mut(NewSource {
                    global_this: Some(bun_ptr::BackRef::new(global_this)),
                    context: FileReader {
                        // SAFETY: bun_vm() returns a non-null *mut VirtualMachine; event_loop()
                        // returns a non-null *mut EventLoop. Both outlive this call.
                        event_loop: core::cell::Cell::new(jsc::EventLoopHandle::init(
                            global_this.bun_vm().as_mut().event_loop().cast(),
                        )),
                        start_offset: Some(blob.offset.get() as usize),
                        max_size: if blob.size.get() != webcore::blob::MAX_SIZE {
                            Some(blob.size.get() as usize)
                        } else {
                            None
                        },
                        // `store.clone()` is the RAII +1 equivalent of Zig's `store.ref()`
                        // after the raw `.lazy = .{ .blob = store }` assignment.
                        lazy: bun_jsc::JsCell::new(webcore::file_reader::Lazy::Blob(store.clone())),
                        ..Default::default()
                    },
                    ..Default::default()
                });
                reader.to_readable_stream(global_this)
            }
            webcore::blob::store::Data::S3(s3) => {
                let credentials = s3.get_credentials();
                let path = s3.path();
                // `Transpiler::env_mut` is the safe accessor for the
                // process-singleton dotenv loader (set during init).
                let proxy = global_this
                    .bun_vm()
                    .as_mut()
                    .transpiler
                    .env_mut()
                    .get_http_proxy(true, None, None);
                let proxy_url = proxy.as_ref().map(|p| p.href);

                crate::webcore::s3::client::readable_stream(
                    credentials,
                    path,
                    blob.offset.get() as usize,
                    if blob.size.get() != webcore::blob::MAX_SIZE {
                        Some(blob.size.get() as usize)
                    } else {
                        None
                    },
                    proxy_url,
                    s3.request_payer,
                    global_this,
                )
            }
        }
    }

    pub fn from_file_blob_with_offset(
        global_this: &JSGlobalObject,
        blob: &Blob,
        offset: usize,
    ) -> JsResult<JSValue> {
        let Some(store) = blob.store.get() else {
            return ReadableStream::empty(global_this);
        };
        match &store.data {
            webcore::blob::store::Data::File(_) => {
                let reader = NewSource::<FileReader>::new_mut(NewSource {
                    global_this: Some(bun_ptr::BackRef::new(global_this)),
                    context: FileReader {
                        // SAFETY: bun_vm()/event_loop() return non-null ptrs that outlive this call.
                        event_loop: core::cell::Cell::new(jsc::EventLoopHandle::init(
                            global_this.bun_vm().as_mut().event_loop().cast(),
                        )),
                        start_offset: Some(offset),
                        // `store.clone()` is the RAII +1 equivalent of Zig's `store.ref()`.
                        lazy: bun_jsc::JsCell::new(webcore::file_reader::Lazy::Blob(store.clone())),
                        ..Default::default()
                    },
                    ..Default::default()
                });
                reader.to_readable_stream(global_this)
            }
            _ => Err(global_this.throw(format_args!("Expected FileBlob"))),
        }
    }

    pub fn from_pipe<P>(
        global_this: &JSGlobalObject,
        _parent: P,
        buffered_reader: &mut bun_io::BufferedReader,
    ) -> JsResult<JSValue> {
        // TODO(port): Zig's `buffered_reader: anytype` — only ever instantiated with the
        // platform `PipeReader`/`PosixBufferedReader`.
        let source = NewSource::<FileReader>::new_mut(NewSource {
            global_this: Some(bun_ptr::BackRef::new(global_this)),
            context: FileReader {
                // SAFETY: bun_vm()/event_loop() return non-null ptrs that outlive this call.
                event_loop: core::cell::Cell::new(jsc::EventLoopHandle::init(
                    global_this.bun_vm().as_mut().event_loop().cast(),
                )),
                ..Default::default()
            },
            ..Default::default()
        });
        // PORT NOTE: reshaped for borrowck — Zig passed `&source.context` as both reader-parent and self.
        let ctx_ptr: *mut FileReader = &raw mut source.context;
        source
            .context
            .reader()
            .from(buffered_reader, ctx_ptr.cast::<c_void>());

        source.to_readable_stream(global_this)
    }

    pub fn empty(global_this: &JSGlobalObject) -> JsResult<JSValue> {
        // TODO(port): bun.cpp.ReadableStream__empty wraps the extern with exception check
        bun_jsc::from_js_host_call(global_this, || {
            // SAFETY: FFI call into JSC bindings; global_this is a valid &JSGlobalObject.
            ReadableStream__empty(global_this)
        })
    }

    pub fn used(global_this: &JSGlobalObject) -> JsResult<JSValue> {
        // TODO(port): bun.cpp.ReadableStream__used wraps the extern with exception check
        bun_jsc::from_js_host_call(global_this, || {
            // SAFETY: FFI call into JSC bindings; global_this is a valid &JSGlobalObject.
            ReadableStream__used(global_this)
        })
    }
}

pub fn is_disturbed_value(value: JSValue, global_object: &JSGlobalObject) -> bool {
    // SAFETY: FFI call; value may be any JSValue (C++ side checks).
    ReadableStream__isDisturbed(value, global_object)
}

// ─── Tag / Source ────────────────────────────────────────────────────────────

#[repr(i32)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Tag {
    Invalid = -1,

    /// ReadableStreamDefaultController or ReadableByteStreamController
    JavaScript = 0,

    /// ReadableByteStreamController
    /// but with a BlobLoader
    /// we can skip the BlobLoader and just use the underlying Blob
    Blob = 1,

    /// ReadableByteStreamController
    /// but with a FileLoader
    /// we can skip the FileLoader and just use the underlying File
    File = 2,

    /// This is a direct readable stream
    /// That means we can turn it into whatever we want
    Direct = 3,

    Bytes = 4,
}

// `ReadableStreamTag__tagged` (C++ `webcore/ReadableStream.cpp:387`) returns
// raw `int32_t`; the extern decl above types it as `Tag`, so an out-of-range
// value would be immediate UB. Lock the discriminant width and every variant
// value so a C++-side addition that Rust hasn't mirrored fails the build here
// instead of materialising an invalid enum.
bun_core::assert_ffi_discr!(
    Tag, i32;
    Invalid = -1, JavaScript = 0, Blob = 1, File = 2, Direct = 3, Bytes = 4,
);

// Clone/Copy: bitwise OK — variant pointers are non-owning handles to
// JSC-managed loader objects (lifetime governed by the stream/JS heap).
#[derive(Copy, Clone)]
pub enum Source {
    Invalid,
    /// ReadableStreamDefaultController or ReadableByteStreamController
    JavaScript,
    /// ReadableByteStreamController
    /// but with a BlobLoader
    /// we can skip the BlobLoader and just use the underlying Blob
    Blob(*mut ByteBlobLoader),
    /// ReadableByteStreamController
    /// but with a FileLoader
    /// we can skip the FileLoader and just use the underlying File
    File(*mut FileReader),
    /// This is a direct readable stream
    /// That means we can turn it into whatever we want
    Direct,
    Bytes(*mut ByteStream),
}

impl Source {
    /// Shared borrow of the `Bytes` payload as a [`BackRef`](bun_ptr::BackRef).
    ///
    /// The pointer is the JS wrapper's `m_ctx` heap allocation returned by
    /// `ReadableStreamTag__tagged` and is non-null and live while the owning
    /// `ReadableStream` JSValue is rooted (caller's `Strong`/stack root) — the
    /// BACKREF outlives-holder invariant. R-2: every `ByteStream` field touched
    /// through this borrow is `Cell`/`JsCell`-backed, so re-entrant JS that
    /// re-derives a fresh `&ByteStream` from `m_ctx` aliases shared-only.
    ///
    /// Centralises the per-site raw-pointer deref so call sites are
    /// unsafe-free; the one audited deref lives in [`bun_ptr::BackRef::get`].
    #[inline]
    pub fn bytes(self) -> Option<bun_ptr::BackRef<ByteStream>> {
        match self {
            Source::Bytes(p) => Some(bun_ptr::BackRef::from(
                NonNull::new(p).expect("Source::Bytes payload is non-null"),
            )),
            _ => None,
        }
    }

    /// Shared borrow of the `File` payload as a [`BackRef`](bun_ptr::BackRef).
    ///
    /// Same invariant as [`bytes`](Self::bytes): the pointer is the JS
    /// wrapper's `m_ctx` heap allocation, non-null and live while the owning
    /// `ReadableStream` JSValue is rooted. R-2: every `FileReader` field
    /// touched through this borrow is `Cell`/`JsCell`-backed, so re-entrant JS
    /// that re-derives a fresh `&FileReader` from `m_ctx` aliases shared-only.
    #[inline]
    pub fn file(self) -> Option<bun_ptr::BackRef<FileReader>> {
        match self {
            Source::File(p) => Some(bun_ptr::BackRef::from(
                NonNull::new(p).expect("Source::File payload is non-null"),
            )),
            _ => None,
        }
    }
}

// ─── NewSource ───────────────────────────────────────────────────────────────
//
// Zig: `pub fn NewSource(comptime Context: type, comptime name_: []const u8,
//                        comptime onStart, onPull, onCancel, deinit_fn,
//                        setRefUnrefFn?, drainInternalBuffer?, memoryCostFn?,
//                        toBufferedValue?) type { return struct {...} }`
//
// Rust: the comptime fn-pointer bundle becomes a trait `SourceContext` that
// each `Context` type implements; `NewSource<C>` is the generic struct.

/// Trait capturing the comptime fn params of Zig's `NewSource(...)`.
pub trait SourceContext: Sized {
    /// `name_` — used to look up `jsc.Codegen.JS{NAME}InternalReadableStreamSource`.
    const NAME: &'static str;
    /// `setRefUnrefFn != null`
    const SUPPORTS_REF: bool = false;

    // ─── codegen accessors (`.classes.ts` → `generated_classes.rs`) ───────────
    // Zig: `js = @field(jsc.Codegen, "JS" ++ name ++ "InternalReadableStreamSource")`.
    // Each context binds its per-type codegen module via `source_context_codegen!`.
    /// `js_${NAME}InternalReadableStreamSource::to_js` — `ptr` is the
    /// type-erased `*mut NewSource<Self>` (cast inside the macro impl).
    fn js_create(ptr: *mut c_void, global: &JSGlobalObject) -> JSValue;
    /// `js_${NAME}InternalReadableStreamSource::pending_promise_set_cached`
    fn js_pending_promise_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue);
    /// `js_${NAME}InternalReadableStreamSource::on_drain_callback_set_cached`
    fn js_on_drain_callback_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue);
    /// `js_${NAME}InternalReadableStreamSource::on_drain_callback_get_cached`
    fn js_on_drain_callback_get_cached(this: JSValue) -> Option<JSValue>;

    fn on_start(&mut self) -> streams::Start;
    fn on_pull(&mut self, buf: &mut [u8], view: JSValue) -> streams::Result;
    fn on_cancel(&mut self);
    /// Per-context teardown side-effects (unref pollers, flush pending callbacks,
    /// release handles). **Must NOT free the enclosing `NewSource<Self>` allocation** —
    /// that is done by the caller ([`NewSource::decrement_count`]) *after* this
    /// returns, via `Box::from_raw`, which then runs `Drop` on every field. Freeing
    /// here would deallocate the storage backing the live `&mut self` borrow (UAF).
    fn deinit_fn(&mut self);

    /// `setRefUnrefFn` — default no-op (Zig: `?fn`, null ⇒ ref/unref are no-ops).
    fn set_ref_unref(&mut self, _enable: bool) {}

    /// `drainInternalBuffer` — default returns empty (Zig: `?fn`, null ⇒ `.{}`).
    fn drain_internal_buffer(&mut self) -> Vec<u8> {
        Vec::<u8>::default()
    }

    /// `memoryCostFn` — default returns 0; `NewSource::memory_cost` adds `size_of::<Self>()`.
    fn memory_cost_fn(&self) -> usize {
        0
    }

    /// `toBufferedValue` — `None` ⇒ "not implemented" (caller throws TODO).
    fn to_buffered_value(
        &mut self,
        _global_this: &JSGlobalObject,
        _action: streams::BufferActionTag,
    ) -> Option<JsResult<JSValue>> {
        None
    }

    /// `@hasDecl(Context, "setRawMode")` — default: not present.
    /// Returns `None` if the context type does not support raw mode.
    // TODO(port): Zig used @compileError when absent + codegen referenced; Rust default panics never reached if codegen omits it.
    fn set_raw_mode(&mut self, _flag: bool) -> Option<bun_sys::Result<()>> {
        None
    }

    /// `@hasDecl(Context, "setFlowing")` — default no-op.
    fn set_flowing(&mut self, _flag: bool) {}
}

// TODO(port): #[bun_jsc::JsClass] — codegen name is "JS{C::NAME}InternalReadableStreamSource".
// The Zig `js = @field(jsc.Codegen, ...)` + toJS/fromJS/fromJSDirect aliases are wired by the
// derive; cached-property accessors (pendingPromiseSetCached, onDrainCallback{Get,Set}Cached)
// are emitted by the .classes.ts generator.
//
// `repr(C)` keeps `context` at offset 0: C++ `wrapped()` returns `*mut NewSource<C>` and
// [`ReadableStream::from_js`] casts that straight to `*mut C` (matching Zig, where `context`
// is the first field). With Rust's default repr the field is reordered and the cast reads
// adjacent fields as the loader, returning empty bodies.
#[repr(C)]
pub struct NewSource<C: SourceContext> {
    pub context: C,
    pub cancelled: bool,
    pub ref_count: u32,
    pub pending_err: Option<syscall::Error>,
    pub close_handler: Option<fn(Option<*mut c_void>)>,
    // TODO(port): lifetime — TSV class UNKNOWN
    pub close_ctx: Option<NonNull<c_void>>,
    pub close_jsvalue: bun_jsc::strong::Optional,
    /// R-2: cleared via `&self` from `FetchTasklet::clear_stream_cancel_handler`
    /// (through `ByteStream::parent_const`), so interior-mutable.
    pub cancel_handler: Cell<Option<fn(Option<*mut c_void>)>>,
    pub cancel_ctx: Cell<Option<*mut c_void>>,
    // JSC_BORROW: process-lifetime VM global. Heap m_ctx field reassigned in
    // `start()` from a fresh `&JSGlobalObject`; `BackRef` gives a safe `Deref`
    // projection without propagating a lifetime parameter into FFI codegen.
    pub global_this: Option<bun_ptr::BackRef<JSGlobalObject>>,
    // SAFETY: this is the self-wrapper JSValue (points at the JSCell that owns this m_ctx).
    // Kept alive by the wrapper itself; zeroed in finalize() before sweep.
    pub this_jsvalue: JSValue,
    /// R-2: written by `&self` context methods (`ByteStream::to_any_blob`,
    /// `ByteBlobLoader::to_any_blob`) via `parent_const()`, so interior-mutable.
    pub is_closed: Cell<bool>,
}

impl<C: SourceContext + Default> Default for NewSource<C> {
    fn default() -> Self {
        Self {
            context: C::default(),
            cancelled: false,
            ref_count: 1,
            pending_err: None,
            close_handler: None,
            close_ctx: None,
            close_jsvalue: bun_jsc::strong::Optional::empty(),
            cancel_handler: Cell::new(None),
            cancel_ctx: Cell::new(None),
            global_this: None,
            this_jsvalue: JSValue::ZERO,
            is_closed: Cell::new(false),
        }
    }
}

// ─── per-type codegen accessors ──────────────────────────────────────────────
// Zig: `js = @field(jsc.Codegen, "JS" ++ name ++ "InternalReadableStreamSource")`
// resolves to a *per-type* generated module; in Rust there is no inherent
// associated-module syntax, so each `SourceContext` impl carries the codegen
// extern symbols as associated consts (bound via `source_context_codegen!`).
// The `.classes.ts` → `.rs` generator (when re-run with Rust output) is expected
// to emit those `const JS_*` bindings directly.
pub trait NewSourceCodegen {
    fn to_js(&mut self, global_this: &JSGlobalObject) -> JSValue;
    fn pending_promise_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue);
    fn on_drain_callback_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue);
    fn on_drain_callback_get_cached(this: JSValue) -> Option<JSValue>;
}

/// Binds the four `SourceContext::js_*` accessors to the codegen'd
/// `crate::generated_classes::js_${Name}InternalReadableStreamSource` module
/// (one per `.classes.ts` entry: `Blob`, `File`, `Bytes`). The extern symbols
/// are declared exactly once inside that module — no local `extern "C"` block.
///
/// Invoke *inside* an `impl SourceContext for Foo { ... }` block.
#[macro_export]
macro_rules! source_context_codegen {
    ($gen:ident) => {
        #[inline]
        fn js_create(
            ptr: *mut ::core::ffi::c_void,
            global: &$crate::webcore::jsc::JSGlobalObject,
        ) -> $crate::webcore::jsc::JSValue {
            $crate::generated_classes::$gen::to_js(ptr.cast(), global)
        }
        #[inline]
        fn js_pending_promise_set_cached(
            this: $crate::webcore::jsc::JSValue,
            global: &$crate::webcore::jsc::JSGlobalObject,
            value: $crate::webcore::jsc::JSValue,
        ) {
            $crate::generated_classes::$gen::pending_promise_set_cached(this, global, value)
        }
        #[inline]
        fn js_on_drain_callback_set_cached(
            this: $crate::webcore::jsc::JSValue,
            global: &$crate::webcore::jsc::JSGlobalObject,
            value: $crate::webcore::jsc::JSValue,
        ) {
            $crate::generated_classes::$gen::on_drain_callback_set_cached(this, global, value)
        }
        #[inline]
        fn js_on_drain_callback_get_cached(
            this: $crate::webcore::jsc::JSValue,
        ) -> Option<$crate::webcore::jsc::JSValue> {
            $crate::generated_classes::$gen::on_drain_callback_get_cached(this)
        }
    };
}

impl<C: SourceContext> NewSourceCodegen for NewSource<C> {
    fn to_js(&mut self, global_this: &JSGlobalObject) -> JSValue {
        // `self` is a heap-allocated `NewSource<C>` produced by [`NewSource::new`]
        // (`heap::alloc`); ownership transfers to the JS wrapper as `m_ctx`. C++ side
        // stores it as `void*` and the GC finalizer drives `decrement_count` → `deinit`.
        C::js_create(
            std::ptr::from_mut::<Self>(self).cast::<c_void>(),
            global_this,
        )
    }
    fn pending_promise_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue) {
        C::js_pending_promise_set_cached(this, global, value)
    }
    fn on_drain_callback_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue) {
        C::js_on_drain_callback_set_cached(this, global, value)
    }
    fn on_drain_callback_get_cached(this: JSValue) -> Option<JSValue> {
        C::js_on_drain_callback_get_cached(this)
    }
}

// Enforce the layout invariant `from_js`/`Source` rely on.
const _: () = assert!(core::mem::offset_of!(NewSource<ByteBlobLoader>, context) == 0);
const _: () = assert!(core::mem::offset_of!(NewSource<ByteStream>, context) == 0);
const _: () = assert!(core::mem::offset_of!(NewSource<FileReader>, context) == 0);

impl<C: SourceContext> NewSource<C> {
    /// Safe `&JSGlobalObject` accessor for the JSC_BORROW `global_this`
    /// back-pointer. `global_this` is stored from a live `&JSGlobalObject` at
    /// construction (or reassigned in `start()` from a fresh live one); the
    /// VM-owned global outlives every `NewSource` it owns.
    #[inline]
    pub fn global_this(&self) -> &JSGlobalObject {
        self.global_this
            .as_ref()
            .expect("NewSource.global_this used before init")
            .get()
    }

    /// `bun.TrivialNew(@This())` — heap-allocate and hand back the raw pointer.
    ///
    /// Ownership is **not** retained by Rust: the returned pointer is intended to
    /// be installed as the JS wrapper's `m_ctx` via [`Self::to_readable_stream`]
    /// (or [`NewSourceCodegen::to_js`]), after which the GC finalizer drives
    /// teardown through [`Self::decrement_count`] → context `deinit_fn` →
    /// [`Self::deinit`]. Dropping a `Box` here would free the allocation while
    /// the JS cell still points at it (UAF), so this mirrors Zig's `TrivialNew`
    /// exactly and returns `*mut Self`.
    pub fn new(init: Self) -> *mut Self {
        bun_core::heap::into_raw(Box::new(init))
    }

    /// [`Self::new`] returning the leaked allocation as an unbounded `&mut`.
    ///
    /// Every call site of `new()` immediately did `unsafe { &mut *p }` to set
    /// up the context and then handed ownership to the JS wrapper via
    /// [`Self::to_readable_stream`]. Centralising that deref here (one
    /// audited `unsafe`, N safe callers) — the allocation is fresh, non-null,
    /// uniquely owned, and outlives the returned borrow because the JS GC
    /// finalizer (not Rust `Drop`) reclaims it via [`Self::decrement_count`].
    #[inline]
    pub fn new_mut<'a>(init: Self) -> &'a mut Self {
        // SAFETY: `heap::into_raw(Box::new(..))` is non-null, aligned, and the
        // sole pointer to a fresh allocation; forming `&mut` is unique.
        // Ownership transfers to the JS wrapper's `m_ctx`, so the unbounded
        // lifetime is correct (no Rust owner will drop underneath the borrow).
        unsafe { &mut *Self::new(init) }
    }
    // `bun.TrivialDeinit(@This())` → see `deinit()` below.

    pub fn pull(&mut self, buf: &mut [u8]) -> streams::Result {
        self.context.on_pull(buf, JSValue::ZERO)
    }

    pub fn r#ref(&mut self) {
        if C::SUPPORTS_REF {
            self.context.set_ref_unref(true);
        }
    }

    pub fn unref(&mut self) {
        if C::SUPPORTS_REF {
            self.context.set_ref_unref(false);
        }
    }

    pub fn set_ref(&mut self, value: bool) {
        if C::SUPPORTS_REF {
            self.context.set_ref_unref(value);
        }
    }

    pub fn start(&mut self) -> streams::Start {
        self.context.on_start()
    }

    pub fn on_pull_from_js(&mut self, buf: &mut [u8], view: JSValue) -> streams::Result {
        self.context.on_pull(buf, view)
    }

    pub fn on_start_from_js(&mut self) -> streams::Start {
        self.context.on_start()
    }

    pub fn cancel(&mut self) {
        if self.cancelled {
            return;
        }
        self.cancelled = true;
        self.context.on_cancel();
        if let Some(handler) = self.cancel_handler.take() {
            handler(self.cancel_ctx.get());
        }
    }

    pub fn on_close(&mut self) {
        if self.cancelled {
            return;
        }
        if let Some(close) = self.close_handler.take() {
            // Zig: `if (close == &JSReadableStreamSource.onClose)` — identity check
            // against the *exact* fn pointer stored by `set_on_close_from_js`, so the
            // JS path receives `self` (not `close_ctx`, which is unset on that path).
            if close as usize == Self::on_js_close as fn(Option<*mut c_void>) as usize {
                Self::on_js_close(Some(std::ptr::from_mut(self).cast::<c_void>()));
            } else {
                close(self.close_ctx.map(|p| p.as_ptr()));
            }
        }
    }

    /// `JSReadableStreamSource.onClose` — invoked via `close_handler` when the
    /// JS side registered an `onclose` callback. Stored *directly* in
    /// `close_handler` by [`Self::set_on_close_from_js`] so the fn-pointer
    /// identity check above matches.
    fn on_js_close(ptr: Option<*mut c_void>) {
        // SAFETY: ptr was set to `self as *mut NewSource<C>` in on_close()/set_on_close_from_js.
        let this = unsafe { &mut *(ptr.unwrap().cast::<NewSource<C>>()) };
        if let Some(cb) = this.close_jsvalue.try_swap() {
            this.global_this().queue_microtask(cb, &[]);
        }
        this.close_jsvalue.deinit();
    }

    pub fn increment_count(&mut self) {
        self.ref_count += 1;
    }

    /// Release one reference. If the count hits zero, runs context teardown and
    /// **frees the allocation** (`bun.destroy(this)`).
    ///
    /// Takes a raw pointer (not `&mut self`) because the zero-refcount path
    /// deallocates `*this`; holding a live `&mut Self` across that drop would be
    /// a dangling-reference UAF (Stacked Borrows: protected tag on freed memory).
    ///
    /// SAFETY: `this` must point at a live `NewSource<C>` produced by
    /// [`Self::new`] (i.e. `Box::into_raw`). Caller must not dereference `this`
    /// — nor any interior pointer such as `&mut context` — after this returns.
    pub unsafe fn decrement_count(this: *mut Self) -> u32 {
        // SAFETY: caller contract — `this` is live for the duration of this block.
        let remaining = unsafe {
            let r = &mut (*this).ref_count;
            #[cfg(debug_assertions)]
            if *r == 0 {
                panic!("Attempted to decrement ref count below zero");
            }
            *r -= 1;
            *r
        };
        if remaining == 0 {
            // SAFETY: still live; run side-effect teardown while fields are valid.
            unsafe {
                (*this).close_jsvalue.deinit();
                (*this).context.deinit_fn();
            }
            // SAFETY: `this` originated from `Box::into_raw` in `Self::new`. No
            // `&mut` borrow of `*this` is live at this point — reclaim and drop,
            // which runs `Drop` on `context` and all other fields, then frees.
            drop(unsafe { bun_core::heap::take(this) });
            return 0;
        }
        remaining
    }

    pub fn get_error(&mut self) -> Option<syscall::Error> {
        self.pending_err.take()
    }

    pub fn drain(&mut self) -> Vec<u8> {
        self.context.drain_internal_buffer()
    }

    pub fn to_readable_stream(&mut self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let out_value = if self.this_jsvalue != JSValue::ZERO {
            self.this_jsvalue
        } else {
            <Self as NewSourceCodegen>::to_js(self, global_this)
        };
        out_value.ensure_still_alive();
        self.this_jsvalue = out_value;
        ReadableStream::from_native(global_this, out_value)
    }

    // TODO(port): #[bun_jsc::host_fn(method)]
    pub fn set_raw_mode_from_js(
        this: &mut Self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let flag = call_frame.argument(0);
        debug_assert!(flag.is_boolean());
        match this.context.set_raw_mode(flag == JSValue::TRUE) {
            Some(Ok(())) => Ok(JSValue::UNDEFINED),
            Some(Err(e)) => Ok(e.to_js(global)),
            // Zig: @compileError("setRawMode is not implemented on " ++ @typeName(Context))
            None => unreachable!("setRawMode is not implemented on {}", C::NAME),
        }
    }

    // TODO(port): #[bun_jsc::host_fn(method)]
    pub fn set_flowing_from_js(
        this: &mut Self,
        _global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let flag = call_frame.argument(0);
        debug_assert!(flag.is_boolean());
        this.context.set_flowing(flag == JSValue::TRUE);
        Ok(JSValue::UNDEFINED)
    }

    pub fn memory_cost(&self) -> usize {
        self.context.memory_cost_fn() + core::mem::size_of::<Self>()
    }

    // `bun.TrivialDeinit(@This())` is folded into [`Self::decrement_count`]'s
    // zero-refcount path. A `&mut self` deinit here would free the storage
    // backing the live `self` borrow (dangling UAF), so the drop is performed
    // there via raw `*mut Self` instead.
}

// ─── codegen-facing inherent methods ─────────────────────────────────────────
// Zig: `pub const drainFromJS = JSReadableStreamSource.drain;` etc. — the
// `.classes.ts` → `generated_classes.rs` thunks call these by exact name on
// `NewSource<C>` (aliased as `{Blob,Bytes,File}InternalReadableStreamSource`).
impl<C: SourceContext> NewSource<C> {
    pub fn pull_from_js(
        &mut self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let this_jsvalue = call_frame.this();
        let arguments = call_frame.arguments_old::<2>();
        let view = arguments.ptr[0];
        view.ensure_still_alive();
        self.this_jsvalue = this_jsvalue;
        let Some(mut buffer) = view.as_array_buffer(global_this) else {
            return Ok(JSValue::UNDEFINED);
        };
        let result = self.on_pull_from_js(buffer.slice_mut(), view);
        Self::process_result(this_jsvalue, global_this, arguments.ptr[1], result)
    }

    pub fn start_from_js(
        &mut self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.global_this = Some(bun_ptr::BackRef::new(global_this));
        self.this_jsvalue = call_frame.this();
        match self.on_start_from_js() {
            streams::Start::Empty => Ok(JSValue::js_number(0.0)),
            streams::Start::Ready => Ok(JSValue::js_number(16384.0)),
            streams::Start::ChunkSize(size) => Ok(JSValue::js_number(size as f64)),
            streams::Start::Err(err) => Err(global_this.throw_value(err.to_js(global_this))),
            rc => rc.to_js(global_this),
        }
    }

    pub fn get_is_closed_from_js(&mut self, _global_object: &JSGlobalObject) -> JSValue {
        JSValue::from(self.is_closed.get())
    }

    fn process_result(
        this_jsvalue: JSValue,
        global_this: &JSGlobalObject,
        flags: JSValue,
        mut result: streams::Result,
    ) -> JsResult<JSValue> {
        // PORT NOTE: Zig matches on the union and falls through to `result.toJS`
        // for non-handled tags; here `result` is consumed by `to_js(&mut self)`.
        match &result {
            streams::Result::Err(err) => match err {
                streams::StreamError::Error(e) => {
                    Err(global_this.throw_value(e.to_js(global_this)))
                }
                // Zig's else arm reads `err.JSValue` directly — implicitly assumes only
                // `.Error`/`.JSValue` reach `processResult` (would safety-panic on
                // `.WeakJSValue`/`.AbortReason`). Preserve the intent (always throw on
                // `.err`) defensively via `to_js_weak`, which handles all four variants
                // and reports whether the value was strong-protected (needs `unprotect()`).
                _ => {
                    let (js_err, was_strong) = err.to_js_weak(global_this);
                    js_err.ensure_still_alive();
                    if was_strong == streams::WasStrong::Strong {
                        js_err.unprotect();
                    }
                    Err(global_this.throw_value(js_err))
                }
            },
            streams::Result::Pending(_) => {
                let out = result.to_js(global_this)?;
                <Self as NewSourceCodegen>::pending_promise_set_cached(
                    this_jsvalue,
                    global_this,
                    out,
                );
                Ok(out)
            }
            streams::Result::TemporaryAndDone(_)
            | streams::Result::OwnedAndDone(_)
            | streams::Result::IntoArrayAndDone(_) => {
                let value = JSValue::TRUE;
                // SAFETY: flags is a JS object passed from builtin JS; index 0 is writable.
                unsafe {
                    jsc::c_api::JSObjectSetPropertyAtIndex(
                        std::ptr::from_ref::<JSGlobalObject>(global_this).cast_mut(),
                        flags.as_object_ref(),
                        0,
                        value.as_object_ref(),
                        core::ptr::null_mut(),
                    );
                }
                result.to_js(global_this)
            }
            _ => result.to_js(global_this),
        }
    }

    pub fn cancel_from_js(
        &mut self,
        _global_object: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.this_jsvalue = call_frame.this();
        self.cancel();
        Ok(JSValue::UNDEFINED)
    }

    pub fn set_on_close_from_js(
        &mut self,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<()> {
        // Store the handler by *identity* — `NewSource::on_close` compares the
        // stored fn pointer against `on_js_close` to decide whether to pass
        // `self` (JS path) or `close_ctx` (native path).
        self.close_handler = Some(Self::on_js_close);
        self.global_this = Some(bun_ptr::BackRef::new(global_object));

        if value.is_undefined() {
            self.close_jsvalue.deinit();
            return Ok(());
        }

        if !value.is_callable() {
            return Err(global_object.throw_invalid_argument_type(
                "ReadableStreamSource",
                "onclose",
                "function",
            ));
        }
        let cb = value.with_async_context_if_needed(global_object);
        self.close_jsvalue.set(global_object, cb);
        Ok(())
    }

    pub fn set_on_drain_from_js(
        &mut self,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<()> {
        self.global_this = Some(bun_ptr::BackRef::new(global_object));

        if value.is_undefined() {
            <Self as NewSourceCodegen>::on_drain_callback_set_cached(
                self.this_jsvalue,
                global_object,
                JSValue::UNDEFINED,
            );
            return Ok(());
        }

        if !value.is_callable() {
            return Err(global_object.throw_invalid_argument_type(
                "ReadableStreamSource",
                "onDrain",
                "function",
            ));
        }
        let cb = value.with_async_context_if_needed(global_object);
        <Self as NewSourceCodegen>::on_drain_callback_set_cached(
            self.this_jsvalue,
            global_object,
            cb,
        );
        Ok(())
    }

    pub fn get_on_close_from_js(&mut self, _global_object: &JSGlobalObject) -> JSValue {
        self.close_jsvalue.get().unwrap_or(JSValue::UNDEFINED)
    }

    pub fn get_on_drain_from_js(&mut self, _global_object: &JSGlobalObject) -> JSValue {
        <Self as NewSourceCodegen>::on_drain_callback_get_cached(self.this_jsvalue)
            .unwrap_or(JSValue::UNDEFINED)
    }

    pub fn update_ref_from_js(
        &mut self,
        _global_object: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.this_jsvalue = call_frame.this();
        let ref_or_unref = call_frame.argument(0).to_boolean();
        self.set_ref(ref_or_unref);
        Ok(JSValue::UNDEFINED)
    }

    pub fn finalize(self: Box<Self>) {
        // Refcounted: `decrement_count` releases the JS wrapper's +1; allocation
        // may outlive this call if other refs remain, so hand ownership back to
        // the raw refcount via a raw pointer (the call may free `*this`).
        let this = Box::into_raw(self);
        // SAFETY: `this` is live — just unwrapped from `Box`.
        unsafe { (*this).this_jsvalue = JSValue::ZERO };
        // SAFETY: `this` came from `Box::into_raw`; not accessed after.
        let _ = unsafe { Self::decrement_count(this) };
    }

    pub fn drain_from_js(
        &mut self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.this_jsvalue = call_frame.this();
        let mut list = self.drain();
        if list.len() > 0 {
            // Ownership of the buffer transfers to JSC: `to_js` installs
            // `MarkedArrayBuffer_deallocator` which `mi_free`s on GC. Suppress
            // `Vec::Drop` so the same allocation isn't freed twice (once
            // here on scope exit, once by the GC). Mirrors `streams::Start::to_js`.
            let ab = jsc::ArrayBuffer::from_bytes(list.slice_mut(), jsc::JSType::Uint8Array);
            core::mem::forget(list);
            return ab.to_js(global_this);
        }
        Ok(JSValue::UNDEFINED)
    }

    // PORT NOTE: text/arrayBuffer/blob/bytes/json all share the same body modulo
    // `BufferActionTag`. Collapsed into one helper to avoid 5× drift.
    fn to_buffered_value_from_js(
        &mut self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
        action: streams::BufferActionTag,
    ) -> JsResult<JSValue> {
        self.this_jsvalue = call_frame.this();
        if let Some(r) = self.context.to_buffered_value(global_this, action) {
            return r;
        }
        Err(global_this.throw_todo(b"This is not implemented yet"))
    }

    pub fn text_from_js(
        &mut self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.to_buffered_value_from_js(global_this, call_frame, streams::BufferActionTag::Text)
    }

    pub fn array_buffer_from_js(
        &mut self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.to_buffered_value_from_js(
            global_this,
            call_frame,
            streams::BufferActionTag::ArrayBuffer,
        )
    }

    pub fn blob_from_js(
        &mut self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.to_buffered_value_from_js(global_this, call_frame, streams::BufferActionTag::Blob)
    }

    pub fn bytes_from_js(
        &mut self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.to_buffered_value_from_js(global_this, call_frame, streams::BufferActionTag::Bytes)
    }

    pub fn json_from_js(
        &mut self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.to_buffered_value_from_js(global_this, call_frame, streams::BufferActionTag::Json)
    }
}

// ported from: src/runtime/webcore/ReadableStream.zig
