/*
 * Copyright (C) 1997 Martin Jones (mjones@kde.org)
 *           (C) 1997 Torben Weis (weis@kde.org)
 *           (C) 1998 Waldo Bastian (bastian@kde.org)
 *           (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2003, 2004, 2005, 2006, 2010 Apple Inc. All rights reserved.
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
#include "HTMLTableCellElement.h"

#include "ContainerNodeInlines.h"
#include "ElementInlines.h"
#include "HTMLNames.h"
#include "HTMLParserIdioms.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLTableCellElement);

using namespace HTMLNames;

Ref<HTMLTableCellElement> HTMLTableCellElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLTableCellElement(tagName, document));
}

HTMLTableCellElement::HTMLTableCellElement(const QualifiedName& tagName, Document& document)
    : HTMLTablePartElement(tagName, document)
{
    ASSERT(hasLocalName(thTag->localName()) || hasLocalName(tdTag->localName()));
}

unsigned HTMLTableCellElement::colSpan() const
{
    return clampHTMLNonNegativeIntegerToRange(attributeWithoutSynchronization(colspanAttr), minColspan, maxColspan, defaultColspan);
}

unsigned HTMLTableCellElement::rowSpan() const
{
    return clampHTMLNonNegativeIntegerToRange(attributeWithoutSynchronization(rowspanAttr), minRowspan, maxRowspan, defaultRowspan);
}

int HTMLTableCellElement::cellIndex() const
{
    int index = 0;
    if (!parentElement() || !parentElement()->hasTagName(trTag))
        return -1;

    for (const Node * node = previousSibling(); node; node = node->previousSibling()) {
        if (node->hasTagName(tdTag) || node->hasTagName(thTag))
            index++;
    }
    
    return index;
}

bool HTMLTableCellElement::isURLAttribute(const Attribute& attribute) const
{
    return attribute.name() == backgroundAttr || HTMLTablePartElement::isURLAttribute(attribute);
}

void HTMLTableCellElement::setColSpan(unsigned number)
{
    setAttributeWithoutSynchronization(colspanAttr, AtomString::number(limitToOnlyHTMLNonNegative(number, 1)));
}

void HTMLTableCellElement::setRowSpan(unsigned number)
{
    setAttributeWithoutSynchronization(rowspanAttr, AtomString::number(limitToOnlyHTMLNonNegative(number, 1)));
}

AtomString HTMLTableCellElement::scope() const
{
    // https://html.spec.whatwg.org/multipage/tables.html#attr-th-scope
    const AtomString& value = attributeWithoutSynchronization(HTMLNames::scopeAttr);

    if (equalLettersIgnoringASCIICase(value, "row"_s))
        return "row"_s;
    if (equalLettersIgnoringASCIICase(value, "col"_s))
        return "col"_s;
    if (equalLettersIgnoringASCIICase(value, "rowgroup"_s))
        return "rowgroup"_s;
    if (equalLettersIgnoringASCIICase(value, "colgroup"_s))
        return "colgroup"_s;
    return emptyAtom();
}

} // namespace WebCore
