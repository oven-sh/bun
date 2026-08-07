// SIMD structural indexer for XML ("stage 1"), runtime-dispatched via Google Highway.
// Emits the position of every `<`, `>`, `&`, `\r` and forbidden control character, of the last
// byte of an encoded U+FFFE / U+FFFF (EF BF BE|BF — the only non-characters valid UTF-8 can
// hold), and, between a `<` and the next `>`, of every `\t`, `\n`, `"`, `'` and `=` as well.

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_xml.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>

#include <string.h>

#include "xml_byte_class.h"

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

using D8 = hn::CappedTag<uint8_t, 64>;

size_t XmlIndexImpl(const uint8_t* HWY_RESTRICT input, size_t len, size_t base_offset,
    uint32_t* HWY_RESTRICT out, uint64_t* HWY_RESTRICT inout_state)
{
    const D8 d;
    const size_t N = hn::Lanes(d);
    const hn::ScalableTag<uint32_t> d32;
    const size_t L = hn::Lanes(d32);

    const auto v_0f = hn::Set(d, (uint8_t)0x0f);
    const auto lut_lo = hn::LoadDup128(d, kBunXmlLutLo);
    const auto lut_hi = hn::LoadDup128(d, kBunXmlLutHi);
    const auto v_lt_bits = hn::Set(d, (uint8_t)BUN_XML_CLASS_LT);
    const auto v_gt_bits = hn::Set(d, (uint8_t)BUN_XML_CLASS_GT);
    const auto v_always_bits = hn::Set(d, (uint8_t)BUN_XML_CLASS_ALWAYS);
    const auto v_tag_bits = hn::Set(d, (uint8_t)BUN_XML_CLASS_TAG);
    const auto v_zero = hn::Zero(d);
    const auto v_01 = hn::Set(d, (uint8_t)0x01);
    const auto v_ef = hn::Set(d, (uint8_t)0xEF);
    const auto v_bf = hn::Set(d, (uint8_t)0xBF);
    const auto iota32 = hn::Iota(d32, 0);

    // Whether the previous block ended inside `<` … `>`.
    uint64_t carry = inout_state[0];
    // The previous block's 0xEF / 0xBF masks (for a non-character straddling blocks).
    uint64_t prev_ef = inout_state[1];
    uint64_t prev_bf = inout_state[2];
    size_t n_out = 0;

    size_t pos = 0;
    while (pos < len) {
        const uint8_t* p = input + pos;
        size_t rem = len - pos;
        uint64_t valid = ~(uint64_t)0;
        uint8_t tmp[64];
        if (rem < 64) {
            memset(tmp, 0x20, sizeof(tmp));
            memcpy(tmp, p, rem);
            p = tmp;
            valid = (((uint64_t)1) << rem) - 1;
        }

        uint64_t m_lt = 0, m_gt = 0, m_always = 0, m_tag = 0, m_ef = 0, m_bf = 0, m_bebf = 0;
        for (size_t v = 0; v < 64 / N; ++v) {
            const auto chunk = hn::LoadU(d, p + v * N);
            const unsigned sh = (unsigned)(v * N);
            const auto cls = hn::And(hn::TableLookupBytes(lut_lo, hn::And(chunk, v_0f)),
                hn::TableLookupBytes(lut_hi, hn::ShiftRight<4>(chunk)));
            m_lt |= hn::BitsFromMask(d, hn::Ne(hn::And(cls, v_lt_bits), v_zero)) << sh;
            m_gt |= hn::BitsFromMask(d, hn::Ne(hn::And(cls, v_gt_bits), v_zero)) << sh;
            m_always |= hn::BitsFromMask(d, hn::Ne(hn::And(cls, v_always_bits), v_zero)) << sh;
            m_tag |= hn::BitsFromMask(d, hn::Ne(hn::And(cls, v_tag_bits), v_zero)) << sh;
            m_ef |= hn::BitsFromMask(d, hn::Eq(chunk, v_ef)) << sh;
            m_bf |= hn::BitsFromMask(d, hn::Eq(chunk, v_bf)) << sh;
            m_bebf |= hn::BitsFromMask(d, hn::Eq(hn::Or(chunk, v_01), v_bf)) << sh;
        }
        const uint64_t m_nonchar = m_bebf & ((m_bf << 1) | (prev_bf >> 63)) & ((m_ef << 2) | (prev_ef >> 62));
        prev_ef = m_ef;
        prev_bf = m_bf;

        // in_tag = MatchStar(m_lt, ~m_gt): every position reachable from a `<` through
        // non-`>` bytes (the `>` itself included), with the addition's carry linking blocks.
        const uint64_t run = ~m_gt;
        uint64_t sum;
        uint64_t c1 = __builtin_add_overflow(m_lt & run, run, &sum) ? 1 : 0;
        uint64_t c2 = __builtin_add_overflow(sum, carry, &sum) ? 1 : 0;
        carry = c1 | c2;
        const uint64_t in_tag = (sum ^ run) | m_lt;

        const uint64_t emit = (m_lt | m_gt | m_always | m_nonchar | (m_tag & in_tag)) & valid;

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

    inout_state[0] = carry;
    inout_state[1] = prev_ef;
    inout_state[2] = prev_bf;
    return n_out;
}

// NOLINTNEXTLINE(google-readability-namespace-comments)
} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {
HWY_EXPORT(XmlIndexImpl);

// Resumable form. Sentinels are the caller's job.
extern "C" size_t highway_xml_index_chunk(const uint8_t* input, size_t len, size_t base_offset,
    uint32_t* out_indices, uint64_t* inout_state)
{
    return HWY_DYNAMIC_DISPATCH(XmlIndexImpl)(input, len, base_offset, out_indices, inout_state);
}
} // namespace bun
#endif
