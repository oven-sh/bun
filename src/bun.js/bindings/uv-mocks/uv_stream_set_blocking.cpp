#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_stream_set_blocking(uv_stream_t* handle, int blocking) {
  __bun_throw_not_implemented("uv_stream_set_blocking");
  __builtin_unreachable();
}

#endif