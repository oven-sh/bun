#include "JSDiffieHellmanGroup.h"
#include "../../webcore/DOMIsoSubspaces.h"
#include "../../ZigGlobalObject.h"
#include "ErrorCode.h"
#include <JavaScriptCore/JSCJSValueInlines.h>

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

} // namespace Bun
