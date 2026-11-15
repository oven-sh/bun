//! The Highway kernels, with the signatures of `bun_simd_kernels`.
use crate::Uninit;
pub(crate) use bun_highway::*;
use bun_simd_kernels::{Columns, ColumnsFilled, MappingsState};
use core::mem::MaybeUninit;

const LANCZOS3: i32 = 2;

unsafe extern "C" {
    fn highway_index_of_html_escape_char8(text: *const u8, len: usize) -> usize;
    fn highway_index_of_html_escape_char16(text: *const u16, len: usize) -> usize;
    fn highway_first_non_ascii16(text: *const u16, len: usize) -> usize;
    fn highway_lower_ascii16(from: *const u16, len: usize, to: *mut u16);
    fn highway_bswap32(bytes: *mut u8, len: usize);
    fn bun_image_cmyk_to_rgba8(bytes: *mut u8, len: usize);
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

#[inline(always)]
pub(crate) fn index_of_html_escape_char8(text: &[u8]) -> Option<usize> {
    // SAFETY: reads `text`.
    let at = unsafe { highway_index_of_html_escape_char8(text.as_ptr(), text.len()) };
    (at != text.len()).then_some(at)
}

#[inline(always)]
pub(crate) fn index_of_html_escape_char16(text: &[u16]) -> Option<usize> {
    // SAFETY: reads `text`.
    let at = unsafe { highway_index_of_html_escape_char16(text.as_ptr(), text.len()) };
    (at != text.len()).then_some(at)
}

#[inline(always)]
pub(crate) fn first_non_ascii16(text: &[u16]) -> Option<usize> {
    // SAFETY: reads `text`.
    let at = unsafe { highway_first_non_ascii16(text.as_ptr(), text.len()) };
    (at != text.len()).then_some(at)
}

#[inline(always)]
pub(crate) fn index_of_either(text: &[u8], chars: [u8; 2]) -> Option<usize> {
    index_of_any_char(text, &chars)
}

#[inline(always)]
pub(crate) fn fill_with_mask(mask: [u8; 4], output: &mut [u8], input: &[u8]) {
    fill_with_skip_mask(mask, output, input, false);
}

#[inline(always)]
pub(crate) fn encode_hex_lower(src: &[u8], dst: &mut [[u8; 2]]) {
    bun_highway::encode_hex_lower(src, dst.as_flattened_mut());
}

#[inline(always)]
pub(crate) fn decode_hex<'a>(src: &[[u8; 2]], dst: &'a mut [u8]) -> &'a mut [u8] {
    let len = bun_highway::decode_hex(src.as_flattened(), dst);
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
pub(crate) fn xxhash3_64_long(input: &[u8]) -> Option<u64> {
    Some(xxhash3_64(0, input))
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
pub(crate) fn lower_ascii16(from: &[u16], to: &mut [u16]) {
    // SAFETY: both slices have at least that length.
    unsafe { highway_lower_ascii16(from.as_ptr(), from.len().min(to.len()), to.as_mut_ptr()) }
}

#[inline(always)]
pub(crate) fn bswap32(words: &mut [[u8; 4]]) {
    // SAFETY: reads and writes `words`.
    unsafe { highway_bswap32(words.as_mut_ptr().cast(), size_of_val(words)) }
}

#[inline(always)]
pub(crate) fn cmyk_to_rgba(pixels: &mut [[u8; 4]]) {
    // SAFETY: reads and writes `pixels`.
    unsafe { bun_image_cmyk_to_rgba8(pixels.as_mut_ptr().cast(), size_of_val(pixels)) }
}

#[inline(always)]
pub(crate) fn modulate(pixels: &mut [[u8; 4]], brightness: f32, saturation: f32) {
    let (bytes, len) = (pixels.as_mut_ptr().cast(), size_of_val(pixels));
    // SAFETY: reads and writes `pixels`.
    unsafe { bun_image_modulate_rgba8(bytes, len, brightness, saturation) }
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

#[derive(Default)]
pub(crate) struct Resizer {
    scratch: Vec<u32>,
}

impl Resizer {
    pub(crate) fn lanczos3(
        &mut self,
        src: &[[u8; 4]],
        src_w: usize,
        dst: &mut [[u8; 4]],
        dst_w: usize,
    ) {
        let sizes = [src_w, src.len() / src_w, dst_w, dst.len() / dst_w];
        let [src_w, src_h, dst_w, dst_h] = sizes.map(|size| size as i32);
        let size = bun_image_resize_scratch_size(src_w, src_h, dst_w, dst_h, LANCZOS3);
        self.scratch.resize(size.div_ceil(4), 0);
        let (src, dst) = (src.as_ptr().cast(), dst.as_mut_ptr().cast());
        let scratch = self.scratch.as_mut_ptr().cast();
        // SAFETY: the images have at least these sizes, and `scratch` has the requested size.
        unsafe { bun_image_resize_rgba8(src, src_w, src_h, dst, dst_w, dst_h, LANCZOS3, scratch) };
    }
}
