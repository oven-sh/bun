#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_udp_set_multicast_loop(uv_udp_t* handle, int on) {
  __bun_throw_not_implemented("uv_udp_set_multicast_loop");
  __builtin_unreachable();
}

#endif