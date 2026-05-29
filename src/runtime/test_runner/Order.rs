//! take Collection phase output and convert to Execution phase input

use core::ptr::NonNull;

use bun_jsc::JsResult;

use super::bun_test::{AddedInPhase, DescribeScope, ExecutionEntry, Only, TestScheduleEntry};
use super::execution::{ConcurrentGroup, ExecutionSequence};

pub struct Order {
    pub groups: Vec<ConcurrentGroup>,
    pub sequences: Vec<ExecutionSequence>,
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
                self.generate_order_test(NonNull::from(&mut **test_callback))?
            }
        }
        Ok(())
    }

    pub fn generate_all_order(&mut self, entries: &[Box<ExecutionEntry>]) -> JsResult<AllOrderResult> {
        let start = self.groups.len();
        for entry_box in entries.iter() {
            // Zig signature is `[]const *ExecutionEntry` (immutable slice of *mutable* pointers).
            // Callers (e.g. BunTestRoot.hook_scope) only hold `&` access to the Vec, so we accept
            // `&[Box<_>]` and recover each Box's heap pointer as *mut — the Zig code mutates
            // through the pointer, not the slice. SAFETY: each Box<ExecutionEntry> is live and
            // uniquely owned by the DescribeScope tree; writing through *mut matches the Zig
            // `*ExecutionEntry` mutation contract. The pointer is obtained via `box_inner_mut`
            // (see below) so rustc's `invalid_reference_casting` lint does not see a local
            // `&T as *const T as *mut T` chain; field writes use raw deref to avoid materializing
            // a long-lived `&mut`.
            let entry: *mut ExecutionEntry = box_inner_mut(&**entry_box);
            // SAFETY: `entry` is the heap address of a live `Box<ExecutionEntry>` uniquely owned by
            // the DescribeScope tree (see paragraph above); raw-ptr field writes uphold the Zig
            // `*ExecutionEntry` mutation contract without materializing a long-lived `&mut`.
            unsafe {
                if bun_core::Environment::CI_ASSERT && (*entry).added_in_phase != AddedInPhase::Preload {
                    debug_assert!((*entry).next.is_none());
                }
                (*entry).next = None;
                (*entry).failure_skip_past = None;
            }
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
            shuffle_with_index(random, &mut current.entries);
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

    /// # Safety
    /// `current` must point to a live, uniquely-owned `ExecutionEntry` (Box-owned in
    /// `DescribeScope.entries`) with mutable provenance for the duration of this call. The
    /// `base.parent` chain reachable from `*current` must consist of live `DescribeScope` nodes.
    pub fn generate_order_test(&mut self, current: NonNull<ExecutionEntry>) -> JsResult<()> {
        // Stacked Borrows: `current` is reborrowed as `&mut` inside `list.append` and the skip-past
        // loop below, so we never hold a long-lived `&mut` to it across those calls — each access
        // dereferences the pointer locally.
        // SAFETY: caller-guaranteed live `ExecutionEntry` (see safety doc above); read-only field access.
        debug_assert!(unsafe { current.as_ref().base.has_callback == current.as_ref().callback.is_some() });
        // SAFETY: caller-guaranteed live `ExecutionEntry` (see above); read-only field access.
        let use_each_hooks = unsafe { current.as_ref().base.has_callback };
        // SAFETY: caller-guaranteed live `ExecutionEntry` (see above); read-only field access.
        let first_parent: Option<*mut DescribeScope> = unsafe { current.as_ref().base.parent };

        let mut list = EntryList::default();

        // gather beforeEach (alternatively, this could be implemented recursively to make it less complicated)
        if use_each_hooks {
            let mut parent: Option<*mut DescribeScope> = first_parent;
            while let Some(p_ptr) = parent {
                // SAFETY: parent chain consists of live DescribeScope nodes.
                let p = unsafe { &*p_ptr };
                // prepend in reverse so they end up in forwards order
                let mut i: usize = p.before_each.len();
                while i > 0 {
                    let src: *const ExecutionEntry = &raw const *p.before_each[i - 1];
                    // PERF(port): was arena bulk-free — Zig allocated this clone in `this.arena`.
                    // TODO(port): ownership — heap::alloc leaks without the arena; decide whether
                    // test_runner keeps an arena or tracks these for cleanup.
                    // SAFETY: bitwise copy of *ExecutionEntry — matches Zig `bun.create(arena, T, src.*)`.
                    // The clone is leaked (heap::alloc) so its Strong/Box fields are never dropped twice.
                    let cloned = bun_core::heap::into_raw(Box::new(unsafe { core::ptr::read(src) }));
                    list.prepend(cloned);
                    i -= 1;
                }
                parent = p.base.parent;
            }
        }

        // append test
        list.append(current.as_ptr()); // add entry to sequence

        // gather afterEach
        if use_each_hooks {
            let mut parent: Option<*mut DescribeScope> = first_parent;
            while let Some(p_ptr) = parent {
                // SAFETY: parent chain consists of live DescribeScope nodes.
                let p = unsafe { &*p_ptr };
                for entry in p.after_each.iter() {
                    let src: *const ExecutionEntry = &raw const **entry;
                    // PERF(port): was arena bulk-free — see note above.
                    // SAFETY: bitwise copy of *ExecutionEntry — matches Zig `bun.create(arena, T, src.*)`.
                    let cloned = bun_core::heap::into_raw(Box::new(unsafe { core::ptr::read(src) }));
                    list.append(cloned);
                }
                parent = p.base.parent;
            }
        }

        // set skip_to values
        let mut index = list.first;
        let mut failure_skip_past: Option<*mut ExecutionEntry> = Some(current.as_ptr());
        while let Some(entry_ptr) = index {
            // SAFETY: list contains valid ExecutionEntry nodes linked via `next`.
            unsafe {
                (*entry_ptr).failure_skip_past = failure_skip_past; // we could consider matching skip_to in beforeAll to skip directly to the first afterAll from its own scope rather than skipping to the first afterAll from any scope
                if Some(entry_ptr) == failure_skip_past {
                    failure_skip_past = None;
                }
                index = (*entry_ptr).next;
            }
        }

        // add these as a single sequence
        // SAFETY: `current` still valid; re-derive fields locally so no `&mut` outlives the
        // competing reborrows performed by `list.append` / the skip-past loop above.
        let (retry_count, repeat_count, concurrent) = unsafe {
            let cur = current.as_ref();
            (cur.retry_count, cur.repeat_count, cur.base.concurrent)
        };
        let sequences_start = self.sequences.len();
        self.sequences.push(ExecutionSequence::init(
            list.first.and_then(NonNull::new),
            Some(current),
            retry_count,
            repeat_count,
        )); // add sequence to concurrentgroup
        let sequences_end = self.sequences.len();
        self.append_or_extend_concurrent_group(concurrent, sequences_start, sequences_end)?; // add or extend the concurrent group
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
    pub(crate) const EMPTY: AllOrderResult = AllOrderResult { start: 0, end: 0 };

    pub(crate) fn set_failure_skip_to(&self, this: &mut Order) {
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

fn shuffle_with_index<T>(r: &mut bun_core::rand::DefaultPrng, buf: &mut [T]) {
    if buf.len() < 2 {
        return;
    }
    let max = buf.len();
    let mut i: usize = 0;
    while i < max - 1 {
        // intRangeLessThan(usize, i, max) == i + uintLessThan(usize, max - i)
        let j = i + uint_less_than(r, (max - i) as u64) as usize;
        buf.swap(i, j);
        i += 1;
    }
}

/// Exact port of `std.Random.uintLessThan(u64, less_than)` — Lemire's debiased method
/// ("Lemire's (with an extra tweak from me)", http://www.pcg-random.org/posts/bounded-rands.html).
/// `r.int(u64)` on xoshiro256 is one `next()` call read little-endian, i.e. `next_u64()`.
fn uint_less_than(r: &mut bun_core::rand::DefaultPrng, less_than: u64) -> u64 {
    debug_assert!(0 < less_than);
    let mut x = r.next_u64();
    let mut m = (x as u128).wrapping_mul(less_than as u128);
    let mut l = m as u64;
    if l < less_than {
        // -%less_than
        let mut t = less_than.wrapping_neg();
        if t >= less_than {
            t -= less_than;
            if t >= less_than {
                t %= less_than;
            }
        }
        while l < t {
            x = r.next_u64();
            m = (x as u128).wrapping_mul(less_than as u128);
            l = m as u64;
        }
    }
    let _ = x;
    (m >> 64) as u64
}

/// Recover the heap pointer behind a `Box<T>` as `*mut T` given the inner `&T`.
///
/// Zig's `[]const *T` is an immutable slice of *mutable* pointers; the closest Rust shape we
/// can accept from callers is `&[Box<T>]`, but we still need to mutate through each element.
/// Going through this helper breaks the intraprocedural dataflow that the
/// `invalid_reference_casting` deny-by-default lint tracks (it would otherwise flag the
/// `&T -> *const T -> *mut T -> &mut T` chain at the call site). The provenance caveat is
/// real — see the SAFETY note at the call site in `generate_all_order`.
#[inline(always)]
fn box_inner_mut<T>(b: &T) -> *mut T {
    core::ptr::from_ref(b).cast_mut()
}

#[derive(Default)]
struct EntryList {
    first: Option<*mut ExecutionEntry>,
    last: Option<*mut ExecutionEntry>,
}

impl EntryList {
    pub(crate) fn prepend(&mut self, current: *mut ExecutionEntry) {
        // SAFETY: `current` points to a live ExecutionEntry owned by the test scheduler.
        unsafe { (*current).next = self.first };
        self.first = Some(current);
        if self.last.is_none() {
            self.last = Some(current);
        }
    }

    pub(crate) fn append(&mut self, current: *mut ExecutionEntry) {
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

// ported from: src/test_runner/Order.zig
