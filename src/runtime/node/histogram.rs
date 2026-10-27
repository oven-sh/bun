//! The histogram classes of `node:perf_hooks`.

use core::cell::{Cell, RefCell};
use core::sync::atomic::{AtomicUsize, Ordering};
use std::collections::BTreeMap;
use std::rc::Rc;
use std::sync::Arc;

use bun_core::fmt::{NodeNumber, OutOfRangeOptions, double, out_of_range};
use bun_core::{Timespec, TimespecMockMode};
use bun_histogram::{
    Dequantize, DiffError, MannWhitney, RecordedSlots, Rotation, SlidingWindow, Welch,
};
use bun_jsc::bindgen::{
    self, BufferSource, JsHeap, JsLocal, JsPayload as _, JsScope, JsWrapper, to_js,
};
use bun_jsc::{
    BinaryType, ErrorCode, JSBigInt, JSGlobalObject, JSMap, JSPromiseStrong, JSValue, JsResult,
    MAX_SAFE_INTEGER,
};
use bun_threading::Guarded;

use crate::generated_bindgen::histogram::{
    ConfidenceInterval, ConfidenceOptions, HistogramJSON, MannWhitneyTest, MeanCI, PercentileCI,
    WelchTest, js_ELDHistogram, js_RecordableHistogram,
};
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
    /// Never 0. `None` if every iteration of the event loop is a sample.
    pub(crate) resolution_ms: Option<u32>,
    /// Only without a resolution.
    poll: Cell<Poll>,
}

/// The last time the event loop waited for something to happen.
#[derive(Clone, Copy, Default)]
struct Poll {
    started_ns: u64,
    /// `None` if it waits until something happens.
    timeout_ns: Option<u64>,
    ended_ns: u64,
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

    fn subtract_from_itself(&mut self) {
        let copy = self.histogram.clone();
        self.histogram.subtract(&copy);
    }
}

unsafe extern "C" {
    /// `Timespec::now` has whole microseconds on macOS.
    safe fn uv_hrtime() -> u64;
}

impl Interval {
    /// Returns the time of the sample, and the bytes that the counts have grown by.
    pub(crate) fn sample(&self) -> (Timespec, usize) {
        let now = Timespec::now(TimespecMockMode::ForceRealTime);
        let mut state = self.state.lock();
        state.record_delta(now.ns());
        (now, self.size.update(&state))
    }

    fn start_polling(&self) {
        let now = uv_hrtime();
        self.poll.set(Poll {
            started_ns: now,
            timeout_ns: Some(0),
            ended_ns: now,
        });
    }

    /// The event loop is about to wait, for `timeout_ns` at most.
    pub(crate) fn before_poll(&self, timeout_ns: Option<u64>) {
        self.poll.set(Poll {
            started_ns: uv_hrtime(),
            timeout_ns,
            ..self.poll.get()
        });
    }

    /// The event loop has waited. Records how long it was busy before that, and how much longer it waited than it
    /// was going to. Returns the bytes that the counts have grown by.
    /// https://github.com/nodejs/node/blob/v26.12.1/src/histogram.cc#L2754
    pub(crate) fn after_poll(&self) -> usize {
        let poll = self.poll.get();
        let now = uv_hrtime();
        let busy = poll.started_ns.saturating_sub(poll.ended_ns);
        let late = poll.timeout_ns.map_or(0, |timeout| {
            (now.saturating_sub(poll.started_ns)).saturating_sub(timeout)
        });
        self.poll.set(Poll {
            ended_ns: now,
            ..poll
        });
        let mut state = self.state.lock();
        state.histogram.record((busy + late).max(1));
        self.size.update(&state)
    }
}

impl Size {
    /// Returns the bytes that `state`, which the caller has exclusive access to, has grown by.
    fn update(&self, state: &State) -> usize {
        self.set(state.histogram.memory_size())
    }

    /// Returns how much more `size` is than before.
    fn set(&self, size: usize) -> usize {
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

    /// What `read` makes of the two, or `None` if they have the same counts.
    fn read_both<T>(
        &self,
        other: &Self,
        read: impl FnOnce(&bun_histogram::Histogram, &bun_histogram::Histogram) -> T,
    ) -> Option<T> {
        if core::ptr::eq(self, other) {
            return None;
        }
        Some(match (&*self.counts.borrow(), &*other.counts.borrow()) {
            (Counts::Own(this), Counts::Own(other)) => read(&this.histogram, &other.histogram),
            (Counts::Own(this), Counts::Shared(other)) => {
                read(&this.histogram, &other.lock().histogram)
            }
            (Counts::Shared(this), Counts::Own(other)) => {
                read(&this.lock().histogram, &other.histogram)
            }
            (Counts::Shared(this), Counts::Shared(other)) if Arc::ptr_eq(this, other) => {
                return None;
            }
            // In the order of their addresses: another thread may be reading the two the other way around.
            (Counts::Shared(this), Counts::Shared(other))
                if Arc::as_ptr(this) < Arc::as_ptr(other) =>
            {
                let this = this.lock();
                read(&this.histogram, &other.lock().histogram)
            }
            (Counts::Shared(this), Counts::Shared(other)) => {
                let other = other.lock();
                read(&this.lock().histogram, &other.histogram)
            }
        })
    }

    /// Changes this one by the other: `change` if they do not have the same counts, and `change_by_itself` if they do.
    /// Returns the bytes that the counts have grown by.
    fn change_by(
        &self,
        other: &Self,
        change: impl FnOnce(&mut State, &State),
        change_by_itself: impl FnOnce(&mut State),
    ) -> usize {
        if core::ptr::eq(self, other) {
            return self.with(change_by_itself).1;
        }
        let change = |this: &mut State, other: &State| {
            change(this, other);
            self.size.update(this)
        };
        match (&mut *self.counts.borrow_mut(), &*other.counts.borrow()) {
            (Counts::Own(this), Counts::Own(other)) => change(this, other),
            (Counts::Own(this), Counts::Shared(other)) => change(this, &other.lock()),
            (Counts::Shared(this), Counts::Own(other)) => change(&mut this.lock(), other),
            (Counts::Shared(state), Counts::Shared(other)) if Arc::ptr_eq(state, other) => {
                let mut state = state.lock();
                change_by_itself(&mut state);
                self.size.update(&state)
            }
            // In the order of their addresses: another thread may be changing the two the other way around.
            (Counts::Shared(this), Counts::Shared(other))
                if Arc::as_ptr(this) < Arc::as_ptr(other) =>
            {
                let mut this = this.lock();
                change(&mut this, &other.lock())
            }
            (Counts::Shared(this), Counts::Shared(other)) => {
                let other = other.lock();
                change(&mut this.lock(), &other)
            }
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

impl Histogram {
    /// With counts that nothing else has.
    fn new(histogram: bun_histogram::Histogram) -> Self {
        let (state, size) = new_state(histogram);
        Self {
            counts: RefCell::new(Counts::Own(state)),
            size,
            interval: None,
        }
    }
}

fn new_counts<'a>(
    heap: &JsHeap<'a>,
    lowest: u64,
    highest: u64,
    figures: u32,
) -> bindgen::Result<'a, bun_histogram::Histogram> {
    bun_histogram::Histogram::new(lowest, highest, figures).ok_or_else(|| {
        heap.error_with_code(
            ErrorCode::INVALID_ARG_VALUE,
            format_args!("Invalid histogram options"),
        )
    })
}

pub(crate) fn create_recordable<'a>(
    heap: &JsHeap<'a>,
    lowest: u64,
    highest: u64,
    figures: u32,
    half_life: f64,
    threshold: f64,
) -> bindgen::Result<'a, JsWrapper<'a, Histogram>> {
    // `as` saturates.
    let counts = new_counts(heap, lowest, highest, figures)?.with_ewma(half_life, threshold as u64);
    Ok(js_RecordableHistogram::create(heap, Histogram::new(counts)))
}

pub(crate) fn import_histogram<'a>(
    heap: &JsHeap<'a>,
    data: &[u8],
) -> bindgen::Result<'a, JsWrapper<'a, Histogram>> {
    let Some(counts) = bun_histogram::Histogram::import(data) else {
        return Err(heap.error_with_code(
            ErrorCode::INVALID_ARG_VALUE,
            format_args!("Invalid histogram export data"),
        ));
    };
    Ok(js_RecordableHistogram::create(heap, Histogram::new(counts)))
}

pub(crate) fn create_interval<'a>(
    heap: &JsHeap<'a>,
    lowest: u64,
    highest: u64,
    figures: u32,
    resolution: f64,
    sample_per_iteration: bool,
) -> bindgen::Result<'a, JsWrapper<'a, Histogram>> {
    let (state, size) = new_state(new_counts(heap, lowest, highest, figures)?);
    let state = Arc::new(Guarded::new(state));
    let interval = Rc::new(Interval {
        state: Arc::clone(&state),
        size: Arc::clone(&size),
        // `as` saturates.
        resolution_ms: (!sample_per_iteration).then_some((resolution as u32).max(1)),
        poll: Cell::default(),
    });
    let histogram = Histogram {
        counts: RefCell::new(Counts::Shared(state)),
        size,
        interval: Some((interval, Cell::new(false))),
    };
    Ok(js_ELDHistogram::create(heap, histogram))
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

    pub(crate) fn get_skewness(&self) -> f64 {
        self.read(|histogram| histogram.skewness())
    }

    pub(crate) fn get_kurtosis(&self) -> f64 {
        self.read(|histogram| histogram.kurtosis())
    }

    pub(crate) fn get_ewma_mean(&self) -> f64 {
        self.read(|histogram| histogram.ewma_mean())
    }

    pub(crate) fn get_ewma_stddev(&self) -> f64 {
        self.read(|histogram| histogram.ewma_stddev())
    }

    pub(crate) fn get_ewma_error_rate(&self) -> f64 {
        self.read(|histogram| histogram.ewma_error_rate())
    }

    pub(crate) fn get_reset_count(&self) -> u64 {
        self.read(|histogram| histogram.reset_count())
    }

    /// `as` saturates, and makes 0 of NaN.
    pub(crate) fn cdf(&self, value: f64) -> f64 {
        self.read(|histogram| histogram.cdf(value as i64))
    }

    pub(crate) fn ccdf(&self, value: f64) -> f64 {
        1.0 - self.cdf(value)
    }

    pub(crate) fn count_at(&self, value: f64) -> u64 {
        self.read(|histogram| histogram.count_at(value as i64))
    }

    pub(crate) fn burn_rate<'a>(
        &self,
        heap: &JsHeap<'a>,
        slo_target: f64,
    ) -> bindgen::Result<'a, f64> {
        between_0_and_1(heap, b"sloTarget", slo_target)?;
        Ok(self.get_ewma_error_rate() / (1.0 - slo_target))
    }

    pub(crate) fn mean_ci<'a>(
        &self,
        heap: &JsHeap<'a>,
        options: &ConfidenceOptions,
    ) -> bindgen::Result<'a, MeanCI> {
        between_0_and_1(heap, b"options.confidence", options.confidence)?;
        let interval = self.read(|histogram| histogram.mean_ci(options.confidence));
        Ok(MeanCI {
            mean: interval.estimate,
            lower: interval.lower,
            upper: interval.upper,
        })
    }

    pub(crate) fn percentile_ci<'a>(
        &self,
        heap: &JsHeap<'a>,
        percentile: f64,
        options: &ConfidenceOptions,
    ) -> bindgen::Result<'a, PercentileCI> {
        valid_percentile(heap, percentile)?;
        between_0_and_1(heap, b"options.confidence", options.confidence)?;
        let interval =
            self.read(|histogram| histogram.percentile_ci(percentile, options.confidence));
        Ok(PercentileCI {
            value: interval.estimate,
            lower: interval.lower,
            upper: interval.upper,
        })
    }

    pub(crate) fn ks_test(&self, other: &Self) -> f64 {
        self.read_both(other, |this, other| this.ks_test(other))
            .unwrap_or(0.0)
    }

    pub(crate) fn cohens_d(&self, other: &Self) -> f64 {
        self.read_both(other, |this, other| this.cohens_d(other))
            .unwrap_or(0.0)
    }

    pub(crate) fn cliffs_d(&self, other: &Self) -> f64 {
        self.read_both(other, |this, other| this.cliffs_d(other))
            .unwrap_or(0.0)
    }

    pub(crate) fn welch_test<'a>(
        &self,
        heap: &JsHeap<'a>,
        other: &Self,
        options: &ConfidenceOptions,
    ) -> bindgen::Result<'a, WelchTest> {
        between_0_and_1(heap, b"options.confidence", options.confidence)?;
        let welch = self
            .read_both(other, |this, other| {
                this.welch_test(other, options.confidence)
            })
            .unwrap_or(Welch::NO_DIFFERENCE);
        Ok(WelchTest {
            t_statistic: welch.t_statistic,
            degrees_of_freedom: welch.degrees_of_freedom,
            p_value: welch.p_value,
            confidence_interval: ConfidenceInterval {
                lower: welch.lower,
                upper: welch.upper,
            },
        })
    }

    pub(crate) fn mann_whitney_test(&self, other: &Self) -> MannWhitneyTest {
        let test = self
            .read_both(other, |this, other| this.mann_whitney_test(other))
            .unwrap_or(MannWhitney::NO_DIFFERENCE);
        MannWhitneyTest {
            u_statistic: test.u_statistic,
            z_score: test.z_score,
            p_value: test.p_value,
        }
    }

    pub(crate) fn linear_buckets<'a>(
        &self,
        cx: &mut JsScope<'a>,
        step_size: u64,
    ) -> bindgen::Result<'a, JSValue> {
        let buckets = self.read(|histogram| histogram.linear_buckets(step_size));
        let buckets = buckets
            .into_iter()
            .map(|(value, count)| (value as f64, count));
        map_of(cx, buckets, number)
    }

    pub(crate) fn log_buckets<'a>(
        &self,
        cx: &mut JsScope<'a>,
        first_bucket: u64,
        base: f64,
    ) -> bindgen::Result<'a, JSValue> {
        // Node.js takes NaN, and makes one bucket of everything.
        if !(base > 1.0) {
            return Err(out_of_range_error(&cx.heap, b"base", b"> 1", base));
        }
        let buckets = self.read(|histogram| histogram.log_buckets(first_bucket, base));
        let buckets = buckets
            .into_iter()
            .map(|(value, count)| (value as f64, count));
        map_of(cx, buckets, number)
    }

    pub(crate) fn export<'a>(
        &self,
        heap: &JsHeap<'a>,
    ) -> bindgen::Result<'a, JsLocal<'a, BufferSource>> {
        heap.create_uint8_array_from_box(
            self.read(|histogram| histogram.export()).into_boxed_slice(),
        )
    }

    /// A copy that no longer changes.
    pub(crate) fn snapshot<'a>(&self, heap: &JsHeap<'a>) -> JsWrapper<'a, Self> {
        Self::new(self.read(Clone::clone)).into_js(heap)
    }

    pub(crate) fn diff<'a>(
        &self,
        heap: &JsHeap<'a>,
        other: &Self,
    ) -> bindgen::Result<'a, JsWrapper<'a, Self>> {
        let diff = self
            .read_both(other, |this, other| this.diff(other))
            .unwrap_or_else(|| self.read(|histogram| histogram.diff(histogram)));
        match diff {
            Ok(diff) => Ok(Self::new(diff).into_js(heap)),
            Err(DiffError::Incompatible) => Err(heap.error_with_code(
                ErrorCode::INVALID_ARG_VALUE,
                format_args!("other must have the same configuration as the histogram"),
            )),
            Err(DiffError::Reset) => Err(heap.error_with_code(
                ErrorCode::INVALID_STATE,
                format_args!("Values were removed from the histogram after other was taken"),
            )),
            Err(DiffError::NotEarlier) => Err(heap.error_with_code(
                ErrorCode::INVALID_ARG_VALUE,
                format_args!("other contains values that are not in the histogram"),
            )),
        }
    }

    fn percentiles_map<'a>(
        &self,
        cx: &mut JsScope<'a>,
        value_to_js: impl Fn(&JSGlobalObject, u64) -> JsResult<JSValue>,
    ) -> bindgen::Result<'a, JSValue> {
        map_of(
            cx,
            self.read(|histogram| histogram.percentiles()),
            value_to_js,
        )
    }

    pub(crate) fn get_percentiles<'a>(&self, cx: &mut JsScope<'a>) -> bindgen::Result<'a, JSValue> {
        self.percentiles_map(cx, number)
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
        valid_percentile(heap, percentile)?;
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
                skewness: histogram.skewness(),
                kurtosis: histogram.kurtosis(),
                ewma_mean: histogram.ewma_mean(),
                ewma_stddev: histogram.ewma_stddev(),
                ewma_error_rate: histogram.ewma_error_rate(),
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
        let value = value_to_record(cx, val)?;
        let (_, grown) = self.with(|state| state.histogram.record(value));
        Self::report_growth(&cx.heap, this_value, grown);
        Ok(())
    }

    pub(crate) fn record_delta<'a>(&self, this_value: JsWrapper<'a, Self>, heap: &JsHeap<'a>) {
        let ((), grown) = self.with(|state| state.record_delta(uv_hrtime()));
        Self::report_growth(heap, this_value, grown);
    }

    pub(crate) fn record_corrected<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        val: JsLocal<'a>,
        expected_interval: JsLocal<'a>,
    ) -> bindgen::Result<'a, ()> {
        let interval = expected_interval.to_js();
        let (value, interval) = if val.to_js().is_big_int() {
            if !interval.is_big_int() {
                let global = cx.global();
                return Err(global
                    .throw_invalid_argument_type_value("expectedInterval", "bigint", interval)
                    .into());
            }
            let value = value_to_record(cx, val)?;
            if !interval.is_big_int_in_int64_range(1, i64::MAX) {
                return Err(cx.heap.error_with_code(
                    ErrorCode::OUT_OF_RANGE,
                    format_args!("expected_interval is out of range"),
                ));
            }
            let interval = JSBigInt::from_js(interval).map_or(1, |interval| interval.to_int64());
            (value, interval)
        } else {
            let value = value_to_record(cx, val)?;
            let max = Some(MAX_SAFE_INTEGER);
            let interval = validators::validate_integer(
                cx.global(),
                interval,
                "expectedInterval",
                Some(1),
                max,
            )?;
            (value, interval)
        };
        let (_, grown) =
            self.with(|state| state.histogram.record_corrected(value, interval as u64));
        Self::report_growth(&cx.heap, this_value, grown);
        Ok(())
    }

    pub(crate) fn add<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        other: &Histogram,
    ) {
        let grown = self.change_by(other, State::add, State::add_to_itself);
        Self::report_growth(heap, this_value, grown);
    }

    pub(crate) fn subtract(&self, other: &Histogram) {
        let subtract = |this: &mut State, other: &State| this.histogram.subtract(&other.histogram);
        self.change_by(other, subtract, State::subtract_from_itself);
    }
}

/// What `record()` takes: an integer from 0, as a number or as a BigInt.
fn value_to_record<'a>(cx: &mut JsScope<'a>, val: JsLocal<'a>) -> bindgen::Result<'a, u64> {
    let val = val.to_js();
    let big_int = if val.is_number() {
        None
    } else {
        JSBigInt::from_js(val)
    };
    let Some(big_int) = big_int else {
        let max = Some(MAX_SAFE_INTEGER);
        return Ok(validators::validate_integer(cx.global(), val, "val", Some(0), max)? as u64);
    };
    if !val.is_big_int_in_int64_range(0, i64::MAX) {
        // https://github.com/nodejs/node/blob/v26.12.1/src/histogram.cc#L2153
        return Err(cx.heap.error_with_code(
            ErrorCode::OUT_OF_RANGE,
            format_args!("value is out of range"),
        ));
    }
    Ok(big_int.to_int64() as u64)
}

fn out_of_range_error<'a>(
    heap: &JsHeap<'a>,
    name: &[u8],
    range: &[u8],
    value: f64,
) -> bindgen::Error<'a> {
    let options = OutOfRangeOptions {
        field_name: name,
        msg: range,
        ..Default::default()
    };
    heap.error_with_code(
        ErrorCode::OUT_OF_RANGE,
        format_args!("{}", out_of_range(NodeNumber(value), options)),
    )
}

fn valid_percentile<'a>(heap: &JsHeap<'a>, percentile: f64) -> bindgen::Result<'a, ()> {
    if percentile > 0.0 && percentile <= 100.0 {
        return Ok(());
    }
    Err(out_of_range_error(
        heap,
        b"percentile",
        b"> 0 && <= 100",
        percentile,
    ))
}

fn between_0_and_1<'a>(heap: &JsHeap<'a>, name: &[u8], value: f64) -> bindgen::Result<'a, ()> {
    if value > 0.0 && value < 1.0 {
        return Ok(());
    }
    Err(out_of_range_error(heap, name, b"> 0 && < 1", value))
}

fn number(_: &JSGlobalObject, value: u64) -> JsResult<JSValue> {
    Ok(JSValue::js_number_from_uint64(value))
}

/// A `Map`.
fn map_of<'a>(
    cx: &mut JsScope<'a>,
    entries: impl IntoIterator<Item = (f64, u64)>,
    value_to_js: impl Fn(&JSGlobalObject, u64) -> JsResult<JSValue>,
) -> bindgen::Result<'a, JSValue> {
    let global = cx.global();
    let value = JSMap::create(global);
    if let Some(map) = JSMap::from_js(value) {
        let map = JSMap::opaque_mut(map.as_ptr());
        for (key, entry) in entries {
            map.set(global, JSValue::js_number(key), value_to_js(global, entry)?)?;
        }
    }
    Ok(value)
}

pub(crate) fn percentiles_at<'a>(
    cx: &mut JsScope<'a>,
    histogram: &Histogram,
    percentiles: Vec<f64>,
) -> bindgen::Result<'a, JSValue> {
    let values = histogram.read(|histogram| histogram.values_at_percentiles(&percentiles));
    map_of(cx, percentiles.into_iter().zip(values), number)
}

/// The density estimate of a histogram, as it was when `qrde()` was called.
struct QrdeJob {
    slots: RecordedSlots,
    probabilities: Vec<f64>,
    dequantize: Dequantize,
    result: Option<bun_histogram::Qrde>,
}

impl bun_jsc::JobContext for QrdeJob {
    type OffThread = Self;
    type Js = JSPromiseStrong;

    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        this.result = Some(this.slots.qrde(&this.probabilities, this.dequantize));
        Some(done)
    }

    fn then(this: Self, mut promise: JSPromiseStrong, cx: &bun_jsc::JsThread<'_>) -> JsResult<()> {
        let global = cx.global();
        let float64_array = |values: &[f64]| {
            let bytes: Vec<u8> = values
                .iter()
                .flat_map(|value| value.to_ne_bytes())
                .collect();
            BinaryType::Float64Array.to_js(&bytes, global)
        };
        let Some(result) = this.result else {
            return Ok(());
        };
        let dequantize = match this.dequantize {
            Dequantize::None => "none",
            Dequantize::Hdr => "hdr",
            Dequantize::All => "all",
        };
        let value = JSValue::create_empty_object_with_null_prototype(global);
        let put = |key: &'static str, property: JSValue| {
            value.put(global, &bun_core::String::static_(key), property);
        };
        put("probabilities", float64_array(&this.probabilities)?);
        put("quantiles", float64_array(&result.quantiles)?);
        put("densities", float64_array(&result.densities)?);
        put(
            "count",
            JSValue::from_uint64_no_truncate(global, this.slots.count())?,
        );
        put("bucketCount", JSValue::js_number(this.slots.len() as f64));
        put("corrections", JSValue::js_number(result.corrections as f64));
        put(
            "dequantize",
            bun_jsc::StringJsc::to_js(&bun_core::String::static_(dequantize), global)?,
        );
        promise.resolve(global, value)
    }
}

pub(crate) fn qrde(
    cx: &mut JsScope<'_>,
    histogram: &Histogram,
    probabilities: Vec<f64>,
    dequantize: u32,
) -> JSValue {
    let job = QrdeJob {
        slots: histogram.read(|histogram| histogram.recorded_slots()),
        probabilities,
        dequantize: match dequantize {
            0 => Dequantize::None,
            1 => Dequantize::Hdr,
            _ => Dequantize::All,
        },
        result: None,
    };
    let promise = JSPromiseStrong::init(cx.global());
    let value = promise.value();
    bun_jsc::Job::<QrdeJob>::schedule(&cx.js_thread(), job, promise);
    value
}

/// Only its own thread has it: it cannot be cloned.
pub(crate) struct SlidingWindowHistogram {
    window: RefCell<SlidingWindow>,
    size: Size,
}

pub(crate) fn create_sliding_window<'a>(
    heap: &JsHeap<'a>,
    lowest: u64,
    highest: u64,
    figures: u32,
    chunks: u32,
    time_based: bool,
    rotate_at: u64,
) -> bindgen::Result<'a, JsWrapper<'a, SlidingWindowHistogram>> {
    let rotation = if time_based {
        Rotation::EveryNanoseconds(rotate_at)
    } else {
        Rotation::EveryRecords(rotate_at)
    };
    let empty = new_counts(heap, lowest, highest, figures)?;
    let window = SlidingWindow::new(empty, chunks as usize, rotation, uv_hrtime());
    let window = SlidingWindowHistogram {
        size: Size(AtomicUsize::new(window.memory_size())),
        window: RefCell::new(window),
    };
    Ok(window.into_js(heap))
}

impl SlidingWindowHistogram {
    pub(crate) fn estimated_size(&self) -> usize {
        self.size.0.load(Ordering::Relaxed)
    }

    pub(crate) fn record<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        val: JsLocal<'a>,
    ) -> bindgen::Result<'a, ()> {
        let value = value_to_record(cx, val)?;
        let grown = {
            let mut window = self.window.borrow_mut();
            window.record(value, uv_hrtime());
            self.size.set(window.memory_size())
        };
        if grown > 0 {
            cx.heap.report_extra_memory(this_value.as_value(), grown);
        }
        Ok(())
    }

    pub(crate) fn snapshot<'a>(&self, heap: &JsHeap<'a>) -> JsWrapper<'a, Histogram> {
        Histogram::new(self.window.borrow().snapshot(uv_hrtime())).into_js(heap)
    }

    pub(crate) fn reset(&self) {
        let mut window = self.window.borrow_mut();
        window.reset(uv_hrtime());
        self.size.set(window.memory_size());
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
            interval.start_polling();
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
