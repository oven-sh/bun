//! The code for what a build with assertions is asked to try.

use bun_engine_asm::prelude::*;
use bun_engine_codegen::ir::{
    Action, EffectFlags, Effects, Heap, Input, Location, Token, Unary, Value as Ssa,
};
use bun_engine_vm::{Probes, Vm, call};
use smallvec::SmallVec;

use super::Lowering;
use super::emit::{Emitter, Site};
use super::operations::while_collecting;
use crate::graph::heaps::is_observable;
use crate::graph::probes::{Probe, are_checks_probed, is_wanted};
use crate::graph::{DEAD, ExitKind, Kind};
use crate::runtime::registers::*;

/// For the number of the probe and the operands.
const ROOM: i32 = 32;
const CHECKS_LEFT: Address = at(VM, Vm::OFFSET_OF_PROBES + Probes::OFFSET_OF_CHECKS_LEFT);
const ANSWER: Address = at(VM, Vm::OFFSET_OF_PROBES + Probes::OFFSET_OF_ANSWER);
const FORBIDDEN: Address = at(VM, Vm::OFFSET_OF_PROBES + Probes::OFFSET_OF_FORBIDDEN);

impl Lowering<'_> {
    fn probe(&mut self, probe: Probe, effects: Effects, operands: &[Ssa]) {
        let data = self.patchpoint(Action::Custom, Site::Probe(probe), effects);
        let inputs: SmallVec<[_; 2]> = operands.iter().map(|&it| (it, Input::Register)).collect();
        self.ir().patchpoint(&data, &inputs, &[]);
    }

    pub(super) fn verify(&mut self, claim: u32) {
        let (claim, made_at) = self.graph.claims[claim as usize];
        let probe = Probe::Holds(claim, self.origin, made_at);
        self.probe(probe, Kind::Verify.effects(), &self.operands());
    }

    pub(super) fn has_effect(&self) -> bool {
        let function = &self.graph.function;
        is_observable(function, function.effects(self.at).writes)
    }

    pub(super) fn probe_before(&mut self, kind: Kind, data: u32) {
        let stays = Effects::with_flags(EffectFlags::KEPT | EffectFlags::CONTROL_DEPENDENT);
        if is_wanted(|it| it.log_optimizer_coverage) {
            self.probe(Probe::Reached(self.origin, kind, data), stays, &[]);
        }
        if are_checks_probed() && kind.can_exit() && self.has_effect() {
            let exit = (self.graph).exit(ExitKind::Invalidated, self.origin, self.state);
            let never = self.int32(0);
            let never = self.ir().unary(Unary::Opaque, never);
            self.ir().check(never, exit);
        }
        if is_wanted(|it| it.collect_every_n_safepoints != 0) && kind.can_collect() {
            self.probe(Probe::MayCollect, while_collecting(Heap::NOTHING), &[]);
        }
        if is_wanted(|it| it.calls_per_forced_jettison != 0)
            && kind.effects().has(EffectFlags::FENCE)
        {
            self.probe(Probe::MayInvalidate, stays, &[]);
        }
    }
}

impl Emitter<'_> {
    /// Keeps all registers.
    pub(super) fn probe(
        &mut self,
        m: &mut MacroAssembler,
        probe: Probe,
        operands: &[Location],
        other_way: Option<Label>,
    ) {
        m.compute_address(SP, Address::new(SP, -ROOM));
        m.store64(at(SP, 0), self.number_for(probe));
        for (&operand, offset) in operands.iter().zip([8, 16]) {
            match operand {
                Location::Fpr(fpr) => m.store_f64(at(SP, offset), fpr),
                _ => m.store64(at(SP, offset), operand.gpr()),
            }
        }
        m.call_address(self.thunks.probe);
        m.compute_address(SP, Address::new(SP, ROOM));
        other_way.inspect(|&it| m.branch_if_not_zero32(ANSWER, it));
    }

    pub(super) fn probe_check(
        &mut self,
        m: &mut MacroAssembler,
        token: Token,
        exit: Label,
    ) -> bool {
        if are_checks_probed() {
            let is_late = self.graph.unforced_exits.binary_search(&token.0).is_ok();
            let probe = Probe::Passed(self.graph.exits[token.0 as usize], is_late);
            let passes = m.new_label();
            m.branch_add32_to_memory(ResultCond::NonZero, CHECKS_LEFT, -1, passes);
            self.probe(m, probe, &[], Some(exit));
            m.bind(passes);
        }
        are_checks_probed()
    }

    pub(super) fn forbid_what_is_not_expected(&mut self, m: &mut MacroAssembler, token: Token) {
        if is_wanted(|it| it.validate_effects) {
            m.store32(FORBIDDEN, self.forbidden[token.0 as usize].bits());
        }
    }

    pub(super) fn allow_everything(m: &mut MacroAssembler) {
        if is_wanted(|it| it.validate_effects) {
            m.store32(FORBIDDEN, 0);
        }
    }

    /// The stack pointer is where it belongs.
    pub(super) fn probe_return(&mut self, m: &mut MacroAssembler, may_throw: bool) {
        if is_wanted(|it| it.validate_effects) {
            let has_none = m.new_label();
            m.branch_if_zero64(at(VM, Vm::OFFSET_OF_EXCEPTION), has_none);
            m.breakpoint();
            m.bind(has_none);
        }
        if is_wanted(|it| it.operation_to_throw != 0) && may_throw {
            let throw = m.external_address(call::throw_from_frame());
            self.probe(m, Probe::DidNotThrow, &[], Some(throw));
        }
    }

    pub(super) fn clobber(m: &mut MacroAssembler, dead: impl FnOnce() -> RegisterSet) {
        if is_wanted(|it| it.clobber_what_is_dead) {
            let dead = dead();
            dead.gprs().for_each(|gpr| m.move64(gpr, DEAD));
            (dead.fprs()).for_each(|fpr| m.move_bits_to_float(FloatWidth::F64, fpr, VM));
        }
    }

    /// From the stack pointer up to that many bytes below the frame pointer. No register is in use.
    pub(super) fn clobber_frame(m: &mut MacroAssembler, kept: u32) {
        if is_wanted(|it| it.clobber_what_is_dead) {
            let ([next, end, dead, _], done) = (TEMPORARIES, m.new_label());
            m.compute_address(next, at(SP, 0));
            m.compute_address(end, Address::new(FP, -(kept as i32)));
            m.move64(dead, DEAD);
            let again = m.here();
            m.branch64(Cond::AboveEq, next, end, done);
            m.store64(at(next, 0), dead);
            m.add64(next, next, 8);
            m.jump(again);
            m.bind(done);
        }
    }
}
