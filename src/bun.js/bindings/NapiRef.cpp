#include "root.h"
#include "napi.h"
#include <wtf/TZoneMallocInlines.h>
#include <JavaScriptCore/WeakInlines.h>
#include <JavaScriptCore/StrongInlines.h>

namespace Zig {

WTF_MAKE_TZONE_ALLOCATED_IMPL(NapiRef);

// Constructor
NapiRef::NapiRef(napi_env env, JSC::JSValue value, uint32_t initial_refcount, NapiRefOwnership ownership, Bun::NapiFinalizer finalizer, void* native_object)
    : ownership(ownership),
      m_env(env),
      m_vm(env->vm()),
      m_finalizer(WTFMove(finalizer)),
      m_refCount(initial_refcount),
      m_handleType(HandleType::Empty),
      m_canBeWeak(value.isCell()) // Primitives cannot be held weakly by JSC's GC.
{
    this->nativeObject = native_object;

    if (m_refCount > 0) {
        m_strongHandle = JSC::Strong<JSC::JSCell>(m_vm, value.asCell());
        m_handleType = HandleType::Strong;
    } else {
        if (m_canBeWeak) {
            m_weakHandle = JSC::Weak<JSC::JSCell>(value.asCell(), &Napi::NapiRefWeakHandleOwner::get(), this);
            m_handleType = HandleType::Weak;
        }
        // If it can't be weak, it remains empty and invalid.
    }
}

// Destructor
NapiRef::~NapiRef() {
    clearHandle();
}

void NapiRef::clearHandle() {
    switch (m_handleType) {
        case HandleType::Strong:
            m_strongHandle.clear();
            break;
        case HandleType::Weak:
            m_weakHandle.clear();
            break;
        case HandleType::Empty:
            break;
    }
    m_handleType = HandleType::Empty;
}

void NapiRef::transitionToStrong() {
    ASSERT(m_handleType == HandleType::Weak);

    // Use JSC::Weak's proper get() method which handles state checking
    JSC::JSCell* cell = m_weakHandle.get();
    
    // If the weak reference died, we can't make it strong.
    if (!cell) {
        m_weakHandle.clear();
        m_handleType = HandleType::Empty;
        return;
    }

    // Convert cell back to JSValue
    JSC::JSValue value(cell);

    // Now clear the weak handle
    m_weakHandle.clear();

    m_strongHandle = JSC::Strong<JSC::JSCell>(m_vm, cell);
    m_handleType = HandleType::Strong;
}

void NapiRef::transitionToWeak() {
    ASSERT(m_handleType == HandleType::Strong);

    if (!m_canBeWeak) {
        clearHandle();
        return;
    }

    JSC::JSCell* cell = m_strongHandle.get();
    m_strongHandle.clear();

    m_weakHandle = JSC::Weak<JSC::JSCell>(cell, &Napi::NapiRefWeakHandleOwner::get(), this);
    m_handleType = HandleType::Weak;
}

uint32_t NapiRef::ref() {
    if (m_handleType == HandleType::Empty) {
        return 0; // The object was GC'd, cannot be reffed.
    }
    
    uint32_t new_refcount = ++m_refCount;
    if (new_refcount == 1) {
        transitionToStrong();
        // If the transition failed (object was GC'd), revert ref count and return 0.
        if (m_handleType == HandleType::Empty) {
            m_refCount = 0;
            return 0;
        }
    }
    return m_refCount;
}

uint32_t NapiRef::unref() {
    if (m_refCount == 0) {
        return 0;
    }
    
    uint32_t new_refcount = --m_refCount;
    if (new_refcount == 0) {
        transitionToWeak();
    }
    return m_refCount;
}

JSC::JSValue NapiRef::value() const {
    switch (m_handleType) {
        case HandleType::Strong: {
            JSC::JSCell* cell = m_strongHandle.get();
            return cell ? JSC::JSValue(cell) : JSC::JSValue();
        }
        case HandleType::Weak: {
            JSC::JSCell* cell = m_weakHandle.get();
            return cell ? JSC::JSValue(cell) : JSC::JSValue();
        }
        case HandleType::Empty:
            return JSC::JSValue(); // Empty JSValue (evaluates to JS undefined)
    }
    RELEASE_ASSERT_NOT_REACHED();
}

void NapiRef::callFinalizer() {
    if (m_finalizer.callback()) {
        // Copy finalizer data and then clear it on the object to prevent re-entrancy.
        Bun::NapiFinalizer saved_finalizer = m_finalizer;
        m_finalizer.clear();
        // Use doFinalizer to handle experimental vs. non-experimental finalizer queueing.
        m_env->doFinalizer(saved_finalizer.callback(), nativeObject, saved_finalizer.hint());
    }
}

void NapiRef::finalizeFromGC() {
    // The WeakImpl handle is now dead. We just need to update our state.
    // The WeakSet manages the WeakImpl's memory.
    m_handleType = HandleType::Empty;

    // The user's finalizer may try to use the napi_env.
    callFinalizer();

    // If this NapiRef is owned by the runtime, it's time to delete it.
    if (ownership == NapiRefOwnership::kRuntime) {
        delete this;
    }
}

}
