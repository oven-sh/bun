// The transforms and color conversions for src/jpeg, in the arithmetic of libjpeg-turbo (LICENSE.md). All targets give the same bytes.

// A block has the rows 0 and 4 interleaved, then 2 and 6, 1 and 3, 5 and 7, with their columns in the order 0 2 4 6 1 3 5 7.

// Besides the list in scripts/build/deps/highway.ts: SVE, all above AVX2, and what would compile to the same as the baseline.
#undef HWY_DISABLED_TARGETS
#define HWY_DISABLED_TARGETS (HWY_ALL_SVE | HWY_NEON | HWY_NEON_BF16 | HWY_SSE4 | (HWY_AVX2 - 1))
#ifndef __OPTIMIZE__
#error "Unless hwy::ChosenTarget::GetIndex() is inlined, the linker may keep that of a file with other targets."
#endif

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
// `JPEG_PIXEL_GROUP` in src/highway/lib.rs.
static constexpr size_t kPixelGroup = 32;
// How many vectors 32 bytes are.
static constexpr size_t kParts = 32 / kBytes;
// The index of the last 128 bits of a vector.
static constexpr int kLastBlock = kBytes / 16 - 1;

// jidctint.c and jidctred.c, multiplied out: `kWeights[i]` weighs 8 coefficients for sample `i` of `N` and, the odd ones negated, for `N - 1 - i`.
template<size_t N> struct Basis;
// The weights are scaled by 2^(13 + kExtraBits).
template<size_t N> static constexpr int kExtraBits = N == 2 ? 2 : N == 4 ? 1
                                                                         : 0;
// The first weight is halved: 32768 does not fit in 16 bits.
template<> struct Basis<2> {
    static constexpr int16_t kWeights[1][8] = { { 16384, 29692, 0, -10426, 0, 6967, 0, -5906 } };
};
template<> struct Basis<3> {
    static constexpr int16_t kWeights[2][8] = {
        { 8192, 10033, 5793, 0, 0, 0, 0, 0 },
        { 8192, 0, -11586, 0, 0, 0, 0, 0 },
    };
};
template<> struct Basis<4> {
    static constexpr int16_t kWeights[2][8] = {
        { 16384, 20995, 15137, 7373, 0, -4926, -6270, -4176 },
        { 16384, 8697, -15137, -17799, 0, 11893, 6270, -1730 },
    };
};
template<> struct Basis<5> {
    static constexpr int16_t kWeights[3][8] = {
        { 8192, 11019, 9372, 6810, 3580, 0, 0, 0 },
        { 8192, 6810, -3580, -11018, -9372, 0, 0, 0 },
        { 8192, 0, -11584, 0, 11584, 0, 0, 0 },
    };
};
template<> struct Basis<6> {
    static constexpr int16_t kWeights[3][8] = {
        { 8192, 11190, 10033, 8192, 5793, 2998, 0, 0 },
        { 8192, 8192, 0, -8192, -11586, -8192, 0, 0 },
        { 8192, 2998, -10033, -8192, 5793, 11190, 0, 0 },
    };
};
template<> struct Basis<7> {
    static constexpr int16_t kWeights[4][8] = {
        { 8192, 11295, 10438, 9058, 7223, 5027, 2578, 0 },
        { 8192, 9058, 2578, -5027, -10438, -11295, -7223, 0 },
        { 8192, 5027, -7223, -11295, -2578, 9058, 10438, 0 },
        { 8192, 0, -11585, 0, 11585, 0, -11585, 0 },
    };
};
template<> struct Basis<8> {
    static constexpr int16_t kWeights[4][8] = {
        { 8192, 11363, 10703, 9633, 8192, 6437, 4433, 2260 },
        { 8192, 9633, 4433, -2259, -8192, -11362, -10704, -6436 },
        { 8192, 6437, -4433, -11362, -8192, 2261, 10704, 9633 },
        { 8192, 2260, -10703, -6436, 8192, 9633, -4433, -11363 },
    };
};
template<> struct Basis<10> {
    static constexpr int16_t kWeights[5][8] = {
        { 8192, 11443, 11019, 10322, 9373, 8192, 6810, 5260 },
        { 8192, 10323, 6810, 1812, -3580, -8192, -11018, -11442 },
        { 8192, 8192, 0, -8192, -11586, -8192, 0, 8192 },
        { 8192, 5260, -6810, -11442, -3580, 8192, 11018, 1812 },
        { 8192, 1812, -11019, -5260, 9373, 8192, -6810, -10322 },
    };
};
template<> struct Basis<12> {
    static constexpr int16_t kWeights[6][8] = {
        { 8192, 11487, 11190, 10703, 10033, 9192, 8192, 7053 },
        { 8192, 10703, 8192, 4433, 0, -4433, -8192, -10703 },
        { 8192, 9192, 2998, -4433, -10033, -11485, -8192, -1512 },
        { 8192, 7053, -2998, -10703, -10033, -1512, 8192, 11486 },
        { 8192, 4433, -8192, -10704, 0, 10704, 8192, -4433 },
        { 8192, 1513, -11190, -4433, 10033, 7053, -8192, -9191 },
    };
};
template<> struct Basis<14> {
    static constexpr int16_t kWeights[7][8] = {
        { 8192, 11513, 11295, 10935, 10438, 9810, 9058, 8192 },
        { 8192, 10935, 9058, 6164, 2578, -1297, -5026, -8192 },
        { 8192, 9810, 5027, -1297, -7223, -10934, -11295, -8192 },
        { 8192, 8192, 0, -8192, -11586, -8192, 0, 8192 },
        { 8192, 6164, -5027, -11512, -7223, 3826, 11295, 8192 },
        { 8192, 3826, -9058, -9809, 2578, 11512, 5026, -8192 },
        { 8192, 1297, -11295, -3826, 10438, 6164, -9058, -8192 },
    };
};

template<size_t N> static constexpr int16_t WeightOf(size_t sample, size_t k)
{
    return sample < (N + 1) / 2 ? Basis<N>::kWeights[sample][k] : 0;
}

// The coefficient of a row that is stored in column `x` of a block, and the inverse.
static constexpr size_t InColumn(size_t x) { return x % 4 * 2 + x / 4; }
static constexpr size_t ColumnOf(size_t k) { return k % 2 * 4 + k / 2; }

template<class V> struct Parts {
    V part[kParts];
};

// One row of 8 sums of products.
using Sums = Parts<V32>;
// Two rows of 8. x64 multiplies and adds neighboring lanes, so there they are interleaved. Elsewhere each is a vector.
using RowPair = Parts<V16>;

// 16 values per 128 bits: the first 8 are in `lower`.
struct Widened {
    V16 lower;
    V16 upper;
};

template<class V>
static HWY_INLINE Parts<V> operator+(Parts<V> a, const Parts<V>& b)
{
    for (size_t i = 0; i < kParts; i++)
        a.part[i] = hn::Add(a.part[i], b.part[i]);
    return a;
}

template<class V>
static HWY_INLINE Parts<V> operator-(Parts<V> a, const Parts<V>& b)
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

// Scaled by 2^16 (jccolor.c) and by 2^15 (jdcolor.c).
static constexpr int16_t kRedInLuma = 19595, kBlueInLuma = 7471;
static constexpr int16_t kCbInGreen = -11277, kCrInGreen = -23401;

// Added to the weighted R, G and B before the low 16 bits are dropped.
static constexpr int32_t kLumaBias = 32768;
static constexpr int32_t kChromaBias = (128 << 16) + 32767;

// For each coefficient in zigzag order: the storage position of its row and of its column.
static constexpr auto kZigzag = [] {
    constexpr size_t nth_row[8] = { 0, 4, 2, 5, 1, 6, 3, 7 };
    std::array<std::array<size_t, 2>, 64> places {};
    size_t k = 0;
    for (size_t diagonal = 0; diagonal < 15; diagonal++) {
        for (size_t i = 0; i <= diagonal; i++) {
            const size_t row = diagonal % 2 == 0 ? diagonal - i : i, column = diagonal - row;
            if (row < 8 && column < 8)
                places[k++] = { nth_row[row], ColumnOf(column) };
        }
    }
    return places;
}();

#if HWY_ARCH_X86

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

static HWY_INLINE Sums Weigh(const RowPair& rows, int16_t first, int16_t second, Sums sums = Bias(0, 0))
{
    for (size_t i = 0; i < kParts; i++)
        sums.part[i] = hn::Add(sums.part[i], hn::WidenMulPairwiseAdd(D32(), rows.part[i], Alternating(first, second)));
    return sums;
}

// The sums have to fit in 16 bits after the shift.
template<int kShift>
static HWY_INLINE RowPair RoundAndPairUp(const Sums& first, const Sums& second)
{
    const V32 half = hn::Set(D32(), 1 << (kShift - 1));
    RowPair pair {};
    for (size_t i = 0; i < kParts; i++) {
        pair.part[i] = hn::OddEven(hn::BitCast(D16(), hn::ShiftLeft<16 - kShift>(hn::Add(second.part[i], half))),
            hn::BitCast(D16(), hn::ShiftRight<kShift>(hn::Add(first.part[i], half))));
    }
    return pair;
}

template<int kShift>
static HWY_INLINE V16 ShiftAndPack(V32 a, V32 b)
{
    return Pack(D16(), hn::ShiftRight<kShift>(a), hn::ShiftRight<kShift>(b));
}

template<size_t N, bool kForward = false> struct Weights {
    // The weight of coefficient `k` in `sample`, for `Weigh`.
    HWY_INLINE int16_t Of(size_t sample, size_t k) const { return WeightOf<N>(sample, k); }

    // `rows` has a row in each 128 bits. What its columns `x` and `x + 1` add to the 4 samples from `kFirst` on.
    template<size_t kFirst, int x> HWY_INLINE V32 Spread(V16 rows) const
    {
        constexpr size_t a = InColumn(x), b = InColumn(x + 1), i = kFirst;
        return hn::WidenMulPairwiseAdd(D32(), hn::BitCast(D16(), hn::Broadcast<x / 2>(hn::BitCast(D32(), rows))),
            hn::Dup128VecFromValues(D16(), Of(i, a), Of(i, b), Of(i + 1, a), Of(i + 1, b), Of(i + 2, a), Of(i + 2, b),
                Of(i + 3, a), Of(i + 3, b)));
    }
};

// The DCT of 8 samples: even coefficients from the sums of mirrored samples, odd ones from their differences.
static HWY_INLINE Sums TransformRow(const Weights<8, true>&, const uint8_t* HWY_RESTRICT samples)
{
    static constexpr auto weights = [](size_t first) {
        std::array<int16_t, 16> weights {};
        for (size_t i = 0; i < 16; i++)
            weights[i] = Basis<8>::kWeights[first + i % 2][i < 8 ? i / 2 * 2 : (i - 8) / 2 * 2 + 1];
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
    Sums sums {};
    for (size_t i = 0; i < kParts; i++) {
        const auto signs = hn::Load(DI8(), kSigns + i * kBytes);
        const size_t at = i * hn::MaxLanes(D16());
        sums.part[i] = hn::Add(
            hn::WidenMulPairwiseAdd(D32(), hn::SatWidenMulPairwiseAdd(D16(), outer, signs), hn::Load(D16(), kOuter.data() + at)),
            hn::WidenMulPairwiseAdd(D32(), hn::SatWidenMulPairwiseAdd(D16(), inner, signs), hn::Load(D16(), kInner.data() + at)));
    }
    return sums;
}

static HWY_INLINE Widened Widen(V8 bytes)
{
    const V8 zero = hn::Zero(D8());
    return { hn::ZipLower(D16(), bytes, zero), hn::ZipUpper(D16(), bytes, zero) };
}

static HWY_INLINE V16 GreenOffset(V16 cb, V16 cr)
{
    const V16 weights = Alternating(kCbInGreen, kCrInGreen);
    const V32 half = hn::Set(D32(), 1 << 14);
    return ShiftAndPack<15>(hn::Add(hn::WidenMulPairwiseAdd(D32(), hn::InterleaveLower(D16(), cb, cr), weights), half),
        hn::Add(hn::WidenMulPairwiseAdd(D32(), hn::InterleaveUpper(D16(), cb, cr), weights), half));
}

// `weight` is from 1 to 2, scaled by 2^14.
static HWY_INLINE V16 RedOrBlue(V16 y, V16 chroma, int16_t weight)
{
    return hn::Add(hn::Add(y, chroma), hn::MulFixedPoint15(chroma, hn::Set(D16(), static_cast<int16_t>(2 * weight - 32768))));
}

// For each sample from `row[1]` on: `weight * (3 * sample + before)`, then `weight * (3 * sample + after)`.
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

// Cb or Cr less 128.
using Centered = Widened;

static HWY_INLINE Widened Widen(const Centered& v) { return v; }

static HWY_INLINE Centered Center(V8 samples)
{
    const Widened v = Widen(samples);
    return { hn::Sub(v.lower, hn::Set(D16(), 128)), hn::Sub(v.upper, hn::Set(D16(), 128)) };
}

// Both overloads produce `kPixelGroup` pixels.
static HWY_INLINE void Upsample(const uint8_t* HWY_RESTRICT row, Centered (&out)[kParts])
{
    const V16 bias = Alternating(1 - (128 << 2), 2 - (128 << 2));
    for (size_t i = 0; i < kParts; i++) {
        const Widened sums = BlendAcross(row + 8 * i, 1);
        out[i] = { hn::ShiftRight<2>(hn::Add(sums.lower, bias)), hn::ShiftRight<2>(hn::Add(sums.upper, bias)) };
    }
}

static HWY_INLINE void Upsample(const uint8_t* HWY_RESTRICT near_row, const uint8_t* HWY_RESTRICT far_row, Centered (&out)[kParts])
{
    const V16 bias = Alternating(8 - (128 << 4), 7 - (128 << 4));
    for (size_t i = 0; i < kParts; i++) {
        const Widened nearer = BlendAcross(near_row + 8 * i, 3), farther = BlendAcross(far_row + 8 * i, 1);
        out[i] = { hn::ShiftRight<4>(hn::Add(hn::Add(nearer.lower, farther.lower), bias)),
            hn::ShiftRight<4>(hn::Add(hn::Add(nearer.upper, farther.upper), bias)) };
    }
}

// Undoes the interleaving of 128-bit halves that packing 4 vectors of 32-bit lanes causes.
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
        const V16 rb = hn::PromoteEvenTo(D16(), pixels);
        const V16 gg = hn::BitCast(D16(),
            Shuffle(pixels, { 1, kZero, 1, kZero, 5, kZero, 5, kZero, 9, kZero, 9, kZero, 13, kZero, 13, kZero }));
        const auto weigh = [&](int16_t r, int16_t b, int16_t g, int16_t more_g) HWY_ATTR {
            return hn::Add(hn::WidenMulPairwiseAdd(D32(), rb, Alternating(r, b)),
                hn::WidenMulPairwiseAdd(D32(), gg, Alternating(g, more_g)));
        };
        // 38470 and 32768 do not fit in 16 bits, so the first is split in halves and the second negated.
        y[i] = hn::ShiftRight<16>(hn::Add(hn::Set(D32(), kLumaBias), weigh(kRedInLuma, kBlueInLuma, 19235, 19235)));
        const V32 cb = hn::Sub(hn::Set(D32(), kChromaBias), weigh(11059, -32768, 21709, 0));
        const V32 cr = hn::Sub(hn::Set(D32(), kChromaBias), weigh(-32768, 5329, 27439, 0));
        chroma[i] = hn::Add(chroma[i], hn::InterleaveOdd(D16(), hn::BitCast(D16(), cb), hn::BitCast(D16(), cr)));
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

// For each 16 of the 64 bytes that a block is packed to: the shuffle that takes its coefficients to zigzag order.
static constexpr std::array<std::array<uint8_t, 64>, 4> kZigzagFrom = [] {
    std::array<std::array<uint8_t, 64>, 4> from {};
    for (size_t k = 0; k < 64; k++) {
        for (size_t pair = 0; pair < 4; pair++) {
            const auto [row, column] = kZigzag[k];
            from[pair][k] = pair != row / 2 ? kZero : static_cast<uint8_t>(2 * column + row % 2);
        }
    }
    return from;
}();

// One mask of the nonzero lanes or, with `kBitPlanes`, one each for bits 0, 1 and 2 and the sign.
template<bool kBitPlanes>
static HWY_INLINE void StoreMasks(const V16 (&to_pack)[4 * kParts], uint64_t* HWY_RESTRICT masks)
{
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
            found[0] |= hn::BitsFromMask(DI8(), hn::TestBit(zigzag, hn::Set(DI8(), 1))) << at;
            found[1] |= hn::BitsFromMask(DI8(), hn::TestBit(zigzag, hn::Set(DI8(), 2))) << at;
            found[2] |= hn::BitsFromMask(DI8(), hn::TestBit(zigzag, hn::Set(DI8(), 4))) << at;
            found[3] |= hn::BitsFromMask(DI8(), hn::IsNegative(zigzag)) << at;
        } else {
            found[0] |= hn::BitsFromMask(DI8(), hn::Ne(zigzag, hn::Zero(DI8()))) << at;
        }
    }
    hwy::CopyBytes<kBitPlanes ? 32 : 8>(found, masks);
}

static HWY_INLINE bool HasOnlyDc(const int16_t* HWY_RESTRICT block)
{
    V16 others = hn::IfThenZeroElse(hn::FirstN(D16(), 1), hn::Load(D16(), block));
    HWY_DEFAULT_UNROLL
    for (size_t i = hn::MaxLanes(D16()); i < 64; i += hn::MaxLanes(D16()))
        others = hn::Or(others, hn::Load(D16(), block + i));
    return hn::AllBits0(D16(), others);
}

#else

static_assert(kParts == 2);

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

static HWY_INLINE Sums Weigh(const RowPair& rows, V16 first, V16 second, Sums sums = Bias(0, 0))
{
    sums.part[0] = hn::WidenMulAccumulate(D32(), rows.part[0], first, sums.part[0], sums.part[1]);
    sums.part[0] = hn::WidenMulAccumulate(D32(), rows.part[1], second, sums.part[0], sums.part[1]);
    return sums;
}

static HWY_INLINE Sums Weigh(const RowPair& rows, int16_t first, int16_t second)
{
    if (first != 8192 || HWY_MAX(second, -second) != 8192)
        return Weigh(rows, hn::Set(D16(), first), hn::Set(D16(), second));
    const auto weigh = [&](V32 a, V32 b) HWY_ATTR { return hn::ShiftLeft<13>(second > 0 ? hn::Add(a, b) : hn::Sub(a, b)); };
    return { weigh(hn::PromoteLowerTo(D32(), rows.part[0]), hn::PromoteLowerTo(D32(), rows.part[1])),
        weigh(hn::PromoteUpperTo(D32(), rows.part[0]), hn::PromoteUpperTo(D32(), rows.part[1])) };
}

template<int kShift>
static HWY_INLINE RowPair RoundAndPairUp(const Sums& first, const Sums& second)
{
    const auto narrow = [](const Sums& row) HWY_ATTR {
        return Pack(D16(), hn::RoundingShiftRight<kShift>(row.part[0]), hn::RoundingShiftRight<kShift>(row.part[1]));
    };
    return { narrow(first), narrow(second) };
}

// `kShift` is 16 or more.
template<int kShift>
static HWY_INLINE V16 ShiftAndPack(V32 a, V32 b)
{
    const auto high_halves = [](V32 v) HWY_ATTR {
        return hn::TruncateTo(hn::Half<DU16>(), hn::ShiftRight<16>(hn::BitCast(DU32(), v)));
    };
    return hn::ShiftRight<kShift - 16>(hn::BitCast(D16(), hn::Combine(DU16(), high_halves(b), high_halves(a))));
}

// Kept in registers, for multiplications by a lane.
template<size_t N, bool kForward = false> struct Weights {
    // Each has two columns for 4 samples or, if `kForward`, all columns for one.
    V16 vectors[N > 8 ? 8 : 4];

    static constexpr size_t IndexOf(size_t sample, size_t k)
    {
        return kForward ? 8 * sample + ColumnOf(k) : sample / 4 * 32 + 4 * ColumnOf(k) + sample % 4;
    }

    HWY_INLINE Weights()
    {
        HWY_ALIGN static constexpr auto kTable = [] {
            std::array<int16_t, 64> table {};
            for (size_t i = 0; i < 64; i++)
                table[IndexOf(i / 8, i % 8)] = WeightOf<N>(i / 8, i % 8);
            return table;
        }();
        // Hidden from the compiler, which would broadcast each constant to a register of its own.
        const int16_t* table = kTable.data();
        hwy::PreventElision(table);
        for (size_t i = 0; i < std::size(vectors); i++)
            vectors[i] = hn::Load(D16(), table + 8 * i);
    }

    HWY_INLINE V16 Of(size_t sample, size_t k) const
    {
        const size_t at = IndexOf(sample, k);
        return hn::Set(D16(), WeightOf<N>(sample, k) == 0 ? int16_t { 0 } : hn::ExtractLane(vectors[at / 8], at % 8));
    }

    // A weight that is zero for sample 0 is zero for all.
    template<int x> static HWY_INLINE V16 Column(V16 row)
    {
        return WeightOf<N>(0, InColumn(x)) == 0 ? hn::Zero(D16()) : hn::Broadcast<x>(row);
    }

    template<size_t kFirst, int x> HWY_INLINE V32 Spread(V16 row) const
    {
        V32 unused = hn::Zero(D32()), second = unused;
        hn::WidenMulAccumulate(D32(), vectors[kFirst + x / 2], Column<x + 1>(row), unused, second);
        return hn::WidenMulAccumulate(D32(), vectors[kFirst + x / 2], Column<x>(row), second, unused);
    }
};

static HWY_INLINE Sums TransformRow(const Weights<8, true>& weights, const uint8_t* HWY_RESTRICT samples)
{
    const hn::Half<D8> half;
    const auto bytes = hn::LoadU(half, samples);
    const V16 forward = hn::PromoteTo(D16(), bytes);
    const V16 backward = hn::PromoteTo(D16(), hn::Reverse(half, bytes));
    const V16 sums = hn::Add(forward, backward), differences = hn::Sub(forward, backward);
    V32 even = hn::Zero(D32()), odd = even, unused = even;
    const auto add = [&](V16 weights, V16 sum, V16 difference) HWY_ATTR {
        even = hn::WidenMulAccumulate(D32(), weights, sum, even, unused);
        hn::WidenMulAccumulate(D32(), weights, difference, unused, odd);
    };
    add(weights.vectors[0], hn::Broadcast<0>(sums), hn::Broadcast<0>(differences));
    add(weights.vectors[1], hn::Broadcast<1>(sums), hn::Broadcast<1>(differences));
    add(weights.vectors[2], hn::Broadcast<2>(sums), hn::Broadcast<2>(differences));
    add(weights.vectors[3], hn::Broadcast<3>(sums), hn::Broadcast<3>(differences));
    return { even, odd };
}

static HWY_INLINE Widened Widen(V8 bytes)
{
    return { hn::PromoteLowerTo(D16(), bytes), hn::PromoteUpperTo(D16(), bytes) };
}

using Centered = hn::Vec<DI8>;

// Doubled, as `GreenOffset` and `RedOrBlue` expect.
static HWY_INLINE Widened Widen(Centered v)
{
    return { hn::ShiftLeft<1>(hn::PromoteLowerTo(D16(), v)), hn::ShiftLeft<1>(hn::PromoteUpperTo(D16(), v)) };
}

static HWY_INLINE V16 GreenOffset(V16 cb, V16 cr)
{
    const Sums sums = Bias(1 << 15, 1 << 15) + Weigh({ cb, cr }, kCbInGreen, kCrInGreen);
    return ShiftAndPack<16>(sums.part[0], sums.part[1]);
}

static HWY_INLINE V16 RedOrBlue(V16 y, V16 chroma, int16_t weight)
{
    return hn::Add(y, hn::MulFixedPoint15(chroma, hn::Set(D16(), weight)));
}

static HWY_INLINE Centered Center(V8 samples)
{
    return hn::BitCast(DI8(), hn::Xor(samples, hn::Set(D8(), 128)));
}

// (3 * sample + before + 1) / 4 and (3 * sample + after + 2) / 4
static HWY_INLINE void Upsample(const uint8_t* HWY_RESTRICT row, Centered (&out)[2])
{
    const auto average_down = [](V8 a, V8 b) HWY_ATTR { return hn::Add(hn::And(a, b), hn::ShiftRight<1>(hn::Xor(a, b))); };
    const V8 sample = hn::LoadU(D8(), row + 1);
    const Centered even = Center(average_down(sample, hn::AverageRound(sample, hn::LoadU(D8(), row))));
    const Centered odd = Center(hn::AverageRound(sample, average_down(sample, hn::LoadU(D8(), row + 2))));
    out[0] = hn::InterleaveLower(DI8(), even, odd);
    out[1] = hn::InterleaveUpper(DI8(), even, odd);
}

// Scaled by 16, so that the result is the high byte of each sum.
static HWY_INLINE void Upsample(const uint8_t* HWY_RESTRICT near_row, const uint8_t* HWY_RESTRICT far_row, Centered (&out)[2])
{
    using VU16 = hn::Vec<DU16>;
    const auto add = [&](size_t at, uint8_t weight, VU16(&sums)[2]) HWY_ATTR {
        sums[0] = hn::WidenMulAccumulate(DU16(), hn::LoadU(D8(), near_row + at), hn::Set(D8(), 3 * weight), sums[0], sums[1]);
        sums[0] = hn::WidenMulAccumulate(DU16(), hn::LoadU(D8(), far_row + at), hn::Set(D8(), weight), sums[0], sums[1]);
    };
    const VU16 bias = hn::Set(DU16(), (7 << 4) + (128 << 8));
    VU16 odd[2] = { bias, bias }, even[2];
    add(1, 3 << 4, odd);
    // Never saturates. The compiler would reassociate a plain addition and copy the sums.
    for (size_t i = 0; i < 2; i++)
        even[i] = hn::BitCast(DU16(), hn::SaturatedAdd(hn::BitCast(D16(), odd[i]), hn::Set(D16(), 1 << 4)));
    add(0, 1 << 4, even);
    add(2, 1 << 4, odd);
    for (size_t i = 0; i < 2; i++)
        out[i] = hn::InterleaveOdd(DI8(), hn::BitCast(DI8(), even[i]), hn::BitCast(DI8(), odd[i]));
}

// Stores the luma of 16 pixels. Adds the Cb of each pair to `chroma[0]`, and its Cr to `chroma[1]`.
static HWY_INLINE void SplitRow(const uint8_t* HWY_RESTRICT rgba, uint8_t* HWY_RESTRICT luma, V16 (&chroma)[4])
{
    V8 r8, g8, b8, a8;
    hn::LoadInterleaved4(D8(), rgba, r8, g8, b8, a8);
    const hn::Half<D8> half;
    struct Eight {
        hn::Vec<hn::Half<D8>> y_less_g, cb, cr;
    };
    // The weights of R, G and B add up to 1 or to 0, so two differences are enough.
    const auto eight = [&](V16 r, V16 g, V16 b) HWY_ATTR {
        const V16 g_less_r = hn::ShiftLeft<7>(hn::Sub(g, r)), g_less_b = hn::ShiftLeft<7>(hn::Sub(g, b));
        const Sums sums = Weigh({ g_less_r, g_less_b }, -kRedInLuma, -kBlueInLuma);
        const auto y = hn::ConcatOdd(DU16(), hn::BitCast(DU16(), sums.part[1]), hn::BitCast(DU16(), sums.part[0]));
        // These weights are adjusted, so that the rounding multiplication gives the truncated product.
        const auto difference = [&](V16 halved, V16 other, int16_t weight) HWY_ATTR {
            const V16 sum = hn::Add(halved, hn::ShiftRight<1>(hn::MulFixedPoint15(other, hn::Set(D16(), weight))));
            return hn::TruncateTo(half, hn::ShiftRight<8>(hn::Sub(hn::Set(DU16(), kChromaBias >> 8), hn::BitCast(DU16(), sum))));
        };
        return Eight { hn::TruncateTo(half, hn::ShiftRight<7>(hn::Add(y, hn::Set(DU16(), kLumaBias >> 9)))),
            difference(g_less_b, g_less_r, -22116), difference(g_less_r, g_less_b, -10658) };
    };
    const Widened r = Widen(r8), g = Widen(g8), b = Widen(b8);
    const Eight lower = eight(r.lower, g.lower, b.lower), upper = eight(r.upper, g.upper, b.upper);
    hn::StoreU(hn::Add(g8, hn::Combine(D8(), upper.y_less_g, lower.y_less_g)), D8(), luma);
    chroma[0] = hn::Add(chroma[0], hn::BitCast(D16(), hn::SumsOf2(hn::Combine(D8(), upper.cb, lower.cb))));
    chroma[1] = hn::Add(chroma[1], hn::BitCast(D16(), hn::SumsOf2(hn::Combine(D8(), upper.cr, lower.cr))));
}

static HWY_INLINE void StoreChroma(const V16 (&chroma)[4], uint8_t* HWY_RESTRICT cb, uint8_t* HWY_RESTRICT cr)
{
    const hn::Half<D8> half;
    hn::StoreU(hn::DemoteTo(half, hn::ShiftRight<2>(hn::Add(chroma[0], Alternating(1, 2)))), half, cb);
    hn::StoreU(hn::DemoteTo(half, hn::ShiftRight<2>(hn::Add(chroma[1], Alternating(1, 2)))), half, cr);
}

// Scalar, because the vector units are the bottleneck.
static HWY_INLINE bool HasOnlyDc(const int16_t* HWY_RESTRICT block)
{
    uint64_t words[16], others = 0;
    hwy::CopyBytes<sizeof(words)>(HWY_ASSUME_ALIGNED(block, 32), words);
    words[0] >>= 16;
    for (uint64_t word : words) {
        hwy::PreventElision(word);
        others |= word;
    }
    return others == 0;
}

// Of each 8 coefficients in zigzag order, 4 are in the first half of these rows and 4 in the second.
static constexpr size_t kRowOrder[8] = { 0, 3, 5, 6, 1, 2, 4, 7 };

// For each half: the positions of its coefficients in zigzag order, then their bits in a byte of the mask.
HWY_ALIGN static constexpr auto kHalves = [] {
    std::array<uint8_t, 128> from_and_bit {};
    size_t found[2] = {};
    for (size_t k = 0; k < 64; k++) {
        size_t nth = 0;
        while (kRowOrder[nth] != kZigzag[k][0])
            nth++;
        const size_t at = nth / 4 * 32 + found[nth / 4]++;
        from_and_bit[at] = static_cast<uint8_t>(nth % 4 * 8 + kZigzag[k][1]);
        from_and_bit[64 + at] = static_cast<uint8_t>(1 << k % 8);
    }
    return from_and_bit;
}();

template<bool kBitPlanes>
static HWY_INLINE void StoreMasks(const V16 (&rows)[8], uint64_t* HWY_RESTRICT masks)
{
    const auto table = [](size_t i) HWY_ATTR { return hn::Load(D8(), kHalves.data() + 16 * i); };
    const auto pack = [&](size_t i) HWY_ATTR { return hn::BitCast(D8(), Pack(DI8(), rows[kRowOrder[i]], rows[kRowOrder[i + 1]])); };
    V8 gathered[4];
    for (size_t i = 0; i < 4; i++)
        gathered[i] = hn::TwoTablesLookupLanes(pack(i / 2 * 4), pack(i / 2 * 4 + 2), hn::IndicesFromVec(D8(), table(i)));

    const auto add_pairs = [](V8 a, V8 b) HWY_ATTR { return hn::Add(hn::ConcatEven(D8(), b, a), hn::ConcatOdd(D8(), b, a)); };
    constexpr uint8_t kBits[4] = { kBitPlanes ? 1 : 0xFF, 2, 4, 0x80 };
    for (size_t plane = 0; plane < (kBitPlanes ? 4 : 1); plane++) {
        const auto has = [&](size_t i) HWY_ATTR {
            return hn::VecFromMask(D8(), hn::Ne(hn::And(gathered[i], hn::Set(D8(), kBits[plane])), hn::Zero(D8())));
        };
        const auto sixteen = [&](size_t i) HWY_ATTR {
            return hn::And(hn::BitwiseIfThenElse(table(4 + i), has(i), has(2 + i)), hn::Or(table(4 + i), table(6 + i)));
        };
        const V8 pairs = add_pairs(sixteen(0), sixteen(1));
        hn::StoreU(hn::LowerHalf(add_pairs(pairs, pairs)), hn::Half<D8>(), reinterpret_cast<uint8_t*>(masks + plane));
    }
}

#endif

// Adds what rows 2 and 6 contribute to row `y`. Where that negates an earlier row's, the products are shared.
template<size_t N>
static HWY_INLINE Sums AddRows26(const Sums& sums, const RowPair& rows, const Weights<N>& weights, size_t y)
{
    const size_t other = (N + 1) / 2 - 1 - y;
    if (other < y && WeightOf<N>(other, 2) == -WeightOf<N>(y, 2) && WeightOf<N>(other, 6) == -WeightOf<N>(y, 6))
        return sums - Weigh(rows, weights.Of(other, 2), weights.Of(other, 6));
    return Weigh(rows, weights.Of(y, 2), weights.Of(y, 6)) + sums;
}

// 4 samples from `kFirst` on, then those that mirror them.
template<size_t kFirst, size_t N>
static HWY_INLINE V16 InverseRows(const Weights<N>& weights, V16 rows)
{
    V32 even = hn::Add(weights.template Spread<kFirst, 0>(rows), weights.template Spread<kFirst, 2>(rows));
    if constexpr (N == 2)
        even = hn::Add(even, even);
    const V32 odd = hn::Add(weights.template Spread<kFirst, 4>(rows), weights.template Spread<kFirst, 6>(rows));
    return ShiftAndPack<18 + kExtraBits<N>>(hn::Add(even, odd), hn::Sub(even, odd));
}

// Orders two results of `InverseRows`: two rows, or the outer and the inner samples of one.
template<size_t N>
static HWY_INLINE V8 LeftToRight(V16 first, V16 second)
{
    static constexpr auto kFrom = [] {
        constexpr size_t kRoom = N <= 8 ? 8 : 16;
        std::array<uint8_t, 16> from {};
        for (size_t i = 0; i < 16; i++) {
            const size_t x = i % kRoom, mirror = N - 1 - x, nearer = x <= mirror ? x : mirror;
            from[i] = x >= N ? kZero : static_cast<uint8_t>(i - x + nearer / 4 * 8 + nearer % 4 + (x <= mirror ? 0 : 4));
        }
        return from;
    }();
    return Shuffle(Pack(D8(), first, second), kFrom);
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

    const Weights<N> weights;
    const RowPair steps[4] = { LoadPair(quant), LoadPair(quant + 16), LoadPair(quant + 32), LoadPair(quant + 48) };
    // Through the weight of column 0 in the second pass, 16 rounds the result and 4096 adds 128.
    const Sums bias = Bias(((4096 + 16) << kShift) + (1 << (kShift - 1)), 1 << (kShift - 1));

    for (; count != 0; count--, blocks += 64, out += N) {
        // For small sizes the check costs as much as the transform.
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

        const auto narrow = [](V32 a, V32 b) HWY_ATTR {
            return hn::OrderedDemote2To(D16(), hn::ShiftRight<kShift>(a), hn::ShiftRight<kShift>(b));
        };
        // Row `y`, then row `N - 1 - y`, for each `y`.
        V16 rows[kVectors];
        HWY_DEFAULT_UNROLL
        for (size_t y = 0; y < kHalf; y++) {
            const int16_t* basis = Basis<N>::kWeights[y];
            Sums even = AddRows26(bias + Weigh(in[0], basis[0], basis[4]), in[1], weights, y);
            if constexpr (N == 2)
                even = even + Weigh(in[0], basis[0], basis[4]);
            const Sums odd = Weigh(in[3], weights.Of(y, 5), weights.Of(y, 7), Weigh(in[2], weights.Of(y, 1), weights.Of(y, 3)));
            const Sums upper = even + odd, lower = even - odd;
            if constexpr (kParts == 1) {
                rows[y] = narrow(upper.part[0], lower.part[0]);
            } else {
                rows[2 * y] = narrow(upper.part[0], upper.part[kParts - 1]);
                rows[2 * y + 1] = narrow(lower.part[0], lower.part[kParts - 1]);
            }
        }
        const auto row = [&](size_t vector, size_t half) {
            const size_t nth = vector * (2 / kParts) + half;
            return out + (nth % 2 == 0 ? nth / 2 : N - 1 - nth / 2) * stride;
        };

        if constexpr (N <= 8) {
            HWY_DEFAULT_UNROLL
            for (size_t i = 0; i < kVectors; i += 2) {
                const size_t next = HWY_MIN(i + 1, kVectors - 1);
                const V8 bytes = LeftToRight<N>(InverseRows<0>(weights, rows[i]), InverseRows<0>(weights, rows[next]));
                const auto store = [&](hn::Vec<decltype(d128)> two_rows, size_t half) HWY_ATTR {
                    hn::StoreU(hn::LowerHalf(d64, two_rows), d64, row(i, half));
                    uint8_t* second = row(next, half);
                    // arm64 can store a lane, but not with an offset.
                    if constexpr (!HWY_ARCH_X86)
                        hwy::PreventElision(second);
                    hn::StoreU(hn::UpperHalf(d64, two_rows), d64, second);
                };
                store(hn::ExtractBlock<0>(bytes), 0);
                if constexpr (kParts == 1)
                    store(hn::ExtractBlock<kLastBlock>(bytes), 1);
            }
        } else {
            HWY_DEFAULT_UNROLL
            for (size_t i = 0; i < kVectors; i++) {
                const V8 bytes = LeftToRight<N>(InverseRows<0>(weights, rows[i]), InverseRows<4>(weights, rows[i]));
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
    }
}

// These 16-bit weights give the results of jdcolor.c for all samples.
static HWY_INLINE void StoreRgba(V8 luma, const Centered& blue, const Centered& red, uint8_t* HWY_RESTRICT out)
{
    const Widened y = Widen(luma), cb = Widen(blue), cr = Widen(red);
    hn::StoreInterleaved4(Pack(D8(), RedOrBlue(y.lower, cr.lower, 22971), RedOrBlue(y.upper, cr.upper, 22971)),
        Pack(D8(), hn::Add(y.lower, GreenOffset(cb.lower, cr.lower)), hn::Add(y.upper, GreenOffset(cb.upper, cr.upper))),
        Pack(D8(), RedOrBlue(y.lower, cb.lower, 29033), RedOrBlue(y.upper, cb.upper, 29033)), hn::Set(D8(), 255), D8(), out);
}

static void JpegYccToRgba(const uint8_t* HWY_RESTRICT y, const uint8_t* HWY_RESTRICT cb, const uint8_t* HWY_RESTRICT cr,
    size_t width, uint8_t* HWY_RESTRICT out)
{
    for (size_t x = 0; x < width; x += kBytes)
        StoreRgba(hn::LoadU(D8(), y + x), Center(hn::LoadU(D8(), cb + x)), Center(hn::LoadU(D8(), cr + x)), out + 4 * x);
}

static void JpegYcc422ToRgba(const uint8_t* HWY_RESTRICT y, const uint8_t* HWY_RESTRICT cb, const uint8_t* HWY_RESTRICT cr,
    size_t width, uint8_t* HWY_RESTRICT out)
{
    for (size_t x = 0; x < width; x += kPixelGroup) {
        Centered blue[kParts], red[kParts];
        Upsample(cb + x / 2, blue);
        Upsample(cr + x / 2, red);
        for (size_t i = 0; i < kParts; i++)
            StoreRgba(hn::LoadU(D8(), y + x + i * kBytes), blue[i], red[i], out + 4 * (x + i * kBytes));
    }
}

static void JpegYcc420ToRgba(const uint8_t* HWY_RESTRICT y, const uint8_t* HWY_RESTRICT cb_near, const uint8_t* HWY_RESTRICT cb_far,
    const uint8_t* HWY_RESTRICT cr_near, const uint8_t* HWY_RESTRICT cr_far, size_t width, uint8_t* HWY_RESTRICT out)
{
    for (size_t x = 0; x < width; x += kPixelGroup) {
        Centered blue[kParts], red[kParts];
        Upsample(cb_near + x / 2, cb_far + x / 2, blue);
        Upsample(cr_near + x / 2, cr_far + x / 2, red);
        for (size_t i = 0; i < kParts; i++)
            StoreRgba(hn::LoadU(D8(), y + x + i * kBytes), blue[i], red[i], out + 4 * (x + i * kBytes));
    }
}

static void JpegRgbaToYcc420(const uint8_t* HWY_RESTRICT rgba, size_t rgba_stride, size_t width, size_t row_pairs,
    uint8_t* HWY_RESTRICT y, uint8_t* HWY_RESTRICT cb, uint8_t* HWY_RESTRICT cr, size_t chroma_stride)
{
    for (size_t pair = 0; pair < row_pairs; pair++) {
        const uint8_t* pixels = rgba + 2 * pair * rgba_stride;
        const size_t at = pair * chroma_stride;
        for (size_t x = 0; x < width; x += kBytes) {
            V16 chroma[4] = { hn::Zero(D16()), hn::Zero(D16()), hn::Zero(D16()), hn::Zero(D16()) };
            SplitRow(pixels + 4 * x, y + 4 * at + x, chroma);
            SplitRow(pixels + rgba_stride + 4 * x, y + 4 * at + 2 * chroma_stride + x, chroma);
            StoreChroma(chroma, cb + at + x / 2, cr + at + x / 2);
        }
    }
}

template<bool kBitPlanes>
static HWY_INLINE void ForwardTransform(const uint8_t* HWY_RESTRICT samples, size_t stride, size_t count,
    const int16_t* HWY_RESTRICT divisors, int16_t* HWY_RESTRICT blocks, uint64_t* HWY_RESTRICT masks)
{
    // Subtracting 128 from each sample only changes coefficient 0.
    const Sums centering = Bias(-((64 * 128) << 15), 0);
    const Weights<8, true> weights;

    for (; count != 0; count--, samples += 8, blocks += 64, masks += kBitPlanes ? 4 : 1) {
        const auto rows = [&](size_t first, size_t second) HWY_ATTR {
            return RoundAndPairUp<11>(TransformRow(weights, samples + first * stride), TransformRow(weights, samples + second * stride));
        };
        const RowPair rows01 = rows(0, 1), rows76 = rows(7, 6), rows32 = rows(3, 2), rows45 = rows(4, 5);
        const RowPair sums01 = rows01 + rows76, sums32 = rows32 + rows45;
        const RowPair differences01 = rows01 - rows76, differences32 = rows32 - rows45;
        const RowPair for04 = sums01 + sums32, for26 = sums01 - sums32;
        const auto even = [&](const RowPair& from, size_t row) HWY_ATTR { return Weigh(from, weights.Of(0, row), weights.Of(1, row)); };
        const auto odd = [&](size_t row) HWY_ATTR {
            return Weigh(differences32, weights.Of(3, row), weights.Of(2, row), Weigh(differences01, weights.Of(0, row), weights.Of(1, row)));
        };
        const RowPair coefficients[4] = { RoundAndPairUp<15>(Weigh(for04, 8192, 8192) + centering, Weigh(for04, 8192, -8192)),
            RoundAndPairUp<15>(even(for26, 2), even(for26, 6)), RoundAndPairUp<15>(odd(1), odd(3)), RoundAndPairUp<15>(odd(5), odd(7)) };

        V16 to_pack[4 * kParts];
        HWY_DEFAULT_UNROLL
        for (size_t i = 0; i < 4; i++) {
            const RowPair reciprocal = LoadPair(divisors + 16 * i), scale = LoadPair(divisors + 64 + 16 * i);
            RowPair quantized {};
            for (size_t part = 0; part < kParts; part++) {
                const V16 value = coefficients[i].part[part], sign = hn::BroadcastSignBit(value);
                // One less if negative, so that halves round away from 0.
                const V16 doubled = hn::Add(hn::Add(value, value), sign);
                quantized.part[part] = hn::MulFixedPoint15(hn::MulFixedPoint15(doubled, reciprocal.part[part]), scale.part[part]);
                if constexpr (kBitPlanes) {
                    // The low two bits, 4 if any higher bit is set, and the sign in bit 7.
                    const V16 magnitude = hn::Abs(quantized.part[part]);
                    const V16 bits = hn::Min(magnitude, hn::OrAnd(hn::Set(D16(), 4), magnitude, hn::Set(D16(), 3)));
                    to_pack[i * kParts + part] = hn::OrAnd(bits, sign, hn::Set(D16(), -128));
                } else {
                    to_pack[i * kParts + part] = quantized.part[part];
                }
            }
            StorePair(quantized, blocks + 16 * i);
        }
        StoreMasks<kBitPlanes>(to_pack, masks);
    }
}

static void JpegForwardTransform(const uint8_t* HWY_RESTRICT samples, size_t stride, size_t count,
    const int16_t* HWY_RESTRICT divisors, int16_t* HWY_RESTRICT blocks, uint64_t* HWY_RESTRICT masks, bool bit_planes)
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

// Blocks are aligned to 32 bytes. Writes to `size` rows: `size` bytes for each block but the last, at most 16 for that one.
extern "C" void highway_jpeg_inverse_transform(const int16_t* blocks, size_t count, const int16_t* quant, size_t size,
    uint8_t* out, size_t stride)
{
    BUN_HWY_DISPATCH(JpegInverseTransform)(blocks, count, quant, size, out, stride);
}

// These four process `width` pixels, a multiple of 32. Rows to upsample start one sample early, and have 8 bytes more.
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

// The rows of `y` are `2 * chroma_stride` bytes apart.
extern "C" void highway_jpeg_rgba_to_ycc420(const uint8_t* rgba, size_t rgba_stride, size_t width, size_t row_pairs,
    uint8_t* y, uint8_t* cb, uint8_t* cr, size_t chroma_stride)
{
    BUN_HWY_DISPATCH(JpegRgbaToYcc420)(rgba, rgba_stride, width, row_pairs, y, cb, cr, chroma_stride);
}

// Reads `8 * count` bytes of 8 rows and two blocks of `divisors`. Writes a mask for each block, or four with `bit_planes`.
extern "C" void highway_jpeg_forward_transform(const uint8_t* samples, size_t stride, size_t count, const int16_t* divisors,
    int16_t* blocks, uint64_t* masks, bool bit_planes)
{
    BUN_HWY_DISPATCH(JpegForwardTransform)(samples, stride, count, divisors, blocks, masks, bit_planes);
}
} // namespace bun
#endif
