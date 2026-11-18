//! What baseline code has seen.

use bun_engine_wasm_format::{CodeIndex, Module};
use smallvec::SmallVec;

#[derive(Default)]
pub struct CallFeedback {
    pub count: u32,
    /// For indirect calls, the functions of this module that were reached, and how often. Empty if they are too many.
    pub targets: SmallVec<[(CodeIndex, u32); 4]>,
}

pub trait Feedback {
    /// How often the function was entered, roughly. Zero if nothing is known about it.
    fn entry_count(&self, code: CodeIndex) -> u32;
    /// How often control passed the start of the loop, roughly. `index` counts the loops in the body of the function.
    fn loop_turns(&self, code: CodeIndex, index: u32) -> u32;
    /// `site` counts the calls in the body of the function.
    fn call(&self, code: CodeIndex, site: u32) -> CallFeedback;
    /// The same for all functions of a module.
    fn inlining_budget(&self) -> InliningBudget;
}

/// How much a function may grow.
#[derive(Clone, Copy, Debug)]
pub struct InliningBudget {
    pub(super) growth_factor: f32,
    pub(super) cap: f32,
}

impl InliningBudget {
    /// A module with few small functions has been through an inliner, so more of it gains little.
    pub fn new(module: &Module) -> Self {
        const SMALL_SIZE: u32 = 50;
        const FEW: f32 = 0.25;
        const MANY: f32 = 0.5;
        const GROWTH_FACTORS: [f32; 2] = [2.0, 5.0];
        const CAPS: [f32; 2] = [600.0, 6000.0];

        let count = module.code_count();
        let is_small = |&code: &u32| module.body_span(CodeIndex(code)).len < SMALL_SIZE;
        let share = (0..count).filter(is_small).count() as f32 / count.max(1) as f32;
        let position = ((share - FEW) / (MANY - FEW)).clamp(0.0, 1.0);
        let between = |[low, high]: [f32; 2]| low + (high - low) * position;
        Self {
            growth_factor: between(GROWTH_FACTORS),
            cap: between(CAPS),
        }
    }
}
