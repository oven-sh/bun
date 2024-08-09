#pragma once

#include "v8.h"
#include "v8/Object.h"
#include "v8/Local.h"
#include "v8/Isolate.h"
#include "v8/Value.h"

namespace v8 {

class Array : public Object {
public:
    BUN_EXPORT static Local<Array> New(Isolate* isolate, Local<Value>* elements, size_t length);
};

}
