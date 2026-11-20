#pragma once

#include "root.h"

#include <JavaScriptCore/RegExp.h>

namespace Bun {

// new RegExp("a/b") keeps the text "a/b" and /a\/b/ keeps "a\/b". Both have the source "a\/b".
inline bool regExpsHaveSameSourceAndFlags(JSC::RegExp* a, JSC::RegExp* b)
{
    if (a == b)
        return true;
    if (a->flags() != b->flags())
        return false;
    if (a->pattern() == b->pattern())
        return true;
    return a->escapedPattern() == b->escapedPattern();
}

} // namespace Bun
