#pragma once

#include "StyleProperties.h"

namespace WebCore {

// A declaration block that no CSSOM object can change, so elements and rules may share it.
class ImmutableStyleProperties final : public StyleProperties {
    WTF_MAKE_TZONE_ALLOCATED(ImmutableStyleProperties);
public:
    static Ref<ImmutableStyleProperties> create(Vector<CSSProperty>&& properties, CSSParserMode mode)
    {
        return adoptRef(*new ImmutableStyleProperties(WTF::move(properties), mode));
    }

private:
    ImmutableStyleProperties(Vector<CSSProperty>&& properties, CSSParserMode mode)
        : StyleProperties(mode, false, WTF::move(properties))
    {
    }
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::ImmutableStyleProperties)
    static bool isType(const WebCore::StyleProperties& properties) { return !properties.isMutable(); }
SPECIALIZE_TYPE_TRAITS_END()
