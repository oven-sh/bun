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

#include "XMLHttpRequestUpload.h"
// TODO: Enable these when available in Bun
// #include "Blob.h"
// #include "DOMFormData.h"
// #include "Document.h"
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
#include <wtf/text/StringBuilder.h>
#include <chrono>

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

// XMLHttpRequestUpload implementation
ScriptExecutionContext* XMLHttpRequestUpload::scriptExecutionContext() const
{
    return m_xmlHttpRequest ? m_xmlHttpRequest->scriptExecutionContext() : nullptr;
}

void XMLHttpRequestUpload::dispatchProgressEvent(const AtomString& type, bool lengthComputable, unsigned long long loaded, unsigned long long total)
{
    // TODO: Create and dispatch ProgressEvent
    dispatchEvent(Event::create(type, Event::CanBubble::No, Event::IsCancelable::No));
}

void XMLHttpRequestUpload::dispatchEventAndLoadEnd(const AtomString& type)
{
    dispatchProgressEvent(type, false, 0, 0);
    // TODO: Add loadend event when available
}

bool XMLHttpRequestUpload::hasEventListeners() const
{
    // Simplified - just check if we have any listeners
    return EventTargetWithInlineData::hasEventListeners();
}

// XMLHttpRequest implementation
XMLHttpRequest::XMLHttpRequest(ScriptExecutionContext& context)
    : ContextDestructionObserver(&context)
    , m_upload(XMLHttpRequestUpload::create(this))
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

void XMLHttpRequest::changeState(State newState)
{
    if (m_readyState == newState)
        return;
        
    m_readyState = newState;
    
    if (m_readyState != OPENED)
        m_sendFlag = false;
        
    dispatchReadyStateChangeEvent();
}

void XMLHttpRequest::dispatchReadyStateChangeEvent()
{
    if (!scriptExecutionContext())
        return;
        
    dispatchEvent(Event::create(eventNames().readystatechangeEvent, Event::CanBubble::No, Event::IsCancelable::No));
}

void XMLHttpRequest::dispatchProgressEvent(const AtomString& type, bool lengthComputable, unsigned long long loaded, unsigned long long total)
{
    // TODO: Create and dispatch ProgressEvent
    dispatchEvent(Event::create(type, Event::CanBubble::No, Event::IsCancelable::No));
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
        
    String normalizedMethod = normalizeHTTPMethod(method);
    if (!isAllowedHTTPMethod(normalizedMethod))
        return Exception { ExceptionCode::SecurityError, makeString("'"_s, method, "' is not a valid HTTP method."_s) };
        
    // Parse URL
    URL url(URL(), urlString);
    if (!url.isValid())
        return Exception { ExceptionCode::SyntaxError, "Invalid URL"_s };
        
    // Validate URL scheme
    if (!url.protocolIsInHTTPFamily())
        return Exception { ExceptionCode::SyntaxError, "URL scheme must be either 'http' or 'https'"_s };
        
    // Synchronous requests are not supported
    if (!async)
        return Exception { ExceptionCode::InvalidAccessError, "Synchronous XMLHttpRequest is not supported"_s };
        
    // Clear any previous state
    abort();
    clearRequest();
    clearResponse();
    m_errorFlag = false;
    m_uploadComplete = false;
    
    m_method = normalizedMethod;
    m_url = url;
    m_async = async;
    m_user = user;
    m_password = password;
    
    // Create fresh headers
    m_requestHeaders = FetchHeaders::create(FetchHeaders::Guard::None);
    
    changeState(OPENED);
    
    return { };
}

ExceptionOr<void> XMLHttpRequest::setRequestHeader(const String& name, const String& value)
{
    if (m_readyState != OPENED)
        return Exception { ExceptionCode::InvalidStateError, "XMLHttpRequest must be opened before setting request headers"_s };
        
    if (m_sendFlag)
        return Exception { ExceptionCode::InvalidStateError, "Cannot set request headers after send()"_s };
        
    // Validate header name/value
    if (!isValidHTTPToken(name))
        return Exception { ExceptionCode::SyntaxError, makeString("'"_s, name, "' is not a valid HTTP header field name."_s) };
        
    if (!isAllowedHTTPHeader(name))
        return { }; // Silently ignore forbidden headers
        
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

ExceptionOr<void> XMLHttpRequest::send(RefPtr<Document>) { return { }; }
ExceptionOr<void> XMLHttpRequest::send(RefPtr<Blob>) { return { }; }
ExceptionOr<void> XMLHttpRequest::send(RefPtr<DOMFormData>) { return { }; }
ExceptionOr<void> XMLHttpRequest::send(RefPtr<URLSearchParams>) { return { }; }

// TODO: Enable when Document is available
// ExceptionOr<void> XMLHttpRequest::send(RefPtr<Document> body)
// {
//     m_requestDocument = body;
//     return sendInternal();
// }

// TODO: Enable when Blob is available
// ExceptionOr<void> XMLHttpRequest::send(RefPtr<Blob> body)
// {
//     m_requestBlob = body;
//     return sendInternal();
// }

ExceptionOr<void> XMLHttpRequest::send(RefPtr<JSC::ArrayBuffer> body)
{
    m_requestArrayBuffer = body;
    return sendInternal();
}

ExceptionOr<void> XMLHttpRequest::send(RefPtr<JSC::ArrayBufferView> body)
{
    m_requestArrayBufferView = body;
    return sendInternal();
}

// TODO: Enable when DOMFormData is available
// ExceptionOr<void> XMLHttpRequest::send(RefPtr<DOMFormData> body)
// {
//     m_requestFormData = body;
//     return sendInternal();
// }

// TODO: Enable when URLSearchParams is available
// ExceptionOr<void> XMLHttpRequest::send(RefPtr<URLSearchParams> body)
// {
//     m_requestURLSearchParams = body;
//     return sendInternal();
// }

ExceptionOr<void> XMLHttpRequest::sendInternal()
{
    if (m_readyState != OPENED)
        return Exception { ExceptionCode::InvalidStateError, "XMLHttpRequest must be opened before send()"_s };
        
    if (m_sendFlag)
        return Exception { ExceptionCode::InvalidStateError, "XMLHttpRequest send already in progress"_s };
        
    if (!scriptExecutionContext())
        return Exception { ExceptionCode::InvalidStateError };
        
    m_errorFlag = false;
    m_sendFlag = true;
    
    if (m_timeout > 0)
        m_sendTime = std::chrono::steady_clock::now();
        
    // TODO: Dispatch upload loadstart event when event names are available
    // TODO: Dispatch loadstart event when event names are available
    
    // TODO: Actually send the request via Zig
    // For now, we'll just simulate completion
    if (m_tasklet && scriptExecutionContext()) {
        auto* globalObject = scriptExecutionContext()->globalObject();
        if (globalObject) {
            CString methodStr = m_method.utf8();
            CString urlStr = m_url.string().utf8();
            
            // Convert headers to JSValue
            JSC::JSValue headersValue = JSC::jsUndefined();
            if (m_requestHeaders) {
                // TODO: Convert headers to JSValue
            }
            
            // Convert body to JSValue
            JSC::JSValue bodyValue = JSC::jsUndefined();
            if (!m_requestBodyString.isEmpty()) {
                // TODO: Convert body string to JSValue
            }
            
            // Call Zig send function
            Bun__XMLHttpRequest_send(
                m_tasklet,
                globalObject,
                methodStr.data(),
                urlStr.data(),
                JSC::JSValue::encode(headersValue),
                JSC::JSValue::encode(bodyValue),
                m_timeout,
                m_withCredentials
            );
        }
    }
    
    return { };
}

void XMLHttpRequest::abort()
{
    if (m_tasklet) {
        Bun__XMLHttpRequest_abort(m_tasklet);
    }
    
    // bool hadPendingActivity = hasPendingActivity();
    
    m_errorFlag = true;
    clearRequest();
    
    if (m_readyState == OPENED && m_sendFlag || m_readyState == HEADERS_RECEIVED || m_readyState == LOADING) {
        m_sendFlag = false;
        changeState(DONE);
        
        if (m_upload) {
            m_upload->dispatchEventAndLoadEnd(eventNames().abortEvent);
            m_uploadComplete = true;
        }
        
        dispatchProgressEvent(eventNames().abortEvent, false, 0, 0);
        // TODO: Dispatch loadend event when available
    }
    
    m_readyState = UNSENT;
}

ExceptionOr<void> XMLHttpRequest::overrideMimeType(const String& mime)
{
    if (m_readyState >= LOADING)
        return Exception { ExceptionCode::InvalidStateError, "Cannot override MIME type after loading has started"_s };
        
    m_mimeTypeOverride = mime;
    return { };
}

ExceptionOr<void> XMLHttpRequest::setTimeout(unsigned timeout)
{
    if (m_readyState != OPENED || m_sendFlag)
        return Exception { ExceptionCode::InvalidStateError };
        
    m_timeout = timeout;
    return { };
}

ExceptionOr<void> XMLHttpRequest::setWithCredentials(bool value)
{
    if (m_readyState != UNSENT && m_readyState != OPENED)
        return Exception { ExceptionCode::InvalidStateError };
        
    if (m_sendFlag)
        return Exception { ExceptionCode::InvalidStateError };
        
    m_withCredentials = value;
    return { };
}

ExceptionOr<void> XMLHttpRequest::setResponseType(ResponseType type)
{
    if (m_readyState >= LOADING)
        return Exception { ExceptionCode::InvalidStateError };
        
    // Document response type is only valid for async requests
    if (type == ResponseType::Document && !m_async)
        return Exception { ExceptionCode::InvalidStateError };
        
    m_responseType = type;
    return { };
}

String XMLHttpRequest::responseText() const
{
    if (m_responseType != ResponseType::Empty && m_responseType != ResponseType::Text)
        return String();
        
    if (m_readyState != LOADING && m_readyState != DONE)
        return String();
        
    if (m_errorFlag)
        return String();
        
    Locker locker { m_responseLock };
    
    if (!m_responseText.isNull())
        return m_responseText;
        
    if (m_responseData.isEmpty())
        return emptyString();
        
    // Decode response data as UTF-8
    auto dataSpan = m_responseData.span();
    m_responseText = String(dataSpan);
    return m_responseText;
}

RefPtr<JSC::ArrayBuffer> XMLHttpRequest::responseArrayBuffer() const
{
    if (m_responseType != ResponseType::ArrayBuffer)
        return nullptr;
        
    if (m_readyState != DONE)
        return nullptr;
        
    if (m_errorFlag)
        return nullptr;
        
    Locker locker { m_responseLock };
    
    if (m_responseArrayBuffer)
        return m_responseArrayBuffer;
        
    if (m_responseData.isEmpty())
        return nullptr;
        
    auto dataSpan = m_responseData.span();
    if (dataSpan.size() > 0) {
        auto buffer = JSC::ArrayBuffer::createUninitialized(dataSpan.size(), 1);
        memcpy(buffer->data(), dataSpan.data(), dataSpan.size());
        m_responseArrayBuffer = WTFMove(buffer);
    }
    return m_responseArrayBuffer;
}

RefPtr<Blob> XMLHttpRequest::responseBlob() const { return nullptr; }
// TODO: Enable when Blob is available
// RefPtr<Blob> XMLHttpRequest::responseBlob() const
// {
//     if (m_responseType != ResponseType::Blob)
//         return nullptr;
//         
//     if (m_readyState != DONE)
//         return nullptr;
//         
//     if (m_errorFlag)
//         return nullptr;
//         
//     Locker locker { m_responseLock };
//     
//     if (m_responseBlob)
//         return m_responseBlob;
//         
//     if (m_responseData.isEmpty())
//         return nullptr;
//         
//     // TODO: Create Blob from response data
//     // m_responseBlob = Blob::create(m_responseData, ...);
//     return m_responseBlob;
// }

RefPtr<Document> XMLHttpRequest::responseDocument() const { return nullptr; }
// TODO: Enable when Document is available
// RefPtr<Document> XMLHttpRequest::responseDocument() const
// {
//     if (m_responseType != ResponseType::Document)
//         return nullptr;
//         
//     if (m_readyState != DONE)
//         return nullptr;
//         
//     if (m_errorFlag)
//         return nullptr;
//         
//     // Document response type is not implemented
//     return nullptr;
// }

RefPtr<Document> XMLHttpRequest::responseXML() const { return nullptr; }
// TODO: Enable when Document is available
// RefPtr<Document> XMLHttpRequest::responseXML() const
// {
//     // responseXML is essentially responseDocument for XML content
//     if (m_responseType != ResponseType::Empty && m_responseType != ResponseType::Document)
//         return nullptr;
//         
//     return responseDocument();
// }

JSC::JSValue XMLHttpRequest::responseJSON(JSC::JSGlobalObject* globalObject) const
{
    if (m_responseType != ResponseType::JSON)
        return JSC::jsNull();
        
    if (m_readyState != DONE)
        return JSC::jsNull();
        
    if (m_errorFlag)
        return JSC::jsNull();
        
    if (m_responseJSON)
        return m_responseJSON.get();
        
    String text = responseText();
    if (text.isEmpty())
        return JSC::jsNull();
        
    // Parse JSON
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    JSC::JSValue jsonValue = JSC::JSONParse(globalObject, text);
    if (scope.exception()) {
        scope.clearException();
        return JSC::jsNull();
    }
    
    m_responseJSON.set(vm, jsonValue);
    return jsonValue;
}

JSC::JSValue XMLHttpRequest::response(JSC::JSGlobalObject* globalObject) const
{
    switch (m_responseType) {
    case ResponseType::Empty:
    case ResponseType::Text:
        return JSC::jsString(globalObject->vm(), responseText());
        
    case ResponseType::ArrayBuffer:
        // TODO: Convert ArrayBuffer to JSValue
        // if (auto buffer = responseArrayBuffer())
        //     return JSC::toJS(globalObject, globalObject, buffer.get());
        return JSC::jsNull();
        
    case ResponseType::Blob:
        // TODO: Convert Blob to JSValue
        return JSC::jsNull();
        
    case ResponseType::Document:
        // TODO: Convert Document to JSValue
        return JSC::jsNull();
        
    case ResponseType::JSON:
        return responseJSON(globalObject);
    }
    
    return JSC::jsNull();
}

String XMLHttpRequest::getResponseHeader(const String& name) const
{
    if (m_readyState < HEADERS_RECEIVED || m_errorFlag)
        return String();
        
    if (!m_responseHeaders)
        return String();
        
    auto result = m_responseHeaders->get(name);
    return result.hasException() ? String() : result.releaseReturnValue();
}

String XMLHttpRequest::getAllResponseHeaders() const
{
    if (m_readyState < HEADERS_RECEIVED || m_errorFlag)
        return String();
        
    if (!m_responseHeaders)
        return String();
        
    // TODO: Iterate headers when API is available
    return String();
}

void XMLHttpRequest::didReceiveResponse(unsigned short status, const String& statusText, const FetchHeaders::Init& headers)
{
    m_status = status;
    m_statusText = statusText;
    
    m_responseHeaders = FetchHeaders::create(FetchHeaders::Guard::None);
    // TODO: Add headers when API is available
    
    changeState(HEADERS_RECEIVED);
}

void XMLHttpRequest::didReceiveData(const uint8_t* data, size_t length)
{
    if (m_errorFlag)
        return;
        
    {
        Locker locker { m_responseLock };
        m_responseData.appendRange(data, data + length);
        m_receivedLength += length;
    }
    
    if (m_readyState != LOADING)
        changeState(LOADING);
        
    // TODO: Dispatch progress event when available
}

void XMLHttpRequest::didFinishLoading()
{
    if (m_errorFlag)
        return;
        
    m_sendFlag = false;
    changeState(DONE);
    
    // Dispatch final events
    if (m_upload && !m_uploadComplete) {
        // TODO: Dispatch load and loadend events when available
        m_uploadComplete = true;
    }
    
    // TODO: Dispatch load and loadend events when available
}

void XMLHttpRequest::didFailWithError(const String& error)
{
    m_errorFlag = true;
    m_sendFlag = false;
    
    clearResponse();
    changeState(DONE);
    
    // Dispatch error events
    if (m_upload && !m_uploadComplete) {
        m_upload->dispatchEventAndLoadEnd(eventNames().errorEvent);
        m_uploadComplete = true;
    }
    
    dispatchProgressEvent(eventNames().errorEvent, false, 0, 0);
    // TODO: Dispatch loadend event when available
}

ExceptionOr<void> XMLHttpRequest::sendInternal(RefPtr<Document>) { return sendInternal(); }
ExceptionOr<void> XMLHttpRequest::sendInternal(RefPtr<Blob>) { return sendInternal(); }
ExceptionOr<void> XMLHttpRequest::sendInternal(RefPtr<JSC::ArrayBuffer>) { return sendInternal(); }
ExceptionOr<void> XMLHttpRequest::sendInternal(RefPtr<JSC::ArrayBufferView>) { return sendInternal(); }
ExceptionOr<void> XMLHttpRequest::sendInternal(RefPtr<DOMFormData>) { return sendInternal(); }
ExceptionOr<void> XMLHttpRequest::sendInternal(const String&) { return sendInternal(); }
ExceptionOr<void> XMLHttpRequest::sendInternal(RefPtr<URLSearchParams>) { return sendInternal(); }

void XMLHttpRequest::clearRequest()
{
    // m_requestDocument = nullptr;
    // m_requestBlob = nullptr;
    m_requestArrayBuffer = nullptr;
    m_requestArrayBufferView = nullptr;
    // m_requestFormData = nullptr;
    // m_requestURLSearchParams = nullptr;
    m_requestBodyString = String();
}

void XMLHttpRequest::clearResponse()
{
    Locker locker { m_responseLock };
    
    m_status = 0;
    m_statusText = String();
    m_responseHeaders = nullptr;
    m_responseData.clear();
    m_responseText = String();
    m_responseArrayBuffer = nullptr;
    // m_responseBlob = nullptr;
    // m_responseDocument = nullptr;
    m_responseJSON.clear();
    m_receivedLength = 0;
    m_expectedLength = 0;
}

bool XMLHttpRequest::isAllowedHTTPMethod(const String& method) const
{
    // Forbidden methods per spec
    static const char* const forbiddenMethods[] = {
        "CONNECT",
        "TRACE",
        "TRACK"
    };
    
    for (auto* forbidden : forbiddenMethods) {
        if (equalIgnoringASCIICase(method, String::fromUTF8(forbidden)))
            return false;
    }
    
    return true;
}

bool XMLHttpRequest::isAllowedHTTPHeader(const String& name) const
{
    // Forbidden headers per spec
    static const char* const forbiddenHeaders[] = {
        "Accept-Charset",
        "Accept-Encoding",
        "Access-Control-Request-Headers",
        "Access-Control-Request-Method",
        "Connection",
        "Content-Length",
        "Cookie",
        "Cookie2",
        "Date",
        "DNT",
        "Expect",
        "Host",
        "Keep-Alive",
        "Origin",
        "Referer",
        "TE",
        "Trailer",
        "Transfer-Encoding",
        "Upgrade",
        "Via"
    };
    
    for (auto* forbidden : forbiddenHeaders) {
        if (equalIgnoringASCIICase(name, String::fromUTF8(forbidden)))
            return false;
    }
    
    // Also forbid headers starting with "Proxy-" or "Sec-"
    if (name.startsWithIgnoringASCIICase("proxy-"_s) || name.startsWithIgnoringASCIICase("sec-"_s))
        return false;
        
    return true;
}

String XMLHttpRequest::normalizeHTTPMethod(const String& method) const
{
    // Normalize method names per spec
    static const char* const methods[] = {
        "DELETE",
        "GET",
        "HEAD",
        "OPTIONS",
        "POST",
        "PUT"
    };
    
    for (auto* m : methods) {
        if (equalIgnoringASCIICase(method, String::fromUTF8(m)))
            return String::fromUTF8(m);
    }
    
    return method.convertToASCIIUppercase();
}

bool XMLHttpRequest::hasPendingActivity() const
{
    return m_readyState != UNSENT && m_readyState != DONE;
}

void XMLHttpRequest::stop()
{
    abort();
}

void XMLHttpRequest::suspend()
{
    // TODO: Implement suspend
}

void XMLHttpRequest::resume()
{
    // TODO: Implement resume
}

size_t XMLHttpRequest::memoryCost() const
{
    size_t cost = sizeof(*this);
    
    cost += m_method.sizeInBytes();
    cost += m_url.string().sizeInBytes();
    cost += m_user.sizeInBytes();
    cost += m_password.sizeInBytes();
    cost += m_statusText.sizeInBytes();
    cost += m_responseURL.sizeInBytes();
    cost += m_mimeTypeOverride.sizeInBytes();
    cost += m_requestBodyString.sizeInBytes();
    
    {
        Locker locker { m_responseLock };
        cost += m_responseData.capacity();
        cost += m_responseText.sizeInBytes();
        
        if (m_responseArrayBuffer)
            cost += m_responseArrayBuffer->byteLength();
    }
    
    return cost;
}

} // namespace WebCore