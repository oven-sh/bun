//! Decides when a function gets better code.
//!
//! The entry and each loop count for themselves and report after a part of the threshold. Once the sum reaches it, the
//! function is optimized. A frame that stays in a loop is taken over by code that starts there, preferably at an outer
//! loop, which is made to report the next time it turns.

use core::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Arc, Weak};

use bun_engine_macros::native_abi;
use bun_engine_wasm_compiler::abi::{FunctionSlot, MemoryMode};
use bun_engine_wasm_format::{CodeIndex, OutOfMemory};
use smallvec::SmallVec;

use super::group::{Function, Optimized, State};
use super::installed::Kind;
use super::loops::Nesting;
use super::{Compilers, InstalledCode, STACK_FOR_COMPILERS};
use crate::alloc::try_boxed;
use crate::engine::{Engine, Tiering};
use crate::instance::Instance;
use crate::module::Module;
use crate::queue::{self, Priority};

const REPORTS_TO_THRESHOLD: u32 = 4;
const AT_ONCE: i32 = -1;
const NEVER: i32 = i32::MIN;
/// A function that was entered no more often gets its code when it is entered again.
const FEW_ENTRIES: u32 = 2;
const MAX_LOOP_ENTRIES: usize = 4;
/// How many reports of an inner loop an entry at an outer loop may take to be reached.
const PATIENCE: u8 = 4;

fn threshold(engine: &Engine) -> u32 {
    match engine.options().tiering {
        Tiering::After(threshold) => threshold,
        Tiering::Interpreted | Tiering::BaselineOnly | Tiering::OptimizedOnly => 0,
    }
}

pub(super) fn first_countdown(engine: &Engine) -> i32 {
    -((threshold(engine) / REPORTS_TO_THRESHOLD).clamp(1, 1 << 30) as i32)
}

/// Less for small functions, which do little in a call.
pub(super) fn entry_increment(module: &Module, code: CodeIndex) -> i32 {
    const FULL: u32 = 15;
    const SIZE_FOR_FULL: u32 = 128;
    let size = module.body_span(code).len.min(SIZE_FOR_FULL);
    (FULL * size / SIZE_FOR_FULL).max(1) as i32
}

/// What a countdown has counted.
#[derive(Clone, Copy)]
struct Meter {
    start: i32,
    before_start: u32,
}

impl Meter {
    fn new(start: i32) -> Self {
        Self {
            start,
            before_start: 0,
        }
    }

    fn total(self, countdown: &AtomicI32) -> u32 {
        let since = countdown.load(Ordering::Relaxed).wrapping_sub(self.start);
        self.before_start.saturating_add(since.max(0) as u32)
    }

    fn restart(&mut self, countdown: &AtomicI32, start: i32) {
        self.before_start = self.total(countdown);
        self.start = start;
        countdown.store(start, Ordering::Relaxed);
    }
}

pub(super) struct Heat {
    entry: Meter,
    loops: Box<[Meter]>,
    is_hot: bool,
    choice: Option<Box<Choice>>,
}

/// At which loop to enter.
struct Choice {
    nesting: Nesting,
    /// The outermost that has turned since those around a hot loop were asked to report.
    candidate: Option<u32>,
    is_compiling: bool,
    /// Those for which an entry was asked for.
    attempted: SmallVec<[u32; MAX_LOOP_ENTRIES]>,
    impatience: u8,
}

impl Heat {
    pub(super) fn new(first_countdown: i32, loop_count: u32) -> Result<Self, OutOfMemory> {
        let meter = Meter::new(first_countdown);
        Ok(Self {
            entry: meter,
            loops: try_boxed((0..loop_count).map(|_| meter))?,
            is_hot: false,
            choice: None,
        })
    }

    pub(super) fn counted_at_entry(&self, slot: &FunctionSlot) -> u32 {
        self.entry.total(&slot.countdown)
    }

    pub(super) fn turns(&self, function: &Function, index: u32) -> u32 {
        let meter = self.loops.get(index as usize);
        meter.map_or(0, |it| it.total(&function.loop_countdowns[index as usize]))
    }
}

struct Loops<'a> {
    meters: &'a mut [Meter],
    countdowns: &'a [AtomicI32],
    interval: i32,
}

impl Loops<'_> {
    fn restart(&mut self, index: u32, start: i32) {
        self.meters[index as usize].restart(&self.countdowns[index as usize], start);
    }

    fn restart_all_but(&mut self, excepted: &[u32]) {
        for index in (0..self.meters.len() as u32).filter(|it| !excepted.contains(it)) {
            self.restart(index, self.interval);
        }
    }
}

impl Choice {
    /// `index` is that of a loop that reports and has no entry.
    fn advance(&mut self, loops: &mut Loops<'_>, index: u32) -> Option<u32> {
        let chosen = self.choose(loops, index)?;
        loops.restart_all_but(&self.attempted);
        self.attempted.push(chosen);
        self.candidate = None;
        self.impatience = 0;
        self.is_compiling = true;
        Some(chosen)
    }

    fn choose(&mut self, loops: &mut Loops<'_>, index: u32) -> Option<u32> {
        if self.is_compiling {
            return None;
        }
        if self.attempted.len() == MAX_LOOP_ENTRIES || self.attempted.contains(&index) {
            loops.restart(index, NEVER);
            return None;
        }
        let around = || self.nesting.around(index);
        if around().any(|outer| self.attempted.contains(&outer)) {
            self.impatience += 1;
            return (self.impatience == PATIENCE).then_some(index);
        }
        match self.candidate {
            Some(it) if it == index || self.nesting.is_inside(index, it) => return Some(it),
            Some(it) if self.nesting.is_inside(it, index) => {}
            _ => {
                loops.restart_all_but(&self.attempted);
                around().for_each(|outer| loops.restart(outer, AT_ONCE));
            }
        }
        self.candidate = Some(index);
        around().next().is_none().then_some(index)
    }
}

/// A function whose baseline code reports.
struct Reporter<'a> {
    instance: &'a Instance,
    code: CodeIndex,
    slot: &'a FunctionSlot,
    function: &'a Function,
    /// From one report to the next.
    interval: i32,
}

impl<'a> Reporter<'a> {
    fn new(instance: &'a Instance, baseline: &InstalledCode) -> Self {
        let group = instance.code();
        let code = instance.module().code_index(baseline.func());
        let code = code.expect("a function with code");
        Self {
            instance,
            code,
            slot: group.slot(code),
            function: group.existing_function(code).expect("it was compiled"),
            interval: first_countdown(instance.engine()),
        }
    }

    fn is_hot(&self, heat: &mut Heat) -> bool {
        if !heat.is_hot {
            let loops = heat.loops.iter().zip(&self.function.loop_countdowns);
            let turns = loops.map(|(meter, countdown)| meter.total(countdown));
            let total = turns.fold(heat.counted_at_entry(self.slot), u32::saturating_add);
            heat.is_hot = total >= threshold(self.instance.engine());
        }
        heat.is_hot
    }

    fn at_entry(&self, state: &mut State) -> Option<Kind> {
        if !self.is_hot(&mut state.heat) {
            state
                .heat
                .entry
                .restart(&self.slot.countdown, self.interval);
            return None;
        }
        self.start_optimizing(state)
    }

    fn start_optimizing(&self, state: &mut State) -> Option<Kind> {
        state.heat.entry.restart(&self.slot.countdown, NEVER);
        matches!(state.optimized, Optimized::NotStarted).then(|| {
            state.optimized = Optimized::Started;
            Kind::Optimized
        })
    }

    /// There is no entry for the loop.
    fn in_loop(&self, state: &mut State, index: u32) -> Option<Kind> {
        let countdowns = &self.function.loop_countdowns;
        let start = match state.optimized {
            Optimized::Failed => NEVER,
            _ => self.interval,
        };
        state.heat.loops[index as usize].restart(&countdowns[index as usize], start);
        if !self.is_hot(&mut state.heat) {
            return None;
        }
        let increment = entry_increment(self.instance.module(), self.code) as u32;
        let entries = state.heat.counted_at_entry(self.slot) / increment;
        match state.optimized {
            Optimized::NotStarted if entries > FEW_ENTRIES => return self.start_optimizing(state),
            Optimized::NotStarted => state.heat.entry.restart(&self.slot.countdown, AT_ONCE),
            Optimized::Started | Optimized::Failed => return None,
            Optimized::Done(_) => {}
        }
        let choice = state.heat.choice.get_or_insert_with(|| {
            Box::new(Choice {
                nesting: Nesting::new(&self.instance.module().body(self.code)),
                candidate: None,
                is_compiling: false,
                attempted: SmallVec::new(),
                impatience: 0,
            })
        });
        let mut loops = Loops {
            meters: &mut state.heat.loops,
            countdowns,
            interval: self.interval,
        };
        choice.advance(&mut loops, index).map(Kind::LoopEntry)
    }

    fn start(&self, kind: Kind) {
        let (module, mode, code) = (self.instance.module(), self.instance.mode(), self.code);
        if !self.instance.engine().options().use_threads {
            let compilers = &mut self.instance.store().compilers.borrow_mut();
            return compile(module, mode, code, kind, compilers);
        }
        let priority = match kind {
            Kind::LoopEntry(_) => Priority::LoopEntry,
            Kind::Baseline | Kind::Optimized => Priority::Optimization,
        };
        let module = Arc::downgrade(module);
        queue::schedule(priority, move |workspace| {
            if let Some(module) = Weak::upgrade(&module) {
                compile(&module, mode, code, kind, &mut workspace.compilers);
            }
        });
    }
}

fn compile(
    module: &Module,
    mode: MemoryMode,
    code: CodeIndex,
    kind: Kind,
    compilers: &mut Compilers,
) {
    let group = module.code(mode);
    let Kind::LoopEntry(index) = kind else {
        group.replace_with_optimized(module, code, compilers);
        return;
    };
    let function = group.existing_function(code).expect("it was compiled");
    let baseline = function.state.lock().lingering_baseline.upgrade();
    let Some(baseline) = baseline else { return };
    if let Some(entry) = group.optimize(module, code, kind, compilers) {
        baseline.add_loop_entry(index, entry);
        restart_loop(function, index, AT_ONCE);
    }
    let heat = &mut function.state.lock().heat;
    heat.choice
        .as_mut()
        .expect("a loop was chosen")
        .is_compiling = false;
}

fn restart_loop(function: &Function, index: u32, start: i32) {
    let meter = &mut function.state.lock().heat.loops[index as usize];
    meter.restart(&function.loop_countdowns[index as usize], start);
}

fn is_short_of_stack(instance: &Instance, code: &InstalledCode, fp: usize) -> bool {
    instance.store().stack_below(fp - code.frame_size()) < STACK_FOR_COMPILERS
}

/// # Safety
/// For the stub, which baseline code with its frame at `fp` called from `pc`.
#[native_abi]
pub(crate) unsafe fn tier_up_at_entry(instance: &Instance, fp: usize, pc: usize) {
    // SAFETY: the caller's.
    let baseline = unsafe { InstalledCode::running_at(pc - 1) }.expect("baseline code");
    let reporter = Reporter::new(instance, baseline);
    let state = &reporter.function.state;
    if is_short_of_stack(instance, baseline, fp) {
        let meter = &mut state.lock().heat.entry;
        return meter.restart(&reporter.slot.countdown, reporter.interval);
    }
    let wanted = reporter.at_entry(&mut state.lock());
    if let Some(kind) = wanted {
        reporter.start(kind);
    }
    instance.engine().host().module_grew(instance);
}

/// # Safety
/// For the stub, which baseline code with its frame at `fp` called from `pc`.
#[native_abi]
pub(crate) unsafe fn tier_up_in_loop(
    instance: &Instance,
    fp: usize,
    pc: usize,
    index: u32,
) -> usize {
    // SAFETY: the caller's.
    let baseline = unsafe { InstalledCode::running_at(pc - 1) }.expect("baseline code");
    let reporter = Reporter::new(instance, baseline);
    if is_short_of_stack(instance, baseline, fp) {
        restart_loop(reporter.function, index, reporter.interval);
        return 0;
    }
    let entry = baseline.loop_entry(index).or_else(|| {
        let wanted = reporter.in_loop(&mut reporter.function.state.lock(), index);
        if let Some(kind) = wanted {
            reporter.start(kind);
        }
        // Another thread may have finished it meanwhile, in which case the loop was told not to report again.
        baseline.loop_entry(index)
    });
    instance.engine().host().module_grew(instance);
    let Some((address, frame_size)) = entry else {
        return 0;
    };
    if fp.saturating_sub(frame_size) < instance.store().stack_limit() {
        restart_loop(reporter.function, index, reporter.interval);
        return 0;
    }
    restart_loop(reporter.function, index, AT_ONCE);
    address
}
