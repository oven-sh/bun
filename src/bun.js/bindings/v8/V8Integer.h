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

    inline static Integer* Cast(class Value* obj)
    {
        return static_cast<Integer*>(obj);
    }
};

class Int32 : public Integer {
public:
    BUN_EXPORT int32_t Value() const;

    inline static Int32* Cast(class Value* obj)
    {
        return static_cast<Int32*>(obj);
    }
};

class Uint32 : public Integer {
public:
    BUN_EXPORT uint32_t Value() const;

    inline static Uint32* Cast(class Value* obj)
    {
        return static_cast<Uint32*>(obj);
    }
};

} // namespace v8
