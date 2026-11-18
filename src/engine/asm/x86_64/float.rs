use super::integer::MacroAssembler;
use super::opcode::{
    Alu, AvxUnary, BitTest, Cc, FloatPredicate, MoveMask, ShiftOp, Sse, SseImm, SseLoad, SseStore,
    SseUnary, Unary,
};
use super::registers::{XMM0, XMM8};
use crate::assembly::{FloatAssembly, MacroAssembly};
use crate::features::X64Features;
use crate::label::Label;
use crate::operand::{
    Address, FloatCond, FloatWidth, Memory, NegativeZero, RegOrImm, Rounding, Sign, Size, TestCond,
    Width,
};
use crate::register::{Fpr, Gpr};

/// What to ask of the flags that `ucomiss` and `ucomisd` set.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FloatFlags {
    One(Cc),
    /// `E` and `Np`.
    EqualAndOrdered,
    /// `Ne` or `P`.
    NotEqualOrUnordered,
}

impl FloatFlags {
    /// Also says whether the operands are compared in reverse order.
    pub fn for_condition(cond: FloatCond, same_operands: bool) -> (Self, bool) {
        match cond {
            FloatCond::Eq if same_operands => (Self::One(Cc::Np), false),
            FloatCond::NeOrUnordered if same_operands => (Self::One(Cc::P), false),
            FloatCond::Eq => (Self::EqualAndOrdered, false),
            FloatCond::NeOrUnordered => (Self::NotEqualOrUnordered, false),
            FloatCond::Ne => (Self::One(Cc::Ne), false),
            FloatCond::EqOrUnordered => (Self::One(Cc::E), false),
            FloatCond::Gt => (Self::One(Cc::A), false),
            FloatCond::Ge => (Self::One(Cc::Ae), false),
            FloatCond::Lt => (Self::One(Cc::A), true),
            FloatCond::Le => (Self::One(Cc::Ae), true),
            FloatCond::LtOrUnordered => (Self::One(Cc::B), false),
            FloatCond::LeOrUnordered => (Self::One(Cc::Be), false),
            FloatCond::GtOrUnordered => (Self::One(Cc::B), true),
            FloatCond::GeOrUnordered => (Self::One(Cc::Be), true),
            FloatCond::Ordered => (Self::One(Cc::Np), false),
            FloatCond::Unordered => (Self::One(Cc::P), false),
        }
    }

    pub fn inverted(self) -> Self {
        match self {
            Self::One(cc) => Self::One(cc.inverted()),
            Self::EqualAndOrdered => Self::NotEqualOrUnordered,
            Self::NotEqualOrUnordered => Self::EqualAndOrdered,
        }
    }
}

/// The immediate of `roundss` and its relatives. It also masks the precision exception.
pub fn rounding_control(rounding: Rounding) -> u8 {
    8 | match rounding {
        Rounding::Nearest => 0,
        Rounding::Down => 1,
        Rounding::Up => 2,
        Rounding::TowardZero => 3,
    }
}

#[inline]
pub(super) fn pick<T>(width: FloatWidth, single: T, double: T) -> T {
    match width {
        FloatWidth::F32 => single,
        FloatWidth::F64 => double,
    }
}

pub(super) fn sign_bits(width: FloatWidth) -> u128 {
    pick(
        width,
        0x8000_0000_8000_0000_8000_0000_8000_0000,
        0x8000_0000_0000_0000_8000_0000_0000_0000,
    )
}

impl MacroAssembler {
    #[inline]
    pub(super) fn has_avx(&self) -> bool {
        self.asm.has(X64Features::AVX)
    }

    pub(super) fn zero_vector(&mut self, dst: Fpr) {
        self.sse_without_source(Sse::Xorps, dst);
    }

    /// For what gives the same for any two equal operands.
    pub(super) fn sse_without_source(&mut self, op: Sse, dst: Fpr) {
        let any = if self.has_avx() { XMM0 } else { dst };
        self.asm.sse(op, dst, any, any);
    }

    /// Without AVX this may overwrite the first scratch register.
    #[inline]
    pub(super) fn sse_binary(&mut self, op: Sse, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        if self.has_avx() && op.commutes() && rhs >= XMM8 {
            // The short form of the prefix cannot name these as the last operand.
            self.asm.sse(op, dst, rhs, lhs);
        } else if self.has_avx() || dst == lhs {
            self.asm.sse(op, dst, lhs, rhs);
        } else if dst != rhs {
            self.move_vector(dst, lhs);
            self.asm.sse(op, dst, dst, rhs);
        } else if op.commutes() {
            self.asm.sse(op, dst, dst, lhs);
        } else {
            let scratch = self.scratch_fpr(0);
            self.move_vector(scratch, rhs);
            self.move_vector(dst, lhs);
            self.asm.sse(op, dst, dst, scratch);
        }
    }

    pub(super) fn sse_with_memory(&mut self, op: Sse, dst: Fpr, lhs: Fpr, rhs: Address) {
        let lhs = self.first_source(dst, lhs);
        self.asm.sse(op, dst, lhs, rhs);
    }

    pub(super) fn sse_with_constant(&mut self, op: Sse, dst: Fpr, lhs: Fpr, bits: u128) {
        let constant = self.asm.constant(bits, 16);
        self.sse_with_memory(op, dst, lhs, constant);
    }

    /// The register to name as the first source of an instruction whose other source is not `dst`.
    #[inline]
    pub(super) fn first_source(&mut self, dst: Fpr, src: Fpr) -> Fpr {
        if self.has_avx() {
            return src;
        }
        self.move_vector(dst, src);
        dst
    }

    /// Does not wait for the old value of `dst`.
    fn scalar_unary(&mut self, op: Sse, dst: Fpr, src: Fpr) {
        let src = self.first_source(dst, src);
        self.asm.sse(op, dst, src, src);
    }

    fn float_constant(&mut self, width: FloatWidth, value: f64) -> Address {
        match width {
            FloatWidth::F32 => self.asm.constant((value as f32).to_bits().into(), 4),
            FloatWidth::F64 => self.asm.constant(value.to_bits().into(), 8),
        }
    }

    fn set_float_flags(
        &mut self,
        width: FloatWidth,
        cond: FloatCond,
        lhs: Fpr,
        rhs: Fpr,
    ) -> FloatFlags {
        let (flags, reversed) = FloatFlags::for_condition(cond, lhs == rhs);
        let (lhs, rhs) = if reversed { (rhs, lhs) } else { (lhs, rhs) };
        self.asm
            .sse_unary(pick(width, SseUnary::Ucomiss, SseUnary::Ucomisd), lhs, rhs);
        flags
    }

    pub fn jump_on_float_flags(&mut self, flags: FloatFlags, target: Label) {
        match flags {
            FloatFlags::One(cc) => self.asm.jcc(cc, target),
            FloatFlags::EqualAndOrdered => {
                let unordered = self.new_label();
                self.asm.jcc_short(Cc::P, unordered);
                self.asm.jcc(Cc::E, target);
                self.bind(unordered);
            }
            FloatFlags::NotEqualOrUnordered => {
                self.asm.jcc(Cc::Ne, target);
                self.asm.jcc(Cc::P, target);
            }
        }
    }

    pub fn select_on_float_flags(&mut self, flags: FloatFlags, dst: Gpr, then: Gpr, or: Gpr) {
        let (equal, different) = match flags {
            FloatFlags::One(cc) => return self.select_on_flags(cc, dst, then, or),
            FloatFlags::EqualAndOrdered => (then, or),
            FloatFlags::NotEqualOrUnordered => (or, then),
        };
        if dst == different {
            let unordered = self.new_label();
            self.asm.jcc_short(Cc::P, unordered);
            self.asm.cmov(Cc::E, Width::W64, dst, equal);
            self.bind(unordered);
        } else {
            self.copy(Width::W64, dst, equal);
            self.asm.cmov(Cc::Ne, Width::W64, dst, different);
            self.asm.cmov(Cc::P, Width::W64, dst, different);
        }
    }

    pub fn select_vector_on_flags(&mut self, flags: FloatFlags, dst: Fpr, then: Fpr, or: Fpr) {
        let (flags, then, or) = if dst == or {
            (flags.inverted(), or, then)
        } else {
            (flags, then, or)
        };
        let done = self.new_label();
        self.move_vector(dst, then);
        match flags {
            FloatFlags::One(cc) => self.asm.jcc_short(cc, done),
            FloatFlags::EqualAndOrdered => {
                let unordered = self.new_label();
                self.asm.jcc_short(Cc::P, unordered);
                self.asm.jcc_short(Cc::E, done);
                self.bind(unordered);
            }
            FloatFlags::NotEqualOrUnordered => {
                self.asm.jcc_short(Cc::Ne, done);
                self.asm.jcc_short(Cc::P, done);
            }
        }
        self.move_vector(dst, or);
        self.bind(done);
    }

    fn min_or_max(
        &mut self,
        width: FloatWidth,
        if_different: Sse,
        if_equal: Sse,
        dst: Fpr,
        lhs: Fpr,
        rhs: Fpr,
    ) {
        let (lhs, rhs) = if dst == rhs { (rhs, lhs) } else { (lhs, rhs) };
        let (different, unordered, done) = (self.new_label(), self.new_label(), self.new_label());
        self.set_float_flags(width, FloatCond::Ne, lhs, rhs);
        self.asm.jcc_short(Cc::Ne, different);
        self.asm.jcc_short(Cc::P, unordered);
        self.sse_binary(if_equal, dst, lhs, rhs);
        self.asm.jmp_short(done);
        self.bind(unordered);
        self.sse_binary(pick(width, Sse::Addss, Sse::Addsd), dst, lhs, rhs);
        self.asm.jmp_short(done);
        self.bind(different);
        self.sse_binary(if_different, dst, lhs, rhs);
        self.bind(done);
    }

    fn convert_signed(&mut self, from: Width, to: FloatWidth, dst: Fpr, src: Gpr) {
        self.zero_vector(dst);
        self.asm.cvtsi2s(from, to, dst, dst, src);
    }

    /// The result is negative unless `src` is from 2^63 up to 2^64.
    fn truncate_less_two_to_the_63(&mut self, from: FloatWidth, dst: Gpr, src: Fpr) {
        let scratch = self.scratch_fpr(0);
        let bias = self.float_constant(from, 9_223_372_036_854_775_808.0);
        self.sse_with_memory(pick(from, Sse::Subss, Sse::Subsd), scratch, src, bias);
        self.asm.cvtts2si(from, Width::W64, dst, scratch);
    }

    /// Sets the overflow flag for the least integer.
    fn check_for_least_integer(&mut self, width: Width, value: Gpr) {
        self.asm.alu_imm(Alu::Cmp, width.size(), value, 1);
    }

    fn truncate_or_skip_if_below_two_to_the_63(
        &mut self,
        from: FloatWidth,
        dst: Gpr,
        src: Fpr,
        done: Label,
    ) {
        self.asm.cvtts2si(from, Width::W64, dst, src);
        self.asm.test(Size::S64, dst, dst);
        self.asm.jcc_short(Cc::Ns, done);
        self.truncate_less_two_to_the_63(from, dst, src);
    }
}

impl FloatAssembly for MacroAssembler {
    #[inline]
    fn move_float(&mut self, dst: Fpr, src: Fpr) {
        self.move_vector(dst, src);
    }

    #[inline]
    fn move_vector(&mut self, dst: Fpr, src: Fpr) {
        if dst != src {
            self.asm.sse_unary(SseUnary::Movaps, dst, src);
        }
    }

    #[inline]
    fn load_vector(&mut self, dst: Fpr, src: impl Into<Memory>) {
        let src = self.address(src);
        self.asm.sse_unary(SseUnary::Movups, dst, src);
    }

    #[inline]
    fn store_vector(&mut self, dst: impl Into<Memory>, src: Fpr) {
        let dst = self.address(dst);
        self.asm.sse_store(SseStore::Movups, dst, src);
    }

    fn move_float_constant(&mut self, width: FloatWidth, dst: Fpr, bits: u64) {
        let bits = pick(width, (bits as u32).into(), bits);
        if bits == 0 {
            return self.zero_vector(dst);
        }
        let constant = self.asm.constant(bits.into(), width.width().size().bytes());
        self.load_float(width, dst, constant);
    }

    #[inline]
    fn move_bits_to_float(&mut self, width: FloatWidth, dst: Fpr, src: Gpr) {
        self.asm.movd_to_xmm(width.width(), dst, src);
    }

    #[inline]
    fn move_float_to_bits(&mut self, width: FloatWidth, dst: Gpr, src: Fpr) {
        self.asm.movd_from_xmm(width.width(), dst, src);
    }

    #[inline]
    fn load_float(&mut self, width: FloatWidth, dst: Fpr, src: impl Into<Memory>) {
        let src = self.address(src);
        self.asm
            .sse_load(pick(width, SseLoad::Movss, SseLoad::Movsd), dst, src);
    }

    #[inline]
    fn store_float(&mut self, width: FloatWidth, dst: impl Into<Memory>, src: Fpr) {
        let dst = self.address(dst);
        self.asm
            .sse_store(pick(width, SseStore::Movss, SseStore::Movsd), dst, src);
    }

    fn load_pair_f64(&mut self, low: Fpr, high: Fpr, src: Address) {
        assert!(low != high);
        self.load_f64(low, src);
        self.load_f64(high, src.plus(8));
    }

    fn store_pair_f64(&mut self, dst: Address, low: Fpr, high: Fpr) {
        self.store_f64(dst, low);
        self.store_f64(dst.plus(8), high);
    }

    fn load_pair_vector(&mut self, low: Fpr, high: Fpr, src: Address) {
        assert!(low != high);
        self.load_vector(low, src);
        self.load_vector(high, src.plus(16));
    }

    fn store_pair_vector(&mut self, dst: Address, low: Fpr, high: Fpr) {
        self.store_vector(dst, low);
        self.store_vector(dst.plus(16), high);
    }

    fn add_float(&mut self, width: FloatWidth, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        self.sse_binary(pick(width, Sse::Addss, Sse::Addsd), dst, lhs, rhs);
    }

    fn sub_float(&mut self, width: FloatWidth, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        self.sse_binary(pick(width, Sse::Subss, Sse::Subsd), dst, lhs, rhs);
    }

    fn mul_float(&mut self, width: FloatWidth, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        self.sse_binary(pick(width, Sse::Mulss, Sse::Mulsd), dst, lhs, rhs);
    }

    fn div_float(&mut self, width: FloatWidth, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        self.sse_binary(pick(width, Sse::Divss, Sse::Divsd), dst, lhs, rhs);
    }

    fn min_float(&mut self, width: FloatWidth, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        self.min_or_max(
            width,
            pick(width, Sse::Minss, Sse::Minsd),
            Sse::Orps,
            dst,
            lhs,
            rhs,
        );
    }

    fn max_float(&mut self, width: FloatWidth, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        self.min_or_max(
            width,
            pick(width, Sse::Maxss, Sse::Maxsd),
            Sse::Andps,
            dst,
            lhs,
            rhs,
        );
    }

    fn copysign_float(&mut self, width: FloatWidth, dst: Fpr, magnitude: Fpr, sign: Fpr) {
        let scratch = self.scratch_fpr(0);
        self.sse_with_constant(Sse::Andps, scratch, sign, sign_bits(width));
        self.abs_float(width, dst, magnitude);
        self.asm.sse(Sse::Orps, dst, dst, scratch);
    }

    fn abs_float(&mut self, width: FloatWidth, dst: Fpr, src: Fpr) {
        self.sse_with_constant(Sse::Andps, dst, src, !sign_bits(width));
    }

    fn neg_float(&mut self, width: FloatWidth, dst: Fpr, src: Fpr) {
        self.sse_with_constant(Sse::Xorps, dst, src, sign_bits(width));
    }

    fn sqrt_float(&mut self, width: FloatWidth, dst: Fpr, src: Fpr) {
        self.scalar_unary(pick(width, Sse::Sqrtss, Sse::Sqrtsd), dst, src);
    }

    fn round_float(&mut self, rounding: Rounding, width: FloatWidth, dst: Fpr, src: Fpr) {
        let src = self.first_source(dst, src);
        self.asm.sse_imm(
            pick(width, SseImm::Roundss, SseImm::Roundsd),
            dst,
            src,
            src,
            rounding_control(rounding),
        );
    }

    fn convert_f32_to_f64(&mut self, dst: Fpr, src: Fpr) {
        self.scalar_unary(Sse::Cvtss2sd, dst, src);
    }

    fn convert_f64_to_f32(&mut self, dst: Fpr, src: Fpr) {
        self.scalar_unary(Sse::Cvtsd2ss, dst, src);
    }

    fn supports_f16(&self) -> bool {
        self.asm.has(X64Features::AVX | X64Features::F16C)
    }

    fn convert_f16_bits_to_f64(&mut self, dst: Fpr, src: Gpr) {
        self.asm.movd_to_xmm(Width::W32, dst, src);
        self.asm.avx_unary(AvxUnary::Vcvtph2ps, dst, dst);
        self.convert_f32_to_f64(dst, dst);
    }

    /// The step through 32 bits rounds to odd, which leaves the outcome of the second rounding alone.
    fn convert_f64_to_f16_bits(&mut self, dst: Gpr, src: Fpr) {
        const TO_NEAREST: u8 = 0;
        let (single, back, bits) = (self.scratch_fpr(0), self.scratch_fpr(1), self.scratch_gpr());
        let exact_or_nan = self.new_label();
        self.convert_f64_to_f32(single, src);
        self.convert_f32_to_f64(back, single);
        self.asm.sse_unary(SseUnary::Ucomisd, back, src);
        self.asm.jcc_short(Cc::E, exact_or_nan);
        self.move_f64_to_bits(bits, back);
        self.move_f64_to_bits(dst, src);
        self.asm.alu(Alu::Cmp, Size::S64, dst, bits);
        self.move_f32_to_bits(dst, single);
        self.asm.alu_imm(Alu::Sbb, Size::S32, dst, 0);
        self.asm.alu_imm(Alu::Or, Size::S32, dst, 1);
        self.move_bits_to_f32(single, dst);
        self.bind(exact_or_nan);
        self.asm.vcvtps2ph(single, single, TO_NEAREST);
        self.asm.pextr(Size::S16, dst, single, 0);
    }

    fn convert_int_to_float(
        &mut self,
        sign: Sign,
        from: Width,
        to: FloatWidth,
        dst: Fpr,
        src: Gpr,
    ) {
        if sign == Sign::Signed {
            return self.convert_signed(from, to, dst, src);
        }
        let scratch = self.scratch_gpr();
        self.asm.mov(from, scratch, src);
        if from == Width::W32 {
            return self.convert_signed(Width::W64, to, dst, scratch);
        }
        let (large, even, done) = (self.new_label(), self.new_label(), self.new_label());
        self.zero_vector(dst);
        self.asm.test(Size::S64, src, src);
        self.asm.jcc_short(Cc::S, large);
        self.asm.cvtsi2s(from, to, dst, dst, src);
        self.asm.jmp_short(done);
        self.bind(large);
        // The bit that halving drops still takes part in the rounding.
        self.asm.shift_imm(ShiftOp::Shr, Size::S64, scratch, 1);
        self.asm.jcc_short(Cc::Ae, even);
        self.asm.alu_imm(Alu::Or, Size::S64, scratch, 1);
        self.bind(even);
        self.asm.cvtsi2s(from, to, dst, dst, scratch);
        self.add_float(to, dst, dst, dst);
        self.bind(done);
    }

    fn truncate_float(&mut self, from: FloatWidth, sign: Sign, to: Width, dst: Gpr, src: Fpr) {
        match (sign, to) {
            (Sign::Signed, _) => self.asm.cvtts2si(from, to, dst, src),
            (Sign::Unsigned, Width::W32) => {
                self.asm.cvtts2si(from, Width::W64, dst, src);
                self.asm.mov(Width::W32, dst, dst);
            }
            (Sign::Unsigned, Width::W64) => {
                let done = self.new_label();
                self.truncate_or_skip_if_below_two_to_the_63(from, dst, src, done);
                self.asm.bit_test_imm(BitTest::Bts, Width::W64, dst, 63);
                self.bind(done);
            }
        }
    }

    fn truncate_float_saturating(
        &mut self,
        from: FloatWidth,
        sign: Sign,
        to: Width,
        dst: Gpr,
        src: Fpr,
    ) {
        let scratch = self.scratch_fpr(0);
        let compare = pick(from, SseUnary::Ucomiss, SseUnary::Ucomisd);
        let done = self.new_label();
        match (sign, to) {
            (Sign::Signed, _) => {
                let ordered = self.new_label();
                self.asm.cvtts2si(from, to, dst, src);
                self.check_for_least_integer(to, dst);
                self.asm.jcc_short(Cc::No, done);
                self.zero_vector(scratch);
                self.asm.sse_unary(compare, src, scratch);
                self.asm.jcc_short(Cc::Np, ordered);
                self.asm.mov_imm(dst, 0);
                self.bind(ordered);
                self.asm.jcc_short(Cc::B, done);
                self.asm.unary(Unary::Not, to.size(), dst);
            }
            (Sign::Unsigned, Width::W32) => {
                let greatest = self.scratch_gpr();
                // With a NaN the result is the second operand.
                let zero = self.float_constant(from, 0.0);
                self.sse_with_memory(pick(from, Sse::Maxss, Sse::Maxsd), scratch, src, zero);
                self.asm.cvtts2si(from, Width::W64, dst, scratch);
                self.asm.mov_imm(greatest, u32::MAX.into());
                self.asm.alu(Alu::Cmp, Size::S64, dst, greatest);
                self.asm.cmov(Cc::A, Width::W64, dst, greatest);
            }
            (Sign::Unsigned, Width::W64) => {
                self.move32(dst, 0);
                self.zero_vector(scratch);
                self.asm.sse_unary(compare, src, scratch);
                self.asm.jcc_short(Cc::Be, done);
                self.truncate_or_skip_if_below_two_to_the_63(from, dst, src, done);
                self.asm.bit_test_imm(BitTest::Bts, Width::W64, dst, 63);
                self.asm.jcc_short(Cc::Ae, done);
                self.asm.alu_imm(Alu::Or, Size::S64, dst, -1);
            }
        }
        self.bind(done);
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
            let scratch = self.scratch_gpr();
            self.asm.cvtts2si(from, Width::W64, dst, src);
            self.extend(Size::S32, sign, Width::W64, scratch, dst);
            self.asm.alu(Alu::Cmp, Size::S64, scratch, dst);
            self.asm.jcc(Cc::Ne, failure);
            if sign == Sign::Signed {
                self.asm.mov(Width::W32, dst, dst);
            }
            return;
        }
        let done = self.new_label();
        match sign {
            Sign::Signed => {
                self.asm.cvtts2si(from, to, dst, src);
                self.check_for_least_integer(to, dst);
                self.asm.jcc_short(Cc::No, done);
                let least = self.float_constant(from, i64::MIN as f64);
                self.asm
                    .sse_unary(pick(from, SseUnary::Ucomiss, SseUnary::Ucomisd), src, least);
                self.jump_on_float_flags(FloatFlags::NotEqualOrUnordered, failure);
            }
            Sign::Unsigned => {
                self.truncate_or_skip_if_below_two_to_the_63(from, dst, src, done);
                self.asm.bit_test_imm(BitTest::Bts, Width::W64, dst, 63);
                self.asm.jcc(Cc::B, failure);
            }
        }
        self.bind(done);
    }

    fn truncate_f64_to_int32_modular(&mut self, dst: Gpr, src: Fpr, slow: Label) {
        self.asm.cvtts2si(FloatWidth::F64, Width::W64, dst, src);
        self.check_for_least_integer(Width::W64, dst);
        self.asm.jcc(Cc::O, slow);
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
        let back = self.scratch_fpr(0);
        self.asm.cvtts2si(FloatWidth::F64, width, dst, src);
        self.convert_signed(width, FloatWidth::F64, back, dst);
        self.branch_f64(FloatCond::NeOrUnordered, back, src, failure);
        if zero == NegativeZero::Reject {
            let (signs, done) = (self.scratch_gpr(), self.new_label());
            self.asm.test(width.size(), dst, dst);
            self.asm.jcc_short(Cc::Ne, done);
            self.asm.move_mask(MoveMask::Movmskpd, signs, src);
            self.branch_test32(TestCond::NonZero, signs, 1, failure);
            self.bind(done);
        }
    }

    fn branch_float(
        &mut self,
        width: FloatWidth,
        cond: FloatCond,
        lhs: Fpr,
        rhs: Fpr,
        target: Label,
    ) {
        let flags = self.set_float_flags(width, cond, lhs, rhs);
        self.jump_on_float_flags(flags, target);
    }

    fn branch_float_with_zero(
        &mut self,
        width: FloatWidth,
        cond: FloatCond,
        lhs: Fpr,
        target: Label,
    ) {
        let zero = self.scratch_fpr(0);
        self.zero_vector(zero);
        self.branch_float(width, cond, lhs, zero, target);
    }

    fn compare_float(&mut self, width: FloatWidth, cond: FloatCond, dst: Gpr, lhs: Fpr, rhs: Fpr) {
        let predicate = match FloatFlags::for_condition(cond, lhs == rhs).0 {
            FloatFlags::EqualAndOrdered => FloatPredicate::Eq,
            FloatFlags::NotEqualOrUnordered => FloatPredicate::NeOrUnordered,
            FloatFlags::One(cc) => {
                return self.set_boolean(dst, false, |masm| {
                    masm.set_float_flags(width, cond, lhs, rhs);
                    cc
                });
            }
        };
        let mask = self.scratch_fpr(0);
        let lhs = self.first_source(mask, lhs);
        self.asm.sse_imm(
            pick(width, SseImm::Cmpss, SseImm::Cmpsd),
            mask,
            lhs,
            rhs,
            predicate as u8,
        );
        self.move_f32_to_bits(dst, mask);
        self.asm.alu_imm(Alu::And, Size::S32, dst, 1);
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
        let flags = self.set_float_flags(width, cond, lhs, rhs);
        self.select_on_float_flags(flags, dst, then, or);
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
        let flags = self.set_float_flags(width, cond, lhs, rhs);
        self.select_vector_on_flags(flags, dst, then, or);
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
        self.select_vector_test(width, cond, dst, value, mask, then, or);
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
        let cc = self.set_flags_for_test(width, cond, value.into(), mask.into());
        self.select_vector_on_flags(FloatFlags::One(cc), dst, then, or);
    }
}
