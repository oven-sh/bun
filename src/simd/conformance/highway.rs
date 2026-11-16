//! The Highway kernels, with the signatures of `bun_simd_kernels`.
use crate::Uninit;
pub(crate) use bun_highway::*;
use bun_simd_kernels::{Columns, ColumnsFilled, Filter, MappingsState};
use core::mem::MaybeUninit;

unsafe extern "C" {
    fn highway_visible_utf16_width(text: *const u16, len: usize, width: &mut usize) -> usize;
    fn highway_lower_ascii(from: *const u8, len: usize, to: *mut u8);
    fn highway_lower_ascii16(from: *const u16, len: usize, to: *mut u16);
    fn highway_bswap16(bytes: *mut u8, len: usize);
    fn highway_bswap32(bytes: *mut u8, len: usize);
    fn highway_bswap64(bytes: *mut u8, len: usize);
    fn bun_image_rotate_rgba8(src: *const u8, w: i32, h: i32, dst: *mut u8, degrees: i32);
    fn bun_image_flip_rgba8(src: *const u8, w: i32, h: i32, dst: *mut u8, is_horizontal: i32);
    fn bun_image_nearest_palette(
        palette: *const u8,
        len: u32,
        r: i32,
        g: i32,
        b: i32,
        a: i32,
    ) -> u32;
    fn bun_image_modulate_rgba8(bytes: *mut u8, len: usize, brightness: f32, saturation: f32);
    safe fn bun_image_resize_scratch_size(
        src_w: i32,
        src_h: i32,
        dst_w: i32,
        dst_h: i32,
        filter: i32,
    ) -> usize;
    fn bun_image_resize_rgba8(
        src: *const u8,
        src_w: i32,
        src_h: i32,
        dst: *mut u8,
        dst_w: i32,
        dst_h: i32,
        filter: i32,
        scratch: *mut u8,
    ) -> i32;
}

/// The kernels that only C++ calls, and that take a text and return a number.
macro_rules! from_cpp {
    ($($name:ident = $symbol:ident($unit:ty) -> $result:ty, $convert:expr;)*) => {$(
        #[inline(always)]
        pub(crate) fn $name(text: &[$unit]) -> $result {
            unsafe extern "C" {
                fn $symbol(text: *const $unit, len: usize) -> usize;
            }
            // SAFETY: reads `text`.
            $convert(unsafe { $symbol(text.as_ptr(), text.len()) }, text.len())
        }
    )*};
}

#[inline(always)]
fn index(at: usize, len: usize) -> Option<usize> {
    (at != len).then_some(at)
}

#[inline(always)]
fn count(count: usize, _: usize) -> usize {
    count
}

from_cpp! {
    first_non_ascii8 = highway_first_non_ascii8(u8) -> Option<usize>, index;
    first_non_ascii16 = highway_first_non_ascii16(u16) -> Option<usize>, index;
    index_of_escape_char8 = highway_index_of_escape_char8(u8) -> Option<usize>, index;
    index_of_escape_char16 = highway_index_of_escape_char16(u16) -> Option<usize>, index;
    index_of_first_ascii_upper = highway_index_of_first_ascii_upper(u8) -> Option<usize>, index;
    index_of_first_ascii_upper16 = highway_index_of_first_ascii_upper16(u16) -> Option<usize>, index;
    index_of_html_escape_char8 = highway_index_of_html_escape_char8(u8) -> Option<usize>, index;
    index_of_html_escape_char16 = highway_index_of_html_escape_char16(u16) -> Option<usize>, index;
    html_escape_extra_len8 = highway_html_escape_extra_len8(u8) -> usize, count;
    html_escape_extra_len16 = highway_html_escape_extra_len16(u16) -> usize, count;
    count_printable_ascii16 = highway_count_printable_ascii16(u16) -> usize, count;
    visible_latin1_width = highway_visible_latin1_width(u8) -> usize, count;
    visible_latin1_width_exclude_ansi = highway_visible_latin1_width_exclude_ansi(u8) -> usize, count;
}

#[inline(always)]
pub(crate) fn visible_utf16_width(text: &[u16]) -> (usize, usize) {
    let mut width = 0;
    // SAFETY: reads `text`.
    let len = unsafe { highway_visible_utf16_width(text.as_ptr(), text.len(), &mut width) };
    (len, width)
}

#[inline(always)]
pub(crate) fn index_of_needs_escape_for_javascript_string(text: &[u8], quote: u8) -> Option<usize> {
    bun_highway::index_of_needs_escape_for_javascript_string(text, quote).map(|at| at as usize)
}

#[inline(always)]
pub(crate) fn fill_with_mask(mask: [u8; 4], output: &mut [u8], input: &[u8]) {
    fill_with_skip_mask(mask, output, input, false);
}

#[inline(always)]
pub(crate) fn mask_in_place(mask: [u8; 4], bytes: &mut [u8]) {
    fill_with_skip_mask_inplace(mask, bytes, false);
}

#[inline(always)]
pub(crate) fn index_of_char16(text: &[u16], unit: u16) -> Option<usize> {
    memmem16(text, &[unit])
}

#[inline(always)]
pub(crate) fn last_index_of_char16(text: &[u16], unit: u16) -> Option<usize> {
    memrmem16(text, &[unit])
}

#[inline(always)]
pub(crate) fn decode_hex<'a>(src: &[[u8; 2]], dst: &'a mut [u8]) -> &'a mut [u8] {
    let len = bun_highway::decode_hex(src.as_flattened(), dst);
    &mut dst[..len]
}

#[inline(always)]
pub(crate) fn decode_hex16<'a>(src: &[[u16; 2]], dst: &'a mut [u8]) -> &'a mut [u8] {
    let len = decode_hex_u16(src.as_flattened(), dst);
    &mut dst[..len]
}

#[inline(always)]
pub(crate) fn copy_ascii_prefix<'a>(src: &[u8], dst: &'a mut [u8]) -> &'a mut [u8] {
    let len = bun_highway::copy_ascii_prefix(src, dst);
    &mut dst[..len]
}

#[inline(always)]
pub(crate) fn unpack_words<'a>(
    controls: &[u8],
    data: &[u8],
    words: &'a mut [[u32; 4]],
) -> (&'a mut [[u32; 4]], usize) {
    // SAFETY: the layout is the same, and the kernel writes only initialized values.
    let out = unsafe { &mut *(&raw mut *words as *mut [[MaybeUninit<u32>; 4]]) };
    let (groups, used) = bun_highway::unpack_words(controls, data, out);
    (&mut words[..groups], used)
}

#[inline(always)]
pub(crate) fn json_structural_index_chunk<'a>(
    input: &[u8],
    base_offset: usize,
    out: &'a mut [MaybeUninit<u32>],
    dirty: &mut [u64],
    state: &mut [u64; 3],
) -> (&'a mut [u32], u32) {
    let (len, flags) =
        bun_highway::json_structural_index_chunk(input, base_offset, out, dirty, state);
    // SAFETY: the kernel has written that many.
    (unsafe { out[..len].assume_init_mut() }, flags)
}

#[inline(always)]
pub(crate) fn xml_structural_index_chunk<'a>(
    input: &[u8],
    base_offset: usize,
    out: &'a mut [MaybeUninit<u32>],
    state: &mut [u64; 3],
) -> &'a mut [u32] {
    let len = bun_highway::xml_structural_index_chunk(input, base_offset, out, state);
    // SAFETY: the kernel has written that many.
    unsafe { out[..len].assume_init_mut() }
}

#[inline(always)]
pub(crate) fn xml_structural_index16_chunk<'a>(
    input: &[u16],
    base_offset: usize,
    out: &'a mut [MaybeUninit<u32>],
    state: &mut [u64; 3],
) -> &'a mut [u32] {
    let len = bun_highway::xml_structural_index16_chunk(input, base_offset, out, state);
    // SAFETY: the kernel has written that many.
    unsafe { out[..len].assume_init_mut() }
}

#[inline(always)]
pub(crate) fn png_filter_rgba(
    row: &[[u8; 4]],
    above: &[[u8; 4]],
    filtered: [&mut [[u8; 4]]; 4],
) -> [u64; 5] {
    let filtered = filtered.map(<[_]>::as_flattened_mut);
    bun_highway::png_filter_rgba(row.as_flattened(), above.as_flattened(), filtered)
}

#[inline(always)]
pub(crate) fn lower_ascii(from: &[u8], to: &mut [u8]) {
    // SAFETY: both slices have at least that length.
    unsafe { highway_lower_ascii(from.as_ptr(), from.len().min(to.len()), to.as_mut_ptr()) }
}

#[inline(always)]
pub(crate) fn lower_ascii16(from: &[u16], to: &mut [u16]) {
    // SAFETY: both slices have at least that length.
    unsafe { highway_lower_ascii16(from.as_ptr(), from.len().min(to.len()), to.as_mut_ptr()) }
}

#[inline(always)]
pub(crate) fn bswap16(bytes: &mut [u8]) {
    // SAFETY: reads and writes `bytes`.
    unsafe { highway_bswap16(bytes.as_mut_ptr(), bytes.len() & !1) }
}

#[inline(always)]
pub(crate) fn bswap32(bytes: &mut [u8]) {
    // SAFETY: reads and writes `bytes`.
    unsafe { highway_bswap32(bytes.as_mut_ptr(), bytes.len() & !3) }
}

#[inline(always)]
pub(crate) fn bswap64(bytes: &mut [u8]) {
    // SAFETY: reads and writes `bytes`.
    unsafe { highway_bswap64(bytes.as_mut_ptr(), bytes.len() & !7) }
}

#[inline(always)]
pub(crate) fn modulate(pixels: &mut [[u8; 4]], brightness: f32, saturation: f32) {
    let (bytes, len) = (pixels.as_mut_ptr().cast(), size_of_val(pixels));
    // SAFETY: reads and writes `pixels`.
    unsafe { bun_image_modulate_rgba8(bytes, len, brightness, saturation) }
}

type Move = unsafe extern "C" fn(*const u8, i32, i32, *mut u8, i32);

fn move_pixels(kernel: Move, how: i32, src: &[[u8; 4]], width: usize, dst: &mut [[u8; 4]]) {
    let (height, dst) = (src.len() / width, &mut dst[..src.len()]);
    assert!(height > 0);
    let (src, dst) = (src.as_ptr().cast(), dst.as_mut_ptr().cast());
    // SAFETY: both images have at least that size, which is not zero.
    unsafe { kernel(src, width as i32, height as i32, dst, how) }
}

pub(crate) fn rotate_90(src: &[[u8; 4]], width: usize, dst: &mut [[u8; 4]]) {
    move_pixels(bun_image_rotate_rgba8, 90, src, width, dst);
}

pub(crate) fn rotate_180(src: &[[u8; 4]], width: usize, dst: &mut [[u8; 4]]) {
    move_pixels(bun_image_rotate_rgba8, 180, src, width, dst);
}

pub(crate) fn rotate_270(src: &[[u8; 4]], width: usize, dst: &mut [[u8; 4]]) {
    move_pixels(bun_image_rotate_rgba8, 270, src, width, dst);
}

pub(crate) fn flip_horizontally(src: &[[u8; 4]], width: usize, dst: &mut [[u8; 4]]) {
    move_pixels(bun_image_flip_rgba8, 1, src, width, dst);
}

pub(crate) fn flip_vertically(src: &[[u8; 4]], width: usize, dst: &mut [[u8; 4]]) {
    move_pixels(bun_image_flip_rgba8, 0, src, width, dst);
}

#[inline(always)]
pub(crate) fn nearest_in_palette(palette: &[[u8; 4]], color: [u8; 4]) -> u8 {
    let ([r, g, b, a], len) = (color.map(i32::from), palette.len() as u32);
    // SAFETY: reads `palette`.
    unsafe { bun_image_nearest_palette(palette.as_ptr().cast(), len, r, g, b, a) as u8 }
}

pub(crate) fn parse_mappings<'a>(
    bytes: &[u8],
    out: Columns<Uninit<'a, [i32; 2]>, Uninit<'a, i32>>,
    sources_count: i32,
    state: &mut MappingsState,
) -> ColumnsFilled<'a> {
    let Columns {
        generated,
        original,
        src_idx,
        mut name_idx,
    } = out;
    let cap = src_idx.len();
    let out = ParseMappingsOut {
        generated: generated[..cap].as_mut_ptr().cast(),
        original: original[..cap].as_mut_ptr().cast(),
        src_idx: src_idx.as_mut_ptr().cast(),
        name_idx: name_idx.as_mut().map_or(core::ptr::null_mut(), |names| {
            names[..cap].as_mut_ptr().cast()
        }),
        cap,
    };
    let mut raw = ParseMappingsState {
        gen_line: state.gen_line,
        gen_col: state.gen_col,
        orig_line: state.orig_line,
        orig_col: state.orig_col,
        src_idx: state.src_idx,
        name_idx: state.name_idx,
        has_names: state.has_names.into(),
        ..Default::default()
    };
    // SAFETY: each column has `cap` rows and is borrowed exclusively.
    let rows = unsafe { bun_highway::parse_mappings(bytes, &out, sources_count, &mut raw, &mut 0) };
    *state = MappingsState {
        gen_line: raw.gen_line,
        gen_col: raw.gen_col,
        orig_line: raw.orig_line,
        orig_col: raw.orig_col,
        src_idx: raw.src_idx,
        name_idx: raw.name_idx,
        needs_sort: raw.needs_sort != 0,
        has_names: raw.has_names != 0,
    };
    // SAFETY: the kernel has filled that many rows.
    unsafe {
        Columns {
            generated: generated[..rows].assume_init_mut(),
            original: original[..rows].assume_init_mut(),
            src_idx: src_idx[..rows].assume_init_mut(),
            name_idx: name_idx.map(|names| names[..rows].assume_init_mut()),
        }
    }
}

pub(crate) fn resize(
    filter: Filter,
    src: &[[u8; 4]],
    src_w: usize,
    dst: &mut [[u8; 4]],
    dst_w: usize,
) {
    let sizes = [src_w, src.len() / src_w, dst_w, dst.len() / dst_w];
    let [src_w, src_h, dst_w, dst_h] = sizes.map(|size| size as i32);
    let filter = filter as i32;
    let size = bun_image_resize_scratch_size(src_w, src_h, dst_w, dst_h, filter);
    let mut scratch = Vec::<u32>::with_capacity(size.div_ceil(4));
    let (src, dst) = (src.as_ptr().cast(), dst.as_mut_ptr().cast());
    let scratch = scratch.as_mut_ptr().cast();
    // SAFETY: the images have at least these sizes, and `scratch` has the requested size.
    unsafe { bun_image_resize_rgba8(src, src_w, src_h, dst, dst_w, dst_h, filter, scratch) };
}
