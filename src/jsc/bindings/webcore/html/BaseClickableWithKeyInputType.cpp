/*
 * Copyright (C) 2010, 2012 Google Inc. All rights reserved.
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
#include "BaseClickableWithKeyInputType.h"

#include "HTMLInputElement.h"
#include "KeyboardEvent.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(BaseClickableWithKeyInputType);

using namespace HTMLNames;

auto BaseClickableWithKeyInputType::handleKeydownEvent(HTMLInputElement& element, KeyboardEvent& event) -> ShouldCallBaseEventHandler
{
    const String& key = event.keyIdentifier();
    if (key == "U+0020"_s) {
        element.setActive(true);
        // No setDefaultHandled(), because IE dispatches a keypress in this case
        // and the caller will only dispatch a keypress if we don't call setDefaultHandled().
        return ShouldCallBaseEventHandler::No;
    }
    return ShouldCallBaseEventHandler::Yes;
}

void BaseClickableWithKeyInputType::handleKeypressEvent(HTMLInputElement& element, KeyboardEvent& event)
{
    int charCode = event.charCode();
    if (charCode == '\r') {
        element.dispatchSimulatedClick(&event);
        event.setDefaultHandled();
        return;
    }
    if (charCode == ' ') {
        // Prevent scrolling down the page.
        event.setDefaultHandled();
    }
}

void BaseClickableWithKeyInputType::handleKeyupEvent(InputType& inputType, KeyboardEvent& event)
{
    const String& key = event.keyIdentifier();
    if (key != "U+0020"_s)
        return;
    // Simulate mouse click for spacebar for button types.
    inputType.dispatchSimulatedClickIfActive(event);
}

// FIXME: Could share this with BaseCheckableInputType and RangeInputType if we had a common base class.
bool BaseClickableWithKeyInputType::accessKeyAction(HTMLInputElement& element, bool sendMouseEvents)
{
    return element.dispatchSimulatedClick(0, sendMouseEvents ? SendMouseUpDownEvents : SendNoEvents);
}

auto BaseClickableWithKeyInputType::handleKeydownEvent(KeyboardEvent& event) -> ShouldCallBaseEventHandler
{
    ASSERT(element());
    return handleKeydownEvent(*protect(element()), event);
}

void BaseClickableWithKeyInputType::handleKeypressEvent(KeyboardEvent& event)
{
    ASSERT(element());
    handleKeypressEvent(*protect(element()), event);
}

void BaseClickableWithKeyInputType::handleKeyupEvent(KeyboardEvent& event)
{
    handleKeyupEvent(*this, event);
}

bool BaseClickableWithKeyInputType::accessKeyAction(bool sendMouseEvents)
{
    InputType::accessKeyAction(sendMouseEvents);
    ASSERT(element());
    return accessKeyAction(*protect(element()), sendMouseEvents);
}

} // namespace WebCore
