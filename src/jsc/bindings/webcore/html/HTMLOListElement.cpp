/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2010 Apple Inc. All rights reserved.
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
 *
 */

#include "config.h"
#include "HTMLOListElement.h"

#include "HTMLNames.h"
#include "HTMLParserIdioms.h"
#include "NodeName.h"
#include <wtf/TZoneMallocInlines.h>

// FIXME: There should be a standard way to turn a std::expected into a Optional.
// Maybe we should put this into the header file for Expected and give it a better name.
template<typename T, typename E> inline std::optional<T> optionalValue(std::expected<T, E>&& expected)
{
    return expected ? std::optional<T>(WTF::move(expected.value())) : std::nullopt;
}

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLOListElement);

using namespace HTMLNames;

inline HTMLOListElement::HTMLOListElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
    ASSERT(hasTagName(olTag));
}

Ref<HTMLOListElement> HTMLOListElement::create(Document& document)
{
    return adoptRef(*new HTMLOListElement(olTag, document));
}

Ref<HTMLOListElement> HTMLOListElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLOListElement(tagName, document));
}

void HTMLOListElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    switch (name.nodeName()) {
    case AttributeNames::startAttr:
        m_start = optionalValue(parseHTMLInteger(newValue));
        break;
    default:
        HTMLElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);
        break;
    }
}

}
