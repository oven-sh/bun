#include "root.h"
#include "JSDOMGlobalObjectInlines.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/GlobalObjectMethodTable.h>
#include "helpers.h"
#include "BunClientData.h"

#include <JavaScriptCore/AggregateError.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/JSFunction.h>
#include "wtf/URL.h"
#include "JSFetchHeaders.h"
#include "JSDOMExceptionHandling.h"
#include <bun-uws/src/App.h>
#include "ZigGeneratedClasses.h"
#include "ScriptExecutionContext.h"
#include "AsyncContextFrame.h"
#include "ZigGeneratedClasses.h"
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include "JSSocketAddressDTO.h"

extern "C" uint64_t uws_res_get_remote_address_info(void* res, const char** dest, int* port, bool* is_ipv6);
extern "C" uint64_t uws_res_get_local_address_info(void* res, const char** dest, int* port, bool* is_ipv6);

extern "C" void Bun__NodeHTTPResponse_setClosed(void* zigResponse);
extern "C" void Bun__NodeHTTPResponse_onClose(void* zigResponse, JSC::EncodedJSValue jsValue);
namespace Bun {

using namespace JSC;
using namespace WebCore;

JSC_DEFINE_CUSTOM_SETTER(noOpSetter, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, PropertyName propertyName))
{
    return false;
}

JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterOnClose);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterClosed);
JSC_DECLARE_CUSTOM_SETTER(jsNodeHttpServerSocketSetterOnClose);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketClose);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterResponse);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterRemoteAddress);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterLocalAddress);

BUN_DECLARE_HOST_FUNCTION(Bun__drainMicrotasksFromJS);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterDuplex);
JSC_DECLARE_CUSTOM_SETTER(jsNodeHttpServerSocketSetterDuplex);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterIsSecureEstablished);
// Create a static hash table of values containing an onclose DOMAttributeGetterSetter and a close function
static const HashTableValue JSNodeHTTPServerSocketPrototypeTableValues[] = {
    { "onclose"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterOnClose, jsNodeHttpServerSocketSetterOnClose } },
    { "closed"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterClosed, noOpSetter } },
    { "response"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterResponse, noOpSetter } },
    { "duplex"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterDuplex, jsNodeHttpServerSocketSetterDuplex } },
    { "remoteAddress"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterRemoteAddress, noOpSetter } },
    { "localAddress"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterLocalAddress, noOpSetter } },
    { "close"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsFunctionNodeHTTPServerSocketClose, 0 } },
    { "secureEstablished"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterIsSecureEstablished, noOpSetter } },
};

class JSNodeHTTPServerSocketPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static JSNodeHTTPServerSocketPrototype* create(VM& vm, Structure* structure)
    {
        JSNodeHTTPServerSocketPrototype* prototype = new (NotNull, allocateCell<JSNodeHTTPServerSocketPrototype>(vm)) JSNodeHTTPServerSocketPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    DECLARE_INFO;

    static constexpr bool needsDestruction = false;
    static constexpr unsigned StructureFlags = Base::StructureFlags | HasStaticPropertyTable;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSNodeHTTPServerSocketPrototype, Base);
        return &vm.plainObjectSpace();
    }

private:
    JSNodeHTTPServerSocketPrototype(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(VM& vm)
    {
        Base::finishCreation(vm);
        ASSERT(inherits(info()));
        reifyStaticProperties(vm, info(), JSNodeHTTPServerSocketPrototypeTableValues, *this);
        this->structure()->setMayBePrototype(true);
    }
};

class JSNodeHTTPServerSocket : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static JSNodeHTTPServerSocket* create(JSC::VM& vm, JSC::Structure* structure, us_socket_t* socket, bool is_ssl, WebCore::JSNodeHTTPResponse* response)
    {
        auto* object = new (JSC::allocateCell<JSNodeHTTPServerSocket>(vm)) JSNodeHTTPServerSocket(vm, structure, socket, is_ssl, response);
        object->finishCreation(vm);
        return object;
    }

    static JSNodeHTTPServerSocket* create(JSC::VM& vm, Zig::GlobalObject* globalObject, us_socket_t* socket, bool is_ssl, WebCore::JSNodeHTTPResponse* response)
    {
        auto* structure = globalObject->m_JSNodeHTTPServerSocketStructure.getInitializedOnMainThread(globalObject);
        return create(vm, structure, socket, is_ssl, response);
    }

    static void destroy(JSC::JSCell* cell)
    {
        static_cast<JSNodeHTTPServerSocket*>(cell)->JSNodeHTTPServerSocket::~JSNodeHTTPServerSocket();
    }

    template<bool SSL>
    static void clearSocketData(us_socket_t* socket)
    {
        auto* httpResponseData = (uWS::HttpResponseData<SSL>*)us_socket_ext(SSL, socket);
        httpResponseData->socketData = nullptr;
    }

    void close()
    {
        if (socket) {
            us_socket_close(is_ssl, socket, 0, nullptr);
        }
    }

    bool isClosed() const
    {
        return !socket || us_socket_is_closed(is_ssl, socket);
    }
    // This means:
    // - [x] TLS
    // - [x] Handshake has completed
    // - [x] Handshake marked the connection as authorized
    bool isAuthorized() const
    {
        // is secure means that tls was established successfully
        if (!is_ssl || !socket) return false;
        auto* context = us_socket_context(is_ssl, socket);
        if (!context) return false;
        auto* data = (uWS::HttpContextData<true>*)us_socket_context_ext(is_ssl, context);
        if (!data) return false;
        return data->isAuthorized();
    }
    ~JSNodeHTTPServerSocket()
    {
        if (socket) {
            if (is_ssl) {
                clearSocketData<true>(socket);
            } else {
                clearSocketData<false>(socket);
            }
        }
    }

    JSNodeHTTPServerSocket(JSC::VM& vm, JSC::Structure* structure, us_socket_t* socket, bool is_ssl, WebCore::JSNodeHTTPResponse* response)
        : JSC::JSDestructibleObject(vm, structure)
        , socket(socket)
        , is_ssl(is_ssl)
    {
        currentResponseObject.setEarlyValue(vm, this, response);
    }

    mutable WriteBarrier<JSObject> functionToCallOnClose;
    mutable WriteBarrier<WebCore::JSNodeHTTPResponse> currentResponseObject;
    mutable WriteBarrier<JSObject> m_remoteAddress;
    mutable WriteBarrier<JSObject> m_localAddress;
    mutable WriteBarrier<JSObject> m_duplex;

    unsigned is_ssl : 1;
    us_socket_t* socket;
    JSC::Strong<JSNodeHTTPServerSocket> strongThis = {};

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;

        return WebCore::subspaceForImpl<JSNodeHTTPServerSocket, UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSNodeHTTPServerSocket.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSNodeHTTPServerSocket = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSNodeHTTPServerSocket.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSNodeHTTPServerSocket = std::forward<decltype(space)>(space); });
    }

    void detach()
    {
        this->m_duplex.clear();
        this->currentResponseObject.clear();
        this->strongThis.clear();
    }

    void onClose()
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

    static Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, globalObject->objectPrototype(), JSC::TypeInfo(JSC::ObjectType, StructureFlags), JSNodeHTTPServerSocketPrototype::info());
        auto* prototype = JSNodeHTTPServerSocketPrototype::create(vm, structure);
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
    }
};

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketClose, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* thisObject = jsDynamicCast<JSNodeHTTPServerSocket*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        return JSValue::encode(JSC::jsUndefined());
    }
    if (thisObject->isClosed()) {
        return JSValue::encode(JSC::jsUndefined());
    }
    thisObject->close();

    return JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterIsSecureEstablished, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = jsCast<JSNodeHTTPServerSocket*>(JSC::JSValue::decode(thisValue));
    return JSValue::encode(JSC::jsBoolean(thisObject->isAuthorized()));
}
JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterDuplex, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = jsCast<JSNodeHTTPServerSocket*>(JSC::JSValue::decode(thisValue));
    if (thisObject->m_duplex) {
        return JSValue::encode(thisObject->m_duplex.get());
    }
    return JSValue::encode(JSC::jsNull());
}

JSC_DEFINE_CUSTOM_SETTER(jsNodeHttpServerSocketSetterDuplex, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, JSC::PropertyName propertyName))
{
    auto& vm = globalObject->vm();
    auto* thisObject = jsCast<JSNodeHTTPServerSocket*>(JSC::JSValue::decode(thisValue));
    JSValue value = JSC::JSValue::decode(encodedValue);
    if (auto* object = value.getObject()) {
        thisObject->m_duplex.set(vm, thisObject, object);

    } else {
        thisObject->m_duplex.clear();
    }

    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterRemoteAddress, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto& vm = globalObject->vm();
    auto* thisObject = jsCast<JSNodeHTTPServerSocket*>(JSC::JSValue::decode(thisValue));
    if (thisObject->m_remoteAddress) {
        return JSValue::encode(thisObject->m_remoteAddress.get());
    }

    us_socket_t* socket = thisObject->socket;
    if (!socket) {
        return JSValue::encode(JSC::jsNull());
    }

    const char* address = nullptr;
    int port = 0;
    bool is_ipv6 = false;

    uws_res_get_remote_address_info(socket, &address, &port, &is_ipv6);

    if (address == nullptr) {
        return JSValue::encode(JSC::jsNull());
    }

    auto addressString = WTF::String::fromUTF8(address);
    if (addressString.isEmpty()) {
        return JSValue::encode(JSC::jsNull());
    }

    auto* object = JSSocketAddressDTO::create(defaultGlobalObject(globalObject), jsString(vm, addressString), port, is_ipv6);
    thisObject->m_remoteAddress.set(vm, thisObject, object);
    return JSValue::encode(object);
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterLocalAddress, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto& vm = globalObject->vm();
    auto* thisObject = jsCast<JSNodeHTTPServerSocket*>(JSC::JSValue::decode(thisValue));
    if (thisObject->m_localAddress) {
        return JSValue::encode(thisObject->m_localAddress.get());
    }

    us_socket_t* socket = thisObject->socket;
    if (!socket) {
        return JSValue::encode(JSC::jsNull());
    }

    const char* address = nullptr;
    int port = 0;
    bool is_ipv6 = false;

    uws_res_get_local_address_info(socket, &address, &port, &is_ipv6);

    if (address == nullptr) {
        return JSValue::encode(JSC::jsNull());
    }

    auto addressString = WTF::String::fromUTF8(address);
    if (addressString.isEmpty()) {
        return JSValue::encode(JSC::jsNull());
    }

    auto* object = JSSocketAddressDTO::create(defaultGlobalObject(globalObject), jsString(vm, addressString), port, is_ipv6);
    thisObject->m_localAddress.set(vm, thisObject, object);
    return JSValue::encode(object);
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterOnClose, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = jsCast<JSNodeHTTPServerSocket*>(JSC::JSValue::decode(thisValue));

    if (thisObject->functionToCallOnClose) {
        return JSValue::encode(thisObject->functionToCallOnClose.get());
    }

    return JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_CUSTOM_SETTER(jsNodeHttpServerSocketSetterOnClose, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, JSC::PropertyName propertyName))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsCast<JSNodeHTTPServerSocket*>(JSC::JSValue::decode(thisValue));
    JSValue value = JSC::JSValue::decode(encodedValue);

    if (value.isUndefined() || value.isNull()) {
        thisObject->functionToCallOnClose.clear();
        return true;
    }

    if (!value.isCallable()) {
        return false;
    }

    thisObject->functionToCallOnClose.set(vm, thisObject, value.getObject());
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterClosed, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    auto* thisObject = jsCast<JSNodeHTTPServerSocket*>(JSC::JSValue::decode(thisValue));
    return JSValue::encode(JSC::jsBoolean(thisObject->isClosed()));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterResponse, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName propertyName))
{
    auto* thisObject = jsCast<JSNodeHTTPServerSocket*>(JSC::JSValue::decode(thisValue));
    if (!thisObject->currentResponseObject) {
        return JSValue::encode(JSC::jsNull());
    }

    return JSValue::encode(thisObject->currentResponseObject.get());
}

template<typename Visitor>
void JSNodeHTTPServerSocket::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSNodeHTTPServerSocket* fn = jsCast<JSNodeHTTPServerSocket*>(cell);
    ASSERT_GC_OBJECT_INHERITS(fn, info());
    Base::visitChildren(fn, visitor);

    visitor.append(fn->currentResponseObject);
    visitor.append(fn->functionToCallOnClose);
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

const JSC::ClassInfo JSNodeHTTPServerSocket::s_info = { "NodeHTTPServerSocket"_s, &Base::s_info, nullptr, nullptr,
    CREATE_METHOD_TABLE(JSNodeHTTPServerSocket) };

const JSC::ClassInfo JSNodeHTTPServerSocketPrototype::s_info = { "NodeHTTPServerSocket"_s, &Base::s_info, nullptr, nullptr,
    CREATE_METHOD_TABLE(JSNodeHTTPServerSocketPrototype) };

template<bool SSL>
static void* getNodeHTTPResponsePtr(us_socket_t* socket)
{
    WebCore::JSNodeHTTPResponse* responseObject = getNodeHTTPResponse<SSL>(socket);
    if (!responseObject) {
        return nullptr;
    }
    return responseObject->wrapped();
}

extern "C" EncodedJSValue Bun__getNodeHTTPResponseThisValue(bool is_ssl, us_socket_t* socket)
{
    if (is_ssl) {
        return JSValue::encode(getNodeHTTPResponse<true>(socket));
    }
    return JSValue::encode(getNodeHTTPResponse<false>(socket));
}

extern "C" EncodedJSValue Bun__getNodeHTTPServerSocketThisValue(bool is_ssl, us_socket_t* socket)
{
    if (is_ssl) {
        return JSValue::encode(getNodeHTTPServerSocket<true>(socket));
    }
    return JSValue::encode(getNodeHTTPServerSocket<false>(socket));
}

extern "C" void Bun__setNodeHTTPServerSocketUsSocketValue(EncodedJSValue thisValue, us_socket_t* socket)
{
    auto* response = jsCast<JSNodeHTTPServerSocket*>(JSValue::decode(thisValue));
    response->socket = socket;
}

extern "C" void Bun__callNodeHTTPServerSocketOnClose(EncodedJSValue thisValue)
{
    auto* response = jsCast<JSNodeHTTPServerSocket*>(JSValue::decode(thisValue));
    response->onClose();
}

extern "C" JSC::EncodedJSValue Bun__createNodeHTTPServerSocket(bool isSSL, us_socket_t* us_socket, Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    RETURN_IF_EXCEPTION(scope, {});

    // socket without response because is not valid http
    JSNodeHTTPServerSocket* socket = JSNodeHTTPServerSocket::create(
        vm,
        globalObject->m_JSNodeHTTPServerSocketStructure.getInitializedOnMainThread(globalObject),
        us_socket,
        isSSL, nullptr);

    RETURN_IF_EXCEPTION(scope, {});
    if (socket) {
        socket->strongThis.set(vm, socket);
        return JSValue::encode(socket);
    }
    return JSValue::encode(JSC::jsNull());
}

BUN_DECLARE_HOST_FUNCTION(jsFunctionRequestOrResponseHasBodyValue);
BUN_DECLARE_HOST_FUNCTION(jsFunctionGetCompleteRequestOrResponseBodyValueAsArrayBuffer);
extern "C" uWS::HttpRequest* Request__getUWSRequest(void*);
extern "C" void Request__setInternalEventCallback(void*, EncodedJSValue, JSC::JSGlobalObject*);
extern "C" void Request__setTimeout(void*, EncodedJSValue, JSC::JSGlobalObject*);
extern "C" bool NodeHTTPResponse__setTimeout(void*, EncodedJSValue, JSC::JSGlobalObject*);
extern "C" void Server__setIdleTimeout(EncodedJSValue, EncodedJSValue, JSC::JSGlobalObject*);
extern "C" EncodedJSValue Server__setAppFlags(JSC::JSGlobalObject*, EncodedJSValue, bool require_host_header, bool use_strict_method_validation);
extern "C" EncodedJSValue Server__setOnClientError(JSC::JSGlobalObject*, EncodedJSValue, EncodedJSValue);
extern "C" EncodedJSValue Server__setMaxHTTPHeaderSize(JSC::JSGlobalObject*, EncodedJSValue, uint64_t);

static EncodedJSValue assignHeadersFromFetchHeaders(FetchHeaders& impl, JSObject* prototype, JSObject* objectValue, JSC::InternalFieldTuple* tuple, JSC::JSGlobalObject* globalObject, JSC::VM& vm)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    uint32_t size = std::min(impl.sizeAfterJoiningSetCookieHeader(), static_cast<uint32_t>(JSFinalObject::maxInlineCapacity));
    JSC::JSArray* array = constructEmptyArray(globalObject, nullptr, impl.size() * 2);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSObject* obj = JSC::constructEmptyObject(globalObject, prototype, size);
    RETURN_IF_EXCEPTION(scope, {});

    unsigned arrayI = 0;

    auto& internal = impl.internalHeaders();
    {
        auto& vec = internal.commonHeaders();
        for (const auto& it : vec) {
            const auto& name = it.key;
            const auto& value = it.value;
            const auto impl = WTF::httpHeaderNameStringImpl(name);
            JSString* jsValue = jsString(vm, value);
            obj->putDirect(vm, Identifier::fromString(vm, impl), jsValue, 0);
            array->putDirectIndex(globalObject, arrayI++, jsString(vm, impl));
            array->putDirectIndex(globalObject, arrayI++, jsValue);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    {
        const auto& values = internal.getSetCookieHeaders();

        size_t count = values.size();

        if (count > 0) {
            JSC::JSArray* setCookies = constructEmptyArray(globalObject, nullptr, count);
            RETURN_IF_EXCEPTION(scope, {});
            const auto setCookieHeaderString = WTF::httpHeaderNameStringImpl(HTTPHeaderName::SetCookie);

            JSString* setCookie = jsString(vm, setCookieHeaderString);

            for (size_t i = 0; i < count; ++i) {
                auto* out = jsString(vm, values[i]);
                array->putDirectIndex(globalObject, arrayI++, setCookie);
                array->putDirectIndex(globalObject, arrayI++, out);
                setCookies->putDirectIndex(globalObject, i, out);
                RETURN_IF_EXCEPTION(scope, {});
            }

            RETURN_IF_EXCEPTION(scope, {});
            obj->putDirect(vm, JSC::Identifier::fromString(vm, setCookieHeaderString), setCookies, 0);
        }
    }

    {
        const auto& vec = internal.uncommonHeaders();
        for (const auto& it : vec) {
            const auto& name = it.key;
            const auto& value = it.value;
            auto* jsValue = jsString(vm, value);
            obj->putDirect(vm, Identifier::fromString(vm, name.convertToASCIILowercase()), jsValue, 0);
            array->putDirectIndex(globalObject, arrayI++, jsString(vm, name));
            array->putDirectIndex(globalObject, arrayI++, jsValue);
        }
    }

    tuple->putInternalField(vm, 0, obj);
    tuple->putInternalField(vm, 1, array);

    return JSValue::encode(tuple);
}

static void assignHeadersFromUWebSocketsForCall(uWS::HttpRequest* request, JSValue methodString, MarkedArgumentBuffer& args, JSC::JSGlobalObject* globalObject, JSC::VM& vm)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    {
        std::string_view fullURLStdStr = request->getFullUrl();
        String fullURL = String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const LChar*>(fullURLStdStr.data()), fullURLStdStr.length() });
        args.append(jsString(vm, WTFMove(fullURL)));
    }

    // Get the method.
    if (UNLIKELY(methodString.isUndefinedOrNull())) {
        std::string_view methodView = request->getMethod();
        WTF::String methodString = String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const LChar*>(methodView.data()), methodView.length() });
        args.append(jsString(vm, WTFMove(methodString)));
    } else {
        args.append(methodString);
    }

    size_t size = 0;
    for (auto it = request->begin(); it != request->end(); ++it) {
        size++;
    }

    JSC::JSObject* headersObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), std::min(size, static_cast<size_t>(JSFinalObject::maxInlineCapacity)));
    RETURN_IF_EXCEPTION(scope, void());
    JSC::JSArray* setCookiesHeaderArray = nullptr;
    JSC::JSString* setCookiesHeaderString = nullptr;
    MarkedArgumentBuffer arrayValues;

    args.append(headersObject);

    for (auto it = request->begin(); it != request->end(); ++it) {
        auto pair = *it;
        StringView nameView = StringView(std::span { reinterpret_cast<const LChar*>(pair.first.data()), pair.first.length() });
        std::span<LChar> data;
        auto value = String::createUninitialized(pair.second.length(), data);
        if (pair.second.length() > 0)
            memcpy(data.data(), pair.second.data(), pair.second.length());

        HTTPHeaderName name;

        JSString* jsValue = jsString(vm, value);

        HTTPHeaderIdentifiers& identifiers = WebCore::clientData(vm)->httpHeaderIdentifiers();
        Identifier nameIdentifier;
        JSString* nameString = nullptr;

        if (WebCore::findHTTPHeaderName(nameView, name)) {
            nameString = identifiers.stringFor(globalObject, name);
            nameIdentifier = identifiers.identifierFor(vm, name);
        } else {
            WTF::String wtfString = nameView.toString();
            nameString = jsString(vm, wtfString);
            nameIdentifier = Identifier::fromString(vm, wtfString.convertToASCIILowercase());
        }

        if (name == WebCore::HTTPHeaderName::SetCookie) {
            if (!setCookiesHeaderArray) {
                setCookiesHeaderArray = constructEmptyArray(globalObject, nullptr);
                setCookiesHeaderString = nameString;
                headersObject->putDirect(vm, nameIdentifier, setCookiesHeaderArray, 0);
                RETURN_IF_EXCEPTION(scope, void());
            }
            arrayValues.append(setCookiesHeaderString);
            arrayValues.append(jsValue);
            setCookiesHeaderArray->push(globalObject, jsValue);
            RETURN_IF_EXCEPTION(scope, void());

        } else {
            headersObject->putDirectMayBeIndex(globalObject, nameIdentifier, jsValue);
            arrayValues.append(nameString);
            arrayValues.append(jsValue);
            RETURN_IF_EXCEPTION(scope, void());
        }
    }

    JSC::JSArray* array;
    {

        ObjectInitializationScope initializationScope(vm);
        if (LIKELY(array = JSArray::tryCreateUninitializedRestricted(initializationScope, nullptr, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), arrayValues.size()))) {
            EncodedJSValue* data = arrayValues.data();
            for (size_t i = 0, size = arrayValues.size(); i < size; ++i) {
                array->initializeIndex(initializationScope, i, JSValue::decode(data[i]));
            }
        } else {
            array = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), arrayValues);
        }
    }

    args.append(array);
}

// This is an 8% speedup.
static EncodedJSValue assignHeadersFromUWebSockets(uWS::HttpRequest* request, JSObject* prototype, JSObject* objectValue, JSC::InternalFieldTuple* tuple, JSC::JSGlobalObject* globalObject, JSC::VM& vm)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& builtinNames = WebCore::builtinNames(vm);

    {
        std::string_view fullURLStdStr = request->getFullUrl();
        String fullURL = String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const LChar*>(fullURLStdStr.data()), fullURLStdStr.length() });
        PutPropertySlot slot(objectValue, false);
        objectValue->put(objectValue, globalObject, builtinNames.urlPublicName(), jsString(vm, WTFMove(fullURL)), slot);
        RETURN_IF_EXCEPTION(scope, {});
    }

    {
        PutPropertySlot slot(objectValue, false);
        std::string_view methodView = request->getMethod();
        WTF::String methodString;
        switch (methodView.length()) {
        case 3: {
            if (methodView == std::string_view("get", 3)) {
                methodString = "GET"_s;
                break;
            }
            if (methodView == std::string_view("put", 3)) {
                methodString = "PUT"_s;
                break;
            }

            break;
        }
        case 4: {
            if (methodView == std::string_view("post", 4)) {
                methodString = "POST"_s;
                break;
            }
            if (methodView == std::string_view("head", 4)) {
                methodString = "HEAD"_s;
                break;
            }

            if (methodView == std::string_view("copy", 4)) {
                methodString = "COPY"_s;
                break;
            }
        }

        case 5: {
            if (methodView == std::string_view("patch", 5)) {
                methodString = "PATCH"_s;
                break;
            }
            if (methodView == std::string_view("merge", 5)) {
                methodString = "MERGE"_s;
                break;
            }
            if (methodView == std::string_view("trace", 5)) {
                methodString = "TRACE"_s;
                break;
            }
            if (methodView == std::string_view("fetch", 5)) {
                methodString = "FETCH"_s;
                break;
            }
            if (methodView == std::string_view("purge", 5)) {
                methodString = "PURGE"_s;
                break;
            }

            break;
        }

        case 6: {
            if (methodView == std::string_view("delete", 6)) {
                methodString = "DELETE"_s;
                break;
            }

            break;
        }

        case 7: {
            if (methodView == std::string_view("connect", 7)) {
                methodString = "CONNECT"_s;
                break;
            }
            if (methodView == std::string_view("options", 7)) {
                methodString = "OPTIONS"_s;
                break;
            }

            break;
        }
        }

        if (methodString.isNull()) {
            methodString = String::fromUTF8ReplacingInvalidSequences({ reinterpret_cast<const LChar*>(methodView.data()), methodView.length() });
        }
        objectValue->put(objectValue, globalObject, builtinNames.methodPublicName(), jsString(vm, methodString), slot);
        RETURN_IF_EXCEPTION(scope, {});
    }

    size_t size = 0;
    for (auto it = request->begin(); it != request->end(); ++it) {
        size++;
    }

    JSC::JSObject* headersObject = JSC::constructEmptyObject(globalObject, prototype, std::min(size, static_cast<size_t>(JSFinalObject::maxInlineCapacity)));
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSArray* array = constructEmptyArray(globalObject, nullptr, size * 2);
    JSC::JSArray* setCookiesHeaderArray = nullptr;
    JSC::JSString* setCookiesHeaderString = nullptr;

    unsigned i = 0;

    for (auto it = request->begin(); it != request->end(); ++it) {
        auto pair = *it;
        StringView nameView = StringView(std::span { reinterpret_cast<const LChar*>(pair.first.data()), pair.first.length() });
        std::span<LChar> data;
        auto value = String::tryCreateUninitialized(pair.second.length(), data);
        if (UNLIKELY(value.isNull())) {
            throwOutOfMemoryError(globalObject, scope);
            return JSValue::encode({});
        }
        if (pair.second.length() > 0)
            memcpy(data.data(), pair.second.data(), pair.second.length());

        HTTPHeaderName name;
        WTF::String nameString;
        WTF::String lowercasedNameString;

        if (WebCore::findHTTPHeaderName(nameView, name)) {
            nameString = WTF::httpHeaderNameStringImpl(name);
            lowercasedNameString = nameString;
        } else {
            nameString = nameView.toString();
            lowercasedNameString = nameString.convertToASCIILowercase();
        }

        JSString* jsValue = jsString(vm, value);

        if (name == WebCore::HTTPHeaderName::SetCookie) {
            if (!setCookiesHeaderArray) {
                setCookiesHeaderArray = constructEmptyArray(globalObject, nullptr);
                setCookiesHeaderString = jsString(vm, nameString);
                headersObject->putDirect(vm, Identifier::fromString(vm, lowercasedNameString), setCookiesHeaderArray, 0);
                RETURN_IF_EXCEPTION(scope, {});
            }
            array->putDirectIndex(globalObject, i++, setCookiesHeaderString);
            array->putDirectIndex(globalObject, i++, jsValue);
            setCookiesHeaderArray->push(globalObject, jsValue);
            RETURN_IF_EXCEPTION(scope, {});

        } else {
            headersObject->putDirect(vm, Identifier::fromString(vm, lowercasedNameString), jsValue, 0);
            array->putDirectIndex(globalObject, i++, jsString(vm, nameString));
            array->putDirectIndex(globalObject, i++, jsValue);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    tuple->putInternalField(vm, 0, headersObject);
    tuple->putInternalField(vm, 1, array);

    return JSValue::encode(tuple);
}

template<bool isSSL>
static void assignOnCloseFunction(uWS::TemplatedApp<isSSL>* app)
{
    app->setOnClose([](void* socketData, int is_ssl, struct us_socket_t* rawSocket) -> void {
        auto* socket = reinterpret_cast<JSNodeHTTPServerSocket*>(socketData);
        ASSERT(rawSocket == socket->socket || socket->socket == nullptr);
        socket->onClose();
    });
}

extern "C" void NodeHTTP_assignOnCloseFunction(bool is_ssl, void* uws_app)
{
    if (is_ssl) {
        assignOnCloseFunction<true>(reinterpret_cast<uWS::TemplatedApp<true>*>(uws_app));
    } else {
        assignOnCloseFunction<false>(reinterpret_cast<uWS::TemplatedApp<false>*>(uws_app));
    }
}

extern "C" void NodeHTTP_setUsingCustomExpectHandler(bool is_ssl, void* uws_app, bool value)
{
    if (is_ssl) {
        reinterpret_cast<uWS::TemplatedApp<true>*>(uws_app)->setUsingCustomExpectHandler(value);
    } else {
        reinterpret_cast<uWS::TemplatedApp<false>*>(uws_app)->setUsingCustomExpectHandler(value);
    }
}

extern "C" EncodedJSValue NodeHTTPResponse__createForJS(size_t any_server, JSC::JSGlobalObject* globalObject, bool* hasBody, uWS::HttpRequest* request, int isSSL, void* response_ptr, void* upgrade_ctx, void** nodeHttpResponsePtr);

template<bool isSSL>
static EncodedJSValue NodeHTTPServer__onRequest(
    size_t any_server,
    Zig::GlobalObject* globalObject,
    JSValue thisValue,
    JSValue callback,
    JSValue methodString,
    uWS::HttpRequest* request,
    uWS::HttpResponse<isSSL>* response,
    void* upgrade_ctx,
    void** nodeHttpResponsePtr)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* callbackObject = jsCast<JSObject*>(callback);
    MarkedArgumentBuffer args;
    args.append(thisValue);

    assignHeadersFromUWebSocketsForCall(request, methodString, args, globalObject, vm);
    if (scope.exception()) {
        auto* exception = scope.exception();
        response->endWithoutBody();
        scope.clearException();
        return JSValue::encode(exception);
    }

    bool hasBody = false;
    WebCore::JSNodeHTTPResponse* nodeHTTPResponseObject = jsCast<WebCore::JSNodeHTTPResponse*>(JSValue::decode(NodeHTTPResponse__createForJS(any_server, globalObject, &hasBody, request, isSSL, response, upgrade_ctx, nodeHttpResponsePtr)));

    args.append(nodeHTTPResponseObject);
    args.append(jsBoolean(hasBody));

    auto* currentSocketDataPtr = reinterpret_cast<JSC::JSCell*>(response->getHttpResponseData()->socketData);

    if (currentSocketDataPtr) {
        auto* thisSocket = jsCast<JSNodeHTTPServerSocket*>(currentSocketDataPtr);
        thisSocket->currentResponseObject.set(vm, thisSocket, nodeHTTPResponseObject);
        args.append(thisSocket);
        args.append(jsBoolean(false));
        if (thisSocket->m_duplex) {
            args.append(thisSocket->m_duplex.get());
        } else {
            args.append(jsUndefined());
        }
    } else {
        JSNodeHTTPServerSocket* socket = JSNodeHTTPServerSocket::create(
            vm,
            globalObject->m_JSNodeHTTPServerSocketStructure.getInitializedOnMainThread(globalObject),
            (us_socket_t*)response,
            isSSL, nodeHTTPResponseObject);

        socket->strongThis.set(vm, socket);

        response->getHttpResponseData()->socketData = socket;

        args.append(socket);
        args.append(jsBoolean(true));
        args.append(jsUndefined());
    }
    args.append(jsBoolean(request->isAncient()));

    WTF::NakedPtr<JSC::Exception> exception;
    JSValue returnValue = AsyncContextFrame::call(globalObject, callbackObject, jsUndefined(), args, exception);
    if (exception) {
        auto* ptr = exception.get();
        exception.clear();
        return JSValue::encode(ptr);
    }

    return JSValue::encode(returnValue);
}

template<bool isSSL>
static void writeResponseHeader(uWS::HttpResponse<isSSL>* res, const WTF::StringView& name, const WTF::StringView& value)
{
    WTF::CString nameStr;
    WTF::CString valueStr;

    std::string_view nameView;
    std::string_view valueView;

    if (name.is8Bit()) {
        const auto nameSpan = name.span8();
        ASSERT(name.containsOnlyASCII());
        nameView = std::string_view(reinterpret_cast<const char*>(nameSpan.data()), nameSpan.size());
    } else {
        nameStr = name.utf8();
        nameView = std::string_view(nameStr.data(), nameStr.length());
    }

    if (value.is8Bit()) {
        const auto valueSpan = value.span8();
        valueView = std::string_view(reinterpret_cast<const char*>(valueSpan.data()), valueSpan.size());
    } else {
        valueStr = value.utf8();
        valueView = std::string_view(valueStr.data(), valueStr.length());
    }

    res->writeHeader(nameView, valueView);
}

template<bool isSSL>
static void writeFetchHeadersToUWSResponse(WebCore::FetchHeaders& headers, uWS::HttpResponse<isSSL>* res)
{
    auto& internalHeaders = headers.internalHeaders();

    for (auto& value : internalHeaders.getSetCookieHeaders()) {

        if (value.is8Bit()) {
            const auto valueSpan = value.span8();
            res->writeHeader(std::string_view("set-cookie", 10), std::string_view(reinterpret_cast<const char*>(valueSpan.data()), valueSpan.size()));
        } else {
            WTF::CString valueStr = value.utf8();
            res->writeHeader(std::string_view("set-cookie", 10), std::string_view(valueStr.data(), valueStr.length()));
        }
    }

    auto* data = res->getHttpResponseData();

    for (const auto& header : internalHeaders.commonHeaders()) {

        const auto& name = WebCore::httpHeaderNameString(header.key);
        const auto& value = header.value;

        // We have to tell uWS not to automatically insert a TransferEncoding or Date header.
        // Otherwise, you get this when using Fastify;
        //
        // ❯ curl http://localhost:3000 --verbose
        // *   Trying [::1]:3000...
        // * Connected to localhost (::1) port 3000
        // > GET / HTTP/1.1
        // > Host: localhost:3000
        // > User-Agent: curl/8.4.0
        // > Accept: */*
        // >
        // < HTTP/1.1 200 OK
        // < Content-Type: application/json; charset=utf-8
        // < Content-Length: 17
        // < Date: Sun, 06 Oct 2024 13:37:01 GMT
        // < Transfer-Encoding: chunked
        // <
        //
        if (header.key == WebCore::HTTPHeaderName::ContentLength) {
            if (!(data->state & uWS::HttpResponseData<isSSL>::HTTP_WROTE_CONTENT_LENGTH_HEADER)) {
                data->state |= uWS::HttpResponseData<isSSL>::HTTP_WROTE_CONTENT_LENGTH_HEADER;
                res->writeMark();
            }
        }
        writeResponseHeader<isSSL>(res, name, value);
    }

    for (auto& header : internalHeaders.uncommonHeaders()) {
        const auto& name = header.key;
        const auto& value = header.value;

        writeResponseHeader<isSSL>(res, name, value);
    }
}

template<bool isSSL>
static void NodeHTTPServer__writeHead(
    JSC::JSGlobalObject* globalObject,
    const char* statusMessage,
    size_t statusMessageLength,
    JSValue headersObjectValue,
    uWS::HttpResponse<isSSL>* response)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* headersObject = headersObjectValue.getObject();
    if (response->getLoopData()->canCork() && response->getBufferedAmount() == 0) {
        response->getLoopData()->setCorkedSocket(response, isSSL);
    }
    response->writeStatus(std::string_view(statusMessage, statusMessageLength));

    if (headersObject) {
        if (auto* fetchHeaders = jsDynamicCast<WebCore::JSFetchHeaders*>(headersObject)) {
            writeFetchHeadersToUWSResponse<isSSL>(fetchHeaders->wrapped(), response);
            return;
        }

        if (UNLIKELY(headersObject->hasNonReifiedStaticProperties())) {
            headersObject->reifyAllStaticProperties(globalObject);
            RETURN_IF_EXCEPTION(scope, void());
        }

        auto* structure = headersObject->structure();

        if (structure->canPerformFastPropertyEnumeration()) {
            structure->forEachProperty(vm, [&](const auto& entry) {
                JSValue headerValue = headersObject->getDirect(entry.offset());
                if (!headerValue.isString()) {

                    return true;
                }

                String key = entry.key();
                String value = headerValue.toWTFString(globalObject);
                if (scope.exception()) {
                    return false;
                }

                writeResponseHeader<isSSL>(response, key, value);

                return true;
            });
        } else {
            PropertyNameArray propertyNames(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
            headersObject->getOwnPropertyNames(headersObject, globalObject, propertyNames, DontEnumPropertiesMode::Exclude);
            RETURN_IF_EXCEPTION(scope, void());

            for (unsigned i = 0; i < propertyNames.size(); ++i) {
                JSValue headerValue = headersObject->getIfPropertyExists(globalObject, propertyNames[i]);
                if (!headerValue.isString()) {
                    continue;
                }

                String key = propertyNames[i].string();
                String value = headerValue.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, void());
                writeResponseHeader<isSSL>(response, key, value);
            }
        }
    }

    RELEASE_AND_RETURN(scope, void());
}

extern "C" void NodeHTTPServer__writeHead_http(
    JSC::JSGlobalObject* globalObject,
    const char* statusMessage,
    size_t statusMessageLength,
    JSValue headersObjectValue,
    uWS::HttpResponse<false>* response)
{
    return NodeHTTPServer__writeHead<false>(globalObject, statusMessage, statusMessageLength, headersObjectValue, response);
}

extern "C" void NodeHTTPServer__writeHead_https(
    JSC::JSGlobalObject* globalObject,
    const char* statusMessage,
    size_t statusMessageLength,
    JSValue headersObjectValue,
    uWS::HttpResponse<true>* response)
{
    return NodeHTTPServer__writeHead<true>(globalObject, statusMessage, statusMessageLength, headersObjectValue, response);
}

extern "C" EncodedJSValue NodeHTTPServer__onRequest_http(
    size_t any_server,
    Zig::GlobalObject* globalObject,
    EncodedJSValue thisValue,
    EncodedJSValue callback,
    EncodedJSValue methodString,
    uWS::HttpRequest* request,
    uWS::HttpResponse<false>* response,
    void* upgrade_ctx,
    void** nodeHttpResponsePtr)
{
    return NodeHTTPServer__onRequest<false>(
        any_server,
        globalObject,
        JSValue::decode(thisValue),
        JSValue::decode(callback),
        JSValue::decode(methodString),
        request,
        response,
        upgrade_ctx,
        nodeHttpResponsePtr);
}

extern "C" EncodedJSValue NodeHTTPServer__onRequest_https(
    size_t any_server,
    Zig::GlobalObject* globalObject,
    EncodedJSValue thisValue,
    EncodedJSValue callback,
    EncodedJSValue methodString,
    uWS::HttpRequest* request,
    uWS::HttpResponse<true>* response,
    void* upgrade_ctx,
    void** nodeHttpResponsePtr)
{
    return NodeHTTPServer__onRequest<true>(
        any_server,
        globalObject,
        JSValue::decode(thisValue),
        JSValue::decode(callback),
        JSValue::decode(methodString),
        request,
        response,
        upgrade_ctx,
        nodeHttpResponsePtr);
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPAssignHeaders, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // This is an internal binding.
    JSValue requestValue = callFrame->uncheckedArgument(0);
    JSObject* objectValue = callFrame->uncheckedArgument(1).getObject();
    JSC::InternalFieldTuple* tuple = jsCast<JSC::InternalFieldTuple*>(callFrame->uncheckedArgument(2));
    ASSERT(callFrame->argumentCount() == 3);

    JSValue headersValue = JSValue();
    JSValue urlValue = JSValue();
    if (auto* jsRequest = jsDynamicCast<WebCore::JSRequest*>(requestValue)) {
        if (uWS::HttpRequest* request = Request__getUWSRequest(jsRequest->wrapped())) {
            return assignHeadersFromUWebSockets(request, globalObject->objectPrototype(), objectValue, tuple, globalObject, vm);
        }

        if (jsRequest->m_headers) {
            headersValue = jsRequest->m_headers.get();
        }

        if (jsRequest->m_url) {
            urlValue = jsRequest->m_url.get();
        }
    }

    if (requestValue.isObject()) {
        if (!headersValue) {
            headersValue = requestValue.getObject()->getIfPropertyExists(globalObject, WebCore::builtinNames(vm).headersPublicName());
            RETURN_IF_EXCEPTION(scope, {});
        }

        if (!urlValue) {
            urlValue = requestValue.getObject()->getIfPropertyExists(globalObject, WebCore::builtinNames(vm).urlPublicName());
            RETURN_IF_EXCEPTION(scope, {});
        }

        if (headersValue) {
            if (auto* headers = jsDynamicCast<WebCore::JSFetchHeaders*>(headersValue)) {
                FetchHeaders& impl = headers->wrapped();
                if (urlValue) {
                    if (urlValue.isString()) {
                        String url = urlValue.toWTFString(globalObject);
                        RETURN_IF_EXCEPTION(scope, {});
                        if (url.startsWith("https://"_s) || url.startsWith("http://"_s) || url.startsWith("file://"_s)) {
                            WTF::URL urlObj = WTF::URL({}, url);
                            if (urlObj.isValid()) {
                                urlValue = jsString(vm, makeString(urlObj.path(), urlObj.query().isEmpty() ? emptyString() : urlObj.queryWithLeadingQuestionMark()));
                            }
                        }
                    } else {
                        urlValue = jsEmptyString(vm);
                    }
                    PutPropertySlot slot(objectValue, false);
                    objectValue->put(objectValue, globalObject, WebCore::builtinNames(vm).urlPublicName(), urlValue, slot);
                    RETURN_IF_EXCEPTION(scope, {});
                }

                return assignHeadersFromFetchHeaders(impl, globalObject->objectPrototype(), objectValue, tuple, globalObject, vm);
            }
        }
    }

    return JSValue::encode(jsNull());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPAssignEventCallback, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // This is an internal binding.
    JSValue requestValue = callFrame->uncheckedArgument(0);
    JSValue callback = callFrame->uncheckedArgument(1);

    ASSERT(callFrame->argumentCount() == 2);

    if (auto* jsRequest = jsDynamicCast<WebCore::JSRequest*>(requestValue)) {
        Request__setInternalEventCallback(jsRequest->wrapped(), JSValue::encode(callback), globalObject);
    }

    return JSValue::encode(jsNull());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPSetTimeout, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // This is an internal binding.
    JSValue requestValue = callFrame->uncheckedArgument(0);
    JSValue seconds = callFrame->uncheckedArgument(1);

    ASSERT(callFrame->argumentCount() == 2);

    if (auto* jsRequest = jsDynamicCast<WebCore::JSRequest*>(requestValue)) {
        Request__setTimeout(jsRequest->wrapped(), JSValue::encode(seconds), globalObject);
    }

    if (auto* nodeHttpResponse = jsDynamicCast<WebCore::JSNodeHTTPResponse*>(requestValue)) {
        NodeHTTPResponse__setTimeout(nodeHttpResponse->wrapped(), JSValue::encode(seconds), globalObject);
    }

    return JSValue::encode(jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(jsHTTPSetServerIdleTimeout, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // This is an internal binding.
    JSValue serverValue = callFrame->uncheckedArgument(0);
    JSValue seconds = callFrame->uncheckedArgument(1);

    ASSERT(callFrame->argumentCount() == 2);

    Server__setIdleTimeout(JSValue::encode(serverValue), JSValue::encode(seconds), globalObject);

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPSetCustomOptions, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(callFrame->argumentCount() == 5);
    // This is an internal binding.
    JSValue serverValue = callFrame->uncheckedArgument(0);
    JSValue requireHostHeader = callFrame->uncheckedArgument(1);
    JSValue useStrictMethodValidation = callFrame->uncheckedArgument(2);
    JSValue maxHeaderSize = callFrame->uncheckedArgument(3);
    JSValue callback = callFrame->uncheckedArgument(4);

    double maxHeaderSizeNumber = maxHeaderSize.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    Server__setAppFlags(globalObject, JSValue::encode(serverValue), requireHostHeader.toBoolean(globalObject), useStrictMethodValidation.toBoolean(globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    Server__setMaxHTTPHeaderSize(globalObject, JSValue::encode(serverValue), maxHeaderSizeNumber);
    RETURN_IF_EXCEPTION(scope, {});

    Server__setOnClientError(globalObject, JSValue::encode(serverValue), JSValue::encode(callback));
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPGetHeader, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue headersValue = callFrame->argument(0);

    if (auto* headers = jsDynamicCast<WebCore::JSFetchHeaders*>(headersValue)) {
        JSValue nameValue = callFrame->argument(1);
        if (nameValue.isString()) {
            FetchHeaders* impl = &headers->wrapped();
            JSString* nameString = nameValue.toString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            const auto name = nameString->view(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (WTF::equalIgnoringASCIICase(name, "set-cookie"_s)) {
                return fetchHeadersGetSetCookie(globalObject, vm, impl);
            }

            WebCore::ExceptionOr<String> res = impl->get(name);
            if (res.hasException()) {
                WebCore::propagateException(globalObject, scope, res.releaseException());
                return JSValue::encode(jsUndefined());
            }

            String value = res.returnValue();
            if (value.isEmpty()) {
                return JSValue::encode(jsUndefined());
            }

            return JSC::JSValue::encode(jsString(vm, value));
        }
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsHTTPSetHeader, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue headersValue = callFrame->argument(0);
    JSValue nameValue = callFrame->argument(1);
    JSValue valueValue = callFrame->argument(2);

    if (auto* headers = jsDynamicCast<WebCore::JSFetchHeaders*>(headersValue)) {

        if (nameValue.isString()) {
            String name = nameValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});

            FetchHeaders* impl = &headers->wrapped();

            if (valueValue.isUndefined())
                return JSValue::encode(jsUndefined());

            if (isArray(globalObject, valueValue)) {
                auto* array = jsCast<JSArray*>(valueValue);
                unsigned length = array->length();
                if (length > 0) {
                    JSValue item = array->getIndex(globalObject, 0);
                    if (UNLIKELY(scope.exception()))
                        return JSValue::encode(jsUndefined());

                    auto value = item.toWTFString(globalObject);
                    RETURN_IF_EXCEPTION(scope, {});
                    impl->set(name, value);
                    RETURN_IF_EXCEPTION(scope, {});
                }
                for (unsigned i = 1; i < length; ++i) {
                    JSValue value = array->getIndex(globalObject, i);
                    if (UNLIKELY(scope.exception()))
                        return JSValue::encode(jsUndefined());
                    auto string = value.toWTFString(globalObject);
                    RETURN_IF_EXCEPTION(scope, {});
                    impl->append(name, string);
                    RETURN_IF_EXCEPTION(scope, {});
                }
                RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
                return JSValue::encode(jsUndefined());
            }

            auto value = valueValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            impl->set(name, value);
            RETURN_IF_EXCEPTION(scope, {});
            return JSValue::encode(jsUndefined());
        }
    }

    return JSValue::encode(jsUndefined());
}

JSValue createNodeHTTPInternalBinding(Zig::GlobalObject* globalObject)
{
    auto* obj = constructEmptyObject(globalObject);
    VM& vm = globalObject->vm();
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "setHeader"_s)),
        JSC::JSFunction::create(vm, globalObject, 3, "setHeader"_s, jsHTTPSetHeader, ImplementationVisibility::Public), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "getHeader"_s)),
        JSC::JSFunction::create(vm, globalObject, 2, "getHeader"_s, jsHTTPGetHeader, ImplementationVisibility::Public), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "assignHeaders"_s)),
        JSC::JSFunction::create(vm, globalObject, 2, "assignHeaders"_s, jsHTTPAssignHeaders, ImplementationVisibility::Public), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "assignEventCallback"_s)),
        JSC::JSFunction::create(vm, globalObject, 2, "assignEventCallback"_s, jsHTTPAssignEventCallback, ImplementationVisibility::Public), 0);

    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "setRequestTimeout"_s)),
        JSC::JSFunction::create(vm, globalObject, 2, "setRequestTimeout"_s, jsHTTPSetTimeout, ImplementationVisibility::Public), 0);

    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "setServerIdleTimeout"_s)),
        JSC::JSFunction::create(vm, globalObject, 2, "setServerIdleTimeout"_s, jsHTTPSetServerIdleTimeout, ImplementationVisibility::Public), 0);

    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "setServerCustomOptions"_s)),
        JSC::JSFunction::create(vm, globalObject, 2, "setServerCustomOptions"_s, jsHTTPSetCustomOptions, ImplementationVisibility::Public), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "Response"_s)),
        globalObject->JSResponseConstructor(), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "Request"_s)),
        globalObject->JSRequestConstructor(), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "Blob"_s)),
        globalObject->JSBlobConstructor(), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "Headers"_s)),
        WebCore::JSFetchHeaders::getConstructor(vm, globalObject), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "headersTuple"_s)),
        JSC::InternalFieldTuple::create(vm, globalObject->m_internalFieldTupleStructure.get()), 0);
    obj->putDirectNativeFunction(
        vm, globalObject, JSC::PropertyName(JSC::Identifier::fromString(vm, "webRequestOrResponseHasBodyValue"_s)),
        1, jsFunctionRequestOrResponseHasBodyValue, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);

    obj->putDirectNativeFunction(
        vm, globalObject, JSC::PropertyName(JSC::Identifier::fromString(vm, "getCompleteWebRequestOrResponseBodyValueAsArrayBuffer"_s)),
        1, jsFunctionGetCompleteRequestOrResponseBodyValueAsArrayBuffer, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
    obj->putDirectNativeFunction(
        vm, globalObject, JSC::PropertyName(JSC::Identifier::fromString(vm, "drainMicrotasks"_s)),
        0, Bun__drainMicrotasksFromJS, ImplementationVisibility::Public, Intrinsic::NoIntrinsic, 0);
    return obj;
}

extern "C" void WebCore__FetchHeaders__toUWSResponse(WebCore::FetchHeaders* arg0, bool is_ssl, void* arg2)
{
    if (is_ssl) {
        writeFetchHeadersToUWSResponse<true>(*arg0, reinterpret_cast<uWS::HttpResponse<true>*>(arg2));
    } else {
        writeFetchHeadersToUWSResponse<false>(*arg0, reinterpret_cast<uWS::HttpResponse<false>*>(arg2));
    }
}

JSC::Structure* createNodeHTTPServerSocketStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return JSNodeHTTPServerSocket::createStructure(vm, globalObject);
}

} // namespace Bun
