/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2003-2025 Apple Inc. All rights reserved.
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
#include "HTMLHRElement.h"

#include "ElementInlines.h"
#include "HTMLNames.h"
#include "HTMLSelectElement.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLHRElement);

using namespace HTMLNames;

HTMLHRElement::HTMLHRElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
    ASSERT(hasTagName(hrTag));
}

Ref<HTMLHRElement> HTMLHRElement::create(Document& document)
{
    return adoptRef(*new HTMLHRElement(hrTag, document));
}

Ref<HTMLHRElement> HTMLHRElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLHRElement(tagName, document));
}

auto HTMLHRElement::insertionSteps(InsertionType insertionType, ContainerNode& parentOfInsertedTree) -> NeedsPostConnectionSteps
{
    auto result = HTMLElement::insertionSteps(insertionType, parentOfInsertedTree);

    if (m_ownerSelect)
        return result;

    if (RefPtr select = HTMLSelectElement::findOwnerSelect(parentNode(), HTMLSelectElement::ExcludeOptGroup::Yes)) {
        m_ownerSelect = select.get();
        select->setRecalcListItems();
    }

    return result;
}

void HTMLHRElement::removingSteps(RemovalType removalType, ContainerNode& oldParentOfRemovedTree)
{
    HTMLElement::removingSteps(removalType, oldParentOfRemovedTree);

    if (!m_ownerSelect)
        return;

    if (auto* select = HTMLSelectElement::findOwnerSelect(parentNode(), HTMLSelectElement::ExcludeOptGroup::Yes)) {
        ASSERT_UNUSED(select, select == m_ownerSelect.get());
        return;
    }

    if (RefPtr select = std::exchange(m_ownerSelect, nullptr).get())
        select->setRecalcListItems();
}

void HTMLHRElement::movingSteps(MovingType movingType, ContainerNode& oldParent)
{
    HTMLElement::movingSteps(movingType, oldParent);

    RefPtr oldSelect = m_ownerSelect;
    RefPtr newSelect = HTMLSelectElement::findOwnerSelect(parentNode(), HTMLSelectElement::ExcludeOptGroup::Yes);
    if (oldSelect == newSelect) {
        if (newSelect)
            newSelect->setRecalcListItems();
        return;
    }

    m_ownerSelect = newSelect.get();

    if (oldSelect)
        oldSelect->setRecalcListItems();
    if (newSelect)
        newSelect->setRecalcListItems();
}

}
