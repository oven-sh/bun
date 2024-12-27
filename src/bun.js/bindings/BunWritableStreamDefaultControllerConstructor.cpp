
#include "root.h"

#include "JavaScriptCore/InternalFunction.h"
#include "ZigGlobalObject.h"
#include "BunWritableStreamDefaultControllerConstructor.h"
#include "BunWritableStreamDefaultController.h"
#include "BunWritableStreamDefaultControllerPrototype.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/FunctionPrototype.h>

namespace Bun {

JSWritableStreamDefaultControllerConstructor* JSWritableStreamDefaultControllerConstructor::create(
    JSC::VM& vm,
    JSC::JSGlobalObject* globalObject,
    JSWritableStreamDefaultControllerPrototype* prototype)
{
    auto* structure = createStructure(vm, globalObject, globalObject->functionPrototype());
    JSWritableStreamDefaultControllerConstructor* constructor = new (
        NotNull, JSC::allocateCell<JSWritableStreamDefaultControllerConstructor>(vm))
        JSWritableStreamDefaultControllerConstructor(vm, structure);
    constructor->finishCreation(vm, globalObject, prototype);
    return constructor;
}

void JSWritableStreamDefaultControllerConstructor::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSWritableStreamDefaultControllerPrototype* prototype)
{
    Base::finishCreation(vm, 1, "WritableStreamDefaultController"_s, JSC::InternalFunction::PropertyAdditionMode::WithoutStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
}

JSC_DEFINE_HOST_FUNCTION(constructJSWritableStreamDefaultController, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    return throwVMTypeError(globalObject, scope, "WritableStreamDefaultController constructor cannot be called as a function"_s);
}

JSC_DEFINE_HOST_FUNCTION(callJSWritableStreamDefaultController, (JSGlobalObject * globalObject, CallFrame*))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    return throwVMTypeError(globalObject, scope, "WritableStreamDefaultController constructor cannot be called as a function"_s);
}

const JSC::ClassInfo JSWritableStreamDefaultControllerConstructor::s_info = {
    "WritableStreamDefaultController"_s, &Base::s_info, nullptr, nullptr,
    CREATE_METHOD_TABLE(JSWritableStreamDefaultControllerConstructor)
};

} // namespace Bun
