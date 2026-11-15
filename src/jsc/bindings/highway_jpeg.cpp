// The transforms and colour conversions of JPEG for src/jpeg, runtime-dispatched via Google Highway. The arithmetic is
// that of libjpeg-turbo (LICENSE.md), and every target gives the same bytes for any input.
//
// A block is 64 coefficients: the rows 0 and 4 interleaved, then 2 and 6, 1 and 3, 5 and 7, all with their columns in
// the order 0 2 4 6 1 3 5 7.
//
// Loads and stores are of whole vectors. What each function touches is at the end of the file.

// The list in scripts/build/deps/highway.ts and more: the rest of SVE, whatever is newer than AVX2, and the targets
// whose code would be the same as that for the baseline.
#undef HWY_DISABLED_TARGETS
#define HWY_DISABLED_TARGETS (HWY_ALL_SVE | HWY_NEON | HWY_NEON_BF16 | HWY_SSE4 | (HWY_AVX2 - 1))

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_jpeg.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>
#include "highway_dispatch.h"

#include <array>
#include <stddef.h>
#include <stdint.h>

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

using D16 = hn::CappedTag<int16_t, 16>;
using DU16 = hn::RebindToUnsigned<D16>;
using D32 = hn::Repartition<int32_t, D16>;
using DU32 = hn::RebindToUnsigned<D32>;
using D8 = hn::Repartition<uint8_t, D16>;
using DI8 = hn::RebindToSigned<D8>;
using V16 = hn::Vec<D16>;
using V32 = hn::Vec<D32>;
using V8 = hn::Vec<D8>;

static constexpr size_t kBytes = hn::MaxLanes(D8());
// How many vectors 32 bytes are.
static constexpr size_t kParts = 32 / kBytes;
// Which 128 bits of a vector are its last.
static constexpr int kLastBlock = kBytes / 16 - 1;

// The butterflies of jidctint.c and jidctred.c, multiplied out: row `i` has the weight of each of 8 coefficients in
// sample `i` of `N`. Sample `N - 1 - i` has the same weights, with the sign of the odd ones changed. All are scaled by
// 2^(13 + kExtraBits).
// https://github.com/libjpeg-turbo/libjpeg-turbo/blob/c85e6b905bf237038faa936dab160ebfc5da0344/src/jidctint.c
// https://github.com/libjpeg-turbo/libjpeg-turbo/blob/c85e6b905bf237038faa936dab160ebfc5da0344/src/jidctred.c
template<size_t N> struct Basis;
template<size_t N> static constexpr int kExtraBits = N == 2 ? 2 : N == 4 ? 1
                                                                         : 0;
// The first weight is 32768, which takes 17 bits. This has half of it.
template<> struct Basis<2> {
    static constexpr int16_t k[1][8] = { { 16384, 29692, 0, -10426, 0, 6967, 0, -5906 } };
};
template<> struct Basis<3> {
    static constexpr int16_t k[2][8] = {
        { 8192, 10033, 5793, 0, 0, 0, 0, 0 },
        { 8192, 0, -11586, 0, 0, 0, 0, 0 },
    };
};
template<> struct Basis<4> {
    static constexpr int16_t k[2][8] = {
        { 16384, 20995, 15137, 7373, 0, -4926, -6270, -4176 },
        { 16384, 8697, -15137, -17799, 0, 11893, 6270, -1730 },
    };
};
template<> struct Basis<5> {
    static constexpr int16_t k[3][8] = {
        { 8192, 11019, 9372, 6810, 3580, 0, 0, 0 },
        { 8192, 6810, -3580, -11018, -9372, 0, 0, 0 },
        { 8192, 0, -11584, 0, 11584, 0, 0, 0 },
    };
};
template<> struct Basis<6> {
    static constexpr int16_t k[3][8] = {
        { 8192, 11190, 10033, 8192, 5793, 2998, 0, 0 },
        { 8192, 8192, 0, -8192, -11586, -8192, 0, 0 },
        { 8192, 2998, -10033, -8192, 5793, 11190, 0, 0 },
    };
};
template<> struct Basis<7> {
    static constexpr int16_t k[4][8] = {
        { 8192, 11295, 10438, 9058, 7223, 5027, 2578, 0 },
        { 8192, 9058, 2578, -5027, -10438, -11295, -7223, 0 },
        { 8192, 5027, -7223, -11295, -2578, 9058, 10438, 0 },
        { 8192, 0, -11585, 0, 11585, 0, -11585, 0 },
    };
};
template<> struct Basis<8> {
    static constexpr int16_t k[4][8] = {
        { 8192, 11363, 10703, 9633, 8192, 6437, 4433, 2260 },
        { 8192, 9633, 4433, -2259, -8192, -11362, -10704, -6436 },
        { 8192, 6437, -4433, -11362, -8192, 2261, 10704, 9633 },
        { 8192, 2260, -10703, -6436, 8192, 9633, -4433, -11363 },
    };
};
template<> struct Basis<10> {
    static constexpr int16_t k[5][8] = {
        { 8192, 11443, 11019, 10322, 9373, 8192, 6810, 5260 },
        { 8192, 10323, 6810, 1812, -3580, -8192, -11018, -11442 },
        { 8192, 8192, 0, -8192, -11586, -8192, 0, 8192 },
        { 8192, 5260, -6810, -11442, -3580, 8192, 11018, 1812 },
        { 8192, 1812, -11019, -5260, 9373, 8192, -6810, -10322 },
    };
};
template<> struct Basis<12> {
    static constexpr int16_t k[6][8] = {
        { 8192, 11487, 11190, 10703, 10033, 9192, 8192, 7053 },
        { 8192, 10703, 8192, 4433, 0, -4433, -8192, -10703 },
        { 8192, 9192, 2998, -4433, -10033, -11485, -8192, -1512 },
        { 8192, 7053, -2998, -10703, -10033, -1512, 8192, 11486 },
        { 8192, 4433, -8192, -10704, 0, 10704, 8192, -4433 },
        { 8192, 1513, -11190, -4433, 10033, 7053, -8192, -9191 },
    };
};
template<> struct Basis<14> {
    static constexpr int16_t k[7][8] = {
        { 8192, 11513, 11295, 10935, 10438, 9810, 9058, 8192 },
        { 8192, 10935, 9058, 6164, 2578, -1297, -5026, -8192 },
        { 8192, 9810, 5027, -1297, -7223, -10934, -11295, -8192 },
        { 8192, 8192, 0, -8192, -11586, -8192, 0, 8192 },
        { 8192, 6164, -5027, -11512, -7223, 3826, 11295, 8192 },
        { 8192, 3826, -9058, -9809, 2578, 11512, 5026, -8192 },
        { 8192, 1297, -11295, -3826, 10438, 6164, -9058, -8192 },
    };
};

// One row of 8 sums of products.
struct Sums {
    V32 part[kParts];
};

// Two rows of 8. x64 multiplies and adds neighbouring lanes, so there they are interleaved. Elsewhere each is a vector.
struct RowPair {
    V16 part[kParts];
};

// 16 values per 128 bits: the first 8 are in `lower`.
struct Widened {
    V16 lower;
    V16 upper;
};

static HWY_INLINE Sums operator+(Sums a, const Sums& b)
{
    for (size_t i = 0; i < kParts; i++)
        a.part[i] = hn::Add(a.part[i], b.part[i]);
    return a;
}

static HWY_INLINE Sums operator-(Sums a, const Sums& b)
{
    for (size_t i = 0; i < kParts; i++)
        a.part[i] = hn::Sub(a.part[i], b.part[i]);
    return a;
}

static HWY_INLINE RowPair operator+(RowPair a, const RowPair& b)
{
    for (size_t i = 0; i < kParts; i++)
        a.part[i] = hn::Add(a.part[i], b.part[i]);
    return a;
}

static HWY_INLINE RowPair operator-(RowPair a, const RowPair& b)
{
    for (size_t i = 0; i < kParts; i++)
        a.part[i] = hn::Sub(a.part[i], b.part[i]);
    return a;
}

// `first` in column 0 and `rest` in the others.
static HWY_INLINE Sums Bias(int32_t first, int32_t rest)
{
    Sums bias {};
    for (size_t i = 0; i < kParts; i++)
        bias.part[i] = hn::Set(D32(), rest);
    bias.part[0] = hn::InsertLane(bias.part[0], 0, first);
    return bias;
}

// In each 128 bits of the result: the lanes that `a` has there, then those of `b`, saturated.
template<class D, class V>
static HWY_INLINE hn::Vec<D> Pack(D d, V a, V b)
{
    return hn::ReorderDemote2To(d, a, b);
}

static constexpr uint8_t kZero = 0x80;

static HWY_INLINE V8 Shuffle(V8 bytes, const std::array<uint8_t, 16>& from)
{
    return hn::TableLookupBytesOr0(bytes,
        hn::Dup128VecFromValues(D8(), from[0], from[1], from[2], from[3], from[4], from[5], from[6], from[7], from[8],
            from[9], from[10], from[11], from[12], from[13], from[14], from[15]));
}

static HWY_INLINE V16 Alternating(int16_t even, int16_t odd)
{
    return hn::Dup128VecFromValues(D16(), even, odd, even, odd, even, odd, even, odd);
}

// What is added to the weighed R, G and B before the low 16 bits are dropped.
static constexpr int32_t kLumaBias = 32768;
static constexpr int32_t kChromaBias = (128 << 16) + 32767;

#if HWY_ARCH_X86

static constexpr size_t OffsetInPair(size_t row, size_t lane) { return 2 * lane + row; }

static HWY_INLINE RowPair LoadPair(const int16_t* HWY_RESTRICT from)
{
    RowPair pair {};
    for (size_t i = 0; i < kParts; i++)
        pair.part[i] = hn::Load(D16(), from + i * hn::MaxLanes(D16()));
    return pair;
}

static HWY_INLINE void StorePair(const RowPair& pair, int16_t* HWY_RESTRICT to)
{
    for (size_t i = 0; i < kParts; i++)
        hn::Store(pair.part[i], D16(), to + i * hn::MaxLanes(D16()));
}

static HWY_INLINE Sums Weigh(const RowPair& rows, int16_t first, int16_t second)
{
    Sums sums {};
    for (size_t i = 0; i < kParts; i++)
        sums.part[i] = hn::WidenMulPairwiseAdd(D32(), rows.part[i], Alternating(first, second));
    return sums;
}

// Of sums that fit in 16 bits once they are shifted.
template<int kShift>
static HWY_INLINE RowPair PairUp(const Sums& first, const Sums& second)
{
    RowPair pair {};
    for (size_t i = 0; i < kParts; i++) {
        pair.part[i] = hn::OddEven(hn::BitCast(D16(), hn::ShiftLeft<16 - kShift>(second.part[i])),
            hn::BitCast(D16(), hn::ShiftRight<kShift>(first.part[i])));
    }
    return pair;
}

// `rows` has a row in each 128 bits. Lane `i` of 4 is the sum of its lanes `kLane` and `kLane + 1`, weighed with
// `first[i]` and `second[i]`.
template<int kLane>
static HWY_INLINE V32 WeighLanes(V16 rows, const std::array<int16_t, 4>& first, const std::array<int16_t, 4>& second)
{
    return hn::WidenMulPairwiseAdd(D32(), hn::BitCast(D16(), hn::Broadcast<kLane / 2>(hn::BitCast(D32(), rows))),
        hn::Dup128VecFromValues(D16(), first[0], second[0], first[1], second[1], first[2], second[2], first[3], second[3]));
}

// The 8 coefficients of 8 samples. The even ones are made of the sums of samples that mirror each other, the odd ones
// of their differences.
static HWY_INLINE Sums TransformRow(const uint8_t* HWY_RESTRICT samples, Sums sums)
{
    static constexpr auto weights = [](size_t first) {
        std::array<int16_t, 16> weights {};
        for (size_t i = 0; i < 16; i++)
            weights[i] = Basis<8>::k[first + i % 2][i < 8 ? i / 2 * 2 : (i - 8) / 2 * 2 + 1];
        return weights;
    };
    HWY_ALIGN static constexpr std::array<int16_t, 16> kOuter = weights(0), kInner = weights(2);
    HWY_ALIGN static constexpr int8_t kSigns[32] = { 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1 };

    uint64_t row;
    hwy::CopyBytes<8>(samples, &row);
    const V8 bytes = hn::BitCast(D8(), hn::Set(hn::Repartition<uint64_t, D8>(), row));
    const V8 outer = Shuffle(bytes, { 0, 7, 1, 6, 0, 7, 1, 6, 0, 7, 1, 6, 0, 7, 1, 6 });
    const V8 inner = Shuffle(bytes, { 2, 5, 3, 4, 2, 5, 3, 4, 2, 5, 3, 4, 2, 5, 3, 4 });
    for (size_t i = 0; i < kParts; i++) {
        const auto signs = hn::Load(DI8(), kSigns + i * kBytes);
        const size_t at = i * hn::MaxLanes(D16());
        sums.part[i] = hn::Add(sums.part[i],
            hn::Add(hn::WidenMulPairwiseAdd(D32(), hn::SatWidenMulPairwiseAdd(D16(), outer, signs), hn::Load(D16(), kOuter.data() + at)),
                hn::WidenMulPairwiseAdd(D32(), hn::SatWidenMulPairwiseAdd(D16(), inner, signs), hn::Load(D16(), kInner.data() + at))));
    }
    return sums;
}

static HWY_INLINE Widened Widen(V8 bytes)
{
    const V8 zero = hn::Zero(D8());
    return { hn::BitCast(D16(), hn::InterleaveLower(D8(), bytes, zero)), hn::BitCast(D16(), hn::InterleaveUpper(D8(), bytes, zero)) };
}

static HWY_INLINE V16 GreenOffset(V16 cb, V16 cr)
{
    const V16 weights = Alternating(-11277, -23401);
    const V32 half = hn::Set(D32(), 1 << 14);
    return Pack(D16(),
        hn::ShiftRight<15>(hn::Add(hn::WidenMulPairwiseAdd(D32(), hn::InterleaveLower(D16(), cb, cr), weights), half)),
        hn::ShiftRight<15>(hn::Add(hn::WidenMulPairwiseAdd(D32(), hn::InterleaveUpper(D16(), cb, cr), weights), half)));
}

// Two values for each sample from `row[1]` on: three times the sample and once the one before it, then the same with the
// one after it. All times `weight`.
static HWY_INLINE Widened BlendAcross(const uint8_t* HWY_RESTRICT row, int8_t weight)
{
    const hn::Full128<uint8_t> d128;
    V8 bytes = hn::ResizeBitCast(D8(), hn::LoadU(d128, row));
    if constexpr (kParts == 1)
        bytes = hn::InsertBlock<kLastBlock>(bytes, hn::LoadU(d128, row + 8));
    const int8_t thrice = static_cast<int8_t>(3 * weight);
    const auto weights = hn::Dup128VecFromValues(DI8(), weight, thrice, thrice, weight, weight, thrice, thrice, weight,
        weight, thrice, thrice, weight, weight, thrice, thrice, weight);
    return {
        hn::SatWidenMulPairwiseAdd(D16(), Shuffle(bytes, { 0, 1, 1, 2, 1, 2, 2, 3, 2, 3, 3, 4, 3, 4, 4, 5 }), weights),
        hn::SatWidenMulPairwiseAdd(D16(), Shuffle(bytes, { 4, 5, 5, 6, 5, 6, 6, 7, 6, 7, 7, 8, 7, 8, 8, 9 }), weights),
    };
}

// What was 4 bytes of each of 4 vectors in each 128 bits, in the order of the vectors.
static HWY_INLINE V8 InVectorOrder(V8 packed)
{
    if constexpr (kParts == 1) {
        HWY_ALIGN static constexpr int32_t kOrder[8] = { 0, 4, 1, 5, 2, 6, 3, 7 };
        return hn::BitCast(D8(), hn::TableLookupLanes(hn::BitCast(D32(), packed), hn::SetTableIndices(D32(), kOrder)));
    }
    return packed;
}

// Stores the luma of `kBytes` pixels, and adds their Cb and Cr, 16 bits each, to `chroma`.
static HWY_INLINE void SplitRow(const uint8_t* HWY_RESTRICT rgba, uint8_t* HWY_RESTRICT luma, V16 (&chroma)[4])
{
    V32 y[4];
    for (size_t i = 0; i < 4; i++) {
        const V8 pixels = hn::LoadU(D8(), rgba + i * kBytes);
        const V16 rb = hn::And(hn::BitCast(D16(), pixels), hn::Set(D16(), 0xFF));
        const V16 gg = hn::BitCast(D16(),
            Shuffle(pixels, { 1, kZero, 1, kZero, 5, kZero, 5, kZero, 9, kZero, 9, kZero, 13, kZero, 13, kZero }));
        const auto weigh = [&](int16_t r, int16_t b, int16_t g, int16_t more_g) HWY_ATTR {
            return hn::Add(hn::WidenMulPairwiseAdd(D32(), rb, Alternating(r, b)),
                hn::WidenMulPairwiseAdd(D32(), gg, Alternating(g, more_g)));
        };
        // 38470 and 32768 take 17 bits. Half of the one does not, and neither does the other with its sign changed.
        y[i] = hn::ShiftRight<16>(hn::Add(hn::Set(D32(), kLumaBias), weigh(19595, 7471, 19235, 19235)));
        const V32 cb = hn::Sub(hn::Set(D32(), kChromaBias), weigh(11059, -32768, 21709, 0));
        const V32 cr = hn::Sub(hn::Set(D32(), kChromaBias), weigh(-32768, 5329, 27439, 0));
        chroma[i] = hn::Add(chroma[i], hn::OddEven(hn::BitCast(D16(), cr), hn::BitCast(D16(), hn::ShiftRight<16>(cb))));
    }
    hn::StoreU(InVectorOrder(Pack(D8(), Pack(D16(), y[0], y[1]), Pack(D16(), y[2], y[3]))), D8(), luma);
}

static HWY_INLINE void StoreChroma(const V16 (&chroma)[4], uint8_t* HWY_RESTRICT cb, uint8_t* HWY_RESTRICT cr)
{
    const auto average = [](V16 a, V16 b) HWY_ATTR {
        const V32 sums = hn::PairwiseAdd128(D32(), hn::BitCast(D32(), a), hn::BitCast(D32(), b));
        return hn::ShiftRight<2>(hn::Add(hn::BitCast(D16(), sums), hn::Dup128VecFromValues(D16(), 1, 1, 2, 2, 1, 1, 2, 2)));
    };
    const V8 both = InVectorOrder(Pack(D8(), average(chroma[0], chroma[1]), average(chroma[2], chroma[3])));
    const hn::Half<D8> half;
    hn::StoreU(hn::LowerHalf(half, hn::ConcatEven(D8(), both, both)), half, cb);
    hn::StoreU(hn::LowerHalf(half, hn::ConcatOdd(D8(), both, both)), half, cr);
}

#else

static_assert(kParts == 2);

static constexpr size_t OffsetInPair(size_t row, size_t lane) { return 8 * row + lane; }

static HWY_INLINE RowPair LoadPair(const int16_t* HWY_RESTRICT from)
{
    RowPair pair {};
    hn::LoadInterleaved2(D16(), from, pair.part[0], pair.part[1]);
    return pair;
}

static HWY_INLINE void StorePair(const RowPair& pair, int16_t* HWY_RESTRICT to)
{
    hn::StoreInterleaved2(pair.part[0], pair.part[1], D16(), to);
}

static HWY_INLINE Sums Weigh(const RowPair& rows, int16_t first, int16_t second)
{
    Sums sums = Bias(0, 0);
    sums.part[0] = hn::WidenMulAccumulate(D32(), rows.part[0], hn::Set(D16(), first), sums.part[0], sums.part[1]);
    sums.part[0] = hn::WidenMulAccumulate(D32(), rows.part[1], hn::Set(D16(), second), sums.part[0], sums.part[1]);
    return sums;
}

template<int kShift>
static HWY_INLINE RowPair PairUp(const Sums& first, const Sums& second)
{
    const auto narrow = [](const Sums& row) HWY_ATTR {
        return hn::BitCast(D16(),
            hn::OrderedTruncate2To(DU16(), hn::BitCast(DU32(), hn::ShiftRight<kShift>(row.part[0])),
                hn::BitCast(DU32(), hn::ShiftRight<kShift>(row.part[1]))));
    };
    return { narrow(first), narrow(second) };
}

template<int kLane>
static HWY_INLINE V32 WeighLane(V16 row, const std::array<int16_t, 4>& weights)
{
    V32 unused = hn::Zero(D32());
    return hn::WidenMulAccumulate(D32(), hn::Dup128VecFromValues(D16(), weights[0], weights[1], weights[2], weights[3], 0, 0, 0, 0),
        hn::Broadcast<kLane>(row), hn::Zero(D32()), unused);
}

template<int kLane>
static HWY_INLINE V32 WeighLanes(V16 rows, const std::array<int16_t, 4>& first, const std::array<int16_t, 4>& second)
{
    return hn::Add(WeighLane<kLane>(rows, first), WeighLane<kLane + 1>(rows, second));
}

static HWY_INLINE Sums TransformRow(const uint8_t* HWY_RESTRICT samples, Sums sums)
{
    const auto weights = [](size_t sample, size_t odd) {
        const int16_t* k = Basis<8>::k[sample] + odd;
        return std::array<int16_t, 4> { k[0], k[2], k[4], k[6] };
    };
    const hn::Half<D8> half;
    const auto bytes = hn::LoadU(half, samples);
    const V16 forward = hn::PromoteTo(D16(), bytes);
    const V16 backward = hn::PromoteTo(D16(), hn::Reverse(half, bytes));
    const V16 mirrored[2] = { hn::Add(forward, backward), hn::Sub(forward, backward) };
    for (size_t i = 0; i < 2; i++) {
        sums.part[i] = hn::Add(hn::Add(sums.part[i], WeighLanes<0>(mirrored[i], weights(0, i), weights(1, i))),
            WeighLanes<2>(mirrored[i], weights(2, i), weights(3, i)));
    }
    return sums;
}

static HWY_INLINE Widened Widen(V8 bytes)
{
    return { hn::PromoteLowerTo(D16(), bytes), hn::PromoteUpperTo(D16(), bytes) };
}

static HWY_INLINE V16 GreenOffset(V16 cb, V16 cr)
{
    const Sums sums = Bias(1 << 14, 1 << 14) + Weigh({ cb, cr }, -11277, -23401);
    return PairUp<15>(sums, sums).part[0];
}

static HWY_INLINE Widened BlendAcross(const uint8_t* HWY_RESTRICT row, int8_t weight)
{
    const auto load = [&](size_t at, int16_t times) HWY_ATTR {
        return hn::Mul(hn::PromoteTo(D16(), hn::LoadU(hn::Half<D8>(), row + at)), hn::Set(D16(), times));
    };
    const V16 thrice = load(1, static_cast<int16_t>(3 * weight));
    const V16 even = hn::Add(thrice, load(0, weight));
    const V16 odd = hn::Add(thrice, load(2, weight));
    return { hn::InterleaveLower(D16(), even, odd), hn::InterleaveUpper(D16(), even, odd) };
}

// Stores the luma of 16 pixels. Adds the Cb of each two to `chroma[0]`, and their Cr to `chroma[1]`.
static HWY_INLINE void SplitRow(const uint8_t* HWY_RESTRICT rgba, uint8_t* HWY_RESTRICT luma, V16 (&chroma)[4])
{
    V8 r8, g8, b8, a8;
    hn::LoadInterleaved4(D8(), rgba, r8, g8, b8, a8);
    const Widened r = Widen(r8), g = Widen(g8), b = Widen(b8);
    // Unsigned, for 38470 and 32768. What is negative wraps, and the sums come out as if it had not.
    const auto weigh = [&](int32_t bias, int32_t of_r, int32_t of_g, int32_t of_b) HWY_ATTR {
        const auto eight = [&](V16 r, V16 g, V16 b) HWY_ATTR {
            auto lower = hn::Set(DU32(), static_cast<uint32_t>(bias)), upper = lower;
            const auto add = [&](V16 channel, int32_t weight) HWY_ATTR {
                auto high = hn::Zero(DU32());
                const auto low = hn::WidenMulAccumulate(DU32(), hn::BitCast(DU16(), channel),
                    hn::Set(DU16(), static_cast<uint16_t>(weight < 0 ? -weight : weight)), hn::Zero(DU32()), high);
                lower = weight < 0 ? hn::Sub(lower, low) : hn::Add(lower, low);
                upper = weight < 0 ? hn::Sub(upper, high) : hn::Add(upper, high);
            };
            add(r, of_r);
            add(g, of_g);
            add(b, of_b);
            return hn::ConcatOdd(D16(), hn::BitCast(D16(), upper), hn::BitCast(D16(), lower));
        };
        return Widened { eight(r.lower, g.lower, b.lower), eight(r.upper, g.upper, b.upper) };
    };
    const Widened y = weigh(kLumaBias, 19595, 38470, 7471);
    const Widened cb = weigh(kChromaBias, -11059, -21709, 32768);
    const Widened cr = weigh(kChromaBias, 32768, -27439, -5329);
    hn::StoreU(hn::ConcatEven(D8(), hn::BitCast(D8(), y.upper), hn::BitCast(D8(), y.lower)), D8(), luma);
    chroma[0] = hn::Add(chroma[0], hn::PairwiseAdd128(D16(), cb.lower, cb.upper));
    chroma[1] = hn::Add(chroma[1], hn::PairwiseAdd128(D16(), cr.lower, cr.upper));
}

static HWY_INLINE void StoreChroma(const V16 (&chroma)[4], uint8_t* HWY_RESTRICT cb, uint8_t* HWY_RESTRICT cr)
{
    const hn::Half<D8> half;
    hn::StoreU(hn::DemoteTo(half, hn::ShiftRight<2>(hn::Add(chroma[0], Alternating(1, 2)))), half, cb);
    hn::StoreU(hn::DemoteTo(half, hn::ShiftRight<2>(hn::Add(chroma[1], Alternating(1, 2)))), half, cr);
}

#endif

// With weights that only differ in their sign from those of another call, the compiler finds the products to be the same.
static HWY_INLINE Sums AddWeighed(const Sums& sums, const RowPair& rows, int16_t first, int16_t second)
{
    if (first < 0 || (first == 0 && second < 0))
        return sums - Weigh(rows, static_cast<int16_t>(-first), static_cast<int16_t>(-second));
    return sums + Weigh(rows, first, second);
}

// The weights of coefficient `k` in the samples `first` to `first + 3`.
template<size_t N>
static constexpr std::array<int16_t, 4> WeightsOf(size_t k, size_t first)
{
    std::array<int16_t, 4> weights {};
    for (size_t i = 0; i < 4 && first + i < (N + 1) / 2; i++)
        weights[i] = Basis<N>::k[first + i][k];
    return weights;
}

// Sets `left` to the samples from `kFirst` on, and `right` to those that mirror them.
template<size_t N, size_t kFirst>
static HWY_INLINE void InverseRows(V16 rows, V32& left, V32& right)
{
    V32 even = hn::Add(WeighLanes<0>(rows, WeightsOf<N>(0, kFirst), WeightsOf<N>(2, kFirst)),
        WeighLanes<2>(rows, WeightsOf<N>(4, kFirst), WeightsOf<N>(6, kFirst)));
    if constexpr (N == 2)
        even = hn::Add(even, even);
    const V32 odd = hn::Add(WeighLanes<4>(rows, WeightsOf<N>(1, kFirst), WeightsOf<N>(3, kFirst)),
        WeighLanes<6>(rows, WeightsOf<N>(5, kFirst), WeightsOf<N>(7, kFirst)));
    left = hn::ShiftRight<18 + kExtraBits<N>>(hn::Add(even, odd));
    right = hn::ShiftRight<18 + kExtraBits<N>>(hn::Sub(even, odd));
}

// For rows of `room` bytes: half of them from the left on, and half from the right on.
template<size_t N>
static constexpr std::array<uint8_t, 16> LeftToRight(size_t room)
{
    std::array<uint8_t, 16> from {};
    for (size_t i = 0; i < 16; i++) {
        const size_t x = i % room, row = i - x;
        from[i] = x >= N ? kZero : static_cast<uint8_t>(row + (x < (N + 1) / 2 ? x : room / 2 + N - 1 - x));
    }
    return from;
}

static HWY_INLINE bool HasOnlyDc(const int16_t* HWY_RESTRICT block)
{
    V16 others = hn::IfThenZeroElse(hn::FirstN(D16(), 1), hn::Load(D16(), block));
    HWY_DEFAULT_UNROLL
    for (size_t i = hn::MaxLanes(D16()); i < 64; i += hn::MaxLanes(D16()))
        others = hn::Or(others, hn::Load(D16(), block + i));
    return hn::AllBits0(D16(), others);
}

template<size_t N>
static HWY_INLINE void InverseTransform(const int16_t* HWY_RESTRICT blocks, size_t count,
    const int16_t* HWY_RESTRICT quant, uint8_t* HWY_RESTRICT out, size_t stride)
{
    constexpr size_t kHalf = (N + 1) / 2;
    constexpr size_t kVectors = kHalf * kParts;
    constexpr int kShift = 11 + kExtraBits<N>;
    const hn::Full128<uint8_t> d128;
    const hn::Full64<uint8_t> d64;

    const RowPair steps[4] = { LoadPair(quant), LoadPair(quant + 16), LoadPair(quant + 32), LoadPair(quant + 48) };
    // Weighed as column 0 is by the second pass, 16 rounds its result and 4096 adds 128 to it.
    const Sums bias = Bias(((4096 + 16) << kShift) + (1 << (kShift - 1)), 1 << (kShift - 1));

    for (; count != 0; count--, blocks += 64, out += N) {
        // The small ones are done in the time that it takes to find out.
        if (N > 4 && HasOnlyDc(blocks)) {
            const int32_t mean = ((static_cast<int16_t>(blocks[0] * quant[0]) + 4) >> 3) + 128;
            const auto row = hn::Set(d128, static_cast<uint8_t>(HWY_MIN(HWY_MAX(mean, 0), 255)));
            HWY_DEFAULT_UNROLL
            for (size_t y = 0; y < N; y++) {
                if constexpr (N <= 8)
                    hn::StoreU(hn::LowerHalf(d64, row), d64, out + y * stride);
                else
                    hn::StoreU(row, d128, out + y * stride);
            }
            continue;
        }

        RowPair in[4] {};
        HWY_DEFAULT_UNROLL
        for (size_t i = 0; i < 4; i++) {
            in[i] = LoadPair(blocks + 16 * i);
            for (size_t part = 0; part < kParts; part++)
                in[i].part[part] = hn::Mul(in[i].part[part], steps[i].part[part]);
        }

        // Row `y`, then row `N - 1 - y`, for each `y`.
        V16 rows[kVectors];
        HWY_DEFAULT_UNROLL
        for (size_t y = 0; y < kHalf; y++) {
            const int16_t* k = Basis<N>::k[y];
            Sums even = AddWeighed(AddWeighed(bias, in[0], k[0], k[4]), in[1], k[2], k[6]);
            if constexpr (N == 2)
                even = AddWeighed(even, in[0], k[0], k[4]);
            const Sums odd = Weigh(in[2], k[1], k[3]) + Weigh(in[3], k[5], k[7]);
            const Sums upper = even + odd, lower = even - odd;
            const V32 sums[2 * kParts] = { upper.part[0], kParts == 1 ? lower.part[0] : upper.part[kParts - 1] };
            rows[y * kParts] = hn::OrderedDemote2To(D16(), hn::ShiftRight<kShift>(sums[0]), hn::ShiftRight<kShift>(sums[1]));
            if constexpr (kParts == 2) {
                rows[y * kParts + 1] = hn::OrderedDemote2To(D16(), hn::ShiftRight<kShift>(lower.part[0]),
                    hn::ShiftRight<kShift>(lower.part[kParts - 1]));
            }
        }
        const auto row = [&](size_t vector, size_t block) {
            const size_t nth = vector * (2 / kParts) + block;
            return out + (nth % 2 == 0 ? nth / 2 : N - 1 - nth / 2) * stride;
        };

        if constexpr (N <= 8) {
            HWY_DEFAULT_UNROLL
            for (size_t i = 0; i < kVectors; i += 2) {
                const size_t next = HWY_MIN(i + 1, kVectors - 1);
                V32 left, right, next_left, next_right;
                InverseRows<N, 0>(rows[i], left, right);
                InverseRows<N, 0>(rows[next], next_left, next_right);
                const V8 bytes = Shuffle(Pack(D8(), Pack(D16(), left, right), Pack(D16(), next_left, next_right)), LeftToRight<N>(8));
                const auto store = [&](hn::Vec<decltype(d128)> two_rows, size_t block) HWY_ATTR {
                    hn::StoreU(hn::LowerHalf(d64, two_rows), d64, row(i, block));
                    hn::StoreU(hn::UpperHalf(d64, two_rows), d64, row(next, block));
                };
                store(hn::ExtractBlock<0>(bytes), 0);
                if constexpr (kParts == 1)
                    store(hn::ExtractBlock<kLastBlock>(bytes), 1);
            }
        } else {
            HWY_DEFAULT_UNROLL
            for (size_t i = 0; i < kVectors; i++) {
                V32 left, right, more_left, more_right;
                InverseRows<N, 0>(rows[i], left, right);
                InverseRows<N, 4>(rows[i], more_left, more_right);
                const V8 bytes = Shuffle(Pack(D8(), Pack(D16(), left, more_left), Pack(D16(), right, more_right)), LeftToRight<N>(16));
                hn::StoreU(hn::ExtractBlock<0>(bytes), d128, row(i, 0));
                if constexpr (kParts == 1)
                    hn::StoreU(hn::ExtractBlock<kLastBlock>(bytes), d128, row(i, 1));
            }
        }
    }
}

static void JpegInverseTransform(const int16_t* HWY_RESTRICT blocks, size_t count, const int16_t* HWY_RESTRICT quant,
    size_t size, uint8_t* HWY_RESTRICT out, size_t stride)
{
    switch (size) {
    case 2:
        return InverseTransform<2>(blocks, count, quant, out, stride);
    case 3:
        return InverseTransform<3>(blocks, count, quant, out, stride);
    case 4:
        return InverseTransform<4>(blocks, count, quant, out, stride);
    case 5:
        return InverseTransform<5>(blocks, count, quant, out, stride);
    case 6:
        return InverseTransform<6>(blocks, count, quant, out, stride);
    case 7:
        return InverseTransform<7>(blocks, count, quant, out, stride);
    case 8:
        return InverseTransform<8>(blocks, count, quant, out, stride);
    case 10:
        return InverseTransform<10>(blocks, count, quant, out, stride);
    case 12:
        return InverseTransform<12>(blocks, count, quant, out, stride);
    case 14:
        return InverseTransform<14>(blocks, count, quant, out, stride);
    default:
        return;
    }
}

// `cb` and `cr` are from -128 to 127. These weights of 16 bits round as those of jdcolor.c do for all of them.
static HWY_INLINE void StoreRgba(V8 luma, const Widened& cb, const Widened& cr, uint8_t* HWY_RESTRICT out)
{
    const Widened y = Widen(luma);
    const auto plus = [](V16 y, V16 chroma, int16_t fraction) HWY_ATTR {
        return hn::Add(hn::Add(y, chroma), hn::MulFixedPoint15(chroma, hn::Set(D16(), fraction)));
    };
    hn::StoreInterleaved4(Pack(D8(), plus(y.lower, cr.lower, 13173), plus(y.upper, cr.upper, 13173)),
        Pack(D8(), hn::Add(y.lower, GreenOffset(cb.lower, cr.lower)), hn::Add(y.upper, GreenOffset(cb.upper, cr.upper))),
        Pack(D8(), plus(y.lower, cb.lower, 25297), plus(y.upper, cb.upper, 25297)), hn::Set(D8(), 255), D8(), out);
}

static void JpegYccToRgba(const uint8_t* HWY_RESTRICT y, const uint8_t* HWY_RESTRICT cb, const uint8_t* HWY_RESTRICT cr,
    size_t width, uint8_t* HWY_RESTRICT out)
{
    const auto centered = [](const uint8_t* HWY_RESTRICT from) HWY_ATTR {
        const Widened chroma = Widen(hn::LoadU(D8(), from));
        return Widened { hn::Sub(chroma.lower, hn::Set(D16(), 128)), hn::Sub(chroma.upper, hn::Set(D16(), 128)) };
    };
    for (size_t x = 0; x < width; x += kBytes)
        StoreRgba(hn::LoadU(D8(), y + x), centered(cb + x), centered(cr + x), out + 4 * x);
}

static void JpegYcc422ToRgba(const uint8_t* HWY_RESTRICT y, const uint8_t* HWY_RESTRICT cb, const uint8_t* HWY_RESTRICT cr,
    size_t width, uint8_t* HWY_RESTRICT out)
{
    const auto upsampled = [](const uint8_t* HWY_RESTRICT row) HWY_ATTR {
        const V16 bias = Alternating(1 - (128 << 2), 2 - (128 << 2));
        const Widened sums = BlendAcross(row, 1);
        return Widened { hn::ShiftRight<2>(hn::Add(sums.lower, bias)), hn::ShiftRight<2>(hn::Add(sums.upper, bias)) };
    };
    for (size_t x = 0; x < width; x += kBytes)
        StoreRgba(hn::LoadU(D8(), y + x), upsampled(cb + x / 2), upsampled(cr + x / 2), out + 4 * x);
}

static void JpegYcc420ToRgba(const uint8_t* HWY_RESTRICT y, const uint8_t* HWY_RESTRICT cb_near, const uint8_t* HWY_RESTRICT cb_far,
    const uint8_t* HWY_RESTRICT cr_near, const uint8_t* HWY_RESTRICT cr_far, size_t width, uint8_t* HWY_RESTRICT out)
{
    const auto upsampled = [](const uint8_t* HWY_RESTRICT near_row, const uint8_t* HWY_RESTRICT far_row) HWY_ATTR {
        const V16 bias = Alternating(8 - (128 << 4), 7 - (128 << 4));
        const Widened nearer = BlendAcross(near_row, 3), farther = BlendAcross(far_row, 1);
        return Widened { hn::ShiftRight<4>(hn::Add(hn::Add(nearer.lower, farther.lower), bias)),
            hn::ShiftRight<4>(hn::Add(hn::Add(nearer.upper, farther.upper), bias)) };
    };
    for (size_t x = 0; x < width; x += kBytes) {
        StoreRgba(hn::LoadU(D8(), y + x), upsampled(cb_near + x / 2, cb_far + x / 2),
            upsampled(cr_near + x / 2, cr_far + x / 2), out + 4 * x);
    }
}

static void JpegRgbaToYcc420(const uint8_t* HWY_RESTRICT rgba, size_t rgba_stride, size_t width, size_t row_pairs,
    uint8_t* HWY_RESTRICT y, uint8_t* HWY_RESTRICT cb, uint8_t* HWY_RESTRICT cr, size_t chroma_stride)
{
    for (; row_pairs != 0; row_pairs--, rgba += 2 * rgba_stride, y += 4 * chroma_stride, cb += chroma_stride, cr += chroma_stride) {
        for (size_t x = 0; x < width; x += kBytes) {
            V16 chroma[4] = { hn::Zero(D16()), hn::Zero(D16()), hn::Zero(D16()), hn::Zero(D16()) };
            SplitRow(rgba + 4 * x, y + x, chroma);
            SplitRow(rgba + rgba_stride + 4 * x, y + 2 * chroma_stride + x, chroma);
            StoreChroma(chroma, cb + x / 2, cr + x / 2);
        }
    }
}

// For each 16 of the 64 bytes that the four pairs of rows are packed to, where in them each coefficient is, in zigzag order.
static constexpr std::array<std::array<uint8_t, 64>, 4> kZigzagFrom = [] {
    constexpr size_t pair_of[8] = { 0, 2, 1, 2, 0, 3, 1, 3 }, nth_in_pair[8] = { 0, 0, 0, 1, 1, 0, 1, 1 };
    std::array<std::array<uint8_t, 64>, 4> from {};
    size_t k = 0;
    for (size_t diagonal = 0; diagonal < 15; diagonal++) {
        for (size_t i = 0; i <= diagonal; i++) {
            const size_t row = diagonal % 2 == 0 ? diagonal - i : i, column = diagonal - row;
            if (row > 7 || column > 7)
                continue;
            for (size_t pair = 0; pair < 4; pair++) {
                from[pair][k] = pair != pair_of[row]
                    ? kZero
                    : static_cast<uint8_t>(OffsetInPair(nth_in_pair[row], column / 2 + column % 2 * 4));
            }
            k++;
        }
    }
    return from;
}();

template<bool kBitPlanes>
static HWY_INLINE void ForwardTransform(const uint8_t* HWY_RESTRICT samples, size_t stride, size_t count,
    const uint16_t* HWY_RESTRICT divisors, int16_t* HWY_RESTRICT blocks, uint64_t* HWY_RESTRICT masks)
{
    // Coefficient 0 of a row is the only one that taking 128 from each sample changes.
    const Sums first_bias = Bias((1 << 10) - 8 * 128 * 8192, 1 << 10);
    const Sums second_bias = Bias(1 << 14, 1 << 14);
    constexpr auto& k = Basis<8>::k;

    for (; count != 0; count--, samples += 8, blocks += 64, masks += kBitPlanes ? 4 : 1) {
        const auto rows = [&](size_t first, size_t second) HWY_ATTR {
            return PairUp<11>(TransformRow(samples + first * stride, first_bias), TransformRow(samples + second * stride, first_bias));
        };
        const RowPair rows01 = rows(0, 1), rows76 = rows(7, 6), rows32 = rows(3, 2), rows45 = rows(4, 5);
        const RowPair sums01 = rows01 + rows76, sums32 = rows32 + rows45;
        const RowPair differences01 = rows01 - rows76, differences32 = rows32 - rows45;
        const RowPair for04 = sums01 + sums32, for26 = sums01 - sums32;
        const auto even = [&](const RowPair& from, size_t row) HWY_ATTR { return second_bias + Weigh(from, k[0][row], k[1][row]); };
        const auto odd = [&](size_t row) HWY_ATTR {
            return second_bias + Weigh(differences01, k[0][row], k[1][row]) + Weigh(differences32, k[3][row], k[2][row]);
        };
        const RowPair coefficients[4] = { PairUp<15>(even(for04, 0), even(for04, 4)), PairUp<15>(even(for26, 2), even(for26, 6)),
            PairUp<15>(odd(1), odd(3)), PairUp<15>(odd(5), odd(7)) };

        V16 to_pack[4 * kParts];
        HWY_DEFAULT_UNROLL
        for (size_t i = 0; i < 4; i++) {
            const int16_t* from = reinterpret_cast<const int16_t*>(divisors) + 16 * i;
            const RowPair rounding = LoadPair(from), reciprocal = LoadPair(from + 64), scale = LoadPair(from + 128);
            RowPair quantized {};
            for (size_t part = 0; part < kParts; part++) {
                const V16 value = coefficients[i].part[part];
                const auto dividend = hn::BitCast(DU16(), hn::Add(hn::Abs(value), rounding.part[part]));
                const V16 magnitude = hn::BitCast(D16(),
                    hn::MulHigh(hn::MulHigh(dividend, hn::BitCast(DU16(), reciprocal.part[part])), hn::BitCast(DU16(), scale.part[part])));
                quantized.part[part] = hn::IfNegativeThenNegOrUndefIfZero(value, magnitude);
                if constexpr (kBitPlanes) {
                    // The low two bits, and 4 for all above them.
                    const V16 bits = hn::Min(magnitude, hn::OrAnd(hn::Set(D16(), 4), magnitude, hn::Set(D16(), 3)));
                    to_pack[i * kParts + part] = hn::IfNegativeThenNegOrUndefIfZero(value, bits);
                } else {
                    to_pack[i * kParts + part] = magnitude;
                }
            }
            StorePair(quantized, blocks + 16 * i);
        }

        HWY_ALIGN int8_t packed[64];
        HWY_DEFAULT_UNROLL
        for (size_t i = 0; i < 2 * kParts; i++)
            hn::Store(hn::OrderedDemote2To(DI8(), to_pack[2 * i], to_pack[2 * i + 1]), DI8(), packed + i * kBytes);

        uint64_t found[4] = {};
        HWY_DEFAULT_UNROLL
        for (size_t at = 0; at < 64; at += kBytes) {
            auto zigzag = hn::Zero(DI8());
            HWY_DEFAULT_UNROLL
            for (size_t pair = 0; pair < 4; pair++) {
                zigzag = hn::Or(zigzag,
                    hn::TableLookupBytesOr0(hn::LoadDup128(DI8(), packed + 16 * pair),
                        hn::BitCast(DI8(), hn::LoadU(D8(), kZigzagFrom[pair].data() + at))));
            }
            if constexpr (kBitPlanes) {
                const auto bits = hn::Abs(zigzag);
                found[0] |= hn::BitsFromMask(DI8(), hn::TestBit(bits, hn::Set(DI8(), 1))) << at;
                found[1] |= hn::BitsFromMask(DI8(), hn::TestBit(bits, hn::Set(DI8(), 2))) << at;
                found[2] |= hn::BitsFromMask(DI8(), hn::TestBit(bits, hn::Set(DI8(), 4))) << at;
                found[3] |= hn::BitsFromMask(DI8(), hn::IsNegative(zigzag)) << at;
            } else {
                found[0] |= hn::BitsFromMask(DI8(), hn::Gt(zigzag, hn::Zero(DI8()))) << at;
            }
        }
        hwy::CopyBytes<kBitPlanes ? 32 : 8>(found, masks);
    }
}

static void JpegForwardTransform(const uint8_t* HWY_RESTRICT samples, size_t stride, size_t count,
    const uint16_t* HWY_RESTRICT divisors, int16_t* HWY_RESTRICT blocks, uint64_t* HWY_RESTRICT masks, bool bit_planes)
{
    if (bit_planes)
        return ForwardTransform<true>(samples, stride, count, divisors, blocks, masks);
    ForwardTransform<false>(samples, stride, count, divisors, blocks, masks);
}

// NOLINTNEXTLINE(google-readability-namespace-comments)
} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {
HWY_EXPORT(JpegInverseTransform);
HWY_EXPORT(JpegYccToRgba);
HWY_EXPORT(JpegYcc422ToRgba);
HWY_EXPORT(JpegYcc420ToRgba);
HWY_EXPORT(JpegRgbaToYcc420);
HWY_EXPORT(JpegForwardTransform);

// `blocks` has `count` blocks and `quant` one, aligned to 32 bytes. Touches `size` rows of `out`, `stride` bytes apart:
// `size` bytes for each block but the last and at most 16 for that one.
extern "C" void highway_jpeg_inverse_transform(const int16_t* blocks, size_t count, const int16_t* quant, size_t size,
    uint8_t* out, size_t stride)
{
    BUN_HWY_DISPATCH(JpegInverseTransform)(blocks, count, quant, size, out, stride);
}

// These three touch what belongs to `width` pixels, a multiple of 32. Rows of half the width start one sample early and
// have 8 bytes more.
extern "C" void highway_jpeg_ycc_to_rgba(const uint8_t* y, const uint8_t* cb, const uint8_t* cr, size_t width, uint8_t* out)
{
    BUN_HWY_DISPATCH(JpegYccToRgba)(y, cb, cr, width, out);
}

extern "C" void highway_jpeg_ycc422_to_rgba(const uint8_t* y, const uint8_t* cb, const uint8_t* cr, size_t width, uint8_t* out)
{
    BUN_HWY_DISPATCH(JpegYcc422ToRgba)(y, cb, cr, width, out);
}

extern "C" void highway_jpeg_ycc420_to_rgba(const uint8_t* y, const uint8_t* cb_near, const uint8_t* cb_far,
    const uint8_t* cr_near, const uint8_t* cr_far, size_t width, uint8_t* out)
{
    BUN_HWY_DISPATCH(JpegYcc420ToRgba)(y, cb_near, cb_far, cr_near, cr_far, width, out);
}

// Touches `width` pixels, a multiple of 32, of `2 * row_pairs` rows of `rgba` and `y`, and half of both of `cb` and `cr`.
// The rows of `y` are `2 * chroma_stride` bytes apart.
extern "C" void highway_jpeg_rgba_to_ycc420(const uint8_t* rgba, size_t rgba_stride, size_t width, size_t row_pairs,
    uint8_t* y, uint8_t* cb, uint8_t* cr, size_t chroma_stride)
{
    BUN_HWY_DISPATCH(JpegRgbaToYcc420)(rgba, rgba_stride, width, row_pairs, y, cb, cr, chroma_stride);
}

// Reads `8 * count` bytes of 8 rows, `stride` bytes apart. `divisors` has three blocks and `blocks` room for `count`,
// aligned to 32 bytes. `masks` has room for `count` words, or four times that with `bit_planes`.
extern "C" void highway_jpeg_forward_transform(const uint8_t* samples, size_t stride, size_t count, const uint16_t* divisors,
    int16_t* blocks, uint64_t* masks, bool bit_planes)
{
    BUN_HWY_DISPATCH(JpegForwardTransform)(samples, stride, count, divisors, blocks, masks, bit_planes);
}
} // namespace bun
#endif
