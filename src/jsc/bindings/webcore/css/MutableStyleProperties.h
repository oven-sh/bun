#pragma once

#include "StyleProperties.h"
#include <wtf/CheckedRef.h>

namespace WebCore {

class CSSStyleProperties;
class StyledElement;

class MutableStyleProperties final : public StyleProperties, public CanMakeCheckedPtr<MutableStyleProperties> {
    WTF_MAKE_TZONE_ALLOCATED(MutableStyleProperties);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(MutableStyleProperties);
public:
    static Ref<MutableStyleProperties> create(CSSParserMode);

    ~MutableStyleProperties();

    // What a parsed declaration list adds: a later declaration moves to the end, and does not replace an important one unless it is important too.
    bool addParsedProperties(const ParsedPropertyVector&);
    bool addParsedProperty(const CSSProperty&);

    // These expand shorthand properties into multiple properties.
    bool setProperty(CSSPropertyID, const String& value, IsImportant = IsImportant::No);

    // This does not.
    bool setProperty(const CSSProperty&);

    bool removeProperty(CSSPropertyID, String* returnText = nullptr);

    void clear();
    bool parseDeclaration(const String& styleDeclaration);

    CSSStyleProperties& ensureInlineCSSStyleProperties(StyledElement& parentElement);

    bool setCustomProperty(const String& propertyName, const String& value, IsImportant = IsImportant::No);
    bool removeCustomProperty(const String& propertyName, String* returnText = nullptr);

private:
    explicit MutableStyleProperties(CSSParserMode);
    explicit MutableStyleProperties(const StyleProperties&);

    bool removeLonghandProperty(CSSPropertyID, String* returnText);
    bool removeShorthandProperty(CSSPropertyID, String* returnText);
    bool removePropertyAtIndex(int index, String* returnText);
    bool removePropertiesOverriddenByAll();

    friend class StyleProperties;

    const std::unique_ptr<CSSStyleProperties> m_cssomWrapper;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::MutableStyleProperties)
    static bool isType(const WebCore::StyleProperties& properties) { return properties.isMutable(); }
SPECIALIZE_TYPE_TRAITS_END()
