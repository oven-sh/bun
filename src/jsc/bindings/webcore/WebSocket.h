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
    const void* get() const { return m_ptr; }

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

// A parsed `tls` or `proxy.tls` option.
struct WebSocketTLSOptions {
    WebSocketSSLConfigPtr sslConfig;
    std::optional<bool> rejectUnauthorized;
    // create()'s caller stores this on the wrapper. Until then the JS options object keeps it alive.
    JSC::JSValue checkServerIdentity;
};

// The parsed `options` argument of `new WebSocket(url, options)`. Filled in by JSWebSocket.cpp.
struct WebSocketOptions {
    Vector<String> protocols;
    std::optional<FetchHeaders::Init> headers;
    String proxyURL;
    std::optional<FetchHeaders::Init> proxyHeaders;
    WebSocketTLSOptions tls;
    // `proxy.tls`. If set, it alone applies to the connection to the proxy and `tls` alone to the target.
    // Otherwise `tls` applies to both.
    std::optional<WebSocketTLSOptions> proxyTLS;
    // Value of the Sec-WebSocket-Extensions request header (the permessage-deflate offer). Null omits the header.
    String extensions { "permessage-deflate; client_max_window_bits"_s };
    WebSocketConnectedOptions connected { 128 * 1024 * 1024, true, false, false, false };
};

// Options for createOverStream(): the handshake is already done and a JS stream is the transport. Used by the `ws` module.
struct WebSocketStreamOptions {
    String url;
    String protocol;
    String extensions;
    WebSocketConnectedOptions connected { 128 * 1024 * 1024, true, true, false, false };
    std::optional<PerMessageDeflateParams> deflate;
};

// Reads `object.deflate`, the negotiated permessage-deflate parameters as the `ws` module passes them:
// { serverMaxWindowBits, clientMaxWindowBits, serverNoContextTakeover, clientNoContextTakeover }, or undefined for no compression.
// Defined in JSWebSocket.cpp.
std::optional<PerMessageDeflateParams> convertDeflateParamsForWs(JSC::JSGlobalObject*, JSC::JSObject*);

class WebSocket final : public RefCounted<WebSocket>, public EventTargetWithInlineData, public ActiveDOMObject {
    WTF_MAKE_TZONE_ALLOCATED(WebSocket);

public:
    // ActiveDOMObject.
    void ref() const final { RefCounted::ref(); }
    void deref() const final { RefCounted::deref(); }
    USING_CAN_MAKE_WEAKPTR(EventTargetWithInlineData);

    static ASCIILiteral subprotocolSeparator();

    static ExceptionOr<Ref<WebSocket>> create(ScriptExecutionContext&, const String& url, WebSocketOptions&& = {});
    // The returned socket is already OPEN.
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

    // Flags passed to the native client's write functions.
    enum FrameFlags : uint8_t {
        Fin = 1 << 0,
        CompressIfLargeEnough = 1 << 1,
        Compress = 1 << 2,
    };

    // The span only has to stay valid during the call. A String is sent as UTF-8.
    using Payload = std::variant<std::span<const uint8_t>, String>;
    // Implements send(), ping() and pong(). Throws while CONNECTING. Once CLOSING, data frames are dropped but still added to bufferedAmount.
    ExceptionOr<void> sendFrame(Opcode, const Payload&, uint8_t flags = Fin | CompressIfLargeEnough);

    ExceptionOr<void> close(std::optional<unsigned short> code, const String& reason);
    void terminate();
    // Receive-side flow control (non-standard; mirrors Bun.Socket). pause()
    // stops kernel reads so TCP backpressure reaches the peer; frames already
    // decoded still dispatch. Before OPEN it latches and applies on connect,
    // and also pauses the body of a non-101 response.
    bool pause();
    bool resume();
    bool isPaused() const { return m_paused && canPause(); }

    // setRef() and remoteAddress() back the `ws` module's `_socket`.
    // Sets whether the connection keeps the process alive. An unref while CONNECTING is applied once connected.
    void setRef(bool);
    struct RemoteAddress {
        String address;
        uint16_t port;
        bool isIPv6;
    };
    // Returns nullopt if not connected or if connected over a unix socket. Behind a proxy, this is the proxy's address.
    std::optional<RemoteAddress> remoteAddress() const;
    // createOverStream() only. Parses bytes read from the stream. Handlers run before this returns, so the span must stay valid throughout.
    void feed(std::span<const uint8_t>);
    // createOverStream() only. The stream was closed.
    void streamClosed();

    void setProtocol(const String& protocol);

    const URL& url() const;
    State readyState() const;
    unsigned bufferedAmount() const;
    // Through a proxy, the socket to the proxy. Null unless connected, and on the stream transport.
    us_socket_t* usSocket() const;

    String protocol() const;
    String extensions() const;

    BinaryType binaryType() const { return m_binaryType; }
    void setBinaryType(const String&);

    ScriptExecutionContext* scriptExecutionContext() const final;
    void dispatchEvent(Event&) final;

    // Both return the connected native client, or null if it was already dropped (e.g. an `open` listener closed it).
    void* didConnect(us_socket_t* socket, void* bufferedData, const PerMessageDeflateParams* deflate_params, void* customSSLCtx, std::span<const uint8_t> verifiedHostname);
    void* didConnectWithTunnel(void* tunnel, void* bufferedData, const PerMessageDeflateParams* deflate_params);
    // The peer's Close frame arrived. `code` is 1005 if the frame had none. In ws mode this calls handlers.conclude(code, reason).
    void didStartClosingHandshake(unsigned short code, String&& reason);
    void didClose(unsigned short code, String&& reason, bool wasClean, size_t bufferedAmount);
    // Fires `error`, then `close` with code 1006. The native client's `text` and `code` come from `ErrorCode::info()` in websocket_client.rs.
    void didFail(String&& text, size_t bufferedAmount = 0, String&& code = {}, String&& detail = {});
    // ws mode only: an open connection failed. Calls handlers.error right away. The native client stays alive until the connection closes, then calls didClose().
    void didError(String&& text, String&& code, String&& detail);
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
    // Same layout as `bun_picohttp::Header`.
    struct HandshakeRawHeader {
        FfiSlice name;
        FfiSlice value;
    };
    // Matches `HandshakeResult` in CppWebSocket.rs.
    struct HandshakeResult {
        bool accepted;
        bool hasDeflate;
        PerMessageDeflateParams deflate;
    };
    // In ws mode this calls handlers.handshake, which validates a 101 and returns { deflate } to accept it. The native client doesn't validate it again.
    // Otherwise it dispatches a `handshake` event and `accepted` is false.
    HandshakeResult didReceiveHandshakeResponse(uint16_t statusCode, std::span<const uint8_t> statusMessage, std::span<const HandshakeRawHeader> headers, bool isUpgrade, std::span<const uint8_t> body);
    // True for sockets created by the `ws` module. They call the wrapper's handler table instead of dispatching Events.
    bool isWsMode() const { return m_connectedOptions.ws_mode; }
    // ws mode only: the decoded body of a non-101 response. Calls handlers.body(chunk) per chunk, then
    // handlers.body(null, aborted, reset) at the end. handlers.error and handlers.close aren't called after that.
    void didReceiveResponseBody(std::span<const uint8_t> chunk);
    void didEndResponseBody(bool aborted, bool reset);

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
    // close, from the same task that would otherwise fire the close event.
    struct NativeCallbacks {
        void* ctx = nullptr;
        void (*onOpen)(void* ctx) = nullptr;
        void (*onMessage)(void* ctx, std::span<const char> utf8) = nullptr;
        void (*onClose)(void* ctx, unsigned short code) = nullptr;
    };
    void setNativeCallbacks(NativeCallbacks cb) { m_native = cb; }

    // For NativeCallbacks consumers. Doesn't return an exception because there's no JS caller to throw it to.
    void sendTextNative(const String& message)
    {
        if (m_state != OPEN) return;
        sendWebSocketString(message, Opcode::Text, Fin | CompressIfLargeEnough);
    }

    bool rejectUnauthorized(bool forProxy) const
    {
        return forProxy ? m_proxyRejectUnauthorized : m_rejectUnauthorized;
    }

    bool isProxyTLS() const { return m_connectionType == ConnectionType::ProxyTLS; }

    // Unlike the other `tls` options, `tls.checkServerIdentity` never applies to the proxy. Only `proxy.tls`'s does.
    const JSValueInWrappedObject& checkServerIdentity(bool forProxy) const
    {
        return forProxy ? m_proxyCheckServerIdentity : m_checkServerIdentity;
    }
    void setCheckServerIdentity(JSC::VM& vm, const JSC::JSCell* wrapper, JSC::JSValue callback, bool forProxy)
    {
        (forProxy ? m_proxyCheckServerIdentity : m_checkServerIdentity).set(vm, wrapper, callback);
    }

    // The async context captured by the constructor. Trusted events are dispatched inside it.
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
        String text;
        // `error.code`
        String code;
        String detail;
    };

    // ActiveDOMObject. Read from the GC thread. A stale value only keeps or collects the wrapper
    // one GC cycle late or early, which upstream WebKit also tolerates.
    void stop() final;
    // On the stream transport, the JS stream keeps the WebSocket alive instead.
    bool virtualHasPendingActivity() const final { return m_state != CLOSED && m_connectionType != ConnectionType::Stream; }

    explicit WebSocket(ScriptExecutionContext&);

    EventTargetInterface eventTargetInterface() const final;

    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }

    ExceptionOr<void> connect(const String& url, WebSocketOptions&&);
    void* didConnect();
    // Clears the native client pointers, which are no longer valid. Sets CLOSING, then queues a task that sets CLOSED and fires the events.
    // On the stream transport that happens synchronously.
    void finish(size_t bufferedAmount, unsigned short code, String&& reason, bool wasClean, std::optional<Failure>&&);
    void reportFailure(const Failure&);
    void didReceiveBinaryData(const AtomString& eventName, const std::span<const uint8_t> binaryData);

    // handlers[name].call(owner, ...arguments). An error it throws is reported as an uncaught exception.
    // Returns the handler's return value, or an empty JSValue if it threw or wasn't called.
    JSC::JSValue callHandler(const JSC::Identifier& name, const JSC::ArgList&);
    void callHandlerWithBuffer(const JSC::Identifier& name, std::span<const uint8_t>, JSC::JSValue secondArgument = {});
    // After close(), a WHATWG socket drops incoming frames. The `ws` module keeps receiving them until the peer's Close frame.
    bool shouldDispatchFrames() const { return m_state == OPEN || (m_state == CLOSING && isWsMode()); }
    bool canPause() const { return m_state == CONNECTING || shouldDispatchFrames(); }

    // TLS and ProxyTLS both hold a TLS socket to the next hop.
    bool usesTLSSocket() const { return m_connectionType == ConnectionType::TLS || m_connectionType == ConnectionType::ProxyTLS; }

    // Calls Plain or TLS with the connected native client as the first argument. Without a client, returns a default-constructed result.
    template<auto Plain, auto TLS, class... Args>
    auto callClient(Args... args) const
    {
        switch (m_connectedWebSocketKind) {
        case ConnectedWebSocketKind::Client:
            return Plain(m_connectedWebSocket.client, args...);
        case ConnectedWebSocketKind::ClientSSL:
            return TLS(m_connectedWebSocket.clientSSL, args...);
        case ConnectedWebSocketKind::None:
            break;
        }
        return decltype(Plain(m_connectedWebSocket.client, args...))();
    }

    void sendWebSocketString(const String& message, Opcode, uint8_t flags);
    void sendWebSocketData(std::span<const uint8_t>, Opcode, uint8_t flags);
    void setExtensionsFromDeflateParams(const PerMessageDeflateParams* deflate_params);

    State m_state { CONNECTING };
    URL m_url;
    String m_origin;
    // Bytes that will never be sent: whatever the native client still had buffered when the connection closed, plus send() calls since CLOSING.
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
    // cancelUpgradeClient() drops the in-flight upgrade without a callback. cancelConnectedClient() drops the connection, and
    // the native client then calls didClose().
    void cancelUpgradeClient();
    void cancelConnectedClient();
    bool applyPauseToConnectedClient();
    // Bytes that arrived with the 101 stay buffered while paused. Parse them from a task so listeners never run inside resume() or close().
    void queueInitialDataDelivery();
    bool m_rejectUnauthorized { false };
    // Kept after connect() because the connected client verifies an https: proxy again when it renegotiates.
    bool m_proxyRejectUnauthorized { false };
    bool m_paused { false };
    bool m_unref { false };
    WebSocketConnectedOptions m_connectedOptions {};
    AnyWebSocket m_connectedWebSocket { nullptr };
    ConnectedWebSocketKind m_connectedWebSocketKind { ConnectedWebSocketKind::None };
    // Keeps the wrapper alive from connect() until finish() or stop(). Queued event tasks keep it
    // alive on their own through queueTaskKeepingObjectAlive().
    RefPtr<PendingActivity<WebSocket>> m_pendingActivity;

    // `tls.checkServerIdentity`, `proxy.tls.checkServerIdentity` and the async context, marked by JSWebSocket::visitChildren.
    JSValueInWrappedObject m_checkServerIdentity;
    JSValueInWrappedObject m_proxyCheckServerIdentity;
    JSValueInWrappedObject m_asyncContext;

    NativeCallbacks m_native;
};

} // namespace WebCore
