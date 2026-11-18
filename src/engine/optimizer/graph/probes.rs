//! What a build with assertions adds to the code on request, to try it in ways that programs seldom do.

use core::panic::Location;

use bun_engine_codegen::ir::{EffectFlags, Heap, Origin};
use bun_engine_vm::{Forbidden, Options, SpeculatedType, options};

use super::{ExitInfo, Graph, Kind, ModeSet, ShapeSet, heaps};

/// Whether the options ask for something that only such a build does.
#[inline(always)]
pub(crate) fn is_wanted(what: impl FnOnce(&Options) -> bool) -> bool {
    cfg!(debug_assertions) && what(options())
}

#[inline(always)]
pub(crate) fn are_checks_probed() -> bool {
    is_wanted(|it| {
        it.check_to_fail != 0 || it.checks_per_forced_exit != 0 || it.log_optimizer_coverage
    })
}

/// What the compiler takes to be certain of the operands.
#[derive(Clone, Copy, Debug)]
pub(crate) enum Claim {
    Type(SpeculatedType),
    Shapes(ShapeSet),
    Modes(ModeSet),
    /// So many bytes at this offset from the first operand are the second.
    Field(i32, u32, Heap),
    NeedsNoBarrier,
    /// The second operand is the first without its tag.
    Int32,
    Double,
    IsBoolean,
    IsInt52,
}

/// What the run time is called for. It tells whether to take the other way, where there is one.
#[derive(Clone, Copy)]
pub(crate) enum Probe {
    /// The other way is the exit, if it is not too late for that.
    Passed(ExitInfo, bool),
    Reached(Origin, Kind, u32),
    MayCollect,
    MayInvalidate,
    /// The other way is that of an exception.
    DidNotThrow,
    Holds(Claim, Origin, &'static Location<'static>),
}

impl Graph {
    /// The data of a `Verify`, if one is to be made.
    #[inline(always)]
    #[cfg_attr(debug_assertions, track_caller)]
    pub(crate) fn sample(&mut self, claim: Claim) -> Option<u32> {
        if !is_wanted(|it| it.validate_proofs)
            || self.random.next_f64() >= options().share_of_proofs_to_validate
        {
            return None;
        }
        self.claims.push((claim, Location::caller()));
        Some(self.claims.len() as u32 - 1)
    }

    pub(crate) fn forbidden_during(&self, kind: Kind) -> Forbidden {
        let (effects, mut forbidden) = (kind.effects(), Forbidden::empty());
        let invalidates = (self.function).may_alias(effects.writes, heaps::WATCHPOINT_STATES)
            || kind.calls_form() && kind.can_exit();
        forbidden.set(Forbidden::SCRIPTS, !effects.has(EffectFlags::FENCE));
        forbidden.set(Forbidden::COLLECTING, !kind.can_collect());
        forbidden.set(Forbidden::INVALIDATING, !invalidates);
        forbidden
    }
}
