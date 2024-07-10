#include "root.h"

#include "BunClientData.h"
#include "JSDOMOperation.h"
#include "BunBuiltinNames.h"

#undef createNotEnoughArgumentsError

namespace WebCore {

JSC::JSObject* createNotEnoughArgumentsErrorBun(JSC::JSGlobalObject* globalObject)
{
    JSC::JSObject* error = JSC::createNotEnoughArgumentsError(globalObject);
    if (LIKELY(error)) {
        auto& vm = globalObject->vm();
        const auto& names = WebCore::builtinNames(vm);
        error->putDirect(vm, names.codePublicName(), JSC::jsString(vm, WTF::String("ERR_MISSING_ARGS"_s)), 0);
    }

    return error;
}
}