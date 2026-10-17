/*
 * Copyright (C) 2004 Zack Rusin <zack@kde.org>
 * Copyright (C) 2004-2021 Apple Inc. All rights reserved.
 * Copyright (C) 2007 Alexey Proskuryakov <ap@webkit.org>
 * Copyright (C) 2007 Nicholas Shanks <webkit@nickshanks.com>
 * Copyright (C) 2011 Sencha, Inc. All rights reserved.
 * Copyright (C) 2013 Adobe Systems Incorporated. All rights reserved.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA
 * 02110-1301  USA
 */

#include "config.h"
#include "CSSComputedStyleDeclaration.h"

#include "Element.h"
#include "ExceptionOr.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(CSSComputedStyleDeclaration);

CSSComputedStyleDeclaration::CSSComputedStyleDeclaration(Element& element, IsEmpty isEmpty)
    : m_element(element)
    , m_isEmpty(isEmpty == IsEmpty::Yes)
{
}

CSSComputedStyleDeclaration::CSSComputedStyleDeclaration(Element& element, PseudoElementType pseudoElement)
    : m_element(element)
    , m_pseudoElement(pseudoElement)
{
}

CSSComputedStyleDeclaration::~CSSComputedStyleDeclaration() = default;

Ref<CSSComputedStyleDeclaration> CSSComputedStyleDeclaration::create(Element& element, PseudoElementType pseudoElement)
{
    return adoptRef(*new CSSComputedStyleDeclaration(element, pseudoElement));
}

Ref<CSSComputedStyleDeclaration> CSSComputedStyleDeclaration::createEmpty(Element& element)
{
    return adoptRef(*new CSSComputedStyleDeclaration(element, IsEmpty::Yes));
}

// https://drafts.csswg.org/cssom/#dom-window-getcomputedstyle
Ref<CSSComputedStyleDeclaration> CSSComputedStyleDeclaration::create(Element& element, const String& pseudoElement)
{
    if (!pseudoElement.startsWith(':'))
        return create(element);

    bool hasTwoColons = pseudoElement.startsWith("::"_s);
    auto name = StringView { pseudoElement }.substring(hasTwoColons ? 2 : 1);
    auto is = [&](ASCIILiteral candidate) {
        return equalIgnoringASCIICase(name, candidate);
    };

    // The four of CSS 2 may be written with one colon.
    if (is("before"_s))
        return create(element, PseudoElementType::Before);
    if (is("after"_s))
        return create(element, PseudoElementType::After);
    if (is("first-line"_s))
        return create(element, PseudoElementType::FirstLine);
    if (is("first-letter"_s))
        return create(element, PseudoElementType::FirstLetter);
    if (hasTwoColons) {
        if (is("marker"_s))
            return create(element, PseudoElementType::Marker);
        if (is("placeholder"_s))
            return create(element, PseudoElementType::Placeholder);
        if (is("selection"_s))
            return create(element, PseudoElementType::Selection);
        if (is("backdrop"_s))
            return create(element, PseudoElementType::Backdrop);
        if (is("file-selector-button"_s))
            return create(element, PseudoElementType::FileSelectorButton);
    }
    return createEmpty(element);
}

Style::Extractor CSSComputedStyleDeclaration::extractor() const
{
    return Style::Extractor(m_element.get(), m_pseudoElement);
}

String CSSComputedStyleDeclaration::cssText() const
{
    return emptyString();
}

ExceptionOr<void> CSSComputedStyleDeclaration::setCssText(const String&)
{
    return Exception { ExceptionCode::NoModificationAllowedError };
}

String CSSComputedStyleDeclaration::getPropertyValue(CSSPropertyID propertyID) const
{
    if (m_isEmpty)
        return emptyString(); // FIXME: Should this be null instead, as it is in StyleProperties::getPropertyValue?

    return extractor().propertyValueSerialization(propertyID);
}

unsigned CSSComputedStyleDeclaration::length() const
{
    if (m_isEmpty)
        return 0;

    return numLonghandProperties + extractor().customPropertyNames().size();
}

String CSSComputedStyleDeclaration::item(unsigned i) const
{
    if (m_isEmpty)
        return String();

    if (i < numLonghandProperties)
        return nameString(static_cast<CSSPropertyID>(firstLonghandProperty + i));

    auto customPropertyNames = extractor().customPropertyNames();
    if (i - numLonghandProperties < customPropertyNames.size())
        return customPropertyNames[i - numLonghandProperties];
    return String();
}

CSSRule* CSSComputedStyleDeclaration::parentRule() const
{
    return nullptr;
}

String CSSComputedStyleDeclaration::getPropertyValue(const String& propertyName)
{
    if (m_isEmpty)
        return String();

    if (isCustomPropertyName(propertyName))
        return extractor().customPropertyValueSerialization(AtomString { propertyName });

    auto propertyID = cssPropertyID(propertyName);
    if (propertyID == CSSPropertyID::Invalid)
        return String();

    return extractor().propertyValueSerialization(propertyID);
}

String CSSComputedStyleDeclaration::getPropertyPriority(const String&)
{
    // All computed styles have a priority of not "important".
    return emptyString();
}

ExceptionOr<void> CSSComputedStyleDeclaration::setProperty(const String&, const String&, const String&)
{
    return Exception { ExceptionCode::NoModificationAllowedError };
}

ExceptionOr<String> CSSComputedStyleDeclaration::removeProperty(const String&)
{
    return Exception { ExceptionCode::NoModificationAllowedError };
}

String CSSComputedStyleDeclaration::getPropertyValueInternal(CSSPropertyID propertyID)
{
    return getPropertyValue(propertyID);
}

ExceptionOr<void> CSSComputedStyleDeclaration::setPropertyInternal(CSSPropertyID, const String&, IsImportant)
{
    return Exception { ExceptionCode::NoModificationAllowedError };
}

} // namespace WebCore
