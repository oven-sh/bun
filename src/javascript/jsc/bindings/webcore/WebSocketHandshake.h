// /*
//  * Copyright (C) 2011 Google Inc.  All rights reserved.
//  * Copyright (C) 2021 Apple Inc. All rights reserved.
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

// #pragma once

// #include <wtf/URL.h>
// #include <wtf/WeakPtr.h>
// #include <wtf/text/WTFString.h>

// namespace WebCore {

// class WebSocketHandshake {

// public:
//     enum Mode {
//         Incomplete,
//         Normal,
//         Failed,
//         Connected
//     };
//     WebSocketHandshake(const URL&, const String& protocol);
//     ~WebSocketHandshake() {}

//     const URL& url() const;
//     void setURL(const URL&);
//     URL httpURLForAuthenticationAndCookies() const;
//     const String host() const;

//     const String& clientProtocol() const;
//     void setClientProtocol(const String&);

//     bool secure() const;

//     String clientLocation() const;

//     CString clientHandshakeMessage() const;

//     void reset();

//     int readServerHandshake(const uint8_t* header, size_t len);
//     Mode mode() const;
//     String failureReason() const; // Returns a string indicating the reason of failure if mode() == Failed.

//     String serverWebSocketProtocol() const;
//     String serverSetCookie() const;
//     String serverUpgrade() const;
//     String serverConnection() const;
//     String serverWebSocketAccept() const;
//     String acceptedExtensions() const;

//     // void addExtensionProcessor(std::unique_ptr<WebSocketExtensionProcessor>);

//     static String getExpectedWebSocketAccept(const String& secWebSocketKey);

// private:
//     int readStatusLine(const uint8_t* header, size_t headerLength, int& statusCode, AtomString& statusText);

//     // Reads all headers except for the two predefined ones.
//     const uint8_t* readHTTPHeaders(const uint8_t* start, const uint8_t* end);
//     void processHeaders();
//     bool checkResponseHeaders();

//     URL m_url;
//     String m_clientProtocol;
//     bool m_secure;

//     Mode m_mode;
//     String m_failureReason;

//     String m_secWebSocketKey;
//     String m_expectedAccept;
// };

// } // namespace WebCore
