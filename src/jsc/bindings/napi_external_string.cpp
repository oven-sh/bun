#include "root.h"
#include "napi_external_string.h"
#include "napi.h"
#include <wtf/HashSet.h>
#include <wtf/Lock.h>
#include <wtf/NeverDestroyed.h>

namespace Bun {

namespace {
// Storage identity is process-wide; the registry never owns an env or string reference.
struct NapiExternalStringRegistry {
    Lock lock;
    HashSet<const WTF::StringImpl*> strings;
};

NapiExternalStringRegistry& napiExternalStrings()
{
    static NeverDestroyed<NapiExternalStringRegistry> registry;
    return registry;
}

class NapiExternalStringFinalizer {
    WTF_MAKE_TZONE_ALLOCATED(NapiExternalStringFinalizer);

public:
    NapiExternalStringFinalizer(napi_env env, napi_finalize callback, void* hint)
        : m_env(env)
        , m_callback(callback)
        , m_hint(hint)
    {
    }

    void attach(WTF::StringImpl& impl)
    {
        m_impl = &impl;
        m_bound = &m_env->addFinalizer(resetEnv, nullptr, this);
        auto& registry = napiExternalStrings();
        Locker locker { registry.lock };
        registry.strings.add(&impl);
    }

    void finalize(void* data)
    {
        {
            auto& registry = napiExternalStrings();
            Locker locker { registry.lock };
            registry.strings.remove(m_impl);
        }
        if (m_env) {
            m_bound->deactivate(*m_env);
            m_bound = nullptr;
            m_env->doFinalizer(m_callback, data, m_hint);
        } else if (m_callback) {
            m_callback(nullptr, data, m_hint);
        }
    }

private:
    static void resetEnv(napi_env, void* data, void*)
    {
        auto* self = static_cast<NapiExternalStringFinalizer*>(data);
        // https://github.com/nodejs/node/blob/v26.10.0/src/js_native_api_v8.cc#L139-L168
        // TrackedStringResource::Finalize leaves storage alive and clears only its env.
        self->m_env = nullptr;
        self->m_bound = nullptr;
    }

    napi_env m_env;
    napi_finalize m_callback;
    void* m_hint;
    const WTF::StringImpl* m_impl { nullptr };
    const NapiEnv::BoundFinalizer* m_bound { nullptr };
};

WTF_MAKE_TZONE_ALLOCATED_IMPL(NapiExternalStringFinalizer);

template<typename Char>
Ref<WTF::ExternalStringImpl> createNapiExternalStringImpl(napi_env env, std::span<const Char> chars, napi_finalize callback, void* hint)
{
    auto finalizer = makeUnique<NapiExternalStringFinalizer>(env, callback, hint);
    auto* state = finalizer.get();
    auto impl = WTF::ExternalStringImpl::create(chars, nullptr, [finalizer = WTF::move(finalizer)](void*, void* data, unsigned) {
        finalizer->finalize(data);
    });
    state->attach(impl.get());
    return impl;
}
}

Ref<WTF::ExternalStringImpl> createNapiExternalString(napi_env env, std::span<const Latin1Character> chars, napi_finalize callback, void* hint)
{
    return createNapiExternalStringImpl(env, chars, callback, hint);
}

Ref<WTF::ExternalStringImpl> createNapiExternalString(napi_env env, std::span<const char16_t> chars, napi_finalize callback, void* hint)
{
    return createNapiExternalStringImpl(env, chars, callback, hint);
}

bool isNapiExternalString(const WTF::StringImpl& impl)
{
    if (!impl.isExternal())
        return false;
    auto& registry = napiExternalStrings();
    Locker locker { registry.lock };
    return registry.strings.contains(&impl);
}

}
