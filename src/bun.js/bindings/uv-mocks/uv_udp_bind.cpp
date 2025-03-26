#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_udp_bind(uv_udp_t* handle,
                          const struct sockaddr* addr,
                          unsigned int flags) {
  __bun_throw_not_implemented("uv_udp_bind");
  __builtin_unreachable();
}

#endif