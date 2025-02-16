#include "V8Function.h"
#include "shim/Function.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Function)

namespace v8 {

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

    auto* globalObject = jsCast<Zig::GlobalObject*>(localToObjectPointer<JSC::JSNonFinalObject>()->globalObject());
    auto* handleScope = globalObject->V8GlobalInternals()->currentHandleScope();
    auto* jsString = JSC::jsString(globalObject->vm(), wtfString);
    return handleScope->createLocal<Value>(globalObject->vm(), jsString);
}

MaybeLocal<Value> Function::Call(Local<Context> context, Local<Value> recv, int argc, Local<Value> argv[])
{
    JSC::JSCell* func = localToCell();
    JSC::CallData callData = JSC::getCallData(func);

    auto* globalObject = context->globalObject();
    auto& vm = globalObject->vm();

    JSC::MarkedArgumentBuffer args;
    if (argc > 0 && LIKELY(argv != nullptr)) {
        auto* end = argv + argc;
        for (auto* it = argv; it != end; ++it) {
            args.append((*it)->localToJSValue());
        }
    }

    JSC::JSValue thisValue = recv->localToJSValue();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (thisValue.isEmpty()) {
        thisValue = JSC::jsUndefined();
    }

    JSC::JSValue result = call(globalObject, func, callData, thisValue, args);
    if (result.isEmpty()) {
        result = JSC::jsUndefined();
    }

    RETURN_IF_EXCEPTION(scope, MaybeLocal<Value>());

    auto* handleScope = globalObject->V8GlobalInternals()->currentHandleScope();
    RELEASE_AND_RETURN(scope, MaybeLocal<Value>(handleScope->createLocal<Value>(vm, result)));
}

} // namespace v8
