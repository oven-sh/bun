#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"
#include "NodeValidator.h"
#include "root.h"

#include "JSNodePerformanceHooksHistogramPrototype.h"
#include "JSNodePerformanceHooksHistogram.h"
#include "wtf/text/ASCIILiteral.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSMapInlines.h>

namespace Bun {

using namespace JSC;

static const HashTableValue JSNodePerformanceHooksHistogramPrototypeTableValues[] = {
    { "record"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodePerformanceHooksHistogramProtoFuncRecord, 1 } },
    { "recordDelta"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodePerformanceHooksHistogramProtoFuncRecordDelta, 0 } },
    { "add"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodePerformanceHooksHistogramProtoFuncAdd, 1 } },
    { "reset"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodePerformanceHooksHistogramProtoFuncReset, 0 } },
    { "percentile"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodePerformanceHooksHistogramProtoFuncPercentile, 1 } },
    { "percentileBigInt"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodePerformanceHooksHistogramProtoFuncPercentileBigInt, 1 } },

    { "count"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodePerformanceHooksHistogramGetter_count, 0 } },
    { "countBigInt"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodePerformanceHooksHistogramGetter_countBigInt, 0 } },
    { "min"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodePerformanceHooksHistogramGetter_min, 0 } },
    { "minBigInt"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodePerformanceHooksHistogramGetter_minBigInt, 0 } },
    { "max"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodePerformanceHooksHistogramGetter_max, 0 } },
    { "maxBigInt"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodePerformanceHooksHistogramGetter_maxBigInt, 0 } },
    { "mean"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodePerformanceHooksHistogramGetter_mean, 0 } },
    { "stddev"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodePerformanceHooksHistogramGetter_stddev, 0 } },
    { "exceeds"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodePerformanceHooksHistogramGetter_exceeds, 0 } },
    { "exceedsBigInt"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodePerformanceHooksHistogramGetter_exceedsBigInt, 0 } },
    { "percentiles"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodePerformanceHooksHistogramGetter_percentiles, 0 } },
    { "percentilesBigInt"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsNodePerformanceHooksHistogramGetter_percentilesBigInt, 0 } },
};

const ClassInfo JSNodePerformanceHooksHistogramPrototype::s_info = { "RecordableHistogram"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodePerformanceHooksHistogramPrototype) };

void JSNodePerformanceHooksHistogramPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSNodePerformanceHooksHistogram::info(), JSNodePerformanceHooksHistogramPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

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

    thisObject->recordDelta(globalObject);
    return JSValue::encode(jsUndefined());
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

static double toPercentile(JSC::ThrowScope& scope, JSGlobalObject* globalObject, JSValue value)
{
    Bun::V::validateNumber(scope, globalObject, value, "percentile"_s, jsNumber(0), jsNumber(100));
    RETURN_IF_EXCEPTION(scope, {});

    // TODO: rewrite validateNumber to return the validated value.
    double percentile = value.toNumber(globalObject);
    scope.assertNoException();
    if (percentile <= 0 || percentile > 100 || std::isnan(percentile)) {
        Bun::ERR::OUT_OF_RANGE(scope, globalObject, "percentile"_s, "> 0 && <= 100"_s, value);
        return {};
    }
    return percentile;
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

    double percentile = toPercentile(scope, globalObject, callFrame->uncheckedArgument(0));
    RETURN_IF_EXCEPTION(scope, {});

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

    double percentile = toPercentile(scope, globalObject, callFrame->uncheckedArgument(0));
    RETURN_IF_EXCEPTION(scope, {});

    RELEASE_AND_RETURN(scope, JSValue::encode(JSBigInt::createFrom(globalObject, thisObject->getPercentile(percentile))));
}

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
    RELEASE_AND_RETURN(scope, JSValue::encode(JSBigInt::createFrom(globalObject, thisObject->getCount())));
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

    int64_t minValue = thisObject->getMin();

    // Node.js returns the value as if it were unsigned when converting to double
    // This handles the special case where the initial value is INT64_MIN
    return JSValue::encode(jsNumber(static_cast<double>(static_cast<uint64_t>(minValue))));
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

    // Node.js returns different initial values for min vs minBigInt
    // min returns 9223372036854776000 (as double)
    // minBigInt returns 9223372036854775807n (INT64_MAX)
    if (thisObject->getCount() == 0) {
        RELEASE_AND_RETURN(scope, JSValue::encode(JSBigInt::createFrom(globalObject, INT64_MAX)));
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(JSBigInt::createFrom(globalObject, thisObject->getMin())));
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
    RELEASE_AND_RETURN(scope, JSValue::encode(JSBigInt::createFrom(globalObject, thisObject->getMax())));
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
    RELEASE_AND_RETURN(scope, JSValue::encode(JSBigInt::createFrom(globalObject, static_cast<uint64_t>(thisObject->getExceeds()))));
}

JSC_DEFINE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_percentiles, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodePerformanceHooksHistogram* thisObject = jsDynamicCast<JSNodePerformanceHooksHistogram*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        WebCore::throwThisTypeError(*globalObject, scope, "Histogram"_s, "percentiles"_s);
        return {};
    }

    JSMap* map = JSMap::create(vm, globalObject->mapStructure());
    thisObject->getPercentiles(globalObject, map);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(map);
}

JSC_DEFINE_CUSTOM_GETTER(jsNodePerformanceHooksHistogramGetter_percentilesBigInt, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodePerformanceHooksHistogram* thisObject = jsDynamicCast<JSNodePerformanceHooksHistogram*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        WebCore::throwThisTypeError(*globalObject, scope, "Histogram"_s, "percentilesBigInt"_s);
        return {};
    }

    JSMap* map = JSMap::create(vm, globalObject->mapStructure());
    thisObject->getPercentilesBigInt(globalObject, map);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(map);
}

JSC_DEFINE_HOST_FUNCTION(jsFunction_createHistogram, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    int64_t lowest = 1;
    int64_t highest = std::numeric_limits<int64_t>::max();
    int figures = 3;

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

// Extern declarations for Timer.zig
extern "C" void Timer_enableEventLoopDelayMonitoring(void* vm, JSC::EncodedJSValue histogram, int32_t resolution);
extern "C" void Timer_disableEventLoopDelayMonitoring(void* vm);

// Create histogram for event loop delay monitoring
JSC_DEFINE_HOST_FUNCTION(jsFunction_monitorEventLoopDelay, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    int32_t resolution = 10; // default 10ms
    if (callFrame->argumentCount() > 0) {
        resolution = callFrame->argument(0).toInt32(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        if (resolution < 1) {
            throwRangeError(globalObject, scope, "Resolution must be >= 1"_s);
            return JSValue::encode(jsUndefined());
        }
    }

    // Create histogram with range for event loop delays (1ns to 1 hour)
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    Structure* structure = zigGlobalObject->m_JSNodePerformanceHooksHistogramClassStructure.get(zigGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSNodePerformanceHooksHistogram* histogram = JSNodePerformanceHooksHistogram::create(
        vm, structure, globalObject,
        1, // lowest: 1 nanosecond
        3600000000000LL, // highest: 1 hour in nanoseconds
        3 // figures: 3 significant digits
    );

    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(histogram);
}

// Enable event loop delay monitoring
JSC_DEFINE_HOST_FUNCTION(jsFunction_enableEventLoopDelay, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 2) {
        throwTypeError(globalObject, scope, "Missing arguments"_s);
        return JSValue::encode(jsUndefined());
    }

    JSValue histogramValue = callFrame->argument(0);
    JSNodePerformanceHooksHistogram* histogram = jsDynamicCast<JSNodePerformanceHooksHistogram*>(histogramValue);

    if (!histogram) {
        throwTypeError(globalObject, scope, "Invalid histogram"_s);
        return JSValue::encode(jsUndefined());
    }

    int32_t resolution = callFrame->argument(1).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // Reset histogram data on enable
    histogram->reset();

    // Enable the event loop delay monitor in Timer.zig
    Timer_enableEventLoopDelayMonitoring(bunVM(globalObject), JSValue::encode(histogram), resolution);

    RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
}

// Disable event loop delay monitoring
JSC_DEFINE_HOST_FUNCTION(jsFunction_disableEventLoopDelay, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "Missing histogram argument"_s);
        return JSValue::encode(jsUndefined());
    }

    JSValue histogramValue = callFrame->argument(0);
    JSNodePerformanceHooksHistogram* histogram = jsDynamicCast<JSNodePerformanceHooksHistogram*>(histogramValue);

    if (!histogram) {
        throwTypeError(globalObject, scope, "Invalid histogram"_s);
        return JSValue::encode(jsUndefined());
    }

    // Call into Zig to disable monitoring
    Timer_disableEventLoopDelayMonitoring(bunVM(globalObject));

    return JSValue::encode(jsUndefined());
}

// Extern function for Zig to record delays
extern "C" void JSNodePerformanceHooksHistogram_recordDelay(JSC::EncodedJSValue histogram, int64_t delay_ns)
{
    if (!histogram || delay_ns <= 0) return;

    auto* hist = jsCast<JSNodePerformanceHooksHistogram*>(JSValue::decode(histogram));
    hist->record(delay_ns);
}

} // namespace Bun
