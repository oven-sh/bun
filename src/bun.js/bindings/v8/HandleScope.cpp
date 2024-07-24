#include "v8/HandleScope.h"

namespace v8 {

HandleScope::HandleScope(Isolate* isolate) {}

HandleScope::~HandleScope()
{
    abort();
}

uintptr_t* HandleScope::CreateHandle(internal::Isolate* isolate, uintptr_t value)
{
    return nullptr;
}

}
