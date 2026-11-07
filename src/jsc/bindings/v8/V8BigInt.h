#pragma once

#include "v8.h"
#include "V8Primitive.h"
#include "V8Local.h"
#include "V8Isolate.h"

namespace v8 {

class BigInt : public Primitive {
public:
    BUN_EXPORT static Local<BigInt> New(Isolate* isolate, int64_t value);
};

} // namespace v8
