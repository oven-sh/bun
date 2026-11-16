use core::cell::Cell;

use bun_ptr::{AliasableBox, CellExt as _, RefCount, RefPtr};
use bun_sys::Error as SysError;

use crate::webcore::blob::SizeType as BlobSizeType;
use crate::webcore::fetch::fetch_tasklet::FetchTasklet;
use crate::webcore::jsc::{JSGlobalObject, JSPromise, JSValue};
use crate::webcore::sink::AnyControlledSink;
use crate::webcore::streams::{
    EncodedChunk, SourceHandle, Start, StreamError, StreamResult, Writable, WritablePending,
};

bun_core::declare_scope!(FetchRequestBodySinkLog, visible);

/// JSSink streaming a fetch() request body into the buffer that the HTTP thread sends
/// with chunked framing; one write per drain-ack.
#[derive(bun_ptr::RefCounted)]
#[ref_count(destroy = Self::destroy)]
pub(crate) struct FetchRequestBodySink {
    ref_count: RefCount,
    /// Held until the request body ends.
    pub task: Cell<Option<RefPtr<FetchTasklet>>>,
    pub source: Cell<SourceHandle>,
    high_water_mark: Cell<BlobSizeType>,
    /// Shared pending drain promise for `write()` and `flush(true)`; resolved
    /// in `on_drain()`.
    pub pending: WritablePending,
    /// Bytes written since last on_drain; >0 guarantees a drain ack is owed.
    pending_bytes: Cell<BlobSizeType>,
    pub ended: Cell<bool>,
    pub done: Cell<bool>,
}

impl FetchRequestBodySink {
    pub(crate) const NAME: &'static str = "FetchRequestBodySink";

    pub(crate) fn new(task: RefPtr<FetchTasklet>) -> RefPtr<Self> {
        RefPtr::new(Self {
            ref_count: RefCount::init(),
            task: Cell::new(Some(task)),
            source: Cell::default(),
            high_water_mark: Cell::new(16384),
            pending: WritablePending::default(),
            pending_bytes: Cell::new(0),
            ended: Cell::new(false),
            done: Cell::new(false),
        })
    }

    /// Keeps the drop glue out of a build without the feature.
    fn destroy(last: AliasableBox<Self>) {
        bun_removable_features::removable_body_behind_value!(Fetch, { drop(last) })
    }

    /// The tasklet is done with the sink, which its controller holds until it is collected.
    pub(crate) fn detach(&self, global: &JSGlobalObject) {
        let _task = self.task.take();
        // Every terminal path has already cleared the controller's onClose, so this only detaches it.
        self.source.take().detach(global);
        self.pending.clear();
    }

    pub(crate) fn start(&self, stream_start: &Start) -> bun_sys::Result<()> {
        if self.ended.get() {
            return bun_sys::Result::Ok(());
        }
        if let &Start::ChunkSize(chunk_size) = stream_start {
            if chunk_size > 0 {
                self.high_water_mark.set(chunk_size);
            }
        }
        self.source.get().start();
        bun_sys::Result::Ok(())
    }

    fn write_chunk(&self, chunk: EncodedChunk<'_>) -> Writable<'_> {
        if self.ended.get() {
            return Writable::Done;
        }
        let high_water_mark = self.high_water_mark.get();
        let result = self.task.with_taken(|task| match task {
            Some(task) => task.write_request_data(chunk, high_water_mark as usize),
            None => Writable::Done,
        });
        let (len, backed_up) = match result {
            Writable::Owned(len) if len > 0 => (len, false),
            Writable::Backpressure(len) => (len, true),
            other => return other,
        };
        self.pending_bytes.update(|n| n.saturating_add(len));
        if matches!(
            self.source.get(),
            SourceHandle::ByteStream(_) | SourceHandle::FileReader(_)
        ) {
            // Native sources are push-driven by a macrotask (deliver_body_chunk);
            // only park them when the cross-thread buffer is actually over HWM.
            return if backed_up {
                Writable::Backpressure(len)
            } else {
                Writable::Owned(len)
            };
        }
        // JS pump: every scheduled write owes an `on_drain` ConcurrentTask. Park
        // on each so the event loop reaches the I/O poll before resuming; batching
        // sync writes here lets the HTTP thread re-enqueue the drain ack before
        // the microtask loop yields and starves uWS callbacks and timers.
        self.pending.park(len)
    }

    pub(crate) fn write(&self, data: &StreamResult<'_>) -> Writable<'_> {
        bun_core::scoped_log!(FetchRequestBodySinkLog, "write({})", data.slice().len());
        self.write_chunk(EncodedChunk::Bytes(data.slice()))
    }

    pub(crate) fn write_latin1(&self, data: &StreamResult<'_>) -> Writable<'_> {
        let bytes = data.slice();
        if bun_core::strings::is_all_ascii(bytes) {
            return self.write_chunk(EncodedChunk::Bytes(bytes));
        }
        self.write_chunk(EncodedChunk::Latin1(bytes))
    }

    pub(crate) fn write_utf16(&self, text: &[u16]) -> Writable<'_> {
        self.write_chunk(EncodedChunk::Utf16(text))
    }

    pub(crate) fn flush_from_js(
        &self,
        cx: &bun_jsc::JsThread<'_>,
        wait: bool,
    ) -> bun_sys::Result<JSValue> {
        if self.pending.is_pending() {
            return bun_sys::Result::Ok(self.pending.promise(cx));
        }
        if self.done.get() || self.ended.get() {
            return bun_sys::Result::Ok(JSPromise::resolved_promise_value(
                cx.global(),
                JSValue::js_number(0.0),
            ));
        }
        if wait && self.pending_bytes.get() > 0 {
            // Bytes were scheduled to the HTTP thread since the last drain ack,
            // so an `on_drain` is guaranteed to arrive and resolve this.
            self.pending
                .result
                .set(Writable::Owned(self.pending_bytes.get()));
            return bun_sys::Result::Ok(self.pending.promise(cx));
        }
        bun_sys::Result::Ok(JSPromise::resolved_promise_value(
            cx.global(),
            JSValue::js_number(0.0),
        ))
    }

    pub(crate) fn end(&self, err: Option<SysError>) -> bun_sys::Result<()> {
        self.end_from_stream(err.map(StreamError::Error));
        bun_sys::Result::Ok(())
    }

    /// Native-path terminator called from `SinkHandle::end`. Carries the full
    /// `StreamError` so a JS-valued upstream error (e.g. fetch reset) reaches
    /// `write_end_request(Some(js))` instead of being silently dropped to EOF.
    pub(crate) fn end_from_stream(&self, err: Option<StreamError>) {
        if self.ended.get() {
            return;
        }
        self.ended.set(true);
        if matches!(
            self.source.get(),
            SourceHandle::ByteStream(_) | SourceHandle::FileReader(_)
        ) {
            // Native source drove this call and already cleared its own `sink`
            // field; detach (not cancel) so we don't re-enter the source while
            // it is still on the stack (FileReader.on_reader_error ref-leak).
            self.source.set(SourceHandle::None);
            if let Some(task) = self.task.take() {
                let err_js = err.map(|e| {
                    let global_this = task.global_this.get();
                    global_this.map_or(JSValue::UNDEFINED, |global| e.to_js(&global))
                });
                task.write_end_request(err_js);
            }
            return;
        }
        // JS pump path: the assign_to_stream result handler releases `task`.
        let sys_err = match err {
            Some(StreamError::Error(e)) => Some(e),
            _ => None,
        };
        self.source.get().close(sys_err);
    }

    pub(crate) fn end_from_js(&self, _cx: &bun_jsc::JsThread<'_>) -> bun_sys::Result<JSValue> {
        let _ = self.end(None);
        bun_sys::Result::Ok(JSValue::js_number(0.0))
    }

    /// HTTP-thread drain ack: resolves the pending write/flush promise and wakes source.ready().
    pub(crate) fn on_drain(&self) {
        bun_core::scoped_log!(FetchRequestBodySinkLog, "onDrain");
        self.pending_bytes.set(0);
        self.pending.run();
        self.source.get().ready(None, None);
    }

    pub(crate) fn memory_cost(&self) -> usize {
        self.task.with_taken(|task| {
            task.as_ref()
                .map_or(0, |task| task.request_body_streaming_buffer.lock().size())
        })
    }
}

impl crate::webcore::sink::JsSinkType for FetchRequestBodySink {
    const NAME: &'static str = Self::NAME;

    crate::impl_js_sink_forwarders!();

    fn end_from_js(&self, cx: &bun_jsc::JsThread<'_>) -> bun_sys::Result<JSValue> {
        Self::end_from_js(self, cx)
    }
}

impl crate::webcore::sink::ControlledSink for FetchRequestBodySink {
    fn to_any_sink(this: RefPtr<Self>) -> AnyControlledSink {
        AnyControlledSink::FetchRequestBodySink(this)
    }

    fn controller_finalize(&self) {
        self.task.set(None);
    }

    fn source(&self) -> &Cell<SourceHandle> {
        &self.source
    }
}
