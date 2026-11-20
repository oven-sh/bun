use crate::{Writer, vector::to_array};
use bun_simd_trusted::from_array;
use core::simd::prelude::{Simd, SimdUint};

static IN_BYTE: [[u8; 8]; 256] = core::array::from_fn(const |mut bits| {
    let (mut indices, mut i) = ([0; 8], 0);
    while bits != 0 {
        indices[i] = bits.trailing_zeros() as u8;
        bits &= bits - 1;
        i += 1;
    }
    indices
});

/// The result of `isa::bit_indices`.
#[derive(Clone, Copy)]
pub struct BitIndices {
    pub(crate) bits: u64,
    /// All of them, then unspecified bytes, if the target has an instruction for that.
    pub(crate) compressed: Option<[u8; 64]>,
}

impl BitIndices {
    /// Pushes `base + i` for each bit `i` that is set. Panics unless there is room for 64.
    #[inline(always)]
    pub fn push_to(self, out: &mut Writer<'_, u32>, base: u32) {
        assert!(out.remaining() >= 64);
        let (mut bits, mut count) = (self.bits, self.bits.count_ones() as usize);
        if let Some(indices) = self.compressed {
            for &quarter in indices.as_chunks::<16>().0 {
                let quarter = from_array(quarter).cast() + Simd::splat(base);
                out.push_first(to_array(quarter), count);
                if count <= 16 {
                    break;
                }
                count -= 16;
            }
        } else if count <= 4 {
            let mut indices = [0; 4];
            for index in &mut indices {
                *index = base.wrapping_add(bits.trailing_zeros());
                bits &= bits.wrapping_sub(1);
            }
            out.push_first(indices, count);
        } else {
            out.append(
                #[inline(always)]
                |window| {
                    let mut window = window.take(64).into_writer();
                    for (i, byte) in bits.to_le_bytes().into_iter().enumerate() {
                        let indices = from_array(IN_BYTE[usize::from(byte)]).cast();
                        let indices = indices + (Simd::splat(base) + Simd::splat(8 * i as u32));
                        window.push_first(to_array(indices), byte.count_ones() as usize);
                    }
                    window.finish()
                },
            );
        }
    }
}
