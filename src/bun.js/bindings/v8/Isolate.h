#pragma once

#include "v8.h"
#include "v8/Context.h"
#include "v8/Local.h"
#include "v8/GlobalInternals.h"

namespace v8 {

class HandleScope;

// This currently is just a pointer to a Zig::GlobalObject*
// We do that so that we can recover the context and the VM from the "Isolate"
class Isolate final {
public:
    Isolate() = default;

    // Returns the isolate inside which the current thread is running or nullptr.
    BUN_EXPORT static Isolate* TryGetCurrent();

    // Returns the isolate inside which the current thread is running.
    BUN_EXPORT static Isolate* GetCurrent();

    BUN_EXPORT Local<Context> GetCurrentContext();

    static Isolate* fromGlobalObject(Zig::GlobalObject* globalObject) { return reinterpret_cast<Isolate*>(&globalObject->V8GlobalInternals()->roots); }
    Zig::GlobalObject* globalObject() { return reinterpret_cast<Roots*>(this)->parent->globalObject; }
    JSC::VM& vm() { return globalObject()->vm(); }
    GlobalInternals* globalInternals() { return globalObject()->V8GlobalInternals(); }
    HandleScope* currentHandleScope() { return globalInternals()->currentHandleScope(); }
};

}
