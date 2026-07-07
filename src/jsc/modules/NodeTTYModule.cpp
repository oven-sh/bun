#include "root.h"

#include "NodeTTYModule.h"

using namespace JSC;

namespace Zig {

JSC_DEFINE_HOST_FUNCTION(jsFunctionTty_isatty, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    if (callFrame->argumentCount() < 1) {
        return JSValue::encode(jsBoolean(false));
    }

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    int fd = callFrame->argument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

#if !OS(WINDOWS)
    bool isTTY = isatty(fd);
#else
    bool isTTY = false;
    switch (uv_guess_handle(fd)) {
    case UV_TTY:
        isTTY = true;
        break;
    default:
        break;
    }
#endif

    return JSValue::encode(jsBoolean(isTTY));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionNotImplementedYet,
    (JSGlobalObject * globalObject,
        CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    throwException(globalObject, throwScope,
        createError(globalObject, "Not implemented yet"_s));
    return {};
}

} // namespace Zig
