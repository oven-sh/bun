#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_udp_connect(uv_udp_t* handle, const struct sockaddr* addr) {
  __bun_throw_not_implemented("uv_udp_connect");
  __builtin_unreachable();
}

#endif