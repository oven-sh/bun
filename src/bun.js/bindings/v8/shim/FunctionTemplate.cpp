#include "FunctionTemplate.h"
#include "Function.h"
#include "../V8HandleScope.h"
#include "../V8Data.h"

#include "JavaScriptCore/FunctionPrototype.h"

using JSC::JSValue;
using JSC::Structure;

namespace v8 {

class Object;

namespace shim {

// for CREATE_METHOD_TABLE
namespace JSCastingHelpers = JSC::JSCastingHelpers;

const JSC::ClassInfo FunctionTemplate::s_info = {
    "FunctionTemplate"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(FunctionTemplate)
};

FunctionTemplate* FunctionTemplate::create(JSC::VM& vm, JSC::Structure* structure, FunctionCallback callback, JSC::JSValue data)
{
    auto* functionTemplate = new (NotNull, JSC::allocateCell<FunctionTemplate>(vm)) FunctionTemplate(
        vm, structure, callback, data);
    functionTemplate->finishCreation(vm);
    return functionTemplate;
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

    visitor.append(fn->m_data);
}

DEFINE_VISIT_CHILDREN(FunctionTemplate);

JSC::EncodedJSValue FunctionTemplate::functionCall(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    auto* callee = JSC::jsDynamicCast<Function*>(callFrame->jsCallee());
    auto* functionTemplate = callee->functionTemplate();
    auto* isolate = JSC::jsCast<Zig::GlobalObject*>(globalObject)->V8GlobalInternals()->isolate();
    auto& vm = JSC::getVM(globalObject);

    WTF::Vector<TaggedPointer, 8> args(callFrame->argumentCount() + 1);

    HandleScope hs(isolate);

    // V8 function calls always run in "sloppy mode," even if the JS side is in strict mode. So if
    // `this` is null or undefined, we use globalThis instead; otherwise, we convert `this` to an
    // object.
    JSC::JSObject* jscThis = globalObject->globalThis();
    if (!callFrame->thisValue().isUndefinedOrNull()) {
        // TODO(@190n) throwscope, assert no exception
        jscThis = callFrame->thisValue().toObject(globalObject);
    }
    Local<Object> thisObject = hs.createLocal<Object>(vm, jscThis);
    args[0] = thisObject.tagged();

    for (size_t i = 0; i < callFrame->argumentCount(); i++) {
        Local<Value> argValue = hs.createLocal<Value>(vm, callFrame->argument(i));
        args[i + 1] = argValue.tagged();
    }

    Local<Value> data = hs.createLocal<Value>(vm, functionTemplate->m_data.get());

    ImplicitArgs implicit_args = {
        .holder = nullptr,
        .isolate = isolate,
        .unused = nullptr,
        .return_value = TaggedPointer(),
        // data may be an object
        // put it in the handle scope so that it has a map ptr
        .data = data.tagged(),
        .new_target = nullptr,
    };

    FunctionCallbackInfo<Value> info(&implicit_args, args.begin() + 1, callFrame->argumentCount());

    functionTemplate->m_callback(info);

    if (implicit_args.return_value.isEmpty()) {
        // callback forgot to set a return value, so return undefined
        return JSValue::encode(JSC::jsUndefined());
    } else {
        Local<Data> local_ret(&implicit_args.return_value);
        return JSValue::encode(local_ret->localToJSValue());
    }
}

} // namespace shim
} // namespace v8
