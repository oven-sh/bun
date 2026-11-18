#pragma once

#include "engine/support/StdLibExtras.h"

#include <algorithm>
#include <bit>
#include <cmath>
#include <limits>

namespace WTF {

// NaN gives the minimum.
template<std::integral Target, std::floating_point Source>
constexpr Target clampTo(Source value, Target min = std::numeric_limits<Target>::min(), Target max = std::numeric_limits<Target>::max())
{
    if (value >= static_cast<Source>(max))
        return max;
    if (!(value > static_cast<Source>(min)))
        return min;
    return static_cast<Target>(value);
}

template<std::integral T>
constexpr bool hasOneBitSet(T value)
{
    return std::has_single_bit(static_cast<std::make_unsigned_t<T>>(value));
}

constexpr auto roundUpToPowerOfTwo(std::unsigned_integral auto value)
{
    return std::bit_ceil(value);
}

// The divisor is a power of two.
template<std::integral T>
constexpr T roundUpToMultipleOf(size_t divisor, T value)
{
    ASSERT(hasOneBitSet(divisor));
    T mask = static_cast<T>(divisor) - 1;
    return (value + mask) & ~mask;
}

template<size_t divisor>
constexpr size_t roundUpToMultipleOf(size_t value)
{
    static_assert(hasOneBitSet(divisor));
    return roundUpToMultipleOf(divisor, value);
}

// The integral part modulo 2^64. Zero for what is not finite.
inline void doubleToInteger(double number, unsigned long long& result)
{
    if (!std::isfinite(number)) {
        result = 0;
        return;
    }
    auto magnitude = static_cast<unsigned long long>(std::fmod(std::trunc(std::abs(number)), 0x1p64));
    result = number < 0 ? -magnitude : magnitude;
}

// What is out of range gives what the instruction gives, where a cast would be undefined.
ALWAYS_INLINE int64_t truncateDoubleToInt64(double number)
{
#if CPU(X86_64)
    using Doubles = double __attribute__((vector_size(16)));
    return __builtin_ia32_cvttsd2si64(Doubles { number, 0 });
#else
    int64_t result;
    asm("fcvtzs %x0, %d1" : "=r"(result) : "w"(number));
    return result;
#endif
}

ALWAYS_INLINE uint64_t truncateDoubleToUint64(double number)
{
#if CPU(X86_64)
    // The upper half of the range is out of range for the instruction, which then sets the sign bit alone.
    int64_t lower = truncateDoubleToInt64(number);
    int64_t upper = truncateDoubleToInt64(number - 0x1p63);
    return lower | (upper & lower >> 63);
#else
    uint64_t result;
    asm("fcvtzu %x0, %d1" : "=r"(result) : "w"(number));
    return result;
#endif
}

}

using WTF::clampTo;
using WTF::doubleToInteger;
using WTF::hasOneBitSet;
using WTF::roundUpToMultipleOf;
using WTF::roundUpToPowerOfTwo;
using WTF::truncateDoubleToInt64;
using WTF::truncateDoubleToUint64;
