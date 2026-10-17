/*
 * Copyright (C) 2010-2014 Google Inc. All rights reserved.
 * Copyright (C) 2011-2025 Apple Inc. All rights reserved.
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

#include "config.h"
#include "RangeInputType.h"

#include "Decimal.h"
#include "ElementInlines.h"
#include "EventNames.h"
#include "HTMLInputElement.h"
#include "HTMLParserIdioms.h"
#include "InputTypeNames.h"
#include "KeyboardEvent.h"
#include "NodeName.h"
#include "ScopedEventQueue.h"
#include "StepRange.h"
#include <limits>
#include <wtf/MathExtras.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(RangeInputType);

using namespace HTMLNames;

static const int rangeDefaultMinimum = 0;
static const int rangeDefaultMaximum = 100;
static const int rangeDefaultStep = 1;
static const int rangeDefaultStepBase = 0;
static const int rangeStepScaleFactor = 1;
static const StepRange::StepDescription rangeStepDescription { rangeDefaultStep, rangeDefaultStepBase, rangeStepScaleFactor };

static Decimal ensureMaximum(const Decimal& proposedValue, const Decimal& minimum)
{
    return proposedValue >= minimum ? proposedValue : minimum;
}

RangeInputType::RangeInputType(HTMLInputElement& element)
    : InputType(Type::Range, element)
{
}

const AtomString& RangeInputType::formControlType() const
{
    return InputTypeNames::range();
}

double RangeInputType::valueAsDouble() const
{
    ASSERT(element());
    return parseToDoubleForNumberType(protect(element())->value().get());
}

ExceptionOr<void> RangeInputType::setValueAsDecimal(const Decimal& newValue, TextFieldEventBehavior eventBehavior) const
{
    ASSERT(element());
    protect(element())->setValue(serialize(newValue), eventBehavior);
    return { };
}

bool RangeInputType::supportsRequired() const
{
    return false;
}

StepRange RangeInputType::createStepRange(AnyStepHandling anyStepHandling) const
{
    ASSERT(element());
    Ref element = *this->element();
    const Decimal stepBase = findStepBase(rangeDefaultStepBase);
    const Decimal minimum = parseToNumber(element->attributeWithoutSynchronization(minAttr), rangeDefaultMinimum);
    const Decimal maximum = ensureMaximum(parseToNumber(element->attributeWithoutSynchronization(maxAttr), rangeDefaultMaximum), minimum);

    const Decimal step = StepRange::parseStep(anyStepHandling, rangeStepDescription, element->attributeWithoutSynchronization(stepAttr));
    return StepRange(stepBase, RangeLimitations::Valid, minimum, maximum, step, rangeStepDescription);
}

auto RangeInputType::handleKeydownEvent(KeyboardEvent& event) -> ShouldCallBaseEventHandler
{
    ASSERT(element());

    Ref element = *this->element();
    if (element->isDisabledFormControl())
        return ShouldCallBaseEventHandler::Yes;

    const String& key = event.keyIdentifier();

    const Decimal current = parseToNumberOrNaN(element->value());
    ASSERT(current.isFinite());

    auto stepRange = createStepRange(AnyStepHandling::Reject);

    // FIXME: We can't use stepUp() for the step value "any". So, we increase
    // or decrease the value by 1/100 of the value range. Is it reasonable?
    const Decimal step = equalLettersIgnoringASCIICase(element->attributeWithoutSynchronization(stepAttr), "any"_s) ? (stepRange.maximum() - stepRange.minimum()) / 100 : stepRange.step();
    const Decimal bigStep = std::max((stepRange.maximum() - stepRange.minimum()) / 10, step);

    Decimal newValue;
    if (key == "Up"_s)
        newValue = current + step;
    else if (key == "Down"_s)
        newValue = current - step;
    else if (key == "Left"_s)
        newValue = current - step;
    else if (key == "Right"_s)
        newValue = current + step;
    else if (key == "PageUp"_s)
        newValue = current + bigStep;
    else if (key == "PageDown"_s)
        newValue = current - bigStep;
    else if (key == "Home"_s)
        newValue = stepRange.minimum();
    else if (key == "End"_s)
        newValue = stepRange.maximum();
    else
        return ShouldCallBaseEventHandler::Yes; // Did not match any key binding.

    newValue = stepRange.clampValue(newValue);

    if (newValue != current) {
        EventQueueScope scope;
        setValueAsDecimal(newValue, DispatchInputAndChangeEvent);
    }

    event.setDefaultHandled();
    return ShouldCallBaseEventHandler::Yes;
}

Decimal RangeInputType::parseToNumber(StringView src, const Decimal& defaultValue) const
{
    return parseToDecimalForNumberType(src, defaultValue);
}

String RangeInputType::serialize(const Decimal& value) const
{
    if (!value.isFinite())
        return String();
    return serializeForNumberType(value);
}

// FIXME: Could share this with BaseClickableWithKeyInputType and BaseCheckableInputType if we had a common base class.
bool RangeInputType::accessKeyAction(bool sendMouseEvents)
{
    RefPtr element = this->element();
    return InputType::accessKeyAction(sendMouseEvents) || (element && element->dispatchSimulatedClick(0, sendMouseEvents ? SendMouseUpDownEvents : SendNoEvents));
}

void RangeInputType::attributeChanged(const QualifiedName& name)
{
    switch (name.nodeName()) {
    case AttributeNames::maxAttr:
    case AttributeNames::minAttr:
    case AttributeNames::valueAttr:
        // Sanitize the value.
        if (RefPtr element = this->element()) {
            if (element->hasDirtyValue())
                element->setValue(element->value());
        }
        break;
    default:
        break;
    }
    InputType::attributeChanged(name);
}

void RangeInputType::setValue(const String& value, bool valueChanged, TextFieldEventBehavior eventBehavior, TextControlSetValueSelection selection)
{
    InputType::setValue(value, valueChanged, eventBehavior, selection);

    if (!valueChanged)
        return;

    if (eventBehavior == DispatchNoEvent)
        protect(element())->setTextAsOfLastFormControlChangeEvent(String(value));
}

ValueOrReference<String> RangeInputType::fallbackValue() const
{
    return serializeForNumberType(createStepRange(AnyStepHandling::Reject).defaultValue());
}

ValueOrReference<String> RangeInputType::sanitizeValue(const String& proposedValue LIFETIME_BOUND) const
{
    StepRange stepRange(createStepRange(AnyStepHandling::Reject));
    const Decimal proposedNumericValue = parseToNumber(proposedValue, stepRange.defaultValue());
    return serializeForNumberType(stepRange.clampValue(proposedNumericValue));
}

bool RangeInputType::shouldRespectListAttribute()
{
    return true;
}

} // namespace WebCore
