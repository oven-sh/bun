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

namespace Bun {

using namespace JSC;

const ClassInfo JSNodePerformanceHooksHistogram::s_info = { "Histogram"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodePerformanceHooksHistogram) };

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
    auto histogramData = HistogramData(raw_histogram);

    JSNodePerformanceHooksHistogram* ptr = new (NotNull, allocateCell<JSNodePerformanceHooksHistogram>(vm)) JSNodePerformanceHooksHistogram(vm, structure, std::move(histogramData));
    ptr->finishCreation(vm);
    if (ptr->m_histogramData.histogram) {
        ptr->m_extraMemorySizeForGC = hdr_get_memory_size(ptr->m_histogramData.histogram);
        vm.heap.reportExtraMemoryAllocated(ptr, ptr->m_extraMemorySizeForGC);
    }
    return ptr;
}

JSNodePerformanceHooksHistogram* JSNodePerformanceHooksHistogram::create(VM& vm, Structure* structure, JSGlobalObject* globalObject, HistogramData&& existingHistogramData)
{
    JSNodePerformanceHooksHistogram* ptr = new (NotNull, allocateCell<JSNodePerformanceHooksHistogram>(vm)) JSNodePerformanceHooksHistogram(vm, structure, std::move(existingHistogramData));
    ptr->finishCreation(vm);
    if (ptr->m_histogramData.histogram) {
        ptr->m_extraMemorySizeForGC = hdr_get_memory_size(ptr->m_histogramData.histogram);
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
    // The shared_ptr will handle the destruction of HistogramData,
    // which in turn calls hdr_close via HDRHistogramPointer.
}

template<typename Visitor>
void JSNodePerformanceHooksHistogram::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSNodePerformanceHooksHistogram* thisObject = jsCast<JSNodePerformanceHooksHistogram*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    if (!thisObject->m_histogramData.histogram) {
        visitor.reportExtraMemoryVisited(thisObject->m_extraMemorySizeForGC);
    }
}

DEFINE_VISIT_CHILDREN(JSNodePerformanceHooksHistogram);

size_t JSNodePerformanceHooksHistogram::estimatedSize(JSCell* cell, VM& vm)
{
    JSNodePerformanceHooksHistogram* thisObject = jsCast<JSNodePerformanceHooksHistogram*>(cell);
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

bool JSNodePerformanceHooksHistogram::record(int64_t value)
{
    if (!m_histogramData.histogram) return false;

    // hdr_record_value returns false if the value cannot be recorded
    // (e.g., if it's outside the trackable range)
    bool recorded = hdr_record_value(m_histogramData.histogram, value);

    // If the value couldn't be recorded, it means it exceeded the histogram's range
    if (!recorded) {
        m_histogramData.exceedsCount++;
    }

    return recorded;
}

uint64_t JSNodePerformanceHooksHistogram::recordDelta(JSGlobalObject* globalObject)
{
    // Use high-resolution monotonic time in nanoseconds
    auto now = std::chrono::steady_clock::now();
    uint64_t nowNs = std::chrono::duration_cast<std::chrono::nanoseconds>(now.time_since_epoch()).count();

    uint64_t delta = 0;
    if (m_histogramData.prevDeltaTime != 0) {
        delta = nowNs - m_histogramData.prevDeltaTime;
        record(delta);
    }
    m_histogramData.prevDeltaTime = nowNs;
    return delta;
}

void JSNodePerformanceHooksHistogram::reset()
{
    if (!m_histogramData.histogram) return;
    hdr_reset(m_histogramData.histogram);
    m_histogramData.prevDeltaTime = 0;
    m_histogramData.exceedsCount = 0;
}

int64_t JSNodePerformanceHooksHistogram::getMin() const
{
    if (!m_histogramData.histogram) return 0;
    return hdr_min(m_histogramData.histogram);
}

int64_t JSNodePerformanceHooksHistogram::getMax() const
{
    if (!m_histogramData.histogram) return 0;
    return hdr_max(m_histogramData.histogram);
}

double JSNodePerformanceHooksHistogram::getMean() const
{
    if (!m_histogramData.histogram) return NAN;
    return hdr_mean(m_histogramData.histogram);
}

double JSNodePerformanceHooksHistogram::getStddev() const
{
    if (!m_histogramData.histogram) return NAN;
    return hdr_stddev(m_histogramData.histogram);
}

int64_t JSNodePerformanceHooksHistogram::getPercentile(double percentile) const
{
    if (!m_histogramData.histogram) return 0;
    return hdr_value_at_percentile(m_histogramData.histogram, percentile);
}

size_t JSNodePerformanceHooksHistogram::getExceeds() const
{
    return m_histogramData.exceedsCount;
}

uint64_t JSNodePerformanceHooksHistogram::getCount() const
{
    if (!m_histogramData.histogram) return 0;
    return m_histogramData.histogram->total_count;
}

double JSNodePerformanceHooksHistogram::add(JSNodePerformanceHooksHistogram* other)
{
    if (!m_histogramData.histogram || !other || !other->m_histogramData.histogram) return 0;

    size_t originalExceeds = m_histogramData.exceedsCount;

    // hdr_add returns number of dropped values
    double dropped = hdr_add(m_histogramData.histogram, other->m_histogramData.histogram);

    m_histogramData.exceedsCount = originalExceeds + other->m_histogramData.exceedsCount + static_cast<size_t>(dropped);

    return dropped;
}

// std::shared_ptr<HistogramData> JSNodePerformanceHooksHistogram::getHistogramDataForCloning() const
// {
//     if (!m_histogramData.histogram) {
//         return nullptr;
//     }

//     hdr_histogram* clonedHistogram = nullptr;
//     int result = hdr_init(
//         m_histogramData.histogram->lowest_discernible_value,
//         m_histogramData.histogram->highest_trackable_value,
//         m_histogramData.histogram->significant_figures,
//         &clonedHistogram
//     );

//     if (result != 0 || !clonedHistogram) {
//         return nullptr;
//     }

//     size_t dataSize = hdr_get_memory_size(m_histogramData.histogram);
//     memcpy(clonedHistogram, m_histogramData.histogram, dataSize);

//     auto clonedData = std::make_shared<HistogramData>(clonedHistogram);
//     clonedData->prevDeltaTime = m_histogramData.prevDeltaTime;
//     clonedData->exceedsCount = m_histogramData.exceedsCount;

//     return clonedData;
// }

void JSNodePerformanceHooksHistogram::getPercentiles(JSGlobalObject* globalObject, JSC::JSMap* map)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!m_histogramData.histogram) return;

    struct hdr_iter iter;
    hdr_iter_percentile_init(&iter, m_histogramData.histogram, 1.0);

    while (hdr_iter_next(&iter)) {
        double percentile = iter.specifics.percentiles.percentile;
        int64_t value = iter.highest_equivalent_value;
        JSValue jsKey = jsNumber(percentile);
        JSValue jsValue = jsNumber(static_cast<double>(value));
        map->set(globalObject, jsKey, jsValue);
        RETURN_IF_EXCEPTION(scope, void());
    }
}

void JSNodePerformanceHooksHistogram::getPercentilesBigInt(JSGlobalObject* globalObject, JSC::JSMap* map)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!m_histogramData.histogram) return;

    struct hdr_iter iter;
    hdr_iter_percentile_init(&iter, m_histogramData.histogram, 1.0);

    while (hdr_iter_next(&iter)) {
        double percentile = iter.specifics.percentiles.percentile;
        int64_t value = iter.highest_equivalent_value;
        JSValue jsKey = jsNumber(percentile);
        JSValue jsValue = JSBigInt::createFrom(globalObject, value);
        map->set(globalObject, jsKey, jsValue);
        RETURN_IF_EXCEPTION(scope, void());
    }
}

} // namespace Bun
