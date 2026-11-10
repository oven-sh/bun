#pragma once

#include "root.h"
#include <JavaScriptCore/RegExp.h>
#include <algorithm>
#include <wtf/text/StringView.h>

namespace Bun {

NEVER_INLINE inline bool regExpSourcesEqual(const JSC::RegExp* a, const JSC::RegExp* b)
{
    // JSC's escapePattern (RegExp.cpp) makes `source` from the pattern text one unit at a time: `/` becomes `\/`
    // unless it is escaped or in a class, a line terminator becomes `\n`, `\r`, `\u2028` or `\u2029` (without
    // the backslash if the text has one before it), and every other unit is copied. So from the first unit where
    // two texts differ, their sources differ too, unless what one unit becomes starts with the other unit.
    auto rewriteCanStartWith = [](char16_t unit, char16_t other) {
        switch (unit) {
        case '/':
            return other == '\\';
        case '\n':
            return other == '\\' || other == 'n';
        case '\r':
            return other == '\\' || other == 'r';
        case 0x2028:
        case 0x2029:
            return other == '\\' || other == 'u';
        default:
            return false;
        }
    };

    StringView left = a->pattern();
    StringView right = b->pattern();
    unsigned shared = std::min(left.length(), right.length());
    unsigned index = 0;
    if (left.is8Bit() && right.is8Bit()) {
        // Eight units at a time while none of them differs.
        auto leftUnits = left.span8();
        auto rightUnits = right.span8();
        while (shared - index >= 8 && equalSpans(leftUnits.subspan(index, 8), rightUnits.subspan(index, 8)))
            index += 8;
    }
    while (index < shared && left[index] == right[index])
        index++;

    bool equal;
    if (index < shared) {
        equal = (rewriteCanStartWith(left[index], right[index]) || rewriteCanStartWith(right[index], left[index]))
            && a->escapedPattern() == b->escapedPattern();
    } else if (left.length() == right.length()) {
        equal = true;
    } else {
        // One text starts the other. Only the empty text is not copied: its `source` is `(?:)`.
        equal = !shared && (left.isEmpty() ? right : left) == "(?:)"_s;
    }
    ASSERT(equal == (a->escapedPattern() == b->escapedPattern()));
    return equal;
}

// Whether `source` and `flags` are equal, as the built-in getters read them from the internal slots. Runs no JS.
// The pattern text is not the `source`: `new RegExp("/")` and `/\//` hold two texts and have one `source`.
ALWAYS_INLINE bool regExpSourceAndFlagsEqual(const JSC::RegExp* a, const JSC::RegExp* b)
{
    if (a == b)
        return true;
    return a->flags() == b->flags() && regExpSourcesEqual(a, b);
}

} // namespace Bun
