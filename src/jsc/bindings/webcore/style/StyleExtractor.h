#pragma once

#include "CSSPropertyNames.h"
#include "StyleRule.h"
#include <wtf/text/AtomString.h>

namespace WebCore {

class CSSProperty;
class Element;

namespace Style {

// Answers getComputedStyle(). There is no style resolution: every question runs the cascade for one property of one element,
// over the user agent's defaults, the style sheets of the element's tree and the inline style, and walks up only for inherited properties.
// Nothing is kept between two questions.
class Extractor {
public:
    Extractor(const Element& element, PseudoElementType pseudoElement)
        : m_element(element)
        , m_pseudoElement(pseudoElement)
    {
    }

    String propertyValueSerialization(CSSPropertyID) const;
    // Null if the property has no value.
    String customPropertyValueSerialization(const AtomString& name) const;

    // The custom properties that have a value, the element's own first.
    Vector<AtomString> customPropertyNames() const;

private:
    const Element& m_element;
    PseudoElementType m_pseudoElement;
};

} // namespace Style
} // namespace WebCore
