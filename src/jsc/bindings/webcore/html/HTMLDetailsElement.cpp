/*
 * Copyright (C) 2010, 2011 Nokia Corporation and/or its subsidiary(-ies)
 * Copyright (C) 2018 Apple Inc. All rights reserved.
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
#include "HTMLDetailsElement.h"

#include "ContainerNodeInlines.h"
#include "ElementChildIteratorInlines.h"
#include "EventNames.h"
#include "HTMLSummaryElement.h"
#include "ToggleEvent.h"
#include "ToggleEventTask.h"
#include "TypedElementDescendantIteratorInlines.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLDetailsElement);

using namespace HTMLNames;

Ref<HTMLDetailsElement> HTMLDetailsElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLDetailsElement(tagName, document));
}

HTMLDetailsElement::HTMLDetailsElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
    ASSERT(hasTagName(detailsTag));
}

HTMLDetailsElement::~HTMLDetailsElement() = default;

bool HTMLDetailsElement::isActiveSummary(const HTMLSummaryElement& summary) const
{
    return &summary == childrenOfType<HTMLSummaryElement>(*this).first();
}

void HTMLDetailsElement::queueDetailsToggleEventTask(ToggleState oldState, ToggleState newState)
{
    if (!m_toggleEventTask)
        lazyInitialize(m_toggleEventTask, ToggleEventTask::create(*this));

    RefPtr { m_toggleEventTask }->queue(oldState, newState, nullptr);
}

void HTMLDetailsElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    HTMLElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);
    if (name == openAttr) {
        if (oldValue != newValue) {
            m_isOpen = !newValue.isNull();
            if (!newValue.isNull()) {
                queueDetailsToggleEventTask(ToggleState::Closed, ToggleState::Open);
                if (!attributeWithoutSynchronization(nameAttr).isEmpty()) {
                    for (auto& otherDetailsElement : otherElementsInNameGroup())
                        otherDetailsElement->removeAttribute(openAttr);
                }
            } else
                queueDetailsToggleEventTask(ToggleState::Open, ToggleState::Closed);
        }
    } else if (name == nameAttr)
        ensureDetailsExclusivityAfterMutation();
}

Node::NeedsPostConnectionSteps HTMLDetailsElement::insertionSteps(InsertionType insertionType, ContainerNode& parentOfInsertedTree)
{
    HTMLElement::insertionSteps(insertionType, parentOfInsertedTree);

    m_shouldCloseElementAfterInsertion = shouldClose();

    if (!insertionType.connectedToDocument)
        return NeedsPostConnectionSteps::No;
    return NeedsPostConnectionSteps::Yes;
}

void HTMLDetailsElement::postConnectionSteps()
{
    // FIXME: Spec makes this DOM mutation synchronously in "insertion steps"
    // but our current model of insertionSteps is not compatible with that.
    if (hasAttributeWithoutSynchronization(openAttr) && m_shouldCloseElementAfterInsertion)
        toggleOpen();
    m_shouldCloseElementAfterInsertion = false;
}

Vector<Ref<HTMLDetailsElement>> HTMLDetailsElement::otherElementsInNameGroup() const
{
    Vector<Ref<HTMLDetailsElement>> otherElementsInNameGroup;
    const auto& detailElementName = attributeWithoutSynchronization(nameAttr);
    for (Ref element : descendantsOfType<HTMLDetailsElement>(rootNode())) {
        if (element.ptr() != this && element->attributeWithoutSynchronization(nameAttr) == detailElementName)
            otherElementsInNameGroup.append(WTF::move(element));
    }
    return otherElementsInNameGroup;
}

void HTMLDetailsElement::ensureDetailsExclusivityAfterMutation()
{
    if (!shouldClose())
        return;
    toggleOpen();
}

bool HTMLDetailsElement::shouldClose() const
{
    const auto& detailElementName = attributeWithoutSynchronization(nameAttr);
    if (hasAttributeWithoutSynchronization(openAttr) && !detailElementName.isEmpty()) {
        for (auto& otherElement : otherElementsInNameGroup()) {
            if (otherElement->hasAttributeWithoutSynchronization(openAttr))
                return true;
        }
    }
    return false;
}

void HTMLDetailsElement::toggleOpen()
{
    setBooleanAttribute(HTMLNames::openAttr, !hasAttributeWithoutSynchronization(HTMLNames::openAttr));
}

bool HTMLDetailsElement::isOpen() const
{
    return m_isOpen;
}

} // namespace WebCore
