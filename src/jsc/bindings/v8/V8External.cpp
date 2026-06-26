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
    Bun::NapiExternal* val = Bun::NapiExternal::create(vm, structure, value,
        nullptr /* hint */, nullptr /* env */, nullptr /* callback */);
    return isolate->currentHandleScope()->createLocal<External>(vm, val);
}

Local<External> External::New(Isolate* isolate, void* value, uint16_t tag)
{
    // see V8External.h for why the tag is ignored
    (void)tag;
    return New(isolate, value);
}

void* External::Value() const
{
    auto* external = localToObjectPointer<Bun::NapiExternal>();
    if (!external) {
        return nullptr;
    }
    return external->value();
}

void* External::Value(uint16_t tag) const
{
    // see V8External.h for why the tag is ignored
    (void)tag;
    return Value();
}

} // namespace v8
