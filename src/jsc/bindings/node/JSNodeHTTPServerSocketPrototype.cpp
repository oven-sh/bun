#include "JSNodeHTTPServerSocketPrototype.h"
#include "JSNodeHTTPServerSocket.h"
#include "JSSocketAddressDTO.h"
#include "ZigGlobalObject.h"
#include "ZigGeneratedClasses.h"
#include "helpers.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <wtf/text/WTFString.h>
#include <cmath>

extern "C" EncodedJSValue us_socket_buffered_js_write(void* socket, bool is_ssl, bool ended, us_socket_stream_buffer_t* streamBuffer, void* responseCtx, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue data, JSC::EncodedJSValue encoding);
extern "C" void Bun__NodeHTTPResponse_spillPendingPinnedWrite(void* ctx);
extern "C" uint64_t uws_res_get_remote_address_info(void* res, const char** dest, int* port, bool* is_ipv6);
extern "C" uint64_t uws_res_get_local_address_info(void* res, const char** dest, int* port, bool* is_ipv6);
extern "C" void us_socket_resume(us_socket_t*);
extern "C" void us_socket_pause(us_socket_t*);

namespace Bun {

using namespace JSC;
using namespace WebCore;

// Declare custom getters/setters and host functions
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterOnClose);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterOnDrain);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterClosed);
JSC_DECLARE_CUSTOM_SETTER(jsNodeHttpServerSocketSetterOnClose);
JSC_DECLARE_CUSTOM_SETTER(jsNodeHttpServerSocketSetterOnDrain);
JSC_DECLARE_CUSTOM_SETTER(jsNodeHttpServerSocketSetterOnData);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterOnData);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterBytesWritten);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketClose);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketWrite);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketEnd);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketUpgradeToTunnel);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketSetResponseTrailers);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketIsRequestTimedOut);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketStartPipelinedResponse);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketStopParsing);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterResponse);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterRemoteAddress);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterLocalAddress);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterDuplex);
JSC_DECLARE_CUSTOM_SETTER(jsNodeHttpServerSocketSetterDuplex);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterIsSecureEstablished);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterServername);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterAuthorizationError);

JSC_DEFINE_CUSTOM_SETTER(noOpSetter, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    return false;
}

const JSC::ClassInfo JSNodeHTTPServerSocketPrototype::s_info = { "NodeHTTPServerSocket"_s, &Base::s_info, nullptr, nullptr,
    CREATE_METHOD_TABLE(JSNodeHTTPServerSocketPrototype) };

static const JSC::HashTableValue JSNodeHTTPServerSocketPrototypeTableValues[] = {
    { "onclose"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), JSC::NoIntrinsic, { JSC::HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterOnClose, jsNodeHttpServerSocketSetterOnClose } },
    { "ondrain"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), JSC::NoIntrinsic, { JSC::HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterOnDrain, jsNodeHttpServerSocketSetterOnDrain } },
    { "ondata"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), JSC::NoIntrinsic, { JSC::HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterOnData, jsNodeHttpServerSocketSetterOnData } },
    { "bytesWritten"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), JSC::NoIntrinsic, { JSC::HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterBytesWritten, noOpSetter } },
    { "closed"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly), JSC::NoIntrinsic, { JSC::HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterClosed, noOpSetter } },
    { "response"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly), JSC::NoIntrinsic, { JSC::HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterResponse, noOpSetter } },
    { "duplex"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), JSC::NoIntrinsic, { JSC::HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterDuplex, jsNodeHttpServerSocketSetterDuplex } },
    { "remoteAddress"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly), JSC::NoIntrinsic, { JSC::HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterRemoteAddress, noOpSetter } },
    { "localAddress"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly), JSC::NoIntrinsic, { JSC::HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterLocalAddress, noOpSetter } },
    { "close"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontEnum), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsFunctionNodeHTTPServerSocketClose, 0 } },
    { "write"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontEnum), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsFunctionNodeHTTPServerSocketWrite, 2 } },
    { "end"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontEnum), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsFunctionNodeHTTPServerSocketEnd, 0 } },
    { "upgradeToTunnel"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontEnum), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsFunctionNodeHTTPServerSocketUpgradeToTunnel, 0 } },
    { "setResponseTrailers"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontEnum), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsFunctionNodeHTTPServerSocketSetResponseTrailers, 1 } },
    { "isRequestTimedOut"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontEnum), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsFunctionNodeHTTPServerSocketIsRequestTimedOut, 2 } },
    { "startPipelinedResponse"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontEnum), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsFunctionNodeHTTPServerSocketStartPipelinedResponse, 3 } },
    { "stopParsing"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontEnum), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsFunctionNodeHTTPServerSocketStopParsing, 0 } },
    { "secureEstablished"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly), JSC::NoIntrinsic, { JSC::HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterIsSecureEstablished, noOpSetter } },
    { "servername"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly), JSC::NoIntrinsic, { JSC::HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterServername, noOpSetter } },
    { "authorizationError"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly), JSC::NoIntrinsic, { JSC::HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterAuthorizationError, noOpSetter } },
};

void JSNodeHTTPServerSocketPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    reifyStaticProperties(vm, info(), JSNodeHTTPServerSocketPrototypeTableValues, *this);
    this->structure()->setMayBePrototype(true);
}

// Implementation of host functions
JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketClose, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsUndefined());
    }
    if (thisObject->isClosed()) {
        return JSValue::encode(JSC::jsUndefined());
    }
    thisObject->close();

    return JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketUpgradeToTunnel, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsUndefined());
    }
    // upgradeToTunnel(afterBody): with a truthy argument the switch happens only
    // once the request body has been fully parsed (Upgrade requests with a body).
    thisObject->upgradeToTunnelMode(callFrame->argument(0).toBoolean(globalObject));
    return JSValue::encode(JSC::jsUndefined());
}

// node:http: set the trailer fields (pre-rendered "name: value\r\n" lines) to send
// at the end of the current response's chunked body (response.addTrailers()).
JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketSetResponseTrailers, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsUndefined());
    }
    JSValue trailersValue = callFrame->argument(0);
    if (!trailersValue.isString()) {
        return JSValue::encode(JSC::jsUndefined());
    }
    WTF::String trailers = trailersValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    thisObject->setResponseTrailers(trailers);
    return JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketIsRequestTimedOut, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsBoolean(false));
    }

    double headersTimeout = callFrame->argument(0).toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    double requestTimeout = callFrame->argument(1).toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // The caller passes validated non-negative integers (server option
    // validation), but the properties can be reassigned at runtime without
    // re-validation, so clamp before the cast. 18446744073709549568.0 is the
    // largest double strictly < 2^64; static_cast<uint64_t> on anything >= 2^64
    // is UB ([conv.fpint]/1), and the literal 2^64-1 rounds up to 2^64 as a
    // double, so it cannot be used as the clamp.
    constexpr double kMaxDoubleBelowU64 = 18446744073709549568.0;
    uint64_t headersTimeoutMs = std::isfinite(headersTimeout) && headersTimeout > 0 ? static_cast<uint64_t>(std::min(headersTimeout, kMaxDoubleBelowU64)) : 0;
    uint64_t requestTimeoutMs = std::isfinite(requestTimeout) && requestTimeout > 0 ? static_cast<uint64_t>(std::min(requestTimeout, kMaxDoubleBelowU64)) : 0;

    return JSValue::encode(JSC::jsBoolean(thisObject->isRequestTimedOut(headersTimeoutMs, requestTimeoutMs)));
}

// node:http HTTP/1.1 pipelining: make a queued pipelined response the
// connection's current response right before its buffered output is flushed.
// Arguments: (responseHandle, isAncient, connectionClose). Returns false when
// the connection is already gone.
JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketStartPipelinedResponse, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsBoolean(false));
    }
    auto* response = dynamicDowncast<WebCore::JSNodeHTTPResponse>(callFrame->argument(0));
    if (!response) [[unlikely]] {
        return JSValue::encode(JSC::jsBoolean(false));
    }
    bool isAncient = callFrame->argument(1).toBoolean(globalObject);
    bool connectionClose = callFrame->argument(2).toBoolean(globalObject);
    return JSValue::encode(JSC::jsBoolean(thisObject->startPipelinedResponse(vm, response, isAncient, connectionClose)));
}

// node:http: stop parsing further HTTP requests on this connection (the user
// emitted 'close' on the socket - Node frees the parser there).
JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketStopParsing, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(callFrame->thisValue());
    if (thisObject) [[likely]] {
        thisObject->stopHTTPParsing();
    }
    return JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketWrite, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsNumber(0));
    }
    if (thisObject->isClosed() || thisObject->ended) {
        return JSValue::encode(JSC::jsNumber(0));
    }

    // The ctx spills a >16KB res.write()'s zero-copy tail (which
    // AsyncSocket::write cannot see) into AsyncSocketData::buffer after the
    // data/encoding coercion has run, so the raw bytes below land after it.
    auto* res = thisObject->currentResponseObject.get();
    void* responseCtx = (res != nullptr) ? res->m_ctx : nullptr;
    return us_socket_buffered_js_write(thisObject->socket, thisObject->is_ssl, thisObject->ended, &thisObject->streamBuffer, responseCtx, globalObject, JSValue::encode(callFrame->argument(0)), JSValue::encode(callFrame->argument(1)));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketEnd, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsUndefined());
    }
    if (thisObject->isClosed()) {
        return JSValue::encode(JSC::jsUndefined());
    }

    thisObject->ended = true;
    // The response's buffered body must reach the kernel before the FIN; uWS
    // performs the shutdown after its send buffer drains. A >16KB res.write()'s
    // zero-copy tail is not counted in getBufferedAmount(), so spill it into
    // AsyncSocketData::buffer first or shutdownAfterResponseDrains() would see
    // zero and FIN ahead of it.
    auto* res = thisObject->currentResponseObject.get();
    void* responseCtx = (res != nullptr) ? res->m_ctx : nullptr;
    if (responseCtx != nullptr) {
        Bun__NodeHTTPResponse_spillPendingPinnedWrite(responseCtx);
    }
    if (thisObject->shutdownAfterResponseDrains()) {
        return JSValue::encode(JSC::jsUndefined());
    }
    // onNodeHTTPRequest no longer pauses at dispatch; pause here so the
    // shutdown+resume below still cycles kqueue's EVFILT_READ (delete then
    // re-add), without which macOS 26 does not deliver the peer's close.
    if (thisObject->socket && !thisObject->upgraded) {
        us_socket_pause(thisObject->socket);
    }
    auto result = us_socket_buffered_js_write(thisObject->socket, thisObject->is_ssl, thisObject->ended, &thisObject->streamBuffer, responseCtx, globalObject, JSValue::encode(JSC::jsUndefined()), JSValue::encode(JSC::jsUndefined()));
    // Undo the pause above after the shutdown so the unread body drains
    // and kqueue's one-shot EVFILT_WRITE (which delivers EV_EOF on
    // SHUT_WR) is not deleted by a W -> R|W -> R step.
    if (thisObject->socket && !thisObject->upgraded) {
        us_socket_resume(thisObject->socket);
    }
    return result;
}

// Implementation of custom getters
JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterIsSecureEstablished, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsUndefined());
    }
    return JSValue::encode(JSC::jsBoolean(thisObject->isAuthorized()));
}

// SNI hostname the client sent, as a string; null when not TLS / no SNI.
JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterServername, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsUndefined());
    }
    const char* servername = thisObject->sniServername();
    if (!servername || !*servername) {
        return JSValue::encode(JSC::jsNull());
    }
    return JSValue::encode(JSC::jsString(globalObject->vm(), WTF::String::fromUTF8(servername)));
}

// X.509 verification error code for the peer certificate; null when verified
// (or when there is nothing to verify).
JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterAuthorizationError, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsUndefined());
    }
    const char* code = thisObject->peerCertificateVerificationError();
    if (!code) {
        return JSValue::encode(JSC::jsNull());
    }
    return JSValue::encode(JSC::jsString(globalObject->vm(), WTF::String::fromLatin1(code)));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterDuplex, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsUndefined());
    }
    if (thisObject->m_duplex) {
        return JSValue::encode(thisObject->m_duplex.get());
    }
    return JSValue::encode(JSC::jsNull());
}

JSC_DEFINE_CUSTOM_SETTER(jsNodeHttpServerSocketSetterDuplex, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, JSC::PropertyName propertyName))
{
    auto& vm = globalObject->vm();
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return false;
    }
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
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsUndefined());
    }
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
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsUndefined());
    }
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
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsUndefined());
    }

    if (thisObject->functionToCallOnClose) {
        return JSValue::encode(thisObject->functionToCallOnClose.get());
    }

    return JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterOnDrain, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsUndefined());
    }

    if (thisObject->functionToCallOnDrain) {
        return JSValue::encode(thisObject->functionToCallOnDrain.get());
    }

    return JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_CUSTOM_SETTER(jsNodeHttpServerSocketSetterOnDrain, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, JSC::PropertyName propertyName))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return false;
    }
    JSValue value = JSC::JSValue::decode(encodedValue);

    if (value.isUndefined() || value.isNull()) {
        thisObject->functionToCallOnDrain.clear();
        return true;
    }

    if (!value.isCallable()) {
        return false;
    }

    thisObject->functionToCallOnDrain.set(vm, thisObject, value.getObject());
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterOnData, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsUndefined());
    }

    if (thisObject->functionToCallOnData) {
        return JSValue::encode(thisObject->functionToCallOnData.get());
    }

    return JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_CUSTOM_SETTER(jsNodeHttpServerSocketSetterOnData, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, JSC::PropertyName propertyName))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return false;
    }
    JSValue value = JSC::JSValue::decode(encodedValue);

    if (value.isUndefined() || value.isNull()) {
        thisObject->functionToCallOnData.clear();
        return true;
    }

    if (!value.isCallable()) {
        return false;
    }

    thisObject->functionToCallOnData.set(vm, thisObject, value.getObject());
    return true;
}

JSC_DEFINE_CUSTOM_SETTER(jsNodeHttpServerSocketSetterOnClose, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, JSC::PropertyName propertyName))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return false;
    }
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

JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterClosed, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName propertyName))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsUndefined());
    }
    return JSValue::encode(JSC::jsBoolean(thisObject->isClosed()));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterBytesWritten, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName propertyName))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsUndefined());
    }
    return JSValue::encode(JSC::jsNumber(thisObject->streamBuffer.totalBytesWritten()));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterResponse, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName propertyName))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsUndefined());
    }
    if (!thisObject->currentResponseObject) {
        return JSValue::encode(JSC::jsNull());
    }

    return JSValue::encode(thisObject->currentResponseObject.get());
}

} // namespace Bun
