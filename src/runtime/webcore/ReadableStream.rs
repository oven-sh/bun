use core::ffi::c_void;
use core::ptr::NonNull;

use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_sys as syscall;
use bun_collections::ByteList;

use crate::webcore::{self, Blob, ByteBlobLoader, ByteStream, FileReader};
use crate::webcore::streams;

pub struct ReadableStream {
    pub value: JSValue,
    pub ptr: Source,
}

// ─── ReadableStream::Strong ──────────────────────────────────────────────────

pub struct Strong {
    held: bun_jsc::Strong, // jsc.Strong.Optional = .empty
}

impl Default for Strong {
    fn default() -> Self {
        Self { held: bun_jsc::Strong::empty() }
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
            held: bun_jsc::Strong::create(this.value, global),
        }
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
                    let mut blob = Blob::init_with_store(store.clone(), global_this);
                    blob.store.as_ref().unwrap().r#ref();
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
            Source::Blob(source) => unsafe { (*source).parent().cancel() },
            Source::File(source) => unsafe { (*source).parent().cancel() },
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

    pub fn from_owned_slice(
        global_this: &JSGlobalObject,
        bytes: Box<[u8]>,
        recommended_chunk_size: webcore::blob::SizeType,
    ) -> JsResult<JSValue> {
        let blob = Blob::init(bytes, global_this);
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
            webcore::blob::StoreData::Bytes(_) => {
                // TODO(port): Zig leaves `context: undefined` then calls `setup()` to initialize.
                // `MaybeUninit::uninit().assume_init()` is immediate UB in Rust regardless of later
                // init — reshape to `ByteBlobLoader::new_with_setup(blob, recommended_chunk_size)`
                // (out-param constructor → returning constructor) in Phase B.
                let _ = (blob, recommended_chunk_size);
                todo!("ByteBlobLoader::new_with_setup — Zig used uninit context + setup()")
            }
            webcore::blob::StoreData::File(_) => {
                let reader = NewSource::<FileReader>::new(NewSource {
                    global_this,
                    context: FileReader {
                        event_loop: jsc::EventLoopHandle::init(global_this.bun_vm().event_loop()),
                        start_offset: blob.offset,
                        max_size: if blob.size != Blob::MAX_SIZE { Some(blob.size) } else { None },
                        lazy: webcore::file_reader::Lazy::Blob(store.clone()),
                        ..Default::default()
                    },
                    ..Default::default()
                });
                store.r#ref();
                reader.to_readable_stream(global_this)
            }
            webcore::blob::StoreData::S3(s3) => {
                let credentials = s3.get_credentials();
                let path = s3.path();
                let proxy = global_this.bun_vm().transpiler.env.get_http_proxy(true, None, None);
                let proxy_url = proxy.as_ref().map(|p| p.href.as_slice());

                bun_s3::readable_stream(
                    credentials,
                    path,
                    blob.offset,
                    if blob.size != Blob::MAX_SIZE { Some(blob.size) } else { None },
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
            webcore::blob::StoreData::File(_) => {
                let reader = NewSource::<FileReader>::new(NewSource {
                    global_this,
                    context: FileReader {
                        event_loop: jsc::EventLoopHandle::init(global_this.bun_vm().event_loop()),
                        start_offset: offset,
                        lazy: webcore::file_reader::Lazy::Blob(store.clone()),
                        ..Default::default()
                    },
                    ..Default::default()
                });
                store.r#ref();
                reader.to_readable_stream(global_this)
            }
            _ => global_this.throw("Expected FileBlob"),
        }
    }

    pub fn from_pipe<P, R>(
        global_this: &JSGlobalObject,
        _parent: P,
        buffered_reader: R,
    ) -> JsResult<JSValue> {
        // TODO(port): `buffered_reader: anytype` — bound by whatever FileReader.reader.from() requires
        let mut source = NewSource::<FileReader>::new(NewSource {
            global_this,
            context: FileReader {
                event_loop: jsc::EventLoopHandle::init(global_this.bun_vm().event_loop()),
                ..Default::default()
            },
            ..Default::default()
        });
        // PORT NOTE: reshaped for borrowck — Zig passed `&source.context` as both reader-parent and self.
        let ctx_ptr: *mut FileReader = &mut source.context;
        source.context.reader.from(buffered_reader, ctx_ptr);

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
    pub close_jsvalue: bun_jsc::Strong,
    pub cancel_handler: Option<fn(Option<*mut c_void>)>,
    pub cancel_ctx: Option<*mut c_void>,
    // TODO(port): TSV says JSC_BORROW (&JSGlobalObject); heap m_ctx field reassigned in start() — Phase B decide &'static vs raw.
    pub global_this: &JSGlobalObject,
    // SAFETY: this is the self-wrapper JSValue (points at the JSCell that owns this m_ctx).
    // Kept alive by the wrapper itself; zeroed in finalize() before sweep.
    pub this_jsvalue: JSValue,
    pub is_closed: bool,
}

impl<C: SourceContext> NewSource<C> {
    /// `bun.TrivialNew(@This())`
    pub fn new(init: Self) -> Box<Self> {
        Box::new(init)
    }
    // `bun.TrivialDeinit(@This())` → drop(Box<Self>)

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
            handler(self.cancel_ctx);
        }
    }

    pub fn on_close(&mut self) {
        if self.cancelled {
            return;
        }
        if let Some(close) = self.close_handler.take() {
            if close as usize == js_readable_stream_source::on_close::<C> as usize {
                js_readable_stream_source::on_close::<C>(Some(self as *mut _ as *mut c_void));
            } else {
                close(self.close_ctx.map(|p| p.as_ptr()));
            }
        }
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
            self.close_jsvalue = bun_jsc::Strong::empty(); // close_jsvalue.deinit()
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
        let out_value = 'brk: {
            if !self.this_jsvalue.is_empty() {
                break 'brk self.this_jsvalue;
            }
            break 'brk self.to_js(global_this);
        };
        out_value.ensure_still_alive();
        self.this_jsvalue = out_value;
        ReadableStream::from_native(global_this, out_value)
    }

    // TODO(port): codegen-provided — `#[bun_jsc::JsClass]` wires this.
    pub fn to_js(&mut self, _global_this: &JSGlobalObject) -> JSValue {
        unimplemented!("provided by JsClass codegen")
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_raw_mode_from_js(
        this: &mut Self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let flag = call_frame.argument(0);
        debug_assert!(flag.is_boolean());
        match this.context.set_raw_mode(flag == JSValue::TRUE) {
            Some(bun_sys::Result::Ok(())) => Ok(JSValue::UNDEFINED),
            Some(bun_sys::Result::Err(e)) => Ok(e.to_js(global)),
            // Zig: @compileError("setRawMode is not implemented on " ++ @typeName(Context))
            None => unreachable!("setRawMode is not implemented on {}", C::NAME),
        }
    }

    #[bun_jsc::host_fn(method)]
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
}

// Aliases wired to .classes.ts codegen entries (Zig: `pub const drainFromJS = JSReadableStreamSource.drain;` etc.)
// In Rust the codegen references the fns in `js_readable_stream_source` directly by mangled name.
// TODO(port): proc-macro — codegen binds these via #[bun_jsc::JsClass] on NewSource<C>.

pub mod js_readable_stream_source {
    use super::*;

    #[bun_jsc::host_fn(method)]
    pub fn pull<C: SourceContext>(
        this: &mut NewSource<C>,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let this_jsvalue = call_frame.this();
        let arguments = call_frame.arguments_old(2);
        let view = arguments.ptr[0];
        view.ensure_still_alive();
        this.this_jsvalue = this_jsvalue;
        let Some(mut buffer) = view.as_array_buffer(global_this) else {
            return Ok(JSValue::UNDEFINED);
        };
        let result = this.on_pull_from_js(buffer.slice_mut(), view);
        process_result::<C>(this_jsvalue, global_this, arguments.ptr[1], result)
    }

    #[bun_jsc::host_fn(method)]
    pub fn start<C: SourceContext>(
        this: &mut NewSource<C>,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.global_this = global_this;
        this.this_jsvalue = call_frame.this();
        match this.on_start_from_js() {
            streams::Start::Empty => Ok(JSValue::js_number(0)),
            streams::Start::Ready => Ok(JSValue::js_number(16384)),
            streams::Start::ChunkSize(size) => Ok(JSValue::js_number(size)),
            streams::Start::Err(err) => global_this.throw_value(err.to_js(global_this)?),
            rc => rc.to_js(global_this),
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn is_closed<C: SourceContext>(
        this: &NewSource<C>,
        _global_object: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        Ok(JSValue::from(this.is_closed))
    }

    fn process_result<C: SourceContext>(
        this_jsvalue: JSValue,
        global_this: &JSGlobalObject,
        flags: JSValue,
        result: streams::Result,
    ) -> JsResult<JSValue> {
        match &result {
            streams::Result::Err(err) => match err {
                streams::ResultErr::Error(e) => {
                    global_this.throw_value(e.to_js(global_this)?)
                }
                streams::ResultErr::JSValue(js_err) => {
                    js_err.ensure_still_alive();
                    js_err.unprotect();
                    global_this.throw_value(*js_err)
                }
            },
            streams::Result::Pending => {
                let out = result.to_js(global_this)?;
                // TODO(port): codegen cached-property setter
                NewSource::<C>::js::pending_promise_set_cached(this_jsvalue, global_this, out);
                Ok(out)
            }
            streams::Result::TemporaryAndDone(_)
            | streams::Result::OwnedAndDone(_)
            | streams::Result::IntoArrayAndDone(_) => {
                let value = JSValue::TRUE;
                // SAFETY: flags is a JS object passed from builtin JS; index 0 is writable.
                unsafe {
                    jsc::C::JSObjectSetPropertyAtIndex(
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

    #[bun_jsc::host_fn(method)]
    pub fn cancel<C: SourceContext>(
        this: &mut NewSource<C>,
        _global_object: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.this_jsvalue = call_frame.this();
        this.cancel();
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_on_close_from_js<C: SourceContext>(
        this: &mut NewSource<C>,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<bool> {
        this.close_handler = Some(on_close::<C>);
        this.global_this = global_object;

        if value.is_undefined() {
            this.close_jsvalue = bun_jsc::Strong::empty();
            return Ok(true);
        }

        if !value.is_callable() {
            return global_object.throw_invalid_argument_type(
                "ReadableStreamSource",
                "onclose",
                "function",
            );
        }
        let cb = value.with_async_context_if_needed(global_object);
        this.close_jsvalue.set(global_object, cb);
        Ok(true)
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_on_drain_from_js<C: SourceContext>(
        this: &mut NewSource<C>,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<bool> {
        this.global_this = global_object;

        if value.is_undefined() {
            // TODO(port): codegen cached-property setter
            NewSource::<C>::js::on_drain_callback_set_cached(
                this.this_jsvalue,
                global_object,
                JSValue::UNDEFINED,
            );
            return Ok(true);
        }

        if !value.is_callable() {
            return global_object.throw_invalid_argument_type(
                "ReadableStreamSource",
                "onDrain",
                "function",
            );
        }
        let cb = value.with_async_context_if_needed(global_object);
        // TODO(port): codegen cached-property setter
        NewSource::<C>::js::on_drain_callback_set_cached(this.this_jsvalue, global_object, cb);
        Ok(true)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_on_close_from_js<C: SourceContext>(
        this: &NewSource<C>,
        _global_object: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        Ok(this.close_jsvalue.get().unwrap_or(JSValue::UNDEFINED))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_on_drain_from_js<C: SourceContext>(
        this: &NewSource<C>,
        _global_object: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        // TODO(port): codegen cached-property getter
        if let Some(val) = NewSource::<C>::js::on_drain_callback_get_cached(this.this_jsvalue) {
            return Ok(val);
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn update_ref<C: SourceContext>(
        this: &mut NewSource<C>,
        _global_object: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.this_jsvalue = call_frame.this();
        let ref_or_unref = call_frame.argument(0).to_boolean();
        this.set_ref(ref_or_unref);
        Ok(JSValue::UNDEFINED)
    }

    pub(super) fn on_close<C: SourceContext>(ptr: Option<*mut c_void>) {
        // SAFETY: ptr was set to `self as *mut NewSource<C>` in on_close()/set_on_close_from_js.
        let this = unsafe { &mut *(ptr.unwrap().cast::<NewSource<C>>()) };
        if let Some(cb) = this.close_jsvalue.try_swap() {
            this.global_this.queue_microtask(cb, &[]);
        }
        this.close_jsvalue = bun_jsc::Strong::empty();
    }

    pub fn finalize<C: SourceContext>(this: *mut NewSource<C>) {
        // SAFETY: called from JSC finalizer on mutator thread; `this` is the m_ctx ptr.
        let this = unsafe { &mut *this };
        this.this_jsvalue = JSValue::ZERO;
        let _ = this.decrement_count();
    }

    #[bun_jsc::host_fn(method)]
    pub fn drain<C: SourceContext>(
        this: &mut NewSource<C>,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.this_jsvalue = call_frame.this();
        let list = this.drain();
        if list.len > 0 {
            return jsc::ArrayBuffer::from_bytes(list.into_slice(), jsc::TypedArrayType::Uint8Array)
                .to_js(global_this);
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn text<C: SourceContext>(
        this: &mut NewSource<C>,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.this_jsvalue = call_frame.this();
        if let Some(r) = this.context.to_buffered_value(global_this, streams::BufferActionTag::Text) {
            return r;
        }
        global_this.throw_todo("This is not implemented yet");
        Ok(JSValue::ZERO)
    }

    #[bun_jsc::host_fn(method)]
    pub fn array_buffer<C: SourceContext>(
        this: &mut NewSource<C>,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.this_jsvalue = call_frame.this();
        if let Some(r) = this.context.to_buffered_value(global_this, streams::BufferActionTag::ArrayBuffer) {
            return r;
        }
        global_this.throw_todo("This is not implemented yet");
        Ok(JSValue::ZERO)
    }

    #[bun_jsc::host_fn(method)]
    pub fn blob<C: SourceContext>(
        this: &mut NewSource<C>,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.this_jsvalue = call_frame.this();
        if let Some(r) = this.context.to_buffered_value(global_this, streams::BufferActionTag::Blob) {
            return r;
        }
        global_this.throw_todo("This is not implemented yet");
        Ok(JSValue::ZERO)
    }

    #[bun_jsc::host_fn(method)]
    pub fn bytes<C: SourceContext>(
        this: &mut NewSource<C>,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.this_jsvalue = call_frame.this();
        if let Some(r) = this.context.to_buffered_value(global_this, streams::BufferActionTag::Bytes) {
            return r;
        }
        global_this.throw_todo("This is not implemented yet");
        Ok(JSValue::ZERO)
    }

    #[bun_jsc::host_fn(method)]
    pub fn json<C: SourceContext>(
        this: &mut NewSource<C>,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.this_jsvalue = call_frame.this();
        if let Some(r) = this.context.to_buffered_value(global_this, streams::BufferActionTag::Json) {
            return r;
        }
        global_this.throw_todo("This is not implemented yet");
        Ok(JSValue::ZERO)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/ReadableStream.zig (853 lines)
//   confidence: medium
//   todos:      15
//   notes:      NewSource comptime fn-bundle → SourceContext trait; .classes.ts codegen accessors (js.*, toJS/fromJS, cached props) need #[bun_jsc::JsClass] proc-macro; global_this field lifetime needs Phase B decision; from_blob_copy_ref Bytes arm stubbed with todo!() pending ByteBlobLoader constructor reshape.
// ──────────────────────────────────────────────────────────────────────────
