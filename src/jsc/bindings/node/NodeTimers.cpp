#include "NodeTimers.h"

#include "ErrorCode.h"
#include "headers.h"
#include <wtf/text/MakeString.h>

namespace Bun {

using namespace JSC;

using TimerScheduler = JSC::EncodedJSValue (*)(JSC::JSGlobalObject*, JSC::EncodedJSValue callback, JSC::EncodedJSValue arguments, JSC::EncodedJSValue countdown);

// setTimeout(callback, delay, ...args) / setInterval(callback, delay, ...args).
// The extra arguments are packed the way Bun__JSTimeout__call (NodeTimerObject.cpp)
// unpacks them: undefined for none, the value itself for one, a JSCellButterfly
// for several.
static JSC::EncodedJSValue scheduleTimer(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame, ASCIILiteral name, TimerScheduler schedule)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue job = callFrame->argument(0);
    JSC::JSValue num = callFrame->argument(1);
    JSC::JSValue arguments = jsUndefined();

    switch (callFrame->argumentCount()) {
    case 0: {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, makeString(name, " requires 1 argument (a function)"_s));
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
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, makeString(name, " expects a function"_s));
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

    RELEASE_AND_RETURN(scope, schedule(globalObject, JSC::JSValue::encode(job), JSC::JSValue::encode(arguments), JSC::JSValue::encode(num)));
}

JSC_DEFINE_HOST_FUNCTION(functionSetTimeout,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return scheduleTimer(globalObject, callFrame, "setTimeout"_s, Bun__Timer__setTimeout);
}

JSC_DEFINE_HOST_FUNCTION(functionSetInterval,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return scheduleTimer(globalObject, callFrame, "setInterval"_s, Bun__Timer__setInterval);
}

// The setTimeout/setInterval that built-in JS modules schedule their own
// deadlines with (src/js/internal/timers.ts). Same arguments and same Timeout
// object as the globals, but the timer is never handed to bun:test's fake
// timers, so socket timeouts, listen() callbacks and the like keep working
// while a test has jest.useFakeTimers() active.
JSC_DEFINE_HOST_FUNCTION(functionSetTimeoutInternal,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return scheduleTimer(globalObject, callFrame, "setTimeout"_s, Bun__Timer__setTimeoutInternal);
}

JSC_DEFINE_HOST_FUNCTION(functionSetIntervalInternal,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return scheduleTimer(globalObject, callFrame, "setInterval"_s, Bun__Timer__setIntervalInternal);
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

    return Bun__Timer__setImmediate(globalObject, JSC::JSValue::encode(job), JSValue::encode(arguments));
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

    return Bun__Timer__clearImmediate(globalObject, JSC::JSValue::encode(timer_or_num));
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

    return Bun__Timer__clearInterval(globalObject, JSC::JSValue::encode(timer_or_num));
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

    return Bun__Timer__clearTimeout(globalObject, JSC::JSValue::encode(timer_or_num));
}

} // namespace Bun
