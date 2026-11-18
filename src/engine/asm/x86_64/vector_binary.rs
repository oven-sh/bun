//! Operations on the lanes of two and of three vectors.

use super::float::pick;
use super::integer::MacroAssembler;
use super::opcode::{Blendv, FloatPredicate, Fma, Sse, SseImm, SseShiftImm, SseUnary, SseUnaryImm};
use super::vector_unary::ODD_LANES_TWICE;
use crate::assembly::{FloatAssembly, Reuse};
use crate::features::X64Features;
use crate::operand::{FloatWidth, Size};
use crate::register::Fpr;
use crate::vector::VectorBinary;
use crate::vector::lanes::splat;

#[derive(Clone, Copy)]
pub(super) enum Form {
    One(Sse),
    /// The complement of what the instruction gives.
    Not(Sse),
    CompareFloats(FloatWidth, FloatPredicate),
    AtLeast {
        min: Sse,
        max: Sse,
        equal: Sse,
    },
    Above(Size, Sse),
    Swizzle,
    SaturatingQ15,
    MulLowBytes(SseUnary),
    MulHighBytes(Sse),
    MulWords {
        high: Sse,
        unpack: Sse,
    },
    MulDoublewords {
        order: u8,
        mul: Sse,
    },
    Mul64,
    MinOrMax {
        width: FloatWidth,
        op: Sse,
        if_equal: Sse,
    },
}

const fn at_least(min: Sse, max: Sse, equal: Sse) -> Form {
    Form::AtLeast { min, max, equal }
}

const fn min_or_max(width: FloatWidth, op: Sse, if_equal: Sse) -> Form {
    Form::MinOrMax {
        width,
        op,
        if_equal,
    }
}

impl Form {
    /// Also says whether the operands are in reverse order.
    pub(super) fn of(op: VectorBinary) -> (Self, bool) {
        use FloatPredicate::{Eq, Le, Lt, NeOrUnordered};
        use FloatWidth::{F32, F64};
        use Sse::*;
        use VectorBinary::*;
        const LOW_LANES_TWICE: u8 = 0x50;
        const HIGH_LANES_TWICE: u8 = 0xfa;
        let mul_words = |high, unpack| Self::MulWords { high, unpack };
        let mul_doublewords = |order, mul| Self::MulDoublewords { order, mul };
        let form = match op {
            And => Self::One(Pand),
            AndNot => Self::One(Pandn),
            Or => Self::One(Por),
            Xor => Self::One(Pxor),
            I8x16Swizzle => Self::Swizzle,
            I8x16Eq => Self::One(Pcmpeqb),
            I8x16Ne => Self::Not(Pcmpeqb),
            I8x16GtS | I8x16LtS => Self::One(Pcmpgtb),
            I8x16GtU | I8x16LtU => Self::Above(Size::S8, Pcmpgtb),
            I8x16GeS | I8x16LeS => at_least(Pminsb, Pmaxsb, Pcmpeqb),
            I8x16GeU | I8x16LeU => at_least(Pminub, Pmaxub, Pcmpeqb),
            I16x8Eq => Self::One(Pcmpeqw),
            I16x8Ne => Self::Not(Pcmpeqw),
            I16x8GtS | I16x8LtS => Self::One(Pcmpgtw),
            I16x8GtU | I16x8LtU => Self::Above(Size::S16, Pcmpgtw),
            I16x8GeS | I16x8LeS => at_least(Pminsw, Pmaxsw, Pcmpeqw),
            I16x8GeU | I16x8LeU => at_least(Pminuw, Pmaxuw, Pcmpeqw),
            I32x4Eq => Self::One(Pcmpeqd),
            I32x4Ne => Self::Not(Pcmpeqd),
            I32x4GtS | I32x4LtS => Self::One(Pcmpgtd),
            I32x4GtU | I32x4LtU => Self::Above(Size::S32, Pcmpgtd),
            I32x4GeS | I32x4LeS => at_least(Pminsd, Pmaxsd, Pcmpeqd),
            I32x4GeU | I32x4LeU => at_least(Pminud, Pmaxud, Pcmpeqd),
            I64x2Eq => Self::One(Pcmpeqq),
            I64x2Ne => Self::Not(Pcmpeqq),
            I64x2GtS | I64x2LtS => Self::One(Pcmpgtq),
            I64x2LeS | I64x2GeS => Self::Not(Pcmpgtq),
            F32x4Eq => Self::CompareFloats(F32, Eq),
            F32x4Ne => Self::CompareFloats(F32, NeOrUnordered),
            F32x4Lt | F32x4Gt => Self::CompareFloats(F32, Lt),
            F32x4Le | F32x4Ge => Self::CompareFloats(F32, Le),
            F64x2Eq => Self::CompareFloats(F64, Eq),
            F64x2Ne => Self::CompareFloats(F64, NeOrUnordered),
            F64x2Lt | F64x2Gt => Self::CompareFloats(F64, Lt),
            F64x2Le | F64x2Ge => Self::CompareFloats(F64, Le),
            I8x16NarrowI16x8S => Self::One(Packsswb),
            I8x16NarrowI16x8U => Self::One(Packuswb),
            I8x16Add => Self::One(Paddb),
            I8x16AddSatS => Self::One(Paddsb),
            I8x16AddSatU => Self::One(Paddusb),
            I8x16Sub => Self::One(Psubb),
            I8x16SubSatS => Self::One(Psubsb),
            I8x16SubSatU => Self::One(Psubusb),
            I8x16MinS => Self::One(Pminsb),
            I8x16MinU => Self::One(Pminub),
            I8x16MaxS => Self::One(Pmaxsb),
            I8x16MaxU => Self::One(Pmaxub),
            I8x16AvgrU => Self::One(Pavgb),
            I16x8NarrowI32x4S => Self::One(Packssdw),
            I16x8NarrowI32x4U => Self::One(Packusdw),
            I16x8Add => Self::One(Paddw),
            I16x8AddSatS => Self::One(Paddsw),
            I16x8AddSatU => Self::One(Paddusw),
            I16x8Sub => Self::One(Psubw),
            I16x8SubSatS => Self::One(Psubsw),
            I16x8SubSatU => Self::One(Psubusw),
            I16x8Mul => Self::One(Pmullw),
            I16x8MinS => Self::One(Pminsw),
            I16x8MinU => Self::One(Pminuw),
            I16x8MaxS => Self::One(Pmaxsw),
            I16x8MaxU => Self::One(Pmaxuw),
            I16x8AvgrU => Self::One(Pavgw),
            I16x8Q15MulrSatS => Self::SaturatingQ15,
            I16x8ExtMulLowI8x16S => Self::MulLowBytes(SseUnary::Pmovsxbw),
            I16x8ExtMulHighI8x16S => Self::MulHighBytes(Pmulhw),
            I16x8ExtMulLowI8x16U => Self::MulLowBytes(SseUnary::Pmovzxbw),
            I16x8ExtMulHighI8x16U => Self::MulHighBytes(Pmulhuw),
            I32x4Add => Self::One(Paddd),
            I32x4Sub => Self::One(Psubd),
            I32x4Mul => Self::One(Pmulld),
            I32x4MinS => Self::One(Pminsd),
            I32x4MinU => Self::One(Pminud),
            I32x4MaxS => Self::One(Pmaxsd),
            I32x4MaxU => Self::One(Pmaxud),
            I32x4DotI16x8S => Self::One(Pmaddwd),
            I32x4ExtMulLowI16x8S => mul_words(Pmulhw, Punpcklwd),
            I32x4ExtMulHighI16x8S => mul_words(Pmulhw, Punpckhwd),
            I32x4ExtMulLowI16x8U => mul_words(Pmulhuw, Punpcklwd),
            I32x4ExtMulHighI16x8U => mul_words(Pmulhuw, Punpckhwd),
            I64x2Add => Self::One(Paddq),
            I64x2Sub => Self::One(Psubq),
            I64x2Mul => Self::Mul64,
            I64x2ExtMulLowI32x4S => mul_doublewords(LOW_LANES_TWICE, Pmuldq),
            I64x2ExtMulHighI32x4S => mul_doublewords(HIGH_LANES_TWICE, Pmuldq),
            I64x2ExtMulLowI32x4U => mul_doublewords(LOW_LANES_TWICE, Pmuludq),
            I64x2ExtMulHighI32x4U => mul_doublewords(HIGH_LANES_TWICE, Pmuludq),
            F32x4Add => Self::One(Addps),
            F32x4Sub => Self::One(Subps),
            F32x4Mul => Self::One(Mulps),
            F32x4Div => Self::One(Divps),
            F32x4Min => min_or_max(F32, Minps, Orps),
            F32x4Max => min_or_max(F32, Maxps, Andps),
            F32x4Pmin | F32x4RelaxedMin => Self::One(Minps),
            F32x4Pmax | F32x4RelaxedMax => Self::One(Maxps),
            F64x2Add => Self::One(Addpd),
            F64x2Sub => Self::One(Subpd),
            F64x2Mul => Self::One(Mulpd),
            F64x2Div => Self::One(Divpd),
            F64x2Min => min_or_max(F64, Minpd, Orps),
            F64x2Max => min_or_max(F64, Maxpd, Andps),
            F64x2Pmin | F64x2RelaxedMin => Self::One(Minpd),
            F64x2Pmax | F64x2RelaxedMax => Self::One(Maxpd),
            I8x16RelaxedSwizzle => Self::One(Pshufb),
            I16x8RelaxedQ15MulrS => Self::One(Pmulhrsw),
            I16x8RelaxedDotI8x16I7x16S => Self::One(Pmaddubsw),
        };
        (form, Self::is_reversed(op))
    }

    #[rustfmt::skip]
    fn is_reversed(op: VectorBinary) -> bool {
        use VectorBinary::*;
        matches!(
            op,
            AndNot
                | I8x16LtS | I8x16LtU | I8x16LeS | I8x16LeU
                | I16x8LtS | I16x8LtU | I16x8LeS | I16x8LeU
                | I32x4LtS | I32x4LtU | I32x4LeS | I32x4LeU
                | I64x2LtS | I64x2GeS
                | F32x4Gt | F32x4Ge | F64x2Gt | F64x2Ge
                | F32x4Pmin | F32x4Pmax | F64x2Pmin | F64x2Pmax
                | I16x8RelaxedDotI8x16I7x16S
        )
    }

    pub(super) fn scratch_fprs(self, has_avx: bool) -> u8 {
        match self {
            Self::One(op) => u8::from(!has_avx && !op.commutes()),
            Self::CompareFloats(_, predicate) => u8::from(!has_avx && !predicate.commutes()),
            Self::AtLeast { .. } => 0,
            Self::Mul64 => 2,
            _ => 1,
        }
    }

    /// Without AVX, in the order of the form.
    pub(super) fn reuse(self) -> Reuse {
        match self {
            Self::One(op) | Self::Not(op) if !op.commutes() => Reuse::FIRST,
            Self::CompareFloats(_, predicate) if !predicate.commutes() => Reuse::FIRST,
            Self::Above(..) | Self::Swizzle => Reuse::FIRST,
            Self::MulLowBytes(_) | Self::MulHighBytes(_) | Self::MulDoublewords { .. } => {
                Reuse::empty()
            }
            _ => Reuse::FIRST | Reuse::SECOND,
        }
    }
}

/// The instruction that is all there is to the operation, and whether its operands are in reverse order.
pub fn single_instruction(op: VectorBinary) -> Option<(Sse, bool)> {
    match Form::of(op) {
        (Form::One(instruction), is_reversed) => Some((instruction, is_reversed)),
        _ => None,
    }
}

pub(super) fn has_fma(features: X64Features) -> bool {
    features.contains(X64Features::AVX | X64Features::FMA)
}

impl MacroAssembler {
    fn compare_floats(
        &mut self,
        width: FloatWidth,
        predicate: FloatPredicate,
        dst: Fpr,
        lhs: Fpr,
        rhs: Fpr,
    ) {
        let result = if self.has_avx() || dst == lhs {
            dst
        } else {
            self.dst_unless(dst, rhs)
        };
        let lhs = self.first_source(result, lhs);
        let compare = pick(width, SseImm::Cmpps, SseImm::Cmppd);
        self.asm.sse_imm(compare, result, lhs, rhs, predicate as u8);
        self.move_vector(dst, result);
    }

    fn complement(&mut self, op: Sse, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        let scratch = self.scratch_fpr(0);
        if dst == rhs && !op.commutes() {
            self.sse_binary(op, scratch, lhs, rhs);
            self.set_all_bits(dst);
        } else {
            self.sse_binary(op, dst, lhs, rhs);
            self.set_all_bits(scratch);
        }
        self.sse_binary(Sse::Pxor, dst, dst, scratch);
    }

    fn mul_prepared(
        &mut self,
        mul: Sse,
        dst: Fpr,
        lhs: Fpr,
        rhs: Fpr,
        prepare: impl Fn(&mut Self, Fpr, Fpr),
    ) {
        let mut other = dst;
        if lhs != rhs {
            other = self.scratch_fpr(0);
            prepare(self, other, lhs);
        }
        prepare(self, dst, rhs);
        self.sse_binary(mul, dst, dst, other);
    }

    /// With the bytes in the upper halves of words, the upper half of a product is the product of the bytes.
    fn mul_high_bytes(&mut self, mul_high: Sse, dst: Fpr, own: Fpr, other: Fpr) {
        let scratch = self.scratch_fpr(0);
        self.zero_vector(scratch);
        if own == other {
            self.asm.sse(Sse::Punpckhbw, scratch, scratch, own);
            return self.sse_binary(mul_high, dst, scratch, scratch);
        }
        if self.has_avx() {
            self.asm.sse(Sse::Punpckhbw, dst, scratch, own);
            self.asm.sse(Sse::Punpckhbw, scratch, scratch, other);
        } else {
            self.asm.sse(Sse::Punpckhbw, scratch, scratch, own);
            self.zero_vector(dst);
            self.asm.sse(Sse::Punpckhbw, dst, dst, other);
        }
        self.sse_binary(mul_high, dst, dst, scratch);
    }

    fn mul64(&mut self, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        let (cross, other) = (self.scratch_fpr(0), self.scratch_fpr(1));
        for (product, high, low) in [(cross, lhs, rhs), (other, rhs, lhs)] {
            self.asm
                .sse_unary_imm(SseUnaryImm::Pshufd, product, high, ODD_LANES_TWICE);
            self.asm.sse(Sse::Pmuludq, product, product, low);
        }
        self.sse_binary(Sse::Paddq, cross, cross, other);
        self.asm.sse_shift_imm(SseShiftImm::Psllq, cross, cross, 32);
        self.sse_binary(Sse::Pmuludq, dst, lhs, rhs);
        self.sse_binary(Sse::Paddq, dst, dst, cross);
    }

    /// The instruction gives its second operand for a NaN and for two zeros.
    fn min_or_max_lanes(
        &mut self,
        width: FloatWidth,
        op: Sse,
        if_equal: Sse,
        dst: Fpr,
        own: Fpr,
        other: Fpr,
    ) {
        let scratch = self.scratch_fpr(0);
        self.sse_binary(op, scratch, other, own);
        self.sse_binary(op, dst, own, other);
        self.sse_binary(if_equal, dst, dst, scratch);
        let compare = pick(width, SseImm::Cmpps, SseImm::Cmppd);
        let unordered = FloatPredicate::Unordered as u8;
        self.asm
            .sse_imm(compare, scratch, scratch, other, unordered);
        if self.has_avx() {
            let nan = pick(
                width,
                splat(Size::S32, 0x7fc0_0000),
                splat(Size::S64, 0x7ff8 << 48),
            );
            let nan = self.asm.constant(nan, 16);
            let blend = pick(width, Blendv::Vblendvps, Blendv::Vblendvpd);
            self.asm.blendv(blend, dst, dst, nan, scratch);
        } else {
            self.sse_binary(Sse::Orps, dst, dst, scratch);
            let shift = pick(width, SseShiftImm::Psrld, SseShiftImm::Psrlq);
            let before_payload = pick(width, 10, 13);
            self.asm
                .sse_shift_imm(shift, scratch, scratch, before_payload);
            self.sse_binary(Sse::Xorps, dst, dst, scratch);
        }
    }

    pub(super) fn binary_form(&mut self, form: Form, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        // For what commutes: `other` is still there after `dst` is written, unless both are the same.
        let (own, other) = if dst == rhs { (rhs, lhs) } else { (lhs, rhs) };
        match form {
            Form::One(op) => self.sse_binary(op, dst, lhs, rhs),
            Form::Not(op) => self.complement(op, dst, lhs, rhs),
            Form::CompareFloats(width, predicate) if predicate.commutes() => {
                self.compare_floats(width, predicate, dst, own, other);
            }
            Form::CompareFloats(width, predicate) => {
                self.compare_floats(width, predicate, dst, lhs, rhs);
            }
            Form::AtLeast { min, max, equal } => {
                self.sse_binary(if dst == rhs { max } else { min }, dst, lhs, rhs);
                self.sse_binary(equal, dst, dst, other);
            }
            Form::Above(lanes, greater) => {
                let (scratch, signs) = (self.scratch_fpr(0), splat(lanes, 1 << (lanes.bits() - 1)));
                self.sse_with_constant(Sse::Pxor, scratch, rhs, signs);
                self.sse_with_constant(Sse::Pxor, dst, lhs, signs);
                self.asm.sse(greater, dst, dst, scratch);
            }
            // The addition sets the top bit, which selects zero, for indices from 16 up.
            Form::Swizzle => {
                let indices = self.scratch_fpr(0);
                self.sse_with_constant(Sse::Paddusb, indices, rhs, splat(Size::S8, 0x70));
                self.sse_binary(Sse::Pshufb, dst, lhs, indices);
            }
            Form::SaturatingQ15 => {
                let overflows = self.scratch_fpr(0);
                self.sse_binary(Sse::Pmulhrsw, dst, lhs, rhs);
                self.sse_with_constant(Sse::Pcmpeqw, overflows, dst, splat(Size::S16, 0x8000));
                self.sse_binary(Sse::Pxor, dst, dst, overflows);
            }
            Form::MulLowBytes(extend) => {
                self.mul_prepared(Sse::Pmullw, dst, lhs, rhs, |masm, dst, src| {
                    masm.asm.sse_unary(extend, dst, src);
                });
            }
            Form::MulHighBytes(mul_high) => self.mul_high_bytes(mul_high, dst, own, other),
            Form::MulWords { high, unpack } => {
                let scratch = self.scratch_fpr(0);
                self.sse_binary(high, scratch, lhs, rhs);
                self.sse_binary(Sse::Pmullw, dst, lhs, rhs);
                self.asm.sse(unpack, dst, dst, scratch);
            }
            Form::MulDoublewords { order, mul } => {
                self.mul_prepared(mul, dst, lhs, rhs, |masm, dst, src| {
                    masm.asm.sse_unary_imm(SseUnaryImm::Pshufd, dst, src, order);
                });
            }
            Form::Mul64 => self.mul64(dst, lhs, rhs),
            Form::MinOrMax {
                width,
                op,
                if_equal,
            } => self.min_or_max_lanes(width, op, if_equal, dst, own, other),
        }
    }

    pub(super) fn select_bits(&mut self, dst: Fpr, a: Fpr, b: Fpr, mask: Fpr) {
        if self.has_avx() || dst == mask {
            let scratch = self.scratch_fpr(0);
            self.sse_binary(Sse::Pandn, scratch, mask, b);
            self.sse_binary(Sse::Pand, dst, a, mask);
            self.sse_binary(Sse::Por, dst, dst, scratch);
        } else {
            let difference = self.dst_unless(dst, b);
            self.sse_binary(Sse::Pxor, difference, a, b);
            self.sse_binary(Sse::Pand, difference, difference, mask);
            self.sse_binary(Sse::Pxor, dst, difference, b);
        }
    }

    pub(super) fn select_lanes(&mut self, lanes: Size, dst: Fpr, a: Fpr, b: Fpr, mask: Fpr) {
        if !self.has_avx() {
            return self.select_bits(dst, a, b, mask);
        }
        match lanes {
            Size::S8 => self.asm.blendv(Blendv::Vpblendvb, dst, b, a, mask),
            Size::S16 => {
                let bytes = self.scratch_fpr(0);
                self.asm.sse_shift_imm(SseShiftImm::Psraw, bytes, mask, 15);
                self.asm.blendv(Blendv::Vpblendvb, dst, b, a, bytes);
            }
            Size::S32 => self.asm.blendv(Blendv::Vblendvps, dst, b, a, mask),
            Size::S64 => self.asm.blendv(Blendv::Vblendvpd, dst, b, a, mask),
        }
    }

    pub(super) fn mul_add(
        &mut self,
        width: FloatWidth,
        negated: bool,
        dst: Fpr,
        a: Fpr,
        b: Fpr,
        c: Fpr,
    ) {
        if has_fma(self.asm.features) {
            let (into_factor, into_addend) = match (width, negated) {
                (FloatWidth::F32, false) => (Fma::Vfmadd213ps, Fma::Vfmadd231ps),
                (FloatWidth::F64, false) => (Fma::Vfmadd213pd, Fma::Vfmadd231pd),
                (FloatWidth::F32, true) => (Fma::Vfnmadd213ps, Fma::Vfnmadd231ps),
                (FloatWidth::F64, true) => (Fma::Vfnmadd213pd, Fma::Vfnmadd231pd),
            };
            if dst == a || dst == b {
                self.asm
                    .fma(into_factor, dst, if dst == a { b } else { a }, c);
            } else {
                self.move_vector(dst, c);
                self.asm.fma(into_addend, dst, a, b);
            }
            return;
        }
        let mul = pick(width, Sse::Mulps, Sse::Mulpd);
        if negated {
            let product = self.scratch_fpr(0);
            self.sse_binary(mul, product, a, b);
            self.sse_binary(pick(width, Sse::Subps, Sse::Subpd), dst, c, product);
        } else {
            let product = self.dst_unless(dst, c);
            self.sse_binary(mul, product, a, b);
            self.sse_binary(pick(width, Sse::Addps, Sse::Addpd), dst, product, c);
        }
    }

    pub(super) fn dot_add(&mut self, dst: Fpr, a: Fpr, b: Fpr, c: Fpr) {
        let sums = if dst == a {
            self.scratch_fpr(0)
        } else {
            self.dst_unless(dst, c)
        };
        self.sse_binary(Sse::Pmaddubsw, sums, b, a);
        self.sse_with_constant(Sse::Pmaddwd, sums, sums, splat(Size::S16, 1));
        self.sse_binary(Sse::Paddd, dst, c, sums);
    }
}
