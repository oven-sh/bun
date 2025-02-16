#pragma once

#include "v8.h"
#include "V8Value.h"
#include "V8Local.h"
#include "V8Isolate.h"
#include "V8Maybe.h"
#include "V8Context.h"
#include "V8Data.h"
#include "v8/V8MaybeLocal.h"

namespace v8 {

class Object : public Value {
public:
    BUN_EXPORT static Local<Object> New(Isolate* isolate);
    BUN_EXPORT Maybe<bool> Set(Local<Context> context, Local<Value> key, Local<Value> value);
    BUN_EXPORT void SetInternalField(int index, Local<Data> data);
    // usually inlined
    BUN_EXPORT Local<Data> GetInternalField(int index);

    // Set a 2-byte-aligned pointer in an internal field. The field may only be retrieved by
    // GetAlignedPointerFromInternalField
    BUN_EXPORT void SetAlignedPointerInInternalField(int index, void* value);

    BUN_EXPORT MaybeLocal<Value> Get(Local<Context> context, Local<Value> key);
    BUN_EXPORT MaybeLocal<Value> Get(Local<Context> context, uint32_t index);

private:
    BUN_EXPORT Local<Data> SlowGetInternalField(int index);
    BUN_EXPORT void* SlowGetAlignedPointerFromInternalField(int index);
};

} // namespace v8
