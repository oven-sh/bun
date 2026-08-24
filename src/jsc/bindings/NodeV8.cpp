// Native support for the parts of `node:v8` that need to observe the
// JavaScriptCore heap directly.
#include "root.h"

#include "BunClientData.h"
#include "ErrorCode.h"
#include "NodeV8.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <wtf/StdLibExtras.h>

#include "mimalloc.h"

namespace Bun {

using namespace JSC;

// Returns: [heapSize, heapCapacity, extraMemorySize, globalObjectCount, peakRSS]
JSC_DEFINE_HOST_FUNCTION(functionGetHeapStatisticsArray, (JSGlobalObject * globalObject, CallFrame*))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& heap = vm.heap;

    size_t elapsed_msecs = 0, user_msecs = 0, system_msecs = 0;
    size_t current_rss = 0, peak_rss = 0;
    size_t current_commit = 0, peak_commit = 0, page_faults = 0;
    mi_process_info(&elapsed_msecs, &user_msecs, &system_msecs, &current_rss,
        &peak_rss, &current_commit, &peak_commit, &page_faults);

    const size_t globalObjectCount = WebCore::clientData(vm)->liveGlobalObjectCount;

    JSArray* result = constructEmptyArray(globalObject, nullptr, 5);
    RETURN_IF_EXCEPTION(scope, {});
    result->putDirectIndex(globalObject, 0, jsNumber(heap.size()));
    RETURN_IF_EXCEPTION(scope, {});
    result->putDirectIndex(globalObject, 1, jsNumber(heap.capacity()));
    RETURN_IF_EXCEPTION(scope, {});
    result->putDirectIndex(globalObject, 2, jsNumber(heap.extraMemorySize()));
    RETURN_IF_EXCEPTION(scope, {});
    result->putDirectIndex(globalObject, 3, jsNumber(globalObjectCount));
    RETURN_IF_EXCEPTION(scope, {});
    result->putDirectIndex(globalObject, 4, jsNumber(peak_rss));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

// v8.isStringOneByteRepresentation() asks whether the engine is storing the
// string with one byte per character. JSC's JSString::is8Bit() answers exactly
// that question, so this is a faithful mapping rather than a content scan.
JSC_DEFINE_HOST_FUNCTION(functionIsStringOneByteRepresentation, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue argument = callFrame->argument(0);
    if (!argument.isString())
        return Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "content"_s, "string"_s, argument);

    return JSValue::encode(jsBoolean(asString(argument)->is8Bit()));
}

static GCProfilerObserver& ensureGCProfilerObserver(JSGlobalObject* globalObject)
{
    auto* global = defaultGlobalObject(globalObject);
    auto& slot = global->m_gcProfilerObserver;
    if (!slot)
        slot = makeUnique<GCProfilerObserver>(global->vm());
    return *slot;
}

JSC_DEFINE_HOST_FUNCTION(functionStartGCProfiler, (JSGlobalObject * globalObject, CallFrame*))
{
    return JSValue::encode(jsNumber(ensureGCProfilerObserver(globalObject).startSession()));
}

// FinalizationRegistry cleanup path: release the session without materializing
// the JS report, so an abandoned profiler that observed many collections is
// O(1) in JS-heap terms to clean up.
JSC_DEFINE_HOST_FUNCTION(functionDiscardGCProfiler, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    uint32_t id = callFrame->argument(0).toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    ensureGCProfilerObserver(globalObject).stopSession(id);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(functionStopGCProfiler, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    uint32_t id = callFrame->argument(0).toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto records = ensureGCProfilerObserver(globalObject).stopSession(id);
    if (!records)
        return JSValue::encode(jsUndefined());

    JSArray* result = constructEmptyArray(globalObject, nullptr, records->size());
    RETURN_IF_EXCEPTION(scope, {});

    unsigned index = 0;
    for (const auto& record : *records) {
        JSObject* entry = constructEmptyObject(globalObject);
        Bun::putDirectNamed(vm, entry, "isFullCollection"_s, jsBoolean(record.isFullCollection));
        Bun::putDirectNamed(vm, entry, "cost"_s, jsNumber(record.costMicroseconds));
        Bun::putDirectNamed(vm, entry, "usedBefore"_s, jsNumber(record.usedBefore));
        Bun::putDirectNamed(vm, entry, "capacityBefore"_s, jsNumber(record.capacityBefore));
        Bun::putDirectNamed(vm, entry, "externalBefore"_s, jsNumber(record.externalBefore));
        Bun::putDirectNamed(vm, entry, "usedAfter"_s, jsNumber(record.usedAfter));
        Bun::putDirectNamed(vm, entry, "capacityAfter"_s, jsNumber(record.capacityAfter));
        Bun::putDirectNamed(vm, entry, "externalAfter"_s, jsNumber(record.externalAfter));
        result->putDirectIndex(globalObject, index++, entry);
        RETURN_IF_EXCEPTION(scope, {});
    }

    return JSValue::encode(result);
}

JSC::JSObject* createNodeV8Binding(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSObject* object = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "isStringOneByteRepresentation"_s), 1, functionIsStringOneByteRepresentation, ImplementationVisibility::Public, JSC::NoIntrinsic, 0);
    object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "startGCProfiler"_s), 0, functionStartGCProfiler, ImplementationVisibility::Public, JSC::NoIntrinsic, 0);
    object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "stopGCProfiler"_s), 1, functionStopGCProfiler, ImplementationVisibility::Public, JSC::NoIntrinsic, 0);
    object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "discardGCProfiler"_s), 1, functionDiscardGCProfiler, ImplementationVisibility::Public, JSC::NoIntrinsic, 0);
    object->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, "getHeapStatisticsArray"_s), 0, functionGetHeapStatisticsArray, ImplementationVisibility::Public, JSC::NoIntrinsic, 0);
    return object;
}

} // namespace Bun
