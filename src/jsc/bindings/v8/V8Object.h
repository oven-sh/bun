#pragma once

#include "v8.h"
#include "V8Value.h"
#include "V8Local.h"
#include "V8Isolate.h"
#include "V8Maybe.h"
#include "V8Context.h"
#include "V8Data.h"
#include "V8MaybeLocal.h"

namespace v8 {

class Object : public Value {
public:
    BUN_EXPORT static Local<Object> New(Isolate* isolate);
    BUN_EXPORT Maybe<bool> Set(Local<Context> context, Local<Value> key, Local<Value> value);
    BUN_EXPORT Maybe<bool> Set(Local<Context> context, uint32_t index, Local<Value> value);

    // Get property by key
    BUN_EXPORT MaybeLocal<Value> Get(Local<Context> context, Local<Value> key);

    // Get property by index (for arrays)
    BUN_EXPORT MaybeLocal<Value> Get(Local<Context> context, uint32_t index);

    BUN_EXPORT void SetInternalField(int index, Local<Data> data);
    // usually inlined
    BUN_EXPORT Local<Data> GetInternalField(int index);

private:
    BUN_EXPORT Local<Data> SlowGetInternalField(int index);
};

} // namespace v8
