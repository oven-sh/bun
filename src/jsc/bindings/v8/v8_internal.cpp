#include "v8_internal.h"
#include "V8Isolate.h"

namespace v8 {
namespace internal {

Isolate* IsolateFromNeverReadOnlySpaceObject(uintptr_t obj)
{
    V8_UNIMPLEMENTED();
    return nullptr;
}

v8::Isolate* Internals::GetCurrentIsolate()
{
    return v8::Isolate::GetCurrent();
}

} // namespace internal
} // namespace v8
