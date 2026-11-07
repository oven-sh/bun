#pragma once

#include "js_native_api.h"
#include <wtf/text/ExternalStringImpl.h>

namespace Bun {

Ref<WTF::ExternalStringImpl> createNapiExternalString(napi_env, std::span<const Latin1Character>, napi_finalize, void*);
Ref<WTF::ExternalStringImpl> createNapiExternalString(napi_env, std::span<const char16_t>, napi_finalize, void*);
bool isNapiExternalString(const WTF::StringImpl&);

}
