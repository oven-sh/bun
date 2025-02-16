#include "V8Integer.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Integer)

namespace v8 {

int64_t Integer::Value() const
{
    return localToJSValue().asAnyInt();
}

Local<Integer> Integer::New(Isolate* isolate, int32_t value)
{
    return isolate->currentHandleScope()->createLocal<Integer>(isolate->vm(), JSC::jsNumber(value));
}

Local<Integer> Integer::NewFromUnsigned(Isolate* isolate, uint32_t value)
{
    return isolate->currentHandleScope()->createLocal<Integer>(isolate->vm(), JSC::jsNumber(value));
}

} // namespace v8
