#include "root.h"

#include "ZigGeneratedClasses.h"

namespace Bun {

using namespace JSC;
using namespace WTF;

extern "C" SYSV_ABI EncodedJSValue Bun__createShellInterpreter(Zig::GlobalObject* _Nonnull globalObject, void* _Nonnull ptr, EncodedJSValue parsed_shell_script, EncodedJSValue resolve, EncodedJSValue reject)
{
    auto& vm = globalObject->vm();
    const auto& existingArgs = jsCast<WebCore::JSParsedShellScript*>(JSValue::decode(parsed_shell_script))->values();
    WTF::FixedVector<WriteBarrier<Unknown>> args = WTF::FixedVector<WriteBarrier<Unknown>>(existingArgs.size());
    for (size_t i = 0; i < existingArgs.size(); i++) {
        args[i].setWithoutWriteBarrier(existingArgs[i].get());
    }
    JSValue resolveFn = JSValue::decode(resolve);
    JSValue rejectFn = JSValue::decode(reject);
    auto* structure = globalObject->JSShellInterpreterStructure();
    ASSERT(structure);

    auto* result = WebCore::JSShellInterpreter::create(vm, globalObject, structure, ptr, WTFMove(args), resolveFn, rejectFn);
    return JSValue::encode(result);
}

}
