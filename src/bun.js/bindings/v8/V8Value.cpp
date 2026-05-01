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
