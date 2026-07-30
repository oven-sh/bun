use bun_core::strings;
use bun_ptr::BackRef;
use bun_sys::{self as sys, Error as SysError};

use crate::webcore::blob::SizeType as BlobSizeType;
use crate::webcore::fetch::fetch_tasklet::FetchTasklet;
use crate::webcore::jsc::{JSGlobalObject, JSPromise, JSPromiseStrong, JSValue};
use crate::webcore::sink::JSSink;
use crate::webcore::streams::{Signal, Start, StartTag, StreamResult, Writable};

bun_core::declare_scope!(FetchRequestBodySinkLog, visible);

/// JSSink that streams a fetch() request body into the HTTP thread's
/// `ThreadSafeStreamBuffer`, applying chunked transfer-encoding framing when
/// required. Replaces the bespoke `ResumableFetchSink` so request-body
/// streaming speaks the standard `Writable::Backpressure` / `flush(true)` →
/// pending-promise / `Signal::ready` protocol that `readStreamIntoSink`
/// already honours.
pub struct FetchRequestBodySink {
    /// Non-owning back-reference; `FetchTasklet` is kept alive by a +1
    /// intrusive ref taken in `start_request_stream` and released either via
    /// `write_end_request` (normal end) or by `finalize` (sink dropped without
    /// `end`). Cleared to `None` once that +1 has been released.
    pub task: Option<BackRef<FetchTasklet>>,
    pub signal: Signal,
    pub global_this: Option<BackRef<JSGlobalObject>>,
    pub high_water_mark: BlobSizeType,
    pub flush_promise: JSPromiseStrong,
    pub ended: bool,
    pub done: bool,
}

impl Default for FetchRequestBodySink {
    fn default() -> Self {
        Self {
            task: None,
            signal: Signal::default(),
            global_this: None,
            high_water_mark: 16384,
            flush_promise: JSPromiseStrong::default(),
            ended: false,
            done: false,
        }
    }
}

impl FetchRequestBodySink {
    pub const NAME: &'static str = "FetchRequestBodySink";

    pub fn new(init: FetchRequestBodySink) -> Box<FetchRequestBodySink> {
        Box::new(init)
    }

    #[inline]
    pub fn global_this(&self) -> &JSGlobalObject {
        self.global_this
            .as_ref()
            .expect("FetchRequestBodySink.global_this used before init")
            .get()
    }

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

    /// Core write path — delegates to `FetchTasklet::write_request_data` so the
    /// chunked-framing bytes and `needs_schedule` / `schedule_request_write`
    /// semantics stay in a single place, with the high-water-mark coming from
    /// `self` (the sink) instead of being read back through `FetchTasklet.sink`.
    pub fn write(&mut self, data: &StreamResult) -> Writable {
        if self.ended {
            return Writable::Done;
        }
        let bytes = data.slice();
        bun_core::scoped_log!(FetchRequestBodySinkLog, "write({})", bytes.len());

        let high_water_mark = self.high_water_mark as usize;
        let Some(task) = self.task_mut() else {
            return Writable::Done;
        };
        task.write_request_data(bytes, high_water_mark)
    }

    pub fn write_latin1(&mut self, data: &StreamResult) -> Writable {
        if self.ended {
            return Writable::Done;
        }
        let bytes = data.slice();
        if strings::is_all_ascii(bytes) {
            return self.write(data);
        }
        let utf8 = match strings::allocate_latin1_into_utf8(bytes) {
            Ok(v) => v,
            Err(_) => return Writable::Err(SysError::from_code(sys::E::ENOMEM, sys::Tag::write)),
        };
        self.write(&StreamResult::Temporary(bun_ptr::RawSlice::new(&utf8)))
    }

    pub fn write_utf16(&mut self, data: &StreamResult) -> Writable {
        if self.ended {
            return Writable::Done;
        }
        // Caller guarantees u16 alignment / even length; bytemuck checks at runtime.
        let utf16: &[u16] = bytemuck::cast_slice(data.slice());
        let utf8 = strings::to_utf8_alloc_with_type(utf16);
        self.write(&StreamResult::Temporary(bun_ptr::RawSlice::new(&utf8)))
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
        if wait {
            let has_buffered = self
                .task_mut()
                .and_then(|t| t.stream_buffer_mut())
                .is_some_and(|b| !b.lock().is_empty());
            if has_buffered {
                self.flush_promise = JSPromiseStrong::init(global_this);
                return bun_sys::Result::Ok(self.flush_promise.value());
            }
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
        // `write_end_request` releases the `+1` taken in `start_request_stream`;
        // clear `task` so `finalize` does not release it again.
        if let Some(mut task) = self.task.take() {
            // SAFETY: see `task_mut` — exclusive while `&mut self` held.
            unsafe { task.get_mut() }.write_end_request(None);
        }
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
            // sink is dropped without `end()` having run.
            FetchTasklet::deref(task.as_ptr());
        }
    }

    /// Called from `FetchTasklet::resume_request_data_stream` (main thread)
    /// after the HTTP thread reports the shared stream buffer has drained.
    /// Resolves any pending `flush(true)` promise and signals readiness so
    /// `readStreamIntoSink`'s pump resumes pulling.
    pub fn on_drain(&mut self, global_this: &JSGlobalObject) {
        bun_core::scoped_log!(FetchRequestBodySinkLog, "onDrain");
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
