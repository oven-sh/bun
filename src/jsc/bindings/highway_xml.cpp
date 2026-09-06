// SIMD structural indexer for XML ("stage 1"), runtime-dispatched via Google Highway, over
// bytes (UTF-8 / Latin-1) or over UTF-16 code units. Emits the position of every `<`, `>`, `&`,
// `\r` and forbidden control character, of a non-character (bytes: the last byte of an encoded
// U+FFFE / U+FFFF, EF BF BE|BF; units: 0xFFFE / 0xFFFF), and, between a `<` and the next `>`, of
// every `\t`, `\n`, `"`, `'` and `=` as well.

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_xml.cpp"
// BitsFromMask only defined for fixed-size SVE (SVE2_128/SVE_256) and
// NEON, not for scalable SVE/SVE2. Disable all SVE on ARM64 and use NEON
// instead. Not gated on __OHOS__ — any aarch64 host using scalable SVE
// hits the same missing symbol (same guard as highway_sourcemap.cpp).
#if defined(__aarch64__)
#define HWY_DISABLED_TARGETS (HWY_ALL_SVE)
#endif
#include <hwy/foreach_target.h>
#include <hwy/highway.h>
#include "highway_dispatch.h"

#include <string.h>

#include "xml_byte_class.h"

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

using D8 = hn::CappedTag<uint8_t, 64>;

// The classes of one 64-position block, as bit masks.
struct BlockMasks {
    uint64_t lt = 0, gt = 0, always = 0, tag = 0, nonchar = 0;
};

// Classifies one vector of (low) bytes and ORs its masks in at `sh`.
template<class V>
static HWY_INLINE void Classify(D8 d, V lo, unsigned sh, BlockMasks& m)
{
    const auto v_0f = hn::Set(d, (uint8_t)0x0f);
    const auto lut_lo = hn::LoadDup128(d, kBunXmlLutLo);
    const auto lut_hi = hn::LoadDup128(d, kBunXmlLutHi);
    const auto v_zero = hn::Zero(d);
    const auto cls = hn::And(hn::TableLookupBytes(lut_lo, hn::And(lo, v_0f)),
        hn::TableLookupBytes(lut_hi, hn::ShiftRight<4>(lo)));
    m.lt |= hn::BitsFromMask(d, hn::Ne(hn::And(cls, hn::Set(d, (uint8_t)BUN_XML_CLASS_LT)), v_zero)) << sh;
    m.gt |= hn::BitsFromMask(d, hn::Ne(hn::And(cls, hn::Set(d, (uint8_t)BUN_XML_CLASS_GT)), v_zero)) << sh;
    m.always |= hn::BitsFromMask(d, hn::Ne(hn::And(cls, hn::Set(d, (uint8_t)BUN_XML_CLASS_ALWAYS)), v_zero)) << sh;
    m.tag |= hn::BitsFromMask(d, hn::Ne(hn::And(cls, hn::Set(d, (uint8_t)BUN_XML_CLASS_TAG)), v_zero)) << sh;
}

// The part both kernels share: `in_tag` = MatchStar(lt, ~gt) — every position reachable from a
// `<` through non-`>` positions (the `>` included), the addition's carry linking blocks — then
// the positions to emit, compressed out as `base`-relative indices. Returns how many.
static HWY_INLINE size_t EmitBlock(const BlockMasks& m, uint64_t valid, uint64_t& carry, uint32_t base,
    uint32_t* HWY_RESTRICT out)
{
    const hn::ScalableTag<uint32_t> d32;
    const size_t L = hn::Lanes(d32);
    const uint64_t run = ~m.gt;
    uint64_t sum;
    uint64_t c1 = __builtin_add_overflow(m.lt & run, run, &sum) ? 1 : 0;
    uint64_t c2 = __builtin_add_overflow(sum, carry, &sum) ? 1 : 0;
    carry = c1 | c2;
    const uint64_t in_tag = (sum ^ run) | m.lt;
    const uint64_t emit = (m.lt | m.gt | m.always | m.nonchar | (m.tag & in_tag)) & valid;

    size_t n = 0;
    const auto iota32 = hn::Iota(d32, 0);
    for (size_t k = 0; k < 64; k += L) {
        uint64_t slice = (emit >> k) & (L >= 64 ? ~(uint64_t)0 : (((uint64_t)1 << L) - 1));
        uint8_t slice_bytes[8];
        memcpy(slice_bytes, &slice, 8);
        const auto mask = hn::LoadMaskBits(d32, slice_bytes);
        const auto v = hn::Add(hn::Set(d32, base + (uint32_t)k), iota32);
        n += hn::CompressStore(v, mask, d32, out + n);
    }
    return n;
}

size_t XmlIndexImpl(const uint8_t* HWY_RESTRICT input, size_t len, size_t base_offset,
    uint32_t* HWY_RESTRICT out, uint64_t* HWY_RESTRICT inout_state)
{
    const D8 d;
    const size_t N = hn::Lanes(d);
    const auto v_01 = hn::Set(d, (uint8_t)0x01);
    const auto v_ef = hn::Set(d, (uint8_t)0xEF);
    const auto v_bf = hn::Set(d, (uint8_t)0xBF);

    // Whether the previous block ended inside `<` … `>`.
    uint64_t carry = inout_state[0];
    // The previous block's 0xEF / 0xBF masks (for a non-character straddling blocks).
    uint64_t prev_ef = inout_state[1];
    uint64_t prev_bf = inout_state[2];
    size_t n_out = 0;

    for (size_t pos = 0; pos < len; pos += 64) {
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

        BlockMasks m;
        uint64_t m_ef = 0, m_bf = 0, m_bebf = 0;
        for (size_t v = 0; v < 64 / N; ++v) {
            const auto chunk = hn::LoadU(d, p + v * N);
            const unsigned sh = (unsigned)(v * N);
            Classify(d, chunk, sh, m);
            m_ef |= hn::BitsFromMask(d, hn::Eq(chunk, v_ef)) << sh;
            m_bf |= hn::BitsFromMask(d, hn::Eq(chunk, v_bf)) << sh;
            m_bebf |= hn::BitsFromMask(d, hn::Eq(hn::Or(chunk, v_01), v_bf)) << sh;
        }
        m.nonchar = m_bebf & ((m_bf << 1) | (prev_bf >> 63)) & ((m_ef << 2) | (prev_ef >> 62));
        prev_ef = m_ef;
        prev_bf = m_bf;

        n_out += EmitBlock(m, valid, carry, (uint32_t)(base_offset + pos), out + n_out);
    }

    inout_state[0] = carry;
    inout_state[1] = prev_ef;
    inout_state[2] = prev_bf;
    return n_out;
}

// The same over UTF-16 code units (`len` and positions in units): a unit classifies as its low
// byte when its high byte is zero; 0xFFFE / 0xFFFF are the non-characters, and a surrogate that
// is not half of a pair is flagged too (a lone lead surrogate ending a block is decided, and
// emitted first, when the next block sees what follows; the caller settles one that ends the input).
size_t XmlIndex16Impl(const uint16_t* HWY_RESTRICT input, size_t len, size_t base_offset,
    uint32_t* HWY_RESTRICT out, uint64_t* HWY_RESTRICT inout_state)
{
    const D8 d;
    const size_t N = hn::Lanes(d);
    const auto v_zero = hn::Zero(d);
    const auto v_01 = hn::Set(d, (uint8_t)0x01);
    const auto v_ff = hn::Set(d, (uint8_t)0xFF);
    const auto v_fc = hn::Set(d, (uint8_t)0xFC);
    const auto v_d8 = hn::Set(d, (uint8_t)0xD8);
    const auto v_dc = hn::Set(d, (uint8_t)0xDC);

    uint64_t carry = inout_state[0];
    // Bit 0: the previous block's last unit was a lead surrogate (still owed a trail).
    uint64_t prev_lead = inout_state[1];
    size_t n_out = 0;

    for (size_t pos = 0; pos < len; pos += 64) {
        const uint8_t* p = reinterpret_cast<const uint8_t*>(input + pos);
        size_t rem = len - pos;
        uint64_t valid = ~(uint64_t)0;
        uint16_t tmp[64];
        if (rem < 64) {
            for (size_t i = 0; i < 64; ++i)
                tmp[i] = 0x20;
            memcpy(tmp, p, rem * 2);
            p = reinterpret_cast<const uint8_t*>(tmp);
            valid = (((uint64_t)1) << rem) - 1;
        }

        BlockMasks m;
        uint64_t lead = 0, trail = 0;
        // Each pair of byte vectors covers N units: even bytes are the (little-endian) low
        // bytes, odd bytes the high bytes.
        for (size_t v = 0; v < 64 / N; ++v) {
            const auto a = hn::LoadU(d, p + v * 2 * N);
            const auto b = hn::LoadU(d, p + v * 2 * N + N);
            const auto lo = hn::ConcatEven(d, b, a);
            const auto hi = hn::ConcatOdd(d, b, a);
            const unsigned sh = (unsigned)(v * N);
            BlockMasks unit;
            Classify(d, lo, 0, unit);
            const uint64_t ascii = hn::BitsFromMask(d, hn::Eq(hi, v_zero));
            m.lt |= (unit.lt & ascii) << sh;
            m.gt |= (unit.gt & ascii) << sh;
            m.always |= (unit.always & ascii) << sh;
            m.tag |= (unit.tag & ascii) << sh;
            const uint64_t nonchar = hn::BitsFromMask(d, hn::And(hn::Eq(hi, v_ff), hn::Eq(hn::Or(lo, v_01), v_ff)));
            m.nonchar |= nonchar << sh;
            const auto plane = hn::And(hi, v_fc);
            lead |= hn::BitsFromMask(d, hn::Eq(plane, v_d8)) << sh;
            trail |= hn::BitsFromMask(d, hn::Eq(plane, v_dc)) << sh;
        }
        lead &= valid;
        trail &= valid;
        // A trail with no lead before it; a lead with no trail after it (bit 63 waits).
        const uint64_t lone = (trail & ~((lead << 1) | prev_lead)) | (lead & ~(trail >> 1) & ~(1ull << 63));
        if (prev_lead && !(trail & 1))
            out[n_out++] = (uint32_t)(base_offset + pos - 1);
        prev_lead = lead >> 63;
        m.nonchar |= lone;

        n_out += EmitBlock(m, valid, carry, (uint32_t)(base_offset + pos), out + n_out);
    }

    inout_state[0] = carry;
    inout_state[1] = prev_lead;
    return n_out;
}

// NOLINTNEXTLINE(google-readability-namespace-comments)
} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {
HWY_EXPORT(XmlIndexImpl);
HWY_EXPORT(XmlIndex16Impl);

// Resumable forms. Sentinels are the caller's job.
extern "C" size_t highway_xml_index_chunk(const uint8_t* input, size_t len, size_t base_offset,
    uint32_t* out_indices, uint64_t* inout_state)
{
    return BUN_HWY_DISPATCH(XmlIndexImpl)(input, len, base_offset, out_indices, inout_state);
}

extern "C" size_t highway_xml_index16_chunk(const uint16_t* input, size_t len, size_t base_offset,
    uint32_t* out_indices, uint64_t* inout_state)
{
    return BUN_HWY_DISPATCH(XmlIndex16Impl)(input, len, base_offset, out_indices, inout_state);
}
} // namespace bun
#endif
