#include "JSKeyObjectHandle.h"
#include "JSKeyObjectHandlePrototype.h"
#include "JSKeyObjectHandleConstructor.h"
#include "DOMIsoSubspaces.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/ObjectPrototype.h>

namespace Bun {

const JSC::ClassInfo JSKeyObjectHandle::s_info = { "KeyObjectHandle"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSKeyObjectHandle) };

void JSKeyObjectHandle::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
}

template<typename Visitor>
void JSKeyObjectHandle::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSKeyObjectHandle* thisObject = jsCast<JSKeyObjectHandle*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(JSKeyObjectHandle);

void setupKeyObjectHandleClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* globalObject = defaultGlobalObject(init.global);

    auto* prototypeStructure = JSKeyObjectHandlePrototype::createStructure(init.vm, init.global, globalObject->JSKeyObjectPrototype());
    auto* prototype = JSKeyObjectHandlePrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSKeyObjectHandleConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSKeyObjectHandleConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSKeyObjectHandle::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
