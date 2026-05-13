//! ResumableSink allows a simplified way of reading a stream into a native Writable Interface, allowing to pause and resume the stream without the use of promises.
//! returning false on `onWrite` will pause the stream and calling .drain() will resume the stream consumption.
//! onEnd is always called when the stream is done or errored.
//! Calling `cancel` will cancel the stream, onEnd will be called with the reason passed to cancel.
//! Different from JSSink this is not intended to be exposed to the users, like FileSink or HTTPRequestSink etc.

use bun_collections::{ByteVecExt, VecExt};
use core::cell::Cell;

use bun_core::String as BunString;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsRef, JsResult, SystemError};
use bun_output::{declare_scope, scoped_log};

use crate::node::{ErrorCode, StringOrBuffer};
use crate::webcore::fetch::fetch_tasklet::FetchTasklet;
use crate::webcore::s3::client::S3UploadStreamWrapper;
use crate::webcore::streams::Result as StreamResult;
use crate::webcore::{Pipe, PipeHandler, ReadableStream, Wrap};

declare_scope!(ResumableSink, visible);

/// Trait capturing the codegen'd JS-side accessors for a ResumableSink class
/// (e.g. `jsc.Codegen.JSResumableFetchSink`).
///
/// Models the Zig `comptime js: type` param, which carries a codegen module
/// (a bag of free fns) by value. Rust generics carry types, not modules, so
/// each monomorphization implements this trait by delegating to the matching
/// `bun_jsc::generated::JS*` module — see [`impl_resumable_sink_js!`] below.
pub trait ResumableSinkJs {
    fn to_js(this: *mut (), global: &JSGlobalObject) -> JSValue;
    fn from_js(value: JSValue) -> Option<*mut ()>;
    fn from_js_direct(value: JSValue) -> Option<*mut ()>;
    fn oncancel_set_cached(this_value: JSValue, global: &JSGlobalObject, value: JSValue);
    fn oncancel_get_cached(this_value: JSValue) -> Option<JSValue>;
    fn ondrain_set_cached(this_value: JSValue, global: &JSGlobalObject, value: JSValue);
    fn ondrain_get_cached(this_value: JSValue) -> Option<JSValue>;
    fn stream_set_cached(this_value: JSValue, global: &JSGlobalObject, value: JSValue);
    fn stream_get_cached(this_value: JSValue) -> Option<JSValue>;
}

/// Trait capturing the per-`Context` callbacks the sink invokes.
/// In Zig these are `Context.writeRequestData` / `Context.writeEndRequest`.
// Spec ResumableSink.zig:35 stores `context: *Context` (mutable). The only
// in-tree impls (FetchTasklet / S3UploadStreamWrapper) mutate self in both
// callbacks (e.g. `detachSink`, `deref`, clearing `endPromise`), so these
// MUST be `&mut self`.
pub trait ResumableSinkContext {
    fn write_request_data(&mut self, bytes: &[u8]) -> ResumableSinkBackpressure;
    fn write_end_request(&mut self, err: Option<JSValue>);
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Status {
    Started,
    Piped,
    Paused,
    Done,
}

// `#[repr(C)]` because this struct is the `m_ctx` payload of a generated
// JSCell wrapper and crosses FFI as `*mut Self` (see generated_classes.rs
// `${T}__create`/`${T}__fromJS`). C++ never dereferences it — it stores the
// pointer as `void*` — so field FFI-safety is moot, but a stable layout keeps
// `ResumableFetchSink__ZigStructSize` deterministic and silences the
// "unspecified layout" half of `improper_ctypes` at the extern block.
#[repr(C)]
#[derive(bun_ptr::CellRefCounted)]
pub struct ResumableSink<Js: ResumableSinkJs, Context: ResumableSinkContext> {
    pub ref_count: Cell<u32>,
    js_this: JsRef,
    /// We can have a detached self, and still have a strong reference to the stream
    stream: crate::webcore::readable_stream::Strong,
    /// `BackRef` rather than `&'a JSGlobalObject` because this struct is the
    /// `m_ctx` payload of a JSC heap cell — it crosses the FFI boundary
    /// (`${T}__create`/`${T}__fromJS`) and outlives any Rust borrow scope. The
    /// global outlives every JS object it allocates (back-reference invariant).
    global_this: bun_ptr::BackRef<JSGlobalObject>,
    context: *mut Context,
    high_water_mark: i64,
    status: Status,
    _js: core::marker::PhantomData<Js>,
}

impl<Js: ResumableSinkJs, Context: ResumableSinkContext> ResumableSink<Js, Context> {
    /// Borrow the owning [`JSGlobalObject`].
    ///
    /// SAFETY: `global_this` is set in [`Self::init_exact_refs`] from a live
    /// `&JSGlobalObject` and the global outlives every JS object (and thus
    /// every `m_ctx` payload) it allocates. Call sites that need to hold the
    /// borrow across `&mut self` mutations dereference `self.global_this`
    /// directly so the borrow is not tied to `&self`.
    #[inline]
    pub fn global(&self) -> &JSGlobalObject {
        self.global_this.get()
    }

    /// Current backpressure high-water mark in bytes (initialized to 16384,
    /// updated from the wrapped ByteStream on `init`/`set_stream_if_possible`).
    #[inline]
    pub fn high_water_mark(&self) -> i64 {
        self.high_water_mark
    }
    #[inline]
    fn set_cancel(this_value: JSValue, global: &JSGlobalObject, value: JSValue) {
        Js::oncancel_set_cached(this_value, global, value);
    }
    #[inline]
    fn get_cancel(this_value: JSValue) -> Option<JSValue> {
        Js::oncancel_get_cached(this_value)
    }
    #[inline]
    fn set_drain(this_value: JSValue, global: &JSGlobalObject, value: JSValue) {
        Js::ondrain_set_cached(this_value, global, value);
    }
    #[inline]
    fn get_drain(this_value: JSValue) -> Option<JSValue> {
        Js::ondrain_get_cached(this_value)
    }
    #[inline]
    fn set_stream(this_value: JSValue, global: &JSGlobalObject, value: JSValue) {
        Js::stream_set_cached(this_value, global, value);
    }
    #[allow(dead_code)]
    #[inline]
    fn get_stream(this_value: JSValue) -> Option<JSValue> {
        Js::stream_get_cached(this_value)
    }

    #[inline]
    fn on_write(ctx: *mut Context, bytes: &[u8]) -> ResumableSinkBackpressure {
        // SAFETY: `context` is a BACKREF to the owning Context (FetchTasklet /
        // S3UploadStreamWrapper) which outlives this sink — see LIFETIMES.tsv.
        // Dereferenced as `&mut` because impls mutate (detachSink, deref, etc.).
        unsafe { (*ctx).write_request_data(bytes) }
    }
    #[inline]
    fn on_end(ctx: *mut Context, err: Option<JSValue>) {
        // SAFETY: see on_write.
        unsafe { (*ctx).write_end_request(err) }
    }

    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<*mut Self> {
        Err(global.throw_illegal_constructor("ResumableSink"))
    }

    pub fn init(
        global_this: &JSGlobalObject,
        stream: ReadableStream,
        context: *mut Context,
    ) -> *mut Self {
        Self::init_exact_refs(global_this, stream, context, 1)
    }

    pub fn init_exact_refs(
        global_this: &JSGlobalObject,
        stream: ReadableStream,
        context: *mut Context,
        ref_count: u32,
    ) -> *mut Self {
        // `bun.TrivialNew(@This())` — heap-allocate via the global mimalloc;
        // `Self::deref_` reclaims via `heap::take` when the count hits 0.
        let this: *mut Self = bun_core::heap::into_raw(Box::new(Self {
            ref_count: Cell::new(ref_count),
            js_this: JsRef::empty(),
            stream: crate::webcore::readable_stream::Strong::default(),
            global_this: bun_ptr::BackRef::new(global_this),
            context,
            high_water_mark: 16384,
            status: Status::Started,
            _js: core::marker::PhantomData,
        }));
        // SAFETY: just allocated above; unique &mut for the remainder of this fn.
        let this_ref = unsafe { &mut *this };

        if stream.is_locked(global_this) || stream.is_disturbed(global_this) {
            // PORT NOTE: `SystemError` has no `Default` impl upstream — spell out
            // every field with its Zig default (SystemError.zig:1).
            let mut err = SystemError {
                errno: 0,
                code: BunString::static_(<&'static str>::from(ErrorCode::ERR_STREAM_CANNOT_PIPE)),
                message: BunString::static_("Stream already used, please create a new one"),
                path: BunString::EMPTY,
                syscall: BunString::EMPTY,
                hostname: BunString::EMPTY,
                fd: core::ffi::c_int::MIN,
                dest: BunString::EMPTY,
            };
            let err_instance = err.to_error_instance(global_this);
            err_instance.ensure_still_alive();
            this_ref.status = Status::Done;
            Self::on_end(this_ref.context, Some(err_instance));
            // SAFETY: `this` allocated above; may free here (see Zig — caller
            // gets a dangling ptr in the error path and must not deref it).
            unsafe { Self::deref_(this) };
            return this;
        }
        if let Some(byte_stream) = stream.ptr.bytes() {
            // BACKREF: see `Source::bytes()` — payload owned by `stream`.
            // R-2: all touched ByteStream methods/fields are `&self`/interior-mutable.
            // if pipe is empty, we can pipe
            if byte_stream.pipe.get().is_empty() {
                // equivalent to onStart to get the highWaterMark
                this_ref.high_water_mark = byte_stream.high_water_mark.min(i64::MAX as u64) as i64;

                if byte_stream.has_received_last_chunk.get() {
                    this_ref.status = Status::Done;
                    let err: Option<JSValue> = 'brk_err: {
                        let pending = &byte_stream.pending.get().result;
                        if let StreamResult::Err(e) = pending {
                            let (js_err, was_strong) = e.to_js_weak(global_this);
                            js_err.ensure_still_alive();
                            if was_strong == crate::webcore::streams::WasStrong::Strong {
                                js_err.unprotect();
                            }
                            break 'brk_err Some(js_err);
                        }
                        None
                    };

                    let bytes = byte_stream.drain();
                    // PORT NOTE: `defer bytes.deinit(bun.default_allocator)` deleted — `bytes`
                    // owns its buffer and Drop frees it.
                    scoped_log!(ResumableSink, "onWrite {}", bytes.len());
                    let _ = Self::on_write(this_ref.context, bytes.slice());
                    Self::on_end(this_ref.context, err);
                    // SAFETY: see the locked/disturbed branch above.
                    unsafe { Self::deref_(this) };
                    return this;
                }
                // We can pipe but we also wanna to drain as much as possible first
                let bytes = byte_stream.drain();
                // PORT NOTE: `defer bytes.deinit(...)` deleted — Drop frees it.
                // lets write and see if we can still pipe or if we have backpressure
                if bytes.len() > 0 {
                    scoped_log!(ResumableSink, "onWrite {}", bytes.len());
                    // we ignore the return value here because we dont want to pause the stream
                    // if we pause will just buffer in the pipe and we can do the buffer in one place
                    let _ = Self::on_write(this_ref.context, bytes.slice());
                }
                this_ref.status = Status::Piped;
                // PORT NOTE: jsc.WebCore.Pipe.Wrap(@This(), onStreamPipe).init(this) — the
                // Zig comptime fn-ptr param is reshaped as a `PipeHandler` impl on `Self`
                // (see `impl PipeHandler` below); `Wrap::<Self>::init` erases `this` into
                // the Pipe's ctx ptr.
                byte_stream.pipe.set(Wrap::<Self>::init(this_ref));
                this_ref.ref_(); // one ref for the pipe

                // we only need the stream, we dont need to touch JS side yet
                this_ref.stream =
                    crate::webcore::readable_stream::Strong::init(stream, global_this);
                return this;
            }
        }
        // lets go JS side route
        let self_ = Js::to_js(this.cast(), global_this);
        self_.ensure_still_alive();
        let js_stream = stream.to_js();
        js_stream.ensure_still_alive();
        this_ref.js_this.set_strong(self_, global_this);
        Self::set_stream(self_, global_this, js_stream);

        let _ = Bun__assignStreamIntoResumableSink(global_this, js_stream, self_);

        this
    }

    #[bun_jsc::host_fn(method)]
    pub fn js_set_handlers(
        _this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        let args = callframe.arguments();

        if args.len() < 2 {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "ResumableSink.setHandlers requires at least 2 arguments"
            )));
        }

        let ondrain = args[0];
        let oncancel = args[1];

        if ondrain.is_callable() {
            Self::set_drain(this_value, global_this, ondrain);
        }
        if oncancel.is_callable() {
            Self::set_cancel(this_value, global_this, oncancel);
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn js_start(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        let args = callframe.arguments();
        if args.len() > 0 && args[0].is_object() {
            if let Some(high_water_mark) =
                args[0].get_optional_int::<i64>(global_this, "highWaterMark")?
            {
                this.high_water_mark = high_water_mark;
            }
        }

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn js_write(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        let args = callframe.arguments();
        // ignore any call if detached
        if this.is_detached() {
            return Ok(JSValue::UNDEFINED);
        }

        if args.len() < 1 {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "ResumableSink.write requires at least 1 argument"
            )));
        }

        let buffer = args[0];
        let Some(sb) = StringOrBuffer::from_js(global_this, buffer)? else {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "ResumableSink.write requires a string or buffer"
            )));
        };

        // PORT NOTE: `defer sb.deinit()` deleted — StringOrBuffer impls Drop.
        let bytes = sb.slice();
        scoped_log!(ResumableSink, "jsWrite {}", bytes.len());
        match Self::on_write(this.context, bytes) {
            ResumableSinkBackpressure::Backpressure => {
                scoped_log!(ResumableSink, "paused");
                this.status = Status::Paused;
            }
            ResumableSinkBackpressure::Done => {}
            ResumableSinkBackpressure::WantMore => {
                this.status = Status::Started;
            }
        }

        Ok(JSValue::from(this.status != Status::Paused))
    }

    #[bun_jsc::host_fn(method)]
    pub fn js_end(
        this: &mut Self,
        _global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        bun_jsc::mark_binding!();
        let args = callframe.arguments();
        // ignore any call if detached
        if this.is_detached() {
            return Ok(JSValue::UNDEFINED);
        }
        this.detach_js();
        scoped_log!(ResumableSink, "jsEnd {}", args.len());
        this.status = Status::Done;

        Self::on_end(
            this.context,
            if args.len() > 0 { Some(args[0]) } else { None },
        );
        Ok(JSValue::UNDEFINED)
    }

    pub fn drain(&mut self) {
        scoped_log!(ResumableSink, "drain");
        if self.status != Status::Paused {
            return;
        }
        if let Some(js_this) = self.js_this.try_get() {
            let global_object = self.global_this;
            let global_object = global_object.get();

            if let Some(ondrain) = Self::get_drain(js_this) {
                self.status = Status::Started;
                // SAFETY: `bun_vm()` returns a live `*mut VirtualMachine` owned by
                // the global; `event_loop()` returns its self-referential
                // `*mut EventLoop`. Both outlive this call.
                unsafe {
                    (*global_object.bun_vm().as_mut().event_loop()).run_callback(
                        ondrain,
                        global_object,
                        JSValue::UNDEFINED,
                        &[JSValue::UNDEFINED, JSValue::UNDEFINED],
                    );
                }
            }
        }
    }

    pub fn cancel(&mut self, reason: JSValue) {
        // onEnd must fire at most once. After the first cancel(), js_this is downgraded
        // to .weak (which still resolves via tryGet), so this guard is the only thing
        // preventing a second cancel() from re-invoking onEnd.
        if self.status == Status::Done {
            return;
        }
        if self.status == Status::Piped {
            reason.ensure_still_alive();
            self.end_pipe(Some(reason));
            return;
        }
        if let Some(js_this) = self.js_this.try_get() {
            self.status = Status::Done;
            js_this.ensure_still_alive();

            let on_cancel_callback = Self::get_cancel(js_this);
            let global_object = self.global_this;
            let global_object = global_object.get();

            // detach first so if cancel calls end will be a no-op
            self.detach_js();

            // call onEnd to indicate the native side that the stream errored
            Self::on_end(self.context, Some(reason));

            js_this.ensure_still_alive();
            if let Some(callback) = on_cancel_callback {
                // SAFETY: see `drain()` — VM/event-loop pointers are live for the
                // global's lifetime.
                unsafe {
                    (*global_object.bun_vm().as_mut().event_loop()).run_callback(
                        callback,
                        global_object,
                        JSValue::UNDEFINED,
                        &[JSValue::UNDEFINED, reason],
                    );
                }
            }
        }
    }

    pub fn is_detached(&self) -> bool {
        !self.js_this.is_strong() || self.status == Status::Done
    }

    /// Detach the JS wrapper: clear the cached `ondrain`/`oncancel`/`stream`
    /// slots and downgrade `js_this` from a strong to a weak handle so the
    /// wrapper (and the `drainReaderIntoSink` closure it caches, which captures
    /// the reader/stream graph) becomes collectible. Unlike [`Self::cancel`]
    /// this does NOT run any JS callbacks or invoke `on_end`, so it is safe to
    /// call from contexts where executing JS is not allowed (e.g. teardown /
    /// finalizers).
    pub fn detach_js(&mut self) {
        if let Some(js_this) = self.js_this.try_get() {
            let global = self.global_this;
            let global = global.get();
            Self::set_drain(js_this, global, JSValue::ZERO);
            Self::set_cancel(js_this, global, JSValue::ZERO);
            Self::set_stream(js_this, global, JSValue::ZERO);
            self.js_this.downgrade();
        }
    }

    pub fn finalize(self: Box<Self>) {
        // Refcounted: release the JS wrapper's +1; allocation may outlive this
        // call if other refs remain, so hand ownership back to the raw refcount
        // FIRST so a panic in the work below leaks instead of UAF-ing siblings.
        let this = bun_core::heap::release(self);
        this.js_this.finalize();
        // SAFETY: `this` is the live m_ctx allocation; `deref_` frees on count==0.
        unsafe { Self::deref_(this) };
    }

    fn on_stream_pipe(&mut self, mut stream: StreamResult) {
        // PORT NOTE: Zig `onStreamPipe(this, stream, allocator)` frees
        // `.owned`/`.owned_and_done` payloads with the *caller-supplied*
        // allocator. The Rust `Pipe`/`PipeHandler` reshape drops the allocator
        // param because every producer (`ByteStream::on_data` — the sole `Pipe`
        // call site) allocates with `bun.default_allocator`, which is the same
        // global mimalloc that `Vec::<u8>::clear_and_free()` frees with. The
        // `defer { switch }` is hoisted to the tail below (after `end_pipe`)
        // since `StreamResult` has no `Drop` and `stream` is a stack local
        // independent of `self`.
        let chunk = stream.slice();
        scoped_log!(ResumableSink, "onWrite {}", chunk.len());

        // TODO: should the "done" state also trigger `endPipe`?
        let _ = Self::on_write(self.context, chunk);

        let is_done = stream.is_done();

        if is_done {
            let err: Option<JSValue> = 'brk_err: {
                if let StreamResult::Err(e) = &stream {
                    let (js_err, was_strong) = e.to_js_weak(self.global_this.get());
                    js_err.ensure_still_alive();
                    if was_strong == crate::webcore::streams::WasStrong::Strong {
                        js_err.unprotect();
                    }
                    break 'brk_err Some(js_err);
                }
                None
            };
            self.end_pipe(err);
            // `self` may now be dangling — do NOT touch it past this point.
        }

        // Zig `defer { owned.deinit(allocator) }` — see allocator note above.
        if let StreamResult::Owned(owned) | StreamResult::OwnedAndDone(owned) = &mut stream {
            owned.clear_and_free();
        }
    }

    fn end_pipe(&mut self, err: Option<JSValue>) {
        scoped_log!(ResumableSink, "endPipe");
        if self.status != Status::Piped {
            return;
        }
        self.status = Status::Done;
        let global_object = self.global_this;
        let global_object = global_object.get();
        if let Some(stream_) = self.stream.get(global_object) {
            // BACKREF: see `Source::bytes()` — live while `self.stream` Strong
            // holds it. R-2: `pipe` is `JsCell<Pipe>`; shared deref + `.set()`.
            if let Some(bytes) = stream_.ptr.bytes() {
                bytes.pipe.set(Pipe::default());
            }
            if err.is_some() {
                stream_.cancel(global_object);
            } else {
                stream_.done(global_object);
            }
            let stream = core::mem::take(&mut self.stream);
            drop(stream);
        }

        Self::on_end(self.context, err);

        let js_is_strong = self.js_this.is_strong();
        if js_is_strong {
            // JS owns the stream, so we need to detach the JS and let finalize handle the deref
            // this should not happen but lets handle it anyways
            self.detach_js();
        }
        // Last use of `&mut self`. Derive a raw pointer for the refcount
        // decrement(s) so no live `&mut` aliases the `heap::take` teardown
        // when the count reaches 0 (Stacked Borrows).
        let this: *mut Self = self;
        // SAFETY: `this` was allocated via `heap::alloc` in `init_exact_refs`
        // and is live until the final `deref_` below drops the count to 0.
        unsafe {
            if !js_is_strong {
                // no js attached, so we can just deref
                Self::deref_(this);
            }
            // We ref when we attach the stream so we deref when we detach the stream
            Self::deref_(this);
        }
    }

    // Intrusive refcount helpers (`bun.ptr.RefCount(@This(), "ref_count", deinit, .{})`).
    // `ref_()`/`deref()` are provided by `#[derive(CellRefCounted)]`; `deref_` is
    // kept as a thin alias so existing raw-pointer call sites (s3::client) keep
    // compiling without churn.
    #[inline]
    pub unsafe fn deref_(this: *mut Self) {
        // SAFETY: forwarded caller contract.
        unsafe { <Self as bun_ptr::CellRefCounted>::deref(this) }
    }
}

// Satisfies `Wrap<T: PipeHandler>` so `Wrap::<Self>::init` can erase `*mut Self`
// into a `Pipe`. Mirrors Zig `Pipe.Wrap(@This(), onStreamPipe)` where the
// comptime fn-ptr param is fixed to `on_stream_pipe`.
impl<Js: ResumableSinkJs, Context: ResumableSinkContext> PipeHandler
    for ResumableSink<Js, Context>
{
    #[inline]
    fn on_pipe(&mut self, stream: StreamResult) {
        self.on_stream_pipe(stream);
    }
}

impl<Js: ResumableSinkJs, Context: ResumableSinkContext> Drop for ResumableSink<Js, Context> {
    fn drop(&mut self) {
        // Zig `deinit`: detachJS + stream.deinit() + bun.destroy(this).
        // `bun.destroy` is the Box free (handled by deref_); stream Drop is automatic.
        self.detach_js();
    }
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum ResumableSinkBackpressure {
    WantMore,
    Backpressure,
    Done,
}

/// Wire a zero-sized marker type to the matching `bun_jsc::generated::JS*`
/// codegen module so it can stand in for the Zig `comptime js: type` param.
/// The marker is uninhabited (`enum {}`) — it carries the trait impl only.
macro_rules! impl_resumable_sink_js {
    ($($name:ident),* $(,)?) => {$(
        pub enum $name {}
        impl ResumableSinkJs for $name {
            #[inline]
            fn to_js(this: *mut (), global: &JSGlobalObject) -> JSValue {
                bun_jsc::generated::$name::to_js(this, global)
            }
            #[inline]
            fn from_js(value: JSValue) -> Option<*mut ()> {
                bun_jsc::generated::$name::from_js(value)
            }
            #[inline]
            fn from_js_direct(value: JSValue) -> Option<*mut ()> {
                bun_jsc::generated::$name::from_js_direct(value)
            }
            #[inline]
            fn oncancel_set_cached(this: JSValue, global: &JSGlobalObject, v: JSValue) {
                bun_jsc::generated::$name::oncancel_set_cached(this, global, v)
            }
            #[inline]
            fn oncancel_get_cached(this: JSValue) -> Option<JSValue> {
                bun_jsc::generated::$name::oncancel_get_cached(this)
            }
            #[inline]
            fn ondrain_set_cached(this: JSValue, global: &JSGlobalObject, v: JSValue) {
                bun_jsc::generated::$name::ondrain_set_cached(this, global, v)
            }
            #[inline]
            fn ondrain_get_cached(this: JSValue) -> Option<JSValue> {
                bun_jsc::generated::$name::ondrain_get_cached(this)
            }
            #[inline]
            fn stream_set_cached(this: JSValue, global: &JSGlobalObject, v: JSValue) {
                bun_jsc::generated::$name::stream_set_cached(this, global, v)
            }
            #[inline]
            fn stream_get_cached(this: JSValue) -> Option<JSValue> {
                bun_jsc::generated::$name::stream_get_cached(this)
            }
        }
    )*};
}
impl_resumable_sink_js!(JSResumableFetchSink, JSResumableS3UploadSink);

// Forward to the inherent methods on each Context type. The Zig spec uses
// duck-typed `Context.writeRequestData` / `Context.writeEndRequest`; in Rust we
// satisfy the trait bound by delegating to those inherent impls.
// (S3UploadStreamWrapper's impl lives next to its struct in s3/client.rs.)
impl ResumableSinkContext for FetchTasklet {
    #[inline]
    fn write_request_data(&mut self, bytes: &[u8]) -> ResumableSinkBackpressure {
        FetchTasklet::write_request_data(self, bytes)
    }
    #[inline]
    fn write_end_request(&mut self, err: Option<JSValue>) {
        FetchTasklet::write_end_request(self, err)
    }
}

pub type ResumableFetchSink = ResumableSink<JSResumableFetchSink, FetchTasklet>;
pub type ResumableS3UploadSink = ResumableSink<JSResumableS3UploadSink, S3UploadStreamWrapper>;

unsafe extern "C" {
    safe fn Bun__assignStreamIntoResumableSink(
        global_this: &JSGlobalObject,
        stream: JSValue,
        sink: JSValue,
    ) -> JSValue;
}

// ported from: src/runtime/webcore/ResumableSink.zig
