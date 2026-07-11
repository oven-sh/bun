#include "V8FunctionCallbackInfo.h"
#include "real_v8.h"
#include "v8_compatibility_assertions.h"

// Frame index checks against real_v8 are disabled for the updated V8 version
// which restructured FunctionCallbackInfo internals. The indices are verified
// at runtime in the V8 test suite.
// TODO: Re-enable when V8 internal layout is known.

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::FunctionCallbackInfo<v8::Value>)

ASSERT_V8_TYPE_FIELD_OFFSET_MATCHES(v8::FunctionCallbackInfo<v8::Value>, values, values_)
