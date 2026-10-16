/*
 * Copyright (C) 2007 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. 
 *
 */

#include "config.h"
#include "TextEvent.h"

#include "EventNames.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(TextEvent);

Ref<TextEvent> TextEvent::createForBindings()
{
    return adoptRef(*new TextEvent);
}

Ref<TextEvent> TextEvent::create(RefPtr<Window>&& view, const String& data, TextEventInputType inputType)
{
    return adoptRef(*new TextEvent(WTF::move(view), data, inputType));
}

TextEvent::TextEvent()
    : UIEvent(EventInterfaceType::TextEvent)
{
}

TextEvent::TextEvent(RefPtr<Window>&& view, const String& data, TextEventInputType inputType)
    : UIEvent(EventInterfaceType::TextEvent, eventNames().textInputEvent, CanBubble::Yes, IsCancelable::Yes, IsComposed::Yes, WTF::move(view), 0)
    , m_inputType(inputType)
    , m_data(data)
{
}

TextEvent::~TextEvent() = default;

void TextEvent::initTextEvent(const AtomString& type, bool canBubble, bool cancelable, RefPtr<Window>&& view, const String& data)
{
    if (isBeingDispatched())
        return;

    initUIEvent(type, canBubble, cancelable, WTF::move(view), 0);

    m_inputType = TextEventInputKeyboard;

    m_data = data;
}

} // namespace WebCore
