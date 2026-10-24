//! `createHistogram()` and `monitorEventLoopDelay()` of `node:perf_hooks`. The classes are in
//! `src/js/internal/perf_hooks/histogram.ts`.

use core::cell::Cell;
use core::sync::atomic::{AtomicU64, Ordering};
use std::rc::Rc;
use std::sync::Arc;

use bun_core::{Timespec, TimespecMockMode};
use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsPayload as _, JsScope, JsWrapper, to_js};
use bun_jsc::{ErrorCode, JSBigInt, JSGlobalObject, JSMap, JSValue, JsResult, MAX_SAFE_INTEGER};
use bun_threading::Guarded;

use crate::timer::event_loop_delay_monitor;

pub(crate) struct Histogram {
    counts: Arc<Counts>,
    kind: Kind,
}

enum Kind {
    /// A `Histogram` that is neither of the others: the structured clone of an `ELDHistogram`.
    Plain,
    Recordable,
    Interval {
        interval: Rc<Interval>,
        enabled: Cell<bool>,
    },
}

/// What a histogram and its structured clones share, on any thread.
struct Counts {
    memory_size: usize,
    state: Guarded<State>,
}

struct State {
    histogram: bun_histogram::Histogram,
    /// When `record_delta` last ran, or 0.
    previous_ns: u64,
}

/// An `ELDHistogram`, as the timer that samples the event loop sees it.
pub(crate) struct Interval {
    counts: Arc<Counts>,
    /// Never 0.
    pub(crate) resolution_ms: u32,
}

impl Counts {
    fn new(histogram: bun_histogram::Histogram) -> Arc<Self> {
        Arc::new(Self {
            memory_size: size_of::<Self>() + histogram.memory_size(),
            state: Guarded::new(State {
                histogram,
                previous_ns: 0,
            }),
        })
    }

    /// Records the time since the last call, if there was one.
    fn record_delta(&self) {
        let now_ns = Timespec::now(TimespecMockMode::ForceRealTime).ns();
        let mut state = self.state.lock();
        if state.previous_ns > 0 {
            let delta = now_ns.saturating_sub(state.previous_ns);
            state.histogram.record(delta);
        }
        state.previous_ns = now_ns;
    }
}

impl Interval {
    pub(crate) fn sample(&self) {
        self.counts.record_delta();
    }
}

impl Histogram {
    pub(crate) fn estimated_size(&self) -> usize {
        self.counts.memory_size
    }

    fn read<T>(&self, read: impl FnOnce(&bun_histogram::Histogram) -> T) -> T {
        read(&self.counts.state.lock().histogram)
    }
}

pub(crate) fn create_recordable<'a>(
    heap: &JsHeap<'a>,
    lowest: u64,
    highest: u64,
    figures: u32,
) -> Option<JsWrapper<'a, Histogram>> {
    let counts = Counts::new(bun_histogram::Histogram::new(lowest, highest, figures)?);
    let kind = Kind::Recordable;
    Some(Histogram { counts, kind }.into_js(heap))
}

pub(crate) fn create_interval<'a>(heap: &JsHeap<'a>, resolution: f64) -> JsWrapper<'a, Histogram> {
    // https://github.com/nodejs/node/blob/v26.3.0/src/node_perf.cc#L298
    let histogram = bun_histogram::Histogram::new(1000, i64::MAX as u64, 3);
    let counts = Counts::new(histogram.expect("a valid range"));
    let interval = Rc::new(Interval {
        counts: Arc::clone(&counts),
        // `as` saturates.
        resolution_ms: (resolution as u32).max(1),
    });
    let kind = Kind::Interval {
        interval,
        enabled: Cell::new(false),
    };
    Histogram { counts, kind }.into_js(heap)
}

pub(crate) fn is_histogram(value: JsLocal<'_>) -> bool {
    value.to_js().as_class_ref::<Histogram>().is_some()
}

pub(crate) fn is_recordable(value: JsLocal<'_>) -> bool {
    value
        .to_js()
        .as_class_ref::<Histogram>()
        .is_some_and(|histogram| matches!(histogram.kind, Kind::Recordable))
}

/// The `this` of a member of `class`.
fn instance_of<'a>(
    heap: &JsHeap<'a>,
    receiver: JsLocal<'a>,
    class: &str,
    is_instance: impl FnOnce(&Kind) -> bool,
) -> bindgen::Result<'a, &'a Histogram> {
    receiver
        .to_js()
        .as_class_ref::<Histogram>()
        .filter(|histogram| is_instance(&histogram.kind))
        .ok_or_else(|| {
            heap.error_with_code(
                ErrorCode::INVALID_THIS,
                format_args!("Value of \"this\" must be of type {class}"),
            )
        })
}

fn histogram<'a>(heap: &JsHeap<'a>, receiver: JsLocal<'a>) -> bindgen::Result<'a, &'a Histogram> {
    instance_of(heap, receiver, "Histogram", |_| true)
}

fn recordable<'a>(heap: &JsHeap<'a>, receiver: JsLocal<'a>) -> bindgen::Result<'a, &'a Histogram> {
    instance_of(heap, receiver, "RecordableHistogram", |kind| {
        matches!(kind, Kind::Recordable)
    })
}

pub(crate) fn count<'a>(heap: &JsHeap<'a>, receiver: JsLocal<'a>) -> bindgen::Result<'a, u64> {
    Ok(histogram(heap, receiver)?.read(|histogram| histogram.count()))
}

pub(crate) fn min<'a>(heap: &JsHeap<'a>, receiver: JsLocal<'a>) -> bindgen::Result<'a, u64> {
    Ok(histogram(heap, receiver)?.read(|histogram| histogram.min()))
}

pub(crate) fn max<'a>(heap: &JsHeap<'a>, receiver: JsLocal<'a>) -> bindgen::Result<'a, u64> {
    Ok(histogram(heap, receiver)?.read(|histogram| histogram.max()))
}

pub(crate) fn mean<'a>(heap: &JsHeap<'a>, receiver: JsLocal<'a>) -> bindgen::Result<'a, f64> {
    Ok(histogram(heap, receiver)?.read(|histogram| histogram.mean()))
}

pub(crate) fn exceeds<'a>(heap: &JsHeap<'a>, receiver: JsLocal<'a>) -> bindgen::Result<'a, u64> {
    Ok(histogram(heap, receiver)?.read(|histogram| histogram.exceeds()))
}

pub(crate) fn stddev<'a>(heap: &JsHeap<'a>, receiver: JsLocal<'a>) -> bindgen::Result<'a, f64> {
    Ok(histogram(heap, receiver)?.read(|histogram| histogram.stddev()))
}

fn percentiles_map<'a>(
    cx: &mut JsScope<'a>,
    receiver: JsLocal<'a>,
    value_to_js: impl Fn(&JSGlobalObject, u64) -> JsResult<JSValue>,
) -> bindgen::Result<'a, JSValue> {
    let percentiles = histogram(&cx.heap, receiver)?.read(|histogram| histogram.percentiles());
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

pub(crate) fn percentiles<'a>(
    cx: &mut JsScope<'a>,
    receiver: JsLocal<'a>,
) -> bindgen::Result<'a, JSValue> {
    percentiles_map(cx, receiver, |_, value| {
        Ok(JSValue::js_number_from_uint64(value))
    })
}

pub(crate) fn percentiles_big_int<'a>(
    cx: &mut JsScope<'a>,
    receiver: JsLocal<'a>,
) -> bindgen::Result<'a, JSValue> {
    percentiles_map(cx, receiver, JSValue::from_uint64_no_truncate)
}

/// `None` unless `percentile` is a number above 0 and at most 100.
pub(crate) fn percentile<'a>(
    heap: &JsHeap<'a>,
    receiver: JsLocal<'a>,
    percentile: JsLocal<'a>,
) -> bindgen::Result<'a, Option<u64>> {
    let this = histogram(heap, receiver)?;
    let percentile = percentile.to_js();
    if !percentile.is_number() {
        return Ok(None);
    }
    let percentile = percentile.as_number();
    if !(percentile > 0.0 && percentile <= 100.0) {
        return Ok(None);
    }
    Ok(Some(this.read(|histogram| {
        histogram.value_at_percentile(percentile)
    })))
}

pub(crate) fn percentile_big_int<'a>(
    heap: &JsHeap<'a>,
    receiver: JsLocal<'a>,
    value: JsLocal<'a>,
) -> bindgen::Result<'a, JsLocal<'a>> {
    match percentile(heap, receiver, value)? {
        Some(value) => to_js::u64_as_bigint(heap, value),
        None => Ok(JsLocal::NULL),
    }
}

pub(crate) fn reset<'a>(heap: &JsHeap<'a>, receiver: JsLocal<'a>) -> bindgen::Result<'a, ()> {
    let mut state = histogram(heap, receiver)?.counts.state.lock();
    state.histogram.reset();
    state.previous_ns = 0;
    Ok(())
}

/// `false` unless `value` is a BigInt or an integer from 1 to `Number.MAX_SAFE_INTEGER`.
pub(crate) fn record<'a>(
    heap: &JsHeap<'a>,
    receiver: JsLocal<'a>,
    value: JsLocal<'a>,
) -> bindgen::Result<'a, bool> {
    let this = recordable(heap, receiver)?;
    let value = value.to_js();
    let value = if value.is_number() {
        let number = value.as_number();
        if !(number >= 1.0 && number <= MAX_SAFE_INTEGER as f64 && number.trunc() == number) {
            return Ok(false);
        }
        number as u64
    } else if let Some(big_int) = JSBigInt::from_js(value) {
        if !value.is_big_int_in_int64_range(1, i64::MAX) {
            // https://github.com/nodejs/node/blob/v26.3.0/src/histogram.cc#L181
            return Err(heap.error_with_code(
                ErrorCode::OUT_OF_RANGE,
                format_args!("value is out of range"),
            ));
        }
        big_int.to_int64() as u64
    } else {
        return Ok(false);
    };
    this.counts.state.lock().histogram.record(value);
    Ok(true)
}

pub(crate) fn record_delta<'a>(
    heap: &JsHeap<'a>,
    receiver: JsLocal<'a>,
) -> bindgen::Result<'a, ()> {
    recordable(heap, receiver)?.counts.record_delta();
    Ok(())
}

/// `false` unless `other` is a `RecordableHistogram`.
pub(crate) fn add<'a>(
    heap: &JsHeap<'a>,
    receiver: JsLocal<'a>,
    other: JsLocal<'a>,
) -> bindgen::Result<'a, bool> {
    let this = &recordable(heap, receiver)?.counts;
    if !is_recordable(other) {
        return Ok(false);
    }
    let other = &recordable(heap, other)?.counts;
    if Arc::ptr_eq(this, other) {
        let mut state = this.state.lock();
        let copy = state.histogram.clone();
        state.histogram.add(&copy);
        return Ok(true);
    }
    // In the order of their addresses: another thread may be adding the two the other way around.
    let (mut this, other) = if Arc::as_ptr(this) < Arc::as_ptr(other) {
        let this = this.state.lock();
        (this, other.state.lock())
    } else {
        let other = other.state.lock();
        (this.state.lock(), other)
    };
    this.histogram.add(&other.histogram);
    this.previous_ns = this.previous_ns.max(other.previous_ns);
    Ok(true)
}

fn set_enabled<'a>(
    heap: &JsHeap<'a>,
    receiver: JsLocal<'a>,
    enable: bool,
) -> bindgen::Result<'a, bool> {
    let this = instance_of(heap, receiver, "ELDHistogram", |kind| {
        matches!(kind, Kind::Interval { .. })
    })?;
    let Kind::Interval { interval, enabled } = &this.kind else {
        return Ok(false);
    };
    if enabled.replace(enable) == enable {
        return Ok(false);
    }
    if enable {
        // The time it was disabled for is not a delay of the event loop.
        this.counts.state.lock().previous_ns = 0;
        event_loop_delay_monitor::enable(interval);
    } else {
        event_loop_delay_monitor::disable(interval);
    }
    Ok(true)
}

pub(crate) fn enable<'a>(heap: &JsHeap<'a>, receiver: JsLocal<'a>) -> bindgen::Result<'a, bool> {
    set_enabled(heap, receiver, true)
}

pub(crate) fn disable<'a>(heap: &JsHeap<'a>, receiver: JsLocal<'a>) -> bindgen::Result<'a, bool> {
    set_enabled(heap, receiver, false)
}

/// The histograms in the structured clone messages that exist, on any thread.
static IN_FLIGHT: Guarded<Vec<InFlight>> = Guarded::new(Vec::new());
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

struct InFlight {
    id: u64,
    counts: Arc<Counts>,
    recordable: bool,
}

/// `histogram` is a `Histogram`. The id is what the message has in its place.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Histogram__retainForStructuredClone(histogram: JSValue) -> u64 {
    let Some(histogram) = histogram.as_class_ref::<Histogram>() else {
        return 0;
    };
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    IN_FLIGHT.lock().push(InFlight {
        id,
        counts: Arc::clone(&histogram.counts),
        recordable: matches!(histogram.kind, Kind::Recordable),
    });
    id
}

/// `JSValue::ZERO` if no message has this id. A message can be read many times (`BroadcastChannel`).
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Histogram__fromStructuredClone(
    global: &JSGlobalObject,
    id: u64,
) -> JSValue {
    let (counts, recordable) = {
        let in_flight = IN_FLIGHT.lock();
        let Some(found) = in_flight.iter().find(|in_flight| in_flight.id == id) else {
            return JSValue::ZERO;
        };
        (Arc::clone(&found.counts), found.recordable)
    };
    let kind = if recordable {
        Kind::Recordable
    } else {
        Kind::Plain
    };
    Histogram { counts, kind }.into_js_wrapper(global).to_js()
}

/// The message with this id is gone.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Histogram__releaseStructuredClone(id: u64) {
    let mut in_flight = IN_FLIGHT.lock();
    if let Some(index) = in_flight.iter().position(|in_flight| in_flight.id == id) {
        in_flight.swap_remove(index);
    }
}
