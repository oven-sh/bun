#include "root.h"
#include "_NativeModule.h"

#include "ExceptionOr.h"
#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/JSNativeStdFunction.h"
#include "MessagePort.h"
#include "SerializedScriptValue.h"
#include <JavaScriptCore/APICast.h>
#include <JavaScriptCore/AggregateError.h>
#include <JavaScriptCore/BytecodeIndex.h>
#include <JavaScriptCore/CallFrameInlines.h>
#include <JavaScriptCore/ClassInfo.h>
#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/DeferTermination.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/HeapSnapshotBuilder.h>
#include <JavaScriptCore/JIT.h>
#include <JavaScriptCore/JSBasePrivate.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSONObject.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JavaScript.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SamplingProfiler.h>
#include <JavaScriptCore/TestRunnerUtils.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <algorithm>
#include <cstddef>
#include <wtf/FileSystem.h>
#include <wtf/MemoryFootprint.h>
#include <wtf/text/WTFString.h>

#include "BunProcess.h"
#include <JavaScriptCore/SourceProviderCache.h>
#if ENABLE(REMOTE_INSPECTOR)
#include <JavaScriptCore/RemoteInspectorServer.h>
#endif

#include "JSDOMConvertBase.h"
#include "ZigSourceProvider.h"
#include "mimalloc.h"

#include <JavaScriptCore/ControlFlowProfiler.h>

#if OS(DARWIN)
#if ASSERT_ENABLED
#if !__has_feature(address_sanitizer)
#include <malloc/malloc.h>
#define IS_MALLOC_DEBUGGING_ENABLED 1
#endif
#endif
#endif

extern "C" size_t Bun__Feature__heap_snapshot;

using namespace JSC;
using namespace WTF;
using namespace WebCore;

JSC_DECLARE_HOST_FUNCTION(functionStartRemoteDebugger);
JSC_DEFINE_HOST_FUNCTION(functionStartRemoteDebugger,
    (JSGlobalObject * globalObject,
        CallFrame* callFrame))
{
#if ENABLE(REMOTE_INSPECTOR)
    static const char* defaultHost = "127.0.0.1\0";
    static uint16_t defaultPort = 9230; // node + 1

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue hostValue = callFrame->argument(0);
    JSC::JSValue portValue = callFrame->argument(1);
    const char* host = defaultHost;
    if (hostValue.isString()) {

        auto str = hostValue.toWTFString(globalObject);
        if (!str.isEmpty())
            host = toCString(str).span().data();
    } else if (!hostValue.isUndefined()) {
        throwVMError(globalObject, scope,
            createTypeError(globalObject, "host must be a string"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    uint16_t port = defaultPort;
    if (portValue.isNumber()) {
        auto port_int = portValue.toUInt32(globalObject);
        if (!(port_int > 0 && port_int < 65536)) {
            throwVMError(
                globalObject, scope,
                createRangeError(globalObject, "port must be between 0 and 65535"_s));
            return JSC::JSValue::encode(JSC::jsUndefined());
        }
        port = port_int;
    } else if (!portValue.isUndefined()) {
        throwVMError(
            globalObject, scope,
            createTypeError(globalObject,
                "port must be a number between 0 and 65535"_s));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    globalObject->setInspectable(true);
    auto& server = Inspector::RemoteInspectorServer::singleton();
    if (!server.start(reinterpret_cast<const char*>(host), port)) {
        throwVMError(
            globalObject, scope,
            createError(globalObject,
                makeString("Failed to start server \""_s,
                    String::fromLatin1(host),
                    ":"_s, port, "\". Is port already in use?"_s)));
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::jsUndefined()));
#else
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    throwVMError(globalObject, scope,
        createTypeError(
            globalObject,
            "Remote inspector is not enabled in this build of Bun"_s));
    return JSC::JSValue::encode(JSC::jsUndefined());
#endif
}

JSC_DECLARE_HOST_FUNCTION(functionDescribe);
JSC_DEFINE_HOST_FUNCTION(functionDescribe, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    if (callFrame->argumentCount() < 1)
        return JSValue::encode(jsUndefined());
    return JSValue::encode(jsString(vm, toString(callFrame->argument(0))));
}

JSC_DECLARE_HOST_FUNCTION(functionDescribeArray);
JSC_DEFINE_HOST_FUNCTION(functionDescribeArray, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    if (callFrame->argumentCount() < 1)
        return JSValue::encode(jsUndefined());
    VM& vm = globalObject->vm();
    JSObject* object = jsDynamicCast<JSObject*>(callFrame->argument(0));
    if (!object)
        return JSValue::encode(jsNontrivialString(vm, "<not object>"_s));
    return JSValue::encode(jsNontrivialString(
        vm, toString("<Butterfly: ", RawPointer(object->butterfly()), "; public length: ", object->getArrayLength(), "; vector length: ", object->getVectorLength(), ">")));
}

JSC_DECLARE_HOST_FUNCTION(functionGCAndSweep);
JSC_DEFINE_HOST_FUNCTION(functionGCAndSweep,
    (JSGlobalObject * globalObject, CallFrame*))
{
    VM& vm = globalObject->vm();
    JSLockHolder lock(vm);
    vm.heap.collectNow(Sync, CollectionScope::Full);
    return JSValue::encode(jsNumber(vm.heap.sizeAfterLastFullCollection()));
}

JSC_DECLARE_HOST_FUNCTION(functionFullGC);
JSC_DEFINE_HOST_FUNCTION(functionFullGC,
    (JSGlobalObject * globalObject, CallFrame*))
{
    VM& vm = globalObject->vm();
    JSLockHolder lock(vm);
    vm.heap.collectSync(CollectionScope::Full);
    return JSValue::encode(jsNumber(vm.heap.sizeAfterLastFullCollection()));
}

JSC_DECLARE_HOST_FUNCTION(functionEdenGC);
JSC_DEFINE_HOST_FUNCTION(functionEdenGC,
    (JSGlobalObject * globalObject, CallFrame*))
{
    VM& vm = globalObject->vm();
    JSLockHolder lock(vm);
    vm.heap.collectSync(CollectionScope::Eden);
    return JSValue::encode(jsNumber(vm.heap.sizeAfterLastEdenCollection()));
}

JSC_DECLARE_HOST_FUNCTION(functionHeapSize);
JSC_DEFINE_HOST_FUNCTION(functionHeapSize,
    (JSGlobalObject * globalObject, CallFrame*))
{
    VM& vm = globalObject->vm();
    JSLockHolder lock(vm);
    return JSValue::encode(jsNumber(vm.heap.size()));
}

JSC::Structure*
createMemoryFootprintStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{

    JSC::Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(
        globalObject, globalObject->objectPrototype(), 5);
    JSC::PropertyOffset offset;

    structure = structure->addPropertyTransition(
        vm, structure, Identifier::fromString(vm, "current"_s), 0, offset);
    structure = structure->addPropertyTransition(
        vm, structure, Identifier::fromString(vm, "peak"_s), 0, offset);
    structure = structure->addPropertyTransition(
        vm, structure, Identifier::fromString(vm, "currentCommit"_s), 0, offset);
    structure = structure->addPropertyTransition(
        vm, structure, Identifier::fromString(vm, "peakCommit"_s), 0, offset);
    structure = structure->addPropertyTransition(
        vm, structure, Identifier::fromString(vm, "pageFaults"_s), 0, offset);

    return structure;
}

JSC_DECLARE_HOST_FUNCTION(functionMemoryUsageStatistics);
JSC_DEFINE_HOST_FUNCTION(functionMemoryUsageStatistics,
    (JSGlobalObject * globalObject, CallFrame*))
{

    auto& vm = JSC::getVM(globalObject);

    if (vm.heap.size() == 0) {
        vm.heap.collectNow(Sync, CollectionScope::Full);
    }

    const auto createdSortedTypeCounts =
        [&](JSC::TypeCountSet const& typeCounts) -> JSC::JSValue {
        WTF::Vector<std::pair<Identifier, unsigned>> counts;
        counts.reserveInitialCapacity(typeCounts.size());
        for (auto& it : typeCounts) {
            if (it.value > 0)
                counts.append(
                    std::make_pair(Identifier::fromString(vm, it.key), it.value));
        }

        // Sort by count first, then by name.
        std::sort(counts.begin(), counts.end(),
            [](const std::pair<Identifier, unsigned>& a,
                const std::pair<Identifier, unsigned>& b) {
                if (a.second == b.second) {
                    WTF::StringView left = a.first.string();
                    WTF::StringView right = b.first.string();
                    unsigned originalLeftLength = left.length();
                    unsigned originalRightLength = right.length();
                    unsigned size = std::min(left.length(), right.length());
                    left = left.substring(0, size);
                    right = right.substring(0, size);
                    std::strong_ordering result = WTF::codePointCompare(right, left);
                    if (result == std::strong_ordering::equal) {
                        return originalLeftLength > originalRightLength;
                    }

                    return result == std::strong_ordering::greater;
                }

                return a.second > b.second;
            });

        auto* objectTypeCounts = constructEmptyObject(globalObject);
        for (auto& it : counts) {
            objectTypeCounts->putDirect(vm, it.first, jsNumber(it.second));
        }
        return objectTypeCounts;
    };

    JSValue objectTypeCounts = createdSortedTypeCounts(vm.heap.objectTypeCounts());
    JSValue protectedCounts = createdSortedTypeCounts(vm.heap.protectedObjectTypeCounts());

    JSObject* object = constructEmptyObject(globalObject);
    object->putDirect(vm, Identifier::fromString(vm, "objectTypeCounts"_s),
        objectTypeCounts);

    object->putDirect(vm,
        Identifier::fromString(vm, "protectedObjectTypeCounts"_s),
        protectedCounts);
    object->putDirect(vm, Identifier::fromString(vm, "heapSize"_s),
        jsNumber(vm.heap.size()));
    object->putDirect(vm, Identifier::fromString(vm, "heapCapacity"_s),
        jsNumber(vm.heap.capacity()));
    object->putDirect(vm, Identifier::fromString(vm, "extraMemorySize"_s),
        jsNumber(vm.heap.extraMemorySize()));
    object->putDirect(vm, Identifier::fromString(vm, "objectCount"_s),
        jsNumber(vm.heap.objectCount()));
    object->putDirect(vm, Identifier::fromString(vm, "protectedObjectCount"_s),
        jsNumber(vm.heap.protectedObjectCount()));
    object->putDirect(vm, Identifier::fromString(vm, "globalObjectCount"_s),
        jsNumber(vm.heap.globalObjectCount()));
    object->putDirect(vm,
        Identifier::fromString(vm, "protectedGlobalObjectCount"_s),
        jsNumber(vm.heap.protectedGlobalObjectCount()));

#if IS_MALLOC_DEBUGGING_ENABLED
#if OS(DARWIN)
    {
        vm_address_t* zones;
        unsigned count;

        // Zero out the structures in case a zone is missing
        malloc_statistics_t zone_stats;
        zone_stats.blocks_in_use = 0;
        zone_stats.size_in_use = 0;
        zone_stats.max_size_in_use = 0;
        zone_stats.size_allocated = 0;

        malloc_zone_pressure_relief(nullptr, 0);
        malloc_get_all_zones(mach_task_self(), 0, &zones, &count);
        Vector<std::pair<Identifier, size_t>> zoneSizes;
        zoneSizes.reserveInitialCapacity(count);
        for (unsigned i = 0; i < count; i++) {
            auto zone = reinterpret_cast<malloc_zone_t*>(zones[i]);
            if (const char* name = malloc_get_zone_name(zone)) {
                malloc_zone_statistics(reinterpret_cast<malloc_zone_t*>(zones[i]),
                    &zone_stats);
                zoneSizes.append(
                    std::make_pair(Identifier::fromString(vm, String::fromUTF8(name)),
                        zone_stats.size_in_use));
            }
        }

        std::sort(zoneSizes.begin(), zoneSizes.end(),
            [](const std::pair<Identifier, size_t>& a,
                const std::pair<Identifier, size_t>& b) {
                // Sort by name if the sizes are the same.
                if (a.second == b.second) {
                    WTF::StringView left = a.first.string();
                    WTF::StringView right = b.first.string();
                    unsigned originalLeftLength = left.length();
                    unsigned originalRightLength = right.length();
                    unsigned size = std::min(left.length(), right.length());
                    left = left.substring(0, size);
                    right = right.substring(0, size);
                    std::strong_ordering result = WTF::codePointCompare(right, left);
                    if (result == std::strong_ordering::equal) {
                        return originalLeftLength > originalRightLength;
                    }

                    return result == std::strong_ordering::greater;
                }

                return a.second > b.second;
            });

        auto* zoneSizesObject = constructEmptyObject(globalObject);
        for (auto& it : zoneSizes) {
            zoneSizesObject->putDirect(vm, it.first, jsNumber(it.second));
        }

        object->putDirect(vm, Identifier::fromString(vm, "zones"_s),
            zoneSizesObject);
    }
#endif
#endif

    return JSValue::encode(object);
}

JSC_DECLARE_HOST_FUNCTION(functionCreateMemoryFootprint);
JSC_DEFINE_HOST_FUNCTION(functionCreateMemoryFootprint,
    (JSGlobalObject * globalObject, CallFrame*))
{

    size_t elapsed_msecs = 0;
    size_t user_msecs = 0;
    size_t system_msecs = 0;
    size_t current_rss = 0;
    size_t peak_rss = 0;
    size_t current_commit = 0;
    size_t peak_commit = 0;
    size_t page_faults = 0;

    mi_process_info(&elapsed_msecs, &user_msecs, &system_msecs, &current_rss,
        &peak_rss, &current_commit, &peak_commit, &page_faults);

    // mi_process_info produces incorrect rss size on linux.
    Bun::getRSS(&current_rss);

    VM& vm = globalObject->vm();
    JSC::JSObject* object = JSC::constructEmptyObject(
        vm, JSC::jsCast<Zig::GlobalObject*>(globalObject)->memoryFootprintStructure());

    object->putDirectOffset(vm, 0, jsNumber(current_rss));
    object->putDirectOffset(vm, 1, jsNumber(peak_rss));
    object->putDirectOffset(vm, 2, jsNumber(current_commit));
    object->putDirectOffset(vm, 3, jsNumber(peak_commit));
    object->putDirectOffset(vm, 4, jsNumber(page_faults));

    return JSValue::encode(object);
}

JSC_DECLARE_HOST_FUNCTION(functionNeverInlineFunction);
JSC_DEFINE_HOST_FUNCTION(functionNeverInlineFunction,
    (JSGlobalObject * globalObject,
        CallFrame* callFrame))
{
    return JSValue::encode(setNeverInline(globalObject, callFrame));
}

extern "C" bool Bun__mkdirp(JSC::JSGlobalObject*, const char*);

JSC_DECLARE_HOST_FUNCTION(functionStartSamplingProfiler);
JSC_DEFINE_HOST_FUNCTION(functionStartSamplingProfiler,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    JSC::SamplingProfiler& samplingProfiler = vm.ensureSamplingProfiler(WTF::Stopwatch::create());

    JSC::JSValue directoryValue = callFrame->argument(0);
    JSC::JSValue sampleValue = callFrame->argument(1);

    auto scope = DECLARE_THROW_SCOPE(vm);
    if (directoryValue.isString()) {
        auto path = directoryValue.toWTFString(globalObject);
        if (!path.isEmpty()) {
            StringPrintStream pathOut;
            auto pathCString = toCString(String(path));
            if (!Bun__mkdirp(globalObject, pathCString.span().data())) {
                throwVMError(
                    globalObject, scope,
                    createTypeError(globalObject, "directory couldn't be created"_s));
                return {};
            }

            Options::samplingProfilerPath() = pathCString.span().data();
            samplingProfiler.registerForReportAtExit();
        }
    }
    if (sampleValue.isNumber()) {
        unsigned sampleInterval = sampleValue.toUInt32(globalObject);
        samplingProfiler.setTimingInterval(
            Seconds::fromMicroseconds(sampleInterval));
    }

    samplingProfiler.noticeCurrentThreadAsJSCExecutionThread();
    samplingProfiler.start();
    return JSC::JSValue::encode(jsUndefined());
}

JSC_DECLARE_HOST_FUNCTION(functionSamplingProfilerStackTraces);
JSC_DEFINE_HOST_FUNCTION(functionSamplingProfilerStackTraces,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame*))
{
    auto& vm = JSC::getVM(globalObject);
    JSC::DeferTermination deferScope(vm);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!vm.samplingProfiler())
        return JSC::JSValue::encode(throwException(
            globalObject, scope,
            createError(globalObject, "Sampling profiler was never started"_s)));

    WTF::String jsonString = vm.samplingProfiler()->stackTracesAsJSON()->toJSONString();
    JSC::EncodedJSValue result = JSC::JSValue::encode(JSONParse(globalObject, jsonString));
    scope.releaseAssertNoException();
    return result;
}

JSC_DECLARE_HOST_FUNCTION(functionGetRandomSeed);
JSC_DEFINE_HOST_FUNCTION(functionGetRandomSeed,
    (JSGlobalObject * globalObject, CallFrame*))
{
    return JSValue::encode(jsNumber(globalObject->weakRandom().seed()));
}

JSC_DECLARE_HOST_FUNCTION(functionSetRandomSeed);
JSC_DEFINE_HOST_FUNCTION(functionSetRandomSeed, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    unsigned seed = callFrame->argument(0).toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    globalObject->weakRandom().setSeed(seed);
    return JSValue::encode(jsUndefined());
}

JSC_DECLARE_HOST_FUNCTION(functionIsRope);
JSC_DEFINE_HOST_FUNCTION(functionIsRope,
    (JSGlobalObject*, CallFrame* callFrame))
{
    JSValue argument = callFrame->argument(0);
    if (!argument.isString())
        return JSValue::encode(jsBoolean(false));
    const StringImpl* impl = asString(argument)->tryGetValueImpl();
    return JSValue::encode(jsBoolean(!impl));
}

JSC_DECLARE_HOST_FUNCTION(functionCallerSourceOrigin);
JSC_DEFINE_HOST_FUNCTION(functionCallerSourceOrigin,
    (JSGlobalObject * globalObject,
        CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    SourceOrigin sourceOrigin = callFrame->callerSourceOrigin(vm);
    if (sourceOrigin.url().isNull())
        return JSValue::encode(jsNull());
    return JSValue::encode(jsString(vm, sourceOrigin.string()));
}

JSC_DECLARE_HOST_FUNCTION(functionNoFTL);
JSC_DEFINE_HOST_FUNCTION(functionNoFTL,
    (JSGlobalObject*, CallFrame* callFrame))
{
    if (callFrame->argumentCount()) {
        FunctionExecutable* executable = getExecutableForFunction(callFrame->argument(0));
        if (executable)
            executable->setNeverFTLOptimize(true);
    }
    return JSValue::encode(jsUndefined());
}

JSC_DECLARE_HOST_FUNCTION(functionNoOSRExitFuzzing);
JSC_DEFINE_HOST_FUNCTION(functionNoOSRExitFuzzing,
    (JSGlobalObject * globalObject,
        CallFrame* callFrame))
{
    return JSValue::encode(setCannotUseOSRExitFuzzing(globalObject, callFrame));
}

JSC_DECLARE_HOST_FUNCTION(functionOptimizeNextInvocation);
JSC_DEFINE_HOST_FUNCTION(functionOptimizeNextInvocation,
    (JSGlobalObject * globalObject,
        CallFrame* callFrame))
{
    return JSValue::encode(optimizeNextInvocation(globalObject, callFrame));
}

JSC_DECLARE_HOST_FUNCTION(functionNumberOfDFGCompiles);
JSC_DEFINE_HOST_FUNCTION(functionNumberOfDFGCompiles,
    (JSGlobalObject * globalObject,
        CallFrame* callFrame))
{
    return JSValue::encode(numberOfDFGCompiles(globalObject, callFrame));
}

JSC_DECLARE_HOST_FUNCTION(functionReleaseWeakRefs);
JSC_DEFINE_HOST_FUNCTION(functionReleaseWeakRefs,
    (JSGlobalObject * globalObject,
        CallFrame* callFrame))
{
    globalObject->vm().finalizeSynchronousJSExecution();
    return JSValue::encode(jsUndefined());
}

JSC_DECLARE_HOST_FUNCTION(functionTotalCompileTime);
JSC_DEFINE_HOST_FUNCTION(functionTotalCompileTime,
    (JSGlobalObject*, CallFrame*))
{
    return JSValue::encode(jsNumber(JIT::totalCompileTime().milliseconds()));
}

JSC_DECLARE_HOST_FUNCTION(functionGetProtectedObjects);
JSC_DEFINE_HOST_FUNCTION(functionGetProtectedObjects,
    (JSGlobalObject * globalObject, CallFrame*))
{
    MarkedArgumentBuffer list;
    globalObject->vm().heap.forEachProtectedCell(
        [&](JSCell* cell) { list.append(cell); });
    RELEASE_ASSERT(!list.hasOverflowed());
    return JSC::JSValue::encode(constructArray(
        globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), list));
}

JSC_DECLARE_HOST_FUNCTION(functionReoptimizationRetryCount);
JSC_DEFINE_HOST_FUNCTION(functionReoptimizationRetryCount,
    (JSGlobalObject*, CallFrame* callFrame))
{
    if (callFrame->argumentCount() < 1)
        return JSValue::encode(jsUndefined());

    CodeBlock* block = getSomeBaselineCodeBlockForFunction(callFrame->argument(0));
    if (!block)
        return JSValue::encode(jsNumber(0));

    return JSValue::encode(jsNumber(block->reoptimizationRetryCounter()));
}

extern "C" void Bun__drainMicrotasks();

JSC_DECLARE_HOST_FUNCTION(functionDrainMicrotasks);
JSC_DEFINE_HOST_FUNCTION(functionDrainMicrotasks,
    (JSGlobalObject * globalObject, CallFrame*))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    vm.drainMicrotasks();
    RETURN_IF_EXCEPTION(scope, {});
    Bun__drainMicrotasks();
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(functionSetTimeZone, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope,
            "setTimeZone requires a timezone string"_s);
        return {};
    }

    if (!callFrame->argument(0).isString()) {
        throwTypeError(globalObject, scope,
            "setTimeZone requires a timezone string"_s);
        return {};
    }

    String timeZoneName = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (!WTF::setTimeZoneOverride(timeZoneName)) {
        throwTypeError(globalObject, scope,
            makeString("Invalid timezone: \""_s, timeZoneName, "\""_s));
        return {};
    }
    vm.dateCache.resetIfNecessarySlow();
    WTF::Vector<char16_t, 32> buffer;
    WTF::getTimeZoneOverride(buffer);
    WTF::String timeZoneString(buffer.span());
    return JSValue::encode(jsString(vm, timeZoneString));
}

JSC_DEFINE_HOST_FUNCTION(functionRunProfiler, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    JSC::SamplingProfiler& samplingProfiler = vm.ensureSamplingProfiler(WTF::Stopwatch::create());

    JSC::JSValue callbackValue = callFrame->argument(0);
    JSC::JSValue sampleValue = callFrame->argument(1);

    MarkedArgumentBuffer args;

    if (callFrame->argumentCount() > 2) {
        size_t count = callFrame->argumentCount();
        args.ensureCapacity(count - 2);
        for (size_t i = 2; i < count; i++) {
            args.append(callFrame->argument(i));
        }
    }

    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (callbackValue.isUndefinedOrNull() || !callbackValue.isCallable()) {
        throwException(globalObject, throwScope, createTypeError(globalObject, "First argument must be a function."_s));
        return JSValue::encode(JSValue {});
    }

    JSC::JSFunction* function = jsCast<JSC::JSFunction*>(callbackValue);

    if (sampleValue.isNumber()) {
        unsigned sampleInterval = sampleValue.toUInt32(globalObject);
        samplingProfiler.setTimingInterval(Seconds::fromMicroseconds(sampleInterval));
    } else {
        // Reset to default interval (1000 microseconds) to ensure each profile()
        // call is independent of previous calls
        samplingProfiler.setTimingInterval(Seconds::fromMicroseconds(1000));
    }

    const auto report = [](JSC::VM& vm,
                            JSC::JSGlobalObject* globalObject) -> JSC::JSValue {
        auto throwScope = DECLARE_THROW_SCOPE(vm);

        auto& samplingProfiler = *vm.samplingProfiler();
        StringPrintStream topFunctions;
        samplingProfiler.reportTopFunctions(topFunctions);

        StringPrintStream byteCodes;
        samplingProfiler.reportTopBytecodes(byteCodes);

        JSValue stackTraces = JSONParse(globalObject, samplingProfiler.stackTracesAsJSON()->toJSONString());

        // Use pause() instead of shutdown() to allow the profiler to be restarted
        // shutdown() sets m_isShutDown=true which is never reset, making the profiler unusable
        {
            auto& lock = samplingProfiler.getLock();
            WTF::Locker locker { lock };
            samplingProfiler.pause();
            samplingProfiler.clearData();
        }
        RETURN_IF_EXCEPTION(throwScope, {});

        JSObject* result = constructEmptyObject(globalObject, globalObject->objectPrototype(), 3);
        result->putDirect(vm, Identifier::fromString(vm, "functions"_s), jsString(vm, topFunctions.toString()));
        result->putDirect(vm, Identifier::fromString(vm, "bytecodes"_s), jsString(vm, byteCodes.toString()));
        result->putDirect(vm, Identifier::fromString(vm, "stackTraces"_s), stackTraces);

        return result;
    };
    const auto reportFailure = [](JSC::VM& vm) -> JSC::JSValue {
        if (auto* samplingProfiler = vm.samplingProfiler()) {
            auto& lock = samplingProfiler->getLock();
            WTF::Locker locker { lock };
            samplingProfiler->pause();
            samplingProfiler->clearData();
        }

        return {};
    };

    JSC::CallData callData = JSC::getCallData(function);

    samplingProfiler.noticeCurrentThreadAsJSCExecutionThread();
    samplingProfiler.start();
    JSValue returnValue = JSC::profiledCall(globalObject, ProfilingReason::API, function, callData, JSC::jsUndefined(), args);

    if (returnValue.isEmpty() || throwScope.exception()) {
        return JSValue::encode(reportFailure(vm));
    }

    if (auto* promise = jsDynamicCast<JSPromise*>(returnValue)) {
        auto afterOngoingPromiseCapability = JSC::JSPromise::create(vm, globalObject->promiseStructure());
        RETURN_IF_EXCEPTION(throwScope, {});

        JSNativeStdFunction* resolve = JSNativeStdFunction::create(
            vm, globalObject, 0, "resolve"_s,
            [report](JSGlobalObject* globalObject, CallFrame* callFrame) -> JSC::EncodedJSValue {
                auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
                JSValue result = report(globalObject->vm(), globalObject);
                RETURN_IF_EXCEPTION(scope, {});
                RELEASE_AND_RETURN(scope, JSValue::encode(JSPromise::resolvedPromise(globalObject, result)));
            });
        JSNativeStdFunction* reject = JSNativeStdFunction::create(
            vm, globalObject, 0, "reject"_s,
            [reportFailure](JSGlobalObject* globalObject, CallFrame* callFrame) {
                EnsureStillAliveScope error = callFrame->argument(0);
                auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
                reportFailure(globalObject->vm());
                throwException(globalObject, scope, error.value());
                return JSValue::encode({});
            });
        promise->performPromiseThen(vm, globalObject, resolve, reject, afterOngoingPromiseCapability);
        RETURN_IF_EXCEPTION(throwScope, {});
        return JSValue::encode(afterOngoingPromiseCapability);
    }

    JSValue result = report(vm, globalObject);
    RELEASE_AND_RETURN(throwScope, JSValue::encode(result));
}

JSC_DECLARE_HOST_FUNCTION(functionGenerateHeapSnapshotForDebugging);
JSC_DEFINE_HOST_FUNCTION(functionGenerateHeapSnapshotForDebugging,
    (JSGlobalObject * globalObject, CallFrame*))
{
    VM& vm = globalObject->vm();
    JSLockHolder lock(vm);
    DeferTermination deferScope(vm);
    auto scope = DECLARE_THROW_SCOPE(vm);

    Bun__Feature__heap_snapshot += 1;

    String jsonString;
    {
        DeferGCForAWhile deferGC(vm); // Prevent concurrent GC from interfering with
                                      // the full GC that the snapshot does.

        HeapSnapshotBuilder snapshotBuilder(
            vm.ensureHeapProfiler(),
            HeapSnapshotBuilder::SnapshotType::GCDebuggingSnapshot);
        snapshotBuilder.buildSnapshot();

        jsonString = snapshotBuilder.json();
    }
    scope.releaseAssertNoException();

    return JSValue::encode(JSONParse(globalObject, WTF::move(jsonString)));
}

JSC_DEFINE_HOST_FUNCTION(functionSerialize,
    (JSGlobalObject * lexicalGlobalObject,
        CallFrame* callFrame))
{
    auto* globalObject = jsCast<JSDOMGlobalObject*>(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSValue value = callFrame->argument(0);
    JSValue optionsObject = callFrame->argument(1);
    bool asNodeBuffer = false;
    if (optionsObject.isObject()) {
        JSC::JSObject* options = optionsObject.getObject();
        auto binaryTypeValue = options->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "binaryType"_s));
        RETURN_IF_EXCEPTION(throwScope, {});
        if (binaryTypeValue) {
            if (!binaryTypeValue.isString()) {
                throwTypeError(globalObject, throwScope, "binaryType must be a string"_s);
                return {};
            }

            asNodeBuffer = binaryTypeValue.toWTFString(globalObject) == "nodebuffer"_s;
            RETURN_IF_EXCEPTION(throwScope, {});
        }
    }

    Vector<JSC::Strong<JSC::JSObject>> transferList;
    Vector<RefPtr<MessagePort>> dummyPorts;
    ExceptionOr<Ref<SerializedScriptValue>> serialized = SerializedScriptValue::create(*globalObject, value, WTF::move(transferList), dummyPorts, SerializationForStorage::Yes);
    EXCEPTION_ASSERT(serialized.hasException() == !!throwScope.exception());
    if (serialized.hasException()) {
        WebCore::propagateException(*globalObject, throwScope, serialized.releaseException());
        RELEASE_AND_RETURN(throwScope, {});
    }

    auto serializedValue = serialized.releaseReturnValue();
    auto arrayBuffer = serializedValue->toArrayBuffer();

    if (asNodeBuffer) {
        size_t byteLength = arrayBuffer->byteLength();
        auto* subclassStructure = globalObject->JSBufferSubclassStructure();
        JSC::JSUint8Array* uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, subclassStructure, WTF::move(arrayBuffer), 0, byteLength);
        RETURN_IF_EXCEPTION(throwScope, {});
        return JSValue::encode(uint8Array);
    }

    if (arrayBuffer->isShared()) {
        return JSValue::encode(JSArrayBuffer::create(vm, globalObject->arrayBufferStructureWithSharingMode<ArrayBufferSharingMode::Shared>(), WTF::move(arrayBuffer)));
    }

    return JSValue::encode(JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(), WTF::move(arrayBuffer)));
}
JSC_DEFINE_HOST_FUNCTION(functionDeserialize, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    JSValue value = callFrame->argument(0);

    JSValue result;

    if (auto* jsArrayBuffer = jsDynamicCast<JSArrayBuffer*>(value)) {
        result = SerializedScriptValue::fromArrayBuffer(*globalObject, globalObject, jsArrayBuffer->impl(), 0, jsArrayBuffer->impl()->byteLength());
    } else if (auto* view = jsDynamicCast<JSArrayBufferView*>(value)) {
        auto arrayBuffer = view->possiblySharedImpl()->possiblySharedBuffer();
        result = SerializedScriptValue::fromArrayBuffer(*globalObject, globalObject, arrayBuffer.get(), view->byteOffset(), view->byteLength());
    } else {
        throwTypeError(globalObject, throwScope, "First argument must be an ArrayBuffer"_s);
        return {};
    }

    RETURN_IF_EXCEPTION(throwScope, {});
    RELEASE_AND_RETURN(throwScope, JSValue::encode(result));
}

extern "C" JSC::EncodedJSValue ByteRangeMapping__findExecutedLines(
    JSC::JSGlobalObject*, BunString sourceURL, BasicBlockRange* ranges,
    size_t len, size_t functionOffset, bool ignoreSourceMap);

JSC_DEFINE_HOST_FUNCTION(functionCodeCoverageForFile,
    (JSGlobalObject * globalObject,
        CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    String fileName = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});
    bool ignoreSourceMap = callFrame->argument(1).toBoolean(globalObject);

    auto sourceID = Zig::sourceIDForSourceURL(fileName);
    if (!sourceID) {
        throwException(globalObject, throwScope,
            createError(globalObject, "No source for file"_s));
        return {};
    }

    auto basicBlocks = vm.controlFlowProfiler()->getBasicBlocksForSourceIDWithoutFunctionRange(
        sourceID, vm);

    if (basicBlocks.isEmpty()) {
        return JSC::JSValue::encode(
            JSC::constructEmptyArray(globalObject, nullptr, 0));
    }

    size_t functionStartOffset = basicBlocks.size();

    const Vector<std::tuple<bool, unsigned, unsigned>>& functionRanges = vm.functionHasExecutedCache()->getFunctionRanges(sourceID);

    basicBlocks.reserveCapacity(functionRanges.size() + basicBlocks.size());

    for (const auto& functionRange : functionRanges) {
        BasicBlockRange range;
        range.m_hasExecuted = std::get<0>(functionRange);
        range.m_startOffset = static_cast<int>(std::get<1>(functionRange));
        range.m_endOffset = static_cast<int>(std::get<2>(functionRange));
        range.m_executionCount = range.m_hasExecuted
            ? 1
            : 0; // This is a hack. We don't actually count this.
        basicBlocks.append(range);
    }

    return ByteRangeMapping__findExecutedLines(
        globalObject, Bun::toString(fileName), basicBlocks.begin(),
        basicBlocks.size(), functionStartOffset, ignoreSourceMap);
}

JSC_DEFINE_HOST_FUNCTION(functionEstimateDirectMemoryUsageOf, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSValue value = callFrame->argument(0);
    if (value.isCell()) {
        auto& vm = JSC::getVM(globalObject);
        EnsureStillAliveScope alive = value;
        return JSValue::encode(jsNumber(alive.value().asCell()->estimatedSizeInBytes(vm)));
    }

    return JSValue::encode(jsNumber(0));
}

#if USE(BMALLOC_MEMORY_FOOTPRINT_API)

#include <bmalloc/bmalloc.h>

JSC_DEFINE_HOST_FUNCTION(functionPercentAvailableMemoryInUse, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(jsDoubleNumber(bmalloc::api::percentAvailableMemoryInUse()));
}

#else

JSC_DEFINE_HOST_FUNCTION(functionPercentAvailableMemoryInUse, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(jsNull());
}

#endif

// clang-format off
/* Source for BunJSCModuleTable.lut.h
@begin BunJSCModuleTable
    callerSourceOrigin                  functionCallerSourceOrigin                  Function    0
    jscDescribe                         functionDescribe                            Function    0
    jscDescribeArray                    functionDescribeArray                       Function    0
    drainMicrotasks                     functionDrainMicrotasks                     Function    0
    edenGC                              functionEdenGC                              Function    0
    fullGC                              functionFullGC                              Function    0
    gcAndSweep                          functionGCAndSweep                          Function    0
    getRandomSeed                       functionGetRandomSeed                       Function    0
    heapSize                            functionHeapSize                            Function    0
    heapStats                           functionMemoryUsageStatistics               Function    0
    startSamplingProfiler               functionStartSamplingProfiler               Function    0
    samplingProfilerStackTraces         functionSamplingProfilerStackTraces         Function    0
    noInline                            functionNeverInlineFunction                 Function    0
    isRope                              functionIsRope                              Function    0
    memoryUsage                         functionCreateMemoryFootprint               Function    0
    noFTL                               functionNoFTL                               Function    0
    noOSRExitFuzzing                    functionNoOSRExitFuzzing                    Function    0
    numberOfDFGCompiles                 functionNumberOfDFGCompiles                 Function    0
    optimizeNextInvocation              functionOptimizeNextInvocation              Function    0
    releaseWeakRefs                     functionReleaseWeakRefs                     Function    0
    reoptimizationRetryCount            functionReoptimizationRetryCount            Function    0
    setRandomSeed                       functionSetRandomSeed                       Function    0
    startRemoteDebugger                 functionStartRemoteDebugger                 Function    0
    totalCompileTime                    functionTotalCompileTime                    Function    0
    getProtectedObjects                 functionGetProtectedObjects                 Function    0
    generateHeapSnapshotForDebugging    functionGenerateHeapSnapshotForDebugging    Function    0
    profile                             functionRunProfiler                         Function    0
    setTimeZone                         functionSetTimeZone                         Function    0
    serialize                           functionSerialize                           Function    0
    deserialize                         functionDeserialize                         Function    0
    estimateShallowMemoryUsageOf        functionEstimateDirectMemoryUsageOf         Function    1
    percentAvailableMemoryInUse         functionPercentAvailableMemoryInUse         Function    0
@end
*/

namespace Zig {
DEFINE_NATIVE_MODULE(BunJSC)
{
    INIT_NATIVE_MODULE(36);

    putNativeFn(Identifier::fromString(vm, "callerSourceOrigin"_s), functionCallerSourceOrigin);
    putNativeFn(Identifier::fromString(vm, "jscDescribe"_s), functionDescribe);
    putNativeFn(Identifier::fromString(vm, "jscDescribeArray"_s), functionDescribeArray);
    putNativeFn(Identifier::fromString(vm, "drainMicrotasks"_s), functionDrainMicrotasks);
    putNativeFn(Identifier::fromString(vm, "edenGC"_s), functionEdenGC);
    putNativeFn(Identifier::fromString(vm, "fullGC"_s), functionFullGC);
    putNativeFn(Identifier::fromString(vm, "gcAndSweep"_s), functionGCAndSweep);
    putNativeFn(Identifier::fromString(vm, "getRandomSeed"_s), functionGetRandomSeed);
    putNativeFn(Identifier::fromString(vm, "heapSize"_s), functionHeapSize);
    putNativeFn(Identifier::fromString(vm, "heapStats"_s), functionMemoryUsageStatistics);
    putNativeFn(Identifier::fromString(vm, "startSamplingProfiler"_s), functionStartSamplingProfiler);
    putNativeFn(Identifier::fromString(vm, "samplingProfilerStackTraces"_s), functionSamplingProfilerStackTraces);
    putNativeFn(Identifier::fromString(vm, "noInline"_s), functionNeverInlineFunction);
    putNativeFn(Identifier::fromString(vm, "isRope"_s), functionIsRope);
    putNativeFn(Identifier::fromString(vm, "memoryUsage"_s), functionCreateMemoryFootprint);
    putNativeFn(Identifier::fromString(vm, "noFTL"_s), functionNoFTL);
    putNativeFn(Identifier::fromString(vm, "noOSRExitFuzzing"_s), functionNoOSRExitFuzzing);
    putNativeFn(Identifier::fromString(vm, "numberOfDFGCompiles"_s), functionNumberOfDFGCompiles);
    putNativeFn(Identifier::fromString(vm, "optimizeNextInvocation"_s), functionOptimizeNextInvocation);
    putNativeFn(Identifier::fromString(vm, "releaseWeakRefs"_s), functionReleaseWeakRefs);
    putNativeFn(Identifier::fromString(vm, "reoptimizationRetryCount"_s), functionReoptimizationRetryCount);
    putNativeFn(Identifier::fromString(vm, "setRandomSeed"_s), functionSetRandomSeed);
    putNativeFn(Identifier::fromString(vm, "startRemoteDebugger"_s), functionStartRemoteDebugger);
    putNativeFn(Identifier::fromString(vm, "totalCompileTime"_s), functionTotalCompileTime);
    putNativeFn(Identifier::fromString(vm, "getProtectedObjects"_s), functionGetProtectedObjects);
    putNativeFn(Identifier::fromString(vm, "generateHeapSnapshotForDebugging"_s), functionGenerateHeapSnapshotForDebugging);
    putNativeFn(Identifier::fromString(vm, "profile"_s), functionRunProfiler);
    putNativeFn(Identifier::fromString(vm, "codeCoverageForFile"_s),  functionCodeCoverageForFile);
    putNativeFn(Identifier::fromString(vm, "setTimeZone"_s), functionSetTimeZone);
    putNativeFn(Identifier::fromString(vm, "serialize"_s), functionSerialize);
    putNativeFn(Identifier::fromString(vm, "deserialize"_s), functionDeserialize);
    putNativeFn(Identifier::fromString(vm, "estimateShallowMemoryUsageOf"_s), functionEstimateDirectMemoryUsageOf);
    putNativeFn(Identifier::fromString(vm, "percentAvailableMemoryInUse"_s), functionPercentAvailableMemoryInUse);

    // Deprecated
    putNativeFn(Identifier::fromString(vm, "describe"_s), functionDescribe);
    putNativeFn(Identifier::fromString(vm, "describeArray"_s), functionDescribeArray);
    putNativeFn(Identifier::fromString(vm, "setTimezone"_s), functionSetTimeZone);

    RETURN_NATIVE_MODULE();
}

} // namespace Zig
