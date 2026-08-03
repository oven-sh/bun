#include "V8Integer.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Integer)

namespace v8 {

Local<Integer> Integer::New(Isolate* isolate, int32_t value)
{
    return isolate->currentHandleScope()->createLocal<Integer>(isolate->vm(), JSC::jsNumber(value));
}

Local<Integer> Integer::NewFromUnsigned(Isolate* isolate, uint32_t value)
{
    return isolate->currentHandleScope()->createLocal<Integer>(isolate->vm(), JSC::jsNumber(value));
}

int64_t Integer::Value() const
{
    JSC::JSValue value = localToJSValue();
    if (value.isInt32()) [[likely]]
        return value.asInt32();
    // V8's Integer::Value() is a raw static_cast<int64_t>(HeapNumber::value())
    // (see v8 api.cc), so match it exactly and take the same per-arch result
    // for out-of-int64-range doubles that real addons observe under Node.
    return static_cast<int64_t>(value.asNumber());
}

} // namespace v8
