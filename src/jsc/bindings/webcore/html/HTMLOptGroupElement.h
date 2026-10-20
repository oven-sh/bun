/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2026 Apple Inc. All rights reserved.
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

class HTMLSelectElement;

class HTMLOptGroupElement final : public HTMLElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLOptGroupElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLOptGroupElement);
public:
    static Ref<HTMLOptGroupElement> create(const QualifiedName&, Document&);

    bool isDisabledFormControl() const final;
    bool isActuallyDisabled() const final;
    WEBCORE_EXPORT HTMLSelectElement* LEGACY_NODELETE ownerSelectElement() const;

private:
    HTMLOptGroupElement(const QualifiedName&, Document&);

    NeedsPostConnectionSteps insertionSteps(InsertionType, ContainerNode&) final;
    void removingSteps(RemovalType, ContainerNode& oldParentOfRemovedTree) final;
    void movingSteps(MovingType, ContainerNode& oldParent) final;

    bool isFocusable() const final;
    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason) final;
    void parseDisabledAttribute(const AtomString&);

    bool accessKeyAction(bool sendMouseEvents) final;

    void recalcSelectOptions();

    bool m_isDisabled { false };
    WeakPtr<HTMLSelectElement, WeakPtrImplWithEventTargetData> m_ownerSelect;
};

} // namespace WebCore
