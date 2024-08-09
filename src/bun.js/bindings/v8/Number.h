#pragma once

#include "v8.h"
#include "v8/Primitive.h"
#include "v8/Local.h"
#include "v8/Isolate.h"

namespace v8 {

class Number : public Primitive {
public:
    BUN_EXPORT static Local<Number> New(Isolate* isolate, double value);

    BUN_EXPORT double Value() const;
};

}
