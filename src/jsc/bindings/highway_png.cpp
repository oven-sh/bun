// The scanline filters of PNG for src/png, runtime-dispatched via Google Highway.
//
// `x` is a byte of the row, `a` the byte one pixel to its left, `b` the byte above it and `c` the byte above `a`.
// Left of the row `a` and `c` are zero. A pixel has `bpp` bytes.
//
// No load or store leaves the `len` bytes of a row.

// Undoing Average and Paeth is one long chain, each pixel waiting for the one before it, and a comparison that goes
// through a mask register makes the chain half as long again. Nothing here gains much from more than 256 bits.
// So this is the list in scripts/build/deps/highway.ts and more: the rest of SVE, and whatever is newer than AVX2.
#undef HWY_DISABLED_TARGETS
#define HWY_DISABLED_TARGETS (HWY_ALL_SVE | (HWY_AVX2 - 1))

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_png.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>
#include "highway_dispatch.h"

#include <stddef.h>
#include <stdint.h>

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

// What Sub is undone for at once. ShiftLeftBytes() does not cross 16 bytes, so a wider vector would not help.
using Block = hn::FixedTag<uint8_t, 16>;
static constexpr size_t kBlock = 16;

template<size_t BPP>
struct Pixel {
    // There is no vector of 6 lanes.
    static constexpr size_t kLanes = BPP == 6 ? 8 : BPP;
    using Bytes = hn::FixedTag<uint8_t, kLanes>;
    // For sums and differences of bytes.
    using Wide = hn::FixedTag<int16_t, kLanes>;

    static HWY_INLINE hn::Vec<Bytes> Load(const uint8_t* HWY_RESTRICT from)
    {
        if constexpr (BPP == kLanes) {
            return hn::LoadU(Bytes(), from);
        } else {
            alignas(kLanes) uint8_t bytes[kLanes] = {};
            hwy::CopyBytes<BPP>(from, bytes);
            return hn::Load(Bytes(), bytes);
        }
    }

    static HWY_INLINE void Store(hn::Vec<Bytes> pixel, uint8_t* HWY_RESTRICT to)
    {
        if constexpr (BPP == kLanes) {
            hn::StoreU(pixel, Bytes(), to);
        } else {
            alignas(kLanes) uint8_t bytes[kLanes];
            hn::Store(pixel, Bytes(), bytes);
            hwy::CopyBytes<BPP>(bytes, to);
        }
    }

    static HWY_INLINE hn::Vec<Wide> LoadWide(const uint8_t* HWY_RESTRICT from)
    {
        return hn::PromoteTo(Wide(), Load(from));
    }

    // The lanes are 0 to 255.
    static HWY_INLINE void StoreWide(hn::Vec<Wide> pixel, uint8_t* HWY_RESTRICT to)
    {
        Store(hn::DemoteTo(Bytes(), pixel), to);
    }

    // The pixel in front of `row + at`.
    static HWY_INLINE hn::Vec<Bytes> LoadBefore(const uint8_t* HWY_RESTRICT row, size_t at)
    {
        return at >= BPP ? Load(row + at - BPP) : hn::Zero(Bytes());
    }
};

// row[from..to), which holds whole pixels.
template<size_t BPP>
static HWY_INLINE void SubPixels(uint8_t* HWY_RESTRICT row, size_t from, size_t to)
{
    auto a = Pixel<BPP>::LoadBefore(row, from);
    for (size_t i = from; i + BPP <= to; i += BPP) {
        a = hn::Add(a, Pixel<BPP>::Load(row + i));
        Pixel<BPP>::Store(a, row + i);
    }
}

// The pixel in front of `row + at`, as often as a block has room for it. A block holds whole pixels.
template<size_t BPP>
static HWY_INLINE hn::Vec<Block> RepeatBefore(const uint8_t* HWY_RESTRICT row, size_t at)
{
    static_assert(kBlock % BPP == 0);
    const hn::Repartition<hwy::UnsignedFromSize<BPP>, Block> pixels;
    return hn::BitCast(Block(), hn::Broadcast<0>(hn::ResizeBitCast(pixels, Pixel<BPP>::LoadBefore(row, at))));
}

// `a` is the pixel in front of `block`, repeated. Returns the last pixel of `block`, repeated.
template<size_t BPP>
static HWY_INLINE hn::Vec<Block> SubBlock(hn::Vec<Block> a, uint8_t* HWY_RESTRICT block)
{
    const Block d;
    const hn::Repartition<hwy::UnsignedFromSize<BPP>, Block> pixels;
    auto x = hn::LoadU(d, block);
    x = hn::Add(x, hn::ShiftLeftBytes<BPP>(d, x));
    if constexpr (2 * BPP < kBlock) x = hn::Add(x, hn::ShiftLeftBytes<2 * BPP>(d, x));
    if constexpr (4 * BPP < kBlock) x = hn::Add(x, hn::ShiftLeftBytes<4 * BPP>(d, x));
    if constexpr (8 * BPP < kBlock) x = hn::Add(x, hn::ShiftLeftBytes<8 * BPP>(d, x));
    x = hn::Add(x, a);
    hn::StoreU(x, d, block);
    return hn::BitCast(d, hn::Broadcast<kBlock / BPP - 1>(hn::BitCast(pixels, x)));
}

template<size_t BPP>
static void UnfilterSub(uint8_t* HWY_RESTRICT row, size_t len)
{
    size_t i = 0;
    if constexpr (kBlock % BPP == 0) {
        auto a = hn::Zero(Block());
        for (; i + kBlock <= len; i += kBlock)
            a = SubBlock<BPP>(a, row + i);
    }
    SubPixels<BPP>(row, i, len);
}

static void UnfilterUp(uint8_t* HWY_RESTRICT row, const uint8_t* HWY_RESTRICT above, size_t len)
{
    const hn::ScalableTag<uint8_t> d;
    const size_t lanes = hn::Lanes(d);
    size_t i = 0;
    for (; i + lanes <= len; i += lanes) {
        hn::StoreU(hn::Add(hn::LoadU(d, row + i), hn::LoadU(d, above + i)), d, row + i);
    }
    const size_t rest = len - i;
    hn::StoreN(hn::Add(hn::LoadN(d, row + i, rest), hn::LoadN(d, above + i, rest)), d, row + i, rest);
}

template<size_t BPP>
static void UnfilterAverage(uint8_t* HWY_RESTRICT row, const uint8_t* HWY_RESTRICT above, size_t len)
{
    auto a = hn::Zero(typename Pixel<BPP>::Bytes());
    for (size_t i = 0; i + BPP <= len; i += BPP) {
        const auto b = Pixel<BPP>::Load(above + i);
        // AverageRound() rounds up, and rounded up and rounded down add up to a + b.
        a = hn::Add(Pixel<BPP>::Load(row + i), hn::Sub(hn::Add(a, b), hn::AverageRound(a, b)));
        Pixel<BPP>::Store(a, row + i);
    }
}

// Turns the `x` at `pixel` into the next `a`. `three_c_minus_b` comes from outside so that it is not worked out on the
// way from one `a` to the next.
template<size_t BPP, class V>
static HWY_INLINE V PaethPixel(V a, V b, V c, V three_c_minus_b, uint8_t* HWY_RESTRICT pixel)
{
    const typename Pixel<BPP>::Wide d;
    const hn::Repartition<uint8_t, decltype(d)> bytes;
    // The sum of two bytes without its carry.
    const auto add = [&](V x, V y) HWY_ATTR { return hn::BitCast(d, hn::Add(hn::BitCast(bytes, x), hn::BitCast(bytes, y))); };
    const V x = Pixel<BPP>::LoadWide(pixel);
    // The one of a, b and c nearest to a + b - c, in fewer steps from `a` than by the three distances.
    // https://github.com/nothings/stb/blob/013ac3beddff3dbffafd5177e7972067cd2b5083/stb_image.h#L4657
    const V threshold = hn::Sub(three_c_minus_b, a);
    const V low = hn::Min(a, b);
    const V high = hn::Max(a, b);
    const V low_or_c = hn::IfThenElse(hn::Gt(high, threshold), add(x, c), add(x, low));
    a = hn::IfThenElse(hn::Gt(threshold, low), low_or_c, add(x, high));
    Pixel<BPP>::StoreWide(a, pixel);
    return a;
}

// row[from..to), which holds whole pixels, and at least one.
template<size_t BPP>
static HWY_INLINE void PaethPixels(uint8_t* HWY_RESTRICT row, const uint8_t* HWY_RESTRICT above, size_t from, size_t to)
{
    const typename Pixel<BPP>::Wide d;
    const auto three_c_minus_b = [&](auto b, auto c) HWY_ATTR { return hn::Sub(hn::Add(c, hn::Add(c, c)), b); };
    auto a = hn::PromoteTo(d, Pixel<BPP>::LoadBefore(row, from));
    auto c = hn::PromoteTo(d, Pixel<BPP>::LoadBefore(above, from));
    auto b = Pixel<BPP>::LoadWide(above + from);
    auto ahead = three_c_minus_b(b, c);
    size_t i = from;
    for (; i + 2 * BPP <= to; i += BPP) {
        a = PaethPixel<BPP>(a, b, c, ahead, row + i);
        c = b;
        b = Pixel<BPP>::LoadWide(above + i + BPP);
        ahead = three_c_minus_b(b, c);
    }
    PaethPixel<BPP>(a, b, c, ahead, row + i);
}

// Whether the block at `above + at` repeats the pixel in front of it.
template<size_t BPP>
static HWY_INLINE bool IsFlat(const uint8_t* HWY_RESTRICT above, size_t at, size_t len)
{
    const Block d;
    return at >= BPP && at + kBlock <= len && hn::AllTrue(d, hn::Eq(hn::LoadU(d, above + at), hn::LoadU(d, above + at - BPP)));
}

template<size_t BPP>
static void UnfilterPaeth(uint8_t* HWY_RESTRICT row, const uint8_t* HWY_RESTRICT above, size_t len)
{
    if constexpr (kBlock % BPP != 0) {
        if (len >= BPP) PaethPixels<BPP>(row, above, 0, len);
    } else {
        // From a block that is not flat to the next look, or a photo would pay for the looking.
        constexpr size_t kBusy = 4 * kBlock;
        size_t i = 0;
        while (i + BPP <= len) {
            // Where the row above repeats a pixel, b = c, so `a` is the nearest and Paeth is Sub, at a fraction of the cost.
            if (IsFlat<BPP>(above, i, len)) {
                auto a = RepeatBefore<BPP>(row, i);
                do {
                    a = SubBlock<BPP>(a, row + i);
                    i += kBlock;
                } while (IsFlat<BPP>(above, i, len));
                continue;
            }
            size_t end = i;
            do {
                end += kBusy;
            } while (end < len && !IsFlat<BPP>(above, end, len));
            end = HWY_MIN(end, len);
            PaethPixels<BPP>(row, above, i, end);
            i = end;
        }
    }
}

template<size_t BPP>
static HWY_INLINE void Unfilter(uint8_t filter_type, uint8_t* HWY_RESTRICT row, const uint8_t* HWY_RESTRICT above, size_t len)
{
    switch (filter_type) {
    case 1:
        return UnfilterSub<BPP>(row, len);
    case 2:
        return UnfilterUp(row, above, len);
    case 3:
        return UnfilterAverage<BPP>(row, above, len);
    case 4:
        return UnfilterPaeth<BPP>(row, above, len);
    default:
        return;
    }
}

void PngUnfilter(uint8_t filter_type, size_t bpp, uint8_t* HWY_RESTRICT row, const uint8_t* HWY_RESTRICT above, size_t len)
{
    switch (bpp) {
    case 1:
        return Unfilter<1>(filter_type, row, above, len);
    case 2:
        return Unfilter<2>(filter_type, row, above, len);
    case 4:
        return Unfilter<4>(filter_type, row, above, len);
    case 6:
        return Unfilter<6>(filter_type, row, above, len);
    case 8:
        return Unfilter<8>(filter_type, row, above, len);
    default:
        return;
    }
}

// How far the bytes are from zero, taken as signed, added up in lanes of 64 bits.
template<class D, class V = hn::Vec<D>>
static HWY_INLINE hn::Vec<hn::Repartition<uint64_t, D>> Distances(D d, V filtered)
{
    return hn::SumsOf8(hn::Min(filtered, hn::Sub(hn::Zero(d), filtered)));
}

// Filters a row of 4-byte pixels in the four ways there are. sums[t] is for filter type t, 0 being the row as it is.
void PngFilterRgba(const uint8_t* HWY_RESTRICT row, const uint8_t* HWY_RESTRICT above, size_t len,
    uint8_t* HWY_RESTRICT sub, uint8_t* HWY_RESTRICT up, uint8_t* HWY_RESTRICT average, uint8_t* HWY_RESTRICT paeth,
    uint64_t* HWY_RESTRICT sums)
{
    constexpr size_t kBpp = 4;
    const hn::ScalableTag<uint8_t> d;
    const hn::Repartition<uint64_t, decltype(d)> d64;
    const size_t lanes = hn::Lanes(d);
    const auto one = hn::Set(d, 1);
    auto sum_none = hn::Zero(d64), sum_sub = sum_none, sum_up = sum_none, sum_average = sum_none, sum_paeth = sum_none;

    const auto filter = [&](auto x, auto a, auto b, auto c, auto store) HWY_ATTR {
        const auto x_sub = hn::Sub(x, a);
        const auto x_up = hn::Sub(x, b);
        // AverageRound() rounds up.
        const auto x_average = hn::Sub(x, hn::Sub(hn::AverageRound(a, b), hn::And(hn::Xor(a, b), one)));
        // The distances of a + b - c from a, b and c. The last is |(a - c) + (b - c)|: their sum if c is on one side of
        // both, and then that it saturates does not matter, because it is not the least.
        const auto pa = hn::AbsDiff(b, c);
        const auto pb = hn::AbsDiff(a, c);
        const auto c_is_between = hn::Xor(hn::Eq(hn::Max(a, c), a), hn::Eq(hn::Max(b, c), b));
        const auto pc = hn::IfThenElse(c_is_between, hn::AbsDiff(pa, pb), hn::SaturatedAdd(pa, pb));
        const auto least = hn::Min(hn::Min(pa, pb), pc);
        const auto nearest = hn::IfThenElse(hn::Eq(pa, least), a, hn::IfThenElse(hn::Eq(pb, least), b, c));
        const auto x_paeth = hn::Sub(x, nearest);
        store(x_sub, sub);
        store(x_up, up);
        store(x_average, average);
        store(x_paeth, paeth);
        sum_none = hn::Add(sum_none, Distances(d, x));
        sum_sub = hn::Add(sum_sub, Distances(d, x_sub));
        sum_up = hn::Add(sum_up, Distances(d, x_up));
        sum_average = hn::Add(sum_average, Distances(d, x_average));
        sum_paeth = hn::Add(sum_paeth, Distances(d, x_paeth));
    };

    // The first pixel has nothing to its left. Lanes that are not loaded are zero, and add nothing to a sum.
    const size_t first = HWY_MIN(len, kBpp);
    filter(hn::LoadN(d, row, first), hn::Zero(d), hn::LoadN(d, above, first), hn::Zero(d),
        [&](auto filtered, uint8_t* HWY_RESTRICT to) HWY_ATTR { hn::StoreN(filtered, d, to, first); });
    size_t i = first;
    for (; i + lanes <= len; i += lanes) {
        filter(hn::LoadU(d, row + i), hn::LoadU(d, row + i - kBpp), hn::LoadU(d, above + i), hn::LoadU(d, above + i - kBpp),
            [&](auto filtered, uint8_t* HWY_RESTRICT to) HWY_ATTR { hn::StoreU(filtered, d, to + i); });
    }
    const size_t rest = len - i;
    if (rest != 0) {
        filter(hn::LoadN(d, row + i, rest), hn::LoadN(d, row + i - kBpp, rest), hn::LoadN(d, above + i, rest),
            hn::LoadN(d, above + i - kBpp, rest),
            [&](auto filtered, uint8_t* HWY_RESTRICT to) HWY_ATTR { hn::StoreN(filtered, d, to + i, rest); });
    }

    sums[0] = hn::ReduceSum(d64, sum_none);
    sums[1] = hn::ReduceSum(d64, sum_sub);
    sums[2] = hn::ReduceSum(d64, sum_up);
    sums[3] = hn::ReduceSum(d64, sum_average);
    sums[4] = hn::ReduceSum(d64, sum_paeth);
}

// NOLINTNEXTLINE(google-readability-namespace-comments)
} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {
HWY_EXPORT(PngUnfilter);
HWY_EXPORT(PngFilterRgba);

// `row` and `above` have `len` bytes. Does nothing for a `filter_type` other than 1 to 4 or a `bpp` other than 1, 2, 4, 6 and 8.
extern "C" void highway_png_unfilter(uint8_t filter_type, size_t bpp, uint8_t* row, const uint8_t* above, size_t len)
{
    BUN_HWY_DISPATCH(PngUnfilter)(filter_type, bpp, row, above, len);
}

// All six have `len` bytes, and `sums` has room for 5.
extern "C" void highway_png_filter_rgba(const uint8_t* row, const uint8_t* above, size_t len,
    uint8_t* sub, uint8_t* up, uint8_t* average, uint8_t* paeth, uint64_t* sums)
{
    BUN_HWY_DISPATCH(PngFilterRgba)(row, above, len, sub, up, average, paeth, sums);
}
} // namespace bun
#endif
