//! The histogram classes of `node:perf_hooks`, which `createHistogram()` and `monitorEventLoopDelay()` return.

use core::cell::{Cell, RefCell};
use core::sync::atomic::{AtomicUsize, Ordering};
use std::collections::BTreeMap;
use std::rc::Rc;
use std::sync::Arc;

use bun_core::fmt::{NodeNumber, OutOfRangeOptions, double, out_of_range};
use bun_core::{Timespec, TimespecMockMode};
use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsPayload as _, JsScope, JsWrapper, to_js};
use bun_jsc::{ErrorCode, JSBigInt, JSGlobalObject, JSMap, JSValue, JsResult, MAX_SAFE_INTEGER};
use bun_threading::Guarded;

use crate::generated_bindgen::histogram::{HistogramJSON, js_ELDHistogram, js_RecordableHistogram};
use crate::node::util::validators;
use crate::timer::event_loop_delay_monitor;

/// The GC is told what JavaScriptCore tells it of a `SharedArrayBuffer`, which also grows and which a structured clone
/// also shares with other threads. Every object, a clone too, counts the whole size (`JSArrayBuffer::finishCreation`):
/// bindgen does that, from `estimated_size`. Growth counts in the thread that grew it (`ArrayBuffer::grow`).
pub(crate) struct Histogram {
    counts: RefCell<Counts>,
    size: Arc<Size>,
    /// Of an `ELDHistogram`, with whether it is enabled.
    interval: Option<(Rc<Interval>, Cell<bool>)>,
}

/// The bytes of the counts. An atomic because a marking thread reads it. It is only a hint to the GC, and nothing is
/// read in the light of it, so every access is relaxed.
struct Size(AtomicUsize);

enum Counts {
    /// Only this object has them, so `record()` takes no lock.
    Own(State),
    /// A structured clone, which can be on another thread, or a timer has them too.
    Shared(Arc<Guarded<State>>),
}

struct State {
    histogram: bun_histogram::Histogram,
    /// When `record_delta` last ran, or 0. `recordDelta()` and `Interval::sample` read different
    /// clocks, and no histogram has both.
    previous_ns: u64,
}

/// An `ELDHistogram`, as the timer that samples the event loop sees it.
pub(crate) struct Interval {
    state: Arc<Guarded<State>>,
    size: Arc<Size>,
    /// Never 0.
    pub(crate) resolution_ms: u32,
}

impl State {
    /// Records the time since the last call, if there was one.
    fn record_delta(&mut self, now_ns: u64) {
        if self.previous_ns > 0 {
            self.histogram
                .record(now_ns.saturating_sub(self.previous_ns));
        }
        self.previous_ns = now_ns;
    }

    fn add(&mut self, other: &State) {
        self.histogram.add(&other.histogram);
        self.previous_ns = self.previous_ns.max(other.previous_ns);
    }

    fn add_to_itself(&mut self) {
        let copy = self.histogram.clone();
        self.histogram.add(&copy);
    }
}

impl Interval {
    /// Returns the time of the sample, and the bytes that the counts have grown by.
    pub(crate) fn sample(&self) -> (Timespec, usize) {
        let now = Timespec::now(TimespecMockMode::ForceRealTime);
        let mut state = self.state.lock();
        state.record_delta(now.ns());
        (now, self.size.update(&state))
    }
}

impl Size {
    /// Returns the bytes that `state`, which the caller has exclusive access to, has grown by.
    fn update(&self, state: &State) -> usize {
        let size = state.histogram.memory_size();
        let before = self.0.load(Ordering::Relaxed);
        if size != before {
            self.0.store(size, Ordering::Relaxed);
        }
        size.saturating_sub(before)
    }
}

impl Histogram {
    pub(crate) fn estimated_size(&self) -> usize {
        self.size.0.load(Ordering::Relaxed)
    }

    /// Returns what `f` does, and the bytes that the counts have grown by. `f` does not reach another histogram.
    fn with<T>(&self, f: impl FnOnce(&mut State) -> T) -> (T, usize) {
        let with = |state: &mut State| (f(state), self.size.update(state));
        match &mut *self.counts.borrow_mut() {
            Counts::Own(state) => with(state),
            Counts::Shared(state) => with(&mut state.lock()),
        }
    }

    /// This can collect, so the caller has not borrowed the counts.
    fn report_growth<'a>(heap: &JsHeap<'a>, this_value: JsWrapper<'a, Self>, grown: usize) {
        if grown > 0 {
            heap.report_extra_memory(this_value.as_value(), grown);
        }
    }

    fn read<T>(&self, read: impl FnOnce(&bun_histogram::Histogram) -> T) -> T {
        match &*self.counts.borrow() {
            Counts::Own(state) => read(&state.histogram),
            Counts::Shared(state) => read(&state.lock().histogram),
        }
    }

    fn share(&self) -> Arc<Guarded<State>> {
        let mut counts = self.counts.borrow_mut();
        let shared = match &mut *counts {
            Counts::Own(state) => Arc::new(Guarded::new(State {
                histogram: state.histogram.take(),
                previous_ns: state.previous_ns,
            })),
            Counts::Shared(state) => return Arc::clone(state),
        };
        *counts = Counts::Shared(Arc::clone(&shared));
        shared
    }
}

fn new_state(histogram: bun_histogram::Histogram) -> (State, Arc<Size>) {
    let size = Arc::new(Size(AtomicUsize::new(histogram.memory_size())));
    let state = State {
        histogram,
        previous_ns: 0,
    };
    (state, size)
}

pub(crate) fn create_recordable<'a>(
    heap: &JsHeap<'a>,
    lowest: u64,
    highest: u64,
    figures: u32,
) -> Option<JsWrapper<'a, Histogram>> {
    let (state, size) = new_state(bun_histogram::Histogram::new(lowest, highest, figures)?);
    let histogram = Histogram {
        counts: RefCell::new(Counts::Own(state)),
        size,
        interval: None,
    };
    Some(js_RecordableHistogram::create(heap, histogram))
}

pub(crate) fn create_interval<'a>(heap: &JsHeap<'a>, resolution: f64) -> JsWrapper<'a, Histogram> {
    // https://github.com/nodejs/node/blob/v26.3.0/src/node_perf.cc#L298
    let histogram = bun_histogram::Histogram::new(1000, i64::MAX as u64, 3);
    let (state, size) = new_state(histogram.expect("a valid range"));
    let state = Arc::new(Guarded::new(state));
    let interval = Rc::new(Interval {
        state: Arc::clone(&state),
        size: Arc::clone(&size),
        // `as` saturates.
        resolution_ms: (resolution as u32).max(1),
    });
    let histogram = Histogram {
        counts: RefCell::new(Counts::Shared(state)),
        size,
        interval: Some((interval, Cell::new(false))),
    };
    js_ELDHistogram::create(heap, histogram)
}

pub(crate) fn is_histogram(value: JsLocal<'_>) -> bool {
    value.to_js().as_class_ref::<Histogram>().is_some()
}

/// `Histogram`
impl Histogram {
    pub(crate) fn get_count(&self) -> u64 {
        self.read(|histogram| histogram.count())
    }

    pub(crate) fn get_min(&self) -> u64 {
        self.read(|histogram| histogram.min())
    }

    pub(crate) fn get_max(&self) -> u64 {
        self.read(|histogram| histogram.max())
    }

    pub(crate) fn get_mean(&self) -> f64 {
        self.read(|histogram| histogram.mean())
    }

    pub(crate) fn get_exceeds(&self) -> u64 {
        self.read(|histogram| histogram.exceeds())
    }

    pub(crate) fn get_stddev(&self) -> f64 {
        self.read(|histogram| histogram.stddev())
    }

    fn percentiles_map<'a>(
        &self,
        cx: &mut JsScope<'a>,
        value_to_js: impl Fn(&JSGlobalObject, u64) -> JsResult<JSValue>,
    ) -> bindgen::Result<'a, JSValue> {
        let percentiles = self.read(|histogram| histogram.percentiles());
        let global = cx.global();
        let value = JSMap::create(global);
        if let Some(map) = JSMap::from_js(value) {
            let map = JSMap::opaque_mut(map.as_ptr());
            for (percentile, at) in percentiles {
                map.set(
                    global,
                    JSValue::js_number(percentile),
                    value_to_js(global, at)?,
                )?;
            }
        }
        Ok(value)
    }

    pub(crate) fn get_percentiles<'a>(&self, cx: &mut JsScope<'a>) -> bindgen::Result<'a, JSValue> {
        self.percentiles_map(cx, |_, value| Ok(JSValue::js_number_from_uint64(value)))
    }

    pub(crate) fn get_percentiles_big_int<'a>(
        &self,
        cx: &mut JsScope<'a>,
    ) -> bindgen::Result<'a, JSValue> {
        self.percentiles_map(cx, JSValue::from_uint64_no_truncate)
    }

    pub(crate) fn percentile<'a>(
        &self,
        heap: &JsHeap<'a>,
        percentile: f64,
    ) -> bindgen::Result<'a, u64> {
        if !(percentile > 0.0 && percentile <= 100.0) {
            let options = OutOfRangeOptions {
                field_name: b"percentile",
                msg: b"> 0 && <= 100",
                ..Default::default()
            };
            return Err(heap.error_with_code(
                ErrorCode::OUT_OF_RANGE,
                format_args!("{}", out_of_range(NodeNumber(percentile), options)),
            ));
        }
        Ok(self.read(|histogram| histogram.value_at_percentile(percentile)))
    }

    pub(crate) fn reset(&self) {
        self.with(|state| {
            state.histogram.reset();
            state.previous_ns = 0;
        });
    }

    pub(crate) fn to_json<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, HistogramJSON<'a>> {
        let (json, percentiles) = self.read(|histogram| {
            let json = HistogramJSON {
                count: histogram.count(),
                min: histogram.min(),
                max: histogram.max(),
                mean: histogram.mean(),
                exceeds: histogram.exceeds(),
                stddev: histogram.stddev(),
                percentiles: JsLocal::NULL,
            };
            (json, histogram.percentiles())
        });
        let percentiles = percentiles
            .into_iter()
            .map(|(percentile, at)| (double(percentile).to_string(), at));
        Ok(HistogramJSON {
            percentiles: to_js::record(heap, percentiles, to_js::u64)?,
            ..json
        })
    }
}

/// `RecordableHistogram`
impl Histogram {
    pub(crate) fn record<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        val: JsLocal<'a>,
    ) -> bindgen::Result<'a, ()> {
        let val = val.to_js();
        let big_int = if val.is_number() {
            None
        } else {
            JSBigInt::from_js(val)
        };
        let value = if let Some(big_int) = big_int {
            if !val.is_big_int_in_int64_range(1, i64::MAX) {
                // https://github.com/nodejs/node/blob/v26.3.0/src/histogram.cc#L181
                return Err(cx.heap.error_with_code(
                    ErrorCode::OUT_OF_RANGE,
                    format_args!("value is out of range"),
                ));
            }
            big_int.to_int64() as u64
        } else {
            validators::validate_integer(cx.global(), val, "val", Some(1), Some(MAX_SAFE_INTEGER))?
                as u64
        };
        let (_, grown) = self.with(|state| state.histogram.record(value));
        Self::report_growth(&cx.heap, this_value, grown);
        Ok(())
    }

    pub(crate) fn record_delta<'a>(&self, this_value: JsWrapper<'a, Self>, heap: &JsHeap<'a>) {
        unsafe extern "C" {
            /// `Timespec::now` has whole microseconds on macOS.
            safe fn uv_hrtime() -> u64;
        }
        let ((), grown) = self.with(|state| state.record_delta(uv_hrtime()));
        Self::report_growth(heap, this_value, grown);
    }

    pub(crate) fn add<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        other: &Histogram,
    ) {
        let add = |into: &mut State, other: &State| {
            into.add(other);
            self.size.update(into)
        };
        let grown = if core::ptr::eq(self, other) {
            self.with(State::add_to_itself).1
        } else {
            match (&mut *self.counts.borrow_mut(), &*other.counts.borrow()) {
                (Counts::Own(this), Counts::Own(other)) => add(this, other),
                (Counts::Own(this), Counts::Shared(other)) => add(this, &other.lock()),
                (Counts::Shared(this), Counts::Own(other)) => add(&mut this.lock(), other),
                (Counts::Shared(state), Counts::Shared(other)) if Arc::ptr_eq(state, other) => {
                    let mut state = state.lock();
                    state.add_to_itself();
                    self.size.update(&state)
                }
                // In the order of their addresses: another thread may be adding the two the other way around.
                (Counts::Shared(this), Counts::Shared(other))
                    if Arc::as_ptr(this) < Arc::as_ptr(other) =>
                {
                    let mut this = this.lock();
                    add(&mut this, &other.lock())
                }
                (Counts::Shared(this), Counts::Shared(other)) => {
                    let other = other.lock();
                    add(&mut this.lock(), &other)
                }
            }
        };
        Self::report_growth(heap, this_value, grown);
    }
}

/// `ELDHistogram`
impl Histogram {
    /// Returns whether that changes it.
    fn set_enabled(&self, enable: bool) -> bool {
        let Some((interval, enabled)) = &self.interval else {
            return false;
        };
        if enabled.replace(enable) == enable {
            return false;
        }
        if enable {
            // The time it was disabled for is not a delay of the event loop.
            self.with(|state| state.previous_ns = 0);
            event_loop_delay_monitor::enable(interval);
        } else {
            event_loop_delay_monitor::disable(interval);
        }
        true
    }

    pub(crate) fn enable(&self) -> bool {
        self.set_enabled(true)
    }

    pub(crate) fn disable(&self) -> bool {
        self.set_enabled(false)
    }
}

/// The histograms in the structured clone messages that exist, on any thread, by what the message has in their place.
static IN_FLIGHT: Guarded<BTreeMap<u64, InFlight>> = Guarded::new(BTreeMap::new());

struct InFlight {
    state: Arc<Guarded<State>>,
    size: Arc<Size>,
    recordable: bool,
}

/// `histogram` is a `Histogram`.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Histogram__retainForStructuredClone(histogram: JSValue) -> u64 {
    let recordable = js_RecordableHistogram::from_js(histogram).is_some();
    let Some(histogram) = histogram.as_class_ref::<Histogram>() else {
        return 0;
    };
    let in_flight = InFlight {
        state: histogram.share(),
        size: Arc::clone(&histogram.size),
        recordable,
    };
    // Not one that bytes from elsewhere (IPC, `v8.deserialize()`) can guess.
    let mut id = [0; 8];
    bun_boringssl_sys::rand_bytes(&mut id);
    let id = u64::from_ne_bytes(id);
    IN_FLIGHT.lock().insert(id, in_flight);
    id
}

/// `JSValue::ZERO` if no message has this id. A message can be read many times (`BroadcastChannel`).
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Histogram__fromStructuredClone(
    global: &JSGlobalObject,
    id: u64,
) -> JSValue {
    let (histogram, recordable) = {
        let in_flight = IN_FLIGHT.lock();
        let Some(found) = in_flight.get(&id) else {
            return JSValue::ZERO;
        };
        let histogram = Histogram {
            counts: RefCell::new(Counts::Shared(Arc::clone(&found.state))),
            size: Arc::clone(&found.size),
            interval: None,
        };
        (histogram, found.recordable)
    };
    if recordable {
        js_RecordableHistogram::create_wrapper(global, histogram).to_js()
    } else {
        // The clone of an `ELDHistogram` is of neither subclass.
        histogram.into_js_wrapper(global).to_js()
    }
}

/// The message with this id is gone.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Histogram__releaseStructuredClone(id: u64) {
    IN_FLIGHT.lock().remove(&id);
}
