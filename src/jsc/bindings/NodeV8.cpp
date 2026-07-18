// Native support for the parts of `node:v8` that need to observe the
// JavaScriptCore heap directly.
#include "root.h"

#include "ErrorCode.h"

#include <JavaScriptCore/CollectionScope.h>
#include <JavaScriptCore/Heap.h>
#include <JavaScriptCore/HeapObserver.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/VM.h>
#include <wtf/HashMap.h>
#include <wtf/MonotonicTime.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/Vector.h>

#include <algorithm>
#include <optional>
#include <utility>

namespace Bun {

using namespace JSC;

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

namespace {

// One record per garbage collection observed while at least one GCProfiler is
// running. Only values JavaScriptCore actually measures are stored; the shape
// node:v8 reports is assembled in src/js/node/v8.ts.
struct GCEventRecord {
    bool isFullCollection { false };
    double costMicroseconds { 0 };
    size_t usedBefore { 0 };
    size_t capacityBefore { 0 };
    size_t externalBefore { 0 };
    size_t usedAfter { 0 };
    size_t capacityAfter { 0 };
    size_t externalAfter { 0 };
};

class GCProfilerObserver final : public JSC::HeapObserver {
public:
    explicit GCProfilerObserver(JSC::VM& vm)
        : m_vm(&vm)
    {
    }

    void willGarbageCollect() final
    {
        auto& heap = m_vm->heap;
        m_collectionStart = MonotonicTime::now();
        m_capacityBefore = heap.capacity();
        m_externalBefore = heap.extraMemorySize();
    }

    void didGarbageCollect(JSC::CollectionScope collectionScope) final
    {
        // A collection already in flight when a profiler starts has no
        // matching willGarbageCollect(), so there is no honest start time.
        // Skip it rather than report a made-up cost, as node's profiler does.
        auto collectionStart = std::exchange(m_collectionStart, std::nullopt);
        if (!collectionStart || m_sessions.isEmpty())
            return;

        auto& heap = m_vm->heap;
        GCEventRecord record;
        record.isFullCollection = collectionScope == JSC::CollectionScope::Full;
        record.costMicroseconds = std::max(0.0, (MonotonicTime::now() - *collectionStart).microseconds());
        // JavaScriptCore records the live-bytes figure on both sides of the
        // collection it just finished, so these two numbers are measured rather
        // than sampled after the fact.
        if (record.isFullCollection) {
            record.usedBefore = heap.sizeBeforeLastFullCollection();
            record.usedAfter = heap.sizeAfterLastFullCollection();
        } else {
            record.usedBefore = heap.sizeBeforeLastEdenCollection();
            record.usedAfter = heap.sizeAfterLastEdenCollection();
        }
        record.capacityBefore = m_capacityBefore;
        record.externalBefore = m_externalBefore;
        record.capacityAfter = heap.capacity();
        record.externalAfter = heap.extraMemorySize();

        for (auto& entry : m_sessions)
            entry.value.append(record);
    }

    uint32_t startSession()
    {
        bool wasEmpty = m_sessions.isEmpty();
        uint32_t id = m_nextSessionID++;
        m_sessions.add(id, Vector<GCEventRecord>());
        if (wasEmpty) {
            // Drop any timestamp left by a collection observed before the last
            // detach; pairing it with this session would report its cost as all
            // the wall time in between.
            m_collectionStart = std::nullopt;
            m_vm->heap.addObserver(this);
        }
        return id;
    }

    std::optional<Vector<GCEventRecord>> stopSession(uint32_t id)
    {
        auto it = m_sessions.find(id);
        if (it == m_sessions.end())
            return std::nullopt;
        Vector<GCEventRecord> records = std::move(it->value);
        m_sessions.remove(it);
        if (m_sessions.isEmpty()) {
            m_collectionStart = std::nullopt;
            m_vm->heap.removeObserver(this);
        }
        return records;
    }

private:
    JSC::VM* m_vm;
    HashMap<uint32_t, Vector<GCEventRecord>, WTF::IntHash<uint32_t>, WTF::UnsignedWithZeroKeyHashTraits<uint32_t>> m_sessions;
    uint32_t m_nextSessionID { 1 };
    std::optional<MonotonicTime> m_collectionStart;
    size_t m_capacityBefore { 0 };
    size_t m_externalBefore { 0 };
};

// The observer is per-VM, and every JS thread (main thread or worker) has its
// own VM, so thread-local storage keeps worker threads independent without any
// cross-thread synchronization.
GCProfilerObserver& sharedGCProfilerObserver(JSC::VM& vm)
{
    static thread_local LazyNeverDestroyed<GCProfilerObserver> observer;
    static thread_local bool constructed = false;
    if (!constructed) {
        observer.construct(vm);
        constructed = true;
    }
    return observer.get();
}

} // namespace

JSC_DEFINE_HOST_FUNCTION(functionStartGCProfiler, (JSGlobalObject * globalObject, CallFrame*))
{
    auto& vm = JSC::getVM(globalObject);
    return JSValue::encode(jsNumber(sharedGCProfilerObserver(vm).startSession()));
}

JSC_DEFINE_HOST_FUNCTION(functionStopGCProfiler, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    uint32_t id = callFrame->argument(0).toUInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto records = sharedGCProfilerObserver(vm).stopSession(id);
    if (!records)
        return JSValue::encode(jsUndefined());

    JSArray* result = constructEmptyArray(globalObject, nullptr, records->size());
    RETURN_IF_EXCEPTION(scope, {});

    unsigned index = 0;
    for (const auto& record : *records) {
        JSObject* entry = constructEmptyObject(globalObject);
        entry->putDirect(vm, Identifier::fromString(vm, "isFullCollection"_s), jsBoolean(record.isFullCollection));
        entry->putDirect(vm, Identifier::fromString(vm, "cost"_s), jsNumber(record.costMicroseconds));
        entry->putDirect(vm, Identifier::fromString(vm, "usedBefore"_s), jsNumber(record.usedBefore));
        entry->putDirect(vm, Identifier::fromString(vm, "capacityBefore"_s), jsNumber(record.capacityBefore));
        entry->putDirect(vm, Identifier::fromString(vm, "externalBefore"_s), jsNumber(record.externalBefore));
        entry->putDirect(vm, Identifier::fromString(vm, "usedAfter"_s), jsNumber(record.usedAfter));
        entry->putDirect(vm, Identifier::fromString(vm, "capacityAfter"_s), jsNumber(record.capacityAfter));
        entry->putDirect(vm, Identifier::fromString(vm, "externalAfter"_s), jsNumber(record.externalAfter));
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
    return object;
}

} // namespace Bun
