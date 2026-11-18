// The kernels of src/zlib, runtime-dispatched via Google Highway. src/highway/zlib.rs says what each takes.

// The list of highway_webp_decoder.cpp: with 256 bits the cache sets the pace.
#undef HWY_DISABLED_TARGETS
#define HWY_DISABLED_TARGETS (HWY_ALL_SVE | HWY_NEON | HWY_NEON_BF16 | HWY_SSE4 | (HWY_AVX2 - 1))
#ifndef __OPTIMIZE__
#error "Unless hwy::ChosenTarget::GetIndex() is inlined, the linker may keep that of a file with other targets."
#endif

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_zlib.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>
#include "highway_dispatch.h"

#include <stddef.h>
#include <stdint.h>

#ifndef BUN_ZLIB_TABLES
#define BUN_ZLIB_TABLES
namespace bun {

// For each period up to 16, where in it each of 32 bytes is, and how many bytes the whole periods take.
struct Periods {
    alignas(16) uint8_t indices[17][32];
    uint8_t steps[17];
};
[[maybe_unused]] static constexpr Periods periods = [] {
    Periods table {};
    for (size_t period = 1; period <= 16; period++) {
        for (size_t i = 0; i < 32; i++)
            table.indices[period][i] = i % period;
        table.steps[period] = 32 - 32 % period;
    }
    return table;
}();

} // namespace bun
#endif

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

void SubtractSaturating(uint16_t* HWY_RESTRICT values, size_t groups, uint16_t amount)
{
    const hn::ScalableTag<uint16_t> d;
    const auto subtrahend = hn::Set(d, amount);
    for (; groups != 0; groups--, values += 64) {
        for (size_t i = 0; i < 64; i += hn::MaxLanes(d))
            hn::StoreU(hn::SaturatedSub(hn::LoadU(d, values + i), subtrahend), d, values + i);
    }
}

#if HWY_TARGET == HWY_STATIC_TARGET
static HWY_INLINE void Repeat(const uint8_t* from, uint8_t* to, size_t period, size_t len)
{
    const hn::Full128<uint8_t> d;
    auto first = hn::Undefined(d), second = hn::Undefined(d);
    size_t second_at = 16, step = period;
    if (period == 1) {
        // A byte is sure to come from one store, and so without delay.
        first = second = hn::Set(d, *from);
        step = 32;
    } else if (period <= 16) {
        const auto bytes = hn::LoadU(d, from);
        first = hn::TableLookupBytes(bytes, hn::Load(d, periods.indices[period]));
        second = hn::TableLookupBytes(bytes, hn::Load(d, periods.indices[period] + 16));
        step = periods.steps[period];
    } else {
        second_at = period - 16;
        first = hn::LoadU(d, from);
        second = hn::LoadU(d, from + second_at);
    }
    const uint8_t* end = to + len;
    HWY_UNROLL(1)
    do {
        hn::StoreU(first, d, to);
        hn::StoreU(second, d, to + second_at);
        to += step;
    } while (to < end);
}
#endif

// NOLINTNEXTLINE(google-readability-namespace-comments)
} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {
HWY_EXPORT(SubtractSaturating);

// `period` is 1 to 31. Reads so many bytes or 16, then writes up to `len + 31`. Not dispatched, so that LTO inlines it.
extern "C" HWY_ATTR void highway_repeat(const uint8_t* from, uint8_t* to, size_t period, size_t len)
{
    HWY_STATIC_DISPATCH(Repeat)(from, to, period, len);
}

// A group has 64 values.
extern "C" void highway_subtract_saturating(uint16_t* values, size_t groups, uint16_t amount)
{
    BUN_HWY_DISPATCH(SubtractSaturating)(values, groups, amount);
}
} // namespace bun
#endif
