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

#pragma once

#include "BaseDateAndTimeInputType.h"
#include <wtf/TZoneMalloc.h>

namespace WebCore {

class DateTimeLocalInputType final : public BaseDateAndTimeInputType {
    WTF_MAKE_TZONE_ALLOCATED(DateTimeLocalInputType);
public:
    static Ref<DateTimeLocalInputType> create(HTMLInputElement& element)
    {
        return adoptRef(*new DateTimeLocalInputType(element));
    }

private:
    explicit DateTimeLocalInputType(HTMLInputElement& element)
        : BaseDateAndTimeInputType(Type::DateTimeLocal, element)
    {
    }

    const AtomString& formControlType() const final;
    WallTime valueAsDate() const final;
    ExceptionOr<void> setValueAsDate(WallTime) const final;
    StepRange createStepRange(AnyStepHandling) const final;
    std::optional<DateComponents> parseToDateComponents(StringView) const final;
    std::optional<DateComponents> setMillisecondToDateComponents(double) const final;
    ValueOrReference<String> sanitizeValue(const String& value LIFETIME_BOUND) const final;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_INPUT_TYPE(DateTimeLocalInputType, Type::DateTimeLocal)
