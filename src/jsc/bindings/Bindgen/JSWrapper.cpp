#include "root.h"
#include "Bindgen/JSWrapper.h"
#include "GeneratedBindings+Tables.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSCInlines.h>

namespace Bun::Bindgen {
using namespace JSC;

const ClassInfo JSClassConstructor::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSClassConstructor) };

static JSC_DECLARE_HOST_FUNCTION(callJSClassConstructor);
JSC_DEFINE_HOST_FUNCTION(callJSClassConstructor, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* constructor = uncheckedDowncast<JSClassConstructor>(callFrame->jsCallee());
    Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, makeString(constructor->name(), " constructor cannot be invoked without 'new'"_s));
    return {};
}

JSClassConstructor::JSClassConstructor(VM& vm, Structure* structure, NativeFunction construct)
    : Base(vm, structure, callJSClassConstructor, construct)
{
}

JSClassConstructor* JSClassConstructor::create(VM& vm, JSGlobalObject* globalObject, const ClassDefinition& definition, JSObject* prototype)
{
    auto* structure = createStructure(vm, globalObject, globalObject->functionPrototype());
    auto* constructor = new (NotNull, allocateCell<JSClassConstructor>(vm)) JSClassConstructor(vm, structure, definition.construct);
    constructor->finishCreation(vm, definition.constructorLength, definition.info->className, PropertyAdditionMode::WithoutStructureTransition);
    Bun::reifyStaticPropertyTable(vm, info(), definition.constructorTableValues, *constructor);
    constructor->putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    return constructor;
}

void setupClassStructure(LazyClassStructure::Initializer& init, unsigned classIndex)
{
    const ClassDefinition& definition = *Tables::classes[classIndex];
    VM& vm = init.vm;
    auto* prototypeStructure = JSFinalObject::createStructure(vm, init.global, init.global->objectPrototype(), 0);
    prototypeStructure->setMayBePrototype(true);
    JSObject* prototype = JSFinalObject::create(vm, prototypeStructure);
    Bun::reifyStaticPropertyTable(vm, definition.info, definition.prototypeTableValues, *prototype);
    if (definition.finishPrototypeCreation)
        definition.finishPrototypeCreation(vm, init.global, prototype);
    Bun::putToStringTagWithoutTransition(vm, prototype, definition.info);
    init.setPrototype(prototype);
    init.setStructure(definition.createStructure(vm, init.global, prototype));
    if (definition.construct)
        init.setConstructor(JSClassConstructor::create(vm, init.global, definition, prototype));
}

Structure* structureForClass(JSGlobalObject* globalObject, unsigned classIndex)
{
    auto* global = defaultGlobalObject(globalObject);
    return global->m_bindgenAdditions.m_classes[classIndex].getInitializedOnMainThread(global);
}

JSObject* constructorForClass(JSGlobalObject* globalObject, unsigned classIndex)
{
    auto* global = defaultGlobalObject(globalObject);
    return global->m_bindgenAdditions.m_classes[classIndex].constructorInitializedOnMainThread(global);
}

Structure* structureForNewTarget(JSGlobalObject* globalObject, CallFrame* callFrame, unsigned classIndex)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* newTarget = asObject(callFrame->newTarget());
    if (newTarget == constructorForClass(globalObject, classIndex)) [[likely]]
        return structureForClass(globalObject, classIndex);
    // ShadowRealm functions belong to a different global object.
    auto* functionGlobalObject = getFunctionRealm(globalObject, newTarget);
    RETURN_IF_EXCEPTION(scope, nullptr);
    RELEASE_AND_RETURN(scope, InternalFunction::createSubclassStructure(globalObject, newTarget, structureForClass(functionGlobalObject, classIndex)));
}

}

extern "C" void Bun__Bindgen__setInternalField(JSC::JSGlobalObject* globalObject, JSC::JSCell* cell, uint32_t offset, JSC::EncodedJSValue value)
{
    auto* field = reinterpret_cast<JSC::WriteBarrier<JSC::Unknown>*>(reinterpret_cast<uint8_t*>(cell) + offset);
    field->set(JSC::getVM(globalObject), cell, JSC::JSValue::decode(value));
}
