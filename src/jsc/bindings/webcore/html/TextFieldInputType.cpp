/*
 * Copyright (C) 2010-2013 Google Inc. All rights reserved.
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
#include "TextFieldInputType.h"

#include "DOMFormData.h"
#include "ElementInlines.h"
#include "EventNames.h"
#include "HTMLInputElement.h"
#include "HTMLNames.h"
#include "HTMLParserIdioms.h"
#include "KeyboardEvent.h"
#include "TextEvent.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(TextFieldInputType);

using namespace HTMLNames;

TextFieldInputType::TextFieldInputType(Type type, HTMLInputElement& element)
    : InputType(type, element)
{
}

TextFieldInputType::~TextFieldInputType() = default;

bool TextFieldInputType::isKeyboardFocusable(const FocusEventData&) const
{
    ASSERT(element());
    return protect(element())->isTextFormControlFocusable();
}

bool TextFieldInputType::isMouseFocusable() const
{
    ASSERT(element());
    return protect(element())->isTextFormControlFocusable();
}

bool TextFieldInputType::isEmptyValue() const
{
    ASSERT(element());
    return protect(element())->value()->isEmpty();
}

bool TextFieldInputType::valueMissing(StringView value) const
{
    ASSERT(element());
    Ref element = *this->element();
    return element->isMutable() && element->isRequired() && value.isEmpty();
}

void TextFieldInputType::setValue(const String& sanitizedValue, bool valueChanged, TextFieldEventBehavior eventBehavior, TextControlSetValueSelection selection)
{
    ASSERT(element());

    // Grab this input element to keep reference even if JS event handler
    // changes input type.
    Ref input = *element();

    // We don't ask InputType::setValue to dispatch events because
    // TextFieldInputType dispatches events different way from InputType.
    InputType::setValue(sanitizedValue, valueChanged, DispatchNoEvent, selection);

    if (!valueChanged)
        return;

    input->updatePlaceholderVisibility();

    if (selection == TextControlSetValueSelection::SetSelectionToEnd)
        input->cacheSelectionInResponseToSetValue(input->value()->length());

    switch (eventBehavior) {
    case DispatchChangeEvent:
        // If the user is still editing this field, dispatch an input event rather than a change event.
        // The change event will be dispatched when editing finishes.
        if (input->focused())
            input->dispatchFormControlInputEvent();
        else
            input->dispatchFormControlChangeEvent();
        break;

    case DispatchInputAndChangeEvent: {
        input->dispatchFormControlInputEvent();
        input->dispatchFormControlChangeEvent();
        break;
    }

    case DispatchNoEvent:
        break;
    }

    if (!input->focused())
        input->setTextAsOfLastFormControlChangeEvent(String(sanitizedValue));
}

void TextFieldInputType::handleKeydownEventForSpinButton(KeyboardEvent& event)
{
    ASSERT(element());
    if (!protect(element())->isMutable())
        return;
    const String& key = event.keyIdentifier();
    if (key == "Up"_s)
        stepUpOrDown(StepDirection::Up);
    else if (key == "Down"_s)
        stepUpOrDown(StepDirection::Down);
    else
        return;
    event.setDefaultHandled();
}

bool TextFieldInputType::shouldSubmitImplicitly(Event& event)
{
    auto* textEvent = dynamicDowncast<TextEvent>(event);
    return (event.type() == eventNames().textInputEvent && textEvent && textEvent->data() == "\n"_s)
        || InputType::shouldSubmitImplicitly(event);
}

static ValueOrReference<String> limitLength(const String& string LIFETIME_BOUND, unsigned maxLength)
{
    if (string.length() <= maxLength) [[likely]]
        return string;

    unsigned newLength = maxLength;
    if (newLength > 0 && U16_IS_LEAD(string[newLength - 1]))
        --newLength;
    return string.left(newLength);
}

ValueOrReference<String> TextFieldInputType::sanitizeValue(const String& proposedValue LIFETIME_BOUND) const
{
    if (!containsHTMLLineBreak(proposedValue)) [[likely]]
        return limitLength(proposedValue, HTMLInputElement::maxEffectiveLength);

    // Passing a lambda instead of a function name helps the compiler inline isHTMLLineBreak.
    auto proposedValueWithoutLineBreaks = proposedValue.removeCharacters([](auto character) {
        return isHTMLLineBreak(character);
    });
    return String(limitLength(proposedValueWithoutLineBreaks, HTMLInputElement::maxEffectiveLength));
}

bool TextFieldInputType::shouldRespectListAttribute()
{
    return true;
}

bool TextFieldInputType::appendFormData(DOMFormData& formData) const
{
    InputType::appendFormData(formData);
    ASSERT(element());
    Ref element = *this->element();
    // FIXME: should type=number be TextFieldInputType to begin with?
    if (element->isNumberField())
        return true;
    if (auto& dirname = element->attributeWithoutSynchronization(dirnameAttr); !dirname.isNull())
        formData.append(dirname, element->directionForFormData());
    return true;
}

} // namespace WebCore
