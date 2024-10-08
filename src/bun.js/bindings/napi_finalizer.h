#pragma once

#include "js_native_api_types.h"

namespace Zig {

class NapiFinalizer {
public:
    void* finalize_hint = nullptr;
    napi_finalize finalize_cb = nullptr;

    void call(void* data);
};

} // namespace Zig
