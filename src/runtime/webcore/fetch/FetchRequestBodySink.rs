use bun_collections::ByteVecExt;
use bun_ptr::BackRef;
use bun_sys::Error as SysError;

use crate::webcore::blob::SizeType as BlobSizeType;
use crate::webcore::fetch::fetch_tasklet::FetchTasklet;
use crate::webcore::jsc::{JSGlobalObject, JSPromise, JSPromiseStrong, JSValue};
use crate::webcore::sink::JSSink;
use crate::webcore::streams::{SourceHandle, Start, StartTag, StreamError, StreamResult, Writable};

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
    /// Non-owning back-reference; `FetchTasklet` is kept alive by a +1
    /// intrusive ref taken in `start_request_stream` and released exactly once
    /// by the `assign_to_stream`-result path (`on_resolve_request_stream` /
    /// `on_reject_request_stream` / synchronous branches), which clears this to
    /// `None` first. `finalize` releases it as a fallback if that path never
    /// ran.
    pub task: Option<BackRef<FetchTasklet>>,
    pub source: SourceHandle<FetchRequestBodySink>,
    pub high_water_mark: BlobSizeType,
    /// Pending flush(true) promise for readDirectStream's pump (parks on this, not m_onPull).
    pub flush_promise: JSPromiseStrong,
    /// Bytes written since last on_drain; >0 guarantees a drain ack is owed.
    pub pending_bytes: BlobSizeType,
    pub ended: bool,
    pub done: bool,
}

impl Default for FetchRequestBodySink {
    fn default() -> Self {
        Self {
            task: None,
            source: SourceHandle::default(),
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
        self.source.start();
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
            // Report Backpressure on every nonzero write so the event loop ticks between them.
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
        self.end_from_stream(err.map(StreamError::Error));
        bun_sys::Result::Ok(())
    }

    /// Native-path terminator called from `SinkHandle::end`. Carries the full
    /// `StreamError` so a JS-valued upstream error (e.g. fetch reset) reaches
    /// `write_end_request(Some(js))` instead of being silently dropped to EOF.
    pub fn end_from_stream(&mut self, err: Option<StreamError>) {
        if self.ended {
            return;
        }
        self.ended = true;
        if matches!(
            self.source,
            SourceHandle::ByteStream(_) | SourceHandle::FileReader(_)
        ) {
            // Native ByteStream source: no pump promise, so drive write_end_request here.
            self.source.close(None);
            if let Some(task) = self.task.take() {
                let task_ptr = task.as_ptr();
                // SAFETY: the `+1` taken in `start_request_stream` keeps the
                // tasklet live while `task` was `Some`.
                let global = unsafe { (*task_ptr).global_this };
                let err_js = err.map(|e| e.to_js(&global));
                // SAFETY: `task_ptr` live (see above); `write_end_request` is
                // the balancing release and may free `*self` via `clear_sink`,
                // so do not touch `self` afterwards.
                unsafe { (*task_ptr).write_end_request(err_js) };
            }
            return;
        }
        // JS pump path: the assign_to_stream result handler is the single balancing release.
        let sys_err = match err {
            Some(StreamError::Error(e)) => Some(e),
            _ => None,
        };
        self.source.close(sys_err);
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

    /// HTTP-thread drain ack: resolves flush_promise and wakes source.ready().
    pub fn on_drain(&mut self, global_this: &JSGlobalObject) {
        bun_core::scoped_log!(FetchRequestBodySinkLog, "onDrain");
        self.pending_bytes = 0;
        if self.flush_promise.has_value() {
            let _ = self
                .flush_promise
                .resolve(global_this, JSValue::js_number(0.0));
        }
        self.source.ready(None, None);
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
    fn source(&mut self) -> Option<&mut SourceHandle<Self>> {
        Some(&mut self.source)
    }
    fn done(&self) -> bool {
        self.done
    }
}

pub type FetchRequestBodySinkJSSink = JSSink<FetchRequestBodySink>;
