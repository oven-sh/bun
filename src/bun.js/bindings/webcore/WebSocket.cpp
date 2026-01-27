/*
 * Copyright (C) 2011 Google Inc.  All rights reserved.
 * Copyright (C) 2015-2016 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "WebSocket.h"
#include "WebSocketDeflate.h"
#include "headers.h"
#include "blob.h"
#include "ZigGeneratedClasses.h"
#include "CloseEvent.h"
#include <wtf/text/Base64.h>
// #include "ContentSecurityPolicy.h"
// #include "DOMWindow.h"
// #include "Document.h"
#include "Event.h"
#include "EventListener.h"
#include "EventNames.h"
// #include "Frame.h"
// #include "FrameLoader.h"
// #include "FrameLoaderClient.h"
// #include "InspectorInstrumentation.h"
// #include "Logging.h"
#include "MessageEvent.h"
// #include "MixedContentChecker.h"
// #include "ResourceLoadObserver.h"
// #include "ScriptController.h"
#include "ScriptExecutionContext.h"
// #include "SecurityOrigin.h"
// #include "SocketProvider.h"
// #include "ThreadableWebSocketChannel.h"
// #include "WebSocketChannel.h"
// #include "WorkerGlobalScope.h"
// #include "WorkerLoaderProxy.h"
// #include "WorkerThread.h"
#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/ArrayBufferView.h>
#include <JavaScriptCore/ScriptCallStack.h>
#include <wtf/HashSet.h>
#include <wtf/HexNumber.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/NeverDestroyed.h>
// #include <wtf/RunLoop.h>
#include <wtf/StdLibExtras.h>
#include <wtf/text/CString.h>
#include <wtf/text/StringBuilder.h>

#include "JSBuffer.h"
#include "ErrorEvent.h"
#include "WebSocketDeflate.h"

// #if USE(WEB_THREAD)
// #include "WebCoreThreadRun.h"
// #endif

namespace WebCore {
WTF_MAKE_TZONE_ALLOCATED_IMPL(WebSocket);
extern "C" int Bun__getTLSRejectUnauthorizedValue();

static ErrorEvent::Init createErrorEventInit(WebSocket& webSocket, const String& reason, JSC::JSGlobalObject* globalObject)
{
    ErrorEvent::Init eventInit = {};
    if (reason.isEmpty()) {
        eventInit.message = makeString("WebSocket connection to '"_s, webSocket.url().stringCenterEllipsizedToLength(), "' failed"_s);
    } else {
        eventInit.message = makeString("WebSocket connection to '"_s, webSocket.url().stringCenterEllipsizedToLength(), "' failed: "_s, reason);
    }
    eventInit.filename = String();
    eventInit.bubbles = false;
    eventInit.cancelable = false;
    eventInit.colno = 0;
    eventInit.error = JSC::createError(globalObject, eventInit.message);
    return eventInit;
}

static size_t getFramingOverhead(size_t payloadSize)
{
    static const size_t hybiBaseFramingOverhead = 2; // Every frame has at least two-byte header.
    static const size_t hybiMaskingKeyLength = 4; // Every frame from client must have masking key.
    static const size_t minimumPayloadSizeWithTwoByteExtendedPayloadLength = 126;
    static const size_t minimumPayloadSizeWithEightByteExtendedPayloadLength = 0x10000;
    size_t overhead = hybiBaseFramingOverhead + hybiMaskingKeyLength;
    if (payloadSize >= minimumPayloadSizeWithEightByteExtendedPayloadLength)
        overhead += 8;
    else if (payloadSize >= minimumPayloadSizeWithTwoByteExtendedPayloadLength)
        overhead += 2;
    return overhead;
}

const size_t maxReasonSizeInBytes = 123;

static inline bool isValidProtocolCharacter(char16_t character)
{
    // Hybi-10 says "(Subprotocol string must consist of) characters in the range U+0021 to U+007E not including
    // separator characters as defined in [RFC2616]."
    const char16_t minimumProtocolCharacter = '!'; // U+0021.
    const char16_t maximumProtocolCharacter = '~'; // U+007E.
    return character >= minimumProtocolCharacter && character <= maximumProtocolCharacter
        && character != '"' && character != '(' && character != ')' && character != ',' && character != '/'
        && !(character >= ':' && character <= '@') // U+003A - U+0040 (':', ';', '<', '=', '>', '?', '@').
        && !(character >= '[' && character <= ']') // U+005B - U+005D ('[', '\\', ']').
        && character != '{' && character != '}';
}

static bool isValidProtocolString(StringView protocol)
{
    if (protocol.isEmpty())
        return false;
    for (auto codeUnit : protocol.codeUnits()) {
        if (!isValidProtocolCharacter(codeUnit))
            return false;
    }
    return true;
}

static String encodeProtocolString(const String& protocol)
{
    StringBuilder builder;
    for (size_t i = 0; i < protocol.length(); i++) {
        if (protocol[i] < 0x20 || protocol[i] > 0x7E)
            builder.append("\\u"_s, hex(protocol[i], 4));
        else if (protocol[i] == 0x5c)
            builder.append("\\\\"_s);
        else
            builder.append(protocol[i]);
    }
    return builder.toString();
}

static String joinStrings(const Vector<String>& strings, ASCIILiteral separator)
{
    StringBuilder builder;
    for (size_t i = 0; i < strings.size(); ++i) {
        if (i)
            builder.append(separator);
        builder.append(strings[i]);
    }
    return builder.toString();
}

static unsigned saturateAdd(unsigned a, unsigned b)
{
    if (std::numeric_limits<unsigned>::max() - a < b)
        return std::numeric_limits<unsigned>::max();
    return a + b;
}

ASCIILiteral WebSocket::subprotocolSeparator()
{
    return ", "_s;
}

WebSocket::WebSocket(ScriptExecutionContext& context)
    : ContextDestructionObserver(&context)
    , m_subprotocol(emptyString())
    , m_extensions(emptyString())
{
    m_state = CONNECTING;
    m_hasPendingActivity.store(true);
    m_rejectUnauthorized = Bun__getTLSRejectUnauthorizedValue() != 0;
}

WebSocket::~WebSocket()
{
    if (m_upgradeClient != nullptr) {
        void* upgradeClient = m_upgradeClient;
        // Use TLS cancel if connection type is TLS or ProxyTLS (either is a TLS socket to the remote)
        bool useTLSClient = (m_connectionType == ConnectionType::TLS || m_connectionType == ConnectionType::ProxyTLS);
        if (useTLSClient) {
            Bun__WebSocketHTTPSClient__cancel(reinterpret_cast<void*>(upgradeClient));
        } else {
            Bun__WebSocketHTTPClient__cancel(reinterpret_cast<void*>(upgradeClient));
        }
    }

    switch (m_connectedWebSocketKind) {
    case ConnectedWebSocketKind::Client: {
        Bun__WebSocketClient__finalize(reinterpret_cast<void*>(this->m_connectedWebSocket.client));
        break;
    }
    case ConnectedWebSocketKind::ClientSSL: {
        Bun__WebSocketClientTLS__finalize(reinterpret_cast<void*>(this->m_connectedWebSocket.clientSSL));
        break;
    }
    // case ConnectedWebSocketKind::Server: {
    //     this->m_connectedWebSocket.server->end(None);
    //     break;
    // }
    // case ConnectedWebSocketKind::ServerSSL: {
    //     this->m_connectedWebSocket.serverSSL->end(None);
    //     break;
    // }
    default: {
        break;
    }
    }
}

// Transient proxy configuration - used only during connect() and not stored as member fields
struct ProxyConfig {
    String host;
    uint16_t port { 0 };
    String authorization;
    Vector<std::pair<String, String>> headers;
    bool isHTTPS { false };
};

static ExceptionOr<std::optional<ProxyConfig>> setupProxy(const String& proxyUrl, std::optional<FetchHeaders::Init>&& proxyHeaders)
{
    if (proxyUrl.isNull() || proxyUrl.isEmpty())
        return { std::nullopt };

    URL url { proxyUrl };
    if (!url.isValid())
        return Exception { SyntaxError, makeString("Invalid proxy URL: "_s, proxyUrl) };

    ProxyConfig config;
    config.host = url.host().toString();
    config.isHTTPS = url.protocolIs("https"_s);
    config.port = url.port().value_or(config.isHTTPS ? 443 : 80);

    // Compute Basic auth from proxy URL credentials
    if (!url.user().isEmpty()) {
        auto credentials = makeString(url.user(), ':', url.password());
        auto utf8 = credentials.utf8();
        auto encoded = base64EncodeToString(std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(utf8.data()), utf8.length()));
        config.authorization = makeString("Basic "_s, encoded);
    }

    // Store proxy headers
    if (proxyHeaders) {
        auto headersOrException = FetchHeaders::create(WTF::move(proxyHeaders));
        if (!headersOrException.hasException()) {
            auto hdrs = headersOrException.releaseReturnValue();
            auto iterator = hdrs.get().createIterator(false);
            while (auto value = iterator.next()) {
                config.headers.append({ value->key, value->value });
            }
        }
    }

    return { WTF::move(config) };
}

void WebSocket::setExtensionsFromDeflateParams(const PerMessageDeflateParams* deflate_params)
{
    if (deflate_params == nullptr)
        return;

    StringBuilder extensions;
    extensions.append("permessage-deflate"_s);
    if (deflate_params->server_no_context_takeover)
        extensions.append("; server_no_context_takeover"_s);
    if (deflate_params->client_no_context_takeover)
        extensions.append("; client_no_context_takeover"_s);
    if (deflate_params->server_max_window_bits != 15) {
        extensions.append("; server_max_window_bits="_s);
        extensions.append(String::number(deflate_params->server_max_window_bits));
    }
    if (deflate_params->client_max_window_bits != 15) {
        extensions.append("; client_max_window_bits="_s);
        extensions.append(String::number(deflate_params->client_max_window_bits));
    }
    m_extensions = extensions.toString();
}

ExceptionOr<Ref<WebSocket>> WebSocket::create(ScriptExecutionContext& context, const String& url)
{
    return create(context, url, Vector<String> {}, std::nullopt);
}

ExceptionOr<Ref<WebSocket>> WebSocket::create(ScriptExecutionContext& context, const String& url, const Vector<String>& protocols)
{
    return create(context, url, protocols, std::nullopt);
}

ExceptionOr<Ref<WebSocket>> WebSocket::create(ScriptExecutionContext& context, const String& url, const Vector<String>& protocols, std::optional<FetchHeaders::Init>&& headers)
{
    if (url.isNull())
        return Exception { SyntaxError };

    auto socket = adoptRef(*new WebSocket(context));
    // socket->suspendIfNeeded();

    auto result = socket->connect(url, protocols, WTF::move(headers));
    // auto result = socket->connect(url, protocols);

    if (result.hasException())
        return result.releaseException();

    return socket;
}
ExceptionOr<Ref<WebSocket>> WebSocket::create(ScriptExecutionContext& context, const String& url, const Vector<String>& protocols, std::optional<FetchHeaders::Init>&& headers, bool rejectUnauthorized)
{
    if (url.isNull())
        return Exception { SyntaxError };

    auto socket = adoptRef(*new WebSocket(context));
    socket->setRejectUnauthorized(rejectUnauthorized);
    // socket->suspendIfNeeded();

    auto result = socket->connect(url, protocols, WTF::move(headers));
    // auto result = socket->connect(url, protocols);

    if (result.hasException())
        return result.releaseException();

    return socket;
}

ExceptionOr<Ref<WebSocket>> WebSocket::create(ScriptExecutionContext& context, const String& url, const Vector<String>& protocols, std::optional<FetchHeaders::Init>&& headers, const String& proxyUrl, std::optional<FetchHeaders::Init>&& proxyHeaders, void* sslConfig)
{
    if (url.isNull())
        return Exception { SyntaxError };

    auto proxyConfigResult = setupProxy(proxyUrl, WTF::move(proxyHeaders));
    if (proxyConfigResult.hasException())
        return proxyConfigResult.releaseException();

    auto socket = adoptRef(*new WebSocket(context));
    socket->m_sslConfig = sslConfig; // Set BEFORE connect() so it's available during connection

    auto result = socket->connect(url, protocols, WTF::move(headers), proxyConfigResult.releaseReturnValue());
    if (result.hasException())
        return result.releaseException();

    return socket;
}

ExceptionOr<Ref<WebSocket>> WebSocket::create(ScriptExecutionContext& context, const String& url, const Vector<String>& protocols, std::optional<FetchHeaders::Init>&& headers, bool rejectUnauthorized, const String& proxyUrl, std::optional<FetchHeaders::Init>&& proxyHeaders, void* sslConfig)
{
    if (url.isNull())
        return Exception { SyntaxError };

    auto proxyConfigResult = setupProxy(proxyUrl, WTF::move(proxyHeaders));
    if (proxyConfigResult.hasException())
        return proxyConfigResult.releaseException();

    auto socket = adoptRef(*new WebSocket(context));
    socket->setRejectUnauthorized(rejectUnauthorized);
    socket->m_sslConfig = sslConfig; // Set BEFORE connect() so it's available during connection

    auto result = socket->connect(url, protocols, WTF::move(headers), proxyConfigResult.releaseReturnValue());
    if (result.hasException())
        return result.releaseException();

    return socket;
}

ExceptionOr<Ref<WebSocket>> WebSocket::create(ScriptExecutionContext& context, const String& url, const String& protocol)
{
    return create(context, url, Vector<String> { 1, protocol });
}

ExceptionOr<void> WebSocket::connect(const String& url)
{
    return connect(url, Vector<String> {}, std::nullopt);
}

ExceptionOr<void> WebSocket::connect(const String& url, const String& protocol)
{
    return connect(url, Vector<String> { 1, protocol }, std::nullopt);
}

static String resourceName(const URL& url)
{
    auto path = url.path();
    auto result = makeString(
        path,
        path.isEmpty() ? "/"_s : ""_s,
        url.queryWithLeadingQuestionMark());
    ASSERT(!result.isEmpty());
    ASSERT(!result.contains(' '));
    return result;
}

static String hostName(const URL& url, bool secure)
{
    // ASSERT(url.protocolIs("wss"_s) == secure);
    if (url.port() && ((!secure && url.port().value() != 80) || (secure && url.port().value() != 443)))
        return makeString(asASCIILowercase(url.host()), ':', url.port().value());
    return url.host().convertToASCIILowercase();
}

ExceptionOr<void> WebSocket::connect(const String& url, const Vector<String>& protocols)
{
    return connect(url, protocols, std::nullopt);
}

ExceptionOr<void> WebSocket::connect(const String& url, const Vector<String>& protocols, std::optional<FetchHeaders::Init>&& headersInit)
{
    return connect(url, protocols, WTF::move(headersInit), std::nullopt);
}

size_t WebSocket::memoryCost() const

{
    size_t cost = sizeof(WebSocket);
    cost += m_url.string().sizeInBytes();
    cost += m_subprotocol.sizeInBytes();
    cost += m_extensions.sizeInBytes();

    if (m_connectedWebSocketKind == ConnectedWebSocketKind::Client) {
        cost += Bun__WebSocketClient__memoryCost(m_connectedWebSocket.client);
    } else if (m_connectedWebSocketKind == ConnectedWebSocketKind::ClientSSL) {
        cost += Bun__WebSocketClientTLS__memoryCost(m_connectedWebSocket.clientSSL);
    }

    if (m_upgradeClient) {
        // Use TLS cost if connection type is TLS or ProxyTLS
        bool useTLSClient = (m_connectionType == ConnectionType::TLS || m_connectionType == ConnectionType::ProxyTLS);
        if (useTLSClient) {
            cost += Bun__WebSocketHTTPSClient__memoryCost(m_upgradeClient);
        } else {
            cost += Bun__WebSocketHTTPClient__memoryCost(m_upgradeClient);
        }
    }

    return cost;
}

ExceptionOr<void> WebSocket::connect(const String& url, const Vector<String>& protocols, std::optional<FetchHeaders::Init>&& headersInit, std::optional<ProxyConfig>&& proxyConfig)
{
    // LOG(Network, "WebSocket %p connect() url='%s'", this, url.utf8().data());
    m_url = URL { url };

    ASSERT(scriptExecutionContext());

    if (!m_url.isValid()) {
        // context.addConsoleMessage(MessageSource::JS, MessageLevel::Error, );
        m_state = CLOSED;
        updateHasPendingActivity();
        return Exception { SyntaxError, makeString("Invalid url for WebSocket "_s, m_url.stringCenterEllipsizedToLength()) };
    }

    bool is_secure = m_url.protocolIs("wss"_s) || m_url.protocolIs("https"_s);

    if (!m_url.protocolIs("http"_s) && !m_url.protocolIs("ws"_s) && !is_secure) {
        // context.addConsoleMessage(MessageSource::JS, MessageLevel::Error, );
        m_state = CLOSED;
        updateHasPendingActivity();
        return Exception { SyntaxError, makeString("Wrong url scheme for WebSocket "_s, m_url.stringCenterEllipsizedToLength()) };
    }
    if (m_url.hasFragmentIdentifier()) {
        // context.addConsoleMessage(MessageSource::JS, MessageLevel::Error, );
        m_state = CLOSED;
        updateHasPendingActivity();
        return Exception { SyntaxError, makeString("URL has fragment component "_s, m_url.stringCenterEllipsizedToLength()) };
    }

    // ASSERT(context.contentSecurityPolicy());
    // auto& contentSecurityPolicy = *context.contentSecurityPolicy();

    // contentSecurityPolicy.upgradeInsecureRequestIfNeeded(m_url, ContentSecurityPolicy::InsecureRequestType::Load);

    // if (!portAllowed(m_url)) {
    //     String message;
    //     if (m_url.port())
    //         message = makeString("WebSocket port ", m_url.port().value(), " blocked");
    //     else
    //         message = "WebSocket without port blocked"_s;
    //     context.addConsoleMessage(MessageSource::JS, MessageLevel::Error, message);
    //     failAsynchronously();
    //     return {};
    // }

    // FIXME: Convert this to check the isolated world's Content Security Policy once webkit.org/b/104520 is solved.
    // if (!context.shouldBypassMainWorldContentSecurityPolicy() && !contentSecurityPolicy.allowConnectToSource(m_url)) {
    //     m_state = CLOSED;

    //     // FIXME: Should this be throwing an exception?
    //     return Exception { SecurityError };
    // }

    // FIXME: There is a disagreement about restriction of subprotocols between WebSocket API and hybi-10 protocol
    // draft. The former simply says "only characters in the range U+0021 to U+007E are allowed," while the latter
    // imposes a stricter rule: "the elements MUST be non-empty strings with characters as defined in [RFC2616],
    // and MUST all be unique strings."
    //
    // Here, we throw SyntaxError if the given protocols do not meet the latter criteria. This behavior does not
    // comply with WebSocket API specification, but it seems to be the only reasonable way to handle this conflict.
    for (auto& protocol : protocols) {
        if (!isValidProtocolString(protocol)) {
            // context.addConsoleMessage(MessageSource::JS, MessageLevel::Error, );
            m_state = CLOSED;
            updateHasPendingActivity();
            return Exception { SyntaxError, makeString("Wrong protocol for WebSocket '"_s, encodeProtocolString(protocol), "'"_s) };
        }
    }
    HashSet<String> visited;
    for (auto& protocol : protocols) {
        if (!visited.add(protocol).isNewEntry) {
            // context.addConsoleMessage(MessageSource::JS, MessageLevel::Error, );
            m_state = CLOSED;
            updateHasPendingActivity();
            return Exception { SyntaxError, makeString("WebSocket protocols contain duplicates:"_s, encodeProtocolString(protocol), "'"_s) };
        }
    }

    // RunLoop::main().dispatch([targetURL = m_url.isolatedCopy(), mainFrameURL = context.url().isolatedCopy()]() {
    //     ResourceLoadObserver::shared().logWebSocketLoading(targetURL, mainFrameURL);
    // });

    // if (is<Document>(context)) {
    //     Document& document = downcast<Document>(context);
    //     RefPtr<Frame> frame = document.frame();
    //     // FIXME: make the mixed content check equivalent to the non-document mixed content check currently in WorkerThreadableWebSocketChannel::Bridge::connect()
    //     if (!frame || !MixedContentChecker::canRunInsecureContent(*frame, document.securityOrigin(), m_url)) {
    //         failAsynchronously();
    //         return { };
    //     }
    // }

    String protocolString;
    if (!protocols.isEmpty())
        protocolString = joinStrings(protocols, subprotocolSeparator());

    ZigString host = Zig::toZigString(m_url.host());
    auto resource = resourceName(m_url);
    ZigString path = Zig::toZigString(resource);
    ZigString clientProtocolString = Zig::toZigString(protocolString);
    uint16_t port = is_secure ? 443 : 80;
    if (auto userPort = m_url.port()) {
        port = userPort.value();
    }

    Vector<ZigString, 8> headerNames;
    Vector<ZigString, 8> headerValues;

    auto headersOrException = FetchHeaders::create(WTF::move(headersInit));
    if (headersOrException.hasException()) [[unlikely]] {
        m_state = CLOSED;
        updateHasPendingActivity();
        return headersOrException.releaseException();
    }

    auto headers = headersOrException.releaseReturnValue();
    headerNames.reserveInitialCapacity(headers.get().internalHeaders().size());
    headerValues.reserveInitialCapacity(headers.get().internalHeaders().size());
    // lowerCaseKeys = false so we dont touch the keys casing
    auto iterator = headers.get().createIterator(false);
    while (auto value = iterator.next()) {
        headerNames.unsafeAppendWithoutCapacityCheck(Zig::toZigString(value->key));
        headerValues.unsafeAppendWithoutCapacityCheck(Zig::toZigString(value->value));
    }

    // Determine connection type based on proxy usage and TLS requirements
    bool hasProxy = proxyConfig.has_value();
    bool proxyIsHTTPS = hasProxy && proxyConfig->isHTTPS;

    // Connection type determines what kind of socket we use:
    // - Plain/TLS: direct connection, socket type matches target protocol
    // - ProxyPlain/ProxyTLS: through proxy, socket type matches PROXY protocol (not target)
    if (hasProxy) {
        m_connectionType = proxyIsHTTPS ? ConnectionType::ProxyTLS : ConnectionType::ProxyPlain;
    } else {
        m_connectionType = is_secure ? ConnectionType::TLS : ConnectionType::Plain;
    }

    this->incPendingActivityCount();

    // Prepare proxy parameters (use local variables, not member fields)
    ZigString proxyHost = hasProxy ? Zig::toZigString(proxyConfig->host) : ZigString {};
    ZigString proxyAuth = hasProxy ? Zig::toZigString(proxyConfig->authorization) : ZigString {};
    uint16_t proxyPort = hasProxy ? proxyConfig->port : 0;

    Vector<ZigString, 8> proxyHeaderNames;
    Vector<ZigString, 8> proxyHeaderValues;
    if (hasProxy) {
        proxyHeaderNames.reserveInitialCapacity(proxyConfig->headers.size());
        proxyHeaderValues.reserveInitialCapacity(proxyConfig->headers.size());
        for (const auto& header : proxyConfig->headers) {
            proxyHeaderNames.unsafeAppendWithoutCapacityCheck(Zig::toZigString(header.first));
            proxyHeaderValues.unsafeAppendWithoutCapacityCheck(Zig::toZigString(header.second));
        }
    }

    // Compute Basic auth from target URL credentials (for WebSocket upgrade request)
    String targetAuthorization;
    if (!m_url.user().isEmpty()) {
        auto credentials = makeString(m_url.user(), ':', m_url.password());
        auto utf8 = credentials.utf8();
        auto encoded = base64EncodeToString(std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(utf8.data()), utf8.length()));
        targetAuthorization = makeString("Basic "_s, encoded);
    }
    ZigString targetAuth = Zig::toZigString(targetAuthorization);

    // Pass SSLConfig pointer to Zig (ownership transferred - Zig will deinit when connection closes)
    // After this call, m_sslConfig should not be used by C++ anymore
    void* sslConfig = m_sslConfig;
    m_sslConfig = nullptr; // Transfer ownership

    // Use TLS client based on connection type:
    // - TLS/ProxyTLS: use TLS socket
    // - Plain/ProxyPlain: use plain socket
    bool useTLSClient = (m_connectionType == ConnectionType::TLS || m_connectionType == ConnectionType::ProxyTLS);

    if (useTLSClient) {
        us_socket_context_t* ctx = scriptExecutionContext()->webSocketContext<true>();
        RELEASE_ASSERT(ctx);
        this->m_upgradeClient = Bun__WebSocketHTTPSClient__connect(
            scriptExecutionContext()->jsGlobalObject(), ctx, reinterpret_cast<CppWebSocket*>(this),
            &host, port, &path, &clientProtocolString,
            headerNames.begin(), headerValues.begin(), headerNames.size(),
            hasProxy ? &proxyHost : nullptr, proxyPort,
            (hasProxy && !proxyConfig->authorization.isEmpty()) ? &proxyAuth : nullptr,
            proxyHeaderNames.begin(), proxyHeaderValues.begin(), proxyHeaderNames.size(),
            sslConfig, is_secure,
            targetAuthorization.isEmpty() ? nullptr : &targetAuth);
    } else {
        us_socket_context_t* ctx = scriptExecutionContext()->webSocketContext<false>();
        RELEASE_ASSERT(ctx);
        this->m_upgradeClient = Bun__WebSocketHTTPClient__connect(
            scriptExecutionContext()->jsGlobalObject(), ctx, reinterpret_cast<CppWebSocket*>(this),
            &host, port, &path, &clientProtocolString,
            headerNames.begin(), headerValues.begin(), headerNames.size(),
            hasProxy ? &proxyHost : nullptr, proxyPort,
            (hasProxy && !proxyConfig->authorization.isEmpty()) ? &proxyAuth : nullptr,
            proxyHeaderNames.begin(), proxyHeaderValues.begin(), proxyHeaderNames.size(),
            sslConfig, is_secure,
            targetAuthorization.isEmpty() ? nullptr : &targetAuth);
    }

    proxyHeaderValues.clear();
    proxyHeaderNames.clear();
    headerValues.clear();
    headerNames.clear();

    if (this->m_upgradeClient == nullptr) {
        m_state = CLOSED;
        if (auto* context = scriptExecutionContext()) {
            context->postTask([this, protectedThis = Ref { *this }](ScriptExecutionContext& context) {
                ASSERT(scriptExecutionContext());
                auto* globalObject = context.jsGlobalObject();

                auto eventInit = createErrorEventInit(protectedThis, "Failed to connect"_s, globalObject);
                auto message = eventInit.message;
                protectedThis->dispatchEvent(ErrorEvent::create(eventNames().errorEvent, WTF::move(eventInit), EventIsTrusted::Yes));
                protectedThis->dispatchEvent(CloseEvent::create(false, 1006, WTF::move(message)));

                protectedThis->decPendingActivityCount();
            });
        }
        return {};
    }

    m_state = CONNECTING;

    // #if ENABLE(INTELLIGENT_TRACKING_PREVENTION)
    //     auto reportRegistrableDomain = [domain = RegistrableDomain(m_url).isolatedCopy()](auto& context) mutable {
    //         if (auto* frame = downcast<Document>(context).frame())
    //             frame->loader().client().didLoadFromRegistrableDomain(WTF::move(domain));
    //     };
    //     if (is<Document>(context))
    //         reportRegistrableDomain(context);
    //     else
    //         downcast<WorkerGlobalScope>(context).thread().workerLoaderProxy().postTaskToLoader(WTF::move(reportRegistrableDomain));
    // #endif

    // m_pendingActivity = makePendingActivity(*this);
    updateHasPendingActivity();
    return {};
}

ExceptionOr<void> WebSocket::send(const String& message)
{
    // LOG(Network, "WebSocket %p send() Sending String '%s'", this, message.utf8().data());
    if (m_state == CONNECTING)
        return Exception { InvalidStateError };
    // No exception is raised if the connection was once established but has subsequently been closed.
    if (m_state == CLOSING || m_state == CLOSED) {
        auto utf8 = message.utf8(StrictConversionReplacingUnpairedSurrogatesWithFFFD);
        size_t payloadSize = utf8.length();
        m_bufferedAmountAfterClose = saturateAdd(m_bufferedAmountAfterClose, payloadSize);
        m_bufferedAmountAfterClose = saturateAdd(m_bufferedAmountAfterClose, getFramingOverhead(payloadSize));
        return {};
    }

    this->sendWebSocketString(message, Opcode::Text);

    return {};
}

ExceptionOr<void> WebSocket::send(ArrayBuffer& binaryData)
{
    // LOG(Network, "WebSocket %p send() Sending ArrayBuffer %p", this, &binaryData);
    if (m_state == CONNECTING)
        return Exception { InvalidStateError };
    if (m_state == CLOSING || m_state == CLOSED) {
        unsigned payloadSize = binaryData.byteLength();
        m_bufferedAmountAfterClose = saturateAdd(m_bufferedAmountAfterClose, payloadSize);
        m_bufferedAmountAfterClose = saturateAdd(m_bufferedAmountAfterClose, getFramingOverhead(payloadSize));
        return {};
    }
    char* data = static_cast<char*>(binaryData.data());
    size_t length = binaryData.byteLength();

    this->sendWebSocketData(data, length, Opcode::Binary);

    return {};
}

ExceptionOr<void> WebSocket::send(ArrayBufferView& arrayBufferView)
{
    // LOG(Network, "WebSocket %p send() Sending ArrayBufferView %p", this, &arrayBufferView);

    if (m_state == CONNECTING)
        return Exception { InvalidStateError };
    if (m_state == CLOSING || m_state == CLOSED) {
        unsigned payloadSize = arrayBufferView.byteLength();
        m_bufferedAmountAfterClose = saturateAdd(m_bufferedAmountAfterClose, payloadSize);
        m_bufferedAmountAfterClose = saturateAdd(m_bufferedAmountAfterClose, getFramingOverhead(payloadSize));
        return {};
    }

    auto bufferRef = arrayBufferView.unsharedBuffer();
    auto* buffer = bufferRef.get();
    char* baseAddress = reinterpret_cast<char*>(buffer->data()) + arrayBufferView.byteOffset();
    size_t length = arrayBufferView.byteLength();
    this->sendWebSocketData(baseAddress, length, Opcode::Binary);

    return {};
}

WebCore::ExceptionOr<void> WebCore::WebSocket::send(WebCore::JSBlob* blob)
{
    if (m_state == CONNECTING)
        return Exception { InvalidStateError };
    if (m_state == CLOSING || m_state == CLOSED) {
        return {};
    }

    // Get the blob data and send it using existing binary data path
    void* dataPtr = Blob__getDataPtr(JSC::JSValue::encode(blob));
    size_t dataSize = Blob__getSize(JSC::JSValue::encode(blob));

    if (dataPtr && dataSize > 0) {
        this->sendWebSocketData(static_cast<const char*>(dataPtr), dataSize, Opcode::Binary);
    } else {
        // Send empty frame for empty blobs
        this->sendWebSocketData(nullptr, 0, Opcode::Binary);
    }

    return {};
}

void WebSocket::sendWebSocketData(const char* baseAddress, size_t length, const Opcode op)
{
    switch (m_connectedWebSocketKind) {
    case ConnectedWebSocketKind::Client: {
        Bun__WebSocketClient__writeBinaryData(this->m_connectedWebSocket.client, reinterpret_cast<const unsigned char*>(baseAddress), length, static_cast<uint8_t>(op));
        // this->m_connectedWebSocket.client->send({ baseAddress, length }, opCode);
        // this->m_bufferedAmount = this->m_connectedWebSocket.client->getBufferedAmount();
        break;
    }
    case ConnectedWebSocketKind::ClientSSL: {
        Bun__WebSocketClientTLS__writeBinaryData(this->m_connectedWebSocket.clientSSL, reinterpret_cast<const unsigned char*>(baseAddress), length, static_cast<uint8_t>(op));
        break;
    }
    // case ConnectedWebSocketKind::Server: {
    //     this->m_connectedWebSocket.server->send({ baseAddress, length }, opCode);
    //     this->m_bufferedAmount = this->m_connectedWebSocket.server->getBufferedAmount();
    //     break;
    // }
    // case ConnectedWebSocketKind::ServerSSL: {
    //     this->m_connectedWebSocket.serverSSL->send({ baseAddress, length }, opCode);
    //     this->m_bufferedAmount = this->m_connectedWebSocket.serverSSL->getBufferedAmount();
    //     break;
    // }
    default: {
        RELEASE_ASSERT_NOT_REACHED();
    }
    }
}

void WebSocket::sendWebSocketString(const String& message, const Opcode op)
{
    switch (m_connectedWebSocketKind) {
    case ConnectedWebSocketKind::Client: {
        auto zigStr = Zig::toZigString(message);
        Bun__WebSocketClient__writeString(this->m_connectedWebSocket.client, &zigStr, static_cast<uint8_t>(op));
        // this->m_connectedWebSocket.client->send({ baseAddress, length }, opCode);
        // this->m_bufferedAmount = this->m_connectedWebSocket.client->getBufferedAmount();
        break;
    }
    case ConnectedWebSocketKind::ClientSSL: {
        auto zigStr = Zig::toZigString(message);
        Bun__WebSocketClientTLS__writeString(this->m_connectedWebSocket.clientSSL, &zigStr, static_cast<uint8_t>(op));
        break;
    }
    // case ConnectedWebSocketKind::Server: {
    //     auto utf8 = message.utf8(StrictConversionReplacingUnpairedSurrogatesWithFFFD);
    //     this->m_connectedWebSocket.server->send({ utf8.data(), utf8.length() }, uWS::OpCode::TEXT);
    //     this->m_bufferedAmount = this->m_connectedWebSocket.server->getBufferedAmount();
    //     break;
    // }
    // case ConnectedWebSocketKind::ServerSSL: {
    //     auto utf8 = message.utf8(StrictConversionReplacingUnpairedSurrogatesWithFFFD);
    //     this->m_connectedWebSocket.serverSSL->send({ utf8.data(), utf8.length() }, uWS::OpCode::TEXT);
    //     this->m_bufferedAmount = this->m_connectedWebSocket.serverSSL->getBufferedAmount();
    //     break;
    // }
    default: {
        RELEASE_ASSERT_NOT_REACHED();
    }
    }
    updateHasPendingActivity();
}

ExceptionOr<void> WebSocket::close(std::optional<unsigned short> optionalCode, const String& reason)
{
    int code = optionalCode ? optionalCode.value() : static_cast<int>(1000);
    if (code == 1000) {
        // LOG(Network, "WebSocket %p close() without code and reason", this);
    } else {
        // LOG(Network, "WebSocket %p close() code=%d reason='%s'", this, code, reason.utf8().data());
        // if (!(code == WebSocketChannel::CloseEventCodeNormalClosure || (WebSocketChannel::CloseEventCodeMinimumUserDefined <= code && code <= WebSocketChannel::CloseEventCodeMaximumUserDefined)))
        //     return Exception { InvalidAccessError };
        if (reason.length() > maxReasonSizeInBytes) {
            // scriptExecutionContext()->addConsoleMessage(MessageSource::JS, MessageLevel::Error, "WebSocket close message is too long."_s);
            return Exception { SyntaxError, "WebSocket close message is too long."_s };
        }
    }

    if (m_state == CLOSING || m_state == CLOSED)
        return {};
    if (m_state == CONNECTING) {
        m_state = CLOSING;
        if (m_upgradeClient != nullptr) {
            void* upgradeClient = m_upgradeClient;
            m_upgradeClient = nullptr;
            bool useTLSClient = (m_connectionType == ConnectionType::TLS || m_connectionType == ConnectionType::ProxyTLS);
            if (useTLSClient) {
                Bun__WebSocketHTTPSClient__cancel(upgradeClient);
            } else {
                Bun__WebSocketHTTPClient__cancel(upgradeClient);
            }
        }
        updateHasPendingActivity();
        return {};
    }
    m_state = CLOSING;
    switch (m_connectedWebSocketKind) {
    case ConnectedWebSocketKind::Client: {
        ZigString reasonZigStr = Zig::toZigString(reason);
        Bun__WebSocketClient__close(this->m_connectedWebSocket.client, code, &reasonZigStr);
        updateHasPendingActivity();
        // this->m_bufferedAmount = this->m_connectedWebSocket.client->getBufferedAmount();
        break;
    }
    case ConnectedWebSocketKind::ClientSSL: {
        ZigString reasonZigStr = Zig::toZigString(reason);
        Bun__WebSocketClientTLS__close(this->m_connectedWebSocket.clientSSL, code, &reasonZigStr);
        updateHasPendingActivity();
        // this->m_bufferedAmount = this->m_connectedWebSocket.clientSSL->getBufferedAmount();
        break;
    }
    // case ConnectedWebSocketKind::Server: {
    // this->m_connectedWebSocket.server->end(code, { utf8.data(), utf8.length() });
    // this->m_bufferedAmount = this->m_connectedWebSocket.server->getBufferedAmount();
    //     break;
    // }
    // case ConnectedWebSocketKind::ServerSSL: {
    //     // this->m_connectedWebSocket.serverSSL->end(code, { utf8.data(), utf8.length() });
    //     // this->m_bufferedAmount = this->m_connectedWebSocket.serverSSL->getBufferedAmount();
    //     break;
    // }
    default: {
        break;
    }
    }
    this->m_connectedWebSocketKind = ConnectedWebSocketKind::None;
    updateHasPendingActivity();
    return {};
}

ExceptionOr<void> WebSocket::terminate()
{
    // LOG(Network, "WebSocket %p terminate()", this);

    if (m_state == CLOSING || m_state == CLOSED)
        return {};
    if (m_state == CONNECTING) {
        m_state = CLOSING;
        if (m_upgradeClient != nullptr) {
            void* upgradeClient = m_upgradeClient;
            m_upgradeClient = nullptr;
            bool useTLSClient = (m_connectionType == ConnectionType::TLS || m_connectionType == ConnectionType::ProxyTLS);
            if (useTLSClient) {
                Bun__WebSocketHTTPSClient__cancel(upgradeClient);
            } else {
                Bun__WebSocketHTTPClient__cancel(upgradeClient);
            }
        }
        updateHasPendingActivity();
        return {};
    }
    m_state = CLOSING;
    switch (m_connectedWebSocketKind) {
    case ConnectedWebSocketKind::Client: {
        Bun__WebSocketClient__cancel(this->m_connectedWebSocket.client);
        updateHasPendingActivity();
        break;
    }
    case ConnectedWebSocketKind::ClientSSL: {
        Bun__WebSocketClientTLS__cancel(this->m_connectedWebSocket.clientSSL);
        updateHasPendingActivity();
        break;
    }
    default: {
        break;
    }
    }
    this->m_connectedWebSocketKind = ConnectedWebSocketKind::None;
    updateHasPendingActivity();
    return {};
}

ExceptionOr<void> WebSocket::ping()
{
    auto message = WTF::String::number(WTF::jsCurrentTime());
    // LOG(Network, "WebSocket %p ping() Sending Timestamp '%s'", this, message.data());
    if (m_state == CONNECTING)
        return Exception { InvalidStateError };

    // No exception is raised if the connection was once established but has subsequently been closed.
    if (m_state == CLOSING || m_state == CLOSED) {
        size_t payloadSize = message.length();
        m_bufferedAmountAfterClose = saturateAdd(m_bufferedAmountAfterClose, payloadSize);
        m_bufferedAmountAfterClose = saturateAdd(m_bufferedAmountAfterClose, getFramingOverhead(payloadSize));
        return {};
    }

    this->sendWebSocketString(message, Opcode::Ping);

    return {};
}

ExceptionOr<void> WebSocket::ping(const String& message)
{
    // LOG(Network, "WebSocket %p ping() Sending String '%s'", this, message.utf8().data());
    if (m_state == CONNECTING)
        return Exception { InvalidStateError };

    // No exception is raised if the connection was once established but has subsequently been closed.
    if (m_state == CLOSING || m_state == CLOSED) {
        auto utf8 = message.utf8(StrictConversionReplacingUnpairedSurrogatesWithFFFD);
        size_t payloadSize = utf8.length();
        m_bufferedAmountAfterClose = saturateAdd(m_bufferedAmountAfterClose, payloadSize);
        m_bufferedAmountAfterClose = saturateAdd(m_bufferedAmountAfterClose, getFramingOverhead(payloadSize));
        return {};
    }

    this->sendWebSocketString(message, Opcode::Ping);

    return {};
}

ExceptionOr<void> WebSocket::ping(ArrayBuffer& binaryData)
{
    // LOG(Network, "WebSocket %p ping() Sending ArrayBuffer %p", this, &binaryData);
    if (m_state == CONNECTING)
        return Exception { InvalidStateError };

    if (m_state == CLOSING || m_state == CLOSED) {
        unsigned payloadSize = binaryData.byteLength();
        m_bufferedAmountAfterClose = saturateAdd(m_bufferedAmountAfterClose, payloadSize);
        m_bufferedAmountAfterClose = saturateAdd(m_bufferedAmountAfterClose, getFramingOverhead(payloadSize));
        return {};
    }

    char* data = static_cast<char*>(binaryData.data());
    size_t length = binaryData.byteLength();
    this->sendWebSocketData(data, length, Opcode::Ping);

    return {};
}

ExceptionOr<void> WebSocket::ping(ArrayBufferView& arrayBufferView)
{
    // LOG(Network, "WebSocket %p ping() Sending ArrayBufferView %p", this, &arrayBufferView);

    if (m_state == CONNECTING)
        return Exception { InvalidStateError };

    if (m_state == CLOSING || m_state == CLOSED) {
        unsigned payloadSize = arrayBufferView.byteLength();
        m_bufferedAmountAfterClose = saturateAdd(m_bufferedAmountAfterClose, payloadSize);
        m_bufferedAmountAfterClose = saturateAdd(m_bufferedAmountAfterClose, getFramingOverhead(payloadSize));
        return {};
    }

    auto bufferRef = arrayBufferView.unsharedBuffer();
    auto* buffer = bufferRef.get();
    char* baseAddress = reinterpret_cast<char*>(buffer->data()) + arrayBufferView.byteOffset();
    size_t length = arrayBufferView.byteLength();
    this->sendWebSocketData(baseAddress, length, Opcode::Ping);

    return {};
}

ExceptionOr<void> WebSocket::pong()
{
    auto message = WTF::String::number(WTF::jsCurrentTime());
    // LOG(Network, "WebSocket %p pong() Sending Timestamp '%s'", this, message.data());
    if (m_state == CONNECTING)
        return Exception { InvalidStateError };

    // No exception is raised if the connection was once established but has subsequently been closed.
    if (m_state == CLOSING || m_state == CLOSED) {
        size_t payloadSize = message.length();
        m_bufferedAmountAfterClose = saturateAdd(m_bufferedAmountAfterClose, payloadSize);
        m_bufferedAmountAfterClose = saturateAdd(m_bufferedAmountAfterClose, getFramingOverhead(payloadSize));
        return {};
    }

    this->sendWebSocketString(message, Opcode::Pong);

    return {};
}

ExceptionOr<void> WebSocket::pong(const String& message)
{
    // LOG(Network, "WebSocket %p pong() Sending String '%s'", this, message.utf8().data());
    if (m_state == CONNECTING)
        return Exception { InvalidStateError };

    // No exception is raised if the connection was once established but has subsequently been closed.
    if (m_state == CLOSING || m_state == CLOSED) {
        auto utf8 = message.utf8(StrictConversionReplacingUnpairedSurrogatesWithFFFD);
        size_t payloadSize = utf8.length();
        m_bufferedAmountAfterClose = saturateAdd(m_bufferedAmountAfterClose, payloadSize);
        m_bufferedAmountAfterClose = saturateAdd(m_bufferedAmountAfterClose, getFramingOverhead(payloadSize));
        return {};
    }

    this->sendWebSocketString(message, Opcode::Pong);

    return {};
}

ExceptionOr<void> WebSocket::pong(ArrayBuffer& binaryData)
{
    // LOG(Network, "WebSocket %p pong() Sending ArrayBuffer %p", this, &binaryData);
    if (m_state == CONNECTING)
        return Exception { InvalidStateError };

    if (m_state == CLOSING || m_state == CLOSED) {
        unsigned payloadSize = binaryData.byteLength();
        m_bufferedAmountAfterClose = saturateAdd(m_bufferedAmountAfterClose, payloadSize);
        m_bufferedAmountAfterClose = saturateAdd(m_bufferedAmountAfterClose, getFramingOverhead(payloadSize));
        return {};
    }

    char* data = static_cast<char*>(binaryData.data());
    size_t length = binaryData.byteLength();
    this->sendWebSocketData(data, length, Opcode::Pong);

    return {};
}

ExceptionOr<void> WebSocket::pong(ArrayBufferView& arrayBufferView)
{
    // LOG(Network, "WebSocket %p pong() Sending ArrayBufferView %p", this, &arrayBufferView);

    if (m_state == CONNECTING)
        return Exception { InvalidStateError };

    if (m_state == CLOSING || m_state == CLOSED) {
        unsigned payloadSize = arrayBufferView.byteLength();
        m_bufferedAmountAfterClose = saturateAdd(m_bufferedAmountAfterClose, payloadSize);
        m_bufferedAmountAfterClose = saturateAdd(m_bufferedAmountAfterClose, getFramingOverhead(payloadSize));
        return {};
    }

    auto bufferRef = arrayBufferView.unsharedBuffer();
    auto* buffer = bufferRef.get();
    char* baseAddress = reinterpret_cast<char*>(buffer->data()) + arrayBufferView.byteOffset();
    size_t length = arrayBufferView.byteLength();
    this->sendWebSocketData(baseAddress, length, Opcode::Pong);

    return {};
}

const URL& WebSocket::url() const
{
    return m_url;
}

WebSocket::State WebSocket::readyState() const
{
    return m_state;
}

unsigned WebSocket::bufferedAmount() const
{
    return saturateAdd(m_bufferedAmount, m_bufferedAmountAfterClose);
}

String WebSocket::protocol() const
{
    return m_subprotocol;
}

String WebSocket::extensions() const
{
    return m_extensions;
}

String WebSocket::binaryType() const
{
    switch (m_binaryType) {
    case BinaryType::NodeBuffer:
        return "nodebuffer"_s;
    case BinaryType::ArrayBuffer:
        return "arraybuffer"_s;
    case BinaryType::Blob:
        return "blob"_s;
    }

    ASSERT_NOT_REACHED();
    return String();
}

ExceptionOr<void> WebSocket::setBinaryType(const String& binaryType)
{
    if (binaryType == "blob"_s) {
        m_binaryType = BinaryType::Blob;
        return {};
    }
    if (binaryType == "arraybuffer"_s) {
        m_binaryType = BinaryType::ArrayBuffer;
        return {};
    } else if (binaryType == "nodebuffer"_s) {
        m_binaryType = BinaryType::NodeBuffer;
        return {};
    }
    // scriptExecutionContext()->addConsoleMessage(MessageSource::JS, MessageLevel::Error, "'" + binaryType + "' is not a valid value for binaryType; binaryType remains unchanged.");
    return Exception { SyntaxError, makeString("'"_s, binaryType, "' is not a valid value for binaryType; binaryType remains unchanged."_s) };
}

EventTargetInterface WebSocket::eventTargetInterface() const
{
    return WebSocketEventTargetInterfaceType;
}

ScriptExecutionContext* WebSocket::scriptExecutionContext() const
{
    return ContextDestructionObserver::scriptExecutionContext();
}

// void WebSocket::contextDestroyed()
// {
// LOG(Network, "WebSocket %p contextDestroyed()", this);
//     ASSERT(!m_channel);
//     ASSERT(m_state == CLOSED);
//     // ActiveDOMObject::contextDestroyed();
// }

// void WebSocket::suspend(ReasonForSuspension reason)
// {
//     // if (!m_channel)
//     //     return;

//     // if (reason == ReasonForSuspension::BackForwardCache) {
//     //     // This will cause didClose() to be called.
//     //     m_channel->fail("WebSocket is closed due to suspension."_s);
//     //     return;
//     // }

//     // m_channel->suspend();
// }

// void WebSocket::resume()
// {
//     // if (m_channel)
//     //     m_channel->resume();
// }

// void WebSocket::stop()
// {
//     if (m_channel)
//         m_channel->disconnect();
//     m_channel = nullptr;
//     m_state = CLOSED;
//     // ActiveDOMObject::stop();
//     // m_pendingActivity = nullptr;
// }

// const char* WebSocket::activeDOMObjectName() const
// {
//     return "WebSocket";
// }

void WebSocket::didConnect()
{
    // from new WebSocket() -> connect()

    // LOG(Network, "WebSocket %p didConnect()", this);
    // queueTaskKeepingObjectAlive(*this, TaskSource::WebSocket, [this] {
    if (m_state == CLOSED)
        return;
    if (m_state != CONNECTING) {
        didClose(0, 0, emptyString());
        return;
    }
    m_state = OPEN;

    if (auto* context = scriptExecutionContext()) {

        if (this->hasEventListeners("open"_s)) {
            this->incPendingActivityCount();
            // the main reason for dispatching on a separate tick is to handle when you haven't yet attached an event listener
            dispatchEvent(Event::create(eventNames().openEvent, Event::CanBubble::No, Event::IsCancelable::No));
            this->decPendingActivityCount();
        } else {
            this->incPendingActivityCount();
            context->postTask([this, protectedThis = Ref { *this }](ScriptExecutionContext& context) {
                ASSERT(scriptExecutionContext());
                protectedThis->dispatchEvent(Event::create(eventNames().openEvent, Event::CanBubble::No, Event::IsCancelable::No));
                protectedThis->decPendingActivityCount();
            });
        }
    }
}

void WebSocket::didReceiveMessage(String&& message)
{
    // LOG(Network, "WebSocket %p didReceiveMessage() Text message '%s'", this, message.utf8().data());
    // queueTaskKeepingObjectAlive(*this, TaskSource::WebSocket, [this, message = WTF::move(message)]() mutable {
    if (m_state != OPEN)
        return;

    // if (InspectorInstrumentation::hasFrontends()) [[unlikely]] {
    //     if (auto* inspector = m_channel->channelInspector()) {
    //         auto utf8Message = message.utf8();
    //         inspector->didReceiveWebSocketFrame(WebSocketChannelInspector::createFrame(utf8Message.dataAsUInt8Ptr(), utf8Message.length(), WebSocketFrame::OpCode::OpCodeText));
    //     }
    // }

    if (this->hasEventListeners("message"_s)) {
        // the main reason for dispatching on a separate tick is to handle when you haven't yet attached an event listener
        this->incPendingActivityCount();
        dispatchEvent(MessageEvent::create(WTF::move(message), m_url.string()));
        this->decPendingActivityCount();
        return;
    }

    if (auto* context = scriptExecutionContext()) {
        this->incPendingActivityCount();
        context->postTask([this, message_ = WTF::move(message), protectedThis = Ref { *this }](ScriptExecutionContext& context) {
            ASSERT(scriptExecutionContext());
            protectedThis->dispatchEvent(MessageEvent::create(message_, protectedThis->m_url.string()));
            protectedThis->decPendingActivityCount();
        });
    }

    // });
}

void WebSocket::didReceiveBinaryData(const AtomString& eventName, const std::span<const uint8_t> binaryData)
{
    // LOG(Network, "WebSocket %p didReceiveBinaryData() %u byte binary message", this, static_cast<unsigned>(binaryData.size()));
    // queueTaskKeepingObjectAlive(*this, TaskSource::WebSocket, [this, binaryData = WTF::move(binaryData)]() mutable {
    if (m_state != OPEN)
        return;

    // if (InspectorInstrumentation::hasFrontends()) [[unlikely]] {
    //     if (auto* inspector = m_channel->channelInspector())
    //         inspector->didReceiveWebSocketFrame(WebSocketChannelInspector::createFrame(binaryData.data(), binaryData.size(), WebSocketFrame::OpCode::OpCodeBinary));
    // }
    switch (m_binaryType) {
    case BinaryType::Blob:
        if (this->hasEventListeners(eventName)) {
            // the main reason for dispatching on a separate tick is to handle when you haven't yet attached an event listener
            this->incPendingActivityCount();
            RefPtr<Blob> blob = Blob::create(binaryData, scriptExecutionContext()->jsGlobalObject());
            dispatchEvent(MessageEvent::create(eventName, blob.releaseNonNull(), m_url.string()));
            this->decPendingActivityCount();
            return;
        }

        if (auto* context = scriptExecutionContext()) {
            RefPtr<Blob> blob = Blob::create(binaryData, context->jsGlobalObject());
            context->postTask([this, name = eventName, blob = blob.releaseNonNull(), protectedThis = Ref { *this }](ScriptExecutionContext& context) {
                ASSERT(scriptExecutionContext());
                protectedThis->dispatchEvent(MessageEvent::create(name, blob, protectedThis->m_url.string()));
                protectedThis->decPendingActivityCount();
            });
        }

        break;
    case BinaryType::ArrayBuffer: {
        if (this->hasEventListeners(eventName)) {
            // the main reason for dispatching on a separate tick is to handle when you haven't yet attached an event listener
            this->incPendingActivityCount();
            dispatchEvent(MessageEvent::create(eventName, ArrayBuffer::create(binaryData), m_url.string()));
            this->decPendingActivityCount();
            return;
        }

        if (auto* context = scriptExecutionContext()) {
            auto arrayBuffer = JSC::ArrayBuffer::create(binaryData);
            this->incPendingActivityCount();
            context->postTask([this, name = eventName, buffer = WTF::move(arrayBuffer), protectedThis = Ref { *this }](ScriptExecutionContext& context) {
                ASSERT(scriptExecutionContext());
                protectedThis->dispatchEvent(MessageEvent::create(name, buffer, m_url.string()));
                protectedThis->decPendingActivityCount();
            });
        }

        break;
    }
    case BinaryType::NodeBuffer: {

        if (this->hasEventListeners(eventName)) {
            // the main reason for dispatching on a separate tick is to handle when you haven't yet attached an event listener
            this->incPendingActivityCount();
            auto scope = DECLARE_TOP_EXCEPTION_SCOPE(scriptExecutionContext()->vm());
            JSUint8Array* buffer = createBuffer(scriptExecutionContext()->jsGlobalObject(), binaryData);

            if (!buffer || scope.exception()) [[unlikely]] {
                scope.clearExceptionExceptTermination();

                ErrorEvent::Init errorInit;
                errorInit.message = "Failed to allocate memory for binary data"_s;
                dispatchEvent(ErrorEvent::create(eventNames().errorEvent, errorInit));
                this->decPendingActivityCount();
                return;
            }

            JSC::EnsureStillAliveScope ensureStillAlive(buffer);
            MessageEvent::Init init;
            init.data = buffer;
            init.origin = this->m_url.string();

            dispatchEvent(MessageEvent::create(eventName, WTF::move(init), EventIsTrusted::Yes));
            this->decPendingActivityCount();
            return;
        }

        if (auto* context = scriptExecutionContext()) {
            auto arrayBuffer = JSC::ArrayBuffer::tryCreate(binaryData);

            this->incPendingActivityCount();

            context->postTask([name = eventName, buffer = WTF::move(arrayBuffer), protectedThis = Ref { *this }](ScriptExecutionContext& context) {
                size_t length = buffer->byteLength();
                auto* globalObject = context.jsGlobalObject();
                auto* subclassStructure = static_cast<Zig::GlobalObject*>(globalObject)->JSBufferSubclassStructure();
                JSUint8Array* uint8array = JSUint8Array::create(globalObject, subclassStructure, buffer.copyRef(), 0, length);
                JSC::EnsureStillAliveScope ensureStillAlive(uint8array);
                MessageEvent::Init init;
                init.data = uint8array;
                init.origin = protectedThis->m_url.string();
                protectedThis->dispatchEvent(MessageEvent::create(name, WTF::move(init), EventIsTrusted::Yes));
                protectedThis->decPendingActivityCount();
            });
        }

        break;
    }
    }
    // });
}

void WebSocket::didReceiveClose(CleanStatus wasClean, unsigned short code, WTF::String reason, bool isConnectionError)
{
    // LOG(Network, "WebSocket %p didReceiveErrorMessage()", this);
    // queueTaskKeepingObjectAlive(*this, TaskSource::WebSocket, [this, reason = WTF::move(reason)] {
    if (m_state == CLOSED)
        return;
    const bool wasConnecting = m_state == CONNECTING;
    m_state = CLOSED;
    if (auto* context = scriptExecutionContext()) {
        this->incPendingActivityCount();
        if (wasConnecting && isConnectionError) {
            auto eventInit = createErrorEventInit(*this, reason, context->jsGlobalObject());
            dispatchEvent(ErrorEvent::create(eventNames().errorEvent, WTF::move(eventInit), EventIsTrusted::Yes));
        }
        // https://html.spec.whatwg.org/multipage/web-sockets.html#feedback-from-the-protocol:concept-websocket-closed, we should synchronously fire a close event.
        dispatchEvent(CloseEvent::create(wasClean == CleanStatus::Clean, code, reason));
        this->decPendingActivityCount();
    }
}

void WebSocket::didUpdateBufferedAmount(unsigned bufferedAmount)
{
    // LOG(Network, "WebSocket %p didUpdateBufferedAmount() New bufferedAmount is %u", this, bufferedAmount);
    if (m_state == CLOSED)
        return;
    m_bufferedAmount = bufferedAmount;
}

void WebSocket::didStartClosingHandshake()
{
    // LOG(Network, "WebSocket %p didStartClosingHandshake()", this);
    // queueTaskKeepingObjectAlive(*this, TaskSource::WebSocket, [this] {
    if (m_state == CLOSED)
        return;
    m_state = CLOSING;
    updateHasPendingActivity();
    // });
}

void WebSocket::didClose(unsigned unhandledBufferedAmount, unsigned short code, const String& reason)
{
    // LOG(Network, "WebSocket %p didClose()", this);
    if (this->m_connectedWebSocketKind == ConnectedWebSocketKind::None)
        return;

    // queueTaskKeepingObjectAlive(*this, TaskSource::WebSocket, [this, unhandledBufferedAmount, closingHandshakeCompletion, code, reason] {
    // if (!m_channel)
    //     return;

    // if (InspectorInstrumentation::hasFrontends()) [[unlikely]] {
    //     if (auto* inspector = m_channel->channelInspector()) {
    //         WebSocketFrame closingFrame(WebSocketFrame::OpCodeClose, true, false, false);
    //         inspector->didReceiveWebSocketFrame(closingFrame);
    //         inspector->didCloseWebSocket();
    //     }
    // }

    bool wasClean = m_state == CLOSING && !unhandledBufferedAmount && code != 0; // WebSocketChannel::CloseEventCodeAbnormalClosure;
    m_state = CLOSED;
    m_bufferedAmount = unhandledBufferedAmount;
    ASSERT(scriptExecutionContext());
    this->m_connectedWebSocketKind = ConnectedWebSocketKind::None;
    this->m_upgradeClient = nullptr;

    // since we are open and closing now we know that we have at least one pending activity
    // so we just call decPendingActivityCount() after dispatching the event
    ASSERT(m_pendingActivityCount > 0);

    if (this->hasEventListeners("close"_s)) {
        this->dispatchEvent(CloseEvent::create(wasClean, code, reason));

        // we deinit if possible in the next tick
        if (auto* context = scriptExecutionContext()) {
            context->postTask([this, protectedThis = Ref { *this }](ScriptExecutionContext& context) {
                ASSERT(scriptExecutionContext());
                protectedThis->disablePendingActivity();
            });
            return;
        }
    } else if (auto* context = scriptExecutionContext()) {
        context->postTask([this, code, wasClean, reason, protectedThis = Ref { *this }](ScriptExecutionContext& context) {
            ASSERT(scriptExecutionContext());
            protectedThis->dispatchEvent(CloseEvent::create(wasClean, code, reason));
            protectedThis->disablePendingActivity();
        });
        return;
    }

    this->disablePendingActivity();
}

void WebSocket::didConnect(us_socket_t* socket, char* bufferedData, size_t bufferedDataSize, const PerMessageDeflateParams* deflate_params, void* customSSLCtx)
{
    this->m_upgradeClient = nullptr;
    setExtensionsFromDeflateParams(deflate_params);

    // Use TLS WebSocket client if connection type is TLS or ProxyTLS.
    // For TLS: direct wss:// connection, socket is already TLS.
    // For ProxyTLS: connected through HTTPS proxy, socket is TLS (even for ws:// target).
    // For Plain/ProxyPlain: socket is not TLS.
    bool useTLSSocket = (m_connectionType == ConnectionType::TLS || m_connectionType == ConnectionType::ProxyTLS);

    if (useTLSSocket) {
        us_socket_context_t* ctx = (us_socket_context_t*)this->scriptExecutionContext()->connectedWebSocketContext<true, false>();
        this->m_connectedWebSocket.clientSSL = Bun__WebSocketClientTLS__init(reinterpret_cast<CppWebSocket*>(this), socket, ctx, this->scriptExecutionContext()->jsGlobalObject(), reinterpret_cast<unsigned char*>(bufferedData), bufferedDataSize, deflate_params, customSSLCtx);
        this->m_connectedWebSocketKind = ConnectedWebSocketKind::ClientSSL;
    } else {
        us_socket_context_t* ctx = (us_socket_context_t*)this->scriptExecutionContext()->connectedWebSocketContext<false, false>();
        this->m_connectedWebSocket.client = Bun__WebSocketClient__init(reinterpret_cast<CppWebSocket*>(this), socket, ctx, this->scriptExecutionContext()->jsGlobalObject(), reinterpret_cast<unsigned char*>(bufferedData), bufferedDataSize, deflate_params, customSSLCtx);
        this->m_connectedWebSocketKind = ConnectedWebSocketKind::Client;
    }

    this->didConnect();
}

void WebSocket::didFailWithErrorCode(Bun::WebSocketErrorCode code)
{
    // from new WebSocket() -> connect()

    if (m_state == CLOSED)
        return;

    this->m_upgradeClient = nullptr;
    if (this->m_connectedWebSocketKind == ConnectedWebSocketKind::ClientSSL) {
        this->m_connectedWebSocket.clientSSL = nullptr;
    } else if (this->m_connectedWebSocketKind == ConnectedWebSocketKind::Client) {
        this->m_connectedWebSocket.client = nullptr;
    }
    this->m_connectedWebSocketKind = ConnectedWebSocketKind::None;
    switch (code) {

    case Bun::WebSocketErrorCode::cancel: {
        didReceiveClose(CleanStatus::NotClean, 1000, "Connection cancelled"_s);
        break;
    }
    case Bun::WebSocketErrorCode::invalid_response: {
        didReceiveClose(CleanStatus::NotClean, 1002, "Invalid response"_s, true);
        break;
    }
    case Bun::WebSocketErrorCode::expected_101_status_code: {
        didReceiveClose(CleanStatus::NotClean, 1002, "Expected 101 status code"_s, true);
        break;
    }
    case Bun::WebSocketErrorCode::missing_upgrade_header: {
        didReceiveClose(CleanStatus::NotClean, 1002, "Missing upgrade header"_s, true);
        break;
    }
    case Bun::WebSocketErrorCode::missing_connection_header: {
        didReceiveClose(CleanStatus::NotClean, 1002, "Missing connection header"_s, true);
        break;
    }
    case Bun::WebSocketErrorCode::missing_websocket_accept_header: {
        didReceiveClose(CleanStatus::NotClean, 1002, "Missing websocket accept header"_s, true);
        break;
    }
    case Bun::WebSocketErrorCode::invalid_upgrade_header: {
        didReceiveClose(CleanStatus::NotClean, 1002, "Invalid upgrade header"_s, true);
        break;
    }
    case Bun::WebSocketErrorCode::invalid_connection_header: {
        didReceiveClose(CleanStatus::NotClean, 1002, "Invalid connection header"_s, true);
        break;
    }
    case Bun::WebSocketErrorCode::invalid_websocket_version: {
        didReceiveClose(CleanStatus::NotClean, 1002, "Invalid websocket version"_s, true);
        break;
    }
    case Bun::WebSocketErrorCode::mismatch_websocket_accept_header: {
        didReceiveClose(CleanStatus::NotClean, 1002, "Mismatch websocket accept header"_s, true);
        break;
    }
    case Bun::WebSocketErrorCode::missing_client_protocol: {
        didReceiveClose(CleanStatus::Clean, 1002, "Missing client protocol"_s);
        break;
    }
    case Bun::WebSocketErrorCode::mismatch_client_protocol: {
        didReceiveClose(CleanStatus::Clean, 1002, "Mismatch client protocol"_s);
        break;
    }
    case Bun::WebSocketErrorCode::timeout: {
        didReceiveClose(CleanStatus::Clean, 1013, "Timeout"_s);
        break;
    }
    case Bun::WebSocketErrorCode::closed: {
        didReceiveClose(CleanStatus::Clean, 1000, "Closed by client"_s);
        break;
    }
    case Bun::WebSocketErrorCode::failed_to_write: {
        didReceiveClose(CleanStatus::NotClean, 1006, "Failed to write"_s);
        break;
    }
    case Bun::WebSocketErrorCode::failed_to_connect: {
        didReceiveClose(CleanStatus::NotClean, 1006, "Failed to connect"_s, true);
        break;
    }
    case Bun::WebSocketErrorCode::headers_too_large: {
        didReceiveClose(CleanStatus::NotClean, 1007, "Headers too large"_s, true);
        break;
    }
    case Bun::WebSocketErrorCode::ended: {
        didReceiveClose(CleanStatus::NotClean, 1006, "Connection ended"_s, true);
        break;
    }

    case Bun::WebSocketErrorCode::failed_to_allocate_memory: {
        didReceiveClose(CleanStatus::NotClean, 1001, "Failed to allocate memory"_s);
        break;
    }
    case Bun::WebSocketErrorCode::control_frame_is_fragmented: {
        didReceiveClose(CleanStatus::NotClean, 1002, "Protocol error - control frame is fragmented"_s);
        break;
    }
    case Bun::WebSocketErrorCode::invalid_control_frame: {
        didReceiveClose(CleanStatus::NotClean, 1002, "Protocol error - invalid control frame"_s);
        break;
    }
    case Bun::WebSocketErrorCode::compression_unsupported: {
        didReceiveClose(CleanStatus::Clean, 1011, "Compression not implemented yet"_s);
        break;
    }
    case Bun::WebSocketErrorCode::unexpected_mask_from_server: {
        didReceiveClose(CleanStatus::NotClean, 1002, "Protocol error - unexpected mask from server"_s);
        break;
    }
    case Bun::WebSocketErrorCode::expected_control_frame: {
        didReceiveClose(CleanStatus::NotClean, 1002, "Protocol error - expected control frame"_s);
        break;
    }
    case Bun::WebSocketErrorCode::unsupported_control_frame: {
        didReceiveClose(CleanStatus::NotClean, 1002, "Protocol error - unsupported control frame"_s);
        break;
    }
    case Bun::WebSocketErrorCode::unexpected_opcode: {
        didReceiveClose(CleanStatus::NotClean, 1002, "Protocol error - unexpected opcode"_s);
        break;
    }
    case Bun::WebSocketErrorCode::invalid_utf8: {
        didReceiveClose(CleanStatus::NotClean, 1003, "Server sent invalid UTF8"_s);
        break;
    }
    case Bun::WebSocketErrorCode::tls_handshake_failed: {
        didReceiveClose(CleanStatus::NotClean, 1015, "TLS handshake failed"_s, true);
        break;
    }
    case Bun::WebSocketErrorCode::message_too_big: {
        didReceiveClose(CleanStatus::NotClean, 1009, "Message too big"_s);
        break;
    }
    case Bun::WebSocketErrorCode::protocol_error: {
        didReceiveClose(CleanStatus::NotClean, 1002, "Protocol error"_s);
        break;
    }
    case Bun::WebSocketErrorCode::compression_failed: {
        didReceiveClose(CleanStatus::NotClean, 1002, "Compression failed"_s);
        break;
    }
    case Bun::WebSocketErrorCode::invalid_compressed_data: {
        didReceiveClose(CleanStatus::NotClean, 1002, "Invalid compressed data"_s);
        break;
    }
    case Bun::WebSocketErrorCode::proxy_connect_failed: {
        didReceiveClose(CleanStatus::NotClean, 1006, "Proxy connection failed"_s, true);
        break;
    }
    case Bun::WebSocketErrorCode::proxy_authentication_required: {
        didReceiveClose(CleanStatus::NotClean, 1006, "Proxy authentication required"_s, true);
        break;
    }
    case Bun::WebSocketErrorCode::proxy_connection_refused: {
        didReceiveClose(CleanStatus::NotClean, 1006, "Proxy connection refused"_s, true);
        break;
    }
    case Bun::WebSocketErrorCode::proxy_tunnel_failed: {
        didReceiveClose(CleanStatus::NotClean, 1006, "Proxy tunnel failed"_s, true);
        break;
    }
    }

    m_state = CLOSED;
    if (auto* context = scriptExecutionContext()) {
        context->postTask([protectedThis = Ref { *this }](ScriptExecutionContext& context) {
            protectedThis->disablePendingActivity();
        });
    } else {
        this->deref();
    }
}

void WebSocket::disablePendingActivity()
{
    this->m_pendingActivityCount = 1;
    this->decPendingActivityCount();
}

void WebSocket::updateHasPendingActivity()
{
    std::atomic_thread_fence(std::memory_order_acquire);
    m_hasPendingActivity.store(
        !(m_state == CLOSED && m_pendingActivityCount == 0));
}

// Forward declarations for tunnel mode (defined outside namespace)
extern "C" void* Bun__WebSocketClient__initWithTunnel(CppWebSocket* ws, void* tunnel, JSC::JSGlobalObject* globalObject, unsigned char* bufferedData, size_t bufferedDataSize, const PerMessageDeflateParams* deflate_params);
extern "C" void WebSocketProxyTunnel__setConnectedWebSocket(void* tunnel, void* websocket);

void WebSocket::didConnectWithTunnel(void* tunnel, char* bufferedData, size_t bufferedDataSize, const PerMessageDeflateParams* deflate_params)
{
    this->m_upgradeClient = nullptr;
    setExtensionsFromDeflateParams(deflate_params);

    // For wss:// through HTTP proxy, we use a plain (non-TLS) WebSocket client
    // because the TLS is handled by the proxy tunnel
    this->m_connectedWebSocket.client = Bun__WebSocketClient__initWithTunnel(
        reinterpret_cast<CppWebSocket*>(this),
        tunnel,
        this->scriptExecutionContext()->jsGlobalObject(),
        reinterpret_cast<unsigned char*>(bufferedData),
        bufferedDataSize,
        deflate_params);
    this->m_connectedWebSocketKind = ConnectedWebSocketKind::Client;

    // IMPORTANT: Call didConnect() BEFORE setting the connected websocket on the tunnel.
    // didConnect() sets m_state = OPEN, and messages are dropped if state != OPEN.
    // By calling didConnect() first, we ensure the state is OPEN before the tunnel
    // starts forwarding messages to the WebSocket client.
    this->didConnect();

    // Now set the connected websocket on the tunnel to start forwarding data
    WebSocketProxyTunnel__setConnectedWebSocket(tunnel, this->m_connectedWebSocket.client);
}

} // namespace WebCore

extern "C" void WebSocket__didConnect(WebCore::WebSocket* webSocket, us_socket_t* socket, char* bufferedData, size_t len, const PerMessageDeflateParams* deflate_params, void* customSSLCtx)
{
    webSocket->didConnect(socket, bufferedData, len, deflate_params, customSSLCtx);
}

extern "C" void WebSocket__didConnectWithTunnel(WebCore::WebSocket* webSocket, void* tunnel, char* bufferedData, size_t len, const PerMessageDeflateParams* deflate_params)
{
    webSocket->didConnectWithTunnel(tunnel, bufferedData, len, deflate_params);
}

extern "C" void WebSocket__didAbruptClose(WebCore::WebSocket* webSocket, Bun::WebSocketErrorCode errorCode)
{
    webSocket->didFailWithErrorCode(errorCode);
}
extern "C" void WebSocket__didClose(WebCore::WebSocket* webSocket, uint16_t errorCode, BunString* reason)
{
    WTF::String wtf_reason = reason->transferToWTFString();
    webSocket->didClose(0, errorCode, WTF::move(wtf_reason));
}

extern "C" void WebSocket__didReceiveText(WebCore::WebSocket* webSocket, bool clone, const ZigString* str)
{
    WTF::String wtf_str = clone ? Zig::toStringCopy(*str) : Zig::toString(*str);
    webSocket->didReceiveMessage(WTF::move(wtf_str));
}
extern "C" void WebSocket__didReceiveBytes(WebCore::WebSocket* webSocket, const uint8_t* bytes, size_t len, const uint8_t op)
{
    auto opcode = static_cast<WebCore::WebSocket::Opcode>(op);
    switch (opcode) {
    case WebCore::WebSocket::Opcode::Binary:
        webSocket->didReceiveBinaryData("message"_s, { bytes, len });
        break;
    case WebCore::WebSocket::Opcode::Ping:
        webSocket->didReceiveBinaryData("ping"_s, { bytes, len });
        break;
    case WebCore::WebSocket::Opcode::Pong:
        webSocket->didReceiveBinaryData("pong"_s, { bytes, len });
        break;
    default:
        break;
    }
}
extern "C" bool WebSocket__rejectUnauthorized(WebCore::WebSocket* webSocket)
{
    return webSocket->rejectUnauthorized();
}

extern "C" void WebSocket__incrementPendingActivity(WebCore::WebSocket* webSocket)
{
    webSocket->incPendingActivityCount();
}
extern "C" void WebSocket__decrementPendingActivity(WebCore::WebSocket* webSocket)
{
    webSocket->decPendingActivityCount();
}

WebCore::ExceptionOr<void> WebCore::WebSocket::ping(WebCore::JSBlob* blob)
{
    if (m_state == CONNECTING)
        return Exception { InvalidStateError };
    if (m_state == CLOSING || m_state == CLOSED) {
        return {};
    }

    // Get the blob data and send it using existing binary data path
    void* dataPtr = Blob__getDataPtr(JSC::JSValue::encode(blob));
    size_t dataSize = Blob__getSize(JSC::JSValue::encode(blob));

    if (dataPtr && dataSize > 0) {
        this->sendWebSocketData(static_cast<const char*>(dataPtr), dataSize, Opcode::Ping);
    } else {
        // Send empty frame for empty blobs
        this->sendWebSocketData(nullptr, 0, Opcode::Ping);
    }

    return {};
}

WebCore::ExceptionOr<void> WebCore::WebSocket::pong(WebCore::JSBlob* blob)
{
    if (m_state == CONNECTING)
        return Exception { InvalidStateError };
    if (m_state == CLOSING || m_state == CLOSED) {
        return {};
    }

    // Get the blob data and send it using existing binary data path
    void* dataPtr = Blob__getDataPtr(JSC::JSValue::encode(blob));
    size_t dataSize = Blob__getSize(JSC::JSValue::encode(blob));

    if (dataPtr && dataSize > 0) {
        this->sendWebSocketData(static_cast<const char*>(dataPtr), dataSize, Opcode::Pong);
    } else {
        // Send empty frame for empty blobs
        this->sendWebSocketData(nullptr, 0, Opcode::Pong);
    }

    return {};
}

void WebCore::WebSocket::setProtocol(const String& protocol)
{
    m_subprotocol = protocol;
}

extern "C" void WebSocket__setProtocol(WebCore::WebSocket* webSocket, BunString* protocol)
{
    webSocket->setProtocol(protocol->transferToWTFString());
}
