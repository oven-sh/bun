#pragma once

#include "CSSParserMode.h"
#include "CSSProperty.h"
#include <wtf/RefCounted.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/TypeCasts.h>

namespace WebCore {

class ImmutableStyleProperties;
class MutableStyleProperties;

// A declaration block: longhands and custom properties, in the order of the CSSOM.
// Bun's CSS parser (src/css/dom) checks, expands and serializes every value before it gets here.
class StyleProperties : public RefCounted<StyleProperties> {
    WTF_MAKE_TZONE_ALLOCATED(StyleProperties);
public:
    virtual ~StyleProperties();

    unsigned propertyCount() const { return m_propertyVector.size(); }
    bool isEmpty() const { return m_propertyVector.isEmpty(); }
    const CSSProperty& propertyAt(unsigned index) const LIFETIME_BOUND { return m_propertyVector[index]; }

    const CSSProperty* begin() const LIFETIME_BOUND { return m_propertyVector.begin(); }
    const CSSProperty* end() const LIFETIME_BOUND { return m_propertyVector.end(); }

    // The empty string if the property is not declared, or is a shorthand that its longhands do not add up to.
    String getPropertyValue(CSSPropertyID) const;
    bool propertyIsImportant(CSSPropertyID) const;

    String getCustomPropertyValue(const String& propertyName) const;
    bool customPropertyIsImportant(const String& propertyName) const;

    CSSParserMode cssParserMode() const { return m_cssParserMode; }

    Ref<MutableStyleProperties> mutableCopy() const;
    Ref<ImmutableStyleProperties> immutableCopyIfNeeded() const;

    String asText() const;
    AtomString asTextAtom() const;

    bool hasCSSOMWrapper() const;
    bool isMutable() const { return m_isMutable; }

    int findPropertyIndex(CSSPropertyID) const;
    int findCustomPropertyIndex(StringView propertyName) const;

    // What the cascade takes for a longhand: its declaration, or the one of `all` if there is no other.
    const CSSProperty* findDeclarationForCascade(CSSPropertyID) const;

protected:
    StyleProperties(CSSParserMode, bool isMutable);
    StyleProperties(CSSParserMode, bool isMutable, Vector<CSSProperty>&&);

    Vector<CSSProperty> m_propertyVector;

private:
    String serializeShorthandValue(CSSPropertyID) const;
    String serializeAll() const;

    CSSParserMode m_cssParserMode;
    bool m_isMutable;
};

// `all` leaves these two alone.
inline bool isAffectedByAll(CSSPropertyID id)
{
    return id != CSSPropertyID::Direction && id != CSSPropertyID::UnicodeBidi && id != CSSPropertyID::Custom;
}

bool isCSSWideKeyword(StringView);

} // namespace WebCore
