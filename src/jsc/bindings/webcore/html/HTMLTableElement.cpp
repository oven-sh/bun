/*
 * Copyright (C) 1997 Martin Jones (mjones@kde.org)
 *           (C) 1997 Torben Weis (weis@kde.org)
 *           (C) 1998 Waldo Bastian (bastian@kde.org)
 *           (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2003, 2004, 2005, 2006, 2008, 2010, 2011 Apple Inc. All rights reserved.
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
#include "HTMLTableElement.h"

#include "ElementChildIteratorInlines.h"
#include "GenericCachedHTMLCollection.h"
#include "HTMLNames.h"
#include "HTMLTableCaptionElement.h"
#include "HTMLTableRowElement.h"
#include "HTMLTableRowsCollection.h"
#include "HTMLTableSectionElement.h"
#include "NodeRareData.h"
#include <wtf/Ref.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLTableElement);

using namespace HTMLNames;

HTMLTableElement::HTMLTableElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
    ASSERT(hasTagName(tableTag));
}

HTMLTableElement::~HTMLTableElement() = default;

Ref<HTMLTableElement> HTMLTableElement::create(Document& document)
{
    return adoptRef(*new HTMLTableElement(tableTag, document));
}

Ref<HTMLTableElement> HTMLTableElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLTableElement(tagName, document));
}

RefPtr<HTMLTableCaptionElement> HTMLTableElement::caption() const
{
    // FIXME: Remove suppression once rdar://189998365 is fixed.
    SUPPRESS_MEMORY_UNSAFE_CAST return childrenOfType<HTMLTableCaptionElement>(const_cast<HTMLTableElement&>(*this)).first();
}

ExceptionOr<void> HTMLTableElement::setCaption(RefPtr<HTMLTableCaptionElement>&& newCaption)
{
    deleteCaption();
    if (!newCaption)
        return { };
    return insertBefore(*newCaption, protect(firstChild()));
}

RefPtr<HTMLTableSectionElement> HTMLTableElement::tHead() const
{
    // FIXME: Remove suppression once rdar://189998365 is fixed.
    SUPPRESS_MEMORY_UNSAFE_CAST for (auto& child : childrenOfType<HTMLTableSectionElement>(const_cast<HTMLTableElement&>(*this))) {
        if (child.hasTagName(theadTag))
            return child;
    }
    return nullptr;
}

ExceptionOr<void> HTMLTableElement::setTHead(RefPtr<HTMLTableSectionElement>&& newHead)
{
    if (newHead && !newHead->hasTagName(theadTag)) [[unlikely]]
        return Exception { ExceptionCode::HierarchyRequestError };

    deleteTHead();
    if (!newHead)
        return { };

    RefPtr<Node> child;
    for (child = firstChild(); child; child = child->nextSibling()) {
        if (child->isElementNode() && !child->hasTagName(captionTag) && !child->hasTagName(colgroupTag))
            break;
    }

    return insertBefore(*newHead, WTF::move(child));
}

RefPtr<HTMLTableSectionElement> HTMLTableElement::tFoot() const
{
    // FIXME: Remove suppression once rdar://189998365 is fixed.
    SUPPRESS_MEMORY_UNSAFE_CAST for (auto& child : childrenOfType<HTMLTableSectionElement>(const_cast<HTMLTableElement&>(*this))) {
        if (child.hasTagName(tfootTag))
            return child;
    }
    return nullptr;
}

ExceptionOr<void> HTMLTableElement::setTFoot(RefPtr<HTMLTableSectionElement>&& newFoot)
{
    if (newFoot && !newFoot->hasTagName(tfootTag)) [[unlikely]]
        return Exception { ExceptionCode::HierarchyRequestError };
    deleteTFoot();
    if (!newFoot)
        return { };
    return appendChild(*newFoot);
}

Ref<HTMLTableSectionElement> HTMLTableElement::createTHead()
{
    if (RefPtr existingHead = tHead())
        return existingHead.releaseNonNull();
    Ref head = HTMLTableSectionElement::create(theadTag, protect(document()));
    setTHead(head.copyRef());
    return head;
}

void HTMLTableElement::deleteTHead()
{
    if (auto head = tHead())
        removeChild(*head);
}

Ref<HTMLTableSectionElement> HTMLTableElement::createTFoot()
{
    if (RefPtr existingFoot = tFoot())
        return existingFoot.releaseNonNull();
    Ref foot = HTMLTableSectionElement::create(tfootTag, protect(document()));
    setTFoot(foot.copyRef());
    return foot;
}

void HTMLTableElement::deleteTFoot()
{
    if (auto foot = tFoot())
        removeChild(*foot);
}

Ref<HTMLTableSectionElement> HTMLTableElement::createTBody()
{
    Ref body = HTMLTableSectionElement::create(tbodyTag, protect(document()));
    RefPtr referenceElement = lastBody() ? lastBody()->nextSibling() : nullptr;
    insertBefore(body, WTF::move(referenceElement));
    return body;
}

Ref<HTMLTableCaptionElement> HTMLTableElement::createCaption()
{
    if (RefPtr existingCaption = caption())
        return existingCaption.releaseNonNull();
    Ref caption = HTMLTableCaptionElement::create(captionTag, protect(document()));
    setCaption(caption.copyRef());
    return caption;
}

void HTMLTableElement::deleteCaption()
{
    if (RefPtr caption = this->caption())
        removeChild(*caption);
}

HTMLTableSectionElement* HTMLTableElement::lastBody() const
{
    for (auto* child = lastChild(); child; child = child->previousSibling()) {
        if (child->hasTagName(tbodyTag))
            return downcast<HTMLTableSectionElement>(child);
    }
    return nullptr;
}

ExceptionOr<Ref<HTMLTableRowElement>> HTMLTableElement::insertRow(int index)
{
    if (index < -1)
        return Exception { ExceptionCode::IndexSizeError };

    Ref<HTMLTableElement> protectedThis(*this);

    RefPtr<HTMLTableRowElement> lastRow;
    RefPtr<HTMLTableRowElement> row;
    if (index == -1)
        lastRow = HTMLTableRowsCollection::lastRow(*this);
    else {
        for (int i = 0; i <= index; ++i) {
            row = HTMLTableRowsCollection::rowAfter(*this, lastRow.get());
            if (!row) {
                if (i != index)
                    return Exception { ExceptionCode::IndexSizeError };
                break;
            }
            lastRow = row;
        }
    }

    RefPtr<ContainerNode> parent;
    Ref document = this->document();
    if (lastRow)
        parent = row ? row->parentNode() : lastRow->parentNode();
    else {
        parent = lastBody();
        if (!parent) {
            Ref newBody = HTMLTableSectionElement::create(tbodyTag, document);
            Ref newRow = HTMLTableRowElement::create(document);
            newBody->appendChild(newRow);
            // FIXME: Why ignore the exception if the first appendChild failed?
            auto result = appendChild(newBody);
            if (result.hasException())
                return result.releaseException();
            return newRow;
        }
    }

    Ref newRow = HTMLTableRowElement::create(document);
    auto result = parent->insertBefore(newRow, WTF::move(row));
    if (result.hasException())
        return result.releaseException();
    return newRow;
}

ExceptionOr<void> HTMLTableElement::deleteRow(int index)
{
    RefPtr<HTMLTableRowElement> row;
    if (index == -1) {
        row = HTMLTableRowsCollection::lastRow(*this);
        if (!row)
            return { };
    } else {
        for (int i = 0; i <= index; ++i) {
            row = HTMLTableRowsCollection::rowAfter(*this, row.get());
            if (!row)
                break;
        }
        if (!row)
            return Exception { ExceptionCode::IndexSizeError };
    }
    return row->remove();
}

bool HTMLTableElement::isURLAttribute(const Attribute& attribute) const
{
    return attribute.name() == backgroundAttr || HTMLElement::isURLAttribute(attribute);
}

Ref<HTMLCollection> HTMLTableElement::rows()
{
    return ensureRareData().ensureNodeLists().addCachedCollection<HTMLTableRowsCollection>(*this);
}

Ref<HTMLCollection> HTMLTableElement::tBodies()
{
    return ensureRareData().ensureNodeLists().addCachedCollection<HTMLTableTBodiesCollection>(*this);
}

}
