#include "napi_external.h"
#include "napi.h"

namespace Bun {

NapiExternal::~NapiExternal()
{
    if (finalizer) {
        reinterpret_cast<napi_finalize>(finalizer)(toNapi(globalObject()), m_value, m_finalizerHint);
    }
}

void NapiExternal::destroy(JSC::JSCell* cell)
{
    static_cast<NapiExternal*>(cell)->~NapiExternal();
}

const ClassInfo NapiExternal::s_info = { "External"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NapiExternal) };

}