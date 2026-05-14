#pragma once

#include "RustGlobalObject.h"
#include "V8Data.h"

namespace v8 {

class Isolate;

// Context is always a reinterpret pointer to Rust::GlobalObject, so that functions accepting a
// Context can quickly access JSC data
class Context : public Data {
public:
    BUN_EXPORT Isolate* GetIsolate();

    JSC::VM& vm() const
    {
        return localToCell()->vm();
    }

    const Rust::GlobalObject* globalObject() const
    {
        return dynamicDowncast<const Rust::GlobalObject>(localToCell());
    }

    Rust::GlobalObject* globalObject()
    {
        return dynamicDowncast<Rust::GlobalObject>(localToCell());
    }

    HandleScope* currentHandleScope() const
    {
        return globalObject()->V8GlobalInternals()->currentHandleScope();
    };
};

} // namespace v8
