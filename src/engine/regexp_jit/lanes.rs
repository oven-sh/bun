//! What differs between the processors in code that looks at a vector of units.

use bun_engine_asm::prelude::*;

#[cfg(target_arch = "x86_64")]
mod host {
    use bun_engine_asm::x64::{Alu, BitCount, Cc};
    use bun_engine_asm::{VectorBinary, VectorReduce, X64Features};

    use super::*;

    pub(crate) const VECTOR_REGISTERS: [u8; 14] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    pub(crate) const LOG2_BITS_PER_BYTE: u8 = 0;
    /// A lookup reads the low four bits of an index below 128, and gives zero for the others.
    pub(crate) const LOOKUP_WRAPS: bool = true;

    /// The bytes of the vector are all ones or all zeros.
    pub(crate) fn move_mask(masm: &mut MacroAssembler, dst: Gpr, vector: Fpr) {
        masm.vector_reduce(VectorReduce::I8x16Bitmask, dst, vector);
    }

    /// Leaves a mask whose lowest set bit is the lowest that was clear.
    pub(crate) fn branch_if_any_is_clear(masm: &mut MacroAssembler, mask: Gpr, target: Label) {
        masm.branch_sub32(ResultCond::NonZero, mask, mask, 0xffff, target);
    }

    pub(crate) fn invert_and_branch_if_any_is_set(
        masm: &mut MacroAssembler,
        mask: Gpr,
        target: Label,
    ) {
        let assembler = masm.assembler();
        assembler.alu_imm(Alu::Xor, Size::S32, mask, 0xffff);
        assembler.jcc(Cc::Ne, target);
    }

    /// One is set.
    pub(crate) fn lowest_set_bit(masm: &mut MacroAssembler, mask: Gpr) {
        let op = match masm.features().contains(X64Features::BMI1) {
            true => BitCount::Tzcnt,
            false => BitCount::Bsf,
        };
        masm.assembler().bit_count(op, Width::W32, mask, mask);
    }

    /// One is set.
    pub(crate) fn highest_set_bit(masm: &mut MacroAssembler, mask: Gpr) {
        if masm.features().contains(X64Features::LZCNT) {
            masm.count_leading_zeros32(mask, mask);
            masm.xor32(mask, mask, 31);
        } else {
            (masm.assembler()).bit_count(BitCount::Bsr, Width::W32, mask, mask);
        }
    }

    pub(crate) const NARROWING_NEEDS_LIMIT: bool = true;

    /// What does not fit becomes 255, which the lanes of `limit` are. Overwrites `low` and `high`.
    pub(crate) fn narrow(masm: &mut MacroAssembler, low: Fpr, high: Fpr, limit: Fpr) {
        masm.vector_binary(VectorBinary::I16x8MinU, low, low, limit);
        masm.vector_binary(VectorBinary::I16x8MinU, high, high, limit);
        masm.vector_binary(VectorBinary::I8x16NarrowI16x8U, low, low, high);
    }
}

#[cfg(target_arch = "aarch64")]
mod host {
    use bun_engine_asm::arm64::{Arrangement, NeonNarrow, NeonShiftNarrow};

    use super::*;

    pub(crate) const VECTOR_REGISTERS: [u8; 22] = [
        0, 1, 2, 3, 4, 5, 6, 7, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
    ];
    pub(crate) const LOG2_BITS_PER_BYTE: u8 = 2;
    pub(crate) const LOOKUP_WRAPS: bool = false;

    pub(crate) fn move_mask(masm: &mut MacroAssembler, dst: Gpr, vector: Fpr) {
        let (op, shape) = (NeonShiftNarrow::Shrn, Arrangement::B8);
        masm.assembler()
            .neon_shift_narrow(op, shape, vector, vector, 4);
        masm.move_float_to_bits(FloatWidth::F64, dst, vector);
    }

    pub(crate) fn branch_if_any_is_clear(masm: &mut MacroAssembler, mask: Gpr, target: Label) {
        masm.branch_add64(ResultCond::NonZero, mask, mask, 1, target);
    }

    pub(crate) fn invert_and_branch_if_any_is_set(
        masm: &mut MacroAssembler,
        mask: Gpr,
        target: Label,
    ) {
        masm.not64(mask, mask);
        masm.branch_if_not_zero64(mask, target);
    }

    pub(crate) fn lowest_set_bit(masm: &mut MacroAssembler, mask: Gpr) {
        masm.count_trailing_zeros64(mask, mask);
    }

    pub(crate) fn highest_set_bit(masm: &mut MacroAssembler, mask: Gpr) {
        masm.count_leading_zeros64(mask, mask);
        masm.xor32(mask, mask, 63);
    }

    pub(crate) const NARROWING_NEEDS_LIMIT: bool = false;

    pub(crate) fn narrow(masm: &mut MacroAssembler, low: Fpr, high: Fpr, _: Fpr) {
        let assembler = masm.assembler();
        assembler.neon_narrow(NeonNarrow::Uqxtn, Arrangement::B8, low, low);
        assembler.neon_narrow(NeonNarrow::Uqxtn, Arrangement::B16, low, high);
    }
}

pub(crate) use host::*;
