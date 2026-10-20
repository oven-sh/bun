/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Stefan Schimanski (1Stein@gmx.de)
 * Copyright (C) 2004-2017 Apple Inc. All rights reserved.
 * Copyright (C) 2008 Nokia Corporation and/or its subsidiary(-ies)
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
#include "HTMLObjectElement.h"

#include "Attribute.h"
#include "HTMLFormElement.h"
#include "HTMLNames.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLObjectElement);

using namespace HTMLNames;

inline HTMLObjectElement::HTMLObjectElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document, TypeFlag::HasDidMoveToNewDocument)
{
    ASSERT(hasTagName(objectTag));
}

Ref<HTMLObjectElement> HTMLObjectElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLObjectElement(tagName, document));
}

HTMLObjectElement::~HTMLObjectElement()
{
    clearForm();
}

int HTMLObjectElement::defaultTabIndex() const
{
    return 0;
}

void HTMLObjectElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    HTMLElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);
    FormListedElement::parseAttribute(name, newValue);
}

Node::NeedsPostConnectionSteps HTMLObjectElement::insertionSteps(InsertionType insertionType, ContainerNode& parentOfInsertedTree)
{
    HTMLElement::insertionSteps(insertionType, parentOfInsertedTree);
    FormListedElement::elementInsertedIntoAncestor(*this, insertionType);
    if (!insertionType.connectedToDocument)
        return NeedsPostConnectionSteps::No;
    return NeedsPostConnectionSteps::Yes;
}

void HTMLObjectElement::postConnectionSteps()
{
    resetFormOwner();
}

void HTMLObjectElement::removingSteps(RemovalType removalType, ContainerNode& oldParentOfRemovedTree)
{
    HTMLElement::removingSteps(removalType, oldParentOfRemovedTree);
    FormListedElement::elementRemovedFromAncestor(*this, removalType);
}

bool HTMLObjectElement::isURLAttribute(const Attribute& attribute) const
{
    return attribute.name() == dataAttr || attribute.name() == codebaseAttr || HTMLElement::isURLAttribute(attribute);
}

void HTMLObjectElement::didMoveToNewDocument(Document& oldDocument, Document& newDocument)
{
    FormListedElement::didMoveToNewDocument();
    HTMLElement::didMoveToNewDocument(oldDocument, newDocument);
}

}
