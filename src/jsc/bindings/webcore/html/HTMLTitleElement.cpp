/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2003-2017 Apple Inc. All rights reserved.
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
#include "HTMLTitleElement.h"

#include "Document.h"
#include "ElementInlines.h"
#include "HTMLNames.h"
#include "Text.h"
#include "TextNodeTraversal.h"
#include <wtf/Ref.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLTitleElement);

using namespace HTMLNames;

inline HTMLTitleElement::HTMLTitleElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
    ASSERT(hasTagName(titleTag));
}

Ref<HTMLTitleElement> HTMLTitleElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLTitleElement(tagName, document));
}

Node::NeedsPostConnectionSteps HTMLTitleElement::insertionSteps(InsertionType insertionType, ContainerNode& parentOfInsertedTree)
{
    HTMLElement::insertionSteps(insertionType, parentOfInsertedTree);

    if (insertionType.connectedToDocument)
        return NeedsPostConnectionSteps::Yes;

    return NeedsPostConnectionSteps::No;
}

void HTMLTitleElement::postConnectionSteps()
{
    HTMLElement::postConnectionSteps();

    protect(document())->titleElementAdded(*this);
}

void HTMLTitleElement::removingSteps(RemovalType removalType, ContainerNode& oldParentOfRemovedTree)
{
    HTMLElement::removingSteps(removalType, oldParentOfRemovedTree);

    if (removalType.disconnectedFromDocument)
        protect(document())->titleElementRemoved(*this);
}

void HTMLTitleElement::childrenChanged(const ChildChange& change)
{
    HTMLElement::childrenChanged(change);

    if (isConnected())
        protect(document())->titleElementTextChanged(*this);
}

String HTMLTitleElement::text() const
{
    return TextNodeTraversal::childTextContent(*this);
}

void HTMLTitleElement::setText(String&& value)
{
    setTextContent(WTF::move(value));
}

}
