//! A matcher that needs a pending promise returns a promise of its own, and is called again once the former has settled.
//! That call is a replay: what the body of the matcher asked user code for the first time, it is given again.

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

/// Who waits for a matcher call: the callback of a test or of a hook, for as long as the runner waits for it; of
/// concurrent tests, when it is not known which, their group; outside of them, the test file.
pub(crate) struct RunningEntry {
    buntest: BunTestPtrWeak,
    /// `Execution`, without an entry for a group. Anything else: the file.
    entry: RefDataValue,
    /// Where `Unclaimed::calls` has the call, which a group or the file waits for.
    unclaimed: Option<usize>,
}

/// The matcher calls of a test file that wait for a promise and that no test or hook is known to have made.
#[derive(Default)]
pub(crate) struct Unclaimed {
    /// `ExpectDeferred` cells. `None`: it no longer waits.
    calls: Vec<Option<Strong>>,
    /// How many of them the file waits for.
    of_file: u32,
    /// When the file, whose tests have run, stops waiting. `EPOCH`: never.
    deadline: Option<Timespec>,
}

impl Unclaimed {
    fn add(&mut self, global: &JSGlobalObject, deferred: JSValue) -> usize {
        self.calls.push(Some(Strong::create(deferred, global)));
        self.calls.len() - 1
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
    /// The one that waits for the matchers of `expect`. `None` outside of `bun test`, and once the test file has ended.
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

    /// `None` once the entry has ended.
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

    /// Its count of the matchers it waits for. `None` once it has ended.
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

    /// Whether the time limit of the entry has passed, which the runner only sees once no microtask is left.
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

    /// It does not end before `release()`, or before it has waited for `deferred` as long as it can.
    fn hold(mut self, global: &JSGlobalObject, deferred: JSValue) -> Self {
        let Some(buntest) = self.buntest.upgrade() else {
            return self;
        };
        if let Some(pending_matchers) = self.pending_matchers(&buntest) {
            // SAFETY: as in `pending_matchers`.
            unsafe { *pending_matchers.as_ptr() += 1 };
            if self.sequence(&buntest).is_none() {
                self.unclaimed = Some(buntest.get().unclaimed.add(global, deferred));
            }
        }
        self
    }

    /// `failure`: what the matcher threw, when nothing else reports it.
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
                // Taken: the entry ends once, however many of its matchers run before the runner's next step.
                ((none_left || sequence.maybe_skip)
                    && core::mem::take(&mut sequence.callback_done))
                .then_some(self.entry)
            }
            // While the file is collected, nothing waits yet.
            None => (none_left && buntest.phase == Phase::Execution).then_some(RefDataValue::Start),
        };
        if let Some(next) = next {
            buntest.get().add_result(next);
            BunTest::run_next_tick(&self.buntest, global, next);
        }
    }
}

/// What the body of a matcher asks user code for.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Asked {
    /// What a custom matcher returns.
    Matcher,
    /// The promise that settles as a value of `expect.resolvesTo` / `expect.rejectsTo` does.
    Promise,
    /// What the function of `toThrow()` returns or throws.
    Call,
    /// The items of an iterable.
    Items,
    /// The promise of `expect.poll()`.
    Poll,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Role {
    /// Of the call that runs the body of a matcher.
    Matcher,
    /// Around the call that runs a matcher again.
    Replaying,
    /// Of a function that returns to user code what it finds, so that it cannot wait for a promise.
    Barrier,
}

/// One run of the body of a matcher. It lives on the stack of the call that runs the body, where the collector sees its values.
pub(crate) struct Pass {
    outer: Cell<*const Pass>,
    role: Role,
    /// How many answers the body has come by.
    cursor: Cell<u32>,
    /// Four bits for each of `recent`: `Asked`, and whether it was thrown.
    recent_kinds: Cell<u32>,
    /// `Role::Matcher`: an array of the answers so far, two elements each: as in `recent_kinds`, and the value. Empty
    /// until the matcher has to wait or `recent` is full: most matchers never wait. `Role::Replaying`: the `ExpectDeferred`.
    journal: Cell<JSValue>,
    /// The answers so far, while there is no `journal`.
    recent: [Cell<JSValue>; Pass::RECENT],
}

/// Until it is dropped, its `Pass` is the one that [`Pass::once`] records for.
pub(crate) struct EnteredPass<'a>(&'a Pass);

impl Drop for EnteredPass<'_> {
    #[inline]
    fn drop(&mut self) {
        Pass::innermost().set(self.0.outer.get());
    }
}

impl Pass {
    const RECENT: usize = 4;

    #[inline]
    fn new(role: Role, journal: JSValue) -> Pass {
        Pass {
            outer: Cell::new(core::ptr::null()),
            role,
            cursor: Cell::new(0),
            recent_kinds: Cell::new(0),
            journal: Cell::new(journal),
            recent: [const { Cell::new(JSValue::ZERO) }; Self::RECENT],
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
        // SAFETY: a thread that runs script has its `RuntimeState`, which outlives the script.
        unsafe { &(*crate::jsc_hooks::runtime_state()).matcher_pass }
    }

    #[inline]
    pub(crate) fn enter(&self) -> EnteredPass<'_> {
        self.outer.set(Self::innermost().replace(self));
        EnteredPass(self)
    }

    /// The pass of the matcher whose body is running. `None`: what is running cannot wait.
    #[inline]
    fn current<'a>() -> Option<&'a Pass> {
        // SAFETY: an `EnteredPass` borrows what `innermost()` points to, on a frame below this one.
        unsafe { Self::innermost().get().as_ref() }.filter(|pass| pass.role == Role::Matcher)
    }

    /// The `ExpectDeferred` whose matcher this pass runs again.
    #[inline]
    fn replayed(&self) -> Option<JSValue> {
        // SAFETY: as in `current`.
        unsafe { self.outer.get().as_ref() }
            .filter(|outer| outer.role == Role::Replaying)
            .map(|outer| outer.journal.get())
    }

    /// What `ask()`, which runs user code, returns or throws. It is called once per call of a matcher, however often
    /// the body of the matcher runs.
    #[inline(never)]
    pub(crate) fn once(
        global: &JSGlobalObject,
        asked: Asked,
        ask: &mut dyn FnMut() -> JsResult<JSValue>,
    ) -> JsResult<JSValue> {
        Self::once_inline(global, asked, ask)
    }

    /// `once()`, for where it counts: a custom matcher.
    #[inline(always)]
    pub(crate) fn once_inline(
        global: &JSGlobalObject,
        asked: Asked,
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
        let Some(recent) = pass.recent.get(at as usize).filter(|_| pass.journal.get().is_empty())
        else {
            return pass.once_in_journal(global, at, asked, &mut ask);
        };
        let answer = ask();
        let (threw, value) = Self::returned_or_thrown(global, answer)?;
        recent.set(value);
        pass.recent_kinds
            .set(pass.recent_kinds.get() | ((asked as u32) << 1 | u32::from(threw)) << (at * 4));
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

    /// `journal`, which `recorded` of `recent` go into if it does not exist yet.
    #[cold]
    fn journal(&self, global: &JSGlobalObject, recorded: u32) -> JsResult<JSValue> {
        if self.journal.get().is_empty() {
            let journal = JSValue::create_empty_array(global, 0)?;
            for (index, recent) in (0..recorded).zip(&self.recent) {
                let kind = (self.recent_kinds.get() >> (index * 4)) & 0xF;
                journal.put_index(global, index * 2, JSValue::js_number_from_int32(kind as i32))?;
                journal.put_index(global, index * 2 + 1, recent.get())?;
            }
            self.journal.set(journal);
        }
        Ok(self.journal.get())
    }

    /// `once()` of a matcher that runs again, or that has asked for more than `recent` holds.
    #[cold]
    #[inline(never)]
    fn once_in_journal(
        &self,
        global: &JSGlobalObject,
        at: u32,
        asked: Asked,
        ask: &mut dyn FnMut() -> JsResult<JSValue>,
    ) -> JsResult<JSValue> {
        let journal = self.journal(global, at)?;
        if u64::from(at * 2) < journal.get_length(global)? {
            let kind = journal.get_index(global, at * 2)?.to_int32();
            let value = journal.get_index(global, at * 2 + 1)?;
            if kind >> 1 != asked as i32 {
                return Err(global.throw(format_args!(
                    "A matcher ran again once the promise it waited for had settled, and took another path: what it compares has changed in the meantime"
                )));
            }
            return Self::return_or_throw(global, kind & 1 != 0, value);
        }
        let answer = ask();
        let (threw, value) = Self::returned_or_thrown(global, answer)?;
        let kind = (asked as i32) << 1 | i32::from(threw);
        journal.put_index(global, at * 2, JSValue::js_number_from_int32(kind))?;
        journal.put_index(global, at * 2 + 1, value)?;
        Self::return_or_throw(global, threw, value)
    }

    /// `once()`, of a promise: it has settled when it is returned. `None`: `ask()` returned something else.
    pub(crate) fn settled(
        global: &JSGlobalObject,
        asked: Asked,
        ask: &mut dyn FnMut() -> JsResult<JSValue>,
    ) -> JsResult<Option<AnyPromise>> {
        let Some(promise) = Self::once(global, asked, ask)?.as_any_promise() else {
            return Ok(None);
        };
        if promise.status() == Status::Pending {
            return Err(Self::wait_for(global, promise));
        }
        Ok(Some(promise))
    }

    /// Makes the matcher whose body is running return a promise, and run again once `promise`, which `once()` returned,
    /// has settled.
    #[cold]
    pub(crate) fn wait_for(global: &JSGlobalObject, promise: AnyPromise) -> JsError {
        let Some(pass) = Self::current() else {
            return global.throw(format_args!(
                "An asynchronous matcher can only be waited for by a matcher of expect(), which then returns a promise: await expect(received).toEqual(expected)"
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

/// A matcher call that waits for a promise. Thrown, by [`Pass::wait_for`], to the call it will stand for.
#[bun_jsc::JsClass(no_construct, no_constructor)]
pub(crate) struct ExpectDeferred {
    held: JsCell<Option<RunningEntry>>,
    /// How often the matcher has run again.
    replays: Cell<u32>,
}

pub(crate) mod js {
    bun_jsc::codegen_cached_accessors!("ExpectDeferred"; expect, call, promise, callSite, awaited, journal);
}

impl ExpectDeferred {
    /// Each replay waits for one more promise than the one before.
    const MAX_REPLAYS: u32 = 2_000;

    fn waiting(global: &JSGlobalObject) -> JSValue {
        ExpectDeferred {
            held: JsCell::new(None),
            replays: Cell::new(0),
        }
        .to_js(global)
    }

    /// A cell that keeps the code of the stack frames of here and now alive. An Error does not: a collection turns its stack into text.
    pub(crate) fn capture_call_site(global: &JSGlobalObject) -> JSValue {
        ExpectDeferred__captureCallSite(global)
    }

    /// Where the matcher in `frame`, which is running again, was called from.
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

    /// Takes over the call in `frame`, which met the pending promise that `thrown` waits for. Returns the promise of that call.
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
        // What waited for the matcher has ended, or is about to.
        if this
            .held
            .get()
            .as_ref()
            .is_some_and(|held| !held.is_running() || held.has_timed_out())
        {
            return Ok(());
        }

        this.replays.set(this.replays.get() + 1);
        let result = if this.replays.get() > Self::MAX_REPLAYS {
            Err(global.throw(format_args!(
                "{}() has waited for {} promises, one after the other, and met one more",
                call.get_name(global)?,
                Self::MAX_REPLAYS,
            )))
        } else {
            let pass = Pass::replaying(deferred);
            let _entered = pass.enter();
            call.call(global, JSValue::UNDEFINED, &[])
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

    /// `holder`, a group of concurrent tests or the file, has waited for as long as it can: the calls that it still
    /// waits for and that nothing else does are errors.
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
                        ..
                    }),
                    group_index,
                ) => group_index == Some(held_by),
                (Some(_), group_index) => group_index.is_none(),
                (None, _) => false,
            };
            if !is_held {
                continue;
            }
            buntest.get().unclaimed.remove(index - 1);
            if js::promise_get_cached(deferred).is_some_and(|promise| ExpectDeferred__isHandled(promise)) {
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

    /// The tests of a group of concurrent tests have ended, the last one that could at its time limit.
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
                "A matcher that a concurrent test did not await timed out: its promise has not settled"
            ),
        );
    }

    /// The tests of a file have run: it ends once the matcher calls that it waits for have run, too.
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
                "A matcher that was called outside of a test and not awaited timed out {timeout_ms}ms after the tests of its file: its promise has not settled"
            ),
        );
        StepResult::Complete
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

    /// `expect.soft()`: what the matcher threw fails the test, which goes on. It stays thrown when no test is known to have called the matcher.
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

    /// `expect.poll()`: the matcher in `frame` is called on what the function returns, time and again, until it passes.
    fn poll_matcher(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        self.increment_expect_call_counter();
        let polling = Pass::once(global, Asked::Poll, &mut || self.start_polling(global, frame))?;
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
                "expect.poll() does not support .{name}(). Use vi.waitFor() for a condition that takes time to hold"
            )));
        }
        let function =
            expect_js::captured_value_get_cached(frame.this()).unwrap_or(JSValue::UNDEFINED);
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
            let received =
                expect_js::captured_value_get_cached(this_value).unwrap_or(JSValue::UNDEFINED);
            let promise = Self::received_promise(global, received)?;
            expect_js::result_value_set_cached(
                this_value,
                global,
                promise.map_or(JSValue::NULL, AnyPromise::as_value),
            );
            if let Some(promise) = promise.filter(|promise| promise.status() == Status::Pending) {
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
