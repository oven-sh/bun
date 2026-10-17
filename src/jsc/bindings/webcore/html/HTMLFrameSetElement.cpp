/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Simon Hausmann (hausmann@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2026 Apple Inc. All rights reserved.
 * Copyright (C) 2025 Samuel Weinig <sam@webkit.org>
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
#include "HTMLFrameSetElement.h"

#include "DOMWrapperWorld.h"
#include "Document.h"
#include "HTMLBodyElement.h"
#include "HTMLNames.h"
#include "NodeDocument.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLFrameSetElement);

using namespace HTMLNames;

inline HTMLFrameSetElement::HTMLFrameSetElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
    ASSERT(hasTagName(framesetTag));
}

Ref<HTMLFrameSetElement> HTMLFrameSetElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLFrameSetElement(tagName, document));
}

void HTMLFrameSetElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    auto& eventName = HTMLBodyElement::eventNameForWindowEventHandlerAttribute(name);
    if (!eventName.isNull())
        protect(document())->setWindowAttributeEventListener(eventName, name, newValue, mainThreadNormalWorldSingleton());
    else
        HTMLElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);
}

} // namespace WebCore
