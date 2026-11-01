#pragma once

#include "root.h"
#include <wtf/text/StringImpl.h>

extern "C" size_t Bun__stringSyntheticAllocationLimit;

namespace Bun {

// True if a string of this length can't be allocated. Tests can lower the bound with the synthetic limit.
inline bool exceedsStringLimit(size_t length)
{
    return length > Bun__stringSyntheticAllocationLimit || length > WTF::StringImpl::MaxLength;
}

// A StringBuilder doubles its reserved capacity at the first 16-bit character, so cap it at half the max 16-bit string length.
inline unsigned cappedStringBuilderReserve(size_t length)
{
    constexpr size_t max16BitLength = (std::numeric_limits<unsigned>::max() - sizeof(WTF::StringImpl)) / sizeof(char16_t);
    static_assert(WTF::StringImpl::isValidLength<char16_t>(max16BitLength));
    static_assert(!WTF::StringImpl::isValidLength<char16_t>(max16BitLength + 1));
    return static_cast<unsigned>(std::min(length, max16BitLength / 2));
}

} // namespace Bun
