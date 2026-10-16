/*
 * Copyright (C) 2008-2026 Apple Inc. All rights reserved.
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
#include "XMLHttpRequestUpload.h"

#include "ContextDestructionObserverInlines.h"
#include "EventNames.h"
#include "EventTargetInlines.h"
#include "WebCoreOpaqueRoot.h"
#include "ProgressEvent.h"
#include <wtf/Assertions.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/AtomString.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(XMLHttpRequestUpload);

XMLHttpRequestUpload::XMLHttpRequestUpload(XMLHttpRequest& request)
    : m_request(request)
{
}

void XMLHttpRequestUpload::eventListenersDidChange()
{
    protect(m_request)->updateHasRelevantEventListener();
}

bool XMLHttpRequestUpload::hasRelevantEventListener() const
{
    return hasEventListeners(eventNames().abortEvent)
        || hasEventListeners(eventNames().errorEvent)
        || hasEventListeners(eventNames().loadEvent)
        || hasEventListeners(eventNames().loadendEvent)
        || hasEventListeners(eventNames().loadstartEvent)
        || hasEventListeners(eventNames().progressEvent)
        || hasEventListeners(eventNames().timeoutEvent);
}

void XMLHttpRequestUpload::dispatchProgressEvent(const AtomString& type, unsigned long long loaded, unsigned long long total)
{
    ASSERT(type == eventNames().loadstartEvent || type == eventNames().progressEvent || type == eventNames().loadEvent || type == eventNames().loadendEvent || type == eventNames().abortEvent || type == eventNames().errorEvent || type == eventNames().timeoutEvent);

    // https://xhr.spec.whatwg.org/#firing-events-using-the-progressevent-interface
    dispatchEvent(ProgressEvent::create(type, !!total, loaded, total));
}

ScriptExecutionContext* XMLHttpRequestUpload::scriptExecutionContext() const
{
    return protect(m_request)->scriptExecutionContext();
}

WebCoreOpaqueRoot root(XMLHttpRequestUpload* upload)
{
    return WebCoreOpaqueRoot { upload };
}

} // namespace WebCore
