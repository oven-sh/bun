// The kernel of `ByteSet` in src/highway/lib.rs.

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

namespace bun {
static size_t LongByteSetPrefixLength(const uint8_t* text, size_t len, const uint8_t* set);
}

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

#if HWY_TARGET == HWY_STATIC_TARGET
static HWY_INLINE size_t ByteSetPrefixLengthImpl(const uint8_t* text, size_t len, const uint8_t* set)
{
    return PrefixLength<true>(hn::CappedTag<uint8_t, 16> {}, text, len, set);
}
#endif

} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {

HWY_EXPORT(LongByteSetPrefixLengthImpl);

static size_t LongByteSetPrefixLength(const uint8_t* text, size_t len, const uint8_t* set)
{
    return BUN_HWY_DISPATCH(LongByteSetPrefixLengthImpl)(text, len, set);
}

// `len` is at least 16 and `set` has 32 bytes. LTO has to inline this: a call takes as long as a short run.
extern "C" __attribute__((always_inline)) size_t highway_byte_set_prefix_length(const uint8_t* text, size_t len, const uint8_t* set)
{
    return HWY_STATIC_DISPATCH(ByteSetPrefixLengthImpl)(text, len, set);
}

} // namespace bun
#endif
