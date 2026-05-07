use core::ffi::c_void;
use core::ptr::NonNull;

use crate::webcore::jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult};
use crate::webcore::jsc::SysErrorJsc as _;
// `bun_jsc` not yet a dep; alias to local shim so `bun_jsc::Strong` etc. resolve.
use crate::webcore::jsc as bun_jsc;
use bun_sys as syscall;
use bun_collections::ByteList;

#[allow(unused_imports)]
use crate::webcore::{self, Blob, ByteBlobLoader, ByteStream, FileReader};
use crate::webcore::streams;

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
        Self { held: bun_jsc::strong::Optional::empty() }
    }
}

impl Strong {
    pub fn has(&mut self) -> bool {
        self.held.has()
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
    fn ReadableStream__tee(
        stream: JSValue,
        global_this: *const JSGlobalObject,
        out1: *mut JSValue,
        out2: *mut JSValue,
    ) -> bool;
    fn ReadableStreamTag__tagged(
        global_object: *const JSGlobalObject,
        possible_readable_stream: *mut JSValue,
        ptr: *mut *mut c_void,
    ) -> Tag;
    fn ReadableStream__isDisturbed(
        possible_readable_stream: JSValue,
        global_object: *const JSGlobalObject,
    ) -> bool;
    fn ReadableStream__isLocked(
        possible_readable_stream: JSValue,
        global_object: *const JSGlobalObject,
    ) -> bool;
    fn ReadableStream__empty(global: *const JSGlobalObject) -> JSValue;
    fn ReadableStream__used(global: *const JSGlobalObject) -> JSValue;
    fn ReadableStream__cancel(stream: JSValue, global: *const JSGlobalObject);
    fn ReadableStream__cancelWithReason(
        stream: JSValue,
        global: *const JSGlobalObject,
        reason: JSValue,
    );
    fn ReadableStream__abort(stream: JSValue, global: *const JSGlobalObject);
    fn ReadableStream__detach(stream: JSValue, global: *const JSGlobalObject);
    fn ReadableStream__fromBlob(
        global: *const JSGlobalObject,
        store: *mut c_void,
        offset: usize,
        length: usize,
    ) -> JSValue;
    fn ZigGlobalObject__createNativeReadableStream(
        global: *const JSGlobalObject,
        native_ptr: JSValue,
    ) -> JSValue;
    // PORT NOTE: `globalThis.queueMicrotask(cb, ...)` — used by `NewSource::on_js_close`.
    // Declared locally because the inline `JSGlobalObject` shim in `bun_jsc` doesn't yet
    // re-export `queue_microtask`. C++ symbol: bindings.cpp `JSC__JSGlobalObject__queueMicrotaskJob`.
    fn JSC__JSGlobalObject__queueMicrotaskJob(
        global: *const JSGlobalObject,
        function: JSValue,
        first: JSValue,
        second: JSValue,
    );
}

// ─── ReadableStream methods ──────────────────────────────────────────────────
impl ReadableStream {
    pub fn tee(&self, global_this: &JSGlobalObject) -> JsResult<Option<(ReadableStream, ReadableStream)>> {
        let mut out1 = JSValue::ZERO;
        let mut out2 = JSValue::ZERO;
        // SAFETY: FFI call into JSC bindings; out params are valid stack ptrs.
        let ok = bun_jsc::from_js_host_call_generic(global_this, || unsafe {
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
            *self = ReadableStream { ptr: Source::Invalid, value: JSValue::ZERO };
        }
        Ok(())
    }

    // TODO(b2-blocked): ByteBlobLoader/ByteStream method bodies (`to_any_blob`,
    // `parent`) gated until those modules are un-stubbed. FileReader path
    // additionally needs `Blob::init_with_store`.
    
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
            Source::File(blobby) => {
                // SAFETY: ptr came from ReadableStreamTag__tagged; valid while stream alive.
                let blobby = unsafe { &mut *blobby };
                if let webcore::file_reader::Lazy::Blob(store) = &blobby.lazy {
                    let blob = Blob::init_with_store(store.clone(), global_this);
                    blob.store.as_ref().unwrap().ref_();
                    // it should be lazy, file shouldn't have opened yet.
                    debug_assert!(!blobby.started);
                    self.done(global_this);
                    return Some(webcore::blob::Any::Blob(blob));
                }
            }
            Source::Bytes(bytes) => {
                // SAFETY: ptr came from ReadableStreamTag__tagged; valid while stream alive.
                let bytes = unsafe { &mut *bytes };
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
            // TODO(b2-blocked): ByteBlobLoader/ByteStream are stubbed; un-gate once `parent()` lands.
            
            Source::Blob(source) => unsafe { (*source).parent().cancel() },
            Source::File(source) => unsafe { (*(*source).parent()).cancel() },
            
            Source::Bytes(source) => unsafe { (*source).parent().cancel() },
            _ => {}
        }
        self.detach_if_possible(global_this);
    }

    pub fn cancel(&self, global_this: &JSGlobalObject) {
        // cancel the stream
        // SAFETY: FFI call; value is a valid ReadableStream JSValue.
        unsafe { ReadableStream__cancel(self.value, global_this) };
        // mark the stream source as done
        self.done(global_this);
    }

    /// Cancel the stream and forward `reason` verbatim to the underlying source's
    /// cancel algorithm (the spec's ReadableStreamCancel). Unlike `cancel()`,
    /// this does not synthesize a DOMException — fetch() uses it to surface
    /// `AbortSignal.reason` to the request body's cancel callback.
    pub fn cancel_with_reason(&self, global_this: &JSGlobalObject, reason: JSValue) {
        // SAFETY: FFI call; value is a valid ReadableStream JSValue.
        unsafe { ReadableStream__cancelWithReason(self.value, global_this, reason) };
        self.done(global_this);
    }

    pub fn abort(&self, global_this: &JSGlobalObject) {
        // for now we are just calling cancel should be fine
        self.cancel(global_this);
    }

    pub fn force_detach(&self, global_object: &JSGlobalObject) {
        // SAFETY: FFI call; value is a valid ReadableStream JSValue.
        unsafe { ReadableStream__detach(self.value, global_object) };
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
        unsafe { ReadableStream__isLocked(self.value, global_object) }
    }

    pub fn from_js(value: JSValue, global_this: &JSGlobalObject) -> JsResult<Option<ReadableStream>> {
        value.ensure_still_alive();
        let mut out = value;
        let mut ptr: *mut c_void = core::ptr::null_mut();

        // SAFETY: out/ptr are valid stack out-params.
        let tag = bun_jsc::from_js_host_call_generic(global_this, || unsafe {
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
        bun_jsc::from_js_host_call(global_this, || unsafe {
            // SAFETY: FFI call into JSC bindings.
            ZigGlobalObject__createNativeReadableStream(global_this, native)
        })
    }

    // TODO(b2-blocked): FileReader/ByteBlobLoader construction — `from_blob_copy_ref`
    // and the helpers below build a `NewSource<FileReader>` with field-level inits
    // (`event_loop`, `lazy`, `reader.from`) and reach into `blob::StoreData::S3`.
    // FileReader's body is still being ported; un-gate together.
    
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
        let Some(store) = &blob.store else {
            return ReadableStream::empty(global_this);
        };
        match &store.data {
            webcore::blob::store::Data::Bytes(_) => {
                // PORT NOTE: Zig left `context: undefined` then called `setup()` to initialize
                // in place. Rust constructs with `Default` (no UB) and `setup()` overwrites
                // the entire struct via `*self = ByteBlobLoader { ... }`.
                let reader = NewSource::<ByteBlobLoader>::new(NewSource {
                    global_this,
                    context: ByteBlobLoader::default(),
                    ..Default::default()
                });
                // SAFETY: `new()` heap-allocated; ownership transfers to the JS wrapper's
                // `m_ctx` in `to_readable_stream()` below (freed via GC finalizer).
                let reader = unsafe { &mut *reader };
                reader.context.setup(blob, recommended_chunk_size);
                reader.to_readable_stream(global_this)
            }
            webcore::blob::store::Data::File(_) => {
                let reader = NewSource::<FileReader>::new(NewSource {
                    global_this,
                    context: FileReader {
                        // SAFETY: bun_vm() returns a non-null *mut VirtualMachine; event_loop()
                        // returns a non-null *mut EventLoop. Both outlive this call.
                        event_loop: jsc::EventLoopHandle::init(
                            unsafe { (*global_this.bun_vm()).event_loop() }.cast(),
                        ),
                        start_offset: Some(blob.offset as usize),
                        max_size: if blob.size != webcore::blob::MAX_SIZE {
                            Some(blob.size as usize)
                        } else {
                            None
                        },
                        lazy: webcore::file_reader::Lazy::Blob(store.clone()),
                        ..Default::default()
                    },
                    ..Default::default()
                });
                store.ref_();
                // SAFETY: `new()` heap-allocated; ownership transfers to the JS wrapper's
                // `m_ctx` in `to_readable_stream()` below (freed via GC finalizer).
                unsafe { &mut *reader }.to_readable_stream(global_this)
            }
            webcore::blob::store::Data::S3(s3) => {
                let credentials = s3.get_credentials();
                let path = s3.path();
                // SAFETY: bun_vm() returns the live VM raw ptr; `transpiler.env` is the
                // process-singleton dotenv loader, set during init and never null.
                let proxy = unsafe {
                    (*(*global_this.bun_vm()).transpiler.env).get_http_proxy(true, None, None)
                };
                let proxy_url = proxy.as_ref().map(|p| p.href);

                crate::webcore::s3::client::readable_stream(
                    credentials,
                    path,
                    blob.offset as usize,
                    if blob.size != webcore::blob::MAX_SIZE {
                        Some(blob.size as usize)
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
        let Some(store) = &blob.store else {
            return ReadableStream::empty(global_this);
        };
        match &store.data {
            webcore::blob::store::Data::File(_) => {
                let reader = NewSource::<FileReader>::new(NewSource {
                    global_this,
                    context: FileReader {
                        // SAFETY: bun_vm()/event_loop() return non-null ptrs that outlive this call.
                        event_loop: jsc::EventLoopHandle::init(
                            unsafe { (*global_this.bun_vm()).event_loop() }.cast(),
                        ),
                        start_offset: Some(offset),
                        lazy: webcore::file_reader::Lazy::Blob(store.clone()),
                        ..Default::default()
                    },
                    ..Default::default()
                });
                store.ref_();
                // SAFETY: `new()` heap-allocated; ownership transfers to the JS wrapper's
                // `m_ctx` in `to_readable_stream()` below (freed via GC finalizer).
                unsafe { &mut *reader }.to_readable_stream(global_this)
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
        let source = NewSource::<FileReader>::new(NewSource {
            global_this,
            context: FileReader {
                // SAFETY: bun_vm()/event_loop() return non-null ptrs that outlive this call.
                event_loop: jsc::EventLoopHandle::init(
                    unsafe { (*global_this.bun_vm()).event_loop() }.cast(),
                ),
                ..Default::default()
            },
            ..Default::default()
        });
        // SAFETY: `new()` heap-allocated; ownership transfers to the JS wrapper's
        // `m_ctx` in `to_readable_stream()` below (freed via GC finalizer).
        let source = unsafe { &mut *source };
        // PORT NOTE: reshaped for borrowck — Zig passed `&source.context` as both reader-parent and self.
        let ctx_ptr: *mut FileReader = &mut source.context;
        source.context.reader().from(buffered_reader, ctx_ptr.cast::<c_void>());

        source.to_readable_stream(global_this)
    }

    pub fn empty(global_this: &JSGlobalObject) -> JsResult<JSValue> {
        // TODO(port): bun.cpp.ReadableStream__empty wraps the extern with exception check
        bun_jsc::from_js_host_call(global_this, || {
            // SAFETY: FFI call into JSC bindings; global_this is a valid &JSGlobalObject.
            unsafe { ReadableStream__empty(global_this) }
        })
    }

    pub fn used(global_this: &JSGlobalObject) -> JsResult<JSValue> {
        // TODO(port): bun.cpp.ReadableStream__used wraps the extern with exception check
        bun_jsc::from_js_host_call(global_this, || {
            // SAFETY: FFI call into JSC bindings; global_this is a valid &JSGlobalObject.
            unsafe { ReadableStream__used(global_this) }
        })
    }
}

pub fn is_disturbed_value(value: JSValue, global_object: &JSGlobalObject) -> bool {
    // SAFETY: FFI call; value may be any JSValue (C++ side checks).
    unsafe { ReadableStream__isDisturbed(value, global_object) }
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

    // ─── codegen externs (`.classes.ts` → `ZigGeneratedClasses.cpp`) ──────────
    // Zig: `js = @field(jsc.Codegen, "JS" ++ name ++ "InternalReadableStreamSource")`.
    // Each context binds its per-type C symbols via `source_context_codegen!`.
    /// `${NAME}InternalReadableStreamSource__create`
    const JS_CREATE: unsafe extern "C" fn(*const JSGlobalObject, *mut c_void) -> JSValue;
    /// `${NAME}InternalReadableStreamSourcePrototype__pendingPromiseSetCachedValue`
    const JS_PENDING_PROMISE_SET_CACHED:
        unsafe extern "C" fn(JSValue, *const JSGlobalObject, JSValue);
    /// `${NAME}InternalReadableStreamSourcePrototype__onDrainCallbackSetCachedValue`
    const JS_ON_DRAIN_CALLBACK_SET_CACHED:
        unsafe extern "C" fn(JSValue, *const JSGlobalObject, JSValue);
    /// `${NAME}InternalReadableStreamSourcePrototype__onDrainCallbackGetCachedValue`
    const JS_ON_DRAIN_CALLBACK_GET_CACHED: unsafe extern "C" fn(JSValue) -> JSValue;

    fn on_start(&mut self) -> streams::Start;
    fn on_pull(&mut self, buf: &mut [u8], view: JSValue) -> streams::Result;
    fn on_cancel(&mut self);
    fn deinit_fn(&mut self);

    /// `setRefUnrefFn` — default no-op (Zig: `?fn`, null ⇒ ref/unref are no-ops).
    fn set_ref_unref(&mut self, _enable: bool) {}

    /// `drainInternalBuffer` — default returns empty (Zig: `?fn`, null ⇒ `.{}`).
    fn drain_internal_buffer(&mut self) -> ByteList {
        ByteList::default()
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
pub struct NewSource<C: SourceContext> {
    pub context: C,
    pub cancelled: bool,
    pub ref_count: u32,
    pub pending_err: Option<syscall::Error>,
    pub close_handler: Option<fn(Option<*mut c_void>)>,
    // TODO(port): lifetime — TSV class UNKNOWN
    pub close_ctx: Option<NonNull<c_void>>,
    pub close_jsvalue: bun_jsc::strong::Optional,
    pub cancel_handler: Option<fn(Option<*mut c_void>)>,
    pub cancel_ctx: Option<*mut c_void>,
    // PORT NOTE: JSC_BORROW. Stored raw because it's a heap m_ctx field reassigned in
    // `start()` from a fresh `&JSGlobalObject` argument; a `'static` borrow would be a
    // lie and a lifetime parameter would propagate into FFI codegen.
    pub global_this: *const JSGlobalObject,
    // SAFETY: this is the self-wrapper JSValue (points at the JSCell that owns this m_ctx).
    // Kept alive by the wrapper itself; zeroed in finalize() before sweep.
    pub this_jsvalue: JSValue,
    pub is_closed: bool,
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
            cancel_handler: None,
            cancel_ctx: None,
            global_this: core::ptr::null(),
            this_jsvalue: JSValue::ZERO,
            is_closed: false,
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

/// Declares the four `${Name}InternalReadableStreamSource*` C++ externs and binds
/// them to the `SourceContext::JS_*` associated consts. Hand-expansion of what
/// `generate-classes.ts` emits for `toJS` / cached-property accessors per
/// `.classes.ts` entry (`Blob`, `File`, `Bytes`).
///
/// Invoke *inside* an `impl SourceContext for Foo { ... }` block.
#[macro_export]
macro_rules! source_context_codegen {
    ($create:ident, $pending_set:ident, $drain_set:ident, $drain_get:ident) => {
        const JS_CREATE: unsafe extern "C" fn(
            *const $crate::webcore::jsc::JSGlobalObject,
            *mut ::core::ffi::c_void,
        ) -> $crate::webcore::jsc::JSValue = {
            unsafe extern "C" {
                fn $create(
                    global: *const $crate::webcore::jsc::JSGlobalObject,
                    ptr: *mut ::core::ffi::c_void,
                ) -> $crate::webcore::jsc::JSValue;
            }
            $create
        };
        const JS_PENDING_PROMISE_SET_CACHED: unsafe extern "C" fn(
            $crate::webcore::jsc::JSValue,
            *const $crate::webcore::jsc::JSGlobalObject,
            $crate::webcore::jsc::JSValue,
        ) = {
            unsafe extern "C" {
                fn $pending_set(
                    this: $crate::webcore::jsc::JSValue,
                    global: *const $crate::webcore::jsc::JSGlobalObject,
                    value: $crate::webcore::jsc::JSValue,
                );
            }
            $pending_set
        };
        const JS_ON_DRAIN_CALLBACK_SET_CACHED: unsafe extern "C" fn(
            $crate::webcore::jsc::JSValue,
            *const $crate::webcore::jsc::JSGlobalObject,
            $crate::webcore::jsc::JSValue,
        ) = {
            unsafe extern "C" {
                fn $drain_set(
                    this: $crate::webcore::jsc::JSValue,
                    global: *const $crate::webcore::jsc::JSGlobalObject,
                    value: $crate::webcore::jsc::JSValue,
                );
            }
            $drain_set
        };
        const JS_ON_DRAIN_CALLBACK_GET_CACHED: unsafe extern "C" fn(
            $crate::webcore::jsc::JSValue,
        ) -> $crate::webcore::jsc::JSValue = {
            unsafe extern "C" {
                fn $drain_get(
                    this: $crate::webcore::jsc::JSValue,
                ) -> $crate::webcore::jsc::JSValue;
            }
            $drain_get
        };
    };
}

impl<C: SourceContext> NewSourceCodegen for NewSource<C> {
    fn to_js(&mut self, global_this: &JSGlobalObject) -> JSValue {
        // SAFETY: `self` is a heap-allocated `NewSource<C>` produced by [`NewSource::new`]
        // (`Box::into_raw`); ownership transfers to the JS wrapper as `m_ctx`. C++ side
        // stores it as `void*` and the GC finalizer drives `decrement_count` → `deinit`.
        unsafe { (C::JS_CREATE)(global_this, self as *mut Self as *mut c_void) }
    }
    fn pending_promise_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue) {
        // SAFETY: `this` wraps a `JS{NAME}InternalReadableStreamSource` cell on `global`'s heap.
        unsafe { (C::JS_PENDING_PROMISE_SET_CACHED)(this, global, value) }
    }
    fn on_drain_callback_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue) {
        // SAFETY: `this` wraps a `JS{NAME}InternalReadableStreamSource` cell on `global`'s heap.
        unsafe { (C::JS_ON_DRAIN_CALLBACK_SET_CACHED)(this, global, value) }
    }
    fn on_drain_callback_get_cached(this: JSValue) -> Option<JSValue> {
        // SAFETY: `this` wraps a `JS{NAME}InternalReadableStreamSource` cell; `.zero` ⇒ unset.
        let result = unsafe { (C::JS_ON_DRAIN_CALLBACK_GET_CACHED)(this) };
        if result == JSValue::ZERO { None } else { Some(result) }
    }
}

impl<C: SourceContext> NewSource<C> {
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
        Box::into_raw(Box::new(init))
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

    pub fn cancel(&mut self) {
        if self.cancelled {
            return;
        }
        self.cancelled = true;
        self.context.on_cancel();
        if let Some(handler) = self.cancel_handler.take() {
            handler(self.cancel_ctx);
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
                Self::on_js_close(Some(self as *mut _ as *mut c_void));
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
            // SAFETY: global_this stored from a live `&JSGlobalObject`; outlives the close.
            unsafe {
                JSC__JSGlobalObject__queueMicrotaskJob(
                    this.global_this,
                    cb,
                    JSValue::ZERO,
                    JSValue::ZERO,
                );
            }
        }
        this.close_jsvalue.deinit();
    }

    pub fn increment_count(&mut self) {
        self.ref_count += 1;
    }

    pub fn decrement_count(&mut self) -> u32 {
        if cfg!(debug_assertions) {
            if self.ref_count == 0 {
                panic!("Attempted to decrement ref count below zero");
            }
        }

        self.ref_count -= 1;
        if self.ref_count == 0 {
            self.close_jsvalue.deinit();
            self.context.deinit_fn();
            return 0;
        }

        self.ref_count
    }

    pub fn get_error(&mut self) -> Option<syscall::Error> {
        self.pending_err.take()
    }

    pub fn drain(&mut self) -> ByteList {
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

    /// `bun.TrivialDeinit(@This())` — drops the heap allocation. Called from
    /// context `deinit` (e.g. `ByteStream::finalize` → `parent().deinit()`).
    /// SAFETY: `self` must have been produced by [`Self::new`] (i.e.
    /// `Box::into_raw(Box::new(..))`) and must not be used after this call.
    pub unsafe fn deinit(&mut self) {
        // SAFETY: see fn-level doc — caller guarantees Box provenance.
        drop(unsafe { Box::from_raw(self as *mut Self) });
    }
}

// ─── local extension shim: `JSValue::withAsyncContextIfNeeded` ───────────────
// `bun_jsc::JSValue` doesn't yet re-export this; bind the C++ symbol locally
// (same pattern as `runtime/api/cron.rs` / `h2_frame_parser.rs`).
trait JSValueAsyncContextExt {
    fn with_async_context_if_needed(self, global: &JSGlobalObject) -> JSValue;
}
impl JSValueAsyncContextExt for JSValue {
    fn with_async_context_if_needed(self, global: &JSGlobalObject) -> JSValue {
        unsafe extern "C" {
            fn AsyncContextFrame__withAsyncContextIfNeeded(
                global: *const JSGlobalObject,
                callback: JSValue,
            ) -> JSValue;
        }
        // SAFETY: FFI into JSC bindings; `global` is a valid &JSGlobalObject.
        unsafe { AsyncContextFrame__withAsyncContextIfNeeded(global, self) }
    }
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
        let result = self.context.on_pull(buffer.slice_mut(), view);
        Self::process_result(this_jsvalue, global_this, arguments.ptr[1], result)
    }

    pub fn start_from_js(
        &mut self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.global_this = global_this;
        self.this_jsvalue = call_frame.this();
        match self.context.on_start() {
            streams::Start::Empty => Ok(JSValue::js_number(0.0)),
            streams::Start::Ready => Ok(JSValue::js_number(16384.0)),
            streams::Start::ChunkSize(size) => Ok(JSValue::js_number(size as f64)),
            streams::Start::Err(err) => Err(global_this.throw_value(err.to_js(global_this))),
            rc => rc.to_js(global_this),
        }
    }

    pub fn get_is_closed_from_js(&mut self, _global_object: &JSGlobalObject) -> JSValue {
        JSValue::from(self.is_closed)
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
                streams::StreamError::JSValue(js_err) => {
                    js_err.ensure_still_alive();
                    js_err.unprotect();
                    Err(global_this.throw_value(*js_err))
                }
                // Zig source has no other variants here; `WeakJSValue`/`AbortReason` are
                // post-Zig additions to the Rust enum — fall through like the default arm.
                _ => result.to_js(global_this),
            },
            streams::Result::Pending(_) => {
                let out = result.to_js(global_this)?;
                <Self as NewSourceCodegen>::pending_promise_set_cached(
                    this_jsvalue, global_this, out,
                );
                Ok(out)
            }
            streams::Result::TemporaryAndDone(_)
            | streams::Result::OwnedAndDone(_)
            | streams::Result::IntoArrayAndDone(_) => {
                let value = JSValue::TRUE;
                // SAFETY: flags is a JS object passed from builtin JS; index 0 is writable.
                unsafe {
                    JSObjectSetPropertyAtIndex(
                        global_this,
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
        self.global_this = global_object;

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
        self.global_this = global_object;

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
            self.this_jsvalue, global_object, cb,
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

    pub fn finalize(this: *mut Self) {
        // SAFETY: called from the JSC GC finalizer on the mutator thread; `this`
        // is the heap `m_ctx` pointer originally produced by [`Self::new`].
        let this = unsafe { &mut *this };
        this.this_jsvalue = JSValue::ZERO;
        let _ = this.decrement_count();
    }

    pub fn drain_from_js(
        &mut self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.this_jsvalue = call_frame.this();
        let mut list = self.drain();
        if list.len > 0 {
            return jsc::ArrayBuffer::from_bytes(list.slice_mut(), jsc::JSType::Uint8Array)
                .to_js(global_this);
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
        self.to_buffered_value_from_js(global_this, call_frame, streams::BufferActionTag::ArrayBuffer)
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

// JSC C-API extern (process_result writes the `done` flag at index 0).
// TODO(port): move to jsc_sys / re-export from `bun_jsc::c_api`.
#[allow(deprecated)]
unsafe extern "C" {
    fn JSObjectSetPropertyAtIndex(
        ctx: *const JSGlobalObject,
        object: jsc::c_api::JSObjectRef,
        property_index: core::ffi::c_uint,
        value: jsc::c_api::JSObjectRef,
        exception: *mut jsc::c_api::JSValueRef,
    );
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/ReadableStream.zig (853 lines)
//   confidence: medium
//   todos:      15
//   notes:      NewSource comptime fn-bundle → SourceContext trait; .classes.ts codegen accessors (js.*, toJS/fromJS, cached props) bound via SourceContext::JS_* consts + source_context_codegen! macro; global_this field lifetime needs Phase B decision.
// ──────────────────────────────────────────────────────────────────────────
