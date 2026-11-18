//! Instructions on vectors.
//!
//! Where lanes of two sizes take part, the arrangement is that of the smaller ones. It has 8 bytes for the low half of
//! a register, and 16 for the form with a 2 in its name, which reads or writes the high half and keeps the low one.

use super::assembler::{Assembler, fpr, gpr, gpr_or_sp};
use super::immediate::FloatImm;
use super::neon_opcode::*;
use crate::features::Arm64Features;
use crate::operand::{FloatWidth, Sign, Size, Width};
use crate::register::{Fpr, Gpr};
use crate::vector::lanes::{count, splat};

const SCALAR: u32 = 1 << 28;

#[inline(always)]
fn two(dst: Fpr, src: Fpr) -> u32 {
    fpr(src) << 5 | fpr(dst)
}

#[inline(always)]
fn three(dst: Fpr, lhs: Fpr, rhs: Fpr) -> u32 {
    fpr(rhs) << 16 | two(dst, lhs)
}

#[inline(always)]
fn full(shape: Arrangement) -> u32 {
    shape as u32 & Q
}

#[inline(always)]
fn floats(shape: Arrangement) -> u32 {
    debug_assert!(shape.lanes() >= Size::S32);
    shape as u32 & (Q | 1 << 22)
}

#[inline(always)]
fn narrow(shape: Arrangement) -> u32 {
    debug_assert!(shape != Arrangement::D2);
    shape as u32
}

#[inline(always)]
fn unsigned(sign: Sign) -> u32 {
    u32::from(sign == Sign::Unsigned) << 29
}

/// The field that has both the size and the number of a lane.
#[inline(always)]
fn element(lanes: Size, lane: u8) -> u32 {
    assert!(lane < count(lanes));
    (u32::from(lane) << 1 | 1) << (16 + lanes.log2_bytes())
}

#[inline(always)]
fn right_by(shape: Arrangement, amount: u8) -> u32 {
    let bits = shape.lanes().bits();
    assert!((1..=bits).contains(&amount));
    full(shape) | u32::from(2 * bits - amount) << 16
}

#[inline(always)]
fn left_by(shape: Arrangement, amount: u8) -> u32 {
    let bits = shape.lanes().bits();
    assert!(amount < bits);
    full(shape) | u32::from(bits + amount) << 16
}

#[inline(always)]
const fn imm8(byte: u8) -> u32 {
    (byte as u32 >> 5) << 16 | (byte as u32 & 31) << 5
}

/// The fields of `ld1` and `st1` for one lane.
#[inline(always)]
fn lane_in_memory(lanes: Size, lane: u8) -> u32 {
    assert!(lane < count(lanes));
    let first_byte = u32::from(lane << lanes.log2_bytes());
    let opcode = match lanes {
        Size::S8 => 0,
        Size::S16 => 2 << 13,
        Size::S32 => 4 << 13,
        Size::S64 => 4 << 13 | 1 << 10,
    };
    opcode | first_byte >> 3 << 30 | (first_byte & 7) << 10
}

/// For `movi`, `mvni` and `fmov`: what all of a register becomes.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct VectorImm(u32);

impl VectorImm {
    const OP: u32 = 1 << 29;
    const BYTE_MASK: u32 = Self::OP | 14 << 12;

    pub const ZERO: Self = Self(Q | Self::BYTE_MASK);
    /// The top bits of the first two lanes of 32 bits.
    pub const SIGNS32: Self = Self(6 << 12 | imm8(0x80));

    pub fn new(bits: u128) -> Option<Self> {
        let (low, high) = (bits as u64, (bits >> 64) as u64);
        let q = if high == low { Q } else { 0 };
        if high != low && high != 0 {
            return None;
        }
        let fields = Self::byte_mask(low)
            .or_else(|| Self::repeated_word(low))
            .or_else(|| Self::float(FloatWidth::F64, low).filter(|_| q != 0))?;
        Some(Self(q | fields))
    }

    fn byte_mask(value: u64) -> Option<u32> {
        let low_bits = value & splat(Size::S8, 1) as u64;
        let gathered = (low_bits.wrapping_mul(0x0102_0408_1020_4080) >> 56) as u8;
        (value == low_bits * 0xff).then_some(Self::BYTE_MASK | imm8(gathered))
    }

    fn repeated_word(value: u64) -> Option<u32> {
        let word = value as u32;
        if value >> 32 != word.into() {
            return None;
        }
        if word == word.rotate_left(8) {
            return Some(14 << 12 | imm8(word as u8));
        }
        Self::shifted_byte(word)
            .or_else(|| Some(Self::OP | Self::shifted_byte(!word)?))
            .or_else(|| Self::float(FloatWidth::F32, word.into()))
    }

    fn shifted_byte(word: u32) -> Option<u32> {
        let byte = word.trailing_zeros() / 8;
        let (cmode, shift) = match word >> (8 * byte) {
            0..=0xff => (2 * byte, 8 * byte),
            _ if word == word.rotate_left(16) && word & 0xff00 == 0 => (8, 0),
            _ if word == word.rotate_left(16) && word & 0x00ff == 0 => (10, 8),
            _ if word & 0xffff_00ff == 0x00ff => (12, 8),
            _ if word & 0xff00_ffff == 0xffff => (13, 16),
            _ => return None,
        };
        Some(cmode << 12 | imm8((word >> shift) as u8))
    }

    fn float(width: FloatWidth, bits: u64) -> Option<u32> {
        let byte = (FloatImm::new(width, bits)?.0 >> 13) as u8;
        Some((width as u32) << 29 | 15 << 12 | imm8(byte))
    }
}

impl Assembler {
    #[inline]
    pub fn neon(&mut self, op: NeonBinary, shape: Arrangement, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        debug_assert!(op.takes(shape.lanes()));
        self.emit(0x0e20_0400 | op as u32 & !SIZES | shape as u32 | three(dst, lhs, rhs));
    }

    #[inline]
    pub fn neon_float(
        &mut self,
        op: NeonFloatBinary,
        shape: Arrangement,
        dst: Fpr,
        lhs: Fpr,
        rhs: Fpr,
    ) {
        self.emit(0x0e20_0400 | op as u32 | floats(shape) | three(dst, lhs, rhs));
    }

    /// On all 16 bytes.
    #[inline]
    pub fn neon_bitwise(&mut self, op: NeonBitwise, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        self.emit(0x4e20_1c00 | op as u32 | three(dst, lhs, rhs));
    }

    #[inline]
    pub fn neon_long(&mut self, op: NeonLong, shape: Arrangement, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        self.emit(0x0e20_0000 | op as u32 | narrow(shape) | three(dst, lhs, rhs));
    }

    pub fn neon_high_halves(
        &mut self,
        op: NeonHighHalves,
        shape: Arrangement,
        dst: Fpr,
        lhs: Fpr,
        rhs: Fpr,
    ) {
        self.emit(0x0e20_0000 | op as u32 | narrow(shape) | three(dst, lhs, rhs));
    }

    #[inline]
    pub fn neon_unary(&mut self, op: NeonUnary, shape: Arrangement, dst: Fpr, src: Fpr) {
        debug_assert!(op.takes(shape.lanes()));
        self.emit(0x0e20_0800 | op as u32 & !SIZES | shape as u32 | two(dst, src));
    }

    /// Reads as many bytes as the arrangement has.
    pub fn neon_add_pairs(&mut self, op: NeonAddPairs, shape: Arrangement, dst: Fpr, src: Fpr) {
        self.emit(0x0e20_0800 | op as u32 | narrow(shape) | two(dst, src));
    }

    pub fn neon_narrow(&mut self, op: NeonNarrow, shape: Arrangement, dst: Fpr, src: Fpr) {
        self.emit(0x0e20_0800 | op as u32 | narrow(shape) | two(dst, src));
    }

    #[inline]
    pub fn neon_float_unary(&mut self, op: NeonFloatUnary, shape: Arrangement, dst: Fpr, src: Fpr) {
        self.emit(0x0e20_0800 | op as u32 | floats(shape) | two(dst, src));
    }

    /// From floats of 64 bits to floats of 32.
    pub fn fcvtn(&mut self, shape: Arrangement, dst: Fpr, src: Fpr) {
        debug_assert!(shape.lanes() == Size::S32);
        self.emit(0x0e61_6800 | full(shape) | two(dst, src));
    }

    /// From floats of 32 bits to floats of 64.
    pub fn fcvtl(&mut self, shape: Arrangement, dst: Fpr, src: Fpr) {
        debug_assert!(shape.lanes() == Size::S32);
        self.emit(0x0e61_7800 | full(shape) | two(dst, src));
    }

    pub fn neon_across(&mut self, op: NeonAcross, shape: Arrangement, dst: Fpr, src: Fpr) {
        debug_assert!(shape != Arrangement::S2);
        self.emit(0x0e30_0800 | op as u32 | narrow(shape) | two(dst, src));
    }

    pub fn neon_float_across(&mut self, op: NeonFloatAcross, dst: Fpr, src: Fpr) {
        self.emit(0x6e30_0800 | op as u32 | two(dst, src));
    }

    pub fn neon_float_pair(&mut self, op: NeonFloatPair, width: FloatWidth, dst: Fpr, src: Fpr) {
        self.emit(0x7e30_0800 | op as u32 | (width as u32) << 22 | two(dst, src));
    }

    /// The sum of two lanes of 64 bits.
    pub fn addp_scalar(&mut self, dst: Fpr, src: Fpr) {
        self.emit(0x5ef1_b800 | two(dst, src));
    }

    /// By 1 up to the size of a lane.
    pub fn neon_shift_right(
        &mut self,
        op: NeonShiftRight,
        shape: Arrangement,
        dst: Fpr,
        src: Fpr,
        amount: u8,
    ) {
        self.emit(0x0f00_0400 | op as u32 | right_by(shape, amount) | two(dst, src));
    }

    /// By less than the size of a lane.
    pub fn neon_shift_left(
        &mut self,
        op: NeonShiftLeft,
        shape: Arrangement,
        dst: Fpr,
        src: Fpr,
        amount: u8,
    ) {
        self.emit(0x0f00_0400 | op as u32 | left_by(shape, amount) | two(dst, src));
    }

    /// By 1 up to the size of a lane of the result.
    pub fn neon_shift_narrow(
        &mut self,
        op: NeonShiftNarrow,
        shape: Arrangement,
        dst: Fpr,
        src: Fpr,
        amount: u8,
    ) {
        debug_assert!(shape != Arrangement::D2);
        self.emit(0x0f00_0400 | op as u32 | right_by(shape, amount) | two(dst, src));
    }

    /// `sshll` or `ushll`: extends to twice the size and shifts left by less than the size of a lane of `src`.
    pub fn neon_shift_long(
        &mut self,
        sign: Sign,
        shape: Arrangement,
        dst: Fpr,
        src: Fpr,
        amount: u8,
    ) {
        debug_assert!(shape != Arrangement::D2);
        self.emit(0x0f00_a400 | unsigned(sign) | left_by(shape, amount) | two(dst, src));
    }

    /// Puts the lanes in the upper halves of lanes of twice the size.
    pub fn shll(&mut self, shape: Arrangement, dst: Fpr, src: Fpr) {
        self.emit(0x2e21_3800 | narrow(shape) | two(dst, src));
    }

    pub fn dup_element(&mut self, shape: Arrangement, dst: Fpr, src: Fpr, lane: u8) {
        self.emit(0x0e00_0400 | full(shape) | element(shape.lanes(), lane) | two(dst, src));
    }

    /// To the first lane. Clears the rest of `dst`.
    pub fn dup_scalar(&mut self, lanes: Size, dst: Fpr, src: Fpr, lane: u8) {
        self.emit(0x0e00_0400 | Q | SCALAR | element(lanes, lane) | two(dst, src));
    }

    pub fn dup_gpr(&mut self, shape: Arrangement, dst: Fpr, src: Gpr) {
        self.emit(0x0e00_0c00 | full(shape) | element(shape.lanes(), 0) | gpr(src) << 5 | fpr(dst));
    }

    pub fn ins_element(&mut self, lanes: Size, dst: Fpr, to: u8, src: Fpr, from: u8) {
        assert!(from < count(lanes));
        let from = u32::from(from << lanes.log2_bytes()) << 11;
        self.emit(0x6e00_0400 | element(lanes, to) | from | two(dst, src));
    }

    pub fn ins_gpr(&mut self, lanes: Size, dst: Fpr, lane: u8, src: Gpr) {
        self.emit(0x4e00_1c00 | element(lanes, lane) | gpr(src) << 5 | fpr(dst));
    }

    /// Clears the rest of `dst`.
    pub fn umov(&mut self, lanes: Size, dst: Gpr, src: Fpr, lane: u8) {
        let q = (lanes.width() as u32) << 30;
        self.emit(0x0e00_3c00 | q | element(lanes, lane) | fpr(src) << 5 | gpr(dst));
    }

    /// Extends the sign of something narrower to `width`.
    pub fn smov(&mut self, lanes: Size, width: Width, dst: Gpr, src: Fpr, lane: u8) {
        debug_assert!(lanes < width.size());
        let q = (width as u32) << 30;
        self.emit(0x0e00_2c00 | q | element(lanes, lane) | fpr(src) << 5 | gpr(dst));
    }

    #[inline]
    pub fn neon_permute(
        &mut self,
        op: NeonPermute,
        shape: Arrangement,
        dst: Fpr,
        lhs: Fpr,
        rhs: Fpr,
    ) {
        self.emit(0x0e00_0800 | op as u32 | shape as u32 | three(dst, lhs, rhs));
    }

    /// The bytes of `low` from `first` on, and then those of `high`.
    pub fn ext(&mut self, dst: Fpr, low: Fpr, high: Fpr, first: u8) {
        assert!(first < 16);
        self.emit(0x6e00_0000 | u32::from(first) << 11 | three(dst, low, high));
    }

    /// The table is in 1 to 4 registers from `table` on. v0 follows v31.
    pub fn neon_lookup(
        &mut self,
        op: NeonLookup,
        shape: Arrangement,
        dst: Fpr,
        table: Fpr,
        registers: u8,
        indices: Fpr,
    ) {
        assert!((1..=4).contains(&registers));
        debug_assert!(shape.lanes() == Size::S8);
        let len = u32::from(registers - 1) << 13;
        self.emit(0x0e00_0000 | op as u32 | shape as u32 | len | three(dst, table, indices));
    }

    #[inline]
    pub fn movi(&mut self, dst: Fpr, imm: VectorImm) {
        self.emit(0x0f00_0400 | imm.0 | fpr(dst));
    }

    /// In lanes of 16 or 32 bits, with `byte` shifted left by a multiple of 8.
    pub fn neon_bitwise_imm(
        &mut self,
        op: NeonBitwiseImm,
        shape: Arrangement,
        dst: Fpr,
        byte: u8,
        shift: u8,
    ) {
        assert!(shift.is_multiple_of(8) && shift < shape.lanes().bits());
        let cmode = match shape.lanes() {
            Size::S16 => 9,
            Size::S32 => 1,
            Size::S8 | Size::S64 => unreachable!("no such form"),
        } | u32::from(shift / 4);
        self.emit(0x0f00_0400 | op as u32 | full(shape) | cmode << 12 | imm8(byte) | fpr(dst));
    }

    /// With lanes of 16 bits `rhs` is below v16.
    pub fn neon_by_element(
        &mut self,
        op: NeonByElement,
        shape: Arrangement,
        dst: Fpr,
        lhs: Fpr,
        rhs: Fpr,
        lane: u8,
    ) {
        let lanes = shape.lanes();
        debug_assert!(op.takes(lanes));
        assert!(lane < count(lanes) && (lanes != Size::S16 || rhs.0 < 16));
        let first_pair = u32::from(lane << lanes.log2_bytes()) / 2;
        let index = first_pair >> 2 << 11 | (first_pair & 3) << 20;
        self.emit(0x0f00_0000 | op as u32 & !SIZES | shape as u32 | index | three(dst, lhs, rhs));
    }

    /// `sdot` or `udot`: adds four products of bytes to each lane of 32 bits.
    pub fn dot(&mut self, sign: Sign, shape: Arrangement, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        debug_assert!(self.has(Arm64Features::DOTPROD) && shape.lanes() == Size::S32);
        self.emit(0x0e00_9400 | unsigned(sign) | shape as u32 | three(dst, lhs, rhs));
    }

    pub fn neon_bitwise_three(&mut self, op: NeonBitwiseThree, dst: Fpr, a: Fpr, b: Fpr, c: Fpr) {
        debug_assert!(self.has(Arm64Features::SHA3));
        self.emit(0xce00_0000 | op as u32 | fpr(c) << 10 | three(dst, a, b));
    }

    /// `lhs ^ rhs`, with lanes of 64 bits rotated right.
    pub fn xar(&mut self, dst: Fpr, lhs: Fpr, rhs: Fpr, amount: u8) {
        debug_assert!(self.has(Arm64Features::SHA3));
        assert!(amount < 64);
        self.emit(0xce80_0000 | u32::from(amount) << 10 | three(dst, lhs, rhs));
    }

    /// Keeps the other lanes. The base may be `sp`.
    pub fn ld1_lane(&mut self, lanes: Size, dst: Fpr, lane: u8, base: Gpr) {
        self.emit(0x0d40_0000 | lane_in_memory(lanes, lane) | gpr_or_sp(base) << 5 | fpr(dst));
    }

    /// The base may be `sp`.
    pub fn st1_lane(&mut self, lanes: Size, src: Fpr, lane: u8, base: Gpr) {
        self.emit(0x0d00_0000 | lane_in_memory(lanes, lane) | gpr_or_sp(base) << 5 | fpr(src));
    }

    /// One lane to all. The base may be `sp`.
    pub fn ld1r(&mut self, shape: Arrangement, dst: Fpr, base: Gpr) {
        let size = u32::from(shape.lanes().log2_bytes()) << 10;
        self.emit(0x0d40_c000 | full(shape) | size | gpr_or_sp(base) << 5 | fpr(dst));
    }
}
