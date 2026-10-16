#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"
#include "NodeValidator.h"
#include "root.h"

#include "JSNodePerformanceHooksHistogramPrototype.h"
#include "JSNodePerformanceHooksHistogram.h"
#include "wtf/text/ASCIILiteral.h"
#include <wtf/MathExtras.h>
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
    Bun::reifyStaticPropertyTable(vm, JSNodePerformanceHooksHistogram::info(), JSNodePerformanceHooksHistogramPrototypeTableValues, *this);
    Bun::putToStringTagWithoutTransition(vm, this, info());
}

JSC_DEFINE_HOST_FUNCTION(jsNodePerformanceHooksHistogramProtoFuncRecord, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSNodePerformanceHooksHistogram* thisObject = dynamicDowncast<JSNodePerformanceHooksHistogram>(callFrame->thisValue());
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
        value = truncateDoubleToInt64(arg.asNumber());
    } else if (arg.isBigInt()) {
        auto* bigInt = uncheckedDowncast<JSBigInt>(arg);
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

    JSNodePerformanceHooksHistogram* thisObject = dynamicDowncast<JSNodePerformanceHooksHistogram>(callFrame->thisValue());
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

    JSNodePerformanceHooksHistogram* thisObject = dynamicDowncast<JSNodePerformanceHooksHistogram>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        WebCore::throwThisTypeError(*globalObject, scope, "Histogram"_s, "add"_s);
        return {};
    }

    if (callFrame->argumentCount() < 1) {
        Bun::ERR::MISSING_ARGS(scope, globalObject, "add requires at least one argument"_s);
        return {};
    }

    JSValue otherArg = callFrame->uncheckedArgument(0);
    JSNodePerformanceHooksHistogram* otherHistogram = dynamicDowncast<JSNodePerformanceHooksHistogram>(otherArg);
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

    JSNodePerformanceHooksHistogram* thisObject = dynamicDowncast<JSNodePerformanceHooksHistogram>(callFrame->thisValue());
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
    RETURN_IF_EXCEPTION(scope, {});
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

    JSNodePerformanceHooksHistogram* thisObject = dynamicDowncast<JSNodePerformanceHooksHistogram>(callFrame->thisValue());
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

    JSNodePerformanceHooksHistogram* thisObject = dynamicDowncast<JSNodePerformanceHooksHistogram>(callFrame->thisValue());
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

    JSNodePerformanceHooksHistogram* thisObject = dynamicDowncast<JSNodePerformanceHooksHistogram>(JSValue::decode(thisValue));
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

    JSNodePerformanceHooksHistogram* thisObject = dynamicDowncast<JSNodePerformanceHooksHistogram>(JSValue::decode(thisValue));
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

    JSNodePerformanceHooksHistogram* thisObject = dynamicDowncast<JSNodePerformanceHooksHistogram>(JSValue::decode(thisValue));
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

    JSNodePerformanceHooksHistogram* thisObject = dynamicDowncast<JSNodePerformanceHooksHistogram>(JSValue::decode(thisValue));
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

    JSNodePerformanceHooksHistogram* thisObject = dynamicDowncast<JSNodePerformanceHooksHistogram>(JSValue::decode(thisValue));
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

    JSNodePerformanceHooksHistogram* thisObject = dynamicDowncast<JSNodePerformanceHooksHistogram>(JSValue::decode(thisValue));
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

    JSNodePerformanceHooksHistogram* thisObject = dynamicDowncast<JSNodePerformanceHooksHistogram>(JSValue::decode(thisValue));
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

    JSNodePerformanceHooksHistogram* thisObject = dynamicDowncast<JSNodePerformanceHooksHistogram>(JSValue::decode(thisValue));
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

    JSNodePerformanceHooksHistogram* thisObject = dynamicDowncast<JSNodePerformanceHooksHistogram>(JSValue::decode(thisValue));
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

    JSNodePerformanceHooksHistogram* thisObject = dynamicDowncast<JSNodePerformanceHooksHistogram>(JSValue::decode(thisValue));
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

    JSNodePerformanceHooksHistogram* thisObject = dynamicDowncast<JSNodePerformanceHooksHistogram>(JSValue::decode(thisValue));
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

    JSNodePerformanceHooksHistogram* thisObject = dynamicDowncast<JSNodePerformanceHooksHistogram>(JSValue::decode(thisValue));
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
            lowest = truncateDoubleToInt64(lowestArg.asNumber());
        } else if (lowestArg.isBigInt()) {
            auto* bigInt = uncheckedDowncast<JSBigInt>(lowestArg);
            lowest = JSBigInt::toBigInt64(bigInt);
        }
    }

    if (callFrame->argumentCount() >= 2) {
        JSValue highestArg = callFrame->uncheckedArgument(1);
        if (highestArg.isNumber()) {
            highest = truncateDoubleToInt64(highestArg.asNumber());
        } else if (highestArg.isBigInt()) {
            auto* bigInt = uncheckedDowncast<JSBigInt>(highestArg);
            highest = JSBigInt::toBigInt64(bigInt);
        }
    }

    if (callFrame->argumentCount() >= 3) {
        JSValue figuresArg = callFrame->uncheckedArgument(2);
        if (figuresArg.isNumber()) {
            figures = truncateDoubleToInt32(figuresArg.asNumber());
        }
    }

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    Structure* structure = zigGlobalObject->m_JSNodePerformanceHooksHistogramClassStructure.get(zigGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSNodePerformanceHooksHistogram* histogram = JSNodePerformanceHooksHistogram::create(vm, structure, globalObject, lowest, highest, figures);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(histogram);
}

// perf_hooks.monitorEventLoopDelay(): the caller has validated `resolution` as an integer >= 1.
JSC_DEFINE_HOST_FUNCTION(jsFunction_monitorEventLoopDelay, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue resolutionValue = callFrame->argument(0);
    ASSERT(resolutionValue.isNumber());
    // node keeps a resolution of up to 2^53 - 1 ms (nodejs/node@2ce7a73fec). Here the largest
    // interval is the one of setTimeout(), 2^31 - 1 ms (24.8 days), and a monitor above it samples
    // at that interval.
    int32_t resolution = static_cast<int32_t>(std::clamp(resolutionValue.asNumber(), 1.0, static_cast<double>(std::numeric_limits<int32_t>::max())));

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    Structure* structure = zigGlobalObject->m_JSNodePerformanceHooksELDHistogramStructure.get(zigGlobalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // node's range: https://github.com/nodejs/node/blob/b7e6a5d37e7a14ef0f2cc95214b95d66c4081415/src/node_perf.cc#L298
    // A sample is a whole interval, so a lower `highest` would drop every sample of a monitor
    // whose resolution is above it.
    JSNodePerformanceHooksHistogram* histogram = JSNodePerformanceHooksHistogram::create(
        vm, structure, globalObject,
        1000, // lowest: 1 microsecond in nanoseconds
        std::numeric_limits<int64_t>::max(), // highest
        3, // figures: 3 significant digits
        resolution);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(histogram);
}

static JSC_DECLARE_HOST_FUNCTION(jsNodePerformanceHooksELDHistogramProtoFuncEnable);
static JSC_DECLARE_HOST_FUNCTION(jsNodePerformanceHooksELDHistogramProtoFuncDisable);
static JSC_DECLARE_HOST_FUNCTION(jsNodePerformanceHooksELDHistogramProtoFuncDispose);
static JSC_DECLARE_HOST_FUNCTION(jsNodePerformanceHooksELDHistogramConstructorCall);
static JSC_DECLARE_HOST_FUNCTION(jsNodePerformanceHooksELDHistogramConstructorConstruct);

static JSNodePerformanceHooksHistogram* toEventLoopDelayHistogram(JSValue thisValue)
{
    auto* histogram = dynamicDowncast<JSNodePerformanceHooksHistogram>(thisValue);
    return histogram && histogram->isEventLoopDelay() ? histogram : nullptr;
}

JSC_DEFINE_HOST_FUNCTION(jsNodePerformanceHooksELDHistogramProtoFuncEnable, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    auto* histogram = toEventLoopDelayHistogram(callFrame->thisValue());
    if (!histogram) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, globalObject, "ELDHistogram"_s);

    return JSValue::encode(jsBoolean(histogram->enableEventLoopDelay()));
}

JSC_DEFINE_HOST_FUNCTION(jsNodePerformanceHooksELDHistogramProtoFuncDisable, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    auto* histogram = toEventLoopDelayHistogram(callFrame->thisValue());
    if (!histogram) [[unlikely]]
        return Bun::ERR::INVALID_THIS(scope, globalObject, "ELDHistogram"_s);

    return JSValue::encode(jsBoolean(histogram->disableEventLoopDelay()));
}

// `[SymbolDispose]() { this.disable(); }`
// https://github.com/nodejs/node/blob/b7e6a5d37e7a14ef0f2cc95214b95d66c4081415/lib/internal/perf/event_loop_delay.js#L70-L72
JSC_DEFINE_HOST_FUNCTION(jsNodePerformanceHooksELDHistogramProtoFuncDispose, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    JSValue disable = thisValue.get(globalObject, Identifier::fromString(vm, "disable"_s));
    RETURN_IF_EXCEPTION(scope, {});
    auto callData = JSC::getCallData(disable);
    if (callData.type == CallData::Type::None) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "this.disable is not a function"_s);

    JSC::profiledCall(globalObject, ProfilingReason::API, disable, callData, thisValue, ArgList());
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsNodePerformanceHooksELDHistogramConstructorCall, (JSGlobalObject * globalObject, CallFrame*))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    return throwVMTypeError(globalObject, scope, "Class constructor ELDHistogram cannot be invoked without 'new'"_s);
}

JSC_DEFINE_HOST_FUNCTION(jsNodePerformanceHooksELDHistogramConstructorConstruct, (JSGlobalObject * globalObject, CallFrame*))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    return Bun::throwError(globalObject, scope, ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "Illegal constructor"_s);
}

static const HashTableValue JSNodePerformanceHooksELDHistogramPrototypeTableValues[] = {
    { "enable"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodePerformanceHooksELDHistogramProtoFuncEnable, 0 } },
    { "disable"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodePerformanceHooksELDHistogramProtoFuncDisable, 0 } },
};

const ClassInfo JSNodePerformanceHooksELDHistogramPrototype::s_info = { "ELDHistogram"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodePerformanceHooksELDHistogramPrototype) };

void JSNodePerformanceHooksELDHistogramPrototype::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);

    auto* constructor = JSFunction::create(vm, globalObject, 0, "ELDHistogram"_s, jsNodePerformanceHooksELDHistogramConstructorCall, ImplementationVisibility::Public, NoIntrinsic, jsNodePerformanceHooksELDHistogramConstructorConstruct);
    constructor->putDirect(vm, vm.propertyNames->prototype, this, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    putDirect(vm, vm.propertyNames->constructor, constructor, static_cast<unsigned>(PropertyAttribute::DontEnum));

    Bun::reifyStaticPropertyTable(vm, JSNodePerformanceHooksHistogram::info(), JSNodePerformanceHooksELDHistogramPrototypeTableValues, *this);

    auto* dispose = JSFunction::create(vm, globalObject, 0, "[Symbol.dispose]"_s, jsNodePerformanceHooksELDHistogramProtoFuncDispose, ImplementationVisibility::Public);
    putDirect(vm, vm.propertyNames->disposeSymbol, dispose, static_cast<unsigned>(PropertyAttribute::DontEnum));
}

} // namespace Bun
