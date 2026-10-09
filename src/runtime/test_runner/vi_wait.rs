use core::cell::Cell;

use bun_core::{String as BunString, Timespec, TimespecMockMode};
use bun_io::KeepAlive;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    AbortHandle, CallFrame, JSFunction, JSGlobalObject, JSHostFn, JSPromise, JSValue, JsCell,
    JsClass as _, JsError, JsResult, Strong,
};

use super::expect_core::expect_deferred::RunningEntry;
use super::jest::Jest;
use super::timers::fake_timers::{self, Stop};
use crate::jsc_hooks::timer_all_mut as timer_all;
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

#[derive(Copy, Clone, PartialEq, Eq)]
enum Kind {
    For,
    Until,
    /// `expect.poll()`: as `For`, with the last error blamed on the time.
    Poll,
}

impl Kind {
    fn timeout_message(self) -> &'static str {
        match self {
            Kind::For => "Timed out in waitFor!",
            Kind::Until => "Timed out in waitUntil!",
            Kind::Poll => "Matcher did not succeed in time.",
        }
    }
}

/// A `vi.waitFor()` / `vi.waitUntil()` / `expect.poll()` whose promise has not settled.
#[bun_jsc::JsClass(no_construct, no_constructor)]
pub(crate) struct ViWait {
    kind: Kind,
    interval_ms: u32,
    deadline: Cell<Timespec>,
    /// The callback returned a thenable that has not settled.
    callback_pending: Cell<bool>,
    /// The wait ends with the test file that started it.
    test_file: Option<u32>,
    /// `Kind::Poll`: and with the test, if it is known.
    test: Option<RunningEntry>,
    pub(crate) timer: JsCell<EventLoopTimer>,
    abort_handle: AbortHandle,
    keep_alive: JsCell<KeepAlive>,
    /// The wrapper, until the wait settles or is cancelled.
    root: JsCell<Option<Strong>>,
}

bun_jsc::impl_abort_handle_owner!(ViWait, abort_handle, |this, _cause| {
    // SAFETY: trait contract: `this` is live.
    unsafe { (*this).finish() }
});

pub(crate) mod js {
    bun_jsc::codegen_cached_accessors!("ViWait"; callback, promise, lastError, timeoutError);
}

unsafe extern "C" {
    safe fn ExpectDeferred__setCauseIfNone(global: &JSGlobalObject, error: JSValue, cause: JSValue);
}

/// The generation of the test file that is running. `None` in a worker: the runner belongs to the main thread.
fn running_test_file(vm: &VirtualMachine) -> Option<u32> {
    if vm.worker_ref().is_some() {
        return None;
    }
    let runner = Jest::runner_ptr()?.as_ptr();
    // SAFETY: the runner outlives every test file and is only touched on this thread.
    unsafe {
        (*runner)
            .bun_test_root
            .active_file
            .is_some()
            .then_some((*runner).bun_test_root.file_generation)
    }
}

/// As `setTimeout`: a delay outside `1..=i32::MAX` is 1 ms.
pub(crate) fn delay_ms(
    global: &JSGlobalObject,
    value: Option<JSValue>,
    default: u32,
) -> JsResult<u32> {
    let Some(value) = value else {
        return Ok(default);
    };
    let ms = value.to_number(global)?;
    Ok(if ms >= 1.0 && ms <= f64::from(i32::MAX) {
        ms as u32
    } else {
        1
    })
}

/// What was thrown. `Err`: the VM is terminating.
fn thrown_value(global: &JSGlobalObject, err: JsError) -> JsResult<JSValue> {
    if matches!(err, JsError::Terminated) || global.has_pending_termination_exception() {
        return Err(err);
    }
    let exception = global.take_exception(err);
    Ok(exception.to_error().unwrap_or(exception))
}

impl ViWait {
    fn start(global: &JSGlobalObject, frame: &CallFrame, kind: Kind) -> JsResult<JSValue> {
        let [callback, options] = frame.arguments_as_array::<2>();
        if !callback.is_callable() {
            return Err(global.throw_invalid_argument_type_value("callback", "function", callback));
        }
        let (interval, timeout) = if options.is_number() {
            (None, Some(options))
        } else if options.is_object() {
            (
                options.get(global, "interval")?,
                options.get(global, "timeout")?,
            )
        } else if options.is_undefined() {
            (None, None)
        } else {
            return Err(global.throw_invalid_argument_type_value_one_of(
                "options",
                "number or object",
                options,
            ));
        };
        let interval_ms = delay_ms(global, interval, 50)?;
        let timeout_ms = delay_ms(global, timeout, 1000)?;
        Self::begin(global, frame, kind, callback, interval_ms, timeout_ms, None)
    }

    /// The promise of `expect.poll()`'s matcher, which `attempt` calls.
    pub(crate) fn poll_matcher(
        global: &JSGlobalObject,
        frame: &CallFrame,
        attempt: JSValue,
        interval_ms: u32,
        timeout_ms: u32,
        test: Option<RunningEntry>,
    ) -> JsResult<JSValue> {
        Self::begin(
            global,
            frame,
            Kind::Poll,
            attempt,
            interval_ms,
            timeout_ms,
            test,
        )
    }

    fn begin(
        global: &JSGlobalObject,
        frame: &CallFrame,
        kind: Kind,
        callback: JSValue,
        interval_ms: u32,
        timeout_ms: u32,
        test: Option<RunningEntry>,
    ) -> JsResult<JSValue> {
        let cx = global.js_thread_of_caller(frame);
        let promise = JSPromise::create(global).to_js();
        let this_value = ViWait {
            kind,
            interval_ms,
            deadline: Cell::new(Timespec::EPOCH),
            callback_pending: Cell::new(false),
            test_file: running_test_file(cx.vm()),
            test,
            timer: JsCell::new(EventLoopTimer::init_paused(EventLoopTimerTag::ViWait)),
            abort_handle: AbortHandle::for_owner::<ViWait>(),
            keep_alive: JsCell::new(KeepAlive::default()),
            root: JsCell::new(None),
        }
        .to_js(global);
        js::callback_set_cached(
            this_value,
            global,
            callback.with_async_context_if_needed(global),
        );
        js::promise_set_cached(this_value, global, promise);
        js::timeout_error_set_cached(
            this_value,
            global,
            global.create_error_instance(format_args!("{}", kind.timeout_message())),
        );

        let this_ptr = ViWait::from_js(this_value).expect("to_js returns the wrapper");
        // SAFETY: the wrapper owns the payload, and `this_value` is kept alive to the end of this function.
        let this = unsafe { &*this_ptr };
        this.root.set(Some(Strong::create(this_value, global)));
        this.keep_alive
            .with_mut(|keep_alive| keep_alive.ref_(bun_io::js_vm_ctx()));
        // SAFETY: heap-allocated by `to_js`; `finish` leaves the context before `root` lets the wrapper go.
        unsafe { AbortHandle::arm_owner(this_ptr, cx.context()) };

        if let Err(err) = this.poll(global, this_value) {
            match thrown_value(global, err) {
                Ok(error) => this.settle(global, this_value, Err(error))?,
                Err(err) => {
                    this.finish();
                    return Err(err);
                }
            }
        }
        if this.is_pending() {
            let now = Timespec::now(TimespecMockMode::ForceRealTime);
            this.deadline.set(now.add_ms(i64::from(timeout_ms)));
            this.arm(&now);
        }
        this_value.ensure_still_alive();
        Ok(promise)
    }

    fn is_pending(&self) -> bool {
        self.root.get().is_some()
    }

    fn arm(&self, now: &Timespec) {
        let next_poll = now.add_ms(i64::from(self.interval_ms));
        let deadline = self.deadline.get();
        let next = if next_poll.order(&deadline).is_lt() {
            next_poll
        } else {
            deadline
        };
        timer_all().update(self.timer.as_ptr(), &next);
    }

    /// Idempotent. The wrapper may be collected afterwards.
    fn finish(&self) {
        if self.timer.get().state == EventLoopTimerState::ACTIVE {
            timer_all().remove(self.timer.as_ptr());
        }
        self.abort_handle.leave();
        self.keep_alive
            .with_mut(|keep_alive| keep_alive.unref(bun_io::js_vm_ctx()));
        self.root.set(None);
    }

    fn settle(
        &self,
        global: &JSGlobalObject,
        this_value: JSValue,
        outcome: Result<JSValue, JSValue>,
    ) -> JsResult<()> {
        if !self.is_pending() {
            return Ok(());
        }
        self.finish();
        let Some(promise) = js::promise_get_cached(this_value).and_then(JSValue::as_promise) else {
            return Ok(());
        };
        let promise = JSPromise::opaque_mut(promise);
        match outcome {
            Ok(value) => promise.resolve(global, value),
            Err(error) => promise.reject(global, Ok(error)),
        }
    }

    fn on_value(
        &self,
        global: &JSGlobalObject,
        this_value: JSValue,
        value: JSValue,
    ) -> JsResult<()> {
        if self.kind == Kind::Until && !value.to_boolean() {
            return Ok(());
        }
        self.settle(global, this_value, Ok(value))
    }

    fn on_error(
        &self,
        global: &JSGlobalObject,
        this_value: JSValue,
        error: JSValue,
    ) -> JsResult<()> {
        match self.kind {
            Kind::For | Kind::Poll => {
                js::last_error_set_cached(this_value, global, error);
                Ok(())
            }
            Kind::Until => self.settle(global, this_value, Err(error)),
        }
    }

    /// `None`: the callback returned a thenable, which reports to `on_fulfilled` / `on_rejected`.
    fn run_callback(
        &self,
        global: &JSGlobalObject,
        this_value: JSValue,
    ) -> JsResult<Option<JSValue>> {
        let Some(callback) = js::callback_get_cached(this_value) else {
            return Ok(None);
        };
        let result = callback.call(global, JSValue::UNDEFINED, &[])?;
        if !result.is_object() || result.is_callable() {
            return Ok(Some(result));
        }
        let Some(then) = result
            .get(global, "then")?
            .filter(|then| then.is_callable())
        else {
            return Ok(Some(result));
        };
        let bind = |host_fn: JSHostFn| {
            JSFunction::create(global, "", host_fn, 1, Default::default()).bind(
                global,
                this_value,
                &BunString::EMPTY,
                1.0,
                &[],
            )
        };
        let reactions = [
            bind(__jsc_host_on_fulfilled)?,
            bind(__jsc_host_on_rejected)?,
        ];
        self.callback_pending.set(true);
        if let Err(err) = then.call(global, result, &reactions) {
            self.callback_pending.set(false);
            return Err(err);
        }
        Ok(None)
    }

    /// `Err`: a fake timer threw while the fake clock advanced, or the VM is terminating.
    fn poll(&self, global: &JSGlobalObject, this_value: JSValue) -> JsResult<()> {
        match fake_timers::advance_by_ms(global, f64::from(self.interval_ms)) {
            Ok(thrown) if thrown.is_empty() => {}
            Ok(thrown) => return Err(global.throw_value(thrown)),
            Err(Stop::Vm(err)) => return Err(err),
            // The next advance would stop at the same ticks.
            Err(Stop::Ticks(thrown)) => return self.settle(global, this_value, Err(thrown)),
        }
        if self.callback_pending.get() || !self.is_pending() {
            return Ok(());
        }
        match self.run_callback(global, this_value) {
            Ok(Some(value)) => self.on_value(global, this_value, value),
            Ok(None) => Ok(()),
            Err(err) => self.on_error(global, this_value, thrown_value(global, err)?),
        }
    }

    fn callback_settled(
        global: &JSGlobalObject,
        frame: &CallFrame,
        report: fn(&ViWait, &JSGlobalObject, JSValue, JSValue) -> JsResult<()>,
    ) -> JsResult<JSValue> {
        let this_value = frame.this();
        let Some(this) = ViWait::from_js(this_value) else {
            return Ok(JSValue::UNDEFINED);
        };
        // SAFETY: the wrapper owns the payload and is this call's `this`.
        let this = unsafe { &*this };
        if this.callback_pending.replace(false) {
            report(this, global, this_value, frame.argument(0))?;
        }
        Ok(JSValue::UNDEFINED)
    }

    fn time_out(&self, global: &JSGlobalObject, this_value: JSValue) -> JsResult<()> {
        let timeout_error = js::timeout_error_get_cached(this_value).unwrap_or(JSValue::UNDEFINED);
        let Some(error) = js::last_error_get_cached(this_value).filter(|error| error.to_boolean())
        else {
            return self.settle(global, this_value, Err(timeout_error));
        };
        if self.kind == Kind::Poll
            && let Err(terminated) = bun_jsc::call_check_slow(global, || {
                ExpectDeferred__setCauseIfNone(global, error, timeout_error)
            })
        {
            self.finish();
            return Err(terminated);
        }
        self.settle(global, this_value, Err(error))
    }

    pub(crate) fn on_timer_fire(&self, now: &Timespec, vm: &VirtualMachine) -> JsResult<()> {
        self.timer
            .with_mut(|timer| timer.state = EventLoopTimerState::FIRED);
        let Some(this_value) = self.root.get().as_ref().map(Strong::get) else {
            return Ok(());
        };
        if self.test_file != running_test_file(vm)
            || self.test.as_ref().is_some_and(|test| !test.is_running())
        {
            self.finish();
            return Ok(());
        }

        let global = vm.global();
        let _event_loop = vm.enter_event_loop_scope();
        let _context = self
            .abort_handle
            .context_id()
            .map(|context| vm.enter_context(context));
        let result = if self.timer.get().next.order(&self.deadline.get()).is_lt() {
            self.poll(global, this_value)
        } else {
            self.time_out(global, this_value)
        };
        if self.is_pending() {
            self.arm(now);
        }
        this_value.ensure_still_alive();
        result
    }
}

#[bun_jsc::host_fn]
fn wait_for(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    ViWait::start(global, frame, Kind::For)
}

#[bun_jsc::host_fn]
fn wait_until(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    ViWait::start(global, frame, Kind::Until)
}

#[bun_jsc::host_fn]
fn on_fulfilled(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    ViWait::callback_settled(global, frame, ViWait::on_value)
}

#[bun_jsc::host_fn]
fn on_rejected(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    ViWait::callback_settled(global, frame, ViWait::on_error)
}

const FNS: &[(&str, u32, JSHostFn)] = &[
    ("waitFor", 1, __jsc_host_wait_for),
    ("waitUntil", 1, __jsc_host_wait_until),
];

pub(crate) fn put_fns(global: &JSGlobalObject, _jest: JSValue, vi: JSValue) {
    for &(name, arity, func) in FNS {
        vi.put(
            global,
            name.as_bytes(),
            JSFunction::create(global, name, func, arity, Default::default()),
        );
    }
}
