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

use bun_core::Timespec; // TODO(port): confirm crate path for bun.timespec
use bun_jsc::{JSGlobalObject, JsResult, VirtualMachine};
use bun_output::scoped_log;

use crate::debug::group as group_log; // bun_test.debug.group
use crate::{
    BunTest, BunTestPtr, ExecutionEntry, HandleUncaughtExceptionResult, Order, ScopeMode,
    StepResult,
};
use bun_cli::test_command;

bun_output::declare_scope!(jest, visible);

pub struct Execution {
    pub groups: Box<[ConcurrentGroup]>,
    /// the entries themselves are owned by BunTest, which owns Execution.
    // Zig: `#sequences` (private field)
    sequences: Box<[ExecutionSequence]>,
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

    pub fn sequences<'a>(&self, execution: &'a mut Execution) -> &'a mut [ExecutionSequence] {
        &mut execution.sequences[self.sequence_start..self.sequence_end]
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

#[derive(Clone, Copy)]
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
            // SAFETY: all-zero is a valid [FlakyAttempt; N] (Result is repr(u8) with 0 = pending, u64 is POD)
            flaky_attempts_buf: unsafe { core::mem::zeroed() },
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

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[repr(u8)]
pub enum Result {
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

    pub fn load_from_order(&mut self, order: &mut Order) -> JsResult<()> {
        debug_assert!(self.groups.is_empty());
        debug_assert!(self.sequences.is_empty());
        // Zig: bun.safety.CheckedAllocator asserts that order's lists used the same gpa.
        // In Rust the global allocator is unified — nothing to check.
        self.groups = core::mem::take(&mut order.groups).into_boxed_slice();
        self.sequences = core::mem::take(&mut order.sequences).into_boxed_slice();
        // TODO(port): narrow error set — Zig `try toOwnedSlice()` was OOM-only; Rust Vec→Box is infallible.
        Ok(())
    }

    fn bun_test(&mut self) -> &mut BunTest {
        // SAFETY: self points to BunTest.execution (Execution is only ever constructed embedded in BunTest)
        unsafe {
            &mut *(self as *mut Execution as *mut u8)
                .sub(core::mem::offset_of!(BunTest, execution))
                .cast::<BunTest>()
        }
    }

    pub fn handle_timeout(&mut self, global_this: &JSGlobalObject) -> JsResult<()> {
        let _scope = group_log::begin(); // TODO(port): groupLog.begin(@src())/end() scope tracing

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
                        let kill_count = global_this.bun_vm().auto_killer.kill();
                        if kill_count.processes > 0 {
                            bun_core::Output::pretty_errorln(format_args!(
                                "<d>killed {} dangling process{}<r>",
                                kill_count.processes,
                                if kill_count.processes != 1 { "es" } else { "" }
                            ));
                            bun_core::Output::flush();
                        }
                    }
                }
            }
        }

        self.bun_test().add_result(crate::RefDataValue::Start);
        Ok(())
    }

    pub fn step(
        buntest_strong: BunTestPtr,
        global_this: &JSGlobalObject,
        data: crate::bun_test::RefDataValue,
    ) -> JsResult<StepResult> {
        let _scope = group_log::begin();
        let buntest = buntest_strong.get();
        let this = &mut buntest.execution;
        let mut now = Timespec::now_force_real_time();

        match data {
            crate::bun_test::RefDataValue::Start => {
                return step_group(buntest_strong, global_this, &mut now);
            }
            _ => {
                // determine the active sequence,group
                // advance the sequence
                // step the sequence
                // if the group is complete, step the group

                let Some((sequence, group)) = this.get_current_and_valid_execution_sequence(&data)
                else {
                    group_log::log(
                        "runOneCompleted: the data is outdated, invalid, or did not know the sequence",
                    );
                    return Ok(StepResult::Waiting { timeout: None });
                };
                let sequence_index = data.execution().entry_data.unwrap().sequence_index;

                #[cfg(feature = "ci_assert")]
                debug_assert!(sequence.active_entry.is_some());
                this.advance_sequence(sequence, group);

                let sequence_result =
                    step_sequence(buntest_strong, global_this, group, sequence_index, &mut now)?;
                match sequence_result {
                    AdvanceSequenceStatus::Done => {}
                    AdvanceSequenceStatus::Execute { timeout } => {
                        return Ok(StepResult::Waiting {
                            timeout: Some(timeout),
                        });
                    }
                }
                // this sequence is complete; execute the next sequence
                // PORT NOTE: reshaped for borrowck — recompute slice each iteration
                while group.next_sequence_index < group.sequences(this).len() {
                    let target_sequence =
                        &mut group.sequences(this)[group.next_sequence_index];
                    if target_sequence.executing {
                        group.next_sequence_index += 1;
                        continue;
                    }
                    let sequence_status = step_sequence(
                        buntest_strong,
                        global_this,
                        group,
                        group.next_sequence_index,
                        &mut now,
                    )?;
                    match sequence_status {
                        AdvanceSequenceStatus::Done => {
                            group.next_sequence_index += 1;
                            continue;
                        }
                        AdvanceSequenceStatus::Execute { timeout } => {
                            return Ok(StepResult::Waiting {
                                timeout: Some(timeout),
                            });
                        }
                    }
                }
                // all sequences have started
                if group.remaining_incomplete_entries == 0 {
                    return step_group(buntest_strong, global_this, &mut now);
                }
                return Ok(StepResult::Waiting { timeout: None });
            }
        }
    }

    pub fn active_group(&mut self) -> Option<&mut ConcurrentGroup> {
        if self.group_index >= self.groups.len() {
            return None;
        }
        Some(&mut self.groups[self.group_index])
    }

    pub fn get_current_and_valid_execution_sequence(
        &mut self,
        data: &crate::bun_test::RefDataValue,
    ) -> Option<(&mut ExecutionSequence, &mut ConcurrentGroup)> {
        // TODO(port): borrowck — returns two &mut into disjoint self.groups / self.sequences
        // while also calling self.bun_test(); Phase B may need raw NonNull or split-borrow helper.
        let _scope = group_log::begin();

        group_log::log(format_args!("runOneCompleted: data: {}", data));

        let crate::bun_test::RefDataValue::Execution(exec) = data else {
            group_log::log("runOneCompleted: the data is not execution");
            return None;
        };
        if exec.entry_data.is_none() {
            group_log::log(
                "runOneCompleted: the data did not know which entry was active in the group",
            );
            return None;
        }
        let buntest: *mut BunTest = self.bun_test();
        // SAFETY: buntest derived from self via @fieldParentPtr; BunTest outlives Execution and is
        // uniquely accessed here (Phase B: revisit split-borrow once borrowck shape is settled).
        let buntest_ref = unsafe { &mut *buntest };
        if self.active_group().map(|g| g as *mut _) != data.group(buntest_ref).map(|g| g as *mut _) {
            group_log::log("runOneCompleted: the data is for a different group");
            return None;
        }
        let Some(group) = data.group(buntest_ref) else {
            group_log::log("runOneCompleted: the data did not know the group");
            return None;
        };
        let Some(sequence) = data.sequence(buntest_ref) else {
            group_log::log("runOneCompleted: the data did not know the sequence");
            return None;
        };
        let entry_data = exec.entry_data.as_ref().unwrap();
        if sequence.remaining_repeat_count != entry_data.remaining_repeat_count {
            group_log::log(
                "runOneCompleted: the data is for a previous repeat count (outdated)",
            );
            return None;
        }
        if sequence.active_entry.map(|p| p.as_ptr() as *mut core::ffi::c_void)
            != entry_data.entry.map(|p| p.as_ptr() as *mut core::ffi::c_void)
        {
            group_log::log(
                "runOneCompleted: the data is for a different sequence index (outdated)",
            );
            return None;
        }
        group_log::log("runOneCompleted: the data is valid and current");
        Some((sequence, group))
    }

    fn advance_sequence(&mut self, sequence: &mut ExecutionSequence, group: &mut ConcurrentGroup) {
        let _scope = group_log::begin();

        debug_assert!(sequence.executing);
        if let Some(entry_ptr) = sequence.active_entry {
            // SAFETY: arena-owned entry, alive for lifetime of BunTest
            let entry = unsafe { entry_ptr.as_ref() };
            self.on_entry_completed(entry_ptr);

            sequence.executing = false;
            if sequence.maybe_skip {
                sequence.maybe_skip = false;
                sequence.active_entry = match entry.failure_skip_past {
                    // SAFETY: arena-owned entry
                    Some(failure_skip_past) => unsafe { failure_skip_past.as_ref() }.next,
                    None => None,
                };
            } else {
                sequence.active_entry = entry.next;
            }
        } else {
            #[cfg(feature = "ci_assert")]
            debug_assert!(false); // can't call advanceSequence on a completed sequence
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
                self.reset_sequence(sequence);
                return;
            }

            // Handle repeat logic: if test passed and we have repeats remaining, repeat it
            if test_passed && sequence.remaining_repeat_count > 0 {
                sequence.remaining_repeat_count -= 1;
                self.reset_sequence(sequence);
                return;
            }

            // Only report the final result after all retries/repeats are done
            self.on_sequence_completed(sequence);

            // No more retries or repeats; mark sequence as complete
            if group.remaining_incomplete_entries == 0 {
                debug_assert!(false); // remaining_incomplete_entries should never go below 0
                return;
            }
            group.remaining_incomplete_entries -= 1;
        }
    }

    fn on_group_started(&mut self, _group: &mut ConcurrentGroup, global_this: &JSGlobalObject) {
        let vm = global_this.bun_vm();
        vm.auto_killer.enable();
    }

    fn on_group_completed(&mut self, _group: &mut ConcurrentGroup, global_this: &JSGlobalObject) {
        let vm = global_this.bun_vm();
        vm.auto_killer.disable();
    }

    fn on_sequence_started(&mut self, sequence: &mut ExecutionSequence) {
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
                if let Some(debugger) = VirtualMachine::get().debugger.as_mut() {
                    if debugger.test_reporter_agent.is_enabled() {
                        debugger
                            .test_reporter_agent
                            .report_test_start(entry.base.test_id_for_debugger);
                    }
                }
            }
        }
    }

    fn on_entry_started(&mut self, entry: &mut ExecutionEntry) {
        if entry.callback.is_none() {
            return;
        }

        let _scope = group_log::begin();
        if entry.timeout != 0 {
            group_log::log(format_args!("-> entry.timeout: {}", entry.timeout));
            entry.timespec = Timespec::ms_from_now_force_real_time(entry.timeout);
        } else {
            group_log::log("-> entry.timeout: 0");
            entry.timespec = Timespec::EPOCH;
        }
    }

    fn on_entry_completed(&mut self, _entry: NonNull<ExecutionEntry>) {}

    fn on_sequence_completed(&mut self, sequence: &mut ExecutionSequence) {
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
                test_command::CommandLineReporter::handle_test_completed(
                    self.bun_test(),
                    sequence,
                    sequence.test_entry.unwrap_or(first_entry),
                    elapsed_ns,
                );
            }
        }

        if let Some(entry_ptr) = sequence.test_entry {
            // SAFETY: arena-owned entry
            let entry = unsafe { entry_ptr.as_ref() };
            if entry.base.test_id_for_debugger != 0 {
                if let Some(debugger) = VirtualMachine::get().debugger.as_mut() {
                    if debugger.test_reporter_agent.is_enabled() {
                        use crate::TestReporterStatus as S; // TODO(port): confirm enum path for reportTestEnd status
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

    pub fn reset_sequence(&mut self, sequence: &mut ExecutionSequence) {
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
                    if unsafe { next.as_ref() }.added_in_phase != crate::Phase::Execution {
                        break;
                    }
                    // SAFETY: arena-owned entry, alive for lifetime of BunTest
                    entry.next = unsafe { next.as_ref() }.next;
                    // can't deinit the removed entry because it may still be referenced in a RefDataValue
                }
                entry.timespec = Timespec::EPOCH;
                current_entry = entry.next;
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
        if let Some(runner) = bun_jsc::Jest::runner() {
            runner.snapshots.reset_counts();
        }
        let _ = self;
    }

    pub fn handle_uncaught_exception(
        &mut self,
        user_data: crate::bun_test::RefDataValue,
    ) -> HandleUncaughtExceptionResult {
        let _scope = group_log::begin();

        let Some((sequence, group)) = self.get_current_and_valid_execution_sequence(&user_data)
        else {
            return HandleUncaughtExceptionResult::ShowUnhandledErrorBetweenTests;
        };
        let _ = group;

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
    buntest_strong: BunTestPtr,
    global_this: &JSGlobalObject,
    now: &mut Timespec,
) -> JsResult<StepResult> {
    let _scope = group_log::begin();
    let buntest = buntest_strong.get();
    let this = &mut buntest.execution;

    loop {
        let Some(group) = this.active_group() else {
            return Ok(StepResult::Complete);
        };
        // TODO(port): borrowck — `group` borrows `this.groups`; subsequent calls reborrow `this`.
        if !group.executing {
            this.on_group_started(group, global_this);
            group.executing = true;
        }

        // loop over items in the group and advance their execution

        let status = step_group_one(buntest_strong, global_this, group, now)?;
        match status {
            AdvanceStatus::Execute { timeout } => {
                return Ok(StepResult::Waiting {
                    timeout: Some(timeout),
                });
            }
            AdvanceStatus::Done => {}
        }

        group.executing = false;
        this.on_group_completed(group, global_this);

        // if there is one sequence and it failed, skip to the next group
        let all_failed = 'blk: {
            for sequence in group.sequences(this).iter() {
                if !sequence.result.is_fail() {
                    break 'blk false;
                }
            }
            true
        };

        if all_failed {
            group_log::log(
                "stepGroup: all sequences failed, skipping to failure_skip_to group",
            );
            this.group_index = group.failure_skip_to;
        } else {
            group_log::log("stepGroup: not all sequences failed, advancing to next group");
            this.group_index += 1;
        }
    }
}

enum AdvanceStatus {
    Done,
    Execute { timeout: Timespec },
}

fn step_group_one(
    buntest_strong: BunTestPtr,
    global_this: &JSGlobalObject,
    group: &mut ConcurrentGroup,
    now: &mut Timespec,
) -> JsResult<AdvanceStatus> {
    let buntest = buntest_strong.get();
    let this = &mut buntest.execution;
    let mut final_status = AdvanceStatus::Done;
    let concurrent_limit = if let Some(reporter) = buntest.reporter.as_ref() {
        reporter.jest.max_concurrency
    } else {
        debug_assert!(false); // probably can't get here because reporter is only set null when the file is exited
        20
    };
    let mut active_count: usize = 0;
    let len = group.sequences(this).len();
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
                    timeout: prev_timeout.min_ignore_epoch(this_timeout),
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
    buntest_strong: BunTestPtr,
    global_this: &JSGlobalObject,
    group: &mut ConcurrentGroup,
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
    buntest_strong: BunTestPtr,
    global_this: &JSGlobalObject,
    group: &mut ConcurrentGroup,
    sequence_index: usize,
    now: &mut Timespec,
) -> JsResult<Option<AdvanceSequenceStatus>> {
    let _scope = group_log::begin();
    let buntest = buntest_strong.get();
    let this = &mut buntest.execution;

    // TODO(port): borrowck — `sequence` borrows `this.sequences` while `this`/`group` are also used below.
    let sequence = &mut group.sequences(this)[sequence_index];
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
            this.advance_sequence(sequence, group);
            return Ok(None); // run again
        }
        group_log::log("runOne: can't advance; already executing");
        return Ok(Some(AdvanceSequenceStatus::Execute {
            timeout: active_entry.timespec,
        }));
    }

    let Some(next_item_ptr) = sequence.active_entry else {
        // Sequence is complete - either because:
        // 1. It ran out of entries (normal completion)
        // 2. All retry/repeat attempts have been exhausted
        group_log::log("runOne: no more entries; sequence complete.");
        return Ok(Some(AdvanceSequenceStatus::Done));
    };
    // SAFETY: arena-owned entry
    let next_item = unsafe { &mut *next_item_ptr.as_ptr() };
    sequence.executing = true;
    if Some(next_item_ptr) == sequence.first_entry {
        this.on_sequence_started(sequence);
    }
    this.on_entry_started(next_item);

    if let Some(cb) = next_item.callback.as_ref() {
        group_log::log("runSequence queued callback");

        let callback_data = crate::bun_test::RefDataValue::Execution(crate::bun_test::ExecutionRef {
            group_index: this.group_index,
            entry_data: Some(crate::bun_test::EntryData {
                sequence_index,
                entry: Some(next_item_ptr),
                remaining_repeat_count: sequence.remaining_repeat_count,
            }),
        });
        group_log::log(format_args!("runSequence queued callback: {}", callback_data));

        if BunTest::run_test_callback(
            buntest_strong,
            global_this,
            cb.get(),
            next_item.has_done_parameter,
            callback_data,
            &mut next_item.timespec,
        )
        .is_some()
        {
            *now = Timespec::now_force_real_time();
            let _ = next_item.evaluate_timeout(sequence, now);

            // the result is available immediately; advance the sequence and run again.
            this.advance_sequence(sequence, group);
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
        this.advance_sequence(sequence, group);
        return Ok(None); // run again
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/Execution.zig (694 lines)
//   confidence: medium
//   todos:      8
//   notes:      Heavy aliasing of &mut self/&mut group/&mut sequence will need borrowck reshaping in Phase B; groupLog begin/end scope tracing stubbed; RefDataValue/ExecutionRef/EntryData/StepResult/Timespec method names guessed.
// ──────────────────────────────────────────────────────────────────────────
