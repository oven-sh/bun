#include "JSNodeHTTPServerSocket.h"
#include "JSNodeHTTPServerSocketPrototype.h"
#include "AsyncContextFrame.h"
#include "ZigGlobalObject.h"
#include "DOMIsoSubspaces.h"
#include "ScriptExecutionContext.h"
#include "helpers.h"
#include "JSSocketAddressDTO.h"
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <wtf/Scope.h>
#include <wtf/text/WTFString.h>
#include "HTTPLatin1String.h"
#include <bun-uws/src/HttpResponse.h>

extern "C" void Bun__NodeHTTPResponse_setClosed(void* zigResponse);
extern "C" void Bun__NodeHTTPResponse_grantConnection(void* zigResponse);
extern "C" void Bun__NodeHTTPResponse_onReadParsed(void* zigResponse);
extern "C" void Bun__NodeHTTPResponse_markTunneled(void* zigResponse);
extern "C" void Bun__NodeHTTPResponse_spillPendingWrite(void* zigResponse);
extern "C" void Bun__NodeHTTPResponse_onClose(void* zigResponse, JSC::EncodedJSValue jsValue);
extern "C" void us_socket_free_stream_buffer(us_socket_stream_buffer_t* streamBuffer);
extern "C" uint64_t uws_res_get_remote_address_info(void* res, const char** dest, int* port, bool* is_ipv6);
extern "C" uint64_t uws_res_get_local_address_info(void* res, const char** dest, int* port, bool* is_ipv6);
extern "C" EncodedJSValue us_socket_buffered_js_write(void* socket, bool ended, bool hold, bool flushesBufferOnDrain, us_socket_stream_buffer_t* streamBuffer, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue data, JSC::EncodedJSValue encoding);
// src/uws_sys/http1/node.rs
extern "C" bool uws_res_prepare_destroy(us_socket_t*);
extern "C" void uws_res_start_tunnel(us_socket_t*, bool afterBody);
extern "C" bool uws_res_is_tunnel(us_socket_t*);
extern "C" void uws_res_update_tunnel_idle(us_socket_t*, bool isAllWritten);
extern "C" void uws_res_set_trailers(us_socket_t*, const char* fields, size_t length);
extern "C" bool uws_res_defer_shutdown(us_socket_t*, bool destroySoon);
extern "C" void uws_res_close_when_drained(us_socket_t*);
extern "C" bool uws_res_close_if_idle(us_socket_t*);
extern "C" bool uws_res_is_request_timed_out(us_socket_t*, uint64_t headersTimeoutMs, uint64_t requestTimeoutMs);
extern "C" bool uws_res_is_handshake_complete(us_socket_t*);
extern "C" bool uws_res_is_peer_verified(us_socket_t*, const char** errorCode);
extern "C" void uws_res_start_queued_response(us_socket_t*, bool isAncient, bool connectionClose);
extern "C" void uws_res_stop_parsing(us_socket_t*);
extern "C" void uws_res_uncork(us_socket_t*);
extern "C" bool uws_res_has_buffered_bytes(us_socket_t*);
extern "C" int us_socket_is_ssl_handshake_finished(struct us_socket_t* s);
extern "C" int us_socket_ssl_handshake_callback_has_fired(struct us_socket_t* s);

namespace Bun {

using namespace JSC;
using namespace WebCore;

// Calls ondata / ondrain / onclose in the context of the Bun.ModuleGraph whose script set it, if one
// did, and reports what it throws.
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
    object->syncPeerCertificateVerification();
    return object;
}

JSNodeHTTPServerSocket* JSNodeHTTPServerSocket::create(JSC::VM& vm, Zig::GlobalObject* globalObject, us_socket_t* socket, bool is_ssl, JSNodeHTTPResponse* response)
{
    auto* structure = globalObject->m_JSNodeHTTPServerSocketStructure.getInitializedOnMainThread(globalObject);
    return create(vm, structure, socket, is_ssl, response);
}

static void*& socketData(us_socket_t* socket)
{
    return reinterpret_cast<uWS::HttpResponse*>(socket)->getHttpResponseData()->socketData;
}

void JSNodeHTTPServerSocket::close()
{
    if (socket) {
        // uws is parsing this socket: it delivers the rest of the read, then closes (HTTP_NODE_CLOSE_AFTER_MESSAGE).
        if (!upgraded && !us_socket_is_closed(socket) && uws_res_prepare_destroy(socket)) {
            return;
        }
        // Forceful: code 0 defers the fd close until a close_notify reply that a half-open peer never sends.
        us_socket_close(socket, LIBUS_SOCKET_CLOSE_CODE_FAST_SHUTDOWN, nullptr);
    }
}

void JSNodeHTTPServerSocket::reset()
{
    if (socket) {
        us_socket_close(socket, LIBUS_SOCKET_CLOSE_CODE_CONNECTION_RESET, nullptr);
    }
}

void JSNodeHTTPServerSocket::upgradeToTunnelMode(bool afterBody, JSNodeHTTPResponse* response)
{
    if (!socket || upgraded || us_socket_is_closed(socket)) {
        return;
    }
    /* Reuse the CONNECT plumbing so the parser stops interpreting subsequent
     * bytes as HTTP and routes them to the ondata callback as opaque data. */
    uws_res_start_tunnel(socket, afterBody);
    /* The exchange leaves HTTP here: let the response release the server's
     * pending-request accounting (see Flags::TUNNELED in NodeHTTPResponse.rs). */
    if (response != nullptr) {
        Bun__NodeHTTPResponse_markTunneled(response->wrapped());
    }
}

static bool isTunnel(const JSNodeHTTPServerSocket* self)
{
    us_socket_t* socket = self->socket;
    if (!socket || self->upgraded || us_socket_is_closed(socket)) {
        return false;
    }
    return uws_res_is_tunnel(socket);
}

void JSNodeHTTPServerSocket::applyTunnelReads()
{
    if (!isTunnel(this)) {
        return;
    }
    if (tunnelReadsPaused()) {
        us_socket_pause(socket);
    } else {
        us_socket_resume(socket);
    }
}

void JSNodeHTTPServerSocket::readStop()
{
    // After the end of the stream no _read() comes to start the reads again.
    if (!isTunnel(this) || tunnelReadEnded) {
        return;
    }
    tunnelReadsStopped = true;
    applyTunnelReads();
}

void JSNodeHTTPServerSocket::readStart()
{
    if (!isTunnel(this)) {
        return;
    }
    tunnelReadsStopped = false;
    applyTunnelReads();
}

void JSNodeHTTPServerSocket::didDeliverQueuedTunnelBytes(size_t length)
{
    queuedTunnelBytes -= length;
    if (tunnelReadsQueuedFull && queuedTunnelBytes == 0) {
        tunnelReadsQueuedFull = false;
        applyTunnelReads();
    }
}

void JSNodeHTTPServerSocket::releaseTunnelReadsForUpgrade()
{
    tunnelReadsStopped = false;
    tunnelReadsQueuedFull = false;
    if (socket && !us_socket_is_closed(socket)) {
        us_socket_resume(socket);
    }
}

void JSNodeHTTPServerSocket::setResponseTrailers(WTF::StringView trailers)
{
    if (!socket || upgraded || us_socket_is_closed(socket) || trailers.isEmpty()) {
        return;
    }
    HTTPLatin1String fields(trailers);
    uws_res_set_trailers(socket, fields.view().data(), fields.view().size());
}

bool JSNodeHTTPServerSocket::isClosed() const
{
    return !socket || us_socket_is_closed(socket);
}

bool JSNodeHTTPServerSocket::shutdownAfterResponseDrains(bool destroySoon)
{
    if (!socket || upgraded || us_socket_is_closed(socket) || us_socket_is_shut_down(socket)) {
        return false;
    }
    flushResponseBytesAhead();
    return uws_res_defer_shutdown(socket, destroySoon);
}

JSC::EncodedJSValue JSNodeHTTPServerSocket::halfClose(JSC::JSGlobalObject* globalObject)
{
    // onNodeHTTPRequest no longer pauses at dispatch; pause here so the
    // shutdown+resume below still cycles kqueue's EVFILT_READ (delete then
    // re-add), without which macOS 26 does not deliver the peer's close.
    // Not for a tunnel that paused its reads: the resume that ends that pause is the re-add.
    const bool cycleReads = !upgraded && !tunnelReadsPaused();
    if (socket && cycleReads) {
        us_socket_pause(socket);
    }
    auto result = us_socket_buffered_js_write(socket, ended, hasUnsentResponseBytes(), flushesStreamBufferOnDrain(), &streamBuffer, globalObject, JSValue::encode(JSC::jsUndefined()), JSValue::encode(JSC::jsUndefined()));
    // Undo the pause above after the shutdown so the unread body drains
    // and kqueue's one-shot EVFILT_WRITE (which delivers EV_EOF on
    // SHUT_WR) is not deleted by a W -> R|W -> R step.
    if (socket && cycleReads) {
        us_socket_resume(socket);
    }
    return result;
}

void JSNodeHTTPServerSocket::closeWhenDrained()
{
    if (!socket || upgraded || us_socket_is_closed(socket)) {
        return;
    }
    uws_res_close_when_drained(socket);
}

bool JSNodeHTTPServerSocket::closeIfIdle()
{
    if (upgraded || isClosed()) {
        return false;
    }
    return uws_res_close_if_idle(socket);
}

bool JSNodeHTTPServerSocket::isRequestTimedOut(uint64_t headersTimeoutMs, uint64_t requestTimeoutMs)
{
    if (!socket || upgraded || us_socket_is_closed(socket)) {
        return false;
    }
    return uws_res_is_request_timed_out(socket, headersTimeoutMs, requestTimeoutMs);
}

bool JSNodeHTTPServerSocket::isAuthorized() const
{
    // is secure means that tls was established successfully
    if (!is_ssl || upgraded || !socket)
        return false;

    // Check if the handshake callback has fired. If so, use the isAuthorized flag
    // which reflects the actual certificate verification result.
    if (us_socket_ssl_handshake_callback_has_fired(socket)) {
        return uws_res_is_handshake_complete(socket);
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

void JSNodeHTTPServerSocket::syncPeerCertificateVerification()
{
    if (!is_ssl || upgraded || !socket || !us_socket_ssl_handshake_callback_has_fired(socket))
        return;
    peer_cert_verified = uws_res_is_peer_verified(socket, &peerCertVerifyErrorCode);
}

bool JSNodeHTTPServerSocket::isPeerCertificateVerified()
{
    syncPeerCertificateVerification();
    return peer_cert_verified;
}

const char* JSNodeHTTPServerSocket::peerCertificateVerificationError()
{
    if (!is_ssl)
        return nullptr;
    syncPeerCertificateVerification();
    return peerCertVerifyErrorCode;
}

JSNodeHTTPServerSocket::~JSNodeHTTPServerSocket()
{
    if (socket) {
        socketData(socket) = nullptr;
    }
    us_socket_free_stream_buffer(&streamBuffer);
}

JSNodeHTTPServerSocket::JSNodeHTTPServerSocket(JSC::VM& vm, JSC::Structure* structure, us_socket_t* socket, bool is_ssl, JSNodeHTTPResponse* response)
    : JSC::JSDestructibleObject(vm, structure)
    , socket(socket)
    , is_ssl(is_ssl)
    , m_currentResponse(response, JSC::WriteBarrierEarlyInit)
{
}

void JSNodeHTTPServerSocket::detach()
{
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

bool JSNodeHTTPServerSocket::startPipelinedResponse(JSC::VM& vm, JSNodeHTTPResponse* response, bool isAncient, bool connectionClose)
{
    if (!socket || upgraded || us_socket_is_closed(socket)) {
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
    uws_res_start_queued_response(socket, isAncient, connectionClose);
    Bun__NodeHTTPResponse_grantConnection(response->wrapped());
    return true;
}

void JSNodeHTTPServerSocket::stopHTTPParsing()
{
    if (!socket || upgraded || us_socket_is_closed(socket)) {
        return;
    }
    uws_res_stop_parsing(socket);
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

void JSNodeHTTPServerSocket::onUpgraded(us_socket_t* adopted)
{
    socket = adopted;
    upgraded = true;
    releaseTunnelReadsForUpgrade();

    // The HTTP connection is gone for the responses that did not upgrade it. They stay queued: the close still tells them.
    if (auto* res = currentResponse()) {
        Bun__NodeHTTPResponse_takeBackConnection(res->wrapped(), JSValue::encode(res), true);
    }
    WTF::Vector<JSNodeHTTPResponse*, 2> pipelined;
    {
        Locker locker { m_pipelinedResponsesLock };
        for (auto& entry : m_pipelinedResponses) {
            if (auto* res = entry.get()) {
                pipelined.append(res);
            }
        }
    }
    for (auto* res : pipelined) {
        Bun__NodeHTTPResponse_takeBackConnection(res->wrapped(), JSValue::encode(res), true);
    }
}

void JSNodeHTTPServerSocket::onClose(int readError, bool peerEnded)
{
    syncPeerCertificateVerification();
    this->socket = nullptr;
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
    if (upgraded || isClosed()) {
        return;
    }
    if (auto* res = currentResponse()) {
        Bun__NodeHTTPResponse_spillPendingWrite(res->wrapped());
    }
    uws_res_uncork(socket);
}

bool JSNodeHTTPServerSocket::hasUnsentResponseBytes() const
{
    if (upgraded || isClosed()) {
        return false;
    }
    return uws_res_has_buffered_bytes(socket);
}

void JSNodeHTTPServerSocket::updateTunnelIdle()
{
    if (!tunnelReadEnded || upgraded || isClosed()) {
        return;
    }
    uws_res_update_tunnel_idle(socket, streamBuffer.bufferedSize() == 0);
}

void JSNodeHTTPServerSocket::onDrain()
{
    // This function can be called during GC!
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(this->globalObject());
    if (!functionToCallOnDrain) {
        return;
    }

    // A read pause or resume arms the writable event too: nothing was buffered, so nothing drained.
    if (this->streamBuffer.bufferedSize() == 0 && !heldWriteAwaitsDrain) {
        updateTunnelIdle();
        return;
    }
    // uWS calls this with its own buffer empty, so the write it held has left.
    heldWriteAwaitsDrain = false;
    if (this->streamBuffer.bufferedSize() > 0) {
        auto* globalObject = defaultGlobalObject(this->globalObject());
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm());
        us_socket_buffered_js_write(this->socket, this->ended, this->hasUnsentResponseBytes(), this->flushesStreamBufferOnDrain(), &this->streamBuffer, globalObject, JSValue::encode(JSC::jsUndefined()), JSValue::encode(JSC::jsUndefined()));
        if (auto* exception = scope.exception()) {
            (void)scope.tryClearException();
            globalObject->reportUncaughtExceptionAtEventLoop(globalObject, exception);
            RETURN_IF_EXCEPTION(scope, );
            return;
        }

        if (this->streamBuffer.bufferedSize() > 0) {
            // need to drain more
            return;
        }
    }
    updateTunnelIdle();
    WebCore::ScriptExecutionContext* scriptExecutionContext = globalObject->scriptExecutionContext();

    if (scriptExecutionContext) {
        scriptExecutionContext->postTask([self = this](ScriptExecutionContext& context) {
            auto* globalObject = defaultGlobalObject(context.globalObject());
            auto* thisObject = self;
            auto* callbackObject = thisObject->functionToCallOnDrain.get();
            if (!callbackObject) {
                return;
            }
            MarkedArgumentBuffer args;
            EnsureStillAliveScope ensureStillAlive(self);

            if (globalObject->scriptExecutionStatus(globalObject, thisObject) == ScriptExecutionStatus::Running)
                callStoredCallback(globalObject, callbackObject, thisObject, args);
        });
    }
}

void JSNodeHTTPServerSocket::onData(const char* data, int length, bool last)
{
    // This function can be called during GC!
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(this->globalObject());
    if (last) {
        tunnelReadEnded = true;
    }
    if (!functionToCallOnData) {
        return;
    }

    WebCore::ScriptExecutionContext* scriptExecutionContext = globalObject->scriptExecutionContext();

    if (scriptExecutionContext) {
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm());
        JSC::JSUint8Array* buffer = WebCore::createBuffer(globalObject, std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(data), length));
        if (auto* exception = scope.exception()) {
            (void)scope.tryClearException();
            globalObject->reportUncaughtExceptionAtEventLoop(globalObject, exception);
            RETURN_IF_EXCEPTION(scope, );
            return;
        }
        // JS gets the chunk in a task, so its readStop() comes after the read loop: bound what the loop queues.
        queuedTunnelBytes += length;
        if (queuedTunnelBytes >= LIBUS_RECV_BUFFER_LENGTH && !tunnelReadsQueuedFull) {
            tunnelReadsQueuedFull = true;
            applyTunnelReads();
        }
        scriptExecutionContext->postTask([self = this, chunk = JSC::Strong<JSC::JSUint8Array>(globalObject->vm(), buffer), last = last, length = static_cast<size_t>(length)](ScriptExecutionContext& context) {
            auto* globalObject = defaultGlobalObject(context.globalObject());
            auto* thisObject = self;
            auto* callbackObject = thisObject->functionToCallOnData.get();
            // After the callback: a readStop() from it keeps the reads paused, with no resume in between.
            auto delivered = WTF::makeScopeExit([&] {
                thisObject->didDeliverQueuedTunnelBytes(length);
                if (last) {
                    thisObject->updateTunnelIdle();
                }
            });
            if (!callbackObject) {
                return;
            }

            MarkedArgumentBuffer args;
            args.append(chunk.get());
            args.append(JSC::jsBoolean(last));
            EnsureStillAliveScope ensureStillAlive(self);

            if (globalObject->scriptExecutionStatus(globalObject, thisObject) == ScriptExecutionStatus::Running)
                callStoredCallback(globalObject, callbackObject, thisObject, args);
        });
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

extern "C" JSC::EncodedJSValue Bun__getNodeHTTPResponseThisValue(us_socket_t* socket)
{
    auto* serverSocket = static_cast<JSNodeHTTPServerSocket*>(socketData(socket));
    return JSValue::encode(serverSocket ? serverSocket->currentResponse() : nullptr);
}

extern "C" JSC::EncodedJSValue Bun__getNodeHTTPServerSocketThisValue(us_socket_t* socket)
{
    return JSValue::encode(static_cast<JSNodeHTTPServerSocket*>(socketData(socket)));
}

extern "C" void Bun__NodeHTTPServerSocket__onClose(JSNodeHTTPServerSocket* self, bool hasLostData, int readError, bool peerEnded)
{
    self->closedWithUnsentData = hasLostData;
    self->onClose(readError, peerEnded);
}

extern "C" void Bun__NodeHTTPServerSocket__onDrain(JSNodeHTTPServerSocket* self) { self->onDrain(); }
extern "C" void Bun__NodeHTTPServerSocket__onData(JSNodeHTTPServerSocket* self, const char* data, int length, bool last) { self->onData(data, length, last); }
extern "C" void Bun__NodeHTTPServerSocket__onUpgraded(JSNodeHTTPServerSocket* self, us_socket_t* socket) { self->onUpgraded(socket); }
extern "C" bool Bun__NodeHTTPServerSocket__tunnelReadsPaused(JSNodeHTTPServerSocket* self) { return self->tunnelReadsPaused(); }

extern "C" void Bun__NodeHTTPServerSocket__onReadParsed(JSNodeHTTPServerSocket* self)
{
    if (auto* res = self->currentResponse()) {
        Bun__NodeHTTPResponse_onReadParsed(res->wrapped());
    }
}

// Returns the JSNodeHTTPServerSocket already attached to this raw socket, or
// creates (and attaches) one. Used for connections that have not produced a
// parsed request yet: the 'clientError' path and the connection-accept path.
extern "C" JSC::EncodedJSValue Bun__getOrCreateNodeHTTPServerSocket(bool isSSL, us_socket_t* us_socket, Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();

    if (auto* current = static_cast<JSNodeHTTPServerSocket*>(socketData(us_socket))) {
        return JSValue::encode(current);
    }
    // socket without response because is not valid http
    JSNodeHTTPServerSocket* socket = JSNodeHTTPServerSocket::create(
        vm,
        globalObject->m_JSNodeHTTPServerSocketStructure.getInitializedOnMainThread(globalObject),
        us_socket,
        isSSL, nullptr);
    socketData(us_socket) = socket;
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
