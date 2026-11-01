#include "napi_external.h"
#include "napi.h"

namespace Bun {

NapiExternal::~NapiExternal()
{
    auto* env = m_env.get();
    if (m_boundCleanup)
        m_boundCleanup->deactivate(*env);
    m_finalizer.call(env, m_value, env && !env->mustDeferFinalizers());
}

void NapiExternal::finalizeAtEnvCleanup(napi_env env, void* data, void*)
{
    auto* external = static_cast<NapiExternal*>(data);
    external->m_boundCleanup = nullptr;
    auto finalizer = external->m_finalizer;
    external->m_finalizer.clear();
    finalizer.call(env, external->m_value, true);
}

void NapiExternal::destroy(JSC::JSCell* cell)
{
    static_cast<NapiExternal*>(cell)->~NapiExternal();
}

const ClassInfo NapiExternal::s_info = { "NapiExternal"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NapiExternal) };

}
