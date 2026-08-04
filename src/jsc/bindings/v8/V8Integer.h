#pragma once

#include "v8.h"
#include "V8Number.h"

namespace v8 {

class Integer : public Number {
public:
    BUN_EXPORT static Local<Integer> New(Isolate* isolate, int32_t value);
    BUN_EXPORT static Local<Integer> NewFromUnsigned(Isolate* isolate, uint32_t value);
    BUN_EXPORT int64_t Value() const;
};

class Int32 : public Integer {
public:
    BUN_EXPORT int32_t Value() const;
};

class Uint32 : public Integer {
public:
    BUN_EXPORT uint32_t Value() const;
};

} // namespace v8
