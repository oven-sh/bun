#include "napi_finalizer.h"

#include "napi.h"
#include "napi_macros.h"

namespace Bun {

void NapiFinalizer::call(napi_env env, void* data)
{
    if (m_callback) {
        NAPI_LOG_CURRENT_FUNCTION;
        m_callback(env, data, m_hint);
    }
}

} // namespace Bun
