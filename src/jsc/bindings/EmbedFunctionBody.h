#pragma once
#include "root.h"

namespace Bun {

struct EmbeddedFunctionBody {
    WTF::ASCIILiteral prefix;
    WTF::StringView rest;
};

// JSC only lexes "#!" as a comment at offset 0, so a body placed after a wrapper (vm.compileFunction, module._compile)
// has it rewritten to a same-length "//" comment. "//# " and "//@ " would be a sourceURL directive, which a hashbang line never is.
ALWAYS_INLINE EmbeddedFunctionBody embedFunctionBody(const WTF::String& body LIFETIME_BOUND)
{
    if (!body.startsWith("#!"_s))
        return { ""_s, body };
    WTF::StringView rest = WTF::StringView(body).substring(2);
    if (rest.startsWith(u'#') || rest.startsWith(u'@'))
        return { "// "_s, rest.substring(1) };
    return { "//"_s, rest };
}

} // namespace Bun
