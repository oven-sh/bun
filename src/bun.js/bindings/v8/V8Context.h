#pragma once

#include "ZigGlobalObject.h"
#include "V8GlobalInternals.h"
#include "V8Data.h"

namespace v8 {

class Context : public Data {
public:
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
