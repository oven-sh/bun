use core::pin::pin;

use bun_async::{Either, race};
use bun_core::{Timespec, TimespecMockMode};
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::future::{self, JsTask, LoopRef};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    JSFunction, JSGlobalObject, JSHostFn, JSPromiseStrong, JSValue, JsError, JsResult, JsThread,
    Strong,
};

use super::expect_core::expect_deferred::RunningEntry;
use super::jest::Jest;
use super::timers::fake_timers::{self, Stop};
use crate::future::{Settled, settled, sleep_until};
use crate::generated_bindgen::vi_wait as generated;

#[derive(Copy, Clone, PartialEq, Eq)]
enum Kind {
    For,
    Until,
    /// `expect.poll()`. Like `For`, but on timeout the last error gets the timeout error as its `cause`.
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

/// A `vi.waitFor()`, `vi.waitUntil()` or `expect.poll()` that hasn't settled.
pub(crate) struct ViWait {
    kind: Kind,
    interval_ms: u32,
    timeout_ms: u32,
    callback: Strong,
    /// Made by the call that started the wait, for its stack.
    timeout_error: Strong,
    last_error: Option<Strong>,
    /// What the callback returned, until it settles. The callback is not called again before that.
    returned: Option<Settled>,
    /// The wait is dropped once the test file that started it ends.
    test_file: Option<u32>,
    /// For `Kind::Poll`, the wait is also dropped once this test ends.
    test: Option<RunningEntry>,
}

/// How the wait's promise settles.
type Outcome = Result<JSValue, JSValue>;

unsafe extern "C" {
    safe fn ExpectDeferred__setCauseIfNone(global: &JSGlobalObject, error: JSValue, cause: JSValue);
}

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

/// Like `setTimeout`, a delay outside `1..=i32::MAX` becomes 1 ms.
pub(crate) fn delay_ms(
    global: &JSGlobalObject,
    value: Option<JSValue>,
    default: u32,
) -> JsResult<u32> {
    let Some(value) = value else {
        return Ok(default);
    };
    Ok(clamp_delay(value.to_number(global)?))
}

fn clamp_delay(ms: f64) -> u32 {
    if ms >= 1.0 && ms <= f64::from(i32::MAX) {
        ms as u32
    } else {
        1
    }
}

/// A fake clock moves by the interval as given, so 0 stays 0. The real timer between two calls then waits 1 ms.
pub(crate) fn interval_ms(global: &JSGlobalObject, value: Option<JSValue>) -> JsResult<u32> {
    let Some(value) = value else {
        return Ok(50);
    };
    let ms = value.to_number(global)?;
    Ok(if ms == 0.0 { 0 } else { clamp_delay(ms) })
}

fn thrown_value(global: &JSGlobalObject, err: JsError) -> JsResult<JSValue> {
    if matches!(err, JsError::Terminated) || global.has_pending_termination_exception() {
        return Err(err);
    }
    let exception = global.take_exception(err);
    Ok(exception.to_error().unwrap_or(exception))
}

impl ViWait {
    #[optimize(size)]
    fn start(
        cx: &mut JsScope<'_>,
        callback: JsLocal<'_>,
        options: JsLocal<'_>,
        kind: Kind,
    ) -> JsResult<JSValue> {
        let (global, callback, options) = (cx.global(), callback.to_js(), options.to_js());
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
        let interval_ms = interval_ms(global, interval)?;
        let timeout_ms = delay_ms(global, timeout, 1000)?;
        Self::begin(
            &cx.js_thread(),
            kind,
            callback,
            interval_ms,
            timeout_ms,
            None,
        )
    }

    pub(crate) fn poll_matcher(
        global: &JSGlobalObject,
        attempt: JSValue,
        interval_ms: u32,
        timeout_ms: u32,
        test: Option<RunningEntry>,
    ) -> JsResult<JSValue> {
        Self::begin(
            &global.js_thread_of_caller(),
            Kind::Poll,
            attempt,
            interval_ms,
            timeout_ms,
            test,
        )
    }

    #[optimize(size)]
    fn begin(
        cx: &JsThread<'_>,
        kind: Kind,
        callback: JSValue,
        interval_ms: u32,
        timeout_ms: u32,
        test: Option<RunningEntry>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let mut promise = JSPromiseStrong::init(global);
        let promise_value = promise.value();
        let wait = ViWait {
            kind,
            interval_ms,
            timeout_ms,
            callback: Strong::create(callback.with_async_context_if_needed(global), global),
            timeout_error: Strong::create(
                global.create_error_instance(format_args!("{}", kind.timeout_message())),
                global,
            ),
            last_error: None,
            returned: None,
            test_file: running_test_file(cx.vm()),
            test,
        };
        future::spawn(cx, |js| async move {
            match wait.run(js).await? {
                Some(Ok(value)) => promise.resolve(js.global(), value),
                Some(Err(error)) => promise.reject(js.global(), Ok(error)),
                None => Ok(()),
            }
        })?;
        Ok(promise_value)
    }

    /// `None`: what started the wait has ended, so nobody is told how it went.
    async fn run(mut self, js: JsTask) -> JsResult<Option<Outcome>> {
        let _keeps_loop_alive = LoopRef::new();
        let global = js.global();

        match self.attempt(global, true) {
            Ok(None) => {}
            Ok(Some(outcome)) => return Ok(Some(outcome)),
            Err(err) => return Ok(Some(Err(thrown_value(global, err)?))),
        }

        let deadline =
            Timespec::now(TimespecMockMode::ForceRealTime).add_ms(i64::from(self.timeout_ms));
        loop {
            let next_attempt = Timespec::now(TimespecMockMode::ForceRealTime)
                .add_ms(i64::from(self.interval_ms.max(1)));
            let is_last = !next_attempt.order(&deadline).is_lt();
            let mut tick = pin!(sleep_until(if is_last { deadline } else { next_attempt }));
            loop {
                let Some(returned) = &mut self.returned else {
                    tick.as_mut().await;
                    break;
                };
                let Either::Left(settled_with) = race(returned, tick.as_mut()).await else {
                    break;
                };
                self.returned = None;
                if let Some(outcome) = self.judge(global, settled_with) {
                    return Ok(Some(outcome));
                }
            }

            if self.test_file != running_test_file(js.vm())
                || self.test.as_ref().is_some_and(|test| !test.is_running())
            {
                return Ok(None);
            }
            if is_last {
                return self.time_out(global).map(Some);
            }
            match self.attempt(global, false) {
                Ok(None) => {}
                Ok(Some(outcome)) => return Ok(Some(outcome)),
                // What a fake timer threw is nobody's in particular, and the wait goes on.
                Err(err) => crate::dispatch::fold(Err(err)),
            }
        }
    }

    /// Whether what the callback gave ends the wait.
    fn judge(&mut self, global: &JSGlobalObject, gave: Outcome) -> Option<Outcome> {
        match (gave, self.kind) {
            (Ok(value), Kind::Until) if !value.to_boolean() => None,
            (Ok(value), _) => Some(Ok(value)),
            (Err(error), Kind::Until) => Some(Err(error)),
            (Err(error), Kind::For | Kind::Poll) => {
                self.last_error = Some(Strong::create(error, global));
                None
            }
        }
    }

    #[optimize(size)]
    fn attempt(&mut self, global: &JSGlobalObject, is_first: bool) -> JsResult<Option<Outcome>> {
        // As in Vitest, `waitFor` and `waitUntil` advance a fake clock on every tick of theirs, and `expect.poll` between two attempts.
        if self.kind != Kind::Poll || !(is_first || self.returned.is_some()) {
            match fake_timers::advance_by_ms(global, f64::from(self.interval_ms)) {
                Ok(thrown) if thrown.is_empty() => {}
                Ok(thrown) => return Err(global.throw_value(thrown)),
                Err(Stop::Vm(err)) => return Err(err),
                // Polling again wouldn't help, since at the loop limit the next advance stops on the same queued ticks.
                Err(Stop::Ticks(thrown)) => return Ok(Some(Err(thrown))),
            }
        }
        if self.returned.is_some() {
            return Ok(None);
        }
        let gave = match self.callback.get().call(global, JSValue::UNDEFINED, &[]) {
            Ok(value) if value.is_object() && !value.is_callable() => {
                self.returned = Some(settled(global, value)?);
                return Ok(None);
            }
            Ok(value) => Ok(value),
            Err(err) => Err(thrown_value(global, err)?),
        };
        Ok(self.judge(global, gave))
    }

    fn time_out(&self, global: &JSGlobalObject) -> JsResult<Outcome> {
        let timeout_error = self.timeout_error.get();
        let Some(error) = (self.last_error.as_ref().map(Strong::get)).filter(|e| e.to_boolean())
        else {
            return Ok(Err(timeout_error));
        };
        if self.kind == Kind::Poll {
            bun_jsc::call_check_slow(global, || {
                ExpectDeferred__setCauseIfNone(global, error, timeout_error)
            })?;
        }
        Ok(Err(error))
    }
}

pub(crate) fn wait_for(
    cx: &mut JsScope<'_>,
    callback: JsLocal<'_>,
    options: JsLocal<'_>,
) -> JsResult<JSValue> {
    ViWait::start(cx, callback, options, Kind::For)
}

pub(crate) fn wait_until(
    cx: &mut JsScope<'_>,
    callback: JsLocal<'_>,
    options: JsLocal<'_>,
) -> JsResult<JSValue> {
    ViWait::start(cx, callback, options, Kind::Until)
}

const FNS: &[(&str, u32, JSHostFn)] = &[
    ("waitFor", 1, generated::Bun__ViWait__waitFor),
    ("waitUntil", 1, generated::Bun__ViWait__waitUntil),
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
