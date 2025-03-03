/*
 * Copyright (C) 2010 Nokia Corporation and/or its subsidiary(-ies)
 * Copyright (C) 2011-2017 Apple Inc. All rights reserved.
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

#include "config.h"
#include "CustomEvent.h"

#include <JavaScriptCore/JSCInlines.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(CustomEvent);

inline CustomEvent::CustomEvent(IsTrusted isTrusted)
    : Event(isTrusted)
{
}

inline CustomEvent::CustomEvent(const AtomString& type, const Init& initializer, IsTrusted isTrusted)
    : Event(type, initializer, isTrusted)
    , m_detail(initializer.detail)
{
}

CustomEvent::~CustomEvent() = default;

Ref<CustomEvent> CustomEvent::create(IsTrusted isTrusted)
{
    return adoptRef(*new CustomEvent(isTrusted));
}

Ref<CustomEvent> CustomEvent::create(const AtomString& type, const Init& initializer, IsTrusted isTrusted)
{
    return adoptRef(*new CustomEvent(type, initializer, isTrusted));
}

void CustomEvent::initCustomEvent(const AtomString& type, bool canBubble, bool cancelable, JSC::JSValue detail)
{
    if (isBeingDispatched())
        return;

    initEvent(type, canBubble, cancelable);

    // FIXME: This code is wrong: we should emit a write-barrier. Otherwise, GC can collect it.
    // https://bugs.webkit.org/show_bug.cgi?id=236353
    m_detail.setWeakly(detail);
    m_cachedDetail.clear();
}

EventInterface CustomEvent::eventInterface() const
{
    return CustomEventInterfaceType;
}

} // namespace WebCore
