#pragma once

#include "v8.h"
#include "V8Local.h"

namespace v8 {

class String;
class Value;

class Exception {
public:
    BUN_EXPORT static Local<Value> Error(Local<String> message, Local<Value> options = {});
    BUN_EXPORT static Local<Value> TypeError(Local<String> message, Local<Value> options = {});
};

} // namespace v8
