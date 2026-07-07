#include "V8Context.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Context)

namespace v8 {

Isolate* Context::GetIsolate()
{
    return globalObject()->V8GlobalInternals()->isolate();
}

} // namespace v8
