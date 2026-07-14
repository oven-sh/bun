#include "V8Integer.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Integer)
ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Int32)
ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Uint32)

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
    JSC::JSValue jsValue = localToJSValue();
    if (jsValue.isInt32()) {
        return jsValue.asInt32();
    }
    return static_cast<int64_t>(jsValue.asNumber());
}

int32_t Int32::Value() const
{
    JSC::JSValue jsValue = localToJSValue();
    if (jsValue.isInt32()) {
        return jsValue.asInt32();
    }
    return JSC::toInt32(jsValue.asNumber());
}

uint32_t Uint32::Value() const
{
    JSC::JSValue jsValue = localToJSValue();
    if (jsValue.isUInt32()) {
        return jsValue.asUInt32();
    }
    return JSC::toUInt32(jsValue.asNumber());
}

} // namespace v8
