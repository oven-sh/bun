#include "root.h"

#include "AsyncContextFrame.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/AOTHost.h>
#include <JavaScriptCore/FunctionExecutable.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSFunction.h>

// Whether `callee.toString()` would run `Function.prototype.toString` of any realm. Runs no JavaScript.
static bool hasBuiltinToString(JSC::VM& vm, JSC::JSObject* callee)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSC::PropertySlot slot(callee, JSC::PropertySlot::InternalMethodType::VMInquiry, &vm);
    bool found = callee->getNonIndexPropertySlot(callee->globalObject(), vm.propertyNames->toString, slot);
    // The global of a node:vm context on the prototype chain throws when the stack is full. It stays pending for the caller.
    if (scope.exception()) [[unlikely]]
        return false;
    // A getter or a Proxy gives no function here. The caller asks those, which can run JavaScript.
    auto* function = found ? dynamicDowncast<JSC::JSFunction>(slot.getPureResult()) : nullptr;
    return function && function->isHostFunction() && function->nativeFunction() == JSC::toTagged(JSC::functionProtoFuncToString);
}

// JSC's source for a function starts at its parameter list, not at `function` or its name.
// `hasCustomToString`: the callee's `toString` is not the built-in, or its lookup threw and the exception is pending.
extern "C" BunString Bun__JSFunction__sourceFromParameters(JSC::EncodedJSValue encodedValue, bool* isArrowFunction, bool* hasCustomToString)
{
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    if (auto* frame = dynamicDowncast<AsyncContextFrame>(value))
        value = frame->callback.get();
    JSC::JSObject* callee = value.getObject();
    if (!callee)
        return { BunStringTag::Dead };
    if (!hasBuiltinToString(callee->vm(), callee)) {
        *hasCustomToString = true;
        return { BunStringTag::Dead };
    }
    auto* function = dynamicDowncast<JSC::JSFunction>(callee);
    if (!function)
        return { BunStringTag::Dead };
    const JSC::SourceCode* source = function->sourceCode();
    if (!source || function->jsExecutable()->isClass())
        return { BunStringTag::Dead };
    *isArrowFunction = JSC::isArrowFunctionParseMode(function->jsExecutable()->parseMode());
    return Bun::toStringRef(source->view().toString()).leak();
}

// A function that `bun test --aot` compiled has no executable. Its text is the whole function, as toString() gives it.
extern "C" BunString Bun__JSFunction__compiledSource(JSC::EncodedJSValue encodedValue, bool* isTextLeftOut)
{
#if ENABLE(AOT)
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    if (auto* frame = dynamicDowncast<AsyncContextFrame>(value))
        value = frame->callback.get();
    JSC::JSObject* callee = value.getObject();
    if (!callee || !callee->vm().hasCompiledCode() || !JSC::AOT::CompiledCallee::isCompiledCallee(callee))
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
    // Without the text it shows "[native code]".
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
    return Bun::toStringRef(string).leak();
#else
    UNUSED_PARAM(encodedValue);
    UNUSED_PARAM(isTextLeftOut);
    return { BunStringTag::Dead };
#endif
}
