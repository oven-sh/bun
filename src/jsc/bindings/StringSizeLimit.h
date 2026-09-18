#pragma once

#include "root.h"
#include <wtf/text/StringImpl.h>

extern "C" size_t Bun__stringSyntheticAllocationLimit;

namespace Bun {

// A string this long cannot be built. The synthetic limit lets tests lower the bound.
inline bool exceedsStringLimit(size_t length)
{
    return length > Bun__stringSyntheticAllocationLimit || length > WTF::StringImpl::MaxLength;
}

// Half of the longest 16-bit string: the first 16-bit character doubles the reserve (oven-sh/WebKit#631).
inline unsigned cappedStringBuilderReserve(size_t length)
{
    constexpr size_t max16BitLength = (std::numeric_limits<unsigned>::max() - sizeof(WTF::StringImpl)) / sizeof(char16_t);
    static_assert(WTF::StringImpl::isValidLength<char16_t>(max16BitLength));
    static_assert(!WTF::StringImpl::isValidLength<char16_t>(max16BitLength + 1));
    return static_cast<unsigned>(std::min(length, max16BitLength / 2));
}

} // namespace Bun
