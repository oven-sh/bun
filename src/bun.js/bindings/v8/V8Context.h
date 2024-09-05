#pragma once

#include "ZigGlobalObject.h"
#include "V8GlobalInternals.h"
#include "V8Data.h"

namespace v8 {

class Isolate;

// Context is always a reinterpret pointer to V8::Roots, so that inlined V8 functions can find
// values they expect to find at fixed offsets
class Context : public Data {
public:
    BUN_EXPORT Isolate* GetIsolate();

    JSC::VM& vm() const
    {
        return globalObject()->vm();
    }

    const Zig::GlobalObject* globalObject() const
    {
        return reinterpret_cast<const Roots*>(localToCell())->parent->globalObject;
    }

    Zig::GlobalObject* globalObject()
    {
        return reinterpret_cast<const Roots*>(localToCell())->parent->globalObject;
    }

    HandleScope* currentHandleScope() const
    {
        return globalObject()->V8GlobalInternals()->currentHandleScope();
    };
};

}
