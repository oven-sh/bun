#include "JSKeyObject.h"
#include "JSKeyObjectPrototype.h"
#include "JSKeyObjectConstructor.h"
#include "DOMIsoSubspaces.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/ObjectPrototype.h>

namespace Bun {

const JSC::ClassInfo JSKeyObject::s_info = { "KeyObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSKeyObject) };

void JSKeyObject::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);

    if (auto data = m_handle.data()) {
        m_sizeForGC = sizeof(KeyObjectData) + data->symmetricKey.sizeInBytes() + data->asymmetricKey.size();
        vm.heap.reportExtraMemoryAllocated(this, m_sizeForGC);
    }
}

template<typename Visitor>
void JSKeyObject::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSKeyObject* thisObject = uncheckedDowncast<JSKeyObject>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    visitor.reportExtraMemoryVisited(thisObject->m_sizeForGC);
}

DEFINE_VISIT_CHILDREN(JSKeyObject);

void setupKeyObjectClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSKeyObjectPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSKeyObjectPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSKeyObjectConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSKeyObjectConstructor::create(init.vm, init.global, constructorStructure, prototype);

    auto* structure = JSKeyObject::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
