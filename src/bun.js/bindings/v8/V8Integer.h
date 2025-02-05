#pragma once

#include "V8Number.h"

namespace v8 {
class Integer : public Number {
    BUN_EXPORT int64_t Value() const;
    BUN_EXPORT static Local<Integer> New(Isolate* isolate, int32_t value);
    BUN_EXPORT static Local<Integer> NewFromUnsigned(Isolate* isolate, uint32_t value);
};
} // namespace v8
