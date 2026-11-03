#include "JSNodeHTTPServerSocketPrototype.h"
#include "JSNodeHTTPServerSocket.h"
#include "AsyncContextFrame.h"
#include "ZigGlobalObject.h"
#include "helpers.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <wtf/text/WTFString.h>
#include <cmath>

extern "C" JSC::EncodedJSValue Bun__socketReadErrorFromCloseCode(JSC::JSGlobalObject* globalObject, int code);

namespace Bun {

using namespace JSC;
using namespace WebCore;

// onclose continues the Bun.ModuleGraph whose script set it, if one did. Reading it back gives the function that was set.
static JSValue storedCallback(JSObject* stored)
{
    if (auto* wrapper = dynamicDowncast<AsyncContextFrame>(stored))
        return wrapper->callback.get();
    return stored;
}

// Declare custom getters/setters and host functions
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterOnClose);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterClosed);
JSC_DECLARE_CUSTOM_SETTER(jsNodeHttpServerSocketSetterOnClose);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketClose);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketLeaveHttpAfterBody);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketSetRawReads);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketSetResponseTrailers);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketIsRequestTimedOut);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketStartRawResponse);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketStopParsing);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketFinishParsing);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketDetachParser);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketCloseIfIdle);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterResponse);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterDuplex);
JSC_DECLARE_CUSTOM_SETTER(jsNodeHttpServerSocketSetterDuplex);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterCloseError);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterPeerEnded);
JSC_DECLARE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterFinSent);
JSC_DECLARE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketLeaveHttp);

JSC_DEFINE_CUSTOM_SETTER(noOpSetter, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    return false;
}

const JSC::ClassInfo JSNodeHTTPServerSocketPrototype::s_info = { "NodeHTTPServerSocket"_s, &Base::s_info, nullptr, nullptr,
    CREATE_METHOD_TABLE(JSNodeHTTPServerSocketPrototype) };

static const JSC::HashTableValue JSNodeHTTPServerSocketPrototypeTableValues[] = {
    { "onclose"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), JSC::NoIntrinsic, { JSC::HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterOnClose, jsNodeHttpServerSocketSetterOnClose } },
    { "closed"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly), JSC::NoIntrinsic, { JSC::HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterClosed, noOpSetter } },
    { "response"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly), JSC::NoIntrinsic, { JSC::HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterResponse, noOpSetter } },
    { "duplex"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), JSC::NoIntrinsic, { JSC::HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterDuplex, jsNodeHttpServerSocketSetterDuplex } },
    { "close"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontEnum), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsFunctionNodeHTTPServerSocketClose, 0 } },
    { "leaveHttpAfterBody"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontEnum), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsFunctionNodeHTTPServerSocketLeaveHttpAfterBody, 0 } },
    { "setRawReads"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontEnum), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsFunctionNodeHTTPServerSocketSetRawReads, 1 } },
    { "setResponseTrailers"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontEnum), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsFunctionNodeHTTPServerSocketSetResponseTrailers, 1 } },
    { "isRequestTimedOut"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontEnum), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsFunctionNodeHTTPServerSocketIsRequestTimedOut, 2 } },
    { "startRawResponse"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontEnum), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsFunctionNodeHTTPServerSocketStartRawResponse, 2 } },
    { "stopParsing"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontEnum), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsFunctionNodeHTTPServerSocketStopParsing, 0 } },
    { "detachParser"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontEnum), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsFunctionNodeHTTPServerSocketDetachParser, 0 } },
    { "finishParsing"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontEnum), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsFunctionNodeHTTPServerSocketFinishParsing, 0 } },
    { "closeIfIdle"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontEnum), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsFunctionNodeHTTPServerSocketCloseIfIdle, 0 } },
    { "closeError"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly), JSC::NoIntrinsic, { JSC::HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterCloseError, noOpSetter } },
    { "peerEnded"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly), JSC::NoIntrinsic, { JSC::HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterPeerEnded, noOpSetter } },
    { "finSent"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly), JSC::NoIntrinsic, { JSC::HashTableValue::GetterSetterType, jsNodeHttpServerSocketGetterFinSent, noOpSetter } },
    { "leaveHttp"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::DontEnum), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsFunctionNodeHTTPServerSocketLeaveHttp, 1 } },
};

void JSNodeHTTPServerSocketPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    Bun::reifyStaticPropertyTable(vm, info(), JSNodeHTTPServerSocketPrototypeTableValues, *this);
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

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketLeaveHttp, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(callFrame->thisValue());
    return JSValue::encode(JSC::jsBoolean(thisObject && thisObject->leaveHttp(callFrame->argument(0).isTrue())));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketLeaveHttpAfterBody, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    if (auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(callFrame->thisValue())) [[likely]] {
        thisObject->leaveHttpAfterBody();
    }
    return JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketSetRawReads, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    if (auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(callFrame->thisValue())) [[likely]] {
        thisObject->setRawReads(callFrame->argument(0).isTrue());
    }
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

// (responseHandle, connectionClose). Returns false if the connection is gone or didn't queue that response.
JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketStartRawResponse, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(callFrame->thisValue());
    auto* response = dynamicDowncast<JSNodeHTTPResponse>(callFrame->argument(0));
    if (!thisObject || !response) [[unlikely]] {
        return JSValue::encode(JSC::jsBoolean(false));
    }
    return JSValue::encode(JSC::jsBoolean(thisObject->startRawResponse(globalObject->vm(), response, callFrame->argument(1).toBoolean(globalObject))));
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

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketDetachParser, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    if (auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(callFrame->thisValue())) [[likely]] {
        thisObject->detachParser();
    }
    return JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketFinishParsing, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(callFrame->thisValue());
    return JSValue::encode(JSC::jsBoolean(thisObject && thisObject->finishParsing()));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionNodeHTTPServerSocketCloseIfIdle, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(callFrame->thisValue());
    return JSValue::encode(JSC::jsBoolean(thisObject && thisObject->closeIfIdle()));
}

// The error of the read that closed the connection (`read ECONNRESET` for a peer RST), or undefined.
JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterCloseError, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(JSC::JSValue::decode(thisValue));
    if (!thisObject || !thisObject->closeReadError) {
        return JSValue::encode(JSC::jsUndefined());
    }
    return Bun__socketReadErrorFromCloseCode(globalObject, thisObject->closeReadError);
}

JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterPeerEnded, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsUndefined());
    }
    return JSValue::encode(JSC::jsBoolean(thisObject->peer_ended));
}

// The FIN of socket.end() has left. It waits for bytes that are still queued.
JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterFinSent, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsUndefined());
    }
    return JSValue::encode(JSC::jsBoolean(thisObject->finSent()));
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

JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterOnClose, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsUndefined());
    }

    if (thisObject->functionToCallOnClose) {
        return JSValue::encode(storedCallback(thisObject->functionToCallOnClose.get()));
    }

    return JSValue::encode(JSC::jsUndefined());
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

    thisObject->functionToCallOnClose.set(vm, thisObject, AsyncContextFrame::withGraphContextIfNeeded(globalObject, value).getObject());
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

JSC_DEFINE_CUSTOM_GETTER(jsNodeHttpServerSocketGetterResponse, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName propertyName))
{
    auto* thisObject = dynamicDowncast<JSNodeHTTPServerSocket>(JSC::JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(JSC::jsUndefined());
    }
    auto* response = thisObject->currentResponse();
    if (!response) {
        return JSValue::encode(JSC::jsNull());
    }

    return JSValue::encode(response);
}

} // namespace Bun
