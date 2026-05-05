//! take Collection phase output and convert to Execution phase input

use core::ptr::NonNull;

use bun_jsc::JsResult;

use crate::execution::{ConcurrentGroup, ExecutionSequence};
use crate::{DescribeScope, ExecutionEntry, TestScheduleEntry};
// TODO(port): `std.Random` has no mapping in the crate map; placeholder type.
use bun_core::Random;

pub struct Order {
    pub groups: Vec<ConcurrentGroup>,
    pub sequences: Vec<ExecutionSequence>,
    // TODO(port): Zig stored `arena: std.mem.Allocator` here. test_runner is not an
    // AST/arena crate per PORTING.md, so the field is dropped and `bun.create(arena, ...)`
    // calls below become `Box::into_raw(Box::new(...))`. In Zig these ExecutionEntry
    // clones were bulk-freed by the arena; revisit ownership in Phase B.
    pub previous_group_was_concurrent: bool,
    pub cfg: Config,
}

impl Order {
    pub fn init(cfg: Config) -> Order {
        Order {
            groups: Vec::new(),
            sequences: Vec::new(),
            cfg,
            previous_group_was_concurrent: false,
        }
    }
    // `deinit` only freed `groups` / `sequences` — handled by Drop on Vec; no impl Drop needed.

    pub fn generate_order_sub(&mut self, current: TestScheduleEntry) -> JsResult<()> {
        match current {
            TestScheduleEntry::Describe(describe) => self.generate_order_describe(describe)?,
            TestScheduleEntry::TestCallback(test_callback) => {
                self.generate_order_test(test_callback)?
            }
        }
        Ok(())
    }

    pub fn generate_all_order(&mut self, entries: &[*mut ExecutionEntry]) -> JsResult<AllOrderResult> {
        let start = self.groups.len();
        for &entry in entries {
            // SAFETY: caller guarantees `entry` is a valid live ExecutionEntry (intrusive list node).
            let entry_ref = unsafe { &mut *entry };
            if bun_core::Environment::CI_ASSERT && entry_ref.added_in_phase != Phase::Preload {
                debug_assert!(entry_ref.next.is_none());
            }
            entry_ref.next = None;
            entry_ref.failure_skip_past = None;
            let sequences_start = self.sequences.len();
            self.sequences.push(ExecutionSequence::init(execution::SequenceInit {
                first_entry: Some(NonNull::new(entry).expect("non-null")),
                test_entry: None,
                ..Default::default()
            })); // add sequence to concurrentgroup
            let sequences_end = self.sequences.len();
            let failure_skip_to = self.groups.len() + 1;
            self.groups
                .push(ConcurrentGroup::init(sequences_start, sequences_end, failure_skip_to)); // add a new concurrentgroup to order
            self.previous_group_was_concurrent = false;
        }
        let end = self.groups.len();
        Ok(AllOrderResult { start, end })
    }

    pub fn generate_order_describe(&mut self, current: &mut DescribeScope) -> JsResult<()> {
        if current.failed {
            return Ok(()); // do not schedule any tests in a failed describe scope
        }
        let use_hooks = self.cfg.always_use_hooks || current.base.has_callback;

        // gather beforeAll
        let beforeall_order: AllOrderResult = if use_hooks {
            self.generate_all_order(&current.before_all)?
        } else {
            AllOrderResult::EMPTY
        };

        // shuffle entries if randomize flag is set
        if let Some(random) = &self.cfg.randomize {
            random.shuffle(&mut current.entries);
        }

        // gather children
        // PORT NOTE: reshaped for borrowck — iterate by index since generate_order_sub borrows &mut self.
        for i in 0..current.entries.len() {
            let entry = current.entries[i];
            if current.base.only == Only::Contains && entry.base().only == Only::No {
                continue;
            }
            self.generate_order_sub(entry)?;
        }

        // update skip_to values for beforeAll to skip to the first afterAll
        beforeall_order.set_failure_skip_to(self);

        // gather afterAll
        let afterall_order: AllOrderResult = if use_hooks {
            self.generate_all_order(&current.after_all)?
        } else {
            AllOrderResult::EMPTY
        };

        // update skip_to values for afterAll to skip the remaining afterAll items
        afterall_order.set_failure_skip_to(self);

        Ok(())
    }

    pub fn generate_order_test(&mut self, current: *mut ExecutionEntry) -> JsResult<()> {
        // SAFETY: caller guarantees `current` is a valid live ExecutionEntry (intrusive list node).
        let cur = unsafe { &mut *current };
        // SAFETY: caller guarantees `current` is non-null (same invariant as above).
        let current_nn = unsafe { NonNull::new_unchecked(current) };
        debug_assert!(cur.base.has_callback == cur.callback.is_some());
        let use_each_hooks = cur.base.has_callback;

        let mut list = EntryList::default();

        // gather beforeEach (alternatively, this could be implemented recursively to make it less complicated)
        if use_each_hooks {
            let mut parent: Option<NonNull<DescribeScope>> = cur.base.parent;
            while let Some(p_ptr) = parent {
                // SAFETY: parent chain consists of live DescribeScope nodes.
                let p = unsafe { p_ptr.as_ref() };
                // prepend in reverse so they end up in forwards order
                let mut i: usize = p.before_each.len();
                while i > 0 {
                    // PERF(port): was arena bulk-free — Zig allocated this clone in `this.arena`.
                    // TODO(port): ownership — Box::into_raw leaks without the arena; Phase B must
                    // decide whether test_runner keeps an arena or tracks these for cleanup.
                    // SAFETY: before_each[i-1] is a valid *ExecutionEntry; we clone its pointee.
                    let cloned = Box::into_raw(Box::new(unsafe { (*p.before_each[i - 1]).clone() }));
                    // SAFETY: Box::into_raw never returns null.
                    list.prepend(unsafe { NonNull::new_unchecked(cloned) });
                    i -= 1;
                }
                parent = p.base.parent;
            }
        }

        // append test
        list.append(current_nn); // add entry to sequence

        // gather afterEach
        if use_each_hooks {
            let mut parent: Option<NonNull<DescribeScope>> = cur.base.parent;
            while let Some(p_ptr) = parent {
                // SAFETY: parent chain consists of live DescribeScope nodes.
                let p = unsafe { p_ptr.as_ref() };
                for &entry in p.after_each.iter() {
                    // PERF(port): was arena bulk-free — see note above.
                    // SAFETY: entry is a valid *ExecutionEntry; we clone its pointee.
                    let cloned = Box::into_raw(Box::new(unsafe { (*entry).clone() }));
                    // SAFETY: Box::into_raw never returns null.
                    list.append(unsafe { NonNull::new_unchecked(cloned) });
                }
                parent = p.base.parent;
            }
        }

        // set skip_to values
        let mut index = list.first;
        let mut failure_skip_past: Option<NonNull<ExecutionEntry>> = Some(current_nn);
        while let Some(entry_ptr) = index {
            // SAFETY: list contains valid ExecutionEntry nodes linked via `next`.
            let entry = unsafe { &mut *entry_ptr.as_ptr() };
            entry.failure_skip_past = failure_skip_past; // we could consider matching skip_to in beforeAll to skip directly to the first afterAll from its own scope rather than skipping to the first afterAll from any scope
            if Some(entry_ptr) == failure_skip_past {
                failure_skip_past = None;
            }
            index = entry.next;
        }

        // add these as a single sequence
        let sequences_start = self.sequences.len();
        self.sequences.push(ExecutionSequence::init(execution::SequenceInit {
            first_entry: list.first,
            test_entry: Some(current_nn),
            retry_count: cur.retry_count,
            repeat_count: cur.repeat_count,
        })); // add sequence to concurrentgroup
        let sequences_end = self.sequences.len();
        self.append_or_extend_concurrent_group(cur.base.concurrent, sequences_start, sequences_end)?; // add or extend the concurrent group
        Ok(())
    }

    pub fn append_or_extend_concurrent_group(
        &mut self,
        concurrent: bool,
        sequences_start: usize,
        sequences_end: usize,
    ) -> JsResult<()> {
        // PORT NOTE: reshaped for borrowck — Zig used `defer this.previous_group_was_concurrent = concurrent;`.
        // We capture the old value first, then assign immediately so it applies on every exit path.
        let prev_was_concurrent = self.previous_group_was_concurrent;
        self.previous_group_was_concurrent = concurrent;

        if concurrent && !self.groups.is_empty() {
            let previous_group = self.groups.last_mut().expect("non-empty");
            if prev_was_concurrent {
                // extend the previous group to include this sequence
                if previous_group.try_extend(sequences_start, sequences_end) {
                    return Ok(());
                }
            }
        }
        let failure_skip_to = self.groups.len() + 1;
        self.groups
            .push(ConcurrentGroup::init(sequences_start, sequences_end, failure_skip_to)); // otherwise, add a new concurrentgroup to order
        Ok(())
    }
}

pub struct AllOrderResult {
    pub start: usize,
    pub end: usize,
}

impl AllOrderResult {
    pub const EMPTY: AllOrderResult = AllOrderResult { start: 0, end: 0 };

    pub fn set_failure_skip_to(&self, this: &mut Order) {
        if self.start == 0 && self.end == 0 {
            return;
        }
        let skip_to = this.groups.len();
        for group in &mut this.groups[self.start..self.end] {
            group.failure_skip_to = skip_to;
        }
    }
}

pub struct Config {
    pub always_use_hooks: bool,
    pub randomize: Option<Random>,
}

#[derive(Default)]
struct EntryList {
    first: Option<NonNull<ExecutionEntry>>,
    last: Option<NonNull<ExecutionEntry>>,
}

impl EntryList {
    pub fn prepend(&mut self, current: NonNull<ExecutionEntry>) {
        // SAFETY: `current` points to a live ExecutionEntry owned by the test scheduler.
        unsafe { (*current.as_ptr()).next = self.first };
        self.first = Some(current);
        if self.last.is_none() {
            self.last = Some(current);
        }
    }

    pub fn append(&mut self, current: NonNull<ExecutionEntry>) {
        // SAFETY: `current` points to a live ExecutionEntry owned by the test scheduler.
        let cur = unsafe { &mut *current.as_ptr() };
        if bun_core::Environment::CI_ASSERT && cur.added_in_phase != Phase::Preload {
            debug_assert!(cur.next.is_none());
        }
        cur.next = None;
        if let Some(last) = self.last {
            // SAFETY: `last` was stored by a prior prepend/append and is still live.
            let last_ref = unsafe { &mut *last.as_ptr() };
            if bun_core::Environment::CI_ASSERT && last_ref.added_in_phase != Phase::Preload {
                debug_assert!(last_ref.next.is_none());
            }
            last_ref.next = Some(current);
            self.last = Some(current);
        } else {
            self.first = Some(current);
            self.last = Some(current);
        }
    }
}

// TODO(port): `Phase::Preload` / `Only::{Contains,No}` / `execution::SequenceInit` are referenced
// from sibling modules in `bun_test_runner`; exact paths to be wired in Phase B.
use crate::execution;
use crate::{Only, Phase};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/Order.zig (186 lines)
//   confidence: medium
//   todos:      4
//   notes:      arena field dropped per non-AST rule; ExecutionEntry clones now Box::into_raw (leak risk) — Phase B must restore arena or add cleanup. Intrusive list uses NonNull per LIFETIMES.tsv.
// ──────────────────────────────────────────────────────────────────────────
