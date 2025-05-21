#include "V8Number.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Number)

namespace v8 {

Local<Number> Number::New(Isolate* isolate, double value)
{
    return isolate->currentHandleScope()->createLocal<Number>(isolate->vm(), JSC::jsNumber(value));
}

double Number::Value() const
{
    return localToJSValue().asNumber();
}

} // namespace v8
