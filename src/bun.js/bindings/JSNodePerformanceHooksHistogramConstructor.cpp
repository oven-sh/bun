#include "root.h"

#include "JSNodePerformanceHooksHistogramConstructor.h"
#include "JSNodePerformanceHooksHistogram.h"
#include "JSNodePerformanceHooksHistogramPrototype.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include "BunString.h"
#include "wtf/text/ASCIILiteral.h"
#include "wtf/Vector.h"

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/ThrowScope.h>
#include <JavaScriptCore/Options.h>
#include <JavaScriptCore/JSBigInt.h>

namespace Bun {

using namespace JSC;

const ClassInfo JSNodePerformanceHooksHistogramConstructor::s_info = { "Histogram"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodePerformanceHooksHistogramConstructor) };

void JSNodePerformanceHooksHistogramConstructor::finishCreation(VM& vm, JSGlobalObject* globalObject, JSObject* prototype)
{
    Base::finishCreation(vm, 3, "Histogram"_s, PropertyAdditionMode::WithStructureTransition); // lowest, highest, figures
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
            lowest = static_cast<int64_t>(dbl);
        }
    } else if (lowestVal.isBigInt()) {
        auto* bigInt = jsCast<JSBigInt*>(lowestVal);
        lowest = JSBigInt::toBigInt64(bigInt);
    }

    if (highestVal.isNumber()) {
        double dbl = highestVal.asNumber();
        if (!std::isnan(dbl)) {
            highest = static_cast<int64_t>(dbl);
        }
    } else if (highestVal.isBigInt()) {
        auto* bigInt = jsCast<JSBigInt*>(highestVal);
        highest = JSBigInt::toBigInt64(bigInt);
    }

    if (figuresVal.isNumber()) {
        double dbl = figuresVal.asNumber();
        if (!std::isnan(dbl)) {
            figures = static_cast<int>(dbl);
        }
    }

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    Structure* structure = zigGlobalObject->m_JSNodePerformanceHooksHistogramClassStructure.get(zigGlobalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);

    return JSNodePerformanceHooksHistogram::create(vm, structure, globalObject, lowest, highest, figures);
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

void setupJSNodePerformanceHooksHistogramClassStructure(LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSNodePerformanceHooksHistogramPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSNodePerformanceHooksHistogramPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSNodePerformanceHooksHistogramConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSNodePerformanceHooksHistogramConstructor::create(init.vm, init.global, constructorStructure, prototype);

    auto* structure = JSNodePerformanceHooksHistogram::createStructure(init.vm, init.global, prototype);

    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
