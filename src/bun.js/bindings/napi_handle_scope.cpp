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

NapiHandleScopeImpl* NapiHandleScope::push(Zig::GlobalObject* globalObject)
{
    auto* impl = NapiHandleScopeImpl::create(globalObject->vm(),
        globalObject->NapiHandleScopeImplStructure(),
        globalObject->m_currentNapiHandleScopeImpl.get());
    globalObject->m_currentNapiHandleScopeImpl.set(globalObject->vm(), globalObject, impl);
    return impl;
}

void NapiHandleScope::pop(Zig::GlobalObject* globalObject, NapiHandleScopeImpl* current)
{
    RELEASE_ASSERT_WITH_MESSAGE(current == globalObject->m_currentNapiHandleScopeImpl.get(),
        "Unbalanced napi_handle_scope opens and closes");
    if (auto* parent = current->parent()) {
        globalObject->m_currentNapiHandleScopeImpl.set(globalObject->vm(), globalObject, parent);
    } else {
        globalObject->m_currentNapiHandleScopeImpl.clear();
    }
}

NapiHandleScope::NapiHandleScope(Zig::GlobalObject* globalObject)
    : m_globalObject(globalObject)
    , m_impl(NapiHandleScope::push(globalObject))
{
}

NapiHandleScope::~NapiHandleScope()
{
    NapiHandleScope::pop(m_globalObject, m_impl);
}

extern "C" NapiHandleScopeImpl* NapiHandleScope__push(Zig::GlobalObject* globalObject)
{
    return NapiHandleScope::push(globalObject);
}

extern "C" void NapiHandleScope__pop(Zig::GlobalObject* globalObject, NapiHandleScopeImpl* current)
{
    return NapiHandleScope::pop(globalObject, current);
}

extern "C" void NapiHandleScope__append(Zig::GlobalObject* globalObject, JSC::EncodedJSValue value)
{
    globalObject->m_currentNapiHandleScopeImpl.get()->append(JSC::JSValue::decode(value));
}

} // namespace Bun
