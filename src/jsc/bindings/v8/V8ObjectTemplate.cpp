#include "V8ObjectTemplate.h"
#include "shim/InternalFieldObject.h"
#include "shim/GlobalInternals.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Object)

namespace v8 {

Local<ObjectTemplate> ObjectTemplate::New(Isolate* isolate, Local<FunctionTemplate> constructor)
{
    RELEASE_ASSERT(constructor.IsEmpty());
    auto* globalObject = isolate->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto* globalInternals = globalObject->V8GlobalInternals();
    auto* structure = globalInternals->objectTemplateStructure(globalObject);
    // TODO pass constructor
    auto* objectTemplate = shim::ObjectTemplate::create(vm, structure);
    return globalInternals->currentHandleScope()->createLocal<ObjectTemplate>(vm, objectTemplate);
}

MaybeLocal<Object> ObjectTemplate::NewInstance(Local<Context> context)
{
    // TODO handle constructor
    // TODO handle interceptors?

    auto& vm = context->vm();
    auto* thisObj = localToObjectPointer();
    auto* newInstance = thisObj->newInstance();
    return MaybeLocal<Object>(context->currentHandleScope()->createLocal<Object>(vm, newInstance));
}

void ObjectTemplate::SetInternalFieldCount(int value)
{
    localToObjectPointer()->setInternalFieldCount(value);
}

int ObjectTemplate::InternalFieldCount() const
{
    return localToObjectPointer()->internalFieldCount();
}

} // namespace v8
