/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2003, 2010, 2013 Apple Inc. All rights reserved.
 *           (C) 2007 Rob Buis (buis@kde.org)
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
#include "HTMLStyleElement.h"

#include "DOMTokenList.h"
#include "Document.h"
#include "HTMLNames.h"
#include "NodeName.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLStyleElement);

using namespace HTMLNames;

inline HTMLStyleElement::HTMLStyleElement(const QualifiedName& tagName, Document& document, bool createdByParser)
    : HTMLElement(tagName, document)
    , m_styleSheetOwner(document, createdByParser)
{
    ASSERT(hasTagName(styleTag));
}

HTMLStyleElement::~HTMLStyleElement()
{
    m_styleSheetOwner.clearDocumentData(*this);
}

Ref<HTMLStyleElement> HTMLStyleElement::create(const QualifiedName& tagName, Document& document, bool createdByParser)
{
    return adoptRef(*new HTMLStyleElement(tagName, document, createdByParser));
}

Ref<HTMLStyleElement> HTMLStyleElement::create(Document& document)
{
    return adoptRef(*new HTMLStyleElement(styleTag, document, false));
}

void HTMLStyleElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    switch (name.nodeName()) {
    case AttributeNames::titleAttr:
        if (RefPtr sheet = this->sheet(); sheet && !isInShadowTree())
            sheet->setTitle(newValue);
        break;
    case AttributeNames::mediaAttr:
        m_styleSheetOwner.setMedia(*this, newValue);
        break;
    case AttributeNames::typeAttr:
        m_styleSheetOwner.setContentType(*this, newValue);
        break;
    case AttributeNames::blockingAttr:
        if (m_blockingList)
            m_blockingList->associatedAttributeValueChanged();
        break;
    default:
        HTMLElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);
        break;
    }
}

// https://html.spec.whatwg.org/multipage/semantics.html#dom-style-blocking
// FIXME: Bug 88869 - This isn't currently connected to anything, because style elements are
// parser blocking, even when script inserted.
DOMTokenList& HTMLStyleElement::blocking()
{
    if (!m_blockingList) {
        lazyInitialize(m_blockingList, makeUniqueWithoutRefCountedCheck<DOMTokenList>(*this, HTMLNames::blockingAttr, [](Document&, StringView token) {
            if (equalLettersIgnoringASCIICase(token, "render"_s))
                return true;
            return false;
        }));
    }
    return *m_blockingList;
}

void HTMLStyleElement::finishParsingChildren()
{
    m_styleSheetOwner.finishParsingChildren(*this);
    HTMLElement::finishParsingChildren();
}

Node::NeedsPostConnectionSteps HTMLStyleElement::insertionSteps(InsertionType insertionType, ContainerNode& parentOfInsertedTree)
{
    auto result = HTMLElement::insertionSteps(insertionType, parentOfInsertedTree);
    if (insertionType.connectedToDocument)
        m_styleSheetOwner.insertedIntoDocument(*this);
    return result;
}

void HTMLStyleElement::removingSteps(RemovalType removalType, ContainerNode& oldParentOfRemovedTree)
{
    HTMLElement::removingSteps(removalType, oldParentOfRemovedTree);
    if (removalType.disconnectedFromDocument)
        m_styleSheetOwner.removedFromDocument(*this);
}

void HTMLStyleElement::childrenChanged(const ChildChange& change)
{
    HTMLElement::childrenChanged(change);
    m_styleSheetOwner.childrenChanged(*this);
}

bool HTMLStyleElement::disabled() const
{
    RefPtr sheet = this->sheet();
    return sheet && sheet->disabled();
}

void HTMLStyleElement::setDisabled(bool disabled)
{
    if (RefPtr sheet = this->sheet())
        sheet->setDisabled(disabled);
}

}
