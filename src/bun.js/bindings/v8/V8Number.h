#pragma once

#include "v8.h"
#include "V8Primitive.h"
#include "V8Local.h"
#include "V8Isolate.h"

namespace v8 {

class Number : public Primitive {
public:
    BUN_EXPORT static Local<Number> New(Isolate* isolate, double value);

    BUN_EXPORT double Value() const;
};

} // namespace v8
