//! Operations on the lanes of vectors.

use super::immediate::{ArithmeticImm, BitmaskImm};
use super::macro_assembler::MacroAssembler;
use super::neon_opcode::Arrangement::{self, B8, B16, D2, H4, H8, S2, S4};
use super::neon_opcode::*;
use super::opcode::{Bitfield, Cc, Logical};
use crate::assembly::{FloatAssembly, VectorAssembly};
use crate::features::Arm64Features;
use crate::operand::Sign::{self, Signed, Unsigned};
use crate::operand::{FloatWidth, Shift, Size, Width};
use crate::register::{Fpr, Gpr};
use crate::vector::lanes::splat;
use crate::vector::{VectorBinary, VectorReduce, VectorShift, VectorUnary};

#[derive(Clone, Copy)]
enum Unary {
    Int(NeonUnary, Arrangement),
    Float(NeonFloatUnary, Arrangement),
    Extend(Sign, Arrangement),
    AddPairs(NeonAddPairs, Arrangement),
    ConvertAndNarrow(NeonFloatUnary, NeonNarrow),
    ExtendAndConvert(Sign, NeonFloatUnary),
    Demote,
    Promote,
}

impl Unary {
    fn of(op: VectorUnary) -> Self {
        use NeonAddPairs::{Saddlp, Uaddlp};
        use NeonFloatUnary::*;
        use NeonUnary::{Abs, Cnt, Neg};
        use VectorUnary::*;
        match op {
            Not => Self::Int(NeonUnary::Not, B16),
            I8x16Abs => Self::Int(Abs, B16),
            I8x16Neg => Self::Int(Neg, B16),
            I8x16Popcnt => Self::Int(Cnt, B16),
            I16x8Abs => Self::Int(Abs, H8),
            I16x8Neg => Self::Int(Neg, H8),
            I32x4Abs => Self::Int(Abs, S4),
            I32x4Neg => Self::Int(Neg, S4),
            I64x2Abs => Self::Int(Abs, D2),
            I64x2Neg => Self::Int(Neg, D2),
            F32x4Abs => Self::Float(Fabs, S4),
            F32x4Neg => Self::Float(Fneg, S4),
            F32x4Sqrt => Self::Float(Fsqrt, S4),
            F32x4Ceil => Self::Float(Frintp, S4),
            F32x4Floor => Self::Float(Frintm, S4),
            F32x4Trunc => Self::Float(Frintz, S4),
            F32x4Nearest => Self::Float(Frintn, S4),
            F64x2Abs => Self::Float(Fabs, D2),
            F64x2Neg => Self::Float(Fneg, D2),
            F64x2Sqrt => Self::Float(Fsqrt, D2),
            F64x2Ceil => Self::Float(Frintp, D2),
            F64x2Floor => Self::Float(Frintm, D2),
            F64x2Trunc => Self::Float(Frintz, D2),
            F64x2Nearest => Self::Float(Frintn, D2),
            I16x8ExtendLowI8x16S => Self::Extend(Signed, B8),
            I16x8ExtendHighI8x16S => Self::Extend(Signed, B16),
            I16x8ExtendLowI8x16U => Self::Extend(Unsigned, B8),
            I16x8ExtendHighI8x16U => Self::Extend(Unsigned, B16),
            I32x4ExtendLowI16x8S => Self::Extend(Signed, H4),
            I32x4ExtendHighI16x8S => Self::Extend(Signed, H8),
            I32x4ExtendLowI16x8U => Self::Extend(Unsigned, H4),
            I32x4ExtendHighI16x8U => Self::Extend(Unsigned, H8),
            I64x2ExtendLowI32x4S => Self::Extend(Signed, S2),
            I64x2ExtendHighI32x4S => Self::Extend(Signed, S4),
            I64x2ExtendLowI32x4U => Self::Extend(Unsigned, S2),
            I64x2ExtendHighI32x4U => Self::Extend(Unsigned, S4),
            I16x8ExtAddPairwiseI8x16S => Self::AddPairs(Saddlp, B16),
            I16x8ExtAddPairwiseI8x16U => Self::AddPairs(Uaddlp, B16),
            I32x4ExtAddPairwiseI16x8S => Self::AddPairs(Saddlp, H8),
            I32x4ExtAddPairwiseI16x8U => Self::AddPairs(Uaddlp, H8),
            I32x4TruncSatF32x4S | I32x4RelaxedTruncF32x4S => Self::Float(Fcvtzs, S4),
            I32x4TruncSatF32x4U | I32x4RelaxedTruncF32x4U => Self::Float(Fcvtzu, S4),
            I32x4TruncSatF64x2SZero | I32x4RelaxedTruncF64x2SZero => {
                Self::ConvertAndNarrow(Fcvtzs, NeonNarrow::Sqxtn)
            }
            I32x4TruncSatF64x2UZero | I32x4RelaxedTruncF64x2UZero => {
                Self::ConvertAndNarrow(Fcvtzu, NeonNarrow::Uqxtn)
            }
            F32x4ConvertI32x4S => Self::Float(Scvtf, S4),
            F32x4ConvertI32x4U => Self::Float(Ucvtf, S4),
            F64x2ConvertLowI32x4S => Self::ExtendAndConvert(Signed, Scvtf),
            F64x2ConvertLowI32x4U => Self::ExtendAndConvert(Unsigned, Ucvtf),
            F32x4DemoteF64x2Zero => Self::Demote,
            F64x2PromoteLowF32x4 => Self::Promote,
        }
    }
}

#[derive(Clone, Copy)]
pub(super) enum Binary {
    Bitwise(NeonBitwise),
    Int(NeonBinary, Arrangement),
    Float(NeonFloatBinary, Arrangement),
    Long(NeonLong, Arrangement),
    IntNe(Arrangement),
    FloatNe(Arrangement),
    Lookup,
    Narrow(NeonNarrow, Size),
    Dot(Size),
    Mul64,
    /// The second operand where it is less, or greater, than the first.
    SecondIfLess(Arrangement),
    SecondIfGreater(Arrangement),
}

impl Binary {
    /// `Lt` and `Le` are `Gt` and `Ge` with the operands in reverse order.
    pub(super) fn of(op: VectorBinary) -> Self {
        use NeonBinary::*;
        use NeonFloatBinary::*;
        use NeonLong::{Smull, Umull};
        use NeonNarrow::{Sqxtn, Sqxtun};
        use VectorBinary::*;
        match op {
            And => Self::Bitwise(NeonBitwise::And),
            AndNot => Self::Bitwise(NeonBitwise::Bic),
            Or => Self::Bitwise(NeonBitwise::Orr),
            Xor => Self::Bitwise(NeonBitwise::Eor),
            I8x16Swizzle | I8x16RelaxedSwizzle => Self::Lookup,
            I8x16Eq => Self::Int(Cmeq, B16),
            I8x16Ne => Self::IntNe(B16),
            I8x16GtS | I8x16LtS => Self::Int(Cmgt, B16),
            I8x16GtU | I8x16LtU => Self::Int(Cmhi, B16),
            I8x16GeS | I8x16LeS => Self::Int(Cmge, B16),
            I8x16GeU | I8x16LeU => Self::Int(Cmhs, B16),
            I16x8Eq => Self::Int(Cmeq, H8),
            I16x8Ne => Self::IntNe(H8),
            I16x8GtS | I16x8LtS => Self::Int(Cmgt, H8),
            I16x8GtU | I16x8LtU => Self::Int(Cmhi, H8),
            I16x8GeS | I16x8LeS => Self::Int(Cmge, H8),
            I16x8GeU | I16x8LeU => Self::Int(Cmhs, H8),
            I32x4Eq => Self::Int(Cmeq, S4),
            I32x4Ne => Self::IntNe(S4),
            I32x4GtS | I32x4LtS => Self::Int(Cmgt, S4),
            I32x4GtU | I32x4LtU => Self::Int(Cmhi, S4),
            I32x4GeS | I32x4LeS => Self::Int(Cmge, S4),
            I32x4GeU | I32x4LeU => Self::Int(Cmhs, S4),
            I64x2Eq => Self::Int(Cmeq, D2),
            I64x2Ne => Self::IntNe(D2),
            I64x2GtS | I64x2LtS => Self::Int(Cmgt, D2),
            I64x2GeS | I64x2LeS => Self::Int(Cmge, D2),
            F32x4Eq => Self::Float(Fcmeq, S4),
            F32x4Ne => Self::FloatNe(S4),
            F32x4Gt | F32x4Lt => Self::Float(Fcmgt, S4),
            F32x4Ge | F32x4Le => Self::Float(Fcmge, S4),
            F64x2Eq => Self::Float(Fcmeq, D2),
            F64x2Ne => Self::FloatNe(D2),
            F64x2Gt | F64x2Lt => Self::Float(Fcmgt, D2),
            F64x2Ge | F64x2Le => Self::Float(Fcmge, D2),
            I8x16NarrowI16x8S => Self::Narrow(Sqxtn, Size::S8),
            I8x16NarrowI16x8U => Self::Narrow(Sqxtun, Size::S8),
            I8x16Add => Self::Int(Add, B16),
            I8x16AddSatS => Self::Int(Sqadd, B16),
            I8x16AddSatU => Self::Int(Uqadd, B16),
            I8x16Sub => Self::Int(Sub, B16),
            I8x16SubSatS => Self::Int(Sqsub, B16),
            I8x16SubSatU => Self::Int(Uqsub, B16),
            I8x16MinS => Self::Int(Smin, B16),
            I8x16MinU => Self::Int(Umin, B16),
            I8x16MaxS => Self::Int(Smax, B16),
            I8x16MaxU => Self::Int(Umax, B16),
            I8x16AvgrU => Self::Int(Urhadd, B16),
            I16x8NarrowI32x4S => Self::Narrow(Sqxtn, Size::S16),
            I16x8NarrowI32x4U => Self::Narrow(Sqxtun, Size::S16),
            I16x8Add => Self::Int(Add, H8),
            I16x8AddSatS => Self::Int(Sqadd, H8),
            I16x8AddSatU => Self::Int(Uqadd, H8),
            I16x8Sub => Self::Int(Sub, H8),
            I16x8SubSatS => Self::Int(Sqsub, H8),
            I16x8SubSatU => Self::Int(Uqsub, H8),
            I16x8Mul => Self::Int(Mul, H8),
            I16x8MinS => Self::Int(Smin, H8),
            I16x8MinU => Self::Int(Umin, H8),
            I16x8MaxS => Self::Int(Smax, H8),
            I16x8MaxU => Self::Int(Umax, H8),
            I16x8AvgrU => Self::Int(Urhadd, H8),
            I16x8Q15MulrSatS | I16x8RelaxedQ15MulrS => Self::Int(Sqrdmulh, H8),
            I16x8ExtMulLowI8x16S => Self::Long(Smull, B8),
            I16x8ExtMulHighI8x16S => Self::Long(Smull, B16),
            I16x8ExtMulLowI8x16U => Self::Long(Umull, B8),
            I16x8ExtMulHighI8x16U => Self::Long(Umull, B16),
            I32x4Add => Self::Int(Add, S4),
            I32x4Sub => Self::Int(Sub, S4),
            I32x4Mul => Self::Int(Mul, S4),
            I32x4MinS => Self::Int(Smin, S4),
            I32x4MinU => Self::Int(Umin, S4),
            I32x4MaxS => Self::Int(Smax, S4),
            I32x4MaxU => Self::Int(Umax, S4),
            I32x4DotI16x8S => Self::Dot(Size::S16),
            I32x4ExtMulLowI16x8S => Self::Long(Smull, H4),
            I32x4ExtMulHighI16x8S => Self::Long(Smull, H8),
            I32x4ExtMulLowI16x8U => Self::Long(Umull, H4),
            I32x4ExtMulHighI16x8U => Self::Long(Umull, H8),
            I64x2Add => Self::Int(Add, D2),
            I64x2Sub => Self::Int(Sub, D2),
            I64x2Mul => Self::Mul64,
            I64x2ExtMulLowI32x4S => Self::Long(Smull, S2),
            I64x2ExtMulHighI32x4S => Self::Long(Smull, S4),
            I64x2ExtMulLowI32x4U => Self::Long(Umull, S2),
            I64x2ExtMulHighI32x4U => Self::Long(Umull, S4),
            F32x4Add => Self::Float(Fadd, S4),
            F32x4Sub => Self::Float(Fsub, S4),
            F32x4Mul => Self::Float(Fmul, S4),
            F32x4Div => Self::Float(Fdiv, S4),
            F32x4Min | F32x4RelaxedMin => Self::Float(Fmin, S4),
            F32x4Max | F32x4RelaxedMax => Self::Float(Fmax, S4),
            F32x4Pmin => Self::SecondIfLess(S4),
            F32x4Pmax => Self::SecondIfGreater(S4),
            F64x2Add => Self::Float(Fadd, D2),
            F64x2Sub => Self::Float(Fsub, D2),
            F64x2Mul => Self::Float(Fmul, D2),
            F64x2Div => Self::Float(Fdiv, D2),
            F64x2Min | F64x2RelaxedMin => Self::Float(Fmin, D2),
            F64x2Max | F64x2RelaxedMax => Self::Float(Fmax, D2),
            F64x2Pmin => Self::SecondIfLess(D2),
            F64x2Pmax => Self::SecondIfGreater(D2),
            I16x8RelaxedDotI8x16I7x16S => Self::Dot(Size::S8),
        }
    }

    pub(super) fn scratch_fprs(self) -> u8 {
        match self {
            Self::Narrow(..) | Self::Dot(_) | Self::SecondIfLess(_) | Self::SecondIfGreater(_) => 1,
            Self::Mul64 => 2,
            _ => 0,
        }
    }
}

#[rustfmt::skip]
fn is_reversed(op: VectorBinary) -> bool {
    use VectorBinary::*;
    matches!(
        op,
        I8x16LtS | I8x16LtU | I8x16LeS | I8x16LeU
            | I16x8LtS | I16x8LtU | I16x8LeS | I16x8LeU
            | I32x4LtS | I32x4LtU | I32x4LeS | I32x4LeU
            | I64x2LtS | I64x2LeS
            | F32x4Lt | F32x4Le | F64x2Lt | F64x2Le
    )
}

impl MacroAssembler {
    /// `dst`, or the first scratch register if that is one of `live`.
    pub(super) fn dst_unless(&self, dst: Fpr, live: &[Fpr]) -> Fpr {
        if live.contains(&dst) {
            self.scratch_fpr(0)
        } else {
            dst
        }
    }

    pub(super) fn unary_lanes(&mut self, op: VectorUnary, dst: Fpr, src: Fpr) {
        let asm = &mut self.asm;
        match Unary::of(op) {
            Unary::Int(op, shape) => asm.neon_unary(op, shape, dst, src),
            Unary::Float(op, shape) => asm.neon_float_unary(op, shape, dst, src),
            Unary::Extend(sign, shape) => asm.neon_shift_long(sign, shape, dst, src, 0),
            Unary::AddPairs(op, shape) => asm.neon_add_pairs(op, shape, dst, src),
            Unary::ConvertAndNarrow(convert, narrow) => {
                asm.neon_float_unary(convert, D2, dst, src);
                asm.neon_narrow(narrow, S2, dst, dst);
            }
            Unary::ExtendAndConvert(sign, convert) => {
                asm.neon_shift_long(sign, S2, dst, src, 0);
                asm.neon_float_unary(convert, D2, dst, dst);
            }
            Unary::Demote => asm.fcvtn(S2, dst, src),
            Unary::Promote => asm.fcvtl(S2, dst, src),
        }
    }

    fn narrow_both(&mut self, op: NeonNarrow, to: Size, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        let (low, high) = (Arrangement::half(to), Arrangement::full(to));
        if dst != rhs {
            self.asm.neon_narrow(op, low, dst, lhs);
            self.asm.neon_narrow(op, high, dst, rhs);
            return;
        }
        let mut upper = dst;
        if lhs != rhs {
            upper = self.scratch_fpr(0);
            self.asm.neon_narrow(op, low, upper, rhs);
        }
        self.asm.neon_narrow(op, low, dst, lhs);
        self.asm.ins_element(Size::S64, dst, 1, upper, 0);
    }

    /// Sums of two neighbouring products. `low` is not an operand, and `dst` may be either temporary.
    fn dot_through(&mut self, from: Size, dst: Fpr, lhs: Fpr, rhs: Fpr, low: Fpr, high: Fpr) {
        let (half, full) = (Arrangement::half(from), Arrangement::full(from));
        self.asm.neon_long(NeonLong::Smull, half, low, lhs, rhs);
        self.asm.neon_long(NeonLong::Smull, full, high, lhs, rhs);
        let products = if from == Size::S8 { H8 } else { S4 };
        self.asm.neon(NeonBinary::Addp, products, dst, low, high);
    }

    fn mul64(&mut self, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        let (own, other) = if dst == rhs { (rhs, lhs) } else { (lhs, rhs) };
        let (low, mut other_low) = (self.scratch_fpr(0), self.scratch_fpr(1));
        let asm = &mut self.asm;
        asm.neon_narrow(NeonNarrow::Xtn, S2, low, own);
        if own == other {
            asm.neon_unary(NeonUnary::Rev64, S4, other_low, own);
            asm.neon(NeonBinary::Mul, S4, dst, other_low, own);
            other_low = low;
        } else {
            asm.neon_narrow(NeonNarrow::Xtn, S2, other_low, other);
            asm.neon_unary(NeonUnary::Rev64, S4, dst, own);
            asm.neon(NeonBinary::Mul, S4, dst, dst, other);
        }
        asm.neon_add_pairs(NeonAddPairs::Uaddlp, S4, dst, dst);
        asm.neon_shift_left(NeonShiftLeft::Shl, D2, dst, dst, 32);
        asm.neon_long(NeonLong::Umlal, S2, dst, low, other_low);
    }

    pub(super) fn binary_lanes(&mut self, op: VectorBinary, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        let (lhs, rhs) = if is_reversed(op) {
            (rhs, lhs)
        } else {
            (lhs, rhs)
        };
        let form = Binary::of(op);
        match form {
            Binary::Bitwise(op) => self.asm.neon_bitwise(op, dst, lhs, rhs),
            Binary::Int(op, shape) => self.asm.neon(op, shape, dst, lhs, rhs),
            Binary::Float(op, shape) => self.asm.neon_float(op, shape, dst, lhs, rhs),
            Binary::Long(op, shape) => self.asm.neon_long(op, shape, dst, lhs, rhs),
            Binary::IntNe(shape) => {
                self.asm.neon(NeonBinary::Cmeq, shape, dst, lhs, rhs);
                self.asm.neon_unary(NeonUnary::Not, B16, dst, dst);
            }
            Binary::FloatNe(shape) => {
                self.asm
                    .neon_float(NeonFloatBinary::Fcmeq, shape, dst, lhs, rhs);
                self.asm.neon_unary(NeonUnary::Not, B16, dst, dst);
            }
            Binary::Lookup => self.asm.neon_lookup(NeonLookup::Tbl, B16, dst, lhs, 1, rhs),
            Binary::Narrow(op, to) => self.narrow_both(op, to, dst, lhs, rhs),
            Binary::Dot(from) => self.dot_through(from, dst, lhs, rhs, self.scratch_fpr(0), dst),
            Binary::Mul64 => self.mul64(dst, lhs, rhs),
            Binary::SecondIfLess(shape) | Binary::SecondIfGreater(shape) => {
                let mask = self.dst_unless(dst, &[lhs, rhs]);
                let (greater, less) = match form {
                    Binary::SecondIfLess(_) => (lhs, rhs),
                    _ => (rhs, lhs),
                };
                self.asm
                    .neon_float(NeonFloatBinary::Fcmgt, shape, mask, greater, less);
                self.select_bits(dst, rhs, lhs, mask);
            }
        }
    }

    pub(super) fn select_bits(&mut self, dst: Fpr, a: Fpr, b: Fpr, mask: Fpr) {
        if dst == mask {
            self.asm.neon_bitwise(NeonBitwise::Bsl, dst, a, b);
        } else if dst == a {
            self.asm.neon_bitwise(NeonBitwise::Bif, dst, b, mask);
        } else {
            self.move_vector(dst, b);
            self.asm.neon_bitwise(NeonBitwise::Bit, dst, a, mask);
        }
    }

    /// `emit` gets a register that holds `c`, and adds to it what it makes of `a` and `b`.
    pub(super) fn accumulate(
        &mut self,
        dst: Fpr,
        [a, b, c]: [Fpr; 3],
        emit: impl FnOnce(&mut Self, Fpr),
    ) {
        let sum = if dst == c {
            dst
        } else {
            self.dst_unless(dst, &[a, b])
        };
        self.move_vector(sum, c);
        emit(self, sum);
        self.move_vector(dst, sum);
    }

    pub(super) fn dot_add(&mut self, dst: Fpr, a: Fpr, b: Fpr, c: Fpr) {
        if self.asm.has(Arm64Features::DOTPROD) {
            return self.accumulate(dst, [a, b, c], |masm, sum| {
                masm.asm.dot(Signed, S4, sum, a, b);
            });
        }
        let sums = self.scratch_fpr(0);
        let high = if dst == c { self.scratch_fpr(1) } else { dst };
        self.dot_through(Size::S8, sums, a, b, sums, high);
        self.move_vector(dst, c);
        self.asm.neon_add_pairs(NeonAddPairs::Sadalp, H8, dst, sums);
    }

    pub(super) fn shift_lanes_by_constant(
        &mut self,
        op: VectorShift,
        dst: Fpr,
        src: Fpr,
        amount: u8,
    ) {
        let (shape, amount) = (Arrangement::full(op.lanes()), amount % op.lanes().bits());
        let right = match op.kind() {
            _ if amount == 0 => return self.move_vector(dst, src),
            Shift::Left if amount == 1 => {
                return self.asm.neon(NeonBinary::Add, shape, dst, src, src);
            }
            Shift::Left => {
                return self
                    .asm
                    .neon_shift_left(NeonShiftLeft::Shl, shape, dst, src, amount);
            }
            Shift::RightArithmetic => NeonShiftRight::Sshr,
            _ => NeonShiftRight::Ushr,
        };
        self.asm.neon_shift_right(right, shape, dst, src, amount);
    }

    /// The low byte of each lane is the distance, which is negative for a shift to the right.
    pub(super) fn shift_lanes_by_register(
        &mut self,
        op: VectorShift,
        dst: Fpr,
        src: Fpr,
        amount: Gpr,
    ) {
        let (distance, distances) = (self.data_scratch(), self.dst_unless(dst, &[src]));
        let mask = BitmaskImm::new(Width::W32, (op.lanes().bits() - 1).into()).unwrap();
        self.asm.logical_imm(Logical::And, distance, amount, mask);
        if op.kind() != Shift::Left {
            self.asm.neg(Width::W32, distance, distance);
        }
        self.asm.dup_gpr(B16, distances, distance);
        let shift = match op.kind() {
            Shift::RightArithmetic => NeonBinary::Sshl,
            _ => NeonBinary::Ushl,
        };
        let shape = Arrangement::full(op.lanes());
        self.asm.neon(shift, shape, dst, src, distances);
    }

    /// 64 bits that are zero if the vector is.
    pub(super) fn fold_to_gpr(&mut self, dst: Gpr, src: Fpr) {
        let folded = self.scratch_fpr(0);
        self.asm.neon(NeonBinary::Umaxp, S4, folded, src, src);
        self.asm.fmov_from_fpr(FloatWidth::F64, dst, folded);
    }

    fn set_if_not_zero(&mut self, width: Width, reg: Gpr) {
        self.asm.cmp_imm(width, reg, ArithmeticImm::ZERO);
        self.asm.cset(reg, Cc::Ne);
    }

    fn all_lanes_true(&mut self, shape: Arrangement, dst: Gpr, src: Fpr) {
        let least = self.scratch_fpr(0);
        self.asm.neon_across(NeonAcross::Uminv, shape, least, src);
        self.asm.fmov_from_fpr(FloatWidth::F32, dst, least);
        self.set_if_not_zero(Width::W32, dst);
    }

    /// Leaves in each negative lane the bit for its place.
    fn bits_for_signs(&mut self, shape: Arrangement, bits: u128, src: Fpr) -> Fpr {
        let (signs, constant) = (self.scratch_fpr(0), self.scratch_fpr(1));
        self.move_vector_constant(constant, bits);
        self.asm.neon_unary(NeonUnary::Cmlt, shape, signs, src);
        self.asm
            .neon_bitwise(NeonBitwise::And, signs, signs, constant);
        signs
    }

    fn add_bits_for_signs(&mut self, shape: Arrangement, bits: u128, dst: Gpr, src: Fpr) {
        let bits = self.bits_for_signs(shape, bits, src);
        self.asm.neon_across(NeonAcross::Addv, shape, bits, bits);
        self.asm.fmov_from_fpr(FloatWidth::F32, dst, bits);
    }

    pub(super) fn reduce_lanes(&mut self, op: VectorReduce, dst: Gpr, src: Fpr) {
        match op {
            VectorReduce::AnyTrue => {
                self.fold_to_gpr(dst, src);
                self.set_if_not_zero(Width::W64, dst);
            }
            VectorReduce::I8x16AllTrue => self.all_lanes_true(B16, dst, src),
            VectorReduce::I16x8AllTrue => self.all_lanes_true(H8, dst, src),
            VectorReduce::I32x4AllTrue => self.all_lanes_true(S4, dst, src),
            // The sum is zero, or else −1 or −2, which are the bits of NaNs.
            VectorReduce::I64x2AllTrue => {
                let zeros = self.scratch_fpr(0);
                self.asm.neon_unary(NeonUnary::Cmeq, D2, zeros, src);
                self.asm.addp_scalar(zeros, zeros);
                self.asm.fcmp(FloatWidth::F64, zeros, zeros);
                self.asm.cset(dst, Cc::Vc);
            }
            VectorReduce::I8x16Bitmask => {
                let bits = self.bits_for_signs(B16, splat(Size::S64, 0x8040_2010_0804_0201), src);
                for shape in [B16, B8, B8] {
                    self.asm.neon(NeonBinary::Addp, shape, bits, bits, bits);
                }
                self.asm.umov(Size::S16, dst, bits, 0);
            }
            VectorReduce::I16x8Bitmask => {
                self.add_bits_for_signs(H8, 0x0080_0040_0020_0010_0008_0004_0002_0001, dst, src);
            }
            VectorReduce::I32x4Bitmask => {
                self.add_bits_for_signs(S4, 0x0000_0008_0000_0004_0000_0002_0000_0001, dst, src);
            }
            VectorReduce::I64x2Bitmask => {
                let signs = self.scratch_fpr(0);
                self.asm.neon_unary(NeonUnary::Cmlt, D2, signs, src);
                self.asm.neon_narrow(NeonNarrow::Xtn, S2, signs, signs);
                self.asm.fmov_from_fpr(FloatWidth::F64, dst, signs);
                self.asm
                    .bitfield_extract(Bitfield::Ubfm, Width::W64, dst, dst, 31, 2);
            }
        }
    }
}
