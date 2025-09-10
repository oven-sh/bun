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

#include "config.h"
#include "XMLHttpRequest.h"

// TODO: Enable when these are available
// #include "Blob.h"
// #include "DOMFormData.h"
#include "Event.h"
#include "EventNames.h"
#include "HTTPParsers.h"
#include "ScriptExecutionContext.h"
#include "JSDOMGlobalObject.h"
// #include "URLSearchParams.h"
#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/ArrayBufferView.h>
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/JSONObject.h>
#include <wtf/text/CString.h>

// External Zig functions for XMLHttpRequest implementation
extern "C" {
    void* Bun__XMLHttpRequest_create(JSC::JSGlobalObject* globalThis);
    JSC::EncodedJSValue Bun__XMLHttpRequest_send(
        void* xhr_ptr,
        JSC::JSGlobalObject* globalThis,
        const char* method,
        const char* url,
        JSC::EncodedJSValue headers,
        JSC::EncodedJSValue body,
        uint32_t timeout_ms,
        bool with_credentials
    );
    void Bun__XMLHttpRequest_abort(void* xhr_ptr);
    uint16_t Bun__XMLHttpRequest_getStatus(void* xhr_ptr);
    JSC::EncodedJSValue Bun__XMLHttpRequest_getResponseHeaders(void* xhr_ptr, JSC::JSGlobalObject* globalThis);
    void Bun__XMLHttpRequest_destroy(void* xhr_ptr);
}

namespace WebCore {

// Stub XMLHttpRequestUpload class for now
// Note: EventTargetWithInlineData already includes RefCounted behavior
class XMLHttpRequestUpload : public EventTargetWithInlineData {
    WTF_MAKE_TZONE_ALLOCATED(XMLHttpRequestUpload);
public:
    static Ref<XMLHttpRequestUpload> create(XMLHttpRequest* xhr) 
    {
        return adoptRef(*new XMLHttpRequestUpload(xhr));
    }
    
private:
    explicit XMLHttpRequestUpload(XMLHttpRequest* xhr) 
        : m_xmlHttpRequest(xhr) 
    {
    }
    
    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }
    
    EventTargetInterface eventTargetInterface() const final 
    { 
        return XMLHttpRequestUploadEventTargetInterfaceType; 
    }
    
    ScriptExecutionContext* scriptExecutionContext() const final 
    { 
        return m_xmlHttpRequest ? m_xmlHttpRequest->scriptExecutionContext() : nullptr;
    }
    
    XMLHttpRequest* m_xmlHttpRequest;
};

XMLHttpRequest::XMLHttpRequest(ScriptExecutionContext& context)
    : ContextDestructionObserver(&context)
    , m_upload(XMLHttpRequestUpload::create(this))
    , m_tasklet(nullptr)
{
    // Get the global object from the context to create Zig tasklet
    if (auto* globalObject = context.globalObject()) {
        m_tasklet = Bun__XMLHttpRequest_create(globalObject);
    }
}

XMLHttpRequest::~XMLHttpRequest()
{
    if (m_tasklet) {
        Bun__XMLHttpRequest_destroy(m_tasklet);
        m_tasklet = nullptr;
    }
}

ExceptionOr<Ref<XMLHttpRequest>> XMLHttpRequest::create(ScriptExecutionContext& context)
{
    return adoptRef(*new XMLHttpRequest(context));
}

ExceptionOr<void> XMLHttpRequest::open(const String& method, const String& url)
{
    return open(method, url, true, String(), String());
}

ExceptionOr<void> XMLHttpRequest::open(const String& method, const String& urlString, bool async, const String& user, const String& password)
{
    if (!scriptExecutionContext())
        return Exception { ExceptionCode::InvalidStateError };
        
    // Validate method
    if (method.isEmpty())
        return Exception { ExceptionCode::SyntaxError, "Method cannot be empty"_s };
        
    // Parse URL
    URL url(urlString);
    if (!url.isValid())
        return Exception { ExceptionCode::SyntaxError, "Invalid URL"_s };
        
    // Clear any previous state
    abort();
    clearRequest();
    clearResponse();
    
    m_method = method.convertToASCIIUppercase();
    m_url = url;
    m_async = async;
    
    // TODO: Handle user/password for basic auth
    
    changeState(OPENED);
    
    return { };
}

ExceptionOr<void> XMLHttpRequest::setRequestHeader(const String& name, const String& value)
{
    if (m_readyState != OPENED)
        return Exception { ExceptionCode::InvalidStateError, "XMLHttpRequest must be opened before setting request headers"_s };
        
    // TODO: Validate header name/value
    if (!m_requestHeaders)
        m_requestHeaders = FetchHeaders::create(FetchHeaders::Guard::None);
    m_requestHeaders->append(name, value);
    
    return { };
}

ExceptionOr<void> XMLHttpRequest::send()
{
    return sendInternal();
}

ExceptionOr<void> XMLHttpRequest::send(const String& body)
{
    m_requestBodyString = body;
    return sendInternal();
}

ExceptionOr<void> XMLHttpRequest::send(RefPtr<JSC::ArrayBuffer> body)
{
    if (body)
        m_requestBody = body;
    return sendInternal();
}

ExceptionOr<void> XMLHttpRequest::send(RefPtr<JSC::ArrayBufferView> body)
{
    if (body)
        m_requestBody = body->unsharedBuffer();
    return sendInternal();
}

// TODO: Enable when Blob, DOMFormData, URLSearchParams are available
// ExceptionOr<void> XMLHttpRequest::send(RefPtr<Blob> body)
// {
//     // TODO: Handle Blob body
//     return sendInternal();
// }

// ExceptionOr<void> XMLHttpRequest::send(RefPtr<DOMFormData> body)
// {
//     // TODO: Handle FormData body
//     return sendInternal();
// }

// ExceptionOr<void> XMLHttpRequest::send(RefPtr<URLSearchParams> body)
// {
//     if (body)
//         m_requestBodyString = body->toString();
//     return sendInternal();
// }

ExceptionOr<void> XMLHttpRequest::sendInternal()
{
    if (m_readyState != OPENED)
        return Exception { ExceptionCode::InvalidStateError, "XMLHttpRequest must be opened before sending"_s };
        
    // TODO: Actually send the request using Bun's fetch infrastructure
    // This is where we'll call into Zig to create a FetchTasklet
    
    changeState(HEADERS_RECEIVED);
    changeState(LOADING);
    
    return { };
}

void XMLHttpRequest::abort()
{
    if (m_tasklet) {
        Bun__XMLHttpRequest_abort(m_tasklet);
    }
    
    if (m_readyState == OPENED || m_readyState == HEADERS_RECEIVED || m_readyState == LOADING) {
        changeState(DONE);
        dispatchEvent(Event::create(eventNames().abortEvent, Event::CanBubble::No, Event::IsCancelable::No));
    }
}

ExceptionOr<void> XMLHttpRequest::overrideMimeType(const String& mime)
{
    if (m_readyState >= LOADING)
        return Exception { ExceptionCode::InvalidStateError, "Cannot override MIME type after loading has started"_s };
        
    // TODO: Store overridden MIME type
    return { };
}

ExceptionOr<void> XMLHttpRequest::setTimeout(unsigned timeout)
{
    if (m_readyState != OPENED || m_tasklet)
        return Exception { ExceptionCode::InvalidStateError };
        
    m_timeout = timeout;
    return { };
}

ExceptionOr<void> XMLHttpRequest::setWithCredentials(bool value)
{
    if (m_readyState != UNSENT && m_readyState != OPENED)
        return Exception { ExceptionCode::InvalidStateError };
        
    m_withCredentials = value;
    return { };
}

ExceptionOr<void> XMLHttpRequest::setResponseType(ResponseType type)
{
    if (m_readyState >= LOADING)
        return Exception { ExceptionCode::InvalidStateError };
        
    m_responseType = type;
    return { };
}

String XMLHttpRequest::getResponseHeader(const String& name) const
{
    // TODO: Implement header lookup
    return String();
}

String XMLHttpRequest::getAllResponseHeaders() const
{
    // TODO: Build header string
    return String();
}

String XMLHttpRequest::responseText() const
{
    if (m_responseType != ResponseType::Empty && m_responseType != ResponseType::Text)
        return String();
        
    if (m_responseText.isNull() && !m_responseData.isEmpty()) {
        // TODO: Decode response data based on charset
        m_responseText = String::fromUTF8(m_responseData.span());
    }
    
    return m_responseText;
}

RefPtr<JSC::ArrayBuffer> XMLHttpRequest::responseArrayBuffer() const
{
    if (m_responseType != ResponseType::ArrayBuffer)
        return nullptr;
        
    if (!m_responseArrayBuffer && !m_responseData.isEmpty()) {
        m_responseArrayBuffer = JSC::ArrayBuffer::create(m_responseData.span());
    }
    
    return m_responseArrayBuffer;
}

JSC::JSValue XMLHttpRequest::response(JSC::JSGlobalObject* globalObject) const
{
    switch (m_responseType) {
    case ResponseType::Empty:
    case ResponseType::Text:
        return JSC::jsString(globalObject->vm(), responseText());
    case ResponseType::ArrayBuffer:
        if (auto buffer = responseArrayBuffer())
            return JSC::JSValue(JSC::JSArrayBuffer::create(globalObject->vm(), globalObject->arrayBufferStructure(), buffer.releaseNonNull()));
        return JSC::jsNull();
    case ResponseType::JSON:
        // TODO: Parse JSON
        return JSC::jsNull();
    case ResponseType::Blob:
        // TODO: Create Blob
        return JSC::jsNull();
    case ResponseType::Document:
        // Not implemented
        return JSC::jsNull();
    }
    
    return JSC::jsNull();
}

void XMLHttpRequest::didReceiveResponse(unsigned short status, const String& statusText, const FetchHeaders::Init& headers)
{
    m_status = status;
    m_statusText = statusText;
    // TODO: Store response headers
    
    if (m_readyState != OPENED)
        return;
        
    changeState(HEADERS_RECEIVED);
}

void XMLHttpRequest::didReceiveData(const uint8_t* data, size_t length)
{
    if (m_readyState != HEADERS_RECEIVED && m_readyState != LOADING)
        return;
        
    m_responseData.append(std::span<const uint8_t>(data, length));
    
    if (m_readyState == HEADERS_RECEIVED)
        changeState(LOADING);
        
    // TODO: Fire progress event when available
    // dispatchEvent(Event::create(eventNames().progressEvent, Event::CanBubble::No, Event::IsCancelable::No));
}

void XMLHttpRequest::didFinishLoading()
{
    if (m_readyState != LOADING)
        return;
        
    changeState(DONE);
    // TODO: dispatch load and loadend events when available
    // dispatchEvent(Event::create(eventNames().loadEvent, Event::CanBubble::No, Event::IsCancelable::No));
    // dispatchEvent(Event::create(eventNames().loadendEvent, Event::CanBubble::No, Event::IsCancelable::No));
}

void XMLHttpRequest::didFailWithError(const String& error)
{
    if (m_readyState == UNSENT || m_readyState == DONE)
        return;
        
    changeState(DONE);
    dispatchEvent(Event::create(eventNames().errorEvent, Event::CanBubble::No, Event::IsCancelable::No));
    // TODO: dispatch loadend event when available
    // dispatchEvent(Event::create(eventNames().loadendEvent, Event::CanBubble::No, Event::IsCancelable::No));
}

void XMLHttpRequest::changeState(State newState)
{
    if (m_readyState == newState)
        return;
        
    m_readyState = newState;
    dispatchEvent(Event::create(eventNames().readystatechangeEvent, Event::CanBubble::No, Event::IsCancelable::No));
}

void XMLHttpRequest::clearResponse()
{
    m_status = 0;
    m_statusText = String();
    m_responseURL = String();
    m_responseHeaders = nullptr;
    m_responseData.clear();
    m_responseText = String();
    m_responseArrayBuffer = nullptr;
}

void XMLHttpRequest::clearRequest()
{
    m_method = String();
    m_url = URL();
    m_requestHeaders = nullptr;
    m_requestBody = nullptr;
    m_requestBodyString = String();
}

size_t XMLHttpRequest::memoryCost() const
{
    // Estimate memory cost based on response data
    return m_responseData.size() + (m_responseText.length() * sizeof(UChar)) + sizeof(*this);
}

} // namespace WebCore