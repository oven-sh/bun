#include "JSNodeHTTPServerSocketPrototype.h"
#include "JSNodeHTTPServerSocket.h"
#include "JSSocketAddressDTO.h"
#include "ZigGlobalObject.h"
#include "ZigGeneratedClasses.h"
#include "helpers.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <wtf/text/WTFString.h>

extern "C" EncodedJSValue us_socket_buffered_js_write(void* socket, bool is_ssl, bool ended, us_socket_stream_buffer_t* streamBuffer, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue data, JSC::EncodedJSValue encoding);
extern "C" uint64_t uws_res_get_remote_address_info(void* res, const char** dest, int* port, bool* is_ipv6);
extern "C" uint64_t uws_res_get_local_address_info(void* res, const char** dest, int* port, bool* is_ipv6);

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
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterResponse);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterRemoteAddress);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterLocalAddress);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterDuplex);
JSC_DECLARE_CUSTOM_SETTER(jsNodeHttpServerSocketSetterDuplex);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterIsSecureEstablished);

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
    { "secureEstablished"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly), JSC::NoIntrinsic, { JSC::HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterIsSecureEstablished, noOpSetter } },
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
    auto* thisObject = jsDynamicCast<JSNodeHTTPServerSocket*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsUndefined());
    }
    if (thisObject->isClosed()) {
        return JSValue::encode(JSC::jsUndefined());
    }
    thisObject->close();

    return JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketWrite, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* thisObject = jsDynamicCast<JSNodeHTTPServerSocket*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsNumber(0));
    }
    if (thisObject->isClosed() || thisObject->ended) {
        return JSValue::encode(JSC::jsNumber(0));
    }

    return us_socket_buffered_js_write(thisObject->socket, thisObject->is_ssl, thisObject->ended, &thisObject->streamBuffer, globalObject, JSValue::encode(callFrame->argument(0)), JSValue::encode(callFrame->argument(1)));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketEnd, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* thisObject = jsDynamicCast<JSNodeHTTPServerSocket*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsUndefined());
    }
    if (thisObject->isClosed()) {
        return JSValue::encode(JSC::jsUndefined());
    }

    thisObject->ended = true;
    auto bufferedSize = thisObject->streamBuffer.bufferedSize();
    if (bufferedSize == 0) {
        return us_socket_buffered_js_write(thisObject->socket, thisObject->is_ssl, thisObject->ended, &thisObject->streamBuffer, globalObject, JSValue::encode(JSC::jsUndefined()), JSValue::encode(JSC::jsUndefined()));
    }
    return JSValue::encode(JSC::jsUndefined());
}

// Implementation of custom getters
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

JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterOnDrain, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = jsCast<JSNodeHTTPServerSocket*>(JSC::JSValue::decode(thisValue));

    if (thisObject->functionToCallOnDrain) {
        return JSValue::encode(thisObject->functionToCallOnDrain.get());
    }

    return JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_CUSTOM_SETTER(jsNodeHttpServerSocketSetterOnDrain, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, JSC::PropertyName propertyName))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsCast<JSNodeHTTPServerSocket*>(JSC::JSValue::decode(thisValue));
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
    auto* thisObject = jsCast<JSNodeHTTPServerSocket*>(JSC::JSValue::decode(thisValue));

    if (thisObject->functionToCallOnData) {
        return JSValue::encode(thisObject->functionToCallOnData.get());
    }

    return JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_CUSTOM_SETTER(jsNodeHttpServerSocketSetterOnData, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, JSC::PropertyName propertyName))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsCast<JSNodeHTTPServerSocket*>(JSC::JSValue::decode(thisValue));
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

JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterClosed, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName propertyName))
{
    auto* thisObject = jsCast<JSNodeHTTPServerSocket*>(JSC::JSValue::decode(thisValue));
    return JSValue::encode(JSC::jsBoolean(thisObject->isClosed()));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterBytesWritten, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName propertyName))
{
    auto* thisObject = jsCast<JSNodeHTTPServerSocket*>(JSC::JSValue::decode(thisValue));
    return JSValue::encode(JSC::jsNumber(thisObject->streamBuffer.totalBytesWritten()));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterResponse, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName propertyName))
{
    auto* thisObject = jsCast<JSNodeHTTPServerSocket*>(JSC::JSValue::decode(thisValue));
    if (!thisObject->currentResponseObject) {
        return JSValue::encode(JSC::jsNull());
    }

    return JSValue::encode(thisObject->currentResponseObject.get());
}

} // namespace Bun
