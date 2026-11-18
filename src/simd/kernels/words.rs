//! Words in as few bytes as they take.
use bun_simd::{Out, Writer};

pub use simd::{pack_words, unpack_words};

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
mod simd {
    use isa::{I8, I16, I32, U8, U16, U32, x128};

    const GROUPS: usize = if U8::LEN > 32 { 8 } else { 4 };

    /// Returns the control bytes. `data` needs 16 bytes for each group.
    #[inline(always)]
    fn pack(groups: &[[u32; 4]; GROUPS], data: &mut Writer<'_, u8>) -> [u8; GROUPS] {
        let (mut folded, mut controls) = ([[0; 16]; GROUPS], 0);
        let vectors = groups.as_flattened().as_chunks().0;
        for (i, pair) in vectors.as_chunks::<2>().0.iter().enumerate() {
            let mut fold = |k: usize| {
                let word = U32::load(&pair[k]);
                let bytes: U8 =
                    (word << 1 ^ (word.bitcast::<I32>() >> 31).bitcast::<U32>()).bitcast();
                bytes.copy_to_slice(&mut folded.as_flattened_mut()[(2 * i + k) * U8::LEN..]);
                bytes.simd_min(1).bitcast::<I16>()
            };
            // 0, 1, 0xFF or 0x100 for a word that takes 0, 1, 2 or 4 bytes.
            let size = U8::saturating_narrow(fold(0), fold(1))
                .bitcast::<U16>()
                .simd_min(0x100);
            let code_in_signs: I8 = (size + (size >> 8) + 0x7F7F).bitcast();
            controls |= code_in_signs.simd_lt(0).to_bitmask() << (i * U8::LEN);
        }
        let controls = *controls.to_le_bytes().first_chunk().unwrap();
        for (folded, control) in folded.iter().zip(controls.map(usize::from)) {
            let packed = x128::U8::load(folded).lookup(x128::U8::load(&PACKED.packing[control]));
            data.push_first(packed.to_array(), PACKED.sizes[control] as usize);
        }
        controls
    }

    /// `data` needs 16 bytes for each group.
    #[export(up_to = avx2, up_to = neon)]
    pub fn pack_words<'a, 'b>(
        words: &[[u32; 4]],
        controls: Out<'a, u8>,
        data: Out<'b, u8>,
    ) -> (&'a mut [u8], &'b mut [u8]) {
        let len = words.len().min(controls.len()).min(data.len() / 16);
        let (chunks, rest) = words[..len].as_chunks();
        let (mut controls, mut data) = (controls.into_writer(), data.into_writer());
        controls.extend_with(chunks, |groups| {
            assert!(data.remaining() >= 16 * GROUPS);
            let mut controls = [0; GROUPS];
            data.append(|window| {
                let mut window = window.take(16 * GROUPS).into_writer();
                controls = pack(groups, &mut window);
                window.finish()
            });
            Some(controls)
        });
        // Words that are zero take no room.
        let (mut groups, mut window) = ([[0; 4]; GROUPS], [0; 16 * GROUPS]);
        groups[..rest.len()].copy_from_slice(rest);
        let mut window = Out::from(&mut window[..]).into_writer();
        controls.extend_from_slice(&pack(&groups, &mut window)[..rest.len()]);
        data.extend_from_slice(window.finish());
        (controls.finish(), data.finish())
    }

    /// Returns the size too.
    #[inline(always)]
    fn unpack_group(control: u8, data: &[u8]) -> ([u32; 4], usize) {
        use x128::{U8, U32};
        let folded: U32 = U8::from_slice(data)
            .lookup(U8::load(&PACKED.unpacking[usize::from(control)]))
            .bitcast();
        let words = (folded >> 1) ^ (folded & 1).wrapping_neg();
        (
            words.to_array(),
            PACKED.sizes[usize::from(control)] as usize,
        )
    }

    /// Stops 16 bytes before the end of `data`, and returns how much of it was used.
    #[export(up_to = neon)]
    pub fn unpack_words<'a>(
        controls: &[u8],
        data: &[u8],
        words: Out<'a, [u32; 4]>,
    ) -> (&'a mut [[u32; 4]], usize) {
        let (mut rest, mut words) = (data, words.into_writer());
        words.extend_with(controls.as_chunks().0, |controls: &[u8; 4]| {
            let (window, mut four, mut at) = (rest.first_chunk::<64>()?, [[0; 4]; 4], 0);
            for i in 0..4 {
                let size;
                (four[i], size) = unpack_group(controls[i], &window[at..]);
                at += size;
            }
            rest = &rest[at..];
            Some(four)
        });
        words.extend_with(&controls[words.len()..], |&control| {
            let (group, size) = unpack_group(control, rest.first_chunk::<16>()?);
            rest = &rest[size..];
            Some([group])
        });
        (words.finish(), data.len() - rest.len())
    }
}
