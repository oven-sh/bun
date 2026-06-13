#pragma once

#include "BunGlobalObject.h"
#include "V8Data.h"

namespace v8 {

class Isolate;

// Context is always a reinterpret pointer to Bun::GlobalObject, so that functions accepting a
// Context can quickly access JSC data
class Context : public Data {
public:
    BUN_EXPORT Isolate* GetIsolate();

    JSC::VM& vm() const
    {
        return localToCell()->vm();
    }

    const Bun::GlobalObject* globalObject() const
    {
        return dynamicDowncast<const Bun::GlobalObject>(localToCell());
    }

    Bun::GlobalObject* globalObject()
    {
        return dynamicDowncast<Bun::GlobalObject>(localToCell());
    }

    HandleScope* currentHandleScope() const
    {
        return globalObject()->V8GlobalInternals()->currentHandleScope();
    };
};

} // namespace v8
