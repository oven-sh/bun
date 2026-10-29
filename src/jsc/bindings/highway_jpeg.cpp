// The kernels of the JPEG codec (src/jpeg) that work on a row of samples, runtime-dispatched via Google Highway.
//
// All arithmetic is on integers, so every target gives the same bytes: those of the Rust function that each kernel
// stands in for, which src/jpeg keeps for the rows that are left to it.
//
// A kernel only loads and stores whole vectors. The last one ends where the row ends and overlaps the one before, which
// works because no kernel writes what it reads. A row too short for a vector of the CPU is done with vectors of 16 bytes,
// and one too short for those is left to the caller: the kernel returns false and has done nothing.
//
// Derived from libjpeg-turbo's jdcolor.c, jccolor.c, jcsample.c and jdsample.c, and from simd/x86_64/jdcolext-sse2.asm and
// jccolext-sse2.asm: see src/jpeg/NOTICE.md.

// Left are SSSE3, AVX2 and one kind of NEON. The others make these kernels no faster, and SVE2_128 makes them slower.
#undef HWY_DISABLED_TARGETS
#define HWY_DISABLED_TARGETS (HWY_SSE4 | HWY_AVX3 | HWY_AVX3_DL | HWY_AVX3_ZEN4 | HWY_AVX3_SPR | HWY_AVX10_2 | HWY_NEON | HWY_NEON_BF16 | HWY_ALL_SVE)
#ifndef __OPTIMIZE__
#error "With targets of its own this file needs hwy::ChosenTarget::GetIndex() inlined, which Highway only does in an optimized build: see fileOverrides in scripts/build/flags.ts"
#endif

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_jpeg.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>
#include "highway_dispatch.h"

#include <stddef.h>
#include <stdint.h>

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

// A factor as jccolor.c and jdcolor.c have it: in units of 1/65536.
static constexpr int32_t Fix(double x)
{
    return static_cast<int32_t>(x * 65536.0 + 0.5);
}

static constexpr int32_t kOneHalf = 1 << 15;

// The kernels with vectors of the size of `D8`.
template<class D8>
struct JpegRows {
    using DU16 = hn::Repartition<uint16_t, D8>;
    using D16 = hn::Repartition<int16_t, D8>;
    using D32 = hn::Repartition<int32_t, D8>;
    using V8 = hn::Vec<D8>;
    using VU16 = hn::Vec<DU16>;
    using V16 = hn::Vec<D16>;
    using V32 = hn::Vec<D32>;

    // `even` in the even lanes and `odd` in the odd ones.
    static HWY_INLINE V16 Pairs(int32_t even, int32_t odd)
    {
        const uint32_t pair = static_cast<uint32_t>(odd) << 16 | (static_cast<uint32_t>(even) & 0xFFFF);
        return hn::BitCast(D16(), hn::Set(D32(), static_cast<int32_t>(pair)));
    }

    // `(x * fraction + kOneHalf) >> 16`, by computing one more bit of the product than MulHigh keeps.
    static HWY_INLINE V16 MulFraction(V16 x, int32_t fraction)
    {
        const D16 d;
        return hn::ShiftRight<1>(hn::Add(hn::MulHigh(hn::Add(x, x), hn::Set(d, static_cast<int16_t>(fraction))), hn::Set(d, 1)));
    }

    // What jdcolor.c's tables hold. The whole part of a factor is added apart from its fraction, which fits 16 bits.
    static HWY_INLINE void YccToRgb(V16 y, V16 cb, V16 cr, V16& r, V16& g, V16& b)
    {
        const D16 d;
        const D32 d32;
        const V16 center = hn::Set(d, 128);
        cb = hn::Sub(cb, center);
        cr = hn::Sub(cr, center);
        r = hn::Add(hn::Add(y, cr), MulFraction(cr, Fix(1.40200) - Fix(1.0)));
        b = hn::Add(hn::Add(y, hn::Add(cb, cb)), MulFraction(cb, Fix(1.77200) - Fix(2.0)));

        const V16 factors = Pairs(-Fix(0.34414), Fix(1.0) - Fix(0.71414));
        const V32 half = hn::Set(d32, kOneHalf);
        const V32 even = hn::Add(hn::WidenMulPairwiseAdd(d32, hn::InterleaveEven(d, cb, cr), factors), half);
        const V32 odd = hn::Add(hn::WidenMulPairwiseAdd(d32, hn::InterleaveOdd(d, cb, cr), factors), half);
        // The upper half of a sum for an odd lane is in that lane already.
        const V16 fraction = hn::OddEven(hn::BitCast(d, odd), hn::BitCast(d, hn::ShiftRight<16>(even)));
        g = hn::Add(hn::Sub(y, cr), fraction);
    }

    // `out` gets 4 bytes for each of `n` pixels: R, G, B and 255, or with `k` what each of them lacks to 255 and K.
    static HWY_INLINE bool FromYcc(const uint8_t* HWY_RESTRICT y, const uint8_t* HWY_RESTRICT cb, const uint8_t* HWY_RESTRICT cr,
        const uint8_t* HWY_RESTRICT k, uint8_t* HWY_RESTRICT out, size_t n)
    {
        const D8 d8;
        const D16 d;
        const size_t N = hn::Lanes(d8);
        if (n < N) return false;
        for (size_t i = 0, last = n - N;; i = HWY_MIN(i + N, last)) {
            const V8 y8 = hn::LoadU(d8, y + i), cb8 = hn::LoadU(d8, cb + i), cr8 = hn::LoadU(d8, cr + i);
            V16 r0, g0, b0, r1, g1, b1;
            YccToRgb(hn::PromoteLowerTo(d, y8), hn::PromoteLowerTo(d, cb8), hn::PromoteLowerTo(d, cr8), r0, g0, b0);
            YccToRgb(hn::PromoteUpperTo(d, y8), hn::PromoteUpperTo(d, cb8), hn::PromoteUpperTo(d, cr8), r1, g1, b1);
            const V8 r = hn::OrderedDemote2To(d8, r0, r1), g = hn::OrderedDemote2To(d8, g0, g1), b = hn::OrderedDemote2To(d8, b0, b1);
            if (k) {
                hn::StoreInterleaved4(hn::Not(r), hn::Not(g), hn::Not(b), hn::LoadU(d8, k + i), d8, out + i * 4);
            } else {
                hn::StoreInterleaved4(r, g, b, hn::Set(d8, 255), d8, out + i * 4);
            }
            if (i == last) return true;
        }
    }

    // One lane of 32 bits for a pixel. Each result is in the upper half of its lane.
    static HWY_INLINE void RgbaToYcc(V8 pixels, V32& y, V32& cb, V32& cr)
    {
        const D32 d32;
        // Half minus epsilon, so that the largest result rounds to 255 and not to 256.
        const V32 offset = hn::Set(d32, (128 << 16) + kOneHalf - 1);
        // x86 has an instruction that multiplies numbers of 16 bits and adds the products in pairs, and is slow to multiply
        // numbers of 32 bits. Arm is the other way around.
#if HWY_ARCH_X86
        const D16 d;
        const DU16 du;
        const V16 rb = hn::BitCast(d, hn::PromoteEvenTo(du, pixels));
        const V16 ga = hn::BitCast(d, hn::PromoteOddTo(du, pixels));
        // 16 bits with a sign hold neither 0.587 nor 0.5, but they do hold half of the one and the negative of the other.
        static_assert(Fix(0.58700) % 2 == 0 && -Fix(0.50000) == INT16_MIN);
        const V32 g = hn::WidenMulPairwiseAdd(d32, ga, Pairs(Fix(0.58700) / 2, 0));
        y = hn::Add(hn::Add(hn::WidenMulPairwiseAdd(d32, rb, Pairs(Fix(0.29900), Fix(0.11400))), hn::Set(d32, kOneHalf)), hn::Add(g, g));
        cb = hn::Sub(hn::Sub(offset, hn::WidenMulPairwiseAdd(d32, rb, Pairs(Fix(0.16874), -Fix(0.50000)))),
            hn::WidenMulPairwiseAdd(d32, ga, Pairs(Fix(0.33126), 0)));
        cr = hn::Sub(hn::Sub(offset, hn::WidenMulPairwiseAdd(d32, rb, Pairs(-Fix(0.50000), Fix(0.08131)))),
            hn::WidenMulPairwiseAdd(d32, ga, Pairs(Fix(0.41869), 0)));
#else
        const V32 pixel = hn::BitCast(d32, pixels), byte = hn::Set(d32, 255);
        const V32 r = hn::And(pixel, byte), g = hn::And(hn::ShiftRight<8>(pixel), byte), b = hn::And(hn::ShiftRight<16>(pixel), byte);
        const auto sum = [&](int32_t fr, int32_t fg, int32_t fb, V32 start) HWY_ATTR {
            return hn::MulAdd(r, hn::Set(d32, fr), hn::MulAdd(g, hn::Set(d32, fg), hn::MulAdd(b, hn::Set(d32, fb), start)));
        };
        y = sum(Fix(0.29900), Fix(0.58700), Fix(0.11400), hn::Set(d32, kOneHalf));
        cb = sum(-Fix(0.16874), -Fix(0.33126), Fix(0.50000), offset);
        cr = sum(Fix(0.50000), -Fix(0.41869), -Fix(0.08131), offset);
#endif
    }

    // The upper halves of the lanes, none of which is over 255.
    static HWY_INLINE V8 UpperHalves(V32 a, V32 b, V32 c, V32 d)
    {
        const D16 d16;
        return hn::OrderedDemote2To(D8(), hn::ConcatOdd(d16, hn::BitCast(d16, b), hn::BitCast(d16, a)),
            hn::ConcatOdd(d16, hn::BitCast(d16, d), hn::BitCast(d16, c)));
    }

    // `rgba` has 4 bytes for each of `n` pixels.
    static HWY_INLINE bool ToYcc(const uint8_t* HWY_RESTRICT rgba, uint8_t* HWY_RESTRICT y, uint8_t* HWY_RESTRICT cb,
        uint8_t* HWY_RESTRICT cr, size_t n)
    {
        const D8 d8;
        const size_t N = hn::Lanes(d8);
        if (n < N) return false;
        for (size_t i = 0, last = n - N;; i = HWY_MIN(i + N, last)) {
            const uint8_t* HWY_RESTRICT in = rgba + i * 4;
            V32 y0, y1, y2, y3, cb0, cb1, cb2, cb3, cr0, cr1, cr2, cr3;
            RgbaToYcc(hn::LoadU(d8, in), y0, cb0, cr0);
            RgbaToYcc(hn::LoadU(d8, in + N), y1, cb1, cr1);
            RgbaToYcc(hn::LoadU(d8, in + N * 2), y2, cb2, cr2);
            RgbaToYcc(hn::LoadU(d8, in + N * 3), y3, cb3, cr3);
            hn::StoreU(UpperHalves(y0, y1, y2, y3), d8, y + i);
            hn::StoreU(UpperHalves(cb0, cb1, cb2, cb3), d8, cb + i);
            hn::StoreU(UpperHalves(cr0, cr1, cr2, cr3), d8, cr + i);
            if (i == last) return true;
        }
    }

    // Each of the `n` samples of `out` is the mean of 2 by 2 samples. An odd `n` is left to the caller too.
    static HWY_INLINE bool H2V2Downsample(const uint8_t* HWY_RESTRICT row0, const uint8_t* HWY_RESTRICT row1,
        uint8_t* HWY_RESTRICT out, size_t n)
    {
        const D8 d8;
        const D16 d;
        const size_t N = hn::Lanes(d8);
        if (n < N || n % 2) return false;
        // Rounding alternates between down and up, so as not to brighten or darken the image.
        const VU16 bias = hn::BitCast(DU16(), Pairs(1, 2));
        for (size_t i = 0, last = n - N;; i = HWY_MIN(i + N, last)) {
            const uint8_t *HWY_RESTRICT in0 = row0 + i * 2, *HWY_RESTRICT in1 = row1 + i * 2;
            const VU16 lower = hn::Add(hn::Add(hn::SumsOf2(hn::LoadU(d8, in0)), hn::SumsOf2(hn::LoadU(d8, in1))), bias);
            const VU16 upper = hn::Add(hn::Add(hn::SumsOf2(hn::LoadU(d8, in0 + N)), hn::SumsOf2(hn::LoadU(d8, in1 + N))), bias);
            hn::StoreU(hn::OrderedDemote2To(d8, hn::BitCast(d, hn::ShiftRight<2>(lower)), hn::BitCast(d, hn::ShiftRight<2>(upper))), d8, out + i);
            if (i == last) return true;
        }
    }

    static HWY_INLINE VU16 Triple(VU16 v)
    {
        return hn::Add(hn::Add(v, v), v);
    }

    // Whether `Promote` puts the even lanes in one vector and the odd ones in the other, which on x86 takes no shuffles.
    // Otherwise it is the lower and the upper lanes, for which Arm has instructions that widen and narrow on the way.
    static constexpr bool kEvenOdd = HWY_ARCH_X86;

    static HWY_INLINE void Promote(V8 v, VU16& a, VU16& b)
    {
        const DU16 d;
        if constexpr (kEvenOdd) {
            a = hn::PromoteEvenTo(d, v);
            b = hn::PromoteOddTo(d, v);
        } else {
            a = hn::PromoteLowerTo(d, v);
            b = hn::PromoteUpperTo(d, v);
        }
    }

    // Undoes `Promote`, of numbers under 256.
    static HWY_INLINE V8 Demote(VU16 a, VU16 b)
    {
        const D8 d8;
        if constexpr (kEvenOdd) {
            return hn::BitCast(d8, hn::Or(a, hn::ShiftLeft<8>(b)));
        } else {
            const hn::Half<D8> half;
            return hn::Combine(d8, hn::TruncateTo(half, b), hn::TruncateTo(half, a));
        }
    }

    // Makes a row twice as wide by linear interpolation: `out` gets 2 samples for each of the `n` of the row, which is
    // `near_row` (jdsample.c's h2v1_fancy_upsample) or, with `kTwoRows`, 3 times `near_row` plus `far_row` (one row of
    // h2v2_fancy_upsample).
    template<bool kTwoRows>
    static HWY_INLINE bool Fancy(const uint8_t* HWY_RESTRICT near_row, const uint8_t* HWY_RESTRICT far_row, uint8_t* HWY_RESTRICT out, size_t n)
    {
        constexpr int kShift = kTwoRows ? 4 : 2;
        // A half is rounded down for the left one of the two samples that a sample turns into, and up for the right one.
        constexpr uint16_t kBiasLeft = kTwoRows ? 8 : 1, kBiasRight = kTwoRows ? 7 : 2;
        const D8 d8;
        const DU16 d;
        const size_t N = hn::Lanes(d8);
        if (n < N + 2) return false;

        const auto load = [=](size_t i, VU16& a, VU16& b) HWY_ATTR {
            Promote(hn::LoadU(d8, near_row + i), a, b);
            if constexpr (kTwoRows) {
                VU16 far_a, far_b;
                Promote(hn::LoadU(d8, far_row + i), far_a, far_b);
                a = hn::Add(Triple(a), far_a);
                b = hn::Add(Triple(b), far_b);
            }
        };
        const VU16 bias_left = hn::Set(d, kBiasLeft), bias_right = hn::Set(d, kBiasRight);
        for (size_t i = 1, last = n - 1 - N;; i = HWY_MIN(i + N, last)) {
            VU16 at_a, at_b, before_a, before_b, after_a, after_b;
            load(i, at_a, at_b);
            load(i - 1, before_a, before_b);
            load(i + 1, after_a, after_b);
            if constexpr (kEvenOdd) {
                // Left of an odd lane is the even lane next to it, and right of that one is the odd lane.
                before_b = at_a;
                after_a = at_b;
            }
            const VU16 a3 = Triple(at_a), b3 = Triple(at_b);
            hn::StoreInterleaved2(
                Demote(hn::ShiftRight<kShift>(hn::Add(hn::Add(a3, before_a), bias_left)),
                    hn::ShiftRight<kShift>(hn::Add(hn::Add(b3, before_b), bias_left))),
                Demote(hn::ShiftRight<kShift>(hn::Add(hn::Add(a3, after_a), bias_right)),
                    hn::ShiftRight<kShift>(hn::Add(hn::Add(b3, after_b), bias_right))),
                d8, out + i * 2);
            if (i == last) break;
        }

        // Past either end the edge sample repeats.
        const auto sample = [=](size_t i) -> uint32_t { return kTwoRows ? near_row[i] * 3u + far_row[i] : near_row[i]; };
        out[0] = static_cast<uint8_t>((sample(0) * 4 + kBiasLeft) >> kShift);
        out[1] = static_cast<uint8_t>((sample(0) * 3 + sample(1) + kBiasRight) >> kShift);
        out[n * 2 - 2] = static_cast<uint8_t>((sample(n - 1) * 3 + sample(n - 2) + kBiasLeft) >> kShift);
        out[n * 2 - 1] = static_cast<uint8_t>((sample(n - 1) * 4 + kBiasRight) >> kShift);
        return true;
    }
};

using Wide = JpegRows<hn::ScalableTag<uint8_t>>;
using Narrow = JpegRows<hn::CappedTag<uint8_t, 16>>;

static bool JpegFromYccImpl(const uint8_t* y, const uint8_t* cb, const uint8_t* cr, const uint8_t* k, uint8_t* out, size_t n)
{
    return Wide::FromYcc(y, cb, cr, k, out, n) || Narrow::FromYcc(y, cb, cr, k, out, n);
}

static bool JpegToYccImpl(const uint8_t* rgba, uint8_t* y, uint8_t* cb, uint8_t* cr, size_t n)
{
    return Wide::ToYcc(rgba, y, cb, cr, n) || Narrow::ToYcc(rgba, y, cb, cr, n);
}

static bool JpegH2V2DownsampleImpl(const uint8_t* row0, const uint8_t* row1, uint8_t* out, size_t n)
{
    return Wide::H2V2Downsample(row0, row1, out, n) || Narrow::H2V2Downsample(row0, row1, out, n);
}

static bool JpegH2V1FancyImpl(const uint8_t* in, uint8_t* out, size_t n)
{
    return Wide::Fancy<false>(in, nullptr, out, n) || Narrow::Fancy<false>(in, nullptr, out, n);
}

static bool JpegH2V2FancyImpl(const uint8_t* near_row, const uint8_t* far_row, uint8_t* out, size_t n)
{
    return Wide::Fancy<true>(near_row, far_row, out, n) || Narrow::Fancy<true>(near_row, far_row, out, n);
}

} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {

HWY_EXPORT(JpegFromYccImpl);
HWY_EXPORT(JpegToYccImpl);
HWY_EXPORT(JpegH2V2DownsampleImpl);
HWY_EXPORT(JpegH2V1FancyImpl);
HWY_EXPORT(JpegH2V2FancyImpl);

// `k` may be null.
extern "C" bool highway_jpeg_from_ycc(const uint8_t* y, const uint8_t* cb, const uint8_t* cr, const uint8_t* k, uint8_t* out, size_t n)
{
    return BUN_HWY_DISPATCH(JpegFromYccImpl)(y, cb, cr, k, out, n);
}

extern "C" bool highway_jpeg_to_ycc(const uint8_t* rgba, uint8_t* y, uint8_t* cb, uint8_t* cr, size_t n)
{
    return BUN_HWY_DISPATCH(JpegToYccImpl)(rgba, y, cb, cr, n);
}

extern "C" bool highway_jpeg_h2v2_downsample(const uint8_t* row0, const uint8_t* row1, uint8_t* out, size_t n)
{
    return BUN_HWY_DISPATCH(JpegH2V2DownsampleImpl)(row0, row1, out, n);
}

extern "C" bool highway_jpeg_h2v1_fancy(const uint8_t* in, uint8_t* out, size_t n)
{
    return BUN_HWY_DISPATCH(JpegH2V1FancyImpl)(in, out, n);
}

extern "C" bool highway_jpeg_h2v2_fancy(const uint8_t* near_row, const uint8_t* far_row, uint8_t* out, size_t n)
{
    return BUN_HWY_DISPATCH(JpegH2V2FancyImpl)(near_row, far_row, out, n);
}

} // namespace bun
#endif // HWY_ONCE
