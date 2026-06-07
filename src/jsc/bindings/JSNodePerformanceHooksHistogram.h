#pragma once

#include "root.h"

#include "BunClientData.h"
#include "headers-handwritten.h"
#include "wtf/Assertions.h"
#include "wtf/Lock.h"
#include "wtf/FastMalloc.h"

#include <JavaScriptCore/JSDestructibleObject.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <hdr/hdr_histogram.h>
#include <memory>
#include <limits>

namespace Bun {

using namespace JSC;

// Forward declarations
class JSNodePerformanceHooksHistogram;
class JSNodePerformanceHooksHistogramPrototype;
class JSNodePerformanceHooksHistogramConstructor;

JSC_DECLARE_HOST_FUNCTION(jsNodePerformanceHooksHistogramProtoFuncRecord);
JSC_DECLARE_HOST_FUNCTION(jsNodePerformanceHooksHistogramProtoFuncRecordDelta);
JSC_DECLARE_HOST_FUNCTION(jsNodePerformanceHooksHistogramProtoFuncAdd);
JSC_DECLARE_HOST_FUNCTION(jsNodePerformanceHooksHistogramProtoFuncReset);

JSC_DECLARE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_count);
JSC_DECLARE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_countBigInt);
JSC_DECLARE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_min);
JSC_DECLARE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_minBigInt);
JSC_DECLARE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_max);
JSC_DECLARE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_maxBigInt);
JSC_DECLARE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_mean);
JSC_DECLARE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_stddev);
JSC_DECLARE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_exceeds);
JSC_DECLARE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_exceedsBigInt);
JSC_DECLARE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_percentiles);
JSC_DECLARE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_percentilesBigInt);

JSC_DECLARE_HOST_FUNCTION(jsNodePerformanceHooksHistogramProtoFuncPercentile);
JSC_DECLARE_HOST_FUNCTION(jsNodePerformanceHooksHistogramProtoFuncPercentileBigInt);

JSC_DECLARE_HOST_FUNCTION(jsFunction_createHistogram);
JSC_DECLARE_HOST_FUNCTION(jsFunction_monitorEventLoopDelay);
JSC_DECLARE_HOST_FUNCTION(jsFunction_enableEventLoopDelay);
JSC_DECLARE_HOST_FUNCTION(jsFunction_disableEventLoopDelay);

class HistogramData {
public:
    hdr_histogram* histogram;
    uint64_t prevDeltaTime = 0;
    size_t exceedsCount = 0;
    uint64_t totalCount = 0; // Manual count to track all values (Node.js behavior)
    int64_t manualMin = std::numeric_limits<int64_t>::max(); // Manual min tracking
    int64_t manualMax = 0; // Manual max tracking

    HistogramData(hdr_histogram* histogram)
        : histogram(histogram)
    {
    }

    ~HistogramData()
    {
        if (histogram) {
            hdr_close(histogram);
        }
    }

    // Move constructor (does not call destructor)
    HistogramData(HistogramData&& other) noexcept
        : histogram(other.histogram)
        , prevDeltaTime(other.prevDeltaTime)
        , exceedsCount(other.exceedsCount)
        , totalCount(other.totalCount)
        , manualMin(other.manualMin)
        , manualMax(other.manualMax)
    {
        // Invalidate other's histogram pointer to avoid double free
        other.histogram = nullptr;
        other.prevDeltaTime = 0;
        other.exceedsCount = 0;
        other.totalCount = 0;
        other.manualMin = std::numeric_limits<int64_t>::max();
        other.manualMax = 0;
    }
};

class JSNodePerformanceHooksHistogram final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = NeedsDestruction;

    HistogramData m_histogramData;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    static JSNodePerformanceHooksHistogram* create(
        JSC::VM& vm,
        JSC::Structure* structure,
        JSC::JSGlobalObject* globalObject,
        int64_t lowest,
        int64_t highest,
        int figures);

    static JSNodePerformanceHooksHistogram* create(
        JSC::VM& vm,
        JSC::Structure* structure,
        JSC::JSGlobalObject* globalObject,
        HistogramData&& existingHistogramData);

    void finishCreation(JSC::VM& vm);
    static void destroy(JSC::JSCell*);

    static size_t estimatedSize(JSC::JSCell* cell, JSC::VM& vm);
    static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);

    template<typename Visitor>
    static void visitChildren(JSCell*, Visitor&);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSNodePerformanceHooksHistogram, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSNodePerformanceHooksHistogram.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSNodePerformanceHooksHistogram = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSNodePerformanceHooksHistogram.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSNodePerformanceHooksHistogram = std::forward<decltype(space)>(space); });
    }

    JSNodePerformanceHooksHistogram(JSC::VM& vm, JSC::Structure* structure, HistogramData&& histogramData)
        : Base(vm, structure)
        , m_histogramData(std::move(histogramData))
    {
    }

    ~JSNodePerformanceHooksHistogram();

    hdr_histogram& histogram() { return *m_histogramData.histogram; }

    bool record(int64_t value);
    uint64_t recordDelta(JSGlobalObject* globalObject);
    void reset();
    int64_t getMin() const;
    int64_t getMax() const;
    double getMean() const;
    double getStddev() const;
    int64_t getPercentile(double percentile) const;
    void getPercentiles(JSGlobalObject* globalObject, JSC::JSMap* map);
    void getPercentilesBigInt(JSGlobalObject* globalObject, JSC::JSMap* map);
    size_t getExceeds() const;
    uint64_t getCount() const;
    double add(JSNodePerformanceHooksHistogram* other);

    // std::shared_ptr<HistogramData> getHistogramDataForCloning() const;

private:
    uint16_t m_extraMemorySizeForGC = 0;
};

void setupJSNodePerformanceHooksHistogramClassStructure(JSC::LazyClassStructure::Initializer& init);

} // namespace Bun
