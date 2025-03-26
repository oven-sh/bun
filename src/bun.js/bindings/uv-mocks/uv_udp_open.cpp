#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_udp_open(uv_udp_t* handle, uv_os_sock_t sock) {
  __bun_throw_not_implemented("uv_udp_open");
  __builtin_unreachable();
}

#endif