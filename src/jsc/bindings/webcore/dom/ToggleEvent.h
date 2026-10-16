/*
 * Copyright (C) 2023 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "Event.h"
#include "EventInit.h"

namespace WebCore {

class Element;

class ToggleEvent final : public Event {
    WTF_MAKE_TZONE_ALLOCATED(ToggleEvent);
public:
    struct Init : EventInit {
        String oldState;
        String newState;
        RefPtr<Element> source;
    };

    static Ref<ToggleEvent> create(const AtomString& type, const Init&, Event::IsCancelable);
    static Ref<ToggleEvent> create(const AtomString& type, const Init&);
    static Ref<ToggleEvent> createForBindings();

    String oldState() const { return m_oldState; }
    String newState() const { return m_newState; }
    RefPtr<Element> source() const;

private:
    ToggleEvent();
    ToggleEvent(const AtomString&, const Init&, Event::IsCancelable);
    ToggleEvent(const AtomString&, const Init&);

    String m_oldState;
    String m_newState;
    const RefPtr<Element> m_source;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_EVENT(ToggleEvent)
