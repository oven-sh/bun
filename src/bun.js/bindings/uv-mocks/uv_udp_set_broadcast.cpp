#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_udp_set_broadcast(uv_udp_t* handle, int on) {
  __bun_throw_not_implemented("uv_udp_set_broadcast");
  __builtin_unreachable();
}

#endif