/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2023 Apple Inc. All rights reserved.
 *           (C) 2006 Alexey Proskuryakov (ap@nypop.com)
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "ValidatedFormListedElement.h"

#include "ContainerNodeInlines.h"
#include "ElementAncestorIteratorInlines.h"
#include "Event.h"
#include "EventNames.h"
#include "FormAssociatedElement.h"
#include "HTMLDataListElement.h"
#include "HTMLFieldSetElement.h"
#include "HTMLFormElement.h"
#include "HTMLLegendElement.h"
#include "HTMLParserIdioms.h"
#include "NodeDocument.h"
#include "ScriptDisallowedScope.h"
#include <wtf/Ref.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/Vector.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(ValidatedFormListedElement);

using namespace HTMLNames;

ValidatedFormListedElement::ValidatedFormListedElement()
{
    ASSERT(!supportsReadOnly() || readOnlyBarsFromConstraintValidation());
}

ValidatedFormListedElement::~ValidatedFormListedElement() = default;

bool ValidatedFormListedElement::willValidate() const
{
    if (!m_willValidateInitialized || m_isInsideDataList == TriState::Indeterminate) {
        m_willValidateInitialized = true;
        bool newWillValidate = computeWillValidate();
        if (m_willValidate != newWillValidate)
            m_willValidate = newWillValidate;
    } else {
        // If the following assertion fails, updateWillValidateAndValidity() is not
        // called correctly when something which changes computeWillValidate() result
        // is updated.
        ASSERT(m_willValidate == computeWillValidate());
    }
    return m_willValidate;
}

bool ValidatedFormListedElement::computeWillValidate() const
{
    if (m_isInsideDataList == TriState::Indeterminate) {
        const Ref element = asHTMLElement();
        m_isInsideDataList = triState(element->document().hasDataListElements() && ancestorsOfType<HTMLDataListElement>(element.get()).first());
    }
    // readonly bars constraint validation for *all* <input> elements, regardless of the <input> type, for compat reasons.
    return m_isInsideDataList == TriState::False && !isDisabled() && !(m_hasReadOnlyAttribute && readOnlyBarsFromConstraintValidation());
}

bool ValidatedFormListedElement::checkValidity(Vector<Ref<ValidatedFormListedElement>>* unhandledInvalidControls)
{
    if (!willValidate() || isValidFormControlElement())
        return true;
    // An event handler can deref this object.
    Ref element = asHTMLElement();
    Ref protectedThis { element };
    Ref originalDocument { element->document() };
    auto event = Event::create(eventNames().invalidEvent, Event::CanBubble::No, Event::IsCancelable::Yes);
    element->dispatchEvent(event);
    if (!event->defaultPrevented() && unhandledInvalidControls && element->isConnected() && originalDocument.ptr() == &element->document())
        unhandledInvalidControls->append(*this);
    return false;
}

bool ValidatedFormListedElement::reportValidity()
{
    Vector<Ref<ValidatedFormListedElement>> elements;
    if (checkValidity(&elements))
        return true;

    if (elements.isEmpty())
        return false;

    if (auto validationAnchor = focusableValidationAnchorElement())
        focusAndShowValidationMessage(validationAnchor.releaseNonNull());

    return false;
}

RefPtr<HTMLElement> ValidatedFormListedElement::focusableValidationAnchorElement()
{
    if (RefPtr validationAnchor = validationAnchorElement()) {
        if (validationAnchor->isConnected() && validationAnchor->isFocusable())
            return validationAnchor;
    }
    return nullptr;
}

void ValidatedFormListedElement::focusAndShowValidationMessage(Ref<HTMLElement> validationAnchor)
{
    Ref protectedThis { *this };
    validationAnchor->focus();
}

void ValidatedFormListedElement::setDisabledByAncestorFieldset(bool newDisabledByAncestorFieldset)
{
    ASSERT(computeIsDisabledByFieldsetAncestor() == newDisabledByAncestorFieldset);
    setDisabledInternal(m_disabled, newDisabledByAncestorFieldset);
}

void ValidatedFormListedElement::setDisabledInternal(bool disabled, bool disabledByAncestorFieldset)
{
    bool newDisabledState = disabled || disabledByAncestorFieldset;
    bool changingDisabledState = newDisabledState != isDisabled();

    m_disabled = disabled;
    m_disabledByAncestorFieldset = disabledByAncestorFieldset;

    if (changingDisabledState)
        disabledStateChanged();
}

static void addInvalidElementToAncestorFromInsertionPoint(const HTMLElement& element, ContainerNode* insertionPoint)
{
    auto* insertionPointElement = dynamicDowncast<Element>(insertionPoint);
    if (!insertionPointElement)
        return;

    for (Ref ancestor : lineageOfType<HTMLFieldSetElement>(*insertionPointElement))
        ancestor->addInvalidDescendant(element);
}

static void removeInvalidElementToAncestorFromInsertionPoint(const HTMLElement& element, ContainerNode* insertionPoint)
{
    auto* insertionPointElement = dynamicDowncast<Element>(insertionPoint);
    if (!insertionPointElement)
        return;

    for (Ref ancestor : lineageOfType<HTMLFieldSetElement>(*insertionPointElement))
        ancestor->removeInvalidDescendant(element);
}

void ValidatedFormListedElement::updateValidity()
{
    if (m_delayedUpdateValidityCount)
        return;

    bool willValidate = this->willValidate();
    bool newIsValid = this->computeValidity();

    if (newIsValid != m_isValid) {
        SUPPRESS_UNCOUNTED_LOCAL auto& element = asHTMLElement();
        m_isValid = newIsValid;

        if (willValidate) {
            if (!newIsValid) {
                if (!belongsToFormThatIsBeingDestroyed())
                    addInvalidElementToAncestorFromInsertionPoint(element, protect(element.parentNode()).get());
                if (RefPtr form = this->form())
                    form->addInvalidFormControl(element);
            } else {
                if (!belongsToFormThatIsBeingDestroyed())
                    removeInvalidElementToAncestorFromInsertionPoint(element, protect(element.parentNode()).get());
                if (RefPtr form = this->form())
                    form->removeInvalidFormControlIfNeeded(element);
            }
        }
    }
}

void ValidatedFormListedElement::parseAttribute(const QualifiedName& name, const AtomString& value)
{
    if (name == disabledAttr && asHTMLElement().canBeActuallyDisabled())
        parseDisabledAttribute(value);
    else if (name == readonlyAttr && readOnlyBarsFromConstraintValidation())
        parseReadOnlyAttribute(value);
    else
        FormListedElement::parseAttribute(name, value);
}

void ValidatedFormListedElement::parseDisabledAttribute(const AtomString& value)
{
    ASSERT(asHTMLElement().canBeActuallyDisabled());

    bool newDisabled = !value.isNull();
    setDisabledInternal(newDisabled, m_disabledByAncestorFieldset);
}

void ValidatedFormListedElement::parseReadOnlyAttribute(const AtomString& value)
{
    ASSERT(readOnlyBarsFromConstraintValidation());

    bool newHasReadOnlyAttribute = !value.isNull();
    if (m_hasReadOnlyAttribute != newHasReadOnlyAttribute) {
        m_willValidateInitialized = false;
        m_hasReadOnlyAttribute = newHasReadOnlyAttribute;
        readOnlyStateChanged();
    }
}

void ValidatedFormListedElement::insertionSteps(Node::InsertionType insertionType, ContainerNode& parentOfInsertedTree)
{
    m_isInsideDataList = TriState::Indeterminate;
    updateWillValidateAndValidity();
    syncWithFieldsetAncestors(&parentOfInsertedTree);

    FormListedElement::elementInsertedIntoAncestor(protect(asHTMLElement()), insertionType);

    if (!insertionType.connectedToDocument)
        resetFormOwner();
    // Need to wait for postConnectionSteps to reset form when this element is inserted into a document
    // because we rely on TreeScope::getElementById to return the right element.
}

void ValidatedFormListedElement::setDataListAncestorState(TriState isInsideDataList)
{
    m_isInsideDataList = isInsideDataList;
}

void ValidatedFormListedElement::syncWithFieldsetAncestors(ContainerNode* insertionPoint)
{
    Ref element = asHTMLElement();
    if (matchesInvalidPseudoClass())
        addInvalidElementToAncestorFromInsertionPoint(element, insertionPoint);
    if (element->document().hasDisabledFieldsetElement())
        setDisabledInternal(m_disabled, computeIsDisabledByFieldsetAncestor());
}

void ValidatedFormListedElement::removingSteps(Node::RemovalType removalType, ContainerNode& oldParentOfRemovedTree)
{
    Ref element = asHTMLElement();
    bool wasMatchingInvalidPseudoClass = matchesInvalidPseudoClass();

    if (m_disabledByAncestorFieldset)
        setDisabledInternal(m_disabled, computeIsDisabledByFieldsetAncestor());

    bool wasInsideDataList = m_isInsideDataList == TriState::True;
    if (wasInsideDataList)
        m_isInsideDataList = TriState::Indeterminate;

    FormListedElement::elementRemovedFromAncestor(element, removalType);

    if (wasMatchingInvalidPseudoClass)
        removeInvalidElementToAncestorFromInsertionPoint(element, &oldParentOfRemovedTree);

    if (wasInsideDataList)
        updateWillValidateAndValidity();

}

bool ValidatedFormListedElement::computeIsDisabledByFieldsetAncestor() const
{
    RefPtr<const Element> previousAncestor;
    for (Ref ancestor : ancestorsOfType<Element>(protect(asHTMLElement()))) {
        if (RefPtr fieldset = dynamicDowncast<HTMLFieldSetElement>(ancestor); fieldset && ancestor->hasAttributeWithoutSynchronization(disabledAttr)) {
            bool isInFirstLegend = is<HTMLLegendElement>(previousAncestor) && previousAncestor == fieldset->legend();
            return !isInFirstLegend;
        }
        previousAncestor = ancestor.ptr();
    }
    return false;
}

void ValidatedFormListedElement::willChangeForm()
{
    if (RefPtr form = this->form())
        form->removeInvalidFormControlIfNeeded(protect(asHTMLElement()));
    FormListedElement::willChangeForm();
}

void ValidatedFormListedElement::didChangeForm()
{
    ScriptDisallowedScope::InMainThread scriptDisallowedScope;

    FormListedElement::didChangeForm();
    if (RefPtr form = this->form()) {
        if (m_willValidateInitialized && m_willValidate && !isValidFormControlElement())
            form->addInvalidFormControl(protect(asHTMLElement()));
    }
}

void ValidatedFormListedElement::formWillBeDestroyed()
{
    m_belongsToFormThatIsBeingDestroyed = true;
    FormListedElement::formWillBeDestroyed();
    m_belongsToFormThatIsBeingDestroyed = false;
}

void ValidatedFormListedElement::disabledStateChanged()
{
    updateWillValidateAndValidity();
}

void ValidatedFormListedElement::readOnlyStateChanged()
{
    updateWillValidateAndValidity();
}

void ValidatedFormListedElement::updateWillValidateAndValidity()
{
    // We need to recalculate willValidate immediately because willValidate change can causes style change.
    bool newWillValidate = computeWillValidate();
    if (m_willValidateInitialized && m_willValidate == newWillValidate)
        return;

    bool wasValid = m_isValid;

    m_willValidateInitialized = true;
    m_willValidate = newWillValidate;

    updateValidity();

    if (!m_willValidate && !wasValid) {
        Ref element = asHTMLElement();
        removeInvalidElementToAncestorFromInsertionPoint(element, protect(element->parentNode()).get());
        if (RefPtr form = this->form())
            form->removeInvalidFormControlIfNeeded(element);
    }
}

void ValidatedFormListedElement::postConnectionSteps()
{
    resetFormOwner();
}

void ValidatedFormListedElement::setCustomValidity(const String& error)
{
    FormListedElement::setCustomValidity(error);
    updateValidity();
}

void ValidatedFormListedElement::endDelayingUpdateValidity()
{
    ASSERT(m_delayedUpdateValidityCount);
    if (!--m_delayedUpdateValidityCount)
        updateValidity();
}

bool ValidatedFormListedElement::matchesValidPseudoClass() const
{
    return willValidate() && isValidFormControlElement();
}

bool ValidatedFormListedElement::matchesInvalidPseudoClass() const
{
    return willValidate() && !isValidFormControlElement();
}

bool ValidatedFormListedElement::matchesUserInvalidPseudoClass() const
{
    return m_wasInteractedWithSinceLastFormSubmitEvent && matchesInvalidPseudoClass();
}

bool ValidatedFormListedElement::matchesUserValidPseudoClass() const
{
    return m_wasInteractedWithSinceLastFormSubmitEvent && matchesValidPseudoClass();
}

void ValidatedFormListedElement::setInteractedWithSinceLastFormSubmitEvent(bool interactedWith)
{
    if (m_wasInteractedWithSinceLastFormSubmitEvent == interactedWith)
        return;

    m_wasInteractedWithSinceLastFormSubmitEvent = interactedWith;
}

} // namespace WebCore
