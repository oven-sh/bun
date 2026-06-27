#include "napi_handle_scope.h"
#include "napi.h"

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
    NapiHandleScopeImpl* thisObject = uncheckedDowncast<NapiHandleScopeImpl>(cell);
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
    WTF::Locker locker { cellLock() };
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
    WTF::Locker locker { cellLock() };
    m_storage.append(Slot());
    return &m_storage.last();
}

void NapiHandleScopeImpl::releaseHandles()
{
    // Match V8: closing a scope releases its handles immediately. Otherwise a
    // closed scope cell that stays live for any reason (e.g. a conservative-scan
    // pin) keeps marking every value it ever held, plus its whole parent chain.
    WTF::Locker locker { cellLock() };
    m_storage.clear();
    m_escapeSlot = nullptr;
    m_parent = nullptr;
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

bool NapiHandleScope::closeIfOpen(Zig::GlobalObject* globalObject, NapiHandleScopeImpl* current)
{
    // `current` may already have been popped (and GC'd) by an earlier out-of-order close of one
    // of its ancestors. Only compare it against the scopes still on the chain -- which are all
    // kept alive through m_currentNapiHandleScopeImpl -- and dereference it only after a match.
    auto* top = globalObject->m_currentNapiHandleScopeImpl.get();
    bool onChain = false;
    for (auto* open = top; open; open = open->parent()) {
        if (open == current) {
            onChain = true;
            break;
        }
    }
    if (!onChain) {
        return false;
    }
    if (auto* parent = current->parent()) {
        globalObject->m_currentNapiHandleScopeImpl.set(globalObject->vm(), globalObject, parent);
    } else {
        globalObject->m_currentNapiHandleScopeImpl.clear();
    }
    // Release every scope that was just popped (from the old top down to and including `current`)
    // so a closed scope never keeps values alive. releaseHandles() nulls m_parent, so capture the
    // next pointer first.
    for (auto* popped = top; popped;) {
        auto* next = popped == current ? nullptr : popped->parent();
        popped->releaseHandles();
        popped = next;
    }
    return true;
}

void NapiHandleScope::close(Zig::GlobalObject* globalObject, NapiHandleScopeImpl* current)
{
    NAPI_LOG_CURRENT_FUNCTION;
    // napi handle scopes may be null pointers if created inside a finalizer
    if (!current) {
        return;
    }
    // Fires when an addon leaves a handle scope open across a callback return (Node aborts on
    // that too: the CHECK_EQ in napi_env__::CallIntoModule) or on a bug in Bun's own LIFO
    // scopes. Out-of-order addon closes go through the tolerant NapiHandleScope__closeAddonScope.
    RELEASE_ASSERT_WITH_MESSAGE(current == globalObject->m_currentNapiHandleScopeImpl.get(),
        "Unbalanced napi_handle_scope opens and closes");
    closeIfOpen(globalObject, current);
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

extern "C" NapiHandleScopeImpl* NapiHandleScope__open(napi_env env, bool escapable)
{
    return NapiHandleScope::open(env->globalObject(), escapable);
}

extern "C" void NapiHandleScope__close(napi_env env, NapiHandleScopeImpl* current)
{
    return NapiHandleScope::close(env->globalObject(), current);
}

extern "C" NapiHandleScopeImpl* NapiHandleScope__openAddonScope(napi_env env, bool escapable)
{
    auto* impl = NapiHandleScope::open(env->globalObject(), escapable);
    // A null scope (opened during a GC sweep) is closed as a no-op, so don't count it.
    if (impl) {
        env->didOpenAddonHandleScope();
    }
    return impl;
}

extern "C" bool NapiHandleScope__closeAddonScope(napi_env env, NapiHandleScopeImpl* current)
{
    if (!env->didCloseAddonHandleScope()) {
        return false;
    }
    // `current` may no longer be on the chain: closing one of its ancestors out of order already
    // popped it. Node treats that as success too, so there is nothing left to do.
    NapiHandleScope::closeIfOpen(env->globalObject(), current);
    return true;
}

extern "C" void NapiHandleScope__append(napi_env env, JSC::EncodedJSValue value)
{
    // Match toNapi() in napi.h: non-cell values need no rooting, and the
    // current handle scope is null when a finalizer runs immediately during
    // sweep (NapiHandleScope::open returns nullptr while the mutator is
    // sweeping).
    JSC::JSValue v = JSC::JSValue::decode(value);
    if (!v.isCell())
        return;
    if (auto* scope = env->globalObject()->m_currentNapiHandleScopeImpl.get())
        scope->append(v);
}

extern "C" bool NapiHandleScope__escape(NapiHandleScopeImpl* handleScope, JSC::EncodedJSValue value)
{
    return handleScope->escape(JSC::JSValue::decode(value));
}

} // namespace Bun
