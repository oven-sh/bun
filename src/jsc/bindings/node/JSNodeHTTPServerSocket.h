#pragma once

#include "root.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSObject.h>
#include "BunClientData.h"
#include "GeneratedNodeHTTPResponse.h"
#include <wtf/Lock.h>
#include <wtf/Vector.h>
#include <wtf/text/StringView.h>

extern "C" {
struct us_socket_t;
struct us_bun_verify_error_t;

void Bun__NodeHTTPResponse_takeBackConnection(void* zigResponse, JSC::EncodedJSValue jsValue);
}

namespace uWS {
template<bool SSL, bool IsNodeHttp>
struct HttpResponseData;
}

namespace Bun {

using Bindgen::Generated::JSNodeHTTPResponse;

class JSNodeHTTPServerSocketPrototype;

class JSNodeHTTPServerSocket : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    us_socket_t* socket = nullptr;
    unsigned is_ssl : 1 = 0;
    /* socket.end() was called. Later writes are dropped. */
    unsigned ended : 1 = 0;
    /* Set by onClose() for the peerEnded / closeError getters: the peer's FIN, the error of a failed read. */
    unsigned peer_ended : 1 = 0;
    int closeReadError = 0;
    /* req.socket._handle, a NewSocket<SSL> in src/runtime/socket/node_http_socket.rs. This holds the connection's ref on it. */
    void* m_socketHandle = nullptr;
    JSC::Strong<JSNodeHTTPServerSocket> strongThis = {};

    static JSNodeHTTPServerSocket* create(JSC::VM& vm, JSC::Structure* structure, us_socket_t* socket, bool is_ssl, JSNodeHTTPResponse* response);
    static JSNodeHTTPServerSocket* create(JSC::VM& vm, Zig::GlobalObject* globalObject, us_socket_t* socket, bool is_ssl, JSNodeHTTPResponse* response);

    static void destroy(JSC::JSCell* cell)
    {
        static_cast<JSNodeHTTPServerSocket*>(cell)->JSNodeHTTPServerSocket::~JSNodeHTTPServerSocket();
    }

    void close();
    bool isClosed() const;

    /* node:http server compat: whether the request currently being received on
     * this connection has exceeded server.headersTimeout / server.requestTimeout
     * (ms; 0 disables a check). Reports a given message at most once. */
    bool isRequestTimedOut(uint64_t headersTimeoutMs, uint64_t requestTimeoutMs);

    /* node:http server compat - HTTP/1.1 pipelining. Responses for requests
     * that were parsed while an earlier response on this connection was still
     * in flight are queued here (in arrival order) and become the connection's
     * current response one at a time via startRawResponse(). On socket
     * close every queued response is notified just like the current one. */
    void appendPipelinedResponse(JSC::VM& vm, JSNodeHTTPResponse* response);
    /* Makes a queued response the connection's current one, and resets the per-response state of uWS. JavaScript renders it and writes it with socket.write(), so its end() writes nothing: it only completes the response. Returns false if the connection is gone or didn't queue it. */
    bool startRawResponse(JSC::VM& vm, JSNodeHTTPResponse* response, bool connectionClose);
    /* The response that answers on this connection now. A close reaches it and the queued ones. */
    JSNodeHTTPResponse* currentResponse() const { return m_currentResponse.get(); }
    /* A close does not reach the response that leaves the slot, so the connection is taken back from it first. */
    void setCurrentResponse(JSC::VM& vm, JSNodeHTTPResponse* response)
    {
        if (auto* replaced = m_currentResponse.get(); replaced != nullptr && replaced != response) {
            Bun__NodeHTTPResponse_takeBackConnection(replaced->wrapped(), JSC::JSValue::encode(replaced));
        }
        m_currentResponse.set(vm, this, response);
    }
    /* Stop parsing further HTTP requests on this connection (Node frees the
     * parser when 'close' is emitted on the socket). */
    void stopHTTPParsing();
    /* 'connect' or 'upgrade' has the socket, and responses ahead of that request are still owed: every read goes to the socket's handle, and only its own pause holds the reads. */
    void detachParser();

    /* socket.end(): true when uWS will shut down later, after the buffered response. */
    bool shutdownAfterResponseDrains();
    /* socket.end() with nothing left to send: the FIN goes out now and the reads stay armed, so that the peer's FIN closes the socket. */
    void halfClose();
    /* The FIN of socket.end() has left. It waits for bytes that are still queued. */
    bool finSent() const;

    /* Closes the connection if uWS counts it as idle (HttpResponse::closeIfIdle). Returns whether it closed it. */
    bool closeIfIdle();

    /* An accepted Upgrade request has a body. It's parsed and delivered through the request, and the connection leaves HTTP behind its last chunk. */
    void leaveHttpAfterBody();

    /* The socket's handle gets the bytes of every read before the HTTP parser does (Node's parser.unconsume()). */
    void setRawReads(bool enabled);
    void onRawRead(const char* data, int length);
    void onReadParsed();
    bool onPeerEnded();
    /* Node's parser.finish(), for the socket's 'end' listener. Returns whether the stream ended inside a message. */
    bool finishParsing();
    void onUpgradeBodyEnded();
    void onHandshake(int success, us_bun_verify_error_t verifyError);
    /* Hands the connection to the socket handle for good, for the request of the current response. Returns false if it's closed. */
    bool leaveHttp(bool restOfReadTaken);
    /* The handle's 'close', after the HTTP side has heard of it. */
    void closeSocketHandle(bool runScript);
    void halfCloseAfterDrain();
    /* The reads or the unsent bytes changed: tells the response in flight, whose request can be parked (NodeHTTPResponse::update_parked). */
    void updateParked();
    /* Sends the response bytes that are not in the uWS buffer (the zero-copy tail of a res.write(), the cork buffer) to the kernel or into it. A raw write or a FIN then goes out behind them. */
    void flushResponseBytesAhead();
    /* Set the trailer fields (pre-rendered "name: value\r\n" lines) to write
     * between the terminating 0 chunk and the final CRLF of the current
     * response's chunked body. */
    void setResponseTrailers(WTF::StringView trailers);

    ~JSNodeHTTPServerSocket();

    JSNodeHTTPServerSocket(JSC::VM& vm, JSC::Structure* structure, us_socket_t* socket, bool is_ssl, JSNodeHTTPResponse* response);

    mutable JSC::WriteBarrier<JSC::JSObject> functionToCallOnClose;
    mutable JSC::WriteBarrier<JSC::JSObject> m_duplex;

    /* Queued pipelined responses (see appendPipelinedResponse). The lock keeps
     * mutation on the JS thread coherent with the concurrent GC marker walking
     * the vector in visitChildren. */
    mutable WTF::Lock m_pipelinedResponsesLock;
    mutable WTF::Vector<JSC::WriteBarrier<JSNodeHTTPResponse>, 2> m_pipelinedResponses;

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
    void onClose(int readError, bool peerEnded);
    void onDrain();

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);
    void finishCreation(JSC::VM& vm);

private:
    mutable JSC::WriteBarrier<JSNodeHTTPResponse> m_currentResponse;
};

} // namespace Bun
