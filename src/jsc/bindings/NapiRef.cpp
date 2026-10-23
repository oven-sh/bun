#include "root.h"
#include "napi.h"
#include <wtf/TZoneMallocInlines.h>

namespace Zig {

WTF_MAKE_TZONE_ALLOCATED_IMPL(NapiRef);

uint32_t NapiRef::ref()
{
    // Node's Reference::Ref(): once the value is gone, the count stays where it is and 0 is reported.
    if (m_released || (refCount == 0 && !weakValueRef.get())) {
        NAPI_LOG("ref %p (value released)", this);
        return 0;
    }
    NAPI_LOG("ref %p %u -> %u", this, refCount, refCount + 1);
    ++refCount;
    if (refCount == 1 && !weakValueRef.isClear()) {
        strongRef.set(env->vm(), weakValueRef.get());

        // .setString/.setObject/.setPrimitive will assert fail if called more than once (even after clear())
        // We should not clear the weakValueRef here because we need to keep it if we call NapiRef::unref()
        // so we can call the finalizer
    }
    return refCount;
}

uint32_t NapiRef::unref()
{
    // Node's Reference::Unref(): an empty persistent handle reports 0 and keeps its count.
    if (m_released) {
        NAPI_LOG("unref %p (value released)", this);
        return 0;
    }
    NAPI_LOG("unref %p %u -> %u", this, refCount, refCount - 1);
    bool clear = refCount == 1;
    refCount = refCount > 0 ? refCount - 1 : 0;
    if (clear && !m_isEternal) {
        // we still dont clean weakValueRef so we can ref it again using NapiRef::ref() if the GC didn't collect it
        // and use it to call the finalizer when GC'd
        strongRef.clear();
    }
    return refCount;
}

void NapiRef::callFinalizerFromGC()
{
    if (!finalizer.callback()) {
        return;
    }
    if (!env->mustDeferFinalizers() || !env->inGC()) {
        callFinalizer();
        return;
    }
    NAPI_LOG("queue finalizer of ref %p", this);
    env->enqueueRefFinalizer(this);
}

}

void NapiEnv::unlinkRef(uint32_t slot)
{
    ASSERT(slot < m_refs.size());
    Zig::NapiRef* last = m_refs.takeLast();
    if (slot < m_refs.size()) {
        m_refs[slot] = last;
        last->m_envSlot = slot;
    }
}

void NapiEnv::releaseRealmRoots()
{
    m_pendingException.clear();
    if (m_asyncWorkOnThreadPool.load()) {
        return;
    }
    for (Zig::NapiRef* ref : m_refs) {
        ref->releaseRealm();
    }
}

void NapiEnv::drainOneRefFinalizer(napi_env env, void*, void*)
{
    if (env->m_pendingRefFinalizers.isEmpty()) {
        return;
    }
    Zig::NapiRef* ref = env->m_pendingRefFinalizers.takeFirst();
    if (!env->m_pendingRefFinalizers.isEmpty()) {
        Bun__napi_enqueue_finalizer(env, drainOneRefFinalizer, env, nullptr);
    }
    // May delete `ref` and enqueue or delete other refs.
    ref->callFinalizer();
}
