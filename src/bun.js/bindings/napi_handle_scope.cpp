#include "napi_handle_scope.h"

namespace Bun {

// for CREATE_METHOD_TABLE
namespace JSCastingHelpers = JSC::JSCastingHelpers;

const JSC::ClassInfo NapiHandleScope::s_info = {
    "NapiHandleScope"_s,
    nullptr,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(NapiHandleScope)
};

NapiHandleScope* NapiHandleScope::create(JSC::VM& vm, JSC::Structure* structure, NapiHandleScope* parent)
{
    NapiHandleScope* buffer = new (NotNull, JSC::allocateCell<NapiHandleScope>(vm)) NapiHandleScope(vm, structure, parent);
    buffer->finishCreation(vm);
    return buffer;
}

template<typename Visitor>
void NapiHandleScope::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    NapiHandleScope* thisObject = jsCast<NapiHandleScope*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    WTF::Locker locker { thisObject->cellLock() };

    for (auto& handle : thisObject->m_storage) {
        visitor.append(handle);
    }
}

DEFINE_VISIT_CHILDREN(NapiHandleScope);

void NapiHandleScope::append(JSC::JSValue val)
{
    m_storage.append(JSC::WriteBarrier<JSC::Unknown>(vm(), this, val));
}

} // namespace Bun
