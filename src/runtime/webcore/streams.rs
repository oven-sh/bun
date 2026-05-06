use core::ffi::c_void;
use core::mem::ManuallyDrop;
use core::ptr::NonNull;

use bun_collections::BabyList;
use crate::webcore::jsc::{
    self as jsc, ArrayBuffer, CommonAbortReason, JSGlobalObject, JSPromise, JSPromiseStrong,
    JSType, JSValue, JsError, JsResult, SysErrorJsc, VirtualMachine,
};
use bun_sys::{self as sys, Error as SysError, Fd};
use bun_uws as uws;
use bun_core::{strings, FeatureFlags};

use crate::webcore::blob::{Any as AnyBlob, Blob};
use crate::webcore::sink::{Sink, SinkHandler};
use crate::webcore::{AutoFlusher, ByteListPool};

// PORT NOTE: scope statics renamed with `Log` suffix so they don't collide with
// the `HTTPServerWritable<SSL,H3>` / `NetworkSink` *types* defined below
// (RequestContext was blocked on this name clash).
bun_core::declare_scope!(HTTPServerWritableLog, visible);
bun_core::declare_scope!(NetworkSinkLog, visible);

/// `bun.ObjectPool(bun.ByteList, ...)::Node` — pooled buffer node type used by
/// `HTTPServerWritable.pooled_buffer`.
pub type ByteListPoolNode = bun_collections::pool::Node<bun_collections::ByteList>;

// NetworkSink stores a borrowed `*MultiPartUpload`. Now that `webcore::s3` is
// wired, alias the module to the real type so `bun_s3::MultiPartUpload` resolves
// for callers that still spell it that way.
pub mod bun_s3 {
    pub use crate::webcore::s3::MultiPartUpload;
}

/// `Blob.SizeType` is `u52` in Zig; the Rust port uses `u64` (see `webcore::blob::SizeType`).
type BlobSizeType = u64;
type ByteList = BabyList<u8>;

// Compat: `webcore::Pipe` and Body refer to `streams::Result` / `streams::result::StreamError`.
pub use StreamResult as Result;
pub mod result {
    pub use super::{StreamError, StreamResult, Writable};
}

// ──────────────────────────────────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────────────────────────────────

/// Options payload for the `Start::FileSink` variant. Mirrors
/// `jsc.WebCore.FileSink.Options` (path-or-fd + chunk size).
// TODO(port): once `crate::webcore::file_sink::Options` is exported, alias to it.
pub struct FileSinkOptions {
    pub chunk_size: BlobSizeType,
    pub input_path: crate::webcore::PathOrFileDescriptor,
}

impl Default for FileSinkOptions {
    fn default() -> Self {
        Self {
            chunk_size: 0,
            input_path: crate::webcore::PathOrFileDescriptor::Fd(Fd::INVALID),
        }
    }
}

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
    OwnedAndDone(ByteList),
    Done(ByteList),
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
            Start::ChunkSize(chunk) => Ok(JSValue::js_number(chunk as f64)),
            Start::Err(err) => Err(err.throw(global_this)),
            Start::OwnedAndDone(mut list) => {
                // PORT NOTE: Zig captures `|list|` by bitwise copy with no destructor and
                // hands the allocation to JSC (no-copy + MarkedArrayBuffer_deallocator). In
                // Rust `list` is an owned BabyList whose Drop would free the same buffer →
                // double-free. Build the ArrayBuffer, then forget `list` so JSC is sole owner.
                let ab = ArrayBuffer::from_bytes(list.slice_mut(), JSType::Uint8Array);
                core::mem::forget(list);
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
                // Zig: `@as(Blob.SizeType, @intCast(@truncate(@as(i52, chunkSize.toInt64()))))`
                // — `@truncate` to i52 then `@intCast` to u32. Low-32-bit wrap matches that
                // for the in-range values JS can produce; revisit if exact i52 sign-extension
                // semantics matter.
                return Ok(Start::ChunkSize(chunk_size.to_int64() as BlobSizeType));
            }
        }

        Ok(Start::Empty)
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

                // TODO(port): Zig used `getOwn`; `bun_jsc::JSValue::get_own` not yet
                // exported — `get` walks the prototype chain. Swap once available.
                if let Some(val) = value.get(global_this, b"asUint8Array")? {
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
                        // Zig: `@intCast(@max(0, @as(i51, @truncate(toInt64()))))`
                        chunk_size = 0i64.max(chunk_size_val.to_int64()) as BlobSizeType;
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
                        // Zig: `@intCast(@max(0, @as(i51, @truncate(toInt64()))))`
                        chunk_size = 0i64.max(chunk_size_val.to_int64()) as BlobSizeType;
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
                            // Zig `path.toSlice(globalThis, allocator)` — allocator param
                            // folded into the owning `ZigStringSlice`.
                            path.to_slice(global_this)?,
                        ),
                    }));
                } else if let Some(fd_value) = value.get_truthy(global_this, b"fd")? {
                    if !fd_value.is_any_int() {
                        return Ok(Start::Err(SysError {
                            errno: sys::SystemErrno::EBADF as _,
                            syscall: sys::Tag::write,
                            ..Default::default()
                        }));
                    }

                    // `bun.FD.fromJS` — `bun_sys_jsc::FdJsc` isn't a dep of this crate yet,
                    // so inline the body (int → range-check → `Fd::from_uv`).
                    let fd = {
                        let fd64 = fd_value.to_int64();
                        if fd64 < 0 || fd64 > i64::from(i32::MAX) {
                            None
                        } else {
                            Some(Fd::from_uv(fd64 as i32))
                        }
                    };
                    if let Some(fd) = fd {
                        return Ok(Start::FileSink(FileSinkOptions {
                            chunk_size,
                            input_path: crate::webcore::PathOrFileDescriptor::Fd(fd),
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
                        // Zig: `@intCast(@max(256, @as(i51, @truncate(toInt64()))))`
                        chunk_size = 256i64.max(chunk_size_val.to_int64()) as BlobSizeType;
                    }
                }

                if !empty {
                    return Ok(Start::ChunkSize(chunk_size));
                }
            }
            _ => {
                // Zig: `@compileError("Unsupported tag " ++ @tagName(tag))` — const-generic
                // monomorphization makes this dead for valid TAG; runtime unreachable
                // until `generic_const_exprs` lets us hoist to a compile error.
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
    // TODO(port): BORROW_PARAM `&'a mut Pending` — self-referential via Pending.result; using raw ptr
    Pending(*mut Pending),
    Err(StreamError),
    Done,
    Owned(ByteList),
    OwnedAndDone(ByteList),
    // PORT NOTE: `temporary*` payloads are borrowed slices wrapped via
    // `ByteList::from_borrowed_slice_dangerous` (`ManuallyDrop<ByteList>` so the
    // borrowed allocation is never freed by `Drop`).
    TemporaryAndDone(ManuallyDrop<ByteList>),
    Temporary(ManuallyDrop<ByteList>),
    IntoArray(IntoArray),
    IntoArrayAndDone(IntoArray),
}

impl StreamResult {
    // TODO(port): not Drop — Result is bitwise-copied in to_js() shutdown path; ownership is contextual.
    // Named `release` (not `deinit`) per PORTING.md — `pub fn deinit` is forbidden as a public API.
    pub fn release(&mut self) {
        match self {
            StreamResult::Owned(owned) => owned.clear_and_free(),
            StreamResult::OwnedAndDone(owned_and_done) => owned_and_done.clear_and_free(),
            StreamResult::Err(err) => {
                if let StreamError::JSValue(v) = err {
                    v.unprotect();
                }
            }
            _ => {}
        }
    }
}

#[derive(Clone)]
pub enum StreamError {
    Error(SysError),
    AbortReason(CommonAbortReason),
    // TODO: use an explicit jsc.Strong.Optional here.
    JSValue(JSValue),
    WeakJSValue(JSValue),
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum WasStrong {
    Strong,
    Weak,
}

impl StreamError {
    pub fn to_js_weak(&self, global_object: &JSGlobalObject) -> (JSValue, WasStrong) {
        match self {
            StreamError::Error(err) => (err.to_js(global_object), WasStrong::Weak),
            StreamError::JSValue(v) => (*v, WasStrong::Strong),
            StreamError::WeakJSValue(v) => (*v, WasStrong::Weak),
            StreamError::AbortReason(reason) => {
                let value = reason.to_js(global_object);
                (value, WasStrong::Weak)
            }
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
        let bytes = self.slice();
        // SAFETY: caller guarantees bytes are u16-aligned and even length (mirrors Zig @ptrCast/@alignCast)
        unsafe {
            core::slice::from_raw_parts(bytes.as_ptr() as *const u16, bytes.len() / 2)
        }
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
    // TODO(port): BORROW_PARAM `&'a mut WritablePending` — self-referential via WritablePending.result; using raw ptr
    Pending(*mut WritablePending),
    Err(SysError),
    Done,
    Owned(BlobSizeType),
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

// PORT NOTE: Zig `WritablePending.deinit` / `WritableFuture.deinit` only deinit the owned
// JSPromiseStrong field — JSPromiseStrong implements Drop, so no explicit Drop impl is needed here.

pub enum WritableFuture {
    None,
    Promise {
        strong: JSPromiseStrong,
        // TODO(port): JSC_BORROW &JSGlobalObject — stored on heap struct; using raw ptr
        global: *const JSGlobalObject,
    },
    Handler(WritableHandler),
}

impl WritablePending {
    pub fn promise(&mut self, global_this: &JSGlobalObject) -> *mut JSPromise {
        self.state = PendingState::Pending;

        match &self.future {
            WritableFuture::Promise { strong, .. } => (unsafe { strong.get() }) as *mut JSPromise,
            _ => {
                self.future = WritableFuture::Promise {
                    strong: JSPromiseStrong::init(global_this),
                    global: global_this as *const _,
                };
                match &self.future {
                    WritableFuture::Promise { strong, .. } => (unsafe { strong.get() }) as *mut JSPromise,
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

/// Trait replacing Zig's `comptime handler_fn` — implementors provide the callback.
// TODO(port): Zig used comptime fn param to generate wrapper; trait-based dispatch instead
pub trait WritablePendingCallback {
    fn on_handle(&mut self, result: Writable);
}

impl WritableHandler {
    pub fn init<C: WritablePendingCallback>(&mut self, ctx: &mut C) {
        self.ctx = ctx as *mut C as *mut c_void;
        self.handler = {
            fn on_handle<C: WritablePendingCallback>(ctx_: *mut c_void, result: Writable) {
                // SAFETY: ctx was stored from &mut C in init()
                let ctx = unsafe { &mut *(ctx_ as *mut C) };
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
    /// PORT NOTE: Zig html_rewriter calls `pending.applyBackpressure(allocator,
    /// &this.output, pending, bytes)` — that decl never existed in Zig (the
    /// caller is dead code there). This is the minimal real implementation
    /// matching that call shape.
    pub fn apply_backpressure(&mut self, _output: &mut Sink<'_>, bytes: &[u8]) {
        self.consumed = self.consumed.saturating_add(bytes.len() as BlobSizeType);
        self.state = PendingState::Pending;
    }

    pub fn run(&mut self) {
        if self.state != PendingState::Pending {
            return;
        }
        self.state = PendingState::Used;

        match core::mem::replace(&mut self.future, WritableFuture::None) {
            WritableFuture::Promise { mut strong, global } => {
                // SAFETY: global stored from &JSGlobalObject param; outlives this call
                let global = unsafe { &*global };
                Writable::fulfill_promise(
                    core::mem::replace(&mut self.result, Writable::Done),
                    strong.swap() as *mut JSPromise,
                    global,
                );
                // TODO(port): Zig moved p out then reassigned future = .none; mem::replace mirrors this
            }
            WritableFuture::Handler(h) => {
                self.future = WritableFuture::Handler(WritableHandler {
                    ctx: h.ctx,
                    handler: h.handler,
                });
                // PORT NOTE: Zig left self.result intact (bitwise copy); reset to Done here —
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

    pub fn fulfill_promise(result: Writable, promise: *mut JSPromise, global_this: &JSGlobalObject) {
        // SAFETY: promise is a valid GC-rooted JSPromise (protected by caller)
        let promise = unsafe { &mut *promise };
        let promise_value = promise.to_js();
        let _guard = scopeguard::guard((), |_| promise_value.unprotect());
        // PORT NOTE: defer promise.toJS().unprotect() — runs on all paths
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
            Writable::Owned(len) => JSValue::js_number(len as f64),
            Writable::OwnedAndDone(len) => JSValue::js_number(len as f64),
            Writable::TemporaryAndDone(len) => JSValue::js_number(len as f64),
            Writable::Temporary(len) => JSValue::js_number(len as f64),
            Writable::IntoArray(len) => JSValue::js_number(len as f64),
            Writable::IntoArrayAndDone(len) => JSValue::js_number(len as f64),
            // false == controller.close()
            // undefined == noop, but we probably won't send it
            Writable::Done => JSValue::TRUE,
            Writable::Pending(pending) => {
                // SAFETY: pending is a valid borrowed pointer per BORROW_PARAM classification
                let prom = unsafe { &mut *pending }.promise(global_this);
                // SAFETY: prom is a live GC-rooted JSPromise
                unsafe { &*prom }.to_js()
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
            // TODO(port): Zig `future: Future = undefined` — using Handler with null ctx as placeholder
            future: PendingFuture::Handler(PendingHandler {
                ctx: core::ptr::null_mut(),
                handler: |_, _| {},
            }),
            result: StreamResult::Done,
            state: PendingState::None,
        }
    }
}

/// Trait replacing Zig's `comptime handler_fn` for Result.Pending.
// TODO(port): Zig used comptime fn param to generate wrapper; trait-based dispatch instead
pub trait PendingCallback {
    fn on_handle(&mut self, result: StreamResult);
}

impl Pending {
    pub fn set<C: PendingCallback>(&mut self, ctx: &mut C) {
        self.future.init::<C>(ctx);
        self.state = PendingState::Pending;
    }

    pub fn promise(&mut self, global_object: &JSGlobalObject) -> *mut JSPromise {
        let prom = JSPromise::create(global_object) as *mut JSPromise;
        self.future = PendingFuture::Promise {
            promise: prom,
            global_this: global_object as *const _,
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
        let vm = unsafe { &*VirtualMachine::get() };
        if vm.is_shutting_down() {
            return;
        }

        let clone = Box::new(core::mem::take(self));
        // PORT NOTE: Zig copied *self then reset only state+result (zig:451-452);
        // `mem::take` already resets `state`/`result`/`future` via `Default`, so the
        // explicit re-assignments are unnecessary here. Zig left `future` untouched —
        // no reader observes it after this.
        // SAFETY: VM event loop is a singleton; temporary `&mut` is the sole
        // borrow for the duration of `enqueue_task` (no re-entry into Rust).
        unsafe { &mut *vm.event_loop() }
            .enqueue_task(bun_event_loop::Task::init(Box::into_raw(clone)));
    }

    pub fn run_from_js_thread(this: *mut Pending) {
        // SAFETY: this was Box::into_raw'd in run_on_next_tick
        let mut boxed = unsafe { Box::from_raw(this) };
        boxed.run();
        drop(boxed);
    }
}

impl bun_event_loop::Taskable for Pending {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::StreamPending;
}

pub enum PendingFuture {
    Promise {
        // TODO(port): JSC_BORROW *mut JSPromise — GC-rooted via protect/unprotect
        promise: *mut JSPromise,
        // TODO(port): JSC_BORROW &JSGlobalObject — stored on heap; using raw ptr
        global_this: *const JSGlobalObject,
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
        self.ctx = ctx as *mut C as *mut c_void;
        self.handler = {
            fn on_handle<C: PendingCallback>(ctx_: *mut c_void, result: StreamResult) {
                // SAFETY: ctx was stored from &mut C in init()
                let ctx = unsafe { &mut *(ctx_ as *mut C) };
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
            PendingFuture::Promise { promise, global_this } => {
                // SAFETY: global_this stored from &JSGlobalObject; promise is GC-rooted
                let global = unsafe { &**global_this };
                StreamResult::fulfill_promise(&mut self.result, *promise, global);
            }
            PendingFuture::Handler(h) => {
                // PORT NOTE: Zig left self.result intact (bitwise copy); reset to Done here —
                // verify no caller reads it after run().
                (h.handler)(h.ctx, core::mem::replace(&mut self.result, StreamResult::Done));
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
        // SAFETY: bun_vm() returns the per-global VM singleton; `&`-borrow is
        // dropped (only used for read-only `event_loop()`) before any re-entrant call.
        let vm = unsafe { &*global_this.bun_vm() };
        // PORT NOTE: Zig holds `loop` and `promise` across re-entrant resolve/reject.
        // In Rust a long-lived `&mut EventLoop` / `&mut JSPromise` would alias any
        // `&mut` the re-entered JS path materializes through `vm.event_loop()` or the
        // same promise. Keep the raw pointers and form a fresh temporary `&mut` per
        // call so no two `&mut` are live at once.
        let event_loop = vm.event_loop();
        // SAFETY: promise is GC-rooted via protect(); sole `&` for this read-only call.
        let promise_value = unsafe { &*promise }.to_js();
        let _unprotect = scopeguard::guard((), |_| promise_value.unprotect());

        // SAFETY: event_loop is the VM's singleton loop; sole `&mut` for this call.
        unsafe { &mut *event_loop }.enter();
        // PORT NOTE: cannot capture &mut event_loop in scopeguard while also using
        // `promise` (borrowck); call exit() explicitly on each path instead.

        match result {
            StreamResult::Err(err) => {
                let value = 'brk: {
                    let (js_err, was_strong) = err.to_js_weak(global_this);
                    js_err.ensure_still_alive();
                    if was_strong == WasStrong::Strong {
                        js_err.unprotect();
                    }
                    break 'brk js_err;
                };
                *result = StreamResult::Temporary(ManuallyDrop::new(ByteList::default()));
                // SAFETY: promise GC-rooted; fresh temp `&mut` is sole borrow across
                // this re-entrant call (no long-lived `&mut JSPromise` held).
                let _ = unsafe { &mut *promise }.reject_with_async_stack(global_this, Ok(value));
                // TODO: properly propagate exception upwards
            }
            StreamResult::Done => {
                // SAFETY: see reject_with_async_stack above; fresh temp `&mut`.
                let _ = unsafe { &mut *promise }.resolve(global_this, JSValue::FALSE);
                // TODO: properly propagate exception upwards
            }
            _ => {
                let value = match result.to_js(global_this) {
                    Ok(v) => v,
                    Err(err) => {
                        *result = StreamResult::Temporary(ManuallyDrop::new(ByteList::default()));
                        // SAFETY: see reject_with_async_stack above; fresh temp `&mut`.
                        let _ = unsafe { &mut *promise }.reject(global_this, Err(err));
                        // TODO: properly propagate exception upwards
                        // SAFETY: see enter() above; sole `&mut` for this call.
                        unsafe { &mut *event_loop }.exit();
                        return;
                    }
                };
                value.ensure_still_alive();

                *result = StreamResult::Temporary(ManuallyDrop::new(ByteList::default()));
                // SAFETY: see reject_with_async_stack above; fresh temp `&mut`.
                let _ = unsafe { &mut *promise }.resolve(global_this, value);
                // TODO: properly propagate exception upwards
            }
        }
        // SAFETY: see enter() above; sole `&mut` for this call.
        unsafe { &mut *event_loop }.exit();
    }

    pub fn to_js(&mut self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        if unsafe { &*VirtualMachine::get() }.is_shutting_down() {
            // Zig copies `*this` to `that` and calls `that.deinit()` — a bitwise move of
            // ownership out of `*this` followed by free. `release()` is the port of `deinit`;
            // call it on `self` so `.owned`/`.owned_and_done` ByteLists are freed and
            // `.err.JSValue` is unprotected instead of leaking on the shutdown path.
            self.release();
            return Ok(JSValue::ZERO);
        }

        match self {
            StreamResult::Owned(list) => {
                // PORT NOTE: Zig overwrites `result.* = .{ .temporary = .{} }` with no
                // destructor after handing the buffer to JSC. In Rust the later
                // `*result = Temporary(...)` in fulfill_promise drops the old BabyList,
                // double-freeing the allocation now owned by JSC. Move it out and forget
                // so JSC's MarkedArrayBuffer_deallocator is the sole owner.
                let mut taken = core::mem::take(list);
                let ab = ArrayBuffer::from_bytes(taken.slice_mut(), JSType::Uint8Array);
                core::mem::forget(taken);
                ab.to_js(global_this)
            }
            StreamResult::OwnedAndDone(list) => {
                // PORT NOTE: see Owned arm above — same ownership transfer to JSC.
                let mut taken = core::mem::take(list);
                let ab = ArrayBuffer::from_bytes(taken.slice_mut(), JSType::Uint8Array);
                core::mem::forget(taken);
                ab.to_js(global_this)
            }
            StreamResult::Temporary(temp) | StreamResult::TemporaryAndDone(temp) => {
                // TODO(b2-blocked): JSValue::create_uninitialized_uint8_array — falls
                // back to ArrayBuffer::create (copies) until the no-init path lands.
                ArrayBuffer::create::<{ JSType::Uint8Array }>(global_this, temp.slice())
            }
            StreamResult::IntoArray(array) => Ok(JSValue::js_number_from_uint64(array.len as u64)),
            StreamResult::IntoArrayAndDone(array) => {
                Ok(JSValue::js_number_from_uint64(array.len as u64))
            }
            StreamResult::Pending(pending) => {
                // SAFETY: pending is a valid borrowed pointer per BORROW_PARAM classification
                let promise = unsafe { &mut **pending }.promise(global_this);
                // SAFETY: promise just created
                let promise_js = unsafe { &*promise }.to_js();
                promise_js.protect();
                Ok(promise_js)
            }
            StreamResult::Err(err) => {
                let (js_err, was_strong) = err.to_js_weak(global_this);
                if was_strong == WasStrong::Strong {
                    js_err.unprotect();
                }
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

#[derive(Default)]
pub struct Signal {
    pub ptr: Option<NonNull<c_void>>,
    pub vtable: SignalVTable,
}

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
            ptr: NonNull::new(handler as *mut c_void),
            vtable: SignalVTable::wrap::<T>(),
        }
    }

    pub fn init<T: SignalHandler>(handler: &mut T) -> Signal {
        // SAFETY: &mut T is a valid non-null pointer
        unsafe { Self::init_with_type(handler as *mut T) }
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
        SignalVTable { close: dead_close, ready: dead_ready, start: dead_start }
    }
}

/// Trait replacing Zig's `@hasDecl(Wrapped, "onClose")` duck-typing.
/// Default methods named `on_*` mirror the Zig fallback to `close`/`ready`/`start`.
pub trait SignalHandler {
    fn on_close(&mut self, err: Option<SysError>);
    fn on_ready(&mut self, amount: Option<BlobSizeType>, offset: Option<BlobSizeType>);
    fn on_start(&mut self);
}

impl SignalVTable {
    pub fn wrap<W: SignalHandler>() -> SignalVTable {
        fn on_close<W: SignalHandler>(this: *mut c_void, err: Option<SysError>) {
            // SAFETY: this was stored from &mut W in Signal::init_with_type
            unsafe { &mut *(this as *mut W) }.on_close(err);
        }
        fn on_ready<W: SignalHandler>(
            this: *mut c_void,
            amount: Option<BlobSizeType>,
            offset: Option<BlobSizeType>,
        ) {
            // SAFETY: this was stored from &mut W in Signal::init_with_type
            unsafe { &mut *(this as *mut W) }.on_ready(amount, offset);
        }
        fn on_start<W: SignalHandler>(this: *mut c_void) {
            // SAFETY: this was stored from &mut W in Signal::init_with_type
            unsafe { &mut *(this as *mut W) }.on_start();
        }

        // PORT NOTE: Zig used `comptime &VTable.wrap(Type)` for a static address.
        // Rust cannot const-promote a generic-dependent struct literal to
        // `&'static`, so the vtable is stored by-value in `Signal` instead
        // (three fn pointers — same size as the Zig `*const VTable` payload
        // would dereference to anyway).
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

// TODO(port): type-level branch `if (http3) uws.H3.Response else uws.NewApp(ssl).Response`
// requires associated-type trait keyed on const generics. Using opaque c_void for now.
pub type UwsResponse<const SSL: bool, const HTTP3: bool> = c_void;

pub struct HTTPServerWritable<const SSL: bool, const HTTP3: bool> {
    pub res: Option<*mut UwsResponse<SSL, HTTP3>>,
    pub buffer: ByteList,
    pub pooled_buffer: Option<NonNull<ByteListPoolNode>>,
    pub offset: BlobSizeType,

    pub is_listening_for_abort: bool,
    pub wrote: BlobSizeType,

    // PORT NOTE: allocator field dropped — global mimalloc per §Allocators
    pub done: bool,
    pub signal: Signal,
    pub pending_flush: Option<*mut JSPromise>,
    pub wrote_at_start_of_flush: BlobSizeType,
    // TODO(port): JSC_BORROW &JSGlobalObject — heap struct with `= undefined` default; using raw ptr
    pub global_this: *const JSGlobalObject,
    pub high_water_mark: BlobSizeType,

    pub requested_end: bool,

    pub has_backpressure: bool,
    pub end_len: usize,
    pub aborted: bool,

    pub on_first_write: Option<fn(Option<*mut c_void>)>,
    pub ctx: Option<*mut c_void>,

    pub auto_flusher: AutoFlusher,
}

impl<const SSL: bool, const HTTP3: bool> Default for HTTPServerWritable<SSL, HTTP3> {
    fn default() -> Self {
        Self {
            res: None,
            buffer: ByteList::default(),
            pooled_buffer: None,
            offset: 0,
            is_listening_for_abort: false,
            wrote: 0,
            done: false,
            signal: Signal::default(),
            pending_flush: None,
            wrote_at_start_of_flush: 0,
            global_this: core::ptr::null(),
            high_water_mark: 2048,
            requested_end: false,
            has_backpressure: false,
            end_len: 0,
            aborted: false,
            on_first_write: None,
            ctx: None,
            auto_flusher: AutoFlusher::default(),
        }
    }
}

impl<const SSL: bool, const HTTP3: bool> HTTPServerWritable<SSL, HTTP3> {
    pub fn connect(&mut self, signal: Signal) {
        self.signal = signal;
    }

    /// Don't include @sizeOf(This) because it's already included in the memoryCost of the sink
    pub fn memory_cost(&self) -> usize {
        // TODO: include Socket send buffer size. We can't here because we
        // don't track if it's still accessible.
        // Since this is a JSSink, the NewJSSink function does @sizeOf(JSSink) which includes @sizeOf(ArrayBufferSink).
        self.buffer.cap as usize
    }

    // TODO(port): const-generic string selection — Rust cannot branch on const bool to produce &'static str at type level
    pub const NAME: &'static str = if HTTP3 {
        "H3ResponseSink"
    } else if SSL {
        "HTTPSResponseSink"
    } else {
        "HTTPResponseSink"
    };
    // PORT NOTE: associated const with const-generic if — requires `#![feature(generic_const_exprs)]` or Phase B trait

    // TODO(port): `pub const JSSink = Sink.JSSink(@This(), name)` — type generator; needs macro/codegen
}

/// Per-monomorphization JSSink wrapper alias. Mirrors
/// `pub const JSSink = Sink.JSSink(@This(), name)`.
pub type HTTPServerWritableJSSink<const SSL: bool, const HTTP3: bool> =
    crate::webcore::sink::JSSink<HTTPServerWritable<SSL, HTTP3>>;

// TODO(b2-blocked): full impl depends on `bun_uws::Response<SSL>`
// const-generic dispatch (the body casts `res` to `*mut uws::Response` without
// the SSL/H3 parameter), `bun_event_loop::AutoFlusher` free-fns (the local
// `crate::webcore::AutoFlusher` is a fieldless stub), and `ByteListPool::Node`
// data access. Un-gate once the UwsResponse type-dispatch trait lands.

impl<const SSL: bool, const HTTP3: bool> HTTPServerWritable<SSL, HTTP3> {
    /// Const-generic → runtime dispatch for the type-erased `res` field.
    /// Mirrors Zig's `const UWSResponse = if (http3) uws.H3.Response else uws.NewApp(ssl).Response`.
    #[inline]
    fn any_res(&self) -> Option<uws::AnyResponse> {
        let res = self.res?;
        Some(if HTTP3 {
            uws::AnyResponse::H3(res as *mut uws::H3::Response)
        } else if SSL {
            uws::AnyResponse::SSL(res as *mut uws::Response<true>)
        } else {
            uws::AnyResponse::TCP(res as *mut uws::Response<false>)
        })
    }

    fn handle_wrote(&mut self, amount1: usize) {
        let amount = amount1 as BlobSizeType;
        self.offset += amount;
        self.wrote += amount;

        if self.offset >= self.buffer.len {
            self.offset = 0;
            self.buffer.len = 0;
        }
        bun_core::scoped_log!(
            HTTPServerWritableLog,
            "handleWrote: {} offset: {}, {}",
            amount1,
            self.offset,
            self.buffer.len
        );
    }

    fn handle_first_write_if_necessary(&mut self) {
        if let Some(on_first_write) = self.on_first_write.take() {
            let ctx = self.ctx.take();
            on_first_write(ctx);
        }
    }

    fn has_backpressure(&self) -> bool {
        self.has_backpressure
    }

    fn has_backpressure_and_is_try_end(&self) -> bool {
        self.has_backpressure && self.end_len > 0
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
        // PORT NOTE: Zig holds `res` across `handleFirstWriteIfNecessary`, whose
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
                res.on_writable::<Self, _>(
                    |this: *mut Self, off, _r| {
                        // SAFETY: `this` was registered as live `*mut Self` and uWS invokes
                        // the callback while the sink is still alive.
                        unsafe { (*this).on_writable(off, core::ptr::null_mut()) }
                    },
                    self as *mut Self,
                );
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
        // we clear the onWritable handler so uWS can handle the backpressure for us
        res.clear_on_writable();
        self.handle_first_write_if_necessary();
        // uWebSockets lacks a tryWrite() function
        // This means that backpressure will be handled by appending to an "infinite" memory buffer
        // It will do the backpressure handling for us
        // so in this scenario, we just append to the buffer
        // and report success
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

    fn readable_slice(&self) -> &[u8] {
        // SAFETY: offset <= len <= cap; ptr is valid for cap bytes
        unsafe {
            core::slice::from_raw_parts(
                self.buffer.ptr.as_ptr().add(self.offset as usize),
                (self.buffer.len as u64 - self.offset) as usize,
            )
        }
        // TODO(port): Zig `this.buffer.ptr[this.offset..this.buffer.len]` — verify ByteList field access
    }

    pub fn on_writable(&mut self, write_offset: u64, _res: *mut UwsResponse<SSL, HTTP3>) -> bool {
        // write_offset is the amount of data that was written not how much we need to write
        bun_core::scoped_log!(HTTPServerWritableLog, "onWritable ({})", write_offset);
        // onWritable reset backpressure state to allow flushing
        self.has_backpressure = false;
        if self.aborted {
            self.signal.close(None);
            let _ = self.flush_promise(); // TODO: properly propagate exception upwards
            self.finalize();
            return false;
        }
        let mut total_written: u64 = 0;

        // do not write more than available
        // if we do, it will cause this to be delayed until the next call, each time
        // TODO: should we break it in smaller chunks?
        let to_write = (write_offset as BlobSizeType).min(self.buffer.len - 1);
        // PORT NOTE: reshaped for borrowck — capture chunk len before send()
        let chunk_start = to_write as usize;
        let chunk_len = self.readable_slice().len().saturating_sub(chunk_start);
        // TODO(port): Zig slices readableSlice()[to_write..]; recompute after potential mutation in send
        // if we have nothing to write, we are done
        if chunk_len == 0 {
            if self.done {
                self.signal.close(None);
                let _ = self.flush_promise(); // TODO: properly propagate exception upwards
                self.finalize();
                return true;
            }
        } else {
            // SAFETY: chunk slice is valid until send() mutates buffer; copy ptr/len for FFI call
            let chunk_ptr = unsafe { self.readable_slice().as_ptr().add(chunk_start) };
            let chunk = unsafe { core::slice::from_raw_parts(chunk_ptr, chunk_len) };
            if !self.send(chunk) {
                // if we were unable to send it, retry
                return false;
            }
            total_written = chunk_len as u64;

            if self.requested_end {
                if let Some(res) = self.any_res() {
                    res.clear_on_writable();
                }
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
                self.signal
                    .ready(Some(total_written as BlobSizeType), None);
            }
        }

        true
    }

    pub fn start(&mut self, stream_start: Start) -> bun_sys::Result<()> {
        if self.aborted
            || self.res.is_none()
            || self.any_res().unwrap().has_responded()
        {
            self.mark_done();
            self.signal.close(None);
            return bun_sys::Result::Ok(());
        }

        self.wrote = 0;
        self.wrote_at_start_of_flush = 0;
        let _ = self.flush_promise(); // TODO: properly propagate exception upwards

        if self.buffer.cap == 0 {
            debug_assert!(self.pooled_buffer.is_none());
            if FeatureFlags::HTTP_BUFFER_POOLING {
                if let Some(pooled_node) = ByteListPool::get_if_exists() {
                    // SAFETY: `get_if_exists` returns a live heap node when Some.
                    let pooled_node = unsafe { NonNull::new_unchecked(pooled_node) };
                    self.pooled_buffer = Some(pooled_node);
                    // SAFETY: pooled_node is a valid pool checkout; `data` was
                    // written by `ByteListPool::push` (or zero-initialized).
                    // Move the ByteList out by bitwise read and reset the slot.
                    self.buffer = unsafe {
                        core::mem::replace(
                            (*pooled_node.as_ptr()).data.assume_init_mut(),
                            ByteList::default(),
                        )
                    };
                }
            }
        }

        self.buffer.len = 0;

        if let Start::ChunkSize(chunk_size) = stream_start {
            if chunk_size > 0 {
                self.high_water_mark = chunk_size;
            }
        }

        self.buffer.clear_retaining_capacity();
        if self
            .buffer
            .ensure_total_capacity_precise(self.high_water_mark as usize)
            .is_err()
        {
            return bun_sys::Result::Err(SysError::oom());
        }

        self.done = false;
        self.signal.start();
        bun_core::scoped_log!(HTTPServerWritableLog, "start({})", self.high_water_mark);
        bun_sys::Result::Ok(())
    }

    fn flush_from_js_no_wait(&mut self) -> bun_sys::Result<JSValue> {
        bun_core::scoped_log!(HTTPServerWritableLog, "flushFromJSNoWait");
        bun_sys::Result::Ok(JSValue::js_number(self.flush_no_wait() as f64))
    }

    pub fn flush_no_wait(&mut self) -> usize {
        if self.has_backpressure_and_is_try_end() || self.done {
            return 0;
        }

        let slice_len = self.readable_slice().len();
        if slice_len == 0 {
            return 0;
        }

        // PORT NOTE: reshaped for borrowck — capture ptr/len before &mut self.send()
        let slice_ptr = self.readable_slice().as_ptr();
        // SAFETY: slice valid for duration of send (buffer not freed until handle_wrote at most resets len)
        let slice = unsafe { core::slice::from_raw_parts(slice_ptr, slice_len) };
        let success = self.send(slice);
        if success {
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
            // SAFETY: prom is GC-rooted via protect()
            return bun_sys::Result::Ok(unsafe { &*prom }.to_js());
        }

        if self.buffer.len == 0 || self.done {
            return bun_sys::Result::Ok(JSPromise::resolved_promise_value(
                global_this,
                JSValue::js_number_from_int32(0),
            ));
        }

        if !self.has_backpressure_and_is_try_end() {
            let slice_len = self.readable_slice().len();
            debug_assert!(slice_len > 0);
            // PORT NOTE: reshaped for borrowck
            let slice_ptr = self.readable_slice().as_ptr();
            // SAFETY: see flush_no_wait
            let slice = unsafe { core::slice::from_raw_parts(slice_ptr, slice_len) };
            let success = self.send(slice);
            if success {
                return bun_sys::Result::Ok(JSPromise::resolved_promise_value(
                    global_this,
                    JSValue::js_number(slice_len as f64),
                ));
            }
        }
        self.wrote_at_start_of_flush = self.wrote;
        self.pending_flush = Some(JSPromise::create(global_this));
        self.global_this = global_this as *const _;
        // SAFETY: just created
        let promise_value = unsafe { &*self.pending_flush.unwrap() }.to_js();
        promise_value.protect();

        bun_sys::Result::Ok(promise_value)
    }

    pub fn flush(&mut self) -> bun_sys::Result<()> {
        bun_core::scoped_log!(HTTPServerWritableLog, "flush()");
        self.unregister_auto_flusher();

        if !self.has_backpressure() || self.done {
            return bun_sys::Result::Ok(());
        }

        if self.res.is_none()
            || self.any_res().unwrap().has_responded()
        {
            self.mark_done();
            self.signal.close(None);
        }

        bun_sys::Result::Ok(())
    }

    pub fn write(&mut self, data: StreamResult) -> Writable {
        if self.done || self.requested_end {
            return Writable::Owned(0);
        }

        let bytes = data.slice();
        let len = bytes.len() as BlobSizeType;
        bun_core::scoped_log!(HTTPServerWritableLog, "write({})", bytes.len());

        if self.buffer.len == 0 && len >= self.high_water_mark {
            // fast path:
            // - large-ish chunk
            // - no backpressure
            if self.send(bytes) {
                return Writable::Owned(len);
            }

            if self.buffer.write(bytes).is_err() {
                return Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write));
            }
        } else if self.buffer.len + len >= self.high_water_mark {
            // TODO: attempt to write both in a corked buffer?
            if self.buffer.write(bytes).is_err() {
                return Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write));
            }
            // PORT NOTE: reshaped for borrowck
            let slice_ptr = self.readable_slice().as_ptr();
            let slice_len = self.readable_slice().len();
            // SAFETY: see flush_no_wait
            let slice = unsafe { core::slice::from_raw_parts(slice_ptr, slice_len) };
            if self.send(slice) {
                return Writable::Owned(len);
            }
        } else {
            // queue the data wait until highWaterMark is reached or the auto flusher kicks in
            if self.buffer.write(bytes).is_err() {
                return Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write));
            }
        }

        self.register_auto_flusher();

        Writable::Owned(len)
    }

    pub fn write_bytes(&mut self, data: StreamResult) -> Writable {
        self.write(data)
    }

    pub fn write_latin1(&mut self, data: StreamResult) -> Writable {
        if self.done || self.requested_end {
            return Writable::Owned(0);
        }

        if self.res.is_none()
            || self.any_res().unwrap().has_responded()
        {
            self.signal.close(None);
            self.mark_done();
            return Writable::Done;
        }

        let bytes = data.slice();
        let len = bytes.len() as BlobSizeType;
        bun_core::scoped_log!(HTTPServerWritableLog, "writeLatin1({})", bytes.len());

        if self.buffer.len == 0 && len >= self.high_water_mark {
            let mut do_send = true;
            // common case
            if strings::is_all_ascii(bytes) {
                // fast path:
                // - large-ish chunk
                // - no backpressure
                if self.send(bytes) {
                    return Writable::Owned(len);
                }
                do_send = false;
            }

            if self.buffer.write_latin1(bytes).is_err() {
                return Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write));
            }

            if do_send {
                // PORT NOTE: reshaped for borrowck
                let slice_ptr = self.readable_slice().as_ptr();
                let slice_len = self.readable_slice().len();
                // SAFETY: see flush_no_wait
                let slice = unsafe { core::slice::from_raw_parts(slice_ptr, slice_len) };
                if self.send(slice) {
                    return Writable::Owned(len);
                }
            }
        } else if self.buffer.len + len >= self.high_water_mark {
            // kinda fast path:
            // - combined chunk is large enough to flush automatically
            // - no backpressure
            if self.buffer.write_latin1(bytes).is_err() {
                return Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write));
            }
            // PORT NOTE: reshaped for borrowck
            let slice_ptr = self.readable_slice().as_ptr();
            let slice_len = self.readable_slice().len();
            // SAFETY: see flush_no_wait
            let readable = unsafe { core::slice::from_raw_parts(slice_ptr, slice_len) };
            if self.send(readable) {
                return Writable::Owned(len);
            }
        } else {
            if self.buffer.write_latin1(bytes).is_err() {
                return Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write));
            }
        }

        self.register_auto_flusher();

        Writable::Owned(len)
    }

    pub fn write_utf16(&mut self, data: StreamResult) -> Writable {
        if self.done || self.requested_end {
            return Writable::Owned(0);
        }

        if self.res.is_none()
            || self.any_res().unwrap().has_responded()
        {
            self.signal.close(None);
            self.mark_done();
            return Writable::Done;
        }

        let bytes = data.slice();

        bun_core::scoped_log!(HTTPServerWritableLog, "writeUTF16({})", bytes.len());

        // we must always buffer UTF-16
        // we assume the case of all-ascii UTF-16 string is pretty uncommon
        // SAFETY: bytes are u16-aligned per Result.slice16 invariant
        let utf16 = unsafe {
            core::slice::from_raw_parts(bytes.as_ptr() as *const u16, bytes.len() / 2)
        };
        let written = match self.buffer.write_utf16(utf16) {
            Ok(n) => n,
            Err(_) => {
                return Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write))
            }
        };

        let readable_len = self.readable_slice().len();
        if readable_len >= self.high_water_mark as usize || self.has_backpressure() {
            // PORT NOTE: reshaped for borrowck
            let slice_ptr = self.readable_slice().as_ptr();
            // SAFETY: see flush_no_wait
            let readable = unsafe { core::slice::from_raw_parts(slice_ptr, readable_len) };
            if self.send(readable) {
                return Writable::Owned(u32::try_from(written).unwrap());
            }
        }

        self.register_auto_flusher();
        Writable::Owned(u32::try_from(written).unwrap())
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

        if self.done
            || self.res.is_none()
            || self.any_res().unwrap().has_responded()
        {
            self.signal.close(err);
            self.mark_done();
            self.finalize();
            return bun_sys::Result::Ok(());
        }

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
            return bun_sys::Result::Ok(JSValue::js_number(0.0));
        }

        if self.done
            || self.res.is_none()
            || self.any_res().unwrap().has_responded()
        {
            self.requested_end = true;
            self.signal.close(None);
            self.mark_done();
            self.finalize();
            return bun_sys::Result::Ok(JSValue::js_number(0.0));
        }

        self.requested_end = true;
        let readable_len = self.readable_slice().len();
        self.end_len = readable_len;

        if readable_len > 0 {
            // PORT NOTE: reshaped for borrowck
            let slice_ptr = self.readable_slice().as_ptr();
            // SAFETY: see flush_no_wait
            let readable = unsafe { core::slice::from_raw_parts(slice_ptr, readable_len) };
            if !self.send(readable) {
                self.pending_flush = Some(JSPromise::create(global_this));
                self.global_this = global_this as *const _;
                // SAFETY: just created
                let value = unsafe { &*self.pending_flush.unwrap() }.to_js();
                value.protect();
                return bun_sys::Result::Ok(value);
            }
        } else {
            if let Some(res) = self.any_res() {
                res.end(b"", false);
            }
        }

        self.mark_done();
        let _ = self.flush_promise(); // TODO: properly propagate exception upwards
        self.signal.close(None);
        self.finalize();

        bun_sys::Result::Ok(JSValue::js_number(self.wrote as f64))
    }

    pub fn sink(&mut self) -> Sink {
        Sink::init(self)
    }

    pub fn abort(&mut self) {
        bun_core::scoped_log!(HTTPServerWritableLog, "onAborted()");
        self.done = true;
        self.res = None;
        self.unregister_auto_flusher();

        self.aborted = true;

        self.signal.close(None);

        let _ = self.flush_promise(); // TODO: properly propagate exception upwards
        self.finalize();
    }

    fn unregister_auto_flusher(&mut self) {
        if self.auto_flusher.registered {
            // SAFETY: global_this set before any auto-flusher registration; bun_vm()
            // returns the per-global VM singleton, valid for the program lifetime.
            let vm = unsafe { &*(*self.global_this).bun_vm() };
            AutoFlusher::unregister_deferred_microtask_with_type_unchecked::<Self>(self, vm);
        }
    }

    fn register_auto_flusher(&mut self) {
        let Some(res) = self.any_res() else { return };
        // if we enqueue data we should reset the timeout
        res.reset_timeout();
        if !self.auto_flusher.registered {
            // SAFETY: global_this set before first write; see unregister_auto_flusher.
            let vm = unsafe { &*(*self.global_this).bun_vm() };
            AutoFlusher::register_deferred_microtask_with_type_unchecked::<Self>(self, vm);
        }
    }

    pub fn on_auto_flush(&mut self) -> bool {
        bun_core::scoped_log!(HTTPServerWritableLog, "onAutoFlush()");
        if self.done {
            self.auto_flusher.registered = false;
            return false;
        }

        let readable_len = self.readable_slice().len();

        if self.has_backpressure_and_is_try_end() || readable_len == 0 {
            self.auto_flusher.registered = false;
            return false;
        }

        // PORT NOTE: reshaped for borrowck
        let slice_ptr = self.readable_slice().as_ptr();
        // SAFETY: see flush_no_wait
        let readable = unsafe { core::slice::from_raw_parts(slice_ptr, readable_len) };
        if !self.send_without_auto_flusher(readable) {
            self.auto_flusher.registered = true;
            return true;
        }
        self.auto_flusher.registered = false;
        false
    }

    pub fn destroy(this: *mut Self) {
        bun_core::scoped_log!(HTTPServerWritableLog, "destroy()");
        // SAFETY: this was Box::into_raw'd; destroy takes sole ownership. Reclaim
        // the Box first so we never hold a `&mut *this` alongside the Box's
        // unique pointer.
        let mut this = unsafe { Box::from_raw(this) };
        // Callers may tear this sink down without routing through
        // flushPromise() (e.g. handleResolveStream / handleRejectStream).
        // Drop the GC root so the promise can be collected.
        if let Some(prom) = this.pending_flush.take() {
            // SAFETY: prom is GC-rooted
            unsafe { &*prom }.to_js().unprotect();
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
            self.unregister_auto_flusher();
            if let Some(res) = self.any_res() {
                // Detach the handlers this sink registered before flushing.
                // onAborted/onData belong to RequestContext, not the sink —
                // clearing them here would drop the holder's pointer (and on
                // H3, where the stream is freed after FIN, leave it dangling).
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
            self.buffer.len = 0;
            if self.buffer.cap > 64 * 1024 {
                self.buffer.clear_and_free();
            }
            // SAFETY: pooled is a valid pool node checkout
            unsafe {
                (*pooled.as_ptr()).data =
                    core::mem::MaybeUninit::new(core::mem::take(&mut self.buffer));
            }

            self.buffer = ByteList::default();
            self.pooled_buffer = None;
            // PORT NOTE: Zig `pooled.release()` → Rust `ObjectPool::release(node)`
            // (the Node `Parent` back-ref was dropped in the port; see pool.rs).
            ByteListPool::release(pooled.as_ptr());
        } else if self.buffer.cap == 0 {
            //
        } else if FeatureFlags::HTTP_BUFFER_POOLING && !ByteListPool::full() {
            let buffer = core::mem::take(&mut self.buffer);
            ByteListPool::push(buffer);
        } else {
            // Don't release this buffer until destroy() is called
            self.buffer.len = 0;
        }
    }

    pub fn flush_promise(&mut self) -> JsResult<()> {
        // TODO(port): narrow error set — Zig: bun.JSTerminated!void
        if let Some(prom) = self.pending_flush.take() {
            bun_core::scoped_log!(HTTPServerWritableLog, "flushPromise()");

            // SAFETY: global_this set when pending_flush was created
            let global_this = unsafe { &*self.global_this };
            // SAFETY: prom is GC-rooted
            unsafe { &*prom }.to_js().unprotect();
            let result = unsafe { &mut *prom }.resolve(
                global_this,
                JSValue::js_number(self.wrote.saturating_sub(self.wrote_at_start_of_flush) as f64),
            );
            // PORT NOTE: Zig `defer this.wrote_at_start_of_flush = this.wrote` reads `this.wrote`
            // at scope exit (AFTER resolve, which may reenter JS and mutate `wrote`). Read it here,
            // not before the call.
            self.wrote_at_start_of_flush = self.wrote;
            return Ok(result?);
        }
        Ok(())
    }
}

impl<const SSL: bool, const HTTP3: bool> SinkHandler for HTTPServerWritable<SSL, HTTP3> {
    fn write(&mut self, data: StreamResult) -> Writable {
        Self::write(self, data)
    }
    fn write_latin1(&mut self, data: StreamResult) -> Writable {
        Self::write_latin1(self, data)
    }
    fn write_utf16(&mut self, data: StreamResult) -> Writable {
        Self::write_utf16(self, data)
    }
    fn end(&mut self, err: Option<SysError>) -> bun_sys::Result<()> {
        Self::end(self, err)
    }
    fn connect(&mut self, signal: Signal) -> bun_sys::Result<()> {
        Self::connect(self, signal);
        bun_sys::Result::Ok(())
    }
}

pub type HTTPSResponseSink = HTTPServerWritable<true, false>;
pub type HTTPResponseSink = HTTPServerWritable<false, false>;
pub type H3ResponseSink = HTTPServerWritable<true, true>;

// ──────────────────────────────────────────────────────────────────────────
// NetworkSink
// ──────────────────────────────────────────────────────────────────────────

pub struct NetworkSink {
    // TODO(port): SHARED Option<Arc<MultiPartUpload>> per LIFETIMES.tsv — but Zig calls task.deref()
    // (intrusive refcount). Using IntrusiveArc-style raw ptr; Phase B: confirm Arc vs IntrusiveArc.
    pub task: Option<NonNull<bun_s3::MultiPartUpload>>,
    pub signal: Signal,
    // TODO(port): JSC_BORROW &JSGlobalObject — heap struct; using raw ptr
    pub global_this: *const JSGlobalObject,
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
            global_this: core::ptr::null(),
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
    pub fn new(init: NetworkSink) -> Box<NetworkSink> {
        Box::new(init)
    }
    // TODO(port): bun.TrivialDeinit → relies on Drop; explicit deinit is no-op here

    fn get_high_water_mark(&self) -> BlobSizeType {
        if let Some(task) = self.task {
            // SAFETY: task is ref-counted, alive while held
            return unsafe { task.as_ref() }.part_size_in_bytes() as BlobSizeType;
        }
        self.high_water_mark
    }

    pub fn path(&self) -> Option<&[u8]> {
        if let Some(task) = self.task {
            // SAFETY: task is ref-counted, alive while held
            return Some(&unsafe { task.as_ref() }.path);
        }
        None
    }

    pub fn start(&mut self, stream_start: Start) -> bun_sys::Result<()> {
        if self.ended {
            return bun_sys::Result::Ok(());
        }

        if let Start::ChunkSize(chunk_size) = stream_start {
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

    pub fn sink(&mut self) -> Sink {
        Sink::init(self)
    }

    pub fn to_sink(&mut self) -> *mut NetworkSinkJSSink {
        // SAFETY: JSSink wraps Self at offset 0 (repr guarantee from codegen)
        self as *mut Self as *mut NetworkSinkJSSink
        // TODO(port): @ptrCast(this) to JSSink — depends on codegen layout
    }

    pub fn finalize(&mut self) {
        self.detach_writable();
    }

    fn detach_writable(&mut self) {
        if let Some(task) = self.task.take() {
            // SAFETY: task is ref-counted; deref releases our ref
            bun_s3::MultiPartUpload::deref_(task.as_ptr());
        }
    }

    pub fn on_writable(
        task: &mut bun_s3::MultiPartUpload,
        this: &mut NetworkSink,
        flushed: u64,
    ) -> JsResult<()> {
        // TODO(port): narrow error set — Zig: bun.JSTerminated!void
        bun_core::scoped_log!(
            NetworkSinkLog,
            "onWritable flushed: {} state: {}",
            flushed,
            task.state as u8
        );
        if this.flush_promise.has_value() {
            // SAFETY: global_this set at construction
            let global = unsafe { &*this.global_this };
            this.flush_promise
                .resolve(global, JSValue::js_number(flushed as f64))?;
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
        if let Some(task) = self.task {
            // SAFETY: task ref-counted, alive
            if !unsafe { task.as_ref() }.is_queue_empty() {
                // we have something queued, we need to wait for the next flush
                self.flush_promise = JSPromiseStrong::init(global_this);
                return bun_sys::Result::Ok(self.flush_promise.value());
            }
        }
        // we are done flushing no backpressure
        bun_sys::Result::Ok(JSPromise::resolved_promise_value(
            global_this,
            JSValue::js_number(0.0),
        ))
    }

    pub fn finalize_and_destroy(this: *mut Self) {
        // SAFETY: this was Box::into_raw'd; reclaim sole ownership before
        // touching fields so no `&mut *this` is live alongside the Box.
        let mut this = unsafe { Box::from_raw(this) };
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

    pub fn write(&mut self, data: StreamResult) -> Writable {
        if self.ended {
            return Writable::Owned(0);
        }
        let bytes = data.slice();
        let len = bytes.len() as BlobSizeType;

        if let Some(task) = self.task {
            // SAFETY: task ref-counted, alive
            if unsafe { task.as_ptr().as_mut().unwrap() }
                .write_bytes(bytes, false)
                .is_err()
            {
                return Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write));
            }
        }
        Writable::Owned(len)
    }

    pub fn write_bytes(&mut self, data: StreamResult) -> Writable {
        self.write(data)
    }

    pub fn write_latin1(&mut self, data: StreamResult) -> Writable {
        if self.ended {
            return Writable::Owned(0);
        }

        let bytes = data.slice();
        let len = bytes.len() as BlobSizeType;

        if let Some(task) = self.task {
            // SAFETY: task ref-counted, alive
            if unsafe { task.as_ptr().as_mut().unwrap() }
                .write_latin1(bytes, false)
                .is_err()
            {
                return Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write));
            }
        }
        Writable::Owned(len)
    }

    pub fn write_utf16(&mut self, data: StreamResult) -> Writable {
        if self.ended {
            return Writable::Owned(0);
        }
        let bytes = data.slice();
        if let Some(task) = self.task {
            // we must always buffer UTF-16
            // we assume the case of all-ascii UTF-16 string is pretty uncommon
            // SAFETY: task ref-counted, alive
            if unsafe { task.as_ptr().as_mut().unwrap() }
                .write_utf16(bytes, false)
                .is_err()
            {
                return Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write));
            }
        }

        Writable::Owned(u32::try_from(bytes.len()).unwrap())
    }

    pub fn end(&mut self, err: Option<SysError>) -> bun_sys::Result<()> {
        if self.ended {
            return bun_sys::Result::Ok(());
        }

        // send EOF
        self.ended = true;
        // flush everything and send EOF
        if let Some(task) = self.task {
            // SAFETY: task ref-counted, alive
            let _ = unsafe { task.as_ptr().as_mut().unwrap() }.write_bytes(b"", true);
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
        if let Some(task) = self.task {
            // we need to wait for the task to end
            // SAFETY: global_this set at construction
            let global = unsafe { &*self.global_this };
            self.end_promise = JSPromiseStrong::init(global);
            let value = self.end_promise.value();
            if !self.ended {
                self.ended = true;
                // we need to send EOF
                // SAFETY: task ref-counted, alive
                let _ = unsafe { task.as_ptr().as_mut().unwrap() }.write_bytes(b"", true);
                self.signal.close(None);
            }
            return bun_sys::Result::Ok(value);
        }
        // task already detached
        bun_sys::Result::Ok(JSValue::js_number(0.0))
    }

    pub fn to_js(&mut self, global_this: &JSGlobalObject) -> JSValue {
        NetworkSinkJSSink::create_object(global_this, self, 0)
        // TODO(port): JSSink.createObject — codegen-provided
    }

    pub fn memory_cost(&self) -> usize {
        // Since this is a JSSink, the NewJSSink function does @sizeOf(JSSink) which includes @sizeOf(ArrayBufferSink).
        if let Some(_task) = self.task {
            //TODO: we could do better here
            // SAFETY: task ref-counted, alive
            todo!("blocked_on: webcore::StreamBuffer::memory_cost");
        }
        0
    }

    pub const NAME: &'static str = "NetworkSink";
}

impl SinkHandler for NetworkSink {
    fn write(&mut self, data: StreamResult) -> Writable {
        Self::write(self, data)
    }
    fn write_latin1(&mut self, data: StreamResult) -> Writable {
        Self::write_latin1(self, data)
    }
    fn write_utf16(&mut self, data: StreamResult) -> Writable {
        Self::write_utf16(self, data)
    }
    fn end(&mut self, err: Option<SysError>) -> bun_sys::Result<()> {
        Self::end(self, err)
    }
    fn connect(&mut self, signal: Signal) -> bun_sys::Result<()> {
        Self::connect(self, signal);
        bun_sys::Result::Ok(())
    }
}

// `NetworkSink` is exposed to JS via `Sink.JSSink(@This(), "NetworkSink")` —
// the resolved C externs are spelled out here so the generic `JSSink<NetworkSink>`
// can dispatch (see FileSink for the same pattern).
unsafe extern "C" {
    fn NetworkSink__fromJS(value: JSValue) -> usize;
    fn NetworkSink__createObject(
        global: *mut JSGlobalObject,
        object: *mut c_void,
        destructor: usize,
    ) -> JSValue;
    fn NetworkSink__setDestroyCallback(value: JSValue, callback: usize);
    fn NetworkSink__assignToStream(
        global: *mut JSGlobalObject,
        stream: JSValue,
        ptr: *mut c_void,
        jsvalue_ptr: *mut *mut c_void,
    ) -> JSValue;
    fn NetworkSink__onClose(ptr: JSValue, reason: JSValue);
    fn NetworkSink__onReady(ptr: JSValue, amount: JSValue, offset: JSValue);
}

impl crate::webcore::sink::JsSinkAbi for NetworkSink {
    unsafe fn from_js_extern(value: JSValue) -> usize {
        unsafe { NetworkSink__fromJS(value) }
    }
    unsafe fn create_object_extern(
        global: *mut JSGlobalObject,
        object: *mut c_void,
        destructor: usize,
    ) -> JSValue {
        unsafe { NetworkSink__createObject(global, object, destructor) }
    }
    unsafe fn set_destroy_callback_extern(value: JSValue, callback: usize) {
        unsafe { NetworkSink__setDestroyCallback(value, callback) }
    }
    unsafe fn assign_to_stream_extern(
        global: *mut JSGlobalObject,
        stream: JSValue,
        ptr: *mut c_void,
        jsvalue_ptr: *mut *mut c_void,
    ) -> JSValue {
        unsafe { NetworkSink__assignToStream(global, stream, ptr, jsvalue_ptr) }
    }
    unsafe fn on_close_extern(ptr: JSValue, reason: JSValue) {
        unsafe { NetworkSink__onClose(ptr, reason) }
    }
    unsafe fn on_ready_extern(ptr: JSValue, amount: JSValue, offset: JSValue) {
        unsafe { NetworkSink__onReady(ptr, amount, offset) }
    }
}

// TODO(port): `pub const JSSink = Sink.JSSink(@This(), name)` — type generator; needs macro/codegen
pub type NetworkSinkJSSink = crate::webcore::sink::JSSink<NetworkSink>;

// ──────────────────────────────────────────────────────────────────────────
// BufferAction
// ──────────────────────────────────────────────────────────────────────────

pub enum BufferAction {
    Text(JSPromiseStrong),
    ArrayBuffer(JSPromiseStrong),
    Blob(JSPromiseStrong),
    Bytes(JSPromiseStrong),
    Json(JSPromiseStrong),
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
    // TODO(b2-blocked): `AnyBlob::wrap` takes `(jsc::AnyPromise, &JSGlobalObject,
    // BufferActionTag)`; `swap()` here yields `*mut JSPromise`. Un-gate once an
    // `AnyPromise::from(*mut JSPromise)` adapter exists.
    
    pub fn fulfill(&mut self, global: &JSGlobalObject, blob: &mut AnyBlob) -> JsResult<()> {
        // TODO(port): narrow error set — Zig: bun.JSTerminated!void
        blob.wrap(
            jsc::AnyPromise::Normal(self.swap()),
            global,
            self.tag(),
        )
        // TODO(port): Zig passed `this.*` (full enum) as 3rd arg; using tag()
    }

    pub fn reject(&mut self, global: &JSGlobalObject, err: StreamError) -> JsResult<()> {
        // TODO(port): narrow error set — Zig: bun.JSTerminated!void
        // SAFETY: swap returns valid promise ptr
        unsafe { &mut *self.swap() }
            .reject(global, Ok(err.to_js_weak(global).0))
            .map_err(|_| JsError::Terminated)
    }

    pub fn resolve(&mut self, global: &JSGlobalObject, result: JSValue) -> JsResult<()> {
        // TODO(port): narrow error set — Zig: bun.JSTerminated!void
        // SAFETY: swap returns valid promise ptr
        unsafe { &mut *self.swap() }
            .resolve(global, result)
            .map_err(|_| JsError::Terminated)
    }

    pub fn value(&self) -> JSValue {
        match self {
            BufferAction::Text(p)
            | BufferAction::ArrayBuffer(p)
            | BufferAction::Blob(p)
            | BufferAction::Bytes(p)
            | BufferAction::Json(p) => p.value(),
        }
    }

    pub fn get(&self) -> *mut JSPromise {
        match self {
            BufferAction::Text(p)
            | BufferAction::ArrayBuffer(p)
            | BufferAction::Blob(p)
            | BufferAction::Bytes(p)
            | BufferAction::Json(p) => (unsafe { p.get() }) as *mut JSPromise,
        }
    }

    pub fn swap(&mut self) -> *mut JSPromise {
        match self {
            BufferAction::Text(p)
            | BufferAction::ArrayBuffer(p)
            | BufferAction::Blob(p)
            | BufferAction::Bytes(p)
            | BufferAction::Json(p) => p.swap() as *mut JSPromise,
        }
    }

    pub fn tag(&self) -> BufferActionTag {
        match self {
            BufferAction::Text(_) => BufferActionTag::Text,
            BufferAction::ArrayBuffer(_) => BufferActionTag::ArrayBuffer,
            BufferAction::Blob(_) => BufferActionTag::Blob,
            BufferAction::Bytes(_) => BufferActionTag::Bytes,
            BufferAction::Json(_) => BufferActionTag::Json,
        }
    }
}

// PORT NOTE: Zig `BufferAction.deinit` only deinits the JSPromiseStrong payload of each
// variant. JSPromiseStrong implements Drop, so the enum drops it automatically — no explicit
// `impl Drop for BufferAction` needed.

// ──────────────────────────────────────────────────────────────────────────
// ReadResult
// ──────────────────────────────────────────────────────────────────────────

pub enum ReadResult {
    Pending,
    Err(SysError),
    Done,
    Read(*mut [u8]),
    // TODO(port): `[]u8` field — ownership depends on `slice.ptr != buf.ptr` check; using raw slice ptr
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
                // PORT NOTE: Zig's `slice` may point at the same allocation as
                // `buf` (it checks `slice.ptr != buf.ptr`). Forming `&mut *slice`
                // while the `buf: &mut [u8]` parameter is live would violate
                // Rust's aliasing rules in the `!owned` case. Stay on raw
                // pointers: `<*mut [u8]>::len()` reads only the fat-pointer
                // metadata (no deref), and the cast to `*mut u8` projects the
                // data pointer without creating a reference.
                let slice_ptr = slice as *mut u8;
                let slice_len = slice.len();
                let owned = slice_ptr as *const u8 != buf.as_ptr();
                let done = is_done || (close_on_empty && slice_len == 0);

                // Zig `bun.ByteList.fromOwnedSlice(slice)` adopts an existing heap
                // allocation by pointer/len (cap = len). The contract is: when
                // `slice.ptr != buf.ptr` the slice IS a default-allocator heap
                // allocation whose ownership is being transferred into the
                // StreamResult, and downstream `Result.release()` frees it via
                // `clear_and_free`. Mirror that by adopting the raw allocation
                // instead of copying — copying would leak the original buffer.
                break 'brk if owned && done {
                    let len = u32::try_from(slice_len).unwrap();
                    // SAFETY: `owned` branch — `slice` is disjoint from `buf` and
                    // the caller transfers a default-allocator heap allocation of
                    // exactly `len` bytes (cap == len), all initialized.
                    StreamResult::OwnedAndDone(unsafe {
                        ByteList::from_raw_parts(slice_ptr, len, len)
                    })
                } else if owned {
                    let len = u32::try_from(slice_len).unwrap();
                    // SAFETY: see above — ownership of `slice` is transferred here.
                    StreamResult::Owned(unsafe {
                        ByteList::from_raw_parts(slice_ptr, len, len)
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/streams.zig (1661 lines)
//   confidence: medium
//   todos:      41
//   notes:      Result/Writable pending fields use raw ptrs (self-referential lifetimes); HTTPServerWritable UwsResponse type-dispatch on const generics needs trait; JSSink type-generator needs codegen; many borrowck reshapes around readable_slice()+send(). NetworkSink.task: LIFETIMES.tsv says SHARED→Arc but Zig calls mutable methods through intrusive refcount — Phase B must pick Arc<+interior-mut> vs IntrusiveArc.
// ──────────────────────────────────────────────────────────────────────────
