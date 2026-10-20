#include "config.h"
#include "SVGRect.h"

#include "ElementInlines.h"
#include "SVGElement.h"
#include "SVGNames.h"
#include "SVGParserUtilities.h"
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringParsingBuffer.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(SVGRect);

SVGRect::SVGRect(SVGElement* contextElement, SVGPropertyAccess access)
    : m_contextElement(contextElement)
    , m_access(access)
{
}

SVGRect::~SVGRect() = default;

Ref<SVGRect> SVGRect::create()
{
    return adoptRef(*new SVGRect(nullptr, SVGPropertyAccess::ReadWrite));
}

Ref<SVGRect> SVGRect::create(SVGElement& contextElement, SVGPropertyAccess access)
{
    return adoptRef(*new SVGRect(&contextElement, access));
}

// SVGFitToViewBox::parseViewBoxGeneric() of upstream. All zeros for a value that is not valid.
static SVGRect::Value parseViewBox(StringView string)
{
    return readCharactersForParsing(string, [](auto buffer) -> SVGRect::Value {
        skipOptionalSVGSpaces(buffer);

        auto x = parseNumber(buffer);
        auto y = parseNumber(buffer);
        auto width = parseNumber(buffer);
        auto height = parseNumber(buffer, SuffixSkippingPolicy::DontSkip);

        if (!x || !y || !width || !height)
            return { };
        if (*width < 0.0 || *height < 0.0)
            return { };

        // Nothing should come after the last, fourth number.
        skipOptionalSVGSpaces(buffer);
        if (buffer.hasCharactersRemaining())
            return { };

        return { *x, *y, *width, *height };
    });
}

SVGRect::Value SVGRect::value() const
{
    if (!m_contextElement)
        return m_value;
    return parseViewBox(m_contextElement->attributeWithoutSynchronization(SVGNames::viewBoxAttr));
}

ExceptionOr<void> SVGRect::set(float Value::*member, float number)
{
    if (m_access == SVGPropertyAccess::ReadOnly)
        return Exception { ExceptionCode::NoModificationAllowedError };

    if (!m_contextElement) {
        m_value.*member = number;
        return { };
    }

    auto value = this->value();
    value.*member = number;
    m_contextElement->setAttributeWithoutSynchronization(SVGNames::viewBoxAttr, makeAtomString(value.x, ' ', value.y, ' ', value.width, ' ', value.height));
    return { };
}

}
