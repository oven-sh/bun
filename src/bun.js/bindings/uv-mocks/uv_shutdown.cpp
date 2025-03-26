#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_shutdown(uv_shutdown_t* req,
                          uv_stream_t* handle,
                          uv_shutdown_cb cb) {
  __bun_throw_not_implemented("uv_shutdown");
  __builtin_unreachable();
}

#endif