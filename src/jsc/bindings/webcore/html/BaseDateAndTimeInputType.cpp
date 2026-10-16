/*
 * Copyright (C) 2010-2013 Google Inc. All rights reserved.
 * Copyright (C) 2016-2023 Apple Inc. All rights reserved.
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
#include "BaseDateAndTimeInputType.h"

#include "BaseClickableWithKeyInputType.h"
#include "DateComponents.h"
#include "Decimal.h"
#include "ExceptionOr.h"
#include "HTMLInputElement.h"
#include "KeyboardEvent.h"
#include "StepRange.h"
#include <limits>
#include <wtf/DateMath.h>
#include <wtf/MathExtras.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/StringView.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(BaseDateAndTimeInputType);

static const int msecPerMinute = 60 * 1000;
static const int msecPerSecond = 1000;

BaseDateAndTimeInputType::~BaseDateAndTimeInputType() = default;

WallTime BaseDateAndTimeInputType::valueAsDate() const
{
    return WallTime::fromRawSeconds(Seconds::fromMilliseconds(valueAsDouble()).value());
}

ExceptionOr<void> BaseDateAndTimeInputType::setValueAsDate(WallTime value) const
{
    ASSERT(element());
    protect(element())->setValue(serializeWithMilliseconds(value.secondsSinceEpoch().milliseconds()));
    return { };
}

double BaseDateAndTimeInputType::valueAsDouble() const
{
    ASSERT(element());
    const Decimal value = parseToNumber(protect(element())->value(), Decimal::nan());
    return value.isFinite() ? value.toDouble() : DateComponents::invalidMilliseconds();
}

ExceptionOr<void> BaseDateAndTimeInputType::setValueAsDecimal(const Decimal& newValue, TextFieldEventBehavior eventBehavior) const
{
    ASSERT(element());
    protect(element())->setValue(serialize(newValue), eventBehavior);
    return { };
}

bool BaseDateAndTimeInputType::typeMismatchFor(StringView value) const
{
    return !value.isEmpty() && !parseToDateComponents(value);
}

bool BaseDateAndTimeInputType::typeMismatch() const
{
    ASSERT(element());
    return typeMismatchFor(protect(element())->value());
}

Decimal BaseDateAndTimeInputType::defaultValueForStepUp() const
{
    double ms = WallTime::now().secondsSinceEpoch().milliseconds();
    int offset = calculateLocalTimeOffset(ms).offset / msPerMinute;
    return Decimal::fromDouble(ms + (offset * msPerMinute));
}

Decimal BaseDateAndTimeInputType::parseToNumber(StringView source, const Decimal& defaultValue) const
{
    auto date = parseToDateComponents(source);
    if (!date)
        return defaultValue;
    double msec = date->millisecondsSinceEpoch();
    ASSERT(std::isfinite(msec));
    return Decimal::fromDouble(msec);
}

String BaseDateAndTimeInputType::serialize(const Decimal& value) const
{
    if (!value.isFinite())
        return { };
    auto date = setMillisecondToDateComponents(value.toDouble());
    if (!date)
        return { };
    return serializeWithComponents(*date);
}

String BaseDateAndTimeInputType::serializeWithComponents(const DateComponents& date) const
{
    ASSERT(element());
    Decimal step;
    if (!protect(element())->getAllowedValueStep(&step) || step.remainder(msecPerMinute).isZero())
        return date.toString();
    if (step.remainder(msecPerSecond).isZero())
        return date.toString(SecondFormat::Second);
    return date.toString(SecondFormat::Millisecond);
}

String BaseDateAndTimeInputType::serializeWithMilliseconds(double value) const
{
    return serialize(Decimal::fromDouble(value));
}

ValueOrReference<String> BaseDateAndTimeInputType::sanitizeValue(const String& proposedValue LIFETIME_BOUND) const
{
    if (typeMismatchFor(proposedValue))
        return emptyString();
    return proposedValue;
}

bool BaseDateAndTimeInputType::valueMissing(StringView value) const
{
    ASSERT(element());
    return protect(element())->isMutable() && element()->isRequired() && value.isEmpty();
}

bool BaseDateAndTimeInputType::isKeyboardFocusable(const FocusEventData&) const
{
    ASSERT(element());
    Ref input = *element();
    return !input->isReadOnly() && input->isTextFormControlFocusable();
}

bool BaseDateAndTimeInputType::isMouseFocusable() const
{
    ASSERT(element());
    return protect(element())->isTextFormControlFocusable();
}

auto BaseDateAndTimeInputType::handleKeydownEvent(KeyboardEvent& event) -> ShouldCallBaseEventHandler
{
    ASSERT(element());
    return BaseClickableWithKeyInputType::handleKeydownEvent(*protect(element()), event);
}

void BaseDateAndTimeInputType::handleKeypressEvent(KeyboardEvent& event)
{
    // The return key should not activate the element, as it conflicts with
    // the key binding to submit a form.
    if (event.charCode() == '\r')
        return;

    ASSERT(element());
    BaseClickableWithKeyInputType::handleKeypressEvent(*protect(element()), event);
}

void BaseDateAndTimeInputType::handleKeyupEvent(KeyboardEvent& event)
{
    BaseClickableWithKeyInputType::handleKeyupEvent(*this, event);
}

bool BaseDateAndTimeInputType::accessKeyAction(bool sendMouseEvents)
{
    InputType::accessKeyAction(sendMouseEvents);
    ASSERT(element());
    return BaseClickableWithKeyInputType::accessKeyAction(*protect(element()), sendMouseEvents);
}

} // namespace WebCore
