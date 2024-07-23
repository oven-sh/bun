#include "v8/Number.h"

namespace v8 {

Local<Number> Number::New(Isolate* isolate, double value)
{
    return JSC::jsDoubleNumber(value);
}

double Number::Value() const
{
    return toJSValue().asNumber();
}

}
