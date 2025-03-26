#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_tcp_simultaneous_accepts(uv_tcp_t* handle, int enable) {
  __bun_throw_not_implemented("uv_tcp_simultaneous_accepts");
  __builtin_unreachable();
}

#endif