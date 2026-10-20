#pragma once

#include "ZigGlobalObject.h"
#include "V8Data.h"
#include "V8Local.h"

namespace v8 {

class Isolate;
class Object;

// Context is always a reinterpret pointer to Zig::GlobalObject, so that functions accepting a
// Context can quickly access JSC data
class Context : public Data {
public:
    BUN_EXPORT Isolate* GetIsolate();

    BUN_EXPORT Local<Object> Global();

    JSC::VM& vm() const
    {
        return localToCell()->vm();
    }

    const Zig::GlobalObject* globalObject() const
    {
        return dynamicDowncast<const Zig::GlobalObject>(localToCell());
    }

    Zig::GlobalObject* globalObject()
    {
        return dynamicDowncast<Zig::GlobalObject>(localToCell());
    }

    shim::HandleScopeBuffer* currentHandleScope() const
    {
        return globalObject()->V8GlobalInternals()->currentHandleScope();
    };
};

} // namespace v8
