#pragma once

#include "V8Primitive.h"
#include "V8Isolate.h"

namespace v8 {

class Boolean : public Primitive {
public:
    BUN_EXPORT bool Value() const;
    // usually inlined
    BUN_EXPORT static Local<Boolean> New(Isolate* isolate, bool value);
};

}
