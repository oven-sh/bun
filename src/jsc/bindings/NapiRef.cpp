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

// One task runs the finalizer of every ref that was pending when it began: a task per ref is a chain, and a drain of
// the task queue runs 9 links of a chain (`EventLoop::next_task_within`). Refs that arrive meanwhile get a new task.
// Each finalizer is a JS entry of its own: a handle scope, what it left pending reported, then a checkpoint.
void NapiEnv::drainRefFinalizers(napi_env env, void*, void*)
{
    env->m_isRefFinalizerDrainQueued = false;
    auto* globalObject = env->globalObject();
    auto& vm = env->vm();
    size_t left = env->m_pendingRefFinalizers.size();
    while (left-- && !env->m_pendingRefFinalizers.isEmpty()) {
        Zig::NapiRef* ref = env->m_pendingRefFinalizers.takeFirst();
        // The last one's exception and checkpoint are the task's own (Finalizer::run, the drain of the task queue).
        if (!left || env->m_pendingRefFinalizers.isEmpty()) {
            // May delete `ref` and enqueue or delete other refs.
            ref->callFinalizer();
            return;
        }
        {
            Bun::NapiHandleScope handleScope(globalObject);
            ref->callFinalizer();
        }
        // Released at teardown: no script runs, so nothing is reported and there is no checkpoint (runFinalizers).
        if (!env->canCallIntoJS()) {
            env->clearExceptionsBetweenFinalizers();
            continue;
        }
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        // NapiEnv::surface_exception: the VM's own exception wins over the one latched on the env.
        if (!scope.exception())
            env->throwPendingException();
        env->clearPendingException();
        if (auto* exception = scope.exception()) {
            // The termination ends the drain. The task queued here is released at teardown, which runs the rest.
            if (vm.isTerminationException(exception)) {
                env->queueRefFinalizerDrain();
                return;
            }
            (void)scope.tryClearException();
            Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, exception);
        }
        if (globalObject->drainMicrotasks()) {
            env->queueRefFinalizerDrain();
            return;
        }
    }
}
