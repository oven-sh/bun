#include "root.h"

#include "JSNodePerformanceHooksHistogram.h"
#include "JSNodePerformanceHooksHistogramPrototype.h"
#include "JSNodePerformanceHooksHistogramConstructor.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include "BunString.h"
#include "JSDOMExceptionHandling.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/JSCellInlines.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSBigInt.h>
#include "wtf/text/WTFString.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/ObjectPrototype.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/HeapAnalyzer.h>
#include <JavaScriptCore/PropertyName.h>
#include <chrono>
#include <hdr/hdr_histogram.h>
#include <wtf/MonotonicTime.h>

namespace Bun {

using namespace JSC;

const ClassInfo JSNodePerformanceHooksHistogram::s_info = { "RecordableHistogram"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodePerformanceHooksHistogram) };

void JSNodePerformanceHooksHistogram::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSNodePerformanceHooksHistogram* JSNodePerformanceHooksHistogram::create(VM& vm, Structure* structure, JSGlobalObject* globalObject, int64_t lowest, int64_t highest, int figures)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    struct hdr_histogram* raw_histogram = nullptr;
    int result = hdr_init(lowest, highest, figures, &raw_histogram);
    if (result != 0 || !raw_histogram) {
        throwTypeError(globalObject, scope, "Failed to initialize histogram"_s);
        return nullptr;
    }

    return create(vm, structure, globalObject, HistogramData::create(raw_histogram));
}

JSNodePerformanceHooksHistogram* JSNodePerformanceHooksHistogram::create(VM& vm, Structure* structure, JSGlobalObject* globalObject, Ref<HistogramData>&& existingHistogramData)
{
    JSNodePerformanceHooksHistogram* ptr = new (NotNull, allocateCell<JSNodePerformanceHooksHistogram>(vm)) JSNodePerformanceHooksHistogram(vm, structure, WTF::move(existingHistogramData));
    ptr->finishCreation(vm);
    if (ptr->m_histogramData->histogram) {
        ptr->m_extraMemorySizeForGC = hdr_get_memory_size(ptr->m_histogramData->histogram);
        vm.heap.reportExtraMemoryAllocated(ptr, ptr->m_extraMemorySizeForGC);
    }
    return ptr;
}

void JSNodePerformanceHooksHistogram::destroy(JSCell* cell)
{
    static_cast<JSNodePerformanceHooksHistogram*>(cell)->~JSNodePerformanceHooksHistogram();
}

JSNodePerformanceHooksHistogram::~JSNodePerformanceHooksHistogram()
{
}

template<typename Visitor>
void JSNodePerformanceHooksHistogram::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSNodePerformanceHooksHistogram* thisObject = uncheckedDowncast<JSNodePerformanceHooksHistogram>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    visitor.reportExtraMemoryVisited(thisObject->m_extraMemorySizeForGC);
}

DEFINE_VISIT_CHILDREN(JSNodePerformanceHooksHistogram);

size_t JSNodePerformanceHooksHistogram::estimatedSize(JSCell* cell, VM& vm)
{
    JSNodePerformanceHooksHistogram* thisObject = uncheckedDowncast<JSNodePerformanceHooksHistogram>(cell);
    size_t selfSize = Base::estimatedSize(cell, vm);
    return selfSize + thisObject->m_extraMemorySizeForGC;
}

void JSNodePerformanceHooksHistogram::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    Base::analyzeHeap(cell, analyzer);
}

JSC::Structure* JSNodePerformanceHooksHistogram::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

static ALWAYS_INLINE void recordLocked(HistogramData& data, int64_t value)
{
    // Try to record in the HDR histogram first
    bool recorded = hdr_record_value(data.histogram, value);

    if (recorded) {
        // Value was within range - count it and update min/max
        data.totalCount++;

        // Update manual min/max tracking for in-range values only
        if (value < data.manualMin) {
            data.manualMin = value;
        }
        if (value > data.manualMax) {
            data.manualMax = value;
        }
    } else {
        // Value was out of range
        data.exceedsCount++;
    }
}

bool JSNodePerformanceHooksHistogram::record(int64_t value)
{
    auto& data = *m_histogramData;
    WTF::Locker locker { data.m_lock };
    if (!data.histogram) return false;
    recordLocked(data, value);
    return true;
}

uint64_t JSNodePerformanceHooksHistogram::recordDelta(JSGlobalObject* globalObject)
{
    auto now = WTF::MonotonicTime::now();
    uint64_t nowNs = static_cast<uint64_t>(now.secondsSinceEpoch().milliseconds() * 1000000.0);

    auto& data = *m_histogramData;
    WTF::Locker locker { data.m_lock };
    uint64_t delta = 0;
    if (data.prevDeltaTime != 0) {
        delta = nowNs - data.prevDeltaTime;
        if (data.histogram)
            recordLocked(data, delta);
    }
    data.prevDeltaTime = nowNs;
    return delta;
}

void JSNodePerformanceHooksHistogram::reset()
{
    auto& data = *m_histogramData;
    WTF::Locker locker { data.m_lock };
    if (!data.histogram) return;
    hdr_reset(data.histogram);
    data.prevDeltaTime = 0;
    data.totalCount = 0;
    data.manualMin = std::numeric_limits<int64_t>::max();
    data.manualMax = 0;
    data.exceedsCount = 0;
}

int64_t JSNodePerformanceHooksHistogram::getMin() const
{
    auto& data = *m_histogramData;
    WTF::Locker locker { data.m_lock };
    if (data.totalCount == 0) {
        // Return the same initial value as Node.js when no values recorded
        // Node.js returns 9223372036854776000 which is 0x8000000000000000
        // This is exactly INT64_MIN when interpreted as signed
        return INT64_MIN;
    }
    return data.manualMin;
}

int64_t JSNodePerformanceHooksHistogram::getMax() const
{
    auto& data = *m_histogramData;
    WTF::Locker locker { data.m_lock };
    if (data.totalCount == 0) {
        // Return 0 when no values recorded (Node.js behavior)
        return 0;
    }
    return data.manualMax;
}

double JSNodePerformanceHooksHistogram::getMean() const
{
    auto& data = *m_histogramData;
    WTF::Locker locker { data.m_lock };
    if (!data.histogram) return NAN;
    return hdr_mean(data.histogram);
}

double JSNodePerformanceHooksHistogram::getStddev() const
{
    auto& data = *m_histogramData;
    WTF::Locker locker { data.m_lock };
    if (!data.histogram) return NAN;
    return hdr_stddev(data.histogram);
}

int64_t JSNodePerformanceHooksHistogram::getPercentile(double percentile) const
{
    auto& data = *m_histogramData;
    WTF::Locker locker { data.m_lock };
    if (!data.histogram) return 0;
    return hdr_value_at_percentile(data.histogram, percentile);
}

size_t JSNodePerformanceHooksHistogram::getExceeds() const
{
    auto& data = *m_histogramData;
    WTF::Locker locker { data.m_lock };
    return data.exceedsCount;
}

uint64_t JSNodePerformanceHooksHistogram::getCount() const
{
    auto& data = *m_histogramData;
    WTF::Locker locker { data.m_lock };
    // Return our manual count of in-range values only
    // This matches Node.js behavior
    return data.totalCount;
}

static ALWAYS_INLINE double addLocked(HistogramData& self, HistogramData& other)
{
    // Add the manual counts and exceeds
    self.totalCount += other.totalCount;
    self.exceedsCount += other.exceedsCount;

    // Update manual min/max from the other histogram
    if (other.totalCount > 0) {
        if (self.totalCount == other.totalCount) {
            // This was empty, so take the other's values
            self.manualMin = other.manualMin;
            self.manualMax = other.manualMax;
        } else {
            // Merge min/max values
            if (other.manualMin < self.manualMin) {
                self.manualMin = other.manualMin;
            }
            if (other.manualMax > self.manualMax) {
                self.manualMax = other.manualMax;
            }
        }
    }

    // hdr_add returns number of dropped values
    return hdr_add(self.histogram, other.histogram);
}

double JSNodePerformanceHooksHistogram::add(JSNodePerformanceHooksHistogram* other)
{
    if (!other) return 0;
    auto& self = *m_histogramData;
    auto& otherData = *other->m_histogramData;

    if (&self == &otherData) {
        WTF::Locker locker { self.m_lock };
        if (!self.histogram) return 0;
        return addLocked(self, otherData);
    }

    auto& first = &self < &otherData ? self : otherData;
    auto& second = &self < &otherData ? otherData : self;
    WTF::Locker firstLocker { first.m_lock };
    WTF::Locker secondLocker { second.m_lock };
    if (!self.histogram || !otherData.histogram) return 0;
    return addLocked(self, otherData);
}

static void fillPercentileMap(JSGlobalObject* globalObject, JSC::JSMap* map, HistogramData& data)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    Vector<std::pair<double, int64_t>, 32> entries;
    {
        WTF::Locker locker { data.m_lock };
        if (!data.histogram) return;

        struct hdr_iter iter;
        hdr_iter_percentile_init(&iter, data.histogram, 1.0);
        while (hdr_iter_next(&iter)) {
            entries.append({ iter.specifics.percentiles.percentile, iter.highest_equivalent_value });
        }
    }

    for (auto& [percentile, value] : entries) {
        JSValue jsKey = jsNumber(percentile);
        JSValue jsValue = JSBigInt::createFrom(globalObject, value);
        RETURN_IF_EXCEPTION(scope, );
        map->set(globalObject, jsKey, jsValue);
        RETURN_IF_EXCEPTION(scope, void());
    }
}

void JSNodePerformanceHooksHistogram::getPercentiles(JSGlobalObject* globalObject, JSC::JSMap* map)
{
    fillPercentileMap(globalObject, map, *m_histogramData);
}

void JSNodePerformanceHooksHistogram::getPercentilesBigInt(JSGlobalObject* globalObject, JSC::JSMap* map)
{
    fillPercentileMap(globalObject, map, *m_histogramData);
}

} // namespace Bun
