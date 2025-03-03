/*
 * Copyright (C) 2011 Google Inc.  All rights reserved.
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

#include "root.h"
#include "Event.h"
#include "EventNames.h"

namespace WebCore {

class CloseEvent final : public Event {
    WTF_MAKE_TZONE_ALLOCATED(CloseEvent);

public:
    static Ref<CloseEvent> create(bool wasClean, unsigned short code, const String& reason)
    {
        return adoptRef(*new CloseEvent(wasClean, code, reason));
    }

    struct Init : EventInit {
        bool wasClean { false };
        unsigned short code { 0 };
        String reason;
    };

    static Ref<CloseEvent> create(const AtomString& type, const Init& initializer, IsTrusted isTrusted = IsTrusted::No)
    {
        return adoptRef(*new CloseEvent(type, initializer, isTrusted));
    }

    bool wasClean() const { return m_wasClean; }
    unsigned short code() const { return m_code; }
    String reason() const { return m_reason; }

    // Event function.
    EventInterface eventInterface() const override { return CloseEventInterfaceType; }

private:
    CloseEvent(bool wasClean, int code, const String& reason)
        : Event(eventNames().closeEvent, CanBubble::No, IsCancelable::No)
        , m_wasClean(wasClean)
        , m_code(code)
        , m_reason(reason)
    {
    }

    CloseEvent(const AtomString& type, const Init& initializer, IsTrusted isTrusted)
        : Event(type, initializer, isTrusted)
        , m_wasClean(initializer.wasClean)
        , m_code(initializer.code)
        , m_reason(initializer.reason)
    {
    }

    bool m_wasClean;
    unsigned short m_code;
    String m_reason;
};

} // namespace WebCore
