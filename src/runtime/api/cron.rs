//! `Bun.cron(schedule, handler)` and `Bun.cron.parse()`. The OS-level jobs are in `cron_os.rs`.

use core::cell::Cell;

use bstr::BStr;
use bun_core::{Timespec, TimespecMockMode};
use bun_cron::{CronExpression, TimeZone, WallClock};
use bun_io::KeepAlive;
use bun_jsc::bindgen::{Callable, JsLocal, JsPayload as _, JsScope, JsWrapper};
use bun_jsc::js_promise::{UnwrapMode, Unwrapped};
use bun_jsc::virtual_machine::{HotReload, VirtualMachine};
use bun_jsc::{
    self as jsc, AbortHandle, GlobalRef, JSFunction, JSGlobalObject, JSObject, JSValue, JsError,
    JsResult, ScriptExecutionStatus, Strong, StrongCell,
};
use bun_removable_features::removable_body_behind_value;

use crate::generated_bindgen::cron::{
    Bun__Cron__cron, Bun__Cron__parse, Bun__Cron__remove, Bun__CronJob__onPromiseReject,
    Bun__CronJob__onPromiseResolve, CronOptions, js_CronJob as js,
};
use crate::jsc_hooks::{timer_all, try_runtime_state};
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

#[derive(Clone, Copy)]
enum CronTz {
    Utc,
    Local,
    /// From `JSGlobalObject::resolve_time_zone_id`.
    Named(u32),
}

impl CronTz {
    fn from_options(global: &JSGlobalObject, options: Option<&CronOptions<'_>>) -> JsResult<Self> {
        let Some(name) = options.and_then(|options| options.tz) else {
            return Ok(CronTz::Local);
        };
        // `Bun__resolveTimeZoneID` reads the bytes as Latin-1.
        if name.is_ascii()
            && let Some(id) = JSGlobalObject::resolve_time_zone_id(name)
        {
            return Ok(CronTz::Named(id));
        }
        Err(global.throw_invalid_arguments(format_args!(
            "Bun.cron: unknown time zone '{}'",
            BStr::new(name)
        )))
    }
}

struct JscZone<'a>(&'a JSGlobalObject, CronTz);

impl TimeZone for JscZone<'_> {
    type Error = JsError;
    const MAX_MS: f64 = jsc::wtf::MAX_ECMASCRIPT_TIME;

    fn utc(&self) -> Self {
        JscZone(self.0, CronTz::Utc)
    }

    fn wall_clock(&self, ms: f64) -> WallClock {
        let at = match self.1 {
            CronTz::Utc => self.0.ms_to_gregorian_date_time_utc(ms),
            CronTz::Local => self.0.ms_to_gregorian_date_time(ms),
            CronTz::Named(id) => self.0.ms_to_gregorian_date_time_in_zone(ms, id),
        };
        WallClock {
            year: at.year,
            month: at.month,
            day: at.day,
            hour: at.hour,
            minute: at.minute,
            weekday: at.weekday,
        }
    }

    fn instant(&self, at: WallClock) -> JsResult<f64> {
        let (g, y, mo, d, h, mi) = (self.0, at.year, at.month, at.day, at.hour, at.minute);
        match self.1 {
            CronTz::Utc => g.gregorian_date_time_to_ms_utc(y, mo, d, h, mi, 0, 0),
            CronTz::Local => g.gregorian_date_time_to_ms(y, mo, d, h, mi, 0, 0),
            CronTz::Named(id) => Ok(g.gregorian_date_time_to_ms_in_zone(y, mo, d, h, mi, 0, 0, id)),
        }
    }
}

pub(super) fn parse_expression(global: &JSGlobalObject, text: &[u8]) -> JsResult<CronExpression> {
    CronExpression::parse(text).map_err(|err| global.throw_invalid_arguments(format_args!("{err}")))
}

/// `CronJob`, declared in `cron.bind.ts`.
pub(crate) struct CronJob {
    pub(crate) event_loop_timer: EventLoopTimer,
    global: GlobalRef,
    expression: CronExpression,
    tz: CronTz,
    poll_ref: KeepAlive,
    /// Roots the wrapper until the job stops, which is for good.
    root: StrongCell,
    /// The wall-clock time last armed for. The monotonic timer can fire just before it, and must not arm for it again.
    last_next_ms: Cell<f64>,
    /// The context of the script that called `Bun.cron()`: its ticks are that script's.
    context: jsc::ContextId,
    /// The job stops with that context, as its timers do.
    abort_handle: AbortHandle,
}

bun_event_loop::impl_timer_owner!(CronJob; from_timer_ptr => event_loop_timer);
bun_jsc::impl_abort_handle_owner!(CronJob, abort_handle, |this, _cause| {
    // SAFETY: trait contract: `this` is live.
    unsafe { (*this).stop_now() }
});

impl CronJob {
    pub(crate) fn register<'a>(
        cx: &mut JsScope<'a>,
        (schedule, schedule_value): (&[u8], JsLocal<'a>),
        handler: JsLocal<'a, Callable>,
        options: Option<&CronOptions<'a>>,
    ) -> JsResult<JSValue> {
        let tz = CronTz::from_options(cx.global(), options)?;
        let cx = &cx.js_thread();
        let global = cx.global();
        let job = CronJob {
            event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::CronJob),
            global: GlobalRef::from(global),
            expression: parse_expression(global, schedule)?,
            tz,
            poll_ref: KeepAlive::default(),
            root: StrongCell::default(),
            last_next_ms: Cell::new(0.0),
            context: cx.context().id(),
            abort_handle: AbortHandle::for_owner::<CronJob>(),
        };
        let Some(next_time) = job.next_time() else {
            return Err(global.throw_invalid_arguments(format_args!(
                "Cron expression '{}' has no future occurrences",
                BStr::new(schedule)
            )));
        };

        let js_value = job.into_js_wrapper(global).to_js();
        let Some(job) = js::from_js(&js_value) else {
            return Err(global.throw(format_args!("Failed to create cron job")));
        };
        job.root.set(Strong::create(js_value, global));
        js::cron_set_cached(js_value, global, schedule_value.to_js());
        let handler = handler.to_js().with_async_context_if_needed(global);
        js::callback_set_cached(js_value, global, handler);
        let vm = global.bun_vm();
        if vm.hot_reload.get() == HotReload::Hot
            && vm.worker.get().is_none()
            && let Some(state) = try_runtime_state()
        {
            let entry = Strong::create(js_value, global);
            state.cron_jobs.with_mut(|jobs| jobs.push(entry));
        }
        job.poll_ref.ref_(bun_io::js_vm_ctx());
        // SAFETY: `stop_now` leaves the context before `root` lets go of the wrapper.
        unsafe { AbortHandle::arm_owner(job.as_ptr(), cx.context()) };
        timer_all().update(&raw const job.event_loop_timer, &next_time);
        Ok(js_value)
    }

    /// Idempotent, and runs no script. A tick's pending promise keeps the wrapper for its reactions, and nothing else does.
    pub(crate) fn stop_now(&self) {
        let Some(js_this) = self.root.get() else {
            return;
        };
        self.event_loop_timer.disarm();
        self.poll_ref.disable();
        self.abort_handle.leave();
        js::callback_set_cached(js_this, &self.global, JSValue::ZERO);
        if let Some(state) = try_runtime_state() {
            drop(state.cron_jobs.with_mut(|jobs| {
                let i = jobs.iter().position(|job| job.get() == js_this)?;
                Some(jobs.swap_remove(i))
            }));
        }
        self.root.clear();
    }

    pub(crate) fn stop_all_for_reload() {
        let Some(state) = try_runtime_state() else {
            return;
        };
        for job in state.cron_jobs.take() {
            removable_body_behind_value!(Cron, {
                if let Some(job) = js::from_js(&job.get()) {
                    job.stop_now();
                }
            });
        }
    }

    pub(crate) fn stop<'a>(&self, this_value: JsWrapper<'a, Self>) -> JsWrapper<'a, Self> {
        self.stop_now();
        this_value
    }

    pub(crate) fn r#ref<'a>(&self, this_value: JsWrapper<'a, Self>) -> JsWrapper<'a, Self> {
        self.poll_ref.ref_(bun_io::js_vm_ctx());
        this_value
    }

    pub(crate) fn unref<'a>(&self, this_value: JsWrapper<'a, Self>) -> JsWrapper<'a, Self> {
        self.poll_ref.unref(bun_io::js_vm_ctx());
        this_value
    }

    /// The schedule is on the wall clock and the timer heap on the monotonic one. Fake timers mock both or neither.
    fn next_time(&self) -> Option<Timespec> {
        let now_ms = bun_core::time::milli_timestamp_allow_mocked_time();
        let from_ms = now_ms.max(self.last_next_ms.get());
        let zone = JscZone(&self.global, self.tz);
        let next_ms = self.expression.next(&zone, from_ms).ok()??;
        self.last_next_ms.set(next_ms);
        let delta = (next_ms - now_ms).max(1.0) as i64;
        Some(Timespec::ms_from_now(
            TimespecMockMode::AllowMockedTime,
            delta,
        ))
    }

    /// Always just after script, which may have stopped the job or ended the VM.
    fn schedule_next(&self, vm: &VirtualMachine) {
        if self.root.is_some()
            && vm.script_execution_status() == ScriptExecutionStatus::Running
            && let Some(next_time) = self.next_time()
        {
            return timer_all().update(&raw const self.event_loop_timer, &next_time);
        }
        self.stop_now();
    }

    pub(crate) fn on_timer_fire(&self, vm: &VirtualMachine) {
        self.event_loop_timer.state.set(EventLoopTimerState::FIRED);
        let Some(js_this) = self.root.get() else {
            return;
        };
        let _alive = jsc::EnsureStillAlive(js_this);
        let (ScriptExecutionStatus::Running, Some(callback)) = (
            vm.script_execution_status(),
            js::callback_get_cached(js_this),
        ) else {
            return self.stop_now();
        };

        let _entered = vm.enter_event_loop_scope();
        // The reactions on the tick's promise, and what they report, belong to the job's script too.
        let _context = vm.enter_context(self.context);
        let global = &*self.global;
        // Reports what the tick throws, before the job is armed again.
        let result = (vm.event_loop()).run_callback_with_result(
            self.context,
            callback,
            global,
            js_this,
            &[],
        );
        if vm.script_execution_status() != ScriptExecutionStatus::Running {
            return self.stop_now();
        }

        if let Some(promise) = result.as_any_promise() {
            match promise.unwrap(global.vm(), UnwrapMode::MarkHandled) {
                Unwrapped::Pending => {
                    js::pending_promise_set_cached(js_this, global, result);
                    return result.then_with_value(
                        global,
                        js_this,
                        Bun__CronJob__onPromiseResolve,
                        Bun__CronJob__onPromiseReject,
                    );
                }
                Unwrapped::Fulfilled(_) => {}
                Unwrapped::Rejected(reason) => vm.unhandled_rejection(vm.global(), reason, result),
            }
        }
        self.schedule_next(vm);
    }
}

pub(crate) fn on_promise_resolve(
    _: &mut JsScope<'_>,
    _: JsLocal<'_>,
    (job, js_this): (&CronJob, JsLocal<'_>),
) {
    js::pending_promise_set_cached(js_this.to_js(), &job.global, JSValue::ZERO);
    job.schedule_next(job.global.bun_vm());
}

pub(crate) fn on_promise_reject(
    _: &mut JsScope<'_>,
    reason: JsLocal<'_>,
    (job, js_this): (&CronJob, JsLocal<'_>),
) {
    let vm = job.global.bun_vm();
    let promise = js::pending_promise_take_cached(js_this.to_js(), &job.global);
    let promise = promise.unwrap_or(JSValue::UNDEFINED);
    vm.unhandled_rejection(vm.global(), reason.to_js(), promise);
    job.schedule_next(vm);
}

pub(crate) fn get_cron_object(global: &JSGlobalObject, _obj: &JSObject) -> JSValue {
    let function = |name, host_fn, length| {
        JSFunction::create(global, name, host_fn, length, Default::default())
    };
    let cron = function("cron", Bun__Cron__cron, 3);
    cron.put(global, b"remove", function("remove", Bun__Cron__remove, 1));
    cron.put(global, b"parse", function("parse", Bun__Cron__parse, 1));
    cron
}

pub(crate) fn parse(
    cx: &mut JsScope<'_>,
    expression: &[u8],
    relative_date: Option<f64>,
    options: Option<&CronOptions<'_>>,
) -> JsResult<Option<f64>> {
    let global = cx.global();
    let expression = parse_expression(global, expression)?;
    let from_ms = relative_date.unwrap_or_else(|| bun_core::time::milli_timestamp() as f64);
    // `next` would report it as no match.
    if from_ms.is_nan() || from_ms.abs() > JscZone::MAX_MS {
        return Err(global.throw_invalid_arguments(format_args!("Invalid date value")));
    }
    let tz = CronTz::from_options(global, options)?;
    expression.next(&JscZone(global, tz), from_ms)
}
