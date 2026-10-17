/*
 * Copyright (C) 2016 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Apple Inc. ("Apple") nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "ScrollOptions.h"
#include <cmath>

namespace WebCore {

struct ScrollToOptions : ScrollOptions {
    std::optional<double> left;
    std::optional<double> top;
};

inline double normalizeNonFiniteValueOrFallBackTo(std::optional<double> value, double fallbackValue)
{
    // Normalize non-finite values (https://drafts.csswg.org/cssom-view/#normalize-non-finite-values).
    return value ? (std::isfinite(*value) ? *value : 0) : fallbackValue;
}

// FIXME(https://webkit.org/b/88339): Consider using FloatPoint or DoublePoint for fallback and return values.
inline ScrollToOptions normalizeNonFiniteCoordinatesOrFallBackTo(const ScrollToOptions& value, double x, double y)
{
    ScrollToOptions options = value;
    options.left = normalizeNonFiniteValueOrFallBackTo(value.left, x);
    options.top = normalizeNonFiniteValueOrFallBackTo(value.top, y);
    return options;
}

}
