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
#include "HTMLTableColElement.h"

#include "ContainerNodeInlines.h"
#include "ElementInlines.h"
#include "HTMLNames.h"
#include "HTMLParserIdioms.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLTableColElement);

const unsigned defaultSpan { 1 };
const unsigned minSpan { 1 };
const unsigned maxSpan { 1000 };

using namespace HTMLNames;

inline HTMLTableColElement::HTMLTableColElement(const QualifiedName& tagName, Document& document)
    : HTMLTablePartElement(tagName, document)
    , m_span(1)
{
}

Ref<HTMLTableColElement> HTMLTableColElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLTableColElement(tagName, document));
}

void HTMLTableColElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    HTMLTablePartElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);

    if (name == spanAttr)
        m_span = clampHTMLNonNegativeIntegerToRange(newValue, minSpan, maxSpan, defaultSpan);
}

void HTMLTableColElement::setSpan(unsigned span)
{
    setUnsignedIntegralAttribute(spanAttr, limitToOnlyHTMLNonNegative(span, defaultSpan));
}

}
