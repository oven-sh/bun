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

#include "WebSocketDeflate.h"
#include "ActiveDOMObject.h"
#include "EventTarget.h"
#include "ExceptionOr.h"
#include <wtf/URL.h>
#include <wtf/HashSet.h>
#include <wtf/Lock.h>
#include "FetchHeaders.h"
#include "WebSocketErrorCode.h"
#include "JSValueInWrappedObject.h"
#include <span>
#include <variant>

namespace JSC {
class ArgList;
class Identifier;
}

extern "C" void Bun__WebSocket__freeSSLConfig(void* sslConfig);

namespace WebCore {

// Move-only owning handle for the natively heap-allocated SSLConfig returned by
// Bun__WebSocket__parseSSLConfig. The SSLConfig holds duped cert/key/CA
// strings, so every exception / early-return path between parsing and the
// upgrade client taking ownership must free it. Wrapping the raw `void*`
// in this RAII type lets normal C++ destruction handle all of those paths
// without ad-hoc scope guards or manual frees at each call site.
class WebSocketSSLConfigPtr {
    WTF_MAKE_NONCOPYABLE(WebSocketSSLConfigPtr);

public:
    WebSocketSSLConfigPtr() = default;
    explicit WebSocketSSLConfigPtr(void* ptr)
        : m_ptr(ptr)
    {
    }
    WebSocketSSLConfigPtr(WebSocketSSLConfigPtr&& other)
        : m_ptr(std::exchange(other.m_ptr, nullptr))
    {
    }
    WebSocketSSLConfigPtr& operator=(WebSocketSSLConfigPtr&& other)
    {
        if (this != &other) {
            reset();
            m_ptr = std::exchange(other.m_ptr, nullptr);
        }
        return *this;
    }
    ~WebSocketSSLConfigPtr() { reset(); }

    explicit operator bool() const { return m_ptr != nullptr; }

    // Transfer ownership out to the upgrade client; after this the
    // destructor is a no-op.
    void* release() { return std::exchange(m_ptr, nullptr); }

private:
    void reset()
    {
        if (m_ptr) {
            Bun__WebSocket__freeSSLConfig(m_ptr);
            m_ptr = nullptr;
        }
    }

    void* m_ptr { nullptr };
};

// The second argument of `new WebSocket(url, options)`, converted. JSWebSocket.cpp fills it.
struct WebSocketOptions {
    Vector<String> protocols;
    std::optional<FetchHeaders::Init> headers;
    String proxyURL;
    std::optional<FetchHeaders::Init> proxyHeaders;
    WebSocketSSLConfigPtr sslConfig;
    std::optional<bool> rejectUnauthorized;
    // The caller of create() sets it on the wrapper; the options argument keeps it alive until then.
    JSC::JSValue checkServerIdentity;
    // The Sec-WebSocket-Extensions request header: a permessage-deflate offer. Null: no header.
    String extensions { "permessage-deflate; client_max_window_bits"_s };
    WebSocketConnectedOptions connected { 128 * 1024 * 1024, true, false, false, false, false };
};

// A connection whose handshake is done and whose bytes travel over a stream that lives in JS. For the `ws` module.
struct WebSocketStreamOptions {
    String url;
    String protocol;
    String extensions;
    WebSocketConnectedOptions connected { 128 * 1024 * 1024, true, true, false, false, false };
    std::optional<PerMessageDeflateParams> deflate;
};

class WebSocket final : public RefCounted<WebSocket>, public EventTargetWithInlineData, public ActiveDOMObject {
    WTF_MAKE_TZONE_ALLOCATED(WebSocket);

public:
    // ActiveDOMObject.
    void ref() const final { RefCounted::ref(); }
    void deref() const final { RefCounted::deref(); }
    USING_CAN_MAKE_WEAKPTR(EventTargetWithInlineData);

    static ASCIILiteral subprotocolSeparator();

    static ExceptionOr<Ref<WebSocket>> create(ScriptExecutionContext&, const String& url, WebSocketOptions&& = {});
    // OPEN from the start.
    static Ref<WebSocket> createOverStream(ScriptExecutionContext&, WebSocketStreamOptions&&);
    ~WebSocket();

    enum State {
        CONNECTING = 0,
        OPEN = 1,
        CLOSING = 2,
        CLOSED = 3,
    };

    enum class BinaryType { Blob,
        ArrayBuffer,
        // non-standard:
        NodeBuffer };

    enum Opcode : unsigned char {
        Continue = 0x0,
        Text = 0x1,
        Binary = 0x2,
        Close = 0x8,
        Ping = 0x9,
        Pong = 0xA,
    };

    // Tracks the connection type for both the upgrade client and the connected websocket.
    // This replaces separate m_isSecure and m_proxyIsHTTPS bools.
    enum class ConnectionType : uint8_t {
        Plain, // ws:// direct connection
        TLS, // wss:// direct connection
        ProxyPlain, // ws:// or wss:// through HTTP proxy (plain socket to proxy)
        ProxyTLS, // ws:// or wss:// through HTTPS proxy (TLS socket to proxy)
        Stream // createOverStream()
    };

    // The write flags of the native client.
    enum FrameFlags : uint8_t {
        Fin = 1 << 0,
        CompressIfWorthIt = 1 << 1,
        Compress = 1 << 2,
    };

    // The bytes are borrowed for the call. A String goes out as UTF-8.
    using Payload = std::variant<std::span<const uint8_t>, String>;
    // send(), ping() and pong(). Throws while CONNECTING; once CLOSING, a data frame only counts in bufferedAmount.
    ExceptionOr<void> sendFrame(Opcode, const Payload&, uint8_t flags = Fin | CompressIfWorthIt);

    ExceptionOr<void> close(std::optional<unsigned short> code, const String& reason);
    void terminate();
    // Receive-side flow control (non-standard; mirrors Bun.Socket). pause()
    // stops kernel reads so TCP backpressure reaches the peer; frames already
    // decoded still dispatch. Before OPEN it latches and applies on connect.
    bool pause();
    bool resume();
    bool isPaused() const { return m_paused && (m_state == CONNECTING || m_state == OPEN); }

    // For `_socket` of the `ws` module.
    // Whether the connection keeps the process alive. An unref() while CONNECTING holds once connected.
    void setRef(bool);
    struct RemoteAddress {
        String address;
        uint16_t port;
        bool isIPv6;
    };
    // nullopt unless connected, and for a unix socket. Through a proxy it is the proxy's.
    std::optional<RemoteAddress> remoteAddress() const;
    // Only after createOverStream(). The bytes read from the stream, borrowed for the call: the handlers run inside it.
    void feed(std::span<const uint8_t>);
    // The stream is gone.
    void streamClosed();

    void setProtocol(const String& protocol);

    const URL& url() const;
    State readyState() const;
    unsigned bufferedAmount() const;

    String protocol() const;
    String extensions() const;

    BinaryType binaryType() const { return m_binaryType; }
    void setBinaryType(const String&);

    ScriptExecutionContext* scriptExecutionContext() const final;
    void dispatchEvent(Event&) final;

    // Both return the connected client, or null if `open` already dropped it.
    void* didConnect(us_socket_t* socket, void* bufferedData, const PerMessageDeflateParams* deflate_params, void* customSSLCtx, std::span<const uint8_t> verifiedHostname);
    void* didConnectWithTunnel(void* tunnel, void* bufferedData, const PerMessageDeflateParams* deflate_params);
    void didStartClosingHandshake();
    void didClose(unsigned short code, String&& reason, bool wasClean, size_t bufferedAmount);
    void didFail(Bun::WebSocketErrorCode, size_t bufferedAmount, String&& systemCode, String&& detail);
    void didDrain();
    void streamWrite(std::span<const uint8_t>);
    void streamEnd();
    void streamDestroy();

    void didReceiveMessage(String&& message);
    void didReceiveFrame(Opcode, std::span<const uint8_t>);
    /// `bun_core::ffi::FfiSlice` — a borrowed `&[u8]` passed by value.
    struct FfiSlice {
        const uint8_t* ptr;
        size_t len;
        std::span<const uint8_t> span() const { return { ptr, len }; }
    };
    struct HandshakeRawHeader {
        FfiSlice name;
        FfiSlice value;
    };
    void didReceiveHandshakeResponse(uint16_t statusCode, std::span<const uint8_t> statusMessage, std::span<const HandshakeRawHeader> headers, std::span<const uint8_t> body);
    // The `ws` module gets the decoded body of a response that is not a 101: handlers.body(chunk), then handlers.body(null).
    // That response is the outcome, so neither handlers.error nor handlers.close follows.
    bool readsResponseBody() const { return isWsMode(); }
    void didReceiveResponseBody(std::span<const uint8_t> chunk, bool ended);

    // C++-only callback mode. When set, didConnect/didReceiveMessage/
    // didClose call these function pointers directly instead of building
    // Event objects and going through dispatchEvent. onOpen and onMessage fire
    // synchronously from the socket's onData — no event-loop tick deferral, no JSValue
    // allocation. Used when a C++ subsystem owns the socket lifecycle
    // end-to-end (e.g. CDP::Transport connecting to an existing Chrome
    // instance over ws://, where every message is handled by C++ JSON
    // parsing and JS only sees the final settled promise).
    //
    // onMessage gets text frames only — binary frames are dropped (the
    // only current consumer speaks JSON). If a consumer needs binary,
    // add onBinary alongside. onClose fires for both clean and abrupt
    // close, from the task that would fire the close event.
    struct NativeCallbacks {
        void* ctx = nullptr;
        void (*onOpen)(void* ctx) = nullptr;
        void (*onMessage)(void* ctx, std::span<const char> utf8) = nullptr;
        void (*onClose)(void* ctx, unsigned short code) = nullptr;
    };
    void setNativeCallbacks(NativeCallbacks cb) { m_native = cb; }

    // For the native-callback consumer: there is no JS caller to surface an exception to.
    void sendTextNative(const String& message)
    {
        if (m_state != OPEN) return;
        sendWebSocketString(message, Opcode::Text, Fin | CompressIfWorthIt);
    }

    bool rejectUnauthorized() const
    {
        return m_rejectUnauthorized;
    }

    bool isProxyTLS() const { return m_connectionType == ConnectionType::ProxyTLS; }

    const JSValueInWrappedObject& checkServerIdentity() const { return m_checkServerIdentity; }
    void setCheckServerIdentity(JSC::VM& vm, const JSC::JSCell* wrapper, JSC::JSValue callback)
    {
        m_checkServerIdentity.set(vm, wrapper, callback);
    }

    // The async context of the constructor call. Every trusted event is dispatched in it.
    const JSValueInWrappedObject& asyncContext() const { return m_asyncContext; }
    void setAsyncContext(JSC::VM& vm, const JSC::JSCell* wrapper, JSC::JSValue context)
    {
        m_asyncContext.set(vm, wrapper, context);
    }

    size_t memoryCost() const;

private:
    typedef union AnyWebSocket {
        WebSocketClient* client;
        WebSocketClientTLS* clientSSL;
    } AnyWebSocket;
    enum ConnectedWebSocketKind {
        None,
        Client,
        ClientSSL,
    };

    struct Failure {
        ASCIILiteral text;
        // `error.code`
        String code;
        String detail;
    };

    // ActiveDOMObject. Read from the GC thread; a stale answer keeps or drops the wrapper one
    // cycle early or late, as upstream tolerates.
    void stop() final;
    // A stream lives in JS: it is what keeps its WebSocket alive.
    bool virtualHasPendingActivity() const final { return m_state != CLOSED && m_connectionType != ConnectionType::Stream; }

    explicit WebSocket(ScriptExecutionContext&);

    EventTargetInterface eventTargetInterface() const final;

    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }

    ExceptionOr<void> connect(const String& url, WebSocketOptions&&);
    void* didConnect();
    // `error`, then `close` with 1006.
    void failConnection(ASCIILiteral text, size_t bufferedAmount = 0, String&& code = {}, String&& detail = {});
    // The native clients are gone. CLOSING now; one task sets CLOSED and fires the events (over a stream: at once).
    void finish(size_t bufferedAmount, unsigned short code, String&& reason, bool wasClean, std::optional<Failure>&&);
    void reportFailure(const Failure&);
    void didReceiveBinaryData(const AtomString& eventName, const std::span<const uint8_t> binaryData);

    // Made by the `ws` module: nothing is dispatched as an Event, the wrapper's handler table is called.
    bool isWsMode() const { return m_connectedOptions.text_as_bytes; }
    // handlers[name].call(owner, ...arguments). What it throws is reported as an uncaught exception.
    void callHandler(const JSC::Identifier& name, const JSC::ArgList&);
    void callHandlerWithBuffer(const JSC::Identifier& name, std::span<const uint8_t>, JSC::JSValue secondArgument = {});
    // The `ws` module hears frames until the peer's Close frame.
    bool dispatchesFrames() const { return m_state == OPEN || (m_state == CLOSING && isWsMode()); }

    void sendWebSocketString(const String& message, Opcode, uint8_t flags);
    void sendWebSocketData(std::span<const uint8_t>, Opcode, uint8_t flags);
    void setExtensionsFromDeflateParams(const PerMessageDeflateParams* deflate_params);

    State m_state { CONNECTING };
    URL m_url;
    String m_origin;
    // Bytes that will never go out: what the native client still held when it went away, and send() since CLOSING.
    unsigned m_bufferedAmount { 0 };
    // In browsers, the default is Blob, however most applications
    // immediately change the default to ArrayBuffer.
    //
    // And since we know the typical usage is to override the default,
    // we set NodeBuffer as the default to match the default of ServerWebSocket.
    BinaryType m_binaryType { BinaryType::NodeBuffer };
    String m_subprotocol;
    String m_extensions;
    void* m_upgradeClient { nullptr };
    ConnectionType m_connectionType { ConnectionType::Plain };
    // Drop the in-flight upgrade without a callback / the connected client, which answers with didClose().
    void cancelUpgradeClient();
    void cancelConnectedClient();
    bool applyPauseToConnectedClient();
    // The bytes that came with the 101 wait while paused. They are parsed from a task, never inside resume() or close().
    void queueInitialDataDelivery();
    bool m_rejectUnauthorized { false };
    bool m_paused { false };
    bool m_unref { false };
    WebSocketConnectedOptions m_connectedOptions {};
    AnyWebSocket m_connectedWebSocket { nullptr };
    ConnectedWebSocketKind m_connectedWebSocketKind { ConnectedWebSocketKind::None };
    // connect()'s claim on the wrapper: held from connect() until finish() (or
    // stop()). Posted event tasks keep it alive through queueTaskKeepingObjectAlive().
    RefPtr<PendingActivity<WebSocket>> m_pendingActivity;

    // `tls.checkServerIdentity` and the async context, marked by JSWebSocket::visitChildren.
    JSValueInWrappedObject m_checkServerIdentity;
    JSValueInWrappedObject m_asyncContext;

    NativeCallbacks m_native;
};

} // namespace WebCore
