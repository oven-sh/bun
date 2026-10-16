/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2010-2026 Apple Inc. All rights reserved.
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

#pragma once

#include "HTMLElement.h"

namespace WebCore {

class HTMLHeadingElement final : public HTMLElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLHeadingElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLHeadingElement);
public:
    static Ref<HTMLHeadingElement> create(const QualifiedName&, Document&);

    ~HTMLHeadingElement();

    unsigned level() const;

    void setEffectiveHeadingOffset(unsigned offset) { m_effectiveHeadingOffset = std::min<unsigned>(9, offset); }

private:
    HTMLHeadingElement(const QualifiedName&, Document&);

    Node::NeedsPostConnectionSteps insertionSteps(InsertionType, ContainerNode& parentOfInsertedTree) final;

    uint8_t m_effectiveHeadingOffset { 0 };
};

unsigned computedHeadingOffset(const Element&);
void updateEffectiveHeadingOffsetForElementAndDescendants(Element& root, unsigned rootOffset);

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::HTMLHeadingElement)
    static bool isType(const WebCore::HTMLElement& element)
    {
        return element.hasTagName(WebCore::HTMLNames::h1Tag)
            || element.hasTagName(WebCore::HTMLNames::h2Tag)
            || element.hasTagName(WebCore::HTMLNames::h3Tag)
            || element.hasTagName(WebCore::HTMLNames::h4Tag)
            || element.hasTagName(WebCore::HTMLNames::h5Tag)
            || element.hasTagName(WebCore::HTMLNames::h6Tag);
    }
    static bool isType(const WebCore::Element& element)
    {
        auto* htmlElement = dynamicDowncast<WebCore::HTMLElement>(element);
        return htmlElement && isType(*htmlElement);
    }
    static bool isType(const WebCore::Node& node)
    {
        auto* htmlElement = dynamicDowncast<WebCore::HTMLElement>(node);
        return htmlElement && isType(*htmlElement);
    }
SPECIALIZE_TYPE_TRAITS_END()
