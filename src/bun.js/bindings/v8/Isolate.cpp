#include "v8/Isolate.h"

namespace v8 {

// Returns the isolate inside which the current thread is running or nullptr.
Isolate* Isolate::TryGetCurrent()
{
    auto* global = Bun__getDefaultGlobalObject();

    return global ? reinterpret_cast<v8::Isolate*>(global) : nullptr;
}

// Returns the isolate inside which the current thread is running.
Isolate* Isolate::GetCurrent()
{
    auto* global = Bun__getDefaultGlobalObject();

    return global ? reinterpret_cast<v8::Isolate*>(global) : nullptr;
}

Local<Context> Isolate::GetCurrentContext()
{
    return currentHandleScope()->createLocal<Context>(reinterpret_cast<Zig::GlobalObject*>(this));
}

}
