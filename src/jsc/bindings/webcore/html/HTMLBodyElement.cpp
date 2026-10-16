/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Simon Hausmann (hausmann@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2023 Apple Inc. All rights reserved.
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
#include "HTMLBodyElement.h"

#include "DOMClientData.h"
#include "DOMWrapperWorld.h"
#include "ElementInlines.h"
#include "EventNames.h"
#include "HTMLNames.h"
#include "JSHTMLBodyElement.h"
#include "NodeName.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLBodyElement);

using namespace HTMLNames;

HTMLBodyElement::HTMLBodyElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
    ASSERT(hasTagName(bodyTag));
}

Ref<HTMLBodyElement> HTMLBodyElement::create(Document& document)
{
    return adoptRef(*new HTMLBodyElement(bodyTag, document));
}

Ref<HTMLBodyElement> HTMLBodyElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLBodyElement(tagName, document));
}

HTMLBodyElement::~HTMLBodyElement() = default;

const AtomString& HTMLBodyElement::eventNameForWindowEventHandlerAttribute(const QualifiedName& attributeName)
{
    auto& localName = attributeName.localName();
    if (localName.length() < 3 || localName[0] != 'o' || localName[1] != 'n')
        return nullAtom();

    auto& map = domClientData().windowEventHandlerNames();
    if (map.isEmpty()) {
        JSHTMLBodyElement::forEachWindowEventHandlerContentAttribute([&] (const AtomString& attributeName, const AtomString& eventName) {
            map.add(attributeName, eventName);
        });
    }
    return eventNameForEventHandlerAttribute(attributeName, map);
}

void HTMLBodyElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    Ref document = this->document();
    switch (name.nodeName()) {
    case AttributeNames::onselectionchangeAttr:
        // FIXME: Emit "selectionchange" event at <input> / <textarea> elements and remove this special-case.
        // https://bugs.webkit.org/show_bug.cgi?id=234348
        document->setAttributeEventListener(eventNames().selectionchangeEvent, name, newValue, mainThreadNormalWorldSingleton());
        return;
    default:
        break;
    }

    if (auto& eventName = eventNameForWindowEventHandlerAttribute(name); !eventName.isNull()) {
        document->setWindowAttributeEventListener(eventName, name, newValue, mainThreadNormalWorldSingleton());
        return;
    }

    HTMLElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);
}

bool HTMLBodyElement::isURLAttribute(const Attribute& attribute) const
{
    return attribute.name() == backgroundAttr || HTMLElement::isURLAttribute(attribute);
}

bool HTMLBodyElement::supportsFocus() const
{
    return hasEditableStyle() || HTMLElement::supportsFocus();
}

} // namespace WebCore
