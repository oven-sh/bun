//! Rotations by a count that is known at compile time, where LLVM's own choice is slow.

use crate::{Int, Isa, Simd, Width};
use core::sync::atomic::AtomicU8;

/// For lanes of 4 and of 8 bytes, the indices that rotate by each number of bytes.
///
/// LLVM makes `pshufb` of such a rotation by itself. But it moves a shuffle that it understands in front of an exclusive
/// or, which doubles their number in ChaCha and BLAKE. It doesn't look into a static that is `#[used]` and mutable.
#[repr(align(32))]
struct Hidden([[[u8; 32]; 8]; 2], AtomicU8);
#[used]
static BY_BYTES: Hidden = {
    let (mut all, mut i) = ([[[0; 32]; 8]; 2], 0);
    while i < 512 {
        let (size, by, at) = (4 << (i / 256), i / 32 % 8, i % 16);
        all[i / 256][by][i % 32] = (at - at % size + (at + by) % size) as u8;
        i += 1;
    }
    Hidden(all, AtomicU8::new(0))
};

impl<S: Isa, T: Int, W: Width> Simd<T, W, S> {
    #[op]
    pub(crate) fn rotate_right_same(self, count: u32) -> Self {
        let known = is_known!(count);
        let by = count % T::BITS;
        return_if!(
            S::GFNI && Self::AFFINE,
            self.bitcast::<u8>().galois_affine(0x0102_0408_1020_4080_u64.rotate_left(8 * by)).bitcast()
        );
        if_here!(
            (crate::X86 || S::WASM) && T::BITS == 64,
            if known && by == 32 {
                return live!((crate::X86 || S::WASM) && T::BITS == 64, self.bitcast::<u32>().swap_pairs().bitcast());
            }
        );
        if_here!(
            (S::SSSE3 || S::WASM) && !S::HAS_MASKED_MEMORY && T::BITS >= 32 && W::BYTES >= 16,
            if known && by % 8 == 0 && by != 0 {
                return live!((S::SSSE3 || S::WASM) && !S::HAS_MASKED_MEMORY && T::BITS >= 32 && W::BYTES >= 16, {
                    let indices = &BY_BYTES.0[size_of::<T>() / 8][by as usize / 8];
                    let d = self.tag().repartition::<u8>();
                    self.table_lookup_bytes(choose! { W::BYTES <= 32 => d.load(indices), _ => d.load_dup128(indices) })
                        .bitcast()
                });
            }
        );
        if_here!(
            S::NEON && !S::SVE2 && T::BITS == 32 && W::BYTES >= 16,
            if known && by % 16 != 0 {
                return self.with_bytes(self.s.rotate_right32::<W>(self.bytes(), by));
            }
        );
        if_here!(
            S::A64 && !S::SVE2 && T::BITS == 16 && W::BYTES >= 16,
            if known && by % 8 != 0 {
                return self.with_bytes(self.s.rotate_right16::<W>(self.bytes(), by));
            }
        );
        if_here!(
            S::A64 && !S::SVE2 && !S::HAS_SHA512 && !cfg!(target_feature = "sha3") && T::BITS == 64 && W::BYTES >= 16,
            if known && by % 32 != 0 && by != 63 {
                return self.with_bytes(self.s.rotate_right64::<W>(self.bytes(), by));
            }
        );
        if_here!(
            S::AVX512VL && T::BITS >= 32 || S::AVX512VBMI2 && T::BITS == 16,
            if !known {
                return live!(S::AVX512VL && T::BITS >= 32 || S::AVX512VBMI2 && T::BITS == 16, {
                    let (v, right) = (self.bytes(), self.tag().set(T::from_u64(count as u64)).bytes());
                    self.with_bytes(if const { T::BITS == 16 } {
                        self.s.rotate16::<W>(v, right)
                    } else if const { T::BITS == 32 } {
                        self.s.rotate32::<W>(v, right)
                    } else {
                        self.s.rotate64::<W>(v, right)
                    })
                });
            }
        );
        let v = self.cast_unsigned();
        (v >> count | v << count.wrapping_neg()).bitcast()
    }
}
