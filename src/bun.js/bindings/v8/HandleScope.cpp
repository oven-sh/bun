#include "v8/HandleScope.h"

namespace v8 {

HandleScope::HandleScope(Isolate* isolate)
    : i_isolate(reinterpret_cast<internal::Isolate*>(isolate))
{
}

HandleScope::~HandleScope() {}

uintptr_t* HandleScope::CreateHandle(internal::Isolate* isolate, uintptr_t value)
{
    return nullptr;
}

}
