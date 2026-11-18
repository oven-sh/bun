// The kernels of `ByteSet` in src/highway/lib.rs, and those of src/highway/url.rs.

// Few runs are long, and 512-bit vectors slow down the code around them. The list is that of highway_png.cpp.
#undef HWY_DISABLED_TARGETS
#define HWY_DISABLED_TARGETS (HWY_ALL_SVE | (HWY_AVX2 - 1))

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_byte_set.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>
#include "highway_dispatch.h"

#include <stddef.h>
#include <stdint.h>

#ifndef BUN_HIGHWAY_BYTE_SET_SHARED
#define BUN_HIGHWAY_BYTE_SET_SHARED
namespace bun {
static size_t LongByteSetPrefixLength(const uint8_t* text, size_t len, const uint8_t* set);

struct UrlBlock {
    size_t end;
    uint64_t stops;
};
}
#endif

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

// How far the target that the build is compiled for looks, without a call through the table.
static constexpr size_t kShort = 64;

template<class D>
static HWY_INLINE hn::Mask<D> IsOutside(D d, const uint8_t* at, hn::Vec<D> rows, hn::Vec<D> columns)
{
    const auto bytes = hn::LoadU(d, at);
    const auto row = hn::TableLookupBytes(rows, hn::ShiftRight<4>(bytes));
    const auto column = hn::TableLookupBytes(columns, hn::And(bytes, hn::Set(d, uint8_t { 15 })));
    return hn::Eq(hn::And(row, column), hn::Zero(d));
}

template<bool is_short, class D>
static HWY_INLINE size_t PrefixLength(D d, const uint8_t* text, size_t len, const uint8_t* set)
{
    const size_t N = hn::Lanes(d);
    HWY_DASSERT(len >= N);
    const auto rows = hn::LoadDup128(d, set);
    const auto columns = hn::LoadDup128(d, set + 16);
    for (size_t at = is_short ? 0 : kShort; at + N <= len; at += N) {
        if (is_short && at == kShort) return LongByteSetPrefixLength(text, len, set);
        const auto outside = IsOutside(d, text + at, rows, columns);
        if (!hn::AllFalse(d, outside)) return at + hn::FindKnownFirstTrue(d, outside);
    }
    // It ends with the text, so it overlaps the one before it.
    const intptr_t found = hn::FindFirstTrue(d, IsOutside(d, text + len - N, rows, columns));
    return found < 0 ? len : len - N + static_cast<size_t>(found);
}

size_t LongByteSetPrefixLengthImpl(const uint8_t* text, size_t len, const uint8_t* set)
{
    return PrefixLength<false>(hn::CappedTag<uint8_t, 32> {}, text, len, set);
}

using D16 = hn::Full128<uint8_t>;

// A byte is plain if its row and its column share a bit. The lowest bit does not count behind a '.' or a '/'.
template<class D>
static HWY_INLINE uint64_t UrlStops(D d, hn::Vec<D> bytes, hn::Vec<D> before, const uint8_t* set)
{
    const hn::RebindToSigned<D> di;
    const auto row = hn::TableLookupBytes(hn::LoadDup128(d, set), hn::ShiftRight<4>(bytes));
    const auto column = hn::TableLookupBytes(hn::LoadDup128(d, set + 16), hn::And(bytes, hn::Set(d, uint8_t { 15 })));
    // '.' is '/' without its lowest bit, and a mask is -1.
    const auto is_leading = hn::Eq(hn::Or(before, hn::Set(d, uint8_t { 1 })), hn::Set(d, uint8_t { '/' }));
    const auto shared = hn::Add(hn::And(row, column), hn::VecFromMask(d, is_leading));
    return hn::BitsFromMask(di, hn::Lt(hn::BitCast(di, shared), hn::Set(di, int8_t { 1 })));
}

// `len` is above `at` and above the size of a vector. It decides no branch: the vectors that would pass the end of
// the text stop there and overlap.
template<size_t count, class D>
static HWY_INLINE uint64_t UrlStopsAt(D d, const uint8_t* text, size_t len, size_t at, const uint8_t* set)
{
    constexpr size_t N = hn::MaxLanes(D {});
    const size_t last = len - N;
    const size_t start = HWY_MIN(at, last);
    const auto first = hn::LoadU(d, text + start);
    uint64_t stops = UrlStops(d, first, at == 0 ? hn::Slide1Up(d, first) : hn::LoadU(d, text + start - 1), set);
    HWY_UNROLL(4)
    for (size_t step = N; step < count; step += N) {
        // `start + offset` is not 0, because `last` is not.
        const size_t offset = HWY_MIN(step, last - start);
        stops |= UrlStops(d, hn::LoadU(d, text + start + offset), hn::LoadU(d, text + start + offset - 1), set) << offset;
    }
    return stops >> (at - start);
}

UrlBlock NextUrlBlockImpl(const uint8_t* text, size_t len, size_t at, const uint8_t* set)
{
    const hn::CappedTag<uint8_t, 32> d;
    if (len <= 32) return { at + 64, UrlStopsAt<32>(D16 {}, text, len, at, set) };
    while (true) {
        const uint64_t stops = UrlStopsAt<64>(d, text, len, at, set);
        at += 64;
        if (stops != 0 || at >= len) return { at, stops };
    }
}

#if HWY_TARGET == HWY_STATIC_TARGET
static HWY_INLINE size_t ByteSetPrefixLengthImpl(const uint8_t* text, size_t len, const uint8_t* set)
{
    return PrefixLength<true>(hn::CappedTag<uint8_t, 16> {}, text, len, set);
}

static HWY_INLINE uint64_t UrlStopsOfWords(uint64_t low, uint64_t high, const uint8_t* set)
{
    const D16 d;
    const auto bytes = hn::BitCast(d, hn::Dup128VecFromValues(hn::Full128<uint64_t> {}, low, high));
    return UrlStops(d, bytes, hn::ShiftLeftBytes<1>(d, bytes), set);
}

static HWY_INLINE bool NarrowToLatin1(const uint16_t* units, size_t len, uint8_t* out)
{
    const D16 d;
    const hn::Repartition<int16_t, D16> d16;
    const auto* in = reinterpret_cast<const int16_t*>(units);
    auto all = hn::Zero(d16);
    const auto narrow = [&](size_t at) HWY_ATTR {
        const auto low = hn::LoadU(d16, in + at);
        const auto high = hn::LoadU(d16, in + at + 8);
        all = hn::Or3(all, low, high);
        hn::StoreU(hn::OrderedDemote2To(d, low, high), d, out + at);
    };
    for (size_t at = 0; at + 16 < len; at += 16)
        narrow(at);
    narrow(len - 16);
    return hn::AllTrue(d16, hn::Eq(hn::ShiftRight<8>(all), hn::Zero(d16)));
}
#endif

} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {

HWY_EXPORT(LongByteSetPrefixLengthImpl);
HWY_EXPORT(NextUrlBlockImpl);

static size_t LongByteSetPrefixLength(const uint8_t* text, size_t len, const uint8_t* set)
{
    return BUN_HWY_DISPATCH(LongByteSetPrefixLengthImpl)(text, len, set);
}

// `len` is at least 16 and `set` has 32 bytes. LTO has to inline this: a call takes as long as a short run.
extern "C" __attribute__((always_inline)) size_t highway_byte_set_prefix_length(const uint8_t* text, size_t len, const uint8_t* set)
{
    return HWY_STATIC_DISPATCH(ByteSetPrefixLengthImpl)(text, len, set);
}

// For these three, `len` is at least 17 and above `at`.
extern "C" __attribute__((always_inline)) uint64_t highway_url_stops_32(const uint8_t* text, size_t len, size_t at, const uint8_t* set)
{
    return HWY_STATIC_DISPATCH(UrlStopsAt)<32>(HWY_STATIC_DISPATCH(D16) {}, text, len, at, set);
}

extern "C" __attribute__((always_inline)) uint64_t highway_url_stops_64(const uint8_t* text, size_t len, size_t at, const uint8_t* set)
{
    return HWY_STATIC_DISPATCH(UrlStopsAt)<64>(HWY_STATIC_DISPATCH(D16) {}, text, len, at, set);
}

extern "C" __attribute__((always_inline)) UrlBlock highway_url_next_block(const uint8_t* text, size_t len, size_t at, const uint8_t* set)
{
    return BUN_HWY_DISPATCH(NextUrlBlockImpl)(text, len, at, set);
}

extern "C" __attribute__((always_inline)) uint64_t highway_url_stops_of_words(uint64_t low, uint64_t high, const uint8_t* set)
{
    return HWY_STATIC_DISPATCH(UrlStopsOfWords)(low, high, set);
}

// `len` is at least 16.
extern "C" __attribute__((always_inline)) bool highway_narrow_to_latin1(const uint16_t* units, size_t len, uint8_t* out)
{
    return HWY_STATIC_DISPATCH(NarrowToLatin1)(units, len, out);
}

} // namespace bun
#endif
