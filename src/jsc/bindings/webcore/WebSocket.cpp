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
#include "AsyncContextFrame.h"
#include "WebSocketDeflate.h"
#include "headers.h"
#include "blob.h"
#include "BunString.h"
#include "CloseEvent.h"
#include <wtf/text/Base64.h>
#include "Event.h"
#include "EventListener.h"
#include "EventNames.h"
#include "MessageEvent.h"
#include "ScriptExecutionContext.h"
#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/ArrayBufferView.h>
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/JSLock.h>
#include <JavaScriptCore/ScriptCallStack.h>
#include <wtf/ASCIICType.h>
#include <wtf/HashSet.h>
#include <wtf/HexNumber.h>
#include <wtf/NakedPtr.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/StdLibExtras.h>
#include <wtf/text/CString.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/text/StringHash.h>

#include "JSBuffer.h"
#include "BunClientData.h"
#include "ErrorEvent.h"
#include "JSDOMExceptionHandling.h"
#include "JSWebSocket.h"
#include "ModuleGraph.h"

namespace WebCore {
WTF_MAKE_TZONE_ALLOCATED_IMPL(WebSocket);
extern "C" int Bun__getTLSRejectUnauthorizedValue();
extern "C" bool Bun__isNoProxy(const char* hostname, size_t hostname_len, uint16_t port);

static String urlForMessage(const URL& url)
{
    URL withoutCredentials = url;
    withoutCredentials.removeCredentials();
    return withoutCredentials.stringCenterEllipsizedToLength();
}

const size_t maxReasonSizeInBytes = 123;
// RFC 6455 §5.5: control frame payloads are at most 125 bytes.
const size_t maxControlFramePayloadSize = 125;

static Exception controlFramePayloadTooLargeException(size_t length)
{
    return Exception { RangeError, makeString("The data size must not be greater than "_s, maxControlFramePayloadSize, " bytes. Received "_s, length, " bytes."_s) };
}

// Close codes an endpoint may put on the wire (RFC 6455 7.4 + the IANA registry).
// Deliberately the RFC endpoint set, not the browser's "1000 or 3000-4999":
// non-browser clients legitimately send 1001 or 1011, and `ws` accepts the same set.
static inline bool isValidCloseCodeForSending(uint16_t code)
{
    return (code >= 1000 && code <= 1014 && code != 1004 && code != 1005 && code != 1006)
        || (code >= 3000 && code <= 4999);
}

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

// Escapes a protocol string for an error message. The cap is on the output length because one code unit can expand to six characters.
static String encodeProtocolString(const String& protocol)
{
    StringBuilder builder;
    for (size_t i = 0; i < protocol.length(); i++) {
        if (builder.length() >= 1024) {
            builder.append("..."_s);
            break;
        }
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

static unsigned saturateAdd(unsigned a, size_t b)
{
    if (std::numeric_limits<unsigned>::max() - a < b)
        return std::numeric_limits<unsigned>::max();
    return a + static_cast<unsigned>(b);
}

// https://url.spec.whatwg.org/#percent-decode
// URL::user() and URL::password() can't be used here. They return a null String when the decoded bytes aren't valid UTF-8.
static void appendPercentDecoded(Vector<uint8_t, 128>& bytes, StringView encoded)
{
    unsigned length = encoded.length();
    for (unsigned i = 0; i < length;) {
        char16_t character = encoded[i];
        if (character == '%' && i + 3 <= length && isASCIIHexDigit(encoded[i + 1]) && isASCIIHexDigit(encoded[i + 2])) {
            bytes.append(toASCIIHexValue(encoded[i + 1], encoded[i + 2]));
            i += 3;
        } else {
            bytes.append(static_cast<uint8_t>(character));
            ++i;
        }
    }
}

static String basicAuthorization(const URL& url)
{
    if (!url.hasCredentials())
        return {};

    Vector<uint8_t, 128> bytes;
    appendPercentDecoded(bytes, url.encodedUser());
    bytes.append(':');
    appendPercentDecoded(bytes, url.encodedPassword());
    return makeString("Basic "_s, base64Encoded(bytes.span()));
}

ASCIILiteral WebSocket::subprotocolSeparator()
{
    return ", "_s;
}

WebSocket::WebSocket(ScriptExecutionContext& context)
    : ActiveDOMObject(&context)
    , m_subprotocol(emptyString())
    , m_extensions(emptyString())
{
    m_rejectUnauthorized = m_proxyRejectUnauthorized = Bun__getTLSRejectUnauthorizedValue() != 0;
}

WebSocket::~WebSocket()
{
    cancelUpgradeClient();
    callClient<Bun__WebSocketClient__finalize, Bun__WebSocketClientTLS__finalize>();
}

// Transient proxy configuration - used only during connect() and not stored as member fields
struct ProxyConfig {
    String host;
    uint16_t port { 0 };
    String authorization;
    Vector<std::pair<String, String>> headers;
    bool isHTTPS { false };
    std::optional<WebSocketTLSOptions> tls;
};

static ExceptionOr<std::optional<ProxyConfig>> setupProxy(const String& proxyUrl, std::optional<FetchHeaders::Init>&& proxyHeaders, std::optional<WebSocketTLSOptions>&& proxyTLS)
{
    if (proxyUrl.isNull() || proxyUrl.isEmpty())
        return { std::nullopt };

    URL url { proxyUrl };
    if (!url.isValid())
        return Exception { SyntaxError, makeString("Invalid proxy URL: "_s, url.stringCenterEllipsizedToLength()) };

    // Only HTTP CONNECT proxies are supported. Reject socks5://, ftp://, etc. up front
    // instead of silently sending an HTTP CONNECT request to a non-HTTP proxy, matching
    // fetch()'s UnsupportedProxyProtocol behaviour.
    if (!url.protocolIsInHTTPFamily())
        return Exception { SyntaxError, makeString("Unsupported proxy protocol \""_s, url.protocol(), "\" (expected \"http\" or \"https\")"_s) };

    ProxyConfig config;
    config.host = url.host().toString();
    config.isHTTPS = url.protocolIs("https"_s);
    config.port = url.port().value_or(config.isHTTPS ? 443 : 80);
    config.authorization = basicAuthorization(url);
    config.tls = WTF::move(proxyTLS);

    if (proxyHeaders) {
        auto headersOrException = FetchHeaders::create(WTF::move(proxyHeaders));
        if (headersOrException.hasException())
            return headersOrException.releaseException();
        auto headers = headersOrException.releaseReturnValue();
        // An explicit Proxy-Authorization header overrides the URL's credentials, same as fetch().
        if (headers->internalHeaders().contains(HTTPHeaderName::ProxyAuthorization))
            config.authorization = String();
        auto iterator = headers->createIterator(false);
        while (auto value = iterator.next()) {
            config.headers.append({ value->key, value->value });
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

ExceptionOr<Ref<WebSocket>> WebSocket::create(ScriptExecutionContext& context, const String& url, WebSocketOptions&& options)
{
    auto socket = adoptRef(*new WebSocket(context));
    socket->suspendIfNeeded();
    // The context's active DOM objects were already stopped, so the socket starts out CLOSED.
    if (socket->m_state == CLOSED)
        return socket;

    auto result = socket->connect(url, WTF::move(options));
    if (result.hasException()) {
        socket->m_state = CLOSED;
        return result.releaseException();
    }

    return socket;
}

Ref<WebSocket> WebSocket::createOverStream(ScriptExecutionContext& context, WebSocketStreamOptions&& options)
{
    auto socket = adoptRef(*new WebSocket(context));
    socket->suspendIfNeeded();
    if (socket->m_state == CLOSED)
        return socket;

    socket->m_url = URL { options.url };
    socket->m_subprotocol = WTF::move(options.protocol);
    socket->m_extensions = WTF::move(options.extensions);
    socket->m_connectedOptions = options.connected;
    socket->m_connectionType = ConnectionType::Stream;
    socket->m_connectedWebSocket.client = Bun__WebSocketClient__initOverStream(reinterpret_cast<CppWebSocket*>(socket.ptr()), context.jsGlobalObject(), &socket->m_connectedOptions, options.deflate ? &*options.deflate : nullptr);
    socket->m_connectedWebSocketKind = ConnectedWebSocketKind::Client;
    socket->m_state = OPEN;
    return socket;
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

size_t WebSocket::memoryCost() const

{
    size_t cost = sizeof(WebSocket);
    cost += m_url.string().sizeInBytes();
    cost += m_origin.sizeInBytes();
    cost += m_subprotocol.sizeInBytes();
    cost += m_extensions.sizeInBytes();

    cost += callClient<Bun__WebSocketClient__memoryCost, Bun__WebSocketClientTLS__memoryCost>();

    if (m_upgradeClient) {
        if (usesTLSSocket()) {
            cost += Bun__WebSocketHTTPSClient__memoryCost(m_upgradeClient);
        } else {
            cost += Bun__WebSocketHTTPClient__memoryCost(m_upgradeClient);
        }
    }

    return cost;
}

__attribute__((minsize)) ExceptionOr<void> WebSocket::connect(const String& url, WebSocketOptions&& options)
{
    ASSERT(scriptExecutionContext());

    auto proxyConfigResult = setupProxy(options.proxyURL, WTF::move(options.proxyHeaders), WTF::move(options.proxyTLS));
    if (proxyConfigResult.hasException())
        return proxyConfigResult.releaseException();
    auto proxyConfig = proxyConfigResult.releaseReturnValue();

    if (options.tls.rejectUnauthorized)
        m_rejectUnauthorized = *options.tls.rejectUnauthorized;
    m_connectedOptions = options.connected;
    auto& protocols = options.protocols;

    m_url = URL { url };
    if (!m_url.isValid())
        return Exception { SyntaxError, makeString("Invalid url for WebSocket "_s, m_url.stringCenterEllipsizedToLength()) };

    if (m_url.protocolIs("http"_s))
        m_url.setProtocol("ws"_s);
    else if (m_url.protocolIs("https"_s))
        m_url.setProtocol("wss"_s);

    bool is_unix = m_url.protocolIs("ws+unix"_s) || m_url.protocolIs("wss+unix"_s);
    bool is_secure = m_url.protocolIs("wss"_s) || m_url.protocolIs("wss+unix"_s);

    if (!m_url.protocolIs("ws"_s) && !is_secure && !is_unix)
        return Exception { SyntaxError, makeString("Wrong url scheme for WebSocket "_s, urlForMessage(m_url)) };
    if (m_url.hasFragmentIdentifier())
        return Exception { SyntaxError, makeString("URL has fragment component "_s, urlForMessage(m_url)) };

    m_origin = m_url.protocolHostAndPort();

    // FIXME: There is a disagreement about restriction of subprotocols between WebSocket API and hybi-10 protocol
    // draft. The former simply says "only characters in the range U+0021 to U+007E are allowed," while the latter
    // imposes a stricter rule: "the elements MUST be non-empty strings with characters as defined in [RFC2616],
    // and MUST all be unique strings."
    //
    // Here, we throw SyntaxError if the given protocols do not meet the latter criteria. This behavior does not
    // comply with WebSocket API specification, but it seems to be the only reasonable way to handle this conflict.
    //
    // The `ws` module has already validated the protocols with npm ws's rules: same token syntax, but the duplicate check is case-sensitive.
    if (!isWsMode()) {
        for (auto& protocol : protocols) {
            if (!isValidProtocolString(protocol))
                return Exception { SyntaxError, makeString("Wrong protocol for WebSocket '"_s, encodeProtocolString(protocol), "'"_s) };
        }
        HashSet<String, ASCIICaseInsensitiveHash> visited;
        for (auto& protocol : protocols) {
            if (!visited.add(protocol).isNewEntry)
                return Exception { SyntaxError, makeString("WebSocket protocols contain duplicates: '"_s, encodeProtocolString(protocol), "'"_s) };
        }
    }

    String protocolString;
    if (!protocols.isEmpty())
        protocolString = joinStrings(protocols, subprotocolSeparator());

    // `Bun::toString(WTF::String&)` borrows the impl, so materialize the
    // `m_url` views into `WTF::String`s that outlive the connect call.
    String hostString = m_url.host().toString();
    auto resource = resourceName(m_url);
    String unixSocketPathString;
    if (is_unix) {
        // ws+unix:///path/to/sock.sock[:/request/path][?query]
        // The URL pathname is "/path/to/sock.sock:/request/path". Split on the
        // first ':' into the socket path and the HTTP request path, matching
        // the npm `ws` package's ws+unix: handling. Anything after the first
        // colon becomes the request path; if there is no colon the request
        // path is "/" (plus any query string).
        auto pathname = m_url.path();
        size_t colon = pathname.find(':');
        if (colon == notFound) {
            unixSocketPathString = pathname.toString();
            resource = makeString('/', m_url.queryWithLeadingQuestionMark());
        } else {
            unixSocketPathString = pathname.left(colon).toString();
            auto requestPath = pathname.substring(colon + 1);
            // Ensure origin-form per RFC 7230 §5.3.1 (leading '/').
            if (requestPath.isEmpty()) {
                resource = makeString('/', m_url.queryWithLeadingQuestionMark());
            } else if (requestPath.startsWith('/')) {
                resource = makeString(requestPath, m_url.queryWithLeadingQuestionMark());
            } else {
                resource = makeString('/', requestPath, m_url.queryWithLeadingQuestionMark());
            }
        }
        if (unixSocketPathString.isEmpty())
            return Exception { SyntaxError, makeString("Invalid url for WebSocket "_s, urlForMessage(m_url), " (missing unix socket path)"_s) };
        // Host header defaults to "localhost" over a unix socket, matching
        // Node's http.request({ socketPath }) and the npm `ws` package.
        if (hostString.isEmpty()) {
            hostString = "localhost"_s;
        }
    }
    BunString host = Bun::toString(hostString);
    BunString path = Bun::toString(resource);
    BunString unixSocketPath = Bun::toString(unixSocketPathString);
    BunString clientProtocolString = Bun::toString(protocolString);
    uint16_t port = m_url.port().value_or(is_secure ? 443 : 80);

    // Hold WTF::Strings so the BunString wrappers stay valid for the native call.
    Vector<String, 8> headerNameStrings;
    Vector<String, 8> headerValueStrings;
    Vector<BunString, 8> headerNames;
    Vector<BunString, 8> headerValues;

    auto headersOrException = FetchHeaders::create(WTF::move(options.headers));
    if (headersOrException.hasException()) [[unlikely]]
        return headersOrException.releaseException();

    auto headers = headersOrException.releaseReturnValue();
    headerNameStrings.reserveInitialCapacity(headers.get().internalHeaders().size());
    headerValueStrings.reserveInitialCapacity(headers.get().internalHeaders().size());
    headerNames.reserveInitialCapacity(headers.get().internalHeaders().size());
    headerValues.reserveInitialCapacity(headers.get().internalHeaders().size());
    // lowerCaseKeys = false so we dont touch the keys casing
    auto iterator = headers.get().createIterator(false);
    while (auto value = iterator.next()) {
        headerNameStrings.append(value->key);
        headerValueStrings.append(value->value);
    }
    for (size_t i = 0; i < headerNameStrings.size(); ++i) {
        headerNames.unsafeAppendWithoutCapacityCheck(Bun::toString(headerNameStrings[i]));
        headerValues.unsafeAppendWithoutCapacityCheck(Bun::toString(headerValueStrings[i]));
    }

    // Determine connection type based on proxy usage and TLS requirements
    bool hasProxy = proxyConfig.has_value();

    // Unix domain sockets are local; proxies do not apply.
    if (is_unix) {
        proxyConfig = std::nullopt;
        hasProxy = false;
    }

    // Check NO_PROXY even for explicitly-provided proxies
    if (hasProxy) {
        auto hostUtf8 = m_url.host().toString().utf8();
        auto host = byteCast<char>(hostUtf8.span());
        // The effective port, so a `host:443` entry matches a default-port URL.
        if (Bun__isNoProxy(host.data(), host.size(), port)) {
            proxyConfig = std::nullopt;
            hasProxy = false;
        }
    }

    bool proxyIsHTTPS = hasProxy && proxyConfig->isHTTPS;
    bool hasProxyTLS = hasProxy && proxyConfig->tls;

    if (!hasProxyTLS)
        m_proxyRejectUnauthorized = m_rejectUnauthorized;
    else if (proxyConfig->tls->rejectUnauthorized)
        m_proxyRejectUnauthorized = *proxyConfig->tls->rejectUnauthorized;

    // Connection type determines what kind of socket we use:
    // - Plain/TLS: direct connection, socket type matches target protocol
    // - ProxyPlain/ProxyTLS: through proxy, socket type matches PROXY protocol (not target)
    if (hasProxy) {
        m_connectionType = proxyIsHTTPS ? ConnectionType::ProxyTLS : ConnectionType::ProxyPlain;
    } else {
        m_connectionType = is_secure ? ConnectionType::TLS : ConnectionType::Plain;
    }

    // Script from a disposed Bun.ModuleGraph can't open connections. The socket stays CONNECTING
    // forever and nothing keeps it alive.
    if (auto* context = scriptExecutionContext(); context->isForModuleGraph() && context->isStopped())
        return {};

    m_pendingActivity = makePendingActivity(*this);

    // Prepare proxy parameters (use local variables, not member fields).
    // The BunString wrappers reference the underlying WTF::Strings in proxyConfig
    // and remain valid for the duration of the connect() call.
    BunString proxyHost = hasProxy ? Bun::toString(proxyConfig->host) : BunString { BunStringTag::Empty };
    BunString proxyAuth = hasProxy ? Bun::toString(proxyConfig->authorization) : BunString { BunStringTag::Empty };
    uint16_t proxyPort = hasProxy ? proxyConfig->port : 0;

    Vector<BunString, 8> proxyHeaderNames;
    Vector<BunString, 8> proxyHeaderValues;
    if (hasProxy) {
        proxyHeaderNames.reserveInitialCapacity(proxyConfig->headers.size());
        proxyHeaderValues.reserveInitialCapacity(proxyConfig->headers.size());
        for (const auto& header : proxyConfig->headers) {
            proxyHeaderNames.unsafeAppendWithoutCapacityCheck(Bun::toString(header.first));
            proxyHeaderValues.unsafeAppendWithoutCapacityCheck(Bun::toString(header.second));
        }
    }

    String targetAuthorization = basicAuthorization(m_url);
    BunString targetAuth = Bun::toString(targetAuthorization);
    BunString extensions = Bun::toString(options.extensions);

    // The upgrade client takes ownership of sslConfig, even if connect() fails. It only borrows proxySSLConfig.
    void* sslConfig = options.tls.sslConfig.release();
    const void* proxySSLConfig = hasProxyTLS ? proxyConfig->tls->sslConfig.get() : nullptr;

    // Set to an errno name when connect() returns null and the cause is known.
    BunString connectErrorCode { BunStringTag::Empty };

    auto* connectUpgradeClient = usesTLSSocket() ? Bun__WebSocketHTTPSClient__connect : Bun__WebSocketHTTPClient__connect;
    this->m_upgradeClient = connectUpgradeClient(
        scriptExecutionContext()->jsGlobalObject(), reinterpret_cast<CppWebSocket*>(this),
        &host, port, &path, &clientProtocolString,
        headerNames.begin(), headerNames.size(), headerValues.begin(), headerValues.size(),
        hasProxy ? &proxyHost : nullptr, proxyPort,
        (hasProxy && !proxyConfig->authorization.isEmpty()) ? &proxyAuth : nullptr,
        proxyHeaderNames.begin(), proxyHeaderNames.size(), proxyHeaderValues.begin(), proxyHeaderValues.size(),
        sslConfig, proxySSLConfig, hasProxyTLS, is_secure,
        targetAuthorization.isEmpty() ? nullptr : &targetAuth,
        is_unix ? &unixSocketPath : nullptr,
        options.extensions.isNull() ? nullptr : &extensions,
        &connectErrorCode);

    // Report the failure from a task, like an asynchronous connection failure, so the constructor still returns a CONNECTING socket.
    // Same text as `ErrorCode::FailedToConnect` in websocket_client.rs.
    if (!m_upgradeClient) {
        queueTaskKeepingObjectAlive(*this, TaskSource::WebSocket, [code = connectErrorCode.transferToWTFString()](WebSocket& ws) mutable {
            ws.didFail("Failed to connect"_s, 0, WTF::move(code));
        });
    }

    return {};
}

ExceptionOr<void> WebSocket::sendFrame(Opcode opcode, const Payload& payload, uint8_t flags)
{
    const String* text = std::get_if<String>(&payload);
    auto bytes = text ? std::span<const uint8_t> {} : std::get<std::span<const uint8_t>>(payload);

    if (m_state == CONNECTING)
        return Exception { InvalidStateError };

    if (opcode == Opcode::Ping || opcode == Opcode::Pong) {
        // A socket that is closing or closed ignores the call, whatever the payload is.
        if (m_state != OPEN)
            return {};
        UTF8CString utf8;
        if (text) {
            utf8 = text->utf8(StrictConversionReplacingUnpairedSurrogatesWithFFFD);
            bytes = byteCast<uint8_t>(utf8.span());
        }
        if (bytes.size() > maxControlFramePayloadSize)
            return controlFramePayloadTooLargeException(bytes.size());
        sendWebSocketData(bytes, opcode, flags);
        return {};
    }

    // No exception is raised if the connection was once established but has subsequently been closed.
    if (m_state != OPEN) {
        m_bufferedAmount = saturateAdd(m_bufferedAmount, text ? text->utf8(StrictConversionReplacingUnpairedSurrogatesWithFFFD).length() : bytes.size());
        return {};
    }

    if (text)
        sendWebSocketString(*text, opcode, flags);
    else
        sendWebSocketData(bytes, opcode, flags);
    return {};
}

void WebSocket::sendWebSocketData(std::span<const uint8_t> bytes, Opcode op, uint8_t flags)
{
    RELEASE_ASSERT(m_connectedWebSocketKind != ConnectedWebSocketKind::None);
    callClient<Bun__WebSocketClient__writeBinaryData, Bun__WebSocketClientTLS__writeBinaryData>(bytes.data(), bytes.size(), static_cast<uint8_t>(op), flags);
}

void WebSocket::sendWebSocketString(const String& message, Opcode op, uint8_t flags)
{
    RELEASE_ASSERT(m_connectedWebSocketKind != ConnectedWebSocketKind::None);
    auto slice = Zig::toEncodedSlice(message);
    callClient<Bun__WebSocketClient__writeString, Bun__WebSocketClientTLS__writeString>(&slice, static_cast<uint8_t>(op), flags);
}

ExceptionOr<void> WebSocket::close(std::optional<unsigned short> optionalCode, const String& reason)
{
    // https://websockets.spec.whatwg.org/#dom-websocket-close
    // Validation happens before the readyState checks: an invalid code or an
    // over-long reason throws even on a CLOSING/CLOSED socket.
    if (optionalCode && !isValidCloseCodeForSending(optionalCode.value()))
        return Exception { InvalidAccessError, makeString("The close code must be a valid WebSocket close code (1000-1014, excluding the reserved codes 1004-1006, or in the range of 3000 to 4999). Received "_s, optionalCode.value(), '.') };
    UTF8CString utf8Reason;
    if (!reason.isEmpty()) {
        // The limit is on the UTF-8 encoding of the reason, not its UTF-16 length.
        utf8Reason = reason.utf8(StrictConversionReplacingUnpairedSurrogatesWithFFFD);
        if (utf8Reason.length() > maxReasonSizeInBytes)
            return Exception { SyntaxError, makeString("The close reason must not be greater than "_s, maxReasonSizeInBytes, " UTF-8 bytes. Received "_s, utf8Reason.length(), " bytes."_s) };
    }

    if (m_state == CLOSING || m_state == CLOSED)
        return {};
    if (m_state == CONNECTING) {
        terminate();
        return {};
    }

    // 1005 tells the native client to send a Close frame with an empty payload.
    uint16_t code = optionalCode.value_or(reason.isEmpty() ? 1005 : 1000);
    const bool wasPaused = isPaused();
    m_state = CLOSING;
    auto reasonBytes = byteCast<uint8_t>(utf8Reason.span());
    callClient<Bun__WebSocketClient__close, Bun__WebSocketClientTLS__close>(code, reasonBytes.data(), reasonBytes.size());
    // close() unpauses a WHATWG socket, so parse any bytes that arrived with the 101. A `ws` socket stays paused, like npm ws.
    if (wasPaused && !isPaused())
        queueInitialDataDelivery();
    return {};
}

void WebSocket::terminate()
{
    if (m_state == CLOSED)
        return;
    if (m_state == CONNECTING) {
        cancelUpgradeClient();
        didFail("WebSocket is closed before the connection is established"_s);
        return;
    }
    m_state = CLOSING;
    cancelConnectedClient();
}

bool WebSocket::pause()
{
    if (!canPause())
        return false;
    m_paused = true;
    return applyPauseToConnectedClient();
}

bool WebSocket::resume()
{
    if (!canPause())
        return false;
    const bool wasPaused = std::exchange(m_paused, false);
    const bool applied = applyPauseToConnectedClient();
    if (wasPaused && shouldDispatchFrames())
        queueInitialDataDelivery();
    return applied;
}

// True when the socket's read state changed (or will, once a CONNECTING
// socket opens); false when there is no socket to act on.
bool WebSocket::applyPauseToConnectedClient()
{
    if (m_connectedWebSocketKind != ConnectedWebSocketKind::None) {
        return m_paused
            ? callClient<Bun__WebSocketClient__pause, Bun__WebSocketClientTLS__pause>()
            : callClient<Bun__WebSocketClient__resume, Bun__WebSocketClientTLS__resume>();
    }
    if (m_upgradeClient) {
        if (usesTLSSocket())
            Bun__WebSocketHTTPSClient__setPaused(m_upgradeClient, m_paused);
        else
            Bun__WebSocketHTTPClient__setPaused(m_upgradeClient, m_paused);
    }
    return m_state == CONNECTING;
}

void WebSocket::queueInitialDataDelivery()
{
    queueTaskKeepingObjectAlive(*this, TaskSource::WebSocket, [](WebSocket& ws) {
        ws.callClient<Bun__WebSocketClient__deliverInitialData, Bun__WebSocketClientTLS__deliverInitialData>();
    });
}

void WebSocket::setRef(bool ref)
{
    m_unref = !ref;
    callClient<Bun__WebSocketClient__setRef, Bun__WebSocketClientTLS__setRef>(ref);
}

std::optional<WebSocket::RemoteAddress> WebSocket::remoteAddress() const
{
    BunString address { BunStringTag::Empty };
    uint16_t port = 0;
    bool isIPv6 = false;
    if (callClient<Bun__WebSocketClient__remoteAddress, Bun__WebSocketClientTLS__remoteAddress>(&address, &port, &isIPv6))
        return RemoteAddress { address.transferToWTFString(), port, isIPv6 };
    return std::nullopt;
}

void WebSocket::feed(std::span<const uint8_t> bytes)
{
    if (m_connectionType == ConnectionType::Stream && m_connectedWebSocketKind == ConnectedWebSocketKind::Client)
        Bun__WebSocketClient__feed(m_connectedWebSocket.client, bytes.data(), bytes.size());
}

void WebSocket::streamClosed()
{
    if (m_connectionType == ConnectionType::Stream && m_connectedWebSocketKind == ConnectedWebSocketKind::Client)
        Bun__WebSocketClient__streamClosed(m_connectedWebSocket.client);
}

void WebSocket::cancelUpgradeClient()
{
    auto* upgradeClient = std::exchange(m_upgradeClient, nullptr);
    if (!upgradeClient)
        return;
    if (usesTLSSocket())
        Bun__WebSocketHTTPSClient__cancel(upgradeClient);
    else
        Bun__WebSocketHTTPClient__cancel(upgradeClient);
}

void WebSocket::cancelConnectedClient()
{
    callClient<Bun__WebSocketClient__cancel, Bun__WebSocketClientTLS__cancel>();
}

// The context is being torn down. Drop the connection immediately: no closing handshake, no events
// and no script, because this runs inside stopActiveDOMObjects(). The native client is detached
// from this object before it closes, so it can't call back into it.
void WebSocket::stop()
{
    m_state = CLOSED;
    cancelUpgradeClient();
    // Clear the pointers before calling into the native client, so nothing it does can reach a client that's being freed.
    switch (std::exchange(m_connectedWebSocketKind, ConnectedWebSocketKind::None)) {
    case ConnectedWebSocketKind::Client:
        Bun__WebSocketClient__finalize(std::exchange(m_connectedWebSocket.client, nullptr));
        break;
    case ConnectedWebSocketKind::ClientSSL:
        Bun__WebSocketClientTLS__finalize(std::exchange(m_connectedWebSocket.clientSSL, nullptr));
        break;
    case ConnectedWebSocketKind::None:
        break;
    }
    m_asyncContext.clear();
    m_pendingActivity = nullptr;
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
    // Live: bytes queued in the native client (frames not yet written to the
    // socket, plus the proxy tunnel's pending ciphertext).
    size_t live = callClient<Bun__WebSocketClient__bufferedAmount, Bun__WebSocketClientTLS__bufferedAmount>();
    return saturateAdd(m_bufferedAmount, live);
}

us_socket_t* WebSocket::usSocket() const
{
    return callClient<Bun__WebSocketClient__usSocket, Bun__WebSocketClientTLS__usSocket>();
}

String WebSocket::protocol() const
{
    return m_subprotocol;
}

String WebSocket::extensions() const
{
    return m_extensions;
}

void WebSocket::setBinaryType(const String& binaryType)
{
    if (binaryType == "blob"_s)
        m_binaryType = BinaryType::Blob;
    else if (binaryType == "arraybuffer"_s)
        m_binaryType = BinaryType::ArrayBuffer;
    else if (binaryType == "nodebuffer"_s)
        m_binaryType = BinaryType::NodeBuffer;
}

EventTargetInterface WebSocket::eventTargetInterface() const
{
    return WebSocketEventTargetInterfaceType;
}

ScriptExecutionContext* WebSocket::scriptExecutionContext() const
{
    return ActiveDOMObject::scriptExecutionContext();
}

void WebSocket::dispatchEvent(Event& event)
{
    std::optional<AsyncContextScope> asyncContext;
    if (event.isTrusted() && m_asyncContext)
        asyncContext.emplace(scriptExecutionContext()->jsGlobalObject(), m_asyncContext.getValue());
    EventTarget::dispatchEvent(event);
}

JSC::JSValue WebSocket::callHandler(const JSC::Identifier& name, const JSC::ArgList& arguments)
{
    RefPtr context = scriptExecutionContext();
    if (!context || context->isJSExecutionForbidden())
        return {};
    auto* wrapper = uncheckedDowncast<JSWebSocket>(this->wrapper());
    if (!wrapper || !wrapper->m_handlers)
        return {};

    auto& vm = context->vm();
    JSC::JSLockHolder lock(vm);
    auto* globalObject = context->jsGlobalObject();
    JSC::JSValue function = wrapper->m_handlers->getDirect(vm, name);
    auto callData = function ? JSC::getCallData(function) : JSC::CallData {};
    if (callData.type == JSC::CallData::Type::None)
        return {};

    Ref protectedThis { *this };
    JSC::EnsureStillAliveScope protectedWrapper(wrapper);
    AsyncContextScope asyncContext(globalObject, m_asyncContext.getValue());
    Bun::ModuleGraphContextScope moduleGraphContext(*context);
    NakedPtr<JSC::Exception> exception;
    JSC::JSValue result = JSC::profiledCall(globalObject, JSC::ProfilingReason::Other, function, callData, wrapper->m_owner.get(), arguments, exception);
    if (exception) {
        reportException(globalObject, exception.get());
        return {};
    }
    return result;
}

void WebSocket::callHandlerWithBuffer(const JSC::Identifier& name, std::span<const uint8_t> bytes, JSC::JSValue secondArgument)
{
    auto* globalObject = scriptExecutionContext()->jsGlobalObject();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm());
    JSC::JSUint8Array* buffer = createBuffer(globalObject, bytes);
    if (!buffer || scope.exception()) [[unlikely]] {
        scope.clearExceptionExceptTermination();
        reportFailure({ "Failed to allocate memory"_s, {}, {} });
        return;
    }

    JSC::MarkedArgumentBuffer arguments;
    arguments.append(buffer);
    if (secondArgument)
        arguments.append(secondArgument);
    callHandler(name, arguments);
}

void* WebSocket::didConnect()
{
    if (m_state != CONNECTING) {
        cancelConnectedClient();
        return nullptr;
    }
    if (m_paused)
        applyPauseToConnectedClient();
    if (m_unref)
        setRef(false);
    m_state = OPEN;

    // Native callback: fire synchronously, skip Event construction +
    // dispatchEvent + the postTask deferral. The m_state = OPEN above is
    // the only bookkeeping the native path needs — sendTextNative checks
    // it. Keeping the wrapper alive is a script concern; the native
    // consumer holds a RefPtr so it doesn't need it.
    if (m_native.onOpen) {
        m_native.onOpen(m_native.ctx);
    } else if (isWsMode()) {
        callHandler(JSC::Identifier::fromString(scriptExecutionContext()->vm(), eventNames().openEvent), JSC::ArgList());
    } else if (hasEventListeners(eventNames().openEvent)) {
        dispatchEvent(Event::create(eventNames().openEvent, Event::CanBubble::No, Event::IsCancelable::No));
    } else {
        // No listener yet: dispatch on a later tick so a listener attached right after still sees it.
        queueTaskKeepingObjectAlive(*this, TaskSource::WebSocket, [](WebSocket& ws) mutable {
            ws.dispatchEvent(Event::create(eventNames().openEvent, Event::CanBubble::No, Event::IsCancelable::No));
        });
    }

    switch (m_connectedWebSocketKind) {
    case ConnectedWebSocketKind::Client:
        return m_connectedWebSocket.client;
    case ConnectedWebSocketKind::ClientSSL:
        return m_connectedWebSocket.clientSSL;
    case ConnectedWebSocketKind::None:
        break;
    }
    return nullptr;
}

void WebSocket::didReceiveMessage(String&& message)
{
    if (m_state != OPEN)
        return;

    // Native callback: hand off the UTF-8 bytes directly. UTF8View checks
    // is8Bit() && containsOnlyASCII() first — if true (the common case for
    // CDP JSON), span() is a zero-copy view over the existing buffer.
    // Only non-ASCII Latin1 or UTF-16 strings pay for a transcode into
    // a CString. The callback reads the span, we drop it — no
    // MessageEvent, no dispatchEvent, no postTask.
    if (m_native.onMessage) {
        // The native client rejects messages over max_payload_length (128 MiB), so this conversion can't fail.
        if (auto view = Bun::UTF8View::tryCreate(message))
            m_native.onMessage(m_native.ctx, view->span());
        return;
    }

    if (hasEventListeners(eventNames().messageEvent)) {
        // the main reason for dispatching on a separate tick is to handle when you haven't yet attached an event listener
        dispatchEvent(MessageEvent::create(WTF::move(message), m_origin));
        return;
    }

    if (scriptExecutionContext()) {
        queueTaskKeepingObjectAlive(*this, TaskSource::WebSocket, [message_ = WTF::move(message)](WebSocket& ws) mutable {
            ws.dispatchEvent(MessageEvent::create(message_, ws.m_origin));
        });
    }
}

void WebSocket::didReceiveFrame(Opcode opcode, std::span<const uint8_t> payload)
{
    if (!shouldDispatchFrames())
        return;

    auto& names = eventNames();
    const bool isMessage = opcode == Opcode::Text || opcode == Opcode::Binary;
    const AtomString& name = isMessage ? names.messageEvent : (opcode == Opcode::Ping ? names.pingEvent : names.pongEvent);
    if (isWsMode())
        callHandlerWithBuffer(JSC::Identifier::fromString(scriptExecutionContext()->vm(), name), payload, isMessage ? JSC::jsBoolean(opcode == Opcode::Binary) : JSC::JSValue());
    else
        didReceiveBinaryData(name, payload);
}

void WebSocket::didReceiveBinaryData(const AtomString& eventName, const std::span<const uint8_t> binaryData)
{
    // Below, a frame without a listener is queued for one that is attached right after. Nobody needs an old ping or
    // pong, few programs listen for them, and a peer that floods them would grow that queue without limit.
    if (eventName != eventNames().messageEvent && !hasEventListeners(eventName))
        return;

    switch (m_binaryType) {
    case BinaryType::Blob:
        if (this->hasEventListeners(eventName)) {
            // the main reason for dispatching on a separate tick is to handle when you haven't yet attached an event listener
            RefPtr<Blob> blob = Blob::create(binaryData, scriptExecutionContext()->jsGlobalObject());
            dispatchEvent(MessageEvent::create(eventName, blob.releaseNonNull(), m_origin));
            return;
        }

        if (auto* context = scriptExecutionContext()) {
            RefPtr<Blob> blob = Blob::create(binaryData, context->jsGlobalObject());
            queueTaskKeepingObjectAlive(*this, TaskSource::WebSocket, [name = eventName, blob = blob.releaseNonNull()](WebSocket& ws) mutable {
                ws.dispatchEvent(MessageEvent::create(name, blob, ws.m_origin));
            });
        }

        break;
    case BinaryType::ArrayBuffer: {
        if (this->hasEventListeners(eventName)) {
            // the main reason for dispatching on a separate tick is to handle when you haven't yet attached an event listener
            dispatchEvent(MessageEvent::create(eventName, ArrayBuffer::create(binaryData), m_origin));
            return;
        }

        if (scriptExecutionContext()) {
            auto arrayBuffer = JSC::ArrayBuffer::create(binaryData);
            queueTaskKeepingObjectAlive(*this, TaskSource::WebSocket, [name = eventName, buffer = WTF::move(arrayBuffer)](WebSocket& ws) mutable {
                ws.dispatchEvent(MessageEvent::create(name, buffer, ws.m_origin));
            });
        }

        break;
    }
    case BinaryType::NodeBuffer: {

        if (this->hasEventListeners(eventName)) {
            auto scope = DECLARE_TOP_EXCEPTION_SCOPE(scriptExecutionContext()->vm());
            JSUint8Array* buffer = createBuffer(scriptExecutionContext()->jsGlobalObject(), binaryData);

            if (!buffer || scope.exception()) [[unlikely]] {
                scope.clearExceptionExceptTermination();

                ErrorEvent::Init errorInit;
                errorInit.message = "Failed to allocate memory for binary data"_s;
                dispatchEvent(ErrorEvent::create(eventNames().errorEvent, errorInit, EventIsTrusted::Yes));
                return;
            }

            JSC::EnsureStillAliveScope ensureStillAlive(buffer);
            MessageEvent::Init init;
            init.data = buffer;
            init.origin = m_origin;

            dispatchEvent(MessageEvent::create(eventName, WTF::move(init), EventIsTrusted::Yes));
            return;
        }

        // No listener yet: dispatch on a later tick so a listener attached right after still sees it.
        if (scriptExecutionContext()) {
            queueTaskKeepingObjectAlive(*this, TaskSource::WebSocket, [name = eventName, buffer = JSC::ArrayBuffer::tryCreate(binaryData)](WebSocket& ws) mutable {
                if (!buffer)
                    return;
                size_t length = buffer->byteLength();
                auto* globalObject = ws.scriptExecutionContext()->jsGlobalObject();
                auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm());
                auto* subclassStructure = static_cast<Zig::GlobalObject*>(globalObject)->JSBufferSubclassStructure();
                JSUint8Array* uint8array = JSUint8Array::create(globalObject, subclassStructure, buffer.copyRef(), 0, length);
                if (!uint8array || scope.exception()) [[unlikely]] {
                    scope.clearExceptionExceptTermination();
                    return;
                }
                JSC::EnsureStillAliveScope ensureStillAlive(uint8array);
                MessageEvent::Init init;
                init.data = uint8array;
                init.origin = ws.m_origin;
                ws.dispatchEvent(MessageEvent::create(name, WTF::move(init), EventIsTrusted::Yes));
            });
        }

        break;
    }
    }
}

void WebSocket::didDrain()
{
    if (m_state != CLOSED)
        callHandler(WebCore::builtinNames(scriptExecutionContext()->vm()).drainPublicName(), JSC::ArgList());
}

void WebSocket::streamWrite(std::span<const uint8_t> bytes)
{
    callHandlerWithBuffer(WebCore::builtinNames(scriptExecutionContext()->vm()).writePublicName(), bytes);
}

void WebSocket::streamEnd()
{
    callHandler(WebCore::builtinNames(scriptExecutionContext()->vm()).endPublicName(), JSC::ArgList());
}

void WebSocket::streamDestroy()
{
    callHandler(JSC::Identifier::fromString(scriptExecutionContext()->vm(), "destroy"_s), JSC::ArgList());
}

WebSocket::HandshakeResult WebSocket::didReceiveHandshakeResponse(uint16_t statusCode, std::span<const uint8_t> statusMessage, std::span<const HandshakeRawHeader> headers, bool isUpgrade, std::span<const uint8_t> body)
{
    // Only the `ws` module and tests use this. Skip the work for a plain WebSocket.
    if (!isWsMode() && !this->hasEventListeners(eventNames().handshakeEvent))
        return {};

    auto* context = scriptExecutionContext();
    if (!context)
        return {};
    auto* globalObject = context->jsGlobalObject();
    auto& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    auto* rawHeaders = JSC::constructEmptyArray(globalObject, nullptr, headers.size() * 2);
    if (!rawHeaders || scope.exception()) [[unlikely]] {
        scope.clearExceptionExceptTermination();
        return {};
    }
    for (size_t i = 0; i < headers.size(); i++) {
        rawHeaders->putDirectIndex(globalObject, i * 2,
            JSC::jsString(vm, WTF::String(byteCast<Latin1Character>(headers[i].name.span()))));
        RETURN_IF_EXCEPTION(scope, {});
        rawHeaders->putDirectIndex(globalObject, i * 2 + 1,
            JSC::jsString(vm, WTF::String(byteCast<Latin1Character>(headers[i].value.span()))));
        RETURN_IF_EXCEPTION(scope, {});
    }

    JSC::MarkedArgumentBuffer arguments;
    arguments.append(JSC::jsNumber(statusCode));
    arguments.append(JSC::jsString(vm, WTF::String(byteCast<Latin1Character>(statusMessage))));
    arguments.append(rawHeaders);
    if (isWsMode()) {
        arguments.append(JSC::jsBoolean(isUpgrade));
        JSC::JSValue returned = callHandler(JSC::Identifier::fromString(vm, eventNames().handshakeEvent), arguments);
        auto* accepted = returned ? returned.getObject() : nullptr;
        if (!accepted)
            return {};
        auto deflate = convertDeflateParamsForWs(globalObject, accepted);
        if (scope.exception()) [[unlikely]] {
            scope.clearExceptionExceptTermination();
            return {};
        }
        return { true, deflate.has_value(), deflate.value_or(PerMessageDeflateParams {}) };
    }

    JSC::JSUint8Array* bodyBuffer = createBuffer(globalObject, body);
    if (!bodyBuffer || scope.exception()) [[unlikely]] {
        scope.clearExceptionExceptTermination();
        return {};
    }

    auto& builtinNames = WebCore::builtinNames(vm);
    auto* obj = JSC::constructEmptyObject(globalObject);
    obj->putDirect(vm, builtinNames.statusCodePublicName(), arguments.at(0));
    obj->putDirect(vm, builtinNames.statusMessagePublicName(), arguments.at(1));
    obj->putDirect(vm, builtinNames.rawHeadersPublicName(), rawHeaders);
    obj->putDirect(vm, builtinNames.bodyPublicName(), bodyBuffer);

    JSC::EnsureStillAliveScope ensureStillAlive(obj);

    MessageEvent::Init init;
    init.data = obj;
    init.origin = m_origin;

    dispatchEvent(MessageEvent::create(eventNames().handshakeEvent, WTF::move(init), EventIsTrusted::Yes));
    return {};
}

void WebSocket::didReceiveResponseBody(std::span<const uint8_t> chunk)
{
    callHandlerWithBuffer(WebCore::builtinNames(scriptExecutionContext()->vm()).bodyPublicName(), chunk);
}

void WebSocket::didEndResponseBody(bool aborted, bool reset)
{
    Ref protectedThis { *this };
    m_upgradeClient = nullptr;
    if (m_state == CLOSED)
        return;
    m_state = CLOSED;
    JSC::MarkedArgumentBuffer arguments;
    arguments.append(JSC::jsNull());
    arguments.append(JSC::jsBoolean(aborted));
    arguments.append(JSC::jsBoolean(reset));
    callHandler(WebCore::builtinNames(scriptExecutionContext()->vm()).bodyPublicName(), arguments);
    m_asyncContext.clear();
    m_pendingActivity = nullptr;
}

void WebSocket::didStartClosingHandshake(unsigned short code, String&& reason)
{
    if (m_state == CLOSED)
        return;
    m_state = CLOSING;
    RefPtr context = scriptExecutionContext();
    if (!isWsMode() || !context)
        return;

    auto& vm = context->vm();
    JSC::MarkedArgumentBuffer arguments;
    arguments.append(JSC::jsNumber(code));
    arguments.append(JSC::jsString(vm, reason));
    callHandler(JSC::Identifier::fromString(vm, "conclude"_s), arguments);
}

void WebSocket::didClose(unsigned short code, String&& reason, bool wasClean, size_t bufferedAmount)
{
    finish(bufferedAmount, code, WTF::move(reason), wasClean, std::nullopt);
}

void WebSocket::didFail(String&& text, size_t bufferedAmount, String&& code, String&& detail)
{
    finish(bufferedAmount, 1006, {}, false, Failure { WTF::move(text), WTF::move(code), WTF::move(detail) });
}

void WebSocket::didError(String&& text, String&& code, String&& detail)
{
    if (m_state == CLOSED)
        return;
    m_state = CLOSING;
    if (!scriptExecutionContext())
        return;
    reportFailure({ WTF::move(text), WTF::move(code), WTF::move(detail) });
}

void WebSocket::finish(size_t bufferedAmount, unsigned short code, String&& reason, bool wasClean, std::optional<Failure>&& failure)
{
    m_upgradeClient = nullptr;
    m_connectedWebSocket.client = nullptr;
    m_connectedWebSocketKind = ConnectedWebSocketKind::None;
    if (m_state == CLOSED)
        return;

    m_bufferedAmount = saturateAdd(m_bufferedAmount, bufferedAmount);
    m_state = scriptExecutionContext() ? CLOSING : CLOSED;
    auto fireCloseEvents = [code, wasClean, reason = WTF::move(reason), failure = WTF::move(failure)](WebSocket& ws) {
        if (ws.m_state == CLOSED)
            return;
        ws.m_state = CLOSED;
        if (ws.m_native.onClose) {
            ws.m_native.onClose(ws.m_native.ctx, code);
            return;
        }
        if (failure)
            ws.reportFailure(*failure);
        if (ws.isWsMode()) {
            auto& vm = ws.scriptExecutionContext()->vm();
            JSC::MarkedArgumentBuffer arguments;
            arguments.append(JSC::jsNumber(code));
            arguments.append(JSC::jsString(vm, reason));
            arguments.append(JSC::jsBoolean(wasClean));
            ws.callHandler(JSC::Identifier::fromString(vm, eventNames().closeEvent), arguments);
        } else
            ws.dispatchEvent(CloseEvent::create(wasClean, code, reason));
        ws.m_asyncContext.clear();
    };

    // On the stream transport, fire the events synchronously. Every call into the native client comes from JS, so it's safe
    // to run script here. The stream's own 'close' fires a tick after end() or destroy() and needs the close code by then.
    if (m_connectionType == ConnectionType::Stream) {
        Ref protectedThis { *this };
        m_pendingActivity = nullptr;
        fireCloseEvents(*this);
        return;
    }

    queueTaskKeepingObjectAlive(*this, TaskSource::WebSocket, WTF::move(fireCloseEvents));
    // The queued task keeps `this` alive. Without a context no task was queued, so this may destroy `this`.
    m_pendingActivity = nullptr;
}

void WebSocket::reportFailure(const Failure& failure)
{
    auto* globalObject = scriptExecutionContext()->jsGlobalObject();
    auto& vm = globalObject->vm();
    auto& builtinNames = WebCore::builtinNames(vm);

    ErrorEvent::Init init;
    init.message = makeString("WebSocket connection to '"_s, urlForMessage(m_url), "' failed: "_s, failure.text, failure.detail.isEmpty() ? ""_s : ": "_s, failure.detail);
    auto* error = JSC::createError(globalObject, init.message);
    JSC::EnsureStillAliveScope ensureStillAlive(error);
    if (!failure.code.isEmpty())
        error->putDirect(vm, builtinNames.codePublicName(), JSC::jsString(vm, failure.code));
    if (!failure.detail.isEmpty())
        error->putDirect(vm, builtinNames.detailPrivateName(), JSC::jsString(vm, failure.detail));

    if (isWsMode()) {
        JSC::MarkedArgumentBuffer arguments;
        arguments.append(error);
        // Whether the socket connects to a proxy. NO_PROXY can bypass the `proxy` option, so JS can't tell.
        arguments.append(JSC::jsBoolean(m_connectionType == ConnectionType::ProxyPlain || m_connectionType == ConnectionType::ProxyTLS));
        callHandler(vm.propertyNames->error, arguments);
        return;
    }
    init.error = error;
    dispatchEvent(ErrorEvent::create(eventNames().errorEvent, init, EventIsTrusted::Yes));
}

void* WebSocket::didConnect(us_socket_t* socket, void* bufferedData, const PerMessageDeflateParams* deflate_params, void* customSSLCtx, std::span<const uint8_t> verifiedHostname)
{
    this->m_upgradeClient = nullptr;
    setExtensionsFromDeflateParams(deflate_params);

    // Use TLS WebSocket client if connection type is TLS or ProxyTLS.
    // For TLS: direct wss:// connection, socket is already TLS.
    // For ProxyTLS: connected through HTTPS proxy, socket is TLS (even for ws:// target).
    // For Plain/ProxyPlain: socket is not TLS.
    bool useTLSSocket = usesTLSSocket();

    auto* globalObject = scriptExecutionContext()->jsGlobalObject();
    auto* initClient = useTLSSocket ? Bun__WebSocketClientTLS__init : Bun__WebSocketClient__init;
    void* client = initClient(reinterpret_cast<CppWebSocket*>(this), socket, globalObject, bufferedData, deflate_params, customSSLCtx, verifiedHostname.data(), verifiedHostname.size(), &m_connectedOptions);
    // The socket was already closed or shut down by the time the 101 was parsed. init() has called didFail().
    if (!client)
        return nullptr;
    if (useTLSSocket) {
        m_connectedWebSocket.clientSSL = client;
        m_connectedWebSocketKind = ConnectedWebSocketKind::ClientSSL;
    } else {
        m_connectedWebSocket.client = client;
        m_connectedWebSocketKind = ConnectedWebSocketKind::Client;
    }

    return didConnect();
}

// Forward declarations for tunnel mode (defined outside namespace)
extern "C" WebSocketClient* Bun__WebSocketClient__initWithTunnel(CppWebSocket* ws, void* tunnel, JSC::JSGlobalObject* globalObject, void* bufferedData, const PerMessageDeflateParams* deflate_params, const WebSocketConnectedOptions* options);
extern "C" void WebSocketProxyTunnel__setConnectedWebSocket(void* tunnel, void* websocket);

void* WebSocket::didConnectWithTunnel(void* tunnel, void* bufferedData, const PerMessageDeflateParams* deflate_params)
{
    this->m_upgradeClient = nullptr;
    setExtensionsFromDeflateParams(deflate_params);

    // For wss:// through HTTP proxy, we use a plain (non-TLS) WebSocket client
    // because the TLS is handled by the proxy tunnel
    this->m_connectedWebSocket.client = Bun__WebSocketClient__initWithTunnel(
        reinterpret_cast<CppWebSocket*>(this),
        tunnel,
        this->scriptExecutionContext()->jsGlobalObject(),
        bufferedData,
        deflate_params,
        &m_connectedOptions);
    this->m_connectedWebSocketKind = ConnectedWebSocketKind::Client;
    WebSocketProxyTunnel__setConnectedWebSocket(tunnel, m_connectedWebSocket.client);

    return didConnect();
}

void WebSocket::setProtocol(const String& protocol)
{
    m_subprotocol = protocol;
}

} // namespace WebCore

// `bufferedData` is an opaque Rust box (handshake overflow bytes) forwarded
// untouched to `Bun__WebSocketClient*__init*`, which takes ownership.
// `verifiedHostname` is borrowed for the call; the connected client copies it.
extern "C" void* WebSocket__didConnect(WebCore::WebSocket* webSocket, us_socket_t* socket, void* bufferedData, const PerMessageDeflateParams* deflate_params, void* customSSLCtx, WebCore::WebSocket::FfiSlice verifiedHostname)
{
    return webSocket->didConnect(socket, bufferedData, deflate_params, customSSLCtx, verifiedHostname.span());
}

extern "C" void* WebSocket__didConnectWithTunnel(WebCore::WebSocket* webSocket, void* tunnel, void* bufferedData, const PerMessageDeflateParams* deflate_params)
{
    return webSocket->didConnectWithTunnel(tunnel, bufferedData, deflate_params);
}

struct FfiRawHeaderSlice {
    const WebCore::WebSocket::HandshakeRawHeader* ptr;
    size_t len;
};

extern "C" WebCore::WebSocket::HandshakeResult WebSocket__didReceiveHandshakeResponse(WebCore::WebSocket* webSocket, uint16_t statusCode, WebCore::WebSocket::FfiSlice statusMessage, FfiRawHeaderSlice headers, bool isUpgrade, WebCore::WebSocket::FfiSlice body)
{
    return webSocket->didReceiveHandshakeResponse(statusCode, statusMessage.span(), std::span(headers.ptr, headers.len), isUpgrade, body.span());
}

extern "C" bool WebSocket__isWsMode(WebCore::WebSocket* webSocket)
{
    return webSocket->isWsMode();
}

extern "C" void WebSocket__didReceiveResponseBody(WebCore::WebSocket* webSocket, WebCore::WebSocket::FfiSlice chunk)
{
    webSocket->didReceiveResponseBody(chunk.span());
}

extern "C" void WebSocket__didEndResponseBody(WebCore::WebSocket* webSocket, bool aborted, bool reset)
{
    webSocket->didEndResponseBody(aborted, reset);
}

extern "C" void WebSocket__didFail(WebCore::WebSocket* webSocket, BunString text, size_t bufferedAmount, BunString code, BunString detail)
{
    webSocket->didFail(text.transferToWTFString(), bufferedAmount, code.transferToWTFString(), detail.transferToWTFString());
}

extern "C" void WebSocket__didClose(WebCore::WebSocket* webSocket, uint16_t code, BunString reason, bool wasClean, size_t bufferedAmount)
{
    webSocket->didClose(code, reason.transferToWTFString(), wasClean, bufferedAmount);
}

extern "C" void WebSocket__didStartClosingHandshake(WebCore::WebSocket* webSocket, uint16_t code, BunString reason)
{
    webSocket->didStartClosingHandshake(code, reason.transferToWTFString());
}

extern "C" void WebSocket__didError(WebCore::WebSocket* webSocket, BunString text, BunString code, BunString detail)
{
    webSocket->didError(text.transferToWTFString(), code.transferToWTFString(), detail.transferToWTFString());
}

extern "C" void WebSocket__didReceiveText(WebCore::WebSocket* webSocket, BunString text)
{
    webSocket->didReceiveMessage(text.transferToWTFString());
}

extern "C" void WebSocket__didReceiveBytes(WebCore::WebSocket* webSocket, WebCore::WebSocket::FfiSlice data, const uint8_t op)
{
    webSocket->didReceiveFrame(static_cast<WebCore::WebSocket::Opcode>(op), data.span());
}

extern "C" void WebSocket__didDrain(WebCore::WebSocket* webSocket)
{
    webSocket->didDrain();
}

extern "C" void WebSocket__streamWrite(WebCore::WebSocket* webSocket, WebCore::WebSocket::FfiSlice bytes)
{
    webSocket->streamWrite(bytes.span());
}

extern "C" void WebSocket__streamEnd(WebCore::WebSocket* webSocket)
{
    webSocket->streamEnd();
}

extern "C" void WebSocket__streamDestroy(WebCore::WebSocket* webSocket)
{
    webSocket->streamDestroy();
}

extern "C" bool WebSocket__rejectUnauthorized(WebCore::WebSocket* webSocket, bool forProxy)
{
    return webSocket->rejectUnauthorized(forProxy);
}

extern "C" bool WebSocket__isPaused(WebCore::WebSocket* webSocket)
{
    return webSocket->isPaused();
}

extern "C" bool WebSocket__isProxyTLS(WebCore::WebSocket* webSocket)
{
    return webSocket->isProxyTLS();
}

// Returns the Rust-side context of the script that created the WebSocket. Only called during
// connect(), while the ScriptExecutionContext is known to be alive.
extern "C" void* WebSocket__bunContext(WebCore::WebSocket* webSocket)
{
    return webSocket->scriptExecutionContext()->bunContext();
}

extern "C" JSC::EncodedJSValue WebSocket__checkServerIdentity(WebCore::WebSocket* webSocket, bool forProxy)
{
    return JSC::JSValue::encode(webSocket->checkServerIdentity(forProxy).getValue(JSC::jsUndefined()));
}

extern "C" void WebSocket__setProtocol(WebCore::WebSocket* webSocket, BunString protocol)
{
    webSocket->setProtocol(protocol.transferToWTFString());
}
