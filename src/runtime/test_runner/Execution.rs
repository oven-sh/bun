//! Example:
//!
//! ```text
//! Execution[
//!   ConcurrentGroup[
//!     ExecutionSequence[
//!       beforeAll
//!     ]
//!   ],
//!   ConcurrentGroup[ <- group_index (currently running)
//!     ExecutionSequence[
//!       beforeEach,
//!       test.concurrent, <- entry_index (currently running)
//!       afterEach,
//!     ],
//!     ExecutionSequence[
//!       beforeEach,
//!       test.concurrent,
//!       afterEach,
//!       --- <- entry_index (done)
//!     ],
//!   ],
//!   ConcurrentGroup[
//!     ExecutionSequence[
//!       beforeEach,
//!       test,
//!       afterEach,
//!     ],
//!   ],
//!   ConcurrentGroup[
//!     ExecutionSequence[
//!       afterAll
//!     ]
//!   ],
//! ]
//! ```

use core::cell::{Cell, OnceCell};

use bun_core::{Timespec, TimespecMockMode};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, Strong, StrongCell};
// `bun_jsc::VirtualMachine` is the *module* re-export; the struct lives one level deeper.
use bun_jsc::virtual_machine::VirtualMachine;
use bun_core::scoped_log;
use bun_ptr::CellExt as _;

use super::debug::group as group_log; // bun_test.debug.group
use super::bun_test::{
    group_begin, AddedInPhase, Around, AroundPhase, BunTest, BunTestPtr, Calling, EntryData, ExecutionEntry,
    ExecutionEntryCfg, HandleUncaughtExceptionResult, Order, RefDataValue, ScopeMode, SequenceEntry, SequenceEntryId,
    StepResult,
};
use super::expect::expect_deferred::ExpectDeferred;
use super::test_context::{self, Deferred, TestContext};
use super::test_context_around::{self, AroundHook};
use super::test_context_fixtures::{Next as NextFixture, TestFixtures};
use super::test_context_parameter::ContextParameter;
use crate::cli::test_command;

// ── local shims for upstream Timespec methods not yet ported ───────────────
// bun_core exposes only the generic `now(mode)` form; wrap the convenience
// names here.
pub(crate) trait TimespecExt {
    fn now_force_real_time() -> Timespec;
    fn ms_from_now_force_real_time(interval: i64) -> Timespec;
    fn since_now_force_real_time(&self) -> u64;
}
impl TimespecExt for Timespec {
    #[inline]
    fn now_force_real_time() -> Timespec {
        Timespec::now(TimespecMockMode::ForceRealTime)
    }
    #[inline]
    fn ms_from_now_force_real_time(interval: i64) -> Timespec {
        Timespec::ms_from_now(TimespecMockMode::ForceRealTime, interval)
    }
    #[inline]
    fn since_now_force_real_time(&self) -> u64 {
        self.since_now(TimespecMockMode::ForceRealTime)
    }
}

bun_core::declare_scope!(jest, visible);

pub(crate) struct Execution {
    order: OnceCell<LoadedOrder>,
    pub(crate) group_index: Cell<usize>,
    /// The entry whose callback is on the stack, which `get_current_state_data()` can't name in a concurrent group.
    /// Cleared before the call's microtasks drain, because those can resume other tests in the group.
    pub(crate) on_stack: Cell<Option<EntryData>>,
}

struct LoadedOrder {
    groups: Box<[ConcurrentGroup]>,
    sequences: Box<[ExecutionSequence]>,
}

pub(crate) struct ConcurrentGroup {
    pub(crate) sequence_start: usize,
    pub(crate) sequence_end: usize,
    /// Index of the next sequence that has not been started yet
    next_sequence_index: Cell<usize>,
    executing: Cell<bool>,
    remaining_incomplete_entries: Cell<usize>,
    /// used by beforeAll to skip directly to afterAll if it fails
    pub(crate) failure_skip_to: usize,
    /// Like `ExecutionSequence::pending_matchers`, for matchers whose calling sequence isn't known.
    pub(crate) pending_matchers: Cell<u32>,
}

impl ConcurrentGroup {
    pub(crate) fn init(sequence_start: usize, sequence_end: usize, next_index: usize) -> ConcurrentGroup {
        ConcurrentGroup {
            sequence_start,
            sequence_end,
            executing: Cell::new(false),
            remaining_incomplete_entries: Cell::new(sequence_end - sequence_start),
            failure_skip_to: next_index,
            next_sequence_index: Cell::new(0),
            pending_matchers: Cell::new(0),
        }
    }

    pub(crate) fn try_extend(&mut self, next_sequence_start: usize, next_sequence_end: usize) -> bool {
        if self.sequence_end != next_sequence_start {
            return false;
        }
        self.sequence_end = next_sequence_end;
        self.remaining_incomplete_entries.set(self.sequence_end - self.sequence_start);
        true
    }

    pub(crate) fn sequences<'a>(&self, execution: &'a Execution) -> &'a [ExecutionSequence] {
        &execution.sequences()[self.sequence_start..self.sequence_end]
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExpectAssertions {
    NotSet,
    AtLeastOne,
    Exact(u32),
}

pub(crate) struct ExecutionSequence {
    pub(crate) first_entry: Option<SequenceEntryId>,
    /// The entry that is not started or currently running
    pub(crate) active_entry: Cell<Option<SequenceEntryId>>,
    pub(crate) test_entry: Option<SequenceEntryId>,
    pub(crate) remaining_repeat_count: Cell<u32>,
    pub(crate) remaining_retry_count: Cell<u32>,
    pub(crate) attempt: Cell<u32>,
    pub(crate) result: Cell<Result>,
    executing: Cell<bool>,
    started_at: Cell<Timespec>,
    /// Number of expect() calls observed in this sequence.
    pub(crate) expect_call_count: Cell<u32>,
    /// Expectation set by expect.hasAssertions() or expect.assertions(n).
    pub(crate) expect_assertions: Cell<ExpectAssertions>,
    pub(crate) maybe_skip: Cell<bool>,
    pub(crate) context: StrongCell,
    deferred: Cell<Vec<(Deferred, SequenceEntryId)>>,
    /// Matchers the active entry called that still wait on a promise. The entry can't end until they've run.
    pub(crate) pending_matchers: Cell<u32>,
    /// The active entry's callback is done, and only `pending_matchers` keeps the entry open.
    pub(crate) callback_done: Cell<bool>,
    /// Names `Snapshots::add_count` counted during this attempt, for `reset_sequence` to undo.
    pub(crate) counted_snapshots: Cell<Vec<Box<[u8]>>>,
    /// Errors thrown during this attempt, for the JUnit report.
    pub(crate) failure: Cell<Option<test_command::TestFailure>>,
    /// Failures from earlier attempts, for the JUnit report.
    pub(crate) earlier_failures: Cell<Vec<test_command::TestFailure>>,
}

impl ExecutionSequence {
    pub(crate) fn init(
        first_entry: Option<SequenceEntryId>,
        test_entry: Option<SequenceEntryId>,
        retry_count: u32,
        repeat_count: u32,
    ) -> ExecutionSequence {
        ExecutionSequence {
            first_entry,
            active_entry: Cell::new(first_entry),
            test_entry,
            remaining_repeat_count: Cell::new(repeat_count),
            remaining_retry_count: Cell::new(retry_count),
            // defaults:
            attempt: Cell::new(0),
            result: Cell::new(Result::Pending),
            executing: Cell::new(false),
            started_at: Cell::new(Timespec::EPOCH),
            expect_call_count: Cell::new(0),
            expect_assertions: Cell::new(ExpectAssertions::NotSet),
            maybe_skip: Cell::new(false),
            context: StrongCell::default(),
            deferred: Cell::default(),
            pending_matchers: Cell::new(0),
            callback_done: Cell::new(false),
            counted_snapshots: Cell::default(),
            failure: Cell::new(None),
            earlier_failures: Cell::default(),
        }
    }

    pub(crate) fn test<'a>(&self, buntest: &'a BunTest) -> Option<&'a ExecutionEntry> {
        Some(buntest.entry_of(self.test_entry?))
    }

    pub(crate) fn set_result_if_pending(&self, result: Result) {
        if self.result.get() == Result::Pending {
            self.result.set(result);
        }
    }

    /// Call once the active entry's callback is done. An entry that already errored doesn't wait.
    fn waits_for_matchers(&self) -> bool {
        self.callback_done.set(self.pending_matchers.get() > 0 && !self.maybe_skip.get());
        self.callback_done.get()
    }

    fn entry_mode(&self, buntest: &BunTest) -> ScopeMode {
        self.test(buntest).map_or(ScopeMode::Normal, |entry| entry.base.mode)
    }

    pub(crate) fn context(
        &self,
        global: &JSGlobalObject,
        buntest: &BunTestPtr,
        group_index: usize,
        sequence_index: usize,
    ) -> JSValue {
        if let Some(context) = self.context.get() {
            return context;
        }
        let context = TestContext::create(global, buntest, group_index, sequence_index);
        self.context.set(Strong::create(context, global));
        if let Some(fixtures) = self.test(buntest).and_then(|test| test.fixtures.as_ref()) {
            test_context::js::fixtures_set_cached(context, global, fixtures.get());
        }
        context
    }

    fn has_vitest_entry(&self, buntest: &BunTest) -> bool {
        buntest
            .sequence_entries_from(self.first_entry)
            .any(|(_, sequence_entry)| buntest.entry(sequence_entry.entry).calling.is_vitest())
    }

    fn test_is_at_or_after(&self, buntest: &BunTest, first: Option<SequenceEntryId>) -> bool {
        buntest.sequence_entries_from(first).any(|(id, _)| Some(id) == self.test_entry)
    }

    pub(crate) fn test_follows(&self, buntest: &BunTest, entry: SequenceEntryId) -> bool {
        self.test_is_at_or_after(buntest, buntest.sequence_entry(entry).next.get())
    }

    /// Whether an `aroundEach` hook has yet to start. The active entry may be setting up a fixture for it.
    pub(crate) fn is_before_run_test(&self, buntest: &BunTest) -> bool {
        buntest
            .sequence_entries_from(self.active_entry.get())
            .any(|(_, sequence_entry)| buntest.entry(sequence_entry.entry).around == Some((Around::Each, AroundPhase::SetUp)))
    }

    /// For `test.failing`, `Result::Pass` means the callback threw, which is a failed attempt here.
    fn attempt_failed(&self, buntest: &BunTest) -> bool {
        match self.entry_mode(buntest) {
            ScopeMode::Failing => self.result.get() == Result::Pass,
            _ => self.result.get().is_fail(),
        }
    }

    /// Vitest's `task.result.state`
    pub(crate) fn state(&self, buntest: &BunTest) -> &'static str {
        if self.result.get() == Result::Skip {
            "skip"
        } else if self.attempt_failed(buntest) {
            "fail"
        } else if self.test_is_at_or_after(buntest, self.active_entry.get()) {
            "run"
        } else {
            "pass"
        }
    }

    pub(crate) fn defer(&self, buntest: &BunTest, when: Deferred, callback: JSValue, timeout: u32) {
        let cfg = ExecutionEntryCfg {
            timeout,
            calling: Calling::Vitest { context: matches!(when, Deferred::OnTestFinished | Deferred::OnTestFailed) },
            around: (when == Deferred::Around).then_some((Around::Each, AroundPhase::TearDown)),
            ..Default::default()
        };
        let entry = buntest.create_sequence_entry(Some(callback), cfg, AddedInPhase::Execution);
        self.deferred.with_taken(|deferred| deferred.push((when, entry)));
    }

    fn take_deferred(&self, buntest: &BunTest) -> Option<SequenceEntryId> {
        self.deferred.with_taken(|deferred| {
            loop {
                let next = (0..deferred.len()).rev().min_by_key(|&index| deferred[index].0)?;
                let (when, entry) = deferred.remove(next);
                if when != Deferred::OnTestFailed || self.attempt_failed(buntest) {
                    return Some(entry);
                }
                buntest.entry_of(entry).callback.clear();
            }
        })
    }

    /// Vitest's `test.fails` passes if anything in the attempt failed, hooks, fixtures and timeouts included.
    fn flip_fails(&self, buntest: &BunTest) {
        if self.entry_mode(buntest) != ScopeMode::Fails || self.result.get() == Result::Skip {
            return;
        }
        self.check_expect_assertions();
        self.expect_assertions.set(ExpectAssertions::NotSet);
        self.result.set(if self.result.get().is_fail() { Result::Pass } else { Result::FailBecauseFailsTestPassed });
    }

    fn check_expect_assertions(&self) {
        let failure = match self.expect_assertions.get() {
            ExpectAssertions::NotSet => return,
            ExpectAssertions::AtLeastOne if self.expect_call_count.get() == 0 => Result::FailBecauseExpectedHasAssertions,
            ExpectAssertions::Exact(expected) if self.expect_call_count.get() != expected => {
                Result::FailBecauseExpectedAssertionCount
            }
            ExpectAssertions::AtLeastOne | ExpectAssertions::Exact(_) => {
                self.expect_assertions.set(ExpectAssertions::NotSet);
                return;
            }
        };
        if self.result.get().is_pass(PendingIs::PendingIsPass) && self.result.get() != Result::Skip {
            self.result.set(failure);
        }
    }

    fn evaluate_timeout(&self, buntest: &BunTest, id: SequenceEntryId, now: &Timespec) -> bool {
        let sequence_entry = buntest.sequence_entry(id);
        let timespec = sequence_entry.timespec.get();
        if !timespec.eql(&Timespec::EPOCH) && timespec.order(now) == core::cmp::Ordering::Less {
            // timed out
            let entry = buntest.entry(sequence_entry.entry);
            let has_done_parameter = entry.calling == Calling::Jest { done: true };
            self.result.set(if entry.around.is_some() {
                // `report_around_timeout` fails the sequence with an error.
                self.result.get()
            } else if self.test_entry == Some(id) {
                if has_done_parameter {
                    Result::FailBecauseTimeoutWithDoneCallback
                } else {
                    Result::FailBecauseTimeout
                }
            } else if has_done_parameter {
                Result::FailBecauseHookTimeoutWithDoneCallback
            } else {
                Result::FailBecauseHookTimeout
            });
            self.maybe_skip.set(true);
            return true;
        }
        false
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Default, strum::IntoStaticStr, strum::FromRepr)]
#[repr(u8)]
pub enum Result {
    #[default]
    Pending,
    Pass,
    Skip,
    SkippedBecauseLabel,
    Todo,
    Fail,
    FailBecauseTimeout,
    FailBecauseTimeoutWithDoneCallback,
    FailBecauseHookTimeout,
    FailBecauseHookTimeoutWithDoneCallback,
    FailBecauseFailingTestPassed,
    FailBecauseFailsTestPassed,
    FailBecauseTodoPassed,
    FailBecauseExpectedHasAssertions,
    FailBecauseExpectedAssertionCount,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Basic {
    Pending,
    Pass,
    Fail,
    Skip,
    Todo,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum PendingIs {
    PendingIsPass,
    PendingIsFail,
}

impl Result {
    pub(crate) fn basic_result(self) -> Basic {
        match self {
            Result::Pending => Basic::Pending,
            Result::Pass => Basic::Pass,
            Result::Fail
            | Result::FailBecauseTimeout
            | Result::FailBecauseTimeoutWithDoneCallback
            | Result::FailBecauseHookTimeout
            | Result::FailBecauseHookTimeoutWithDoneCallback
            | Result::FailBecauseFailingTestPassed
            | Result::FailBecauseFailsTestPassed
            | Result::FailBecauseTodoPassed
            | Result::FailBecauseExpectedHasAssertions
            | Result::FailBecauseExpectedAssertionCount => Basic::Fail,
            Result::Skip | Result::SkippedBecauseLabel => Basic::Skip,
            Result::Todo => Basic::Todo,
        }
    }

    pub(crate) fn is_pass(self, pending_is: PendingIs) -> bool {
        match self.basic_result() {
            Basic::Pass | Basic::Skip | Basic::Todo => true,
            Basic::Fail => false,
            Basic::Pending => pending_is == PendingIs::PendingIsPass,
        }
    }

    pub(crate) fn is_fail(self) -> bool {
        !self.is_pass(PendingIs::PendingIsPass)
    }

    pub(crate) fn is_timeout(self) -> bool {
        matches!(
            self,
            Result::FailBecauseTimeout
                | Result::FailBecauseTimeoutWithDoneCallback
                | Result::FailBecauseHookTimeout
                | Result::FailBecauseHookTimeoutWithDoneCallback
        )
    }
}

impl Execution {
    pub(crate) fn init() -> Execution {
        Execution {
            order: OnceCell::new(),
            group_index: Cell::new(0),
            on_stack: Cell::new(None),
        }
    }

    pub(crate) fn load_from_order(&self, order: Order::Order<'_>) {
        let loaded = self.order.set(LoadedOrder {
            groups: order.groups.into_boxed_slice(),
            sequences: order.sequences.into_boxed_slice(),
        });
        debug_assert!(loaded.is_ok());
    }

    pub(crate) fn groups(&self) -> &[ConcurrentGroup] {
        self.order.get().map_or(&[], |order| &order.groups)
    }

    pub(crate) fn sequences(&self) -> &[ExecutionSequence] {
        self.order.get().map_or(&[], |order| &order.sequences)
    }

    /// The kill-only half of [`BunTest::handle_timeout`]: reaps a timed-out test's spawned processes without touching the runner's queue, so it may run from inside `spawnSync`'s isolated loop.
    pub(crate) fn kill_dangling_processes_on_timeout(buntest: &BunTest, global_this: &JSGlobalObject) {
        // if the concurrent group has one sequence and the sequence has an active entry that has timed out,
        //   kill any dangling processes
        // when using test.concurrent(), we can't do this because it could kill multiple tests at once.
        if let Some(current_group) = buntest.execution.active_group() {
            let sequences = current_group.sequences(&buntest.execution);
            if sequences.len() == 1 {
                let sequence = &sequences[0];
                if let Some(entry) = sequence.active_entry.get() {
                    let now = Timespec::now_force_real_time();
                    if buntest.sequence_entry(entry).timespec.get().order(&now) == core::cmp::Ordering::Less {
                        let kill_count = global_this.bun_vm().auto_killer.kill();
                        if kill_count.processes > 0 {
                            bun_core::pretty_errorln!(
                                "<d>killed {} dangling process{}<r>",
                                kill_count.processes,
                                if kill_count.processes != 1 { "es" } else { "" },
                            );
                            bun_core::Output::flush();
                        }
                    }
                }
            }
        }
    }

    pub(crate) fn step(
        buntest: &BunTestPtr,
        global_this: &JSGlobalObject,
        data: &RefDataValue,
    ) -> JsResult<StepResult> {
        let _g = group_begin!();
        let this = &buntest.execution;
        let mut now = Timespec::now_force_real_time();

        match data {
            RefDataValue::Start => {
                return step_group(buntest, global_this, &mut now);
            }
            _ => {
                // determine the active sequence,group
                // advance the sequence
                // step the sequence
                // if the group is complete, step the group

                let Some((sequence, group)) = this.get_current_and_valid_execution_sequence(data)
                else {
                    group_log::log(format_args!(
                        "runOneCompleted: the data is outdated, invalid, or did not know the sequence",
                    ));
                    return Ok(StepResult::Waiting { timeout: Timespec::EPOCH });
                };
                let sequence_index = match data {
                    RefDataValue::Execution { entry_data: Some(ed), .. } => ed.sequence_index,
                    // get_current_and_valid_execution_sequence returned Some ⇒ data is Execution with entry_data
                    _ => unreachable!(),
                };

                debug_assert!(sequence.active_entry.get().is_some());
                if sequence.waits_for_matchers() {
                    return Ok(StepResult::Waiting { timeout: Timespec::EPOCH });
                }
                Execution::advance_sequence(buntest, sequence, group);

                let sequence_result =
                    step_sequence(buntest, global_this, group, sequence_index, &mut now)?;
                match sequence_result {
                    AdvanceSequenceStatus::Done => {}
                    AdvanceSequenceStatus::Execute { timeout } => {
                        return Ok(StepResult::Waiting { timeout });
                    }
                }
                // this sequence is complete; execute the next sequence
                while let Some(next) = group.sequences(this).get(group.next_sequence_index.get()) {
                    if !next.executing.get()
                        && let AdvanceSequenceStatus::Execute { timeout } =
                            step_sequence(buntest, global_this, group, group.next_sequence_index.get(), &mut now)?
                    {
                        return Ok(StepResult::Waiting { timeout });
                    }
                    group.next_sequence_index.update(|index| index + 1);
                }
                // all sequences have started
                if group.remaining_incomplete_entries.get() == 0 {
                    return step_group(buntest, global_this, &mut now);
                }
                return Ok(StepResult::Waiting { timeout: Timespec::EPOCH });
            }
        }
    }

    pub(crate) fn active_group(&self) -> Option<&ConcurrentGroup> {
        self.groups().get(self.group_index.get())
    }

    pub(crate) fn get_current_and_valid_execution_sequence(
        &self,
        data: &RefDataValue,
    ) -> Option<(&ExecutionSequence, &ConcurrentGroup)> {
        let _g = group_begin!();

        group_log::log(format_args!("runOneCompleted: data: {}", data));

        let RefDataValue::Execution { group_index, entry_data } = data else {
            group_log::log(format_args!("runOneCompleted: the data is not execution"));
            return None;
        };
        let Some(entry_data) = entry_data.as_ref() else {
            group_log::log(format_args!(
                "runOneCompleted: the data did not know which entry was active in the group",
            ));
            return None;
        };
        if *group_index != self.group_index.get() {
            group_log::log(format_args!("runOneCompleted: the data is for a different group"));
            return None;
        }
        let Some(group) = self.active_group() else {
            group_log::log(format_args!("runOneCompleted: the data did not know the group"));
            return None;
        };
        let Some(sequence) = group.sequences(self).get(entry_data.sequence_index) else {
            group_log::log(format_args!("runOneCompleted: the data did not know the sequence"));
            return None;
        };
        if sequence.attempt.get() != entry_data.attempt {
            group_log::log(format_args!(
                "runOneCompleted: the data is for a previous retry or repeat (outdated)",
            ));
            return None;
        }
        if sequence.active_entry.get() != entry_data.entry {
            group_log::log(format_args!(
                "runOneCompleted: the data is for a different sequence index (outdated)",
            ));
            return None;
        }
        group_log::log(format_args!("runOneCompleted: the data is valid and current"));
        Some((sequence, group))
    }

    #[optimize(size)]
    fn advance_sequence(buntest: &BunTest, sequence: &ExecutionSequence, group: &ConcurrentGroup) {
        let _g = group_begin!();

        debug_assert!(sequence.executing.get());
        if sequence.pending_matchers.take() > 0 {
            buntest.unclaimed.some_ended.set(true);
        }
        sequence.callback_done.set(false);
        if let Some(active_entry) = sequence.active_entry.get() {
            let sequence_entry = buntest.sequence_entry(active_entry);
            let entry = buntest.entry(sequence_entry.entry);
            if entry.added_in_phase == AddedInPhase::Preload {
                bun_jsc::compiled_program::did_run_preloads(VirtualMachine::get().global());
            }

            sequence.executing.set(false);
            sequence.active_entry.set(if sequence.maybe_skip.take() {
                sequence_entry.failure_skip_past.get().and_then(|id| buntest.sequence_entry(id).next.get())
            } else {
                sequence_entry.next.get()
            });
            if entry.calling.is_vitest() {
                if Some(active_entry) == sequence.test_entry {
                    sequence.check_expect_assertions();
                }
                let left_around_all = entry.around == Some((Around::All, AroundPhase::TearDown));
                if let (true, Some(scope)) = (left_around_all, entry.base.parent) {
                    buntest.scope(scope).async_context.clear();
                }
                if entry.added_in_phase == AddedInPhase::Execution || left_around_all {
                    entry.callback.clear();
                }
            }
        } else {
            debug_assert!(false, "can't call advanceSequence on a completed sequence");
        }

        if sequence.active_entry.get().is_none() {
            sequence.active_entry.set(sequence.take_deferred(buntest));
        }

        if sequence.active_entry.get().is_none() {
            // just completed the sequence
            sequence.flip_fails(buntest);
            let test_failed = sequence.result.get().is_fail();
            let test_passed = sequence.result.get().is_pass(PendingIs::PendingIsPass);

            // Handle retry logic: if test failed and we have retries remaining, retry it
            if test_failed && sequence.remaining_retry_count.get() > 0 {
                sequence.remaining_retry_count.update(|count| count - 1);
                Execution::save_attempt_failure(buntest, sequence);
                Execution::reset_sequence(buntest, sequence);
                return;
            }

            // Handle repeat logic: if test passed and we have repeats remaining, repeat it
            if test_passed && sequence.remaining_repeat_count.get() > 0 && sequence.result.get() != Result::Skip {
                sequence.remaining_repeat_count.update(|count| count - 1);
                sequence.remaining_retry_count.set(sequence.test(buntest).map_or(0, |test| test.retry_count));
                sequence.earlier_failures.take();
                Execution::reset_sequence(buntest, sequence);
                return;
            }

            // Only report the final result after all retries/repeats are done
            Execution::on_sequence_completed(buntest, sequence);
            sequence.context.clear();

            // No more retries or repeats; mark sequence as complete
            if group.remaining_incomplete_entries.get() == 0 {
                debug_assert!(false); // remaining_incomplete_entries should never go below 0
                return;
            }
            group.remaining_incomplete_entries.update(|count| count - 1);
        }
    }

    fn on_group_started(global_this: &JSGlobalObject) {
        global_this.bun_vm().auto_killer.enable();
    }

    fn on_group_completed(global_this: &JSGlobalObject) {
        let vm = global_this.bun_vm();
        // Under --isolate the swap between files kills and clears the tracked set.
        if !vm.test_isolation_enabled.get() {
            vm.auto_killer.disable();
        }
    }

    fn on_sequence_started(buntest: &BunTest, global_this: &JSGlobalObject, sequence: &ExecutionSequence) {
        let test = sequence.test(buntest);
        if test.is_some_and(|entry| !entry.callback.is_some()) {
            return;
        }

        sequence.started_at.set(Timespec::now_force_real_time());

        if let Some(entry) = test {
            scoped_log!(
                jest,
                "Running test: {:?}",
                // `BStr`'s `Debug` impl quotes and escapes for display.
                bstr::BStr::new(entry.base.name.as_deref().unwrap_or(b"(unnamed)"))
            );
            super::vi_utils::before_each_attempt(global_this, entry.calling.is_vitest());

            if entry.base.test_id_for_debugger.get() != 0 {
                if let Some(debugger) = VirtualMachine::get().debugger.get() {
                    if debugger.test_reporter_agent.is_enabled() {
                        debugger
                            .test_reporter_agent
                            .report_test_start(entry.base.test_id_for_debugger.get());
                    }
                }
            }
        }
    }

    fn on_entry_started(sequence_entry: &SequenceEntry, entry: &ExecutionEntry) {
        if !entry.callback.is_some() {
            return;
        }

        let _g = group_begin!();
        if entry.timeout != 0 {
            group_log::log(format_args!("-> entry.timeout: {}", entry.timeout));
            sequence_entry.timespec.set(Timespec::ms_from_now_force_real_time(entry.timeout as i64));
        } else {
            group_log::log(format_args!("-> entry.timeout: 0"));
            sequence_entry.timespec.set(Timespec::EPOCH);
        }
    }

    fn on_sequence_completed(buntest: &BunTest, sequence: &ExecutionSequence) {
        let elapsed_ns: u64 = if sequence.started_at.get().eql(&Timespec::EPOCH) {
            0
        } else {
            sequence.started_at.get().since_now_force_real_time()
        };
        sequence.check_expect_assertions();
        sequence.set_result_if_pending(match sequence.entry_mode(buntest) {
            ScopeMode::Failing => Result::FailBecauseFailingTestPassed,
            ScopeMode::Todo => Result::FailBecauseTodoPassed,
            _ => Result::Pass,
        });
        if let Some(first_entry) = sequence.first_entry {
            if sequence.test_entry.is_some() || sequence.result.get() != Result::Pass {
                test_command::CommandLineReporter::handle_test_completed(
                    buntest,
                    sequence,
                    buntest.entry_of(sequence.test_entry.unwrap_or(first_entry)),
                    elapsed_ns,
                );
            }
        }

        if let Some(entry) = sequence.test(buntest) {
            if entry.base.test_id_for_debugger.get() != 0 {
                if let Some(debugger) = VirtualMachine::get().debugger.get() {
                    if debugger.test_reporter_agent.is_enabled() {
                        use bun_jsc::Debugger::TestStatus as S;
                        debugger.test_reporter_agent.report_test_end(
                            entry.base.test_id_for_debugger.get(),
                            match sequence.result.get() {
                                Result::Pass => S::Pass,
                                Result::Fail => S::Fail,
                                Result::Skip => S::Skip,
                                Result::FailBecauseTimeout => S::Timeout,
                                Result::FailBecauseTimeoutWithDoneCallback => S::Timeout,
                                Result::FailBecauseHookTimeout => S::Timeout,
                                Result::FailBecauseHookTimeoutWithDoneCallback => S::Timeout,
                                Result::Todo => S::Todo,
                                Result::SkippedBecauseLabel => S::SkippedBecauseLabel,
                                Result::FailBecauseFailingTestPassed => S::Fail,
                                Result::FailBecauseFailsTestPassed => S::Fail,
                                Result::FailBecauseTodoPassed => S::Fail,
                                Result::FailBecauseExpectedHasAssertions => S::Fail,
                                Result::FailBecauseExpectedAssertionCount => S::Fail,
                                Result::Pending => S::Timeout,
                            },
                            elapsed_ns as f64,
                        );
                    }
                }
            }
        }
    }

    /// Saves a failed attempt's failure before a retry, so it's reported with the test's final result.
    fn save_attempt_failure(buntest: &BunTest, sequence: &ExecutionSequence) {
        if !buntest.reporter.jest.reports_to_junit {
            return;
        }
        let failure = sequence
            .failure
            .take()
            .or_else(|| {
                test_command::TestFailure::from_result(
                    sequence.result.get(),
                    sequence.expect_call_count.get(),
                )
            })
            .unwrap_or_default();
        sequence.earlier_failures.with_taken(|failures| failures.push(failure));
    }

    fn reset_sequence(buntest: &BunTest, sequence: &ExecutionSequence) {
        debug_assert!(!sequence.executing.get());
        {
            // reset the entries
            let mut current_entry = sequence.first_entry;
            while let Some(current) = current_entry.map(|id| buntest.sequence_entry(id)) {
                // remove entries that were added in the execution phase
                while let Some(next) = current.next.get().map(|id| buntest.sequence_entry(id))
                    && buntest.entry(next.entry).added_in_phase == AddedInPhase::Execution
                {
                    current.next.set(next.next.get());
                }
                current.timespec.set(Timespec::EPOCH);
                current_entry = current.next.get();
            }
        }

        let ExecutionSequence {
            first_entry,
            active_entry,
            test_entry: _,
            // Preserve retry/repeat counts across reset
            remaining_repeat_count: _,
            remaining_retry_count: _,
            attempt,
            result,
            executing: _,
            started_at,
            expect_call_count,
            expect_assertions,
            maybe_skip,
            context: _,
            deferred: _,
            pending_matchers,
            callback_done,
            counted_snapshots,
            failure,
            earlier_failures: _,
        } = sequence;
        active_entry.set(*first_entry);
        attempt.update(|attempt| attempt.wrapping_add(1));
        result.set(Result::Pending);
        started_at.set(Timespec::EPOCH);
        expect_call_count.set(0);
        expect_assertions.set(ExpectAssertions::NotSet);
        maybe_skip.set(false);
        pending_matchers.set(0);
        callback_done.set(false);
        failure.set(None);

        // Snapshot counters are keyed by full test name and incremented on every
        // toMatchSnapshot() call. Without this, retries / repeats would
        // increment the counter to N on attempt N and look for a key that does
        // not exist (https://github.com/oven-sh/bun/issues/23705).
        buntest.reporter.jest.with_snapshots(|snapshots| snapshots.undo_counts(&counted_snapshots.take()));
    }

    pub(crate) fn handle_uncaught_exception(
        buntest: &BunTest,
        user_data: &RefDataValue,
    ) -> HandleUncaughtExceptionResult {
        let _g = group_begin!();

        let Some((sequence, _group)) = buntest.execution.get_current_and_valid_execution_sequence(user_data)
        else {
            return HandleUncaughtExceptionResult::ShowUnhandledErrorBetweenTests;
        };

        sequence.maybe_skip.set(true);
        if sequence.result.get() == Result::Skip && sequence.context.is_some() {
            // Vitest reports a test that called `skip()` as skipped, whatever it throws.
            return HandleUncaughtExceptionResult::HideError;
        }
        if sequence.entry_mode(buntest) == ScopeMode::Fails {
            sequence.set_result_if_pending(Result::Fail);
            return HandleUncaughtExceptionResult::HideError;
        }
        if sequence.active_entry.get() != sequence.test_entry {
            // executing hook
            sequence.set_result_if_pending(Result::Fail);
            return HandleUncaughtExceptionResult::ShowHandledError;
        }

        match sequence.entry_mode(buntest) {
            ScopeMode::Failing => {
                sequence.set_result_if_pending(Result::Pass); // executing test() callback
                HandleUncaughtExceptionResult::HideError // failing tests prevent the error from being displayed
            }
            ScopeMode::Todo => {
                sequence.set_result_if_pending(Result::Todo); // executing test() callback
                HandleUncaughtExceptionResult::ShowHandledError // todo tests with --todo will still display the error
            }
            _ => {
                sequence.set_result_if_pending(Result::Fail);
                HandleUncaughtExceptionResult::ShowHandledError
            }
        }
    }

    pub(crate) fn record_error(
        buntest: &BunTest,
        global: &JSGlobalObject,
        user_data: &RefDataValue,
        thrown: JSValue,
    ) -> JsResult<()> {
        let Some((sequence, _)) = buntest.execution.get_current_and_valid_execution_sequence(user_data) else {
            return Ok(());
        };
        let Some(context) = sequence.context.get() else {
            return Ok(());
        };
        if sequence.result.get() == Result::Skip {
            return Ok(());
        }
        TestContext::record_error(context, global, thrown)?;
        TestContext::sync_result(context, global, buntest, sequence)
    }
}

#[optimize(size)]
fn step_group(
    buntest: &BunTestPtr,
    global_this: &JSGlobalObject,
    now: &mut Timespec,
) -> JsResult<StepResult> {
    let _g = group_begin!();
    let this = &buntest.execution;

    loop {
        let Some(group) = this.active_group() else {
            return Ok(ExpectDeferred::step_file_end(buntest, global_this, now));
        };
        if !group.executing.replace(true) {
            Execution::on_group_started(global_this);
        }

        // loop over items in the group and advance their execution

        let status = step_group_one(buntest, global_this, group, now)?;
        match status {
            AdvanceStatus::Execute { timeout } => {
                return Ok(StepResult::Waiting { timeout });
            }
            AdvanceStatus::Done => {}
        }

        if group.pending_matchers.get() > 0 {
            // Any test in the group may have called them, so wait until the latest test deadline.
            let timeout = group
                .sequences(this)
                .iter()
                .filter_map(|sequence| sequence.test_entry)
                .map(|entry| buntest.sequence_entry(entry).timespec.get())
                .fold(Timespec::EPOCH, |latest, timespec| if timespec.order(&latest).is_gt() { timespec } else { latest });
            if timeout.eql(&Timespec::EPOCH) || timeout.order(now).is_gt() {
                return Ok(StepResult::Waiting { timeout });
            }
            group.pending_matchers.set(0);
            ExpectDeferred::group_timed_out(buntest, global_this, this.group_index.get());
        }
        group.executing.set(false);
        Execution::on_group_completed(global_this);

        // if there is one sequence and it failed, skip to the next group
        if group.sequences(this).iter().all(|sequence| sequence.result.get().is_fail()) {
            group_log::log(format_args!(
                "stepGroup: all sequences failed, skipping to failure_skip_to group",
            ));
            this.group_index.set(group.failure_skip_to);
        } else {
            group_log::log(format_args!("stepGroup: not all sequences failed, advancing to next group"));
            this.group_index.update(|index| index + 1);
        }
    }
}

enum AdvanceStatus {
    Done,
    Execute { timeout: Timespec },
}

#[optimize(size)]
fn step_group_one(
    buntest: &BunTestPtr,
    global_this: &JSGlobalObject,
    group: &ConcurrentGroup,
    now: &mut Timespec,
) -> JsResult<AdvanceStatus> {
    let mut final_status = AdvanceStatus::Done;
    let runner = &buntest.reporter.jest;
    let concurrent_limit = runner.vi_config.get().max_concurrency.unwrap_or(runner.max_concurrency) as usize;
    let mut active_count: usize = 0;
    for sequence_index in 0..group.sequence_end - group.sequence_start {
        let sequence_status =
            step_sequence(buntest, global_this, group, sequence_index, now)?;
        match sequence_status {
            AdvanceSequenceStatus::Done => {}
            AdvanceSequenceStatus::Execute { timeout } => {
                let prev_timeout: Timespec = match &final_status {
                    AdvanceStatus::Execute { timeout } => *timeout,
                    _ => Timespec::EPOCH,
                };
                let this_timeout = timeout;
                final_status = AdvanceStatus::Execute {
                    timeout: Timespec::min_ignore_epoch(prev_timeout, this_timeout),
                };
                active_count += 1;
                if concurrent_limit != 0 && active_count >= concurrent_limit {
                    break;
                }
            }
        }
    }
    Ok(final_status)
}

/// `evaluate_timeout` leaves the failure of an around hook that timed out to this error, which says what the reporter can't.
fn report_around_timeout(
    buntest: &BunTest,
    global_this: &JSGlobalObject,
    entry: &ExecutionEntry,
    data: &RefDataValue,
) -> JsResult<()> {
    let Some((around, phase)) = entry.around else {
        return Ok(());
    };
    let error = around.timeout_error(global_this, phase, entry.timeout)?;
    buntest.on_uncaught_exception(global_this, Some(error), false, data);
    Ok(())
}

enum AdvanceSequenceStatus {
    /// the entire sequence is completed.
    Done,
    /// the item is queued for execution or has not completed yet. need to wait for it
    Execute { timeout: Timespec },
}

#[optimize(size)]
fn step_sequence(
    buntest: &BunTestPtr,
    global_this: &JSGlobalObject,
    group: &ConcurrentGroup,
    sequence_index: usize,
    now: &mut Timespec,
) -> JsResult<AdvanceSequenceStatus> {
    loop {
        if let Some(r) =
            step_sequence_one(buntest, global_this, group, sequence_index, now)?
        {
            return Ok(r);
        }
    }
}

/// returns None if the while loop should continue
#[optimize(size)]
fn step_sequence_one(
    buntest: &BunTestPtr,
    global_this: &JSGlobalObject,
    group: &ConcurrentGroup,
    sequence_index: usize,
    now: &mut Timespec,
) -> JsResult<Option<AdvanceSequenceStatus>> {
    let _g = group_begin!();
    if buntest.unclaimed.some_ended.take() {
        ExpectDeferred::settle_ended(buntest, global_this)?;
    }
    let group_index = buntest.execution.group_index.get();

    let sequence = &group.sequences(&buntest.execution)[sequence_index];
    if sequence.executing.get() {
        let Some(active_entry) = sequence.active_entry.get() else {
            debug_assert!(false); // sequence is executing with no active entry
            return Ok(Some(AdvanceSequenceStatus::Execute {
                timeout: Timespec::EPOCH,
            }));
        };
        if sequence.evaluate_timeout(buntest, active_entry, now) {
            if let Some(context) = sequence.context.get() {
                TestContext::abort_signal(context, global_this);
            }
            let entry_data = EntryData {
                sequence_index,
                entry: Some(active_entry),
                attempt: sequence.attempt.get(),
            };
            buntest.reporter.jest.bun_test_root.mark_timed_out(group_index, entry_data);
            report_around_timeout(
                buntest,
                global_this,
                buntest.entry_of(active_entry),
                &RefDataValue::Execution { group_index, entry_data: Some(entry_data) },
            )?;
            Execution::advance_sequence(buntest, sequence, group);
            return Ok(None); // run again
        }
        group_log::log(format_args!("runOne: can't advance; already executing"));
        return Ok(Some(AdvanceSequenceStatus::Execute {
            timeout: buntest.sequence_entry(active_entry).timespec.get(),
        }));
    }

    let Some(next_id) = sequence.active_entry.get() else {
        // Sequence is complete - either because:
        // 1. It ran out of entries (normal completion)
        // 2. All retry/repeat attempts have been exhausted
        group_log::log(format_args!("runOne: no more entries; sequence complete."));
        return Ok(Some(AdvanceSequenceStatus::Done));
    };
    let next_entry = buntest.sequence_entry(next_id);
    let next_item = buntest.entry(next_entry.entry);
    sequence.executing.set(true);
    // The first entry becomes active again after its fixture setup entries, so `started_at` guards against a second start.
    if Some(next_id) == sequence.first_entry && sequence.started_at.get().eql(&Timespec::EPOCH) {
        Execution::on_sequence_started(buntest, global_this, sequence);
    }
    Execution::on_entry_started(next_entry, next_item);
    if next_item.added_in_phase == AddedInPhase::Preload {
        bun_jsc::compiled_program::will_run_preloads(global_this);
    }

    if let Some(mut callback) = next_item.callback.get() {
        group_log::log(format_args!("runSequence queued callback"));

        let entry_data = EntryData {
            sequence_index,
            entry: Some(next_id),
            attempt: sequence.attempt.get(),
        };
        let callback_data = RefDataValue::Execution {
            group_index,
            entry_data: Some(entry_data),
        };
        group_log::log(format_args!("runSequence queued callback: {}", callback_data));

        if sequence.test_entry.is_some()
            && (next_item.calling.is_vitest()
                || (Some(next_id) == sequence.first_entry && sequence.has_vitest_entry(buntest)))
        {
            sequence.context(global_this, buntest, group_index, sequence_index);
        }
        let context = sequence.context.get();
        if let Some(context) = context {
            TestContext::sync_result(context, global_this, buntest, sequence)?;
        }
        let mut args = [JSValue::UNDEFINED; 2];
        let args: &[JSValue] = match (next_item.calling, context, next_item.base.parent) {
            (Calling::Vitest { context: true }, Some(context), _) => {
                args[0] = context;
                &args[..1]
            }
            (Calling::Vitest { context: true }, None, Some(scope)) => {
                args[0] = match &next_item.fixtures {
                    Some(fixtures) => TestFixtures::suite_hook_context(fixtures.get(), global_this)?,
                    None => JSValue::create_empty_object(global_this, 0),
                };
                args[1] = test_context::suite_task(global_this, buntest, scope)?;
                &args
            }
            _ => &[],
        };

        let test = sequence.test(buntest);
        let (fixtures, fixtures_scope) = match (context, test) {
            (Some(context), Some(test)) => (test_context::js::fixtures_get_cached(context), test.base.parent),
            _ => (next_item.fixtures.as_ref().map(Strong::get), next_item.base.parent),
        };
        if let Some(fixtures) = fixtures
            && let Some(parameter) = &next_item.parameter
        {
            // An around hook's first parameter is `runTest` or `runSuite`.
            let parameter = parameter.get_or_init(|| ContextParameter::of(callback, usize::from(next_item.around.is_some())));
            let into = context.or_else(|| args.first().copied()).unwrap_or(JSValue::UNDEFINED);
            match TestFixtures::next(fixtures, global_this, into, buntest.scopes_from(fixtures_scope), parameter, next_item.timeout) {
                Ok(NextFixture::Ready) => {}
                Ok(NextFixture::SetUp(set_up)) => {
                    let set_up = buntest.create_vitest_entry(set_up, next_item.timeout);
                    buntest.sequence_entry(set_up).next.set(Some(next_id));
                    buntest.sequence_entry(set_up).failure_skip_past.set(next_entry.failure_skip_past.get());
                    sequence.active_entry.set(Some(set_up));
                    sequence.executing.set(false);
                    return Ok(None); // run again
                }
                Err(err) => {
                    let thrown = global_this.take_exception(err);
                    buntest.on_uncaught_exception(global_this, Some(thrown), false, &callback_data);
                    Execution::advance_sequence(buntest, sequence, group);
                    return Ok(None); // run again
                }
            }
        }

        let scope = test.unwrap_or(next_item).base.parent;
        if let Some(captured) = test_context_around::captured_async_context(context, buntest.scopes_from(scope)) {
            callback = test_context_around::in_async_context(global_this, captured, callback)?;
        }
        let set_up_args: [JSValue; 4];
        let args = if let Some((around, AroundPhase::SetUp)) = next_item.around {
            let suite = match (args.get(1), scope) {
                (Some(&suite), _) => suite,
                (None, Some(scope)) => test_context::suite_task(global_this, buntest, scope)?,
                (None, None) => JSValue::UNDEFINED,
            };
            set_up_args = [
                AroundHook::create(global_this, buntest, callback_data, around, next_item.timeout),
                callback,
                args.first().copied().unwrap_or(JSValue::UNDEFINED),
                suite,
            ];
            callback = AroundHook::set_up_function(global_this);
            &set_up_args[..]
        } else {
            args
        };

        global_this.bun_vm().is_running_vitest_entry.set(next_item.calling.is_vitest());
        if BunTest::run_test_callback(
            buntest,
            global_this,
            callback,
            args,
            next_item.calling == Calling::Jest { done: true },
            callback_data,
            &next_entry.timespec.get(),
        )
        .is_some()
        {
            *now = Timespec::now_force_real_time();
            if sequence.evaluate_timeout(buntest, next_id, now) {
                if let Some(context) = context {
                    TestContext::abort_signal(context, global_this);
                }
                report_around_timeout(buntest, global_this, next_item, &callback_data)?;
            } else if sequence.waits_for_matchers() {
                return Ok(Some(AdvanceSequenceStatus::Execute {
                    timeout: next_entry.timespec.get(),
                }));
            }

            // the result is available immediately; advance the sequence and run again.
            Execution::advance_sequence(buntest, sequence, group);
            return Ok(None); // run again
        }
        return Ok(Some(AdvanceSequenceStatus::Execute {
            timeout: next_entry.timespec.get(),
        }));
    } else {
        match next_item.base.mode {
            ScopeMode::Skip => sequence.set_result_if_pending(Result::Skip),
            ScopeMode::Todo => sequence.set_result_if_pending(Result::Todo),
            ScopeMode::FilteredOut => sequence.set_result_if_pending(Result::SkippedBecauseLabel),
            _ => {
                group_log::log(format_args!("runSequence: no callback for sequence_index {}", sequence_index));
                // An `ExecutionEntry::teardown` slot that was not filled, or `BunTest::file_end`.
                debug_assert!(sequence.test_entry.is_none());
            }
        }
        Execution::advance_sequence(buntest, sequence, group);
        return Ok(None); // run again
    }
}
