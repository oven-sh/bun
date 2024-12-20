#include "root.h"

#include "BunReadableStreamConstructor.h"
#include "BunReadableStream.h"
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSCInlines.h>
#include "ZigGlobalObject.h"
namespace Bun {

using namespace JSC;

const ClassInfo JSReadableStreamConstructor::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSReadableStreamConstructor) };

JSReadableStreamConstructor* JSReadableStreamConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSObject* prototype)
{
    auto* constructor = new (NotNull, allocateCell<JSReadableStreamConstructor>(vm)) JSReadableStreamConstructor(vm, structure);
    constructor->finishCreation(vm, globalObject, prototype);
    return constructor;
}

Structure* JSReadableStreamConstructor::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(InternalFunctionType, StructureFlags), info());
}

JSReadableStreamConstructor::JSReadableStreamConstructor(VM& vm, Structure* structure)
    : Base(vm, structure, call, construct)
{
}

void JSReadableStreamConstructor::finishCreation(VM& vm, JSGlobalObject* globalObject, JSObject* prototype)
{
    Base::finishCreation(vm, 1, "ReadableStream"_s, PropertyAdditionMode::WithoutStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | 0);
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSReadableStreamConstructor::construct(JSGlobalObject* globalObject, CallFrame* callFrame)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* zigGlobalObject = defaultGlobalObject(globalObject);

    JSObject* newTarget = asObject(callFrame->newTarget());
    Structure* structure = zigGlobalObject->streams().getReadableStreamStructure(globalObject);

    auto* constructor = zigGlobalObject->streams().getReadableStreamConstructor(globalObject);

    if (!(!newTarget || newTarget != constructor)) {
        if (newTarget) {
            structure = JSC::InternalFunction::createSubclassStructure(getFunctionRealm(globalObject, newTarget), newTarget, structure);
        } else {
            structure = JSC::InternalFunction::createSubclassStructure(globalObject, constructor, structure);
        }
    }

    auto* stream = JSReadableStream::create(vm, globalObject, structure);
    return JSValue::encode(stream);
}

JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSReadableStreamConstructor::call(JSGlobalObject* globalObject, CallFrame* callFrame)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    return throwVMTypeError(globalObject, scope, "ReadableStream constructor cannot be called without 'new'"_s);
}

} // namespace Bun
