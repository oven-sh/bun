//! Instructions on one float. Those that write a vector register clear what is above the result.

use super::assembler::{Assembler, fpr, gpr, sf};
use super::immediate::FloatImm;
use super::opcode::{Cc, FloatBinary, FloatFormat, FloatMultiplyAdd, FloatUnary, Nzcv};
use crate::features::Arm64Features;
use crate::operand::{FloatWidth, Rounding, Sign, Width};
use crate::register::{Fpr, Gpr};

#[inline(always)]
fn ftype(width: FloatWidth) -> u32 {
    (width as u32) << 22
}

#[inline(always)]
fn three(dst: Fpr, lhs: Fpr, rhs: Fpr) -> u32 {
    fpr(rhs) << 16 | fpr(lhs) << 5 | fpr(dst)
}

#[inline(always)]
fn unsigned(sign: Sign) -> u32 {
    u32::from(sign == Sign::Unsigned) << 16
}

impl Assembler {
    #[inline]
    pub fn float_unary(&mut self, op: FloatUnary, width: FloatWidth, dst: Fpr, src: Fpr) {
        debug_assert!(
            !matches!(op, FloatUnary::Frint32z | FloatUnary::Frint64z)
                || self.has(Arm64Features::FRINTTS)
        );
        self.emit(0x1e20_4000 | ftype(width) | (op as u32) << 15 | fpr(src) << 5 | fpr(dst));
    }

    #[inline]
    pub fn float_binary(
        &mut self,
        op: FloatBinary,
        width: FloatWidth,
        dst: Fpr,
        lhs: Fpr,
        rhs: Fpr,
    ) {
        self.emit(0x1e20_0800 | ftype(width) | (op as u32) << 12 | three(dst, lhs, rhs));
    }

    #[inline]
    pub fn float_multiply_add(
        &mut self,
        op: FloatMultiplyAdd,
        width: FloatWidth,
        dst: Fpr,
        lhs: Fpr,
        rhs: Fpr,
        addend: Fpr,
    ) {
        self.emit(
            0x1f00_0000 | ftype(width) | op as u32 | fpr(addend) << 10 | three(dst, lhs, rhs),
        );
    }

    /// The width is that of `imm`.
    #[inline]
    pub fn fmov_imm(&mut self, dst: Fpr, imm: FloatImm) {
        self.emit(0x1e20_1000 | imm.0 | fpr(dst));
    }

    #[inline]
    pub fn fmov_to_fpr(&mut self, width: FloatWidth, dst: Fpr, src: Gpr) {
        self.emit(0x1e27_0000 | sf(width.width()) | ftype(width) | gpr(src) << 5 | fpr(dst));
    }

    #[inline]
    pub fn fmov_from_fpr(&mut self, width: FloatWidth, dst: Gpr, src: Fpr) {
        self.emit(0x1e26_0000 | sf(width.width()) | ftype(width) | fpr(src) << 5 | gpr(dst));
    }

    #[inline]
    pub fn fcmp(&mut self, width: FloatWidth, lhs: Fpr, rhs: Fpr) {
        self.emit(0x1e20_2000 | ftype(width) | fpr(rhs) << 16 | fpr(lhs) << 5);
    }

    #[inline]
    pub fn fcmp_zero(&mut self, width: FloatWidth, lhs: Fpr) {
        self.emit(0x1e20_2008 | ftype(width) | fpr(lhs) << 5);
    }

    /// Compares if `cc` holds, and otherwise sets the flags to `or`.
    #[inline]
    pub fn fccmp(&mut self, width: FloatWidth, lhs: Fpr, rhs: Fpr, or: Nzcv, cc: Cc) {
        self.emit(
            0x1e20_0400
                | ftype(width)
                | fpr(rhs) << 16
                | (cc as u32) << 12
                | fpr(lhs) << 5
                | u32::from(or.bits()),
        );
    }

    #[inline]
    pub fn fcsel(&mut self, width: FloatWidth, dst: Fpr, then: Fpr, or: Fpr, cc: Cc) {
        self.emit(0x1e20_0c00 | ftype(width) | (cc as u32) << 12 | three(dst, then, or));
    }

    #[inline]
    pub fn fcvt(&mut self, from: FloatFormat, to: FloatFormat, dst: Fpr, src: Fpr) {
        debug_assert!(from != to);
        self.emit(0x1e22_4000 | (from as u32) << 22 | (to as u32) << 15 | fpr(src) << 5 | fpr(dst));
    }

    /// `fcvtzs` or `fcvtzu`.
    #[inline]
    pub fn fcvtz(&mut self, from: FloatWidth, sign: Sign, to: Width, dst: Gpr, src: Fpr) {
        self.fcvt_to_gpr(Rounding::TowardZero, from, sign, to, dst, src);
    }

    /// What does not fit gives the nearest integer that does, and NaN gives 0.
    #[inline]
    pub fn fcvt_to_gpr(
        &mut self,
        rounding: Rounding,
        from: FloatWidth,
        sign: Sign,
        to: Width,
        dst: Gpr,
        src: Fpr,
    ) {
        let mode = match rounding {
            Rounding::Nearest => 0,
            Rounding::Up => 1,
            Rounding::Down => 2,
            Rounding::TowardZero => 3,
        };
        self.emit(
            0x1e20_0000
                | sf(to)
                | ftype(from)
                | mode << 19
                | unsigned(sign)
                | fpr(src) << 5
                | gpr(dst),
        );
    }

    /// `scvtf` or `ucvtf`.
    #[inline]
    pub fn cvtf(&mut self, sign: Sign, from: Width, to: FloatWidth, dst: Fpr, src: Gpr) {
        self.emit(0x1e22_0000 | sf(from) | ftype(to) | unsigned(sign) | gpr(src) << 5 | fpr(dst));
    }

    /// ToInt32. Sets the zero flag if `src` is exactly the result, which −0 is not.
    #[inline]
    pub fn fjcvtzs(&mut self, dst: Gpr, src: Fpr) {
        debug_assert!(self.has(Arm64Features::JSCVT));
        self.emit(0x1e7e_0000 | fpr(src) << 5 | gpr(dst));
    }
}
