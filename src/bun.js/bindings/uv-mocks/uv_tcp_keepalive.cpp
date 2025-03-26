#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_tcp_keepalive(uv_tcp_t* handle,
                               int enable,
                               unsigned int delay) {
  __bun_throw_not_implemented("uv_tcp_keepalive");
  __builtin_unreachable();
}

#endif