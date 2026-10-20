/*
 * Copyright (C) 2006, 2007, 2008, 2009, 2010 Apple Inc. All rights reserved.
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

#pragma once

#include "Decimal.h"
#include <wtf/Forward.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore {

enum class AnyStepHandling : bool { Reject, Default };

enum class RangeLimitations : bool { Valid, Invalid };

class StepRange {
    WTF_MAKE_TZONE_ALLOCATED(StepRange);
public:
    enum class StepValueShouldBe : uint8_t {
        Real,
        ParsedInteger,
        ScaledInteger,
    };

    struct StepDescription {
        WTF_MAKE_TZONE_ALLOCATED(StepDescription);
    public:
        int defaultStep { 1 };
        int defaultStepBase { 0 };
        int stepScaleFactor { 1 };
        StepValueShouldBe stepValueShouldBe { StepValueShouldBe::Real };

        constexpr StepDescription(int defaultStep, int defaultStepBase, int stepScaleFactor, StepValueShouldBe stepValueShouldBe = StepValueShouldBe::Real)
            : defaultStep(defaultStep)
            , defaultStepBase(defaultStepBase)
            , stepScaleFactor(stepScaleFactor)
            , stepValueShouldBe(stepValueShouldBe)
        {
        }

        StepDescription() = default;

        Decimal defaultValue() const
        {
            return defaultStep * stepScaleFactor;
        }
    };

    enum class IsReversible : bool { No, Yes };

    StepRange();
    StepRange(const StepRange&);
    StepRange(const Decimal& stepBase, RangeLimitations, const Decimal& minimum, const Decimal& maximum, const Decimal& step, const StepDescription&, IsReversible = IsReversible::No);
    Decimal LEGACY_NODELETE acceptableError() const;
    Decimal alignValueForStep(const Decimal& currentValue, const Decimal& newValue) const;
    Decimal clampValue(const Decimal& value) const;
    bool hasStep() const { return m_hasStep; }
    bool hasRangeLimitations() const { return m_hasRangeLimitations; }
    Decimal maximum() const { return m_maximum; }
    Decimal minimum() const { return m_minimum; }
    Decimal stepSnappedMaximum() const;
    static Decimal parseStep(AnyStepHandling, const StepDescription&, StringView);
    Decimal step() const { return m_step; }
    Decimal stepBase() const { return m_stepBase; }
    int stepScaleFactor() const { return m_stepDescription.stepScaleFactor; }
    bool stepMismatch(const Decimal&) const;
    bool isReversible() const { return m_isReversible; }

    // Clamp the middle value according to the step
    Decimal defaultValue() const
    {
        return clampValue((m_minimum + m_maximum) / 2);
    }

private:
    StepRange& operator =(const StepRange&);
    Decimal roundByStep(const Decimal& value, const Decimal& base) const;

    const Decimal m_maximum; // maximum must be >= minimum.
    const Decimal m_minimum;
    const Decimal m_step;
    const Decimal m_stepBase;
    const StepDescription m_stepDescription;
    const bool m_hasRangeLimitations { false };
    const bool m_hasStep { false };
    const bool m_isReversible { false };
};

} // namespace WebCore
