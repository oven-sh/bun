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
#include "ScriptExecutionContext.h"
#include "AsyncContextFrame.h"
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include "JSSocketAddressDTO.h"
#include "node/JSNodeHTTPServerSocket.h"
#include "node/JSNodeHTTPServerSocketPrototype.h"
#include "GeneratedHwExports.h"
#include "wtf/SIMDUTF.h"
namespace Bun {

using namespace JSC;
using namespace WebCore;
using namespace std::string_view_literals;

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

// Mirrors node:http's /(?:^|\W)100-continue(?:$|\W)/i check on the Expect value.
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

using RequestArguments = MarkedArgumentBufferWithSize<16>;

// One pass over the request: append url, method and jsNumber(dispatch
// bitfield) to `args`, and capture the raw header bytes into `flatHeaders`
// as [u32 nameLen][u32 valueLen][name][value]... so req.rawHeaders /
// req.headers can be materialized lazily (Bun__NodeHTTP__buildRawHeadersArray,
// Bun__NodeHTTP__buildHeadersObject) only when user code reads them. Returns the bitfield.
static uint32_t assignHeadersFromUWebSocketsForCall(uWS::HttpRequest* request, JSValue methodString, RequestArguments& args, WTF::Vector<uint8_t, 1024>& flatHeaders, JSC::JSGlobalObject* globalObject, JSC::VM& vm)
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

    uint32_t bits = 0;
    // llhttp's F_CONNECTION_CLOSE / F_CONNECTION_UPGRADE: a whole list item.
    if (request->getConnectionClose())
        bits |= kDispatchConnClose;
    if (request->hasConnectionToken("upgrade"))
        bits |= kDispatchConnUpgrade;
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

        // Duplicate headers OR their bits (the lazy header build joins
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
            // llhttp's F_UPGRADE needs a non-empty value.
            if (!value.empty() && svEqualsIgnoreCase(name, "upgrade"))
                bits |= kDispatchHasUpgrade;
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
    return bits;
}

// Returns true if the JS dispatcher can pass `head` on: to 'connect', or to 'upgrade' for a request with no body that isn't pipelined.
static ALWAYS_INLINE bool canHandOffHead(JSC::VM& vm, JSValue methodString, uint32_t dispatchBits, bool hasBody, bool isPipelinedDispatch)
{
    static constexpr uint32_t upgradeBits = kDispatchHasUpgrade | kDispatchConnUpgrade;
    // Bun__HTTPMethod__toJS returns this cell for every CONNECT. It's null until the first one, and then matches nothing.
    if (methodString == JSValue(Bun::commonStrings(vm).m_httpCONNECT))
        return true;
    return !hasBody && !isPipelinedDispatch && (dispatchBits & upgradeBits) == upgradeBits;
}

// A known header's value as a string: the one remembered from the last request when it holds the same bytes,
// which takes no allocation.
static String headerValueString(NodeHTTPRequestHeaderValues& remembered, HTTPHeaderName name, std::span<const Latin1Character> bytes)
{
    // A longer value is one that differs from a request to the next.
    static constexpr size_t maxRememberedLength = 256;
    String* slot = bytes.size() <= maxRememberedLength ? remembered.slotFor(name) : nullptr;
    if (!slot)
        return String(bytes);
    if (slot->isNull() || !WTF::equal(slot->impl(), bytes))
        *slot = String(bytes);
    return *slot;
}

// The next [u32 nameLen][u32 valueLen][name][value] of what assignHeadersFromUWebSocketsForCall captured.
static bool nextCapturedHeader(const uint8_t* data, size_t length, size_t& offset, std::span<const Latin1Character>& name, std::span<const Latin1Character>& value)
{
    if (offset + 8 > length)
        return false;
    const uint32_t nameLen = static_cast<uint32_t>(data[offset]) | (static_cast<uint32_t>(data[offset + 1]) << 8)
        | (static_cast<uint32_t>(data[offset + 2]) << 16) | (static_cast<uint32_t>(data[offset + 3]) << 24);
    const uint32_t valueLen = static_cast<uint32_t>(data[offset + 4]) | (static_cast<uint32_t>(data[offset + 5]) << 8)
        | (static_cast<uint32_t>(data[offset + 6]) << 16) | (static_cast<uint32_t>(data[offset + 7]) << 24);
    if (static_cast<uint64_t>(offset) + 8 + nameLen + valueLen > length) [[unlikely]]
        return false;
    name = { reinterpret_cast<const Latin1Character*>(data + offset + 8), nameLen };
    value = { reinterpret_cast<const Latin1Character*>(data + offset + 8 + nameLen), valueLen };
    offset += 8 + static_cast<size_t>(nameLen) + valueLen;
    return true;
}

// req.headers of a request that names no header twice, straight from the captured bytes: what IncomingMessage's
// _addHeaderLine makes of such a request's rawHeaders is one property per header, named in lowercase, in the
// order of the request. Answers undefined for the requests where it makes something else, which the caller
// (NodeHTTPResponse.headersObject, for the `headers` getter) then builds from rawHeaders: a repeated name, a
// Set-Cookie (an array), a name that Object.prototype has too (it reads through), a name that is an index.
extern "C" EncodedJSValue Bun__NodeHTTP__buildHeadersObject(JSC::JSGlobalObject* globalObject, const uint8_t* data, size_t length)
{
    auto& vm = JSC::getVM(globalObject);
    std::span<const Latin1Character> nameBytes, valueBytes;

    // Which known header each one is, and whether a name comes twice, found before anything is allocated: a
    // client or a proxy that repeats a header does so on every request.
    static constexpr uint8_t otherName = 0xff;
    static_assert(numHTTPHeaderNames <= otherName);
    Vector<uint8_t, 32> names;
    WTF::BitSet<numHTTPHeaderNames> seen;
    // Past these, the object being built tells that an unknown name is repeated.
    std::array<std::span<const Latin1Character>, 8> otherNames;
    size_t otherNameCount = 0;
    for (size_t offset = 0; nextCapturedHeader(data, length, offset, nameBytes, valueBytes);) {
        HTTPHeaderName name;
        if (!WebCore::findHTTPHeaderName(StringView(nameBytes), name)) {
            // The parser lets nothing but a token through as a field name (HttpParser.h), so lowercasing
            // it as ASCII below is what String.prototype.toLowerCase does to it.
            ASSERT(!nameBytes.empty() && charactersAreAllASCII(nameBytes));
            for (size_t i = 0; i < otherNameCount; i++) {
                if (equalIgnoringASCIICase(otherNames[i], nameBytes))
                    return JSValue::encode(jsUndefined());
            }
            if (otherNameCount < otherNames.size())
                otherNames[otherNameCount++] = nameBytes;
            names.append(otherName);
            continue;
        }
        if (name == HTTPHeaderName::SetCookie || seen.testAndSet(static_cast<size_t>(name)))
            return JSValue::encode(jsUndefined());
        names.append(static_cast<uint8_t>(name));
    }

    auto* clientData = WebCore::clientData(vm);
    HTTPHeaderIdentifiers& identifiers = clientData->httpHeaderIdentifiers();
    NodeHTTPRequestHeaderValues& remembered = clientData->nodeHTTPRequestHeaderValues();
    JSObject* objectPrototype = globalObject->objectPrototype();
    // One of a few capacities, so that requests of different lengths share the structures of their first headers.
    unsigned inlineCapacity = std::min<unsigned>(std::max<unsigned>(JSFinalObject::defaultInlineCapacity, (names.size() + 7) & ~7u), JSFinalObject::maxInlineCapacity);
    JSObject* headers = constructEmptyObject(globalObject, objectPrototype, inlineCapacity);

    size_t index = 0;
    for (size_t offset = 0; nextCapturedHeader(data, length, offset, nameBytes, valueBytes); index++) {
        Identifier identifier;
        JSValue value;
        if (names[index] == otherName) {
            identifier = Identifier::fromString(vm, StringView(nameBytes).convertToASCIILowercaseAtom());
            if (parseIndex(identifier) || headers->getDirect(vm, identifier))
                return JSValue::encode(jsUndefined());
            value = jsString(vm, String(valueBytes));
        } else {
            HTTPHeaderName name = static_cast<HTTPHeaderName>(names[index]);
            identifier = identifiers.identifierFor(vm, name);
            value = jsString(vm, headerValueString(remembered, name, valueBytes));
        }
        if (objectPrototype->getDirect(vm, identifier)) [[unlikely]]
            return JSValue::encode(jsUndefined());
        headers->putDirect(vm, identifier, value, 0);
    }

    return JSValue::encode(headers);
}

// The string `headers` has under `name`, when it holds exactly `bytes`.
static JSString* sameHeaderValue(VM& vm, JSObject* headers, const Identifier& name, std::span<const Latin1Character> bytes)
{
    if (parseIndex(name))
        return nullptr;
    JSValue value = headers->getDirect(vm, name);
    if (!value || !value.isString())
        return nullptr;
    JSString* string = asString(value);
    StringImpl* impl = string->tryGetValueImpl();
    return impl && WTF::equal(impl, bytes) ? string : nullptr;
}

// Builds the rawHeaders flat array [name, value, ...] from the bytes captured
// by assignHeadersFromUWebSocketsForCall. Runs only when user code first
// touches req.rawHeaders, or req.headers of a request that Bun__NodeHTTP__buildHeadersObject
// leaves to JS (via NodeHTTPResponse.takeRawHeaders). `encodedHeaders` is req.headers when
// that was read first: built from these bytes, it has the value strings already.
extern "C" EncodedJSValue Bun__NodeHTTP__buildRawHeadersArray(JSC::JSGlobalObject* globalObject, const uint8_t* data, size_t length, EncodedJSValue encodedHeaders)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    MarkedArgumentBuffer arrayValues;
    auto* clientData = WebCore::clientData(vm);
    HTTPHeaderIdentifiers& identifiers = clientData->httpHeaderIdentifiers();
    NodeHTTPRequestHeaderValues& remembered = clientData->nodeHTTPRequestHeaderValues();
    JSObject* headers = JSValue::decode(encodedHeaders).getObject();
    // The JS fold asks for rawHeaders with the object it is about to fill.
    if (headers && headers->structure()->maxOffset() == invalidOffset)
        headers = nullptr;

    std::span<const Latin1Character> nameBytes, valueBytes;
    for (size_t offset = 0; nextCapturedHeader(data, length, offset, nameBytes, valueBytes);) {
        HTTPHeaderName name;
        JSString* jsValue = nullptr;
        JSString* nameString = nullptr;

        if (WebCore::findHTTPHeaderName(StringView(nameBytes), name)) {
            if (headers)
                jsValue = sameHeaderValue(vm, headers, identifiers.identifierFor(vm, name), valueBytes);
            if (!jsValue)
                jsValue = jsString(vm, headerValueString(remembered, name, valueBytes));
            // rawHeaders keeps the wire casing; reuse the cached (lowercase)
            // string only when the client already sent it lowercased.
            if (WTF::equal(WTF::httpHeaderNameStringImpl(name).impl(), nameBytes))
                nameString = identifiers.stringFor(globalObject, name);
        } else {
            if (headers)
                jsValue = sameHeaderValue(vm, headers, Identifier::fromString(vm, StringView(nameBytes).convertToASCIILowercaseAtom()), valueBytes);
            if (!jsValue)
                jsValue = jsString(vm, String(valueBytes));
        }
        if (!nameString)
            nameString = jsString(vm, String(nameBytes));

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
// onto the native response so takeRawHeaders / headersObject can materialize
// them on demand.
extern "C" void NodeHTTPResponse__adoptRawRequestHeaders(void* nodeHttpResponse, const uint8_t* data, size_t length);

static constexpr uWS::NodeHttpSocketHooks nodeHttpSocketHooks = {
    .onClosed = [](void* socketData, int readError, bool peerEnded) { reinterpret_cast<JSNodeHTTPServerSocket*>(socketData)->onClose(readError, peerEnded); },
    .onDrain = [](void* socketData) { reinterpret_cast<JSNodeHTTPServerSocket*>(socketData)->onDrain(); },
    .onRawRead = [](void* socketData, const char* data, int length) { reinterpret_cast<JSNodeHTTPServerSocket*>(socketData)->onRawRead(data, length); },
    .onReadParsed = [](void* socketData) { reinterpret_cast<JSNodeHTTPServerSocket*>(socketData)->onReadParsed(); },
    .onUpgradeBodyEnded = [](void* socketData) { reinterpret_cast<JSNodeHTTPServerSocket*>(socketData)->onUpgradeBodyEnded(); },
    .onHandshake = [](void* socketData, int success, us_bun_verify_error_t verifyError) { reinterpret_cast<JSNodeHTTPServerSocket*>(socketData)->onHandshake(success, verifyError); },
    .onPeerEnded = [](void* socketData) { return reinterpret_cast<JSNodeHTTPServerSocket*>(socketData)->onPeerEnded(); },
    .halfCloseAfterDrain = [](void* socketData) { reinterpret_cast<JSNodeHTTPServerSocket*>(socketData)->halfCloseAfterDrain(); },
};

extern "C" void NodeHTTP_assignOnNodeJSCompat(bool is_ssl, void* uws_app)
{
    if (is_ssl) {
        reinterpret_cast<uWS::TemplatedApp<true>*>(uws_app)->enableNodeHttpCompat(&nodeHttpSocketHooks);
    } else {
        reinterpret_cast<uWS::TemplatedApp<false>*>(uws_app)->enableNodeHttpCompat(&nodeHttpSocketHooks);
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

extern "C" EncodedJSValue NodeHTTPResponse__createForJS(size_t any_server, JSC::JSGlobalObject* globalObject, bool* hasBody, uWS::HttpRequest* request, int isSSL, void* response_ptr, bool isCurrent, void** nodeHttpResponsePtr);

template<bool isSSL>
static EncodedJSValue NodeHTTPServer__onRequest(
    size_t any_server,
    Zig::GlobalObject* globalObject,
    JSValue callback,
    JSValue methodString,
    uWS::HttpRequest* request,
    uWS::HttpResponse<isSSL>* response,
    void** nodeHttpResponsePtr)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* callbackObject = uncheckedDowncast<JSObject>(callback);
    RequestArguments args;

    // Typical request header sections are a few hundred bytes; the inline
    // capacity keeps the capture heap-allocation-free for the common case.
    WTF::Vector<uint8_t, 1024> flatHeaders;
    const uint32_t dispatchBits = assignHeadersFromUWebSocketsForCall(request, methodString, args, flatHeaders, globalObject, vm);

    auto* httpResponseData = response->getHttpResponseData();
    // Pipelined: an earlier response is in flight, so this one is queued and gets the connection at its turn (startRawResponse).
    const bool isPipelinedDispatch = (httpResponseData->state & uWS::HttpResponseData<isSSL>::HTTP_NODE_PIPELINED_DISPATCH) != 0;
    const bool isCurrent = !isPipelinedDispatch || !httpResponseData->socketData;

    bool hasBody = false;
    JSNodeHTTPResponse* nodeHTTPResponseObject = uncheckedDowncast<JSNodeHTTPResponse>(JSValue::decode(NodeHTTPResponse__createForJS(any_server, globalObject, &hasBody, request, isSSL, response, isCurrent, nodeHttpResponsePtr)));
    if (!flatHeaders.isEmpty()) {
        NodeHTTPResponse__adoptRawRequestHeaders(*nodeHttpResponsePtr, flatHeaders.span().data(), flatHeaders.size());
    }

    args.append(nodeHTTPResponseObject);
    args.append(jsBoolean(hasBody));

    auto* currentSocketDataPtr = reinterpret_cast<JSC::JSCell*>(httpResponseData->socketData);

    if (currentSocketDataPtr) {
        auto* thisSocket = uncheckedDowncast<JSNodeHTTPServerSocket>(currentSocketDataPtr);
        if (isPipelinedDispatch) {
            thisSocket->appendPipelinedResponse(vm, nodeHTTPResponseObject);
        } else {
            thisSocket->setCurrentResponse(vm, nodeHTTPResponseObject);
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
    if (!request->head.empty() && canHandOffHead(vm, methodString, dispatchBits, hasBody, isPipelinedDispatch)) {
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

template<typename Response>
static void writeResponseHeader(Response* res, const WTF::StringView& name, const WTF::StringView& value)
{
    ASSERT(name.containsOnlyASCII());
    HTTPLatin1String nameBytes(name);
    HTTPLatin1String valueBytes(value);
    res->writeHeader(nameBytes.view(), valueBytes.view());
}

// Headers that user code can't set on a 101 response. HttpResponse::upgrade() writes the handshake headers itself (RFC 6455 4.2.2).
static bool isReservedWebSocketUpgradeHeader(WebCore::HTTPHeaderName name)
{
    switch (name) {
    case WebCore::HTTPHeaderName::Upgrade:
    case WebCore::HTTPHeaderName::Connection:
    case WebCore::HTTPHeaderName::SecWebSocketAccept:
    case WebCore::HTTPHeaderName::SecWebSocketKey:
    case WebCore::HTTPHeaderName::SecWebSocketVersion:
    case WebCore::HTTPHeaderName::SecWebSocketProtocol:
    case WebCore::HTTPHeaderName::SecWebSocketExtensions:
        return true;
    default:
        return false;
    }
}

// A Bun.serve handler's headers, for any protocol. writeHeader() knows which of them uWS would otherwise add, and which it frames by itself.
template<bool forWebSocketUpgrade = false, typename Response>
static void writeFetchHeadersToUWSResponse(WebCore::FetchHeaders& headers, Response* res)
{
    auto& internalHeaders = headers.internalHeaders();

    for (auto& value : internalHeaders.getSetCookieHeaders()) {
        HTTPLatin1String valueBytes(value);
        res->writeHeader(std::string_view("set-cookie", 10), valueBytes.view());
    }

    for (const auto& header : internalHeaders.commonHeaders()) {
        if constexpr (forWebSocketUpgrade) {
            if (isReservedWebSocketUpgradeHeader(header.key))
                continue;
        }
        writeResponseHeader(res, WebCore::httpHeaderNameString(header.key), header.value);
    }

    for (auto& header : internalHeaders.uncommonHeaders()) {
        writeResponseHeader(res, header.key, header.value);
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
// Bits 5 and 6, no header line: how JS framed the body, in uWS's numbering. 0 leaves it to uWS.
static constexpr uint32_t kAutoHeaderBodyShift = 5;

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
        response->uWS::template AsyncSocket<isSSL>::write(line.data(), line.length());
    }
    if (autoHeaderBits & kAutoHeaderConnKeepAlive) {
        if (autoHeaderBits & kAutoHeaderKeepAliveTimeout) {
            auto blob = keepAliveHeaderBlob(keepAliveTimeoutSecs);
            response->uWS::template AsyncSocket<isSSL>::write(blob.data(), blob.length());
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
    }
    using Data = uWS::HttpResponseData<isSSL>;
    static_assert(Data::HTTP_BODY_UNTIL_CLOSE == 2 * Data::HTTP_BODY_CHUNKED && Data::HTTP_BODY_NONE == 3 * Data::HTTP_BODY_CHUNKED);
    if (uint32_t framing = (autoHeaderBits >> kAutoHeaderBodyShift) & 3) {
        response->setFraming(framing * Data::HTTP_BODY_CHUNKED);
    }
}

static std::string_view autoConnectionHeaders(uint32_t autoHeaderBits, uint32_t keepAliveTimeoutSecs)
{
    if (autoHeaderBits & kAutoHeaderConnKeepAlive) {
        if (autoHeaderBits & kAutoHeaderKeepAliveTimeout)
            return keepAliveHeaderBlob(keepAliveTimeoutSecs);
        return "Connection: keep-alive\r\n"sv;
    }
    if (autoHeaderBits & kAutoHeaderConnClose)
        return "Connection: close\r\n"sv;
    return {};
}

template<bool isSSL>
static bool tryWriteHeadAtOnce(uWS::HttpResponse<isSSL>* response, std::string_view status, JSC::JSArray* pairs, uint32_t autoHeaderBits, uint32_t keepAliveTimeoutSecs, const std::string_view* body = nullptr)
{
    using Data = uWS::HttpResponseData<isSSL>;
    auto* httpResponseData = response->getHttpResponseData();
    if (httpResponseData->state & Data::HTTP_STATUS_CALLED)
        return false;

    WTF::Vector<std::string_view, 32> texts;
    uint32_t state = Data::HTTP_STATUS_CALLED | Data::HTTP_WROTE_DATE_HEADER | Data::HTTP_WROTE_CONNECTION_HEADER;
    size_t size = "HTTP/1.1 \r\n"sv.length() + status.length();
    unsigned length = pairs->length();
    for (unsigned i = 0; i + 1 < length; i += 2) {
        std::array<std::string_view, 2> pair;
        for (unsigned part = 0; part < 2; ++part) {
            JSValue value = pairs->tryGetIndexQuickly(i + part);
            if (!value || !value.isString())
                return false;
            const WTF::StringImpl* impl = asString(value)->tryGetValueImpl();
            if (!impl || !impl->is8Bit())
                return false;
            auto span = impl->span8();
            pair[part] = { reinterpret_cast<const char*>(span.data()), span.size() };
        }
        auto [name, value] = pair;
        switch (uWS::classifyResponseField(name, value)) {
        case uWS::ResponseField::ContentLength:
            state |= Data::HTTP_WROTE_CONTENT_LENGTH_HEADER;
            break;
        case uWS::ResponseField::TransferEncoding:
            state |= Data::HTTP_WROTE_TRANSFER_ENCODING_HEADER;
            break;
        default:
            break;
        }
        texts.append(name);
        texts.append(value);
        size += name.length() + value.length() + ": \r\n"sv.length();
    }

    std::string_view date = autoHeaderBits & kAutoHeaderDate ? cachedDateHeaderLine() : std::string_view();
    std::string_view connection = autoConnectionHeaders(autoHeaderBits, keepAliveTimeoutSecs);
    std::string_view encoding = autoHeaderBits & kAutoHeaderTransferEncodingChunked ? "Transfer-Encoding: chunked\r\n"sv : std::string_view();
    size += date.length() + connection.length() + encoding.length();

    // What JS decided replaces what the status says, like writeAutoHeaders() after writeStatus(). 0 is undecided.
    uint32_t framing = ((autoHeaderBits >> kAutoHeaderBodyShift) & 3) * Data::HTTP_BODY_CHUNKED;
    if (!framing && response->isStatusWithoutBody(status))
        framing = Data::HTTP_BODY_NONE;

    char digits[uWS::utils::U64_MAX_DIGITS];
    std::string_view contentLength;
    if (body) {
        constexpr uint32_t framedOtherwise = Data::HTTP_WRITE_CALLED | Data::HTTP_END_CALLED | Data::HTTP_CONNECTION_CLOSE | Data::HTTP_WROTE_TRANSFER_ENCODING_HEADER | Data::HTTP_ANCIENT_REQUEST
            | Data::HTTP_FRAMING_DECIDED | Data::HTTP_NODE_HAS_RESPONSE_TRAILERS;
        if (framing || ((httpResponseData->state | state) & framedOtherwise) || httpResponseData->offset)
            return false;
        if (!((httpResponseData->state | state) & Data::HTTP_WROTE_CONTENT_LENGTH_HEADER)) {
            contentLength = { digits, static_cast<size_t>(uWS::utils::u64toa(body->length(), digits)) };
            size += "Content-Length: \r\n"sv.length() + contentLength.length();
            state |= Data::HTTP_WROTE_CONTENT_LENGTH_HEADER;
        }
        size += "\r\n"sv.length() + body->length();
    }

    char* at = response->uWS::template AsyncSocket<isSSL>::reserveInCorkBuffer(size);
    if (!at)
        return false;
    httpResponseData->state |= state;
    if (body)
        response->setFraming(Data::HTTP_BODY_LENGTH);
    else if (framing)
        response->setFraming(framing);

    auto append = [&](std::string_view text) {
        if (text.empty())
            return;
        memcpy(at, text.data(), text.length());
        at += text.length();
    };
    append("HTTP/1.1 "sv);
    append(status);
    append("\r\n"sv);
    for (size_t i = 0; i < texts.size(); i += 2) {
        append(texts[i]);
        append(": "sv);
        append(texts[i + 1]);
        append("\r\n"sv);
    }
    append(date);
    append(connection);
    append(encoding);
    if (body) {
        if (!contentLength.empty()) {
            append("Content-Length: "sv);
            append(contentLength);
            append("\r\n"sv);
        }
        append("\r\n"sv);
        append(*body);
    }
    return true;
}

extern "C" bool NodeHTTPServer__bytesOfChunk(EncodedJSValue encodedChunk, const uint8_t** bytes, size_t* length)
{
    JSValue chunk = JSValue::decode(encodedChunk);
    std::span<const uint8_t> found;
    if (chunk.isString()) {
        const WTF::StringImpl* impl = asString(chunk)->tryGetValueImpl();
        if (!impl || !impl->is8Bit())
            return false;
        found = byteCast<uint8_t>(impl->span8());
        bool isAllASCII = found.size() < 64 ? WTF::charactersAreAllASCII(impl->span8()) : simdutf::validate_ascii(reinterpret_cast<const char*>(found.data()), found.size());
        if (!isAllASCII)
            return false;
    } else if (auto* view = dynamicDowncast<JSC::JSUint8Array>(chunk))
        found = view->span();
    else
        return false;
    if (found.empty())
        return false;
    *bytes = found.data();
    *length = found.size();
    return true;
}

extern "C" bool NodeHTTPServer__writeWholeResponse(bool isSSL, void* response, const char* status, size_t statusLength, EncodedJSValue headers, uint32_t autoHeaderBits, uint32_t keepAliveTimeoutSecs, const char* body, size_t bodyLength)
{
    auto* pairs = dynamicDowncast<JSC::JSArray>(JSValue::decode(headers));
    if (!pairs)
        return false;
    std::string_view statusText(status, statusLength);
    std::string_view bodyText = bodyLength ? std::string_view(body, bodyLength) : std::string_view();
    if (isSSL)
        return tryWriteHeadAtOnce<true>(reinterpret_cast<uWS::HttpResponse<true>*>(response), statusText, pairs, autoHeaderBits, keepAliveTimeoutSecs, &bodyText);
    return tryWriteHeadAtOnce<false>(reinterpret_cast<uWS::HttpResponse<false>*>(response), statusText, pairs, autoHeaderBits, keepAliveTimeoutSecs, &bodyText);
}

template<bool isSSL>
static bool finishWholeResponse(uWS::HttpResponse<isSSL>* response, size_t bodyLength)
{
    response->finishResponseInCorkBuffer(bodyLength);
    return !us_socket_is_closed(reinterpret_cast<us_socket_t*>(response)) && !response->hasFullyDrained();
}

extern "C" bool NodeHTTPServer__finishWholeResponse(bool isSSL, void* response, size_t bodyLength)
{
    if (isSSL)
        return finishWholeResponse<true>(reinterpret_cast<uWS::HttpResponse<true>*>(response), bodyLength);
    return finishWholeResponse<false>(reinterpret_cast<uWS::HttpResponse<false>*>(response), bodyLength);
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

    if (!response->uWS::template AsyncSocket<isSSL>::isCorked() && response->getBufferedAmount() == 0) {
        response->uWS::template AsyncSocket<isSSL>::cork();
    }
    // A flat [name, value, ...] array, so that a repeated name (Set-Cookie) gets one header line per value, like in Node.js.
    auto* pairsArray = dynamicDowncast<JSC::JSArray>(headersObjectValue);
    if (pairsArray && tryWriteHeadAtOnce<isSSL>(response, std::string_view(statusMessage, statusMessageLength), pairsArray, autoHeaderBits, keepAliveTimeoutSecs))
        return;
    response->writeStatus(std::string_view(statusMessage, statusMessageLength));

    // node:http's ServerResponse decides the Date and Connection headers in JS, so uWS must not add its own.
    response->getHttpResponseData()->state |= uWS::HttpResponseData<isSSL>::HTTP_WROTE_DATE_HEADER
        | uWS::HttpResponseData<isSSL>::HTTP_WROTE_CONNECTION_HEADER;

    if (pairsArray) {
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

            writeResponseHeader(response, name, value);
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
    size_t any_server,
    Zig::GlobalObject* globalObject,
    EncodedJSValue callback,
    EncodedJSValue methodString,
    uWS::HttpRequest* request,
    uWS::HttpResponse<false>* response,
    void** nodeHttpResponsePtr)
{
    return NodeHTTPServer__onRequest<false>(
        any_server,
        globalObject,
        JSValue::decode(callback),
        JSValue::decode(methodString),
        request,
        response,
        nodeHttpResponsePtr);
}

extern "C" EncodedJSValue NodeHTTPServer__onRequest_https(
    size_t any_server,
    Zig::GlobalObject* globalObject,
    EncodedJSValue callback,
    EncodedJSValue methodString,
    uWS::HttpRequest* request,
    uWS::HttpResponse<true>* response,
    void** nodeHttpResponsePtr)
{
    return NodeHTTPServer__onRequest<true>(
        any_server,
        globalObject,
        JSValue::decode(callback),
        JSValue::decode(methodString),
        request,
        response,
        nodeHttpResponsePtr);
}

JSValue createNodeHTTPInternalBinding(Zig::GlobalObject* globalObject)
{
    auto* obj = constructEmptyObject(globalObject);
    VM& vm = globalObject->vm();
    obj->putDirectNativeFunction(
        vm, globalObject, JSC::PropertyName(JSC::Identifier::fromString(vm, "drainMicrotasks"_s)),
        0, Bun::Bindgen::Generated::HwExports::jsDrainMicrotasks, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);

    return obj;
}

extern "C" void WebCore__FetchHeaders__toUWSResponse(WebCore::FetchHeaders* arg0, UWSResponseKind kind, void* arg2)
{
    switch (kind) {
    case UWSResponseKind::TCP:
        writeFetchHeadersToUWSResponse(*arg0, reinterpret_cast<uWS::HttpResponse<false>*>(arg2));
        break;
    case UWSResponseKind::SSL:
        writeFetchHeadersToUWSResponse(*arg0, reinterpret_cast<uWS::HttpResponse<true>*>(arg2));
        break;
    case UWSResponseKind::H2:
        writeFetchHeadersToUWSResponse(*arg0, reinterpret_cast<uWS::Http2Response*>(arg2));
        break;
    case UWSResponseKind::H3:
        writeFetchHeadersToUWSResponse(*arg0, reinterpret_cast<uWS::Http3Response*>(arg2));
        break;
    }
}

extern "C" void WebCore__FetchHeaders__toUWSResponseForWebSocketUpgrade(WebCore::FetchHeaders* arg0, bool isSSL, void* arg1)
{
    if (isSSL) {
        writeFetchHeadersToUWSResponse<true>(*arg0, reinterpret_cast<uWS::HttpResponse<true>*>(arg1));
    } else {
        writeFetchHeadersToUWSResponse<true>(*arg0, reinterpret_cast<uWS::HttpResponse<false>*>(arg1));
    }
}

} // namespace Bun
