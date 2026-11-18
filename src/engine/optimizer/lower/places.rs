//! What marks a place in the code.

use bun_engine_codegen::ir::{Action, EffectFlags, Effects, Heap, Input, Value as Ssa};
use bun_engine_vm::SpeculatedType as T;

use super::emit::Site;
use super::operations::while_collecting;
use super::{Lowering, Odds};
use crate::graph::probes::is_wanted;
use crate::graph::{DEAD, ExitKind, Kind, heaps};

impl Lowering<'_> {
    fn exiting_patchpoint(&mut self, site: Site, effects: Effects, scratch_gprs: u8) {
        let mut data = self.patchpoint(Action::Custom, site, effects);
        (data.state, data.scratch_gprs) = (self.state, scratch_gprs);
        self.ir().patchpoint(&data, &[], &[]);
    }

    pub(super) fn invalidation_point(&mut self) {
        let site = Site::InvalidationPoint(self.exit(ExitKind::Invalidated).token);
        self.exiting_patchpoint(site, Kind::InvalidationPoint.effects(), 0);
    }

    pub(super) fn force_exit(&mut self, kind: ExitKind) {
        let always = self.int32(1);
        self.exit_if(always, kind);
        self.ir().unreachable();
    }

    pub(super) fn poll_traps(&mut self) {
        let site = Site::PollTraps(self.exit(ExitKind::Trap).token);
        self.exiting_patchpoint(site, Kind::PollTraps.effects(), 0);
    }

    pub(super) fn count_turn(&mut self) {
        self.exiting_patchpoint(Site::CountTurn, Kind::CountTurn.effects(), 1);
    }

    pub(super) fn tier_up_in_loop(&mut self) {
        let site = Site::TierUpInLoop(self.exit(ExitKind::TierUp).token);
        let mut effects = while_collecting(Heap::NOTHING);
        effects.flags |= EffectFlags::EXITS;
        self.exiting_patchpoint(site, effects, 1);
    }

    pub(super) fn tier_up_at_return(&mut self) {
        self.exiting_patchpoint(Site::TierUpAtReturn, while_collecting(Heap::NOTHING), 1);
    }

    pub(super) fn keep_alive(&mut self, cell: Ssa) {
        let effects = Effects::with_flags(EffectFlags::KEPT);
        let data = self.patchpoint(Action::Custom, Site::Nothing, effects);
        (self.ir()).patchpoint(&data, &[(cell, Input::ColdAnywhere)], &[]);
    }

    pub(super) fn store_barrier(&mut self, owner: Ssa, stored: Ssa) {
        let effects = Effects {
            writes: heaps::SIDE_STATE,
            ..Effects::with_flags(EffectFlags::CONTROL_DEPENDENT)
        };
        let mut data = self.patchpoint(Action::Custom, Site::Barrier, effects);
        data.scratch_gprs = 1;
        let emit = |this: &mut Self| {
            (this.ir()).patchpoint(&data, &[(owner, Input::Register)], &[]);
        };
        let expected = (stored.expand()).map(|it| self.graph.prediction(self.graph.root(it)));
        if expected.is_some_and(|it| !it.is_empty() && !it.intersects(T::CELL)) {
            let is_cell = self.is_cell(stored);
            self.when(is_cell, Odds::Low, emit);
        } else {
            emit(self);
        }
    }

    /// One serves all instructions.
    pub(super) fn shadow_frame(&mut self) -> Ssa {
        let (area, function) = (self.graph.shadow_frame, &mut self.graph.function);
        let words = (area.highest - area.lowest + 1) as u32;
        let slot = *(self.shadow_frame).get_or_insert_with(|| function.add_slot(words * 8, 8));
        let base = function.slot_address(slot);
        if is_wanted(|it| it.clobber_what_is_dead) {
            let dead = self.word(DEAD);
            (0..words as usize).for_each(|it| self.store(dead, base, it * 8, heaps::FRAME));
        }
        self.ir().add(base, i64::from(-area.lowest) * 8)
    }
}
