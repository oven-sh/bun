#pragma once

#include "engine/support/HashFunctions.h"

namespace WTF {

// One hash of several values, each of which has a DefaultHash.
template<typename First, typename... Rest>
unsigned computeHash(const First& first, const Rest&... rest)
{
    unsigned result = DefaultHash<First>::hash(first);
    ((result = pairIntHash(result, DefaultHash<Rest>::hash(rest))), ...);
    return result;
}

}

using WTF::computeHash;
