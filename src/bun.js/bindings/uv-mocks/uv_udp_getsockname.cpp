#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_udp_getsockname(const uv_udp_t* handle,
                                 struct sockaddr* name,
                                 int* namelen) {
  __bun_throw_not_implemented("uv_udp_getsockname");
  __builtin_unreachable();
}

#endif