#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_udp_set_multicast_ttl(uv_udp_t* handle, int ttl) {
  __bun_throw_not_implemented("uv_udp_set_multicast_ttl");
  __builtin_unreachable();
}

#endif