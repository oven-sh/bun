#pragma once

#include "engine/support/Assertions.h"
#include "engine/support/Atomics.h"

namespace WTF {

// Zero if they are equal. How long it takes depends on the size alone.
inline int constantTimeMemcmp(std::span<const uint8_t> a, std::span<const uint8_t> b)
{
    RELEASE_ASSERT(a.size() == b.size());
    uint8_t difference = 0;
    for (size_t i = 0; i < a.size(); ++i)
        difference = opaque<uint8_t>(difference | (a[i] ^ b[i]));
    return difference;
}

}

using WTF::constantTimeMemcmp;
