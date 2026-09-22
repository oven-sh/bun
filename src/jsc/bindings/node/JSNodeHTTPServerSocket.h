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

    size_t bufferedSize() const
    {
        return listLen - cursor;
    }
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
    unsigned peer_cert_verified : 1 = 0;
    /* The JS Duplex of a tunnel is full: readStop() to readStart(). */
    unsigned tunnelReadsStopped : 1 = 0;
    /* queuedTunnelBytes reached one recv buffer, until JS has those bytes. */
    unsigned tunnelReadsQueuedFull : 1 = 0;
    /* onData() got the end of the stream. The task that tells JS can still be queued. */
    unsigned tunnelReadEnded : 1 = 0;
    /* write() returned false for bytes that went into the uWS buffer, and JS waits for ondrain. streamBuffer does not show them. */
    unsigned heldWriteAwaitsDrain : 1 = 0;
    /* Tunnel bytes that onData() queued for JS in tasks that have not run yet. */
    size_t queuedTunnelBytes = 0;
    const char* peerCertVerifyErrorCode = nullptr;
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
     * "DEPTH_ZERO_SELF_SIGNED_CERT"), latched from the TLS handshake; null when
     * verification succeeded or the socket is not TLS. */
    const char* peerCertificateVerificationError();
    bool isPeerCertificateVerified();

    /* node:http server compat: whether the request currently being received on
     * this connection has exceeded server.headersTimeout / server.requestTimeout
     * (ms; 0 disables a check). Reports a given message at most once. */
    bool isRequestTimedOut(uint64_t headersTimeoutMs, uint64_t requestTimeoutMs);

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

    /* socket.end(): true when uWS will shut down later, after the buffered response. destroySoon also waits for the body parse and closes behind the FIN. */
    bool shutdownAfterResponseDrains(bool destroySoon);

    /* Close once the bytes of the responses that ended have left. close() discards them, end() waits for the peer. */
    void closeWhenDrained();
    /* Closes the connection if uWS counts it as idle (HttpResponse::closeIfIdle). Returns whether it closed it. */
    bool closeIfIdle();

    /* Switch the connection into CONNECT-style tunnel mode after an accepted
     * Upgrade: subsequent bytes bypass the HTTP parser and stream to the
     * ondata callback as opaque data. With afterBody, the switch is deferred
     * until the request body has been fully parsed (Upgrade requests with a
     * body deliver it through the request first, like Node 26). */
    void upgradeToTunnelMode(bool afterBody, WebCore::JSNodeHTTPResponse* response);

    /* Tunnel read backpressure, like net.Socket's handle. Both do nothing outside tunnel mode. */
    void readStop();
    void readStart();
    bool tunnelReadsPaused() const { return tunnelReadsStopped || tunnelReadsQueuedFull; }
    /* Tells uWS whether this tunnel is idle: at read EOF with nothing left to send. See HttpResponse::setNodeHttpTunnelIdle. */
    void updateTunnelIdle();
    /* uWS still holds bytes of an HTTP response on this connection. A raw write has to go through the same buffer, or it reaches the wire first. */
    bool hasUnsentResponseBytes() const;
    /* The zero-copy tail of a res.write() waits outside the uWS buffer. It moves there, so that a raw write or a FIN goes out behind it. */
    void spillResponseTail();
    /* Only a tunnel gets the drain call that flushes streamBuffer. On any other socket the uWS buffer takes what the kernel does not. */
    bool flushesStreamBufferOnDrain() const { return !!functionToCallOnDrain; }
    /* The WebSocket that adopted the connection reads from here on. */
    void releaseTunnelReadsForUpgrade();

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

        return WebCore::subspaceForImpl<JSNodeHTTPServerSocket, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSNodeHTTPServerSocket, m_subspaceForJSNodeHTTPServerSocket));
    }

    void detach();
    void reset();
    void syncPeerCertificateVerification();
    void onClose(int readError, bool peerEnded);
    void onDrain();
    void onData(const char* data, int length, bool last);
    void applyTunnelReads();
    void didDeliverQueuedTunnelBytes(size_t length);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);
    void finishCreation(JSC::VM& vm);
};

} // namespace Bun
