/*
 * Copyright (C) 2011 Google Inc.  All rights reserved.
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

#pragma once

#include "wtf/text/StringImpl.h"
#include "wtf/text/StringView.h"
#include "wtf/text/WTFString.h"
#include "wtf/URL.h"
#include "wtf/Vector.h"
#include "wtf/Function.h"
#include <uws/src/WebSocketContext.h>

struct us_socket_context_t;
struct us_socket_t;
struct us_loop_t;

namespace WebCore {

enum ClosingHandshakeCompletionStatus {
    ClosingHandshakeIncomplete,
    ClosingHandshakeComplete
};

// This class expects the stream to already be connected & ready to go
template<bool isSSL, bool isServer>
class WebSocketStreamBase final {
public:
    using WebSocketImpl = uWS::WebSocket<isSSL, isServer>;
    using WebSocketStreamImpl = WebSocketStreamBase<isSSL, isServer>;
    using WebSocketContext = uWS::WebSocketContext<isSSL, isServer>;

    ~WebSocketStreamBase();
    void didConnect();
    void didReceiveMessage(String&&);
    void didReceiveBinaryData(Vector<uint8_t>&&);
    void didReceiveMessageError(String&&);
    void didUpdateBufferedAmount(unsigned bufferedAmount);
    void didStartClosingHandshake();

    static WebSocketStreamImpl* adoptSocket(us_socket_t* socket, ScriptExecutionContext* scriptCtx);
    static void registerHTTPContext(ScriptExecutionContext*, us_socket_context_t*);

    static WebSocketContext* registerClientContext(ScriptExecutionContext*, us_socket_context_t* parent);
    void sendData(const uint8_t* data, size_t length, Function<void(bool)>);
    void close(); // Disconnect after all data in buffer are sent.
    void disconnect();
    size_t bufferedAmount() const;

    void close(int code, const String& reason); // Start closing handshake.
    void fail(String&& reason);
    enum CloseEventCode {
        CloseEventCodeNotSpecified = -1,
        CloseEventCodeNormalClosure = 1000,
        CloseEventCodeGoingAway = 1001,
        CloseEventCodeProtocolError = 1002,
        CloseEventCodeUnsupportedData = 1003,
        CloseEventCodeFrameTooLarge = 1004,
        CloseEventCodeNoStatusRcvd = 1005,
        CloseEventCodeAbnormalClosure = 1006,
        CloseEventCodeInvalidFramePayloadData = 1007,
        CloseEventCodePolicyViolation = 1008,
        CloseEventCodeMessageTooBig = 1009,
        CloseEventCodeMandatoryExt = 1010,
        CloseEventCodeInternalError = 1011,
        CloseEventCodeTLSHandshake = 1015,
        CloseEventCodeMinimumUserDefined = 3000,
        CloseEventCodeMaximumUserDefined = 4999
    };

    void didClose(unsigned unhandledBufferedAmount, ClosingHandshakeCompletionStatus, unsigned short code, const String& reason);
    void didUpgradeURL();

    WebSocketStreamBase()
    {
    }
};

using WebSocketStream = WebSocketStreamBase<false, false>;
using SecureWebSocketStream = WebSocketStreamBase<true, false>;
using ServerWebSocketStream = WebSocketStreamBase<false, true>;
using ServerSecureWebSocketStream = WebSocketStreamBase<true, true>;

} // namespace WebCore
