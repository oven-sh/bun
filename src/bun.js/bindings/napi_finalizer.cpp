#include "napi_finalizer.h"

extern "C" void napi_enqueue_finalizer(napi_finalize finalize_cb, void* data, void* hint);

namespace Zig {

void NapiFinalizer::call(void* data)
{
    if (this->finalize_cb) {
        napi_enqueue_finalizer(this->finalize_cb, data, this->finalize_hint);
    }
}

} // namespace Zig
