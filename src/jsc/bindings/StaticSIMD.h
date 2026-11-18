#pragma once

// Vectors of 128 bits, which every processor has, for loops that are too short for a dispatch.
// Not for a file that includes <hwy/foreach_target.h>.

#include <hwy/highway.h>
#include <optional>

namespace Bun::SIMD {

namespace hn = hwy::HWY_NAMESPACE;

template<typename Lane> using Vector = hn::Vec128<Lane>;
template<typename Lane> using Mask = hn::Mask128<Lane>;
template<typename Lane> inline constexpr size_t stride = 16 / sizeof(Lane);

template<typename Lane> HWY_INLINE Vector<Lane> splat(Lane value) { return hn::Set(hn::Full128<Lane> {}, value); }
template<typename Lane> HWY_INLINE Vector<Lane> load(const Lane* address) { return hn::LoadU(hn::Full128<Lane> {}, address); }

template<typename Lane> HWY_INLINE Vector<Lane> sub(Vector<Lane> a, Vector<Lane> b) { return hn::Sub(a, b); }
template<typename Lane> HWY_INLINE Vector<Lane> bitAnd(Vector<Lane> a, Vector<Lane> b) { return hn::And(a, b); }

template<typename Lane> HWY_INLINE Mask<Lane> equal(Vector<Lane> a, Vector<Lane> b) { return hn::Eq(a, b); }
template<typename Lane> HWY_INLINE Mask<Lane> greaterThan(Vector<Lane> a, Vector<Lane> b) { return hn::Gt(a, b); }
template<typename Lane> HWY_INLINE Mask<Lane> lessThanOrEqual(Vector<Lane> a, Vector<Lane> b) { return hn::Le(a, b); }

template<typename Lane> HWY_INLINE Mask<Lane> bitOr(Mask<Lane> first, auto... others)
{
    ((first = hn::Or(first, others)), ...);
    return first;
}

// To any of the values.
template<auto... values, typename Lane> HWY_INLINE Mask<Lane> equal(Vector<Lane> input) { return bitOr(equal(input, splat<Lane>(static_cast<Lane>(values)))...); }

template<typename Lane> HWY_INLINE bool isNonZero(Mask<Lane> mask) { return !hn::AllFalse(hn::Full128<Lane> {}, mask); }

template<typename Lane> HWY_INLINE std::optional<uint8_t> findFirstNonZeroIndex(Mask<Lane> mask)
{
    if (!isNonZero(mask))
        return std::nullopt;
    return hn::FindKnownFirstTrue(hn::Full128<Lane> {}, mask);
}

}
