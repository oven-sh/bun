// Must be first
#undef HWY_TARGET_INCLUDE
// Correct path to this file relative to the build root (CMakeLists.txt)
#define HWY_TARGET_INCLUDE "highway_strings.cpp"
#include <hwy/foreach_target.h> // Must come before highway.h

// Now include Highway and other headers
#include <hwy/highway.h>
#include <hwy/aligned_allocator.h>

#include <hwy/contrib/algo/find-inl.h>

// Include the C API header for IndexResult struct definition
#include "highway_bindings.h"

#include <cstring> // For memcmp
#include <algorithm> // For std::min, std::max
#include <cstddef>
#include <cstdint>
#include <vector> // For CompressStore temporary storage
#include <cassert> // For assert (use HWY_ASSERT for Highway asserts)

// Wrap the SIMD implementations in the Highway namespaces
HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE; // Alias for convenience

// Type alias for SIMD vector tag
using D8 = hn::ScalableTag<uint8_t>;

int64_t IndexOfCharImpl(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len,
    uint8_t needle)
{
    D8 d;
    // Use the Find function from find-inl.h which handles both vectorized and scalar cases
    const size_t pos = hn::Find<D8>(d, needle, haystack, haystack_len);

    // Convert to int64_t and return -1 if not found
    return (pos < haystack_len) ? static_cast<int64_t>(pos) : -1;
}

// --- Implementation Details ---

// Helper function to lowercase ASCII character using Highway
HWY_INLINE hn::Vec<D8> ToLower(D8 d, hn::Vec<D8> c)
{
    const auto vec_A = hn::Set(d, 'A');
    const auto vec_Z = hn::Set(d, 'Z');
    const auto mask_upper = hn::And(hn::Ge(c, vec_A), hn::Le(c, vec_Z));
    const auto lower = hn::Add(c, hn::Set(d, uint8_t { 32 })); // 'a' - 'A'
    return hn::IfThenElse(mask_upper, lower, c);
}

// Scalar case-insensitive memcmp helper
HWY_INLINE bool ScalarMemcmpCaseInsensitive(const uint8_t* HWY_RESTRICT s1, const uint8_t* HWY_RESTRICT s2, size_t n)
{
    for (size_t i = 0; i < n; ++i) {
        uint8_t c1 = s1[i];
        uint8_t c2 = s2[i];
        if (c1 >= 'A' && c1 <= 'Z') c1 += ('a' - 'A');
        if (c2 >= 'A' && c2 <= 'Z') c2 += ('a' - 'A');
        if (c1 != c2) return false;
    }
    return true;
}

// --- *Impl Function Definitions ---

// Implementation for indexOfAnyChar (Unchanged from previous correct version)
IndexResult IndexOfAnyCharImpl(const uint8_t* HWY_RESTRICT text, size_t text_len, const uint8_t* HWY_RESTRICT chars, size_t chars_len)
{
    if (text_len == 0 || chars_len == 0) return { -1, 0 };
    D8 d;
    const size_t N = hn::Lanes(d);

    if (chars_len == 1) {
        const auto needle_vec = hn::Set(d, chars[0]);
        for (size_t i = 0; i < text_len; i += N) {
            const size_t current_batch_size = std::min(N, text_len - i);
            const auto text_vec = hn::LoadN(d, text + i, current_batch_size);
            const auto eq_mask = hn::Eq(text_vec, needle_vec);
            const intptr_t pos = hn::FindFirstTrue(d, eq_mask);
            if (pos >= 0 && static_cast<size_t>(pos) < current_batch_size) {
                return { static_cast<int32_t>(i + pos), 1 };
            }
            if (current_batch_size != N) break;
        }
    } else {
        constexpr size_t kMaxPreloadedChars = 16;
        hn::Vec<D8> char_vecs[kMaxPreloadedChars];
        const size_t num_chars_to_preload = std::min(chars_len, kMaxPreloadedChars);
        for (size_t c = 0; c < num_chars_to_preload; ++c) {
            char_vecs[c] = hn::Set(d, chars[c]);
        }

        for (size_t i = 0; i < text_len; i += N) {
            const size_t current_batch_size = std::min(N, text_len - i);
            const auto text_vec = hn::LoadN(d, text + i, current_batch_size);
            auto found_mask = hn::MaskFalse(d);

            for (size_t c = 0; c < num_chars_to_preload; ++c) {
                found_mask = hn::Or(found_mask, hn::Eq(text_vec, char_vecs[c]));
            }
            if (chars_len > num_chars_to_preload) {
                for (size_t c = num_chars_to_preload; c < chars_len; ++c) {
                    found_mask = hn::Or(found_mask, hn::Eq(text_vec, hn::Set(d, chars[c])));
                }
            }

            intptr_t pos = hn::FindFirstTrue(d, found_mask);
            if (pos >= 0 && static_cast<size_t>(pos) < current_batch_size) {
                return { static_cast<int32_t>(i + pos), 1 };
            }
            if (current_batch_size != N) break;
        }
    }
    return { -1, 0 };
}

// Implementation for scanCharFrequency (Unchanged from previous correct version)
void ScanCharFrequencyImpl(const uint8_t* HWY_RESTRICT text, size_t text_len, int32_t* freqs, int32_t delta)
{
    if (text_len == 0 || delta == 0) return;
    D8 d;
    const size_t N = hn::Lanes(d);

    const auto vec_a = hn::Set(d, 'a');
    const auto vec_z = hn::Set(d, 'z');
    const auto vec_A = hn::Set(d, 'A');
    const auto vec_Z = hn::Set(d, 'Z');
    const auto vec_0 = hn::Set(d, '0');
    const auto vec_9 = hn::Set(d, '9');
    const auto vec_underscore = hn::Set(d, '_');
    const auto vec_dollar = hn::Set(d, '$');

    const auto vec_offset_a = hn::Set(d, 'a');
    const auto vec_offset_A = hn::Set(d, 'A');
    const auto vec_offset_0 = hn::Set(d, '0');

    size_t i = 0;
    size_t simd_text_len = text_len & ~(N - 1);
    for (; i <= simd_text_len; i += N) {
        const auto text_vec = hn::LoadU(d, text + i);
        const auto mask_az = hn::And(hn::Ge(text_vec, vec_a), hn::Le(text_vec, vec_z));
        const auto mask_AZ = hn::And(hn::Ge(text_vec, vec_A), hn::Le(text_vec, vec_Z));
        const auto mask_09 = hn::And(hn::Ge(text_vec, vec_0), hn::Le(text_vec, vec_9));
        const auto mask_underscore = hn::Eq(text_vec, vec_underscore);
        const auto mask_dollar = hn::Eq(text_vec, vec_dollar);
        auto valid_mask = hn::Or(mask_az, hn::Or(mask_AZ, hn::Or(mask_09, hn::Or(mask_underscore, mask_dollar))));
        if (hn::AllFalse(d, valid_mask)) continue;

        const auto idx_az = hn::Sub(text_vec, vec_offset_a);
        const auto idx_AZ = hn::Add(hn::Sub(text_vec, vec_offset_A), hn::Set(d, uint8_t { 26 }));
        const auto idx_09 = hn::Add(hn::Sub(text_vec, vec_offset_0), hn::Set(d, uint8_t { 52 }));

        auto indices_vec = hn::Zero(d);
        indices_vec = hn::IfThenElse(mask_az, idx_az, indices_vec);
        indices_vec = hn::IfThenElse(mask_AZ, idx_AZ, indices_vec);
        indices_vec = hn::IfThenElse(mask_09, idx_09, indices_vec);
        indices_vec = hn::IfThenElse(mask_underscore, hn::Set(d, uint8_t { 62 }), indices_vec);
        indices_vec = hn::IfThenElse(mask_dollar, hn::Set(d, uint8_t { 63 }), indices_vec);

        alignas(HWY_ALIGNMENT) uint8_t indices_array[HWY_MAX_LANES_D(D8)];
        alignas(HWY_ALIGNMENT) uint8_t valid_bits_array[(HWY_MAX_LANES_D(D8) + 7) / 8];
        hn::Store(indices_vec, d, indices_array);
        hn::StoreMaskBits(d, valid_mask, valid_bits_array);

        for (size_t j = 0; j < N; ++j) {
            if ((valid_bits_array[j / 8] >> (j % 8)) & 1) {
                assert(indices_array[j] < 64);
                freqs[indices_array[j]] += delta;
            }
        }
    }
    for (; i < text_len; ++i) {
        const uint8_t c = text[i];
        if (c >= 'a' && c <= 'z')
            freqs[c - 'a'] += delta;
        else if (c >= 'A' && c <= 'Z')
            freqs[c - 'A' + 26] += delta;
        else if (c >= '0' && c <= '9')
            freqs[c - '0' + 52] += delta;
        else if (c == '_')
            freqs[62] += delta;
        else if (c == '$')
            freqs[63] += delta;
    }
}

// Implementation for finding interesting characters in string literals
size_t IndexOfInterestingCharacterInStringLiteralImpl(const uint8_t* HWY_RESTRICT text, size_t text_len, uint8_t quote)
{
    ASSERT(text_len > 0);
    D8 d;
    const size_t N = hn::Lanes(d);

    const auto vec_quote = hn::Set(d, quote);
    const auto vec_backslash = hn::Set(d, '\\');
    const auto vec_min_ascii = hn::Set(d, uint8_t { 0x20 }); // Space
    const auto vec_max_ascii = hn::Set(d, uint8_t { 0x7E }); // ~

    for (size_t i = 0; i < text_len; i += N) {
        const size_t current_batch_size = std::min(N, text_len - i);
        const auto text_vec = hn::LoadN(d, text + i, current_batch_size);

        // Check for quote, backslash, or characters outside printable ASCII range
        const auto mask_quote = hn::Eq(text_vec, vec_quote);
        const auto mask_backslash = hn::Eq(text_vec, vec_backslash);
        const auto mask_lt_min = hn::Lt(text_vec, vec_min_ascii);
        const auto mask_gt_max = hn::Gt(text_vec, vec_max_ascii);

        const auto found_mask = hn::Or(
            hn::Or(mask_quote, mask_backslash),
            hn::Or(mask_lt_min, mask_gt_max));

        intptr_t pos = hn::FindFirstTrue(d, found_mask);
        if (pos >= 0 && static_cast<size_t>(pos) < current_batch_size) {
            return i + pos;
        }
        if (current_batch_size != N) break;
    }
    return text_len;
}

// Helper for needle_len == 1
int32_t IndexOfSubstringImpl_1(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len, const uint8_t needle)
{
    D8 d;
    // Use the Find function from find-inl.h which is optimized for this case
    const size_t pos = hn::Find(d, needle, haystack, haystack_len);
    return (pos < haystack_len) ? static_cast<int32_t>(pos) : -1;
}

// Helper for needle_len == 2
int32_t IndexOfSubstringImpl_2(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len, const uint8_t* HWY_RESTRICT needle)
{
    if (haystack_len < 2) return -1;

    D8 d;
    const size_t N = hn::Lanes(d);

    const auto n0 = hn::Set(d, needle[0]);
    const auto n1 = hn::Set(d, needle[1]);

    // Max valid starting position for a 2-byte needle
    const size_t max_pos = haystack_len - 2;

    for (size_t i = 0; i <= max_pos; i += N) {
        const size_t current_batch_size = std::min(N, max_pos + 1 - i);

        // Load chunks for first and second character positions
        const auto h0 = hn::LoadN(d, haystack + i, current_batch_size);
        const auto h1 = hn::LoadN(d, haystack + i + 1, std::min(current_batch_size, haystack_len - (i + 1)));

        // Compare both positions
        const auto eq0 = hn::Eq(h0, n0);
        const auto eq1 = hn::Eq(h1, n1);

        // Both must match
        const auto match_mask = hn::And(eq0, eq1);

        // Find position of first true bit
        const intptr_t pos = hn::FindFirstTrue(d, match_mask);
        if (pos >= 0 && static_cast<size_t>(pos) < current_batch_size) {
            return static_cast<int32_t>(i + pos);
        }

        // Exit the loop on a partial vector
        if (current_batch_size < N) break;
    }

    return -1;
}

// Helper for needle_len >= 3 using first and last character matching
int32_t IndexOfSubstringImpl_GE3(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len,
    const uint8_t* HWY_RESTRICT needle, size_t needle_len)
{
    D8 d;
    const size_t N = hn::Lanes(d);

    // First and last characters of the needle
    const uint8_t first_char = needle[0];
    const uint8_t last_char = needle[needle_len - 1];

    // Create vectors with repeated first and last characters
    const auto vec_first = hn::Set(d, first_char);
    const auto vec_last = hn::Set(d, last_char);

    const size_t last_char_offset = needle_len - 1;
    const size_t max_start_pos = haystack_len - needle_len;

    for (size_t i = 0; i <= max_start_pos; i += N) {
        const size_t current_batch_size = std::min(N, max_start_pos + 1 - i);

        // Load chunks for first and last character positions
        const auto haystack_first = hn::LoadN(d, haystack + i, current_batch_size);
        const auto haystack_last = hn::LoadN(d, haystack + i + last_char_offset, current_batch_size);

        // Compare both positions
        const auto eq_first = hn::Eq(haystack_first, vec_first);
        const auto eq_last = hn::Eq(haystack_last, vec_last);

        // Both must match
        const auto match_mask = hn::And(eq_first, eq_last);

        // Check if we have any matches
        if (!hn::AllFalse(d, match_mask)) {
            // Simple approach: check all positions sequentially
            // This is not optimal but guaranteed to work with Highway
            intptr_t pos = hn::FindFirstTrue(d, match_mask);
            if (pos >= 0 && static_cast<size_t>(pos) < current_batch_size) {
                const size_t match_pos = i + static_cast<size_t>(pos);
                // Since we already know the first and last characters match,
                // we only need to compare the middle portion
                if (needle_len <= 2 || memcmp(haystack + match_pos + 1, needle + 1, needle_len - 2) == 0) {
                    return static_cast<int32_t>(match_pos);
                }
            }

            // Check other positions by scanning the buffer manually
            // This is a fallback for finding additional matches in the same vector
            for (size_t j = static_cast<size_t>(pos) + 1; j < current_batch_size; j++) {
                // Check if the first and last characters match for this position
                if (haystack[i + j] == first_char && haystack[i + j + last_char_offset] == last_char) {
                    // Check the middle portion
                    if (needle_len <= 2 || memcmp(haystack + i + j + 1, needle + 1, needle_len - 2) == 0) {
                        return static_cast<int32_t>(i + j);
                    }
                }
            }
        }

        // Exit the loop on a partial vector
        if (current_batch_size < N) break;
    }

    return -1;
}

// Main dispatch function for IndexOfSubstring
int32_t IndexOfSubstringImpl(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len,
    const uint8_t* HWY_RESTRICT needle, size_t needle_len)
{
    if (needle_len == 0) return 0;
    if (haystack_len < needle_len) return -1;
    if (needle_len == 1) return IndexOfSubstringImpl_1(haystack, haystack_len, *needle);
    if (needle_len == 2) return IndexOfSubstringImpl_2(haystack, haystack_len, needle);
    return IndexOfSubstringImpl_GE3(haystack, haystack_len, needle, needle_len);
}

// --- Case-Insensitive Substring Search Implementations ---

// Helper for needle_len == 1 (Case-Insensitive)
int32_t IndexOfCaseInsensitiveImpl_1(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len, const uint8_t* HWY_RESTRICT needle)
{
    D8 d;
    const size_t N = hn::Lanes(d);
    uint8_t needle_lower = needle[0];
    if (needle_lower >= 'A' && needle_lower <= 'Z') needle_lower += ('a' - 'A');
    const auto vec_needle_lower = hn::Set(d, needle_lower);

    for (size_t i = 0; i < haystack_len; i += N) {
        const size_t current_batch_size = std::min(N, haystack_len - i);
        const auto haystack_vec = hn::LoadN(d, haystack + i, current_batch_size);
        const auto haystack_lower_vec = ToLower(d, haystack_vec);
        const auto eq_mask = hn::Eq(haystack_lower_vec, vec_needle_lower);
        const intptr_t pos = hn::FindFirstTrue(d, eq_mask);
        if (pos >= 0 && static_cast<size_t>(pos) < current_batch_size) {
            return static_cast<int32_t>(i + pos);
        }
        if (current_batch_size != N) break;
    }
    return -1;
}

// Helper for needle_len == 2 (Case-Insensitive)
int32_t IndexOfCaseInsensitiveImpl_2(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len, const uint8_t* HWY_RESTRICT needle)
{
    D8 d;
    const size_t N = hn::Lanes(d);
    uint8_t n0_lower = needle[0];
    uint8_t n1_lower = needle[1];
    if (n0_lower >= 'A' && n0_lower <= 'Z') n0_lower += ('a' - 'A');
    if (n1_lower >= 'A' && n1_lower <= 'Z') n1_lower += ('a' - 'A');
    const auto vec_n0_lower = hn::Set(d, n0_lower);
    const auto vec_n1_lower = hn::Set(d, n1_lower);
    const size_t max_pos = haystack_len - 2;

    for (size_t i = 0; i <= max_pos; i += N) {
        const size_t current_batch_size = std::min(N, max_pos + 1 - i);
        const auto h0 = hn::LoadN(d, haystack + i, current_batch_size);
        const size_t next_batch_size = std::min(N, haystack_len - (i + 1));
        const auto h1 = hn::LoadN(d, haystack + i + 1, next_batch_size);

        const auto h0_lower = ToLower(d, h0);
        const auto h1_lower = ToLower(d, h1);

        const auto eq0 = hn::Eq(h0_lower, vec_n0_lower);
        const auto eq1 = hn::Eq(h1_lower, vec_n1_lower);
        const auto match_mask = hn::And(eq0, eq1);

        const intptr_t pos = hn::FindFirstTrue(d, match_mask);
        if (pos >= 0 && static_cast<size_t>(pos) < current_batch_size) {
            return static_cast<int32_t>(i + pos);
        }
        if (current_batch_size != N) break;
    }
    return -1;
}

// Helper for needle_len >= 3 (Case-Insensitive - Algorithm 1)
int32_t IndexOfCaseInsensitiveImpl_GE3(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len,
    const uint8_t* HWY_RESTRICT needle, size_t needle_len)
{
    D8 d;
    const size_t N = hn::Lanes(d);

    uint8_t first_char_lower = needle[0];
    uint8_t last_char_lower = needle[needle_len - 1];
    if (first_char_lower >= 'A' && first_char_lower <= 'Z') first_char_lower += ('a' - 'A');
    if (last_char_lower >= 'A' && last_char_lower <= 'Z') last_char_lower += ('a' - 'A');

    const auto vec_first_lower = hn::Set(d, first_char_lower);
    const auto vec_last_lower = hn::Set(d, last_char_lower);

    const size_t last_char_offset = needle_len - 1;
    const size_t max_start_pos = haystack_len - needle_len;

    const size_t safe_limit_plus_1 = (haystack_len >= last_char_offset + N) ? (haystack_len - (last_char_offset + N) + 1) : 0;

    alignas(HWY_ALIGNMENT) uint32_t potential_indices_array[HWY_MAX_LANES_D(hn::ScalableTag<uint32_t>)];

    size_t i = 0;
    for (; i < safe_limit_plus_1; i += N) {
        const auto haystack_first_chunk = hn::LoadU(d, haystack + i);
        const auto haystack_last_chunk = hn::LoadU(d, haystack + i + last_char_offset);

        const auto first_lower = ToLower(d, haystack_first_chunk);
        const auto last_lower = ToLower(d, haystack_last_chunk);

        const auto mask_first = hn::Eq(first_lower, vec_first_lower);
        const auto mask_last = hn::Eq(last_lower, vec_last_lower);
        const auto potential_matches_mask = hn::And(mask_first, mask_last);

        if (!hn::AllFalse(d, potential_matches_mask)) {
            const hn::ScalableTag<uint32_t> d32;
            const auto indices_vec = hn::BitCast(d, hn::Iota(d32, 0));
            const size_t num_matches = hn::CompressStore(indices_vec, potential_matches_mask, d, reinterpret_cast<uint8_t*>(potential_indices_array));

            for (size_t k = 0; k < num_matches; ++k) {
                const size_t bit_index = potential_indices_array[k];
                const size_t pos = i + bit_index;
                if (pos > max_start_pos) continue;
                // Compare middle part case-insensitively
                if (ScalarMemcmpCaseInsensitive(haystack + pos + 1, needle + 1, needle_len - 2)) {
                    return static_cast<int32_t>(pos);
                }
            }
        }
    }

    // Scalar check for the remainder
    for (; i <= max_start_pos; ++i) {
        uint8_t h_first = haystack[i];
        uint8_t h_last = haystack[i + last_char_offset];
        if (h_first >= 'A' && h_first <= 'Z') h_first += ('a' - 'A');
        if (h_last >= 'A' && h_last <= 'Z') h_last += ('a' - 'A');

        if (h_first == first_char_lower && h_last == last_char_lower) {
            if (ScalarMemcmpCaseInsensitive(haystack + i + 1, needle + 1, needle_len - 2)) {
                return static_cast<int32_t>(i);
            }
        }
    }

    return -1;
}

// Main dispatch function for IndexOfCaseInsensitive
int32_t IndexOfCaseInsensitiveImpl(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len,
    const uint8_t* HWY_RESTRICT needle, size_t needle_len)
{
    if (needle_len == 0) return 0;
    if (haystack_len < needle_len) return -1;
    if (needle_len == 1) return IndexOfCaseInsensitiveImpl_1(haystack, haystack_len, needle);
    if (needle_len == 2) return IndexOfCaseInsensitiveImpl_2(haystack, haystack_len, needle);
    return IndexOfCaseInsensitiveImpl_GE3(haystack, haystack_len, needle, needle_len);
}

// NOLINTNEXTLINE(google-readability-namespace-comments)
} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

// HWY_ONCE ensures this block is only included once,
// in the final pass after all target-specific code is generated.
#if HWY_ONCE

namespace bun {

// Define the dispatch tables. The names here must exactly match
// the *Impl function names defined within the HWY_NAMESPACE block above.
HWY_EXPORT(IndexOfAnyCharImpl);
HWY_EXPORT(ScanCharFrequencyImpl);
HWY_EXPORT(IndexOfCaseInsensitiveImpl);
HWY_EXPORT(IndexOfSubstringImpl);
HWY_EXPORT(IndexOfCharImpl);
HWY_EXPORT(IndexOfInterestingCharacterInStringLiteralImpl);
} // namespace bun

// Define the C-callable wrappers that use HWY_DYNAMIC_DISPATCH.
// These need to be defined *after* the HWY_EXPORT block.
extern "C" {

IndexResult highway_find_chars(const uint8_t* HWY_RESTRICT text, size_t text_len,
    const uint8_t* HWY_RESTRICT chars, size_t chars_len)
{
    return HWY_DYNAMIC_DISPATCH(bun::IndexOfAnyCharImpl)(text, text_len, chars, chars_len);
}

void highway_char_frequency(const uint8_t* HWY_RESTRICT text, size_t text_len,
    int32_t* freqs, int32_t delta)
{
    HWY_DYNAMIC_DISPATCH(bun::ScanCharFrequencyImpl)(text, text_len, freqs, delta);
}

int32_t highway_find_substr_case_insensitive(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len,
    const uint8_t* HWY_RESTRICT needle, size_t needle_len)
{
    return HWY_DYNAMIC_DISPATCH(bun::IndexOfCaseInsensitiveImpl)(haystack, haystack_len, needle, needle_len);
}

int32_t highway_index_of_substring(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len,
    const uint8_t* HWY_RESTRICT needle, size_t needle_len)
{
    return HWY_DYNAMIC_DISPATCH(bun::IndexOfSubstringImpl)(haystack, haystack_len, needle, needle_len);
}

int64_t highway_index_of_char(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len,
    uint8_t needle)
{
    return HWY_DYNAMIC_DISPATCH(bun::IndexOfCharImpl)(haystack, haystack_len, needle);
}

size_t highway_index_of_interesting_character_in_string_literal(const uint8_t* HWY_RESTRICT text, size_t text_len, uint8_t quote)
{
    return HWY_DYNAMIC_DISPATCH(bun::IndexOfInterestingCharacterInStringLiteralImpl)(text, text_len, quote);
}

} // extern "C"

#endif // HWY_ONCE
