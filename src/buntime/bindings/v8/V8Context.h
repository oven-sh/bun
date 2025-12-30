#pragma once

#include "ZigGlobalObject.h"
#include "V8Data.h"

namespace v8 {

namespace shim {
class Isolate;
}

// Context is always a reinterpret pointer to Zig::GlobalObject, so that functions accepting a
// Context can quickly access JSC data
class Context : public Data {
public:
    BUN_EXPORT Isolate* GetIsolate();

    JSC::VM& vm() const
    {
        return localToCell()->vm();
    }

    const Zig::GlobalObject* globalObject() const
    {
        return JSC::jsDynamicCast<const Zig::GlobalObject*>(localToCell());
    }

    Zig::GlobalObject* globalObject()
    {
        return JSC::jsDynamicCast<Zig::GlobalObject*>(localToCell());
    }

    HandleScope* currentHandleScope() const
    {
        return globalObject()->V8GlobalInternals()->currentHandleScope();
    };
};

} // namespace v8
