//! `createHistogram()` and `monitorEventLoopDelay()` of `node:perf_hooks`. The classes are in
//! `src/js/internal/perf_hooks/histogram.ts`.

use core::cell::{Cell, RefCell};
use core::sync::atomic::{AtomicUsize, Ordering};
use std::collections::BTreeMap;
use std::rc::Rc;
use std::sync::Arc;

use bun_core::{Timespec, TimespecMockMode};
use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsPayload as _, JsScope, JsWrapper, to_js};
use bun_jsc::{ErrorCode, JSBigInt, JSGlobalObject, JSMap, JSValue, JsResult, MAX_SAFE_INTEGER};
use bun_threading::Guarded;

use crate::timer::event_loop_delay_monitor;

pub(crate) struct Histogram {
    kind: Kind,
    counts: RefCell<Counts>,
    memory: Arc<Memory>,
}

/// What the garbage collector is told, from its own threads. The numbers are only a hint to it, and nothing is read in
/// the light of them, so every access is relaxed.
struct Memory {
    /// The bytes of the counts.
    size: AtomicUsize,
    /// How many objects share the counts.
    owners: AtomicUsize,
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

enum Counts {
    /// Only this object has them, so `record()` takes no lock.
    Own(State),
    /// A structured clone, which can be on another thread, or a timer has them too.
    Shared(Arc<Guarded<State>>),
}

struct State {
    histogram: bun_histogram::Histogram,
    /// When `record_delta` last ran, or 0.
    previous_ns: u64,
}

/// An `ELDHistogram`, as the timer that samples the event loop sees it.
pub(crate) struct Interval {
    state: Arc<Guarded<State>>,
    memory: Arc<Memory>,
    /// Never 0.
    pub(crate) resolution_ms: u32,
}

impl State {
    /// Records the time since the last call, if there was one.
    fn record_delta(&mut self, now: Timespec) {
        let now_ns = now.ns();
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
    /// Returns the time of the sample.
    pub(crate) fn sample(&self) -> Timespec {
        let now = Timespec::now(TimespecMockMode::ForceRealTime);
        let mut state = self.state.lock();
        state.record_delta(now);
        // The GC sees the new size when it next marks the histogram. That is soon enough for one sample per turn of
        // the event loop.
        self.memory.update(&state);
        now
    }
}

impl Memory {
    /// Returns the bytes that `state`, which the caller has exclusive access to, has grown by.
    fn update(&self, state: &State) -> usize {
        let size = state.histogram.memory_size();
        let before = self.size.load(Ordering::Relaxed);
        if size != before {
            self.size.store(size, Ordering::Relaxed);
        }
        size.saturating_sub(before)
    }
}

impl Histogram {
    fn new(kind: Kind, counts: Counts, memory: Arc<Memory>) -> Self {
        memory.owners.fetch_add(1, Ordering::Relaxed);
        Self {
            kind,
            counts: RefCell::new(counts),
            memory,
        }
    }

    pub(crate) fn estimated_size(&self) -> usize {
        self.memory.size.load(Ordering::Relaxed) / self.memory.owners.load(Ordering::Relaxed).max(1)
    }

    /// `f` does not reach another histogram.
    /// `receiver` is the JS object of `self`.
    fn with<'a, T>(
        &self,
        heap: &JsHeap<'a>,
        receiver: JsLocal<'a>,
        f: impl FnOnce(&mut State) -> T,
    ) -> T {
        let with = |state: &mut State| (f(state), self.memory.update(state));
        let (result, grown) = match &mut *self.counts.borrow_mut() {
            Counts::Own(state) => with(state),
            Counts::Shared(state) => with(&mut state.lock()),
        };
        if grown > 0 {
            // This can collect, so the counts are no longer borrowed.
            heap.report_extra_memory(receiver, grown);
        }
        result
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

impl Drop for Histogram {
    fn drop(&mut self) {
        self.memory.owners.fetch_sub(1, Ordering::Relaxed);
    }
}

fn new_state(histogram: bun_histogram::Histogram) -> (State, Arc<Memory>) {
    let memory = Arc::new(Memory {
        size: AtomicUsize::new(histogram.memory_size()),
        owners: AtomicUsize::new(0),
    });
    let state = State {
        histogram,
        previous_ns: 0,
    };
    (state, memory)
}

pub(crate) fn create_recordable<'a>(
    heap: &JsHeap<'a>,
    lowest: u64,
    highest: u64,
    figures: u32,
) -> Option<JsWrapper<'a, Histogram>> {
    let (state, memory) = new_state(bun_histogram::Histogram::new(lowest, highest, figures)?);
    Some(Histogram::new(Kind::Recordable, Counts::Own(state), memory).into_js(heap))
}

pub(crate) fn create_interval<'a>(heap: &JsHeap<'a>, resolution: f64) -> JsWrapper<'a, Histogram> {
    // https://github.com/nodejs/node/blob/v26.3.0/src/node_perf.cc#L298
    let histogram = bun_histogram::Histogram::new(1000, i64::MAX as u64, 3);
    let (state, memory) = new_state(histogram.expect("a valid range"));
    let state = Arc::new(Guarded::new(state));
    let kind = Kind::Interval {
        interval: Rc::new(Interval {
            state: Arc::clone(&state),
            memory: Arc::clone(&memory),
            // `as` saturates.
            resolution_ms: (resolution as u32).max(1),
        }),
        enabled: Cell::new(false),
    };
    Histogram::new(kind, Counts::Shared(state), memory).into_js(heap)
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
    histogram(heap, receiver)?.with(heap, receiver, |state| {
        state.histogram.reset();
        state.previous_ns = 0;
    });
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
    this.with(heap, receiver, |state| state.histogram.record(value));
    Ok(true)
}

pub(crate) fn record_delta<'a>(
    heap: &JsHeap<'a>,
    receiver: JsLocal<'a>,
) -> bindgen::Result<'a, ()> {
    let now = Timespec::now(TimespecMockMode::ForceRealTime);
    recordable(heap, receiver)?.with(heap, receiver, |state| state.record_delta(now));
    Ok(())
}

/// `false` unless `other` is a `RecordableHistogram`.
pub(crate) fn add<'a>(
    heap: &JsHeap<'a>,
    receiver: JsLocal<'a>,
    other: JsLocal<'a>,
) -> bindgen::Result<'a, bool> {
    let this = recordable(heap, receiver)?;
    if !is_recordable(other) {
        return Ok(false);
    }
    let other = recordable(heap, other)?;
    if core::ptr::eq(this, other) {
        this.with(heap, receiver, State::add_to_itself);
        return Ok(true);
    }
    match (&mut *this.counts.borrow_mut(), &*other.counts.borrow()) {
        (Counts::Own(this), Counts::Own(other)) => this.add(other),
        (Counts::Own(this), Counts::Shared(other)) => this.add(&other.lock()),
        (Counts::Shared(this), Counts::Own(other)) => this.lock().add(other),
        (Counts::Shared(this), Counts::Shared(other)) if Arc::ptr_eq(this, other) => {
            this.lock().add_to_itself();
        }
        // In the order of their addresses: another thread may be adding the two the other way around.
        (Counts::Shared(this), Counts::Shared(other)) if Arc::as_ptr(this) < Arc::as_ptr(other) => {
            let mut this = this.lock();
            this.add(&other.lock());
        }
        (Counts::Shared(this), Counts::Shared(other)) => {
            let other = other.lock();
            this.lock().add(&other);
        }
    }
    this.with(heap, receiver, |_| {});
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
        this.with(heap, receiver, |state| state.previous_ns = 0);
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

/// The histograms in the structured clone messages that exist, on any thread, by what the message has in their place.
static IN_FLIGHT: Guarded<BTreeMap<u64, InFlight>> = Guarded::new(BTreeMap::new());

struct InFlight {
    state: Arc<Guarded<State>>,
    memory: Arc<Memory>,
    recordable: bool,
}

/// `histogram` is a `Histogram`.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Histogram__retainForStructuredClone(histogram: JSValue) -> u64 {
    let Some(histogram) = histogram.as_class_ref::<Histogram>() else {
        return 0;
    };
    let in_flight = InFlight {
        state: histogram.share(),
        memory: Arc::clone(&histogram.memory),
        recordable: matches!(histogram.kind, Kind::Recordable),
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
    let histogram = {
        let in_flight = IN_FLIGHT.lock();
        let Some(found) = in_flight.get(&id) else {
            return JSValue::ZERO;
        };
        let kind = if found.recordable {
            Kind::Recordable
        } else {
            Kind::Plain
        };
        let counts = Counts::Shared(Arc::clone(&found.state));
        Histogram::new(kind, counts, Arc::clone(&found.memory))
    };
    histogram.into_js_wrapper(global).to_js()
}

/// The message with this id is gone.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Histogram__releaseStructuredClone(id: u64) {
    IN_FLIGHT.lock().remove(&id);
}
