#include "v8/External.h"

#include "napi_external.h"

namespace v8 {

Local<External> External::New(Isolate* isolate, void* value)
{
    auto globalObject = isolate->globalObject();
    auto& vm = globalObject->vm();
    auto structure = globalObject->NapiExternalStructure();
    Bun::NapiExternal* val = Bun::NapiExternal::create(vm, structure, value, nullptr, nullptr);
    return isolate->currentHandleScope()->createLocal<External>(val);
}

void* External::Value() const
{
    auto* external = localToObjectPointer<Bun::NapiExternal>();
    if (!external) {
        return nullptr;
    }
    return external->value();
}

}
