#include "V8External.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"
#include "napi_external.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::External)

namespace v8 {

Local<External> External::New(Isolate* isolate, void* value)
{
    auto globalObject = isolate->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto structure = globalObject->NapiExternalStructure();
    Bun::NapiExternal* val = Bun::NapiExternal::create(vm, structure, value, nullptr, nullptr);
    return isolate->currentHandleScope()->createLocal<External>(vm, val);
}

void* External::Value() const
{
    auto* external = localToObjectPointer<Bun::NapiExternal>();
    if (!external) {
        return nullptr;
    }
    return external->value();
}

} // namespace v8
