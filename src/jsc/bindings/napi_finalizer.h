#pragma once

#include "root.h"
#include "js_native_api.h"

extern "C" void napi_internal_enqueue_finalizer(napi_env env, napi_finalize finalize_cb, void* data, void* hint);

namespace Bun {

class NapiFinalizer {
public:
    NapiFinalizer(napi_finalize callback, void* hint)
        : m_callback(callback)
        , m_hint(hint)
    {
    }

    NapiFinalizer() = default;

    void call(WTF::RefPtr<NapiEnv> env, void* data, bool immediate = false);
    void clear();

    inline napi_finalize callback() const { return m_callback; }
    inline void* hint() const { return m_hint; }

private:
    napi_finalize m_callback = nullptr;
    void* m_hint = nullptr;
};

} // namespace Bun
