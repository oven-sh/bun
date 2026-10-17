/*
 * Copyright (C) 1997 Martin Jones (mjones@kde.org)
 *           (C) 1997 Torben Weis (weis@kde.org)
 *           (C) 1998 Waldo Bastian (bastian@kde.org)
 *           (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2003-2023 Apple Inc. All rights reserved.
 * Copyright (C) 2014 Google Inc. All rights reserved.
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
#include "HTMLTableRowElement.h"

#include "ExceptionOr.h"
#include "GenericCachedHTMLCollection.h"
#include "HTMLNames.h"
#include "HTMLTableCellElement.h"
#include "HTMLTableElement.h"
#include "HTMLTableSectionElement.h"
#include "NodeDocument.h"
#include "NodeList.h"
#include "NodeRareData.h"
#include "Text.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLTableRowElement);

using namespace HTMLNames;

inline HTMLTableRowElement::HTMLTableRowElement(const QualifiedName& tagName, Document& document)
    : HTMLTablePartElement(tagName, document)
{
    ASSERT(hasTagName(trTag));
}

Ref<HTMLTableRowElement> HTMLTableRowElement::create(Document& document)
{
    return adoptRef(*new HTMLTableRowElement(trTag, document));
}

Ref<HTMLTableRowElement> HTMLTableRowElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLTableRowElement(tagName, document));
}

HTMLTableRowElement::~HTMLTableRowElement() = default;

static inline RefPtr<HTMLTableElement> LEGACY_NODELETE findTable(const HTMLTableRowElement& row)
{
    auto* parent = row.parentNode();
    if (auto* table = dynamicDowncast<HTMLTableElement>(parent))
        return table;
    if (is<HTMLTableSectionElement>(parent)) {
        if (auto* table = dynamicDowncast<HTMLTableElement>(parent->parentNode()))
            return table;
    }
    return nullptr;
}

int HTMLTableRowElement::rowIndex() const
{
    auto table = findTable(*this);
    if (!table)
        return -1;

    auto rows = table->rows();
    unsigned length = rows->length();
    for (unsigned i = 0; i < length; ++i) {
        if (rows->item(i) == this)
            return i;
    }

    return -1;
}

static inline RefPtr<HTMLCollection> findRows(const HTMLTableRowElement& row)
{
    RefPtr parent = row.parentNode();
    if (RefPtr section = dynamicDowncast<HTMLTableSectionElement>(parent))
        return section->rows();
    if (RefPtr table = dynamicDowncast<HTMLTableElement>(parent))
        return table->rows();
    return nullptr;
}

int HTMLTableRowElement::sectionRowIndex() const
{
    auto rows = findRows(*this);
    if (!rows)
        return -1;

    unsigned length = rows->length();
    for (unsigned i = 0; i < length; ++i) {
        if (rows->item(i) == this)
            return i;
    }

    return -1;
}

ExceptionOr<Ref<HTMLTableCellElement>> HTMLTableRowElement::insertCell(int index)
{
    if (index < -1)
        return Exception { ExceptionCode::IndexSizeError };
    auto children = cells();
    int numCells = children->length();
    if (index > numCells)
        return Exception { ExceptionCode::IndexSizeError };
    Ref cell = HTMLTableCellElement::create(tdTag, protect(document()));
    ExceptionOr<void> result;
    if (numCells == index || index == -1)
        result = appendChild(cell);
    else
        result = insertBefore(cell, children->item(index));
    if (result.hasException())
        return result.releaseException();
    return cell;
}

ExceptionOr<void> HTMLTableRowElement::deleteCell(int index)
{
    auto children = cells();
    int numCells = children->length();
    if (index == -1) {
        if (!numCells)
            return { };
        index = numCells - 1;
    }
    if (index < 0 || index >= numCells)
        return Exception { ExceptionCode::IndexSizeError };
    return removeChild(Ref { *children->item(index) });
}

Ref<HTMLCollection> HTMLTableRowElement::cells()
{
    return ensureRareData().ensureNodeLists().addCachedCollection<HTMLTRCellsCollection>(*this);
}

}
