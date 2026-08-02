#include "V8Function.h"
#include "shim/Function.h"
#include "shim/FunctionTemplate.h"
#include "shim/ObjectTemplate.h"
#include "shim/InternalFieldObject.h"
#include "V8Context.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"

#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/ConstructData.h"
#include "JavaScriptCore/ThrowScope.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Function)

namespace v8 {

MaybeLocal<Value> Function::Call(Local<Context> context, Local<Value> recv, int argc, Local<Value> argv[])
{
    auto* globalObject = context->globalObject();
    auto& vm = context->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSC::JSValue callee = localToJSValue();
    JSC::JSValue thisValue = recv.IsEmpty() ? JSC::jsUndefined() : recv->localToJSValue();

    JSC::MarkedArgumentBuffer args;
    args.ensureCapacity(argc);
    for (int i = 0; i < argc; i++) {
        args.append(argv[i]->localToJSValue());
    }

    JSC::JSValue result = JSC::call(globalObject, callee, thisValue, args, "v8::Function::Call"_s);
    RETURN_IF_EXCEPTION(scope, MaybeLocal<Value>());

    return context->currentHandleScope()->createLocal<Value>(vm, result);
}

MaybeLocal<Object> Function::NewInstance(Local<Context> context, int argc, Local<Value> argv[]) const
{
    auto* globalObject = context->globalObject();
    auto& vm = context->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSC::MarkedArgumentBuffer argBuffer;
    argBuffer.ensureCapacity(argc);
    for (int i = 0; i < argc; i++) {
        argBuffer.append(argv[i]->localToJSValue());
    }
    JSC::ArgList args(argBuffer);

    if (auto* v8Function = const_cast<shim::Function*>(localToObjectPointer<shim::Function>())) {
        if (auto* functionTemplate = v8Function->functionTemplate()) {
            auto* instanceTemplate = functionTemplate->ensureInstanceTemplate(globalObject);
            auto* receiver = instanceTemplate->newInstance();
            RETURN_IF_EXCEPTION(scope, MaybeLocal<Object>());

            JSC::JSValue prototype = v8Function->get(globalObject, vm.propertyNames->prototype);
            RETURN_IF_EXCEPTION(scope, MaybeLocal<Object>());
            if (prototype.isObject()) {
                receiver->setPrototypeDirect(vm, prototype);
            }

            JSC::JSValue result = shim::FunctionTemplate::invokeCallback(globalObject, v8Function, receiver, args, true);
            RETURN_IF_EXCEPTION(scope, MaybeLocal<Object>());

            JSC::JSObject* resultObject = result.isObject() ? result.getObject() : receiver;
            return context->currentHandleScope()->createLocal<Object>(vm, resultObject);
        }
    }

    JSC::JSValue callee = localToJSValue();
    JSC::JSObject* result = JSC::construct(globalObject, callee, args, "v8::Function::NewInstance"_s);
    RETURN_IF_EXCEPTION(scope, MaybeLocal<Object>());
    return context->currentHandleScope()->createLocal<Object>(vm, result);
}

void Function::SetName(Local<String> name)
{
    if (auto* jsFunction = localToObjectPointer<JSC::JSFunction>()) {
        jsFunction->setFunctionName(jsFunction->globalObject(), name->localToJSString());
    } else if (auto* v8Function = localToObjectPointer<shim::Function>()) {
        v8Function->setName(name->localToJSString());
    } else {
        RELEASE_ASSERT_NOT_REACHED("v8::Function::SetName called on invalid type");
    }
}

Local<Value> Function::GetName() const
{
    WTF::String wtfString;
    if (auto* jsFunction = localToObjectPointer<JSC::JSFunction>()) {
        wtfString = const_cast<JSC::JSFunction*>(jsFunction)->name(jsFunction->globalObject()->vm());
    } else if (auto* internalFunction = localToObjectPointer<JSC::InternalFunction>()) {
        wtfString = const_cast<JSC::InternalFunction*>(internalFunction)->name();
    } else {
        RELEASE_ASSERT_NOT_REACHED("v8::Function::GetName called on invalid type");
    }

    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(localToObjectPointer<JSC::JSNonFinalObject>()->globalObject());
    auto* handleScope = globalObject->V8GlobalInternals()->currentHandleScope();
    auto* jsString = JSC::jsString(globalObject->vm(), wtfString);
    return handleScope->createLocal<Value>(globalObject->vm(), jsString);
}

} // namespace v8
