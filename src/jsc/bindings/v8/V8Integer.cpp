#include "V8Integer.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"

#include "JavaScriptCore/MathCommon.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Integer)
ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Int32)

namespace v8 {

int32_t Int32::Value() const
{
    JSC::JSValue value = localToJSValue();
    if (value.isInt32()) [[likely]]
        return value.asInt32();
    return JSC::toInt32(value.asNumber());
}

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
    // Matches V8's api.cc exactly (raw cast, no range clamp).
    return static_cast<int64_t>(value.asNumber());
}

} // namespace v8
