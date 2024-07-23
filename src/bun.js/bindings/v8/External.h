#pragma once

#include "v8.h"
#include "v8/Value.h"
#include "v8/MaybeLocal.h"
#include "v8/Isolate.h"

namespace v8 {

class External : public Value {
public:
    BUN_EXPORT static MaybeLocal<External> New(Isolate* isolate, void* value);
    BUN_EXPORT void* Value() const;
};

}
