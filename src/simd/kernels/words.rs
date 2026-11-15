//! Ports of highway_strings.cpp: words in as few bytes as they take.
use core::mem::MaybeUninit;

struct PackedWordTables {
    packing: [[u8; 16]; 256],
    unpacking: [[u8; 16]; 256],
    sizes: [bun_simd::UpTo16; 256],
}
static PACKED: PackedWordTables = {
    let mut t = PackedWordTables {
        packing: [[0x80; 16]; 256],
        unpacking: [[0x80; 16]; 256],
        sizes: [bun_simd::UpTo16::new(0); 256],
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
        t.sizes[control] = bun_simd::UpTo16::new(packed as usize);
        control += 1;
    }
    t
};

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::{U8, U32, x128};

    /// Returns the size. `data` gets 16 bytes for each group at most.
    #[inline(always)]
    fn pack_four(groups: &[[u32; 4]; 4], controls: &mut [u8; 4], data: &mut [u8; 64]) -> usize {
        let lowest = U8::table(&[
            0, 4, 8, 12, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80,
        ]);
        let (mut all_folded, mut all_codes) = ([[0; 16]; 4], [[0; 4]; 4]);
        for (i, words) in groups.as_flattened().as_chunks().0.iter().enumerate() {
            let word = U32::load(words);
            let folded = word << 1 ^ (word.cast::<i32>() >> 31).cast();
            let codes = folded.eq(0).to_vec()
                + (folded >> 8).eq(0).to_vec()
                + (folded >> 16).eq(0).to_vec()
                + 3;
            folded
                .cast::<u8>()
                .store_to(&mut all_folded.as_flattened_mut()[i * U8::LANES..]);
            codes
                .cast::<u8>()
                .lookup(lowest)
                .cast::<u32>()
                .store_to(&mut all_codes.as_flattened_mut()[i * U32::LANES..]);
        }
        let mut at = 0;
        for i in 0..4 {
            let control = (all_codes[i][0].wrapping_mul(0x0104_1040) >> 24) as u8;
            x128::U8::load(&all_folded[i])
                .lookup(x128::U8::load(&PACKED.packing[usize::from(control)]))
                .store_to(&mut data[at..]);
            controls[i] = control;
            at += PACKED.sizes[usize::from(control)].get();
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
        let folded: U32 = U8::load_from(data)
            .lookup(U8::load(&PACKED.unpacking[usize::from(control)]))
            .cast();
        ((folded >> 1) ^ (U32::zero() - (folded & 1))).write_to(out);
        PACKED.sizes[usize::from(control)].get()
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
