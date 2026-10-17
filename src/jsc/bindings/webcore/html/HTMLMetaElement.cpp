/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2003-2023 Apple Inc. All rights reserved.
 * Copyright (C) 2013 Google Inc. All rights reserved.
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
#include "HTMLMetaElement.h"

#include "Document.h"
#include "ElementInlines.h"
#include "HTMLNames.h"
#include "NodeName.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLMetaElement);

using namespace HTMLNames;

inline HTMLMetaElement::HTMLMetaElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
    ASSERT(hasTagName(metaTag));
}

Ref<HTMLMetaElement> HTMLMetaElement::create(Document& document)
{
    return adoptRef(*new HTMLMetaElement(metaTag, document));
}

Ref<HTMLMetaElement> HTMLMetaElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLMetaElement(tagName, document));
}

void HTMLMetaElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    HTMLElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);

    switch (name.nodeName()) {
    case AttributeNames::contentAttr:
    case AttributeNames::http_equivAttr:
        process();
        break;
    default:
        break;
    }
}

Node::NeedsPostConnectionSteps HTMLMetaElement::insertionSteps(InsertionType insertionType, ContainerNode& parentOfInsertedTree)
{
    HTMLElement::insertionSteps(insertionType, parentOfInsertedTree);
    if (insertionType.connectedToDocument)
        return NeedsPostConnectionSteps::Yes;
    return NeedsPostConnectionSteps::No;
}

void HTMLMetaElement::postConnectionSteps()
{
    process();
}

void HTMLMetaElement::process()
{
    // Changing a meta tag while it's not in the document tree shouldn't have any effect on the document.
    if (!isInDocumentTree())
        return;

    // https://html.spec.whatwg.org/multipage/semantics.html#the-meta-element
    // All below situations require a content attribute (which can be the empty string).
    const AtomString& contentValue = attributeWithoutSynchronization(contentAttr);
    if (contentValue.isNull())
        return;

    const AtomString& httpEquivValue = attributeWithoutSynchronization(http_equivAttr);
    // Get the document to process the tag, but only if we're actually part of DOM
    // tree (changing a meta tag while it's not in the tree shouldn't have any effect
    // on the document)
    if (!httpEquivValue.isNull())
        protect(document())->processMetaHttpEquiv(httpEquivValue, contentValue);
}

}
