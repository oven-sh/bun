#include "V8FunctionTemplate.h"
#include "V8Function.h"
#include "V8HandleScope.h"
#include "V8String.h"
#include "V8ObjectTemplate.h"
#include "shim/FunctionTemplate.h"
#include "shim/ObjectTemplate.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::FunctionTemplate)

ASSERT_V8_ENUM_MATCHES(ConstructorBehavior, kThrow)
ASSERT_V8_ENUM_MATCHES(ConstructorBehavior, kAllow)

ASSERT_V8_ENUM_MATCHES(SideEffectType, kHasSideEffect)
ASSERT_V8_ENUM_MATCHES(SideEffectType, kHasNoSideEffect)
ASSERT_V8_ENUM_MATCHES(SideEffectType, kHasSideEffectToReceiver)

using JSC::JSCell;
using JSC::JSValue;
using JSC::Structure;

namespace v8 {

Local<FunctionTemplate> FunctionTemplate::New(
    Isolate* isolate,
    FunctionCallback callback,
    Local<Value> data,
    Local<Signature> signature,
    int length,
    ConstructorBehavior behavior,
    SideEffectType side_effect_type,
    const CFunction* c_function,
    uint16_t instance_type,
    uint16_t allowed_receiver_instance_type_range_start,
    uint16_t allowed_receiver_instance_type_range_end)
{
    // signature, length, behavior, side_effect_type, c_function and the
    // instance-type hints are accepted and ignored; Bun's shim doesn't yet
    // enforce receiver checks, declared arity, or V8 fast-API calls.
    (void)signature;
    (void)length;
    (void)behavior;
    (void)side_effect_type;
    (void)c_function;
    (void)instance_type;
    (void)allowed_receiver_instance_type_range_start;
    (void)allowed_receiver_instance_type_range_end;

    auto globalObject = isolate->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto* globalInternals = globalObject->V8GlobalInternals();
    JSValue jsc_data = data.IsEmpty() ? JSC::jsUndefined() : data->localToJSValue();

    Structure* structure = globalInternals->functionTemplateStructure(globalObject);
    auto* functionTemplate = shim::FunctionTemplate::create(vm, structure, callback, jsc_data);

    return globalInternals->currentHandleScope()->createLocal<FunctionTemplate>(vm, functionTemplate);
}

MaybeLocal<Function> FunctionTemplate::GetFunction(Local<Context> context)
{
    auto& vm = context->vm();
    auto* globalObject = context->globalObject();
    auto* globalInternals = globalObject->V8GlobalInternals();
    auto* f = localToObjectPointer()->makeFunction(vm, globalObject, globalInternals);

    return globalInternals->currentHandleScope()->createLocal<Function>(vm, f);
}

Local<ObjectTemplate> FunctionTemplate::InstanceTemplate()
{
    auto* functionTemplate = localToObjectPointer();
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(functionTemplate->globalObject());
    auto& vm = JSC::getVM(globalObject);
    auto* globalInternals = globalObject->V8GlobalInternals();
    auto* objectTemplate = functionTemplate->ensureInstanceTemplate(globalObject);
    return globalInternals->currentHandleScope()->createLocal<ObjectTemplate>(vm, objectTemplate);
}

Local<ObjectTemplate> FunctionTemplate::PrototypeTemplate()
{
    auto* functionTemplate = localToObjectPointer();
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(functionTemplate->globalObject());
    auto& vm = JSC::getVM(globalObject);
    auto* globalInternals = globalObject->V8GlobalInternals();
    auto* objectTemplate = functionTemplate->ensurePrototypeTemplate(globalObject);
    return globalInternals->currentHandleScope()->createLocal<ObjectTemplate>(vm, objectTemplate);
}

void FunctionTemplate::SetClassName(Local<String> name)
{
    auto* functionTemplate = localToObjectPointer();
    auto& vm = JSC::getVM(functionTemplate->globalObject());
    functionTemplate->setClassName(vm, name->localToJSString());
}

} // namespace v8
