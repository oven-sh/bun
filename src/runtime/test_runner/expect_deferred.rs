//! A matcher that hits a pending promise returns its own promise and re-runs from the top once the pending one settles.
//! The re-run replays the recorded results of earlier user-code calls (`Pass::once`) instead of calling user code again.

use core::cell::Cell;
use core::ffi::c_uint;
use core::ptr::NonNull;

use bun_core::{Timespec, TimespecMockMode};
use bun_jsc::call_frame::CallerSrcLoc;
use bun_jsc::js_promise::{Status, UnwrapMode, Unwrapped};
use bun_jsc::{
    AnyPromise, CallFrame, JSFunction, JSGlobalObject, JSHostFn, JSPromise, JSValue, JsCell,
    JsClass as _, JsError, JsResult, Strong,
};

use super::{Expect, Flags, Promise};
use crate::test_runner::bun_test::{
    BunTest, BunTestPtr, BunTestPtrWeak, Phase, RefDataValue, StepResult,
};
use crate::test_runner::execution::ExecutionSequence;
use crate::test_runner::expect::js as expect_js;
use crate::test_runner::vi_wait::ViWait;

pub(crate) type Matcher = fn(&Expect, &JSGlobalObject, &CallFrame) -> JsResult<JSValue>;

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
    calls: Vec<Option<Strong>>,
    /// A test or hook ended with calls still pending, so `settle_ended` has to run.
    pub(crate) some_ended: bool,
    /// Abandoned calls reject with this to unwind their awaiters. `is_ended_error` lets the runner drop it unreported.
    ended_error: Option<Strong>,
    /// Pending calls held by the file itself.
    of_file: u32,
    /// When the file stops waiting after its tests have run. `EPOCH` means never.
    deadline: Option<Timespec>,
}

impl Unclaimed {
    fn add(&mut self, global: &JSGlobalObject, deferred: JSValue) -> usize {
        self.calls.push(Some(Strong::create(deferred, global)));
        self.calls.len() - 1
    }

    fn ended_error(&mut self, global: &JSGlobalObject) -> JSValue {
        self.ended_error
            .get_or_insert_with(|| {
                let error = global.create_error_instance(format_args!(
                    "The test that called this matcher has ended"
                ));
                Strong::create(error, global)
            })
            .get()
    }

    pub(crate) fn is_ended_error(&self, value: JSValue) -> bool {
        self.ended_error
            .as_ref()
            .is_some_and(|error| value == error.get() || value.to_error() == Some(error.get()))
    }

    fn remove(&mut self, index: usize) {
        if let Some(call) = self.calls.get_mut(index) {
            *call = None;
        }
        while let Some(None) = self.calls.last() {
            self.calls.pop();
        }
    }
}

impl RunningEntry {
    fn of(expect: &Expect) -> Option<RunningEntry> {
        let parent = expect.parent.as_ref()?;
        let buntest = parent.bun_test()?;
        let execution = &buntest.get().execution;
        let mut running = RunningEntry {
            buntest: std::rc::Weak::clone(&parent.buntest_weak),
            entry: match parent.phase {
                RefDataValue::Execution {
                    group_index,
                    entry_data: None,
                } if group_index == execution.group_index => RefDataValue::Execution {
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

    fn sequence(&self, buntest: &BunTestPtr) -> Option<NonNull<ExecutionSequence>> {
        let buntest = buntest.get();
        if buntest.phase != Phase::Execution {
            return None;
        }
        Some(
            buntest
                .execution
                .get_current_and_valid_execution_sequence(&self.entry)?
                .0,
        )
    }

    fn pending_matchers(&self, buntest: &BunTestPtr) -> Option<NonNull<u32>> {
        match self.entry {
            RefDataValue::Execution {
                entry_data: Some(_),
                ..
            } => self.sequence(buntest).map(|sequence| {
                // SAFETY: points into `buntest.execution.sequences`; nothing else borrows it here.
                NonNull::from(unsafe { &mut (*sequence.as_ptr()).pending_matchers })
            }),
            RefDataValue::Execution {
                group_index,
                entry_data: None,
            } => {
                let buntest = buntest.get();
                if buntest.phase != Phase::Execution || buntest.execution.group_index != group_index
                {
                    return None;
                }
                let group = buntest.execution.groups.get_mut(group_index)?;
                Some(NonNull::from(&mut group.pending_matchers))
            }
            _ => {
                let buntest = buntest.get();
                (buntest.phase != Phase::Done)
                    .then(|| NonNull::from(&mut buntest.unclaimed.of_file))
            }
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
        // SAFETY: as in `pending_matchers`; an entry outlives the sequences that run it.
        let limit = self.sequence(&buntest).and_then(|sequence| unsafe {
            Some(sequence.as_ref().active_entry?.as_ref().timespec)
        });
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
            // SAFETY: as in `pending_matchers`.
            unsafe { *pending_matchers.as_ptr() += 1 };
            self.unclaimed = Some(buntest.get().unclaimed.add(global, deferred));
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
            buntest.get().unclaimed.remove(index);
        }
        if let Some(failure) = failure {
            buntest
                .get()
                .on_uncaught_exception(global, Some(failure), true, &self.entry);
        }
        let Some(pending_matchers) = self.pending_matchers(&buntest) else {
            return;
        };
        // SAFETY: as in `pending_matchers`.
        let none_left = unsafe {
            *pending_matchers.as_ptr() -= 1;
            *pending_matchers.as_ptr() == 0
        };
        let next = match self.sequence(&buntest) {
            Some(sequence) => {
                // SAFETY: as in `pending_matchers`.
                let sequence = unsafe { &mut *sequence.as_ptr() };
                // take(), so the entry ends only once even if several matchers release before the runner's next step.
                ((none_left || sequence.maybe_skip)
                    && core::mem::take(&mut sequence.callback_done))
                .then_some(self.entry)
            }
            // During collection the runner isn't waiting on these yet, so there's nothing to wake.
            None => (none_left && buntest.phase == Phase::Execution).then_some(RefDataValue::Start),
        };
        if let Some(next) = next {
            buntest.get().add_result(next);
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
    fn innermost<'a>() -> &'a Cell<*const Pass> {
        // SAFETY: every JS thread has a `RuntimeState` that outlives the script it runs.
        unsafe { &(*crate::jsc_hooks::runtime_state()).matcher_pass }
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
    ) -> JsResult<Option<AnyPromise>> {
        let Some(promise) = Self::once(global, question, ask)?.as_any_promise() else {
            return Ok(None);
        };
        if promise.status() == Status::Pending {
            return Err(Self::wait_for(global, promise));
        }
        Ok(Some(promise))
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
#[bun_jsc::JsClass(no_construct, no_constructor)]
pub(crate) struct ExpectDeferred {
    held: JsCell<Option<RunningEntry>>,
    replays: Cell<u32>,
    is_abandoned: Cell<bool>,
}

pub(crate) mod js {
    bun_jsc::codegen_cached_accessors!("ExpectDeferred"; expect, call, promise, callSite, awaited, journal);
}

impl ExpectDeferred {
    /// Each replay gets one promise further, so this caps how many promises a single matcher call can wait for.
    const MAX_REPLAYS: u32 = 2_000;

    fn waiting(global: &JSGlobalObject) -> JSValue {
        ExpectDeferred {
            held: JsCell::new(None),
            replays: Cell::new(0),
            is_abandoned: Cell::new(false),
        }
        .to_js(global)
    }

    /// Captures the stack as a `JSC::Exception`, which keeps its frames alive. GC can flatten an Error's frames to text.
    pub(crate) fn capture_call_site(global: &JSGlobalObject) -> JSValue {
        ExpectDeferred__captureCallSite(global)
    }

    pub(crate) fn call_site(global: &JSGlobalObject, frame: &CallFrame) -> Option<CallerSrcLoc> {
        let deferred = Pass::current()?.replayed()?;
        if js::expect_get_cached(deferred) != Some(frame.this()) {
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

    /// Schedules the matcher call in `frame` to re-run once `thrown`'s awaited promise settles. Returns the call's promise.
    fn defer(
        thrown: JSValue,
        expect: &Expect,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let Some(awaited) = js::awaited_get_cached(thrown) else {
            return Ok(JSValue::UNDEFINED);
        };
        let when_settled = private_function(global, __jsc_host_on_settled);
        if let Some(promise) = js::promise_get_cached(thrown) {
            ExpectDeferred__callWhenSettled(global, awaited, when_settled, thrown);
            return Ok(promise);
        }

        let promise = JSPromise::create(global).to_js();
        let copy = expect.private_copy(global, frame.this());
        js::expect_set_cached(thrown, global, copy);
        js::call_set_cached(
            thrown,
            global,
            frame.callee().bind(
                global,
                copy,
                &frame.callee().get_name(global)?,
                0.0,
                frame.arguments(),
            )?,
        );
        js::promise_set_cached(thrown, global, promise);
        js::call_site_set_cached(thrown, global, ExpectDeferred__captureCallSite(global));
        ExpectDeferred__callWhenSettled(global, awaited, when_settled, thrown);
        if let Some(this) = Self::from_js(thrown) {
            // SAFETY: `thrown` is on the stack and owns the payload.
            unsafe { &*this }
                .held
                .set(RunningEntry::of(expect).map(|entry| entry.hold(global, thrown)));
        }
        Ok(promise)
    }

    fn run_again(global: &JSGlobalObject, deferred: JSValue) -> JsResult<()> {
        let (Some(this), Some(call), Some(promise)) = (
            Self::from_js(deferred),
            js::call_get_cached(deferred),
            js::promise_get_cached(deferred),
        ) else {
            return Ok(());
        };
        // SAFETY: `deferred` is an argument of the running call, and owns `this`.
        let this = unsafe { &*this };
        if this.is_abandoned.get() {
            return Ok(());
        }
        if let Some(held) = this.held.get() {
            if !held.is_running() {
                let buntest = held.buntest.upgrade();
                return this.abandon(global, deferred, buntest.as_ref());
            }
            // The runner is about to time the entry out, and `settle_ended` will then abandon this call.
            if held.has_timed_out() {
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
        buntest: &BunTestPtr,
        global: &JSGlobalObject,
        group_index: Option<usize>,
        message: core::fmt::Arguments<'_>,
    ) {
        let mut index = 0;
        while let Some(call) = buntest.get().unclaimed.calls.get(index) {
            index += 1;
            let Some(deferred) = call.as_ref().map(Strong::get) else {
                continue;
            };
            let Some(this) = Self::from_js(deferred) else {
                continue;
            };
            // SAFETY: `unclaimed` keeps the wrapper, which owns the payload, alive.
            let held_by = unsafe { &*this }.held.get().as_ref().map(|held| held.entry);
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
                .is_some_and(|promise| ExpectDeferred__isHandled(promise));
            // SAFETY: as above; `deferred` is on the stack.
            crate::dispatch::fold(unsafe { &*this }.abandon(global, deferred, Some(buntest)));
            if is_handled {
                continue;
            }
            let error = global.create_error_instance(message);
            if let Some(call_site) = js::call_site_get_cached(deferred) {
                ExpectDeferred__continueStackAt(global, error, call_site);
            }
            buntest
                .get()
                .on_uncaught_exception(global, Some(error), false, &RefDataValue::Start);
        }
    }

    /// Rejects the promise without re-running the matcher, so awaiters still unwind through their `finally` blocks.
    fn abandon(
        &self,
        global: &JSGlobalObject,
        deferred: JSValue,
        buntest: Option<&BunTestPtr>,
    ) -> JsResult<()> {
        self.is_abandoned.set(true);
        let held = self.held.take();
        let Some(buntest) = buntest else {
            return Ok(());
        };
        if let Some(index) = held.and_then(|held| held.unclaimed) {
            buntest.get().unclaimed.remove(index);
        }
        let Some(promise) = js::promise_get_cached(deferred).and_then(JSValue::as_promise) else {
            return Ok(());
        };
        let error = buntest.get().unclaimed.ended_error(global);
        JSPromise::opaque_mut(promise).reject_as_handled(global, error)
    }

    pub(crate) fn settle_ended(buntest: &BunTestPtr, global: &JSGlobalObject) -> JsResult<()> {
        let mut index = 0;
        while let Some(call) = buntest.get().unclaimed.calls.get(index) {
            index += 1;
            let Some(deferred) = call.as_ref().map(Strong::get) else {
                continue;
            };
            let Some(this) = Self::from_js(deferred) else {
                continue;
            };
            // SAFETY: `unclaimed` keeps the wrapper, which owns the payload, alive; then `deferred`, on the stack, does.
            let this = unsafe { &*this };
            if this.held.get().as_ref().is_none_or(RunningEntry::is_running) {
                continue;
            }
            this.abandon(global, deferred, Some(buntest))?;
        }
        Ok(())
    }

    pub(crate) fn group_timed_out(
        buntest: &BunTestPtr,
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
        buntest: &BunTestPtr,
        global: &JSGlobalObject,
        now: &Timespec,
    ) -> StepResult {
        let this = buntest.get();
        if this.unclaimed.of_file == 0 {
            return StepResult::Complete;
        }
        let timeout_ms = this.reporter.map_or(0, |reporter| {
            // SAFETY: the reporter outlives every BunTest.
            let runner = &unsafe { reporter.as_ref() }.jest;
            match runner.default_timeout_override {
                u32::MAX => runner.default_timeout_ms,
                timeout_ms => timeout_ms,
            }
        });
        let deadline = *this.unclaimed.deadline.get_or_insert_with(|| match timeout_ms {
            0 => Timespec::EPOCH,
            timeout_ms => now.add_ms(i64::from(timeout_ms)),
        });
        if deadline.eql(&Timespec::EPOCH) || deadline.order(now).is_gt() {
            return StepResult::Waiting { timeout: deadline };
        }
        this.unclaimed.of_file = 0;
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

#[bun_jsc::host_fn]
fn on_settled(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    ExpectDeferred::run_again(global, frame.argument(1))?;
    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn]
#[optimize(size)]
fn poll_once(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [function, check] = frame.arguments_as_array::<2>();
    let value = function.call(global, JSValue::UNDEFINED, &[])?;
    match Expect::promise_to_await(global, value)? {
        Some(promise) => Ok(ExpectDeferred__then(global, promise.as_value(), check)),
        None => check.call(global, JSValue::UNDEFINED, &[value]),
    }
}

#[bun_jsc::host_fn]
#[optimize(size)]
fn check_polled(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [expect, call, value] = frame.arguments_as_array::<3>();
    expect_js::captured_value_set_cached(expect, global, value);
    call.call(global, JSValue::UNDEFINED, &[])
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
    /// Every matcher runs through here. Built-ins get here via `protoFnCaller` in jest.classes.ts.
    #[inline]
    pub(crate) fn call_matcher(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        matcher: Matcher,
    ) -> JsResult<JSValue> {
        self.matcher_ran.set(true);
        if !self.flags.get().is_plain() {
            return self.call_modified_matcher(global, frame, matcher);
        }
        let pass = Pass::of_matcher();
        let _entered = pass.enter();
        match matcher(self, global, frame) {
            Ok(value) => Ok(value),
            Err(error) => self.matcher_failed(global, frame, error),
        }
    }

    #[cold]
    fn matcher_failed(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        error: JsError,
    ) -> JsResult<JSValue> {
        match error {
            JsError::Thrown => self.matcher_threw(global, frame),
            error => Err(error),
        }
    }

    #[cold]
    fn call_modified_matcher(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        matcher: Matcher,
    ) -> JsResult<JSValue> {
        let pass = Pass::of_matcher();
        let _entered = pass.enter();
        let flags = self.flags.get();
        let result = if flags.promise() != Promise::None {
            self.call_matcher_on_promise(global, frame, matcher)
        } else {
            let result = if flags.poll() {
                self.poll_matcher(global, frame)
            } else {
                matcher(self, global, frame)
            };
            match result {
                Err(JsError::Thrown) => self.matcher_threw(global, frame),
                result => result,
            }
        };
        match result {
            Err(JsError::Thrown) if flags.soft() => self.fail_softly(global, &pass),
            result => result,
        }
    }

    /// For `expect.soft()`. Fails the test with the thrown error but lets it continue. Stays thrown if the test isn't known.
    fn fail_softly(&self, global: &JSGlobalObject, pass: &Pass) -> JsResult<JSValue> {
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
        // SAFETY: points into `buntest.execution.sequences`; read and written between the calls that may borrow it.
        let maybe_skip = unsafe { sequence.as_ref() }.maybe_skip;
        buntest
            .get()
            .on_uncaught_exception(global, Some(error), false, &test.entry);
        // SAFETY: as above.
        unsafe { (*sequence.as_ptr()).maybe_skip = maybe_skip };
        Ok(match self.flags.get().promise() {
            Promise::None => JSValue::UNDEFINED,
            _ => JSPromise::resolved_promise_value(global, JSValue::UNDEFINED),
        })
    }

    #[optimize(size)]
    fn poll_matcher(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        self.increment_expect_call_counter();
        let question = Question {
            asked: Asked::Poll,
            who: JSValue::UNDEFINED,
            what: JSValue::UNDEFINED,
        };
        let polling = Pass::once(global, question, &mut || self.start_polling(global, frame))?;
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

    fn start_polling(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let name = frame.callee().get_name(global)?;
        if NOT_POLLED
            .iter()
            .any(|not_polled| name.eq_ascii(not_polled))
        {
            return Err(global.throw(format_args!(
                "expect.poll() does not support .{name}(). Use vi.waitFor() instead"
            )));
        }
        let function =
            expect_js::captured_value_get_cached(frame.this()).unwrap_or(JSValue::UNDEFINED);
        let times = expect_js::result_value_get_cached(frame.this()).unwrap_or(JSValue::UNDEFINED);
        let [interval_ms, timeout_ms] = [times.get_index(global, 0)?, times.get_index(global, 1)?];

        // `parent: None` keeps the attempts out of the assertion count. Only the call in `frame` counts.
        let expect = Expect {
            flags: Cell::new(Flags(self.flags.get().0 & Flags::NOT_MASK)),
            matcher_ran: Cell::new(false),
            parent: None,
            custom_label: self.custom_label.clone(),
        }
        .to_js(global);
        let bind = |function: JSValue, this_value: JSValue, arguments: &[JSValue]| {
            function.bind(global, this_value, &bun_core::String::EMPTY, 0.0, arguments)
        };
        let call = bind(frame.callee(), expect, frame.arguments())?;
        let check = bind(
            private_function(global, __jsc_host_check_polled),
            JSValue::UNDEFINED,
            &[expect, call],
        )?;
        let attempt = bind(
            private_function(global, __jsc_host_poll_once),
            JSValue::UNDEFINED,
            &[function, check],
        )?;
        ViWait::poll_matcher(
            global,
            frame,
            attempt,
            interval_ms.to_int32() as u32,
            timeout_ms.to_int32() as u32,
            RunningEntry::of(self),
        )
    }

    fn call_matcher_on_promise(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        matcher: Matcher,
    ) -> JsResult<JSValue> {
        let this_value = frame.this();
        let first_call = expect_js::result_value_get_cached(this_value).is_none();
        if first_call {
            let received =
                expect_js::captured_value_get_cached(this_value).unwrap_or(JSValue::UNDEFINED);
            let promise = Self::received_promise(global, received)?;
            expect_js::result_value_set_cached(
                this_value,
                global,
                promise.map_or(JSValue::NULL, AnyPromise::as_value),
            );
            // bun:test checks a settled promise right away and throws, as it always has. Vitest always returns a promise.
            let always_defer = self.is_vitest();
            if let Some(promise) =
                promise.filter(|promise| always_defer || promise.status() == Status::Pending)
            {
                let deferred = ExpectDeferred::waiting(global);
                js::awaited_set_cached(deferred, global, promise.as_value());
                let deferred = ExpectDeferred::defer(deferred, self, global, frame);
                expect_js::result_value_set_cached(this_value, global, JSValue::ZERO);
                return deferred;
            }
        }
        let result = match matcher(self, global, frame) {
            Ok(_) => Ok(JSPromise::resolved_promise_value(
                global,
                JSValue::UNDEFINED,
            )),
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
        // The replay counts this call again.
        self.add_to_expect_call_counter(-1);
        ExpectDeferred::defer(thrown, self, global, frame)
    }

    /// The deferred matcher's own Expect, so later chaining can't change its flags.
    fn private_copy(&self, global: &JSGlobalObject, this_value: JSValue) -> JSValue {
        let copy = Expect {
            flags: Cell::new(self.flags.get()),
            matcher_ran: Cell::new(false),
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
