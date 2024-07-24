#pragma once

#include "v8.h"
#include "v8/Isolate.h"
#include "v8/internal.h"

namespace v8 {

class HandleScope {
public:
    BUN_EXPORT HandleScope(Isolate* isolate);
    BUN_EXPORT ~HandleScope();
    BUN_EXPORT uintptr_t* CreateHandle(internal::Isolate* isolate, uintptr_t value);

protected:
    HandleScope() = default;

private:
    internal::Isolate* i_isolate;
    uintptr_t* prev_next;
    uintptr_t* prev_limit;
};

}
