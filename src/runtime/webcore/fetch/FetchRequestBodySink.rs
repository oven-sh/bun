use bun_collections::ByteVecExt;
use bun_ptr::BackRef;
use bun_sys::Error as SysError;

use crate::webcore::blob::SizeType as BlobSizeType;
use crate::webcore::fetch::fetch_tasklet::FetchTasklet;
use crate::webcore::jsc::{JSGlobalObject, JSPromise, JSPromiseStrong, JSValue};
use crate::webcore::sink::JSSink;
use crate::webcore::streams::{Signal, Start, StartTag, StreamResult, Writable};

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
            Self::Utf16(u) => bun_simdutf_sys::simdutf::length::utf8::from::utf16::le(u),
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

/// JSSink that streams a fetch() request body into the HTTP thread's
/// `ThreadSafeStreamBuffer`, applying chunked transfer-encoding framing when
/// required. Replaces the bespoke `ResumableFetchSink` so request-body
/// streaming speaks the standard `Writable::Backpressure` / `flush(true)` →
/// pending-promise / `Signal::ready` protocol that `readStreamIntoSink`
/// already honours.
pub struct FetchRequestBodySink {
    /// Non-owning back-reference; `FetchTasklet` is kept alive by a +1
    /// intrusive ref taken in `start_request_stream` and released exactly once
    /// by the `assign_to_stream`-result path (`on_resolve_request_stream` /
    /// `on_reject_request_stream` / synchronous branches), which clears this to
    /// `None` first. `finalize` releases it as a fallback if that path never
    /// ran.
    pub task: Option<BackRef<FetchTasklet>>,
    pub signal: Signal,
    pub high_water_mark: BlobSizeType,
    pub flush_promise: JSPromiseStrong,
    /// Bytes handed to `write_request_data` since the last `on_drain` ack.
    /// JS-thread-only accounting: the shared `stream_buffer` is drained
    /// concurrently by the HTTP thread, so its `size()` cannot gate
    /// backpressure without racing (the pump would never yield when the HTTP
    /// thread keeps up). `on_drain` — dispatched from `report_drain` via a
    /// `ConcurrentTask` — is the sole writer that resets this, so
    /// `pending_bytes > 0` guarantees an `on_drain` is in flight to resolve
    /// `flush_promise`.
    pub pending_bytes: BlobSizeType,
    pub ended: bool,
    pub done: bool,
}

impl Default for FetchRequestBodySink {
    fn default() -> Self {
        Self {
            task: None,
            signal: Signal::default(),
            high_water_mark: 16384,
            flush_promise: JSPromiseStrong::default(),
            pending_bytes: 0,
            ended: false,
            done: false,
        }
    }
}

impl FetchRequestBodySink {
    pub const NAME: &'static str = "FetchRequestBodySink";

    /// Exclusive borrow of the owning `FetchTasklet`, if still attached.
    ///
    /// SAFETY (invariant): the tasklet is intrusively ref-counted and this
    /// sink holds (indirectly, via the `+1` taken in `start_request_stream`) a
    /// counted ref while `task` is `Some`; JS-thread-only so no concurrent
    /// `&mut` exists.
    #[inline]
    fn task_mut(&mut self) -> Option<&mut FetchTasklet> {
        // SAFETY: see doc comment — exclusive while `&mut self` held.
        self.task.as_mut().map(|p| unsafe { p.get_mut() })
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

    fn write_chunk(&mut self, chunk: RequestBodyChunk<'_>) -> Writable {
        if self.ended {
            return Writable::Done;
        }
        let high_water_mark = self.high_water_mark;
        let result = match self.task_mut() {
            Some(task) => task.write_request_data(chunk, high_water_mark as usize),
            None => return Writable::Done,
        };
        match result {
            // Data was buffered for the HTTP thread. Signal backpressure on
            // every successful write (one write per drain ack) so the event
            // loop returns to `auto_tick()` and polls I/O between writes;
            // batching lets the HTTP thread's `report_drain` ConcurrentTask
            // re-arm inside `tick()` and livelock an in-process peer.
            // `pending_bytes` remains the "drain ack owed" sentinel for
            // `flush_from_js(wait=true)`.
            Writable::Owned(len) | Writable::Backpressure(len) if len > 0 => {
                self.pending_bytes = self.pending_bytes.saturating_add(len);
                Writable::Backpressure(len)
            }
            other => other,
        }
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
        if self.flush_promise.has_value() {
            return bun_sys::Result::Ok(self.flush_promise.value());
        }
        if self.done || self.ended {
            return bun_sys::Result::Ok(JSPromise::resolved_promise_value(
                global_this,
                JSValue::js_number(0.0),
            ));
        }
        if wait && self.pending_bytes > 0 {
            // Bytes were scheduled to the HTTP thread since the last drain ack,
            // so an `on_drain` is guaranteed to arrive and resolve this.
            self.flush_promise = JSPromiseStrong::init(global_this);
            return bun_sys::Result::Ok(self.flush_promise.value());
        }
        bun_sys::Result::Ok(JSPromise::resolved_promise_value(
            global_this,
            JSValue::js_number(0.0),
        ))
    }

    pub fn end(&mut self, err: Option<SysError>) -> bun_sys::Result<()> {
        if self.ended {
            return bun_sys::Result::Ok(());
        }
        self.ended = true;
        // Do NOT call `write_end_request` here: the `assign_to_stream` result
        // (on_resolve/on_reject or the synchronous Fulfilled/Rejected/undefined
        // branches in `start_request_stream`) is the single balancing release of
        // the `+1` taken in `start_request_stream`. `task` stays populated so
        // `finalize()` can release it if that handler never runs.
        self.signal.close(err);
        bun_sys::Result::Ok(())
    }

    pub fn end_from_js(&mut self, _global_this: &JSGlobalObject) -> bun_sys::Result<JSValue> {
        let _ = self.end(None);
        bun_sys::Result::Ok(JSValue::js_number(0.0))
    }

    pub fn finalize(&mut self) {
        if let Some(task) = self.task.take() {
            // Balances the `ref_()` taken in `start_request_stream` when the
            // assign_to_stream-result handler never ran to release it.
            FetchTasklet::deref(task.as_ptr());
        }
    }

    /// Called from `FetchTasklet::resume_request_data_stream` (main thread)
    /// after the HTTP thread reports the shared stream buffer has drained.
    /// Resolves any pending `flush(true)` promise and signals readiness so
    /// `readStreamIntoSink`'s pump resumes pulling.
    pub fn on_drain(&mut self, global_this: &JSGlobalObject) {
        bun_core::scoped_log!(FetchRequestBodySinkLog, "onDrain");
        self.pending_bytes = 0;
        if self.flush_promise.has_value() {
            let _ = self
                .flush_promise
                .resolve(global_this, JSValue::js_number(0.0));
        }
        self.signal.ready(None, None);
    }

    pub fn memory_cost(&self) -> usize {
        if let Some(task) = self.task.as_ref() {
            if let Some(buf) = task.stream_buffer_mut() {
                return buf.lock().size();
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

pub type FetchRequestBodySinkJSSink = JSSink<FetchRequestBodySink>;
