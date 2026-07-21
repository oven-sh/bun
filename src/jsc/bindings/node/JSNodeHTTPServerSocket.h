#pragma once

#include "root.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSObject.h>
#include "BunClientData.h"
#include <wtf/Lock.h>
#include <wtf/Vector.h>
#include <wtf/text/StringView.h>

extern "C" {
struct us_socket_stream_buffer_t {
    char* list_ptr = nullptr;
    size_t list_cap = 0;
    size_t listLen = 0;
    size_t total_bytes_written = 0;
    size_t cursor = 0;

    size_t totalBytesWritten() const
    {
        return total_bytes_written;
    }
};

struct us_socket_t;
}

namespace uWS {
template<bool SSL, bool IsNodeHttp>
struct HttpResponseData;
struct WebSocketData;
}

namespace WebCore {
class JSNodeHTTPResponse;
}

namespace Bun {

class JSNodeHTTPServerSocketPrototype;

class JSNodeHTTPServerSocket : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    us_socket_stream_buffer_t streamBuffer = {};
    us_socket_t* socket = nullptr;
    unsigned is_ssl : 1 = 0;
    unsigned ended : 1 = 0;
    unsigned upgraded : 1 = 0;
    JSC::Strong<JSNodeHTTPServerSocket> strongThis = {};

    static JSNodeHTTPServerSocket* create(JSC::VM& vm, JSC::Structure* structure, us_socket_t* socket, bool is_ssl, WebCore::JSNodeHTTPResponse* response);
    static JSNodeHTTPServerSocket* create(JSC::VM& vm, Zig::GlobalObject* globalObject, us_socket_t* socket, bool is_ssl, WebCore::JSNodeHTTPResponse* response);

    static void destroy(JSC::JSCell* cell)
    {
        static_cast<JSNodeHTTPServerSocket*>(cell)->JSNodeHTTPServerSocket::~JSNodeHTTPServerSocket();
    }

    template<bool SSL>
    static void clearSocketData(bool upgraded, us_socket_t* socket);

    void close();
    bool isClosed() const;
    bool isAuthorized() const;

    /* SNI hostname the client sent in its ClientHello; null when the socket is
     * not TLS or the client sent no SNI. The pointer is owned by the SSL
     * object — consume it before returning to the event loop. */
    const char* sniServername() const;

    /* X.509 verification error code for the peer certificate (e.g.
     * "DEPTH_ZERO_SELF_SIGNED_CERT"); null when verification succeeded, no TLS,
     * or the connection is already gone. */
    const char* peerCertificateVerificationError() const;

    /* node:http server compat: whether the request currently being received on
     * this connection has exceeded server.headersTimeout / server.requestTimeout
     * (both in milliseconds; 0 disables the respective check). */
    bool isRequestTimedOut(uint64_t headersTimeoutMs, uint64_t requestTimeoutMs) const;

    /* node:http server compat - HTTP/1.1 pipelining. Responses for requests
     * that were parsed while an earlier response on this connection was still
     * in flight are queued here (in arrival order) and become the connection's
     * current response one at a time via startPipelinedResponse(). On socket
     * close every queued response is notified just like the current one. */
    void appendPipelinedResponse(JSC::VM& vm, WebCore::JSNodeHTTPResponse* response);
    /* Make a previously queued pipelined response the connection's current
     * response: reset the per-response uWS state (the part the request handler
     * normally resets per parsed request) and, when the queue drained, resume
     * socket reads. Returns false when the connection is already gone. */
    bool startPipelinedResponse(JSC::VM& vm, WebCore::JSNodeHTTPResponse* response, bool isAncient, bool connectionClose);
    /* Stop parsing further HTTP requests on this connection (Node frees the
     * parser when 'close' is emitted on the socket). */
    void stopHTTPParsing();

    /* node:http socket.end(): when the in-flight response still has bytes in
     * uWS's send buffer, a shutdown now would put the FIN ahead of them and
     * truncate the response. Returns true after handing the close to uWS. */
    bool shutdownAfterResponseDrains();

    /* Switch the connection into CONNECT-style tunnel mode after an accepted
     * Upgrade: subsequent bytes bypass the HTTP parser and stream to the
     * ondata callback as opaque data. With afterBody, the switch is deferred
     * until the request body has been fully parsed (Upgrade requests with a
     * body deliver it through the request first, like Node 26). */
    void upgradeToTunnelMode(bool afterBody = false);

    /* Trailer fields received after the current request's chunked body, as a
     * flat [name, value, ...] JS array preserving wire casing; jsUndefined()
     * when there are none. Clears the captured section. */

    /* Set the trailer fields (pre-rendered "name: value\r\n" lines) to write
     * between the terminating 0 chunk and the final CRLF of the current
     * response's chunked body. */
    void setResponseTrailers(WTF::StringView trailers);

    ~JSNodeHTTPServerSocket();

    JSNodeHTTPServerSocket(JSC::VM& vm, JSC::Structure* structure, us_socket_t* socket, bool is_ssl, WebCore::JSNodeHTTPResponse* response);

    mutable JSC::WriteBarrier<JSC::JSObject> functionToCallOnClose;
    mutable JSC::WriteBarrier<JSC::JSObject> functionToCallOnDrain;
    mutable JSC::WriteBarrier<JSC::JSObject> functionToCallOnData;
    mutable JSC::WriteBarrier<WebCore::JSNodeHTTPResponse> currentResponseObject;
    mutable JSC::WriteBarrier<JSC::JSObject> m_remoteAddress;
    mutable JSC::WriteBarrier<JSC::JSObject> m_localAddress;
    mutable JSC::WriteBarrier<JSC::JSObject> m_duplex;

    /* Queued pipelined responses (see appendPipelinedResponse). The lock keeps
     * mutation on the JS thread coherent with the concurrent GC marker walking
     * the vector in visitChildren. */
    mutable WTF::Lock m_pipelinedResponsesLock;
    mutable WTF::Vector<JSC::WriteBarrier<WebCore::JSNodeHTTPResponse>, 2> m_pipelinedResponses;

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;

        return WebCore::subspaceForImpl<JSNodeHTTPServerSocket, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSNodeHTTPServerSocket.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSNodeHTTPServerSocket = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSNodeHTTPServerSocket.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSNodeHTTPServerSocket = std::forward<decltype(space)>(space); });
    }

    void detach();
    void onClose();
    void onDrain();
    void onData(const char* data, int length, bool last);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);
    void finishCreation(JSC::VM& vm);
};

} // namespace Bun
