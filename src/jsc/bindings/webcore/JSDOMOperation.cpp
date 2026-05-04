#include "root.h"

#include "BunClientData.h"
#include "JSDOMOperation.h"
#include "BunBuiltinNames.h"

// JSDOMOperation.h #defines createNotEnoughArgumentsError → our wrapper.
// Suspend it here so the wrapper can call the real JSC function, then
// restore it — under unified builds the suspended macro would otherwise
// leak into later siblings (JSDOMURL.cpp etc.) and they'd silently lose
// the ERR_MISSING_ARGS code on the thrown error.
#pragma push_macro("createNotEnoughArgumentsError")
#undef createNotEnoughArgumentsError

namespace WebCore {

JSC::JSObject* createNotEnoughArgumentsErrorBun(JSC::JSGlobalObject* globalObject)
{
    JSC::JSObject* error = JSC::createNotEnoughArgumentsError(globalObject);
    if (error) [[likely]] {
        auto& vm = JSC::getVM(globalObject);
        const auto& names = WebCore::builtinNames(vm);
        error->putDirect(vm, names.codePublicName(), JSC::jsString(vm, WTF::String("ERR_MISSING_ARGS"_s)), 0);
    }

    return error;
}

#pragma pop_macro("createNotEnoughArgumentsError")

void throwNodeRangeError(JSGlobalObject* lexicalGlobalObject, ThrowScope& scope, const String& message)
{
    auto* error = createRangeError(lexicalGlobalObject, message);
    if (error) [[likely]] {
        auto& vm = getVM(lexicalGlobalObject);
        auto& builtinNames = Bun::builtinNames(vm);
        error->putDirect(vm, builtinNames.codePublicName(), jsString(vm, String("ERR_OUT_OF_RANGE"_s)));
        scope.throwException(lexicalGlobalObject, error);
    }
}

void throwNodeRangeError(JSGlobalObject* lexicalGlobalObject, ThrowScope& scope, ASCIILiteral message)
{
    auto* error = createRangeError(lexicalGlobalObject, message);
    if (error) [[likely]] {
        auto& vm = getVM(lexicalGlobalObject);
        auto& builtinNames = Bun::builtinNames(vm);
        error->putDirect(vm, builtinNames.codePublicName(), jsString(vm, String("ERR_OUT_OF_RANGE"_s)));
        scope.throwException(lexicalGlobalObject, error);
    }
}

}
