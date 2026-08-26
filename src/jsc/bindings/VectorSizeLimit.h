#pragma once

#include "root.h"
#include <wtf/Vector.h>

extern "C" size_t Bun__stringSyntheticAllocationLimit;

namespace Bun {

// WTF::Vector::append CRASH()es when its 1.5x growth step asks for a capacity over
// WTF::isValidCapacityForVector<T>, which caps the buffer at INT32_MAX bytes. A
// Vector filled from user input uses these two functions to throw instead.

// The largest size a Vector<T> may reach. It follows Bun__stringSyntheticAllocationLimit
// so that tests can reach the limit with small inputs.
template<typename T>
size_t maxVectorSize()
{
    constexpr size_t maxBytes = std::numeric_limits<unsigned>::max() >> 1;
    static_assert(WTF::isValidCapacityForVector<T>(maxBytes / sizeof(T)));
    static_assert(!WTF::isValidCapacityForVector<T>(maxBytes / sizeof(T) + 1));
    return std::min(maxBytes, Bun__stringSyntheticAllocationLimit) / sizeof(T);
}

// Appends item unless the Vector already holds maxSize elements. The growth step is
// the same as Vector::expandCapacity, capped at maxSize, so the Vector never asks
// for a capacity it cannot have.
template<typename T, size_t inlineCapacity, typename OverflowHandler, size_t minCapacity, typename Malloc, typename U>
[[nodiscard]] bool appendWithinLimit(WTF::Vector<T, inlineCapacity, OverflowHandler, minCapacity, Malloc>& vector, U&& item, size_t maxSize)
{
    if (vector.size() >= maxSize) [[unlikely]]
        return false;
    if (vector.size() == vector.capacity())
        vector.reserveCapacity(std::min(maxSize, std::max(minCapacity, Malloc::nextCapacity(vector.capacity()))));
    vector.append(std::forward<U>(item));
    return true;
}

} // namespace Bun
