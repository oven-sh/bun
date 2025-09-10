/*
 * Copyright (C) 2008 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Apple Inc. ("Apple") nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "EventTarget.h"
#include <wtf/Forward.h>
#include <wtf/RefCounted.h>
#include <wtf/RefPtr.h>

namespace WebCore {

class XMLHttpRequest;

// XMLHttpRequestUpload allows tracking of upload progress
// It's a separate EventTarget as per the spec
class XMLHttpRequestUpload final : public RefCounted<XMLHttpRequestUpload>, public EventTargetWithInlineData {
    WTF_MAKE_TZONE_ALLOCATED(XMLHttpRequestUpload);
public:
    static Ref<XMLHttpRequestUpload> create(XMLHttpRequest* xhr) 
    {
        return adoptRef(*new XMLHttpRequestUpload(xhr));
    }
    
    ~XMLHttpRequestUpload() = default;
    
    // Resolve ambiguity from multiple inheritance
    using RefCounted::ref;
    using RefCounted::deref;
    
    // EventTarget implementation
    void refEventTarget() final { RefCounted::ref(); }
    void derefEventTarget() final { RefCounted::deref(); }
    
    EventTargetInterface eventTargetInterface() const final 
    { 
        return XMLHttpRequestUploadEventTargetInterfaceType; 
    }
    
    ScriptExecutionContext* scriptExecutionContext() const final;
    
    // Progress event dispatching
    void dispatchProgressEvent(const AtomString& type, bool lengthComputable, unsigned long long loaded, unsigned long long total);
    void dispatchEventAndLoadEnd(const AtomString& type);
    
    // Connection to parent XMLHttpRequest
    XMLHttpRequest* xmlHttpRequest() const { return m_xmlHttpRequest; }
    
    bool hasEventListeners() const;
    
private:
    explicit XMLHttpRequestUpload(XMLHttpRequest* xhr) 
        : m_xmlHttpRequest(xhr) 
    {
    }
    
    XMLHttpRequest* m_xmlHttpRequest;
};

} // namespace WebCore