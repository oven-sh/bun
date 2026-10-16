#include "config.h"
#include "CSSRule.h"

#include "ExceptionOr.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(CSSRule);

CSSRule::~CSSRule() = default;

unsigned short CSSRule::typeForCSSOM() const
{
    // "This enumeration is thus frozen in its current state, and no new new values will be
    // added to reflect additional at-rules; all at-rules beyond the ones listed above will return 0."
    // https://drafts.csswg.org/cssom/#the-cssrule-interface
    if (styleRuleType() >= firstUnexposedStyleRuleType)
        return 0;

    return std::to_underlying(styleRuleType());
}

ExceptionOr<void> CSSRule::setCssText(const String&)
{
    return { };
}

} // namespace WebCore
