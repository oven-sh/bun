use core::cell::Cell;

use bun_collections::ByteVecExt;
use bun_jsc::JsCell;
use bun_ptr::{BackRef, Root};
use bun_sys::Error as SysError;

use crate::webcore::blob::SizeType as BlobSizeType;
use crate::webcore::fetch::fetch_tasklet::FetchTasklet;
use crate::webcore::jsc::{JSGlobalObject, JSPromise, JSValue};
use crate::webcore::streams::{
    SourceHandle, Start, StartTag, StreamError, StreamResult, Writable, WritablePending,
};

bun_core::declare_scope!(FetchRequestBodySinkLog, visible);

/// One sink chunk in its source encoding; `write_request_data` converts
/// directly into the locked stream buffer so no intermediate UTF-8 buffer is
/// allocated.
#[derive(Clone, Copy)]
pub enum RequestBodyChunk<'a> {
    Bytes(&'a [u8]),
    Latin1(&'a [u8]),
    Utf16(&'a [u16]),
}

impl<'a> RequestBodyChunk<'a> {
    #[inline]
    pub fn utf8_len(&self) -> usize {
        match *self {
            Self::Bytes(b) => b.len(),
            Self::Latin1(b) => bun_simdutf_sys::simdutf::length::utf8::from::latin1(b),
            Self::Utf16(u) => {
                bun_simdutf_sys::simdutf::length::utf8::from::utf16::le_with_replacement(u)
            }
        }
    }

    #[inline]
    pub fn append_utf8_into(&self, out: &mut Vec<u8>) {
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

/// JSSink streaming a fetch() request body into the HTTP thread's ThreadSafeStreamBuffer
/// with chunked framing; one write per drain-ack.
pub struct FetchRequestBodySink {
    /// The tasklet that owns this sink. While `Some`, the tasklet's
    /// `request_stream_ref` is held; the `assign_to_stream`-result path
    /// (`on_resolve_request_stream` / `on_reject_request_stream` / synchronous
    /// branches) clears this first and then releases that ref, and `finalize`
    /// releases it as a fallback if that path never ran.
    pub task: Cell<Option<BackRef<FetchTasklet, Root>>>,
    pub source: Cell<SourceHandle>,
    pub high_water_mark: Cell<BlobSizeType>,
    /// Shared pending drain promise for `write()` and `flush(true)`; resolved
    /// in `on_drain()`.
    pub pending: JsCell<WritablePending>,
    /// Bytes written since last on_drain; >0 guarantees a drain ack is owed.
    pub pending_bytes: Cell<BlobSizeType>,
    pub ended: Cell<bool>,
    pub done: Cell<bool>,
}

impl Default for FetchRequestBodySink {
    fn default() -> Self {
        Self {
            task: Cell::new(None),
            source: Cell::new(SourceHandle::default()),
            high_water_mark: Cell::new(16384),
            pending: JsCell::new(WritablePending::default()),
            pending_bytes: Cell::new(0),
            ended: Cell::new(false),
            done: Cell::new(false),
        }
    }
}

impl FetchRequestBodySink {
    pub const NAME: &'static str = "FetchRequestBodySink";

    pub fn is_native_source(&self) -> bool {
        matches!(
            self.source.get(),
            SourceHandle::ByteStream(_) | SourceHandle::FileReader(_)
        )
    }

    pub fn start(&mut self, stream_start: &Start) -> bun_sys::Result<()> {
        if self.ended.get() {
            return bun_sys::Result::Ok(());
        }
        if let &Start::ChunkSize(chunk_size) = stream_start {
            if chunk_size > 0 {
                self.high_water_mark.set(chunk_size);
            }
        }
        self.source.get_mut().start();
        bun_sys::Result::Ok(())
    }

    fn write_chunk(&mut self, chunk: RequestBodyChunk<'_>) -> Writable {
        if self.ended.get() {
            return Writable::Done;
        }
        let high_water_mark = self.high_water_mark.get();
        let result = match self.task.get() {
            Some(task) => task.write_request_data(chunk, high_water_mark as usize),
            None => return Writable::Done,
        };
        let (len, backed_up) = match result {
            Writable::Owned(len) if len > 0 => (len, false),
            Writable::Backpressure(len) => (len, true),
            other => return other,
        };
        self.pending_bytes
            .set(self.pending_bytes.get().saturating_add(len));
        if self.is_native_source() {
            // Native sources are push-driven by a macrotask (on_body_received);
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
        let pending = self.pending.as_mut();
        pending.consumed = len;
        pending.result = Writable::Owned(len);
        Writable::Pending(core::ptr::from_mut(pending))
    }

    pub fn write(&mut self, data: &StreamResult) -> Writable {
        bun_core::scoped_log!(FetchRequestBodySinkLog, "write({})", data.slice().len());
        self.write_chunk(RequestBodyChunk::Bytes(data.slice()))
    }

    pub fn write_latin1(&mut self, data: &StreamResult) -> Writable {
        let bytes = data.slice();
        if bun_core::strings::is_all_ascii(bytes) {
            return self.write_chunk(RequestBodyChunk::Bytes(bytes));
        }
        self.write_chunk(RequestBodyChunk::Latin1(bytes))
    }

    pub fn write_utf16(&mut self, data: &StreamResult) -> Writable {
        // Caller guarantees u16 alignment / even length; bytemuck checks at runtime.
        self.write_chunk(RequestBodyChunk::Utf16(bytemuck::cast_slice(data.slice())))
    }

    pub fn flush(&mut self) -> bun_sys::Result<()> {
        bun_sys::Result::Ok(())
    }

    pub fn flush_from_js(
        &mut self,
        global_this: &JSGlobalObject,
        wait: bool,
    ) -> bun_sys::Result<JSValue> {
        use crate::webcore::streams::PendingState;
        let pending = self.pending.as_mut();
        if pending.state == PendingState::Pending {
            return bun_sys::Result::Ok(
                JSPromise::opaque_ref(pending.promise(global_this)).to_js(),
            );
        }
        if self.done.get() || self.ended.get() {
            return bun_sys::Result::Ok(JSPromise::resolved_promise_value(
                global_this,
                JSValue::js_number(0.0),
            ));
        }
        if wait && self.pending_bytes.get() > 0 {
            // Bytes were scheduled to the HTTP thread since the last drain ack,
            // so an `on_drain` is guaranteed to arrive and resolve this.
            pending.result = Writable::Owned(self.pending_bytes.get());
            return bun_sys::Result::Ok(
                JSPromise::opaque_ref(pending.promise(global_this)).to_js(),
            );
        }
        bun_sys::Result::Ok(JSPromise::resolved_promise_value(
            global_this,
            JSValue::js_number(0.0),
        ))
    }

    pub fn end(&mut self, err: Option<SysError>) -> bun_sys::Result<()> {
        self.end_from_stream(err.map(StreamError::Error));
        bun_sys::Result::Ok(())
    }

    /// Native-path terminator called from `SinkHandle::end`. Carries the full
    /// `StreamError` so a JS-valued upstream error (e.g. fetch reset) reaches
    /// `write_end_request(Some(js))` instead of being silently dropped to EOF.
    pub fn end_from_stream(&mut self, err: Option<StreamError>) {
        if self.ended.get() {
            return;
        }
        self.ended.set(true);
        if self.is_native_source() {
            // Native source drove this call and already cleared its own `sink`
            // field; detach (not cancel) so we don't re-enter the source while
            // it is still on the stack (FileReader.on_reader_error ref-leak).
            self.source.set(SourceHandle::None);
            if let Some(task) = self.task.take() {
                let err_js = err.map(|e| e.to_js(&task.global_this));
                // Releases the tasklet's `request_stream_ref`, which may free the
                // tasklet and, through `clear_sink`, `*self`: do not touch `self`
                // afterwards.
                FetchTasklet::write_end_request(task.this_ptr(), err_js);
            }
            return;
        }
        // JS pump path: the assign_to_stream result handler is the single balancing release.
        let sys_err = match err {
            Some(StreamError::Error(e)) => Some(e),
            _ => None,
        };
        self.source.get_mut().close(sys_err);
    }

    pub fn end_from_js(&mut self, _global_this: &JSGlobalObject) -> bun_sys::Result<JSValue> {
        let _ = self.end(None);
        bun_sys::Result::Ok(JSValue::js_number(0.0))
    }

    /// # Safety
    /// `this` must be live and must not be used after the call: the tasklet
    /// owns this allocation, and if the ref released here was its last one,
    /// dropping it (`clear_sink`) frees `*this`.
    pub unsafe fn finalize(this: *mut Self) {
        // SAFETY: caller contract; `this` is not touched again after this line.
        let task = unsafe { (*this).task.take() };
        if let Some(task) = task {
            // Releases `request_stream_ref` when the assign_to_stream-result
            // handler never ran to release it.
            FetchTasklet::release_request_stream_ref(task.this_ptr());
        }
    }

    /// Settle the pending write/flush promise with `Done` and fire the source's
    /// close (which cancels the upstream reader).
    pub(crate) fn cancel(&self) {
        self.pending
            .with_mut(|pending| pending.result = Writable::Done);
        self.pending.with_mut(WritablePending::run);
        let mut source = self.source.get();
        source.close(None);
    }

    /// HTTP-thread drain ack: resolves the pending write/flush promise and wakes source.ready().
    pub fn on_drain(&self, _global_this: &JSGlobalObject) {
        bun_core::scoped_log!(FetchRequestBodySinkLog, "onDrain");
        self.pending_bytes.set(0);
        self.pending.with_mut(WritablePending::run);
        let mut source = self.source.get();
        source.ready(None, None);
    }

    pub fn memory_cost(&self) -> usize {
        if let Some(task) = self.task.get() {
            if let Some(buffer) = task.request_body_buffer() {
                return buffer.lock().size();
            }
        }
        0
    }
}

crate::impl_js_sink_abi!(FetchRequestBodySink, "FetchRequestBodySink");

impl crate::webcore::sink::JsSinkType for FetchRequestBodySink {
    const NAME: &'static str = Self::NAME;
    const HAS_FLUSH_FROM_JS: bool = true;
    const START_TAG: Option<StartTag> = Some(StartTag::FetchRequestBodySink);

    crate::impl_js_sink_forwarders!();

    unsafe fn finalize(this: *mut Self) {
        // SAFETY: same contract, forwarded.
        unsafe { Self::finalize(this) }
    }
    fn end_from_js(&mut self, global: &JSGlobalObject) -> bun_sys::Result<JSValue> {
        Self::end_from_js(self, global)
    }
    fn source(&mut self) -> Option<&mut SourceHandle> {
        Some(self.source.get_mut())
    }
}
