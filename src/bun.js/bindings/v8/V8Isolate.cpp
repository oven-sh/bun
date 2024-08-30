#include "V8Isolate.h"
#include "V8HandleScope.h"

namespace v8 {

// Returns the isolate inside which the current thread is running or nullptr.
Isolate* Isolate::TryGetCurrent()
{
    auto* global = Bun__getDefaultGlobalObject();

    return global ? reinterpret_cast<v8::Isolate*>(&global->V8GlobalInternals()->roots) : nullptr;
}

// Returns the isolate inside which the current thread is running.
Isolate* Isolate::GetCurrent()
{
    auto* global = Bun__getDefaultGlobalObject();

    return global ? reinterpret_cast<v8::Isolate*>(&global->V8GlobalInternals()->roots) : nullptr;
}

Local<Context> Isolate::GetCurrentContext()
{
    auto* globalInternals = reinterpret_cast<Roots*>(this)->parent;
    auto* globalObject = globalInternals->globalObject;
    return globalInternals->currentHandleScope()->createLocal<Context>(globalObject->vm(), globalObject);
}

}
