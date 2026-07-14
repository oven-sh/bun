#include "V8Function.h"
#include "shim/Function.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/ArgList.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Function)

namespace v8 {

MaybeLocal<Value> Function::Call(Isolate* isolate, Local<Context> context, Local<Value> recv, int argc, Local<Value> argv[])
{
    Zig::GlobalObject* globalObject = context->globalObject();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue callee = localToJSValue();
    auto callData = JSC::getCallData(callee);
    if (callData.type == JSC::CallData::Type::None) [[unlikely]] {
        return MaybeLocal<Value>();
    }

    JSC::JSValue thisValue = recv.IsEmpty() ? JSC::jsUndefined() : recv->localToJSValue();

    JSC::MarkedArgumentBuffer args;
    args.ensureCapacity(argc);
    for (int i = 0; i < argc; i++) {
        args.append(argv[i]->localToJSValue());
    }
    if (args.hasOverflowed()) [[unlikely]] {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return MaybeLocal<Value>();
    }

    JSC::JSValue result = JSC::call(globalObject, callee, callData, thisValue, args);
    RETURN_IF_EXCEPTION(scope, MaybeLocal<Value>());

    return isolate->currentHandleScope()->createLocal<Value>(vm, result);
}

MaybeLocal<Value> Function::Call(Local<Context> context, Local<Value> recv, int argc, Local<Value> argv[])
{
    return Call(context->GetIsolate(), context, recv, argc, argv);
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
