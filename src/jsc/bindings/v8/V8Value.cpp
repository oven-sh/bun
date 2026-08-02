#include "V8Value.h"
#include "V8Isolate.h"
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

Maybe<uint32_t> Value::Uint32Value(Local<Context> context) const
{
    JSC::JSValue js_value = localToJSValue();
    if (js_value.isInt32()) {
        return Just(static_cast<uint32_t>(js_value.asInt32()));
    }
    if (js_value.isDouble()) {
        return Just(JSC::toUInt32(js_value.asDouble()));
    }
    Zig::GlobalObject* globalObject = context->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    uint32_t value = js_value.toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, Nothing<uint32_t>());
    return Just(value);
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
