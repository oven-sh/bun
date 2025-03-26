#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_read_start(uv_stream_t*,
                            uv_alloc_cb alloc_cb,
                            uv_read_cb read_cb) {
  __bun_throw_not_implemented("uv_read_start");
  __builtin_unreachable();
}

#endif