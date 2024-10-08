#include "napi_external.h"
#include "napi.h"

namespace Bun {

NapiExternal::~NapiExternal()
{
    // We cannot call globalObject() here because it is in a finalizer.
    // https://github.com/oven-sh/bun/issues/13001#issuecomment-2290022312
    m_finalizer.call(m_value);
}

void NapiExternal::destroy(JSC::JSCell* cell)
{
    static_cast<NapiExternal*>(cell)->~NapiExternal();
}

const ClassInfo NapiExternal::s_info = { "External"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NapiExternal) };

}
