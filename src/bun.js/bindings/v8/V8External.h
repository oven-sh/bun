#pragma once

#include "v8.h"
#include "V8Value.h"
#include "V8MaybeLocal.h"
#include "V8Isolate.h"

namespace v8 {

class External : public Value {
public:
    BUN_EXPORT static Local<External> New(Isolate* isolate, void* value);
    BUN_EXPORT void* Value() const;
};

} // namespace v8
