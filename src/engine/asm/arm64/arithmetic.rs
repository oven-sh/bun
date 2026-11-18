//! Instructions on general registers.

use super::assembler::{Assembler, gpr, gpr_or_sp, sf};
use super::immediate::{ArithmeticImm, BitmaskImm};
use super::opcode::{
    AddSub, Bitfield, Cc, ConditionalCompare, Extend, Logical, MoveWide, MultiplyAdd,
    MultiplyAddLong, Nzcv, Select, ShiftOp, Unary, WithCarry,
};
use super::registers::ZR;
use crate::operand::{Sign, Width};
use crate::register::Gpr;

#[inline(always)]
fn three(dst: Gpr, lhs: Gpr, rhs: Gpr) -> u32 {
    gpr(rhs) << 16 | gpr(lhs) << 5 | gpr(dst)
}

/// The forms that can write `sp` write the zero register instead when they set the flags.
#[inline(always)]
fn destination(sets_flags: bool, dst: Gpr) -> u32 {
    if sets_flags { gpr(dst) } else { gpr_or_sp(dst) }
}

#[inline(always)]
fn bit_number(width: Width, number: u8) -> u32 {
    assert!(number < width.bits());
    number.into()
}

#[inline(always)]
fn shifted(width: Width, shift: ShiftOp, amount: u8) -> u32 {
    (shift as u32) << 22 | bit_number(width, amount) << 10
}

/// The bits that select 64 bits in the forms that say so twice.
#[inline(always)]
fn sf_and_n(width: Width) -> u32 {
    sf(width) | (width as u32) << 22
}

/// Without the destination.
#[inline(always)]
pub(super) fn move_wide_word(op: MoveWide, width: Width, imm: u16, shift: u8) -> u32 {
    assert!(shift.is_multiple_of(16));
    0x1280_0000 | sf(width) | op as u32 | bit_number(width, shift) >> 4 << 21 | u32::from(imm) << 5
}

/// Without the destination.
#[inline(always)]
pub(super) fn logical_imm_word(op: Logical, lhs: Gpr, rhs: BitmaskImm) -> u32 {
    debug_assert!(op.has_immediate_form());
    0x1200_0000 | op as u32 | rhs.0 | gpr(lhs) << 5
}

impl Assembler {
    /// `lhs` may be `sp`, and so may `dst` unless the flags are set.
    #[inline]
    pub fn add_sub_imm(
        &mut self,
        op: AddSub,
        width: Width,
        dst: Gpr,
        lhs: Gpr,
        rhs: ArithmeticImm,
    ) {
        self.emit(
            0x1100_0000
                | sf(width)
                | op as u32
                | rhs.0
                | gpr_or_sp(lhs) << 5
                | destination(op.sets_flags(), dst),
        );
    }

    #[inline]
    pub fn add_sub(&mut self, op: AddSub, width: Width, dst: Gpr, lhs: Gpr, rhs: Gpr) {
        self.add_sub_shifted(op, width, dst, lhs, rhs, ShiftOp::Lsl, 0);
    }

    /// Not for rotations.
    #[inline]
    pub fn add_sub_shifted(
        &mut self,
        op: AddSub,
        width: Width,
        dst: Gpr,
        lhs: Gpr,
        rhs: Gpr,
        shift: ShiftOp,
        amount: u8,
    ) {
        assert!(shift != ShiftOp::Ror);
        self.emit(
            0x0b00_0000
                | sf(width)
                | op as u32
                | shifted(width, shift, amount)
                | three(dst, lhs, rhs),
        );
    }

    /// Extends `rhs` and shifts it left by up to 4. `lhs` may be `sp`, and so may `dst` unless the flags are set.
    #[inline]
    pub fn add_sub_extended(
        &mut self,
        op: AddSub,
        width: Width,
        dst: Gpr,
        lhs: Gpr,
        rhs: Gpr,
        extend: Extend,
        amount: u8,
    ) {
        assert!(amount <= 4);
        self.emit(
            0x0b20_0000
                | sf(width)
                | op as u32
                | gpr(rhs) << 16
                | (extend as u32) << 13
                | u32::from(amount) << 10
                | gpr_or_sp(lhs) << 5
                | destination(op.sets_flags(), dst),
        );
    }

    #[inline]
    pub fn with_carry(&mut self, op: WithCarry, width: Width, dst: Gpr, lhs: Gpr, rhs: Gpr) {
        self.emit(0x1a00_0000 | sf(width) | op as u32 | three(dst, lhs, rhs));
    }

    /// The width is that of `rhs`. `dst` may be `sp` unless the flags are set.
    #[inline]
    pub fn logical_imm(&mut self, op: Logical, dst: Gpr, lhs: Gpr, rhs: BitmaskImm) {
        self.emit(logical_imm_word(op, lhs, rhs) | destination(op == Logical::Ands, dst));
    }

    #[inline]
    pub fn logical(&mut self, op: Logical, width: Width, dst: Gpr, lhs: Gpr, rhs: Gpr) {
        self.logical_shifted(op, width, dst, lhs, rhs, ShiftOp::Lsl, 0);
    }

    #[inline]
    pub fn logical_shifted(
        &mut self,
        op: Logical,
        width: Width,
        dst: Gpr,
        lhs: Gpr,
        rhs: Gpr,
        shift: ShiftOp,
        amount: u8,
    ) {
        self.emit(
            0x0a00_0000
                | sf(width)
                | op as u32
                | shifted(width, shift, amount)
                | three(dst, lhs, rhs),
        );
    }

    /// `shift` is a multiple of 16.
    #[inline]
    pub fn move_wide(&mut self, op: MoveWide, width: Width, dst: Gpr, imm: u16, shift: u8) {
        self.emit(move_wide_word(op, width, imm, shift) | gpr(dst));
    }

    #[inline]
    pub fn bitfield(&mut self, op: Bitfield, width: Width, dst: Gpr, src: Gpr, immr: u8, imms: u8) {
        self.emit(
            0x1300_0000
                | sf_and_n(width)
                | op as u32
                | bit_number(width, immr) << 16
                | bit_number(width, imms) << 10
                | gpr(src) << 5
                | gpr(dst),
        );
    }

    /// `sbfx`, `bfxil` or `ubfx`: from bit `first` of `src` to bit 0 of `dst`.
    #[inline]
    pub fn bitfield_extract(
        &mut self,
        op: Bitfield,
        width: Width,
        dst: Gpr,
        src: Gpr,
        first: u8,
        count: u8,
    ) {
        assert!(count != 0 && first < width.bits() && count <= width.bits() - first);
        self.bitfield(op, width, dst, src, first, first + count - 1);
    }

    /// `sbfiz`, `bfi` or `ubfiz`: from bit 0 of `src` to bit `first` of `dst`.
    #[inline]
    pub fn bitfield_insert(
        &mut self,
        op: Bitfield,
        width: Width,
        dst: Gpr,
        src: Gpr,
        first: u8,
        count: u8,
    ) {
        assert!(count != 0 && first < width.bits() && count <= width.bits() - first);
        let rotation = first.wrapping_neg() % width.bits();
        self.bitfield(op, width, dst, src, rotation, count - 1);
    }

    /// The bits of `high:low` from bit `first` up.
    #[inline]
    pub fn extr(&mut self, width: Width, dst: Gpr, high: Gpr, low: Gpr, first: u8) {
        self.emit(
            0x1380_0000 | sf_and_n(width) | bit_number(width, first) << 10 | three(dst, high, low),
        );
    }

    #[inline]
    pub fn shift_imm(&mut self, op: ShiftOp, width: Width, dst: Gpr, src: Gpr, amount: u8) {
        assert!(amount < width.bits());
        let kept = width.bits() - amount;
        match op {
            ShiftOp::Lsl => self.bitfield_insert(Bitfield::Ubfm, width, dst, src, amount, kept),
            ShiftOp::Lsr => self.bitfield_extract(Bitfield::Ubfm, width, dst, src, amount, kept),
            ShiftOp::Asr => self.bitfield_extract(Bitfield::Sbfm, width, dst, src, amount, kept),
            ShiftOp::Ror => self.extr(width, dst, src, src, amount),
        }
    }

    /// `amount` is taken modulo the width.
    #[inline]
    pub fn shift(&mut self, op: ShiftOp, width: Width, dst: Gpr, src: Gpr, amount: Gpr) {
        self.emit(0x1ac0_2000 | sf(width) | (op as u32) << 10 | three(dst, src, amount));
    }

    /// Division by zero gives zero, and the quotient that does not fit wraps around.
    #[inline]
    pub fn div(&mut self, sign: Sign, width: Width, dst: Gpr, lhs: Gpr, rhs: Gpr) {
        let signed = u32::from(sign == Sign::Signed);
        self.emit(0x1ac0_0800 | sf(width) | signed << 10 | three(dst, lhs, rhs));
    }

    #[inline]
    pub fn unary(&mut self, op: Unary, width: Width, dst: Gpr, src: Gpr) {
        debug_assert!(op != Unary::Rev32 || width == Width::W64);
        let op = if op == Unary::Rev && width == Width::W32 {
            Unary::Rev32
        } else {
            op
        };
        self.emit(0x5ac0_0000 | sf(width) | (op as u32) << 10 | gpr(src) << 5 | gpr(dst));
    }

    #[inline]
    pub fn multiply_add(
        &mut self,
        op: MultiplyAdd,
        width: Width,
        dst: Gpr,
        lhs: Gpr,
        rhs: Gpr,
        addend: Gpr,
    ) {
        self.emit(0x1b00_0000 | sf(width) | op as u32 | gpr(addend) << 10 | three(dst, lhs, rhs));
    }

    #[inline]
    pub fn multiply_add_long(
        &mut self,
        op: MultiplyAddLong,
        dst: Gpr,
        lhs: Gpr,
        rhs: Gpr,
        addend: Gpr,
    ) {
        self.emit(0x9b00_0000 | op as u32 | gpr(addend) << 10 | three(dst, lhs, rhs));
    }

    /// `smulh` or `umulh`.
    #[inline]
    pub fn multiply_high(&mut self, sign: Sign, dst: Gpr, lhs: Gpr, rhs: Gpr) {
        let unsigned = u32::from(sign == Sign::Unsigned);
        self.emit(0x9b40_7c00 | unsigned << 23 | three(dst, lhs, rhs));
    }

    #[inline]
    pub fn select(&mut self, op: Select, width: Width, dst: Gpr, then: Gpr, or: Gpr, cc: Cc) {
        self.emit(0x1a80_0000 | sf(width) | op as u32 | (cc as u32) << 12 | three(dst, then, or));
    }

    /// Compares if `cc` holds, and otherwise sets the flags to `or`.
    #[inline]
    pub fn compare_if(
        &mut self,
        op: ConditionalCompare,
        width: Width,
        lhs: Gpr,
        rhs: Gpr,
        or: Nzcv,
        cc: Cc,
    ) {
        self.emit(
            0x3a40_0000
                | sf(width)
                | op as u32
                | gpr(rhs) << 16
                | (cc as u32) << 12
                | gpr(lhs) << 5
                | u32::from(or.bits()),
        );
    }

    /// `rhs` is less than 32.
    #[inline]
    pub fn compare_imm_if(
        &mut self,
        op: ConditionalCompare,
        width: Width,
        lhs: Gpr,
        rhs: u8,
        or: Nzcv,
        cc: Cc,
    ) {
        assert!(rhs < 32);
        self.emit(
            0x3a40_0800
                | sf(width)
                | op as u32
                | u32::from(rhs) << 16
                | (cc as u32) << 12
                | gpr(lhs) << 5
                | u32::from(or.bits()),
        );
    }

    // Aliases

    #[inline]
    pub fn mov(&mut self, width: Width, dst: Gpr, src: Gpr) {
        self.logical(Logical::Orr, width, dst, ZR, src);
    }

    /// To or from `sp`.
    #[inline]
    pub fn mov_sp(&mut self, dst: Gpr, src: Gpr) {
        self.add_sub_imm(AddSub::Add, Width::W64, dst, src, ArithmeticImm::ZERO);
    }

    #[inline]
    pub fn mvn(&mut self, width: Width, dst: Gpr, src: Gpr) {
        self.logical(Logical::Orn, width, dst, ZR, src);
    }

    #[inline]
    pub fn neg(&mut self, width: Width, dst: Gpr, src: Gpr) {
        self.add_sub(AddSub::Sub, width, dst, ZR, src);
    }

    #[inline]
    pub fn mul(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: Gpr) {
        self.multiply_add(MultiplyAdd::Madd, width, dst, lhs, rhs, ZR);
    }

    #[inline]
    pub fn cmp(&mut self, width: Width, lhs: Gpr, rhs: Gpr) {
        self.add_sub(AddSub::Subs, width, ZR, lhs, rhs);
    }

    #[inline]
    pub fn cmp_imm(&mut self, width: Width, lhs: Gpr, rhs: ArithmeticImm) {
        self.add_sub_imm(AddSub::Subs, width, ZR, lhs, rhs);
    }

    #[inline]
    pub fn cmn_imm(&mut self, width: Width, lhs: Gpr, rhs: ArithmeticImm) {
        self.add_sub_imm(AddSub::Adds, width, ZR, lhs, rhs);
    }

    #[inline]
    pub fn tst(&mut self, width: Width, lhs: Gpr, rhs: Gpr) {
        self.logical(Logical::Ands, width, ZR, lhs, rhs);
    }

    #[inline]
    pub fn tst_imm(&mut self, lhs: Gpr, rhs: BitmaskImm) {
        self.logical_imm(Logical::Ands, ZR, lhs, rhs);
    }

    /// `dst` becomes 1 if `cc` holds and otherwise 0.
    #[inline]
    pub fn cset(&mut self, dst: Gpr, cc: Cc) {
        self.select(Select::Csinc, Width::W32, dst, ZR, ZR, cc.inverted());
    }

    /// `dst` becomes −1 if `cc` holds and otherwise 0.
    #[inline]
    pub fn csetm(&mut self, width: Width, dst: Gpr, cc: Cc) {
        self.select(Select::Csinv, width, dst, ZR, ZR, cc.inverted());
    }
}
