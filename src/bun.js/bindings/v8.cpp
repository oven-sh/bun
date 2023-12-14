#include "root.h"
#include "ZigGlobalObject.h"

extern "C" Zig::GlobalObject* Bun__getDefaultGlobal();

namespace v8 {

using Context = JSC::JSGlobalObject;

template<class T>
class Local final {
public:
    T* ptr;
};

// This currently is just a pointer to a Zig::GlobalObject*
// We do that so that we can recover the context and the VM from the "Isolate"
class Isolate final {
public:
    Isolate() = default;

    // Returns the isolate inside which the current thread is running or nullptr.
    JS_EXPORT static Isolate* TryGetCurrent();

    // Returns the isolate inside which the current thread is running.
    JS_EXPORT static Isolate* GetCurrent();

    JS_EXPORT Local<Context> GetCurrentContext();

    Zig::GlobalObject* globalObject() { return reinterpret_cast<Zig::GlobalObject*>(this); }
    JSC::VM& vm() { return globalObject()->vm(); }
};

// Returns the isolate inside which the current thread is running or nullptr.
Isolate* Isolate::TryGetCurrent()
{
    auto* global = Bun__getDefaultGlobal();

    return global ? reinterpret_cast<v8::Isolate*>(global) : nullptr;
}

// Returns the isolate inside which the current thread is running.
Isolate* Isolate::GetCurrent()
{
    auto* global = Bun__getDefaultGlobal();

    return global ? reinterpret_cast<v8::Isolate*>(global) : nullptr;
}

Local<Context> Isolate::GetCurrentContext()
{
    return Local<Context> { reinterpret_cast<Context*>(this) };
}

}

namespace node {

JS_EXPORT void AddEnvironmentCleanupHook(v8::Isolate* isolate,
    void (*fun)(void* arg),
    void* arg);

JS_EXPORT void RemoveEnvironmentCleanupHook(v8::Isolate* isolate,
    void (*fun)(void* arg),
    void* arg);

void AddEnvironmentCleanupHook(v8::Isolate* isolate,
    void (*fun)(void* arg),
    void* arg)
{
    // TODO
}

void RemoveEnvironmentCleanupHook(v8::Isolate* isolate,
    void (*fun)(void* arg),
    void* arg)
{
    // TODO
}

}