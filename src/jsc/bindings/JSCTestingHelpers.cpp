#include "root.h"

#include "JavaScriptCore/ObjectConstructor.h"
#include <JavaScriptCore/JSGlobalObject.h>

#include <JavaScriptCore/JSString.h>
#include "ZigGlobalObject.h"

#include <JavaScriptCore/JSBigInt.h>
#include <JavaScriptCore/JSBigIntInlines.h>
#include <JavaScriptCore/RegExpObject.h>
#include <JavaScriptCore/YarrInterpreter.h>
#if OS(WINDOWS)
#include <JavaScriptCore/ExecutableAllocator.h>
#endif

extern "C" bool JSC__JSValue__isLiveCell(JSC::EncodedJSValue);

namespace Bun {
using namespace JSC;

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsUTF16String,
    (JSGlobalObject * globalObject,
        CallFrame* callframe))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue value = callframe->argument(0);
    if (value.isString()) {
        WTF::String string = value.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (string.is8Bit()) {
            return JSValue::encode(jsBoolean(false));
        }

        return JSValue::encode(jsBoolean(true));
    }

    throwTypeError(globalObject, scope, "Expected a string"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsLatin1String,
    (JSGlobalObject * globalObject,
        CallFrame* callframe))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue value = callframe->argument(0);
    if (value.isString()) {
        WTF::String string = value.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (string.is8Bit()) {
            return JSValue::encode(jsBoolean(true));
        }

        return JSValue::encode(jsBoolean(false));
    }

    throwTypeError(globalObject, scope, "Expected a string"_s);
    return {};
}

#if OS(WINDOWS)
JSC_DEFINE_HOST_FUNCTION(jsFunctionStartOfFixedExecutableMemoryPool,
    (JSGlobalObject * globalObject, CallFrame*))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    RELEASE_AND_RETURN(scope, JSValue::encode(JSBigInt::makeHeapBigIntOrBigInt32(globalObject, static_cast<uint64_t>(JSC::startOfFixedExecutableMemoryPool<uintptr_t>()))));
}
#endif

// Test-only stand-in for JsRef::Weak; the address is only meaningful until that cell is swept.
JSC_DEFINE_HOST_FUNCTION(jsFunctionRawCellAddress, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = callframe->argument(0);
    if (!value.isCell())
        return JSValue::encode(jsUndefined());
    RELEASE_AND_RETURN(scope, JSValue::encode(JSBigInt::makeHeapBigIntOrBigInt32(globalObject, static_cast<uint64_t>(JSValue::encode(value)))));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsLiveCellAtRawAddress, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    uint64_t bits = JSBigInt::toBigUInt64(callframe->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsBoolean(JSC__JSValue__isLiveCell(static_cast<JSC::EncodedJSValue>(bits))));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionCollectSyncWithoutSweep, (JSGlobalObject * globalObject, CallFrame*))
{
    JSC::getVM(globalObject).heap.collectSync(JSC::CollectionScope::Full);
    return JSValue::encode(jsUndefined());
}

// regExpMatchStatistics(regExp, string, startOffset = 0): one match, with the engine the RegExp is
// compiled for, as exec() does it. Reports that engine, and for JSC's non-backtracking matcher
// what the match cost and the most it can cost (maximumStepsPerPosition, maximumScratchBytes).
// The steps are counted, not timed, so a test can assert how they grow with the subject.
JSC_DEFINE_HOST_FUNCTION(jsFunctionRegExpMatchStatistics, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* regExpObject = dynamicDowncast<RegExpObject>(callframe->argument(0));
    if (!regExpObject) {
        throwTypeError(globalObject, scope, "Expected a RegExp"_s);
        return {};
    }
    WTF::String string = callframe->argument(1).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    uint32_t startOffset = callframe->argument(2).toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    Yarr::InterpretStatistics statistics;
    int index = regExpObject->regExp()->matchForTesting(globalObject, string, startOffset, statistics);
    RETURN_IF_EXCEPTION(scope, {});

    bool isLinear = statistics.engine == Yarr::InterpretStatistics::Engine::Linear;
    JSObject* result = JSC::constructEmptyObject(globalObject);
    result->putDirect(vm, JSC::Identifier::fromString(vm, "index"_s), jsNumber(index));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "engine"_s), jsNontrivialString(vm, isLinear ? "linear"_s : "backtracking"_s));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "refusal"_s), jsNontrivialString(vm, Yarr::linearRefusalName(statistics.refusal)));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "jit"_s), jsBoolean(statistics.usesJIT));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "programSize"_s), jsNumber(statistics.programSize));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "maximumStepsPerPosition"_s), jsNumber(static_cast<double>(statistics.maximumStepsPerPosition)));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "maximumScratchBytes"_s), jsNumber(static_cast<double>(statistics.maximumScratchBytes)));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "steps"_s), jsNumber(static_cast<double>(statistics.linear.steps)));
    result->putDirect(vm, JSC::Identifier::fromString(vm, "scratchBytes"_s), jsNumber(statistics.linear.scratchBytes));
    return JSValue::encode(result);
}

JSC::JSValue createJSCTestingHelpers(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* object = JSC::constructEmptyObject(globalObject);

    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "isUTF16String"_s), 1,
        jsFunctionIsUTF16String, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "isLatin1String"_s), 1,
        jsFunctionIsLatin1String, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "rawCellAddress"_s), 1,
        jsFunctionRawCellAddress, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "collectSyncWithoutSweep"_s), 0,
        jsFunctionCollectSyncWithoutSweep, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "isLiveCellAtRawAddress"_s), 1,
        jsFunctionIsLiveCellAtRawAddress, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "regExpMatchStatistics"_s), 3,
        jsFunctionRegExpMatchStatistics, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

#if OS(WINDOWS)
    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "startOfFixedExecutableMemoryPool"_s), 0,
        jsFunctionStartOfFixedExecutableMemoryPool, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
#endif

    return object;
}

} // namespace Bun
