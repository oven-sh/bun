#pragma once

#include "root.h"
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

} // namespace Bun
