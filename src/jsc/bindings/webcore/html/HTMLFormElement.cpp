/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2010, 2012-2016 Apple Inc. All rights reserved.
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
#include "HTMLFormElement.h"

#include "CommonAtomStrings.h"
#include "DOMFormData.h"
#include "DOMTokenList.h"
#include "ElementAncestorIteratorInlines.h"
#include "Event.h"
#include "EventNames.h"
#include "FormDataEvent.h"
#include "HTMLDialogElement.h"
#include "HTMLFieldSetElement.h"
#include "HTMLFormControlsCollection.h"
#include "HTMLImageElement.h"
#include "HTMLInputElement.h"
#include "HTMLNames.h"
#include "NodeName.h"
#include "NodeRareData.h"
#include "RadioNodeList.h"
#include "ScriptDisallowedScope.h"
#include "SubmitEvent.h"
#include "TypedElementDescendantIteratorInlines.h"
#include <limits>
#include <numeric>
#include <wtf/Ref.h>
#include <wtf/SetForScope.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLFormElement);

using namespace HTMLNames;

HTMLFormElement::HTMLFormElement(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
    ASSERT(hasTagName(formTag));
}

Ref<HTMLFormElement> HTMLFormElement::create(Document& document)
{
    return adoptRef(*new HTMLFormElement(formTag, document));
}

Ref<HTMLFormElement> HTMLFormElement::create(const QualifiedName& tagName, Document& document)
{
    return adoptRef(*new HTMLFormElement(tagName, document));
}

HTMLFormElement::~HTMLFormElement()
{
    // formWillBeDestroyed below will try to update the validity of all radio buttons in a given group.
    m_radioButtonGroups.clear();

    m_defaultButton = nullptr;
    for (auto& weakElement : m_listedElements) {
        ASSERT(weakElement);
        RefPtr listedElement = weakElement->asFormListedElement();
        ASSERT(listedElement);
        listedElement->formWillBeDestroyed();
    }
    for (auto& imageElement : m_imageElements)
        protect(imageElement)->formWillBeDestroyed();
}

void HTMLFormElement::removingSteps(RemovalType removalType, ContainerNode& oldParentOfRemovedTree)
{
    Ref root = traverseToRootNode(); // Do not rely on rootNode() because our IsInTreeScope is outdated.
    auto listedElements = copyListedElementsVector();
    for (auto& listedElement : listedElements)
        listedElement->formOwnerRemovedFromTree(root);
    auto imageElements = WTF::compactMap(m_imageElements, [](auto& weakPtr) {
        return RefPtr { weakPtr.get() };
    });
    for (auto& imageElement : imageElements)
        imageElement->formOwnerRemovedFromTree(root);
    HTMLElement::removingSteps(removalType, oldParentOfRemovedTree);
    if (removalType.disconnectedFromDocument)
      m_controlsCollection = nullptr; // Avoid leaks since HTMLCollection has a back Ref to this element.
}

unsigned HTMLFormElement::length()
{
    return elements()->length();
}

HTMLElement* HTMLFormElement::item(unsigned index)
{
    return elements()->item(index);
}

std::optional<Variant<Ref<RadioNodeList>, Ref<Element>>> HTMLFormElement::namedItem(const AtomString& name)
{
    auto namedItems = namedElements(name);

    if (namedItems.isEmpty())
        return std::nullopt;
    if (namedItems.size() == 1)
        return Variant<Ref<RadioNodeList>, Ref<Element>> { WTF::move(namedItems[0]) };

    return Variant<Ref<RadioNodeList>, Ref<Element>> { radioNodeList(name) };
}

Vector<AtomString> HTMLFormElement::supportedPropertyNames() const
{
    // FIXME: Should be implemented (only needed for enumeration with includeDontEnumProperties mode
    // since this class is annotated with LegacyUnenumerableNamedProperties).
    return { };
}

void HTMLFormElement::submitImplicitly(Event& event, bool fromImplicitSubmissionTrigger)
{
    unsigned submissionTriggerCount = 0;
    for (auto& listedElement : m_listedElements) {
        RefPtr formElement = dynamicDowncast<HTMLFormControlElement>(*listedElement);
        if (!formElement)
            continue;
        if (formElement->isSuccessfulSubmitButton()) {
            formElement->dispatchSimulatedClick(&event);
            return;
        }
        if (formElement->canTriggerImplicitSubmission())
            ++submissionTriggerCount;
    }

    if (!submissionTriggerCount)
        return;

    if (fromImplicitSubmissionTrigger && submissionTriggerCount == 1)
        submitIfPossible(&event);
}

bool HTMLFormElement::validateInteractively()
{
    Vector<Ref<ValidatedFormListedElement>> unhandledInvalidControls;
    if (!checkInvalidControlsAndCollectUnhandled(unhandledInvalidControls))
        return true;
    // Because the form has invalid controls, we abort the form submission.

    Ref<HTMLFormElement> protectedThis(*this);

    // Focus on the first focusable control.
    for (auto& control : unhandledInvalidControls) {
        if (auto validationAnchor = control->focusableValidationAnchorElement()) {
            control->focusAndShowValidationMessage(validationAnchor.releaseNonNull());
            break;
        }
    }

    return false;
}

void HTMLFormElement::submitIfPossible(Event* event, HTMLFormControlElement* submitter, FormSubmissionTrigger trigger)
{
    // https://html.spec.whatwg.org/#form-submission-algorithm
    if (!isConnected())
        return;

    if (m_isSubmittingOrPreparingForSubmission)
        return;

    m_isSubmittingOrPreparingForSubmission = true;
    m_shouldSubmit = false;

    for (auto& element : m_listedElements) {
        if (RefPtr formControlElement = dynamicDowncast<HTMLFormControlElement>(*element))
            formControlElement->setInteractedWithSinceLastFormSubmitEvent(true);
    }

    bool shouldValidate = !noValidate();
    if (shouldValidate) {
        RefPtr submitElement = submitter ? submitter : findSubmitter(event);
        if (submitElement && submitElement->formNoValidate())
            shouldValidate = false;
    }

    // Interactive validation must be done before dispatching the submit event.
    if (shouldValidate && !validateInteractively()) {
        m_isSubmittingOrPreparingForSubmission = false;
        return;
    }

    Ref protectedThis { *this };

    auto submitEvent = SubmitEvent::create(submitter);
    dispatchEvent(submitEvent);

    // Event handling could have resulted in m_shouldSubmit becoming true as a side effect, too.
    if (!submitEvent->defaultPrevented())
        m_shouldSubmit = true;

    m_isSubmittingOrPreparingForSubmission = false;

    if (!m_shouldSubmit)
        return;

    submit(event, trigger, submitter);
}

void HTMLFormElement::submitFromJavaScript()
{
    submit(nullptr, SubmittedByJavaScript);
}

ExceptionOr<void> HTMLFormElement::requestSubmit(HTMLElement* submitter)
{
    RefPtr<HTMLFormControlElement> control;
    if (submitter) {
        // https://html.spec.whatwg.org/multipage/forms.html#dom-form-requestsubmit
        control = dynamicDowncast<HTMLFormControlElement>(*submitter);
        if (!control || !control->isSubmitButton())
            return Exception { ExceptionCode::TypeError, "The specified element is not a submit button."_s };
        if (control->form() != this)
            return Exception { ExceptionCode::NotFoundError, "The specified element is not owned by this form element."_s };
    }

    submitIfPossible(nullptr, control.get(), SubmittedByJavaScript);
    return { };
}

void HTMLFormElement::submit(Event* event, FormSubmissionTrigger trigger, HTMLFormControlElement* submitter)
{
    // The submitIfPossible function also does this check, but we need to do it here
    // too, since there are some code paths that bypass that function.
    if (!isConnected())
        return;

    if (m_isConstructingEntryList)
        return;

    if (trigger != SubmittedByJavaScript && m_isSubmittingOrPreparingForSubmission) {
        m_shouldSubmit = true;
        return;
    }

    m_isSubmittingOrPreparingForSubmission = true;

    if (event && !submitter) {
        // In a case of implicit submission without a submit button, 'submit' event handler might add a submit button. We search for a submit button again.
        auto listedElements = copyListedElementsVector();
        for (auto& element : listedElements) {
            if (RefPtr control = dynamicDowncast<HTMLFormControlElement>(element.get()); control && control->isSuccessfulSubmitButton()) {
                submitter = control.get();
                break;
            }
        }
    }

    Ref protectedThis { *this }; // Form submission can execute arbitary JavaScript.

    auto method = m_attributes.method();
    RefPtr effectiveSubmitter = submitter ? submitter : findSubmitter(event);
    if (effectiveSubmitter) {
        if (auto& attributeValue = effectiveSubmitter->attributeWithoutSynchronization(formmethodAttr); !attributeValue.isNull())
            method = FormSubmission::Attributes::parseMethodType(attributeValue);
    }

    // Nothing navigates: a dialog form closes its dialog, any other form only builds its entry list, which fires formdata.
    if (method == FormSubmission::Method::Dialog)
        submitDialog(effectiveSubmitter ? effectiveSubmitter->resultForDialogSubmit() : emptyString());
    else
        constructEntryList(WTF::move(effectiveSubmitter), DOMFormData::create(document().scriptExecutionContext()));

    m_shouldSubmit = false;
    m_isSubmittingOrPreparingForSubmission = false;
}

// https://html.spec.whatwg.org/#submit-dialog
void HTMLFormElement::submitDialog(const String& returnValue)
{
    // Let subject be the nearest ancestor dialog element of form, if any.
    RefPtr dialog = ancestorsOfType<HTMLDialogElement>(*this).first();

    // If there isn't one, or if it does not have an open attribute, do nothing.
    if (!dialog || !dialog->isOpen())
        return;

    // Then, close the dialog subject. If there is a result, let that be the return value.
    dialog->close(returnValue);
}

void HTMLFormElement::reset()
{
    if (m_isInResetFunction)
        return;

    Ref<HTMLFormElement> protectedThis(*this);

    SetForScope isInResetFunctionRestorer(m_isInResetFunction, true);

    auto event = Event::create(eventNames().resetEvent, Event::CanBubble::Yes, Event::IsCancelable::Yes);
    dispatchEvent(event);
    if (!event->defaultPrevented())
        resetListedFormControlElements();
}

void HTMLFormElement::resetListedFormControlElements()
{
    // Event handling can cause listed elements to be added or deleted while iterating
    // over this collection. Protect these elements until we are done notifying them of
    // the reset operation.
    for (auto& control : copyValidatedListedElementsVector())
        control->reset();
}

void HTMLFormElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    switch (name.nodeName()) {
    case AttributeNames::methodAttr:
        m_attributes.updateMethodType(newValue);
        break;
    case AttributeNames::enctypeAttr:
        m_attributes.updateEncodingType(newValue);
        break;
    case AttributeNames::relAttr:
        if (m_relList)
            m_relList->associatedAttributeValueChanged();
        break;
    default:
        HTMLElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);
        break;
    }
}

unsigned HTMLFormElement::formElementIndexWithFormAttribute(Element* element, unsigned rangeStart, unsigned rangeEnd)
{
    if (m_listedElements.isEmpty())
        return 0;

    ASSERT(rangeStart <= rangeEnd);

    if (rangeStart == rangeEnd)
        return rangeStart;

    unsigned left = rangeStart;
    unsigned right = rangeEnd - 1;
    unsigned short position;

    // Does binary search on m_listedElements in order to find the index to be inserted.
    while (left != right) {
        unsigned middle = std::midpoint(left, right);
        ASSERT(middle < m_listedElementsBeforeIndex || middle >= m_listedElementsAfterIndex);
        position = element->compareDocumentPosition(protect(*m_listedElements[middle]));
        if (position & DOCUMENT_POSITION_FOLLOWING)
            right = middle;
        else
            left = middle + 1;
    }
    
    ASSERT(left < m_listedElementsBeforeIndex || left >= m_listedElementsAfterIndex);
    position = element->compareDocumentPosition(protect(*m_listedElements[left]));
    if (position & DOCUMENT_POSITION_FOLLOWING)
        return left;
    return left + 1;
}

unsigned HTMLFormElement::formElementIndex(FormListedElement& listedElement)
{
    Ref listedHTMLElement = listedElement.asHTMLElement();

    // Treats separately the case where this element has the form attribute
    // for performance consideration.
    if (listedHTMLElement->hasAttributeWithoutSynchronization(formAttr) && listedHTMLElement->isConnected()) {
        unsigned short position = compareDocumentPosition(listedHTMLElement);
        ASSERT(!(position & DOCUMENT_POSITION_DISCONNECTED));
        if (position & DOCUMENT_POSITION_PRECEDING) {
            ++m_listedElementsBeforeIndex;
            ++m_listedElementsAfterIndex;
            return HTMLFormElement::formElementIndexWithFormAttribute(listedHTMLElement.ptr(), 0, m_listedElementsBeforeIndex - 1);
        }
        if (position & DOCUMENT_POSITION_FOLLOWING && !(position & DOCUMENT_POSITION_CONTAINED_BY))
            return HTMLFormElement::formElementIndexWithFormAttribute(listedHTMLElement.ptr(), m_listedElementsAfterIndex, m_listedElements.size());
    }

    unsigned currentListedElementsAfterIndex = m_listedElementsAfterIndex;
    ++m_listedElementsAfterIndex;

    if (!listedHTMLElement->isDescendantOf(*this))
        return currentListedElementsAfterIndex;

    auto descendants = descendantsOfType<HTMLElement>(*this);

    // Check for the special case where this element is the very last thing in
    // the form's tree of children; we don't want to walk the entire tree in that
    // common case that occurs during parsing; instead we'll just return a value
    // that says "add this form element to the end of the array".
    if (!++descendants.beginAt(listedHTMLElement))
        return currentListedElementsAfterIndex;

    unsigned i = m_listedElementsBeforeIndex;
    for (auto& element : descendants) {
        if (&element == listedHTMLElement.ptr())
            return i;
        if (!element.isFormListedElement())
            continue;
        if (element.asFormListedElement()->form() != this)
            continue;
        ++i;
    }
    return currentListedElementsAfterIndex;
}

void HTMLFormElement::registerFormListedElement(FormListedElement& element)
{
    m_listedElements.insert(formElementIndex(element), protect(element.asHTMLElement()));

    RefPtr control = dynamicDowncast<HTMLFormControlElement>(element);
    if (!control || !control->isSuccessfulSubmitButton())
        return;

    resetDefaultButton();
}

void HTMLFormElement::unregisterFormListedElement(FormListedElement& element)
{
    unsigned index = m_listedElements.find(&element.asHTMLElement());
    ASSERT(index < m_listedElements.size());
    if (index < m_listedElementsBeforeIndex)
        --m_listedElementsBeforeIndex;
    if (index < m_listedElementsAfterIndex)
        --m_listedElementsAfterIndex;
    removeFromPastNamesMap(element);
    m_listedElements.removeAt(index);

    if (auto* nodeLists = this->nodeLists())
        nodeLists->invalidateCaches();

    if (&element == m_defaultButton)
        resetDefaultButton();
}

void HTMLFormElement::addInvalidFormControl(const HTMLElement& formControlElement)
{
    ASSERT_WITH_MESSAGE(!is<HTMLFieldSetElement>(formControlElement), "FieldSet are never candidates for constraint validation.");
    ASSERT(static_cast<const Element&>(formControlElement).matchesInvalidPseudoClass());

    m_invalidFormControls.add(formControlElement);
}

void HTMLFormElement::removeInvalidFormControlIfNeeded(const HTMLElement& formControlElement)
{
    m_invalidFormControls.remove(formControlElement);
}

bool HTMLFormElement::isURLAttribute(const Attribute& attribute) const
{
    return attribute.name() == actionAttr || HTMLElement::isURLAttribute(attribute);
}

void HTMLFormElement::registerImgElement(HTMLImageElement& element)
{
    ASSERT(m_imageElements.find(&element) == notFound);
    m_imageElements.append(&element);
}

void HTMLFormElement::unregisterImgElement(HTMLImageElement& element)
{
    removeFromPastNamesMap(element);
    bool removed = m_imageElements.removeFirst(&element);
    ASSERT_UNUSED(removed, removed);
}

Ref<HTMLFormControlsCollection> HTMLFormElement::elements()
{
    // Ordinarily JS wrapper keeps the collection alive but this function is used by HTMLFormElement::namedElements internally without creating one.
    // This cache is cleared whenever this element is disconnected from a document.
    if (!m_controlsCollection) {
        Ref controlsCollection = ensureRareData().ensureNodeLists().addCachedCollection<HTMLFormControlsCollection>(*this);
        if (!isConnected())
            return controlsCollection;
        m_controlsCollection = WTF::move(controlsCollection);
    }
    return *m_controlsCollection;
}

String HTMLFormElement::name() const
{
    return getNameAttribute();
}

bool HTMLFormElement::noValidate() const
{
    return hasAttributeWithoutSynchronization(novalidateAttr);
}

String HTMLFormElement::action() const
{
    auto& value = attributeWithoutSynchronization(actionAttr);
    if (value.isEmpty())
        return protect(document())->url().string();
    return protect(document())->encodingParseURL(value).string();
}

String HTMLFormElement::method() const
{
    return FormSubmission::Attributes::methodString(m_attributes.method());
}

DOMTokenList& HTMLFormElement::relList()
{
    if (!m_relList) {
        lazyInitialize(m_relList, makeUniqueWithoutRefCountedCheck<DOMTokenList>(*this, HTMLNames::relAttr, [](Document&, StringView token) {
            return equalLettersIgnoringASCIICase(token, "noreferrer"_s) || equalLettersIgnoringASCIICase(token, "noopener"_s) || equalLettersIgnoringASCIICase(token, "opener"_s);
        }));
    }
    return *m_relList;
}

AtomString HTMLFormElement::target() const
{
    return attributeWithoutSynchronization(targetAttr);
}

HTMLFormControlElement* HTMLFormElement::findSubmitter(const Event* event) const
{
    if (!event)
        return nullptr;
    RefPtr node = dynamicDowncast<Node>(event->target());
    if (!node)
        return nullptr;
    RefPtr element = dynamicDowncast<Element>(*node);
    if (!element)
        element = node->parentElement();
    return element ? lineageOfType<HTMLFormControlElement>(*element).first() : nullptr;
}

HTMLFormControlElement* HTMLFormElement::defaultButton() const
{
    if (m_defaultButton)
        return m_defaultButton.get();
    for (auto& listedElement : m_listedElements) {
        if (SUPPRESS_UNCOUNTED_LOCAL auto* control = dynamicDowncast<HTMLFormControlElement>(*listedElement); control && control->isSuccessfulSubmitButton()) {
            m_defaultButton = *control;
            return control;
        }
    }
    return nullptr;
}

void HTMLFormElement::resetDefaultButton()
{
    m_defaultButton = nullptr;
}

bool HTMLFormElement::checkValidity()
{
    Vector<Ref<ValidatedFormListedElement>> controls;
    return !checkInvalidControlsAndCollectUnhandled(controls);
}

bool HTMLFormElement::checkInvalidControlsAndCollectUnhandled(Vector<Ref<ValidatedFormListedElement>>& unhandledInvalidControls)
{
    Ref<HTMLFormElement> protectedThis(*this);
    // Copy m_listedElements because event handlers called from HTMLFormControlElement::checkValidity() might change m_listedElements.
    bool hasInvalidControls = false;
    for (auto& control : copyValidatedListedElementsVector()) {
        // checkValidity() can trigger events that change the DOM hence why we check for control->form() twice.
        if (control->form() == this && !control->checkValidity(&unhandledInvalidControls) && control->form() == this)
            hasInvalidControls = true;
    }
    return hasInvalidControls;
}

bool HTMLFormElement::reportValidity()
{
    Ref<HTMLFormElement> protectedThis(*this);
    return validateInteractively();
}

#if ASSERT_ENABLED
void HTMLFormElement::assertItemCanBeInPastNamesMap(FormAssociatedElement& item) const
{
    ASSERT(item.form() == this);
    HTMLElement& element = item.asHTMLElement();

    if (item.isFormListedElement()) {
        ASSERT(m_listedElements.find(&element) != notFound);
        return;
    }

    ASSERT(element.hasTagName(imgTag));
    ASSERT(m_imageElements.find(&downcast<HTMLImageElement>(element)) != notFound);
}
#endif

RefPtr<HTMLElement> HTMLFormElement::elementFromPastNamesMap(const AtomString& pastName) const
{
    if (pastName.isEmpty() || m_pastNamesMap.isEmpty())
        return nullptr;
    auto element = m_pastNamesMap.get(pastName);
    if (!element)
        return nullptr;
#if ASSERT_ENABLED
    assertItemCanBeInPastNamesMap(*element->asFormAssociatedElement());
#endif
    return element;
}

void HTMLFormElement::addToPastNamesMap(FormAssociatedElement& item, const AtomString& pastName)
{
#if ASSERT_ENABLED
    assertItemCanBeInPastNamesMap(item);
#endif
    if (pastName.isEmpty())
        return;
    m_pastNamesMap.set(pastName.impl(), protect(item.asHTMLElement()));
}

void HTMLFormElement::removeFromPastNamesMap(FormAssociatedElement& item)
{
    if (m_pastNamesMap.isEmpty())
        return;

    m_pastNamesMap.removeIf([element = Ref { item.asHTMLElement() }] (auto& iterator) {
        return iterator.value == element.ptr();
    });
}

bool HTMLFormElement::matchesValidPseudoClass() const
{
    return m_invalidFormControls.isEmptyIgnoringNullReferences();
}

bool HTMLFormElement::matchesInvalidPseudoClass() const
{
    return !matchesValidPseudoClass();
}

// FIXME: Use Ref<HTMLElement> for the function result since there are no non-HTML elements returned here.
Vector<Ref<Element>> HTMLFormElement::namedElements(const AtomString& name)
{
    if (name.isEmpty())
        return { };

    // http://www.whatwg.org/specs/web-apps/current-work/multipage/forms.html#dom-form-nameditem
    Vector<Ref<Element>> namedItems = elements()->namedItems(name);

    auto elementFromPast = elementFromPastNamesMap(name);
    if (namedItems.size() == 1 && namedItems.first().ptr() != elementFromPast) {
        Ref<HTMLElement> element = downcast<HTMLElement>(namedItems.first().get());
        if (RefPtr formAssociated = element->asFormAssociatedElement())
            addToPastNamesMap(*formAssociated, name);
    }
    else if (elementFromPast && namedItems.isEmpty())
        namedItems.append(*elementFromPast);

    return namedItems;
}

bool HTMLFormElement::isSupportedPropertyName(const AtomString& name)
{
    return !name.isEmpty() && elements()->isSupportedPropertyName(name);
}

const Vector<WeakPtr<HTMLElement, WeakPtrImplWithEventTargetData>>& HTMLFormElement::unsafeListedElements() const
{
    ASSERT(ScriptDisallowedScope::InMainThread::hasDisallowedScope());
    return m_listedElements;
}

Vector<Ref<FormListedElement>> HTMLFormElement::copyListedElementsVector() const
{
    return WTF::map(m_listedElements, [] (auto& weakElement) {
        RefPtr element { weakElement.get() };
        ASSERT(element);
        RefPtr formListedElement = element->asFormListedElement();
        return formListedElement.releaseNonNull();
    });
}

Vector<Ref<ValidatedFormListedElement>> HTMLFormElement::copyValidatedListedElementsVector() const
{
    return WTF::compactMap(m_listedElements, [](auto& weakElement) {
        return RefPtr { weakElement->asValidatedFormListedElement() };
    });
}

HTMLFormElement* HTMLFormElement::findClosestFormAncestor(const Element& startElement)
{
    // FIXME: Remove suppression once rdar://189998365 is fixed.
    SUPPRESS_MEMORY_UNSAFE_CAST return const_cast<HTMLFormElement*>(ancestorsOfType<HTMLFormElement>(startElement).first());
}

const AtomString& HTMLFormElement::autocomplete() const
{
    return equalLettersIgnoringASCIICase(attributeWithoutSynchronization(autocompleteAttr), "off"_s) ? offAtom() : onAtom();
}

RefPtr<DOMFormData> HTMLFormElement::constructEntryList(RefPtr<HTMLFormControlElement>&& submitter, Ref<DOMFormData>&& domFormData)
{
    // https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#constructing-form-data-set
    if (m_isConstructingEntryList)
        return nullptr;
    
    SetForScope isConstructingEntryListScope(m_isConstructingEntryList, true);

    if (submitter)
        submitter->setActivatedSubmit(true);
    
    for (auto& control : this->copyListedElementsVector()) {
        Ref element = control->asHTMLElement();
        if (!element->isDisabledFormControl())
            control->appendFormData(domFormData.get());
    }
    
    dispatchEvent(FormDataEvent::create(eventNames().formdataEvent, Event::CanBubble::Yes, Event::IsCancelable::No, Event::IsComposed::No, domFormData.copyRef()));

    if (submitter)
        submitter->setActivatedSubmit(false);
    
    return domFormData->clone();
}

} // namespace
