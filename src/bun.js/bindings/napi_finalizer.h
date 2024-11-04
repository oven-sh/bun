#pragma once

#include "root.h"
#include "js_native_api.h"

extern "C" void napi_internal_enqueue_finalizer(napi_env env, napi_finalize finalize_cb, void* data, void* hint);

namespace Bun {

class NapiFinalizer : public WTF::RefCounted<NapiFinalizer> {
public:
    static WTF::Ref<NapiFinalizer> create(napi_finalize callback, void* hint)
    {
        return adoptRef(*new NapiFinalizer(callback, hint));
    }

    void call(napi_env env, void* data, bool immediate = false);
    void clear();

    inline napi_finalize callback() const { return m_callback; }
    inline void* hint() const { return m_hint; }

private:
    NapiFinalizer(napi_finalize callback, void* hint)
        : m_callback(callback)
        , m_hint(hint)
    {
    }

    NapiFinalizer()
        : m_callback(nullptr)
        , m_hint(nullptr)
    {
    }

    napi_finalize m_callback;
    void* m_hint;
};

} // namespace Bun
