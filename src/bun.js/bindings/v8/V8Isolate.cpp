#include "V8Isolate.h"
#include "V8HandleScope.h"
#include "ZigGlobalObject.h"

namespace v8 {

// Returns the isolate inside which the current thread is running or nullptr.
Isolate* Isolate::TryGetCurrent()
{
    auto* global = defaultGlobalObject();

    return global ? reinterpret_cast<v8::Isolate*>(&global->V8GlobalInternals()->roots) : nullptr;
}

// Returns the isolate inside which the current thread is running.
Isolate* Isolate::GetCurrent()
{
    auto* global = defaultGlobalObject();

    return global ? reinterpret_cast<v8::Isolate*>(&global->V8GlobalInternals()->roots) : nullptr;
}

Local<Context> Isolate::GetCurrentContext()
{
    return currentHandleScope()->createRawLocal<Context>(this);
}

}
