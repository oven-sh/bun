#include "V8Value.h"
#include "V8Isolate.h"
#include "V8HandleScope.h"
#include "V8Boolean.h"
#include "V8Number.h"
#include "V8Integer.h"
#include "V8String.h"
#include "V8Object.h"
#include "v8_compatibility_assertions.h"
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSBigInt.h>

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
    JSC::JSValue value = localToJSValue();
    if (!value.isObject()) {
        return false;
    }
    return JSC::isArray(defaultGlobalObject(), value);
}

bool Value::IsInt32() const
{
    return localToJSValue().isInt32AsAnyInt();
}

bool Value::IsBigInt() const
{
    return localToJSValue().isBigInt();
}

Maybe<uint32_t> Value::Uint32Value(Local<Context> context) const
{
    auto js_value = localToJSValue();
    uint32_t value;
    if (js_value.getUInt32(value)) {
        return Just(value);
    }
    return Nothing<uint32_t>();
}

Maybe<int32_t> Value::Int32Value(Local<Context> context) const
{
    Zig::GlobalObject* globalObject = context->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    int32_t result = localToJSValue().toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, Nothing<int32_t>());
    return Just(result);
}

Maybe<int64_t> Value::IntegerValue(Local<Context> context) const
{
    Zig::GlobalObject* globalObject = context->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    double d = localToJSValue().toIntegerPreserveNaN(globalObject);
    RETURN_IF_EXCEPTION(scope, Nothing<int64_t>());
    // Match V8's NumberToInt64: clamp before the cast so Infinity/1e300 don't
    // hit undefined behavior in static_cast<int64_t>.
    if (std::isnan(d)) {
        return Just(static_cast<int64_t>(0));
    }
    if (d >= static_cast<double>(std::numeric_limits<int64_t>::max())) {
        return Just(std::numeric_limits<int64_t>::max());
    }
    if (d <= static_cast<double>(std::numeric_limits<int64_t>::min())) {
        return Just(std::numeric_limits<int64_t>::min());
    }
    return Just(static_cast<int64_t>(d));
}

Maybe<double> Value::NumberValue(Local<Context> context) const
{
    Zig::GlobalObject* globalObject = context->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    double result = localToJSValue().toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, Nothing<double>());
    return Just(result);
}

bool Value::BooleanValue(Isolate* isolate) const
{
    return localToJSValue().toBoolean(isolate->globalObject());
}

Local<Boolean> Value::ToBoolean(Isolate* isolate) const
{
    bool b = localToJSValue().toBoolean(isolate->globalObject());
    return isolate->currentHandleScope()->createLocal<Boolean>(isolate->vm(), JSC::jsBoolean(b));
}

MaybeLocal<String> Value::ToString(Local<Context> context) const
{
    Zig::GlobalObject* globalObject = context->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSString* result = localToJSValue().toString(globalObject);
    RETURN_IF_EXCEPTION(scope, MaybeLocal<String>());
    return context->currentHandleScope()->createLocal<String>(vm, result);
}

MaybeLocal<String> Value::ToDetailString(Local<Context> context) const
{
    return ToString(context);
}

MaybeLocal<Number> Value::ToNumber(Local<Context> context) const
{
    Zig::GlobalObject* globalObject = context->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    double result = localToJSValue().toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, MaybeLocal<Number>());
    return context->currentHandleScope()->createLocal<Number>(vm, JSC::jsNumber(JSC::purifyNaN(result)));
}

MaybeLocal<Object> Value::ToObject(Local<Context> context) const
{
    Zig::GlobalObject* globalObject = context->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSObject* result = localToJSValue().toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, MaybeLocal<Object>());
    return context->currentHandleScope()->createLocal<Object>(vm, result);
}

MaybeLocal<Integer> Value::ToInteger(Local<Context> context) const
{
    Zig::GlobalObject* globalObject = context->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    double d = localToJSValue().toIntegerPreserveNaN(globalObject);
    RETURN_IF_EXCEPTION(scope, MaybeLocal<Integer>());
    if (std::isnan(d)) {
        d = 0;
    }
    return context->currentHandleScope()->createLocal<Integer>(vm, JSC::jsNumber(d));
}

MaybeLocal<Int32> Value::ToInt32(Local<Context> context) const
{
    Zig::GlobalObject* globalObject = context->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    int32_t result = localToJSValue().toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, MaybeLocal<Int32>());
    return context->currentHandleScope()->createLocal<Int32>(vm, JSC::jsNumber(result));
}

MaybeLocal<Uint32> Value::ToUint32(Local<Context> context) const
{
    Zig::GlobalObject* globalObject = context->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    uint32_t result = localToJSValue().toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, MaybeLocal<Uint32>());
    return context->currentHandleScope()->createLocal<Uint32>(vm, JSC::jsNumber(result));
}

bool Value::StrictEquals(Local<Value> that) const
{
    JSC::JSValue thisValue = localToJSValue();
    JSC::JSValue thatValue = that->localToJSValue();
    auto* globalObject = v8::Isolate::GetCurrent()->globalObject();
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

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
