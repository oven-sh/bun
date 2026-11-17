//! take Collection phase output and convert to Execution phase input

use super::bun_test::{BunTest, DescribeScope, EntryId, Hooks, Only, ScopeId, SequenceEntryId, TestScheduleEntry};
use super::execution::{ConcurrentGroup, ExecutionSequence};

pub(crate) struct Order<'a> {
    buntest: &'a BunTest,
    pub(crate) groups: Vec<ConcurrentGroup>,
    pub(crate) sequences: Vec<ExecutionSequence>,
    pub(crate) previous_group_was_concurrent: bool,
    /// Set by `describe.shuffle` only, not by `--randomize`.
    pub(crate) shuffled: bool,
    pub(crate) cfg: Config,
}

impl<'a> Order<'a> {
    pub(crate) fn init(buntest: &'a BunTest, cfg: Config) -> Order<'a> {
        Order {
            buntest,
            groups: Vec::new(),
            sequences: Vec::new(),
            cfg,
            previous_group_was_concurrent: false,
            shuffled: false,
        }
    }

    /// Vitest doesn't run the hooks of a scope where every test is skipped, so `!runs_a_test` drops Vitest hooks.
    pub(crate) fn generate_all_order(&mut self, entries: &[EntryId], runs_a_test: bool) -> AllOrderResult {
        let start = self.groups.len();
        for &entry in entries {
            if !runs_a_test && self.buntest.entry(entry).calling.is_vitest() {
                continue;
            }
            self.append_group_of(self.buntest.push_sequence_entry(entry));
        }
        let end = self.groups.len();
        AllOrderResult { start, end }
    }

    pub(crate) fn append_group_of(&mut self, entry: SequenceEntryId) {
        let sequences_start = self.sequences.len();
        self.sequences.push(ExecutionSequence::init(Some(entry), None, 0, 0)); // add sequence to concurrentgroup
        let sequences_end = self.sequences.len();
        let failure_skip_to = self.groups.len() + 1;
        self.groups
            .push(ConcurrentGroup::init(sequences_start, sequences_end, failure_skip_to)); // add a new concurrentgroup to order
        self.previous_group_was_concurrent = false;
    }

    /// Uses an explicit stack instead of recursion, because `describe()` can nest arbitrarily deep.
    pub(crate) fn generate_order_describe(&mut self, root: ScopeId, preload: &Hooks) {
        let mut open: Vec<OpenDescribe<'a>> = Vec::new();
        open.extend(self.enter_describe(root));
        while let Some(frame) = open.last_mut() {
            let Some(&entry) = frame.children.get(frame.next_child) else {
                let frame = open.pop().expect("non-empty");
                self.exit_describe(frame);
                continue;
            };
            frame.next_child += 1;
            let base = match entry {
                TestScheduleEntry::Describe(describe) => &self.buntest.scope(describe).base,
                TestScheduleEntry::TestCallback(test_callback) => &self.buntest.entry(test_callback).base,
            };
            if frame.scope.base.only.get() == Only::Contains && base.only.get() == Only::No {
                continue;
            }
            match entry {
                TestScheduleEntry::Describe(describe) => open.extend(self.enter_describe(describe)),
                TestScheduleEntry::TestCallback(test_callback) => {
                    self.generate_order_test(test_callback, &open, preload)
                }
            }
        }
    }

    fn enter_describe(&mut self, current: ScopeId) -> Option<OpenDescribe<'a>> {
        let current = self.buntest.scope(current);
        if current.failed.get() {
            return None; // do not schedule any tests in a failed describe scope
        }
        let has_callback = current.base.has_callback.get();
        let use_hooks = self.cfg.always_use_hooks || has_callback;
        let hooks = current.hooks.take();

        // gather aroundAll
        let aroundall_order: AllOrderResult = if use_hooks {
            self.generate_all_order(&hooks.around_all, has_callback)
        } else {
            AllOrderResult::EMPTY
        };

        // gather beforeAll
        let beforeall_order: AllOrderResult = if use_hooks {
            self.generate_all_order(&hooks.before_all, has_callback)
        } else {
            AllOrderResult::EMPTY
        };

        // shuffle entries if randomize flag is set
        let mut children = current.entries.take();
        match (current.inherited.shuffle, self.cfg.randomize.as_mut()) {
            (Some(false), _) | (None, None) => {}
            (None, Some(random)) => shuffle_with_index(random, &mut children),
            // Uses its own PRNG, so `--seed` reproduces this order even though it also shuffles everything else.
            (Some(true), _) => {
                let name = bun_wyhash::hash(current.base.name.as_deref().unwrap_or_default());
                let mut random = bun_core::rand::DefaultPrng::init(self.cfg.seed.wrapping_add(name));
                shuffle_with_index(&mut random, &mut children);
                self.shuffled = true;
            }
        }

        Some(OpenDescribe {
            scope: current,
            children,
            next_child: 0,
            hooks,
            use_hooks,
            aroundall_order,
            beforeall_order,
        })
    }

    fn exit_describe(&mut self, frame: OpenDescribe<'a>) {
        let has_callback = frame.scope.base.has_callback.get();

        // update skip_to values for beforeAll to skip to the first afterAll
        frame.beforeall_order.set_failure_skip_to(self);

        // gather afterAll
        let afterall_order: AllOrderResult = if frame.use_hooks {
            self.generate_all_order(&frame.hooks.after_all, has_callback)
        } else {
            AllOrderResult::EMPTY
        };

        // update skip_to values for afterAll to skip the remaining afterAll items
        afterall_order.set_failure_skip_to(self);

        // An aroundAll that fails before `runSuite()` skips to the teardown of the ones around it. Its own slot has no callback.
        frame.aroundall_order.set_failure_skip_to(self);
        if frame.use_hooks {
            self.generate_all_order(&frame.hooks.around_all_teardown, has_callback);
        }

        frame.scope.entries.set(frame.children);
    }

    /// `open` is the scopes around the test, outermost first.
    fn generate_order_test(&mut self, test: EntryId, open: &[OpenDescribe<'a>], preload: &Hooks) {
        let buntest = self.buntest;
        let entry = buntest.entry(test);
        debug_assert!(entry.base.has_callback.get() == entry.callback.is_some());
        let use_each_hooks = entry.base.has_callback.get();
        let parents = open.iter().rev().map(|frame| &frame.hooks).chain([preload]);

        let mut list = EntryList { buntest, first: None, last: None };

        // gather beforeEach (alternatively, this could be implemented recursively to make it less complicated)
        if use_each_hooks {
            for p in parents.clone() {
                // prepend in reverse so they end up in forwards order
                for &hook in p.before_each.iter().rev() {
                    list.prepend(hook);
                }
            }
        }

        // gather aroundEach, which goes around every beforeEach
        if use_each_hooks {
            for p in parents.clone() {
                for &hook in p.around_each.iter().rev() {
                    list.prepend(hook);
                }
            }
        }

        // append test
        let current = list.append(test); // add entry to sequence

        // gather afterEach
        if use_each_hooks {
            for p in parents {
                for &hook in &p.after_each {
                    list.append(hook);
                }
            }
        }

        // set skip_to values
        let mut failure_skip_past = Some(current);
        for (id, sequence_entry) in buntest.sequence_entries_from(list.first) {
            sequence_entry.failure_skip_past.set(if buntest.entry(sequence_entry.entry).around.is_some() {
                // Nothing inside an aroundEach that fails before `runTest()` runs, afterEach included.
                list.last
            } else {
                failure_skip_past // we could consider matching skip_to in beforeAll to skip directly to the first afterAll from its own scope rather than skipping to the first afterAll from any scope
            });
            if Some(id) == failure_skip_past {
                failure_skip_past = None;
            }
        }

        // add these as a single sequence
        let sequences_start = self.sequences.len();
        self.sequences.push(ExecutionSequence::init(
            list.first,
            Some(current),
            entry.retry_count,
            entry.repeat_count,
        )); // add sequence to concurrentgroup
        let sequences_end = self.sequences.len();
        self.append_or_extend_concurrent_group(entry.base.concurrent, sequences_start, sequences_end); // add or extend the concurrent group
    }

    fn append_or_extend_concurrent_group(
        &mut self,
        concurrent: bool,
        sequences_start: usize,
        sequences_end: usize,
    ) {
        // We capture the old value first, then assign immediately so it applies on every exit path.
        let prev_was_concurrent = self.previous_group_was_concurrent;
        self.previous_group_was_concurrent = concurrent;

        if concurrent && !self.groups.is_empty() {
            let previous_group = self.groups.last_mut().expect("non-empty");
            if prev_was_concurrent {
                // extend the previous group to include this sequence
                if previous_group.try_extend(sequences_start, sequences_end) {
                    return;
                }
            }
        }
        let failure_skip_to = self.groups.len() + 1;
        self.groups
            .push(ConcurrentGroup::init(sequences_start, sequences_end, failure_skip_to)); // otherwise, add a new concurrentgroup to order
    }
}

/// Tracks a describe scope whose children `generate_order_describe` is still scheduling.
struct OpenDescribe<'a> {
    scope: &'a DescribeScope,
    /// `scope.entries`, until `exit_describe` puts them back.
    children: Vec<TestScheduleEntry>,
    next_child: usize,
    hooks: Hooks,
    use_hooks: bool,
    aroundall_order: AllOrderResult,
    beforeall_order: AllOrderResult,
}

pub(crate) struct AllOrderResult {
    pub(crate) start: usize,
    pub(crate) end: usize,
}

impl AllOrderResult {
    pub(crate) const EMPTY: AllOrderResult = AllOrderResult { start: 0, end: 0 };

    pub(crate) fn set_failure_skip_to(&self, this: &mut Order<'_>) {
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
    pub(crate) seed: u64,
}

/// Forward Fisher-Yates: `i` from 0 to len-2, `j = intRangeLessThan(usize, i, len)`.
/// Must produce the identical permutation for the same xoshiro256++ state across Bun
/// versions so that `bun test --randomize --seed=N` stays reproducible.
#[optimize(size)]
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
    (m >> 64) as u64
}

struct EntryList<'a> {
    buntest: &'a BunTest,
    first: Option<SequenceEntryId>,
    last: Option<SequenceEntryId>,
}

impl EntryList<'_> {
    fn prepend(&mut self, entry: EntryId) {
        let current = self.buntest.push_sequence_entry(entry);
        self.buntest.sequence_entry(current).next.set(self.first);
        self.first = Some(current);
        if self.last.is_none() {
            self.last = Some(current);
        }
    }

    fn append(&mut self, entry: EntryId) -> SequenceEntryId {
        let current = self.buntest.push_sequence_entry(entry);
        match self.last {
            Some(last) => self.buntest.sequence_entry(last).next.set(Some(current)),
            None => self.first = Some(current),
        }
        self.last = Some(current);
        current
    }
}
