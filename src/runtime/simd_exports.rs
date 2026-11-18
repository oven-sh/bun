//! The kernels that C++ calls. `src/jsc/bindings/SIMDKernels.h` declares them.

use bun_simd::SharedU8;
use bun_simd_kernels as kernels;
use core::mem::MaybeUninit;
use core::sync::atomic::AtomicU8;

/// `WTF::notFound`
const NOT_FOUND: usize = usize::MAX;

// HOST_EXPORT(Bun__simd__indexOfByte, c)
pub(crate) fn index_of_byte(haystack: &[SharedU8], needle: u8) -> usize {
    kernels::index_of_char_shared(haystack, needle).unwrap_or(NOT_FOUND)
}

// HOST_EXPORT(Bun__simd__lastIndexOfByte, c)
pub(crate) fn last_index_of_byte(haystack: &[SharedU8], needle: u8) -> usize {
    kernels::last_index_of_char_shared(haystack, needle).unwrap_or(NOT_FOUND)
}

// HOST_EXPORT(Bun__simd__indexOfBytes, c)
pub(crate) fn index_of_bytes(haystack: &[SharedU8], needle: &[SharedU8]) -> usize {
    kernels::memmem_shared(haystack, needle).unwrap_or(NOT_FOUND)
}

// HOST_EXPORT(Bun__simd__lastIndexOfBytes, c)
pub(crate) fn last_index_of_bytes(haystack: &[SharedU8], needle: &[SharedU8]) -> usize {
    kernels::memrmem_shared(haystack, needle).unwrap_or(NOT_FOUND)
}

// HOST_EXPORT(Bun__simd__indexOfPairs, c)
pub(crate) fn index_of_pairs(haystack: &[SharedU8], needle: &[SharedU8]) -> usize {
    kernels::memmem16_shared(haystack.as_chunks().0, needle.as_chunks().0).unwrap_or(NOT_FOUND)
}

// HOST_EXPORT(Bun__simd__lastIndexOfPairs, c)
pub(crate) fn last_index_of_pairs(haystack: &[SharedU8], needle: &[SharedU8]) -> usize {
    kernels::memrmem16_shared(haystack.as_chunks().0, needle.as_chunks().0).unwrap_or(NOT_FOUND)
}

// HOST_EXPORT(Bun__simd__swap16, c)
pub(crate) fn swap16(bytes: &[AtomicU8]) {
    kernels::swap16_shared(bytes);
}

// HOST_EXPORT(Bun__simd__swap32, c)
pub(crate) fn swap32(bytes: &[AtomicU8]) {
    kernels::swap32_shared(bytes);
}

// HOST_EXPORT(Bun__simd__swap64, c)
pub(crate) fn swap64(bytes: &[AtomicU8]) {
    kernels::swap64_shared(bytes);
}

// HOST_EXPORT(Bun__simd__xxHash3, c)
pub(crate) fn xxhash3(bytes: &[SharedU8]) -> u64 {
    kernels::xxhash3_64_shared(0, bytes)
}

// HOST_EXPORT(Bun__simd__indexOfNonASCII8, c)
pub(crate) fn index_of_non_ascii8(text: &[u8]) -> usize {
    kernels::index_of_non_ascii(text).unwrap_or(text.len())
}

// HOST_EXPORT(Bun__simd__indexOfNonASCII16, c)
pub(crate) fn index_of_non_ascii16(text: &[u16]) -> usize {
    kernels::index_of_non_ascii16(text).unwrap_or(text.len())
}

// HOST_EXPORT(Bun__simd__indexOfASCIIUpper8, c)
pub(crate) fn index_of_ascii_upper8(text: &[u8]) -> usize {
    kernels::index_of_ascii_upper(text).unwrap_or(text.len())
}

// HOST_EXPORT(Bun__simd__indexOfASCIIUpper16, c)
pub(crate) fn index_of_ascii_upper16(text: &[u16]) -> usize {
    kernels::index_of_ascii_upper16(text).unwrap_or(text.len())
}

// HOST_EXPORT(Bun__simd__indexOfANSIEscape8, c)
pub(crate) fn index_of_ansi_escape8(text: &[u8]) -> usize {
    kernels::index_of_ansi_escape(text).unwrap_or(text.len())
}

// HOST_EXPORT(Bun__simd__indexOfANSIEscape16, c)
pub(crate) fn index_of_ansi_escape16(text: &[u16]) -> usize {
    kernels::index_of_ansi_escape16(text).unwrap_or(text.len())
}

// HOST_EXPORT(Bun__simd__indexOfHTMLEscape8, c)
pub(crate) fn index_of_html_escape8(text: &[u8]) -> usize {
    kernels::index_of_html_escape(text).unwrap_or(text.len())
}

// HOST_EXPORT(Bun__simd__indexOfHTMLEscape16, c)
pub(crate) fn index_of_html_escape16(text: &[u16]) -> usize {
    kernels::index_of_html_escape16(text).unwrap_or(text.len())
}

// HOST_EXPORT(Bun__simd__htmlEscapeExtraLength8, c)
pub(crate) fn html_escape_extra_length8(text: &[u8]) -> usize {
    kernels::html_escape_extra_len(text)
}

// HOST_EXPORT(Bun__simd__htmlEscapeExtraLength16, c)
pub(crate) fn html_escape_extra_length16(text: &[u16]) -> usize {
    kernels::html_escape_extra_len16(text)
}

// HOST_EXPORT(Bun__simd__countPrintableASCII16, c)
pub(crate) fn count_printable_ascii16(text: &[u16]) -> usize {
    kernels::count_printable_ascii16(text)
}

// HOST_EXPORT(Bun__simd__visibleLatin1Width, c)
pub(crate) fn visible_latin1_width(text: &[u8]) -> usize {
    kernels::visible_latin1_width(text)
}

// HOST_EXPORT(Bun__simd__visibleLatin1WidthExcludeANSI, c)
pub(crate) fn visible_latin1_width_exclude_ansi(text: &[u8]) -> usize {
    kernels::visible_latin1_width_exclude_ansi(text)
}

// HOST_EXPORT(Bun__simd__visibleUTF16Width, c)
pub(crate) fn visible_utf16_width(text: &[u16], width: &mut usize) -> usize {
    let units;
    (units, *width) = kernels::visible_utf16_width(text);
    units
}

// HOST_EXPORT(Bun__simd__lowerASCII8, c)
pub(crate) fn lower_ascii8(text: &[u8], output: &mut [MaybeUninit<u8>]) {
    kernels::lower_ascii(text, output.into());
}

// HOST_EXPORT(Bun__simd__lowerASCII16, c)
pub(crate) fn lower_ascii16(text: &[u16], output: &mut [MaybeUninit<u16>]) {
    kernels::lower_ascii16(text, output.into());
}

// HOST_EXPORT(Bun__simd__narrowTo8Bit, c)
pub(crate) fn narrow_to_8_bit(text: &[u16], output: &mut [MaybeUninit<u8>]) {
    kernels::copy_u16_to_u8(text, output.into());
}
