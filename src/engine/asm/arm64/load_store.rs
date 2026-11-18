//! Instructions that access memory, and their addresses as they are encoded.

use super::assembler::{Assembler, fpr, gpr, gpr_or_sp};
use super::opcode::{AtomicUpdate, IndexExtend};
use super::registers::ZR;
use crate::features::Arm64Features;
use crate::operand::{FloatWidth, Size, Width};
use crate::register::{Fpr, Gpr};

/// How much is moved to or from one register.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum AccessSize {
    S8,
    S16,
    S32,
    S64,
    S128,
}

impl AccessSize {
    #[inline]
    pub const fn log2_bytes(self) -> u8 {
        self as u8
    }
}

impl From<Size> for AccessSize {
    #[inline]
    fn from(size: Size) -> Self {
        match size {
            Size::S8 => Self::S8,
            Size::S16 => Self::S16,
            Size::S32 => Self::S32,
            Size::S64 => Self::S64,
        }
    }
}

impl From<Width> for AccessSize {
    #[inline]
    fn from(width: Width) -> Self {
        width.size().into()
    }
}

impl From<FloatWidth> for AccessSize {
    #[inline]
    fn from(width: FloatWidth) -> Self {
        width.width().into()
    }
}

/// `offset` in units of `size`, if it is a whole number of them.
#[inline(always)]
fn in_units(size: AccessSize, offset: i64) -> Option<i64> {
    (offset & ((1 << size.log2_bytes()) - 1) == 0).then_some(offset >> size.log2_bytes())
}

pub(super) const LOAD: u32 = 1 << 22;
pub(super) const VECTOR: u32 = 1 << 26;
const BASE_FIELD: u32 = 31 << 5;

/// The address and size of a load or store of one register. The base may be `sp`.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Mem(pub(super) u32);

impl Mem {
    const SCALED: u32 = 1 << 24;
    const INDEXED: u32 = 1 << 21 | 2 << 10;
    const UNSCALED: u32 = 0;
    const POST_INDEX: u32 = 1 << 10;
    const PRE_INDEX: u32 = 3 << 10;

    #[inline(always)]
    fn new(size: AccessSize, base: Gpr, form: u32) -> Self {
        let log2 = u32::from(size.log2_bytes());
        Self(0x3800_0000 | (log2 & 3) << 30 | log2 >> 2 << 23 | form | gpr_or_sp(base) << 5)
    }

    #[inline(always)]
    fn with_nine_bits(size: AccessSize, base: Gpr, offset: i64, form: u32) -> Option<Self> {
        Self::fits_unscaled(offset)
            .then(|| Self::new(size, base, (offset as u32 & 0x1ff) << 12 | form))
    }

    /// From 0 to 4095 times the size.
    #[inline]
    pub fn fits_scaled(size: impl Into<AccessSize>, offset: i64) -> bool {
        in_units(size.into(), offset).is_some_and(|units| (0..4096).contains(&units))
    }

    /// From −256 to 255. Also for the forms that change the base.
    #[inline]
    pub fn fits_unscaled(offset: i64) -> bool {
        (-256..256).contains(&offset)
    }

    #[inline]
    pub fn fits_offset(size: impl Into<AccessSize>, offset: i64) -> bool {
        Self::fits_scaled(size, offset) || Self::fits_unscaled(offset)
    }

    /// `[base]`.
    #[inline]
    pub fn at(size: impl Into<AccessSize>, base: Gpr) -> Self {
        Self::new(size.into(), base, Self::SCALED)
    }

    /// `[base, #offset]`, in whichever form holds the offset.
    #[inline]
    pub fn offset(size: impl Into<AccessSize>, base: Gpr, offset: i64) -> Option<Self> {
        let size = size.into();
        Self::scaled(size, base, offset).or_else(|| Self::unscaled(size, base, offset))
    }

    #[inline]
    pub fn scaled(size: impl Into<AccessSize>, base: Gpr, offset: i64) -> Option<Self> {
        let size = size.into();
        Self::fits_scaled(size, offset).then(|| {
            let units = offset as u32 >> size.log2_bytes();
            Self::new(size, base, Self::SCALED | units << 10)
        })
    }

    #[inline]
    pub fn unscaled(size: impl Into<AccessSize>, base: Gpr, offset: i64) -> Option<Self> {
        Self::with_nine_bits(size.into(), base, offset, Self::UNSCALED)
    }

    /// `[base, #offset]!`: adds to the base before the access.
    #[inline]
    pub fn pre_index(size: impl Into<AccessSize>, base: Gpr, offset: i64) -> Option<Self> {
        Self::with_nine_bits(size.into(), base, offset, Self::PRE_INDEX)
    }

    /// `[base], #offset`: adds to the base after the access.
    #[inline]
    pub fn post_index(size: impl Into<AccessSize>, base: Gpr, offset: i64) -> Option<Self> {
        Self::with_nine_bits(size.into(), base, offset, Self::POST_INDEX)
    }

    /// `[base, index]`, the index multiplied by the size if `scaled`.
    #[inline]
    pub fn indexed(
        size: impl Into<AccessSize>,
        base: Gpr,
        index: Gpr,
        extend: IndexExtend,
        scaled: bool,
    ) -> Self {
        Self::new(
            size.into(),
            base,
            Self::INDEXED | gpr(index) << 16 | (extend as u32) << 13 | u32::from(scaled) << 12,
        )
    }

    fn log2_bytes(self) -> u32 {
        self.0 >> 30 | (self.0 >> 23 & 1) << 2
    }

    fn changes_base(self) -> bool {
        self.0 & (Self::SCALED | Self::POST_INDEX) == Self::POST_INDEX
    }

    fn suits(self, reg: Gpr) -> bool {
        self.log2_bytes() <= 3 && !(self.changes_base() && is_base(self.0, reg))
    }
}

/// An instruction that changes its base register has no defined outcome if it transfers the same register.
fn is_base(word: u32, reg: Gpr) -> bool {
    reg != ZR && word & BASE_FIELD == gpr(reg) << 5
}

/// The address and size of a load or store of two registers of 4, 8 or 16 bytes each. The base may be `sp`.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct PairMem(pub(super) u32);

impl PairMem {
    const POST_INDEX: u32 = 1 << 23;
    const OFFSET: u32 = 2 << 23;
    const PRE_INDEX: u32 = 3 << 23;
    const S64: u32 = 1 << 30;
    const S128: u32 = 2 << 30;

    #[inline(always)]
    fn new(size: AccessSize, base: Gpr, offset: i64, form: u32) -> Option<Self> {
        debug_assert!(size >= AccessSize::S32);
        Self::fits(size, offset).then(|| {
            let units = (offset >> size.log2_bytes()) as u32 & 0x7f;
            let size = u32::from(size.log2_bytes() - 2) << 30;
            Self(0x2800_0000 | size | form | units << 15 | gpr_or_sp(base) << 5)
        })
    }

    /// From −64 to 63 times the size.
    #[inline]
    pub fn fits(size: impl Into<AccessSize>, offset: i64) -> bool {
        in_units(size.into(), offset).is_some_and(|units| (-64..64).contains(&units))
    }

    #[inline]
    pub fn offset(size: impl Into<AccessSize>, base: Gpr, offset: i64) -> Option<Self> {
        Self::new(size.into(), base, offset, Self::OFFSET)
    }

    #[inline]
    pub fn pre_index(size: impl Into<AccessSize>, base: Gpr, offset: i64) -> Option<Self> {
        Self::new(size.into(), base, offset, Self::PRE_INDEX)
    }

    #[inline]
    pub fn post_index(size: impl Into<AccessSize>, base: Gpr, offset: i64) -> Option<Self> {
        Self::new(size.into(), base, offset, Self::POST_INDEX)
    }

    /// General registers have another code for 8 bytes than vector registers.
    #[inline(always)]
    fn with_gprs(self, low: Gpr, high: Gpr) -> u32 {
        debug_assert!(self.0 & Self::S128 == 0);
        debug_assert!(
            self.0 & Self::POST_INDEX == 0 || !is_base(self.0, low) && !is_base(self.0, high)
        );
        (self.0 + (self.0 & Self::S64)) | gpr(high) << 10 | gpr(low)
    }
}

#[inline(always)]
fn sized(size: Size, reg: Gpr, base: Gpr) -> u32 {
    u32::from(size.log2_bytes()) << 30 | gpr_or_sp(base) << 5 | gpr(reg)
}

impl Assembler {
    /// Clears the rest of `dst`.
    #[inline]
    pub fn ldr(&mut self, dst: Gpr, src: Mem) {
        debug_assert!(src.suits(dst));
        self.emit(src.0 | LOAD | gpr(dst));
    }

    /// Extends the sign of something narrower to `width`.
    #[inline]
    pub fn ldrs(&mut self, width: Width, dst: Gpr, src: Mem) {
        debug_assert!(src.suits(dst) && src.log2_bytes() < width.size().log2_bytes().into());
        self.emit(src.0 | (3 - width as u32) << 22 | gpr(dst));
    }

    #[inline]
    pub fn str(&mut self, src: Gpr, dst: Mem) {
        debug_assert!(dst.suits(src));
        self.emit(dst.0 | gpr(src));
    }

    /// Clears the rest of `dst`.
    #[inline]
    pub fn ldr_fpr(&mut self, dst: Fpr, src: Mem) {
        self.emit(src.0 | VECTOR | LOAD | fpr(dst));
    }

    #[inline]
    pub fn str_fpr(&mut self, src: Fpr, dst: Mem) {
        self.emit(dst.0 | VECTOR | fpr(src));
    }

    /// `prfm pldl1keep`. The address is one for 8 bytes.
    pub fn prfm(&mut self, address: Mem) {
        debug_assert!(address.log2_bytes() == 3 && !address.changes_base());
        self.emit(address.0 | 2 << 22);
    }

    #[inline]
    pub fn ldp(&mut self, low: Gpr, high: Gpr, src: PairMem) {
        assert!(low != high);
        self.emit(src.with_gprs(low, high) | LOAD);
    }

    #[inline]
    pub fn stp(&mut self, low: Gpr, high: Gpr, dst: PairMem) {
        self.emit(dst.with_gprs(low, high));
    }

    #[inline]
    pub fn ldp_fpr(&mut self, low: Fpr, high: Fpr, src: PairMem) {
        assert!(low != high);
        self.emit(src.0 | VECTOR | LOAD | fpr(high) << 10 | fpr(low));
    }

    #[inline]
    pub fn stp_fpr(&mut self, low: Fpr, high: Fpr, dst: PairMem) {
        self.emit(dst.0 | VECTOR | fpr(high) << 10 | fpr(low));
    }

    pub fn ldar(&mut self, size: Size, dst: Gpr, base: Gpr) {
        self.emit(0x08df_fc00 | sized(size, dst, base));
    }

    pub fn stlr(&mut self, size: Size, src: Gpr, base: Gpr) {
        self.emit(0x089f_fc00 | sized(size, src, base));
    }

    pub fn ldaxr(&mut self, size: Size, dst: Gpr, base: Gpr) {
        self.emit(0x085f_fc00 | sized(size, dst, base));
    }

    /// `status` becomes 0 if the store took place and otherwise 1. It is neither of the other registers.
    pub fn stlxr(&mut self, size: Size, status: Gpr, src: Gpr, base: Gpr) {
        assert!(status != src && status != base);
        self.emit(0x0800_fc00 | gpr(status) << 16 | sized(size, src, base));
    }

    /// `old` gets what was in memory.
    pub fn atomic_update(
        &mut self,
        op: AtomicUpdate,
        size: Size,
        operand: Gpr,
        old: Gpr,
        base: Gpr,
    ) {
        debug_assert!(self.has(Arm64Features::LSE));
        self.emit(0x38e0_0000 | op as u32 | gpr(operand) << 16 | sized(size, old, base));
    }

    /// `expected` gets what was in memory.
    pub fn casal(&mut self, size: Size, expected: Gpr, replacement: Gpr, base: Gpr) {
        debug_assert!(self.has(Arm64Features::LSE));
        self.emit(0x08e0_fc00 | gpr(expected) << 16 | sized(size, replacement, base));
    }
}
