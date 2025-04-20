// Must be first
#undef HWY_TARGET_INCLUDE
// Correct path to this file relative to the build root (CMakeLists.txt)
#define HWY_TARGET_INCLUDE "highway_strings.cpp"
#include <hwy/foreach_target.h> // Must come before highway.h

// Now include Highway and other headers
#include <hwy/highway.h>
#include <hwy/aligned_allocator.h>

// Include the C API header for IndexResult struct definition
#include "highway_bindings.h"

#include <cstring> // For memcmp
#include <algorithm> // For std::min
#include <cstddef>
#include <cstdint>
#include <cassert> // For assert (use HWY_ASSERT for Highway asserts)

// Wrap the SIMD implementations in the Highway namespaces
HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE; // Alias for convenience

// --- Implementation Details ---

// Helper function to lowercase ASCII character using Highway
hn::Vec<hn::ScalableTag<uint8_t>> ToLower(hn::ScalableTag<uint8_t> d, hn::Vec<hn::ScalableTag<uint8_t>> c)
{
    const auto vec_A = hn::Set(d, 'A');
    const auto vec_Z = hn::Set(d, 'Z');
    const auto mask_upper = hn::And(hn::Ge(c, vec_A), hn::Le(c, vec_Z));
    const auto lower = hn::Add(c, hn::Set(d, uint8_t { 32 })); // 'a' - 'A'
    return hn::IfThenElse(mask_upper, lower, c);
}

// --- *Impl Function Definitions ---
// (These contain the actual Highway SIMD logic)

// Implementation for indexOfAnyChar
IndexResult IndexOfAnyCharImpl(const uint8_t* text, size_t text_len, const uint8_t* chars, size_t chars_len)
{
    if (text_len == 0 || chars_len == 0) return { -1, 0 };

    using D = hn::ScalableTag<uint8_t>;
    D d;
    const size_t N = hn::Lanes(d);

    if (chars_len == 1) {
        const auto needle_vec = hn::Set(d, chars[0]);
        for (size_t i = 0; i < text_len; i += N) {
            const size_t current_batch_size = std::min(N, text_len - i);
            const auto text_vec = hn::LoadN(d, text + i, current_batch_size); // LoadN handles remainder safely
            const auto eq_mask = hn::Eq(text_vec, needle_vec);
            intptr_t pos = hn::FindFirstTrue(d, eq_mask);
            if (pos >= 0 && static_cast<size_t>(pos) < current_batch_size) {
                return { static_cast<int32_t>(i + pos), 1 };
            }
            if (current_batch_size != N) break;
        }
    } else {
        constexpr size_t kMaxPreloadedChars = 16;
        hn::Vec<D> char_vecs[kMaxPreloadedChars];
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

// Implementation for scanCharFrequency
void ScanCharFrequencyImpl(const uint8_t* text, size_t text_len, int32_t* freqs, int32_t delta)
{
    if (text_len == 0 || delta == 0) return;

    using D = hn::ScalableTag<uint8_t>;
    D d;
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
    for (; i + N <= text_len; i += N) {
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

        alignas(HWY_ALIGNMENT) uint8_t indices_array[HWY_MAX_LANES_D(D)];
        alignas(HWY_ALIGNMENT) uint8_t valid_bits_array[(HWY_MAX_LANES_D(D) + 7) / 8];

        hn::Store(indices_vec, d, indices_array);
        hn::StoreMaskBits(d, valid_mask, valid_bits_array);

        for (size_t j = 0; j < N; ++j) {
            if ((valid_bits_array[j / 8] >> (j % 8)) & 1) {
                assert(indices_array[j] < 64);
                freqs[indices_array[j]] += delta;
            }
        }
    }

    // Remainder
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

// Implementation for case-insensitive substring search
int32_t IndexOfCaseInsensitiveImpl(const uint8_t* haystack, size_t haystack_len,
    const uint8_t* needle, size_t needle_len)
{
    if (needle_len == 0) return 0;
    if (haystack_len < needle_len) return -1;

    using D = hn::ScalableTag<uint8_t>;
    D d;
    const size_t N = hn::Lanes(d);

    uint8_t first_needle_lower = needle[0];
    if (first_needle_lower >= 'A' && first_needle_lower <= 'Z') {
        first_needle_lower += ('a' - 'A');
    }
    const auto vec_first_needle_lower = hn::Set(d, first_needle_lower);

    const size_t max_pos = haystack_len - needle_len;

    for (size_t i = 0; i <= max_pos; ++i) {
        uint8_t first_haystack = haystack[i];
        if (first_haystack >= 'A' && first_haystack <= 'Z') {
            first_haystack += ('a' - 'A');
        }

        if (first_haystack == first_needle_lower) {
            bool match = true;
            for (size_t k = 1; k < needle_len; ++k) {
                uint8_t h_char = haystack[i + k];
                uint8_t n_char = needle[k];
                if (h_char >= 'A' && h_char <= 'Z') h_char += ('a' - 'A');
                if (n_char >= 'A' && n_char <= 'Z') n_char += ('a' - 'A');
                if (h_char != n_char) {
                    match = false;
                    break;
                }
            }
            if (match) {
                return static_cast<int32_t>(i);
            }
        }

        // SIMD skip optimization
        if (i + N <= max_pos + 1) {
            const size_t search_len = std::min(N, max_pos + 1 - (i + 1));
            if (search_len > 0) {
                const auto haystack_vec = hn::LoadN(d, haystack + i + 1, search_len);
                const auto haystack_lower_vec = ToLower(d, haystack_vec);
                const auto eq_mask = hn::Eq(haystack_lower_vec, vec_first_needle_lower);
                intptr_t next_potential_start_offset = hn::FindFirstTrue(d, eq_mask);

                if (next_potential_start_offset >= 0 && static_cast<size_t>(next_potential_start_offset) < search_len) {
                    i += static_cast<size_t>(next_potential_start_offset);
                } else {
                    i += (N - 1);
                }
            }
        }
    }
    return -1;
}

// Implementation for finding interesting characters in string literals
int32_t IndexOfInterestingCharImpl(const uint8_t* text, size_t text_len, uint8_t quote_type)
{
    if (text_len == 0) return -1;

    using D = hn::ScalableTag<uint8_t>;
    D d;
    const size_t N = hn::Lanes(d);

    const auto vec_quote = hn::Set(d, quote_type);
    const auto vec_bslash = hn::Set(d, '\\');
    const auto vec_lt_space = hn::Set(d, uint8_t { 0x1F });
    const auto vec_dollar = hn::Set(d, '$');
    const auto vec_del = hn::Set(d, uint8_t { 0x7F });

    const bool is_template_literal = (quote_type == '`');

    for (size_t i = 0; i < text_len; i += N) {
        const size_t current_batch_size = std::min(N, text_len - i);
        const auto text_vec = hn::LoadN(d, text + i, current_batch_size);

        const auto mask_quote = hn::Eq(text_vec, vec_quote);
        const auto mask_bslash = hn::Eq(text_vec, vec_bslash);
        const auto mask_control = hn::Or(hn::Le(text_vec, vec_lt_space), hn::Eq(text_vec, vec_del));

        auto found_mask = hn::Or(mask_quote, hn::Or(mask_bslash, mask_control));

        if (is_template_literal) {
            const auto mask_dollar = hn::Eq(text_vec, vec_dollar);
            found_mask = hn::Or(found_mask, mask_dollar);
        }

        intptr_t pos = hn::FindFirstTrue(d, found_mask);
        if (pos >= 0 && static_cast<size_t>(pos) < current_batch_size) {
            return static_cast<int32_t>(i + pos);
        }
        if (current_batch_size != N) break;
    }
    return -1;
}

// Implementation for finding a substring
int32_t IndexOfSubstringImpl(const uint8_t* haystack, size_t haystack_len,
    const uint8_t* needle, size_t needle_len)
{
    if (needle_len == 0) return 0;
    if (haystack_len < needle_len) return -1;

    using D = hn::ScalableTag<uint8_t>;
    D d;
    const size_t N = hn::Lanes(d);

    const uint8_t first_needle_char = needle[0];
    const auto vec_first_needle = hn::Set(d, first_needle_char);

    const size_t max_pos = haystack_len - needle_len;

    for (size_t i = 0; i <= max_pos; ++i) {
        if (haystack[i] == first_needle_char) {
            if (memcmp(haystack + i, needle, needle_len) == 0) {
                return static_cast<int32_t>(i);
            }
        }

        // SIMD skip optimization
        if (i + N <= max_pos + 1) {
            const size_t search_len = std::min(N, max_pos + 1 - (i + 1));
            if (search_len > 0) {
                const auto haystack_vec = hn::LoadN(d, haystack + i + 1, search_len);
                const auto eq_mask = hn::Eq(haystack_vec, vec_first_needle);
                intptr_t next_potential_start_offset = hn::FindFirstTrue(d, eq_mask);

                if (next_potential_start_offset >= 0 && static_cast<size_t>(next_potential_start_offset) < search_len) {
                    i += static_cast<size_t>(next_potential_start_offset);
                } else {
                    i += (N - 1);
                }
            }
        }
    }
    return -1;
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
// These need to be at namespace scope for external linkage.
HWY_EXPORT(IndexOfAnyCharImpl);
HWY_EXPORT(ScanCharFrequencyImpl);
HWY_EXPORT(IndexOfCaseInsensitiveImpl);
HWY_EXPORT(IndexOfInterestingCharImpl);
HWY_EXPORT(IndexOfSubstringImpl);

} // namespace bun

// Define the C-callable wrappers that use HWY_DYNAMIC_DISPATCH.
// These need to be defined *after* the HWY_EXPORT block.
extern "C" {

IndexResult highway_find_chars(const uint8_t* text, size_t text_len,
    const uint8_t* chars, size_t chars_len)
{
    return HWY_DYNAMIC_DISPATCH(bun::IndexOfAnyCharImpl)(text, text_len, chars, chars_len);
}

void highway_char_frequency(const uint8_t* text, size_t text_len,
    int32_t* freqs, int32_t delta)
{
    HWY_DYNAMIC_DISPATCH(bun::ScanCharFrequencyImpl)(text, text_len, freqs, delta);
}

int32_t highway_find_substr_case_insensitive(const uint8_t* haystack, size_t haystack_len,
    const uint8_t* needle, size_t needle_len)
{
    return HWY_DYNAMIC_DISPATCH(bun::IndexOfCaseInsensitiveImpl)(haystack, haystack_len, needle, needle_len);
}

int32_t highway_index_of_interesting_char(const uint8_t* text, size_t text_len,
    uint8_t quote_type)
{
    return HWY_DYNAMIC_DISPATCH(bun::IndexOfInterestingCharImpl)(text, text_len, quote_type);
}

int32_t highway_index_of_substring(const uint8_t* haystack, size_t haystack_len,
    const uint8_t* needle, size_t needle_len)
{
    return HWY_DYNAMIC_DISPATCH(bun::IndexOfSubstringImpl)(haystack, haystack_len, needle, needle_len);
}

} // extern "C"

#endif // HWY_ONCE
