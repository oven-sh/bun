#include "napi_finalizer.h"

#include "napi.h"
#include "napi_macros.h"
#include <wtf/TZoneMallocInlines.h>

namespace Bun {

WTF_MAKE_TZONE_ALLOCATED_IMPL(NapiTrackedFinalizer);

void NapiFinalizer::call(napi_env env, void* data)
{
    if (m_callback) {
        NAPI_LOG_CURRENT_FUNCTION;
        m_callback(env, data, m_hint);
    }
}

void NapiFinalizer::clear()
{
    m_callback = nullptr;
    m_hint = nullptr;
}

} // namespace Bun
