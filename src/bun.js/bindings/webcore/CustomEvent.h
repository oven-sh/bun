/*
 * Copyright (C) 2010 Nokia Corporation and/or its subsidiary(-ies)
 * Copyright (C) 2011-2018 Apple Inc. All rights reserved.
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

#include "root.h"
#include "Event.h"
#include "JSValueInWrappedObject.h"
// #include "SerializedScriptValue.h"

namespace WebCore {

class CustomEvent final : public Event {
    WTF_MAKE_TZONE_ALLOCATED(CustomEvent);

public:
    virtual ~CustomEvent();

    static Ref<CustomEvent> create(IsTrusted = IsTrusted::No);

    struct Init : EventInit {
        JSC::JSValue detail;
    };

    static Ref<CustomEvent> create(const AtomString& type, const Init&, IsTrusted = IsTrusted::No);

    void initCustomEvent(const AtomString& type, bool canBubble, bool cancelable, JSC::JSValue detail = JSC::JSValue::JSUndefined);

    const JSValueInWrappedObject& detail() const { return m_detail; }
    JSValueInWrappedObject& cachedDetail() { return m_cachedDetail; }

private:
    CustomEvent(IsTrusted);
    CustomEvent(const AtomString& type, const Init& initializer, IsTrusted);

    EventInterface eventInterface() const final;

    JSValueInWrappedObject m_detail;
    JSValueInWrappedObject m_cachedDetail;
};

} // namespace WebCore
