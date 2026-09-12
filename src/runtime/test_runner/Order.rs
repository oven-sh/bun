//! take Collection phase output and convert to Execution phase input

use std::rc::Rc;

use bun_jsc::JsResult;

use super::bun_test::{DescribeScope, ExecutionEntry, Only, TestScheduleEntry};
use super::execution::{ConcurrentGroup, EntryId, EntryNode, ExecutionSequence};

pub(crate) struct Order {
    pub(crate) groups: Vec<ConcurrentGroup>,
    pub(crate) sequences: Vec<ExecutionSequence>,
    pub(crate) nodes: Vec<EntryNode>,
    pub(crate) previous_group_was_concurrent: bool,
    pub(crate) cfg: Config,
}

impl Order {
    pub(crate) fn init(cfg: Config) -> Order {
        Order {
            groups: Vec::new(),
            sequences: Vec::new(),
            nodes: Vec::new(),
            cfg,
            previous_group_was_concurrent: false,
        }
    }

    fn push_node(&mut self, entry: &Rc<ExecutionEntry>) -> EntryId {
        let id = EntryId::from_index(self.nodes.len());
        self.nodes.push(EntryNode::new(Rc::clone(entry)));
        id
    }

    fn node(&self, id: EntryId) -> &EntryNode {
        &self.nodes[id.index()]
    }

    pub(crate) fn generate_order_sub(&mut self, current: &TestScheduleEntry) -> JsResult<()> {
        match current {
            TestScheduleEntry::Describe(describe) => self.generate_order_describe(describe)?,
            TestScheduleEntry::TestCallback(test_callback) => {
                self.generate_order_test(test_callback)?
            }
        }
        Ok(())
    }

    pub(crate) fn generate_all_order(
        &mut self,
        entries: &[Rc<ExecutionEntry>],
    ) -> JsResult<AllOrderResult> {
        let start = self.groups.len();
        for entry in entries {
            let node = self.push_node(entry);
            let sequences_start = self.sequences.len();
            self.sequences
                .push(ExecutionSequence::init(Some(node), None, 0, 0)); // add sequence to concurrentgroup
            let sequences_end = self.sequences.len();
            let failure_skip_to = self.groups.len() + 1;
            self.groups.push(ConcurrentGroup::init(
                sequences_start,
                sequences_end,
                failure_skip_to,
            )); // add a new concurrentgroup to order
            self.previous_group_was_concurrent = false;
        }
        let end = self.groups.len();
        Ok(AllOrderResult { start, end })
    }

    pub(crate) fn generate_order_describe(&mut self, current: &DescribeScope) -> JsResult<()> {
        if current.failed.get() {
            return Ok(()); // do not schedule any tests in a failed describe scope
        }
        let use_hooks = self.cfg.always_use_hooks || current.base.has_callback.get();

        // gather beforeAll
        let beforeall_order: AllOrderResult = if use_hooks {
            self.generate_all_order(&current.before_all.borrow())?
        } else {
            AllOrderResult::EMPTY
        };

        // shuffle entries if randomize flag is set
        if let Some(random) = self.cfg.randomize.as_mut() {
            shuffle_with_index(random, &mut current.entries.borrow_mut());
        }

        // gather children
        let scope_only = current.base.only.get();
        for entry in current.entries.borrow().iter() {
            if scope_only == Only::Contains && entry.base().only.get() == Only::No {
                continue;
            }
            self.generate_order_sub(entry)?;
        }

        // update skip_to values for beforeAll to skip to the first afterAll
        beforeall_order.set_failure_skip_to(self);

        // gather afterAll
        let afterall_order: AllOrderResult = if use_hooks {
            self.generate_all_order(&current.after_all.borrow())?
        } else {
            AllOrderResult::EMPTY
        };

        // update skip_to values for afterAll to skip the remaining afterAll items
        afterall_order.set_failure_skip_to(self);

        Ok(())
    }

    pub(crate) fn generate_order_test(&mut self, current: &Rc<ExecutionEntry>) -> JsResult<()> {
        debug_assert!(current.base.has_callback.get() == current.callback.is_some());
        let use_each_hooks = current.base.has_callback.get();
        let first_parent: Option<Rc<DescribeScope>> = current.base.parent();

        let mut list = EntryList::default();

        // gather beforeEach (alternatively, this could be implemented recursively to make it less complicated)
        if use_each_hooks {
            let mut parent = first_parent.clone();
            while let Some(p) = parent {
                // prepend in reverse so they end up in forwards order
                for entry in p.before_each.borrow().iter().rev() {
                    let node = self.push_node(entry);
                    list.prepend(self, node);
                }
                parent = p.base.parent();
            }
        }

        // append test
        let current_node = self.push_node(current);
        list.append(self, current_node); // add entry to sequence

        // gather afterEach
        if use_each_hooks {
            let mut parent = first_parent;
            while let Some(p) = parent {
                for entry in p.after_each.borrow().iter() {
                    let node = self.push_node(entry);
                    list.append(self, node);
                }
                parent = p.base.parent();
            }
        }

        // set skip_to values
        let mut index = list.first;
        let mut failure_skip_past: Option<EntryId> = Some(current_node);
        while let Some(entry) = index {
            let node = self.node(entry);
            node.failure_skip_past.set(failure_skip_past); // we could consider matching skip_to in beforeAll to skip directly to the first afterAll from its own scope rather than skipping to the first afterAll from any scope
            if Some(entry) == failure_skip_past {
                failure_skip_past = None;
            }
            index = node.next.get();
        }

        // add these as a single sequence
        let sequences_start = self.sequences.len();
        self.sequences.push(ExecutionSequence::init(
            list.first,
            Some(current_node),
            current.retry_count,
            current.repeat_count,
        )); // add sequence to concurrentgroup
        let sequences_end = self.sequences.len();
        self.append_or_extend_concurrent_group(
            current.base.concurrent,
            sequences_start,
            sequences_end,
        )?; // add or extend the concurrent group
        Ok(())
    }

    pub(crate) fn append_or_extend_concurrent_group(
        &mut self,
        concurrent: bool,
        sequences_start: usize,
        sequences_end: usize,
    ) -> JsResult<()> {
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
        self.groups.push(ConcurrentGroup::init(
            sequences_start,
            sequences_end,
            failure_skip_to,
        )); // otherwise, add a new concurrentgroup to order
        Ok(())
    }
}

pub(crate) struct AllOrderResult {
    pub(crate) start: usize,
    pub(crate) end: usize,
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

pub(crate) struct Config {
    pub(crate) always_use_hooks: bool,
    // The only call site seeds a concrete `DefaultPrng` (xoshiro256++), so
    // no type-erased Random vtable is needed.
    pub(crate) randomize: Option<bun_core::rand::DefaultPrng>,
}

/// Forward Fisher-Yates: `i` from 0 to len-2, `j = intRangeLessThan(usize, i, len)`.
/// Must produce the identical permutation for the same xoshiro256++ state across Bun
/// versions so that `bun test --randomize --seed=N` stays reproducible.
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

#[derive(Default)]
struct EntryList {
    first: Option<EntryId>,
    last: Option<EntryId>,
}

impl EntryList {
    fn prepend(&mut self, order: &Order, current: EntryId) {
        order.node(current).next.set(self.first);
        self.first = Some(current);
        if self.last.is_none() {
            self.last = Some(current);
        }
    }

    fn append(&mut self, order: &Order, current: EntryId) {
        let cur = order.node(current);
        debug_assert!(cur.next.get().is_none());
        cur.next.set(None);
        if let Some(last) = self.last {
            let last_ref = order.node(last);
            debug_assert!(last_ref.next.get().is_none());
            last_ref.next.set(Some(current));
            self.last = Some(current);
        } else {
            self.first = Some(current);
            self.last = Some(current);
        }
    }
}
