/*
 * Copyright (C) 2010 Julien Chaffraix <jchaffraix@webkit.org>  All right reserved.
 * Copyright (C) 2012 Nokia Corporation and/or its subsidiary(-ies)
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
#include "XMLHttpRequestProgressEventThrottle.h"

#include "EventNames.h"
#include "EventTarget.h"
#include "EventTargetInlines.h"
#include "ProgressEvent.h"

namespace WebCore {

XMLHttpRequestProgressEventThrottle::XMLHttpRequestProgressEventThrottle(XMLHttpRequest& target)
    : m_target(target)
{
}

XMLHttpRequestProgressEventThrottle::~XMLHttpRequestProgressEventThrottle() = default;

void XMLHttpRequestProgressEventThrottle::updateProgress(bool isAsync, bool lengthComputable, unsigned long long loaded, unsigned long long total)
{
    m_lengthComputable = lengthComputable;
    m_loaded = loaded;
    m_total = total;

    if (!isAsync)
        return;

    Ref target = m_target.get();
    if (!target->hasEventListeners(eventNames().progressEvent))
        return;

    dispatchEventWhenPossible(ProgressEvent::create(eventNames().progressEvent, lengthComputable, loaded, total));
}

void XMLHttpRequestProgressEventThrottle::dispatchReadyStateChangeEvent(Event& event)
{
    dispatchEventWhenPossible(event);
}

void XMLHttpRequestProgressEventThrottle::dispatchEventWhenPossible(Event& event)
{
    Ref target = m_target.get();
    target->dispatchEvent(event);
}

void XMLHttpRequestProgressEventThrottle::dispatchProgressEvent(const AtomString& type)
{
    ASSERT(type == eventNames().loadstartEvent || type == eventNames().progressEvent || type == eventNames().loadEvent || type == eventNames().loadendEvent);

    if (type == eventNames().loadstartEvent) {
        m_lengthComputable = false;
        m_loaded = 0;
        m_total = 0;
    }

    if (m_target->hasEventListeners(type))
        dispatchEventWhenPossible(ProgressEvent::create(type, m_lengthComputable, m_loaded, m_total));
}

void XMLHttpRequestProgressEventThrottle::dispatchErrorProgressEvent(const AtomString& type)
{
    ASSERT(type == eventNames().loadendEvent || type == eventNames().abortEvent || type == eventNames().errorEvent || type == eventNames().timeoutEvent);

    if (m_target->hasEventListeners(type))
        dispatchEventWhenPossible(ProgressEvent::create(type, false, 0, 0));
}

} // namespace WebCore
