#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_udp_using_recvmmsg(const uv_udp_t* handle) {
  __bun_throw_not_implemented("uv_udp_using_recvmmsg");
  __builtin_unreachable();
}

#endif