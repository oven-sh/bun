#include "V8Number.h"
#include "V8HandleScope.h"

namespace v8 {

Local<Number> Number::New(Isolate* isolate, double value)
{
    return isolate->currentHandleScope()->createLocal<Number>(isolate->vm(), JSC::jsNumber(value));
}

double Number::Value() const
{
    return localToJSValue(Isolate::GetCurrent()->globalInternals()).asNumber();
}

}
