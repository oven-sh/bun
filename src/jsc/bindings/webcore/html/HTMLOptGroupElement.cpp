/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2026 Apple Inc. All rights reserved.
 *           (C) 2006 Alexey Proskuryakov (ap@nypop.com)
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
#include "HTMLOptGroupElement.h"

#include "Document.h"
#include "ElementAncestorIteratorInlines.h"
#include "ElementIterator.h"
#include "HTMLNames.h"
#include "HTMLOptionElement.h"
#include "HTMLSelectElement.h"
#include "TypedElementDescendantIteratorInlines.h"
#include <wtf/StdLibExtras.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLOptGroupElement);

using namespace HTMLNames;

inline HTMLOptGroupElement::HTMLOptGroupElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
    ASSERT(hasTagName(optgroupTag));
}

Ref<HTMLOptGroupElement> HTMLOptGroupElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLOptGroupElement(tagName, document));
}

auto HTMLOptGroupElement::insertionSteps(InsertionType insertionType, ContainerNode& parentOfInsertedTree) -> NeedsPostConnectionSteps
{
    auto result = HTMLElement::insertionSteps(insertionType, parentOfInsertedTree);

    if (!m_ownerSelect) {
        if (RefPtr select = HTMLSelectElement::findOwnerSelect(parentNode(), HTMLSelectElement::ExcludeOptGroup::Yes)) {
            m_ownerSelect = select.get();
            select->setRecalcListItems();
        }
    }

    return result;
}

void HTMLOptGroupElement::removingSteps(RemovalType removalType, ContainerNode& oldParentOfRemovedTree)
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

void HTMLOptGroupElement::movingSteps(MovingType movingType, ContainerNode& oldParent)
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

bool HTMLOptGroupElement::isDisabledFormControl() const
{
    return m_isDisabled;
}

bool HTMLOptGroupElement::isActuallyDisabled() const
{
    if (HTMLElement::isActuallyDisabled())
        return true;
    RefPtr select = ownerSelectElement();
    return select && select->isDisabledFormControl();
}

bool HTMLOptGroupElement::isFocusable() const
{
    RefPtr select = ownerSelectElement();
    if (select && select->usesMenuList())
        return false;
    return HTMLElement::isFocusable();
}

void HTMLOptGroupElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    HTMLElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);

    if (name == disabledAttr) {
        parseDisabledAttribute(newValue);
        return;
    }

    recalcSelectOptions();
}

void HTMLOptGroupElement::parseDisabledAttribute(const AtomString& value)
{
    bool newDisabled = !value.isNull();
    if (m_isDisabled == newDisabled)
        return;

    RefPtr select = ownerSelectElement();
    RefPtr oldSelectedOption = select ? select->selectedOptionForSelectedContent() : nullptr;
    m_isDisabled = newDisabled;

    recalcSelectOptions();
    if (select)
        select->resetSelectedness(oldSelectedOption.get());
}

void HTMLOptGroupElement::recalcSelectOptions()
{
    if (RefPtr selectElement = ownerSelectElement()) {
        selectElement->setRecalcListItems();
        selectElement->updateValidity();
    }
}

HTMLSelectElement* HTMLOptGroupElement::ownerSelectElement() const
{
    return m_ownerSelect.get();
}

bool HTMLOptGroupElement::accessKeyAction(bool)
{
    RefPtr select = ownerSelectElement();
    // send to the parent to bring focus to the list box
    if (select && !select->focused())
        return select->accessKeyAction(false);
    return false;
}

} // namespace WebCore
