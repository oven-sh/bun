/*
 * Copyright (C) 2006 Apple Inc. All rights reserved.
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
 */
 
#pragma once

#include "Event.h"

namespace WebCore {

class BeforeTextInsertedEvent final : public Event {
    WTF_MAKE_TZONE_ALLOCATED(BeforeTextInsertedEvent);
public:
    virtual ~BeforeTextInsertedEvent();

    static Ref<BeforeTextInsertedEvent> create(const String& text)
    {
        return adoptRef(*new BeforeTextInsertedEvent(text));
    }

    const String& text() const LIFETIME_BOUND { return m_text; }
    void setText(const String& s) { m_text = s; }

private:
    explicit BeforeTextInsertedEvent(const String&);

    bool isBeforeTextInsertedEvent() const final { return true; }

    String m_text;
};

} // namespace WebCore

// Technically not a polymorphic Event class, but it requires the same infrastructure as it's not in EventInterfaces.in.
SPECIALIZE_TYPE_TRAITS_EVENT_POLYMORPHIC(BeforeTextInsertedEvent)
