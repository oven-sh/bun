#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_is_readable(const uv_stream_t* handle) {
  __bun_throw_not_implemented("uv_is_readable");
  __builtin_unreachable();
}

#endif