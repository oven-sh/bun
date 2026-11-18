#include "engine/Engine.h"

namespace JSC {

JSValue evaluate(JSGlobalObject* globalObject, const SourceCode& source, UnlinkedProgramCodeBlock* code, JSValue thisValue, NakedPtr<Exception>& returnedException)
{
    if (!code)
        return evaluate(globalObject, source, thisValue, returnedException);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm());
    JSValue result = Engine::compiled_script_evaluate(Ref { *code }, globalObject, thisValue);
    if (auto* exception = scope.exception()) [[unlikely]] {
        returnedException = exception;
        scope.clearException();
        return jsUndefined();
    }
    return result;
}

} // namespace JSC
