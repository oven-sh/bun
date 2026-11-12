#include "napi_external.h"
#include "napi.h"

namespace Bun {

NapiExternal::~NapiExternal()
{
    if (m_finalizer) {
        m_env->finalizerValueCollected(m_finalizer, NapiEnv::FinalizerHolder::Released);
    }
}

void NapiExternal::destroy(JSC::JSCell* cell)
{
    static_cast<NapiExternal*>(cell)->~NapiExternal();
}

const ClassInfo NapiExternal::s_info = { "NapiExternal"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NapiExternal) };

}
