#include "JSTTYHelper.h"

#include "../bindings/ZigGlobalObject.h"
#include "TTYHelper.h"

namespace WebCore {
using namespace Zig;

JSC_DEFINE_HOST_FUNCTION(jsFunctionInternalTty_isRaw,
    (JSGlobalObject * globalObject,
        CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    if (callFrame->argumentCount() < 1) {
        return JSValue::encode(jsBoolean(false));
    }

    auto scope = DECLARE_CATCH_SCOPE(vm);
    int fd = callFrame->argument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    auto isRaw = tty__is_raw(fd);
    if (isRaw == -3) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(jsBoolean(isRaw));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionInternalTty_setRawMode,
    (JSGlobalObject * globalObject,
        CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    if (callFrame->argumentCount() < 2) {
        return JSValue::encode(jsBoolean(false));
    }

    auto scope = DECLARE_CATCH_SCOPE(vm);
    int fd = callFrame->argument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());
    bool shouldBeRaw = callFrame->argument(1).toBoolean(globalObject);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto result = tty__set_mode(fd, shouldBeRaw ? TTY_MODE_RAW : TTY_MODE_NORMAL);
    if (result < 0) {
        JSC::throwException(
            globalObject, throwScope,
            JSC::createError(globalObject, "Failed to set tty mode. Error code: "_s + WTFMove(std::to_string(result).c_str())));
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(jsBoolean(true));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionInternalTty_setAsyncIoMode,
    (JSGlobalObject * globalObject,
        CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    if (callFrame->argumentCount() < 2) {
        return JSValue::encode(jsBoolean(false));
    }

    auto scope = DECLARE_CATCH_SCOPE(vm);
    int fd = callFrame->argument(0).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());
    bool shouldBeIoMode = callFrame->argument(1).toBoolean(globalObject);
    RETURN_IF_EXCEPTION(scope, encodedJSValue());

    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto result = tty__set_async_io_mode(fd, shouldBeIoMode);
    if (result < 0) {
        JSC::throwException(
            globalObject, throwScope,
            JSC::createError(globalObject, "Failed to set tty mode. Error code: "_s + WTFMove(std::to_string(result).c_str())));
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(jsBoolean(true));
}

} // namespace WebCore
