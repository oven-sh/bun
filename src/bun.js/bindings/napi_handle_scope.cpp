#include "napi_handle_scope.h"

#include "ZigGlobalObject.h"

namespace Bun {

// for CREATE_METHOD_TABLE
namespace JSCastingHelpers = JSC::JSCastingHelpers;

const JSC::ClassInfo NapiHandleScopeImpl::s_info = {
    "NapiHandleScopeImpl"_s,
    nullptr,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(NapiHandleScopeImpl)
};

NapiHandleScopeImpl* NapiHandleScopeImpl::create(JSC::VM& vm, JSC::Structure* structure, NapiHandleScopeImpl* parent)
{
    NapiHandleScopeImpl* buffer = new (NotNull, JSC::allocateCell<NapiHandleScopeImpl>(vm)) NapiHandleScopeImpl(vm, structure, parent);
    buffer->finishCreation(vm);
    return buffer;
}

template<typename Visitor>
void NapiHandleScopeImpl::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    NapiHandleScopeImpl* thisObject = jsCast<NapiHandleScopeImpl*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    WTF::Locker locker { thisObject->cellLock() };

    for (auto& handle : thisObject->m_storage) {
        visitor.append(handle);
    }
}

DEFINE_VISIT_CHILDREN(NapiHandleScopeImpl);

void NapiHandleScopeImpl::append(JSC::JSValue val)
{
    m_storage.append(JSC::WriteBarrier<JSC::Unknown>(vm(), this, val));
}

NapiHandleScope::NapiHandleScope(Zig::GlobalObject* globalObject)
    : m_globalObject(globalObject)
    , m_impl(NapiHandleScopeImpl::create(globalObject->vm(),
          globalObject->NapiHandleScopeImplStructure(),
          globalObject->m_currentNapiHandleScopeImpl.get()))
{
    globalObject->m_currentNapiHandleScopeImpl.set(globalObject->vm(), globalObject, m_impl);
}

NapiHandleScope::~NapiHandleScope()
{
    auto* current = m_globalObject->m_currentNapiHandleScopeImpl.get();
    RELEASE_ASSERT_WITH_MESSAGE(current == m_impl, "Unbalanced napi_handle_scope opens and closes");
    if (auto* parent = m_impl->parent()) {
        m_globalObject->m_currentNapiHandleScopeImpl.set(m_globalObject->vm(), m_globalObject, m_impl->parent());
    } else {
        m_globalObject->m_currentNapiHandleScopeImpl.clear();
    }
    m_impl = nullptr;
}

} // namespace Bun
