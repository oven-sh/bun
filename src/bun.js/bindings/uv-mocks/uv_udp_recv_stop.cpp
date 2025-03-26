#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_udp_recv_stop(uv_udp_t* handle) {
  __bun_throw_not_implemented("uv_udp_recv_stop");
  __builtin_unreachable();
}

#endif