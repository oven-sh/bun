#include "napi_finalizer.h"

#include "napi.h"
#include "napi_macros.h"

namespace Bun {

void NapiFinalizer::call(WTF::RefPtr<NapiEnv> env, void* data, bool immediate)
{
    if (m_callback) {
        NAPI_LOG_CURRENT_FUNCTION;
        if (immediate) {
            m_callback(env.get(), data, m_hint);
        } else {
            napi_internal_enqueue_finalizer(env.get(), m_callback, data, m_hint);
        }
    }
}

void NapiFinalizer::clear()
{
    m_callback = nullptr;
    m_hint = nullptr;
}

} // namespace Bun
