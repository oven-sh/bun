#include "V8Context.h"

namespace v8 {

Isolate* Context::GetIsolate()
{
    return globalObject()->V8GlobalInternals()->isolate();
}

} // namespace v8
