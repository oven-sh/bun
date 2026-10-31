#pragma once
#include "root.h"

namespace Bun {

struct EmbeddedFunctionBody {
    WTF::ASCIILiteral prefix;
    WTF::StringView rest;
};

// JSC only lexes "#!" as a comment at offset 0; a body placed after a wrapper gets it rewritten to a same-length "//" comment.
ALWAYS_INLINE EmbeddedFunctionBody embedFunctionBody(const WTF::String& body LIFETIME_BOUND)
{
    if (!body.startsWith("#!"_s))
        return { ""_s, body };
    WTF::StringView rest = WTF::StringView(body).substring(2);
    // "//# " and "//@ " would be a sourceURL directive; a hashbang line never is.
    if (rest.startsWith(u'#') || rest.startsWith(u'@'))
        return { "// "_s, rest.substring(1) };
    return { "//"_s, rest };
}

} // namespace Bun
