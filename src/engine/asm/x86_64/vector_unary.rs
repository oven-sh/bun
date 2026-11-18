//! Operations on the lanes of one vector.

use super::float::{rounding_control, sign_bits};
use super::integer::MacroAssembler;
use super::opcode::{Blendv, FloatPredicate, Sse, SseImm, SseShiftImm, SseUnary, SseUnaryImm};
use crate::assembly::{FloatAssembly, VectorAssembly};
use crate::operand::{FloatWidth, Rounding, Size};
use crate::register::Fpr;
use crate::vector::VectorUnary;
use crate::vector::lanes::splat;

/// For `pshufd`.
pub(super) const HIGH_HALF_TWICE: u8 = 0xee;
pub(super) const ODD_LANES_TWICE: u8 = 0xf5;
/// For `shufps`.
const EVEN_LANES: u8 = 0x88;
/// For `pblendw`.
const ODD_WORDS: u8 = 0xaa;

const fn f32x4(value: f32) -> u128 {
    splat(Size::S32, value.to_bits() as u64)
}

const fn f64x2(value: f64) -> u128 {
    splat(Size::S64, value.to_bits())
}

const TWO_TO_THE_31: u128 = f32x4(2_147_483_648.0);
const TWO_TO_THE_32: u128 = f32x4(4_294_967_296.0);
/// The last bit of the fraction counts one, and the low half is zero.
const TWO_TO_THE_52: u128 = f64x2(4_503_599_627_370_496.0);

#[derive(Clone, Copy)]
pub(super) enum Form {
    One(SseUnary),
    Round(SseUnaryImm, Rounding),
    WithConstant(Sse, u128),
    Not,
    Neg(Sse),
    Abs64,
    Popcnt,
    ExtendHighSigned(Sse, SseShiftImm, u8, SseUnary),
    ExtendHighSigned32,
    ExtendHighUnsigned(Sse),
    AddPairsSigned8,
    AddPairsUnsigned16,
    SaturateF32Signed,
    SaturateF32Unsigned,
    SaturateF64Signed,
    SaturateF64Unsigned,
    TruncateF32Unsigned,
    TruncateF64Unsigned,
    ConvertUnsignedToF32,
    ConvertUnsignedToF64,
}

impl Form {
    pub(super) fn of(op: VectorUnary) -> Self {
        use FloatWidth::{F32, F64};
        use SseUnaryImm::{Roundpd, Roundps};
        use VectorUnary::*;
        match op {
            Not => Self::Not,
            I8x16Abs => Self::One(SseUnary::Pabsb),
            I8x16Neg => Self::Neg(Sse::Psubb),
            I8x16Popcnt => Self::Popcnt,
            I16x8Abs => Self::One(SseUnary::Pabsw),
            I16x8Neg => Self::Neg(Sse::Psubw),
            I32x4Abs => Self::One(SseUnary::Pabsd),
            I32x4Neg => Self::Neg(Sse::Psubd),
            I64x2Abs => Self::Abs64,
            I64x2Neg => Self::Neg(Sse::Psubq),
            F32x4Abs => Self::WithConstant(Sse::Andps, !sign_bits(F32)),
            F32x4Neg => Self::WithConstant(Sse::Xorps, sign_bits(F32)),
            F32x4Sqrt => Self::One(SseUnary::Sqrtps),
            F32x4Ceil => Self::Round(Roundps, Rounding::Up),
            F32x4Floor => Self::Round(Roundps, Rounding::Down),
            F32x4Trunc => Self::Round(Roundps, Rounding::TowardZero),
            F32x4Nearest => Self::Round(Roundps, Rounding::Nearest),
            F64x2Abs => Self::WithConstant(Sse::Andps, !sign_bits(F64)),
            F64x2Neg => Self::WithConstant(Sse::Xorps, sign_bits(F64)),
            F64x2Sqrt => Self::One(SseUnary::Sqrtpd),
            F64x2Ceil => Self::Round(Roundpd, Rounding::Up),
            F64x2Floor => Self::Round(Roundpd, Rounding::Down),
            F64x2Trunc => Self::Round(Roundpd, Rounding::TowardZero),
            F64x2Nearest => Self::Round(Roundpd, Rounding::Nearest),
            I16x8ExtendLowI8x16S => Self::One(SseUnary::Pmovsxbw),
            I16x8ExtendHighI8x16S => {
                Self::ExtendHighSigned(Sse::Punpckhbw, SseShiftImm::Psraw, 8, SseUnary::Pmovsxbw)
            }
            I16x8ExtendLowI8x16U => Self::One(SseUnary::Pmovzxbw),
            I16x8ExtendHighI8x16U => Self::ExtendHighUnsigned(Sse::Punpckhbw),
            I32x4ExtendLowI16x8S => Self::One(SseUnary::Pmovsxwd),
            I32x4ExtendHighI16x8S => {
                Self::ExtendHighSigned(Sse::Punpckhwd, SseShiftImm::Psrad, 16, SseUnary::Pmovsxwd)
            }
            I32x4ExtendLowI16x8U => Self::One(SseUnary::Pmovzxwd),
            I32x4ExtendHighI16x8U => Self::ExtendHighUnsigned(Sse::Punpckhwd),
            I64x2ExtendLowI32x4S => Self::One(SseUnary::Pmovsxdq),
            I64x2ExtendHighI32x4S => Self::ExtendHighSigned32,
            I64x2ExtendLowI32x4U => Self::One(SseUnary::Pmovzxdq),
            I64x2ExtendHighI32x4U => Self::ExtendHighUnsigned(Sse::Punpckhdq),
            I16x8ExtAddPairwiseI8x16S => Self::AddPairsSigned8,
            I16x8ExtAddPairwiseI8x16U => Self::WithConstant(Sse::Pmaddubsw, splat(Size::S8, 1)),
            I32x4ExtAddPairwiseI16x8S => Self::WithConstant(Sse::Pmaddwd, splat(Size::S16, 1)),
            I32x4ExtAddPairwiseI16x8U => Self::AddPairsUnsigned16,
            I32x4TruncSatF32x4S => Self::SaturateF32Signed,
            I32x4TruncSatF32x4U => Self::SaturateF32Unsigned,
            I32x4TruncSatF64x2SZero => Self::SaturateF64Signed,
            I32x4TruncSatF64x2UZero => Self::SaturateF64Unsigned,
            F32x4ConvertI32x4S => Self::One(SseUnary::Cvtdq2ps),
            F32x4ConvertI32x4U => Self::ConvertUnsignedToF32,
            F64x2ConvertLowI32x4S => Self::One(SseUnary::Cvtdq2pd),
            F64x2ConvertLowI32x4U => Self::ConvertUnsignedToF64,
            F32x4DemoteF64x2Zero => Self::One(SseUnary::Cvtpd2ps),
            F64x2PromoteLowF32x4 => Self::One(SseUnary::Cvtps2pd),
            I32x4RelaxedTruncF32x4S => Self::One(SseUnary::Cvttps2dq),
            I32x4RelaxedTruncF32x4U => Self::TruncateF32Unsigned,
            I32x4RelaxedTruncF64x2SZero => Self::One(SseUnary::Cvttpd2dq),
            I32x4RelaxedTruncF64x2UZero => Self::TruncateF64Unsigned,
        }
    }

    pub(super) fn scratch_fprs(self) -> u8 {
        match self {
            Self::One(_)
            | Self::Round(..)
            | Self::WithConstant(..)
            | Self::ExtendHighSigned(..)
            | Self::ExtendHighSigned32
            | Self::TruncateF64Unsigned
            | Self::ConvertUnsignedToF64 => 0,
            Self::Popcnt => 2,
            _ => 1,
        }
    }

    /// Without AVX.
    pub(super) fn starts_with_a_copy(self) -> bool {
        !matches!(
            self,
            Self::One(_)
                | Self::Round(..)
                | Self::Not
                | Self::Neg(_)
                | Self::ExtendHighSigned(..)
                | Self::ExtendHighSigned32
                | Self::AddPairsSigned8
                | Self::TruncateF64Unsigned
        )
    }
}

impl MacroAssembler {
    pub(super) fn set_all_bits(&mut self, dst: Fpr) {
        self.sse_without_source(Sse::Pcmpeqd, dst);
    }

    /// `dst`, or the first scratch register if that is `live`.
    pub(super) fn dst_unless(&self, dst: Fpr, live: Fpr) -> Fpr {
        if dst == live {
            self.scratch_fpr(0)
        } else {
            dst
        }
    }

    /// May overwrite `lhs`.
    fn sse_from_temporary(&mut self, op: Sse, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        let result = if self.has_avx() { dst } else { lhs };
        self.asm.sse(op, result, lhs, rhs);
        self.move_vector(dst, result);
    }

    /// `dst = op(0, src)`.
    pub(super) fn zero_op(&mut self, op: Sse, dst: Fpr, src: Fpr) {
        let zero = self.dst_unless(dst, src);
        self.zero_vector(zero);
        self.sse_from_temporary(op, dst, zero, src);
    }

    pub(super) fn sse_shift(&mut self, op: SseShiftImm, dst: Fpr, src: Fpr, amount: u8) {
        let src = self.first_source(dst, src);
        self.asm.sse_shift_imm(op, dst, src, amount);
    }

    fn sse_imm_with_constant(&mut self, op: SseImm, dst: Fpr, lhs: Fpr, bits: u128, imm: u8) {
        let constant = self.asm.constant(bits, 16);
        let lhs = self.first_source(dst, lhs);
        self.asm.sse_imm(op, dst, lhs, constant, imm);
    }

    fn set_where_ordered(&mut self, compare: SseImm, dst: Fpr, src: Fpr) {
        let src = self.first_source(dst, src);
        self.asm
            .sse_imm(compare, dst, src, src, FloatPredicate::Eq as u8);
    }

    /// NaN becomes zero too. Leaves zero in the register it returns.
    fn raise_to_zero(&mut self, max: Sse, dst: Fpr, src: Fpr) -> Fpr {
        let zero = self.scratch_fpr(0);
        self.zero_vector(zero);
        let src = self.first_source(dst, src);
        self.asm.sse(max, dst, src, zero);
        zero
    }

    fn truncate_into_fraction(&mut self, dst: Fpr, src: Fpr) {
        let control = rounding_control(Rounding::TowardZero);
        self.asm
            .sse_unary_imm(SseUnaryImm::Roundpd, dst, src, control);
        self.sse_with_constant(Sse::Addpd, dst, dst, TWO_TO_THE_52);
    }

    fn extend_high_half(&mut self, extend: SseUnary, dst: Fpr, src: Fpr) {
        self.asm
            .sse_unary_imm(SseUnaryImm::Pshufd, dst, src, HIGH_HALF_TWICE);
        self.asm.sse_unary(extend, dst, dst);
    }

    fn abs64(&mut self, dst: Fpr, src: Fpr) {
        if self.has_avx() {
            let negated = self.dst_unless(dst, src);
            self.zero_op(Sse::Psubq, negated, src);
            self.asm.blendv(Blendv::Vblendvpd, dst, src, negated, src);
        } else {
            let sign = self.scratch_fpr(0);
            self.spread_sign64(sign, src);
            self.sse_binary(Sse::Pxor, dst, src, sign);
            self.asm.sse(Sse::Psubq, dst, dst, sign);
        }
    }

    pub(super) fn spread_sign64(&mut self, dst: Fpr, src: Fpr) {
        self.asm
            .sse_unary_imm(SseUnaryImm::Pshufd, dst, src, ODD_LANES_TWICE);
        self.asm.sse_shift_imm(SseShiftImm::Psrad, dst, dst, 31);
    }

    fn count_ones_in_bytes(&mut self, dst: Fpr, src: Fpr) {
        const COUNTS: u128 = 0x0403_0302_0302_0201_0302_0201_0201_0100;
        const NIBBLE: u128 = splat(Size::S8, 0x0f);
        let (high, table) = (self.scratch_fpr(0), self.scratch_fpr(1));
        self.sse_shift(SseShiftImm::Psrlw, high, src, 4);
        self.sse_with_constant(Sse::Pand, high, high, NIBBLE);
        self.sse_with_constant(Sse::Pand, dst, src, NIBBLE);
        self.move_vector_constant(table, COUNTS);
        if self.has_avx() {
            self.asm.sse(Sse::Pshufb, dst, table, dst);
            self.asm.sse(Sse::Pshufb, table, table, high);
        } else {
            self.asm.sse(Sse::Pshufb, table, table, dst);
            self.move_vector_constant(dst, COUNTS);
            self.asm.sse(Sse::Pshufb, dst, dst, high);
        }
        self.sse_binary(Sse::Paddb, dst, dst, table);
    }

    pub(super) fn unary_form(&mut self, form: Form, dst: Fpr, src: Fpr) {
        match form {
            Form::One(op) => self.asm.sse_unary(op, dst, src),
            Form::Round(op, rounding) => {
                self.asm
                    .sse_unary_imm(op, dst, src, rounding_control(rounding));
            }
            Form::WithConstant(op, bits) => self.sse_with_constant(op, dst, src, bits),
            Form::Not => {
                let ones = self.dst_unless(dst, src);
                self.set_all_bits(ones);
                self.sse_binary(Sse::Pxor, dst, ones, src);
            }
            Form::Neg(sub) => self.zero_op(sub, dst, src),
            Form::Abs64 => self.abs64(dst, src),
            Form::Popcnt => self.count_ones_in_bytes(dst, src),
            Form::ExtendHighSigned(unpack, shift, bits, _) if self.has_avx() || dst == src => {
                self.asm.sse(unpack, dst, src, src);
                self.asm.sse_shift_imm(shift, dst, dst, bits);
            }
            Form::ExtendHighSigned(.., extend) => self.extend_high_half(extend, dst, src),
            Form::ExtendHighSigned32 => self.extend_high_half(SseUnary::Pmovsxdq, dst, src),
            Form::ExtendHighUnsigned(unpack) => {
                let zero = self.scratch_fpr(0);
                self.zero_vector(zero);
                self.sse_binary(unpack, dst, src, zero);
            }
            Form::AddPairsSigned8 => {
                let ones = self.dst_unless(dst, src);
                self.move_vector_constant(ones, splat(Size::S8, 1));
                self.sse_from_temporary(Sse::Pmaddubsw, dst, ones, src);
            }
            Form::AddPairsUnsigned16 => {
                let high = self.scratch_fpr(0);
                self.sse_shift(SseShiftImm::Psrld, high, src, 16);
                let src = self.first_source(dst, src);
                self.asm.sse_imm(SseImm::Pblendw, dst, src, high, ODD_WORDS);
                self.sse_binary(Sse::Paddd, dst, dst, high);
            }
            Form::SaturateF32Signed => {
                let mask = self.scratch_fpr(0);
                self.set_where_ordered(SseImm::Cmpps, mask, src);
                self.sse_binary(Sse::Andps, dst, src, mask);
                let at_least = FloatPredicate::GeOrUnordered as u8;
                self.sse_imm_with_constant(SseImm::Cmpps, mask, dst, TWO_TO_THE_31, at_least);
                self.asm.sse_unary(SseUnary::Cvttps2dq, dst, dst);
                self.sse_binary(Sse::Pxor, dst, dst, mask);
            }
            // From 2^31 on the conversion gives the top bit, and the fraction holds the others.
            Form::SaturateF32Unsigned => {
                let converted = self.raise_to_zero(Sse::Maxps, dst, src);
                self.asm.sse_unary(SseUnary::Cvttps2dq, converted, dst);
                self.sse_with_constant(Sse::Pmaxsd, dst, dst, TWO_TO_THE_31);
                self.sse_with_constant(Sse::Pminsd, dst, dst, TWO_TO_THE_32);
                self.asm.sse_shift_imm(SseShiftImm::Pslld, dst, dst, 8);
                self.sse_with_constant(Sse::Pminud, dst, dst, !sign_bits(FloatWidth::F32));
                self.sse_binary(Sse::Por, dst, dst, converted);
            }
            Form::TruncateF32Unsigned => {
                let converted = self.scratch_fpr(0);
                self.asm.sse_unary(SseUnary::Cvttps2dq, converted, src);
                self.sse_shift(SseShiftImm::Pslld, dst, src, 8);
                self.sse_with_constant(Sse::Por, dst, dst, sign_bits(FloatWidth::F32));
                self.sse_binary(Sse::Pmaxsd, dst, dst, converted);
            }
            Form::SaturateF64Signed => {
                let limit = self.scratch_fpr(0);
                self.set_where_ordered(SseImm::Cmppd, limit, src);
                self.sse_with_constant(Sse::Andps, limit, limit, f64x2(2_147_483_647.0));
                self.sse_binary(Sse::Minpd, dst, src, limit);
                self.asm.sse_unary(SseUnary::Cvttpd2dq, dst, dst);
            }
            Form::SaturateF64Unsigned => {
                let zero = self.raise_to_zero(Sse::Maxpd, dst, src);
                self.sse_with_constant(Sse::Minpd, dst, dst, f64x2(4_294_967_295.0));
                self.truncate_into_fraction(dst, dst);
                self.asm.sse_imm(SseImm::Shufps, dst, dst, zero, EVEN_LANES);
            }
            Form::TruncateF64Unsigned => {
                self.truncate_into_fraction(dst, src);
                self.sse_imm_with_constant(SseImm::Shufps, dst, dst, TWO_TO_THE_52, EVEN_LANES);
            }
            // Either half of an integer is exact in the fraction of a power of two. Only the sum rounds.
            Form::ConvertUnsignedToF32 => {
                const LOW_BIAS: f32 = (1u64 << 23) as f32;
                const HIGH_BIAS: f32 = (1u64 << 39) as f32;
                let low = self.scratch_fpr(0);
                self.sse_imm_with_constant(SseImm::Pblendw, low, src, f32x4(LOW_BIAS), ODD_WORDS);
                self.sse_shift(SseShiftImm::Psrld, dst, src, 16);
                self.sse_with_constant(Sse::Por, dst, dst, f32x4(HIGH_BIAS));
                self.sse_with_constant(Sse::Subps, dst, dst, f32x4(HIGH_BIAS + LOW_BIAS));
                self.sse_binary(Sse::Addps, dst, dst, low);
            }
            Form::ConvertUnsignedToF64 => {
                let upper_halves = splat(Size::S32, (TWO_TO_THE_52 >> 32) as u64);
                self.sse_with_constant(Sse::Unpcklps, dst, src, upper_halves);
                self.sse_with_constant(Sse::Subpd, dst, dst, TWO_TO_THE_52);
            }
        }
    }
}
