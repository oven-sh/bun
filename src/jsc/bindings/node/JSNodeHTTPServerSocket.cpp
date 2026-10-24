#include "JSNodeHTTPServerSocket.h"
#include "JSNodeHTTPServerSocketPrototype.h"
#include "AsyncContextFrame.h"
#include "ZigGlobalObject.h"
#include "DOMIsoSubspaces.h"
#include "ScriptExecutionContext.h"
#include "helpers.h"
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <wtf/text/WTFString.h>
#include <bun-uws/src/App.h>

extern "C" void Bun__NodeHTTPResponse_setClosed(void* zigResponse);
extern "C" void Bun__NodeHTTPResponse_grantConnection(void* zigResponse);
extern "C" void Bun__NodeHTTPResponse_onReadParsed(void* zigResponse);
extern "C" void Bun__NodeHTTPResponse_spillPendingWrite(void* zigResponse);
extern "C" size_t Bun__NodeHTTPResponse_bytesWritten(void* zigResponse);
extern "C" uint64_t Bun__NodeHTTPResponse_bufferedAmount(void* zigResponse);
extern "C" void Bun__NodeHTTPResponse_updateParked(void* zigResponse);
extern "C" void Bun__NodeHTTPResponse_onClose(void* zigResponse, JSC::EncodedJSValue jsValue);
extern "C" void Bun__EventLoop__enter(Zig::GlobalObject*);
extern "C" void Bun__EventLoop__exit(Zig::GlobalObject*);
extern "C" void* Bun__NodeHTTPSocket__create(const void* handlers, us_socket_t* socket, bool ssl, bool rejectUnauthorized);
extern "C" void Bun__NodeHTTPSocket__onOpen(void* handle, bool ssl);
extern "C" void Bun__NodeHTTPSocket__onHandshake(void* handle, int success, us_bun_verify_error_t verifyError);
extern "C" void Bun__NodeHTTPSocket__onData(void* handle, bool ssl, const char* data, size_t length);
extern "C" void Bun__NodeHTTPSocket__onEnd(void* handle, bool ssl);
extern "C" void Bun__NodeHTTPSocket__onWritable(void* handle, bool ssl);
extern "C" void Bun__NodeHTTPSocket__forgetConnection(void* handle, bool ssl);
extern "C" void Bun__NodeHTTPSocket__forgetWebSocket(void* handle, bool ssl, bool sentEverything);
extern "C" void Bun__NodeHTTPSocket__onClose(void* handle, bool ssl, int readError, bool runScript);
extern "C" void Bun__NodeHTTPSocket__leaveHttp(void* handle, bool ssl, us_socket_t* socket, const char* unsent, size_t unsentLength, bool readsPaused, uint64_t bytesRead, uint64_t responseBytesWritten);
extern "C" Zig::GlobalObject* Bun__NodeHTTPSocket__globalObject(void* handle, bool ssl);

namespace Bun {

using namespace JSC;
using namespace WebCore;

// Calls onclose in the context of the Bun.ModuleGraph whose script set it, if one did, and reports what it throws.
static void callStoredCallback(Zig::GlobalObject* globalObject, JSObject* callback, JSValue thisValue, const ArgList& args)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm());
    AsyncContextFrame::call(globalObject, callback, thisValue, args);
    if (auto* exception = scope.exception()) {
        (void)scope.tryClearException();
        globalObject->reportUncaughtExceptionAtEventLoop(globalObject, exception);
    }
}

const JSC::ClassInfo JSNodeHTTPServerSocket::s_info = { "NodeHTTPServerSocket"_s, &Base::s_info, nullptr, nullptr,
    CREATE_METHOD_TABLE(JSNodeHTTPServerSocket) };

JSNodeHTTPServerSocket* JSNodeHTTPServerSocket::create(JSC::VM& vm, JSC::Structure* structure, us_socket_t* socket, bool is_ssl, JSNodeHTTPResponse* response)
{
    if (socket && us_socket_is_closed(socket)) {
        // dont attach closed socket because the callback will never be called
        socket = nullptr;
    }
    auto* object = new (JSC::allocateCell<JSNodeHTTPServerSocket>(vm)) JSNodeHTTPServerSocket(vm, structure, socket, is_ssl, response);
    object->finishCreation(vm);
    return object;
}

JSNodeHTTPServerSocket* JSNodeHTTPServerSocket::create(JSC::VM& vm, Zig::GlobalObject* globalObject, us_socket_t* socket, bool is_ssl, JSNodeHTTPResponse* response)
{
    auto* structure = globalObject->m_JSNodeHTTPServerSocketStructure.getInitializedOnMainThread(globalObject);
    return create(vm, structure, socket, is_ssl, response);
}

template<bool SSL>
static void flushPartialResponseBeforeClose(us_socket_t* socket)
{
    auto* httpResponseData = reinterpret_cast<uWS::HttpResponseData<SSL>*>(us_socket_ext(socket));
    // Only flush when an in-flight response wrote part of its body but never
    // ended: Node has already handed those res.write() bytes to the kernel by
    // the time destroy() runs, so they reach the client there. Ended
    // responses keep the old behavior of being discarded with the close.
    if ((httpResponseData->state & uWS::HttpResponseData<SSL>::HTTP_WRITE_CALLED)
        && !(httpResponseData->state & uWS::HttpResponseData<SSL>::HTTP_END_CALLED)) {
        reinterpret_cast<uWS::AsyncSocket<SSL>*>(socket)->uncork();
    }
}

void JSNodeHTTPServerSocket::close()
{
    if (socket) {
        if (!us_socket_is_closed(socket) && !us_socket_is_shut_down(socket)) {
            if (is_ssl) {
                flushPartialResponseBeforeClose<true>(socket);
            } else {
                flushPartialResponseBeforeClose<false>(socket);
            }
        }
        // uws is parsing this socket: it delivers the rest of the read, then closes (HTTP_NODE_CLOSE_AFTER_MESSAGE).
        if (!us_socket_is_closed(socket)) {
            bool deferred = is_ssl
                ? reinterpret_cast<uWS::HttpResponse<true>*>(socket)->closeAfterMessageIfParsing()
                : reinterpret_cast<uWS::HttpResponse<false>*>(socket)->closeAfterMessageIfParsing();
            if (deferred) {
                return;
            }
        }
        // Forceful: code 0 defers the fd close until a close_notify reply that a half-open peer never sends.
        us_socket_close(socket, LIBUS_SOCKET_CLOSE_CODE_FAST_SHUTDOWN, nullptr);
    }
}

template<bool SSL>
static void setSocketReadsPaused(us_socket_t* socket, bool paused)
{
    auto* response = reinterpret_cast<uWS::HttpResponse<SSL>*>(socket);
    if (paused) {
        response->pauseReads(uWS::HttpResponseData<SSL>::READ_PAUSE_SOCKET);
    } else {
        response->resumeReads(uWS::HttpResponseData<SSL>::READ_PAUSE_SOCKET);
    }
}

template<bool SSL>
static void setStateBit(us_socket_t* socket, uint32_t bit, bool value)
{
    auto& state = reinterpret_cast<uWS::HttpResponseData<SSL>*>(us_socket_ext(socket))->state;
    state = value ? state | bit : state & ~bit;
}

void JSNodeHTTPServerSocket::setRawReads(bool enabled)
{
    if (!socket || us_socket_is_closed(socket)) {
        return;
    }
    if (is_ssl) {
        setStateBit<true>(socket, uWS::HttpResponseData<true>::HTTP_NODE_RAW_READS, enabled);
    } else {
        setStateBit<false>(socket, uWS::HttpResponseData<false>::HTTP_NODE_RAW_READS, enabled);
    }
}

template<bool SSL>
static void liftParserReadPauses(us_socket_t* socket)
{
    using Data = uWS::HttpResponseData<SSL>;
    reinterpret_cast<uWS::HttpResponse<SSL>*>(socket)->resumeReads(Data::READ_PAUSE_BODY | Data::READ_PAUSE_PARKED | Data::READ_PAUSE_FLOOD);
}

void JSNodeHTTPServerSocket::leaveHttpAfterBody()
{
    if (isClosed()) {
        return;
    }
    // The body is the request's, not the socket's.
    setRawReads(false);
    if (is_ssl) {
        setStateBit<true>(socket, uWS::HttpResponseData<true>::HTTP_NODE_LEAVE_AFTER_BODY, true);
    } else {
        setStateBit<false>(socket, uWS::HttpResponseData<false>::HTTP_NODE_LEAVE_AFTER_BODY, true);
    }
}

void JSNodeHTTPServerSocket::detachParser()
{
    if (isClosed()) {
        return;
    }
    stopHTTPParsing();
    setRawReads(true);
    is_ssl ? liftParserReadPauses<true>(socket) : liftParserReadPauses<false>(socket);
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
        setStateBit<true>(socket, uWS::HttpResponseData<true>::HTTP_NODE_HAS_RESPONSE_TRAILERS, !dest.empty());
    } else {
        setStateBit<false>(socket, uWS::HttpResponseData<false>::HTTP_NODE_HAS_RESPONSE_TRAILERS, !dest.empty());
    }
}

bool JSNodeHTTPServerSocket::isClosed() const
{
    return !socket || us_socket_is_closed(socket);
}

template<bool SSL>
static bool deferShutdownUntilResponseDrains(us_socket_t* socket)
{
    auto* asyncSocket = reinterpret_cast<uWS::AsyncSocket<SSL>*>(socket);
    auto* httpResponseData = reinterpret_cast<uWS::HttpResponseData<SSL>*>(us_socket_ext(socket));
    if (asyncSocket->getBufferedAmount() == 0) {
        /* No response bytes to wait for: the caller ends the write side. */
        httpResponseData->state |= uWS::HttpResponseData<SSL>::HTTP_NODE_HALF_CLOSED;
        return false;
    }
    /* uWS shuts down after the flush. HttpContext dispatches nothing behind a complete response that closes the connection. */
    httpResponseData->state |= uWS::HttpResponseData<SSL>::HTTP_CONNECTION_CLOSE | uWS::HttpResponseData<SSL>::HTTP_NODE_SHUTDOWN_AFTER_DRAIN;
    return true;
}

bool JSNodeHTTPServerSocket::shutdownAfterResponseDrains()
{
    if (!socket || us_socket_is_closed(socket) || us_socket_is_shut_down(socket)) {
        return false;
    }
    flushResponseBytesAhead();
    if (is_ssl) {
        return deferShutdownUntilResponseDrains<true>(socket);
    }
    return deferShutdownUntilResponseDrains<false>(socket);
}

#ifdef LIBUS_USE_KQUEUE
template<bool SSL>
static bool socketReadsPaused(us_socket_t* socket)
{
    return (reinterpret_cast<uWS::HttpResponseData<SSL>*>(us_socket_ext(socket))->readPauseReasons & uWS::HttpResponseData<SSL>::READ_PAUSE_SOCKET) != 0;
}
#endif

void JSNodeHTTPServerSocket::halfClose()
{
    if (isClosed()) {
        return;
    }
#ifdef LIBUS_USE_KQUEUE
    // A pause and a resume around the shutdown cycle EVFILT_READ, without which macOS 26 does not deliver the peer's close. For a socket that paused its reads, the resume that ends that pause does it.
    const bool cycleReads = !(is_ssl ? socketReadsPaused<true>(socket) : socketReadsPaused<false>(socket));
    if (cycleReads) {
        is_ssl ? setSocketReadsPaused<true>(socket, true) : setSocketReadsPaused<false>(socket, true);
    }
#endif
    us_socket_shutdown(socket);
#ifdef LIBUS_USE_KQUEUE
    // After the shutdown, so that a W -> R|W -> R step does not delete the one-shot EVFILT_WRITE, which delivers EV_EOF on SHUT_WR.
    if (cycleReads && !us_socket_is_closed(socket)) {
        is_ssl ? setSocketReadsPaused<true>(socket, false) : setSocketReadsPaused<false>(socket, false);
    }
#endif
}

bool JSNodeHTTPServerSocket::finSent() const
{
    return ended && !isClosed() && us_socket_is_shut_down(socket);
}

bool JSNodeHTTPServerSocket::closeIfIdle()
{
    if (isClosed()) {
        return false;
    }
    if (is_ssl) {
        return reinterpret_cast<uWS::HttpResponse<true>*>(socket)->closeIfIdle();
    }
    return reinterpret_cast<uWS::HttpResponse<false>*>(socket)->closeIfIdle();
}

template<bool SSL>
static bool isRequestTimedOutImpl(us_socket_t* socket, uint64_t headersTimeoutMs, uint64_t requestTimeoutMs)
{
    /* node:http compat connections always carry the derived ext block. */
    auto* httpResponseData = reinterpret_cast<uWS::NodeHttpResponseData<SSL>*>(us_socket_ext(socket));
    if (httpResponseData->isParserDetached()) {
        // Like Node, which frees the parser of a connection that 'connect' or 'upgrade' got.
        return false;
    }
    if (httpResponseData->requestTimeoutReported) {
        // Report once per message, like Node's ConnectionsList::Expired().
        return false;
    }
    uint64_t start = httpResponseData->lastMessageStartMs;
    if (start == 0) {
        // Idle: no request message is currently being received.
        return false;
    }
    uint64_t now = uWS::nodeCompatMonotonicMs();
    uint64_t elapsed = now > start ? now - start : 0;
    bool expired = (headersTimeoutMs > 0 && !httpResponseData->headersCompleted && elapsed > headersTimeoutMs)
        || (requestTimeoutMs > 0 && elapsed > requestTimeoutMs);
    if (expired) {
        httpResponseData->requestTimeoutReported = true;
    }
    return expired;
}

bool JSNodeHTTPServerSocket::isRequestTimedOut(uint64_t headersTimeoutMs, uint64_t requestTimeoutMs)
{
    if (!socket || us_socket_is_closed(socket)) {
        return false;
    }
    if (is_ssl) {
        return isRequestTimedOutImpl<true>(socket, headersTimeoutMs, requestTimeoutMs);
    }
    return isRequestTimedOutImpl<false>(socket, headersTimeoutMs, requestTimeoutMs);
}

JSNodeHTTPServerSocket::~JSNodeHTTPServerSocket()
{
    // A VM that ends drops the task that onClose() posted without running it.
    closeSocketHandle(false);
    if (socket && is_ssl) {
        reinterpret_cast<uWS::HttpResponseData<true>*>(us_socket_ext(socket))->socketData = nullptr;
    } else if (socket) {
        reinterpret_cast<uWS::HttpResponseData<false>*>(us_socket_ext(socket))->socketData = nullptr;
    }
}

JSNodeHTTPServerSocket::JSNodeHTTPServerSocket(JSC::VM& vm, JSC::Structure* structure, us_socket_t* socket, bool is_ssl, JSNodeHTTPResponse* response)
    : JSC::JSDestructibleObject(vm, structure)
    , socket(socket)
    , is_ssl(is_ssl)
    , m_currentResponse(response, JSC::WriteBarrierEarlyInit)
{
}

bool JSNodeHTTPServerSocket::onPeerEnded()
{
    if (!m_socketHandle) {
        return false;
    }
    Bun__NodeHTTPSocket__onEnd(m_socketHandle, is_ssl);
    return true;
}

bool JSNodeHTTPServerSocket::finishParsing()
{
    if (isClosed()) {
        return false;
    }
    return is_ssl ? reinterpret_cast<uWS::HttpResponse<true>*>(socket)->finishParsing() : reinterpret_cast<uWS::HttpResponse<false>*>(socket)->finishParsing();
}

void JSNodeHTTPServerSocket::onUpgradeBodyEnded()
{
    if (!m_socketHandle) {
        return;
    }
    auto* globalObject = defaultGlobalObject(this->globalObject());
    EnsureStillAliveScope keepThis(this);
    auto* callback = functionToCallOnClose.get();
    auto* duplex = m_duplex.get();
    MarkedArgumentBuffer args;
    if (duplex) {
        args.append(duplex);
    }
    if (!leaveHttp(false)) {
        detachParser();
        return;
    }
    if (!callback || !duplex || globalObject->scriptExecutionStatus(globalObject, this) != ScriptExecutionStatus::Running) {
        return;
    }
    // onclose(socket): the connection is open, and it's the socket's from here on.
    Bun__EventLoop__enter(globalObject);
    callStoredCallback(globalObject, callback, this, args);
    Bun__EventLoop__exit(globalObject);
}

void JSNodeHTTPServerSocket::closeSocketHandle(bool runScript)
{
    if (void* handle = std::exchange(m_socketHandle, nullptr)) {
        Bun__NodeHTTPSocket__onClose(handle, is_ssl, closeReadError, runScript);
    }
}

void JSNodeHTTPServerSocket::detach()
{
    closeSocketHandle(false);
    this->m_duplex.clear();
    this->m_currentResponse.clear();
    {
        Locker locker { m_pipelinedResponsesLock };
        this->m_pipelinedResponses.clear();
    }
    this->strongThis.clear();
}

void JSNodeHTTPServerSocket::appendPipelinedResponse(JSC::VM& vm, JSNodeHTTPResponse* response)
{
    Locker locker { m_pipelinedResponsesLock };
    m_pipelinedResponses.append(JSC::WriteBarrier<JSNodeHTTPResponse> {});
    m_pipelinedResponses.last().set(vm, this, response);
}

/* Called by NodeHTTPResponse::update_parked once reads are paused and nothing is left to send. */
extern "C" void Bun__NodeHTTP__onRequestParked(int ssl, us_socket_t* socket)
{
    if (!socket || us_socket_is_closed(socket)) {
        return;
    }
    if (ssl) {
        reinterpret_cast<uWS::HttpResponse<true>*>(socket)->setParked(true);
    } else {
        reinterpret_cast<uWS::HttpResponse<false>*>(socket)->setParked(true);
    }
}

template<bool SSL>
static bool notifyWhenNodeHttpReadParsed(us_socket_t* socket)
{
    if (!uWS::HttpContext<SSL>::getSocketContextDataS(socket)->isParsing(socket)) {
        return false;
    }
    auto* d = reinterpret_cast<uWS::NodeHttpResponseData<SSL>*>(us_socket_ext(socket));
    d->state |= uWS::HttpResponseData<SSL>::HTTP_NODE_NOTIFY_READ_PARSED;
    return true;
}

// False when no read of this socket is being parsed: its body state is already exact.
extern "C" bool Bun__NodeHTTP__notifyWhenReadParsed(int ssl, us_socket_t* socket)
{
    if (!socket || us_socket_is_closed(socket)) {
        return false;
    }
    return ssl ? notifyWhenNodeHttpReadParsed<true>(socket) : notifyWhenNodeHttpReadParsed<false>(socket);
}

template<bool SSL>
static void startRawResponseImpl(us_socket_t* socket, bool connectionClose)
{
    /* node:http compat connections always carry the derived ext block. */
    auto* httpResponseData = reinterpret_cast<uWS::NodeHttpResponseData<SSL>*>(us_socket_ext(socket));

    // The previous response on this connection has finished; this queued
    // response now owns the per-response state the request handler normally
    // resets per parsed request.
    httpResponseData->offset = 0;
    // Clears the finished response's framing bits and keeps the connection-scoped ones.
    httpResponseData->resetResponseState();
    if (connectionClose) {
        httpResponseData->state |= uWS::HttpResponseData<SSL>::HTTP_CONNECTION_CLOSE;
    }
    httpResponseData->nodeHttpResponseTrailers.clear();

    if (httpResponseData->nodeHttpQueuedPipelinedCount > 0) {
        httpResponseData->nodeHttpQueuedPipelinedCount--;
    }
    auto* uwsResponse = reinterpret_cast<uWS::HttpResponse<SSL>*>(socket);
    uwsResponse->endFloodPauseIfDrained();
    // JavaScript renders this response and writes it with socket.write(): the header section is over, and uWS has no byte of its own to send.
    uwsResponse->setFraming(uWS::HttpResponseData<SSL>::HTTP_BODY_NONE);
    httpResponseData->state |= uWS::HttpResponseData<SSL>::HTTP_WRITE_CALLED;
}

bool JSNodeHTTPServerSocket::startRawResponse(JSC::VM& vm, JSNodeHTTPResponse* response, bool connectionClose)
{
    if (!socket || us_socket_is_closed(socket)) {
        return false;
    }

    bool wasQueued;
    {
        Locker locker { m_pipelinedResponsesLock };
        wasQueued = m_pipelinedResponses.removeFirstMatching([&](auto& entry) { return entry.get() == response; });
    }
    // Only a response that this connection queued can get it.
    if (!wasQueued) {
        return false;
    }

    // Before the state reset: the response in flight leaves its last bytes in the buffer and its handler slots empty.
    setCurrentResponse(vm, response);
    if (is_ssl) {
        startRawResponseImpl<true>(socket, connectionClose);
    } else {
        startRawResponseImpl<false>(socket, connectionClose);
    }
    Bun__NodeHTTPResponse_grantConnection(response->wrapped());
    return true;
}

void JSNodeHTTPServerSocket::stopHTTPParsing()
{
    if (!socket || us_socket_is_closed(socket)) {
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
    if (auto* res = socket->currentResponse()) {
        Bun__NodeHTTPResponse_onClose(res->wrapped(), JSValue::encode(res));
    }
    // Root every queued response across the onClose calls below: clearing
    // m_pipelinedResponses removes the only GC-visited slot, and a Vector that
    // spilled past its inline capacity sits on the heap where the conservative
    // stack scan does not see it. The raw-pointer list is iterated; the
    // MarkedArgumentBuffer is purely for GC visibility.
    JSC::MarkedArgumentBuffer roots;
    WTF::Vector<JSNodeHTTPResponse*, 2> pipelined;
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
        Bun__NodeHTTPResponse_onClose(res->wrapped(), JSValue::encode(res));
    }
}

void JSNodeHTTPServerSocket::onClose(int readError, bool peerEnded)
{
    this->socket = nullptr;
    if (m_socketHandle) {
        Bun__NodeHTTPSocket__forgetConnection(m_socketHandle, is_ssl);
    }
    this->closeReadError = readError;
    this->peer_ended = peerEnded;
    if (auto* res = currentResponse()) {
        Bun__NodeHTTPResponse_setClosed(res->wrapped());
    }
    {
        Locker locker { m_pipelinedResponsesLock };
        for (auto& entry : m_pipelinedResponses) {
            if (auto* res = entry.get()) {
                Bun__NodeHTTPResponse_setClosed(res->wrapped());
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
        auto* globalObject = defaultGlobalObject(context.globalObject());
        auto* thisObject = self;
        auto* callbackObject = thisObject->functionToCallOnClose.get();
        if (!callbackObject) {
            notifyResponsesOnClose(thisObject);
            thisObject->detach();
            return;
        }
        MarkedArgumentBuffer args;
        EnsureStillAliveScope ensureStillAlive(self);

        if (globalObject->scriptExecutionStatus(globalObject, thisObject) == ScriptExecutionStatus::Running) {
            // Notifying the responses runs script; it may leave an exception (a
            // termination arriving meanwhile), and nothing is entered on top of one.
            auto& vm = JSC::getVM(globalObject);
            auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
            notifyResponsesOnClose(thisObject);
            if (!scope.exception()) {
                callStoredCallback(globalObject, callbackObject, thisObject, args);
                RETURN_IF_EXCEPTION(scope, );
                thisObject->closeSocketHandle(true);
            } else if (!vm.hasPendingTerminationException()) {
                auto* ptr = scope.exception();
                scope.clearException();
                globalObject->reportUncaughtExceptionAtEventLoop(globalObject, ptr);
                RETURN_IF_EXCEPTION(scope, );
            }
        }
        thisObject->detach();
    });
}

void JSNodeHTTPServerSocket::flushResponseBytesAhead()
{
    if (isClosed()) {
        return;
    }
    if (auto* res = currentResponse()) {
        Bun__NodeHTTPResponse_spillPendingWrite(res->wrapped());
    }
    if (is_ssl) {
        reinterpret_cast<uWS::AsyncSocket<true>*>(socket)->uncork();
    } else {
        reinterpret_cast<uWS::AsyncSocket<false>*>(socket)->uncork();
    }
}

template<bool SSL>
static void unparkIfBytesAreUnsent(us_socket_t* socket)
{
    if (!reinterpret_cast<uWS::AsyncSocket<SSL>*>(socket)->hasFullyDrained()) {
        reinterpret_cast<uWS::HttpResponse<SSL>*>(socket)->setParked(false);
    }
}

void JSNodeHTTPServerSocket::updateParked()
{
    if (isClosed()) {
        return;
    }
    is_ssl ? unparkIfBytesAreUnsent<true>(socket) : unparkIfBytesAreUnsent<false>(socket);
    if (auto* res = currentResponse()) {
        Bun__NodeHTTPResponse_updateParked(res->wrapped());
    }
}

void JSNodeHTTPServerSocket::onDrain()
{
    if (m_socketHandle) {
        Bun__NodeHTTPSocket__onWritable(m_socketHandle, is_ssl);
    }
}

void JSNodeHTTPServerSocket::onRawRead(const char* data, int length)
{
    if (m_socketHandle) {
        Bun__NodeHTTPSocket__onData(m_socketHandle, is_ssl, data, length);
    }
}

JSC::Structure* JSNodeHTTPServerSocket::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    auto* structure = JSC::Structure::create(vm, globalObject, globalObject->objectPrototype(), JSC::TypeInfo(JSC::ObjectType, StructureFlags), JSNodeHTTPServerSocketPrototype::info());
    auto* prototype = JSNodeHTTPServerSocketPrototype::create(vm, structure);
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
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

    visitor.append(fn->m_currentResponse);
    visitor.append(fn->functionToCallOnClose);
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
static JSNodeHTTPResponse* getNodeHTTPResponse(us_socket_t* socket)
{
    auto* serverSocket = getNodeHTTPServerSocket<SSL>(socket);
    if (!serverSocket) {
        return nullptr;
    }
    return serverSocket->currentResponse();
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

void JSNodeHTTPServerSocket::onHandshake(int success, us_bun_verify_error_t verifyError)
{
    if (m_socketHandle) {
        Bun__NodeHTTPSocket__onHandshake(m_socketHandle, success, verifyError);
    }
}

extern "C" uint64_t Bun__NodeHTTPServerSocket__bytesRead(us_socket_t* socket, bool ssl)
{
    if (ssl) {
        return reinterpret_cast<uWS::HttpResponseData<true, true>*>(us_socket_ext(socket))->bytesRead;
    }
    return reinterpret_cast<uWS::HttpResponseData<false, true>*>(us_socket_ext(socket))->bytesRead;
}

template<bool SSL>
static void handOverToSocketHandle(us_socket_t* socket, void* handle, bool restOfReadTaken, uint64_t responseBytesWritten)
{
    auto* contextData = uWS::HttpContext<SSL>::getSocketContextDataS(socket);
    auto left = reinterpret_cast<uWS::HttpResponse<SSL>*>(socket)->leaveHttp();
    Bun__NodeHTTPSocket__leaveHttp(handle, SSL, socket, left.backpressure.data(), left.backpressure.length(), left.readsPaused, left.bytesRead, responseBytesWritten);
    contextData->socketLeft(socket, restOfReadTaken);
}

bool JSNodeHTTPServerSocket::leaveHttp(bool restOfReadTaken)
{
    if (isClosed() || !m_socketHandle) {
        return false;
    }
    flushResponseBytesAhead();
    if (us_socket_is_closed(socket) || us_socket_is_shut_down(socket)) {
        return false;
    }
    uint64_t responseBytesWritten = 0;
    if (auto* res = currentResponse()) {
        Bun__NodeHTTPResponse_takeBackConnection(res->wrapped(), JSValue::encode(res));
        responseBytesWritten = Bun__NodeHTTPResponse_bytesWritten(res->wrapped());
    }
    // The responses queued behind the one that leaves never get the connection.
    WTF::Vector<JSNodeHTTPResponse*, 2> queued;
    {
        Locker locker { m_pipelinedResponsesLock };
        for (auto& entry : m_pipelinedResponses) {
            if (auto* res = entry.get()) {
                queued.append(res);
            }
        }
    }
    for (auto* res : queued) {
        Bun__NodeHTTPResponse_takeBackConnection(res->wrapped(), JSValue::encode(res));
    }
    us_socket_t* leaving = std::exchange(socket, nullptr);
    void* handle = std::exchange(m_socketHandle, nullptr);
    if (is_ssl) {
        handOverToSocketHandle<true>(leaving, handle, restOfReadTaken, responseBytesWritten);
    } else {
        handOverToSocketHandle<false>(leaving, handle, restOfReadTaken, responseBytesWritten);
    }
    detach();
    return true;
}

// The WebSocket's close handler runs right behind this, and ws.ts has to hear it before the socket's 'close'.
template<bool SSL>
static void onAdoptedWebSocketClosed(void* handle, us_socket_t* socket, int, bool)
{
    Bun__NodeHTTPSocket__forgetWebSocket(handle, SSL, reinterpret_cast<uWS::AsyncSocket<SSL>*>(socket)->hasFullyDrained() && !us_socket_ssl_spill_dropped(socket));
    auto* globalObject = Bun__NodeHTTPSocket__globalObject(handle, SSL);
    auto* context = globalObject->scriptExecutionContext();
    if (!context || globalObject->isShuttingDown()) {
        Bun__NodeHTTPSocket__onClose(handle, SSL, 0, false);
        return;
    }
    context->postTask([handle](ScriptExecutionContext& context) {
        auto* globalObject = defaultGlobalObject(context.globalObject());
        Bun__NodeHTTPSocket__onClose(handle, SSL, 0, globalObject->scriptExecutionStatus(globalObject, globalObject) == ScriptExecutionStatus::Running);
    });
}

template<bool SSL>
static us_socket_t* adoptIntoWebSocket(us_socket_t* socket, void* webSocketContext, void* userData, std::string_view handshake, const uWS::PerMessageDeflateParams* deflateParams, void* handle)
{
    return reinterpret_cast<uWS::WebSocketContext<SSL, true, void*>*>(webSocketContext)->adoptSocket(socket, sizeof(uWS::HttpResponseData<SSL, true>), std::move(userData), handshake, deflateParams != nullptr, deflateParams ? uWS::compressOptionsFor(*deflateParams) : uWS::CompressOptions::DISABLED, handle, onAdoptedWebSocketClosed<SSL>);
}

// `socket` left HTTP for `handle` (leaveHttp() above), so its block still has the size of a node:http connection's.
extern "C" us_socket_t* Bun__NodeHTTPSocket__adoptIntoWebSocket(bool ssl, us_socket_t* socket, void* webSocketContext, void* userData, const char* handshake, size_t handshakeLength, const uWS::PerMessageDeflateParams* deflateParams, void* handle)
{
    std::string_view head(handshake, handshakeLength);
    return ssl ? adoptIntoWebSocket<true>(socket, webSocketContext, userData, head, deflateParams, handle) : adoptIntoWebSocket<false>(socket, webSocketContext, userData, head, deflateParams, handle);
}

static JSNodeHTTPServerSocket* openServerSocket(us_socket_t* socket, bool ssl)
{
    auto* serverSocket = ssl ? getNodeHTTPServerSocket<true>(socket) : getNodeHTTPServerSocket<false>(socket);
    return serverSocket && !serverSocket->isClosed() ? serverSocket : nullptr;
}

// The functions below are InternalSocket::UwsHttp in src/uws_sys/socket.rs: what req.socket._handle asks of a connection that uWS owns.
extern "C" void Bun__NodeHTTPServerSocket__write(us_socket_t* socket, bool ssl, const char* data, size_t length)
{
    auto* serverSocket = openServerSocket(socket, ssl);
    if (!serverSocket || serverSocket->ended) {
        return;
    }
    serverSocket->flushResponseBytesAhead();
    // The path of a 1xx line (HttpResponse::writeRawInformational): uWS buffers what the kernel doesn't take.
    ssl ? (void)reinterpret_cast<uWS::AsyncSocket<true>*>(socket)->write(data, length) : (void)reinterpret_cast<uWS::AsyncSocket<false>*>(socket)->write(data, length);
    serverSocket->updateParked();
}

extern "C" void Bun__NodeHTTPServerSocket__shutdown(us_socket_t* socket, bool ssl)
{
    auto* serverSocket = openServerSocket(socket, ssl);
    if (!serverSocket) {
        return;
    }
    serverSocket->ended = true;
    if (!serverSocket->shutdownAfterResponseDrains()) {
        serverSocket->halfClose();
    }
}

template<bool SSL>
static bool closeBehindPendingShutdown(us_socket_t* socket)
{
    auto* httpResponseData = reinterpret_cast<uWS::HttpResponseData<SSL>*>(us_socket_ext(socket));
    if (!(httpResponseData->state & uWS::HttpResponseData<SSL>::HTTP_NODE_SHUTDOWN_AFTER_DRAIN)) {
        return false;
    }
    httpResponseData->state &= ~uWS::HttpResponseData<SSL>::HTTP_NODE_SHUTDOWN_AFTER_DRAIN;
    httpResponseData->state |= uWS::HttpResponseData<SSL>::HTTP_NODE_CLOSE_AFTER_DRAIN;
    return true;
}

extern "C" void Bun__NodeHTTPServerSocket__close(us_socket_t* socket, bool ssl, int code)
{
    auto* serverSocket = openServerSocket(socket, ssl);
    if (!serverSocket) {
        return;
    }
    if (code == LIBUS_SOCKET_CLOSE_CODE_CONNECTION_RESET) {
        us_socket_close(socket, LIBUS_SOCKET_CLOSE_CODE_CONNECTION_RESET, nullptr);
        return;
    }
    // destroySoon(): the FIN still waits for queued bytes, so the close goes behind them too.
    if (ssl ? closeBehindPendingShutdown<true>(socket) : closeBehindPendingShutdown<false>(socket)) {
        return;
    }
    serverSocket->close();
}

extern "C" uint64_t Bun__NodeHTTPServerSocket__responseBytesWritten(us_socket_t* socket, bool ssl)
{
    auto* serverSocket = ssl ? getNodeHTTPServerSocket<true>(socket) : getNodeHTTPServerSocket<false>(socket);
    auto* res = serverSocket ? serverSocket->currentResponse() : nullptr;
    return res ? Bun__NodeHTTPResponse_bytesWritten(res->wrapped()) : 0;
}

extern "C" uint64_t Bun__NodeHTTPServerSocket__writeQueueSize(us_socket_t* socket, bool ssl)
{
    auto* serverSocket = ssl ? getNodeHTTPServerSocket<true>(socket) : getNodeHTTPServerSocket<false>(socket);
    auto* res = serverSocket ? serverSocket->currentResponse() : nullptr;
    uint64_t buffered = ssl ? reinterpret_cast<uWS::AsyncSocket<true>*>(socket)->getBufferedAmount() : reinterpret_cast<uWS::AsyncSocket<false>*>(socket)->getBufferedAmount();
    // The response adds the tail that it still sends from the caller's buffer, and says 0 once it is complete.
    uint64_t ofResponse = res ? Bun__NodeHTTPResponse_bufferedAmount(res->wrapped()) : 0;
    return (ofResponse > buffered ? ofResponse : buffered) + us_socket_ssl_spill_pending(socket);
}

extern "C" bool Bun__NodeHTTPServerSocket__hasUnsentBytes(us_socket_t* socket, bool ssl)
{
    return ssl ? !reinterpret_cast<uWS::AsyncSocket<true>*>(socket)->hasFullyDrained() : !reinterpret_cast<uWS::AsyncSocket<false>*>(socket)->hasFullyDrained();
}

extern "C" void Bun__NodeHTTPServerSocket__setReadsPaused(us_socket_t* socket, bool ssl, bool paused)
{
    auto* serverSocket = openServerSocket(socket, ssl);
    if (!serverSocket) {
        return;
    }
    ssl ? setSocketReadsPaused<true>(socket, paused) : setSocketReadsPaused<false>(socket, paused);
    serverSocket->updateParked();
}

void JSNodeHTTPServerSocket::onReadParsed()
{
    if (isClosed()) {
        return;
    }
    if (auto* res = currentResponse()) {
        Bun__NodeHTTPResponse_onReadParsed(res->wrapped());
    }
}

template<bool SSL>
static bool markHalfClosed(us_socket_t* socket)
{
    auto* httpResponseData = reinterpret_cast<uWS::HttpResponseData<SSL>*>(us_socket_ext(socket));
    const bool peerEnded = (httpResponseData->state & uWS::HttpResponseData<SSL>::HTTP_NODE_PEER_ENDED) != 0;
    httpResponseData->state |= uWS::HttpResponseData<SSL>::HTTP_NODE_HALF_CLOSED;
    return peerEnded;
}

void JSNodeHTTPServerSocket::halfCloseAfterDrain()
{
    const bool peerEnded = is_ssl ? markHalfClosed<true>(socket) : markHalfClosed<false>(socket);
    halfClose();
    // Both sides have ended, so no later event would close the socket.
    if (peerEnded && !isClosed()) {
        close();
    }
}

// Returns the JSNodeHTTPServerSocket already attached to this raw socket, or
// creates (and attaches) one. Used for connections that have not produced a
// parsed request yet: the 'clientError' path and the connection-accept path.
extern "C" JSC::EncodedJSValue Bun__getOrCreateNodeHTTPServerSocket(bool isSSL, us_socket_t* us_socket, Zig::GlobalObject* globalObject, const void* socketHandlers)
{
    auto& vm = globalObject->vm();

    // `bun --hot` can give a node:http server the listener of a Bun.serve server. Its sockets have no node:http block.
    if (isSSL ? !uWS::HttpContext<true>::fromSocket(us_socket)->isNodeHttp() : !uWS::HttpContext<false>::fromSocket(us_socket)->isNodeHttp()) {
        return JSValue::encode(JSC::jsNull());
    }

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
    if (socket) {
        socket->strongThis.set(vm, socket);
        if (socketHandlers) {
            socket->m_socketHandle = Bun__NodeHTTPSocket__create(socketHandlers, us_socket, isSSL, isSSL && us_socket_rejects_unauthorized(us_socket));
            // node:net's accept path, which emits 'connection'. A listener can close the connection.
            Bun__NodeHTTPSocket__onOpen(socket->m_socketHandle, isSSL);
        }
        return JSValue::encode(socket);
    }

    return JSValue::encode(JSC::jsNull());
}

JSC::Structure* createNodeHTTPServerSocketStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return JSNodeHTTPServerSocket::createStructure(vm, globalObject);
}

} // namespace Bun
