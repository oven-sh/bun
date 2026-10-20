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
#include "BaseCheckableInputType.h"

#include "CommonAtomStrings.h"
#include "DOMFormData.h"
#include "HTMLInputElement.h"
#include "HTMLNames.h"
#include "KeyboardEvent.h"
#include <wtf/NeverDestroyed.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(BaseCheckableInputType);

using namespace HTMLNames;

bool BaseCheckableInputType::appendFormData(DOMFormData& formData) const
{
    ASSERT(element());
    Ref element = *this->element();
    if (!element->checked())
        return false;
    formData.append(element->name(), element->value());
    return true;
}

auto BaseCheckableInputType::handleKeydownEvent(KeyboardEvent& event) -> ShouldCallBaseEventHandler
{
    const String& key = event.keyIdentifier();
    if (key == "U+0020"_s) {
        ASSERT(element());
        protect(element())->setActive(true);
        // No setDefaultHandled(), because IE dispatches a keypress in this case
        // and the caller will only dispatch a keypress if we don't call setDefaultHandled().
        return ShouldCallBaseEventHandler::No;
    }
    return ShouldCallBaseEventHandler::Yes;
}

void BaseCheckableInputType::handleKeypressEvent(KeyboardEvent& event)
{
    if (event.charCode() == ' ') {
        // Prevent scrolling down the page.
        event.setDefaultHandled();
    }
}

// FIXME: Could share this with BaseClickableWithKeyInputType and RangeInputType if we had a common base class.
bool BaseCheckableInputType::accessKeyAction(bool sendMouseEvents)
{
    ASSERT(element());
    return InputType::accessKeyAction(sendMouseEvents) || protect(element())->dispatchSimulatedClick(0, sendMouseEvents ? SendMouseUpDownEvents : SendNoEvents);
}

ValueOrReference<String> BaseCheckableInputType::fallbackValue() const
{
    return onAtom().string();
}

bool BaseCheckableInputType::storesValueSeparateFromAttribute()
{
    return false;
}

void BaseCheckableInputType::setValue(const String& sanitizedValue, bool, TextFieldEventBehavior, TextControlSetValueSelection)
{
    ASSERT(element());
    protect(element())->setAttributeWithoutSynchronization(valueAttr, AtomString { sanitizedValue });
}

void BaseCheckableInputType::fireInputAndChangeEvents()
{
    Ref element = *this->element();
    if (!element->isConnected())
        return;

    if (!shouldSendChangeEventAfterCheckedChanged())
        return;

    Ref protectedThis { *this };
    element->setTextAsOfLastFormControlChangeEvent(String());
    element->dispatchInputEvent();
    if (RefPtr element = this->element())
        element->dispatchFormControlChangeEvent();
}

} // namespace WebCore
