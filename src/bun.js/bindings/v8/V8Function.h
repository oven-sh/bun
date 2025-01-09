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
    BUN_EXPORT Local<Value> GetName() const;
};

} // namespace v8
