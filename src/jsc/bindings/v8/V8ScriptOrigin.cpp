#include "V8ScriptOrigin.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::ScriptOriginOptions)
ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::ScriptOrigin)

namespace v8 {

void ScriptOrigin::VerifyHostDefinedOptions() const
{
    // V8 checks that host_defined_options_ is a PrimitiveArray. Bun does not use host defined
    // options, so there is nothing to check.
}

} // namespace v8
