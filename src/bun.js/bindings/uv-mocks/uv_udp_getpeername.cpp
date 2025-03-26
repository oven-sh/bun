#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_udp_getpeername(const uv_udp_t* handle,
                                 struct sockaddr* name,
                                 int* namelen) {
  __bun_throw_not_implemented("uv_udp_getpeername");
  __builtin_unreachable();
}

#endif