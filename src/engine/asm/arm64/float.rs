use super::constant::ConstantMove;
use super::immediate::{ArithmeticImm, FloatImm};
use super::load_store::AccessSize;
use super::macro_assembler::MacroAssembler;
use super::neon::VectorImm;
use super::neon_opcode::NeonBitwise;
use super::opcode::{
    AddSub, Cc, ConditionalCompare, Extend, FloatBinary, FloatFormat, FloatUnary, Nzcv, Select,
};
use super::registers::ZR;
use crate::assembly::{FloatAssembly, MacroAssembly};
use crate::features::Arm64Features;
use crate::label::Label;
use crate::operand::{
    Address, FloatCond, FloatWidth, Memory, NegativeZero, RegOrImm, Rounding, Sign, TestCond, Width,
};
use crate::register::{Fpr, Gpr};

/// What to ask of the flags that `fcmp` sets.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FloatFlags {
    One(Cc),
    Either(Cc, Cc),
}

impl FloatFlags {
    pub fn inverted(self) -> Self {
        match self {
            Self::One(cc) => Self::One(cc.inverted()),
            Self::Either(Cc::Mi, _) => FloatCond::EqOrUnordered.into(),
            Self::Either(..) => FloatCond::Ne.into(),
        }
    }
}

impl From<FloatCond> for FloatFlags {
    fn from(cond: FloatCond) -> Self {
        Self::One(match cond {
            FloatCond::Ne => return Self::Either(Cc::Mi, Cc::Gt),
            FloatCond::EqOrUnordered => return Self::Either(Cc::Eq, Cc::Vs),
            FloatCond::Eq => Cc::Eq,
            FloatCond::NeOrUnordered => Cc::Ne,
            FloatCond::Lt => Cc::Mi,
            FloatCond::GeOrUnordered => Cc::Pl,
            FloatCond::Le => Cc::Ls,
            FloatCond::GtOrUnordered => Cc::Hi,
            FloatCond::Gt => Cc::Gt,
            FloatCond::LeOrUnordered => Cc::Le,
            FloatCond::Ge => Cc::Ge,
            FloatCond::LtOrUnordered => Cc::Lt,
            FloatCond::Ordered => Cc::Vc,
            FloatCond::Unordered => Cc::Vs,
        })
    }
}

/// With more instructions than this a load is better.
const LONGEST_MOVE_TO_FLOAT: u32 = 2;

fn float_bits(width: FloatWidth, value: f64) -> u64 {
    match width {
        FloatWidth::F32 => (value as f32).to_bits().into(),
        FloatWidth::F64 => value.to_bits(),
    }
}

impl MacroAssembler {
    fn jump_on_float_flags(&mut self, cond: FloatCond, target: Label) {
        match cond.into() {
            FloatFlags::One(cc) => self.asm.b_cond(cc, target),
            FloatFlags::Either(first, second) => {
                self.asm.b_cond(first, target);
                self.asm.b_cond(second, target);
            }
        }
    }

    /// `select` takes `then`, `or` and a condition, and writes `dst`.
    fn select_on_float_flags<R: Copy + PartialEq>(
        &mut self,
        cond: FloatCond,
        dst: R,
        then: R,
        or: R,
        select: impl Fn(&mut Self, R, R, Cc),
    ) {
        let (cond, then, or) = if dst == then {
            (cond.inverted(), or, then)
        } else {
            (cond, then, or)
        };
        match cond.into() {
            FloatFlags::One(cc) => select(self, then, or, cc),
            FloatFlags::Either(first, second) => {
                select(self, then, or, first);
                select(self, then, dst, second);
            }
        }
    }

    /// Sets the overflow flag for the greatest signed integer and the zero flag for the greatest unsigned one.
    fn check_for_greatest_integer(&mut self, value: Gpr) {
        self.asm.cmn_imm(Width::W64, value, ArithmeticImm::ONE);
    }
}

impl FloatAssembly for MacroAssembler {
    #[inline]
    fn move_float(&mut self, dst: Fpr, src: Fpr) {
        // Some processors take no time for this, and do for `fmov`.
        self.move_vector(dst, src);
    }

    #[inline]
    fn move_vector(&mut self, dst: Fpr, src: Fpr) {
        if dst != src {
            self.asm.neon_bitwise(NeonBitwise::Orr, dst, src, src);
        }
    }

    #[inline]
    fn load_vector(&mut self, dst: Fpr, src: impl Into<Memory>) {
        let src = self.mem(AccessSize::S128, src);
        self.asm.ldr_fpr(dst, src);
    }

    #[inline]
    fn store_vector(&mut self, dst: impl Into<Memory>, src: Fpr) {
        let dst = self.mem(AccessSize::S128, dst);
        self.asm.str_fpr(src, dst);
    }

    fn move_float_constant(&mut self, width: FloatWidth, dst: Fpr, bits: u64) {
        let bits = bits & u64::MAX >> (64 - width.width().bits());
        if bits == 0 {
            return self.asm.movi(dst, VectorImm::ZERO);
        }
        if let Some(imm) = FloatImm::new(width, bits) {
            return self.asm.fmov_imm(dst, imm);
        }
        let constant = ConstantMove::new(width.width(), bits);
        match self.scratch.gprs[1] {
            Some(temp) if constant.instructions() <= LONGEST_MOVE_TO_FLOAT => {
                self.asm.move_constant(temp, constant);
                self.asm.fmov_to_fpr(width, dst, temp);
            }
            _ => self
                .asm
                .ldr_fpr_constant(dst, bits.into(), width.width().size().bytes()),
        }
    }

    #[inline]
    fn move_bits_to_float(&mut self, width: FloatWidth, dst: Fpr, src: Gpr) {
        self.asm.fmov_to_fpr(width, dst, src);
    }

    #[inline]
    fn move_float_to_bits(&mut self, width: FloatWidth, dst: Gpr, src: Fpr) {
        self.asm.fmov_from_fpr(width, dst, src);
    }

    #[inline]
    fn load_float(&mut self, width: FloatWidth, dst: Fpr, src: impl Into<Memory>) {
        let src = self.mem(width, src);
        self.asm.ldr_fpr(dst, src);
    }

    #[inline]
    fn store_float(&mut self, width: FloatWidth, dst: impl Into<Memory>, src: Fpr) {
        let dst = self.mem(width, dst);
        self.asm.str_fpr(src, dst);
    }

    fn load_pair_f64(&mut self, low: Fpr, high: Fpr, src: Address) {
        let src = self.pair_mem(AccessSize::S64, src);
        self.asm.ldp_fpr(low, high, src);
    }

    fn store_pair_f64(&mut self, dst: Address, low: Fpr, high: Fpr) {
        let dst = self.pair_mem(AccessSize::S64, dst);
        self.asm.stp_fpr(low, high, dst);
    }

    fn load_pair_vector(&mut self, low: Fpr, high: Fpr, src: Address) {
        let src = self.pair_mem(AccessSize::S128, src);
        self.asm.ldp_fpr(low, high, src);
    }

    fn store_pair_vector(&mut self, dst: Address, low: Fpr, high: Fpr) {
        let dst = self.pair_mem(AccessSize::S128, dst);
        self.asm.stp_fpr(low, high, dst);
    }

    fn add_float(&mut self, width: FloatWidth, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        self.asm
            .float_binary(FloatBinary::Fadd, width, dst, lhs, rhs);
    }

    fn sub_float(&mut self, width: FloatWidth, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        self.asm
            .float_binary(FloatBinary::Fsub, width, dst, lhs, rhs);
    }

    fn mul_float(&mut self, width: FloatWidth, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        self.asm
            .float_binary(FloatBinary::Fmul, width, dst, lhs, rhs);
    }

    fn div_float(&mut self, width: FloatWidth, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        self.asm
            .float_binary(FloatBinary::Fdiv, width, dst, lhs, rhs);
    }

    fn min_float(&mut self, width: FloatWidth, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        self.asm
            .float_binary(FloatBinary::Fmin, width, dst, lhs, rhs);
    }

    fn max_float(&mut self, width: FloatWidth, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        self.asm
            .float_binary(FloatBinary::Fmax, width, dst, lhs, rhs);
    }

    fn copysign_float(&mut self, width: FloatWidth, dst: Fpr, magnitude: Fpr, sign: Fpr) {
        let mask = if dst == magnitude || dst == sign {
            self.scratch_fpr(0)
        } else {
            dst
        };
        match width {
            FloatWidth::F32 => self.asm.movi(mask, VectorImm::SIGNS32),
            FloatWidth::F64 => {
                self.asm.movi(mask, VectorImm::ZERO);
                self.neg_f64(mask, mask);
            }
        }
        if dst == magnitude {
            self.asm.neon_bitwise(NeonBitwise::Bit, dst, sign, mask);
        } else if dst == sign {
            self.asm
                .neon_bitwise(NeonBitwise::Bif, dst, magnitude, mask);
        } else {
            self.asm
                .neon_bitwise(NeonBitwise::Bsl, dst, sign, magnitude);
        }
    }

    fn abs_float(&mut self, width: FloatWidth, dst: Fpr, src: Fpr) {
        self.asm.float_unary(FloatUnary::Fabs, width, dst, src);
    }

    fn neg_float(&mut self, width: FloatWidth, dst: Fpr, src: Fpr) {
        self.asm.float_unary(FloatUnary::Fneg, width, dst, src);
    }

    fn sqrt_float(&mut self, width: FloatWidth, dst: Fpr, src: Fpr) {
        self.asm.float_unary(FloatUnary::Fsqrt, width, dst, src);
    }

    fn round_float(&mut self, rounding: Rounding, width: FloatWidth, dst: Fpr, src: Fpr) {
        self.asm.float_unary(rounding.into(), width, dst, src);
    }

    fn convert_f32_to_f64(&mut self, dst: Fpr, src: Fpr) {
        self.asm
            .fcvt(FloatFormat::Single, FloatFormat::Double, dst, src);
    }

    fn convert_f64_to_f32(&mut self, dst: Fpr, src: Fpr) {
        self.asm
            .fcvt(FloatFormat::Double, FloatFormat::Single, dst, src);
    }

    fn supports_f16(&self) -> bool {
        true
    }

    fn convert_f16_bits_to_f64(&mut self, dst: Fpr, src: Gpr) {
        self.move_bits_to_f32(dst, src);
        self.asm
            .fcvt(FloatFormat::Half, FloatFormat::Double, dst, dst);
    }

    fn convert_f64_to_f16_bits(&mut self, dst: Gpr, src: Fpr) {
        let half = self.scratch_fpr(0);
        self.asm
            .fcvt(FloatFormat::Double, FloatFormat::Half, half, src);
        self.move_f32_to_bits(dst, half);
    }

    fn convert_int_to_float(
        &mut self,
        sign: Sign,
        from: Width,
        to: FloatWidth,
        dst: Fpr,
        src: Gpr,
    ) {
        self.asm.cvtf(sign, from, to, dst, src);
    }

    fn truncate_float(&mut self, from: FloatWidth, sign: Sign, to: Width, dst: Gpr, src: Fpr) {
        self.asm.fcvtz(from, sign, to, dst, src);
    }

    fn truncate_float_saturating(
        &mut self,
        from: FloatWidth,
        sign: Sign,
        to: Width,
        dst: Gpr,
        src: Fpr,
    ) {
        self.asm.fcvtz(from, sign, to, dst, src);
    }

    fn truncate_float_or_branch(
        &mut self,
        from: FloatWidth,
        sign: Sign,
        to: Width,
        dst: Gpr,
        src: Fpr,
        failure: Label,
    ) {
        if to == Width::W32 {
            let extend = match sign {
                Sign::Signed => Extend::Sxtw,
                Sign::Unsigned => Extend::Uxtw,
            };
            self.asm.fcvtz(from, Sign::Signed, Width::W64, dst, src);
            self.asm
                .add_sub_extended(AddSub::Subs, Width::W64, ZR, dst, dst, extend, 0);
            self.asm.fccmp(from, src, src, Nzcv::empty(), Cc::Eq);
            self.asm.b_cond(Cc::Ne, failure);
            if sign == Sign::Signed {
                self.asm.mov(Width::W32, dst, dst);
            }
            return;
        }
        let (bound, below_greatest, otherwise, fails) = match sign {
            Sign::Signed => (i64::MIN as f64, Cc::Vc, Nzcv::N, Cc::Lt),
            Sign::Unsigned => (-1.0, Cc::Ne, Nzcv::Z, Cc::Le),
        };
        let bound_register = self.scratch_fpr(0);
        self.move_float_constant(from, bound_register, float_bits(from, bound));
        self.asm.fcvtz(from, sign, to, dst, src);
        // No float is that integer, so it stands for one that is too large.
        self.check_for_greatest_integer(dst);
        self.asm
            .fccmp(from, src, bound_register, otherwise, below_greatest);
        self.asm.b_cond(fails, failure);
    }

    fn truncate_f64_to_int32_modular(&mut self, dst: Gpr, src: Fpr, slow: Label) {
        if self.asm.has(Arm64Features::JSCVT) {
            return self.asm.fjcvtzs(dst, src);
        }
        self.asm
            .fcvtz(FloatWidth::F64, Sign::Signed, Width::W64, dst, src);
        self.check_for_greatest_integer(dst);
        self.asm.compare_imm_if(
            ConditionalCompare::Ccmp,
            Width::W64,
            dst,
            1,
            Nzcv::V,
            Cc::Vc,
        );
        self.asm.b_cond(Cc::Vs, slow);
        self.asm.mov(Width::W32, dst, dst);
    }

    fn convert_f64_to_int_exact(
        &mut self,
        width: Width,
        dst: Gpr,
        src: Fpr,
        zero: NegativeZero,
        failure: Label,
    ) {
        if width == Width::W32 && zero == NegativeZero::Reject && self.asm.has(Arm64Features::JSCVT)
        {
            self.asm.fjcvtzs(dst, src);
            return self.asm.b_cond(Cc::Ne, failure);
        }
        let back = self.scratch_fpr(0);
        self.asm
            .fcvtz(FloatWidth::F64, Sign::Signed, width, dst, src);
        if zero == NegativeZero::Accept && self.asm.has(Arm64Features::FRINTTS) {
            let truncate = match width {
                Width::W32 => FloatUnary::Frint32z,
                Width::W64 => FloatUnary::Frint64z,
            };
            self.asm.float_unary(truncate, FloatWidth::F64, back, src);
            return self.branch_f64(FloatCond::NeOrUnordered, src, back, failure);
        }
        self.asm
            .cvtf(Sign::Signed, width, FloatWidth::F64, back, dst);
        match (zero, width) {
            (NegativeZero::Accept, Width::W32) => self.asm.fcmp(FloatWidth::F64, src, back),
            (NegativeZero::Accept, Width::W64) => {
                self.check_for_greatest_integer(dst);
                self.asm
                    .fccmp(FloatWidth::F64, src, back, Nzcv::empty(), Cc::Vc);
            }
            (NegativeZero::Reject, _) => {
                let difference = self.data_scratch();
                self.asm.neon_bitwise(NeonBitwise::Eor, back, back, src);
                self.move_f64_to_bits(difference, back);
                if width == Width::W32 {
                    return self.asm.cbnz(Width::W64, difference, failure);
                }
                self.check_for_greatest_integer(dst);
                self.asm.compare_imm_if(
                    ConditionalCompare::Ccmp,
                    width,
                    difference,
                    0,
                    Nzcv::empty(),
                    Cc::Vc,
                );
            }
        }
        self.asm.b_cond(Cc::Ne, failure);
    }

    fn branch_float(
        &mut self,
        width: FloatWidth,
        cond: FloatCond,
        lhs: Fpr,
        rhs: Fpr,
        target: Label,
    ) {
        self.asm.fcmp(width, lhs, rhs);
        self.jump_on_float_flags(cond, target);
    }

    fn branch_float_with_zero(
        &mut self,
        width: FloatWidth,
        cond: FloatCond,
        lhs: Fpr,
        target: Label,
    ) {
        self.asm.fcmp_zero(width, lhs);
        self.jump_on_float_flags(cond, target);
    }

    fn compare_float(&mut self, width: FloatWidth, cond: FloatCond, dst: Gpr, lhs: Fpr, rhs: Fpr) {
        self.asm.fcmp(width, lhs, rhs);
        match cond.into() {
            FloatFlags::One(cc) => self.asm.cset(dst, cc),
            FloatFlags::Either(first, second) => {
                self.asm.cset(dst, first);
                self.asm
                    .select(Select::Csinc, Width::W32, dst, dst, ZR, second.inverted());
            }
        }
    }

    fn select_on_float(
        &mut self,
        width: FloatWidth,
        cond: FloatCond,
        dst: Gpr,
        lhs: Fpr,
        rhs: Fpr,
        then: Gpr,
        or: Gpr,
    ) {
        self.asm.fcmp(width, lhs, rhs);
        self.select_on_float_flags(cond, dst, then, or, |masm, then, or, cc| {
            masm.asm.select(Select::Csel, Width::W64, dst, then, or, cc);
        });
    }

    fn select_float_on_float(
        &mut self,
        width: FloatWidth,
        cond: FloatCond,
        dst: Fpr,
        lhs: Fpr,
        rhs: Fpr,
        then: Fpr,
        or: Fpr,
    ) {
        self.asm.fcmp(width, lhs, rhs);
        self.select_on_float_flags(cond, dst, then, or, |masm, then, or, cc| {
            masm.asm.fcsel(FloatWidth::F64, dst, then, or, cc);
        });
    }

    fn select_float_test(
        &mut self,
        width: Width,
        cond: TestCond,
        dst: Fpr,
        value: Gpr,
        mask: impl Into<RegOrImm>,
        then: Fpr,
        or: Fpr,
    ) {
        let cc = self.set_flags_for_test(width, cond, value.into(), mask.into());
        self.asm.fcsel(FloatWidth::F64, dst, then, or, cc);
    }

    fn select_vector_test(
        &mut self,
        width: Width,
        cond: TestCond,
        dst: Fpr,
        value: Gpr,
        mask: impl Into<RegOrImm>,
        then: Fpr,
        or: Fpr,
    ) {
        let (cond, then, or) = if dst == or {
            (cond.inverted(), or, then)
        } else {
            (cond, then, or)
        };
        let done = self.new_label();
        self.move_vector(dst, then);
        self.branch_test(width, cond, value, mask, done);
        self.move_vector(dst, or);
        self.bind(done);
    }
}
