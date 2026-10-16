/*
 *  Copyright (C) 2004-2025 Apple Inc. All rights reserved.
 *  Copyright (C) 2005-2007 Alexey Proskuryakov <ap@webkit.org>
 *  Copyright (C) 2007, 2008 Julien Chaffraix <jchaffraix@webkit.org>
 *  Copyright (C) 2008, 2011 Google Inc. All rights reserved.
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

#include "ContextDestructionObserverInlines.h"
#include "DOMFormData.h"
#include "Event.h"
#include "EventNames.h"
#include "EventTargetInlines.h"
#include "ExceptionOr.h"
#include "HTMLDocument.h"
#include "HTTPHeaderNames.h"
#include "HTTPParsers.h"
#include "JSDOMBinding.h"
#include "JSNodeCustomInlines.h"
#include "MIMETypeRegistry.h"
#include "ParsedContentType.h"
#include "ScriptExecutionContext.h"
#include "StringAdaptors.h"
#include "URLSearchParams.h"
#include "XMLDocument.h"
#include "XMLHttpRequestProgressEventThrottle.h"
#include "XMLHttpRequestTextDecoder.h"
#include "XMLHttpRequestUpload.h"
#include "WebCoreOpaqueRootInlines.h"
#include "markup.h"
#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/ArrayBufferView.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSLock.h>
#include <wtf/StdLibExtras.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/CString.h>
#include <wtf/text/MakeString.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(XMLHttpRequest);

static void replaceCharsetInMediaTypeIfNeeded(String& mediaType)
{
    auto parsedContentType = ParsedContentType::create(mediaType);
    if (!parsedContentType || parsedContentType->charset().isEmpty() || equalIgnoringASCIICase(parsedContentType->charset(), "UTF-8"_s))
        return;

    parsedContentType->setCharset("UTF-8"_s);
    mediaType = parsedContentType->serialize();
}

Ref<XMLHttpRequest> XMLHttpRequest::create(ScriptExecutionContext& context)
{
    auto xmlHttpRequest = adoptRef(*new XMLHttpRequest(context, nullptr));
    xmlHttpRequest->suspendIfNeeded();
    return xmlHttpRequest;
}

Ref<XMLHttpRequest> XMLHttpRequest::create(Document& document)
{
    auto xmlHttpRequest = adoptRef(*new XMLHttpRequest(*document.scriptExecutionContext(), &document));
    xmlHttpRequest->suspendIfNeeded();
    return xmlHttpRequest;
}

XMLHttpRequest::XMLHttpRequest(ScriptExecutionContext& context, Document* document)
    : ActiveDOMObject(&context)
    , m_document(document)
    , m_progressEventThrottle(makeUniqueRef<XMLHttpRequestProgressEventThrottle>(*this))
    , m_timeoutTimer(context.vm().runLoop(), "XMLHttpRequest::TimeoutTimer"_s, this, &XMLHttpRequest::timeoutTimerFired)
{
}

XMLHttpRequest::~XMLHttpRequest() = default;

ScriptExecutionContext* XMLHttpRequest::scriptExecutionContext() const
{
    return ActiveDOMObject::scriptExecutionContext();
}

URL XMLHttpRequest::encodingParseURL(const String& url) const
{
    if (RefPtr document = m_document)
        return document->encodingParseURL(url);
    return URL { URL { "about:blank"_s }, url };
}

ExceptionOr<OwnedString> XMLHttpRequest::responseText()
{
    if (responseType() != ResponseType::EmptyString && responseType() != ResponseType::Text)
        return Exception { ExceptionCode::InvalidStateError };
    return OwnedString { responseTextIgnoringResponseType() };
}

void XMLHttpRequest::didCacheResponse()
{
    ASSERT(doneWithoutErrors());
    m_responseCacheIsValid = true;
    m_responseBuilder.clear();
}

ExceptionOr<Document*> XMLHttpRequest::responseXML()
{
    if (responseType() != ResponseType::EmptyString && responseType() != ResponseType::Document)
        return Exception { ExceptionCode::InvalidStateError };

    if (!doneWithoutErrors())
        return nullptr;

    if (!m_createdDocument) {
        auto mimeType = responseMIMEType();
        bool isHTML = equalLettersIgnoringASCIICase(mimeType, "text/html"_s);
        bool isXML = MIMETypeRegistry::isXMLMIMEType(mimeType);

        // The W3C spec requires the final MIME type to be some valid XML type, or text/html.
        // If it is text/html, then the responseType of "document" must have been supplied explicitly.
        if ((!isXML && !isHTML)
            || (isHTML && responseType() == ResponseType::EmptyString)) {
            Locker locker { m_gcLock };
            m_responseDocument = nullptr;
        } else {
            RefPtr<Document> responseDocument;
            if (isHTML)
                responseDocument = HTMLDocument::create(*scriptExecutionContext(), m_response.url());
            else
                responseDocument = XMLDocument::create(*scriptExecutionContext(), m_response.url());
            responseDocument->overrideMIMEType(mimeType);
            responseDocument->setMarkupUnsafe(m_responseBuilder.toStringPreserveCapacity(), { });

            Locker locker { m_gcLock };
            if (!isHTML && !responseDocument->wellFormed())
                m_responseDocument = nullptr;
            else
                m_responseDocument = WTF::move(responseDocument);
        }
        m_createdDocument = true;
    }

    Locker locker { m_gcLock };
    return m_responseDocument.get();
}

BlobRefPtr XMLHttpRequest::createResponseBlob()
{
    ASSERT(responseType() == ResponseType::Blob);
    ASSERT(doneWithoutErrors());

    auto data = std::exchange(m_binaryResponseBuilder, { });
    return XMLHttpRequestLoader::createBlob(*protect(scriptExecutionContext()), data.span(), responseMIMEType(FinalMIMEType::Yes)); // responseMIMEType defaults to text/xml which may be incorrect.
}

RefPtr<ArrayBuffer> XMLHttpRequest::createResponseArrayBuffer()
{
    ASSERT(responseType() == ResponseType::Arraybuffer);
    ASSERT(doneWithoutErrors());

    return ArrayBuffer::tryCreate(std::exchange(m_binaryResponseBuilder, { }).span());
}

ExceptionOr<void> XMLHttpRequest::setTimeout(unsigned timeout)
{
    if (!m_async)
        return Exception { ExceptionCode::InvalidAccessError };
    m_timeoutMilliseconds = timeout;
    if (!m_timeoutTimer.isActive())
        return { };

    // If timeout is zero, we should use the default network timeout. But we disabled it so let's mimic it with a 60 seconds timeout value.
    Seconds interval = Seconds { m_timeoutMilliseconds ? m_timeoutMilliseconds / 1000. : 60. } - (MonotonicTime::now() - m_sendingTime);
    m_timeoutTimer.startOneShot(std::max(interval, 1_ms)); // Bun's event loop has room for one timer that is due at once.
    return { };
}

ExceptionOr<void> XMLHttpRequest::setResponseType(ResponseType type)
{
    if (readyState() >= LOADING)
        return Exception { ExceptionCode::InvalidStateError };

    // Newer functionality is not available to synchronous requests in window contexts, as a spec-mandated
    // attempt to discourage synchronous XHR use. responseType is one such piece of functionality.
    // We'll only disable this functionality for HTTP(S) requests since sync requests for local protocols
    // such as file: and data: still make sense to allow.
    if (!m_async && m_url.protocolIsInHTTPFamily())
        return Exception { ExceptionCode::InvalidAccessError };

    m_responseType = type;
    return { };
}

String XMLHttpRequest::responseURL() const
{
    URL responseURL(m_response.url());
    responseURL.removeFragmentIdentifier();

    return responseURL.string();
}

XMLHttpRequestUpload& XMLHttpRequest::upload()
{
    Locker locker { m_gcLock };
    if (!m_upload)
        lazyInitialize(m_upload, makeUniqueWithoutRefCountedCheck<XMLHttpRequestUpload>(*this));
    return *m_upload;
}

void XMLHttpRequest::changeState(State newState)
{
    if (readyState() != newState) {
        // Setting the readyState to DONE could get the wrapper collected before we get a chance to fire the JS
        // events in callReadyStateChangeListener() below so we extend the lifetime of the JS wrapper until the
        // of this scope.
        auto eventFiringActivity = makePendingActivity(*this);

        m_readyState = newState;
        if (readyState() == DONE) {
            // The XHR object itself holds on to the responseText, and
            // thus has extra cost even independent of any
            // responseText or responseXML objects it has handed
            // out. But it is protected from GC while loading, so this
            // can't be recouped until the load is done, so only
            // report the extra cost at that point.
            if (RefPtr context = scriptExecutionContext()) {
                JSC::VM& vm = context->vm();
                JSC::JSLockHolder lock(vm);
                vm.heap.reportExtraMemoryAllocated(static_cast<JSCell*>(nullptr), memoryCost());
            }
        }
        callReadyStateChangeListener();
    }
}

void XMLHttpRequest::callReadyStateChangeListener()
{
    if (!scriptExecutionContext())
        return;

    // Check whether sending load and loadend events before sending readystatechange event, as it may change m_error/m_readyState values.
    bool shouldSendLoadEvent = (readyState() == DONE && !m_error);

    if (m_async || (readyState() <= OPENED || readyState() == DONE)) {
        m_progressEventThrottle->dispatchReadyStateChangeEvent(Event::create(eventNames().readystatechangeEvent, Event::CanBubble::No, Event::IsCancelable::No));
    }

    if (shouldSendLoadEvent) {
        m_progressEventThrottle->dispatchProgressEvent(eventNames().loadEvent);
        m_progressEventThrottle->dispatchProgressEvent(eventNames().loadendEvent);
    }
}

ExceptionOr<void> XMLHttpRequest::setWithCredentials(bool value)
{
    if (readyState() > OPENED || m_sendFlag)
        return Exception { ExceptionCode::InvalidStateError };

    m_includeCredentials = value;
    return { };
}

ExceptionOr<void> XMLHttpRequest::open(const String& method, const String& url)
{
    // If the async argument is omitted, set async to true.
    return open(method, encodingParseURL(url), true);
}

ExceptionOr<void> XMLHttpRequest::open(const String& method, const URL& url, bool async)
{
    RefPtr contextDocument = m_document;
    if (contextDocument && (!contextDocument->isFullyActive() || contextDocument->window()->closed()))
        return Exception { ExceptionCode::InvalidStateError, "Document is not fully active"_s };

    if (!isValidHTTPToken(method))
        return Exception { ExceptionCode::SyntaxError };

    if (isForbiddenMethod(method))
        return Exception { ExceptionCode::SecurityError };

    if (!url.isValid())
        return Exception { ExceptionCode::SyntaxError };

    if (!async) {
        // Newer functionality is not available to synchronous requests in window contexts, as a spec-mandated
        // attempt to discourage synchronous XHR use. responseType is one such piece of functionality.
        // We'll only disable this functionality for HTTP(S) requests since sync requests for local protocols
        // such as file: and data: still make sense to allow.
        if (url.protocolIsInHTTPFamily() && responseType() != ResponseType::EmptyString)
            return Exception { ExceptionCode::InvalidAccessError };

        // Similarly, timeouts are disabled for synchronous requests as well.
        if (m_timeoutMilliseconds > 0)
            return Exception { ExceptionCode::InvalidAccessError };
    }

    if (!internalAbort())
        return { };

    m_sendFlag = false;
    m_uploadListenerFlag = false;
    m_method = normalizeHTTPMethod(method);
    m_error = false;
    m_uploadComplete = false;

    // clear stuff from possible previous load
    clearResponse();
    clearRequest();

    m_url = url;

    m_async = async;

    ASSERT(!m_loadingActivity);

    changeState(OPENED);

    return { };
}

ExceptionOr<void> XMLHttpRequest::open(const String& method, const String& url, bool async, const String& user, const String& password)
{
    auto urlWithCredentials = encodingParseURL(url);
    if (!user.isNull())
        urlWithCredentials.setUser(user);
    if (!password.isNull())
        urlWithCredentials.setPassword(password);

    return open(method, urlWithCredentials, async);
}

std::optional<ExceptionOr<void>> XMLHttpRequest::prepareToSend()
{
    // A return value other than std::nullopt means we should not try to send, and we should return that value to the caller.
    // std::nullopt means we are ready to send and should continue with the send algorithm.

    if (!scriptExecutionContext())
        return ExceptionOr<void> { };

    if (readyState() != OPENED || m_sendFlag)
        return ExceptionOr<void> { Exception { ExceptionCode::InvalidStateError } };
    ASSERT(!m_loadingActivity);

    // Bun never blocks on a promise from a host function.
    if (!m_async)
        return ExceptionOr<void> { Exception { ExceptionCode::NotSupportedError, "Synchronous XMLHttpRequest is not supported"_s } };

    m_error = false;
    return std::nullopt;
}

ExceptionOr<void> XMLHttpRequest::send(std::optional<SendTypes>&& sendType)
{
    if (!sendType)
        return send();

    return WTF::switchOn(WTF::move(*sendType),
        [this](auto&& sendType) -> ExceptionOr<void> { return send(WTF::move(sendType)); }
    );
}

ExceptionOr<void> XMLHttpRequest::send(Ref<Document>&& document)
{
    if (auto result = prepareToSend())
        return WTF::move(result.value());

    if (m_method != "GET"_s && m_method != "HEAD"_s) {
        if (!m_requestHeaders.contains(HTTPHeaderName::ContentType))
            m_requestHeaders.set(HTTPHeaderName::ContentType, document->isHTMLDocument() ? "text/html;charset=UTF-8"_s : "application/xml;charset=UTF-8"_s);
        else {
            String contentType = m_requestHeaders.get(HTTPHeaderName::ContentType);
            replaceCharsetInMediaTypeIfNeeded(contentType);
            m_requestHeaders.set(HTTPHeaderName::ContentType, contentType);
        }

        // FIXME: According to XMLHttpRequest Level 2, this should use the Document.innerHTML algorithm
        // from the HTML5 specification to serialize the document.

        // https://xhr.spec.whatwg.org/#dom-xmlhttprequest-send Step 4.2.
        auto serialized = serializeFragment(document, SerializedNodes::SubtreeIncludingNode);
        auto converted = replaceUnpairedSurrogatesWithReplacementCharacter(WTF::move(serialized));
        m_requestEntityBody = XMLHttpRequestLoader::createBlob(*protect(scriptExecutionContext()), byteCast<uint8_t>(converted.utf8().span()));
    }

    return createRequest();
}

ExceptionOr<void> XMLHttpRequest::send(String&& body)
{
    if (auto result = prepareToSend())
        return WTF::move(result.value());

    if (body.isNull())
        return createRequest();

    return sendStringData(WTF::move(body), "text/plain;charset=UTF-8"_s);
}

ExceptionOr<void> XMLHttpRequest::send(Ref<Blob>&& body)
{
    if (auto result = prepareToSend())
        return WTF::move(result.value());

    if (m_method != "GET"_s && m_method != "HEAD"_s) {
        if (!m_requestHeaders.contains(HTTPHeaderName::ContentType)) {
            String blobType = XMLHttpRequestLoader::blobType(*protect(scriptExecutionContext()), *body->impl());
            if (!blobType.isEmpty() && isValidContentType(blobType))
                m_requestHeaders.set(HTTPHeaderName::ContentType, blobType);
        }

        m_requestEntityBody = body->impl();
    }

    return createRequest();
}

ExceptionOr<void> XMLHttpRequest::send(Ref<URLSearchParams>&& params)
{
    if (auto result = prepareToSend())
        return WTF::move(result.value());

    return sendStringData(params->toString(), "application/x-www-form-urlencoded;charset=UTF-8"_s);
}

// https://xhr.spec.whatwg.org/#dom-xmlhttprequest-send steps 3 and 4, for bodies that are serialized to a UTF-8 string.
ExceptionOr<void> XMLHttpRequest::sendStringData(String&& body, const String& defaultContentType)
{
    if (m_method != "GET"_s && m_method != "HEAD"_s) {
        String contentType = m_requestHeaders.get(HTTPHeaderName::ContentType);
        if (contentType.isNull())
            m_requestHeaders.set(HTTPHeaderName::ContentType, defaultContentType);
        else {
            replaceCharsetInMediaTypeIfNeeded(contentType);
            m_requestHeaders.set(HTTPHeaderName::ContentType, contentType);
        }

        m_requestEntityBody = XMLHttpRequestLoader::createBlob(*protect(scriptExecutionContext()), byteCast<uint8_t>(body.utf8().span()));
    }

    return createRequest();
}

ExceptionOr<void> XMLHttpRequest::send(Ref<DOMFormData>&& body)
{
    if (auto result = prepareToSend())
        return WTF::move(result.value());

    if (m_method != "GET"_s && m_method != "HEAD"_s) {
        Ref context = *scriptExecutionContext();
        m_requestEntityBody = XMLHttpRequestLoader::createMultiPartBlob(context, body);
        if (!m_requestEntityBody)
            return Exception { ExceptionCode::NotReadableError };
        if (!m_requestHeaders.contains(HTTPHeaderName::ContentType))
            m_requestHeaders.set(HTTPHeaderName::ContentType, XMLHttpRequestLoader::blobType(context, *m_requestEntityBody));
    }

    return createRequest();
}

ExceptionOr<void> XMLHttpRequest::send(Ref<ArrayBuffer>&& body)
{
    return sendBytesData(body->span());
}

ExceptionOr<void> XMLHttpRequest::send(Ref<ArrayBufferView>&& body)
{
    return sendBytesData(body->span());
}

ExceptionOr<void> XMLHttpRequest::sendBytesData(std::span<const uint8_t> data)
{
    if (auto result = prepareToSend())
        return WTF::move(result.value());

    if (m_method != "GET"_s && m_method != "HEAD"_s)
        m_requestEntityBody = XMLHttpRequestLoader::createBlob(*protect(scriptExecutionContext()), data);

    return createRequest();
}

ExceptionOr<void> XMLHttpRequest::createRequest()
{
    {
        Locker locker { m_gcLock };
        if (m_async && m_upload && m_upload->hasEventListeners())
            m_uploadListenerFlag = true;
    }
    XMLHttpRequestLoader::Request request { URL { m_url }, m_method, m_requestHeaders, { } };

    if (m_requestEntityBody) {
        ASSERT(m_method != "GET"_s);
        ASSERT(m_method != "HEAD"_s);
        request.body = WTF::move(m_requestEntityBody);
    }

    if (m_timeoutMilliseconds) {
        m_sendingTime = MonotonicTime::now();
        m_timeoutTimer.startOneShot(1_ms * m_timeoutMilliseconds);
    }

    m_exceptionCode = std::nullopt;
    m_error = false;
    m_uploadComplete = !request.body;
    m_sendFlag = true;

    m_progressEventThrottle->dispatchProgressEvent(eventNames().loadstartEvent);
    if (!m_uploadComplete && m_uploadListenerFlag) {
        RefPtr upload = [&] {
            Locker locker { m_gcLock };
            return m_upload.get();
        }();
        upload->dispatchProgressEvent(eventNames().loadstartEvent, 0, XMLHttpRequestLoader::blobLength(*request.body));
    }
    if (readyState() != OPENED || !m_sendFlag || m_loadingActivity)
        return { };

    auto loader = XMLHttpRequestLoader::create(*this, WTF::move(request));
    if (loader)
        m_loadingActivity = LoadingActivity { Ref { *this }, loader.releaseNonNull() };

    // Either loader is null or some error was synchronously sent to us.
    ASSERT(m_loadingActivity || !m_sendFlag);

    if (m_exceptionCode)
        return Exception { m_exceptionCode.value() };
    if (m_error)
        return Exception { ExceptionCode::NetworkError };
    return { };
}

void XMLHttpRequest::abort()
{
    Ref<XMLHttpRequest> protectedThis(*this);

    if (!internalAbort())
        return;

    clearResponse();

    m_requestHeaders = { };
    if ((readyState() == OPENED && m_sendFlag) || readyState() == HEADERS_RECEIVED || readyState() == LOADING) {
        ASSERT(!m_loadingActivity);
        m_sendFlag = false;
        changeState(DONE);
        dispatchErrorEvents(eventNames().abortEvent);
    }
    if (readyState() == DONE)
        m_readyState = UNSENT;
}

bool XMLHttpRequest::internalAbort()
{
    m_error = true;

    m_receivedLength = 0;

    m_decoder = nullptr;

    m_timeoutTimer.stop();

    if (!m_loadingActivity)
        return true;

    // Cancelling m_loadingActivity may trigger a window.onload callback which can call open() on the same xhr.
    // This would create internalAbort reentrant call.
    // m_loadingActivity is set to std::nullopt before being cancelled to exit early in any reentrant internalAbort() call.
    auto loadingActivity = std::exchange(m_loadingActivity, std::nullopt);
    protect(loadingActivity->loader)->cancel();

    // If window.onload callback calls open() and send() on the same xhr, m_loadingActivity is now set to a new value.
    // The function calling internalAbort() should abort to let the open() and send() calls continue properly.
    // We ask the function calling internalAbort() to exit by returning false.
    // Save this information to a local variable since we are going to drop protection.
    bool newLoadStarted = !!m_loadingActivity;

    return !newLoadStarted;
}

void XMLHttpRequest::clearResponse()
{
    m_response = { };
    clearResponseBuffers();
}

void XMLHttpRequest::clearResponseBuffers()
{
    m_responseBuilder.clear();
    m_createdDocument = false;
    {
        Locker locker { m_gcLock };
        m_responseDocument = nullptr;
    }
    m_binaryResponseBuilder.clear();
    m_responseCacheIsValid = false;
    m_allResponseHeaders = { };
}

void XMLHttpRequest::clearRequest()
{
    m_requestHeaders = { };
    m_requestEntityBody = nullptr;
    m_url = { };
}

void XMLHttpRequest::genericError()
{
    clearResponse();
    clearRequest();
    m_sendFlag = false;
    m_error = true;

    changeState(DONE);
}

void XMLHttpRequest::networkError()
{
    genericError();
    dispatchErrorEvents(eventNames().errorEvent);
    internalAbort();
}

size_t XMLHttpRequest::memoryCost() const
{
    if (readyState() != DONE)
        return 0;

    // Text responses are decoded into m_responseBuilder, binary ones (arraybuffer / blob) are
    // accumulated in m_binaryResponseBuilder. Only one of the two is populated for a given
    // response type.
    return m_responseBuilder.length() * 2 + m_binaryResponseBuilder.size();
}

ExceptionOr<void> XMLHttpRequest::overrideMimeType(const String& mimeType)
{
    if (readyState() == LOADING || readyState() == DONE)
        return Exception { ExceptionCode::InvalidStateError };

    m_mimeTypeOverride = "application/octet-stream"_s;
    if (isValidContentType(mimeType))
        m_mimeTypeOverride = mimeType;

    return { };
}

ExceptionOr<void> XMLHttpRequest::setRequestHeader(const String& name, const String& value)
{
    if (readyState() != OPENED || m_sendFlag)
        return Exception { ExceptionCode::InvalidStateError };

    String normalizedValue = value.trim(isASCIIWhitespaceWithoutFF<char16_t>);
    if (!isValidHTTPToken(name) || !isValidHTTPHeaderValue(normalizedValue))
        return Exception { ExceptionCode::SyntaxError };

    if (isForbiddenHeader(name, normalizedValue))
        return { };

    m_requestHeaders.add(name, normalizedValue);
    return { };
}

String XMLHttpRequest::getAllResponseHeaders() const
{
    if (readyState() < HEADERS_RECEIVED || m_error)
        return emptyString();

    if (!m_allResponseHeaders) {
        Vector<std::pair<String, String>> headers;
        for (auto& header : m_response.httpHeaderFields())
            headers.append(std::make_pair(header.key, header.value));

        std::ranges::sort(headers, [](auto& x, auto& y) {
            unsigned xLength = x.first.length();
            unsigned yLength = y.first.length();
            unsigned commonLength = std::min(xLength, yLength);
            for (unsigned i = 0; i < commonLength; ++i) {
                auto xCharacter = toASCIIUpper(x.first[i]);
                auto yCharacter = toASCIIUpper(y.first[i]);
                if (xCharacter != yCharacter)
                    return xCharacter < yCharacter;
            }
            return xLength < yLength;
        });

        StringBuilder stringBuilder;
        for (auto& header : headers)
            stringBuilder.append(asASCIILowercase(header.first), ": "_s, header.second, "\r\n"_s);

        m_allResponseHeaders = stringBuilder.toString();
    }

    return m_allResponseHeaders;
}

String XMLHttpRequest::getResponseHeader(const String& name) const
{
    if (readyState() < HEADERS_RECEIVED || m_error)
        return String();

    return m_response.httpHeaderField(name);
}

String XMLHttpRequest::responseMIMEType(FinalMIMEType finalMIMEType) const
{
    String contentType = m_mimeTypeOverride;
    if (contentType.isEmpty())
        contentType = m_response.httpHeaderField(HTTPHeaderName::ContentType);
    if (auto parsedContentType = ParsedContentType::create(contentType))
        return finalMIMEType == FinalMIMEType::Yes ? parsedContentType->serialize() : parsedContentType->mimeType();
    return "text/xml"_s;
}

int XMLHttpRequest::status() const
{
    if (readyState() == UNSENT || readyState() == OPENED || m_error)
        return 0;

    return m_response.httpStatusCode();
}

String XMLHttpRequest::statusText() const
{
    if (readyState() == UNSENT || readyState() == OPENED || m_error)
        return String();

    return m_response.httpStatusText();
}

void XMLHttpRequest::didFail()
{
    // If we are already in an error state, for instance we called abort(), bail out early.
    if (m_error)
        return;

    // In case didFail is called synchronously on an asynchronous XHR call, let's dispatch network error asynchronously
    if (m_async && m_sendFlag && !m_loadingActivity) {
        m_sendFlag = false;
        m_timeoutTimer.stop();
        queueTaskKeepingObjectAlive(*this, TaskSource::Networking, [](auto& xhr) {
            xhr.networkError();
        });
        return;
    }
    m_exceptionCode = ExceptionCode::NetworkError;
    networkError();
}

void XMLHttpRequest::didFinishLoading()
{
    Ref protectedThis { *this };

    if (m_error)
        return;

    if (readyState() < HEADERS_RECEIVED)
        changeState(HEADERS_RECEIVED);

    if (RefPtr decoder = m_decoder)
        m_responseBuilder.append(decoder->flush());

    m_responseBuilder.shrinkToFit();

    m_loadingActivity = std::nullopt;
    m_url = { };

    m_sendFlag = false;
    changeState(DONE);
    m_decoder = nullptr;

    m_timeoutTimer.stop();
}

void XMLHttpRequest::didSendData(unsigned long long bytesSent, unsigned long long totalBytesToBeSent)
{
    RefPtr upload = [&] {
        Locker locker { m_gcLock };
        return m_upload.get();
    }();
    if (!upload)
        return;

    if (m_uploadListenerFlag)
        upload->dispatchProgressEvent(eventNames().progressEvent, bytesSent, totalBytesToBeSent);

    if (bytesSent == totalBytesToBeSent && !m_uploadComplete) {
        m_uploadComplete = true;
        if (m_uploadListenerFlag) {
            upload->dispatchProgressEvent(eventNames().loadEvent, bytesSent, totalBytesToBeSent);
            upload->dispatchProgressEvent(eventNames().loadendEvent, bytesSent, totalBytesToBeSent);
        }
    }
}

void XMLHttpRequest::didReceiveResponse(XMLHttpRequestLoader::Response&& response)
{
    m_response = WTF::move(response);
}

static inline bool LEGACY_NODELETE shouldDecodeResponse(XMLHttpRequest::ResponseType type)
{
    switch (type) {
    case XMLHttpRequest::ResponseType::EmptyString:
    case XMLHttpRequest::ResponseType::Document:
    case XMLHttpRequest::ResponseType::Json:
    case XMLHttpRequest::ResponseType::Text:
        return true;
    case XMLHttpRequest::ResponseType::Arraybuffer:
    case XMLHttpRequest::ResponseType::Blob:
        return false;
    }
    ASSERT_NOT_REACHED();
    return true;
}

// https://xhr.spec.whatwg.org/#final-charset
String XMLHttpRequest::finalResponseCharset() const
{
    // The charset of the response MIME type, if any, is overridden by the charset of the override MIME type.
    StringView label = m_response.textEncodingName();

    if (!m_mimeTypeOverride.isEmpty()) {
        StringView overrideResponseCharset = extractCharsetFromMediaType(m_mimeTypeOverride);
        if (!overrideResponseCharset.isEmpty())
            label = overrideResponseCharset;
    }

    return label.toString();
}

Ref<XMLHttpRequestTextDecoder> XMLHttpRequest::createDecoder() const
{
    Ref context = *scriptExecutionContext();
    switch (responseType()) {
    case ResponseType::Json:
        return XMLHttpRequestTextDecoder::createAlwaysUsingUTF8(context);
    case ResponseType::EmptyString:
        if (MIMETypeRegistry::isXMLMIMEType(responseMIMEType()))
            return XMLHttpRequestTextDecoder::createForXML(context, finalResponseCharset());
        break;
    case ResponseType::Document:
        if (!equalLettersIgnoringASCIICase(responseMIMEType(), "text/html"_s))
            return XMLHttpRequestTextDecoder::createForXML(context, finalResponseCharset());
        break;
    case ResponseType::Text:
    case ResponseType::Arraybuffer:
    case ResponseType::Blob:
        break;
    }
    return XMLHttpRequestTextDecoder::create(context, finalResponseCharset());
}

void XMLHttpRequest::didReceiveData(std::span<const uint8_t> buffer)
{
    if (m_error)
        return;

    if (readyState() < HEADERS_RECEIVED)
        changeState(HEADERS_RECEIVED);

    bool useDecoder = shouldDecodeResponse(responseType());

    if (useDecoder && !m_decoder)
        m_decoder = createDecoder();

    if (buffer.empty())
        return;

    if (useDecoder)
        m_responseBuilder.append(protect(*m_decoder)->decode(buffer));
    else {
        // Buffer binary data.
        m_binaryResponseBuilder.append(buffer);
    }

    if (!m_error) {
        m_receivedLength += buffer.size();

        if (readyState() != LOADING)
            changeState(LOADING);
        else {
            // Firefox calls readyStateChanged every time it receives data, 4449442
            callReadyStateChangeListener();
        }

        long long expectedLength = m_response.expectedContentLength();
        bool lengthComputable = expectedLength > 0 && m_receivedLength <= expectedLength;
        unsigned long long total = lengthComputable ? expectedLength : 0;
        m_progressEventThrottle->updateProgress(m_async, lengthComputable, m_receivedLength, total);
    }
}

void XMLHttpRequest::dispatchErrorEvents(const AtomString& type)
{
    if (!m_uploadComplete) {
        m_uploadComplete = true;
        RefPtr upload = [&] {
            Locker locker { m_gcLock };
            return m_upload.get();
        }();
        if (upload && m_uploadListenerFlag) {
            upload->dispatchProgressEvent(type, 0, 0);
            upload->dispatchProgressEvent(eventNames().loadendEvent, 0, 0);
        }
    }
    m_progressEventThrottle->dispatchErrorProgressEvent(type);
    m_progressEventThrottle->dispatchErrorProgressEvent(eventNames().loadendEvent);
}

void XMLHttpRequest::timeoutTimerFired()
{
    if (!m_loadingActivity)
        return;

    // The event loop fires this timer where script cannot run, and it may be about to sleep. A task posted this way wakes it.
    protect(scriptExecutionContext())->postTaskConcurrently([protectedThis = Ref { *this }, loader = m_loadingActivity->loader](auto&) {
        if (protectedThis->m_loadingActivity && protectedThis->m_loadingActivity->loader.ptr() == loader.ptr())
            protectedThis->didReachTimeout();
    });
}

void XMLHttpRequest::didReachTimeout()
{
    Ref<XMLHttpRequest> protectedThis(*this);
    if (!internalAbort())
        return;

    clearResponse();
    clearRequest();

    m_sendFlag = false;
    m_error = true;
    m_exceptionCode = ExceptionCode::TimeoutError;

    if (!m_async) {
        m_readyState = DONE;
        return;
    }

    changeState(DONE);

    dispatchErrorEvents(eventNames().timeoutEvent);
}

void XMLHttpRequest::stop()
{
    internalAbort();

    // A window that is closed stops its requests while the context lives on. The wrapper is not kept for a request that fires nothing more.
    m_sendFlag = false;
    m_readyState = UNSENT;
}

void XMLHttpRequest::contextDestroyed()
{
    ASSERT(!m_loadingActivity);
    ActiveDOMObject::contextDestroyed();
}

void XMLHttpRequest::updateHasRelevantEventListener()
{
    bool uploadHasRelevantEventListener = [&] {
        Locker locker { m_gcLock };
        return m_upload && m_upload->hasRelevantEventListener();
    }();
    m_hasRelevantEventListener = hasEventListeners(eventNames().abortEvent)
        || hasEventListeners(eventNames().errorEvent)
        || hasEventListeners(eventNames().loadEvent)
        || hasEventListeners(eventNames().loadendEvent)
        || hasEventListeners(eventNames().progressEvent)
        || hasEventListeners(eventNames().readystatechangeEvent)
        || hasEventListeners(eventNames().timeoutEvent)
        || uploadHasRelevantEventListener;
}

void XMLHttpRequest::eventListenersDidChange()
{
    updateHasRelevantEventListener();
}

// An XMLHttpRequest object must not be garbage collected if its state is either opened with the send() flag set, headers received, or loading, and
// it has one or more event listeners registered whose type is one of readystatechange, progress, abort, error, load, timeout, and loadend.
bool XMLHttpRequest::virtualHasPendingActivity() const
{
    if (!m_hasRelevantEventListener)
        return false;

    switch (readyState()) {
    case OPENED:
        return m_sendFlag;
    case HEADERS_RECEIVED:
    case LOADING:
        return true;
    case UNSENT:
    case DONE:
        break;
    }
    return false;
}

template<typename Visitor>
void XMLHttpRequest::visitAdditionalChildrenInGCThread(Visitor& visitor)
{
    Locker locker { m_gcLock };
    if (m_upload)
        addWebCoreOpaqueRoot(visitor, *m_upload);

    SUPPRESS_UNCHECKED_LOCAL if (auto* document = m_responseDocument.get())
        addWebCoreOpaqueRoot(visitor, *document);

    // In a browser the window is the global object, which outlives the request.
    SUPPRESS_UNCHECKED_LOCAL if (auto* document = m_document.get())
        addWebCoreOpaqueRoot(visitor, *document);
}

DEFINE_VISIT_ADDITIONAL_CHILDREN_IN_GC_THREAD(XMLHttpRequest);

} // namespace WebCore
