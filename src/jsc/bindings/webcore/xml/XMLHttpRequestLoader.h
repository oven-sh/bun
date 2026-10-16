#pragma once

#include "HTTPHeaderMap.h"
#include "Window.h"
#include "blob.h"
#include <JavaScriptCore/Strong.h>
#include <wtf/RefCounted.h>
#include <wtf/URL.h>
#include <wtf/WeakPtr.h>

namespace JSC {
class JSPromise;
}

namespace WebCore {

class AbortSignal;
class DOMFormData;
class ScriptExecutionContext;
class XMLHttpRequest;

// Stands where upstream has ThreadableLoader, ResourceRequest, ResourceResponse and FormData: the request goes out through Bun's fetch().
// It calls the function behind `fetch` and reads the `Response` natively, so nothing that script replaces is in the way.
class XMLHttpRequestLoader final : public RefCounted<XMLHttpRequestLoader> {
public:
    // The body of a request is always one of Bun's blobs.
    static BlobRefPtr createBlob(ScriptExecutionContext&, std::span<const uint8_t>, const String& type = { });
    // Null if a file in the form cannot be read.
    static BlobRefPtr createMultiPartBlob(ScriptExecutionContext&, DOMFormData&);
    static String blobType(ScriptExecutionContext&, BlobImpl&);
    static unsigned long long blobLength(BlobImpl&);

    struct Request {
        URL url;
        String method;
        HTTPHeaderMap headers;
        BlobRefPtr body;
    };

    // The members that XMLHttpRequest reads, under the names they have in ResourceResponse.
    class Response {
    public:
        Response() = default;
        Response(URL&&, int statusCode, String&& statusText, HTTPHeaderMap&&);

        const URL& url() const LIFETIME_BOUND { return m_url; }
        int httpStatusCode() const { return m_httpStatusCode; }
        const String& httpStatusText() const LIFETIME_BOUND { return m_httpStatusText; }
        const HTTPHeaderMap& httpHeaderFields() const LIFETIME_BOUND { return m_httpHeaderFields; }
        String httpHeaderField(StringView name) const { return m_httpHeaderFields.get(name); }
        String httpHeaderField(HTTPHeaderName name) const { return m_httpHeaderFields.get(name); }
        const String& textEncodingName() const LIFETIME_BOUND { return m_textEncodingName; }
        long long expectedContentLength() const { return m_expectedContentLength; }

    private:
        URL m_url;
        int m_httpStatusCode { 0 };
        String m_httpStatusText;
        HTTPHeaderMap m_httpHeaderFields;
        String m_textEncodingName;
        long long m_expectedContentLength { -1 };
    };

    // Null if the request cannot start. The client has then been told that it failed.
    static RefPtr<XMLHttpRequestLoader> create(XMLHttpRequest&, Request&&);
    ~XMLHttpRequestLoader();

    // The client hears nothing more.
    void cancel();

private:
    explicit XMLHttpRequestLoader(XMLHttpRequest&);

    bool start(Request&&);
    void whenSettled(JSDOMGlobalObject&, JSC::JSPromise&, void (XMLHttpRequestLoader::*)(JSDOMGlobalObject&, JSC::JSPromise&));
    void didSettleFetch(JSDOMGlobalObject&, JSC::JSPromise&);
    void read(JSDOMGlobalObject&);
    void didSettleRead(JSDOMGlobalObject&, JSC::JSPromise&);
    void finish();
    void fail();
    RefPtr<XMLHttpRequest> releaseClient();

    WeakPtr<XMLHttpRequest, WeakPtrImplWithEventTargetData> m_client;
    RefPtr<ScriptExecutionContext> m_contextWithEventLoopRef;
    std::optional<Window::PendingTask> m_pendingTask;
    RefPtr<AbortSignal> m_signal;
    JSC::Strong<JSC::JSObject> m_reader;
    std::optional<unsigned long long> m_bodyLength;
};

} // namespace WebCore
