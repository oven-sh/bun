#include "root.h"

#include "ErrorCode.h"
#include "BunTransformStreamDefaultControllerConstructor.h"
#include "BunTransformStreamDefaultControllerPrototype.h"

namespace Bun {

const JSC::ClassInfo JSTransformStreamDefaultControllerConstructor::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTransformStreamDefaultControllerConstructor) };

JSTransformStreamDefaultControllerConstructor::JSTransformStreamDefaultControllerConstructor(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure, call, construct)
{
}

JSTransformStreamDefaultControllerConstructor* JSTransformStreamDefaultControllerConstructor::create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSTransformStreamDefaultControllerPrototype* prototype)
{
    JSTransformStreamDefaultControllerConstructor* constructor = new (NotNull, JSC::allocateCell<JSTransformStreamDefaultControllerConstructor>(vm))
        JSTransformStreamDefaultControllerConstructor(vm, structure);
    constructor->finishCreation(vm, globalObject, prototype);
    return constructor;
}

void JSTransformStreamDefaultControllerConstructor::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSTransformStreamDefaultControllerPrototype* prototype)
{
    Base::finishCreation(vm, 2, "TransformStreamDefaultController"_s, PropertyAdditionMode::WithoutStructureTransition);
    ASSERT(inherits(info()));

    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | 0);
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSTransformStreamDefaultControllerConstructor::call(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "TransformStreamDefaultController constructor cannot be called directly"_s);
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSTransformStreamDefaultControllerConstructor::construct(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "TransformStreamDefaultController constructor cannot be constructed directly"_s);
}

} // namespace Bun
