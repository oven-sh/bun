//! Ports of highway_strings.cpp.
use bun_simd::{Int, Out, Partial, blocks};
use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

struct Nibbles {
    upper: [u8; 16],
    lower: [u8; 16],
}
impl Nibbles {
    const fn new(classes: &[(u32, u32, u32)]) -> Self {
        let mut n = Nibbles {
            upper: [0; 16],
            lower: [0; 16],
        };
        let mut c = 0;
        while c < classes.len() {
            let (bit, rows, columns) = classes[c];
            let mut i = 0;
            while i < 16 {
                if (rows >> i) & 1 != 0 {
                    n.upper[i] |= 1 << bit;
                }
                if (columns >> i) & 1 != 0 {
                    n.lower[i] |= 1 << bit;
                }
                i += 1;
            }
            c += 1;
        }
        n
    }
}
const NAME_OR_BLANK: Nibbles = Nibbles::new(&[
    (0, 1 << 0, 1 << 9),
    (1, 1 << 2, 1 << 0),
    (2, 1 << 2, 1 << 4),
    (3, 1 << 3, 0x03FF),
    (4, (1 << 4) | (1 << 6), 0xFFFE),
    (5, (1 << 5) | (1 << 7), 0x07FF),
    (6, 1 << 5, 1 << 15),
]);
const STRING_STOP: Nibbles = Nibbles::new(&[
    (0, 0xFF03, 0xFFFF),
    (1, 1 << 2, (1 << 2) | (1 << 4) | (1 << 7)),
    (2, 1 << 5, 1 << 12),
    (3, 1 << 6, 1 << 0),
]);

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::{I8, U8, U16, U32, Vector, x128};

    #[export]
    pub fn index_of_char(text: &[u8], needle: u8) -> Option<usize> {
        U8::position(text, |v| v.simd_eq(needle))
    }

    #[export]
    pub fn index_of_char_within(text: &[u8], len: usize, needle: u8) -> Option<usize> {
        U8::position_within(text, len, |v| v.simd_eq(needle))
    }

    #[export]
    pub fn index_of_char_shared(text: &[AtomicU8], needle: u8) -> Option<usize> {
        U8::position(text, |v| v.simd_eq(needle))
    }

    #[export]
    pub fn index_of_either(text: &[u8], chars: [u8; 2]) -> Option<usize> {
        let [a, b] = chars;
        U8::position(text, |v| v.simd_eq(a) | v.simd_eq(b))
    }

    #[export]
    pub fn index_of_interesting_character_in_string_literal(
        text: &[u8],
        quote: u8,
    ) -> Option<usize> {
        U8::position(text, |v| {
            v.simd_eq(quote) | v.simd_eq(b'\\') | !v.in_range(0x20..=0x7E)
        })
    }

    #[export]
    pub fn index_of_newline_or_non_ascii(text: &[u8]) -> Option<usize> {
        U8::position(text, |v| v.bitcast::<I8>().simd_lt(0x20).cast())
    }

    #[export]
    pub fn last_index_of_char(text: &[u8], needle: u8) -> Option<usize> {
        U8::rposition(text, |v| v.simd_eq(needle))
    }

    #[export]
    pub fn last_index_of_char_shared(text: &[AtomicU8], needle: u8) -> Option<usize> {
        U8::rposition(text, |v| v.simd_eq(needle))
    }

    #[export]
    pub fn count_char(text: &[u8], needle: u8) -> usize {
        U8::count(text, |v| v.simd_eq(needle))
    }

    #[export]
    pub fn count_char_shared(text: &[AtomicU8], needle: u8) -> usize {
        U8::count(text, |v| v.simd_eq(needle))
    }

    /// For Latin-1 and for UTF-16.
    #[inline(always)]
    fn index_of_html_escape<T: Int<N> + From<u8>, const N: usize>(text: &[T]) -> Option<usize> {
        Vector::<T, N>::position(text, |v| {
            let is = |c: u8| v.simd_eq(T::from(c));
            is(b'"') | is(b'&') | is(b'\'') | (is(b'<') | is(b'>'))
        })
    }

    #[export]
    pub fn index_of_html_escape_char8(text: &[u8]) -> Option<usize> {
        index_of_html_escape::<_, { U8::LEN }>(text)
    }

    #[export]
    pub fn index_of_html_escape_char16(text: &[u16]) -> Option<usize> {
        index_of_html_escape::<_, { U16::LEN }>(text)
    }

    #[export]
    pub fn first_non_ascii16(text: &[u16]) -> Option<usize> {
        U16::position(text, |v| v.simd_gt(0x7F))
    }

    /// For any number of them.
    #[export]
    pub fn index_of_any_char(text: &[u8], chars: &[u8]) -> Option<usize> {
        // For each low half of a byte, a bit for each high half: 0 to 7, and 8 to 15.
        let mut tables = [[0u8; 16]; 2];
        for &c in chars {
            tables[usize::from(c >> 7)][usize::from(c & 15)] |= 1 << (c >> 4 & 7);
        }
        let (ascii, others) = (U8::repeat_16(tables[0]), U8::repeat_16(tables[1]));
        let bit = U8::repeat_16([1, 2, 4, 8, 16, 32, 64, 128, 1, 2, 4, 8, 16, 32, 64, 128]);
        U8::position(text, |v| {
            let low = v & 0x8F;
            ((ascii.lookup(low) | others.lookup(low ^ 0x80)) & bit.lookup(v >> 4)).simd_ne(0)
        })
    }

    /// Nothing is dispatched, and it is inlined into plain code.
    #[export(baseline)]
    #[inline]
    pub fn last_index_of_slash(path: &[u8]) -> Option<usize> {
        let (rest, chunks) = path.as_rchunks();
        for (i, chunk) in chunks.iter().enumerate().rev() {
            if let Some(lane) = U8::load(chunk).simd_eq(b'/').last_set() {
                return Some(rest.len() + i * U8::LEN + lane);
            }
        }
        U8::load_partial(rest).and_then(|p| p.last_set(p.lanes.simd_eq(b'/')))
    }

    #[export]
    pub fn lower_ascii16<'a>(from: &[u16], to: Out<'a, u16>) -> &'a mut [u16] {
        U16::map(from, to, |v| {
            v | v.in_range(b'A'.into()..=b'Z'.into()).to_vector() & 0x20
        })
    }

    #[export]
    pub fn bswap32(words: &mut [[u8; 4]]) {
        let reversed = U8::repeat_16([3, 2, 1, 0, 7, 6, 5, 4, 11, 10, 9, 8, 15, 14, 13, 12]);
        U8::map_in_place(words.as_flattened_mut(), |v| v.lookup(reversed));
    }

    #[export]
    pub fn bswap32_shared(bytes: &[AtomicU8]) {
        let reversed = U8::repeat_16([3, 2, 1, 0, 7, 6, 5, 4, 11, 10, 9, 8, 15, 14, 13, 12]);
        let words = bytes.as_chunks::<4>().0.as_flattened();
        U8::map_to_shared(words, words, |v| v.lookup(reversed));
    }

    /// The offset after each newline. Panics unless there is room for 64 more than there are.
    #[export]
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

    fn class(v: U8, of: &Nibbles) -> U8 {
        U8::repeat_16(of.upper).lookup(v >> 4) & U8::repeat_16(of.lower).lookup(v & 0x0F)
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

    /// Panics unless each plane has a bit for each byte.
    #[export]
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

    #[export]
    pub fn copy_u16_to_u8<'a>(input: &[u16], output: Out<'a, u8>) -> &'a mut [u8] {
        let output = output.take(input.len());
        if output.len() >= U8::LEN {
            return width::full::copy_u16_to_u8(input, output);
        }
        if output.len() >= 16 {
            return width::x128::copy_u16_to_u8(input, output);
        }
        let input = &input[..output.len()];
        if let (Some(first), Some((_, last))) = (input.first_chunk(), input.split_last_chunk()) {
            let both = x128::U8::narrow(x128::U16::load(first), x128::U16::load(last)).to_array();
            let [first, last] = *both.as_chunks::<8>().0.as_array().unwrap();
            return output.fill_ends(first, last).unwrap_or_default();
        }
        match x128::U16::load_partial(input) {
            Some(Partial { lanes, .. }) => x128::U8::narrow(lanes, lanes).store_partial(output),
            None => &mut [],
        }
    }

    #[bun_simd::foreach_width]
    mod width {
        use isa::{U8, U16};

        pub fn copy_u16_to_u8<'a>(input: &[u16], output: Out<'a, u8>) -> &'a mut [u8] {
            output.fill_chunks(input, |_, from: &[u16; U8::LEN]| {
                let (low, high) = from.split_at(U16::LEN);
                Some(U8::narrow(U16::from_slice(low), U16::from_slice(high)).to_array())
            })
        }
    }

    #[export]
    pub fn fill_with_mask<'a>(mask: [u8; 4], output: Out<'a, u8>, input: &[u8]) -> &'a mut [u8] {
        let output = output.take(input.len());
        let (len, mask) = (output.len(), u32::from_le_bytes(mask));
        let mask_at =
            |at: usize| U32::splat(mask.rotate_right(8 * (at % 4) as u32)).bitcast::<U8>();
        if len >= U8::LEN {
            return output.fill_chunks(input, |at, from| {
                Some((U8::load(from) ^ mask_at(at)).to_array())
            });
        }
        match U8::load_partial(&input[..len]) {
            Some(it) => (it.lanes ^ mask_at(0).lookup(it.indices() & 3)).store_partial(output),
            None => &mut [],
        }
    }

    #[export]
    pub fn fill_shared_with_mask(mask: [u8; 4], output: &[AtomicU8], input: &[u8]) {
        let len = input.len().min(output.len());
        let m: U8 = U32::splat(u32::from_le_bytes(mask)).bitcast();
        let (words, rest) = input[..len].split_at(len & !3);
        let (words_out, rest_out) = output[..len].split_at(len & !3);
        U8::map_to_shared(words, words_out, |v| v ^ m);
        for ((from, to), mask) in rest.iter().zip(rest_out).zip(mask) {
            to.store(from ^ mask, Relaxed);
        }
    }
}
