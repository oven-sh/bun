//! Ports of highway_strings.cpp: words in as few bytes as they take.
use core::mem::MaybeUninit;

/// LLVM knows its range even when it comes out of a table, so bounds checks on it go away.
#[derive(Clone, Copy)]
#[repr(u8)]
#[rustfmt::skip]
enum Size { S0, S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S12, S13, S14, S15, S16 }

impl Size {
    const fn new(size: u8) -> Self {
        use Size::*;
        [
            S0, S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S12, S13, S14, S15, S16,
        ][size as usize]
    }
}

struct PackedWordTables {
    packing: [[u8; 16]; 256],
    unpacking: [[u8; 16]; 256],
    sizes: [Size; 256],
}
static PACKED: PackedWordTables = {
    let mut t = PackedWordTables {
        packing: [[0x80; 16]; 256],
        unpacking: [[0x80; 16]; 256],
        sizes: [Size::S0; 256],
    };
    let mut control = 0;
    while control < 256 {
        let mut packed = 0u8;
        let mut word = 0;
        while word < 4 {
            let size = (1usize << (control >> (2 * word) & 3)) >> 1;
            let mut byte = 0;
            while byte < size {
                let whole = 4 * word + byte;
                t.unpacking[control][whole] = packed;
                t.packing[control][packed as usize] = whole as u8;
                packed += 1;
                byte += 1;
            }
            word += 1;
        }
        t.sizes[control] = Size::new(packed);
        control += 1;
    }
    t
};

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::{I32, U8, U32, x128};

    /// Returns the size. `data` gets 16 bytes for each group at most.
    #[inline(always)]
    fn pack_four(groups: &[[u32; 4]; 4], controls: &mut [u8; 4], data: &mut [u8; 64]) -> usize {
        let lowest = U8::repeat_16([
            0, 4, 8, 12, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80,
        ]);
        let (mut all_folded, mut all_codes) = ([[0; 16]; 4], [[0; 4]; 4]);
        for (i, words) in groups.as_flattened().as_chunks().0.iter().enumerate() {
            let word = U32::load(words);
            let folded = word << 1 ^ (word.bitcast::<I32>() >> 31).bitcast::<U32>();
            let codes = folded.simd_eq(0).to_vector()
                + (folded >> 8).simd_eq(0).to_vector()
                + (folded >> 16).simd_eq(0).to_vector()
                + 3;
            folded
                .bitcast::<U8>()
                .copy_to_slice(&mut all_folded.as_flattened_mut()[i * U8::LEN..]);
            codes
                .bitcast::<U8>()
                .lookup(lowest)
                .bitcast::<U32>()
                .copy_to_slice(&mut all_codes.as_flattened_mut()[i * U32::LEN..]);
        }
        let mut at = 0;
        for i in 0..4 {
            let control = (all_codes[i][0].wrapping_mul(0x0104_1040) >> 24) as u8;
            x128::U8::load(&all_folded[i])
                .lookup(x128::U8::load(&PACKED.packing[usize::from(control)]))
                .copy_to_slice(&mut data[at..]);
            controls[i] = control;
            at += PACKED.sizes[usize::from(control)] as usize;
        }
        at
    }

    /// Stops where `data` has less than 16 bytes for each group that is left.
    #[export(up_to = avx2)]
    pub fn pack_words(words: &[[u32; 4]], controls: &mut [u8], data: &mut [u8]) -> usize {
        let (room, groups) = (data.len(), words.len().min(controls.len()));
        let ((fours, words), (four_controls, controls)) = (
            words[..groups].as_chunks(),
            controls[..groups].as_chunks_mut(),
        );
        let mut rest = data;
        for (four, controls) in fours.iter().zip(four_controls) {
            let Some(window) = rest.first_chunk_mut() else {
                return room - rest.len();
            };
            let size = pack_four(four, controls, window);
            rest = &mut rest[size..];
        }
        // Words that are zero take no room.
        let (mut four, mut four_controls, mut window) = ([[0; 4]; 4], [0; 4], [0; 64]);
        four.iter_mut()
            .zip(words)
            .for_each(|(to, from)| *to = *from);
        let size = pack_four(&four, &mut four_controls, &mut window).min(rest.len());
        controls
            .iter_mut()
            .zip(four_controls)
            .for_each(|(to, from)| *to = from);
        rest[..size].copy_from_slice(&window[..size]);
        room - rest.len() + size
    }

    /// Returns the size.
    #[inline(always)]
    fn unpack_group(control: u8, data: &[u8], out: &mut [MaybeUninit<u32>; 4]) -> usize {
        use x128::{U8, U32};
        let folded: U32 = U8::from_slice(data)
            .lookup(U8::load(&PACKED.unpacking[usize::from(control)]))
            .bitcast();
        ((folded >> 1) ^ (folded & 1).wrapping_neg()).write_to_slice(out);
        PACKED.sizes[usize::from(control)] as usize
    }

    #[export]
    pub fn unpack_words(
        controls: &[u8],
        data: &[u8],
        words: &mut [[MaybeUninit<u32>; 4]],
    ) -> (usize, usize) {
        let (mut rest, mut groups) = (data, 0);
        for (controls, four) in controls
            .as_chunks::<4>()
            .0
            .iter()
            .zip(words.as_chunks_mut::<4>().0)
        {
            let Some(window) = rest.first_chunk::<64>() else {
                break;
            };
            let mut at = 0;
            for i in 0..4 {
                at += unpack_group(controls[i], &window[at..], &mut four[i]);
            }
            rest = &rest[at..];
            groups += 4;
        }
        for (&control, out) in controls.iter().zip(words).skip(groups) {
            let Some(window) = rest.first_chunk::<16>() else {
                break;
            };
            rest = &rest[unpack_group(control, window, out)..];
            groups += 1;
        }
        (groups, data.len() - rest.len())
    }
}
