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

// The most elements a Deque<T> can hold before Deque::append CRASH()es: its capacity is a
// power of two within the Vector bound, and the ring keeps one slot empty.
template<typename T>
size_t maxDequeSize()
{
    return std::max<size_t>(std::bit_floor(maxVectorSize<T>()), 1) - 1;
}

} // namespace Bun
