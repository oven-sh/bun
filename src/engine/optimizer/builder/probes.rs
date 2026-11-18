//! Has the code verify what is taken to be known, and makes up what profiles say.

use bun_engine_bytecode::Register;
use bun_engine_codegen::ir::{State, Value as Ssa};
use bun_engine_vm::{CodeBlock, ExitKind, ExitKinds};

use super::Builder;
use crate::graph::probes::{Claim, is_wanted};
use crate::graph::{DEAD, Kind, heaps};

impl Builder<'_> {
    #[inline(always)]
    #[cfg_attr(debug_assertions, track_caller)]
    pub(super) fn verify(&mut self, claim: Claim, operands: &[Ssa]) {
        if !self.needs_invalidation_point
            && let Some(data) = self.graph.sample(claim)
        {
            self.insert_node(Kind::Verify, operands, data, State::NONE);
        }
    }

    pub(super) fn verify_some_of_what_is_known(&mut self) {
        const ONE_PLACE_IN: u32 = 4;
        if is_wanted(|it| it.validate_proofs)
            && self.graph.random.next_u32().is_multiple_of(ONE_PLACE_IN)
        {
            for (claim, operands) in self.knowledge.claims() {
                self.verify(claim, &operands);
            }
        }
    }

    pub(super) fn make_up_profiles(&mut self, code_block: &CodeBlock) {
        if is_wanted(|it| it.randomize_profiles) {
            code_block.scramble_profiles(&mut self.graph.random);
        }
    }

    pub(super) fn with_made_up_exits(&mut self, mut exits: ExitKinds) -> ExitKinds {
        const ONE_IN: u32 = 5;
        while is_wanted(|it| it.randomize_profiles)
            && self.graph.random.next_u32().is_multiple_of(ONE_IN)
        {
            let kind = self.graph.random.next_u32() as usize % ExitKind::COUNT;
            exits.insert(ExitKind::from_u8(kind as u8));
        }
        exits
    }

    /// Before the interpreter gets those that an instruction names.
    pub(super) fn clobber_locals(&mut self, area: Ssa) {
        if is_wanted(|it| it.clobber_what_is_dead) {
            let dead = self.word(DEAD as usize);
            for index in 0..self.frame().code_block.locals() {
                let offset = Register::local(index).offset() * 8;
                self.ir().store(dead, area, offset, heaps::FRAME);
            }
        }
    }
}
