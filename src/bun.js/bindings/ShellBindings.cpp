#include "root.h"

#include "ZigGeneratedClasses.h"

namespace Bun {

using namespace JSC;
using namespace WTF;

extern "C" EncodedJSValue Bun__createShellInterpreter(Zig::GlobalObject* _Nonnull globalObject, void* _Nonnull ptr, EncodedJSValue parsed_shell_script, EncodedJSValue resolve, EncodedJSValue reject)
{
    auto& vm = globalObject->vm();
    WTF::FixedVector<WriteBarrier<Unknown>> args = jsCast<WebCore::JSParsedShellScript*>(JSValue::decode(parsed_shell_script))->values();
    JSValue resolveFn = JSValue::decode(resolve);
    JSValue rejectFn = JSValue::decode(reject);
    auto* structure = globalObject->JSShellInterpreterStructure();
    ASSERT(structure);

    auto* result = WebCore::JSShellInterpreter::create(vm, globalObject, structure, ptr, WTFMove(args), resolveFn, rejectFn);
    return JSValue::encode(result);
}

}
