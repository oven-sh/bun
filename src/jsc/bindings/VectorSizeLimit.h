#pragma once

#include "root.h"
#include <bit>
#include <wtf/Vector.h>

extern "C" size_t Bun__stringSyntheticAllocationLimit;

namespace Bun {

// The most elements a Vector<T> can hold, lowered by Bun__stringSyntheticAllocationLimit so tests reach it cheaply.
template<typename T>
size_t maxVectorSize()
{
    constexpr size_t maxBytes = std::numeric_limits<unsigned>::max() >> 1;
    static_assert(WTF::isValidCapacityForVector<T>(maxBytes / sizeof(T)));
    static_assert(!WTF::isValidCapacityForVector<T>(maxBytes / sizeof(T) + 1));
    return std::min(maxBytes, Bun__stringSyntheticAllocationLimit) / sizeof(T);
}

// A Deque's capacity is a power of two within the Vector bound, and the ring keeps one slot empty.
template<typename T>
size_t maxDequeSize()
{
    return std::max<size_t>(std::bit_floor(maxVectorSize<T>()), 1) - 1;
}

// Fallible append and reserve for a Vector that script sizes. False when the request passes maxVectorSize or the allocation fails, and the caller throws.
template<typename T, size_t inlineCapacity, typename OverflowHandler, size_t minCapacity, typename Malloc, typename U>
bool tryAppendWithinLimit(WTF::Vector<T, inlineCapacity, OverflowHandler, minCapacity, Malloc>& vector, U&& value)
{
    return vector.size() < maxVectorSize<T>() && vector.tryAppend(std::forward<U>(value));
}

template<typename T, size_t inlineCapacity, typename OverflowHandler, size_t minCapacity, typename Malloc>
bool tryReserveCapacityWithinLimit(WTF::Vector<T, inlineCapacity, OverflowHandler, minCapacity, Malloc>& vector, size_t capacity)
{
    return capacity <= maxVectorSize<T>() && vector.tryReserveCapacity(capacity);
}

} // namespace Bun
