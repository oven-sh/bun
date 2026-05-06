//! take Collection phase output and convert to Execution phase input

use core::ptr::NonNull;

use bun_jsc::JsResult;

use super::bun_test::{AddedInPhase, DescribeScope, ExecutionEntry, Only, TestScheduleEntry};
use super::execution::{ConcurrentGroup, ExecutionSequence};

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

    pub fn generate_order_sub(&mut self, current: &mut TestScheduleEntry) -> JsResult<()> {
        match current {
            TestScheduleEntry::Describe(describe) => self.generate_order_describe(describe)?,
            TestScheduleEntry::TestCallback(test_callback) => {
                self.generate_order_test(&mut **test_callback as *mut ExecutionEntry)?
            }
        }
        Ok(())
    }

    pub fn generate_all_order(&mut self, entries: &[Box<ExecutionEntry>]) -> JsResult<AllOrderResult> {
        let start = self.groups.len();
        for entry_box in entries {
            // SAFETY: intrusive-list pattern — entries are arena-style Box-owned by DescribeScope and
            // outlive Order; Zig mutated through `*ExecutionEntry`, we cast away const to match.
            let entry: *mut ExecutionEntry = (&**entry_box) as *const ExecutionEntry as *mut ExecutionEntry;
            // SAFETY: `entry` is a valid live ExecutionEntry (Box-owned by caller's DescribeScope).
            let entry_ref = unsafe { &mut *entry };
            if bun_core::Environment::CI_ASSERT && entry_ref.added_in_phase != AddedInPhase::Preload {
                debug_assert!(entry_ref.next.is_none());
            }
            entry_ref.next = None;
            entry_ref.failure_skip_past = None;
            let sequences_start = self.sequences.len();
            self.sequences.push(ExecutionSequence::init(
                NonNull::new(entry),
                None,
                0,
                0,
            )); // add sequence to concurrentgroup
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
        if let Some(random) = self.cfg.randomize.as_mut() {
            // Fisher-Yates shuffle — port of `std.Random.shuffle(TestScheduleEntry, items)`.
            let items = &mut current.entries;
            let mut i = items.len();
            while i > 1 {
                i -= 1;
                // uintLessThan(i+1) — modulo bias is acceptable here (Zig's stdlib also biases for non-pow2).
                let j = (random.next_u64() % (i as u64 + 1)) as usize;
                items.swap(i, j);
            }
        }

        // gather children
        // PORT NOTE: reshaped for borrowck — iterate by index since generate_order_sub borrows &mut self.
        let scope_only = current.base.only;
        for i in 0..current.entries.len() {
            if scope_only == Only::Contains && current.entries[i].base().only == Only::No {
                continue;
            }
            self.generate_order_sub(&mut current.entries[i])?;
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
        // SAFETY: caller guarantees `current` is a valid live ExecutionEntry (Box-owned in DescribeScope.entries).
        let cur = unsafe { &mut *current };
        debug_assert!(cur.base.has_callback == cur.callback.is_some());
        let use_each_hooks = cur.base.has_callback;

        let mut list = EntryList::default();

        // gather beforeEach (alternatively, this could be implemented recursively to make it less complicated)
        if use_each_hooks {
            let mut parent: Option<*const DescribeScope> = cur.base.parent;
            while let Some(p_ptr) = parent {
                // SAFETY: parent chain consists of live DescribeScope nodes.
                let p = unsafe { &*p_ptr };
                // prepend in reverse so they end up in forwards order
                let mut i: usize = p.before_each.len();
                while i > 0 {
                    // PERF(port): was arena bulk-free — Zig allocated this clone in `this.arena`.
                    // TODO(port): ownership — Box::into_raw leaks without the arena; Phase B must
                    // decide whether test_runner keeps an arena or tracks these for cleanup.
                    // SAFETY: bitwise copy of *ExecutionEntry — matches Zig `bun.create(arena, T, src.*)`.
                    // The clone is leaked (Box::into_raw) so its Strong/Box fields are never dropped twice.
                    let src: *const ExecutionEntry = &*p.before_each[i - 1];
                    let cloned = Box::into_raw(Box::new(unsafe { core::ptr::read(src) }));
                    list.prepend(cloned);
                    i -= 1;
                }
                parent = p.base.parent;
            }
        }

        // append test
        list.append(current); // add entry to sequence

        // gather afterEach
        if use_each_hooks {
            let mut parent: Option<*const DescribeScope> = cur.base.parent;
            while let Some(p_ptr) = parent {
                // SAFETY: parent chain consists of live DescribeScope nodes.
                let p = unsafe { &*p_ptr };
                for entry in p.after_each.iter() {
                    // PERF(port): was arena bulk-free — see note above.
                    // SAFETY: bitwise copy of *ExecutionEntry — matches Zig `bun.create(arena, T, src.*)`.
                    let src: *const ExecutionEntry = &**entry;
                    let cloned = Box::into_raw(Box::new(unsafe { core::ptr::read(src) }));
                    list.append(cloned);
                }
                parent = p.base.parent;
            }
        }

        // set skip_to values
        let mut index = list.first;
        let mut failure_skip_past: Option<*mut ExecutionEntry> = Some(current);
        while let Some(entry_ptr) = index {
            // SAFETY: list contains valid ExecutionEntry nodes linked via `next`.
            let entry = unsafe { &mut *entry_ptr };
            entry.failure_skip_past = failure_skip_past; // we could consider matching skip_to in beforeAll to skip directly to the first afterAll from its own scope rather than skipping to the first afterAll from any scope
            if Some(entry_ptr) == failure_skip_past {
                failure_skip_past = None;
            }
            index = entry.next;
        }

        // add these as a single sequence
        let sequences_start = self.sequences.len();
        self.sequences.push(ExecutionSequence::init(
            list.first.and_then(NonNull::new),
            NonNull::new(current),
            cur.retry_count,
            cur.repeat_count,
        )); // add sequence to concurrentgroup
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
    // TODO(port): `std.Random` interface mapped to the concrete `DefaultPrng` (xoshiro256++);
    // bun_core has no type-erased Random vtable yet and the only call site seeds a DefaultPrng.
    pub randomize: Option<bun_core::rand::DefaultPrng>,
}

#[derive(Default)]
struct EntryList {
    first: Option<*mut ExecutionEntry>,
    last: Option<*mut ExecutionEntry>,
}

impl EntryList {
    pub fn prepend(&mut self, current: *mut ExecutionEntry) {
        // SAFETY: `current` points to a live ExecutionEntry owned by the test scheduler.
        unsafe { (*current).next = self.first };
        self.first = Some(current);
        if self.last.is_none() {
            self.last = Some(current);
        }
    }

    pub fn append(&mut self, current: *mut ExecutionEntry) {
        // SAFETY: `current` points to a live ExecutionEntry owned by the test scheduler.
        let cur = unsafe { &mut *current };
        if bun_core::Environment::CI_ASSERT && cur.added_in_phase != AddedInPhase::Preload {
            debug_assert!(cur.next.is_none());
        }
        cur.next = None;
        if let Some(last) = self.last {
            // SAFETY: `last` was stored by a prior prepend/append and is still live.
            let last_ref = unsafe { &mut *last };
            if bun_core::Environment::CI_ASSERT && last_ref.added_in_phase != AddedInPhase::Preload {
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/Order.zig (186 lines)
//   confidence: medium
//   todos:      3
//   notes:      arena field dropped per non-AST rule; ExecutionEntry clones now Box::into_raw via ptr::read (leak risk) — Phase B must restore arena or add cleanup. Intrusive list uses Option<*mut> to match bun_test::ExecutionEntry.{next,failure_skip_past}. std.Random mapped to concrete DefaultPrng with inline Fisher-Yates shuffle.
// ──────────────────────────────────────────────────────────────────────────
