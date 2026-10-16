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

#include "Autofill.h"
#include "HTMLElement.h"
#include "ValidatedFormListedElement.h"

#if ENABLE(AUTOCAPITALIZE)
#include "Autocapitalize.h"
#endif

namespace WebCore {

class HTMLFormControlElement : public HTMLElement, public ValidatedFormListedElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLFormControlElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLFormControlElement);
public:
    USING_CAN_MAKE_WEAKPTR(HTMLElement);

    virtual ~HTMLFormControlElement();

    bool LEGACY_NODELETE isValidatedFormListedElement() const final { return true; }
    bool LEGACY_NODELETE isFormListedElement() const final { return true; }

    bool matchesValidPseudoClass() const override { return ValidatedFormListedElement::matchesValidPseudoClass(); }
    bool matchesInvalidPseudoClass() const override { return ValidatedFormListedElement::matchesInvalidPseudoClass(); }
    bool matchesUserValidPseudoClass() const override { return ValidatedFormListedElement::matchesUserValidPseudoClass(); }
    bool matchesUserInvalidPseudoClass() const override { return ValidatedFormListedElement::matchesUserInvalidPseudoClass(); }

    bool LEGACY_NODELETE isDisabledFormControl() const override { return isDisabled(); }
    bool supportsFocus() const override { return !isDisabled(); }

    WEBCORE_EXPORT String formEnctype() const;
    WEBCORE_EXPORT String formMethod() const;
    bool LEGACY_NODELETE formNoValidate() const;
    WEBCORE_EXPORT String formAction() const;

    bool wasChangedSinceLastFormControlChangeEvent() const { return m_wasChangedSinceLastFormControlChangeEvent; }
    void LEGACY_NODELETE setChangedSinceLastFormControlChangeEvent(bool);

    virtual void dispatchFormControlChangeEvent();
    void dispatchChangeEvent();
    void dispatchFormControlInputEvent();

    bool isRequired() const { return m_isRequired; }

    const AtomString& type() const { return formControlType(); }

    virtual bool canTriggerImplicitSubmission() const { return false; }

    virtual bool isSuccessfulSubmitButton() const { return false; }
    virtual bool isActivatedSubmit() const { return false; }
    virtual void setActivatedSubmit(bool) { }

#if ENABLE(AUTOCORRECT)
    WEBCORE_EXPORT bool shouldAutocorrect() const final;
#endif

#if ENABLE(AUTOCAPITALIZE)
    WEBCORE_EXPORT AutocapitalizeType autocapitalizeType() const final;
#endif

    WEBCORE_EXPORT String autocomplete() const;

    AutofillMantle LEGACY_NODELETE autofillMantle() const;

    WEBCORE_EXPORT AutofillData autofillData() const;

    virtual bool isSubmitButton() const { return false; }

    virtual String resultForDialogSubmit() const;

    RefPtr<HTMLElement> popoverTargetElement() const;
    String popoverTargetAction() const;

    bool isKeyboardFocusable(const FocusEventData&) const override;

    using Node::ref;
    using Node::deref;

protected:
    HTMLFormControlElement(const QualifiedName& tagName, Document&);

    NeedsPostConnectionSteps insertionSteps(InsertionType, ContainerNode&) override;
    void postConnectionSteps() override;
    void didMoveToNewDocument(Document& oldDocument, Document& newDocument) override;
    void removingSteps(RemovalType, ContainerNode&) override;
    void attributeChanged(const QualifiedName&, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason) override;

    virtual void requiredStateChanged();

    bool isMouseFocusable() const override;

    void handlePopoverTargetAction(const EventTarget*);

private:
    void refFormAssociatedElement() const final { ref(); }
    void derefFormAssociatedElement() const final { deref(); }

    void runFocusingStepsForAutofocus() final;
    HTMLElement* validationAnchorElement() final { return this; }

    // These functions can be called concurrently for ValidityState.
    HTMLElement& asHTMLElement() final { return *this; }
    const HTMLFormControlElement& asHTMLElement() const final { return *this; }

    FormAssociatedElement* LEGACY_NODELETE asFormAssociatedElement() final { return this; }
    FormListedElement* LEGACY_NODELETE asFormListedElement() final { return this; }
    ValidatedFormListedElement* LEGACY_NODELETE asValidatedFormListedElement() final { return this; }

    unsigned m_isRequired : 1;
    unsigned m_wasChangedSinceLastFormControlChangeEvent : 1;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::HTMLFormControlElement)
    static bool isType(const WebCore::Element& element) { return element.isFormControlElement(); }
    static bool isType(const WebCore::Node& node) { return node.isFormControlElement(); }
    static bool isType(const WebCore::FormListedElement& listedElement) { return listedElement.asHTMLElement().isFormControlElement(); }
SPECIALIZE_TYPE_TRAITS_END()
