//! Ports of highway_strings.cpp: where a character is, and how many there are.
use bun_simd::{Int, SharedU8};

/// For each low half of a byte, a bit for each high half: 0 to 7, and 8 to 15.
#[inline(always)]
pub(crate) fn tables_of_set(bytes: &[u8]) -> (u128, u128) {
    let mut words = [0u64; 4];
    for &byte in bytes {
        words[usize::from(byte >> 6 & 2 | byte >> 3 & 1)] |=
            1 << (8 * (byte & 7) + (byte >> 4 & 7));
    }
    let [a, b, c, d] = words.map(u128::from);
    (a | b << 64, c | d << 64)
}

#[inline(always)]
fn starts_or_ends_escape(unit: u16) -> bool {
    matches!(unit, 0x1B | 0x90 | 0x98 | 0x9B..=0x9F)
}

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::{I8, Mask, U8, U16, Vector};

    type Test = Mask<u8, { U8::LEN }>;

    /// Below `byte`, or not ASCII.
    fn is_below(v: U8, byte: i8) -> Test {
        v.bitcast::<I8>().simd_lt(byte).cast()
    }

    #[export]
    pub fn index_of_char(text: &[u8], needle: u8) -> Option<usize> {
        U8::position(text, |v| v.simd_eq(needle))
    }

    #[export]
    pub fn index_of_char_shared(text: &[SharedU8], needle: u8) -> Option<usize> {
        U8::position(text, |v| v.simd_eq(needle))
    }

    #[export]
    pub fn index_of_char16(text: &[u16], needle: u16) -> Option<usize> {
        U16::position(text, |v| v.simd_eq(needle))
    }

    #[export]
    pub fn index_of_not_char(text: &[u8], value: u8) -> Option<usize> {
        U8::position(text, |v| v.simd_ne(value))
    }

    #[export]
    pub fn last_index_of_char(text: &[u8], needle: u8) -> Option<usize> {
        U8::rposition(text, |v| v.simd_eq(needle))
    }

    #[export]
    pub fn last_index_of_char_shared(text: &[SharedU8], needle: u8) -> Option<usize> {
        U8::rposition(text, |v| v.simd_eq(needle))
    }

    #[export]
    pub fn last_index_of_char16(text: &[u16], needle: u16) -> Option<usize> {
        U16::rposition(text, |v| v.simd_eq(needle))
    }

    #[export]
    pub fn index_of_either(text: &[u8], a: u8, b: u8) -> Option<usize> {
        U8::position(text, |v| v.simd_eq(a) | v.simd_eq(b))
    }

    #[export]
    pub fn last_index_of_either(text: &[u8], a: u8, b: u8) -> Option<usize> {
        U8::rposition(text, |v| v.simd_eq(a) | v.simd_eq(b))
    }

    #[export]
    pub fn index_of_one_of_three(text: &[u8], a: u8, b: u8, c: u8) -> Option<usize> {
        U8::position(text, |v| v.simd_eq(a) | v.simd_eq(b) | v.simd_eq(c))
    }

    /// Zero unless the byte is ASCII.
    fn row(v: U8, table: u128) -> U8 {
        U8::repeat_16(table.to_le_bytes()).lookup(v & 0x8F)
    }

    fn is_in_row(v: U8, row: U8) -> Test {
        let bit = U8::repeat_16([1, 2, 4, 8, 16, 32, 64, 128, 1, 2, 4, 8, 16, 32, 64, 128]);
        (row & bit.lookup(v >> 4)).simd_ne(0)
    }

    #[export]
    pub fn index_in_ascii_set(text: &[u8], ascii: u128) -> Option<usize> {
        U8::position(text, |v| is_in_row(v, row(v, ascii)))
    }

    #[export]
    pub fn index_in_set(text: &[u8], ascii: u128, others: u128) -> Option<usize> {
        U8::position(text, |v| {
            is_in_row(v, row(v, ascii) | row(v ^ 0x80, others))
        })
    }

    #[export]
    pub fn last_index_in_set(text: &[u8], ascii: u128, others: u128) -> Option<usize> {
        U8::rposition(text, |v| {
            is_in_row(v, row(v, ascii) | row(v ^ 0x80, others))
        })
    }

    fn ends_run_in_string(v: U8, quote: u8) -> Test {
        v.simd_eq(quote) | v.simd_eq(b'\\') | !v.in_range(0x20..=0x7E)
    }

    #[export]
    pub fn index_of_interesting_character_in_string_literal(
        text: &[u8],
        quote: u8,
    ) -> Option<usize> {
        U8::position(text, |v| ends_run_in_string(v, quote))
    }

    #[export]
    pub fn index_of_interesting_character_in_template(text: &[u8]) -> Option<usize> {
        U8::position(text, |v| ends_run_in_string(v, b'`') | v.simd_eq(b'$'))
    }

    #[export]
    pub fn index_of_interesting_character_in_multiline_comment(text: &[u8]) -> Option<usize> {
        U8::position(text, |v| {
            v.simd_eq(b'*') | v.simd_eq(b'\r') | (v.simd_eq(b'\n') | is_below(v, 0))
        })
    }

    #[export]
    pub fn index_of_newline_or_non_ascii(text: &[u8]) -> Option<usize> {
        U8::position(text, |v| is_below(v, 0x20))
    }

    #[export]
    pub fn index_of_space_or_newline_or_non_ascii(text: &[u8]) -> Option<usize> {
        U8::position(text, |v| is_below(v, 0x21))
    }

    #[export]
    pub fn index_of_newline_or_non_ascii_or_hash_or_at(text: &[u8]) -> Option<usize> {
        U8::position(text, |v| {
            v.simd_eq(b'#') | v.simd_eq(b'@') | is_below(v, 0x20)
        })
    }

    #[export]
    pub fn contains_newline_or_non_ascii_or_quote(text: &[u8]) -> bool {
        U8::position(text, |v| v.simd_eq(b'"') | is_below(v, 0x20)).is_some()
    }

    #[export]
    pub fn first_non_ascii8(text: &[u8]) -> Option<usize> {
        U8::position(text, |v| is_below(v, 0))
    }

    #[export]
    pub fn first_non_ascii16(text: &[u16]) -> Option<usize> {
        U16::position(text, |v| v.simd_gt(0x7F))
    }

    #[export]
    pub fn index_of_first_ascii_upper(text: &[u8]) -> Option<usize> {
        U8::position(text, |v| v.in_range(b'A'..=b'Z'))
    }

    #[export]
    pub fn index_of_first_ascii_upper16(text: &[u16]) -> Option<usize> {
        U16::position(text, |v| v.in_range(b'A'.into()..=b'Z'.into()))
    }

    #[inline(always)]
    fn index_of_escape<T: Int<N> + From<u8> + Into<u16>, const N: usize>(
        text: &[T],
    ) -> Option<usize> {
        Vector::<T, N>::find_map(
            text,
            |v| (v & !Vector::splat(T::from(0x8F))).simd_eq(T::from(0x10)),
            |mut matches| matches.find(|&at| starts_or_ends_escape(text[at].into())),
        )
    }

    #[export]
    pub fn index_of_escape_char8(text: &[u8]) -> Option<usize> {
        index_of_escape::<_, { U8::LEN }>(text)
    }

    #[export]
    pub fn index_of_escape_char16(text: &[u16]) -> Option<usize> {
        index_of_escape::<_, { U16::LEN }>(text)
    }

    /// The characters whose entities are 3, 4 and 5 longer.
    fn html_escapes<T: Int<N> + From<u8>, const N: usize>(v: Vector<T, N>) -> [Mask<T, N>; 3] {
        let is = |c: u8| v.simd_eq(T::from(c));
        [is(b'<') | is(b'>'), is(b'&'), is(b'"') | is(b'\'')]
    }

    /// By the low half of the byte.
    const HTML_ESCAPES: [u8; 16] = *b"\x01\0\"\0\0\0&'\0\0\0\0<\0>\0";

    #[export]
    pub fn index_of_html_escape_char8(text: &[u8]) -> Option<usize> {
        U8::position(text, |v| {
            U8::repeat_16(HTML_ESCAPES).lookup(v & 0x8F).simd_eq(v)
        })
    }

    #[export]
    pub fn index_of_html_escape_char16(text: &[u16]) -> Option<usize> {
        U16::position(text, |v| {
            let escape = U8::repeat_16(HTML_ESCAPES).lookup((v & 0x8F | 0x8000).bitcast());
            escape.bitcast::<U16>().simd_eq(v)
        })
    }

    #[export]
    pub fn html_escape_extra_len8(text: &[u8]) -> usize {
        let [a, b, c] = U8::count_each(text, |v| html_escapes(v));
        3 * a + 4 * b + 5 * c
    }

    #[export]
    pub fn html_escape_extra_len16(text: &[u16]) -> usize {
        let [a, b, c] = U16::count_each(text, |v| html_escapes(v));
        3 * a + 4 * b + 5 * c
    }

    #[export]
    pub fn count_char(text: &[u8], needle: u8) -> usize {
        U8::count(text, |v| v.simd_eq(needle))
    }
}
