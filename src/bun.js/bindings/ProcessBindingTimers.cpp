#include "ProcessBindingTimers.h"

#include <JavaScriptCore/ObjectConstructor.h>

using namespace JSC;

extern "C" int64_t Bun__timespecNowMs(void);

namespace Bun {
namespace ProcessBindingTimers {

JSC_DEFINE_HOST_FUNCTION(jsGetLibuvNow, (JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return JSValue::encode(jsDoubleNumber(Bun__timespecNowMs()));
}

JSObject* create(VM& vm, JSGlobalObject* globalObject)
{
    auto bindingObject = constructEmptyObject(globalObject, globalObject->objectPrototype(), 0);
    bindingObject->putDirect(vm,
        Identifier::fromString(vm, "getLibuvNow"_s),
        JSFunction::create(vm, globalObject, 1, "getLibuvNow"_s, jsGetLibuvNow, ImplementationVisibility::Public));
    return bindingObject;
}

} // namespace ProcessBindingTimers
} // namespace Bun
