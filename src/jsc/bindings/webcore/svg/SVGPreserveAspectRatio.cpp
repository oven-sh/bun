#include "config.h"
#include "SVGPreserveAspectRatio.h"

#include "ElementInlines.h"
#include "SVGElement.h"
#include "SVGNames.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(SVGPreserveAspectRatio);

SVGPreserveAspectRatio::SVGPreserveAspectRatio(SVGElement& contextElement, SVGPropertyAccess access)
    : m_contextElement(contextElement)
    , m_access(access)
{
}

SVGPreserveAspectRatio::~SVGPreserveAspectRatio() = default;

Ref<SVGPreserveAspectRatio> SVGPreserveAspectRatio::create(SVGElement& contextElement, SVGPropertyAccess access)
{
    return adoptRef(*new SVGPreserveAspectRatio(contextElement, access));
}

SVGPreserveAspectRatioValue SVGPreserveAspectRatio::value() const
{
    return SVGPreserveAspectRatioValue { m_contextElement->attributeWithoutSynchronization(SVGNames::preserveAspectRatioAttr) };
}

ExceptionOr<void> SVGPreserveAspectRatio::set(ExceptionOr<void> (SVGPreserveAspectRatioValue::*setter)(unsigned short), unsigned short number)
{
    if (m_access == SVGPropertyAccess::ReadOnly)
        return Exception { ExceptionCode::NoModificationAllowedError };

    auto value = this->value();
    auto result = (value.*setter)(number);
    if (result.hasException())
        return result;

    m_contextElement->setAttributeWithoutSynchronization(SVGNames::preserveAspectRatioAttr, AtomString { value.valueAsString() });
    return result;
}

} // namespace WebCore
