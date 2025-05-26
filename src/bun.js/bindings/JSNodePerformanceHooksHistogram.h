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

JSC_DECLARE_HOST_FUNCTION(jsNodePerformanceHooksHistogramProtoFuncPercentile);
JSC_DECLARE_HOST_FUNCTION(jsNodePerformanceHooksHistogramProtoFuncPercentileBigInt);
JSC_DECLARE_HOST_FUNCTION(jsNodePerformanceHooksHistogramProtoFuncGetPercentiles);
JSC_DECLARE_HOST_FUNCTION(jsNodePerformanceHooksHistogramProtoFuncGetPercentilesBigInt);

struct HDRHistogramDeleter {
    void operator()(hdr_histogram* histogram) {
        if (histogram)
            hdr_close(histogram);
    }
};
using HDRHistogramPointer = std::unique_ptr<hdr_histogram, HDRHistogramDeleter>;

struct HistogramData {
    HDRHistogramPointer histogram;
    uint64_t prevDeltaTime = 0;
    size_t exceedsCount = 0;

    WTF::Lock mutex;

    HistogramData(int64_t lowest, int64_t highest, int figures)
    {
        hdr_histogram* h = nullptr;
        // hdr_init returns 0 on success, non-zero on error (e.g., EINVAL, ENOMEM)
        if (hdr_init(lowest, highest, figures, &h) == 0) {
            histogram = HDRHistogramPointer(h);
        } else {
            // how to handle error? histogram remains null if init fails
        }
    }

    HistogramData() = default;
    ~HistogramData() = default;
};

class JSNodePerformanceHooksHistogram final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = NeedsDestruction;

    std::shared_ptr<HistogramData> m_histogramData;

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
        std::shared_ptr<HistogramData> existingHistogramData);

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

    JSNodePerformanceHooksHistogram(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    ~JSNodePerformanceHooksHistogram();

    hdr_histogram* histogram() const { return m_histogramData->histogram.get(); }

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

private:
    uint16_t m_extraMemorySizeForGC = 0;
};

void setupJSNodePerformanceHooksHistogramClassStructure(JSC::LazyClassStructure::Initializer& init);

} // namespace Bun 