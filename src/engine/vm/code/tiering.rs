//! When code moves up a tier.

use core::cell::Cell;
use std::rc::Rc;

use bun_engine_bytecode::{Body, Code, CodeFlags, CodeKind};
use bun_engine_platform::log;

use crate::{CodeBlock, Restrictions, Tier, Vm, options};

/// What a counter is set to for good. It does run out in the end, and is set again.
const NEVER: i32 = i32::MIN;

/// The code, and how far the interpreter has got with it. The next code block goes on from there.
pub(super) struct Bytecode {
    pub(super) code: Rc<Code>,
    counter: Cell<i32>,
    /// What the counter was when the warm-up of the code was last brought up to date.
    start: Cell<i32>,
}

impl Bytecode {
    pub(super) fn new(code: Rc<Code>) -> Bytecode {
        /// The compiler wants to know what the code does in this code block.
        const OWN_WARM_UP: i32 = 2 * CodeBlock::ENTRY_WEIGHT + 1;
        let threshold = options().threshold_for_baseline;
        let left = threshold.saturating_sub_unsigned(code.machine_code.warm_up.get());
        let start = if options().use_jit {
            -left.max(threshold.min(OWN_WARM_UP))
        } else {
            NEVER
        };
        Bytecode {
            code,
            counter: Cell::new(start),
            start: Cell::new(start),
        }
    }

    fn update_warm_up(&self) -> u32 {
        let (counter, warm_up) = (self.counter.get(), &self.code.machine_code.warm_up);
        let executions = counter.saturating_sub(self.start.replace(counter)).max(0);
        warm_up.update(|it| it.saturating_add_signed(executions));
        warm_up.get()
    }
}

impl Drop for Bytecode {
    fn drop(&mut self) {
        self.update_warm_up();
    }
}

/// As far as the code alone tells. If not, there is nothing to count or to record for.
pub fn is_optimizable(body: &Body) -> bool {
    const MAX_SIZE: usize = 400_000;
    const MAX_LIVENESS_WORDS: usize = 4_000_000;
    let size = body.instructions().len();
    options().use_quick_optimizer
        && !body.flags().contains(CodeFlags::HAS_DEBUG_HOOKS)
        && size <= MAX_SIZE
        && size * body.locals().div_ceil(64) as usize <= MAX_LIVENESS_WORDS
}

impl Vm {
    /// Code has to run that many times as much before it is compiled.
    pub fn set_tier_up_scale(&self, scale: f64) {
        let old = self.tier_up_scale.replace(scale.max(1.0));
        if !options().log_optimizer {
            return;
        }
        if scale > 1.0 {
            log(format_args!("Startup JIT deferral scale set to {scale}\n"));
        } else if old > 1.0 {
            let ending = "Ending startup JIT deferral window: embedder";
            log(format_args!("{ending} (scale was {old})\n"));
        }
    }
}

impl CodeBlock {
    /// What an entry counts for, where the turn of a loop counts one.
    pub const ENTRY_WEIGHT: i32 = 15;

    /// Once there is baseline code it stays run out, for the frames that have yet to change over.
    #[inline(always)]
    pub fn interpreter_counter(&self) -> &Cell<i32> {
        &self.bytecode.counter
    }

    /// Of the tier that it has reached.
    #[inline]
    pub fn execution_counter(&self) -> &Cell<i32> {
        match self.tier() {
            Tier::Interpreter => &self.bytecode.counter,
            _ => &self.execution_counter,
        }
    }

    fn set_counter(&self, value: i32) {
        if self.tier() == Tier::Interpreter {
            self.bytecode.update_warm_up();
            self.bytecode.start.set(value);
        }
        self.execution_counter().set(value);
    }

    pub(super) fn next_tier(&self) -> Option<Tier> {
        let options = options();
        let allows = |it| !self.executable().restrictions().contains(it);
        match self.tier() {
            Tier::Interpreter if options.use_baseline_jit => Some(Tier::Baseline),
            Tier::Interpreter | Tier::Baseline => (is_optimizable(self.body())
                && allows(Restrictions::NEVER_OPTIMIZE))
            .then_some(Tier::QuickOptimized),
            Tier::QuickOptimized => (options.use_full_optimizer
                && allows(Restrictions::NEVER_FULLY_OPTIMIZE))
            .then_some(Tier::FullyOptimized),
            Tier::FullyOptimized => None,
        }
    }

    /// Whether the types that its value profiles see are worth adding up.
    pub(super) fn gathers_predictions(&self) -> bool {
        self.next_tier() == Some(Tier::QuickOptimized)
    }

    pub fn threshold_for(&self, tier: Tier) -> i32 {
        const MOST_DOUBLINGS: u32 = 18;
        let mut factor = f64::from(1 << self.reoptimizations().min(MOST_DOUBLINGS));
        let threshold = match tier {
            Tier::Interpreter | Tier::Baseline => return options().threshold_for_baseline,
            Tier::QuickOptimized => options().threshold_for_quick_optimizer,
            Tier::FullyOptimized => options().threshold_for_full_optimizer,
        };
        factor *= 0.826 + 0.0615 * (self.body().instructions().len() as f64).sqrt();
        if self.body().kind() == CodeKind::Eval {
            factor *= 10.0;
        }
        ((f64::from(threshold) * factor) as i32).max(1)
    }

    fn count_for_a_period(&self) {
        self.set_counter(self.next_tier().map_or(NEVER, |it| -self.threshold_for(it)));
    }

    /// Starts to count towards the next tier, if there is one.
    pub fn tier_up_after_warm_up(&self) {
        self.periods.set(0);
        self.count_for_a_period();
    }

    /// For want of memory, which may become free.
    pub fn tier_up_much_later(&self) {
        self.set_counter(-(1 << 20));
    }

    pub fn never_tier_up(&self) {
        self.set_counter(NEVER);
    }

    /// The counter has run out: whether to compile now. If not, it counts anew.
    pub fn is_due_for_next_tier(&self, vm: &Vm) -> bool {
        const MACHINE_CODE_PER_BYTE: usize = 16;
        let Some(next_tier) = self.next_tier() else {
            self.never_tier_up();
            return false;
        };
        let size = self.body().instructions().len() * MACHINE_CODE_PER_BYTE;
        let mut periods = bun_engine_exec_memory::pressure(size);
        if periods.is_infinite() {
            self.tier_up_much_later();
            return false;
        }
        let installed = self.executable().code_block(self.specialization());
        if !self.is_optimized() && !installed.is_some_and(|it| it.is_optimized()) {
            periods *= vm.tier_up_scale.get();
        }
        if next_tier == Tier::Baseline {
            let threshold = f64::from(options().threshold_for_baseline);
            let left = threshold * (periods - 0.5) - f64::from(self.bytecode.update_warm_up());
            self.set_counter(-(left.clamp(0.0, threshold) as i32));
            return left <= 0.0;
        }
        self.periods.update(|it| it.saturating_add(1));
        let is_due = f64::from(self.periods.get()) >= periods - 0.5;
        if !is_due {
            self.count_for_a_period();
        }
        is_due
    }
}
