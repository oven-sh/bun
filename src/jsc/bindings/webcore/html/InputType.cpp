/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2022 Apple Inc. All rights reserved.
 *           (C) 2006 Alexey Proskuryakov (ap@nypop.com)
 * Copyright (C) 2007 Samuel Weinig (sam@webkit.org)
 * Copyright (C) 2009-2015 Google Inc. All rights reserved.
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
#include "InputType.h"

#include "ButtonInputType.h"
#include "CheckboxInputType.h"
#include "ColorInputType.h"
#include "DOMFormData.h"
#include "DateComponents.h"
#include "DateInputType.h"
#include "DateTimeLocalInputType.h"
#include "Decimal.h"
#include "ElementInlines.h"
#include "EmailInputType.h"
#include "EventNames.h"
#include "FileInputType.h"
#include "HTMLFormElement.h"
#include "HTMLInputElement.h"
#include "HTMLNames.h"
#include "HTMLParserIdioms.h"
#include "HiddenInputType.h"
#include "ImageInputType.h"
#include "InputEvent.h"
#include "KeyboardEvent.h"
#include "LocalizedStrings.h"
#include "MonthInputType.h"
#include "NumberInputType.h"
#include "PasswordInputType.h"
#include "RadioInputType.h"
#include "RangeInputType.h"
#include "ResetInputType.h"
#include "ScopedEventQueue.h"
#include "SearchInputType.h"
#include "SelectionRestorationMode.h"
#include "StepRange.h"
#include "SubmitInputType.h"
#include "TelephoneInputType.h"
#include "TextInputType.h"
#include "TimeInputType.h"
#include "URLInputType.h"
#include "WeekInputType.h"
#include "Window.h"
#include <limits>
#include <wtf/Assertions.h>
#include <wtf/SortedArrayMap.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(InputType);

using namespace HTMLNames;

typedef Ref<InputType> (*InputTypeFactoryFunction)(HTMLInputElement&);

struct InputTypeFactory {
    InputType::Type type;
    InputTypeFactoryFunction factoryFunction;
};

template<typename T> static Ref<InputType> createInputType(HTMLInputElement& element)
{
    return T::create(element);
}

template<typename DowncastedType>
ALWAYS_INLINE bool isInvalidInputType(const DowncastedType& inputType, StringView value)
{
    return inputType.typeMismatch()
        || inputType.hasStepRangeViolation(value)
        || inputType.patternMismatch(value)
        || inputType.valueMissing(value)
        || inputType.hasBadInput();
}

static const InputTypeFactory* findFactory(StringView typeName)
{
    static constexpr SortedArrayMap factories { WTF::toArray<std::pair<ComparableCaseFoldingASCIILiteral, InputTypeFactory>>({
        { "button"_s, { InputType::Type::Button, &createInputType<ButtonInputType> } },
        { "checkbox"_s, { InputType::Type::Checkbox, &createInputType<CheckboxInputType> } },
        { "color"_s, { InputType::Type::Color, &createInputType<ColorInputType> } },
        { "date"_s, { InputType::Type::Date, &createInputType<DateInputType> } },
        { "datetime-local"_s, { InputType::Type::DateTimeLocal, &createInputType<DateTimeLocalInputType> } },
        { "email"_s, { InputType::Type::Email, &createInputType<EmailInputType> } },
        { "file"_s, { InputType::Type::File, &createInputType<FileInputType> } },
        { "hidden"_s, { InputType::Type::Hidden, &createInputType<HiddenInputType> } },
        { "image"_s, { InputType::Type::Image, &createInputType<ImageInputType> } },
        { "month"_s, { InputType::Type::Month, &createInputType<MonthInputType> } },
        { "number"_s, { InputType::Type::Number, &createInputType<NumberInputType> } },
        { "password"_s, { InputType::Type::Password, &createInputType<PasswordInputType> } },
        { "radio"_s, { InputType::Type::Radio, &createInputType<RadioInputType> } },
        { "range"_s, { InputType::Type::Range, &createInputType<RangeInputType> } },
        { "reset"_s, { InputType::Type::Reset, &createInputType<ResetInputType> } },
        { "search"_s, { InputType::Type::Search, &createInputType<SearchInputType> } },
        { "submit"_s, { InputType::Type::Submit, &createInputType<SubmitInputType> } },
        { "tel"_s, { InputType::Type::Telephone, &createInputType<TelephoneInputType> } },
        { "text"_s, { InputType::Type::Text, &createInputType<TextInputType> } },
        { "time"_s, { InputType::Type::Time, &createInputType<TimeInputType> } },
        { "url"_s, { InputType::Type::URL, &createInputType<URLInputType> } },
        { "week"_s, { InputType::Type::Week, &createInputType<WeekInputType> } },
    }) };
    return factories.tryGet(typeName);
}

RefPtr<InputType> InputType::createIfDifferent(HTMLInputElement& element, const AtomString& typeName, InputType* currentInputType)
{
    if (!typeName.isEmpty()) {
        if (auto* factory = findFactory(typeName)) [[likely]] {
            if (currentInputType && factory->type == currentInputType->type())
                return nullptr;
            return factory->factoryFunction(element);
        }
    }
    if (currentInputType && currentInputType->type() == Type::Text)
        return nullptr;
    return TextInputType::create(element);
}

InputType::~InputType() = default;

bool InputType::isFormDataAppendable() const
{
    ASSERT(element());
    // There is no form data unless there's a name for non-image types.
    return !protect(element())->name().isEmpty();
}

bool InputType::appendFormData(DOMFormData& formData) const
{
    ASSERT(element());
    // Always successful.
    Ref input = *element();
    formData.append(input->name(), input->value());
    return true;
}

WallTime InputType::valueAsDate() const
{
    return WallTime::nan();
}

ExceptionOr<void> InputType::setValueAsDate(WallTime) const
{
    return Exception { ExceptionCode::InvalidStateError };
}

double InputType::valueAsDouble() const
{
    return std::numeric_limits<double>::quiet_NaN();
}

ExceptionOr<void> InputType::setValueAsDouble(double doubleValue, TextFieldEventBehavior eventBehavior) const
{
    return setValueAsDecimal(Decimal::fromDouble(doubleValue), eventBehavior);
}

ExceptionOr<void> InputType::setValueAsDecimal(const Decimal&, TextFieldEventBehavior) const
{
    return Exception { ExceptionCode::InvalidStateError };
}

bool InputType::supportsRequired() const
{
    // Almost all validatable types support @required.
    return supportsValidation();
}

std::optional<std::pair<Decimal, StepRange>> InputType::parsedValueAndStepRange(StringView value) const
{
    if (!isSteppable())
        return std::nullopt;
    auto numericValue = parseToNumberOrNaN(value);
    if (!numericValue.isFinite())
        return std::nullopt;
    return { { numericValue, createStepRange(AnyStepHandling::Reject) } };
}

bool InputType::rangeUnderflow(StringView value) const
{
    auto parsed = parsedValueAndStepRange(value);
    if (!parsed)
        return false;

    auto& [numericValue, range] = *parsed;

    if (range.isReversible() && range.maximum() < range.minimum())
        return numericValue > range.maximum() && numericValue < range.minimum();

    return numericValue < range.minimum();
}

bool InputType::rangeOverflow(StringView value) const
{
    auto parsed = parsedValueAndStepRange(value);
    if (!parsed)
        return false;

    auto& [numericValue, range] = *parsed;

    if (range.isReversible() && range.maximum() < range.minimum())
        return numericValue > range.maximum() && numericValue < range.minimum();

    return numericValue > range.maximum();
}

bool InputType::isInvalid(StringView value) const
{
    switch (m_type) {
    case Type::Button:
        return isInvalidInputType(uncheckedDowncast<ButtonInputType>(*this), value);
    case Type::Checkbox:
        return isInvalidInputType(uncheckedDowncast<CheckboxInputType>(*this), value);
    case Type::Color:
        return isInvalidInputType(uncheckedDowncast<ColorInputType>(*this), value);
    case Type::Date:
        return isInvalidInputType(uncheckedDowncast<DateInputType>(*this), value);
    case Type::DateTimeLocal:
        return isInvalidInputType(uncheckedDowncast<DateTimeLocalInputType>(*this), value);
    case Type::Email:
        return isInvalidInputType(uncheckedDowncast<EmailInputType>(*this), value);
    case Type::File:
        return isInvalidInputType(uncheckedDowncast<FileInputType>(*this), value);
    case Type::Hidden:
        return isInvalidInputType(uncheckedDowncast<HiddenInputType>(*this), value);
    case Type::Image:
        return isInvalidInputType(uncheckedDowncast<ImageInputType>(*this), value);
    case Type::Month:
        return isInvalidInputType(uncheckedDowncast<MonthInputType>(*this), value);
    case Type::Number:
        return isInvalidInputType(uncheckedDowncast<NumberInputType>(*this), value);
    case Type::Password:
        return isInvalidInputType(uncheckedDowncast<PasswordInputType>(*this), value);
    case Type::Radio:
        return isInvalidInputType(uncheckedDowncast<RadioInputType>(*this), value);
    case Type::Range:
        return isInvalidInputType(uncheckedDowncast<RangeInputType>(*this), value);
    case Type::Reset:
        return isInvalidInputType(uncheckedDowncast<ResetInputType>(*this), value);
    case Type::Search:
        return isInvalidInputType(uncheckedDowncast<SearchInputType>(*this), value);
    case Type::Submit:
        return isInvalidInputType(uncheckedDowncast<SubmitInputType>(*this), value);
    case Type::Telephone:
        return isInvalidInputType(uncheckedDowncast<TelephoneInputType>(*this), value);
    case Type::Time:
        return isInvalidInputType(uncheckedDowncast<TimeInputType>(*this), value);
    case Type::URL:
        return isInvalidInputType(uncheckedDowncast<URLInputType>(*this), value);
    case Type::Week:
        return isInvalidInputType(uncheckedDowncast<WeekInputType>(*this), value);
    case Type::Text:
        return isInvalidInputType(uncheckedDowncast<TextInputType>(*this), value);
    }
    ASSERT_NOT_REACHED();
    return false;
}

Decimal InputType::defaultValueForStepUp() const
{
    return 0;
}

bool InputType::isInRange(StringView value) const
{
    if (!isSteppable())
        return false;

    StepRange stepRange(createStepRange(AnyStepHandling::Reject));
    if (!stepRange.hasRangeLimitations())
        return false;

    // This function should return true if both validity.rangeUnderflow and
    // validity.rangeOverflow are false. If the INPUT has no value, they are false.
    const Decimal numericValue = parseToNumberOrNaN(value);
    if (!numericValue.isFinite())
        return true;

    if (stepRange.isReversible() && stepRange.maximum() < stepRange.minimum())
        return numericValue >= stepRange.minimum() || numericValue <= stepRange.maximum();

    return numericValue >= stepRange.minimum() && numericValue <= stepRange.maximum();
}

bool InputType::isOutOfRange(StringView value) const
{
    if (!isSteppable() || value.isEmpty())
        return false;

    StepRange stepRange(createStepRange(AnyStepHandling::Reject));
    if (!stepRange.hasRangeLimitations())
        return false;

    // This function should return true if either validity.rangeUnderflow or
    // validity.rangeOverflow is true. If the INPUT has no value, they are false.
    const Decimal numericValue = parseToNumberOrNaN(value);
    if (!numericValue.isFinite())
        return false;

    if (stepRange.isReversible() && stepRange.maximum() < stepRange.minimum())
        return numericValue > stepRange.maximum() && numericValue < stepRange.minimum();

    return numericValue < stepRange.minimum() || numericValue > stepRange.maximum();
}

bool InputType::stepMismatch(StringView value) const
{
    auto parsed = parsedValueAndStepRange(value);
    if (!parsed)
        return false;

    auto& [numericValue, range] = *parsed;
    return range.stepMismatch(numericValue);
}

bool InputType::hasStepRangeViolation(StringView value) const
{
    auto parsed = parsedValueAndStepRange(value);
    if (!parsed)
        return false;

    auto& [numericValue, range] = *parsed;

    if (range.isReversible() && range.maximum() < range.minimum()) {
        if (numericValue > range.maximum() && numericValue < range.minimum())
            return true;
    } else {
        if (numericValue < range.minimum() || numericValue > range.maximum())
            return true;
    }

    return range.stepMismatch(numericValue);
}

String InputType::badInputText() const
{
    ASSERT_NOT_REACHED();
    return validationMessageTypeMismatchText();
}

String InputType::typeMismatchText() const
{
    return validationMessageTypeMismatchText();
}

String InputType::valueMissingText() const
{
    return validationMessageValueMissingText();
}

String InputType::validationMessage() const
{
    ASSERT(element());
    Ref element = *this->element();
    String value = element->value();

    // The order of the following checks is meaningful. e.g. We'd like to show the
    // badInput message even if the control has other validation errors.
    if (hasBadInput())
        return badInputText();

    if (valueMissing(value))
        return valueMissingText();

    if (typeMismatch())
        return typeMismatchText();

    if (patternMismatch(value)) {
        auto title = element->attributeWithoutSynchronization(HTMLNames::titleAttr).string().trim(isASCIIWhitespace).simplifyWhiteSpace(isASCIIWhitespace);
        if (title.isEmpty())
            return validationMessagePatternMismatchText();
        return validationMessagePatternMismatchText(title);
    }

    if (element->tooShort())
        return validationMessageTooShortText(value.length(), element->minLength());

    if (element->tooLong())
        return validationMessageTooLongText(value.length(), element->effectiveMaxLength());

    if (!isSteppable())
        return emptyString();

    const Decimal numericValue = parseToNumberOrNaN(value);
    if (!numericValue.isFinite())
        return emptyString();

    StepRange stepRange(createStepRange(AnyStepHandling::Reject));

    if (numericValue < stepRange.minimum())
        return validationMessageRangeUnderflowText(serialize(stepRange.minimum()));

    if (numericValue > stepRange.maximum())
        return validationMessageRangeOverflowText(serialize(stepRange.maximum()));

    if (stepRange.stepMismatch(numericValue)) {
        const String stepString = stepRange.hasStep() ? serializeForNumberType(stepRange.step() / stepRange.stepScaleFactor()) : emptyString();
        return validationMessageStepMismatchText(serialize(stepRange.stepBase()), stepString);
    }

    return emptyString();
}

auto InputType::handleKeydownEvent(KeyboardEvent&) -> ShouldCallBaseEventHandler
{
    return ShouldCallBaseEventHandler::Yes;
}

void InputType::handleKeypressEvent(KeyboardEvent&)
{
}

void InputType::handleKeyupEvent(KeyboardEvent&)
{
}

bool InputType::shouldSubmitImplicitly(Event& event)
{
    auto* keyboardEvent = dynamicDowncast<KeyboardEvent>(event);
    return keyboardEvent && event.type() == eventNames().keypressEvent && keyboardEvent->charCode() == '\r';
}

Decimal InputType::parseToNumber(StringView, const Decimal& defaultValue) const
{
    ASSERT_NOT_REACHED();
    return defaultValue;
}

Decimal InputType::parseToNumberOrNaN(StringView string) const
{
    return parseToNumber(string, Decimal::nan());
}

Decimal InputType::extractStepRangeBound(const QualifiedName& attributeName, const Decimal& defaultValue, RangeLimitations& rangeLimitations) const
{
    ASSERT(element());
    Decimal valueFromAttribute = parseToNumberOrNaN(element()->attributeWithoutSynchronization(attributeName));
    if (valueFromAttribute.isFinite()) {
        rangeLimitations = RangeLimitations::Valid;
        return valueFromAttribute;
    }
    return defaultValue;
}

String InputType::serialize(const Decimal&) const
{
    ASSERT_NOT_REACHED();
    return String();
}

void InputType::dispatchSimulatedClickIfActive(KeyboardEvent& event) const
{
    ASSERT(element());
    Ref element = *this->element();
    if (element->active())
        element->dispatchSimulatedClick(&event);
    event.setDefaultHandled();
}

bool InputType::hasCustomFocusLogic() const
{
    return true;
}

bool InputType::isKeyboardFocusable(const FocusEventData& focusEventData) const
{
    ASSERT(element());
    Ref element = *this->element();
    return !element->isReadOnly() && element->isTextFormControlKeyboardFocusable(focusEventData);
}

bool InputType::isMouseFocusable() const
{
    ASSERT(element());
    return protect(element())->isTextFormControlMouseFocusable();
}

bool InputType::accessKeyAction(bool)
{
    ASSERT(element());
    protect(element())->focus({ { }, { }, SelectionRestorationMode::SelectAll });
    return false;
}

bool InputType::canBeSuccessfulSubmitButton()
{
    return false;
}

ValueOrReference<String> LEGACY_NODELETE InputType::fallbackValue() const
{
    return String();
}

String LEGACY_NODELETE InputType::defaultValue() const
{
    return String();
}

bool InputType::shouldSendChangeEventAfterCheckedChanged()
{
    return true;
}

bool InputType::storesValueSeparateFromAttribute()
{
    return true;
}

void InputType::setValue(const String& sanitizedValue, bool valueChanged, TextFieldEventBehavior eventBehavior, TextControlSetValueSelection)
{
    RefPtr element = this->element();
    ASSERT(element);
    if (!valueChanged) {
        element->setValueInternal(sanitizedValue, eventBehavior);
        return;
    }

    element->setValueInternal(sanitizedValue, eventBehavior);

    switch (eventBehavior) {
    case DispatchChangeEvent:
        element->dispatchFormControlChangeEvent();
        break;
    case DispatchInputAndChangeEvent:
        element->dispatchFormControlInputEvent();
        element->dispatchFormControlChangeEvent();
        break;
    case DispatchNoEvent:
        break;
    }
}

bool InputType::isEmptyValue() const
{
    return true;
}

ValueOrReference<String> InputType::sanitizeValue(const String& proposedValue LIFETIME_BOUND) const
{
    return proposedValue;
}

bool InputType::isInteractiveContent() const
{
    return m_type != Type::Hidden;
}

bool InputType::isLabelable() const
{
    return m_type != Type::Hidden;
}

bool InputType::isEnumeratable() const
{
    return m_type != Type::Image;
}

bool InputType::supportsPlaceholder() const
{
    return false;
}

bool InputType::supportsReadOnly() const
{
    return false;
}

bool InputType::matchesIndeterminatePseudoClass() const
{
    return false;
}

bool InputType::supportsSelectionAPI() const
{
    return false;
}

bool InputType::dirAutoUsesValue() const
{
    return false;
}

unsigned InputType::height() const
{
    return 0;
}

unsigned InputType::width() const
{
    return 0;
}

ExceptionOr<void> InputType::applyStep(int count, AnyStepHandling anyStepHandling, TextFieldEventBehavior eventBehavior)
{
    // https://html.spec.whatwg.org/C/#dom-input-stepup

    StepRange stepRange(createStepRange(anyStepHandling));
    // 2. If the element has no allowed value step, then throw an InvalidStateError exception, and abort these steps.
    if (!stepRange.hasStep())
        return Exception { ExceptionCode::InvalidStateError };

    // 3. If the element has a minimum and a maximum and the minimum is greater than the maximum, then abort these steps.
    if (stepRange.minimum() > stepRange.maximum())
        return { };
    
    // 4. If the element has a minimum and a maximum and there is no value greater than or equal to the element's minimum and less than or equal to
    // the element's maximum that, when subtracted from the step base, is an integral multiple of the allowed value step, then abort these steps.
    Decimal alignedMaximum = stepRange.stepSnappedMaximum();
    if (!alignedMaximum.isFinite())
        return { };

    ASSERT(element());
    Ref element = *this->element();
    const Decimal current = parseToNumber(element->value(), 0);
    Decimal base = stepRange.stepBase();
    Decimal step = stepRange.step();
    Decimal newValue = current;

    const AtomString& stepString = element->getAttribute(HTMLNames::stepAttr);

    if (!equalLettersIgnoringASCIICase(stepString, "any"_s) && stepRange.stepMismatch(current)) {
        // Snap-to-step / clamping steps
        // If the current value is not matched to step value:
        // - The value should be the larger matched value nearest to 0 if count > 0
        //   e.g. <input type=number value=3 min=-100 step=3> -> 5
        // - The value should be the smaller matched value nearest to 0 if count < 0
        //   e.g. <input type=number value=3 min=-100 step=3> -> 2

        ASSERT(!step.isZero());
        if (count < 0) {
            newValue = base + ((newValue - base) / step).floor() * step;
            ++count;
        } else if (count > 0) {
            newValue = base + ((newValue - base) / step).ceil() * step;
            --count;
        }
    }

    newValue = newValue + stepRange.step() * Decimal::fromDouble(count);

    if (!equalLettersIgnoringASCIICase(stepString, "any"_s))
        newValue = stepRange.alignValueForStep(current, newValue);

    // 8. If the element has a minimum, and value is less than that minimum, then set value to the smallest value that, when subtracted from the step
    // base, is an integral multiple of the allowed value step, and that is more than or equal to minimum.
    if (newValue < stepRange.minimum()) {
        const Decimal alignedMinimum = base + ((stepRange.minimum() - base) / step).ceil() * step;
        ASSERT(alignedMinimum >= stepRange.minimum());
        newValue = alignedMinimum;
    }

    // 9. If the element has a maximum, and value is greater than that maximum, then set value to the largest value that, when subtracted from the step
    // base, is an integral multiple of the allowed value step, and that is less than or equal to maximum.
    if (newValue > stepRange.maximum())
        newValue = alignedMaximum;

    // 10. If either the method invoked was the stepDown() method and value is greater than valueBeforeStepping, or the method invoked was the stepUp()
    // method and value is less than valueBeforeStepping, then return.
    if ((count < 0 && current < newValue) || (count > 0 && current > newValue))
        return { };
    
    // 11. Let value as string be the result of running the algorithm to convert a number to a string, as defined for the input element's type attribute's
    // current state, on value.
    // 12. Set the value of the element to value as string.

    Ref protectedThis { *this };
    return setValueAsDecimal(newValue, eventBehavior);
}

bool InputType::getAllowedValueStep(Decimal* step) const
{
    StepRange stepRange(createStepRange(AnyStepHandling::Reject));
    *step = stepRange.step();
    return stepRange.hasStep();
}

StepRange InputType::createStepRange(AnyStepHandling) const
{
    ASSERT_NOT_REACHED();
    return StepRange();
}

ExceptionOr<void> InputType::stepUp(int n)
{
    if (!isSteppable())
        return Exception { ExceptionCode::InvalidStateError };
    return applyStep(n, AnyStepHandling::Reject, DispatchNoEvent);
}

void InputType::stepUpOrDown(StepDirection direction)
{
    // The differences from stepUp()/stepDown():
    //
    // Difference 1: the current value
    // If the current value is not a number, including empty, the current value is assumed as 0.
    //   * If 0 is in-range, and matches to step value
    //     - The value should be the +step if n > 0
    //     - The value should be the -step if n < 0
    //     If -step or +step is out of range, new value should be 0.
    //   * If 0 is smaller than the minimum value
    //     - The value should be the minimum value for any n
    //   * If 0 is larger than the maximum value
    //     - The value should be the maximum value for any n
    //   * If 0 is in-range, but not matched to step value
    //     - The value should be the larger matched value nearest to 0 if n > 0
    //       e.g. <input type=number min=-100 step=3> -> 2
    //     - The value should be the smaller matched value nearest to 0 if n < 0
    //       e.g. <input type=number min=-100 step=3> -> -1
    //   As for date/datetime-local/month/time/week types, the current value is assumed as "the current local date/time".
    //   As for datetime type, the current value is assumed as "the current date/time in UTC".
    // If the current value is smaller than the minimum value:
    //  - The value should be the minimum value if n > 0
    //  - Nothing should happen if n < 0
    // If the current value is larger than the maximum value:
    //  - The value should be the maximum value if n < 0
    //  - Nothing should happen if n > 0
    //
    // Difference 2: clamping steps
    // If the current value is not matched to step value:
    // - The value should be the larger matched value nearest to 0 if n > 0
    //   e.g. <input type=number value=3 min=-100 step=3> -> 5
    // - The value should be the smaller matched value nearest to 0 if n < 0
    //   e.g. <input type=number value=3 min=-100 step=3> -> 2
    //
    // n is assumed as -n if step < 0.

    ASSERT(isSteppable());
    if (!isSteppable())
        return;
    const auto n = direction == StepDirection::Up ? 1 : -1;

    StepRange stepRange(createStepRange(AnyStepHandling::Default));

    // FIXME: Not any changes after stepping, even if it is an invalid value, may be better.
    // (e.g. Stepping-up for <input type="number" value="foo" step="any" /> => "foo")
    if (!stepRange.hasStep())
      return;

    EventQueueScope scope;
    const Decimal step = stepRange.step();

    int sign;
    if (step > 0)
        sign = n;
    else if (step < 0)
        sign = -n;
    else
        sign = 0;

    ASSERT(element());
    Ref element = *this->element();

    Ref beforeInputEvent = InputEvent::create(eventNames().beforeinputEvent, emptyString(), Event::IsCancelable::Yes,
        element->document().window(), { }, { }, 0, IsInputMethodComposing::No);
    element->dispatchEvent(beforeInputEvent);
    if (beforeInputEvent->defaultPrevented())
        return;

    String currentStringValue = element->value();
    Decimal current = parseToNumberOrNaN(currentStringValue);
    if (!current.isFinite()) {
        current = defaultValueForStepUp();
        const Decimal nextDiff = step * n;
        if (current < stepRange.minimum() - nextDiff)
            current = stepRange.minimum() - nextDiff;
        if (current > stepRange.maximum() - nextDiff)
            current = stepRange.maximum() - nextDiff;
        setValueAsDecimal(current, DispatchNoEvent);
    }
    if ((sign > 0 && current < stepRange.minimum()) || (sign < 0 && current > stepRange.maximum()))
        setValueAsDecimal(sign > 0 ? stepRange.minimum() : stepRange.maximum(), DispatchInputAndChangeEvent);
    else {
        if (stepMismatch(element->value())) {
            ASSERT(!step.isZero());
            const Decimal base = stepRange.stepBase();
            Decimal newValue;
            if (sign < 0)
                newValue = base + ((current - base) / step).floor() * step;
            else if (sign > 0)
                newValue = base + ((current - base) / step).ceil() * step;
            else
                newValue = current;

            if (newValue < stepRange.minimum())
                newValue = stepRange.minimum();
            if (newValue > stepRange.maximum())
                newValue = stepRange.maximum();

            setValueAsDecimal(newValue, DispatchInputAndChangeEvent);
        } else
            applyStep(n, AnyStepHandling::Default, DispatchInputAndChangeEvent);
    }
}

String InputType::resultForDialogSubmit() const
{
    ASSERT(element());
    return protect(element())->value();
}

Decimal InputType::findStepBase(const Decimal& defaultValue) const
{
    Ref element = *this->element();
    Decimal stepBase = parseToNumber(element->attributeWithoutSynchronization(minAttr), Decimal::nan());
    if (!stepBase.isFinite())
        stepBase = parseToNumber(element->attributeWithoutSynchronization(valueAttr), defaultValue);
    return stepBase;
}

} // namespace WebCore
