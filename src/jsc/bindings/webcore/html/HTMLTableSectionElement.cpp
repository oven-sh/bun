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
#include "HTMLTableSectionElement.h"

#include "GenericCachedHTMLCollection.h"
#include "HTMLNames.h"
#include "HTMLTableRowElement.h"
#include "NodeList.h"
#include "NodeRareData.h"
#include "Text.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLTableSectionElement);

using namespace HTMLNames;

inline HTMLTableSectionElement::HTMLTableSectionElement(const QualifiedName& tagName, Document& document)
    : HTMLTablePartElement(tagName, document)
{
}

Ref<HTMLTableSectionElement> HTMLTableSectionElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLTableSectionElement(tagName, document));
}

ExceptionOr<Ref<HTMLTableRowElement>> HTMLTableSectionElement::insertRow(int index)
{
    if (index < -1)
        return Exception { ExceptionCode::IndexSizeError };
    auto children = rows();
    int numRows = children->length();
    if (index > numRows)
        return Exception { ExceptionCode::IndexSizeError };
    Ref row = HTMLTableRowElement::create(trTag, protect(document()));
    ExceptionOr<void> result;
    if (numRows == index || index == -1)
        result = appendChild(row);
    else
        result = insertBefore(row, children->item(index));
    if (result.hasException())
        return result.releaseException();
    return row;
}

ExceptionOr<void> HTMLTableSectionElement::deleteRow(int index)
{
    auto children = rows();
    int numRows = children->length();
    if (index == -1) {
        if (!numRows)
            return { };
        index = numRows - 1;
    }
    if (index < 0 || index >= numRows)
        return Exception { ExceptionCode::IndexSizeError };
    return removeChild(Ref { *children->item(index) });
}

Ref<HTMLCollection> HTMLTableSectionElement::rows()
{
    return ensureRareData().ensureNodeLists().addCachedCollection<HTMLTSectionRowsCollection>(*this);
}

}
