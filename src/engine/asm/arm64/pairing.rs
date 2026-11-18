//! Loads and stores that can be taken back, to be done along with the next.

use super::assembler::{Assembler, gpr};
use super::load_store::{AccessSize, LOAD, Mem, PairMem, VECTOR};
use super::registers::ZR;
use crate::register::{Fpr, Gpr};

/// Moves 4, 8 or 16 bytes between a register and `[base, #offset]`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct PlainAccess {
    /// The bits that say load or store and name the register.
    transfer: u32,
    pub size: AccessSize,
    pub base: Gpr,
    pub offset: i32,
}

const REGISTER: u32 = 31;
const SCALED: u32 = 1 << 24;

impl PlainAccess {
    #[inline]
    fn new(transfer: u32, size: AccessSize, base: Gpr, offset: i32) -> Self {
        debug_assert!(size >= AccessSize::S32);
        Self {
            transfer,
            size,
            base,
            offset,
        }
    }

    #[inline]
    pub fn load(size: AccessSize, dst: Gpr, base: Gpr, offset: i32) -> Self {
        Self::new(LOAD | gpr(dst), size, base, offset)
    }

    #[inline]
    pub fn store(size: AccessSize, src: Gpr, base: Gpr, offset: i32) -> Self {
        Self::new(gpr(src), size, base, offset)
    }

    #[inline]
    pub fn load_fpr(size: AccessSize, dst: Fpr, base: Gpr, offset: i32) -> Self {
        Self::new(VECTOR | LOAD | u32::from(dst.0), size, base, offset)
    }

    #[inline]
    pub fn store_fpr(size: AccessSize, src: Fpr, base: Gpr, offset: i32) -> Self {
        Self::new(VECTOR | u32::from(src.0), size, base, offset)
    }

    #[inline]
    pub fn is_load(self) -> bool {
        self.transfer & LOAD != 0
    }

    /// The register, if it is a general one.
    #[inline]
    pub fn gpr(self) -> Option<Gpr> {
        let number = (self.transfer & REGISTER) as u8;
        (self.transfer & VECTOR == 0).then_some(if number == 31 { ZR } else { Gpr(number) })
    }

    /// Whether one instruction could do `self` and then `next`, were their bytes adjacent.
    #[inline]
    pub fn goes_with(self, next: Self) -> bool {
        let overwrites_operand = self.transfer == next.transfer || self.gpr() == Some(next.base);
        (self.transfer ^ next.transfer) & !REGISTER == 0
            && self.size == next.size
            && !(self.is_load() && overwrites_operand)
    }

    fn decode(word: u32) -> Self {
        let log2 = word >> 30 | (word >> 23 & 1) << 2;
        let offset = if word & SCALED != 0 {
            ((word >> 10 & 0xfff) << log2) as i32
        } else {
            (word << 11) as i32 >> 23
        };
        let size = match log2 {
            2 => AccessSize::S32,
            3 => AccessSize::S64,
            _ => AccessSize::S128,
        };
        let base = Gpr((word >> 5 & REGISTER) as u8);
        Self::new(word & (VECTOR | LOAD | REGISTER), size, base, offset)
    }
}

impl Assembler {
    /// Returns false, and emits nothing, if the offset does not fit.
    #[inline]
    pub fn access_revocably(&mut self, access: PlainAccess) -> bool {
        let Some(mem) = Mem::offset(access.size, access.base, access.offset.into()) else {
            return false;
        };
        if self.revocable.end != self.buffer.len {
            self.revocable.start = self.buffer.len;
        }
        self.emit(mem.0 | access.transfer);
        self.revocable.end = self.buffer.len;
        true
    }

    /// The last instruction, if `revoke` can take it back.
    #[inline]
    pub fn revocable_access(&self) -> Option<PlainAccess> {
        let end = self.buffer.len;
        (self.revocable.end == end && self.revocable.start < end).then(|| {
            let word = self.buffer.bytes[..end as usize].last_chunk().unwrap();
            PlainAccess::decode(u32::from_le_bytes(*word))
        })
    }

    #[inline]
    pub fn revoke(&mut self) {
        debug_assert!(self.revocable_access().is_some());
        self.buffer.len -= 4;
        self.revocable.end -= 4;
    }

    #[inline]
    pub fn keep_what_is_there(&mut self) {
        self.revocable = 0..0;
    }

    /// `low` says what is done at `mem`, and `high` what is done after those bytes.
    #[inline]
    pub fn access_pair(&mut self, low: PlainAccess, high: PlainAccess, mem: PairMem) {
        debug_assert!(low.goes_with(PlainAccess { base: ZR, ..high }));
        let size = if low.transfer & VECTOR == 0 {
            mem.0 & 1 << 30
        } else {
            0
        };
        self.emit((mem.0 + size) | (high.transfer & REGISTER) << 10 | low.transfer);
    }
}
