/*
 * Copyright (C) 2010 Google Inc. All rights reserved.
 * Copyright (C) 2016 Apple Inc. All rights reserved.
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

class DateComponents;

// A super class of date, datetime, datetime-local, month, time, and week types.
class BaseDateAndTimeInputType : public InputType {
    WTF_MAKE_TZONE_ALLOCATED(BaseDateAndTimeInputType);
public:
    bool typeMismatchFor(StringView) const final;
    bool valueMissing(StringView) const final;
    bool typeMismatch() const final;

protected:
    BaseDateAndTimeInputType(Type type, HTMLInputElement& element)
        : InputType(type, element)
    {
    }

    ~BaseDateAndTimeInputType();

    Decimal parseToNumber(StringView, const Decimal&) const override;
    String serialize(const Decimal&) const final;
    String serializeWithComponents(const DateComponents&) const;

private:
    virtual std::optional<DateComponents> parseToDateComponents(StringView) const = 0;
    virtual std::optional<DateComponents> setMillisecondToDateComponents(double) const = 0;
    virtual String serializeWithMilliseconds(double) const;

    // InputType functions:
    ValueOrReference<String> sanitizeValue(const String& value LIFETIME_BOUND) const override;
    WallTime valueAsDate() const override;
    ExceptionOr<void> setValueAsDate(WallTime) const override;
    double valueAsDouble() const final;
    ExceptionOr<void> setValueAsDecimal(const Decimal&, TextFieldEventBehavior) const final;
    Decimal defaultValueForStepUp() const override;
    bool supportsReadOnly() const final { return true; }
    bool shouldRespectListAttribute() final { return false; }
    bool isKeyboardFocusable(const FocusEventData&) const final;
    bool isMouseFocusable() const final;

    ShouldCallBaseEventHandler handleKeydownEvent(KeyboardEvent&) final;
    void handleKeypressEvent(KeyboardEvent&) final;
    void handleKeyupEvent(KeyboardEvent&) final;
    bool accessKeyAction(bool sendMouseEvents) final;
};

} // namespace WebCore
