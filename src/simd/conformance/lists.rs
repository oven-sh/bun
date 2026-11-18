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
    each.kernel("index_of_non_ascii", index_of_non_ascii);
    each.kernel("index_of_ascii_upper", index_of_ascii_upper);
    each.kernel("index_of_ansi_escape", index_of_ansi_escape);
    each.kernel("index_of_html_escape", index_of_html_escape);
    each.kernel("html_escape_extra_len", html_escape_extra_len);
    each.kernel("sourcemap::count_delimiters", sourcemap::count_delimiters);
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
    each.kernel("index_of_non_ascii16", index_of_non_ascii16);
    each.kernel("index_of_ascii_upper16", index_of_ascii_upper16);
    each.kernel("index_of_ansi_escape16", index_of_ansi_escape16);
    each.kernel("index_of_html_escape16", index_of_html_escape16);
    each.kernel("html_escape_extra_len16", html_escape_extra_len16);
    each.kernel("count_printable_ascii16", count_printable_ascii16);
    each.kernel("visible_utf16_width", visible_utf16_width);
}

type Pixel = [u8; 4];
type Move = for<'a> fn(&[Pixel], usize, Out<'a, Pixel>) -> &'a mut [Pixel];

pub(crate) const MOVES: [(&str, Move); 5] = [
    ("image::rotate_90", image::rotate_90),
    ("image::rotate_180", |src, _, dst| {
        image::rotate_180(src, dst)
    }),
    ("image::rotate_270", image::rotate_270),
    ("image::flip_horizontally", image::flip_horizontally),
    ("image::flip_vertically", image::flip_vertically),
];

pub(crate) const SWAPS: [(&str, fn(&[AtomicU8])); 3] = [
    ("swap16_shared", swap16_shared),
    ("swap32_shared", swap32_shared),
    ("swap64_shared", swap64_shared),
];
