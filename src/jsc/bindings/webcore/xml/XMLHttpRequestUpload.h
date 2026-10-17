/*
 * Copyright (C) 2008 Apple Inc. All rights reserved.
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

#include "EventTargetInterfaces.h"
#include "XMLHttpRequest.h"
#include <wtf/Forward.h>

namespace WebCore {

class WebCoreOpaqueRoot;

class XMLHttpRequestUpload final : public XMLHttpRequestEventTarget {
    WTF_MAKE_TZONE_ALLOCATED(XMLHttpRequestUpload);
public:
    explicit XMLHttpRequestUpload(XMLHttpRequest&);

    void ref() { m_request->ref(); }
    void deref() { m_request->deref(); }

    XMLHttpRequest& request() const { return m_request.get(); }

    void dispatchProgressEvent(const AtomString& type, unsigned long long loaded, unsigned long long total);

    bool hasRelevantEventListener() const;

private:
    // EventTarget.
    void eventListenersDidChange() final;
    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }

    enum EventTargetInterfaceType eventTargetInterface() const final { return EventTargetInterfaceType::XMLHttpRequestUpload; }
    ScriptExecutionContext* scriptExecutionContext() const final;

    WeakRef<XMLHttpRequest, WeakPtrImplWithEventTargetData> m_request;
};

WebCoreOpaqueRoot LEGACY_NODELETE root(XMLHttpRequestUpload*);
    
} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_EVENTTARGET(XMLHttpRequestUpload)
