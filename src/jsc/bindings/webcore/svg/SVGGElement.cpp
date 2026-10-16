/*
 * Copyright (C) 2004, 2005, 2007, 2008 Nikolas Zimmermann <zimmermann@kde.org>
 * Copyright (C) 2004, 2005, 2006 Rob Buis <buis@kde.org>
 * Copyright (C) 2018-2026 Apple Inc. All rights reserved.
* Copyright (C) 2017 Google Inc. All rights reserved.
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
#include "SVGGElement.h"

#include "SVGNames.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(SVGGElement);

inline SVGGElement::SVGGElement(const QualifiedName& tagName, Document& document)
    : SVGGraphicsElement(tagName, document)
{
    ASSERT(hasTagName(SVGNames::gTag));
}

Ref<SVGGElement> SVGGElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new SVGGElement(tagName, document));
}

} // namespace WebCore
