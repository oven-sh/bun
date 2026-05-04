//! ResumableSink allows a simplified way of reading a stream into a native Writable Interface, allowing to pause and resume the stream without the use of promises.
//! returning false on `onWrite` will pause the stream and calling .drain() will resume the stream consumption.
//! onEnd is always called when the stream is done or errored.
//! Calling `cancel` will cancel the stream, onEnd will be called with the reason passed to cancel.
//! Different from JSSink this is not intended to be exposed to the users, like FileSink or HTTPRequestSink etc.

use core::cell::Cell;

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsRef, JsResult, SystemError};
use bun_output::{declare_scope, scoped_log};
use bun_ptr::IntrusiveRc;
use bun_str::String as BunString;

use crate::node::{ErrorCode, StringOrBuffer};
use crate::webcore::fetch::FetchTasklet;
use crate::webcore::s3::client::S3UploadStreamWrapper;
use crate::webcore::streams::Result as StreamResult;
use crate::webcore::{ByteStream, Pipe, ReadableStream};

declare_scope!(ResumableSink, visible);

/// Trait capturing the codegen'd JS-side accessors for a ResumableSink class
/// (e.g. `jsc.Codegen.JSResumableFetchSink`).
// TODO(port): this models the Zig `comptime js: type` param which carries the
// codegen module's static fns. Phase B should replace with the actual
// `#[bun_jsc::JsClass]` derive output once codegen emits Rust.
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
pub trait ResumableSinkContext {
    fn write_request_data(&self, bytes: &[u8]) -> ResumableSinkBackpressure;
    fn write_end_request(&self, err: Option<JSValue>);
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Status {
    Started,
    Piped,
    Paused,
    Done,
}

pub struct ResumableSink<'a, Js: ResumableSinkJs, Context: ResumableSinkContext> {
    pub ref_count: Cell<u32>,
    js_this: JsRef,
    /// We can have a detached self, and still have a strong reference to the stream
    stream: crate::webcore::readable_stream::Strong,
    global_this: &'a JSGlobalObject,
    context: *const Context,
    high_water_mark: i64,
    status: Status,
    _js: core::marker::PhantomData<Js>,
}

impl<'a, Js: ResumableSinkJs, Context: ResumableSinkContext> ResumableSink<'a, Js, Context> {
    // TODO(port): `pub const new = bun.TrivialNew(@This())` — IntrusiveRc::new / Box::into_raw
    // pattern; the codegen `m_ctx` owns the allocation.

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
    fn on_write(ctx: *const Context, bytes: &[u8]) -> ResumableSinkBackpressure {
        // SAFETY: `context` is a BACKREF to the owning Context (FetchTasklet /
        // S3UploadStreamWrapper) which outlives this sink — see LIFETIMES.tsv.
        unsafe { (*ctx).write_request_data(bytes) }
    }
    #[inline]
    fn on_end(ctx: *const Context, err: Option<JSValue>) {
        // SAFETY: see on_write.
        unsafe { (*ctx).write_end_request(err) }
    }

    #[bun_jsc::host_fn]
    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<*mut Self> {
        Err(global.throw_invalid_arguments("ResumableSink is not constructable", &[]))
    }

    pub fn init(
        global_this: &'a JSGlobalObject,
        stream: ReadableStream,
        context: *const Context,
    ) -> *mut Self {
        Self::init_exact_refs(global_this, stream, context, 1)
    }

    pub fn init_exact_refs(
        global_this: &'a JSGlobalObject,
        stream: ReadableStream,
        context: *const Context,
        ref_count: u32,
    ) -> *mut Self {
        // TODO(port): bun.TrivialNew — allocate via IntrusiveRc / Box::into_raw so
        // ref/deref + finalize can free it.
        let this: *mut Self = Box::into_raw(Box::new(Self {
            ref_count: Cell::new(ref_count),
            js_this: JsRef::empty(),
            stream: crate::webcore::readable_stream::Strong::default(),
            global_this,
            context,
            high_water_mark: 16384,
            status: Status::Started,
            _js: core::marker::PhantomData,
        }));
        // SAFETY: just allocated above; unique &mut for the remainder of this fn.
        let this_ref = unsafe { &mut *this };

        if stream.is_locked(global_this) || stream.is_disturbed(global_this) {
            let mut err = SystemError {
                code: BunString::static_(<&'static str>::from(ErrorCode::ERR_STREAM_CANNOT_PIPE)),
                message: BunString::static_("Stream already used, please create a new one"),
                ..Default::default()
            };
            let err_instance = err.to_error_instance(global_this);
            err_instance.ensure_still_alive();
            this_ref.status = Status::Done;
            Self::on_end(this_ref.context, Some(err_instance));
            this_ref.deref_();
            return this;
        }
        if let crate::webcore::readable_stream::Ptr::Bytes(byte_stream_ptr) = stream.ptr {
            // SAFETY: ReadableStream.ptr.Bytes is a live *ByteStream owned by the stream.
            let byte_stream: &mut ByteStream = unsafe { &mut *byte_stream_ptr };
            // if pipe is empty, we can pipe
            if byte_stream.pipe.is_empty() {
                // equivalent to onStart to get the highWaterMark
                this_ref.high_water_mark = if byte_stream.high_water_mark < i64::MAX as u64 {
                    // TODO(port): exact integer types — Zig used @intCast from byte_stream.highWaterMark
                    i64::try_from(byte_stream.high_water_mark).unwrap()
                } else {
                    i64::MAX
                };

                if byte_stream.has_received_last_chunk {
                    this_ref.status = Status::Done;
                    let err: Option<JSValue> = 'brk_err: {
                        let pending = &byte_stream.pending.result;
                        if let crate::webcore::streams::PendingResult::Err(e) = pending {
                            let (js_err, was_strong) = e.to_js_weak(this_ref.global_this);
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
                    this_ref.deref_();
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
                // TODO(port): jsc.WebCore.Pipe.Wrap(@This(), onStreamPipe).init(this) — Pipe
                // stores an erased ctx ptr + fn ptr. Phase B: implement Pipe::wrap<T>(ctx, fn).
                byte_stream.pipe = Pipe::wrap::<Self>(this, Self::on_stream_pipe);
                this_ref.ref_(); // one ref for the pipe

                // we only need the stream, we dont need to touch JS side yet
                this_ref.stream =
                    crate::webcore::readable_stream::Strong::init(stream, this_ref.global_this);
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

        // SAFETY: FFI call; all args are valid JSC handles.
        let _ = unsafe { Bun__assignStreamIntoResumableSink(global_this, js_stream, self_) };

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
            return Err(global_this.throw_invalid_arguments(
                "ResumableSink.setHandlers requires at least 2 arguments",
                &[],
            ));
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
            return Err(global_this
                .throw_invalid_arguments("ResumableSink.write requires at least 1 argument", &[]));
        }

        let buffer = args[0];
        let Some(sb) = StringOrBuffer::from_js(global_this, buffer)? else {
            return Err(global_this
                .throw_invalid_arguments("ResumableSink.write requires a string or buffer", &[]));
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

        Self::on_end(this.context, if args.len() > 0 { Some(args[0]) } else { None });
        Ok(JSValue::UNDEFINED)
    }

    pub fn drain(&mut self) {
        scoped_log!(ResumableSink, "drain");
        if self.status != Status::Paused {
            return;
        }
        if let Some(js_this) = self.js_this.try_get() {
            let global_object = self.global_this;

            if let Some(ondrain) = Self::get_drain(js_this) {
                self.status = Status::Started;
                global_object.bun_vm().event_loop().run_callback(
                    ondrain,
                    global_object,
                    JSValue::UNDEFINED,
                    &[JSValue::UNDEFINED, JSValue::UNDEFINED],
                );
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

            // detach first so if cancel calls end will be a no-op
            self.detach_js();

            // call onEnd to indicate the native side that the stream errored
            Self::on_end(self.context, Some(reason));

            js_this.ensure_still_alive();
            if let Some(callback) = on_cancel_callback {
                let event_loop = global_object.bun_vm().event_loop();
                event_loop.run_callback(
                    callback,
                    global_object,
                    JSValue::UNDEFINED,
                    &[JSValue::UNDEFINED, reason],
                );
            }
        }
    }

    pub fn is_detached(&self) -> bool {
        !self.js_this.is_strong() || self.status == Status::Done
    }

    fn detach_js(&mut self) {
        if let Some(js_this) = self.js_this.try_get() {
            Self::set_drain(js_this, self.global_this, JSValue::ZERO);
            Self::set_cancel(js_this, self.global_this, JSValue::ZERO);
            Self::set_stream(js_this, self.global_this, JSValue::ZERO);
            self.js_this.downgrade();
        }
    }

    pub fn finalize(this: *mut Self) {
        // SAFETY: called from JSC finalize on the mutator thread; `this` is the m_ctx ptr.
        unsafe {
            (*this).js_this.finalize();
            // Route through the same hand-rolled refcount path as ref_/deref_
            // so teardown (Box::from_raw on count==0) is spelled exactly once.
            (*this).deref_();
        }
    }

    fn on_stream_pipe(&mut self, stream: StreamResult) {
        // PORT NOTE: Zig copied `stream` to `stream_` and conditionally deinit'd
        // `.owned` / `.owned_and_done` payloads in a `defer`. In Rust the
        // StreamResult variants own their buffers and Drop handles this; the
        // explicit `stream_needs_deinit` dance is deleted.
        // TODO(port): verify StreamResult Drop matches Zig semantics for
        // non-owned variants (must NOT free borrowed slices).
        let chunk = stream.slice();
        scoped_log!(ResumableSink, "onWrite {}", chunk.len());

        // TODO: should the "done" state also trigger `endPipe`?
        let _ = Self::on_write(self.context, chunk);

        let is_done = stream.is_done();

        if is_done {
            let err: Option<JSValue> = 'brk_err: {
                if let StreamResult::Err(e) = &stream {
                    let (js_err, was_strong) = e.to_js_weak(self.global_this);
                    js_err.ensure_still_alive();
                    if was_strong == crate::webcore::streams::WasStrong::Strong {
                        js_err.unprotect();
                    }
                    break 'brk_err Some(js_err);
                }
                None
            };
            self.end_pipe(err);
        }
    }

    fn end_pipe(&mut self, err: Option<JSValue>) {
        scoped_log!(ResumableSink, "endPipe");
        if self.status != Status::Piped {
            return;
        }
        self.status = Status::Done;
        let global_object = self.global_this;
        if let Some(stream_) = self.stream.get(global_object) {
            if let crate::webcore::readable_stream::Ptr::Bytes(bytes_ptr) = stream_.ptr {
                // SAFETY: ByteStream is live while the ReadableStream.Strong holds it.
                unsafe { (*bytes_ptr).pipe = Pipe::default() };
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

        if self.js_this.is_strong() {
            // JS owns the stream, so we need to detach the JS and let finalize handle the deref
            // this should not happen but lets handle it anyways
            self.detach_js();
        } else {
            // no js attached, so we can just deref
            self.deref_();
        }

        // We ref when we attach the stream so we deref when we detach the stream
        self.deref_();
    }

    // Intrusive refcount helpers (bun.ptr.RefCount).
    #[inline]
    pub fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }
    #[inline]
    pub fn deref_(&self) {
        // TODO(port): IntrusiveRc::deref_raw — when count hits 0, run Drop and
        // free the Box allocated in init_exact_refs.
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            // SAFETY: allocated via Box::into_raw in init_exact_refs; count==0
            // means no other live refs.
            unsafe { drop(Box::from_raw(self as *const Self as *mut Self)) };
        }
    }
}

impl<'a, Js: ResumableSinkJs, Context: ResumableSinkContext> Drop
    for ResumableSink<'a, Js, Context>
{
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

pub type ResumableFetchSink<'a> =
    ResumableSink<'a, bun_jsc::codegen::JSResumableFetchSink, FetchTasklet>;
pub type ResumableS3UploadSink<'a> =
    ResumableSink<'a, bun_jsc::codegen::JSResumableS3UploadSink, S3UploadStreamWrapper>;

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn Bun__assignStreamIntoResumableSink(
        global_this: *const JSGlobalObject,
        stream: JSValue,
        sink: JSValue,
    ) -> JSValue;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/ResumableSink.zig (372 lines)
//   confidence: medium
//   todos:      8
//   notes:      comptime js/Context params modeled as traits; IntrusiveRc plumbing + Pipe::wrap + StreamResult variant names need Phase B wiring
// ──────────────────────────────────────────────────────────────────────────
