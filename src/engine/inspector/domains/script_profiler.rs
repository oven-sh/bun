use core::cell::Cell;

use bun_engine_text::{StringBuilder, StringRef};
use bun_engine_vm::{Cx, FastHashMap, Vm};

use crate::Controller;
use crate::call_stack::script_id_text;
use crate::profiling::{JsonWriter, SampledFrame, SamplingProfiler};
use crate::protocol::{Json, Object, Outcome, Request, object};
use crate::stopwatch::Stopwatch;

/// Who has called into scripts.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ProfilingReason {
    Api,
    Microtask,
    Other,
}

#[derive(Default)]
pub(crate) struct ScriptProfiler {
    is_tracking: Cell<bool>,
    is_evaluating: Cell<bool>,
    takes_samples: Cell<bool>,
}

impl ScriptProfiler {
    pub(crate) fn takes_samples(&self) -> bool {
        self.takes_samples.get()
    }

    /// Stops without a result.
    pub(crate) fn abandon(&self, vm: &Vm) {
        self.is_tracking.set(false);
        self.is_evaluating.set(false);
        if self.takes_samples.take() {
            SamplingProfiler::pause(vm);
            SamplingProfiler::clear(vm);
        }
    }
}

/// `ScriptProfiler.StackFrame`
fn describe(frame: SampledFrame<'_>) -> StringRef {
    let start = frame.start_of_code();
    let frame = object! {
        "sourceID": script_id_text(frame.source_id()),
        "name": frame.name(),
        "line": start.map_or(-1, |it| it.line as i32),
        "column": start.map_or(-1, |it| it.column as i32),
        "url": frame.url(),
        "expressionLocation" => (frame.position())
            .map(|it| object! { "line": it.line, "column": it.column }),
    };
    frame.to_text().unwrap_or_default()
}

/// `ScriptProfiler.Samples`. `None` if there are too many.
fn take_samples(vm: &Vm, stopwatch: &Stopwatch) -> Option<Json> {
    SamplingProfiler::pause(vm);
    let profile = SamplingProfiler::take_profile(vm);
    let (mut out, mut described) = (StringBuilder::new(), FastHashMap::default());
    out.raw(br#"{"stackTraces":["#);
    out.separated(profile.traces(), |out, trace| {
        out.raw(br#"{"timestamp":"#);
        out.number(stopwatch.elapsed_at(trace.timestamp));
        out.raw(br#","stackFrames":["#);
        out.separated(trace.frames(), |out, frame| {
            let text = described.entry(frame.index());
            out.push_text(text.or_insert_with(|| describe(frame)).text());
        });
        out.raw(b"]}");
    });
    out.raw(b"]}");
    out.finish().ok().map(Json::Written)
}

impl Controller {
    /// No time passes in a pause.
    pub(crate) fn update_sampling(&self, vm: &Vm) {
        match (
            self.script_profiler.takes_samples(),
            self.debugger.check_paused(),
        ) {
            (false, _) => {}
            (true, Ok(_)) => SamplingProfiler::pause(vm),
            (true, Err(_)) => SamplingProfiler::start(vm),
        }
    }

    pub(crate) fn start_tracking_scripts(&self, vm: &Vm, includes_samples: bool) {
        if self.script_profiler.is_tracking.replace(true) {
            return;
        }
        self.script_profiler.takes_samples.set(includes_samples);
        self.update_sampling(vm);
        let params = object! { "timestamp": self.stopwatch.elapsed() };
        self.notify("ScriptProfiler.trackingStart", params);
    }

    pub(crate) fn stop_tracking_scripts(&self, vm: &Vm) {
        if !self.script_profiler.is_tracking.get() {
            return;
        }
        let takes_samples = self.script_profiler.takes_samples();
        let params = object! {
            "timestamp": self.stopwatch.elapsed(),
            "samples" => takes_samples.then(|| take_samples(vm, &self.stopwatch)).flatten(),
        };
        self.script_profiler.abandon(vm);
        self.notify("ScriptProfiler.trackingComplete", params);
    }

    /// What to pass to `did_evaluate_script`. `None` if that is not to be called.
    pub fn will_evaluate_script(&self) -> Option<f64> {
        let profiler = &self.script_profiler;
        (profiler.is_tracking.get()
            && self.debugger.is_enabled()
            && !profiler.is_evaluating.replace(true))
        .then(|| self.stopwatch.elapsed())
    }

    pub fn did_evaluate_script(&self, start: f64, reason: ProfilingReason) {
        if !self.script_profiler.is_evaluating.take() || !self.debugger.is_enabled() {
            return;
        }
        let event = object! {
            "startTime": start,
            "endTime": self.stopwatch.elapsed(),
            "type": match reason {
                ProfilingReason::Api => "API",
                ProfilingReason::Microtask => "Microtask",
                ProfilingReason::Other => "Other",
            },
        };
        self.notify("ScriptProfiler.trackingUpdate", object! { "event": event });
    }

    pub(crate) fn dispatch_script_profiler(
        &self,
        cx: &mut Cx,
        method: &str,
        request: &Request<'_>,
    ) -> Outcome<Option<Object>> {
        let params = &request.params;
        match method {
            "startTracking" => {
                let includes_samples = params.flag("includeSamples");
                params.check()?;
                self.start_tracking_scripts(cx, includes_samples);
            }
            "stopTracking" => self.stop_tracking_scripts(cx),
            _ => return Err(params.no_such_method()),
        }
        Ok(Some(object! {}))
    }
}
