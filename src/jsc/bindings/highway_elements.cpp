// The kernels of src/highway/elements.rs.

// 512-bit vectors slow down the code around them. The list is that of highway_png.cpp.
#undef HWY_DISABLED_TARGETS
#define HWY_DISABLED_TARGETS (HWY_ALL_SVE | (HWY_AVX2 - 1))

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_elements.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>
#include "highway_dispatch.h"

#include <stddef.h>
#include <stdint.h>

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

// For these two, `len` is at least the number of lanes, and is the result if nothing matches.
template<class T, class Matches>
static HWY_INLINE size_t First(const T* elements, size_t len, Matches matches)
{
    const hn::ScalableTag<T> d;
    const size_t N = hn::Lanes(d);
    HWY_DASSERT(len >= N);
    const auto at = [&](size_t index) HWY_ATTR { return matches(hn::LoadU(d, elements + index)); };
    size_t index = 0;
    for (; index + 4 * N <= len; index += 4 * N) {
        const auto any = hn::Or(hn::Or(at(index), at(index + N)), hn::Or(at(index + 2 * N), at(index + 3 * N)));
        if (HWY_UNLIKELY(!hn::AllFalse(d, any))) break;
    }
    for (; index + N <= len; index += N) {
        const intptr_t found = hn::FindFirstTrue(d, at(index));
        if (found >= 0) return index + static_cast<size_t>(found);
    }
    const intptr_t found = hn::FindFirstTrue(d, at(len - N));
    return found < 0 ? len : len - N + static_cast<size_t>(found);
}

template<class T, class Matches>
static HWY_INLINE size_t Last(const T* elements, size_t len, Matches matches)
{
    const hn::ScalableTag<T> d;
    const size_t N = hn::Lanes(d);
    HWY_DASSERT(len >= N);
    const auto at = [&](size_t index) HWY_ATTR { return matches(hn::LoadU(d, elements + index)); };
    size_t end = len;
    for (; end >= 4 * N; end -= 4 * N) {
        const auto any = hn::Or(hn::Or(at(end - N), at(end - 2 * N)), hn::Or(at(end - 3 * N), at(end - 4 * N)));
        if (HWY_UNLIKELY(!hn::AllFalse(d, any))) break;
    }
    for (; end >= N; end -= N) {
        const intptr_t found = hn::FindLastTrue(d, at(end - N));
        if (found >= 0) return end - N + static_cast<size_t>(found);
    }
    const intptr_t found = hn::FindLastTrue(d, at(0));
    return found < 0 ? len : static_cast<size_t>(found);
}

template<class T>
static HWY_INLINE auto Equals(T needle)
{
    return [needles = hn::Set(hn::ScalableTag<T> {}, needle)](auto lanes) HWY_ATTR { return hn::Eq(lanes, needles); };
}

size_t IndexOfU64Impl(const uint64_t* elements, size_t len, uint64_t needle)
{
    return First(elements, len, Equals(needle));
}

size_t LastIndexOfU64Impl(const uint64_t* elements, size_t len, uint64_t needle)
{
    return Last(elements, len, Equals(needle));
}

size_t IndexOfF64Impl(const double* elements, size_t len, double needle)
{
    return First(elements, len, Equals(needle));
}

size_t LastIndexOfF64Impl(const double* elements, size_t len, double needle)
{
    return Last(elements, len, Equals(needle));
}

size_t IndexOfNaNImpl(const double* elements, size_t len)
{
    return First(elements, len, [](auto lanes) HWY_ATTR { return hn::IsNaN(lanes); });
}

size_t IndexOfEitherU64Impl(const uint64_t* elements, size_t len, uint64_t first, uint64_t second)
{
    return First(elements, len, [a = Equals(first), b = Equals(second)](auto lanes) HWY_ATTR { return hn::Or(a(lanes), b(lanes)); });
}

size_t LastIndexOfEitherU64Impl(const uint64_t* elements, size_t len, uint64_t first, uint64_t second)
{
    return Last(elements, len, [a = Equals(first), b = Equals(second)](auto lanes) HWY_ATTR { return hn::Or(a(lanes), b(lanes)); });
}

template<class T>
static HWY_INLINE auto MaskedEquals(T mask, T needle)
{
    const hn::ScalableTag<T> d;
    return [masks = hn::Set(d, mask), needles = hn::Set(d, needle)](auto lanes) HWY_ATTR { return hn::Eq(hn::And(lanes, masks), needles); };
}

// Without the sign, the bits of a NaN are above those of infinity.
template<class T>
static HWY_INLINE auto MagnitudeAbove(T limit)
{
    const hn::ScalableTag<T> d;
    const hn::RebindToSigned<decltype(d)> di;
    using Signed = hwy::MakeSigned<T>;
    return [di, masks = hn::Set(di, hwy::LimitsMax<Signed>()), limits = hn::Set(di, static_cast<Signed>(limit))](auto lanes) HWY_ATTR {
        return hn::RebindMask(hn::ScalableTag<T> {}, hn::Gt(hn::And(hn::BitCast(di, lanes), masks), limits));
    };
}

// For these two, `len` is above the number of lanes. Negative zero is below zero, and a NaN is never in order.
template<class T>
static HWY_INLINE bool AreFloatsAscending(const T* elements, size_t len, T infinity)
{
    const hn::ScalableTag<T> d;
    const hn::RebindToSigned<decltype(d)> di;
    const auto is_nan = MagnitudeAbove(infinity);
    // The magnitudes of negative numbers run backwards.
    const auto key = [&](auto lanes) HWY_ATTR {
        const auto bits = hn::BitCast(di, lanes);
        return hn::Xor(bits, hn::BitCast(di, hn::ShiftRight<1>(hn::BitCast(d, hn::BroadcastSignBit(bits)))));
    };
    const auto descends = [&](size_t index) HWY_ATTR {
        const auto lanes = hn::LoadU(d, elements + index), next = hn::LoadU(d, elements + index + 1);
        return hn::Or(hn::RebindMask(d, hn::Gt(key(lanes), key(next))), is_nan(next));
    };
    const size_t N = hn::Lanes(d), last = len - 1 - N;
    if (!hn::AllFalse(d, is_nan(hn::LoadU(d, elements)))) return false;
    size_t index = 0;
    for (; index + N <= last; index += 2 * N) {
        if (!hn::AllFalse(d, hn::Or(descends(index), descends(index + N)))) return false;
    }
    return hn::AllFalse(d, hn::Or(descends(HWY_MIN(index, last)), descends(last)));
}

// As signed integers, once the bits of `flip` are inverted.
template<class T>
static HWY_INLINE bool AreIntegersAscending(const T* elements, size_t len, T flip)
{
    const hn::ScalableTag<T> d;
    const hn::RebindToSigned<decltype(d)> di;
    const auto flips = hn::Set(d, flip);
    const auto key = [&](size_t index) HWY_ATTR { return hn::BitCast(di, hn::Xor(hn::LoadU(d, elements + index), flips)); };
    const auto descends = [&](size_t index) HWY_ATTR { return hn::Gt(key(index), key(index + 1)); };
    const size_t N = hn::Lanes(d), last = len - 1 - N;
    size_t index = 0;
    for (; index + N <= last; index += 2 * N) {
        if (!hn::AllFalse(di, hn::Or(descends(index), descends(index + N)))) return false;
    }
    return hn::AllFalse(di, hn::Or(descends(HWY_MIN(index, last)), descends(last)));
}

// Swaps vectors from both ends. Returns how many lanes at each end are done, which leaves less than a vector.
template<class T>
static HWY_INLINE size_t ReverseEnds(T* elements, size_t len)
{
    const hn::ScalableTag<T> d;
    const size_t N = hn::Lanes(d);
    size_t done = 0;
    for (; 2 * done + N <= len; done += N) {
        const auto front = hn::LoadU(d, elements + done), back = hn::LoadU(d, elements + len - done - N);
        hn::StoreU(hn::Reverse(d, back), d, elements + done);
        hn::StoreU(hn::Reverse(d, front), d, elements + len - done - N);
    }
    return HWY_MIN(done, len / 2);
}

// `len` is at least the number of lanes.
template<class T>
static HWY_INLINE void CopyReversed(const T* source, T* target, size_t len)
{
    const hn::ScalableTag<T> d;
    const size_t N = hn::Lanes(d);
    for (size_t done = 0; done + N < len; done += N) {
        hn::StoreU(hn::Reverse(d, hn::LoadU(d, source + len - done - N)), d, target + done);
    }
    hn::StoreU(hn::Reverse(d, hn::LoadU(d, source)), d, target + len - N);
}

#define BUN_LANE_KERNELS(bits)                                                                                                          \
    size_t IndexOfMasked##bits##Impl(const uint##bits##_t* elements, size_t len, uint##bits##_t mask, uint##bits##_t needle)     \
    {                                                                                                                                    \
        return First(elements, len, MaskedEquals(mask, needle));                                                                         \
    }                                                                                                                                    \
    size_t LastIndexOfMasked##bits##Impl(const uint##bits##_t* elements, size_t len, uint##bits##_t mask, uint##bits##_t needle) \
    {                                                                                                                                    \
        return Last(elements, len, MaskedEquals(mask, needle));                                                                          \
    }                                                                                                                                    \
    size_t IndexOfMagnitudeAbove##bits##Impl(const uint##bits##_t* elements, size_t len, uint##bits##_t limit)                       \
    {                                                                                                                                    \
        return First(elements, len, MagnitudeAbove(limit));                                                                              \
    }                                                                                                                                    \
    bool AreIntegersAscending##bits##Impl(const uint##bits##_t* elements, size_t len, uint##bits##_t flip)                               \
    {                                                                                                                                    \
        return AreIntegersAscending(elements, len, flip);                                                                                \
    }                                                                                                                                    \
    bool AreFloatsAscending##bits##Impl(const uint##bits##_t* elements, size_t len, uint##bits##_t infinity)                             \
    {                                                                                                                                    \
        return AreFloatsAscending(elements, len, infinity);                                                                              \
    }                                                                                                                                    \
    size_t ReverseEnds##bits##Impl(uint##bits##_t* elements, size_t len)                                                                 \
    {                                                                                                                                    \
        return ReverseEnds(elements, len);                                                                                               \
    }                                                                                                                                    \
    void CopyReversed##bits##Impl(const uint##bits##_t* source, uint##bits##_t* target, size_t len)                                      \
    {                                                                                                                                    \
        CopyReversed(source, target, len);                                                                                               \
    }

BUN_LANE_KERNELS(8)
BUN_LANE_KERNELS(16)
BUN_LANE_KERNELS(32)
BUN_LANE_KERNELS(64)
#undef BUN_LANE_KERNELS

} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {

HWY_EXPORT(IndexOfU64Impl);
HWY_EXPORT(LastIndexOfU64Impl);
HWY_EXPORT(IndexOfF64Impl);
HWY_EXPORT(LastIndexOfF64Impl);
HWY_EXPORT(IndexOfNaNImpl);
HWY_EXPORT(IndexOfEitherU64Impl);
HWY_EXPORT(LastIndexOfEitherU64Impl);

extern "C" size_t highway_index_of_u64(const uint64_t* elements, size_t len, uint64_t needle)
{
    return BUN_HWY_DISPATCH(IndexOfU64Impl)(elements, len, needle);
}

extern "C" size_t highway_last_index_of_u64(const uint64_t* elements, size_t len, uint64_t needle)
{
    return BUN_HWY_DISPATCH(LastIndexOfU64Impl)(elements, len, needle);
}

extern "C" size_t highway_index_of_f64(const double* elements, size_t len, double needle)
{
    return BUN_HWY_DISPATCH(IndexOfF64Impl)(elements, len, needle);
}

extern "C" size_t highway_last_index_of_f64(const double* elements, size_t len, double needle)
{
    return BUN_HWY_DISPATCH(LastIndexOfF64Impl)(elements, len, needle);
}

extern "C" size_t highway_index_of_nan(const double* elements, size_t len)
{
    return BUN_HWY_DISPATCH(IndexOfNaNImpl)(elements, len);
}

extern "C" size_t highway_index_of_either_u64(const uint64_t* elements, size_t len, uint64_t first, uint64_t second)
{
    return BUN_HWY_DISPATCH(IndexOfEitherU64Impl)(elements, len, first, second);
}

extern "C" size_t highway_last_index_of_either_u64(const uint64_t* elements, size_t len, uint64_t first, uint64_t second)
{
    return BUN_HWY_DISPATCH(LastIndexOfEitherU64Impl)(elements, len, first, second);
}

#define BUN_LANE_KERNELS(bits)                                                                                                                          \
    HWY_EXPORT(IndexOfMasked##bits##Impl);                                                                                                               \
    HWY_EXPORT(LastIndexOfMasked##bits##Impl);                                                                                                           \
    HWY_EXPORT(IndexOfMagnitudeAbove##bits##Impl);                                                                                                       \
    extern "C" size_t highway_index_of_masked_##bits(const uint##bits##_t* elements, size_t len, uint##bits##_t mask, uint##bits##_t needle)      \
    {                                                                                                                                                    \
        return BUN_HWY_DISPATCH(IndexOfMasked##bits##Impl)(elements, len, mask, needle);                                                                 \
    }                                                                                                                                                    \
    extern "C" size_t highway_last_index_of_masked_##bits(const uint##bits##_t* elements, size_t len, uint##bits##_t mask, uint##bits##_t needle) \
    {                                                                                                                                                    \
        return BUN_HWY_DISPATCH(LastIndexOfMasked##bits##Impl)(elements, len, mask, needle);                                                             \
    }                                                                                                                                                    \
    extern "C" size_t highway_index_of_magnitude_above_##bits(const uint##bits##_t* elements, size_t len, uint##bits##_t limit)                       \
    {                                                                                                                                                    \
        return BUN_HWY_DISPATCH(IndexOfMagnitudeAbove##bits##Impl)(elements, len, limit);                                                                \
    }                                                                                                                                                    \
    HWY_EXPORT(AreIntegersAscending##bits##Impl);                                                                                                        \
    HWY_EXPORT(AreFloatsAscending##bits##Impl);                                                                                                          \
    HWY_EXPORT(ReverseEnds##bits##Impl);                                                                                                                 \
    HWY_EXPORT(CopyReversed##bits##Impl);                                                                                                                \
    extern "C" bool highway_are_integers_ascending_##bits(const uint##bits##_t* elements, size_t len, uint##bits##_t flip)                               \
    {                                                                                                                                                    \
        return BUN_HWY_DISPATCH(AreIntegersAscending##bits##Impl)(elements, len, flip);                                                                  \
    }                                                                                                                                                    \
    extern "C" bool highway_are_floats_ascending_##bits(const uint##bits##_t* elements, size_t len, uint##bits##_t infinity)                             \
    {                                                                                                                                                    \
        return BUN_HWY_DISPATCH(AreFloatsAscending##bits##Impl)(elements, len, infinity);                                                                \
    }                                                                                                                                                    \
    extern "C" size_t highway_reverse_ends_##bits(uint##bits##_t* elements, size_t len)                                                                  \
    {                                                                                                                                                    \
        return BUN_HWY_DISPATCH(ReverseEnds##bits##Impl)(elements, len);                                                                                 \
    }                                                                                                                                                    \
    extern "C" void highway_copy_reversed_##bits(const uint##bits##_t* source, uint##bits##_t* target, size_t len)                                       \
    {                                                                                                                                                    \
        BUN_HWY_DISPATCH(CopyReversed##bits##Impl)(source, target, len);                                                                                 \
    }

BUN_LANE_KERNELS(8)
BUN_LANE_KERNELS(16)
BUN_LANE_KERNELS(32)
BUN_LANE_KERNELS(64)
#undef BUN_LANE_KERNELS

} // namespace bun
#endif
