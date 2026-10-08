//! A matcher that needs a pending promise returns a promise of its own, and is called again once the former has settled.

use core::cell::Cell;
use core::ffi::c_uint;
use core::ptr::NonNull;

use bun_jsc::call_frame::CallerSrcLoc;
use bun_jsc::js_promise::Status;
use bun_jsc::{
    AnyPromise, CallFrame, JSFunction, JSGlobalObject, JSPromise, JSValue, JsCell, JsClass as _,
    JsError, JsResult,
};

use super::{Expect, ExpectMatcherUtils, Promise, expect_matcher_utils_js as utils_js};
use crate::test_runner::bun_test::{BunTest, BunTestPtr, BunTestPtrWeak, Phase, RefDataValue};
use crate::test_runner::execution::ExecutionSequence;
use crate::test_runner::expect::js as expect_js;

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

/// The entry of a test that does not end before a matcher it called has run.
struct Held {
    buntest: BunTestPtrWeak,
    entry: RefDataValue,
    /// `entry` does not tell one attempt at a test from the next.
    remaining_retry_count: u32,
}

impl Held {
    /// The running entry that `expect` belongs to. `None`: no test is known to have called it.
    fn entry_of(expect: &Expect) -> Option<(BunTestPtr, RefDataValue, NonNull<ExecutionSequence>)> {
        let parent = expect.parent.as_ref()?;
        let buntest = parent.bun_test()?;
        let execution = &buntest.get().execution;
        let entry = match parent.phase {
            RefDataValue::Execution { group_index, entry_data: None } if group_index == execution.group_index => {
                RefDataValue::Execution { group_index, entry_data: execution.on_stack_entry_data.get() }
            }
            phase => phase,
        };
        let sequence = Self::sequence_running(&buntest, &entry)?;
        Some((buntest, entry, sequence))
    }

    fn new(expect: &Expect) -> Option<Held> {
        let (buntest, entry, sequence) = Self::entry_of(expect)?;
        // SAFETY: points into `buntest.execution.sequences`; nothing else borrows it here.
        let sequence = unsafe { &mut *sequence.as_ptr() };
        sequence.pending_matchers += 1;
        Some(Held {
            buntest: std::rc::Rc::downgrade(&buntest),
            entry,
            remaining_retry_count: sequence.remaining_retry_count,
        })
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
        // SAFETY: as in `new`.
        let remaining_retry_count = unsafe { sequence.as_ref() }.remaining_retry_count;
        (remaining_retry_count == self.remaining_retry_count).then_some(sequence)
    }

    fn is_running(&self) -> bool {
        self.buntest.upgrade().is_some_and(|buntest| self.sequence(&buntest).is_some())
    }

    /// `failure`: what the matcher threw, when nothing else reports it.
    fn release(self, global: &JSGlobalObject, failure: Option<JSValue>) {
        let Some(buntest) = self.buntest.upgrade() else { return };
        if self.sequence(&buntest).is_none() {
            return;
        }
        if let Some(failure) = failure {
            buntest.get().on_uncaught_exception(global, Some(failure), true, &self.entry);
        }
        let Some(sequence) = self.sequence(&buntest) else { return };
        // SAFETY: as in `new`.
        let sequence = unsafe { &mut *sequence.as_ptr() };
        sequence.pending_matchers -= 1;
        if sequence.callback_done && (sequence.pending_matchers == 0 || sequence.maybe_skip) {
            buntest.get().add_result(self.entry);
            BunTest::run_next_tick(&self.buntest, global, self.entry);
        }
    }
}

/// A matcher call that waits for a promise. Thrown, by [`ExpectDeferred::wait_for`], to the call it will stand for.
#[bun_jsc::JsClass(no_construct, no_constructor)]
pub(crate) struct ExpectDeferred {
    held: JsCell<Option<Held>>,
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
        let outer = utils_js::deferred_get_cached(utils).unwrap_or(JSValue::ZERO);
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
        let on_settled = JSFunction::create(
            global,
            "",
            __jsc_host_on_settled,
            2,
            bun_jsc::js_function::CreateJSFunctionOptions {
                implementation_visibility: bun_jsc::js_function::ImplementationVisibility::Private,
                ..Default::default()
            },
        );
        ExpectDeferred__callWhenSettled(global, promise, on_settled, deferred);
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
            unsafe { &*this }.held.set(Held::new(expect));
        }
        Ok(promise)
    }

    /// Whether the outcome of the matcher still matters to the test that called it.
    fn is_wanted(&self, expect: &Expect) -> bool {
        match (self.held.get(), expect.parent.as_ref()) {
            (Some(held), _) => held.is_running(),
            (None, None) => true,
            (None, Some(parent)) => parent.bun_test().is_some_and(|buntest| match parent.phase {
                RefDataValue::Execution { group_index, .. } => {
                    buntest.phase == Phase::Execution && buntest.execution.group_index == group_index
                }
                _ => true,
            }),
        }
    }

    fn run_again(global: &JSGlobalObject, deferred: JSValue) -> JsResult<()> {
        let (Some(this), Some(expect), Some(call), Some(promise)) = (
            Self::from_js(deferred),
            js::expect_get_cached(deferred).and_then(Expect::from_js),
            js::call_get_cached(deferred),
            js::promise_get_cached(deferred),
        ) else {
            return Ok(());
        };
        // SAFETY: `deferred` is an argument of the running call. It owns `this`, and keeps the owner of `expect` alive.
        let (this, expect) = unsafe { (&*this, &*expect) };
        if !this.is_wanted(expect) {
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

#[bun_jsc::host_fn]
fn on_settled(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    ExpectDeferred::run_again(global, frame.argument(1))?;
    Ok(JSValue::UNDEFINED)
}

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
        let result = match flags.promise() {
            Promise::None => match matcher(self, global, frame) {
                Err(JsError::Thrown) => self.matcher_threw(global, frame),
                result => result,
            },
            _ => self.call_matcher_on_promise(global, frame, matcher),
        };
        match result {
            Err(JsError::Thrown) if flags.soft() => self.fail_softly(global, frame),
            result => result,
        }
    }

    /// `expect.soft()`: what the matcher threw fails the test, which goes on. It stays thrown when no test is known to have called the matcher.
    fn fail_softly(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let Some((buntest, entry, sequence)) = Held::entry_of(self) else { return Err(JsError::Thrown) };
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
        buntest.get().on_uncaught_exception(global, Some(error), false, &entry);
        // SAFETY: as above.
        unsafe { (*sequence.as_ptr()).maybe_skip = maybe_skip };
        Ok(match self.flags.get().promise() {
            Promise::None => JSValue::UNDEFINED,
            _ => JSPromise::resolved_promise_value(global, JSValue::UNDEFINED),
        })
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
