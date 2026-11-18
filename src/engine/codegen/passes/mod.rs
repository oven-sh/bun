//! Transformations of functions. Each leaves a valid function without aliases.

mod bounds;
mod branches_to_selects;
mod construct_ssa;
mod copier;
mod dead_stores;
mod drop_assumptions;
mod duplicate_tails;
mod eliminate_dead_code;
mod eliminate_redundant_memory;
mod facts;
mod fold_path_constants;
mod hoist_loop_invariants;
mod induction;
mod infer_switches;
mod loop_effects;
mod lower_switches;
mod lower_total_division;
mod merges;
mod orderings;
mod peel_loops;
mod places;
mod preheaders;
mod reaching;
mod readability;
mod reassociate;
mod reduce_double_to_float;
mod rotate_loops;
mod simplify;
mod simplify_quickly;
mod sink_into_cold_blocks;
mod specialize_selects;
mod unroll_loops;
mod writes;

pub use copier::{Copier, CopyOfLoop, cost_of_copying};
pub use loop_effects::LoopEffects;
pub use peel_loops::peel_loops;
pub use preheaders::edge_from_preheader;

use crate::analysis::{Cfg, Dominators, Frequencies};
use crate::ir::{Function, validate};
use crate::target::Target;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Level {
    /// Only what instruction selection requires.
    Quick,
    Full,
}

/// Analyses, computed when a pass asks for them and kept until the control flow changes.
#[derive(Default)]
pub struct Analyses {
    cfg: Cfg,
    dominators: Dominators,
    frequencies: Frequencies,
    has_cfg: bool,
    has_dominators: bool,
    has_frequencies: bool,
    simplify: simplify::Tables,
    /// The revision of the function in which `simplify` would find nothing more.
    simplified_at: Option<usize>,
}

impl Analyses {
    /// After blocks or edges have been added, removed or redirected.
    pub fn invalidate(&mut self) {
        (self.has_cfg, self.has_dominators, self.has_frequencies) = (false, false, false);
        self.simplified_at = None;
    }

    /// Also removes the blocks that cannot be reached.
    pub fn cfg(&mut self, function: &mut Function) -> &Cfg {
        if !self.has_cfg {
            self.cfg.compute(function);
            self.cfg.remove_unreachable_blocks(function);
            self.has_cfg = true;
        }
        &self.cfg
    }

    pub fn dominators(&mut self, function: &mut Function) -> (&Cfg, &Dominators) {
        self.cfg(function);
        if !self.has_dominators {
            self.dominators.compute(function, &self.cfg);
            self.has_dominators = true;
        }
        (&self.cfg, &self.dominators)
    }

    pub fn frequencies(&mut self, function: &mut Function) -> (&Cfg, &Frequencies) {
        self.cfg(function);
        if !self.has_frequencies {
            self.frequencies.compute(function, &self.cfg);
            self.has_frequencies = true;
        }
        (&self.cfg, &self.frequencies)
    }

    pub fn all(&mut self, function: &mut Function) -> (&Cfg, &Dominators, &Frequencies) {
        self.dominators(function);
        self.frequencies(function);
        (&self.cfg, &self.dominators, &self.frequencies)
    }
}

#[cfg(debug_assertions)]
impl Analyses {
    /// The places in the source of the rules that `simplify` has applied since this was called first.
    pub fn take_fired_rules(&mut self) -> Vec<&'static core::panic::Location<'static>> {
        self.simplify
            .fired_rules
            .replace(Vec::new())
            .unwrap_or_default()
    }
}

pub struct Pass {
    pub name: &'static str,
    run: fn(&mut Function, &mut Analyses, Target),
}

macro_rules! passes {
    ($($constant:ident: $name:ident,)*) => {
        impl Pass {
            $(pub const $constant: Self = Self { name: stringify!($name), run: $name::run };)*
            pub const ALL: &[Self] = &[$(Self::$constant),*];
        }
    };
}

passes! {
    BRANCHES_TO_SELECTS: branches_to_selects,
    CONSTRUCT_SSA: construct_ssa,
    DROP_ASSUMPTIONS: drop_assumptions,
    DUPLICATE_TAILS: duplicate_tails,
    ELIMINATE_DEAD_CODE: eliminate_dead_code,
    ELIMINATE_REDUNDANT_MEMORY: eliminate_redundant_memory,
    FOLD_PATH_CONSTANTS: fold_path_constants,
    HOIST_LOOP_INVARIANTS: hoist_loop_invariants,
    INFER_SWITCHES: infer_switches,
    LOWER_SWITCHES: lower_switches,
    LOWER_TOTAL_DIVISION: lower_total_division,
    REASSOCIATE: reassociate,
    REDUCE_DOUBLE_TO_FLOAT: reduce_double_to_float,
    ROTATE_LOOPS: rotate_loops,
    SIMPLIFY: simplify,
    SIMPLIFY_QUICKLY: simplify_quickly,
    SINK_INTO_COLD_BLOCKS: sink_into_cold_blocks,
    SPECIALIZE_SELECTS: specialize_selects,
    UNROLL_LOOPS: unroll_loops,
}

const QUICK: &[Pass] = &[
    Pass::CONSTRUCT_SSA,
    Pass::LOWER_SWITCHES,
    Pass::LOWER_TOTAL_DIVISION,
    Pass::DROP_ASSUMPTIONS,
];

const FULL: &[Pass] = &[
    Pass::CONSTRUCT_SSA,
    Pass::REDUCE_DOUBLE_TO_FLOAT,
    Pass::SIMPLIFY,
    Pass::REASSOCIATE,
    Pass::SPECIALIZE_SELECTS,
    Pass::FOLD_PATH_CONSTANTS,
    Pass::HOIST_LOOP_INVARIANTS,
    Pass::ROTATE_LOOPS,
    Pass::ELIMINATE_REDUNDANT_MEMORY,
    Pass::SIMPLIFY,
    Pass::ELIMINATE_DEAD_CODE,
    Pass::INFER_SWITCHES,
    Pass::DUPLICATE_TAILS,
    Pass::FOLD_PATH_CONSTANTS,
    Pass::LOWER_SWITCHES,
    Pass::LOWER_TOTAL_DIVISION,
    Pass::BRANCHES_TO_SELECTS,
    Pass::DROP_ASSUMPTIONS,
    Pass::SIMPLIFY,
    Pass::ELIMINATE_DEAD_CODE,
    Pass::SINK_INTO_COLD_BLOCKS,
];

impl Pass {
    pub fn pipeline(level: Level) -> &'static [Pass] {
        match level {
            Level::Quick => QUICK,
            Level::Full => FULL,
        }
    }

    pub fn named(name: &str) -> &'static Pass {
        FULL.iter()
            .find(|pass| pass.name == name)
            .expect("there is such a pass")
    }

    pub fn run(&self, function: &mut Function, analyses: &mut Analyses, target: Target) {
        (self.run)(function, analyses, target);
        if cfg!(debug_assertions)
            && let Err(problem) = validate(function)
        {
            panic!("after {}: {problem}\n{function:?}", self.name);
        }
    }
}
