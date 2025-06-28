#include "V8FunctionTemplate.h"
#include "V8Function.h"
#include "V8HandleScope.h"
#include "shim/FunctionTemplate.h"
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
    // only handling simpler cases for now
    // (pass most of these into v8::Function / JSC::InternalFunction)
    RELEASE_ASSERT_WITH_MESSAGE(signature.IsEmpty(),
        "Passing signature to FunctionTemplate::New is not yet supported");
    RELEASE_ASSERT_WITH_MESSAGE(length == 0,
        "Passing length to FunctionTemplate::New is not yet supported");
    RELEASE_ASSERT_WITH_MESSAGE(behavior == ConstructorBehavior::kAllow,
        "Passing behavior to FunctionTemplate::New is not yet supported");
    RELEASE_ASSERT_WITH_MESSAGE(side_effect_type == SideEffectType::kHasSideEffect,
        "Passing side_effect_type to FunctionTemplate::New is not yet supported");
    RELEASE_ASSERT_WITH_MESSAGE(c_function == nullptr,
        "Passing c_function to FunctionTemplate::New is not yet supported");
    RELEASE_ASSERT_WITH_MESSAGE(instance_type == 0,
        "Passing instance_type to FunctionTemplate::New is not yet supported");
    RELEASE_ASSERT_WITH_MESSAGE(allowed_receiver_instance_type_range_start == 0,
        "Passing allowed_receiver_instance_type_range_start to FunctionTemplate::New is not yet supported");
    RELEASE_ASSERT_WITH_MESSAGE(allowed_receiver_instance_type_range_end == 0,
        "Passing allowed_receiver_instance_type_range_end to FunctionTemplate::New is not yet supported");

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
    auto* f = shim::Function::create(vm, globalInternals->v8FunctionStructure(globalObject), localToObjectPointer());

    return globalInternals->currentHandleScope()->createLocal<Function>(vm, f);
}

} // namespace v8
