#pragma once

#include "ZigGlobalObject.h"
#include "v8/GlobalInternals.h"
#include "v8/Data.h"

namespace v8 {

class Context : public Data {
public:
    JSC::VM& vm() const
    {
        return globalObject()->vm();
    }

    const Zig::GlobalObject* globalObject() const
    {
        return localToObjectPointer<Zig::GlobalObject>();
    }

    Zig::GlobalObject* globalObject()
    {
        return localToObjectPointer<Zig::GlobalObject>();
    }

    HandleScope* currentHandleScope() const
    {
        return globalObject()->V8GlobalInternals()->currentHandleScope();
    };
};

}
