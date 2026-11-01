#include "root.h"

#include "AsyncContextFrame.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/AOTHost.h>
#include <JavaScriptCore/FunctionExecutable.h>
#include <JavaScriptCore/JSFunction.h>

// JSC's source for a function starts at its parameter list, not at `function` or its name.
extern "C" BunString Bun__JSFunction__sourceFromParameters(JSC::EncodedJSValue encodedValue, bool* isArrowFunction)
{
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    if (auto* frame = dynamicDowncast<AsyncContextFrame>(value))
        value = frame->callback.get();
    auto* function = dynamicDowncast<JSC::JSFunction>(value);
    if (!function)
        return { BunStringTag::Dead };
    const JSC::SourceCode* source = function->sourceCode();
    if (!source || function->jsExecutable()->isClass())
        return { BunStringTag::Dead };
    *isArrowFunction = JSC::isArrowFunctionParseMode(function->jsExecutable()->parseMode());
    return Bun::toStringRef(source->view().toString());
}

extern "C" BunString Bun__JSFunction__compiledSource(JSC::EncodedJSValue encodedValue, bool* isTextLeftOut)
{
#if ENABLE(AOT)
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    if (auto* frame = dynamicDowncast<AsyncContextFrame>(value))
        value = frame->callback.get();
    JSC::JSObject* callee = value.getObject();
    if (!callee || !callee->vm().hasCompiledCode() || !JSC::AOT::CompiledCallee::isCompiledCallee(callee) || JSC::AOT::CompiledCallee::isBoundFunction(callee))
        return { BunStringTag::Dead };
    auto kind = JSC::AOT::CompiledCallee::kind(callee);
    if (kind == JSC::AOT::CompiledCallee::FunctionKind::Class || kind == JSC::AOT::CompiledCallee::FunctionKind::Builtin)
        return { BunStringTag::Dead };
    JSC::JSGlobalObject* globalObject = callee->globalObject();
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSC::JSValue shown = JSC::AOT::CompiledCallee::sourceText(globalObject, callee);
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return { BunStringTag::Dead };
    }
    JSC::JSString* text = JSC::AOT::CompiledCallee::sourceStringIfCreated(vm, callee);
    if (!text || text != shown.asCell()) {
        *isTextLeftOut = true;
        return { BunStringTag::Dead };
    }
    WTF::String string = text->value(globalObject);
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return { BunStringTag::Dead };
    }
    return Bun::toStringRef(string);
#else
    UNUSED_PARAM(encodedValue);
    UNUSED_PARAM(isTextLeftOut);
    return { BunStringTag::Dead };
#endif
}
