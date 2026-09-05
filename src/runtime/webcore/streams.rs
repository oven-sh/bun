use core::ffi::c_void;
use core::ptr::NonNull;

use bun_ptr::{BackRef, RawSlice, RefPtr};

use crate::webcore::jsc::{
    self as jsc, ArrayBuffer, CommonAbortReason, CommonAbortReasonExt as _, JSGlobalObject,
    JSPromise, JSPromiseStrong, JSType, JSValue, JsResult, SysErrorJsc, VirtualMachine,
};
use bun_collections::{ByteVecExt, VecExt};
use bun_core::{FeatureFlags, strings};
use bun_sys::{self as sys, Error as SysError, Fd};
use bun_uws as uws;

use crate::webcore::blob::Any as AnyBlob;
use crate::webcore::{AutoFlusher, ByteListPool};

// scope statics renamed with `Log` suffix so they don't collide with
// the `HTTPServerWritable<SSL>` / `NetworkSink` *types* defined below
// (RequestContext was blocked on this name clash).
bun_core::declare_scope!(HTTPServerWritableLog, visible);
bun_core::declare_scope!(NetworkSinkLog, visible);

/// `bun.ObjectPool(bun.Vec<u8>, ...)::Node` — pooled buffer node type used by
/// `HTTPServerWritable.pooled_buffer`.
type ByteListPoolNode = bun_collections::pool::Node<Vec<u8>>;

// NetworkSink stores a borrowed `*MultiPartUpload`. Now that `webcore::s3` is
// wired, alias the module to the real type so `bun_s3::MultiPartUpload` resolves
// for callers that still spell it that way.
pub mod bun_s3 {
    pub use crate::webcore::s3::MultiPartUpload;
    pub use crate::webcore::s3::multipart::UploadBackpressure;
}

/// `Blob.SizeType` is `u64` (see `webcore::blob::SizeType`).
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

// Compat: `webcore::SinkHandle` and Body refer to `streams::Result` / `streams::result::StreamError`.
pub use StreamResult as Result;
pub mod result {
    pub use super::{StreamError, Writable};
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
    Ready,
    OwnedAndDone(Vec<u8>),
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, core::marker::ConstParamTy)]
pub enum StartTag {
    ArrayBufferSink,
    FileSink,
    HTTPSResponseSink,
    HTTPResponseSink,
    NetworkSink,
    FetchRequestBodySink,
    HTMLRewriterSink,
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
    pub(crate) fn from_js_with_runtime_tag(
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
            StartTag::FetchRequestBodySink => {
                Self::from_js_with_tag::<{ StartTag::FetchRequestBodySink }>(global_this, value)
            }
            StartTag::HTMLRewriterSink => {
                Self::from_js_with_tag::<{ StartTag::HTMLRewriterSink }>(global_this, value)
            }
        }
    }

    pub(crate) fn from_js_with_tag<const TAG: StartTag>(
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
                    value.get_own(global_this, &bun_core::String::static_("asUint8Array"))?
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
                if let Some(path) = value.fast_get(global_this, jsc::BuiltinName::Path)? {
                    if !path.is_string() {
                        return Ok(Start::Err(SysError {
                            errno: sys::SystemErrno::EINVAL as _,
                            syscall: sys::Tag::write,
                            ..Default::default()
                        }));
                    }

                    return Ok(Start::FileSink(FileSinkOptions {
                        input_path: crate::webcore::PathOrFileDescriptor::Path(
                            path.to_utf8(global_this)?,
                        ),
                        truncate: true,
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
                    ..Default::default()
                }));
            }
            StartTag::NetworkSink
            | StartTag::HTTPSResponseSink
            | StartTag::HTTPResponseSink
            | StartTag::FetchRequestBodySink
            | StartTag::HTMLRewriterSink => {
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
    pub(crate) fn release(&mut self) {
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

impl StreamResult {
    pub(crate) fn slice16(&self) -> &[u16] {
        // Caller guarantees bytes are u16-aligned and even length;
        // bytemuck checks both at runtime.
        bytemuck::cast_slice(self.slice())
    }

    pub(crate) fn slice(&self) -> &[u8] {
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
    Temporary(BlobSizeType),
}

pub struct WritablePending {
    pub(crate) future: WritableFuture,
    pub(crate) result: Writable,
    pub(crate) consumed: BlobSizeType,
    pub(crate) state: PendingState,
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
}

impl WritablePending {
    pub(crate) fn promise(&mut self, global_this: &JSGlobalObject) -> *mut JSPromise {
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

impl WritablePending {
    /// Settle the parked write (see [`Pending::run`] for what happens to an
    /// exception the settle leaves).
    pub(crate) fn run(&mut self) {
        if self.state != PendingState::Pending {
            return;
        }
        self.state = PendingState::Used;
        // `consumed` belongs to the operation being settled here; the next one
        // starts from zero.
        self.consumed = 0;

        match core::mem::replace(&mut self.future, WritableFuture::None) {
            WritableFuture::Promise { mut strong, global } => Writable::fulfill_promise(
                core::mem::replace(&mut self.result, Writable::Done),
                strong.swap(),
                &global,
            ),
            WritableFuture::None => {}
        }
    }
}

impl Writable {
    /// The write side of [`StreamResult::fulfill_promise`]: terminal in the
    /// same way.
    pub(crate) fn fulfill_promise(
        result: Writable,
        promise: &mut JSPromise,
        global_this: &JSGlobalObject,
    ) {
        // Adopt the caller's outstanding protect(); Drop unprotects on all paths.
        let _guard = jsc::js_value::Protected::adopt(promise.to_js());
        let settled = match result {
            Writable::Err(err) => {
                promise.reject_with_async_stack(global_this, Ok(err.to_js(global_this)))
            }
            Writable::Done => promise.resolve(global_this, JSValue::FALSE),
            other => promise.resolve(global_this, other.to_js(global_this)),
        };
        crate::dispatch::fold(settled);
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
            Writable::Temporary(len) => JSValue::from(len),
            // false == controller.close()
            // undefined == noop, but we probably won't send it
            Writable::Done => JSValue::TRUE,
            Writable::Pending(pending) => {
                // SAFETY: pending is a valid borrowed pointer per BORROW_PARAM
                // classification; exclusive borrow scoped to the call.
                let prom = unsafe { (*pending).promise(global_this) };
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
    pub(crate) len: BlobSizeType,
}

// ─── Result.Pending ──────────────────────────────────────────────────────

pub struct Pending {
    pub(crate) future: PendingFuture,
    pub(crate) result: StreamResult,
    pub(crate) state: PendingState,
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

impl Pending {
    pub(crate) fn promise(&mut self, global_object: &JSGlobalObject) -> *mut JSPromise {
        let prom = std::ptr::from_mut::<JSPromise>(JSPromise::create(global_object));
        self.future = PendingFuture::Promise {
            promise: prom,
            global_this: BackRef::new(global_object),
        };
        self.state = PendingState::Pending;
        prom
    }

    pub(crate) fn run_on_next_tick(&mut self) {
        if self.state != PendingState::Pending {
            return;
        }
        // SAFETY: VirtualMachine::get() returns the per-thread singleton VM; sole
        // `&`-borrow on this thread, outlives this call.
        let vm = VirtualMachine::get();
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
    pub(crate) fn run_from_js_thread(this: *mut Pending) {
        // SAFETY: this was heap-allocated in run_on_next_tick
        let mut boxed = unsafe { bun_core::heap::take(this) };
        boxed.run();
    }

    /// The loop refused the deferred fulfilment (VM teardown): nobody awaits
    /// the read any more, so drop the promise's root and the parked result.
    pub(crate) fn release_without_running(this: *mut Pending) {
        // SAFETY: heap-allocated in run_on_next_tick; refused, so we own it.
        let mut boxed = unsafe { bun_core::heap::take(this) };
        boxed.state = PendingState::Used;
        if let PendingFuture::Promise { promise, .. } = &boxed.future {
            JSPromise::opaque_ref(*promise).to_js().unprotect();
        }
        drop(boxed);
    }
}

impl bun_event_loop::Taskable for Pending {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::StreamPending;
    /// Deferred out of a finalizer or a late completion: do the script-free
    /// part of what the dispatch would have done.
    unsafe fn release_unrun(this: *mut Self) {
        Pending::release_without_running(this);
    }
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

pub struct PendingHandler {
    pub ctx: *mut c_void,
    pub(crate) handler: PendingHandlerFn,
}

type PendingHandlerFn = fn(ctx: *mut c_void, result: StreamResult);

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum PendingState {
    None,
    Pending,
    Used,
}

// ──────────────────────────────────────────────────────────────────────────
// JSC-integration: Pending::run, StreamResult::to_js/fulfill_promise, SourceHandle,
// HTTPServerWritable<*> impl, NetworkSink impl, BufferAction, ReadResult.
// ──────────────────────────────────────────────────────────────────────────

impl Pending {
    /// Settle the parked read. This is the stream settle primitive, reached
    /// from native frames of every kind (sink ABI methods, uWS response
    /// callbacks, pipe I/O, tasks): the promise is settled with a value built
    /// here — never a user thenable; a value that cannot be built becomes the
    /// rejection — so what settling itself can leave pending is the VM's
    /// termination (or the settle throwing), and it is folded here
    /// (`dispatch::fold`) rather than handed to callers that have nowhere to
    /// put it. The pending itself is consumed either way.
    pub(crate) fn run(&mut self) {
        if self.state != PendingState::Pending {
            return;
        }
        self.state = PendingState::Used;
        match &self.future {
            PendingFuture::Promise {
                promise,
                global_this,
            } => StreamResult::fulfill_promise(&mut self.result, *promise, global_this),
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
    pub(crate) fn is_done(&self) -> bool {
        matches!(
            self,
            StreamResult::OwnedAndDone(_)
                | StreamResult::TemporaryAndDone(_)
                | StreamResult::IntoArrayAndDone(_)
                | StreamResult::Done
                | StreamResult::Err(_)
        )
    }

    /// Terminal: see [`Pending::run`].
    pub(crate) fn fulfill_promise(
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

        // A completion for a VM that no longer runs script settles nothing: `release()` frees
        // `.owned`/`.owned_and_done` and unprotects `.err` instead of leaking them.
        if !vm.script_allowed() {
            result.release();
            *result = StreamResult::Temporary(RawSlice::EMPTY);
            return;
        }

        let _exit = vm.enter_event_loop_scope();

        // S008: `JSPromise` is an `opaque_ffi!` ZST — safe `*mut → &mut` deref.
        // Each settle forms a fresh temp `&mut`, the sole borrow across that
        // re-entrant call (no long-lived `&mut JSPromise` held).
        let settled = match result {
            StreamResult::Err(err) => {
                let value = err.to_js(global_this);
                value.ensure_still_alive();
                *result = StreamResult::Temporary(RawSlice::EMPTY);
                JSPromise::opaque_mut(promise).reject_with_async_stack(global_this, Ok(value))
            }
            StreamResult::Done => {
                JSPromise::opaque_mut(promise).resolve(global_this, JSValue::FALSE)
            }
            _ => {
                let value = result.to_js(global_this);
                *result = StreamResult::Temporary(RawSlice::EMPTY);
                match value {
                    Ok(value) => {
                        value.ensure_still_alive();
                        JSPromise::opaque_mut(promise).resolve(global_this, value)
                    }
                    Err(err) => JSPromise::opaque_mut(promise).reject(global_this, Err(err)),
                }
            }
        };
        crate::dispatch::fold(settled);
    }

    pub fn to_js(&mut self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
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
                // SAFETY: pending is a valid borrowed pointer per BORROW_PARAM
                // classification; exclusive borrow scoped to the call.
                let promise = unsafe { (**pending).promise(global_this) };
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
// SourceHandle
// ──────────────────────────────────────────────────────────────────────────

/// Generic controller externs (defined in the generated `JSSink.cpp`). Every
/// `JSReadable*SinkController` shares the `JSReadableSinkControllerBase`
/// layout, so one symbol per operation suffices for all sink kinds.
pub(crate) mod controller_abi {
    unsafe extern "C" {
        #[link_name = "JSSinkController__onReady"]
        pub(crate) safe fn on_ready(
            c: ::bun_jsc::JSValue,
            amt: ::bun_jsc::JSValue,
            off: ::bun_jsc::JSValue,
        );
        #[link_name = "JSSinkController__onClose"]
        pub(crate) safe fn on_close(c: ::bun_jsc::JSValue, reason: ::bun_jsc::JSValue);
        #[link_name = "JSSinkController__detachPtr"]
        pub(crate) safe fn detach_ptr(c: ::bun_jsc::JSValue);
        /// Returns undefined (drained inline), the pump promise, or the thrown Exception cell.
        #[link_name = "JSSinkController__assignToStream"]
        pub(crate) safe fn assign_to_stream(
            g: &::bun_jsc::JSGlobalObject,
            stream: ::bun_jsc::JSValue,
            c: ::bun_jsc::JSValue,
        ) -> ::bun_jsc::JSValue;
    }
}

/// Static-dispatch signal set for a [`SourceHandle`] pointee. The match arms
/// dispatch via [`BackRef`] deref and call these; defaults are no-ops so
/// implementors override only the signals they actually handle.
trait UpstreamSource {
    #[inline]
    fn on_ready(&self) {}
    #[inline]
    fn on_close(&self, _err: Option<SysError>) {}
    #[inline]
    fn on_start(&self) {}
}

impl UpstreamSource for crate::webcore::ByteStream {
    #[inline]
    fn on_ready(&self) {
        self.resume();
    }
    #[inline]
    fn on_close(&self, err: Option<SysError>) {
        self.cancel_from_sink(err);
    }
}

impl UpstreamSource for crate::webcore::FileReader {
    #[inline]
    fn on_ready(&self) {
        self.pull_into_sink();
    }
    #[inline]
    fn on_close(&self, _err: Option<SysError>) {
        self.unpipe_without_deref();
        self.on_cancel();
    }
}

impl UpstreamSource for crate::api::bun::subprocess::Subprocess<'static> {
    #[inline]
    fn on_close(&self, err: Option<SysError>) {
        crate::api::bun::subprocess::Writable::on_close(self, err);
    }
}

impl UpstreamSource for crate::webcore::fetch::fetch_tasklet::FetchTasklet {
    #[inline]
    fn on_ready(&self) {
        self.on_stream_drained();
    }
    #[inline]
    fn on_start(&self) {
        self.on_consumer_attached();
    }
}

impl UpstreamSource for crate::api::html_rewriter::RewriterPipe {
    #[inline]
    fn on_ready(&self) {
        self.resume();
    }
    #[inline]
    fn on_close(&self, err: Option<SysError>) {
        self.cancel_from_output(err);
    }
}

/// Tagged handle a sink holds to its upstream source — a closed set of
/// variants so native source↔sink pairs can pump without a JS round-trip.
#[derive(Copy, Clone, Default)]
pub enum SourceHandle {
    /// No source attached.
    #[default]
    None,
    /// The C++ controller cell of a JS-stream pump (`JSSink::assign_to_stream`).
    JSController(JSValue),
    ByteStream(BackRef<crate::webcore::ByteStream>),
    FileReader(BackRef<crate::webcore::FileReader>),
    /// The `'static` bound erases the `&JSGlobalObject` borrow carried in
    /// `Subprocess<'a>`; the pointed-at allocation outlives this handle.
    Subprocess(BackRef<crate::api::bun::subprocess::Subprocess<'static>>),
    ShellWritable(BackRef<crate::shell::subproc::Writable, bun_ptr::Mut>),
    FetchResponseBody(BackRef<crate::webcore::fetch::fetch_tasklet::FetchTasklet, bun_ptr::Mut>),
    ServerRequestBody(crate::server::AnyRequestContext),
    S3DownloadBody(BackRef<crate::webcore::s3::client::S3DownloadStreamWrapper>),
    HTMLRewriter(BackRef<crate::api::html_rewriter::RewriterPipe>),
    /// `bun:internal-for-testing` only: `ready()` re-enters the stream's
    /// `on_cancel`, making consumed-during-`signal_drained` re-entrancy
    /// deterministic for tests.
    TestingCancelOnDrain(BackRef<crate::webcore::ByteStream>),
}

impl SourceHandle {
    #[inline]
    pub fn is_dead(&self) -> bool {
        matches!(self, SourceHandle::None)
    }

    #[inline]
    pub fn clear(&mut self) {
        *self = SourceHandle::None;
    }

    pub fn close(&mut self, err: Option<SysError>) {
        match *self {
            SourceHandle::None => {}
            SourceHandle::JSController(cpp) => {
                let global = VirtualMachine::get().global();
                // A frame above is unwinding with its exception: not ours to run
                // over. Otherwise the controller's close is settled here like a
                // parked promise (`Pending::run`).
                if global.has_exception() {
                    return;
                }
                crate::dispatch::fold(::bun_jsc::call_check_slow(global, || {
                    controller_abi::on_close(cpp, JSValue::UNDEFINED)
                }));
            }
            SourceHandle::ByteStream(p) => p.on_close(err),
            SourceHandle::FileReader(p) => p.on_close(err),
            SourceHandle::Subprocess(p) => p.on_close(err),
            // SAFETY: live backref; cleared before the pointee is freed.
            SourceHandle::ShellWritable(mut p) => unsafe { p.get_mut() }.on_close(err),
            SourceHandle::FetchResponseBody(p) => p.on_stream_cancelled(),
            SourceHandle::S3DownloadBody(p) => p.on_stream_cancelled(),
            SourceHandle::ServerRequestBody(_) => {}
            SourceHandle::HTMLRewriter(p) => p.on_close(err),
            SourceHandle::TestingCancelOnDrain(_) => {}
        }
    }

    pub fn ready(&mut self, _amount: Option<BlobSizeType>, _offset: Option<BlobSizeType>) {
        match *self {
            SourceHandle::None => {}
            SourceHandle::JSController(cpp) => {
                let global = VirtualMachine::get().global();
                if global.has_exception() {
                    return;
                }
                crate::dispatch::fold(::bun_jsc::call_check_slow(global, || {
                    controller_abi::on_ready(cpp, JSValue::UNDEFINED, JSValue::UNDEFINED)
                }));
            }
            SourceHandle::ByteStream(p) => p.on_ready(),
            SourceHandle::FileReader(p) => p.on_ready(),
            SourceHandle::FetchResponseBody(p) => p.on_ready(),
            SourceHandle::ServerRequestBody(any) => any.on_request_body_stream_drained(),
            SourceHandle::HTMLRewriter(p) => p.on_ready(),
            SourceHandle::S3DownloadBody(p) => p.on_stream_drained(),
            SourceHandle::TestingCancelOnDrain(p) => {
                p.on_cancel();
            }
            // Remaining variants leave `on_ready` at the trait default (no-op).
            SourceHandle::Subprocess(_) | SourceHandle::ShellWritable(_) => {}
        }
    }

    /// The source's JS wrapper was collected while this producer still held the
    /// source: nothing can read what it delivers from now on. Called from a GC
    /// sweep: arms must not run JS.
    pub fn consumer_collected(self) {
        match self {
            SourceHandle::FetchResponseBody(p) => p.on_body_stream_collected(),
            SourceHandle::S3DownloadBody(p) => p.on_stream_collected(),
            SourceHandle::None
            | SourceHandle::JSController(_)
            | SourceHandle::ServerRequestBody(_)
            | SourceHandle::ByteStream(_)
            | SourceHandle::FileReader(_)
            | SourceHandle::Subprocess(_)
            | SourceHandle::ShellWritable(_)
            | SourceHandle::HTMLRewriter(_)
            | SourceHandle::TestingCancelOnDrain(_) => {}
        }
    }

    pub fn start(&mut self) {
        match *self {
            SourceHandle::FetchResponseBody(p) => p.on_start(),
            SourceHandle::S3DownloadBody(p) => p.on_consumer_attached(),
            // Remaining variants leave `on_start` at the trait default (no-op).
            SourceHandle::None
            | SourceHandle::JSController(_)
            | SourceHandle::ServerRequestBody(_)
            | SourceHandle::ByteStream(_)
            | SourceHandle::FileReader(_)
            | SourceHandle::Subprocess(_)
            | SourceHandle::ShellWritable(_)
            | SourceHandle::HTMLRewriter(_)
            | SourceHandle::TestingCancelOnDrain(_) => {}
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// HTTPServerWritable
// ──────────────────────────────────────────────────────────────────────────

/// `Done` and `Aborted` are both "done" (no further sends); `Aborted`
/// additionally records that the peer went away. `start()` (reachable again
/// through a `type: "direct"` stream's controller) moves `Done` back to
/// `Writing`; it bails out first on `Aborted`, which nothing leaves.
#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum HTTPServerWritableState {
    Writing,
    Done,
    Aborted,
}

/// `SSL` only selects which JS sink class (`HTTPResponseSink` /
/// `HTTPSResponseSink`) wraps this; the response itself is dispatched at
/// runtime through `uws::AnyResponse`, so one instantiation serves HTTP/1.1,
/// HTTP/2 and HTTP/3 alike.
pub struct HTTPServerWritable<const SSL: bool> {
    pub(crate) res: Option<uws::AnyResponse>,
    pub(crate) buffer: Vec<u8>,
    pub(crate) pooled_buffer: Option<NonNull<ByteListPoolNode>>,
    pub offset: BlobSizeType,

    pub(crate) wrote: BlobSizeType,

    // allocator field dropped — global mimalloc per §Allocators
    pub(crate) state: HTTPServerWritableState,
    pub(crate) source: SourceHandle,
    pub(crate) pending_flush: Option<*mut JSPromise>,
    /// Backpressure promise returned from `write()` to a JS controller (direct
    /// stream `pull` or `readStreamIntoSink`). Resolved on drain via
    /// `flush_promise()` → `pending.run()`.
    pub(crate) pending: WritablePending,
    pub(crate) wrote_at_start_of_flush: BlobSizeType,
    // JSC_BORROW: process-lifetime VM global; `None` until `flush_from_js`/
    // `end_from_js` install it. Safe `Deref` via `BackRef`.
    pub global_this: Option<BackRef<JSGlobalObject>>,
    pub(crate) high_water_mark: BlobSizeType,

    pub(crate) requested_end: bool,

    pub(crate) has_backpressure: bool,
    /// `write()` returned `Backpressure` to the upstream source (so it is
    /// parked on the sink). `on_writable` fires `source.ready()` only when
    /// this is set; a drain that merely follows `flush()`/auto-flush must not
    /// re-invoke a direct-stream `pull`. Same pattern as
    /// `FileSink::source_pending_pull`.
    pub(crate) source_pending_pull: bool,
    pub(crate) end_len: usize,
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
    pub(crate) ended_response: bool,

    pub(crate) on_first_write: Option<fn(Option<*mut c_void>)>,
    pub ctx: Option<*mut c_void>,

    pub(crate) auto_flusher: AutoFlusher,
}

impl<const SSL: bool> Default for HTTPServerWritable<SSL> {
    fn default() -> Self {
        Self {
            res: None,
            buffer: Vec::<u8>::default(),
            pooled_buffer: None,
            offset: 0,
            wrote: 0,
            state: HTTPServerWritableState::Writing,
            source: SourceHandle::default(),
            pending_flush: None,
            pending: WritablePending::default(),
            wrote_at_start_of_flush: 0,
            global_this: None,
            high_water_mark: 2048,
            requested_end: false,
            has_backpressure: false,
            source_pending_pull: false,
            end_len: 0,
            ended_response: false,
            on_first_write: None,
            ctx: None,
            auto_flusher: AutoFlusher::default(),
        }
    }
}

impl<const SSL: bool> HTTPServerWritable<SSL> {
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

    /// Don't include @sizeOf(This) because it's already included in the memoryCost of the sink
    pub(crate) fn memory_cost(&self) -> usize {
        // TODO: include Socket send buffer size. We can't here because we
        // don't track if it's still accessible.
        // Since this is a JSSink, the NewJSSink function does @sizeOf(JSSink) which includes @sizeOf(ArrayBufferSink).
        self.buffer.capacity() as usize
    }

    pub(crate) const NAME: &'static str = if SSL {
        "HTTPSResponseSink"
    } else {
        "HTTPResponseSink"
    };
    // associated const with const-generic if — requires `#![feature(generic_const_exprs)]` or a trait-based dispatch.
}

/// Per-monomorphization JSSink wrapper alias. Mirrors
/// `pub const JSSink = Sink.JSSink(@This(), name)`.
pub type HTTPServerWritableJSSink<const SSL: bool> =
    crate::webcore::sink::JSSink<HTTPServerWritable<SSL>>;

// `HTTPServerWritable` is exposed to JS via `Sink.JSSink(@This(), name)` where
// `name` ∈ {HTTPResponseSink, HTTPSResponseSink}. Const-generics
// can't drive `#[link_name]`, so declare both extern sets in a private mod
// and dispatch at call time on `SSL`. The branch is on a const generic;
// the optimizer folds it to a direct call per monomorphization.
mod http_sink_abi {
    crate::decl_js_sink_externs!("HTTPResponseSink" as http);
    crate::decl_js_sink_externs!("HTTPSResponseSink" as https);
}

macro_rules! http_sink_dispatch {
    ($f:ident($($arg:expr),*)) => {
        if SSL {
            http_sink_abi::https::$f($($arg),*)
        } else {
            http_sink_abi::http::$f($($arg),*)
        }
    };
}

impl<const SSL: bool> crate::webcore::sink::JsSinkAbi for HTTPServerWritable<SSL> {
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
    fn create_controller_extern(global: &JSGlobalObject, ptr: *mut c_void) -> JSValue {
        http_sink_dispatch!(create_controller(global, ptr))
    }
}

impl<const SSL: bool> HTTPServerWritable<SSL> {
    #[inline]
    fn any_res(&self) -> Option<uws::AnyResponse> {
        self.res
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

    pub(crate) fn is_done(&self) -> bool {
        self.state != HTTPServerWritableState::Writing
    }

    pub(crate) fn is_aborted(&self) -> bool {
        self.state == HTTPServerWritableState::Aborted
    }

    /// `Aborted` is already done and stays `Aborted`; callers still read
    /// `is_aborted()` afterwards.
    pub(crate) fn set_done(&mut self) {
        if self.state == HTTPServerWritableState::Writing {
            self.state = HTTPServerWritableState::Done;
        }
    }

    fn has_backpressure(&self) -> bool {
        self.has_backpressure
    }

    fn has_backpressure_and_is_try_end(&self) -> bool {
        self.has_backpressure && self.end_len > 0
    }

    /// `len` bytes were accepted by `send`/`send_readable`. When uWS reports
    /// the socket is now backed up, return a pending Promise for JS-controller
    /// sources (direct-stream `pull` can `await controller.write()`; the
    /// `readStreamIntoSink` pump treats a pending promise the same as the
    /// negative sentinel). Native ByteStream/FileReader pumps match on
    /// `Backpressure` directly, so keep that variant for them. `on_writable`
    /// drains via `flush_promise()` → `pending.run()` and `source.ready()`.
    #[inline]
    fn writable_result(&mut self, len: BlobSizeType) -> Writable {
        if self.has_backpressure && !self.is_done() && !self.requested_end {
            self.source_pending_pull = true;
            if matches!(
                self.source,
                SourceHandle::ByteStream(_) | SourceHandle::FileReader(_)
            ) {
                return Writable::Backpressure(len);
            }
            self.pending.consumed = len;
            self.pending.result = Writable::Owned(len);
            return Writable::Pending(core::ptr::from_mut(&mut self.pending));
        }
        Writable::Owned(len)
    }

    fn send_without_auto_flusher(&mut self, buf: &[u8]) -> bool {
        debug_assert!(!self.is_done());

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
        debug_assert!(!self.is_done());
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

    pub(crate) fn on_writable(&mut self, write_offset: u64, _res: uws::AnyResponse) -> bool {
        // write_offset is the amount of data that was written not how much we need to write
        bun_core::scoped_log!(HTTPServerWritableLog, "onWritable ({})", write_offset);
        // onWritable reset backpressure state to allow flushing
        self.has_backpressure = false;
        if self.is_aborted() {
            self.source.close(None);
            self.flush_promise();
            self.finalize();
            return false;
        }

        // Streaming-write drain: uWS already holds the data (our buffer is
        // empty), so there is nothing to resend. Resolve any flush(true) waiter
        // and, if the last `write()` returned Backpressure to the source, fire
        // `source.ready()` — `readStreamIntoSink` parks on the controller's
        // onPull (not a flush promise), so without `ready()` the pump never
        // resumes. A `type: "direct"` pull that awaited `flush(true)` resumes
        // via that promise instead, so suppress `ready()` when a flush waiter
        // was just resolved to avoid re-entering the user's pull. Handled
        // before the try_end resend bookkeeping below, which assumes a
        // non-empty buffer.
        if self.readable_slice().is_empty() {
            if self.is_done() {
                self.source_pending_pull = false;
                self.source.close(None);
                self.flush_promise();
                self.finalize();
                return true;
            }
            let had_flush_waiter = self.pending_flush.is_some();
            self.flush_promise();
            if core::mem::take(&mut self.source_pending_pull)
                && !had_flush_waiter
                && !self.is_done()
                && !self.requested_end
                && !self.has_backpressure()
            {
                self.source.ready(None, None);
            }
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
            if self.is_done() {
                self.source.close(None);
                self.flush_promise();
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
                    // Release any request-body pause while `res` is live (see `end_already_responded_stream`).
                    res.resume();
                }
                // `send_readable` drained the parked `try_end`, so uWS has
                // `markDone()`d the response and dropped its `onAborted`.
                self.ended_response = true;
                self.source.close(None);
                self.flush_promise();
                self.finalize();
                return true;
            }
        }

        // flush the javascript promise from calling .flush()
        let had_flush_waiter = self.pending_flush.is_some();
        self.flush_promise();

        // pending_flush or callback could have caused another send()
        // so we check again if we should report readiness
        let had_pending_pull = core::mem::take(&mut self.source_pending_pull);
        if !self.is_done() && !self.requested_end && !self.has_backpressure() {
            if (total_written > 0 || (had_pending_pull && !had_flush_waiter))
                && self.readable_slice().is_empty()
            {
                self.source.ready(Some(total_written as BlobSizeType), None);
            }
        }

        true
    }

    pub(crate) fn start(&mut self, stream_start: &Start) -> bun_sys::Result<()> {
        if self.is_aborted() || self.res.is_none() || self.any_res().unwrap().has_responded() {
            self.mark_done();
            self.source.close(None);
            return bun_sys::Result::Ok(());
        }

        self.wrote = 0;
        self.wrote_at_start_of_flush = 0;
        self.flush_promise();

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

        self.state = HTTPServerWritableState::Writing;
        self.source.start();
        bun_core::scoped_log!(HTTPServerWritableLog, "start({})", self.high_water_mark);
        bun_sys::Result::Ok(())
    }

    fn flush_from_js_no_wait(&mut self) -> bun_sys::Result<JSValue> {
        bun_core::scoped_log!(HTTPServerWritableLog, "flushFromJSNoWait");
        bun_sys::Result::Ok(JSValue::from(self.flush_no_wait()))
    }

    pub(crate) fn flush_no_wait(&mut self) -> usize {
        if self.has_backpressure_and_is_try_end() || self.is_done() {
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

    pub(crate) fn flush_from_js(
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

        if self.is_done() {
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

        if !self.has_backpressure() || self.is_done() {
            return bun_sys::Result::Ok(());
        }

        if self.res.is_none() || self.any_res().unwrap().has_responded() {
            self.mark_done();
            self.source.close(None);
        }

        bun_sys::Result::Ok(())
    }

    pub fn write(&mut self, data: &StreamResult) -> Writable {
        if self.is_done() || self.requested_end {
            return Writable::Owned(0);
        }

        let bytes = data.slice();
        let len = bytes.len() as BlobSizeType;
        bun_core::scoped_log!(HTTPServerWritableLog, "write({})", bytes.len());

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

    pub(crate) fn write_latin1(&mut self, data: &StreamResult) -> Writable {
        if self.is_done() || self.requested_end {
            return Writable::Owned(0);
        }

        if self.res.is_none() || self.any_res().unwrap().has_responded() {
            self.source.close(None);
            self.mark_done();
            return Writable::Done;
        }

        let bytes = data.slice();
        let len = bytes.len() as BlobSizeType;
        bun_core::scoped_log!(HTTPServerWritableLog, "writeLatin1({})", bytes.len());

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

    pub(crate) fn write_utf16(&mut self, data: &StreamResult) -> Writable {
        if self.is_done() || self.requested_end {
            return Writable::Owned(0);
        }

        if self.res.is_none() || self.any_res().unwrap().has_responded() {
            self.source.close(None);
            self.mark_done();
            return Writable::Done;
        }

        let bytes = data.slice();

        bun_core::scoped_log!(HTTPServerWritableLog, "writeUTF16({})", bytes.len());

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

    pub(crate) fn mark_done(&mut self) {
        self.set_done();
        self.unregister_auto_flusher();
    }

    /// In this case, it's always an error
    pub(crate) fn end(&mut self, err: Option<SysError>) -> bun_sys::Result<()> {
        bun_core::scoped_log!(HTTPServerWritableLog, "end({:?})", err);

        if self.requested_end {
            return bun_sys::Result::Ok(());
        }

        if self.is_done() || self.res.is_none() || self.any_res().unwrap().has_responded() {
            self.source.close(err);
            self.mark_done();
            self.finalize();
            return bun_sys::Result::Ok(());
        }

        self.requested_end = true;
        let readable_len = self.readable_slice().len();
        self.end_len = readable_len;

        if readable_len == 0 {
            self.source.close(err);
            self.mark_done();
            // we do not close the stream here
            // this.res.endStream(false);
            self.finalize();
            return bun_sys::Result::Ok(());
        }
        bun_sys::Result::Ok(())
    }

    pub(crate) fn end_from_js(&mut self, global_this: &JSGlobalObject) -> bun_sys::Result<JSValue> {
        bun_core::scoped_log!(HTTPServerWritableLog, "endFromJS()");

        if self.requested_end {
            return bun_sys::Result::Ok(JSValue::from(0i32));
        }

        if self.is_done() || self.res.is_none() || self.any_res().unwrap().has_responded() {
            self.requested_end = true;
            self.source.close(None);
            self.mark_done();
            self.finalize();
            return bun_sys::Result::Ok(JSValue::from(0i32));
        }

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

        if let Some(res) = self.any_res() {
            // Release any request-body pause while `res` is live (see `end_already_responded_stream`).
            res.resume();
        }
        // Both branches above fully ended the response through uWS, which
        // `markDone()`s it and drops its `onAborted`.
        self.ended_response = true;
        self.mark_done();
        self.flush_promise();
        self.source.close(None);
        self.finalize();

        bun_sys::Result::Ok(JSValue::from(self.wrote))
    }

    /// Takes `*mut Self`, not `&mut self`: closing the signal runs the controller's
    /// JS `onClose`, which can cancel the stream, drain microtasks, and free this
    /// sink. A `&mut self` argument protector must not be live across that free.
    ///
    /// # Safety
    /// `this` must point at the live sink owned by the `RequestContext`.
    pub(crate) unsafe fn abort(this: *mut Self) {
        bun_core::scoped_log!(HTTPServerWritableLog, "onAborted()");
        // SAFETY: caller contract — `this` is live, and every access here is scoped
        // so no borrow spans the signal close below, which may free `*this`.
        unsafe {
            (*this).state = HTTPServerWritableState::Aborted;
            (*this).res = None;
            (*this).unregister_auto_flusher();
        }

        // SAFETY: nothing above freed `*this`; exclusive borrow scoped to the call.
        unsafe { (*this).flush_promise() };
        // SAFETY: as above.
        unsafe { (*this).finalize() };

        // Close the source last and through a stack copy: the close fires the JS
        // onClose callback, and the teardown it can re-enter frees this sink, so
        // no reference into the allocation may be live across the call.
        // SAFETY: as above; `source` is copied out before the close.
        let mut source = unsafe { (*this).source };
        source.close(None);
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

    pub(crate) fn on_auto_flush(&mut self) -> bool {
        bun_core::scoped_log!(HTTPServerWritableLog, "onAutoFlush()");
        if self.is_done() {
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

        if self.requested_end {
            if let Some(res) = self.any_res() {
                res.clear_on_writable();
                // Release any request-body pause while `res` is live (see `end_already_responded_stream`).
                res.resume();
            }
            // `send_readable` drained the parked `try_end`/`end`, so uWS has
            // `markDone()`d the response and dropped its `onAborted`.
            self.ended_response = true;
            self.source.close(None);
            self.flush_promise();
            self.finalize();
        }
        false
    }

    /// # Safety
    /// `this` must be a valid, uniquely-owned heap pointer to `Self` produced
    /// by `bun_core::heap::into_raw`; the caller transfers ownership.
    // Forwards `this` to `bun_core::heap::take` without dereferencing it here;
    // not_unsafe_ptr_arg_deref is a false positive on opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn destroy(this: *mut Self) {
        bun_core::scoped_log!(HTTPServerWritableLog, "destroy()");
        // SAFETY: this was heap-allocated; destroy takes sole ownership. Reclaim
        // the Box first so we never hold a `&mut *this` alongside the Box's
        // unique pointer.
        let mut this = unsafe { bun_core::heap::take(this) };
        // Callers may tear this sink down without routing through
        // flushPromise() (e.g. handleResolveStream / handleRejectStream).
        // Drop the GC root so the promise can be collected.
        this.pending.result = Writable::Done;
        this.pending.run();
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
        if !self.is_done() {
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
            self.set_done();

            // When the sink already ended the response through uWS
            // (`res.end()`/`try_end` drained, which wrote the terminating
            // chunk and `markDone()`d the response), `end_stream()` would
            // write a second `0\r\n\r\n` that corrupts the next response on a
            // keep-alive connection.
            if !self.ended_response {
                if let Some(res) = self.any_res() {
                    // is actually fine to call this if the socket is closed because of flushNoWait, the free will be defered by usockets
                    res.end_stream(false);
                }
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

    /// Settle a parked `write()` and the pending `flush(true)`/`end()` promise.
    /// Terminal like the settle primitives (`Pending::run`): both resolve with
    /// values built here.
    pub(crate) fn flush_promise(&mut self) {
        // Settle any `write()` → `Pending` promise first so a parked JS writer
        // wakes on every drain/teardown path that reaches here.
        self.pending.run();
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
            // SAFETY: as above.
            crate::dispatch::fold(result);
        }
    }
}

// `JsSinkType` impl: routes the codegen `${name}__{construct,write,end,flush,
// start,getInternalFd,memoryCost}` thunks (via `JSSink::<Self>::js_*`) into
// the inherent streaming methods above. Mirrors `Sink.JSSink(@This(), name)`.
impl<const SSL: bool> crate::webcore::sink::JsSinkType for HTTPServerWritable<SSL> {
    const NAME: &'static str = Self::NAME;
    const HAS_FLUSH_FROM_JS: bool = true;
    const START_TAG: Option<StartTag> = Some(if SSL {
        StartTag::HTTPSResponseSink
    } else {
        StartTag::HTTPResponseSink
    });

    crate::impl_js_sink_forwarders!();

    unsafe fn finalize(this: *mut Self) {
        // SAFETY: trait contract — `this` is live, and only the RequestContext's
        // `destroy` frees it (never the inherent `finalize`), so the `&mut`
        // scoped to this call stays valid throughout.
        unsafe { (*this).finalize() }
    }
    fn end_from_js(&mut self, global: &JSGlobalObject) -> bun_sys::Result<JSValue> {
        Self::end_from_js(self, global)
    }
    fn source(&mut self) -> Option<&mut SourceHandle> {
        Some(&mut self.source)
    }
}

pub type HTTPSResponseSink = HTTPServerWritable<true>;
pub type HTTPResponseSink = HTTPServerWritable<false>;

// ──────────────────────────────────────────────────────────────────────────
// NetworkSink
// ──────────────────────────────────────────────────────────────────────────

pub struct NetworkSink {
    /// The sink's ref on the upload, released in `detach_writable`.
    pub task: Option<RefPtr<bun_s3::MultiPartUpload>>,
    pub(crate) source: SourceHandle,
    // JSC_BORROW: process-lifetime VM global; safe `Deref` via `BackRef`.
    pub global_this: Option<BackRef<JSGlobalObject>>,
    /// Pending `flush()` promise. Serves both the user `s3file.writer().flush()`
    /// API and the `readDirectStream` / `BunAsyncIterableSource` pump, which
    /// parks on `controller.flush(true)` (not `m_onPull`) on backpressure.
    /// Resolved by `on_writable`. The `readStreamIntoSink` pump no longer calls
    /// `flush()` — it resumes via `source.ready()` → `m_onPull` — so no promise
    /// is allocated on that path.
    pub(crate) flush_promise: JSPromiseStrong,
    /// Backpressure promise returned from `write()` to a JS controller;
    /// resolved by `on_writable` → `pending.run()`.
    pub(crate) pending: WritablePending,
    pub(crate) end_promise: JSPromiseStrong,
    /// Upstream ByteStream error stashed by `end_from_stream` so the upload
    /// failure callback can reject with the original JS error (e.g. S3
    /// `NoSuchKey`) instead of the generic `UnknownError` passed to `fail()`.
    pub(crate) upstream_error: jsc::strong::Optional,
    pub(crate) ended: bool,
    pub(crate) done: bool,
    /// `s3file.writer()`: the box is referenced by the JS wrapper (`finalize`) and by the upload's
    /// completion callback; whichever lets go last frees it. 0 = owned elsewhere
    /// (`S3UploadStreamWrapper`).
    pub(crate) writer_holders: core::cell::Cell<u8>,
}

impl Default for NetworkSink {
    fn default() -> Self {
        Self {
            task: None,
            source: SourceHandle::default(),
            global_this: None,
            flush_promise: JSPromiseStrong::default(),
            pending: WritablePending::default(),
            end_promise: JSPromiseStrong::default(),
            upstream_error: jsc::strong::Optional::empty(),
            ended: false,
            done: false,
            writer_holders: core::cell::Cell::new(0),
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
    #[inline]
    fn task_ref(&self) -> Option<&bun_s3::MultiPartUpload> {
        self.task.as_deref()
    }

    pub(crate) fn new(init: NetworkSink) -> Box<NetworkSink> {
        Box::new(init)
    }

    pub fn path(&self) -> Option<&[u8]> {
        if let Some(task) = self.task_ref() {
            return Some(&task.path);
        }
        None
    }

    pub(crate) fn start(&mut self, _stream_start: &Start) -> bun_sys::Result<()> {
        if self.ended {
            return bun_sys::Result::Ok(());
        }

        self.source.start();
        bun_sys::Result::Ok(())
    }

    pub fn finalize(&mut self) {
        self.detach_writable();
    }

    /// One of the `writer_holders` is done with the box.
    ///
    /// # Safety
    /// `this` is the live heap box from `writable()`; not used by the caller afterwards.
    pub(crate) unsafe fn release_writer_holder(this: *mut NetworkSink) {
        // SAFETY: fn contract.
        unsafe {
            let holders = (*this).writer_holders.get();
            if holders == 0 {
                return;
            }
            (*this).writer_holders.set(holders - 1);
            if holders == 1 {
                drop(bun_core::heap::take(this));
            }
        }
    }

    fn detach_writable(&mut self) {
        self.task = None;
    }

    /// The S3 upload drained: settle the flush/write promises (terminal, like
    /// `flush_promise`) and wake the source.
    pub(crate) fn on_writable(
        task: &bun_s3::MultiPartUpload,
        this: *mut NetworkSink,
        flushed: u64,
    ) {
        bun_core::scoped_log!(
            NetworkSinkLog,
            "onWritable flushed: {} state: {}",
            flushed,
            task.state.get() as u8
        );
        let _ = task;
        // SAFETY: `this` is the live sink; each access is scoped and ends
        // before the re-entrant wake below.
        let mut source = unsafe {
            if (*this).flush_promise.has_value() {
                let global = (*this)
                    .global_this
                    .expect("global_this set at construction");
                let flushed = (*this)
                    .flush_promise
                    .resolve(&global, JSValue::js_number(flushed as f64));
                crate::dispatch::fold(flushed);
            }
            (*this).pending.run();
            (*this).source
        };
        // Wake the upstream source (JS controller onPull or native ByteStream
        // resume). No-op when `source` is `None` (the `writer()` path).
        source.ready(None, None);
    }

    pub fn flush(&mut self) -> bun_sys::Result<()> {
        bun_sys::Result::Ok(())
    }

    pub(crate) fn flush_from_js(
        &mut self,
        global_this: &JSGlobalObject,
        _wait: bool,
    ) -> bun_sys::Result<JSValue> {
        if self.flush_promise.has_value() {
            return bun_sys::Result::Ok(self.flush_promise.value());
        }
        if self.done {
            return bun_sys::Result::Ok(JSPromise::resolved_promise_value(
                global_this,
                JSValue::js_number(0.0),
            ));
        }
        if self.task_ref().is_some_and(|t| !t.is_queue_empty()) {
            self.flush_promise = JSPromiseStrong::init(global_this);
            return bun_sys::Result::Ok(self.flush_promise.value());
        }
        bun_sys::Result::Ok(JSPromise::resolved_promise_value(
            global_this,
            JSValue::js_number(0.0),
        ))
    }

    pub(crate) fn abort(&mut self) {
        self.ended = true;
        self.done = true;
        self.pending.result = Writable::Done;
        self.pending.run();
        self.source.close(None);
        self.finalize();
    }

    /// The upload queue is full. Native ByteStream/FileReader pumps match on
    /// `Backpressure` directly; a JS controller gets a pending Promise so
    /// `await controller.write()` parks until `on_writable` → `pending.run()`.
    fn backpressure_result(&mut self, len: BlobSizeType) -> Writable {
        if matches!(
            self.source,
            SourceHandle::ByteStream(_) | SourceHandle::FileReader(_)
        ) {
            return Writable::Backpressure(len);
        }
        self.pending.consumed = len;
        self.pending.result = Writable::Owned(len);
        Writable::Pending(core::ptr::from_mut(&mut self.pending))
    }

    pub fn write(&mut self, data: &StreamResult) -> Writable {
        if self.ended {
            return Writable::Owned(0);
        }
        let bytes = data.slice();
        let len = bytes.len() as BlobSizeType;
        // Direct `.writer()` (no source) exposes `write()` as `number`; only
        // the pump paths consume `Backpressure`/`Done`.
        let has_source = !matches!(self.source, SourceHandle::None);

        let result = match self.task_ref() {
            Some(task) => task.write_bytes(bytes, false),
            None => return Writable::Owned(len),
        };
        match result {
            Ok(bun_s3::UploadBackpressure::Backpressure) if has_source => {
                self.backpressure_result(len)
            }
            Ok(bun_s3::UploadBackpressure::Done) if has_source => Writable::Done,
            Ok(_) => Writable::Owned(len),
            Err(_) => Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write)),
        }
    }

    pub(crate) fn write_latin1(&mut self, data: &StreamResult) -> Writable {
        if self.ended {
            return Writable::Owned(0);
        }

        let bytes = data.slice();
        let len = bytes.len() as BlobSizeType;
        let has_source = !matches!(self.source, SourceHandle::None);

        let result = match self.task_ref() {
            Some(task) => task.write_latin1(bytes, false),
            None => return Writable::Owned(len),
        };
        match result {
            Ok(bun_s3::UploadBackpressure::Backpressure) if has_source => {
                self.backpressure_result(len)
            }
            Ok(bun_s3::UploadBackpressure::Done) if has_source => Writable::Done,
            Ok(_) => Writable::Owned(len),
            Err(_) => Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write)),
        }
    }

    pub(crate) fn write_utf16(&mut self, data: &StreamResult) -> Writable {
        if self.ended {
            return Writable::Owned(0);
        }
        let bytes = data.slice();
        let len = bytes.len() as BlobSizeType;
        let has_source = !matches!(self.source, SourceHandle::None);
        // we must always buffer UTF-16
        // we assume the case of all-ascii UTF-16 string is pretty uncommon
        let result = match self.task_ref() {
            Some(task) => task.write_utf16(bytes, false),
            None => return Writable::Owned(len),
        };
        match result {
            Ok(bun_s3::UploadBackpressure::Backpressure) if has_source => {
                self.backpressure_result(len)
            }
            Ok(bun_s3::UploadBackpressure::Done) if has_source => Writable::Done,
            Ok(_) => Writable::Owned(len),
            Err(_) => Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write)),
        }
    }

    pub(crate) fn end(&mut self, err: Option<SysError>) -> bun_sys::Result<()> {
        if self.ended {
            return bun_sys::Result::Ok(());
        }

        // send EOF
        self.ended = true;
        self.pending.result = Writable::Done;
        self.pending.run();
        // flush everything and send EOF
        if let Some(task) = self.task_ref() {
            let _ = task.write_bytes(b"", true);
            // bun.handleOom → Rust aborts on OOM
        }

        self.source.close(err);
        bun_sys::Result::Ok(())
    }

    /// JS-pump terminator for a source that failed. Unlike `end()`, the upload
    /// is aborted, not committed; the stashed reason becomes the caller's
    /// rejection. The pump's reject reaction still releases the pump ref, so
    /// no wrapper deref here.
    ///
    /// Raw `*mut Self`: `task.fail()` synchronously fires
    /// `S3UploadStreamWrapper::resolve`, which re-borrows this sink.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn fail_from_js_pump(this: *mut Self, global: &JSGlobalObject, reason: JSValue) {
        // SAFETY: `this` is the live Box<NetworkSink> the wrapper owns; the
        // borrow ends before `fail` re-enters.
        let task_ref = unsafe {
            if (*this).ended {
                return;
            }
            (*this).ended = true;
            (*this).done = true;
            (*this).pending.result = Writable::Done;
            (*this).pending.run();
            if !reason.is_empty_or_undefined_or_null() {
                (*this).upstream_error.set(global, reason);
            }
            // Our own ref: `fail` re-enters and may clear `(*this).task`.
            (*this).task.clone()
        };
        let Some(task) = task_ref else {
            return;
        };
        let _ = task.fail(bun_s3_signing::error::S3Error {
            code: b"UnknownError",
            message: b"ReadableStream ended with an error",
        });
    }

    /// Native-path terminator called from `SinkHandle::end`. Unlike `end()`
    /// (clean EOF / commit), an upstream error on the ByteStream fast-path must
    /// abort the upload and surface the original JS error to the caller.
    ///
    /// Raw `*mut Self` because `task.fail()`/`write_bytes(EOF)` synchronously
    /// fire `S3UploadStreamWrapper::resolve`, which re-borrows this sink, and
    /// the terminal `deref_` may drop rc→0 and free `*this` via `detach_sink`.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn end_from_stream(this: *mut Self, err: Option<StreamError>) {
        // SAFETY: `this` is the live Box<NetworkSink> the wrapper owns; short
        // reborrows below do not span the re-entrant `fail`/`write_bytes` calls.
        let (ended, is_bytestream) = unsafe {
            (
                (*this).ended,
                matches!((*this).source, SourceHandle::ByteStream(_)),
            )
        };
        if ended {
            return;
        }
        if !is_bytestream {
            let sys_err = match err {
                Some(StreamError::Error(e)) => Some(e),
                _ => None,
            };
            // SAFETY: `end()` does not free `*this` or re-enter the sink;
            // exclusive borrow scoped to the call.
            let _ = unsafe { (*this).end(sys_err) };
            return;
        }
        // SAFETY: scoped accesses for field writes; no re-entry in this block.
        let (task, wrapper) = unsafe {
            (*this).ended = true;
            (*this).source.clear();
            // Our own ref: `fail`/`write_bytes` re-enter and may clear `(*this).task`.
            let Some(task) = (*this).task.clone() else {
                return;
            };
            let wrapper = task
                .callback_context
                .get()
                .cast::<crate::webcore::s3::client::S3UploadStreamWrapper>();
            if let Some(err) = &err {
                (*this).done = true;
                let global = (*this)
                    .global_this
                    .expect("NetworkSink.global_this set at construction");
                let js_err = err.to_js(&global);
                if !js_err.is_empty_or_undefined_or_null() {
                    (*this).upstream_error.set(&global, js_err);
                }
            }
            (task, wrapper)
        };
        if err.is_some() {
            let _ = task.fail(bun_s3_signing::error::S3Error {
                code: b"UnknownError",
                message: b"ReadableStream ended with an error",
            });
        } else {
            let _ = task.write_bytes(b"", true);
        }
        // SAFETY: `wrapper` live with rc ≥ 1; this may free `*this`.
        unsafe { crate::webcore::s3::client::S3UploadStreamWrapper::deref(wrapper) };
    }

    pub(crate) fn end_from_js(
        &mut self,
        _global_this: &JSGlobalObject,
    ) -> bun_sys::Result<JSValue> {
        let _ = self.end(None);
        if self.end_promise.has_value() {
            // we are already waiting for the end
            return bun_sys::Result::Ok(self.end_promise.value());
        }
        if self.task.is_some() && !self.done {
            // we need to wait for the task to end
            self.end_promise = JSPromiseStrong::init(self.global_this());
            return bun_sys::Result::Ok(self.end_promise.value());
        }
        // task already detached
        bun_sys::Result::Ok(JSValue::js_number(0.0))
    }

    pub fn to_js(&mut self, global_this: &JSGlobalObject) -> JSValue {
        NetworkSinkJSSink::create_object(global_this, self, 0)
    }

    pub(crate) fn memory_cost(&self) -> usize {
        // Since this is a JSSink, the NewJSSink function does @sizeOf(JSSink) which includes @sizeOf(ArrayBufferSink).
        if let Some(task) = self.task_ref() {
            //TODO: we could do better here
            return task.buffered.get().memory_cost();
        }
        0
    }

    pub(crate) const NAME: &'static str = "NetworkSink";
}

crate::impl_js_sink_abi!(NetworkSink, "NetworkSink");

impl crate::webcore::sink::JsSinkType for NetworkSink {
    const NAME: &'static str = Self::NAME;
    const HAS_FLUSH_FROM_JS: bool = true;
    const START_TAG: Option<StartTag> = Some(StartTag::NetworkSink);

    crate::impl_js_sink_forwarders!();

    unsafe fn finalize(this: *mut Self) {
        // SAFETY: trait contract — `this` is live and not used after this call.
        unsafe {
            (*this).finalize();
            Self::release_writer_holder(this);
        }
    }
    unsafe fn close_with_error(
        this: *mut Self,
        global: &JSGlobalObject,
        reason: JSValue,
    ) -> bun_sys::Result<()> {
        Self::fail_from_js_pump(this, global, reason);
        bun_sys::Result::Ok(())
    }
    fn end_from_js(&mut self, global: &JSGlobalObject) -> bun_sys::Result<JSValue> {
        Self::end_from_js(self, global)
    }
    fn source(&mut self) -> Option<&mut SourceHandle> {
        Some(&mut self.source)
    }
}

pub(crate) type NetworkSinkJSSink = crate::webcore::sink::JSSink<NetworkSink>;

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
    pub(crate) fn new(tag: BufferActionTag, global: &JSGlobalObject) -> Self {
        Self {
            tag,
            promise: JSPromiseStrong::init(global),
        }
    }

    pub(crate) const fn tag(&self) -> BufferActionTag {
        self.tag
    }

    /// Settle the buffered `text()`/`json()`/`bytes()`/`blob()` promise.
    /// Terminal like the other settle primitives (`Pending::run`).
    pub(crate) fn fulfill(&mut self, global: &JSGlobalObject, blob: &mut AnyBlob) {
        let settled = blob.wrap(jsc::AnyPromise::Normal(self.swap()), global, self.tag());
        crate::dispatch::fold(settled);
    }

    /// Terminal like [`fulfill`](Self::fulfill).
    pub(crate) fn reject(&mut self, global: &JSGlobalObject, err: &StreamError) {
        // S008: `JSPromise` is an `opaque_ffi!` ZST — safe `*mut → &mut` deref.
        let settled = JSPromise::opaque_mut(self.swap()).reject(global, Ok(err.to_js(global)));
        crate::dispatch::fold(settled);
    }

    pub fn value(&self) -> JSValue {
        self.promise.value()
    }

    pub(crate) fn swap(&mut self) -> *mut JSPromise {
        std::ptr::from_mut(self.promise.swap())
    }
}

// JSPromiseStrong implements Drop, so the struct drops it automatically — no explicit
// `impl Drop for BufferAction` needed.

// ──────────────────────────────────────────────────────────────────────────
// ReadResult
// ──────────────────────────────────────────────────────────────────────────
