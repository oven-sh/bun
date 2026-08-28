#pragma once

#include "v8.h"
#include "V8Number.h"
#include "V8Local.h"
#include "V8Isolate.h"

namespace v8 {

class Integer : public Number {
public:
    BUN_EXPORT static Local<Integer> New(Isolate* isolate, int32_t value);
    BUN_EXPORT static Local<Integer> NewFromUnsigned(Isolate* isolate, uint32_t value);
    BUN_EXPORT int64_t Value() const;
};

} // namespace v8
