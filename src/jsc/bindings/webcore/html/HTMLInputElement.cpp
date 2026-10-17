/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2026 Apple Inc. All rights reserved.
 *           (C) 2006 Alexey Proskuryakov (ap@nypop.com)
 * Copyright (C) 2007 Samuel Weinig (sam@webkit.org)
 * Copyright (C) 2010-2021 Google Inc. All rights reserved.
 * Copyright (C) 2008 Torch Mobile Inc. All rights reserved. (http://www.torchmobile.com/)
 * Copyright (C) 2012 Samsung Electronics. All rights reserved.
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
#include "HTMLInputElement.h"

#include "ContainerNodeInlines.h"
#include "ElementInlines.h"
#include "EventNames.h"
#include "FileInputType.h"
#include "FileList.h"
#include "HTMLDataListElement.h"
#include "HTMLFormElement.h"
#include "HTMLParserIdioms.h"
#include "KeyboardEvent.h"
#include "MouseEvent.h"
#include "NodeName.h"
#include "RadioInputType.h"
#include "ScopedEventQueue.h"
#include "TextInputType.h"
#include "TreeScopeInlines.h"
#include <wtf/MathExtras.h>
#include <wtf/Ref.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringToIntegerConversion.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLInputElement);

using namespace HTMLNames;

HTMLInputElement::HTMLInputElement(const QualifiedName& tagName, Document& document, CreationType creationType)
    : HTMLTextFormControlElement(tagName, document)
    , m_parsingInProgress(creationType == CreationType::ByParser)
    // m_inputType is lazily created when constructed by the parser to avoid constructing unnecessarily a text inputType,
    // just to destroy them when the |type| attribute gets set by the parser to something else than 'text'.
    , m_inputType(creationType != CreationType::Normal ? nullptr : RefPtr { TextInputType::create(*this) })
{
    ASSERT(hasTagName(inputTag));
}

Ref<HTMLInputElement> HTMLInputElement::create(const QualifiedName& tagName, Document& document, bool createdByParser)
{
    return adoptRef(*new HTMLInputElement(tagName, document, createdByParser ? CreationType::ByParser : CreationType::Normal));
}

Ref<Element> HTMLInputElement::cloneElementWithoutAttributesAndChildren(Document& document, CustomElementRegistry*) const
{
    return adoptRef(*new HTMLInputElement(tagQName(), document, CreationType::ByCloning));
}

HTMLInputElement::~HTMLInputElement()
{
    // Need to remove form association while this is still an HTMLInputElement
    // so that virtual functions are called correctly.
    setForm(nullptr);

    // This is needed for a radio button that was not in a form, and also for
    // a radio button that was in a form. The call to setForm(nullptr) above
    // actually adds the button to the document groups in the latter case.
    // That is inelegant, but harmless since we remove it here.
    if (m_inputType && isRadioButton())
        protect(treeScope())->radioButtonGroups().removeButton(*this);
}

const AtomString& HTMLInputElement::name() const
{
    return m_name.isNull() ? emptyAtom() : m_name;
}

bool HTMLInputElement::tooShort() const
{
    return tooShort(value().get(), CheckDirtyFlag);
}

bool HTMLInputElement::tooLong() const
{
    return tooLong(value().get(), CheckDirtyFlag);
}

bool HTMLInputElement::typeMismatch() const
{
    return protect(m_inputType)->typeMismatch();
}

bool HTMLInputElement::valueMissing() const
{
    return protect(m_inputType)->valueMissing(value());
}

bool HTMLInputElement::hasBadInput() const
{
    return protect(m_inputType)->hasBadInput();
}

bool HTMLInputElement::patternMismatch() const
{
    return protect(m_inputType)->patternMismatch(value());
}

bool HTMLInputElement::tooShort(StringView value, NeedsToCheckDirtyFlag check) const
{
    if (!supportsMinLength())
        return false;

    int min = minLength();
    if (min <= 0)
        return false;

    if (check == CheckDirtyFlag) {
        // Return false for the default value or a value set by a script even if
        // it is shorter than minLength.
        if (!hasDirtyValue() || !m_wasModifiedByUser)
            return false;
    }

    // The empty string is excluded from tooShort validation.
    if (value.isEmpty())
        return false;

    return value.length() < static_cast<unsigned>(min);
}

bool HTMLInputElement::tooLong(StringView value, NeedsToCheckDirtyFlag check) const
{
    if (!supportsMaxLength())
        return false;
    unsigned max = effectiveMaxLength();
    if (check == CheckDirtyFlag) {
        // Return false for the default value or a value set by a script even if
        // it is longer than maxLength.
        if (!hasDirtyValue() || !m_wasModifiedByUser)
            return false;
    }
    return value.length() > max;
}

bool HTMLInputElement::rangeUnderflow() const
{
    return protect(m_inputType)->rangeUnderflow(value());
}

bool HTMLInputElement::rangeOverflow() const
{
    return protect(m_inputType)->rangeOverflow(value());
}

String HTMLInputElement::validationMessage() const
{
    if (!willValidate())
        return String();

    if (customError())
        return customValidationMessage();

    return protect(m_inputType)->validationMessage();
}

bool HTMLInputElement::stepMismatch() const
{
    return protect(m_inputType)->stepMismatch(value());
}

bool HTMLInputElement::computeValidity() const
{
    auto value = this->value();
    bool someError = protect(m_inputType)->isInvalid(value) || tooShort(value.get(), CheckDirtyFlag) || tooLong(value.get(), CheckDirtyFlag) || customError();
    return !someError;
}

bool HTMLInputElement::getAllowedValueStep(Decimal* step) const
{
    return protect(m_inputType)->getAllowedValueStep(step);
}

ExceptionOr<void> HTMLInputElement::stepUp(int n)
{
    return protect(m_inputType)->stepUp(n);
}

ExceptionOr<void> HTMLInputElement::stepDown(int n)
{
    return protect(m_inputType)->stepUp(-n);
}

bool HTMLInputElement::hasCustomFocusLogic() const
{
    return m_inputType->hasCustomFocusLogic();
}

int HTMLInputElement::defaultTabIndex() const
{
    return 0;
}

bool HTMLInputElement::isKeyboardFocusable(const FocusEventData& focusEventData) const
{
    return protect(m_inputType)->isKeyboardFocusable(focusEventData);
}

// Upstream needs no such rule: a hidden input has no renderer, and isFocusable() asks for one.
bool HTMLInputElement::supportsFocus() const
{
    return !m_inputType->isHiddenType() && HTMLTextFormControlElement::supportsFocus();
}

bool HTMLInputElement::isMouseFocusable() const
{
    return protect(m_inputType)->isMouseFocusable();
}

bool HTMLInputElement::isInteractiveContent() const
{
    return m_inputType->isInteractiveContent();
}

bool HTMLInputElement::isTextFormControlFocusable() const
{
    return HTMLTextFormControlElement::isFocusable();
}

bool HTMLInputElement::isTextFormControlKeyboardFocusable(const FocusEventData& focusEventData) const
{
    return HTMLTextFormControlElement::isKeyboardFocusable(focusEventData);
}

bool HTMLInputElement::isTextFormControlMouseFocusable() const
{
    return HTMLTextFormControlElement::isMouseFocusable();
}

void HTMLInputElement::updateType(const AtomString& typeAttributeValue)
{
    ASSERT(m_inputType);
    auto newType = InputType::createIfDifferent(*this, typeAttributeValue, m_inputType.get());
    if (!newType)
        return;
    ASSERT(m_inputType->type() != newType->type());

    removeFromRadioButtonGroup();

    bool didSupportReadOnly = m_inputType->supportsReadOnly();
    bool willSupportReadOnly = newType->supportsReadOnly();

    bool didStoreValue = m_inputType->storesValueSeparateFromAttribute();
    bool willStoreValue = newType->storesValueSeparateFromAttribute();
    bool wasSuccessfulSubmitButtonCandidate = m_inputType->canBeSuccessfulSubmitButton();

    if (didStoreValue && !willStoreValue) {
        if (auto dirtyValue = std::exchange(m_valueIfDirty, { }); !dirtyValue.isEmpty())
            setAttributeWithoutSynchronization(valueAttr, AtomString { WTF::move(dirtyValue) });
    }

    m_inputType->detachFromElement();
    auto oldType = m_inputType->type();

    bool didDirAutoUseValue = m_inputType->dirAutoUsesValue();
    bool previouslySelectable = m_inputType->supportsSelectionAPI();

    m_inputType = WTF::move(newType);
    if (!didStoreValue && willStoreValue)
        m_valueIfDirty = sanitizeValue(attributeWithoutSynchronization(valueAttr));
    else
        updateValueIfNeeded();

    // https://html.spec.whatwg.org/multipage/dom.html#auto-directionality
    if (oldType == InputType::Type::Telephone || m_inputType->type() == InputType::Type::Telephone || (hasAutoTextDirectionState() && didDirAutoUseValue != m_inputType->dirAutoUsesValue()))
        updateEffectiveTextDirection();

    if (didSupportReadOnly != willSupportReadOnly && hasAttributeWithoutSynchronization(readonlyAttr)) [[unlikely]]
        readOnlyStateChanged();

    updateWillValidateAndValidity();

    m_wasModifiedByUser = false;

    if (RefPtr form = this->form(); form && wasSuccessfulSubmitButtonCandidate != m_inputType->canBeSuccessfulSubmitButton())
        form->resetDefaultButton();

    runPostTypeUpdateTasks();

    // https://html.spec.whatwg.org/multipage/input.html#input-type-change
    // 8. Let nowSelectable be true if setRangeText() now applies to the element, and false otherwise.
    bool nowSelectable = m_inputType->supportsSelectionAPI();
    // 9. If previouslySelectable is false and nowSelectable is true, set the element's text entry cursor position to the beginning of the text control, and set its selection direction to "none".
    if (!previouslySelectable && nowSelectable) {
        // https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#set-the-selection-direction
        cacheSelection(0, 0, SelectionHasNoDirection);
    }

    updateValidity();
    updatePlaceholderVisibility();
}

inline void HTMLInputElement::runPostTypeUpdateTasks()
{
    ASSERT(m_inputType);
    setChangedSinceLastFormControlChangeEvent(false);

    addToRadioButtonGroup();
}

const AtomString& HTMLInputElement::formControlType() const
{
    return protect(m_inputType)->formControlType();
}

bool HTMLInputElement::canHaveSelection() const
{
    return isTextField();
}

bool HTMLInputElement::accessKeyAction(bool sendMouseEvents)
{
    return Ref { *m_inputType }->accessKeyAction(sendMouseEvents);
}

void HTMLInputElement::initializeInputTypeAfterParsingOrCloning()
{
    ASSERT(!m_inputType);

    auto& type = attributeWithoutSynchronization(typeAttr);
    if (type.isNull()) {
        m_inputType = TextInputType::create(*this);
        updateWillValidateAndValidity();
        return;
    }

    m_inputType = InputType::createIfDifferent(*this, type);
    runPostTypeUpdateTasks();
    updateWillValidateAndValidity();
}

void HTMLInputElement::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    if (oldValue == newValue)
        return;

    ASSERT(m_inputType);
    Ref protectedInputType { *m_inputType };

    HTMLTextFormControlElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);

    switch (name.nodeName()) {
    case AttributeNames::typeAttr:
        if (attributeModificationReason != AttributeModificationReason::Directly)
            return; // initializeInputTypeAfterParsingOrCloning will take care of this.
        updateType(newValue);
        break;
    case AttributeNames::valueAttr:
        if (attributeModificationReason != AttributeModificationReason::Directly)
            return; // initializeInputTypeAfterParsingOrCloning will take care of this.
        if (!hasDirtyValue())
            updatePlaceholderVisibility();
        updateValidity();
        if (selfOrPrecedingNodesAffectDirAuto())
            updateEffectiveTextDirection();
        break;
    case AttributeNames::nameAttr:
        removeFromRadioButtonGroup();
        m_name = newValue;
        addToRadioButtonGroup();
        break;
    case AttributeNames::checkedAttr:
        setDefaultCheckedState(!newValue.isNull());
        if (!m_dirtyCheckednessFlag) {
            setChecked(!newValue.isNull());
            // setChecked() above sets the dirty checkedness flag so we need to reset it.
            m_dirtyCheckednessFlag = false;
        }
        break;
    case AttributeNames::maxlengthAttr:
        maxLengthAttributeChanged(newValue);
        break;
    case AttributeNames::minlengthAttr:
        minLengthAttributeChanged(newValue);
        break;
    case AttributeNames::sizeAttr:
        m_size = limitToOnlyHTMLNonNegativeNumbersGreaterThanZero(newValue, defaultSize);
        break;
    case AttributeNames::maxAttr:
    case AttributeNames::minAttr:
    case AttributeNames::multipleAttr:
    case AttributeNames::patternAttr:
    case AttributeNames::stepAttr:
        updateValidity();
        break;
    case AttributeNames::listAttr:
        m_hasNonEmptyList = !newValue.isEmpty();
        break;
    default:
        break;
    }

    protect(m_inputType)->attributeChanged(name);
}

bool HTMLInputElement::supportsReadOnly() const
{
    return m_inputType->supportsReadOnly();
}

void HTMLInputElement::finishParsingChildren()
{
    m_parsingInProgress = false;
    ASSERT(m_inputType);
    HTMLTextFormControlElement::finishParsingChildren();
    if (hasAttributeWithoutSynchronization(checkedAttr))
        setChecked(true);
    m_dirtyCheckednessFlag = false;
}

bool HTMLInputElement::isReplaced() const
{
    return m_inputType && m_inputType->isImageButton();
}

bool HTMLInputElement::isSuccessfulSubmitButton() const
{
    // HTML spec says that buttons must have names to be considered successful.
    // However, other browsers do not impose this constraint. So we do not.
    return m_inputType->canBeSuccessfulSubmitButton();
}

bool HTMLInputElement::matchesDefaultPseudoClass() const
{
    ASSERT(m_inputType);
    if (m_inputType->canBeSuccessfulSubmitButton())
        return !isDisabledFormControl() && form() && protect(form())->defaultButton() == this;
    return m_inputType->isCheckable() && m_isDefaultChecked;
}

bool HTMLInputElement::isActivatedSubmit() const
{
    return m_isActivatedSubmit;
}

void HTMLInputElement::setActivatedSubmit(bool flag)
{
    m_isActivatedSubmit = flag;
}

bool HTMLInputElement::appendFormData(DOMFormData& formData)
{
    Ref protectedInputType { *m_inputType };
    return protectedInputType->isFormDataAppendable() && protectedInputType->appendFormData(formData);
}

void HTMLInputElement::reset()
{
    if (m_inputType->storesValueSeparateFromAttribute()) {
        setValue({ });
        updateValidity();
    }

    setInteractedWithSinceLastFormSubmitEvent(false);
    setChecked(hasAttributeWithoutSynchronization(checkedAttr));
    m_dirtyCheckednessFlag = false;
}

bool HTMLInputElement::isTextField() const
{
    return m_inputType->isTextField();
}

bool HTMLInputElement::isTextType() const
{
    return m_inputType->isTextType();
}

void HTMLInputElement::setDefaultCheckedState(bool isDefaultChecked)
{
    if (m_isDefaultChecked == isDefaultChecked)
        return;

    m_isDefaultChecked = isDefaultChecked;
}

void HTMLInputElement::setChecked(bool isChecked, WasSetByJavaScript wasCheckedByJavaScript)
{
    m_dirtyCheckednessFlag = true;
    if (checked() == isChecked)
        return;

    protect(m_inputType)->willUpdateCheckedness(isChecked, wasCheckedByJavaScript);

    m_isChecked = isChecked;

    if (auto* buttons = radioButtonGroups())
        buttons->updateCheckedState(*this);
    updateValidity();
}

void HTMLInputElement::setIndeterminate(bool newValue)
{
    if (indeterminate() == newValue)
        return;

    m_isIndeterminate = newValue;
}

void HTMLInputElement::copyNonAttributePropertiesFromElement(const Element& source)
{
    auto& sourceElement = downcast<HTMLInputElement>(source);

    m_valueIfDirty = sourceElement.m_valueIfDirty;
    m_wasModifiedByUser = sourceElement.m_wasModifiedByUser;
    setChecked(sourceElement.m_isChecked);
    m_isDefaultChecked = sourceElement.m_isDefaultChecked;
    m_dirtyCheckednessFlag = sourceElement.m_dirtyCheckednessFlag;
    m_isIndeterminate = sourceElement.m_isIndeterminate;

    HTMLTextFormControlElement::copyNonAttributePropertiesFromElement(source);

    updateValidity();
    updatePlaceholderVisibility();
}

ValueOrReference<String> HTMLInputElement::value() const
{
    if (RefPtr fileInput = dynamicDowncast<FileInputType>(*m_inputType))
        return fileInput->firstElementPathForInputValue();

    if (!m_valueIfDirty.isNull())
        return m_valueIfDirty;

    if (auto& valueString = attributeWithoutSynchronization(valueAttr); !valueString.isNull()) {
        if (auto sanitizedValue = sanitizeValue(valueString); !sanitizedValue->isNull())
            return sanitizedValue;
    }

    return protect(m_inputType)->fallbackValue();
}

String HTMLInputElement::valueWithDefault() const
{
    if (auto value = this->value(); !value->isNull())
        return value;

    return protect(m_inputType)->defaultValue();
}

ExceptionOr<void> HTMLInputElement::setValue(const String& value, TextFieldEventBehavior eventBehavior, TextControlSetValueSelection selection)
{
    if (isFileUpload() && !value.isEmpty())
        return Exception { ExceptionCode::InvalidStateError };

    Ref protectedThis { *this };
    EventQueueScope scope;
    auto sanitizedValue = sanitizeValue(value);
    bool valueChanged = sanitizedValue != this->value().get();

    protect(m_inputType)->setValue(sanitizedValue, valueChanged, eventBehavior, selection);
    if (selfOrPrecedingNodesAffectDirAuto())
        updateEffectiveTextDirection();

    if (valueChanged && eventBehavior == DispatchNoEvent)
        setTextAsOfLastFormControlChangeEvent(String(sanitizedValue));

    return { };
}

void HTMLInputElement::setValueInternal(const String& sanitizedValue, TextFieldEventBehavior eventBehavior)
{
    m_valueIfDirty = sanitizedValue;
    m_wasModifiedByUser = eventBehavior != DispatchNoEvent;
    updateValidity();
}

WallTime HTMLInputElement::valueAsDate() const
{
    return protect(m_inputType)->valueAsDate();
}

ExceptionOr<void> HTMLInputElement::setValueAsDate(WallTime value)
{
    return protect(m_inputType)->setValueAsDate(value);
}

double HTMLInputElement::valueAsNumber() const
{
    return protect(m_inputType)->valueAsDouble();
}

ExceptionOr<void> HTMLInputElement::setValueAsNumber(double newValue, TextFieldEventBehavior eventBehavior)
{
    if (std::isinf(newValue))
        return Exception { ExceptionCode::TypeError, "The value provided is infinite."_s };
    return protect(m_inputType)->setValueAsDouble(newValue, eventBehavior);
}

void HTMLInputElement::willDispatchEvent(Event& event, InputElementClickState& state)
{
    auto& eventNames = WebCore::eventNames();
    if (event.type() == eventNames.textInputEvent && protect(m_inputType)->shouldSubmitImplicitly(event))
        event.stopPropagation();
    if (event.type() == eventNames.clickEvent) {
        auto* mouseEvent = dynamicDowncast<MouseEvent>(event);
        if (mouseEvent && mouseEvent->button() == MouseButton::Left) {
            protect(m_inputType)->willDispatchClick(state);
            state.stateful = true;
        }
    }

    if (event.type() == eventNames.auxclickEvent) {
        auto* mouseEvent = dynamicDowncast<MouseEvent>(event);
        if (mouseEvent && mouseEvent->button() != MouseButton::Left) {
            protect(m_inputType)->willDispatchClick(state);
            state.stateful = true;
        }
    }
}

void HTMLInputElement::didDispatchClickEvent(Event& event, const InputElementClickState& state)
{
    protect(m_inputType)->didDispatchClick(event, state);
}

void HTMLInputElement::defaultEventHandler(Event& event)
{
    if (auto* mouseEvent = dynamicDowncast<MouseEvent>(event); mouseEvent && mouseEvent->button() == MouseButton::Left) {
        if (isAnyClick(*mouseEvent))
            protect(m_inputType)->handleClickEvent(*mouseEvent);

        if (mouseEvent->defaultHandled())
            return;
    }

    if (auto* keyboardEvent = dynamicDowncast<KeyboardEvent>(event); keyboardEvent && keyboardEvent->type() == eventNames().keydownEvent) {
        auto shouldCallBaseEventHandler = protect(m_inputType)->handleKeydownEvent(*keyboardEvent);
        if (event.defaultHandled() || shouldCallBaseEventHandler == InputType::ShouldCallBaseEventHandler::No)
            return;
    }

    // Call the base event handler before any of our own event handling for almost all events in text fields.
    // Makes editing keyboard handling take precedence over the keydown and keypress handling in this function.
    bool callBaseClassEarly = isTextField() && (event.type() == eventNames().keydownEvent || event.type() == eventNames().keypressEvent);
    if (callBaseClassEarly) {
        HTMLTextFormControlElement::defaultEventHandler(event);
        if (event.defaultHandled())
            return;
    }

    // DOMActivate events cause the input to be "activated" - in the case of image and submit inputs, this means
    // actually submitting the form. For reset inputs, the form is reset. These events are sent when the user clicks
    // on the element, or presses enter while it is the active element. JavaScript code wishing to activate the element
    // must dispatch a DOMActivate event - a click event will not do the job.
    if (event.type() == eventNames().DOMActivateEvent) {
        protect(m_inputType)->handleDOMActivateEvent(event);
        if (form() && m_inputType->type() != InputType::Type::Button)
            return;
        handlePopoverTargetAction(protect(event.target()));
        if (event.defaultHandled())
            return;
    }

    // Use key press event here since sending simulated mouse events
    // on key down blocks the proper sending of the key press event.
    if (auto* keyboardEvent = dynamicDowncast<KeyboardEvent>(event)) {
        if (keyboardEvent->type() == eventNames().keypressEvent) {
            protect(m_inputType)->handleKeypressEvent(*keyboardEvent);
            if (keyboardEvent->defaultHandled())
                return;
        } else if (keyboardEvent->type() == eventNames().keyupEvent) {
            protect(m_inputType)->handleKeyupEvent(*keyboardEvent);
            if (keyboardEvent->defaultHandled())
                return;
        }
    }

    if (protect(m_inputType)->shouldSubmitImplicitly(event)) {
        // Form submission finishes editing, just as loss of focus does.
        // If there was a change, send the event now.
        if (wasChangedSinceLastFormControlChangeEvent())
            dispatchFormControlChangeEvent();

        // Form may never have been present, or may have been destroyed by code responding to the change event.
        if (RefPtr formElement = form())
            formElement->submitImplicitly(event, canTriggerImplicitSubmission());

        event.setDefaultHandled();
        return;
    }

    if (!callBaseClassEarly && !event.defaultHandled())
        HTMLTextFormControlElement::defaultEventHandler(event);
}

bool HTMLInputElement::hasActivationBehavior() const
{
    return true;
}

bool HTMLInputElement::isURLAttribute(const Attribute& attribute) const
{
    return attribute.name() == srcAttr || attribute.name() == formactionAttr || HTMLTextFormControlElement::isURLAttribute(attribute);
}

ExceptionOr<void> HTMLInputElement::showPicker()
{
    if (!isMutable())
        return Exception { ExceptionCode::InvalidStateError, "Input showPicker() cannot be used on immutable controls."_s };

    return Exception { ExceptionCode::NotAllowedError, "Input showPicker() requires a user gesture."_s };
}

unsigned HTMLInputElement::effectiveMaxLength() const
{
    // The number -1 represents no maximum at all; conveniently it becomes a super-large value when converted to unsigned.
    return std::min<unsigned>(maxLength(), maxEffectiveLength);
}

bool HTMLInputElement::multiple() const
{
    return hasAttributeWithoutSynchronization(multipleAttr);
}

ExceptionOr<void> HTMLInputElement::setSize(unsigned size)
{
    if (!size)
        return Exception { ExceptionCode::IndexSizeError };
    setUnsignedIntegralAttribute(sizeAttr, limitToOnlyHTMLNonNegativeNumbersGreaterThanZero(size, defaultSize));
    return { };
}

String HTMLInputElement::colorSpace()
{
    if (equalLettersIgnoringASCIICase(attributeWithoutSynchronization(colorspaceAttr), "display-p3"_s))
        return "display-p3"_s;

    return "limited-srgb"_s;
}

FileList* HTMLInputElement::files()
{
    if (auto* fileInputType = dynamicDowncast<FileInputType>(*m_inputType))
        return &fileInputType->files();
    return nullptr;
}

void HTMLInputElement::setFiles(RefPtr<FileList>&& files)
{
    if (RefPtr fileInputType = dynamicDowncast<FileInputType>(*m_inputType))
        fileInputType->setFiles(WTF::move(files));
}

ValueOrReference<String> HTMLInputElement::sanitizeValue(const String& proposedValue LIFETIME_BOUND) const
{
    if (proposedValue.isNull())
        return proposedValue;
    return protect(m_inputType)->sanitizeValue(proposedValue);
}

bool HTMLInputElement::isInRange() const
{
    return willValidate() && protect(m_inputType)->isInRange(value());
}

bool HTMLInputElement::isOutOfRange() const
{
    return willValidate() && protect(m_inputType)->isOutOfRange(value());
}

bool HTMLInputElement::isRequiredFormControl() const
{
    return m_inputType->supportsRequired() && isRequired();
}

bool HTMLInputElement::matchesReadWritePseudoClass() const
{
    return supportsReadOnly() && isMutable();
}

void HTMLInputElement::willChangeForm()
{
    removeFromRadioButtonGroup();
    HTMLTextFormControlElement::willChangeForm();
}

void HTMLInputElement::didChangeForm()
{
    HTMLTextFormControlElement::didChangeForm();
    addToRadioButtonGroup();
}

Node::NeedsPostConnectionSteps HTMLInputElement::insertionSteps(InsertionType insertionType, ContainerNode& parentOfInsertedTree)
{
    auto result = HTMLTextFormControlElement::insertionSteps(insertionType, parentOfInsertedTree);
    if (isRadioButton())
        updateValidity();
    if (!insertionType.connectedToDocument) {
        addToRadioButtonGroup();
        return result;
    }
    return NeedsPostConnectionSteps::Yes;
}

void HTMLInputElement::postConnectionSteps()
{
    HTMLTextFormControlElement::postConnectionSteps();
    if (isInTreeScope() && !form())
        addToRadioButtonGroup();
}

void HTMLInputElement::removingSteps(RemovalType removalType, ContainerNode& oldParentOfRemovedTree)
{
    HTMLTextFormControlElement::removingSteps(removalType, oldParentOfRemovedTree);
    if (removalType.treeScopeChanged && isRadioButton())
        protect(oldParentOfRemovedTree.treeScope())->radioButtonGroups().removeButton(*this);
    if (removalType.disconnectedFromDocument && !form())
        removeFromRadioButtonGroup();
    ASSERT(!isConnected());
    if (removalType.disconnectedFromDocument && !form() && isRadioButton())
        updateValidity();
}

void HTMLInputElement::movingSteps(MovingType movingType, ContainerNode& oldParent)
{
    HTMLTextFormControlElement::movingSteps(movingType, oldParent);
    if (!isRadioButton())
        return;
    if (movingType.didRemoveFromOldTreeScope)
        protect(oldParent.treeScope())->radioButtonGroups().removeButton(*this);
    if (movingType.didInsertIntoNewTreeScope && !form())
        protect(treeScope())->radioButtonGroups().addButton(*this);
    updateValidity();
}

bool HTMLInputElement::computeWillValidate() const
{
    return m_inputType->supportsValidation() && HTMLTextFormControlElement::computeWillValidate();
}

void HTMLInputElement::requiredStateChanged()
{
    HTMLTextFormControlElement::requiredStateChanged();
    if (auto* buttons = radioButtonGroups())
        buttons->requiredStateChanged(*this);
}

RefPtr<HTMLElement> HTMLInputElement::list() const
{
    // FIXME: The downcast should be unnecessary, but the WPT was written before https://github.com/WICG/webcomponents/issues/1072 was resolved. Update once the WPT has been updated.
    return dynamicDowncast<HTMLDataListElement>(retargetReferenceTargetForBindings(dataList()));
}

RefPtr<HTMLDataListElement> HTMLInputElement::dataList() const
{
    if (!m_hasNonEmptyList || !protect(m_inputType)->shouldRespectListAttribute())
        return nullptr;

    return dynamicDowncast<HTMLDataListElement>(elementForAttributeInternal(listAttr));
}

bool HTMLInputElement::isTextButton() const
{
    return m_inputType->isTextButton();
}

bool HTMLInputElement::isRadioButton() const
{
    return m_inputType->isRadioButton();
}

bool HTMLInputElement::isInputTypeHidden() const
{
    return m_inputType->isHiddenType();
}

bool HTMLInputElement::isPasswordField() const
{
    return m_inputType->isPasswordField();
}

bool HTMLInputElement::isEmailField() const
{
    return m_inputType->isEmailField();
}

bool HTMLInputElement::isFileUpload() const
{
    return m_inputType->isFileUpload();
}

bool HTMLInputElement::isImageButton() const
{
    return m_inputType->isImageButton();
}

bool HTMLInputElement::isNumberField() const
{
    return m_inputType->isNumberField();
}

bool HTMLInputElement::isSubmitButton() const
{
    return m_inputType->isSubmitButton();
}

bool HTMLInputElement::isTelephoneField() const
{
    return m_inputType->isTelephoneField();
}

bool HTMLInputElement::isURLField() const
{
    return m_inputType->isURLField();
}

bool HTMLInputElement::isEnumeratable() const
{
    return m_inputType->isEnumeratable();
}

bool HTMLInputElement::isLabelable() const
{
    return m_inputType->isLabelable();
}

bool HTMLInputElement::matchesCheckedPseudoClass() const
{
    return checked() && m_inputType->isCheckable();
}

bool HTMLInputElement::supportsPlaceholder() const
{
    return m_inputType->supportsPlaceholder();
}

bool HTMLInputElement::isEmptyValue() const
{
    return protect(m_inputType)->isEmptyValue();
}

void HTMLInputElement::maxLengthAttributeChanged(const AtomString& newValue)
{
    unsigned oldEffectiveMaxLength = effectiveMaxLength();
    internalSetMaxLength(parseHTMLNonNegativeInteger(newValue).value_or(-1));
    if (oldEffectiveMaxLength != effectiveMaxLength())
        updateValueIfNeeded();

    updateValidity();
}

void HTMLInputElement::minLengthAttributeChanged(const AtomString& newValue)
{
    int oldMinLength = minLength();
    internalSetMinLength(parseHTMLNonNegativeInteger(newValue).value_or(-1));
    if (oldMinLength != minLength())
        updateValueIfNeeded();

    updateValidity();
}

void HTMLInputElement::updateValueIfNeeded()
{
    auto newValue = sanitizeValue(m_valueIfDirty);
    ASSERT(!m_valueIfDirty.isNull() || newValue->isNull());
    if (newValue != m_valueIfDirty)
        setValue(newValue);
}

bool HTMLInputElement::matchesIndeterminatePseudoClass() const
{
    return protect(m_inputType)->matchesIndeterminatePseudoClass();
}

RefPtr<HTMLInputElement> HTMLInputElement::checkedRadioButtonForGroup() const
{
    ASSERT(isRadioButton());

    if (checked()) {
        // FIXME: Remove suppression once rdar://189998365 is fixed.
        SUPPRESS_MEMORY_UNSAFE_CAST return const_cast<HTMLInputElement*>(this);
    }

    auto& name = this->name();
    if (auto* buttons = radioButtonGroups())
        return buttons->checkedButtonForGroup(name);

    if (name.isEmpty())
        return nullptr;

    ASSERT(!isConnected());
    ASSERT(!form());

    // The input is not managed by a RadioButtonGroups, we'll need to traverse the tree.
    RefPtr<HTMLInputElement> checkedRadio;
    RadioInputType::forEachButtonInDetachedGroup(protect(rootNode()), name, [&](auto& input) {
        if (input.checked()) {
            checkedRadio = input;
            return false;
        }
        return true;
    });
    return checkedRadio;
}

RadioButtonGroups* HTMLInputElement::radioButtonGroups() const
{
    if (!isRadioButton())
        return nullptr;
    if (auto* formElement = form())
        return &formElement->radioButtonGroups();
    if (isInTreeScope())
        return &protect(treeScope())->radioButtonGroups();
    return nullptr;
}

inline void HTMLInputElement::addToRadioButtonGroup()
{
    if (auto* buttons = radioButtonGroups())
        buttons->addButton(*this);
}

inline void HTMLInputElement::removeFromRadioButtonGroup()
{
    if (auto* buttons = radioButtonGroups())
        buttons->removeButton(*this);
}

unsigned HTMLInputElement::height() const
{
    return protect(m_inputType)->height();
}

unsigned HTMLInputElement::width() const
{
    return protect(m_inputType)->width();
}

ExceptionOr<void> HTMLInputElement::setRangeText(StringView replacement, unsigned start, unsigned end, const String& selectionMode)
{
    if (!m_inputType->supportsSelectionAPI())
        return Exception { ExceptionCode::InvalidStateError };

    return HTMLTextFormControlElement::setRangeText(replacement, start, end, selectionMode);
}

std::optional<unsigned> HTMLInputElement::selectionStartForBindings() const
{
    if (!canHaveSelection() || !m_inputType->supportsSelectionAPI())
        return std::nullopt;

    return selectionStart();
}

ExceptionOr<void> HTMLInputElement::setSelectionStartForBindings(std::optional<unsigned> start)
{
    if (!canHaveSelection() || !m_inputType->supportsSelectionAPI())
        return Exception { ExceptionCode::InvalidStateError, makeString("The input element's type ('"_s, protect(m_inputType)->formControlType(), "') does not support selection."_s) };

    setSelectionStart(start.value_or(0));
    return { };
}

std::optional<unsigned> HTMLInputElement::selectionEndForBindings() const
{
    if (!canHaveSelection() || !m_inputType->supportsSelectionAPI())
        return std::nullopt;

    return selectionEnd();
}

ExceptionOr<void> HTMLInputElement::setSelectionEndForBindings(std::optional<unsigned> end)
{
    if (!canHaveSelection() || !m_inputType->supportsSelectionAPI())
        return Exception { ExceptionCode::InvalidStateError, makeString("The input element's type ('"_s, protect(m_inputType)->formControlType(), "') does not support selection."_s) };

    setSelectionEnd(end.value_or(0));
    return { };
}

ExceptionOr<String> HTMLInputElement::selectionDirectionForBindings() const
{
    if (!canHaveSelection() || !m_inputType->supportsSelectionAPI())
        return String();

    return String { selectionDirection() };
}

ExceptionOr<void> HTMLInputElement::setSelectionDirectionForBindings(const String& direction)
{
    if (!canHaveSelection() || !m_inputType->supportsSelectionAPI())
        return Exception { ExceptionCode::InvalidStateError, makeString("The input element's type ('"_s, protect(m_inputType)->formControlType(), "') does not support selection."_s) };

    setSelectionDirection(direction);
    return { };
}

ExceptionOr<void> HTMLInputElement::setSelectionRangeForBindings(unsigned start, unsigned end, const String& direction)
{
    if (!canHaveSelection() || !m_inputType->supportsSelectionAPI())
        return Exception { ExceptionCode::InvalidStateError, makeString("The input element's type ('"_s, protect(m_inputType)->formControlType(), "') does not support selection."_s) };
    
    setSelectionRange(start, end, direction);
    return { };
}

String HTMLInputElement::resultForDialogSubmit() const
{
    return protect(m_inputType)->resultForDialogSubmit();
}

bool HTMLInputElement::dirAutoUsesValue() const
{
    return m_inputType->dirAutoUsesValue();
}

} // namespace
