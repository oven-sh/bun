/*
 * Copyright (C) 2010 Google Inc. All rights reserved.
 * Copyright (C) 2025 Apple Inc. All rights reserved.
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

#include "InputType.h"
#include <wtf/TZoneMalloc.h>

namespace WebCore {

class RangeInputType final : public InputType {
    WTF_MAKE_TZONE_ALLOCATED(RangeInputType);
public:
    static Ref<RangeInputType> create(HTMLInputElement& element)
    {
        return adoptRef(*new RangeInputType(element));
    }

private:
    explicit RangeInputType(HTMLInputElement&);

    const AtomString& formControlType() const final;
    double valueAsDouble() const final;
    ExceptionOr<void> setValueAsDecimal(const Decimal&, TextFieldEventBehavior) const final;
    bool supportsRequired() const final;
    StepRange createStepRange(AnyStepHandling) const final;
    ShouldCallBaseEventHandler handleKeydownEvent(KeyboardEvent&) final;
    Decimal parseToNumber(StringView, const Decimal&) const final;
    String serialize(const Decimal&) const final;
    bool accessKeyAction(bool sendMouseEvents) final;
    void attributeChanged(const QualifiedName&) final;
    void setValue(const String&, bool valueChanged, TextFieldEventBehavior, TextControlSetValueSelection) final;
    ValueOrReference<String> fallbackValue() const final;
    ValueOrReference<String> sanitizeValue(const String& proposedValue LIFETIME_BOUND) const final;
    bool shouldRespectListAttribute() final;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_INPUT_TYPE(RangeInputType, Type::Range)
