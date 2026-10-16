/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2003-2026 Apple Inc. All rights reserved.
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
 *
 */

#include "config.h"
#include "HTMLHeadingElement.h"

#include "Document.h"
#include "ElementChildIteratorInlines.h"
#include "HTMLNames.h"
#include "HTMLParserIdioms.h"
#include "ShadowRoot.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLHeadingElement);

inline HTMLHeadingElement::HTMLHeadingElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
}

Ref<HTMLHeadingElement> HTMLHeadingElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLHeadingElement(tagName, document));
}

HTMLHeadingElement::~HTMLHeadingElement() = default;

static unsigned localHeadingOffset(const HTMLElement& element)
{
    auto& value = element.attributeWithoutSynchronization(HTMLNames::headingoffsetAttr);
    if (value.isNull())
        return 0;
    auto parsed = parseHTMLNonNegativeInteger(value);
    if (!parsed)
        return 0;
    return std::min<unsigned>(9, *parsed);
}

// https://html.spec.whatwg.org/multipage/sections.html#get-an-element's-computed-heading-offset
unsigned computedHeadingOffset(const Element& element)
{
    unsigned offset = 0;
    for (RefPtr ancestor = const_cast<Element*>(&element); ancestor; ancestor = ancestor->parentOrShadowHostElement()) {
        RefPtr htmlAncestor = dynamicDowncast<HTMLElement>(*ancestor);
        if (!htmlAncestor)
            continue;
        offset = std::min<unsigned>(9, offset + localHeadingOffset(*htmlAncestor));
        if (htmlAncestor->hasAttributeWithoutSynchronization(HTMLNames::headingresetAttr))
            return offset;
    }
    return offset;
}

unsigned HTMLHeadingElement::level() const
{
    unsigned base;
    if (hasTagName(HTMLNames::h1Tag))
        base = 1;
    else if (hasTagName(HTMLNames::h2Tag))
        base = 2;
    else if (hasTagName(HTMLNames::h3Tag))
        base = 3;
    else if (hasTagName(HTMLNames::h4Tag))
        base = 4;
    else if (hasTagName(HTMLNames::h5Tag))
        base = 5;
    else {
        ASSERT(hasTagName(HTMLNames::h6Tag));
        base = 6;
    }
    return std::min<unsigned>(9, base + m_effectiveHeadingOffset);
}

Node::NeedsPostConnectionSteps HTMLHeadingElement::insertionSteps(InsertionType insertionType, ContainerNode& parentOfInsertedTree)
{
    auto result = HTMLElement::insertionSteps(insertionType, parentOfInsertedTree);

    if (insertionType.connectedToDocument)
        setEffectiveHeadingOffset(document().usesHeadingOffsetAttribute() ? computedHeadingOffset(*this) : 0);

    return result;
}

void updateEffectiveHeadingOffsetForElementAndDescendants(Element& root, unsigned rootOffset)
{
    if (RefPtr heading = dynamicDowncast<HTMLHeadingElement>(root))
        heading->setEffectiveHeadingOffset(rootOffset);

    auto recurseInto = [&](ContainerNode& container) {
        for (Ref child : childrenOfType<Element>(container)) {
            RefPtr htmlChild = dynamicDowncast<HTMLElement>(child.get());
            if (htmlChild && htmlChild->hasAttributeWithoutSynchronization(HTMLNames::headingresetAttr))
                continue;
            unsigned localOffset = htmlChild ? localHeadingOffset(*htmlChild) : 0;
            unsigned childOffset = std::min<unsigned>(9, rootOffset + localOffset);
            updateEffectiveHeadingOffsetForElementAndDescendants(child.get(), childOffset);
        }
    };

    recurseInto(root);
    if (RefPtr shadowRoot = root.shadowRoot())
        recurseInto(*shadowRoot);
}

} // namespace WebCore
