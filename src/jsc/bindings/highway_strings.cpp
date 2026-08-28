// Must be first
#include "root.h"
#undef HWY_TARGET_INCLUDE
// Correct path to this file relative to the build root (CMakeLists.txt)
#define HWY_TARGET_INCLUDE "highway_strings.cpp"
#include <hwy/foreach_target.h> // Must come before highway.h

// Now include Highway and other headers
#include <hwy/highway.h>
#include "highway_dispatch.h"
#include <hwy/aligned_allocator.h>

#include <hwy/contrib/algo/find-inl.h>

#include <bit>
#include <cstring> // For memcmp
#include <algorithm> // For std::min, std::max
#include <cstddef>
#include <cstdint>

// The scalar half of Bun.stringWidth's ANSI-aware width count. This file is
// re-included once per SIMD target; the guard keeps a single copy, compiled with
// the translation unit's own (baseline) flags rather than a target's.
#ifndef BUN_HIGHWAY_STRINGS_ANSI_SCALAR
#define BUN_HIGHWAY_STRINGS_ANSI_SCALAR
namespace bun {

// --- Visible Latin-1 width with ANSI escape sequences excluded -------------
//
// Used by Bun.stringWidth's default mode (stringWidth.cpp). Escape sequences
// contribute nothing to the width:
//   CSI       (ESC [ | 0x9B) <params> <final in [0x40,0x7E]>
//   OSC       (ESC ] | 0x9D) <payload> (BEL | 0x9C | ESC \)
//   DCS etc.  (ESC (P|X|^|_) | 0x90 | 0x98 | 0x9E | 0x9F) <payload> (0x9C | ESC \)
//   nF        ESC <0x20-0x2F> <one byte>
//   Fe/Fs/Fp  ESC <0x30-0x7E>
//   ESC followed by anything else: only the ESC itself is dropped.
// An in-progress sequence aborts as in the VT500 state machine: ESC introduces
// a new sequence, CAN (0x18) / SUB (0x1A) / C1 ST (0x9C) return to ground (byte
// consumed).
//
// The whole input is processed in a single pass: every vector chunk is
// classified once into bitmasks (printable, ESC, CSI final byte, OSC
// terminator) and escape regions are carved out of the printable mask with a
// few scalar bit operations per escape. This keeps dense SGR input (an escape
// every few bytes) from paying a separate scan per sequence, while chunks with
// no escapes reduce to one popcount. Sequences may straddle chunk boundaries;
// the state enum below carries "inside CSI/OSC" across chunks.
//
// ESC [ (CSI) and ESC ] (OSC) are the hot forms, resolved from those bitmasks
// inline; everything else — including the 8-bit C1 introducers, which terminal
// output almost never carries — goes through AnsiSequenceEnd().

enum class AnsiExcludeState : uint8_t {
    None,
    InCSI, // saw ESC [ or 0x9B — looking for the final byte in [0x40, 0x7E]
    InOSC, // saw ESC ] or 0x9D — looking for BEL, 0x9C or ESC-backslash (ST)
};

// End of a string payload starting at `from`: C1 ST (0x9C), ESC \, or an
// aborting CAN/SUB, plus BEL for OSC (the control strings DCS/SOS/PM/APC do
// not terminate on BEL). Any other ESC aborts the payload and re-introduces a
// sequence, so it is left for the caller (returns its index).
template<bool BelTerminates>
static size_t StringPayloadEnd(const uint8_t* input, size_t len, size_t from)
{
    for (size_t k = from; k < len; k++) {
        const uint8_t c = input[k];
        if (c == 0x9C || c == 0x18 || c == 0x1A || (BelTerminates && c == 0x07))
            return k + 1;
        if (c == 0x1B)
            return (k + 1 < len && input[k + 1] == '\\') ? k + 2 : k;
    }
    return len;
}

// End of a CSI sequence whose parameters start at `from`: the first byte in
// [0x40, 0x7E], an aborting CAN/SUB/C1 ST (consumed) or ESC (left for the
// caller).
static size_t CsiEnd(const uint8_t* input, size_t len, size_t from)
{
    for (size_t k = from; k < len; k++) {
        const uint8_t c = input[k];
        if (c == 0x1B)
            return k;
        if ((c >= 0x40 && c <= 0x7E) || c == 0x18 || c == 0x1A || c == 0x9C)
            return k + 1;
    }
    return len;
}

// True for the bytes that introduce an escape sequence: ESC and the six 8-bit
// C1 introducers (0x9B CSI, 0x9D OSC, 0x90 DCS, 0x98 SOS, 0x9E PM, 0x9F APC).
static inline bool IsAnsiIntroducer(uint8_t c)
{
    return c == 0x1B || c == 0x9B || c == 0x9D || c == 0x90 || c == 0x98 || c == 0x9E || c == 0x9F;
}

// Index just past the escape sequence starting at `pos`, `pos + 1` when
// `input[pos]` introduces nothing (a stray byte in 0x90-0x9F), or the index of
// an ESC that aborted the sequence (that ESC starts the next one). Scalar mirror
// of ANSI::consumeANSI() in ANSIHelpers.h — this TU is re-included once per SIMD
// target, so it cannot include that header; stringWidth.test.ts cross-checks
// the two on random escape-heavy input.
static size_t AnsiSequenceEnd(const uint8_t* input, size_t len, size_t pos)
{
    switch (input[pos]) {
    case 0x9B:
        return CsiEnd(input, len, pos + 1);
    case 0x9D:
        return StringPayloadEnd<true>(input, len, pos + 1);
    case 0x90:
    case 0x98:
    case 0x9E:
    case 0x9F:
        return StringPayloadEnd<false>(input, len, pos + 1);
    case 0x1B:
        break;
    default:
        return pos + 1;
    }

    if (pos + 1 >= len)
        return len; // trailing ESC

    const uint8_t next = input[pos + 1];
    if (next == '[')
        return CsiEnd(input, len, pos + 2);
    if (next == ']')
        return StringPayloadEnd<true>(input, len, pos + 2);
    // DCS, SOS, PM, APC: payload, then ST (0x9C or ESC backslash).
    if (next == 'P' || next == 'X' || next == '^' || next == '_')
        return StringPayloadEnd<false>(input, len, pos + 2);
    // CAN/SUB/C1 ST abort the escape to ground and are themselves consumed.
    if (next == 0x18 || next == 0x1A || next == 0x9C)
        return pos + 2;
    // ECMA-48, 5th ed. §5.3: 0x20-0x2F is an intermediate byte (the nF
    // sequences) followed by the final byte, and 0x30-0x7E is the final byte of
    // a two-byte escape. An ESC in place of the nF final byte aborts and
    // re-introduces a sequence, so it is left for the caller.
    if (next >= 0x20 && next <= 0x2F)
        return (pos + 2 < len && input[pos + 2] == 0x1B) ? pos + 2 : std::min(pos + 3, len);
    if (next >= 0x30 && next <= 0x7E)
        return pos + 2;
    // A second ESC re-introduces the sequence, and nothing else can continue
    // one. Either way only this ESC is consumed, and ESC is zero-width.
    return pos + 1;
}

// Bits [0, k) set; tolerates k == 64.
static inline uint64_t MaskBitsBelow(size_t k)
{
    return k >= 64 ? ~uint64_t { 0 } : ((uint64_t { 1 } << k) - 1);
}

// Defined in the HWY_ONCE block (BufferStringSearch.h).
template<typename Char>
size_t MemMemTwoWayFallback(const Char* haystack, size_t haystack_len,
    const Char* needle, size_t needle_len, size_t start_index, bool is_forward);

// Two anchor offsets for the SIMD substring filter: the needle's two
// least-frequent bytes (ranked by low byte for uint16_t; the filter compares
// full lanes), first tie earliest / second tie latest, so any distinguishing
// byte anywhere in the needle is picked.
template<typename Char>
static inline void MemMemPickAnchors(const Char* needle, size_t needle_len, size_t* a, size_t* b)
{
    // Short needles: first/last is as selective and skips the 1 KiB zero-init;
    // the false-positive budget still bounds total work.
    if (needle_len <= 16) {
        *a = 0;
        *b = needle_len - 1;
        return;
    }

    auto bucket = [](Char c) -> uint8_t { return static_cast<uint8_t>(c); };

    uint32_t histogram[256] = {};
    for (size_t i = 0; i < needle_len; i++)
        histogram[bucket(needle[i])]++;

    size_t p0 = 0;
    uint32_t best = histogram[bucket(needle[0])];
    for (size_t i = 1; i < needle_len; i++) {
        uint32_t h = histogram[bucket(needle[i])];
        if (h < best) {
            best = h;
            p0 = i;
        }
    }

    size_t p1 = (p0 == needle_len - 1) ? 0 : needle_len - 1;
    uint32_t best2 = histogram[bucket(needle[p1])];
    for (size_t i = 0; i < needle_len; i++) {
        if (i == p0) continue;
        uint32_t h = histogram[bucket(needle[i])];
        if (h < best2 || (h == best2 && i > p1)) {
            best2 = h;
            p1 = i;
        }
    }

    *a = std::min(p0, p1);
    *b = std::max(p0, p1);
}

} // namespace bun
#endif // BUN_HIGHWAY_STRINGS_ANSI_SCALAR

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

// Index of the last `needle` in `haystack`, or haystack_len if absent.
size_t LastIndexOfCharImpl(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len,
    uint8_t needle)
{
    D8 d;
    const size_t N = hn::Lanes(d);
    const auto broadcasted = hn::Set(d, needle);

    size_t i = haystack_len;
    // Two vectors per iteration: one mask→scalar transfer (the expensive part on
    // NEON) per 2N bytes instead of per N.
    while (i >= 2 * N) {
        i -= 2 * N;
        const auto eq_hi = hn::Eq(broadcasted, hn::LoadU(d, haystack + i + N));
        const auto eq_lo = hn::Eq(broadcasted, hn::LoadU(d, haystack + i));
        if (HWY_UNLIKELY(!hn::AllFalse(d, hn::Or(eq_hi, eq_lo)))) {
            const intptr_t hi = hn::FindLastTrue(d, eq_hi);
            if (hi >= 0) return i + N + static_cast<size_t>(hi);
            return i + hn::FindKnownLastTrue(d, eq_lo);
        }
    }
    if (i >= N) {
        i -= N;
        const intptr_t pos = hn::FindLastTrue(d, hn::Eq(broadcasted, hn::LoadU(d, haystack + i)));
        if (pos >= 0) return i + static_cast<size_t>(pos);
    }
    // Remaining prefix [0, i); fewer than N bytes.
    while (i-- > 0) {
        if (haystack[i] == needle) return i;
    }
    return haystack_len;
}

// Index of the first byte that is NOT `value`, or haystack_len if every byte is `value`.
size_t IndexOfNotCharImpl(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len,
    uint8_t value)
{
    D8 d;
    const size_t N = hn::Lanes(d);
    const auto broadcasted = hn::Set(d, value);

    size_t i = 0;
    if (haystack_len >= N) {
        for (; i <= haystack_len - N; i += N) {
            const intptr_t pos = hn::FindFirstTrue(d, hn::Ne(broadcasted, hn::LoadU(d, haystack + i)));
            if (pos >= 0) return i + static_cast<size_t>(pos);
        }
    }
    for (; i < haystack_len; ++i) {
        if (haystack[i] != value) return i;
    }
    return haystack_len;
}

size_t CountCharImpl(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len, uint8_t needle)
{
    D8 d;
    const hn::Repartition<uint64_t, D8> d64;
    const size_t N = hn::Lanes(d);
    const auto broadcasted = hn::Set(d, needle);

    size_t count = 0;
    size_t i = 0;
    while (haystack_len - i >= N) {
        // Per-lane u8 counters: an Eq lane is 0xFF (-1), so subtracting the mask
        // vector adds 1 per match. Flush every <=255 vectors so no lane overflows.
        const size_t block_end = i + HWY_MIN((haystack_len - i) / N, size_t { 255 }) * N;
        auto acc = hn::Zero(d);
        for (; i < block_end; i += N) {
            acc = hn::Sub(acc, hn::VecFromMask(d, hn::Eq(broadcasted, hn::LoadU(d, haystack + i))));
        }
        count += static_cast<size_t>(hn::ReduceSum(d64, hn::SumsOf8(acc)));
    }
    for (; i < haystack_len; ++i) {
        count += haystack[i] == needle ? 1 : 0;
    }
    return count;
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

        const size_t simd_text_len = text_len - (text_len % N);
        size_t i = 0;

#if !HWY_HAVE_SCALABLE && !HWY_TARGET_IS_SVE
        // Preload search characters into native-width vectors.
        // On non-SVE targets, Vec has a known size and can be stored in arrays.
        static constexpr size_t kMaxPreloadedChars = 16;
        hn::Vec<D8> char_vecs[kMaxPreloadedChars];
        const size_t num_chars_to_preload = std::min(chars_len, kMaxPreloadedChars);
        for (size_t c = 0; c < num_chars_to_preload; ++c) {
            char_vecs[c] = hn::Set(d, chars[c]);
        }

        for (; i < simd_text_len; i += N) {
            const auto text_vec = hn::LoadN(d, text + i, N);
            auto found_mask = hn::MaskFalse(d);

            for (size_t c = 0; c < num_chars_to_preload; ++c) {
                found_mask = hn::Or(found_mask, hn::Eq(text_vec, char_vecs[c]));
            }
#else
        // SVE types are sizeless and cannot be stored in arrays.
        // hn::Set is a single broadcast instruction; the compiler will
        // hoist these loop-invariant broadcasts out of the outer loop.
        for (; i < simd_text_len; i += N) {
            const auto text_vec = hn::LoadN(d, text + i, N);
            auto found_mask = hn::MaskFalse(d);

            for (size_t c = 0; c < chars_len; ++c) {
                found_mask = hn::Or(found_mask, hn::Eq(text_vec, hn::Set(d, chars[c])));
            }
#endif

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

// Reverse of IndexOfAnyCharImpl: index of the last byte in `text` that is any of
// `chars[0..chars_len]` (chars_len in 2..=16), or text_len if none are present.
size_t LastIndexOfAnyCharImpl(const uint8_t* HWY_RESTRICT text, size_t text_len, const uint8_t* HWY_RESTRICT chars, size_t chars_len)
{
    ASSERT(chars_len >= 2 && chars_len <= 16);
    D8 d;
    const size_t N = hn::Lanes(d);
    // Callers split larger sets; clamp so a bad length can never overrun char_vecs.
    chars_len = std::min(chars_len, size_t { 16 });

    size_t i = text_len;
#if !HWY_HAVE_SCALABLE && !HWY_TARGET_IS_SVE
    // Preload the set into registers (same scheme as IndexOfAnyCharImpl).
    hn::Vec<D8> char_vecs[16];
    for (size_t c = 0; c < chars_len; ++c) {
        char_vecs[c] = hn::Set(d, chars[c]);
    }
    while (i >= N) {
        i -= N;
        const auto text_vec = hn::LoadU(d, text + i);
        auto found_mask = hn::Or(hn::Eq(text_vec, char_vecs[0]), hn::Eq(text_vec, char_vecs[1]));
        for (size_t c = 2; c < chars_len; ++c) {
            found_mask = hn::Or(found_mask, hn::Eq(text_vec, char_vecs[c]));
        }
#else
    // SVE vectors are sizeless and cannot be stored in arrays; broadcast per use.
    while (i >= N) {
        i -= N;
        const auto text_vec = hn::LoadU(d, text + i);
        auto found_mask = hn::Or(hn::Eq(text_vec, hn::Set(d, chars[0])), hn::Eq(text_vec, hn::Set(d, chars[1])));
        for (size_t c = 2; c < chars_len; ++c) {
            found_mask = hn::Or(found_mask, hn::Eq(text_vec, hn::Set(d, chars[c])));
        }
#endif
        const intptr_t pos = hn::FindLastTrue(d, found_mask);
        if (pos >= 0) return i + static_cast<size_t>(pos);
    }
    // Remaining prefix [0, i); fewer than N bytes.
    while (i-- > 0) {
        const uint8_t text_char = text[i];
        for (size_t c = 0; c < chars_len; ++c) {
            if (text_char == chars[c]) return i;
        }
    }
    return text_len;
}

// Index of the first byte that HTML-escapes: one of " & ' < >.
// Returns text_len if none are present.
size_t IndexOfHTMLEscapeChar8Impl(const uint8_t* HWY_RESTRICT text, size_t text_len)
{
    if (text_len == 0) return 0;
    D8 d;
    const size_t N = hn::Lanes(d);

    const auto vec_quot = hn::Set(d, uint8_t { '"' });
    const auto vec_amp = hn::Set(d, uint8_t { '&' });
    const auto vec_apos = hn::Set(d, uint8_t { '\'' });
    const auto vec_lt = hn::Set(d, uint8_t { '<' });
    const auto vec_gt = hn::Set(d, uint8_t { '>' });

    size_t i = 0;
    const size_t simd_text_len = text_len - (text_len % N);
    for (; i < simd_text_len; i += N) {
        const auto text_vec = hn::LoadU(d, text + i);
        const auto found_mask = hn::Or(
            hn::Or(hn::Eq(text_vec, vec_quot), hn::Eq(text_vec, vec_amp)),
            hn::Or(hn::Eq(text_vec, vec_apos), hn::Or(hn::Eq(text_vec, vec_lt), hn::Eq(text_vec, vec_gt))));

        const intptr_t pos = hn::FindFirstTrue(d, found_mask);
        if (pos >= 0) {
            return i + pos;
        }
    }

    for (; i < text_len; ++i) {
        const uint8_t c = text[i];
        if (c == '"' || c == '&' || c == '\'' || c == '<' || c == '>') {
            return i;
        }
    }

    return text_len;
}

// Index of the first UTF-16 code unit that HTML-escapes: one of " & ' < >.
// Returns text_len if none are present. The five metacharacters are all < 0x80,
// so no surrogate code unit (0xD800-0xDFFF) can collide with them — non-ASCII
// text with no metacharacters is reported as "nothing to escape", and the
// escape loop can copy every non-metacharacter code unit through verbatim.
size_t IndexOfHTMLEscapeChar16Impl(const uint16_t* HWY_RESTRICT text, size_t text_len)
{
    if (text_len == 0) return 0;
    using D16 = hn::ScalableTag<uint16_t>;
    D16 d;
    const size_t N = hn::Lanes(d);

    const auto vec_quot = hn::Set(d, uint16_t { '"' });
    const auto vec_amp = hn::Set(d, uint16_t { '&' });
    const auto vec_apos = hn::Set(d, uint16_t { '\'' });
    const auto vec_lt = hn::Set(d, uint16_t { '<' });
    const auto vec_gt = hn::Set(d, uint16_t { '>' });

    size_t i = 0;
    const size_t simd_text_len = text_len - (text_len % N);
    for (; i < simd_text_len; i += N) {
        const auto text_vec = hn::LoadU(d, text + i);
        const auto found_mask = hn::Or(
            hn::Or(hn::Eq(text_vec, vec_quot), hn::Eq(text_vec, vec_amp)),
            hn::Or(hn::Eq(text_vec, vec_apos), hn::Or(hn::Eq(text_vec, vec_lt), hn::Eq(text_vec, vec_gt))));

        const intptr_t pos = hn::FindFirstTrue(d, found_mask);
        if (pos >= 0) {
            return i + pos;
        }
    }

    for (; i < text_len; ++i) {
        const uint16_t c = text[i];
        if (c == '"' || c == '&' || c == '\'' || c == '<' || c == '>') {
            return i;
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

// Extra bytes the HTML-escaped output needs beyond the input length: each
// metacharacter's entity is longer than its 1 source byte, by
//   & -> &amp;   (+4)    < -> &lt;   (+3)    > -> &gt;   (+3)
//   " -> &quot;  (+5)    ' -> &#x27; (+5)
// so escaped_len == input_len + HtmlEscapeExtraLen(input). Summing per
// metacharacter class with CountTrue keeps this a single pass, letting the
// caller allocate the exact output size.
size_t HtmlEscapeExtraLen8Impl(const uint8_t* HWY_RESTRICT text, size_t text_len)
{
    D8 d;
    const size_t N = hn::Lanes(d);

    const auto vec_quot = hn::Set(d, uint8_t { '"' });
    const auto vec_amp = hn::Set(d, uint8_t { '&' });
    const auto vec_apos = hn::Set(d, uint8_t { '\'' });
    const auto vec_lt = hn::Set(d, uint8_t { '<' });
    const auto vec_gt = hn::Set(d, uint8_t { '>' });

    size_t extra = 0;
    size_t i = 0;
    const size_t simd_text_len = text_len - (text_len % N);
    for (; i < simd_text_len; i += N) {
        const auto v = hn::LoadU(d, text + i);
        extra += 4 * hn::CountTrue(d, hn::Eq(v, vec_amp));
        extra += 3 * hn::CountTrue(d, hn::Or(hn::Eq(v, vec_lt), hn::Eq(v, vec_gt)));
        extra += 5 * hn::CountTrue(d, hn::Or(hn::Eq(v, vec_quot), hn::Eq(v, vec_apos)));
    }

    for (; i < text_len; ++i) {
        switch (text[i]) {
        case '&':
            extra += 4;
            break;
        case '<':
        case '>':
            extra += 3;
            break;
        case '"':
        case '\'':
            extra += 5;
            break;
        default:
            break;
        }
    }

    return extra;
}

// UTF-16 counterpart of HtmlEscapeExtraLen8Impl. Surrogate code units are all
// > 0x80 and cannot match the metacharacters, so they contribute 0.
size_t HtmlEscapeExtraLen16Impl(const uint16_t* HWY_RESTRICT text, size_t text_len)
{
    using D16 = hn::ScalableTag<uint16_t>;
    D16 d;
    const size_t N = hn::Lanes(d);

    const auto vec_quot = hn::Set(d, uint16_t { '"' });
    const auto vec_amp = hn::Set(d, uint16_t { '&' });
    const auto vec_apos = hn::Set(d, uint16_t { '\'' });
    const auto vec_lt = hn::Set(d, uint16_t { '<' });
    const auto vec_gt = hn::Set(d, uint16_t { '>' });

    size_t extra = 0;
    size_t i = 0;
    const size_t simd_text_len = text_len - (text_len % N);
    for (; i < simd_text_len; i += N) {
        const auto v = hn::LoadU(d, text + i);
        extra += 4 * hn::CountTrue(d, hn::Eq(v, vec_amp));
        extra += 3 * hn::CountTrue(d, hn::Or(hn::Eq(v, vec_lt), hn::Eq(v, vec_gt)));
        extra += 5 * hn::CountTrue(d, hn::Or(hn::Eq(v, vec_quot), hn::Eq(v, vec_apos)));
    }

    for (; i < text_len; ++i) {
        switch (text[i]) {
        case '&':
            extra += 4;
            break;
        case '<':
        case '>':
            extra += 3;
            break;
        case '"':
        case '\'':
            extra += 5;
            break;
        default:
            break;
        }
    }

    return extra;
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

// Scans the body of a `/* ... */` block comment for the next byte the lexer
// must inspect one code point at a time: `*` (potential `*/` terminator),
// `\r` / `\n` (newline tracking for ASI), or any non-ASCII byte (so U+2028 /
// U+2029 and other multi-byte sequences are decoded by the scalar path).
size_t IndexOfInterestingCharacterInMultilineCommentImpl(const uint8_t* HWY_RESTRICT text, size_t text_len)
{
    ASSERT(text_len > 0);

    D8 d;
    const size_t N = hn::Lanes(d);

    const auto vec_star = hn::Set(d, '*');
    const auto vec_carriage = hn::Set(d, '\r');
    const auto vec_newline = hn::Set(d, '\n');
    const auto vec_max_ascii = hn::Set(d, uint8_t { 127 });

    size_t i = 0;
    const size_t simd_text_len = text_len - (text_len % N);
    for (; i < simd_text_len; i += N) {
        const auto vec = hn::LoadU(d, text + i);

        const auto mask_star = hn::Eq(vec, vec_star);
        const auto mask_carriage = hn::Eq(vec, vec_carriage);
        const auto mask_newline = hn::Eq(vec, vec_newline);
        const auto mask_non_ascii = hn::Gt(vec, vec_max_ascii);

        const auto found_mask = hn::Or(hn::Or(mask_star, mask_non_ascii), hn::Or(mask_carriage, mask_newline));

        const intptr_t pos = hn::FindFirstTrue(d, found_mask);
        if (pos >= 0) {
            return i + pos;
        }
    }

    for (; i < text_len; ++i) {
        const uint8_t char_ = text[i];
        if (char_ == '*' || char_ == '\r' || char_ == '\n' || char_ > 127) {
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

// --- Substring search (memmem / memrmem, 8- and 16-bit) --------------------
//
// Two-anchor SIMD filter: the vector at candidate + one anchor is compared
// first (one load per N starts while nothing matches); only blocks with a hit
// also load the other anchor, and only positions where both rare bytes
// (MemMemPickAnchors) line up are memcmp'd. A false-positive budget bounds
// memcmp work at ~2·|haystack| bytes and hands the remainder to
// MemMemTwoWayFallback for a linear worst case.
static constexpr size_t kNotFound = ~static_cast<size_t>(0);
static constexpr size_t kFallback = ~static_cast<size_t>(1);

template<typename T>
static HWY_INLINE bool LoadEq(const uint8_t* a, const uint8_t* b)
{
    T x, y;
    memcpy(&x, a, sizeof(T));
    memcpy(&y, b, sizeof(T));
    return x == y;
}

// Candidate verification. Short needles are compared with overlapping scalar
// loads that stay inside [a, a+n): glibc's EVEX memcmp uses a masked 32-byte
// load for n < 32, which takes a microcode assist whenever the masked-off
// tail reaches into a non-resident page (a match at the end of a buffer).
template<typename Char>
static HWY_INLINE bool MemMemVerify(const Char* haystack, size_t pos, const Char* needle, size_t needle_len)
{
    const uint8_t* a = reinterpret_cast<const uint8_t*>(haystack + pos);
    const uint8_t* b = reinterpret_cast<const uint8_t*>(needle);
    const size_t n = needle_len * sizeof(Char);
    if (n >= 32) return memcmp(a, b, n) == 0;
    if (n >= 16) return LoadEq<uint64_t>(a, b) && LoadEq<uint64_t>(a + 8, b + 8) && LoadEq<uint64_t>(a + n - 16, b + n - 16) && LoadEq<uint64_t>(a + n - 8, b + n - 8);
    if (n >= 8) return LoadEq<uint64_t>(a, b) && LoadEq<uint64_t>(a + n - 8, b + n - 8);
    if (n >= 4) return LoadEq<uint32_t>(a, b) && LoadEq<uint32_t>(a + n - 4, b + n - 4);
    if (n >= 2) return LoadEq<uint16_t>(a, b) && LoadEq<uint16_t>(a + n - 2, b + n - 2);
    return n == 0 || a[0] == b[0];
}

// One filter step over the N candidate starts [i, i+N), ignoring the first
// `skip` (already covered by the previous block when the tail block overlaps).
template<class D, typename Char = hn::TFromD<D>>
static HWY_INLINE size_t MemMemBlockForward(D d, const Char* haystack, size_t i, size_t skip,
    const Char* needle, size_t needle_len, size_t anchor_a, size_t anchor_b,
    hn::Vec<D> va, hn::Vec<D> vb, size_t* budget, size_t* resume)
{
    const auto eq_a = hn::Eq(hn::LoadU(d, haystack + i + anchor_a), va);
    if (HWY_LIKELY(hn::AllFalse(d, eq_a))) return kNotFound;
    auto mask = hn::And(eq_a, hn::Eq(hn::LoadU(d, haystack + i + anchor_b), vb));
    mask = hn::AndNot(hn::FirstN(d, skip), mask);
    while (!hn::AllFalse(d, mask)) {
        const size_t pos = i + static_cast<size_t>(hn::FindKnownFirstTrue(d, mask));
        if (MemMemVerify(haystack, pos, needle, needle_len)) return pos;
        if (HWY_UNLIKELY(*budget <= needle_len)) {
            *resume = pos + 1;
            return kFallback;
        }
        *budget -= needle_len;
        mask = hn::AndNot(hn::SetOnlyFirst(mask), mask);
    }
    return kNotFound;
}

// As above, last match first; only the first `valid` lanes are candidates.
template<class D, typename Char = hn::TFromD<D>>
static HWY_INLINE size_t MemMemBlockReverse(D d, const Char* haystack, size_t i, size_t valid,
    const Char* needle, size_t needle_len, size_t anchor_a, size_t anchor_b,
    hn::Vec<D> va, hn::Vec<D> vb, size_t* budget, size_t* resume)
{
    const auto eq_b = hn::Eq(hn::LoadU(d, haystack + i + anchor_b), vb);
    if (HWY_LIKELY(hn::AllFalse(d, eq_b))) return kNotFound;
    auto mask = hn::And(eq_b, hn::Eq(hn::LoadU(d, haystack + i + anchor_a), va));
    mask = hn::And(mask, hn::FirstN(d, valid));
    while (!hn::AllFalse(d, mask)) {
        const size_t lane = hn::FindKnownLastTrue(d, mask);
        const size_t pos = i + lane;
        if (MemMemVerify(haystack, pos, needle, needle_len)) return pos;
        if (HWY_UNLIKELY(*budget <= needle_len)) {
            *resume = pos == 0 ? 0 : pos - 1;
            return kFallback;
        }
        *budget -= needle_len;
        mask = hn::And(mask, hn::FirstN(d, lane));
    }
    return kNotFound;
}

// Requires end (= number of candidate starts) >= Lanes(d): the last block
// overlaps the one before it (already-tested lanes masked off) instead of
// leaving a scalar tail. Every lane's start < end, so both anchor loads are
// in bounds.
template<bool kForward, class D, typename Char = hn::TFromD<D>>
static HWY_INLINE size_t MemMemSearchVec(D d, const Char* haystack, size_t end,
    const Char* needle, size_t needle_len, size_t anchor_a, size_t anchor_b,
    size_t* budget, size_t* resume)
{
    const size_t N = hn::Lanes(d);
    const auto va = hn::Set(d, needle[anchor_a]);
    const auto vb = hn::Set(d, needle[anchor_b]);
    if constexpr (kForward) {
        size_t i = 0;
        for (; i + N <= end; i += N) {
            size_t r = MemMemBlockForward(d, haystack, i, 0, needle, needle_len, anchor_a, anchor_b, va, vb, budget, resume);
            if (r != kNotFound) return r;
        }
        if (i < end) {
            return MemMemBlockForward(d, haystack, end - N, i - (end - N), needle, needle_len, anchor_a, anchor_b, va, vb, budget, resume);
        }
    } else {
        size_t i = end;
        while (i >= N) {
            i -= N;
            size_t r = MemMemBlockReverse(d, haystack, i, N, needle, needle_len, anchor_a, anchor_b, va, vb, budget, resume);
            if (r != kNotFound) return r;
        }
        if (i > 0) {
            return MemMemBlockReverse(d, haystack, 0, i, needle, needle_len, anchor_a, anchor_b, va, vb, budget, resume);
        }
    }
    return kNotFound;
}

// First (kForward) or last start of `needle` in `haystack`, kNotFound, or
// kFallback with *resume set once the false-positive budget is spent.
// Requires 1 <= needle_len <= haystack_len.
template<bool kForward, typename Char>
static size_t MemMemSearch(const Char* haystack, size_t haystack_len,
    const Char* needle, size_t needle_len,
    size_t anchor_a, size_t anchor_b, size_t* resume)
{
    size_t budget = haystack_len * 2 + needle_len * 32;
    const size_t end = haystack_len - needle_len + 1;

    const hn::ScalableTag<Char> d;
    if (end >= hn::Lanes(d))
        return MemMemSearchVec<kForward>(d, haystack, end, needle, needle_len, anchor_a, anchor_b, &budget, resume);
    const hn::CappedTag<Char, 16 / sizeof(Char)> d128;
    if (end >= hn::Lanes(d128))
        return MemMemSearchVec<kForward>(d128, haystack, end, needle, needle_len, anchor_a, anchor_b, &budget, resume);

    for (size_t k = 0; k < end; ++k) {
        const size_t i = kForward ? k : end - 1 - k;
        if (haystack[i + anchor_a] == needle[anchor_a] && haystack[i + anchor_b] == needle[anchor_b]) {
            if (MemMemVerify(haystack, i, needle, needle_len)) return i;
            if (HWY_UNLIKELY(budget <= needle_len)) {
                *resume = kForward ? i + 1 : (i == 0 ? 0 : i - 1);
                return kFallback;
            }
            budget -= needle_len;
        }
    }
    return kNotFound;
}

// Highway implementation of memmem
// Returns a pointer to the first occurrence of `needle` in `haystack`,
// or nullptr if not found. The return type is non-const `uint8_t*`
// to match the standard C `memmem` signature, even though the input
// is const. The caller should handle constness appropriately.
uint8_t* MemMemImpl(const uint8_t* haystack, size_t haystack_len,
    const uint8_t* needle, size_t needle_len)
{
    if (HWY_UNLIKELY(needle_len == 0)) return const_cast<uint8_t*>(haystack);
    if (HWY_UNLIKELY(haystack_len < needle_len)) return nullptr;
    if (HWY_UNLIKELY(needle_len == 1)) {
        size_t index = IndexOfCharImpl(haystack, haystack_len, needle[0]);
        return index != haystack_len ? const_cast<uint8_t*>(haystack + index) : nullptr;
    }

    size_t a, b;
    bun::MemMemPickAnchors(needle, needle_len, &a, &b);
    size_t resume = 0;
    size_t pos = MemMemSearch<true, uint8_t>(haystack, haystack_len, needle, needle_len, a, b, &resume);
    if (pos == kNotFound) return nullptr;
    if (HWY_UNLIKELY(pos == kFallback)) {
        pos = bun::MemMemTwoWayFallback<uint8_t>(haystack, haystack_len, needle, needle_len, resume, true);
        return pos == haystack_len ? nullptr : const_cast<uint8_t*>(haystack + pos);
    }
    return const_cast<uint8_t*>(haystack + pos);
}

size_t MemRMemImpl(const uint8_t* haystack, size_t haystack_len,
    const uint8_t* needle, size_t needle_len)
{
    if (HWY_UNLIKELY(needle_len == 0)) return haystack_len;
    if (HWY_UNLIKELY(haystack_len < needle_len)) return kNotFound;
    if (HWY_UNLIKELY(needle_len == 1)) {
        size_t index = LastIndexOfCharImpl(haystack, haystack_len, needle[0]);
        return index != haystack_len ? index : kNotFound;
    }

    size_t a, b;
    bun::MemMemPickAnchors(needle, needle_len, &a, &b);
    size_t resume = 0;
    size_t pos = MemMemSearch<false, uint8_t>(haystack, haystack_len, needle, needle_len, a, b, &resume);
    if (HWY_UNLIKELY(pos == kFallback)) {
        pos = bun::MemMemTwoWayFallback<uint8_t>(haystack, haystack_len, needle, needle_len, resume, false);
        return pos == haystack_len ? kNotFound : pos;
    }
    return pos;
}

size_t MemMem16Impl(const uint16_t* haystack, size_t haystack_len,
    const uint16_t* needle, size_t needle_len)
{
    if (HWY_UNLIKELY(needle_len == 0)) return 0;
    if (HWY_UNLIKELY(haystack_len < needle_len)) return kNotFound;

    size_t a, b;
    if (needle_len == 1) {
        a = b = 0;
    } else {
        bun::MemMemPickAnchors(needle, needle_len, &a, &b);
    }
    size_t resume = 0;
    size_t pos = MemMemSearch<true, uint16_t>(haystack, haystack_len, needle, needle_len, a, b, &resume);
    if (HWY_UNLIKELY(pos == kFallback)) {
        pos = bun::MemMemTwoWayFallback<uint16_t>(haystack, haystack_len, needle, needle_len, resume, true);
        return pos == haystack_len ? kNotFound : pos;
    }
    return pos;
}

size_t MemRMem16Impl(const uint16_t* haystack, size_t haystack_len,
    const uint16_t* needle, size_t needle_len)
{
    if (HWY_UNLIKELY(needle_len == 0)) return haystack_len;
    if (HWY_UNLIKELY(haystack_len < needle_len)) return kNotFound;

    size_t a, b;
    if (needle_len == 1) {
        a = b = 0;
    } else {
        bun::MemMemPickAnchors(needle, needle_len, &a, &b);
    }
    size_t resume = 0;
    size_t pos = MemMemSearch<false, uint16_t>(haystack, haystack_len, needle, needle_len, a, b, &resume);
    if (HWY_UNLIKELY(pos == kFallback)) {
        pos = bun::MemMemTwoWayFallback<uint16_t>(haystack, haystack_len, needle, needle_len, resume, false);
        return pos == haystack_len ? kNotFound : pos;
    }
    return pos;
}

// Count of "visible" Latin-1 bytes for Bun.stringWidth (stringWidth.cpp):
// everything except C0 controls (0x00-0x1F), DEL + C1 controls (0x7F-0x9F)
// and soft hyphen (0xAD) occupies one terminal column.
size_t VisibleLatin1WidthImpl(const uint8_t* HWY_RESTRICT input, size_t len)
{
    D8 d;
    const size_t N = hn::Lanes(d);

    const auto vec_0x20 = hn::Set(d, uint8_t { 0x20 });
    const auto vec_0x5E = hn::Set(d, uint8_t { 0x5E });
    const auto vec_0x7F = hn::Set(d, uint8_t { 0x7F });
    const auto vec_soft_hyphen = hn::Set(d, uint8_t { 0xAD });

    size_t count = 0;
    size_t i = 0;
    const size_t simd_len = len - (len % N);
    for (; i < simd_len; i += N) {
        const auto chunk = hn::LoadU(d, input + i);

        // ASCII fast path: a single range compare per chunk. If every byte is
        // plain printable ASCII ([0x20, 0x7E]), the whole chunk is visible.
        const auto not_plain_ascii = hn::Gt(hn::Sub(chunk, vec_0x20), vec_0x5E);
        if (hn::AllFalse(d, not_plain_ascii)) {
            count += N;
            continue;
        }

        // Mixed chunk: visible = (c >= 0x20) && !(0x7F <= c <= 0x9F) && (c != 0xAD)
        const auto ge_0x20 = hn::Ge(chunk, vec_0x20);
        const auto in_c1_range = hn::Le(hn::Sub(chunk, vec_0x7F), vec_0x20); // 0x7F..0x9F
        const auto is_soft_hyphen = hn::Eq(chunk, vec_soft_hyphen);
        const auto visible = hn::AndNot(hn::Or(in_c1_range, is_soft_hyphen), ge_0x20);
        count += hn::CountTrue(d, visible);
    }

    for (; i < len; ++i) {
        const uint8_t c = input[i];
        count += (c >= 0x20 && !(c >= 0x7F && c <= 0x9F) && c != 0xAD) ? 1 : 0;
    }
    return count;
}

// Zero-width Latin-1 bytes: C0 controls, DEL + C1 controls, soft hyphen.
static HWY_INLINE bool IsVisibleLatin1Byte(uint8_t c)
{
    return c >= 0x20 && !(c >= 0x7F && c <= 0x9F) && c != 0xAD;
}

// Scalar escape-aware width count for short inputs and chunk tails. `state`
// is the sequence carried in from the vector loop, finished here first; the
// rest defers to AnsiSequenceEnd(), the same recognizer the vector loop's
// cold path uses.
static HWY_INLINE size_t VisibleLatin1WidthExcludeANSIScalar(const uint8_t* HWY_RESTRICT input, size_t len, size_t i, AnsiExcludeState state)
{
    if (state == AnsiExcludeState::InCSI)
        i = CsiEnd(input, len, i);
    else if (state == AnsiExcludeState::InOSC)
        i = StringPayloadEnd<true>(input, len, i);

    size_t count = 0;
    while (i < len) {
        const uint8_t c = input[i];
        if (IsAnsiIntroducer(c)) {
            i = AnsiSequenceEnd(input, len, i);
            continue;
        }
        count += IsVisibleLatin1Byte(c) ? 1 : 0;
        i += 1;
    }
    return count;
}

size_t VisibleLatin1WidthExcludeANSIImpl(const uint8_t* HWY_RESTRICT input, size_t len)
{
    // Cap at 64 lanes so each chunk's classification fits in a uint64_t bitmask.
    const hn::CappedTag<uint8_t, 64> d;
    const size_t N = hn::Lanes(d);

    AnsiExcludeState state = AnsiExcludeState::None;
    size_t count = 0;
    size_t i = 0;

    // Tiny inputs: the scalar state machine beats any vector setup.
    if (len < 16)
        return VisibleLatin1WidthExcludeANSIScalar(input, len, 0, state);

    const auto vec_esc = hn::Set(d, uint8_t { 0x1B });
    const auto vec_0x20 = hn::Set(d, uint8_t { 0x20 });
    const auto vec_0x7F = hn::Set(d, uint8_t { 0x7F });
    const auto vec_soft_hyphen = hn::Set(d, uint8_t { 0xAD });

    // The DEL + C1 lanes (0x7F..0x9F). Shared by the printable classification
    // and the fast-path gate: it is a superset of the 8-bit C1 introducers
    // (0x90-0x9F), so gating on it costs one Or over the ESC-only check, and a
    // DEL / 0x80-0x8F false hit only costs one cold pass.
    const auto classifyC1Range = [&](auto chunk) HWY_ATTR {
        return hn::Le(hn::Sub(chunk, vec_0x7F), vec_0x20); // 0x7F..0x9F
    };
    // visible = (c >= 0x20) && !(0x7F <= c <= 0x9F) && (c != 0xAD)
    const auto classifyPrintable = [&](auto chunk, auto in_c1_range) HWY_ATTR {
        const auto ge_0x20 = hn::Ge(chunk, vec_0x20);
        const auto is_soft_hyphen = hn::Eq(chunk, vec_soft_hyphen);
        return hn::AndNot(hn::Or(in_c1_range, is_soft_hyphen), ge_0x20);
    };

    if (len >= N) {
        const auto vec_0x40 = hn::Set(d, uint8_t { 0x40 });
        const auto vec_0x3E = hn::Set(d, uint8_t { 0x3E }); // 0x7E - 0x40
        const auto vec_bel = hn::Set(d, uint8_t { 0x07 });
        const auto vec_c1_st = hn::Set(d, uint8_t { 0x9C });
        const auto vec_can = hn::Set(d, uint8_t { 0x18 });
        const auto vec_sub = hn::Set(d, uint8_t { 0x1A });
        const auto vec_0x90 = hn::Set(d, uint8_t { 0x90 });
        const auto vec_0x0F = hn::Set(d, uint8_t { 0x0F });

        const uint64_t laneMask = MaskBitsBelow(N);

        // Extracts a mask as bits (bit k = lane k).
        alignas(8) uint8_t maskBytes[8];
        const auto maskToBits = [&](auto mask) HWY_ATTR -> uint64_t {
            std::memset(maskBytes, 0, sizeof(maskBytes));
            hn::StoreMaskBits(d, mask, maskBytes);
            uint64_t bits;
            std::memcpy(&bits, maskBytes, sizeof(bits));
            return bits;
        };

        while (i + N <= len) {
            const auto chunk = hn::LoadU(d, input + i);

            const auto esc_m = hn::Eq(chunk, vec_esc);
            const auto c1_range_m = classifyC1Range(chunk);
            const auto printable_m = classifyPrintable(chunk, c1_range_m);

            // Fast path: nothing escape-related in this chunk.
            if (state == AnsiExcludeState::None && hn::AllFalse(d, hn::Or(esc_m, c1_range_m))) {
                count += hn::CountTrue(d, printable_m);
                i += N;
                continue;
            }

            // CAN/SUB/C1 ST abort a sequence to ground with the byte consumed:
            // they end a CSI like a final byte, and end a payload like the ST
            // terminator (which 0x9C already is).
            const auto abort_m = hn::Or(hn::Or(hn::Eq(chunk, vec_can), hn::Eq(chunk, vec_sub)), hn::Eq(chunk, vec_c1_st));
            const auto final_m = hn::Or(hn::Le(hn::Sub(chunk, vec_0x40), vec_0x3E), abort_m); // 0x40..0x7E | CAN | SUB | ST
            const auto term_m = hn::Or(hn::Eq(chunk, vec_bel), abort_m); // BEL | CAN | SUB | ST
            const auto c1_intro_m = hn::Le(hn::Sub(chunk, vec_0x90), vec_0x0F); // 0x90..0x9F

            const uint64_t esc = maskToBits(esc_m);
            const uint64_t prn = maskToBits(printable_m);
            // An ESC also ends a CSI: it aborts it and re-introduces a sequence.
            const uint64_t fin = maskToBits(final_m) | esc;
            const uint64_t term = maskToBits(term_m);
            // Walk mask: ESC plus every byte in 0x90-0x9F (the C1 introducers;
            // the rest of that range settle as single zero-width bytes).
            const uint64_t intro = esc | maskToBits(c1_intro_m);

            uint64_t zero = 0; // bits covered by escape sequences
            size_t consumed = N; // may exceed N when a sequence straddles the chunk end
            size_t pos = 0; // offset where escape processing resumes after carried state

            // Finish a sequence carried over from the previous chunk.
            if (state == AnsiExcludeState::InCSI) {
                if (fin == 0) {
                    i += N; // whole chunk is CSI parameters
                    continue;
                }
                const size_t e = static_cast<size_t>(hwy::Num0BitsBelowLS1Bit_Nonzero64(fin));
                zero |= MaskBitsBelow(e + 1);
                // An aborting ESC at `e` is an introducer left in the walk mask,
                // and an aborting 0x9C there re-settles as one zero-width byte;
                // a final byte / CAN / SUB is in neither, so resuming at `e` is
                // right for all.
                pos = e;
                state = AnsiExcludeState::None;
            } else if (state == AnsiExcludeState::InOSC) {
                const uint64_t cand = term | esc;
                if (cand == 0) {
                    i += N; // whole chunk is OSC payload
                    continue;
                }
                const size_t t = static_cast<size_t>(hwy::Num0BitsBelowLS1Bit_Nonzero64(cand));
                if ((term >> t) & 1) {
                    zero |= MaskBitsBelow(t + 1);
                    pos = t + 1;
                } else if (i + t + 1 < len && input[i + t + 1] == '\\') {
                    // ESC \ (ST); the backslash may sit in the next chunk.
                    if (t + 2 <= N) {
                        zero |= MaskBitsBelow(t + 2);
                        pos = t + 2;
                    } else {
                        zero |= laneMask;
                        consumed = t + 2;
                        pos = N;
                    }
                } else {
                    // Any other ESC aborts the payload and starts a new sequence.
                    zero |= MaskBitsBelow(t);
                    pos = t;
                }
                state = AnsiExcludeState::None;
            }

            // Process escape sequences that start in this chunk.
            uint64_t escRemaining = intro & ~MaskBitsBelow(pos);
            while (escRemaining != 0) {
                const size_t p = static_cast<size_t>(hwy::Num0BitsBelowLS1Bit_Nonzero64(escRemaining));
                if (i + p + 1 >= len) {
                    // Trailing introducer at the very end of the input: dropped.
                    zero |= uint64_t { 1 } << p;
                    escRemaining &= escRemaining - 1;
                    continue;
                }
                // Only ESC has a meaningful next byte; C1 introducers dispatch on
                // their own byte in the cold branch below.
                const uint8_t next = input[i + p] == 0x1B ? input[i + p + 1] : 0;
                if (next == '[') {
                    const size_t searchFrom = p + 2;
                    if (searchFrom >= N) {
                        // Parameters start in the next chunk; consume the '[' too.
                        zero |= laneMask & ~MaskBitsBelow(p);
                        consumed = searchFrom;
                        state = AnsiExcludeState::InCSI;
                        break;
                    }
                    const uint64_t f = fin & ~MaskBitsBelow(searchFrom);
                    if (f == 0) {
                        zero |= laneMask & ~MaskBitsBelow(p);
                        state = AnsiExcludeState::InCSI;
                        break;
                    }
                    const size_t e = static_cast<size_t>(hwy::Num0BitsBelowLS1Bit_Nonzero64(f));
                    zero |= MaskBitsBelow(e + 1) & ~MaskBitsBelow(p);
                    // An aborting ESC at `e` stays queued as a new sequence (an
                    // aborting 0x9C there just re-settles as a zero-width byte).
                    escRemaining &= ~MaskBitsBelow(e);
                    continue;
                }
                if (next == ']') {
                    const size_t searchFrom = p + 2;
                    if (searchFrom >= N) {
                        // Payload starts in the next chunk; consume the ']' too.
                        zero |= laneMask & ~MaskBitsBelow(p);
                        consumed = searchFrom;
                        state = AnsiExcludeState::InOSC;
                        break;
                    }
                    const uint64_t cand = (term | esc) & ~MaskBitsBelow(searchFrom);
                    if (cand == 0) {
                        zero |= laneMask & ~MaskBitsBelow(p);
                        state = AnsiExcludeState::InOSC;
                        break;
                    }
                    const size_t t = static_cast<size_t>(hwy::Num0BitsBelowLS1Bit_Nonzero64(cand));
                    if ((term >> t) & 1) {
                        zero |= MaskBitsBelow(t + 1) & ~MaskBitsBelow(p);
                        escRemaining &= ~MaskBitsBelow(t + 1);
                    } else if (i + t + 1 < len && input[i + t + 1] == '\\') {
                        if (t + 2 <= N) {
                            zero |= MaskBitsBelow(t + 2) & ~MaskBitsBelow(p);
                            escRemaining &= ~MaskBitsBelow(t + 2);
                        } else {
                            zero |= laneMask & ~MaskBitsBelow(p);
                            consumed = t + 2;
                            escRemaining = 0;
                        }
                    } else {
                        // Any other ESC aborts the payload and starts a new sequence.
                        zero |= MaskBitsBelow(t) & ~MaskBitsBelow(p);
                        escRemaining &= ~MaskBitsBelow(t);
                    }
                    continue;
                }
                // Every other form — the two-byte / nF / control-string
                // escapes and the 8-bit C1 range — is rare in real terminal
                // output. Count the lanes before it and hand the rest of the
                // input to the scalar recognizer: a call inside this loop would
                // spill the loop's vector registers (caller-saved) on the fast
                // path, so the cold forms never run here.
                count += static_cast<size_t>(hwy::PopCount(prn & ~zero & MaskBitsBelow(p)));
                return count + VisibleLatin1WidthExcludeANSIScalar(input, len, i + p, state);
            }

            count += static_cast<size_t>(hwy::PopCount(prn & ~zero & laneMask));
            i += consumed;
        }
    }

    // Short inputs and the final partial chunk: one masked load. With no ESC
    // or C1-range byte (and no carried escape state) the printable count is the
    // answer — lanes past the end load as zero, which is not printable.
    // Otherwise fall back to the scalar state machine for the remaining bytes.
    if (i < len) {
        const auto chunk = hn::LoadN(d, input + i, len - i);
        const auto c1_range_m = classifyC1Range(chunk);
        if (state == AnsiExcludeState::None && hn::AllFalse(d, hn::Or(hn::Eq(chunk, vec_esc), c1_range_m))) {
            count += hn::CountTrue(d, classifyPrintable(chunk, c1_range_m));
            return count;
        }
        count += VisibleLatin1WidthExcludeANSIScalar(input, len, i, state);
    }
    return count;
}

// --- Bulk UTF-16 visible width -------------------------------------------
//
// Used by Bun.stringWidth's UTF-16 path (stringWidth.cpp). Consumes leading
// code units that are always their own grapheme cluster with a fixed width:
// printable ASCII, most Latin-1/Latin-Extended/IPA, Greek and Cyrillic
// letters (width 1, East-Asian-Ambiguous letters count as narrow), and the
// main always-wide blocks (kana letters and marks, CJK Unified Ideographs and
// Extension A, Hangul syllables, fullwidth forms; width 2). Anything else —
// surrogates, combining marks, ZWJ/variation selectors, jamo, ESC, the long
// tail — ends the run so the scalar grapheme-cluster loop can take over.
//
// Returns the number of units consumed and adds their total width to *width.
// Only valid when ambiguous-width characters count as narrow (the default);
// the caller skips this path for `ambiguousIsNarrow: false`.
// stringWidth.test.ts verifies every codepoint in these ranges against the
// scalar classifier.

static HWY_INLINE bool ClassifyBulkUTF16Unit(uint16_t u, uint8_t& unitWidth)
{
    // Narrow: always width 1, always a standalone cluster.
    if ((u >= 0x20 && u <= 0x7E)
        || (u >= 0xA0 && u <= 0x2FF && u != 0xA9 && u != 0xAD && u != 0xAE)
        || (u >= 0x370 && u <= 0x482)
        || (u >= 0x48A && u <= 0x52F)) {
        unitWidth = 1;
        return true;
    }
    // Wide: always width 2; Hangul syllables (LV/LVT) always break between
    // each other and everything else in this allowlist.
    if ((u >= 0x3041 && u <= 0x3096)
        || (u >= 0x309B && u <= 0x30FF)
        || (u >= 0x3400 && u <= 0x4DBF)
        || (u >= 0x4E00 && u <= 0x9FFF)
        || (u >= 0xAC00 && u <= 0xD7A3)
        || (u >= 0xFF01 && u <= 0xFF60)) {
        unitWidth = 2;
        return true;
    }
    return false;
}

size_t VisibleUTF16WidthImpl(const uint16_t* HWY_RESTRICT input, size_t len, size_t* HWY_RESTRICT width)
{
    const hn::ScalableTag<uint16_t> d;
    const size_t N = hn::Lanes(d);

    size_t w = 0;
    size_t i = 0;

    if (len >= N) {
        // `v - lo <= hi - lo` (unsigned)  <=>  lo <= v <= hi.
        const auto vec_ascii_lo = hn::Set(d, uint16_t { 0x20 });
        const auto vec_ascii_span = hn::Set(d, uint16_t { 0x7E - 0x20 });
        const auto vec_latin_lo = hn::Set(d, uint16_t { 0xA0 });
        const auto vec_latin_span = hn::Set(d, uint16_t { 0x2FF - 0xA0 });
        const auto vec_0xA9 = hn::Set(d, uint16_t { 0xA9 });
        const auto vec_0xAD = hn::Set(d, uint16_t { 0xAD });
        const auto vec_0xAE = hn::Set(d, uint16_t { 0xAE });
        const auto vec_greek_lo = hn::Set(d, uint16_t { 0x370 });
        const auto vec_greek_span = hn::Set(d, uint16_t { 0x482 - 0x370 });
        const auto vec_cyrillic_lo = hn::Set(d, uint16_t { 0x48A });
        const auto vec_cyrillic_span = hn::Set(d, uint16_t { 0x52F - 0x48A });
        const auto vec_hiragana_lo = hn::Set(d, uint16_t { 0x3041 });
        const auto vec_hiragana_span = hn::Set(d, uint16_t { 0x3096 - 0x3041 });
        const auto vec_katakana_lo = hn::Set(d, uint16_t { 0x309B });
        const auto vec_katakana_span = hn::Set(d, uint16_t { 0x30FF - 0x309B });
        const auto vec_cjk_ext_lo = hn::Set(d, uint16_t { 0x3400 });
        const auto vec_cjk_ext_span = hn::Set(d, uint16_t { 0x4DBF - 0x3400 });
        const auto vec_cjk_lo = hn::Set(d, uint16_t { 0x4E00 });
        const auto vec_cjk_span = hn::Set(d, uint16_t { 0x9FFF - 0x4E00 });
        const auto vec_hangul_lo = hn::Set(d, uint16_t { 0xAC00 });
        const auto vec_hangul_span = hn::Set(d, uint16_t { 0xD7A3 - 0xAC00 });
        const auto vec_fullwidth_lo = hn::Set(d, uint16_t { 0xFF01 });
        const auto vec_fullwidth_span = hn::Set(d, uint16_t { 0xFF60 - 0xFF01 });

        while (i + N <= len) {
            const auto v = hn::LoadU(d, input + i);

            const auto is_ascii = hn::Le(hn::Sub(v, vec_ascii_lo), vec_ascii_span);
            const auto latin1_extended = hn::AndNot(
                hn::Or(hn::Eq(v, vec_0xA9), hn::Or(hn::Eq(v, vec_0xAD), hn::Eq(v, vec_0xAE))),
                hn::Le(hn::Sub(v, vec_latin_lo), vec_latin_span));
            const auto greek = hn::Le(hn::Sub(v, vec_greek_lo), vec_greek_span);
            const auto cyrillic = hn::Le(hn::Sub(v, vec_cyrillic_lo), vec_cyrillic_span);
            const auto narrow = hn::Or(hn::Or(is_ascii, latin1_extended), hn::Or(greek, cyrillic));

            const auto hiragana = hn::Le(hn::Sub(v, vec_hiragana_lo), vec_hiragana_span);
            const auto katakana = hn::Le(hn::Sub(v, vec_katakana_lo), vec_katakana_span);
            const auto cjk_ext = hn::Le(hn::Sub(v, vec_cjk_ext_lo), vec_cjk_ext_span);
            const auto cjk = hn::Le(hn::Sub(v, vec_cjk_lo), vec_cjk_span);
            const auto hangul = hn::Le(hn::Sub(v, vec_hangul_lo), vec_hangul_span);
            const auto fullwidth = hn::Le(hn::Sub(v, vec_fullwidth_lo), vec_fullwidth_span);
            const auto wide = hn::Or(
                hn::Or(hn::Or(hiragana, katakana), hn::Or(cjk_ext, cjk)),
                hn::Or(hangul, fullwidth));

            const auto ok = hn::Or(narrow, wide);
            if (!hn::AllTrue(d, ok))
                break; // the scalar loop below consumes the qualifying prefix

            // narrow lanes contribute 1, wide lanes contribute 2.
            w += N + hn::CountTrue(d, wide);
            i += N;
        }
    }

    // Scalar: short inputs, the final partial vector, and the qualifying
    // prefix of a vector that contained a non-allowlisted unit.
    for (; i < len; i++) {
        uint8_t unitWidth;
        if (!ClassifyBulkUTF16Unit(input[i], unitWidth))
            break;
        w += unitWidth;
    }

    *width += w;
    return i;
}

// Count of UTF-16 code units in [0x20, 0x7E] (printable ASCII). Bulk-ASCII
// helper for Bun.stringWidth's UTF-16 path (stringWidth.cpp).
size_t CountPrintableAscii16Impl(const uint16_t* HWY_RESTRICT input, size_t len)
{
    const hn::ScalableTag<uint16_t> d;
    const size_t N = hn::Lanes(d);

    const auto vec_0x20 = hn::Set(d, uint16_t { 0x20 });
    const auto vec_0x5E = hn::Set(d, uint16_t { 0x5E });

    size_t count = 0;
    size_t i = 0;
    const size_t simd_len = len - (len % N);
    for (; i < simd_len; i += N) {
        const auto chunk = hn::LoadU(d, input + i);
        const auto printable = hn::Le(hn::Sub(chunk, vec_0x20), vec_0x5E);
        count += hn::CountTrue(d, printable);
    }

    for (; i < len; ++i) {
        const uint16_t c = input[i];
        count += (c >= 0x20 && c < 0x7F) ? 1 : 0;
    }
    return count;
}

// Index of the first UTF-16 code unit greater than 0x7F, or len if none.
size_t FirstNonAscii16Impl(const uint16_t* HWY_RESTRICT input, size_t len)
{
    const hn::ScalableTag<uint16_t> d;
    const size_t N = hn::Lanes(d);

    const auto vec_0x7F = hn::Set(d, uint16_t { 0x7F });

    size_t i = 0;
    const size_t simd_len = len - (len % N);
    for (; i < simd_len; i += N) {
        const auto chunk = hn::LoadU(d, input + i);
        const auto non_ascii = hn::Gt(chunk, vec_0x7F);
        const intptr_t pos = hn::FindFirstTrue(d, non_ascii);
        if (pos >= 0) {
            return i + pos;
        }
    }

    for (; i < len; ++i) {
        if (input[i] > 0x7F) {
            return i;
        }
    }
    return len;
}

// Index of the first byte greater than 0x7F, or len if none.
size_t FirstNonAscii8Impl(const uint8_t* HWY_RESTRICT input, size_t len)
{
    D8 d;
    const size_t N = hn::Lanes(d);

    const auto vec_0x7F = hn::Set(d, uint8_t { 0x7F });

    size_t i = 0;
    const size_t simd_len = len - (len % N);
    for (; i < simd_len; i += N) {
        const auto chunk = hn::LoadU(d, input + i);
        const auto non_ascii = hn::Gt(chunk, vec_0x7F);
        const intptr_t pos = hn::FindFirstTrue(d, non_ascii);
        if (pos >= 0) {
            return i + pos;
        }
    }

    for (; i < len; ++i) {
        if (input[i] > 0x7F) {
            return i;
        }
    }
    return len;
}

// An "escape character" for ANSI tokenizing: ESC, the ST-terminated C1
// introducers, plus C1 ST (0x9C) itself so a standalone terminator stops the
// scan. Matches ANSIHelpers.h's scalar contract (isEscapeCharacter + 0x9C).
template<class T>
static HWY_INLINE bool IsEscapeCharScalar(T c)
{
    return c == 0x1b || c == 0x90 || c == 0x98 || c == 0x9b
        || c == 0x9c || c == 0x9d || c == 0x9e || c == 0x9f;
}

// Scalar scan over [from, len); returns the first escape index or len.
template<class T>
static HWY_INLINE size_t IndexOfEscapeCharScalar(const T* HWY_RESTRICT input, size_t from, size_t len)
{
    for (size_t i = from; i < len; ++i) {
        if (IsEscapeCharScalar(input[i]))
            return i;
    }
    return len;
}

// Index of the first ANSI escape introducer, or len if none. Shared by
// Bun.stripANSI / stringWidth / wrapAnsi / sliceAnsi via ANSIHelpers.h's
// findEscapeCharacter.
//
// Two-stage like the original WTF-SIMD version: a broad range mask
// (c & 0x70) == 0x10 catches 0x10-0x1F and 0x90-0x9F in one compare — the hot
// no-escape path pays only this per chunk — then an exact 8-value match
// refines a broad hit down to the real introducers. `T` is u8 (Latin-1) or
// u16 (UTF-16); on u16 the broad mask 0xFF70 also rejects code units >= 0x100.
//
// Short inputs take the scalar path before any vector setup, so the kernel is
// cheap when called standalone. (The only current caller, findEscapeCharacter,
// gates dispatch at >= kEscapeDispatchThreshold, but this is extern "C".)
template<class T>
static HWY_INLINE size_t IndexOfEscapeCharImpl(const T* HWY_RESTRICT input, size_t len)
{
    const hn::ScalableTag<T> d;
    const size_t N = hn::Lanes(d);

    if (len < N)
        return IndexOfEscapeCharScalar<T>(input, 0, len);

    // Broad range: (c & ~0b10001111) == 0b00010000 → 0x10-0x1F and 0x90-0x9F.
    const auto broad_mask = hn::Set(d, static_cast<T>(~0b10001111U));
    const auto broad_vec = hn::Set(d, static_cast<T>(0b00010000));

    // Exact introducers (including C1 ST 0x9C), used to reject broad-mask
    // false positives (0x10-0x1A, 0x1C-0x1F, 0x91-0x97, 0x99-0x9A).
    const auto vec_1b = hn::Set(d, static_cast<T>(0x1b));
    const auto vec_90 = hn::Set(d, static_cast<T>(0x90));
    const auto vec_98 = hn::Set(d, static_cast<T>(0x98));
    const auto vec_9b = hn::Set(d, static_cast<T>(0x9b));
    const auto vec_9c = hn::Set(d, static_cast<T>(0x9c));
    const auto vec_9d = hn::Set(d, static_cast<T>(0x9d));
    const auto vec_9e = hn::Set(d, static_cast<T>(0x9e));
    const auto vec_9f = hn::Set(d, static_cast<T>(0x9f));

    const auto exact_match = [&](auto chunk) HWY_ATTR {
        return hn::Or(
            hn::Or(hn::Or(hn::Eq(chunk, vec_1b), hn::Eq(chunk, vec_90)),
                hn::Or(hn::Eq(chunk, vec_98), hn::Eq(chunk, vec_9b))),
            hn::Or(hn::Or(hn::Eq(chunk, vec_9c), hn::Eq(chunk, vec_9d)),
                hn::Or(hn::Eq(chunk, vec_9e), hn::Eq(chunk, vec_9f))));
    };

    size_t i = 0;
    const size_t simd_len = len - (len % N);
    for (; i < simd_len; i += N) {
        const auto chunk = hn::LoadU(d, input + i);
        const auto broad = hn::Eq(hn::And(chunk, broad_mask), broad_vec);
        if (hn::AllFalse(d, broad))
            continue;
        const intptr_t pos = hn::FindFirstTrue(d, exact_match(chunk));
        if (pos >= 0) {
            return i + pos;
        }
    }

    return IndexOfEscapeCharScalar<T>(input, i, len);
}

size_t IndexOfEscapeChar8Impl(const uint8_t* HWY_RESTRICT input, size_t len)
{
    return IndexOfEscapeCharImpl<uint8_t>(input, len);
}

size_t IndexOfEscapeChar16Impl(const uint16_t* HWY_RESTRICT input, size_t len)
{
    return IndexOfEscapeCharImpl<uint16_t>(input, len);
}

size_t CopyAsciiPrefixImpl(const uint8_t* HWY_RESTRICT src, size_t len, uint8_t* HWY_RESTRICT dst)
{
    D8 d;
    const size_t N = hn::Lanes(d);

    const auto vec_0x7F = hn::Set(d, uint8_t { 0x7F });

    size_t i = 0;
    if (len >= N) {
        const size_t simd_len = len - (len % N);
        for (; i < simd_len; i += N) {
            const auto chunk = hn::LoadU(d, src + i);
            const auto non_ascii = hn::Gt(chunk, vec_0x7F);
            const intptr_t pos = hn::FindFirstTrue(d, non_ascii);
            if (pos >= 0) {
                if (pos > 0) {
                    std::memcpy(dst + i, src + i, static_cast<size_t>(pos));
                }
                return i + static_cast<size_t>(pos);
            }
            hn::StoreU(chunk, d, dst + i);
        }

        if (i < len) {
            const size_t start = len - N;
            const auto chunk = hn::LoadU(d, src + start);
            const auto non_ascii = hn::Gt(chunk, vec_0x7F);
            const intptr_t pos = hn::FindFirstTrue(d, non_ascii);
            if (pos < 0) {
                hn::StoreU(chunk, d, dst + start);
                return len;
            }
            const size_t stop = start + static_cast<size_t>(pos);
            if (stop > i) {
                std::memcpy(dst + i, src + i, stop - i);
            }
            return stop;
        }
        return len;
    }

    for (; i < len; ++i) {
        const uint8_t c = src[i];
        if (c > 0x7F) {
            return i;
        }
        dst[i] = c;
    }
    return len;
}

// Vector with the 0x20 case bit set in every lane holding an ASCII uppercase
// letter ('A'..'Z') and 0 everywhere else. The uppercase test is the usual
// unsigned range fold: (c - 'A') < 26. `VecFromMask` turns the predicate into a
// lane mask that we AND with 0x20, so the case bit is OR-ed into uppercase
// letters only and every other byte (digits, punctuation, Latin-1 >= 0x80) is
// left untouched.
template<class D>
static HWY_INLINE hn::Vec<D> AsciiLowerBit(D d, hn::Vec<D> chunk)
{
    using T = hn::TFromD<D>;
    const auto folded = hn::Sub(chunk, hn::Set(d, T { 'A' }));
    const auto is_upper = hn::Lt(folded, hn::Set(d, T { 26 }));
    return hn::And(hn::VecFromMask(d, is_upper), hn::Set(d, T { 0x20 }));
}

// Index of the first ASCII uppercase letter ('A'..'Z'), or len if none.
// Used to early-out the header-name lowercasing: when a name is already
// lowercase we hand back the original String without allocating a copy,
// matching StringImpl::convertToASCIILowercase.
size_t IndexOfFirstAsciiUpperImpl(const uint8_t* HWY_RESTRICT input, size_t len)
{
    D8 d;
    const size_t N = hn::Lanes(d);

    const auto vec_A = hn::Set(d, uint8_t { 'A' });
    const auto vec_26 = hn::Set(d, uint8_t { 26 });

    size_t i = 0;
    const size_t simd_len = len - (len % N);
    for (; i < simd_len; i += N) {
        const auto chunk = hn::LoadU(d, input + i);
        // (c - 'A') < 26, unsigned: only 'A'..'Z' land in range; everything
        // below 'A' wraps around to a large value.
        const auto is_upper = hn::Lt(hn::Sub(chunk, vec_A), vec_26);
        const intptr_t pos = hn::FindFirstTrue(d, is_upper);
        if (pos >= 0) {
            return i + pos;
        }
    }

    for (; i < len; ++i) {
        const uint8_t c = input[i];
        if (static_cast<uint8_t>(c - 'A') < 26) {
            return i;
        }
    }
    return len;
}

// Copy `src` to `dst`, lowercasing ASCII uppercase letters ('A'..'Z') and
// leaving every other byte (digits, punctuation, Latin-1 >= 0x80) untouched.
// Per block: OR in the 0x20 case bit only on the uppercase lanes. Mirrors
// StringImpl::convertToASCIILowercase's per-character mapping without the
// scalar per-byte branch.
void LowerAsciiImpl(const uint8_t* HWY_RESTRICT src, size_t len, uint8_t* HWY_RESTRICT dst)
{
    D8 d;
    const size_t N = hn::Lanes(d);

    size_t i = 0;
    if (len >= N) {
        const size_t simd_len = len - (len % N);
        for (; i < simd_len; i += N) {
            const auto chunk = hn::LoadU(d, src + i);
            hn::StoreU(hn::Or(chunk, AsciiLowerBit(d, chunk)), d, dst + i);
        }

        if (i < len) {
            const size_t start = len - N;
            const auto chunk = hn::LoadU(d, src + start);
            hn::StoreU(hn::Or(chunk, AsciiLowerBit(d, chunk)), d, dst + start);
        }
        return;
    }

    // Branchless case fold for the sub-vector remainder (no data-dependent
    // branch per byte). On wide-vector targets the compiler still
    // auto-vectorizes this with AVX-512 masked ops; those live in the
    // runtime-dispatched target namespaces and are covered by the
    // verify-baseline-static allowlist.
    for (; i < len; ++i) {
        const uint8_t c = src[i];
        const uint8_t isUpper = static_cast<uint8_t>(c - 'A') < 26 ? 1 : 0;
        dst[i] = static_cast<uint8_t>(c | (isUpper << 5));
    }
}

// 16-bit (UTF-16) counterparts of the two kernels above. WTF strings holding
// only ASCII may still be stored as 16-bit, so the header-name lowercasing
// needs a 16-bit path too. The A-Z test and 0x20 case bit are identical; only
// the lane width changes (ASCII letters are well within a 16-bit lane, and
// code units >= 0x80 are left untouched).
size_t IndexOfFirstAsciiUpper16Impl(const uint16_t* HWY_RESTRICT input, size_t len)
{
    const hn::ScalableTag<uint16_t> d;
    const size_t N = hn::Lanes(d);

    const auto vec_A = hn::Set(d, uint16_t { 'A' });
    const auto vec_26 = hn::Set(d, uint16_t { 26 });

    size_t i = 0;
    const size_t simd_len = len - (len % N);
    for (; i < simd_len; i += N) {
        const auto chunk = hn::LoadU(d, input + i);
        const auto is_upper = hn::Lt(hn::Sub(chunk, vec_A), vec_26);
        const intptr_t pos = hn::FindFirstTrue(d, is_upper);
        if (pos >= 0) {
            return i + pos;
        }
    }

    for (; i < len; ++i) {
        const uint16_t c = input[i];
        if (static_cast<uint16_t>(c - 'A') < 26) {
            return i;
        }
    }
    return len;
}

void LowerAscii16Impl(const uint16_t* HWY_RESTRICT src, size_t len, uint16_t* HWY_RESTRICT dst)
{
    const hn::ScalableTag<uint16_t> d;
    const size_t N = hn::Lanes(d);

    size_t i = 0;
    if (len >= N) {
        const size_t simd_len = len - (len % N);
        for (; i < simd_len; i += N) {
            const auto chunk = hn::LoadU(d, src + i);
            hn::StoreU(hn::Or(chunk, AsciiLowerBit(d, chunk)), d, dst + i);
        }

        if (i < len) {
            const size_t start = len - N;
            const auto chunk = hn::LoadU(d, src + start);
            hn::StoreU(hn::Or(chunk, AsciiLowerBit(d, chunk)), d, dst + start);
        }
        return;
    }

    for (; i < len; ++i) {
        const uint16_t c = src[i];
        const uint16_t isUpper = static_cast<uint16_t>(c - 'A') < 26 ? 1 : 0;
        dst[i] = static_cast<uint16_t>(c | (isUpper << 5));
    }
}

// Lowercase hex encode: writes 2 output bytes per input byte.
// Per 16-byte block: split each byte into nibbles, map both nibble vectors
// through the hex-digit table (TableLookupBytes), then interleave so the
// high-nibble digit precedes the low-nibble digit of every byte.
void EncodeHexLowerImpl(const uint8_t* HWY_RESTRICT input, size_t len, uint8_t* HWY_RESTRICT output)
{
    alignas(16) static constexpr uint8_t kHexDigits[16] = {
        '0', '1', '2', '3', '4', '5', '6', '7',
        '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'
    };

    D8 d;
    const size_t N = hn::Lanes(d);

    const auto table = hn::LoadDup128(d, kHexDigits);
    const auto low_nibble_mask = hn::Set(d, uint8_t { 0x0F });

    size_t i = 0;
    if (len >= N) {
        const size_t simd_len = len - (len % N);
        for (; i < simd_len; i += N) {
            const auto bytes = hn::LoadU(d, input + i);
            const auto hi = hn::ShiftRight<4>(bytes);
            const auto lo = hn::And(bytes, low_nibble_mask);
            const auto hi_chars = hn::TableLookupBytes(table, hi);
            const auto lo_chars = hn::TableLookupBytes(table, lo);
            hn::StoreInterleaved2(hi_chars, lo_chars, d, output + i * 2);
        }
    }

    for (; i < len; ++i) {
        const uint8_t byte = input[i];
        output[i * 2] = kHexDigits[byte >> 4];
        output[i * 2 + 1] = kHexDigits[byte & 0x0F];
    }
}

// --- Hex decoding (Buffer.from(str, "hex"), buf.write(str, "hex")) ---
//
// Helpers shared by DecodeHex8Impl / DecodeHex16Impl. `D` is a u8 or u16 tag;
// a UTF-16 code unit is classified by its low byte (what Node's hex decoder
// does, so U+FF41 counts as 'A'), and anything outside [0-9A-Fa-f] after that
// narrowing is invalid. Both helpers are inlined into the same loop body, so
// the common subexpressions (case fold, alpha classification) are computed once.

template<class D>
static HWY_INLINE hn::Mask<D> IsAsciiHexAlpha(D d, hn::Vec<D> chars)
{
    using T = hn::TFromD<D>;
    // Fold to lowercase, then 'a'..'f' → 0..5 (unsigned wraparound pushes
    // everything below 'a' far above 5).
    const auto folded = hn::Or(chars, hn::Set(d, T { 0x20 }));
    return hn::Lt(hn::Sub(folded, hn::Set(d, T { 'a' })), hn::Set(d, T { 6 }));
}

template<class D>
static HWY_INLINE hn::Mask<D> IsAsciiHexDigit(D d, hn::Vec<D> chars)
{
    using T = hn::TFromD<D>;
    const auto is_digit = hn::Lt(hn::Sub(chars, hn::Set(d, T { '0' })), hn::Set(d, T { 10 }));
    return hn::Or(is_digit, IsAsciiHexAlpha(d, chars));
}

// Nibble value of each lane; only meaningful for lanes that pass IsAsciiHexDigit.
template<class D>
static HWY_INLINE hn::Vec<D> HexNibbleValue(D d, hn::Vec<D> chars)
{
    using T = hn::TFromD<D>;
    // '0'-'9': low nibble is already the value. 'a'-'f'/'A'-'F': low nibble is
    // 1..6, so add 9 to reach 10..15.
    const auto low = hn::And(chars, hn::Set(d, T { 0x0F }));
    return hn::Add(low, hn::IfThenElseZero(IsAsciiHexAlpha(d, chars), hn::Set(d, T { 9 })));
}

static HWY_INLINE uint8_t ScalarHexNibble(uint32_t c)
{
    const uint32_t folded = c | 0x20;
    const bool is_digit = (c - '0') < 10;
    const bool is_alpha = (folded - 'a') < 6;
    if (!(is_digit || is_alpha)) {
        return 0xFF;
    }
    return static_cast<uint8_t>((c & 0x0F) + (is_alpha ? 9 : 0));
}

// Decodes whole blocks of Lanes(d) pairs starting at output index `out`,
// stopping before the first block that contains a non-hex character (the
// scalar loop in the callers pinpoints the exact pair). Each iteration loads
// 2*Lanes(d) characters and stores Lanes(d) bytes. Returns the new `out`.
template<class D>
static HWY_INLINE size_t DecodeHexVectorLoop(D d, const hn::TFromD<D>* HWY_RESTRICT input, uint8_t* HWY_RESTRICT output, size_t out, size_t out_len)
{
    const size_t N = hn::Lanes(d);
    if (out_len - out < N) {
        return out;
    }

    const size_t simd_out = out + ((out_len - out) - ((out_len - out) % N));
    for (; out < simd_out; out += N) {
        auto chars0 = hn::LoadU(d, input + out * 2);
        auto chars1 = hn::LoadU(d, input + out * 2 + N);
        if constexpr (sizeof(hn::TFromD<D>) == 2) {
            const auto low_byte = hn::Set(d, hn::TFromD<D> { 0xFF });
            chars0 = hn::And(chars0, low_byte);
            chars1 = hn::And(chars1, low_byte);
        }

        const auto valid = hn::And(IsAsciiHexDigit(d, chars0), IsAsciiHexDigit(d, chars1));
        if (!hn::AllTrue(d, valid)) {
            break;
        }

        const auto nib0 = HexNibbleValue(d, chars0);
        const auto nib1 = HexNibbleValue(d, chars1);
        // Even-indexed chars hold the high nibbles, odd-indexed the low nibbles.
        const auto hi = hn::ConcatEven(d, nib1, nib0);
        const auto lo = hn::ConcatOdd(d, nib1, nib0);
        const auto bytes = hn::Or(hn::ShiftLeft<4>(hi), lo);
        if constexpr (sizeof(hn::TFromD<D>) == 2) {
            // UTF-16 input: the decoded byte sits in the low half of each u16 lane.
            const hn::Rebind<uint8_t, D> d8;
            hn::StoreU(hn::TruncateTo(d8, bytes), d8, output + out);
        } else {
            hn::StoreU(bytes, d, output + out);
        }
    }
    return out;
}

// Decodes `out_len` pairs of ASCII hex digits ("ff" → 0xFF) from `input` into
// `output`, stopping at the first pair that contains a non-hex character.
// Returns the number of output bytes written (== out_len when fully valid).
// The caller guarantees `input` is readable for 2*out_len elements and
// `output` is writable for out_len bytes.
size_t DecodeHex8Impl(const uint8_t* HWY_RESTRICT input, uint8_t* HWY_RESTRICT output, size_t out_len)
{
    D8 d;
    size_t out = DecodeHexVectorLoop(d, input, output, 0, out_len);
#if HWY_MAX_BYTES > 16
    // On wide-vector targets, mop up the 16..(Lanes-1)-pair remainder with
    // 128-bit blocks so digest-sized inputs (16-64 pairs) still vectorize
    // instead of falling through to the scalar loop.
    const hn::CappedTag<uint8_t, 16> d128;
    out = DecodeHexVectorLoop(d128, input, output, out, out_len);
#endif

    for (; out < out_len; out++) {
        const uint8_t hi = ScalarHexNibble(input[out * 2]);
        const uint8_t lo = ScalarHexNibble(input[out * 2 + 1]);
        if (hi == 0xFF || lo == 0xFF) {
            return out;
        }
        output[out] = static_cast<uint8_t>((hi << 4) | lo);
    }
    return out_len;
}

// UTF-16 variant of DecodeHex8Impl (for two-byte JS strings). Each code unit
// is decoded by its low byte, like Node: U+FF41 decodes as 'A', while a unit
// whose low byte is not a hex digit stops decoding like any other invalid
// character.
size_t DecodeHex16Impl(const uint16_t* HWY_RESTRICT input, uint8_t* HWY_RESTRICT output, size_t out_len)
{
    const hn::ScalableTag<uint16_t> d16;
    size_t out = DecodeHexVectorLoop(d16, input, output, 0, out_len);
#if HWY_MAX_BYTES > 16
    const hn::CappedTag<uint16_t, 8> d128;
    out = DecodeHexVectorLoop(d128, input, output, out, out_len);
#endif

    for (; out < out_len; out++) {
        const uint8_t hi = ScalarHexNibble(static_cast<uint8_t>(input[out * 2]));
        const uint8_t lo = ScalarHexNibble(static_cast<uint8_t>(input[out * 2 + 1]));
        if (hi == 0xFF || lo == 0xFF) {
            return out;
        }
        output[out] = static_cast<uint8_t>((hi << 4) | lo);
    }
    return out_len;
}

template<class D8T, typename T>
static HWY_INLINE size_t BSwapLanes(D8T d8, uint8_t* HWY_RESTRICT data, size_t i, size_t len)
{
    const hn::Repartition<T, D8T> dt;
    const size_t N = hn::Lanes(d8);
    // Two independent chains per iteration; clang does not unroll this itself.
    for (; i + 2 * N <= len; i += 2 * N) {
        const auto v0 = hn::BitCast(dt, hn::LoadU(d8, data + i));
        const auto v1 = hn::BitCast(dt, hn::LoadU(d8, data + i + N));
        hn::StoreU(hn::BitCast(d8, hn::ReverseLaneBytes(v0)), d8, data + i);
        hn::StoreU(hn::BitCast(d8, hn::ReverseLaneBytes(v1)), d8, data + i + N);
    }
    if (i + N <= len) {
        const auto v = hn::BitCast(dt, hn::LoadU(d8, data + i));
        hn::StoreU(hn::BitCast(d8, hn::ReverseLaneBytes(v)), d8, data + i);
        i += N;
    }
    return i;
}

// In-place byte swap of every sizeof(T)-byte element (Buffer.swap16/32/64).
// `data` need not be aligned to T.
template<typename T>
static void BSwapImpl(uint8_t* HWY_RESTRICT data, size_t len)
{
    size_t i = BSwapLanes<D8, T>(D8(), data, 0, len);
    i = BSwapLanes<hn::CappedTag<uint8_t, 16>, T>(hn::CappedTag<uint8_t, 16>(), data, i, len);
    for (; i < len; i += sizeof(T)) {
        T val;
        memcpy(&val, data + i, sizeof(T));
        val = std::byteswap(val);
        memcpy(data + i, &val, sizeof(T));
    }
}

void BSwap16Impl(uint8_t* HWY_RESTRICT data, size_t len) { BSwapImpl<uint16_t>(data, len); }
void BSwap32Impl(uint8_t* HWY_RESTRICT data, size_t len) { BSwapImpl<uint32_t>(data, len); }
void BSwap64Impl(uint8_t* HWY_RESTRICT data, size_t len) { BSwapImpl<uint64_t>(data, len); }

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
HWY_EXPORT(BSwap16Impl);
HWY_EXPORT(BSwap32Impl);
HWY_EXPORT(BSwap64Impl);
HWY_EXPORT(ContainsNewlineOrNonASCIIOrQuoteImpl);
HWY_EXPORT(CopyAsciiPrefixImpl);
HWY_EXPORT(CopyU16ToU8Impl);
HWY_EXPORT(CountCharImpl);
HWY_EXPORT(CountPrintableAscii16Impl);
HWY_EXPORT(DecodeHex16Impl);
HWY_EXPORT(DecodeHex8Impl);
HWY_EXPORT(EncodeHexLowerImpl);
HWY_EXPORT(FillWithSkipMaskImpl);
HWY_EXPORT(FirstNonAscii16Impl);
HWY_EXPORT(FirstNonAscii8Impl);
HWY_EXPORT(HtmlEscapeExtraLen16Impl);
HWY_EXPORT(HtmlEscapeExtraLen8Impl);
HWY_EXPORT(IndexOfAnyCharImpl);
HWY_EXPORT(IndexOfCharImpl);
HWY_EXPORT(IndexOfEscapeChar16Impl);
HWY_EXPORT(IndexOfEscapeChar8Impl);
HWY_EXPORT(IndexOfFirstAsciiUpper16Impl);
HWY_EXPORT(IndexOfFirstAsciiUpperImpl);
HWY_EXPORT(IndexOfHTMLEscapeChar8Impl);
HWY_EXPORT(IndexOfHTMLEscapeChar16Impl);
HWY_EXPORT(IndexOfInterestingCharacterInMultilineCommentImpl);
HWY_EXPORT(IndexOfInterestingCharacterInStringLiteralImpl);
HWY_EXPORT(IndexOfNeedsEscapeForJavaScriptStringImplBacktick);
HWY_EXPORT(IndexOfNeedsEscapeForJavaScriptStringImplQuote);
HWY_EXPORT(IndexOfNewlineOrNonASCIIImpl);
HWY_EXPORT(IndexOfNewlineOrNonASCIIOrHashOrAtImpl);
HWY_EXPORT(IndexOfNotCharImpl);
HWY_EXPORT(IndexOfSpaceOrNewlineOrNonASCIIImpl);
HWY_EXPORT(LastIndexOfAnyCharImpl);
HWY_EXPORT(LastIndexOfCharImpl);
HWY_EXPORT(LowerAscii16Impl);
HWY_EXPORT(LowerAsciiImpl);
HWY_EXPORT(MemMemImpl);
HWY_EXPORT(MemRMemImpl);
HWY_EXPORT(MemMem16Impl);
HWY_EXPORT(MemRMem16Impl);
HWY_EXPORT(VisibleLatin1WidthExcludeANSIImpl);
HWY_EXPORT(VisibleLatin1WidthImpl);
HWY_EXPORT(VisibleUTF16WidthImpl);

} // namespace bun
#include "BufferStringSearch.h"
namespace bun {

template<typename Char>
size_t MemMemTwoWayFallback(const Char* haystack, size_t haystack_len,
    const Char* needle, size_t needle_len, size_t start_index, bool is_forward)
{
    return bun::SearchString<Char>(haystack, haystack_len, needle, needle_len, start_index, is_forward);
}
template size_t MemMemTwoWayFallback<uint8_t>(const uint8_t*, size_t, const uint8_t*, size_t, size_t, bool);
template size_t MemMemTwoWayFallback<uint16_t>(const uint16_t*, size_t, const uint16_t*, size_t, size_t, bool);

// Define the C-callable wrappers that use BUN_HWY_DISPATCH.
// These need to be defined *after* the HWY_EXPORT block and INSIDE namespace bun
// so that BUN_HWY_DISPATCH(FuncImpl) correctly resolves to bun::N_*::FuncImpl.
// The extern "C" only affects linkage (for C callers), not namespace resolution.
extern "C" {

void* highway_memmem(const uint8_t* haystack, size_t haystack_len, const uint8_t* needle, size_t needle_len)
{
    return BUN_HWY_DISPATCH(MemMemImpl)(haystack, haystack_len, needle, needle_len);
}

size_t highway_memrmem(const uint8_t* haystack, size_t haystack_len, const uint8_t* needle, size_t needle_len)
{
    return BUN_HWY_DISPATCH(MemRMemImpl)(haystack, haystack_len, needle, needle_len);
}

size_t highway_memmem16(const uint16_t* haystack, size_t haystack_len, const uint16_t* needle, size_t needle_len)
{
    return BUN_HWY_DISPATCH(MemMem16Impl)(haystack, haystack_len, needle, needle_len);
}

size_t highway_memrmem16(const uint16_t* haystack, size_t haystack_len, const uint16_t* needle, size_t needle_len)
{
    return BUN_HWY_DISPATCH(MemRMem16Impl)(haystack, haystack_len, needle, needle_len);
}

static void highway_copy_u16_to_u8_impl(
    const uint16_t* input,
    size_t count,
    uint8_t* output)
{
    return BUN_HWY_DISPATCH(CopyU16ToU8Impl)(input, count, output);
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
    return BUN_HWY_DISPATCH(IndexOfAnyCharImpl)(text, text_len, chars, chars_len);
}

size_t highway_last_index_of_any_char(const uint8_t* HWY_RESTRICT text, size_t text_len, const uint8_t* HWY_RESTRICT chars, size_t chars_len)
{
    return BUN_HWY_DISPATCH(LastIndexOfAnyCharImpl)(text, text_len, chars, chars_len);
}

size_t highway_index_of_char(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len,
    uint8_t needle)
{
    return BUN_HWY_DISPATCH(IndexOfCharImpl)(haystack, haystack_len, needle);
}

size_t highway_last_index_of_char(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len,
    uint8_t needle)
{
    return BUN_HWY_DISPATCH(LastIndexOfCharImpl)(haystack, haystack_len, needle);
}

size_t highway_index_of_not_char(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len,
    uint8_t value)
{
    return BUN_HWY_DISPATCH(IndexOfNotCharImpl)(haystack, haystack_len, value);
}

size_t highway_count_char(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len,
    uint8_t needle)
{
    return BUN_HWY_DISPATCH(CountCharImpl)(haystack, haystack_len, needle);
}

size_t highway_index_of_escape_char8(const uint8_t* HWY_RESTRICT input, size_t len)
{
    return BUN_HWY_DISPATCH(IndexOfEscapeChar8Impl)(input, len);
}

size_t highway_index_of_escape_char16(const uint16_t* HWY_RESTRICT input, size_t len)
{
    return BUN_HWY_DISPATCH(IndexOfEscapeChar16Impl)(input, len);
}

size_t highway_index_of_html_escape_char8(const uint8_t* HWY_RESTRICT text, size_t text_len)
{
    return BUN_HWY_DISPATCH(IndexOfHTMLEscapeChar8Impl)(text, text_len);
}

size_t highway_index_of_html_escape_char16(const uint16_t* HWY_RESTRICT text, size_t text_len)
{
    return BUN_HWY_DISPATCH(IndexOfHTMLEscapeChar16Impl)(text, text_len);
}

size_t highway_html_escape_extra_len8(const uint8_t* HWY_RESTRICT text, size_t text_len)
{
    return BUN_HWY_DISPATCH(HtmlEscapeExtraLen8Impl)(text, text_len);
}

size_t highway_html_escape_extra_len16(const uint16_t* HWY_RESTRICT text, size_t text_len)
{
    return BUN_HWY_DISPATCH(HtmlEscapeExtraLen16Impl)(text, text_len);
}

size_t highway_index_of_interesting_character_in_string_literal(const uint8_t* HWY_RESTRICT text, size_t text_len, uint8_t quote)
{
    return BUN_HWY_DISPATCH(IndexOfInterestingCharacterInStringLiteralImpl)(text, text_len, quote);
}

size_t highway_index_of_interesting_character_in_multiline_comment(const uint8_t* HWY_RESTRICT text, size_t text_len)
{
    return BUN_HWY_DISPATCH(IndexOfInterestingCharacterInMultilineCommentImpl)(text, text_len);
}

size_t highway_index_of_newline_or_non_ascii(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len)
{
    return BUN_HWY_DISPATCH(IndexOfNewlineOrNonASCIIImpl)(haystack, haystack_len);
}

size_t highway_index_of_newline_or_non_ascii_or_hash_or_at(const uint8_t* HWY_RESTRICT haystack, size_t haystack_len)
{
    return BUN_HWY_DISPATCH(IndexOfNewlineOrNonASCIIOrHashOrAtImpl)(haystack, haystack_len);
}

bool highway_contains_newline_or_non_ascii_or_quote(const uint8_t* HWY_RESTRICT text, size_t text_len)
{
    return BUN_HWY_DISPATCH(ContainsNewlineOrNonASCIIOrQuoteImpl)(text, text_len);
}

size_t highway_index_of_needs_escape_for_javascript_string(const uint8_t* HWY_RESTRICT text, size_t text_len, uint8_t quote_char)
{
    if (quote_char == '`') {
        return BUN_HWY_DISPATCH(IndexOfNeedsEscapeForJavaScriptStringImplBacktick)(text, text_len, quote_char);
    } else {
        return BUN_HWY_DISPATCH(IndexOfNeedsEscapeForJavaScriptStringImplQuote)(text, text_len, quote_char);
    }
}

size_t highway_index_of_space_or_newline_or_non_ascii(const uint8_t* HWY_RESTRICT text, size_t text_len)
{
    return BUN_HWY_DISPATCH(IndexOfSpaceOrNewlineOrNonASCIIImpl)(text, text_len);
}

void highway_fill_with_skip_mask(
    const uint8_t* mask, // 4-byte mask array
    size_t mask_len, // Should be 4
    uint8_t* output, // Output buffer
    const uint8_t* input, // Input buffer
    size_t length, // Length of input/output
    bool skip_mask) // Whether to skip masking
{
    BUN_HWY_DISPATCH(FillWithSkipMaskImpl)(mask, mask_len, output, input, length, skip_mask);
}

void highway_bswap16(uint8_t* data, size_t len)
{
    BUN_HWY_DISPATCH(BSwap16Impl)(data, len);
}

void highway_bswap32(uint8_t* data, size_t len)
{
    BUN_HWY_DISPATCH(BSwap32Impl)(data, len);
}

void highway_bswap64(uint8_t* data, size_t len)
{
    BUN_HWY_DISPATCH(BSwap64Impl)(data, len);
}

size_t highway_visible_latin1_width(const uint8_t* HWY_RESTRICT input, size_t len)
{
    return BUN_HWY_DISPATCH(VisibleLatin1WidthImpl)(input, len);
}

size_t highway_visible_latin1_width_exclude_ansi(const uint8_t* HWY_RESTRICT input, size_t len)
{
    return BUN_HWY_DISPATCH(VisibleLatin1WidthExcludeANSIImpl)(input, len);
}

size_t highway_visible_utf16_width(const uint16_t* HWY_RESTRICT input, size_t len, size_t* HWY_RESTRICT width)
{
    return BUN_HWY_DISPATCH(VisibleUTF16WidthImpl)(input, len, width);
}

size_t highway_count_printable_ascii16(const uint16_t* HWY_RESTRICT input, size_t len)
{
    return BUN_HWY_DISPATCH(CountPrintableAscii16Impl)(input, len);
}

size_t highway_first_non_ascii16(const uint16_t* HWY_RESTRICT input, size_t len)
{
    return BUN_HWY_DISPATCH(FirstNonAscii16Impl)(input, len);
}

size_t highway_first_non_ascii8(const uint8_t* HWY_RESTRICT input, size_t len)
{
    return BUN_HWY_DISPATCH(FirstNonAscii8Impl)(input, len);
}

size_t highway_copy_ascii_prefix(const uint8_t* HWY_RESTRICT src, size_t len, uint8_t* HWY_RESTRICT dst)
{
    return BUN_HWY_DISPATCH(CopyAsciiPrefixImpl)(src, len, dst);
}

size_t highway_index_of_first_ascii_upper(const uint8_t* HWY_RESTRICT input, size_t len)
{
    return BUN_HWY_DISPATCH(IndexOfFirstAsciiUpperImpl)(input, len);
}

void highway_lower_ascii(const uint8_t* HWY_RESTRICT src, size_t len, uint8_t* HWY_RESTRICT dst)
{
    BUN_HWY_DISPATCH(LowerAsciiImpl)(src, len, dst);
}

size_t highway_index_of_first_ascii_upper16(const uint16_t* HWY_RESTRICT input, size_t len)
{
    return BUN_HWY_DISPATCH(IndexOfFirstAsciiUpper16Impl)(input, len);
}

void highway_lower_ascii16(const uint16_t* HWY_RESTRICT src, size_t len, uint16_t* HWY_RESTRICT dst)
{
    BUN_HWY_DISPATCH(LowerAscii16Impl)(src, len, dst);
}

void highway_encode_hex_lower(const uint8_t* HWY_RESTRICT input, size_t len, uint8_t* HWY_RESTRICT output)
{
    BUN_HWY_DISPATCH(EncodeHexLowerImpl)(input, len, output);
}

size_t highway_decode_hex8(const uint8_t* HWY_RESTRICT input, uint8_t* HWY_RESTRICT output, size_t out_len)
{
    return BUN_HWY_DISPATCH(DecodeHex8Impl)(input, output, out_len);
}

size_t highway_decode_hex16(const uint16_t* HWY_RESTRICT input, uint8_t* HWY_RESTRICT output, size_t out_len)
{
    return BUN_HWY_DISPATCH(DecodeHex16Impl)(input, output, out_len);
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
