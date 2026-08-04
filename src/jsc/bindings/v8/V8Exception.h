#pragma once

#include "v8.h"
#include "V8Local.h"
#include "V8Value.h"
#include "V8String.h"

namespace v8 {

class Exception {
public:
    BUN_EXPORT static Local<Value> RangeError(Local<String> message, Local<Value> options = {});
    BUN_EXPORT static Local<Value> ReferenceError(Local<String> message, Local<Value> options = {});
    BUN_EXPORT static Local<Value> SyntaxError(Local<String> message, Local<Value> options = {});
    BUN_EXPORT static Local<Value> TypeError(Local<String> message, Local<Value> options = {});
    BUN_EXPORT static Local<Value> Error(Local<String> message, Local<Value> options = {});
};

} // namespace v8
