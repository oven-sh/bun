/*
 * Copyright (C) 2023 Apple Inc. All rights reserved.
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
#include "FormAssociatedCustomElement.h"

#include "CustomElementReactionQueue.h"
#include "ElementAncestorIteratorInlines.h"
#include "HTMLFieldSetElement.h"
#include "HTMLFormElement.h"
#include "NodeRareData.h"
#include <wtf/Ref.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(FormAssociatedCustomElement);

using namespace HTMLNames;

FormAssociatedCustomElement::FormAssociatedCustomElement(HTMLMaybeFormAssociatedCustomElement& element)
    : m_element { element }
{
}

FormAssociatedCustomElement::~FormAssociatedCustomElement()
{
    clearForm();
}

Ref<FormAssociatedCustomElement> FormAssociatedCustomElement::create(HTMLMaybeFormAssociatedCustomElement& element)
{
    return adoptRef(*new FormAssociatedCustomElement(element));
}

ExceptionOr<void> FormAssociatedCustomElement::setValidity(ValidityStateFlags validityStateFlags, String&& message, HTMLElement* validationAnchor)
{
    ASSERT(m_element->isPrecustomizedOrDefinedCustomElement());

    if (!validityStateFlags.isValid() && message.isEmpty())
        return Exception { ExceptionCode::TypeError };

    m_validityStateFlags = validityStateFlags;
    setCustomValidity(validityStateFlags.isValid() ? emptyString() : WTF::move(message));

    if (validationAnchor && !asHTMLElement().isShadowIncludingInclusiveAncestorOf(*validationAnchor))
        return Exception { ExceptionCode::NotFoundError };

    m_validationAnchor = validationAnchor;

    return { };
}

String FormAssociatedCustomElement::validationMessage() const
{
    ASSERT(m_element->isPrecustomizedOrDefinedCustomElement());
    return customValidationMessage();
}

ALWAYS_INLINE static CustomElementFormValue cloneIfIsFormData(CustomElementFormValue&& value)
{
    return WTF::switchOn(WTF::move(value),
        [](Ref<DOMFormData>&& value) -> CustomElementFormValue {
            return value->clone();
        },
        [](const auto& value) -> CustomElementFormValue {
            return value;
        }
    );
}

void FormAssociatedCustomElement::setFormValue(CustomElementFormValue&& submissionValue, std::optional<CustomElementFormValue>&&)
{
    ASSERT(m_element->isPrecustomizedOrDefinedCustomElement());

    m_submissionValue = cloneIfIsFormData(WTF::move(submissionValue));
}

HTMLElement* FormAssociatedCustomElement::validationAnchorElement()
{
    ASSERT(m_element->isDefinedCustomElement());
    auto anchor = m_validationAnchor.get();
    return anchor ? anchor : m_element.get();
}

bool FormAssociatedCustomElement::computeValidity() const
{
    ASSERT(m_element->isPrecustomizedOrDefinedCustomElement());
    return m_validityStateFlags.isValid();
}

bool FormAssociatedCustomElement::appendFormData(DOMFormData& formData)
{
    ASSERT(m_element->isDefinedCustomElement());

    WTF::switchOn(m_submissionValue,
        [&](const Ref<DOMFormData>& value) {
            for (const auto& item : value->items()) {
                if (auto* string = std::get_if<String>(&item.data))
                    formData.append(item.name, *string);
                else if (auto* blob = std::get_if<RefPtr<Blob>>(&item.data))
                    formData.append(item.name, *blob, (*blob)->fileName());
            }
        },
        [&](const String& value) {
            if (!name().isEmpty())
                formData.append(name(), value);
        },
        [&](const Ref<Blob>& value) {
            if (!name().isEmpty())
                formData.append(name(), value.ptr(), value->fileName());
        },
        [](std::nullptr_t) {
            // do nothing
        }
    );

    return true;
}

bool FormAssociatedCustomElement::isEnumeratable() const
{
    ASSERT(m_element->isDefinedCustomElement());
    return true;
}

void FormAssociatedCustomElement::reset()
{
    ASSERT(m_element->isDefinedCustomElement());
    setInteractedWithSinceLastFormSubmitEvent(false);
    CustomElementReactionQueue::enqueueFormResetCallbackIfNeeded(protect(asHTMLElement()).get());
}

void FormAssociatedCustomElement::disabledStateChanged()
{
    ASSERT(m_element->isDefinedCustomElement());
    ValidatedFormListedElement::disabledStateChanged();
    CustomElementReactionQueue::enqueueFormDisabledCallbackIfNeeded(protect(asHTMLElement()).get(), isDisabled());
}

void FormAssociatedCustomElement::didChangeForm()
{
    ASSERT(m_element->isDefinedCustomElement());
    ValidatedFormListedElement::didChangeForm();
    if (!belongsToFormThatIsBeingDestroyed())
        CustomElementReactionQueue::enqueueFormAssociatedCallbackIfNeeded(protect(asHTMLElement()).get(), protect(form()).get());
}

void FormAssociatedCustomElement::willUpgrade()
{
    setDataListAncestorState(TriState::False);
}

void FormAssociatedCustomElement::didUpgrade()
{
    ASSERT(!form());

    Ref element = asHTMLElement();

    parseFormAttribute(element->attributeWithoutSynchronization(formAttr));
    parseDisabledAttribute(element->attributeWithoutSynchronization(disabledAttr));
    parseReadOnlyAttribute(element->attributeWithoutSynchronization(readonlyAttr));

    setDataListAncestorState(TriState::Indeterminate);
    updateWillValidateAndValidity();
    syncWithFieldsetAncestors(protect(element->parentNode()).get());
    invalidateElementsCollectionCachesInAncestors();
}

void FormAssociatedCustomElement::invalidateElementsCollectionCachesInAncestors()
{
    auto invalidateElementsCache = [](HTMLElement& element) {
        if (auto* nodeLists = element.nodeLists()) {
            // We kick the "form" attribute to invalidate only the FormControls, FieldSetElements,
            // and RadioNodeList collections, and do so without duplicating invalidation logic of Node.cpp.
            nodeLists->invalidateCachesForAttribute(HTMLNames::formAttr);
        }
    };

    if (RefPtr form = this->form())
        invalidateElementsCache(*form);

    for (Ref ancestor : lineageOfType<HTMLFieldSetElement>(protect(*m_element)))
        invalidateElementsCache(ancestor.get());
}

const AtomString& FormAssociatedCustomElement::formControlType() const
{
    return asHTMLElement().localName();
}

} // namespace Webcore
