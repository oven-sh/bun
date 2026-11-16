use core::borrow::Borrow;
use core::cell::Cell;
use core::ops::Deref;

use bun_jsc::StrongCell;
use bun_ptr::{
    AliasableBox, BackRef, CellExt as _, OptionCellExt as _, RefCount, RefPtr, VecCellExt as _,
};

use crate::webcore::jsc::{
    self as jsc, ArrayBuffer, CommonAbortReason, CommonAbortReasonExt as _, JSGlobalObject,
    JSPromise, JSPromiseStrong, JSType, JSValue, JsResult, SysErrorJsc, VirtualMachine,
};
use bun_collections::{ByteVecExt, VecExt};
use bun_core::{FeatureFlags, strings};
use bun_removable_features::{removable_body, removable_body_behind_value};
use bun_sys::{self as sys, Error as SysError, Fd};
use bun_uws as uws;

use crate::generated_bindgen::sink::{
    ArrayBufferSinkStartOptions, SinkPath, js_ReadableSinkController as js,
};
use crate::webcore::blob::Any as AnyBlob;
use crate::webcore::sink::{AnyControlledSink, ReadableSinkController};
use crate::webcore::{AutoFlusher, ByteListPool, DrainResult, ReadableStream};

// scope statics renamed with `Log` suffix so they don't collide with
// the `HTTPServerWritable` / `NetworkSink` *types* defined below
// (RequestContext was blocked on this name clash).
bun_core::declare_scope!(HTTPServerWritableLog, visible);
bun_core::declare_scope!(NetworkSinkLog, visible);

/// `bun.ObjectPool(bun.Vec<u8>, ...)::Node` — pooled buffer node type used by
/// `HTTPServerWritable.pooled_buffer`.
type ByteListPoolNode = bun_collections::pool::Node<Vec<u8>>;

// For callers that still spell it `bun_s3::MultiPartUpload`.
pub(crate) mod bun_s3 {
    pub(crate) use crate::webcore::s3::MultiPartUpload;
    pub(crate) use crate::webcore::s3::client::{S3UploadResult, s3_error_to_js};
    pub(crate) use crate::webcore::s3::multipart::UploadBackpressure;
}

/// `Blob.SizeType` is `u64` (see `webcore::blob::SizeType`).
type BlobSizeType = crate::webcore::BlobSizeType;

/// Upper bound on a JS-supplied `highWaterMark` used as an initial capacity
/// hint. WHATWG permits `Infinity`; clamp here (monotonic, unlike the Zig
/// `@truncate(i51)` wrap) and reserve fallibly at the allocation site.
const MAX_HIGH_WATER_MARK: i64 = 256 * 1024 * 1024;

#[inline]
fn high_water_mark(value: f64, min: BlobSizeType) -> BlobSizeType {
    // `as i64` maps NaN→0 and saturates ±Infinity; clamp in i64 before the
    // unsigned cast so Infinity/negatives/out-of-range never reach the allocator.
    (min as i64).max(value as i64).min(MAX_HIGH_WATER_MARK) as BlobSizeType
}

// Compat: `webcore::SinkHandle` and Body refer to `streams::Result` / `streams::result::StreamError`.
pub(crate) use StreamResult as Result;
pub(crate) mod result {
    pub(crate) use super::{StreamError, Writable};
}

// ──────────────────────────────────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────────────────────────────────

/// Options payload for the `Start::FileSink` variant.
pub(crate) type FileSinkOptions = crate::webcore::file_sink::Options;

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

impl Start {
    pub fn to_js(self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        match self {
            Start::Empty | Start::Ready => Ok(JSValue::UNDEFINED),
            Start::ChunkSize(chunk) => Ok(JSValue::from(chunk)),
            Start::Err(err) => Err(err.throw(global_this)),
            Start::OwnedAndDone(list) => {
                ArrayBuffer::from_default_allocator(global_this, JSType::Uint8Array, list)
            }
            _ => Ok(JSValue::UNDEFINED),
        }
    }

    /// `start(options)` of an `ArrayBufferSink`.
    pub(crate) fn array_buffer_sink(options: &ArrayBufferSinkStartOptions) -> Start {
        if options.as_uint8_array.is_none()
            && options.stream.is_none()
            && options.high_water_mark.is_none()
        {
            return Start::Empty;
        }
        Start::ArrayBufferSink {
            chunk_size: options
                .high_water_mark
                .map_or(0, |value| high_water_mark(value, 0)),
            as_uint8array: options.as_uint8_array.unwrap_or(false),
            stream: options.stream.unwrap_or(false),
        }
    }

    /// `start({ path, fd })` of a `FileSink`.
    pub(crate) fn file_sink(
        path: &SinkPath<'_>,
        fd: Option<bun_jsc::bindgen::JsLocal<'_>>,
    ) -> Start {
        use bun_sys_jsc::FdJsc as _;
        let error = |errno: sys::SystemErrno| {
            Start::Err(SysError {
                errno: errno as _,
                syscall: sys::Tag::write,
                ..Default::default()
            })
        };
        let input_path = match (path, fd) {
            (SinkPath::Path(path), _) => {
                crate::webcore::PathOrFileDescriptor::Path(path.clone().into_utf8())
            }
            (SinkPath::Other(_), _) => return error(sys::SystemErrno::EINVAL),
            (SinkPath::Missing, None) => crate::webcore::PathOrFileDescriptor::Fd(Fd::INVALID),
            (SinkPath::Missing, Some(fd)) => match Fd::from_js(fd.to_js()) {
                Some(fd) => crate::webcore::PathOrFileDescriptor::Fd(fd),
                None => return error(sys::SystemErrno::EBADF),
            },
        };
        Start::FileSink(FileSinkOptions {
            input_path,
            ..Default::default()
        })
    }

    /// `start({ highWaterMark })` of every other sink.
    pub(crate) fn chunk_size(value: Option<f64>) -> Start {
        value.map_or(Start::Empty, |value| {
            Start::ChunkSize(high_water_mark(value, 256))
        })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Result
// ──────────────────────────────────────────────────────────────────────────

pub enum StreamResult<'a> {
    Pending(&'a Pending),
    Err(StreamError),
    Done,
    Owned(Vec<u8>),
    OwnedAndDone(Vec<u8>),
    TemporaryAndDone(&'a [u8]),
    Temporary(&'a [u8]),
    IntoArray(IntoArray),
    IntoArrayAndDone(IntoArray),
}

/// Appends `text` as UTF-8, and returns how many bytes that is.
pub(crate) fn append_latin1(buffer: &Cell<Vec<u8>>, text: &[u8]) -> usize {
    let bytes = buffer.take();
    let initial = bytes.len();
    let bytes = strings::allocate_latin1_into_utf8_with_list(bytes, initial, text);
    let written = bytes.len() - initial;
    buffer.set(bytes);
    written
}

/// As [`append_latin1`].
pub(crate) fn append_utf16(buffer: &Cell<Vec<u8>>, text: &[u16]) -> usize {
    let mut bytes = buffer.take();
    let initial = bytes.len();
    strings::convert_utf16_to_utf8_append(&mut bytes, text);
    let written = bytes.len() - initial;
    buffer.set(bytes);
    written
}

/// One sink chunk in its source encoding, so whoever buffers it transcodes straight into its own buffer.
#[derive(Clone, Copy)]
pub(crate) enum EncodedChunk<'a> {
    Bytes(&'a [u8]),
    Latin1(&'a [u8]),
    Utf16(&'a [u16]),
}

impl<'a> EncodedChunk<'a> {
    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        match *self {
            Self::Bytes(b) | Self::Latin1(b) => b.is_empty(),
            Self::Utf16(u) => u.is_empty(),
        }
    }

    #[inline]
    pub(crate) fn utf8_len(&self) -> usize {
        match *self {
            Self::Bytes(b) => b.len(),
            Self::Latin1(b) => bun_simdutf_sys::simdutf::length::utf8::from::latin1(b),
            Self::Utf16(u) => {
                bun_simdutf_sys::simdutf::length::utf8::from::utf16::le_with_replacement(u)
            }
        }
    }

    #[inline]
    pub(crate) fn append_utf8_into(&self, out: &mut Vec<u8>) {
        match *self {
            Self::Bytes(b) => out.extend_from_slice(b),
            Self::Latin1(b) => {
                let _ = out.write_latin1(b);
            }
            Self::Utf16(u) => {
                let _ = out.write_utf16(u);
            }
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

impl StreamResult<'_> {
    pub(crate) fn slice(&self) -> &[u8] {
        match self {
            StreamResult::Owned(owned) | StreamResult::OwnedAndDone(owned) => owned,
            StreamResult::Temporary(bytes) | StreamResult::TemporaryAndDone(bytes) => bytes,
            _ => b"",
        }
    }
}

// ─── Result.Writable ─────────────────────────────────────────────────────

pub enum Writable<'a> {
    Pending(&'a WritablePending),
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
    future: Cell<Option<WritableFuture>>,
    pub(crate) result: Cell<Writable<'static>>,
    pub(crate) consumed: Cell<BlobSizeType>,
}

impl Default for WritablePending {
    fn default() -> Self {
        Self {
            future: Cell::new(None),
            result: Cell::new(Writable::Done),
            consumed: Cell::new(0),
        }
    }
}

struct WritableFuture {
    strong: JSPromiseStrong,
    // JSC_BORROW: process-lifetime VM global; safe `Deref` via `BackRef`.
    global: BackRef<JSGlobalObject>,
    /// The context whose script is writing (as `PendingRead`).
    context: bun_jsc::ContextId,
}

impl WritablePending {
    pub(crate) fn is_pending(&self) -> bool {
        self.future.is_some()
    }

    pub(crate) fn promise(&self, cx: &bun_jsc::JsThread<'_>) -> JSValue {
        self.future.with_taken(|future| {
            let future = future.get_or_insert_with(|| WritableFuture {
                strong: JSPromiseStrong::init(cx.global()),
                global: BackRef::new(cx.global()),
                context: cx.context().id(),
            });
            future.strong.value()
        })
    }

    /// Settle the parked write (see [`PendingRead::run`] for what happens to an
    /// exception the settle leaves).
    pub(crate) fn run(&self) {
        let Some(mut future) = self.future.take() else {
            return;
        };
        // `consumed` belongs to the operation being settled here; the next one
        // starts from zero.
        self.consumed.set(0);

        // A sink settles a write from its own completion, not from a queued task: for the script that is writing.
        let entered = future.global.bun_vm().enter_context(future.context);
        Writable::fulfill_promise(
            self.result.replace(Writable::Done),
            &future.strong.swap(&future.global),
            &future.global.js_thread(entered.context()),
        )
    }

    pub(crate) fn run_done(&self) {
        self.result.set(Writable::Done);
        self.run();
    }

    /// The write that accepted `len` bytes waits for [`run`](Self::run).
    pub(crate) fn park(&self, len: BlobSizeType) -> Writable<'_> {
        self.consumed.set(len);
        self.result.set(Writable::Owned(len));
        Writable::Pending(self)
    }

    /// Unroots the promise without settling it.
    pub(crate) fn clear(&self) {
        self.future.set(None);
    }
}

impl Writable<'_> {
    /// The write side of [`StreamResult::fulfill_promise`]: terminal in the
    /// same way.
    pub(crate) fn fulfill_promise(
        result: Writable<'_>,
        promise: &JSPromise,
        cx: &bun_jsc::JsThread<'_>,
    ) {
        let settled = match result {
            Writable::Err(err) => {
                promise.reject_with_async_stack(cx.global(), Ok(err.to_js(cx.global())))
            }
            Writable::Done => promise.resolve(cx.global(), JSValue::FALSE),
            other => promise.resolve(cx.global(), other.to_js(cx)),
        };
        crate::dispatch::fold(settled);
    }

    pub fn to_js(self, cx: &bun_jsc::JsThread<'_>) -> JSValue {
        match self {
            Writable::Err(err) => {
                JSPromise::rejected_promise(cx.global(), err.to_js(cx.global())).to_js()
            }
            Writable::Owned(len) => JSValue::from(len),
            // Negative sentinel; the writer awaits the drain via `flush(true)`.
            Writable::Backpressure(len) => JSValue::js_number(-((len as f64) + 1.0)),
            Writable::OwnedAndDone(len) => JSValue::from(len),
            Writable::Temporary(len) => JSValue::from(len),
            // false == controller.close()
            // undefined == noop, but we probably won't send it
            Writable::Done => JSValue::TRUE,
            Writable::Pending(pending) => pending.promise(cx),
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

/// The read that waits for its source, if there is one.
#[derive(Default)]
pub struct Pending(Cell<Option<PendingRead>>);

pub(crate) struct PendingRead {
    promise: JSPromiseStrong,
    // JSC_BORROW: process-lifetime VM global; safe `Deref` via `BackRef`.
    global_this: BackRef<JSGlobalObject>,
    /// The context whose script is reading (it asked for this promise).
    context: bun_jsc::ContextId,
}

impl Pending {
    pub(crate) fn is_pending(&self) -> bool {
        self.0.is_some()
    }

    fn promise(&self, cx: &bun_jsc::JsThread<'_>) -> JSValue {
        let promise = JSPromiseStrong::init(cx.global());
        let value = promise.value();
        self.0.set(Some(PendingRead {
            promise,
            global_this: BackRef::new(cx.global()),
            context: cx.context().id(),
        }));
        value
    }

    pub(crate) fn run(&self, result: StreamResult<'_>) {
        if let Some(read) = self.0.take() {
            read.run(result);
        }
    }

    pub(crate) fn close_on_next_tick(&self) {
        if let Some(read) = self.0.take() {
            VirtualMachine::get()
                .event_loop()
                .enqueue_task(bun_event_loop::Task::from_boxed(Box::new(read)));
        }
    }
}

impl bun_event_loop::BoxedTask for PendingRead {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::StreamPending;
    /// Nobody awaits the read any more.
    fn release_unrun(self: Box<Self>) {}
    /// `PendingRead::run` checks the context whose script is reading: most sources call it from their
    /// own completion, not through this task.
    fn context(&self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JSC-integration: Pending::run, StreamResult::to_js/fulfill_promise, SourceHandle,
// HTTPServerWritable impl, NetworkSink impl, BufferAction, ReadResult.
// ──────────────────────────────────────────────────────────────────────────

impl PendingRead {
    /// Settle the parked read. This is the stream settle primitive, reached
    /// from native frames of every kind (sink ABI methods, uWS response
    /// callbacks, pipe I/O, tasks): the promise is settled with a value built
    /// here — never a user thenable; a value that cannot be built becomes the
    /// rejection — so what settling itself can leave pending is the VM's
    /// termination (or the settle throwing), and it is folded here
    /// (`dispatch::fold`) rather than handed to callers that have nowhere to
    /// put it. The pending itself is consumed either way.
    pub(crate) fn run(self, result: StreamResult<'_>) {
        // Settled for the script that is reading (for nobody, once its context stopped).
        let entered = self.global_this.bun_vm().enter_context(self.context);
        let cx = self.global_this.js_thread(entered.context());
        result.fulfill_promise(self.promise, &cx);
    }
}

impl StreamResult<'_> {
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

    /// Terminal: see [`PendingRead::run`].
    fn fulfill_promise(self, mut promise: JSPromiseStrong, cx: &bun_jsc::JsThread<'_>) {
        let vm = cx.vm();

        // A completion for a VM that no longer runs script settles nothing.
        if !vm.script_allowed() {
            return;
        }

        let _exit = vm.enter_event_loop_scope();

        let settled = match self {
            StreamResult::Err(err) => {
                let value = err.to_js(cx.global());
                value.ensure_still_alive();
                drop(err);
                promise.reject_with_async_stack(cx.global(), Ok(value))
            }
            StreamResult::Done => promise.resolve(cx.global(), JSValue::FALSE),
            result => match result.to_js(cx) {
                Ok(value) => {
                    value.ensure_still_alive();
                    promise.resolve(cx.global(), value)
                }
                Err(err) => promise.reject(cx.global(), Err(err)),
            },
        };
        crate::dispatch::fold(settled);
    }

    pub fn to_js(self, cx: &bun_jsc::JsThread<'_>) -> JsResult<JSValue> {
        match self {
            StreamResult::Owned(list) | StreamResult::OwnedAndDone(list) => {
                ArrayBuffer::from_default_allocator(cx.global(), JSType::Uint8Array, list)
            }
            StreamResult::Temporary(temp) | StreamResult::TemporaryAndDone(temp) => {
                // Allocate an uninitialized Uint8Array and
                // memcpy the temporary chunk into it — avoids the extra zeroing that
                // `ArrayBuffer::create` would do.
                let array = JSValue::create_uninitialized_uint8_array(cx.global(), temp.len())?;
                let mut buf = array
                    .as_array_buffer(cx.global())
                    .expect("freshly created Uint8Array has a backing buffer");
                buf.slice_mut()[..temp.len()].copy_from_slice(temp);
                Ok(array)
            }
            StreamResult::IntoArray(array) => Ok(JSValue::from(array.len)),
            StreamResult::IntoArrayAndDone(array) => Ok(JSValue::from(array.len)),
            StreamResult::Pending(pending) => Ok(pending.promise(cx)),
            StreamResult::Err(err) => {
                let js_err = err.to_js(cx.global());
                js_err.ensure_still_alive();
                Ok(JSPromise::rejected_promise(cx.global(), js_err).to_js())
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

/// The one GC root a native sink keeps while a stream is piped into it: its controller cell, which holds the stream, the done-promise and the failure value.
#[derive(Default)]
pub(crate) struct PipeCell(StrongCell);

impl PipeCell {
    pub(crate) fn set(
        &self,
        cell: JSValue,
        stream: JSValue,
        done: JSValue,
        global: &JSGlobalObject,
    ) {
        js::set_pipe(cell, stream, done);
        self.root(cell, global);
    }

    pub(crate) fn take(&self) -> PipeCell {
        PipeCell(self.0.take())
    }

    pub(crate) fn cell(&self) -> Option<JSValue> {
        self.0.get()
    }

    /// The pipe is over: a controller the user still holds must not keep the stream or the promise alive.
    pub(crate) fn clear_slots(&self) {
        if let Some(cell) = self.0.get() {
            js::set_pipe(cell, JSValue::UNDEFINED, JSValue::UNDEFINED);
        }
    }

    pub(crate) fn has_stream(&self) -> bool {
        self.stream().is_some()
    }

    pub(crate) fn stream(&self) -> Option<crate::webcore::ReadableStream> {
        let stream = js::pipe_stream(self.0.get()?);
        if stream.is_empty() {
            return None;
        }
        crate::webcore::ReadableStream::from_js_direct(stream)
    }

    pub(crate) fn take_stream(&self) -> Option<crate::webcore::ReadableStream> {
        let stream = self.stream();
        if let Some(cell) = self.0.get() {
            js::clear_pipe_stream(cell);
        }
        stream
    }

    /// Root `cell` with nothing on it yet.
    pub(crate) fn root(&self, cell: JSValue, global: &JSGlobalObject) {
        self.0.set(global, cell);
    }

    pub(crate) fn has_done(&self) -> bool {
        self.done().is_some()
    }

    /// The promise the sink's owner or source awaits, until it is taken to be settled.
    pub(crate) fn done(&self) -> Option<JSValue> {
        Some(js::pipe_done(self.0.get()?)).filter(|done| !done.is_empty())
    }

    pub(crate) fn set_done(&self, done: JSValue) {
        debug_assert!(self.0.is_some(), "no controller cell to hold the promise");
        if let Some(cell) = self.0.get() {
            js::set_pipe_done(cell, done);
        }
    }

    pub(crate) fn take_done(&self) -> Option<JSValue> {
        Some(js::take_pipe_done(self.0.get()?)).filter(|done| !done.is_empty())
    }

    pub(crate) fn set_error(&self, error: JSValue) {
        if let Some(cell) = self.0.get() {
            js::set_fail_reason(cell, error);
        }
    }

    pub(crate) fn error(&self) -> Option<JSValue> {
        js::fail_reason_get_cached(self.0.get()?)
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
        self.detach_sink(None);
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
    /// The C++ controller cell of a JS-stream pump (`ReadableSinkController::assign_to_stream`).
    JSController(JSValue),
    ByteStream(BackRef<crate::webcore::ByteStream>),
    FileReader(BackRef<crate::webcore::FileReader>),
    /// The `'static` bound erases the `&JSGlobalObject` borrow carried in
    /// `Subprocess<'a>`; the pointed-at allocation outlives this handle.
    Subprocess(BackRef<crate::api::bun::subprocess::Subprocess<'static>>),
    FetchResponseBody(BackRef<crate::webcore::fetch::fetch_tasklet::FetchTasklet>),
    ServerRequestBody(crate::server::AnyRequestContext),
    S3DownloadBody(BackRef<crate::webcore::s3::client::S3DownloadStreamWrapper>),
    HTMLRewriter(BackRef<crate::api::html_rewriter::RewriterPipe>),
    /// `bun:internal-for-testing` only: `ready()` re-enters the stream's
    /// `on_cancel`, making consumed-during-`signal_drained` re-entrancy
    /// deterministic for tests.
    TestingCancelOnDrain(BackRef<crate::webcore::ByteStream>),
}

impl SourceHandle {
    /// Disconnect the upstream source: JSController → detach; ByteStream → clear its SinkHandle.
    pub(crate) fn detach(self, global: &JSGlobalObject) {
        match self {
            SourceHandle::JSController(value) => {
                crate::dispatch::fold(ReadableSinkController::detach(value, global));
            }
            SourceHandle::ByteStream(bs) => drop(bs.detach_sink(None)),
            SourceHandle::FileReader(fr) => drop(fr.detach_sink(None)),
            _ => {}
        }
    }

    pub fn close(self, err: Option<SysError>) {
        match self {
            SourceHandle::None => {}
            SourceHandle::JSController(cpp) => {
                let global = VirtualMachine::get().global();
                // A frame above is unwinding with its exception: not ours to run
                // over. Otherwise the controller's close is settled here like a
                // parked promise (`Pending::run`).
                if global.has_exception() {
                    return;
                }
                // The reason reaches the piped ReadableStream's cancel().
                let reason = match &err {
                    Some(err) => err.to_js(global),
                    None => JSValue::UNDEFINED,
                };
                Self::close_js_controller(global, cpp, reason);
            }
            SourceHandle::ByteStream(p) => p.on_close(err),
            SourceHandle::FileReader(p) => p.on_close(err),
            SourceHandle::Subprocess(p) => {
                removable_body!(Spawn, Abort, { p.on_close(err) })
            }
            SourceHandle::FetchResponseBody(p) => {
                removable_body!(HttpClient, Abort, { p.on_stream_cancelled() })
            }
            SourceHandle::S3DownloadBody(p) => {
                removable_body!(S3Client, Abort, { p.on_stream_cancelled() })
            }
            SourceHandle::ServerRequestBody(_) => {}
            SourceHandle::HTMLRewriter(p) => {
                removable_body!(HtmlRewriter, Abort, { p.on_close(err) })
            }
            SourceHandle::TestingCancelOnDrain(_) => {}
        }
    }

    /// [`close`](Self::close), with `reason` as the piped JS stream's cancel() argument.
    pub fn abort(self, reason: CommonAbortReason) {
        match self {
            SourceHandle::JSController(_) => {
                let global = VirtualMachine::get().global();
                if global.has_exception() {
                    return;
                }
                self.cancel(reason.to_js(global));
            }
            _ => self.close(None),
        }
    }

    /// [`close`](Self::close), with an arbitrary JS `reason` for the piped JS stream's cancel().
    pub fn cancel(self, reason: JSValue) {
        match self {
            SourceHandle::JSController(cpp) => {
                let global = VirtualMachine::get().global();
                if global.has_exception() {
                    return;
                }
                Self::close_js_controller(global, cpp, reason);
            }
            _ => self.close(None),
        }
    }

    fn close_js_controller(global: &JSGlobalObject, cpp: JSValue, reason: JSValue) {
        crate::dispatch::fold(ReadableSinkController::on_close(cpp, global, reason));
    }

    pub fn ready(self, _amount: Option<BlobSizeType>, _offset: Option<BlobSizeType>) {
        match self {
            SourceHandle::None => {}
            SourceHandle::JSController(cpp) => {
                let global = VirtualMachine::get().global();
                if global.has_exception() {
                    return;
                }
                crate::dispatch::fold(js::on_ready(cpp, global));
            }
            SourceHandle::ByteStream(p) => p.on_ready(),
            SourceHandle::FileReader(p) => p.on_ready(),
            SourceHandle::FetchResponseBody(p) => {
                removable_body!(HttpClient, Abort, { p.on_ready() })
            }
            SourceHandle::ServerRequestBody(any) => {
                removable_body!(Serve, Abort, { any.on_request_body_stream_drained() })
            }
            SourceHandle::HTMLRewriter(p) => {
                removable_body!(HtmlRewriter, Abort, { p.on_ready() })
            }
            SourceHandle::S3DownloadBody(p) => {
                removable_body!(S3Client, Abort, { p.on_stream_drained() })
            }
            SourceHandle::TestingCancelOnDrain(p) => {
                p.on_cancel();
            }
            // Remaining variants leave `on_ready` at the trait default (no-op).
            SourceHandle::Subprocess(_) => {}
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
            | SourceHandle::HTMLRewriter(_)
            | SourceHandle::TestingCancelOnDrain(_) => {}
        }
    }

    pub fn start(self) {
        match self {
            SourceHandle::FetchResponseBody(p) => p.on_start(),
            SourceHandle::S3DownloadBody(p) => p.on_consumer_attached(),
            // Remaining variants leave `on_start` at the trait default (no-op).
            SourceHandle::None
            | SourceHandle::JSController(_)
            | SourceHandle::ServerRequestBody(_)
            | SourceHandle::ByteStream(_)
            | SourceHandle::FileReader(_)
            | SourceHandle::Subprocess(_)
            | SourceHandle::HTMLRewriter(_)
            | SourceHandle::TestingCancelOnDrain(_) => {}
        }
    }

    /// `.text()` or one of its friends waits for the whole of a pending body, which this call can settle.
    pub(crate) fn start_buffering(self) {
        match self {
            SourceHandle::FetchResponseBody(p) => {
                removable_body_behind_value!(Fetch, { p.on_start_buffering() })
            }
            SourceHandle::ServerRequestBody(any) => {
                removable_body_behind_value!(Serve, { any.on_start_buffering() })
            }
            SourceHandle::HTMLRewriter(p) => {
                removable_body_behind_value!(HtmlRewriter, { p.on_start_buffering() })
            }
            SourceHandle::None
            | SourceHandle::JSController(_)
            | SourceHandle::ByteStream(_)
            | SourceHandle::FileReader(_)
            | SourceHandle::Subprocess(_)
            | SourceHandle::S3DownloadBody(_)
            | SourceHandle::TestingCancelOnDrain(_) => {}
        }
    }

    /// A pending body is about to become a stream, which starts with the result.
    pub(crate) fn start_streaming(self) -> DrainResult {
        match self {
            SourceHandle::FetchResponseBody(p) => {
                removable_body_behind_value!(Fetch, { p.on_start_streaming() })
            }
            SourceHandle::ServerRequestBody(any) => {
                removable_body_behind_value!(Serve, { any.on_start_streaming_request_body() })
            }
            SourceHandle::HTMLRewriter(p) => {
                removable_body_behind_value!(HtmlRewriter, { p.on_start_streaming() })
            }
            SourceHandle::None
            | SourceHandle::JSController(_)
            | SourceHandle::ByteStream(_)
            | SourceHandle::FileReader(_)
            | SourceHandle::Subprocess(_)
            | SourceHandle::S3DownloadBody(_)
            | SourceHandle::TestingCancelOnDrain(_) => DrainResult::EstimatedSize(0),
        }
    }

    pub(crate) fn readable_stream_available(
        self,
        global: &JSGlobalObject,
        readable: ReadableStream,
    ) {
        match self {
            SourceHandle::FetchResponseBody(p) => {
                removable_body_behind_value!(Fetch, { p.on_readable_stream_available(readable) })
            }
            SourceHandle::ServerRequestBody(any) => removable_body_behind_value!(Serve, {
                any.on_request_body_readable_stream_available(global, readable)
            }),
            SourceHandle::HTMLRewriter(p) => removable_body_behind_value!(HtmlRewriter, {
                p.on_readable_stream_available(global, readable)
            }),
            SourceHandle::None
            | SourceHandle::JSController(_)
            | SourceHandle::ByteStream(_)
            | SourceHandle::FileReader(_)
            | SourceHandle::Subprocess(_)
            | SourceHandle::S3DownloadBody(_)
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

/// Serves HTTP/1.1, HTTP/2 and HTTP/3 alike, through `uws::AnyResponse`.
#[derive(bun_ptr::RefCounted)]
#[ref_count(destroy = Self::destroy)]
pub(crate) struct HTTPServerWritable {
    /// [`HTTPServerWritableOwnerRef`], the controller's ref, and scoped `RefPtr`s.
    ref_count: RefCount,
    /// Selects the name and the `sinkId` that the controller reports.
    pub(crate) is_ssl: bool,
    pub(crate) res: Cell<Option<uws::AnyResponse>>,
    buffer: Cell<Vec<u8>>,
    /// `finalize` or [`HTTPServerWritableOwnerRef`] returns it to `ByteListPool`.
    pooled_buffer: Cell<Option<Box<ByteListPoolNode>>>,

    pub(crate) wrote: Cell<BlobSizeType>,

    // allocator field dropped — global mimalloc per §Allocators
    state: Cell<HTTPServerWritableState>,
    pub(crate) source: Cell<SourceHandle>,
    /// The controller cell, rooted until [`HTTPServerWritableOwnerRef`] drops; it holds the `flush(true)` / `end()` promise ([`Self::pending_flush`]).
    pub(crate) pipe: PipeCell,
    /// Backpressure promise returned from `write()` to a JS controller (direct
    /// stream `pull` or `readStreamIntoSink`). Resolved on drain via
    /// `flush_promise()` → `pending.run()`.
    pending: WritablePending,
    wrote_at_start_of_flush: Cell<BlobSizeType>,
    // JSC_BORROW: process-lifetime VM global. Safe `Deref` via `BackRef`.
    pub global_this: BackRef<JSGlobalObject>,
    high_water_mark: Cell<BlobSizeType>,

    requested_end: Cell<bool>,

    has_backpressure: Cell<bool>,
    /// `write()` returned `Backpressure` to the upstream source (so it is
    /// parked on the sink). `on_writable` fires `source.ready()` only when
    /// this is set; a drain that merely follows `flush()`/auto-flush must not
    /// re-invoke a direct-stream `pull`. Same pattern as
    /// `FileSink::source_pending_pull`.
    source_pending_pull: Cell<bool>,
    end_len: Cell<usize>,
    /// This sink fully ended the uWS response (`res.end()` / a completed
    /// `res.try_end()`). On HTTP/1 that drops `onAborted`, so the owning
    /// `RequestContext` is never told the peer went away and must not
    /// dereference `resp` again: uSockets may have freed or recycled the
    /// socket by the time the stream reaction runs. `handle_resolve_stream` /
    /// `handle_reject_stream` read this instead of the response state, and
    /// act on it only for HTTP/1. An H2/H3 `resp` is still alive there, and
    /// `on_abort` ends those requests when the transport frees the stream.
    pub(crate) ended_response: Cell<bool>,

    pub(crate) auto_flusher: AutoFlusher,
}

impl Drop for HTTPServerWritable {
    fn drop(&mut self) {
        bun_core::scoped_log!(HTTPServerWritableLog, "drop()");
        self.unregister_auto_flusher();
    }
}

/// The `RequestContext`'s ref, dropped after it detached the controller, whose ref lasts until that is collected.
pub(crate) struct HTTPServerWritableOwnerRef(pub(crate) RefPtr<HTTPServerWritable>);

impl Deref for HTTPServerWritableOwnerRef {
    type Target = HTTPServerWritable;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl Drop for HTTPServerWritableOwnerRef {
    fn drop(&mut self) {
        // A `write()` that is still parked: not every teardown goes through `flush_promise`.
        self.pending.run_done();
        self.mark_done();
        // Still checked out if `finalize` has not run (`assign_to_stream` failed).
        self.release_pooled_buffer();
        self.buffer.take();
        drop(self.pipe.take());
    }
}

impl HTTPServerWritable {
    pub(crate) fn new(
        res: uws::AnyResponse,
        is_ssl: bool,
        global_this: &JSGlobalObject,
    ) -> RefPtr<Self> {
        RefPtr::new(Self {
            ref_count: RefCount::init(),
            is_ssl,
            res: Cell::new(Some(res)),
            buffer: Cell::default(),
            pooled_buffer: Cell::new(None),
            wrote: Cell::new(0),
            state: Cell::new(HTTPServerWritableState::Writing),
            source: Cell::default(),
            pipe: PipeCell::default(),
            pending: WritablePending::default(),
            wrote_at_start_of_flush: Cell::new(0),
            global_this: BackRef::new(global_this),
            high_water_mark: Cell::new(2048),
            requested_end: Cell::new(false),
            has_backpressure: Cell::new(false),
            source_pending_pull: Cell::new(false),
            end_len: Cell::new(0),
            ended_response: Cell::new(false),
            auto_flusher: AutoFlusher::default(),
        })
    }

    /// Keeps the drop glue out of a build without the feature.
    fn destroy(last: AliasableBox<Self>) {
        removable_body_behind_value!(Serve, { drop(last) })
    }

    /// Don't include @sizeOf(This) because it's already included in the memoryCost of the sink
    pub(crate) fn memory_cost(&self) -> usize {
        // TODO: include Socket send buffer size. We can't here because we
        // don't track if it's still accessible.
        // Since this is a JSSink, the NewJSSink function does @sizeOf(JSSink) which includes @sizeOf(ArrayBufferSink).
        self.buffer.capacity()
    }

    #[inline]
    fn any_res(&self) -> Option<uws::AnyResponse> {
        self.res.get()
    }

    fn handle_wrote(&self, amount: usize) {
        self.wrote.update(|wrote| wrote + amount as BlobSizeType);
        bun_core::scoped_log!(HTTPServerWritableLog, "handleWrote: {}", amount);
    }

    pub(crate) fn is_done(&self) -> bool {
        self.state.get() != HTTPServerWritableState::Writing
    }

    pub(crate) fn is_aborted(&self) -> bool {
        self.state.get() == HTTPServerWritableState::Aborted
    }

    /// `Aborted` is already done and stays `Aborted`; callers still read
    /// `is_aborted()` afterwards.
    pub(crate) fn set_done(&self) {
        if self.state.get() == HTTPServerWritableState::Writing {
            self.state.set(HTTPServerWritableState::Done);
        }
    }

    pub(crate) fn has_backpressure(&self) -> bool {
        self.has_backpressure.get()
    }

    fn has_backpressure_and_is_try_end(&self) -> bool {
        self.has_backpressure.get() && self.end_len.get() > 0
    }

    /// uWS `end()`/`try_end()` just completed; `res` is still live here, so release the request-body pause too.
    fn mark_response_ended(&self, res: uws::AnyResponse) {
        self.has_backpressure.set(false);
        self.ended_response.set(true);
        res.resume();
    }

    /// `len` bytes were accepted by `send`/`send_readable`. When uWS reports
    /// the socket is now backed up, return a pending Promise for JS-controller
    /// sources (direct-stream `pull` can `await controller.write()`; the
    /// `readStreamIntoSink` pump treats a pending promise the same as the
    /// negative sentinel). Native ByteStream/FileReader pumps match on
    /// `Backpressure` directly, so keep that variant for them. `on_writable`
    /// drains via `flush_promise()` → `pending.run()` and `source.ready()`.
    #[inline]
    fn writable_result(&self, len: BlobSizeType) -> Writable<'_> {
        if self.has_backpressure.get() && !self.is_done() && !self.requested_end.get() {
            self.source_pending_pull.set(true);
            if matches!(
                self.source.get(),
                SourceHandle::ByteStream(_) | SourceHandle::FileReader(_)
            ) {
                return Writable::Backpressure(len);
            }
            return self.pending.park(len);
        }
        Writable::Owned(len)
    }

    /// `false`: what uWS did not take of `buf` has to be sent again.
    fn send_without_auto_flusher(&self, buf: &[u8]) -> bool {
        debug_assert!(!self.is_done());

        let Some(res) = self.any_res() else {
            bun_core::scoped_log!(
                HTTPServerWritableLog,
                "send: {} bytes (backpressure: {})",
                buf.len(),
                self.has_backpressure()
            );
            return false;
        };

        if self.requested_end.get() && !res.state().is_http_write_called() {
            let success = res.try_end(buf, self.end_len.get(), false);
            if success {
                self.mark_response_ended(res);
            } else if self.any_res().is_some() {
                self.has_backpressure.set(true);
            }
            bun_core::scoped_log!(
                HTTPServerWritableLog,
                "send: {} bytes (backpressure: {})",
                buf.len(),
                self.has_backpressure()
            );
            return success;
        }
        // clean this so we know when its relevant or not
        self.end_len.set(0);
        // uWS has no tryWrite(): write() always accepts the buffer (queuing the
        // unsent tail internally) and reports whether the socket is now backed
        // up. Track that so the JS writer can pause; the owning RequestContext
        // holds the on_writable registration and forwards the drain to
        // `on_writable()` below.
        if self.requested_end.get() {
            res.end(buf, false);
            self.mark_response_ended(res);
        } else {
            self.has_backpressure
                .set(matches!(res.write(buf), uws::WriteResult::Backpressure(_)));
        }
        bun_core::scoped_log!(
            HTTPServerWritableLog,
            "send: {} bytes (backpressure: {})",
            buf.len(),
            self.has_backpressure()
        );
        true
    }

    /// Only while `buffer` is empty.
    fn send(&self, buf: &[u8]) -> bool {
        self.unregister_auto_flusher();
        let success = self.send_without_auto_flusher(buf);
        if success {
            self.handle_wrote(buf.len());
        }
        success
    }

    /// Sends `buffer` past its first `from` bytes.
    fn send_readable(&self, from: usize) -> bool {
        self.unregister_auto_flusher();
        self.send_readable_without_auto_flusher(from)
    }

    fn send_readable_without_auto_flusher(&self, from: usize) -> bool {
        self.buffer.with_taken(|buffer| {
            let success = self.send_without_auto_flusher(&buffer[from..]);
            if success {
                // uWS took the `from` bytes in an earlier partial `try_end`; it now owns the whole slice.
                self.handle_wrote(buffer.len());
                buffer.clear();
            }
            success
        })
    }

    pub(crate) fn buffered_len(&self) -> usize {
        self.buffer.len()
    }

    pub(crate) fn on_writable(&self, write_offset: u64, _res: uws::AnyResponse) -> bool {
        // write_offset is the amount of data that was written not how much we need to write
        bun_core::scoped_log!(HTTPServerWritableLog, "onWritable ({})", write_offset);
        // onWritable reset backpressure state to allow flushing
        self.has_backpressure.set(false);
        if self.is_aborted() {
            self.source.get().close(None);
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
        if self.buffered_len() == 0 {
            if self.is_done() {
                self.source_pending_pull.set(false);
                self.source.get().close(None);
                self.flush_promise();
                self.finalize();
                return true;
            }
            let had_flush_waiter = self.pending_flush().is_some();
            self.flush_promise();
            if self.source_pending_pull.take()
                && !had_flush_waiter
                && !self.is_done()
                && !self.requested_end.get()
                && !self.has_backpressure()
            {
                self.source.get().ready(None, None);
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
        let chunk_start = if self.end_len.get() > 0 {
            // do not write more than available
            (write_offset as BlobSizeType).min(self.buffered_len() as BlobSizeType - 1) as usize
        } else {
            0
        };
        let chunk_len = self.buffered_len().saturating_sub(chunk_start);
        // if we have nothing to write, we are done
        if chunk_len == 0 {
            if self.is_done() {
                self.source.get().close(None);
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

            if self.requested_end.get() {
                debug_assert!(self.ended_response.get());
                if let Some(res) = self.any_res() {
                    res.clear_on_writable();
                }
                self.source.get().close(None);
                self.flush_promise();
                self.finalize();
                return true;
            }
        }

        // flush the javascript promise from calling .flush()
        let had_flush_waiter = self.pending_flush().is_some();
        self.flush_promise();

        // pending_flush or callback could have caused another send()
        // so we check again if we should report readiness
        let had_pending_pull = self.source_pending_pull.take();
        if !self.is_done() && !self.requested_end.get() && !self.has_backpressure() {
            if (total_written > 0 || (had_pending_pull && !had_flush_waiter))
                && self.buffered_len() == 0
            {
                self.source
                    .get()
                    .ready(Some(total_written as BlobSizeType), None);
            }
        }

        true
    }

    pub(crate) fn start(&self, stream_start: &Start) -> bun_sys::Result<()> {
        if self.is_aborted() || self.any_res().is_none_or(|res| res.has_responded()) {
            self.mark_done();
            self.source.get().close(None);
            return bun_sys::Result::Ok(());
        }

        self.wrote.set(0);
        self.wrote_at_start_of_flush.set(0);
        self.flush_promise();

        if let &Start::ChunkSize(chunk_size) = stream_start {
            if chunk_size > 0 {
                self.high_water_mark.set(chunk_size);
            }
        }

        let reserved = self.buffer.with_taken(|buffer| {
            if buffer.capacity() == 0 {
                debug_assert!(self.pooled_buffer.is_none());
                if FeatureFlags::HTTP_BUFFER_POOLING {
                    if let Some(mut pooled_node) = ByteListPool::get_if_exists() {
                        *buffer = core::mem::take(&mut pooled_node.data);
                        self.pooled_buffer.set(Some(pooled_node));
                    }
                }
            }

            buffer.clear();
            buffer.try_reserve_exact(self.high_water_mark.get() as usize)
        });
        if reserved.is_err() {
            return Err(SysError::oom());
        }

        self.state.set(HTTPServerWritableState::Writing);
        self.source.get().start();
        bun_core::scoped_log!(
            HTTPServerWritableLog,
            "start({})",
            self.high_water_mark.get()
        );
        bun_sys::Result::Ok(())
    }

    fn flush_from_js_no_wait(&self) -> bun_sys::Result<JSValue> {
        bun_core::scoped_log!(HTTPServerWritableLog, "flushFromJSNoWait");
        bun_sys::Result::Ok(JSValue::from(self.flush_no_wait()))
    }

    pub(crate) fn flush_no_wait(&self) -> usize {
        if self.has_backpressure_and_is_try_end() || self.is_done() {
            return 0;
        }

        let slice_len = self.buffered_len();
        if slice_len == 0 {
            return 0;
        }

        if self.send_readable(0) {
            return slice_len;
        }

        0
    }

    pub(crate) fn flush_from_js(
        &self,
        cx: &bun_jsc::JsThread<'_>,
        wait: bool,
    ) -> bun_sys::Result<JSValue> {
        bun_core::scoped_log!(HTTPServerWritableLog, "flushFromJS({})", wait);
        self.unregister_auto_flusher();

        if !wait {
            return self.flush_from_js_no_wait();
        }

        if let Some(prom) = self.pending_flush() {
            // A prior `flush(true)` is already waiting on the drain. Push any
            // data buffered since (below highWaterMark) so it reaches uWS now
            // rather than when `on_writable` fires.
            if self.end_len.get() == 0 && !self.is_done() && self.buffered_len() > 0 {
                let _ = self.send_readable(0);
            }
            return bun_sys::Result::Ok(prom);
        }

        if self.is_done() {
            return bun_sys::Result::Ok(JSPromise::resolved_promise_value(
                cx.global(),
                JSValue::from(0i32),
            ));
        }

        if !self.has_backpressure_and_is_try_end() {
            let slice_len = self.buffered_len();
            if slice_len > 0 {
                let _ = self.send_readable(0);
            }
            // Only resolve once the socket has actually accepted everything;
            // otherwise fall through and let on_writable resolve the promise.
            if !self.has_backpressure.get() {
                return bun_sys::Result::Ok(JSPromise::resolved_promise_value(
                    cx.global(),
                    JSValue::from(slice_len),
                ));
            }
        }
        self.wrote_at_start_of_flush.set(self.wrote.get());
        bun_sys::Result::Ok(self.park_pending_flush(cx.global()))
    }

    pub(crate) fn write(&self, data: &StreamResult<'_>) -> Writable<'_> {
        if self.is_done() || self.requested_end.get() {
            return Writable::Owned(0);
        }

        let bytes = data.slice();
        let len = bytes.len() as BlobSizeType;
        bun_core::scoped_log!(HTTPServerWritableLog, "write({})", bytes.len());

        let buffered = self.buffered_len() as BlobSizeType;
        // Otherwise queue the data until highWaterMark is reached or the auto flusher kicks in
        let mut do_send = buffered + len >= self.high_water_mark.get();
        if buffered == 0 && do_send {
            // fast path:
            // - large-ish chunk
            // - no backpressure
            if self.send(bytes) {
                return self.writable_result(len);
            }
            do_send = false;
        }

        // TODO: attempt to write both in a corked buffer?
        self.buffer.extend_from_slice(bytes);
        if !(do_send && self.send_readable(0)) {
            self.register_auto_flusher();
        }

        self.writable_result(len)
    }

    pub(crate) fn write_latin1(&self, data: &StreamResult<'_>) -> Writable<'_> {
        if self.is_done() || self.requested_end.get() {
            return Writable::Owned(0);
        }

        if self.any_res().is_none_or(|res| res.has_responded()) {
            self.source.get().close(None);
            self.mark_done();
            return Writable::Done;
        }

        let bytes = data.slice();
        let len = bytes.len() as BlobSizeType;
        bun_core::scoped_log!(HTTPServerWritableLog, "writeLatin1({})", bytes.len());

        let buffered = self.buffered_len() as BlobSizeType;
        let mut do_send = buffered + len >= self.high_water_mark.get();
        // common case
        if buffered == 0 && do_send && strings::is_all_ascii(bytes) {
            // fast path: large-ish chunk, no backpressure
            if self.send(bytes) {
                return self.writable_result(len);
            }
            do_send = false;
        }

        append_latin1(&self.buffer, bytes);
        if !(do_send && self.send_readable(0)) {
            self.register_auto_flusher();
        }

        self.writable_result(len)
    }

    pub(crate) fn write_utf16(&self, text: &[u16]) -> Writable<'_> {
        if self.is_done() || self.requested_end.get() {
            return Writable::Owned(0);
        }

        if self.any_res().is_none_or(|res| res.has_responded()) {
            self.source.get().close(None);
            self.mark_done();
            return Writable::Done;
        }

        bun_core::scoped_log!(HTTPServerWritableLog, "writeUTF16({})", size_of_val(text));

        // we must always buffer UTF-16
        // we assume the case of all-ascii UTF-16 string is pretty uncommon
        let written = append_utf16(&self.buffer, text);

        let do_send =
            self.buffered_len() >= self.high_water_mark.get() as usize || self.has_backpressure();
        if !(do_send && self.send_readable(0)) {
            self.register_auto_flusher();
        }
        self.writable_result(written as BlobSizeType)
    }

    pub(crate) fn mark_done(&self) {
        self.set_done();
        self.unregister_auto_flusher();
    }

    /// `controller.close()`: flush and end like `controller.end()`; the owner awaits any parked `pending_flush`.
    pub(crate) fn end(&self, _err: Option<SysError>) -> bun_sys::Result<()> {
        let global_this = self.global_this;
        self.finish(&global_this).map(|_| ())
    }

    /// The source failed (`close(error)`, an errored pump): drop what is buffered and finish the sink; the owner closes the response as incomplete.
    pub(crate) fn fail(&self) {
        bun_core::scoped_log!(HTTPServerWritableLog, "fail()");

        if self.requested_end.get() {
            return;
        }

        self.buffer.clear();
        self.source.get().close(None);
        self.mark_done();
        self.finalize();
    }

    pub(crate) fn end_from_js(&self, cx: &bun_jsc::JsThread<'_>) -> bun_sys::Result<JSValue> {
        self.finish(cx.global())
    }

    fn finish(&self, global_this: &JSGlobalObject) -> bun_sys::Result<JSValue> {
        bun_core::scoped_log!(HTTPServerWritableLog, "endFromJS()");

        if self.requested_end.get() {
            return bun_sys::Result::Ok(JSValue::from(0i32));
        }

        if self.is_done() || self.any_res().is_none_or(|res| res.has_responded()) {
            self.requested_end.set(true);
            self.source.get().close(None);
            self.mark_done();
            self.finalize();
            return bun_sys::Result::Ok(JSValue::from(0i32));
        }

        self.requested_end.set(true);
        let readable_len = self.buffered_len();
        self.end_len.set(readable_len);

        if readable_len > 0 {
            if !self.send_readable(0) {
                return bun_sys::Result::Ok(self.park_pending_flush(global_this));
            }
        } else if let Some(res) = self.any_res() {
            res.end(b"", false);
            self.mark_response_ended(res);
        }

        debug_assert!(self.ended_response.get());
        self.mark_done();
        self.flush_promise();
        self.source.get().close(None);
        self.finalize();

        bun_sys::Result::Ok(JSValue::from(self.wrote.get()))
    }

    /// The response is gone, so this sink never writes again. [`Self::abort`] tells the source.
    pub(crate) fn revoke_response(&self) {
        self.state.set(HTTPServerWritableState::Aborted);
        self.res.set(None);
        self.unregister_auto_flusher();
    }

    pub(crate) fn abort(&self) {
        bun_core::scoped_log!(HTTPServerWritableLog, "onAborted()");
        self.revoke_response();
        self.flush_promise();
        self.finalize();
        self.source.get().abort(CommonAbortReason::ConnectionClosed);
    }

    fn unregister_auto_flusher(&self) {
        if self.auto_flusher.registered.get() {
            let vm = self.global_this.bun_vm();
            AutoFlusher::unregister_deferred_microtask_with_type_unchecked::<Self>(self, vm);
        }
    }

    fn register_auto_flusher(&self) {
        let Some(res) = self.any_res() else { return };
        // Reset per-enqueue so a long stream of
        // sub-highWaterMark writes between auto-flushes still bumps the idle
        // timeout.
        res.reset_timeout();
        if !self.auto_flusher.registered.get() {
            let vm = self.global_this.bun_vm();
            AutoFlusher::register_deferred_microtask_with_type_unchecked::<Self>(self, vm);
        }
    }

    pub(crate) fn on_auto_flush(&self) -> bool {
        bun_core::scoped_log!(HTTPServerWritableLog, "onAutoFlush()");
        if self.is_done() {
            self.auto_flusher.registered.set(false);
            return false;
        }

        let readable_len = self.buffered_len();

        if self.has_backpressure_and_is_try_end() || readable_len == 0 {
            self.auto_flusher.registered.set(false);
            return false;
        }

        if !self.send_readable_without_auto_flusher(0) {
            self.auto_flusher.registered.set(true);
            return true;
        }
        self.auto_flusher.registered.set(false);

        if self.requested_end.get() {
            debug_assert!(self.ended_response.get());
            if let Some(res) = self.any_res() {
                res.clear_on_writable();
            }
            self.source.get().close(None);
            self.flush_promise();
            self.finalize();
        }
        false
    }

    /// Hand the pool checkout back with the (emptied) buffer; `false` when nothing was checked out.
    fn release_pooled_buffer(&self) -> bool {
        let Some(mut pooled) = self.pooled_buffer.take() else {
            return false;
        };
        pooled.data = self.buffer.take();
        pooled.data.clear();
        if pooled.data.capacity() > 64 * 1024 {
            pooled.data.clear_and_free();
        }
        ByteListPool::release(pooled);
        true
    }

    /// This can be called _many_ times for the same instance
    /// so it must zero out state instead of make it
    pub(crate) fn finalize(&self) {
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
            if !self.ended_response.get() {
                if let Some(res) = self.any_res() {
                    // is actually fine to call this if the socket is closed because of flushNoWait, the free will be defered by usockets
                    res.end_stream(false);
                }
            }
        }

        if !FeatureFlags::HTTP_BUFFER_POOLING {
            debug_assert!(self.pooled_buffer.is_none());
        }

        if self.release_pooled_buffer() || self.buffer.capacity() == 0 {
            return;
        }
        if FeatureFlags::HTTP_BUFFER_POOLING && !ByteListPool::full() {
            ByteListPool::push(self.buffer.take());
        } else {
            // Don't release this buffer until `HTTPServerWritableOwnerRef` is dropped
            self.buffer.clear();
        }
    }

    /// The unsettled `flush(true)` / `end()` promise, held by the controller cell.
    pub(crate) fn pending_flush(&self) -> Option<JSValue> {
        self.pipe.done()
    }

    pub(crate) fn take_pending_flush(&self) -> Option<JSValue> {
        self.pipe.take_done()
    }

    fn park_pending_flush(&self, global_this: &JSGlobalObject) -> JSValue {
        // end() while a flush(true) waits on the same drain: one promise settles both.
        if let Some(parked) = self.pending_flush() {
            return parked;
        }
        let promise = JSPromise::create(global_this).to_js();
        self.pipe.set_done(promise);
        promise
    }

    /// Settle a parked `write()` and the pending `flush(true)`/`end()` promise.
    /// Terminal like the settle primitives (`Pending::run`): both resolve with
    /// values built here.
    pub(crate) fn flush_promise(&self) {
        // Settle any `write()` → `Pending` promise first so a parked JS writer
        // wakes on every drain/teardown path that reaches here.
        self.pending.run();
        if let Some(flush) = self.take_pending_flush()
            && let Some(prom) = flush.as_promise()
        {
            bun_core::scoped_log!(HTTPServerWritableLog, "flushPromise()");

            let global_this = self.global_this.get();
            let _keep = ::bun_jsc::EnsureStillAlive(flush);
            let result = prom.resolve(
                global_this,
                JSValue::js_number(
                    self.wrote
                        .get()
                        .saturating_sub(self.wrote_at_start_of_flush.get())
                        as f64,
                ),
            );
            self.wrote_at_start_of_flush.set(self.wrote.get());
            crate::dispatch::fold(result);
        }
    }
}

impl crate::webcore::sink::JsSinkType for HTTPServerWritable {
    const NAME: &'static str = "HTTPResponseSink";

    crate::impl_js_sink_forwarders!();

    fn end_from_js(&self, cx: &bun_jsc::JsThread<'_>) -> bun_sys::Result<JSValue> {
        Self::end_from_js(self, cx)
    }
}

impl crate::webcore::sink::ControlledSink for HTTPServerWritable {
    fn to_any_sink(this: RefPtr<Self>) -> AnyControlledSink {
        AnyControlledSink::HTTPServerWritable(this)
    }

    fn controller_finalize(&self) {
        self.finalize();
    }

    fn close_with_error(&self, _global: &JSGlobalObject, _reason: JSValue) -> bun_sys::Result<()> {
        self.fail();
        bun_sys::Result::Ok(())
    }
    fn controller_created(&self, controller: JSValue, global: &JSGlobalObject) {
        self.pipe.root(controller, global);
    }
    fn source(&self) -> &Cell<SourceHandle> {
        &self.source
    }
}

// ──────────────────────────────────────────────────────────────────────────
// NetworkSink
// ──────────────────────────────────────────────────────────────────────────

#[derive(bun_ptr::RefCounted)]
#[ref_count(destroy = Self::destroy)]
pub(crate) struct NetworkSink {
    ref_count: RefCount,
    /// The sink's ref on the upload.
    task: Cell<Option<RefPtr<bun_s3::MultiPartUpload>>>,
    pub(crate) source: Cell<SourceHandle>,
    // JSC_BORROW: process-lifetime VM global; safe `Deref` via `BackRef`.
    global_this: BackRef<JSGlobalObject>,
    /// Pending `flush()` promise. Serves both the user `s3file.writer().flush()`
    /// API and the `readDirectStream` / `BunAsyncIterableSource` pump, which
    /// parks on `controller.flush(true)` (not the sink's onReady) on backpressure.
    /// Resolved by `on_writable`. The `readStreamIntoSink` pump no longer calls
    /// `flush()` — it resumes via `source.ready()` → the sink's onReady — so no promise
    /// is allocated on that path.
    pub(crate) flush_promise: Cell<Option<JSPromiseStrong>>,
    /// Backpressure promise returned from `write()` to a JS controller;
    /// resolved by `on_writable` → `pending.run()`.
    pub(crate) pending: WritablePending,
    pub(crate) end_promise: Cell<Option<JSPromiseStrong>>,
    /// Upstream ByteStream error stashed by `end_from_stream` so the upload
    /// failure callback can reject with the original JS error (e.g. S3
    /// `NoSuchKey`) instead of the generic `UnknownError` passed to `fail()`.
    pub(crate) upstream_error: StrongCell,
    pub(crate) ended: Cell<bool>,
    pub(crate) done: Cell<bool>,
}

impl NetworkSink {
    pub(crate) fn new(
        task: RefPtr<bun_s3::MultiPartUpload>,
        global_this: &JSGlobalObject,
    ) -> RefPtr<Self> {
        RefPtr::new(Self {
            ref_count: RefCount::init(),
            task: Cell::new(Some(task)),
            source: Cell::default(),
            global_this: BackRef::new(global_this),
            flush_promise: Cell::new(None),
            pending: WritablePending::default(),
            end_promise: Cell::new(None),
            upstream_error: StrongCell::default(),
            ended: Cell::new(false),
            done: Cell::new(false),
        })
    }

    pub(crate) fn start(&self, _stream_start: &Start) -> bun_sys::Result<()> {
        if self.ended.get() {
            return bun_sys::Result::Ok(());
        }

        self.source.get().start();
        bun_sys::Result::Ok(())
    }

    /// Keeps the drop glue out of a build without the feature.
    fn destroy(last: AliasableBox<Self>) {
        removable_body_behind_value!(S3Client, { drop(last) })
    }

    fn task(&self) -> Option<RefPtr<bun_s3::MultiPartUpload>> {
        self.with_task(RefPtr::clone)
    }

    /// `f` must not run script: `task` is `None` meanwhile.
    fn with_task<R>(&self, f: impl FnOnce(&RefPtr<bun_s3::MultiPartUpload>) -> R) -> Option<R> {
        self.task.with_taken(|task| task.as_ref().map(f))
    }

    fn detach_writable(&self) {
        self.task.set(None);
    }

    /// The stream upload is done with the sink, which its controller holds until it is collected.
    pub(crate) fn detach(&self) {
        self.source.take().detach(&self.global_this);
        self.detach_writable();
        self.flush_promise.set(None);
        self.pending.clear();
        self.end_promise.set(None);
        self.upstream_error.clear();
    }

    /// The `writer()` wrapper was collected before `end()`: nothing can finish the upload, so fail it.
    fn abort_on_collect(&self) {
        if self.ended.get() {
            return;
        }
        self.ended.set(true);
        self.done.set(true);
        if let Some(task) = self.task.take() {
            bun_s3::MultiPartUpload::fail_writer_collected(task);
        }
    }

    /// The S3 upload drained: settle the flush/write promises (terminal, like
    /// `flush_promise`) and wake the source.
    pub(crate) fn on_writable(&self, task: &bun_s3::MultiPartUpload, flushed: u64) {
        bun_core::scoped_log!(
            NetworkSinkLog,
            "onWritable flushed: {} state: {}",
            flushed,
            task.state.get() as u8
        );
        if let Some(mut flush_promise) = self.flush_promise.take() {
            let flushed =
                flush_promise.resolve(&self.global_this, JSValue::js_number(flushed as f64));
            crate::dispatch::fold(flushed);
        }
        self.pending.run();
        // Wake the upstream source (JS controller onPull or native ByteStream
        // resume). No-op when `source` is `None` (the `writer()` path).
        self.source.get().ready(None, None);
    }

    /// The upload of a `writer()` finished. `self.task` may already be `None`.
    pub(crate) fn on_finished(
        &self,
        task: &bun_s3::MultiPartUpload,
        result: bun_s3::S3UploadResult,
    ) -> JsResult<()> {
        let global = &*task.global_this;
        if self.end_promise.is_some() || self.flush_promise.is_some() {
            let _exit_guard = global.bun_vm().enter_event_loop_scope();
            match result {
                bun_s3::S3UploadResult::Success => {
                    if let Some(mut flush_promise) = self.flush_promise.take() {
                        flush_promise.resolve(global, JSValue::js_number(0.0))?;
                    }
                    if let Some(mut end_promise) = self.end_promise.take() {
                        end_promise.resolve(
                            global,
                            JSValue::js_number(task.uploaded_bytes.get() as f64),
                        )?;
                    }
                }
                bun_s3::S3UploadResult::Failure(err) => {
                    let js_err = bun_s3::s3_error_to_js(&err, global, Some(&task.path));
                    if let Some(mut flush_promise) = self.flush_promise.take() {
                        flush_promise.reject(global, Ok(js_err))?;
                    }
                    if let Some(mut end_promise) = self.end_promise.take() {
                        end_promise.reject(global, Ok(js_err))?;
                    }
                    if !self.done.get() {
                        self.abort();
                    }
                }
            }
        }
        self.detach_writable();
        Ok(())
    }

    pub(crate) fn flush_from_js(
        &self,
        cx: &bun_jsc::JsThread<'_>,
        _wait: bool,
    ) -> bun_sys::Result<JSValue> {
        let has_queued_parts = || !self.with_task(|t| t.is_queue_empty()).unwrap_or(true);
        let promise = self.flush_promise.with_taken(|promise| {
            if promise.is_none() && !self.done.get() && has_queued_parts() {
                *promise = Some(JSPromiseStrong::init(cx.global()));
            }
            promise.as_ref().map(JSPromiseStrong::value)
        });
        bun_sys::Result::Ok(promise.unwrap_or_else(|| {
            JSPromise::resolved_promise_value(cx.global(), JSValue::js_number(0.0))
        }))
    }

    pub(crate) fn abort(&self) {
        self.ended.set(true);
        self.done.set(true);
        self.pending.run_done();
        self.source.get().close(None);
        self.detach_writable();
    }

    pub(crate) fn write(&self, data: &StreamResult<'_>) -> Writable<'_> {
        if self.ended.get() {
            return Writable::Owned(0);
        }
        let bytes = data.slice();
        let len = bytes.len() as BlobSizeType;
        let result =
            self.with_task(|task| bun_s3::MultiPartUpload::write_bytes(task, bytes, false));
        let Some(result) = result else {
            return Writable::Owned(len);
        };
        // Direct `.writer()` (no source) exposes `write()` as `number`; only
        // the pump paths consume `Backpressure`/`Done`.
        match (result, self.source.get()) {
            (Err(_), _) => Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write)),
            (Ok(bun_s3::UploadBackpressure::WantMore), _) | (_, SourceHandle::None) => {
                Writable::Owned(len)
            }
            (Ok(bun_s3::UploadBackpressure::Done), _) => Writable::Done,
            (Ok(bun_s3::UploadBackpressure::Backpressure), SourceHandle::ByteStream(_)) => {
                Writable::Backpressure(len)
            }
            (Ok(bun_s3::UploadBackpressure::Backpressure), _) => self.pending.park(len),
        }
    }

    pub(crate) fn write_latin1(&self, data: &StreamResult<'_>) -> Writable<'_> {
        if self.ended.get() {
            return Writable::Owned(0);
        }

        let bytes = data.slice();
        let len = bytes.len() as BlobSizeType;
        let has_source = !matches!(self.source.get(), SourceHandle::None);

        let result =
            self.with_task(|task| bun_s3::MultiPartUpload::write_latin1(task, bytes, false));
        let Some(result) = result else {
            return Writable::Owned(len);
        };
        match result {
            Ok(bun_s3::UploadBackpressure::Backpressure) if has_source => self.pending.park(len),
            Ok(bun_s3::UploadBackpressure::Done) if has_source => Writable::Done,
            Ok(_) => Writable::Owned(len),
            Err(_) => Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write)),
        }
    }

    pub(crate) fn write_utf16(&self, text: &[u16]) -> Writable<'_> {
        if self.ended.get() {
            return Writable::Owned(0);
        }
        let len = size_of_val(text) as BlobSizeType;
        let has_source = !matches!(self.source.get(), SourceHandle::None);
        // we must always buffer UTF-16
        // we assume the case of all-ascii UTF-16 string is pretty uncommon
        let result = self.with_task(|task| bun_s3::MultiPartUpload::write_utf16(task, text, false));
        let Some(result) = result else {
            return Writable::Owned(len);
        };
        match result {
            Ok(bun_s3::UploadBackpressure::Backpressure) if has_source => self.pending.park(len),
            Ok(bun_s3::UploadBackpressure::Done) if has_source => Writable::Done,
            Ok(_) => Writable::Owned(len),
            Err(_) => Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write)),
        }
    }

    pub(crate) fn end(&self, err: Option<SysError>) -> bun_sys::Result<()> {
        if self.ended.get() {
            return bun_sys::Result::Ok(());
        }

        // send EOF
        self.ended.set(true);
        self.pending.run_done();
        // flush everything and send EOF
        if let Some(task) = self.task() {
            let _ = bun_s3::MultiPartUpload::write_bytes(&task, b"", true);
            // bun.handleOom → Rust aborts on OOM
        }

        self.source.get().close(err);
        bun_sys::Result::Ok(())
    }

    /// JS-pump terminator for a source that failed. Unlike `end()`, the upload
    /// is aborted, not committed; the stashed reason becomes the caller's
    /// rejection.
    pub(crate) fn fail_from_js_pump(&self, global: &JSGlobalObject, reason: JSValue) {
        if self.ended.replace(true) {
            return;
        }
        self.done.set(true);
        self.pending.run_done();
        if !reason.is_empty_or_undefined_or_null() {
            self.upstream_error.set(global, reason);
        }
        let Some(task) = self.task() else {
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
    pub(crate) fn end_from_stream(&self, err: Option<StreamError>) {
        if self.ended.get() {
            return;
        }
        if !matches!(self.source.get(), SourceHandle::ByteStream(_)) {
            let sys_err = match err {
                Some(StreamError::Error(e)) => Some(e),
                _ => None,
            };
            let _ = self.end(sys_err);
            return;
        }
        self.ended.set(true);
        self.source.set(SourceHandle::None);
        let Some(task) = self.task() else {
            return;
        };
        if let Some(err) = &err {
            self.done.set(true);
            let js_err = err.to_js(&self.global_this);
            if !js_err.is_empty_or_undefined_or_null() {
                self.upstream_error.set(&self.global_this, js_err);
            }
        }
        if err.is_some() {
            let _ = task.fail(bun_s3_signing::error::S3Error {
                code: b"UnknownError",
                message: b"ReadableStream ended with an error",
            });
        } else {
            let _ = bun_s3::MultiPartUpload::write_bytes(&task, b"", true);
        }
    }

    pub(crate) fn end_from_js(&self, _cx: &bun_jsc::JsThread<'_>) -> bun_sys::Result<JSValue> {
        let _ = self.end(None);
        let promise = self.end_promise.with_taken(|promise| {
            if promise.is_none() && self.task.is_some() && !self.done.get() {
                // we need to wait for the task to end
                *promise = Some(JSPromiseStrong::init(&self.global_this));
            }
            promise.as_ref().map(JSPromiseStrong::value)
        });
        // `None`: task already detached
        bun_sys::Result::Ok(promise.unwrap_or_else(|| JSValue::js_number(0.0)))
    }

    pub(crate) fn to_js(this: RefPtr<Self>, global_this: &JSGlobalObject) -> JSValue {
        NetworkSinkJSSink::create_object(global_this, NetworkSinkWrapperRef(this), None)
    }

    pub(crate) fn memory_cost(&self) -> usize {
        // Since this is a JSSink, the NewJSSink function does @sizeOf(JSSink) which includes @sizeOf(ArrayBufferSink).
        //TODO: we could do better here
        self.with_task(|task| task.buffered.get().memory_cost())
            .unwrap_or(0)
    }

    pub(crate) const NAME: &'static str = "NetworkSink";
}

/// The JS wrapper's ref.
pub(crate) struct NetworkSinkWrapperRef(RefPtr<NetworkSink>);

impl Borrow<NetworkSink> for NetworkSinkWrapperRef {
    fn borrow(&self) -> &NetworkSink {
        &self.0
    }
}

impl Drop for NetworkSinkWrapperRef {
    fn drop(&mut self) {
        self.0.abort_on_collect();
        self.0.detach_writable();
    }
}

impl crate::webcore::sink::WrappedSink for NetworkSink {
    type Wrapped = NetworkSinkWrapperRef;
    fn wrapper_closed(&self) {
        self.detach_writable();
    }
}

impl crate::webcore::sink::JsSinkType for NetworkSink {
    const NAME: &'static str = Self::NAME;

    crate::impl_js_sink_forwarders!();

    fn end_from_js(&self, cx: &bun_jsc::JsThread<'_>) -> bun_sys::Result<JSValue> {
        Self::end_from_js(self, cx)
    }
}

impl crate::webcore::sink::ControlledSink for NetworkSink {
    fn to_any_sink(this: RefPtr<Self>) -> AnyControlledSink {
        AnyControlledSink::NetworkSink(this)
    }

    fn controller_finalize(&self) {
        self.detach_writable();
    }

    fn close_with_error(&self, global: &JSGlobalObject, reason: JSValue) -> bun_sys::Result<()> {
        self.fail_from_js_pump(global, reason);
        bun_sys::Result::Ok(())
    }
    fn source(&self) -> &Cell<SourceHandle> {
        &self.source
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

pub(crate) struct BufferAction {
    tag: BufferActionTag,
    promise: JSPromiseStrong,
    /// The context whose script asked (as `PendingRead`).
    context: bun_jsc::ContextId,
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
    pub(crate) fn new(tag: BufferActionTag, cx: &bun_jsc::JsThread<'_>) -> Self {
        Self {
            tag,
            promise: JSPromiseStrong::init(cx.global()),
            context: cx.context().id(),
        }
    }

    pub(crate) const fn tag(&self) -> BufferActionTag {
        self.tag
    }

    /// Settle the buffered `text()`/`json()`/`bytes()`/`blob()` promise.
    /// Terminal like the other settle primitives (`Pending::run`).
    pub(crate) fn fulfill(&mut self, global: &JSGlobalObject, blob: &mut AnyBlob) {
        let entered = global.bun_vm().enter_context(self.context);
        let settled = blob.wrap(
            &self.promise.swap(global),
            &global.js_thread(entered.context()),
            self.tag(),
        );
        crate::dispatch::fold(settled);
    }

    /// Terminal like [`fulfill`](Self::fulfill).
    pub(crate) fn reject(&mut self, global: &JSGlobalObject, err: &StreamError) {
        let _context = global.bun_vm().enter_context(self.context);
        let settled = self.promise.reject(global, Ok(err.to_js(global)));
        crate::dispatch::fold(settled);
    }

    pub(crate) fn value(&self) -> JSValue {
        self.promise.value()
    }
}

// JSPromiseStrong implements Drop, so the struct drops it automatically — no explicit
// `impl Drop for BufferAction` needed.

// ──────────────────────────────────────────────────────────────────────────
// ReadResult
// ──────────────────────────────────────────────────────────────────────────
