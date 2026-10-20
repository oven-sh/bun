/*
 * Copyright (C) 2007-2024 Apple Inc. All rights reserved.
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
#include "RadioButtonGroups.h"

#include "HTMLInputElement.h"
#include "NodeDocument.h"
#include <wtf/HashSet.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/WeakPtr.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(RadioButtonGroups);

class RadioButtonGroup {
    WTF_MAKE_TZONE_ALLOCATED(RadioButtonGroup);
public:
    bool LEGACY_NODELETE isEmpty() const { return m_members.isEmptyIgnoringNullReferences(); }
    bool LEGACY_NODELETE isRequired() const { return m_requiredCount; }
    RefPtr<HTMLInputElement> LEGACY_NODELETE checkedButton() const { return m_checkedButton; }
    void add(HTMLInputElement&);
    void updateCheckedState(HTMLInputElement&);
    void requiredStateChanged(HTMLInputElement&);
    void remove(HTMLInputElement&);
    bool LEGACY_NODELETE contains(HTMLInputElement&) const;

private:
    void updateValidityForAllButtons();
    bool LEGACY_NODELETE isValid() const;
    void setCheckedButton(HTMLInputElement*);

    WeakHashSet<HTMLInputElement, WeakPtrImplWithEventTargetData> m_members;
    WeakPtr<HTMLInputElement, WeakPtrImplWithEventTargetData> m_checkedButton;
    size_t m_requiredCount { 0 };
};

WTF_MAKE_TZONE_ALLOCATED_IMPL(RadioButtonGroup);

inline bool LEGACY_NODELETE RadioButtonGroup::isValid() const
{
    return !isRequired() || m_checkedButton;
}

void RadioButtonGroup::setCheckedButton(HTMLInputElement* button)
{
    RefPtr oldCheckedButton = m_checkedButton.get();
    if (oldCheckedButton == button)
        return;

    m_checkedButton = button;
    if (oldCheckedButton)
        oldCheckedButton->setChecked(false);
}

void RadioButtonGroup::add(HTMLInputElement& button)
{
    ASSERT(button.isRadioButton());
    if (!m_members.add(button).isNewEntry)
        return;
    bool groupWasValid = isValid();
    if (button.isRequired())
        ++m_requiredCount;
    if (button.checked())
        setCheckedButton(&button);

    bool groupIsValid = isValid();
    if (groupWasValid != groupIsValid)
        updateValidityForAllButtons();
    else if (!groupIsValid) {
        // A radio button not in a group is always valid. We need to make it
        // invalid only if the group is invalid.
        button.updateValidity();
    }
}

void RadioButtonGroup::updateCheckedState(HTMLInputElement& button)
{
    ASSERT(button.isRadioButton());
    ASSERT(m_members.contains(button));
    bool wasValid = isValid();
    if (button.checked())
        setCheckedButton(&button);
    else {
        if (m_checkedButton == &button)
            setCheckedButton(nullptr);
    }
    if (wasValid != isValid())
        updateValidityForAllButtons();
}

void RadioButtonGroup::requiredStateChanged(HTMLInputElement& button)
{
    ASSERT(button.isRadioButton());
    ASSERT(m_members.contains(button));
    bool wasValid = isValid();
    if (button.isRequired())
        ++m_requiredCount;
    else {
        ASSERT(m_requiredCount);
        --m_requiredCount;
    }
    if (wasValid != isValid())
        updateValidityForAllButtons();
}

void RadioButtonGroup::remove(HTMLInputElement& button)
{
    ASSERT(button.isRadioButton());
    if (!m_members.contains(button))
        return;

    bool wasValid = isValid();
    m_members.remove(button);
    if (button.isRequired()) {
        ASSERT(m_requiredCount);
        --m_requiredCount;
    }
    if (m_checkedButton == &button)
        m_checkedButton = nullptr;

    if (m_members.isEmptyIgnoringNullReferences()) {
        ASSERT(!m_requiredCount);
        ASSERT(!m_checkedButton);
    } else if (wasValid != isValid())
        updateValidityForAllButtons();
    if (!wasValid) {
        // A radio button not in a group is always valid. We need to make it
        // valid only if the group was invalid.
        button.updateValidity();
    }
}

void RadioButtonGroup::updateValidityForAllButtons()
{
    for (Ref button : m_members) {
        ASSERT(button->isRadioButton());
        button->updateValidity();
    }
}

bool LEGACY_NODELETE RadioButtonGroup::contains(HTMLInputElement& button) const
{
    return m_members.contains(button);
}

// ----------------------------------------------------------------

// Explicitly define default constructor and destructor here outside the header
// so we can compile the header without including the definition of RadioButtonGroup.
RadioButtonGroups::RadioButtonGroups() = default;
RadioButtonGroups::~RadioButtonGroups() = default;

void RadioButtonGroups::clear()
{
    m_nameToGroupMap.clear();
}

void RadioButtonGroups::addButton(HTMLInputElement& element)
{
    ASSERT(element.isRadioButton());
    if (element.name().isEmpty())
        return;

    auto& group = m_nameToGroupMap.add(element.name().impl(), nullptr).iterator->value;
    if (!group)
        group = makeUnique<RadioButtonGroup>();
    group->add(element);
}

void RadioButtonGroups::updateCheckedState(HTMLInputElement& element)
{
    ASSERT(element.isRadioButton());
    if (element.name().isEmpty())
        return;
    if (auto* group = m_nameToGroupMap.get(element.name()))
        group->updateCheckedState(element);
}

void RadioButtonGroups::requiredStateChanged(HTMLInputElement& element)
{
    ASSERT(element.isRadioButton());
    if (element.name().isEmpty())
        return;
    if (auto* group = m_nameToGroupMap.get(element.name()))
        group->requiredStateChanged(element);
}

RefPtr<HTMLInputElement> RadioButtonGroups::checkedButtonForGroup(const AtomString& name) const
{
    m_nameToGroupMap.checkConsistency();
    auto* group = m_nameToGroupMap.get(name.impl());
    return group ? group->checkedButton() : nullptr;
}

bool RadioButtonGroups::hasCheckedButton(const HTMLInputElement& element) const
{
    ASSERT(element.isRadioButton());
    auto& name = element.name();
    if (name.isEmpty())
        return element.checked();
    auto* group = m_nameToGroupMap.get(name.impl());
    // FIXME: Update the radio button group before author script had a chance to run in postConnectionSteps().
    return group && group->checkedButton();
}

bool RadioButtonGroups::isInRequiredGroup(HTMLInputElement& element) const
{
    ASSERT(element.isRadioButton());
    if (element.name().isEmpty())
        return false;
    auto* group = m_nameToGroupMap.get(element.name());
    return group && group->isRequired() && group->contains(element);
}

void RadioButtonGroups::removeButton(HTMLInputElement& element)
{
    ASSERT(element.isRadioButton());
    if (element.name().isEmpty())
        return;

    m_nameToGroupMap.checkConsistency();
    auto it = m_nameToGroupMap.find(element.name());
    if (it == m_nameToGroupMap.end())
        return;
    it->value->remove(element);
    if (it->value->isEmpty())
        m_nameToGroupMap.remove(it);
}

} // namespace
