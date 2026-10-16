/*
 * Copyright (C) 2010 Google Inc. All rights reserved.
 * Copyright (C) 2018 Apple Inc. All rights reserved.
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

class DOMFormData;

// The class represents types of which UI contain text fields.
// It supports not only the types for BaseTextInputType but also type=number.
class TextFieldInputType : public InputType {
    WTF_MAKE_TZONE_ALLOCATED(TextFieldInputType);
public:
    bool valueMissing(StringView) const final;

protected:
    explicit TextFieldInputType(Type, HTMLInputElement&);
    virtual ~TextFieldInputType();
    void handleKeydownEventForSpinButton(KeyboardEvent&);

    bool supportsReadOnly() const final { return true; }
    void setValue(const String&, bool valueChanged, TextFieldEventBehavior, TextControlSetValueSelection) override;
    ValueOrReference<String> sanitizeValue(const String& value LIFETIME_BOUND) const override;

private:
    bool isKeyboardFocusable(const FocusEventData&) const final;
    bool isMouseFocusable() const final;
    bool isEmptyValue() const final;
    bool shouldSubmitImplicitly(Event&) final;
    bool shouldRespectListAttribute() override;
    bool appendFormData(DOMFormData&) const final;
};

} // namespace WebCore
