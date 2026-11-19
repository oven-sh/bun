//! One pass over a source file, for the lexers.
use crate::{ByteSet, count_char};
use bun_simd::{Out, blocks};

pub use simd::{odd_blocks, scanner_run_stops};

/// From a bit, and the rows and columns that have it.
const fn set_of(mut classes: &[(u32, u32, u32)]) -> ByteSet {
    let (mut rows, mut columns) = ([0; 16], [0; 16]);
    while let [(bit, in_rows, in_columns), rest @ ..] = classes {
        let mut i = 0;
        while i < 16 {
            rows[i] |= ((*in_rows >> i & 1) << *bit) as u8;
            columns[i] |= ((*in_columns >> i & 1) << *bit) as u8;
            i += 1;
        }
        classes = rest;
    }
    ByteSet { rows, columns }
}

/// The first two bits are for tab and space, the others for `$`, digits, letters and `_`.
const NAME_OR_BLANK: ByteSet = set_of(&[
    (0, 1 << 0, 1 << 9),
    (1, 1 << 2, 1 << 0),
    (2, 1 << 2, 1 << 4),
    (3, 1 << 3, 0x03FF),
    (4, (1 << 4) | (1 << 6), 0xFFFE),
    (5, (1 << 5) | (1 << 7), 0x07FF),
    (6, 1 << 5, 1 << 15),
]);
const STRING_STOP: ByteSet = ByteSet::new(&[
    0..=0x1F,
    b'"'..=b'"',
    b'$'..=b'$',
    b'\''..=b'\'',
    b'\\'..=b'\\',
    b'`'..=b'`',
    0x80..=0xFF,
]);

pub fn line_starts(text: &[u8]) -> Vec<u32> {
    assert!(u32::try_from(text.len()).is_ok());
    let room = count_char(text, b'\n') + 64;
    let mut starts = Vec::with_capacity(1 + room);
    starts.push(0);
    bun_simd::extend_vec(&mut starts, room, |out| simd::line_starts(text, out));
    starts
}

/// A bit for each byte of `text`, lowest first: whether it is `byte`. Those past the end are clear.
pub fn byte_bits(text: &[u8], byte: u8, out: &mut Vec<u64>) {
    out.clear();
    let words = text.len().div_ceil(64);
    bun_simd::extend_vec(out, words, |out| simd::byte_bits(text, byte, out));
}

#[bun_simd::foreach_target]
mod simd {
    use crate::byte_set::simd::this_target::class;
    use isa::{I8, U8};

    /// The offset after each newline. Panics unless there is room for 64 more than there are.
    #[export(up_to = neon)]
    pub fn line_starts<'a>(text: &[u8], out: Out<'a, u32>) -> &'a mut [u32] {
        let (mut out, mut had_newlines) = (out.into_writer(), 0u8);
        for (i, block) in blocks(text, &mut [0; 64]).enumerate() {
            let [newlines] = U8::bitmasks(block, |v| [v.simd_eq(b'\n')]);
            // A branch on this block alone is hard to predict.
            had_newlines = had_newlines << 2 | u8::from(newlines != 0);
            if had_newlines != 0 {
                isa::bit_indices(newlines).push_to(&mut out, 64 * i as u32 + 1);
            }
        }
        out.finish()
    }

    #[export(up_to = neon)]
    pub fn byte_bits<'a>(text: &[u8], byte: u8, out: Out<'a, u64>) -> &'a mut [u64] {
        let (mut out, (whole, rest)) = (out.into_writer(), text.as_chunks());
        let bits = |block: &[u8; 64]| Some(U8::bitmasks(block, |v| [v.simd_eq(byte)]));
        out.extend_with(whole, bits);
        out.extend_with(blocks(rest, &mut [!byte; 64]).next(), bits);
        out.finish()
    }

    #[inline(always)]
    fn stops_of_block(block: &[u8; 64]) -> [[u8; 8]; 3] {
        let [name, neither, plain] = U8::bitmasks(block, |v| {
            let name_or_blank = class(v, &NAME_OR_BLANK);
            [
                name_or_blank.bitcast::<I8>().simd_gt(3).cast(),
                name_or_blank.simd_eq(0),
                class(v, &STRING_STOP).simd_eq(0),
            ]
        });
        [!name, name | neither, !plain].map(u64::to_le_bytes)
    }

    /// What ends a name, blanks, and plain text in a string. Panics unless each has a bit for each byte.
    #[export(up_to = neon)]
    pub fn scanner_run_stops(text: &[u8], planes: [&mut [[u8; 8]]; 3]) {
        let (whole, rest) = text.as_chunks();
        let [names, blanks, strings] =
            planes.map(|plane| plane[..text.len().div_ceil(64)].split_at_mut(whole.len()));
        let planes = names.0.iter_mut().zip(blanks.0).zip(strings.0);
        for (block, ((a, b), c)) in whole.iter().zip(planes) {
            [*a, *b, *c] = stops_of_block(block);
        }
        if let ([a], [b], [c]) = (names.1, blanks.1, strings.1)
            && let Some(block) = blocks(rest, &mut [0; 64]).next()
        {
            [*a, *b, *c] = stops_of_block(block);
        }
    }

    /// Not printable ASCII or white space, or a backslash.
    fn has_odd_byte(block: &[u8; 64]) -> bool {
        let exceptions = U8::repeat(*b"\x01\0\0\0\0\0\0\0\0\t\n\0\\\r\0\x7F");
        let mut is_odd = U8::zero();
        for chunk in block.as_chunks().0 {
            let v = U8::load(chunk);
            let is_below_space = v.bitcast::<I8>().simd_lt(0x20).cast::<u8>();
            is_odd |= (is_below_space ^ exceptions.lookup(v & 0x8F).simd_eq(v)).to_vector();
        }
        is_odd.simd_ne(0).any()
    }

    /// A bit for each block of 64 bytes.
    #[export(up_to = neon)]
    pub fn odd_blocks<'a>(text: &[u8], out: Out<'a, u64>) -> &'a mut [u64] {
        let mut out = out.into_writer();
        out.extend_with(text.chunks(64 * 64), |chunk| {
            let mut marks = 0;
            for (i, block) in blocks(chunk, &mut [b' '; 64]).enumerate() {
                marks |= u64::from(has_odd_byte(block)) << i;
            }
            Some([marks])
        });
        out.finish()
    }
}
