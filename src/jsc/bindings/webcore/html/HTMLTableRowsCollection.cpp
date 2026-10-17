/*
 * Copyright (C) 2008-2025 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Apple Inc. ("Apple") nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "HTMLTableRowsCollection.h"

#include "CachedHTMLCollectionInlines.h"
#include "ElementIterator.h"
#include "ElementTraversal.h"
#include "HTMLNames.h"
#include "HTMLTableElement.h"
#include "HTMLTableRowElement.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

using namespace HTMLNames;

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLTableRowsCollection);

static inline void LEGACY_NODELETE assertRowIsInTable(HTMLTableElement& table, HTMLTableRowElement* row)
{
#if ASSERT_ENABLED
    if (!row)
        return;
    if (row->parentNode() == &table)
        return;
    ASSERT(row->parentNode());
    ASSERT(row->parentNode()->hasTagName(theadTag) || row->parentNode()->hasTagName(tbodyTag) || row->parentNode()->hasTagName(tfootTag));
    ASSERT(row->parentNode()->parentNode() == &table);
#else
    UNUSED_PARAM(table);
    UNUSED_PARAM(row);
#endif // not ASSERT_ENABLED
}

static inline bool LEGACY_NODELETE isInSection(HTMLTableRowElement& row, const HTMLQualifiedName& sectionTag)
{
    // Because we know that the parent is a table or a section, it's safe to cast it to an HTMLElement
    // giving us access to the faster hasTagName overload from that class.
    return downcast<HTMLElement>(*row.parentNode()).hasTagName(sectionTag);
}

HTMLTableRowElement* HTMLTableRowsCollection::rowAfter(HTMLTableElement& table, HTMLTableRowElement* previous)
{
    // The HTMLCollection caching mechanism, along with the code in this class, will guarantee that the previous row
    // is an immediate child of either the table, or a table section that is itself an immediate child of the table.
    assertRowIsInTable(table, previous);

    // Start by looking for the next row in this section. Continue only if there is none.
    if (previous && previous->parentNode() != &table) {
        auto childRows = childrenOfType<HTMLTableRowElement>(*previous->parentNode());
        auto row = childRows.beginAt(*previous);
        if (++row != childRows.end())
            return &*row;
    }

    Element* child = nullptr;

    // If still looking at head sections, find the first row in the next head section.
    if (!previous)
        child = ElementTraversal::firstChild(table);
    else if (isInSection(*previous, theadTag))
        child = ElementTraversal::nextSibling(*previous->parentNode());
    for (; child; child = ElementTraversal::nextSibling(*child)) {
        if (child->hasTagName(theadTag)) {
            if (auto row = childrenOfType<HTMLTableRowElement>(*child).first())
                return row;
        }
    }

    // If still looking at top level and bodies, find the next row in top level or the first in the next body section.
    if (!previous || isInSection(*previous, theadTag))
        child = ElementTraversal::firstChild(table);
    else if (previous->parentNode() == &table)
        child = ElementTraversal::nextSibling(*previous);
    else if (isInSection(*previous, tbodyTag))
        child = ElementTraversal::nextSibling(*previous->parentNode());
    for (; child; child = ElementTraversal::nextSibling(*child)) {
        if (auto* row = dynamicDowncast<HTMLTableRowElement>(*child))
            return row;
        if (child->hasTagName(tbodyTag)) {
            if (auto row = childrenOfType<HTMLTableRowElement>(*child).first())
                return row;
        }
    }

    // Find the first row in the next foot section.
    if (!previous || !isInSection(*previous, tfootTag))
        child = ElementTraversal::firstChild(table);
    else
        child = ElementTraversal::nextSibling(*previous->parentNode());
    for (; child; child = ElementTraversal::nextSibling(*child)) {
        if (child->hasTagName(tfootTag)) {
            if (auto row = childrenOfType<HTMLTableRowElement>(*child).first())
                return row;
        }
    }

    return nullptr;
}

HTMLTableRowElement* HTMLTableRowsCollection::lastRow(HTMLTableElement& table)
{
    for (auto* child = ElementTraversal::lastChild(table); child; child = ElementTraversal::previousSibling(*child)) {
        if (child->hasTagName(tfootTag)) {
            if (auto* row = childrenOfType<HTMLTableRowElement>(*child).last())
                return row;
        }
    }

    for (auto* child = ElementTraversal::lastChild(table); child; child = ElementTraversal::previousSibling(*child)) {
        if (auto* row = dynamicDowncast<HTMLTableRowElement>(*child))
            return row;
        if (child->hasTagName(tbodyTag)) {
            if (auto* row = childrenOfType<HTMLTableRowElement>(*child).last())
                return row;
        }
    }

    for (auto* child = ElementTraversal::lastChild(table); child; child = ElementTraversal::previousSibling(*child)) {
        if (child->hasTagName(theadTag)) {
            if (auto* row = childrenOfType<HTMLTableRowElement>(*child).last())
                return row;
        }
    }

    return nullptr;
}

HTMLTableRowsCollection::HTMLTableRowsCollection(HTMLTableElement& table)
    : CachedHTMLCollection(table, CollectionType::TableRows)
{
}

Ref<HTMLTableRowsCollection> HTMLTableRowsCollection::create(HTMLTableElement& table, CollectionType type)
{
    ASSERT_UNUSED(type, type == CollectionType::TableRows);
    return adoptRef(*new HTMLTableRowsCollection(table));
}

Element* HTMLTableRowsCollection::customElementAfter(Element* previous) const
{
    return rowAfter(tableElement(), downcast<HTMLTableRowElement>(previous));
}

}
