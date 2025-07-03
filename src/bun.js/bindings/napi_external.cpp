#include "napi_external.h"
#include "napi.h"

namespace Bun {

NapiExternal::~NapiExternal()
{
    ASSERT(m_env);
    m_finalizer.call(m_env, m_value, !m_env->mustDeferFinalizers());
}

void NapiExternal::destroy(JSC::JSCell* cell)
{
    static_cast<NapiExternal*>(cell)->~NapiExternal();
}

const ClassInfo NapiExternal::s_info = { "External"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NapiExternal) };

}
