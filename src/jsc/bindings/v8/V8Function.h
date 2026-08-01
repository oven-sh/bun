#pragma once

#include "V8Object.h"
#include "V8FunctionTemplate.h"
#include "V8Local.h"
#include "V8MaybeLocal.h"
#include "V8String.h"
#include "shim/Function.h"

namespace v8 {

class Context;

class Function : public Object {
public:
    BUN_EXPORT MaybeLocal<Object> NewInstance(Local<Context> context, int argc, Local<Value> argv[]) const;

    BUN_EXPORT MaybeLocal<Value> Call(Local<Context> context, Local<Value> recv, int argc, Local<Value> argv[]);

    BUN_EXPORT void SetName(Local<String> name);
    BUN_EXPORT Local<Value> GetName() const;
};

} // namespace v8
