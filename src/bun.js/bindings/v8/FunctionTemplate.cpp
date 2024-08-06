#include "v8/FunctionTemplate.h"
#include "v8/Function.h"

#include "JavaScriptCore/FunctionPrototype.h"

using JSC::JSCell;
using JSC::JSValue;
using JSC::Structure;

namespace v8 {

// for CREATE_METHOD_TABLE
namespace JSCastingHelpers = JSC::JSCastingHelpers;

const JSC::ClassInfo FunctionTemplate::s_info = {
    "FunctionTemplate"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(FunctionTemplate)
};

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
    RELEASE_ASSERT(signature.IsEmpty());
    RELEASE_ASSERT(length == 0);
    RELEASE_ASSERT(behavior == ConstructorBehavior::kAllow);
    RELEASE_ASSERT(side_effect_type == SideEffectType::kHasSideEffect);
    RELEASE_ASSERT(c_function == nullptr);
    RELEASE_ASSERT(instance_type == 0);
    RELEASE_ASSERT(allowed_receiver_instance_type_range_start == 0);
    RELEASE_ASSERT(allowed_receiver_instance_type_range_end == 0);

    auto globalObject = isolate->globalObject();
    auto& vm = globalObject->vm();
    JSValue jsc_data = data->localToTagged().getJSValue();

    Structure* structure = globalObject->V8GlobalInternals()->functionTemplateStructure(globalObject);
    auto* functionTemplate = new (NotNull, JSC::allocateCell<FunctionTemplate>(vm)) FunctionTemplate(
        vm, structure, callback, jsc_data);
    functionTemplate->finishCreation(vm);

    return isolate->currentHandleScope()->createLocal<FunctionTemplate>(functionTemplate);
}

MaybeLocal<Function> FunctionTemplate::GetFunction(Local<Context> context)
{
    auto& vm = context->vm();
    auto* globalObject = context->globalObject();
    auto* f = Function::create(vm, globalObject->V8GlobalInternals()->v8FunctionStructure(globalObject), localToObjectPointer());

    return context->currentHandleScope()->createLocal<Function>(f);
}

Structure* FunctionTemplate::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    return Structure::create(
        vm,
        globalObject,
        globalObject->functionPrototype(),
        JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags),
        info());
}

template<typename Visitor>
void FunctionTemplate::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    FunctionTemplate* fn = jsCast<FunctionTemplate*>(cell);
    ASSERT_GC_OBJECT_INHERITS(fn, info());
    Base::visitChildren(fn, visitor);

    if (fn->__internals.data.isCell()) {
        JSC::JSCell::visitChildren(fn->__internals.data.asCell(), visitor);
    }
}

DEFINE_VISIT_CHILDREN(FunctionTemplate);

JSC::EncodedJSValue FunctionTemplate::functionCall(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    auto* callee = JSC::jsDynamicCast<Function*>(callFrame->jsCallee());
    (void)callee;
    // TODO call callee->__internals.functionTemplate.get()->__internals.callback
    // with a pointer to some CallbackInfo on the stack
    return JSValue::encode(JSC::jsNumber(42));
}

}
