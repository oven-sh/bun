/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2004-2017 Apple Inc. All rights reserved.
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

#include "FormListedElement.h"
#include "HTMLElement.h"

namespace WebCore {

class HTMLFormElement;
class Window;

class HTMLObjectElement final : public HTMLElement, public FormListedElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLObjectElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLObjectElement);
public:
    USING_CAN_MAKE_WEAKPTR(HTMLElement);

    static Ref<HTMLObjectElement> create(const QualifiedName&, Document&);

    Document* contentDocument() const { return nullptr; }
    Window* contentWindow() const { return nullptr; }
    Document* getSVGDocument() const { return nullptr; }

    bool willValidate() const final { return false; }

    // Implementation of constraint validation API.
    // Note that the object elements are always barred from constraint validation.
    static bool checkValidity() { return true; }
    static bool reportValidity() { return true; }

    using HTMLElement::ref;
    using HTMLElement::deref;

private:
    HTMLObjectElement(const QualifiedName&, Document&);
    ~HTMLObjectElement();

    int defaultTabIndex() const final;

    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason) final;

    NeedsPostConnectionSteps insertionSteps(InsertionType, ContainerNode&) final;
    void postConnectionSteps() final;
    void removingSteps(RemovalType, ContainerNode&) final;

    void didMoveToNewDocument(Document& oldDocument, Document& newDocument) final;

    bool LEGACY_NODELETE isURLAttribute(const Attribute&) const final;
    bool isReplaced() const final { return true; }

    void refFormAssociatedElement() const final { ref(); }
    void derefFormAssociatedElement() const final { deref(); }

    FormAssociatedElement* LEGACY_NODELETE asFormAssociatedElement() final { return this; }
    FormListedElement* LEGACY_NODELETE asFormListedElement() final { return this; }
    ValidatedFormListedElement* LEGACY_NODELETE asValidatedFormListedElement() final { return nullptr; }

    // These functions can be called concurrently for ValidityState.
    HTMLObjectElement& asHTMLElement() final { return *this; }
    const HTMLObjectElement& asHTMLElement() const final { return *this; }

    bool LEGACY_NODELETE isFormListedElement() const final { return true; }
    bool LEGACY_NODELETE isValidatedFormListedElement() const final { return false; }

    bool LEGACY_NODELETE isEnumeratable() const final { return true; }
};

} // namespace WebCore
