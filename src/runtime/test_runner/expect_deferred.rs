//! A matcher that hits a pending promise returns its own promise and re-runs from the top once the pending one settles.
//! The re-run replays the recorded results of earlier user-code calls (`Pass::once`) instead of calling user code again.

use core::cell::{Cell, OnceCell};
use core::ffi::c_uint;

use bun_core::{Timespec, TimespecMockMode};
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::call_frame::CallerSrcLoc;
use bun_jsc::js_promise::{UnwrapMode, Unwrapped};
use bun_jsc::{
    AnyPromise, JSFunction, JSGlobalObject, JSHostFn, JSPromise, JSValue,
    JsClass as _, JsError, JsResult, Strong,
};
use bun_ptr::CellExt as _;

use super::matcher::{Passed, This, Verdict};
use super::{Expect, Flags, Promise};
use crate::generated_bindgen::expect_deferred as generated;
use crate::test_runner::bun_test::{
    BunTest, BunTestPtrWeak, Phase, RefDataValue, StepResult,
};
use crate::test_runner::execution::ExecutionSequence;
use crate::test_runner::expect::js as expect_js;
use crate::test_runner::vi_wait::ViWait;

type Matcher<'m, 'a> = &'m dyn Fn(&mut JsScope<'a>, This<'_>) -> JsResult<JSValue>;

/// Enough of a matcher call to repeat it.
pub(crate) struct MatcherCall<'a> {
    pub(crate) expect: &'a Expect,
    pub(crate) this: JSValue,
    pub(crate) callee: JSValue,
    pub(crate) arguments: &'a [JSValue],
    /// As they were on entry: script that the call runs can read `.not` on the same `expect()`.
    pub(crate) flags: Flags,
    /// What `.resolves` / `.rejects` look at.
    pub(crate) settled: Settled,
}

#[derive(Clone, Copy)]
pub(crate) enum Settled {
    NotAPromise,
    Fulfilled(JSValue),
    Rejected(JSValue),
}

impl Settled {
    /// `Err` is the promise to wait for.
    fn of(global: &JSGlobalObject, promise: Option<AnyPromise>) -> Result<Self, AnyPromise> {
        let Some(promise) = promise else {
            return Ok(Self::NotAPromise);
        };
        match promise.unwrap(global.vm(), UnwrapMode::LeaveUnhandled) {
            Unwrapped::Pending => Err(promise),
            Unwrapped::Fulfilled(value) => Ok(Self::Fulfilled(value)),
            Unwrapped::Rejected(reason) => Ok(Self::Rejected(reason)),
        }
    }
}

impl<'a> MatcherCall<'a> {
    #[inline]
    pub(crate) fn new(
        expect: &'a Expect,
        this: JSValue,
        callee: JSValue,
        arguments: &'a [JSValue],
    ) -> Self {
        Self {
            expect,
            this,
            callee,
            arguments,
            flags: expect.flags.get(),
            settled: Settled::NotAPromise,
        }
    }

    /// The generated thunk of a matcher gets its `self` from this.
    #[inline]
    pub(crate) fn payload_ref(&self) -> &'a Expect {
        self.expect
    }
}

unsafe extern "C" {
    safe fn ExpectDeferred__callWhenSettled(
        global: &JSGlobalObject,
        promise: JSValue,
        function: JSValue,
        deferred: JSValue,
    );
    safe fn ExpectDeferred__then(
        global: &JSGlobalObject,
        promise: JSValue,
        on_fulfilled: JSValue,
    ) -> JSValue;
    safe fn ExpectDeferred__takeThrown(global: &JSGlobalObject) -> JSValue;
    safe fn ExpectDeferred__isHandled(promise: JSValue) -> bool;
    safe fn ExpectDeferred__captureCallSite(global: &JSGlobalObject) -> JSValue;
    safe fn ExpectDeferred__continueStackAt(
        global: &JSGlobalObject,
        error: JSValue,
        call_site: JSValue,
    );
    safe fn ExpectDeferred__location(
        global: &JSGlobalObject,
        call_site: JSValue,
        source_url: &mut bun_core::String,
        line: &mut c_uint,
        column: &mut c_uint,
    );
}

/// The test or hook a deferred matcher keeps from ending. Falls back to the concurrent group, then to the file.
pub(crate) struct RunningEntry {
    buntest: BunTestPtrWeak,
    /// `Execution` with `entry_data: None` is a whole concurrent group. Any other variant is the file.
    entry: RefDataValue,
    unclaimed: Option<usize>,
}

/// A test file's deferred matcher calls.
#[derive(Default)]
pub(crate) struct Unclaimed {
    /// `ExpectDeferred` cells. Finished calls become `None` so `RunningEntry::unclaimed` indices stay valid.
    calls: Cell<Vec<Option<Strong>>>,
    /// A test or hook ended with calls still pending, so `settle_ended` has to run.
    pub(crate) some_ended: Cell<bool>,
    /// Abandoned calls reject with this to unwind their awaiters. `is_ended_error` lets the runner drop it unreported.
    ended_error: OnceCell<Strong>,
    /// Pending calls held by the file itself.
    of_file: Cell<u32>,
    /// When the file stops waiting after its tests have run. `EPOCH` means never.
    deadline: OnceCell<Timespec>,
}

impl Unclaimed {
    fn add(&self, global: &JSGlobalObject, deferred: JSValue) -> usize {
        let call = Strong::create(deferred, global);
        self.calls.with_taken(|calls| {
            calls.push(Some(call));
            calls.len() - 1
        })
    }

    /// The first unfinished call from `*index` on. Moves `*index` past it.
    fn next_call(&self, index: &mut usize) -> Option<JSValue> {
        self.calls.with_taken(|calls| {
            loop {
                let call = calls.get(*index)?;
                *index += 1;
                if let Some(call) = call {
                    return Some(call.get());
                }
            }
        })
    }

    fn ended_error(&self, global: &JSGlobalObject) -> JSValue {
        if let Some(error) = self.ended_error.get() {
            return error.get();
        }
        let error = global.create_error_instance(format_args!(
            "The test that called this matcher has ended"
        ));
        self.ended_error
            .get_or_init(|| Strong::create(error, global))
            .get()
    }

    pub(crate) fn is_ended_error(&self, value: JSValue) -> bool {
        self.ended_error
            .get()
            .is_some_and(|error| value == error.get() || value.to_error() == Some(error.get()))
    }

    fn remove(&self, index: usize) {
        self.calls.with_taken(|calls| {
            if let Some(call) = calls.get_mut(index) {
                *call = None;
            }
            while let Some(None) = calls.last() {
                calls.pop();
            }
        });
    }
}

impl RunningEntry {
    fn of(expect: &Expect) -> Option<RunningEntry> {
        let parent = expect.parent.as_ref()?;
        let buntest = parent.bun_test()?;
        let execution = &buntest.execution;
        let mut running = RunningEntry {
            buntest: std::rc::Weak::clone(&parent.buntest_weak),
            entry: match parent.phase {
                RefDataValue::Execution {
                    group_index,
                    entry_data: None,
                } if group_index == execution.group_index.get() => RefDataValue::Execution {
                    group_index,
                    entry_data: execution.on_stack.get(),
                },
                phase @ RefDataValue::Execution { .. } => phase,
                _ => RefDataValue::Done,
            },
            unclaimed: None,
        };
        if running.pending_matchers(&buntest).is_none() {
            running.entry = RefDataValue::Done;
            running.pending_matchers(&buntest)?;
        }
        Some(running)
    }

    fn sequence<'a>(&self, buntest: &'a BunTest) -> Option<&'a ExecutionSequence> {
        if buntest.phase.get() != Phase::Execution {
            return None;
        }
        let (sequence, _) = buntest
            .execution
            .get_current_and_valid_execution_sequence(&self.entry)?;
        Some(sequence)
    }

    fn pending_matchers<'a>(&self, buntest: &'a BunTest) -> Option<&'a Cell<u32>> {
        match self.entry {
            RefDataValue::Execution {
                entry_data: Some(_),
                ..
            } => Some(&self.sequence(buntest)?.pending_matchers),
            RefDataValue::Execution {
                group_index,
                entry_data: None,
            } => {
                if buntest.phase.get() != Phase::Execution
                    || buntest.execution.group_index.get() != group_index
                {
                    return None;
                }
                Some(&buntest.execution.active_group()?.pending_matchers)
            }
            _ => (buntest.phase.get() != Phase::Done).then_some(&buntest.unclaimed.of_file),
        }
    }

    pub(crate) fn is_running(&self) -> bool {
        self.buntest
            .upgrade()
            .is_some_and(|buntest| self.pending_matchers(&buntest).is_some())
    }

    /// Checks the clock directly, because the runner only notices a timeout after the microtask queue drains.
    fn has_timed_out(&self) -> bool {
        let Some(buntest) = self.buntest.upgrade() else {
            return false;
        };
        let limit = self
            .sequence(&buntest)
            .and_then(|sequence| Some(buntest.sequence_entry(sequence.active_entry.get()?).timespec.get()));
        limit.is_some_and(|limit| {
            !limit.eql(&Timespec::EPOCH)
                && limit
                    .order(&Timespec::now(TimespecMockMode::ForceRealTime))
                    .is_lt()
        })
    }

    fn hold(mut self, global: &JSGlobalObject, deferred: JSValue) -> Self {
        let Some(buntest) = self.buntest.upgrade() else {
            return self;
        };
        if let Some(pending_matchers) = self.pending_matchers(&buntest) {
            pending_matchers.update(|pending| pending + 1);
            self.unclaimed = Some(buntest.unclaimed.add(global, deferred));
        }
        self
    }

    /// `failure` is the matcher's error when nothing handles its promise, so it has to be reported here.
    fn release(self, global: &JSGlobalObject, failure: Option<JSValue>) {
        let Some(buntest) = self.buntest.upgrade() else {
            return;
        };
        if self.pending_matchers(&buntest).is_none() {
            return;
        }
        if let Some(index) = self.unclaimed {
            buntest.unclaimed.remove(index);
        }
        if let Some(failure) = failure {
            buntest.on_uncaught_exception(global, Some(failure), true, &self.entry);
        }
        let Some(pending_matchers) = self.pending_matchers(&buntest) else {
            return;
        };
        pending_matchers.update(|pending| pending - 1);
        let none_left = pending_matchers.get() == 0;
        let next = match self.sequence(&buntest) {
            // take(), so the entry ends only once even if several matchers release before the runner's next step.
            Some(sequence) => ((none_left || sequence.maybe_skip.get())
                && sequence.callback_done.take())
            .then_some(self.entry),
            // During collection the runner isn't waiting on these yet, so there's nothing to wake.
            None => (none_left && buntest.phase.get() == Phase::Execution).then_some(RefDataValue::Start),
        };
        if let Some(next) = next {
            buntest.add_result(next);
            BunTest::run_next_tick(&self.buntest, global, next);
        }
    }
}

/// Identifies one call into user code, so a replay can check that a recorded answer belongs to the same call.
#[derive(Copy, Clone)]
pub(crate) struct Question {
    pub(crate) asked: Asked,
    /// The callee (a function or an `ExpectCustomAsymmetricMatcher`) when one matcher can call several, else undefined.
    pub(crate) who: JSValue,
    /// The value the call is about, e.g. the received value or the function to call.
    pub(crate) what: JSValue,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Asked {
    Matcher,
    Promise,
    Call,
    Items,
    Poll,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Role {
    Matcher,
    Replaying,
    /// Wraps a function that returns its result to user code synchronously, so nothing under it may defer.
    Barrier,
}

/// One run of a matcher body. Must stay on the stack, where the GC's conservative scan keeps its JSValues alive.
pub(crate) struct Pass {
    outer: Cell<*const Pass>,
    role: Role,
    /// Number of `once()` calls so far. For `Role::Replaying`, how many were answered from the journal.
    cursor: Cell<u32>,
    /// Four bits per `recent` entry: `Asked << 1 | threw`.
    recent_kinds: Cell<u32>,
    /// For `Role::Matcher`, a flat array of `[kind, who, what, answer]` records, empty until the matcher has to wait or
    /// `recent` fills up. For `Role::Replaying`, the `ExpectDeferred`.
    /// Only accessed as own properties, so script can't observe or change it through `Array.prototype`.
    journal: Cell<JSValue>,
    /// `[who, what, answer]` per `once()` call, until `journal` exists.
    recent: [[Cell<JSValue>; 3]; Pass::RECENT],
}

pub(crate) struct EnteredPass<'a>(&'a Pass);

impl Drop for EnteredPass<'_> {
    #[inline]
    fn drop(&mut self) {
        Pass::innermost().set(self.0.outer.get());
    }
}

impl Pass {
    const RECENT: usize = 4;
    const STRIDE: u32 = 4;

    #[inline]
    fn new(role: Role, journal: JSValue) -> Pass {
        Pass {
            outer: Cell::new(core::ptr::null()),
            role,
            cursor: Cell::new(0),
            recent_kinds: Cell::new(0),
            journal: Cell::new(journal),
            recent: [const { [const { Cell::new(JSValue::ZERO) }; 3] }; Self::RECENT],
        }
    }

    #[inline]
    fn of_matcher() -> Pass {
        Self::new(Role::Matcher, JSValue::ZERO)
    }

    fn replaying(deferred: JSValue) -> Pass {
        Self::new(Role::Replaying, deferred)
    }

    pub(crate) fn barrier() -> Pass {
        Self::new(Role::Barrier, JSValue::ZERO)
    }

    #[inline]
    fn innermost() -> &'static Cell<*const Pass> {
        &crate::jsc_hooks::runtime_state().matcher_pass
    }

    #[inline]
    pub(crate) fn enter(&self) -> EnteredPass<'_> {
        self.outer.set(Self::innermost().replace(self));
        EnteredPass(self)
    }

    /// `None` if no matcher body is running or a barrier is in between, so the caller can't defer.
    #[inline]
    fn current<'a>() -> Option<&'a Pass> {
        // SAFETY: a live `EnteredPass` in a caller's frame borrows whatever `innermost()` points to.
        unsafe { Self::innermost().get().as_ref() }.filter(|pass| pass.role == Role::Matcher)
    }

    #[inline]
    fn replaying_frame(&self) -> Option<&Pass> {
        // SAFETY: as in `current`.
        unsafe { self.outer.get().as_ref() }.filter(|outer| outer.role == Role::Replaying)
    }

    #[inline]
    fn replayed(&self) -> Option<JSValue> {
        self.replaying_frame().map(|frame| frame.journal.get())
    }

    /// Runs `ask()` (user code) on the first pass and records what it returned or threw. Replays get the recording.
    #[inline(never)]
    #[optimize(size)]
    pub(crate) fn once(
        global: &JSGlobalObject,
        question: Question,
        ask: &mut dyn FnMut() -> JsResult<JSValue>,
    ) -> JsResult<JSValue> {
        Self::once_inline(global, question, ask)
    }

    /// `once()` for the one hot caller, custom matchers.
    #[inline(always)]
    pub(crate) fn once_inline(
        global: &JSGlobalObject,
        question: Question,
        mut ask: impl FnMut() -> JsResult<JSValue>,
    ) -> JsResult<JSValue> {
        let Some(pass) = Self::current() else {
            return ask();
        };
        let at = pass.cursor.get();
        pass.cursor.set(at + 1);
        if at == 0
            && let Some(journal) = pass.replayed().and_then(js::journal_get_cached)
        {
            pass.journal.set(journal);
        }
        let Some([who, what, answered]) =
            pass.recent.get(at as usize).filter(|_| pass.journal.get().is_empty())
        else {
            return pass.once_in_journal(global, at, question, &mut ask);
        };
        let answer = ask();
        let (threw, value) = Self::returned_or_thrown(global, answer)?;
        who.set(question.who);
        what.set(question.what);
        answered.set(value);
        pass.recent_kinds.set(
            pass.recent_kinds.get() | ((question.asked as u32) << 1 | u32::from(threw)) << (at * 4),
        );
        Self::return_or_throw(global, threw, value)
    }

    #[inline]
    fn returned_or_thrown(
        global: &JSGlobalObject,
        answer: JsResult<JSValue>,
    ) -> JsResult<(bool, JSValue)> {
        match answer {
            Ok(value) => Ok((false, value)),
            Err(JsError::Thrown) if !global.has_pending_termination_exception() => {
                Ok((true, global.take_exception(JsError::Thrown)))
            }
            Err(err) => Err(err),
        }
    }

    #[inline]
    fn return_or_throw(global: &JSGlobalObject, threw: bool, value: JSValue) -> JsResult<JSValue> {
        if threw {
            Err(global.throw_value(value))
        } else {
            Ok(value)
        }
    }

    #[cold]
    #[optimize(size)]
    fn journal(&self, global: &JSGlobalObject, recorded: u32) -> JsResult<JSValue> {
        if self.journal.get().is_empty() {
            let mut elements = [JSValue::UNDEFINED; Self::RECENT * Self::STRIDE as usize];
            let recorded = (recorded as usize).min(Self::RECENT);
            for (index, [who, what, answered]) in self.recent[..recorded].iter().enumerate() {
                let kind = (self.recent_kinds.get() >> (index * 4)) & 0xF;
                elements[index * Self::STRIDE as usize..][..Self::STRIDE as usize].copy_from_slice(&[
                    JSValue::js_number_from_int32(kind as i32),
                    who.get(),
                    what.get(),
                    answered.get(),
                ]);
            }
            self.journal.set(JSValue::create_array_from_slice(
                global,
                &elements[..recorded * Self::STRIDE as usize],
            )?);
        }
        Ok(self.journal.get())
    }

    #[cold]
    fn took_another_path(global: &JSGlobalObject) -> JsError {
        global.throw(format_args!(
            "The values being compared changed while the matcher waited for a promise, or a getter returns a different value on each read. `await` the matcher before changing them, and compare values that stay the same"
        ))
    }

    #[cold]
    #[inline(never)]
    fn once_in_journal(
        &self,
        global: &JSGlobalObject,
        at: u32,
        question: Question,
        ask: &mut dyn FnMut() -> JsResult<JSValue>,
    ) -> JsResult<JSValue> {
        let journal = self.journal(global, at)?;
        let index = at * Self::STRIDE;
        if u64::from(index) < journal.get_length(global)? {
            let kind = journal.get_direct_index(global, index)?;
            if !kind.is_int32()
                || kind.to_int32() >> 1 != question.asked as i32
                || journal.get_direct_index(global, index + 1)? != question.who
                || !journal
                    .get_direct_index(global, index + 2)?
                    .is_same_value(question.what, global)?
            {
                return Err(Self::took_another_path(global));
            }
            let threw = kind.to_int32() & 1 != 0;
            if let Some(frame) = self.replaying_frame() {
                frame.cursor.set(at + 1);
            }
            return Self::return_or_throw(global, threw, journal.get_direct_index(global, index + 3)?);
        }
        let answer = ask();
        let (threw, value) = Self::returned_or_thrown(global, answer)?;
        let kind = (question.asked as i32) << 1 | i32::from(threw);
        let elements = [JSValue::js_number_from_int32(kind), question.who, question.what, value];
        for (index, element) in (index..).zip(elements) {
            journal.put_index(global, index, element)?;
        }
        Self::return_or_throw(global, threw, value)
    }

    pub(crate) fn settled(
        global: &JSGlobalObject,
        question: Question,
        ask: &mut dyn FnMut() -> JsResult<JSValue>,
    ) -> JsResult<Settled> {
        let promise = Self::once(global, question, ask)?.as_any_promise();
        Settled::of(global, promise).map_err(|pending| Self::wait_for(global, pending))
    }

    /// Throws an `ExpectDeferred`, which makes the running matcher return a promise and re-run once `promise` settles.
    /// `promise` must come from `once()`, so the re-run sees the same one.
    #[cold]
    pub(crate) fn wait_for(global: &JSGlobalObject, promise: AnyPromise) -> JsError {
        let Some(pass) = Self::current() else {
            return global.throw(format_args!(
                "An async matcher only works inside an expect() matcher, which then returns a promise: await expect(received).toEqual(expected)"
            ));
        };
        let journal = match pass.journal(global, pass.cursor.get()) {
            Ok(journal) => journal,
            Err(err) => return err,
        };
        let deferred = pass
            .replayed()
            .unwrap_or_else(|| ExpectDeferred::waiting(global));
        js::awaited_set_cached(deferred, global, promise.as_value());
        js::journal_set_cached(deferred, global, journal);
        global.throw_value(deferred)
    }
}

/// A matcher call waiting on a promise. [`Pass::wait_for`] throws it and `Expect::matcher_threw` catches it.
pub(crate) struct ExpectDeferred {
    held: Cell<Option<RunningEntry>>,
    replays: Cell<u32>,
    is_abandoned: Cell<bool>,
}

pub(crate) use crate::generated_bindgen::expect_deferred::js_ExpectDeferred as js;

impl ExpectDeferred {
    /// Each replay gets one promise further, so this caps how many promises a single matcher call can wait for.
    const MAX_REPLAYS: u32 = 2_000;

    fn waiting(global: &JSGlobalObject) -> JSValue {
        ExpectDeferred {
            held: Cell::new(None),
            replays: Cell::new(0),
            is_abandoned: Cell::new(false),
        }
        .to_js(global)
    }

    /// Captures the stack as a `JSC::Exception`, which keeps its frames alive. GC can flatten an Error's frames to text.
    pub(crate) fn capture_call_site(global: &JSGlobalObject) -> JSValue {
        ExpectDeferred__captureCallSite(global)
    }

    pub(crate) fn call_site(global: &JSGlobalObject, expect: JSValue) -> Option<CallerSrcLoc> {
        let deferred = Pass::current()?.replayed()?;
        if js::expect_get_cached(deferred) != Some(expect) {
            return None;
        }
        let mut location = CallerSrcLoc {
            str: bun_core::String::default(),
            line: 0,
            column: 0,
        };
        ExpectDeferred__location(
            global,
            js::call_site_get_cached(deferred)?,
            &mut location.str,
            &mut location.line,
            &mut location.column,
        );
        Some(location)
    }

    /// Schedules `call` to re-run once `thrown`'s awaited promise settles. Returns the call's promise.
    fn defer(
        thrown: JSValue,
        global: &JSGlobalObject,
        call: &MatcherCall<'_>,
    ) -> JsResult<JSValue> {
        let Some(awaited) = js::awaited_get_cached(thrown) else {
            return Ok(JSValue::UNDEFINED);
        };
        let when_settled = private_function(global, generated::Bun__ExpectDeferred__onSettled);
        if let Some(promise) = js::promise_get_cached(thrown) {
            ExpectDeferred__callWhenSettled(global, awaited, when_settled, thrown);
            return Ok(promise);
        }

        let promise = JSPromise::create(global).to_js();
        let copy = call.expect.private_copy(global, call);
        js::expect_set_cached(thrown, global, copy);
        js::call_set_cached(
            thrown,
            global,
            call.callee.bind(
                global,
                copy,
                &call.callee.get_name(global)?,
                0.0,
                call.arguments,
            )?,
        );
        js::promise_set_cached(thrown, global, promise);
        js::call_site_set_cached(thrown, global, ExpectDeferred__captureCallSite(global));
        ExpectDeferred__callWhenSettled(global, awaited, when_settled, thrown);
        if let Some(this) = Self::from_js(&thrown) {
            this.held
                .set(RunningEntry::of(call.expect).map(|entry| entry.hold(global, thrown)));
        }
        Ok(promise)
    }

    fn run_again(global: &JSGlobalObject, deferred: JSValue) -> JsResult<()> {
        let (Some(this), Some(call), Some(promise)) = (
            Self::from_js(&deferred),
            js::call_get_cached(deferred),
            js::promise_get_cached(deferred),
        ) else {
            return Ok(());
        };
        if this.is_abandoned.get() {
            return Ok(());
        }
        if let Some(held) = this.held.take() {
            let (is_running, buntest) = (held.is_running(), held.buntest.upgrade());
            let has_timed_out = is_running && held.has_timed_out();
            this.held.set(Some(held));
            if !is_running {
                return this.abandon(global, deferred, buntest.as_deref());
            }
            // The runner is about to time the entry out, and `settle_ended` will then abandon this call.
            if has_timed_out {
                return Ok(());
            }
        }

        this.replays.set(this.replays.get() + 1);
        let result = if this.replays.get() > Self::MAX_REPLAYS {
            Err(global.throw(format_args!(
                "{}() waited for {} promises in a row and hit another one",
                call.get_name(global)?,
                Self::MAX_REPLAYS,
            )))
        } else {
            let recorded = match js::journal_get_cached(deferred) {
                Some(journal) => journal.get_length(global)? / u64::from(Pass::STRIDE),
                None => 0,
            };
            let pass = Pass::replaying(deferred);
            let _entered = pass.enter();
            let result = call.call(global, JSValue::UNDEFINED, &[]);
            if u64::from(pass.cursor.get()) >= recorded
                || matches!(result, Ok(returned) if returned == promise)
                || matches!(result, Err(JsError::Terminated))
                || global.has_pending_termination_exception()
            {
                result
            } else {
                // The replay finished without reaching the point where it had waited.
                global.clear_exception();
                Err(Pass::took_another_path(global))
            }
        };

        let Some(promise_ptr) = promise.as_promise() else {
            return Ok(());
        };
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
                if matches!(err, JsError::Terminated) || global.has_pending_termination_exception()
                {
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

    /// Abandons the calls still held by the group (or by the file, if `group_index` is `None`) and reports the unhandled ones.
    #[optimize(size)]
    fn give_up(
        buntest: &BunTest,
        global: &JSGlobalObject,
        group_index: Option<usize>,
        message: core::fmt::Arguments<'_>,
    ) {
        let mut index = 0;
        while let Some(deferred) = buntest.unclaimed.next_call(&mut index) {
            let Some(this) = Self::from_js(&deferred) else {
                continue;
            };
            let held_by = this.held.with_taken(|held| held.as_ref().map(|held| held.entry));
            let is_held = match (held_by, group_index) {
                (
                    Some(RefDataValue::Execution {
                        group_index: held_by,
                        entry_data: None,
                    }),
                    group_index,
                ) => group_index == Some(held_by),
                (Some(RefDataValue::Execution { .. }), _) => false,
                (Some(_), group_index) => group_index.is_none(),
                (None, _) => false,
            };
            if !is_held {
                continue;
            }
            let is_handled = js::promise_get_cached(deferred)
                .is_some_and(ExpectDeferred__isHandled);
            crate::dispatch::fold(this.abandon(global, deferred, Some(buntest)));
            if is_handled {
                continue;
            }
            let error = global.create_error_instance(message);
            if let Some(call_site) = js::call_site_get_cached(deferred) {
                ExpectDeferred__continueStackAt(global, error, call_site);
            }
            buntest.on_uncaught_exception(global, Some(error), false, &RefDataValue::Start);
        }
    }

    /// Rejects the promise without re-running the matcher, so awaiters still unwind through their `finally` blocks.
    fn abandon(
        &self,
        global: &JSGlobalObject,
        deferred: JSValue,
        buntest: Option<&BunTest>,
    ) -> JsResult<()> {
        self.is_abandoned.set(true);
        let held = self.held.take();
        let Some(buntest) = buntest else {
            return Ok(());
        };
        if let Some(index) = held.and_then(|held| held.unclaimed) {
            buntest.unclaimed.remove(index);
        }
        let Some(promise) = js::promise_get_cached(deferred).and_then(JSValue::as_promise) else {
            return Ok(());
        };
        let error = buntest.unclaimed.ended_error(global);
        JSPromise::opaque_mut(promise).reject_as_handled(global, error)
    }

    pub(crate) fn settle_ended(buntest: &BunTest, global: &JSGlobalObject) -> JsResult<()> {
        let mut index = 0;
        while let Some(deferred) = buntest.unclaimed.next_call(&mut index) {
            let Some(this) = Self::from_js(&deferred) else {
                continue;
            };
            if this.held.with_taken(|held| held.as_ref().is_none_or(RunningEntry::is_running)) {
                continue;
            }
            this.abandon(global, deferred, Some(buntest))?;
        }
        Ok(())
    }

    pub(crate) fn group_timed_out(
        buntest: &BunTest,
        global: &JSGlobalObject,
        group_index: usize,
    ) {
        Self::give_up(
            buntest,
            global,
            Some(group_index),
            format_args!(
                "An un-awaited matcher in a concurrent test timed out because its promise never settled"
            ),
        );
    }

    /// After a file's tests have run, keeps the file open until the calls it holds finish or time out.
    pub(crate) fn step_file_end(
        buntest: &BunTest,
        global: &JSGlobalObject,
        now: &Timespec,
    ) -> StepResult {
        if buntest.unclaimed.of_file.get() == 0 {
            return StepResult::Complete;
        }
        let runner = &buntest.reporter.jest;
        let timeout_ms = match runner.default_timeout_override.get() {
            u32::MAX => runner.default_timeout_ms,
            timeout_ms => timeout_ms,
        };
        let deadline = *buntest.unclaimed.deadline.get_or_init(|| match timeout_ms {
            0 => Timespec::EPOCH,
            timeout_ms => now.add_ms(i64::from(timeout_ms)),
        });
        if deadline.eql(&Timespec::EPOCH) || deadline.order(now).is_gt() {
            return StepResult::Waiting { timeout: deadline };
        }
        buntest.unclaimed.of_file.set(0);
        Self::give_up(
            buntest,
            global,
            None,
            format_args!(
                "An un-awaited matcher called outside a test timed out {timeout_ms}ms after its file's tests finished because its promise never settled"
            ),
        );
        StepResult::Complete
    }
}

/// Hidden from stack traces.
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

pub(crate) fn on_settled(cx: &mut JsScope<'_>, _value: JsLocal<'_>, deferred: JsLocal<'_>) -> JsResult<()> {
    ExpectDeferred::run_again(cx.global(), deferred.to_js())?;
    Ok(())
}

#[optimize(size)]
pub(crate) fn poll_once(cx: &mut JsScope<'_>, callback: JsLocal<'_>, check: JsLocal<'_>) -> JsResult<JSValue> {
    let global = cx.global();
    let (function, check) = (callback.to_js(), check.to_js());
    let value = function.call(global, JSValue::UNDEFINED, &[])?;
    match Expect::promise_to_await(global, value)? {
        Some(promise) => Ok(ExpectDeferred__then(global, promise.as_value(), check)),
        None => check.call(global, JSValue::UNDEFINED, &[value]),
    }
}

#[optimize(size)]
pub(crate) fn check_polled(
    cx: &mut JsScope<'_>,
    expect: JsLocal<'_>,
    call: JsLocal<'_>,
    value: JsLocal<'_>,
) -> JsResult<JSValue> {
    let global = cx.global();
    expect_js::captured_value_set_cached(expect.to_js(), global, value.to_js());
    call.to_js().call(global, JSValue::UNDEFINED, &[])
}

/// Vitest rejects these too. A throw from the polled function is just retried, and a new snapshot passes on the first try.
const NOT_POLLED: [&[u8]; 6] = [
    b"toThrow",
    b"toThrowError",
    b"toMatchSnapshot",
    b"toMatchInlineSnapshot",
    b"toThrowErrorMatchingSnapshot",
    b"toThrowErrorMatchingInlineSnapshot",
];

impl Expect {
    /// The `protoCaller` in expect.bind.ts. Inlined into the thunk of every matcher, it took 32 KB.
    #[inline(never)]
    pub(crate) fn call_matcher<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        callee: JsLocal<'a>,
        arguments: &'a [JsLocal<'a>],
        matcher: fn(This<'_>, &mut JsScope<'a>, &'a [JsLocal<'a>]) -> Verdict,
    ) -> JsResult<JSValue> {
        let call = MatcherCall::new(
            self,
            this_value.to_js(),
            callee.to_js(),
            JsLocal::to_js_slice(arguments),
        );
        self.run_matcher(cx, &call, |cx, call| {
            let result = matcher(call, cx, arguments);
            cx.global().bun_vm().auto_garbage_collect();
            result.map(Passed::into_js)
        })
    }

    /// Every matcher runs through here.
    #[inline]
    pub(crate) fn run_matcher<'a>(
        &self,
        cx: &mut JsScope<'a>,
        call: &MatcherCall<'_>,
        matcher: impl Fn(&mut JsScope<'a>, This<'_>) -> JsResult<JSValue>,
    ) -> JsResult<JSValue> {
        self.matcher_ran.set(true);
        if !call.flags.is_plain() {
            return self.call_modified_matcher(cx, call, &matcher);
        }
        let pass = Pass::of_matcher();
        let _entered = pass.enter();
        match matcher(cx, call) {
            Ok(value) => Ok(value),
            Err(error) => self.matcher_failed(cx.global(), call, error),
        }
    }

    #[cold]
    fn matcher_failed(
        &self,
        global: &JSGlobalObject,
        call: &MatcherCall<'_>,
        error: JsError,
    ) -> JsResult<JSValue> {
        match error {
            JsError::Thrown => self.matcher_threw(global, call),
            error => Err(error),
        }
    }

    #[cold]
    fn call_modified_matcher<'a>(
        &self,
        cx: &mut JsScope<'a>,
        call: &MatcherCall<'_>,
        matcher: Matcher<'_, 'a>,
    ) -> JsResult<JSValue> {
        let pass = Pass::of_matcher();
        let _entered = pass.enter();
        let flags = call.flags;
        let result = if flags.promise() != Promise::None {
            self.call_matcher_on_promise(cx, call, matcher)
        } else {
            let result = if flags.poll() {
                self.poll_matcher(cx.global(), call)
            } else {
                matcher(cx, call)
            };
            match result {
                Err(JsError::Thrown) => self.matcher_threw(cx.global(), call),
                result => result,
            }
        };
        match result {
            Err(JsError::Thrown) if flags.soft() => self.fail_softly(cx.global(), &pass, flags),
            result => result,
        }
    }

    /// For `expect.soft()`. Fails the test with the thrown error but lets it continue. Stays thrown if the test isn't known.
    fn fail_softly(&self, global: &JSGlobalObject, pass: &Pass, flags: Flags) -> JsResult<JSValue> {
        let Some(test) = RunningEntry::of(self) else {
            return Err(JsError::Thrown);
        };
        let Some(buntest) = test.buntest.upgrade() else {
            return Err(JsError::Thrown);
        };
        let Some(sequence) = test.sequence(&buntest) else {
            return Err(JsError::Thrown);
        };
        if global.has_pending_termination_exception() {
            return Err(JsError::Thrown);
        }
        let exception = global.take_exception(JsError::Thrown);
        let error = exception.to_error().unwrap_or(exception);
        if let Some(call_site) = pass.replayed().and_then(js::call_site_get_cached) {
            ExpectDeferred__continueStackAt(global, error, call_site);
        }
        let maybe_skip = sequence.maybe_skip.get();
        buntest.on_uncaught_exception(global, Some(error), false, &test.entry);
        sequence.maybe_skip.set(maybe_skip);
        Ok(match flags.promise() {
            Promise::None => JSValue::UNDEFINED,
            _ => JSPromise::resolved_promise_value(global, JSValue::UNDEFINED),
        })
    }

    #[optimize(size)]
    fn poll_matcher(&self, global: &JSGlobalObject, call: &MatcherCall<'_>) -> JsResult<JSValue> {
        self.increment_expect_call_counter();
        let question = Question {
            asked: Asked::Poll,
            who: JSValue::UNDEFINED,
            what: JSValue::UNDEFINED,
        };
        let polling = Pass::once(global, question, &mut || self.start_polling(global, call))?;
        let Some(polling) = polling.as_any_promise() else {
            return Ok(JSValue::UNDEFINED);
        };
        match polling.unwrap(global.vm(), UnwrapMode::MarkHandled) {
            Unwrapped::Fulfilled(_) => Ok(JSPromise::resolved_promise_value(
                global,
                JSValue::UNDEFINED,
            )),
            Unwrapped::Rejected(error) => Err(global.throw_value(error)),
            Unwrapped::Pending => Err(Pass::wait_for(global, polling)),
        }
    }

    fn start_polling(&self, global: &JSGlobalObject, call: &MatcherCall<'_>) -> JsResult<JSValue> {
        let name = call.callee.get_name(global)?;
        if NOT_POLLED
            .iter()
            .any(|not_polled| name.eq_ascii(not_polled))
        {
            return Err(global.throw(format_args!(
                "expect.poll() does not support .{name}(). Use vi.waitFor() instead"
            )));
        }
        let function =
            expect_js::captured_value_get_cached(call.this).unwrap_or(JSValue::UNDEFINED);
        let times = expect_js::result_value_get_cached(call.this).unwrap_or(JSValue::UNDEFINED);
        let [interval_ms, timeout_ms] = [times.get_index(global, 0)?, times.get_index(global, 1)?];

        // `parent: None` keeps the attempts out of the assertion count. Only `call` is counted.
        let expect = Expect {
            flags: Cell::new(Flags(call.flags.0 & Flags::NOT_MASK)),
            matcher_ran: Cell::new(false),
            parent: None,
            custom_label: self.custom_label.clone(),
        }
        .to_js(global);
        let bind = |function: JSValue, this_value: JSValue, arguments: &[JSValue]| {
            function.bind(global, this_value, &bun_core::String::EMPTY, 0.0, arguments)
        };
        let attempted_call = bind(call.callee, expect, call.arguments)?;
        let check = bind(
            private_function(global, generated::Bun__ExpectDeferred__checkPolled),
            JSValue::UNDEFINED,
            &[expect, attempted_call],
        )?;
        let attempt = bind(
            private_function(global, generated::Bun__ExpectDeferred__pollOnce),
            JSValue::UNDEFINED,
            &[function, check],
        )?;
        ViWait::poll_matcher(
            global,
            attempt,
            interval_ms.to_int32() as u32,
            timeout_ms.to_int32() as u32,
            RunningEntry::of(self),
        )
    }

    fn call_matcher_on_promise<'a>(
        &self,
        cx: &mut JsScope<'a>,
        call: &MatcherCall<'_>,
        matcher: Matcher<'_, 'a>,
    ) -> JsResult<JSValue> {
        let this_value = call.this;
        let global = cx.global();
        let kept = expect_js::result_value_get_cached(this_value);
        let first_call = kept.is_none();
        let promise = match kept {
            Some(kept) => kept.as_any_promise(),
            None => {
                let received =
                    expect_js::captured_value_get_cached(this_value).unwrap_or(JSValue::UNDEFINED);
                let promise = Self::received_promise(global, received)?;
                expect_js::result_value_set_cached(
                    this_value,
                    global,
                    promise.map_or(JSValue::NULL, AnyPromise::as_value),
                );
                promise
            }
        };
        // bun:test checks a settled promise right away and throws, as it always has. Vitest always returns a promise.
        let always_defer = first_call && self.is_vitest();
        let settled = match promise {
            Some(promise) if always_defer => Err(promise),
            promise => Settled::of(global, promise),
        };
        let result = match settled {
            Err(promise) => {
                let deferred = ExpectDeferred::waiting(global);
                js::awaited_set_cached(deferred, global, promise.as_value());
                ExpectDeferred::defer(deferred, global, call)
            }
            Ok(settled) => match matcher(cx, &MatcherCall { settled, ..*call }) {
                Ok(_) => Ok(JSPromise::resolved_promise_value(
                    cx.global(),
                    JSValue::UNDEFINED,
                )),
                Err(JsError::Thrown) => self.matcher_threw(cx.global(), call),
                Err(err) => Err(err),
            },
        };
        if first_call {
            expect_js::result_value_set_cached(this_value, cx.global(), JSValue::ZERO);
        }
        result
    }

    #[cold]
    fn matcher_threw(&self, global: &JSGlobalObject, call: &MatcherCall<'_>) -> JsResult<JSValue> {
        let thrown = ExpectDeferred__takeThrown(global);
        if thrown.is_empty() {
            return Err(JsError::Thrown);
        }
        // The replay counts this call again.
        self.add_to_expect_call_counter(-1);
        ExpectDeferred::defer(thrown, global, call)
    }

    /// The deferred matcher's own Expect, so later chaining can't change its flags.
    fn private_copy(&self, global: &JSGlobalObject, call: &MatcherCall<'_>) -> JSValue {
        let copy = Expect {
            flags: Cell::new(call.flags),
            matcher_ran: Cell::new(false),
            parent: self.parent.clone(),
            custom_label: self.custom_label.clone(),
        }
        .to_js(global);
        if let Some(received) = expect_js::captured_value_get_cached(call.this) {
            expect_js::captured_value_set_cached(copy, global, received);
        }
        if let Some(promise) = expect_js::result_value_get_cached(call.this) {
            expect_js::result_value_set_cached(copy, global, promise);
        }
        copy
    }
}
