//! Operations on vectors that every architecture leaves to its macro assembler.

use bun_engine_asm::{
    Reuse, ScratchNeeds, Sign, VectorAssembly, VectorBinary, VectorReduce, VectorShift,
    VectorTernary, VectorUnary,
};

use super::emit::{Isa, Operands};
use super::lower::Lowering;
use super::shared::{SharesInstructions, with_temps};
use crate::ir::{Lanes, Op, Value, VectorConstant};

/// The operands are the result, the temporaries of each bank, and the sources.
#[derive(Clone, Copy, Debug)]
pub(crate) struct VectorInstruction {
    operation: Operation,
    temps: ScratchNeeds,
}

#[derive(Clone, Copy, Debug)]
enum Operation {
    Unary(VectorUnary),
    Binary(VectorBinary),
    Ternary(VectorTernary),
    Shift(VectorShift),
    ShiftByConstant(VectorShift, u8),
    Reduce(VectorReduce),
    Shuffle(VectorConstant),
    Splat(Lanes),
    Extract(Lanes, Sign, u8),
    Replace(Lanes, u8),
}

impl<I: Isa<Masm: VectorAssembly> + SharesInstructions> Lowering<'_, I> {
    pub(crate) fn match_vector(&mut self, value: Value) -> VectorInstruction {
        let (features, op) = (self.features, self.op(value));
        let mut operands = op.inline_operands();
        let (operation, needs, reuse) = match op {
            Op::VectorUnary(op, _) => (
                Operation::Unary(op),
                I::Masm::scratch_for_unary(features, op),
                I::Masm::reuse_for_unary(features, op),
            ),
            Op::VectorBinary(op, _) => (
                Operation::Binary(op),
                I::Masm::scratch_for_binary(features, op),
                I::Masm::reuse_for_binary(features, op),
            ),
            Op::VectorTernary(op, _) => (
                Operation::Ternary(op),
                I::Masm::scratch_for_ternary(features, op),
                I::Masm::reuse_for_ternary(features, op),
            ),
            Op::VectorShift(op, [_, amount]) => {
                let constant = self.int_constant(amount);
                operands = &operands[..2 - usize::from(constant.is_some())];
                (
                    constant.map_or(Operation::Shift(op), |amount| {
                        Operation::ShiftByConstant(op, amount as u8)
                    }),
                    I::Masm::scratch_for_shift(features, op, constant.is_some()),
                    I::Masm::reuse_for_shift(features),
                )
            }
            Op::VectorReduce(op, _) => (
                Operation::Reduce(op),
                I::Masm::scratch_for_reduce(features, op),
                Reuse::empty(),
            ),
            Op::Shuffle(_, lanes) => {
                let bytes = self.function.vector_constant(lanes).to_le_bytes();
                (
                    Operation::Shuffle(lanes),
                    I::Masm::scratch_for_shuffle(features, bytes),
                    I::Masm::reuse_for_shuffle(features, bytes),
                )
            }
            Op::Splat(lanes, _) => (Operation::Splat(lanes), I::RESERVED, Reuse::FIRST),
            Op::ExtractLane {
                lanes, sign, lane, ..
            } => (
                Operation::Extract(lanes, sign, lane),
                I::RESERVED,
                Reuse::FIRST,
            ),
            Op::ReplaceLane { lanes, lane, .. } => (
                Operation::Replace(lanes, lane),
                I::RESERVED,
                I::Masm::reuse_for_replace_lane(features),
            ),
            _ => unreachable!("not an operation on vectors in registers"),
        };
        let mut reused = reuse.iter().map(|operand| operand.bits().ilog2() as u8);
        let temps = self.use_with_temps(value, needs, [reused.next(), reused.next()], operands);
        VectorInstruction { operation, temps }
    }
}

impl VectorInstruction {
    pub(crate) fn emit<I: SharesInstructions>(
        self,
        masm: &mut impl VectorAssembly,
        mut operands: Operands<'_>,
    ) {
        let dst = operands.location();
        with_temps::<I, _>(masm, self.temps, &mut operands, |masm, o| {
            match self.operation {
                Operation::Unary(op) => masm.vector_unary(op, dst.fpr(), o.fpr()),
                Operation::Binary(op) => masm.vector_binary(op, dst.fpr(), o.fpr(), o.fpr()),
                Operation::Ternary(op) => {
                    masm.vector_ternary(op, dst.fpr(), o.fpr(), o.fpr(), o.fpr())
                }
                Operation::Shift(op) => masm.vector_shift(op, dst.fpr(), o.fpr(), o.gpr()),
                Operation::ShiftByConstant(op, amount) => {
                    masm.vector_shift(op, dst.fpr(), o.fpr(), amount)
                }
                Operation::Reduce(op) => masm.vector_reduce(op, dst.gpr(), o.fpr()),
                Operation::Shuffle(lanes) => {
                    let lanes = o.function().vector_constant(lanes).to_le_bytes();
                    masm.vector_shuffle(dst.fpr(), o.fpr(), o.fpr(), lanes);
                }
                Operation::Splat(Lanes::Int(size)) => masm.splat_int(size, dst.fpr(), o.gpr()),
                Operation::Splat(Lanes::Float(width)) => {
                    masm.splat_float(width, dst.fpr(), o.fpr())
                }
                Operation::Extract(Lanes::Int(size), sign, lane) => {
                    masm.extract_int_lane(size, sign, dst.gpr(), o.fpr(), lane);
                }
                Operation::Extract(Lanes::Float(width), _, lane) => {
                    masm.extract_float_lane(width, dst.fpr(), o.fpr(), lane)
                }
                Operation::Replace(Lanes::Int(size), lane) => {
                    masm.replace_int_lane(size, dst.fpr(), o.fpr(), lane, o.gpr())
                }
                Operation::Replace(Lanes::Float(width), lane) => {
                    masm.replace_float_lane(width, dst.fpr(), o.fpr(), lane, o.fpr());
                }
            }
        });
    }
}
