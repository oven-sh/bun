#include "root.h"
#include "napi.h"
#include <wtf/TZoneMallocInlines.h>

namespace Zig {

WTF_MAKE_TZONE_ALLOCATED_IMPL(NapiRef);

void NapiRef::ref()
{
    // Node's Reference::Ref(): once the value is gone, the count stays at 0.
    if (refCount == 0 && !weakValueRef.get()) {
        NAPI_LOG("ref %p (value released)", this);
        return;
    }
    NAPI_LOG("ref %p %u -> %u", this, refCount, refCount + 1);
    ++refCount;
    if (refCount == 1 && !weakValueRef.isClear()) {
        auto& vm = globalObject.get()->vm();
        strongRef.set(vm, weakValueRef.get());

        // .setString/.setObject/.setPrimitive will assert fail if called more than once (even after clear())
        // We should not clear the weakValueRef here because we need to keep it if we call NapiRef::unref()
        // so we can call the finalizer
    }
}

void NapiRef::unref()
{
    NAPI_LOG("unref %p %u -> %u", this, refCount, refCount - 1);
    bool clear = refCount == 1;
    refCount = refCount > 0 ? refCount - 1 : 0;
    if (clear && !m_isEternal) {
        // we still dont clean weakValueRef so we can ref it again using NapiRef::ref() if the GC didn't collect it
        // and use it to call the finalizer when GC'd
        strongRef.clear();
    }
}

void NapiRef::clear()
{
    NAPI_LOG("ref clear %p", this);
    finalizer.call(env.ptr(), nativeObject);
    globalObject.clear();
    weakValueRef.clear();
    strongRef.clear();
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
