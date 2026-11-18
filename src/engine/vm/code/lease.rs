//! Code that has not run for a while goes in a full collection: first the code block with its machine code, later the
//! bytecode. The next call makes them again.

use core::cell::{Cell, RefCell};
use core::num::NonZeroU32;
use core::sync::atomic::Ordering::Relaxed;
use core::sync::atomic::{AtomicI32, AtomicU32};
use std::rc::{Rc, Weak};

use bun_engine_bytecode::{Code, CodeFlags, FunctionInfo, Specialization};
use bun_engine_platform::clock;

use crate::heap::{Moment, Scope, Survivors};
use crate::{
    CellType, CodeBlock, FastHashMap, FastHashSet, Field, FunctionExecutable, Gc, ScriptExecutable,
    Tier, Trace, Visitor, Vm, options,
};

pub(super) const SPECIALIZATIONS: [Specialization; 2] =
    [Specialization::Call, Specialization::Construct];

/// What the full collections have seen of a code block.
#[derive(Default)]
pub(super) struct Lease {
    counter_at_last_look: AtomicI32,
    /// The bits of the time at which it was last seen to have run, or one of the constants.
    start: AtomicU32,
}

impl Lease {
    const NOT_BEGUN: u32 = 0;
    /// The executable has not marked the code block.
    const ENDED: u32 = f32::NEG_INFINITY.to_bits();
    /// Something else has kept it.
    const LONG_AGO: u32 = f32::MIN.to_bits();
}

fn seconds_to_live(tier: Tier) -> f32 {
    let (seconds, short) = match tier {
        Tier::Interpreter => (5.0, 0.01),
        Tier::Baseline => (15.0, 0.03),
        Tier::QuickOptimized => (20.0, 0.04),
        Tier::FullyOptimized => (60.0, 0.12),
    };
    if options().use_short_code_leases {
        short
    } else {
        seconds
    }
}

fn seconds_of_lease(tier: Tier) -> f32 {
    seconds_to_live(tier) * options().code_lease_multiplier as f32
}

impl CodeBlock {
    /// For what its counter may not show.
    #[inline]
    pub fn renew_lease(&self) {
        let other = self.execution_counter().get().wrapping_sub(1);
        self.lease.counter_at_last_look.store(other, Relaxed);
    }

    /// No script is running.
    fn has_outlived_lease(&self, moment: Moment) -> bool {
        if options().force_code_to_expire {
            return true;
        }
        let (lease, counter) = (&self.lease, self.execution_counter().get());
        let start = lease.start.load(Relaxed);
        if lease.counter_at_last_look.swap(counter, Relaxed) != counter || start == Lease::NOT_BEGUN
        {
            lease.start.store(moment.seconds.to_bits().max(1), Relaxed);
            return false;
        }
        let (unused, tier) = (moment.seconds - f32::from_bits(start), self.tier());
        // Optimized code shows that it runs by counting its returns, and the best that there can be is worth keeping.
        if !self.is_optimized()
            || (self.next_tier().is_some()
                && !self.body().flags().contains(CodeFlags::HAS_TAIL_CALLS))
        {
            return unused >= seconds_of_lease(tier);
        }
        let mut quiet = options().quiet_seconds_for_hot_code as f32;
        if options().use_short_code_leases {
            quiet = quiet.min(seconds_to_live(tier));
        }
        options().quiet_allocation_megabytes != 0
            && (moment.idle_seconds).is_some_and(|idle| idle.min(unused) >= quiet)
    }
}

/// From an executable to the code block that it runs.
#[repr(transparent)]
pub(super) struct CodeEdge(pub(super) Field<Option<Gc<CodeBlock>>>);

// SAFETY: what it does not visit, `ScriptExecutable::reconcile_weak_references` clears.
unsafe impl Trace for CodeEdge {
    fn trace(&self, visitor: &mut Visitor) {
        let Some(code_block) = self.0.get_published() else {
            return;
        };
        let looks_at_lease = visitor.scope() == Scope::Full && visitor.is_first_visit();
        if visitor.is_mutator_running() && !looks_at_lease {
            return visitor.append(code_block);
        }
        if visitor.puts_off_current_cell() {
            return;
        }
        let start = &code_block.lease.start;
        let has_ended = start.load(Relaxed) == Lease::ENDED;
        if visitor.is_verifying() {
            if !has_ended {
                visitor.append(code_block);
            }
            return;
        }
        if has_ended {
            start.store(Lease::LONG_AGO, Relaxed);
        }
        let is_over = looks_at_lease
            && !visitor.is_marked(code_block)
            && code_block.executable().cell_type() == CellType::FunctionExecutable
            && code_block.has_outlived_lease(visitor.moment());
        if !is_over {
            return visitor.append(code_block);
        }
        start.store(Lease::ENDED, Relaxed);
        visitor.reconcile_current_cell_later();
        // A program at work may soon want what the tier below knows.
        if code_block.is_optimized() && visitor.moment().idle_seconds.is_none() {
            visitor.append(code_block.baseline());
        }
    }
}

impl ScriptExecutable {
    /// The bytecode is free to go.
    pub(super) fn unlink(&self, vm: &Vm, specialization: Specialization) {
        self.clear_code(specialization);
        if SPECIALIZATIONS.map(|it| self.code_block(it)) == [None; 2] {
            vm.heap.as_part_of_sweeping(|| self.forget_evals());
        }
        if let Some(function) = self.downcast::<FunctionExecutable>() {
            (vm.services.code.bytecodes).watch(function.place_in_table().0);
        }
    }

    pub(super) fn reconcile_weak_references(&self, survivors: &Survivors) {
        for specialization in SPECIALIZATIONS {
            let dead = || (self.code_block(specialization)).filter(|&it| !survivors.contains(it));
            dead().inspect(|it| it.jettison(survivors.vm()));
            if let Some(dead) = dead() {
                let shared = &dead.code().machine_code;
                let holds =
                    (dead.compiled()).is_some_and(|it| shared.is_at(Rc::as_ptr(&it).addr()));
                shared.release_unless_held_by_more_than(holds.into());
                self.unlink(survivors.vm(), specialization);
            }
        }
    }
}

pub(super) struct Bytecodes {
    /// Those with bytecode that may outlast its use, by address.
    tables: RefCell<FastHashMap<usize, Weak<[FunctionInfo]>>>,
    /// As of the last collection.
    now: Cell<Seconds>,
    last_look: Cell<Seconds>,
}

type Seconds = NonZeroU32;

fn read_clock() -> Seconds {
    Seconds::MIN.saturating_add(clock::monotonic_seconds() as u32)
}

impl Default for Bytecodes {
    fn default() -> Bytecodes {
        let now = read_clock();
        Bytecodes {
            tables: RefCell::default(),
            now: Cell::new(now),
            last_look: Cell::new(now),
        }
    }
}

impl CodeBlock {
    pub(super) fn begin_lease_of_bytecode(&self, vm: &Vm) {
        let bytecodes = &vm.services.code.bytecodes;
        let last_use = &self.code().machine_code.last_use;
        if last_use.replace(Some(bytecodes.now.get())).is_none()
            && let Some(function) = self.executable().downcast::<FunctionExecutable>()
        {
            let table = function.place_in_table().0;
            // One without siblings goes soon after its executables, or with the code around it.
            if table.len() > 1 || function.is_builtin() {
                bytecodes.watch(table);
            }
        }
    }
}

impl Bytecodes {
    fn watch(&self, table: &Rc<[FunctionInfo]>) {
        let mut tables = self.tables.borrow_mut();
        if tables.len() == tables.capacity() {
            // They hold on to the memory.
            tables.retain(|_, table| table.strong_count() != 0);
            let alive = tables.len();
            tables.reserve(alive);
        }
        (tables.entry(table.as_ptr().addr())).or_insert_with(|| Rc::downgrade(table));
    }

    /// `keeps` is told whether anything besides the function has the code.
    fn retain(&self, keeps: impl Fn(&Code, bool) -> bool) {
        let mut tables = self.tables.borrow_mut();
        tables.retain(|_, table| {
            let (table, mut has_code) = (table.upgrade(), false);
            for function in table.iter().flat_map(|it| it.iter()) {
                for specialization in SPECIALIZATIONS {
                    let Some(code) = function.code(specialization) else {
                        continue;
                    };
                    if keeps(&code, Rc::strong_count(&code) > 2) {
                        has_code = true;
                    } else {
                        function.set_code(specialization, None);
                    }
                }
            }
            has_code
        });
        let length = tables.len();
        tables.shrink_to(2 * length);
    }
}

impl Vm {
    fn retain_bytecode(&self, keeps: impl Fn(&Code, bool) -> bool) {
        if !self.keeps_loaded_code() {
            (self.heap).as_part_of_sweeping(|| self.services.code.bytecodes.retain(keeps));
        }
    }

    pub(super) fn discard_expired_bytecode(&self, scope: Scope) {
        const SECONDS_BETWEEN_LOOKS: u32 = 5;
        const SECONDS_OF_LEASE: u32 = 60;
        let (bytecodes, now) = (&self.services.code.bytecodes, read_clock());
        bytecodes.now.set(now);
        if scope != Scope::Full {
            return;
        }
        if options().force_code_to_expire {
            return self.retain_bytecode(|_, is_linked| is_linked);
        }
        let since = |time: Seconds| now.get() - time.get();
        if since(bytecodes.last_look.get()) < SECONDS_BETWEEN_LOOKS {
            return;
        }
        bytecodes.last_look.set(now);
        self.retain_bytecode(|code, is_linked| {
            let shared = &code.machine_code;
            if is_linked || shared.last_use.get().is_none() {
                shared.last_use.set(Some(now));
                return true;
            }
            let unused = shared.last_use.get().map_or(0, since);
            if unused as f32 >= seconds_of_lease(Tier::Baseline) {
                shared.release_unless_held_by_more_than(0);
            }
            unused < SECONDS_OF_LEASE
        });
    }

    /// The bytecode of functions whose code blocks have been swept.
    pub fn discard_unlinked_code(&self) {
        self.retain_bytecode(|code, is_linked| {
            is_linked || code.machine_code.last_use.get().is_none()
        });
    }

    pub(super) fn discard_all_bytecode(&self) {
        self.retain_bytecode(|_, _| false);
    }

    /// How many functions have their bytecode in memory.
    pub fn bytecode_count(&self) -> usize {
        let mut codes = FastHashSet::default();
        let mut add = |function: &FunctionInfo| {
            let at_hand = SPECIALIZATIONS.map(|it| function.code(it));
            codes.extend(at_hand.iter().flatten().map(|it| Rc::as_ptr(it).addr()));
        };
        (self.heap).for_each_live(|function: Gc<FunctionExecutable>| add(function.info()));
        let tables = self.services.code.bytecodes.tables.borrow();
        for table in tables.values().filter_map(Weak::upgrade) {
            table.iter().for_each(&mut add);
        }
        codes.len()
    }
}
