#include "config.h"
#include "MutableStyleProperties.h"

#include "CSSParser.h"
#include "CSSStyleProperties.h"
#include "StyledElement.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(MutableStyleProperties);

MutableStyleProperties::MutableStyleProperties(CSSParserMode mode)
    : StyleProperties(mode, true)
{
}

MutableStyleProperties::MutableStyleProperties(const StyleProperties& other)
    : StyleProperties(other.cssParserMode(), true, Vector<CSSProperty> { std::span { other.begin(), other.end() } })
{
}

MutableStyleProperties::~MutableStyleProperties() = default;

Ref<MutableStyleProperties> MutableStyleProperties::create(CSSParserMode mode)
{
    return adoptRef(*new MutableStyleProperties(mode));
}

bool MutableStyleProperties::removePropertyAtIndex(int index, String* returnText)
{
    if (index == -1) {
        if (returnText)
            *returnText = String();
        return false;
    }
    if (returnText)
        *returnText = m_propertyVector[index].value();
    m_propertyVector.removeAt(index);
    return true;
}

bool MutableStyleProperties::removeLonghandProperty(CSSPropertyID id, String* returnText)
{
    return removePropertyAtIndex(findPropertyIndex(id), returnText);
}

bool MutableStyleProperties::removeShorthandProperty(CSSPropertyID id, String* returnText)
{
    auto longhands = longhandsForShorthand(id);
    if (longhands.empty()) {
        if (returnText)
            *returnText = String();
        return false;
    }
    if (returnText)
        *returnText = getPropertyValue(id);
    return m_propertyVector.removeAllMatching([&](auto& property) {
        return std::ranges::find(longhands, property.id()) != longhands.end();
    });
}

bool MutableStyleProperties::removeProperty(CSSPropertyID id, String* returnText)
{
    if (id == CSSPropertyID::All) {
        if (returnText)
            *returnText = getPropertyValue(id);
        return removePropertiesOverriddenByAll();
    }
    if (isShorthand(id))
        return removeShorthandProperty(id, returnText);
    return removeLonghandProperty(id, returnText);
}

bool MutableStyleProperties::removeCustomProperty(const String& propertyName, String* returnText)
{
    return removePropertyAtIndex(findCustomPropertyIndex(propertyName), returnText);
}

bool MutableStyleProperties::setProperty(CSSPropertyID id, const String& value, IsImportant important)
{
    // Setting the value to an empty string just removes the property in both IE and Gecko.
    // Setting it to null seems to produce less consistent results, but we treat it just the same.
    if (value.isEmpty())
        return removeProperty(id);

    return CSSParser::parseValue(*this, id, value, important);
}

bool MutableStyleProperties::setCustomProperty(const String& propertyName, const String& value, IsImportant important)
{
    // Setting the value to an empty string just removes the property in both IE and Gecko.
    // Setting it to null seems to produce less consistent results, but we treat it just the same.
    if (value.isEmpty())
        return removeCustomProperty(propertyName);

    return CSSParser::parseCustomPropertyValue(*this, AtomString { propertyName }, value, important);
}

bool MutableStyleProperties::removePropertiesOverriddenByAll()
{
    return m_propertyVector.removeAllMatching([](auto& property) {
        return isAffectedByAll(property.id());
    });
}

bool MutableStyleProperties::setProperty(const CSSProperty& property)
{
    if (property.id() == CSSPropertyID::All) {
        if (m_propertyVector.size() == 1 && m_propertyVector[0] == property)
            return false;
        removePropertiesOverriddenByAll();
        m_propertyVector.append(property);
        return true;
    }

    int index = property.id() == CSSPropertyID::Custom ? findCustomPropertyIndex(property.customPropertyName()) : findPropertyIndex(property.id());
    if (index == -1) {
        m_propertyVector.append(property);
        return true;
    }

    auto& toReplace = m_propertyVector[index];
    bool isSame = toReplace == property;
    // Also when nothing visible changes: which shorthand declaration a longhand belongs to decides how the block is serialized.
    toReplace = property;
    return !isSame;
}

bool MutableStyleProperties::addParsedProperty(const CSSProperty& property)
{
    if (property.id() == CSSPropertyID::All) {
        removePropertiesOverriddenByAll();
        m_propertyVector.append(property);
        return true;
    }

    int index = property.id() == CSSPropertyID::Custom ? findCustomPropertyIndex(property.customPropertyName()) : findPropertyIndex(property.id());
    if (index != -1) {
        if (m_propertyVector[index].isImportant() && !property.isImportant())
            return false;
        m_propertyVector.removeAt(index);
    }
    m_propertyVector.append(property);
    return true;
}

bool MutableStyleProperties::addParsedProperties(const ParsedPropertyVector& properties)
{
    bool anyChanged = false;
    m_propertyVector.reserveCapacity(m_propertyVector.size() + properties.size());
    for (auto& property : properties)
        anyChanged |= addParsedProperty(property);
    return anyChanged;
}

void MutableStyleProperties::clear()
{
    m_propertyVector.clear();
}

bool MutableStyleProperties::parseDeclaration(const String& styleDeclaration)
{
    auto oldProperties = WTF::move(m_propertyVector);
    m_propertyVector.clear();

    CSSParser::parseDeclarationList(*this, styleDeclaration);

    // We could do better. Just changing property order does not require style invalidation.
    return oldProperties != m_propertyVector;
}

CSSStyleProperties& MutableStyleProperties::ensureInlineCSSStyleProperties(StyledElement& parentElement)
{
    if (m_cssomWrapper) {
        ASSERT(m_cssomWrapper->parentElement() == &parentElement);
        return *m_cssomWrapper;
    }
    lazyInitialize(m_cssomWrapper, makeUniqueWithoutRefCountedCheck<InlineCSSStyleProperties, CSSStyleProperties>(*this, parentElement));
    return *m_cssomWrapper;
}

} // namespace WebCore
