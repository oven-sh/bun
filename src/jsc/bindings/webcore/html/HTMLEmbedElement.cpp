/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Stefan Schimanski (1Stein@gmx.de)
 * Copyright (C) 2004-2025 Apple Inc. All rights reserved.
 * Copyright (C) 2008 Nokia Corporation and/or its subsidiary(-ies)
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
#include "HTMLEmbedElement.h"

#include "Attribute.h"
#include "HTMLNames.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLEmbedElement);

using namespace HTMLNames;

inline HTMLEmbedElement::HTMLEmbedElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
    ASSERT(hasTagName(embedTag));
}

Ref<HTMLEmbedElement> HTMLEmbedElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLEmbedElement(tagName, document));
}

bool HTMLEmbedElement::isURLAttribute(const Attribute& attribute) const
{
    return attribute.name() == srcAttr || HTMLElement::isURLAttribute(attribute);
}

}
