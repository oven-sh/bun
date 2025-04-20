#pragma once

#include <cstdint>
#include <cstddef>

// Ensure C linkage for Zig FFI
#ifdef __cplusplus
extern "C" {
#endif

// Result structure for character finding operations
// Needs to be defined here so both C++ and Zig can see the same layout.
typedef struct IndexResult {
    int32_t index; // -1 if not found
    int32_t count; // Typically 1 if found, 0 otherwise (can be adapted)
} IndexResult;

// --- Function Declarations for Zig ---

// Find any character from chars in text, returning the position and count
IndexResult highway_find_chars(const uint8_t* text, size_t text_len,
    const uint8_t* chars, size_t chars_len);

// Count frequencies of [a-zA-Z0-9_$] characters, mapping them into a 64-element array
void highway_char_frequency(const uint8_t* text, size_t text_len,
    int32_t* freqs, int32_t delta);

// Find a substring, case-insensitive (ASCII only)
int32_t highway_find_substr_case_insensitive(const uint8_t* haystack, size_t haystack_len,
    const uint8_t* needle, size_t needle_len);

// Find characters that need escaping in string literals (quotes, backslash, control chars, $)
int32_t highway_index_of_interesting_char(const uint8_t* text, size_t text_len,
    uint8_t quote_type);

// Find a substring within a string
int32_t highway_index_of_substring(const uint8_t* haystack, size_t haystack_len,
    const uint8_t* needle, size_t needle_len);

#ifdef __cplusplus
} // extern "C"
#endif
