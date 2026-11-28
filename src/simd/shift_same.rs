//! Shifts of bytes by a count that is not a constant. x86 has none, and what LLVM puts in their place comes too late to be moved out of a loop.

use crate::lane::Kind;
use crate::{Int, Isa, Simd, Width};

const IDENTITY: u64 = 0x0102_0408_1020_4080;

impl<S: Isa, T: Int, W: Width> Simd<T, W, S> {
    /// For lanes of 8 bits.
    #[op]
    pub(crate) fn shift_left_same(self, count: u32) -> Self {
        let (v, count) = (self.bitcast::<u8>(), count & 7);
        return_if!(S::GFNI && W::BYTES >= 8, v.galois_affine(IDENTITY >> (8 * count)).bitcast());
        ((v.bitcast::<u16>() << count).bitcast::<u8>() & (0xffu32 << count) as u8).bitcast()
    }
    /// The same.
    #[op]
    pub(crate) fn shift_right_same(self, count: u32) -> Self {
        let (v, count, signed) = (self.bitcast::<u8>(), count & 7, T::KIND == Kind::Signed);
        return_if!(S::GFNI && W::BYTES >= 8, {
            let sign = if signed { 0x8080_8080_8080_8080 & !(!0 << (8 * count)) } else { 0 };
            v.galois_affine(IDENTITY << (8 * count) | sign).bitcast()
        });
        let shifted = (v.bitcast::<u16>() >> count).bitcast::<u8>() & (0xffu32 >> count) as u8;
        let top = (0x80u32 >> count) as u8;
        if signed { ((shifted ^ top) - top).bitcast() } else { shifted.bitcast() }
    }
}
