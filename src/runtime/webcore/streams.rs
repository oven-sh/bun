use core::ffi::c_void;
use core::ptr::NonNull;

use bun_ptr::{BackRef, RawSlice};

use crate::webcore::jsc::{
    self as jsc, ArrayBuffer, CommonAbortReason, CommonAbortReasonExt as _, JSGlobalObject,
    JSPromise, JSPromiseStrong, JSType, JSValue, JsResult, SysErrorJsc, VirtualMachine,
};
use bun_collections::{ByteVecExt, VecExt};
use bun_core::{FeatureFlags, strings};
use bun_sys::{self as sys, Error as SysError, Fd};
use bun_uws as uws;

use crate::webcore::blob::Any as AnyBlob;
use crate::webcore::sink::Sink;
use crate::webcore::{AutoFlusher, ByteListPool};

// scope statics renamed with `Log` suffix so they don't collide with
// the `HTTPServerWritable<SSL,H3>` / `NetworkSink` *types* defined below
// (RequestContext was blocked on this name clash).
bun_core::declare_scope!(HTTPServerWritableLog, visible);
bun_core::declare_scope!(NetworkSinkLog, visible);

/// `bun.ObjectPool(bun.Vec<u8>, ...)::Node` — pooled buffer node type used by
/// `HTTPServerWritable.pooled_buffer`.
pub type ByteListPoolNode = bun_collections::pool::Node<Vec<u8>>;

// NetworkSink stores a borrowed `*MultiPartUpload`. Now that `webcore::s3` is
// wired, alias the module to the real type so `bun_s3::MultiPartUpload` resolves
// for callers that still spell it that way.
pub mod bun_s3 {
    pub use crate::webcore::s3::MultiPartUpload;
}

/// `Blob.SizeType` is `u64` (see `webcore::blob::SizeType`).
// alias the canonical `webcore::BlobSizeType` so `SignalVTable.ready`'s
// fn-pointer signature is structurally identical to callers that name the public
// re-export (e.g. `sink::SinkSignal::init`).
type BlobSizeType = crate::webcore::BlobSizeType;

/// Upper bound on a JS-supplied `highWaterMark` used as an initial capacity
/// hint. WHATWG permits `Infinity`; clamp here (monotonic, unlike the Zig
/// `@truncate(i51)` wrap) and reserve fallibly at the allocation site.
const MAX_HIGH_WATER_MARK: i64 = 256 * 1024 * 1024;

#[inline]
fn high_water_mark_from_js(value: JSValue, min: BlobSizeType) -> BlobSizeType {
    // `to_int64` maps NaN→0 and saturates ±Infinity; clamp in i64 before the
    // unsigned cast so Infinity/negatives/out-of-range never reach the allocator.
    let n = value.to_int64();
    (min as i64).max(n).min(MAX_HIGH_WATER_MARK) as BlobSizeType
}

// Compat: `webcore::Pipe` and Body refer to `streams::Result` / `streams::result::StreamError`.
pub use StreamResult as Result;
pub mod result {
    pub use super::{StreamError, StreamResult, Writable};
}

// ──────────────────────────────────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────────────────────────────────

/// Options payload for the `Start::FileSink` variant.
pub type FileSinkOptions = crate::webcore::file_sink::Options;

pub enum Start {
    Empty,
    Err(SysError),
    ChunkSize(BlobSizeType),
    ArrayBufferSink {
        chunk_size: BlobSizeType,
        as_uint8array: bool,
        stream: bool,
    },
    FileSink(FileSinkOptions),
    HTTPSResponseSink,
    HTTPResponseSink,
    H3ResponseSink,
    NetworkSink,
    Ready,
    OwnedAndDone(Vec<u8>),
    Done(Vec<u8>),
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, core::marker::ConstParamTy)]
pub enum StartTag {
    Empty,
    Err,
    ChunkSize,
    ArrayBufferSink,
    FileSink,
    HTTPSResponseSink,
    HTTPResponseSink,
    H3ResponseSink,
    NetworkSink,
    Ready,
    OwnedAndDone,
    Done,
}

impl Start {
    pub fn to_js(self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            Start::Empty | Start::Ready => Ok(JSValue::UNDEFINED),
            Start::ChunkSize(chunk) => Ok(JSValue::from(chunk)),
            Start::Err(err) => Err(err.throw(global_this)),
            Start::OwnedAndDone(list) => {
                // The allocation is handed to JSC (no-copy +
                // MarkedArrayBuffer_deallocator). `list` is an owned Vec whose Drop would
                // free the same buffer → double-free. Suppress Drop via ManuallyDrop so
                // JSC is the sole owner.
                let mut list = core::mem::ManuallyDrop::new(list);
                let ab = ArrayBuffer::from_bytes(list.slice_mut(), JSType::Uint8Array);
                ab.to_js(global_this)
            }
            Start::Done(list) => {
                ArrayBuffer::create::<{ JSType::Uint8Array }>(global_this, list.slice())
            }
            _ => Ok(JSValue::UNDEFINED),
        }
    }

    pub fn from_js(global_this: &JSGlobalObject, value: JSValue) -> JsResult<Start> {
        if value.is_empty_or_undefined_or_null() || !value.is_object() {
            return Ok(Start::Empty);
        }

        if let Some(chunk_size) = value.get(global_this, b"chunkSize")? {
            if chunk_size.is_number() {
                return Ok(Start::ChunkSize(high_water_mark_from_js(chunk_size, 0)));
            }
        }

        Ok(Start::Empty)
    }

    /// Runtime-tag dispatcher for `from_js_with_tag`. The per-sink tag is
    /// `JsSinkType::START_TAG` (a runtime `Option<StartTag>`); this match
    /// re-enters the tag-specific body.
    pub fn from_js_with_runtime_tag(
        global_this: &JSGlobalObject,
        value: JSValue,
        tag: StartTag,
    ) -> JsResult<Start> {
        match tag {
            StartTag::ArrayBufferSink => {
                Self::from_js_with_tag::<{ StartTag::ArrayBufferSink }>(global_this, value)
            }
            StartTag::FileSink => {
                Self::from_js_with_tag::<{ StartTag::FileSink }>(global_this, value)
            }
            StartTag::NetworkSink => {
                Self::from_js_with_tag::<{ StartTag::NetworkSink }>(global_this, value)
            }
            StartTag::HTTPSResponseSink => {
                Self::from_js_with_tag::<{ StartTag::HTTPSResponseSink }>(global_this, value)
            }
            StartTag::HTTPResponseSink => {
                Self::from_js_with_tag::<{ StartTag::HTTPResponseSink }>(global_this, value)
            }
            StartTag::H3ResponseSink => {
                Self::from_js_with_tag::<{ StartTag::H3ResponseSink }>(global_this, value)
            }
            // No `Start` variant carries these tags from JS.
            _ => Self::from_js(global_this, value),
        }
    }

    pub fn from_js_with_tag<const TAG: StartTag>(
        global_this: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<Start> {
        if value.is_empty_or_undefined_or_null() || !value.is_object() {
            return Ok(Start::Empty);
        }

        match TAG {
            StartTag::ArrayBufferSink => {
                let mut as_uint8array = false;
                let mut stream = false;
                let mut chunk_size: BlobSizeType = 0;
                let mut empty = true;

                if let Some(val) =
                    value.get_own(global_this, &bun_core::String::static_str("asUint8Array"))?
                {
                    if val.is_boolean() {
                        as_uint8array = val.to_boolean();
                        empty = false;
                    }
                }

                if let Some(val) = value.fast_get(global_this, jsc::BuiltinName::Stream)? {
                    if val.is_boolean() {
                        stream = val.to_boolean();
                        empty = false;
                    }
                }

                if let Some(chunk_size_val) =
                    value.fast_get(global_this, jsc::BuiltinName::HighWaterMark)?
                {
                    if chunk_size_val.is_number() {
                        empty = false;
                        chunk_size = high_water_mark_from_js(chunk_size_val, 0);
                    }
                }

                if !empty {
                    return Ok(Start::ArrayBufferSink {
                        chunk_size,
                        as_uint8array,
                        stream,
                    });
                }
            }
            StartTag::FileSink => {
                let mut chunk_size: BlobSizeType = 0;

                if let Some(chunk_size_val) =
                    value.fast_get(global_this, jsc::BuiltinName::HighWaterMark)?
                {
                    if chunk_size_val.is_number() {
                        chunk_size = high_water_mark_from_js(chunk_size_val, 0);
                    }
                }

                if let Some(path) = value.fast_get(global_this, jsc::BuiltinName::Path)? {
                    if !path.is_string() {
                        return Ok(Start::Err(SysError {
                            errno: sys::SystemErrno::EINVAL as _,
                            syscall: sys::Tag::write,
                            ..Default::default()
                        }));
                    }

                    return Ok(Start::FileSink(FileSinkOptions {
                        chunk_size,
                        input_path: crate::webcore::PathOrFileDescriptor::Path(
                            path.to_slice(global_this)?,
                        ),
                        ..Default::default()
                    }));
                } else if let Some(fd_value) = value.get_truthy(global_this, b"fd")? {
                    if !fd_value.is_any_int() {
                        return Ok(Start::Err(SysError {
                            errno: sys::SystemErrno::EBADF as _,
                            syscall: sys::Tag::write,
                            ..Default::default()
                        }));
                    }

                    use bun_sys_jsc::FdJsc as _;
                    if let Some(fd) = Fd::from_js(fd_value) {
                        return Ok(Start::FileSink(FileSinkOptions {
                            chunk_size,
                            input_path: crate::webcore::PathOrFileDescriptor::Fd(fd),
                            ..Default::default()
                        }));
                    } else {
                        return Ok(Start::Err(SysError {
                            errno: sys::SystemErrno::EBADF as _,
                            syscall: sys::Tag::write,
                            ..Default::default()
                        }));
                    }
                }

                return Ok(Start::FileSink(FileSinkOptions {
                    input_path: crate::webcore::PathOrFileDescriptor::Fd(Fd::INVALID),
                    chunk_size,
                    ..Default::default()
                }));
            }
            StartTag::NetworkSink
            | StartTag::HTTPSResponseSink
            | StartTag::HTTPResponseSink
            | StartTag::H3ResponseSink => {
                let mut empty = true;
                let mut chunk_size: BlobSizeType = 2048;

                if let Some(chunk_size_val) =
                    value.fast_get(global_this, jsc::BuiltinName::HighWaterMark)?
                {
                    if chunk_size_val.is_number() {
                        empty = false;
                        chunk_size = high_water_mark_from_js(chunk_size_val, 256);
                    }
                }

                if !empty {
                    return Ok(Start::ChunkSize(chunk_size));
                }
            }
            _ => {
                // Dead for every valid TAG; runtime unreachable until
                // `generic_const_exprs` lets us hoist to a compile error.
                unreachable!("Unsupported StartTag");
            }
        }

        Ok(Start::Empty)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Result
// ──────────────────────────────────────────────────────────────────────────

pub enum StreamResult {
    // Self-referential: the pointee's `Pending.result` points back at this value, so a
    // `&'a mut Pending` borrow can't be expressed; raw pointer with the BORROW_PARAM
    // contract (pointee strictly outlives this result).
    Pending(*mut Pending),
    Err(StreamError),
    Done,
    Owned(Vec<u8>),
    OwnedAndDone(Vec<u8>),
    // `temporary*` payloads are borrowed slices into caller-owned
    // memory that strictly outlives the synchronous consumer call. Stored as
    // `RawSlice<u8>` (raw fat pointer, no Drop) — the consumer must copy
    // before returning and never retain the slice. See `RawSlice` invariant.
    TemporaryAndDone(RawSlice<u8>),
    Temporary(RawSlice<u8>),
    IntoArray(IntoArray),
    IntoArrayAndDone(IntoArray),
}

impl StreamResult {
    pub fn release(&mut self) {
        match self {
            StreamResult::Owned(owned) | StreamResult::OwnedAndDone(owned) => {
                owned.clear_and_free()
            }
            StreamResult::Err(StreamError::JSValue(s)) => s.deinit(),
            _ => {}
        }
    }
}

pub enum StreamError {
    Error(SysError),
    AbortReason(CommonAbortReason),
    JSValue(jsc::strong::Optional),
}

impl StreamError {
    pub fn to_js(&self, global_object: &JSGlobalObject) -> JSValue {
        match self {
            StreamError::Error(err) => err.to_js(global_object),
            StreamError::JSValue(v) => v.get().unwrap_or(JSValue::UNDEFINED),
            StreamError::AbortReason(reason) => reason.to_js(global_object),
        }
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum ResultTag {
    Pending,
    Err,
    Done,
    Owned,
    OwnedAndDone,
    TemporaryAndDone,
    Temporary,
    IntoArray,
    IntoArrayAndDone,
}

impl StreamResult {
    pub fn slice16(&self) -> &[u16] {
        // Caller guarantees bytes are u16-aligned and even length;
        // bytemuck checks both at runtime.
        bytemuck::cast_slice(self.slice())
    }

    pub fn slice(&self) -> &[u8] {
        match self {
            StreamResult::Owned(owned) => owned.slice(),
            StreamResult::OwnedAndDone(owned_and_done) => owned_and_done.slice(),
            StreamResult::TemporaryAndDone(temporary_and_done) => temporary_and_done.slice(),
            StreamResult::Temporary(temporary) => temporary.slice(),
            _ => b"",
        }
    }
}

// ─── Result.Writable ─────────────────────────────────────────────────────

pub enum Writable {
    // Self-referential via WritablePending.result (see StreamResult::Pending above);
    // raw pointer with the BORROW_PARAM contract.
    Pending(*mut WritablePending),
    Err(SysError),
    Done,
    Owned(BlobSizeType),
    /// The bytes were accepted, but the transport is now backed up. `to_js()`
    /// reports `-(len + 1)` so the JS write loop can detect backpressure
    /// without conflating it with `Pending` (FileSink on Windows returns a
    /// Promise on every write — `Promise < 0` is false, so `readStreamIntoSink`
    /// keeps its main-branch behavior for non-HTTP sinks). The drain itself is
    /// awaited via `flush(true)` → `pending_flush`.
    Backpressure(BlobSizeType),
    OwnedAndDone(BlobSizeType),
    TemporaryAndDone(BlobSizeType),
    Temporary(BlobSizeType),
    IntoArray(BlobSizeType),
    IntoArrayAndDone(BlobSizeType),
}

pub struct WritablePending {
    pub future: WritableFuture,
    pub result: Writable,
    pub consumed: BlobSizeType,
    pub state: PendingState,
}

impl Default for WritablePending {
    fn default() -> Self {
        Self {
            future: WritableFuture::None,
            result: Writable::Done,
            consumed: 0,
            state: PendingState::None,
        }
    }
}

// `WritablePending` / `WritableFuture` only own the JSPromiseStrong field —
// JSPromiseStrong implements Drop, so no explicit Drop impl is needed here.

pub enum WritableFuture {
    None,
    Promise {
        strong: JSPromiseStrong,
        // JSC_BORROW: process-lifetime VM global; safe `Deref` via `BackRef`.
        global: BackRef<JSGlobalObject>,
    },
    Handler(WritableHandler),
}

impl WritablePending {
    pub fn promise(&mut self, global_this: &JSGlobalObject) -> *mut JSPromise {
        self.state = PendingState::Pending;

        match &self.future {
            WritableFuture::Promise { strong, .. } => std::ptr::from_mut::<JSPromise>(strong.get()),
            _ => {
                self.future = WritableFuture::Promise {
                    strong: JSPromiseStrong::init(global_this),
                    global: BackRef::new(global_this),
                };
                match &self.future {
                    WritableFuture::Promise { strong, .. } => {
                        std::ptr::from_mut::<JSPromise>(strong.get())
                    }
                    _ => unreachable!(),
                }
            }
        }
    }
}

pub struct WritableHandler {
    pub ctx: *mut c_void,
    pub handler: WritableHandlerFn,
}

pub type WritableHandlerFn = fn(ctx: *mut c_void, result: Writable);

/// Implementors provide the write-completion callback.
pub trait WritablePendingCallback {
    fn on_handle(&mut self, result: Writable);
}

impl WritableHandler {
    pub fn init<C: WritablePendingCallback>(&mut self, ctx: &mut C) {
        self.ctx = std::ptr::from_mut::<C>(ctx).cast::<c_void>();
        self.handler = {
            fn on_handle<C: WritablePendingCallback>(ctx_: *mut c_void, result: Writable) {
                // SAFETY: ctx was stored from &mut C in init()
                let ctx = unsafe { bun_ptr::callback_ctx::<C>(ctx_) };
                ctx.on_handle(result);
            }
            on_handle::<C>
        };
    }
}

impl WritablePending {
    /// Record that `bytes` were submitted while the destination is still
    /// pending. The caller buffers `bytes` itself; this only updates
    /// `consumed` and pins the state at `Pending` so a later `run()` resolves
    /// the buffered amount.
    ///
    /// This is the minimal implementation matching the html_rewriter
    /// call shape.
    pub fn apply_backpressure(&mut self, _output: &mut Sink<'_>, bytes: &[u8]) {
        self.consumed = self.consumed.saturating_add(bytes.len() as BlobSizeType);
        self.state = PendingState::Pending;
    }

    pub fn run(&mut self) {
        if self.state != PendingState::Pending {
            return;
        }
        self.state = PendingState::Used;
        // `consumed` belongs to the operation being settled here; the next one
        // starts from zero.
        self.consumed = 0;

        match core::mem::replace(&mut self.future, WritableFuture::None) {
            WritableFuture::Promise { mut strong, global } => {
                Writable::fulfill_promise(
                    core::mem::replace(&mut self.result, Writable::Done),
                    strong.swap(),
                    &global,
                );
            }
            WritableFuture::Handler(h) => {
                self.future = WritableFuture::Handler(WritableHandler {
                    ctx: h.ctx,
                    handler: h.handler,
                });
                // Reset self.result to Done here —
                // verify no caller reads it after run().
                (h.handler)(h.ctx, core::mem::replace(&mut self.result, Writable::Done));
            }
            WritableFuture::None => {}
        }
    }
}

impl Writable {
    pub fn is_done(&self) -> bool {
        matches!(
            self,
            Writable::OwnedAndDone(_)
                | Writable::TemporaryAndDone(_)
                | Writable::IntoArrayAndDone(_)
                | Writable::Done
                | Writable::Err(_)
        )
    }

    pub fn fulfill_promise(
        result: Writable,
        promise: &mut JSPromise,
        global_this: &JSGlobalObject,
    ) {
        // Adopt the caller's outstanding protect(); Drop unprotects on all paths.
        let _guard = jsc::js_value::Protected::adopt(promise.to_js());
        match result {
            Writable::Err(err) => {
                let _ = promise.reject_with_async_stack(global_this, Ok(err.to_js(global_this)));
                // TODO: properly propagate exception upwards
            }
            Writable::Done => {
                let _ = promise.resolve(global_this, JSValue::FALSE);
                // TODO: properly propagate exception upwards
            }
            other => {
                let _ = promise.resolve(global_this, other.to_js(global_this));
                // TODO: properly propagate exception upwards
            }
        }
    }

    pub fn to_js(self, global_this: &JSGlobalObject) -> JSValue {
        match self {
            Writable::Err(err) => {
                JSPromise::rejected_promise(global_this, err.to_js(global_this)).to_js()
            }
            Writable::Owned(len) => JSValue::from(len),
            // Negative sentinel; the writer awaits the drain via `flush(true)`.
            Writable::Backpressure(len) => JSValue::js_number(-((len as f64) + 1.0)),
            Writable::OwnedAndDone(len) => JSValue::from(len),
            Writable::TemporaryAndDone(len) => JSValue::from(len),
            Writable::Temporary(len) => JSValue::from(len),
            Writable::IntoArray(len) => JSValue::from(len),
            Writable::IntoArrayAndDone(len) => JSValue::from(len),
            // false == controller.close()
            // undefined == noop, but we probably won't send it
            Writable::Done => JSValue::TRUE,
            Writable::Pending(pending) => {
                // SAFETY: pending is a valid borrowed pointer per BORROW_PARAM classification
                let prom = unsafe { &mut *pending }.promise(global_this);
                // S008: `JSPromise` is an `opaque_ffi!` ZST — safe `*const → &` deref.
                JSPromise::opaque_ref(prom).to_js()
            }
        }
    }
}

// ─── Result.IntoArray ────────────────────────────────────────────────────

#[derive(Copy, Clone)]
pub struct IntoArray {
    pub value: JSValue,
    pub len: BlobSizeType,
}

impl Default for IntoArray {
    fn default() -> Self {
        Self {
            value: JSValue::default(),
            len: BlobSizeType::MAX,
        }
    }
}

// ─── Result.Pending ──────────────────────────────────────────────────────

pub struct Pending {
    pub future: PendingFuture,
    pub result: StreamResult,
    pub state: PendingState,
}

impl Default for Pending {
    fn default() -> Self {
        Self {
            // A Handler with null ctx is the inert placeholder;
            // always overwritten before the future is invoked.
            future: PendingFuture::Handler(PendingHandler {
                ctx: core::ptr::null_mut(),
                handler: |_, _| {},
            }),
            result: StreamResult::Done,
            state: PendingState::None,
        }
    }
}

/// Implementors provide the callback for Result.Pending.
pub trait PendingCallback {
    fn on_handle(&mut self, result: StreamResult);
}

impl Pending {
    pub fn set<C: PendingCallback>(&mut self, ctx: &mut C) {
        self.future.init::<C>(ctx);
        self.state = PendingState::Pending;
    }

    pub fn promise(&mut self, global_object: &JSGlobalObject) -> *mut JSPromise {
        let prom = std::ptr::from_mut::<JSPromise>(JSPromise::create(global_object));
        self.future = PendingFuture::Promise {
            promise: prom,
            global_this: BackRef::new(global_object),
        };
        self.state = PendingState::Pending;
        prom
    }

    pub fn run_on_next_tick(&mut self) {
        if self.state != PendingState::Pending {
            return;
        }
        // SAFETY: VirtualMachine::get() returns the per-thread singleton VM; sole
        // `&`-borrow on this thread, outlives this call.
        let vm = VirtualMachine::get();
        if vm.is_shutting_down() {
            return;
        }

        let clone = Box::new(core::mem::take(self));
        // `mem::take` resets `state`/`result`/`future` via `Default`;
        // no reader observes `future` after this.
        // VM event loop is a singleton; temporary `&mut` is the sole borrow
        // for the duration of `enqueue_task` (no re-entry into Rust).
        // `Task::from_boxed` owns the `Box → *mut` leak; the matching
        // `heap::take` lives in `run_from_js_thread` (the dispatch arm).
        vm.event_loop_ref()
            .enqueue_task(bun_event_loop::Task::from_boxed(clone));
    }

    /// # Safety
    /// `this` must be a valid, uniquely-owned pointer previously produced by
    /// `bun_core::heap::into_raw` (via `Task::from_boxed` in `run_on_next_tick`).
    // Forwards `this` to `bun_core::heap::take` without dereferencing it here;
    // not_unsafe_ptr_arg_deref is a false positive on opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn run_from_js_thread(this: *mut Pending) {
        // SAFETY: this was heap-allocated in run_on_next_tick
        let mut boxed = unsafe { bun_core::heap::take(this) };
        boxed.run();
        drop(boxed);
    }
}

impl bun_event_loop::Taskable for Pending {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::StreamPending;
}

pub enum PendingFuture {
    Promise {
        // JSC_BORROW: raw `*mut JSPromise`, GC-rooted via protect/unprotect (protected when
        // stored, unprotected when the future is fulfilled or deinitialized).
        promise: *mut JSPromise,
        // JSC_BORROW: process-lifetime VM global; safe `Deref` via `BackRef`.
        global_this: BackRef<JSGlobalObject>,
    },
    Handler(PendingHandler),
}

impl PendingFuture {
    pub fn init<C: PendingCallback>(&mut self, ctx: &mut C) {
        let mut handler = PendingHandler {
            ctx: core::ptr::null_mut(),
            handler: |_, _| {},
        };
        handler.init::<C>(ctx);
        *self = PendingFuture::Handler(handler);
    }
}

pub struct PendingHandler {
    pub ctx: *mut c_void,
    pub handler: PendingHandlerFn,
}

pub type PendingHandlerFn = fn(ctx: *mut c_void, result: StreamResult);

impl PendingHandler {
    pub fn init<C: PendingCallback>(&mut self, ctx: &mut C) {
        self.ctx = std::ptr::from_mut::<C>(ctx).cast::<c_void>();
        self.handler = {
            fn on_handle<C: PendingCallback>(ctx_: *mut c_void, result: StreamResult) {
                // SAFETY: ctx was stored from &mut C in init()
                let ctx = unsafe { bun_ptr::callback_ctx::<C>(ctx_) };
                ctx.on_handle(result);
            }
            on_handle::<C>
        };
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum PendingState {
    None,
    Pending,
    Used,
}

// ──────────────────────────────────────────────────────────────────────────
// JSC-integration: Pending::run, StreamResult::to_js/fulfill_promise, Signal,
// HTTPServerWritable<*> impl, NetworkSink impl, BufferAction, ReadResult.
// ──────────────────────────────────────────────────────────────────────────

impl Pending {
    pub fn run(&mut self) {
        if self.state != PendingState::Pending {
            return;
        }
        self.state = PendingState::Used;
        match &self.future {
            PendingFuture::Promise {
                promise,
                global_this,
            } => {
                StreamResult::fulfill_promise(&mut self.result, *promise, global_this);
            }
            PendingFuture::Handler(h) => {
                // Reset self.result to Done here —
                // verify no caller reads it after run().
                (h.handler)(
                    h.ctx,
                    core::mem::replace(&mut self.result, StreamResult::Done),
                );
            }
        }
    }
}

impl StreamResult {
    pub fn is_done(&self) -> bool {
        matches!(
            self,
            StreamResult::OwnedAndDone(_)
                | StreamResult::TemporaryAndDone(_)
                | StreamResult::IntoArrayAndDone(_)
                | StreamResult::Done
                | StreamResult::Err(_)
        )
    }

    pub fn fulfill_promise(
        result: &mut StreamResult,
        promise: *mut JSPromise,
        global_this: &JSGlobalObject,
    ) {
        // dropped (only used for read-only `event_loop()`) before any re-entrant call.
        let vm = global_this.bun_vm();
        // A long-lived `&mut EventLoop` / `&mut JSPromise` held across
        // re-entrant resolve/reject would alias any
        // `&mut` the re-entered JS path materializes through `vm.event_loop()` or the
        // same promise. `event_loop_ref()` is the audited safe accessor that forms a
        // fresh temporary `&mut EventLoop` per call so no two `&mut` are live at once.
        // S008: `JSPromise` is an `opaque_ffi!` ZST — safe `*const → &` deref.
        // Adopt the caller's outstanding protect(); Drop unprotects on all paths.
        let _unprotect = jsc::js_value::Protected::adopt(JSPromise::opaque_ref(promise).to_js());

        vm.event_loop_ref().enter();
        // cannot capture &mut event_loop in scopeguard while also using
        // `promise` (borrowck); call exit() explicitly on each path instead.

        match result {
            StreamResult::Err(err) => {
                let value = err.to_js(global_this);
                value.ensure_still_alive();
                *result = StreamResult::Temporary(RawSlice::EMPTY);
                // S008: `JSPromise` is an `opaque_ffi!` ZST — safe `*mut → &mut`
                // deref. Fresh temp `&mut` is the sole borrow across this
                // re-entrant call (no long-lived `&mut JSPromise` held).
                let _ =
                    JSPromise::opaque_mut(promise).reject_with_async_stack(global_this, Ok(value));
                // TODO: properly propagate exception upwards
            }
            StreamResult::Done => {
                // S008: see reject_with_async_stack above; fresh temp `&mut`.
                let _ = JSPromise::opaque_mut(promise).resolve(global_this, JSValue::FALSE);
                // TODO: properly propagate exception upwards
            }
            _ => {
                let value = match result.to_js(global_this) {
                    Ok(v) => v,
                    Err(err) => {
                        *result = StreamResult::Temporary(RawSlice::EMPTY);
                        // S008: see reject_with_async_stack above; fresh temp `&mut`.
                        let _ = JSPromise::opaque_mut(promise).reject(global_this, Err(err));
                        // TODO: properly propagate exception upwards
                        vm.event_loop_ref().exit();
                        return;
                    }
                };
                value.ensure_still_alive();

                *result = StreamResult::Temporary(RawSlice::EMPTY);
                // S008: see reject_with_async_stack above; fresh temp `&mut`.
                let _ = JSPromise::opaque_mut(promise).resolve(global_this, value);
                // TODO: properly propagate exception upwards
            }
        }
        vm.event_loop_ref().exit();
    }

    pub fn to_js(&mut self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        if VirtualMachine::get().is_shutting_down() {
            // `release()` frees `.owned`/`.owned_and_done` ByteLists and
            // unprotects `.err.JSValue` instead of leaking on the shutdown path.
            self.release();
            return Ok(JSValue::ZERO);
        }

        match self {
            StreamResult::Owned(list) => {
                // The buffer is handed to JSC; the later
                // `*result = Temporary(...)` in fulfill_promise drops the old Vec,
                // double-freeing the allocation now owned by JSC. Move it out and suppress
                // Drop so JSC's MarkedArrayBuffer_deallocator is the sole owner.
                let mut taken = core::mem::ManuallyDrop::new(core::mem::take(list));
                let ab = ArrayBuffer::from_bytes(taken.slice_mut(), JSType::Uint8Array);
                ab.to_js(global_this)
            }
            StreamResult::OwnedAndDone(list) => {
                // see Owned arm above — same ownership transfer to JSC.
                let mut taken = core::mem::ManuallyDrop::new(core::mem::take(list));
                let ab = ArrayBuffer::from_bytes(taken.slice_mut(), JSType::Uint8Array);
                ab.to_js(global_this)
            }
            StreamResult::Temporary(temp) | StreamResult::TemporaryAndDone(temp) => {
                // Allocate an uninitialized Uint8Array and
                // memcpy the temporary chunk into it — avoids the extra zeroing that
                // `ArrayBuffer::create` would do.
                let temp_slice = temp.slice();
                let array =
                    JSValue::create_uninitialized_uint8_array(global_this, temp_slice.len())?;
                let mut buf = array
                    .as_array_buffer(global_this)
                    .expect("freshly created Uint8Array has a backing buffer");
                buf.slice_mut()[..temp_slice.len()].copy_from_slice(temp_slice);
                Ok(array)
            }
            StreamResult::IntoArray(array) => Ok(JSValue::from(array.len)),
            StreamResult::IntoArrayAndDone(array) => Ok(JSValue::from(array.len)),
            StreamResult::Pending(pending) => {
                // SAFETY: pending is a valid borrowed pointer per BORROW_PARAM classification
                let promise = unsafe { &mut **pending }.promise(global_this);
                // S008: `JSPromise` is an `opaque_ffi!` ZST — safe `*const → &` deref.
                let promise_js = JSPromise::opaque_ref(promise).to_js();
                promise_js.protect();
                Ok(promise_js)
            }
            StreamResult::Err(err) => {
                let js_err = err.to_js(global_this);
                js_err.ensure_still_alive();
                Ok(JSPromise::rejected_promise(global_this, js_err).to_js())
            }
            // false == controller.close()
            // undefined == noop, but we probably won't send it
            StreamResult::Done => Ok(JSValue::FALSE),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Signal
// ──────────────────────────────────────────────────────────────────────────

// `#[repr(C)]` is load-bearing: C++ (`*Sink__assignToStream` in JSSink.cpp)
// receives `&mut signal.ptr` cast to `void**` and writes the controller cell's
// encoded `JSValue` bits through it. Callers project to `.ptr` directly via
// `addr_of_mut!`, so field *order* is not strictly required, but we pin the
// layout anyway so the FFI contract is auditable and the const-asserts below
// hold by construction rather than by repr(Rust) accident.
#[repr(C)]
#[derive(Default)]
pub struct Signal {
    pub ptr: Option<NonNull<c_void>>,
    pub vtable: SignalVTable,
}

// Layout guarantees the FFI cast `*mut Option<NonNull<c_void>>` → `*mut *mut
// c_void` relies on (Rust guarantees the niche optimisation for
// `Option<NonNull<T>>`, but make it a hard compile error if that ever changes
// or someone reorders/retypes the field):
const _: () = {
    assert!(core::mem::offset_of!(Signal, ptr) == 0);
    assert!(core::mem::size_of::<Option<NonNull<c_void>>>() == core::mem::size_of::<*mut c_void>());
    assert!(
        core::mem::align_of::<Option<NonNull<c_void>>>() == core::mem::align_of::<*mut c_void>()
    );
};

impl Signal {
    pub fn clear(&mut self) {
        self.ptr = None;
    }

    pub fn is_dead(&self) -> bool {
        self.ptr.is_none()
    }

    /// # Safety
    /// `handler` must be either null (dead signal) or a valid `*mut T` that
    /// outlives every call routed through this `Signal`.
    pub unsafe fn init_with_type<T: SignalHandler>(handler: *mut T) -> Signal {
        // this is nullable when used as a JSValue
        Signal {
            ptr: NonNull::new(handler.cast::<c_void>()),
            vtable: SignalVTable::wrap::<T>(),
        }
    }

    pub fn init<T: SignalHandler>(handler: &mut T) -> Signal {
        // SAFETY: &mut T is a valid non-null pointer
        unsafe { Self::init_with_type(std::ptr::from_mut::<T>(handler)) }
    }

    pub fn close(&mut self, err: Option<SysError>) {
        if self.is_dead() {
            return;
        }
        (self.vtable.close)(self.ptr.unwrap().as_ptr(), err);
    }

    pub fn ready(&mut self, amount: Option<BlobSizeType>, offset: Option<BlobSizeType>) {
        if self.is_dead() {
            return;
        }
        (self.vtable.ready)(self.ptr.unwrap().as_ptr(), amount, offset);
    }

    pub fn start(&mut self) {
        if self.is_dead() {
            return;
        }
        (self.vtable.start)(self.ptr.unwrap().as_ptr());
    }
}

pub type SignalOnCloseFn = fn(this: *mut c_void, err: Option<SysError>);
pub type SignalOnReadyFn =
    fn(this: *mut c_void, amount: Option<BlobSizeType>, offset: Option<BlobSizeType>);
pub type SignalOnStartFn = fn(this: *mut c_void);

#[derive(Copy, Clone)]
pub struct SignalVTable {
    pub close: SignalOnCloseFn,
    pub ready: SignalOnReadyFn,
    pub start: SignalOnStartFn,
}

impl Default for SignalVTable {
    fn default() -> Self {
        fn dead_close(_: *mut c_void, _: Option<SysError>) {}
        fn dead_ready(_: *mut c_void, _: Option<BlobSizeType>, _: Option<BlobSizeType>) {}
        fn dead_start(_: *mut c_void) {}
        SignalVTable {
            close: dead_close,
            ready: dead_ready,
            start: dead_start,
        }
    }
}

/// Implementors provide the `on_close`/`on_ready`/`on_start` callbacks.
pub trait SignalHandler {
    fn on_close(&mut self, err: Option<SysError>);
    fn on_ready(&mut self, amount: Option<BlobSizeType>, offset: Option<BlobSizeType>);
    fn on_start(&mut self);
}

impl SignalVTable {
    pub fn wrap<W: SignalHandler>() -> SignalVTable {
        fn on_close<W: SignalHandler>(this: *mut c_void, err: Option<SysError>) {
            // SAFETY: this was stored from &mut W in Signal::init_with_type
            unsafe { bun_ptr::callback_ctx::<W>(this) }.on_close(err);
        }
        fn on_ready<W: SignalHandler>(
            this: *mut c_void,
            amount: Option<BlobSizeType>,
            offset: Option<BlobSizeType>,
        ) {
            // SAFETY: this was stored from &mut W in Signal::init_with_type
            unsafe { bun_ptr::callback_ctx::<W>(this) }.on_ready(amount, offset);
        }
        fn on_start<W: SignalHandler>(this: *mut c_void) {
            // SAFETY: this was stored from &mut W in Signal::init_with_type
            unsafe { bun_ptr::callback_ctx::<W>(this) }.on_start();
        }

        // Rust cannot const-promote a generic-dependent struct literal to
        // `&'static`, so the vtable is stored by-value in `Signal` instead
        // (three fn pointers — same size as the pointed-to payload a
        // `&'static VTable` would dereference to anyway).
        SignalVTable {
            close: on_close::<W>,
            ready: on_ready::<W>,
            start: on_start::<W>,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// HTTPServerWritable
// ──────────────────────────────────────────────────────────────────────────

// Selecting the response type from the const generics would require an
// associated-type trait keyed on them. The pointer is kept opaque at the
// type level; all dispatch happens at runtime through `any_res()` / `uws::AnyResponse`.
pub type UwsResponse<const SSL: bool, const HTTP3: bool> = c_void;

/// A large `controller.write()` whose unwritten tail is held by reference
/// instead of being copied into the uWS backpressure std::string. The bytes
/// are kept valid by `.protect()` on the JS cell plus `pin()` on the backing
/// `ArrayBuffer` (so `transfer()` copies instead of detaching). Resumed from
/// the stored offset on `on_writable`.
#[derive(Clone, Copy)]
pub struct PendingPinnedWrite {
    /// Body bytes not yet accepted by the kernel / cork buffer. Borrows the
    /// pinned `ArrayBuffer`'s backing store; advanced in place on drain.
    remaining: *const [u8],
    /// The JS cell (ArrayBuffer or view) to `unprotect()` + `unpin()` on
    /// release. `ZERO` when no write is held.
    pinned_value: JSValue,
}

impl Default for PendingPinnedWrite {
    fn default() -> Self {
        Self {
            remaining: core::ptr::slice_from_raw_parts(core::ptr::null(), 0),
            pinned_value: JSValue::ZERO,
        }
    }
}

impl PendingPinnedWrite {
    #[inline]
    fn is_some(&self) -> bool {
        self.remaining.len() > 0
    }
}

pub struct HTTPServerWritable<const SSL: bool, const HTTP3: bool> {
    pub res: Option<*mut UwsResponse<SSL, HTTP3>>,
    pub buffer: Vec<u8>,
    pub pooled_buffer: Option<NonNull<ByteListPoolNode>>,
    pub offset: BlobSizeType,

    pub is_listening_for_abort: bool,
    pub wrote: BlobSizeType,

    // allocator field dropped — global mimalloc per §Allocators
    pub done: bool,
    pub signal: Signal,
    pub pending_flush: Option<*mut JSPromise>,
    pub wrote_at_start_of_flush: BlobSizeType,
    // JSC_BORROW: process-lifetime VM global; `None` until `flush_from_js`/
    // `end_from_js` install it. Safe `Deref` via `BackRef`.
    pub global_this: Option<BackRef<JSGlobalObject>>,
    pub high_water_mark: BlobSizeType,

    pub requested_end: bool,

    pub has_backpressure: bool,
    pub end_len: usize,
    pub aborted: bool,
    pub pending_pinned_write: PendingPinnedWrite,
    /// This sink fully ended the uWS response (`res.end()` / a completed
    /// `res.try_end()`). On HTTP/1 uWS `markDone()` drops `onAborted` at that
    /// point, so the owning `RequestContext` is never told if the peer closes
    /// afterwards and its `resp` must not be dereferenced again: by the time
    /// the parked stream-resolution microtask runs, uSockets may already have
    /// freed the socket (`us_internal_free_closed_sockets`) or recycled it
    /// onto the next keep-alive request. `handle_resolve_stream` /
    /// `handle_reject_stream` consult this instead of reading the response's
    /// state. HTTP/1 only; see `end_already_responded_stream` for why
    /// `Http3Response::markDone()` makes the H3 `resp` still safe to use.
    pub ended_response: bool,

    pub on_first_write: Option<fn(Option<*mut c_void>)>,
    pub ctx: Option<*mut c_void>,

    pub auto_flusher: AutoFlusher,
}

impl<const SSL: bool, const HTTP3: bool> Default for HTTPServerWritable<SSL, HTTP3> {
    fn default() -> Self {
        Self {
            res: None,
            buffer: Vec::<u8>::default(),
            pooled_buffer: None,
            offset: 0,
            is_listening_for_abort: false,
            wrote: 0,
            done: false,
            signal: Signal::default(),
            pending_flush: None,
            wrote_at_start_of_flush: 0,
            global_this: None,
            high_water_mark: 2048,
            requested_end: false,
            has_backpressure: false,
            end_len: 0,
            aborted: false,
            pending_pinned_write: PendingPinnedWrite::default(),
            ended_response: false,
            on_first_write: None,
            ctx: None,
            auto_flusher: AutoFlusher::default(),
        }
    }
}

impl<const SSL: bool, const HTTP3: bool> HTTPServerWritable<SSL, HTTP3> {
    /// Borrow the JS global stored at construction.
    ///
    /// Invariant: `global_this` is set before first use (any auto-flusher
    /// registration / pending-flush creation) and the VM-owned global outlives
    /// this sink (JSC_BORROW). Never `None` once initialized.
    #[inline]
    pub fn global_this(&self) -> &JSGlobalObject {
        self.global_this
            .as_ref()
            .expect("HTTPServerWritable.global_this used before init")
            .get()
    }

    pub fn connect(&mut self, signal: Signal) {
        self.signal = signal;
    }

    /// Don't include @sizeOf(This) because it's already included in the memoryCost of the sink
    pub fn memory_cost(&self) -> usize {
        // TODO: include Socket send buffer size. We can't here because we
        // don't track if it's still accessible.
        // Since this is a JSSink, the NewJSSink function does @sizeOf(JSSink) which includes @sizeOf(ArrayBufferSink).
        self.buffer.capacity() as usize
    }

    pub const NAME: &'static str = if HTTP3 {
        "H3ResponseSink"
    } else if SSL {
        "HTTPSResponseSink"
    } else {
        "HTTPResponseSink"
    };
    // associated const with const-generic if — requires `#![feature(generic_const_exprs)]` or a trait-based dispatch.
}

/// Per-monomorphization JSSink wrapper alias. Mirrors
/// `pub const JSSink = Sink.JSSink(@This(), name)`.
pub type HTTPServerWritableJSSink<const SSL: bool, const HTTP3: bool> =
    crate::webcore::sink::JSSink<HTTPServerWritable<SSL, HTTP3>>;

// `HTTPServerWritable` is exposed to JS via `Sink.JSSink(@This(), name)` where
// `name` ∈ {HTTPResponseSink, HTTPSResponseSink, H3ResponseSink}. Const-generics
// can't drive `#[link_name]`, so declare all three extern sets in a private mod
// and dispatch at call time on `(SSL, HTTP3)`. The branch is on const generics;
// the optimizer folds it to a direct call per monomorphization.
mod http_sink_abi {
    crate::decl_js_sink_externs!("HTTPResponseSink" as http);
    crate::decl_js_sink_externs!("HTTPSResponseSink" as https);
    crate::decl_js_sink_externs!("H3ResponseSink" as h3);
}

macro_rules! http_sink_dispatch {
    ($f:ident($($arg:expr),*)) => {
        if HTTP3 {
            http_sink_abi::h3::$f($($arg),*)
        } else if SSL {
            http_sink_abi::https::$f($($arg),*)
        } else {
            http_sink_abi::http::$f($($arg),*)
        }
    };
}

impl<const SSL: bool, const HTTP3: bool> crate::webcore::sink::JsSinkAbi
    for HTTPServerWritable<SSL, HTTP3>
{
    fn from_js_extern(value: JSValue) -> usize {
        http_sink_dispatch!(from_js(value))
    }
    fn create_object_extern(
        global: &JSGlobalObject,
        object: *mut c_void,
        destructor: usize,
    ) -> JSValue {
        http_sink_dispatch!(create_object(global, object, destructor))
    }
    fn set_destroy_callback_extern(value: JSValue, callback: usize) {
        http_sink_dispatch!(set_destroy_callback(value, callback))
    }
    fn assign_to_stream_extern(
        global: &JSGlobalObject,
        stream: JSValue,
        ptr: *mut c_void,
        jsvalue_ptr: *mut *mut c_void,
    ) -> JSValue {
        http_sink_dispatch!(assign_to_stream(global, stream, ptr, jsvalue_ptr))
    }
    fn on_close_extern(ptr: JSValue, reason: JSValue) {
        http_sink_dispatch!(on_close(ptr, reason))
    }
    fn on_ready_extern(ptr: JSValue, amount: JSValue, offset: JSValue) {
        http_sink_dispatch!(on_ready(ptr, amount, offset))
    }
    fn detach_ptr_extern(ptr: JSValue) {
        http_sink_dispatch!(detach_ptr(ptr))
    }
}

impl<const SSL: bool, const HTTP3: bool> HTTPServerWritable<SSL, HTTP3> {
    /// Const-generic → runtime dispatch for the type-erased `res` field.
    #[inline]
    fn any_res(&self) -> Option<uws::AnyResponse> {
        let res = self.res?;
        Some(if HTTP3 {
            uws::AnyResponse::H3(res.cast::<uws::H3::Response>())
        } else if SSL {
            uws::AnyResponse::SSL(res.cast::<uws::Response<true>>())
        } else {
            uws::AnyResponse::TCP(res.cast::<uws::Response<false>>())
        })
    }

    fn handle_wrote(&mut self, amount1: usize) {
        let amount = amount1 as BlobSizeType;
        self.offset += amount;
        self.wrote += amount;

        if self.offset >= self.buffer.len() as BlobSizeType {
            self.offset = 0;
            self.buffer.clear();
        }
        bun_core::scoped_log!(
            HTTPServerWritableLog,
            "handleWrote: {} offset: {}, {}",
            amount1,
            self.offset,
            self.buffer.len()
        );
    }

    fn handle_first_write_if_necessary(&mut self) {
        if let Some(on_first_write) = self.on_first_write.take() {
            let ctx = self.ctx.take();
            on_first_write(ctx);
        }
    }

    /// Release the GC root + pin taken by a zero-copy write.
    fn clear_pending_pinned_write(&mut self) {
        let p = core::mem::take(&mut self.pending_pinned_write);
        if p.pinned_value != JSValue::ZERO {
            p.pinned_value.unpin_array_buffer();
            p.pinned_value.unprotect();
        }
    }

    /// Copy a pending zero-copy write's tail into the uWS backpressure buffer
    /// so a subsequent write()/end() stays ordered behind it, then release.
    fn spill_pending_pinned_write(&mut self) {
        if !self.pending_pinned_write.is_some() {
            return;
        }
        if let Some(res) = self.any_res() {
            // SAFETY: `remaining` borrows the pinned ArrayBuffer's backing
            // store, held live by protect()+pin() until the clear below.
            let remaining = unsafe { &*self.pending_pinned_write.remaining };
            res.spill_body(remaining);
            self.wrote += remaining.len() as BlobSizeType;
        }
        self.clear_pending_pinned_write();
    }

    /// Continue a zero-copy write from the stored offset. Returns `true` when
    /// bytes remain outstanding (wait for another onWritable before resolving
    /// the flush promise).
    fn drain_pending_pinned_write(&mut self) -> bool {
        if !self.pending_pinned_write.is_some() {
            return false;
        }
        let Some(res) = self.any_res() else {
            self.clear_pending_pinned_write();
            return false;
        };
        // SAFETY: see `spill_pending_pinned_write`.
        let remaining = unsafe { &*self.pending_pinned_write.remaining };
        let consumed = res.try_write_body(remaining, false);
        self.wrote += consumed as BlobSizeType;
        if consumed < remaining.len() {
            self.pending_pinned_write.remaining = core::ptr::from_ref(&remaining[consumed..]);
            self.has_backpressure = true;
            return true;
        }
        self.clear_pending_pinned_write();
        false
    }

    /// Zero-copy fast path for a large ArrayBuffer-backed write: send via
    /// `try_write_body` (no tail copy into uWS backpressure); on partial
    /// accept, pin + GC-root the user's buffer and resume on `on_writable`.
    /// Returns `None` when the preconditions don't hold (caller falls back to
    /// the buffered path).
    fn try_write_pinned(&mut self, bytes: &[u8], input_value: JSValue) -> Option<Writable> {
        // The HTTP/3 `try_write_body` shim falls back to a copying write, so
        // the pin would only add overhead there.
        if HTTP3 {
            return None;
        }
        let len = bytes.len();
        // Same gate as the existing `write()` fast path (`len >= highWaterMark`
        // with an empty buffer) so this only changes how that path sends, not
        // which path is taken. The c_uint upper bound falls back to `res.write()`
        // for >4 GiB writes, which splits into UINT_MAX-framed sub-chunks
        // (tryWriteBody's `writeUnsignedHex((unsigned int) length)` would
        // truncate).
        if len <= uws::PINNED_WRITE_THRESHOLD
            || (len as BlobSizeType) < self.high_water_mark
            || len > core::ffi::c_uint::MAX as usize
            || !self.buffer.is_empty()
            || self.requested_end
            || !input_value.is_cell()
        {
            return None;
        }
        let res = self.any_res()?;
        // `res` is a `Copy` raw uWS handle; see `send_without_auto_flusher` re
        // holding it across `on_first_write` (which writes status/headers
        // through the same response but never mutates `self.buffer`).
        self.unregister_auto_flusher();
        self.end_len = 0;
        self.handle_first_write_if_necessary();

        bun_core::scoped_log!(HTTPServerWritableLog, "tryWriteBody({} bytes)", len);
        let consumed = res.try_write_body(bytes, true);
        self.wrote += consumed as BlobSizeType;
        if consumed >= len {
            self.has_backpressure = false;
            return Some(Writable::Owned(len as BlobSizeType));
        }
        bun_core::scoped_log!(
            HTTPServerWritableLog,
            "tryWriteBody partial: {} / {}",
            consumed,
            len
        );
        // `pin()` prevents `transfer()` from detaching the backing store;
        // `protect()` GC-roots the cell. Both are released together on drain,
        // spill, abort or destroy.
        if input_value
            .as_pinned_arraybuffer(self.global_this())
            .is_none()
        {
            // Not ArrayBuffer-backed after all; copy the tail so it outlives
            // this call.
            res.spill_body(&bytes[consumed..]);
            self.wrote += (len - consumed) as BlobSizeType;
            self.has_backpressure = true;
            return Some(self.writable_result(len as BlobSizeType));
        }
        input_value.protect();
        self.pending_pinned_write = PendingPinnedWrite {
            remaining: core::ptr::from_ref(&bytes[consumed..]),
            pinned_value: input_value,
        };
        self.has_backpressure = true;
        Some(self.writable_result(len as BlobSizeType))
    }

    fn has_backpressure(&self) -> bool {
        self.has_backpressure
    }

    fn has_backpressure_and_is_try_end(&self) -> bool {
        self.has_backpressure && self.end_len > 0
    }

    /// `len` bytes were accepted by `send`/`send_readable`. When uWS reports
    /// the socket is now backed up, surface that via the negative-sentinel
    /// `Backpressure` variant so the JS writer can `await flush(true)`;
    /// `on_writable` resolves that promise via `flush_promise()`.
    #[inline]
    fn writable_result(&self, len: BlobSizeType) -> Writable {
        if self.has_backpressure && !self.done && !self.requested_end {
            Writable::Backpressure(len)
        } else {
            Writable::Owned(len)
        }
    }

    fn send_without_auto_flusher(&mut self, buf: &[u8]) -> bool {
        debug_assert!(!self.done);

        let Some(res) = self.any_res() else {
            bun_core::scoped_log!(
                HTTPServerWritableLog,
                "send: {} bytes (backpressure: {})",
                buf.len(),
                self.has_backpressure
            );
            return false;
        };
        // `res` is held across `handleFirstWriteIfNecessary`, whose
        // callback (RequestContext.renderMetadata) writes status/headers through
        // the same uWS response. `AnyResponse` is `Copy` and dispatches to
        // zero-sized opaque handles, so reusing `res` across the re-entrant
        // `on_first_write` invocation cannot alias any Rust-visible memory.

        if self.requested_end && !res.state().is_http_write_called() {
            self.handle_first_write_if_necessary();
            let success = res.try_end(buf, self.end_len, false);
            if success {
                self.has_backpressure = false;
                self.handle_wrote(self.end_len);
            } else if self.res.is_some() {
                self.has_backpressure = true;
            }
            bun_core::scoped_log!(
                HTTPServerWritableLog,
                "send: {} bytes (backpressure: {})",
                buf.len(),
                self.has_backpressure
            );
            return success;
        }
        // clean this so we know when its relevant or not
        self.end_len = 0;
        self.handle_first_write_if_necessary();
        // uWS has no tryWrite(): write() always accepts the buffer (queuing the
        // unsent tail internally) and reports whether the socket is now backed
        // up. Track that so the JS writer can pause; the owning RequestContext
        // holds the on_writable registration and forwards the drain to
        // `on_writable()` below.
        if self.requested_end {
            res.end(buf, false);
            self.has_backpressure = false;
        } else {
            self.has_backpressure = matches!(res.write(buf), uws::WriteResult::Backpressure(_));
        }
        self.handle_wrote(buf.len());
        bun_core::scoped_log!(
            HTTPServerWritableLog,
            "send: {} bytes (backpressure: {})",
            buf.len(),
            self.has_backpressure
        );
        true
    }

    fn send(&mut self, buf: &[u8]) -> bool {
        self.unregister_auto_flusher();
        self.send_without_auto_flusher(buf)
    }

    /// `self.send(&self.readable_slice()[from..])` without laundering a slice
    /// of `self.buffer` through `from_raw_parts` to dodge the `&mut self`
    /// borrow. Mirrors `send_without_auto_flusher` but re-slices `self.buffer`
    /// after each `&mut self` step; `unregister_auto_flusher` and the
    /// `on_first_write` callback (RequestContext.renderMetadata) only touch
    /// uWS response state, never `self.buffer`/`self.offset`, so the re-slice
    /// observes the same bytes the laundered slice would have.
    fn send_readable(&mut self, from: usize) -> bool {
        self.unregister_auto_flusher();
        self.send_readable_without_auto_flusher(from)
    }

    fn send_readable_without_auto_flusher(&mut self, from: usize) -> bool {
        debug_assert!(!self.done);
        let base = self.offset as usize + from;

        let Some(res) = self.any_res() else {
            bun_core::scoped_log!(
                HTTPServerWritableLog,
                "send: {} bytes (backpressure: {})",
                self.buffer.len().saturating_sub(base),
                self.has_backpressure
            );
            return false;
        };
        // `res` is `Copy` (raw uWS handle); see the note in
        // `send_without_auto_flusher` re: holding it across `on_first_write`.

        if self.requested_end && !res.state().is_http_write_called() {
            self.handle_first_write_if_necessary();
            let end_len = self.end_len;
            let success = res.try_end(&self.buffer[base..], end_len, false);
            if success {
                self.has_backpressure = false;
                self.handle_wrote(end_len);
            } else if self.res.is_some() {
                self.has_backpressure = true;
            }
            bun_core::scoped_log!(
                HTTPServerWritableLog,
                "send: {} bytes (backpressure: {})",
                self.buffer.len().saturating_sub(base),
                self.has_backpressure
            );
            return success;
        }
        // clean this so we know when its relevant or not
        self.end_len = 0;
        self.handle_first_write_if_necessary();
        let buf_len = self.buffer.len().saturating_sub(base);
        // See `send_without_auto_flusher`.
        if self.requested_end {
            res.end(&self.buffer[base..], false);
            self.has_backpressure = false;
        } else {
            self.has_backpressure = matches!(
                res.write(&self.buffer[base..]),
                uws::WriteResult::Backpressure(_)
            );
        }
        self.handle_wrote(buf_len);
        bun_core::scoped_log!(
            HTTPServerWritableLog,
            "send: {} bytes (backpressure: {})",
            buf_len,
            self.has_backpressure
        );
        true
    }

    fn readable_slice(&self) -> &[u8] {
        // `handle_wrote` maintains `offset <= buffer.len()`.
        &self.buffer[self.offset as usize..]
    }

    pub fn on_writable(&mut self, write_offset: u64, _res: *mut UwsResponse<SSL, HTTP3>) -> bool {
        // write_offset is the amount of data that was written not how much we need to write
        bun_core::scoped_log!(HTTPServerWritableLog, "onWritable ({})", write_offset);
        // onWritable reset backpressure state to allow flushing
        self.has_backpressure = false;
        if self.aborted {
            self.clear_pending_pinned_write();
            self.signal.close(None);
            let _ = self.flush_promise(); // TODO: properly propagate exception upwards
            self.finalize();
            return false;
        }

        // Finish any held zero-copy tail before touching `self.buffer` or
        // resolving the flush promise.
        if self.drain_pending_pinned_write() {
            return true;
        }

        // Streaming-write drain: uWS already holds the data (our buffer is
        // empty), so there is nothing to resend. Resolve any flush(true) waiter
        // — that promise is the resume signal for both readStreamIntoSink and
        // direct-stream callers. Handled before the try_end resend bookkeeping
        // below, which assumes a non-empty buffer.
        if self.readable_slice().is_empty() {
            if self.done {
                self.signal.close(None);
                let _ = self.flush_promise(); // TODO: properly propagate exception upwards
                self.finalize();
                return true;
            }
            let _ = self.flush_promise(); // TODO: properly propagate exception upwards
            return true;
        }

        let mut total_written: u64 = 0;

        // try_end resend vs streaming-write drain:
        // - end_len > 0: the buffer holds the body uWS partially sent via
        //   try_end; `write_offset` is the resume point into that same buffer.
        // - end_len == 0: the buffer holds *new* data the user queued while the
        //   socket was backed up (e.g. write(small) after a write(big) that hit
        //   backpressure). uWS already owns the earlier bytes; send from 0.
        //   `write_offset` is uWS's cumulative response count here and is not a
        //   valid index into our buffer.
        let chunk_start = if self.end_len > 0 {
            // do not write more than available
            (write_offset as BlobSizeType).min(self.buffer.len() as BlobSizeType - 1) as usize
        } else {
            0
        };
        // Capture the chunk length before send.
        // `send_readable` re-slices the buffer at call time, which observes any
        // mutation send's internals perform. The length is used only for
        // `total_written` and the empty check.
        let chunk_len = self.readable_slice().len().saturating_sub(chunk_start);
        // if we have nothing to write, we are done
        if chunk_len == 0 {
            if self.done {
                self.signal.close(None);
                let _ = self.flush_promise(); // TODO: properly propagate exception upwards
                self.finalize();
                return true;
            }
        } else {
            if !self.send_readable(chunk_start) {
                // if we were unable to send it, retry
                return false;
            }
            total_written = chunk_len as u64;

            if self.requested_end {
                if let Some(res) = self.any_res() {
                    res.clear_on_writable();
                }
                // `send_readable` drained the parked `try_end`, so uWS has
                // `markDone()`d the response and dropped its `onAborted`.
                self.ended_response = true;
                self.signal.close(None);
                let _ = self.flush_promise(); // TODO: properly propagate exception upwards
                self.finalize();
                return true;
            }
        }

        // flush the javascript promise from calling .flush()
        let _ = self.flush_promise(); // TODO: properly propagate exception upwards

        // pending_flush or callback could have caused another send()
        // so we check again if we should report readiness
        if !self.done && !self.requested_end && !self.has_backpressure() {
            // no pending and total_written > 0
            if total_written > 0 && self.readable_slice().is_empty() {
                self.signal.ready(Some(total_written as BlobSizeType), None);
            }
        }

        true
    }

    pub fn start(&mut self, stream_start: &Start) -> bun_sys::Result<()> {
        if self.aborted || self.res.is_none() || self.any_res().unwrap().has_responded() {
            self.mark_done();
            self.signal.close(None);
            return bun_sys::Result::Ok(());
        }

        self.wrote = 0;
        self.wrote_at_start_of_flush = 0;
        let _ = self.flush_promise(); // TODO: properly propagate exception upwards

        if self.buffer.capacity() == 0 {
            debug_assert!(self.pooled_buffer.is_none());
            if FeatureFlags::HTTP_BUFFER_POOLING {
                if let Some(pooled_node) = ByteListPool::get_if_exists() {
                    let pooled_node = NonNull::new(pooled_node)
                        .expect("ByteListPool::get_if_exists returns a live heap node when Some");
                    self.pooled_buffer = Some(pooled_node);
                    // SAFETY: pooled_node is a valid pool checkout; `data` was
                    // written by `ByteListPool::push` (or zero-initialized).
                    // Move the Vec<u8> out by bitwise read and reset the slot.
                    self.buffer =
                        unsafe { core::mem::take((*pooled_node.as_ptr()).data.assume_init_mut()) };
                }
            }
        }

        self.buffer.clear();

        if let &Start::ChunkSize(chunk_size) = stream_start {
            if chunk_size > 0 {
                self.high_water_mark = chunk_size;
            }
        }

        self.buffer.clear_retaining_capacity();
        if self
            .buffer
            .try_reserve_exact(self.high_water_mark as usize)
            .is_err()
        {
            return Err(SysError::oom());
        }

        self.done = false;
        self.signal.start();
        bun_core::scoped_log!(HTTPServerWritableLog, "start({})", self.high_water_mark);
        bun_sys::Result::Ok(())
    }

    fn flush_from_js_no_wait(&mut self) -> bun_sys::Result<JSValue> {
        bun_core::scoped_log!(HTTPServerWritableLog, "flushFromJSNoWait");
        bun_sys::Result::Ok(JSValue::from(self.flush_no_wait()))
    }

    pub fn flush_no_wait(&mut self) -> usize {
        if self.has_backpressure_and_is_try_end() || self.done {
            return 0;
        }

        let slice_len = self.readable_slice().len();
        if slice_len == 0 {
            return 0;
        }

        if self.send_readable(0) {
            return slice_len;
        }

        0
    }

    pub fn flush_from_js(
        &mut self,
        global_this: &JSGlobalObject,
        wait: bool,
    ) -> bun_sys::Result<JSValue> {
        bun_core::scoped_log!(HTTPServerWritableLog, "flushFromJS({})", wait);
        self.unregister_auto_flusher();

        if !wait {
            return self.flush_from_js_no_wait();
        }

        if let Some(prom) = self.pending_flush {
            // A prior `flush(true)` is already waiting on the drain. Push any
            // data buffered since (below highWaterMark) so it reaches uWS now
            // rather than when `on_writable` fires.
            if self.end_len == 0 && !self.readable_slice().is_empty() {
                let _ = self.send_readable(0);
            }
            // S008: `JSPromise` is an `opaque_ffi!` ZST — safe `*const → &` deref.
            return bun_sys::Result::Ok(JSPromise::opaque_ref(prom).to_js());
        }

        if self.done {
            return bun_sys::Result::Ok(JSPromise::resolved_promise_value(
                global_this,
                JSValue::from(0i32),
            ));
        }

        if !self.has_backpressure_and_is_try_end() {
            let slice_len = self.readable_slice().len();
            if slice_len > 0 {
                let _ = self.send_readable(0);
            }
            // Only resolve once the socket has actually accepted everything;
            // otherwise fall through and let on_writable resolve the promise.
            if !self.has_backpressure {
                return bun_sys::Result::Ok(JSPromise::resolved_promise_value(
                    global_this,
                    JSValue::from(slice_len),
                ));
            }
        }
        self.wrote_at_start_of_flush = self.wrote;
        self.pending_flush = Some(JSPromise::create(global_this));
        self.global_this = Some(BackRef::new(global_this));
        // S008: `JSPromise` is an `opaque_ffi!` ZST — safe `*const → &` deref.
        let promise_value = JSPromise::opaque_ref(self.pending_flush.unwrap()).to_js();
        promise_value.protect();

        bun_sys::Result::Ok(promise_value)
    }

    pub fn flush(&mut self) -> bun_sys::Result<()> {
        bun_core::scoped_log!(HTTPServerWritableLog, "flush()");
        self.unregister_auto_flusher();

        if !self.has_backpressure() || self.done {
            return bun_sys::Result::Ok(());
        }

        if self.res.is_none() || self.any_res().unwrap().has_responded() {
            self.mark_done();
            self.signal.close(None);
        }

        bun_sys::Result::Ok(())
    }

    pub fn write(&mut self, data: &StreamResult) -> Writable {
        if self.done || self.requested_end {
            return Writable::Owned(0);
        }

        let bytes = data.slice();
        let len = bytes.len() as BlobSizeType;
        bun_core::scoped_log!(HTTPServerWritableLog, "write({})", bytes.len());
        self.spill_pending_pinned_write();

        if self.buffer.len() == 0 && len >= self.high_water_mark {
            // fast path:
            // - large-ish chunk
            // - no backpressure
            if self.send(bytes) {
                return self.writable_result(len);
            }

            if self.buffer.write(bytes).is_err() {
                return Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write));
            }
        } else if self.buffer.len() as BlobSizeType + len >= self.high_water_mark {
            // TODO: attempt to write both in a corked buffer?
            if self.buffer.write(bytes).is_err() {
                return Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write));
            }
            if self.send_readable(0) {
                return self.writable_result(len);
            }
        } else {
            // queue the data wait until highWaterMark is reached or the auto flusher kicks in
            if self.buffer.write(bytes).is_err() {
                return Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write));
            }
        }

        self.register_auto_flusher();

        self.writable_result(len)
    }

    pub fn write_bytes(&mut self, data: &StreamResult) -> Writable {
        self.write(data)
    }

    pub fn write_bytes_with_value(
        &mut self,
        data: &StreamResult,
        input_value: JSValue,
    ) -> Writable {
        if self.done || self.requested_end {
            return Writable::Owned(0);
        }
        // A previous zero-copy tail must hit the wire before this one; no-op
        // when the caller waited for the flush promise.
        self.spill_pending_pinned_write();
        if let Some(result) = self.try_write_pinned(data.slice(), input_value) {
            return result;
        }
        self.write(data)
    }

    pub fn write_latin1(&mut self, data: &StreamResult) -> Writable {
        if self.done || self.requested_end {
            return Writable::Owned(0);
        }

        if self.res.is_none() || self.any_res().unwrap().has_responded() {
            self.signal.close(None);
            self.mark_done();
            return Writable::Done;
        }

        let bytes = data.slice();
        let len = bytes.len() as BlobSizeType;
        bun_core::scoped_log!(HTTPServerWritableLog, "writeLatin1({})", bytes.len());
        self.spill_pending_pinned_write();

        if self.buffer.len() == 0 && len >= self.high_water_mark {
            let mut do_send = true;
            // common case
            if strings::is_all_ascii(bytes) {
                // fast path:
                // - large-ish chunk
                // - no backpressure
                if self.send(bytes) {
                    return self.writable_result(len);
                }
                do_send = false;
            }

            if self.buffer.write_latin1(bytes).is_err() {
                return Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write));
            }

            if do_send {
                if self.send_readable(0) {
                    return self.writable_result(len);
                }
            }
        } else if self.buffer.len() as BlobSizeType + len >= self.high_water_mark {
            // kinda fast path:
            // - combined chunk is large enough to flush automatically
            // - no backpressure
            if self.buffer.write_latin1(bytes).is_err() {
                return Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write));
            }
            if self.send_readable(0) {
                return self.writable_result(len);
            }
        } else {
            if self.buffer.write_latin1(bytes).is_err() {
                return Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write));
            }
        }

        self.register_auto_flusher();

        self.writable_result(len)
    }

    pub fn write_utf16(&mut self, data: &StreamResult) -> Writable {
        if self.done || self.requested_end {
            return Writable::Owned(0);
        }

        if self.res.is_none() || self.any_res().unwrap().has_responded() {
            self.signal.close(None);
            self.mark_done();
            return Writable::Done;
        }

        let bytes = data.slice();

        bun_core::scoped_log!(HTTPServerWritableLog, "writeUTF16({})", bytes.len());
        self.spill_pending_pinned_write();

        // we must always buffer UTF-16
        // we assume the case of all-ascii UTF-16 string is pretty uncommon
        // bytes are u16-aligned per Result.slice16 invariant; bytemuck checks at runtime.
        let utf16: &[u16] = bytemuck::cast_slice(bytes);
        let written = match self.buffer.write_utf16(utf16) {
            Ok(n) => n,
            Err(_) => return Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write)),
        };

        let readable_len = self.readable_slice().len();
        if readable_len >= self.high_water_mark as usize || self.has_backpressure() {
            if self.send_readable(0) {
                return self.writable_result(written as BlobSizeType);
            }
        }

        self.register_auto_flusher();
        self.writable_result(written as BlobSizeType)
    }

    pub fn mark_done(&mut self) {
        self.done = true;
        self.unregister_auto_flusher();
    }

    /// In this case, it's always an error
    pub fn end(&mut self, err: Option<SysError>) -> bun_sys::Result<()> {
        bun_core::scoped_log!(HTTPServerWritableLog, "end({:?})", err);

        if self.requested_end {
            return bun_sys::Result::Ok(());
        }

        if self.done || self.res.is_none() || self.any_res().unwrap().has_responded() {
            self.signal.close(err);
            self.mark_done();
            self.finalize();
            return bun_sys::Result::Ok(());
        }

        self.spill_pending_pinned_write();
        self.requested_end = true;
        let readable_len = self.readable_slice().len();
        self.end_len = readable_len;

        if readable_len == 0 {
            self.signal.close(err);
            self.mark_done();
            // we do not close the stream here
            // this.res.endStream(false);
            self.finalize();
            return bun_sys::Result::Ok(());
        }
        bun_sys::Result::Ok(())
    }

    pub fn end_from_js(&mut self, global_this: &JSGlobalObject) -> bun_sys::Result<JSValue> {
        bun_core::scoped_log!(HTTPServerWritableLog, "endFromJS()");

        if self.requested_end {
            return bun_sys::Result::Ok(JSValue::from(0i32));
        }

        if self.done || self.res.is_none() || self.any_res().unwrap().has_responded() {
            self.requested_end = true;
            self.signal.close(None);
            self.mark_done();
            self.finalize();
            return bun_sys::Result::Ok(JSValue::from(0i32));
        }

        self.spill_pending_pinned_write();
        self.requested_end = true;
        let readable_len = self.readable_slice().len();
        self.end_len = readable_len;

        if readable_len > 0 {
            if !self.send_readable(0) {
                self.pending_flush = Some(JSPromise::create(global_this));
                self.global_this = Some(BackRef::new(global_this));
                // S008: `JSPromise` is an `opaque_ffi!` ZST — safe `*const → &` deref.
                let value = JSPromise::opaque_ref(self.pending_flush.unwrap()).to_js();
                value.protect();
                return bun_sys::Result::Ok(value);
            }
        } else {
            if let Some(res) = self.any_res() {
                res.end(b"", false);
            }
        }

        // Both branches above fully ended the response through uWS, which
        // `markDone()`s it and drops its `onAborted`.
        self.ended_response = true;
        self.mark_done();
        let _ = self.flush_promise(); // TODO: properly propagate exception upwards
        self.signal.close(None);
        self.finalize();

        bun_sys::Result::Ok(JSValue::from(self.wrote))
    }

    pub fn sink(&mut self) -> Sink<'_> {
        Sink::init(self)
    }

    /// Takes `*mut Self`, not `&mut self`: closing the signal runs the controller's
    /// JS `onClose`, which can cancel the stream, drain microtasks, and free this
    /// sink. A `&mut self` argument protector must not be live across that free.
    ///
    /// # Safety
    /// `this` must point at the live sink owned by the `RequestContext`.
    pub unsafe fn abort(this: *mut Self) {
        bun_core::scoped_log!(HTTPServerWritableLog, "onAborted()");
        // SAFETY: caller contract — `this` is live, and every borrow formed here
        // ends before the signal close below, which may free `*this`.
        let sink = unsafe { &mut *this };
        sink.clear_pending_pinned_write();
        sink.done = true;
        sink.res = None;
        sink.unregister_auto_flusher();

        sink.aborted = true;

        // Only JsTerminated escapes flush_promise; there is no JS caller to
        // surface it to from a socket-close callback, so teardown continues.
        let _ = sink.flush_promise();
        sink.finalize();

        // Close the signal last and through a stack copy: the close fires the JS
        // onClose callback, and the teardown it can re-enter frees this sink, so
        // no reference into the allocation may be live across the call.
        let mut signal = Signal {
            ptr: sink.signal.ptr,
            vtable: sink.signal.vtable,
        };
        signal.close(None);
    }

    fn unregister_auto_flusher(&mut self) {
        if self.auto_flusher.registered.get() {
            let vm = self.global_this().bun_vm();
            AutoFlusher::unregister_deferred_microtask_with_type_unchecked::<Self>(self, vm);
        }
    }

    fn register_auto_flusher(&mut self) {
        let Some(res) = self.any_res() else { return };
        // Reset per-enqueue so a long stream of
        // sub-highWaterMark writes between auto-flushes still bumps the idle
        // timeout.
        res.reset_timeout();
        if !self.auto_flusher.registered.get() {
            let vm = self.global_this().bun_vm();
            AutoFlusher::register_deferred_microtask_with_type_unchecked::<Self>(self, vm);
        }
    }

    pub fn on_auto_flush(&mut self) -> bool {
        bun_core::scoped_log!(HTTPServerWritableLog, "onAutoFlush()");
        if self.done {
            self.auto_flusher.registered.set(false);
            return false;
        }

        let readable_len = self.readable_slice().len();

        if self.has_backpressure_and_is_try_end() || readable_len == 0 {
            self.auto_flusher.registered.set(false);
            return false;
        }

        if !self.send_readable_without_auto_flusher(0) {
            self.auto_flusher.registered.set(true);
            return true;
        }
        self.auto_flusher.registered.set(false);
        false
    }

    /// # Safety
    /// `this` must be a valid, uniquely-owned heap pointer to `Self` produced
    /// by `bun_core::heap::into_raw`; the caller transfers ownership.
    // Forwards `this` to `bun_core::heap::take` without dereferencing it here;
    // not_unsafe_ptr_arg_deref is a false positive on opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn destroy(this: *mut Self) {
        bun_core::scoped_log!(HTTPServerWritableLog, "destroy()");
        // SAFETY: this was heap-allocated; destroy takes sole ownership. Reclaim
        // the Box first so we never hold a `&mut *this` alongside the Box's
        // unique pointer.
        let mut this = unsafe { bun_core::heap::take(this) };
        this.clear_pending_pinned_write();
        // Callers may tear this sink down without routing through
        // flushPromise() (e.g. handleResolveStream / handleRejectStream).
        // Drop the GC root so the promise can be collected.
        if let Some(prom) = this.pending_flush.take() {
            // S008: `JSPromise` is an `opaque_ffi!` ZST — safe `*const → &` deref.
            JSPromise::opaque_ref(prom).to_js().unprotect();
        }
        this.buffer.clear_and_free();
        this.unregister_auto_flusher();
        drop(this);
    }

    /// This can be called _many_ times for the same instance
    /// so it must zero out state instead of make it
    pub fn finalize(&mut self) {
        bun_core::scoped_log!(HTTPServerWritableLog, "finalize()");
        if !self.done {
            self.spill_pending_pinned_write();
            self.unregister_auto_flusher();
            if let Some(res) = self.any_res() {
                // The body is finished; drop the drain callback so the owning
                // RequestContext is not re-entered for a sink that will never
                // write again. onAborted/onData stay installed — clearing them
                // here would drop the holder's pointer (and on H3, where the
                // stream is freed after FIN, leave it dangling).
                res.clear_on_writable();
            }
            let _ = self.flush_no_wait();
            self.done = true;

            if let Some(res) = self.any_res() {
                // is actually fine to call this if the socket is closed because of flushNoWait, the free will be defered by usockets
                res.end_stream(false);
            }
        }

        if !FeatureFlags::HTTP_BUFFER_POOLING {
            debug_assert!(self.pooled_buffer.is_none());
        }

        if let Some(pooled) = self.pooled_buffer {
            self.buffer.clear();
            if self.buffer.capacity() > 64 * 1024 {
                self.buffer.clear_and_free();
            }
            // SAFETY: pooled is a valid pool node checkout
            unsafe {
                (*pooled.as_ptr()).data =
                    core::mem::MaybeUninit::new(core::mem::take(&mut self.buffer));
            }

            self.buffer = Vec::<u8>::default();
            self.pooled_buffer = None;
            // SAFETY: `pooled` was obtained from `ByteListPool::get_node` and is
            // exclusively owned by this stream; `data` was rewritten just above,
            // so it is initialized. Ownership returns to the pool.
            unsafe { ByteListPool::release(pooled.as_ptr()) };
        } else if self.buffer.capacity() == 0 {
            //
        } else if FeatureFlags::HTTP_BUFFER_POOLING && !ByteListPool::full() {
            let buffer = core::mem::take(&mut self.buffer);
            ByteListPool::push(buffer);
        } else {
            // Don't release this buffer until destroy() is called
            self.buffer.clear();
        }
    }

    /// Only VM termination
    /// escapes; promise resolution cannot raise an ordinary JS exception here.
    pub fn flush_promise(&mut self) -> core::result::Result<(), jsc::JsTerminated> {
        if let Some(prom) = self.pending_flush.take() {
            bun_core::scoped_log!(HTTPServerWritableLog, "flushPromise()");

            let global_this = self.global_this();
            // S008: `JSPromise` is an `opaque_ffi!` ZST — safe `* → &`/`&mut` deref.
            JSPromise::opaque_ref(prom).to_js().unprotect();
            let result = JSPromise::opaque_mut(prom).resolve(
                global_this,
                JSValue::js_number(self.wrote.saturating_sub(self.wrote_at_start_of_flush) as f64),
            );
            // `this.wrote_at_start_of_flush = this.wrote` must read `this.wrote`
            // AFTER resolve, which may reenter JS and mutate `wrote`. Read it here,
            // not before the call.
            //
            // R-2 noalias mitigation (PORT_NOTES_PLAN R-2; precedent
            // `b818e70e1c57` NodeHTTPResponse::cork): `&mut self` is `noalias`
            // and `resolve()` receives nothing derived from `self`, so LLVM is
            // licensed to forward the `self.wrote` read used in the
            // `js_number(...)` argument above into this assignment — defeating
            // the very ordering the note above exists to preserve. ASM-verified
            // PROVEN_CACHED. Launder `self` so the post-resolve `wrote` read
            // goes through an opaque pointer.
            let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
            // SAFETY: `this` is the live heap payload (refcounted via the JS
            // wrapper); momentary access only.
            unsafe { (*this).wrote_at_start_of_flush = (*this).wrote };
            return result;
        }
        Ok(())
    }
}

crate::impl_sink_handler!([const SSL: bool, const HTTP3: bool] HTTPServerWritable<SSL, HTTP3>);

// `JsSinkType` impl: routes the codegen `${name}__{construct,write,end,flush,
// start,getInternalFd,memoryCost}` thunks (via `JSSink::<Self>::js_*`) into
// the inherent streaming methods above. Mirrors `Sink.JSSink(@This(), name)`.
impl<const SSL: bool, const HTTP3: bool> crate::webcore::sink::JsSinkType
    for HTTPServerWritable<SSL, HTTP3>
{
    const NAME: &'static str = Self::NAME;
    const HAS_SIGNAL: bool = true;
    const HAS_DONE: bool = true;
    const HAS_FLUSH_FROM_JS: bool = true;
    const START_TAG: Option<StartTag> = Some(if HTTP3 {
        StartTag::H3ResponseSink
    } else if SSL {
        StartTag::HTTPSResponseSink
    } else {
        StartTag::HTTPResponseSink
    });

    fn memory_cost(&self) -> usize {
        Self::memory_cost(self)
    }
    fn finalize(&mut self) {
        Self::finalize(self)
    }
    fn write_bytes(&mut self, data: &StreamResult) -> Writable {
        Self::write(self, data)
    }
    fn write_bytes_with_value(&mut self, data: &StreamResult, input_value: JSValue) -> Writable {
        Self::write_bytes_with_value(self, data, input_value)
    }
    fn write_utf16(&mut self, data: &StreamResult) -> Writable {
        Self::write_utf16(self, data)
    }
    fn write_latin1(&mut self, data: &StreamResult) -> Writable {
        Self::write_latin1(self, data)
    }
    fn end(&mut self, err: Option<SysError>) -> bun_sys::Result<()> {
        Self::end(self, err)
    }
    fn end_from_js(&mut self, global: &JSGlobalObject) -> bun_sys::Result<JSValue> {
        Self::end_from_js(self, global)
    }
    fn flush(&mut self) -> bun_sys::Result<()> {
        Self::flush(self)
    }
    fn flush_from_js(&mut self, global: &JSGlobalObject, wait: bool) -> bun_sys::Result<JSValue> {
        Self::flush_from_js(self, global, wait)
    }
    fn start(&mut self, config: Start) -> bun_sys::Result<()> {
        Self::start(self, &config)
    }
    fn signal(&mut self) -> Option<&mut Signal> {
        Some(&mut self.signal)
    }
    fn done(&self) -> bool {
        self.done
    }
}

pub type HTTPSResponseSink = HTTPServerWritable<true, false>;
pub type HTTPResponseSink = HTTPServerWritable<false, false>;
pub type H3ResponseSink = HTTPServerWritable<true, true>;

// ──────────────────────────────────────────────────────────────────────────
// NetworkSink
// ──────────────────────────────────────────────────────────────────────────

pub struct NetworkSink {
    // Stored as `BackRef`
    // (set-once); while `Some` the sink holds a counted ref on the intrusively
    // ref-counted `MultiPartUpload`, released in `detach_writable`.
    pub task: Option<BackRef<bun_s3::MultiPartUpload>>,
    pub signal: Signal,
    // JSC_BORROW: process-lifetime VM global; safe `Deref` via `BackRef`.
    pub global_this: Option<BackRef<JSGlobalObject>>,
    pub high_water_mark: BlobSizeType,
    pub flush_promise: JSPromiseStrong,
    pub end_promise: JSPromiseStrong,
    pub ended: bool,
    pub done: bool,
    pub cancel: bool,
}

impl Default for NetworkSink {
    fn default() -> Self {
        Self {
            task: None,
            signal: Signal::default(),
            global_this: None,
            high_water_mark: 2048,
            flush_promise: JSPromiseStrong::default(),
            end_promise: JSPromiseStrong::default(),
            ended: false,
            done: false,
            cancel: false,
        }
    }
}

impl NetworkSink {
    /// Borrow the JS global stored at construction.
    ///
    /// Invariant: `global_this` is set at construction and the VM-owned global
    /// outlives this sink (JSC_BORROW). Never `None` once set.
    #[inline]
    pub fn global_this(&self) -> &JSGlobalObject {
        self.global_this
            .as_ref()
            .expect("NetworkSink.global_this used before init")
            .get()
    }

    /// Shared borrow of the upload task, if attached.
    ///
    /// SAFETY (invariant): `task` is an intrusively ref-counted heap allocation;
    /// while `Some`, this sink holds a counted ref (released in `detach_writable`),
    /// so the pointee is live for at least `'_`.
    #[inline]
    fn task_ref(&self) -> Option<&bun_s3::MultiPartUpload> {
        // `BackRef::get` encapsulates the deref under the counted-ref invariant.
        self.task.as_ref().map(BackRef::get)
    }

    /// Exclusive borrow of the upload task, if attached.
    ///
    /// SAFETY (invariant): the `MultiPartUpload` is single-threaded and the sink
    /// is its sole writer once attached; `&mut self` ensures no overlapping
    /// borrow from this sink. Mirrors the prior `task.as_ptr().as_mut()` sites.
    #[inline]
    fn task_mut(&mut self) -> Option<&mut bun_s3::MultiPartUpload> {
        // SAFETY: see doc comment — exclusive while `&mut self` held.
        self.task.as_mut().map(|p| unsafe { p.get_mut() })
    }

    pub fn new(init: NetworkSink) -> Box<NetworkSink> {
        Box::new(init)
    }

    pub fn path(&self) -> Option<&[u8]> {
        if let Some(task) = self.task_ref() {
            return Some(&task.path);
        }
        None
    }

    pub fn start(&mut self, stream_start: &Start) -> bun_sys::Result<()> {
        if self.ended {
            return bun_sys::Result::Ok(());
        }

        if let &Start::ChunkSize(chunk_size) = stream_start {
            if chunk_size > 0 {
                self.high_water_mark = chunk_size;
            }
        }
        self.ended = false;
        self.signal.start();
        bun_sys::Result::Ok(())
    }

    pub fn connect(&mut self, signal: Signal) {
        self.signal = signal;
    }

    pub fn sink(&mut self) -> Sink<'_> {
        Sink::init(self)
    }

    pub fn to_sink(&mut self) -> *mut NetworkSinkJSSink {
        // SAFETY: JSSink wraps Self at offset 0 (repr guarantee from codegen)
        std::ptr::from_mut::<Self>(self).cast::<NetworkSinkJSSink>()
    }

    pub fn finalize(&mut self) {
        self.detach_writable();
    }

    fn detach_writable(&mut self) {
        if let Some(task) = self.task.take() {
            // task is ref-counted; deref releases our ref
            bun_s3::MultiPartUpload::deref_(task.as_ptr());
        }
    }

    /// Narrowed like
    /// `flushPromise`; promise resolution only fails on VM termination.
    pub fn on_writable(
        task: &mut bun_s3::MultiPartUpload,
        this: &mut NetworkSink,
        flushed: u64,
    ) -> core::result::Result<(), jsc::JsTerminated> {
        bun_core::scoped_log!(
            NetworkSinkLog,
            "onWritable flushed: {} state: {}",
            flushed,
            task.state as u8
        );
        if this.flush_promise.has_value() {
            let global = this.global_this.expect("global_this set at construction");
            this.flush_promise
                .resolve(&global, JSValue::js_number(flushed as f64))?;
        }
        Ok(())
    }

    pub fn flush(&mut self) -> bun_sys::Result<()> {
        bun_sys::Result::Ok(())
    }

    pub fn flush_from_js(
        &mut self,
        global_this: &JSGlobalObject,
        _wait: bool,
    ) -> bun_sys::Result<JSValue> {
        // still waiting for more data tobe flushed
        if self.flush_promise.has_value() {
            return bun_sys::Result::Ok(self.flush_promise.value());
        }

        // nothing todo here
        if self.done {
            return bun_sys::Result::Ok(JSPromise::resolved_promise_value(
                global_this,
                JSValue::js_number(0.0),
            ));
        }
        // flush more
        if self.task_ref().is_some_and(|t| !t.is_queue_empty()) {
            // we have something queued, we need to wait for the next flush
            self.flush_promise = JSPromiseStrong::init(global_this);
            return bun_sys::Result::Ok(self.flush_promise.value());
        }
        // we are done flushing no backpressure
        bun_sys::Result::Ok(JSPromise::resolved_promise_value(
            global_this,
            JSValue::js_number(0.0),
        ))
    }

    /// # Safety
    /// `this` must be a valid, uniquely-owned heap pointer to `Self` produced
    /// by `bun_core::heap::into_raw`; the caller transfers ownership.
    // Forwards `this` to `bun_core::heap::take` without dereferencing it here;
    // not_unsafe_ptr_arg_deref is a false positive on opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn finalize_and_destroy(this: *mut Self) {
        // SAFETY: this was heap-allocated; reclaim sole ownership before
        // touching fields so no `&mut *this` is live alongside the Box.
        let mut this = unsafe { bun_core::heap::take(this) };
        this.finalize();
        drop(this);
    }

    pub fn abort(&mut self) {
        self.ended = true;
        self.done = true;
        self.signal.close(None);
        self.cancel = true;
        self.finalize();
    }

    pub fn write(&mut self, data: &StreamResult) -> Writable {
        if self.ended {
            return Writable::Owned(0);
        }
        let bytes = data.slice();
        let len = bytes.len() as BlobSizeType;

        if let Some(task) = self.task_mut() {
            if task.write_bytes(bytes, false).is_err() {
                return Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write));
            }
        }
        Writable::Owned(len)
    }

    pub fn write_bytes(&mut self, data: &StreamResult) -> Writable {
        self.write(data)
    }

    pub fn write_latin1(&mut self, data: &StreamResult) -> Writable {
        if self.ended {
            return Writable::Owned(0);
        }

        let bytes = data.slice();
        let len = bytes.len() as BlobSizeType;

        if let Some(task) = self.task_mut() {
            if task.write_latin1(bytes, false).is_err() {
                return Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write));
            }
        }
        Writable::Owned(len)
    }

    pub fn write_utf16(&mut self, data: &StreamResult) -> Writable {
        if self.ended {
            return Writable::Owned(0);
        }
        let bytes = data.slice();
        if let Some(task) = self.task_mut() {
            // we must always buffer UTF-16
            // we assume the case of all-ascii UTF-16 string is pretty uncommon
            if task.write_utf16(bytes, false).is_err() {
                return Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write));
            }
        }

        Writable::Owned(bytes.len() as BlobSizeType)
    }

    pub fn end(&mut self, err: Option<SysError>) -> bun_sys::Result<()> {
        if self.ended {
            return bun_sys::Result::Ok(());
        }

        // send EOF
        self.ended = true;
        // flush everything and send EOF
        if let Some(task) = self.task_mut() {
            let _ = task.write_bytes(b"", true);
            // bun.handleOom → Rust aborts on OOM
        }

        self.signal.close(err);
        bun_sys::Result::Ok(())
    }

    pub fn end_from_js(&mut self, _global_this: &JSGlobalObject) -> bun_sys::Result<JSValue> {
        let _ = self.end(None);
        if self.end_promise.has_value() {
            // we are already waiting for the end
            return bun_sys::Result::Ok(self.end_promise.value());
        }
        if self.task.is_some() {
            // we need to wait for the task to end
            self.end_promise = JSPromiseStrong::init(self.global_this());
            let value = self.end_promise.value();
            if !self.ended {
                self.ended = true;
                // we need to send EOF
                if let Some(task) = self.task_mut() {
                    let _ = task.write_bytes(b"", true);
                }
                self.signal.close(None);
            }
            return bun_sys::Result::Ok(value);
        }
        // task already detached
        bun_sys::Result::Ok(JSValue::js_number(0.0))
    }

    pub fn to_js(&mut self, global_this: &JSGlobalObject) -> JSValue {
        NetworkSinkJSSink::create_object(global_this, self, 0)
    }

    pub fn memory_cost(&self) -> usize {
        // Since this is a JSSink, the NewJSSink function does @sizeOf(JSSink) which includes @sizeOf(ArrayBufferSink).
        if let Some(task) = self.task_ref() {
            //TODO: we could do better here
            return task.buffered.memory_cost();
        }
        0
    }

    pub const NAME: &'static str = "NetworkSink";
}

crate::impl_sink_handler!(NetworkSink);
crate::impl_js_sink_abi!(NetworkSink, "NetworkSink");

impl crate::webcore::sink::JsSinkType for NetworkSink {
    const NAME: &'static str = Self::NAME;
    const HAS_SIGNAL: bool = true;
    const HAS_DONE: bool = true;
    const HAS_FLUSH_FROM_JS: bool = true;
    const START_TAG: Option<StartTag> = Some(StartTag::NetworkSink);

    fn memory_cost(&self) -> usize {
        Self::memory_cost(self)
    }
    fn finalize(&mut self) {
        Self::finalize(self)
    }
    fn write_bytes(&mut self, data: &StreamResult) -> Writable {
        Self::write(self, data)
    }
    fn write_utf16(&mut self, data: &StreamResult) -> Writable {
        Self::write_utf16(self, data)
    }
    fn write_latin1(&mut self, data: &StreamResult) -> Writable {
        Self::write_latin1(self, data)
    }
    fn end(&mut self, err: Option<SysError>) -> bun_sys::Result<()> {
        Self::end(self, err)
    }
    fn end_from_js(&mut self, global: &JSGlobalObject) -> bun_sys::Result<JSValue> {
        Self::end_from_js(self, global)
    }
    fn flush(&mut self) -> bun_sys::Result<()> {
        Self::flush(self)
    }
    fn flush_from_js(&mut self, global: &JSGlobalObject, wait: bool) -> bun_sys::Result<JSValue> {
        Self::flush_from_js(self, global, wait)
    }
    fn start(&mut self, config: Start) -> bun_sys::Result<()> {
        Self::start(self, &config)
    }
    fn signal(&mut self) -> Option<&mut Signal> {
        Some(&mut self.signal)
    }
    fn done(&self) -> bool {
        self.done
    }
}

pub type NetworkSinkJSSink = crate::webcore::sink::JSSink<NetworkSink>;

// ──────────────────────────────────────────────────────────────────────────
// BufferAction
// ──────────────────────────────────────────────────────────────────────────
//
// Every variant carries the *same* payload, so the idiomatic shape is `{tag, payload}`.
// No caller pattern-matches on the variant — they only read `.tag()` or forward to the
// promise.

pub struct BufferAction {
    tag: BufferActionTag,
    promise: JSPromiseStrong,
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum BufferActionTag {
    Text,
    ArrayBuffer,
    Blob,
    Bytes,
    Json,
}

impl BufferAction {
    pub fn new(tag: BufferActionTag, global: &JSGlobalObject) -> Self {
        Self {
            tag,
            promise: JSPromiseStrong::init(global),
        }
    }

    pub const fn tag(&self) -> BufferActionTag {
        self.tag
    }

    pub fn fulfill(
        &mut self,
        global: &JSGlobalObject,
        blob: &mut AnyBlob,
    ) -> core::result::Result<(), jsc::JsTerminated> {
        blob.wrap(jsc::AnyPromise::Normal(self.swap()), global, self.tag())
    }

    pub fn reject(
        &mut self,
        global: &JSGlobalObject,
        err: &StreamError,
    ) -> core::result::Result<(), jsc::JsTerminated> {
        // S008: `JSPromise` is an `opaque_ffi!` ZST — safe `*mut → &mut` deref.
        JSPromise::opaque_mut(self.swap()).reject(global, Ok(err.to_js(global)))
    }

    pub fn resolve(
        &mut self,
        global: &JSGlobalObject,
        result: JSValue,
    ) -> core::result::Result<(), jsc::JsTerminated> {
        // S008: `JSPromise` is an `opaque_ffi!` ZST — safe `*mut → &mut` deref.
        JSPromise::opaque_mut(self.swap()).resolve(global, result)
    }

    pub fn value(&self) -> JSValue {
        self.promise.value()
    }

    pub fn get(&self) -> *mut JSPromise {
        std::ptr::from_mut(self.promise.get())
    }

    pub fn swap(&mut self) -> *mut JSPromise {
        std::ptr::from_mut(self.promise.swap())
    }
}

// JSPromiseStrong implements Drop, so the struct drops it automatically — no explicit
// `impl Drop for BufferAction` needed.

// ──────────────────────────────────────────────────────────────────────────
// ReadResult
// ──────────────────────────────────────────────────────────────────────────

pub enum ReadResult {
    Pending,
    Err(SysError),
    Done,
    // Ownership of the slice is contextual: consumers compare `slice.ptr != buf.ptr` to
    // decide whether the bytes are owned or alias the caller's buffer, so a raw slice
    // pointer (no Drop) is the only honest representation.
    Read(*mut [u8]),
}

impl ReadResult {
    pub fn to_stream(
        self,
        pending: *mut Pending,
        buf: &mut [u8],
        view: JSValue,
        close_on_empty: bool,
    ) -> StreamResult {
        self.to_stream_with_is_done(pending, buf, view, close_on_empty, false)
    }

    pub fn to_stream_with_is_done(
        self,
        pending: *mut Pending,
        buf: &mut [u8],
        view: JSValue,
        close_on_empty: bool,
        is_done: bool,
    ) -> StreamResult {
        match self {
            ReadResult::Pending => StreamResult::Pending(pending),
            ReadResult::Err(err) => StreamResult::Err(StreamError::Error(err)),
            ReadResult::Done => StreamResult::Done,
            ReadResult::Read(slice) => 'brk: {
                // `slice` may point at the same allocation as
                // `buf` (we check `slice.ptr != buf.ptr`). Forming `&mut *slice`
                // while the `buf: &mut [u8]` parameter is live would violate
                // Rust's aliasing rules in the `!owned` case. Stay on raw
                // pointers: `<*mut [u8]>::len()` reads only the fat-pointer
                // metadata (no deref), and the cast to `*mut u8` projects the
                // data pointer without creating a reference.
                let slice_ptr = slice.cast::<u8>();
                let slice_len = slice.len();
                let owned = slice_ptr.cast_const() != buf.as_ptr();
                let done = is_done || (close_on_empty && slice_len == 0);

                // An existing heap allocation is adopted
                // by pointer/len (cap = len). The contract is: when
                // `slice.ptr != buf.ptr` the slice IS a default-allocator heap
                // allocation whose ownership is being transferred into the
                // StreamResult, and downstream `Result.release()` frees it via
                // `clear_and_free`. Mirror that by adopting the raw allocation
                // instead of copying — copying would leak the original buffer.
                break 'brk if owned && done {
                    let len = u32::try_from(slice_len).expect("int cast");
                    // SAFETY: `owned` branch — `slice` is disjoint from `buf` and
                    // the caller transfers a default-allocator heap allocation of
                    // exactly `len` bytes (cap == len), all initialized.
                    StreamResult::OwnedAndDone(unsafe {
                        Vec::from_raw_parts(slice_ptr, len as usize, len as usize)
                    })
                } else if owned {
                    let len = u32::try_from(slice_len).expect("int cast");
                    // SAFETY: see above — ownership of `slice` is transferred here.
                    StreamResult::Owned(unsafe {
                        Vec::from_raw_parts(slice_ptr, len as usize, len as usize)
                    })
                } else if done {
                    StreamResult::IntoArrayAndDone(IntoArray {
                        len: slice_len as BlobSizeType,
                        value: view,
                    })
                } else {
                    StreamResult::IntoArray(IntoArray {
                        len: slice_len as BlobSizeType,
                        value: view,
                    })
                };
            }
        }
    }
}
