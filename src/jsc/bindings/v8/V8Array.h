#pragma once

#include "v8.h"
#include "V8Object.h"
#include "V8Local.h"
#include "V8Isolate.h"
#include "V8Value.h"
#include "V8Context.h"
#include "V8MaybeLocal.h"
#include <functional>

namespace v8 {

class Array : public Object {
public:
    // Get the length of the array
    BUN_EXPORT uint32_t Length() const;

    // Creates a JavaScript array with the given length. If the length
    // is negative the returned array will have length 0.
    BUN_EXPORT static Local<Array> New(Isolate* isolate, int length = 0);

    // Creates a JavaScript array out of a Local<Value> array in C++
    // with a known length.
    BUN_EXPORT static Local<Array> New(Isolate* isolate, Local<Value>* elements, size_t length);

    // Creates a JavaScript array from a provided callback.
    BUN_EXPORT static MaybeLocal<Array> New(
        Local<Context> context, size_t length,
        std::function<MaybeLocal<v8::Value>()> next_value_callback);

    // Cast a Value to Array (with optional type checking)
    inline static Array* Cast(Value* value)
    {
#ifdef V8_ENABLE_CHECKS
        CheckCast(value);
#endif
        return static_cast<Array*>(value);
    }

    enum class CallbackResult {
        kException,
        kBreak,
        kContinue,
    };
    using IterationCallback = CallbackResult (*)(uint32_t index,
        Local<Value> element,
        void* data);

    // Iterates over array elements efficiently
    BUN_EXPORT Maybe<void> Iterate(Local<Context> context, IterationCallback callback,
        void* callback_data);

private:
    Array();
    BUN_EXPORT static void CheckCast(Value* obj);
};

} // namespace v8
