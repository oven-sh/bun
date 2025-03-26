#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_is_writable(const uv_stream_t* handle) {
  __bun_throw_not_implemented("uv_is_writable");
  __builtin_unreachable();
}

#endif