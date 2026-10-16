/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2022 Apple Inc. All rights reserved.
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
#include "HTMLFormControlElement.h"

#include "Autofill.h"
#include "ContainerNodeInlines.h"
#include "ElementInlines.h"
#include "Event.h"
#include "EventNames.h"
#include "FormAssociatedElement.h"
#include "HTMLButtonElement.h"
#include "HTMLFormElement.h"
#include "HTMLInputElement.h"
#include "PopoverData.h"
#include "SelectionRestorationMode.h"
#include <wtf/Ref.h>
#include <wtf/SetForScope.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/Vector.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLFormControlElement);

using namespace HTMLNames;

HTMLFormControlElement::HTMLFormControlElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document, { TypeFlag::IsShadowRootOrFormControlElement, TypeFlag::HasDidMoveToNewDocument } )
    , m_isRequired(false)
    , m_wasChangedSinceLastFormControlChangeEvent(false)
{
}

HTMLFormControlElement::~HTMLFormControlElement()
{
    clearForm();
}

String HTMLFormControlElement::formEnctype() const
{
    const AtomString& formEnctypeAttr = attributeWithoutSynchronization(formenctypeAttr);
    if (formEnctypeAttr.isNull())
        return emptyString();
    return FormSubmission::Attributes::parseEncodingType(formEnctypeAttr);
}

String HTMLFormControlElement::formMethod() const
{
    auto& formMethodAttr = attributeWithoutSynchronization(formmethodAttr);
    if (formMethodAttr.isNull())
        return emptyString();
    return FormSubmission::Attributes::methodString(FormSubmission::Attributes::parseMethodType(formMethodAttr));
}

bool HTMLFormControlElement::formNoValidate() const
{
    return hasAttributeWithoutSynchronization(formnovalidateAttr);
}

String HTMLFormControlElement::formAction() const
{
    const AtomString& value = attributeWithoutSynchronization(formactionAttr);
    Ref document = this->document();
    if (value.isEmpty())
        return document->url().string();
    return document->encodingParseURL(value).string();
}

Node::NeedsPostConnectionSteps HTMLFormControlElement::insertionSteps(InsertionType insertionType, ContainerNode& parentOfInsertedTree)
{
    HTMLElement::insertionSteps(insertionType, parentOfInsertedTree);
    ValidatedFormListedElement::insertionSteps(insertionType, parentOfInsertedTree);

    if (!insertionType.connectedToDocument)
        return NeedsPostConnectionSteps::No;
    return NeedsPostConnectionSteps::Yes;
}

void HTMLFormControlElement::postConnectionSteps()
{
    HTMLElement::postConnectionSteps();
    ValidatedFormListedElement::postConnectionSteps();
}

void HTMLFormControlElement::didMoveToNewDocument(Document& oldDocument, Document& newDocument)
{
    HTMLElement::didMoveToNewDocument(oldDocument, newDocument);
    ValidatedFormListedElement::didMoveToNewDocument();
}

void HTMLFormControlElement::removingSteps(RemovalType removalType, ContainerNode& oldParentOfRemovedTree)
{
    HTMLElement::removingSteps(removalType, oldParentOfRemovedTree);
    ValidatedFormListedElement::removingSteps(removalType, oldParentOfRemovedTree);
}

void HTMLFormControlElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    if (name == requiredAttr) {
        bool newRequired = !newValue.isNull();
        if (m_isRequired != newRequired) {
            m_isRequired = newRequired;
            requiredStateChanged();
        }
    } else {
        HTMLElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);
        ValidatedFormListedElement::parseAttribute(name, newValue);
    }
}

void HTMLFormControlElement::requiredStateChanged()
{
    updateValidity();
}

void HTMLFormControlElement::setChangedSinceLastFormControlChangeEvent(bool changed)
{
    m_wasChangedSinceLastFormControlChangeEvent = changed;
}

void HTMLFormControlElement::dispatchChangeEvent()
{
    dispatchScopedEvent(Event::create(eventNames().changeEvent, Event::CanBubble::Yes, Event::IsCancelable::No));
}

void HTMLFormControlElement::dispatchFormControlChangeEvent()
{
    dispatchChangeEvent();
    setChangedSinceLastFormControlChangeEvent(false);
    setInteractedWithSinceLastFormSubmitEvent(true);
}

void HTMLFormControlElement::dispatchFormControlInputEvent()
{
    setChangedSinceLastFormControlChangeEvent(true);
    dispatchInputEvent();
}

bool HTMLFormControlElement::isKeyboardFocusable(const FocusEventData& focusEventData) const
{
    if (!!tabIndexSetExplicitly())
        return Element::isKeyboardFocusable(focusEventData);
    return isFocusable();
}

bool HTMLFormControlElement::isMouseFocusable() const
{
    return HTMLElement::isMouseFocusable();
}

void HTMLFormControlElement::runFocusingStepsForAutofocus()
{
    focus({ { }, { }, SelectionRestorationMode::PlaceCaretAtStart });
}

#if ENABLE(AUTOCORRECT)

bool HTMLFormControlElement::shouldAutocorrect() const
{
    if (auto* input = dynamicDowncast<HTMLInputElement>(*this); input
        && (input->isPasswordField() || input->isEmailField() || input->isURLField())) {
        return false;
    }
    const AtomString& autocorrectValue = attributeWithoutSynchronization(autocorrectAttr);
    if (!autocorrectValue.isNull())
        return !equalLettersIgnoringASCIICase(autocorrectValue, "off"_s);
    if (RefPtr<HTMLFormElement> form = this->form())
        return form->shouldAutocorrect();
    return true;
}

#endif

#if ENABLE(AUTOCAPITALIZE)

AutocapitalizeType HTMLFormControlElement::autocapitalizeType() const
{
    AutocapitalizeType type = HTMLElement::autocapitalizeType();
    if (type == AutocapitalizeType::Default) {
        if (RefPtr<HTMLFormElement> form = this->form())
            return form->autocapitalizeType();
    }
    return type;
}

#endif

String HTMLFormControlElement::autocomplete() const
{
    return autofillData().idlExposedValue;
}

AutofillMantle HTMLFormControlElement::autofillMantle() const
{
    auto* input = dynamicDowncast<HTMLInputElement>(this);
    return input && input->isInputTypeHidden() ? AutofillMantle::Anchor : AutofillMantle::Expectation;
}

AutofillData HTMLFormControlElement::autofillData() const
{
    // FIXME: We could cache the AutofillData if we we had an efficient way to invalidate the cache when
    // the autofill mantle changed (due to a type change on an <input> element) or the element's form
    // owner's autocomplete attribute changed or the form owner itself changed.

    return AutofillData::createFromHTMLFormControlElement(*this);
}

String HTMLFormControlElement::resultForDialogSubmit() const
{
    return attributeWithoutSynchronization(HTMLNames::valueAttr);
}

// https://html.spec.whatwg.org/#popover-target-element
RefPtr<HTMLElement> HTMLFormControlElement::popoverTargetElement() const
{
    auto canInvokePopovers = [](const HTMLFormControlElement& element) -> bool {
        if (auto* inputElement = dynamicDowncast<HTMLInputElement>(element))
            return inputElement->isTextButton() || inputElement->isImageButton();
        return is<HTMLButtonElement>(element);
    };

    if (!canInvokePopovers(*this))
        return nullptr;

    if (isDisabledFormControl())
        return nullptr;

    if (form() && isSubmitButton())
        return nullptr;

    RefPtr element = dynamicDowncast<HTMLElement>(elementForAttributeInternal(popovertargetAttr));
    if (element && element->popoverState() != PopoverState::None)
        return element;
    return nullptr;
}

String HTMLFormControlElement::popoverTargetAction() const
{
    auto value = attributeWithoutSynchronization(HTMLNames::popovertargetactionAttr);

    if (equalIgnoringASCIICase(value, "show"_s))
        return "show"_s;
    if (equalIgnoringASCIICase(value, "hide"_s))
        return "hide"_s;

    return "toggle"_s;
}

// https://html.spec.whatwg.org/#popover-target-attribute-activation-behavior
void HTMLFormControlElement::handlePopoverTargetAction(const EventTarget* eventTarget)
{
    RefPtr popover = popoverTargetElement();
    if (!popover)
        return;

    ASSERT(popover->popoverData());

    if (auto* eventTargetNode = dynamicDowncast<Node>(eventTarget)) {
        if (popover->isShadowIncludingInclusiveAncestorOf(eventTargetNode) && popover->isShadowIncludingDescendantOf(this))
            return;
    }

    auto action = popoverTargetAction();
    bool canHide = action == "hide"_s || action == "toggle"_s;
    bool shouldHide = canHide && popover->popoverData()->visibilityState() == PopoverVisibilityState::Showing;
    bool canShow = action == "show"_s || action == "toggle"_s;
    bool shouldShow = canShow && popover->popoverData()->visibilityState() == PopoverVisibilityState::Hidden;

    if (shouldHide)
        popover->hidePopoverInternal(FocusPreviousElement::Yes, FireEvents::Yes, this);
    else if (shouldShow)
        popover->showPopoverInternal(this);
}

} // namespace Webcore
