#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_read_stop(uv_stream_t*) {
  __bun_throw_not_implemented("uv_read_stop");
  __builtin_unreachable();
}

#endif