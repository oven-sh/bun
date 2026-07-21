#include "JSNodeHTTPServerSocket.h"
#include "JSNodeHTTPServerSocketPrototype.h"
#include "ZigGlobalObject.h"
#include "ZigGeneratedClasses.h"
#include "DOMIsoSubspaces.h"
#include "ScriptExecutionContext.h"
#include "helpers.h"
#include "JSSocketAddressDTO.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <wtf/text/WTFString.h>
#include <bun-uws/src/App.h>

extern "C" void Bun__NodeHTTPResponse_setClosed(void* zigResponse);
extern "C" void Bun__NodeHTTPResponse_markTunneled(void* zigResponse);
extern "C" void Bun__NodeHTTPResponse_onClose(void* zigResponse, JSC::EncodedJSValue jsValue);
extern "C" void us_socket_free_stream_buffer(us_socket_stream_buffer_t* streamBuffer);
extern "C" uint64_t uws_res_get_remote_address_info(void* res, const char** dest, int* port, bool* is_ipv6);
extern "C" uint64_t uws_res_get_local_address_info(void* res, const char** dest, int* port, bool* is_ipv6);
extern "C" EncodedJSValue us_socket_buffered_js_write(void* socket, bool is_ssl, bool ended, us_socket_stream_buffer_t* streamBuffer, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue data, JSC::EncodedJSValue encoding);
extern "C" int us_socket_is_ssl_handshake_finished(struct us_socket_t* s);
extern "C" int us_socket_ssl_handshake_callback_has_fired(struct us_socket_t* s);

namespace Bun {

using namespace JSC;
using namespace WebCore;

const JSC::ClassInfo JSNodeHTTPServerSocket::s_info = { "NodeHTTPServerSocket"_s, &Base::s_info, nullptr, nullptr,
    CREATE_METHOD_TABLE(JSNodeHTTPServerSocket) };

JSNodeHTTPServerSocket* JSNodeHTTPServerSocket::create(JSC::VM& vm, JSC::Structure* structure, us_socket_t* socket, bool is_ssl, WebCore::JSNodeHTTPResponse* response)
{
    if (socket && us_socket_is_closed(socket)) {
        // dont attach closed socket because the callback will never be called
        socket = nullptr;
    }
    auto* object = new (JSC::allocateCell<JSNodeHTTPServerSocket>(vm)) JSNodeHTTPServerSocket(vm, structure, socket, is_ssl, response);
    object->finishCreation(vm);
    return object;
}

JSNodeHTTPServerSocket* JSNodeHTTPServerSocket::create(JSC::VM& vm, Zig::GlobalObject* globalObject, us_socket_t* socket, bool is_ssl, WebCore::JSNodeHTTPResponse* response)
{
    auto* structure = globalObject->m_JSNodeHTTPServerSocketStructure.getInitializedOnMainThread(globalObject);
    return create(vm, structure, socket, is_ssl, response);
}

template<bool SSL>
void JSNodeHTTPServerSocket::clearSocketData(bool upgraded, us_socket_t* socket)
{
    if (upgraded) {
        auto* webSocket = (uWS::WebSocketData*)us_socket_ext(socket);
        webSocket->socketData = nullptr;
    } else {
        auto* httpResponseData = (uWS::HttpResponseData<SSL>*)us_socket_ext(socket);
        httpResponseData->socketData = nullptr;
    }
}

template<bool SSL>
static void flushPartialResponseBeforeClose(us_socket_t* socket)
{
    auto* httpResponseData = reinterpret_cast<uWS::HttpResponseData<SSL>*>(us_socket_ext(socket));
    // Only flush when an in-flight response wrote part of its body but never
    // ended: Node has already handed those res.write() bytes to the kernel by
    // the time destroy() runs, so they reach the client there. Ended
    // responses (including the synthetic terminator written by abort()) keep
    // the old behavior of being discarded with the close.
    if ((httpResponseData->state & uWS::HttpResponseData<SSL>::HTTP_WRITE_CALLED)
        && !(httpResponseData->state & uWS::HttpResponseData<SSL>::HTTP_END_CALLED)) {
        reinterpret_cast<uWS::AsyncSocket<SSL>*>(socket)->uncork();
    }
}

void JSNodeHTTPServerSocket::close()
{
    if (socket) {
        if (!upgraded && !us_socket_is_closed(socket) && !us_socket_is_shut_down(socket)) {
            if (is_ssl) {
                flushPartialResponseBeforeClose<true>(socket);
            } else {
                flushPartialResponseBeforeClose<false>(socket);
            }
        }
        us_socket_close(socket, 0, nullptr);
    }
}

template<bool SSL>
static void upgradeToTunnelModeImpl(us_socket_t* socket, bool afterBody)
{
    auto* httpResponseData = (uWS::HttpResponseData<SSL>*)us_socket_ext(socket);
    if (afterBody) {
        /* The Upgrade request carries a body: keep parsing it as HTTP and only
         * switch into tunnel mode once the message completes (Node 26 delivers
         * the body through the request before raw data starts flowing). */
        httpResponseData->state |= uWS::HttpResponseData<SSL>::HTTP_NODE_TUNNEL_AFTER_BODY;
    } else {
        httpResponseData->isConnectRequest = true;
    }
}

void JSNodeHTTPServerSocket::upgradeToTunnelMode(bool afterBody)
{
    if (!socket || us_socket_is_closed(socket)) {
        return;
    }
    /* Like Node's http server connections (allowHalfOpen: true): the peer
     * finishing its writable side ends the tunnel's readable side without
     * tearing the connection down, so the server can still write and decides
     * itself when to end the socket. */
    socket->flags.allow_half_open = 1;
    /* Reuse the CONNECT plumbing so the parser stops interpreting subsequent
     * bytes as HTTP and routes them to the ondata callback as opaque data. */
    if (is_ssl) {
        upgradeToTunnelModeImpl<true>(socket, afterBody);
    } else {
        upgradeToTunnelModeImpl<false>(socket, afterBody);
    }
    /* The exchange leaves HTTP here: let the response release the server's
     * pending-request accounting (see Flags::TUNNELED in NodeHTTPResponse.rs). */
    if (auto* res = currentResponseObject.get(); res != nullptr && res->m_ctx != nullptr) {
        Bun__NodeHTTPResponse_markTunneled(res->m_ctx);
    }
}

template<bool SSL>
static std::string* requestTrailersFor(us_socket_t* socket)
{
    /* A JSNodeHTTPServerSocket only exists for node:http compat connections,
     * whose ext block is the derived NodeHttpResponseData (HttpContext::onOpen). */
    auto* httpResponseData = (uWS::NodeHttpResponseData<SSL>*)us_socket_ext(socket);
    return &httpResponseData->nodeHttpRequestTrailers;
}

/* Move the connection's captured trailer section out, returning its (ptr, length)
 * through a thread-local buffer that stays valid until the next call on this
 * thread. Called by NodeHTTPResponse at the request's body fin, still inside the
 * parser, so a pipelined request cannot overwrite or inherit another's trailers. */
extern "C" size_t Bun__NodeHTTP__takeRequestTrailerBytes(bool is_ssl, us_socket_t* socket, const char** out)
{
    *out = nullptr;
    if (!socket || us_socket_is_closed(socket)) {
        return 0;
    }
    std::string* trailers = is_ssl ? requestTrailersFor<true>(socket) : requestTrailersFor<false>(socket);
    if (trailers->empty()) {
        return 0;
    }
    static thread_local std::string taken;
    taken = std::move(*trailers);
    trailers->clear();
    *out = taken.data();
    return taken.size();
}

/* Parse a raw trailer section into a flat [name, value, ...] JSArray, or
 * jsUndefined() when it contains no fields. */
extern "C" JSC::EncodedJSValue Bun__NodeHTTP__parseRequestTrailers(JSC::JSGlobalObject* globalObject, const char* data, size_t length, bool useInsecureHTTPParser)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    /* parseTrailerFields post-pads the section in place, so it needs an owned copy. */
    std::string section(data, length);

    /* Parse with the same field-line primitives the request-header parser uses
     * (uWS::HttpParser::consumeFieldName / tryConsumeFieldValue / OWS-trim). */
    std::pair<std::string_view, std::string_view> fields[uWS::HttpParser::MAX_TRAILER_FIELDS];
    unsigned count = uWS::HttpParser::parseTrailerFields(section, fields, useInsecureHTTPParser);
    if (count == 0) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSArray* array = JSC::constructEmptyArray(globalObject, nullptr, count * 2);
    RETURN_IF_EXCEPTION(scope, {});

    unsigned index = 0;
    for (unsigned i = 0; i < count; i++) {
        // HTTP/1.1 obs-text bytes (0x80-0xFF) are valid header content (RFC 9110 §5.5); preserve
        // them 1:1 as Latin-1 like Node's req.rawTrailers (OneByteString) and like NodeHTTP.cpp's
        // rawHeaders construction. UTF-8 decoding would corrupt them to U+FFFD.
        std::span<Latin1Character> nameData;
        auto nameString = WTF::String::createUninitialized(fields[i].first.size(), nameData);
        if (!fields[i].first.empty())
            memcpy(nameData.data(), fields[i].first.data(), fields[i].first.size());
        array->putDirectIndex(globalObject, index++, JSC::jsString(vm, nameString));
        RETURN_IF_EXCEPTION(scope, {});
        std::span<Latin1Character> valueData;
        auto valueString = WTF::String::createUninitialized(fields[i].second.size(), valueData);
        if (!fields[i].second.empty())
            memcpy(valueData.data(), fields[i].second.data(), fields[i].second.size());
        array->putDirectIndex(globalObject, index++, JSC::jsString(vm, valueString));
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSC::JSValue::encode(array);
}

template<bool SSL>
static std::string& responseTrailersFor(us_socket_t* socket)
{
    /* node:http compat connections always carry the derived ext block. */
    auto* httpResponseData = (uWS::NodeHttpResponseData<SSL>*)us_socket_ext(socket);
    return httpResponseData->nodeHttpResponseTrailers;
}

void JSNodeHTTPServerSocket::setResponseTrailers(WTF::StringView trailers)
{
    if (!socket || us_socket_is_closed(socket) || trailers.isEmpty()) {
        return;
    }
    // Node writes trailers with encoding 'latin1' (lib/_http_outgoing.js);
    // checkInvalidHeaderChar has already rejected any code point > 0xFF,
    // so 16-bit chars truncate 1:1 to bytes. UTF-8 would emit two bytes for
    // obs-text (0x80–0xFF) where Node emits one.
    std::string& dest = is_ssl ? responseTrailersFor<true>(socket) : responseTrailersFor<false>(socket);
    dest.resize(trailers.length());
    if (trailers.is8Bit()) {
        auto span = trailers.span8();
        memcpy(dest.data(), span.data(), span.size());
    } else {
        auto span = trailers.span16();
        for (size_t i = 0; i < span.size(); i++)
            dest[i] = static_cast<char>(span[i]);
    }
    /* internalEnd() decides the response framing from this base-struct mirror
     * so the shared path never touches the node-only string. */
    if (is_ssl) {
        ((uWS::HttpResponseData<true>*)us_socket_ext(socket))->setFlag(uWS::HttpResponseData<true>::HTTP_NODE_HAS_RESPONSE_TRAILERS, !dest.empty());
    } else {
        ((uWS::HttpResponseData<false>*)us_socket_ext(socket))->setFlag(uWS::HttpResponseData<false>::HTTP_NODE_HAS_RESPONSE_TRAILERS, !dest.empty());
    }
}

bool JSNodeHTTPServerSocket::isClosed() const
{
    return !socket || us_socket_is_closed(socket);
}

template<bool SSL>
static bool deferShutdownUntilResponseDrains(us_socket_t* socket)
{
    if (reinterpret_cast<uWS::AsyncSocket<SSL>*>(socket)->getBufferedAmount() == 0) {
        return false;
    }
    /* HttpContext<SSL>::onWritable shuts the socket down once the buffered
     * response data has flushed and HTTP_CONNECTION_CLOSE is set, so the FIN
     * is sequenced after the response bytes (like Node's destroySoon). */
    auto* httpResponseData = reinterpret_cast<uWS::HttpResponseData<SSL>*>(us_socket_ext(socket));
    httpResponseData->state |= uWS::HttpResponseData<SSL>::HTTP_CONNECTION_CLOSE;
    return true;
}

bool JSNodeHTTPServerSocket::shutdownAfterResponseDrains()
{
    if (!socket || upgraded || us_socket_is_closed(socket) || us_socket_is_shut_down(socket)) {
        return false;
    }
    if (is_ssl) {
        return deferShutdownUntilResponseDrains<true>(socket);
    }
    return deferShutdownUntilResponseDrains<false>(socket);
}

template<bool SSL>
static bool isRequestTimedOutImpl(us_socket_t* socket, uint64_t headersTimeoutMs, uint64_t requestTimeoutMs)
{
    /* node:http compat connections always carry the derived ext block. */
    auto* httpResponseData = reinterpret_cast<uWS::NodeHttpResponseData<SSL>*>(us_socket_ext(socket));
    if (httpResponseData->isConnectRequest) {
        // CONNECT/Upgrade tunnels are detached from the HTTP request machinery,
        // like Node freeing the parser for upgraded connections.
        return false;
    }
    uint64_t start = httpResponseData->lastMessageStartMs;
    if (start == 0) {
        // Idle: no request message is currently being received.
        return false;
    }
    uint64_t now = uWS::nodeCompatMonotonicMs();
    uint64_t elapsed = now > start ? now - start : 0;
    if (headersTimeoutMs > 0 && !httpResponseData->headersCompleted && elapsed > headersTimeoutMs) {
        return true;
    }
    return requestTimeoutMs > 0 && elapsed > requestTimeoutMs;
}

bool JSNodeHTTPServerSocket::isRequestTimedOut(uint64_t headersTimeoutMs, uint64_t requestTimeoutMs) const
{
    if (!socket || upgraded || us_socket_is_closed(socket)) {
        return false;
    }
    if (is_ssl) {
        return isRequestTimedOutImpl<true>(socket, headersTimeoutMs, requestTimeoutMs);
    }
    return isRequestTimedOutImpl<false>(socket, headersTimeoutMs, requestTimeoutMs);
}

bool JSNodeHTTPServerSocket::isAuthorized() const
{
    // is secure means that tls was established successfully
    if (!is_ssl || !socket)
        return false;

    // Check if the handshake callback has fired. If so, use the isAuthorized flag
    // which reflects the actual certificate verification result.
    if (us_socket_ssl_handshake_callback_has_fired(socket)) {
        auto* httpResponseData = reinterpret_cast<uWS::HttpResponseData<true>*>(us_socket_ext(socket));
        if (!httpResponseData)
            return false;
        return httpResponseData->isAuthorized;
    }

    // The handshake callback hasn't fired yet, but we're in an HTTP handler,
    // which means we received HTTP data. Check if the TLS handshake has actually
    // completed using OpenSSL's state (SSL_is_init_finished).
    //
    // If the handshake is complete but the callback hasn't fired, we're in a race
    // condition. The callback will fire shortly and either:
    // 1. Set isAuthorized = true (success)
    // 2. Close the socket (if rejectUnauthorized and verification failed)
    //
    // Since we're in an HTTP handler and the socket isn't closed, we can safely
    // assume the handshake will succeed. If it fails, the socket will be closed
    // and subsequent operations will fail appropriately.
    return us_socket_is_ssl_handshake_finished(socket);
}

const char* JSNodeHTTPServerSocket::sniServername() const
{
    if (!is_ssl || !socket) {
        return nullptr;
    }
    return us_socket_sni_servername(socket);
}

const char* JSNodeHTTPServerSocket::peerCertificateVerificationError() const
{
    if (!is_ssl || !socket) {
        return nullptr;
    }
    return us_socket_verify_error(socket).code;
}

JSNodeHTTPServerSocket::~JSNodeHTTPServerSocket()
{
    if (socket) {
        if (is_ssl) {
            clearSocketData<true>(this->upgraded, socket);
        } else {
            clearSocketData<false>(this->upgraded, socket);
        }
    }
    us_socket_free_stream_buffer(&streamBuffer);
}

JSNodeHTTPServerSocket::JSNodeHTTPServerSocket(JSC::VM& vm, JSC::Structure* structure, us_socket_t* socket, bool is_ssl, WebCore::JSNodeHTTPResponse* response)
    : JSC::JSDestructibleObject(vm, structure)
    , socket(socket)
    , is_ssl(is_ssl)
    , currentResponseObject(response, JSC::WriteBarrierEarlyInit)
{
}

void JSNodeHTTPServerSocket::detach()
{
    this->m_duplex.clear();
    this->currentResponseObject.clear();
    {
        Locker locker { m_pipelinedResponsesLock };
        this->m_pipelinedResponses.clear();
    }
    this->strongThis.clear();
}

void JSNodeHTTPServerSocket::appendPipelinedResponse(JSC::VM& vm, WebCore::JSNodeHTTPResponse* response)
{
    Locker locker { m_pipelinedResponsesLock };
    m_pipelinedResponses.append(JSC::WriteBarrier<WebCore::JSNodeHTTPResponse> {});
    m_pipelinedResponses.last().set(vm, this, response);
}

template<bool SSL>
static bool startPipelinedResponseImpl(us_socket_t* socket, bool isAncient, bool connectionClose, bool hasMoreQueued)
{
    /* node:http compat connections always carry the derived ext block. */
    auto* httpResponseData = reinterpret_cast<uWS::NodeHttpResponseData<SSL>*>(us_socket_ext(socket));

    // The previous response on this connection has finished; this queued
    // response now owns the per-response state the request handler normally
    // resets per parsed request.
    httpResponseData->offset = 0;
    // Clears the finished response's framing bits and keeps the connection-scoped
    // ones (notably HTTP_NODE_READS_PAUSED, read again below).
    httpResponseData->resetResponseState();
    if (connectionClose) {
        httpResponseData->state |= uWS::HttpResponseData<SSL>::HTTP_CONNECTION_CLOSE;
    }
    if (isAncient) {
        httpResponseData->state |= uWS::HttpResponseData<SSL>::HTTP_ANCIENT_REQUEST;
    }
    httpResponseData->nodeHttpResponseTrailers.clear();

    if (httpResponseData->nodeHttpQueuedPipelinedCount > 0) {
        httpResponseData->nodeHttpQueuedPipelinedCount--;
    }
    if (!hasMoreQueued && httpResponseData->nodeHttpQueuedPipelinedCount == 0
        && (httpResponseData->state & uWS::HttpResponseData<SSL>::HTTP_NODE_READS_PAUSED)) {
        // The pipeline backlog drained. Resume reading new requests only once
        // the socket has no outgoing backpressure left (Node's flood
        // prevention keeps the socket paused while responses back up);
        // otherwise HttpContext::onWritable resumes after the drain.
        if (reinterpret_cast<uWS::AsyncSocket<SSL>*>(socket)->getBufferedAmount() == 0) {
            httpResponseData->state &= ~uWS::HttpResponseData<SSL>::HTTP_NODE_READS_PAUSED;
            reinterpret_cast<uWS::HttpResponse<SSL>*>(socket)->resume();
        }
    }
    return true;
}

bool JSNodeHTTPServerSocket::startPipelinedResponse(JSC::VM& vm, WebCore::JSNodeHTTPResponse* response, bool isAncient, bool connectionClose)
{
    if (!socket || upgraded || us_socket_is_closed(socket)) {
        return false;
    }

    bool hasMoreQueued = false;
    {
        Locker locker { m_pipelinedResponsesLock };
        m_pipelinedResponses.removeFirstMatching([&](auto& entry) { return entry.get() == response; });
        hasMoreQueued = !m_pipelinedResponses.isEmpty();
    }

    bool ok;
    if (is_ssl) {
        ok = startPipelinedResponseImpl<true>(socket, isAncient, connectionClose, hasMoreQueued);
    } else {
        ok = startPipelinedResponseImpl<false>(socket, isAncient, connectionClose, hasMoreQueued);
    }
    if (ok) {
        currentResponseObject.set(vm, this, response);
    }
    return ok;
}

void JSNodeHTTPServerSocket::stopHTTPParsing()
{
    if (!socket || upgraded || us_socket_is_closed(socket)) {
        return;
    }
    if (is_ssl) {
        reinterpret_cast<uWS::HttpResponseData<true>*>(us_socket_ext(socket))->state |= uWS::HttpResponseData<true>::HTTP_NODE_PARSING_STOPPED;
    } else {
        reinterpret_cast<uWS::HttpResponseData<false>*>(us_socket_ext(socket))->state |= uWS::HttpResponseData<false>::HTTP_NODE_PARSING_STOPPED;
    }
}

// Notify the current response and every queued pipelined response that the
// connection is gone. Called from the close paths below; takes the queued
// list so a re-entrant close cannot deliver the notification twice.
static void notifyResponsesOnClose(JSNodeHTTPServerSocket* socket)
{
    if (auto* res = socket->currentResponseObject.get(); res != nullptr && res->m_ctx != nullptr) {
        Bun__NodeHTTPResponse_onClose(res->m_ctx, JSValue::encode(res));
    }
    // Root every queued response across the onClose calls below: clearing
    // m_pipelinedResponses removes the only GC-visited slot, and a Vector that
    // spilled past its inline capacity sits on the heap where the conservative
    // stack scan does not see it. The raw-pointer list is iterated; the
    // MarkedArgumentBuffer is purely for GC visibility.
    JSC::MarkedArgumentBuffer roots;
    WTF::Vector<WebCore::JSNodeHTTPResponse*, 2> pipelined;
    {
        Locker locker { socket->m_pipelinedResponsesLock };
        for (auto& entry : socket->m_pipelinedResponses) {
            if (auto* res = entry.get()) {
                roots.appendWithCrashOnOverflow(res);
                pipelined.append(res);
            }
        }
        socket->m_pipelinedResponses.clear();
    }
    for (auto* res : pipelined) {
        if (res->m_ctx != nullptr) {
            Bun__NodeHTTPResponse_onClose(res->m_ctx, JSValue::encode(res));
        }
    }
}

void JSNodeHTTPServerSocket::onClose()
{
    this->socket = nullptr;
    if (auto* res = this->currentResponseObject.get(); res != nullptr && res->m_ctx != nullptr) {
        Bun__NodeHTTPResponse_setClosed(res->m_ctx);
    }
    {
        Locker locker { m_pipelinedResponsesLock };
        for (auto& entry : m_pipelinedResponses) {
            if (auto* res = entry.get(); res != nullptr && res->m_ctx != nullptr) {
                Bun__NodeHTTPResponse_setClosed(res->m_ctx);
            }
        }
    }

    // This function can be called during GC!
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(this->globalObject());
    if (!functionToCallOnClose) {
        notifyResponsesOnClose(this);
        this->detach();
        return;
    }

    WebCore::ScriptExecutionContext* scriptExecutionContext = globalObject->scriptExecutionContext();

    if (!scriptExecutionContext || globalObject->isShuttingDown()) {
        notifyResponsesOnClose(this);
        this->detach();
        return;
    }

    scriptExecutionContext->postTask([self = this](ScriptExecutionContext& context) {
        WTF::NakedPtr<JSC::Exception> exception;
        auto* globalObject = defaultGlobalObject(context.globalObject());
        auto* thisObject = self;
        auto* callbackObject = thisObject->functionToCallOnClose.get();
        if (!callbackObject) {
            notifyResponsesOnClose(thisObject);
            thisObject->detach();
            return;
        }
        auto callData = JSC::getCallData(callbackObject);
        MarkedArgumentBuffer args;
        EnsureStillAliveScope ensureStillAlive(self);

        if (globalObject->scriptExecutionStatus(globalObject, thisObject) == ScriptExecutionStatus::Running) {
            notifyResponsesOnClose(thisObject);

            profiledCall(globalObject, JSC::ProfilingReason::API, callbackObject, callData, thisObject, args, exception);

            if (auto* ptr = exception.get()) {
                exception.clear();
                globalObject->reportUncaughtExceptionAtEventLoop(globalObject, ptr);
            }
        }
        thisObject->detach();
    });
}

void JSNodeHTTPServerSocket::onDrain()
{
    // This function can be called during GC!
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(this->globalObject());

    // A socket.end() that was deferred while AsyncSocketData::buffer still
    // held bytes sends its FIN now that the buffer is empty, even when no JS
    // drain callback is armed.
    if (this->ended && this->socket && !us_socket_is_shut_down(this->socket)) {
        us_socket_buffered_js_write(this->socket, this->is_ssl, this->ended, &this->streamBuffer, globalObject, JSValue::encode(JSC::jsUndefined()), JSValue::encode(JSC::jsUndefined()));
    }

    if (!functionToCallOnDrain) {
        return;
    }
    WebCore::ScriptExecutionContext* scriptExecutionContext = globalObject->scriptExecutionContext();

    if (scriptExecutionContext) {
        scriptExecutionContext->postTask([self = this](ScriptExecutionContext& context) {
            WTF::NakedPtr<JSC::Exception> exception;
            auto* globalObject = defaultGlobalObject(context.globalObject());
            auto* thisObject = self;
            auto* callbackObject = thisObject->functionToCallOnDrain.get();
            if (!callbackObject) {
                return;
            }
            auto callData = JSC::getCallData(callbackObject);
            MarkedArgumentBuffer args;
            EnsureStillAliveScope ensureStillAlive(self);

            if (globalObject->scriptExecutionStatus(globalObject, thisObject) == ScriptExecutionStatus::Running) {
                profiledCall(globalObject, JSC::ProfilingReason::API, callbackObject, callData, thisObject, args, exception);

                if (auto* ptr = exception.get()) {
                    exception.clear();
                    globalObject->reportUncaughtExceptionAtEventLoop(globalObject, ptr);
                }
            }
        });
    }
}

void JSNodeHTTPServerSocket::onData(const char* data, int length, bool last)
{
    // This function can be called during GC!
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(this->globalObject());
    if (!functionToCallOnData) {
        return;
    }

    WebCore::ScriptExecutionContext* scriptExecutionContext = globalObject->scriptExecutionContext();

    if (scriptExecutionContext) {
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm());
        JSC::JSUint8Array* buffer = WebCore::createBuffer(globalObject, std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(data), length));
        auto chunk = JSC::JSValue(buffer);
        if (auto* exception = scope.exception()) {
            (void)scope.tryClearException();
            globalObject->reportUncaughtExceptionAtEventLoop(globalObject, exception);
            return;
        }
        gcProtect(chunk);
        scriptExecutionContext->postTask([self = this, chunk = chunk, last = last](ScriptExecutionContext& context) {
            WTF::NakedPtr<JSC::Exception> exception;
            auto* globalObject = defaultGlobalObject(context.globalObject());
            auto* thisObject = self;
            auto* callbackObject = thisObject->functionToCallOnData.get();
            EnsureStillAliveScope ensureChunkStillAlive(chunk);
            gcUnprotect(chunk);
            if (!callbackObject) {
                return;
            }

            auto callData = JSC::getCallData(callbackObject);
            MarkedArgumentBuffer args;
            args.append(chunk);
            args.append(JSC::jsBoolean(last));
            EnsureStillAliveScope ensureStillAlive(self);

            if (globalObject->scriptExecutionStatus(globalObject, thisObject) == ScriptExecutionStatus::Running) {
                profiledCall(globalObject, JSC::ProfilingReason::API, callbackObject, callData, thisObject, args, exception);

                if (auto* ptr = exception.get()) {
                    exception.clear();
                    globalObject->reportUncaughtExceptionAtEventLoop(globalObject, ptr);
                }
            }
        });
    }
}

JSC::Structure* JSNodeHTTPServerSocket::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    auto* structure = JSC::Structure::create(vm, globalObject, globalObject->objectPrototype(), JSC::TypeInfo(JSC::ObjectType, StructureFlags), JSNodeHTTPServerSocketPrototype::info());
    auto* prototype = JSNodeHTTPServerSocketPrototype::create(vm, structure);
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
}

void JSNodeHTTPServerSocket::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
}

template<typename Visitor>
void JSNodeHTTPServerSocket::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSNodeHTTPServerSocket* fn = uncheckedDowncast<JSNodeHTTPServerSocket>(cell);
    ASSERT_GC_OBJECT_INHERITS(fn, info());
    Base::visitChildren(fn, visitor);

    visitor.append(fn->currentResponseObject);
    visitor.append(fn->functionToCallOnClose);
    visitor.append(fn->functionToCallOnDrain);
    visitor.append(fn->functionToCallOnData);
    visitor.append(fn->m_remoteAddress);
    visitor.append(fn->m_localAddress);
    visitor.append(fn->m_duplex);
    {
        Locker locker { fn->m_pipelinedResponsesLock };
        for (auto& entry : fn->m_pipelinedResponses) {
            visitor.append(entry);
        }
    }
}

DEFINE_VISIT_CHILDREN(JSNodeHTTPServerSocket);

template<bool SSL>
static JSNodeHTTPServerSocket* getNodeHTTPServerSocket(us_socket_t* socket)
{
    auto* httpResponseData = (uWS::HttpResponseData<SSL>*)us_socket_ext(socket);
    return reinterpret_cast<JSNodeHTTPServerSocket*>(httpResponseData->socketData);
}

template<bool SSL>
static WebCore::JSNodeHTTPResponse* getNodeHTTPResponse(us_socket_t* socket)
{
    auto* serverSocket = getNodeHTTPServerSocket<SSL>(socket);
    if (!serverSocket) {
        return nullptr;
    }
    return serverSocket->currentResponseObject.get();
}

extern "C" JSC::EncodedJSValue Bun__getNodeHTTPResponseThisValue(bool is_ssl, us_socket_t* socket)
{
    if (is_ssl) {
        return JSValue::encode(getNodeHTTPResponse<true>(socket));
    }
    return JSValue::encode(getNodeHTTPResponse<false>(socket));
}

extern "C" JSC::EncodedJSValue Bun__getNodeHTTPServerSocketThisValue(bool is_ssl, us_socket_t* socket)
{
    if (is_ssl) {
        return JSValue::encode(getNodeHTTPServerSocket<true>(socket));
    }
    return JSValue::encode(getNodeHTTPServerSocket<false>(socket));
}

// Returns the JSNodeHTTPServerSocket already attached to this raw socket, or
// creates (and attaches) one. Used for connections that have not produced a
// parsed request yet: the 'clientError' path and the connection-accept path.
extern "C" JSC::EncodedJSValue Bun__getOrCreateNodeHTTPServerSocket(bool isSSL, us_socket_t* us_socket, Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    RETURN_IF_EXCEPTION(scope, {});

    if (isSSL) {
        uWS::HttpResponse<true>* response = reinterpret_cast<uWS::HttpResponse<true>*>(us_socket);
        auto* currentSocketDataPtr = reinterpret_cast<JSC::JSCell*>(response->getHttpResponseData()->socketData);
        if (currentSocketDataPtr) {
            return JSValue::encode(currentSocketDataPtr);
        }
    } else {
        uWS::HttpResponse<false>* response = reinterpret_cast<uWS::HttpResponse<false>*>(us_socket);
        auto* currentSocketDataPtr = reinterpret_cast<JSC::JSCell*>(response->getHttpResponseData()->socketData);
        if (currentSocketDataPtr) {
            return JSValue::encode(currentSocketDataPtr);
        }
    }
    // socket without response because is not valid http
    JSNodeHTTPServerSocket* socket = JSNodeHTTPServerSocket::create(
        vm,
        globalObject->m_JSNodeHTTPServerSocketStructure.getInitializedOnMainThread(globalObject),
        us_socket,
        isSSL, nullptr);
    if (isSSL) {
        uWS::HttpResponse<true>* response = reinterpret_cast<uWS::HttpResponse<true>*>(us_socket);
        response->getHttpResponseData()->socketData = socket;
    } else {
        uWS::HttpResponse<false>* response = reinterpret_cast<uWS::HttpResponse<false>*>(us_socket);
        response->getHttpResponseData()->socketData = socket;
    }
    RETURN_IF_EXCEPTION(scope, {});
    if (socket) {
        socket->strongThis.set(vm, socket);
        return JSValue::encode(socket);
    }

    return JSValue::encode(JSC::jsNull());
}

JSC::Structure* createNodeHTTPServerSocketStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return JSNodeHTTPServerSocket::createStructure(vm, globalObject);
}

} // namespace Bun
