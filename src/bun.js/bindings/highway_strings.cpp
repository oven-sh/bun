// Must be first
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
#include <cassert> // For assert (use HWY_ASSERT for Highway asserts)
#include <limits> // For std::numeric_limits

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
        // - \r\n
        // - {'\\', '/' }
        const auto vec_char1 = hn::Set(d, chars[0]);
        const auto vec_char2 = hn::Set(d, chars[1]);

        size_t i = 0;
        const size_t simd_text_len = text_len - (text_len % N);
        for (; i < simd_text_len; i += N) {
            const auto text_vec = hn::LoadN(d, text + i, N);
            auto found_mask = hn::MaskFalse(d);

            found_mask = hn::Or(found_mask, hn::Eq(text_vec, vec_char1));
            found_mask = hn::Or(found_mask, hn::Eq(text_vec, vec_char2));

            intptr_t pos = hn::FindFirstTrue(d, found_mask);
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

            intptr_t pos = hn::FindFirstTrue(d, found_mask);
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

// Implementation function called by the dispatcher
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

        intptr_t pos = hn::FindFirstTrue(d, found_mask);
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

// Implementation for indexOfNewlineOrNonASCII
// Returns the 0-based index relative to the start of the *original* string (before offset)
// Returns -1 if not found.
int64_t IndexOfNewlineOrNonASCIIImpl(const uint8_t* HWY_RESTRICT start_ptr, size_t search_len)
{
    if (search_len == 0) {
        return -1;
    }

    D8 d;
    const size_t N = hn::Lanes(d);

    // SIMD constants
    const auto vec_max_ascii = hn::Set(d, uint8_t { 127 });
    const auto vec_min_ascii = hn::Set(d, uint8_t { 0x20 });
    const auto vec_cr = hn::Set(d, uint8_t { '\r' });
    const auto vec_nl = hn::Set(d, uint8_t { '\n' });

    size_t i = 0;
    const size_t simd_text_len = search_len - (search_len % N);
    // Process full vectors
    for (; i < simd_text_len; i += N) {
        const auto vec = hn::LoadU(d, start_ptr + i);

        const auto mask_gt_max = hn::Gt(vec, vec_max_ascii);
        const auto mask_lt_min = hn::Lt(vec, vec_min_ascii);
        const auto mask_cr_eq = hn::Eq(vec, vec_cr);
        const auto mask_nl_eq = hn::Eq(vec, vec_nl);

        const auto found_mask = hn::Or(hn::Or(mask_gt_max, mask_lt_min), hn::Or(mask_cr_eq, mask_nl_eq));

        intptr_t pos = hn::FindFirstTrue(d, found_mask);
        if (pos >= 0) {
            return static_cast<int64_t>(i + pos);
        }
    }

    // Scalar check for the remainder
    for (; i < search_len; ++i) {
        const uint8_t char_ = start_ptr[i];
        if (char_ > 127 || char_ < 0x20 || char_ == '\n' || char_ == '\r') {
            return static_cast<int64_t>(i);
        }
    }

    return -1;
}

// Implementation for indexOfNewlineOrNonASCIIOrANSI
// Returns the 0-based index relative to the start of the *original* string (before offset)
// Returns -1 if not found.
int64_t IndexOfNewlineOrNonASCIIOrANSIImpl(const uint8_t* HWY_RESTRICT start_ptr, size_t search_len)
{
    if (search_len == 0) {
        return -1;
    }

    D8 d;
    const size_t N = hn::Lanes(d);

    // SIMD constants
    const auto vec_max_ascii = hn::Set(d, uint8_t { 127 });
    const auto vec_min_ascii = hn::Set(d, uint8_t { 0x20 });
    const auto vec_cr = hn::Set(d, uint8_t { '\r' });
    const auto vec_nl = hn::Set(d, uint8_t { '\n' });
    const auto vec_esc = hn::Set(d, uint8_t { '\x1b' }); // ANSI escape code

    size_t i = 0;
    const size_t simd_text_len = search_len - (search_len % N);
    // Process full vectors
    for (; i < simd_text_len; i += N) {
        const auto vec = hn::LoadU(d, start_ptr + i);

        const auto mask_gt_max = hn::Gt(vec, vec_max_ascii);
        const auto mask_lt_min = hn::Lt(vec, vec_min_ascii);
        const auto mask_cr_eq = hn::Eq(vec, vec_cr);
        const auto mask_nl_eq = hn::Eq(vec, vec_nl);
        const auto mask_esc_eq = hn::Eq(vec, vec_esc);

        const auto found_mask = hn::Or(
            hn::Or(hn::Or(mask_gt_max, mask_lt_min), hn::Or(mask_cr_eq, mask_nl_eq)),
            mask_esc_eq);

        intptr_t pos = hn::FindFirstTrue(d, found_mask);
        if (pos >= 0) {
            // Return index relative to start_ptr
            return static_cast<int64_t>(i + pos);
        }
    }

    // Scalar check for the remainder
    for (; i < search_len; ++i) {
        const uint8_t char_ = start_ptr[i];
        if (char_ > 127 || char_ < 0x20 || char_ == '\n' || char_ == '\r' || char_ == '\x1b') {
            // Return index relative to start_ptr
            return static_cast<int64_t>(i);
        }
    }

    return -1;
}

// Implementation to check if a string contains newlines, non-ASCII characters, or quotes
bool ContainsNewlineOrNonASCIIOrQuoteImpl(const uint8_t* HWY_RESTRICT text, size_t text_len)
{
    ASSERT(text_len > 0);

    D8 d;
    const size_t N = hn::Lanes(d);

    // SIMD constants
    const auto vec_max_ascii = hn::Set(d, uint8_t { 127 });
    const auto vec_min_ascii = hn::Set(d, uint8_t { 0x20 });
    const auto vec_cr = hn::Set(d, uint8_t { '\r' });
    const auto vec_nl = hn::Set(d, uint8_t { '\n' });
    const auto vec_quote = hn::Set(d, uint8_t { '"' });

    size_t i = 0;
    const size_t simd_text_len = text_len - (text_len % N);

    // Process full vectors
    for (; i < simd_text_len; i += N) {
        const auto vec = hn::LoadU(d, text + i);

        const auto mask_gt_max = hn::Gt(vec, vec_max_ascii);
        const auto mask_lt_min = hn::Lt(vec, vec_min_ascii);
        const auto mask_cr_eq = hn::Eq(vec, vec_cr);
        const auto mask_nl_eq = hn::Eq(vec, vec_nl);
        const auto mask_quote_eq = hn::Eq(vec, vec_quote);

        const auto found_mask = hn::Or(
            hn::Or(hn::Or(mask_gt_max, mask_lt_min),
                hn::Or(mask_cr_eq, mask_nl_eq)),
            mask_quote_eq);

        if (!hn::AllFalse(d, found_mask)) {
            return true;
        }
    }

    // Scalar check for the remainder
    for (; i < text_len; ++i) {
        const uint8_t char_ = text[i];
        if (char_ > 127 || char_ < 0x20 || char_ == '\n' || char_ == '\r' || char_ == '"') {
            return true;
        }
    }

    return false;
}

// Implementation for indexOfNeedsEscapeForJavaScriptString
template<bool is_backtick>
static size_t IndexOfNeedsEscapeForJavaScriptStringImpl(const uint8_t* HWY_RESTRICT text, size_t text_len, uint8_t quote_char)
{
    ASSERT(text_len > 0);

    D8 d;
    const size_t N = hn::Lanes(d);

    // Set up SIMD constants
    const auto vec_backslash = hn::Set(d, uint8_t { '\\' });
    const auto vec_min_ascii = hn::Set(d, uint8_t { 0x20 });
    const auto vec_max_ascii = hn::Set(d, uint8_t { 127 });
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

        intptr_t pos = hn::FindFirstTrue(d, found_mask);
        if (pos >= 0) {
            return i + pos;
        }
    }

    // Scalar check for the remainder
    for (; i < text_len; ++i) {
        const uint8_t char_ = text[i];
        if (char_ >= 127 || char_ < 0x20 || char_ == '\\' || char_ == quote_char || (quote_char == '`' && char_ == '$')) {
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
HWY_EXPORT(IndexOfCharImpl);
HWY_EXPORT(IndexOfInterestingCharacterInStringLiteralImpl);
HWY_EXPORT(IndexOfNewlineOrNonASCIIImpl);
HWY_EXPORT(IndexOfNewlineOrNonASCIIOrANSIImpl);
HWY_EXPORT(ContainsNewlineOrNonASCIIOrQuoteImpl);
HWY_EXPORT(IndexOfNeedsEscapeForJavaScriptStringImplBacktick);
HWY_EXPORT(IndexOfNeedsEscapeForJavaScriptStringImplQuote);
HWY_EXPORT(CopyU16ToU8Impl);

} // namespace bun

// Define the C-callable wrappers that use HWY_DYNAMIC_DISPATCH.
// These need to be defined *after* the HWY_EXPORT block.
extern "C" {

static void highway_copy_u16_to_u8_impl(
    const uint16_t* input,
    size_t count,
    uint8_t* output)
{
    return HWY_DYNAMIC_DISPATCH(bun::CopyU16ToU8Impl)(input, count, output);
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
    return HWY_DYNAMIC_DISPATCH(bun::IndexOfAnyCharImpl)(text, text_len, chars, chars_len);
}

void highway_char_frequency(const uint8_t* HWY_RESTRICT text, size_t text_len,
    int32_t* freqs, int32_t delta)
{
    HWY_DYNAMIC_DISPATCH(bun::ScanCharFrequencyImpl)(text, text_len, freqs, delta);
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

int64_t highway_index_of_newline_or_non_ascii(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len)
{
    return HWY_DYNAMIC_DISPATCH(bun::IndexOfNewlineOrNonASCIIImpl)(haystack, haystack_len);
}

// Wrapper for IndexOfNewlineOrNonASCIIOrANSIImpl
// Returns the 0-based index relative to `haystack`, or -1 if not found.
int64_t highway_index_of_newline_or_non_ascii_or_ansi(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len)
{
    return HWY_DYNAMIC_DISPATCH(bun::IndexOfNewlineOrNonASCIIOrANSIImpl)(haystack, haystack_len);
}

bool highway_contains_newline_or_non_ascii_or_quote(const uint8_t* HWY_RESTRICT text, size_t text_len)
{
    return HWY_DYNAMIC_DISPATCH(bun::ContainsNewlineOrNonASCIIOrQuoteImpl)(text, text_len);
}

size_t highway_index_of_needs_escape_for_javascript_string(const uint8_t* HWY_RESTRICT text, size_t text_len, uint8_t quote_char)
{
    if (quote_char == '`') {
        return HWY_DYNAMIC_DISPATCH(bun::IndexOfNeedsEscapeForJavaScriptStringImplBacktick)(text, text_len, quote_char);
    } else {
        return HWY_DYNAMIC_DISPATCH(bun::IndexOfNeedsEscapeForJavaScriptStringImplQuote)(text, text_len, quote_char);
    }
}

} // extern "C"

#endif // HWY_ONCE
