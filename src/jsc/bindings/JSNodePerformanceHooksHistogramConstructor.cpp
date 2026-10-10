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

namespace Bun {

using namespace JSC;

const ClassInfo JSNodePerformanceHooksHistogramConstructor::s_info = { "Histogram"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSNodePerformanceHooksHistogramConstructor) };

void JSNodePerformanceHooksHistogramConstructor::finishCreation(VM& vm, JSGlobalObject* globalObject, JSObject* prototype)
{
    Base::finishCreation(vm, 0, "Histogram"_s, PropertyAdditionMode::WithStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
}

JSC_DEFINE_HOST_FUNCTION(jsNodePerformanceHooksHistogramConstructorCall, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    Bun::throwError(globalObject, scope, ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "Histogram constructor cannot be invoked without 'new'"_s);
    return {};
}

// Only createHistogram() and monitorEventLoopDelay() make a histogram, as in Node.
JSC_DEFINE_HOST_FUNCTION(jsNodePerformanceHooksHistogramConstructorConstruct, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    Bun::throwError(globalObject, scope, ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "Illegal constructor"_s);
    return {};
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
