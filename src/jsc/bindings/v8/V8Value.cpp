#include "V8Value.h"
#include "V8Isolate.h"
#include "V8String.h"
#include "V8Integer.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"
#include "napi_external.h"
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSBigInt.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/MathCommon.h>

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Value)

namespace v8 {

bool Value::IsBoolean() const
{
    return localToJSValue().isBoolean();
}

bool Value::IsObject() const
{
    return localToJSValue().isObject();
}

bool Value::IsNumber() const
{
    return localToJSValue().isNumber();
}

bool Value::IsUint32() const
{
    return localToJSValue().isUInt32AsAnyInt();
}

bool Value::IsUndefined() const
{
    return localToJSValue().isUndefined();
}

// The QuickIs* functions are V8_INLINE with out-of-class bodies in
// v8-value.h. MSVC debug builds (/Ob0) import such members of a dllimport
// class instead of emitting them, so addons compiled --debug on Windows
// need them as real exports. Semantically they are the corresponding Is*
// checks (the "quick" part only matters for real V8's object layout).
bool Value::QuickIsUndefined() const
{
    return localToJSValue().isUndefined();
}

bool Value::QuickIsNull() const
{
    return localToJSValue().isNull();
}

bool Value::QuickIsNullOrUndefined() const
{
    return localToJSValue().isUndefinedOrNull();
}

bool Value::QuickIsString() const
{
    return localToJSValue().isString();
}

bool Value::IsNull() const
{
    return localToJSValue().isNull();
}

bool Value::IsNullOrUndefined() const
{
    return localToJSValue().isUndefinedOrNull();
}

bool Value::IsTrue() const
{
    return FullIsTrue();
}

bool Value::IsFalse() const
{
    return FullIsFalse();
}

bool Value::IsString() const
{
    return localToJSValue().isString();
}

bool Value::IsFunction() const
{
    return JSC::jsTypeofIsFunction(defaultGlobalObject(), localToJSValue());
}

bool Value::IsMap() const
{
    JSC::JSValue value = localToJSValue();
    return value.isCell() && value.inherits<JSC::JSMap>();
}

bool Value::IsArray() const
{
    // V8's IsArray is a JS_ARRAY_TYPE instance check that never unwraps proxies
    // and cannot throw, so use a JSArray type check (ArrayType/DerivedArrayType)
    // rather than JSC::isArray (spec IsArray: proxy-transparent, may throw).
    JSC::JSValue value = localToJSValue();
    return value.isCell() && value.inherits<JSC::JSArray>();
}

bool Value::IsInt32() const
{
    return localToJSValue().isInt32AsAnyInt();
}

bool Value::IsBigInt() const
{
    return localToJSValue().isBigInt();
}

bool Value::IsUint8Array() const
{
    JSC::JSValue value = localToJSValue();
    return value.isCell() && value.inherits<JSC::JSUint8Array>();
}

// Like IsArray, the next four are instance type checks in V8 that never unwrap a Proxy.
bool Value::IsExternal() const
{
    JSC::JSValue value = localToJSValue();
    return value.isCell() && value.inherits<Bun::NapiExternal>();
}

// JSC has one cell type for ArrayBuffer and SharedArrayBuffer.
bool Value::IsArrayBuffer() const
{
    auto* buffer = dynamicDowncast<JSC::JSArrayBuffer>(localToJSValue());
    return buffer && !buffer->isShared();
}

bool Value::IsArrayBufferView() const
{
    JSC::JSValue value = localToJSValue();
    return value.isCell() && value.inherits<JSC::JSArrayBufferView>();
}

bool Value::IsSharedArrayBuffer() const
{
    auto* buffer = dynamicDowncast<JSC::JSArrayBuffer>(localToJSValue());
    return buffer && buffer->isShared();
}

MaybeLocal<String> Value::ToString(Local<Context> context) const
{
    Zig::GlobalObject* globalObject = context->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSC::JSString* jsString = localToJSValue().toString(globalObject);
    RETURN_IF_EXCEPTION(scope, MaybeLocal<String>());

    return MaybeLocal<String>(context->currentHandleScope()->createLocal<String>(vm, jsString));
}

MaybeLocal<Integer> Value::ToInteger(Local<Context> context) const
{
    Zig::GlobalObject* globalObject = context->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    double d = localToJSValue().toIntegerOrInfinity(globalObject);
    RETURN_IF_EXCEPTION(scope, MaybeLocal<Integer>());

    return MaybeLocal<Integer>(context->currentHandleScope()->createLocal<Integer>(vm, JSC::jsNumber(d)));
}

MaybeLocal<Int32> Value::ToInt32(Local<Context> context) const
{
    Zig::GlobalObject* globalObject = context->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    int32_t i = localToJSValue().toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, MaybeLocal<Int32>());

    return MaybeLocal<Int32>(context->currentHandleScope()->createLocal<Int32>(vm, JSC::jsNumber(i)));
}

Maybe<uint32_t> Value::Uint32Value(Local<Context> context) const
{
    auto js_value = localToJSValue();
    // Like V8, a number converts even while an exception is pending.
    if (js_value.isInt32()) {
        return Just(static_cast<uint32_t>(js_value.asInt32()));
    }
    if (js_value.isDouble()) {
        return Just(JSC::toUInt32(js_value.asDouble()));
    }

    Maybe<double> number = NumberValue(context);
    if (!number.m_hasValue) {
        return Nothing<uint32_t>();
    }

    // V8 gives 0 when a non-number converts to a negative Smi: https://github.com/nodejs/node/blob/v26.3.0/deps/v8/src/objects/objects.cc#L405-L413
    if (auto smi = tryConvertToStrictInt32(number.m_value); smi && *smi < 0) {
        return Just<uint32_t>(0);
    }
    return Just(JSC::toUInt32(number.m_value));
}

Maybe<int32_t> Value::Int32Value(Local<Context> context) const
{
    auto js_value = localToJSValue();
    if (js_value.isInt32()) {
        return Just(js_value.asInt32());
    }

    Maybe<double> number = NumberValue(context);
    if (!number.m_hasValue) {
        return Nothing<int32_t>();
    }
    return Just(JSC::toInt32(number.m_value));
}

Maybe<double> Value::NumberValue(Local<Context> context) const
{
    JSC::JSValue value = localToJSValue();
    // Like V8, a number converts even while an exception is pending.
    if (value.isNumber()) {
        return Just(value.asNumber());
    }

    Zig::GlobalObject* globalObject = context->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    // JSC cannot run JS while an exception is pending.
    RETURN_IF_EXCEPTION(scope, Nothing<double>());

    double number = value.toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, Nothing<double>());

    return Just(number);
}

bool Value::BooleanValue(Isolate* isolate) const
{
    return localToJSValue().toBoolean(isolate->globalObject());
}

bool Value::StrictEquals(Local<Value> that) const
{
    JSC::JSValue thisValue = localToJSValue();
    JSC::JSValue thatValue = that->localToJSValue();
    auto* globalObject = v8::Isolate::GetCurrent()->globalObject();
    auto& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    bool result = JSC::JSValue::strictEqual(globalObject, thisValue, thatValue);
    RETURN_IF_EXCEPTION(scope, false);

    return result;
}

bool Value::FullIsTrue() const
{
    return localToJSValue().isTrue();
}

bool Value::FullIsFalse() const
{
    return localToJSValue().isFalse();
}

} // namespace v8
