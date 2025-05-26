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

    auto histogramData = std::make_shared<HistogramData>(lowest, highest, figures);
    if (!histogramData->histogram) {
        // If hdr_init failed, throw an error
        Bun::ERR::OUT_OF_RANGE(scope, globalObject, "Histogram creation failed: invalid parameters or out of memory"_s);
        return nullptr;
    }

    JSNodePerformanceHooksHistogram* ptr = new (NotNull, allocateCell<JSNodePerformanceHooksHistogram>(vm)) JSNodePerformanceHooksHistogram(vm, structure);
    ptr->m_histogramData = WTFMove(histogramData);
    ptr->finishCreation(vm);
    if (ptr->m_histogramData.histogram) {
        ptr->m_extraMemorySizeForGC = hdr_get_memory_size(ptr->m_histogramData.histogram.get());
        vm.heap.reportExtraMemoryAllocated(ptr, ptr->m_extraMemorySizeForGC);
    }
    return ptr;
}

JSNodePerformanceHooksHistogram* JSNodePerformanceHooksHistogram::create(VM& vm, Structure* structure, JSGlobalObject* globalObject, HistogramData&& existingHistogramData)
{
    JSNodePerformanceHooksHistogram* ptr = new (NotNull, allocateCell<JSNodePerformanceHooksHistogram>(vm)) JSNodePerformanceHooksHistogram(vm, structure, existingHistogramData);
    ptr->m_histogramData = WTFMove(existingHistogramData);
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

    // Report memory usage for the histogram
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

// MARK: JS-exposed methods/properties

bool JSNodePerformanceHooksHistogram::record(int64_t value)
{
    if (!m_histogramData.histogram) return false;

    bool recorded = hdr_record_value(m_histogramData.histogram, value);
    if (recorded && value > m_histogramData.histogram->highest_trackable_value) {
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
    return m_histogramData.histogram->total_count;
}

double JSNodePerformanceHooksHistogram::add(JSNodePerformanceHooksHistogram* other)
{
    if (!m_histogramData.histogram || !other || !other->m_histogramData.histogram) return 0;

    // hdr_add returns number of dropped values
    double dropped = hdr_add(m_histogramData.histogram, other->m_histogramData.histogram);
    
    // Update exceeds count - this is a simplified approach
    // In a full implementation, we'd need to recalculate based on the merged histogram
    m_histogramData.exceedsCount += other->m_histogramData.exceedsCount;

    return dropped;
}

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

// MARK: JSC_DEFINE_HOST_FUNCTION / JSC_DEFINE_CUSTOM_GETTER

JSC_DEFINE_HOST_FUNCTION(jsNodePerformanceHooksHistogramProtoFuncRecord, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodePerformanceHooksHistogram* thisObject = jsDynamicCast<JSNodePerformanceHooksHistogram*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        WebCore::throwThisTypeError(*globalObject, scope, "Histogram"_s, "record"_s);
        return {};
    }

    if (callFrame->argumentCount() < 1) {
        Bun::ERR::MISSING_ARGS(scope, globalObject, "record requires at least one argument"_s);
        return {};
    }

    JSValue arg = callFrame->uncheckedArgument(0);
    int64_t value;
    if (arg.isNumber()) {
        value = static_cast<int64_t>(arg.asNumber());
    } else if (arg.isBigInt()) {
        auto* bigInt = jsCast<JSBigInt*>(arg);
        value = JSBigInt::toBigInt64(bigInt);
    } else {
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "value"_s, "number or BigInt"_s, arg);
        return {};
    }

    if (value < 1) {
        Bun::ERR::OUT_OF_RANGE(scope, globalObject, "value is out of range (must be >= 1)"_s);
        return {};
    }

    thisObject->record(value);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsNodePerformanceHooksHistogramProtoFuncRecordDelta, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodePerformanceHooksHistogram* thisObject = jsDynamicCast<JSNodePerformanceHooksHistogram*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        WebCore::throwThisTypeError(*globalObject, scope, "Histogram"_s, "recordDelta"_s);
        return {};
    }

    uint64_t delta = thisObject->recordDelta(globalObject);
    return JSValue::encode(jsNumber(static_cast<double>(delta)));
}

JSC_DEFINE_HOST_FUNCTION(jsNodePerformanceHooksHistogramProtoFuncAdd, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodePerformanceHooksHistogram* thisObject = jsDynamicCast<JSNodePerformanceHooksHistogram*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        WebCore::throwThisTypeError(*globalObject, scope, "Histogram"_s, "add"_s);
        return {};
    }

    if (callFrame->argumentCount() < 1) {
        Bun::ERR::MISSING_ARGS(scope, globalObject, "add requires at least one argument"_s);
        return {};
    }

    JSValue otherArg = callFrame->uncheckedArgument(0);
    JSNodePerformanceHooksHistogram* otherHistogram = jsDynamicCast<JSNodePerformanceHooksHistogram*>(otherArg);
    if (!otherHistogram) [[unlikely]] {
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "argument"_s, "Histogram"_s, otherArg);
        return {};
    }

    double dropped = thisObject->add(otherHistogram);
    return JSValue::encode(jsNumber(dropped));
}

JSC_DEFINE_HOST_FUNCTION(jsNodePerformanceHooksHistogramProtoFuncReset, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodePerformanceHooksHistogram* thisObject = jsDynamicCast<JSNodePerformanceHooksHistogram*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        WebCore::throwThisTypeError(*globalObject, scope, "Histogram"_s, "reset"_s);
        return {};
    }

    thisObject->reset();
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsNodePerformanceHooksHistogramProtoFuncPercentile, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodePerformanceHooksHistogram* thisObject = jsDynamicCast<JSNodePerformanceHooksHistogram*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        WebCore::throwThisTypeError(*globalObject, scope, "Histogram"_s, "percentile"_s);
        return {};
    }

    if (callFrame->argumentCount() < 1) {
        Bun::ERR::MISSING_ARGS(scope, globalObject, "percentile requires an argument"_s);
        return {};
    }

    double percentile = callFrame->uncheckedArgument(0).toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (percentile <= 0 || percentile > 100 || std::isnan(percentile)) {
        Bun::ERR::OUT_OF_RANGE(scope, globalObject, "percentile"_s, "> 0 && <= 100"_s, jsNumber(percentile));
        return {};
    }

    return JSValue::encode(jsNumber(static_cast<double>(thisObject->getPercentile(percentile))));
}

JSC_DEFINE_HOST_FUNCTION(jsNodePerformanceHooksHistogramProtoFuncPercentileBigInt, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodePerformanceHooksHistogram* thisObject = jsDynamicCast<JSNodePerformanceHooksHistogram*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        WebCore::throwThisTypeError(*globalObject, scope, "Histogram"_s, "percentileBigInt"_s);
        return {};
    }

    if (callFrame->argumentCount() < 1) {
        Bun::ERR::MISSING_ARGS(scope, globalObject, "percentileBigInt requires an argument"_s);
        return {};
    }

    double percentile = callFrame->uncheckedArgument(0).toNumber(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (percentile <= 0 || percentile > 100 || std::isnan(percentile)) {
        Bun::ERR::OUT_OF_RANGE(scope, globalObject, "percentile"_s, "> 0 && <= 100"_s, jsNumber(percentile));
        return {};
    }

    return JSValue::encode(JSBigInt::createFrom(globalObject, thisObject->getPercentile(percentile)));
}

JSC_DEFINE_HOST_FUNCTION(jsNodePerformanceHooksHistogramProtoFuncGetPercentiles, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodePerformanceHooksHistogram* thisObject = jsDynamicCast<JSNodePerformanceHooksHistogram*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        WebCore::throwThisTypeError(*globalObject, scope, "Histogram"_s, "percentiles"_s);
        return {};
    }

    if (callFrame->argumentCount() < 1 || !callFrame->uncheckedArgument(0).isObject()) {
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "argument"_s, "Map"_s, callFrame->uncheckedArgument(0));
        return {};
    }
    JSMap* map = jsDynamicCast<JSMap*>(callFrame->uncheckedArgument(0));
    if (!map) [[unlikely]] {
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "argument"_s, "Map"_s, callFrame->uncheckedArgument(0));
        return {};
    }

    thisObject->getPercentiles(globalObject, map);
    return JSValue::encode(map);
}

JSC_DEFINE_HOST_FUNCTION(jsNodePerformanceHooksHistogramProtoFuncGetPercentilesBigInt, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodePerformanceHooksHistogram* thisObject = jsDynamicCast<JSNodePerformanceHooksHistogram*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        WebCore::throwThisTypeError(*globalObject, scope, "Histogram"_s, "percentilesBigInt"_s);
        return {};
    }

    if (callFrame->argumentCount() < 1 || !callFrame->uncheckedArgument(0).isObject()) {
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "argument"_s, "Map"_s, callFrame->uncheckedArgument(0));
        return {};
    }
    JSMap* map = jsDynamicCast<JSMap*>(callFrame->uncheckedArgument(0));
    if (!map) [[unlikely]] {
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "argument"_s, "Map"_s, callFrame->uncheckedArgument(0));
        return {};
    }

    thisObject->getPercentilesBigInt(globalObject, map);
    return JSValue::encode(map);
}

// MARK: Property getters

JSC_DEFINE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_count, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodePerformanceHooksHistogram* thisObject = jsDynamicCast<JSNodePerformanceHooksHistogram*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        WebCore::throwThisTypeError(*globalObject, scope, "Histogram"_s, "count"_s);
        return {};
    }
    return JSValue::encode(jsNumber(static_cast<double>(thisObject->getCount())));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_countBigInt, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodePerformanceHooksHistogram* thisObject = jsDynamicCast<JSNodePerformanceHooksHistogram*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        WebCore::throwThisTypeError(*globalObject, scope, "Histogram"_s, "countBigInt"_s);
        return {};
    }
    return JSValue::encode(JSBigInt::createFrom(globalObject, thisObject->getCount()));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_min, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodePerformanceHooksHistogram* thisObject = jsDynamicCast<JSNodePerformanceHooksHistogram*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        WebCore::throwThisTypeError(*globalObject, scope, "Histogram"_s, "min"_s);
        return {};
    }
    return JSValue::encode(jsNumber(static_cast<double>(thisObject->getMin())));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_minBigInt, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodePerformanceHooksHistogram* thisObject = jsDynamicCast<JSNodePerformanceHooksHistogram*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        WebCore::throwThisTypeError(*globalObject, scope, "Histogram"_s, "minBigInt"_s);
        return {};
    }
    return JSValue::encode(JSBigInt::createFrom(globalObject, thisObject->getMin()));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_max, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodePerformanceHooksHistogram* thisObject = jsDynamicCast<JSNodePerformanceHooksHistogram*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        WebCore::throwThisTypeError(*globalObject, scope, "Histogram"_s, "max"_s);
        return {};
    }
    return JSValue::encode(jsNumber(static_cast<double>(thisObject->getMax())));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_maxBigInt, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodePerformanceHooksHistogram* thisObject = jsDynamicCast<JSNodePerformanceHooksHistogram*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        WebCore::throwThisTypeError(*globalObject, scope, "Histogram"_s, "maxBigInt"_s);
        return {};
    }
    return JSValue::encode(JSBigInt::createFrom(globalObject, thisObject->getMax()));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_mean, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodePerformanceHooksHistogram* thisObject = jsDynamicCast<JSNodePerformanceHooksHistogram*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        WebCore::throwThisTypeError(*globalObject, scope, "Histogram"_s, "mean"_s);
        return {};
    }
    return JSValue::encode(jsNumber(thisObject->getMean()));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_stddev, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodePerformanceHooksHistogram* thisObject = jsDynamicCast<JSNodePerformanceHooksHistogram*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        WebCore::throwThisTypeError(*globalObject, scope, "Histogram"_s, "stddev"_s);
        return {};
    }
    return JSValue::encode(jsNumber(thisObject->getStddev()));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_exceeds, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodePerformanceHooksHistogram* thisObject = jsDynamicCast<JSNodePerformanceHooksHistogram*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        WebCore::throwThisTypeError(*globalObject, scope, "Histogram"_s, "exceeds"_s);
        return {};
    }
    return JSValue::encode(jsNumber(static_cast<double>(thisObject->getExceeds())));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_exceedsBigInt, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodePerformanceHooksHistogram* thisObject = jsDynamicCast<JSNodePerformanceHooksHistogram*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        WebCore::throwThisTypeError(*globalObject, scope, "Histogram"_s, "exceedsBigInt"_s);
        return {};
    }
    return JSValue::encode(JSBigInt::createFrom(globalObject, static_cast<uint64_t>(thisObject->getExceeds())));
}

// JSC Host function wrapper for creating histogram from JavaScript
JSC_DEFINE_HOST_FUNCTION(jsFunction_createHistogram, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Default values
    int64_t lowest = 1;
    int64_t highest = std::numeric_limits<int64_t>::max();
    int figures = 3;

    // Parse arguments
    if (callFrame->argumentCount() >= 1) {
        JSValue lowestArg = callFrame->uncheckedArgument(0);
        if (lowestArg.isNumber()) {
            lowest = static_cast<int64_t>(lowestArg.asNumber());
        } else if (lowestArg.isBigInt()) {
            auto* bigInt = jsCast<JSBigInt*>(lowestArg);
            lowest = JSBigInt::toBigInt64(bigInt);
        }
    }

    if (callFrame->argumentCount() >= 2) {
        JSValue highestArg = callFrame->uncheckedArgument(1);
        if (highestArg.isNumber()) {
            highest = static_cast<int64_t>(highestArg.asNumber());
        } else if (highestArg.isBigInt()) {
            auto* bigInt = jsCast<JSBigInt*>(highestArg);
            highest = JSBigInt::toBigInt64(bigInt);
        }
    }

    if (callFrame->argumentCount() >= 3) {
        JSValue figuresArg = callFrame->uncheckedArgument(2);
        if (figuresArg.isNumber()) {
            figures = static_cast<int>(figuresArg.asNumber());
        }
    }

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    Structure* structure = zigGlobalObject->m_JSNodePerformanceHooksHistogramClassStructure.get(zigGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSNodePerformanceHooksHistogram* histogram = JSNodePerformanceHooksHistogram::create(vm, structure, globalObject, lowest, highest, figures);
    RETURN_IF_EXCEPTION(scope, {});
    
    return JSValue::encode(histogram);
}

} // namespace Bun
 