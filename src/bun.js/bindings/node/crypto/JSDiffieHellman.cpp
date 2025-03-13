#include "JSDiffieHellman.h"
#include "JSDiffieHellmanPrototype.h"
#include "JSDiffieHellmanConstructor.h"
#include "DOMIsoSubspaces.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/ObjectPrototype.h>

namespace Bun {

const JSC::ClassInfo JSDiffieHellman::s_info = { "DiffieHellman"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSDiffieHellman) };

void JSDiffieHellman::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    m_sizeForGC = this->m_dh.size();
    vm.heap.reportExtraMemoryAllocated(this, m_sizeForGC);
}

template<typename Visitor>
void JSDiffieHellman::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSDiffieHellman* thisObject = jsCast<JSDiffieHellman*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    visitor.reportExtraMemoryVisited(thisObject->m_sizeForGC);
}

DEFINE_VISIT_CHILDREN(JSDiffieHellman);

void setupDiffieHellmanClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSDiffieHellmanPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSDiffieHellmanPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSDiffieHellmanConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSDiffieHellmanConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSDiffieHellman::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
