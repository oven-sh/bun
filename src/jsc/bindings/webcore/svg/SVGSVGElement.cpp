/*
 * Copyright (C) 2004, 2005, 2006, 2019 Nikolas Zimmermann <zimmermann@kde.org>
 * Copyright (C) 2004, 2005, 2006, 2007, 2008, 2010 Rob Buis <buis@kde.org>
 * Copyright (C) 2007-2025 Apple Inc. All rights reserved.
 * Copyright (C) 2015-2022 Google Inc. All rights reserved.
 * Copyright (C) 2014 Adobe Systems Incorporated. All rights reserved.
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
#include "SVGSVGElement.h"

#include "ElementInlines.h"
#include "SVGNames.h"
#include "SVGNumber.h"
#include "SVGRect.h"
#include "TypedElementDescendantIteratorInlines.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(SVGSVGElement);

inline SVGSVGElement::SVGSVGElement(const QualifiedName& tagName, Document& document)
    : SVGGraphicsElement(tagName, document)
{
    ASSERT(hasTagName(SVGNames::svgTag));
}

Ref<SVGSVGElement> SVGSVGElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new SVGSVGElement(tagName, document));
}

Ref<SVGNumber> SVGSVGElement::createSVGNumber()
{
    return SVGNumber::create();
}

Ref<SVGRect> SVGSVGElement::createSVGRect()
{
    return SVGRect::create();
}

// The tree scope's map of ids knows connected elements only, and this has to work in a tree that is not connected.
Element* SVGSVGElement::getElementById(const AtomString& id)
{
    if (id.isNull())
        return nullptr;

    for (auto& element : descendantsOfType<Element>(*this)) {
        if (element.getIdAttribute() == id)
            return &element;
    }
    return nullptr;
}

} // namespace WebCore
