#pragma once

#include "V8Object.h"
#include "V8FunctionTemplate.h"
#include "V8Local.h"
#include "V8String.h"
#include "shim/Function.h"

namespace v8 {

class Function : public Object {
public:
    BUN_EXPORT void SetName(Local<String> name);

private:
    shim::Function* localToObjectPointer()
    {
        return Data::localToObjectPointer<shim::Function>();
    }

    const shim::Function* localToObjectPointer() const
    {
        return Data::localToObjectPointer<shim::Function>();
    }
};

} // namespace v8
