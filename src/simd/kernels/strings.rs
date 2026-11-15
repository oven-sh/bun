//! Ports of highway_strings.cpp.
use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

#[inline(always)]
fn padded(rest: &[u8], fill: u8) -> [u8; 64] {
    let mut block = [fill; 64];
    block[..rest.len()].copy_from_slice(rest);
    block
}

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
    use isa::{Short, U8, U16, U32, Unit};

    #[export]
    pub fn index_of_char(text: &[u8], needle: u8) -> usize {
        isa::find_first(text, |v| v.eq(needle))
    }

    #[export]
    pub fn index_of_char_within(text: &[u8], len: usize, needle: u8) -> usize {
        isa::find_first_within(text, len, |v| v.eq(needle))
    }

    #[export]
    pub fn index_of_char_shared(text: &[AtomicU8], needle: u8) -> usize {
        isa::find_first(text, |v| v.eq(needle))
    }

    #[export]
    pub fn index_of_either(text: &[u8], chars: [u8; 2]) -> usize {
        let [a, b] = chars;
        isa::find_first(text, |v| v.eq(a) | v.eq(b))
    }

    #[export]
    pub fn string_literal(text: &[u8], quote: u8) -> usize {
        isa::find_first(text, |v| {
            v.eq(quote) | v.eq(b'\\') | !v.in_range(0x20, 0x7E)
        })
    }

    #[export]
    pub fn newline_or_non_ascii(text: &[u8]) -> usize {
        isa::find_first(text, |v| v.cast::<i8>().lt(0x20).cast())
    }

    #[export]
    pub fn last_index_of_char(text: &[u8], needle: u8) -> usize {
        isa::find_last(text, |v| v.eq(needle))
    }

    #[export]
    pub fn last_index_of_char_shared(text: &[AtomicU8], needle: u8) -> usize {
        isa::find_last(text, |v| v.eq(needle))
    }

    #[export]
    pub fn count_char(text: &[u8], needle: u8) -> usize {
        isa::count(text, |v| v.eq(needle))
    }

    #[export]
    pub fn count_char_shared(text: &[AtomicU8], needle: u8) -> usize {
        isa::count(text, |v| v.eq(needle))
    }

    /// For Latin-1 and for UTF-16.
    #[inline(always)]
    fn index_of_html_escape<T: Unit<Lane: From<u8>>>(text: &[T]) -> usize {
        isa::find_first(text, |v| {
            let is = |c: u8| v.eq(T::Lane::from(c));
            is(b'"') | is(b'&') | is(b'\'') | (is(b'<') | is(b'>'))
        })
    }

    #[export]
    pub fn index_of_html_escape_char8(text: &[u8]) -> usize {
        index_of_html_escape(text)
    }

    #[export]
    pub fn index_of_html_escape_char16(text: &[u16]) -> usize {
        index_of_html_escape(text)
    }

    #[export]
    pub fn first_non_ascii16(text: &[u16]) -> usize {
        isa::find_first(text, |v| v.gt(0x7F))
    }

    /// For any number of them.
    #[export]
    pub fn index_of_any_char(text: &[u8], chars: &[u8]) -> usize {
        // For each low half of a byte, a bit for each high half: 0 to 7, and 8 to 15.
        let mut tables = [[0u8; 16]; 2];
        for &c in chars {
            tables[usize::from(c >> 7)][usize::from(c & 15)] |= 1 << (c >> 4 & 7);
        }
        let (ascii, others) = (U8::table(&tables[0]), U8::table(&tables[1]));
        let bit = U8::table(&[1, 2, 4, 8, 16, 32, 64, 128, 1, 2, 4, 8, 16, 32, 64, 128]);
        isa::find_first(text, |v| {
            let low = v & 0x8F;
            ((ascii.lookup(low) | others.lookup(low ^ 0x80)) & bit.lookup(v >> 4)).ne(0)
        })
    }

    /// Nothing is dispatched, and it is inlined into plain code.
    #[export(baseline)]
    #[inline]
    pub fn last_index_of_slash(path: &[u8]) -> usize {
        let mut rest = path;
        while let Some((before, chunk)) = rest.split_last_chunk() {
            if let Some(lane) = U8::load(chunk).eq(b'/').last_true() {
                return before.len() + lane;
            }
            rest = before;
        }
        let found = Short::load(rest).and_then(|short| short.last(short.lanes.eq(b'/')));
        found.unwrap_or(path.len())
    }

    #[export]
    pub fn lower_ascii16(from: &[u16], to: &mut [u16]) {
        isa::map(from, to, |v| {
            v | v.in_range(b'A'.into(), b'Z'.into()).to_vec() & 0x20
        });
    }

    #[export]
    pub fn bswap32(words: &mut [[u8; 4]]) {
        let reversed = U8::table(&[3, 2, 1, 0, 7, 6, 5, 4, 11, 10, 9, 8, 15, 14, 13, 12]);
        isa::map_in_place(words.as_flattened_mut(), |v| v.lookup(reversed));
    }

    #[export]
    pub fn bswap32_shared(bytes: &[AtomicU8]) {
        let reversed = U8::table(&[3, 2, 1, 0, 7, 6, 5, 4, 11, 10, 9, 8, 15, 14, 13, 12]);
        let words = bytes.as_chunks::<4>().0.as_flattened();
        isa::map_to_shared(words, words, |v| v.lookup(reversed));
    }

    #[export]
    pub fn line_starts(text: &[u8], out: &mut Vec<u32>) {
        let mut block_at = |block: &[u8; 64], pos: usize| {
            let [mut newlines] = isa::bits_of(block, |v| [v.eq(b'\n')]);
            let after = pos as u32 + 1;
            out.extend((0..newlines.count_ones()).map(|_| {
                let at = after + newlines.trailing_zeros();
                newlines &= newlines - 1;
                at
            }));
        };
        let (blocks, rest) = text.as_chunks();
        for (i, block) in blocks.iter().enumerate() {
            block_at(block, 64 * i);
        }
        block_at(&padded(rest, 0), 64 * blocks.len());
    }

    fn class(v: U8, of: &Nibbles) -> U8 {
        U8::table(&of.upper).lookup(v >> 4) & U8::table(&of.lower).lookup(v & 0x0F)
    }

    #[inline(always)]
    fn stops_of_block(block: &[u8; 64]) -> [[u8; 8]; 3] {
        let [name, neither, plain] = isa::bits_of(block, |v| {
            let name_or_blank = class(v, &NAME_OR_BLANK);
            [
                name_or_blank.cast::<i8>().gt(3).cast(),
                name_or_blank.eq(0),
                class(v, &STRING_STOP).eq(0),
            ]
        });
        [!name, name | neither, !plain].map(u64::to_le_bytes)
    }

    #[export]
    pub fn scanner_run_stops(text: &[u8], planes: [&mut [[u8; 8]]; 3]) {
        let [names, blanks, strings] = planes;
        let (blocks, rest) = text.as_chunks();
        for (((block, a), b), c) in blocks
            .iter()
            .zip(&mut *names)
            .zip(&mut *blanks)
            .zip(&mut *strings)
        {
            [*a, *b, *c] = stops_of_block(block);
        }
        let at = blocks.len();
        if !rest.is_empty()
            && let (Some(a), Some(b), Some(c)) =
                (names.get_mut(at), blanks.get_mut(at), strings.get_mut(at))
        {
            [*a, *b, *c] = stops_of_block(&padded(rest, 0));
        }
    }

    #[export]
    pub fn copy_u16_to_u8(input: &[u16], output: &mut [u8]) {
        let len = input.len().min(output.len());
        let (input, output) = (&input[..len], &mut output[..len]);
        if !width::full::copy_u16_to_u8(input, output)
            && !width::x128::copy_u16_to_u8(input, output)
        {
            let n = U16::LANES - 1;
            for (from, to) in input.chunks(n).zip(output.chunks_mut(n)) {
                if let Some(short) = Short::load(from) {
                    Short::store(short.lanes.truncate(short.lanes), to);
                }
            }
        }
    }

    #[bun_simd::foreach_width]
    mod width {
        use isa::{U8, U16};

        /// Whether there is enough for a vector. The last one overlaps.
        pub fn copy_u16_to_u8(input: &[u16], output: &mut [u8]) -> bool {
            let narrow = |from: &[u16; U8::LANES]| {
                U16::load_from(from).truncate(U16::load_from(&from[U16::LANES..]))
            };
            let Some((_, last)) = input.split_last_chunk() else {
                return false;
            };
            for (from, to) in input[..input.len() - 1]
                .as_chunks()
                .0
                .iter()
                .zip(output.as_chunks_mut().0)
            {
                narrow(from).store(to);
            }
            output
                .split_last_chunk_mut()
                .map(|(_, to)| narrow(last).store(to))
                .is_some()
        }
    }

    #[export]
    pub fn fill_with_mask(mask: [u8; 4], output: &mut [u8], input: &[u8]) {
        let len = input.len().min(output.len());
        let m: U8 = U32::splat(u32::from_ne_bytes(mask)).cast();
        let (words, rest) = input[..len].split_at(len & !3);
        let (words_out, rest_out) = output[..len].split_at_mut(len & !3);
        isa::map(words, words_out, |v| v ^ m);
        for ((from, to), mask) in rest.iter().zip(rest_out).zip(mask) {
            *to = from ^ mask;
        }
    }

    #[export]
    pub fn fill_shared_with_mask(mask: [u8; 4], output: &[AtomicU8], input: &[u8]) {
        let len = input.len().min(output.len());
        let m: U8 = U32::splat(u32::from_ne_bytes(mask)).cast();
        let (words, rest) = input[..len].split_at(len & !3);
        let (words_out, rest_out) = output[..len].split_at(len & !3);
        isa::map_to_shared(words, words_out, |v| v ^ m);
        for ((from, to), mask) in rest.iter().zip(rest_out).zip(mask) {
            to.store(from ^ mask, Relaxed);
        }
    }
}
