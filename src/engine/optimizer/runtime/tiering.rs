//! When to compile what, and when to give code up.

use core::cell::{Cell, RefCell};

use bun_engine_bytecode::{CodeFlags, CodeKind, Register};
use bun_engine_codegen::passes::Level;
use bun_engine_macros::native_abi;
use bun_engine_platform::log;
use bun_engine_vm::heap::Scope;
use bun_engine_vm::{
    CallFrame, CodeBlock, FunctionExecutable, Gc, OptimizerState, Restrictions, SpeculatedType,
    Tier, Value, Vm, Weak, options,
};

use super::code::Compiled;
use super::plan::{Compiler, Plan, tier_of};
use crate::builder::{Running, ValueIn};
use crate::graph::Entry;

const NEVER: i32 = i32::MIN;
/// How long to go on before asking again.
const PATIENCE: i32 = 100;
/// The same while the compiler is at work, by level.
const PATIENCE_WITH_COMPILER: [i32; 2] = [600, 5000];
/// A profile has only the latest value, so it is looked at a few times, at intervals that match no period.
const PAUSES_BETWEEN_SAMPLES: [i32; 4] = [47, 61, 31, 73];
const DESIRED_COVERAGE_IN_PERCENT: usize = 75;
const MOST_DELAYS: u8 = 5;
const MOST_DOUBLINGS: u32 = 18;
const LOOP_CODE_KEPT: usize = 4;

#[derive(Default)]
struct Plans {
    pending: RefCell<Vec<Plan>>,
    /// By level.
    started: [Cell<u32>; 2],
    compiler: RefCell<Compiler>,
    /// Until the frames that have asked for it come to get it.
    latest_loop_code: RefCell<Vec<bun_engine_vm::Strong<Gc<CodeBlock>>>>,
}

// SAFETY: plans root what they refer to.
unsafe impl bun_engine_vm::GcFree for Plans {}

#[derive(Default)]
struct Progress {
    /// By level.
    has_given_up: [Cell<bool>; 2],
    /// The counter has run out in a loop, and is now to tell whether the loop goes on or the function is called again.
    is_probing: Cell<bool>,
    loop_code: RefCell<Vec<Weak<CodeBlock>>>,
    /// Of the profiles, since the warm-up has ended.
    samples: Cell<u8>,
    /// For want of coverage.
    delays: Cell<u8>,
    last_coverage: Cell<usize>,
    was_fully_optimized: Cell<bool>,
}

impl OptimizerState for Progress {}

pub(super) fn name_of(code_block: &CodeBlock) -> String {
    match code_block.executable().downcast::<FunctionExecutable>() {
        Some(function) => format!(
            "{}#{:x}",
            function.name_text(),
            code_block.address() >> 4 & 0xffff
        ),
        None => format!("<{:?}>", code_block.body().kind()),
    }
}

fn scaled(amount: u32, code_block: &CodeBlock) -> u32 {
    amount.saturating_mul(1 << code_block.reoptimizations().min(MOST_DOUBLINGS))
}

fn arm(code_block: &CodeBlock, amount: i32) {
    code_block.execution_counter().set(-amount);
}

fn arm_for_warm_up(code_block: &CodeBlock, level: Level) {
    arm(code_block, code_block.threshold_for(tier_of(level)));
}

fn wait_for_compiler(code_block: &CodeBlock, level: Level) {
    let threshold = code_block.threshold_for(tier_of(level));
    arm(
        code_block,
        threshold.min(PATIENCE_WITH_COMPILER[level as usize]),
    );
}

/// If not, the counter says when to look again.
fn is_profiled_enough(baseline: &CodeBlock) -> bool {
    let progress = baseline.optimizer_state::<Progress>();
    baseline.update_predictions();
    if options().threshold_for_quick_optimizer < PATIENCE {
        return true;
    }
    let (covered, all) = baseline.coverage();
    if covered * 100 < all * DESIRED_COVERAGE_IN_PERCENT
        && progress.last_coverage.replace(covered) != covered
        && progress.delays.get() < MOST_DELAYS
    {
        progress.delays.update(|it| it + 1);
        arm_for_warm_up(baseline, Level::Quick);
        return false;
    }
    let taken = progress.samples.take();
    let pause = PAUSES_BETWEEN_SAMPLES.get(usize::from(taken));
    if let Some(&pause) = pause {
        progress.samples.set(taken + 1);
        arm(baseline, pause);
    }
    pause.is_none()
}

fn may_optimize(vm: &Vm, baseline: &CodeBlock, level: Level) -> bool {
    let restrictions = baseline.executable().restrictions();
    let is_wanted = match level {
        Level::Quick => options().use_quick_optimizer,
        Level::Full => {
            options().use_full_optimizer
                && !restrictions.contains(Restrictions::NEVER_FULLY_OPTIMIZE)
        }
    };
    is_wanted
        && !restrictions.contains(Restrictions::NEVER_OPTIMIZE)
        && !baseline.body().flags().contains(CodeFlags::HAS_DEBUG_HOOKS)
        && !vm.has_debugger()
        && !baseline.optimizer_state::<Progress>().has_given_up[level as usize].get()
}

fn installed(baseline: &CodeBlock) -> Option<Gc<CodeBlock>> {
    let installed = baseline.executable().code_block(baseline.specialization());
    installed.filter(|it| it.baseline() == baseline.into())
}

fn installed_tier(baseline: &CodeBlock) -> Tier {
    installed(baseline).map_or(Tier::FullyOptimized, |it| it.tier())
}

fn loop_code(vm: &Vm, baseline: &CodeBlock, offset: u32) -> Option<Gc<CodeBlock>> {
    let mut all = baseline
        .optimizer_state::<Progress>()
        .loop_code
        .borrow_mut();
    all.retain(|it| it.get(vm).is_some_and(|it| !it.is_jettisoned()));
    let alive = all.iter().filter_map(|it| it.get(vm));
    let fitting = alive.filter(|it| Compiled::of(it).kind == Entry::Loop(offset));
    fitting.max_by_key(|it| it.tier())
}

fn install(vm: &Vm, plans: &Plans, plan: Plan) {
    let (baseline, level, entry) = (plan.code_block.get(vm), plan.level, plan.entry);
    let progress = baseline.anchor().optimizer_state::<Progress>();
    let finished = if vm.has_debugger() {
        Ok(None)
    } else {
        plan.finish(vm)
    };
    if options().log_optimizer {
        let outcome = finished.map(|it| it.is_some());
        let name = name_of(&baseline);
        log(format_args!(
            "install {name} {level:?} {entry:?}: {outcome:?}\n"
        ));
    }
    let optimized = match finished {
        Ok(Some(optimized)) => optimized,
        Ok(None) => return,
        Err(_) => return progress.has_given_up[level as usize].set(true),
    };
    arm_for_warm_up(&optimized, Level::Full);
    (progress.was_fully_optimized).update(|it| it || level == Level::Full);
    if let Entry::Loop(_) = entry {
        progress
            .loop_code
            .borrow_mut()
            .push(Weak::new(vm, optimized));
        let mut latest = plans.latest_loop_code.borrow_mut();
        latest.insert(0, bun_engine_vm::Strong::new(vm, optimized));
        latest.truncate(LOOP_CODE_KEPT);
    } else if installed_tier(&baseline) < optimized.tier() {
        let (specialization, address) = (baseline.specialization(), Compiled::of(&optimized).entry);
        // SAFETY: made from the code block that was installed.
        unsafe { (baseline.executable()).install(specialization, address, Some(optimized)) };
    }
}

fn install_what_is_done(vm: &Vm, plans: &Plans) {
    loop {
        let mut pending = plans.pending.borrow_mut();
        let Some(position) = pending.iter().position(Plan::is_done) else {
            return;
        };
        let plan = pending.swap_remove(position);
        drop(pending);
        install(vm, plans, plan);
    }
}

fn is_pending(vm: &Vm, plans: &Plans, baseline: Gc<CodeBlock>, level: Level) -> bool {
    let pending = plans.pending.borrow();
    (pending.iter()).any(|plan| plan.level == level && plan.code_block.get(vm) == baseline)
}

fn compile(
    vm: &Vm,
    plans: &Plans,
    baseline: Gc<CodeBlock>,
    what: (Level, Entry),
    frame: &CallFrame,
    value_in: &ValueIn<'_>,
) {
    let started = &plans.started[what.0 as usize];
    let number = started.replace(started.get() + 1);
    let options = options();
    let give_up = || baseline.optimizer_state::<Progress>().has_given_up[what.0 as usize].set(true);
    if (what.0 == Level::Full) == options.use_full_optimizer
        && !(options.first_plan_to_compile..=options.last_plan_to_compile).contains(&number)
    {
        return give_up();
    }
    if options.log_optimizer {
        log(format_args!(
            "plan {number}: {} {what:?}\n",
            name_of(&baseline)
        ));
    }
    let mut compiler = plans.compiler.borrow_mut();
    let here = (!options.use_concurrent_jit).then_some(&mut *compiler);
    let running = Running {
        argument_count: frame.argument_count_including_this(),
        value_in,
    };
    let seed = options.seed_of_probes ^ (number * 2 + what.0 as u32).wrapping_mul(0x9e37_79b9);
    let started = Plan::start(vm, baseline, what, &running, seed, here);
    drop(compiler);
    match started {
        Ok(plan) if plan.is_done() => install(vm, plans, plan),
        Ok(plan) => plans.pending.borrow_mut().push(plan),
        Err(_) => give_up(),
    }
}

fn has_room_for(vm: &Vm, frame: &CallFrame, optimized: &CodeBlock) -> bool {
    let needed = Compiled::of(optimized).tables.frame_size as usize;
    frame.address().saturating_sub(needed) >= vm.soft_stack_limit()
}

/// The frame is that of a lower tier at the head of the loop. Returns where it goes on.
pub(super) fn enter_loop(frame: &CallFrame, optimized: Gc<CodeBlock>) -> usize {
    // SAFETY: the caller jumps there.
    unsafe { frame.set_code_block(Some(optimized)) };
    frame.set_call_site(0);
    optimized.write_barrier_for_cell();
    Compiled::of(&optimized).entry
}

/// The next attempt waits longer.
pub(super) fn give_up_on(vm: &Vm, optimized: &CodeBlock, reason: &str) {
    if optimized.is_jettisoned() {
        return;
    }
    if options().log_optimizer {
        let name = name_of(&optimized.baseline());
        log(format_args!("give up on {name}: {reason}\n"));
    }
    optimized.count_reoptimization();
    optimized.jettison(vm);
}

fn jettison_if_it_keeps_exiting(vm: &Vm, optimized: Gc<CodeBlock>, allowed: u32) -> bool {
    let is_over = Compiled::of(&optimized).exits_taken.get() >= scaled(allowed, &optimized);
    if is_over {
        give_up_on(vm, &optimized, "keeps exiting");
    }
    is_over
}

fn is_jumped_to(code_block: &CodeBlock, offset: u32) -> bool {
    code_block.liveness().is_ok_and(|liveness| {
        let graph = liveness.graph();
        graph.range(graph.block_at(offset)).start == offset
    })
}

/// The counter of a code block that is not optimized has run out.
pub fn tier_up(
    vm: &Vm,
    baseline: &CodeBlock,
    frame: &CallFrame,
    loop_offset: Option<u32>,
) -> usize {
    baseline.execution_counter().set(NEVER);
    if !may_optimize(vm, baseline, Level::Quick) {
        return 0;
    }
    let (plans, baseline) = (vm.extension::<Plans>(), Gc::from(baseline));
    install_what_is_done(vm, &plans);
    let is_function = matches!(baseline.body().kind(), CodeKind::Call | CodeKind::Construct);
    let lacks_entry = || is_function && installed_tier(&baseline) < Tier::QuickOptimized;
    let is_pending =
        || [Level::Quick, Level::Full].map(|it| is_pending(vm, &plans, baseline, it)) != [false; 2];
    let progress = baseline.anchor().optimizer_state::<Progress>();
    let level = if progress.was_fully_optimized.get() && may_optimize(vm, &baseline, Level::Full) {
        Level::Full
    } else {
        Level::Quick
    };
    let value_in = |register: Register| {
        // SAFETY: a register of the code that is live.
        let value =
            unsafe { Value::from_bits_or_empty(frame.slot(register.offset() as isize).get()) };
        (Value::bits_of(value), SpeculatedType::of(value))
    };
    let compile = |entry| compile(vm, &plans, baseline, (level, entry), frame, &value_in);
    let find = || {
        let found = loop_code(vm, &baseline, loop_offset?);
        found.filter(|&it| !jettison_if_it_keeps_exiting(vm, it, options().exits_allowed_in_loop))
    };
    let enter = |optimized: Gc<CodeBlock>| {
        if !has_room_for(vm, frame, &optimized) {
            arm(&baseline, PATIENCE);
            return 0;
        }
        arm_for_warm_up(&baseline, Level::Quick);
        enter_loop(frame, optimized)
    };
    let was_entered = baseline.has_been_entered();
    if find().is_some() && was_entered && lacks_entry() && !is_pending() {
        compile(Entry::Function);
    }
    if let Some(optimized) = find() {
        return enter(optimized);
    }
    if is_pending() {
        wait_for_compiler(&baseline, Level::Quick);
        return 0;
    }
    if loop_offset.is_some_and(|offset| !is_jumped_to(&baseline, offset)) {
        // This one runs again, and the next gets to ask.
        arm(&baseline, 2);
        return 0;
    }
    if let Some(optimized) = installed(&baseline).filter(|it| it.is_optimized()) {
        jettison_if_it_keeps_exiting(vm, optimized, options().exits_allowed_in_loop);
    }
    if loop_offset.is_none() && !lacks_entry() {
        arm_for_warm_up(&baseline, Level::Quick);
        return 0;
    }
    if !progress.is_probing.get() && !is_profiled_enough(&baseline) {
        return 0;
    }
    let entry = match loop_offset {
        Some(_) if lacks_entry() && !progress.is_probing.replace(true) => {
            arm(
                &baseline,
                PATIENCE.min(options().threshold_for_quick_optimizer),
            );
            return 0;
        }
        Some(offset) if !(lacks_entry() && was_entered) => Entry::Loop(offset),
        _ => Entry::Function,
    };
    progress.is_probing.set(false);
    compile(entry);
    wait_for_compiler(&baseline, Level::Quick);
    find().map_or(0, enter)
}

/// Returns false if there is nothing left to wait for.
fn optimize_entry_fully(
    vm: &Vm,
    plans: &Plans,
    baseline: Gc<CodeBlock>,
    frame: &CallFrame,
) -> bool {
    if is_pending(vm, plans, baseline, Level::Full) {
        return true;
    }
    let is_due = installed_tier(&baseline) == Tier::QuickOptimized;
    if is_due {
        let what = (Level::Full, Entry::Function);
        compile(vm, plans, baseline, what, frame, &|_| unreachable!());
    }
    is_due
}

/// The counter of optimized code has run out where no other code can take over.
#[native_abi]
pub(super) unsafe fn optimize_fully(vm: &Vm, _: u64, frame: &CallFrame) {
    let optimized = frame.code_block().expect("a frame of optimized code");
    let (plans, baseline) = (vm.extension::<Plans>(), optimized.baseline());
    optimized.execution_counter().set(NEVER);
    install_what_is_done(vm, &plans);
    if !may_optimize(vm, &baseline, Level::Full) {
        return;
    }
    if optimize_entry_fully(vm, &plans, baseline, frame) {
        wait_for_compiler(&optimized, Level::Full);
    } else {
        // So that a loop of its own gets to ask.
        arm(&optimized, 0);
    }
}

/// The same at the head of a loop. Gives the code that can.
pub(super) fn optimize_loop_fully(
    vm: &Vm,
    optimized: Gc<CodeBlock>,
    frame: &CallFrame,
    offset: u32,
    value_in: &ValueIn<'_>,
) -> Option<Gc<CodeBlock>> {
    let (plans, baseline) = (vm.extension::<Plans>(), optimized.baseline());
    optimized.execution_counter().set(NEVER);
    install_what_is_done(vm, &plans);
    let find = || {
        let found = loop_code(vm, &baseline, offset);
        found.filter(|it| it.tier() == tier_of(Level::Full))
    };
    if let Some(better) = find() {
        arm(&optimized, PATIENCE);
        return has_room_for(vm, frame, &better).then_some(better);
    }
    if !may_optimize(vm, &baseline, Level::Full) {
        return None;
    }
    wait_for_compiler(&optimized, Level::Full);
    let was_called = Compiled::of(&optimized).kind == Entry::Function;
    if is_pending(vm, &plans, baseline, Level::Full)
        || was_called && optimize_entry_fully(vm, &plans, baseline, frame)
    {
        return None;
    }
    let what = (Level::Full, Entry::Loop(offset));
    compile(vm, &plans, baseline, what, frame, value_in);
    find().filter(|it| has_room_for(vm, frame, it))
}

pub(super) fn did_exit(vm: &Vm, optimized: Gc<CodeBlock>, is_counted: bool) {
    if optimized.is_jettisoned() {
        return;
    }
    if is_counted {
        (Compiled::of(&optimized).exits_taken).update(|count| count + 1);
        if jettison_if_it_keeps_exiting(vm, optimized, options().exits_allowed) {
            return;
        }
    }
    let baseline = optimized.baseline();
    if (baseline.optimizer_state::<Progress>().loop_code.borrow()).is_empty() {
        arm_for_warm_up(&baseline, Level::Quick);
    } else {
        arm(&baseline, PATIENCE);
    }
}

/// What nobody has come for is not to keep anything alive.
pub fn did_collect(vm: &Vm, scope: Scope) {
    if let Some(plans) = vm
        .existing_extension::<Plans>()
        .filter(|_| scope == Scope::Full)
    {
        plans.pending.borrow_mut().retain(|plan| !plan.is_done());
        plans.latest_loop_code.borrow_mut().clear();
    }
}

/// Frames leave the code as soon as they can, and calls go to the tier below.
pub fn jettison(_: &Vm, optimized: &CodeBlock) {
    let baseline = optimized.baseline();
    if options().log_optimizer {
        log(format_args!("jettison {}\n", name_of(&baseline)));
    }
    optimized.compiled().expect("optimized").invalidate();
    if installed(&baseline) == Some(optimized.into()) {
        let entry = bun_engine_baseline::entry(&baseline);
        // SAFETY: the entry for that code block.
        unsafe {
            (baseline.executable()).install(baseline.specialization(), entry, Some(baseline))
        };
    }
    arm_for_warm_up(&baseline, Level::Quick);
}
