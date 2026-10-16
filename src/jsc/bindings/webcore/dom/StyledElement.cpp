/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Peter Kelly (pmk@post.com)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2018 Apple Inc. All rights reserved.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public License
 * along with this library; see the file COPYING.LIB.  If not, write to
 * the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 * Boston, MA 02110-1301, USA.
 */

#include "config.h"
#include "StyledElement.h"

#include "CSSParser.h"
#include "CSSStyleProperties.h"
#include "ElementInlines.h"
#include "HTMLNames.h"
#include "ImmutableStyleProperties.h"
#include "MutableStyleProperties.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(StyledElement);

static_assert(sizeof(StyledElement) == sizeof(Element), "styledelement should remain same size as element");

using namespace HTMLNames;

void StyledElement::synchronizeStyleAttributeInternalImpl()
{
    ASSERT(elementData());
    ASSERT(elementData()->styleAttributeIsDirty());
    elementData()->setStyleAttributeIsDirty(false);
    if (RefPtr<const StyleProperties> inlineStyle = this->inlineStyle())
        setSynchronizedLazyAttribute(styleAttr, inlineStyle->asTextAtom());
}

StyledElement::StyledElement(ClangVTableWorkaroundTag, const QualifiedName& name, Document& document)
    : Element(name, document, { })
{
}

StyledElement::~StyledElement() = default;

const StyleProperties* StyledElement::inlineStyle() const
{
    auto* data = elementData();
    if (!data)
        return nullptr;
    if (!data->m_inlineStyle) {
        auto* attribute = data->findAttributeByName(styleAttr);
        if (!attribute)
            return nullptr;
        data->m_inlineStyle = CSSParser::parseInlineStyleDeclaration(attribute->value(), *this);
    }
    return data->m_inlineStyle.get();
}

CSSStyleProperties& StyledElement::cssomStyle()
{
    return ensureMutableInlineStyle()->ensureInlineCSSStyleProperties(*this);
}

Ref<MutableStyleProperties> StyledElement::ensureMutableInlineStyle()
{
    this->inlineStyle();
    RefPtr<StyleProperties>& inlineStyle = ensureUniqueElementData().m_inlineStyle;
    if (!inlineStyle) {
        Ref mutableProperties = MutableStyleProperties::create(strictToCSSParserMode(isHTMLElement() && !document().inQuirksMode()));
        inlineStyle = mutableProperties.copyRef();
        return mutableProperties;
    }
    if (auto* mutableProperties = dynamicDowncast<MutableStyleProperties>(*inlineStyle))
        return *mutableProperties;
    Ref mutableProperties = inlineStyle->mutableCopy();
    inlineStyle = mutableProperties.copyRef();
    return mutableProperties;
}

void StyledElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason reason)
{
    Element::attributeChanged(name, oldValue, newValue, reason);
    if (oldValue != newValue && name == styleAttr)
        styleAttributeChanged(newValue);
}

void StyledElement::styleAttributeChanged(const AtomString& newStyleString)
{
    auto& inlineStyle = elementData()->m_inlineStyle;

    // Shared attribute data has the same style attribute, so what has been parsed from it still holds.
    if (inlineStyle && !elementData()->isUnique())
        return;

    // element.style stays the same object. Without one, the attribute is parsed when somebody asks.
    if (RefPtr mutableStyleProperties = dynamicDowncast<MutableStyleProperties>(inlineStyle); mutableStyleProperties && mutableStyleProperties->hasCSSOMWrapper()) {
        if (newStyleString.isNull())
            mutableStyleProperties->clear();
        else
            mutableStyleProperties->parseDeclaration(newStyleString);
    } else
        inlineStyle = nullptr;

    elementData()->setStyleAttributeIsDirty(false);
}

// The standard writes the attribute at each change of element.style. Here its text is written when somebody reads it,
// but it takes its place among the attributes now, so that markup has them in the order in which they were set.
void StyledElement::dirtyStyleAttribute()
{
    auto& data = ensureUniqueElementData();
    if (data.findAttributeIndexByName(styleAttr) == ElementData::attributeNotFound)
        data.addAttribute(styleAttr, emptyAtom());
    data.setStyleAttributeIsDirty(true);
}

void StyledElement::invalidateStyleAttribute()
{
    dirtyStyleAttribute();
}

}
