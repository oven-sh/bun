//! Kernels with the same signature, on Highway and in Rust.
use crate::highway as h;
use bun_simd::Out;
use bun_simd_kernels as r;
use core::sync::atomic::AtomicU8;

pub(crate) trait Pairs<T> {
    fn pair<R: PartialEq>(&mut self, highway: impl Fn(&[T]) -> R, rust: impl Fn(&[T]) -> R);
}

pub(crate) fn name_of(kernel: &impl Sized) -> &'static str {
    let path = core::any::type_name_of_val(kernel);
    &path[h::last_index_of_char(path.as_bytes(), b':').map_or(0, |at| at + 1)..]
}

#[rustfmt::skip]
pub(crate) fn of_bytes(with: &mut impl Pairs<u8>) {
    with.pair(h::index_of_interesting_character_in_multiline_comment, r::index_of_interesting_character_in_multiline_comment);
    with.pair(h::index_of_space_or_newline_or_non_ascii, r::index_of_space_or_newline_or_non_ascii);
    with.pair(h::contains_newline_or_non_ascii_or_quote, r::contains_newline_or_non_ascii_or_quote);
    with.pair(h::first_non_ascii8, r::first_non_ascii8);
    with.pair(h::index_of_first_ascii_upper, r::index_of_first_ascii_upper);
    with.pair(h::index_of_escape_char8, r::index_of_escape_char8);
    with.pair(h::index_of_html_escape_char8, r::index_of_html_escape_char8);
    with.pair(h::html_escape_extra_len8, r::html_escape_extra_len8);
    with.pair(h::count_mapping_delims, r::count_mapping_delims);
    with.pair(h::visible_latin1_width, r::visible_latin1_width);
    with.pair(h::visible_latin1_width_exclude_ansi, r::visible_latin1_width_exclude_ansi);
    of_paths(with);
}

#[rustfmt::skip]
pub(crate) fn of_paths(with: &mut impl Pairs<u8>) {
    with.pair(h::index_of_untidy_slash, r::index_of_untidy_slash);
    with.pair(h::index_of_untidy_slash_or_non_ascii, r::index_of_untidy_slash_or_non_ascii);
    with.pair(h::last_index_of_slash, r::last_index_of_slash);
    with.pair(h::last_index_of_slash_or_dot, r::last_index_of_slash_or_dot);
    with.pair(h::count_slashes, r::count_slashes);
}

#[rustfmt::skip]
pub(crate) fn of_units(with: &mut impl Pairs<u16>) {
    with.pair(h::first_non_ascii16, r::first_non_ascii16);
    with.pair(h::index_of_first_ascii_upper16, r::index_of_first_ascii_upper16);
    with.pair(h::index_of_escape_char16, r::index_of_escape_char16);
    with.pair(h::index_of_html_escape_char16, r::index_of_html_escape_char16);
    with.pair(h::html_escape_extra_len16, r::html_escape_extra_len16);
    with.pair(h::count_printable_ascii16, r::count_printable_ascii16);
    with.pair(h::visible_utf16_width, r::visible_utf16_width);
}

type Pixel = [u8; 4];
type Move = (
    &'static str,
    fn(&[Pixel], usize, &mut [Pixel]),
    for<'a> fn(&[Pixel], usize, Out<'a, Pixel>) -> &'a mut [Pixel],
);

#[rustfmt::skip]
pub(crate) const MOVES: [Move; 5] = [
    ("rotate_90", h::rotate_90, r::rotate_90),
    ("rotate_180", h::rotate_180, |src, _, dst| r::rotate_180(src, dst)),
    ("rotate_270", h::rotate_270, r::rotate_270),
    ("flip_horizontally", h::flip_horizontally, r::flip_horizontally),
    ("flip_vertically", h::flip_vertically, r::flip_vertically),
];

type Swap = (&'static str, fn(&mut [u8]), fn(&[AtomicU8]));

pub(crate) const SWAPS: [Swap; 3] = [
    ("bswap16", h::bswap16, r::bswap16_shared),
    ("bswap32", h::bswap32, r::bswap32_shared),
    ("bswap64", h::bswap64, r::bswap64_shared),
];
