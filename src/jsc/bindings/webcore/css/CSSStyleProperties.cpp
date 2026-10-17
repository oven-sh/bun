/*
 * Copyright (C) 2025 Samuel Weinig <sam@webkit.org>
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "CSSStyleProperties.h"

#include "CSSPropertyNames.h"
#include "CSSRule.h"
#include "CSSStyleSheet.h"
#include "DOMClientData.h"
#include "ExceptionOr.h"
#include "MutableStyleProperties.h"
#include "StyleAttributeMutationScope.h"
#include "StyleProperties.h"
#include "StyledElement.h"
#include <wtf/StdLibExtras.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(CSSStyleProperties);
WTF_MAKE_TZONE_ALLOCATED_IMPL(PropertySetCSSStyleProperties);
WTF_MAKE_TZONE_ALLOCATED_IMPL(StyleRuleCSSStyleProperties);
WTF_MAKE_TZONE_ALLOCATED_IMPL(InlineCSSStyleProperties);

// https://drafts.csswg.org/cssom/#idl-attribute-to-css-property, for the camel-cased, webkit-cased and dashed attributes at once.
static CSSPropertyID parseJavaScriptCSSPropertyName(const StringImpl& propertyName)
{
    unsigned length = propertyName.length();
    if (!length || length > maxCSSPropertyNameLength)
        return CSSPropertyID::Invalid;

    std::array<Latin1Character, maxCSSPropertyNameLength + 1> buffer;
    unsigned outputLength = 0;
    bool hasDash = false;
    bool hasUpper = false;

    // "webkitTransform" is "-webkit-transform", like "WebkitTransform".
    if (propertyName.startsWith("webkit"_s) && length > 6 && isASCIIUpper(propertyName[6]))
        buffer[outputLength++] = '-';

    for (unsigned i = 0; i < length; ++i) {
        char16_t character = propertyName[i];
        if (isASCIIUpper(character)) {
            hasUpper = true;
            if (outputLength + 2 > buffer.size())
                return CSSPropertyID::Invalid;
            buffer[outputLength++] = '-';
            buffer[outputLength++] = toASCIILowerUnchecked(static_cast<Latin1Character>(character));
            continue;
        }
        if (!isASCIILower(character) && character != '-' && !isASCIIDigit(character))
            return CSSPropertyID::Invalid;
        hasDash |= character == '-';
        if (outputLength + 1 > buffer.size())
            return CSSPropertyID::Invalid;
        buffer[outputLength++] = static_cast<Latin1Character>(character);
    }

    // A dashed attribute is the name of the property itself.
    if (hasDash && hasUpper)
        return CSSPropertyID::Invalid;
    return findCSSProperty(std::span { buffer }.first(outputLength));
}

CSSPropertyID CSSStyleProperties::getCSSPropertyIDFromJavaScriptPropertyName(const AtomString& propertyName)
{
    if (propertyName.isEmpty())
        return CSSPropertyID::Invalid;

    auto& cache = domClientData().cssPropertyIDsByJavaScriptName();
    if (auto id = cache.get(propertyName); id != CSSPropertyID::Invalid)
        return id;

    auto id = parseJavaScriptCSSPropertyName(*propertyName.impl());
    if (id != CSSPropertyID::Invalid)
        cache.add(propertyName, id);
    return id;
}

String CSSStyleProperties::cssFloat()
{
    return getPropertyValueInternal(CSSPropertyID::Float);
}

ExceptionOr<void> CSSStyleProperties::setCssFloat(const String& value)
{
    return setPropertyInternal(CSSPropertyID::Float, value, IsImportant::No);
}

// MARK: - PropertySetCSSStyleProperties

void PropertySetCSSStyleProperties::ref() const
{
    m_propertySet->ref();
}

void PropertySetCSSStyleProperties::deref() const
{
    m_propertySet->deref();
}

unsigned PropertySetCSSStyleProperties::length() const
{
    return m_propertySet->propertyCount();
}

String PropertySetCSSStyleProperties::item(unsigned i) const
{
    if (i >= m_propertySet->propertyCount())
        return String();

    return m_propertySet->propertyAt(i).cssName();
}

String PropertySetCSSStyleProperties::cssText() const
{
    return protect(m_propertySet)->asText();
}

ExceptionOr<void> PropertySetCSSStyleProperties::setCssText(const String& text)
{
    StyleAttributeMutationScope mutationScope { parentElement() };
    if (!willMutate())
        return { };

    bool changed = protect(m_propertySet)->parseDeclaration(text);
    didMutate(changed ? MutationType::PropertyChanged : MutationType::StyleAttributeChanged);

    mutationScope.enqueueMutationRecord();
    return { };
}

String PropertySetCSSStyleProperties::getPropertyValue(const String& propertyName)
{
    if (isCustomPropertyName(propertyName))
        return protect(m_propertySet)->getCustomPropertyValue(propertyName);

    CSSPropertyID propertyID = cssPropertyID(propertyName);
    if (propertyID == CSSPropertyID::Invalid)
        return String();
    return getPropertyValueInternal(propertyID);
}

String PropertySetCSSStyleProperties::getPropertyPriority(const String& propertyName)
{
    if (isCustomPropertyName(propertyName))
        return protect(m_propertySet)->customPropertyIsImportant(propertyName) ? "important"_s : emptyString();

    CSSPropertyID propertyID = cssPropertyID(propertyName);
    if (propertyID == CSSPropertyID::Invalid)
        return emptyString();
    return protect(m_propertySet)->propertyIsImportant(propertyID) ? "important"_s : emptyString();
}

ExceptionOr<void> PropertySetCSSStyleProperties::setProperty(const String& propertyName, const String& value, const String& priority)
{
    StyleAttributeMutationScope mutationScope { parentElement() };

    CSSPropertyID propertyID = cssPropertyID(propertyName);
    if (isCustomPropertyName(propertyName))
        propertyID = CSSPropertyID::Custom;

    if (propertyID == CSSPropertyID::Invalid)
        return { };

    if (!willMutate())
        return { };

    bool important = equalLettersIgnoringASCIICase(priority, "important"_s);
    if (!important && !priority.isEmpty())
        return { };

    bool changed;
    if (propertyID == CSSPropertyID::Custom) [[unlikely]]
        changed = protect(m_propertySet)->setCustomProperty(propertyName, value, important ? IsImportant::Yes : IsImportant::No);
    else
        changed = protect(m_propertySet)->setProperty(propertyID, value, important ? IsImportant::Yes : IsImportant::No);

    didMutate(changed ? MutationType::PropertyChanged : MutationType::NoChanges);

    if (changed) {
        // CSS DOM requires raising SyntaxError of parsing failed, but this is too dangerous for compatibility,
        // see <http://bugs.webkit.org/show_bug.cgi?id=7296>.
        mutationScope.enqueueMutationRecord();
    }

    return { };
}

ExceptionOr<String> PropertySetCSSStyleProperties::removeProperty(const String& propertyName)
{
    StyleAttributeMutationScope mutationScope { parentElement() };
    CSSPropertyID propertyID = cssPropertyID(propertyName);
    if (isCustomPropertyName(propertyName))
        propertyID = CSSPropertyID::Custom;
    if (propertyID == CSSPropertyID::Invalid)
        return String();

    if (!willMutate())
        return String();

    String result;
    bool changed = propertyID != CSSPropertyID::Custom ? protect(m_propertySet)->removeProperty(propertyID, &result) : protect(m_propertySet)->removeCustomProperty(propertyName, &result);

    didMutate(changed ? MutationType::PropertyChanged : MutationType::NoChanges);

    if (changed)
        mutationScope.enqueueMutationRecord();
    return result;
}

String PropertySetCSSStyleProperties::getPropertyValueInternal(CSSPropertyID propertyID)
{
    if (propertyID == CSSPropertyID::Invalid)
        return { };

    auto value = protect(m_propertySet)->getPropertyValue(propertyID);

    if (!value.isEmpty())
        return value;

    return { };
}

ExceptionOr<void> PropertySetCSSStyleProperties::setPropertyInternal(CSSPropertyID propertyID, const String& value, IsImportant important)
{
    StyleAttributeMutationScope mutationScope { parentElement() };
    if (!willMutate())
        return { };

    if (propertyID == CSSPropertyID::Invalid)
        return { };

    SUPPRESS_UNCOUNTED_ARG if (m_propertySet->setProperty(propertyID, value, important)) {
        didMutate(MutationType::PropertyChanged);
        mutationScope.enqueueMutationRecord();
    } else
        didMutate(MutationType::NoChanges);

    return { };
}

// MARK: - StyleRuleCSSStyleProperties

StyleRuleCSSStyleProperties::StyleRuleCSSStyleProperties(MutableStyleProperties& propertySet, CSSRule& parentRule)
    : StyleRuleCSSStylePropertiesOwner(propertySet)
    , PropertySetCSSStyleProperties(propertySet)
    , m_parentRule(&parentRule)
{
}

StyleRuleCSSStyleProperties::~StyleRuleCSSStyleProperties() = default;

bool StyleRuleCSSStyleProperties::willMutate()
{
    return m_parentRule && m_parentRule->parentStyleSheet();
}

void StyleRuleCSSStyleProperties::didMutate(MutationType)
{
    ASSERT(m_parentRule);
    ASSERT(m_parentRule->parentStyleSheet());

    protect(protect(m_parentRule)->parentStyleSheet())->didMutateRules();
}

CSSRule* StyleRuleCSSStyleProperties::parentRule() const
{
    return m_parentRule.get();
}

// MARK: - InlineCSSStyleProperties

void InlineCSSStyleProperties::didMutate(MutationType type)
{
    if (type == MutationType::NoChanges)
        return;

    if (type == MutationType::StyleAttributeChanged && m_parentElement) {
        protect(m_parentElement)->dirtyStyleAttribute();
        return;
    }

    RefPtr parentElement = m_parentElement.get();
    if (!parentElement)
        return;

    // Inline style changes from JavaScript (e.g., element.style.color = 'red') need to set
    // the mutation bit for innerHTML prefix cache invalidation, since they don't go through
    // the normal attribute change notification path.
    parentElement->setDidMutateSubtreeAfterSetInnerHTMLOnAncestors();
    parentElement->invalidateStyleAttribute();
}

}
