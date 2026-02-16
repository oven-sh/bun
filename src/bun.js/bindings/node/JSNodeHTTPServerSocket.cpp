#include "JSNodeHTTPServerSocket.h"
#include "JSNodeHTTPServerSocketPrototype.h"
#include "ZigGlobalObject.h"
#include "ZigGeneratedClasses.h"
#include "DOMIsoSubspaces.h"
#include "ScriptExecutionContext.h"
#include "helpers.h"
#include "JSSocketAddressDTO.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <wtf/text/WTFString.h>
#include <bun-uws/src/App.h>

extern "C" void Bun__NodeHTTPResponse_setClosed(void* zigResponse);
extern "C" void Bun__NodeHTTPResponse_onClose(void* zigResponse, JSC::EncodedJSValue jsValue);
extern "C" void us_socket_free_stream_buffer(us_socket_stream_buffer_t* streamBuffer);
extern "C" uint64_t uws_res_get_remote_address_info(void* res, const char** dest, int* port, bool* is_ipv6);
extern "C" uint64_t uws_res_get_local_address_info(void* res, const char** dest, int* port, bool* is_ipv6);
extern "C" EncodedJSValue us_socket_buffered_js_write(void* socket, bool is_ssl, bool ended, us_socket_stream_buffer_t* streamBuffer, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue data, JSC::EncodedJSValue encoding);
extern "C" int us_socket_is_ssl_handshake_finished(int ssl, struct us_socket_t* s);
extern "C" int us_socket_ssl_handshake_callback_has_fired(int ssl, struct us_socket_t* s);

namespace Bun {

using namespace JSC;
using namespace WebCore;

const JSC::ClassInfo JSNodeHTTPServerSocket::s_info = { "NodeHTTPServerSocket"_s, &Base::s_info, nullptr, nullptr,
    CREATE_METHOD_TABLE(JSNodeHTTPServerSocket) };

JSNodeHTTPServerSocket* JSNodeHTTPServerSocket::create(JSC::VM& vm, JSC::Structure* structure, us_socket_t* socket, bool is_ssl, WebCore::JSNodeHTTPResponse* response)
{
    if (socket && us_socket_is_closed(is_ssl, socket)) {
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
        auto* webSocket = (uWS::WebSocketData*)us_socket_ext(SSL, socket);
        webSocket->socketData = nullptr;
    } else {
        auto* httpResponseData = (uWS::HttpResponseData<SSL>*)us_socket_ext(SSL, socket);
        httpResponseData->socketData = nullptr;
    }
}

void JSNodeHTTPServerSocket::close()
{
    if (socket) {
        us_socket_close(is_ssl, socket, 0, nullptr);
    }
}

bool JSNodeHTTPServerSocket::isClosed() const
{
    return !socket || us_socket_is_closed(is_ssl, socket);
}

bool JSNodeHTTPServerSocket::isAuthorized() const
{
    // is secure means that tls was established successfully
    if (!is_ssl || !socket)
        return false;

    // Check if the handshake callback has fired. If so, use the isAuthorized flag
    // which reflects the actual certificate verification result.
    if (us_socket_ssl_handshake_callback_has_fired(is_ssl, socket)) {
        auto* httpResponseData = reinterpret_cast<uWS::HttpResponseData<true>*>(us_socket_ext(is_ssl, socket));
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
    return us_socket_is_ssl_handshake_finished(is_ssl, socket);
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
    this->strongThis.clear();
}

void JSNodeHTTPServerSocket::onClose()
{
    this->socket = nullptr;
    if (auto* res = this->currentResponseObject.get(); res != nullptr && res->m_ctx != nullptr) {
        Bun__NodeHTTPResponse_setClosed(res->m_ctx);
    }

    // This function can be called during GC!
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(this->globalObject());
    if (!functionToCallOnClose) {
        if (auto* res = this->currentResponseObject.get(); res != nullptr && res->m_ctx != nullptr) {
            Bun__NodeHTTPResponse_onClose(res->m_ctx, JSValue::encode(res));
        }
        this->detach();
        return;
    }

    WebCore::ScriptExecutionContext* scriptExecutionContext = globalObject->scriptExecutionContext();

    if (scriptExecutionContext) {
        scriptExecutionContext->postTask([self = this](ScriptExecutionContext& context) {
            WTF::NakedPtr<JSC::Exception> exception;
            auto* globalObject = defaultGlobalObject(context.globalObject());
            auto* thisObject = self;
            auto* callbackObject = thisObject->functionToCallOnClose.get();
            if (!callbackObject) {
                if (auto* res = thisObject->currentResponseObject.get(); res != nullptr && res->m_ctx != nullptr) {
                    Bun__NodeHTTPResponse_onClose(res->m_ctx, JSValue::encode(res));
                }
                thisObject->detach();
                return;
            }
            auto callData = JSC::getCallData(callbackObject);
            MarkedArgumentBuffer args;
            EnsureStillAliveScope ensureStillAlive(self);

            if (globalObject->scriptExecutionStatus(globalObject, thisObject) == ScriptExecutionStatus::Running) {
                if (auto* res = thisObject->currentResponseObject.get(); res != nullptr && res->m_ctx != nullptr) {
                    Bun__NodeHTTPResponse_onClose(res->m_ctx, JSValue::encode(res));
                }

                profiledCall(globalObject, JSC::ProfilingReason::API, callbackObject, callData, thisObject, args, exception);

                if (auto* ptr = exception.get()) {
                    exception.clear();
                    globalObject->reportUncaughtExceptionAtEventLoop(globalObject, ptr);
                }
            }
            thisObject->detach();
        });
    }
}

void JSNodeHTTPServerSocket::onDrain()
{
    // This function can be called during GC!
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(this->globalObject());
    if (!functionToCallOnDrain) {
        return;
    }

    auto bufferedSize = this->streamBuffer.bufferedSize();
    if (bufferedSize > 0) {
        auto* globalObject = defaultGlobalObject(this->globalObject());
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm());
        us_socket_buffered_js_write(this->socket, this->is_ssl, this->ended, &this->streamBuffer, globalObject, JSValue::encode(JSC::jsUndefined()), JSValue::encode(JSC::jsUndefined()));
        if (scope.exception()) {
            globalObject->reportUncaughtExceptionAtEventLoop(globalObject, scope.exception());
            return;
        }
        bufferedSize = this->streamBuffer.bufferedSize();

        if (bufferedSize > 0) {
            // need to drain more
            return;
        }
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
        if (scope.exception()) {
            globalObject->reportUncaughtExceptionAtEventLoop(globalObject, scope.exception());
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
    JSNodeHTTPServerSocket* fn = jsCast<JSNodeHTTPServerSocket*>(cell);
    ASSERT_GC_OBJECT_INHERITS(fn, info());
    Base::visitChildren(fn, visitor);

    visitor.append(fn->currentResponseObject);
    visitor.append(fn->functionToCallOnClose);
    visitor.append(fn->functionToCallOnDrain);
    visitor.append(fn->functionToCallOnData);
    visitor.append(fn->m_remoteAddress);
    visitor.append(fn->m_localAddress);
    visitor.append(fn->m_duplex);
}

DEFINE_VISIT_CHILDREN(JSNodeHTTPServerSocket);

template<bool SSL>
static JSNodeHTTPServerSocket* getNodeHTTPServerSocket(us_socket_t* socket)
{
    auto* httpResponseData = (uWS::HttpResponseData<SSL>*)us_socket_ext(SSL, socket);
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

extern "C" JSC::EncodedJSValue Bun__createNodeHTTPServerSocketForClientError(bool isSSL, us_socket_t* us_socket, Zig::GlobalObject* globalObject)
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
