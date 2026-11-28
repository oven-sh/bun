// The kernel of src/zlib, written with Google Highway. src/highway/zlib.rs says what it takes.

#include <hwy/highway.h>

#include <stddef.h>
#include <stdint.h>

namespace bun {

// For each period up to 16, where in it each of 32 bytes is, and how many bytes the whole periods take.
struct Periods {
    alignas(16) uint8_t indices[17][32];
    uint8_t steps[17];
};
static constexpr Periods periods = [] {
    Periods table {};
    for (size_t period = 1; period <= 16; period++) {
        for (size_t i = 0; i < 32; i++)
            table.indices[period][i] = i % period;
        table.steps[period] = 32 - 32 % period;
    }
    return table;
}();

} // namespace bun

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

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

// NOLINTNEXTLINE(google-readability-namespace-comments)
} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

namespace bun {
// `period` is 1 to 31. Reads so many bytes or 16, then writes up to `len + 31`. Not dispatched, so that LTO inlines it.
extern "C" HWY_ATTR void highway_repeat(const uint8_t* from, uint8_t* to, size_t period, size_t len)
{
    HWY_STATIC_DISPATCH(Repeat)(from, to, period, len);
}
} // namespace bun
