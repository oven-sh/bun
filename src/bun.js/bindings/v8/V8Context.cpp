#include "V8Context.h"

namespace v8 {

Isolate* Context::GetIsolate()
{
    return reinterpret_cast<Isolate*>(localToPointer());
}

}
