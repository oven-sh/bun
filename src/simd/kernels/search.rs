//! Where a character is, and how many there are.
use bun_simd::SharedU8;

pub use simd::{
    common_prefix_len, contains_newline_or_non_ascii_or_quote, count_char, html_escape_extra_len,
    html_escape_extra_len16, index_of_ansi_escape, index_of_ansi_escape16, index_of_ascii_upper,
    index_of_ascii_upper16, index_of_char, index_of_char_shared, index_of_char16,
    index_of_html_escape, index_of_html_escape16,
    index_of_interesting_character_in_multiline_comment,
    index_of_interesting_character_in_string_literal, index_of_newline_or_non_ascii,
    index_of_newline_or_non_ascii_or_hash_or_at, index_of_non_ascii, index_of_non_ascii16,
    index_of_not_char, index_of_space_or_newline_or_non_ascii, last_index_of_char,
    last_index_of_char_shared, last_index_of_char16,
};

/// For each low half of a byte, a bit for each high half: 0 to 7, and 8 to 15.
#[inline(always)]
fn tables_of_set(bytes: &[u8]) -> (u128, u128) {
    let mut words = [0u64; 4];
    for &byte in bytes {
        words[usize::from(byte >> 6 & 2 | byte >> 3 & 1)] |=
            1 << (8 * (byte & 7) + (byte >> 4 & 7));
    }
    let [a, b, c, d] = words.map(u128::from);
    (a | b << 64, c | d << 64)
}

/// The tables are constants if `chars` is.
#[inline(always)]
pub fn index_of_any_char(text: &[u8], chars: &[u8]) -> Option<usize> {
    match *chars {
        [a, b] => simd::index_of_either(text, a, b),
        [a, b, c] => simd::index_of_one_of_three(text, a, b, c),
        _ => match tables_of_set(chars) {
            (ascii, 0) => simd::index_in_ascii_set(text, ascii),
            (ascii, others) => simd::index_in_set(text, ascii, others),
        },
    }
}

#[inline(always)]
pub fn last_index_of_any_char(text: &[u8], chars: &[u8]) -> Option<usize> {
    match *chars {
        [a, b] => simd::last_index_of_either(text, a, b),
        [a, b, c] => simd::last_index_of_one_of_three(text, a, b, c),
        _ => {
            let (ascii, others) = tables_of_set(chars);
            simd::last_index_in_set(text, ascii, others)
        }
    }
}

#[inline(always)]
pub fn index_of_needs_escape_for_javascript_string(text: &[u8], quote: u8) -> Option<usize> {
    match quote {
        b'`' => simd::index_of_interesting_character_in_template(text),
        _ => index_of_interesting_character_in_string_literal(text, quote),
    }
}

#[bun_simd::foreach_target]
mod simd {
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
    pub fn index_of_non_ascii(text: &[u8]) -> Option<usize> {
        U8::position(text, move |v| is_below(v, 0))
    }

    #[export]
    pub fn index_of_non_ascii16(text: &[u16]) -> Option<usize> {
        U16::position(text, move |v| v.simd_gt(0x7F))
    }

    #[export]
    pub fn index_of_ascii_upper(text: &[u8]) -> Option<usize> {
        U8::position(text, move |v| v.in_range(b'A'..=b'Z'))
    }

    #[export]
    pub fn index_of_ascii_upper16(text: &[u16]) -> Option<usize> {
        U16::position(text, move |v| v.in_range(b'A'.into()..=b'Z'.into()))
    }

    /// The only byte that starts or ends an escape sequence, and that is `index` above 0x81, or ESC.
    fn escape_at(index: U8) -> U8 {
        let table = *b"\x1B\x1B\x1B\x1B\x1B\x1B\x1B\x98\x1B\x1B\x9B\x9C\x9D\x9E\x9F\x90";
        U8::repeat(table).lookup(index & 0x8F)
    }

    #[export]
    pub fn index_of_ansi_escape(text: &[u8]) -> Option<usize> {
        U8::position_refined(text, |v| {
            let escape = escape_at(v.saturating_sub(0x81));
            [(v & 0x70).simd_eq(0x10), escape.simd_eq(v)]
        })
    }

    #[export]
    pub fn index_of_ansi_escape16(text: &[u16]) -> Option<usize> {
        U16::position_refined(text, |v| {
            let above = U8::repeat([0x81, 0xFF]);
            let escape: U16 = escape_at(v.bitcast::<U8>().saturating_sub(above)).bitcast();
            [(v & 0xFF70).simd_eq(0x10), escape.simd_eq(v ^ 0x1B00)]
        })
    }

    /// By the low half of the byte.
    const HTML_ESCAPES: [u8; 16] = *b"\x01\0\"\0\0\0&'\0\0\0\0<\0>\0";
    const EXTRA_LEN: [u8; 16] = [0, 0, 5, 0, 0, 0, 4, 5, 0, 0, 0, 0, 3, 0, 3, 0];

    fn is_html_escape(v: U8) -> Test {
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
    pub fn index_of_html_escape(text: &[u8]) -> Option<usize> {
        U8::position(text, |v| is_html_escape(v))
    }

    #[export]
    pub fn index_of_html_escape16(text: &[u16]) -> Option<usize> {
        U16::position(text, |v| is_html_escape16(v))
    }

    #[export]
    pub fn html_escape_extra_len(text: &[u8]) -> usize {
        U8::sum_of_bytes::<_, 5>(text, |v| {
            is_html_escape(v).select(U8::repeat(EXTRA_LEN).lookup(v & 0x8F), 0)
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

    /// Nothing is dispatched, and it is inlined into plain code.
    #[export(baseline)]
    #[inline]
    pub fn common_prefix_len(a: &[u8], b: &[u8]) -> usize {
        let differs = U8::position_near([a, b], |[a, b]| a.simd_ne(b));
        differs.unwrap_or_else(|| a.len().min(b.len()))
    }
}
