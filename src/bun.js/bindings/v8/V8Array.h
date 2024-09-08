#pragma once

#include "v8.h"
#include "V8Object.h"
#include "V8Local.h"
#include "V8Isolate.h"
#include "V8Value.h"

namespace v8 {

class Array : public Object {
public:
    BUN_EXPORT static Local<Array> New(Isolate* isolate, Local<Value>* elements, size_t length);
};

}
