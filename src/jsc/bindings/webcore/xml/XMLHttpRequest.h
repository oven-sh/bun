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

#include "ActiveDOMObject.h"
#include "EventTargetInterfaces.h"
#include "ExceptionCode.h"
#include <wtf/URL.h>
#include "XMLHttpRequestEventTarget.h"
#include "XMLHttpRequestLoader.h"
#include <wtf/RunLoop.h>
#include <wtf/text/StringBuilder.h>

namespace JSC {
class ArrayBuffer;
class ArrayBufferView;
}

namespace WebCore {

class Blob;
class Document;
class DOMFormData;
class URLSearchParams;
class XMLHttpRequestProgressEventThrottle;
class XMLHttpRequestTextDecoder;
class XMLHttpRequestUpload;
struct OwnedString;
template<typename> class ExceptionOr;

class XMLHttpRequest final : public ActiveDOMObject, public RefCounted<XMLHttpRequest>, public XMLHttpRequestEventTarget {
    WTF_MAKE_TZONE_ALLOCATED_EXPORT(XMLHttpRequest, WEBCORE_EXPORT);
public:
    static Ref<XMLHttpRequest> create(ScriptExecutionContext&);
    // For a window's constructor. URLs are relative to the document's.
    static Ref<XMLHttpRequest> create(Document&);
    WEBCORE_EXPORT ~XMLHttpRequest();

    // ActiveDOMObject.
    void ref() const final { RefCounted::ref(); }
    void deref() const final { RefCounted::deref(); }

    USING_CAN_MAKE_WEAKPTR(EventTarget);

    // Keep it in 3bits.
    enum State : uint8_t {
        UNSENT = 0,
        OPENED = 1,
        HEADERS_RECEIVED = 2,
        LOADING = 3,
        DONE = 4
    };

    void didReachTimeout();

    enum EventTargetInterfaceType eventTargetInterface() const final { return EventTargetInterfaceType::XMLHttpRequest; }
    ScriptExecutionContext* scriptExecutionContext() const final;

    using SendTypes = Variant<Ref<Document>, Ref<Blob>, Ref<JSC::ArrayBufferView>, Ref<JSC::ArrayBuffer>, Ref<DOMFormData>, String, Ref<URLSearchParams>>;

    const URL& url() const LIFETIME_BOUND { return m_url; }
    String statusText() const;
    int status() const;
    State readyState() const { return m_readyState; }
    bool withCredentials() const { return m_includeCredentials; }
    ExceptionOr<void> setWithCredentials(bool);
    ExceptionOr<void> open(const String& method, const String& url);
    ExceptionOr<void> open(const String& method, const URL&, bool async);
    ExceptionOr<void> open(const String& method, const String&, bool async, const String& user, const String& password);
    ExceptionOr<void> send(std::optional<SendTypes>&&);
    void abort();
    ExceptionOr<void> setRequestHeader(const String& name, const String& value);
    ExceptionOr<void> overrideMimeType(const String& override);
    bool doneWithoutErrors() const { return !m_error && readyState() == DONE; }
    String getAllResponseHeaders() const;
    String getResponseHeader(const String& name) const;
    ExceptionOr<OwnedString> responseText();
    String responseTextIgnoringResponseType() const { return m_responseBuilder.toStringPreserveCapacity(); }
    enum class FinalMIMEType : bool { No, Yes };
    String responseMIMEType(FinalMIMEType = FinalMIMEType::No) const;

    ExceptionOr<Document*> responseXML();

    BlobRefPtr createResponseBlob();
    RefPtr<JSC::ArrayBuffer> createResponseArrayBuffer();

    unsigned timeout() const { return m_timeoutMilliseconds; }
    ExceptionOr<void> setTimeout(unsigned);

    bool responseCacheIsValid() const { return m_responseCacheIsValid; }
    void didCacheResponse();

    // Keep it in 3bits.
    enum class ResponseType : uint8_t {
        EmptyString = 0,
        Arraybuffer = 1,
        Blob = 2,
        Document = 3,
        Json = 4,
        Text = 5,
    };
    ExceptionOr<void> setResponseType(ResponseType);
    ResponseType responseType() const { return m_responseType; }

    String responseURL() const;

    XMLHttpRequestUpload& upload();

    Document* document() const { return m_document.get(); }

    size_t LEGACY_NODELETE memoryCost() const;

    template<typename Visitor> void visitAdditionalChildrenInGCThread(Visitor&);

private:
    friend class XMLHttpRequestLoader;
    friend class XMLHttpRequestUpload;
    XMLHttpRequest(ScriptExecutionContext&, Document*);

    void updateHasRelevantEventListener();

    // EventTarget.
    void eventListenersDidChange() final;

    String finalResponseCharset() const;

    // ActiveDOMObject
    void contextDestroyed() override;
    void stop() override;
    bool virtualHasPendingActivity() const final;

    void refEventTarget() override { ref(); }
    void derefEventTarget() override { deref(); }

    URL encodingParseURL(const String&) const;

    // XMLHttpRequestLoader calls these.
    void didSendData(unsigned long long bytesSent, unsigned long long totalBytesToBeSent);
    void didReceiveResponse(XMLHttpRequestLoader::Response&&);
    void didReceiveData(std::span<const uint8_t>);
    void didFinishLoading();
    void didFail();

    std::optional<ExceptionOr<void>> prepareToSend();
    ExceptionOr<void> send(Ref<URLSearchParams>&&);
    ExceptionOr<void> send(Ref<Document>&&);
    ExceptionOr<void> send(String&& = { });
    ExceptionOr<void> send(Ref<Blob>&&);
    ExceptionOr<void> send(Ref<DOMFormData>&&);
    ExceptionOr<void> send(Ref<JSC::ArrayBuffer>&&);
    ExceptionOr<void> send(Ref<JSC::ArrayBufferView>&&);
    ExceptionOr<void> sendStringData(String&&, const String& defaultContentType);
    ExceptionOr<void> sendBytesData(std::span<const uint8_t>);

    void changeState(State);
    void callReadyStateChangeListener();

    // Returns false when cancelling the loader within internalAbort() triggers an event whose callback creates a new loader. 
    // In that case, the function calling internalAbort should exit.
    bool internalAbort();

    void clearResponse();
    void clearResponseBuffers();
    void clearRequest();

    ExceptionOr<void> createRequest();

    void timeoutTimerFired();

    void genericError();
    void networkError();

    void dispatchErrorEvents(const AtomString&);

    Ref<XMLHttpRequestTextDecoder> createDecoder() const;

    bool m_async : 1 { true };
    bool m_includeCredentials : 1 { false };
    bool m_sendFlag : 1 { false };
    bool m_createdDocument : 1 { false };
    bool m_error : 1 { false };
    bool m_uploadListenerFlag : 1 { false };
    bool m_uploadComplete : 1 { false };
    bool m_responseCacheIsValid : 1 { false };
    State m_readyState : 3 { UNSENT };
    ResponseType m_responseType : 3 { ResponseType::EmptyString };

    unsigned m_timeoutMilliseconds { 0 };

    Lock m_gcLock;
    const std::unique_ptr<XMLHttpRequestUpload> m_upload WTF_GUARDED_BY_LOCK(m_gcLock);

    const RefPtr<Document> m_document;
    URL m_url;
    String m_method;
    HTTPHeaderMap m_requestHeaders;
    BlobRefPtr m_requestEntityBody;
    String m_mimeTypeOverride;

    struct LoadingActivity {
        Ref<XMLHttpRequest> protectedThis; // Keep object alive while loading even if there is no longer a JS wrapper.
        Ref<XMLHttpRequestLoader> loader;
    };
    std::optional<LoadingActivity> m_loadingActivity;

    XMLHttpRequestLoader::Response m_response;

    RefPtr<XMLHttpRequestTextDecoder> m_decoder;

    RefPtr<Document> m_responseDocument WTF_GUARDED_BY_LOCK(m_gcLock);

    Vector<uint8_t> m_binaryResponseBuilder;

    StringBuilder m_responseBuilder;

    // Used for progress event tracking.
    long long m_receivedLength { 0 };

    const UniqueRef<XMLHttpRequestProgressEventThrottle> m_progressEventThrottle;

    mutable String m_allResponseHeaders;

    RunLoop::Timer m_timeoutTimer;

    MonotonicTime m_sendingTime;

    std::optional<ExceptionCode> m_exceptionCode;
    bool m_hasRelevantEventListener { false };
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_EVENTTARGET(XMLHttpRequest)
