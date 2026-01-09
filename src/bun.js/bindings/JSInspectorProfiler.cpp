#include "root.h"
#include "BunString.h"
#include "helpers.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/VM.h>

using namespace JSC;

extern "C" void Bun__startCPUProfiler(JSC::VM* vm);
extern "C" BunString Bun__stopCPUProfilerAndGetJSON(JSC::VM* vm);
extern "C" void Bun__setCPUSamplingInterval(int intervalMicroseconds);
extern "C" bool Bun__isCPUProfilerRunning();

JSC_DECLARE_HOST_FUNCTION(jsFunction_startCPUProfiler);
JSC_DEFINE_HOST_FUNCTION(jsFunction_startCPUProfiler, (JSGlobalObject* globalObject, CallFrame*))
{
    Bun__startCPUProfiler(&globalObject->vm());
    return JSValue::encode(jsUndefined());
}

JSC_DECLARE_HOST_FUNCTION(jsFunction_stopCPUProfiler);
JSC_DEFINE_HOST_FUNCTION(jsFunction_stopCPUProfiler, (JSGlobalObject* globalObject, CallFrame*))
{
    BunString result = Bun__stopCPUProfilerAndGetJSON(&globalObject->vm());

    if (result.tag == BunStringTag::Empty || result.tag == BunStringTag::Dead) {
        return JSValue::encode(jsEmptyString(globalObject->vm()));
    }

    WTF::String wtfString = result.toWTFString();
    result.deref();

    return JSValue::encode(jsString(globalObject->vm(), wtfString));
}

JSC_DECLARE_HOST_FUNCTION(jsFunction_setCPUSamplingInterval);
JSC_DEFINE_HOST_FUNCTION(jsFunction_setCPUSamplingInterval, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "setSamplingInterval requires an interval argument"_s);
        return {};
    }

    JSValue intervalArg = callFrame->uncheckedArgument(0);
    if (!intervalArg.isNumber()) {
        throwTypeError(globalObject, scope, "interval must be a number"_s);
        return {};
    }

    int interval = static_cast<int>(intervalArg.asNumber());
    if (interval <= 0) {
        throwRangeError(globalObject, scope, "interval must be a positive number"_s);
        return {};
    }

    Bun__setCPUSamplingInterval(interval);
    return JSValue::encode(jsUndefined());
}

JSC_DECLARE_HOST_FUNCTION(jsFunction_isCPUProfilerRunning);
JSC_DEFINE_HOST_FUNCTION(jsFunction_isCPUProfilerRunning, (JSGlobalObject*, CallFrame*))
{
    return JSValue::encode(jsBoolean(Bun__isCPUProfilerRunning()));
}
