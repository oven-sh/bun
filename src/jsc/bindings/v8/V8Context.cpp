#include "V8Context.h"
#include "V8Object.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Context)

namespace v8 {

Isolate* Context::GetIsolate()
{
    return globalObject()->V8GlobalInternals()->isolate();
}

Local<Object> Context::Global()
{
    auto* global = globalObject();
    return currentHandleScope()->createLocal<Object>(global->vm(), global->globalThis());
}

} // namespace v8
