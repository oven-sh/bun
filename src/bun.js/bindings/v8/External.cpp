#include "v8/External.h"

#include "napi_external.h"

using JSC::jsDynamicCast;
using JSC::JSValue;

namespace v8 {

MaybeLocal<External> External::New(Isolate* isolate, void* value)
{
    auto globalObject = isolate->globalObject();
    auto& vm = globalObject->vm();
    auto structure = globalObject->NapiExternalStructure();
    JSValue val = Bun::NapiExternal::create(vm, structure, value, nullptr, nullptr);
    return MaybeLocal<External>(Local<External>(val));
}

void* External::Value() const
{
    JSValue val = toJSValue();
    auto* external = jsDynamicCast<Bun::NapiExternal*>(val);
    if (!external) {
        return nullptr;
    }
    return external->value();
}

}
