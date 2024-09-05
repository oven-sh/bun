#include "napi_external.h"
#include "napi.h"

namespace Bun {

NapiExternal::~NapiExternal()
{
    if (finalizer) {
        // We cannot call globalObject() here because it is in a finalizer.
        // https://github.com/oven-sh/bun/issues/13001#issuecomment-2290022312
        reinterpret_cast<napi_finalize>(finalizer)(toNapi(this->napi_env), m_value, m_finalizerHint);
    }
}

void NapiExternal::destroy(JSC::JSCell* cell)
{
    static_cast<NapiExternal*>(cell)->~NapiExternal();
}

const ClassInfo NapiExternal::s_info = { "External"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NapiExternal) };

}