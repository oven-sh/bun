/*
 * Copyright (C) 2010-2021 Google Inc. All rights reserved.
 * Copyright (C) 2011-2021 Apple Inc. All rights reserved.
 * Copyright (C) 2012 Samsung Electronics. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "HTMLInputElement.h"
#include "HTMLTextFormControlElement.h"
#include <wtf/Forward.h>
#include <wtf/OptionSet.h>
#include <wtf/RefCounted.h>
#include <wtf/RefPtr.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/ValueOrReference.h>

namespace WebCore {

class DOMFormData;
class DateComponents;
class Decimal;
class Event;
class FileList;
class HTMLElement;
class HTMLFormElement;
class KeyboardEvent;
class MouseEvent;
class Node;
class StepRange;

struct InputElementClickState;

enum class AnyStepHandling : bool;
enum class RangeLimitations : bool;
enum class StepDirection : bool { Up, Down };

// An InputType object represents the type-specific part of an HTMLInputElement.
// Do not expose instances of InputType and classes derived from it to classes
// other than HTMLInputElement.
class InputType : public RefCounted<InputType> {
    WTF_MAKE_TZONE_ALLOCATED(InputType);
public:
    enum class Type : uint32_t {
        Button          = 1 << 0,
        Checkbox        = 1 << 1,
        Color           = 1 << 2,
        Date            = 1 << 3,
        DateTimeLocal   = 1 << 4,
        Email           = 1 << 5,
        File            = 1 << 6,
        Hidden          = 1 << 7,
        Image           = 1 << 8,
        Month           = 1 << 9,
        Number          = 1 << 10,
        Password        = 1 << 11,
        Radio           = 1 << 12,
        Range           = 1 << 13,
        Reset           = 1 << 14,
        Search          = 1 << 15,
        Submit          = 1 << 16,
        Telephone       = 1 << 17,
        Time            = 1 << 18,
        URL             = 1 << 19,
        Week            = 1 << 20,
        Text            = 1 << 21,
    };
    
    static constexpr OptionSet<Type> textTypes = {
        Type::Email,
        Type::Password,
        Type::Search,
        Type::Telephone,
        Type::Text,
        Type::URL,
    };

    static constexpr OptionSet<Type> textFieldTypes = {
        Type::Email,
        Type::Number,
        Type::Password,
        Type::Search,
        Type::Telephone,
        Type::Text,
        Type::URL,
    };

    static constexpr OptionSet<Type> textButtonTypes = {
        Type::Button,
        Type::Reset,
        Type::Submit,
    };

    static constexpr OptionSet<Type> checkableTypes = {
        Type::Checkbox,
        Type::Radio,
    };

    static constexpr OptionSet<Type> steppableTypes = {
        Type::Date,
        Type::DateTimeLocal,
        Type::Month,
        Type::Time,
        Type::Week,
        Type::Number,
        Type::Range,
    };

    static constexpr OptionSet<Type> nonValidatingTypes = {
        Type::Button,
        Type::Hidden,
        Type::Image,
        Type::Reset,
    };

    static RefPtr<InputType> createIfDifferent(HTMLInputElement&, const AtomString&, InputType* currentInputType = nullptr);

    virtual ~InputType();

    void detachFromElement() { m_element = nullptr; }

    virtual const AtomString& formControlType() const = 0;

    // Type query functions.

    // Any time we are using one of these functions it's best to refactor
    // to add a virtual function to allow the input type object to do the
    // work instead, or at least make a query function that asks a higher
    // level question. These functions make the HTMLInputElement class
    // inflexible because it's harder to add new input types if there is
    // scattered code with special cases for various types.

    bool isEmailField() const { return m_type == Type::Email; }
    bool isFileUpload() const { return m_type == Type::File; }
    bool isHiddenType() const { return m_type == Type::Hidden; }
    bool isImageButton() const { return m_type == Type::Image; }
    bool isNumberField() const { return m_type == Type::Number; }
    bool isPasswordField() const { return m_type == Type::Password; }
    bool isRadioButton() const { return m_type == Type::Radio; }
    bool isSubmitButton() const { return m_type == Type::Submit || m_type == Type::Image; }
    bool isTelephoneField() const { return m_type == Type::Telephone; }
    bool isURLField() const { return m_type == Type::URL; }

    bool isTextButton() const { return textButtonTypes.contains(m_type); }
    bool LEGACY_NODELETE isTextField() const { return textFieldTypes.contains(m_type); }
    bool isTextType() const { return textTypes.contains(m_type); }

    bool isCheckable() const { return checkableTypes.contains(m_type); }
    bool isSteppable() const { return steppableTypes.contains(m_type); }
    bool supportsValidation() const { return !nonValidatingTypes.contains(m_type); }

    Type type() const { return m_type; }

    bool LEGACY_NODELETE isInteractiveContent() const;
    bool LEGACY_NODELETE isLabelable() const;
    bool LEGACY_NODELETE isEnumeratable() const;

    // Form value functions.

    virtual bool isFormDataAppendable() const;
    virtual bool appendFormData(DOMFormData&) const;

    // DOM property functions.

    virtual ValueOrReference<String> fallbackValue() const; // Checked last, if both internal storage and value attribute are missing.
    virtual String defaultValue() const; // Checked after even fallbackValue, only when the valueWithDefault function is called.
    virtual WallTime valueAsDate() const;
    virtual ExceptionOr<void> setValueAsDate(WallTime) const;
    virtual double valueAsDouble() const;
    virtual ExceptionOr<void> setValueAsDouble(double, TextFieldEventBehavior) const;
    virtual ExceptionOr<void> setValueAsDecimal(const Decimal&, TextFieldEventBehavior) const;

    // Validation functions.

    virtual String validationMessage() const;
    virtual bool typeMismatchFor(StringView) const { return false; }
    virtual bool LEGACY_NODELETE supportsRequired() const;
    virtual bool valueMissing(StringView) const { return false; }
    virtual bool hasBadInput() const { return false; }
    virtual bool patternMismatch(StringView) const { return false; }
    bool rangeUnderflow(StringView) const;
    bool rangeOverflow(StringView) const;
    bool isInRange(StringView) const;
    bool isOutOfRange(StringView) const;
    virtual Decimal defaultValueForStepUp() const;
    bool stepMismatch(StringView) const;
    virtual bool getAllowedValueStep(Decimal*) const;
    virtual StepRange createStepRange(AnyStepHandling) const;
    virtual ExceptionOr<void> stepUp(int);
    virtual void stepUpOrDown(StepDirection);
    virtual String badInputText() const;
    virtual String typeMismatchText() const;
    virtual String valueMissingText() const;
    virtual bool isEmptyValue() const;

    // Returns true if the value violates any step/range constraint (stepMismatch,
    // rangeUnderflow, or rangeOverflow). Creates the StepRange only once.
    bool hasStepRangeViolation(StringView) const;

    // Type check for the current input value. We do nothing for some types
    // though typeMismatchFor() does something for them because of value sanitization.
    virtual bool typeMismatch() const { return false; }

    // This function must be called only by HTMLInputElement::sanitizeValue().
    virtual ValueOrReference<String> sanitizeValue(const String& value LIFETIME_BOUND) const;

    // Event handlers.

    virtual void handleClickEvent(MouseEvent&) { }
    virtual void willDispatchClick(InputElementClickState&) { }
    virtual void didDispatchClick(Event&, const InputElementClickState&) { }
    virtual void handleDOMActivateEvent(Event&) { }

    enum ShouldCallBaseEventHandler : bool { No, Yes };
    virtual ShouldCallBaseEventHandler handleKeydownEvent(KeyboardEvent&);

    virtual void handleKeypressEvent(KeyboardEvent&);
    virtual void handleKeyupEvent(KeyboardEvent&);

    // Helpers for event handlers.

    virtual bool shouldSubmitImplicitly(Event&);
    virtual bool LEGACY_NODELETE hasCustomFocusLogic() const;
    virtual bool isKeyboardFocusable(const FocusEventData&) const;
    virtual bool isMouseFocusable() const;
    virtual bool accessKeyAction(bool sendMouseEvents);
    virtual bool LEGACY_NODELETE canBeSuccessfulSubmitButton();

    // Miscellaneous functions.

    virtual bool LEGACY_NODELETE shouldSendChangeEventAfterCheckedChanged();
    virtual bool LEGACY_NODELETE storesValueSeparateFromAttribute();
    virtual void setValue(const String&, bool valueChanged, TextFieldEventBehavior, TextControlSetValueSelection);
    virtual bool shouldRespectListAttribute() { return false; }
    virtual bool LEGACY_NODELETE supportsPlaceholder() const;
    virtual bool LEGACY_NODELETE supportsReadOnly() const;
    virtual void attributeChanged(const QualifiedName&) { }
    virtual bool matchesIndeterminatePseudoClass() const;
    virtual bool LEGACY_NODELETE supportsSelectionAPI() const;
    virtual bool LEGACY_NODELETE dirAutoUsesValue() const;
    virtual void willUpdateCheckedness(bool /*nowChecked*/, WasSetByJavaScript) { }

    // Parses the specified string for the type, and return
    // the Decimal value for the parsing result if the parsing
    // succeeds; Returns defaultValue otherwise. This function can
    // return NaN or Infinity only if defaultValue is NaN or Infinity.
    virtual Decimal parseToNumber(StringView, const Decimal& defaultValue) const;

    // Create a string representation of the specified Decimal value for the
    // input type. If NaN or Infinity is specified, this returns an empty
    // string. This should not be called for types without valueAsNumber.
    virtual String serialize(const Decimal&) const;

    // Gets width and height of the input element if the type of the
    // element is image. It returns 0 if the element is not image type.
    virtual unsigned height() const;
    virtual unsigned width() const;

    bool isInvalid(StringView) const;

    void dispatchSimulatedClickIfActive(KeyboardEvent&) const;

    virtual String resultForDialogSubmit() const;

protected:
    InputType(Type type, HTMLInputElement& element)
        : m_type(type)
        , m_element(element)
    {
    }

    HTMLInputElement* element() const { return m_element; }
    Decimal parseToNumberOrNaN(StringView) const;
    Decimal extractStepRangeBound(const QualifiedName& attributeName, const Decimal& defaultValue, RangeLimitations&) const;

    // Derive the step base, following the HTML algorithm steps.
    Decimal findStepBase(const Decimal&) const;

private:
    // Helper for stepUp()/stepDown(). Adds step value * count to the current value.
    ExceptionOr<void> applyStep(int count, AnyStepHandling, TextFieldEventBehavior);
    std::optional<std::pair<Decimal, StepRange>> parsedValueAndStepRange(StringView) const;

    const Type m_type;
    // m_element is null if this InputType is no longer associated with an element (either the element died or changed input type).
    WeakPtr<HTMLInputElement, WeakPtrImplWithEventTargetData> m_element;
};

} // namespace WebCore

#define SPECIALIZE_TYPE_TRAITS_INPUT_TYPE(ToValueTypeName, TypeEnumValue) \
SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::ToValueTypeName) \
static bool isType(const WebCore::InputType& input) { return input.type() == WebCore::InputType::TypeEnumValue; } \
SPECIALIZE_TYPE_TRAITS_END()
