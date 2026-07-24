#include "root.h"

#include "NodeTTYModule.h"

using namespace JSC;

namespace Zig {

JSC_DEFINE_HOST_FUNCTION(jsFunctionTty_isatty, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    UNUSED_PARAM(globalObject);

    // Node.js: Number.isInteger(fd) && fd >= 0 && fd <= 2147483647 && isTTY(fd)
    JSValue fdValue = callFrame->argument(0);
    if (!fdValue.isNumber())
        return JSValue::encode(jsBoolean(false));

    double fdDouble = fdValue.asNumber();
    if (!std::isfinite(fdDouble) || std::trunc(fdDouble) != fdDouble || fdDouble < 0 || fdDouble > INT32_MAX)
        return JSValue::encode(jsBoolean(false));

    int fd = static_cast<int>(fdDouble);

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
