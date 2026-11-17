//! Where a character is, and how many there are.
use bun_simd::SharedU8;

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

#[bun_simd::foreach_target]
pub(crate) mod simd {
    use isa::{I8, Mask, U8, U16};

    type Test = Mask<u8, { U8::LEN }>;

    /// Below `byte`, or not ASCII.
    fn is_below(v: U8, byte: i8) -> Test {
        v.bitcast::<I8>().simd_lt(byte).cast()
    }

    #[export]
    pub fn index_of_char(text: &[u8], needle: u8) -> Option<usize> {
        U8::position(text, move |v| v.simd_eq(needle))
    }

    #[export]
    pub fn index_of_char_shared(text: &[SharedU8], needle: u8) -> Option<usize> {
        U8::position(text, move |v| v.simd_eq(needle))
    }

    #[export]
    pub fn index_of_char16(text: &[u16], needle: u16) -> Option<usize> {
        U16::position(text, move |v| v.simd_eq(needle))
    }

    #[export]
    pub fn index_of_not_char(text: &[u8], value: u8) -> Option<usize> {
        U8::position(text, move |v| v.simd_ne(value))
    }

    #[export]
    pub fn last_index_of_char(text: &[u8], needle: u8) -> Option<usize> {
        U8::rposition(text, move |v| v.simd_eq(needle))
    }

    #[export]
    pub fn last_index_of_char_shared(text: &[SharedU8], needle: u8) -> Option<usize> {
        U8::rposition(text, move |v| v.simd_eq(needle))
    }

    #[export]
    pub fn last_index_of_char16(text: &[u16], needle: u16) -> Option<usize> {
        U16::rposition(text, move |v| v.simd_eq(needle))
    }

    #[export]
    pub fn index_of_either(text: &[u8], a: u8, b: u8) -> Option<usize> {
        U8::position(text, move |v| v.simd_eq(a) | v.simd_eq(b))
    }

    #[export]
    pub fn last_index_of_either(text: &[u8], a: u8, b: u8) -> Option<usize> {
        U8::rposition(text, move |v| v.simd_eq(a) | v.simd_eq(b))
    }

    #[export]
    pub fn index_of_one_of_three(text: &[u8], a: u8, b: u8, c: u8) -> Option<usize> {
        U8::position(text, move |v| v.simd_eq(a) | v.simd_eq(b) | v.simd_eq(c))
    }

    #[export]
    pub fn last_index_of_one_of_three(text: &[u8], a: u8, b: u8, c: u8) -> Option<usize> {
        U8::rposition(text, move |v| v.simd_eq(a) | v.simd_eq(b) | v.simd_eq(c))
    }

    /// Zero unless the byte is ASCII.
    fn row(v: U8, table: u128) -> U8 {
        U8::repeat(table.to_le_bytes()).lookup(v & 0x8F)
    }

    fn is_in_row(v: U8, row: U8) -> Test {
        let bit = U8::repeat([1, 2, 4, 8, 16, 32, 64, 128, 1, 2, 4, 8, 16, 32, 64, 128]);
        (row & bit.lookup(v >> 4)).simd_ne(0)
    }

    #[export]
    pub fn index_in_ascii_set(text: &[u8], ascii: u128) -> Option<usize> {
        U8::position(text, move |v| is_in_row(v, row(v, ascii)))
    }

    #[export]
    pub fn index_in_set(text: &[u8], ascii: u128, others: u128) -> Option<usize> {
        U8::position(text, move |v| {
            is_in_row(v, row(v, ascii) | row(v ^ 0x80, others))
        })
    }

    #[export]
    pub fn last_index_in_set(text: &[u8], ascii: u128, others: u128) -> Option<usize> {
        U8::rposition(text, move |v| {
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
        U8::position(text, move |v| ends_run_in_string(v, quote))
    }

    #[export]
    pub fn index_of_interesting_character_in_template(text: &[u8]) -> Option<usize> {
        U8::position(text, move |v| ends_run_in_string(v, b'`') | v.simd_eq(b'$'))
    }

    #[export]
    pub fn index_of_interesting_character_in_multiline_comment(text: &[u8]) -> Option<usize> {
        U8::position(text, move |v| {
            v.simd_eq(b'*') | v.simd_eq(b'\r') | (v.simd_eq(b'\n') | is_below(v, 0))
        })
    }

    #[export]
    pub fn index_of_newline_or_non_ascii(text: &[u8]) -> Option<usize> {
        U8::position(text, move |v| is_below(v, 0x20))
    }

    #[export]
    pub fn index_of_space_or_newline_or_non_ascii(text: &[u8]) -> Option<usize> {
        U8::position(text, move |v| is_below(v, 0x21))
    }

    #[export]
    pub fn index_of_newline_or_non_ascii_or_hash_or_at(text: &[u8]) -> Option<usize> {
        U8::position(text, move |v| {
            v.simd_eq(b'#') | v.simd_eq(b'@') | is_below(v, 0x20)
        })
    }

    #[export]
    pub fn contains_newline_or_non_ascii_or_quote(text: &[u8]) -> bool {
        U8::position(text, move |v| v.simd_eq(b'"') | is_below(v, 0x20)).is_some()
    }

    #[export]
    pub fn first_non_ascii8(text: &[u8]) -> Option<usize> {
        U8::position(text, move |v| is_below(v, 0))
    }

    #[export]
    pub fn first_non_ascii16(text: &[u16]) -> Option<usize> {
        U16::position(text, move |v| v.simd_gt(0x7F))
    }

    #[export]
    pub fn index_of_first_ascii_upper(text: &[u8]) -> Option<usize> {
        U8::position(text, move |v| v.in_range(b'A'..=b'Z'))
    }

    #[export]
    pub fn index_of_first_ascii_upper16(text: &[u16]) -> Option<usize> {
        U16::position(text, move |v| v.in_range(b'A'.into()..=b'Z'.into()))
    }

    /// The only byte that starts or ends an escape sequence, and that is `index` above 0x81, or ESC.
    fn escape_at(index: U8) -> U8 {
        let table = *b"\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x98\x1B\x1B\x9B\x9C\x9D\x9E\x9F\x90";
        U8::repeat(table).lookup(index & 0x8F)
    }

    #[export]
    pub fn index_of_escape_char8(text: &[u8]) -> Option<usize> {
        U8::position_refined(text, |v| {
            let escape = escape_at(v.saturating_sub(0x81));
            [(v & 0x70).simd_eq(0x10), escape.simd_eq(v)]
        })
    }

    #[export]
    pub fn index_of_escape_char16(text: &[u16]) -> Option<usize> {
        U16::position_refined(text, |v| {
            let above = U8::repeat([0x81, 0xFF]);
            let escape: U16 = escape_at(v.bitcast::<U8>().saturating_sub(above)).bitcast();
            [(v & 0xFF70).simd_eq(0x10), escape.simd_eq(v ^ 0x1B00)]
        })
    }

    /// By the low half of the byte.
    const HTML_ESCAPES: [u8; 16] = *b"\x01\0\"\0\0\0&'\0\0\0\0<\0>\0";
    const EXTRA_LEN: [u8; 16] = [0, 0, 5, 0, 0, 0, 4, 5, 0, 0, 0, 0, 3, 0, 3, 0];

    fn is_html_escape8(v: U8) -> Test {
        U8::repeat(HTML_ESCAPES).lookup(v & 0x8F).simd_eq(v)
    }

    fn low_half(v: U16) -> U8 {
        (v & 0x8F | 0x8000).bitcast()
    }

    fn is_html_escape16(v: U16) -> Mask<u16, { U16::LEN }> {
        let escape = U8::repeat(HTML_ESCAPES).lookup(low_half(v));
        escape.bitcast::<U16>().simd_eq(v)
    }

    #[export]
    pub fn index_of_html_escape_char8(text: &[u8]) -> Option<usize> {
        U8::position(text, |v| is_html_escape8(v))
    }

    #[export]
    pub fn index_of_html_escape_char16(text: &[u16]) -> Option<usize> {
        U16::position(text, |v| is_html_escape16(v))
    }

    #[export]
    pub fn html_escape_extra_len8(text: &[u8]) -> usize {
        U8::sum_of_bytes::<_, 5>(text, |v| {
            is_html_escape8(v).select(U8::repeat(EXTRA_LEN).lookup(v & 0x8F), 0)
        })
    }

    #[export]
    pub fn html_escape_extra_len16(text: &[u16]) -> usize {
        U16::sum_of_bytes::<_, 5>(text, |v| {
            let extra: U16 = U8::repeat(EXTRA_LEN).lookup(low_half(v)).bitcast();
            is_html_escape16(v).select(extra, 0).bitcast()
        })
    }

    #[export]
    pub fn count_char(text: &[u8], needle: u8) -> usize {
        U8::count(text, |v| v.simd_eq(needle))
    }
}
