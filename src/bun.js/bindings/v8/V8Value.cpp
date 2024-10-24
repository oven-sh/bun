#include "V8Value.h"
#include "V8Isolate.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"

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

bool Value::IsInt32() const
{
    return localToJSValue().isInt32AsAnyInt();
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

bool Value::IsArray() const
{
    JSC::JSValue val = localToJSValue();
    return val.isCell() && val.asCell()->type() == JSC::ArrayType;
}

Maybe<uint32_t> Value::Uint32Value(Local<Context> context) const
{
    auto js_value = localToJSValue();
    auto scope = DECLARE_THROW_SCOPE(context->vm());
    uint32_t num = js_value.toUInt32(context->globalObject());
    RETURN_IF_EXCEPTION(scope, Nothing<uint32_t>());
    RELEASE_AND_RETURN(scope, Just(num));
}

Maybe<double> Value::NumberValue(Local<Context> context) const
{
    auto js_value = localToJSValue();
    auto scope = DECLARE_THROW_SCOPE(context->vm());
    double num = js_value.toNumber(context->globalObject());
    RETURN_IF_EXCEPTION(scope, Nothing<double>());
    RELEASE_AND_RETURN(scope, Just(num));
}

MaybeLocal<String> Value::ToString(Local<Context> context) const
{
    auto js_value = localToJSValue();
    auto& vm = context->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSString* string = js_value.toStringOrNull(context->globalObject());
    RETURN_IF_EXCEPTION(scope, MaybeLocal<String>());
    RELEASE_AND_RETURN(scope,
        MaybeLocal<String>(context->currentHandleScope()->createLocal<String>(vm, string)));
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
