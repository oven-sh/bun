#include "root.h"

#include "ZigGeneratedClasses.h"

extern "C" SYSV_ABI size_t ShellInterpreter__estimatedSize(void* ptr);

namespace Bun {

using namespace JSC;
using namespace WTF;

extern "C" SYSV_ABI EncodedJSValue Bun__createShellInterpreter(Zig::GlobalObject* _Nonnull globalObject, void* _Nonnull ptr, EncodedJSValue parsed_shell_script, EncodedJSValue resolve, EncodedJSValue reject)
{
    auto& vm = globalObject->vm();
    auto* parsedScript = uncheckedDowncast<WebCore::JSParsedShellScript>(JSValue::decode(parsed_shell_script));
    const auto& existingArgs = parsedScript->values();
    WTF::FixedVector<WriteBarrier<Unknown>> args = WTF::FixedVector<WriteBarrier<Unknown>>(existingArgs.size());
    for (size_t i = 0; i < existingArgs.size(); i++) {
        args[i].setWithoutWriteBarrier(existingArgs[i].get());
    }
    JSValue resolveFn = JSValue::decode(resolve);
    JSValue rejectFn = JSValue::decode(reject);
    // Re-root the `Bun.Terminal` attached via `setTerminal` on the interpreter
    // wrapper: the `ParsedShellScript` that was rooting it becomes unreachable
    // as soon as JS drops its reference. Empty when no terminal is attached.
    JSValue terminal = parsedScript->m_terminal.get();
    auto* structure = globalObject->JSShellInterpreterStructure();
    ASSERT(structure);

    auto* result = WebCore::JSShellInterpreter::create(vm, globalObject, structure, ptr, WTF::move(args), resolveFn, rejectFn, terminal);

    size_t size = ShellInterpreter__estimatedSize(ptr);
    vm.heap.reportExtraMemoryAllocated(result, size);
    return JSValue::encode(result);
}

}
