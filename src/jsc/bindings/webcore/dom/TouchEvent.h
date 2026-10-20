/*
 * Copyright 2008, The Android Open Source Project
 * Copyright (C) 2012 Research In Motion Limited. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *  * Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *  * Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS ``AS IS'' AND ANY
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

#include "ExceptionOr.h"
#include "JSValueInWrappedObject.h"
#include "UIEventWithKeyState.h"
#include <JavaScriptCore/ArgList.h>

namespace WebCore {

// The three lists are JavaScript arrays of whatever script put into them, as in jsdom. There is no Touch and no TouchList.
class TouchEvent final : public UIEventWithKeyState {
    WTF_MAKE_TZONE_ALLOCATED(TouchEvent);
public:
    virtual ~TouchEvent();

    static Ref<TouchEvent> createForBindings()
    {
        return adoptRef(*new TouchEvent);
    }

    struct Init : EventModifierInit {
        JSC::JSValue touches;
        JSC::JSValue targetTouches;
        JSC::JSValue changedTouches;
    };

    // Copies each list into a new array. Only the event's wrapper keeps those alive, so until there is one the caller does, in `arrays`.
    static ExceptionOr<Ref<TouchEvent>> create(JSC::JSGlobalObject&, JSC::MarkedArgumentBuffer& arrays, const AtomString& type, Init&&);

    // Empty when nobody gave the list. The getter then puts an empty array there.
    JSValueInWrappedObject& touches() LIFETIME_BOUND { return m_touches; }
    JSValueInWrappedObject& targetTouches() LIFETIME_BOUND { return m_targetTouches; }
    JSValueInWrappedObject& changedTouches() LIFETIME_BOUND { return m_changedTouches; }

private:
    TouchEvent();
    TouchEvent(const AtomString&, const Init&);

    JSValueInWrappedObject m_touches;
    JSValueInWrappedObject m_targetTouches;
    JSValueInWrappedObject m_changedTouches;
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_EVENT(TouchEvent)
