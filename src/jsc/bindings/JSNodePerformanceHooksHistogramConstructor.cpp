#include "root.h"

#include "JSNodePerformanceHooksHistogramConstructor.h"
#include "JSNodePerformanceHooksHistogram.h"
#include "JSNodePerformanceHooksHistogramPrototype.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include "BunString.h"
#include "wtf/text/ASCIILiteral.h"
#include "wtf/Vector.h"
#include <wtf/MathExtras.h>

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/ThrowScope.h>
#include <JavaScriptCore/Options.h>
#include <JavaScriptCore/JSBigInt.h>

namespace Bun {

using namespace JSC;

const ClassInfo JSNodePerformanceHooksHistogramConstructor::s_info = { "RecordableHistogram"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodePerformanceHooksHistogramConstructor) };

void JSNodePerformanceHooksHistogramConstructor::finishCreation(VM& vm, JSGlobalObject* globalObject, JSObject* prototype)
{
    Base::finishCreation(vm, 3, "RecordableHistogram"_s, PropertyAdditionMode::WithStructureTransition); // lowest, highest, figures
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
}

static JSNodePerformanceHooksHistogram* createHistogramInternal(JSGlobalObject* globalObject, JSValue lowestVal, JSValue highestVal, JSValue figuresVal)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    int64_t lowest = 1;
    int64_t highest = std::numeric_limits<int64_t>::max();
    int figures = 3;

    if (lowestVal.isNumber()) {
        double dbl = lowestVal.asNumber();
        if (!std::isnan(dbl)) {
            lowest = truncateDoubleToInt64(dbl);
        }
    } else if (lowestVal.isBigInt()) {
        auto* bigInt = uncheckedDowncast<JSBigInt>(lowestVal);
        lowest = JSBigInt::toBigInt64(bigInt);
    }

    if (highestVal.isNumber()) {
        double dbl = highestVal.asNumber();
        if (!std::isnan(dbl)) {
            highest = truncateDoubleToInt64(dbl);
        }
    } else if (highestVal.isBigInt()) {
        auto* bigInt = uncheckedDowncast<JSBigInt>(highestVal);
        highest = JSBigInt::toBigInt64(bigInt);
    }

    if (figuresVal.isNumber()) {
        double dbl = figuresVal.asNumber();
        if (!std::isnan(dbl)) {
            figures = truncateDoubleToInt32(dbl);
        }
    }

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    Structure* structure = zigGlobalObject->m_JSNodePerformanceHooksHistogramClassStructure.get(zigGlobalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);

    return JSNodePerformanceHooksHistogram::create(vm, structure, globalObject, HistogramKind::Recordable, lowest, highest, figures);
}

JSC_DEFINE_HOST_FUNCTION(jsNodePerformanceHooksHistogramConstructorCall, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    Bun::throwError(globalObject, scope, ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "Histogram constructor cannot be invoked without 'new'"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(jsNodePerformanceHooksHistogramConstructorConstruct, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue lowestArg = callFrame->argument(0);
    JSValue highestArg = callFrame->argument(1);
    JSValue figuresArg = callFrame->argument(2);

    JSNodePerformanceHooksHistogram* histogram = createHistogramInternal(globalObject, lowestArg, highestArg, figuresArg);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(histogram);
}

JSC_DEFINE_HOST_FUNCTION(jsNodePerformanceHooksHistogramIllegalConstructor, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    Bun::throwError(globalObject, scope, ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "Illegal constructor"_s);
    return {};
}

void setupJSNodePerformanceHooksHistogramClassStructure(LazyClassStructure::Initializer& init)
{
    auto* baseProtoStructure = JSNodePerformanceHooksHistogramPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* basePrototype = JSNodePerformanceHooksHistogramPrototype::create(init.vm, init.global, baseProtoStructure);

    auto* baseConstructor = JSFunction::create(init.vm, init.global, 0, "Histogram"_s, jsNodePerformanceHooksHistogramIllegalConstructor, ImplementationVisibility::Public);
    basePrototype->putDirect(init.vm, init.vm.propertyNames->constructor, baseConstructor, JSC::PropertyAttribute::DontEnum | 0);

    auto* recordableProtoStructure = JSNodePerformanceHooksRecordableHistogramPrototype::createStructure(init.vm, init.global, basePrototype);
    auto* recordablePrototype = JSNodePerformanceHooksRecordableHistogramPrototype::create(init.vm, init.global, recordableProtoStructure);

    auto* constructorStructure = JSNodePerformanceHooksHistogramConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSNodePerformanceHooksHistogramConstructor::create(init.vm, init.global, constructorStructure, recordablePrototype);

    auto* structure = JSNodePerformanceHooksHistogram::createStructure(init.vm, init.global, recordablePrototype);

    init.setPrototype(recordablePrototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

Structure* createJSNodePerformanceHooksIntervalHistogramStructure(JSC::VM& vm, Zig::GlobalObject* globalObject)
{
    JSObject* recordablePrototype = globalObject->m_JSNodePerformanceHooksHistogramClassStructure.prototype(globalObject);
    JSValue basePrototype = recordablePrototype->getPrototypeDirect();
    ASSERT(basePrototype.inherits<JSNodePerformanceHooksHistogramPrototype>());
    return JSNodePerformanceHooksHistogram::createStructure(vm, globalObject, basePrototype);
}

} // namespace Bun
