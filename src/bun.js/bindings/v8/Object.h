#pragma once

#include "v8.h"
#include "v8/Value.h"
#include "v8/Local.h"
#include "v8/Isolate.h"
#include "v8/Maybe.h"
#include "v8/Context.h"
#include "v8/Data.h"

namespace v8 {

class Object : public Value {
public:
    BUN_EXPORT static Local<Object> New(Isolate* isolate);
    BUN_EXPORT Maybe<bool> Set(Local<Context> context, Local<Value> key, Local<Value> value);
    BUN_EXPORT void SetInternalField(int index, Local<Data> data);

private:
    BUN_EXPORT Local<Data> SlowGetInternalField(int index);
};

}
