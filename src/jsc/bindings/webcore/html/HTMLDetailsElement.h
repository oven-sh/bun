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

#pragma once

#include "HTMLElement.h"

namespace WebCore {

class ToggleEventTask;

class HTMLDetailsElement final : public HTMLElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLDetailsElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLDetailsElement);
public:
    static Ref<HTMLDetailsElement> create(const QualifiedName& tagName, Document&);
    ~HTMLDetailsElement();

    void toggleOpen();

    bool isActiveSummary(const HTMLSummaryElement&) const;

    void queueDetailsToggleEventTask(ToggleState oldState, ToggleState newState);

    bool LEGACY_NODELETE isOpen() const;

private:
    HTMLDetailsElement(const QualifiedName&, Document&);

    NeedsPostConnectionSteps insertionSteps(InsertionType, ContainerNode&) final;
    void postConnectionSteps() final;

    Vector<Ref<HTMLDetailsElement>> otherElementsInNameGroup() const;
    void ensureDetailsExclusivityAfterMutation();
    bool shouldClose() const;
    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason) final;

    bool isInteractiveContent() const final { return true; }

    bool m_isOpen { false };
    bool m_shouldCloseElementAfterInsertion { false };

    const RefPtr<ToggleEventTask> m_toggleEventTask;
};

} // namespace WebCore
