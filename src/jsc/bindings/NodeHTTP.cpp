#include "root.h"
#include "JSDOMGlobalObjectInlines.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/GlobalObjectMethodTable.h>
#include "helpers.h"
#include "BunClientData.h"

#include <JavaScriptCore/AggregateError.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/JSFunction.h>
#include "JSFetchHeaders.h"
#include "HTTPLatin1String.h"
#include <bun-uws/src/App.h>
#include <bun-uws/src/Http3Response.h>
#include <bun-uws/src/Http2Context.h>
#include "ZigGeneratedClasses.h"
#include "ScriptExecutionContext.h"
#include "AsyncContextFrame.h"
#include "ZigGeneratedClasses.h"
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include "JSSocketAddressDTO.h"
#include "node/JSNodeHTTPServerSocket.h"
#include "node/JSNodeHTTPServerSocketPrototype.h"
namespace Bun {

using namespace JSC;
using namespace WebCore;

BUN_DECLARE_HOST_FUNCTION(Bun__drainMicrotasksFromJS);
extern "C" EncodedJSValue Server__setAppFlags(JSC::JSGlobalObject*, EncodedJSValue, bool require_host_header, bool use_strict_method_validation, uint8_t lenient_http_flags, bool http_allow_half_open);
extern "C" EncodedJSValue Server__setOnClientError(JSC::JSGlobalObject*, EncodedJSValue, EncodedJSValue);
extern "C" EncodedJSValue Server__setOnConnection(JSC::JSGlobalObject*, EncodedJSValue, EncodedJSValue);
extern "C" EncodedJSValue Server__setMaxHTTPHeaderSize(JSC::JSGlobalObject*, EncodedJSValue, uint64_t);

// Bit layout must stay in sync with kDispatchBits* in src/js/node/_http_server.ts.
static constexpr uint32_t kDispatchConnClose = 1 << 0;
static constexpr uint32_t kDispatchConnUpgrade = 1 << 1;
static constexpr uint32_t kDispatchHasUpgrade = 1 << 2;
static constexpr uint32_t kDispatchHasHost = 1 << 3;
static constexpr uint32_t kDispatchHasExpect = 1 << 4;
static constexpr uint32_t kDispatchExpectContinue = 1 << 5;
static constexpr uint32_t kDispatchHasContentLength = 1 << 6;
static constexpr uint32_t kDispatchHasTransferEncoding = 1 << 7;

static bool svEqualsIgnoreCase(std::string_view a, std::string_view lower)
{
    if (a.length() != lower.length())
        return false;
    for (size_t i = 0; i < a.length(); i++) {
        if ((static_cast<unsigned char>(a[i]) | 0x20) != static_cast<unsigned char>(lower[i]))
            return false;
    }
    return true;
}

// `1#token` list scan (RFC 9110): does `value` contain `lowerToken` at
// non-alphanumeric boundaries, ASCII-case-insensitively? Mirrors the
// /(?:^|\W)tok(?:$|\W)/i checks node:http uses for Connection/Expect values.
static bool svValueHasToken(std::string_view value, std::string_view lowerToken)
{
    const size_t n = value.length(), m = lowerToken.length();
    if (m == 0 || n < m)
        return false;
    for (size_t i = 0; i + m <= n; i++) {
        if ((static_cast<unsigned char>(value[i]) | 0x20) != static_cast<unsigned char>(lowerToken[0]))
            continue;
        if (!svEqualsIgnoreCase(value.substr(i, m), lowerToken))
            continue;
        // \W in the JS regexes this mirrors treats '_' as a word character.
        bool leftOk = i == 0 || !(isASCIIAlphanumeric(value[i - 1]) || value[i - 1] == '_');
        size_t end = i + m;
        bool rightOk = end >= n || !(isASCIIAlphanumeric(value[end]) || value[end] == '_');
        if (leftOk && rightOk)
            return true;
        i = end - 1;
    }
    return false;
}

// One pass over the request: append url, method and jsNumber(dispatch
// bitfield) to `args`, and capture the raw header bytes into `flatHeaders`
// as [u32 nameLen][u32 valueLen][name][value]... so req.rawHeaders /
// req.headers can be materialized lazily (Bun__NodeHTTP__buildRawHeadersArray)
// only when user code reads them.
static void assignHeadersFromUWebSocketsForCall(uWS::HttpRequest* request, JSValue methodString, MarkedArgumentBuffer& args, WTF::Vector<uint8_t, 1024>& flatHeaders, JSC::JSGlobalObject* globalObject, JSC::VM& vm)
{
    {
        std::string_view fullURLStdStr = request->getFullUrl();
        String fullURL = String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const Latin1Character*>(fullURLStdStr.data()), fullURLStdStr.length() });
        args.append(jsString(vm, WTF::move(fullURL)));
    }

    // Get the method.
    if (methodString.isUndefinedOrNull()) [[unlikely]] {
        std::string_view methodView = request->getMethod();
        WTF::String methodString = String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const Latin1Character*>(methodView.data()), methodView.length() });
        args.append(jsString(vm, WTF::move(methodString)));
    } else {
        args.append(methodString);
    }

    // Deliberate: the bitfield scans every header the parser accepted, like
    // the parser's own Host/Expect handling, while req.rawHeaders/req.headers
    // still apply the server.maxHeadersCount truncation on materialization.
    uint32_t bits = 0;
    for (auto it = request->begin(); it != request->end(); ++it) {
        auto pair = *it;
        const std::string_view name = pair.first;
        const std::string_view value = pair.second;

        // u32 length prefixes: header sizes are usually tiny, but maxHeaderSize
        // is user-configurable with no upper bound, so a u16 would silently
        // truncate a >64 KiB value and desync the buffer.
        const uint32_t nameLen = static_cast<uint32_t>(name.length());
        const uint32_t valueLen = static_cast<uint32_t>(value.length());
        uint8_t lens[8] = {
            static_cast<uint8_t>(nameLen & 0xff), static_cast<uint8_t>((nameLen >> 8) & 0xff),
            static_cast<uint8_t>((nameLen >> 16) & 0xff), static_cast<uint8_t>(nameLen >> 24),
            static_cast<uint8_t>(valueLen & 0xff), static_cast<uint8_t>((valueLen >> 8) & 0xff),
            static_cast<uint8_t>((valueLen >> 16) & 0xff), static_cast<uint8_t>(valueLen >> 24)
        };
        flatHeaders.append(std::span<const uint8_t> { lens, 8 });
        flatHeaders.append(std::span<const uint8_t> { reinterpret_cast<const uint8_t*>(name.data()), name.length() });
        flatHeaders.append(std::span<const uint8_t> { reinterpret_cast<const uint8_t*>(value.data()), value.length() });

        // Duplicate headers OR their token bits (the lazy header build joins
        // duplicates with ", ", and a token match on the joined value is a
        // token match on one of the parts).
        switch (name.length()) {
        case 4:
            if (svEqualsIgnoreCase(name, "host"))
                bits |= kDispatchHasHost;
            break;
        case 6:
            if (svEqualsIgnoreCase(name, "expect")) {
                bits |= kDispatchHasExpect;
                if (svValueHasToken(value, "100-continue"))
                    bits |= kDispatchExpectContinue;
            }
            break;
        case 7:
            if (svEqualsIgnoreCase(name, "upgrade"))
                bits |= kDispatchHasUpgrade;
            break;
        case 10:
            if (svEqualsIgnoreCase(name, "connection")) {
                if (svValueHasToken(value, "close"))
                    bits |= kDispatchConnClose;
                if (svValueHasToken(value, "upgrade"))
                    bits |= kDispatchConnUpgrade;
            }
            break;
        case 14:
            if (svEqualsIgnoreCase(name, "content-length"))
                bits |= kDispatchHasContentLength;
            break;
        case 17:
            if (svEqualsIgnoreCase(name, "transfer-encoding"))
                bits |= kDispatchHasTransferEncoding;
            break;
        }
    }

    // The headers-object slot now carries the dispatch bitfield; rawHeaders
    // materialize lazily from the captured bytes, so no array is passed.
    args.append(jsNumber(bits));
}

// Builds the rawHeaders flat array [name, value, ...] from the bytes captured
// by assignHeadersFromUWebSocketsForCall. Runs only when user code first
// touches req.rawHeaders / req.headers (via NodeHTTPResponse.takeRawHeaders).
extern "C" EncodedJSValue Bun__NodeHTTP__buildRawHeadersArray(JSC::JSGlobalObject* globalObject, const uint8_t* data, size_t length)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    MarkedArgumentBuffer arrayValues;
    HTTPHeaderIdentifiers& identifiers = WebCore::clientData(vm)->httpHeaderIdentifiers();

    size_t offset = 0;
    while (offset + 8 <= length) {
        const uint32_t nameLen = static_cast<uint32_t>(data[offset]) | (static_cast<uint32_t>(data[offset + 1]) << 8)
            | (static_cast<uint32_t>(data[offset + 2]) << 16) | (static_cast<uint32_t>(data[offset + 3]) << 24);
        const uint32_t valueLen = static_cast<uint32_t>(data[offset + 4]) | (static_cast<uint32_t>(data[offset + 5]) << 8)
            | (static_cast<uint32_t>(data[offset + 6]) << 16) | (static_cast<uint32_t>(data[offset + 7]) << 24);
        offset += 8;
        if (offset + nameLen + valueLen > length) [[unlikely]]
            break;
        StringView nameView = StringView(std::span { reinterpret_cast<const Latin1Character*>(data + offset), nameLen });
        offset += nameLen;

        std::span<Latin1Character> valueData;
        auto value = String::createUninitialized(valueLen, valueData);
        if (valueLen > 0)
            memcpy(valueData.data(), data + offset, valueLen);
        offset += valueLen;

        HTTPHeaderName name;
        JSString* jsValue = jsString(vm, value);
        JSString* nameString = nullptr;

        if (WebCore::findHTTPHeaderName(nameView, name)) {
            // rawHeaders keeps the wire casing; reuse the cached (lowercase)
            // string only when the client already sent it lowercased.
            const auto& cachedName = WTF::httpHeaderNameStringImpl(name);
            if (nameView == StringView(cachedName)) {
                nameString = identifiers.stringFor(globalObject, name);
            } else {
                nameString = jsString(vm, nameView.toString());
            }
        } else {
            nameString = jsString(vm, nameView.toString());
        }

        arrayValues.append(nameString);
        arrayValues.append(jsValue);
    }

    JSC::JSArray* array;
    {
        ObjectInitializationScope initializationScope(vm);
        if ((array = JSArray::tryCreateUninitializedRestricted(initializationScope, nullptr, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), arrayValues.size()))) [[likely]] {
            EncodedJSValue* argValues = arrayValues.data();
            for (size_t i = 0, size = arrayValues.size(); i < size; ++i) {
                array->initializeIndex(initializationScope, i, JSValue::decode(argValues[i]));
            }
        } else {
            array = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), arrayValues);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(array));
}

// Defined in Rust (NodeHTTPResponse.rs): moves the captured raw header bytes
// onto the native response so takeRawHeaders can materialize them on demand.
extern "C" void NodeHTTPResponse__adoptRawRequestHeaders(void* nodeHttpResponse, const uint8_t* data, size_t length);

template<bool isSSL>
static void assignOnNodeJSCompat(uWS::TemplatedApp<isSSL>* app)
{
    app->enableNodeHttpCompat();
    app->setOnSocketClosed([](void* socketData, int is_ssl, struct us_socket_t* rawSocket) -> void {
        auto* socket = reinterpret_cast<JSNodeHTTPServerSocket*>(socketData);
        ASSERT(rawSocket == socket->socket || socket->socket == nullptr);
        socket->onClose();
    });
    app->setOnSocketDrain([](void* socketData, int is_ssl, struct us_socket_t* rawSocket) -> void {
        auto* socket = reinterpret_cast<JSNodeHTTPServerSocket*>(socketData);
        ASSERT(rawSocket == socket->socket || socket->socket == nullptr);
        socket->onDrain();
    });
    app->setOnSocketData([](void* socketData, int is_ssl, struct us_socket_t* rawSocket, const char* data, int length, bool last) -> void {
        auto* socket = reinterpret_cast<JSNodeHTTPServerSocket*>(socketData);
        ASSERT(rawSocket == socket->socket || socket->socket == nullptr);
        socket->onData(data, length, last);
    });
    app->setOnSocketUpgraded([](void* socketData, int is_ssl, struct us_socket_t* rawSocket) -> void {
        auto* socket = reinterpret_cast<JSNodeHTTPServerSocket*>(socketData);
        // the socket is adopted and might not be the same as the rawSocket
        socket->socket = rawSocket;
        socket->upgraded = true;
    });
}

extern "C" void NodeHTTP_assignOnNodeJSCompat(bool is_ssl, void* uws_app)
{
    if (is_ssl) {
        assignOnNodeJSCompat<true>(reinterpret_cast<uWS::TemplatedApp<true>*>(uws_app));
    } else {
        assignOnNodeJSCompat<false>(reinterpret_cast<uWS::TemplatedApp<false>*>(uws_app));
    }
}

extern "C" void NodeHTTP_setUsingCustomExpectHandler(bool is_ssl, void* uws_app, bool value)
{
    if (is_ssl) {
        reinterpret_cast<uWS::TemplatedApp<true>*>(uws_app)->setUsingCustomExpectHandler(value);
    } else {
        reinterpret_cast<uWS::TemplatedApp<false>*>(uws_app)->setUsingCustomExpectHandler(value);
    }
}

template<bool isSSL>
static EncodedJSValue NodeHTTPServer__onRequest(
    Zig::GlobalObject* globalObject,
    JSValue thisValue,
    JSValue callback,
    JSValue methodString,
    uWS::HttpRequest* request,
    uWS::HttpResponse<isSSL>* response,
    JSValue nodeResponseObject,
    bool hasBody)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* callbackObject = uncheckedDowncast<JSObject>(callback);
    MarkedArgumentBuffer args;
    args.append(thisValue);

    // Typical request header sections are a few hundred bytes; the inline
    // capacity keeps the capture heap-allocation-free for the common case.
    WTF::Vector<uint8_t, 1024> flatHeaders;
    assignHeadersFromUWebSocketsForCall(request, methodString, args, flatHeaders, globalObject, vm);

    WebCore::JSNodeHTTPResponse* nodeHTTPResponseObject = uncheckedDowncast<WebCore::JSNodeHTTPResponse>(nodeResponseObject);
    if (!flatHeaders.isEmpty()) {
        NodeHTTPResponse__adoptRawRequestHeaders(nodeHTTPResponseObject->wrapped(), flatHeaders.span().data(), flatHeaders.size());
    }

    args.append(nodeHTTPResponseObject);
    args.append(jsBoolean(hasBody));

    auto* httpResponseData = response->getHttpResponseData();
    // HTTP/1.1 pipelining: this request arrived while an earlier response on
    // the connection is still in flight. It is queued on the server socket
    // (and in JS) instead of becoming the connection's current response.
    const bool isPipelinedDispatch = (httpResponseData->state & uWS::HttpResponseData<isSSL>::HTTP_NODE_PIPELINED_DISPATCH) != 0;
    auto* currentSocketDataPtr = reinterpret_cast<JSC::JSCell*>(httpResponseData->socketData);

    if (currentSocketDataPtr) {
        auto* thisSocket = uncheckedDowncast<JSNodeHTTPServerSocket>(currentSocketDataPtr);
        if (isPipelinedDispatch) {
            thisSocket->appendPipelinedResponse(vm, nodeHTTPResponseObject);
        } else {
            thisSocket->currentResponseObject.set(vm, thisSocket, nodeHTTPResponseObject);
        }
        args.append(thisSocket);
        args.append(jsBoolean(false));
        if (thisSocket->m_duplex) {
            args.append(thisSocket->m_duplex.get());
        } else {
            args.append(jsUndefined());
        }
    } else {
        JSNodeHTTPServerSocket* socket = JSNodeHTTPServerSocket::create(vm, globalObject->m_JSNodeHTTPServerSocketStructure.getInitializedOnMainThread(globalObject), (us_socket_t*)response, isSSL, nodeHTTPResponseObject);

        socket->strongThis.set(vm, socket);

        response->getHttpResponseData()->socketData = socket;

        args.append(socket);
        args.append(jsBoolean(true));
        args.append(jsUndefined());
    }
    args.append(jsBoolean(request->isAncient()));

    // Pass pipelined data (head buffer) for Node.js compat (connect/upgrade events)
    if (!request->head.empty()) {
        JSC::JSUint8Array* headBuffer = WebCore::createBuffer(globalObject, std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(request->head.data()), request->head.size()));
        RETURN_IF_EXCEPTION(scope, {});
        args.append(headBuffer);
    } else {
        args.append(jsUndefined());
    }

    args.append(jsBoolean(isPipelinedDispatch));

    JSValue returnValue = AsyncContextFrame::profiledCall(globalObject, callbackObject, jsUndefined(), args);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(returnValue);
}

template<bool isSSL>
static void writeResponseHeader(uWS::HttpResponse<isSSL>* res, const WTF::StringView& name, const WTF::StringView& value)
{
    ASSERT(name.containsOnlyASCII());
    HTTPLatin1String nameBytes(name);
    HTTPLatin1String valueBytes(value);
    res->writeHeader(nameBytes.view(), valueBytes.view());
}

// Connection is `1#connection-option` (RFC 9112 §9.3): look for the "close"
// token anywhere in a comma-separated list. Mirrors the /(?:^|\W)close(?:$|\W)/i
// check used by Bun's node:http layer.
static bool connectionValueHasClose(const WTF::String& value)
{
    size_t pos = 0;
    while ((pos = value.findIgnoringASCIICase("close"_s, pos)) != WTF::notFound) {
        bool leftOk = pos == 0 || !isASCIIAlphanumeric(value[pos - 1]);
        size_t end = pos + 5;
        bool rightOk = end >= value.length() || !isASCIIAlphanumeric(value[end]);
        if (leftOk && rightOk)
            return true;
        pos = end;
    }
    return false;
}

template<bool isSSL>
static void writeFetchHeadersToUWSResponse(WebCore::FetchHeaders& headers, uWS::HttpResponse<isSSL>* res)
{
    auto& internalHeaders = headers.internalHeaders();

    for (auto& value : internalHeaders.getSetCookieHeaders()) {
        HTTPLatin1String valueBytes(value);
        res->writeHeader(std::string_view("set-cookie", 10), valueBytes.view());
    }

    auto* data = res->getHttpResponseData();

    for (const auto& header : internalHeaders.commonHeaders()) {

        const auto& name = WebCore::httpHeaderNameString(header.key);
        const auto& value = header.value;

        // We have to tell uWS not to automatically insert a TransferEncoding or Date header.
        // Otherwise, you get this when using Fastify;
        //
        // ❯ curl http://localhost:3000 --verbose
        // *   Trying [::1]:3000...
        // * Connected to localhost (::1) port 3000
        // > GET / HTTP/1.1
        // > Host: localhost:3000
        // > User-Agent: curl/8.4.0
        // > Accept: */*
        // >
        // < HTTP/1.1 200 OK
        // < Content-Type: application/json; charset=utf-8
        // < Content-Length: 17
        // < Date: Sun, 06 Oct 2024 13:37:01 GMT
        // < Transfer-Encoding: chunked
        // <
        //
        if (header.key == WebCore::HTTPHeaderName::ContentLength) {
            if (!(data->state & uWS::HttpResponseData<isSSL>::HTTP_WROTE_CONTENT_LENGTH_HEADER)) {
                data->state |= uWS::HttpResponseData<isSSL>::HTTP_WROTE_CONTENT_LENGTH_HEADER;
                res->writeMark();
            }
        }

        // Prevent automatic Date header insertion when user provides one
        if (header.key == WebCore::HTTPHeaderName::Date) {
            data->state |= uWS::HttpResponseData<isSSL>::HTTP_WROTE_DATE_HEADER;
        }

        // Prevent automatic Transfer-Encoding: chunked insertion when user provides one
        if (header.key == WebCore::HTTPHeaderName::TransferEncoding) {
            data->state |= uWS::HttpResponseData<isSSL>::HTTP_WROTE_TRANSFER_ENCODING_HEADER;
        }

        // RFC 9112 §9.6: a server that sends the "close" connection option MUST
        // close the connection after the response. Mark the uWS state so
        // end()/tryEnd() shut the socket down instead of returning it to the
        // keep-alive pool.
        if (header.key == WebCore::HTTPHeaderName::Connection && connectionValueHasClose(value)) {
            data->state |= uWS::HttpResponseData<isSSL>::HTTP_CONNECTION_CLOSE;
        }
        writeResponseHeader<isSSL>(res, name, value);
    }

    for (auto& header : internalHeaders.uncommonHeaders()) {
        const auto& name = header.key;
        const auto& value = header.value;

        writeResponseHeader<isSSL>(res, name, value);
    }
}

// Auto-header bits (kAutoHeader* in src/js/node/_http_server.ts - keep in
// sync). The JS side passes these instead of pushing the corresponding
// framework headers into the flat array, so the per-request cost is two
// integers instead of up to six string conversions.
static constexpr uint32_t kAutoHeaderDate = 1 << 0;
static constexpr uint32_t kAutoHeaderConnKeepAlive = 1 << 1;
static constexpr uint32_t kAutoHeaderConnClose = 1 << 2;
static constexpr uint32_t kAutoHeaderKeepAliveTimeout = 1 << 3;
// Node's _storeHeader emits chunked Transfer-Encoding after Connection/Keep-Alive, so it
// cannot ride in the flat array (written first). Carry as an auto-header bit, rendered last.
static constexpr uint32_t kAutoHeaderTransferEncodingChunked = 1 << 4;

// "Date: <IMF-fixdate>\r\n", rebuilt at most once per second. Hand-rolled
// (not strftime) so the day/month names are locale-independent.
static std::string_view cachedDateHeaderLine()
{
    static thread_local time_t cachedSecond = 0;
    static thread_local char buf[48];
    static thread_local size_t len = 0;
    time_t now = time(nullptr);
    if (now != cachedSecond) {
        cachedSecond = now;
        struct tm t;
#ifdef _WIN32
        gmtime_s(&t, &now);
#else
        gmtime_r(&now, &t);
#endif
        static constexpr const char days[7][4] = { "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat" };
        static constexpr const char months[12][4] = { "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" };
        len = static_cast<size_t>(snprintf(buf, sizeof(buf), "Date: %s, %02d %s %04d %02d:%02d:%02d GMT\r\n",
            days[t.tm_wday], t.tm_mday, months[t.tm_mon], t.tm_year + 1900, t.tm_hour, t.tm_min, t.tm_sec));
    }
    return { buf, len };
}

// "Connection: keep-alive\r\nKeep-Alive: timeout=N\r\n" as one buffer write;
// N is a per-server constant, so cache the rendered blob by value.
static std::string_view keepAliveHeaderBlob(uint32_t timeoutSecs)
{
    static thread_local uint32_t cachedTimeout = ~0u;
    static thread_local char buf[64];
    static thread_local size_t len = 0;
    if (timeoutSecs != cachedTimeout) {
        cachedTimeout = timeoutSecs;
        len = static_cast<size_t>(snprintf(buf, sizeof(buf), "Connection: keep-alive\r\nKeep-Alive: timeout=%u\r\n", timeoutSecs));
    }
    return { buf, len };
}

template<bool isSSL>
static void writeAutoHeaders(uWS::HttpResponse<isSSL>* response, uint32_t autoHeaderBits, uint32_t keepAliveTimeoutSecs)
{
    if (autoHeaderBits & kAutoHeaderDate) {
        auto line = cachedDateHeaderLine();
        response->uWS::template AsyncSocket<isSSL>::write(line.data(), (int)line.length());
    }
    if (autoHeaderBits & kAutoHeaderConnKeepAlive) {
        if (autoHeaderBits & kAutoHeaderKeepAliveTimeout) {
            auto blob = keepAliveHeaderBlob(keepAliveTimeoutSecs);
            response->uWS::template AsyncSocket<isSSL>::write(blob.data(), (int)blob.length());
        } else {
            static constexpr const char ka[] = "Connection: keep-alive\r\n";
            response->uWS::template AsyncSocket<isSSL>::write(ka, sizeof(ka) - 1);
        }
    } else if (autoHeaderBits & kAutoHeaderConnClose) {
        static constexpr const char cl[] = "Connection: close\r\n";
        response->uWS::template AsyncSocket<isSSL>::write(cl, sizeof(cl) - 1);
    }
    if (autoHeaderBits & kAutoHeaderTransferEncodingChunked) {
        static constexpr const char te[] = "Transfer-Encoding: chunked\r\n";
        response->uWS::template AsyncSocket<isSSL>::write(te, sizeof(te) - 1);
        // Same state the flat-array path sets when it sees the header, so uWS
        // chunk-frames the body.
        response->getHttpResponseData()->state |= uWS::HttpResponseData<isSSL>::HTTP_WROTE_TRANSFER_ENCODING_HEADER;
    }
}

template<bool isSSL>
static void NodeHTTPServer__writeHead(
    JSC::JSGlobalObject* globalObject,
    const char* statusMessage,
    size_t statusMessageLength,
    JSValue headersObjectValue,
    uint32_t autoHeaderBits,
    uint32_t keepAliveTimeoutSecs,
    uWS::HttpResponse<isSSL>* response)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* headersObject = headersObjectValue.getObject();
    if (!response->uWS::template AsyncSocket<isSSL>::isCorked() && response->getBufferedAmount() == 0) {
        response->uWS::template AsyncSocket<isSSL>::cork();
    }
    response->writeStatus(std::string_view(statusMessage, statusMessageLength));

    // node:http's ServerResponse owns the Date header entirely (it honors
    // res.sendDate / removeHeader("date") in JS), so never let uWS write its
    // own Date header for these responses.
    response->getHttpResponseData()->state |= uWS::HttpResponseData<isSSL>::HTTP_WROTE_DATE_HEADER;

    // 204/304 responses must not carry any body framing, even when the user
    // explicitly set a Transfer-Encoding header (Node.js suppresses the
    // chunked framing and closes the connection for those).
    if (statusMessageLength >= 3 && (memcmp(statusMessage, "204", 3) == 0 || memcmp(statusMessage, "304", 3) == 0)
        && (statusMessageLength == 3 || statusMessage[3] == ' ')) {
        response->getHttpResponseData()->state |= uWS::HttpResponseData<isSSL>::HTTP_NO_BODY_STATUS;
    }

    if (headersObject) {
        if (auto* fetchHeaders = dynamicDowncast<WebCore::JSFetchHeaders>(headersObject)) {
            writeFetchHeadersToUWSResponse<isSSL>(fetchHeaders->wrapped(), response);
            RETURN_IF_EXCEPTION(scope, void());
            if (autoHeaderBits) writeAutoHeaders<isSSL>(response, autoHeaderBits, keepAliveTimeoutSecs);
            return;
        }

        // A flat [name, value, name, value, ...] array. Used by node:http's
        // ServerResponse so that repeated header names (multiple Set-Cookie or
        // duplicate Content-Length values, etc.) are written as separate
        // header lines exactly as Node.js does.
        if (auto* pairsArray = dynamicDowncast<JSC::JSArray>(headersObject)) {
            auto* httpResponseData = response->getHttpResponseData();
            unsigned length = pairsArray->length();
            for (unsigned i = 0; i + 1 < length; i += 2) {
                JSValue nameValue = pairsArray->getIndex(globalObject, i);
                RETURN_IF_EXCEPTION(scope, void());
                JSValue headerValue = pairsArray->getIndex(globalObject, i + 1);
                RETURN_IF_EXCEPTION(scope, void());

                String name = nameValue.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, void());
                String value = headerValue.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, void());

                // node:http marks framing decisions with a NUL-named sentinel
                // pair instead of a real header: value "1" = close-delimited
                // (the user removed the framing headers), value "2" = no body
                // (HEAD - suppress all body framing like 204/304).
                if (name.length() == 1 && name[0] == 0) {
                    if (value == "2"_s) {
                        httpResponseData->state |= uWS::HttpResponseData<isSSL>::HTTP_NO_BODY_STATUS;
                    } else {
                        httpResponseData->state |= uWS::HttpResponseData<isSSL>::HTTP_CLOSE_DELIMITED;
                    }
                    continue;
                }

                WebCore::HTTPHeaderName headerName;
                if (WebCore::findHTTPHeaderName(StringView(name), headerName)) {
                    if (headerName == WebCore::HTTPHeaderName::ContentLength) {
                        if (!(httpResponseData->state & uWS::HttpResponseData<isSSL>::HTTP_WROTE_CONTENT_LENGTH_HEADER)) {
                            httpResponseData->state |= uWS::HttpResponseData<isSSL>::HTTP_WROTE_CONTENT_LENGTH_HEADER;
                            response->writeMark();
                        }
                    } else if (headerName == WebCore::HTTPHeaderName::Date) {
                        httpResponseData->state |= uWS::HttpResponseData<isSSL>::HTTP_WROTE_DATE_HEADER;
                    } else if (headerName == WebCore::HTTPHeaderName::TransferEncoding) {
                        httpResponseData->state |= uWS::HttpResponseData<isSSL>::HTTP_WROTE_TRANSFER_ENCODING_HEADER;
                    }
                }

                writeResponseHeader<isSSL>(response, name, value);
            }
            RETURN_IF_EXCEPTION(scope, void());
            if (autoHeaderBits) writeAutoHeaders<isSSL>(response, autoHeaderBits, keepAliveTimeoutSecs);
            return;
        }

        if (headersObject->hasNonReifiedStaticProperties()) [[unlikely]] {
            headersObject->reifyAllStaticProperties(globalObject);
            RETURN_IF_EXCEPTION(scope, void());
        }

        auto* structure = headersObject->structure();

        if (structure->canPerformFastPropertyEnumeration()) {
            structure->forEachProperty(vm, [&](const auto& entry) {
                JSValue headerValue = headersObject->getDirect(entry.offset());
                if (!headerValue.isString()) {

                    return true;
                }

                String key = entry.key();
                String value = headerValue.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, false);

                writeResponseHeader<isSSL>(response, key, value);

                return true;
            });
        } else {
            PropertyNameArrayBuilder propertyNames(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
            headersObject->getOwnPropertyNames(headersObject, globalObject, propertyNames, DontEnumPropertiesMode::Exclude);
            RETURN_IF_EXCEPTION(scope, void());

            for (unsigned i = 0; i < propertyNames.size(); ++i) {
                JSValue headerValue = headersObject->getIfPropertyExists(globalObject, propertyNames[i]);
                RETURN_IF_EXCEPTION(scope, void());
                if (!headerValue.isString()) {
                    continue;
                }

                String key = propertyNames[i].string();
                String value = headerValue.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, void());

                writeResponseHeader<isSSL>(response, key, value);
            }
        }
    }

    RETURN_IF_EXCEPTION(scope, void());
    if (autoHeaderBits) writeAutoHeaders<isSSL>(response, autoHeaderBits, keepAliveTimeoutSecs);
}

extern "C" void NodeHTTPServer__writeHead_http(
    JSC::JSGlobalObject* globalObject,
    const char* statusMessage,
    size_t statusMessageLength,
    JSValue headersObjectValue,
    uint32_t autoHeaderBits,
    uint32_t keepAliveTimeoutSecs,
    uWS::HttpResponse<false>* response)
{
    NodeHTTPServer__writeHead<false>(globalObject, statusMessage, statusMessageLength, headersObjectValue, autoHeaderBits, keepAliveTimeoutSecs, response);
}

extern "C" void NodeHTTPServer__writeHead_https(
    JSC::JSGlobalObject* globalObject,
    const char* statusMessage,
    size_t statusMessageLength,
    JSValue headersObjectValue,
    uint32_t autoHeaderBits,
    uint32_t keepAliveTimeoutSecs,
    uWS::HttpResponse<true>* response)
{
    NodeHTTPServer__writeHead<true>(globalObject, statusMessage, statusMessageLength, headersObjectValue, autoHeaderBits, keepAliveTimeoutSecs, response);
}

extern "C" EncodedJSValue NodeHTTPServer__onRequest_http(
    Zig::GlobalObject* globalObject,
    EncodedJSValue thisValue,
    EncodedJSValue callback,
    EncodedJSValue methodString,
    uWS::HttpRequest* request,
    uWS::HttpResponse<false>* response,
    EncodedJSValue nodeResponseObject,
    bool hasBody)
{
    return NodeHTTPServer__onRequest<false>(
        globalObject,
        JSValue::decode(thisValue),
        JSValue::decode(callback),
        JSValue::decode(methodString),
        request,
        response,
        JSValue::decode(nodeResponseObject),
        hasBody);
}

extern "C" EncodedJSValue NodeHTTPServer__onRequest_https(
    Zig::GlobalObject* globalObject,
    EncodedJSValue thisValue,
    EncodedJSValue callback,
    EncodedJSValue methodString,
    uWS::HttpRequest* request,
    uWS::HttpResponse<true>* response,
    EncodedJSValue nodeResponseObject,
    bool hasBody)
{
    return NodeHTTPServer__onRequest<true>(
        globalObject,
        JSValue::decode(thisValue),
        JSValue::decode(callback),
        JSValue::decode(methodString),
        request,
        response,
        JSValue::decode(nodeResponseObject),
        hasBody);
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPSetCustomOptions, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(callFrame->argumentCount() == 8);
    // This is an internal binding.
    JSValue serverValue = callFrame->uncheckedArgument(0);
    JSValue requireHostHeader = callFrame->uncheckedArgument(1);
    JSValue useStrictMethodValidation = callFrame->uncheckedArgument(2);
    JSValue lenientHttpFlags = callFrame->uncheckedArgument(3);
    JSValue maxHeaderSize = callFrame->uncheckedArgument(4);
    JSValue callback = callFrame->uncheckedArgument(5);
    JSValue onConnectionCallback = callFrame->argument(6);
    JSValue httpAllowHalfOpen = callFrame->argument(7);

    double maxHeaderSizeNumber = maxHeaderSize.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    int32_t lenientBits = lenientHttpFlags.toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    Server__setAppFlags(globalObject, JSValue::encode(serverValue), requireHostHeader.toBoolean(globalObject), useStrictMethodValidation.toBoolean(globalObject), static_cast<uint8_t>(lenientBits & 0x3), httpAllowHalfOpen.toBoolean(globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    Server__setMaxHTTPHeaderSize(globalObject, JSValue::encode(serverValue), maxHeaderSizeNumber);
    RETURN_IF_EXCEPTION(scope, {});

    Server__setOnClientError(globalObject, JSValue::encode(serverValue), JSValue::encode(callback));
    RETURN_IF_EXCEPTION(scope, {});

    if (onConnectionCallback.isCallable()) {
        Server__setOnConnection(globalObject, JSValue::encode(serverValue), JSValue::encode(onConnectionCallback));
        RETURN_IF_EXCEPTION(scope, {});
    }

    return JSValue::encode(jsUndefined());
}

// Pushes only the parser/handler flags. Unlike setServerCustomOptions this rebinds no
// callbacks, so it is safe to call on a listening server (server.httpAllowHalfOpen is
// assignable at any time, like Node's).
JSC_DEFINE_HOST_FUNCTION(jsHTTPSetAppFlags, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(callFrame->argumentCount() == 5);
    // This is an internal binding.
    JSValue serverValue = callFrame->uncheckedArgument(0);
    JSValue requireHostHeader = callFrame->uncheckedArgument(1);
    JSValue useStrictMethodValidation = callFrame->uncheckedArgument(2);
    JSValue lenientHttpFlags = callFrame->uncheckedArgument(3);
    JSValue httpAllowHalfOpen = callFrame->argument(4);

    int32_t lenientBits = lenientHttpFlags.toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    Server__setAppFlags(globalObject, JSValue::encode(serverValue), requireHostHeader.toBoolean(globalObject), useStrictMethodValidation.toBoolean(globalObject), static_cast<uint8_t>(lenientBits & 0x3), httpAllowHalfOpen.toBoolean(globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(jsUndefined());
}

JSValue createNodeHTTPInternalBinding(Zig::GlobalObject* globalObject)
{
    auto* obj = constructEmptyObject(globalObject);
    VM& vm = globalObject->vm();
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "setServerCustomOptions"_s)),
        JSC::JSFunction::create(vm, globalObject, 2, "setServerCustomOptions"_s, jsHTTPSetCustomOptions, ImplementationVisibility::Public), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "setServerAppFlags"_s)),
        JSC::JSFunction::create(vm, globalObject, 5, "setServerAppFlags"_s, jsHTTPSetAppFlags, ImplementationVisibility::Public), 0);
    obj->putDirectNativeFunction(
        vm, globalObject, JSC::PropertyName(JSC::Identifier::fromString(vm, "drainMicrotasks"_s)),
        0, Bun__drainMicrotasksFromJS, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);

    return obj;
}

/* Http2Response and Http3Response share this surface: headers are buffered
 * as a list and framed by the transport, so there is no Transfer-Encoding. */
template<typename Response, typename ResponseData>
static void writeFetchHeadersToStreamResponse(WebCore::FetchHeaders& headers, Response* res)
{
    auto& internalHeaders = headers.internalHeaders();
    auto* data = res->getHttpResponseData();

    auto writeOne = [&](const WTF::StringView& name, const WTF::StringView& value) {
        ASSERT(name.containsOnlyASCII());
        HTTPLatin1String nameBytes(name);
        HTTPLatin1String valueBytes(value);
        res->writeHeader(nameBytes.view(), valueBytes.view());
    };

    for (auto& value : internalHeaders.getSetCookieHeaders()) {
        HTTPLatin1String valueBytes(value);
        res->writeHeader(std::string_view("set-cookie", 10), valueBytes.view());
    }

    for (const auto& header : internalHeaders.commonHeaders()) {
        if (header.key == WebCore::HTTPHeaderName::ContentLength) {
            if (!(data->state & ResponseData::HTTP_WROTE_CONTENT_LENGTH_HEADER)) {
                data->state |= ResponseData::HTTP_WROTE_CONTENT_LENGTH_HEADER;
                res->writeMark();
            }
        }
        if (header.key == WebCore::HTTPHeaderName::Date) {
            data->state |= ResponseData::HTTP_WROTE_DATE_HEADER;
        }
        // No Transfer-Encoding on these transports; if a user header reaches
        // here it was already stripped by doWriteHeaders().
        writeOne(WebCore::httpHeaderNameString(header.key), header.value);
    }

    for (auto& header : internalHeaders.uncommonHeaders()) {
        writeOne(header.key, header.value);
    }
}

extern "C" void WebCore__FetchHeaders__toUWSResponse(WebCore::FetchHeaders* arg0, UWSResponseKind kind, void* arg2)
{
    switch (kind) {
    case UWSResponseKind::TCP:
        writeFetchHeadersToUWSResponse<false>(*arg0, reinterpret_cast<uWS::HttpResponse<false>*>(arg2));
        break;
    case UWSResponseKind::SSL:
        writeFetchHeadersToUWSResponse<true>(*arg0, reinterpret_cast<uWS::HttpResponse<true>*>(arg2));
        break;
    case UWSResponseKind::H2:
        writeFetchHeadersToStreamResponse<uWS::Http2Response, uWS::Http2ResponseData>(*arg0, reinterpret_cast<uWS::Http2Response*>(arg2));
        break;
    case UWSResponseKind::H3:
        writeFetchHeadersToStreamResponse<uWS::Http3Response, uWS::Http3ResponseData>(*arg0, reinterpret_cast<uWS::Http3Response*>(arg2));
        break;
    }
}

} // namespace Bun
