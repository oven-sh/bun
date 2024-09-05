#include "V8FunctionTemplate.h"
#include "V8Function.h"
#include "V8HandleScope.h"

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
    auto* globalInternals = globalObject->V8GlobalInternals();
    JSValue jsc_data = data.IsEmpty() ? JSC::jsUndefined() : data->localToJSValue(globalInternals);

    Structure* structure = globalInternals->functionTemplateStructure(globalObject);
    auto* functionTemplate = new (NotNull, JSC::allocateCell<FunctionTemplate>(vm)) FunctionTemplate(
        vm, structure, callback, jsc_data);
    functionTemplate->finishCreation(vm);

    return globalInternals->currentHandleScope()->createLocal<FunctionTemplate>(vm, functionTemplate);
}

MaybeLocal<Function> FunctionTemplate::GetFunction(Local<Context> context)
{
    auto& vm = context->vm();
    auto* globalObject = context->globalObject();
    auto* globalInternals = globalObject->V8GlobalInternals();
    auto* f = Function::create(vm, globalInternals->v8FunctionStructure(globalObject), localToObjectPointer());

    return globalInternals->currentHandleScope()->createLocal<Function>(vm, f);
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

    visitor.append(fn->__internals.data);
}

DEFINE_VISIT_CHILDREN(FunctionTemplate);

JSC::EncodedJSValue FunctionTemplate::functionCall(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    auto* callee = JSC::jsDynamicCast<Function*>(callFrame->jsCallee());
    auto* functionTemplate = callee->functionTemplate();
    auto* isolate = Isolate::fromGlobalObject(JSC::jsDynamicCast<Zig::GlobalObject*>(globalObject));
    auto& vm = globalObject->vm();

    WTF::Vector<TaggedPointer, 8> args(callFrame->argumentCount() + 1);

    HandleScope hs(isolate);
    Local<Value> thisValue = hs.createLocal<Value>(vm, callFrame->thisValue());
    args[0] = thisValue.tagged();

    for (size_t i = 0; i < callFrame->argumentCount(); i++) {
        Local<Value> argValue = hs.createLocal<Value>(vm, callFrame->argument(i));
        args[i + 1] = argValue.tagged();
    }

    Local<Value> data = hs.createLocal<Value>(vm, functionTemplate->__internals.data.get());

    ImplicitArgs implicit_args = {
        .holder = nullptr,
        .isolate = isolate,
        .context = reinterpret_cast<Context*>(isolate),
        .return_value = TaggedPointer(),
        // data may be an object
        // put it in the handle scope so that it has a map ptr
        .target = data.tagged(),
        .new_target = nullptr,
    };

    FunctionCallbackInfo<Value> info(&implicit_args, args.data() + 1, callFrame->argumentCount());

    functionTemplate->__internals.callback(info);

    if (implicit_args.return_value.type() != TaggedPointer::Type::Smi && implicit_args.return_value.getPtr() == nullptr) {
        // callback forgot to set a return value, so return undefined
        return JSValue::encode(JSC::jsUndefined());
    } else {
        Local<Data> local_ret(&implicit_args.return_value);
        return JSValue::encode(local_ret->localToJSValue(isolate->globalInternals()));
    }
}

}
