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

NapiHandleScopeImpl::NapiHandleScopeImpl(JSC::VM& vm, JSC::Structure* structure, NapiHandleScopeImpl* parent, bool escapable)
    : Base(vm, structure)
    , m_parent(parent)
    , m_escapeSlot(nullptr)
{
    if (escapable) {
        m_escapeSlot = parent->reserveSlot();
    }
}

NapiHandleScopeImpl* NapiHandleScopeImpl::create(JSC::VM& vm,
    JSC::Structure* structure,
    NapiHandleScopeImpl* parent,
    bool escapable)
{
    NapiHandleScopeImpl* buffer = new (NotNull, JSC::allocateCell<NapiHandleScopeImpl>(vm))
        NapiHandleScopeImpl(vm, structure, parent, escapable);
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

    if (thisObject->m_parent) {
        visitor.appendUnbarriered(thisObject->m_parent);
    }
}

DEFINE_VISIT_CHILDREN(NapiHandleScopeImpl);

void NapiHandleScopeImpl::append(JSC::JSValue val)
{
    m_storage.append(Slot(vm(), this, val));
}

bool NapiHandleScopeImpl::escape(JSC::JSValue val)
{
    if (!m_escapeSlot) {
        return false;
    }

    m_escapeSlot->set(vm(), m_parent, val);
    m_escapeSlot = nullptr;
    return true;
}

NapiHandleScopeImpl::Slot* NapiHandleScopeImpl::reserveSlot()
{
    m_storage.append(Slot());
    return &m_storage.last();
}

NapiHandleScopeImpl* NapiHandleScope::open(Zig::GlobalObject* globalObject, bool escapable)
{
    auto& vm = JSC::getVM(globalObject);
    // Do not create a new handle scope while a finalizer is in progress
    // This state is possible because we call napi finalizers immediately
    // so a finalizer can be called while an allocation is in progress.
    // An example where this happens:
    // 1. Use the `sqlite3` package
    // 2. Do an allocation in a hot code path
    // 3. the napi_ref finalizer is called while the constructor is running
    // 4. The finalizer creates a new handle scope (yes, it should not do that. No, we can't change that.)
    if (vm.heap.mutatorState() == JSC::MutatorState::Sweeping) {
        return nullptr;
    }

    auto* impl = NapiHandleScopeImpl::create(vm,
        globalObject->NapiHandleScopeImplStructure(),
        globalObject->m_currentNapiHandleScopeImpl.get(),
        escapable);
    globalObject->m_currentNapiHandleScopeImpl.set(vm, globalObject, impl);
    return impl;
}

void NapiHandleScope::close(Zig::GlobalObject* globalObject, NapiHandleScopeImpl* current)
{
    // napi handle scopes may be null pointers if created inside a finalizer
    if (!current) {
        return;
    }
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
    , m_impl(NapiHandleScope::open(globalObject, false))
{
}

NapiHandleScope::~NapiHandleScope()
{
    NapiHandleScope::close(m_globalObject, m_impl);
}

extern "C" NapiHandleScopeImpl* NapiHandleScope__open(Zig::GlobalObject* globalObject, bool escapable)
{
    return NapiHandleScope::open(globalObject, escapable);
}

extern "C" void NapiHandleScope__close(Zig::GlobalObject* globalObject, NapiHandleScopeImpl* current)
{
    return NapiHandleScope::close(globalObject, current);
}

extern "C" void NapiHandleScope__append(Zig::GlobalObject* globalObject, JSC::EncodedJSValue value)
{
    globalObject->m_currentNapiHandleScopeImpl.get()->append(JSC::JSValue::decode(value));
}

extern "C" bool NapiHandleScope__escape(NapiHandleScopeImpl* handleScope, JSC::EncodedJSValue value)
{
    return handleScope->escape(JSC::JSValue::decode(value));
}

} // namespace Bun
