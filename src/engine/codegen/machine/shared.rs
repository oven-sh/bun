//! Operations that every architecture leaves to its macro assembler.

use bun_engine_asm::{Bank, FloatAssembly, FloatCond, FloatWidth, ScratchNeeds};

use super::code::{Place, Role};
use super::emit::Operands;
use super::lower::{Instruction, Lowering};
use crate::ir::{Binary, Location, Op, Type, Unary, Value, evaluate};

/// The operands are the result, the temporaries of each bank, and the sources.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Shared {
    operation: Operation,
    temps: ScratchNeeds,
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum Operation {
    Unary { op: Unary, from: Type, to: Type },
    FloatBinary(Binary, FloatWidth),
}

pub(crate) trait SharesInstructions: Instruction {
    /// The scratch registers that are never allocated.
    const RESERVED: ScratchNeeds;

    fn shared(shared: Shared) -> Self;
    fn scratch_for_unary(features: Self::Features, op: Unary, from: Type, to: Type)
    -> ScratchNeeds;
}

impl<I: SharesInstructions> Lowering<'_, I> {
    pub(crate) fn select_shared(&mut self, value: Value) {
        let to = self.type_of(value);
        match self.op(value) {
            Op::Unary(op, operand) => {
                let from = self.type_of(operand);
                let needs = I::scratch_for_unary(self.features, op, from, to);
                self.finish_shared(value, Operation::Unary { op, from, to }, needs, &[operand]);
            }
            Op::Binary(op, operands) => {
                self.finish_shared(
                    value,
                    Operation::FloatBinary(op, to.float_width()),
                    I::RESERVED,
                    &operands,
                );
            }
            op => unreachable!("{op:?} should have been lowered by a pass"),
        }
    }

    fn finish_shared(
        &mut self,
        value: Value,
        operation: Operation,
        needs: ScratchNeeds,
        operands: &[Value],
    ) {
        let temps = self.use_with_temps(value, needs, [Some(0), None], operands);
        self.finish(I::shared(Shared { operation, temps }));
    }

    /// `reused` are the positions of the operands whose register suits the result. Returns the number of temporaries.
    pub(super) fn use_with_temps(
        &mut self,
        value: Value,
        needs: ScratchNeeds,
        reused: [Option<u8>; 2],
        operands: &[Value],
    ) -> ScratchNeeds {
        let temps = ScratchNeeds {
            gprs: needs.gprs.saturating_sub(I::RESERVED.gprs),
            fprs: needs.fprs.saturating_sub(I::RESERVED.fprs),
        };
        match reused.map(|position| Some(1 + temps.gprs + temps.fprs + position?)) {
            [Some(first), second] => self.def_tied(value, first, second),
            [None, _] => self.def(value),
        }
        (0..temps.gprs).for_each(|_| self.temp(Bank::Gpr));
        (0..temps.fprs).for_each(|_| self.temp(Bank::Fpr));
        operands
            .iter()
            .for_each(|&operand| self.use_value(operand, Role::Use, Place::Register));
        temps
    }
}

/// Lends the macro assembler the temporaries, which come next among the operands.
pub(super) fn with_temps<'a, I: SharesInstructions, M: FloatAssembly>(
    masm: &mut M,
    temps: ScratchNeeds,
    operands: &mut Operands<'a>,
    emit: impl FnOnce(&mut M, &mut Operands<'a>),
) {
    let reserved = masm.scratch();
    let mut scratch = reserved;
    for slot in scratch
        .gprs
        .iter_mut()
        .skip(I::RESERVED.gprs.into())
        .take(temps.gprs.into())
    {
        *slot = Some(operands.gpr());
    }
    for slot in scratch
        .fprs
        .iter_mut()
        .skip(I::RESERVED.fprs.into())
        .take(temps.fprs.into())
    {
        *slot = Some(operands.fpr());
    }
    masm.set_scratch(scratch);
    emit(masm, operands);
    masm.set_scratch(reserved);
}

impl Shared {
    pub(crate) fn emit<I: SharesInstructions>(
        self,
        masm: &mut impl FloatAssembly,
        mut operands: Operands<'_>,
    ) {
        let dst = operands.location();
        with_temps::<I, _>(
            masm,
            self.temps,
            &mut operands,
            |masm, operands| match self.operation {
                Operation::Unary { op, from, to } => {
                    emit_unary(masm, op, from, to, dst, operands.location())
                }
                Operation::FloatBinary(op, width) => {
                    let (dst, lhs, rhs) = (dst.fpr(), operands.fpr(), operands.fpr());
                    match op {
                        Binary::Min => masm.min_float(width, dst, lhs, rhs),
                        Binary::Max => masm.max_float(width, dst, lhs, rhs),
                        Binary::CopySign => masm.copysign_float(width, dst, lhs, rhs),
                        _ => unreachable!("has an instruction of its own"),
                    }
                }
            },
        );
    }
}

fn emit_unary(
    masm: &mut impl FloatAssembly,
    op: Unary,
    from: Type,
    to: Type,
    dst: Location,
    src: Location,
) {
    match op {
        Unary::Neg => masm.neg_float(to.float_width(), dst.fpr(), src.fpr()),
        Unary::Abs => masm.abs_float(to.float_width(), dst.fpr(), src.fpr()),
        Unary::Sqrt => masm.sqrt_float(to.float_width(), dst.fpr(), src.fpr()),
        Unary::Round(rounding) => {
            masm.round_float(rounding, to.float_width(), dst.fpr(), src.fpr())
        }
        Unary::Promote => masm.convert_f32_to_f64(dst.fpr(), src.fpr()),
        Unary::Demote => masm.convert_f64_to_f32(dst.fpr(), src.fpr()),
        Unary::IntToFloat(sign) => {
            masm.convert_int_to_float(sign, from.width(), to.float_width(), dst.fpr(), src.gpr())
        }
        Unary::FloatToInt(sign) => {
            masm.truncate_float(from.float_width(), sign, to.width(), dst.gpr(), src.fpr())
        }
        Unary::FloatToIntSaturating(sign) => {
            masm.truncate_float_saturating(
                from.float_width(),
                sign,
                to.width(),
                dst.gpr(),
                src.fpr(),
            );
        }
        Unary::HalfBitsToFloat => masm.convert_f16_bits_to_f64(dst.fpr(), src.gpr()),
        Unary::FloatToHalfBits => masm.convert_f64_to_f16_bits(dst.gpr(), src.fpr()),
        Unary::SwapBytes(size) => masm.swap_bytes(size, dst.gpr(), src.gpr()),
        Unary::CountOnes => masm.count_ones(to.width(), dst.gpr(), src.gpr()),
        Unary::CanonicalizeNan => {
            let done = masm.new_label();
            masm.move_float(dst.fpr(), src.fpr());
            masm.branch_f64(FloatCond::Ordered, dst.fpr(), dst.fpr(), done);
            masm.move_float_constant(FloatWidth::F64, dst.fpr(), evaluate::CANONICAL_NAN);
            masm.bind(done);
        }
        _ => unreachable!("has an instruction of its own"),
    }
}
