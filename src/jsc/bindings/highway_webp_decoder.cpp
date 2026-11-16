// The kernels of the WebP decoder in src/webp, runtime-dispatched via Google Highway. src/highway/webp.rs says what
// each takes.

// A macroblock is 16 samples of luma wide and twice 8 of chroma, so 256 bits are the most that get filled, and the
// transposes keep vectors in arrays. So this is the list in scripts/build/deps/highway.ts and more: the rest of SVE,
// whatever is newer than AVX2, and what is no faster here than SSSE3 or the NEON without AES.
#undef HWY_DISABLED_TARGETS
#define HWY_DISABLED_TARGETS (HWY_ALL_SVE | HWY_NEON | HWY_NEON_BF16 | HWY_SSE4 | (HWY_AVX2 - 1))
#ifndef __OPTIMIZE__
#error "Unless hwy::ChosenTarget::GetIndex() is inlined, the linker may keep that of a file with other targets."
#endif

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_webp_decoder.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>
#include "highway_dispatch.h"

#include <stddef.h>
#include <stdint.h>

#ifndef BUN_WEBP_DECODER_TYPES
#define BUN_WEBP_DECODER_TYPES
namespace bun {
// bun_highway::webp::FilterStrength
struct WebpFilterStrength {
    uint8_t edge_limit;
    uint8_t interior_limit;
    uint8_t high_variance_threshold;
    bool filters_inner_edges;
};
} // namespace bun
#endif

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

using D8 = hn::FixedTag<uint8_t, 8>;
using D16 = hn::FixedTag<uint8_t, 16>;

template<typename T, class D, class V = hn::Vec<D>>
static HWY_INLINE V InterleaveLowerAs(D d, V a, V b)
{
    const hn::Repartition<T, D> as;
    return hn::BitCast(d, hn::InterleaveLower(as, hn::BitCast(as, a), hn::BitCast(as, b)));
}

template<typename T, class D, class V = hn::Vec<D>>
static HWY_INLINE V InterleaveUpperAs(D d, V a, V b)
{
    const hn::Repartition<T, D> as;
    return hn::BitCast(d, hn::InterleaveUpper(as, hn::BitCast(as, a), hn::BitCast(as, b)));
}

// ─── Inverse DCT ────────────────────────────────────────────────────────────

// Each four lanes are a row of a block.
template<class D, class V = hn::Vec<D>>
static HWY_INLINE void Transpose4x4(D d, V& v0, V& v1, V& v2, V& v3)
{
    const V a0 = hn::InterleaveLower(d, v0, v1);
    const V a1 = hn::InterleaveLower(d, v2, v3);
    const V a2 = hn::InterleaveUpper(d, v0, v1);
    const V a3 = hn::InterleaveUpper(d, v2, v3);
    const V b0 = InterleaveLowerAs<uint32_t>(d, a0, a1);
    const V b1 = InterleaveLowerAs<uint32_t>(d, a2, a3);
    const V b2 = InterleaveUpperAs<uint32_t>(d, a0, a1);
    const V b3 = InterleaveUpperAs<uint32_t>(d, a2, a3);
    v0 = InterleaveLowerAs<uint64_t>(d, b0, b1);
    v1 = InterleaveUpperAs<uint64_t>(d, b0, b1);
    v2 = InterleaveLowerAs<uint64_t>(d, b2, b3);
    v3 = InterleaveUpperAs<uint64_t>(d, b2, b3);
}

template<class D, class V = hn::Vec<D>>
static HWY_INLINE void InverseDctPass(D d, V& v0, V& v1, V& v2, V& v3)
{
    // RFC 6386 section 14.4. The factors are 85627 and 35468 out of 65536. What is multiplied by is 65536 less.
    const auto times_cos = [&](V x) HWY_ATTR { return hn::Add(x, hn::MulHigh(x, hn::Set(d, 20091))); };
    const auto times_sin = [&](V x) HWY_ATTR { return hn::Add(x, hn::MulHigh(x, hn::Set(d, -30068))); };
    const V a = hn::Add(v0, v2);
    const V b = hn::Sub(v0, v2);
    const V c = hn::Sub(times_sin(v1), times_cos(v3));
    const V e = hn::Add(times_cos(v1), times_sin(v3));
    v0 = hn::Add(a, e);
    v1 = hn::Add(b, c);
    v2 = hn::Sub(b, c);
    v3 = hn::Sub(a, e);
}

void WebpInverseDct(int16_t* HWY_RESTRICT coefficients, uint32_t non_zero)
{
    const hn::CappedTag<int16_t, 16> d;
    constexpr size_t kBlocks = hn::MaxLanes(d) / 4;
    for (size_t block = 0; block < 24; block += kBlocks, non_zero >>= kBlocks) {
        if ((non_zero & ((1u << kBlocks) - 1)) == 0) continue;
        int16_t* const at = coefficients + block / 4 * 64 + block % 4 * 4;
        auto v0 = hn::LoadU(d, at), v1 = hn::LoadU(d, at + 16), v2 = hn::LoadU(d, at + 32), v3 = hn::LoadU(d, at + 48);
        InverseDctPass(d, v0, v1, v2, v3);
        Transpose4x4(d, v0, v1, v2, v3);
        v0 = hn::SaturatedAdd(v0, hn::Set(d, 4));
        InverseDctPass(d, v0, v1, v2, v3);
        Transpose4x4(d, v0, v1, v2, v3);
        hn::StoreU(hn::ShiftRight<3>(v0), d, at);
        hn::StoreU(hn::ShiftRight<3>(v1), d, at + 16);
        hn::StoreU(hn::ShiftRight<3>(v2), d, at + 32);
        hn::StoreU(hn::ShiftRight<3>(v3), d, at + 48);
    }
}

// ─── Prediction of subblocks ────────────────────────────────────────────────
//
// RFC 6386 section 12.3. The edge of a subblock goes up along its left side, around the corner, and along the top to
// four samples beyond its end: L K J I X A B C D E F G H. In a vector the first and the last are there twice.

constexpr uint8_t kNone = 0x80;
constexpr uint8_t kTrueMotion = 1;

// For each sample where it is found: lane n of the averages of three neighbors on the edge, in whose lane 15 is the
// average of L K J I A B C D, or with 16 added, lane n of the averages of two.
alignas(16) constexpr uint8_t kSubblockSources[10][16] = {
    { 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15 }, // Dc
    {}, // TrueMotion
    { 5, 6, 7, 8, 5, 6, 7, 8, 5, 6, 7, 8, 5, 6, 7, 8 }, // Vertical
    { 3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0 }, // Horizontal
    { 4, 5, 6, 7, 3, 4, 5, 6, 2, 3, 4, 5, 1, 2, 3, 4 }, // RightDown
    { 21, 22, 23, 24, 4, 5, 6, 7, 3, 21, 22, 23, 2, 4, 5, 6 }, // VerticalRight
    { 6, 7, 8, 9, 7, 8, 9, 10, 8, 9, 10, 11, 9, 10, 11, 12 }, // LeftDown
    { 22, 23, 24, 25, 6, 7, 8, 9, 23, 24, 25, 10, 7, 8, 9, 11 }, // VerticalLeft
    { 20, 4, 5, 6, 19, 3, 20, 4, 18, 2, 19, 3, 17, 1, 18, 2 }, // HorizontalDown
    { 19, 2, 18, 1, 18, 1, 17, 0, 17, 0, 16, 16, 16, 16, 16, 16 }, // HorizontalUp
};

template<typename... Lanes>
static HWY_INLINE hn::Vec<D16> Pick(hn::Vec<D16> from, Lanes... lanes)
{
    return hn::TableLookupBytesOr0(from, hn::Dup128VecFromValues(D16(), static_cast<uint8_t>(lanes)...));
}

// The modes are too hard to guess for a branch. Returns four rows of four.
static HWY_INLINE hn::Vec<D16> ReconstructSubblock(hn::Vec<D16> edge, uint8_t mode, const int16_t* HWY_RESTRICT residuals)
{
    const D16 d;
    using V = hn::Vec<D16>;
    const V next = hn::ShiftRightBytes<1>(d, edge);
    const V after_next = hn::ShiftRightBytes<2>(d, edge);
    const V outer = hn::Sub(hn::AverageRound(edge, after_next), hn::And(hn::Xor(edge, after_next), hn::Set(d, 1)));
    const hn::Repartition<uint64_t, D16> d64;
    const auto sum = hn::SumsOf8(Pick(edge, kNone, kNone, kNone, kNone, kNone, kNone, kNone, kNone, 1, 2, 3, 4, 6, 7, 8, 9));
    // Its three lowest bits end up in lane 14. Lane 15 of the others is zero, or becomes it.
    const V dc = hn::BitCast(d, hn::ShiftLeft<53>(hn::Add(sum, hn::Dup128VecFromValues(d64, 0, 4))));
    const V of_three = hn::Or(hn::AverageRound(outer, next), dc);
    const V of_two = hn::AverageRound(edge, next);
    const V sources = hn::Load(d, kSubblockSources[HWY_MIN(mode, 9)]);
    // A lookup gives zero if the highest bit is set, and looks at four bits besides on x86, but at all on Arm.
    const V directional = hn::Or(hn::TableLookupBytesOr0(of_three, hn::And(hn::Add(sources, hn::Set(d, 0x70)), hn::Set(d, 0x8f))),
        hn::TableLookupBytesOr0(of_two, hn::Sub(sources, hn::Set(d, 16))));

    const V above = Pick(edge, 6, 7, 8, 9, 6, 7, 8, 9, 6, 7, 8, 9, 6, 7, 8, 9);
    const V left = Pick(edge, 4, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1);
    const V corner = hn::Broadcast<5>(edge);
    const V true_motion = hn::SaturatedSub(hn::SaturatedAdd(above, hn::SaturatedSub(left, corner)), hn::SaturatedSub(corner, left));
    const V predicted = hn::IfVecThenElse(hn::Set(d, mode == kTrueMotion ? 0xff : 0), true_motion, directional);

    const hn::Repartition<int16_t, D16> wide;
    const hn::Half<decltype(wide)> row;
    const auto upper = hn::Combine(wide, hn::LoadU(row, residuals + 16), hn::LoadU(row, residuals));
    const auto lower = hn::Combine(wide, hn::LoadU(row, residuals + 48), hn::LoadU(row, residuals + 32));
    return hn::OrderedDemote2To(d, hn::Add(upper, hn::PromoteLowerTo(wide, predicted)), hn::Add(lower, hn::PromoteUpperTo(wide, predicted)));
}

void WebpReconstructSubblocks(const uint8_t* HWY_RESTRICT above, const uint8_t* HWY_RESTRICT above_right, const uint8_t* HWY_RESTRICT left,
    const uint8_t* HWY_RESTRICT modes, const int16_t* HWY_RESTRICT residuals, uint8_t* HWY_RESTRICT samples)
{
    const D16 d;
    using V = hn::Vec<D16>;
    constexpr uint8_t k = kNone;
    const auto load = [&](auto part, const uint8_t* from) HWY_ATTR { return hn::ResizeBitCast(d, hn::LoadU(part, from)); };
    const auto last_column = [&](V block) HWY_ATTR { return Pick(block, 15, 15, 11, 7, 3, k, k, k, k, k, k, k, k, k, k, k); };
    // All rows of subblocks have this at their right end.
    const V beyond = Pick(load(hn::FixedTag<uint8_t, 4>(), above_right), k, k, k, k, k, k, k, k, k, k, 0, 1, 2, 3, 3, k);
    V top = hn::LoadU(d, above);
    for (size_t y = 0; y < 4; y++, left += 4, modes += 4, residuals += 64, samples += 64) {
        const V first_column = Pick(load(D8(), left), 4, 4, 3, 2, 1, 0, k, k, k, k, k, k, k, k, k, k);
        const V b0 = ReconstructSubblock(hn::Or(first_column, Pick(top, k, k, k, k, k, k, 0, 1, 2, 3, 4, 5, 6, 7, 7, k)), modes[0], residuals);
        const V b1 = ReconstructSubblock(hn::Or(last_column(b0), Pick(top, k, k, k, k, k, 3, 4, 5, 6, 7, 8, 9, 10, 11, 11, k)), modes[1], residuals + 4);
        const V b2 = ReconstructSubblock(hn::Or(last_column(b1), Pick(top, k, k, k, k, k, 7, 8, 9, 10, 11, 12, 13, 14, 15, 15, k)), modes[2], residuals + 8);
        const V b3 = ReconstructSubblock(hn::Or3(last_column(b2), Pick(top, k, k, k, k, k, 11, 12, 13, 14, 15, k, k, k, k, k, k), beyond), modes[3], residuals + 12);
        const V upper01 = InterleaveLowerAs<uint32_t>(d, b0, b1), upper23 = InterleaveLowerAs<uint32_t>(d, b2, b3);
        const V lower01 = InterleaveUpperAs<uint32_t>(d, b0, b1), lower23 = InterleaveUpperAs<uint32_t>(d, b2, b3);
        top = InterleaveUpperAs<uint64_t>(d, lower01, lower23);
        hn::StoreU(InterleaveLowerAs<uint64_t>(d, upper01, upper23), d, samples);
        hn::StoreU(InterleaveUpperAs<uint64_t>(d, upper01, upper23), d, samples + 16);
        hn::StoreU(InterleaveLowerAs<uint64_t>(d, lower01, lower23), d, samples + 32);
        hn::StoreU(top, d, samples + 48);
    }
}

// ─── Loop filter ────────────────────────────────────────────────────────────
//
// RFC 6386 section 15. p3 p2 p1 p0 | q0 q1 q2 q3 are the samples across an edge, a lane for each position along it.

template<class D, class V = hn::Vec<D>>
static HWY_INLINE hn::Vec<hn::RebindToSigned<D>> ToSigned(D d, V v)
{
    return hn::BitCast(hn::RebindToSigned<D>(), hn::Xor(v, hn::Set(d, 0x80)));
}

template<class D>
static HWY_INLINE hn::Vec<D> ToUnsigned(D d, hn::Vec<hn::RebindToSigned<D>> v)
{
    return hn::Xor(hn::BitCast(d, v), hn::Set(d, 0x80));
}

template<class D, class V = hn::Vec<D>>
static HWY_INLINE hn::Mask<D> IsAtMost(D d, V v, V limit)
{
    return hn::Eq(hn::SaturatedSub(v, limit), hn::Zero(d));
}

template<class D, class V = hn::Vec<D>>
static HWY_INLINE hn::Mask<D> IsWithinEdgeLimit(D d, V p1, V p0, V q0, V q1, uint8_t limit)
{
    const V inner = hn::AbsDiff(p0, q0);
    const V step = hn::SaturatedAdd(hn::SaturatedAdd(inner, inner), hn::ShiftRight<1>(hn::AbsDiff(p1, q1)));
    return IsAtMost(d, step, hn::Set(d, limit));
}

// `outer` + 3 * (q0 - p0). In this order the saturation on the way makes no difference.
template<class VI>
static HWY_INLINE VI BaseDelta(VI outer, VI p0, VI q0)
{
    const VI step = hn::SaturatedSub(q0, p0);
    return hn::SaturatedAdd(step, hn::SaturatedAdd(step, hn::SaturatedAdd(step, outer)));
}

// Returns what was taken from q0.
template<class VI>
static HWY_INLINE VI AdjustInnermost(VI delta, VI& p0, VI& q0)
{
    const hn::DFromV<VI> di;
    const VI from_q = hn::ShiftRight<3>(hn::SaturatedAdd(delta, hn::Set(di, 4)));
    const VI to_p = hn::ShiftRight<3>(hn::SaturatedAdd(delta, hn::Set(di, 3)));
    q0 = hn::SaturatedSub(q0, from_q);
    p0 = hn::SaturatedAdd(p0, to_p);
    return from_q;
}

// `v` points at p3.
template<class D, class V = hn::Vec<D>>
static HWY_INLINE void FilterSimply(D d, V* v, uint8_t edge_limit)
{
    const hn::RebindToSigned<D> di;
    const auto is_filtered = hn::RebindMask(di, IsWithinEdgeLimit(d, v[2], v[3], v[4], v[5], edge_limit));
    auto p0 = ToSigned(d, v[3]), q0 = ToSigned(d, v[4]);
    const auto outer = hn::SaturatedSub(ToSigned(d, v[2]), ToSigned(d, v[5]));
    AdjustInnermost(hn::IfThenElseZero(is_filtered, BaseDelta(outer, p0, q0)), p0, q0);
    v[3] = ToUnsigned(d, p0);
    v[4] = ToUnsigned(d, q0);
}

template<class D>
struct EdgeMasks {
    hn::Mask<hn::RebindToSigned<D>> is_filtered;
    hn::Mask<hn::RebindToSigned<D>> is_smooth;
};

template<class D, class V = hn::Vec<D>>
static HWY_INLINE EdgeMasks<D> Classify(D d, const V* v, uint8_t edge_limit, WebpFilterStrength strength)
{
    const hn::RebindToSigned<D> di;
    const V variance = hn::Max(hn::AbsDiff(v[2], v[3]), hn::AbsDiff(v[4], v[5]));
    const V p_steps = hn::Max(hn::AbsDiff(v[0], v[1]), hn::AbsDiff(v[1], v[2]));
    const V q_steps = hn::Max(hn::AbsDiff(v[5], v[6]), hn::AbsDiff(v[6], v[7]));
    const auto is_within_interior_limit = IsAtMost(d, hn::Max(variance, hn::Max(p_steps, q_steps)), hn::Set(d, strength.interior_limit));
    return {
        hn::RebindMask(di, hn::And(is_within_interior_limit, IsWithinEdgeLimit(d, v[2], v[3], v[4], v[5], edge_limit))),
        hn::RebindMask(di, IsAtMost(d, variance, hn::Set(d, strength.high_variance_threshold))),
    };
}

// Only in the first `lanes`.
template<class D, class V = hn::Vec<D>>
static HWY_INLINE void FilterInnerEdge(D d, V* v, WebpFilterStrength strength, size_t lanes)
{
    const hn::RebindToSigned<D> di;
    const EdgeMasks<D> masks = Classify(d, v, strength.edge_limit, strength);
    const auto is_filtered = hn::And(masks.is_filtered, hn::FirstN(di, lanes));
    const auto p1 = ToSigned(d, v[2]), q1 = ToSigned(d, v[5]);
    auto p0 = ToSigned(d, v[3]), q0 = ToSigned(d, v[4]);
    const auto outer = hn::IfThenZeroElse(masks.is_smooth, hn::SaturatedSub(p1, q1));
    const auto from_q = AdjustInnermost(hn::IfThenElseZero(is_filtered, BaseDelta(outer, p0, q0)), p0, q0);
    // (from_q + 1) >> 1
    const auto half = hn::Sub(hn::BitCast(di, hn::AverageRound(ToUnsigned(d, from_q), hn::Zero(d))), hn::Set(di, 64));
    const auto delta = hn::IfThenElseZero(masks.is_smooth, half);
    v[2] = ToUnsigned(d, hn::SaturatedAdd(p1, delta));
    v[3] = ToUnsigned(d, p0);
    v[4] = ToUnsigned(d, q0);
    v[5] = ToUnsigned(d, hn::SaturatedSub(q1, delta));
}

template<class D, class V = hn::Vec<D>>
static HWY_INLINE void FilterMacroblockEdge(D d, V* v, WebpFilterStrength strength)
{
    const hn::RebindToSigned<D> di;
    const hn::Repartition<int16_t, D> wide;
    const EdgeMasks<D> masks = Classify(d, v, strength.edge_limit + 4, strength);
    auto p0 = ToSigned(d, v[3]), q0 = ToSigned(d, v[4]);
    const auto p1 = ToSigned(d, v[2]), q1 = ToSigned(d, v[5]);
    const auto delta = hn::IfThenElseZero(masks.is_filtered, BaseDelta(hn::SaturatedSub(p1, q1), p0, q0));
    AdjustInnermost(hn::IfThenZeroElse(masks.is_smooth, delta), p0, q0);

    // (27, 18 and 9 times delta + 63) >> 7, the even lanes and the odd ones apart, in the upper half of 16 bits.
    const auto both = hn::BitCast(wide, hn::IfThenElseZero(masks.is_smooth, delta));
    const auto even9 = hn::MulHigh(hn::ShiftLeft<8>(both), hn::Set(wide, 9 << 8));
    const auto odd9 = hn::MulHigh(hn::And(both, hn::Set(wide, -256)), hn::Set(wide, 9 << 8));
    auto even = hn::Set(wide, 63), odd = even;
    const auto next = [&]() HWY_ATTR {
        even = hn::Add(even, even9);
        odd = hn::Add(odd, odd9);
        return hn::OddEven(hn::BitCast(di, hn::Add(odd, odd)), hn::BitCast(di, hn::ShiftRight<7>(even)));
    };
    const auto by9 = next(), by18 = next(), by27 = next();
    v[1] = ToUnsigned(d, hn::SaturatedAdd(ToSigned(d, v[1]), by9));
    v[2] = ToUnsigned(d, hn::SaturatedAdd(p1, by18));
    v[3] = ToUnsigned(d, hn::SaturatedAdd(p0, by27));
    v[4] = ToUnsigned(d, hn::SaturatedSub(q0, by27));
    v[5] = ToUnsigned(d, hn::SaturatedSub(q1, by18));
    v[6] = ToUnsigned(d, hn::SaturatedSub(ToSigned(d, v[6]), by9));
}

// Four of these with N = 16 transpose each 16 x 16 bytes.
template<size_t N, class D, class V = hn::Vec<D>>
static HWY_INLINE void Shuffle(D d, V* v)
{
    V out[N];
    HWY_UNROLL(8)
    for (size_t i = 0; i < N / 2; i++) {
        out[2 * i] = hn::InterleaveLower(d, v[i], v[i + N / 2]);
        out[2 * i + 1] = hn::InterleaveUpper(d, v[i], v[i + N / 2]);
    }
    HWY_UNROLL(16)
    for (size_t i = 0; i < N; i++)
        v[i] = out[i];
}

// What the 16 lanes along an edge are. Sample (0, 0) is the macroblock's first.
struct Luma {
    uint8_t* y;
    ptrdiff_t stride;
    static constexpr bool kHasLuma = true;

    // For vertical edges: one of 16 rows, from column `x`.
    template<class D>
    HWY_INLINE hn::Vec<D16> LoadAcross(D d, ptrdiff_t row, ptrdiff_t x) const { return hn::ResizeBitCast(D16(), hn::LoadU(d, y + row * stride + x)); }
    template<class D>
    HWY_INLINE void StoreAcross(D d, hn::Vec<D16> v, ptrdiff_t row, ptrdiff_t x) const { hn::StoreU(hn::ResizeBitCast(d, v), d, y + row * stride + x); }
    // For horizontal edges.
    HWY_INLINE hn::Vec<D16> LoadAlong(ptrdiff_t row) const { return hn::LoadU(D16(), y + row * stride); }
    HWY_INLINE void StoreAlong(hn::Vec<D16> v, ptrdiff_t row) const { hn::StoreU(v, D16(), y + row * stride); }
};

// 8 lanes of U, then 8 of V.
struct Chroma {
    uint8_t* u;
    uint8_t* v;
    ptrdiff_t stride;
    static constexpr bool kHasLuma = false;

    HWY_INLINE uint8_t* Row(ptrdiff_t row) const { return row < 8 ? u + row * stride : v + (row - 8) * stride; }
    template<class D>
    HWY_INLINE hn::Vec<D16> LoadAcross(D, ptrdiff_t row, ptrdiff_t x) const { return hn::ResizeBitCast(D16(), hn::LoadU(D8(), Row(row) + x)); }
    template<class D>
    HWY_INLINE void StoreAcross(D, hn::Vec<D16> from, ptrdiff_t row, ptrdiff_t x) const { hn::StoreU(hn::LowerHalf(D8(), from), D8(), Row(row) + x); }
    HWY_INLINE hn::Vec<D16> LoadAlong(ptrdiff_t row) const { return hn::Combine(D16(), hn::LoadU(D8(), v + row * stride), hn::LoadU(D8(), u + row * stride)); }
    HWY_INLINE void StoreAlong(hn::Vec<D16> from, ptrdiff_t row) const
    {
        hn::StoreU(hn::LowerHalf(D8(), from), D8(), u + row * stride);
        hn::StoreU(hn::UpperHalf(D8(), from), D8(), v + row * stride);
    }
};

#if HWY_MAX_BYTES >= 32
using D32 = hn::FixedTag<uint8_t, 32>;

struct LumaAndChroma {
    Luma luma;
    Chroma chroma;
    static constexpr bool kHasLuma = true;

    template<class D>
    HWY_INLINE hn::Vec<D32> LoadAcross(D d, ptrdiff_t row, ptrdiff_t x) const { return hn::Combine(D32(), chroma.LoadAcross(d, row, x), luma.LoadAcross(d, row, x)); }
    template<class D>
    HWY_INLINE void StoreAcross(D d, hn::Vec<D32> v, ptrdiff_t row, ptrdiff_t x) const
    {
        luma.StoreAcross(d, hn::LowerHalf(D16(), v), row, x);
        chroma.StoreAcross(d, hn::UpperHalf(D16(), v), row, x);
    }
    HWY_INLINE hn::Vec<D32> LoadAlong(ptrdiff_t row) const { return hn::Combine(D32(), chroma.LoadAlong(row), luma.LoadAlong(row)); }
    HWY_INLINE void StoreAlong(hn::Vec<D32> v, ptrdiff_t row) const
    {
        luma.StoreAlong(hn::LowerHalf(D16(), v), row);
        chroma.StoreAlong(hn::UpperHalf(D16(), v), row);
    }
};
#endif

// `filter` gets the four columns to the left of `edge` and the four to the right.
template<class D, class Planes, class Filter>
static HWY_INLINE void AtVerticalEdge(D d, const Planes& planes, ptrdiff_t edge, const Filter& filter)
{
    hn::Vec<D> v[8];
    HWY_UNROLL(8)
    for (ptrdiff_t i = 0; i < 8; i++)
        v[i] = hn::InterleaveLower(d, planes.LoadAcross(D8(), i, edge - 4), planes.LoadAcross(D8(), i + 8, edge - 4));
    Shuffle<8>(d, v);
    Shuffle<8>(d, v);
    Shuffle<8>(d, v);
    filter(v);
    Shuffle<8>(d, v);
    Shuffle<8>(d, v);
    Shuffle<8>(d, v);
    HWY_UNROLL(8)
    for (ptrdiff_t i = 0; i < 8; i++) {
        planes.StoreAcross(D8(), v[i], 2 * i, edge - 4);
        planes.StoreAcross(D8(), InterleaveUpperAs<uint64_t>(d, v[i], v[i]), 2 * i + 1, edge - 4);
    }
}

// `filter` gets columns 0 to 15, of which chroma has half.
template<class D, class Planes, class Filter>
static HWY_INLINE void AtInnerVerticalEdges(D d, const Planes& planes, const Filter& filter)
{
    hn::Vec<D> v[16];
    HWY_UNROLL(16)
    for (ptrdiff_t i = 0; i < 16; i++)
        v[i] = planes.LoadAcross(D16(), i, 0);
    Shuffle<16>(d, v);
    Shuffle<16>(d, v);
    Shuffle<16>(d, v);
    Shuffle<16>(d, v);
    filter(v);
    Shuffle<16>(d, v);
    Shuffle<16>(d, v);
    Shuffle<16>(d, v);
    Shuffle<16>(d, v);
    HWY_UNROLL(16)
    for (ptrdiff_t i = 0; i < 16; i++)
        planes.StoreAcross(D16(), v[i], i, 0);
}

// `filter` gets `kRead` of the four rows above `edge` and of the four below, and changes up to `kChanged` of each.
template<ptrdiff_t kRead, ptrdiff_t kChanged, class D, class Planes, class Filter>
static HWY_INLINE void AtHorizontalEdge(D, const Planes& planes, ptrdiff_t edge, const Filter& filter)
{
    static_assert(kChanged < kRead && kRead <= 4);
    hn::Vec<D> v[8];
    HWY_UNROLL(8)
    for (ptrdiff_t i = -kRead; i < kRead; i++)
        v[4 + i] = planes.LoadAlong(edge + i);
    filter(v);
    HWY_UNROLL(6)
    for (ptrdiff_t i = -kChanged; i < kChanged; i++)
        planes.StoreAlong(v[4 + i], edge + i);
}

// All but the two lower horizontal edges of luma.
template<class D, class Planes>
static HWY_INLINE void FilterNormally(D d, const Planes& planes, WebpFilterStrength strength, bool has_left, bool has_above)
{
    using V = hn::Vec<D>;
    const auto outer = [&](V* v) HWY_ATTR { FilterMacroblockEdge(d, v, strength); };
    const auto inner = [&](V* v) HWY_ATTR { FilterInnerEdge(d, v, strength, hn::MaxLanes(d)); };
    if (has_left) AtVerticalEdge(d, planes, 0, outer);
    if (strength.filters_inner_edges) {
        if constexpr (Planes::kHasLuma) {
            AtInnerVerticalEdges(d, planes, [&](V* v) HWY_ATTR {
                inner(v);
                FilterInnerEdge(d, v + 4, strength, 16);
                FilterInnerEdge(d, v + 8, strength, 16);
            });
        } else {
            AtVerticalEdge(d, planes, 4, inner);
        }
    }
    if (has_above) AtHorizontalEdge<4, 3>(d, planes, 0, outer);
    if (strength.filters_inner_edges) AtHorizontalEdge<4, 2>(d, planes, 4, inner);
}

void WebpFilterNormally(uint8_t* HWY_RESTRICT y, size_t y_stride, uint8_t* HWY_RESTRICT u, uint8_t* HWY_RESTRICT v, size_t uv_stride,
    const WebpFilterStrength* HWY_RESTRICT strengths, size_t count, bool has_above)
{
    const D16 d;
    for (size_t i = 0; i < count; i++) {
        const WebpFilterStrength strength = strengths[i];
        if (strength.edge_limit == 0) continue;
        const Luma luma { y + 16 * i, static_cast<ptrdiff_t>(y_stride) };
        const Chroma chroma { u + 8 * i, v + 8 * i, static_cast<ptrdiff_t>(uv_stride) };
#if HWY_MAX_BYTES >= 32
        FilterNormally(D32(), LumaAndChroma { luma, chroma }, strength, i != 0, has_above);
#else
        FilterNormally(d, luma, strength, i != 0, has_above);
        FilterNormally(d, chroma, strength, i != 0, has_above);
#endif
        if (!strength.filters_inner_edges) continue;
        for (ptrdiff_t edge = 8; edge < 16; edge += 4)
            AtHorizontalEdge<4, 2>(d, luma, edge, [&](hn::Vec<D16>* rows) HWY_ATTR { FilterInnerEdge(d, rows, strength, 16); });
    }
}

void WebpFilterSimply(uint8_t* HWY_RESTRICT y, size_t y_stride, const WebpFilterStrength* HWY_RESTRICT strengths, size_t count, bool has_above)
{
    const D16 d;
    using V = hn::Vec<D16>;
    for (size_t i = 0; i < count; i++) {
        const WebpFilterStrength strength = strengths[i];
        if (strength.edge_limit == 0) continue;
        const Luma luma { y + 16 * i, static_cast<ptrdiff_t>(y_stride) };
        const auto outer = [&](V* v) HWY_ATTR { FilterSimply(d, v, strength.edge_limit + 4); };
        const auto inner = [&](V* v) HWY_ATTR { FilterSimply(d, v, strength.edge_limit); };
        if (i != 0) AtVerticalEdge(d, luma, 0, outer);
        if (strength.filters_inner_edges) {
            AtInnerVerticalEdges(d, luma, [&](V* v) HWY_ATTR {
                inner(v);
                inner(v + 4);
                inner(v + 8);
            });
        }
        // Two rows are all that there is above the macroblock.
        if (has_above) AtHorizontalEdge<2, 1>(d, luma, 0, outer);
        if (!strength.filters_inner_edges) continue;
        for (ptrdiff_t edge = 4; edge < 16; edge += 4)
            AtHorizontalEdge<2, 1>(d, luma, edge, inner);
    }
}

// ─── YUV to RGBA ────────────────────────────────────────────────────────────

using DBytes = hn::CappedTag<uint8_t, 32>;
using DWords = hn::Repartition<int16_t, DBytes>;
using VWords = hn::Vec<DWords>;

// Between four chroma samples are four pixels. Each gets 9/16 of the nearest, 3/16 of the next one across and of the
// next one down or up, and 1/16 of the fourth. All of it is done with averages of two bytes.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/dsp/upsampling_sse2.c#L32
void WebpUpsample(const uint8_t* HWY_RESTRICT upper, const uint8_t* HWY_RESTRICT lower, uint8_t* HWY_RESTRICT to_upper,
    uint8_t* HWY_RESTRICT to_lower, size_t count)
{
    const DBytes bytes;
    const auto one = hn::Set(bytes, 1);
    for (size_t x = 0; x < count; x += hn::MaxLanes(bytes)) {
        const auto a = hn::LoadU(bytes, upper + x), b = hn::LoadU(bytes, upper + x + 1);
        const auto c = hn::LoadU(bytes, lower + x), d = hn::LoadU(bytes, lower + x + 1);
        const auto s = hn::AverageRound(a, d), t = hn::AverageRound(b, c);
        const auto st = hn::Xor(s, t), ad = hn::Xor(a, d), bc = hn::Xor(b, c);
        // (a + b + c + d) / 4
        const auto k = hn::Sub(hn::AverageRound(s, t), hn::And(hn::Or3(ad, bc, st), one));
        // (a + 3b + 3c + d) / 8 and (3a + b + c + 3d) / 8
        const auto rising = hn::Sub(hn::AverageRound(k, t), hn::And(hn::OrAnd(hn::Xor(k, t), bc, st), one));
        const auto falling = hn::Sub(hn::AverageRound(k, s), hn::And(hn::OrAnd(hn::Xor(k, s), ad, st), one));
        hn::StoreInterleaved2(hn::AverageRound(a, rising), hn::AverageRound(b, falling), bytes, to_upper + 2 * x);
        hn::StoreInterleaved2(hn::AverageRound(c, falling), hn::AverageRound(d, rising), bytes, to_lower + 2 * x);
    }
}

// All three come minus 128, times 256, and `u` plus 1. The results are yet to be clamped.
//
// libwebp rounds each `sample * factor / 256` down. The multiplication that is one instruction everywhere rounds to
// nearest. Taking something off the sample first makes up for that, and puts the result off by a whole number.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/dsp/yuv.h#L62
static HWY_INLINE void ToRgb(VWords y, VWords u, VWords v, VWords& r, VWords& g, VWords& b)
{
    const DWords d;
    const auto times = [&](VWords x, int16_t factor) HWY_ATTR { return hn::MulFixedPoint15(x, hn::Set(d, factor)); };
    const auto plus = [&](VWords x, int16_t constant) HWY_ATTR { return hn::Add(x, hn::Set(d, constant)); };
    const VWords half_v = hn::ShiftRight<1>(v);
    constexpr int16_t kRed = 9538 + 13074 - 14234, kGreen = 9538 - 3209 - 7492 + 8708, kBlue = 9538 + 16524 - 17685;
    const VWords luma = plus(times(hn::ShiftRight<1>(y), 19077), kRed);
    const VWords from_green = hn::Add(times(hn::ShiftRight<1>(u), 6419), times(plus(half_v, -16 * 128), 13320));
    r = hn::ShiftRight<6>(hn::Add(luma, times(half_v, 26149)));
    g = hn::ShiftRight<6>(hn::Sub(luma, plus(from_green, kRed - kGreen)));
    b = hn::ShiftRight<6>(hn::SaturatedAdd(luma, plus(times(u, 33050 / 2), kBlue - kRed)));
}

void WebpYuvToRgba(const uint8_t* HWY_RESTRICT y, const uint8_t* HWY_RESTRICT u, const uint8_t* HWY_RESTRICT v,
    const uint8_t* HWY_RESTRICT alpha, uint8_t* HWY_RESTRICT rgba, size_t width)
{
    const DBytes d;
    constexpr size_t kPixels = hn::MaxLanes(d);
    const auto convert = [&](size_t x, uint8_t* HWY_RESTRICT to) HWY_ATTR {
        const auto centered = [&](const uint8_t* plane) HWY_ATTR { return hn::Xor(hn::LoadU(d, plane + x), hn::Set(d, 128)); };
        const auto lower = [&](uint8_t low, auto high) HWY_ATTR { return hn::BitCast(DWords(), hn::InterleaveLower(d, hn::Set(d, low), high)); };
        const auto upper = [&](uint8_t low, auto high) HWY_ATTR { return hn::BitCast(DWords(), hn::InterleaveUpper(d, hn::Set(d, low), high)); };
        const auto ys = centered(y), us = centered(u), vs = centered(v);
        VWords lower_r, lower_g, lower_b, upper_r, upper_g, upper_b;
        ToRgb(lower(0, ys), lower(1, us), lower(0, vs), lower_r, lower_g, lower_b);
        ToRgb(upper(0, ys), upper(1, us), upper(0, vs), upper_r, upper_g, upper_b);
        // Like the interleaving, this is within each 128 bits.
        hn::StoreInterleaved4(hn::ReorderDemote2To(d, lower_r, upper_r), hn::ReorderDemote2To(d, lower_g, upper_g),
            hn::ReorderDemote2To(d, lower_b, upper_b), hn::LoadU(d, alpha + x), d, to);
    };
    size_t x = 0;
    for (; x + kPixels <= width; x += kPixels)
        convert(x, rgba + 4 * x);
    if (x < width) {
        HWY_ALIGN uint8_t last[4 * kPixels];
        convert(x, last);
        hwy::CopyBytes(last, rgba + 4 * x, 4 * (width - x));
    }
}

// ─── Lossless: undoing the predictor transform ──────────────────────────────
//
// Pixels have four bytes, alpha last. Positions are in bytes.

using DPixel = hn::FixedTag<uint8_t, 4>;
using VPixel = hn::Vec<DPixel>;

// Pixels that do not depend on each other. `predict(d, at)` is for the vector at `at`.
template<class Predict>
static HWY_INLINE void AddToAll(uint8_t* HWY_RESTRICT row, size_t at, size_t end, const Predict& predict)
{
    const auto add = [&](auto d) HWY_ATTR {
        for (; at + hn::MaxLanes(d) <= end; at += hn::MaxLanes(d))
            hn::StoreU(hn::Add(hn::LoadU(d, row + at), predict(d, at)), d, row + at);
    };
    add(hn::CappedTag<uint8_t, 32>());
    if constexpr (HWY_MAX_BYTES > 16) add(D16());
    add(DPixel());
}

template<int kPixel, class V>
static HWY_INLINE hn::Vec<D16> Repeated(V pixels)
{
    return hn::BitCast(D16(), hn::Broadcast<kPixel>(hn::ResizeBitCast(hn::Repartition<uint32_t, D16>(), pixels)));
}

// The first of four pixels, the sum of the first two and so on.
static HWY_INLINE hn::Vec<D16> RunningSums(const uint8_t* HWY_RESTRICT pixels)
{
    const D16 d;
    auto sums = hn::LoadU(d, pixels);
    sums = hn::Add(sums, hn::ShiftLeftBytes<4>(d, sums));
    return hn::Add(sums, hn::ShiftLeftBytes<8>(d, sums));
}

static HWY_INLINE void AddLeft(uint8_t* HWY_RESTRICT row, size_t at, size_t end)
{
    const DPixel d;
    auto lefts = Repeated<0>(hn::LoadU(d, row + at - 4));
    for (; at + 16 <= end; at += 16) {
        const auto sums = RunningSums(row + at);
        hn::StoreU(hn::Add(sums, lefts), D16(), row + at);
        lefts = hn::Add(lefts, Repeated<3>(sums));
    }
    VPixel left = hn::ResizeBitCast(d, lefts);
    for (; at < end; at += 4) {
        left = hn::Add(left, hn::LoadU(d, row + at));
        hn::StoreU(left, d, row + at);
    }
}

// An average that rounds down is one that rounds up with all bits inverted, so `predict(left, top_left, top, at)` takes
// and returns inverted pixels. That makes the way from one pixel to the next the shortest.
template<class Predict>
static HWY_INLINE void AddAverage(uint8_t* HWY_RESTRICT row, const uint8_t* HWY_RESTRICT above, size_t at, size_t end, const Predict& predict)
{
    const DPixel d;
    VPixel left = hn::Not(hn::LoadU(d, row + at - 4));
    VPixel top_left = hn::Not(hn::LoadU(d, above + at - 4));
    for (; at < end; at += 4) {
        const VPixel top = hn::Not(hn::LoadU(d, above + at));
        left = hn::Sub(predict(left, top_left, top, at), hn::LoadU(d, row + at));
        hn::StoreU(hn::Not(left), d, row + at);
        top_left = top;
    }
}

// For predictors that give the left pixel if the two above are alike. `next(left, top_left, top, residual)` is the pixel.
template<class Next>
static HWY_INLINE void AddGradient(uint8_t* HWY_RESTRICT row, const uint8_t* HWY_RESTRICT above, size_t at, size_t end, const Next& next)
{
    const DPixel d;
    VPixel left = hn::LoadU(d, row + at - 4);
    const auto one = [&](size_t i) HWY_ATTR {
        left = next(left, hn::LoadU(d, above + i - 4), hn::LoadU(d, above + i), hn::LoadU(d, row + i));
        hn::StoreU(left, d, row + i);
    };
    for (; at + 16 <= end; at += 16) {
        if (hn::AllTrue(D16(), hn::Eq(hn::LoadU(D16(), above + at), hn::LoadU(D16(), above + at - 4)))) {
            const auto pixels = hn::Add(RunningSums(row + at), Repeated<0>(left));
            hn::StoreU(pixels, D16(), row + at);
            left = hn::ResizeBitCast(d, hn::ShiftRightBytes<12>(D16(), pixels));
        } else {
            one(at);
            one(at + 4);
            one(at + 8);
            one(at + 12);
        }
    }
    for (; at < end; at += 4)
        one(at);
}

// row[at..end). One pixel more is read on the left of both rows, and on the right of `above`.
static HWY_INLINE void UndoPrediction(uint8_t mode, uint8_t* HWY_RESTRICT row, const uint8_t* HWY_RESTRICT above, size_t at, size_t end)
{
    const DPixel d;
    const auto average = [](auto a, auto b) HWY_ATTR { return hn::AverageRound(a, b); };
    const auto top_right = [&](size_t i) HWY_ATTR { return hn::Not(hn::LoadU(d, above + i + 4)); };
    const auto average_above = [&](auto dv, size_t i) HWY_ATTR {
        return hn::Not(average(hn::Not(hn::LoadU(dv, above + i)), hn::Not(hn::LoadU(dv, above + i + 4))));
    };
    switch (mode) {
    case 1:
        return AddLeft(row, at, end);
    case 2:
        return AddToAll(row, at, end, [&](auto dv, size_t i) HWY_ATTR { return hn::LoadU(dv, above + i); });
    case 3:
        return AddToAll(row, at, end, [&](auto dv, size_t i) HWY_ATTR { return hn::LoadU(dv, above + i + 4); });
    case 4:
        return AddToAll(row, at, end, [&](auto dv, size_t i) HWY_ATTR { return hn::LoadU(dv, above + i - 4); });
    case 5:
        return AddAverage(row, above, at, end, [&](VPixel l, VPixel, VPixel t, size_t i) HWY_ATTR { return average(average(l, top_right(i)), t); });
    case 6:
        return AddAverage(row, above, at, end, [&](VPixel l, VPixel tl, VPixel, size_t) HWY_ATTR { return average(l, tl); });
    case 7:
        return AddAverage(row, above, at, end, [&](VPixel l, VPixel, VPixel t, size_t) HWY_ATTR { return average(l, t); });
    case 8:
        return AddToAll(row, at, end, [&](auto dv, size_t i) HWY_ATTR { return average_above(dv, i - 4); });
    case 9:
        return AddToAll(row, at, end, average_above);
    case 10:
        return AddAverage(row, above, at, end, [&](VPixel l, VPixel tl, VPixel t, size_t i) HWY_ATTR { return average(average(l, tl), average(t, top_right(i))); });
    case 11:
        return AddGradient(row, above, at, end, [&](VPixel l, VPixel tl, VPixel t, VPixel residual) HWY_ATTR {
            const hn::Repartition<uint32_t, DPixel> d32;
            const auto distance = [&](VPixel from) HWY_ATTR {
#if HWY_TARGET_IS_NEON
                return hn::BitCast(hn::RebindToSigned<decltype(d32)>(), hn::SumsOf4(hn::AbsDiff(from, tl)));
#else
                // The other four bytes are alike.
                const auto with_corner = [&](VPixel p) HWY_ATTR { return InterleaveLowerAs<uint32_t>(D8(), hn::ResizeBitCast(D8(), p), hn::ResizeBitCast(D8(), tl)); };
                return hn::ResizeBitCast(hn::RebindToSigned<decltype(d32)>(), hn::SumsOf8AbsDiff(with_corner(from), with_corner(tl)));
#endif
            };
            const auto take_left = hn::RebindMask(d32, hn::Gt(distance(l), distance(t)));
            return hn::BitCast(d, hn::IfThenElse(take_left, hn::BitCast(d32, hn::Add(l, residual)), hn::BitCast(d32, hn::Add(t, residual))));
        });
    case 12:
        return AddGradient(row, above, at, end, [&](VPixel l, VPixel tl, VPixel t, VPixel residual) HWY_ATTR {
            return hn::Add(hn::SaturatedSub(hn::SaturatedAdd(l, hn::SaturatedSub(t, tl)), hn::SaturatedSub(tl, t)), residual);
        });
    case 13:
        return AddAverage(row, above, at, end, [&](VPixel l, VPixel tl, VPixel t, size_t) HWY_ATTR {
            const VPixel middle = average(l, t);
            const VPixel up = hn::ShiftRight<1>(hn::SaturatedSub(middle, tl)), down = hn::ShiftRight<1>(hn::SaturatedSub(tl, middle));
            return hn::SaturatedSub(hn::SaturatedAdd(middle, up), down);
        });
    default:
        return AddToAll(row, at, end, [](auto dv, size_t) HWY_ATTR {
            return hn::BitCast(dv, hn::Set(hn::Repartition<uint32_t, decltype(dv)>(), 0xff000000u));
        });
    }
}

void WebpUndoPrediction(uint8_t* HWY_RESTRICT row, const uint8_t* HWY_RESTRICT above, size_t width, const uint8_t* HWY_RESTRICT tiles, uint32_t tile_bits)
{
    const auto mode_at = [&](size_t x) { return tiles[(x >> tile_bits) * 4 + 1] & 15; };
    UndoPrediction(2, row, above, 0, 4);
    if (width == 1) return;
    const size_t last = width - 1;
    for (size_t x = 1; x < last;) {
        const size_t end = HWY_MIN(((x >> tile_bits) + 1) << tile_bits, last);
        UndoPrediction(mode_at(x), row, above, 4 * x, 4 * end);
        x = end;
    }
    // At the top right of the last pixel is the first of its own row.
    uint8_t around[12];
    hwy::CopyBytes<8>(above + 4 * last - 4, around);
    hwy::CopyBytes<4>(row, around + 8);
    UndoPrediction(mode_at(last), row + 4 * last - 4, around, 4, 8);
}

// ─── Lossless: undoing the cross-color transform ────────────────────────────

void WebpUndoCrossColor(uint8_t* HWY_RESTRICT row, size_t width, const uint8_t* HWY_RESTRICT tiles, uint32_t tile_bits)
{
    // (color * multiplier) >> 5 is the upper half of (color << 8) * (multiplier << 3).
    const auto scaled = [](uint8_t multiplier) { return static_cast<uint16_t>(static_cast<int8_t>(multiplier) * 8); };
    for (size_t x = 0; x < width; tiles += 4) {
        const size_t end = HWY_MIN(x + (size_t { 1 } << tile_bits), width);
        // In lanes of 16 bits a pixel is red and green, then blue and alpha.
        const uint32_t from_green = scaled(tiles[2]) | uint32_t { scaled(tiles[1]) } << 16;
        const uint32_t from_red = uint32_t { scaled(tiles[0]) } << 16;
        const auto undo = [&](auto d) HWY_ATTR {
            const hn::Repartition<int16_t, decltype(d)> d16;
            const hn::Repartition<uint32_t, decltype(d)> d32;
            const auto delta = [&](auto colors, uint32_t by) HWY_ATTR {
                const auto product = hn::MulHigh(hn::BitCast(d16, colors), hn::BitCast(d16, hn::Set(d32, by)));
                return hn::BitCast(d, hn::And(product, hn::Set(d16, 0xff)));
            };
            for (; x + hn::MaxLanes(d32) <= end; x += hn::MaxLanes(d32)) {
                auto pixels = hn::LoadU(d, row + 4 * x);
                const auto green = hn::DupEven(hn::And(hn::BitCast(d16, pixels), hn::Set(d16, -256)));
                pixels = hn::Add(pixels, delta(green, from_green));
                pixels = hn::Add(pixels, delta(hn::ShiftLeft<24>(hn::BitCast(d32, pixels)), from_red));
                hn::StoreU(pixels, d, row + 4 * x);
            }
        };
        undo(hn::CappedTag<uint8_t, 32>());
        undo(D16());
        undo(DPixel());
    }
}

// NOLINTNEXTLINE(google-readability-namespace-comments)
} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {
HWY_EXPORT(WebpInverseDct);
HWY_EXPORT(WebpReconstructSubblocks);
HWY_EXPORT(WebpFilterNormally);
HWY_EXPORT(WebpFilterSimply);
HWY_EXPORT(WebpUpsample);
HWY_EXPORT(WebpYuvToRgba);
HWY_EXPORT(WebpUndoPrediction);
HWY_EXPORT(WebpUndoCrossColor);

extern "C" void highway_webp_inverse_dct(int16_t* coefficients, uint32_t non_zero)
{
    BUN_HWY_DISPATCH(WebpInverseDct)(coefficients, non_zero);
}

extern "C" void highway_webp_reconstruct_subblocks(const uint8_t* above, const uint8_t* above_right, const uint8_t* left,
    const uint8_t* modes, const int16_t* residuals, uint8_t* samples)
{
    BUN_HWY_DISPATCH(WebpReconstructSubblocks)(above, above_right, left, modes, residuals, samples);
}

extern "C" void highway_webp_filter_normally(uint8_t* y, size_t y_stride, uint8_t* u, uint8_t* v, size_t uv_stride,
    const WebpFilterStrength* strengths, size_t count, bool has_above)
{
    BUN_HWY_DISPATCH(WebpFilterNormally)(y, y_stride, u, v, uv_stride, strengths, count, has_above);
}

extern "C" void highway_webp_filter_simply(uint8_t* y, size_t y_stride, const WebpFilterStrength* strengths, size_t count, bool has_above)
{
    BUN_HWY_DISPATCH(WebpFilterSimply)(y, y_stride, strengths, count, has_above);
}

extern "C" void highway_webp_upsample(const uint8_t* upper, const uint8_t* lower, uint8_t* to_upper, uint8_t* to_lower, size_t count)
{
    BUN_HWY_DISPATCH(WebpUpsample)(upper, lower, to_upper, to_lower, count);
}

extern "C" void highway_webp_yuv_to_rgba(const uint8_t* y, const uint8_t* u, const uint8_t* v, const uint8_t* alpha, uint8_t* rgba, size_t width)
{
    BUN_HWY_DISPATCH(WebpYuvToRgba)(y, u, v, alpha, rgba, width);
}

extern "C" void highway_webp_undo_prediction(uint8_t* row, const uint8_t* above, size_t width, const uint8_t* tiles, uint32_t tile_bits)
{
    BUN_HWY_DISPATCH(WebpUndoPrediction)(row, above, width, tiles, tile_bits);
}

extern "C" void highway_webp_undo_cross_color(uint8_t* row, size_t width, const uint8_t* tiles, uint32_t tile_bits)
{
    BUN_HWY_DISPATCH(WebpUndoCrossColor)(row, width, tiles, tile_bits);
}
} // namespace bun
#endif
