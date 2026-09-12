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

use core::cell::{Cell, OnceCell, RefCell};
use std::rc::Rc;

use bun_core::{Timespec, TimespecMockMode};
use bun_jsc::{JSGlobalObject, JsResult};
// `bun_jsc::VirtualMachine` is the *module* re-export; the struct lives one level deeper.
use bun_core::scoped_log;
use bun_jsc::virtual_machine::VirtualMachine;

use super::bun_test::{
    AddedInPhase, BunTest, BunTestPtr, EntryData, ExecutionEntry, HandleUncaughtExceptionResult,
    Order, RefDataValue, ScopeMode, StepResult, group_begin,
};
use super::debug::group as group_log; // bun_test.debug.group
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

/// Index of an [`EntryNode`] in [`Execution::nodes`] (or, while the order is
/// being built, in `Order::nodes`).
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct EntryId(u32);

impl EntryId {
    #[inline]
    pub(crate) fn index(self) -> usize {
        self.0 as usize
    }
    #[inline]
    pub(crate) fn from_index(i: usize) -> Self {
        EntryId(u32::try_from(i).expect("too many execution entries"))
    }
}

/// One scheduled occurrence of an [`ExecutionEntry`] in the execution order.
/// A hook shared by several tests gets one node per test; the entry itself is
/// shared.
pub struct EntryNode {
    pub(crate) entry: Rc<ExecutionEntry>,
    pub(crate) next: Cell<Option<EntryId>>,
    /// if this entry fails, go to the entry 'failure_skip_past.next'
    pub(crate) failure_skip_past: Cell<Option<EntryId>>,
    /// '.epoch' = not set
    /// when this entry begins executing, the timespec will be set to the current time plus the timeout(ms).
    pub(crate) timespec: Cell<Timespec>,
}

impl EntryNode {
    pub(crate) fn new(entry: Rc<ExecutionEntry>) -> Self {
        EntryNode {
            entry,
            next: Cell::new(None),
            failure_skip_past: Cell::new(None),
            timespec: Cell::new(Timespec::EPOCH),
        }
    }
}

pub struct Execution {
    groups: OnceCell<Box<[ConcurrentGroup]>>,
    sequences: OnceCell<Box<[ExecutionSequence]>>,
    /// Every scheduled entry occurrence; grows during execution when a hook is
    /// registered from inside a test. Borrows never leave the accessor they
    /// are taken in.
    nodes: RefCell<Vec<EntryNode>>,
    pub(crate) group_index: Cell<usize>,
    /// The entry whose callback is synchronously on the stack right now. Set
    /// around `run_test_callback` so code re-entered from a test body (e.g.
    /// spawnSync's wait loop) can read the calling entry's own deadline.
    pub(crate) on_stack_entry: Cell<Option<EntryId>>,
    /// The (group_index, sequence_index, entry, repeat) for `on_stack_entry`,
    /// set/restored alongside it. `get_current_state_data()` can't name a
    /// sequence inside a concurrent group; this can, for code re-entered from
    /// the microtask drain inside `run_test_callback` (node:test's runtime
    /// `t.skip()`/`t.todo()` mark lands there before the DoneCallback is
    /// stamped).
    pub(crate) on_stack_entry_data: Cell<Option<super::bun_test::EntryData>>,
}

pub struct ConcurrentGroup {
    pub(crate) sequence_start: usize,
    pub(crate) sequence_end: usize,
    /// Index of the next sequence that has not been started yet
    pub(crate) next_sequence_index: Cell<usize>,
    pub(crate) executing: Cell<bool>,
    pub(crate) remaining_incomplete_entries: Cell<usize>,
    /// used by beforeAll to skip directly to afterAll if it fails
    pub(crate) failure_skip_to: usize,
}

impl ConcurrentGroup {
    pub(crate) fn init(
        sequence_start: usize,
        sequence_end: usize,
        next_index: usize,
    ) -> ConcurrentGroup {
        ConcurrentGroup {
            sequence_start,
            sequence_end,
            executing: Cell::new(false),
            remaining_incomplete_entries: Cell::new(sequence_end - sequence_start),
            failure_skip_to: next_index,
            next_sequence_index: Cell::new(0),
        }
    }

    pub(crate) fn try_extend(
        &mut self,
        next_sequence_start: usize,
        next_sequence_end: usize,
    ) -> bool {
        if self.sequence_end != next_sequence_start {
            return false;
        }
        self.sequence_end = next_sequence_end;
        self.remaining_incomplete_entries
            .set(self.sequence_end - self.sequence_start);
        true
    }

    pub(crate) fn sequences<'a>(&self, execution: &'a Execution) -> &'a [ExecutionSequence] {
        &execution.sequences()[self.sequence_start..self.sequence_end]
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ExpectAssertions {
    NotSet,
    AtLeastOne,
    Exact(u32),
}

pub struct ExecutionSequence {
    pub(crate) first_entry: Option<EntryId>,
    /// Index into ExecutionSequence.entries() for the entry that is not started or currently running
    pub(crate) active_entry: Cell<Option<EntryId>>,
    pub(crate) test_entry: Option<EntryId>,
    pub(crate) remaining_repeat_count: Cell<u32>,
    pub(crate) remaining_retry_count: Cell<u32>,
    pub(crate) result: Cell<Result>,
    pub(crate) executing: Cell<bool>,
    pub(crate) started_at: Cell<Timespec>,
    /// Number of expect() calls observed in this sequence.
    pub(crate) expect_call_count: Cell<u32>,
    /// Expectation set by expect.hasAssertions() or expect.assertions(n).
    pub(crate) expect_assertions: Cell<ExpectAssertions>,
    pub(crate) maybe_skip: Cell<bool>,
}

impl ExecutionSequence {
    pub(crate) fn init(
        first_entry: Option<EntryId>,
        test_entry: Option<EntryId>,
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
            result: Cell::new(Result::Pending),
            executing: Cell::new(false),
            started_at: Cell::new(Timespec::EPOCH),
            expect_call_count: Cell::new(0),
            expect_assertions: Cell::new(ExpectAssertions::NotSet),
            maybe_skip: Cell::new(false),
        }
    }

    /// Back to the not-started state, preserving retry/repeat counts.
    fn reset(&self) {
        self.active_entry.set(self.first_entry);
        self.result.set(Result::Pending);
        self.executing.set(false);
        self.started_at.set(Timespec::EPOCH);
        self.expect_call_count.set(0);
        self.expect_assertions.set(ExpectAssertions::NotSet);
        self.maybe_skip.set(false);
    }

    fn entry_mode(&self, execution: &Execution) -> ScopeMode {
        if let Some(entry) = self.test_entry {
            return execution.entry(entry).base.mode;
        }
        ScopeMode::Normal
    }

    #[inline]
    fn set_result_if_pending(&self, result: Result) {
        if self.result.get() == Result::Pending {
            self.result.set(result);
        }
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
    FailBecauseTodoPassed,
    FailBecauseExpectedHasAssertions,
    FailBecauseExpectedAssertionCount,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Basic {
    Pending,
    Pass,
    Fail,
    Skip,
    Todo,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PendingIs {
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
}

impl Execution {
    pub(crate) fn init() -> Execution {
        Execution {
            groups: OnceCell::new(),
            sequences: OnceCell::new(),
            nodes: RefCell::new(Vec::new()),
            group_index: Cell::new(0),
            on_stack_entry: Cell::new(None),
            on_stack_entry_data: Cell::new(None),
        }
    }

    #[inline]
    pub(crate) fn groups(&self) -> &[ConcurrentGroup] {
        self.groups.get().map_or(&[], |g| &g[..])
    }

    #[inline]
    pub(crate) fn sequences(&self) -> &[ExecutionSequence] {
        self.sequences.get().map_or(&[], |s| &s[..])
    }

    pub(crate) fn entry(&self, id: EntryId) -> Rc<ExecutionEntry> {
        Rc::clone(&self.nodes.borrow()[id.index()].entry)
    }

    pub(crate) fn next_of(&self, id: EntryId) -> Option<EntryId> {
        self.nodes.borrow()[id.index()].next.get()
    }

    pub(crate) fn set_next(&self, id: EntryId, next: Option<EntryId>) {
        self.nodes.borrow()[id.index()].next.set(next);
    }

    fn failure_skip_past_of(&self, id: EntryId) -> Option<EntryId> {
        self.nodes.borrow()[id.index()].failure_skip_past.get()
    }

    pub(crate) fn timespec_of(&self, id: EntryId) -> Timespec {
        self.nodes.borrow()[id.index()].timespec.get()
    }

    fn set_timespec(&self, id: EntryId, timespec: Timespec) {
        self.nodes.borrow()[id.index()].timespec.set(timespec);
    }

    pub(crate) fn push_node(&self, node: EntryNode) -> EntryId {
        let mut nodes = self.nodes.borrow_mut();
        let id = EntryId::from_index(nodes.len());
        nodes.push(node);
        id
    }

    pub(crate) fn load_from_order(&self, order: &mut Order::Order) {
        debug_assert!(self.groups().is_empty());
        debug_assert!(self.sequences().is_empty());
        debug_assert!(self.nodes.borrow().is_empty());
        let _ = self
            .groups
            .set(core::mem::take(&mut order.groups).into_boxed_slice());
        let _ = self
            .sequences
            .set(core::mem::take(&mut order.sequences).into_boxed_slice());
        *self.nodes.borrow_mut() = core::mem::take(&mut order.nodes);
    }

    pub(crate) fn handle_timeout(
        &self,
        buntest: &BunTest,
        global_this: &JSGlobalObject,
    ) -> JsResult<()> {
        let _g = group_begin!();
        self.kill_dangling_processes_on_timeout(global_this);
        buntest.add_result(RefDataValue::Start);
        Ok(())
    }

    /// The kill-only half of [`handle_timeout`]: reaps a timed-out test's spawned processes without touching the runner's queue, so it may run from inside `spawnSync`'s isolated loop.
    pub(crate) fn kill_dangling_processes_on_timeout(&self, global_this: &JSGlobalObject) {
        // if the concurrent group has one sequence and the sequence has an active entry that has timed out,
        //   kill any dangling processes
        // when using test.concurrent(), we can't do this because it could kill multiple tests at once.
        if let Some(current_group) = self.active_group() {
            let sequences = current_group.sequences(self);
            if sequences.len() == 1 {
                let sequence = &sequences[0];
                if let Some(entry) = sequence.active_entry.get() {
                    let now = Timespec::now_force_real_time();
                    if self.timespec_of(entry).order(&now) == core::cmp::Ordering::Less {
                        let kill_count = global_this.bun_vm().as_mut().auto_killer.kill();
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
        buntest_strong: &BunTestPtr,
        global_this: &JSGlobalObject,
        data: &RefDataValue,
    ) -> JsResult<StepResult> {
        let _g = group_begin!();
        let buntest: &BunTest = buntest_strong;
        let this = &buntest.execution;
        let mut now = Timespec::now_force_real_time();

        match data {
            RefDataValue::Start => step_group(buntest, global_this, &mut now),
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
                    return Ok(StepResult::Waiting {
                        timeout: Timespec::EPOCH,
                    });
                };
                let sequence_index = match data {
                    RefDataValue::Execution {
                        entry_data: Some(ed),
                        ..
                    } => ed.sequence_index,
                    // get_current_and_valid_execution_sequence returned Some ⇒ data is Execution with entry_data
                    _ => unreachable!(),
                };

                debug_assert!(sequence.active_entry.get().is_some());
                this.advance_sequence(buntest, sequence, group);

                let sequence_result =
                    step_sequence(buntest, global_this, group, sequence_index, &mut now)?;
                match sequence_result {
                    AdvanceSequenceStatus::Done => {}
                    AdvanceSequenceStatus::Execute { timeout } => {
                        return Ok(StepResult::Waiting { timeout });
                    }
                }
                // this sequence is complete; execute the next sequence
                let sequences = group.sequences(this);
                while group.next_sequence_index.get() < sequences.len() {
                    let next_idx = group.next_sequence_index.get();
                    if sequences[next_idx].executing.get() {
                        group.next_sequence_index.set(next_idx + 1);
                        continue;
                    }
                    let sequence_status =
                        step_sequence(buntest, global_this, group, next_idx, &mut now)?;
                    match sequence_status {
                        AdvanceSequenceStatus::Done => {
                            group
                                .next_sequence_index
                                .set(group.next_sequence_index.get() + 1);
                            continue;
                        }
                        AdvanceSequenceStatus::Execute { timeout } => {
                            return Ok(StepResult::Waiting { timeout });
                        }
                    }
                }
                // all sequences have started
                if group.remaining_incomplete_entries.get() == 0 {
                    return step_group(buntest, global_this, &mut now);
                }
                Ok(StepResult::Waiting {
                    timeout: Timespec::EPOCH,
                })
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

        let RefDataValue::Execution {
            group_index,
            entry_data,
        } = data
        else {
            group_log::log(format_args!("runOneCompleted: the data is not execution"));
            return None;
        };
        let Some(entry_data) = entry_data.as_ref() else {
            group_log::log(format_args!(
                "runOneCompleted: the data did not know which entry was active in the group",
            ));
            return None;
        };
        // Spec compares `this.activeGroup() != data.group(buntest)` by pointer; both index into
        // `self.groups`, so equality is exactly `group_index == self.group_index`.
        let groups = self.groups();
        if self.group_index.get() >= groups.len() || *group_index != self.group_index.get() {
            group_log::log(format_args!(
                "runOneCompleted: the data is for a different group"
            ));
            return None;
        }
        if *group_index >= groups.len() {
            group_log::log(format_args!(
                "runOneCompleted: the data did not know the group"
            ));
            return None;
        }
        let group = &groups[*group_index];
        let seq_abs = group.sequence_start + entry_data.sequence_index;
        if seq_abs >= group.sequence_end {
            group_log::log(format_args!(
                "runOneCompleted: the data did not know the sequence"
            ));
            return None;
        }
        let sequence = &self.sequences()[seq_abs];
        if i64::from(sequence.remaining_repeat_count.get()) != entry_data.remaining_repeat_count {
            group_log::log(format_args!(
                "runOneCompleted: the data is for a previous repeat count (outdated)",
            ));
            return None;
        }
        if sequence.active_entry.get() != Some(entry_data.entry) {
            group_log::log(format_args!(
                "runOneCompleted: the data is for a different sequence index (outdated)",
            ));
            return None;
        }
        group_log::log(format_args!(
            "runOneCompleted: the data is valid and current"
        ));
        Some((sequence, group))
    }

    fn advance_sequence(
        &self,
        buntest: &BunTest,
        sequence: &ExecutionSequence,
        group: &ConcurrentGroup,
    ) {
        let _g = group_begin!();

        debug_assert!(sequence.executing.get());
        if let Some(entry) = sequence.active_entry.get() {
            sequence.executing.set(false);
            if sequence.maybe_skip.get() {
                sequence.maybe_skip.set(false);
                sequence
                    .active_entry
                    .set(match self.failure_skip_past_of(entry) {
                        Some(failure_skip_past) => self.next_of(failure_skip_past),
                        None => None,
                    });
            } else {
                sequence.active_entry.set(self.next_of(entry));
            }
        } else {
            debug_assert!(false, "can't call advanceSequence on a completed sequence");
        }

        if sequence.active_entry.get().is_none() {
            // just completed the sequence
            let test_failed = sequence.result.get().is_fail();
            let test_passed = sequence.result.get().is_pass(PendingIs::PendingIsPass);

            // Handle retry logic: if test failed and we have retries remaining, retry it
            if test_failed && sequence.remaining_retry_count.get() > 0 {
                sequence
                    .remaining_retry_count
                    .set(sequence.remaining_retry_count.get() - 1);
                Execution::discard_junit_failure(buntest);
                self.reset_sequence(sequence);
                return;
            }

            // Handle repeat logic: if test passed and we have repeats remaining, repeat it
            if test_passed && sequence.remaining_repeat_count.get() > 0 {
                sequence
                    .remaining_repeat_count
                    .set(sequence.remaining_repeat_count.get() - 1);
                Execution::discard_junit_failure(buntest);
                self.reset_sequence(sequence);
                return;
            }

            // Only report the final result after all retries/repeats are done
            self.on_sequence_completed(buntest, sequence);

            // No more retries or repeats; mark sequence as complete
            let remaining = group.remaining_incomplete_entries.get();
            if remaining == 0 {
                debug_assert!(false); // remaining_incomplete_entries should never go below 0
                return;
            }
            group.remaining_incomplete_entries.set(remaining - 1);
        }
    }

    fn on_group_started(global_this: &JSGlobalObject) {
        global_this.bun_vm().as_mut().auto_killer.enable();
    }

    fn on_group_completed(global_this: &JSGlobalObject) {
        let vm = global_this.bun_vm().as_mut();
        // Under --isolate the swap between files kills and clears the tracked set.
        if !vm.test_isolation_enabled {
            vm.auto_killer.disable();
        }
    }

    fn on_sequence_started(&self, sequence: &ExecutionSequence) {
        let test_entry = sequence.test_entry.map(|id| self.entry(id));
        if let Some(entry) = &test_entry {
            if entry.callback.is_none() {
                return;
            }
        }

        sequence.started_at.set(Timespec::now_force_real_time());

        if let Some(entry) = &test_entry {
            scoped_log!(
                jest,
                "Running test: {:?}",
                // `BStr`'s `Debug` impl quotes and escapes for display.
                bstr::BStr::new(entry.base.name.as_deref().unwrap_or(b"(unnamed)"))
            );

            if entry.base.test_id_for_debugger.get() != 0 {
                if let Some(debugger) = VirtualMachine::get().as_mut().debugger.as_mut() {
                    if debugger.test_reporter_agent.is_enabled() {
                        debugger
                            .test_reporter_agent
                            .report_test_start(entry.base.test_id_for_debugger.get());
                    }
                }
            }
        }
    }

    fn on_entry_started(&self, id: EntryId, entry: &ExecutionEntry) {
        if entry.callback.is_none() {
            return;
        }

        let _g = group_begin!();
        if entry.timeout != 0 {
            group_log::log(format_args!("-> entry.timeout: {}", entry.timeout));
            self.set_timespec(
                id,
                Timespec::ms_from_now_force_real_time(entry.timeout as i64),
            );
        } else {
            group_log::log(format_args!("-> entry.timeout: 0"));
            self.set_timespec(id, Timespec::EPOCH);
        }
    }

    fn on_sequence_completed(&self, buntest: &BunTest, sequence: &ExecutionSequence) {
        let elapsed_ns: u64 = if sequence.started_at.get().eql(&Timespec::EPOCH) {
            0
        } else {
            sequence.started_at.get().since_now_force_real_time()
        };
        match sequence.expect_assertions.get() {
            ExpectAssertions::NotSet => {}
            ExpectAssertions::AtLeastOne => {
                if sequence.expect_call_count.get() == 0
                    && sequence.result.get().is_pass(PendingIs::PendingIsPass)
                {
                    sequence
                        .result
                        .set(Result::FailBecauseExpectedHasAssertions);
                }
            }
            ExpectAssertions::Exact(expected) => {
                if sequence.expect_call_count.get() != expected
                    && sequence.result.get().is_pass(PendingIs::PendingIsPass)
                {
                    sequence
                        .result
                        .set(Result::FailBecauseExpectedAssertionCount);
                }
            }
        }
        if sequence.result.get() == Result::Pending {
            sequence.result.set(match sequence.entry_mode(self) {
                ScopeMode::Failing => Result::FailBecauseFailingTestPassed,
                ScopeMode::Todo => Result::FailBecauseTodoPassed,
                _ => Result::Pass,
            });
        }
        if let Some(first_entry) = sequence.first_entry {
            if sequence.test_entry.is_some() || sequence.result.get() != Result::Pass {
                let reported = self.entry(sequence.test_entry.unwrap_or(first_entry));
                test_command::CommandLineReporter::handle_test_completed(
                    buntest, sequence, &reported, elapsed_ns,
                );
            }
        }

        if let Some(entry) = sequence.test_entry {
            let entry = self.entry(entry);
            if entry.base.test_id_for_debugger.get() != 0 {
                if let Some(debugger) = VirtualMachine::get().as_mut().debugger.as_mut() {
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

    /// Drop any captured failure so the next retry/repeat starts fresh.
    /// Kept out of `reset_sequence` so within-attempt errors (e.g. a throwing
    /// afterEach after the test body already threw) accumulate instead of
    /// clobbering the primary failure.
    fn discard_junit_failure(buntest: &BunTest) {
        if let Some(reporter) = buntest.reporter.get() {
            *reporter.test_failure.borrow_mut() = None;
        }
    }

    pub(crate) fn reset_sequence(&self, sequence: &ExecutionSequence) {
        debug_assert!(!sequence.executing.get());
        {
            // reset the entries
            let mut current_entry = sequence.first_entry;
            while let Some(entry) = current_entry {
                // remove entries that were added in the execution phase
                while let Some(next) = self.next_of(entry) {
                    if self.entry(next).added_in_phase != AddedInPhase::Execution {
                        break;
                    }
                    self.set_next(entry, self.next_of(next));
                    // can't drop the removed entry because it may still be referenced in a RefDataValue
                }
                self.set_timespec(entry, Timespec::EPOCH);
                current_entry = self.next_of(entry);
            }
        }

        // Preserve retry/repeat counts across reset
        sequence.reset();

        // Snapshot counters are keyed by full test name and incremented on every
        // toMatchSnapshot() call. Without this reset, retries / repeats would
        // increment the counter to N on attempt N and look for a key that does
        // not exist (https://github.com/oven-sh/bun/issues/23705).
        // Zeroing all entries matches Jest (SnapshotState.clear() on test_retry,
        // jestjs/jest#7493). Concurrent tests never touch the counts map — see
        // SnapshotInConcurrentGroup in expect.rs.
        if let Some(runner) = super::jest::Jest::runner() {
            runner.snapshots.borrow_mut().reset_counts();
        }
    }

    /// Mark `sequence` as timed out if the running entry's deadline passed.
    fn evaluate_timeout(
        &self,
        active_entry: EntryId,
        sequence: &ExecutionSequence,
        now: &Timespec,
    ) -> bool {
        let timespec = self.timespec_of(active_entry);
        if !timespec.eql(&Timespec::EPOCH) && timespec.order(now) == core::cmp::Ordering::Less {
            // timed out
            let is_test_entry = sequence.test_entry == Some(active_entry);
            let has_done_parameter = self.entry(active_entry).has_done_parameter;
            sequence.result.set(if is_test_entry {
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
            sequence.maybe_skip.set(true);
            return true;
        }
        false
    }

    pub(crate) fn handle_uncaught_exception(
        &self,
        user_data: &RefDataValue,
    ) -> HandleUncaughtExceptionResult {
        let _g = group_begin!();

        let Some((sequence, _group)) = self.get_current_and_valid_execution_sequence(user_data)
        else {
            return HandleUncaughtExceptionResult::ShowUnhandledErrorBetweenTests;
        };

        sequence.maybe_skip.set(true);
        if sequence.active_entry.get() != sequence.test_entry {
            // executing hook
            sequence.set_result_if_pending(Result::Fail);
            return HandleUncaughtExceptionResult::ShowHandledError;
        }

        match sequence.entry_mode(self) {
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
}

fn step_group(
    buntest: &BunTest,
    global_this: &JSGlobalObject,
    now: &mut Timespec,
) -> JsResult<StepResult> {
    let _g = group_begin!();
    let this = &buntest.execution;

    loop {
        let Some(group) = this.active_group() else {
            return Ok(StepResult::Complete);
        };
        if !group.executing.get() {
            Execution::on_group_started(global_this);
            group.executing.set(true);
        }

        // loop over items in the group and advance their execution

        let status = step_group_one(buntest, global_this, group, now)?;
        match status {
            AdvanceStatus::Execute { timeout } => {
                return Ok(StepResult::Waiting { timeout });
            }
            AdvanceStatus::Done => {}
        }

        group.executing.set(false);
        Execution::on_group_completed(global_this);

        // if there is one sequence and it failed, skip to the next group
        let all_failed = 'blk: {
            for sequence in group.sequences(this).iter() {
                if !sequence.result.get().is_fail() {
                    break 'blk false;
                }
            }
            true
        };

        if all_failed {
            group_log::log(format_args!(
                "stepGroup: all sequences failed, skipping to failure_skip_to group",
            ));
            this.group_index.set(group.failure_skip_to);
        } else {
            group_log::log(format_args!(
                "stepGroup: not all sequences failed, advancing to next group"
            ));
            this.group_index.set(this.group_index.get() + 1);
        }
    }
}

enum AdvanceStatus {
    Done,
    Execute { timeout: Timespec },
}

fn step_group_one(
    buntest: &BunTest,
    global_this: &JSGlobalObject,
    group: &ConcurrentGroup,
    now: &mut Timespec,
) -> JsResult<AdvanceStatus> {
    let mut final_status = AdvanceStatus::Done;
    let concurrent_limit: usize = if let Some(reporter) = buntest.reporter.get() {
        reporter.jest.max_concurrency as usize
    } else {
        debug_assert!(false); // probably can't get here because reporter is only set null when the file is exited
        20
    };
    let mut active_count: usize = 0;
    let len = group.sequence_end - group.sequence_start;
    for sequence_index in 0..len {
        let sequence_status = step_sequence(buntest, global_this, group, sequence_index, now)?;
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

enum AdvanceSequenceStatus {
    /// the entire sequence is completed.
    Done,
    /// the item is queued for execution or has not completed yet. need to wait for it
    Execute { timeout: Timespec },
}

fn step_sequence(
    buntest: &BunTest,
    global_this: &JSGlobalObject,
    group: &ConcurrentGroup,
    sequence_index: usize,
    now: &mut Timespec,
) -> JsResult<AdvanceSequenceStatus> {
    loop {
        if let Some(r) = step_sequence_one(buntest, global_this, group, sequence_index, now)? {
            return Ok(r);
        }
    }
}

/// returns None if the while loop should continue
fn step_sequence_one(
    buntest: &BunTest,
    global_this: &JSGlobalObject,
    group: &ConcurrentGroup,
    sequence_index: usize,
    now: &mut Timespec,
) -> JsResult<Option<AdvanceSequenceStatus>> {
    let _g = group_begin!();
    let this = &buntest.execution;

    let sequence = &group.sequences(this)[sequence_index];
    if sequence.executing.get() {
        let Some(active_entry) = sequence.active_entry.get() else {
            debug_assert!(false); // sequence is executing with no active entry
            return Ok(Some(AdvanceSequenceStatus::Execute {
                timeout: Timespec::EPOCH,
            }));
        };
        if this.evaluate_timeout(active_entry, sequence, now) {
            this.advance_sequence(buntest, sequence, group);
            return Ok(None); // run again
        }
        group_log::log(format_args!("runOne: can't advance; already executing"));
        return Ok(Some(AdvanceSequenceStatus::Execute {
            timeout: this.timespec_of(active_entry),
        }));
    }

    let Some(next_item_id) = sequence.active_entry.get() else {
        // Sequence is complete - either because:
        // 1. It ran out of entries (normal completion)
        // 2. All retry/repeat attempts have been exhausted
        group_log::log(format_args!("runOne: no more entries; sequence complete."));
        return Ok(Some(AdvanceSequenceStatus::Done));
    };
    let next_item = this.entry(next_item_id);
    sequence.executing.set(true);
    if Some(next_item_id) == sequence.first_entry {
        this.on_sequence_started(sequence);
    }
    this.on_entry_started(next_item_id, &next_item);

    if let Some(cb) = next_item.callback.as_ref() {
        group_log::log(format_args!("runSequence queued callback"));

        let entry_data = EntryData {
            sequence_index,
            entry: next_item_id,
            remaining_repeat_count: sequence.remaining_repeat_count.get() as i64,
        };
        let callback_data = RefDataValue::Execution {
            group_index: this.group_index.get(),
            entry_data: Some(entry_data),
        };
        group_log::log(format_args!(
            "runSequence queued callback: {}",
            callback_data
        ));

        let prev_on_stack = this.on_stack_entry.replace(Some(next_item_id));
        let prev_on_stack_data = this.on_stack_entry_data.replace(Some(entry_data));
        let _restore = scopeguard::guard((), move |()| {
            this.on_stack_entry.set(prev_on_stack);
            this.on_stack_entry_data.set(prev_on_stack_data);
        });

        let timeout = this.timespec_of(next_item_id);
        if buntest
            .run_test_callback(
                global_this,
                cb.get(),
                next_item.has_done_parameter,
                callback_data,
                &timeout,
            )
            .is_some()
        {
            *now = Timespec::now_force_real_time();
            let _ = this.evaluate_timeout(next_item_id, sequence, now);

            // the result is available immediately; advance the sequence and run again.
            this.advance_sequence(buntest, sequence, group);
            return Ok(None); // run again
        }
        Ok(Some(AdvanceSequenceStatus::Execute {
            timeout: this.timespec_of(next_item_id),
        }))
    } else {
        match next_item.base.mode {
            ScopeMode::Skip => sequence.set_result_if_pending(Result::Skip),
            ScopeMode::Todo => sequence.set_result_if_pending(Result::Todo),
            ScopeMode::FilteredOut => sequence.set_result_if_pending(Result::SkippedBecauseLabel),
            _ => {
                group_log::log(format_args!(
                    "runSequence: no callback for sequence_index {} (entry_index {:x})",
                    sequence_index,
                    next_item_id.index()
                ));
                debug_assert!(false);
            }
        }
        this.advance_sequence(buntest, sequence, group);
        Ok(None) // run again
    }
}
