/*
 *  Copyright (C) 2003, 2006, 2008 Apple Inc. All rights reserved.
 *  Copyright (C) 2005, 2006 Alexey Proskuryakov <ap@nypop.com>
 *  Copyright (C) 2011 Google Inc. All rights reserved.
 *  Copyright (C) 2012 Intel Corporation
 *
 *  This library is free software; you can redistribute it and/or
 *  modify it under the terms of the GNU Lesser General Public
 *  License as published by the Free Software Foundation; either
 *  version 2 of the License, or (at your option) any later version.
 *
 *  This library is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 *  Lesser General Public License for more details.
 *
 *  You should have received a copy of the GNU Lesser General Public
 *  License along with this library; if not, write to the Free Software
 *  Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA
 */

#pragma once

#include "ContextDestructionObserver.h"
#include "EventTarget.h"
#include "EventTargetInterfaces.h"
#include "ExceptionOr.h"
#include "FetchHeaders.h"
#include <wtf/URL.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/HashSet.h>
#include <wtf/Lock.h>

namespace JSC {
class ArrayBuffer;
class ArrayBufferView;
}

namespace WebCore {

class Blob;
class DOMFormData;
class URLSearchParams;
class XMLHttpRequestUpload;

class XMLHttpRequest final : public RefCounted<XMLHttpRequest>, public EventTargetWithInlineData, public ContextDestructionObserver {
    WTF_MAKE_TZONE_ALLOCATED(XMLHttpRequest);

public:
    // State as per XMLHttpRequest spec
    enum State : uint8_t {
        UNSENT = 0,
        OPENED = 1,
        HEADERS_RECEIVED = 2,
        LOADING = 3,
        DONE = 4
    };

    // Response types
    enum class ResponseType {
        Empty,        // ""
        ArrayBuffer,  // "arraybuffer"
        Blob,         // "blob"
        Document,     // "document" (will not implement initially)
        JSON,         // "json"
        Text          // "text"
    };

    static ExceptionOr<Ref<XMLHttpRequest>> create(ScriptExecutionContext&);
    ~XMLHttpRequest();

    // XMLHttpRequest interface methods
    ExceptionOr<void> open(const String& method, const String& url);
    ExceptionOr<void> open(const String& method, const String& url, bool async, const String& user, const String& password);
    ExceptionOr<void> setRequestHeader(const String& name, const String& value);
    ExceptionOr<void> send(RefPtr<JSC::ArrayBuffer>);
    ExceptionOr<void> send(RefPtr<JSC::ArrayBufferView>);
    // TODO: Enable when Blob, DOMFormData, URLSearchParams are available
    // ExceptionOr<void> send(RefPtr<Blob>);
    // ExceptionOr<void> send(RefPtr<DOMFormData>);
    // ExceptionOr<void> send(RefPtr<URLSearchParams>);
    ExceptionOr<void> send(const String&);
    ExceptionOr<void> send();
    void abort();
    ExceptionOr<void> overrideMimeType(const String& mime);

    // Properties
    State readyState() const { return m_readyState; }
    unsigned short status() const { return m_status; }
    String statusText() const { return m_statusText; }
    String getResponseHeader(const String& name) const;
    String getAllResponseHeaders() const;
    
    ResponseType responseType() const { return m_responseType; }
    ExceptionOr<void> setResponseType(ResponseType);
    
    JSC::JSValue response(JSC::JSGlobalObject*) const;
    String responseText() const;
    RefPtr<JSC::ArrayBuffer> responseArrayBuffer() const;
    
    String responseURL() const { return m_responseURL; }
    
    unsigned timeout() const { return m_timeout; }
    ExceptionOr<void> setTimeout(unsigned);
    
    bool withCredentials() const { return m_withCredentials; }
    ExceptionOr<void> setWithCredentials(bool);
    
    XMLHttpRequestUpload* upload() { return m_upload.get(); }

    // EventTarget implementation
    using RefCounted::deref;
    using RefCounted::ref;
    
    ScriptExecutionContext* scriptExecutionContext() const final { return ContextDestructionObserver::scriptExecutionContext(); }
    EventTargetInterface eventTargetInterface() const final { return XMLHttpRequestEventTargetInterfaceType; }

    // Event handlers
    void didReceiveResponse(unsigned short status, const String& statusText, const FetchHeaders::Init& headers);
    void didReceiveData(const uint8_t* data, size_t length);
    void didFinishLoading();
    void didFailWithError(const String& error);
    
    bool hasPendingActivity() const { return m_readyState != DONE && m_readyState != UNSENT; }
    size_t memoryCost() const;

private:
    explicit XMLHttpRequest(ScriptExecutionContext&);
    
    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }
    
    ExceptionOr<void> sendInternal();
    void changeState(State);
    void clearResponse();
    void clearRequest();
    
    // State
    State m_readyState { UNSENT };
    unsigned short m_status { 0 };
    String m_statusText;
    
    // Request
    String m_method;
    URL m_url;
    RefPtr<FetchHeaders> m_requestHeaders;
    RefPtr<JSC::ArrayBuffer> m_requestBody;
    String m_requestBodyString;
    
    // Response  
    ResponseType m_responseType { ResponseType::Empty };
    String m_responseURL;
    RefPtr<FetchHeaders> m_responseHeaders;
    Vector<uint8_t> m_responseData;
    mutable String m_responseText;
    mutable RefPtr<JSC::ArrayBuffer> m_responseArrayBuffer;
    
    // Configuration
    unsigned m_timeout { 0 };
    bool m_withCredentials { false };
    bool m_async { true };
    
    // Upload object
    RefPtr<XMLHttpRequestUpload> m_upload;
    
    // Fetch task handle
    void* m_fetchTask { nullptr };
};

} // namespace WebCore