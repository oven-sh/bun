#include "root.h"
#include "napi.h"
#include <wtf/TZoneMallocInlines.h>

namespace Zig {

WTF_MAKE_TZONE_ALLOCATED_IMPL(NapiRef);

void NapiRef::ref()
{
    NAPI_LOG("ref %p %u -> %u", this, refCount, refCount + 1);
    ++refCount;
    if (refCount == 1 && !weakValueRef.isClear()) {
        auto& vm = globalObject.get()->vm();
        strongRef.set(vm, weakValueRef.get());

        // isSet() will return always true after being set once
        // We cannot rely on isSet() to check if the value is set we need to use isClear()
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
    finalizer.call(env, nativeObject);
    globalObject.clear();
    weakValueRef.clear();
    strongRef.clear();
    if (boundCleanup) {
        env->removeFinalizer(*boundCleanup);
    }
}

NapiRef::NapiRef(napi_env env, uint32_t count, Bun::NapiFinalizer finalizer, bool deleteSelf)
    : env(env)
    , globalObject(JSC::Weak<JSC::JSGlobalObject>(env->globalObject()))
    , finalizer(WTFMove(finalizer))
    , refCount(count)
    , m_deleteSelf(deleteSelf)
{
}

void NapiRef::setValueInitial(JSC::JSValue value, bool can_be_weak)
{
    if (refCount > 0) {
        strongRef.set(globalObject->vm(), value);
    }

    // In NAPI non-experimental, types other than object, function and symbol can't be used as values for references.
    // In NAPI experimental, they can be, but we must not store weak references to them.
    if (can_be_weak) {
        weakValueRef.set(value, Napi::NapiRefWeakHandleOwner::weakValueHandleOwner(), this);
    }

    if (value.isSymbol()) {
        auto* symbol = jsDynamicCast<JSC::Symbol*>(value);
        ASSERT(symbol != nullptr);
        if (symbol->uid().isRegistered()) {
            // Global symbols must always be retrievable,
            // even if garbage collection happens while the ref count is 0.
            m_isEternal = true;
            if (refCount == 0) {
                strongRef.set(globalObject->vm(), symbol);
            }
        }
    }
}

void NapiRef::callFinalizer()
{
    // Calling the finalizer may delete `this`, so we have to do state changes on `this` before
    // calling the finalizer
    Bun::NapiFinalizer saved_finalizer = this->finalizer;
    this->finalizer.clear();
    saved_finalizer.call(env, nativeObject, !env->mustDeferFinalizers() || !env->inGC());

    (void)m_deleteSelf;
}

NapiRef::~NapiRef()
{
    NAPI_LOG("destruct napi ref %p", this);
    if (boundCleanup) {
        boundCleanup->deactivate(env);
        boundCleanup = nullptr;
    }

    if (!m_isEternal) {
        strongRef.clear();
    }

    weakValueRef.clear();
}

}
