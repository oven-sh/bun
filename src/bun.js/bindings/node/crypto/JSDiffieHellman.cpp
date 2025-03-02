#include "JSDiffieHellman.h"
#include "../../webcore/DOMIsoSubspaces.h"
#include "../../ZigGlobalObject.h"
#include "ErrorCode.h"
#include <JavaScriptCore/JSCJSValueInlines.h>

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

} // namespace Bun
