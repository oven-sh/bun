#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_udp_init(uv_loop_t*, uv_udp_t* handle) {
  __bun_throw_not_implemented("uv_udp_init");
  __builtin_unreachable();
}

#endif