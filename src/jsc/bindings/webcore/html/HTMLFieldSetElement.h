/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Dirk Mueller (mueller@kde.org)
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
 *
 */

#pragma once

#include "HTMLFormControlElement.h"
#include <wtf/WeakHashSet.h>

namespace WebCore {

class HTMLFieldSetElement final : public HTMLFormControlElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLFieldSetElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLFieldSetElement);
public:
    static Ref<HTMLFieldSetElement> create(const QualifiedName&, Document&);

    HTMLLegendElement* LEGACY_NODELETE legend() const;

    Ref<HTMLCollection> elements();

    void addInvalidDescendant(const HTMLElement&);
    void removeInvalidDescendant(const HTMLElement&);

private:
    HTMLFieldSetElement(const QualifiedName&, Document&);
    ~HTMLFieldSetElement();

    bool isDisabledFormControl() const final;
    bool isActuallyDisabled() const final;
    bool LEGACY_NODELETE isEnumeratable() const final { return true; }
    bool supportsFocus() const final;
    const AtomString& formControlType() const final;
    bool computeWillValidate() const final { return false; }
    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason) final;
    void disabledStateChanged() final;
    void childrenChanged(const ChildChange&) final;
    void didMoveToNewDocument(Document& oldDocument, Document& newDocument) final;

    bool matchesValidPseudoClass() const final;
    bool matchesInvalidPseudoClass() const final;

    WeakHashSet<HTMLElement, WeakPtrImplWithEventTargetData> m_invalidDescendants;
};

} // namespace
