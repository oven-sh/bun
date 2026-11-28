#pragma once

#include <cstddef>
#include <cstdint>

// Runtime-dispatched SIMD kernels, written in Rust (src/simd_kernels/ffi.rs).
// A pointer can be null if its length is 0.

extern "C" {

// Buffers: any alignment, and another thread may be writing them. The result is in range even then.

// The length if there is none.
size_t bun_simd_index_of_char(const uint8_t* haystack, size_t len, uint8_t needle) noexcept;
size_t bun_simd_last_index_of_char(const uint8_t* haystack, size_t len, uint8_t needle) noexcept;
// kSimdNotFound if there is none.
size_t bun_simd_memmem(const uint8_t* haystack, size_t haystack_len, const uint8_t* needle, size_t needle_len) noexcept;
size_t bun_simd_memrmem(const uint8_t* haystack, size_t haystack_len, const uint8_t* needle, size_t needle_len) noexcept;
// The lengths and the result count units of two bytes.
size_t bun_simd_memmem16(const uint8_t* haystack, size_t haystack_len, const uint8_t* needle, size_t needle_len) noexcept;
size_t bun_simd_memrmem16(const uint8_t* haystack, size_t haystack_len, const uint8_t* needle, size_t needle_len) noexcept;
void bun_simd_bswap16(uint8_t* data, size_t len) noexcept;
void bun_simd_bswap32(uint8_t* data, size_t len) noexcept;
void bun_simd_bswap64(uint8_t* data, size_t len) noexcept;

// Strings: they do not change during the call. Never pass memory that JavaScript can share.

// The length if there is none.
size_t bun_simd_first_non_ascii8(const uint8_t* text, size_t len) noexcept;
size_t bun_simd_first_non_ascii16(const uint16_t* text, size_t len) noexcept;
size_t bun_simd_index_of_escape_char8(const uint8_t* text, size_t len) noexcept;
size_t bun_simd_index_of_escape_char16(const uint16_t* text, size_t len) noexcept;
size_t bun_simd_index_of_first_ascii_upper8(const uint8_t* text, size_t len) noexcept;
size_t bun_simd_index_of_first_ascii_upper16(const uint16_t* text, size_t len) noexcept;
size_t bun_simd_index_of_html_escape_char8(const uint8_t* text, size_t len) noexcept;
size_t bun_simd_index_of_html_escape_char16(const uint16_t* text, size_t len) noexcept;

size_t bun_simd_count_printable_ascii16(const uint16_t* text, size_t len) noexcept;
size_t bun_simd_html_escape_extra_len8(const uint8_t* text, size_t len) noexcept;
size_t bun_simd_html_escape_extra_len16(const uint16_t* text, size_t len) noexcept;
size_t bun_simd_visible_latin1_width(const uint8_t* text, size_t len) noexcept;
size_t bun_simd_visible_latin1_width_exclude_ansi(const uint8_t* text, size_t len) noexcept;
// The number of leading units that are clusters of their own. Adds their width to `*width`.
size_t bun_simd_visible_utf16_width(const uint16_t* text, size_t len, size_t* width) noexcept;
// The same, but it can go on after an ESC [ sequence, and stop early. The last unit that it counts is not a part of one.
// If it sets `*done`, only such sequences are between that unit and there.
size_t bun_simd_visible_utf16_width_exclude_ansi(const uint16_t* text, size_t len, size_t* width, size_t* done) noexcept;

// `to` is aligned, has room for `len` units, does not overlap `from`, and can be uninitialized.
void bun_simd_lower_ascii8(const uint8_t* from, size_t len, uint8_t* to) noexcept;
void bun_simd_lower_ascii16(const uint16_t* from, size_t len, uint16_t* to) noexcept;
// What is above 0xFF becomes '?'.
void bun_simd_narrow_to_latin1(const uint16_t* from, size_t len, uint8_t* to) noexcept;
// Copies the start of `from` without ESC [ sequences. Returns how many units are done, which is not in a sequence.
// What is after `*written` can have changed.
size_t bun_simd_strip_csi8(const uint8_t* from, size_t len, uint8_t* to, size_t* written) noexcept;
size_t bun_simd_strip_csi16(const uint16_t* from, size_t len, uint16_t* to, size_t* written) noexcept;
// `to` is as above, but has room for `to_len` units: `len` plus the extra length.
void bun_simd_escape_html8(const uint8_t* from, size_t len, uint8_t* to, size_t to_len) noexcept;
void bun_simd_escape_html16(const uint16_t* from, size_t len, uint16_t* to, size_t to_len) noexcept;
}

inline constexpr size_t kSimdNotFound = ~static_cast<size_t>(0);
