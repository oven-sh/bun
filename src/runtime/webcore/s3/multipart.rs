//! The JS side of an upload: feeds [`Upload`], sends its requests and settles the promises.

use core::cell::Cell;
use core::ptr::NonNull;

use bun_core::scoped_log;
use bun_io::JsKeepAlive;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{GlobalRef, JSGlobalObject, JSPromise, JSPromiseStrong, JSValue, JsCell, JsResult};
use bun_ptr::RefPtr;
use bun_s3_signing::error::S3Error;
use bun_s3_signing::upload::{Request, Step, Upload};
use bun_s3_signing::{ACL, MultiPartUploadOptions, S3Credentials, StorageClass};
use bun_sys as sys;

use crate::webcore::BlobSizeType;
use crate::webcore::readable_stream::Strong as ReadableStreamStrong;
use crate::webcore::s3::client::s3_error_to_js;
use crate::webcore::s3::simple_request::{
    Callback, Options, S3UploadResult, execute_simple_s3_request,
};
use crate::webcore::sink::{AnyControlledSink, ControlledSink, JsSinkType, WrappedSink};
use crate::webcore::streams::{
    EncodedChunk, SourceHandle, Start, StreamError, StreamResult, Writable, WritablePending,
};

bun_core::declare_scope!(S3Upload, hidden);

// (Aligned for `NativePromiseContext`, which packs its tag into the pointer's low bits.)
#[derive(bun_ptr::CellRefCounted)]
#[repr(align(16))]
pub struct NetworkSink {
    ref_count: Cell<u32>,
    /// Until the upload finishes. `source` is attached only that long.
    self_ref: JsCell<Option<RefPtr<NetworkSink>>>,
    upload: JsCell<Upload>,
    target: Target,
    poll_ref: JsKeepAlive,
    /// Fails the upload when the context of its script stops.
    abort_handle: bun_jsc::AbortHandle,
    context: bun_jsc::ContextId,
    /// Not a root: read it only in a host call, or with a promise of this realm in hand.
    global: GlobalRef,
    pub(crate) source: Cell<SourceHandle>,
    /// What `write()` returns to a JS controller under backpressure.
    pending: JsCell<WritablePending>,
    flush_promise: JsCell<JSPromiseStrong>,
    end_promise: JsCell<JSPromiseStrong>,
    owed: JsCell<Owed>,
}

pub(crate) struct Target {
    pub(crate) credentials: RefPtr<S3Credentials>,
    pub(crate) path: Box<[u8]>,
    /// As `Options::proxy_url`.
    pub(crate) proxy: Option<Box<[u8]>>,
    pub(crate) content_type: Option<Box<[u8]>>,
    pub(crate) content_disposition: Option<Box<[u8]>>,
    pub(crate) content_encoding: Option<Box<[u8]>>,
    pub(crate) acl: Option<ACL>,
    pub(crate) storage_class: Option<StorageClass>,
    pub(crate) request_payer: bool,
}

/// What is left to report besides the pending `flush()` and `end()`.
#[derive(Default)]
pub(crate) enum Owed {
    #[default]
    Nothing,
    /// The result of `upload_stream`.
    Result {
        promise: JSPromiseStrong,
        callback: Option<Box<dyn FnOnce(S3UploadResult<'_>)>>,
        /// Roots the pump, which only the stream reaches.
        stream: ReadableStreamStrong,
        /// Why the stream failed. It wins over the upload's own error.
        stream_error: bun_jsc::strong::Optional,
    },
    /// A `writer()` failed with nothing pending: it takes writes until `end()`.
    Unreported,
}

bun_jsc::impl_abort_handle_owner!(NetworkSink, abort_handle, |this, _cause| {
    // SAFETY: trait contract.
    NetworkSink::abort(&unsafe { RefPtr::init_ref(this) });
});

/// Fails the upload of a `writer()` that was collected before `end()`, outside the GC sweep.
pub(crate) struct WriterCollected;
impl bun_event_loop::RefTask for WriterCollected {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::S3UploadWriterCollected;
    type Ref = RefPtr<NetworkSink>;
    /// The context that stopped fails the upload through `abort_handle`.
    fn release_unrun(_: Self::Ref) {}
    fn context(sink: &Self::Ref) -> bun_event_loop::ContextId {
        sink.context
    }
}
impl WriterCollected {
    pub(crate) fn run(sink: &RefPtr<NetworkSink>) -> JsResult<()> {
        let message = b"S3 writer was garbage collected before end() was called";
        NetworkSink::fail(sink, b"UnknownError", message)
    }
}

impl NetworkSink {
    pub(crate) fn new(
        cx: &bun_jsc::JsThread<'_>,
        target: Target,
        options: MultiPartUploadOptions,
        owed: Owed,
    ) -> RefPtr<Self> {
        let this = RefPtr::new(Self {
            ref_count: Cell::new(1),
            self_ref: JsCell::new(None),
            upload: JsCell::new(Upload::new(options)),
            target,
            poll_ref: JsKeepAlive::active(),
            abort_handle: bun_jsc::AbortHandle::for_owner::<Self>(),
            context: cx.context().id(),
            global: GlobalRef::from(cx.global()),
            source: Cell::default(),
            pending: JsCell::default(),
            flush_promise: JsCell::default(),
            end_promise: JsCell::default(),
            owed: JsCell::new(owed),
        });
        this.self_ref.set(Some(this.clone()));
        // SAFETY: heap-allocated, and it leaves its context when it finishes.
        unsafe { bun_jsc::AbortHandle::arm_owner(this.as_ptr(), cx.context()) };
        this
    }

    /// For a call that can finish the upload. `None` once it has finished.
    pub(crate) fn ref_guard(&self) -> Option<RefPtr<Self>> {
        self.self_ref.get().clone()
    }

    pub(crate) fn is_ended(&self) -> bool {
        self.upload.get().is_ended()
    }

    fn context(&self) -> &bun_jsc::ScriptExecutionContext {
        VirtualMachine::get().context_of(self.context)
    }

    /// Runs no JS, and the reply never comes inside this call.
    fn send(this: &RefPtr<Self>, request: Request) {
        let target = &this.target;
        let query = request.query();
        let mut options = Options {
            path: &target.path,
            method: request.method(),
            search_params: query.as_deref().map(str::as_bytes),
            proxy_url: target.proxy.as_deref(),
            request_payer: target.request_payer,
            ..Default::default()
        };
        if let Request::Put(_) | Request::Create = request {
            options.content_type = target.content_type.as_deref();
            options.content_disposition = target.content_disposition.as_deref();
            options.content_encoding = target.content_encoding.as_deref();
            options.acl = target.acl;
            options.storage_class = target.storage_class;
        }
        let context = match request {
            // The store bills the parts, so this goes out for a context that stopped too.
            Request::Abort(_) => VirtualMachine::get().root_context(),
            _ => this.context(),
        };
        let callback = Callback::Sink(this.clone(), request);
        let sent = execute_simple_s3_request(&target.credentials, context, options, callback);
        debug_assert!(sent.is_ok());
    }

    fn send_ready(&self) {
        // Made in a context that had stopped: the abort comes a turn later.
        if self.abort_handle.context_stopped() {
            return;
        }
        while let Some(this) = self.self_ref.get()
            && let Some(request) = self.upload.with_mut(Upload::next_request)
        {
            Self::send(this, request);
        }
    }

    pub(crate) fn on_reply(
        this: &RefPtr<Self>,
        request: Request,
        reply: Result<&[u8], S3Error<'_>>,
    ) -> JsResult<()> {
        scoped_log!(S3Upload, "{:?} ok={}", request.method(), reply.is_ok());
        let step = this.upload.with_mut(|upload| match reply {
            Ok(text) => upload.on_success(request, text),
            // In a context that stopped it would only be aborted again.
            Err(error) => upload.on_failure(request, error, !this.context().is_stopped()),
        });
        Self::take_step(this, step)
    }

    fn fail(this: &RefPtr<Self>, code: &[u8], message: &[u8]) -> JsResult<()> {
        let error = S3Error { code, message };
        Self::take_step(this, this.upload.with_mut(|upload| upload.fail(error)))
    }

    fn abort(this: &RefPtr<Self>) {
        let _ = Self::fail(this, b"AbortError", b"The operation was aborted");
    }

    /// `this` is the caller's own ref, never the one in `self_ref`.
    fn take_step(this: &RefPtr<Self>, step: Step<'_>) -> JsResult<()> {
        let (result, abort) = match step {
            Step::Nothing => return Ok(()),
            Step::Send(request) => {
                Self::send(this, request);
                return Ok(());
            }
            Step::Drained(flushed) => {
                this.send_ready();
                if flushed > 0 && !this.upload.get().has_backpressure() {
                    this.on_writable(flushed);
                }
                return Ok(());
            }
            Step::Succeeded => (S3UploadResult::Success, None),
            Step::Failed(error, abort) => (S3UploadResult::Failure(error), abort),
        };
        this.abort_handle.leave();
        this.self_ref.set(None);
        let settled = this.report(result);
        // Whoever still holds a ref may hold it for as long as the collector likes.
        this.poll_ref.unref(bun_io::js_vm_ctx());
        if let Some(abort) = abort {
            Self::send(this, abort);
        }
        settled
    }

    fn on_writable(&self, flushed: usize) {
        // A stream that ended has nothing left to write: its `flush()` waits for the result.
        if self.is_ended() && matches!(self.owed.get(), Owed::Result { .. }) {
            return;
        }
        if self.flush_promise.get().has_value() {
            let flushed = JSValue::js_number(flushed as f64);
            crate::dispatch::fold(self.flush_promise.take().resolve(&self.global, flushed));
        }
        self.pending.take().run();
        self.source.get().ready(None, None);
    }

    fn end_pending_write(&self) {
        let mut pending = self.pending.take();
        pending.result = Writable::Done;
        pending.run();
    }

    /// After an `Err` nothing else is settled, and everything is still released.
    fn report(&self, result: S3UploadResult<'_>) -> JsResult<()> {
        let (flush, end) = (self.flush_promise.take(), self.end_promise.take());
        let mut owed = self.owed.take();
        let mut _drain = None;
        if let Owed::Nothing = owed {
            if !flush.has_value() && !end.has_value() {
                if let S3UploadResult::Failure(_) = result {
                    self.owed.set(Owed::Unreported);
                }
                return Ok(());
            }
            _drain = Some(VirtualMachine::get().enter_event_loop_scope());
        }
        let global = &*self.global;
        let error = match (&result, &mut owed) {
            (S3UploadResult::Success, _) => None,
            (_, Owed::Result { stream_error, .. }) if stream_error.has() => {
                Some(stream_error.swap())
            }
            (S3UploadResult::Failure(error), _) => {
                Some(s3_error_to_js(error, global, Some(&self.target.path)))
            }
        };
        let settle = |mut promise: JSPromiseStrong, bytes: u64| match error {
            _ if !promise.has_value() => Ok(()),
            Some(error) => promise.reject(global, Ok(error)),
            None => promise.resolve(global, JSValue::js_number(bytes as f64)),
        };
        let accepted = self.upload.get().accepted();
        self.end_pending_write();
        let mut settled = settle(flush, 0).and_then(|()| settle(end, accepted));
        self.source.get().close(None);
        self.source.take().detach(global);
        if let Owed::Result {
            promise,
            callback,
            stream,
            ..
        } = owed
        {
            drop(stream);
            settled = settled.and_then(|()| settle(promise, accepted));
            if let Some(callback) = callback {
                callback(result);
            }
        }
        settled
    }

    /// From here only the promise of `upload_stream` settles.
    pub(crate) fn on_pump_done(&self) {
        drop((self.flush_promise.take(), self.end_promise.take()));
        drop(self.pending.take());
        self.source.take().detach(&self.global);
    }

    pub(crate) fn on_pump_rejected(this: &RefPtr<Self>, reason: JSValue) {
        bun_removable_features::removable_body_behind_value!(S3Client, {
            this.on_pump_done();
            // Also when the commit is out and goes on.
            this.owed.with_mut(|owed| {
                if let Owed::Result { promise, .. } = owed
                    && promise.has_value()
                    && !reason.is_empty_or_undefined_or_null()
                {
                    let _ = promise.reject(&this.global, Ok(reason));
                }
            });
            Self::fail_from_source(this, JSValue::ZERO);
        })
    }

    /// Script was terminated inside `upload_stream`: nobody gets its promise, and no error can be made.
    pub(crate) fn on_pump_terminated(this: &RefPtr<Self>) {
        this.end_pending_write();
        this.on_pump_done();
        if !this.is_ended() {
            drop(this.owed.take());
            Self::abort(this);
        }
    }

    /// The stream failed, so what it wrote is not the whole object.
    fn fail_from_source(this: &RefPtr<Self>, reason: JSValue) {
        this.owed.with_mut(|owed| {
            if let Owed::Result { stream_error, .. } = owed
                && !reason.is_empty_or_undefined_or_null()
            {
                stream_error.set(&this.global, reason);
            }
        });
        let _ = Self::fail(this, b"UnknownError", b"ReadableStream ended with an error");
    }

    /// From the `ByteStream`, which has let go of the sink.
    pub(crate) fn end_from_stream(this: &RefPtr<Self>, err: Option<StreamError>) {
        if this.is_ended() {
            return;
        }
        this.source.set(SourceHandle::None);
        match err {
            Some(err) => Self::fail_from_source(this, err.to_js(&this.global)),
            None => this.finish_input(),
        }
    }

    pub(crate) fn finish_input(&self) {
        if !self.is_ended() {
            self.upload.with_mut(Upload::end);
            self.end_pending_write();
            self.send_ready();
        }
    }

    #[inline]
    fn write_chunk(&self, chunk: EncodedChunk<'_>, len: usize) -> Writable {
        let len = len as BlobSizeType;
        if self.is_ended() {
            let unreported = matches!(self.owed.get(), Owed::Unreported);
            return Writable::Owned(if unreported { len } else { 0 });
        }
        // Nothing of a context that stopped is sent, so nothing is taken: the writer waits for the abort.
        if !self.abort_handle.context_stopped() {
            let filled_a_part = self.upload.with_mut(|upload| match chunk {
                EncodedChunk::Bytes(bytes) => upload.write(bytes),
                EncodedChunk::Latin1(text) => upload.write_latin1(text),
                EncodedChunk::Utf16(text) => upload.write_utf16(text),
            });
            if filled_a_part {
                self.send_ready();
            }
            if !self.upload.get().has_backpressure() {
                return Writable::Owned(len);
            }
        }
        match self.source.get() {
            // `writer().write()` returns a number.
            SourceHandle::None => Writable::Owned(len),
            SourceHandle::ByteStream(_) => Writable::Backpressure(len),
            _ => {
                self.pending.with_mut(|p| p.result = Writable::Owned(len));
                Writable::Pending(self.pending.as_ptr())
            }
        }
    }

    pub(crate) fn write(&self, data: &StreamResult<'_>) -> Writable {
        self.write_chunk(EncodedChunk::Bytes(data.slice()), data.slice().len())
    }
}

/// The JS wrapper's ref.
pub(crate) struct NetworkSinkWrapperRef(pub(crate) RefPtr<NetworkSink>);

impl Drop for NetworkSinkWrapperRef {
    fn drop(&mut self) {
        // Not `Upload::end`: a part answered before the task runs would commit what there is.
        if !self.0.is_ended() {
            let task = bun_event_loop::Task::from_ref::<WriterCollected>(self.0.clone());
            VirtualMachine::get().event_loop().enqueue_task(task);
        }
    }
}

impl WrappedSink for NetworkSink {
    type Wrapped = NetworkSinkWrapperRef;
    fn as_non_null(wrapped: &NetworkSinkWrapperRef) -> NonNull<Self> {
        wrapped.0.as_non_null()
    }
}

impl JsSinkType for NetworkSink {
    const NAME: &'static str = "NetworkSink";

    type Entered<'a> = &'a Self;
    unsafe fn enter<'a>(this: NonNull<Self>) -> &'a Self {
        // SAFETY: trait contract.
        unsafe { this.as_ref() }
    }

    fn memory_cost(&self) -> usize {
        self.upload.get().memory_cost()
    }

    fn write_bytes(this: &mut &Self, data: &StreamResult<'_>) -> Writable {
        this.write(data)
    }

    fn write_latin1(this: &mut &Self, data: &StreamResult<'_>) -> Writable {
        this.write_chunk(EncodedChunk::Latin1(data.slice()), data.slice().len())
    }

    fn write_utf16(this: &mut &Self, text: &[u16]) -> Writable {
        this.write_chunk(EncodedChunk::Utf16(text), size_of_val(text))
    }

    fn start(_: &mut &Self, _: Start, _: &bun_jsc::ScriptExecutionContext) -> sys::Result<()> {
        Ok(())
    }

    fn end(this: &mut &Self, _: Option<sys::Error>) -> sys::Result<()> {
        this.finish_input();
        Ok(())
    }

    fn end_from_js(this: &mut &Self, _: &bun_jsc::JsThread<'_>) -> sys::Result<JSValue> {
        this.finish_input();
        if this.upload.get().is_finished() {
            this.owed.set(Owed::Nothing);
            return Ok(JSValue::js_number(0.0));
        }
        if !this.end_promise.get().has_value() {
            this.end_promise.set(JSPromiseStrong::init(&this.global));
        }
        Ok(this.end_promise.get().value())
    }

    fn flush_from_js(
        this: &mut &Self,
        cx: &bun_jsc::JsThread<'_>,
        _wait: bool,
    ) -> sys::Result<JSValue> {
        if !this.flush_promise.get().has_value() {
            if this.upload.get().is_idle() {
                let zero = JSValue::js_number(0.0);
                return Ok(JSPromise::resolved_promise_value(cx.global(), zero));
            }
            this.flush_promise.set(JSPromiseStrong::init(cx.global()));
        }
        Ok(this.flush_promise.get().value())
    }
}

impl ControlledSink for NetworkSink {
    fn to_any_sink(this: NonNull<Self>) -> AnyControlledSink {
        AnyControlledSink::NetworkSink(this)
    }

    /// The controller holds no ref.
    unsafe fn controller_finalize(_: *mut Self) {}

    unsafe fn close_with_error(
        this: *mut Self,
        _: &JSGlobalObject,
        reason: JSValue,
    ) -> sys::Result<()> {
        // SAFETY: trait contract.
        Self::fail_from_source(&unsafe { RefPtr::init_ref(this) }, reason);
        Ok(())
    }

    fn source<'a>(this: &'a mut &Self) -> &'a Cell<SourceHandle> {
        &this.source
    }
}
