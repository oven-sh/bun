#pragma once

#include "v8.h"
#include "V8Object.h"
#include "V8Local.h"
#include "V8Value.h"
#include "V8Context.h"
#include "V8Maybe.h"
#include "V8MaybeLocal.h"

namespace v8 {

class Map : public Object {
public:
    BUN_EXPORT MaybeLocal<Map> Set(Local<Context> context, Local<Value> key, Local<Value> value);
    BUN_EXPORT Maybe<bool> Delete(Local<Context> context, Local<Value> key);

private:
    Map();
};

} // namespace v8
