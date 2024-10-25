#include "napi_finalizer.h"

#include "napi.h"
#include "napi_macros.h"

namespace Bun {

void NapiFinalizer::call(JSC::JSGlobalObject* globalObject, void* data)
{
    if (m_callback) {
        NAPI_LOG_CURRENT_FUNCTION;
        m_callback(toNapi(globalObject), data, m_hint);
    }
}

} // namespace Bun
