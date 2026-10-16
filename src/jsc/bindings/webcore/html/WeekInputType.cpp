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
#include "WeekInputType.h"

#include "DateComponents.h"
#include "Decimal.h"
#include "ElementInlines.h"
#include "HTMLInputElement.h"
#include "HTMLNames.h"
#include "InputTypeNames.h"
#include "StepRange.h"

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(WeekInputType);

using namespace HTMLNames;

static const int weekDefaultStepBase = -259200000; // The first day of 1970-W01.
static const int weekDefaultStep = 1;
static const int weekStepScaleFactor = 604800000;
static const StepRange::StepDescription weekStepDescription { weekDefaultStep, weekDefaultStepBase, weekStepScaleFactor, StepRange::StepValueShouldBe::ParsedInteger };

const AtomString& WeekInputType::formControlType() const
{
    return InputTypeNames::week();
}

StepRange WeekInputType::createStepRange(AnyStepHandling anyStepHandling) const
{
    ASSERT(element());
    Ref element = *this->element();
    const Decimal stepBase = findStepBase(weekDefaultStepBase);

    RangeLimitations rangeLimitations = RangeLimitations::Invalid;
    const Decimal minimum = extractStepRangeBound(minAttr, Decimal::fromDouble(DateComponents::minimumWeek()), rangeLimitations);
    const Decimal maximum = extractStepRangeBound(maxAttr, Decimal::fromDouble(DateComponents::maximumWeek()), rangeLimitations);

    const Decimal step = StepRange::parseStep(anyStepHandling, weekStepDescription, element->attributeWithoutSynchronization(stepAttr));
    return StepRange(stepBase, rangeLimitations, minimum, maximum, step, weekStepDescription);
}

std::optional<DateComponents> WeekInputType::parseToDateComponents(StringView source) const
{
    return DateComponents::fromParsingWeek(source);
}

std::optional<DateComponents> WeekInputType::setMillisecondToDateComponents(double value) const
{
    return DateComponents::fromMillisecondsSinceEpochForWeek(value);
}

} // namespace WebCore
