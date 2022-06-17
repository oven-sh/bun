// /*
//  * Copyright (C) 2011 Google Inc.  All rights reserved.
//  * Copyright (C) Research In Motion Limited 2011. All rights reserved.
//  * Copyright (C) 2018-2021 Apple Inc. All rights reserved.
//  *
//  * Redistribution and use in source and binary forms, with or without
//  * modification, are permitted provided that the following conditions are
//  * met:
//  *
//  *     * Redistributions of source code must retain the above copyright
//  * notice, this list of conditions and the following disclaimer.
//  *     * Redistributions in binary form must reproduce the above
//  * copyright notice, this list of conditions and the following disclaimer
//  * in the documentation and/or other materials provided with the
//  * distribution.
//  *     * Neither the name of Google Inc. nor the names of its
//  * contributors may be used to endorse or promote products derived from
//  * this software without specific prior written permission.
//  *
//  * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
//  * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
//  * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
//  * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
//  * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
//  * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
//  * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
//  * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
//  * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
//  * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
//  * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//  */

// #include "config.h"
// #include "WebSocketHandshake.h"

// #include "HTTPHeaderMap.h"
// #include "HTTPHeaderNames.h"
// #include "HTTPHeaderValues.h"
// #include "HTTPParsers.h"
// #include "ScriptExecutionContext.h"
// #include <wtf/URL.h>
// #include "WebSocket.h"
// #include <wtf/ASCIICType.h>
// #include <wtf/CryptographicallyRandomNumber.h>
// #include <wtf/SHA1.h>
// #include <wtf/StdLibExtras.h>
// #include <wtf/StringExtras.h>
// #include <wtf/Vector.h>
// #include <wtf/text/Base64.h>
// #include <wtf/text/CString.h>
// #include <wtf/text/StringToIntegerConversion.h>
// #include <wtf/text/StringView.h>
// #include <wtf/text/WTFString.h>
// #include <wtf/unicode/CharacterNames.h>

// namespace WebCore {

// static String resourceName(const URL& url)
// {
//     auto path = url.path();
//     auto result = makeString(
//         path,
//         path.isEmpty() ? "/" : "",
//         url.queryWithLeadingQuestionMark());
//     ASSERT(!result.isEmpty());
//     ASSERT(!result.contains(' '));
//     return result;
// }

// static String hostName(const URL& url, bool secure)
// {
//     ASSERT(url.protocolIs("wss") == secure);
//     if (url.port() && ((!secure && url.port().value() != 80) || (secure && url.port().value() != 443)))
//         return makeString(asASCIILowercase(url.host()), ':', url.port().value());
//     return url.host().convertToASCIILowercase();
// }

// static constexpr size_t maxInputSampleSize = 128;
// static String trimInputSample(const uint8_t* p, size_t length)
// {
//     if (length <= maxInputSampleSize)
//         return String(p, length);
//     return makeString(StringView(p, length).left(maxInputSampleSize), horizontalEllipsis);
// }

// static String generateSecWebSocketKey()
// {
//     static const size_t nonceSize = 16;
//     unsigned char key[nonceSize];
//     cryptographicallyRandomValues(key, nonceSize);
//     return base64EncodeToString(key, nonceSize);
// }

// String WebSocketHandshake::getExpectedWebSocketAccept(const String& secWebSocketKey)
// {
//     constexpr uint8_t webSocketKeyGUID[] = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
//     SHA1 sha1;
//     CString keyData = secWebSocketKey.ascii();
//     sha1.addBytes(keyData.dataAsUInt8Ptr(), keyData.length());
//     sha1.addBytes(webSocketKeyGUID, std::size(webSocketKeyGUID) - 1);
//     SHA1::Digest hash;
//     sha1.computeHash(hash);
//     return base64EncodeToString(hash.data(), SHA1::hashSize);
// }

// WebSocketHandshake::WebSocketHandshake(const URL& url, const String& protocol, const String& userAgent, const String& clientOrigin, bool allowCookies, bool isAppInitiated)
//     : m_url(url)
//     , m_clientProtocol(protocol)
//     , m_secure(m_url.protocolIs("wss"))
//     , m_mode(Incomplete)
//     , m_userAgent(userAgent)
//     , m_clientOrigin(clientOrigin)
//     , m_allowCookies(allowCookies)
//     , m_isAppInitiated(isAppInitiated)
// {
//     m_secWebSocketKey = generateSecWebSocketKey();
//     m_expectedAccept = getExpectedWebSocketAccept(m_secWebSocketKey);
// }

// WebSocketHandshake::~WebSocketHandshake() = default;

// const URL& WebSocketHandshake::url() const
// {
//     return m_url;
// }

// // FIXME: Return type should just be String, not const String.
// const String WebSocketHandshake::host() const
// {
//     return m_url.host().convertToASCIILowercase();
// }

// const String& WebSocketHandshake::clientProtocol() const
// {
//     return m_clientProtocol;
// }

// void WebSocketHandshake::setClientProtocol(const String& protocol)
// {
//     m_clientProtocol = protocol;
// }

// bool WebSocketHandshake::secure() const
// {
//     return m_secure;
// }

// String WebSocketHandshake::clientLocation() const
// {
//     return makeString(m_secure ? "wss" : "ws", "://", hostName(m_url, m_secure), resourceName(m_url));
// }

// CString WebSocketHandshake::clientHandshakeMessage() const
// {
//     // Keep the following consistent with clientHandshakeRequest just below.

//     // Cookies are not retrieved in the WebContent process. Instead, a proxy object is
//     // added in the handshake, and is exchanged for actual cookies in the Network process.

//     // Add no-cache headers to avoid a compatibility issue. There are some proxies that
//     // rewrite "Connection: upgrade" to "Connection: close" in the response if a request
//     // doesn't contain these headers.

//     auto extensions = m_extensionDispatcher.createHeaderValue();
// }

// void WebSocketHandshake::reset()
// {
//     m_mode = Incomplete;
// }

// int WebSocketHandshake::readServerHandshake(const uint8_t* header, size_t len)
// {
//     m_mode = Incomplete;
//     int statusCode;
//     AtomString statusText;
//     int lineLength = readStatusLine(header, len, statusCode, statusText);
//     if (lineLength == -1)
//         return -1;
//     if (statusCode == -1) {
//         m_mode = Failed; // m_failureReason is set inside readStatusLine().
//         return len;
//     }
//     // LOG(Network, "WebSocketHandshake %p readServerHandshake() Status code is %d", this, statusCode);

//     m_serverHandshakeResponse = ResourceResponse();
//     m_serverHandshakeResponse.setHTTPStatusCode(statusCode);
//     m_serverHandshakeResponse.setHTTPStatusText(statusText);

//     if (statusCode != 101) {
//         m_mode = Failed;
//         m_failureReason = makeString("Unexpected response code: ", statusCode);
//         return len;
//     }
//     m_mode = Normal;
//     if (!memmem(header, len, "\r\n\r\n", 4)) {
//         // Just hasn't been received fully yet.
//         m_mode = Incomplete;
//         return -1;
//     }
//     auto p = readHTTPHeaders(header + lineLength, header + len);
//     if (!p) {
//         // LOG(Network, "WebSocketHandshake %p readServerHandshake() readHTTPHeaders() failed", this);
//         m_mode = Failed; // m_failureReason is set inside readHTTPHeaders().
//         return len;
//     }
//     if (!checkResponseHeaders()) {
//         // LOG(Network, "WebSocketHandshake %p readServerHandshake() checkResponseHeaders() failed", this);
//         m_mode = Failed;
//         return p - header;
//     }

//     m_mode = Connected;
//     return p - header;
// }

// WebSocketHandshake::Mode WebSocketHandshake::mode() const
// {
//     return m_mode;
// }

// String WebSocketHandshake::failureReason() const
// {
//     return m_failureReason;
// }

// String WebSocketHandshake::serverWebSocketProtocol() const
// {
//     return m_serverHandshakeResponse.httpHeaderFields().get(HTTPHeaderName::SecWebSocketProtocol);
// }

// String WebSocketHandshake::serverSetCookie() const
// {
//     return m_serverHandshakeResponse.httpHeaderFields().get(HTTPHeaderName::SetCookie);
// }

// String WebSocketHandshake::serverUpgrade() const
// {
//     return m_serverHandshakeResponse.httpHeaderFields().get(HTTPHeaderName::Upgrade);
// }

// String WebSocketHandshake::serverConnection() const
// {
//     return m_serverHandshakeResponse.httpHeaderFields().get(HTTPHeaderName::Connection);
// }

// String WebSocketHandshake::serverWebSocketAccept() const
// {
//     return m_serverHandshakeResponse.httpHeaderFields().get(HTTPHeaderName::SecWebSocketAccept);
// }

// void WebSocketHandshake::addExtensionProcessor(std::unique_ptr<WebSocketExtensionProcessor> processor)
// {
//     m_extensionDispatcher.addProcessor(WTFMove(processor));
// }

// URL WebSocketHandshake::httpURLForAuthenticationAndCookies() const
// {
//     URL url = m_url.isolatedCopy();
//     bool couldSetProtocol = url.setProtocol(m_secure ? "https" : "http");
//     ASSERT_UNUSED(couldSetProtocol, couldSetProtocol);
//     return url;
// }

// // https://tools.ietf.org/html/rfc6455#section-4.1
// // "The HTTP version MUST be at least 1.1."
// static inline bool headerHasValidHTTPVersion(StringView httpStatusLine)
// {
//     constexpr char preamble[] = "HTTP/";
//     if (!httpStatusLine.startsWith(preamble))
//         return false;

//     // Check that there is a version number which should be at least three characters after "HTTP/"
//     unsigned preambleLength = strlen(preamble);
//     if (httpStatusLine.length() < preambleLength + 3)
//         return false;

//     auto dotPosition = httpStatusLine.find('.', preambleLength);
//     if (dotPosition == notFound)
//         return false;

//     auto majorVersion = parseInteger<int>(httpStatusLine.substring(preambleLength, dotPosition - preambleLength));
//     if (!majorVersion)
//         return false;

//     unsigned minorVersionLength;
//     unsigned charactersLeftAfterDotPosition = httpStatusLine.length() - dotPosition;
//     for (minorVersionLength = 1; minorVersionLength < charactersLeftAfterDotPosition; minorVersionLength++) {
//         if (!isASCIIDigit(httpStatusLine[dotPosition + minorVersionLength]))
//             break;
//     }
//     auto minorVersion = parseInteger<int>(httpStatusLine.substring(dotPosition + 1, minorVersionLength));
//     if (!minorVersion)
//         return false;

//     return (*majorVersion >= 1 && *minorVersion >= 1) || *majorVersion >= 2;
// }

// // Returns the header length (including "\r\n"), or -1 if we have not received enough data yet.
// // If the line is malformed or the status code is not a 3-digit number,
// // statusCode and statusText will be set to -1 and a null string, respectively.
// int WebSocketHandshake::readStatusLine(const uint8_t* header, size_t headerLength, int& statusCode, AtomString& statusText)
// {
//     // Arbitrary size limit to prevent the server from sending an unbounded
//     // amount of data with no newlines and forcing us to buffer it all.
//     static const int maximumLength = 1024;

//     statusCode = -1;
//     statusText = nullAtom();

//     const uint8_t* space1 = nullptr;
//     const uint8_t* space2 = nullptr;
//     const uint8_t* p;
//     size_t consumedLength;

//     for (p = header, consumedLength = 0; consumedLength < headerLength; p++, consumedLength++) {
//         if (*p == ' ') {
//             if (!space1)
//                 space1 = p;
//             else if (!space2)
//                 space2 = p;
//         } else if (*p == '\0') {
//             // The caller isn't prepared to deal with null bytes in status
//             // line. WebSockets specification doesn't prohibit this, but HTTP
//             // does, so we'll just treat this as an error.
//             m_failureReason = "Status line contains embedded null"_s;
//             return p + 1 - header;
//         } else if (!isASCII(*p)) {
//             m_failureReason = "Status line contains non-ASCII character"_s;
//             return p + 1 - header;
//         } else if (*p == '\n')
//             break;
//     }
//     if (consumedLength == headerLength)
//         return -1; // We have not received '\n' yet.

//     auto end = p + 1;
//     int lineLength = end - header;
//     if (lineLength > maximumLength) {
//         m_failureReason = "Status line is too long"_s;
//         return maximumLength;
//     }

//     // The line must end with "\r\n".
//     if (lineLength < 2 || *(end - 2) != '\r') {
//         m_failureReason = "Status line does not end with CRLF"_s;
//         return lineLength;
//     }

//     if (!space1 || !space2) {
//         m_failureReason = makeString("No response code found: ", trimInputSample(header, lineLength - 2));
//         return lineLength;
//     }

//     StringView httpStatusLine(header, space1 - header);
//     if (!headerHasValidHTTPVersion(httpStatusLine)) {
//         m_failureReason = makeString("Invalid HTTP version string: ", httpStatusLine);
//         return lineLength;
//     }

//     StringView statusCodeString(space1 + 1, space2 - space1 - 1);
//     if (statusCodeString.length() != 3) // Status code must consist of three digits.
//         return lineLength;
//     for (int i = 0; i < 3; ++i) {
//         if (!isASCIIDigit(statusCodeString[i])) {
//             m_failureReason = makeString("Invalid status code: ", statusCodeString);
//             return lineLength;
//         }
//     }

//     statusCode = parseInteger<int>(statusCodeString).value();
//     statusText = AtomString(space2 + 1, end - space2 - 3); // Exclude "\r\n".
//     return lineLength;
// }

// const uint8_t* WebSocketHandshake::readHTTPHeaders(const uint8_t* start, const uint8_t* end)
// {
//     StringView name;
//     String value;
//     bool sawSecWebSocketExtensionsHeaderField = false;
//     bool sawSecWebSocketAcceptHeaderField = false;
//     bool sawSecWebSocketProtocolHeaderField = false;
//     auto p = start;
//     for (; p < end; p++) {
//         size_t consumedLength = parseHTTPHeader(p, end - p, m_failureReason, name, value);
//         if (!consumedLength)
//             return nullptr;
//         p += consumedLength;

//         // Stop once we consumed an empty line.
//         if (name.isEmpty())
//             break;

//         HTTPHeaderName headerName;
//         if (!findHTTPHeaderName(name, headerName)) {
//             // Evidence in the wild shows that services make use of custom headers in the handshake
//             m_serverHandshakeResponse.addUncommonHTTPHeaderField(name.toString(), value);
//             continue;
//         }

//         // https://tools.ietf.org/html/rfc7230#section-3.2.4
//         // "Newly defined header fields SHOULD limit their field values to US-ASCII octets."
//         if ((headerName == HTTPHeaderName::SecWebSocketExtensions
//                 || headerName == HTTPHeaderName::SecWebSocketAccept
//                 || headerName == HTTPHeaderName::SecWebSocketProtocol)
//             && !value.isAllASCII()) {
//             m_failureReason = makeString(name, " header value should only contain ASCII characters");
//             return nullptr;
//         }

//         if (headerName == HTTPHeaderName::SecWebSocketExtensions) {
//             if (sawSecWebSocketExtensionsHeaderField) {
//                 m_failureReason = "The Sec-WebSocket-Extensions header must not appear more than once in an HTTP response"_s;
//                 return nullptr;
//             }
//             sawSecWebSocketExtensionsHeaderField = true;
//         } else {
//             if (headerName == HTTPHeaderName::SecWebSocketAccept) {
//                 if (sawSecWebSocketAcceptHeaderField) {
//                     m_failureReason = "The Sec-WebSocket-Accept header must not appear more than once in an HTTP response"_s;
//                     return nullptr;
//                 }
//                 sawSecWebSocketAcceptHeaderField = true;
//             } else if (headerName == HTTPHeaderName::SecWebSocketProtocol) {
//                 if (sawSecWebSocketProtocolHeaderField) {
//                     m_failureReason = "The Sec-WebSocket-Protocol header must not appear more than once in an HTTP response"_s;
//                     return nullptr;
//                 }
//                 sawSecWebSocketProtocolHeaderField = true;
//             }

//             m_serverHandshakeResponse.addHTTPHeaderField(headerName, value);
//         }
//     }
//     return p;
// }

// bool WebSocketHandshake::checkResponseHeaders()
// {
//     const String& serverWebSocketProtocol = this->serverWebSocketProtocol();
//     const String& serverUpgrade = this->serverUpgrade();
//     const String& serverConnection = this->serverConnection();
//     const String& serverWebSocketAccept = this->serverWebSocketAccept();

//     if (serverUpgrade.isNull()) {
//         m_failureReason = "Error during WebSocket handshake: 'Upgrade' header is missing"_s;
//         return false;
//     }
//     if (serverConnection.isNull()) {
//         m_failureReason = "Error during WebSocket handshake: 'Connection' header is missing"_s;
//         return false;
//     }
//     if (serverWebSocketAccept.isNull()) {
//         m_failureReason = "Error during WebSocket handshake: 'Sec-WebSocket-Accept' header is missing"_s;
//         return false;
//     }

//     if (!equalLettersIgnoringASCIICase(serverUpgrade, "websocket"_s)) {
//         m_failureReason = "Error during WebSocket handshake: 'Upgrade' header value is not 'WebSocket'"_s;
//         return false;
//     }
//     if (!equalLettersIgnoringASCIICase(serverConnection, "upgrade"_s)) {
//         m_failureReason = "Error during WebSocket handshake: 'Connection' header value is not 'Upgrade'"_s;
//         return false;
//     }

//     if (serverWebSocketAccept != m_expectedAccept) {
//         m_failureReason = "Error during WebSocket handshake: Sec-WebSocket-Accept mismatch"_s;
//         return false;
//     }
//     if (!serverWebSocketProtocol.isNull()) {
//         if (m_clientProtocol.isEmpty()) {
//             m_failureReason = "Error during WebSocket handshake: Sec-WebSocket-Protocol mismatch"_s;
//             return false;
//         }
//         Vector<String> result = m_clientProtocol.split(StringView { WebSocket::subprotocolSeparator() });
//         if (!result.contains(serverWebSocketProtocol)) {
//             m_failureReason = "Error during WebSocket handshake: Sec-WebSocket-Protocol mismatch"_s;
//             return false;
//         }
//     }
//     return true;
// }

// } // namespace WebCore
