use core::ffi::c_void;
use core::ptr::NonNull;

use bun_collections::BabyList;
use bun_core::FeatureFlags;
use bun_jsc::{
    ArrayBuffer, CommonAbortReason, JSGlobalObject, JSPromise, JSPromiseStrong, JSValue, JsResult,
    Task, VirtualMachine,
};
use bun_str::strings;
use bun_sys::{self as sys, Error as SysError, Fd};
use bun_uws as uws;

use crate::webcore::blob::{AnyBlob, Blob};
use crate::webcore::sink::{FileSink, Sink};
use crate::webcore::{AutoFlusher, ByteListPool, ByteListPoolNode};

bun_output::declare_scope!(HTTPServerWritable, visible);
bun_output::declare_scope!(NetworkSink, visible);

/// `Blob.SizeType` is `u32` in Zig.
type BlobSizeType = u32;
type ByteList = BabyList<u8>;

// ──────────────────────────────────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────────────────────────────────

#[derive(strum::IntoStaticStr)]
pub enum Start {
    Empty,
    Err(SysError),
    ChunkSize(BlobSizeType),
    ArrayBufferSink {
        chunk_size: BlobSizeType,
        as_uint8array: bool,
        stream: bool,
    },
    FileSink(<FileSink as crate::webcore::sink::FileSinkOptions>::Options),
    // TODO(port): FileSink::Options type path — using placeholder trait projection
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
            Start::Err(err) => global_this.throw_value(err.to_js(global_this)?),
            Start::OwnedAndDone(list) => {
                Ok(ArrayBuffer::from_bytes(list.slice(), ArrayBuffer::Kind::Uint8Array)
                    .to_js(global_this))
            }
            Start::Done(list) => {
                Ok(ArrayBuffer::create(global_this, list.slice(), ArrayBuffer::Kind::Uint8Array))
            }
            _ => Ok(JSValue::UNDEFINED),
        }
    }

    pub fn from_js(global_this: &JSGlobalObject, value: JSValue) -> JsResult<Start> {
        if value.is_empty_or_undefined_or_null() || !value.is_object() {
            return Ok(Start::Empty);
        }

        if let Some(chunk_size) = value.get(global_this, "chunkSize") {
            if chunk_size.is_number() {
                return Ok(Start::ChunkSize(
                    (chunk_size.to_int64() as i64 as i64 & ((1i64 << 52) - 1)) as BlobSizeType,
                ));
                // TODO(port): @truncate(i52) semantics — using mask; revisit exact bit-width
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

                if let Some(val) = value.get_own(global_this, "asUint8Array")? {
                    if val.is_boolean() {
                        as_uint8array = val.to_boolean();
                        empty = false;
                    }
                }

                if let Some(val) = value.fast_get(global_this, bun_jsc::BuiltinName::Stream)? {
                    if val.is_boolean() {
                        stream = val.to_boolean();
                        empty = false;
                    }
                }

                if let Some(chunk_size_val) =
                    value.fast_get(global_this, bun_jsc::BuiltinName::HighWaterMark)?
                {
                    if chunk_size_val.is_number() {
                        empty = false;
                        chunk_size = 0i64
                            .max((chunk_size_val.to_int64() as i64) & ((1i64 << 51) - 1))
                            as BlobSizeType;
                        // TODO(port): @truncate(i51) semantics
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
                    value.fast_get(global_this, bun_jsc::BuiltinName::HighWaterMark)?
                {
                    if chunk_size_val.is_number() {
                        chunk_size = 0i64
                            .max((chunk_size_val.to_int64() as i64) & ((1i64 << 51) - 1))
                            as BlobSizeType;
                        // TODO(port): @truncate(i51) semantics
                    }
                }

                if let Some(path) = value.fast_get(global_this, bun_jsc::BuiltinName::Path)? {
                    if !path.is_string() {
                        return Ok(Start::Err(SysError {
                            errno: sys::SystemErrno::EINVAL as _,
                            syscall: sys::Syscall::Write,
                            ..Default::default()
                        }));
                    }

                    return Ok(Start::FileSink(crate::webcore::sink::FileSinkOptions {
                        chunk_size,
                        input_path: crate::webcore::sink::FileSinkInputPath::Path(
                            path.to_slice(global_this)?,
                        ),
                        // TODO(port): path.toSlice(globalThis, allocator) — allocator param dropped
                    }));
                } else if let Some(fd_value) = value.get_truthy(global_this, "fd")? {
                    if !fd_value.is_any_int() {
                        return Ok(Start::Err(SysError {
                            errno: sys::SystemErrno::EBADF as _,
                            syscall: sys::Syscall::Write,
                            ..Default::default()
                        }));
                    }

                    if let Some(fd) = Fd::from_js(fd_value) {
                        return Ok(Start::FileSink(crate::webcore::sink::FileSinkOptions {
                            chunk_size,
                            input_path: crate::webcore::sink::FileSinkInputPath::Fd(fd),
                        }));
                    } else {
                        return Ok(Start::Err(SysError {
                            errno: sys::SystemErrno::EBADF as _,
                            syscall: sys::Syscall::Write,
                            ..Default::default()
                        }));
                    }
                }

                return Ok(Start::FileSink(crate::webcore::sink::FileSinkOptions {
                    input_path: crate::webcore::sink::FileSinkInputPath::Fd(bun_sys::INVALID_FD),
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
                    value.fast_get(global_this, bun_jsc::BuiltinName::HighWaterMark)?
                {
                    if chunk_size_val.is_number() {
                        empty = false;
                        chunk_size = 256i64
                            .max((chunk_size_val.to_int64() as i64) & ((1i64 << 51) - 1))
                            as BlobSizeType;
                        // TODO(port): @truncate(i51) semantics
                    }
                }

                if !empty {
                    return Ok(Start::ChunkSize(chunk_size));
                }
            }
            _ => {
                // Zig: @compileError("Unuspported tag")
                // TODO(port): const-generic compile error — unreachable at runtime
                unreachable!("Unsupported tag");
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
    TemporaryAndDone(ByteList),
    Temporary(ByteList),
    IntoArray(IntoArray),
    IntoArrayAndDone(IntoArray),
}

impl StreamResult {
    // TODO(port): not Drop — Result is bitwise-copied in to_js() shutdown path; ownership is contextual
    pub fn deinit(&mut self) {
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
            StreamError::Error(err) => match err.to_js(global_object) {
                Ok(v) => (v, WasStrong::Weak),
                Err(_) => (JSValue::ZERO, WasStrong::Weak),
            },
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

impl WritablePending {
    // TODO(port): deinit kept as inherent method; Future contains JSPromiseStrong with side-effect deinit
    pub fn deinit(&mut self) {
        self.future.deinit();
    }
}

pub enum WritableFuture {
    None,
    Promise {
        strong: JSPromiseStrong,
        // TODO(port): JSC_BORROW &JSGlobalObject — stored on heap struct; using raw ptr
        global: *const JSGlobalObject,
    },
    Handler(WritableHandler),
}

impl WritableFuture {
    pub fn deinit(&mut self) {
        if let WritableFuture::Promise { strong, .. } = self {
            strong.deinit();
            *self = WritableFuture::None;
        }
    }
}

impl WritablePending {
    pub fn promise(&mut self, global_this: &JSGlobalObject) -> *mut JSPromise {
        self.state = PendingState::Pending;

        match &self.future {
            WritableFuture::Promise { strong, .. } => strong.get(),
            _ => {
                self.future = WritableFuture::Promise {
                    strong: JSPromiseStrong::init(global_this),
                    global: global_this as *const _,
                };
                match &self.future {
                    WritableFuture::Promise { strong, .. } => strong.get(),
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
                    strong.swap(),
                    global,
                );
                // TODO(port): Zig moved p out then reassigned future = .none; mem::replace mirrors this
            }
            WritableFuture::Handler(h) => {
                self.future = WritableFuture::Handler(WritableHandler {
                    ctx: h.ctx,
                    handler: h.handler,
                });
                (h.handler)(h.ctx, core::mem::replace(&mut self.result, Writable::Done));
                // TODO(port): Zig passed self.result by value without consuming; using mem::replace
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
        let _guard = scopeguard::guard((), |_| promise.to_js().unprotect());
        // PORT NOTE: defer promise.toJS().unprotect() — runs on all paths
        match result {
            Writable::Err(err) => {
                let _ = promise.reject_with_async_stack(
                    global_this,
                    err.to_js(global_this).unwrap_or(JSValue::ZERO),
                );
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
            Writable::Err(err) => match err.to_js(global_this) {
                Ok(v) => JSPromise::rejected_promise(global_this, v).to_js(),
                Err(_) => JSValue::ZERO,
            },
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
                unsafe { &mut *pending }.promise(global_this).to_js()
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
            value: JSValue::ZERO,
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
        let prom = JSPromise::create(global_object);
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
        let vm = VirtualMachine::get();
        if vm.is_shutting_down() {
            return;
        }

        let clone = Box::new(core::mem::take(self));
        // PORT NOTE: reshaped — Zig copied *self then reset fields; mem::take + Default does both
        self.state = PendingState::None;
        self.result = StreamResult::Done;
        vm.event_loop().enqueue_task(Task::init(Box::into_raw(clone)));
    }

    pub fn run_from_js_thread(this: *mut Pending) {
        // SAFETY: this was Box::into_raw'd in run_on_next_tick
        let mut boxed = unsafe { Box::from_raw(this) };
        boxed.run();
        drop(boxed);
    }
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
                (h.handler)(h.ctx, core::mem::replace(&mut self.result, StreamResult::Done));
                // TODO(port): Zig passed self.result by value (bitwise copy); using mem::replace
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
        let vm = global_this.bun_vm();
        let event_loop = vm.event_loop();
        // SAFETY: promise is GC-rooted via protect()
        let promise = unsafe { &mut *promise };
        let promise_value = promise.to_js();
        let _unprotect = scopeguard::guard((), |_| promise_value.unprotect());

        event_loop.enter();
        let _exit = scopeguard::guard((), |_| event_loop.exit());

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
                *result = StreamResult::Temporary(ByteList::default());
                let _ = promise.reject_with_async_stack(global_this, value);
                // TODO: properly propagate exception upwards
            }
            StreamResult::Done => {
                let _ = promise.resolve(global_this, JSValue::FALSE);
                // TODO: properly propagate exception upwards
            }
            _ => {
                let value = match result.to_js(global_this) {
                    Ok(v) => v,
                    Err(err) => {
                        *result = StreamResult::Temporary(ByteList::default());
                        let _ = promise.reject(global_this, err);
                        // TODO: properly propagate exception upwards
                        return;
                    }
                };
                value.ensure_still_alive();

                *result = StreamResult::Temporary(ByteList::default());
                let _ = promise.resolve(global_this, value);
                // TODO: properly propagate exception upwards
            }
        }
    }

    pub fn to_js(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        if VirtualMachine::get().is_shutting_down() {
            // TODO(port): Zig copies *self to `that` and deinits the copy; ownership unclear — calling deinit on a clone-ish
            // Leaving as no-op deinit on self would be wrong (self is &). Phase B: revisit.
            return Ok(JSValue::ZERO);
        }

        match self {
            StreamResult::Owned(list) => Ok(ArrayBuffer::from_bytes(
                list.slice(),
                ArrayBuffer::Kind::Uint8Array,
            )
            .to_js(global_this)),
            StreamResult::OwnedAndDone(list) => Ok(ArrayBuffer::from_bytes(
                list.slice(),
                ArrayBuffer::Kind::Uint8Array,
            )
            .to_js(global_this)),
            StreamResult::Temporary(temp) => {
                let array =
                    JSValue::create_uninitialized_uint8_array(global_this, temp.len as usize)?;
                let slice_ = array.as_array_buffer(global_this).unwrap().slice_mut();
                let temp_slice = temp.slice();
                slice_[..temp_slice.len()].copy_from_slice(temp_slice);
                Ok(array)
            }
            StreamResult::TemporaryAndDone(temp) => {
                let array =
                    JSValue::create_uninitialized_uint8_array(global_this, temp.len as usize)?;
                let slice_ = array.as_array_buffer(global_this).unwrap().slice_mut();
                let temp_slice = temp.slice();
                slice_[..temp_slice.len()].copy_from_slice(temp_slice);
                Ok(array)
            }
            StreamResult::IntoArray(array) => Ok(JSValue::js_number_from_int64(array.len as i64)),
            StreamResult::IntoArrayAndDone(array) => {
                Ok(JSValue::js_number_from_int64(array.len as i64))
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
    pub vtable: Option<&'static SignalVTable>,
}

impl Signal {
    pub fn clear(&mut self) {
        self.ptr = None;
    }

    pub fn is_dead(&self) -> bool {
        self.ptr.is_none()
    }

    pub fn init_with_type<T: SignalHandler>(handler: &mut T) -> Signal {
        // this is nullable when used as a JSValue
        Signal {
            ptr: NonNull::new(handler as *mut T as *mut c_void),
            vtable: Some(SignalVTable::wrap::<T>()),
        }
    }

    pub fn init<T: SignalHandler>(handler: &mut T) -> Signal {
        Self::init_with_type(handler)
    }

    pub fn close(&mut self, err: Option<SysError>) {
        if self.is_dead() {
            return;
        }
        (self.vtable.unwrap().close)(self.ptr.unwrap().as_ptr(), err);
    }

    pub fn ready(&mut self, amount: Option<BlobSizeType>, offset: Option<BlobSizeType>) {
        if self.is_dead() {
            return;
        }
        (self.vtable.unwrap().ready)(self.ptr.unwrap().as_ptr(), amount, offset);
    }

    pub fn start(&mut self) {
        if self.is_dead() {
            return;
        }
        (self.vtable.unwrap().start)(self.ptr.unwrap().as_ptr());
    }
}

pub type SignalOnCloseFn = fn(this: *mut c_void, err: Option<SysError>);
pub type SignalOnReadyFn =
    fn(this: *mut c_void, amount: Option<BlobSizeType>, offset: Option<BlobSizeType>);
pub type SignalOnStartFn = fn(this: *mut c_void);

pub struct SignalVTable {
    pub close: SignalOnCloseFn,
    pub ready: SignalOnReadyFn,
    pub start: SignalOnStartFn,
}

/// Trait replacing Zig's `@hasDecl(Wrapped, "onClose")` duck-typing.
/// Default methods named `on_*` mirror the Zig fallback to `close`/`ready`/`start`.
pub trait SignalHandler {
    fn on_close(&mut self, err: Option<SysError>);
    fn on_ready(&mut self, amount: Option<BlobSizeType>, offset: Option<BlobSizeType>);
    fn on_start(&mut self);
}

impl SignalVTable {
    pub fn wrap<W: SignalHandler>() -> &'static SignalVTable {
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

        // TODO(port): Zig used `comptime &VTable.wrap(Type)` for static address — need const-promotable static
        &SignalVTable {
            close: on_close::<W>,
            ready: on_ready::<W>,
            start: on_start::<W>,
        }
        // PORT NOTE: returning &'static via rvalue static promotion; verify in Phase B
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

    pub on_first_write: Option<fn(*mut c_void)>,
    pub ctx: Option<*mut c_void>,

    pub auto_flusher: AutoFlusher,
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

    fn handle_wrote(&mut self, amount1: usize) {
        let amount = amount1 as BlobSizeType;
        self.offset += amount;
        self.wrote += amount;

        if self.offset >= self.buffer.len {
            self.offset = 0;
            self.buffer.len = 0;
        }
        bun_output::scoped_log!(
            HTTPServerWritable,
            "handleWrote: {} offset: {}, {}",
            amount1,
            self.offset,
            self.buffer.len
        );
    }

    fn handle_first_write_if_necessary(&mut self) {
        if let Some(on_first_write) = self.on_first_write {
            let ctx = self.ctx.take().unwrap_or(core::ptr::null_mut());
            self.on_first_write = None;
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

        let Some(res) = self.res else {
            bun_output::scoped_log!(
                HTTPServerWritable,
                "send: {} bytes (backpressure: {})",
                buf.len(),
                self.has_backpressure
            );
            return false;
        };
        // SAFETY: res is a live uWS response handle (FFI)
        let res = unsafe { &mut *(res as *mut uws::Response) };
        // TODO(port): UwsResponse type erasure — casting to placeholder uws::Response

        if self.requested_end && !res.state().is_http_write_called() {
            self.handle_first_write_if_necessary();
            let success = res.try_end(buf, self.end_len, false);
            if success {
                self.has_backpressure = false;
                self.handle_wrote(self.end_len);
            } else if self.res.is_some() {
                self.has_backpressure = true;
                res.on_writable::<Self>(Self::on_writable, self);
            }
            bun_output::scoped_log!(
                HTTPServerWritable,
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
            self.has_backpressure = res.write(buf) == uws::WriteResult::Backpressure;
        }
        self.handle_wrote(buf.len());
        bun_output::scoped_log!(
            HTTPServerWritable,
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
                self.buffer.ptr.add(self.offset as usize),
                (self.buffer.len - self.offset) as usize,
            )
        }
        // TODO(port): Zig `this.buffer.ptr[this.offset..this.buffer.len]` — verify ByteList field access
    }

    pub fn on_writable(&mut self, write_offset: u64, _res: *mut UwsResponse<SSL, HTTP3>) -> bool {
        // write_offset is the amount of data that was written not how much we need to write
        bun_output::scoped_log!(HTTPServerWritable, "onWritable ({})", write_offset);
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
                if let Some(res) = self.res {
                    // SAFETY: res is a live uWS handle
                    unsafe { &mut *(res as *mut uws::Response) }.clear_on_writable();
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
            // SAFETY: res checked non-null above
            || unsafe { &*(self.res.unwrap() as *mut uws::Response) }.has_responded()
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
                    self.pooled_buffer = Some(pooled_node);
                    // SAFETY: pooled_node is a valid pool checkout
                    self.buffer = unsafe { pooled_node.as_ref() }.data;
                    // TODO(port): ByteListPool::Node.data field access
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
        bun_output::scoped_log!(HTTPServerWritable, "start({})", self.high_water_mark);
        bun_sys::Result::Ok(())
    }

    fn flush_from_js_no_wait(&mut self) -> bun_sys::Result<JSValue> {
        bun_output::scoped_log!(HTTPServerWritable, "flushFromJSNoWait");
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
        bun_output::scoped_log!(HTTPServerWritable, "flushFromJS({})", wait);
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
        bun_output::scoped_log!(HTTPServerWritable, "flush()");
        self.unregister_auto_flusher();

        if !self.has_backpressure() || self.done {
            return bun_sys::Result::Ok(());
        }

        if self.res.is_none()
            // SAFETY: res checked non-null
            || unsafe { &*(self.res.unwrap() as *mut uws::Response) }.has_responded()
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
        bun_output::scoped_log!(HTTPServerWritable, "write({})", bytes.len());

        if self.buffer.len == 0 && len >= self.high_water_mark {
            // fast path:
            // - large-ish chunk
            // - no backpressure
            if self.send(bytes) {
                return Writable::Owned(len);
            }

            if self.buffer.write(bytes).is_err() {
                return Writable::Err(SysError::from_code(sys::E::NOMEM, sys::Syscall::Write));
            }
        } else if self.buffer.len + len >= self.high_water_mark {
            // TODO: attempt to write both in a corked buffer?
            if self.buffer.write(bytes).is_err() {
                return Writable::Err(SysError::from_code(sys::E::NOMEM, sys::Syscall::Write));
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
                return Writable::Err(SysError::from_code(sys::E::NOMEM, sys::Syscall::Write));
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
            // SAFETY: res checked non-null
            || unsafe { &*(self.res.unwrap() as *mut uws::Response) }.has_responded()
        {
            self.signal.close(None);
            self.mark_done();
            return Writable::Done;
        }

        let bytes = data.slice();
        let len = bytes.len() as BlobSizeType;
        bun_output::scoped_log!(HTTPServerWritable, "writeLatin1({})", bytes.len());

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
                return Writable::Err(SysError::from_code(sys::E::NOMEM, sys::Syscall::Write));
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
                return Writable::Err(SysError::from_code(sys::E::NOMEM, sys::Syscall::Write));
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
                return Writable::Err(SysError::from_code(sys::E::NOMEM, sys::Syscall::Write));
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
            // SAFETY: res checked non-null
            || unsafe { &*(self.res.unwrap() as *mut uws::Response) }.has_responded()
        {
            self.signal.close(None);
            self.mark_done();
            return Writable::Done;
        }

        let bytes = data.slice();

        bun_output::scoped_log!(HTTPServerWritable, "writeUTF16({})", bytes.len());

        // we must always buffer UTF-16
        // we assume the case of all-ascii UTF-16 string is pretty uncommon
        // SAFETY: bytes are u16-aligned per Result.slice16 invariant
        let utf16 = unsafe {
            core::slice::from_raw_parts(bytes.as_ptr() as *const u16, bytes.len() / 2)
        };
        let written = match self.buffer.write_utf16(utf16) {
            Ok(n) => n,
            Err(_) => {
                return Writable::Err(SysError::from_code(sys::E::NOMEM, sys::Syscall::Write))
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
        bun_output::scoped_log!(HTTPServerWritable, "end({:?})", err);

        if self.requested_end {
            return bun_sys::Result::Ok(());
        }

        if self.done
            || self.res.is_none()
            // SAFETY: res checked non-null
            || unsafe { &*(self.res.unwrap() as *mut uws::Response) }.has_responded()
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
        bun_output::scoped_log!(HTTPServerWritable, "endFromJS()");

        if self.requested_end {
            return bun_sys::Result::Ok(JSValue::js_number(0.0));
        }

        if self.done
            || self.res.is_none()
            // SAFETY: res checked non-null
            || unsafe { &*(self.res.unwrap() as *mut uws::Response) }.has_responded()
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
            if let Some(res) = self.res {
                // SAFETY: res is live uWS handle
                unsafe { &mut *(res as *mut uws::Response) }.end(b"", false);
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
        bun_output::scoped_log!(HTTPServerWritable, "onAborted()");
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
            // SAFETY: global_this set before any auto-flusher registration
            let vm = unsafe { &*self.global_this }.bun_vm();
            AutoFlusher::unregister_deferred_microtask_with_type_unchecked::<Self>(self, vm);
        }
    }

    fn register_auto_flusher(&mut self) {
        let Some(res) = self.res else { return };
        // if we enqueue data we should reset the timeout
        // SAFETY: res is live uWS handle
        unsafe { &mut *(res as *mut uws::Response) }.reset_timeout();
        if !self.auto_flusher.registered {
            // SAFETY: global_this set before first write
            let vm = unsafe { &*self.global_this }.bun_vm();
            AutoFlusher::register_deferred_microtask_with_type_unchecked::<Self>(self, vm);
        }
    }

    pub fn on_auto_flush(&mut self) -> bool {
        bun_output::scoped_log!(HTTPServerWritable, "onAutoFlush()");
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
        bun_output::scoped_log!(HTTPServerWritable, "destroy()");
        // SAFETY: this is Box-allocated; destroy takes ownership
        let this_ref = unsafe { &mut *this };
        // Callers may tear this sink down without routing through
        // flushPromise() (e.g. handleResolveStream / handleRejectStream).
        // Drop the GC root so the promise can be collected.
        if let Some(prom) = this_ref.pending_flush.take() {
            // SAFETY: prom is GC-rooted
            unsafe { &*prom }.to_js().unprotect();
        }
        this_ref.buffer.deinit();
        this_ref.unregister_auto_flusher();
        // SAFETY: this was Box::into_raw'd
        drop(unsafe { Box::from_raw(this) });
    }

    /// This can be called _many_ times for the same instance
    /// so it must zero out state instead of make it
    pub fn finalize(&mut self) {
        bun_output::scoped_log!(HTTPServerWritable, "finalize()");
        if !self.done {
            self.unregister_auto_flusher();
            if let Some(res) = self.res {
                // Detach the handlers this sink registered before flushing.
                // onAborted/onData belong to RequestContext, not the sink —
                // clearing them here would drop the holder's pointer (and on
                // H3, where the stream is freed after FIN, leave it dangling).
                // SAFETY: res is live uWS handle
                unsafe { &mut *(res as *mut uws::Response) }.clear_on_writable();
            }
            let _ = self.flush_no_wait();
            self.done = true;

            if let Some(res) = self.res {
                // is actually fine to call this if the socket is closed because of flushNoWait, the free will be defered by usockets
                // SAFETY: res is live uWS handle
                unsafe { &mut *(res as *mut uws::Response) }.end_stream(false);
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
            unsafe { pooled.as_ptr().as_mut().unwrap() }.data = self.buffer;
            // TODO(port): ByteListPool::Node.data assignment

            self.buffer = ByteList::empty();
            self.pooled_buffer = None;
            // SAFETY: pooled is a valid pool node
            unsafe { pooled.as_ptr().as_mut().unwrap() }.release();
        } else if self.buffer.cap == 0 {
            //
        } else if FeatureFlags::HTTP_BUFFER_POOLING && !ByteListPool::full() {
            let buffer = core::mem::replace(&mut self.buffer, ByteList::empty());
            ByteListPool::push(buffer);
        } else {
            // Don't release this buffer until destroy() is called
            self.buffer.len = 0;
        }
    }

    pub fn flush_promise(&mut self) -> JsResult<()> {
        // TODO(port): narrow error set — Zig: bun.JSTerminated!void
        if let Some(prom) = self.pending_flush.take() {
            bun_output::scoped_log!(HTTPServerWritable, "flushPromise()");

            // SAFETY: global_this set when pending_flush was created
            let global_this = unsafe { &*self.global_this };
            // SAFETY: prom is GC-rooted
            unsafe { &*prom }.to_js().unprotect();
            let wrote_now = self.wrote;
            let result = unsafe { &mut *prom }.resolve(
                global_this,
                JSValue::js_number(self.wrote.saturating_sub(self.wrote_at_start_of_flush) as f64),
            );
            self.wrote_at_start_of_flush = wrote_now;
            // PORT NOTE: Zig `defer this.wrote_at_start_of_flush = this.wrote` runs after try; reordered
            return result;
        }
        Ok(())
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
            return unsafe { task.as_ref() }.part_size_in_bytes();
        }
        self.high_water_mark
    }

    pub fn path(&self) -> Option<&[u8]> {
        if let Some(task) = self.task {
            // SAFETY: task is ref-counted, alive while held
            return Some(unsafe { task.as_ref() }.path());
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
            unsafe { task.as_ref() }.deref();
        }
    }

    pub fn on_writable(
        task: &mut bun_s3::MultiPartUpload,
        this: &mut NetworkSink,
        flushed: u64,
    ) -> JsResult<()> {
        // TODO(port): narrow error set — Zig: bun.JSTerminated!void
        bun_output::scoped_log!(
            NetworkSink,
            "onWritable flushed: {} state: {}",
            flushed,
            <&'static str>::from(task.state)
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
        // SAFETY: this is Box-allocated
        let this_ref = unsafe { &mut *this };
        this_ref.finalize();
        // SAFETY: this was Box::into_raw'd
        drop(unsafe { Box::from_raw(this) });
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
                return Writable::Err(SysError::from_code(sys::E::NOMEM, sys::Syscall::Write));
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
                return Writable::Err(SysError::from_code(sys::E::NOMEM, sys::Syscall::Write));
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
                return Writable::Err(SysError::from_code(sys::E::NOMEM, sys::Syscall::Write));
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
        if let Some(task) = self.task {
            //TODO: we could do better here
            // SAFETY: task ref-counted, alive
            return unsafe { task.as_ref() }.buffered.memory_cost();
        }
        0
    }

    pub const NAME: &'static str = "NetworkSink";
}

// TODO(port): `pub const JSSink = Sink.JSSink(@This(), name)` — type generator; needs macro/codegen
pub type NetworkSinkJSSink = crate::webcore::sink::JSSink<NetworkSink>;

// ──────────────────────────────────────────────────────────────────────────
// BufferAction
// ──────────────────────────────────────────────────────────────────────────

#[derive(strum::IntoStaticStr)]
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
    pub fn fulfill(&mut self, global: &JSGlobalObject, blob: &mut AnyBlob) -> JsResult<()> {
        // TODO(port): narrow error set — Zig: bun.JSTerminated!void
        blob.wrap(
            crate::webcore::blob::WrapKind::Normal(self.swap()),
            global,
            self.tag(),
        )
        // TODO(port): Zig passed `this.*` (full enum) as 3rd arg; using tag()
    }

    pub fn reject(&mut self, global: &JSGlobalObject, err: StreamError) -> JsResult<()> {
        // TODO(port): narrow error set — Zig: bun.JSTerminated!void
        // SAFETY: swap returns valid promise ptr
        unsafe { &mut *self.swap() }.reject(global, err.to_js_weak(global).0)
    }

    pub fn resolve(&mut self, global: &JSGlobalObject, result: JSValue) -> JsResult<()> {
        // TODO(port): narrow error set — Zig: bun.JSTerminated!void
        // SAFETY: swap returns valid promise ptr
        unsafe { &mut *self.swap() }.resolve(global, result)
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
            | BufferAction::Json(p) => p.get(),
        }
    }

    pub fn swap(&mut self) -> *mut JSPromise {
        match self {
            BufferAction::Text(p)
            | BufferAction::ArrayBuffer(p)
            | BufferAction::Blob(p)
            | BufferAction::Bytes(p)
            | BufferAction::Json(p) => p.swap(),
        }
    }

    fn tag(&self) -> BufferActionTag {
        match self {
            BufferAction::Text(_) => BufferActionTag::Text,
            BufferAction::ArrayBuffer(_) => BufferActionTag::ArrayBuffer,
            BufferAction::Blob(_) => BufferActionTag::Blob,
            BufferAction::Bytes(_) => BufferActionTag::Bytes,
            BufferAction::Json(_) => BufferActionTag::Json,
        }
    }
}

impl Drop for BufferAction {
    fn drop(&mut self) {
        match self {
            BufferAction::Text(p)
            | BufferAction::ArrayBuffer(p)
            | BufferAction::Blob(p)
            | BufferAction::Bytes(p)
            | BufferAction::Json(p) => p.deinit(),
        }
    }
}

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
                // SAFETY: slice is valid mutable slice from caller
                let slice_ref = unsafe { &mut *slice };
                let owned = slice_ref.as_ptr() != buf.as_ptr();
                let done = is_done || (close_on_empty && slice_ref.is_empty());

                break 'brk if owned && done {
                    StreamResult::OwnedAndDone(ByteList::from_owned_slice(slice_ref))
                } else if owned {
                    StreamResult::Owned(ByteList::from_owned_slice(slice_ref))
                } else if done {
                    StreamResult::IntoArrayAndDone(IntoArray {
                        len: slice_ref.len() as BlobSizeType,
                        value: view,
                    })
                } else {
                    StreamResult::IntoArray(IntoArray {
                        len: slice_ref.len() as BlobSizeType,
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
//   todos:      44
//   notes:      Result/Writable pending fields use raw ptrs (self-referential lifetimes); HTTPServerWritable UwsResponse type-dispatch on const generics needs trait; JSSink type-generator needs codegen; many borrowck reshapes around readable_slice()+send().
// ──────────────────────────────────────────────────────────────────────────
