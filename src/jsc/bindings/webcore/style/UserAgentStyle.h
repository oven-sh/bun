#pragma once

#include "CSSPropertyNames.h"
#include "StyleRule.h"

namespace WebCore {

class Element;

namespace Style {

// The user agent style sheet, https://html.spec.whatwg.org/multipage/rendering.html, as far as tests read it.
// It is code and not a sheet, so that `display` of a <div> costs a switch and no selector matching.
class UserAgentStyle {
public:
    // Null if the sheet says nothing.
    static ASCIILiteral value(const Element&, PseudoElementType, CSSPropertyID);
};

} // namespace Style
} // namespace WebCore
