#include "V8Value.h"
#include "V8Isolate.h"

namespace v8 {

bool Value::IsBoolean() const
{
    return localToJSValue(Isolate::GetCurrent()->globalInternals()).isBoolean();
}

bool Value::IsObject() const
{
    return localToJSValue(Isolate::GetCurrent()->globalInternals()).isObject();
}

bool Value::IsNumber() const
{
    return localToJSValue(Isolate::GetCurrent()->globalInternals()).isNumber();
}

bool Value::IsUint32() const
{
    return localToJSValue(Isolate::GetCurrent()->globalInternals()).isUInt32();
}

Maybe<uint32_t> Value::Uint32Value(Local<Context> context) const
{
    auto js_value = localToJSValue(context->globalObject()->V8GlobalInternals());
    uint32_t value;
    if (js_value.getUInt32(value)) {
        return Just(value);
    }
    return Nothing<uint32_t>();
}

bool Value::FullIsTrue() const
{
    return localToJSValue(Isolate::GetCurrent()->globalInternals()).isTrue();
}

bool Value::FullIsFalse() const
{
    return localToJSValue(Isolate::GetCurrent()->globalInternals()).isFalse();
}

}
