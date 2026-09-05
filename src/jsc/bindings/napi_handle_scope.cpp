#include "napi_handle_scope.h"
#include "napi.h"

#include "ZigGlobalObject.h"
#include "v8/shim/HandleScopeBuffer.h"

namespace Bun {

// for CREATE_METHOD_TABLE
namespace JSCastingHelpers = JSC::JSCastingHelpers;

const JSC::ClassInfo HandleScopeImpl::s_info = {
    "HandleScopeImpl"_s,
    nullptr,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(HandleScopeImpl)
};

HandleScopeImpl::HandleScopeImpl(JSC::VM& vm, JSC::Structure* structure, HandleScopeImpl* parent, bool escapable)
    : Base(vm, structure)
    , m_parent(parent)
    , m_escapeSlot(nullptr)
{
    if (escapable) {
        m_escapeSlot = parent->reserveSlot();
    }
}

HandleScopeImpl::~HandleScopeImpl() = default;

HandleScopeImpl* HandleScopeImpl::create(JSC::VM& vm,
    JSC::Structure* structure,
    HandleScopeImpl* parent,
    bool escapable)
{
    HandleScopeImpl* buffer = new (NotNull, JSC::allocateCell<HandleScopeImpl>(vm))
        HandleScopeImpl(vm, structure, parent, escapable);
    buffer->finishCreation(vm);
    return buffer;
}

template<typename Visitor>
void HandleScopeImpl::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    HandleScopeImpl* thisObject = uncheckedDowncast<HandleScopeImpl>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    WTF::Locker locker { thisObject->cellLock() };

    for (auto& handle : thisObject->m_storage) {
        visitor.append(handle);
    }

    if (auto* v8Handles = thisObject->m_v8Handles.get()) {
        v8Handles->visitHandles(visitor);
    }

    if (thisObject->m_parent) {
        visitor.appendUnbarriered(thisObject->m_parent);
    }
}

DEFINE_VISIT_CHILDREN(HandleScopeImpl);

void HandleScopeImpl::append(JSC::JSValue val)
{
    WTF::Locker locker { cellLock() };
    m_storage.append(Slot(vm(), this, val));
}

bool HandleScopeImpl::escape(JSC::JSValue val)
{
    if (!m_escapeSlot) {
        return false;
    }

    m_escapeSlot->set(vm(), m_parent, val);
    m_escapeSlot = nullptr;
    return true;
}

HandleScopeImpl::Slot* HandleScopeImpl::reserveSlot()
{
    WTF::Locker locker { cellLock() };
    m_storage.append(Slot());
    return &m_storage.last();
}

v8::shim::HandleScopeBuffer& HandleScopeImpl::ensureV8Handles(v8::Isolate* isolate)
{
    if (m_v8Handles) {
        return *m_v8Handles;
    }
    auto v8Handles = makeUnique<v8::shim::HandleScopeBuffer>(this, isolate);
    WTF::Locker locker { cellLock() };
    m_v8Handles = WTF::move(v8Handles);
    return *m_v8Handles;
}

void HandleScopeImpl::releaseHandles()
{
    // Match V8: closing a scope releases its handles immediately. Otherwise a
    // closed scope cell that stays live for any reason (e.g. a conservative-scan
    // pin) keeps marking every value it ever held, plus its whole parent chain.
    if (m_v8Handles) {
        // May move handles into m_parent, so it runs before the parent edge is dropped.
        m_v8Handles->close(m_parent);
    }
    std::unique_ptr<v8::shim::HandleScopeBuffer> v8Handles;
    {
        WTF::Locker locker { cellLock() };
        v8Handles = WTF::move(m_v8Handles);
        m_storage.clear();
        m_escapeSlot = nullptr;
        m_parent = nullptr;
    }
}

HandleScopeImpl* HandleScopeImpl::open(Zig::GlobalObject* globalObject, bool escapable)
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

    auto* impl = HandleScopeImpl::create(vm,
        globalObject->HandleScopeImplStructure(),
        globalObject->m_currentHandleScopeImpl.get(),
        escapable);
    globalObject->m_currentHandleScopeImpl.set(vm, globalObject, impl);
    return impl;
}

void HandleScopeImpl::close(Zig::GlobalObject* globalObject, HandleScopeImpl* current)
{
    NAPI_LOG_CURRENT_FUNCTION;
    // napi handle scopes may be null pointers if created inside a finalizer
    if (!current) {
        return;
    }
    RELEASE_ASSERT_WITH_MESSAGE(current == globalObject->m_currentHandleScopeImpl.get(),
        "Unbalanced handle scope opens and closes");
    if (auto* parent = current->parent()) {
        globalObject->m_currentHandleScopeImpl.set(globalObject->vm(), globalObject, parent);
    } else {
        globalObject->m_currentHandleScopeImpl.clear();
    }
    current->releaseHandles();
}

NapiHandleScope::NapiHandleScope(Zig::GlobalObject* globalObject)
    : m_impl(HandleScopeImpl::open(globalObject, false))
    , m_globalObject(globalObject)
{
}

NapiHandleScope::~NapiHandleScope()
{
    HandleScopeImpl::close(m_globalObject, m_impl);
}

extern "C" HandleScopeImpl* NapiHandleScope__open(napi_env env, bool escapable)
{
    return HandleScopeImpl::open(env->globalObject(), escapable);
}

extern "C" void NapiHandleScope__close(napi_env env, HandleScopeImpl* current)
{
    return HandleScopeImpl::close(env->globalObject(), current);
}

extern "C" void NapiHandleScope__append(napi_env env, JSC::EncodedJSValue value)
{
    // Match toNapi() in napi.h: non-cell values need no rooting, and the
    // current handle scope is null when a finalizer runs immediately during
    // sweep (HandleScopeImpl::open returns nullptr while the mutator is
    // sweeping).
    JSC::JSValue v = JSC::JSValue::decode(value);
    if (!v.isCell())
        return;
    if (auto* scope = env->globalObject()->m_currentHandleScopeImpl.get())
        scope->append(v);
}

extern "C" bool NapiHandleScope__escape(HandleScopeImpl* handleScope, JSC::EncodedJSValue value)
{
    return handleScope->escape(JSC::JSValue::decode(value));
}

} // namespace Bun
