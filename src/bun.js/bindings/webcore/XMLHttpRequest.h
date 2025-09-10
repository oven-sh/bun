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
#include <wtf/Vector.h>
#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/ArrayBufferView.h>
#include <JavaScriptCore/Strong.h>

namespace JSC {
class ArrayBuffer;
class ArrayBufferView;
}

namespace WebCore {

class Blob;
class DOMFormData;
class Document;
class URLSearchParams;
class XMLHttpRequestUpload;
class JSBlob;

// XMLHttpRequest implementation matching the IDL spec
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

    // Response types matching IDL spec
    enum class ResponseType : uint8_t {
        Empty,        // ""
        ArrayBuffer,  // "arraybuffer"
        Blob,         // "blob"
        Document,     // "document" 
        JSON,         // "json"
        Text          // "text"
    };

    static ExceptionOr<Ref<XMLHttpRequest>> create(ScriptExecutionContext&);
    ~XMLHttpRequest();

    // XMLHttpRequest interface methods - matching IDL spec
    
    // open() overloads
    ExceptionOr<void> open(const String& method, const String& url);
    ExceptionOr<void> open(const String& method, const String& url, bool async, const String& user, const String& password);
    
    ExceptionOr<void> setRequestHeader(const String& name, const String& value);
    
    // send() overloads - matching XMLHttpRequestBodyInit union type
    ExceptionOr<void> send();
    ExceptionOr<void> send(RefPtr<Document>);
    ExceptionOr<void> send(RefPtr<Blob>);
    ExceptionOr<void> send(RefPtr<JSC::ArrayBuffer>);
    ExceptionOr<void> send(RefPtr<JSC::ArrayBufferView>);
    ExceptionOr<void> send(RefPtr<DOMFormData>);
    ExceptionOr<void> send(const String&); // USVString
    ExceptionOr<void> send(RefPtr<URLSearchParams>);
    
    void abort();
    ExceptionOr<void> overrideMimeType(const String& mime);

    // Properties - matching IDL spec
    State readyState() const { return m_readyState; }
    unsigned short status() const { return m_status; }
    String statusText() const { return m_statusText; }
    String responseText() const;
    String responseURL() const { return m_responseURL; }
    
    String getResponseHeader(const String& name) const;
    String getAllResponseHeaders() const;
    
    ResponseType responseType() const { return m_responseType; }
    ExceptionOr<void> setResponseType(ResponseType);
    
    // response attribute with CustomGetter in IDL
    JSC::JSValue response(JSC::JSGlobalObject*) const;
    RefPtr<JSC::ArrayBuffer> responseArrayBuffer() const;
    RefPtr<Blob> responseBlob() const;
    RefPtr<Document> responseDocument() const;
    JSC::JSValue responseJSON(JSC::JSGlobalObject*) const;
    
    // responseXML - Window only in IDL
    RefPtr<Document> responseXML() const;
    
    unsigned timeout() const { return m_timeout; }
    ExceptionOr<void> setTimeout(unsigned timeout);
    
    bool withCredentials() const { return m_withCredentials; }
    ExceptionOr<void> setWithCredentials(bool);
    
    XMLHttpRequestUpload* upload() const { return m_upload.get(); }
    
    // Resolve ambiguity from multiple inheritance
    using RefCounted::ref;
    using RefCounted::deref;
    
    // Event handlers
    // Note: These need proper DOMWrapperWorld handling which will be added in JSXMLHttpRequest bindings

    // EventTarget overrides
    ScriptExecutionContext* scriptExecutionContext() const final { return ContextDestructionObserver::scriptExecutionContext(); }
    void refEventTarget() final { RefCounted::ref(); }
    void derefEventTarget() final { RefCounted::deref(); }
    EventTargetInterface eventTargetInterface() const final { return XMLHttpRequestEventTargetInterfaceType; }

    // ActiveDOMObject behavior
    bool hasPendingActivity() const;
    void stop();
    void suspend();
    void resume();
    const char* activeDOMObjectName() const { return "XMLHttpRequest"; }
    
    // Zig tasklet integration
    void* tasklet() const { return m_tasklet; }
    void setTasklet(void* tasklet) { m_tasklet = tasklet; }
    
    // Network callbacks
    void didReceiveResponse(unsigned short status, const String& statusText, const FetchHeaders::Init& headers);
    void didReceiveData(const uint8_t* data, size_t length);
    void didFinishLoading();
    void didFailWithError(const String& error);
    
    // Memory reporting
    size_t memoryCost() const;

private:
    explicit XMLHttpRequest(ScriptExecutionContext&);
    
    void changeState(State);
    void clearRequest();
    void clearResponse();
    ExceptionOr<void> sendInternal();
    ExceptionOr<void> sendInternal(RefPtr<Document>);
    ExceptionOr<void> sendInternal(RefPtr<Blob>);
    ExceptionOr<void> sendInternal(RefPtr<JSC::ArrayBuffer>);
    ExceptionOr<void> sendInternal(RefPtr<JSC::ArrayBufferView>);
    ExceptionOr<void> sendInternal(RefPtr<DOMFormData>);
    ExceptionOr<void> sendInternal(const String&);
    ExceptionOr<void> sendInternal(RefPtr<URLSearchParams>);
    
    void processResponse();
    void dispatchReadyStateChangeEvent();
    void dispatchProgressEvent(const AtomString& type, bool lengthComputable, unsigned long long loaded, unsigned long long total);
    
    bool isAllowedHTTPMethod(const String& method) const;
    bool isAllowedHTTPHeader(const String& name) const;
    String normalizeHTTPMethod(const String& method) const;
    
    // Member variables
    State m_readyState { UNSENT };
    bool m_async { true };
    bool m_includeCredentials { false };
    bool m_withCredentials { false };
    bool m_sendFlag { false };
    bool m_uploadComplete { false };
    bool m_uploadEventsAllowed { false };
    bool m_responseCacheIsValid { false };
    bool m_errorFlag { false };
    
    String m_method;
    URL m_url;
    String m_user;
    String m_password;
    
    // Request data
    RefPtr<FetchHeaders> m_requestHeaders;
    // RefPtr<Document> m_requestDocument;
    // RefPtr<Blob> m_requestBlob;
    RefPtr<JSC::ArrayBuffer> m_requestArrayBuffer;
    RefPtr<JSC::ArrayBufferView> m_requestArrayBufferView;
    // RefPtr<DOMFormData> m_requestFormData;
    // RefPtr<URLSearchParams> m_requestURLSearchParams;
    String m_requestBodyString;
    
    // Response data
    ResponseType m_responseType { ResponseType::Empty };
    String m_responseURL;
    unsigned short m_status { 0 };
    String m_statusText;
    RefPtr<FetchHeaders> m_responseHeaders;
    String m_mimeTypeOverride;
    
    // Response body storage
    Vector<uint8_t> m_responseData;
    mutable String m_responseText;
    mutable RefPtr<JSC::ArrayBuffer> m_responseArrayBuffer;
    // mutable RefPtr<Blob> m_responseBlob;
    // mutable RefPtr<Document> m_responseDocument;
    mutable JSC::Strong<JSC::Unknown> m_responseJSON;
    
    // Configuration
    unsigned m_timeout { 0 };
    std::optional<std::chrono::steady_clock::time_point> m_sendTime;
    
    // Upload object
    RefPtr<XMLHttpRequestUpload> m_upload;
    
    // Progress tracking
    unsigned long long m_receivedLength { 0 };
    unsigned long long m_expectedLength { 0 };
    
    // Zig tasklet handle for network operations
    void* m_tasklet { nullptr };
    
    // Locks for thread safety
    mutable Lock m_responseLock;
};

} // namespace WebCore