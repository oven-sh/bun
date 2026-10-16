/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 *           (C) 2006 Alexey Proskuryakov (ap@nypop.com)
 * Copyright (C) 2004-2026 Apple Inc. All rights reserved.
 * Copyright (C) 2010-2017 Google Inc. All rights reserved.
 * Copyright (C) 2011 Motorola Mobility, Inc. All rights reserved.
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
#include "HTMLOptionElement.h"

#include "ContainerNodeInlines.h"
#include "Document.h"
#include "ElementAncestorIteratorInlines.h"
#include "HTMLDataListElement.h"
#include "HTMLHRElement.h"
#include "HTMLNames.h"
#include "HTMLOptGroupElement.h"
#include "HTMLSelectElement.h"
#include "HTMLSelectedContentElement.h"
#include "NodeName.h"
#include "Text.h"
#include <wtf/Ref.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLOptionElement);

using namespace HTMLNames;

HTMLOptionElement::HTMLOptionElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
    ASSERT(hasTagName(optionTag));
}

Ref<HTMLOptionElement> HTMLOptionElement::create(Document& document)
{
    return adoptRef(*new HTMLOptionElement(optionTag, document));
}

Ref<HTMLOptionElement> HTMLOptionElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLOptionElement(tagName, document));
}

ExceptionOr<Ref<HTMLOptionElement>> HTMLOptionElement::createForLegacyFactoryFunction(Document& document, String&& text, const AtomString& value, bool defaultSelected, bool selected)
{
    Ref element = create(document);

    if (!text.isEmpty()) {
        auto appendResult = element->appendChild(Text::create(document, WTF::move(text)));
        if (appendResult.hasException())
            return appendResult.releaseException();
    }

    if (!value.isNull())
        element->setAttributeWithoutSynchronization(valueAttr, value);
    if (defaultSelected)
        element->setAttributeWithoutSynchronization(selectedAttr, emptyAtom());
    element->setSelected(selected);

    return element;
}

auto HTMLOptionElement::insertionSteps(InsertionType insertionType, ContainerNode& parentOfInsertedTree) -> NeedsPostConnectionSteps
{
    auto result = HTMLElement::insertionSteps(insertionType, parentOfInsertedTree);

    if (!m_ownerSelect) {
        if (RefPtr select = HTMLSelectElement::findOwnerSelect(parentNode(), HTMLSelectElement::ExcludeOptGroup::No)) {
            m_ownerSelect = select.get();
            select->setRecalcListItems();
            // If this non-selected option is the first non-disabled option in a
            // single-select that has no explicitly selected option, select it by
            // default. This maintains m_isSelected incrementally so that
            // finishParsingChildren() can use selectedWithoutUpdate() (O(1))
            // instead of selected() which triggers O(n) recalcListItems().
            // Only do this during parsing — for API insertions, the existing
            // childrenChanged → optionToSelectFromChildChangeScope path handles it.
            if (!select->isFinishedParsingChildren() && !selectedWithoutUpdate() && !isDisabledFormControl())
                select->selectDefaultOptionIfNeeded(*this);
        }
    }

    if (insertionType.connectedToDocument && m_ownerSelect)
        result = NeedsPostConnectionSteps::Yes;

    return result;
}

void HTMLOptionElement::postConnectionSteps()
{
    RefPtr select = m_ownerSelect;
    if (!select || !select->hasSelectedContentDescendants())
        return;

    if (select->multiple())
        return;

    bool isSelected = select->isFinishedParsingChildren() ? selected() : selectedWithoutUpdate();
    if (isSelected)
        select->updateSelectedContent(this);
}

void HTMLOptionElement::removingSteps(RemovalType removalType, ContainerNode& oldParentOfRemovedTree)
{
    HTMLElement::removingSteps(removalType, oldParentOfRemovedTree);

    if (!m_ownerSelect)
        return;

    if (auto* select = HTMLSelectElement::findOwnerSelect(parentNode(), HTMLSelectElement::ExcludeOptGroup::No)) {
        ASSERT_UNUSED(select, select == m_ownerSelect.get());
        return;
    }

    if (RefPtr select = std::exchange(m_ownerSelect, nullptr).get()) {
        select->setRecalcListItems();
        if (m_isSelected)
            select->queueSelectedContentUpdate();
    }
}

void HTMLOptionElement::movingSteps(MovingType movingType, ContainerNode& oldParent)
{
    HTMLElement::movingSteps(movingType, oldParent);

    RefPtr oldSelect = m_ownerSelect;
    RefPtr newSelect = HTMLSelectElement::findOwnerSelect(parentNode(), HTMLSelectElement::ExcludeOptGroup::No);
    if (oldSelect == newSelect) {
        if (newSelect)
            newSelect->setRecalcListItems();
        return;
    }

    m_ownerSelect = newSelect.get();

    if (oldSelect) {
        oldSelect->setRecalcListItems();
        if (m_isSelected)
            oldSelect->queueSelectedContentUpdate();
    }

    if (newSelect) {
        newSelect->setRecalcListItems();
        if (m_isSelected)
            newSelect->queueSelectedContentUpdate();
    }
}

void HTMLOptionElement::finishParsingChildren()
{
    if (m_disabled)
        return;

    RefPtr select = m_ownerSelect;
    if (!select || select->multiple())
        return;

    // When the owning <select> is still being parsed, use selectedWithoutUpdate()
    // instead of selected() to avoid triggering recalcListItems() for each
    // option, which would be O(n²). The selection state (m_isSelected) is
    // maintained incrementally at insertion time — see insertionSteps() and
    // optionToSelectFromChildChangeScope().
    bool isSelected = select->isFinishedParsingChildren() ? selected() : selectedWithoutUpdate();
    if (!isSelected)
        return;

    // Pass `this` to avoid updateSelectedContent() calling listItems() to find
    // the selected option, which would also trigger recalcListItems().
    select->updateSelectedContent(this);
}

bool HTMLOptionElement::isFocusable() const
{
    RefPtr select = ownerSelectElement();
    if (select && select->usesMenuList())
        return false;
    return HTMLElement::isFocusable();
}

String HTMLOptionElement::text() const
{
    return htmlAwareTextContent(*this, IncludeAltText::No);
}

void HTMLOptionElement::setText(String&& text)
{
    Ref protectedThis { *this };

    // Changing the text causes a recalc of a select's items, which will reset the selected
    // index to the first item if the select is a single select dropdown box. We attempt to
    // preserve the selected item.
    RefPtr select = ownerSelectElement();
    bool isSingleSelectDropdownBox = select && select->usesMenuList();
    int oldSelectedIndex = isSingleSelectDropdownBox ? select->selectedIndex() : -1;

    setTextContent(WTF::move(text));

    if (isSingleSelectDropdownBox && select->selectedIndex() != oldSelectedIndex)
        select->setSelectedIndex(oldSelectedIndex);
}

HTMLFormElement* HTMLOptionElement::form() const
{
    if (auto* selectElement = ownerSelectElement())
        return selectElement->form();
    return nullptr;
}

RefPtr<HTMLFormElement> HTMLOptionElement::formForBindings() const
{
    // FIXME: The downcast should be unnecessary, but the WPT was written before https://github.com/WICG/webcomponents/issues/1072 was resolved. Update once the WPT has been updated.
    return dynamicDowncast<HTMLFormElement>(retargetReferenceTargetForBindings(form()));
}

int HTMLOptionElement::index() const
{
    // It would be faster to cache the index, but harder to get it right in all cases.

    RefPtr selectElement = ownerSelectElement();
    if (!selectElement)
        return 0;

    int optionIndex = 0;

    for (auto& item : selectElement->listItems()) {
        if (!is<HTMLOptionElement>(*item))
            continue;
        if (item == this)
            return optionIndex;
        ++optionIndex;
    }

    return 0;
}

void HTMLOptionElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    switch (name.nodeName()) {
    case AttributeNames::disabledAttr:
        parseDisabledAttribute(newValue);
        break;
    case AttributeNames::selectedAttr: {
        m_isDefault = !newValue.isNull();

        // https://html.spec.whatwg.org/multipage/form-elements.html#concept-option-selectedness
        if (oldValue.isNull() != newValue.isNull() && !m_isDirty)
            setSelected(!newValue.isNull());
        break;
    }
    case AttributeNames::labelAttr: {
        if (RefPtr select = ownerSelectElement())
            select->optionElementChildrenChanged();
        break;
    }
    default:
        HTMLElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);
        break;
    }
}

void HTMLOptionElement::parseDisabledAttribute(const AtomString& value)
{
    bool newDisabled = !value.isNull();
    if (m_disabled == newDisabled)
        return;

    RefPtr select = ownerSelectElement();
    RefPtr oldSelectedOption = select ? select->selectedOptionForSelectedContent() : nullptr;
    m_disabled = newDisabled;

    if (select)
        select->resetSelectedness(oldSelectedOption.get());
}

String HTMLOptionElement::value() const
{
    const AtomString& value = attributeWithoutSynchronization(valueAttr);
    if (!value.isNull())
        return value;
    return htmlAwareTextContent(*this, IncludeAltText::No);
}

bool HTMLOptionElement::selected() const
{
    if (RefPtr select = ownerSelectElement())
        select->updateListItemSelectedStates();
    return m_isSelected;
}

void HTMLOptionElement::setSelected(bool selected)
{
    if (m_isSelected == selected)
        return;

    setSelectedState(selected);

    if (RefPtr select = ownerSelectElement())
        select->optionSelectionStateChanged(*this, selected);
}

bool HTMLOptionElement::selectedForBindings() const
{
    return selected();
}

void HTMLOptionElement::setSelectedForBindings(bool selected)
{
    bool wasSelected = m_isSelected;
    setSelected(selected);

    // https://html.spec.whatwg.org/multipage/form-elements.html#concept-option-dirtiness
    // The spec says dirtiness becomes true unconditionally. However, for web
    // compatibility, don't set dirtiness if the option is owned by a select
    // element and selectedness did not actually change.
    if (ownerSelectElement() && wasSelected == m_isSelected)
        return;

    m_isDirty = true;
}

void HTMLOptionElement::setSelectedState(bool selected)
{
    m_isSelected = selected;
}

void HTMLOptionElement::childrenChanged(const ChildChange& change)
{
    if (change.source != ChildChange::Source::Clone) {
        if (RefPtr select = ownerSelectElement())
            select->optionElementChildrenChanged();
    }
    HTMLElement::childrenChanged(change);
}

HTMLSelectElement* HTMLOptionElement::ownerSelectElement() const
{
    return m_ownerSelect.get();
}

String HTMLOptionElement::label() const
{
    String label = attributeWithoutSynchronization(labelAttr);
    if (!label.isNull())
        return label;
    return htmlAwareTextContent(*this, IncludeAltText::No);
}

bool HTMLOptionElement::isDisabledFormControl() const
{
    if (ownElementDisabled())
        return true;

    for (Ref ancestor : ancestorsOfType<HTMLElement>(*this)) {
        if (RefPtr optGroup = dynamicDowncast<HTMLOptGroupElement>(ancestor))
            return optGroup->isDisabledFormControl();
        if (isAnyOf<HTMLDataListElement, HTMLSelectElement, HTMLOptionElement, HTMLHRElement>(ancestor))
            return false;
    }
    return false;
}

bool HTMLOptionElement::isActuallyDisabled() const
{
    if (HTMLElement::isActuallyDisabled())
        return true;
    RefPtr select = ownerSelectElement();
    return select && select->isDisabledFormControl();
}

void HTMLOptionElement::cloneIntoSelectedContent(HTMLSelectedContentElement& selectedContent)
{
    NodeVector newChildren;
    for (RefPtr child = firstChild(); child; child = child->nextSibling())
        newChildren.append(child->cloneNode(CloneSubtree::Yes));
    selectedContent.replaceChildrenWithoutValidityCheck(WTF::move(newChildren));
}

} // namespace
