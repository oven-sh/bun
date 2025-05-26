#include "root.h"

#include "JSNodePerformanceHooksHistogramPrototype.h"
#include "JSNodePerformanceHooksHistogram.h"
#include "wtf/text/ASCIILiteral.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun {

using namespace JSC;

static const HashTableValue JSNodePerformanceHooksHistogramPrototypeTableValues[] = {
    { "record"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodePerformanceHooksHistogramProtoFuncRecord, 1 } },
    { "recordDelta"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodePerformanceHooksHistogramProtoFuncRecordDelta, 0 } },
    { "add"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodePerformanceHooksHistogramProtoFuncAdd, 1 } },
    { "reset"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodePerformanceHooksHistogramProtoFuncReset, 0 } },
    { "percentile"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodePerformanceHooksHistogramProtoFuncPercentile, 1 } },
    { "percentileBigInt"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodePerformanceHooksHistogramProtoFuncPercentileBigInt, 1 } },
    { "percentiles"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodePerformanceHooksHistogramProtoFuncGetPercentiles, 1 } },
    { "percentilesBigInt"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsNodePerformanceHooksHistogramProtoFuncGetPercentilesBigInt, 1 } },

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
};

const ClassInfo JSNodePerformanceHooksHistogramPrototype::s_info = { "Histogram"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodePerformanceHooksHistogramPrototype) };

void JSNodePerformanceHooksHistogramPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSNodePerformanceHooksHistogram::info(), JSNodePerformanceHooksHistogramPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

} // namespace Bun
