#include "V8Integer.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"
#include <cmath>

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
    auto jsValue = localToJSValue();
    if (jsValue.isInt32()) {
        return jsValue.asInt32();
    }
    double num = jsValue.asNumber();
    // Handle special cases
    if (std::isnan(num) || std::isinf(num) || num == 0.0) {
        return 0;
    }
    // Clamp to int64_t range
    if (num >= static_cast<double>(INT64_MAX)) {
        return INT64_MAX;
    }
    if (num <= static_cast<double>(INT64_MIN)) {
        return INT64_MIN;
    }
    return static_cast<int64_t>(num);
}

int32_t Int32::Value() const
{
    auto jsValue = localToJSValue();
    if (jsValue.isInt32()) {
        return jsValue.asInt32();
    }
    // Use ECMAScript ToInt32 conversion
    return JSC::toInt32(jsValue.asNumber());
}

uint32_t Uint32::Value() const
{
    auto jsValue = localToJSValue();
    uint32_t value;
    if (jsValue.getUInt32(value)) {
        return value;
    }
    // Use ECMAScript ToUint32 conversion
    return JSC::toUInt32(jsValue.asNumber());
}

} // namespace v8
