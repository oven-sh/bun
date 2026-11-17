//! Kernels with the same signature.
use bun_simd::Out;
use bun_simd_kernels::*;
use core::sync::atomic::AtomicU8;

pub(crate) trait Each<T> {
    fn kernel<R: Number>(&mut self, name: &'static str, kernel: impl Fn(&[T]) -> R);
}

pub(crate) trait Number {
    fn number(self) -> u64;
}

impl Number for usize {
    fn number(self) -> u64 {
        self as u64
    }
}

impl Number for bool {
    fn number(self) -> u64 {
        self.into()
    }
}

impl Number for Option<usize> {
    fn number(self) -> u64 {
        self.unwrap_or(usize::MAX).number()
    }
}

impl Number for (usize, usize) {
    fn number(self) -> u64 {
        (self.0 << 32 | self.1).number()
    }
}

#[rustfmt::skip]
pub(crate) fn of_bytes(each: &mut impl Each<u8>) {
    each.kernel("index_of_newline_or_non_ascii", index_of_newline_or_non_ascii);
    each.kernel("index_of_newline_or_non_ascii_or_hash_or_at", index_of_newline_or_non_ascii_or_hash_or_at);
    each.kernel("index_of_interesting_character_in_multiline_comment", index_of_interesting_character_in_multiline_comment);
    each.kernel("index_of_space_or_newline_or_non_ascii", index_of_space_or_newline_or_non_ascii);
    each.kernel("contains_newline_or_non_ascii_or_quote", contains_newline_or_non_ascii_or_quote);
    each.kernel("first_non_ascii8", first_non_ascii8);
    each.kernel("index_of_first_ascii_upper", index_of_first_ascii_upper);
    each.kernel("index_of_escape_char8", index_of_escape_char8);
    each.kernel("index_of_html_escape_char8", index_of_html_escape_char8);
    each.kernel("html_escape_extra_len8", html_escape_extra_len8);
    each.kernel("count_mapping_delims", count_mapping_delims);
    each.kernel("visible_latin1_width", visible_latin1_width);
    each.kernel("visible_latin1_width_exclude_ansi", visible_latin1_width_exclude_ansi);
    of_paths(each);
}

#[rustfmt::skip]
pub(crate) fn of_paths(each: &mut impl Each<u8>) {
    each.kernel("index_of_untidy_slash", index_of_untidy_slash);
    each.kernel("index_of_untidy_slash_or_non_ascii", index_of_untidy_slash_or_non_ascii);
    each.kernel("last_index_of_slash", last_index_of_slash);
    each.kernel("last_index_of_slash_or_dot", last_index_of_slash_or_dot);
    each.kernel("count_slashes", count_slashes);
}

#[rustfmt::skip]
pub(crate) fn of_units(each: &mut impl Each<u16>) {
    each.kernel("first_non_ascii16", first_non_ascii16);
    each.kernel("index_of_first_ascii_upper16", index_of_first_ascii_upper16);
    each.kernel("index_of_escape_char16", index_of_escape_char16);
    each.kernel("index_of_html_escape_char16", index_of_html_escape_char16);
    each.kernel("html_escape_extra_len16", html_escape_extra_len16);
    each.kernel("count_printable_ascii16", count_printable_ascii16);
    each.kernel("visible_utf16_width", visible_utf16_width);
}

type Pixel = [u8; 4];
type Move = for<'a> fn(&[Pixel], usize, Out<'a, Pixel>) -> &'a mut [Pixel];

pub(crate) const MOVES: [(&str, Move); 5] = [
    ("rotate_90", rotate_90),
    ("rotate_180", |src, _, dst| rotate_180(src, dst)),
    ("rotate_270", rotate_270),
    ("flip_horizontally", flip_horizontally),
    ("flip_vertically", flip_vertically),
];

pub(crate) const SWAPS: [(&str, fn(&[AtomicU8])); 3] = [
    ("bswap16_shared", bswap16_shared),
    ("bswap32_shared", bswap32_shared),
    ("bswap64_shared", bswap64_shared),
];
