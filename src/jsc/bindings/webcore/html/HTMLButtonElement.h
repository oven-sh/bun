/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004, 2005, 2006, 2007, 2010, 2016 Apple Inc. All rights reserved.
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

namespace WebCore {

class HTMLButtonElement final : public HTMLFormControlElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLButtonElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLButtonElement);
public:
    static Ref<HTMLButtonElement> create(const QualifiedName&, Document&);
    static Ref<HTMLButtonElement> create(Document&);
    
    const AtomString& LEGACY_NODELETE value() const;
    String command() const;

    RefPtr<Element> commandForElement() const;
    CommandType commandType() const;

    bool hasActivationBehavior() const final;

private:
    HTMLButtonElement(const QualifiedName& tagName, Document&);

    enum class Type : uint8_t { Submit, Reset, Button };

    const AtomString& formControlType() const final;

    int defaultTabIndex() const final;

    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason) final;
    NeedsPostConnectionSteps insertionSteps(InsertionType, ContainerNode& parentOfInsertedTree) final;
    void removingSteps(RemovalType, ContainerNode& oldParentOfRemovedTree) final;
    void defaultEventHandler(Event&) final;

    void handleCommand();

    bool appendFormData(DOMFormData&) final;

    bool LEGACY_NODELETE isEnumeratable() const final { return true; }
    bool isLabelable() const final { return true; }
    bool isInteractiveContent() const final { return true; }

    bool isSuccessfulSubmitButton() const final;
    bool matchesDefaultPseudoClass() const final;
    bool isActivatedSubmit() const final;
    void setActivatedSubmit(bool flag) final;

    bool LEGACY_NODELETE isURLAttribute(const Attribute&) const final;

    bool LEGACY_NODELETE isOptionalFormControl() const final { return true; }
    bool computeWillValidate() const final;

    bool isSubmitButton() const final;

    void computeType(const AtomString& typeAttrValue);

    Type m_type;
    bool m_isActivatedSubmit;
};

} // namespace
