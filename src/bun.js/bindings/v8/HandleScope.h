#pragma once

#include "v8.h"
#include "v8/Isolate.h"

namespace v8 {

namespace internal {
class Isolate {};
}

class HandleScope {
public:
    BUN_EXPORT HandleScope(Isolate* isolate);
    BUN_EXPORT ~HandleScope();
    BUN_EXPORT uintptr_t* CreateHandle(internal::Isolate* isolate, uintptr_t value);

private:
    // V8 impl is a pointer and a size_t, this matches the size and alignment
    size_t data[2];
};

}
