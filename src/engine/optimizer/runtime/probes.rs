//! What code calls that has been compiled with probes.

use core::cell::{Cell, RefCell};
use core::fmt::Display;

use bun_engine_codegen::ir::Origin;
use bun_engine_macros::native_abi;
use bun_engine_number::Random;
use bun_engine_platform::log;
use bun_engine_vm::heap::barrier;
use bun_engine_vm::{
    CallFrame, CodeBlock, Cx, ErrorType, FastHashMap, FastHashSet, Gc, Intrinsic,
    SpeculatedType as T, StackVisitor, Value, Vm, options, root_vec,
};

use super::code::Compiled;
use super::tiering::name_of;
use crate::graph::probes::{Claim, Probe, is_wanted};
use crate::graph::{ExitInfo, ModeSet, heaps};

const GO_ON: u32 = 0;
const THROW: u32 = 1;
const EXIT: u32 = 2;

struct State {
    random: Cell<Random>,
    checks: Cell<u32>,
    operations: Cell<u32>,
    collections: Cell<u32>,
    checks_since_exit: Cell<u32>,
    /// By code block and probe.
    forced: RefCell<FastHashMap<(usize, u64), u32>>,
    logged: RefCell<FastHashSet<String>>,
}

// SAFETY: the addresses are only compared.
unsafe impl bun_engine_vm::GcFree for State {}

impl Default for State {
    fn default() -> State {
        State {
            random: Cell::new(Random::new(options().seed_of_probes)),
            checks: Cell::new(0),
            operations: Cell::new(0),
            collections: Cell::new(0),
            checks_since_exit: Cell::new(0),
            forced: RefCell::default(),
            logged: RefCell::default(),
        }
    }
}

impl State {
    fn below(&self, limit: u32) -> u32 {
        let mut random = self.random.get();
        let number = (random.next_u64() >> 20) as u32 % limit;
        self.random.set(random);
        number
    }

    fn cover(&self, event: &str, compiled: &Compiled, origin: Origin, what: impl Display) {
        if !options().log_optimizer_coverage {
            return;
        }
        let position = compiled.position(origin);
        let opcode = (compiled.code_block_of(position.frame)).opcode_at(position.offset);
        let intrinsic = compiled.tables.intrinsics[origin.0 as usize];
        let line = match (opcode, intrinsic) {
            (Some(opcode), Intrinsic::None) => format!("cover {event} {opcode:?} {what}\n"),
            _ => format!("cover {event} {intrinsic:?}() {what}\n"),
        };
        if !self.logged.borrow().contains(&line) {
            log(format_args!("{line}"));
            self.logged.borrow_mut().insert(line);
        }
    }

    fn cover_exit(&self, event: &str, compiled: &Compiled, exit: &ExitInfo) {
        let what = format_args!("{:?} {}", exit.kind, exit.made_at());
        self.cover(event, compiled, exit.origin, what);
    }

    /// Those that have not failed yet go first, and code that has been through it all is left to run.
    fn is_to_fail(&self, vm: &Vm, check: (usize, u64)) -> bool {
        const OFTEN: u32 = 2;
        const LONGEST_PAUSE: u32 = 500;
        let (options, checks_left) = (options(), &vm.probes().checks_left);
        checks_left.set(1);
        self.checks.update(|count| count.wrapping_add(1));
        let period = options.checks_per_forced_exit;
        if period == 0 {
            return self.checks.get() == options.check_to_fail;
        }
        let mut forced = self.forced.borrow_mut();
        let forced = forced.entry(check).or_default();
        let rarity = if *forced < OFTEN { 1 } else { 100 };
        let fails = self.below(period.saturating_mul(rarity)) == 0;
        *forced += u32::from(fails);
        (self.checks_since_exit).update(|count| if fails { 0 } else { count + 1 });
        let pause = (self.checks_since_exit.get() / period / 50).min(LONGEST_PAUSE);
        checks_left.set(1 + self.below(pause + 1) as i32);
        fails
    }

    /// Less and less often, so that long loops come to an end.
    fn is_time_to_collect(&self) -> bool {
        const PATIENCE: u32 = 50;
        let period = options().collect_every_n_safepoints;
        let is_time = self.below(period.saturating_mul(1 + self.collections.get() / PATIENCE)) == 0;
        self.collections.update(|count| count + u32::from(is_time));
        is_time
    }

    fn jettison_at_times(&self, vm: &Vm, frame: &CallFrame, running: Gc<CodeBlock>) {
        if self.below(options().calls_per_forced_jettison) != 0 {
            return;
        }
        let mut victims = root_vec();
        victims.push(running);
        if self.below(2) == 0 {
            vm.set_top_call_frame(frame);
            frame.set_call_site(0);
            victims.extend(StackVisitor::frames(vm).filter_map(|it| it.machine_frame.code_block()));
        }
        for victim in victims.iter().filter(|it| it.is_optimized()) {
            victim.count_reoptimization();
            victim.jettison(vm);
        }
    }
}

/// # Safety
/// The operands are in the form that the claim is about.
unsafe fn holds(vm: &Vm, compiled: &Compiled, claim: Claim, first: u64, second: u64) -> bool {
    let is_tagged = !matches!(claim, Claim::Field(..) | Claim::IsBoolean | Claim::IsInt52);
    if is_tagged
        && T::of_immediate(first).is_none()
        && vm.heap.live_cell_at(first as usize).is_none()
    {
        return false;
    }
    // SAFETY: the caller's.
    let value = || unsafe { Value::from_bits_or_empty(first) };
    let cell = || value().and_then(Value::as_cell);
    let number = || value().and_then(Value::as_number);
    let shapes = &compiled.tables.shapes;
    match claim {
        Claim::Type(ty) => ty.contains(T::of(value())),
        Claim::Shapes(set) => cell().is_some_and(|cell| {
            let mut members = shapes.members(set).iter();
            members.any(|&it| shapes[it].id == cell.shape_id())
        }),
        Claim::Modes(modes) => {
            cell().is_some_and(|it| modes.contains(ModeSet::single(it.indexing_mode())))
        }
        // An epoch ends with a collection too, which changes nothing of what has been found out in it.
        Claim::Field(.., heaps::WATCHPOINT_STATES) => true,
        Claim::Field(offset, size, _) => {
            let address = (first as usize).wrapping_add_signed(offset as isize);
            // SAFETY: the code would have loaded them.
            let found = unsafe {
                core::slice::from_raw_parts(
                    core::ptr::with_exposed_provenance::<u8>(address),
                    size as usize,
                )
            };
            *found == second.to_le_bytes()[..size as usize]
        }
        Claim::NeedsNoBarrier => cell().is_none_or(|it| !barrier::is_needed_for(&it)),
        Claim::Int32 => number().map(f64::to_bits) == Some(f64::from(second as i32).to_bits()),
        Claim::Double => number().is_some_and(|it| {
            it.to_bits() == second || it.is_nan() && f64::from_bits(second).is_nan()
        }),
        Claim::IsBoolean => first <= 1,
        Claim::IsInt52 => (first as i64) << 12 >> 12 == first as i64,
    }
}

/// The words are the number of the probe and its operands.
#[native_abi]
pub(super) unsafe fn probe(vm: &Vm, &[number, first, second]: &[u64; 3], frame: &CallFrame) {
    let running = frame.code_block().expect("a frame of optimized code");
    let (compiled, state) = (Compiled::of(&running), vm.extension::<State>());
    let answer = &vm.probes().answer;
    match compiled.tables.probes[number as usize] {
        Probe::Passed(exit, is_late) => {
            state.cover_exit("passed", &compiled, &exit);
            let fails = state.is_to_fail(vm, (running.address(), number));
            answer.set(if fails && !is_late { EXIT } else { GO_ON });
        }
        Probe::Reached(origin, kind, data) => {
            state.cover("reached", &compiled, origin, kind.described(data));
        }
        Probe::MayCollect => {
            if state.is_time_to_collect() && !vm.heap.is_deferred() {
                vm.set_top_call_frame(frame);
                frame.set_call_site(0);
                vm.heap.collect_for_stress();
            }
        }
        Probe::MayInvalidate => state.jettison_at_times(vm, frame, running),
        Probe::DidNotThrow => {
            state.operations.update(|count| count + 1);
            answer.set(GO_ON);
            if state.operations.get() == options().operation_to_throw {
                vm.set_top_call_frame(frame);
                // SAFETY: generated code runs inside a call that has the `Cx`.
                let cx = unsafe { Cx::from_global(running.global()) };
                let _ = cx.throw_error(ErrorType::Error, "Exception Fuzz");
                answer.set(THROW);
            }
        }
        Probe::Holds(claim, origin, made_at) => {
            let position = compiled.position(origin);
            assert!(
                // SAFETY: the compiler has put them together.
                unsafe { holds(vm, &compiled, claim, first, second) },
                "{claim:?} of {made_at} does not hold for {first:#x} {second:#x} at {}:{} in {}",
                name_of(&compiled.code_block_of(position.frame)),
                position.offset,
                name_of(&running),
            );
        }
    }
}

pub(super) fn did_install(vm: &Vm, compiled: &Compiled) {
    if is_wanted(|it| it.log_optimizer_coverage) {
        let state = vm.extension::<State>();
        (compiled.tables.exits.iter())
            .for_each(|exit| state.cover_exit("compiled", compiled, &exit.info));
        for probe in &compiled.tables.probes {
            if let Probe::Reached(origin, kind, data) = *probe {
                state.cover("compiled", compiled, origin, kind.described(data));
            }
        }
    }
}

/// Whether the lower tiers are to take note of why.
pub(super) fn counts(vm: &Vm, compiled: &Compiled, exit: &ExitInfo) -> bool {
    if !cfg!(debug_assertions) {
        return true;
    }
    if vm.probes().answer.replace(GO_ON) == EXIT {
        return options().learn_from_forced_exits;
    }
    if options().log_optimizer_coverage {
        vm.extension::<State>().cover_exit("taken", compiled, exit);
    }
    true
}
