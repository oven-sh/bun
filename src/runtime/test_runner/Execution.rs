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

use core::ptr::NonNull;
#[allow(unused_imports)] use crate::test_runner::expect::{JSValueTestExt, JSGlobalObjectTestExt, make_formatter};

use bun_core::{Timespec, TimespecMockMode};
use bun_jsc::{JSGlobalObject, JsResult};
// `bun_jsc::VirtualMachine` is the *module* re-export; the struct lives one level deeper.
use bun_jsc::virtual_machine::VirtualMachine;
use bun_core::scoped_log;

use super::debug::group as group_log; // bun_test.debug.group
use super::bun_test::{
    group_begin, AddedInPhase, BunTest, BunTestPtr, EntryData, ExecutionEntry,
    HandleUncaughtExceptionResult, Order, Phase, RefDataValue, ScopeMode, StepResult,
};
use crate::cli::test_command;

// ── local shims for upstream Timespec methods not yet ported ───────────────
// Zig: `bun.timespec.now(.force_real_time)` etc. — bun_core exposes the
// generic `now(mode)` form; wrap the convenience names here.
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

/// Convert the `Option<*mut ExecutionEntry>` linked-list field shape used by
/// [`ExecutionEntry`] into the `Option<NonNull<_>>` shape this module uses.
#[inline]
fn nn(p: Option<*mut ExecutionEntry>) -> Option<NonNull<ExecutionEntry>> {
    p.and_then(NonNull::new)
}

bun_core::declare_scope!(jest, visible);

pub struct Execution {
    pub groups: Box<[ConcurrentGroup]>,
    // PORT NOTE: was `pub(self)`; widened so `RefDataValue::sequence` can
    // split-borrow `groups`/`sequences` without re-entering `sequences_mut`.
    /// the entries themselves are owned by BunTest, which owns Execution.
    // Zig: `#sequences` (private field)
    pub sequences: Box<[ExecutionSequence]>,
    pub group_index: usize,
}

pub struct ConcurrentGroup {
    pub sequence_start: usize,
    pub sequence_end: usize,
    /// Index of the next sequence that has not been started yet
    pub next_sequence_index: usize,
    pub executing: bool,
    pub remaining_incomplete_entries: usize,
    /// used by beforeAll to skip directly to afterAll if it fails
    pub failure_skip_to: usize,
}

impl ConcurrentGroup {
    pub fn init(sequence_start: usize, sequence_end: usize, next_index: usize) -> ConcurrentGroup {
        ConcurrentGroup {
            sequence_start,
            sequence_end,
            executing: false,
            remaining_incomplete_entries: sequence_end - sequence_start,
            failure_skip_to: next_index,
            next_sequence_index: 0,
        }
    }

    pub fn try_extend(&mut self, next_sequence_start: usize, next_sequence_end: usize) -> bool {
        if self.sequence_end != next_sequence_start {
            return false;
        }
        self.sequence_end = next_sequence_end;
        self.remaining_incomplete_entries = self.sequence_end - self.sequence_start;
        true
    }

    pub fn sequences<'a>(&self, execution: &'a Execution) -> &'a [ExecutionSequence] {
        &execution.sequences[self.sequence_start..self.sequence_end]
    }

    pub fn sequences_mut<'a>(&self, execution: &'a mut Execution) -> &'a mut [ExecutionSequence] {
        &mut execution.sequences[self.sequence_start..self.sequence_end]
    }

    /// Immutable view of [`Self::sequences`] for read-only callers (e.g. debug dumps).
    pub fn sequences_const<'a>(&self, execution: &'a Execution) -> &'a [ExecutionSequence] {
        &execution.sequences[self.sequence_start..self.sequence_end]
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ExpectAssertions {
    NotSet,
    AtLeastOne,
    Exact(u32),
}

pub struct ExecutionSequence {
    pub first_entry: Option<NonNull<ExecutionEntry>>,
    /// Index into ExecutionSequence.entries() for the entry that is not started or currently running
    pub active_entry: Option<NonNull<ExecutionEntry>>,
    pub test_entry: Option<NonNull<ExecutionEntry>>,
    pub remaining_repeat_count: u32,
    pub remaining_retry_count: u32,
    pub flaky_attempt_count: usize,
    pub flaky_attempts_buf: [FlakyAttempt; ExecutionSequence::MAX_FLAKY_ATTEMPTS],
    pub result: Result,
    pub executing: bool,
    pub started_at: Timespec,
    /// Number of expect() calls observed in this sequence.
    pub expect_call_count: u32,
    /// Expectation set by expect.hasAssertions() or expect.assertions(n).
    pub expect_assertions: ExpectAssertions,
    pub maybe_skip: bool,
}

#[derive(Clone, Copy, Default)]
pub struct FlakyAttempt {
    pub result: Result,
    pub elapsed_ns: u64,
}

impl ExecutionSequence {
    pub const MAX_FLAKY_ATTEMPTS: usize = 16;

    pub fn init(
        first_entry: Option<NonNull<ExecutionEntry>>,
        test_entry: Option<NonNull<ExecutionEntry>>,
        retry_count: u32,
        repeat_count: u32,
    ) -> ExecutionSequence {
        ExecutionSequence {
            first_entry,
            active_entry: first_entry,
            test_entry,
            remaining_repeat_count: repeat_count,
            remaining_retry_count: retry_count,
            // defaults:
            flaky_attempt_count: 0,
            flaky_attempts_buf: [FlakyAttempt::default(); Self::MAX_FLAKY_ATTEMPTS],
            result: Result::Pending,
            executing: false,
            started_at: Timespec::EPOCH,
            expect_call_count: 0,
            expect_assertions: ExpectAssertions::NotSet,
            maybe_skip: false,
        }
    }

    pub fn flaky_attempts(&self) -> &[FlakyAttempt] {
        &self.flaky_attempts_buf[0..self.flaky_attempt_count]
    }

    fn entry_mode(&self) -> ScopeMode {
        if let Some(entry) = self.test_entry {
            // SAFETY: arena-owned entry, alive for the lifetime of BunTest which owns Execution
            return unsafe { entry.as_ref() }.base.mode;
        }
        ScopeMode::Normal
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Default, strum::IntoStaticStr)]
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
    pub fn basic_result(self) -> Basic {
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

    pub fn is_pass(self, pending_is: PendingIs) -> bool {
        match self.basic_result() {
            Basic::Pass | Basic::Skip | Basic::Todo => true,
            Basic::Fail => false,
            Basic::Pending => pending_is == PendingIs::PendingIsPass,
        }
    }

    pub fn is_fail(self) -> bool {
        !self.is_pass(PendingIs::PendingIsPass)
    }
}

// Recover the parent `BunTest` from `&mut self`. Returns `NonNull` (not
// `&mut BunTest`) because `self` *is* `BunTest.execution`, so materializing a
// `&mut BunTest` while `&mut self` is live would be aliased-`&mut` UB. Callers
// must dereference at point-of-use into disjoint fields only.
bun_core::impl_field_parent! { Execution => BunTest.execution; fn nonnull bun_test; }

impl Execution {
    pub fn init() -> Execution {
        Execution {
            groups: Box::default(),
            sequences: Box::default(),
            group_index: 0,
        }
    }

    // Zig `deinit` only freed `groups` and `#sequences` via the parent allocator.
    // Both are now `Box<[T]>` and drop automatically — no explicit Drop impl needed.

    pub fn load_from_order(&mut self, order: &mut Order::Order) -> JsResult<()> {
        debug_assert!(self.groups.is_empty());
        debug_assert!(self.sequences.is_empty());
        // Zig: bun.safety.CheckedAllocator asserts that order's lists used the same gpa.
        // In Rust the global allocator is unified — nothing to check.
        self.groups = core::mem::take(&mut order.groups).into_boxed_slice();
        self.sequences = core::mem::take(&mut order.sequences).into_boxed_slice();
        // TODO(port): narrow error set — Zig `try toOwnedSlice()` was OOM-only; Rust Vec→Box is infallible.
        Ok(())
    }

    pub fn handle_timeout(&mut self, global_this: &JSGlobalObject) -> JsResult<()> {
        let _g = group_begin!();

        // if the concurrent group has one sequence and the sequence has an active entry that has timed out,
        //   kill any dangling processes
        // when using test.concurrent(), we can't do this because it could kill multiple tests at once.
        if let Some(current_group) = self.active_group() {
            // PORT NOTE: reshaped for borrowck — capture range, drop &mut group, re-borrow sequences
            let (start, end) = (current_group.sequence_start, current_group.sequence_end);
            let sequences = &self.sequences[start..end];
            if sequences.len() == 1 {
                let sequence = &sequences[0];
                if let Some(entry) = sequence.active_entry {
                    // SAFETY: arena-owned entry, alive for lifetime of BunTest
                    let entry = unsafe { entry.as_ref() };
                    let now = Timespec::now_force_real_time();
                    if entry.timespec.order(&now) == core::cmp::Ordering::Less {
                        // SAFETY: bun_vm() returns the live per-thread VM.
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

        let buntest = self.bun_test();
        // SAFETY: deref parent at point-of-use; `self` is not accessed while this `&mut BunTest` is live.
        unsafe { (*buntest.as_ptr()).add_result(RefDataValue::Start) };
        Ok(())
    }

    pub fn step(
        buntest_strong: BunTestPtr,
        global_this: &JSGlobalObject,
        data: RefDataValue,
    ) -> JsResult<StepResult> {
        let _g = group_begin!();
        let buntest = buntest_strong.get();
        let buntest_ptr = NonNull::from(&mut *buntest);
        let this = &mut buntest.execution;
        let mut now = Timespec::now_force_real_time();

        match data {
            RefDataValue::Start => {
                return step_group(&buntest_strong, global_this, &mut now);
            }
            _ => {
                // determine the active sequence,group
                // advance the sequence
                // step the sequence
                // if the group is complete, step the group

                let Some((sequence_ptr, group_ptr)) =
                    this.get_current_and_valid_execution_sequence(&data)
                else {
                    group_log::log(format_args!(
                        "runOneCompleted: the data is outdated, invalid, or did not know the sequence",
                    ));
                    return Ok(StepResult::Waiting { timeout: Timespec::EPOCH });
                };
                let sequence_index = match &data {
                    RefDataValue::Execution { entry_data: Some(ed), .. } => ed.sequence_index,
                    // get_current_and_valid_execution_sequence returned Some ⇒ data is Execution with entry_data
                    _ => unreachable!(),
                };

                // PORT NOTE: `bun.Environment.ci_assert` → debug_assertions (no `ci_assert` Cargo feature in bun_runtime).
                // SAFETY: sequence_ptr points into this.sequences; valid while BunTest is alive.
                debug_assert!(unsafe { sequence_ptr.as_ref() }.active_entry.is_some());
                Execution::advance_sequence(buntest_ptr, sequence_ptr, group_ptr);

                let sequence_result =
                    step_sequence(&buntest_strong, global_this, group_ptr, sequence_index, &mut now)?;
                match sequence_result {
                    AdvanceSequenceStatus::Done => {}
                    AdvanceSequenceStatus::Execute { timeout } => {
                        return Ok(StepResult::Waiting { timeout });
                    }
                }
                // this sequence is complete; execute the next sequence
                // PORT NOTE: re-slice from `this` each iteration via the group's range; carry
                // `group` as NonNull so no `&mut ConcurrentGroup` aliases `&mut Execution`.
                loop {
                    // SAFETY: group_ptr points into this.groups (disjoint from this.sequences).
                    let group = unsafe { &mut *group_ptr.as_ptr() };
                    let seq_len = group.sequence_end - group.sequence_start;
                    if group.next_sequence_index >= seq_len {
                        break;
                    }
                    let next_idx = group.next_sequence_index;
                    let abs_idx = group.sequence_start + next_idx;
                    if this.sequences[abs_idx].executing {
                        group.next_sequence_index += 1;
                        continue;
                    }
                    let sequence_status =
                        step_sequence(&buntest_strong, global_this, group_ptr, next_idx, &mut now)?;
                    match sequence_status {
                        AdvanceSequenceStatus::Done => {
                            // SAFETY: see above
                            unsafe { &mut *group_ptr.as_ptr() }.next_sequence_index += 1;
                            continue;
                        }
                        AdvanceSequenceStatus::Execute { timeout } => {
                            return Ok(StepResult::Waiting { timeout });
                        }
                    }
                }
                // all sequences have started
                // SAFETY: see above
                if unsafe { group_ptr.as_ref() }.remaining_incomplete_entries == 0 {
                    return step_group(&buntest_strong, global_this, &mut now);
                }
                return Ok(StepResult::Waiting { timeout: Timespec::EPOCH });
            }
        }
    }

    pub fn active_group(&mut self) -> Option<&mut ConcurrentGroup> {
        if self.group_index >= self.groups.len() {
            return None;
        }
        Some(&mut self.groups[self.group_index])
    }

    /// Shared-borrow variant of [`active_group`] for read-only inspection
    /// (e.g. `BunTest::get_current_state_data`, which only reads).
    pub fn active_group_ref(&self) -> Option<&ConcurrentGroup> {
        if self.group_index >= self.groups.len() {
            return None;
        }
        Some(&self.groups[self.group_index])
    }

    /// Returns `NonNull` pointers (not `&mut`) into `self.sequences` / `self.groups` so the
    /// caller can hold both alongside other borrows of `self` without aliased-`&mut` UB.
    /// Dereference at point-of-use only.
    pub fn get_current_and_valid_execution_sequence(
        &mut self,
        data: &RefDataValue,
    ) -> Option<(NonNull<ExecutionSequence>, NonNull<ConcurrentGroup>)> {
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
        // Spec compares `this.activeGroup() != data.group(buntest)` by pointer; both index into
        // `self.groups`, so equality is exactly `group_index == self.group_index`. Comparing the
        // index avoids materializing a `&mut BunTest` that would alias `&mut self`.
        if self.group_index >= self.groups.len() || *group_index != self.group_index {
            group_log::log(format_args!("runOneCompleted: the data is for a different group"));
            return None;
        }
        if *group_index >= self.groups.len() {
            group_log::log(format_args!("runOneCompleted: the data did not know the group"));
            return None;
        }
        // Disjoint split-borrow of `self.groups` and `self.sequences`.
        let group = &mut self.groups[*group_index];
        let seq_abs = group.sequence_start + entry_data.sequence_index;
        if seq_abs >= group.sequence_end {
            group_log::log(format_args!("runOneCompleted: the data did not know the sequence"));
            return None;
        }
        let sequence = &mut self.sequences[seq_abs];
        if i64::from(sequence.remaining_repeat_count) != entry_data.remaining_repeat_count {
            group_log::log(format_args!(
                "runOneCompleted: the data is for a previous repeat count (outdated)",
            ));
            return None;
        }
        if sequence
            .active_entry
            .map_or(core::ptr::null(), |p| p.as_ptr() as *const ())
            != entry_data.entry
        {
            group_log::log(format_args!(
                "runOneCompleted: the data is for a different sequence index (outdated)",
            ));
            return None;
        }
        group_log::log(format_args!("runOneCompleted: the data is valid and current"));
        Some((NonNull::from(sequence), NonNull::from(group)))
    }

    /// `sequence` / `group` are carried as `NonNull` (raw-pointer semantics, matching the Zig
    /// spec's `*ExecutionSequence` / `*ConcurrentGroup`) because they point into
    /// `buntest.execution.{sequences,groups}` and would otherwise alias any live `&mut Execution`.
    fn advance_sequence(
        buntest: NonNull<BunTest>,
        sequence_ptr: NonNull<ExecutionSequence>,
        group_ptr: NonNull<ConcurrentGroup>,
    ) {
        let _g = group_begin!();

        // SAFETY: sequence_ptr / group_ptr point into disjoint fields of `buntest.execution`
        // (`sequences` vs `groups`); no `&mut Execution` is live in this scope.
        let sequence = unsafe { &mut *sequence_ptr.as_ptr() };

        debug_assert!(sequence.executing);
        if let Some(entry_ptr) = sequence.active_entry {
            // SAFETY: arena-owned entry, alive for lifetime of BunTest
            let entry = unsafe { entry_ptr.as_ref() };
            Execution::on_entry_completed(entry_ptr);

            sequence.executing = false;
            if sequence.maybe_skip {
                sequence.maybe_skip = false;
                sequence.active_entry = match entry.failure_skip_past {
                    // SAFETY: arena-owned entry
                    Some(failure_skip_past) => nn(unsafe { (*failure_skip_past).next }),
                    None => None,
                };
            } else {
                sequence.active_entry = nn(entry.next);
            }
        } else {
            // PORT NOTE: `bun.Environment.ci_assert` → debug_assertions (no `ci_assert` Cargo feature in bun_runtime).
            debug_assert!(false, "can't call advanceSequence on a completed sequence");
        }

        if sequence.active_entry.is_none() {
            // just completed the sequence
            let test_failed = sequence.result.is_fail();
            let test_passed = sequence.result.is_pass(PendingIs::PendingIsPass);

            // Handle retry logic: if test failed and we have retries remaining, retry it
            if test_failed && sequence.remaining_retry_count > 0 {
                if sequence.flaky_attempt_count < ExecutionSequence::MAX_FLAKY_ATTEMPTS {
                    let elapsed_ns: u64 = if sequence.started_at.eql(&Timespec::EPOCH) {
                        0
                    } else {
                        sequence.started_at.since_now_force_real_time()
                    };
                    sequence.flaky_attempts_buf[sequence.flaky_attempt_count] = FlakyAttempt {
                        result: sequence.result,
                        elapsed_ns,
                    };
                    sequence.flaky_attempt_count += 1;
                }
                sequence.remaining_retry_count -= 1;
                Execution::reset_sequence(sequence);
                return;
            }

            // Handle repeat logic: if test passed and we have repeats remaining, repeat it
            if test_passed && sequence.remaining_repeat_count > 0 {
                sequence.remaining_repeat_count -= 1;
                Execution::reset_sequence(sequence);
                return;
            }

            // Only report the final result after all retries/repeats are done
            Execution::on_sequence_completed(buntest, sequence);

            // No more retries or repeats; mark sequence as complete
            // SAFETY: group_ptr points into `buntest.execution.groups`, disjoint from `sequence`.
            let group = unsafe { &mut *group_ptr.as_ptr() };
            if group.remaining_incomplete_entries == 0 {
                debug_assert!(false); // remaining_incomplete_entries should never go below 0
                return;
            }
            group.remaining_incomplete_entries -= 1;
        }
    }

    fn on_group_started(global_this: &JSGlobalObject) {
        // SAFETY: bun_vm() returns the live per-thread VM.
        global_this.bun_vm().as_mut().auto_killer.enable();
    }

    fn on_group_completed(global_this: &JSGlobalObject) {
        // SAFETY: bun_vm() returns the live per-thread VM.
        global_this.bun_vm().as_mut().auto_killer.disable();
    }

    fn on_sequence_started(sequence: &mut ExecutionSequence) {
        if let Some(entry) = sequence.test_entry {
            // SAFETY: arena-owned entry
            if unsafe { entry.as_ref() }.callback.is_none() {
                return;
            }
        }

        sequence.started_at = Timespec::now_force_real_time();

        if let Some(entry_ptr) = sequence.test_entry {
            // SAFETY: arena-owned entry
            let entry = unsafe { entry_ptr.as_ref() };
            scoped_log!(
                jest,
                "Running test: \"{}\"",
                // TODO(port): std.zig.fmtString — escapes string for display; using BStr for now
                bstr::BStr::new(entry.base.name.as_deref().unwrap_or(b"(unnamed)"))
            );

            if entry.base.test_id_for_debugger != 0 {
                // SAFETY: VirtualMachine::get() returns the live singleton.
                if let Some(debugger) = VirtualMachine::get().as_mut().debugger.as_mut() {
                    if debugger.test_reporter_agent.is_enabled() {
                        debugger
                            .test_reporter_agent
                            .report_test_start(entry.base.test_id_for_debugger);
                    }
                }
            }
        }
    }

    fn on_entry_started(entry: &mut ExecutionEntry) {
        if entry.callback.is_none() {
            return;
        }

        let _g = group_begin!();
        if entry.timeout != 0 {
            group_log::log(format_args!("-> entry.timeout: {}", entry.timeout));
            entry.timespec = Timespec::ms_from_now_force_real_time(entry.timeout as i64);
        } else {
            group_log::log(format_args!("-> entry.timeout: 0"));
            entry.timespec = Timespec::EPOCH;
        }
    }

    fn on_entry_completed(_entry: NonNull<ExecutionEntry>) {}

    fn on_sequence_completed(buntest: NonNull<BunTest>, sequence: &mut ExecutionSequence) {
        let elapsed_ns: u64 = if sequence.started_at.eql(&Timespec::EPOCH) {
            0
        } else {
            sequence.started_at.since_now_force_real_time()
        };
        match sequence.expect_assertions {
            ExpectAssertions::NotSet => {}
            ExpectAssertions::AtLeastOne => {
                if sequence.expect_call_count == 0
                    && sequence.result.is_pass(PendingIs::PendingIsPass)
                {
                    sequence.result = Result::FailBecauseExpectedHasAssertions;
                }
            }
            ExpectAssertions::Exact(expected) => {
                if sequence.expect_call_count != expected
                    && sequence.result.is_pass(PendingIs::PendingIsPass)
                {
                    sequence.result = Result::FailBecauseExpectedAssertionCount;
                }
            }
        }
        if sequence.result == Result::Pending {
            sequence.result = match sequence.entry_mode() {
                ScopeMode::Failing => Result::FailBecauseFailingTestPassed,
                ScopeMode::Todo => Result::FailBecauseTodoPassed,
                _ => Result::Pass,
            };
        }
        if let Some(first_entry) = sequence.first_entry {
            if sequence.test_entry.is_some() || sequence.result != Result::Pass {
                // SAFETY: deref parent BunTest at point-of-use. `sequence` aliases
                // `buntest.execution.sequences[i]`; `handle_test_completed`'s signature still takes
                // both `&mut BunTest` and `&mut ExecutionSequence` (Phase B: reshape callee).
                test_command::CommandLineReporter::handle_test_completed(
                    unsafe { &mut *buntest.as_ptr() },
                    sequence,
                    // SAFETY: arena-owned entry, alive for lifetime of BunTest
                    unsafe { &mut *sequence.test_entry.unwrap_or(first_entry).as_ptr() },
                    elapsed_ns,
                );
            }
        }

        if let Some(entry_ptr) = sequence.test_entry {
            // SAFETY: arena-owned entry
            let entry = unsafe { entry_ptr.as_ref() };
            if entry.base.test_id_for_debugger != 0 {
                // SAFETY: VirtualMachine::get() returns the live singleton.
                if let Some(debugger) = VirtualMachine::get().as_mut().debugger.as_mut() {
                    if debugger.test_reporter_agent.is_enabled() {
                        use bun_jsc::Debugger::TestStatus as S;
                        debugger.test_reporter_agent.report_test_end(
                            entry.base.test_id_for_debugger,
                            match sequence.result {
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

    pub fn reset_sequence(sequence: &mut ExecutionSequence) {
        debug_assert!(!sequence.executing);
        {
            // reset the entries
            let mut current_entry = sequence.first_entry;
            while let Some(entry_ptr) = current_entry {
                // SAFETY: arena-owned entry, alive for lifetime of BunTest
                let entry = unsafe { &mut *entry_ptr.as_ptr() };
                // remove entries that were added in the execution phase
                while let Some(next) = entry.next {
                    // SAFETY: arena-owned entry
                    if unsafe { (*next).added_in_phase } != AddedInPhase::Execution {
                        break;
                    }
                    // SAFETY: arena-owned entry, alive for lifetime of BunTest
                    entry.next = unsafe { (*next).next };
                    // can't deinit the removed entry because it may still be referenced in a RefDataValue
                }
                entry.timespec = Timespec::EPOCH;
                current_entry = nn(entry.next);
            }
        }

        // Preserve retry/repeat counts and flaky attempt history across reset
        let saved_flaky_attempt_count = sequence.flaky_attempt_count;
        let saved_flaky_attempts_buf = sequence.flaky_attempts_buf;
        *sequence = ExecutionSequence::init(
            sequence.first_entry,
            sequence.test_entry,
            sequence.remaining_retry_count,
            sequence.remaining_repeat_count,
        );
        sequence.flaky_attempt_count = saved_flaky_attempt_count;
        sequence.flaky_attempts_buf = saved_flaky_attempts_buf;

        // Snapshot counters are keyed by full test name and incremented on every
        // toMatchSnapshot() call. Without this reset, retries / repeats would
        // increment the counter to N on attempt N and look for a key that does
        // not exist (https://github.com/oven-sh/bun/issues/23705).
        // Zeroing all entries matches Jest (SnapshotState.clear() on test_retry,
        // jestjs/jest#7493). Concurrent tests never touch the counts map — see
        // SnapshotInConcurrentGroup in expect.zig.
        if let Some(runner) = super::jest::Jest::runner() {
            runner.snapshots.reset_counts();
        }
    }

    pub fn handle_uncaught_exception(
        &mut self,
        user_data: &RefDataValue,
    ) -> HandleUncaughtExceptionResult {
        let _g = group_begin!();

        let Some((sequence_ptr, _group_ptr)) =
            self.get_current_and_valid_execution_sequence(user_data)
        else {
            return HandleUncaughtExceptionResult::ShowUnhandledErrorBetweenTests;
        };
        // SAFETY: sequence_ptr points into self.sequences; `self` is not accessed for the
        // remainder of this function, so this is the unique live `&mut` to that element.
        let sequence = unsafe { &mut *sequence_ptr.as_ptr() };

        sequence.maybe_skip = true;
        if sequence.active_entry != sequence.test_entry {
            // executing hook
            if sequence.result == Result::Pending {
                sequence.result = Result::Fail;
            }
            return HandleUncaughtExceptionResult::ShowHandledError;
        }

        match sequence.entry_mode() {
            ScopeMode::Failing => {
                if sequence.result == Result::Pending {
                    sequence.result = Result::Pass; // executing test() callback
                }
                HandleUncaughtExceptionResult::HideError // failing tests prevent the error from being displayed
            }
            ScopeMode::Todo => {
                if sequence.result == Result::Pending {
                    sequence.result = Result::Todo; // executing test() callback
                }
                HandleUncaughtExceptionResult::ShowHandledError // todo tests with --todo will still display the error
            }
            _ => {
                if sequence.result == Result::Pending {
                    sequence.result = Result::Fail;
                }
                HandleUncaughtExceptionResult::ShowHandledError
            }
        }
    }
}

pub fn step_group(
    buntest_strong: &BunTestPtr,
    global_this: &JSGlobalObject,
    now: &mut Timespec,
) -> JsResult<StepResult> {
    let _g = group_begin!();
    let buntest = buntest_strong.get();
    let this = &mut buntest.execution;

    loop {
        // Carry the active group as NonNull so it does not alias `&mut Execution` re-derived
        // inside step_group_one (Zig spec uses raw `*ConcurrentGroup`).
        let group_ptr: NonNull<ConcurrentGroup> = match this.active_group() {
            Some(g) => NonNull::from(g),
            None => return Ok(StepResult::Complete),
        };
        {
            // SAFETY: group_ptr points into this.groups; only this scope holds a `&mut` to it.
            let group = unsafe { &mut *group_ptr.as_ptr() };
            if !group.executing {
                Execution::on_group_started(global_this);
                group.executing = true;
            }
        }

        // loop over items in the group and advance their execution

        let status = step_group_one(buntest_strong, global_this, group_ptr, now)?;
        match status {
            AdvanceStatus::Execute { timeout } => {
                return Ok(StepResult::Waiting { timeout });
            }
            AdvanceStatus::Done => {}
        }

        // SAFETY: re-deref after step_group_one; disjoint from this.sequences read below.
        let group = unsafe { &mut *group_ptr.as_ptr() };
        group.executing = false;
        Execution::on_group_completed(global_this);

        // if there is one sequence and it failed, skip to the next group
        let (start, end, failure_skip_to) =
            (group.sequence_start, group.sequence_end, group.failure_skip_to);
        let all_failed = 'blk: {
            for sequence in this.sequences[start..end].iter() {
                if !sequence.result.is_fail() {
                    break 'blk false;
                }
            }
            true
        };

        if all_failed {
            group_log::log(format_args!(
                "stepGroup: all sequences failed, skipping to failure_skip_to group",
            ));
            this.group_index = failure_skip_to;
        } else {
            group_log::log(format_args!("stepGroup: not all sequences failed, advancing to next group"));
            this.group_index += 1;
        }
    }
}

enum AdvanceStatus {
    Done,
    Execute { timeout: Timespec },
}

fn step_group_one(
    buntest_strong: &BunTestPtr,
    global_this: &JSGlobalObject,
    group: NonNull<ConcurrentGroup>,
    now: &mut Timespec,
) -> JsResult<AdvanceStatus> {
    let buntest = buntest_strong.get();
    let mut final_status = AdvanceStatus::Done;
    let concurrent_limit: usize = if let Some(reporter) = buntest.reporter {
        // SAFETY: reporter outlives every BunTest (owned by test_command::exec).
        unsafe { reporter.as_ref() }.jest.max_concurrency as usize
    } else {
        debug_assert!(false); // probably can't get here because reporter is only set null when the file is exited
        20
    };
    let mut active_count: usize = 0;
    // SAFETY: group points into buntest.execution.groups; read-only here.
    let len = {
        let g = unsafe { group.as_ref() };
        g.sequence_end - g.sequence_start
    };
    for sequence_index in 0..len {
        let sequence_status =
            step_sequence(buntest_strong, global_this, group, sequence_index, now)?;
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
    buntest_strong: &BunTestPtr,
    global_this: &JSGlobalObject,
    group: NonNull<ConcurrentGroup>,
    sequence_index: usize,
    now: &mut Timespec,
) -> JsResult<AdvanceSequenceStatus> {
    loop {
        if let Some(r) =
            step_sequence_one(buntest_strong, global_this, group, sequence_index, now)?
        {
            return Ok(r);
        }
    }
}

/// returns None if the while loop should continue
fn step_sequence_one(
    buntest_strong: &BunTestPtr,
    global_this: &JSGlobalObject,
    group: NonNull<ConcurrentGroup>,
    sequence_index: usize,
    now: &mut Timespec,
) -> JsResult<Option<AdvanceSequenceStatus>> {
    let _g = group_begin!();
    let buntest = buntest_strong.get();
    let buntest_ptr = NonNull::from(&mut *buntest);
    let this = &mut buntest.execution;

    // Locate the sequence by absolute index, then carry it as NonNull so it can coexist with
    // `group` (disjoint field) and with later re-borrows through `buntest_ptr` in advance_sequence.
    // SAFETY: group points into this.groups; read-only.
    let seq_abs = unsafe { group.as_ref() }.sequence_start + sequence_index;
    let sequence_ptr: NonNull<ExecutionSequence> = NonNull::from(&mut this.sequences[seq_abs]);
    // SAFETY: sequence_ptr points into this.sequences; this is the unique live `&mut` to that
    // element until we hand it off to advance_sequence (which takes the NonNull, not the &mut).
    let sequence = unsafe { &mut *sequence_ptr.as_ptr() };
    if sequence.executing {
        let Some(active_entry_ptr) = sequence.active_entry else {
            debug_assert!(false); // sequence is executing with no active entry
            return Ok(Some(AdvanceSequenceStatus::Execute {
                timeout: Timespec::EPOCH,
            }));
        };
        // SAFETY: arena-owned entry
        let active_entry = unsafe { &mut *active_entry_ptr.as_ptr() };
        if active_entry.evaluate_timeout(sequence, now) {
            Execution::advance_sequence(buntest_ptr, sequence_ptr, group);
            return Ok(None); // run again
        }
        group_log::log(format_args!("runOne: can't advance; already executing"));
        return Ok(Some(AdvanceSequenceStatus::Execute {
            timeout: active_entry.timespec,
        }));
    }

    let Some(next_item_ptr) = sequence.active_entry else {
        // Sequence is complete - either because:
        // 1. It ran out of entries (normal completion)
        // 2. All retry/repeat attempts have been exhausted
        group_log::log(format_args!("runOne: no more entries; sequence complete."));
        return Ok(Some(AdvanceSequenceStatus::Done));
    };
    // SAFETY: arena-owned entry
    let next_item = unsafe { &mut *next_item_ptr.as_ptr() };
    sequence.executing = true;
    if Some(next_item_ptr) == sequence.first_entry {
        Execution::on_sequence_started(sequence);
    }
    Execution::on_entry_started(next_item);

    if let Some(cb) = next_item.callback.as_ref() {
        group_log::log(format_args!("runSequence queued callback"));

        let callback_data = RefDataValue::Execution {
            group_index: this.group_index,
            entry_data: Some(EntryData {
                sequence_index,
                entry: next_item_ptr.as_ptr() as *const (),
                remaining_repeat_count: sequence.remaining_repeat_count as i64,
            }),
        };
        group_log::log(format_args!("runSequence queued callback: {}", callback_data));

        if BunTest::run_test_callback(
            buntest_strong.clone(),
            global_this,
            cb.get(),
            next_item.has_done_parameter,
            callback_data,
            &next_item.timespec,
        )
        .is_some()
        {
            *now = Timespec::now_force_real_time();
            // SAFETY: re-deref after run_test_callback; sequence_ptr still valid (sequences is a
            // Box<[ExecutionSequence]>, never reallocated during execution).
            let sequence = unsafe { &mut *sequence_ptr.as_ptr() };
            let _ = next_item.evaluate_timeout(sequence, now);

            // the result is available immediately; advance the sequence and run again.
            Execution::advance_sequence(buntest_ptr, sequence_ptr, group);
            return Ok(None); // run again
        }
        return Ok(Some(AdvanceSequenceStatus::Execute {
            timeout: next_item.timespec,
        }));
    } else {
        match next_item.base.mode {
            ScopeMode::Skip => {
                if sequence.result == Result::Pending {
                    sequence.result = Result::Skip;
                }
            }
            ScopeMode::Todo => {
                if sequence.result == Result::Pending {
                    sequence.result = Result::Todo;
                }
            }
            ScopeMode::FilteredOut => {
                if sequence.result == Result::Pending {
                    sequence.result = Result::SkippedBecauseLabel;
                }
            }
            _ => {
                group_log::log(format_args!(
                    "runSequence: no callback for sequence_index {} (entry_index {:x})",
                    sequence_index,
                    sequence
                        .active_entry
                        .map_or(0, |p| p.as_ptr() as usize)
                ));
                debug_assert!(false);
            }
        }
        Execution::advance_sequence(buntest_ptr, sequence_ptr, group);
        return Ok(None); // run again
    }
}

// ported from: src/test_runner/Execution.zig
