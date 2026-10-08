#include "NodeTimers.h"

#include "AsyncContextFrame.h"
#include "BunProcess.h"
#include "ErrorCode.h"
#include "headers.h"
#include "NodeValidator.h"
#include "ScriptExecutionContext.h"
#include "ZigGlobalObject.h"
#include "InternalModuleRegistry.h"
#include <JavaScriptCore/GetterSetter.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSPromise.h>

extern "C" JSC::EncodedJSValue Bun__FakeTimers__setTimeout(JSC::JSGlobalObject*, JSC::EncodedJSValue callback, JSC::EncodedJSValue arguments, JSC::EncodedJSValue countdown);
extern "C" JSC::EncodedJSValue Bun__FakeTimers__setInterval(JSC::JSGlobalObject*, JSC::EncodedJSValue callback, JSC::EncodedJSValue arguments, JSC::EncodedJSValue countdown);
extern "C" JSC::EncodedJSValue Bun__FakeTimers__setImmediate(JSC::JSGlobalObject*, JSC::EncodedJSValue callback, JSC::EncodedJSValue arguments);
extern "C" JSC::EncodedJSValue Bun__FakeTimers__requestAnimationFrame(JSC::JSGlobalObject*, JSC::EncodedJSValue function, JSC::EncodedJSValue callback);
extern "C" void Bun__FakeTimers__queueTick(JSC::JSGlobalObject*, JSC::EncodedJSValue callback, JSC::EncodedJSValue arguments);
extern "C" bool Bun__FakeTimers__isInstalled(JSC::EncodedJSValue function);
extern "C" void Bun__FakeTimers__runStep(JSC::JSGlobalObject*, uint32_t id);

namespace Zig {
JSC_DECLARE_HOST_FUNCTION(functionQueueMicrotask);
}

namespace Bun {

using namespace JSC;

// What a timer keeps of the arguments for its callback: undefined for none, the value itself for one, a JSCellButterfly for more.
static ALWAYS_INLINE JSValue callbackArguments(JSGlobalObject* globalObject, ThrowScope& scope, CallFrame* callFrame, unsigned first)
{
    size_t argumentCount = callFrame->argumentCount();
    if (argumentCount <= first)
        return jsUndefined();
    if (argumentCount == first + 1)
        return callFrame->uncheckedArgument(first);

    auto* args = JSC::JSCellButterfly::tryCreateFromArgList(globalObject->vm(), ArgList(callFrame, first));
    if (!args) [[unlikely]] {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    return args;
}

static ALWAYS_INLINE void noteCallerForDebugger(VM& vm, CallFrame* callFrame)
{
#ifdef BUN_DEBUG
    /** View the file name of the JS file that called this function
     * from a debugger */
    SourceOrigin sourceOrigin = callFrame->callerSourceOrigin(vm);
    auto fileNameUTF8 = sourceOrigin.string().utf8();
    const char* fileName = fileNameUTF8.legacyCStringPointer();
    static const char* lastFileName = nullptr;
    if (lastFileName != fileName) {
        lastFileName = fileName;
    }
#else
    UNUSED_PARAM(vm);
    UNUSED_PARAM(callFrame);
#endif
}

using ScheduleTimer = JSC::EncodedJSValue (*)(JSC::JSGlobalObject*, JSC::EncodedJSValue callback, JSC::EncodedJSValue arguments, JSC::EncodedJSValue countdown);

static ALWAYS_INLINE EncodedJSValue scheduleTimer(JSGlobalObject* globalObject, CallFrame* callFrame, ScheduleTimer schedule, ASCIILiteral requiresAFunction, ASCIILiteral expectsAFunction)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue job = callFrame->argument(0);
    JSC::JSValue num = callFrame->argument(1);

    if (callFrame->argumentCount() == 0) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, requiresAFunction);
        return {};
    }

    JSC::JSValue arguments = callbackArguments(globalObject, scope, callFrame, 2);
    RETURN_IF_EXCEPTION(scope, {});

    if (!job.isObject() || !job.getObject()->isCallable()) [[unlikely]] {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, expectsAFunction);
        return {};
    }

    noteCallerForDebugger(vm, callFrame);

    RELEASE_AND_RETURN(scope, schedule(globalObject, JSC::JSValue::encode(job), JSC::JSValue::encode(arguments), JSValue::encode(num)));
}

using ScheduleImmediate = JSC::EncodedJSValue (*)(JSC::JSGlobalObject*, JSC::EncodedJSValue callback, JSC::EncodedJSValue arguments);

static ALWAYS_INLINE EncodedJSValue scheduleImmediate(JSGlobalObject* globalObject, CallFrame* callFrame, ScheduleImmediate schedule)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() == 0) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "setImmediate requires 1 argument (a function)"_s);
        return {};
    }

    auto job = callFrame->argument(0);

    if (!job.isObject() || !job.getObject()->isCallable()) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "setImmediate expects a function"_s);
        return {};
    }

    JSC::JSValue arguments = callbackArguments(globalObject, scope, callFrame, 1);
    RETURN_IF_EXCEPTION(scope, {});

    RELEASE_AND_RETURN(scope, schedule(globalObject, JSC::JSValue::encode(job), JSValue::encode(arguments)));
}

JSC_DEFINE_HOST_FUNCTION(functionSetTimeout,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return scheduleTimer(globalObject, callFrame, Bun__Timer__setTimeout, "setTimeout requires 1 argument (a function)"_s, "setTimeout expects a function"_s);
}

JSC_DEFINE_HOST_FUNCTION(functionSetInterval,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return scheduleTimer(globalObject, callFrame, Bun__Timer__setInterval, "setInterval requires 1 argument (a function)"_s, "setInterval expects a function"_s);
}

// https://developer.mozilla.org/en-US/docs/Web/API/Window/setImmediate
JSC_DEFINE_HOST_FUNCTION(functionSetImmediate,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return scheduleImmediate(globalObject, callFrame, Bun__Timer__setImmediate);
}

JSC_DEFINE_HOST_FUNCTION(functionClearImmediate,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    noteCallerForDebugger(JSC::getVM(globalObject), callFrame);
    return Bun__Timer__clearImmediate(globalObject, JSC::JSValue::encode(callFrame->argument(0)));
}

JSC_DEFINE_HOST_FUNCTION(functionClearInterval,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    noteCallerForDebugger(JSC::getVM(globalObject), callFrame);
    return Bun__Timer__clearInterval(globalObject, JSC::JSValue::encode(callFrame->argument(0)));
}

JSC_DEFINE_HOST_FUNCTION(functionClearTimeout,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    noteCallerForDebugger(JSC::getVM(globalObject), callFrame);
    return Bun__Timer__clearTimeout(globalObject, JSC::JSValue::encode(callFrame->argument(0)));
}

static JSC::EncodedJSValue timersPromisesExport(JSGlobalObject* lexicalGlobalObject, ASCIILiteral name)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSValue timersPromises = globalObject->internalModuleRegistry()->requireId(lexicalGlobalObject, vm, InternalModuleRegistry::Field::NodeTimersPromises);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(timersPromises.get(lexicalGlobalObject, Identifier::fromString(vm, name))));
}

JSC_DEFINE_HOST_FUNCTION(setTimeoutPromisifyCustomGetter, (JSGlobalObject * globalObject, CallFrame*))
{
    return timersPromisesExport(globalObject, "setTimeout"_s);
}

JSC_DEFINE_HOST_FUNCTION(setIntervalPromisifyCustomGetter, (JSGlobalObject * globalObject, CallFrame*))
{
    return timersPromisesExport(globalObject, "setInterval"_s);
}

JSC_DEFINE_HOST_FUNCTION(setImmediatePromisifyCustomGetter, (JSGlobalObject * globalObject, CallFrame*))
{
    return timersPromisesExport(globalObject, "setImmediate"_s);
}

static Identifier promisifyCustomSymbol(VM& vm)
{
    return Identifier::fromUid(vm.symbolRegistry().symbolForKey("nodejs.util.promisify.custom"_s));
}

static JSValue createTimerFunction(VM& vm, JSObject* owner, ASCIILiteral name, NativeFunction function, NativeFunction promisifyCustomGetter)
{
    auto* globalObject = owner->globalObject();
    auto* timerFunction = JSFunction::create(vm, globalObject, 1, name, function, ImplementationVisibility::Public);
    // Node's lib/timers.js shape: an enumerable, non-configurable, getter-only accessor. A CustomAccessor getter is cached per Structure, so each timer needs its own GetterSetter.
    auto* getter = JSFunction::create(vm, globalObject, 0, "get"_s, promisifyCustomGetter, ImplementationVisibility::Public);
    timerFunction->putDirectAccessor(globalObject,
        promisifyCustomSymbol(vm),
        GetterSetter::create(vm, globalObject, getter, jsUndefined()),
        PropertyAttribute::Accessor | PropertyAttribute::DontDelete | 0);
    return timerFunction;
}

JSValue createSetTimeoutFunction(VM& vm, JSObject* globalObject)
{
    return createTimerFunction(vm, globalObject, "setTimeout"_s, functionSetTimeout, setTimeoutPromisifyCustomGetter);
}

JSValue createSetIntervalFunction(VM& vm, JSObject* globalObject)
{
    return createTimerFunction(vm, globalObject, "setInterval"_s, functionSetInterval, setIntervalPromisifyCustomGetter);
}

JSValue createSetImmediateFunction(VM& vm, JSObject* globalObject)
{
    return createTimerFunction(vm, globalObject, "setImmediate"_s, functionSetImmediate, setImmediatePromisifyCustomGetter);
}

// The functions `jest.useFakeTimers()` puts in place of the real ones. What they schedule is on the fake clock
// for as long as they are installed: one that `jest.useRealTimers()` has taken off its owner does what the real one does.

static bool calleeIsInstalled(CallFrame* callFrame)
{
    return Bun__FakeTimers__isInstalled(JSValue::encode(callFrame->jsCallee()));
}

JSC_DEFINE_HOST_FUNCTION(functionFakeSetTimeout, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return scheduleTimer(globalObject, callFrame, calleeIsInstalled(callFrame) ? Bun__FakeTimers__setTimeout : Bun__Timer__setTimeout, "setTimeout requires 1 argument (a function)"_s, "setTimeout expects a function"_s);
}

JSC_DEFINE_HOST_FUNCTION(functionFakeSetInterval, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return scheduleTimer(globalObject, callFrame, calleeIsInstalled(callFrame) ? Bun__FakeTimers__setInterval : Bun__Timer__setInterval, "setInterval requires 1 argument (a function)"_s, "setInterval expects a function"_s);
}

JSC_DEFINE_HOST_FUNCTION(functionFakeSetImmediate, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return scheduleImmediate(globalObject, callFrame, calleeIsInstalled(callFrame) ? Bun__FakeTimers__setImmediate : Bun__Timer__setImmediate);
}

// util.promisify(setTimeout)(delay, value). `this` is bound to the `setTimeout` it is the promisified form of.
JSC_DEFINE_HOST_FUNCTION(functionFakeSetTimeoutPromisified, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
    auto schedule = Bun__FakeTimers__isInstalled(JSValue::encode(callFrame->thisValue())) ? Bun__FakeTimers__setTimeout : Bun__Timer__setTimeout;
    schedule(globalObject, JSValue::encode(promise), JSValue::encode(callFrame->argument(1)), JSValue::encode(callFrame->argument(0)));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(promise);
}

// util.promisify(setImmediate)(value). `this` is bound likewise.
JSC_DEFINE_HOST_FUNCTION(functionFakeSetImmediatePromisified, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
    auto schedule = Bun__FakeTimers__isInstalled(JSValue::encode(callFrame->thisValue())) ? Bun__FakeTimers__setImmediate : Bun__Timer__setImmediate;
    schedule(globalObject, JSValue::encode(promise), JSValue::encode(callFrame->argument(0)));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(promise);
}

static EncodedJSValue queueFakeTick(JSGlobalObject* globalObject, CallFrame* callFrame, unsigned firstArgument)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    JSValue callback = callFrame->argument(0);
    V::validateFunction(scope, globalObject, callback, "callback"_s);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue arguments = callbackArguments(globalObject, scope, callFrame, firstArgument);
    RETURN_IF_EXCEPTION(scope, {});
    Bun__FakeTimers__queueTick(globalObject, JSValue::encode(AsyncContextFrame::withAsyncContextIfNeeded(globalObject, callback)), JSValue::encode(arguments));
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(functionFakeNextTick, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    if (calleeIsInstalled(callFrame))
        return queueFakeTick(globalObject, callFrame, 1);

    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    V::validateFunction(scope, globalObject, callFrame->argument(0), "callback"_s);
    RETURN_IF_EXCEPTION(scope, {});
    defaultGlobalObject(globalObject)->processObject()->queueNextTick(globalObject, ArgList(callFrame));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(functionFakeQueueMicrotask, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    if (calleeIsInstalled(callFrame))
        return queueFakeTick(globalObject, callFrame, callFrame->argumentCount());
    return Zig::functionQueueMicrotask(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(functionFakeRequestAnimationFrame, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue callback = callFrame->argument(0);
    V::validateFunction(scope, globalObject, callback, "callback"_s);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, Bun__FakeTimers__requestAnimationFrame(globalObject, JSValue::encode(callFrame->jsCallee()), JSValue::encode(callback)));
}

// The values of `Api` in FakeTimers.rs.
enum class FakeTimerFunction : uint8_t {
    SetTimeout,
    ClearTimeout,
    SetInterval,
    ClearInterval,
    SetImmediate,
    ClearImmediate,
    NextTick,
    QueueMicrotask,
    RequestAnimationFrame,
    CancelAnimationFrame,
};

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue Bun__FakeTimers__createFunction(Zig::GlobalObject* globalObject, uint8_t function)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto create = [&](ASCIILiteral name, NativeFunction implementation) {
        return JSFunction::create(vm, globalObject, 1, name, implementation, ImplementationVisibility::Public);
    };
    auto createPromisified = [&](JSFunction* timerFunction, ASCIILiteral name, NativeFunction implementation) {
        return JSBoundFunction::create(vm, globalObject, create(name, implementation), timerFunction, ArgList(), 1, nullptr, makeSource(String(), SourceOrigin(), SourceTaintedOrigin::Untainted));
    };
    switch (static_cast<FakeTimerFunction>(function)) {
    case FakeTimerFunction::SetTimeout: {
        auto* setTimeout = create("setTimeout"_s, functionFakeSetTimeout);
        auto* promisified = createPromisified(setTimeout, "setTimeout"_s, functionFakeSetTimeoutPromisified);
        RETURN_IF_EXCEPTION(scope, {});
        setTimeout->putDirect(vm, promisifyCustomSymbol(vm), promisified);
        // @testing-library/dom takes an own `clock` property of `setTimeout` to mean that Jest's fake timers are on.
        setTimeout->putDirect(vm, Identifier::fromString(vm, "clock"_s), jsBoolean(true));
        return JSValue::encode(setTimeout);
    }
    case FakeTimerFunction::ClearTimeout:
        return JSValue::encode(create("clearTimeout"_s, functionClearTimeout));
    case FakeTimerFunction::SetInterval:
        return JSValue::encode(create("setInterval"_s, functionFakeSetInterval));
    case FakeTimerFunction::ClearInterval:
        return JSValue::encode(create("clearInterval"_s, functionClearInterval));
    case FakeTimerFunction::SetImmediate: {
        auto* setImmediate = create("setImmediate"_s, functionFakeSetImmediate);
        auto* promisified = createPromisified(setImmediate, "setImmediate"_s, functionFakeSetImmediatePromisified);
        RETURN_IF_EXCEPTION(scope, {});
        setImmediate->putDirect(vm, promisifyCustomSymbol(vm), promisified);
        return JSValue::encode(setImmediate);
    }
    case FakeTimerFunction::ClearImmediate:
        return JSValue::encode(create("clearImmediate"_s, functionClearImmediate));
    case FakeTimerFunction::NextTick:
        return JSValue::encode(create("nextTick"_s, functionFakeNextTick));
    case FakeTimerFunction::QueueMicrotask:
        return JSValue::encode(create("queueMicrotask"_s, functionFakeQueueMicrotask));
    case FakeTimerFunction::RequestAnimationFrame:
        return JSValue::encode(create("requestAnimationFrame"_s, functionFakeRequestAnimationFrame));
    case FakeTimerFunction::CancelAnimationFrame:
        return JSValue::encode(create("cancelAnimationFrame"_s, functionClearTimeout));
    }
    RELEASE_ASSERT_NOT_REACHED();
}

// node:timers and node:timers/promises keep the functions that are the globals when they are first loaded.
extern "C" [[ZIG_EXPORT(check_slow)]] void Bun__FakeTimers__loadNodeTimers(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    globalObject->internalModuleRegistry()->requireId(globalObject, vm, InternalModuleRegistry::Field::NodeTimers);
    RETURN_IF_EXCEPTION(scope, );
    globalObject->internalModuleRegistry()->requireId(globalObject, vm, InternalModuleRegistry::Field::NodeTimersPromises);
    RETURN_IF_EXCEPTION(scope, );
}

extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue Bun__FakeTimers__processObject(Zig::GlobalObject* globalObject)
{
    return JSValue::encode(globalObject->processObject());
}

// NaN: `setSystemTime()` has not set a time.
extern "C" [[ZIG_EXPORT(nothrow)]] double Bun__FakeTimers__overriddenDateNow(JSC::JSGlobalObject* globalObject)
{
    return globalObject->overridenDateNow;
}

extern "C" [[ZIG_EXPORT(nothrow)]] void Bun__FakeTimers__postStep(Zig::GlobalObject* globalObject, uint32_t id)
{
    globalObject->scriptExecutionContext()->postTaskAfterYield([id](WebCore::ScriptExecutionContext& context) {
        Bun__FakeTimers__runStep(context.globalObject(), id);
    });
}

} // namespace Bun
