/*
 * Copyright (C) 2010 Julien Chaffraix <jchaffraix@webkit.org>
 * All right reserved.
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

#pragma once

#include "XMLHttpRequest.h"
#include <wtf/Forward.h>
#include <wtf/Vector.h>
#include <wtf/WeakPtr.h>

namespace WebCore {
class XMLHttpRequestProgressEventThrottle;
}

namespace WebCore {

class Event;
class XMLHttpRequest;

class XMLHttpRequestProgressEventThrottle {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(XMLHttpRequestProgressEventThrottle);
public:
    explicit XMLHttpRequestProgressEventThrottle(XMLHttpRequest&);
    virtual ~XMLHttpRequestProgressEventThrottle();

    void updateProgress(bool isAsync, bool lengthComputable, unsigned long long loaded, unsigned long long total);
    void dispatchReadyStateChangeEvent(Event&);
    void dispatchProgressEvent(const AtomString&);
    void dispatchErrorProgressEvent(const AtomString&);

private:
    void dispatchEventWhenPossible(Event&);

    // Weak reference to our XMLHttpRequest object as it is the one holding us.
    WeakRef<XMLHttpRequest, WeakPtrImplWithEventTargetData> m_target;

    unsigned long long m_loaded { 0 };
    unsigned long long m_total { 0 };

    bool m_lengthComputable { false };
};

} // namespace WebCore
