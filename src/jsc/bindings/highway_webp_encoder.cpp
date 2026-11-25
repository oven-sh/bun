// The arithmetic of the VP8 encoder in src/webp/lossy/encoder, runtime-dispatched via Google Highway.
// src/highway/webp.rs says what each kernel takes.
//
// A block of 4x4 is four vectors, one per column or per row. 128 bits have room for two blocks, whose lanes alternate:
// a pair. Mostly these are two ways of predicting the same block. 256 bits are two pairs side by side.

// There are 4 or 6 modes to try at a time, which do not fill 512 bits, and vectors are kept in structs. So this is the
// list in scripts/build/deps/highway.ts and more: the rest of SVE, whatever is newer than AVX2, and what is no faster
// here than SSSE3 or the NEON without AES.
#undef HWY_DISABLED_TARGETS
#define HWY_DISABLED_TARGETS (HWY_ALL_SVE | HWY_NEON | HWY_NEON_BF16 | HWY_SSE4 | (HWY_AVX2 - 1))
#ifndef __OPTIMIZE__
#error "Unless hwy::ChosenTarget::GetIndex() is inlined, the linker may keep that of a file with other targets."
#endif

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_webp_encoder.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>
#include "highway_dispatch.h"

#include <stddef.h>
#include <stdint.h>

#ifndef BUN_WEBP_ENCODER_TYPES
#define BUN_WEBP_ENCODER_TYPES
namespace bun {
// These mirror the types of the same names in bun_highway::webp.
namespace webp {

struct Macroblock {
    uint8_t luma[16][16];
    uint8_t chroma[8][16];
};

struct LinearColors {
    int16_t sums[3][4][2][8];
};

struct GammaTable {
    uint8_t values[32];
    uint8_t slopes[32];
};

struct Edges {
    uint8_t above[16];
    uint8_t left[16];
    uint8_t above_left[2];
    uint8_t dc[2];
};

struct Quantizer {
    int16_t steps[2][8];
    int16_t reciprocals[2][8];
    int16_t doubled_reciprocals[2][8];
    int16_t limits[2][8];
    int16_t sharpening[4][8];
};

template<size_t kPairs>
struct Candidates {
    int16_t levels[4][kPairs][8];
    uint8_t symbols[2][kPairs][16];
    uint8_t edges[kPairs][16];
};

struct LumaSource {
    int16_t columns[4][16][8];
    int16_t spectra[4][16][4];
    int32_t textures[16];
};

struct LumaCandidates {
    Candidates<2> blocks[16];
    Candidates<2> y2;
    uint8_t ends[2][2][16];
    uint8_t y2_ends[2][16];
    int32_t squared_errors[4];
    int32_t texture_differences[4];
};

struct SubblockCandidates {
    Candidates<6> block;
    int32_t distortions[16];
    uint8_t ends[32];
};

struct ChromaCandidates {
    Candidates<2> blocks[8];
    uint8_t ends[2][16];
    uint8_t ac_counts[2][16];
    int32_t squared_errors[4];
    int16_t dc_errors[2][2][8];
};

struct Histograms {
    uint32_t highest_count[2];
    uint32_t last_bin[2];
};

static_assert(sizeof(Macroblock) == 384 && sizeof(LinearColors) == 384 && sizeof(GammaTable) == 64 && sizeof(Edges) == 36);
static_assert(sizeof(Quantizer) == 192 && sizeof(LumaSource) == 1600 && sizeof(Histograms) == 16);
static_assert(sizeof(LumaCandidates) == 3936 && sizeof(SubblockCandidates) == 768 && sizeof(ChromaCandidates) == 1936);

} // namespace webp
} // namespace bun
#endif

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

using D16 = hn::CappedTag<int16_t, 16>;
using DU16 = hn::RebindToUnsigned<D16>;
using D8 = hn::Repartition<uint8_t, D16>;
using D32 = hn::Repartition<int32_t, D16>;
using D64 = hn::Repartition<uint64_t, D16>;
using V16 = hn::Vec<D16>;
using V8 = hn::Vec<D8>;
using V32 = hn::Vec<D32>;

// How many pairs there are in a vector.
static constexpr size_t kPairs = hn::MaxLanes(D16()) / 8;
// An index that TableLookupBytesOr0() turns into zero.
static constexpr uint8_t kNone = 0x80;

struct Quad {
    V16 v0, v1, v2, v3;

    // An implicit constructor is not compiled for the target.
    HWY_INLINE HWY_ATTR Quad() {}
    HWY_INLINE HWY_ATTR Quad(V16 v0, V16 v1, V16 v2, V16 v3)
        : v0(v0)
        , v1(v1)
        , v2(v2)
        , v3(v3)
    {
    }
};

// So many times 16 bytes, byte `i` of row `row` being `f(row, i)`.
template<size_t kRows>
struct Table {
    alignas(32) uint8_t rows[kRows][16];

    template<class F>
    constexpr Table(F f)
        : rows {}
    {
        for (size_t row = 0; row < kRows; row++) {
            for (size_t i = 0; i < 16; i++)
                rows[row][i] = f(row, i);
        }
    }

    // The same row for all pairs.
    HWY_INLINE HWY_ATTR V8 Dup(size_t row) const { return hn::LoadDup128(D8(), rows[row]); }
    // A row for each pair.
    HWY_INLINE HWY_ATTR V8 From(size_t row) const { return hn::LoadU(D8(), rows[row]); }
};

template<class D, class V = hn::Vec<D16>>
static HWY_INLINE V LowerAs(D d, V a, V b)
{
    return hn::BitCast(hn::DFromV<V>(), hn::InterleaveLower(d, hn::BitCast(d, a), hn::BitCast(d, b)));
}

template<class D, class V = hn::Vec<D16>>
static HWY_INLINE V UpperAs(D d, V a, V b)
{
    return hn::BitCast(hn::DFromV<V>(), hn::InterleaveUpper(d, hn::BitCast(d, a), hn::BitCast(d, b)));
}

static HWY_INLINE V16 Lookup16(V8 bytes, V8 indices)
{
    return hn::BitCast(D16(), hn::TableLookupBytesOr0(bytes, indices));
}

// A table of indices into two vectors, those into the second being 16 higher.
template<size_t kRows>
struct TwoTables {
#if HWY_TARGET_IS_NEON
    Table<kRows> both;

    template<class F>
    constexpr TwoTables(F f)
        : both(f)
    {
    }

    HWY_INLINE HWY_ATTR V8 Dup(V8 a, V8 b, size_t row) const { return hn::TwoTablesLookupLanes(D8(), a, b, hn::IndicesFromVec(D8(), both.Dup(row))); }
    HWY_INLINE HWY_ATTR V8 From(V8 a, V8 b, size_t row) const { return Dup(a, b, row); }
#else
    Table<kRows> first, second;

    template<class F>
    constexpr TwoTables(F f)
        : first([&](size_t row, size_t i) -> uint8_t { return f(row, i) < 16 ? f(row, i) : kNone; })
        , second([&](size_t row, size_t i) -> uint8_t { return f(row, i) < 16 ? kNone : f(row, i) - 16; })
    {
    }

    HWY_INLINE HWY_ATTR V8 Dup(V8 a, V8 b, size_t row) const { return hn::Or(hn::TableLookupBytesOr0(a, first.Dup(row)), hn::TableLookupBytesOr0(b, second.Dup(row))); }
    HWY_INLINE HWY_ATTR V8 From(V8 a, V8 b, size_t row) const { return hn::Or(hn::TableLookupBytesOr0(a, first.From(row)), hn::TableLookupBytesOr0(b, second.From(row))); }
#endif
};

// (v + (1 << kBits >> 1)) >> kBits
template<int kBits>
static HWY_INLINE V16 Rounded(V16 v)
{
#if HWY_TARGET_IS_NEON
    return hn::RoundingShiftRight<kBits>(v);
#else
    return hn::MulFixedPoint15(v, hn::Set(D16(), 1 << (15 - kBits)));
#endif
}

static HWY_INLINE Quad Transposed(const Quad& q)
{
    const V16 a = LowerAs(D32(), q.v0, q.v2);
    const V16 b = LowerAs(D32(), q.v1, q.v3);
    const V16 c = UpperAs(D32(), q.v0, q.v2);
    const V16 d = UpperAs(D32(), q.v1, q.v3);
    return { LowerAs(D32(), a, b), UpperAs(D32(), a, b), LowerAs(D32(), c, d), UpperAs(D32(), c, d) };
}

static HWY_INLINE Quad Difference(const Quad& a, const Quad& b)
{
    return { hn::Sub(a.v0, b.v0), hn::Sub(a.v1, b.v1), hn::Sub(a.v2, b.v2), hn::Sub(a.v3, b.v3) };
}

// The columns of a block, in both places of each pair.
static HWY_INLINE Quad Columns(V8 block)
{
    static constexpr Table<4> kColumns([](size_t x, size_t i) -> uint8_t { return i % 2 ? kNone : 4 * x + i / 4; });
    return { Lookup16(block, kColumns.Dup(0)), Lookup16(block, kColumns.Dup(1)), Lookup16(block, kColumns.Dup(2)), Lookup16(block, kColumns.Dup(3)) };
}

// From two columns of a pair in each vector.
static HWY_INLINE Quad Columns(V8 left, V8 right)
{
    const D16 d;
    const D8 d8;
    const V8 zero = hn::Zero(d8);
    return {
        hn::BitCast(d, hn::InterleaveLower(d8, left, zero)),
        hn::BitCast(d, hn::InterleaveUpper(d8, left, zero)),
        hn::BitCast(d, hn::InterleaveLower(d8, right, zero)),
        hn::BitCast(d, hn::InterleaveUpper(d8, right, zero)),
    };
}

static HWY_INLINE Quad Columns(const webp::LumaSource& source, size_t block)
{
    const auto column = [&](size_t x) HWY_ATTR { return hn::LoadDup128(D16(), source.columns[x][block]); };
    return { column(0), column(1), column(2), column(3) };
}

// ─── Transforms ─────────────────────────────────────────────────────────────

// (a * kA + b * kB + kRounding) >> kShift
template<int kA, int kB, int kRounding, int kShift>
static HWY_INLINE V16 Rotated(V16 a, V16 b)
{
    const D16 d;
    const D32 d32;
    const V32 rounding = hn::Set(d32, kRounding);
#if HWY_TARGET_IS_NEON
    // Adding and taking the upper halves is one instruction.
    constexpr int kUp = kShift == 16 ? 0 : 15 - kShift, kFactor = kShift == 16 ? 1 : 2;
    V32 upper = hn::Zero(d32);
    V32 lower = hn::WidenMulAccumulate(d32, hn::ShiftLeft<kUp>(a), hn::Set(d, kA * kFactor), hn::Zero(d32), upper);
    lower = hn::WidenMulAccumulate(d32, hn::ShiftLeft<kUp>(b), hn::Set(d, kB * kFactor), lower, upper);
    const auto narrowed = [&](V32 v) HWY_ATTR {
        const auto sum = hn::Add(v, hn::ShiftLeft<16 - kShift>(rounding));
        return hn::TruncateTo(hn::Half<DU16>(), hn::ShiftRight<16>(hn::BitCast(hn::RebindToUnsigned<D32>(), sum)));
    };
    return hn::BitCast(d, hn::Combine(DU16(), narrowed(upper), narrowed(lower)));
#else
    const V16 factors = hn::OddEven(hn::Set(d, kB), hn::Set(d, kA));
    const V32 lower = hn::Add(hn::WidenMulPairwiseAdd(d32, hn::InterleaveLower(d, a, b), factors), rounding);
    const V32 upper = hn::Add(hn::WidenMulPairwiseAdd(d32, hn::InterleaveUpper(d, a, b), factors), rounding);
    return hn::ReorderDemote2To(d, hn::ShiftRight<kShift>(lower), hn::ShiftRight<kShift>(upper));
#endif
}

// From columns to rows.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/dsp/enc.c#L165
static HWY_INLINE Quad ForwardDct(const Quad& residual)
{
    const D16 d;
    V16 a0 = hn::Add(residual.v0, residual.v3);
    V16 a1 = hn::Add(residual.v1, residual.v2);
    V16 a2 = hn::Sub(residual.v1, residual.v2);
    V16 a3 = hn::Sub(residual.v0, residual.v3);
    const Quad rows = Transposed({
        hn::ShiftLeft<3>(hn::Add(a0, a1)),
        Rotated<2217, 5352, 1812, 9>(a2, a3),
        hn::ShiftLeft<3>(hn::Sub(a0, a1)),
        Rotated<-5352, 2217, 937, 9>(a2, a3),
    });
    a0 = hn::Add(hn::Add(rows.v0, rows.v3), hn::Set(d, 7));
    a1 = hn::Add(rows.v1, rows.v2);
    a2 = hn::Sub(rows.v1, rows.v2);
    a3 = hn::Sub(rows.v0, rows.v3);
    // One more, except where a3 is zero.
    const V16 minus_one = hn::VecFromMask(d, hn::Eq(a3, hn::Zero(d)));
    return {
        hn::ShiftRight<4>(hn::Add(a0, a1)),
        hn::Add(Rotated<2217, 5352, 12000 + (1 << 16), 16>(a2, a3), minus_one),
        hn::ShiftRight<4>(hn::Sub(a0, a1)),
        Rotated<-5352, 2217, 51000, 16>(a2, a3),
    };
}

// RFC 6386 section 14.4. The factors are 85627 and 35468 out of 65536. What is multiplied by is 65536 less.
static HWY_INLINE Quad InverseDctPass(const Quad& q)
{
    const V16 cos = hn::Set(D16(), 20091);
    const V16 sin = hn::Set(D16(), -30068);
    const V16 a = hn::Add(q.v0, q.v2);
    const V16 b = hn::Sub(q.v0, q.v2);
    const V16 c = hn::Add(hn::Sub(q.v1, q.v3), hn::Sub(hn::MulHigh(q.v1, sin), hn::MulHigh(q.v3, cos)));
    const V16 d = hn::Add(hn::Add(q.v1, q.v3), hn::Add(hn::MulHigh(q.v1, cos), hn::MulHigh(q.v3, sin)));
    return { hn::Add(a, d), hn::Add(b, c), hn::Sub(b, c), hn::Sub(a, d) };
}

static HWY_INLINE Quad HadamardPass(const Quad& q)
{
    const V16 a0 = hn::Add(q.v0, q.v2);
    const V16 a1 = hn::Add(q.v1, q.v3);
    const V16 a2 = hn::Sub(q.v1, q.v3);
    const V16 a3 = hn::Sub(q.v0, q.v2);
    return { hn::Add(a0, a1), hn::Add(a3, a2), hn::Sub(a3, a2), hn::Sub(a0, a1) };
}

// RFC 6386 section 14.3.
static HWY_INLINE Quad InverseWhtPass(const Quad& q)
{
    const V16 a0 = hn::Add(q.v0, q.v3);
    const V16 a1 = hn::Add(q.v1, q.v2);
    const V16 a2 = hn::Sub(q.v1, q.v2);
    const V16 a3 = hn::Sub(q.v0, q.v3);
    return { hn::Add(a0, a1), hn::Add(a3, a2), hn::Sub(a0, a1), hn::Sub(a3, a2) };
}

// The Hadamard transform, from columns to rows in which the lanes of a pair do not alternate: columns 0, 2, 1 and 3 of
// the first block, then those of the second.
static HWY_INLINE Quad Spectrum(const Quad& columns)
{
    const D16 d;
    const Quad h = HadamardPass(columns);
    const V16 upper01 = hn::InterleaveLower(d, h.v0, h.v1);
    const V16 lower01 = hn::InterleaveUpper(d, h.v0, h.v1);
    const V16 upper23 = hn::InterleaveLower(d, h.v2, h.v3);
    const V16 lower23 = hn::InterleaveUpper(d, h.v2, h.v3);
    const V16 sums01 = hn::Add(upper01, lower01);
    const V16 sums23 = hn::Add(upper23, lower23);
    const V16 differences01 = hn::Sub(upper01, lower01);
    const V16 differences23 = hn::Sub(upper23, lower23);
    const V16 a0 = hn::InterleaveLower(d, sums01, sums23);
    const V16 a1 = hn::InterleaveUpper(d, sums01, sums23);
    const V16 a3 = hn::InterleaveLower(d, differences01, differences23);
    const V16 a2 = hn::InterleaveUpper(d, differences01, differences23);
    return { hn::Add(a0, a1), hn::Add(a3, a2), hn::Sub(a3, a2), hn::Sub(a0, a1) };
}

// Adds up the products over the four vectors and over each two lanes.
static HWY_INLINE V32 SumsOfProducts(const Quad& a, const Quad& b)
{
    const D32 d32;
    V32 sum1 = hn::Zero(d32);
    V32 sum0 = hn::ReorderWidenMulAccumulate(d32, a.v0, b.v0, hn::Zero(d32), sum1);
    sum0 = hn::ReorderWidenMulAccumulate(d32, a.v1, b.v1, sum0, sum1);
    sum0 = hn::ReorderWidenMulAccumulate(d32, a.v2, b.v2, sum0, sum1);
    sum0 = hn::ReorderWidenMulAccumulate(d32, a.v3, b.v3, sum0, sum1);
    return hn::RearrangeToOddPlusEven(sum0, sum1);
}

// In two lanes for each block.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/quant_enc.c#L517
static HWY_INLINE V32 Textures(const Quad& spectrum)
{
    const D16 d;
    const auto weights = [&](int16_t w0, int16_t w1, int16_t w2, int16_t w3) HWY_ATTR {
        return hn::Dup128VecFromValues(d, w0, w2, w1, w3, w0, w2, w1, w3);
    };
    return SumsOfProducts({ hn::Abs(spectrum.v0), hn::Abs(spectrum.v1), hn::Abs(spectrum.v2), hn::Abs(spectrum.v3) },
        { weights(38, 32, 20, 9), weights(32, 28, 17, 7), weights(20, 17, 10, 4), weights(9, 7, 4, 2) });
}

// In each 128 bits, the sums of the two pairs of lanes of `a`, then those of `b`.
static HWY_INLINE V32 PairwiseSums(V32 a, V32 b)
{
#if HWY_TARGET_IS_NEON
    return hn::RearrangeToOddPlusEven(a, b);
#else
    return hn::PairwiseAdd128(D32(), a, b);
#endif
}

// All that PairwiseSums() made of `a`, then what it made of `b`.
static HWY_INLINE V32 InOrder(V32 sums)
{
#if HWY_MAX_BYTES > 16
    return hn::BitCast(D32(), hn::Per4LaneBlockShuffle<3, 1, 2, 0>(hn::BitCast(D64(), sums)));
#else
    return sums;
#endif
}

// 16 times the squared error, the transform being orthogonal, and the texture of each of the blocks of a pair.
struct Distortions {
    V32 errors, textures;
};

static HWY_INLINE Distortions Measure(const Quad& decoded, const webp::LumaSource& source, size_t block)
{
    const auto row = [&](size_t y) HWY_ATTR {
        uint64_t lanes;
        hwy::CopyBytes<8>(source.spectra[y][block], &lanes);
        return hn::BitCast(D16(), hn::Set(D64(), lanes));
    };
    const Quad spectrum = Spectrum(decoded);
    const Quad error = Difference(spectrum, { row(0), row(1), row(2), row(3) });
    return { SumsOfProducts(error, error), Textures(spectrum) };
}

// ─── Quantization ───────────────────────────────────────────────────────────

// (magnitude * reciprocal + bias) >> 17. The product is taken apart into the nearest multiple of 1 << 15 and the rest.
static HWY_INLINE V16 Level(V16 magnitude, V16 reciprocal, V16 doubled_reciprocal, V16 limit)
{
    const V16 borrow = hn::VecFromMask(D16(), hn::Lt(hn::Mul(magnitude, doubled_reciprocal), limit));
    return Rounded<2>(hn::Add(hn::MulFixedPoint15(magnitude, reciprocal), borrow));
}

static constexpr uint8_t kZigzag[16] = { 0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15 };
static constexpr uint8_t kMaxSymbol = 67;

static HWY_INLINE V8 ContextSymbols(V8 contexts)
{
    return hn::BitCast(D8(), hn::Mul(hn::BitCast(D16(), contexts), hn::Set(D16(), kMaxSymbol + 1)));
}

struct Quantized {
    // What a decoder makes of the levels.
    Quad coefficients;
    // For each block of a pair 8 bytes, of which the highest counts, or in the case of `ac_counts` the sum.
    V8 ends, magnitudes, ac_counts;
};

// Writes the levels of the pairs from `pair` on.
template<bool kSharpens, size_t kAllPairs>
static HWY_INLINE Quantized Quantize(const Quad& coefficients, const webp::Quantizer& quantizer, webp::Candidates<kAllPairs>& out, size_t pair, uint8_t context = 0)
{
    const D16 d;
    const D8 d8;
    const auto magnitude = [&](V16 coefficient, size_t y) HWY_ATTR {
        V16 it = hn::Abs(coefficient);
        if constexpr (kSharpens) it = hn::Add(it, hn::LoadDup128(d, quantizer.sharpening[y]));
        return Level(it, hn::LoadDup128(d, quantizer.reciprocals[y != 0]), hn::LoadDup128(d, quantizer.doubled_reciprocals[y != 0]), hn::LoadDup128(d, quantizer.limits[y != 0]));
    };
    const Quad magnitudes = { magnitude(coefficients.v0, 0), magnitude(coefficients.v1, 1), magnitude(coefficients.v2, 2), magnitude(coefficients.v3, 3) };

    static constexpr TwoTables<2> kOrder([](size_t half, size_t i) -> uint8_t { return 2 * kZigzag[8 * half + i / 2] + i % 2; });
    static constexpr Table<2> kEnds([](size_t half, size_t i) -> uint8_t { return 4 * (8 * half + i / 2 + 1); });
    static constexpr Table<1> kIsAc([](size_t, size_t i) -> uint8_t { return i >= 2; });
    const V8 upper = hn::Min(hn::ReorderDemote2To(d8, magnitudes.v0, magnitudes.v1), hn::Set(d8, kMaxSymbol));
    const V8 lower = hn::Min(hn::ReorderDemote2To(d8, magnitudes.v2, magnitudes.v3), hn::Set(d8, kMaxSymbol));
    const V8 first = kOrder.Dup(upper, lower, 0);
    const V8 second = kOrder.Dup(upper, lower, 1);
    const V8 first_contexts = hn::Min(first, hn::Set(d8, 2));
    const V8 second_contexts = hn::Min(second, hn::Set(d8, 2));
    const V8 after_first = ContextSymbols(first_contexts);
    const V8 after_second = ContextSymbols(second_contexts);
    hn::StoreU(hn::Add(first, hn::CombineShiftRightBytes<14>(d8, after_first, ContextSymbols(hn::Set(d8, context)))), d8, out.symbols[0][pair]);
    hn::StoreU(hn::Add(second, hn::CombineShiftRightBytes<14>(d8, after_second, after_first)), d8, out.symbols[1][pair]);
    // The minimum is zero for a zero, and otherwise the sum.
    const V8 ends = hn::Max(hn::Min(hn::Add(first_contexts, kEnds.Dup(0)), after_first), hn::Min(hn::Add(second_contexts, kEnds.Dup(1)), after_second));

    const auto dequantized = [&](V16 coefficient, V16 magnitude, size_t y) HWY_ATTR {
        const V16 level = hn::IfNegativeThenNegOrUndefIfZero(coefficient, magnitude);
        hn::StoreU(level, d, out.levels[y][pair]);
        return hn::Mul(level, hn::LoadDup128(d, quantizer.steps[y != 0]));
    };
    return {
        {
            dequantized(coefficients.v0, magnitudes.v0, 0),
            dequantized(coefficients.v1, magnitudes.v1, 1),
            dequantized(coefficients.v2, magnitudes.v2, 2),
            dequantized(coefficients.v3, magnitudes.v3, 3),
        },
        ends,
        hn::Max(upper, lower),
        hn::Add(hn::Min(first, kIsAc.Dup(0)), hn::Min(second, hn::Set(d8, 1))),
    };
}

static HWY_INLINE bool IsSaturated(V8 magnitudes)
{
    return !hn::AllFalse(D8(), hn::Eq(magnitudes, hn::Set(D8(), kMaxSymbol)));
}

// Makes one byte of the 8 that each block has in `v[0]`, then in `v[1]` and so on. The last is repeated until there are 8.
template<size_t kCount, class Combine>
static HWY_INLINE V8 Reduced(const V8* v, Combine combine)
{
    const auto merged = [&](V8 a, V8 b) HWY_ATTR { return combine(LowerAs(D16(), a, b), UpperAs(D16(), a, b)); };
    const auto two = [&](size_t i) HWY_ATTR { return merged(v[HWY_MIN(i, kCount - 1)], v[HWY_MIN(i + 4, kCount - 1)]); };
    return merged(merged(two(0), two(2)), merged(two(1), two(3)));
}

template<size_t kCount>
static HWY_INLINE V8 Highest(const V8* v)
{
    return Reduced<kCount>(v, [](V8 a, V8 b) HWY_ATTR { return hn::Max(a, b); });
}

template<size_t kCount>
static HWY_INLINE V8 Sums(const V8* v)
{
    return Reduced<kCount>(v, [](V8 a, V8 b) HWY_ATTR { return hn::Add(a, b); });
}

// Puts the `contexts` of 8 blocks into their symbols at position `kFirst`, and into the ends of those that are empty.
template<size_t kFirst>
static HWY_INLINE void SetContexts(V8 contexts, V8 ends, webp::Candidates<2>* blocks, uint8_t (&out_ends)[2][16], size_t pair)
{
    const D8 d8;
    static constexpr Table<8> kPlace([](size_t block, size_t i) -> uint8_t { return i / 2 == kFirst ? 2 * block + i % 2 : kNone; });
    hn::StoreU(hn::Max(ends, contexts), d8, out_ends[pair]);
    const V8 symbols = ContextSymbols(contexts);
    HWY_DEFAULT_UNROLL
    for (size_t block = 0; block < 8; block++) {
        uint8_t* to = blocks[block].symbols[0][pair];
        hn::StoreU(hn::Add(hn::LoadU(d8, to), hn::TableLookupBytesOr0(symbols, kPlace.Dup(block))), d8, to);
    }
}

template<class D, int kBits>
static HWY_INLINE V8 ShiftedLeft(V8 v)
{
    return hn::BitCast(D8(), hn::ShiftLeft<kBits>(hn::BitCast(D(), v)));
}

// From rows of coefficients to columns of samples, whose edges are written.
template<size_t kAllPairs>
static HWY_INLINE Quad Decode(const Quad& coefficients, const Quad& prediction, webp::Candidates<kAllPairs>& out, size_t pair)
{
    const D8 d8;
    const Quad residual = InverseDctPass(Transposed(InverseDctPass(coefficients)));
    const auto sum = [&](V16 residual, V16 prediction) HWY_ATTR { return hn::Add(Rounded<3>(residual), prediction); };
    const V8 left = hn::ReorderDemote2To(d8, sum(residual.v0, prediction.v0), sum(residual.v1, prediction.v1));
    const V8 right = hn::ReorderDemote2To(d8, sum(residual.v2, prediction.v2), sum(residual.v3, prediction.v3));

    static constexpr TwoTables<1> kEdges([](size_t, size_t i) -> uint8_t {
        const size_t at = HWY_MIN(i % 8, 6), x = at < 3 ? at : 3, y = at < 3 ? 3 : 6 - at;
        return x * 8 + y * 2 + i / 8;
    });
    hn::StoreU(kEdges.Dup(left, right, 0), d8, out.edges[pair]);
    return Columns(left, right);
}

// The first lanes of each pair, which is where the DC is in the first row.
static HWY_INLINE V16 DcsOf(V16 a, V16 b, V16 c, V16 d)
{
    return LowerAs(D64(), LowerAs(D32(), a, b), LowerAs(D32(), c, d));
}

template<int kLane>
static HWY_INLINE V16 WithDc(V16 row, V16 dcs)
{
    const D32 d32;
    const auto is_first = hn::Dup128MaskFromMaskBits(d32, 1);
    return hn::BitCast(D16(), hn::IfThenElse(is_first, hn::Broadcast<kLane>(hn::BitCast(d32, dcs)), hn::BitCast(d32, row)));
}

// ─── Prediction of whole macroblocks ────────────────────────────────────────

// RFC 6386 section 12.2. The first pair is DC and TrueMotion, the second vertical and horizontal. A sample is the sum
// of a part that depends on the row and one that depends on the column.
// `kStep` is how far to the right of the first pair in a vector the second is. If that is zero it has the next modes.
template<size_t kStep>
struct Predictor {
    // With this added, 255 is the highest number there is.
    static constexpr int16_t kBias = 32767 - 255;
    V16 from_left[4];
    V16 from_above[16];

    HWY_INLINE HWY_ATTR Predictor(const webp::Edges& edges, size_t pair, bool is_chroma)
    {
        const D16 d;
        const D8 d8;
        static constexpr Table<1> kLeft([](size_t, size_t i) -> uint8_t { return i % 4 == 2 ? 3 - i / 4 : kNone; });
        static constexpr Table<2> kAbove([](size_t row, size_t i) -> uint8_t { return i % 4 == (row && !kStep ? 0 : 2) ? row * kStep : kNone; });
        static constexpr Table<2> kIsFirst([](size_t row, size_t) -> uint8_t { return row && !kStep ? 0 : 255; });
        const V8 left = hn::LoadDup128(d8, edges.left);
        const V8 above = hn::LoadDup128(d8, edges.above);
        HWY_DEFAULT_UNROLL
        for (size_t y = 0; y < 4; y++) {
            const size_t plane = is_chroma ? y / 2 : 0;
            const V16 offsets = hn::OddEven(hn::Set(d, -edges.above_left[plane]), hn::Set(d, edges.dc[plane]));
            const size_t start = is_chroma ? 4 * (y ^ 1) : 12 - 4 * y;
            from_left[y] = hn::Add(Lookup16(left, hn::Add(kLeft.Dup(0), hn::Set(d8, start))), hn::Add(hn::And(offsets, hn::BitCast(d, kIsFirst.From(pair))), hn::Set(d, kBias)));
        }
        HWY_DEFAULT_UNROLL
        for (size_t x = 0; x < 16; x++)
            from_above[x] = Lookup16(above, hn::Add(kAbove.From(pair), hn::Set(d8, x)));
    }

    HWY_INLINE HWY_ATTR Quad Predict(size_t x, size_t y) const
    {
        const auto column = [&](size_t i) HWY_ATTR {
            const V16 sum = hn::SaturatedAdd(from_left[y], from_above[4 * x + i]);
            return hn::BitCast(D16(), hn::SaturatedSub(hn::BitCast(DU16(), sum), hn::Set(DU16(), kBias)));
        };
        return { column(0), column(1), column(2), column(3) };
    }

    HWY_INLINE HWY_ATTR Quad Luma(size_t block) const { return Predict(block % 4, block / 4); }
    HWY_INLINE HWY_ATTR Quad Chroma(size_t block) const { return Predict(block / 4 * 2 + block % 2, block / 2); }
};

// The two numbers for each pair that are in the lower and in the upper half of its lanes.
static HWY_INLINE void StoreHalves(V32 v, int32_t (&lower)[4], int32_t (&upper)[4], size_t pair)
{
    HWY_ALIGN int32_t lanes[kPairs][4];
    hn::Store(v, D32(), lanes[0]);
    for (size_t i = 0; i < kPairs; i++) {
        hwy::CopyBytes<8>(&lanes[i][0], &lower[2 * (pair + i)]);
        hwy::CopyBytes<8>(&lanes[i][2], &upper[2 * (pair + i)]);
    }
}

static HWY_INLINE void Prepare(const uint8_t (&luma)[16][16], webp::LumaSource& out)
{
    const D16 d;
    const D8 d8;
    for (size_t block = 0; block < 16; block += kPairs) {
        const Quad columns = Columns(hn::LoadU(d8, luma[block]));
        hn::StoreU(columns.v0, d, out.columns[0][block]);
        hn::StoreU(columns.v1, d, out.columns[1][block]);
        hn::StoreU(columns.v2, d, out.columns[2][block]);
        hn::StoreU(columns.v3, d, out.columns[3][block]);
    }
    // Here a pair is two blocks next to each other.
    const auto textures = [&](size_t block) HWY_ATTR {
        V8 first = hn::LoadU(d8, luma[block]);
        V8 second = hn::LoadU(d8, luma[block + kPairs]);
#if HWY_MAX_BYTES > 16
        const V8 even = hn::InterleaveEvenBlocks(d8, first, second);
        second = hn::InterleaveOddBlocks(d8, first, second);
        first = even;
#endif
        const Quad spectrum = Spectrum(Columns(hn::InterleaveLower(d8, first, second), hn::InterleaveUpper(d8, first, second)));
        hn::StoreU(spectrum.v0, d, out.spectra[0][block]);
        hn::StoreU(spectrum.v1, d, out.spectra[1][block]);
        hn::StoreU(spectrum.v2, d, out.spectra[2][block]);
        hn::StoreU(spectrum.v3, d, out.spectra[3][block]);
        return Textures(spectrum);
    };
    for (size_t block = 0; block < 16; block += 4 * kPairs)
        hn::StoreU(InOrder(PairwiseSums(textures(block), textures(block + 2 * kPairs))), D32(), &out.textures[block]);
}

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/quant_enc.c#L778
uint8_t WebpTryLumaModes(const webp::Macroblock* HWY_RESTRICT samples, const webp::Edges* HWY_RESTRICT edges,
    uint64_t non_zero_around, uint8_t y2_context, const webp::Quantizer* HWY_RESTRICT ac, const webp::Quantizer* HWY_RESTRICT y2,
    webp::LumaSource* HWY_RESTRICT source, webp::LumaCandidates* HWY_RESTRICT out)
{
    const D16 d;
    const D32 d32;
    const D8 d8;
    Prepare(samples->luma, *source);
    V8 magnitudes = hn::Zero(d8);
    V8 y2_magnitudes = hn::Zero(d8);
    for (size_t pair = 0; pair < 2; pair += kPairs) {
        const Predictor<0> predictor(*edges, pair, false);
        V16 first_rows[16];
        Quad predictions[16];
        Quad dequantized[16];
        V8 ends[16];
        for (size_t block = 0; block < 16; block++) {
            predictions[block] = predictor.Luma(block);
            const Quad coefficients = ForwardDct(Difference(Columns(*source, block), predictions[block]));
            const Quantized quantized = Quantize<true>(coefficients, *ac, out->blocks[block], pair);
            first_rows[block] = coefficients.v0;
            dequantized[block] = quantized.coefficients;
            ends[block] = quantized.ends;
            magnitudes = hn::Max(magnitudes, quantized.magnitudes);
        }

        // Above the first row, to the left of the upper two rows and to the left of the lower two.
        static constexpr Table<3> kAround([](size_t row, size_t i) -> uint8_t {
            if (row == 0) return i / 2 % 4;
            return i % 8 < 2 ? 2 + 2 * row + i / 8 : kNone;
        });
        const V8 around = hn::BitCast(d8, hn::Set(D64(), non_zero_around));
        const V8 upper_ends = Highest<8>(ends);
        const V8 lower_ends = Highest<8>(ends + 8);
        const V8 upper = hn::Min(upper_ends, hn::Set(d8, 1));
        const V8 lower = hn::Min(lower_ends, hn::Set(d8, 1));
        const auto left_of = [&](V8 non_zero, size_t row) HWY_ATTR {
            return hn::Or(ShiftedLeft<D64, 16>(non_zero), hn::TableLookupBytesOr0(around, kAround.Dup(row)));
        };
        const V8 above_upper = LowerAs(D64(), hn::TableLookupBytes(around, kAround.Dup(0)), upper);
        SetContexts<1>(hn::Add(above_upper, left_of(upper, 1)), upper_ends, out->blocks, out->ends[0], pair);
        SetContexts<1>(hn::Add(hn::CombineShiftRightBytes<8>(d8, lower, upper), left_of(lower, 2)), lower_ends, out->blocks + 8, out->ends[1], pair);

        const auto column = [&](size_t x) HWY_ATTR { return DcsOf(first_rows[x], first_rows[4 + x], first_rows[8 + x], first_rows[12 + x]); };
        const Quad doubled = HadamardPass(Transposed(HadamardPass({ column(0), column(1), column(2), column(3) })));
        const Quad halved = { hn::ShiftRight<1>(doubled.v0), hn::ShiftRight<1>(doubled.v1), hn::ShiftRight<1>(doubled.v2), hn::ShiftRight<1>(doubled.v3) };
        const Quantized quantized = Quantize<false>(halved, *y2, out->y2, pair, y2_context);
        hn::StoreU(hn::Max(Highest<1>(&quantized.ends), hn::Set(d8, y2_context)), d8, out->y2_ends[pair]);
        y2_magnitudes = hn::Max(y2_magnitudes, quantized.magnitudes);
        Quad columns = Transposed(InverseWhtPass(quantized.coefficients));
        columns.v0 = hn::Add(columns.v0, hn::Set(d, 3));
        columns = InverseWhtPass(columns);
        const V16 dcs[4] = { hn::ShiftRight<3>(columns.v0), hn::ShiftRight<3>(columns.v1), hn::ShiftRight<3>(columns.v2), hn::ShiftRight<3>(columns.v3) };
        HWY_DEFAULT_UNROLL
        for (size_t x = 0; x < 4; x++) {
            dequantized[x].v0 = WithDc<0>(dequantized[x].v0, dcs[x]);
            dequantized[4 + x].v0 = WithDc<1>(dequantized[4 + x].v0, dcs[x]);
            dequantized[8 + x].v0 = WithDc<2>(dequantized[8 + x].v0, dcs[x]);
            dequantized[12 + x].v0 = WithDc<3>(dequantized[12 + x].v0, dcs[x]);
        }

        V32 errors = hn::Zero(d32);
        V32 differences = hn::Zero(d32);
        for (size_t block = 0; block < 16; block += 2) {
            const auto measure = [&](size_t i) HWY_ATTR {
                return Measure(Decode(dequantized[i], predictions[i], out->blocks[i], pair), *source, i);
            };
            const Distortions a = measure(block);
            const Distortions b = measure(block + 1);
            const V32 originals = hn::InterleaveLower(d32, hn::Set(d32, source->textures[block]), hn::Set(d32, source->textures[block + 1]));
            const V32 difference = hn::Sub(PairwiseSums(a.textures, b.textures), hn::InterleaveLower(d32, originals, originals));
            differences = hn::Add(differences, hn::ShiftRight<5>(hn::Abs(difference)));
            errors = hn::Add(errors, hn::Add(a.errors, b.errors));
        }
        errors = hn::ShiftRight<4>(PairwiseSums(errors, errors));
        differences = hn::Add(differences, hn::Shuffle1032(differences));
        StoreHalves(LowerAs(D64(), errors, differences), out->squared_errors, out->texture_differences, pair);
    }
    return IsSaturated(magnitudes) + 2 * IsSaturated(y2_magnitudes);
}

// Quantizes `dcs`, and returns half of the error that makes.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/quant_enc.c#L866
static HWY_INLINE V16 Diffuse(V16& dcs, V16 error_above, V16 error_left, const webp::Quantizer& quantizer)
{
    const D16 d;
    const V16 corrected = hn::Add(hn::Add(dcs, error_left), hn::ShiftRight<3>(hn::Mul(error_above, hn::Set(d, 7))));
    const V16 level = Level(hn::Abs(corrected), hn::Set(d, quantizer.reciprocals[0][0]), hn::Set(d, quantizer.doubled_reciprocals[0][0]), hn::Set(d, quantizer.limits[0][0]));
    dcs = hn::IfNegativeThenNegOrUndefIfZero(corrected, hn::Mul(level, hn::Set(d, quantizer.steps[0][0])));
    return hn::ShiftRight<1>(hn::Sub(corrected, dcs));
}

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/quant_enc.c#L935
bool WebpTryChromaModes(const webp::Macroblock* HWY_RESTRICT samples, const webp::Edges* HWY_RESTRICT edges,
    uint64_t non_zero_around, const webp::Quantizer* HWY_RESTRICT quantizer, const int16_t (*HWY_RESTRICT errors_around)[8],
    webp::ChromaCandidates* HWY_RESTRICT out)
{
    const D16 d;
    const D32 d32;
    const D8 d8;
    V8 magnitudes = hn::Zero(d8);
    for (size_t pair = 0; pair < 2; pair += kPairs) {
        const Predictor<0> predictor(*edges, pair, true);
        Quad originals[8];
        Quad predictions[8];
        Quad coefficients[8];
        for (size_t block = 0; block < 8; block++) {
            originals[block] = Columns(hn::LoadDup128(d8, samples->chroma[block]));
            predictions[block] = predictor.Chroma(block);
            coefficients[block] = ForwardDct(Difference(originals[block], predictions[block]));
        }

        if (errors_around) {
            // U and V of one block in the lower half, and of another in the upper.
            const auto dcs = [&](size_t a, size_t b) HWY_ATTR {
                return DcsOf(coefficients[a].v0, coefficients[4 + a].v0, coefficients[b].v0, coefficients[4 + b].v0);
            };
            const V16 above = hn::LoadDup128(d, errors_around[0]);
            const V16 left = hn::LoadDup128(d, errors_around[1]);
            V16 dcs0 = dcs(0, 0), dcs12 = dcs(1, 2), dcs3 = dcs(3, 3);
            const V16 errors0 = Diffuse(dcs0, above, left, *quantizer);
            const V16 errors12 = Diffuse(dcs12, LowerAs(D64(), UpperAs(D64(), above, above), errors0), UpperAs(D64(), LowerAs(D64(), errors0, errors0), left), *quantizer);
            const V16 errors3 = Diffuse(dcs3, errors12, UpperAs(D64(), errors12, errors12), *quantizer);
            hn::StoreU(errors12, d, out->dc_errors[0][pair]);
            hn::StoreU(errors3, d, out->dc_errors[1][pair]);
            coefficients[0].v0 = WithDc<0>(coefficients[0].v0, dcs0);
            coefficients[4].v0 = WithDc<1>(coefficients[4].v0, dcs0);
            coefficients[1].v0 = WithDc<0>(coefficients[1].v0, dcs12);
            coefficients[5].v0 = WithDc<1>(coefficients[5].v0, dcs12);
            coefficients[2].v0 = WithDc<2>(coefficients[2].v0, dcs12);
            coefficients[6].v0 = WithDc<3>(coefficients[6].v0, dcs12);
            coefficients[3].v0 = WithDc<0>(coefficients[3].v0, dcs3);
            coefficients[7].v0 = WithDc<1>(coefficients[7].v0, dcs3);
        }

        V32 errors = hn::Zero(d32);
        V8 ends[8];
        V8 ac_counts = hn::Zero(d8);
        for (size_t block = 0; block < 8; block++) {
            const Quantized quantized = Quantize<false>(coefficients[block], *quantizer, out->blocks[block], pair);
            ends[block] = quantized.ends;
            magnitudes = hn::Max(magnitudes, quantized.magnitudes);
            ac_counts = hn::Add(ac_counts, quantized.ac_counts);
            const Quad decoded = Decode(quantized.coefficients, predictions[block], out->blocks[block], pair);
            const Quad error = Difference(decoded, originals[block]);
            // So that each two lanes are of the same block.
            const Quad interleaved = {
                hn::InterleaveLower(d, error.v0, error.v1),
                hn::InterleaveUpper(d, error.v0, error.v1),
                hn::InterleaveLower(d, error.v2, error.v3),
                hn::InterleaveUpper(d, error.v2, error.v3),
            };
            errors = hn::Add(errors, SumsOfProducts(interleaved, interleaved));
        }
        errors = hn::Add(errors, hn::Shuffle1032(errors));
        int32_t duplicates[4];
        StoreHalves(errors, out->squared_errors, duplicates, pair);
        hn::StoreU(Sums<1>(&ac_counts), d8, out->ac_counts[pair]);

        static constexpr Table<2> kAround([](size_t left, size_t i) -> uint8_t {
            return left ? (i % 4 < 2 ? 4 + i / 4 : kNone) : (i % 8 < 4 ? i / 8 * 2 + i / 2 % 2 : kNone);
        });
        const V8 around = hn::BitCast(d8, hn::Set(D64(), non_zero_around));
        const V8 all_ends = Highest<8>(ends);
        const V8 non_zero = hn::Min(all_ends, hn::Set(d8, 1));
        const V8 above = hn::Or(ShiftedLeft<D64, 32>(non_zero), hn::TableLookupBytesOr0(around, kAround.Dup(0)));
        const V8 left = hn::Or(ShiftedLeft<D32, 16>(non_zero), hn::TableLookupBytesOr0(around, kAround.Dup(1)));
        SetContexts<0>(hn::Add(above, left), all_ends, out->blocks, out->ends, pair);
    }
    return IsSaturated(magnitudes);
}

// ─── Prediction of subblocks ────────────────────────────────────────────────

// RFC 6386 section 12.3. For each mode and sample: 0 to 12 for the average of three samples around that position of
// the edge, 13 for the first sample of the edge, 16 and more for the average of two. The first two are made otherwise.
static constexpr uint8_t kSubblockSources[10][4][4] = {
    {},
    {},
    { { 5, 6, 7, 8 }, { 5, 6, 7, 8 }, { 5, 6, 7, 8 }, { 5, 6, 7, 8 } },
    { { 3, 3, 3, 3 }, { 2, 2, 2, 2 }, { 1, 1, 1, 1 }, { 0, 0, 0, 0 } },
    { { 4, 5, 6, 7 }, { 3, 4, 5, 6 }, { 2, 3, 4, 5 }, { 1, 2, 3, 4 } },
    { { 20, 21, 22, 23 }, { 4, 5, 6, 7 }, { 3, 20, 21, 22 }, { 2, 4, 5, 6 } },
    { { 6, 7, 8, 9 }, { 7, 8, 9, 10 }, { 8, 9, 10, 11 }, { 9, 10, 11, 12 } },
    { { 21, 22, 23, 24 }, { 6, 7, 8, 9 }, { 22, 23, 24, 10 }, { 7, 8, 9, 11 } },
    { { 19, 4, 5, 6 }, { 18, 3, 19, 4 }, { 17, 2, 18, 3 }, { 16, 1, 17, 2 } },
    { { 18, 2, 17, 1 }, { 17, 1, 16, 0 }, { 16, 0, 13, 13 }, { 13, 13, 13, 13 } },
};

// No pair needs more than 16 of these. Each has a place of its own among those that the pair does need.
static consteval bool Needs(size_t pair, size_t source)
{
    for (size_t i = 0; i < 32; i++) {
        if (kSubblockSources[2 * pair + i / 16][i / 4 % 4][i % 4] == source) return true;
    }
    return false;
}

static consteval size_t PlaceOf(size_t pair, size_t source)
{
    size_t place = 0;
    for (size_t other = 0; other < source; other++)
        place += Needs(pair, other);
    return place;
}

static consteval uint8_t SourceAt(size_t pair, size_t place)
{
    for (size_t source = 0; source < 32; source++) {
        if (Needs(pair, source) && PlaceOf(pair, source) == place) return source;
    }
    return 0;
}

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/quant_enc.c#L830
template<size_t kFirstPair, size_t kEndPair>
static HWY_INLINE uint8_t TrySubblockModes(uint64_t edge_start, uint64_t edge_end, uint8_t context, size_t block, const webp::LumaSource* HWY_RESTRICT source,
    const webp::Quantizer* HWY_RESTRICT quantizer, int32_t texture_lambda, webp::SubblockCandidates* HWY_RESTRICT out)
{
    const D16 d;
    const D8 d8;
    const D32 d32;
    const D64 d64;
    block %= 16;

    static constexpr Table<3> kAround([](size_t row, size_t i) -> uint8_t { return i > 12 || i + row == 0 ? 0 : HWY_MIN(i + row - 1, 12); });
    const V8 edge = hn::BitCast(d8, hn::Dup128VecFromValues(d64, edge_start, edge_end));
    const V8 before = hn::TableLookupBytes(edge, kAround.Dup(0));
    const V8 at = hn::TableLookupBytes(edge, kAround.Dup(1));
    const V8 after = hn::TableLookupBytes(edge, kAround.Dup(2));
    // AverageRound() rounds up.
    const V8 outer = hn::Sub(hn::AverageRound(before, after), hn::And(hn::Xor(before, after), hn::Set(d8, 1)));
    const V8 of_three = hn::AverageRound(outer, at);
    const V8 of_two = hn::AverageRound(at, after);

    static constexpr Table<1> kNextTo([](size_t, size_t i) -> uint8_t { return i < 8 ? i + i / 4 : kNone; });
    const V16 sum = hn::BitCast(d, hn::SumsOf8(hn::TableLookupBytesOr0(edge, kNextTo.Dup(0))));
    const V16 dc = hn::ShiftRight<3>(hn::Add(sum, hn::Set(d, 4)));
    // By column: above, the corner, and left twice over.
    static constexpr Table<4> kParts([](size_t row, size_t i) -> uint8_t {
        const size_t parts[4] = { 5 + i / 8, 7 + i / 8, 4, 3 - i / 2 % 4 };
        return i % 2 ? kNone : parts[row];
    });
    const V16 left = hn::Sub(Lookup16(edge, kParts.Dup(3)), Lookup16(edge, kParts.Dup(2)));
    const V8 true_motion = hn::ReorderDemote2To(d8, hn::Add(left, Lookup16(edge, kParts.Dup(0))), hn::Add(left, Lookup16(edge, kParts.Dup(1))));

    // The sixth pair is the fifth again.
    static constexpr TwoTables<6> kSources([](size_t pair, size_t i) { return SourceAt(HWY_MIN(pair, 4), i); });
    // By column and pair.
    static constexpr Table<24> kColumns([](size_t row, size_t i) -> uint8_t {
        const size_t x = row / 6, pair = HWY_MIN(row % 6, 4), y = i / 4, mode = 2 * pair + i / 2 % 2;
        if (i % 2 || mode == 0) return kNone;
        return mode == 1 ? 4 * x + y : PlaceOf(pair, kSubblockSources[mode][y][x]);
    });
    static constexpr Table<2> kIsFirst([](size_t pair, size_t) -> uint8_t { return pair ? 0 : 255; });
    static constexpr Table<2> kDc([](size_t pair, size_t i) -> uint8_t { return pair || i % 4 ? kNone : 0; });

    const Quad original = Columns(*source, block);
    // Step by step for all modes, rather than mode by mode: each step has to wait for the one before it.
    constexpr size_t kGroups = (kEndPair - kFirstPair + kPairs - 1) / kPairs;
    Quad predictions[kGroups];
    Quad quads[kGroups];
    V32 errors[kGroups];
    V32 textures[kGroups];
    V8 ends[kGroups];
    V8 ac_counts[kGroups];
    V8 magnitudes = hn::Zero(d8);
    HWY_DEFAULT_UNROLL
    for (size_t i = 0; i < kGroups; i++) {
        const size_t pair = kFirstPair + i * kPairs;
        V8 sources = kSources.From(of_three, of_two, pair);
        V16 dcs = hn::Zero(d);
        if (pair == 0) {
            sources = hn::IfVecThenElse(kIsFirst.From(0), true_motion, sources);
            dcs = Lookup16(hn::BitCast(d8, dc), kDc.From(0));
        }
        const auto column = [&](size_t x) HWY_ATTR { return hn::Or(Lookup16(sources, kColumns.From(6 * x + pair)), dcs); };
        predictions[i] = { column(0), column(1), column(2), column(3) };
        quads[i] = ForwardDct(Difference(original, predictions[i]));
    }
    HWY_DEFAULT_UNROLL
    for (size_t i = 0; i < kGroups; i++) {
        const Quantized quantized = Quantize<true>(quads[i], *quantizer, out->block, kFirstPair + i * kPairs, context);
        quads[i] = quantized.coefficients;
        ends[i] = quantized.ends;
        ac_counts[i] = quantized.ac_counts;
        magnitudes = hn::Max(magnitudes, quantized.magnitudes);
    }
    const hn::Full128<uint8_t> d16x8;
    const auto by_mode = [&](V8 v) HWY_ATTR {
#if HWY_MAX_BYTES > 16
        const hn::Full128<uint16_t> d8x16;
        return hn::BitCast(d16x8, hn::InterleaveLower(d8x16, hn::BitCast(d8x16, hn::LowerHalf(v)), hn::BitCast(d8x16, hn::UpperHalf(d16x8, v))));
#else
        return v;
#endif
    };
    const auto all_ends = by_mode(hn::Max(Highest<kGroups>(ends), hn::Set(d8, context)));
    // From 4 on, the difference is not negative.
    static constexpr Table<1> kIsFlat([](size_t, size_t i) -> uint8_t { return i + kFirstPair ? 128 : 0; });
    const auto is_flat = hn::And(hn::Sub(by_mode(Sums<kGroups>(ac_counts)), hn::Set(d16x8, 4)), hn::Load(d16x8, kIsFlat.rows[0]));
    hn::StoreU(hn::Or(all_ends, is_flat), d16x8, &out->ends[2 * kFirstPair]);
    const uint8_t last_end = IsSaturated(magnitudes) ? 255 : hn::ReduceMax(d16x8, all_ends);
    HWY_DEFAULT_UNROLL
    for (size_t i = 0; i < kGroups; i++)
        quads[i] = Decode(quads[i], predictions[i], out->block, kFirstPair + i * kPairs);
    HWY_DEFAULT_UNROLL
    for (size_t i = 0; i < kGroups; i++) {
        const Distortions measured = Measure(quads[i], *source, block);
        errors[i] = measured.errors;
        textures[i] = measured.textures;
    }

    const auto distortions = [&](size_t a, size_t b) HWY_ATTR {
        const V32 difference = hn::Sub(PairwiseSums(textures[a], textures[b]), hn::Set(d32, source->textures[block]));
        // Both fit 15 bits.
        const V32 weighted = hn::WidenMulPairwiseAdd(d32, hn::BitCast(d, hn::ShiftRight<5>(hn::Abs(difference))), hn::BitCast(d, hn::Set(d32, texture_lambda)));
        return InOrder(hn::Add(hn::ShiftLeft<4>(PairwiseSums(errors[a], errors[b])), hn::And(hn::Add(weighted, hn::Set(d32, 128)), hn::Set(d32, -256))));
    };
    HWY_DEFAULT_UNROLL
    for (size_t i = 0; i < kGroups; i += 2)
        hn::StoreU(distortions(i, HWY_MIN(i + 1, kGroups - 1)), d32, &out->distortions[2 * (kFirstPair + i * kPairs)]);
    return last_end;
}

uint8_t WebpTryStraightModes(uint64_t edge_start, uint64_t edge_end, uint8_t context, size_t block, const webp::LumaSource* HWY_RESTRICT source,
    const webp::Quantizer* HWY_RESTRICT quantizer, int32_t texture_lambda, webp::SubblockCandidates* HWY_RESTRICT out)
{
    return TrySubblockModes<0, 2>(edge_start, edge_end, context, block, source, quantizer, texture_lambda, out);
}

uint8_t WebpTryDiagonalModes(uint64_t edge_start, uint64_t edge_end, uint8_t context, size_t block, const webp::LumaSource* HWY_RESTRICT source,
    const webp::Quantizer* HWY_RESTRICT quantizer, int32_t texture_lambda, webp::SubblockCandidates* HWY_RESTRICT out)
{
    return TrySubblockModes<2, 5>(edge_start, edge_end, context, block, source, quantizer, texture_lambda, out);
}

// ─── Conversion from RGBA ───────────────────────────────────────────────────

// (a * kA + b * kB + c * kC + d * kD + rounding) >> kShift, where the lanes of `a` and `b` alternate and those of `c` and `d`.
template<int kA, int kB, int kC, int kD, int kShift>
static HWY_INLINE V32 Mixed(V16 ab, V16 cd, int32_t rounding = 0)
{
    const D16 d;
    const D32 d32;
    V32 sum1 = hn::Zero(d32);
    V32 sum0 = hn::ReorderWidenMulAccumulate(d32, ab, hn::OddEven(hn::Set(d, kB), hn::Set(d, kA)), hn::Zero(d32), sum1);
    sum0 = hn::ReorderWidenMulAccumulate(d32, cd, hn::OddEven(hn::Set(d, kD), hn::Set(d, kC)), sum0, sum1);
    return hn::ShiftRight<kShift>(hn::Add(hn::RearrangeToOddPlusEven(sum0, sum1), hn::Set(d32, rounding)));
}

// `indices` are below 32.
static HWY_INLINE V8 Lookup32(const uint8_t (&table)[32], V8 indices)
{
    const D8 d8;
    const V8 low = hn::LoadDup128(d8, table);
    const V8 high = hn::LoadDup128(d8, table + 16);
#if HWY_TARGET_IS_NEON
    return hn::TwoTablesLookupLanes(d8, low, high, hn::IndicesFromVec(d8, indices));
#else
    // What is below 16 gets its highest bit set by the subtraction, and the rest by the addition.
    const V8 into_low = hn::And(hn::Add(indices, hn::Set(d8, 0x70)), hn::Set(d8, 0x8f));
    return hn::Or(hn::TableLookupBytesOr0(low, into_low), hn::TableLookupBytesOr0(high, hn::Sub(indices, hn::Set(d8, 16))));
#endif
}

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/dsp/yuv.h#L206
void WebpConvert(const uint8_t* const* HWY_RESTRICT pixels, const webp::LinearColors* HWY_RESTRICT colors,
    const webp::GammaTable* HWY_RESTRICT gamma, webp::Macroblock* HWY_RESTRICT out)
{
    const D16 d;
    const D8 d8;
    static constexpr Table<1> kGreens([](size_t, size_t i) -> uint8_t { return i % 2 ? kNone : i / 4 * 4 + 1; });
    static constexpr Table<1> kByColumn([](size_t, size_t i) -> uint8_t { return i % 4 * 4 + i / 4; });
    for (size_t block = 0; block < 16; block += kPairs) {
        const auto row = [&](size_t y) HWY_ATTR {
            const V8 rgba = hn::LoadU(d8, pixels[block / 4 * 4 + y] + 4 * (block % 4 * 4));
            const V16 red_blue = hn::And(hn::BitCast(d, rgba), hn::Set(d, 255));
            // The factor for green does not fit 15 bits.
            return Mixed<16839, 6420, 33059 / 2, 33059 - 33059 / 2, 16>(red_blue, Lookup16(rgba, kGreens.Dup(0)), (16 << 16) + (1 << 15));
        };
        const V8 rows = hn::ReorderDemote2To(d8, hn::ReorderDemote2To(d, row(0), row(1)), hn::ReorderDemote2To(d, row(2), row(3)));
        hn::StoreU(hn::TableLookupBytes(rows, kByColumn.Dup(0)), d8, out->luma[block]);
    }

    for (size_t half = 0; half < 2; half += kPairs) {
        // Two rows, whose samples alternate.
        const auto rows = [&](size_t y, V16& u, V16& v) HWY_ATTR {
            V16 upper[3], lower[3];
            HWY_DEFAULT_UNROLL
            for (size_t i = 0; i < 3; i++) {
                const V16 a = hn::LoadU(d, colors->sums[i][y][half]);
                const V16 b = hn::LoadU(d, colors->sums[i][y + 1][half]);
                const V8 indices = hn::ReorderDemote2To(d8, hn::ShiftRight<9>(a), hn::ShiftRight<9>(b));
                const V8 values = Lookup32(gamma->values, indices);
                const V8 slopes = Lookup32(gamma->slopes, indices);
                // 4 * value + ((slope * fraction + 64) >> 7)
                const auto interpolated = [&](V8 value, V8 slope, V16 sum) HWY_ATTR {
                    return hn::Add(hn::ShiftLeft<2>(hn::BitCast(d, value)), hn::MulFixedPoint15(hn::BitCast(d, slope), hn::And(sum, hn::Set(d, 511))));
                };
                const V8 zero = hn::Zero(d8);
                upper[i] = interpolated(hn::InterleaveLower(d8, values, zero), hn::InterleaveLower(d8, zero, slopes), a);
                lower[i] = interpolated(hn::InterleaveUpper(d8, values, zero), hn::InterleaveUpper(d8, zero, slopes), b);
            }
            const auto row = [&](const V16(&rgb)[3], V16& u, V16& v) HWY_ATTR {
                // Multiplied by 1 << 14 this is (128 << 18) + (1 << 17).
                const V16 offset = hn::Set(d, (128 << 4) + (1 << 3));
                const V16 rg0 = hn::InterleaveLower(d, rgb[0], rgb[1]), b0 = hn::InterleaveLower(d, rgb[2], offset);
                const V16 rg1 = hn::InterleaveUpper(d, rgb[0], rgb[1]), b1 = hn::InterleaveUpper(d, rgb[2], offset);
                u = hn::ReorderDemote2To(d, Mixed<-9719, -19081, 28800, 1 << 14, 18>(rg0, b0), Mixed<-9719, -19081, 28800, 1 << 14, 18>(rg1, b1));
                v = hn::ReorderDemote2To(d, Mixed<28800, -24116, -4684, 1 << 14, 18>(rg0, b0), Mixed<28800, -24116, -4684, 1 << 14, 18>(rg1, b1));
            };
            V16 lower_u, lower_v;
            row(upper, u, v);
            row(lower, lower_u, lower_v);
            u = hn::Or(u, hn::ShiftLeft<8>(lower_u));
            v = hn::Or(v, hn::ShiftLeft<8>(lower_v));
        };
        const auto store = [&](V16 rows01, V16 rows23, uint8_t* to) HWY_ATTR {
            const V8 left = hn::BitCast(d8, hn::InterleaveLower(d, rows01, rows23));
            const V8 right = hn::BitCast(d8, hn::InterleaveUpper(d, rows01, rows23));
#if HWY_MAX_BYTES > 16
            hn::StoreU(hn::InterleaveEvenBlocks(d8, left, right), d8, to);
            hn::StoreU(hn::InterleaveOddBlocks(d8, left, right), d8, to + 32);
#else
            hn::StoreU(left, d8, to);
            hn::StoreU(right, d8, to + 16);
#endif
        };
        V16 u01, v01, u23, v23;
        rows(0, u01, v01);
        rows(2, u23, v23);
        store(u01, u23, out->chroma[2 * half]);
        store(v01, v23, out->chroma[4 + 2 * half]);
    }
}

// ─── Analysis ───────────────────────────────────────────────────────────────

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/dsp/enc.c#L50
template<size_t kBlocks>
static HWY_INLINE void FillHistograms(const uint8_t (&blocks)[kBlocks][16], const webp::Edges& edges, webp::Histograms& out)
{
    const DU16 du;
    const D8 d8;
    const D64 d64;
    constexpr bool kIsChroma = kBlocks == 8;
    const Predictor<4> predictor(edges, 0, kIsChroma);
    V8 bins[2 * kBlocks / kPairs];
    V8 last = hn::Zero(d8);
    for (size_t block = 0; block < kBlocks; block += kPairs) {
        const Quad prediction = kIsChroma ? predictor.Chroma(block) : predictor.Luma(block);
        const Quad coefficients = ForwardDct(Difference(Columns(hn::LoadU(d8, blocks[block])), prediction));
        const auto binned = [&](V16 a, V16 b) HWY_ATTR {
            return hn::Min(hn::ReorderDemote2To(d8, hn::ShiftRight<3>(hn::Abs(a)), hn::ShiftRight<3>(hn::Abs(b))), hn::Set(d8, 31));
        };
        const V8 upper = binned(coefficients.v0, coefficients.v1);
        const V8 lower = binned(coefficients.v2, coefficients.v3);
        bins[2 * block / kPairs] = upper;
        bins[2 * block / kPairs + 1] = lower;
        last = hn::Max(last, hn::Max(upper, lower));
    }
    const auto even = [&](V8 v) HWY_ATTR { return hn::And(hn::BitCast(du, v), hn::Set(du, 255)); };
    const auto odd = [&](V8 v) HWY_ATTR { return hn::ShiftRight<8>(hn::BitCast(du, v)); };
    out.last_bin[0] = hn::ReduceMax(du, even(last));
    out.last_bin[1] = hn::ReduceMax(du, odd(last));

    // Until what is left would not fill a bin higher than the highest.
    uint32_t highest[2] = {};
    uint32_t left[2] = { 16 * kBlocks, 16 * kBlocks };
    for (V8 bin = hn::Zero(d8); left[0] > highest[0] || left[1] > highest[1]; bin = hn::Add(bin, hn::Set(d8, 1))) {
        V8 counts = hn::Zero(d8);
        for (const V8 it : bins)
            counts = hn::Sub(counts, hn::VecFromMask(d8, hn::Eq(it, bin)));
        const auto sums = hn::Or(hn::SumsOf8(hn::BitCast(d8, even(counts))), hn::ShiftLeft<32>(hn::SumsOf8(hn::BitCast(d8, odd(counts)))));
        const uint64_t both = hn::ReduceSum(d64, sums);
        for (size_t i = 0; i < 2; i++) {
            const uint32_t count = static_cast<uint32_t>(both >> (32 * i));
            highest[i] = HWY_MAX(highest[i], count);
            left[i] -= count;
        }
    }
    out.highest_count[0] = highest[0];
    out.highest_count[1] = highest[1];
}

void WebpAnalyze(const webp::Macroblock* HWY_RESTRICT samples, const webp::Edges* HWY_RESTRICT luma_edges,
    const webp::Edges* HWY_RESTRICT chroma_edges, webp::Histograms (*HWY_RESTRICT out)[2])
{
    FillHistograms(samples->luma, *luma_edges, (*out)[0]);
    FillHistograms(samples->chroma, *chroma_edges, (*out)[1]);
}

// NOLINTNEXTLINE(google-readability-namespace-comments)
} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {
HWY_EXPORT(WebpTryLumaModes);
HWY_EXPORT(WebpTryChromaModes);
HWY_EXPORT(WebpTryStraightModes);
HWY_EXPORT(WebpTryDiagonalModes);
HWY_EXPORT(WebpConvert);
HWY_EXPORT(WebpAnalyze);

extern "C" uint8_t highway_webp_try_luma_modes(const webp::Macroblock* samples, const webp::Edges* edges,
    uint64_t non_zero_around, uint8_t y2_context, const webp::Quantizer* ac, const webp::Quantizer* y2, webp::LumaSource* source, webp::LumaCandidates* out)
{
    return BUN_HWY_DISPATCH(WebpTryLumaModes)(samples, edges, non_zero_around, y2_context, ac, y2, source, out);
}

extern "C" bool highway_webp_try_chroma_modes(const webp::Macroblock* samples, const webp::Edges* edges,
    uint64_t non_zero_around, const webp::Quantizer* quantizer, const int16_t (*errors_around)[8], webp::ChromaCandidates* out)
{
    return BUN_HWY_DISPATCH(WebpTryChromaModes)(samples, edges, non_zero_around, quantizer, errors_around, out);
}

extern "C" uint8_t highway_webp_try_straight_modes(uint64_t edge_start, uint64_t edge_end, uint8_t context, size_t block, const webp::LumaSource* source,
    const webp::Quantizer* quantizer, int32_t texture_lambda, webp::SubblockCandidates* out)
{
    return BUN_HWY_DISPATCH(WebpTryStraightModes)(edge_start, edge_end, context, block, source, quantizer, texture_lambda, out);
}

extern "C" uint8_t highway_webp_try_diagonal_modes(uint64_t edge_start, uint64_t edge_end, uint8_t context, size_t block, const webp::LumaSource* source,
    const webp::Quantizer* quantizer, int32_t texture_lambda, webp::SubblockCandidates* out)
{
    return BUN_HWY_DISPATCH(WebpTryDiagonalModes)(edge_start, edge_end, context, block, source, quantizer, texture_lambda, out);
}

extern "C" void highway_webp_convert(const uint8_t* const* pixels, const webp::LinearColors* colors,
    const webp::GammaTable* gamma, webp::Macroblock* out)
{
    BUN_HWY_DISPATCH(WebpConvert)(pixels, colors, gamma, out);
}

extern "C" void highway_webp_analyze(const webp::Macroblock* samples, const webp::Edges* luma_edges,
    const webp::Edges* chroma_edges, webp::Histograms (*out)[2])
{
    BUN_HWY_DISPATCH(WebpAnalyze)(samples, luma_edges, chroma_edges, out);
}
} // namespace bun
#endif
