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

private:
    // Out-of-line targets of the inline templated Number::New integer overloads in
    // v8-primitive.h. Private to match V8's declarations, which affects the mangled
    // name on MSVC.
    BUN_EXPORT static Local<Number> NewFromInt32(Isolate* isolate, int32_t value);
    BUN_EXPORT static Local<Number> NewFromUint32(Isolate* isolate, uint32_t value);
};

} // namespace v8
