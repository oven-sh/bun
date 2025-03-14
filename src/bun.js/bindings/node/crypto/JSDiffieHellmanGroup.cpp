#include "JSDiffieHellmanGroup.h"
#include "JSDiffieHellmanGroupPrototype.h"
#include "JSDiffieHellmanGroupConstructor.h"
#include "DOMIsoSubspaces.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/ObjectPrototype.h>

namespace Bun {

const JSC::ClassInfo JSDiffieHellmanGroup::s_info = { "DiffieHellmanGroup"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDiffieHellmanGroup) };

void JSDiffieHellmanGroup::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);

    m_sizeForGC = this->m_dh.size();
    vm.heap.reportExtraMemoryAllocated(this, m_sizeForGC);
}

template<typename Visitor>
void JSDiffieHellmanGroup::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSDiffieHellmanGroup* thisObject = jsCast<JSDiffieHellmanGroup*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    visitor.reportExtraMemoryVisited(thisObject->m_sizeForGC);
}

DEFINE_VISIT_CHILDREN(JSDiffieHellmanGroup);

void setupDiffieHellmanGroupClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSDiffieHellmanGroupPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSDiffieHellmanGroupPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSDiffieHellmanGroupConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSDiffieHellmanGroupConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSDiffieHellmanGroup::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
