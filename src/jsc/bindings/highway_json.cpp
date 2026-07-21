// SIMD structural indexer for JSON (simdjson-style "stage 1"), runtime-dispatched via Google
// Highway. Plain JSON only: a `/` or `'` outside a string sets BUN_JSON_IDX_ODDITY and returns.

// BitsFromMask needs a fixed-width vector; Highway only provides it for the
// fixed-size SVE_256/SVE2_128 variants, not scalable SVE/SVE2. clang >= 22
// stops marking scalable SVE as HWY_BROKEN, so disable it here explicitly.
#undef HWY_DISABLED_TARGETS
#define HWY_DISABLED_TARGETS (HWY_SVE | HWY_SVE2)

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_json.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>

#include <string.h>

#include "json_byte_class.h"

#define BUN_JSON_IDX_HAS_BACKSLASH_IN_STRING (1u << 0)
#define BUN_JSON_IDX_HAS_CTRL_IN_STRING (1u << 1)
#define BUN_JSON_IDX_ODDITY (1u << 3)

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

using D8 = hn::CappedTag<uint8_t, 64>;

static HWY_INLINE uint64_t PrefixXor(uint64_t x)
{
    x ^= x << 1;
    x ^= x << 2;
    x ^= x << 4;
    x ^= x << 8;
    x ^= x << 16;
    x ^= x << 32;
    return x;
}

size_t JsonIndexImpl(const uint8_t* HWY_RESTRICT input, size_t len, size_t base_offset,
    uint32_t* HWY_RESTRICT out, uint64_t* HWY_RESTRICT out_dirty,
    uint64_t* HWY_RESTRICT inout_state, uint32_t* HWY_RESTRICT out_flags)
{
    const D8 d;
    const size_t N = hn::Lanes(d);
    const hn::ScalableTag<uint32_t> d32;
    const size_t L = hn::Lanes(d32);

    const auto v_bs = hn::Set(d, (uint8_t)'\\');
    const auto v_quote = hn::Set(d, (uint8_t)'"');
    const auto v_0f = hn::Set(d, (uint8_t)0x0f);
    const auto lut_lo = hn::LoadDup128(d, kBunJsonLutLo);
    const auto lut_hi = hn::LoadDup128(d, kBunJsonLutHi);
    const auto v_op_bits = hn::Set(d, (uint8_t)BUN_JSON_CLASS_STRUCTURAL);
    const auto v_opws_bits = hn::Set(d, (uint8_t)(BUN_JSON_CLASS_STRUCTURAL | BUN_JSON_CLASS_WHITESPACE));
    const auto v_odd_bits = hn::Set(d, (uint8_t)BUN_JSON_CLASS_ODDITY);
    const auto v_ctrl_bits = hn::Set(d, (uint8_t)BUN_JSON_CLASS_CONTROL);
    const auto v_zero = hn::Zero(d);
    const auto iota32 = hn::Iota(d32, 0);

    uint64_t prev_escaped = inout_state[0];
    uint64_t prev_in_string = inout_state[1];
    uint64_t prev_scalar = inout_state[2];
    uint64_t acc_bs_in_str = 0;
    uint64_t acc_ctrl_in_str = 0;
    uint64_t dirty_acc = 0;
    uint32_t flags = 0;
    size_t n_out = 0;

    size_t pos = 0;
    while (pos < len) {
        const uint8_t* p = input + pos;
        size_t rem = len - pos;
        uint64_t valid = ~(uint64_t)0;
        uint8_t tmp[64];
        if (rem < 64) {
            memset(tmp, 0, sizeof(tmp));
            memcpy(tmp, p, rem);
            p = tmp;
            valid = (((uint64_t)1) << rem) - 1;
        }

        uint64_t m_bs = 0, m_quote = 0, m_op = 0, m_opws = 0, m_odd = 0, m_ctrl = 0;
        for (size_t v = 0; v < 64 / N; ++v) {
            const auto chunk = hn::LoadU(d, p + v * N);
            const unsigned sh = (unsigned)(v * N);
            m_bs |= hn::BitsFromMask(d, hn::Eq(chunk, v_bs)) << sh;
            m_quote |= hn::BitsFromMask(d, hn::Eq(chunk, v_quote)) << sh;
            const auto cls = hn::And(hn::TableLookupBytes(lut_lo, hn::And(chunk, v_0f)),
                hn::TableLookupBytes(lut_hi, hn::ShiftRight<4>(chunk)));
            m_op |= hn::BitsFromMask(d, hn::Ne(hn::And(cls, v_op_bits), v_zero)) << sh;
            m_opws |= hn::BitsFromMask(d, hn::Ne(hn::And(cls, v_opws_bits), v_zero)) << sh;
            m_odd |= hn::BitsFromMask(d, hn::Ne(hn::And(cls, v_odd_bits), v_zero)) << sh;
            m_ctrl |= hn::BitsFromMask(d, hn::Ne(hn::And(cls, v_ctrl_bits), v_zero)) << sh;
        }

        uint64_t escaped;
        if (m_bs == 0) {
            escaped = prev_escaped;
            prev_escaped = 0;
        } else {
            const uint64_t even_bits = 0x5555555555555555ULL;
            uint64_t bs = m_bs & ~prev_escaped;
            uint64_t follows_escape = (bs << 1) | prev_escaped;
            uint64_t odd_sequence_starts = bs & ~even_bits & ~follows_escape;
            uint64_t sequences_starting_on_even_bits;
            prev_escaped = __builtin_add_overflow(odd_sequence_starts, bs, &sequences_starting_on_even_bits)
                ? 1
                : 0;
            uint64_t invert_mask = sequences_starting_on_even_bits << 1;
            escaped = (even_bits ^ invert_mask) & follows_escape;
        }

        const uint64_t rq = m_quote & ~escaped;
        const uint64_t in_str = PrefixXor(rq) ^ prev_in_string;
        prev_in_string = (uint64_t)((int64_t)in_str >> 63);

        const uint64_t dirty = (m_bs | m_ctrl) & in_str & valid;
        acc_bs_in_str |= m_bs & in_str & valid;
        acc_ctrl_in_str |= m_ctrl & in_str & valid;
        const size_t block = pos >> 6;
        dirty_acc |= (uint64_t)(dirty != 0) << (block & 63);
        if ((block & 63) == 63) {
            out_dirty[block >> 6] = dirty_acc;
            dirty_acc = 0;
        }

        if (m_odd & ~in_str & valid) {
            *out_flags = flags | BUN_JSON_IDX_ODDITY;
            return 0;
        }

        const uint64_t op_out = m_op & ~in_str;
        const uint64_t scalar = ~m_opws & ~in_str & ~rq;
        const uint64_t scalar_start = scalar & ~((scalar << 1) | prev_scalar);
        prev_scalar = scalar >> 63;
        const uint64_t emit = (op_out | rq | scalar_start) & valid;

        const uint32_t base = (uint32_t)(base_offset + pos);
        for (size_t k = 0; k < 64; k += L) {
            uint64_t slice = (emit >> k) & (L >= 64 ? ~(uint64_t)0 : (((uint64_t)1 << L) - 1));
            uint8_t slice_bytes[8];
            memcpy(slice_bytes, &slice, 8);
            const auto m = hn::LoadMaskBits(d32, slice_bytes);
            const auto v = hn::Add(hn::Set(d32, base + (uint32_t)k), iota32);
            n_out += hn::CompressStore(v, m, d32, out + n_out);
        }

        pos += 64;
    }

    const size_t nblocks = (len + 63) >> 6;
    if (nblocks != 0 && (nblocks & 63) != 0) {
        out_dirty[(nblocks - 1) >> 6] = dirty_acc;
    }

    if (acc_bs_in_str) flags |= BUN_JSON_IDX_HAS_BACKSLASH_IN_STRING;
    if (acc_ctrl_in_str) flags |= BUN_JSON_IDX_HAS_CTRL_IN_STRING;
    *out_flags = flags;
    inout_state[0] = prev_escaped;
    inout_state[1] = prev_in_string;
    inout_state[2] = prev_scalar;
    return n_out;
}

// NOLINTNEXTLINE(google-readability-namespace-comments)
} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {
HWY_EXPORT(JsonIndexImpl);

// Resumable form. Sentinels are the caller's job.
extern "C" size_t highway_json_index_chunk(const uint8_t* input, size_t len, size_t base_offset,
    uint32_t* out_indices, uint64_t* out_dirty, uint64_t* inout_state, uint32_t* out_flags)
{
    return HWY_DYNAMIC_DISPATCH(JsonIndexImpl)(
        input, len, base_offset, out_indices, out_dirty, inout_state, out_flags);
}

// Whole-document form; appends the two `len` sentinels stage 2 relies on.
extern "C" size_t highway_json_index(const uint8_t* input, size_t len, uint32_t* out_indices,
    uint64_t* out_dirty, uint32_t* out_flags)
{
    uint64_t state[3] = { 0, 0, 0 };
    size_t n = HWY_DYNAMIC_DISPATCH(JsonIndexImpl)(
        input, len, 0, out_indices, out_dirty, state, out_flags);
    out_indices[n] = (uint32_t)len;
    out_indices[n + 1] = (uint32_t)len;
    return n;
}
} // namespace bun
#endif
