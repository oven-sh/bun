#pragma once

#include "root.h"
#include "js_native_api.h"

namespace Bun {

class NapiFinalizer {
public:
    NapiFinalizer(napi_finalize callback, void* hint)
        : m_callback(callback)
        , m_hint(hint)
    {
    }

    NapiFinalizer()
        : m_callback(nullptr)
        , m_hint(nullptr)
    {
    }

    void call(JSC::JSGlobalObject* globalObject, void* data);

private:
    napi_finalize m_callback;
    void* m_hint;
};

} // namespace Bun
