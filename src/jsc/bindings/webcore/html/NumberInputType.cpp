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
#include "NumberInputType.h"

#include "Decimal.h"
#include "ElementInlines.h"
#include "HTMLInputElement.h"
#include "HTMLNames.h"
#include "HTMLParserIdioms.h"
#include "InputTypeNames.h"
#include "KeyboardEvent.h"
#include "StepRange.h"
#include <limits>
#include <wtf/MathExtras.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(NumberInputType);

using namespace HTMLNames;

static const int numberDefaultStep = 1;
static const int numberDefaultStepBase = 0;
static const int numberStepScaleFactor = 1;

const AtomString& NumberInputType::formControlType() const
{
    return InputTypeNames::number();
}

double NumberInputType::valueAsDouble() const
{
    ASSERT(element());
    return parseToDoubleForNumberType(protect(element())->value().get());
}

ExceptionOr<void> NumberInputType::setValueAsDouble(double newValue, TextFieldEventBehavior eventBehavior) const
{
    ASSERT(element());
    protect(element())->setValue(serializeForNumberType(newValue), eventBehavior);
    return { };
}

ExceptionOr<void> NumberInputType::setValueAsDecimal(const Decimal& newValue, TextFieldEventBehavior eventBehavior) const
{
    ASSERT(element());
    protect(element())->setValue(serializeForNumberType(newValue), eventBehavior);
    return { };
}

bool NumberInputType::typeMismatchFor(StringView value) const
{
    return !value.isEmpty() && !std::isfinite(parseToDoubleForNumberType(value));
}

bool NumberInputType::typeMismatch() const
{
    ASSERT(element());
    ASSERT(!typeMismatchFor(protect(element())->value()));
    return false;
}

StepRange NumberInputType::createStepRange(AnyStepHandling anyStepHandling) const
{
    static NeverDestroyed<const StepRange::StepDescription> stepDescription(numberDefaultStep, numberDefaultStepBase, numberStepScaleFactor);

    ASSERT(element());
    const Decimal stepBase = findStepBase(numberDefaultStepBase);

    const Decimal doubleMax = Decimal::doubleMax();
    Ref element = *this->element();

    RangeLimitations rangeLimitations = RangeLimitations::Invalid;
    Decimal minimum = extractStepRangeBound(minAttr, -doubleMax, rangeLimitations);
    Decimal maximum = extractStepRangeBound(maxAttr, doubleMax, rangeLimitations);

    const Decimal step = StepRange::parseStep(anyStepHandling, stepDescription, element->attributeWithoutSynchronization(stepAttr));
    return StepRange(stepBase, rangeLimitations, minimum, maximum, step, stepDescription);
}

auto NumberInputType::handleKeydownEvent(KeyboardEvent& event) -> ShouldCallBaseEventHandler
{
    handleKeydownEventForSpinButton(event);
    return ShouldCallBaseEventHandler::Yes;
}

Decimal NumberInputType::parseToNumber(StringView src, const Decimal& defaultValue) const
{
    return parseToDecimalForNumberType(src, defaultValue);
}

String NumberInputType::serialize(const Decimal& value) const
{
    if (!value.isFinite())
        return String();
    return serializeForNumberType(value);
}

ValueOrReference<String> NumberInputType::sanitizeValue(const String& proposedValue LIFETIME_BOUND) const
{
    if (proposedValue.isEmpty())
        return proposedValue;
    if (std::isfinite(parseToDoubleForNumberType(proposedValue)))
        return proposedValue;
    return emptyString();
}

bool NumberInputType::supportsPlaceholder() const
{
    return true;
}

} // namespace WebCore
