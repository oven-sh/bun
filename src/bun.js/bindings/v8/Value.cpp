#include "v8/Value.h"
#include "v8/Isolate.h"

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

bool Value::FullIsTrue() const
{
    return localToJSValue(Isolate::GetCurrent()->globalInternals()).isTrue();
}

bool Value::FullIsFalse() const
{
    return localToJSValue(Isolate::GetCurrent()->globalInternals()).isFalse();
}

}
