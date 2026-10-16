/*
 * Copyright (C) 2010 Google Inc. All rights reserved.
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
#include "CheckboxInputType.h"

#include "HTMLInputElement.h"
#include "InputTypeNames.h"
#include "KeyboardEvent.h"
#include "LocalizedStrings.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(CheckboxInputType);

const AtomString& CheckboxInputType::formControlType() const
{
    return InputTypeNames::checkbox();
}

bool CheckboxInputType::valueMissing(StringView) const
{
    ASSERT(element());
    return element()->isRequired() && !element()->checked();
}

String CheckboxInputType::valueMissingText() const
{
    return validationMessageValueMissingForCheckboxText();
}

void CheckboxInputType::handleKeyupEvent(KeyboardEvent& event)
{
    const String& key = event.keyIdentifier();
    if (key != "U+0020"_s)
        return;
    dispatchSimulatedClickIfActive(event);
}

void CheckboxInputType::willDispatchClick(InputElementClickState& state)
{
    ASSERT(element());
    Ref element = *this->element();

    // An event handler can use preventDefault or "return false" to reverse the checking we do here.
    // The InputElementClickState object contains what we need to undo what we did here in didDispatchClick.

    state.checked = element->checked();
    state.indeterminate = element->indeterminate();

    if (state.indeterminate)
        element->setIndeterminate(false);

    element->setChecked(!state.checked, state.trusted ? WasSetByJavaScript::No : WasSetByJavaScript::Yes);
}

void CheckboxInputType::didDispatchClick(Event& event, const InputElementClickState& state)
{
    if (event.defaultPrevented() || event.defaultHandled()) {
        ASSERT(element());
        Ref element = *this->element();
        element->setIndeterminate(state.indeterminate);
        element->setChecked(state.checked);
    } else
        fireInputAndChangeEvents();

    // The work we did in willDispatchClick was default handling.
    event.setDefaultHandled();
}

bool CheckboxInputType::matchesIndeterminatePseudoClass() const
{
    ASSERT(element());
    return element()->indeterminate();
}

} // namespace WebCore
