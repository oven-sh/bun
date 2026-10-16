/*
 * Copyright (C) 2006-2024 Apple Inc. All rights reserved.
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
#include "StepRange.h"

#include "HTMLNames.h"
#include "HTMLParserIdioms.h"
#include <wtf/MathExtras.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(StepRange);
WTF_MAKE_TZONE_ALLOCATED_IMPL(StepRange::StepDescription);

using namespace HTMLNames;

StepRange::StepRange()
    : m_maximum(100)
    , m_minimum(0)
    , m_step(1)
    , m_stepBase(0)
    , m_stepDescription()
{
}

StepRange::StepRange(const StepRange& stepRange)
    : m_maximum(stepRange.m_maximum)
    , m_minimum(stepRange.m_minimum)
    , m_step(stepRange.m_step)
    , m_stepBase(stepRange.m_stepBase)
    , m_stepDescription(stepRange.m_stepDescription)
    , m_hasRangeLimitations(stepRange.m_hasRangeLimitations)
    , m_hasStep(stepRange.m_hasStep)
    , m_isReversible(stepRange.m_isReversible)
{
}

StepRange::StepRange(const Decimal& stepBase, RangeLimitations rangeLimitations, const Decimal& minimum, const Decimal& maximum, const Decimal& step, const StepDescription& stepDescription, IsReversible isReversible)
    : m_maximum(maximum)
    , m_minimum(minimum)
    , m_step(step.isFinite() ? step : 1)
    , m_stepBase(stepBase.isFinite() ? stepBase : 1)
    , m_stepDescription(stepDescription)
    , m_hasRangeLimitations(rangeLimitations == RangeLimitations::Valid)
    , m_hasStep(step.isFinite())
    , m_isReversible(isReversible == IsReversible::Yes)
{
    ASSERT(m_maximum.isFinite());
    ASSERT(m_minimum.isFinite());
    ASSERT(m_step.isFinite());
    ASSERT(m_stepBase.isFinite());
}

Decimal StepRange::acceptableError() const
{
    // FIXME: We should use DBL_MANT_DIG instead of FLT_MANT_DIG regarding to HTML5 specification.
    static NeverDestroyed<const Decimal> twoPowerOfFloatMantissaBits(Decimal::Positive, 0, UINT64_C(1) << FLT_MANT_DIG);
    return m_stepDescription.stepValueShouldBe == StepValueShouldBe::Real ? m_step / twoPowerOfFloatMantissaBits : Decimal(0);
}

Decimal StepRange::alignValueForStep(const Decimal& currentValue, const Decimal& newValue) const
{
    static NeverDestroyed<const Decimal> tenPowerOf21(Decimal::Positive, 21, 1);
    if (newValue >= tenPowerOf21)
        return newValue;

    return stepMismatch(currentValue) ? newValue : roundByStep(newValue, m_stepBase);
}

Decimal StepRange::clampValue(const Decimal& value) const
{
    const Decimal inRangeValue = std::max(m_minimum, std::min(value, m_maximum));
    if (!m_hasStep)
        return inRangeValue;
    // Rounds inRangeValue to stepBase + N * step.
    const Decimal roundedValue = roundByStep(inRangeValue, m_stepBase);
    const Decimal clampedValue = roundedValue > m_maximum ? roundedValue - m_step : (roundedValue < m_minimum ? roundedValue + m_step : roundedValue);
    // clampedValue can be outside of [m_minimum, m_maximum] if m_step is huge.
    if (clampedValue < m_minimum || clampedValue > m_maximum)
        return inRangeValue;
    return clampedValue;
}

Decimal StepRange::parseStep(AnyStepHandling anyStepHandling, const StepDescription& stepDescription, StringView stepString)
{
    if (stepString.isEmpty())
        return stepDescription.defaultValue();

    if (equalLettersIgnoringASCIICase(stepString, "any"_s)) {
        switch (anyStepHandling) {
        case AnyStepHandling::Reject:
            return Decimal::nan();
        case AnyStepHandling::Default:
            return stepDescription.defaultValue();
        default:
            ASSERT_NOT_REACHED();
        }
    }

    Decimal step = parseToDecimalForNumberType(stepString);
    if (!step.isFinite() || step <= 0)
        return stepDescription.defaultValue();

    switch (stepDescription.stepValueShouldBe) {
    case StepValueShouldBe::Real:
        step *= stepDescription.stepScaleFactor;
        break;
    case StepValueShouldBe::ParsedInteger:
        // For date, month, and week, the parsed value should be an integer for some types.
        step = std::max(step.round(), Decimal(1));
        step *= stepDescription.stepScaleFactor;
        break;
    case StepValueShouldBe::ScaledInteger:
        // For datetime, datetime-local, time, the result should be an integer.
        step *= stepDescription.stepScaleFactor;
        step = std::max(step.round(), Decimal(1));
        break;
    }

    ASSERT(step > 0);
    return step;
}

Decimal StepRange::roundByStep(const Decimal& value, const Decimal& base) const
{
    return base + ((value - base) / m_step).round() * m_step;
}

Decimal StepRange::stepSnappedMaximum() const
{
    Decimal base = stepBase();
    Decimal step =  m_step;
    if (base - step == base || !(base / step).isFinite())
        return Decimal::nan();
    Decimal alignedMaximum = base + ((maximum() - base) / step).floor() * step;
    if (alignedMaximum > maximum())
        alignedMaximum -= step;
    if (alignedMaximum < minimum())
        return Decimal::nan();
    return alignedMaximum;
}

bool StepRange::stepMismatch(const Decimal& valueForCheck) const
{
    if (!m_hasStep)
        return false;
    if (!valueForCheck.isFinite())
        return false;
    const Decimal value = (valueForCheck - m_stepBase).abs();
    if (!value.isFinite())
        return false;
    // Decimal's fractional part size is DBL_MAN_DIG-bit. If the current value
    // is greater than step*2^DBL_MANT_DIG, the following computation for
    // remainder makes no sense.
    static NeverDestroyed<const Decimal> twoPowerOfDoubleMantissaBits(Decimal::Positive, 0, UINT64_C(1) << DBL_MANT_DIG);
    if (value / twoPowerOfDoubleMantissaBits > m_step)
        return false;
    // The computation follows HTML5 4.10.7.2.10 `The step attribute' :
    // ... that number subtracted from the step base is not an integral multiple
    // of the allowed value step, the element is suffering from a step mismatch.
    const Decimal remainder = (value - m_step * (value / m_step).round()).abs();
    // Accepts erros in lower fractional part which IEEE 754 single-precision
    // can't represent.
    const Decimal computedAcceptableError = acceptableError();
    return computedAcceptableError < remainder && remainder < (m_step - computedAcceptableError);
}

} // namespace WebCore
