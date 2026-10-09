//! A matcher that needs a pending promise returns a promise of its own, and is called again once the former has settled.

use core::cell::Cell;
use core::ffi::c_uint;
use core::ptr::NonNull;

use bun_jsc::call_frame::CallerSrcLoc;
use bun_jsc::js_promise::{Status, UnwrapMode, Unwrapped};
use bun_jsc::{
    AnyPromise, CallFrame, JSFunction, JSGlobalObject, JSHostFn, JSPromise, JSValue, JsCell,
    JsClass as _, JsError, JsResult,
};

use super::{Expect, ExpectMatcherUtils, Flags, Promise, expect_matcher_utils_js as utils_js};
use crate::test_runner::bun_test::{BunTest, BunTestPtr, BunTestPtrWeak, Phase, RefDataValue};
use crate::test_runner::execution::{ConcurrentGroup, ExecutionSequence};
use crate::test_runner::expect::js as expect_js;
use crate::test_runner::vi_wait::ViWait;

pub(crate) type Matcher = fn(&Expect, &JSGlobalObject, &CallFrame) -> JsResult<JSValue>;

/// What identifies a promise among those one matcher call needs.
pub(crate) type Key = [JSValue; 2];

unsafe extern "C" {
    safe fn ExpectDeferred__callWhenSettled(
        global: &JSGlobalObject,
        promise: JSValue,
        function: JSValue,
        deferred: JSValue,
    );
    safe fn ExpectDeferred__then(global: &JSGlobalObject, promise: JSValue, on_fulfilled: JSValue) -> JSValue;
    safe fn ExpectDeferred__takeThrown(global: &JSGlobalObject) -> JSValue;
    safe fn ExpectDeferred__isHandled(promise: JSValue) -> bool;
    safe fn ExpectDeferred__captureCallSite(global: &JSGlobalObject) -> JSValue;
    safe fn ExpectDeferred__continueStackAt(global: &JSGlobalObject, error: JSValue, call_site: JSValue);
    safe fn ExpectDeferred__location(
        global: &JSGlobalObject,
        call_site: JSValue,
        source_url: &mut bun_core::String,
        line: &mut c_uint,
        column: &mut c_uint,
    );
}

/// The callback of a test or of a hook, for as long as the runner waits for it. Of concurrent tests, when it is not known which: their group.
pub(crate) struct RunningEntry {
    buntest: BunTestPtrWeak,
    entry: RefDataValue,
    /// `entry` does not tell one attempt at a test from the next.
    remaining_retry_count: u32,
}

impl RunningEntry {
    /// The one that `expect` belongs to. `None`: no test is known to have called it.
    fn of(expect: &Expect) -> Option<RunningEntry> {
        let parent = expect.parent.as_ref()?;
        let buntest = parent.bun_test()?;
        let execution = &buntest.get().execution;
        let entry = match parent.phase {
            RefDataValue::Execution { group_index, entry_data: None } if group_index == execution.group_index => {
                RefDataValue::Execution { group_index, entry_data: execution.on_stack_entry_data.get() }
            }
            phase => phase,
        };
        let remaining_retry_count = match Self::sequence_running(&buntest, &entry) {
            // SAFETY: points into `buntest.execution.sequences`; nothing else borrows it here.
            Some(sequence) => unsafe { sequence.as_ref() }.remaining_retry_count,
            None => Self::group_running(&buntest, &entry).map(|_| 0)?,
        };
        Some(RunningEntry { buntest: std::rc::Weak::clone(&parent.buntest_weak), entry, remaining_retry_count })
    }

    fn group_running(buntest: &BunTestPtr, entry: &RefDataValue) -> Option<NonNull<ConcurrentGroup>> {
        let RefDataValue::Execution { group_index, entry_data: None } = *entry else { return None };
        let buntest = buntest.get();
        if buntest.phase != Phase::Execution || buntest.execution.group_index != group_index {
            return None;
        }
        buntest.execution.groups.get_mut(group_index).map(NonNull::from)
    }

    fn sequence_running(buntest: &BunTestPtr, entry: &RefDataValue) -> Option<NonNull<ExecutionSequence>> {
        let buntest = buntest.get();
        if buntest.phase != Phase::Execution {
            return None;
        }
        Some(buntest.execution.get_current_and_valid_execution_sequence(entry)?.0)
    }

    /// `None` once the entry has ended.
    fn sequence(&self, buntest: &BunTestPtr) -> Option<NonNull<ExecutionSequence>> {
        let sequence = Self::sequence_running(buntest, &self.entry)?;
        // SAFETY: as in `of`.
        let remaining_retry_count = unsafe { sequence.as_ref() }.remaining_retry_count;
        (remaining_retry_count == self.remaining_retry_count).then_some(sequence)
    }

    /// Its count of the matchers it waits for.
    fn pending_matchers(&self, buntest: &BunTestPtr) -> Option<NonNull<u32>> {
        // SAFETY: as in `of`.
        unsafe {
            match self.sequence(buntest) {
                Some(sequence) => Some(NonNull::from(&mut (*sequence.as_ptr()).pending_matchers)),
                None => Self::group_running(buntest, &self.entry)
                    .map(|group| NonNull::from(&mut (*group.as_ptr()).pending_matchers)),
            }
        }
    }

    pub(crate) fn is_running(&self) -> bool {
        self.buntest.upgrade().is_some_and(|buntest| self.pending_matchers(&buntest).is_some())
    }

    /// It does not end before `release()`.
    fn hold(self) -> Self {
        if let Some(pending_matchers) = self.buntest.upgrade().and_then(|buntest| self.pending_matchers(&buntest)) {
            // SAFETY: as in `of`.
            unsafe { *pending_matchers.as_ptr() += 1 };
        }
        self
    }

    /// `failure`: what the matcher threw, when nothing else reports it.
    fn release(self, global: &JSGlobalObject, failure: Option<JSValue>) {
        let Some(buntest) = self.buntest.upgrade() else { return };
        if self.pending_matchers(&buntest).is_none() {
            return;
        }
        if let Some(failure) = failure {
            buntest.get().on_uncaught_exception(global, Some(failure), true, &self.entry);
        }
        let Some(pending_matchers) = self.pending_matchers(&buntest) else { return };
        // SAFETY: as in `of`.
        let none_left = unsafe {
            *pending_matchers.as_ptr() -= 1;
            *pending_matchers.as_ptr() == 0
        };
        let next = match self.sequence(&buntest) {
            // SAFETY: as in `of`.
            Some(sequence) => unsafe { sequence.as_ref().callback_done && (none_left || sequence.as_ref().maybe_skip) }
                .then_some(self.entry),
            None => none_left.then_some(RefDataValue::Start),
        };
        if let Some(next) = next {
            buntest.get().add_result(next);
            BunTest::run_next_tick(&self.buntest, global, next);
        }
    }
}

/// A matcher call that waits for a promise. Thrown, by [`ExpectDeferred::wait_for`], to the call it will stand for.
#[bun_jsc::JsClass(no_construct, no_constructor)]
pub(crate) struct ExpectDeferred {
    held: JsCell<Option<RunningEntry>>,
}

pub(crate) mod js {
    bun_jsc::codegen_cached_accessors!("ExpectDeferred"; expect, call, promise, callSite, awaited);
}

/// Until it is dropped, `deferred` is the call that [`ExpectDeferred::waited_for`] answers for.
struct RunningAgain<'a> {
    global: &'a JSGlobalObject,
    outer: JSValue,
}

impl<'a> RunningAgain<'a> {
    fn enter(global: &'a JSGlobalObject, deferred: JSValue) -> Self {
        let utils = ExpectMatcherUtils::singleton(global);
        let outer = utils_js::deferred_get_cached(utils).unwrap_or_default();
        utils_js::deferred_set_cached(utils, global, deferred);
        Self { global, outer }
    }
}

impl Drop for RunningAgain<'_> {
    fn drop(&mut self) {
        utils_js::deferred_set_cached(ExpectMatcherUtils::singleton(self.global), self.global, self.outer);
    }
}

impl ExpectDeferred {
    /// The call of a matcher on `expect_value` that is running again.
    fn running_again(global: &JSGlobalObject, expect_value: JSValue) -> Option<JSValue> {
        utils_js::deferred_get_cached(ExpectMatcherUtils::singleton(global))
            .filter(|&deferred| js::expect_get_cached(deferred) == Some(expect_value))
    }

    /// The promise that the matcher which is running again waited for under `key`.
    pub(crate) fn waited_for(global: &JSGlobalObject, key: Key) -> JsResult<Option<AnyPromise>> {
        let Some(awaited) =
            utils_js::deferred_get_cached(ExpectMatcherUtils::singleton(global)).and_then(js::awaited_get_cached)
        else {
            return Ok(None);
        };
        let mut i = 0;
        let len = awaited.get_length(global)? as u32;
        while i < len {
            if awaited.get_index(global, i)? == key[0] && awaited.get_index(global, i + 1)? == key[1] {
                return Ok(awaited.get_index(global, i + 2)?.as_any_promise());
            }
            i += 3;
        }
        Ok(None)
    }

    fn waiting_for(global: &JSGlobalObject, key: Key, promise: AnyPromise) -> JsResult<JSValue> {
        let deferred = ExpectDeferred { held: JsCell::new(None) }.to_js(global);
        let awaited = JSValue::create_array_from_slice(global, &[key[0], key[1], promise.as_value()])?;
        js::awaited_set_cached(deferred, global, awaited);
        Ok(deferred)
    }

    /// Makes the matcher that is running return a promise, and run again once `promise` has settled.
    #[cold]
    pub(crate) fn wait_for(global: &JSGlobalObject, key: Key, promise: AnyPromise) -> JsError {
        match Self::waiting_for(global, key, promise) {
            Ok(deferred) => global.throw_value(deferred),
            Err(err) => err,
        }
    }

    /// `start()`'s promise, which is asked for once per matcher call, as soon as it has settled.
    pub(crate) fn settled(
        global: &JSGlobalObject,
        key: Key,
        start: impl FnOnce() -> JsResult<Option<AnyPromise>>,
    ) -> JsResult<Option<AnyPromise>> {
        let promise = match Self::waited_for(global, key)? {
            Some(promise) => promise,
            None => match start()? {
                Some(promise) => promise,
                None => return Ok(None),
            },
        };
        if promise.status() == Status::Pending {
            return Err(Self::wait_for(global, key, promise));
        }
        Ok(Some(promise))
    }

    /// Where the matcher that is running again was called from.
    pub(crate) fn call_site(global: &JSGlobalObject, frame: &CallFrame) -> Option<CallerSrcLoc> {
        let call_site = js::call_site_get_cached(Self::running_again(global, frame.this())?)?;
        let mut location = CallerSrcLoc { str: bun_core::String::default(), line: 0, column: 0 };
        ExpectDeferred__location(global, call_site, &mut location.str, &mut location.line, &mut location.column);
        Some(location)
    }

    /// `deferred` waits for the last promise of its `awaited`.
    fn arm(global: &JSGlobalObject, deferred: JSValue) -> JsResult<()> {
        let Some(awaited) = js::awaited_get_cached(deferred) else { return Ok(()) };
        let promise = awaited.get_index(global, awaited.get_length(global)? as u32 - 1)?;
        ExpectDeferred__callWhenSettled(global, promise, private_function(global, __jsc_host_on_settled), deferred);
        Ok(())
    }

    /// Takes over the call in `frame`, which met the pending promise in `thrown`. Returns the promise of that call.
    fn defer(thrown: JSValue, expect: &Expect, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        if let Some(deferred) = Self::running_again(global, frame.this())
            && let (Some(awaited), Some(more), Some(promise)) =
                (js::awaited_get_cached(deferred), js::awaited_get_cached(thrown), js::promise_get_cached(deferred))
        {
            for i in 0..3 {
                awaited.push(global, more.get_index(global, i)?)?;
            }
            Self::arm(global, deferred)?;
            return Ok(promise);
        }

        let promise = JSPromise::create(global).to_js();
        let copy = expect.private_copy(global, frame.this());
        js::expect_set_cached(thrown, global, copy);
        js::call_set_cached(
            thrown,
            global,
            frame.callee().bind(global, copy, &bun_core::String::EMPTY, 0.0, frame.arguments())?,
        );
        js::promise_set_cached(thrown, global, promise);
        js::call_site_set_cached(thrown, global, ExpectDeferred__captureCallSite(global));
        Self::arm(global, thrown)?;
        if let Some(this) = Self::from_js(thrown) {
            // SAFETY: `thrown` is on the stack and owns the payload.
            unsafe { &*this }.held.set(RunningEntry::of(expect).map(RunningEntry::hold));
        }
        Ok(promise)
    }

    fn run_again(global: &JSGlobalObject, deferred: JSValue) -> JsResult<()> {
        let (Some(this), Some(call), Some(promise)) =
            (Self::from_js(deferred), js::call_get_cached(deferred), js::promise_get_cached(deferred))
        else {
            return Ok(());
        };
        // SAFETY: `deferred` is an argument of the running call, and owns `this`.
        let this = unsafe { &*this };
        // The test that waited for the matcher has ended.
        if this.held.get().as_ref().is_some_and(|held| !held.is_running()) {
            return Ok(());
        }

        let result = {
            let _running = RunningAgain::enter(global, deferred);
            call.call(global, JSValue::UNDEFINED, &[])
        };

        let Some(promise_ptr) = promise.as_promise() else { return Ok(()) };
        let settle = JSPromise::opaque_mut(promise_ptr);
        let held = this.held.take();
        let error = match result {
            Ok(returned) if returned == promise => {
                this.held.set(held);
                return Ok(());
            }
            Ok(_) => {
                if let Some(held) = held {
                    held.release(global, None);
                }
                return settle.resolve(global, JSValue::UNDEFINED);
            }
            Err(err) => {
                if matches!(err, JsError::Terminated) || global.has_pending_termination_exception() {
                    return Err(err);
                }
                let exception = global.take_exception(err);
                exception.to_error().unwrap_or(exception)
            }
        };
        if let Some(call_site) = js::call_site_get_cached(deferred) {
            ExpectDeferred__continueStackAt(global, error, call_site);
        }
        match held {
            Some(held) if !ExpectDeferred__isHandled(promise) => {
                held.release(global, Some(error));
                settle.reject_as_handled(global, error)
            }
            held => {
                if let Some(held) = held {
                    held.release(global, None);
                }
                settle.reject(global, Ok(error))
            }
        }
    }
}

/// A function that no stack trace shows.
fn private_function(global: &JSGlobalObject, function: JSHostFn) -> JSValue {
    JSFunction::create(
        global,
        "",
        function,
        0,
        bun_jsc::js_function::CreateJSFunctionOptions {
            implementation_visibility: bun_jsc::js_function::ImplementationVisibility::Private,
            ..Default::default()
        },
    )
}

#[bun_jsc::host_fn]
fn on_settled(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    ExpectDeferred::run_again(global, frame.argument(1))?;
    Ok(JSValue::UNDEFINED)
}

/// One attempt of `expect.poll(function)`: `check(await function())`.
#[bun_jsc::host_fn]
fn poll_once(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [function, check] = frame.arguments_as_array::<2>();
    let value = function.call(global, JSValue::UNDEFINED, &[])?;
    match Expect::promise_to_await(global, value)? {
        Some(promise) => Ok(ExpectDeferred__then(global, promise.as_value(), check)),
        None => check.call(global, JSValue::UNDEFINED, &[value]),
    }
}

/// `call()`, which calls a matcher on `expect`, for `expect(value)`.
#[bun_jsc::host_fn]
fn check_polled(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [expect, call, value] = frame.arguments_as_array::<3>();
    expect_js::captured_value_set_cached(expect, global, value);
    call.call(global, JSValue::UNDEFINED, &[])
}

/// Each would call the function it polls, or write a snapshot at every attempt.
const NOT_POLLED: [&[u8]; 6] = [
    b"toThrow",
    b"toThrowError",
    b"toMatchSnapshot",
    b"toMatchInlineSnapshot",
    b"toThrowErrorMatchingSnapshot",
    b"toThrowErrorMatchingInlineSnapshot",
];

impl Expect {
    /// Every matcher is called through here.
    #[inline]
    pub(crate) fn call_matcher(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        matcher: Matcher,
    ) -> JsResult<JSValue> {
        if !self.flags.get().is_plain() {
            return self.call_modified_matcher(global, frame, matcher);
        }
        match matcher(self, global, frame) {
            Err(JsError::Thrown) => self.matcher_threw(global, frame),
            result => result,
        }
    }

    #[cold]
    fn call_modified_matcher(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        matcher: Matcher,
    ) -> JsResult<JSValue> {
        let flags = self.flags.get();
        let result = if flags.promise() != Promise::None {
            self.call_matcher_on_promise(global, frame, matcher)
        } else {
            let result = if flags.poll() { self.poll_matcher(global, frame) } else { matcher(self, global, frame) };
            match result {
                Err(JsError::Thrown) => self.matcher_threw(global, frame),
                result => result,
            }
        };
        match result {
            Err(JsError::Thrown) if flags.soft() => self.fail_softly(global, frame),
            result => result,
        }
    }

    /// `expect.soft()`: what the matcher threw fails the test, which goes on. It stays thrown when no test is known to have called the matcher.
    fn fail_softly(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let Some(test) = RunningEntry::of(self) else { return Err(JsError::Thrown) };
        let Some(buntest) = test.buntest.upgrade() else { return Err(JsError::Thrown) };
        let Some(sequence) = test.sequence(&buntest) else { return Err(JsError::Thrown) };
        if global.has_pending_termination_exception() {
            return Err(JsError::Thrown);
        }
        let exception = global.take_exception(JsError::Thrown);
        let error = exception.to_error().unwrap_or(exception);
        if let Some(call_site) =
            ExpectDeferred::running_again(global, frame.this()).and_then(js::call_site_get_cached)
        {
            ExpectDeferred__continueStackAt(global, error, call_site);
        }
        // SAFETY: points into `buntest.execution.sequences`; read and written between the calls that may borrow it.
        let maybe_skip = unsafe { sequence.as_ref() }.maybe_skip;
        buntest.get().on_uncaught_exception(global, Some(error), false, &test.entry);
        // SAFETY: as above.
        unsafe { (*sequence.as_ptr()).maybe_skip = maybe_skip };
        Ok(match self.flags.get().promise() {
            Promise::None => JSValue::UNDEFINED,
            _ => JSPromise::resolved_promise_value(global, JSValue::UNDEFINED),
        })
    }

    /// `expect.poll()`: the matcher in `frame` is called on what the function returns, time and again, until it passes.
    fn poll_matcher(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        self.increment_expect_call_counter();
        let this_value = frame.this();
        let function = expect_js::captured_value_get_cached(this_value).unwrap_or(JSValue::UNDEFINED);
        let key = [function, JSValue::UNDEFINED];
        let polling = match ExpectDeferred::waited_for(global, key)? {
            Some(polling) => Some(polling),
            None => self.start_polling(global, frame, function)?.as_any_promise(),
        };
        let Some(polling) = polling else { return Ok(JSValue::UNDEFINED) };
        match polling.unwrap(global.vm(), UnwrapMode::MarkHandled) {
            Unwrapped::Fulfilled(_) => Ok(JSPromise::resolved_promise_value(global, JSValue::UNDEFINED)),
            Unwrapped::Rejected(error) => Err(global.throw_value(error)),
            Unwrapped::Pending => Err(ExpectDeferred::wait_for(global, key, polling)),
        }
    }

    fn start_polling(&self, global: &JSGlobalObject, frame: &CallFrame, function: JSValue) -> JsResult<JSValue> {
        let name = frame.callee().get_name(global)?;
        if NOT_POLLED.iter().any(|not_polled| name.eq_ascii(not_polled)) {
            return Err(global.throw(format_args!(
                "expect.poll() does not support .{name}(). Use vi.waitFor() for a condition that takes time to hold"
            )));
        }
        let times = expect_js::result_value_get_cached(frame.this()).unwrap_or(JSValue::UNDEFINED);
        let [interval_ms, timeout_ms] = [times.get_index(global, 0)?, times.get_index(global, 1)?];

        // The attempts are not counted: the call in `frame` is.
        let expect = Expect {
            flags: Cell::new(Flags(self.flags.get().0 & Flags::NOT_MASK)),
            parent: None,
            custom_label: self.custom_label.clone(),
        }
        .to_js(global);
        let bind = |function: JSValue, this_value: JSValue, arguments: &[JSValue]| {
            function.bind(global, this_value, &bun_core::String::EMPTY, 0.0, arguments)
        };
        let call = bind(frame.callee(), expect, frame.arguments())?;
        let check = bind(private_function(global, __jsc_host_check_polled), JSValue::UNDEFINED, &[expect, call])?;
        let attempt = bind(private_function(global, __jsc_host_poll_once), JSValue::UNDEFINED, &[function, check])?;
        ViWait::poll_matcher(
            global,
            frame,
            attempt,
            interval_ms.to_int32() as u32,
            timeout_ms.to_int32() as u32,
            RunningEntry::of(self),
        )
    }

    /// `.resolves` / `.rejects`: the matcher is called once the promise has settled, and returns a promise.
    fn call_matcher_on_promise(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        matcher: Matcher,
    ) -> JsResult<JSValue> {
        let this_value = frame.this();
        let first_call = expect_js::result_value_get_cached(this_value).is_none();
        if first_call {
            let received = expect_js::captured_value_get_cached(this_value).unwrap_or(JSValue::UNDEFINED);
            let promise = Self::received_promise(global, received)?;
            expect_js::result_value_set_cached(
                this_value,
                global,
                promise.map_or(JSValue::NULL, AnyPromise::as_value),
            );
            if let Some(promise) = promise.filter(|promise| promise.status() == Status::Pending) {
                let deferred = ExpectDeferred::waiting_for(global, [received, JSValue::UNDEFINED], promise)
                    .and_then(|deferred| ExpectDeferred::defer(deferred, self, global, frame));
                expect_js::result_value_set_cached(this_value, global, JSValue::ZERO);
                return deferred;
            }
        }
        let result = match matcher(self, global, frame) {
            Ok(_) => Ok(JSPromise::resolved_promise_value(global, JSValue::UNDEFINED)),
            Err(JsError::Thrown) => self.matcher_threw(global, frame),
            Err(err) => Err(err),
        };
        if first_call {
            expect_js::result_value_set_cached(this_value, global, JSValue::ZERO);
        }
        result
    }

    #[cold]
    fn matcher_threw(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let thrown = ExpectDeferred__takeThrown(global);
        if thrown.is_empty() {
            return Err(JsError::Thrown);
        }
        // It counts when it runs again.
        self.add_to_expect_call_counter(-1);
        ExpectDeferred::defer(thrown, self, global, frame)
    }

    /// What a deferred matcher is called on: nothing else can change its flags.
    fn private_copy(&self, global: &JSGlobalObject, this_value: JSValue) -> JSValue {
        let copy = Expect {
            flags: Cell::new(self.flags.get()),
            parent: self.parent.clone(),
            custom_label: self.custom_label.clone(),
        }
        .to_js(global);
        if let Some(received) = expect_js::captured_value_get_cached(this_value) {
            expect_js::captured_value_set_cached(copy, global, received);
        }
        if let Some(promise) = expect_js::result_value_get_cached(this_value) {
            expect_js::result_value_set_cached(copy, global, promise);
        }
        copy
    }
}
