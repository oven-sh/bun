#include "napi_finalizer.h"

#include "napi.h"
#include "napi_macros.h"

extern "C" void napi_enqueue_finalizer(napi_env env, napi_finalize finalize_cb, void* data, void* hint);

namespace Bun {

void NapiFinalizer::call(napi_env env, void* data)
{
    if (m_callback) {
        NAPI_LOG_CURRENT_FUNCTION;
        napi_enqueue_finalizer(env, m_callback, data, m_hint);
    }
}

void NapiFinalizer::clear()
{
    m_callback = nullptr;
    m_hint = nullptr;
}

} // namespace Bun
