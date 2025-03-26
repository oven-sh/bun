#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

UV_EXTERN int uv_udp_init_ex(uv_loop_t*, uv_udp_t* handle, unsigned int flags) {
  __bun_throw_not_implemented("uv_udp_init_ex");
  __builtin_unreachable();
}

#endif