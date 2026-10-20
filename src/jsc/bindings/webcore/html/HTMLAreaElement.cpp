/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2004, 2005, 2006, 2009, 2011 Apple Inc. All rights reserved.
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
#include "HTMLAreaElement.h"

#include "ElementInlines.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLAreaElement);

using namespace HTMLNames;

inline HTMLAreaElement::HTMLAreaElement(const QualifiedName& tagName, Document& document)
    : HTMLAnchorElement(tagName, document)
{
    ASSERT(hasTagName(areaTag));
}

HTMLAreaElement::~HTMLAreaElement() = default;

Ref<HTMLAreaElement> HTMLAreaElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLAreaElement(tagName, document));
}

bool HTMLAreaElement::supportsFocus() const
{
    // If the AREA element was a link, it should support focus.
    // The inherited method is not used because it assumes that a render object must exist 
    // for the element to support focus. AREA elements do not have render objects.
    return isLink();
}

AtomString HTMLAreaElement::target() const
{
    return attributeWithoutSynchronization(targetAttr);
}

}
