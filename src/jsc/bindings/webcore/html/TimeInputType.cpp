/*
 * Copyright (C) 2010 Google Inc. All rights reserved.
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
#include "TimeInputType.h"

#include "DateComponents.h"
#include "Decimal.h"
#include "ElementInlines.h"
#include "HTMLInputElement.h"
#include "HTMLNames.h"
#include "InputTypeNames.h"
#include "StepRange.h"
#include <wtf/DateMath.h>
#include <wtf/MathExtras.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(TimeInputType);

using namespace HTMLNames;

static const int timeDefaultStep = 60;
static const int timeDefaultStepBase = 0;
static const int timeStepScaleFactor = 1000;
static const StepRange::StepDescription timeStepDescription { timeDefaultStep, timeDefaultStepBase, timeStepScaleFactor, StepRange::StepValueShouldBe::ScaledInteger };

TimeInputType::TimeInputType(HTMLInputElement& element)
    : BaseDateAndTimeInputType(Type::Time, element)
{
}

const AtomString& TimeInputType::formControlType() const
{
    return InputTypeNames::time();
}

Decimal TimeInputType::defaultValueForStepUp() const
{
    double current = WallTime::now().secondsSinceEpoch().milliseconds();
    int offset = calculateLocalTimeOffset(current).offset / msPerMinute;
    current += offset * msPerMinute;

    auto date = DateComponents::fromMillisecondsSinceMidnight(current);
    if (!date)
        return  { };

    double milliseconds = date->millisecondsSinceEpoch();
    ASSERT(std::isfinite(milliseconds));
    return Decimal::fromDouble(milliseconds);
}

StepRange TimeInputType::createStepRange(AnyStepHandling anyStepHandling) const
{
    ASSERT(element());
    Ref element = *this->element();
    const Decimal stepBase = findStepBase(timeDefaultStepBase);

    RangeLimitations rangeLimitations = RangeLimitations::Invalid;
    const Decimal minimum = extractStepRangeBound(minAttr, Decimal::fromDouble(DateComponents::minimumTime()), rangeLimitations);
    const Decimal maximum = extractStepRangeBound(maxAttr, Decimal::fromDouble(DateComponents::maximumTime()), rangeLimitations);

    const Decimal step = StepRange::parseStep(anyStepHandling, timeStepDescription, element->attributeWithoutSynchronization(stepAttr));
    return StepRange(stepBase, rangeLimitations, minimum, maximum, step, timeStepDescription, StepRange::IsReversible::Yes);
}

std::optional<DateComponents> TimeInputType::parseToDateComponents(StringView source) const
{
    return DateComponents::fromParsingTime(source);
}

std::optional<DateComponents> TimeInputType::setMillisecondToDateComponents(double value) const
{
    return DateComponents::fromMillisecondsSinceMidnight(value);
}

} // namespace WebCore
