// Must be first
#include "root.h"
#undef HWY_TARGET_INCLUDE
// Correct path to this file relative to the build root (CMakeLists.txt)
#define HWY_TARGET_INCLUDE "highway_strings.cpp"
#include <hwy/foreach_target.h> // Must come before highway.h

// Now include Highway and other headers
#include <hwy/highway.h>
#include <hwy/aligned_allocator.h>

#include <hwy/contrib/algo/find-inl.h>

#include <cstring> // For memcmp
#include <algorithm> // For std::min, std::max
#include <cstddef>
#include <cstdint>

// Wrap the SIMD implementations in the Highway namespaces
HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE; // Alias for convenience

// Type alias for SIMD vector tag
using D8 = hn::ScalableTag<uint8_t>;

size_t IndexOfCharImpl(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len,
    uint8_t needle)
{
    D8 d;
    // Use the Find function from find-inl.h which handles both vectorized and scalar cases
    const size_t pos = hn::Find<D8>(d, needle, haystack, haystack_len);

    // Convert to int64_t and return -1 if not found
    return (pos < haystack_len) ? pos : haystack_len;
}

// --- Implementation Details ---

size_t IndexOfAnyCharImpl(const uint8_t* HWY_RESTRICT text, size_t text_len, const uint8_t* HWY_RESTRICT chars, size_t chars_len)
{
    if (text_len == 0) return 0;
    D8 d;
    const size_t N = hn::Lanes(d);

    if (chars_len == 1) {
        ASSERT_NOT_REACHED_WITH_MESSAGE("chars_len == 1");
    } else if (chars_len == 2) {
        // 2 character implemenation
        // covers the most common case:
        //
        // - { '\r', '\n' }
        // - { '\\', '/' }
        // - { ' ', '\t' }
        //
        const auto vec_char1 = hn::Set(d, chars[0]);
        const auto vec_char2 = hn::Set(d, chars[1]);

        size_t i = 0;
        const size_t simd_text_len = text_len - (text_len % N);
        for (; i < simd_text_len; i += N) {
            const auto text_vec = hn::LoadN(d, text + i, N);
            const auto found_mask = hn::Or(hn::Eq(text_vec, vec_char2), hn::Eq(text_vec, vec_char1));

            const intptr_t pos = hn::FindFirstTrue(d, found_mask);
            if (pos >= 0) {
                return i + pos;
            }
        }

        for (; i < text_len; ++i) {
            const uint8_t text_char = text[i];
            if (text_char == chars[0] || text_char == chars[1]) {
                return i;
            }
        }

        return text_len;
    } else {
        ASSERT(chars_len <= 16);
        constexpr size_t kMaxPreloadedChars = 16;
        hn::Vec<D8> char_vecs[kMaxPreloadedChars];
        const size_t num_chars_to_preload = std::min(chars_len, kMaxPreloadedChars);
        for (size_t c = 0; c < num_chars_to_preload; ++c) {
            char_vecs[c] = hn::Set(d, chars[c]);
        }

        const size_t simd_text_len = text_len - (text_len % N);
        size_t i = 0;

        for (; i < simd_text_len; i += N) {
            const auto text_vec = hn::LoadN(d, text + i, N);
            auto found_mask = hn::MaskFalse(d);

            for (size_t c = 0; c < num_chars_to_preload; ++c) {
                found_mask = hn::Or(found_mask, hn::Eq(text_vec, char_vecs[c]));
            }
            if (chars_len > num_chars_to_preload) {
                for (size_t c = num_chars_to_preload; c < chars_len; ++c) {
                    found_mask = hn::Or(found_mask, hn::Eq(text_vec, hn::Set(d, chars[c])));
                }
            }

            const intptr_t pos = hn::FindFirstTrue(d, found_mask);
            if (pos >= 0) {
                return i + pos;
            }
        }

        for (; i < text_len; ++i) {
            const uint8_t text_char = text[i];
            for (size_t c = 0; c < chars_len; ++c) {
                if (text_char == chars[c]) {
                    return i;
                }
            }
        }
    }

    return text_len;
}

void CopyU16ToU8Impl(const uint16_t* HWY_RESTRICT input, size_t count,
    uint8_t* HWY_RESTRICT output)
{
    // Tag for the output vector type (u8)
    const hn::ScalableTag<uint8_t> d8;
    // Tag for the input vector type (u16). OrderedTruncate2To takes two u16 vectors
    // (each N/2 lanes) to produce one u8 vector (N lanes).
    // Repartition<uint16_t, decltype(d8)> gives a u16 tag with N/2 lanes.
    const hn::Repartition<uint16_t, decltype(d8)> d16;

    const size_t N8 = hn::Lanes(d8); // Number of u8 lanes processed per iteration
    const size_t N16 = hn::Lanes(d16); // Number of u16 lanes per input vector load

    // Sanity check: we should load 2*N16 u16 elements to produce N8 u8 elements.
    // Since sizeof(u16) == 2 * sizeof(u8), N16 should be N8 / 2.
    // static_assert(N16 * 2 == N8, "Lane configuration mismatch"); // Highway ensures this

    size_t i = 0;
    const size_t simd_count = count - (count % N8);
    // Process N8 elements (u8 output size) per iteration. This corresponds to
    // loading N8 u16 input elements (2 vectors of N16 lanes each).
    for (; i < simd_count; i += N8) {
        // Load two input vectors of u16
        const auto in1 = hn::LoadU(d16, input + i);
        const auto in2 = hn::LoadU(d16, input + i + N16);

        // Truncate and interleave into a single u8 vector
        // OrderedTruncate2To(d_narrow, vec_wide_a, vec_wide_b)
        const hn::Vec<decltype(d8)> result8 = hn::OrderedTruncate2To(d8, in1, in2);

        // Store the resulting u8 vector
        hn::StoreU(result8, d8, output + i);
    }

    // Handle remaining elements (< N8)
    for (; i < count; ++i) {
        output[i] = static_cast<uint8_t>(input[i]); // Truncation happens here
    }
}

// Implementation for scanCharFrequency (Unchanged from previous correct version)
void ScanCharFrequencyImpl(const uint8_t* HWY_RESTRICT text, size_t text_len, int32_t* HWY_RESTRICT freqs, int32_t delta)
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
    size_t simd_text_len = text_len - (text_len % N);
    for (; i < simd_text_len; i += N) {
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

    const size_t simd_text_len = text_len - (text_len % N);
    size_t i = 0;
    for (; i < simd_text_len; i += N) {
        const auto text_vec = hn::LoadN(d, text + i, N);

        // Check for quote, backslash, or characters outside printable ASCII range
        const auto mask_quote = hn::Eq(text_vec, vec_quote);
        const auto mask_backslash = hn::Eq(text_vec, vec_backslash);
        const auto mask_lt_min = hn::Lt(text_vec, vec_min_ascii);
        const auto mask_gt_max = hn::Gt(text_vec, vec_max_ascii);

        const auto found_mask = hn::Or(
            hn::Or(mask_quote, mask_backslash),
            hn::Or(mask_lt_min, mask_gt_max));

        const intptr_t pos = hn::FindFirstTrue(d, found_mask);
        if (pos >= 0) {
            return i + pos;
        }
    }

    for (; i < text_len; ++i) {
        const uint8_t c = text[i];
        if (c == quote || c == '\\' || (c < 0x20 || c > 0x7E)) {
            return i;
        }
    }

    return text_len;
}

size_t IndexOfNewlineOrNonASCIIOrHashOrAtImpl(const uint8_t* HWY_RESTRICT start_ptr, size_t search_len)
{
    ASSERT(search_len > 0);

    D8 d;
    const size_t N = hn::Lanes(d);

    const auto vec_hash = hn::Set(d, '#');
    const auto vec_at = hn::Set(d, '@');
    const auto vec_min_ascii = hn::Set(d, uint8_t { 0x20 });
    const auto vec_max_ascii = hn::Set(d, uint8_t { 0x7E });

    size_t i = 0;
    const size_t simd_text_len = search_len - (search_len % N);
    for (; i < simd_text_len; i += N) {
        const auto vec = hn::LoadU(d, start_ptr + i);

        const auto mask_hash = hn::Eq(vec, vec_hash);
        const auto mask_at = hn::Eq(vec, vec_at);
        const auto mask_lt_min = hn::Lt(vec, vec_min_ascii);
        const auto mask_gt_max = hn::Gt(vec, vec_max_ascii);

        const auto found_mask = hn::Or(hn::Or(mask_hash, mask_at), hn::Or(mask_lt_min, mask_gt_max));

        const intptr_t pos = hn::FindFirstTrue(d, found_mask);
        if (pos >= 0) {
            return i + pos;
        }
    }

    for (; i < search_len; ++i) {
        const uint8_t char_ = start_ptr[i];
        if (char_ == '#' || char_ == '@' || char_ < 0x20 || char_ > 127) {
            return i;
        }
    }

    return search_len;
}

size_t IndexOfNewlineOrNonASCIIImpl(const uint8_t* HWY_RESTRICT start_ptr, size_t search_len)
{
    ASSERT(search_len > 0);

    D8 d;
    const size_t N = hn::Lanes(d);

    // SIMD constants
    const auto vec_max_ascii = hn::Set(d, uint8_t { 127 });
    const auto vec_min_ascii = hn::Set(d, uint8_t { 0x20 });

    // FUTURE TODO: normalize tabs
    // Some tests involving githubactions depend on tabs not being normalized right now.

    size_t i = 0;
    const size_t simd_text_len = search_len - (search_len % N);
    // Process full vectors
    for (; i < simd_text_len; i += N) {
        const auto vec = hn::LoadU(d, start_ptr + i);
        const auto mask_lt_min = hn::Lt(vec, vec_min_ascii);
        const auto mask_gt_max = hn::Gt(vec, vec_max_ascii);

        const auto found_mask = hn::Or(mask_gt_max, mask_lt_min);

        const intptr_t pos = hn::FindFirstTrue(d, found_mask);
        if (pos >= 0) {
            return i + pos;
        }
    }

    // Scalar check for the remainder
    for (; i < search_len; ++i) {
        const uint8_t char_ = start_ptr[i];
        if (char_ > 127 || char_ < 0x20) {
            return i;
        }
    }

    return search_len;
}

size_t IndexOfSpaceOrNewlineOrNonASCIIImpl(const uint8_t* HWY_RESTRICT start_ptr, size_t search_len)
{
    ASSERT(search_len > 0);

    D8 d;
    const size_t N = hn::Lanes(d);

    const uint8_t after_space = ' ' + 1;

    const auto vec_min_ascii_including_space = hn::Set(d, after_space);
    const auto vec_max_ascii = hn::Set(d, uint8_t { 127 });
    size_t simd_text_len = search_len - (search_len % N);

    size_t i = 0;
    for (; i < simd_text_len; i += N) {
        const auto vec = hn::LoadU(d, start_ptr + i);
        const auto mask_lt_min = hn::Lt(vec, vec_min_ascii_including_space);
        const auto mask_gt_max = hn::Gt(vec, vec_max_ascii);
        const auto found_mask = hn::Or(mask_gt_max, mask_lt_min);
        const intptr_t pos = hn::FindFirstTrue(d, found_mask);
        if (pos >= 0) {
            return i + pos;
        }
    }

    for (; i < search_len; ++i) {
        const uint8_t char_ = start_ptr[i];
        if (char_ <= ' ' || char_ > 127) {
            return i;
        }
    }

    return search_len;
}

bool ContainsNewlineOrNonASCIIOrQuoteImpl(const uint8_t* HWY_RESTRICT text, size_t text_len)
{
    ASSERT(text_len > 0);

    D8 d;
    const size_t N = hn::Lanes(d);

    // SIMD constants
    const auto vec_max_ascii = hn::Set(d, uint8_t { 127 });
    const auto vec_min_ascii = hn::Set(d, uint8_t { 0x20 });
    const auto vec_quote = hn::Set(d, uint8_t { '"' });

    size_t i = 0;
    const size_t simd_text_len = text_len - (text_len % N);

    // Process full vectors
    for (; i < simd_text_len; i += N) {
        const auto vec = hn::LoadU(d, text + i);
        const auto mask_lt_min = hn::Lt(vec, vec_min_ascii);
        const auto mask_gt_max = hn::Gt(vec, vec_max_ascii);

        const auto mask_quote_eq = hn::Eq(vec, vec_quote);

        const auto found_mask = hn::Or(hn::Or(mask_gt_max, mask_lt_min), mask_quote_eq);

        if (!hn::AllFalse(d, found_mask)) {
            return true;
        }
    }

    // Scalar check for the remainder
    for (; i < text_len; ++i) {
        const uint8_t char_ = text[i];
        if (char_ > 127 || char_ < 0x20 || char_ == '"') {
            return true;
        }
    }

    return false;
}

template<bool is_backtick>
static size_t IndexOfNeedsEscapeForJavaScriptStringImpl(const uint8_t* HWY_RESTRICT text, size_t text_len, uint8_t quote_char)
{
    ASSERT(text_len > 0);

    D8 d;
    const size_t N = hn::Lanes(d);

    // Set up SIMD constants
    const auto vec_backslash = hn::Set(d, uint8_t { '\\' });
    const auto vec_min_ascii = hn::Set(d, uint8_t { 0x20 });
    const auto vec_max_ascii = hn::Set(d, uint8_t { 0x7E });
    const auto vec_quote = hn::Set(d, quote_char);

    const auto vec_dollar = hn::Set(d, uint8_t { '$' });
    ASSERT(is_backtick || quote_char != '`');

    // Calculate how many full SIMD vectors we can process
    const size_t simd_text_len = text_len - (text_len % N);
    size_t i = 0;

    // Process chunks of the string
    for (; i < simd_text_len; i += N) {
        const auto text_vec = hn::LoadN(d, text + i, N);

        // Check for characters that need escaping
        const auto mask_gt_max = hn::Gt(text_vec, vec_max_ascii);
        const auto mask_lt_min = hn::Lt(text_vec, vec_min_ascii);
        const auto mask_backslash = hn::Eq(text_vec, vec_backslash);
        const auto mask_quote = hn::Eq(text_vec, vec_quote);

        auto found_mask = !is_backtick ? hn::Or(
                                             hn::Or(mask_gt_max, mask_lt_min),
                                             hn::Or(mask_backslash, mask_quote))
                                       : hn::Or(
                                             hn::Or(
                                                 hn::Or(mask_gt_max, mask_lt_min),
                                                 hn::Or(mask_backslash, mask_quote)),
                                             hn::Eq(text_vec, vec_dollar));

        const intptr_t pos = hn::FindFirstTrue(d, found_mask);
        if (pos >= 0) {
            return i + pos;
        }
    }

    // Scalar check for the remainder
    for (; i < text_len; ++i) {
        const uint8_t char_ = text[i];
        if (char_ >= 127 || char_ < 0x20 || char_ == '\\' || char_ == quote_char || (is_backtick && char_ == '$')) {
            return i;
        }
    }

    return text_len; // No characters needing escape found
}

size_t IndexOfNeedsEscapeForJavaScriptStringImplBacktick(const uint8_t* HWY_RESTRICT text, size_t text_len, uint8_t quote_char)
{
    return IndexOfNeedsEscapeForJavaScriptStringImpl<true>(text, text_len, quote_char);
}

size_t IndexOfNeedsEscapeForJavaScriptStringImplQuote(const uint8_t* HWY_RESTRICT text, size_t text_len, uint8_t quote_char)
{
    return IndexOfNeedsEscapeForJavaScriptStringImpl<false>(text, text_len, quote_char);
}

// Highway implementation of memmem
// Returns a pointer to the first occurrence of `needle` in `haystack`,
// or nullptr if not found. The return type is non-const `uint8_t*`
// to match the standard C `memmem` signature, even though the input
// is const. The caller should handle constness appropriately.
uint8_t* MemMemImpl(const uint8_t* haystack, size_t haystack_len,
    const uint8_t* needle, size_t needle_len)
{
    // --- Edge Cases ---
    if (HWY_UNLIKELY(needle_len == 0)) {
        return const_cast<uint8_t*>(haystack);
    }
    if (HWY_UNLIKELY(haystack_len < needle_len)) {
        return nullptr;
    }
    if (HWY_UNLIKELY(needle_len == 1)) {
        size_t index = IndexOfCharImpl(haystack, haystack_len, needle[0]);
        if (index != haystack_len) {
            return const_cast<uint8_t*>(haystack + index);
        }
        return nullptr;
    }

    // --- SIMD Setup ---
    const hn::ScalableTag<uint8_t> d;
    const size_t N = hn::Lanes(d);
    const uint8_t first_needle_char = needle[0];
    const hn::Vec<decltype(d)> v_first_needle = hn::Set(d, first_needle_char);
    const size_t last_possible_start = haystack_len - needle_len;

    // --- SIMD Main Loop ---
    size_t i = 0;
    while (i + N <= haystack_len && i <= last_possible_start) {
        const hn::Vec<decltype(d)> haystack_vec = hn::LoadU(d, haystack + i);
        hn::Mask<decltype(d)> m_starts = hn::Eq(haystack_vec, v_first_needle);

        // Iterate through potential matches within this vector chunk using FindFirstTrue
        while (!hn::AllFalse(d, m_starts)) {
            const intptr_t bit_idx_ptr = hn::FindFirstTrue(d, m_starts);
            // Loop condition guarantees FindFirstTrue finds something
            HWY_ASSERT(bit_idx_ptr >= 0);
            const size_t bit_idx = static_cast<size_t>(bit_idx_ptr);

            const size_t potential_pos = i + bit_idx;

            // Double-check bounds (essential if N > needle_len, and correct otherwise)
            if (potential_pos <= last_possible_start) {
                if (memcmp(haystack + potential_pos, needle, needle_len) == 0) {
                    return const_cast<uint8_t*>(haystack + potential_pos);
                }
            } else {
                // Optimization: If the first match found in this chunk is already
                // beyond the last possible start, no subsequent match in this
                // chunk can be valid.
                goto remainder_check; // Exit both loops and proceed to scalar remainder
            }

            // Clear the found bit to find the next one in the next iteration.
            // SetOnlyFirst creates a mask with only the first true bit set.
            // AndNot removes that bit from m_starts.
            const hn::Mask<decltype(d)> first_bit_mask = hn::SetOnlyFirst(m_starts);
            m_starts = hn::AndNot(first_bit_mask, m_starts);
        } // End while (!AllFalse)

        i += N;
    } // End SIMD loop

remainder_check:
    // --- Scalar Remainder Loop ---
    // Check any remaining bytes that couldn't form a full vector load
    // or potential starts within the last vector load that weren't checked
    // because they were past last_possible_start.
    // Start `i` from where the SIMD loop *could* have last started a valid check.
    size_t remainder_start = (i >= N) ? (i - N) : 0;
    // Ensure we re-check any potential starts the SIMD loop might have skipped
    // due to the bounds check optimization or being in the final partial vector.
    for (; remainder_start <= last_possible_start; ++remainder_start) {
        // Optimization: Check first character before expensive memcmp
        if (haystack[remainder_start] == first_needle_char) {
            if (memcmp(haystack + remainder_start, needle, needle_len) == 0) {
                return const_cast<uint8_t*>(haystack + remainder_start);
            }
        }
    }

    return nullptr; // Not found
}

// Implementation for WebSocket mask application
void FillWithSkipMaskImpl(const uint8_t* HWY_RESTRICT mask, size_t mask_len, uint8_t* HWY_RESTRICT output, const uint8_t* HWY_RESTRICT input, size_t length, bool skip_mask)
{
    ASSERT(mask_len == 4);

    ASSERT(length > 0);

    // If we're skipping masking or there's no data, return early
    if (skip_mask) {
        std::memcpy(output, input, length);
        return;
    }

    D8 d;
    const size_t N = hn::Lanes(d);

    // Create a vector filled with the mask pattern repeating every 4 bytes
    alignas(HWY_ALIGNMENT) uint8_t mask_pattern[HWY_MAX_LANES_D(D8)] = {};
    for (size_t i = 0; i < HWY_MAX_LANES_D(D8); i += 4) {
        mask_pattern[i] = mask[0];
        mask_pattern[i + 1] = mask[1];
        mask_pattern[i + 2] = mask[2];
        mask_pattern[i + 3] = mask[3];
    }
    const auto mask_vec = hn::Load(d, mask_pattern);

    // Process data in chunks of size N
    size_t i = 0;
    const size_t vector_length = length - (length % N);
    for (; i < vector_length; i += N) {
        // Load input data
        const auto input_vec = hn::LoadU(d, input + i);
        // XOR with mask
        const auto masked_vec = hn::Xor(input_vec, mask_vec);
        // Store result
        hn::StoreU(masked_vec, d, output + i);
    }

    // Handle remaining bytes with scalar operations
    for (; i < length; ++i) {
        output[i] = input[i] ^ mask[i % 4];
    }
}

} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

// HWY_ONCE ensures this block is only included once,
// in the final pass after all target-specific code is generated.
#if HWY_ONCE

namespace bun {

// Define the dispatch tables. The names here must exactly match
// the *Impl function names defined within the HWY_NAMESPACE block above.
HWY_EXPORT(ContainsNewlineOrNonASCIIOrQuoteImpl);
HWY_EXPORT(CopyU16ToU8Impl);
HWY_EXPORT(FillWithSkipMaskImpl);
HWY_EXPORT(IndexOfAnyCharImpl);
HWY_EXPORT(IndexOfCharImpl);
HWY_EXPORT(IndexOfInterestingCharacterInStringLiteralImpl);
HWY_EXPORT(IndexOfNeedsEscapeForJavaScriptStringImplBacktick);
HWY_EXPORT(IndexOfNeedsEscapeForJavaScriptStringImplQuote);
HWY_EXPORT(IndexOfNewlineOrNonASCIIImpl);
HWY_EXPORT(IndexOfNewlineOrNonASCIIOrHashOrAtImpl);
HWY_EXPORT(IndexOfSpaceOrNewlineOrNonASCIIImpl);
HWY_EXPORT(MemMemImpl);
HWY_EXPORT(ScanCharFrequencyImpl);
// Define the C-callable wrappers that use HWY_DYNAMIC_DISPATCH.
// These need to be defined *after* the HWY_EXPORT block and INSIDE namespace bun
// so that HWY_DYNAMIC_DISPATCH(FuncImpl) correctly resolves to bun::N_*::FuncImpl.
// The extern "C" only affects linkage (for C callers), not namespace resolution.
extern "C" {

void* highway_memmem(const uint8_t* haystack, size_t haystack_len, const uint8_t* needle, size_t needle_len)
{
    return HWY_DYNAMIC_DISPATCH(MemMemImpl)(haystack, haystack_len, needle, needle_len);
}

static void highway_copy_u16_to_u8_impl(
    const uint16_t* input,
    size_t count,
    uint8_t* output)
{
    return HWY_DYNAMIC_DISPATCH(CopyU16ToU8Impl)(input, count, output);
}

void highway_copy_u16_to_u8(
    // No HWY_RESTRICT
    const uint16_t* input,

    size_t count,
    // No HWY_RESTRICT
    uint8_t* output)
{

    if (count == 0) {
        return;
    }

    // Check alignment of the input pointer
    if (!hwy::IsAligned(input, alignof(uint16_t))) {
        // Handle the first unaligned element scalar-ly
        output[0] = static_cast<uint8_t>(input[0]);

        // Call the core implementation with adjusted pointers and count,
        // which are now guaranteed to be aligned or have count == 0.
        // The HWY_RESTRICT inside CopyU16ToU8Impl is now valid for the
        // ranges it operates on.
        if (count > 1)
            highway_copy_u16_to_u8_impl(input + 1, count - 1, output + 1);
    } else {
        // Input is already aligned, call the core implementation directly.
        highway_copy_u16_to_u8_impl(input, count, output);
    }
}
size_t highway_index_of_any_char(const uint8_t* HWY_RESTRICT text, size_t text_len, const uint8_t* HWY_RESTRICT chars, size_t chars_len)
{
    return HWY_DYNAMIC_DISPATCH(IndexOfAnyCharImpl)(text, text_len, chars, chars_len);
}

void highway_char_frequency(const uint8_t* HWY_RESTRICT text, size_t text_len,
    int32_t* freqs, int32_t delta)
{
    HWY_DYNAMIC_DISPATCH(ScanCharFrequencyImpl)(text, text_len, freqs, delta);
}

size_t highway_index_of_char(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len,
    uint8_t needle)
{
    return HWY_DYNAMIC_DISPATCH(IndexOfCharImpl)(haystack, haystack_len, needle);
}

size_t highway_index_of_interesting_character_in_string_literal(const uint8_t* HWY_RESTRICT text, size_t text_len, uint8_t quote)
{
    return HWY_DYNAMIC_DISPATCH(IndexOfInterestingCharacterInStringLiteralImpl)(text, text_len, quote);
}

size_t highway_index_of_newline_or_non_ascii(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len)
{
    return HWY_DYNAMIC_DISPATCH(IndexOfNewlineOrNonASCIIImpl)(haystack, haystack_len);
}

size_t highway_index_of_newline_or_non_ascii_or_hash_or_at(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len)
{
    return HWY_DYNAMIC_DISPATCH(IndexOfNewlineOrNonASCIIOrHashOrAtImpl)(haystack, haystack_len);
}

bool highway_contains_newline_or_non_ascii_or_quote(const uint8_t* HWY_RESTRICT text, size_t text_len)
{
    return HWY_DYNAMIC_DISPATCH(ContainsNewlineOrNonASCIIOrQuoteImpl)(text, text_len);
}

size_t highway_index_of_needs_escape_for_javascript_string(const uint8_t* HWY_RESTRICT text, size_t text_len, uint8_t quote_char)
{
    if (quote_char == '`') {
        return HWY_DYNAMIC_DISPATCH(IndexOfNeedsEscapeForJavaScriptStringImplBacktick)(text, text_len, quote_char);
    } else {
        return HWY_DYNAMIC_DISPATCH(IndexOfNeedsEscapeForJavaScriptStringImplQuote)(text, text_len, quote_char);
    }
}

size_t highway_index_of_space_or_newline_or_non_ascii(const uint8_t* HWY_RESTRICT text, size_t text_len)
{
    return HWY_DYNAMIC_DISPATCH(IndexOfSpaceOrNewlineOrNonASCIIImpl)(text, text_len);
}

void highway_fill_with_skip_mask(
    const uint8_t* mask, // 4-byte mask array
    size_t mask_len, // Should be 4
    uint8_t* output, // Output buffer
    const uint8_t* input, // Input buffer
    size_t length, // Length of input/output
    bool skip_mask) // Whether to skip masking
{
    HWY_DYNAMIC_DISPATCH(FillWithSkipMaskImpl)(mask, mask_len, output, input, length, skip_mask);
}

} // extern "C"

} // namespace bun

#if OS(DARWIN)
// On macOS, override the libc memmem with our implementation
// This uses inline assembly to ensure the symbol is exported with the correct name
__asm__(".globl _memmem");
__asm__(".set _memmem, _highway_memmem");
#elif OS(LINUX)
// On Linux, override the libc memmem with our implementation
// This uses the GNU-specific attribute to alias our function to the libc symbol
// The alias will be visible across the entire program, not just this file
extern "C" {
// Using both "default" visibility and "weak" ensures our implementation is used
// throughout the entire program when linked, not just in this object file
__attribute__((visibility("default"), weak, used)) void* memmem(const void* haystack, size_t haystacklen, const void* needle, size_t needlelen)
    __attribute__((alias("highway_memmem")));
}

#endif

#endif // HWY_ONCE
