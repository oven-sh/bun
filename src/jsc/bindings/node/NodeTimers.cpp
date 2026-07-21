#include "NodeTimers.h"

#include "ErrorCode.h"
#include "headers.h"
#include "ZigGlobalObject.h"
#include "NodeAsyncHooks.h"

namespace Bun {

using namespace JSC;

// Forward a schedule/clear event to the async_hooks timer dispatch. Costs one
// flag load + branch when async_hooks id tracking was never enabled.
static bool emitTimerEventIfNeeded(JSC::JSGlobalObject* globalObject, AsyncHooksTimerEvent event, JSC::EncodedJSValue encodedTimer)
{
    auto* global = defaultGlobalObject(globalObject);
    if (!global->asyncHooksTimerHooksEnabled) [[likely]]
        return true;
    JSC::JSValue timer = JSC::JSValue::decode(encodedTimer);
    // Non-objects can reach here via clearTimeout(number/undefined); the JS
    // record map is keyed by timer object, so skip the dispatch round trip.
    if (timer.isEmpty() || !timer.isObject()) [[unlikely]]
        return true;
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    emitAsyncHooksTimerEvent(global, event, timer);
    RETURN_IF_EXCEPTION(scope, false);
    return true;
}

JSC_DEFINE_HOST_FUNCTION(functionSetTimeout,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSValue job = callFrame->argument(0);
    JSC::JSValue num = callFrame->argument(1);
    JSC::JSValue arguments = jsUndefined();
    size_t argumentCount = callFrame->argumentCount();
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    switch (argumentCount) {
    case 0: {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "setTimeout requires 1 argument (a function)"_s);
        return {};
    }
    case 1:
    case 2: {
        break;
    }
    case 3: {
        arguments = callFrame->argument(2);
        break;
    }

    default: {
        ArgList argumentsList = ArgList(callFrame, 2);
        auto* args = JSC::JSCellButterfly::tryCreateFromArgList(vm, argumentsList);

        if (!args) [[unlikely]] {
            JSC::throwOutOfMemoryError(globalObject, scope);
            return {};
        }

        arguments = JSValue(args);
    }
    }

    if (!job.isObject() || !job.getObject()->isCallable()) [[unlikely]] {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "setTimeout expects a function"_s);
        return {};
    }

#ifdef BUN_DEBUG
    /** View the file name of the JS file that called this function
     * from a debugger */
    SourceOrigin sourceOrigin = callFrame->callerSourceOrigin(vm);
    auto fileNameUTF8 = sourceOrigin.string().utf8();
    const char* fileName = fileNameUTF8.data();
    static const char* lastFileName = nullptr;
    if (lastFileName != fileName) {
        lastFileName = fileName;
    }
#endif

    JSC::EncodedJSValue timer = Bun__Timer__setTimeout(globalObject, JSC::JSValue::encode(job), JSC::JSValue::encode(arguments), JSValue::encode(num));
    RETURN_IF_EXCEPTION(scope, {});
    if (!emitTimerEventIfNeeded(globalObject, AsyncHooksTimerEvent::InitTimeout, timer)) [[unlikely]]
        return {};
    return timer;
}

JSC_DEFINE_HOST_FUNCTION(functionSetInterval,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSValue job = callFrame->argument(0);
    JSC::JSValue num = callFrame->argument(1);
    JSC::JSValue arguments = jsUndefined();
    size_t argumentCount = callFrame->argumentCount();
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    switch (argumentCount) {
    case 0: {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "setInterval requires 1 argument (a function)"_s);
        return {};
    }
    case 1:
    case 2: {
        break;
    }
    case 3: {
        arguments = callFrame->argument(2);
        break;
    }

    default: {
        ArgList argumentsList = ArgList(callFrame, 2);
        auto* args = JSC::JSCellButterfly::tryCreateFromArgList(vm, argumentsList);

        if (!args) [[unlikely]] {
            JSC::throwOutOfMemoryError(globalObject, scope);
            return {};
        }

        arguments = JSValue(args);
    }
    }

    if (!job.isObject() || !job.getObject()->isCallable()) [[unlikely]] {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "setInterval expects a function"_s);
        return {};
    }

#ifdef BUN_DEBUG
    /** View the file name of the JS file that called this function
     * from a debugger */
    SourceOrigin sourceOrigin = callFrame->callerSourceOrigin(vm);
    auto fileNameUTF8 = sourceOrigin.string().utf8();
    const char* fileName = fileNameUTF8.data();
    static const char* lastFileName = nullptr;
    if (lastFileName != fileName) {
        lastFileName = fileName;
    }
#endif

    JSC::EncodedJSValue timer = Bun__Timer__setInterval(globalObject, JSC::JSValue::encode(job), JSC::JSValue::encode(arguments), JSValue::encode(num));
    RETURN_IF_EXCEPTION(scope, {});
    if (!emitTimerEventIfNeeded(globalObject, AsyncHooksTimerEvent::InitInterval, timer)) [[unlikely]]
        return {};
    return timer;
}

// https://developer.mozilla.org/en-US/docs/Web/API/Window/setImmediate
JSC_DEFINE_HOST_FUNCTION(functionSetImmediate,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto argCount = callFrame->argumentCount();
    if (argCount == 0) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "setImmediate requires 1 argument (a function)"_s);
        return {};
    }

    auto job = callFrame->argument(0);

    if (!job.isObject() || !job.getObject()->isCallable()) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "setImmediate expects a function"_s);
        return {};
    }

    JSC::JSValue arguments = jsUndefined();
    switch (argCount) {
    case 0:
    case 1: {
        break;
    }
    case 2: {
        arguments = callFrame->argument(1);
        break;
    }
    default: {
        ArgList argumentsList = ArgList(callFrame, 1);
        auto* args = JSC::JSCellButterfly::tryCreateFromArgList(vm, argumentsList);

        if (!args) [[unlikely]] {
            JSC::throwOutOfMemoryError(globalObject, scope);
            return {};
        }

        arguments = JSValue(args);
    }
    }

    JSC::EncodedJSValue timer = Bun__Timer__setImmediate(globalObject, JSC::JSValue::encode(job), JSValue::encode(arguments));
    RETURN_IF_EXCEPTION(scope, {});
    if (!emitTimerEventIfNeeded(globalObject, AsyncHooksTimerEvent::InitImmediate, timer)) [[unlikely]]
        return {};
    return timer;
}

JSC_DEFINE_HOST_FUNCTION(functionClearImmediate,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);

    JSC::JSValue timer_or_num = callFrame->argument(0);

#ifdef BUN_DEBUG
    /** View the file name of the JS file that called this function
     * from a debugger */
    SourceOrigin sourceOrigin = callFrame->callerSourceOrigin(vm);
    auto fileNameUTF8 = sourceOrigin.string().utf8();
    const char* fileName = fileNameUTF8.data();
    static const char* lastFileName = nullptr;
    if (lastFileName != fileName) {
        lastFileName = fileName;
    }
#endif

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::EncodedJSValue result = Bun__Timer__clearImmediate(globalObject, JSC::JSValue::encode(timer_or_num));
    RETURN_IF_EXCEPTION(scope, {});
    if (!emitTimerEventIfNeeded(globalObject, AsyncHooksTimerEvent::Cleared, JSC::JSValue::encode(timer_or_num))) [[unlikely]]
        return {};
    return result;
}

JSC_DEFINE_HOST_FUNCTION(functionClearInterval,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);

    JSC::JSValue timer_or_num = callFrame->argument(0);

#ifdef BUN_DEBUG
    /** View the file name of the JS file that called this function
     * from a debugger */
    SourceOrigin sourceOrigin = callFrame->callerSourceOrigin(vm);
    auto fileNameUTF8 = sourceOrigin.string().utf8();
    const char* fileName = fileNameUTF8.data();
    static const char* lastFileName = nullptr;
    if (lastFileName != fileName) {
        lastFileName = fileName;
    }
#endif

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::EncodedJSValue result = Bun__Timer__clearInterval(globalObject, JSC::JSValue::encode(timer_or_num));
    RETURN_IF_EXCEPTION(scope, {});
    if (!emitTimerEventIfNeeded(globalObject, AsyncHooksTimerEvent::Cleared, JSC::JSValue::encode(timer_or_num))) [[unlikely]]
        return {};
    return result;
}

JSC_DEFINE_HOST_FUNCTION(functionClearTimeout,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);

    JSC::JSValue timer_or_num = callFrame->argument(0);

#ifdef BUN_DEBUG
    /** View the file name of the JS file that called this function
     * from a debugger */
    SourceOrigin sourceOrigin = callFrame->callerSourceOrigin(vm);
    auto fileNameUTF8 = sourceOrigin.string().utf8();
    const char* fileName = fileNameUTF8.data();
    static const char* lastFileName = nullptr;
    if (lastFileName != fileName) {
        lastFileName = fileName;
    }
#endif

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::EncodedJSValue result = Bun__Timer__clearTimeout(globalObject, JSC::JSValue::encode(timer_or_num));
    RETURN_IF_EXCEPTION(scope, {});
    if (!emitTimerEventIfNeeded(globalObject, AsyncHooksTimerEvent::Cleared, JSC::JSValue::encode(timer_or_num))) [[unlikely]]
        return {};
    return result;
}

} // namespace Bun
